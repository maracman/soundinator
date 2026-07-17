"""Empirical validation-criteria hierarchy (§2.3, owner 2026-07-17).

Accepted optimiser steps retain their complete per-feature loss vectors.
When one criterion improves beyond its repeat-render noise floor while another
degrades, the directed event A⊣B is accumulated across runs and instruments.
The asymmetric event graph becomes the measured working hierarchy.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .paths import sg2_data_root


SCHEMA_VERSION = 1
MIN_EDGE_EVENTS = 6  # six one-way events gives two-sided binomial p=.03125
SIGNIFICANCE_ALPHA = .05

THEORETICAL_TIERS = {
    "inharmonicity_log_ratio": 0,
    "partials_db": 1, "log_mel_db": 1, "centroid_semitones": 1,
    "band_balance_db": 1, "ltas_rolloff_db_oct": 1,
    "attack_ms": 2, "decay_log_ratio": 2,
    "release_ring_ms": 2, "release_damp_db_per_s": 2,
    "vibrato": 3, "vibrato_onset_delay_ms": 3,
    "vibrato_ramp_ms": 3, "vibrato_rate_drift": 3, "body_am_db": 3,
    "noise": 4, "sustain_noise_db": 4, "onset_tilt_db_oct": 4,
    "onset_noise_db": 4, "onset_noise_centroid_oct": 4,
    "noise_lead_ms": 4, "release_noise_db": 4,
    "onset_scoop_cents": 5, "onset_scoop_settle_ms": 5,
    "onset_wander_cents": 5, "onset_lockin_periods": 5,
}


def feature_loss_vector(scores: list[dict[str, Any]]) -> dict[str, float]:
    """Mean normalised loss for every measured feature in accepted scores."""
    values: dict[str, list[float]] = {}
    for score in scores:
        if score.get("analysisFailure"):
            continue
        for feature, value in score.get("normalized", {}).items():
            if isinstance(value, (int, float)) and np.isfinite(value):
                values.setdefault(feature, []).append(float(value))
    return {feature: float(np.mean(rows)) for feature, rows in sorted(values.items())
            if rows}


def repeat_noise_floor(audit: dict[str, Any]) -> dict[str, float]:
    repeat = audit.get("repeatability", {})
    peaks = repeat.get("maxPeakPerceptualUnits", {})
    return {feature: max(float(value), 1e-9)
            for feature, value in peaks.items()
            if isinstance(value, (int, float)) and np.isfinite(value)}


def directed_drift(previous: dict[str, float], current: dict[str, float],
                   noise_floor: dict[str, float]) -> dict[str, Any] | None:
    shared = sorted(set(previous) & set(current))
    delta = {feature: float(current[feature] - previous[feature])
             for feature in shared}
    improved = [feature for feature in shared
                if delta[feature] < -noise_floor.get(feature, 0.0)]
    degraded = [feature for feature in shared
                if delta[feature] > noise_floor.get(feature, 0.0)]
    if not improved or not degraded:
        return None
    return {
        "improved": improved, "degraded": degraded,
        "delta": {feature: delta[feature]
                  for feature in sorted(set(improved) | set(degraded))},
        "events": [f"{left}⊣{right}"
                   for left in improved for right in degraded if left != right],
    }


def _binomial_two_sided(forward: int, reverse: int) -> float:
    total = forward + reverse
    if total == 0:
        return 1.0
    extreme = min(forward, reverse)
    tail = sum(math.comb(total, k) for k in range(extreme + 1)) / (2 ** total)
    return min(1.0, 2 * tail)


def _working_hierarchy(features: list[str], edges: list[dict[str, Any]]) -> dict[str, Any]:
    graph = {feature: set() for feature in features}
    indegree = {feature: 0 for feature in features}
    for edge in edges:
        left, right = edge["from"], edge["to"]
        if right not in graph[left]:
            graph[left].add(right); indegree[right] += 1
    ready = sorted((feature for feature, degree in indegree.items() if degree == 0),
                   key=lambda feature: (THEORETICAL_TIERS.get(feature, 1), feature))
    order = []
    while ready:
        current = ready.pop(0); order.append(current)
        for child in sorted(graph[current]):
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)
                ready.sort(key=lambda feature: (THEORETICAL_TIERS.get(feature, 1), feature))
    cyclic = sorted(set(features) - set(order))
    order.extend(sorted(cyclic, key=lambda feature: (
        THEORETICAL_TIERS.get(feature, 1), feature)))
    return {"order": order, "cyclicFeatures": cyclic,
            "fallback": "theoretical-tier tie-break and sparse-evidence order"}


def rebuild_state(accepted_steps: list[dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, dict[str, int]] = {}
    features = set()
    for step in accepted_steps:
        features.update(step.get("featureLossVector", {}))
        drift = step.get("driftFromPrevious") or {}
        for left in drift.get("improved", []):
            for right in drift.get("degraded", []):
                if left == right:
                    continue
                counts.setdefault(left, {})[right] = \
                    counts.setdefault(left, {}).get(right, 0) + 1
    matrix = {}
    edges = []
    symmetric = []
    for left in sorted(features):
        matrix[left] = {}
        for right in sorted(features):
            if left == right:
                continue
            forward = counts.get(left, {}).get(right, 0)
            reverse = counts.get(right, {}).get(left, 0)
            total = forward + reverse
            p_value = _binomial_two_sided(forward, reverse)
            asymmetry = ((forward - reverse) / total) if total else 0.0
            significant = (total >= MIN_EDGE_EVENTS and p_value <= SIGNIFICANCE_ALPHA
                           and forward > reverse)
            matrix[left][right] = {
                "improveLeftDegradeRight": forward,
                "improveRightDegradeLeft": reverse,
                "total": total, "asymmetry": asymmetry,
                "pValueTwoSided": p_value, "significantEdge": significant,
            }
            if significant:
                edges.append({"from": left, "to": right, "forward": forward,
                              "reverse": reverse, "pValue": p_value,
                              "asymmetry": asymmetry})
            if left < right and forward >= 3 and reverse >= 3 and abs(asymmetry) <= .25:
                symmetric.append({"a": left, "b": right, "forward": forward,
                                  "reverse": reverse,
                                  "finding": "strong symmetric coupling; scorer redundancy candidate"})
    disagreements = [
        {**edge, "finding": "measured edge reverses the theoretical tier order"}
        for edge in edges
        if THEORETICAL_TIERS.get(edge["from"], 1) >
           THEORETICAL_TIERS.get(edge["to"], 1)
    ]
    feature_list = sorted(features)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "theoreticalTiers": THEORETICAL_TIERS,
        "acceptedSteps": accepted_steps,
        "asymmetryMatrix": matrix,
        "measuredEdges": edges,
        "symmetricCouplings": symmetric,
        "workingHierarchy": _working_hierarchy(feature_list, edges),
        "theoryDisagreements": disagreements,
        "evidence": {"acceptedSteps": len(accepted_steps),
                     "directedDriftTransitions": sum(
                         1 for row in accepted_steps if row.get("driftFromPrevious")),
                     "minimumEdgeEvents": MIN_EDGE_EVENTS,
                     "significanceAlpha": SIGNIFICANCE_ALPHA},
    }


def persist_accepted_step(run_dir: Path, instrument: str,
                          evaluation: int, gate_failures: int, loss: float,
                          vector: dict[str, float],
                          noise_floor: dict[str, float]) -> dict[str, Any]:
    """Persist one accepted best-so-far step locally and in durable state."""
    run_path = run_dir / "accepted-criteria-steps.json"
    run_steps = json.loads(run_path.read_text()) if run_path.exists() else []
    previous = run_steps[-1] if run_steps else None
    step_id = f"{instrument}:{run_dir.name}:{evaluation}"
    row = {
        "id": step_id, "instrument": instrument, "run": run_dir.name,
        "evaluation": evaluation, "gateFailures": gate_failures,
        "loss": loss, "featureLossVector": vector,
        "noiseFloor": noise_floor,
        "driftFromPrevious": (directed_drift(
            previous["featureLossVector"], vector, noise_floor)
            if previous else None),
    }
    if not any(existing.get("id") == step_id for existing in run_steps):
        run_steps.append(row)
        run_path.write_text(json.dumps(run_steps, indent=2) + "\n")
    state_path = sg2_data_root() / "state" / "criteria-drift.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    existing_state = (json.loads(state_path.read_text())
                      if state_path.exists() else {"acceptedSteps": []})
    accepted = existing_state.get("acceptedSteps", [])
    if not any(existing.get("id") == step_id for existing in accepted):
        accepted.append(row)
    state = rebuild_state(accepted)
    state_path.write_text(json.dumps(state, indent=2) + "\n")
    return {"statePath": str(state_path), "runPath": str(run_path),
            "acceptedStepsThisRun": len(run_steps),
            "workingHierarchy": state["workingHierarchy"],
            "measuredEdges": state["measuredEdges"]}
