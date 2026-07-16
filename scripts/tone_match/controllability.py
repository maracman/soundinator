#!/usr/bin/env python3
"""Controllability audit (SOUND_GENERATOR_2_PLAN.md §2.3 rule, owner 2026-07-16).

A feature may carry non-zero weight for an instrument ONLY if at least one
free manifest parameter demonstrably moves it.  This tool perturbs each
free parameter around a baseline preset, renders through the real engine,
and records which scored features respond.  Weighted features with no
responsive parameter are ERRORS: they get zero-weighted into watch metrics
and their generating parameter is filed as an engine gap — "the agent is
being scored on something it cannot adjust" becomes impossible by
construction.

Outputs (per instrument, git-ignored under the campaign dir):
  controllability.json  — full response matrix + verdicts
  CONTROLLABILITY.md    — the per-pass audit table for run summaries
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

from .score import (
    DEFAULT_WEIGHTS,
    PERCEPTUAL_UNITS,
    compare_features,
    extract_features,
    weights_for_instrument,
)

# Response below this (perceptual units) counts as "does not move it".
RESPONSE_THRESHOLD = 0.05

# Free continuous parameters audited for the bowed campaign: the manifest's
# continuous tier plus vibrato dials (vibrato features need a vibrato
# render).  Categorical params (excitationType, bodyType) are enumerable by
# the optimiser and excluded from perturbation.
BOWED_FREE_PARAMS: dict[str, tuple[float, float, float]] = {
    # key: (baseline, perturbed, alt-baseline-if-baseline-is-zero)
    "excitationPosition": (0.09, 0.14, 0.0),
    "excitationHardness": (0.5, 0.7, 0.0),
    "excitationHuman": (0.2, 0.6, 0.0),
    "toneBreath": (0.03, 0.15, 0.0),
    "breathNoiseColor": (0.0, 0.6, 0.0),
    "attackNoiseLevel": (1.0, 0.4, 0.0),
    "attackNoiseFreq": (1000.0, 2400.0, 0.0),
    "attackNoiseQ": (0.84, 2.5, 0.0),
    "attackNoiseDecay": (0.05, 0.15, 0.0),
    "partialTilt": (0.0, 0.35, 0.0),
    "partialTransfer": (0.1, 0.4, 0.0),
    "partialMaterial": (0.3, 0.6, 0.0),
    "spectralResonanceAmount": (1.0, 0.5, 0.0),
    "spectralDynamicAmount": (1.0, 1.8, 0.0),
    "dynamicBlare": (0.0, 0.4, 0.0),
    "envelopeAttack": (0.08, 0.25, 0.0),
    "vibratoProb": (1.0, 0.0, 0.0),
    "vibratoDepth": (18.0, 40.0, 0.0),
    "vibratoRate": (5.5, 6.5, 0.0),
}


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def objective_contract_hash(instrument: str, references: list[dict[str, Any]],
                            weights: dict[str, float]) -> str:
    """Hash the exact scored reference objective consumed by the fitter."""
    return _canonical_hash({
        "instrument": instrument,
        "references": references,
        "weights": weights,
    })


def manifest_contract_hash(contract: list[dict[str, Any]]) -> str:
    """Hash the exact free-parameter contract perturbed by the audit."""
    return _canonical_hash(sorted(contract, key=lambda row: row["key"]))


def _manifest_contract(manifest: dict[str, Any], baseline: dict[str, Any],
                       keys: list[str]) -> list[dict[str, Any]]:
    rows = {row["key"]: row for row in manifest.get("continuous", [])}
    missing = [key for key in keys if key not in rows]
    if missing:
        raise ValueError(f"controllability keys missing from manifest: {missing}")
    contract = []
    for key in keys:
        row = rows[key]
        contract.append({
            "key": key,
            "min": float(row["min"]),
            "max": float(row["max"]),
            "default": float(baseline.get(key, row["default"])),
        })
    return contract


def _render_batch(jobs: list[dict[str, Any]], repo_root: Path) -> None:
    jobs_path = Path(jobs[0]["out"]).parent / "audit-jobs.json"
    jobs_path.write_text(json.dumps(jobs))
    process = subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=repo_root, capture_output=True, text=True, timeout=1800)
    if process.returncode != 0:
        raise RuntimeError(f"render batch failed: {process.stderr[-2000:]}")


def run_audit(instrument: str, baseline_params: dict[str, Any],
              references: list[dict[str, Any]], output_dir: Path,
              repo_root: Path,
              free_params: dict[str, tuple[float, float, float]] | None = None,
              objective_references: list[dict[str, Any]] | None = None,
              manifest_contract: list[dict[str, Any]] | None = None,
              ) -> dict[str, Any]:
    free_params = free_params or BOWED_FREE_PARAMS
    output_dir.mkdir(parents=True, exist_ok=True)
    renders = output_dir / "renders"
    renders.mkdir(exist_ok=True)

    # variant parameter sets: base + one per perturbed param
    variants: dict[str, dict[str, Any]] = {"__base__": dict(baseline_params)}
    for key, (base_value, perturbed, _alt) in free_params.items():
        params = dict(baseline_params)
        params[key] = base_value
        variants["__base__"].setdefault(key, base_value)
        perturbed_params = dict(variants["__base__"])
        perturbed_params[key] = perturbed
        variants[key] = perturbed_params

    jobs = []
    for name, params in variants.items():
        params_path = output_dir / f"params-{name}.json"
        params_path.write_text(json.dumps(params, indent=1))
        for ref_index, ref in enumerate(references):
            jobs.append({
                "paramsFile": str(params_path),
                "midi": ref.get("midi", 60),
                "velocity": ref.get("velocity", .62),
                "durationSec": ref.get("durationSec", 1.5),
                "sampleRate": ref.get("sampleRate", 48000),
                "out": str(renders / f"{name}-{ref_index}.wav"),
            })
    _render_batch(jobs, repo_root)

    ref_bundles = [extract_features(ref["path"]) for ref in references]
    weights = weights_for_instrument(instrument)

    def distances(name: str) -> dict[str, list[float]]:
        table: dict[str, list[float]] = {}
        for ref_index, ref_bundle in enumerate(ref_bundles):
            try:
                render_bundle = extract_features(
                    renders / f"{name}-{ref_index}.wav",
                    active_duration_s=references[ref_index].get("durationSec", 1.5))
            except ValueError:
                # a perturbation that kills the note entirely is itself a
                # (maximal) response; record NaN and let the matrix step
                # treat it as an extreme change rather than crash the audit
                for key in DEFAULT_WEIGHTS:
                    table.setdefault(key, []).append(float("nan"))
                continue
            result = compare_features(ref_bundle, render_bundle, weights)
            for key, value in result["normalized"].items():
                table.setdefault(key, []).append(float(value))
        return table

    base = distances("__base__")
    # references whose BASE render cannot be analysed are excluded from the
    # matrix (a response cannot be measured against a failed baseline) and
    # reported — a fragile baseline reference is its own finding.
    any_feature = next(iter(base))
    base_ok = ~np.isnan(np.asarray(base[any_feature], dtype=float))
    excluded_refs = [references[i].get("path") for i in range(len(references))
                     if not base_ok[i]]
    matrix: dict[str, dict[str, float]] = {}
    render_failures: dict[str, int] = {}
    for key in free_params:
        perturbed = distances(key)
        matrix[key] = {}
        for feature in base:
            base_vals = np.asarray(base[feature], dtype=float)[base_ok]
            pert_vals = np.asarray(perturbed[feature], dtype=float)[base_ok]
            deltas = pert_vals - base_vals
            finite = deltas[np.isfinite(deltas)]
            # analysis failures are recorded separately, NOT as responses:
            # knife-edge references fail under unrelated perturbations (the
            # seeded noise realisation shifts), and folding that into the
            # response matrix marked every feature "controllable".
            matrix[key][feature] = float(np.max(np.abs(finite))) if finite.size else 0.0
        any_pert = np.asarray(perturbed[next(iter(base))], dtype=float)[base_ok]
        render_failures[key] = int(np.isnan(any_pert).sum())

    verdicts = []
    for feature, weight in sorted(DEFAULT_WEIGHTS.items()):
        active_weight = weights.get(feature, weight)
        responses = {key: matrix[key].get(feature, 0.0) for key in matrix}
        best_param = max(responses, key=responses.get) if responses else None
        best = responses.get(best_param, 0.0) if best_param else 0.0
        controllable = best >= RESPONSE_THRESHOLD
        status = ("watch-metric" if active_weight == 0 else
                  "controllable" if controllable else "UNCONTROLLABLE")
        verdicts.append({
            "feature": feature, "weight": active_weight,
            "bestParam": best_param, "maxResponse": round(best, 4),
            "unit": PERCEPTUAL_UNITS.get(feature),
            "status": status,
        })

    responsive = {
        feature: sorted(key for key in matrix
                        if matrix[key].get(feature, 0.0) >= RESPONSE_THRESHOLD)
        for feature in DEFAULT_WEIGHTS
    }
    watch_metrics = [v["feature"] for v in verdicts if v["status"] == "watch-metric"]
    uncontrolled = [v["feature"] for v in verdicts if v["status"] == "UNCONTROLLABLE"]
    objective_references = objective_references or references
    manifest_contract = manifest_contract or [
        {"key": key, "baseline": values[0], "perturbed": values[1]}
        for key, values in sorted(free_params.items())
    ]
    audit = {"schemaVersion": 1, "instrument": instrument,
             "status": "clean" if not uncontrolled else "not-clean",
             "threshold": RESPONSE_THRESHOLD,
             "objectiveHash": objective_contract_hash(
                 instrument, objective_references, weights),
             "manifestHash": manifest_contract_hash(manifest_contract),
             "manifest": manifest_contract,
             "finalWeights": weights,
             "references": [ref.get("path") for ref in references],
             "excludedReferences": excluded_refs,
             "analysisFailuresPerParam": render_failures,
             "matrix": matrix, "verdicts": verdicts,
             "responsiveParameters": responsive,
             "watchMetrics": watch_metrics,
             "uncontrolledWeightedFeatures": uncontrolled,
             "clean": not uncontrolled}
    (output_dir / "controllability.json").write_text(
        json.dumps(audit, indent=1) + "\n")
    lines = [f"# Controllability audit — {instrument}",
             "", f"Threshold: {RESPONSE_THRESHOLD} perceptual units. "
             f"Verdict: {'CLEAN' if audit['clean'] else 'NOT CLEAN'}",
             "" if not excluded_refs else
             f"\nBase render failed for {len(excluded_refs)} reference(s) "
             f"(excluded, see controllability.json): {excluded_refs}",
             "", "| Feature | Weight | Best param | Max response | Status |",
             "|---|---|---|---|---|"]
    for verdict in verdicts:
        lines.append(f"| {verdict['feature']} | {verdict['weight']} | "
                     f"{verdict['bestParam']} | {verdict['maxResponse']} | "
                     f"{verdict['status']} |")
    (output_dir / "CONTROLLABILITY.md").write_text("\n".join(lines) + "\n")
    return audit


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--initial", type=Path, required=True,
                        help="baseline preset JSON")
    parser.add_argument("--references", type=Path, required=True,
                        help="references.json (subset used: first per register)")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--manifest", type=Path,
                        default=Path(__file__).with_name("manifest.json"))
    parser.add_argument("--keys",
                        help="comma-separated free keys; defaults to the bowed audit set")
    args = parser.parse_args(argv)
    references = json.loads(args.references.read_text())
    baseline = json.loads(args.initial.read_text())
    keys = (list(dict.fromkeys(key.strip() for key in args.keys.split(",")
                              if key.strip()))
            if args.keys else list(BOWED_FREE_PARAMS))
    unknown = [key for key in keys if key not in BOWED_FREE_PARAMS]
    if unknown:
        parser.error(f"no perturbation specification for: {', '.join(unknown)}")
    free_params = {key: BOWED_FREE_PARAMS[key] for key in keys}
    contract = _manifest_contract(json.loads(args.manifest.read_text()), baseline, keys)
    seen: dict[str, dict[str, Any]] = {}
    for row in references:
        seen.setdefault(f"{row.get('register')}|{row.get('dynamic')}", row)
    subset = list(seen.values())[:6]
    audit = run_audit(args.instrument, baseline, subset, args.output,
                      args.repo_root, free_params=free_params,
                      objective_references=references,
                      manifest_contract=contract)
    print(json.dumps({"clean": audit["clean"],
                      "uncontrollable": [v["feature"] for v in audit["verdicts"]
                                         if v["status"] == "UNCONTROLLABLE"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
