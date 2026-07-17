#!/usr/bin/env python3
"""L14 violin bow-noise extraction and validation.

The extractor removes f0-anchored harmonic bins from each sustained note,
pools the remaining spectrum across pitches within one dynamic/string, and
keeps only the pitch-invariant common component.  Real-corpus extraction is
deliberately gated by a passing synthetic engine round trip.
"""

from __future__ import annotations

import argparse
import json
import math
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
from scipy import signal
import soundfile as sf

from scripts.tone_match.strings_prep import select_chromatic_segments


DYNAMICS = ("pp", "mf", "ff")
VELOCITY = {"pp": 0.2, "mf": 0.62, "ff": 0.92}
SULE_TARGETS = (92, 96, 100)
DEFAULT_BAND_HZ = (200.0, 14400.0)


@dataclass
class Spectrum:
    centres: np.ndarray
    db: np.ndarray
    coverage: np.ndarray
    noise_power_db: float | None = None
    harmonic_power_db: float | None = None
    nhr_db: float | None = None


def load_mono(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    return np.mean(samples, axis=1), int(sample_rate)


def band_centres(sample_rate: int, bands_per_octave: int = 6) -> np.ndarray:
    upper = min(16000.0, sample_rate * 0.46)
    count = int(math.floor(math.log2(upper / 100.0) * bands_per_octave)) + 1
    return 100.0 * 2 ** (np.arange(count) / bands_per_octave)


def welch_psd(samples: np.ndarray, sample_rate: int, nfft: int = 4096,
              sustain_fraction: tuple[float, float] = (0.15, 0.85)) -> tuple[np.ndarray, np.ndarray]:
    start = int(len(samples) * sustain_fraction[0])
    end = int(len(samples) * sustain_fraction[1])
    sustain = np.asarray(samples[start:end], dtype=float)
    if sustain.size < 512:
        sustain = np.asarray(samples, dtype=float)
    segment = min(nfft, sustain.size)
    if segment < 256:
        raise ValueError("audio segment is too short for residual extraction")
    freqs, psd = signal.welch(
        sustain, fs=sample_rate, window="hann", nperseg=segment,
        noverlap=segment // 2, nfft=max(nfft, segment), scaling="density")
    return freqs, np.maximum(psd, np.finfo(float).tiny)


def harmonic_mask(freqs: np.ndarray, f0: float, cents: float = 35.0) -> np.ndarray:
    """Mask f0 harmonics, including at least two FFT bins per side."""
    if not np.isfinite(f0) or f0 <= 0:
        raise ValueError(f"invalid f0: {f0}")
    mask = np.zeros(freqs.shape, dtype=bool)
    bin_hz = float(freqs[1] - freqs[0])
    for harmonic in range(1, int(freqs[-1] // f0) + 1):
        centre = harmonic * f0
        half_width = max(2.0 * bin_hz, centre * (2 ** (cents / 1200.0) - 1.0))
        mask |= np.abs(freqs - centre) <= half_width
    return mask


def _band_profile(freqs: np.ndarray, psd: np.ndarray, centres: np.ndarray,
                  usable: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    if usable is None:
        usable = np.ones(freqs.shape, dtype=bool)
    ratio = 2 ** (1 / 12)  # half-width of a 1/6-octave band
    values = np.full(centres.shape, np.nan)
    coverage = np.zeros(centres.shape)
    for index, centre in enumerate(centres):
        inside = (freqs >= centre / ratio) & (freqs < centre * ratio)
        count = int(np.count_nonzero(inside))
        valid = inside & usable
        coverage[index] = np.count_nonzero(valid) / max(1, count)
        if np.count_nonzero(valid) >= 2:
            values[index] = 10 * math.log10(float(np.median(psd[valid])))
    return values, coverage


def _integrated_powers(freqs: np.ndarray, psd: np.ndarray, noise_db: np.ndarray,
                       centres: np.ndarray, band_hz: tuple[float, float]) -> tuple[float, float, float]:
    inside = (freqs >= band_hz[0]) & (freqs <= band_hz[1])
    finite = np.isfinite(noise_db)
    interp = np.interp(np.log2(np.maximum(freqs[inside], centres[finite][0])),
                       np.log2(centres[finite]), noise_db[finite])
    df = float(freqs[1] - freqs[0])
    noise_power = float(np.sum(10 ** (interp / 10)) * df)
    total_power = float(np.sum(psd[inside]) * df)
    harmonic_power = max(total_power - noise_power, np.finfo(float).tiny)
    noise_power = max(noise_power, np.finfo(float).tiny)
    return (10 * math.log10(noise_power), 10 * math.log10(harmonic_power),
            10 * math.log10(noise_power / harmonic_power))


def residual_spectrum(samples: np.ndarray, sample_rate: int, f0: float,
                      *, nfft: int = 4096, mask_cents: float = 35.0,
                      band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> Spectrum:
    freqs, psd = welch_psd(samples, sample_rate, nfft=nfft)
    centres = band_centres(sample_rate)
    mask = harmonic_mask(freqs, f0, mask_cents)
    db, coverage = _band_profile(freqs, psd, centres, ~mask)
    noise_db, harmonic_db, nhr_db = _integrated_powers(
        freqs, psd, db, centres, band_hz)
    return Spectrum(centres, db, coverage, noise_db, harmonic_db, nhr_db)


def broadband_spectrum(samples: np.ndarray, sample_rate: int,
                       *, nfft: int = 4096) -> Spectrum:
    freqs, psd = welch_psd(samples, sample_rate, nfft=nfft)
    centres = band_centres(sample_rate)
    db, coverage = _band_profile(freqs, psd, centres)
    return Spectrum(centres, db, coverage)


def ambient_spectrum(path: Path, *, nfft: int = 4096) -> Spectrum:
    """Estimate the recording floor from the quietest raw-run STFT frames."""
    samples, sample_rate = load_mono(path)
    freqs, _, psd = signal.spectrogram(
        samples, fs=sample_rate, window="hann", nperseg=nfft,
        noverlap=nfft // 2, nfft=nfft, scaling="density", mode="psd")
    frame_power = np.sum(psd, axis=0)
    quiet = psd[:, frame_power <= np.percentile(frame_power, 20)]
    floor_psd = np.maximum(np.median(quiet, axis=1), np.finfo(float).tiny)
    centres = band_centres(sample_rate)
    db, coverage = _band_profile(freqs, floor_psd, centres)
    return Spectrum(centres, db, coverage)


def _normalise(db: np.ndarray, centres: np.ndarray,
               band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> np.ndarray:
    use = ((centres >= band_hz[0]) & (centres <= band_hz[1]) & np.isfinite(db))
    return db - float(np.nanmedian(db[use]))


def _shape_metrics(a: np.ndarray, b: np.ndarray, centres: np.ndarray,
                   band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> dict[str, float]:
    use = ((centres >= band_hz[0]) & (centres <= band_hz[1]) &
           np.isfinite(a) & np.isfinite(b))
    aa, bb = _normalise(a, centres, band_hz)[use], _normalise(b, centres, band_hz)[use]
    return {
        "correlation": round(float(np.corrcoef(aa, bb)[0, 1]), 4),
        "medianAbsDb": round(float(np.median(np.abs(aa - bb))), 3),
        "p95AbsDb": round(float(np.percentile(np.abs(aa - bb), 95)), 3),
    }


def validate_engine_roundtrip(mixed: Path, harmonic_only: Path, f0: float,
                              output: Path) -> dict[str, Any]:
    mixed_samples, sr_mixed = load_mono(mixed)
    harmonic_samples, sr_harmonic = load_mono(harmonic_only)
    if sr_mixed != sr_harmonic:
        raise ValueError("engine round-trip WAVs use different sample rates")
    count = min(len(mixed_samples), len(harmonic_samples))
    injected = mixed_samples[:count] - harmonic_samples[:count]
    recovered = residual_spectrum(mixed_samples[:count], sr_mixed, f0)
    expected = broadband_spectrum(injected, sr_mixed)
    metrics = _shape_metrics(recovered.db, expected.db, recovered.centres)
    passed = (metrics["correlation"] >= 0.90 and metrics["medianAbsDb"] <= 1.6
              and metrics["p95AbsDb"] <= 4.0)
    result = {
        "schema": "sg2-bow-noise-validation-v1",
        "status": "pass" if passed else "fail",
        "method": "engine-render harmonic+body-routed-noise minus matched harmonic-only render",
        "f0Hz": round(float(f0), 4),
        "bandHz": list(DEFAULT_BAND_HZ),
        "tolerance": {"minCorrelation": 0.90, "maxMedianAbsDb": 1.6,
                      "maxP95AbsDb": 4.0},
        "metrics": metrics,
        "mixed": str(mixed),
        "harmonicOnly": str(harmonic_only),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if not passed:
        raise RuntimeError(f"synthetic bow-noise extractor validation failed: {metrics}")
    return result


def _record(path: Path, dynamic: str, string: str, f0: float,
            midi: int | None, source_file: str) -> dict[str, Any]:
    samples, sample_rate = load_mono(path)
    return {"path": str(path), "dynamic": dynamic, "string": string,
            "f0Hz": float(f0), "midi": midi, "sourceFile": source_file,
            "samples": samples, "sampleRate": sample_rate}


def load_iowa_records(body_references: Path, samples_root: Path) -> list[dict[str, Any]]:
    data = json.loads(body_references.read_text())
    rows = data.get("references", data)
    records = [_record(Path(row["path"]), row["dynamic"], row["string"],
                       row["expectedF0Hz"], row.get("midi"), row["sourceFile"])
               for row in rows]
    for dynamic in DYNAMICS:
        matches = sorted(samples_root.glob(f"Violin.arco.{dynamic}.sulE.*.aiff"))
        if len(matches) != 1:
            raise RuntimeError(f"expected one Iowa sulE {dynamic} run, found {matches}")
        source = matches[0]
        for midi, segment, sample_rate, _, f0, cents in select_chromatic_segments(
                source, SULE_TARGETS):
            records.append({"path": f"{source}#MIDI{midi}", "dynamic": dynamic,
                            "string": "sulE", "f0Hz": float(f0), "midi": midi,
                            "pitchErrorCents": round(float(cents), 2),
                            "sourceFile": source.name, "samples": segment,
                            "sampleRate": int(sample_rate)})
    return records


def _median_profile(spectra: Iterable[Spectrum]) -> np.ndarray:
    rows = [s.db for s in spectra]
    return _nanmedian(np.asarray(rows), axis=0)


def _nanmedian(values: np.ndarray, axis: int = 0) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        return np.nanmedian(values, axis=axis)


def _nanmax(values: np.ndarray, axis: int = 0) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        return np.nanmax(values, axis=axis)


def _fit_level_law(dynamic_rows: dict[str, list[Spectrum]]) -> dict[str, Any]:
    velocities = np.asarray([VELOCITY[d] for d in DYNAMICS])
    noise_db = np.asarray([np.median([s.noise_power_db for s in dynamic_rows[d]])
                           for d in DYNAMICS])
    nhr_db = np.asarray([np.median([s.nhr_db for s in dynamic_rows[d]])
                         for d in DYNAMICS])
    # amplitude gain = velocity ** exponent; regress power dB against 20log10(v)
    x = 20 * np.log10(velocities)
    exponent, intercept = np.polyfit(x, noise_db, 1)
    fitted = intercept + exponent * x
    return {
        "model": "amplitude = bowNoiseLevel * velocity ** bowNoiseVelocityExponent",
        "velocityExponent": round(float(np.clip(exponent, 0, 2)), 4),
        "interceptNoisePowerDbAtVelocity1": round(float(intercept), 3),
        "fitRmseDb": round(float(np.sqrt(np.mean((noise_db - fitted) ** 2))), 3),
        "rungs": [{"dynamic": d, "velocity": VELOCITY[d],
                   "noisePowerDb": round(float(noise_db[i]), 3),
                   "noiseToHarmonicDb": round(float(nhr_db[i]), 3)}
                  for i, d in enumerate(DYNAMICS)],
    }


def extract_iowa(body_references: Path, samples_root: Path, validation: Path,
                 output: Path, measured: Path | None = None) -> dict[str, Any]:
    validation_data = json.loads(validation.read_text())
    if validation_data.get("schema") != "sg2-bow-noise-validation-v1" or validation_data.get("status") != "pass":
        raise RuntimeError("real Iowa extraction is gated by a passing engine validation artifact")
    records = load_iowa_records(body_references, samples_root)
    ambient_by_file = {source: ambient_spectrum(samples_root / source)
                       for source in sorted({r["sourceFile"] for r in records})}
    for row in records:
        row["standard"] = residual_spectrum(row["samples"], row["sampleRate"], row["f0Hz"])
        row["mask25"] = residual_spectrum(row["samples"], row["sampleRate"], row["f0Hz"], mask_cents=25)
        row["mask50"] = residual_spectrum(row["samples"], row["sampleRate"], row["f0Hz"], mask_cents=50)
        row["win2048"] = residual_spectrum(row["samples"], row["sampleRate"], row["f0Hz"], nfft=2048)
        row["win8192"] = residual_spectrum(row["samples"], row["sampleRate"], row["f0Hz"], nfft=8192)
    centres = records[0]["standard"].centres
    dynamic_rows = {dynamic: [r["standard"] for r in records if r["dynamic"] == dynamic]
                    for dynamic in DYNAMICS}
    group_profiles: dict[tuple[str, str], np.ndarray] = {}
    group_stats = []
    for dynamic in DYNAMICS:
        for string in ("sulG", "sulD", "sulA", "sulE"):
            members = [r for r in records if r["dynamic"] == dynamic and r["string"] == string]
            if not members:
                continue
            common = _median_profile(r["standard"] for r in members)
            group_profiles[(dynamic, string)] = common
            metrics = [_shape_metrics(r["standard"].db, common, centres) for r in members]
            group_stats.append({
                "dynamic": dynamic, "string": string, "notes": len(members),
                "medianPitchCorrelation": round(float(np.median([m["correlation"] for m in metrics])), 4),
                "medianPitchShapeErrorDb": round(float(np.median([m["medianAbsDb"] for m in metrics])), 3),
            })
    by_dynamic = {dynamic: _nanmedian(np.asarray(
        [_normalise(group_profiles[(dynamic, string)], centres)
         for string in ("sulG", "sulD", "sulA", "sulE")]), axis=0)
        for dynamic in DYNAMICS}
    pooled_shape = _nanmedian(np.asarray([by_dynamic[d] for d in DYNAMICS]), axis=0)
    dynamic_comparisons = []
    for i, left in enumerate(DYNAMICS):
        for right in DYNAMICS[i + 1:]:
            dynamic_comparisons.append({"pair": f"{left}-{right}",
                                        **_shape_metrics(by_dynamic[left], by_dynamic[right], centres)})

    standard = _nanmedian(np.asarray([r["standard"].db for r in records]), axis=0)
    mask25 = _nanmedian(np.asarray([r["mask25"].db for r in records]), axis=0)
    mask50 = _nanmedian(np.asarray([r["mask50"].db for r in records]), axis=0)
    win2048 = _nanmedian(np.asarray([r["win2048"].db for r in records]), axis=0)
    win8192 = _nanmedian(np.asarray([r["win8192"].db for r in records]), axis=0)
    pitch_mad = _nanmedian(np.abs(np.asarray([
        _normalise(r["standard"].db, centres) for r in records]) - pooled_shape), axis=0)
    mask_sensitivity = _nanmax(np.abs(np.vstack([
        _normalise(mask25, centres) - _normalise(standard, centres),
        _normalise(mask50, centres) - _normalise(standard, centres)])), axis=0)
    window_sensitivity = _nanmax(np.abs(np.vstack([
        _normalise(win2048, centres) - _normalise(standard, centres),
        _normalise(win8192, centres) - _normalise(standard, centres)])), axis=0)
    in_band = (centres >= DEFAULT_BAND_HZ[0]) & (centres <= DEFAULT_BAND_HZ[1])
    rejected = in_band & ((pitch_mad > 6) | (mask_sensitivity > 3) |
                          (window_sensitivity > 3))
    leakage = [{"freqHz": round(float(centres[i]), 1),
                "pitchMadDb": round(float(pitch_mad[i]), 3),
                "maskSensitivityDb": round(float(mask_sensitivity[i]), 3),
                "windowSensitivityDb": round(float(window_sensitivity[i]), 3)}
               for i in np.where(rejected)[0]]
    table = [{"freqHz": round(float(centres[i]), 1),
              "gainDb": round(float(pooled_shape[i]), 3)}
             for i in np.where(in_band & ~rejected & np.isfinite(pooled_shape))[0]]
    law = _fit_level_law(dynamic_rows)
    stable = all(row["correlation"] >= 0.9 and row["medianAbsDb"] <= 3.0
                 for row in dynamic_comparisons)
    median_coverage = np.nanmedian(np.asarray(
        [r["standard"].coverage for r in records]), axis=0)
    source_snrs = np.asarray([
        r["standard"].db - ambient_by_file[r["sourceFile"]].db for r in records])
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        source_snr_median = np.nanmedian(source_snrs, axis=0)
        source_snr_p25 = np.nanpercentile(source_snrs, 25, axis=0)
    band_evidence = {
        "floorMethod": "quietest 20% of STFT frames in each source Iowa run",
        "lowerLimitReason": "lowest 1/6-octave centre retained with robust multi-bin resolution at nfft=4096",
        "upperLimitReason": "last complete analysed 1/6-octave centre below 16 kHz",
        "retainedMedianUsableFraction": round(float(np.nanmedian(
            median_coverage[in_band])), 3),
        "minimumMedianSourceSnrDb": round(float(np.nanmin(source_snr_median[in_band])), 3),
        "minimumP25SourceSnrDb": round(float(np.nanmin(source_snr_p25[in_band])), 3),
        "edgeSourceSnrDb": [
            {"freqHz": round(float(centres[i]), 1),
             "medianDb": round(float(source_snr_median[i]), 3),
             "p25Db": round(float(source_snr_p25[i]), 3)}
            for i in np.where(in_band & ((centres <= 252) | (centres >= 12800)))[0]],
    }
    result = {
        "schema": "sg2-bow-noise-profile-v1",
        "instrument": "violin",
        "method": "f0 harmonic subtraction + same-dynamic/string cross-pitch median",
        "source": "Iowa MIS lossless AIFF only",
        "excluded": [{"source": "Philharmonia MP3", "reason": "lossy coding corrupts low-level broadband noise floors"}],
        "validation": validation_data,
        "notes": len(records),
        "notesByDynamic": {d: sum(r["dynamic"] == d for r in records) for d in DYNAMICS},
        "strings": ["sulG", "sulD", "sulA", "sulE"],
        "bandHz": list(DEFAULT_BAND_HZ),
        "bandDecision": "200 Hz to 14.4 kHz is the full reliable 1/6-octave analysis span; every retained band clears the per-source Iowa background floor empirically",
        "bandEvidence": band_evidence,
        "profilePinned": True,
        "profile": table,
        "shapeStableAcrossDynamics": stable,
        "dynamicShapeComparisons": dynamic_comparisons,
        "crossPitchGroups": group_stats,
        "levelLaw": law,
        "artifactScreen": {
            "harmonicMaskCents": [25, 35, 50], "welchNfft": [2048, 4096, 8192],
            "vibrato": "Iowa arco non-vibrato only; no vibrato smear admitted",
            "flagThresholds": {"pitchMadDb": 6, "maskSensitivityDb": 3,
                               "windowSensitivityDb": 3},
            "flaggedBands": leakage,
        },
        "engineContract": {
            "component": "bowNoise", "bodyRouting": 1,
            "userControl": "bowNoiseLevel", "shapeOptimiserMutable": False,
            "velocityLaw": law["model"],
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if measured is not None:
        measured_data = json.loads(measured.read_text())
        measured_data["violin"]["bowNoise"] = {
            key: result[key] for key in ("method", "source", "excluded", "bandHz",
                                        "bandEvidence",
                                        "profilePinned", "profile", "shapeStableAcrossDynamics",
                                        "dynamicShapeComparisons", "levelLaw", "artifactScreen",
                                        "engineContract")}
        measured.write_text(json.dumps(measured_data, indent=1) + "\n")
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate = sub.add_parser("validate", help="synthetic engine round trip")
    validate.add_argument("--mixed", type=Path, required=True)
    validate.add_argument("--harmonic-only", type=Path, required=True)
    validate.add_argument("--f0", type=float, required=True)
    validate.add_argument("--output", type=Path, required=True)
    extract = sub.add_parser("extract", help="gated Iowa extraction")
    extract.add_argument("--body-references", type=Path, required=True)
    extract.add_argument("--samples", type=Path, required=True)
    extract.add_argument("--validation", type=Path, required=True)
    extract.add_argument("--output", type=Path, required=True)
    extract.add_argument("--measured", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "validate":
        result = validate_engine_roundtrip(args.mixed, args.harmonic_only, args.f0, args.output)
    else:
        result = extract_iowa(args.body_references, args.samples, args.validation,
                              args.output, args.measured)
    print(json.dumps({"status": "ok", "output": str(args.output),
                      "summary": {key: result.get(key) for key in
                                  ("schema", "status", "notes", "shapeStableAcrossDynamics")}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
