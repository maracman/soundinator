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
}

_BLOWN_INSTRUMENTS = {
    "flute", "clarinet", "alto-sax", "tenor-sax", "trumpet", "french-horn",
}


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
}


@dataclass
class FeatureBundle:
    note: NoteAnalysis
    partial_db: np.ndarray
    mel_db: np.ndarray
    centroid_hz: np.ndarray
    sustain_noise_db: float = 0.0
    onset_tilt_db_oct: float = 0.0


def _noise_and_onset_observables(
    power: np.ndarray,
    freqs: np.ndarray,
    times: np.ndarray,
    f0: float,
) -> tuple[float, float]:
    """Measure sustained turbulence and onset-only harmonic colour.

    Harmonic/noise separation uses spectral-density means rather than total
    band energy, so adding more high-frequency bins cannot manufacture extra
    breath.  The onset observable is the dB/octave regression of the
    onset-to-sustain ratio across resolved harmonic slots.
    """
    if power.size == 0 or not np.isfinite(f0) or f0 <= 0:
        return 0.0, 0.0
    frame_energy = np.sum(power, axis=0)
    peak = float(np.max(frame_energy)) if frame_energy.size else 0.0
    active = np.flatnonzero(frame_energy >= peak * 1e-3)
    if peak <= 0 or active.size < 4:
        return 0.0, 0.0
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
    return sustain_noise_db, onset_tilt


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
    sustain_noise_db, onset_tilt = _noise_and_onset_observables(
        power, freqs, times, note.f0)
    return FeatureBundle(note, partial_db, _resample_time(mel_db),
                         _resample_time(centroid)[0], sustain_noise_db, onset_tilt)


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
    values = {
        "partials_db": partial_db, "log_mel_db": mel_db,
        "centroid_semitones": centroid, "attack_ms": attack,
        "decay_log_ratio": decay, "inharmonicity_log_ratio": b_distance,
        "vibrato": vibrato, "noise": noise,
        "sustain_noise_db": abs(render.sustain_noise_db - ref.sustain_noise_db),
        "onset_tilt_db_oct": abs(render.onset_tilt_db_oct - ref.onset_tilt_db_oct),
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
