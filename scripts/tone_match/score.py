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

from .analysis import NoteAnalysis, analyse_audio_file, load_mono


DEFAULT_WEIGHTS = {
    "partials_db": 1.0,
    "log_mel_db": 1.0,
    "centroid_semitones": 1.0,
    "attack_ms": 1.0,
    "decay_log_ratio": 1.0,
    "inharmonicity_log_ratio": 1.0,
    "vibrato": 1.0,
    "noise": 1.0,
}

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
}


@dataclass
class FeatureBundle:
    note: NoteAnalysis
    partial_db: np.ndarray
    mel_db: np.ndarray
    centroid_hz: np.ndarray


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


def extract_features(path: str | Path, n_partials: int = 32) -> FeatureBundle:
    samples, sample_rate = load_mono(str(path))
    note = analyse_audio_file(path, n_partials=max(64, n_partials))
    nfft = 2048
    _, _, spectrum = signal.stft(samples, fs=sample_rate, nperseg=nfft, noverlap=1536,
                                 boundary=None, padded=False)
    power = np.abs(spectrum) ** 2
    mel = _mel_bank(sample_rate, nfft) @ power
    mel_db = 10 * np.log10(np.maximum(mel, 1e-12))
    mel_db -= np.percentile(mel_db, 95)  # loudness-match without chasing peaks
    freqs = np.fft.rfftfreq(nfft, 1 / sample_rate)
    centroid = (freqs[:, None] * power).sum(axis=0) / np.maximum(power.sum(axis=0), 1e-20)
    amps = np.maximum(note.partial_amps[:n_partials], 1e-4)
    partial_db = 20 * np.log10(amps / max(float(np.max(amps)), 1e-12))
    return FeatureBundle(note, partial_db, _resample_time(mel_db), _resample_time(centroid)[0])


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
    vr, vs = ref.note.vibrato or {}, render.note.vibrato or {}
    number = lambda value, fallback=0.0: float(value) if isinstance(value, (int, float)) and np.isfinite(value) else fallback
    vr_rate, vs_rate = number(vr.get("rate")), number(vs.get("rate"))
    vr_depth, vs_depth = number(vr.get("depth")), number(vs.get("depth"))
    vibrato = abs(vr_rate - vs_rate) / .3
    vibrato += abs(vr_depth - vs_depth) / max(5, .3 * (vr_depth or 1))
    nr, ns = ref.note.attack_noise or {}, render.note.attack_noise or {}
    level_db = abs(20 * math.log10(max(number(ns.get("level"), 1e-5), 1e-5) / max(number(nr.get("level"), 1e-5), 1e-5))) / 3
    freq_oct = abs(math.log2(max(number(ns.get("freq"), 1), 1) / max(number(nr.get("freq"), 1), 1)))
    noise = level_db + freq_oct
    values = {
        "partials_db": partial_db, "log_mel_db": mel_db,
        "centroid_semitones": centroid, "attack_ms": attack,
        "decay_log_ratio": decay, "inharmonicity_log_ratio": b_distance,
        "vibrato": vibrato, "noise": noise,
    }
    normalized = {key: values[key] / PERCEPTUAL_UNITS[key] for key in values}
    active_weight = sum(weights[key] for key in values if weights[key] > 0)
    composite = sum(normalized[key] * weights[key] for key in values) / max(active_weight, 1e-9)
    return {"features": values, "normalized": normalized, "weights": weights,
            "composite": float(composite), "refF0": ref.note.f0, "renderF0": render.note.f0}


def score_files(ref_path: str | Path, render_path: str | Path, weights: dict[str, float] | None = None) -> dict[str, Any]:
    return compare_features(extract_features(ref_path), extract_features(render_path), weights)


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
    parser.add_argument("--json", dest="json_path")
    parser.add_argument("--report")
    args = parser.parse_args(argv)
    weights = json.loads(Path(args.weights).read_text()) if args.weights else None
    result = score_files(args.ref, args.render, weights)
    output = json.dumps(result, indent=2)
    print(output)
    if args.json_path:
        Path(args.json_path).write_text(output + "\n", encoding="utf-8")
    if args.report:
        write_report(args.report, result, args.ref, args.render)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
