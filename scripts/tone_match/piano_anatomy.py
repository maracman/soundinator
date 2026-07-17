#!/usr/bin/env python3
"""L16/L17/L18 piano-note anatomy extraction.

The extractor keeps three mechanisms separate:

* L16: partial/band envelopes that deviate from the instrument's fitted
  frequency-dependent two-stage baseline;
* L17: pitch-invariant residual action noise, including its own envelope
  relative to harmonic onset;
* L18: held-key free decay and an independently detected damper-contact knee.

Real-corpus extraction is refused until the same implementation recovers
known injected components in a synthetic round trip.
"""

from __future__ import annotations

import argparse
import json
import math
import warnings
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal
import soundfile as sf

from .score import hold_decay_metrics


SCHEMA = "sg2-piano-anatomy-v1"
VALIDATION_SCHEMA = "sg2-piano-anatomy-validation-v1"
PRE_ROLL_SCHEMA = "sg2-piano-action-pre-roll-audit-v1"
BANDS_PER_OCTAVE = 6


def _load(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    return np.mean(samples, axis=1), int(sample_rate)


def _stft(samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    size = min(4096, max(1024, 2 ** int(math.floor(math.log2(max(1024, sample_rate * .08))))))
    freqs, times, spectrum = signal.stft(
        samples, fs=sample_rate, window="hann", nperseg=size,
        noverlap=size - max(64, size // 16), boundary=None, padded=False)
    return freqs, times, np.maximum(np.abs(spectrum) ** 2, 1e-20)


def _action_stft(samples: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    size = 512 if sample_rate >= 16000 else 256
    freqs, times, spectrum = signal.stft(
        samples, fs=sample_rate, window="hann", nperseg=size,
        noverlap=size - max(32, size // 16), boundary=None, padded=False)
    return freqs, times, np.maximum(np.abs(spectrum) ** 2, 1e-20)


def _harmonic_mask(freqs: np.ndarray, f0: float, width_cents: float = 45) -> np.ndarray:
    mask = np.zeros(len(freqs), dtype=bool)
    bin_hz = freqs[1] - freqs[0]
    for harmonic in range(1, int(freqs[-1] // f0) + 1):
        centre = harmonic * f0
        half = max(2 * bin_hz, centre * (2 ** (width_cents / 1200) - 1))
        mask |= np.abs(freqs - centre) <= half
    return mask


def _tone_onset(freqs: np.ndarray, times: np.ndarray, power: np.ndarray,
                f0: float) -> float:
    harmonic = np.zeros(power.shape[1])
    for rank in range(1, min(24, int(freqs[-1] // f0)) + 1):
        centre = rank * f0
        bins = np.abs(freqs - centre) <= max(2 * (freqs[1] - freqs[0]), centre / 80)
        harmonic += np.sum(power[bins], axis=0)
    peak = float(np.max(harmonic))
    threshold = peak * 10 ** (-28 / 10)
    total = np.sum(power[(freqs >= 40) & (freqs <= min(14000, freqs[-1]))], axis=0)
    share = harmonic / np.maximum(total, 1e-20)
    share_threshold = max(.18, .45 * float(np.max(share)))
    active = (harmonic >= threshold) & (share >= share_threshold)
    for index in range(max(0, len(active) - 2)):
        if np.all(active[index:index + 3]):
            return float(times[index])
    return float(times[int(np.argmax(harmonic))])


def _track_metrics(times: np.ndarray, track_db: np.ndarray, onset: float,
                   baseline_rate: float | None = None) -> dict[str, float] | None:
    relative = times - onset
    onset_mask = (relative >= -.015) & (relative <= .070)
    early_mask = (relative >= .080) & (relative <= .380)
    late_mask = (relative >= .650) & (relative <= 2.40)
    if np.count_nonzero(onset_mask) < 2 or np.count_nonzero(early_mask) < 4:
        return None
    onset_level = float(np.max(track_db[onset_mask]))
    early_t, early_y = relative[early_mask], track_db[early_mask]
    early_slope, early_intercept = np.polyfit(early_t, early_y, 1)
    early_rate = max(0.0, -float(early_slope))
    late_rate = None
    if np.count_nonzero(late_mask) >= 5:
        late_rate = max(0.0, -float(np.polyfit(
            relative[late_mask], track_db[late_mask], 1)[0]))
    rate = early_rate if baseline_rate is None else max(0.0, baseline_rate)
    predicted_onset = float(early_intercept)  # extrapolated early law at t=0
    return {
        "onsetLevelDb": onset_level,
        "onsetBoostDb": onset_level - predicted_onset,
        "earlyDecayDbPerSecond": early_rate,
        "lateDecayDbPerSecond": late_rate,
        "earlyLateRatio": (early_rate / max(late_rate, .05)
                           if late_rate is not None else None),
        "baselineRateDbPerSecond": rate,
    }


def _component_rows(samples: np.ndarray, sample_rate: int, f0: float,
                    velocity: float, note_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    freqs, times, power = _stft(samples, sample_rate)
    onset = _tone_onset(freqs, times, power, f0)
    partials: list[dict[str, Any]] = []
    for rank in range(1, min(32, int(min(14000, freqs[-1]) // f0)) + 1):
        centre = rank * f0
        bins = np.abs(freqs - centre) <= max(2 * (freqs[1] - freqs[0]), centre / 90)
        if not np.any(bins):
            continue
        track = 10 * np.log10(np.max(power[bins], axis=0))
        metrics = _track_metrics(times, track, onset)
        if metrics:
            partials.append({"note": note_id, "f0Hz": f0, "velocity": velocity,
                             "rank": rank, "frequencyHz": centre, **metrics})
    rank_one = next((row["onsetLevelDb"] for row in partials
                     if row["rank"] == 1), None)
    if rank_one is not None:
        for row in partials:
            # Keep the temporal boost returned by _track_metrics.  L16 asks
            # whether THIS mode is louder at onset than its own extrapolated
            # early-decay baseline.  Relative-to-fundamental level is a
            # useful spectral descriptor, but overwriting onsetBoostDb with
            # it made positive onset prominence impossible for most upper
            # modes and admitted onset-quiet false classes.
            row["onsetLevelRelativeToFundamentalDb"] = (
                row["onsetLevelDb"] - rank_one)

    centres = 100 * 2 ** (np.arange(int(math.log2(min(14000, freqs[-1]) / 100)
                                              * BANDS_PER_OCTAVE) + 1) /
                              BANDS_PER_OCTAVE)
    bands: list[dict[str, Any]] = []
    half = 2 ** (1 / (2 * BANDS_PER_OCTAVE))
    for centre in centres:
        inside = (freqs >= centre / half) & (freqs < centre * half)
        if np.count_nonzero(inside) < 2:
            continue
        track = 10 * np.log10(np.sum(power[inside], axis=0))
        metrics = _track_metrics(times, track, onset)
        if metrics:
            bands.append({"note": note_id, "f0Hz": f0, "velocity": velocity,
                          "frequencyHz": float(centre), **metrics})
    if bands:
        centre_level = float(np.median([row["onsetLevelDb"] for row in bands]))
        for row in bands:
            row["onsetLevelRelativeToBandMedianDb"] = (
                row["onsetLevelDb"] - centre_level)
    return partials, bands, {"toneOnsetSec": onset, "freqs": freqs,
                             "times": times, "power": power,
                             "samples": samples, "sampleRate": sample_rate}


def _baseline_and_deviants(rows: list[dict[str, Any]], key: str) -> dict[str, Any]:
    usable = [row for row in rows if np.isfinite(row["earlyDecayDbPerSecond"])
              and row["earlyDecayDbPerSecond"] < 300]
    if len(usable) < 8:
        return {"baseline": None, "deviants": []}
    x = np.asarray([math.log2(row["frequencyHz"] / 440) for row in usable])
    y = np.asarray([row["earlyDecayDbPerSecond"] for row in usable])
    lo, hi = np.percentile(y, [10, 80])
    central = (y >= lo) & (y <= hi)
    slope, intercept = np.polyfit(x[central], y[central], 1)
    for row, xx in zip(usable, x):
        row["baselineRateDbPerSecond"] = max(0.0, float(intercept + slope * xx))
        row["excessDecayDbPerSecond"] = (row["earlyDecayDbPerSecond"] -
                                          row["baselineRateDbPerSecond"])

    groups: dict[Any, list[dict[str, Any]]] = {}
    for row in usable:
        group = row[key]
        groups.setdefault(group, []).append(row)
    deviants = []
    for group, members in groups.items():
        distinct = len({round(row["f0Hz"], 2) for row in members})
        if distinct < 3:
            continue
        onset = float(np.median([row["onsetBoostDb"] for row in members]))
        excess = float(np.median([row["excessDecayDbPerSecond"] for row in members]))
        velocities = np.asarray([row["velocity"] for row in members])
        boosts = np.asarray([row["onsetBoostDb"] for row in members])
        velocity_slope = (float(np.polyfit(velocities, boosts, 1)[0])
                          if len(np.unique(np.round(velocities, 3))) >= 2 else 0.0)
        # L16 classes are onset-prominent, fast-decaying, and stronger at
        # higher velocity.  All three signs are required; a fast-decaying
        # but onset-quiet mode is ordinary envelope structure, not the
        # owner's anomaly class.
        if onset >= 2.0 and excess >= 2.0 and velocity_slope >= 2.0:
            deviants.append({
                key: group, "notes": distinct,
                "onsetBoostDb": round(onset, 3),
                "excessDecayDbPerSecond": round(excess, 3),
                "velocitySlopeDbPerUnit": round(velocity_slope, 3),
            })
    deviants.sort(key=lambda row: row["onsetBoostDb"] +
                   .1 * row["excessDecayDbPerSecond"], reverse=True)
    return {
        "baseline": {"model": "earlyDecayDbPerSecond = intercept + slope*log2(f/440)",
                     "intercept": round(float(intercept), 4),
                     "slope": round(float(slope), 4)},
        "deviants": deviants[:24],
    }


def _action_component(meta_rows: list[tuple[dict[str, Any], dict[str, Any]]]) -> dict[str, Any]:
    # A bass harmonic mask is nearly the whole spectrum at this short FFT.
    # Instead, weight broadband energy by spectral flatness: action noise
    # remains strong while the pitched string onset is suppressed.
    envelope_grid = np.arange(-150, 51, 5, dtype=float)
    envelopes = []
    spectra = []
    leads = []
    exclusions = []
    centres = None
    for ref, meta in meta_rows:
        freqs, times, power = _action_stft(meta["samples"], meta["sampleRate"])
        onset = _tone_onset(freqs, times, power, float(ref["expectedF0Hz"]))
        raw = np.asarray(meta["samples"], dtype=float)
        raw_sr = int(meta["sampleRate"])
        frame = max(32, round(.005 * raw_sr))
        hop = max(16, round(.001 * raw_sr))
        raw_rms = np.sqrt(signal.convolve(raw * raw, np.ones(frame) / frame,
                                          mode="same") + 1e-20)[::hop]
        raw_peak = float(np.max(raw_rms))
        raw_active = np.flatnonzero(raw_rms >= raw_peak * 10 ** (-35 / 20))
        broadband_onset = (float(raw_active[0] * hop / raw_sr)
                           if raw_active.size else 0.0)
        if broadband_onset < .010:
            exclusions.append({"sourceFile": ref["sourceFile"],
                               "reason": "recording begins too close to action/strike for pre-onset evidence"})
            continue
        band = (freqs >= 500) & (freqs <= 14000)
        band_power = power[band]
        arithmetic = np.mean(band_power, axis=0)
        geometric = np.exp(np.mean(np.log(np.maximum(band_power, 1e-20)), axis=0))
        flatness = geometric / np.maximum(arithmetic, 1e-20)
        residual_db = 10 * np.log10(np.maximum(
            np.sum(band_power, axis=0) * flatness, 1e-20))
        rel_ms = (times - onset) * 1000
        candidate_start = max(-120.0, -1000 * onset + 8)
        candidate = (rel_ms >= candidate_start) & (rel_ms <= -3)
        background = rel_ms < candidate_start - 5
        if np.count_nonzero(candidate) < 3:
            exclusions.append({"sourceFile": ref["sourceFile"],
                               "reason": "no resolved pre-strike action window"})
            continue
        if np.count_nonzero(background) >= 3:
            background_level = float(np.median(residual_db[background]))
        else:
            background_level = float(np.percentile(residual_db[candidate], 15))
        log_power_db = 10 * np.log10(np.maximum(band_power, 1e-20))
        flux = np.r_[0.0, np.mean(np.maximum(np.diff(log_power_db, axis=1), 0), axis=0)]
        candidate_indices = np.where(candidate)[0]
        peak_index = int(candidate_indices[np.argmax(
            residual_db[candidate] + .5 * flux[candidate])])
        peak_level = float(residual_db[peak_index])
        if peak_level - background_level < 8:
            exclusions.append({"sourceFile": ref["sourceFile"],
                               "reason": "no >=8 dB broadband pre-strike action transient"})
            continue
        background_power = 10 ** (background_level / 10)
        residual_power = 10 ** (residual_db / 10)
        event_power = np.maximum(residual_power - background_power,
                                 background_power * 1e-6)
        peak_power = max(float(event_power[peak_index]), background_power * 1e-6)
        event_db = np.clip(10 * np.log10(event_power / peak_power), -60, 0)
        # The pitched onset makes residual separation underdetermined.  Piano
        # action is a self-contained pre-strike transient, so only its measured
        # pre-onset fall is admitted to this fitted component envelope.
        event_db[rel_ms >= 0] = -60
        interp = np.interp(envelope_grid, rel_ms, event_db, left=-60, right=-60)
        envelopes.append(interp)
        before_peak = np.where((np.arange(len(event_db)) <= peak_index) &
                               (event_db >= -20))[0]
        action_onset = int(before_peak[0]) if before_peak.size else peak_index
        leads.append(max(0.0, -float(rel_ms[action_onset])))
        pre_bins = np.abs(np.arange(len(times)) - peak_index) <= 2
        if np.count_nonzero(pre_bins) >= 1:
            psd = np.median(power[:, pre_bins], axis=1)
            centres = (100 * 2 ** (np.arange(int(math.log2(
                min(14000, freqs[-1]) / 100) * BANDS_PER_OCTAVE) + 1) /
                BANDS_PER_OCTAVE))
            half = 2 ** (1 / (2 * BANDS_PER_OCTAVE))
            spectra.append(np.asarray([
                10 * math.log10(float(np.median(psd[(freqs >= c / half) &
                                                    (freqs < c * half)])))
                if np.count_nonzero((freqs >= c / half) & (freqs < c * half)) >= 2
                else np.nan for c in centres]))
    if not envelopes or centres is None or not spectra:
        return {"status": "insufficient-pre-roll", "profilePinned": False,
                "exclusions": exclusions}
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="All-NaN slice encountered")
        envelope = np.median(np.asarray(envelopes), axis=0)
        spectrum = np.nanmedian(np.asarray(spectra), axis=0)
    envelope -= np.nanmax(envelope)
    spectrum -= np.nanmedian(spectrum[np.isfinite(spectrum)])
    peak_index = int(np.nanargmax(envelope))
    after = np.where((np.arange(len(envelope)) > peak_index) & (envelope <= -20))[0]
    release_ms = (float(envelope_grid[after[0]] - envelope_grid[peak_index])
                  if after.size else None)
    return {
        "status": "measured", "profilePinned": True,
        "notes": len(envelopes), "shapeOptimiserMutable": False,
        "noiseLeadMs": round(float(np.median(leads)), 3),
        "profile": [{"freqHz": round(float(c), 1), "gainDb": round(float(v), 3)}
                    for c, v in zip(centres, spectrum) if np.isfinite(v)],
        "envelope": {
            "independentOfHarmonicEnvelope": True,
            "timeReference": "milliseconds relative to harmonic tone onset",
            "peakOffsetMs": round(float(envelope_grid[peak_index]), 3),
            "releaseToMinus20DbMs": (round(release_ms, 3)
                                      if release_ms is not None else None),
            "points": [{"timeMs": int(t), "gainDb": round(float(v), 3)}
                       for t, v in zip(envelope_grid, envelope) if np.isfinite(v)],
        },
        "exclusions": exclusions,
    }


def _available_pre_roll(samples: np.ndarray, sample_rate: int,
                        expected_f0_hz: float) -> dict[str, Any]:
    """Measure the recording lead available before action/strike energy.

    L17 needs at least 10 ms before the first broadband event so background
    and the start of the action transient are both observable.  Harmonic tone
    onset is reported separately; it cannot rescue a file whose action event
    was already clipped at the file boundary.
    """
    frame = max(32, round(.005 * sample_rate))
    hop = max(16, round(.001 * sample_rate))
    raw_rms = np.sqrt(signal.convolve(samples * samples, np.ones(frame) / frame,
                                      mode="same") + 1e-20)[::hop]
    peak = float(np.max(raw_rms))
    active = np.flatnonzero(raw_rms >= peak * 10 ** (-35 / 20))
    broadband_onset = float(active[0] * hop / sample_rate) if active.size else 0.0
    freqs, times, power = _action_stft(samples, sample_rate)
    tone_onset = _tone_onset(freqs, times, power, expected_f0_hz)
    available_ms = 1000 * broadband_onset
    return {
        "availablePreRollMs": round(available_ms, 3),
        "harmonicToneOnsetMs": round(1000 * tone_onset, 3),
        "usableForL17": bool(broadband_onset >= .010),
        "requirement": "at least 10 ms before first broadband action/strike event",
    }


def audit_pre_roll(samples_root: Path, provenance_path: Path,
                   output: Path) -> dict[str, Any]:
    provenance = json.loads(provenance_path.read_text())
    rows = []
    for source in provenance.get("files", []):
        path = samples_root / source["file"]
        if not path.exists():
            rows.append({"sourceFile": source["file"], "midi": source.get("midi"),
                         "dynamic": source.get("dynamic"), "status": "missing"})
            continue
        samples, sample_rate = _load(path)
        midi = int(source["midi"])
        expected = 440 * 2 ** ((midi - 69) / 12)
        measured = _available_pre_roll(samples, sample_rate, expected)
        rows.append({"sourceFile": source["file"], "midi": midi,
                     "note": source.get("note"), "dynamic": source.get("dynamic"),
                     "roundRobin": source.get("roundRobin"), "status": "measured",
                     **measured})
    usable = [row for row in rows if row.get("usableForL17")]
    deficient = [row for row in rows if row.get("status") == "measured" and
                 not row.get("usableForL17")]
    result = {
        "schema": PRE_ROLL_SCHEMA, "instrument": "piano-upright",
        "criterion": "availablePreRollMs >= 10 before first broadband action/strike event",
        "filesAudited": len(rows), "usableCount": len(usable),
        "deficientCount": len(deficient), "missingCount": sum(
            row.get("status") == "missing" for row in rows),
        "usableSubset": [row["sourceFile"] for row in usable],
        "rows": rows,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def _damper_frequency_exponent(samples: np.ndarray, sample_rate: int, f0: float,
                               knee_sec: float) -> tuple[float | None, list[dict[str, float]]]:
    rates = []
    times = np.arange(len(samples)) / sample_rate
    fit_mask = (times >= knee_sec) & (times <= knee_sec + .30)
    for rank in range(1, min(16, int(min(10000, .45 * sample_rate) // f0)) + 1):
        frequency = rank * f0
        half = max(12.0, frequency * .025)
        low = max(20.0, frequency - half) / (sample_rate / 2)
        high = min(.98, (frequency + half) / (sample_rate / 2))
        if not 0 < low < high < 1:
            continue
        filtered = signal.sosfiltfilt(signal.butter(3, [low, high],
                                                    btype="band", output="sos"), samples)
        analytic = np.abs(signal.hilbert(filtered))
        local_t = times[fit_mask]
        local = analytic[fit_mask]
        if len(local) < 10 or float(np.max(local)) <= 1e-10:
            continue
        db = 20 * np.log10(np.maximum(local / float(np.max(local)), 1e-8))
        audible = db >= -45
        if np.count_nonzero(audible) < 8:
            continue
        rate = max(0.0, -float(np.polyfit(local_t[audible], db[audible], 1)[0]))
        if rate >= 5:
            rates.append({"rank": rank, "frequencyHz": frequency,
                          "dampDbPerSecond": rate})
    if len(rates) < 3:
        return None, rates
    x = np.log(np.asarray([row["frequencyHz"] / f0 for row in rates]))
    y = np.log(np.asarray([row["dampDbPerSecond"] for row in rates]))
    exponent = float(np.polyfit(x, y, 1)[0])
    return exponent, rates


def _damper_candidate(samples: np.ndarray, sample_rate: int,
                       f0: float) -> dict[str, Any]:
    frame = max(64, round(.020 * sample_rate))
    hop = max(32, round(.010 * sample_rate))
    frames = np.lib.stride_tricks.sliding_window_view(samples, frame)[::hop]
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-20)
    db = 20 * np.log10(np.maximum(rms / max(float(np.max(rms)), 1e-12), 1e-8))
    times = np.arange(len(db)) * hop / sample_rate
    peak = int(np.argmax(rms))
    best = None
    pre_frames = max(8, round(.40 / (hop / sample_rate)))
    post_frames = max(5, round(.12 / (hop / sample_rate)))
    for knee in range(peak + pre_frames, len(db) - post_frames):
        pre = slice(knee - pre_frames, knee)
        post = slice(knee, min(len(db), knee + 3 * post_frames))
        pre_rate = max(0.0, -float(np.polyfit(times[pre], db[pre], 1)[0]))
        post_rate = max(0.0, -float(np.polyfit(times[post], db[post], 1)[0]))
        score = post_rate - pre_rate
        if post_rate >= 30 and post_rate >= 2.5 * max(pre_rate, 1) and (
                best is None or score > best[0]):
            best = (score, knee, pre_rate, post_rate)
    if best is None:
        return {"detected": False,
                "reason": "no >=30 dB/s final knee at >=2.5x preceding free decay"}
    _, knee, pre_rate, post_rate = best
    exponent, band_rates = _damper_frequency_exponent(
        samples, sample_rate, f0, float(times[knee]))
    return {"detected": True, "releaseSec": round(float(times[knee]), 4),
            "holdRateDbPerSecond": round(pre_rate, 3),
            "dampDbPerSecond": round(post_rate, 3),
            "frequencyExponent": (round(exponent, 4)
                                  if exponent is not None else None),
            "bandRates": [{**row, "frequencyHz": round(row["frequencyHz"], 3),
                           "dampDbPerSecond": round(row["dampDbPerSecond"], 3)}
                          for row in band_rates]}


def extract(references_path: Path, samples_root: Path, validation_path: Path,
            output: Path, instrument: str) -> dict[str, Any]:
    validation = json.loads(validation_path.read_text())
    if validation.get("schema") != VALIDATION_SCHEMA or validation.get("status") != "pass":
        raise RuntimeError("real piano extraction requires a passing synthetic round trip")
    references = json.loads(references_path.read_text())
    partial_rows: list[dict[str, Any]] = []
    band_rows: list[dict[str, Any]] = []
    action_meta: list[tuple[dict[str, Any], dict[str, Any]]] = []
    hold_rows = []
    damper_rows = []
    for ref in references:
        path = Path(ref["path"])
        samples, sample_rate = _load(path)
        f0 = float(ref.get("detectedF0") or ref.get("expectedF0Hz") or
                   440 * 2 ** ((float(ref["midi"]) - 69) / 12))
        velocity = float(ref.get("velocity", .62))
        note_id = f"{ref.get('register')}:{ref.get('dynamic')}:{ref.get('midi')}"
        partials, bands, _ = _component_rows(samples, sample_rate, f0, velocity, note_id)
        partial_rows.extend(partials)
        band_rows.extend(bands)
        hold = hold_decay_metrics(samples, sample_rate)
        hold_rows.append({"note": note_id, **(hold or {})})

        raw = samples_root / str(ref.get("sourceFile", ""))
        if raw.exists():
            raw_samples, raw_sr = _load(raw)
            _, _, meta = _component_rows(raw_samples, raw_sr, f0, velocity, note_id)
            action_ref = {**ref, "expectedF0Hz": f0}
            action_meta.append((action_ref, meta))
            if ref.get("releaseEligible"):
                damper_rows.append({"note": note_id,
                                    **_damper_candidate(raw_samples, raw_sr, f0)})

    rank = _baseline_and_deviants(partial_rows, "rank")
    fixed = _baseline_and_deviants(band_rows, "frequencyHz")
    detected_dampers = [row for row in damper_rows if row.get("detected")]
    damper_by_register = []
    for register in sorted({ref.get("register") for ref in references}):
        values = [row["dampDbPerSecond"] for row in detected_dampers
                  if row["note"].startswith(f"{register}:")]
        midis = [float(ref["midi"]) for ref in references if ref.get("register") == register]
        if values and midis:
            exponents = [row["frequencyExponent"] for row in detected_dampers
                         if row["note"].startswith(f"{register}:") and
                         row.get("frequencyExponent") is not None]
            damper_by_register.append({
                "register": register,
                "f0": round(440 * 2 ** ((float(np.median(midis)) - 69) / 12), 4),
                "dampDbPerSecondAtFundamental": round(float(np.median(values)), 3),
                "frequencyExponent": (round(float(np.median(exponents)), 4)
                                      if exponents else None),
            })
    action = _action_component(action_meta)
    by_dynamic = {}
    for dynamic in sorted({str(ref.get("dynamic")) for ref, _ in action_meta}):
        fitted = _action_component([(ref, meta) for ref, meta in action_meta
                                    if str(ref.get("dynamic")) == dynamic])
        if fitted.get("status") == "measured":
            by_dynamic[dynamic] = fitted
    if by_dynamic:
        action["byDynamic"] = by_dynamic
    qualified_damper_rows = [row for row in damper_by_register
                             if row.get("frequencyExponent") is not None and
                             row["frequencyExponent"] > 0]
    result = {
        "schema": SCHEMA, "instrument": instrument,
        "validation": validation,
        "L18": {
            "holdLaw": "two-stage free decay; no sustain plateau",
            "holdMeasurements": hold_rows,
            "plateauCount": sum((row.get("plateauFraction", 1) >= .5)
                                for row in hold_rows),
            "releaseEligibleRows": sum(bool(ref.get("releaseEligible"))
                                       for ref in references),
            "damperDetections": detected_dampers,
            "damperByRegister": qualified_damper_rows,
            "damperFitDiagnostics": damper_by_register,
            "status": ("measured" if len(qualified_damper_rows) ==
                       len({ref.get("register") for ref in references}) else
                       "blocked-incomplete-physical-damper-fit"),
            "auditWarning": ("hasRelease/full-tail establishes a complete tail, not by itself a key-off time; "
                             "a damper rate is emitted only when a distinct fast final knee is detected"),
        },
        "L16": {
            "baselinePartialLaw": rank["baseline"],
            "harmonicRankDeviants": rank["deviants"],
            "baselineBandLaw": fixed["baseline"],
            "fixedHzDeviants": fixed["deviants"],
            "classificationRule": "cross-note rank commonality => hammer/excitation; fixed-Hz band commonality => body/soundboard",
            "classAssignmentsPinned": True,
        },
        "L17": {"component": "pianoActionNoise", **action},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def _synthetic_note(f0: float, velocity: float, *, sample_rate: int = 24000,
                    duration: float = 2.4) -> np.ndarray:
    tone_onset = .12
    times = np.arange(round(duration * sample_rate)) / sample_rate
    active = np.maximum(0.0, times - tone_onset)
    samples = np.zeros_like(times)
    release = 1.75
    for rank in range(1, 13):
        frequency = rank * f0
        rate = 3 + 1.5 * math.log2(max(frequency, 100) / 440)
        rate = max(1, rate)
        amp = 1 / rank
        transient_db = np.zeros_like(times)
        if rank == 6:
            # L16 is an onset-only excess over the mode's sustained decay,
            # not merely a loud upper partial.  Keep the injected excess out
            # of the 80--380 ms baseline-fit window so the round trip tests
            # the temporal quantity that the extractor reports.
            transient_db = (3 + 9 * velocity) * np.exp(-active / .018)
            rate += 16
        release_decay = 120 * (rank ** .35) * np.maximum(0.0, times - release)
        envelope = 10 ** ((transient_db - rate * active - release_decay) / 20)
        envelope *= times >= tone_onset
        samples += amp * envelope * np.sin(2 * np.pi * frequency * active)
    fixed_amp = .04
    fixed_transient_db = (4 + 11 * velocity) * np.exp(-active / .018)
    fixed_release = 120 * (2800 / f0) ** .35 * np.maximum(0.0, times - release)
    samples += fixed_amp * 10 ** ((fixed_transient_db - 35 * active - fixed_release) / 20) * (times >= tone_onset) * np.sin(
        2 * np.pi * 2800 * active)
    rng = np.random.default_rng(round(f0 * 10 + velocity * 100))
    noise = signal.lfilter([1, -.7], [1], rng.normal(0, 1, len(times)))
    action_env = np.exp(-.5 * ((times - (tone_onset - .035)) / .012) ** 2)
    samples += .008 * action_env * noise
    return samples


def validate(output: Path) -> dict[str, Any]:
    partials: list[dict[str, Any]] = []
    bands: list[dict[str, Any]] = []
    action_meta = []
    damper = []
    for f0 in (110.0, 146.83, 196.0, 261.63):
        for velocity in (.2, .9):
            samples = _synthetic_note(f0, velocity)
            note = f"{f0}:{velocity}"
            pr, br, meta = _component_rows(samples, 24000, f0, velocity, note)
            partials.extend(pr); bands.extend(br)
            action_meta.append(({"sourceFile": note, "expectedF0Hz": f0}, meta))
            damper.append(_damper_candidate(samples, 24000, f0))
    rank = _baseline_and_deviants(partials, "rank")["deviants"]
    fixed = _baseline_and_deviants(bands, "frequencyHz")["deviants"]
    action = _action_component(action_meta)
    rank_ok = any(row["rank"] == 6 for row in rank)
    fixed_ok = any(abs(math.log2(row["frequencyHz"] / 2800)) <= 1 / 6
                   for row in fixed)
    action_envelope = action.get("envelope", {})
    action_points = action_envelope.get("points", [])
    action_ok = (action.get("status") == "measured" and
                 action.get("noiseLeadMs", 0) >= 10 and
                 action_envelope.get("peakOffsetMs", 0) < 0 and
                 action_envelope.get("releaseToMinus20DbMs") is not None and
                 len(action_points) >= 3 and
                 max(point["gainDb"] for point in action_points) -
                 min(point["gainDb"] for point in action_points) >= 20)
    damper_ok = sum(row.get("detected", False) for row in damper) >= 6
    exponent_ok = np.median([row["frequencyExponent"] for row in damper
                             if row.get("frequencyExponent") is not None]) > .1
    passed = rank_ok and fixed_ok and action_ok and damper_ok and exponent_ok
    result = {
        "schema": VALIDATION_SCHEMA, "status": "pass" if passed else "fail",
        "injected": {"harmonicRank": 6, "fixedHz": 2800,
                     "actionLeadMs": 35, "damperDbPerSecond": 120},
        "recovered": {"harmonicRank": rank, "fixedHz": fixed,
                      "actionNoiseLeadMs": action.get("noiseLeadMs"),
                      "damperDetections": sum(row.get("detected", False) for row in damper),
                      "damperFrequencyExponentMedian": round(float(np.median([
                          row["frequencyExponent"] for row in damper
                          if row.get("frequencyExponent") is not None])), 4)},
        "checks": {"harmonicRank": rank_ok, "fixedHz": fixed_ok,
                   "actionEnvelope": action_ok, "damper": damper_ok,
                   "damperFrequencyLaw": bool(exponent_ok)},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if not passed:
        raise RuntimeError(f"piano anatomy synthetic round trip failed: {result['checks']}")
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("--output", type=Path, required=True)
    extract_parser = sub.add_parser("extract")
    extract_parser.add_argument("--references", type=Path, required=True)
    extract_parser.add_argument("--samples", type=Path, required=True)
    extract_parser.add_argument("--validation", type=Path, required=True)
    extract_parser.add_argument("--output", type=Path, required=True)
    extract_parser.add_argument("--instrument", required=True)
    pre_roll_parser = sub.add_parser("pre-roll-audit")
    pre_roll_parser.add_argument("--samples", type=Path, required=True)
    pre_roll_parser.add_argument("--provenance", type=Path, required=True)
    pre_roll_parser.add_argument("--output", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "validate":
        result = validate(args.output)
    elif args.command == "pre-roll-audit":
        result = audit_pre_roll(args.samples, args.provenance, args.output)
    else:
        result = extract(args.references, args.samples, args.validation,
                         args.output, args.instrument)
    print(json.dumps({"status": "ok", "output": str(args.output),
                      "schema": result["schema"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
