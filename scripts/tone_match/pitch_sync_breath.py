#!/usr/bin/env python3
"""T-067 pitch-synchronous sung-breath observable and trust gates.

The observable is deliberately a rendered/audio measurement, not a proxy for
``voiceBreathSync`` being present in a preset.  A time-frequency harmonic
reconstruction is subtracted first, the remaining broadband energy is turned
into an amplitude envelope, and the tracked-f0 modulation peak is compared
with both adjacent side bands and the local modulation-spectrum floor.

Lossy files are rejected for corpus use.  Suspected room/recording-tail energy
is labelled separately and the measured breath window excludes that tail.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal
import soundfile as sf

from .bow_noise import assert_lossless_source


SCHEMA = "sg2-pitch-sync-breath-v1"
DEFAULT_BAND_HZ = (300.0, 10_000.0)


def _mono(samples: np.ndarray) -> np.ndarray:
    values = np.asarray(samples, dtype=float)
    if values.ndim == 2:
        values = np.mean(values, axis=1)
    if values.ndim != 1:
        raise ValueError("pitch-sync breath expects mono or frames x channels audio")
    if values.size < 2048:
        raise ValueError("audio is too short for pitch-sync breath analysis")
    return values


def _stft_harmonic_residual(samples: np.ndarray, sample_rate: int,
                            f0_hz: float) -> tuple[np.ndarray, np.ndarray]:
    """Subtract a tracked harmonic reconstruction and return residual + f0.

    This is the L14/T-054 comb discipline expressed as subtraction: selected
    complex harmonic bins form the reconstruction, and the inverse STFT of
    ``spectrum - reconstruction`` is the residual.  The local f0 search stays
    inside +/-4%, enough for sung vibrato without octave-jumping to a formant.
    """
    if not np.isfinite(f0_hz) or f0_hz <= 20:
        raise ValueError(f"invalid f0 for pitch-sync breath: {f0_hz}")
    values = _mono(samples)
    nperseg = min(1024, values.size)
    hop = max(32, nperseg // 8)
    nfft = max(2048, 2 ** math.ceil(math.log2(nperseg)))
    freqs, _times, spectrum = signal.stft(
        values, fs=sample_rate, window="hann", nperseg=nperseg,
        noverlap=nperseg - hop, nfft=nfft, boundary="zeros", padded=True)
    magnitude = np.abs(spectrum)
    candidates = np.linspace(.96 * f0_hz, 1.04 * f0_hz, 49)
    tracked = np.empty(spectrum.shape[1], dtype=float)
    upper = min(DEFAULT_BAND_HZ[1], sample_rate * .47)
    for frame in range(spectrum.shape[1]):
        scores = np.zeros(candidates.size, dtype=float)
        for index, candidate in enumerate(candidates):
            count = min(16, int(upper // candidate))
            if count < 2:
                continue
            harmonic_hz = candidate * np.arange(1, count + 1)
            bins = np.clip(np.searchsorted(freqs, harmonic_hz), 1, len(freqs) - 1)
            left = magnitude[bins - 1, frame]
            right = magnitude[bins, frame]
            peaks = np.maximum(left, right)
            scores[index] = float(np.sum(
                np.log1p(peaks / max(np.median(magnitude[:, frame]), 1e-12)) /
                np.sqrt(np.arange(1, count + 1))))
        tracked[frame] = candidates[int(np.argmax(scores))]
    if tracked.size >= 5:
        tracked = signal.medfilt(tracked, kernel_size=5)

    reconstruction = np.zeros_like(spectrum)
    bin_hz = float(freqs[1] - freqs[0])
    for frame, local_f0 in enumerate(tracked):
        for harmonic in range(1, int(upper // local_f0) + 1):
            centre = harmonic * local_f0
            half_width = max(2 * bin_hz,
                             centre * (2 ** (35 / 1200) - 1))
            mask = np.abs(freqs - centre) <= half_width
            reconstruction[mask, frame] = spectrum[mask, frame]
    _, residual = signal.istft(
        spectrum - reconstruction, fs=sample_rate, window="hann",
        nperseg=nperseg, noverlap=nperseg - hop, nfft=nfft,
        input_onesided=True, boundary=True)
    if residual.size < values.size:
        residual = np.pad(residual, (0, values.size - residual.size))
    return np.asarray(residual[:values.size], dtype=float), tracked


def _noise_envelope(residual: np.ndarray, sample_rate: int,
                    f0_hz: float) -> np.ndarray:
    """Broadband residual power envelope with enough bandwidth to retain f0."""
    nyquist = sample_rate / 2
    upper = min(DEFAULT_BAND_HZ[1], nyquist * .92)
    edges = [max(DEFAULT_BAND_HZ[0], .45 * f0_hz), 1800.0, 4200.0, upper]
    edges = sorted(set(float(np.clip(edge, 40, upper)) for edge in edges))
    tracks = []
    cutoff = min(nyquist * .90, max(120.0, 2.5 * f0_hz))
    smooth = signal.butter(3, cutoff / nyquist, btype="lowpass", output="sos")
    for low, high in zip(edges[:-1], edges[1:]):
        if high <= low * 1.15:
            continue
        bandpass = signal.butter(
            3, [low / nyquist, high / nyquist], btype="bandpass", output="sos")
        band = signal.sosfiltfilt(bandpass, residual)
        power = signal.sosfiltfilt(smooth, band * band)
        power = np.maximum(power, 0)
        median = float(np.median(power))
        if median > 1e-20:
            tracks.append(power / median)
    if not tracks:
        raise ValueError("no resolvable residual-noise band for pitch-sync breath")
    return np.sqrt(np.maximum(np.mean(tracks, axis=0), 0))


def _modulation_metrics(envelope: np.ndarray, sample_rate: int,
                        f0_hz: float) -> dict[str, float]:
    # Exclude onset and release.  The window also prevents a room tail from
    # becoming part of the breath value.
    margin = min(round(.20 * sample_rate), max(1, envelope.size // 5))
    sustain = np.asarray(envelope[margin:envelope.size - margin], dtype=float)
    if sustain.size < sample_rate * .25:
        sustain = np.asarray(envelope, dtype=float)
    sustain = signal.detrend(sustain)
    window = signal.windows.hann(sustain.size, sym=False)
    spectrum = np.abs(np.fft.rfft(sustain * window))
    frequencies = np.fft.rfftfreq(sustain.size, 1 / sample_rate)
    search = (frequencies >= .98 * f0_hz) & (frequencies <= 1.02 * f0_hz)
    if not np.any(search):
        raise ValueError("modulation spectrum cannot resolve tracked f0")
    candidates = np.flatnonzero(search)
    peak_index = int(candidates[np.argmax(spectrum[candidates])])
    peak_hz = float(frequencies[peak_index])
    peak = float(spectrum[peak_index])
    side = (((frequencies >= .72 * f0_hz) & (frequencies <= .90 * f0_hz)) |
            ((frequencies >= 1.10 * f0_hz) & (frequencies <= 1.28 * f0_hz)))
    local_floor = ((frequencies >= .5 * f0_hz) &
                   (frequencies <= 1.5 * f0_hz) &
                   ~((frequencies >= .90 * f0_hz) &
                     (frequencies <= 1.10 * f0_hz)))
    adjacent = float(np.median(spectrum[side])) if np.any(side) else 0.0
    floor = float(np.median(spectrum[local_floor])) if np.any(local_floor) else 0.0
    denominator = max(adjacent, floor, np.finfo(float).tiny)
    return {
        "peakHz": peak_hz,
        "adjacentProminenceDb": float(20 * math.log10(
            max(peak, np.finfo(float).tiny) /
            max(adjacent, np.finfo(float).tiny))),
        "floorProminenceDb": float(20 * math.log10(
            max(peak, np.finfo(float).tiny) /
            max(floor, np.finfo(float).tiny))),
        "prominenceDb": float(20 * math.log10(
            max(peak, np.finfo(float).tiny) / denominator)),
    }


def _room_residual_label(original: np.ndarray, residual: np.ndarray,
                         sample_rate: int) -> dict[str, Any]:
    frame = max(64, round(.025 * sample_rate))
    hop = max(32, frame // 2)
    if original.size < frame * 8:
        return {"suspected": False, "basis": "insufficient tail evidence",
                "excludedFromBreath": True}
    def track(values: np.ndarray) -> np.ndarray:
        frames = np.lib.stride_tricks.sliding_window_view(values, frame)[::hop]
        return np.sqrt(np.mean(frames * frames, axis=1) + 1e-20)
    total, noise = track(original), track(residual)
    early = slice(max(1, len(total) // 2), max(2, 3 * len(total) // 4))
    tail = slice(max(1, 9 * len(total) // 10), len(total))
    total_drop = 20 * math.log10(max(float(np.median(total[early])), 1e-20) /
                                 max(float(np.median(total[tail])), 1e-20))
    residual_drop = 20 * math.log10(max(float(np.median(noise[early])), 1e-20) /
                                    max(float(np.median(noise[tail])), 1e-20))
    suspected = total_drop >= 12 and residual_drop <= 6
    return {
        "suspected": bool(suspected),
        "basis": ("residual persists after harmonic/total decay" if suspected else
                  "no independently persistent residual tail"),
        "totalTailDropDb": float(total_drop),
        "residualTailDropDb": float(residual_drop),
        "excludedFromBreath": True,
    }


def measure_pitch_sync_breath_samples(
    samples: np.ndarray,
    sample_rate: int,
    f0_hz: float,
    *,
    partials_muted: bool = False,
) -> dict[str, Any]:
    """Measure T-067 on audio samples.

    ``partials_muted`` is reserved for the engine trust pair.  Corpus and
    ordinary scorer calls always execute harmonic reconstruction/subtraction.
    """
    original = _mono(samples)
    if partials_muted:
        residual = original.copy()
        tracked = np.asarray([f0_hz], dtype=float)
        method = "declared-partial-muted residual-noise envelope"
    else:
        residual, tracked = _stft_harmonic_residual(
            original, sample_rate, f0_hz)
        method = "tracked-f0 complex harmonic reconstruction subtraction"
    envelope = _noise_envelope(residual, sample_rate, f0_hz)
    metrics = _modulation_metrics(envelope, sample_rate, f0_hz)
    return {
        "schema": SCHEMA,
        "method": method,
        "f0Hz": float(f0_hz),
        "trackedF0MedianHz": float(np.median(tracked)),
        "pitchSyncBreathDb": metrics["prominenceDb"],
        "modulation": metrics,
        "roomResidual": _room_residual_label(
            original, residual, sample_rate),
    }


def measure_pitch_sync_breath_file(path: Path, f0_hz: float, *,
                                   source_file: str | None = None,
                                   partials_muted: bool = False) -> dict[str, Any]:
    assert_lossless_source(path, source_file)
    samples, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    result = measure_pitch_sync_breath_samples(
        np.mean(samples, axis=1), int(sample_rate), f0_hz,
        partials_muted=partials_muted)
    result["path"] = str(path)
    result["lossless"] = True
    return result


def synthetic_roundtrip(*, sample_rate: int = 48_000,
                        duration_s: float = 6.0,
                        f0_hz: float = 220.0) -> dict[str, Any]:
    """Known harmonic + body-filtered AM-noise trust gate."""
    rng = np.random.default_rng(67_067)
    times = np.arange(round(sample_rate * duration_s)) / sample_rate
    white = rng.standard_normal(times.size)
    body = signal.sosfiltfilt(signal.butter(
        4, [350 / (sample_rate / 2), 9500 / (sample_rate / 2)],
        btype="bandpass", output="sos"), white)
    modulator = (1 + .48 * np.sin(2 * np.pi * f0_hz * times) +
                 .07 * np.sin(2 * np.pi * .81 * f0_hz * times + .2) +
                 .05 * np.sin(2 * np.pi * 1.23 * f0_hz * times + .7))
    injected = body * modulator
    harmonic = np.zeros(times.size, dtype=float)
    for rank in range(1, min(36, int(10_000 // f0_hz)) + 1):
        harmonic += (.65 / rank) * np.sin(
            2 * np.pi * rank * f0_hz * times + .17 * rank)
    # The exact expected residual includes the comb's removal of broadband
    # energy at harmonic bins.  This makes the comparison about separation,
    # not about pretending those bins remain after subtraction.
    expected_residual, _ = _stft_harmonic_residual(
        injected, sample_rate, f0_hz)
    recovered_residual, _ = _stft_harmonic_residual(
        injected + harmonic, sample_rate, f0_hz)
    expected = _modulation_metrics(
        _noise_envelope(expected_residual, sample_rate, f0_hz),
        sample_rate, f0_hz)
    recovered = _modulation_metrics(
        _noise_envelope(recovered_residual, sample_rate, f0_hz),
        sample_rate, f0_hz)
    frequency_error = abs(recovered["peakHz"] / f0_hz - 1)
    prominence_error = abs(recovered["prominenceDb"] -
                           expected["prominenceDb"])
    passed = frequency_error <= .02 and prominence_error <= 1.0
    return {
        "schema": "sg2-pitch-sync-breath-synthetic-v1",
        "status": "pass" if passed else "fail",
        "method": "known body-filtered AM noise plus harmonic reconstruction/subtraction",
        "injected": {"f0Hz": f0_hz, "modulationDepth": .48,
                     "prominenceDb": expected["prominenceDb"]},
        "recovered": recovered,
        "errors": {"frequencyFraction": frequency_error,
                   "prominenceDb": prominence_error},
        "tolerance": {"maxFrequencyFraction": .02,
                      "maxProminenceErrorDb": 1.0},
    }


def measure_corpus_manifest(references_path: Path, *, voice_class: str,
                            max_rows: int = 10) -> dict[str, Any]:
    """Measure balanced lossless vowel/register evidence for one singer."""
    trust = synthetic_roundtrip(duration_s=3.0)
    if trust["status"] != "pass":
        raise RuntimeError("synthetic pitch-sync breath gate failed")
    rows = json.loads(references_path.read_text())
    candidates = [row for row in rows
                  if row.get("voiceClass") == voice_class and
                  "spectral" in row.get("roles", []) and
                  row.get("expectedF0Hz")]
    # One row per vowel x low/mid cell is the construction-balanced minimum;
    # fill any remaining allowance deterministically without overweighting a
    # singer's densest register/dynamic cell.
    selected, seen = [], set()
    for vowel in ("a", "e", "i", "o", "u"):
        for register in ("low", "mid"):
            row = next((candidate for candidate in candidates
                        if candidate.get("vowel") == vowel and
                        candidate.get("register") == register), None)
            if row is None:
                continue
            selected.append(row)
            seen.add((vowel, register))
            if len(selected) >= max_rows:
                break
        if len(selected) >= max_rows:
            break
    for row in candidates:
        if len(selected) >= max_rows:
            break
        if row not in selected:
            selected.append(row)
    measured, rejected = [], []
    for row in selected:
        try:
            observation = measure_pitch_sync_breath_file(
                Path(row["path"]), float(row["expectedF0Hz"]),
                source_file=row.get("sourceFile"))
            measured.append({
                "vowel": row.get("vowel"),
                "register": row.get("register"),
                "dynamic": row.get("dynamic"),
                "sourceFile": row.get("sourceFile"),
                "observation": observation,
            })
        except (OSError, RuntimeError, ValueError) as exc:
            rejected.append({"path": row.get("path"), "reason": str(exc)})
    clean = [row for row in measured
             if not row["observation"]["roomResidual"]["suspected"]]
    room = [row for row in measured
            if row["observation"]["roomResidual"]["suspected"]]
    values = [row["observation"]["pitchSyncBreathDb"] for row in clean]
    passed = len(clean) >= min(5, max_rows)
    return {
        "schema": "sg2-pitch-sync-breath-corpus-v1",
        "status": "pass" if passed else "fail",
        "voiceClass": voice_class,
        "referencesManifest": str(references_path),
        "syntheticGate": trust,
        "selection": "one lossless spectral row per vowel/register, then deterministic fill",
        "measuredRows": len(measured),
        "cleanBreathRows": len(clean),
        "roomSuspectedRows": len(room),
        "rejectedRows": rejected,
        "pitchSyncBreathDb": {
            "median": float(np.median(values)) if values else None,
            "p10": float(np.percentile(values, 10)) if values else None,
            "p90": float(np.percentile(values, 90)) if values else None,
            "activationRowsAtLeast6Db": int(np.count_nonzero(
                np.asarray(values) >= 6)) if values else 0,
        },
        "rows": clean,
        "roomSuspectedResiduals": room,
    }


def _engine_manifest_checks(manifest_path: Path, paths: tuple[Path, Path, Path],
                            seed: int, sync_amount: float) -> dict[str, bool]:
    jobs = json.loads(manifest_path.read_text())
    if not isinstance(jobs, list):
        raise ValueError("engine render manifest must be a JSON job list")
    by_output = {str(Path(job.get("out", "")).resolve()): job for job in jobs}
    selected = []
    for path in paths:
        job = by_output.get(str(path.resolve()))
        if job is None:
            raise ValueError(f"engine render manifest does not bind {path}")
        params = job.get("params")
        if not isinstance(params, dict) and job.get("paramsFile"):
            params_path = Path(job["paramsFile"])
            if not params_path.is_absolute() and not params_path.exists():
                params_path = (manifest_path.parent / params_path).resolve()
            params = json.loads(params_path.read_text())
        if not isinstance(params, dict):
            raise ValueError(f"engine job for {path} has no resolvable params")
        selected.append((job, params))
    seeds = [params.get("seed") for _job, params in selected]
    sync = [float(params.get("voiceBreathSync", 0))
            for _job, params in selected]
    midis = [float(job.get("midi")) for job, _params in selected]
    muted = []
    for _job, params in selected:
        means = params.get("spectralPartialMeans")
        sds = params.get("spectralPartialSds")
        rows = (params.get("spectralPartialsByRegisterDynamic") or {}).get(
            "rows")
        muted.append(isinstance(means, list) and means and
                     all(abs(float(value)) <= 1e-12 for value in means) and
                     isinstance(sds, list) and sds and
                     all(abs(float(value)) <= 1e-12 for value in sds) and
                     rows == [])
    return {
        "declaredSameSeed": seeds == [seed, seed, seed],
        "partialMuted": all(muted),
        "syncPair": (abs(sync[0]) <= 1e-12 and
                     abs(sync[1] - sync_amount) <= 1e-12 and
                     abs(sync[2] - sync_amount) <= 1e-12),
        "manifestOctaveSeparated": abs(midis[2] - midis[1] - 12) <= 1e-12,
    }


def validate_engine_pairs(sync_zero_low: Path, sync_enabled_low: Path,
                          sync_enabled_high: Path, *, f0_low_hz: float,
                          f0_high_hz: float, seed: int,
                          render_manifest: Path,
                          sync_amount: float = .8) -> dict[str, Any]:
    """Consume partial-muted same-seed sync 0/.8 renders at two octaves."""
    zero = measure_pitch_sync_breath_file(
        sync_zero_low, f0_low_hz, partials_muted=True)
    low = measure_pitch_sync_breath_file(
        sync_enabled_low, f0_low_hz, partials_muted=True)
    high = measure_pitch_sync_breath_file(
        sync_enabled_high, f0_high_hz, partials_muted=True)
    low_mod, high_mod, zero_mod = (row["modulation"] for row in
                                   (low, high, zero))
    enabled_over_zero = (low["pitchSyncBreathDb"] -
                         zero["pitchSyncBreathDb"])
    octave_ratio_error = abs(high_mod["peakHz"] / low_mod["peakHz"] - 2)
    expected_pitch_errors = [abs(low_mod["peakHz"] / f0_low_hz - 1),
                             abs(high_mod["peakHz"] / f0_high_hz - 1)]
    checks = {
        **_engine_manifest_checks(
            render_manifest,
            (sync_zero_low, sync_enabled_low, sync_enabled_high),
            seed, sync_amount),
        "enabledAdjacentProminence": low_mod["adjacentProminenceDb"] >= 6,
        "enabledFloorProminence": low_mod["floorProminenceDb"] >= 6,
        "enabledOverZeroDb": enabled_over_zero >= 6,
        "lowPeakWithin2Percent": expected_pitch_errors[0] <= .02,
        "highPeakWithin2Percent": expected_pitch_errors[1] <= .02,
        "octavePeakDoublesWithin2Percent": octave_ratio_error <= .02,
    }
    return {
        "schema": "sg2-pitch-sync-breath-engine-audit-v1",
        "status": "pass" if all(checks.values()) else "fail",
        "provenance": {"seed": seed, "syncZero": 0.0,
                       "syncEnabled": sync_amount,
                       "partialsMuted": True,
                       "renderManifest": str(render_manifest)},
        "checks": checks,
        "enabledOverZeroDb": enabled_over_zero,
        "octaveRatioError": octave_ratio_error,
        "low": low,
        "zero": zero,
        "high": high,
    }


def _write(path: Path | None, payload: dict[str, Any]) -> None:
    text = json.dumps(payload, indent=2) + "\n"
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    print(text, end="")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    synthetic = sub.add_parser("synthetic")
    synthetic.add_argument("--output", type=Path)
    observe = sub.add_parser("observe")
    observe.add_argument("--audio", type=Path, required=True)
    observe.add_argument("--f0", type=float, required=True)
    observe.add_argument("--source-file")
    observe.add_argument("--output", type=Path)
    engine = sub.add_parser("engine")
    engine.add_argument("--sync-zero-low", type=Path, required=True)
    engine.add_argument("--sync-enabled-low", type=Path, required=True)
    engine.add_argument("--sync-enabled-high", type=Path, required=True)
    engine.add_argument("--f0-low", type=float, required=True)
    engine.add_argument("--f0-high", type=float, required=True)
    engine.add_argument("--seed", type=int, required=True)
    engine.add_argument("--render-manifest", type=Path, required=True)
    engine.add_argument("--output", type=Path)
    corpus = sub.add_parser("corpus")
    corpus.add_argument("--references", type=Path, required=True)
    corpus.add_argument("--voice-class", required=True)
    corpus.add_argument("--max-rows", type=int, default=10)
    corpus.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.command == "synthetic":
        result = synthetic_roundtrip()
    elif args.command == "observe":
        result = measure_pitch_sync_breath_file(
            args.audio, args.f0, source_file=args.source_file)
    elif args.command == "engine":
        result = validate_engine_pairs(
            args.sync_zero_low, args.sync_enabled_low,
            args.sync_enabled_high, f0_low_hz=args.f0_low,
            f0_high_hz=args.f0_high, seed=args.seed,
            render_manifest=args.render_manifest)
    else:
        result = measure_corpus_manifest(
            args.references, voice_class=args.voice_class,
            max_rows=args.max_rows)
    _write(args.output, result)
    return 0 if result.get("status", "pass") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
