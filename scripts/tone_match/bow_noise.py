#!/usr/bin/env python3
"""L14/L17 pinned excitation-noise extraction and validation.

The extractor removes f0-anchored harmonic bins from each sustained note,
pools the remaining spectrum across pitches within one dynamic/string, and
keeps only the pitch-invariant common component.  Real-corpus extraction is
deliberately gated by a passing synthetic engine round trip.

The original ``validate`` and ``extract`` commands are the compatibility
surface for the violin L14 result.  L17's component-generic commands use the
same separator for wind breath (and future pinned noise components), while
also fitting pre-onset placement and an envelope independent of tone ADSR.
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

from scripts.tone_match.build_campaign import select_chromatic_run
from scripts.tone_match.strings_prep import (
    iowa_filename_span,
    parse_string_label,
    select_chromatic_across_runs,
    select_chromatic_segments,
)


DYNAMICS = ("pp", "mf", "ff")
VELOCITY = {"pp": 0.2, "mf": 0.62, "ff": 0.92}
SULE_TARGETS = (92, 96, 100)
DEFAULT_BAND_HZ = (200.0, 14400.0)
LOSSLESS_EXTENSIONS = {".aif", ".aiff", ".flac", ".wav", ".wave"}
LOSSLESS_SUBTYPES = {
    "PCM_S8", "PCM_U8", "PCM_16", "PCM_24", "PCM_32", "FLOAT", "DOUBLE",
}
WIND_INSTRUMENTS = {"flute", "clarinet", "alto-sax"}
WIND_SAMPLE_DIRS = {"flute": "flute", "clarinet": "clarinet-bb",
                    "alto-sax": "sax-alto-eb"}
WIND_DENSE_RUNS = {
    "alto-sax": {
        "AltoSax.NoVib.pp.Db3B3.aiff": tuple(range(49, 60)),
        "AltoSax.NoVib.pp.C4B4.aiff": tuple(range(60, 72)),
        "AltoSax.NoVib.pp.C5Ab5.aiff": tuple(range(72, 81)),
        "AltoSax.NoVib.ff.Db3B3.aiff": tuple(range(49, 60)),
        "AltoSax.NoVib.ff.C4B4.aiff": tuple(range(60, 72)),
        "AltoSax.NoVib.ff.C5Ab5.aiff": tuple(range(72, 81)),
    },
    "flute": {
        "Flute.nonvib.pp.B3B4.aiff": tuple(range(59, 72)),
        "Flute.nonvib.pp.B4Bb5.aiff": tuple(range(71, 83)),
        "Flute.nonvib.pp.C6Bb6.aiff": tuple(range(84, 95)),
        "Flute.nonvib.ff.B3B4.aiff": tuple(range(59, 72)),
        "Flute.nonvib.ff.C5B5.aiff": tuple(range(72, 84)),
        "Flute.nonvib.ff.C6B6.aiff": tuple(range(84, 96)),
    },
    "clarinet": {
        "BbClar.pp.D3B3.aiff": tuple(range(50, 60)),
        "BbClar.pp.C4B4.aiff": tuple(range(60, 72)),
        "BbClar.pp.C5B5.aiff": tuple(range(72, 84)),
        "BbClar.pp.C6B6.aiff": tuple(range(84, 96)),
        "BbClar.ff.D3B3.aiff": tuple(range(50, 60)),
        "BbClar.ff.C4B4.aiff": tuple(range(60, 72)),
        "BbClar.ff.C5B5.aiff": tuple(range(72, 84)),
        "BbClar.ff.C6B6.aiff": tuple(range(84, 96)),
    },
}


@dataclass
class Spectrum:
    centres: np.ndarray
    db: np.ndarray
    coverage: np.ndarray
    noise_power_db: float | None = None
    harmonic_power_db: float | None = None
    nhr_db: float | None = None


def assert_lossless_source(path: Path, source_file: str | None = None) -> None:
    """Reject lossy audio and lossy source provenance before floor analysis."""
    candidates = [("audio path", path.name)]
    if source_file:
        candidates.append(("sourceFile provenance", source_file))
    for label, name in candidates:
        suffix = Path(name).suffix.lower()
        if suffix not in LOSSLESS_EXTENSIONS:
            raise ValueError(
                f"L14/L17 lossless-only gate rejected {label} {name!r}; "
                f"allowed extensions: {sorted(LOSSLESS_EXTENSIONS)}")
    info = sf.info(path)
    if info.subtype not in LOSSLESS_SUBTYPES:
        raise ValueError(
            f"L14/L17 lossless-only gate rejected codec {info.subtype!r} "
            f"for {path}")


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


def _component_power_tracks(samples: np.ndarray, sample_rate: int, f0: float,
                            band_hz: tuple[float, float]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return time, residual-noise density and harmonic density tracks."""
    # Resolve residual slots between the mandatory two-bin harmonic guards.
    # Cello C2 needs 8192 bins; using violin's 2048-bin window masks the whole
    # low band and would silently turn a method precedent into a value/scale
    # transfer across the family firewall.
    target = 8192 if f0 < 120 else 4096 if f0 < 220 else 2048
    nperseg = min(target, len(samples))
    if nperseg < 256:
        raise ValueError("audio segment is too short for component-envelope extraction")
    freqs, times, power = signal.spectrogram(
        samples, fs=sample_rate, window="hann", nperseg=nperseg,
        noverlap=3 * nperseg // 4, nfft=nperseg, scaling="density", mode="psd")
    audible = (freqs >= band_hz[0]) & (freqs <= min(band_hz[1], freqs[-1]))
    harmonics = harmonic_mask(freqs, f0) & audible
    residual = audible & ~harmonics
    if not np.any(harmonics) or not np.any(residual):
        raise ValueError(f"component envelope band {band_hz} cannot resolve f0={f0}")
    return (times, np.mean(power[residual, :], axis=0),
            np.mean(power[harmonics, :], axis=0))


def _first_crossing(track: np.ndarray, level: float, start: int = 0) -> int | None:
    hits = np.flatnonzero(track[start:] >= level)
    return int(start + hits[0]) if hits.size else None


def _last_crossing(track: np.ndarray, level: float) -> int | None:
    hits = np.flatnonzero(track >= level)
    return int(hits[-1]) if hits.size else None


def component_envelope_evidence(samples: np.ndarray, sample_rate: int, f0: float,
                                *, band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> dict[str, Any]:
    """Measure L17 placement plus an independent residual-component envelope.

    The onset sense intentionally matches ``score.py``: positive
    ``noiseLeadMs`` means the residual crosses 10% of its sustain density
    before the harmonic track does.  Other stages are measured from the same
    residual track, never inferred from the harmonic ADSR.
    """
    times, noise_t, harmonic_t = _component_power_tracks(
        samples, sample_rate, f0, band_hz)
    total = noise_t + harmonic_t
    active = np.flatnonzero(total >= max(float(np.max(total)) * 1e-3, 1e-20))
    if active.size < 8:
        raise ValueError("too few active STFT frames for component-envelope evidence")
    lo = int(active[int(active.size * 0.35)])
    hi = int(active[min(active.size - 1, int(active.size * 0.65))])
    sustain = np.arange(lo, max(lo + 1, hi + 1))
    noise_sustain = float(np.median(noise_t[sustain]))
    harmonic_sustain = float(np.median(harmonic_t[sustain]))
    noise_onset = _first_crossing(noise_t, 0.1 * noise_sustain)
    harmonic_onset = _first_crossing(harmonic_t, 0.1 * harmonic_sustain)
    if noise_onset is None or harmonic_onset is None:
        raise ValueError("component or harmonic onset did not cross its sustain threshold")

    # The onset peak is deliberately local.  A later accidental room/noise
    # burst must not become the component's lock-in peak.
    hop_s = float(np.median(np.diff(times))) if times.size > 1 else 0.0
    peak_limit_s = float(times[harmonic_onset] + 0.25)
    peak_limit = int(np.searchsorted(times, peak_limit_s, side="right"))
    peak_limit = max(noise_onset + 1, min(len(noise_t), peak_limit))
    peak = noise_onset + int(np.argmax(noise_t[noise_onset:peak_limit]))
    settle_level = max(noise_sustain * (10 ** (3 / 10)), 1e-20)
    settle = None
    for index in range(peak, max(peak, hi - 2)):
        if np.all(noise_t[index:index + 3] <= settle_level):
            settle = index
            break
    if settle is None:
        settle = hi

    harmonic_end = _last_crossing(harmonic_t, 0.1 * harmonic_sustain)
    noise_end = _last_crossing(noise_t, 0.1 * noise_sustain)
    assert harmonic_end is not None and noise_end is not None
    peak_power = max(float(noise_t[peak]), 1e-20)
    release_censored = noise_end >= len(times) - 2
    return {
        "sense": "positive noiseLeadMs means component precedes harmonic onset",
        "threshold": "first crossing of 10% of own sustain spectral density",
        "noiseLeadMs": round(float((times[harmonic_onset] - times[noise_onset]) * 1000), 3),
        "preOnsetSwellMs": round(float(max(0.0, times[harmonic_onset] - times[noise_onset]) * 1000), 3),
        "peakOffsetMs": round(float((times[peak] - times[harmonic_onset]) * 1000), 3),
        "settleFromPeakMs": round(float(max(0.0, times[settle] - times[peak]) * 1000), 3),
        "sustainBelowPeakDb": round(float(10 * math.log10(max(noise_sustain, 1e-20) / peak_power)), 3),
        "releaseMs": round(float(max(0.0, times[noise_end] - times[harmonic_end]) * 1000), 3),
        "releaseCensored": bool(release_censored),
        "stftHopMs": round(hop_s * 1000, 3),
    }


def validate_component_envelope_roundtrip() -> dict[str, Any]:
    """Known-envelope synthetic trust gate for the L17 temporal extractor."""
    sample_rate = 48_000
    t = np.arange(round(sample_rate * 1.8)) / sample_rate
    harmonic_envelope = np.clip((t - .20) / .025, 0, 1)
    harmonic_envelope *= np.where(t < 1.45, 1, np.exp(-38 * (t - 1.45)))
    harmonic = (.7 * np.sin(2 * np.pi * 440 * t) +
                .35 * np.sin(2 * np.pi * 880 * t)) * harmonic_envelope
    bow_envelope = np.clip((t - .14) / .08, 0, 1)
    bow_envelope *= np.where(t < .22, 1, .42 + .58 * np.exp(-18 * (t - .22)))
    bow_envelope *= np.where(t < 1.45, 1, np.exp(-28 * (t - 1.45)))
    rng = np.random.default_rng(54017)
    measured = component_envelope_evidence(
        harmonic + rng.standard_normal(len(t)) * bow_envelope * .055,
        sample_rate, 440)
    checks = {
        "noiseLeadMs": abs(float(measured["noiseLeadMs"]) - 60) <= 35,
        "peakOffsetMs": abs(float(measured["peakOffsetMs"]) - 20) <= 40,
        "settleFromPeakMs": 0 <= float(measured["settleFromPeakMs"]) <= 250,
        "releaseMs": not measured["releaseCensored"] and
                     0 <= float(measured["releaseMs"]) <= 250,
    }
    return {
        "schema": "sg2-component-envelope-validation-v1",
        "status": "pass" if all(checks.values()) else "fail",
        "injected": {"noiseLeadMs": 60, "peakOffsetMs": 20,
                     "releaseStartSec": 1.45},
        "measured": measured,
        "checks": checks,
    }


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
    if not np.any(finite):
        return math.nan, math.nan, math.nan
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


def validate_component_roundtrip(mixed: Path, harmonic_only: Path, f0: float,
                                 output: Path, *, instrument: str,
                                 component: str,
                                 band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> dict[str, Any]:
    """L17 generic trust gate, bound to one instrument/component contract."""
    assert_lossless_source(mixed)
    assert_lossless_source(harmonic_only)
    mixed_samples, sr_mixed = load_mono(mixed)
    harmonic_samples, sr_harmonic = load_mono(harmonic_only)
    if sr_mixed != sr_harmonic:
        raise ValueError("component round-trip WAVs use different sample rates")
    count = min(len(mixed_samples), len(harmonic_samples))
    injected = mixed_samples[:count] - harmonic_samples[:count]
    recovered = residual_spectrum(
        mixed_samples[:count], sr_mixed, f0, band_hz=band_hz)
    expected = broadband_spectrum(injected, sr_mixed)
    metrics = _shape_metrics(recovered.db, expected.db, recovered.centres, band_hz)
    passed = (metrics["correlation"] >= 0.90 and metrics["medianAbsDb"] <= 1.6
              and metrics["p95AbsDb"] <= 4.0)
    result = {
        "schema": "sg2-pinned-noise-validation-v1",
        "status": "pass" if passed else "fail",
        "instrument": instrument,
        "component": component,
        "componentClass": "pinnedPreOnsetNoise",
        "method": "synthetic harmonic+known-noise minus matched harmonic-only round trip",
        "f0Hz": round(float(f0), 4),
        "bandHz": [float(band_hz[0]), float(band_hz[1])],
        "tolerance": {"minCorrelation": 0.90, "maxMedianAbsDb": 1.6,
                      "maxP95AbsDb": 4.0},
        "metrics": metrics,
        "mixed": str(mixed),
        "harmonicOnly": str(harmonic_only),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if not passed:
        raise RuntimeError(
            f"synthetic {instrument}/{component} extractor validation failed: {metrics}")
    return result


def synthetic_component_roundtrip(output_dir: Path, *, instrument: str,
                                  component: str, f0: float = 130.813,
                                  band_hz: tuple[float, float] = DEFAULT_BAND_HZ) -> dict[str, Any]:
    """Create and consume a known harmonic+noise fixture for one contract."""
    output_dir.mkdir(parents=True, exist_ok=True)
    sample_rate = 48_000
    time = np.arange(round(sample_rate * 3.0)) / sample_rate
    edge = np.minimum(1.0, time / .035) * np.minimum(
        1.0, np.maximum(0.0, (3.0 - time) / .055))
    harmonic = edge * sum(
        .5 / rank * np.sin(2 * np.pi * f0 * rank * time + .13 * rank)
        for rank in range(1, min(32, int(12_000 // f0))))
    white = np.random.default_rng(14017).standard_normal(len(time))
    low = signal.sosfilt(signal.butter(
        3, [260 / (sample_rate / 2), 780 / (sample_rate / 2)],
        btype="bandpass", output="sos"), white)
    mid = signal.sosfilt(signal.butter(
        3, [1450 / (sample_rate / 2), 4100 / (sample_rate / 2)],
        btype="bandpass", output="sos"), white)
    high = signal.sosfilt(signal.butter(
        2, 6200 / (sample_rate / 2), btype="highpass", output="sos"), white)
    noise = (.13 * low + .045 * mid + .012 * high) * edge
    harmonic_path = output_dir / "synthetic-harmonic-only.wav"
    mixed_path = output_dir / "synthetic-harmonic-plus-component.wav"
    sf.write(harmonic_path, harmonic, sample_rate, subtype="FLOAT")
    sf.write(mixed_path, harmonic + noise,
             sample_rate, subtype="FLOAT")
    return validate_component_roundtrip(
        mixed_path, harmonic_path, f0, output_dir / "validation.json",
        instrument=instrument, component=component, band_hz=band_hz)


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
        if not matches:
            raise RuntimeError(f"expected Iowa sulE {dynamic} runs, found none")
        for (midi, segment, sample_rate, _, f0, cents,
             source) in select_chromatic_across_runs(matches, SULE_TARGETS):
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


def _median_summary(rows: list[dict[str, Any]], key: str) -> dict[str, float]:
    values = np.asarray([float(row[key]) for row in rows if row.get(key) is not None])
    if values.size == 0:
        return {"median": 0.0, "p25": 0.0, "p75": 0.0}
    return {
        "median": round(float(np.median(values)), 3),
        "p25": round(float(np.percentile(values, 25)), 3),
        "p75": round(float(np.percentile(values, 75)), 3),
    }


def _fit_bow_component_timing(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Fit violin's L17 placement/envelope in the shared consumer schema."""
    validation = validate_component_envelope_roundtrip()
    if validation["status"] != "pass":
        raise RuntimeError(
            f"synthetic bow component-envelope validation failed: {validation}")
    evidence = [{
        "path": row["path"], "dynamic": row["dynamic"],
        "velocity": VELOCITY[row["dynamic"]], "string": row["string"],
        "f0Hz": row["f0Hz"],
        **component_envelope_evidence(
            row["samples"], row["sampleRate"], row["f0Hz"]),
    } for row in records]
    envelope_keys = ("preOnsetSwellMs", "peakOffsetMs", "settleFromPeakMs",
                     "sustainBelowPeakDb", "releaseMs")
    by_dynamic = []
    placement_by_dynamic = []
    for dynamic in DYNAMICS:
        members = [row for row in evidence if row["dynamic"] == dynamic]
        by_dynamic.append({
            "dynamic": dynamic, "velocity": VELOCITY[dynamic],
            **{key: _median_summary(members, key) for key in envelope_keys},
        })
        placement_by_dynamic.append({
            "dynamic": dynamic, "velocity": VELOCITY[dynamic],
            "noiseLeadMs": _median_summary(members, "noiseLeadMs"),
        })
    return {
        "componentEnvelopeValidation": validation,
        "placementLaw": {
            "model": "linear interpolation of per-dynamic residual-envelope lead; positive leads tone t0",
            "sense": "f0-comb residual track relative to harmonic track",
            "byDynamic": placement_by_dynamic,
            "allNotes": _median_summary(evidence, "noiseLeadMs"),
        },
        "envelope": {
            "model": "independent piecewise pre-onset swell/peak/settle/sustain/release envelope",
            "toneAdsrSlave": False,
            "byDynamic": by_dynamic,
            "allNotes": {key: _median_summary(evidence, key)
                         for key in envelope_keys},
            "releaseCensoredNotes": sum(
                bool(row["releaseCensored"]) for row in evidence),
            "perNoteEvidence": evidence,
        },
    }


def _load_component_manifest(records_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from scripts.tone_match.score import extract_features

    manifest = json.loads(records_path.read_text())
    if not isinstance(manifest, dict) or not isinstance(manifest.get("records"), list):
        raise ValueError("component records manifest must be an object with a records list")
    instrument = str(manifest.get("instrument", ""))
    component = str(manifest.get("component", ""))
    if component == "windBreath" and instrument not in WIND_INSTRUMENTS:
        raise ValueError(f"windBreath extraction is scoped to {sorted(WIND_INSTRUMENTS)}, got {instrument!r}")
    band = tuple(float(value) for value in manifest.get("bandHz", DEFAULT_BAND_HZ))
    if len(band) != 2 or band[0] <= 0 or band[1] <= band[0]:
        raise ValueError(f"invalid component bandHz: {band}")
    records = []
    for index, source in enumerate(manifest["records"]):
        path = Path(source["path"])
        if not path.is_absolute():
            path = (records_path.parent / path).resolve()
        assert_lossless_source(path, source.get("sourceFile"))
        samples, sample_rate = load_mono(path)
        active_duration = source.get("durationSec")
        active_count = (min(len(samples), round(float(active_duration) * sample_rate))
                        if active_duration is not None else len(samples))
        f0 = float(source.get("expectedF0Hz", source.get("f0Hz", 0)))
        if f0 <= 0:
            raise ValueError(f"record {index} has no positive expectedF0Hz/f0Hz")
        envelope = component_envelope_evidence(
            samples, sample_rate, f0, band_hz=band)
        extractor_lead = envelope["noiseLeadMs"]
        try:
            canonical = extract_features(
                path, active_duration_s=active_duration, expected_f0_hz=f0,
                trust_expected_f0=True,
                release_expected=bool(source.get("hasRelease")))
            envelope["noiseLeadMs"] = round(float(canonical.noise_lead_ms), 3)
            envelope["noiseLeadSense"] = "canonical score.py noise_lead_ms"
            envelope["canonicalNoiseLeadStatus"] = "measured"
        except (ValueError, RuntimeError) as exc:
            # The spectral residual remains valid under the pinned expected
            # f0 even when score.py cannot form a full multi-feature bundle.
            # Preserve the independently validated component-track lead and
            # log the fallback rather than dropping a pitch from its pool.
            envelope["noiseLeadMs"] = extractor_lead
            envelope["noiseLeadSense"] = "validated component-envelope track"
            envelope["canonicalNoiseLeadStatus"] = f"fallback: {exc}"
        envelope["envelopeTrackLeadMs"] = extractor_lead
        records.append({
            **source,
            "path": str(path),
            "f0Hz": f0,
            "dynamic": str(source["dynamic"]),
            "velocity": float(source["velocity"]),
            "poolGroup": str(source.get("poolGroup", "default")),
            "samples": samples,
            "spectralSamples": samples[:active_count],
            "sampleRate": sample_rate,
            "envelopeEvidence": envelope,
        })
    if not records:
        raise ValueError("component records manifest is empty")
    for dynamic in sorted({row["dynamic"] for row in records}):
        pitches = {round(row["f0Hz"], 3) for row in records if row["dynamic"] == dynamic}
        if len(pitches) < 2:
            raise ValueError(
                f"L17 cross-pitch gate requires >=2 pitches within dynamic {dynamic}; got {sorted(pitches)}")
    return {**manifest, "bandHz": band, "instrument": instrument,
            "component": component}, records


def _fit_generic_level_law(records: list[dict[str, Any]], dynamics: list[str],
                           level_control: str) -> dict[str, Any]:
    rungs = []
    for dynamic in dynamics:
        members = [row for row in records if row["dynamic"] == dynamic]
        rungs.append({
            "dynamic": dynamic,
            "velocity": round(float(np.median([row["velocity"] for row in members])), 4),
            "noisePowerDb": round(float(np.median([
                row["standard"].noise_power_db for row in members])), 3),
            "noiseToHarmonicDb": round(float(np.median([
                row["standard"].nhr_db for row in members])), 3),
        })
    velocities = np.asarray([row["velocity"] for row in rungs])
    noise_db = np.asarray([row["noisePowerDb"] for row in rungs])
    if len(rungs) >= 2 and len(set(velocities)) >= 2:
        exponent, intercept = np.polyfit(20 * np.log10(velocities), noise_db, 1)
        fitted = intercept + exponent * 20 * np.log10(velocities)
    else:
        exponent, intercept = 1.0, float(noise_db[0])
        fitted = np.asarray([intercept])
    wind_breath = level_control == "windBreathLevel"
    return {
        "model": ("amplitude = windBreathLevel * existingWindBreathLaw("
                  "toneBreath, velocity, airflowEnvelope, inefficiency)"
                  if wind_breath else
                  f"amplitude = {level_control} * velocity ** velocityExponent"),
        "retainsExistingTerms": (["toneBreath", "velocityExponent",
                                  "airflowEnvelope", "inefficiencyLaw",
                                  "turbulenceLaw", "bodyRouting"]
                                 if wind_breath else []),
        "measuredAbsoluteVelocityExponent": round(float(np.clip(exponent, -2, 3)), 4),
        "velocityExponent": round(float(np.clip(exponent, -2, 3)), 4),
        "interceptNoisePowerDbAtVelocity1": round(float(intercept), 3),
        "fitRmseDb": round(float(np.sqrt(np.mean((noise_db - fitted) ** 2))), 3),
        "rungs": rungs,
    }


def prepare_wind_manifest(references: Path, instrument: str, output: Path) -> dict[str, Any]:
    """Select the lossless Iowa pp/ff cross-pitch rows from a campaign."""
    if instrument not in WIND_INSTRUMENTS:
        raise ValueError(f"wind manifest instrument must be one of {sorted(WIND_INSTRUMENTS)}")
    data = json.loads(references.read_text())
    rows = data.get("references", data) if isinstance(data, dict) else data
    selected, excluded = [], []
    for row in rows:
        source_file = str(row.get("sourceFile", ""))
        suffix = Path(source_file).suffix.lower()
        if suffix not in {".aif", ".aiff"}:
            excluded.append({"sourceFile": source_file,
                             "reason": "lossy/non-AIFF source provenance excluded by L14/L17"})
            continue
        if row.get("dynamic") not in {"pp", "ff"}:
            continue
        path = Path(row["path"])
        assert_lossless_source(path, source_file)
        selected.append({key: row[key] for key in (
            "path", "sourceFile", "dynamic", "velocity", "expectedF0Hz",
            "midi", "register", "durationSec", "hasRelease") if key in row})
    if len(selected) != 6:
        raise RuntimeError(
            f"expected exactly six Iowa AIFF-provenance pp/ff rows for {instrument}; "
            f"found {len(selected)}")
    manifest = {
        "schema": "sg2-pinned-noise-records-v1",
        "instrument": instrument,
        "component": "windBreath",
        "componentClass": "pinnedPreOnsetNoise",
        "levelControl": "windBreathLevel",
        "bandHz": list(DEFAULT_BAND_HZ),
        "source": "Iowa MIS lossless AIFF-derived campaign references only",
        "excluded": excluded,
        "records": sorted(selected, key=lambda row: (row["velocity"], row["expectedF0Hz"])),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def prepare_dense_wind_manifest(samples_root: Path, instrument: str,
                                output: Path) -> dict[str, Any]:
    """Segment every admissible note in the lossless Iowa chromatic runs."""
    if instrument not in WIND_INSTRUMENTS:
        raise ValueError(f"wind manifest instrument must be one of {sorted(WIND_INSTRUMENTS)}")
    references_dir = output.parent / "dense-references"
    references_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for source_name, midis in WIND_DENSE_RUNS[instrument].items():
        source = samples_root / WIND_SAMPLE_DIRS[instrument] / source_name
        assert_lossless_source(source, source_name)
        dynamic = "pp" if ".pp." in source_name else "ff"
        velocity = 0.2 if dynamic == "pp" else 0.92
        selected = select_chromatic_run(source, midis)
        if len(selected) != len(midis):
            raise RuntimeError(
                f"{source}: selected {len(selected)} notes for {len(midis)} MIDI anchors")
        for midi, segment, sample_rate, measured_f0 in selected:
            target = references_dir / f"{source.stem}-m{midi}.wav"
            peak = float(np.max(np.abs(segment)))
            if peak > 0.99:
                segment = segment * (0.99 / peak)
            sf.write(target, segment, sample_rate, subtype="PCM_24")
            records.append({
                "path": str(target.resolve()),
                "sourceFile": source.name,
                "dynamic": dynamic,
                "velocity": velocity,
                "expectedF0Hz": round(float(measured_f0), 6),
                "midi": midi,
                "poolGroup": source.name,
                "durationSec": round(max(0.5, min(2.0, len(segment) / sample_rate * 0.72)), 6),
                "hasRelease": True,
            })
    manifest = {
        "schema": "sg2-pinned-noise-records-v1",
        "instrument": instrument,
        "component": "windBreath",
        "componentClass": "pinnedPreOnsetNoise",
        "levelControl": "windBreathLevel",
        "bandHz": list(DEFAULT_BAND_HZ),
        "source": "dense Iowa MIS lossless chromatic AIFF runs, canonically segmented",
        "excluded": [{"source": "Philharmonia MP3",
                      "reason": "lossy coding corrupts low-level broadband noise floors"}],
        "segmentation": {
            "method": "build_campaign.select_chromatic_run",
            "sourceRuns": len(WIND_DENSE_RUNS[instrument]),
            "uniqueSegmentsRequired": True,
        },
        "records": sorted(records, key=lambda row: (
            row["velocity"], row["sourceFile"], row["midi"])),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def prepare_dense_bowed_manifest(samples_root: Path, instrument: str,
                                 output: Path) -> dict[str, Any]:
    """Segment the lossless Iowa pp/mf/ff corpus for a bowed L14 profile.

    Every pool is one string and one dynamic, and must contain multiple
    pitches.  This makes the fixed-in-Hz residual the separator while keeping
    string-specific mechanics and the per-dynamic ladder explicit.
    """
    if instrument not in {"violin", "cello"}:
        raise ValueError("dense bowed manifest supports violin or cello")
    references_dir = output.parent / "dense-references"
    references_dir.mkdir(parents=True, exist_ok=True)
    records, excluded = [], [{
        "source": "Philharmonia MP3",
        "reason": "lossy coding corrupts low-level broadband noise floors",
    }]
    prefix = instrument.capitalize()
    for source in sorted(samples_root.glob(f"{prefix}.arco.*.sul*.*.aiff")):
        dynamic = next((value for value in DYNAMICS
                        if f".{value}." in source.name), None)
        string = parse_string_label(source.name)
        span = iowa_filename_span(source)
        if dynamic is None or string is None or span is None:
            excluded.append({"source": source.name,
                             "reason": "missing dynamic/string/pitch-span label"})
            continue
        midis = tuple(range(span[0], span[1] + 1))
        if len(midis) < 2:
            excluded.append({"source": source.name,
                             "reason": "single-pitch run cannot prove cross-pitch residual"})
            continue
        assert_lossless_source(source, source.name)
        try:
            selected = select_chromatic_segments(source, midis)
        except RuntimeError as exc:
            excluded.append({"source": source.name,
                             "reason": f"canonical segmentation failed: {exc}"})
            continue
        for midi, segment, sample_rate, _raw_f0, f0, cents in selected:
            target = references_dir / f"{source.stem}-m{midi}.wav"
            peak = float(np.max(np.abs(segment)))
            if peak > .99:
                segment = segment * (.99 / peak)
            sf.write(target, segment, sample_rate, subtype="PCM_24")
            records.append({
                "path": str(target.resolve()), "sourceFile": source.name,
                "dynamic": dynamic, "velocity": VELOCITY[dynamic],
                "string": string, "poolGroup": string,
                "expectedF0Hz": round(float(f0), 6), "midi": midi,
                "pitchErrorCents": round(float(cents), 3),
                "durationSec": round(max(.5, min(2.0, len(segment) /
                                                  sample_rate * .72)), 6),
                "hasRelease": True,
            })
    required = {(dynamic, string) for dynamic in DYNAMICS
                for string in ("sulC", "sulG", "sulD", "sulA")}
    if instrument == "violin":
        required = {(dynamic, string) for dynamic in DYNAMICS
                    for string in ("sulG", "sulD", "sulA", "sulE")}
    counts = {(dynamic, string): sum(
        row["dynamic"] == dynamic and row["string"] == string for row in records)
        for dynamic, string in required}
    weak = {f"{dynamic}/{string}": count for (dynamic, string), count in counts.items()
            if count < 2}
    if weak:
        raise RuntimeError(f"bowed L14 requires >=2 pitches per string/dynamic: {weak}")
    manifest = {
        "schema": "sg2-pinned-noise-records-v1", "instrument": instrument,
        "component": "bowNoise", "componentClass": "pinnedPreOnsetNoise",
        "levelControl": "bowNoiseLevel", "bandHz": list(DEFAULT_BAND_HZ),
        "source": f"{instrument}-owned dense Iowa lossless AIFF corpus only",
        "excluded": excluded,
        "poolingContract": "cross-pitch within string and dynamic; values never transfer",
        "dynamicLadder": list(DYNAMICS),
        "records": sorted(records, key=lambda row: (
            row["velocity"], row["string"], row["expectedF0Hz"], row["sourceFile"])),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def extract_pinned_component(records_path: Path, validation: Path,
                             output: Path, measured: Path | None = None) -> dict[str, Any]:
    """Extract one L17 component without forking the L14 separator."""
    manifest, records = _load_component_manifest(records_path)
    instrument, component = manifest["instrument"], manifest["component"]
    band_hz = manifest["bandHz"]
    validation_data = json.loads(validation.read_text())
    expected_gate = {
        "schema": "sg2-pinned-noise-validation-v1",
        "status": "pass", "instrument": instrument, "component": component,
    }
    mismatches = {key: (validation_data.get(key), value)
                  for key, value in expected_gate.items()
                  if validation_data.get(key) != value}
    if mismatches:
        raise RuntimeError(
            f"real {instrument}/{component} extraction is gated by its matching "
            f"passing synthetic validation artifact: {mismatches}")
    if tuple(validation_data.get("bandHz", ())) != tuple(band_hz):
        raise RuntimeError("validation and extraction bandHz do not match")

    for row in records:
        samples, sr, f0 = row["spectralSamples"], row["sampleRate"], row["f0Hz"]
        base_nfft = 8192 if f0 < 120 else 4096
        row["standard"] = residual_spectrum(
            samples, sr, f0, nfft=base_nfft, band_hz=band_hz)
        row["mask25"] = residual_spectrum(
            samples, sr, f0, nfft=base_nfft, mask_cents=25, band_hz=band_hz)
        row["mask50"] = residual_spectrum(
            samples, sr, f0, nfft=base_nfft, mask_cents=50, band_hz=band_hz)
        row["winLow"] = residual_spectrum(
            samples, sr, f0, nfft=base_nfft // 2, band_hz=band_hz)
        row["winHigh"] = residual_spectrum(
            samples, sr, f0, nfft=base_nfft * 2, band_hz=band_hz)
        row["ambient"] = ambient_spectrum(
            Path(row["path"]), nfft=base_nfft)
    centres = records[0]["standard"].centres
    dynamics = sorted({row["dynamic"] for row in records},
                      key=lambda dynamic: np.median([
                          row["velocity"] for row in records if row["dynamic"] == dynamic]))
    group_profiles: dict[tuple[str, str], np.ndarray] = {}
    cross_pitch = []
    for dynamic in dynamics:
        for pool_group in sorted({row["poolGroup"] for row in records
                                  if row["dynamic"] == dynamic}):
            members = [row for row in records if row["dynamic"] == dynamic
                       and row["poolGroup"] == pool_group]
            if len({round(row["f0Hz"], 3) for row in members}) < 2:
                raise ValueError(
                    f"cross-pitch pool {dynamic}/{pool_group} has fewer than two pitches")
            # Corpus files are chromatic runs of unequal length.  Weighting
            # every segmented note equally lets an eleven-note run dominate a
            # four-note run and confounds player/session drift with the fixed
            # component.  Form one robust profile per source run, then give
            # each run one vote.  No take is excluded.
            source_keys = sorted({str(row.get("sourceFile") or row["path"])
                                  for row in members})
            source_members = {
                source: [row for row in members
                         if str(row.get("sourceFile") or row["path"]) == source]
                for source in source_keys
            }
            source_profiles = {
                source: _median_profile(row["standard"] for row in rows)
                for source, rows in source_members.items()
            }
            common = _nanmedian(np.asarray(list(source_profiles.values())), axis=0)
            legacy_note_weighted_common = _median_profile(
                row["standard"] for row in members)
            group_profiles[(dynamic, pool_group)] = common
            note_metrics = [
                _shape_metrics(row["standard"].db, common, centres, band_hz)
                for row in members]
            source_metrics = {
                source: _shape_metrics(profile, common, centres, band_hz)
                for source, profile in source_profiles.items()
            }
            source_diagnostics = []
            for source in source_keys:
                within = [_shape_metrics(row["standard"].db,
                                         source_profiles[source], centres, band_hz)
                          for row in source_members[source]]
                source_diagnostics.append({
                    "sourceFile": source,
                    "notes": len(source_members[source]),
                    "withinRunMedianShapeErrorDb": round(float(np.median([
                        metric["medianAbsDb"] for metric in within])), 3),
                    "toBalancedCommonCorrelation": source_metrics[source]["correlation"],
                    "toBalancedCommonShapeErrorDb": source_metrics[source]["medianAbsDb"],
                })
            source_shape_errors = [metric["medianAbsDb"]
                                   for metric in source_metrics.values()]
            note_shape_error = float(np.median([
                metric["medianAbsDb"] for metric in note_metrics]))
            legacy_note_shape_error = float(np.median([
                _shape_metrics(row["standard"].db, legacy_note_weighted_common,
                               centres, band_hz)["medianAbsDb"]
                for row in members]))
            source_shape_error = float(np.median(source_shape_errors))
            source_contamination_evidence = any(
                row["toBalancedCommonShapeErrorDb"] > 3
                for row in source_diagnostics)
            if legacy_note_shape_error > 3 and source_shape_error <= 3:
                diagnosis = "unequal-run-segmentation-weighting-not-contamination"
            elif source_shape_error > 3 and all(
                    row["withinRunMedianShapeErrorDb"] <= 3
                    for row in source_diagnostics):
                diagnosis = "real-between-run-variation"
            elif source_shape_error > 3:
                diagnosis = "possible-pool-contamination"
            else:
                diagnosis = "cross-pitch-common-after-run-balancing"
            cross_pitch.append({
                "dynamic": dynamic, "poolGroup": pool_group, "notes": len(members),
                "sourceRuns": len(source_keys),
                "aggregation": "median within source run, then equal-weight median across runs",
                "pitchesHz": sorted(round(row["f0Hz"], 3) for row in members),
                "medianPitchCorrelation": round(float(np.median([
                    metric["correlation"] for metric in source_metrics.values()])), 4),
                "medianPitchShapeErrorDb": round(float(np.median([
                    metric["medianAbsDb"] for metric in source_metrics.values()])), 3),
                "unbalancedPerNoteMedianShapeErrorDb": round(note_shape_error, 3),
                "legacyNoteWeightedMedianShapeErrorDb": round(
                    legacy_note_shape_error, 3),
                "overageDiagnosis": diagnosis,
                "poolContaminationEvidence": source_contamination_evidence,
                "sourceRunDiagnostics": source_diagnostics,
            })
    by_dynamic = {}
    failed_cross_pitch = [row for row in cross_pitch
                          if row["medianPitchShapeErrorDb"] > 3.0]
    for dynamic in dynamics:
        profiles = [_normalise(profile, centres, band_hz)
                    for (candidate, _), profile in group_profiles.items()
                    if candidate == dynamic]
        by_dynamic[dynamic] = _nanmedian(np.asarray(profiles), axis=0)
    pooled = _nanmedian(np.asarray([by_dynamic[dynamic] for dynamic in dynamics]), axis=0)

    standard = _nanmedian(np.asarray([row["standard"].db for row in records]), axis=0)
    mask25 = _nanmedian(np.asarray([row["mask25"].db for row in records]), axis=0)
    mask50 = _nanmedian(np.asarray([row["mask50"].db for row in records]), axis=0)
    win_low = _nanmedian(np.asarray([row["winLow"].db for row in records]), axis=0)
    win_high = _nanmedian(np.asarray([row["winHigh"].db for row in records]), axis=0)
    pitch_mad = _nanmedian(np.abs(np.asarray([
        _normalise(row["standard"].db, centres, band_hz) for row in records]) - pooled), axis=0)
    mask_sensitivity = _nanmax(np.abs(np.vstack([
        _normalise(mask25, centres, band_hz) - _normalise(standard, centres, band_hz),
        _normalise(mask50, centres, band_hz) - _normalise(standard, centres, band_hz)])), axis=0)
    window_sensitivity = _nanmax(np.abs(np.vstack([
        _normalise(win_low, centres, band_hz) - _normalise(standard, centres, band_hz),
        _normalise(win_high, centres, band_hz) - _normalise(standard, centres, band_hz)])), axis=0)
    in_band = (centres >= band_hz[0]) & (centres <= band_hz[1])
    source_snrs = np.asarray([
        row["standard"].db - row["ambient"].db for row in records])
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        source_snr_p25 = np.nanpercentile(source_snrs, 25, axis=0)
    rejected = in_band & ((pitch_mad > 6) | (mask_sensitivity > 3) |
                          (window_sensitivity > 3) | (source_snr_p25 <= 0))
    retained = in_band & ~rejected & np.isfinite(pooled)
    if np.count_nonzero(retained) < 8:
        raise RuntimeError(
            f"artifact gate left only {np.count_nonzero(retained)} pinned bands")
    profile = [{"freqHz": round(float(centres[index]), 1),
                "gainDb": round(float(pooled[index]), 3)}
               for index in np.where(retained)[0]]
    profiles_by_dynamic = {
        dynamic: [{"freqHz": round(float(centres[index]), 1),
                   "gainDb": round(float(by_dynamic[dynamic][index]), 3)}
                  for index in np.where(retained & np.isfinite(by_dynamic[dynamic]))[0]]
        for dynamic in dynamics
    }
    comparisons = []
    for index, left in enumerate(dynamics):
        for right in dynamics[index + 1:]:
            comparisons.append({"pair": f"{left}-{right}",
                                **_shape_metrics(by_dynamic[left], by_dynamic[right], centres, band_hz)})
    shape_stable = all(row["correlation"] >= 0.9 and row["medianAbsDb"] <= 3
                       for row in comparisons)

    evidence = [row["envelopeEvidence"] for row in records]
    by_dynamic_envelope = []
    envelope_keys = ("preOnsetSwellMs", "peakOffsetMs", "settleFromPeakMs",
                     "sustainBelowPeakDb", "releaseMs")
    for dynamic in dynamics:
        members = [row["envelopeEvidence"] for row in records
                   if row["dynamic"] == dynamic]
        by_dynamic_envelope.append({
            "dynamic": dynamic,
            "velocity": round(float(np.median([row["velocity"] for row in records
                                                if row["dynamic"] == dynamic])), 4),
            **{key: _median_summary(members, key) for key in envelope_keys},
        })
    placement = {
        "model": "linear interpolation of per-dynamic median noise_lead_ms; positive leads tone t0",
        "sense": "canonical score.py noise_lead_ms",
        "byDynamic": [{
            "dynamic": dynamic,
            "velocity": round(float(np.median([row["velocity"] for row in records
                                                if row["dynamic"] == dynamic])), 4),
            "noiseLeadMs": _median_summary([
                row["envelopeEvidence"] for row in records if row["dynamic"] == dynamic],
                "noiseLeadMs"),
        } for dynamic in dynamics],
        "allNotes": _median_summary(evidence, "noiseLeadMs"),
    }
    envelope = {
        "model": "independent piecewise pre-onset swell/peak/settle/sustain/release envelope",
        "toneAdsrSlave": False,
        "byDynamic": by_dynamic_envelope,
        "allNotes": {key: _median_summary(evidence, key) for key in envelope_keys},
        "releaseCensoredNotes": sum(bool(row["releaseCensored"]) for row in evidence),
        "perNoteEvidence": [{
            "path": row["path"], "dynamic": row["dynamic"], "f0Hz": row["f0Hz"],
            **row["envelopeEvidence"],
        } for row in records],
    }
    level_control = str(manifest.get("levelControl", f"{component}Level"))
    level_law = _fit_generic_level_law(records, dynamics, level_control)
    result = {
        "schema": "sg2-pinned-noise-component-v1",
        "status": ("rejected-cross-pitch-commonality" if failed_cross_pitch else
                   "accepted-pinned-component"),
        "instrument": instrument,
        "component": component,
        "componentClass": "pinnedPreOnsetNoise",
        "method": ("f0 harmonic subtraction + per-source-run median + "
                   "equal-weight per-dynamic cross-pitch median"),
        "source": manifest.get("source", "lossless corpus records"),
        "excluded": manifest.get("excluded", []),
        "validation": validation_data,
        "notes": len(records),
        "notesByDynamic": {dynamic: sum(row["dynamic"] == dynamic for row in records)
                           for dynamic in dynamics},
        "bandHz": [float(band_hz[0]), float(band_hz[1])],
        "profilePinned": not bool(failed_cross_pitch),
        "activationEligible": not bool(failed_cross_pitch),
        "profile": profile,
        "profilesByDynamic": profiles_by_dynamic,
        "shapeStableAcrossDynamics": shape_stable,
        "dynamicShapeComparisons": comparisons,
        "crossPitchGroups": cross_pitch,
        "crossPitchGate": {
            "passed": not bool(failed_cross_pitch),
            "medianShapeErrorDbMax": 3.0,
            "failedGroups": failed_cross_pitch,
        },
        "levelLaw": level_law,
        "placementLaw": placement,
        "envelope": envelope,
        "bandEvidence": {
            "floorMethod": "quietest 20% of STFT frames in each lossless note source",
            "minimumP25SourceSnrDb": round(float(np.nanmin(source_snr_p25[retained])), 3),
            "minimumRequiredP25SourceSnrDb": 0.0,
        },
        "artifactScreen": {
            "harmonicMaskCents": [25, 35, 50],
            "welchNfft": "f0-scaled: 4096/8192/16384 below 120 Hz; 2048/4096/8192 otherwise",
            "flagThresholds": {"pitchMadDb": 6, "maskSensitivityDb": 3,
                               "windowSensitivityDb": 3, "sourceSnrP25Db": 0},
            "flaggedBands": [{
                "freqHz": round(float(centres[index]), 1),
                "pitchMadDb": round(float(pitch_mad[index]), 3),
                "maskSensitivityDb": round(float(mask_sensitivity[index]), 3),
                "windowSensitivityDb": round(float(window_sensitivity[index]), 3),
                "sourceSnrP25Db": round(float(source_snr_p25[index]), 3),
            } for index in np.where(rejected)[0]],
        },
        "engineContract": {
            "component": component, "componentClass": "pinnedPreOnsetNoise",
            "bodyRouting": 1, "levelControl": level_control,
            "excitationTypes": (["blow"] if component == "windBreath" else
                                ["bow"] if component == "bowNoise" else []),
            "shapeOptimiserMutable": False, "preOnsetCapable": True,
            "independentEnvelopeRequired": True,
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if measured is not None and not failed_cross_pitch:
        measured_data = json.loads(measured.read_text())
        target = measured_data[instrument].setdefault("pinnedNoiseComponents", {})
        target[component] = {key: result[key] for key in (
            "componentClass", "method", "source", "excluded", "bandHz",
            "bandEvidence", "profilePinned", "profile", "profilesByDynamic",
            "shapeStableAcrossDynamics", "dynamicShapeComparisons", "crossPitchGroups",
            "levelLaw", "placementLaw", "envelope", "artifactScreen", "engineContract")}
        measured.write_text(json.dumps(measured_data, indent=1) + "\n")
    return result


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
    component_timing = _fit_bow_component_timing(records)
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
        **component_timing,
        "artifactScreen": {
            "harmonicMaskCents": [25, 35, 50], "welchNfft": [2048, 4096, 8192],
            "vibrato": "Iowa arco non-vibrato only; no vibrato smear admitted",
            "flagThresholds": {"pitchMadDb": 6, "maskSensitivityDb": 3,
                               "windowSensitivityDb": 3},
            "flaggedBands": leakage,
        },
        "engineContract": {
            "component": "bowNoise", "bodyRouting": 1,
            "userControl": "bowNoiseLevel", "levelControl": "bowNoiseLevel",
            "excitationTypes": ["bow"], "shapeOptimiserMutable": False,
            "preOnsetCapable": True, "independentEnvelopeRequired": True,
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
                                        "dynamicShapeComparisons", "levelLaw",
                                        "componentEnvelopeValidation",
                                        "placementLaw", "envelope", "artifactScreen",
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
    validate_component = sub.add_parser(
        "validate-component", help="L17 generic synthetic component round trip")
    validate_component.add_argument("--mixed", type=Path, required=True)
    validate_component.add_argument("--harmonic-only", type=Path, required=True)
    validate_component.add_argument("--f0", type=float, required=True)
    validate_component.add_argument("--instrument", required=True)
    validate_component.add_argument("--component", required=True)
    validate_component.add_argument("--band-hz", type=float, nargs=2,
                                    default=DEFAULT_BAND_HZ, metavar=("LOW", "HIGH"))
    validate_component.add_argument("--output", type=Path, required=True)
    extract_component = sub.add_parser(
        "extract-component", help="L17 generic gated pinned-component extraction")
    extract_component.add_argument("--records", type=Path, required=True)
    extract_component.add_argument("--validation", type=Path, required=True)
    extract_component.add_argument("--output", type=Path, required=True)
    extract_component.add_argument("--measured", type=Path)
    prepare_wind = sub.add_parser(
        "prepare-wind", help="select lossless Iowa wind-breath records")
    prepare_wind.add_argument("--references", type=Path, required=True)
    prepare_wind.add_argument("--instrument", choices=sorted(WIND_INSTRUMENTS), required=True)
    prepare_wind.add_argument("--output", type=Path, required=True)
    prepare_dense = sub.add_parser(
        "prepare-wind-dense", help="segment dense lossless Iowa wind runs")
    prepare_dense.add_argument("--samples", type=Path, required=True)
    prepare_dense.add_argument("--instrument", choices=sorted(WIND_INSTRUMENTS), required=True)
    prepare_dense.add_argument("--output", type=Path, required=True)
    prepare_bowed = sub.add_parser(
        "prepare-bowed-dense", help="segment dense lossless Iowa bowed runs")
    prepare_bowed.add_argument("--samples", type=Path, required=True)
    prepare_bowed.add_argument("--instrument", choices=("violin", "cello"), required=True)
    prepare_bowed.add_argument("--output", type=Path, required=True)
    synthetic_component = sub.add_parser(
        "synthetic-component", help="generate and validate a component fixture")
    synthetic_component.add_argument("--instrument", required=True)
    synthetic_component.add_argument("--component", required=True)
    synthetic_component.add_argument("--f0", type=float, default=130.813)
    synthetic_component.add_argument("--band-hz", type=float, nargs=2,
                                     default=DEFAULT_BAND_HZ, metavar=("LOW", "HIGH"))
    synthetic_component.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "validate":
        result = validate_engine_roundtrip(args.mixed, args.harmonic_only, args.f0, args.output)
    elif args.command == "extract":
        result = extract_iowa(args.body_references, args.samples, args.validation,
                              args.output, args.measured)
    elif args.command == "validate-component":
        result = validate_component_roundtrip(
            args.mixed, args.harmonic_only, args.f0, args.output,
            instrument=args.instrument, component=args.component,
            band_hz=tuple(args.band_hz))
    elif args.command == "extract-component":
        result = extract_pinned_component(
            args.records, args.validation, args.output, args.measured)
    elif args.command == "prepare-wind":
        result = prepare_wind_manifest(args.references, args.instrument, args.output)
    elif args.command == "prepare-wind-dense":
        result = prepare_dense_wind_manifest(
            args.samples, args.instrument, args.output)
    elif args.command == "prepare-bowed-dense":
        result = prepare_dense_bowed_manifest(
            args.samples, args.instrument, args.output)
    else:
        result = synthetic_component_roundtrip(
            args.output, instrument=args.instrument, component=args.component,
            f0=args.f0, band_hz=tuple(args.band_hz))
    print(json.dumps({"status": "ok", "output": str(args.output),
                      "summary": {key: result.get(key) for key in
                                  ("schema", "status", "notes", "shapeStableAcrossDynamics")}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
