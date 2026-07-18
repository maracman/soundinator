#!/usr/bin/env python3
"""Fit matched Human takes individually and route their identity residuals.

The §2.5c decomposition gate needs a stronger fact than an aggregate campaign
score: every matched take must be individually representable through the
ordinary deterministic identity path.  This module starts from the exact
incumbent used by :mod:`human_identity_audit`, probes only existing identity
controls, then tries bounded local source and attack-surface fits.  It reports
the first unresolved physical tier and never promotes the per-take parameters
to an instrument preset.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import numpy as np

from .bowed_source_refine import apply_bounded_partial_correction
from .criteria_drift import directed_drift
from .human_identity_audit import (
    _matched_rows,
    _rows_from_human_ranges,
)
from .iterate import _load_preset, _mode_params, _renderer_contract_hash
from .score import compare_features, extract_features, weights_for_instrument


CORE_TIERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("pitch-membership", ("inharmonicity_log_ratio",)),
    ("partial-identity", ("partials_db",)),
    ("continuous-spectrum", ("log_mel_db", "band_balance_db")),
    ("temporal-identity", ("attack_ms",)),
)
CORE_FEATURES = tuple(
    feature for _, features in CORE_TIERS for feature in features)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def residual_quality(normalized: dict[str, Any]) -> dict[str, Any]:
    """Return the upstream-first core-bar verdict for one scored take."""
    tier_rows = []
    first_failure = None
    for tier_index, (tier, features) in enumerate(CORE_TIERS):
        measured = {
            feature: float(normalized[feature])
            for feature in features
            if isinstance(normalized.get(feature), (int, float))
            and np.isfinite(normalized[feature])
        }
        maximum = max(measured.values(), default=0.0)
        failed = sorted(feature for feature, value in measured.items()
                        if value > 1.0)
        if failed and first_failure is None:
            first_failure = tier
        tier_rows.append({
            "tier": tier, "tierIndex": tier_index,
            "maximumPerceptualUnits": maximum,
            "failedFeatures": failed,
        })
    return {
        "good": first_failure is None,
        "firstFailingTier": first_failure,
        "tiers": tier_rows,
    }


def _selection_key(result: dict[str, Any]) -> tuple[float, ...]:
    """Prefer clearing upstream bars before reducing within-bar distance."""
    normalized = result["normalizedCoreFeatures"]
    excess = []
    raw = []
    for _, features in CORE_TIERS:
        values = [float(normalized.get(feature) or 0.0) for feature in features]
        excess.append(max((max(0.0, value - 1.0) for value in values), default=0.0))
        raw.append(max(values, default=0.0))
    return (*excess, *raw, float(result.get("composite", math.inf)))


def _parameter_delta(base: dict[str, Any], candidate: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "stringSelect", "excitationPosition", "partialTilt", "partialTransfer",
        "spectralResonanceAmount", "dynamicBlare", "partialMaterial",
        "envelopeAttack", "attackNoiseLevel",
    )
    return {key: candidate.get(key) for key in keys
            if candidate.get(key) != base.get(key)}


_OPEN_STRING_MIDI = {
    "violin": {"sulG": 55, "sulD": 62, "sulA": 69, "sulE": 76},
    "cello": {"sulC": 36, "sulG": 43, "sulD": 50, "sulA": 57},
}


def _identity_probes(params: dict[str, Any], instrument: str,
                     midi: int) -> list[tuple[str, str, dict[str, Any]]]:
    """Enumerate only physically playable categorical identities."""
    probes: list[tuple[str, str, dict[str, Any]]] = []
    layout = _OPEN_STRING_MIDI.get(instrument, {})
    playable = {
        string for string, open_midi in layout.items()
        if open_midi <= midi <= open_midi + 24
    }
    for string in sorted(set(params.get("partialsByString", {})) & playable):
        candidate = copy.deepcopy(params)
        candidate["stringSelect"] = string
        probes.append(("string-choice", f"stringSelect={string}", candidate))
    return probes


def _apply_source_residual(params: dict[str, Any], residual_db: np.ndarray,
                           fraction: float, cap_db: float) -> dict[str, Any] | None:
    candidate = copy.deepcopy(params)
    surface = candidate.get("spectralPartialsByRegisterDynamic") or {}
    rows = surface.get("rows") or []
    if not rows:
        return None
    for row in rows:
        row["partials"], evidence = apply_bounded_partial_correction(
            row["partials"], residual_db,
            correction_fraction=fraction, max_correction_db=cap_db)
        row["perTakeDiagnosticCorrection"] = evidence
    surface["diagnosticOnly"] = True
    return candidate


def _apply_attack_scale(params: dict[str, Any], scale: float) -> dict[str, Any]:
    candidate = copy.deepcopy(params)
    candidate["envelopeAttack"] = float(np.clip(
        float(candidate.get("envelopeAttack", .1)) * scale, .005, 1.5))
    rows = candidate.get("envelopeAttackByRegisterDynamic") or []
    for row in rows:
        if isinstance(row.get("attack"), (int, float)):
            row["attack"] = float(np.clip(float(row["attack"]) * scale, .005, 1.5))
    return candidate


def _attack_scale(reference: Any, rendered: Any) -> float:
    def values(bundle: Any) -> np.ndarray:
        rows = []
        for value in (bundle.note.band_t90 or {}).values():
            measured = value.get("t90") if isinstance(value, dict) else value
            if isinstance(measured, (int, float)):
                rows.append(float(measured))
        return np.asarray(rows, dtype=float)

    ref = values(reference)
    out = values(rendered)
    ref = ref[np.isfinite(ref) & (ref > 0)]
    out = out[np.isfinite(out) & (out > 0)]
    if not ref.size or not out.size:
        return 1.0
    return float(np.clip(np.median(ref) / np.median(out), .25, 4.0))


def _score(reference_bundle: Any, render_path: Path, instrument: str,
           reference: dict[str, Any]) -> tuple[dict[str, Any], Any]:
    rendered = extract_features(
        render_path, active_duration_s=reference.get("durationSec"),
        expected_f0_hz=440.0 * 2 ** ((float(reference["midi"]) - 69) / 12),
        trust_expected_f0=True)
    score = compare_features(
        reference_bundle, rendered, weights_for_instrument(instrument))
    core = {key: score["normalized"].get(key) for key in CORE_FEATURES}
    return {
        "composite": score["composite"],
        "normalizedCoreFeatures": core,
        "quality": residual_quality(core),
        "renderSha256": _sha(render_path),
    }, rendered


def _render_candidates(
    candidates: list[dict[str, Any]], output: Path, repo_root: Path,
) -> None:
    jobs = []
    changed_outputs: set[Path] = set()
    for index, row in enumerate(candidates):
        target = output / "renders" / f"{index:04d}.wav"
        params_path = output / "params" / f"{index:04d}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        params_path.parent.mkdir(parents=True, exist_ok=True)
        encoded = json.dumps(row["params"], indent=2) + "\n"
        if not params_path.exists() or params_path.read_text() != encoded:
            changed_outputs.add(target)
        params_path.write_text(encoded)
        reference = row["reference"]
        jobs.append({
            "paramsFile": str(params_path), "midi": reference["midi"],
            "velocity": reference["velocity"],
            "durationSec": reference["durationSec"], "sampleRate": 44100,
            "out": str(target),
        })
        row["renderPath"] = target
        row["paramsPath"] = params_path
    jobs_path = output / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    pending = [job for job in jobs
               if Path(job["out"]) in changed_outputs or
               not Path(job["out"]).exists() or Path(job["out"]).stat().st_size <= 44]
    # Dense bowed notes allocate 64 oscillator graphs.  Recycling Chromium
    # every twenty jobs prevents a long diagnostic batch from accumulating
    # hundreds of completed OfflineAudioContexts, and makes crash recovery
    # additive rather than destructive.
    for offset in range(0, len(pending), 20):
        chunk = pending[offset:offset + 20]
        chunk_path = output / f"jobs-pending-{offset // 20:03d}.json"
        chunk_path.write_text(json.dumps(chunk, indent=2) + "\n")
        process = subprocess.run(
            ["node", "scripts/render_note.mjs", "--batch", str(chunk_path)],
            cwd=repo_root, text=True, capture_output=True,
            env={**os.environ, "PYTHON": sys.executable})
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)


def tier_drift_matrix(transitions: list[dict[str, Any]],
                      noise_floor: dict[str, float]) -> dict[str, Any]:
    """Aggregate only within-take candidate transitions into tier thefts."""
    feature_counts: dict[tuple[str, str], int] = {}
    tier_counts: dict[tuple[str, str], int] = {}
    feature_tier = {feature: tier for tier, features in CORE_TIERS
                    for feature in features}
    admitted = []
    for transition in transitions:
        drift = directed_drift(
            transition["previous"], transition["current"], noise_floor)
        if not drift:
            continue
        admitted.append({**transition, "drift": drift})
        for improved in drift["improved"]:
            for degraded in drift["degraded"]:
                feature_counts[(improved, degraded)] = \
                    feature_counts.get((improved, degraded), 0) + 1
                left = feature_tier.get(improved, improved)
                right = feature_tier.get(degraded, degraded)
                if left != right:
                    tier_counts[(left, right)] = tier_counts.get((left, right), 0) + 1
    tier_rows = [{
        "improvedTier": left, "degradedTier": right, "events": count,
        "finding": f"{left} improvement steals from {right}",
    } for (left, right), count in sorted(
        tier_counts.items(), key=lambda item: (-item[1], item[0]))]
    return {
        "transitionsConsidered": len(transitions),
        "directedTransitions": len(admitted),
        "featureMatrix": [{"improved": left, "degraded": right, "events": count}
                          for (left, right), count in sorted(
                              feature_counts.items(), key=lambda item: (-item[1], item[0]))],
        "tierThefts": tier_rows,
        "dominantTierTheft": tier_rows[0] if tier_rows else None,
        "transitions": admitted,
    }


def _load_noise_floor(path: Path | None) -> dict[str, float]:
    if path is None:
        return {feature: .05 for feature in CORE_FEATURES}
    audit = json.loads(path.read_text())
    peaks = (audit.get("repeatability") or {}).get("maxPeakPerceptualUnits") or {}
    return {feature: max(.001, float(peaks.get(feature, .05)))
            for feature in CORE_FEATURES}


def fit(
    instrument: str, params_path: Path, output: Path, repo_root: Path,
    *, references_path: Path | None = None,
    human_ranges_path: Path | None = None,
    prepared_dir: Path | None = None,
    controllability_path: Path | None = None,
) -> dict[str, Any]:
    if human_ranges_path is not None:
        if prepared_dir is None:
            raise ValueError("--human-ranges requires --prepared-dir")
        references = _rows_from_human_ranges(human_ranges_path, prepared_dir)
    elif references_path is not None:
        references = _matched_rows(json.loads(references_path.read_text()))
    else:
        raise ValueError("one matched-take source is required")
    if not references:
        raise ValueError(f"{instrument}: no matched takes")

    incumbent = _mode_params(_load_preset(params_path), "fit")
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["node", "scripts/verify_tone_model.mjs"], cwd=repo_root, check=True,
        stdout=subprocess.DEVNULL, env={**os.environ, "PYTHON": sys.executable})

    expected = [440.0 * 2 ** ((float(row["midi"]) - 69) / 12)
                for row in references]
    reference_bundles = [extract_features(
        row["path"], active_duration_s=row.get("durationSec"),
        expected_f0_hz=f0, trust_expected_f0=True)
        for row, f0 in zip(references, expected)]

    stage1 = []
    for take_index, reference in enumerate(references):
        stage1.append({"takeIndex": take_index, "stage": "incumbent",
                       "label": "incumbent", "params": copy.deepcopy(incumbent),
                       "reference": reference})
        for stage, label, candidate in _identity_probes(
                incumbent, instrument, int(reference["midi"])):
            stage1.append({"takeIndex": take_index, "stage": stage,
                           "label": label, "params": candidate,
                           "reference": reference})
    _render_candidates(stage1, output / "stage-1", repo_root)
    rendered_bundles: dict[int, Any] = {}
    by_take: dict[int, list[dict[str, Any]]] = {index: [] for index in range(len(references))}
    for row in stage1:
        scored, rendered = _score(reference_bundles[row["takeIndex"]],
                                  row["renderPath"], instrument, row["reference"])
        row.update(scored)
        row["paramsSha256"] = _sha(row["paramsPath"])
        by_take[row["takeIndex"]].append(row)
        if row["stage"] == "incumbent":
            rendered_bundles[row["takeIndex"]] = rendered

    stage2 = []
    for take_index, reference in enumerate(references):
        ranked = sorted(by_take[take_index], key=_selection_key)
        base_row = ranked[0]
        base_params = base_row["params"]
        ref_bundle = reference_bundles[take_index]
        rendered = extract_features(
            base_row["renderPath"], active_duration_s=reference.get("durationSec"),
            expected_f0_hz=expected[take_index], trust_expected_f0=True)
        residual = np.asarray(ref_bundle.partial_db) - np.asarray(rendered.partial_db)
        finite = np.isfinite(residual)
        if np.any(finite):
            residual[finite] -= float(np.median(residual[finite]))
        source_candidates = []
        candidate = _apply_source_residual(base_params, residual, 1.0, 36.0)
        if candidate is not None:
            source_candidates.append(("source-f1-cap36", candidate))
        scale = _attack_scale(ref_bundle, rendered)
        for label, candidate in source_candidates:
            stage2.append({"takeIndex": take_index, "stage": "source-local",
                           "label": label, "params": candidate,
                           "reference": reference, "parent": base_row["label"]})
            for attack_scale in (scale,):
                combined = _apply_attack_scale(candidate, attack_scale)
                stage2.append({"takeIndex": take_index, "stage": "source+attack-local",
                               "label": f"{label}+attack-x{attack_scale:.4g}",
                               "params": combined, "reference": reference,
                               "parent": base_row["label"]})
        candidate = _apply_attack_scale(base_params, scale)
        stage2.append({"takeIndex": take_index, "stage": "attack-local",
                       "label": f"attack-x{scale:.4g}",
                       "params": candidate, "reference": reference,
                       "parent": base_row["label"]})
    _render_candidates(stage2, output / "stage-2", repo_root)
    for row in stage2:
        scored, _ = _score(reference_bundles[row["takeIndex"]],
                           row["renderPath"], instrument, row["reference"])
        row.update(scored)
        row["paramsSha256"] = _sha(row["paramsPath"])
        by_take[row["takeIndex"]].append(row)

    rows = []
    transitions = []
    for take_index, reference in enumerate(references):
        candidates = by_take[take_index]
        incumbent_row = next(row for row in candidates if row["stage"] == "incumbent")
        best = min(candidates, key=_selection_key)
        if best is not incumbent_row:
            transitions.append({
                "takeIndex": take_index, "sourceFile": reference.get("sourceFile"),
                "from": incumbent_row["label"], "to": best["label"],
                "previous": incumbent_row["normalizedCoreFeatures"],
                "current": best["normalizedCoreFeatures"],
            })
        improvement = {
            feature: float(incumbent_row["normalizedCoreFeatures"].get(feature) or 0.0)
            - float(best["normalizedCoreFeatures"].get(feature) or 0.0)
            for feature in CORE_FEATURES
        }
        rows.append({
            "takeIndex": take_index, "sourceFile": reference.get("sourceFile"),
            "path": reference["path"],
            "group": reference.get("humanisationGroup") or reference.get("floorGroup"),
            "sourceEvidence": {
                "codec": Path(str(reference.get("sourceFile", ""))).suffix.lower(),
                "string": str(reference.get("string") or (
                    str(reference.get("humanisationGroup") or
                        reference.get("floorGroup") or "").split("|")[3]
                    if len(str(reference.get("humanisationGroup") or
                               reference.get("floorGroup") or "").split("|")) > 3
                    else "unlabelled")),
            },
            "incumbent": {key: incumbent_row[key] for key in (
                "composite", "normalizedCoreFeatures", "quality", "renderSha256")},
            "best": {
                "stage": best["stage"], "label": best["label"],
                "composite": best["composite"],
                "normalizedCoreFeatures": best["normalizedCoreFeatures"],
                "quality": best["quality"], "renderSha256": best["renderSha256"],
                "paramsSha256": best["paramsSha256"],
                "paramsPath": str(best["paramsPath"]),
                "parameterDelta": _parameter_delta(incumbent, best["params"]),
                "stringSelect": best["params"].get("stringSelect", "auto"),
            },
            "improvementPerceptualUnits": improvement,
        })

    # Corpus ambiguity is a group-level fact: same-note matched takes should
    # not require contradictory unlabelled string identities or alternate
    # between a severe and absent pitch-stretch estimate.
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(str(row["group"]), []).append(row)
    group_findings = []
    layout = _OPEN_STRING_MIDI.get(instrument, {})

    def effective_string(row: dict[str, Any]) -> str:
        selected = str(row["best"]["stringSelect"])
        if selected != "auto":
            return selected
        midi = int(references[row["takeIndex"]]["midi"])
        playable = [(open_midi, string) for string, open_midi in layout.items()
                    if open_midi <= midi <= open_midi + 24]
        return min(playable)[1] if playable else "pooled"

    for group, members in sorted(groups.items()):
        selections = {effective_string(row) for row in members}
        declared = {row["sourceEvidence"]["string"] for row in members}
        planned = {
            value.removeprefix("planned-").removesuffix("-unverified")
            for value in declared if value.startswith("planned-")
        }
        pitch_fail = [row["incumbent"]["normalizedCoreFeatures"].get(
            "inharmonicity_log_ratio", 0) > 1 for row in members]
        planned_mismatch = bool(planned) and selections != planned
        ambiguity = (len(selections) > 1 or planned_mismatch or
                     (any(pitch_fail) and not all(pitch_fail)))
        finding = {
            "group": group, "takes": len(members),
            "bestStringSelections": sorted(selections),
            "declaredPlannedStrings": sorted(planned),
            "plannedStringMismatch": planned_mismatch,
            "mixedPitchEstimatorVerdict": any(pitch_fail) and not all(pitch_fail),
            "corpusIdentityAmbiguous": ambiguity,
        }
        group_findings.append(finding)
        for row in members:
            if row["best"]["quality"]["good"]:
                route = "fit"
                reason = "existing bounded identity controls reconcile this take"
            elif ambiguity and ("unlabelled" in row["sourceEvidence"]["string"] or
                                "unverified" in row["sourceEvidence"]["string"]):
                route = "corpus"
                reason = "matched group needs contradictory unlabelled string/pitch identity"
            else:
                route = "law"
                reason = ("bounded controls plus local source/attack fits leave the "
                          f"{row['best']['quality']['firstFailingTier']} tier above bar")
            row["route"] = route
            row["routeReason"] = reason

    noise_floor = _load_noise_floor(controllability_path)
    drift = tier_drift_matrix(transitions, noise_floor)
    route_counts = {route: sum(row["route"] == route for row in rows)
                    for route in ("fit", "law", "corpus")}
    payload = {
        "schema": "sg2-per-take-identity-fit-v1",
        "instrument": instrument,
        "method": "incumbent+bounds+local-source+attack-individual-fit",
        "diagnosticOnly": True,
        "rendererContractHash": _renderer_contract_hash(repo_root),
        "incumbentParamsSha256": _sha(params_path),
        "referencesSha256": _sha(references_path) if references_path else None,
        "humanRangesSha256": _sha(human_ranges_path) if human_ranges_path else None,
        "controllabilitySha256": (_sha(controllability_path)
                                  if controllability_path else None),
        "noiseFloorPerceptualUnits": noise_floor,
        "takes": len(rows),
        "incumbentGoodTakes": sum(row["incumbent"]["quality"]["good"] for row in rows),
        "individuallyGoodTakes": sum(row["best"]["quality"]["good"] for row in rows),
        "allMatchedTakesIndividuallyGood": all(
            row["best"]["quality"]["good"] for row in rows),
        "routeCounts": route_counts,
        "groupFindings": group_findings,
        "tierDriftMatrix": drift,
        "rows": rows,
    }
    payload["evidenceSha256"] = _canonical_hash(payload)
    (output / "PER_TAKE_IDENTITY_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--references", type=Path)
    parser.add_argument("--human-ranges", type=Path)
    parser.add_argument("--prepared-dir", type=Path)
    parser.add_argument("--controllability", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    payload = fit(
        args.instrument, args.params, args.out, args.repo_root,
        references_path=args.references, human_ranges_path=args.human_ranges,
        prepared_dir=args.prepared_dir,
        controllability_path=args.controllability)
    print(json.dumps({key: payload[key] for key in (
        "instrument", "takes", "incumbentGoodTakes", "individuallyGoodTakes",
        "allMatchedTakesIndividuallyGood", "routeCounts", "evidenceSha256")}, indent=2))
    return 0 if payload["allMatchedTakesIndividuallyGood"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
