#!/usr/bin/env python3
"""§2.5c take-pair differential fitting and decomposition validation.

Identity parameters stay frozen.  Each take is reduced to Human-designated
observables in physical units; matched-take deltas calibrate ``humanRanges``.
The decomposition test then removes allowed level/tilt/bow-position changes
and rejects any residual that would require base partials, body, B or decay to
move beyond their construction bars.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .paths import sg2_data_root
from .score import THIRD_OCTAVE_CENTRES, extract_features, inharmonicity_comparison


ROOT = Path(__file__).resolve().parents[2]


def _floor_group(reference: dict[str, Any]) -> str:
    return str(reference.get("floorGroup") or "|").strip()


def _comb_db(position: float, count: int) -> np.ndarray:
    rank = np.arange(1, count + 1, dtype=float)
    return 20 * np.log10(np.maximum(np.abs(np.sin(np.pi * rank * position)), 1e-3))


def fit_excitation_position(partial_db: np.ndarray) -> dict[str, float]:
    """Fit the existing positionComb law while allowing smooth source tilt."""
    observed = np.asarray(partial_db[:32], dtype=float)
    rank = np.arange(1, len(observed) + 1, dtype=float)
    audible = np.isfinite(observed) & (observed > -60)
    if np.count_nonzero(audible) < 6:
        return {"position": math.nan, "residualDb": math.nan}
    design_smooth = np.column_stack((np.ones(np.count_nonzero(audible)),
                                     np.log2(rank[audible])))
    best = (math.inf, math.nan)
    for position in np.linspace(.03, .30, 541):
        residual = observed[audible] - _comb_db(float(position), len(observed))[audible]
        smooth = design_smooth @ np.linalg.lstsq(
            design_smooth, residual, rcond=None)[0]
        error = float(np.median(np.abs(residual - smooth)))
        if error < best[0]:
            best = (error, float(position))
    return {"position": best[1], "residualDb": best[0]}


def _number(value: Any, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) and np.isfinite(value) else default


def human_observables(bundle: Any) -> dict[str, float]:
    vibrato = bundle.note.vibrato or {}
    vibrato_present = bool(vibrato.get("present"))
    onset = bundle.note.onset_pitch or {}
    attack = bundle.note.attack_noise or {}
    position = fit_excitation_position(bundle.partial_db)
    return {
        "excitationPosition": position["position"],
        "vibratoRateHz": _number(vibrato.get("rate")) if vibrato_present else 0.0,
        "vibratoDepthCents": _number(vibrato.get("depth")) if vibrato_present else 0.0,
        "vibratoOnsetDelayMs": _number(vibrato.get("onsetDelayMs")) if vibrato_present else 0.0,
        "vibratoRampMs": _number(vibrato.get("depthRampMs")) if vibrato_present else 0.0,
        "vibratoRateDriftHzPerSecond": _number(vibrato.get("rateDriftHzPerSecond")) if vibrato_present else 0.0,
        "sustainNoiseDb": _number(bundle.sustain_noise_db),
        "onsetNoiseDb": _number(bundle.onset_noise_db),
        "onsetNoiseCentroidOct": _number(bundle.onset_noise_centroid_oct),
        "noiseLeadMs": _number(bundle.noise_lead_ms),
        "onsetWanderCents": _number(onset.get("wanderCents")),
        "onsetSettleMs": _number(onset.get("settleMs")),
        "attackNoiseLevel": _number(attack.get("level")),
    }


def _range(values: list[float], pair_deltas: list[float], unit: str) -> dict[str, Any]:
    finite = np.asarray([value for value in values if np.isfinite(value)], dtype=float)
    deltas = np.asarray([value for value in pair_deltas if np.isfinite(value)], dtype=float)
    if not len(finite) or not len(deltas):
        return {"status": "insufficient-evidence", "unit": unit}
    lo, centre, hi = np.quantile(finite, [.05, .5, .95])
    return {
        "status": "measured", "unit": unit, "centre": round(float(centre), 6),
        "min": round(float(lo), 6), "max": round(float(hi), 6),
        "pairSpreadMedian": round(float(np.median(deltas)), 6),
        "pairSpreadP90": round(float(np.quantile(deltas, .9)), 6),
        "drawHalfRange": round(float(np.quantile(deltas, .9) / math.sqrt(2)), 6),
        "takes": int(len(finite)), "pairs": int(len(deltas)),
    }


_UNITS = {
    "excitationPosition": "fraction-of-string",
    "vibratoRateHz": "Hz", "vibratoDepthCents": "cents",
    "vibratoOnsetDelayMs": "ms", "vibratoRampMs": "ms",
    "vibratoRateDriftHzPerSecond": "Hz/s", "sustainNoiseDb": "dB",
    "onsetNoiseDb": "dB", "onsetNoiseCentroidOct": "octaves",
    "noiseLeadMs": "ms", "onsetWanderCents": "cents",
    "onsetSettleMs": "ms", "attackNoiseLevel": "linear-ratio",
}


# §2.5c.1b: these are candidate PARAMETERS, not merely observed outcomes.
# A direct physical measurement supplies each take's per-parameter optimum.
# Outcome-only observables (noise centroid/lead, for example) remain in the
# standalone spread table but cannot become humanRanges without a generating
# parameter and a double-dissociation result.
_CANDIDATE_PARAMETERS = {
    "excitationPosition": {
        "observable": "excitationPosition", "unit": "fraction-of-string",
        "minDelta": .002, "responseFeature": "partials_db"},
    "vibratoRate": {
        "observable": "vibratoRateHz", "unit": "Hz", "minDelta": .05,
        "responseFeature": "vibrato"},
    "vibratoDepth": {
        "observable": "vibratoDepthCents", "unit": "cents", "minDelta": 1.0,
        "responseFeature": "body_am_db"},
    "vibratoOnsetDelayMs": {
        "observable": "vibratoOnsetDelayMs", "unit": "ms", "minDelta": 10.0,
        "responseFeature": "vibrato_onset_delay_ms"},
    "vibratoRampMs": {
        "observable": "vibratoRampMs", "unit": "ms", "minDelta": 10.0,
        "responseFeature": "vibrato_ramp_ms"},
    "vibratoRateDrift": {
        "observable": "vibratoRateDriftHzPerSecond", "unit": "Hz/s",
        "minDelta": .02, "responseFeature": "vibrato_rate_drift"},
    # These dB-domain optima are intentionally named as calibration controls;
    # the engine's linear level mapping remains a consuming-side obligation.
    "bowNoiseLevelDb": {
        "observable": "sustainNoiseDb", "unit": "dB", "minDelta": .5,
        "responseParameter": "bowNoiseLevel",
        "responseFeature": "sustain_noise_db"},
    "bowScratchLevelDb": {
        "observable": "onsetNoiseDb", "unit": "dB", "minDelta": .5,
        "responseParameter": "bowScratchLevel",
        "responseFeature": "onset_noise_db"},
    "attackNoiseLevel": {
        "observable": "attackNoiseLevel", "unit": "linear-ratio",
        "minDelta": .01, "responseFeature": "onset_noise_db"},
    "onsetWanderCents": {
        "observable": "onsetWanderCents", "unit": "cents", "minDelta": 2.0,
        "responseFeature": "onset_wander_cents"},
    "onsetWanderSettleMs": {
        "observable": "onsetSettleMs", "unit": "ms", "minDelta": 5.0,
        "responseParameter": "onsetWanderSettlePeriods",
        "responseFeature": "onset_scoop_settle_ms"},
}


def _double_dissociation(parameter: str, left: dict[str, float],
                          right: dict[str, float]) -> dict[str, Any]:
    """Test both directed trade-offs at the two measured per-take optima."""
    spec = _CANDIDATE_PARAMETERS[parameter]
    observable = spec["observable"]
    v1, v2 = float(left[observable]), float(right[observable])
    delta = abs(v2 - v1)
    threshold = float(spec["minDelta"])
    finite = np.isfinite(v1) and np.isfinite(v2)
    # Loss is expressed in perceptual/minimum-resolvable units. At v1 the
    # first take is the within-parameter optimum and vice versa for v2.
    losses = {
        "take1AtV1": 0.0,
        "take1AtV2": delta / threshold if finite else math.inf,
        "take2AtV1": delta / threshold if finite else math.inf,
        "take2AtV2": 0.0,
    }
    direction_v1 = (finite and delta >= threshold and
                    losses["take1AtV1"] < losses["take1AtV2"] and
                    losses["take2AtV1"] > losses["take2AtV2"])
    direction_v2 = (finite and delta >= threshold and
                    losses["take2AtV2"] < losses["take2AtV1"] and
                    losses["take1AtV2"] > losses["take1AtV1"])
    return {
        "parameter": parameter, "observable": observable,
        "v1": round(v1, 6) if finite else None,
        "v2": round(v2, 6) if finite else None,
        "delta": round(delta, 6) if finite else None,
        "minimumMeaningfulDelta": threshold,
        "losses": {key: round(value, 6) if np.isfinite(value) else None
                   for key, value in losses.items()},
        "v1ImprovesTake1AndWorsensTake2": bool(direction_v1),
        "v2ImprovesTake2AndWorsensTake1": bool(direction_v2),
        "qualified": bool(direction_v1 and direction_v2),
    }


def _parameter_qualification(pair_rows: list[dict[str, Any]]) -> dict[str, Any]:
    result = {}
    for parameter, spec in _CANDIDATE_PARAMETERS.items():
        tests = [row["doubleDissociation"][parameter] for row in pair_rows]
        qualified = [row for row in tests if row["qualified"]]
        result[parameter] = {
            "parameter": parameter, "observable": spec["observable"],
            "unit": spec["unit"], "pairsTested": len(tests),
            "qualifiedPairs": len(qualified),
            "status": "qualified-humanisation" if qualified else
                      "not-humanisation",
            "criterion": ("both directions required: v1 improves take 1 and "
                          "worsens take 2; v2 improves take 2 and worsens take 1"),
        }
    return result


def _consumer_status(controllability: dict[str, Any] | None,
                     qualification: dict[str, Any]) -> dict[str, Any]:
    responsive = (controllability or {}).get("responsiveParameters", {})
    rows = {}
    for parameter, status in qualification.items():
        if status["status"] != "qualified-humanisation":
            continue
        spec = _CANDIDATE_PARAMETERS[parameter]
        expected_parameter = spec.get("responseParameter", parameter)
        feature = spec["responseFeature"]
        responders = set(responsive.get(feature, []))
        rows[parameter] = {
            "parameter": expected_parameter, "feature": feature,
            "functional": expected_parameter in responders,
            "responders": sorted(responders),
        }
    return {
        "auditClean": bool((controllability or {}).get("clean")),
        "parameters": rows,
        "allQualifiedConsumersFunctional": bool(rows) and
            bool((controllability or {}).get("clean")) and
            all(row["functional"] for row in rows.values()),
    }


def _identity_fit_status(identity_best: dict[str, Any] | None,
                         references: list[dict[str, Any]],
                         matched_paths: set[str]) -> dict[str, Any]:
    scores = (identity_best or {}).get("scores", [])
    rows = []
    core = ("partials_db", "log_mel_db", "attack_ms", "band_balance_db",
            "inharmonicity_log_ratio")
    for index, reference in enumerate(references):
        if str(reference.get("path")) not in matched_paths:
            continue
        score = scores[index] if index < len(scores) else {}
        normalized = score.get("normalized", {})
        failures = [feature for feature in core
                    if feature in normalized and
                    np.isfinite(normalized[feature]) and
                    float(normalized[feature]) > 1.0]
        good = bool(normalized) and not score.get("analysisFailure") and not failures
        rows.append({"path": str(reference.get("path")), "good": good,
                     "failedCoreFeatures": failures,
                     "analysisFailure": score.get("analysisFailure")})
    return {"takes": rows, "allMatchedTakesNearBars": bool(rows) and
            all(row["good"] for row in rows)}


def _decomposition_verdict(failed_pairs: int, identity_good: bool,
                           consumers_functional: bool) -> str:
    if failed_pairs == 0:
        return "PASS"
    if identity_good and consumers_functional:
        return "FAIL-MISSING-DOF"
    return "INCONCLUSIVE-MASKED"


def _identity_residual(left: Any, right: Any) -> dict[str, Any]:
    count = min(32, len(left.partial_db), len(right.partial_db))
    rank = np.arange(1, count + 1, dtype=float)
    audible = np.maximum(left.partial_db[:count], right.partial_db[:count]) > -60
    difference = right.partial_db[:count] - left.partial_db[:count]
    left_pos = fit_excitation_position(left.partial_db)["position"]
    right_pos = fit_excitation_position(right.partial_db)["position"]
    if np.isfinite(left_pos) and np.isfinite(right_pos):
        difference -= _comb_db(right_pos, count) - _comb_db(left_pos, count)
    # Drive/brightness is Human-designated, so remove its best offset+tilt.
    if np.count_nonzero(audible) >= 4:
        design = np.column_stack((np.ones(np.count_nonzero(audible)),
                                  np.log2(rank[audible])))
        fitted = design @ np.linalg.lstsq(design, difference[audible], rcond=None)[0]
        partial_residual = float(np.median(np.abs(difference[audible] - fitted)))
    else:
        partial_residual = math.inf
    body_residual = None
    if left.band_balance_db is not None and right.band_balance_db is not None:
        a = np.asarray(left.band_balance_db, dtype=float)
        b = np.asarray(right.band_balance_db, dtype=float)
        valid = np.isfinite(a) & np.isfinite(b) & (np.maximum(a, b) > -60)
        if np.count_nonzero(valid) >= 5:
            x = np.log2(THIRD_OCTAVE_CENTRES[valid])
            d = b[valid] - a[valid]
            design = np.column_stack((np.ones(len(x)), x))
            body_residual = float(np.median(np.abs(
                d - design @ np.linalg.lstsq(design, d, rcond=None)[0])))
    b_test = inharmonicity_comparison(left.note, right.note)
    b_pass = bool(b_test.get("passed", True)) if b_test.get("applicable") else True
    t60_left_values = [float(row[1]) for row in (left.note.t60 or [])
                       if len(row) >= 2 and isinstance(row[1], (int, float)) and row[1] > 0]
    t60_right_values = [float(row[1]) for row in (right.note.t60 or [])
                        if len(row) >= 2 and isinstance(row[1], (int, float)) and row[1] > 0]
    t60_left = float(np.median(t60_left_values)) if t60_left_values else None
    t60_right = float(np.median(t60_right_values)) if t60_right_values else None
    decay_ratio = None
    if all(isinstance(value, (int, float)) and value > 0
           for value in (t60_left, t60_right)):
        decay_ratio = max(t60_left, t60_right) / min(t60_left, t60_right)
    passed = (partial_residual <= 3.0 and
              (body_residual is None or body_residual <= 3.0) and b_pass and
              (decay_ratio is None or decay_ratio <= 1.5))
    return {
        "passed": passed, "partialResidualDb": round(partial_residual, 4),
        "bodyResidualDb": round(body_residual, 4) if body_residual is not None else None,
        "inharmonicity": b_test, "decayT60Ratio": decay_ratio,
        "limits": {"partialResidualDb": 3.0, "bodyResidualDb": 3.0,
                   "inharmonicityFactor": 1.5, "decayT60Ratio": 1.5},
    }


def fit_human_ranges(instrument: str, references: list[dict[str, Any]], *,
                     identity_best: dict[str, Any] | None = None,
                     controllability: dict[str, Any] | None = None,
                     ) -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for reference in references:
        if "floor" in set(reference.get("roles", [])):
            groups.setdefault(_floor_group(reference), []).append(reference)
    groups = {key: rows for key, rows in groups.items() if len(rows) >= 2}
    if not groups:
        raise ValueError(f"{instrument}: no matched floor-role take pairs")
    cache: dict[str, Any] = {}
    for rows in groups.values():
        for reference in rows:
            path = str(reference["path"])
            expected = 440 * 2 ** ((float(reference["midi"]) - 69) / 12)
            cache[path] = extract_features(path, expected_f0_hz=expected,
                                           trust_expected_f0=True)
    values = {key: [] for key in _UNITS}
    deltas = {key: [] for key in _UNITS}
    pair_rows = []
    for group, rows in sorted(groups.items()):
        observations = [human_observables(cache[str(row["path"])]) for row in rows]
        for observation in observations:
            for key in values:
                values[key].append(observation[key])
        for left_index in range(len(rows)):
            for right_index in range(left_index + 1, len(rows)):
                left, right = observations[left_index], observations[right_index]
                for key in deltas:
                    deltas[key].append(abs(right[key] - left[key]))
                decomposition = _identity_residual(
                    cache[str(rows[left_index]["path"])],
                    cache[str(rows[right_index]["path"])])
                dissociation = {
                    parameter: _double_dissociation(parameter, left, right)
                    for parameter in _CANDIDATE_PARAMETERS
                }
                pair_rows.append({
                    "group": group,
                    "left": rows[left_index].get("sourceFile", rows[left_index]["path"]),
                    "right": rows[right_index].get("sourceFile", rows[right_index]["path"]),
                    "humanDelta": {key: round(abs(right[key] - left[key]), 6)
                                   for key in deltas},
                    "doubleDissociation": dissociation,
                    "decomposition": decomposition,
                })
    qualification = _parameter_qualification(pair_rows)
    ranges = {}
    for parameter, spec in _CANDIDATE_PARAMETERS.items():
        if qualification[parameter]["status"] != "qualified-humanisation":
            continue
        observable = spec["observable"]
        ranges[parameter] = {
            **_range(values[observable], deltas[observable], spec["unit"]),
            "qualification": qualification[parameter],
        }
    spread_observables = {key: _range(values[key], deltas[key], unit)
                          for key, unit in _UNITS.items()}
    failures = [row for row in pair_rows if not row["decomposition"]["passed"]]
    matched_paths = {
        str(row["path"]) for rows in groups.values() for row in rows}
    identity_status = _identity_fit_status(
        identity_best, references, matched_paths)
    consumer_status = _consumer_status(controllability, qualification)
    verdict_name = _decomposition_verdict(
        len(failures), identity_status["allMatchedTakesNearBars"],
        consumer_status["allQualifiedConsumersFunctional"])
    masking = []
    if not identity_status["allMatchedTakesNearBars"]:
        masking.append("one or more per-take identity fits miss the §3 core bars")
    if not consumer_status["allQualifiedConsumersFunctional"]:
        masking.append("one or more qualified Human consumers are unaudited or non-functional")
    verdict = {
        "verdict": verdict_name, "passed": verdict_name == "PASS",
        "pairs": len(pair_rows),
        "failedPairs": len(failures),
        "rule": ("after Human comb/level/tilt removal: partial and body residual <=3 dB; "
                 "B <=1.5x (near-zero uses 3 cents); T60 <=1.5x"),
        "identityFit": identity_status,
        "consumerFunctionality": consumer_status,
        "maskingFactors": masking,
        "interpretation": {
            "PASS": "matched takes reconcile inside qualified Human parameters",
            "FAIL-MISSING-DOF": ("identity fits are good and consumers work; the "
                                 "remaining residual evidences a missing Human degree of freedom"),
            "INCONCLUSIVE-MASKED": ("identity/renderer misfit masks the residual; "
                                    "no missing-Human-DOF claim is permitted"),
        }[verdict_name],
    }
    return {
        "schemaVersion": 2, "instrument": instrument,
        "method": "matched-take-human-only-differential-v2-double-dissociation",
        "evidence": {"basis": "true same-note/dynamic/articulation floor groups",
                     "groups": len(groups), "takes": len(cache),
                     "pairs": len(pair_rows)},
        "qualification": qualification,
        "ranges": ranges, "spreadObservables": spread_observables,
        "decompositionTest": verdict, "pairFits": pair_rows,
    }


def _consume_profile_ranges(profiles: dict[str, Any], instrument: str,
                            result: dict[str, Any]) -> bool:
    """Persist qualified ranges even when model decomposition is masked.

    The take-pair measurements and double dissociations are model-independent;
    a non-PASS verdict only forbids interpreting the remaining residual as a
    missing Human DOF or widening identity parameters.
    """
    if not result.get("ranges"):
        return False
    profiles[instrument]["humanRanges"] = result
    return True


def ship_human_overrides(params: dict[str, Any], *, midi: float,
                         seed: int) -> dict[str, float]:
    """Resolve measured ``humanRanges`` into one seeded SHIP performance.

    The differential fitter stores physical take-to-take ranges, whereas the
    renderer consumes a mixture of direct controls, linear levels and
    period-scaled onset timing.  This is the consuming adapter between those
    contracts.  FIT mode never calls it.  The articulation-related controls
    share one latent draw (T-002); bow position, vibrato and sustained bow
    noise retain independent measured draws.

    ``drawHalfRange`` was derived from the take-pair p90.  A bounded uniform
    draw reproduces both the observed violin median and p90 pair spread more
    closely than a Gaussian (the bow-position evidence is episodic/heavy-tail,
    not a wide Gaussian).  The Human dial scales direct deviations, while
    controls already Human-scaled inside the renderer receive their measured
    absolute range and are suppressed there when Human is zero.
    """
    human = float(np.clip(params.get("excitationHuman", 0.0), 0.0, 1.0))
    contract = params.get("humanRanges")
    ranges = contract.get("ranges", {}) if isinstance(contract, dict) else {}
    if human <= 0 or not isinstance(ranges, dict) or not ranges:
        return {}

    rng = np.random.default_rng(int(seed) & 0xFFFFFFFF)
    independent = {
        key: float(rng.uniform(-1.0, 1.0))
        for key in ("excitationPosition", "vibratoRate", "bowNoiseLevelDb")
    }
    articulation = float(rng.uniform(-1.0, 1.0))
    result: dict[str, float] = {}
    calibration = params.get("shipHumanCalibration") or {}
    by_midi = calibration.get("byMidi") or {}
    midi_scales = by_midi.get(str(int(round(float(midi)))), {})

    def scale(key: str) -> float:
        raw = midi_scales.get(key, 1.0)
        value = float(raw) if isinstance(raw, (int, float)) else 1.0
        # A reference with too few audible partials cannot identify the
        # excitation-position comb and is recorded as NaN by the evidence
        # fitter.  That missing datum must not leak into renderer JSON; the
        # global measured range remains valid, so use its neutral MIDI scale.
        return max(0.0, value) if np.isfinite(value) else 1.0

    def row(key: str) -> dict[str, Any] | None:
        value = ranges.get(key)
        return value if isinstance(value, dict) and \
            value.get("status") == "measured" else None

    position = row("excitationPosition")
    if position:
        base = float(params.get("excitationPosition", position.get("centre", .13)))
        half = (float(position.get("drawHalfRange", 0.0)) *
                scale("excitationPosition"))
        result["excitationPosition"] = float(np.clip(
            base + independent["excitationPosition"] * half * human, .02, .5))

    vibrato = row("vibratoRate")
    if vibrato:
        base = float(params.get("vibratoRate", vibrato.get("centre", 5.5)))
        half = float(vibrato.get("drawHalfRange", 0.0)) * scale("vibratoRate")
        result["vibratoRate"] = float(np.clip(
            base + independent["vibratoRate"] * half * human, .5, 12.0))

    bow_noise = row("bowNoiseLevelDb")
    if bow_noise and float(params.get("bowNoiseLevel", 0.0)) > 0:
        delta_db = (independent["bowNoiseLevelDb"] *
                    float(bow_noise.get("drawHalfRange", 0.0)) *
                    scale("bowNoiseLevelDb") * human)
        result["bowNoiseLevel"] = float(np.clip(
            float(params["bowNoiseLevel"]) * 10 ** (delta_db / 20), 0.0, 2.0))

    # Stronger articulation raises the contact transient while reducing the
    # onset pitch error and its settling time.  This preserves T-002's one-
    # latent anticorrelation instead of inventing independent impossible
    # combinations.
    scratch = row("bowScratchLevelDb")
    if scratch:
        measured_db = (float(scratch.get("centre", -60.0)) +
                       articulation * float(scratch.get("drawHalfRange", 0.0)) *
                       scale("bowScratchLevelDb"))
        result["bowScratchLevel"] = float(np.clip(
            10 ** (measured_db / 20), 0.0, 2.0))

    attack = row("attackNoiseLevel")
    if attack:
        measured = (float(attack.get("centre", 0.0)) + articulation *
                    float(attack.get("drawHalfRange", 0.0)) *
                    scale("attackNoiseLevel"))
        # The profile fitter's established render calibration is measured
        # transient/sustain ratio x10 -> attackNoiseLevel.
        target = float(np.clip(measured * 10.0, 0.0, 2.0))
        base = float(params.get("attackNoiseLevel", target))
        result["attackNoiseLevel"] = float(np.clip(
            base + human * (target - base), 0.0, 2.0))

    wander = row("onsetWanderCents")
    if wander:
        # Invert the articulation latent: a weak/floated start wanders more.
        measured = (float(wander.get("centre", 0.0)) - articulation *
                    float(wander.get("drawHalfRange", 0.0)) *
                    scale("onsetWanderCents"))
        result["onsetWanderCents"] = float(np.clip(measured, 0.0, 120.0))

    settle = row("onsetWanderSettleMs")
    if settle:
        measured_ms = (float(settle.get("centre", 0.0)) - articulation *
                       float(settle.get("drawHalfRange", 0.0)) *
                       scale("onsetWanderSettleMs"))
        f0 = 440.0 * 2 ** ((float(midi) - 69.0) / 12.0)
        result["onsetWanderSettlePeriods"] = float(np.clip(
            max(0.0, measured_ms) * f0 / 1000.0, 2.0, 30.0))
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    data_root = sg2_data_root()
    parser.add_argument("--references", type=Path)
    parser.add_argument("--profile", type=Path,
                        default=ROOT / "web/static/measured_profiles.json")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--identity-best", type=Path,
                        help="best.json from the current identity rebaseline")
    parser.add_argument("--controllability", type=Path,
                        help="current hashed controllability audit")
    args = parser.parse_args(argv)
    references_path = args.references or data_root / "campaigns" / args.instrument / "references.json"
    references = json.loads(references_path.read_text())
    identity_best = (json.loads(args.identity_best.read_text())
                     if args.identity_best else None)
    controllability = (json.loads(args.controllability.read_text())
                       if args.controllability else None)
    result = fit_human_ranges(
        args.instrument, references, identity_best=identity_best,
        controllability=controllability)
    profiles = json.loads(args.profile.read_text())
    if args.instrument not in profiles:
        raise ValueError(f"{args.instrument}: missing measured profile row")
    profile_updated = _consume_profile_ranges(profiles, args.instrument, result)
    if profile_updated:
        # A non-PASS decomposition is never permission to widen identity.
        # Qualified take-pair ranges remain valid standalone evidence.
        # measured_profiles.json's checked-in canonical formatting is
        # one-space indentation; preserve it so a successful fit changes
        # only its row.
        args.profile.write_text(json.dumps(profiles, indent=1) + "\n")
    report = args.report or data_root / "campaigns" / args.instrument / "humanisation-fit.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"profile": str(args.profile) if profile_updated else None,
                      "profileUpdated": profile_updated, "report": str(report),
                      "decompositionTest": result["decompositionTest"]}, indent=2))
    return {"PASS": 0, "FAIL-MISSING-DOF": 2,
            "INCONCLUSIVE-MASKED": 3}[result["decompositionTest"]["verdict"]]


if __name__ == "__main__":
    raise SystemExit(main())
