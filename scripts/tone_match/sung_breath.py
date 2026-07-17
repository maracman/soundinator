#!/usr/bin/env python3
"""T-067 pitch-synchronous sung-breath residual-envelope observable.

The observable follows the L14/T-054 separator: reconstruct and subtract the
tracked harmonic source, take the residual-noise amplitude envelope, then
measure its modulation-spectrum line at tracked f0 against adjacent bins in
the same band.  Values remain watch-only until lossless singer evidence is
room-screened and a fresh controllability audit names ``voiceBreathSync``.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import numpy as np
from scipy import signal

from .analysis import load_mono


SCHEMA_VERSION = 1
METHOD = "tracked-f0-harmonic-subtraction-residual-envelope-modulation"


def _analysis_audio(samples: np.ndarray, sample_rate: int,
                    target_rate: int = 12000) -> tuple[np.ndarray, int]:
    mono = np.asarray(samples, dtype=float)
    if mono.ndim != 1:
        mono = np.mean(mono, axis=-1)
    mono = np.nan_to_num(mono)
    if sample_rate > target_rate:
        divisor = math.gcd(int(sample_rate), target_rate)
        mono = signal.resample_poly(
            mono, target_rate // divisor, int(sample_rate) // divisor)
        sample_rate = target_rate
    mono -= float(np.mean(mono)) if len(mono) else 0.0
    peak = float(np.max(np.abs(mono))) if len(mono) else 0.0
    if peak > 0:
        mono /= peak
    return mono, int(sample_rate)


def _phase_track(f0_hz: float | np.ndarray, count: int,
                 sample_rate: int) -> tuple[np.ndarray, float]:
    if np.isscalar(f0_hz):
        track = np.full(count, float(f0_hz), dtype=float)
    else:
        source = np.asarray(f0_hz, dtype=float).reshape(-1)
        if not len(source):
            raise ValueError("f0 track is empty")
        track = np.interp(
            np.linspace(0, len(source) - 1, count),
            np.arange(len(source)), source)
    finite = np.isfinite(track) & (track > 20)
    if np.count_nonzero(finite) < count * .8:
        raise ValueError("f0 track has insufficient voiced support")
    centre = float(np.median(track[finite]))
    track[~finite] = centre
    phase = 2 * np.pi * np.cumsum(track) / float(sample_rate)
    return phase, centre


def track_f0(samples: np.ndarray, sample_rate: int,
             expected_f0_hz: float) -> tuple[np.ndarray, dict[str, Any]]:
    """Track the strongest of harmonics 1--3 around an expected sung f0."""
    nperseg = min(2048, 1 << int(round(math.log2(sample_rate * .09))))
    nperseg = max(512, nperseg)
    hop = max(64, nperseg // 8)
    frequencies, times, stft = signal.stft(
        samples, fs=sample_rate, nperseg=nperseg,
        noverlap=nperseg - hop, window="hann", padded=False, boundary=None)
    magnitude = np.abs(stft)
    if magnitude.shape[1] < 6:
        return np.full(len(samples), expected_f0_hz), {
            "status": "fallback-expected-f0", "reason": "too few STFT frames"}
    df = float(frequencies[1] - frequencies[0])
    candidates = []
    for harmonic in (1, 2, 3):
        lo = int(max(1, expected_f0_hz * harmonic * .90 / df))
        hi = int(min(len(frequencies) - 1,
                     expected_f0_hz * harmonic * 1.10 / df))
        strength = float(np.median(np.max(magnitude[lo:hi + 1], axis=0))) \
            if hi > lo else 0.0
        candidates.append((strength, harmonic, lo, hi))
    strength, harmonic, lo, hi = max(candidates)
    if not np.isfinite(strength) or strength <= 1e-8 or hi <= lo:
        return np.full(len(samples), expected_f0_hz), {
            "status": "fallback-expected-f0", "reason": "no tracked harmonic"}
    local = magnitude[lo:hi + 1]
    bins = np.argmax(local, axis=0) + lo
    frame_index = np.arange(len(times))
    left = np.log(np.clip(magnitude[np.maximum(0, bins - 1), frame_index], 1e-12, None))
    centre = np.log(np.clip(magnitude[bins, frame_index], 1e-12, None))
    right = np.log(np.clip(
        magnitude[np.minimum(len(frequencies) - 1, bins + 1), frame_index],
        1e-12, None))
    denominator = left - 2 * centre + right
    offset = np.zeros_like(denominator)
    stable = np.abs(denominator) > 1e-9
    offset[stable] = .5 * (left[stable] - right[stable]) / denominator[stable]
    frame_f0 = (bins + np.clip(offset, -.5, .5)) * df / harmonic
    cents = 1200 * np.log2(np.clip(frame_f0, 1, None) / expected_f0_hz)
    good = np.isfinite(frame_f0) & (np.abs(cents) <= 120)
    if np.count_nonzero(good) < max(4, len(frame_f0) // 2):
        return np.full(len(samples), expected_f0_hz), {
            "status": "fallback-expected-f0", "reason": "insufficient stable frames",
            "trackedHarmonic": harmonic}
    valid_times = times[good]
    valid_f0 = frame_f0[good]
    sample_times = np.arange(len(samples)) / sample_rate
    track = np.interp(sample_times, valid_times, valid_f0,
                      left=valid_f0[0], right=valid_f0[-1])
    return track, {
        "status": "tracked", "trackedHarmonic": harmonic,
        "frames": int(np.count_nonzero(good)),
        "medianF0Hz": round(float(np.median(valid_f0)), 6),
        "p05F0Hz": round(float(np.quantile(valid_f0, .05)), 6),
        "p95F0Hz": round(float(np.quantile(valid_f0, .95)), 6),
    }


def subtract_tracked_harmonics(samples: np.ndarray, sample_rate: int,
                               f0_hz: float | np.ndarray,
                               *, max_harmonics: int = 48,
                               max_frequency_hz: float = 5200.0,
                               ridge: float = 1e-6) -> np.ndarray:
    """Least-squares harmonic reconstruction at a scalar or tracked f0."""
    audio = np.asarray(samples, dtype=float)
    phase, centre = _phase_track(f0_hz, len(audio), sample_rate)
    harmonics = max(1, min(max_harmonics, int(max_frequency_hz // centre)))
    columns = [function(harmonic * phase)
               for harmonic in range(1, harmonics + 1)
               for function in (np.sin, np.cos)]
    design = np.column_stack(columns)
    lhs = design.T @ design + ridge * np.eye(design.shape[1])
    coefficients = np.linalg.solve(lhs, design.T @ audio)
    return audio - design @ coefficients


def _envelope_spectrum(residual: np.ndarray, sample_rate: int,
                       f0_hz: float) -> tuple[np.ndarray, np.ndarray]:
    envelope = np.abs(signal.hilbert(residual))
    cutoff = min(sample_rate * .45, max(120.0, f0_hz * 3.0))
    sos = signal.butter(4, cutoff / (sample_rate / 2), output="sos")
    envelope = signal.sosfiltfilt(sos, envelope)
    envelope -= float(np.mean(envelope))
    spectrum = np.abs(np.fft.rfft(envelope * np.hanning(len(envelope))))
    frequencies = np.fft.rfftfreq(len(envelope), 1 / sample_rate)
    return frequencies, spectrum


def pitch_sync_breath_observable(
    samples: np.ndarray,
    sample_rate: int,
    f0_hz: float | np.ndarray,
    *,
    crop_seconds: float = .20,
    room_suspected: bool | None = None,
) -> dict[str, Any]:
    """Measure the tracked-f0 line in the harmonic-subtracted noise envelope."""
    audio, rate = _analysis_audio(samples, sample_rate)
    crop = min(int(crop_seconds * rate), max(0, len(audio) // 4 - 1))
    if crop:
        audio = audio[crop:-crop]
    if len(audio) < rate * .5:
        raise ValueError("pitch-sync breath needs at least 0.5 s after crop")
    if np.isscalar(f0_hz):
        expected = float(f0_hz)
        track, tracking = track_f0(audio, rate, expected)
        centre = float(np.median(track))
    else:
        source_track = np.asarray(f0_hz, dtype=float)
        track = np.interp(
            np.linspace(0, len(source_track) - 1, len(audio)),
            np.arange(len(source_track)), source_track)
        centre = float(np.nanmedian(track))
        tracking = {"status": "provided-track", "frames": len(source_track)}
    residual = subtract_tracked_harmonics(audio, rate, track)
    frequencies, spectrum = _envelope_spectrum(residual, rate, centre)
    search = (frequencies >= centre * .95) & (frequencies <= centre * 1.05)
    if not np.any(search):
        raise ValueError("no modulation bins around expected f0")
    search_indices = np.flatnonzero(search)
    peak_index = int(search_indices[np.argmax(spectrum[search])])
    adjacent = (((frequencies >= centre * .82) &
                 (frequencies <= centre * .94)) |
                ((frequencies >= centre * 1.06) &
                 (frequencies <= centre * 1.18)))
    same_band = ((frequencies >= centre * .70) &
                 (frequencies <= centre * 1.30) & ~search)
    adjacent_floor = float(np.median(spectrum[adjacent])) if np.any(adjacent) else 0.0
    same_band_floor = float(np.median(spectrum[same_band])) if np.any(same_band) else 0.0
    floor = max(adjacent_floor, same_band_floor, 1e-12)
    prominence = 20 * math.log10(max(float(spectrum[peak_index]), 1e-12) / floor)
    peak_hz = float(frequencies[peak_index])
    residual_rms = float(np.sqrt(np.mean(residual ** 2)))
    prominence_value = round(prominence, 6)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "method": METHOD,
        "pitch_sync_breath_db": prominence_value,
        "pitchSyncBreathDb": prominence_value,
        "peakFrequencyHz": round(peak_hz, 6),
        "trackedF0Hz": round(centre, 6),
        "f0Tracking": tracking,
        "peakErrorPercent": round(abs(peak_hz / centre - 1) * 100, 6),
        "adjacentFloorDb": round(20 * math.log10(max(adjacent_floor, 1e-12)), 6),
        "sameBandFloorDb": round(20 * math.log10(max(same_band_floor, 1e-12)), 6),
        "residualRms": round(residual_rms, 9),
        "durationSeconds": round(len(audio) / rate, 6),
        "analysisSampleRate": rate,
        "roomSuspected": room_suspected,
        "roomResidualDisposition": (
            "excluded-from-breath" if room_suspected is True else
            "unassessed-separate" if room_suspected is None else
            "screened-not-suspected"),
    }


def synthetic_round_trip(*, f0_hz: float = 180.0,
                         sample_rate: int = 44100,
                         seed: int = 67067) -> dict[str, Any]:
    """Known harmonic + body-filtered AM-noise recovery gate."""
    duration = 2.4
    time = np.arange(round(duration * sample_rate)) / sample_rate
    harmonic = sum(
        .2 / rank * np.sin(2 * np.pi * rank * f0_hz * time + .2 * rank)
        for rank in range(1, 12)
    )
    noise = np.random.default_rng(seed).standard_normal(len(time))
    body = signal.butter(
        3, [200 / (sample_rate / 2), 6000 / (sample_rate / 2)],
        btype="bandpass", output="sos")
    noise = signal.sosfilt(body, noise)
    residual = .06 * noise * (1 + .8 * np.cos(2 * np.pi * f0_hz * time))
    known_track = np.full(len(residual), f0_hz)
    measured = pitch_sync_breath_observable(
        harmonic + residual, sample_rate, known_track, room_suspected=False)
    truth = pitch_sync_breath_observable(
        residual, sample_rate, known_track,
        room_suspected=False)
    prominence_error = abs(
        measured["pitchSyncBreathDb"] - truth["pitchSyncBreathDb"])
    passed = measured["peakErrorPercent"] <= 2 and prominence_error <= 1
    return {
        "passed": bool(passed),
        "frequencyTolerancePercent": 2.0,
        "prominenceToleranceDb": 1.0,
        "prominenceErrorDb": round(prominence_error, 6),
        "measured": measured,
        "knownResidual": truth,
    }


def measure_manifest(path: Path) -> dict[str, Any]:
    references = json.loads(path.read_text())
    rows = []
    excluded = []
    for reference in references:
        if "spectral" not in reference.get("roles", []):
            continue
        source_path = Path(reference["path"])
        if source_path.suffix.lower() not in {".wav", ".aif", ".aiff", ".flac"}:
            continue
        try:
            samples, sample_rate = load_mono(str(source_path))
            result = pitch_sync_breath_observable(
                samples, sample_rate, float(reference["expectedF0Hz"]),
                room_suspected=reference.get("roomSuspected"))
        except (OSError, ValueError) as exc:
            excluded.append({
                "path": str(source_path), "sourceFile": reference.get("sourceFile"),
                "voiceClass": reference.get("voiceClass"),
                "vowel": reference.get("vowel"),
                "register": reference.get("register"),
                "dynamic": reference.get("dynamic"),
                "reason": str(exc),
            })
            continue
        rows.append({
            "path": str(source_path),
            "sourceFile": reference.get("sourceFile"),
            "voiceClass": reference.get("voiceClass"),
            "singer": reference.get("singer"),
            "vowel": reference.get("vowel"),
            "register": reference.get("register"),
            "dynamic": reference.get("dynamic"),
            **result,
        })
    return {
        "schemaVersion": SCHEMA_VERSION,
        "method": METHOD,
        "syntheticRoundTrip": synthetic_round_trip(),
        "losslessRows": rows,
        "excludedRows": excluded,
        "roomScreening": {
            "screenedNotSuspected": sum(row["roomSuspected"] is False for row in rows),
            "suspectedExcluded": sum(row["roomSuspected"] is True for row in rows),
            "unassessedSeparate": sum(row["roomSuspected"] is None for row in rows),
        },
        "activationEligible": bool(rows) and all(
            row["roomSuspected"] is False for row in rows),
        "activationBlocker": (
            None if rows and all(row["roomSuspected"] is False for row in rows)
            else "lossless rows require explicit room-residual screening"),
    }


def measure_engine_pairs(repo_root: Path, output_root: Path) -> dict[str, Any]:
    """Render and consume the A-VOICE-04 same-seed octave intervention."""
    output_root.mkdir(parents=True, exist_ok=True)
    muted = [0.0] * 64
    base = {
        "spectralProfile": "voice-mezzo", "excitationType": "blow",
        "seed": 61061, "spectralPartials": 32, "spectralMix": 1,
        "spectralPartialMeans": muted, "spectralPartialSds": muted,
        "spectralPartialsByRegisterDynamic": {"rows": []},
        "toneBreath": 1, "breathLevelScale": 1, "breathTurbulence": 0,
        "breathBodyAmount": 0, "excitationHuman": 0, "vibratoProb": 0,
        "envelopeAttack": .005, "envelopeDecay": .01,
        "envelopeSustain": 1, "envelopeRelease": .02, "reverbWet": 0,
    }
    variants = [
        ("sync-zero-low", 57, 0.0),
        ("sync-enabled-low", 57, .8),
        ("sync-enabled-high", 69, .8),
    ]
    jobs = [{
        "params": {**base, "voiceBreathSync": sync},
        "midi": midi, "velocity": .62, "durationSec": .9,
        "sampleRate": 24000, "out": str(output_root / f"{name}.wav"),
    } for name, midi, sync in variants]
    jobs_path = output_root / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=repo_root, check=True,
        env={**os.environ, "PYTHON": sys.executable})
    rows = {}
    for name, midi, sync in variants:
        f0 = 440 * 2 ** ((midi - 69) / 12)
        samples, sample_rate = load_mono(str(output_root / f"{name}.wav"))
        rows[name] = {
            "midi": midi, "voiceBreathSync": sync,
            **pitch_sync_breath_observable(
                samples, sample_rate, f0, room_suspected=False),
        }
    zero = rows["sync-zero-low"]
    low = rows["sync-enabled-low"]
    high = rows["sync-enabled-high"]
    prominence_delta = (low["pitch_sync_breath_db"] -
                        zero["pitch_sync_breath_db"])
    octave_error = abs(high["peakFrequencyHz"] / low["peakFrequencyHz"] - 2) * 50
    passed = (low["pitch_sync_breath_db"] >= 6 and prominence_delta >= 6 and
              low["peakErrorPercent"] <= 2 and high["peakErrorPercent"] <= 2 and
              octave_error <= 2)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "method": METHOD,
        "passed": bool(passed),
        "prominenceAboveZeroDb": round(prominence_delta, 6),
        "octaveTrackingErrorPercent": round(octave_error, 6),
        "limits": {"enabledProminenceDbMin": 6,
                   "aboveZeroDbMin": 6, "frequencyErrorPercentMax": 2,
                   "octaveTrackingErrorPercentMax": 2},
        "rows": rows,
    }
    (output_root / "T067_ENGINE_PAIR_AUDIT.json").write_text(
        json.dumps(payload, indent=2) + "\n")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("synthetic")
    manifest = sub.add_parser("manifest")
    manifest.add_argument("--references", type=Path, required=True)
    manifest.add_argument("--out", type=Path, required=True)
    engine = sub.add_parser("engine-pairs")
    engine.add_argument("--repo-root", type=Path, default=Path.cwd())
    engine.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "synthetic":
        payload = synthetic_round_trip()
    elif args.command == "manifest":
        payload = measure_manifest(args.references)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
    else:
        payload = measure_engine_pairs(args.repo_root, args.out)
    print(json.dumps(payload, indent=2))
    passed = (payload["passed"] if "passed" in payload else
              payload["syntheticRoundTrip"]["passed"])
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
