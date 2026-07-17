"""Manifest-driven Sound Generator 2.0 optimizer.

Reference manifest example:
[
  {"path":"<repo>/sg2-data/campaigns/clarinet/references/C4-mf.wav","midi":60,
   "velocity":0.62,"durationSec":1.5}
]

The fitter never mutates pinned measured fields. Continuous free-tier keys are
read from manifest.json, renders go through scripts/render_note.mjs, and every
evaluation is retained in the run directory for resumability/auditability.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import secrets
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
from scipy.optimize import minimize

from .assertions import (
    ConstructionSample,
    assert_sung_family_firewall,
    evaluate_construction,
)
from .audition import build as build_audition
from .controllability import (
    canonical_hash as audit_contract_hash,
    objective_contract_hash,
    manifest_contract_hash,
)
from .criteria_drift import (
    feature_loss_vector,
    persist_accepted_step,
    repeat_noise_floor,
)
from .legacy_prior import canonical_hash, resolve_legacy_prior
from .humanisation import ship_human_overrides
from .paths import sg2_data_root
from .score import (
    SCORER_CONTRACT_VERSION,
    compare_features,
    extract_features,
    score_files,
    weights_for_instrument,
    write_report,
)
from .tripwires import (
    aggregate_by_cell,
    evaluate_tripwires,
    reference_roles,
    required_cells_by_bar,
    tripwire_table_markdown,
)

ROOT = Path(__file__).resolve().parents[2]
SG2_DATA_ROOT = sg2_data_root()
DEFAULT_RUN_ROOT = SG2_DATA_ROOT / "runs"
STATE_ROOT = SG2_DATA_ROOT / "state"
RENDERER_CONTRACT_FILES = (
    Path("scripts/render_note.mjs"),
    Path("web/static/synth.js"),
    Path("web/static/measured_profiles.js"),
)
MEASURABLE_REL_IMPROVEMENT = 1e-3
ANALYSIS_FAILURE_LOSS = 100.0
FIT_MODE = "fit"
SHIP_MODE = "ship"
DEFAULT_SHIP_VARIANTS = 8
VARIATION_LOWER_RATIO = 0.5
VARIATION_UPPER_RATIO = 2.0

# These are performance-distribution dimensions, not identity-fit controls.
# They remain in the ship preset at their legacy or §2.5c-fitted values.
HUMAN_ONLY_PARAM_KEYS = {
    "excitationHuman", "articulationVariation", "envelopeAttackSd",
    "vibratoRateSd", "vibratoDepthSd", "toneFormantDrift",
    "toneResonanceDrift", "microDriftCentsSd", "microDriftCentsRange",
    "microDriftCentsPerSecond",
    "onsetWanderCents", "onsetWanderSettlePeriods", "bowScratchLevel",
}

# Feature-domain consequences of the §2.5c Human-designated parameter set.
HUMAN_VARIATION_FEATURES = {
    "partials_db", "vibrato", "noise", "sustain_noise_db",
    "onset_tilt_db_oct", "onset_scoop_cents", "onset_scoop_settle_ms",
    "vibrato_onset_delay_ms", "vibrato_ramp_ms", "vibrato_rate_drift",
    "body_am_db", "onset_noise_db", "onset_noise_centroid_oct",
    "noise_lead_ms", "onset_wander_cents",
}


@dataclass
class FreeParam:
    key: str
    lo: float
    hi: float
    default: float


def _candidate_fingerprint(free: list[FreeParam],
                           params: dict[str, Any]) -> str:
    payload = {spec.key: round(float(params[spec.key]), 12)
               for spec in free}
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:16]


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text())


def _load_preset(path: str | Path) -> dict[str, Any]:
    value = _load(path)
    while isinstance(value, dict) and "excitationType" not in value and \
            isinstance(value.get("params"), dict):
        value = value["params"]
    if not isinstance(value, dict) or "excitationType" not in value:
        raise ValueError(f"{path}: no engine preset found")
    return value


def _mode_params(params: dict[str, Any], mode: str) -> dict[str, Any]:
    """Resolve one preset into deterministic identity-fit or full ship mode."""
    if mode not in {FIT_MODE, SHIP_MODE}:
        raise ValueError(f"unknown render mode {mode!r}")
    resolved = dict(params)
    resolved["sg2RenderMode"] = mode
    if mode == FIT_MODE:
        for key in HUMAN_ONLY_PARAM_KEYS:
            if key in resolved or key == "excitationHuman":
                resolved[key] = 0.0
    return resolved


def _distributional_variation_gate(
    variability: dict[str, Any],
    rendered_variants: dict[int, list[Any]],
    weights: dict[str, float] | None = None,
    eligible_groups: set[str] | None = None,
    eligible_features: set[str] | None = None,
    watch_features: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Two-sided §2.5c.6 gate over seeded ship-mode feature spreads.

    The single-take objective is deliberately absent.  Only variant↔variant
    distances are compared with measured take↔take distances, so reducing
    Human cannot improve a single-reference score.
    """
    if variability.get("status") != "measured":
        return {"status": "insufficient-evidence", "passed": False,
                "groups": [], "reason": variability.get(
                    "reason", "no measured take-pair spread")}
    groups: list[dict[str, Any]] = []
    for measured_group in variability.get("groups", []):
        if (eligible_groups is not None and
                measured_group["group"] not in eligible_groups):
            groups.append({"group": measured_group["group"],
                           "variantPairCount": 0, "checks": [],
                           "passed": False, "status": "not-qualified-pair"})
            continue
        pair_rows: list[dict[str, float]] = []
        for reference_index in measured_group.get("referenceIndices", []):
            variants = rendered_variants.get(int(reference_index), [])
            for left in range(len(variants)):
                for right in range(left + 1, len(variants)):
                    pair_rows.append(compare_features(
                        variants[left], variants[right], weights)["features"])
        checks = []
        measured_features = measured_group.get("floorFeatures", {})
        feature_domain = eligible_features or HUMAN_VARIATION_FEATURES
        for feature in sorted(feature_domain & set(measured_features)):
            target = float(measured_features.get(feature) or 0.0)
            values = [float(row[feature]) for row in pair_rows
                      if feature in row and np.isfinite(row[feature])]
            if target <= 1e-9 or not values:
                continue
            observed = float(np.median(values))
            lower = target * VARIATION_LOWER_RATIO
            upper = target * VARIATION_UPPER_RATIO
            status = "pass" if lower <= observed <= upper else (
                "too-little" if observed < lower else "too-much")
            watch_reason = (watch_features or {}).get(feature)
            if watch_reason:
                status = "watch-unreachable"
            checks.append({"feature": feature, "measuredSpread": target,
                           "shipSpread": observed, "lower": lower,
                           "upper": upper, "status": status,
                           **({"watchReason": watch_reason}
                              if watch_reason else {})})
        scored_checks = [row for row in checks
                         if row["status"] != "watch-unreachable"]
        groups.append({"group": measured_group["group"],
                       "variantPairCount": len(pair_rows), "checks": checks,
                       "passed": bool(scored_checks) and all(
                           row["status"] == "pass" for row in scored_checks)})
    evidenced = [group for group in groups if any(
        row["status"] != "watch-unreachable" for row in group["checks"])]
    if not evidenced:
        return {"status": "insufficient-evidence", "passed": False,
                "groups": groups,
                "reason": "take pairs expose no measurable Human-designated feature spread"}
    passed = all(group["passed"] for group in evidenced)
    return {"status": "pass" if passed else "fail", "passed": passed,
            "lowerRatio": VARIATION_LOWER_RATIO,
            "upperRatio": VARIATION_UPPER_RATIO, "groups": groups}


def _renderer_contract_hash(repo_root: Path | None = None) -> str:
    repo_root = repo_root or ROOT
    digest = hashlib.sha256()
    for relative in RENDERER_CONTRACT_FILES:
        path = repo_root / relative
        digest.update(str(relative).encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:16]


def _floor_group(reference: dict[str, Any]) -> str:
    """Group alternate takes only when pitch, dynamic and articulation agree."""
    if reference.get("floorGroup"):
        return str(reference["floorGroup"])
    dynamic = reference.get("dynamic")
    if dynamic is None and reference.get("velocity") is not None:
        dynamic = round(float(reference["velocity"]), 3)
    return "|".join(str(value) for value in (
        reference.get("midi"), dynamic, reference.get("articulation", "normal"),
        reference.get("vibrato", "ordinary"),
    ))


def _reference_variability(references: list[dict[str, Any]], feature_loader=extract_features,
                           weights: dict[str, float] | None = None,
                           instrument: str | None = None) -> dict[str, Any]:
    """Measure same-note/same-dynamic take-to-take feature distance."""
    groups: dict[str, list[int]] = {}
    for index, reference in enumerate(references):
        groups.setdefault(_floor_group(reference), []).append(index)
    eligible = {key: indices for key, indices in groups.items() if len(indices) >= 2}
    if not eligible:
        return {"status": "insufficient-evidence", "groups": [], "eligibleReferences": 0,
                "reason": "no same-pitch/same-dynamic group contains at least two takes"}
    cache = {}
    for indices in eligible.values():
        for index in indices:
            reference = references[index]
            if feature_loader is extract_features:
                expected_f0_hz = None
                if reference.get("midi") is not None:
                    expected_f0_hz = 440.0 * 2 ** ((float(reference["midi"]) - 69) / 12)
                cache[index] = feature_loader(
                    reference["path"],
                    active_duration_s=reference.get("durationSec"),
                    expected_f0_hz=expected_f0_hz,
                    trust_expected_f0=expected_f0_hz is not None,
                    force_percussive=(instrument or "").strip().lower() in {
                        "piano", "piano-grand", "grand-piano", "piano-upright",
                        "upright-piano", "guitar", "guitar-nylon", "guitar-steel",
                        "harp", "glockenspiel", "marimba", "xylophone", "vibraphone",
                    })
            else:
                cache[index] = feature_loader(reference["path"])
    rows = []
    for key, indices in sorted(eligible.items()):
        pairs = []
        for offset, left in enumerate(indices):
            for right in indices[offset + 1:]:
                result = compare_features(cache[left], cache[right], weights)
                pairs.append({"left": left, "right": right, "composite": result["composite"],
                              "features": result["features"], "normalized": result["normalized"],
                              "bandBalance": result.get("bandBalance")})
        feature_keys = pairs[0]["features"]
        rows.append({
            "group": key,
            "referenceIndices": indices,
            "pairCount": len(pairs),
            "floorComposite": float(np.median([row["composite"] for row in pairs])),
            "floorFeatures": {name: float(np.median([row["features"][name] for row in pairs]))
                              for name in feature_keys},
            "floorBandMaxOctaveDb": float(np.median([
                row["bandBalance"]["maxOctaveDb"] for row in pairs
                if row.get("bandBalance") and
                row["bandBalance"].get("maxOctaveDb") is not None
            ])) if any(row.get("bandBalance") and
                       row["bandBalance"].get("maxOctaveDb") is not None
                       for row in pairs) else None,
            "pairs": pairs,
        })
    return {"status": "measured", "groups": rows,
            "eligibleReferences": sum(len(row["referenceIndices"]) for row in rows)}


def _floor_evidence(variability: dict[str, Any], best: dict[str, Any]) -> dict[str, Any]:
    """Compare the best render against each measured reference-variability group."""
    if variability["status"] != "measured":
        return variability
    groups = []
    for group in variability["groups"]:
        render_values = [best["scores"][index]["composite"] for index in group["referenceIndices"]]
        render_composite = float(np.mean(render_values))
        floor_composite = float(group["floorComposite"])
        groups.append({**group, "renderComposite": render_composite,
                       "ratioToFloor": render_composite / max(floor_composite, 1e-12),
                       "atOrBelowFloor": render_composite <= floor_composite})
    construction_passed = bool(best.get("construction", {}).get("passed"))
    tripwire_passed = bool(best.get("tripwires", {}).get("strictPassed"))
    demonstrated = (construction_passed and tripwire_passed and
                    all(row["atOrBelowFloor"] for row in groups))
    return {"status": "demonstrated" if demonstrated else "above-floor",
            "constructionPassed": construction_passed,
            "tripwirePassed": tripwire_passed, "groups": groups,
            "eligibleReferences": variability["eligibleReferences"]}


def _band_limits_for_reference(index: int, variability: dict[str, Any]) -> tuple[float, float]:
    """T-005 bars widen to measured duplicate-take variability, never shrink."""
    if variability.get("status") == "measured":
        for group in variability.get("groups", []):
            if index in group.get("referenceIndices", []):
                mean_floor = group.get("floorFeatures", {}).get("band_balance_db")
                max_floor = group.get("floorBandMaxOctaveDb")
                return (max(3.0, float(mean_floor)) if mean_floor is not None else 3.0,
                        max(6.0, float(max_floor)) if max_floor is not None else 6.0)
    return 3.0, 6.0


_TRIPWIRE_FEATURES = {
    "partial-table": "partials_db",
    "mel-spectrogram": "log_mel_db",
    "attack-t90": "attack_ms",
    "vibrato": "vibrato",
    "inharmonicity": "inharmonicity_log_ratio",
    "band-balance": "band_balance_db",
}


def _tripwire_gate(notes: list[dict[str, Any]], references: list[dict[str, Any]],
                   construction: dict[str, Any],
                   weights: dict[str, float] | None = None) -> dict[str, Any]:
    """Consume the canonical §3 gate with audited feature controllability.

    Bars attached to zero-weight watch metrics stay in the owner-facing table,
    but only active bars participate in strict BAR x register x dynamic
    coverage and failure counts. This is the consuming-side assertion for the
    §2.3 rule: an uncontrollable metric cannot become an optimizer loss or a
    hard gate by another route.
    """
    scoring_weights = weights or weights_for_instrument(construction.get("instrument"))
    raw = evaluate_tripwires(construction.get("instrument", ""), notes)
    all_bars = list(dict.fromkeys(row["bar"] for row in raw["bars"]))
    active_bars = [
        bar for bar in all_bars
        if _TRIPWIRE_FEATURES.get(bar) is None or
        scoring_weights.get(_TRIPWIRE_FEATURES[bar], 0) > 0
    ]
    active_gate = {
        **raw,
        "bars": [row for row in raw["bars"] if row["bar"] in active_bars],
    }
    required_cells = list(dict.fromkeys(
        (str(reference.get("register")), str(reference.get("dynamic")))
        for reference in references
    ))
    aggregate = aggregate_by_cell(
        active_gate, required_cells=required_cells, required_bars=active_bars,
        family=construction.get("family"))

    rows = []
    for index, (note, reference) in enumerate(zip(notes, references)):
        note_gate = evaluate_tripwires(construction.get("instrument", ""), [note])
        checks = [{
            "name": check["bar"],
            "status": check["status"],
            "observed": check["value"],
            "limit": check["limit"],
            "active": check["bar"] in active_bars,
        } for check in note_gate["bars"]]
        active_checks = [check for check in checks if check["active"]]
        rows.append({
            "referenceIndex": index,
            "register": reference.get("register"),
            "dynamic": reference.get("dynamic"),
            "midi": reference.get("midi"),
            "passed": bool(active_checks) and all(
                check["status"] == "pass" for check in active_checks),
            "checks": checks,
            "bandBalance": note["result"].get("bandBalance"),
        })

    failed_cells = sum(row["status"] == "fail" for row in aggregate["cells"])
    failure_count = failed_cells + len(aggregate["strictMissingCells"])
    return {
        "passed": bool(construction.get("passed")) and aggregate["strictPassed"],
        "constructionPassed": bool(construction.get("passed")),
        "failureCount": failure_count,
        "activeBars": active_bars,
        "watchBars": [bar for bar in all_bars if bar not in active_bars],
        "bars": raw["bars"],
        "cells": aggregate["cells"],
        "strictMissingCells": aggregate["strictMissingCells"],
        "rows": rows,
    }


def _dominant_residual(best: dict[str, Any]) -> dict[str, Any] | None:
    scores = best.get("scores", [])
    if not scores:
        return None
    keys = scores[0].get("normalized", {})
    means = {}
    for key in keys:
        weighted = [score["normalized"][key] * score.get("weights", {}).get(key, 1)
                    for score in scores
                    if score.get("weights", {}).get(key, 1) > 0]
        if weighted:
            means[key] = float(np.mean(weighted))
    if not means:
        return None
    key = max(means, key=means.get)
    return {"feature": key, "meanPerceptualUnits": means[key]}


def _file_work_item(instrument: str, run_dir: Path, factor: str, action: str) -> Path:
    path = STATE_ROOT / instrument / "work-items.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = _load(path) if path.exists() else {"instrument": instrument, "items": []}
    payload["items"].append({"run": run_dir.name, "limitingFactor": factor,
                             "proposedFix": action, "filedAt": time.time(), "status": "open"})
    path.write_text(json.dumps(payload, indent=2) + "\n")
    return path


def _benchmark_resources(run_dir: Path, instrument: str, best: dict[str, Any]) -> dict[str, Any]:
    params_path = run_dir / "best-params.json"
    params_path.write_text(json.dumps(best["params"], indent=2) + "\n")
    output_path = run_dir / "resource-benchmark.json"
    process = subprocess.run([
        "node", "scripts/tone_match/benchmark_preset.mjs", "--params", str(params_path),
        "--id", instrument, "--iterations", "500", "--out", str(output_path),
    ], cwd=ROOT, text=True, capture_output=True)
    if process.returncode:
        return {"passed": False, "error": process.stderr or process.stdout}
    return _load(output_path)


def _feature_analysis_kwargs(instrument: str, reference: dict[str, Any]) -> dict[str, Any]:
    struck = instrument.strip().lower() in {
        "piano", "piano-grand", "grand-piano", "piano-upright",
        "upright-piano", "guitar",
        "guitar-nylon", "guitar-steel", "harp", "glockenspiel",
        "marimba", "xylophone", "vibraphone",
    }
    if not struck:
        return {}
    expected = 440.0 * 2 ** ((float(reference.get("midi", 60)) - 69) / 12)
    return {"expected_f0_hz": expected, "trust_expected_f0": True,
            "force_percussive": True}


def _reference_render_params_override(reference: dict[str, Any]) -> dict[str, str]:
    """Declare the reference role that may alter deterministic render policy."""
    role = "vibrato" if "vibrato" in reference_roles(reference) else "non-vibrato"
    return {"performanceRole": role}


def _render_ship_variants(
    run_dir: Path,
    label: str,
    instrument: str,
    params: dict[str, Any],
    references: list[dict[str, Any]],
    variability: dict[str, Any],
    weights: dict[str, float],
    count: int,
    *,
    repo_root: Path = ROOT,
    ship_calibration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if count < 2:
        raise ValueError("distributional gate requires at least two ship variants")
    target = run_dir / "ship-mode" / label
    target.mkdir(parents=True, exist_ok=True)
    ship_params = _mode_params(params, SHIP_MODE)
    if ship_calibration:
        ship_params["shipHumanCalibration"] = ship_calibration
    params_path = target / "params.json"
    human_range_overrides = []
    jobs_path = target / "jobs.json"
    if jobs_path.exists():
        existing_params = _load(params_path)
        if canonical_hash(existing_params) != canonical_hash(ship_params):
            raise ValueError(f"{target}: resumed SHIP params do not match saved contract")
        jobs = _load(jobs_path)
        if len(jobs) != count * len(references):
            raise ValueError(f"{target}: resumed SHIP job count does not match requested contract")
        seeds = [int(jobs[index * len(references)]["seed"])
                 for index in range(count)]
        for variant_index in range(count):
            for reference_index in range(len(references)):
                job = jobs[variant_index * len(references) + reference_index]
                human_range_overrides.append({
                    "variantIndex": variant_index,
                    "referenceIndex": reference_index,
                    "seed": int(job["seed"]),
                    "overrides": {key: value for key, value in
                                  job.get("paramsOverride", {}).items()
                                  if key != "performanceRole"},
                })
    else:
        params_path.write_text(json.dumps(ship_params, indent=2) + "\n")
        calibrated_seeds = ((ship_calibration or {}).get("seeds") or [])
        seeds = ([int(seed) for seed in calibrated_seeds[:count]]
                 if len(calibrated_seeds) >= count else
                 [secrets.randbits(31) for _ in range(count)])
        jobs = []
        for variant_index, seed in enumerate(seeds):
            variant_dir = target / f"variant-{variant_index:02d}"
            variant_dir.mkdir(parents=True, exist_ok=True)
            for reference_index, reference in enumerate(references):
                note_seed = seed + reference_index * 104_729
                performance_override = ship_human_overrides(
                    ship_params, midi=reference.get("midi", 60), seed=note_seed)
                jobs.append({
                    "paramsFile": str(params_path), "midi": reference.get("midi", 60),
                    "velocity": reference.get("velocity", .62),
                    "durationSec": reference.get("durationSec", 1.5),
                    "sampleRate": reference.get("sampleRate", 48_000),
                    "seed": note_seed,
                    "paramsOverride": {
                        **_reference_render_params_override(reference),
                        **performance_override,
                    },
                    "out": str(variant_dir / f"note-{reference_index}.wav"),
                })
                human_range_overrides.append({
                    "variantIndex": variant_index,
                    "referenceIndex": reference_index,
                    "seed": note_seed,
                    "overrides": performance_override,
                })
        jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    pending = [job for job in jobs
               if not Path(job["out"]).exists() or Path(job["out"]).stat().st_size <= 44]
    if pending:
        pending_path = target / "jobs-pending.json"
        pending_path.write_text(json.dumps(pending, indent=2) + "\n")
        process = subprocess.run(
            ["node", "scripts/render_note.mjs", "--batch", str(pending_path)],
            cwd=repo_root, text=True, capture_output=True)
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)
    rendered: dict[int, list[Any]] = {index: [] for index in range(len(references))}
    analysis_failures: list[dict[str, Any]] = []
    for variant_index in range(count):
        for reference_index, reference in enumerate(references):
            path = target / f"variant-{variant_index:02d}" / f"note-{reference_index}.wav"
            try:
                rendered[reference_index].append(extract_features(
                    path, active_duration_s=reference.get("durationSec", 1.5),
                    release_expected=bool(reference.get("releaseEligible", False)),
                    **_feature_analysis_kwargs(instrument, reference)))
            except ValueError as error:
                # A single unpitched/failed ship render must not erase the
                # usable distributional evidence or the listening artefact.
                # Keep the failure visible and exclude that take only.
                analysis_failures.append({
                    "variantIndex": variant_index,
                    "referenceIndex": reference_index,
                    "render": str(path),
                    "error": str(error),
                })
    pair_fits = ((ship_params.get("humanRanges") or {}).get("pairFits") or [])
    qualified_groups = {
        str(row["group"]) for row in pair_fits
        if isinstance(row, dict) and row.get("group")
    }
    gate = _distributional_variation_gate(
        variability, rendered, weights,
        eligible_groups=qualified_groups or None,
        eligible_features=set((ship_calibration or {}).get(
            "directFeatures", [])) or None,
        watch_features=(ship_calibration or {}).get("watchFeatures"))
    payload = {"mode": SHIP_MODE, "variantCount": count, "seeds": seeds,
               "paramsHash": canonical_hash(ship_params), "gate": gate,
               "humanRangeOverrides": human_range_overrides,
               "analysisFailures": analysis_failures,
               "primaryRenderDirectory": str(target / "variant-00")}
    (target / "variation-gate.json").write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def _build_listening_page(run_dir: Path, instrument: str, best: dict[str, Any],
                          references: list[dict[str, Any]],
                          ship_render: dict[str, Any]) -> dict[str, Any]:
    render_dir = Path(ship_render["primaryRenderDirectory"])
    manifest = [{
        "label": f"{instrument} · {reference.get('register', '?')} · {reference.get('dynamic', '?')}",
        "instrument": instrument, "reference": reference["path"],
        "render": str(render_dir / f"note-{index}.wav"),
    } for index, reference in enumerate(references)]
    manifest_path = run_dir / "audition-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    listen_path = run_dir / f"listen-{instrument}-{run_dir.name}.html"
    build_audition(str(manifest_path), str(listen_path))
    return {"bestRenderDirectory": str(render_dir), "listeningPage": str(listen_path),
            "auditionManifest": str(manifest_path), "mode": SHIP_MODE,
            "seed": ship_render["seeds"][0]}


def _technique_exchange_statuses() -> list[dict[str, str]]:
    path = ROOT / "docs" / "sg2" / "TECHNIQUES_EXCHANGE.md"
    if not path.exists():
        return [{"id": "exchange", "title": "techniques exchange",
                 "engine": "FAIL: file missing from branch"}]
    statuses, current_id, title, body = [], None, "", []

    def flush() -> None:
        if not current_id:
            return
        lanes = {key: "missing" for key in
                 ("engine", "analysis", "bowed", "sung", "struck/plucked")}
        pattern = re.compile(
            r"(?:^|\s)(engine|analysis|bowed|sung|struck/plucked)="
            r"(.*?)(?=\s(?:engine|analysis|bowed|sung|struck/plucked)=|$)")
        status_chunks: list[str] = []
        current_chunk = ""
        for line in body:
            if line.startswith("Status"):
                if current_chunk:
                    status_chunks.append(current_chunk)
                current_chunk = line
            elif current_chunk and not line:
                status_chunks.append(current_chunk)
                current_chunk = ""
            elif current_chunk:
                current_chunk += " " + line
        if current_chunk:
            status_chunks.append(current_chunk)
        for chunk in status_chunks:
            for match in pattern.finditer(chunk):
                lanes[match.group(1)] = match.group(2).strip()
        statuses.append({"id": current_id, "title": title, **lanes})

    for line in path.read_text().splitlines():
        if line.startswith("### T-"):
            flush()
            heading = line[4:].strip()
            current_id, _, title = heading.partition(" · ")
            body = []
        elif current_id:
            body.append(line.strip())
    flush()
    return statuses


def _write_run_report(path: Path, summary: dict[str, Any]) -> None:
    floor = summary["referenceVariabilityFloor"]
    lines = [f"# SG2 run report — {summary['instrument']} / {summary['run']}\n\n",
             f"Session outcome: **{summary['sessionOutcome']['state']}**  \n",
             f"Baseline loss: `{summary['baselineLoss']:.6f}`  \n",
             f"Best loss: `{summary['bestLoss']:.6f}`  \n",
             f"Improvement: `{summary['improvement']:.6f}`  \n",
             f"Construction gate: `{'pass' if summary['constructionPassed'] else 'fail'}`  \n",
             f"§3 tripwire gate: `{'pass' if summary.get('tripwirePassed', summary.get('automatedGatePassed')) else 'fail'}`  \n",
             f"Reference-variability status: `{floor['status']}`\n\n"]
    prior = summary.get("legacyPrior", {})
    lines.extend([
        "## §2.4c strongest prior\n\n",
        f"Lookup row: `{prior.get('instrument', 'missing')}` → "
        f"`{prior.get('source', prior.get('parent', 'missing'))}` "
        f"(`{prior.get('kind', 'missing')}`).  \n",
        f"Anchor: `{prior.get('tag') or 'derived-parent'}` / "
        f"`{prior.get('commit') or prior.get('declaredParent', 'missing')}`  \n",
        f"Prior row hash: `{prior.get('rowHash', 'missing')}`  \n",
        f"Resolved parameter hash: `{prior.get('resolvedParameterHash', 'missing')}`\n\n",
        "FIT-MODE supplies the deterministic single-take objective; "
        "SHIP-MODE supplies leaderboard/listening renders.\n\n",
    ])
    variation = summary.get("distributionalVariationGate", {})
    lines.extend([
        "## §2.5c.6 distributional variation gate\n\n",
        f"Verdict: **{str(variation.get('status', 'missing')).upper()}**; "
        f"seeded ship variants: `{summary.get('shipVariantCount', 0)}`.\n\n",
        "| Take-pair group | Feature | Measured spread | Ship spread | Range | Verdict |\n",
        "|---|---|---:|---:|---:|:---:|\n",
    ])
    for group in variation.get("groups", []):
        for check in group.get("checks", []):
            lines.append(
                f"| `{group['group']}` | `{check['feature']}` | "
                f"{check['measuredSpread']:.4f} | {check['shipSpread']:.4f} | "
                f"{check['lower']:.4f}–{check['upper']:.4f} | "
                f"{check['status'].upper()} |\n")
    controllability = summary.get("controllability")
    if controllability:
        lines.extend(["## Controllability contract\n\n",
                      f"Objective hash: `{controllability['objectiveHash']}`  \n",
                      f"Manifest hash: `{controllability['manifestHash']}`  \n",
                      f"Verdict: `{'CLEAN' if controllability['clean'] else 'NOT CLEAN'}`\n\n",
                      "| Feature | Weight | Responsive parameters | Status |\n",
                      "|---|---:|---|---|\n"])
        for verdict in controllability["verdicts"]:
            responders = controllability["responsiveParameters"].get(
                verdict["feature"], [])
            lines.append(f"| `{verdict['feature']}` | {verdict['weight']} | "
                         f"{', '.join(f'`{key}`' for key in responders) or '—'} | "
                         f"{verdict['status']} |\n")
        repeatability = controllability.get("repeatability", {})
        lines.extend([
            "\n## Repeat-render stability\n\n",
            f"Status: `{repeatability.get('status', 'missing')}`  \n",
            "Unstable features: " +
            (", ".join(f"`{feature}`" for feature in
                       repeatability.get("unstableFeatures", [])) or "none") +
            "\n\n",
        ])
    if summary.get("tripwires"):
        lines.extend(["\n", tripwire_table_markdown(summary["tripwires"]), "\n"])
    if floor.get("groups"):
        lines.extend(["## Reference-variability evidence\n\n",
                      "| Same-note/dynamic group | Take↔take floor | Render↔reference | Ratio | At/below |\n",
                      "|---|---:|---:|---:|:---:|\n"])
        for group in floor["groups"]:
            lines.append(f"| `{group['group']}` | {group['floorComposite']:.4f} | "
                         f"{group.get('renderComposite', math.nan):.4f} | "
                         f"{group.get('ratioToFloor', math.nan):.3f} | "
                         f"{'yes' if group.get('atOrBelowFloor') else 'no'} |\n")
    if summary.get("dominantResidual"):
        residual = summary["dominantResidual"]
        lines.extend(["\n## Dominant residual\n\n",
                      f"`{residual['feature']}` at `{residual['meanPerceptualUnits']:.4f}` perceptual units.\n"])
    controllability = summary.get("controllability") or {}
    lines.extend(["\n## Controllability gate\n\n",
                  f"Status: `{controllability.get('status', 'not-supplied')}`  \n",
                  f"Repeat-render stability: "
                  f"`{controllability.get('repeatability', {}).get('status', 'not-supplied')}`\n"])
    if controllability.get("zeroWeighted"):
        lines.extend(["\n| Zero-weight watch metric | Reason |\n", "|---|---|\n"])
        for row in controllability["zeroWeighted"]:
            lines.append(f"| `{row['feature']}` | {row['reason']} |\n")
    outcome = summary["sessionOutcome"]
    if outcome["state"] == "limiting-factor":
        lines.extend(["\n## Filed limiting factor\n\n",
                      f"Factor: {outcome['limitingFactor']}\n\n",
                      f"Fix: {outcome['workItem']}\n"])
    gate = summary.get("tripwireGate")
    if gate is not None:
        check_names = [row["name"] for row in gate["rows"][0]["checks"]] if gate.get("rows") else []
        lines.extend(["\n## Automated §3 gate — " + ("PASS" if summary.get("automatedGatePassed") else "FAIL") + "\n\n",
                      "| Register | Dynamic | MIDI | " + " | ".join(check_names) + " | Row |\n",
                      "|---|---|---:|" + "---:|" * len(check_names) + "---:|\n"])
        for row in gate.get("rows", []):
            by_name = {check["name"]: check for check in row["checks"]}
            marks = [("WATCH" if not by_name[name].get("active", True) else
                      "PASS" if by_name[name]["status"] == "pass" else
                      "N/A" if by_name[name]["status"] == "not-applicable" else "FAIL")
                     for name in check_names]
            lines.append(f"| {row.get('register') or '?'} | {row.get('dynamic') or '?'} | "
                         f"{row.get('midi') or '?'} | " + " | ".join(marks) +
                         f" | {'PASS' if row['passed'] else 'FAIL'} |\n")
    construction = summary.get("construction", {})
    lines.extend(["\n### Construction checklist\n\n",
                  "| Assertion | Status | Requirement |\n|---|:---:|---|\n"])
    for row in construction.get("assertions", []):
        lines.append(f"| `{row['id']}` | {row['status'].upper()} | {row['requirement']} |\n")
    resource = summary.get("resourceTripwire", {})
    lines.extend(["\n### Resource tripwire\n\n",
                  f"Overall: **{'PASS' if resource.get('passed') else 'FAIL'}**.  \n",
                  f"Oscillators: `{resource.get('preset', {}).get('oscillators', 'n/a')}`; "
                  f"automation events/note: `{resource.get('preset', {}).get('automationEventsPerNote', 'n/a')}`; "
                  f"model ms/note: `{resource.get('preset', {}).get('modelMsPerNote', 'n/a')}`.\n"])
    lines.extend(["\n## Controllability\n\n",
                  "| Parameter | Fitted | −10% loss | +10% loss | Mean increase |\n",
                  "|---|---:|---:|---:|---:|\n"])
    for key in summary.get("freeParameters", []):
        sensitivity = summary.get("sensitivity", {}).get(key)
        if sensitivity:
            lines.append(f"| `{key}` | {summary['bestParams'].get(key)} | "
                         f"{sensitivity['minus']:.6f} | {sensitivity['plus']:.6f} | "
                         f"{sensitivity['increase']:.6f} |\n")
        else:
            lines.append(f"| `{key}` | {summary['bestParams'].get(key)} | not run | not run | not run |\n")
    lines.extend(["\n## Techniques exchange statuses (generated from live file)\n\n",
                  "| Entry | Engine | Analysis | Bowed | Sung | Struck/plucked |\n"
                  "|---|---|---|---|---|---|\n"])
    for row in summary.get("exchangeStatuses", []):
        lines.append(f"| `{row['id']}` {row['title']} | {row['engine']} | "
                     f"{row['analysis']} | {row['bowed']} | {row['sung']} | "
                     f"{row['struck/plucked']} |\n")
    board = summary["leaderboardState"]
    legacy = summary.get("legacyBaseline", {})
    lines.extend(["\n## Leaderboard state\n\n",
                  f"Reference set: `{summary['referenceSet']}`. Current run is "
                  f"**{'leader' if board['isLeader'] else 'not leader'}**; "
                  f"previous comparable best: `{board.get('previousBestLoss')}`; "
                  f"current loss: `{summary['bestLoss']:.6f}`.\n",
                  f"Leaderboard row 1: `legacy-baseline` at "
                  f"`{legacy.get('loss', 'missing')}` in ship mode.\n",
                  "\n## Owner render directories\n\n",
                  f"Best renders: `{summary['renderArtifacts']['bestRenderDirectory']}`  \n",
                  f"Listening page: `{summary['renderArtifacts']['listeningPage']}`  \n",
                  f"Manifest: `{summary['renderArtifacts']['auditionManifest']}`  \n",
                  f"Mode: `{summary['renderArtifacts'].get('mode', 'missing')}`; "
                  f"fresh seed: `{summary['renderArtifacts'].get('seed', 'missing')}`.\n"])
    path.write_text("".join(lines), encoding="utf-8")


def _params(manifest: dict, initial: dict, only: list[str] | None,
            *, mode: str = FIT_MODE) -> list[FreeParam]:
    """Resolve free parameters while retaining an explicit campaign order."""
    result: dict[str, FreeParam] = {}
    excitation = initial.get("excitationType")
    family = initial.get("sg2Family")
    for row in manifest["continuous"]:
        if mode == FIT_MODE and row["key"] in HUMAN_ONLY_PARAM_KEYS:
            continue
        if only and row["key"] not in only:
            continue
        applies = row.get("appliesTo")
        if applies and excitation not in applies and family not in applies:
            continue
        result[row["key"]] = FreeParam(row["key"], float(row["min"]), float(row["max"]),
                                       float(initial.get(row["key"], row["default"])))
    if only:
        return [result[key] for key in dict.fromkeys(only) if key in result]
    return list(result.values())


class ToneMatcher:
    def __init__(self, instrument: str, initial: dict, references: list[dict],
                 free: list[FreeParam], run_dir: Path, repo_root: Path = ROOT,
                 weights: dict[str, float] | None = None,
                 variability: dict[str, Any] | None = None,
                 criteria_noise_floor: dict[str, float] | None = None):
        self.instrument, self.initial, self.references, self.free = instrument, initial, references, free
        self.run_dir = run_dir
        self.repo_root = repo_root
        self.weights = weights or weights_for_instrument(instrument)
        self.variability = variability or {}
        self.criteria_noise_floor = criteria_noise_floor or {}
        self.criteria_drift_state: dict[str, Any] | None = None
        self.evaluations: list[dict] = []
        self.best: dict | None = None
        self._objective_cache: dict[str, tuple[float, float]] = {}

    def decode(self, values: np.ndarray) -> dict:
        params = dict(self.initial)
        for spec, value in zip(self.free, values):
            params[spec.key] = float(np.clip(value, spec.lo, spec.hi))
        return params

    def evaluate(self, values: np.ndarray, *, retain_audio: bool = False) -> float:
        params = self.decode(values)
        candidate_fingerprint = _candidate_fingerprint(self.free, params)
        if candidate_fingerprint in self._objective_cache:
            return self._objective_cache[candidate_fingerprint][0]
        index = len(self.evaluations)
        target = self.run_dir / "renders" / f"eval-{index:04d}"
        target.mkdir(parents=True, exist_ok=True)
        params_path = target / "params.json"
        fit_params = _mode_params(params, FIT_MODE)
        params_path.write_text(json.dumps(fit_params, indent=2) + "\n")
        jobs = []
        for ref_index, ref in enumerate(self.references):
            articulation_seed = None
            if float(fit_params.get("articulationCoupling", 0) or 0) > 0:
                articulation_seed = int(fit_params.get("seed", 7331)) + ref_index * 104729
            jobs.append({"paramsFile": str(params_path), "midi": ref.get("midi", 60),
                         "velocity": ref.get("velocity", .62), "durationSec": ref.get("durationSec", 1.5),
                         "sampleRate": ref.get("sampleRate", 48000),
                         "paramsOverride": _reference_render_params_override(ref),
                         **({"seed": articulation_seed} if articulation_seed is not None else {}),
                         "out": str(target / f"note-{ref_index}.wav")})
        jobs_path = target / "jobs.json"
        jobs_path.write_text(json.dumps(jobs))
        process = subprocess.run(["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
                                 cwd=self.repo_root, text=True, capture_output=True)
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)
        scores, construction_samples, tripwire_notes = [], [], []
        analysis_failures = []
        # Struck/plucked lane (pass05): impulsive references are analysed
        # with a trusted expected f0 and forced-percussive segmentation so a
        # damped low course cannot be mis-tracked as sustained.
        struck = (params.get("sg2Family") == "struck-plucked" or
                  (self.instrument or "").strip().lower() in {
                      "piano", "piano-grand", "grand-piano", "piano-upright",
                      "upright-piano", "guitar", "guitar-nylon", "guitar-steel",
                      "harp", "glockenspiel", "marimba", "xylophone", "vibraphone"})
        for ref_index, (ref, job) in enumerate(zip(self.references, jobs)):
            analysis_kwargs = {}
            if struck:
                analysis_kwargs = {
                    "expected_f0_hz": 440.0 * 2 ** (
                        (float(ref.get("midi", 60)) - 69) / 12),
                    "trust_expected_f0": True,
                    "force_percussive": True,
                }
            reference_bundle = extract_features(
                ref["path"], release_expected=bool(ref.get("releaseEligible")),
                **analysis_kwargs)
            try:
                render_bundle = extract_features(
                    job["out"], active_duration_s=ref.get(
                        "durationSec", 1.5),
                    release_expected=bool(ref.get("releaseEligible")),
                    **analysis_kwargs)
            except ValueError as error:
                failure = {
                    "referenceIndex": ref_index,
                    "reference": ref.get("path"),
                    "render": job["out"],
                    "error": str(error),
                }
                analysis_failures.append(failure)
                scores.append({
                    "composite": ANALYSIS_FAILURE_LOSS,
                    "features": {key: 0.0 for key in self.weights},
                    "normalized": {key: 0.0 for key in self.weights},
                    "weights": self.weights,
                    "analysisFailure": failure,
                })
                continue
            score = compare_features(
                reference_bundle, render_bundle, self.weights)
            scores.append(score)
            roles = reference_roles(ref)
            if roles != {"floor"}:
                mean_limit, max_limit = _band_limits_for_reference(
                    ref_index, self.variability)
                construction_samples.append(ConstructionSample(
                    render=render_bundle, reference=reference_bundle,
                    register=ref.get("register"), dynamic=ref.get("dynamic"),
                    velocity=ref.get("velocity"), roles=frozenset(roles),
                    band_mean_limit_db=mean_limit,
                    band_max_octave_limit_db=max_limit))
            tripwire_notes.append({
                "register": ref.get("register"),
                "dynamic": ref.get("dynamic"),
                "roles": sorted(roles),
                "result": score,
                "ref": reference_bundle,
                "render": render_bundle,
            })
        construction = evaluate_construction(self.instrument, construction_samples, params=params,
                                             strict_evidence=True)
        raw_tripwires = evaluate_tripwires(
            self.instrument, tripwire_notes, weights=self.weights)
        coverage_contract = required_cells_by_bar(
            self.references, raw_tripwires["activeBars"])
        tripwires = {
            **raw_tripwires,
            "coverageContract": coverage_contract,
            **aggregate_by_cell(
                raw_tripwires,
                required_cells_by_bar=coverage_contract,
                family=params.get("sg2Family"),
            ),
        }
        tripwire_failures = (
            sum(row["status"] == "fail" for row in tripwires["cells"]) +
            len(tripwires["strictMissingCells"])
        )
        loss = float(np.mean([row["composite"] for row in scores]))
        # Construction is a hard gate, not another feature that a low
        # composite can average away.  The large objective penalty guides
        # Powell back into a valid topology while reports retain raw loss.
        gate_failures = (
            construction["counts"]["fail"] + tripwire_failures +
            len(analysis_failures)
        )
        gate_penalty = 100.0 * gate_failures
        objective = loss + gate_penalty
        criterion_vector = feature_loss_vector(scores)
        record = {"evaluation": index, "loss": loss, "params": params,
                  "renderMode": FIT_MODE,
                  "objective": objective, "gateFailures": gate_failures,
                  "analysisFailures": analysis_failures,
                  "construction": construction, "tripwires": tripwires,
                  "featureLossVector": criterion_vector,
                  "scores": scores}
        self.evaluations.append(record)
        (self.run_dir / "loss_curve.json").write_text(json.dumps(self.evaluations, indent=2) + "\n")
        if self.best is None or (gate_failures, loss) < (
                self.best["gateFailures"], self.best["loss"]):
            self.best = {"loss": loss, "objective": objective, "params": params,
                         "renderMode": FIT_MODE, "evaluation": index,
                         "gateFailures": gate_failures,
                         "analysisFailures": analysis_failures,
                         "construction": construction, "tripwires": tripwires,
                         "featureLossVector": criterion_vector,
                         "scores": scores}
            (self.run_dir / "best.json").write_text(json.dumps(self.best, indent=2) + "\n")
            self.criteria_drift_state = persist_accepted_step(
                self.run_dir, self.instrument, index, gate_failures, loss,
                criterion_vector, self.criteria_noise_floor)
        if not retain_audio and self.best and self.best["evaluation"] != index:
            for job in jobs:
                Path(job["out"]).unlink(missing_ok=True)
        self._objective_cache[candidate_fingerprint] = (objective, loss)
        return objective


def _sensitivity(matcher: ToneMatcher, best: dict) -> dict[str, Any]:
    base = np.asarray([best["params"].get(p.key, p.default) for p in matcher.free])
    rows = {}
    for index, spec in enumerate(matcher.free):
        span = .1 * (spec.hi - spec.lo)
        losses = []
        for sign in (-1, 1):
            trial = base.copy(); trial[index] = np.clip(trial[index] + sign * span, spec.lo, spec.hi)
            matcher.evaluate(trial)
            fingerprint = _candidate_fingerprint(
                matcher.free, matcher.decode(trial))
            losses.append(matcher._objective_cache[fingerprint][1])
        rows[spec.key] = {"minus": losses[0], "plus": losses[1],
                          "increase": float(np.mean(losses) - best["loss"])}
    return rows


def _reference_set_id(references: list[dict[str, Any]],
                      instrument: str | None = None,
                      weights: dict[str, float] | None = None,
                      prior_hash: str | None = None,
                      repo_root: Path = ROOT) -> str:
    """Identify the scored objective so unlike manifests are never ranked."""
    objective = {
        "references": references,
        "weights": weights or weights_for_instrument(instrument),
        "priorHash": prior_hash,
        "scorerContractVersion": SCORER_CONTRACT_VERSION,
        "rendererContractHash": _renderer_contract_hash(repo_root),
    }
    canonical = json.dumps(objective, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _free_manifest_contract(free: list[FreeParam]) -> list[dict[str, Any]]:
    return [{"key": row.key, "min": row.lo, "max": row.hi,
             "default": row.default} for row in free]


def _consume_controllability_audit(path: Path, instrument: str,
                                   references: list[dict[str, Any]],
                                   free: list[FreeParam],
                                   starting_weights: dict[str, float],
                                   initial: dict[str, Any] | None = None,
                                   repo_root: Path = ROOT) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"missing controllability audit: {path}")
    audit = _load(path)
    final_weights = audit.get("finalWeights")
    if not isinstance(final_weights, dict):
        final_weights = {}
    expected_objective = objective_contract_hash(
        instrument, references, final_weights)
    expected_manifest = manifest_contract_hash(_free_manifest_contract(free))
    errors = []
    if audit.get("instrument") != instrument:
        errors.append(f"instrument {audit.get('instrument')!r} != {instrument!r}")
    if audit.get("objectiveHash") != expected_objective:
        errors.append("reference objective hash mismatch")
    if audit.get("manifestHash") != expected_manifest:
        errors.append("free-parameter manifest hash mismatch")
    if int(audit.get("schemaVersion", 0)) < 3:
        errors.append("repeat-render stability evidence is missing")
    if audit.get("referenceContractHash") != audit_contract_hash(references):
        errors.append("reference manifest contract hash mismatch")
    if audit.get("parameterManifestHash") != audit_contract_hash(
            _free_manifest_contract(free)):
        errors.append("parameter manifest contract hash mismatch")
    if initial is not None and audit.get("initialPresetHash") != audit_contract_hash(initial):
        errors.append("initial preset contract hash mismatch")
    if audit.get("scorerContractVersion") != SCORER_CONTRACT_VERSION:
        errors.append("scorer contract version mismatch")
    if audit.get("rendererContractHash") != _renderer_contract_hash(repo_root):
        errors.append("renderer contract hash mismatch")
    if set(final_weights) != set(starting_weights):
        errors.append("final scoring weight keys mismatch")
    invalid_weights = sorted(
        feature for feature, weight in starting_weights.items()
        if float(final_weights.get(feature, 0)) not in (0.0, float(weight)))
    if invalid_weights:
        errors.append(
            f"audit changed weights rather than zeroing them: {invalid_weights}")
    unstable = set(audit.get("repeatability", {}).get(
        "unstableFeatures", []))
    active_unstable = sorted(
        feature for feature in unstable
        if float(final_weights.get(feature, 0)) > 0)
    if active_unstable:
        errors.append(
            f"repeat-unstable features still carry weight: {active_unstable}")
    uncontrolled = [
        feature for feature, weight in final_weights.items()
        if weight > 0 and not audit.get("responsiveParameters", {}).get(feature)
    ]
    if uncontrolled:
        errors.append(f"weighted features without responder: {uncontrolled}")
    if not audit.get("clean"):
        errors.append(f"audit is not clean: {audit.get('uncontrolledWeightedFeatures', [])}")
    if errors:
        raise ValueError(f"invalid controllability audit {path}: " + "; ".join(errors))
    return audit


def _leaderboard_entry(run_dir: Path, best: dict, reference_set: str, *,
                       kind: str = "candidate",
                       variation_gate: dict[str, Any] | None = None,
                       prior: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "run": run_dir.name, "kind": kind, "loss": best["loss"],
        "params": best["params"], "time": time.time(),
        "referenceSet": reference_set, "renderMode": SHIP_MODE,
        "fitModeLoss": best["loss"], "variationGate": variation_gate,
        "prior": prior,
        "constructionPassed": bool(best.get("construction", {}).get("passed")),
        "constructionFailures": int(best.get("construction", {}).get(
            "counts", {}).get("fail", 0)),
        "tripwirePassed": bool(best.get("tripwires", {}).get("strictPassed")),
        "tripwireFailures": int(
            sum(row.get("status") == "fail"
                for row in best.get("tripwires", {}).get("cells", [])) +
            len(best.get("tripwires", {}).get("strictMissingCells", []))),
        "gateFailures": int(best.get("gateFailures", 0)),
    }


def _write_leaderboard(instrument: str, board: dict[str, Any]) -> None:
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board_path.write_text(json.dumps(board, indent=2) + "\n")
    backstop = STATE_ROOT / instrument / "leaderboard.json"
    backstop.parent.mkdir(parents=True, exist_ok=True)
    backstop.write_text(json.dumps(board, indent=2) + "\n")


def _ensure_legacy_baseline(instrument: str, run_dir: Path, best: dict,
                            reference_set: str, prior: dict[str, Any],
                            variation_gate: dict[str, Any]) -> dict[str, Any]:
    """Persist the mandatory founding baseline as leaderboard entry #1."""
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board = _load(board_path) if board_path.exists() else {
        "schemaVersion": 2, "instrument": instrument, "runs": []}
    existing = next((row for row in board.get("runs", [])
                     if row.get("referenceSet") == reference_set and
                     row.get("kind") == "legacy-baseline"), None)
    if existing is None:
        existing = _leaderboard_entry(
            run_dir, best, reference_set, kind="legacy-baseline",
            variation_gate=variation_gate, prior=prior)
        existing["entryNumber"] = 1
        board.setdefault("runs", []).insert(0, existing)
    board.setdefault("legacyBaselineByReferenceSet", {})[reference_set] = existing
    board.setdefault("bestByReferenceSet", {}).setdefault(reference_set, existing)
    board.setdefault("best", existing)
    _write_leaderboard(instrument, board)
    return existing


def _update_leaderboard(instrument: str, run_dir: Path, best: dict,
                        reference_set: str, *, persist: bool = True,
                        variation_gate: dict[str, Any] | None = None,
                        prior: dict[str, Any] | None = None,
                        require_ship_gate: bool = False) -> tuple[bool, float | None]:
    """Compare a candidate with the board, optionally recording it.

    Invalid stops and filed plateaus must not become fitted presets merely
    because they reduce a hard-gate failure count while worsening raw error.
    Callers preview first, classify the session, then persist accepted runs.
    """
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board = _load(board_path) if board_path.exists() else {"instrument": instrument, "runs": []}
    comparable = [row for row in board.get("runs", [])
                  if row.get("referenceSet") == reference_set]
    previous = min(comparable, key=lambda row: (row.get("gateFailures",
                                                        row.get("constructionFailures", 0)),
                                                row["loss"])) \
        if comparable else None
    previous_loss = float(previous["loss"]) if previous and "loss" in previous else None
    entry = _leaderboard_entry(
        run_dir, best, reference_set, variation_gate=variation_gate, prior=prior)
    legacy = next((row for row in comparable
                   if row.get("kind") == "legacy-baseline"), None)
    ship_eligible = (not require_ship_gate or
                     bool((variation_gate or {}).get("passed")))
    beats_legacy = (legacy is None or entry["loss"] < float(legacy["loss"]) *
                    (1.0 - MEASURABLE_REL_IMPROVEMENT))
    entry["shipEligible"] = ship_eligible
    entry["beatsLegacyComposite"] = beats_legacy
    entry["ownerEar"] = "pending"
    if previous is None:
        current = entry
        improved = ship_eligible and beats_legacy
    else:
        previous_gates = previous.get(
            "gateFailures", previous.get("constructionFailures", 0))
        entry_gates = entry.get("gateFailures", entry.get("constructionFailures", 0))
        improved = ship_eligible and beats_legacy and (
            entry_gates < previous_gates or
            (entry_gates == previous_gates and
             entry["loss"] < previous["loss"] *
             (1.0 - MEASURABLE_REL_IMPROVEMENT))
        )
        current = entry if improved else previous
    if persist:
        board["runs"].append(entry)
        board.setdefault("bestByReferenceSet", {})[reference_set] = current
        board["best"] = current
        _write_leaderboard(instrument, board)
    return improved, previous_loss


def _snapshot_best(instrument: str, run_dir: Path, best: dict) -> Path:
    path = STATE_ROOT / instrument / run_dir.name / "best.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(best, indent=2) + "\n")
    return path


def _append_ledger(instrument: str, run_dir: Path, best: dict, sensitivity: dict,
                   free: list[FreeParam]) -> None:
    ledger = ROOT / "docs" / "SG2_PARAM_LEDGER.md"
    if not ledger.exists():
        ledger.write_text("# Sound Generator 2.0 parameter ledger\n\nDerived by `scripts/tone_match/iterate.py`; lower loss is better.\n\n")
    rows = [f"\n## {instrument} — {run_dir.name}\n\nComposite loss: `{best['loss']:.6f}`\n\n| Parameter | Fitted | ±10% sensitivity |\n|---|---:|---:|\n"]
    free_keys = {spec.key for spec in free}
    for key, value in sorted(best["params"].items()):
        if key not in free_keys:
            continue
        measured = (f"{sensitivity[key]['increase']:.6f}"
                    if key in sensitivity else "not run")
        rows.append(f"| `{key}` | {value!s} | {measured} |\n")
    with ledger.open("a") as handle:
        handle.writelines(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--initial", required=True,
                        help="campaign measured/pinned seed; §2.4c prior is applied automatically")
    parser.add_argument("--references", required=True, help="reference-note manifest JSON")
    parser.add_argument("--manifest", default=str(Path(__file__).with_name("manifest.json")))
    parser.add_argument("--controllability",
                        help="hashed controllability.json; defaults to the campaign audit")
    parser.add_argument("--keys", help="comma-separated free keys; default is every applicable continuous key")
    parser.add_argument("--budget", type=int, default=200)
    parser.add_argument("--ship-variants", type=int, default=DEFAULT_SHIP_VARIANTS)
    parser.add_argument("--ship-human", type=float,
                        help="evidence-backed SHIP Human setting; FIT mode still zeros it")
    parser.add_argument("--ship-calibration", type=Path,
                        help="measured SHIP draw-scale calibration JSON")
    parser.add_argument("--run", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--resume", action="store_true",
                        help="resume a contract-identical interrupted run directory")
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--limiting-factor", help="evidenced plateau cause when this run neither improves nor reaches the floor")
    parser.add_argument("--work-item", help="concrete fix to file for --limiting-factor")
    parser.add_argument("--repo-root", type=Path, default=ROOT,
                        help="engine checkout used for headless renders")
    args = parser.parse_args(argv)
    ship_calibration = (_load(args.ship_calibration)
                        if args.ship_calibration else None)
    campaign_seed = _load_preset(args.initial)
    initial, prior = resolve_legacy_prior(args.instrument, campaign_seed)
    if args.ship_human is not None:
        if not 0 <= args.ship_human <= 1:
            parser.error("--ship-human must be in [0, 1]")
        initial["excitationHuman"] = float(args.ship_human)
        prior["calibratedShipHuman"] = float(args.ship_human)
        prior["resolvedParameterHash"] = canonical_hash(initial)
        prior["resolvedHash"] = prior["resolvedParameterHash"]
    references, manifest = _load(args.references), _load(args.manifest)
    # T-012 consuming-side assertion: an owner-rejected take must never be
    # scored, floored, or hashed into the objective id.
    from .exclusions import assert_no_excluded
    assert_no_excluded(references, f"{args.instrument} campaign manifest")
    # D-VOICE-03: fitted presets, prior seeds and objective rows cross the
    # sung boundary only after their provenance has been checked.
    assert_sung_family_firewall(
        args.instrument, initial, references=references, prior=prior)
    if bool(args.limiting_factor) != bool(args.work_item):
        parser.error("--limiting-factor and --work-item must be supplied together")
    if args.ship_variants < 2:
        parser.error("--ship-variants must be at least 2")
    starting_weights = weights_for_instrument(args.instrument)
    only = list(dict.fromkeys(key.strip() for key in args.keys.split(",") if key.strip())) if args.keys else None
    free = _params(manifest, initial, only)
    if not free:
        raise SystemExit("no applicable free parameters")
    audit_path = (Path(args.controllability) if args.controllability else
                  SG2_DATA_ROOT / "campaigns" / args.instrument /
                  "audit" / "controllability.json")
    controllability = _consume_controllability_audit(
        audit_path, args.instrument, references, free, starting_weights,
        initial=initial, repo_root=args.repo_root)
    scoring_weights = controllability["finalWeights"]
    variability = _reference_variability(
        references, weights=scoring_weights, instrument=args.instrument)
    run_dir = DEFAULT_RUN_ROOT / args.instrument / args.run
    if args.resume:
        if not run_dir.is_dir():
            raise ValueError(f"cannot resume missing run directory: {run_dir}")
        saved_prior = _load(run_dir / "resolved-legacy-prior.json")
        if canonical_hash(saved_prior) != canonical_hash({"prior": prior, "params": initial}):
            raise ValueError(f"{run_dir}: resumed legacy prior does not match saved contract")
    else:
        run_dir.mkdir(parents=True, exist_ok=False)
        (run_dir / "resolved-legacy-prior.json").write_text(json.dumps({
            "prior": prior, "params": initial}, indent=2) + "\n")
        (run_dir / "run.json").write_text(json.dumps({
            **vars(args), "legacyPrior": prior, "renderModes": [FIT_MODE, SHIP_MODE],
        }, indent=2, default=str) + "\n")
    matcher = ToneMatcher(args.instrument, initial, references, free, run_dir,
                          repo_root=args.repo_root, weights=scoring_weights,
                          variability=variability,
                          criteria_noise_floor=repeat_noise_floor(controllability))
    x0 = np.asarray([p.default for p in free])
    bounds = [(p.lo, p.hi) for p in free]
    if args.resume:
        matcher.evaluations = _load(run_dir / "loss_curve.json")
        matcher.best = _load(run_dir / "best.json")
        for row in matcher.evaluations:
            fingerprint = _candidate_fingerprint(free, row["params"])
            matcher._objective_cache[fingerprint] = (row["objective"], row["loss"])
    else:
        matcher.evaluate(x0, retain_audio=True)
    baseline = matcher.evaluations[0]["loss"]
    baseline_best = dict(matcher.evaluations[0])
    baseline_floor = _floor_evidence(variability, baseline_best)
    if baseline_floor["status"] == "demonstrated":
        result = SimpleNamespace(success=True,
                                 message="baseline is at the reference-variability floor")
    else:
        remaining = max(0, args.budget - len(matcher.evaluations))
        if remaining:
            start = np.asarray([matcher.best["params"].get(p.key, p.default)
                                for p in free]) if args.resume else x0
            result = minimize(matcher.evaluate, start, method="Powell", bounds=bounds,
                              options={"maxfev": remaining, "ftol": .01, "xtol": .002})
        else:
            result = SimpleNamespace(success=True,
                                     message="resumed evaluation budget already complete")
    best = matcher.best or {"loss": baseline, "params": initial}
    sensitivity = {} if args.skip_sensitivity else _sensitivity(matcher, best)
    best = matcher.best or best
    (run_dir / "sensitivity.json").write_text(json.dumps(sensitivity, indent=2) + "\n")
    resource = _benchmark_resources(run_dir, args.instrument, best)
    reference_set = _reference_set_id(
        references, args.instrument, weights=scoring_weights,
        prior_hash=prior["resolvedParameterHash"], repo_root=args.repo_root)
    legacy_ship = _render_ship_variants(
        run_dir, "legacy-baseline", args.instrument, baseline_best["params"],
        references, variability, scoring_weights, args.ship_variants,
        repo_root=args.repo_root, ship_calibration=ship_calibration)
    legacy_entry = _ensure_legacy_baseline(
        args.instrument, run_dir, baseline_best, reference_set, prior,
        legacy_ship["gate"])
    candidate_ship = _render_ship_variants(
        run_dir, "candidate", args.instrument, best["params"], references,
        variability, scoring_weights, args.ship_variants,
        repo_root=args.repo_root, ship_calibration=ship_calibration)
    render_artifacts = _build_listening_page(
        run_dir, args.instrument, best, references, candidate_ship)
    candidate_improved, previous_best_loss = _update_leaderboard(
        args.instrument, run_dir, best, reference_set, persist=False,
        variation_gate=candidate_ship["gate"], prior=prior,
        require_ship_gate=True)
    floor = _floor_evidence(variability, best)
    if floor["status"] == "demonstrated" and not candidate_ship["gate"]["passed"]:
        floor = {**floor, "status": "above-floor",
                 "variationGateBlocked": True}
    relative_improvement = ((baseline - best["loss"]) / max(abs(baseline), 1e-12))
    measurable_loss_improvement = (
        candidate_improved and relative_improvement >= MEASURABLE_REL_IMPROVEMENT)
    if floor["status"] == "demonstrated":
        outcome = {"state": "reference-variability-floor"}
    elif measurable_loss_improvement:
        outcome = {"state": "improvement"}
    elif args.limiting_factor and args.work_item:
        item_path = _file_work_item(args.instrument, run_dir, args.limiting_factor, args.work_item)
        outcome = {"state": "limiting-factor", "limitingFactor": args.limiting_factor,
                   "workItem": args.work_item, "workItemFile": str(item_path)}
    elif not candidate_ship["gate"]["passed"]:
        factor = ("ship-mode variation is not inside the measured two-sided "
                  "take-pair spread")
        action = ("run/refresh the §2.5c differential fit and its humanRanges, "
                  "then re-audit the responsible engine consumers")
        item_path = _file_work_item(args.instrument, run_dir, factor, action)
        outcome = {"state": "limiting-factor", "limitingFactor": factor,
                   "workItem": action, "workItemFile": str(item_path)}
    else:
        outcome = {"state": "invalid-stop",
                   "reason": "no measurable raw composite improvement, floor demonstration, or filed limiting factor"}
    improved = False
    if outcome["state"] in {"improvement", "reference-variability-floor"}:
        improved, previous_best_loss = _update_leaderboard(
            args.instrument, run_dir, best, reference_set, persist=True,
            variation_gate=candidate_ship["gate"], prior=prior,
            require_ship_gate=True)
        if improved:
            _append_ledger(args.instrument, run_dir, best, sensitivity, free)
            _snapshot_best(args.instrument, run_dir, best)
    summary = {"instrument": args.instrument, "run": run_dir.name,
               "baselineLoss": baseline, "bestLoss": best["loss"], "improvement": baseline - best["loss"],
               "evaluations": len(matcher.evaluations), "optimizer": {"success": bool(result.success), "message": str(result.message)},
               "leaderboardImproved": improved, "previousBestLoss": previous_best_loss,
               "referenceSet": reference_set,
               "constructionPassed": bool(best.get("construction", {}).get("passed")),
               "tripwirePassed": bool(best.get("tripwires", {}).get("strictPassed")),
               "tripwires": best.get("tripwires", {}),
               "controllability": controllability,
               "construction": best.get("construction", {}),
               "resourceTripwire": resource,
               "referenceVariabilityFloor": floor, "dominantResidual": _dominant_residual(best),
               "sensitivity": sensitivity,
               "freeParameters": [spec.key for spec in free],
               "bestParams": best.get("params", {}),
               "legacyPrior": prior,
               "legacyBaseline": legacy_entry,
               "shipVariantCount": args.ship_variants,
               "distributionalVariationGate": candidate_ship["gate"],
               "legacyDistributionalVariationGate": legacy_ship["gate"],
               "criteriaDrift": matcher.criteria_drift_state,
               "exchangeStatuses": _technique_exchange_statuses(),
               "leaderboardState": {"isLeader": improved,
                                    "candidateWouldLead": candidate_improved,
                                    "previousBestLoss": previous_best_loss},
               "renderArtifacts": render_artifacts,
               "sessionOutcome": outcome}
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    _write_run_report(run_dir / "RUN_REPORT.md", summary)
    print(json.dumps({"runDir": str(run_dir), **summary}, indent=2))
    return 2 if outcome["state"] == "invalid-stop" else 0


if __name__ == "__main__":
    raise SystemExit(main())
