"""Feature-wise perceptual distance for Sound Generator 2.0 note pairs.

Run from the repository root:
  python -m scripts.tone_match.score --ref reference.wav --render render.wav
"""

from __future__ import annotations

import argparse
import html
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal

from .analysis import NoteAnalysis, analyse_audio_file, analyse_audio_samples, load_mono


DEFAULT_WEIGHTS = {
    "partials_db": 1.0,
    "log_mel_db": 1.0,
    "centroid_semitones": 1.0,
    "attack_ms": 1.0,
    "decay_log_ratio": 1.0,
    "inharmonicity_log_ratio": 1.0,
    "vibrato": 1.0,
    "noise": 1.0,
    "sustain_noise_db": 1.0,
    "onset_tilt_db_oct": 1.0,
    "onset_scoop_cents": 1.0,
    "onset_scoop_settle_ms": 1.0,
    "vibrato_onset_delay_ms": 1.0,
    "vibrato_ramp_ms": 1.0,
    "vibrato_rate_drift": 1.0,
    "body_am_db": 1.0,
    "onset_noise_db": 1.0,
    "onset_noise_centroid_oct": 1.0,
    "noise_lead_ms": 1.0,
    "onset_wander_cents": 1.0,
    "band_balance_db": 1.0,
    "ltas_rolloff_db_oct": 1.0,
    "onset_lockin_periods": 1.0,
}

_BLOWN_INSTRUMENTS = {
    "flute", "clarinet", "alto-sax", "tenor-sax", "trumpet", "french-horn",
}

# BOWED_PREFLIGHT P1 senses.  They enter with ZERO weight for blown so the
# frozen/reopened blown leaderboards keep scoring on the exact dimensions
# they were fitted against (comparability rule); bowed campaigns and later
# families score them from day one.
_BOWED_P1_FEATURES = (
    "vibrato_onset_delay_ms", "vibrato_ramp_ms", "vibrato_rate_drift",
    "body_am_db", "onset_noise_db", "onset_noise_centroid_oct",
    "noise_lead_ms", "onset_wander_cents",
    # RESEARCH_BOWED_REALISM 7a senses (C7/C18) — same comparability rule.
    "ltas_rolloff_db_oct", "onset_lockin_periods",
)

# T-005 band balance (RESEARCH_SUSTAIN_BALANCE 5.a).  The machinery serves
# every family; the blown lane flips this weight on when it re-baselines its
# leaderboards (its objective ids reset at that point anyway).
_PENDING_BLOWN_FEATURES = ("band_balance_db",)

# IEC 61260-1 nominal 1/3-octave centres, 100 Hz … 10 kHz (21 bands), and
# the octave summaries built from consecutive triples (125 … 8k centres).
THIRD_OCTAVE_CENTRES_HZ = (
    100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000,
    1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
)
OCTAVE_CENTRES_HZ = (125, 250, 500, 1000, 2000, 4000, 8000)


def weights_for_instrument(instrument: str | None,
                           overrides: dict[str, float] | None = None) -> dict[str, float]:
    """Return the physical scoring policy for an instrument family.

    Reed, lip and air-jet oscillators lock their radiated steady output to a
    harmonic series. Their passive bore impedance is not the stiff-string B
    fitted by the analyser, so that diagnostic remains visible but must not
    steer blown-instrument presets.
    """
    weights = dict(DEFAULT_WEIGHTS)
    if (instrument or "").strip().lower() in _BLOWN_INSTRUMENTS:
        weights["inharmonicity_log_ratio"] = 0.0
        for key in _BOWED_P1_FEATURES:
            weights[key] = 0.0
        for key in _PENDING_BLOWN_FEATURES:
            weights[key] = 0.0
    if overrides:
        weights.update(overrides)
    return weights

# One score unit is approximately one just-actionable mismatch.  The absolute
# values remain in the emitted feature table; these scales only make the
# uniformly weighted composite interpretable.
PERCEPTUAL_UNITS = {
    "partials_db": 3.0,
    "log_mel_db": 4.0,
    "centroid_semitones": 1.0,
    "attack_ms": 20.0,
    "decay_log_ratio": math.log(1.5),
    "inharmonicity_log_ratio": math.log(1.5),
    "vibrato": 1.0,
    "noise": 1.0,
    "sustain_noise_db": 3.0,
    "onset_tilt_db_oct": 3.0,
    "onset_scoop_cents": 10.0,
    "onset_scoop_settle_ms": 20.0,
    "vibrato_onset_delay_ms": 150.0,
    "vibrato_ramp_ms": 150.0,
    "vibrato_rate_drift": 0.5,
    "body_am_db": 2.0,
    "onset_noise_db": 3.0,
    "onset_noise_centroid_oct": 1.0,
    "noise_lead_ms": 20.0,
    "onset_wander_cents": 10.0,
    "band_balance_db": 3.0,       # L10/§3: 3 dB mean deviation = one unit
    "ltas_rolloff_db_oct": 4.0,   # C7: ±4 dB/oct tolerance = one unit
    "onset_lockin_periods": 9.0,  # C18: half the 18-period acceptance bound
}


@dataclass
class FeatureBundle:
    note: NoteAnalysis
    partial_db: np.ndarray
    mel_db: np.ndarray
    centroid_hz: np.ndarray
    sustain_noise_db: float = 0.0
    onset_tilt_db_oct: float = 0.0
    onset_noise_db: float = 0.0
    onset_noise_centroid_oct: float = 0.0
    noise_lead_ms: float = 0.0
    band_profile_db: np.ndarray | None = None   # 21 x 1/3-oct, dB re total
    ltas_rolloff_db_oct: float | None = None    # 3-8 kHz sustained slope
    onset_lockin_periods: float | None = None   # aperiodic window / period


def band_profile(samples: np.ndarray, sample_rate: int) -> np.ndarray | None:
    """Sustained-window 1/3-octave profile, dB re total (T-005 / 5.a spec).

    Window = [onset + 0.25 s, release − 0.1 s], minimum 1.0 s; Welch PSD
    (Hann 4096, 75% overlap), IEC 1/3-octave bands 100 Hz–10 kHz, each band
    expressed relative to total sustained energy so uniform gain cancels
    and tilt does not.  Returns None (not-applicable) for short notes.
    """
    envelope_hop = 512
    frame_rms = np.sqrt(np.convolve(samples ** 2, np.ones(2048) / 2048,
                                    mode="same"))[::envelope_hop]
    peak = float(np.max(frame_rms)) if frame_rms.size else 0.0
    if peak <= 0:
        return None
    active = np.flatnonzero(frame_rms >= peak * 1e-3)
    if active.size < 4:
        return None
    onset_s = active[0] * envelope_hop / sample_rate
    release_s = active[-1] * envelope_hop / sample_rate
    lo = onset_s + 0.25
    hi = release_s - 0.1
    if hi - lo < 1.0:
        return None
    segment = samples[int(lo * sample_rate):int(hi * sample_rate)]
    nper = min(4096, len(segment))
    freqs, psd = signal.welch(segment, fs=sample_rate, window="hann",
                              nperseg=nper, noverlap=nper * 3 // 4)
    edge = 2 ** (1 / 6)
    energies = np.zeros(len(THIRD_OCTAVE_CENTRES_HZ))
    for index, centre in enumerate(THIRD_OCTAVE_CENTRES_HZ):
        band = (freqs >= centre / edge) & (freqs < centre * edge)
        energies[index] = float(np.sum(psd[band]))
    total = float(np.sum(energies))
    if total <= 0:
        return None
    return 10 * np.log10(np.maximum(energies / total, 1e-12))


def octave_summary_db(profile_db: np.ndarray) -> np.ndarray:
    """Octave summaries (energy sums of consecutive 1/3-oct triples)."""
    linear = 10 ** (np.asarray(profile_db, dtype=float) / 10)
    return np.asarray([
        10 * math.log10(max(float(np.sum(linear[k * 3:k * 3 + 3])), 1e-12))
        for k in range(len(OCTAVE_CENTRES_HZ))])


def ltas_rolloff(profile_db: np.ndarray | None) -> float | None:
    """Sustained LTAS slope over the 3.15-8 kHz 1/3-oct bands, dB/octave.

    C7: violin radiated spectrum above ~3 kHz falls at roughly −15 dB/oct;
    too shallow reads as "synth string", too steep as "behind a door".
    """
    if profile_db is None:
        return None
    centres = np.asarray(THIRD_OCTAVE_CENTRES_HZ, dtype=float)
    mask = (centres >= 3150) & (centres <= 8000)
    values = np.asarray(profile_db, dtype=float)[mask]
    if np.all(values <= -119):
        return None
    return float(np.polyfit(np.log2(centres[mask]), values, 1)[0])


def _noise_and_onset_observables(
    power: np.ndarray,
    freqs: np.ndarray,
    times: np.ndarray,
    f0: float,
) -> tuple[float, float, float, float, float, float | None]:
    """Measure sustained turbulence, onset-only colour and the scratch window.

    Harmonic/noise separation uses spectral-density means rather than total
    band energy, so adding more high-frequency bins cannot manufacture extra
    breath.  The onset observable is the dB/octave regression of the
    onset-to-sustain ratio across resolved harmonic slots.

    Returns (sustain_noise_db, onset_tilt, onset_noise_db,
    onset_noise_centroid_oct, noise_lead_ms).  The last three are the
    BOWED_PREFLIGHT P1 scratch-window senses: noise-to-harmonic ratio inside
    the first ~80 ms, that noise's spectral centroid (octaves re 1 kHz), and
    how far the noise leads the tone at soft starts (L4's breath-lead
    mechanism; scratch-lead for bow).
    """
    if power.size == 0 or not np.isfinite(f0) or f0 <= 0:
        return 0.0, 0.0, 0.0, 0.0, 0.0, None
    frame_energy = np.sum(power, axis=0)
    peak = float(np.max(frame_energy)) if frame_energy.size else 0.0
    active = np.flatnonzero(frame_energy >= peak * 1e-3)
    if peak <= 0 or active.size < 4:
        return 0.0, 0.0, 0.0, 0.0, 0.0, None
    lo = active[int(active.size * .35)]
    hi = active[min(active.size - 1, int(active.size * .65))]
    sustain_frames = np.arange(lo, max(lo + 1, hi + 1))

    audible = (freqs >= 80) & (freqs <= min(16_000, freqs[-1]))
    harmonic = np.zeros_like(freqs, dtype=bool)
    half_width = max((freqs[1] - freqs[0]) * 2 if len(freqs) > 1 else 20, f0 * .035)
    for multiple in range(1, int(min(freqs[-1], 16_000) // f0) + 1):
        harmonic |= np.abs(freqs - multiple * f0) <= half_width
    harmonic &= audible
    noise = audible & ~harmonic
    harmonic_density = float(np.mean(power[np.ix_(harmonic, sustain_frames)])) if np.any(harmonic) else 0.0
    noise_density = float(np.mean(power[np.ix_(noise, sustain_frames)])) if np.any(noise) else 0.0
    sustain_noise_db = 10 * math.log10(max(noise_density, 1e-20) / max(harmonic_density, 1e-20))

    onset_start = times[active[0]] + .01
    onset_frames = np.flatnonzero((times >= onset_start) & (times <= onset_start + .08))
    indices, ratios = [], []
    for multiple in range(1, min(32, int(min(freqs[-1], 16_000) // f0)) + 1):
        bins = np.flatnonzero(np.abs(freqs - multiple * f0) <= half_width)
        if bins.size == 0 or onset_frames.size == 0:
            continue
        onset_power = float(np.max(np.mean(power[np.ix_(bins, onset_frames)], axis=1)))
        sustain_power = float(np.max(np.mean(power[np.ix_(bins, sustain_frames)], axis=1)))
        if onset_power > 1e-16 and sustain_power > 1e-16:
            indices.append(math.log2(multiple))
            ratios.append(10 * math.log10(onset_power / sustain_power))
    onset_tilt = float(np.polyfit(indices, ratios, 1)[0]) if len(indices) >= 4 else 0.0

    # scratch window: noise character of the first ~80 ms
    onset_noise_db = 0.0
    onset_noise_centroid_oct = 0.0
    if onset_frames.size and np.any(noise) and np.any(harmonic):
        onset_harmonic = float(np.mean(power[np.ix_(harmonic, onset_frames)]))
        onset_noise_power = power[np.ix_(noise, onset_frames)]
        onset_noise = float(np.mean(onset_noise_power))
        onset_noise_db = 10 * math.log10(max(onset_noise, 1e-20) /
                                         max(onset_harmonic, 1e-20))
        band_power = np.mean(onset_noise_power, axis=1)
        total = float(np.sum(band_power))
        if total > 1e-20:
            centroid_hz = float(np.dot(freqs[noise], band_power) / total)
            onset_noise_centroid_oct = math.log2(max(centroid_hz, 40) / 1000)

    # noise lead: time the noise floor crosses 10% of its sustain level
    # minus the same crossing for the harmonic content (positive = noise
    # leads the tone speaking)
    noise_lead_ms = 0.0
    lockin_periods = None
    if np.any(noise) and np.any(harmonic) and noise_density > 1e-20 and harmonic_density > 1e-20:
        noise_t = np.mean(power[noise, :], axis=0)
        harm_t = np.mean(power[harmonic, :], axis=0)
        cross = lambda track, level: next(
            (times[j] for j in range(len(track)) if track[j] >= level), None)
        t_noise = cross(noise_t, 0.1 * noise_density)
        t_harm = cross(harm_t, 0.1 * harmonic_density)
        if t_noise is not None and t_harm is not None:
            noise_lead_ms = float((t_harm - t_noise) * 1000)
        # onset lock-in (C18): nominal periods from the note start until the
        # harmonic regime is established (50% of sustain harmonic density,
        # held).  G&A 1997 acceptance: <= 18 periods loose, <= 10 good.
        t_start = times[active[0]]
        hold = 3
        t_lock = None
        for j in range(len(harm_t) - hold):
            if np.all(harm_t[j:j + hold] >= 0.5 * harmonic_density):
                t_lock = times[j]
                break
        if t_lock is not None:
            lockin_periods = float(max(0.0, (t_lock - t_start)) * f0)
    return (sustain_noise_db, onset_tilt, onset_noise_db,
            onset_noise_centroid_oct, noise_lead_ms, lockin_periods)


def _resample_time(values: np.ndarray, frames: int = 120) -> np.ndarray:
    values = np.asarray(values, dtype=float)
    if values.ndim == 1:
        values = values[None, :]
    if values.shape[1] == frames:
        return values
    old = np.linspace(0, 1, values.shape[1])
    new = np.linspace(0, 1, frames)
    return np.stack([np.interp(new, old, row) for row in values])


def _mel_bank(sample_rate: int, nfft: int, bands: int = 48, fmin: float = 40, fmax: float = 16000) -> np.ndarray:
    fmax = min(fmax, sample_rate * 0.48)
    hz_to_mel = lambda hz: 2595 * np.log10(1 + np.asarray(hz) / 700)
    mel_to_hz = lambda mel: 700 * (10 ** (np.asarray(mel) / 2595) - 1)
    points = mel_to_hz(np.linspace(hz_to_mel(fmin), hz_to_mel(fmax), bands + 2))
    freqs = np.fft.rfftfreq(nfft, 1 / sample_rate)
    bank = np.zeros((bands, len(freqs)))
    for index in range(bands):
        left, centre, right = points[index:index + 3]
        bank[index] = np.maximum(0, np.minimum((freqs - left) / max(centre - left, 1e-9),
                                               (right - freqs) / max(right - centre, 1e-9)))
    return bank


def extract_features(
    path: str | Path,
    n_partials: int = 32,
    *,
    active_duration_s: float | None = None,
) -> FeatureBundle:
    samples, sample_rate = load_mono(str(path))
    if active_duration_s is None:
        note = analyse_audio_file(path, n_partials=max(64, n_partials))
    else:
        # Offline renders contain the requested active note plus a deliberately
        # long release/ring tail.  Construction assertions about sustained vs
        # impulsive excitation must inspect the active interval, otherwise a
        # short reference duration makes the same sustained synth look
        # percussive merely because its tail occupies the middle analysis
        # window.  Preserve the renderer's fixed 20 ms lead-in.
        active_frames = round((max(0.03, float(active_duration_s)) + 0.02) * sample_rate)
        samples = samples[:active_frames]
        note = analyse_audio_samples(samples, sample_rate, name=str(path),
                                     n_partials=max(64, n_partials))
    nfft = 2048
    _, times, spectrum = signal.stft(samples, fs=sample_rate, nperseg=nfft, noverlap=1536,
                                     boundary=None, padded=False)
    power = np.abs(spectrum) ** 2
    mel = _mel_bank(sample_rate, nfft) @ power
    mel_db = 10 * np.log10(np.maximum(mel, 1e-12))
    mel_db -= np.percentile(mel_db, 95)  # loudness-match without chasing peaks
    freqs = np.fft.rfftfreq(nfft, 1 / sample_rate)
    centroid = (freqs[:, None] * power).sum(axis=0) / np.maximum(power.sum(axis=0), 1e-20)
    amps = np.maximum(note.partial_amps[:n_partials], 1e-4)
    partial_db = 20 * np.log10(amps / max(float(np.max(amps)), 1e-12))
    (sustain_noise_db, onset_tilt, onset_noise_db,
     onset_noise_centroid_oct, noise_lead_ms,
     lockin_periods) = _noise_and_onset_observables(power, freqs, times, note.f0)
    profile = band_profile(samples, sample_rate)
    return FeatureBundle(note, partial_db, _resample_time(mel_db),
                         _resample_time(centroid)[0], sustain_noise_db, onset_tilt,
                         onset_noise_db, onset_noise_centroid_oct, noise_lead_ms,
                         band_profile_db=profile,
                         ltas_rolloff_db_oct=ltas_rolloff(profile),
                         onset_lockin_periods=lockin_periods)


def _paired(values_a: dict, values_b: dict) -> tuple[np.ndarray, np.ndarray]:
    common = sorted(set(values_a).intersection(values_b), key=float)
    value = lambda item: item.get("t90", 0) if isinstance(item, dict) else item
    return (np.asarray([value(values_a[k]) for k in common], dtype=float),
            np.asarray([value(values_b[k]) for k in common], dtype=float))


def _decay_distance(ref: NoteAnalysis, render: NoteAnalysis) -> float:
    if not ref.t60 or not render.t60:
        return 0.0
    rf = np.asarray([row[0] for row in ref.t60]); rt = np.asarray([row[1] for row in ref.t60])
    sf = np.asarray([row[0] for row in render.t60]); st = np.asarray([row[1] for row in render.t60])
    values = []
    for freq, value in zip(rf, rt):
        index = int(np.argmin(np.abs(np.log(np.maximum(sf, 1) / max(freq, 1)))))
        if abs(math.log(max(sf[index], 1) / max(freq, 1))) < math.log(1.2):
            values.append(abs(math.log(max(st[index], .001) / max(value, .001))))
    return float(np.mean(values)) if values else 0.0


def _vibrato_distance(ref: NoteAnalysis, render: NoteAnalysis) -> float:
    """Compare rate/depth only after the detector says vibrato is present.

    The estimator still emits a peak rate and depth for straight tones.  Those
    values describe low-level drift or analysis noise, not vibrato, and must
    not steer a fit toward adding modulation to a non-vibrato reference.
    """
    vr, vs = ref.vibrato or {}, render.vibrato or {}
    ref_present, render_present = bool(vr.get("present")), bool(vs.get("present"))
    if not ref_present and not render_present:
        return 0.0
    if ref_present != render_present:
        return 1.0
    number = lambda value, fallback=0.0: float(value) if isinstance(value, (int, float)) and np.isfinite(value) else fallback
    ref_rate, render_rate = number(vr.get("rate")), number(vs.get("rate"))
    ref_depth, render_depth = number(vr.get("depth")), number(vs.get("depth"))
    distance = abs(ref_rate - render_rate) / .3
    distance += abs(ref_depth - render_depth) / max(5, .3 * (ref_depth or 1))
    return distance


def band_balance_distance(ref: FeatureBundle,
                          render: FeatureBundle) -> tuple[float, float | None]:
    """(mean 1/3-oct deviation, max octave-summary deviation), dB.

    Bands where the reference sits below −60 dB re total are noise floor on
    both sides and excluded (5.a validity mask).  Returns (0, None) when
    either note is too short for a sustained profile (not-applicable).
    """
    if ref.band_profile_db is None or render.band_profile_db is None:
        return 0.0, None
    ref_profile = np.asarray(ref.band_profile_db, dtype=float)
    render_profile = np.asarray(render.band_profile_db, dtype=float)
    valid = ref_profile > -60
    if not np.any(valid):
        return 0.0, None
    d_mean = float(np.mean(np.abs(render_profile[valid] - ref_profile[valid])))
    ref_oct = octave_summary_db(ref_profile)
    render_oct = octave_summary_db(render_profile)
    oct_valid = ref_oct > -60
    d_max8 = float(np.max(np.abs(render_oct[oct_valid] - ref_oct[oct_valid]))) \
        if np.any(oct_valid) else None
    return d_mean, d_max8


def compare_features(ref: FeatureBundle, render: FeatureBundle, weights: dict[str, float] | None = None) -> dict[str, Any]:
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    audible = np.maximum(ref.partial_db, render.partial_db) > -66
    partial_db = float(np.mean(np.abs(ref.partial_db[audible] - render.partial_db[audible]))) if np.any(audible) else 0.0
    mel_db = float(np.mean(np.abs(ref.mel_db - render.mel_db)))
    cents = 12 * np.log2(np.maximum(render.centroid_hz, 20) / np.maximum(ref.centroid_hz, 20))
    centroid = float(np.mean(np.abs(cents)))
    ra, rb = _paired(ref.note.band_t90, render.note.band_t90)
    attack = float(np.mean(np.abs(ra - rb)) * 1000) if ra.size else 0.0
    decay = _decay_distance(ref.note, render.note)
    b_ref, b_render = ref.note.B or 0, render.note.B or 0
    b_distance = abs(math.log(max(b_render, 1e-8) / max(b_ref, 1e-8))) if b_ref or b_render else 0.0
    number = lambda value, fallback=0.0: float(value) if isinstance(value, (int, float)) and np.isfinite(value) else fallback
    vibrato = _vibrato_distance(ref.note, render.note)
    nr, ns = ref.note.attack_noise or {}, render.note.attack_noise or {}
    pr, ps = ref.note.onset_pitch or {}, render.note.onset_pitch or {}
    # Below a 0.1% attack/sustain ratio the residual centre is not a
    # perceptually stable feature: the detector may return no burst at all,
    # or a harmonic/noise-bin peak. Compare floored level, but only compare
    # frequency when both transients clear that audibility floor.
    noise_floor = 1e-3
    ref_noise_level = max(0, number(nr.get("level"), 0))
    render_noise_level = max(0, number(ns.get("level"), 0))
    level_db = abs(20 * math.log10(max(render_noise_level, noise_floor) /
                                   max(ref_noise_level, noise_floor))) / 3
    freq_oct = 0.0
    if ref_noise_level >= noise_floor and render_noise_level >= noise_floor:
        freq_oct = abs(math.log2(max(number(ns.get("freq"), 1), 1) /
                                 max(number(nr.get("freq"), 1), 1)))
    noise = level_db + freq_oct
    # Vibrato-trajectory distances only apply when both notes vibrate: the
    # presence mismatch itself is already the `vibrato` feature's job, and
    # trajectory keys measured on a straight tone are analysis noise.
    vr, vs = ref.note.vibrato or {}, render.note.vibrato or {}
    both_vibrato = bool(vr.get("present")) and bool(vs.get("present"))
    trajectory = lambda key: abs(number(vs.get(key)) - number(vr.get(key))) \
        if both_vibrato else 0.0
    values = {
        "partials_db": partial_db, "log_mel_db": mel_db,
        "centroid_semitones": centroid, "attack_ms": attack,
        "decay_log_ratio": decay, "inharmonicity_log_ratio": b_distance,
        "vibrato": vibrato, "noise": noise,
        "sustain_noise_db": abs(render.sustain_noise_db - ref.sustain_noise_db),
        "onset_tilt_db_oct": abs(render.onset_tilt_db_oct - ref.onset_tilt_db_oct),
        "onset_scoop_cents": abs(number(ps.get("depthCents")) -
                                   number(pr.get("depthCents"))),
        "onset_scoop_settle_ms": abs(number(ps.get("settleMs")) -
                                      number(pr.get("settleMs"))),
        "vibrato_onset_delay_ms": trajectory("onsetDelayMs"),
        "vibrato_ramp_ms": trajectory("depthRampMs"),
        "vibrato_rate_drift": trajectory("rateDriftHzPerSecond"),
        "body_am_db": trajectory("bodyAmDepthDb"),
        "onset_noise_db": abs(render.onset_noise_db - ref.onset_noise_db),
        "onset_noise_centroid_oct": abs(render.onset_noise_centroid_oct -
                                        ref.onset_noise_centroid_oct),
        "noise_lead_ms": abs(render.noise_lead_ms - ref.noise_lead_ms),
        "onset_wander_cents": abs(number(ps.get("wanderCents")) -
                                    number(pr.get("wanderCents"))),
        "band_balance_db": band_balance_distance(ref, render)[0],
        "ltas_rolloff_db_oct": (
            abs(render.ltas_rolloff_db_oct - ref.ltas_rolloff_db_oct)
            if ref.ltas_rolloff_db_oct is not None and
            render.ltas_rolloff_db_oct is not None else 0.0),
        "onset_lockin_periods": (
            abs(render.onset_lockin_periods - ref.onset_lockin_periods)
            if ref.onset_lockin_periods is not None and
            render.onset_lockin_periods is not None else 0.0),
    }
    normalized = {key: values[key] / PERCEPTUAL_UNITS[key] for key in values}
    active_weight = sum(weights[key] for key in values if weights[key] > 0)
    composite = sum(normalized[key] * weights[key] for key in values) / max(active_weight, 1e-9)
    return {"features": values, "normalized": normalized, "weights": weights,
            "composite": float(composite), "refF0": ref.note.f0, "renderF0": render.note.f0}


def score_files(
    ref_path: str | Path,
    render_path: str | Path,
    weights: dict[str, float] | None = None,
    *,
    instrument: str | None = None,
    params: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ref = extract_features(ref_path)
    render = extract_features(render_path)
    result = compare_features(ref, render, weights_for_instrument(instrument, weights))
    if instrument:
        # Local import avoids an import cycle: assertions operates on the
        # FeatureBundle defined by this module.
        from .assertions import ConstructionSample, evaluate_construction
        context = context or {}
        sample = ConstructionSample(render=render, reference=ref,
                                    register=context.get("register"), dynamic=context.get("dynamic"),
                                    velocity=context.get("velocity"))
        result["construction"] = evaluate_construction(
            instrument, [sample], params=params, strict_evidence=False)
    return result


def write_report(path: str | Path, result: dict[str, Any], ref_path: str, render_path: str) -> None:
    rows = "".join(
        f"<tr><th>{html.escape(key)}</th><td>{value:.4g}</td><td>{result['normalized'][key]:.3f}</td>"
        f"<td>{result['weights'][key]:.2f}</td></tr>"
        for key, value in result["features"].items())
    payload = html.escape(json.dumps(result, indent=2))
    Path(path).write_text(f"""<!doctype html><meta charset=\"utf-8\"><title>SG2 tone-match report</title>
<style>body{{font:15px system-ui;max-width:900px;margin:40px auto;color:#17202a}}table{{border-collapse:collapse;width:100%}}th,td{{padding:8px;border-bottom:1px solid #ddd;text-align:left}}code{{white-space:pre-wrap}}</style>
<h1>Sound Generator 2.0 comparison</h1><p><b>Reference:</b> {html.escape(ref_path)}<br><b>Render:</b> {html.escape(render_path)}</p>
<h2>Composite loss: {result['composite']:.4f}</h2><table><thead><tr><th>Feature</th><th>Distance</th><th>Perceptual units</th><th>Weight</th></tr></thead><tbody>{rows}</tbody></table>
<details><summary>Machine-readable result</summary><code>{payload}</code></details>""", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True)
    parser.add_argument("--render", required=True)
    parser.add_argument("--weights", help="JSON file overriding feature weights")
    parser.add_argument("--instrument", help="also run the matching dossier checklist")
    parser.add_argument("--params", help="preset JSON used by topology assertions")
    parser.add_argument("--register")
    parser.add_argument("--dynamic")
    parser.add_argument("--velocity", type=float)
    parser.add_argument("--json", dest="json_path")
    parser.add_argument("--report")
    args = parser.parse_args(argv)
    weights = json.loads(Path(args.weights).read_text()) if args.weights else None
    params = json.loads(Path(args.params).read_text()) if args.params else None
    result = score_files(args.ref, args.render, weights, instrument=args.instrument, params=params,
                         context={"register": args.register, "dynamic": args.dynamic, "velocity": args.velocity})
    output = json.dumps(result, indent=2)
    print(output)
    if args.json_path:
        Path(args.json_path).write_text(output + "\n", encoding="utf-8")
    if args.report:
        write_report(args.report, result, args.ref, args.render)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
