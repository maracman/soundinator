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


def fit_human_ranges(instrument: str, references: list[dict[str, Any]]) -> dict[str, Any]:
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
                pair_rows.append({
                    "group": group,
                    "left": rows[left_index].get("sourceFile", rows[left_index]["path"]),
                    "right": rows[right_index].get("sourceFile", rows[right_index]["path"]),
                    "humanDelta": {key: round(abs(right[key] - left[key]), 6)
                                   for key in deltas},
                    "decomposition": decomposition,
                })
    ranges = {key: _range(values[key], deltas[key], unit)
              for key, unit in _UNITS.items()}
    failures = [row for row in pair_rows if not row["decomposition"]["passed"]]
    verdict = {
        "passed": not failures, "pairs": len(pair_rows),
        "failedPairs": len(failures),
        "rule": ("after Human comb/level/tilt removal: partial and body residual <=3 dB; "
                 "B <=1.5x (near-zero uses 3 cents); T60 <=1.5x"),
        "interpretation": ("identity frozen is adequate" if not failures else
                           "FAIL: take variation still requires identity movement"),
    }
    return {
        "schemaVersion": 1, "instrument": instrument,
        "method": "matched-take-human-only-differential-v1",
        "evidence": {"basis": "true same-note/dynamic/articulation floor groups",
                     "groups": len(groups), "takes": len(cache),
                     "pairs": len(pair_rows)},
        "ranges": ranges, "decompositionTest": verdict, "pairFits": pair_rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    data_root = sg2_data_root()
    parser.add_argument("--references", type=Path)
    parser.add_argument("--profile", type=Path,
                        default=ROOT / "web/static/measured_profiles.json")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    references_path = args.references or data_root / "campaigns" / args.instrument / "references.json"
    references = json.loads(references_path.read_text())
    result = fit_human_ranges(args.instrument, references)
    profiles = json.loads(args.profile.read_text())
    if args.instrument not in profiles:
        raise ValueError(f"{args.instrument}: missing measured profile row")
    profiles[args.instrument]["humanRanges"] = result
    # measured_profiles.json's checked-in canonical formatting is one-space
    # indentation; preserve it so a differential fit changes only its row.
    args.profile.write_text(json.dumps(profiles, indent=1) + "\n")
    report = args.report or data_root / "campaigns" / args.instrument / "humanisation-fit.json"
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"profile": str(args.profile), "report": str(report),
                      "decompositionTest": result["decompositionTest"]}, indent=2))
    return 0 if result["decompositionTest"]["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
