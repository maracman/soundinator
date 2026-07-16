#!/usr/bin/env python3
"""
fit_profiles_from_samples.py — fit the Sound Studio additive-synthesis tone
model (web/static/synth.js, "tone model v2") to real instrument recordings.

The engine model this script fits (see synth.js for the authoritative code):

  * SPECTRAL_PROFILES[instr].partials — 64 relative partial amplitudes at a
    reference mezzo-forte, mid-register note.  amp is linear, normalised so
    the strongest partial is 1.0.  `spread` encodes onset-to-onset
    variability: the engine draws A_n ~ Normal(amp_n, sd_n) with
    sd_n = amp_n * spread_n * 0.5, i.e.  spread ≈ 2 × (relative sd).
  * partialB — stiff-string inharmonicity.  Realised partial frequencies are
        f_n = n · f0 · sqrt((1 + B·n²) / (1 + B))
    (partialFrequency() in synth.js, "string" resonator class).
  * partialMaterial — damping law.  materialT60() maps material m∈[0,1] to
        T60(f) = t60Ref · (f / 261.63)^(−slope)
    with t60Ref = exp((1−m)·ln 7.0 + m·ln 0.55)  (glass 7.0 s … felt 0.55 s)
    and  slope  = 0.25 + 1.1·m.
    We fit (t60Ref, slope) to per-partial decay measurements and report the
    m that best reproduces the measured T60(f) curve.
  * performance.attackNoise {level, freq, q, decay} — a bandpass-filtered
    noise burst at note onset (biquad bandpass at `freq` with quality `q`,
    peak gain ≈ velocity·level·0.3, exponential decay over `decay` s).
    We estimate it from the non-harmonic (residual) energy of the attack.
  * performance.envelopeAttack/Decay/Sustain/Release and vibrato* — ADSR
    and vibrato statistics of the source notes.

INPUT LAYOUT
    <samples-dir>/<instrument>/*.aif|*.aiff|*.wav|*.flac
Each audio file may contain ONE note or a chromatic RUN of notes separated
by silence (University of Iowa MIS style) — files are auto-segmented.
File-name conventions understood:
  * "nonvib"/"novib" in the name → used for spectral/envelope analysis only;
  * "vib" (and not nonvib/novib) → used for vibrato analysis only, when a
    nonvib sibling exists.  If an instrument has no such split (e.g. arco
    strings, piano) every file feeds every analysis.
Place the corpus-contract sidecars `PROVENANCE.json` and `COVERAGE.md` in
each instrument directory. `PROVENANCE.json` is copied into the output. The
legacy lowercase `provenance.json` remains readable outside strict mode.

OUTPUT
    JSON keyed by instrument, with fields named to match the engine:
    { partials: [{amp, spread}×64], partialB,
      material:  {t60Ref, slope, suggestedMaterial, ...},
      performance: {envelopeAttack…, vibrato…, attackNoise{…}},
      attack: {per-octave-band time-to-90%-energy, low→high stagger},
      provenance: {...}, notes: [per-note diagnostics] }

USAGE
    python3 fit_profiles_from_samples.py --samples DIR --out out.json \
        [--report report.md] [--partials 64]

Dependencies: numpy, scipy, soundfile (pure analysis — writes no audio).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
from dataclasses import dataclass, field

import numpy as np
from scipy import linalg
from scipy import signal as sig

try:
    import soundfile as sf
except ImportError:  # importable math/feature helpers do not require audio I/O
    sf = None

# ──────────────────────────────────────────────────────────────────────────
# Engine constants (mirrors of synth.js — keep in sync manually)
# ──────────────────────────────────────────────────────────────────────────

REF_HZ = 261.63          # middle C, the engine's material/T60 reference
GLASS_T60, FELT_T60 = 7.0, 0.55   # materialT60 anchors at m=0 / m=1
SLOPE_MIN, SLOPE_SPAN = 0.25, 1.1

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
VOWEL_RE = re.compile(r"_([aeiou])\.(?:wav|aif|aiff|flac|ogg|mp3)$", re.IGNORECASE)


def engine_t60(freq_hz: float, material: float) -> float:
    """Mirror of synth.js materialT60()."""
    m = min(1.0, max(0.0, material))
    t60_ref = math.exp((1 - m) * math.log(GLASS_T60) + m * math.log(FELT_T60))
    slope = SLOPE_MIN + m * SLOPE_SPAN
    return t60_ref * (max(30.0, freq_hz) / REF_HZ) ** (-slope)


def partial_frequency(n: int, f0: float, B: float) -> float:
    """Mirror of synth.js partialFrequency() for the 'string' class."""
    b = max(0.0, B)
    return n * f0 * math.sqrt((1 + b * n * n) / (1 + b))


def hz_to_note_name(f: float) -> str:
    midi = 69 + 12 * math.log2(f / 440.0)
    m = int(round(midi))
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


# ──────────────────────────────────────────────────────────────────────────
# Basic DSP helpers
# ──────────────────────────────────────────────────────────────────────────

def load_mono(path: str) -> tuple[np.ndarray, int]:
    if sf is None:
        raise RuntimeError("audio analysis requires the optional 'soundfile' package")
    x, sr = sf.read(path, always_2d=True)
    return x.mean(axis=1).astype(np.float64), sr


def rms_envelope(x: np.ndarray, sr: int, win_s: float = 0.020, hop_s: float = 0.005):
    """Short-time RMS envelope. Returns (env, hop_samples)."""
    win = max(16, int(win_s * sr))
    hop = max(8, int(hop_s * sr))
    n = 1 + max(0, (len(x) - win) // hop)
    sq = x * x
    csum = np.concatenate([[0.0], np.cumsum(sq)])
    idx = np.arange(n) * hop
    env = np.sqrt((csum[idx + win] - csum[idx]) / win)
    return env, hop


def segment_notes(x: np.ndarray, sr: int,
                  min_dur_s: float = 0.35, merge_gap_s: float = 0.25):
    """Split a recording into note regions by RMS threshold.

    Works both for single-note files and Iowa-style chromatic runs where
    notes are separated by silence.  Returns [(start_sample, end_sample)].
    """
    env, hop = rms_envelope(x, sr)
    if env.size == 0:
        return []
    peak = float(env.max())
    floor = float(np.percentile(env, 10))
    # Above whichever is larger: −46 dB re peak, or 4× the noise floor —
    # but the floor term is capped at −20 dB re peak (a short single-note
    # file is mostly signal, so its 10th percentile IS signal, and an
    # uncapped floor-based gate would swallow the note).
    thr = max(peak * 10 ** (-46 / 20), min(floor * 4.0, peak * 0.1), 1e-6)
    active = env > thr
    # region extraction
    regions = []
    i = 0
    while i < len(active):
        if active[i]:
            j = i
            while j < len(active) and active[j]:
                j += 1
            regions.append([i, j])
            i = j
        else:
            i += 1
    # merge close regions (vibrato dips, bow changes)
    merged = []
    gap_frames = int(merge_gap_s * sr / hop)
    for r in regions:
        if merged and r[0] - merged[-1][1] <= gap_frames:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    # Trim each region to its core: low-level bow/breath/room noise between
    # notes can sit above the gate and glue several seconds of quiet
    # preamble onto a note, which would corrupt f0 and sustain estimates.
    # Core = frames ≥ −20 dB re the region's own peak; keep 0.2 s before it
    # and extend after it down to −40 dB re peak (decay tails matter for
    # T60/release), plus a small pad.
    out = []
    for a, b in merged:
        seg_env = env[a:b]
        if seg_env.size == 0:
            continue
        seg_peak = float(seg_env.max())
        core = np.where(seg_env >= 0.1 * seg_peak)[0]
        if core.size == 0:
            continue
        start_f = a + max(0, core[0] - int(0.2 * sr / hop))
        # tail: keep the decay down to −40 dB re the segment peak, but stop
        # at the region's own noise bed (bow/breath/room noise after the
        # note rings out sits above the global gate and would otherwise
        # keep seconds of junk glued to the note).  The bed level is what
        # the region decays INTO — its last half second.
        # No fixed dB-re-peak floor here: a piano strike peak sits 40+ dB
        # above its (audible, relevant) ring, so a peak-relative cut would
        # truncate exactly the decay we need for T60.
        bed = float(np.median(seg_env[-max(1, int(0.5 * sr / hop)):]))
        tail_thr = max(1.5 * bed, thr)
        after_core = seg_env[core[-1]:]
        below = np.where(after_core < tail_thr)[0]
        end_f = a + core[-1] + (below[0] if below.size else after_core.size)
        # Percussive-shaped region (early peak, no sustain plateau)?  Then
        # the broadband gate underestimates the tail badly: a quiet piano
        # recording may have only ~30 dB of broadband range while individual
        # partial tracks (narrowband) decay measurably for far longer.
        # Extend the tail generously; silence is harmless to the percussive
        # analyses (they are onset/peak-referenced).
        pk_rel = int(np.argmax(seg_env))
        mid_slice = seg_env[len(seg_env) // 4: 3 * len(seg_env) // 4]
        mid_med = float(np.median(mid_slice if mid_slice.size else seg_env))
        if pk_rel < len(seg_env) * 0.25 and mid_med < 0.35 * seg_peak:
            end_f = b + int(8.0 * sr / hop)
        s, e = start_f * hop, end_f * hop
        if (e - s) / sr < min_dur_s:
            continue
        out.append((max(0, s - int(0.05 * sr)), min(len(x), e + int(0.30 * sr))))
    # never overlap into the next region (its attack would pollute tails)
    for i in range(len(out) - 1):
        if out[i][1] > out[i + 1][0]:
            out[i] = (out[i][0], out[i + 1][0])
    return out


def estimate_f0(seg: np.ndarray, sr: int, fmin: float = 50.0, fmax: float = 2000.0):
    """Autocorrelation f0 on a mid-note slice, parabolic-refined."""
    n0 = len(seg) // 4
    win = min(len(seg) - n0, int(0.5 * sr))
    if win < int(0.05 * sr):
        n0, win = 0, len(seg)
    y = seg[n0:n0 + win] * np.hanning(win)
    # FFT autocorrelation
    nfft = 1 << int(np.ceil(np.log2(2 * win)))
    Y = np.fft.rfft(y, nfft)
    ac = np.fft.irfft(Y * np.conj(Y))[:win]
    ac /= (ac[0] + 1e-12)
    lag_min = int(sr / fmax)
    lag_max = min(win - 2, int(sr / fmin))
    if lag_max <= lag_min + 2:
        return None
    r = ac[lag_min:lag_max]
    k = int(np.argmax(r)) + lag_min
    if ac[k] < 0.3:                      # not periodic enough
        return None
    # guard against octave-down errors: prefer the smallest lag whose peak
    # is nearly as high as the global best
    cand = k
    for div in (4, 3, 2):
        kk = int(round(k / div))
        if kk > lag_min + 1:
            j = kk + int(np.argmax(ac[kk - 1:kk + 2])) - 1
            if ac[j] > 0.85 * ac[k]:
                cand = j
                break
    k = cand
    # parabolic refinement
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    denom = (a - 2 * b + c)
    delta = 0.5 * (a - c) / denom if abs(denom) > 1e-12 else 0.0
    return sr / (k + delta)


def spectrum_peak(freqs: np.ndarray, mag: np.ndarray, f_lo: float, f_hi: float):
    """Highest local peak in [f_lo, f_hi]; returns (freq, amp) parabolic-refined
    in log magnitude, or None."""
    i_lo = int(np.searchsorted(freqs, f_lo))
    i_hi = int(np.searchsorted(freqs, f_hi))
    if i_hi - i_lo < 3:
        return None
    seg = mag[i_lo:i_hi]
    k = int(np.argmax(seg)) + i_lo
    if k <= 0 or k >= len(mag) - 1:
        return None
    a, b, c = mag[k - 1], mag[k], mag[k + 1]
    if b <= 0:
        return None
    la, lb, lc = (math.log(max(v, 1e-12)) for v in (a, b, c))
    denom = la - 2 * lb + lc
    delta = 0.5 * (la - lc) / denom if abs(denom) > 1e-9 else 0.0
    delta = max(-0.5, min(0.5, delta))
    df = freqs[1] - freqs[0]
    return (freqs[k] + delta * df, math.exp(lb - 0.25 * (la - lc) * delta))


def vowel_from_filename(path: str) -> str | None:
    """Return VocalSet's terminal vowel label without guessing other names."""
    match = VOWEL_RE.search(os.path.basename(path))
    return match.group(1).lower() if match else None


def estimate_formants(seg: np.ndarray, sr: int) -> tuple[list[float], list[float]] | None:
    """Estimate F1-F5 and bandwidths from steady-state frames using LPC.

    The estimator is intentionally limited to explicitly vowel-labelled
    files.  Frame-wise LPC roots are filtered by frequency/bandwidth and
    combined by medians so a single glottal pulse or pitch harmonic cannot
    become a voice-type body band.
    """
    if len(seg) < int(0.35 * sr):
        return None
    target_sr = 16000
    y = np.asarray(seg[len(seg) // 4: 3 * len(seg) // 4], dtype=float)
    if sr != target_sr:
        divisor = math.gcd(sr, target_sr)
        y = sig.resample_poly(y, target_sr // divisor, sr // divisor)
        sr = target_sr
    y = y - np.mean(y)
    y = sig.lfilter([1.0, -0.97], [1.0], y)
    frame = int(0.04 * sr)
    hop = frame // 2
    # Five vocal-tract resonances plus the glottal spectral envelope require
    # more poles than the classic speech-recognition minimum.  Order 26 at
    # 16 kHz resolves low F1/F2 on high-f0 female voices much more reliably.
    order = 26
    rows: list[tuple[list[float], list[float]]] = []
    for start in range(0, max(0, len(y) - frame + 1), hop):
        part = y[start:start + frame] * np.hamming(frame)
        if np.sqrt(np.mean(part * part)) < 1e-5:
            continue
        corr = np.correlate(part, part, mode="full")[frame - 1: frame + order]
        if corr[0] <= 0:
            continue
        corr[0] *= 1.0001  # tiny diagonal loading for breathy/near-periodic frames
        try:
            coeff = linalg.solve_toeplitz(corr[:-1], -corr[1:])
        except linalg.LinAlgError:
            continue
        roots = np.roots(np.r_[1.0, coeff])
        roots = roots[np.imag(roots) >= 0]
        freqs = np.angle(roots) * sr / (2 * np.pi)
        bandwidths = -0.5 * sr / np.pi * np.log(np.clip(np.abs(roots), 1e-9, None))
        candidates = sorted((float(f), float(b)) for f, b in zip(freqs, bandwidths)
                            if 150 <= f <= 7500 and 25 <= b <= 900)
        if len(candidates) >= 5:
            chosen = candidates[:5]
            rows.append(([f for f, _ in chosen], [b for _, b in chosen]))
    if len(rows) < 3:
        return None
    return ([float(np.median([row[0][i] for row in rows])) for i in range(5)],
            [float(np.median([row[1][i] for row in rows])) for i in range(5)])


# ──────────────────────────────────────────────────────────────────────────
# Per-note analysis
# ──────────────────────────────────────────────────────────────────────────

@dataclass
class NoteAnalysis:
    file: str
    f0: float
    note: str
    dur_s: float
    partial_amps: np.ndarray          # length n_partials, strongest == 1
    partial_freqs: np.ndarray         # measured Hz (nan where undetected)
    partial_snr_ok: np.ndarray        # bool mask
    B: float | None = None
    t60: list = field(default_factory=list)       # [(freq_hz, t60_s, kind)]
    adsr: dict = field(default_factory=dict)
    band_t90: dict = field(default_factory=dict)  # {band_center: t90_s}
    attack_noise: dict = field(default_factory=dict)
    onset_pitch: dict = field(default_factory=dict)
    vibrato: dict = field(default_factory=dict)
    vowel: str | None = None
    formants: list[float] = field(default_factory=list)
    formant_bandwidths: list[float] = field(default_factory=list)
    percussive: bool = False


def harmonic_frame_amps(seg: np.ndarray, sr: int, f0: float,
                        n_partials: int = 64, B: float = 0.0):
    """Vibrato-robust partial measurement: per-frame harmonic tracking.

    A single long-window FFT peak-read smears a vibrato tone into a Bessel
    sideband cluster whose peak height is quasi-random in the modulation
    index — on the violin corpus it produced per-partial errors of several
    dB with 30–50 dB outliers.  Instead: STFT with ~93 ms frames, track
    f0(t) from the strongest low partial, read each harmonic's interpolated
    peak near n·f0(t) per frame, take the median across frames.  For a
    stationary tone this agrees with the long-window measure; under FM/AM it
    estimates the mean amplitude the vibrato modulates around.

    Returns (amps, freqs, ok) like the long-window `measure`, or None when
    the segment is too short to frame.
    """
    a, b = len(seg) // 4, 3 * len(seg) // 4
    y = seg[a:b]
    nper = 1 << int(round(math.log2(sr * 0.093)))
    if f0 < 120:
        nper *= 2                     # resolve low-cello/low-voice harmonics
    if len(y) < 2 * nper:
        return None
    f, _t, Z = sig.stft(y, fs=sr, nperseg=nper, noverlap=nper * 3 // 4,
                        window="hann", padded=False, boundary=None)
    mag = np.abs(Z)
    n_frames = mag.shape[1]
    if n_frames < 6:
        return None
    df = float(f[1] - f[0])
    nyq_lim = 0.47 * sr

    def peak_track(target: np.ndarray, halfwidth: float):
        """Per-frame (peak height, band RMS energy, interpolated peak Hz).

        The band energy is the vibrato-proof amplitude: intra-frame FM
        smears a fast-sweeping harmonic across bins, which lowers the peak
        but preserves the energy inside the tracking band.
        """
        peaks = np.full(n_frames, np.nan)
        energy = np.full(n_frames, np.nan)
        freqs_out = np.full(n_frames, np.nan)
        for j in range(n_frames):
            lo = max(1, int((target[j] - halfwidth) / df))
            hi = min(len(f) - 2, int((target[j] + halfwidth) / df))
            if hi - lo < 2:
                continue
            k = lo + int(np.argmax(mag[lo:hi + 1, j]))
            va, vb, vc = mag[k - 1, j], mag[k, j], mag[k + 1, j]
            la, lb, lc = (math.log(max(v, 1e-15)) for v in (va, vb, vc))
            den = la - 2 * lb + lc
            delta = 0.5 * (la - lc) / den if abs(den) > 1e-9 else 0.0
            peaks[j] = float(vb)
            energy[j] = float(math.sqrt(np.sum(mag[lo:hi + 1, j] ** 2)))
            freqs_out[j] = (k + max(-.5, min(.5, delta))) * df
        return peaks, energy, freqs_out

    # f0 track from the strongest of partials 1–3
    probe_med = []
    for k in (1, 2, 3):
        if k * f0 >= nyq_lim:
            break
        amps_k, _, _ = peak_track(np.full(n_frames, k * f0), 0.3 * f0)
        probe_med.append(np.nanmedian(amps_k))
    if not probe_med:
        return None
    k_star = int(np.argmax(probe_med)) + 1
    _amps_k, _e_k, freqs_k = peak_track(np.full(n_frames, k_star * f0), 0.45 * f0)
    f0_track = freqs_k / k_star
    good = np.isfinite(f0_track) & (np.abs(1200 * np.log2(
        np.clip(f0_track, 1, None) / f0)) < 120)
    if good.sum() < max(6, n_frames // 4):
        f0_track = np.full(n_frames, f0)
    else:
        f0_track = np.where(good, f0_track, np.nan)

    amps = np.zeros(n_partials)
    pfreqs = np.full(n_partials, np.nan)
    ok = np.zeros(n_partials, dtype=bool)
    for n in range(1, n_partials + 1):
        stretch = partial_frequency(n, f0, B) / (n * f0) if B else 1.0
        centre = n * f0 * stretch
        if centre > nyq_lim:
            break
        target = np.where(np.isfinite(f0_track), n * f0_track * stretch, centre)
        # wide enough for the intra-frame vibrato sweep of high harmonics,
        # capped below half the harmonic spacing to avoid neighbour bleed
        halfwidth = float(min(0.4 * f0, max(0.18 * f0, 0.035 * centre, 2.5 * df)))
        frame_peaks, frame_energy, frame_freqs = peak_track(target, halfwidth)
        finite = np.isfinite(frame_peaks)
        if finite.sum() < 4:
            continue
        med_peak = float(np.median(frame_peaks[finite]))
        med_amp = float(np.median(frame_energy[finite]))
        # SNR gate mirrors the long-window rule: the tracked level must
        # clear the local background magnitude around the harmonic
        i_lo = max(0, int((centre - 0.45 * f0) / df))
        i_hi = min(len(f) - 1, int((centre + 0.45 * f0) / df))
        if i_hi - i_lo < 3:
            continue
        local_med = float(np.median(mag[i_lo:i_hi, :])) + 1e-15
        if med_peak > 5 * local_med:
            amps[n - 1] = med_amp
            pfreqs[n - 1] = float(np.nanmedian(frame_freqs[finite]))
            ok[n - 1] = True
    if not ok.any():
        return None
    return amps, pfreqs, ok


def analyse_note(seg: np.ndarray, sr: int, fname: str, n_partials: int = 64,
                 min_detected_partials: int = 5):
    f0 = estimate_f0(seg, sr)
    if f0 is None or not (40 < f0 < 2500):
        return None
    env, hop = rms_envelope(seg, sr)
    t_env = np.arange(len(env)) * hop / sr
    peak_i = int(np.argmax(env))
    peak = float(env[peak_i])
    if peak <= 0:
        return None

    # onset: walk back from the peak to 2 % of peak
    onset_i = peak_i
    while onset_i > 0 and env[onset_i] > 0.02 * peak:
        onset_i -= 1
    onset_t = t_env[onset_i]

    # Percussive vs sustained: median level over the middle half of the note
    mid = env[len(env) // 4: 3 * len(env) // 4]
    sustain_ratio = float(np.median(mid)) / peak if mid.size else 0.0
    percussive = sustain_ratio < 0.35 and peak_i < len(env) // 4

    note = NoteAnalysis(file=fname, f0=f0, note=hz_to_note_name(f0),
                        dur_s=len(seg) / sr,
                        partial_amps=np.zeros(n_partials),
                        partial_freqs=np.full(n_partials, np.nan),
                        partial_snr_ok=np.zeros(n_partials, dtype=bool),
                        percussive=percussive)
    note.vowel = vowel_from_filename(fname)
    if note.vowel:
        formant_fit = estimate_formants(seg, sr)
        if formant_fit:
            note.formants, note.formant_bandwidths = formant_fit

    # ── partial amplitudes + frequencies ─────────────────────────────
    # Sustained: middle 50 % of the note.  Percussive: a fixed early
    # window so the fast-decaying top partials are still present.
    if percussive:
        a = int((onset_t + 0.04) * sr)
        b = min(len(seg), a + int(0.6 * sr))
    else:
        a, b = len(seg) // 4, 3 * len(seg) // 4
    y = seg[a:b]
    if len(y) < int(0.2 * sr):
        return None
    w = np.hanning(len(y))
    nfft = 1 << int(np.ceil(np.log2(len(y) * 4)))       # 4× zero-pad
    mag = np.abs(np.fft.rfft(y * w, nfft))
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    nyq_lim = 0.47 * sr

    def measure(B_guess: float):
        amps = np.zeros(n_partials)
        pfreqs = np.full(n_partials, np.nan)
        ok = np.zeros(n_partials, dtype=bool)
        for n in range(1, n_partials + 1):
            fn = partial_frequency(n, f0, B_guess)
            if fn > nyq_lim:
                break
            half = 0.42 * f0 * math.sqrt(1 + 3 * B_guess * n * n)
            pk = spectrum_peak(freqs, mag, fn - half, fn + half)
            if pk is None:
                continue
            pf, pa = pk
            # local SNR: peak must clear the median magnitude of its window
            i_lo = int(np.searchsorted(freqs, fn - half))
            i_hi = int(np.searchsorted(freqs, fn + half))
            local_med = float(np.median(mag[i_lo:i_hi])) + 1e-15
            if pa > 8 * local_med:                      # ≈ +18 dB
                amps[n - 1] = pa
                pfreqs[n - 1] = pf
                ok[n - 1] = True
        return amps, pfreqs, ok

    # Sustained notes use the vibrato-robust per-frame tracker; percussive
    # notes keep the early-window FFT (their partials decay too fast for a
    # frame median to mean anything).  The long-window `measure` remains the
    # fallback for segments too short to frame.
    def measure_best(B_guess: float):
        if not percussive:
            framed = harmonic_frame_amps(seg, sr, f0, n_partials, B_guess)
            if framed is not None:
                return framed
        return measure(B_guess)

    amps, pfreqs, ok = measure_best(0.0)
    B_fit = fit_inharmonicity(pfreqs, ok, f0)
    if B_fit is not None and B_fit > 1e-6:
        # second pass with widened, recentred search windows
        amps, pfreqs, ok = measure_best(B_fit)
        B2 = fit_inharmonicity(pfreqs, ok, f0)
        if B2 is not None:
            B_fit = B2
    # sanity: a real note must show its fundamental or 2nd partial plus a
    # few more — otherwise this segment is noise that fooled the f0 tracker
    if not (ok[0] or ok[1]) or ok.sum() < min_detected_partials:
        return None
    if amps.max() > 0:
        note.partial_amps = amps / amps.max()
    note.partial_freqs = pfreqs
    note.partial_snr_ok = ok
    note.B = B_fit

    # ── ADSR from the RMS envelope ────────────────────────────────────
    if percussive:
        # attack: onset → 90 % of peak (hammer/pluck: the peak IS the
        # attack).  The 20 ms analysis window above smears a hammer strike,
        # so re-measure on a fine (5 ms / 1 ms) envelope.
        fenv, fhop = rms_envelope(seg, sr, win_s=0.005, hop_s=0.001)
        fpk_i = int(np.argmax(fenv))
        fpk = float(fenv[fpk_i])
        j = fpk_i
        while j > 0 and fenv[j] > 0.02 * fpk:
            j -= 1
        j90 = j
        while j90 < len(fenv) and fenv[j90] < 0.9 * fpk:
            j90 += 1
        attack_s = max(0.0, (j90 - j) * fhop / sr)
        # No sustain plateau: express the decay the way the engine's ADSR
        # approximates a struck note — sustain = level 1 s after the peak,
        # decay = time to fall to it.
        i1s = min(len(env) - 1, peak_i + int(1.0 / (hop / sr)))
        sustain_lvl = float(env[i1s]) / peak
        decay_s = t_env[i1s] - t_env[peak_i]
        # release: tail from 10 % of peak down to 1 %
        i10 = len(env) - 1
        while i10 > peak_i and env[i10] < 0.1 * peak:
            i10 -= 1
        i01 = i10
        while i01 < len(env) - 1 and env[i01] > 0.01 * peak:
            i01 += 1
        release_s = max(0.0, t_env[i01] - t_env[i10])
    else:
        # Sustained notes: musicians often swell to a mid-note peak, so the
        # global peak is NOT the end of the attack.  Reference everything to
        # the sustain level (median over the middle half) instead, and to the
        # EARLY peak (within 1 s of onset) for the decay/sustain split.
        sus_abs = sustain_ratio * peak
        # attack: onset → first reach 90 % of the EARLY stable level
        # (median over onset+0.4 s … onset+0.8 s).  Referencing the mid-note
        # sustain would fold the player's crescendo into the "attack" (Iowa
        # players ease into mf notes), which is phrasing, not speak time.
        e_a = min(len(env) - 1, onset_i + int(0.4 / (hop / sr)))
        e_b = min(len(env), onset_i + int(0.8 / (hop / sr)))
        early_ref = float(np.median(env[e_a:e_b])) if e_b > e_a else sus_abs
        i90 = onset_i
        while i90 < len(env) and env[i90] < 0.9 * early_ref:
            i90 += 1
        attack_s = max(0.0, t_env[min(i90, len(env) - 1)] - onset_t)
        # decay: if there is an early overshoot above sustain, time from the
        # early peak back down to ~sustain; otherwise no measurable decay.
        early_end = min(len(env) - 1, onset_i + int(1.0 / (hop / sr)))
        i_epk = onset_i + int(np.argmax(env[onset_i:early_end + 1]))
        early_peak = float(env[i_epk])
        if early_peak > 1.15 * sus_abs:
            i_dec = i_epk
            while i_dec < len(env) and env[i_dec] > 1.05 * sus_abs:
                i_dec += 1
            decay_s = max(0.0, t_env[min(i_dec, len(env) - 1)] - t_env[i_epk])
        else:
            decay_s = 0.0
        sustain_lvl = sus_abs / max(early_peak, 1e-12)
        # release: last time above 70 % of sustain → fall to 5 % of sustain
        i_off = len(env) - 1
        while i_off > peak_i and env[i_off] < 0.7 * sus_abs:
            i_off -= 1
        i_end = i_off
        while i_end < len(env) - 1 and env[i_end] > 0.05 * sus_abs:
            i_end += 1
        release_s = max(0.0, t_env[i_end] - t_env[i_off])
    note.adsr = dict(attack=attack_s, decay=decay_s,
                     sustain=float(np.clip(sustain_lvl, 0, 1)), release=release_s)

    # ── per-octave-band time-to-90%-energy (attack stagger) ──────────
    note.band_t90 = band_attack_times(seg, sr, onset_t, percussive)

    # ── attack transient (→ attackNoise) ─────────────────────────────
    note.attack_noise = attack_transient(seg, sr, f0, note.B or 0.0, onset_t)

    # ── onset f0 trajectory (owner L5) ───────────────────────────────
    # Keep this distinct from the sustain-only vibrato estimator: a scoop is
    # a one-way pressure/tuning transient, not periodic modulation.
    note.onset_pitch = onset_pitch_stats(seg, sr, f0, onset_t,
                                         note.partial_amps)

    # ── per-partial decay → T60 ──────────────────────────────────────
    note.t60 = partial_t60(seg, sr, f0, note.B or 0.0, ok, percussive)

    # ── vibrato ───────────────────────────────────────────────────────
    if not percussive:
        note.vibrato = vibrato_stats(seg, sr, f0, note.partial_amps)

    return note


def onset_pitch_stats(seg: np.ndarray, sr: int, f0: float, onset_t: float,
                      amps: np.ndarray) -> dict:
    """Measure an onset approach from below and its settling time.

    The strongest of partials 1–3 is isolated before taking the analytic
    phase derivative.  Tracking a strong low partial makes the measurement
    usable for horn/reed notes whose fundamental is weak; the result is
    divided back to fundamental frequency before conversion to cents.
    """
    if len(seg) < int(.18 * sr) or not np.isfinite(f0) or f0 <= 0:
        return {}
    partials = np.asarray(amps[:3], dtype=float)
    harmonic = int(np.argmax(partials)) + 1 if partials.size else 1
    target = harmonic * f0
    nyquist = sr / 2
    # Keep adjacent harmonics outside the passband.  A fixed ±32 % window
    # works for a fundamental but overlaps the neighbours of harmonics 2–3,
    # making their changing amplitudes look like pitch motion.  Scale the
    # window with harmonic number while retaining enough bandwidth for the
    # largest onset approaches we accept (240 cents is about 15 %).
    fractional_band = min(.28, .48 / harmonic)
    low = max(20.0, target * (1 - fractional_band))
    high = min(nyquist * .94, target * (1 + fractional_band))
    if not low < high:
        return {}
    try:
        sos = sig.butter(4, [low, high], btype="bandpass", fs=sr,
                         output="sos")
        filtered = sig.sosfiltfilt(sos, np.asarray(seg, dtype=float))
    except ValueError:
        return {}
    analytic = sig.hilbert(filtered)
    magnitude = np.abs(analytic)
    phase = np.unwrap(np.angle(analytic))
    instantaneous = np.gradient(phase) * sr / (2 * np.pi) / harmonic

    # A 12–30 ms median rejects phase spikes while retaining the onset shape;
    # low notes need the longer end to cover at least a few cycles.
    smooth_s = min(.030, max(.012, 3 / max(f0, 1)))
    kernel = max(3, int(round(smooth_s * sr)) | 1)
    if kernel >= len(instantaneous):
        return {}
    instantaneous = sig.medfilt(instantaneous, kernel_size=kernel)
    times = np.arange(len(seg)) / sr
    sustain = ((times >= onset_t + .22) &
               (times <= min(times[-1] - .03, onset_t + .70)))
    if np.count_nonzero(sustain) < kernel:
        sustain = (times >= onset_t + .12) & (times <= times[-1] - .03)
    sustain_level = float(np.median(magnitude[sustain])) if np.any(sustain) else 0
    reliable = magnitude >= max(1e-10, sustain_level * .18)
    target_hz = float(np.median(instantaneous[sustain & reliable])) \
        if np.any(sustain & reliable) else math.nan
    if not np.isfinite(target_hz) or target_hz <= 0:
        return {}
    cents = 1200 * np.log2(np.clip(instantaneous, 1, None) / target_hz)
    onset = ((times >= onset_t + smooth_s / 2) &
             (times <= min(times[-1], onset_t + .20)) & reliable &
             (np.abs(cents) <= 240))
    indices = np.flatnonzero(onset)
    if indices.size < max(6, kernel // 6):
        return {}

    early_end = onset_t + min(.09, max(.04, 6 / max(f0, 1)))
    early = indices[times[indices] <= early_end]
    if early.size < 3:
        early = indices[:max(3, indices.size // 2)]
    low_cents = float(np.percentile(cents[early], 15))
    high_cents = float(np.percentile(cents[early], 85))
    # Bowed onsets wander around the target rather than scooping from below
    # (BOWED_PREFLIGHT P1: measure, don't assume the blown shape).  Keep the
    # blown depth/settle semantics untouched; wanderCents is additive.
    wander = float(max(abs(low_cents), abs(high_cents)))
    depth = max(0.0, -low_cents)
    if depth < 3.0:
        return {"depthCents": 0.0, "settleMs": 0.0, "wanderCents": wander,
                "direction": "stable", "harmonic": harmonic}

    threshold = max(5.0, depth * .15)
    hold = max(3, int(round(.020 * sr)))
    settle_ms = 200.0
    start = int(early[np.argmin(cents[early])])
    final = min(len(cents), int(round((onset_t + .30) * sr)))
    within = reliable & (np.abs(cents) <= threshold)
    for index in range(start, max(start, final - hold)):
        if np.all(within[index:index + hold]):
            settle_ms = max(0.0, (times[index] - onset_t) * 1000)
            break
    return {"depthCents": float(depth), "settleMs": float(settle_ms),
            "wanderCents": wander, "direction": "from-below",
            "harmonic": harmonic}


def fit_inharmonicity(pfreqs: np.ndarray, ok: np.ndarray, f0: float):
    """Least-squares fit of f_n² = u·n² + v·n⁴  (u = f0²/(1+B), v = B·u)
    → B = v/u.  Two stages: a low-partial fit (n ≤ 12, where even piano-sized
    B detunes < 3 %) seeds the model, then outliers are rejected RELATIVE TO
    that model and all partials n ≤ 40 are refit — a naive absolute gate at
    high n would reject precisely the stretched partials that carry the B
    signal.  Returns B or None."""

    def lstsq_B(ns, f):
        A = np.stack([ns.astype(float) ** 2, ns.astype(float) ** 4], axis=1)
        coef, *_ = np.linalg.lstsq(A, f ** 2, rcond=None)
        u, v = coef
        if u <= 0:
            return None
        return float(max(0.0, v / u))

    ns_all = np.where(ok[:40])[0] + 1
    f_all = pfreqs[ns_all - 1]
    # stage 1: low partials, absolute gate (harmonic to < 3 % there)
    low = (ns_all <= 12) & (np.abs(f_all / (ns_all * f0) - 1) < 0.05)
    if low.sum() < 5:
        return None
    B1 = lstsq_B(ns_all[low], f_all[low])
    if B1 is None:
        return None
    # stage 2: gate TIGHTLY against the stage-1 model, refit with everything
    # that agrees with it (mis-picked peaks — noise grabbed when the true
    # stretched partial fell outside the search window — land far from the
    # model and must not re-enter the fit).
    model = np.array([partial_frequency(int(n), f0, B1) for n in ns_all])
    keep = np.abs(f_all - model) < np.minimum(0.35 * f0, 0.012 * ns_all * f0 + 3.0)
    if keep.sum() < 6:
        return B1
    B2 = lstsq_B(ns_all[keep], f_all[keep])
    return B2 if B2 is not None else B1


def band_attack_times(seg: np.ndarray, sr: int, onset_t: float, percussive: bool):
    """Time from note onset to 90 % of each octave band's reference level.

    Reference level = the band's own EARLY-sustain level (median over
    onset+0.25 s … onset+0.60 s) for sustained instruments — using the
    mid-note level would conflate the player's musical swell with the
    attack — or the band's own peak for percussive notes.
    Answers "does the top of the spectrum arrive late?"
    """
    out = {}
    for fc in (125, 250, 500, 1000, 2000, 4000, 8000):
        lo, hi = fc / math.sqrt(2), fc * math.sqrt(2)
        if hi > 0.45 * sr:
            continue
        sos = sig.butter(4, [lo, hi], btype="bandpass", fs=sr, output="sos")
        y = sig.sosfilt(sos, seg)
        env, hop = rms_envelope(y, sr, win_s=0.010, hop_s=0.0025)
        t = np.arange(len(env)) * hop / sr
        n0 = int(onset_t / (hop / sr))
        if percussive:
            ref = float(env[n0:].max()) if n0 < len(env) else 0.0
        else:
            a = min(len(env) - 1, n0 + int(0.25 / (hop / sr)))
            b = min(len(env), n0 + int(0.60 / (hop / sr)))
            ref = float(np.median(env[a:b])) if b > a else 0.0
        if ref <= 0:
            continue
        idx = np.where(env[n0:] >= 0.9 * ref)[0]
        if idx.size == 0:
            continue
        out[fc] = dict(t90=float(t[n0 + idx[0]] - onset_t), level=ref)
    if out:
        strongest = max(v["level"] for v in out.values())
        out = {fc: v for fc, v in out.items()
               if v["level"] > strongest * 10 ** (-55 / 20)}
    return out


def attack_transient(seg: np.ndarray, sr: int, f0: float, B: float, onset_t: float):
    """Fit the attackNoise block: the NON-harmonic energy of the onset.

    STFT over the attack; bins within ±3 bins ∪ ±3 % of every partial are
    masked out; what remains (minus the steady-state noise bed measured
    mid-note) is the transient.  Returns {level, freq, q, decay} in engine
    units plus diagnostics.
    """
    nper = 2048
    f, t, Z = sig.stft(seg, fs=sr, nperseg=nper, noverlap=nper - 256,
                       window="hann", padded=False, boundary=None)
    P = np.abs(Z) ** 2
    # harmonic mask
    mask = np.zeros(len(f), dtype=bool)
    df = f[1] - f[0]
    for n in range(1, 80):
        fn = partial_frequency(n, f0, B)
        if fn > f[-1]:
            break
        half = max(3 * df, 0.03 * fn)
        mask |= np.abs(f - fn) <= half
    band = (f >= 100) & (f <= 10000) & ~mask
    if not band.any():
        return {}
    on = int(np.searchsorted(t, onset_t))
    att = (t >= onset_t) & (t <= onset_t + 0.12)
    mid = slice(len(t) // 3, 2 * len(t) // 3)
    if not att.any():
        return {}
    noise_att = P[np.ix_(band, att)].mean(axis=1)
    noise_bed = P[band, :][:, mid].mean(axis=1)
    excess = np.clip(noise_att - noise_bed, 0, None)
    tot = excess.sum()
    if tot <= 0:
        return {}
    fb = f[band]
    centroid = float((fb * excess).sum() / tot)
    spread = float(np.sqrt(((fb - centroid) ** 2 * excess).sum() / tot))
    q = centroid / max(1.0, 2.355 * spread)            # −3 dB-equivalent Q
    # level: transient noise RMS vs harmonic RMS.  Reference the harmonic
    # track's upper quartile over the WHOLE note (for a decaying note the
    # mid-note harmonic level has already fallen and would inflate the ratio).
    harm_track = P[mask & (f <= 10000), :].sum(axis=0)
    harm_ref = math.sqrt(float(np.percentile(harm_track, 75))) if harm_track.size else 0.0
    level = math.sqrt(float(excess.sum())) / max(harm_ref, 1e-12)
    # decay: broadband noise-excess energy per frame after its peak;
    # slope in dB/s over the first 20 dB → time to fall 50 dB (the engine
    # ramps its burst to −50 dB-ish of peak over `decay` seconds).
    tr = np.clip(P[band, :].sum(axis=0) - np.median(P[band, :][:, mid].sum(axis=0)),
                 1e-20, None)
    pk = int(np.argmax(tr[att])) + int(np.argmax(att))
    tail_t, tail_v = [], []
    pk_db = 10 * math.log10(tr[pk])
    for i in range(pk, min(len(t), pk + int(0.4 / (t[1] - t[0])))):
        db = 10 * math.log10(tr[i])
        if db < pk_db - 25:
            break
        tail_t.append(t[i]); tail_v.append(db)
    decay = None
    if len(tail_t) >= 4:
        sl = np.polyfit(tail_t, tail_v, 1)[0]          # dB/s (negative)
        if sl < -20:
            decay = float(np.clip(50.0 / -sl, 0.015, 0.25))
    return dict(freq=centroid, q=float(np.clip(q, 0.3, 2.5)),
                level=float(level), decay=decay, bandwidth=spread)


def partial_t60(seg: np.ndarray, sr: int, f0: float, B: float,
                ok: np.ndarray, percussive: bool):
    """Per-partial decay times.

    Percussive notes: linear fit to the dB magnitude track over the free
    decay → true T60 (kind='decay').  Sustained notes: same fit over the
    release tail (kind='release') — damped by the player, so only a lower
    bound on the free T60; used qualitatively.
    """
    nper = 4096
    f, t, Z = sig.stft(seg, fs=sr, nperseg=nper, noverlap=nper - 1024,
                       window="hann", padded=False, boundary=None)
    P = np.abs(Z) ** 2
    df = f[1] - f[0]
    out = []
    total = P.sum(axis=0)
    peak_fr = int(np.argmax(total))
    floor_db = 10 * math.log10(max(np.percentile(total, 5), 1e-20))
    for n in range(1, 41):
        if n - 1 >= len(ok) or not ok[n - 1]:
            continue
        fn = partial_frequency(n, f0, B)
        if fn > 0.45 * sr:
            break
        i0 = max(0, int((fn - 2 * df) / df))
        i1 = min(len(f), int((fn + 2 * df) / df) + 1)
        track = P[i0:i1, :].sum(axis=0)
        trk_db = 10 * np.log10(np.clip(track, 1e-20, None))
        pk = int(np.argmax(trk_db))
        pk_db = trk_db[pk]
        noise_db = float(np.percentile(trk_db, 8))
        if pk_db - noise_db < 15:
            continue
        if percussive:
            # Free decay, first-crossing estimator: time for the (smoothed)
            # track to fall 25 dB below its peak and STAY down for 0.5 s,
            # then T60 = (60/25)·t25.  This is robust to the two artefacts
            # that break a naive line fit here: unison-string beating (a
            # beat dip that recovers is not accepted as the crossing) and
            # piano double-decay (the estimate reflects the stage that
            # actually carries the first 25 dB — the audible one).
            if pk_db - noise_db < 31:
                continue
            ksm = max(1, int(0.15 / (t[1] - t[0])) | 1)
            sm = sig.medfilt(trk_db, ksm)
            target = pk_db - 25
            hold = max(1, int(0.5 / (t[1] - t[0])))
            cross = None
            i = pk + 1
            while i < len(t):
                if sm[i] <= target:
                    j_end = min(len(t), i + hold)
                    if np.all(sm[i:j_end] <= target + 2):
                        cross = i
                        break
                i += 1
            if cross is None:
                continue
            t25 = t[cross] - t[pk]
            if t25 > 0.05:
                out.append((fn, float(t25 * 60.0 / 25.0), "decay"))
        else:
            # release tail: from the last sustained frame to the floor
            sus_db = float(np.median(trk_db[len(t) // 3: 2 * len(t) // 3]))
            off = len(t) - 1
            while off > peak_fr and trk_db[off] < sus_db - 10:
                off -= 1
            stop = off
            while stop < len(t) and trk_db[stop] > noise_db + 6:
                stop += 1
            if stop - off < 5:
                continue
            span = slice(off, stop)
            sl = np.polyfit(t[span], trk_db[span], 1)[0]
            if sl < -10:
                out.append((fn, float(60.0 / -sl), "release"))
    return out


def vibrato_stats(seg: np.ndarray, sr: int, f0: float, amps: np.ndarray):
    """Vibrato rate (Hz) and depth (± cents) from the instantaneous
    frequency of the strongest low partial over the sustain."""
    # pick the strongest of partials 1–3 for tracking
    k = int(np.argmax(amps[:3])) + 1
    target = k * f0
    nper = 4096
    f, t, Z = sig.stft(seg, fs=sr, nperseg=nper, noverlap=nper - 512,
                       window="hann", padded=False, boundary=None)
    mag = np.abs(Z)
    df = f[1] - f[0]
    i0 = max(1, int((target - 0.45 * f0) / df))
    i1 = min(len(f) - 1, int((target + 0.45 * f0) / df))
    if i1 - i0 < 3:
        return {}
    sub = mag[i0:i1, :]
    kk = np.argmax(sub, axis=0) + i0
    # parabolic interp of the tracked bin per frame
    a = mag[np.maximum(kk - 1, 0), np.arange(len(t))]
    b = mag[kk, np.arange(len(t))]
    c = mag[np.minimum(kk + 1, len(f) - 1), np.arange(len(t))]
    la, lb, lc = (np.log(np.clip(v, 1e-12, None)) for v in (a, b, c))
    den = la - 2 * lb + lc
    with np.errstate(divide="ignore", invalid="ignore"):
        delta = np.where(np.abs(den) > 1e-9, 0.5 * (la - lc) / den, 0.0)
    delta = np.nan_to_num(delta)
    fi = (kk + np.clip(delta, -0.5, 0.5)) * df
    fi_all = fi.copy()          # full-note track for onset-trajectory stats
    amp_track = b.copy()        # tracked-partial magnitude per frame (body AM)
    # sustain region only
    s0, s1 = len(t) // 5, 4 * len(t) // 5
    fi = fi[s0:s1]
    tt = t[s0:s1]
    if len(fi) < 32:
        return {}
    cents = 1200 * np.log2(np.clip(fi, 1, None) / np.median(fi))
    cents = cents[np.abs(cents) < 120]                 # drop track glitches
    if len(cents) < 32:
        return {}
    frame_rate = 1.0 / (tt[1] - tt[0])
    # detrend with a 0.7 s moving average, then find the modulation peak
    w = max(3, int(0.7 * frame_rate) | 1)
    w = min(w, (len(cents) // 2) * 2 - 1)   # keep window shorter than track
    trend = np.convolve(cents, np.ones(w) / w, mode="same")
    d = (cents - trend) * np.hanning(len(cents))
    spec = np.abs(np.fft.rfft(d, 4 * len(d)))
    fax = np.fft.rfftfreq(4 * len(d), 1 / frame_rate)
    band = (fax >= 3.0) & (fax <= 9.0)
    if not band.any():
        return {}
    pk = int(np.argmax(spec[band]))
    rate = float(fax[band][pk])
    # peak prominence vs the rest of the 0.5–15 Hz range
    ref = float(np.median(spec[(fax >= 0.5) & (fax <= 15)]) + 1e-12)
    prominent = spec[band][pk] > 4 * ref
    depth = float(np.sqrt(2) * np.std(cents - trend))  # ≈ sinusoid peak dev
    # short notes have poor modulation-spectrum resolution, so also accept
    # unambiguous depth without the prominence test
    present = (prominent and depth > 3.0) or depth > 12.0
    half = max(1, w // 2)
    slow = trend[half:-half] if len(trend) > 2 * half else trend
    slow_t = tt[half:half + len(slow)] if len(tt) >= half + len(slow) else np.arange(len(slow)) / frame_rate
    drift_sd = float(np.std(slow)) if len(slow) else 0.0
    drift_range = float(np.percentile(slow, 95) - np.percentile(slow, 5)) if len(slow) >= 8 else 0.0
    drift_rate = float(np.polyfit(slow_t, slow, 1)[0]) if len(slow) >= 8 else 0.0
    result = dict(rate=rate, depth=depth, present=bool(present),
                  microDriftCentsSd=drift_sd, microDriftCentsRange=drift_range,
                  microDriftCentsPerSecond=drift_rate)

    # ── vibrato trajectory + body AM (bowed P1; additive keys) ────────
    # A static rate/depth pair renders mechanical vibrato: real string
    # vibrato starts after the note settles, ramps its depth in, drifts its
    # rate, and is heard as much through body-filtered AM as through FM.
    # These keys are additive — existing consumers are untouched.
    if present:
        ref_hz = float(np.median(fi))
        with np.errstate(divide="ignore", invalid="ignore"):
            cents_full = 1200 * np.log2(np.clip(fi_all, 1, None) / max(ref_hz, 1))
        cents_full = np.where(np.abs(cents_full) < 150, cents_full, np.nan)
        idx = np.arange(len(cents_full))
        finite = np.isfinite(cents_full)
        if finite.sum() >= 16:
            cents_full = np.interp(idx, idx[finite], cents_full[finite])
            w_full = min(max(3, int(0.7 * frame_rate) | 1),
                         (len(cents_full) // 2) * 2 - 1)
            trend_full = np.convolve(cents_full, np.ones(w_full) / w_full,
                                     mode="same")
            detrended = cents_full - trend_full
            win = max(3, int(0.4 * frame_rate) | 1)
            half_win = win // 2
            depth_t = np.zeros(len(detrended))
            for j in range(len(detrended)):
                lo_j = max(0, j - half_win)
                seg_d = detrended[lo_j:j + half_win + 1]
                depth_t[j] = math.sqrt(2) * float(np.std(seg_d))
            hold = max(2, int(0.2 * frame_rate))
            onset_delay_ms = None
            ramp_ms = None
            for j in range(len(depth_t) - hold):
                if float(np.mean(depth_t[j:j + hold])) >= 0.5 * depth:
                    onset_delay_ms = float(t[j] * 1000)
                    for j2 in range(j, len(depth_t) - hold):
                        if float(np.mean(depth_t[j2:j2 + hold])) >= 0.8 * depth:
                            ramp_ms = float(max(0.0, (t[j2] - t[j]) * 1000))
                            break
                    break
            if onset_delay_ms is not None:
                result["onsetDelayMs"] = onset_delay_ms
            if ramp_ms is not None:
                result["depthRampMs"] = ramp_ms

        # rate drift: modulation-spectrum rate of each sustain half
        def _mod_rate(track: np.ndarray) -> float | None:
            if len(track) < 32:
                return None
            windowed = (track - np.mean(track)) * np.hanning(len(track))
            spec_h = np.abs(np.fft.rfft(windowed, 4 * len(windowed)))
            fax_h = np.fft.rfftfreq(4 * len(windowed), 1 / frame_rate)
            band_h = (fax_h >= 3.0) & (fax_h <= 9.0)
            if not band_h.any():
                return None
            return float(fax_h[band_h][int(np.argmax(spec_h[band_h]))])

        detr_sus = cents - trend
        half_len = len(detr_sus) // 2
        rate_a = _mod_rate(detr_sus[:half_len])
        rate_b = _mod_rate(detr_sus[half_len:])
        span_s = float(tt[-1] - tt[0]) if len(tt) >= 2 else 0.0
        if rate_a is not None and rate_b is not None and span_s > 0.2:
            result["rateDriftHzPerSecond"] = float((rate_b - rate_a) / (span_s / 2))

        # body AM: the tracked partial's level modulation at the vibrato
        # rate (FM through fixed body slopes reads as AM — engine T5)
        am_db = 20 * np.log10(np.clip(amp_track[s0:s1], 1e-12, None))
        if len(am_db) >= 32:
            w_am = min(max(3, int(0.7 * frame_rate) | 1),
                       (len(am_db) // 2) * 2 - 1)
            am_trend = np.convolve(am_db, np.ones(w_am) / w_am, mode="same")
            am_detr = am_db - am_trend
            phase_arg = 2 * np.pi * rate * tt[:len(am_detr)]
            am_depth = 2 * abs(np.mean(am_detr * np.exp(-1j * phase_arg)))
            result["bodyAmDepthDb"] = float(am_depth)
    return result


# ──────────────────────────────────────────────────────────────────────────
# Aggregation across notes → engine-shaped parameters
# ──────────────────────────────────────────────────────────────────────────

def fit_material(t60_points: list[tuple[float, float, str]]):
    """Fit T60(f) = t60Ref·(f/261.63)^(−slope) and pick the engine material
    m∈[0,1] whose materialT60 curve best matches (log-domain grid search)."""
    pts = [(f, t) for f, t, kind in t60_points if kind == "decay" and 0.05 < t < 60]
    basis = "struck free decay"
    if len(pts) < 5:
        pts = [(f, t) for f, t, kind in t60_points if 0.02 < t < 60]
        basis = "release tails (player-damped: lower bound on free T60)"
    if len(pts) < 4:
        return None
    fr = np.array([p[0] for p in pts])
    tv = np.array([p[1] for p in pts])
    X = np.log(fr / REF_HZ)
    Y = np.log(tv)
    # Theil–Sen (median of pairwise slopes): individual T60 estimates are
    # noisy (beating, double decay), so an outlier-robust fit is essential.
    ii, jj = np.triu_indices(len(X), k=1)
    dx = X[ii] - X[jj]
    good = np.abs(dx) > 0.05
    slope_fit = float(np.median((Y[ii][good] - Y[jj][good]) / dx[good]))
    icpt = float(np.median(Y - slope_fit * X))
    t60_ref = float(math.exp(icpt))
    slope = float(-slope_fit)
    # engine-material grid search on the same points
    grid = np.linspace(0, 1, 101)
    errs = [np.median((np.log([engine_t60(f, m) for f in fr]) - Y) ** 2) for m in grid]
    m_best = float(grid[int(np.argmin(errs))])
    return dict(t60Ref=t60_ref, slope=slope, suggestedMaterial=m_best,
                nPoints=len(pts), basis=basis,
                freqRangeHz=[float(fr.min()), float(fr.max())])


def robust_mean(vals):
    """Median of the finite values (None when empty)."""
    v = np.asarray([x for x in vals if x is not None and np.isfinite(x)])
    if v.size == 0:
        return None
    return float(np.median(v))


def _body_points(notes: list[NoteAnalysis], n_partials: int):
    """(note, rank, log2 Hz, ln amp) tuples for detected in-range partials."""
    rows = []
    for note_index, note in enumerate(notes):
        for rank in range(n_partials):
            amp = float(note.partial_amps[rank])
            if not note.partial_snr_ok[rank] or amp <= 1e-4:
                continue
            freq = float(note.partial_freqs[rank])
            if not np.isfinite(freq) or freq <= 0:
                freq = note.f0 * (rank + 1)
            if 70 <= freq <= 12000:
                rows.append((note_index, rank, math.log2(freq), math.log(amp)))
    return rows


def _solve_body(rows, n_notes: int, n_partials: int, centres: np.ndarray,
                width: float, iters: int = 5, ridge: float = 8.0):
    """Alternating rank/note/body fit; returns band coefficients (log2)."""
    note_i = np.asarray([r[0] for r in rows], dtype=int)
    rank_i = np.asarray([r[1] for r in rows], dtype=int)
    log_hz = np.asarray([r[2] for r in rows])
    level = np.asarray([r[3] for r in rows])
    basis = np.exp(-.5 * ((log_hz[:, None] - centres[None, :]) / width) ** 2)
    rank_effect = np.zeros(n_partials)
    for rank in range(n_partials):
        vals = level[rank_i == rank]
        rank_effect[rank] = float(np.median(vals)) if vals.size else 0.0
    body = np.zeros(len(level))
    note_effect = np.zeros(n_notes)
    coeff = np.zeros(len(centres))
    mean_basis = np.mean(basis, axis=0)
    for _ in range(iters):
        residual = level - rank_effect[rank_i] - body
        for index in range(n_notes):
            vals = residual[note_i == index]
            note_effect[index] = float(np.median(vals)) if vals.size else 0.0
        target = level - rank_effect[rank_i] - note_effect[note_i]
        # The overlapping Gaussian basis is intentionally smooth.  Ridge
        # regularisation prevents adjacent bands from taking huge opposite
        # gains to explain individual partials (which belong to excitation).
        coeff = np.linalg.solve(
            basis.T @ basis + ridge * np.eye(len(centres)) +
            20.0 * np.outer(mean_basis, mean_basis),
            basis.T @ target)
        body = basis @ coeff
        body -= float(np.median(body))
        for rank in range(n_partials):
            vals = (level - body - note_effect[note_i])[rank_i == rank]
            if vals.size:
                rank_effect[rank] = float(np.median(vals))
    return np.clip(coeff / math.log(2), -1.5, 1.5)


def _band_envelope(coeff_log2: np.ndarray, centres: np.ndarray, width: float,
                   grid_log2: np.ndarray) -> np.ndarray:
    basis = np.exp(-.5 * ((grid_log2[:, None] - centres[None, :]) / width) ** 2)
    return basis @ coeff_log2


def fit_fixed_body(notes: list[NoteAnalysis], n_partials: int):
    """Separate a smooth fixed-Hz body envelope from partial-rank excitation.

    The same body resonance crosses different harmonic ranks as pitch changes.
    Alternating robust fits therefore separate rank, note-level and absolute-
    frequency effects without treating a register table as the body.  The body
    is represented in the engine's native log2-Gaussian band format; the
    returned matrix is the body-divided source spectrum used for partial fits.

    Band resolution is ~1/3 octave: the violin split-half experiment
    (2026-07-16) showed the fixed-Hz structure replicates across corpus
    halves at that scale and degrades below it, so finer bands would encode
    take noise as body.  Returns (bands, adjusted, fit_info); fit_info is the
    provenance record stored beside the resonances (method, evidence counts,
    split-half stability) so a profile always names how its body was fitted.
    """
    raw = np.stack([n.partial_amps for n in notes]) if notes else np.zeros((0, n_partials))
    if len(notes) < 8:
        return [], raw, None
    rows = _body_points(notes, n_partials)
    if len(rows) < 80:
        return [], raw, None
    log_hz = np.asarray([r[2] for r in rows])
    lo = max(math.log2(100), float(np.percentile(log_hz, 3)))
    hi = min(math.log2(9000), float(np.percentile(log_hz, 97)))
    if hi - lo < 1.5:
        return [], raw, None
    n_bands = int(np.clip(round((hi - lo) * 3) + 1, 5, 16))
    centres = np.linspace(lo, hi, n_bands)
    spacing = (hi - lo) / max(1, n_bands - 1)
    width = float(max(.14, min(.62, spacing * .55)))
    coeff_log2 = _solve_body(rows, len(notes), n_partials, centres, width)

    # Split-half stability: refit on alternating file halves with the SAME
    # bands and correlate the envelopes.  This is the "body peaks sit at
    # note-independent frequencies" validation, demonstrated per fit rather
    # than asserted once.
    stability = None
    files = sorted({n.file for n in notes})
    if len(files) >= 4:
        half = set(files[0::2])
        idx_a = [i for i, n in enumerate(notes) if n.file in half]
        idx_b = [i for i, n in enumerate(notes) if n.file not in half]
        remap_a = {v: k for k, v in enumerate(idx_a)}
        remap_b = {v: k for k, v in enumerate(idx_b)}
        rows_a = [(remap_a[r[0]], r[1], r[2], r[3]) for r in rows if r[0] in remap_a]
        rows_b = [(remap_b[r[0]], r[1], r[2], r[3]) for r in rows if r[0] in remap_b]
        if len(rows_a) >= 40 and len(rows_b) >= 40:
            ca = _solve_body(rows_a, len(idx_a), n_partials, centres, width)
            cb = _solve_body(rows_b, len(idx_b), n_partials, centres, width)
            grid = np.linspace(lo, hi, 160)
            ea = _band_envelope(ca, centres, width, grid)
            eb = _band_envelope(cb, centres, width, grid)
            if float(np.std(ea)) > 1e-6 and float(np.std(eb)) > 1e-6:
                corr = float(np.corrcoef(ea, eb)[0, 1])
                stability = dict(
                    splitHalfCorr=round(corr, 3),
                    peakHzA=round(2 ** float(grid[int(np.argmax(ea))]), 1),
                    peakHzB=round(2 ** float(grid[int(np.argmax(eb))]), 1))

    # Negligible envelopes are omitted so a new family remains neutral until
    # its own corpus demonstrates a fixed-Hz body.
    grid = np.linspace(lo, hi, 160)
    if float(np.ptp(_band_envelope(coeff_log2, centres, width, grid))) < .12:
        return [], raw, None
    bands = [dict(freq=round(2 ** float(center), 1),
                  gain=round(float(gain), 4), width=round(float(width), 4))
             for center, gain in zip(centres, coeff_log2)
             if abs(gain) >= .025]
    fit_info = dict(method="ensemble-rank-note-body-v2",
                    bands=len(bands), points=len(rows), notes=len(notes),
                    widthLog2=round(width, 4))
    if stability:
        fit_info.update(stability)

    adjusted = raw.astype(float).copy()
    for note_index, note in enumerate(notes):
        for rank in range(n_partials):
            if adjusted[note_index, rank] <= 0:
                continue
            freq = float(note.partial_freqs[rank])
            if not np.isfinite(freq) or freq <= 0:
                freq = note.f0 * (rank + 1)
            g = np.exp(-.5 * ((math.log2(max(20, freq)) - centres) / width) ** 2)
            body_gain = float(2 ** np.dot(coeff_log2, g))
            adjusted[note_index, rank] /= max(.2, min(4.5, body_gain))
        peak = float(adjusted[note_index].max())
        if peak > 0:
            adjusted[note_index] /= peak
    return bands, adjusted, fit_info


def fit_take_spread(notes: list[NoteAnalysis], A: np.ndarray, OK: np.ndarray,
                    n_partials: int):
    """Per-partial take variability from WITHIN-FILE adjacent-note pairs.

    The historical estimator pooled every take into one pitch-ordered chain,
    so successive diffs jumped between dynamics, strings and sources — it
    measured corpus heterogeneity, not note-to-note variability, and pinned
    every instrument's spread at the 0.8 cap.  Restrict pairs to the same
    file (same source, string and dynamic for the Iowa chromatic runs) and
    remove each pair's common level offset before pooling.

    Returns (spread list with None gaps, pair count).
    """
    by_file: dict[str, list[int]] = {}
    for idx, note in enumerate(notes):
        by_file.setdefault(note.file, []).append(idx)
    diffs: list[list[float]] = [[] for _ in range(n_partials)]
    pairs = 0
    for indices in by_file.values():
        indices = sorted(indices, key=lambda i: notes[i].f0)
        for a, b in zip(indices[:-1], indices[1:]):
            both = OK[a] & OK[b] & (A[a] > 0) & (A[b] > 0)
            ranks = np.where(both)[0]
            if ranks.size < 4:
                continue
            d = np.log(A[b, ranks]) - np.log(A[a, ranks])
            d = d - float(np.median(d))
            pairs += 1
            for rank, dv in zip(ranks, d):
                diffs[rank].append(float(dv))
    spread: list[float | None] = [None] * n_partials
    for i in range(n_partials):
        if len(diffs[i]) >= 6:
            # a diff of two takes has variance 2·sd²; engine spread = 2·rel_sd
            rel_sd = float(np.std(diffs[i], ddof=1) / math.sqrt(2))
            spread[i] = float(np.clip(2 * rel_sd, 0.08, 0.8))
    return spread, pairs


def aggregate_instrument(notes: list[NoteAnalysis], vib_notes: list[NoteAnalysis],
                         n_partials: int, min_amp_f0: float = 40.0):
    """Combine per-note measurements into one engine-shaped record."""
    # analyse_note already rejects f0 <= 40 Hz.  The historical 100 Hz
    # spectral cutoff silently removed the practical low register of horn,
    # cello, bass voice and future contrabass targets from G1 fitting.
    spec_notes = [n for n in notes if n.f0 >= min_amp_f0]
    if not spec_notes:
        spec_notes = notes

    # ── 64-partial amplitude table ────────────────────────────────────
    resonances, A, resonances_fit = fit_fixed_body(spec_notes, n_partials)
    OK = np.stack([n.partial_snr_ok for n in spec_notes])
    spec_index = {id(note): index for index, note in enumerate(spec_notes)}
    logf0 = np.log([n.f0 for n in spec_notes])
    amp = np.zeros(n_partials)
    for i in range(n_partials):
        det = A[OK[:, i] & (A[:, i] > 0), i]
        if det.size:
            amp[i] = float(np.median(det))
    if amp.max() > 0:
        amp = amp / amp.max()

    # Take variability from same-file (same string/dynamic/source) pairs.
    spread, spread_pairs = fit_take_spread(spec_notes, A, OK, n_partials)
    if spread_pairs < 3:
        # single-note-per-file corpus: fall back to the pooled pitch-ordered
        # diff chain rather than fabricating defaults from nothing
        for i in range(n_partials):
            sel = OK[:, i] & (A[:, i] > 0)
            det = A[sel, i]
            if det.size >= 4:
                order = np.argsort(logf0[sel])
                la = np.log(det)[order]
                rel_sd = float(np.std(np.diff(la), ddof=1) / math.sqrt(2)) \
                    if la.size >= 3 else float(np.std(la, ddof=1))
                spread[i] = float(np.clip(2 * rel_sd, 0.08, 0.8))
    # fill spread gaps with the engine's tail rule (+0.04 per stride-2 step)
    last = 0.25
    for i in range(n_partials):
        if spread[i] is None:
            ref = spread[i - 2] if i >= 2 and spread[i - 2] is not None else last
            spread[i] = float(min(0.8, ref + 0.04))
        last = spread[i]

    # G1 register storage: three log-f0 regions retain the measured source
    # spectrum instead of collapsing the whole instrument into one table.
    # The engine interpolates these anchors continuously; instruments with
    # fewer than three analysed pitches simply omit the field.
    partials_by_register = []
    register_groups = []
    if len(spec_notes) >= 3:
        ordered = sorted(spec_notes, key=lambda item: item.f0)
        register_groups = [list(group) for group in
                           np.array_split(np.asarray(ordered, dtype=object),
                                          min(3, len(ordered))) if len(group)]
        for group in register_groups:
            group = list(group)
            g_amp = np.zeros(n_partials)
            g_spread = []
            for i in range(n_partials):
                detected = [A[spec_index[id(n)], i] for n in group
                            if n.partial_snr_ok[i] and A[spec_index[id(n)], i] > 0]
                g_amp[i] = float(np.median(detected)) if detected else 0.0
                g_spread.append(float(spread[i]))
            if g_amp.max() > 0:
                g_amp /= g_amp.max()
            g_b = robust_mean([n.B for n in group if n.B is not None])
            partials_by_register.append(dict(
                f0=round(float(np.exp(np.mean(np.log([n.f0 for n in group])))), 3),
                partialB=round(float(g_b), 8) if g_b is not None else None,
                partials=[dict(amp=round(float(a), 5), spread=round(float(s), 3))
                          for a, s in zip(g_amp, g_spread)],
            ))

    # tail slope diagnostic: dB/octave of harmonic rank over n ≥ 8
    det_idx = [i for i in range(7, n_partials) if amp[i] > 0]
    tail_db_oct = None
    if len(det_idx) >= 4:
        xs = np.log2([i + 1 for i in det_idx])
        ys = 20 * np.log10(amp[det_idx])
        tail_db_oct = float(np.polyfit(xs, ys, 1)[0])

    # ── inharmonicity ─────────────────────────────────────────────────
    # The preset B is the MID-REGISTER value (B varies per string on a
    # piano); bass notes are reported individually in partialBByNote.
    Bs = [n.B for n in spec_notes if n.B is not None]
    B_med = robust_mean(Bs) or 0.0
    B_by_note = [dict(note=n.note, f0=round(n.f0, 2),
                      B=(round(n.B, 8) if n.B is not None else None))
                 for n in notes]

    # ── material / T60 ────────────────────────────────────────────────
    all_t60 = [p for n in notes for p in n.t60]
    material = fit_material(all_t60)

    # ── ADSR ──────────────────────────────────────────────────────────
    adsr = {}
    for k in ("attack", "decay", "sustain", "release"):
        vals = [n.adsr.get(k) for n in notes if n.adsr]
        adsr[k] = robust_mean(vals)
    attack_sd = None
    a_vals = [n.adsr.get("attack") for n in notes if n.adsr.get("attack") is not None]
    if len(a_vals) >= 4:
        attack_sd = float(np.std(a_vals, ddof=1))

    # ── attack stagger (per octave band) ─────────────────────────────
    bands = sorted({fc for n in notes for fc in n.band_t90})
    band_t90 = {}
    for fc in bands:
        vals = [n.band_t90[fc]["t90"] for n in notes if fc in n.band_t90]
        if len(vals) >= max(2, len(notes) // 3):
            band_t90[fc] = robust_mean(vals)
    stagger_ms = None
    if len(band_t90) >= 2:
        fcs = sorted(band_t90)
        lows = [band_t90[fc] for fc in fcs[:2]]
        highs = [band_t90[fc] for fc in fcs[-2:]]
        stagger_ms = float((np.mean(highs) - np.mean(lows)) * 1000)

    # WP-3 retains the same onset evidence per log-frequency register as the
    # partial tables.  A single whole-instrument stagger can hide a real
    # register transition (especially in brass), so ship the band timing and
    # ADSR attack at each measured anchor as well as the global diagnostic.
    attack_by_register = []
    for group in register_groups:
        group_bands = sorted({fc for n in group for fc in n.band_t90})
        group_t90 = {}
        for fc in group_bands:
            vals = [n.band_t90[fc]["t90"] for n in group if fc in n.band_t90]
            if len(vals) >= max(2, len(group) // 3):
                group_t90[fc] = robust_mean(vals)
        group_stagger_ms = None
        if len(group_t90) >= 2:
            fcs = sorted(group_t90)
            lows = [group_t90[fc] for fc in fcs[:2]]
            highs = [group_t90[fc] for fc in fcs[-2:]]
            group_stagger_ms = float((np.mean(highs) - np.mean(lows)) * 1000)
        group_attacks = [n.adsr.get("attack") for n in group
                         if n.adsr.get("attack") is not None]
        if group_t90 or group_attacks:
            attack_by_register.append(dict(
                f0=round(float(np.exp(np.mean(np.log([n.f0 for n in group])))), 3),
                envelopeAttack=(round(float(robust_mean(group_attacks)), 4)
                                if group_attacks else None),
                bandT90ms={str(fc): round(v * 1000, 1)
                           for fc, v in group_t90.items()},
                lowToHighStaggerMs=(round(group_stagger_ms, 1)
                                    if group_stagger_ms is not None else None),
            ))

    # ── attackNoise ───────────────────────────────────────────────────
    an = {}
    for k in ("freq", "q", "level", "decay", "bandwidth"):
        vals = [n.attack_noise.get(k) for n in notes if n.attack_noise]
        an[k] = robust_mean(vals)
    attack_noise = None
    if an.get("freq"):
        # level: the engine's `level` is a burst-peak gain (velocity·level·0.3
        # into a bandpass), not an RMS ratio.  Calibration: a measured
        # transient/sustain RMS ratio of ~0.02–0.04 corresponds perceptually
        # to the engine's preset range 0.2–0.4, so map ratio×10 and clip.
        # The raw measured ratio is kept alongside (measuredLevelRatio).
        ratio = an["level"] if an["level"] is not None else 0.02
        attack_noise = dict(
            level=round(float(np.clip(ratio * 10.0, 0.05, 0.6)), 3),
            freq=float(round(an["freq"])),
            q=float(round(an["q"], 2)) if an["q"] else 1.0,
            decay=float(round(an["decay"], 3)) if an["decay"] else None,
            measuredBandwidthHz=float(round(an["bandwidth"])) if an["bandwidth"] else None,
            measuredLevelRatio=float(round(an["level"], 3)) if an["level"] is not None else None,
        )

    # ── onset pitch / articulation distribution (owner L5/L5b) ──────
    onset_rows = [n for n in notes if n.onset_pitch]
    scooped = [n for n in onset_rows
               if (n.onset_pitch.get("depthCents") or 0) >= 3]
    scoop_depths = [n.onset_pitch["depthCents"] for n in scooped]
    scoop_settles = [n.onset_pitch["settleMs"] for n in scooped]
    articulation_pairs = [
        (float(n.attack_noise["level"]), float(n.onset_pitch["depthCents"]))
        for n in onset_rows
        if n.attack_noise.get("level") is not None and
        n.onset_pitch.get("depthCents") is not None
    ]
    articulation_correlation = None
    if len(articulation_pairs) >= 4:
        transient = np.asarray([row[0] for row in articulation_pairs])
        depth = np.asarray([row[1] for row in articulation_pairs])
        if np.std(transient) > 1e-9 and np.std(depth) > 1e-9:
            articulation_correlation = float(np.corrcoef(transient, depth)[0, 1])
    onset_pitch = dict(
        onsetScoopProb=(float(len(scooped) / len(onset_rows))
                        if onset_rows else None),
        onsetScoopDepthCents=robust_mean(scoop_depths),
        onsetScoopDepthSd=(float(np.std(scoop_depths, ddof=1))
                           if len(scoop_depths) >= 4 else None),
        onsetScoopSettleMs=robust_mean(scoop_settles),
        onsetArticulationCorrelation=articulation_correlation,
        onsetPitchNotes=len(onset_rows),
    )

    # ── vibrato ───────────────────────────────────────────────────────
    vib_pool = vib_notes if vib_notes else notes
    vib = [n.vibrato for n in vib_pool if n.vibrato]
    vibrato = None
    if vib:
        present = [v for v in vib if v.get("present")]
        prob = len(present) / len(vib)
        rates = [v["rate"] for v in present]
        depths = [v["depth"] for v in present]
        # Slow drift/portamento personality comes from the ordinary/straight
        # pool, not designated vibrato takes whose deliberate oscillation can
        # leak into the low-pass trend on short notes.
        drift_pool = [n.vibrato for n in notes if n.vibrato]
        vibrato = dict(
            vibratoProb=float(round(prob, 2)),
            vibratoRate=robust_mean(rates),
            vibratoRateSd=float(np.std(rates, ddof=1)) if len(rates) >= 4 else None,
            vibratoDepth=robust_mean(depths),
            vibratoDepthSd=float(np.std(depths, ddof=1)) if len(depths) >= 4 else None,
            nNotes=len(vib),
            # on designated vibrato takes every note has vibrato by design,
            # so `vibratoProb` is CONDITIONAL (depth/rate when vibrating),
            # not how often the player chooses to vibrate
            vibratoBasis=("designated vibrato takes (prob conditional)"
                          if vib_notes else "ordinary notes"),
            microDriftCentsSd=robust_mean([v.get("microDriftCentsSd") for v in drift_pool]),
            microDriftCentsRange=robust_mean([v.get("microDriftCentsRange") for v in drift_pool]),
            microDriftCentsPerSecond=robust_mean([v.get("microDriftCentsPerSecond") for v in drift_pool]),
        )

    # VocalSet files carry an explicit terminal vowel label.  Retain F1-F5
    # per vowel/voice type so the engine can build fixed-Hz body presets.
    vowel_formants = {}
    for vowel in "aeiou":
        pool = [n for n in notes if n.vowel == vowel and len(n.formants) >= 5]
        if not pool:
            continue
        vowel_formants[vowel] = {
            "formantsHz": [round(robust_mean([n.formants[i] for n in pool]), 1) for i in range(5)],
            "bandwidthsHz": [round(robust_mean([n.formant_bandwidths[i] for n in pool]), 1) for i in range(5)],
            "nNotes": len(pool),
            "method": "steady-state LPC; frame-wise roots, median aggregation",
        }

    r4 = lambda v: (round(float(v), 4) if v is not None and np.isfinite(v) else None)
    if material:
        material = {k: (round(v, 4) if isinstance(v, float) else v)
                    for k, v in material.items()}
    if vibrato:
        vibrato = {k: (round(v, 3) if isinstance(v, float) else v)
                   for k, v in vibrato.items()}
    return dict(
        partials=[dict(amp=round(float(a), 5), spread=round(float(s), 3))
                  for a, s in zip(amp, spread)],
        partialB=round(B_med, 8),
        partialBByNote=B_by_note,
        partialsByRegister=partials_by_register,
        resonances=resonances,
        resonancesFit=resonances_fit,
        vowelFormants=vowel_formants,
        tailSlopeDbPerOct=round(tail_db_oct, 1) if tail_db_oct is not None else None,
        material=material,
        performance=dict(
            envelopeAttack=r4(adsr["attack"]), envelopeAttackSd=r4(attack_sd),
            envelopeDecay=r4(adsr["decay"]), envelopeSustain=r4(adsr["sustain"]),
            envelopeRelease=r4(adsr["release"]),
            **(vibrato or dict(vibratoProb=0.0, vibratoRate=None, vibratoRateSd=None,
                               vibratoDepth=None, vibratoDepthSd=None)),
            **{key: r4(value) if isinstance(value, float) else value
               for key, value in onset_pitch.items()},
            attackNoise=attack_noise,
        ),
        attack=dict(bandT90ms={str(fc): round(v * 1000, 1) for fc, v in band_t90.items()},
                    lowToHighStaggerMs=round(stagger_ms, 1) if stagger_ms is not None else None,
                    byRegister=attack_by_register),
        notesAnalysed=[dict(file=os.path.basename(n.file), note=n.note,
                            f0=round(n.f0, 2), percussive=n.percussive,
                            onsetPitch=n.onset_pitch,
                            **({"vowel": n.vowel} if n.vowel else {}))
                       for n in notes],
    )


# ──────────────────────────────────────────────────────────────────────────
# Driver
# ──────────────────────────────────────────────────────────────────────────

AUDIO_EXT = (".aif", ".aiff", ".wav", ".flac", ".ogg", ".mp3")


def validate_corpus_contract(samples_dir: str, only: set[str] | None = None) -> list[str]:
    """Require complete acquisition sidecars before analysing any audio.

    Acquisition may write folders over several minutes.  This preflight makes
    the hand-off atomic from the fitter's perspective and prevents a partial
    directory from becoming a seemingly valid measured profile.
    """
    ready: list[str] = []
    errors: list[str] = []
    for instrument in sorted(os.listdir(samples_dir)):
        inst_dir = os.path.join(samples_dir, instrument)
        if not os.path.isdir(inst_dir) or (only and instrument not in only):
            continue
        audio = [name for name in os.listdir(inst_dir) if name.lower().endswith(AUDIO_EXT)]
        if not audio:
            continue
        provenance = os.path.join(inst_dir, "PROVENANCE.json")
        coverage = os.path.join(inst_dir, "COVERAGE.md")
        if not os.path.isfile(provenance):
            errors.append(f"{instrument}: missing PROVENANCE.json")
        else:
            try:
                with open(provenance, encoding="utf-8") as handle:
                    payload = json.load(handle)
                if not isinstance(payload, dict) or not payload:
                    errors.append(f"{instrument}: PROVENANCE.json must be a non-empty object")
            except (OSError, json.JSONDecodeError) as exc:
                errors.append(f"{instrument}: invalid PROVENANCE.json ({exc})")
        if not os.path.isfile(coverage) or os.path.getsize(coverage) == 0:
            errors.append(f"{instrument}: missing or empty COVERAGE.md")
        ready.append(instrument)
    if not ready:
        errors.append("no instrument folders containing audio")
    if errors:
        raise ValueError("corpus contract is incomplete:\n  " + "\n  ".join(errors))
    return ready


def is_nonvib_name(name: str) -> bool:
    low = name.lower()
    return "nonvib" in low or "novib" in low or "non-vib" in low or "non_vib" in low


def is_vib_name(name: str) -> bool:
    low = name.lower()
    if is_nonvib_name(low):
        return False
    return ".vib" in low or low.startswith("vib") or "_vib" in low or "vibrato" in low


def analyse_instrument(inst_dir: str, n_partials: int, verbose=True):
    files = sorted(f for f in os.listdir(inst_dir)
                   if f.lower().endswith(AUDIO_EXT))
    if not files:
        return None
    # Role split: vibrato-marked files feed ONLY the vibrato analysis (they
    # may even come from a different source than the spectral set); all
    # other files feed the spectral/envelope/attack analyses.  When there
    # are no vibrato-marked files, vibrato is measured on the ordinary
    # notes (arco strings, vocal — vibrato is part of normal production).
    vib = [f for f in files if is_vib_name(f)]
    spectral_files = [f for f in files if f not in vib] or files
    vibrato_files = vib

    def run(file_list):
        result = []
        for fn in file_list:
            path = os.path.join(inst_dir, fn)
            x, sr = load_mono(path)
            # The Iowa horn chromatic runs use shorter inter-note gaps than
            # the other MIS sets; 250 ms merges entire scales into one note.
            # Keep the conservative gate elsewhere so vibrato/bow dips are
            # not split into false notes.
            merge_gap = 0.12 if fn.lower().startswith("horn.") else 0.25
            segs = segment_notes(x, sr, merge_gap_s=merge_gap)
            # drop segments > 20 dB quieter than the file's loudest segment
            # (page-turn thumps, resonance tails re-triggering the gate)
            if segs:
                peaks = [float(np.abs(x[s:e]).max()) for s, e in segs]
                top = max(peaks)
                segs = [se for se, p in zip(segs, peaks) if p > top * 0.1]
            if verbose:
                print(f"    {fn}: {len(segs)} note(s)")
            for s, e in segs:
                note = analyse_note(x[s:e], sr, path, n_partials)
                if note is not None:
                    result.append(note)
        return result

    notes = run(spectral_files)
    vib_notes = run(vibrato_files) if vibrato_files else []
    if not notes:
        return None
    agg = aggregate_instrument(notes, vib_notes, n_partials)
    # Corpus contract uses uppercase; retain lowercase as a legacy fallback.
    prov_path = os.path.join(inst_dir, "PROVENANCE.json")
    if not os.path.exists(prov_path):
        prov_path = os.path.join(inst_dir, "provenance.json")
    prov = {}
    if os.path.exists(prov_path):
        with open(prov_path) as fh:
            prov = json.load(fh)
    prov.setdefault("files", files)
    agg["provenance"] = prov
    return agg


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--samples", required=True,
                    help="directory with one sub-directory of audio per instrument")
    ap.add_argument("--out", required=True, help="output JSON path")
    ap.add_argument("--partials", type=int, default=64)
    ap.add_argument("--only", default=None,
                    help="comma-separated instrument names to (re)analyse")
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--require-contract", action="store_true",
                    help="refuse to run unless every selected audio folder has PROVENANCE.json and COVERAGE.md")
    ap.add_argument("--keep-existing", action="store_true",
                    help="preserve instruments already in --out that have no "
                         "corpus folder (legacy fits, e.g. trombone) instead "
                         "of silently dropping them on a full regeneration")
    args = ap.parse_args(argv)

    only = set(args.only.split(",")) if args.only else None
    if args.require_contract:
        try:
            validate_corpus_contract(args.samples, only)
        except ValueError as exc:
            ap.error(str(exc))
    out = {}
    for inst in sorted(os.listdir(args.samples)):
        inst_dir = os.path.join(args.samples, inst)
        if not os.path.isdir(inst_dir) or (only and inst not in only):
            continue
        print(f"[{inst}]")
        agg = analyse_instrument(inst_dir, args.partials, verbose=not args.quiet)
        if agg is None:
            print("    no analysable notes — skipped")
            continue
        out[inst] = agg
        p = agg["performance"]
        mat = agg["material"] or {}
        print(f"    notes={len(agg['notesAnalysed'])} B={agg['partialB']:.2e} "
              f"tail={agg['tailSlopeDbPerOct']} dB/oct "
              f"t60Ref={mat.get('t60Ref')} slope={mat.get('slope')} "
              f"m*={mat.get('suggestedMaterial')} "
              f"A={p['envelopeAttack']} S={p['envelopeSustain']}")
    if args.keep_existing and os.path.exists(args.out):
        # Conservative merge: never silently lose an instrument on a partial
        # (--only) or full regeneration — legacy fits without a corpus folder
        # (e.g. trombone) and instruments outside --only survive.  Run
        # without --keep-existing to intentionally drop instruments.
        with open(args.out) as fh:
            previous = json.load(fh)
        for inst, profile in previous.items():
            if inst not in out:
                out[inst] = profile
                print(f"[{inst}] kept previous profile (not re-analysed this run)")
    out = {inst: out[inst] for inst in sorted(out)}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"\nwrote {args.out} ({len(out)} instruments)")


if __name__ == "__main__":
    main()
