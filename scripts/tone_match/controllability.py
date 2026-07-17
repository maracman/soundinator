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
import math
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
STRUCK_INSTRUMENTS = {
    "piano", "piano-grand", "grand-piano", "piano-upright",
    "upright-piano", "guitar", "guitar-nylon", "guitar-steel",
    "harp", "glockenspiel", "marimba", "xylophone", "vibraphone",
}

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
    # L17 pinned wind component: audit two active levels. Zero remains an
    # engine identity endpoint, but is forbidden by the SHIP activation gate.
    "windBreathLevel": (1.0, 0.25, 0.0),
    "breathNoiseColor": (0.0, 0.6, 0.0),
    "breathLevelScale": (1.0, 2.2, 0.0),
    "breathVelocityExponent": (1.0, 0.25, 0.0),
    "breathTurbulence": (0.0, 0.6, 0.0),
    "breathBodyAmount": (0.0, 0.8, 0.0),
    "attackNoiseLevel": (1.0, 0.4, 0.0),
    "attackNoiseFreq": (1000.0, 2400.0, 0.0),
    "attackNoiseQ": (0.84, 2.5, 0.0),
    "attackNoiseDecay": (0.05, 0.15, 0.0),
    "attackNoiseDirect": (0.0, 0.8, 0.0),
    "attackNoiseVelocityExponent": (1.0, 0.25, 0.0),
    "partialTilt": (0.0, 0.35, 0.0),
    "partialTransfer": (0.1, 0.4, 0.0),
    "partialMaterial": (0.3, 0.6, 0.0),
    "spectralResonanceAmount": (1.0, 0.5, 0.0),
    "spectralDynamicAmount": (1.0, 1.8, 0.0),
    "dynamicBlare": (0.0, 0.4, 0.0),
    "onsetSpectrumTilt": (0.0, 0.35, 0.0),
    "onsetSpectrumDecay": (0.06, 0.14, 0.0),
    "articulationCoupling": (0.0, 0.8, 0.0),
    "articulationStrength": (0.5, 0.85, 0.0),
    "articulationVelocitySlope": (0.0, 0.8, 0.0),
    "articulationVariation": (0.0, 0.7, 0.0),
    "envelopeAttack": (0.08, 0.25, 0.0),
    "velocityHardnessCoupling": (0.2, 0.8, 0.0),
    "decaySecondStage": (0.2, 0.8, 0.0),
    "decaySecondRatio": (2.0, 6.0, 0.0),
    "vibratoProb": (1.0, 0.0, 0.0),
    "vibratoDepth": (18.0, 40.0, 0.0),
    "vibratoRate": (5.5, 6.5, 0.0),
    "onsetWanderCents": (0.0, 80.0, 0.0),
    "onsetWanderSettlePeriods": (12.0, 24.0, 0.0),
    "bowScratchLevel": (0.0, 1.0, 0.0),
    "bowNoiseLevel": (0.0, 1.0, 0.0),
    "releaseDamping": (0.0, 1.0, 0.0),
}

SUNG_FREE_PARAMS: dict[str, tuple[float, float, float]] = {
    # Structured per-vowel bodies remain a follow-up audit. These continuous
    # controls cover the pooled vocal source and performance layer.
    "glottalTilt": (0.0, 0.5, 0.0),
    "singerFormantAmount": (0.0, 0.7, 0.0),
    "voiceBreathSync": (0.0, 0.6, 0.0),
    "toneBreath": (0.03, 0.18, 0.0),
    "excitationHuman": (0.0, 0.6, 0.0),
    "attackNoiseLevel": (0.14, 0.55, 0.0),
    "partialTilt": (0.0, 0.35, 0.0),
    "partialTransfer": (0.2, 0.5, 0.0),
    "spectralResonanceAmount": (1.0, 0.5, 0.0),
    "spectralDynamicAmount": (0.8, 1.25, 0.0),
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
    pending = []
    for job in jobs:
        output = Path(job["out"])
        try:
            with output.open("rb") as handle:
                valid_wav = output.stat().st_size > 44 and handle.read(4) == b"RIFF"
        except FileNotFoundError:
            valid_wav = False
        if not valid_wav:
            pending.append(job)
    if not pending:
        return
    pending_path = jobs_path.with_name("audit-jobs-pending.json")
    pending_path.write_text(json.dumps(pending))
    # Chromium's OfflineAudioContext retains graph memory within a page even
    # after the encoded PCM has been released by render_note.mjs. Bound each
    # browser lifetime and make every chunk independently resumable.
    for offset in range(0, len(pending), 64):
        chunk_path = jobs_path.with_name(
            f"audit-jobs-pending-{offset // 64:03d}.json")
        chunk_path.write_text(json.dumps(pending[offset:offset + 64]))
        process = subprocess.run(
            ["node", "scripts/render_note.mjs", "--batch", str(chunk_path)],
            cwd=repo_root, capture_output=True, text=True, timeout=1800)
        if process.returncode != 0:
            raise RuntimeError(f"render batch failed: {process.stderr[-2000:]}")


def run_audit(instrument: str, baseline_params: dict[str, Any],
              references: list[dict[str, Any]], output_dir: Path,
              repo_root: Path,
              free_params: dict[str, tuple[float, float, float]] | None = None,
              objective_references: list[dict[str, Any]] | None = None,
              manifest_contract: list[dict[str, Any]] | None = None,
              manifest_document: dict[str, Any] | None = None,
              weight_overrides: dict[str, float] | None = None,
              activation_evidence: dict[str, Any] | None = None,
              ) -> dict[str, Any]:
    free_params = free_params or BOWED_FREE_PARAMS
    output_dir.mkdir(parents=True, exist_ok=True)
    renders = output_dir / "renders"
    renders.mkdir(exist_ok=True)

    # Every probe gets a matched baseline. Conditional laws (for example G4
    # second-stage decay) use the manifest auditContext on both sides without
    # contaminating the neutral campaign seed.
    variants: dict[str, dict[str, Any]] = {"__base__": dict(baseline_params)}
    rows = {row["key"]: row for row in (manifest_document or {}).get(
        "continuous", [])}
    for key, (base_value, perturbed, _alt) in free_params.items():
        probe_base = dict(baseline_params)
        probe_base.update(rows.get(key, {}).get("auditContext", {}))
        probe_base[key] = base_value
        variants[f"__base__-{key}"] = probe_base
        perturbed_params = dict(probe_base)
        perturbed_params[key] = perturbed
        variants[key] = perturbed_params
    # T-041: repeat the exact baseline in independent offline render
    # contexts. One inaudible PCM step can destabilise thresholded feature
    # estimators, so repeat-unstable features cannot retain loss weight.
    for repeat in range(2):
        variants[f"__base__-repeat-{repeat}"] = dict(variants["__base__"])

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

    struck = instrument.strip().lower() in STRUCK_INSTRUMENTS
    sung = instrument.strip().lower() in {
        "soprano", "mezzo-soprano", "tenor", "bass",
        "voice-soprano", "voice-mezzo", "voice-tenor", "voice-bass",
    }

    def analysis_kwargs(ref: dict[str, Any]) -> dict[str, Any]:
        expected = ref.get("expectedF0Hz")
        if expected is None and struck:
            expected = 440.0 * 2 ** ((float(ref.get("midi", 60)) - 69) / 12)
        return {
            **({"expected_f0_hz": expected} if expected is not None else {}),
            **({"trust_expected_f0": True, "force_percussive": True}
               if struck else {}),
            "release_expected": bool(ref.get("releaseEligible")),
            "measure_pitch_sync_breath": sung,
        }

    ref_bundles = [extract_features(ref["path"], **analysis_kwargs(ref))
                   for ref in references]
    weights = weights_for_instrument(instrument, weight_overrides)
    render_cache: dict[tuple[str, int], Any] = {}

    def render_bundle(name: str, ref_index: int):
        key = (name, ref_index)
        if key not in render_cache:
            render_cache[key] = extract_features(
                renders / f"{name}-{ref_index}.wav",
                active_duration_s=references[ref_index].get(
                    "durationSec", 1.5),
                **analysis_kwargs(references[ref_index]),
            )
        return render_cache[key]

    def distances(name: str) -> dict[str, list[float]]:
        table: dict[str, list[float]] = {}
        for ref_index, ref_bundle in enumerate(ref_bundles):
            try:
                rendered = render_bundle(name, ref_index)
            except ValueError:
                # a perturbation that kills the note entirely is itself a
                # (maximal) response; record NaN and let the matrix step
                # treat it as an extreme change rather than crash the audit
                for key in DEFAULT_WEIGHTS:
                    table.setdefault(key, []).append(float("nan"))
                continue
            result = compare_features(ref_bundle, rendered, weights)
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
    repeat_rows = []
    repeat_means: dict[str, float] = {}
    repeat_peaks: dict[str, float] = {}
    for repeat in range(2):
        repeat_name = f"__base__-repeat-{repeat}"
        comparisons = []
        for ref_index in np.flatnonzero(base_ok):
            try:
                comparisons.append(compare_features(
                    render_bundle("__base__", int(ref_index)),
                    render_bundle(repeat_name, int(ref_index)),
                    weights))
            except ValueError:
                continue
        if not comparisons:
            continue
        means = {
            feature: float(np.mean([
                row["normalized"][feature] for row in comparisons]))
            for feature in comparisons[0]["normalized"]
        }
        peaks = {
            feature: float(np.max([
                row["normalized"][feature] for row in comparisons]))
            for feature in comparisons[0]["normalized"]
        }
        for feature in means:
            repeat_means[feature] = max(
                repeat_means.get(feature, 0.0), means[feature])
            repeat_peaks[feature] = max(
                repeat_peaks.get(feature, 0.0), peaks[feature])
        repeat_rows.append({
            "baseline": "__base__",
            "repeat": repeat_name,
            "meanPerceptualUnits": means,
            "peakPerceptualUnits": peaks,
        })
    unstable_features = sorted(
        feature for feature in repeat_means
        if repeat_means[feature] >= RESPONSE_THRESHOLD or
        repeat_peaks[feature] >= RESPONSE_THRESHOLD)
    matrix: dict[str, dict[str, float]] = {}
    render_failures: dict[str, int] = {}
    for key in free_params:
        probe_base = f"__base__-{key}"
        perturbed = distances(key)
        matrix[key] = {}
        direct_rows = []
        for ref_index in np.flatnonzero(base_ok):
            try:
                direct_rows.append(compare_features(
                    render_bundle(probe_base, int(ref_index)),
                    render_bundle(key, int(ref_index)), weights))
            except ValueError:
                continue
        for feature in base:
            finite = [float(row["normalized"][feature]) for row in direct_rows
                      if np.isfinite(row["normalized"].get(feature, math.nan))]
            # T-007/T-024: controllability is the direct perceptual response
            # to one changed parameter, not a difference between two
            # reference losses (which can cancel around an equidistant take).
            matrix[key][feature] = max(finite, default=0.0)
        any_pert = np.asarray(perturbed[next(iter(base))], dtype=float)[base_ok]
        render_failures[key] = int(np.isnan(any_pert).sum())

    final_weights = dict(weights)
    zero_weighted = []
    for feature in unstable_features:
        if float(final_weights.get(feature, 0)) <= 0:
            continue
        zero_weighted.append({
            "feature": feature,
            "previousWeight": final_weights[feature],
            "reason": "repeat renders crossed the controllability threshold",
            "status": "watch-metric",
        })
        final_weights[feature] = 0.0

    responsive = {
        feature: sorted(key for key in matrix
                        if matrix[key].get(feature, 0.0) >= RESPONSE_THRESHOLD)
        for feature in DEFAULT_WEIGHTS
    }
    for feature, weight in sorted(final_weights.items()):
        if float(weight) <= 0 or responsive.get(feature):
            continue
        zero_weighted.append({
            "feature": feature,
            "previousWeight": weight,
            "reason": "no audited free parameter crossed the response threshold",
            "status": "watch-metric",
        })
        final_weights[feature] = 0.0

    verdicts = []
    for feature, weight in sorted(DEFAULT_WEIGHTS.items()):
        active_weight = final_weights.get(feature, weight)
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

    watch_metrics = [v["feature"] for v in verdicts if v["status"] == "watch-metric"]
    uncontrolled = [v["feature"] for v in verdicts if v["status"] == "UNCONTROLLABLE"]
    objective_references = objective_references or references
    manifest_contract = manifest_contract or [
        {"key": key, "baseline": values[0], "perturbed": values[1]}
        for key, values in sorted(free_params.items())
    ]
    # T-024: bind the audit to every input whose drift invalidates its
    # response matrix.  Keep the original objective/manifest hashes for the
    # iterate.py handoff and publish the explicit component hashes as well.
    from .iterate import _renderer_contract_hash  # local: avoids import cycle
    from .score import SCORER_CONTRACT_VERSION
    audit = {"schemaVersion": 3, "instrument": instrument,
             "status": "clean" if not uncontrolled else "not-clean",
             "threshold": RESPONSE_THRESHOLD,
             "scorerContractVersion": SCORER_CONTRACT_VERSION,
             "rendererContractHash": _renderer_contract_hash(repo_root),
             "referenceContractHash": _canonical_hash(objective_references),
             "parameterManifestHash": _canonical_hash(manifest_contract),
             "initialPresetHash": _canonical_hash(baseline_params),
             "objectiveHash": objective_contract_hash(
                 instrument, objective_references, final_weights),
             "manifestHash": manifest_contract_hash(manifest_contract),
             "humanRangeDelivery": (
                 "engine-native-zero-inflated-note-episode"
                 if isinstance(baseline_params.get("humanRanges"), dict) and
                 bool((baseline_params["humanRanges"].get("ranges") or {}))
                 else None),
             "humanRangeContractHash": (
                 _canonical_hash(baseline_params["humanRanges"])
                 if isinstance(baseline_params.get("humanRanges"), dict)
                 else None),
             "activationEvidence": activation_evidence,
             "manifest": manifest_contract,
             "startingWeights": weights,
             "finalWeights": final_weights,
             "references": [ref.get("path") for ref in references],
             "excludedReferences": excluded_refs,
             "analysisFailuresPerParam": render_failures,
             "repeatability": {
                 "status": ("stable" if not unstable_features else
                            "watch-metrics-zeroed"),
                 "unstableFeatures": unstable_features,
                 "maxMeanPerceptualUnits": repeat_means,
                 "maxPeakPerceptualUnits": repeat_peaks,
                 "comparisons": repeat_rows,
             },
             "zeroWeighted": zero_weighted,
             "matrix": matrix, "verdicts": verdicts,
             "responsiveParameters": responsive,
             "responders": responsive,
             "weights": final_weights,
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
    lines.extend([
        "",
        "## Repeat-render stability",
        "",
        f"Status: **{audit['repeatability']['status'].upper()}**",
        "",
        "Unstable features: " +
        (", ".join(f"`{feature}`" for feature in unstable_features)
         or "none"),
    ])
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
                        help="comma-separated free keys; defaults by instrument family")
    parser.add_argument("--ship-human", type=float,
                        help="override calibrated SHIP Human before hashing the baseline")
    parser.add_argument("--pitch-sync-breath-engine-audit", type=Path)
    parser.add_argument("--pitch-sync-breath-corpus-audit", type=Path)
    parser.add_argument("--pitch-sync-breath-only", action="store_true",
                        help="run the evidence-gated T-067 activation responder audit")
    args = parser.parse_args(argv)
    references = json.loads(args.references.read_text())
    campaign_seed = json.loads(args.initial.read_text())
    from .legacy_prior import resolve_legacy_prior
    baseline, legacy_prior = resolve_legacy_prior(args.instrument, campaign_seed)
    if args.ship_human is not None:
        if not 0 <= args.ship_human <= 1:
            parser.error("--ship-human must be in [0, 1]")
        baseline["excitationHuman"] = float(args.ship_human)
        legacy_prior["calibratedShipHuman"] = float(args.ship_human)
        legacy_prior["resolvedParameterHash"] = _canonical_hash(baseline)
        legacy_prior["resolvedHash"] = legacy_prior["resolvedParameterHash"]
    sung_instruments = {
        "soprano", "mezzo-soprano", "tenor", "bass",
        "voice-soprano", "voice-mezzo", "voice-tenor", "voice-bass",
    }
    available = (SUNG_FREE_PARAMS if args.instrument.strip().lower()
                 in sung_instruments else BOWED_FREE_PARAMS)
    objective_references = (
        [row for row in references if "spectral" in row.get("roles", [])]
        if args.instrument.strip().lower() in sung_instruments else references
    )
    if not objective_references:
        parser.error("references contain no rows with the spectral role")
    keys = (list(dict.fromkeys(key.strip() for key in args.keys.split(",")
                              if key.strip()))
            if args.keys else list(available))
    unknown = [key for key in keys if key not in available]
    if unknown:
        parser.error(f"no perturbation specification for: {', '.join(unknown)}")
    free_params = {key: available[key] for key in keys}
    weight_overrides = None
    activation_evidence = None
    evidence_requested = bool(args.pitch_sync_breath_engine_audit or
                              args.pitch_sync_breath_corpus_audit)
    if evidence_requested:
        if not (args.pitch_sync_breath_engine_audit and
                args.pitch_sync_breath_corpus_audit):
            parser.error("pitch-sync breath activation requires both engine and corpus audits")
        engine_evidence = json.loads(
            args.pitch_sync_breath_engine_audit.read_text())
        corpus_evidence = json.loads(
            args.pitch_sync_breath_corpus_audit.read_text())
        expected_voice = {
            "voice-mezzo": "mezzo-soprano",
            "voice-soprano": "soprano",
            "voice-tenor": "tenor",
            "voice-bass": "bass",
        }.get(args.instrument.strip().lower(), args.instrument.strip().lower())
        evidence_errors = []
        if (engine_evidence.get("status") != "pass" or
                not all(engine_evidence.get("checks", {}).values())):
            evidence_errors.append("engine partial-muted octave audit is not pass")
        if corpus_evidence.get("status") != "pass":
            evidence_errors.append("lossless corpus audit is not pass")
        if corpus_evidence.get("voiceClass") != expected_voice:
            evidence_errors.append("corpus audit belongs to another voice")
        if corpus_evidence.get("syntheticGate", {}).get("status") != "pass":
            evidence_errors.append("synthetic AM-noise gate is not pass")
        if evidence_errors:
            parser.error("invalid pitch-sync breath evidence: " +
                         "; ".join(evidence_errors))
        weight_overrides = {"pitch_sync_breath_db": 1.0}
        activation_evidence = {
            "feature": "pitch_sync_breath_db",
            "engineAudit": str(args.pitch_sync_breath_engine_audit),
            "engineAuditHash": _canonical_hash(engine_evidence),
            "corpusAudit": str(args.pitch_sync_breath_corpus_audit),
            "corpusAuditHash": _canonical_hash(corpus_evidence),
            "roomSuspectedRowsExcluded": corpus_evidence.get(
                "roomSuspectedRows", 0),
        }
    if args.pitch_sync_breath_only:
        if not evidence_requested:
            parser.error("--pitch-sync-breath-only requires engine and corpus audits")
        if keys != ["voiceBreathSync"]:
            parser.error("--pitch-sync-breath-only requires --keys voiceBreathSync")
        weight_overrides = {key: 0.0 for key in DEFAULT_WEIGHTS}
        weight_overrides["pitch_sync_breath_db"] = 1.0
    manifest_document = json.loads(args.manifest.read_text())
    contract = _manifest_contract(manifest_document, baseline, keys)
    seen: dict[str, dict[str, Any]] = {}
    analysis_rejects = []
    struck = args.instrument.strip().lower() in STRUCK_INSTRUMENTS
    for row in objective_references:
        key = f"{row.get('register')}|{row.get('dynamic')}"
        if key in seen:
            continue
        try:
            expected = row.get("expectedF0Hz")
            if expected is None and struck:
                expected = 440.0 * 2 ** ((float(row.get("midi", 60)) - 69) / 12)
            extract_features(
                row["path"], expected_f0_hz=expected,
                trust_expected_f0=struck, force_percussive=struck,
            )
        except (ValueError, RuntimeError) as exc:
            analysis_rejects.append({"path": row.get("path"), "error": str(exc)})
            continue
        seen[key] = row
    if "releaseDamping" in keys:
        # T-060: release activation is evidenced by every mechanically
        # audited full-tail row, not the first register/dynamic exemplar.
        subset = [row for row in objective_references
                  if bool(row.get("releaseEligible"))]
    else:
        subset = list(seen.values()) if struck else list(seen.values())[:6]
    if not subset:
        parser.error("no pitch-anchored objective reference can be analysed")
    audit = run_audit(args.instrument, baseline, subset, args.output,
                      args.repo_root, free_params=free_params,
                      objective_references=objective_references,
                      manifest_contract=contract,
                      manifest_document=manifest_document,
                      weight_overrides=weight_overrides,
                      activation_evidence=activation_evidence)
    audit["legacyPrior"] = legacy_prior
    audit["auditReferenceSelectionRejects"] = analysis_rejects
    (args.output / "controllability.json").write_text(
        json.dumps(audit, indent=1) + "\n")
    print(json.dumps({"clean": audit["clean"],
                      "repeatability": audit["repeatability"]["status"],
                      "unstableFeatures": audit["repeatability"][
                          "unstableFeatures"],
                      "uncontrollable": [v["feature"] for v in audit["verdicts"]
                                         if v["status"] == "UNCONTROLLABLE"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


# ---------------------------------------------------------------------------
# Struck/plucked lane contract surface (Agent C, pass05).  The fitter-side
# consuming assertions, the perturbation law and the planned watch-metric
# ledgers survive here; the pass05 audit CLI itself was superseded by the
# hashed-contract audit above.

DEFAULT_KEYS = (
    "excitationPosition", "excitationHardness", "velocityHardnessCoupling",
    "excitationHuman", "attackNoiseLevel", "attackNoiseDirect",
    "attackNoiseVelocityExponent", "partialTransfer", "partialTilt",
    "spectralResonanceAmount", "decaySecondStage", "decaySecondRatio",
)

PLANNED_WATCH_METRICS = {
    "grand-piano": [
        ("two_polarisation_beating", "no scorer sensor and no generating parameter"),
        ("release_damper_ring", "release ring is not independently controllable"),
        ("sympathetic_bloom", "partialTransfer is only a proxy; no keyed/pedal coupling law"),
        ("decay_aligned_band_balance", "T-005 percussive window feature not yet emitted"),
    ],
    "guitar-nylon": [
        ("two_polarisation_beating", "no scorer sensor and no generating parameter"),
        ("sympathetic_bloom", "partialTransfer is only a proxy; no open-string coupling law"),
        ("decay_aligned_band_balance", "T-005 percussive window feature not yet emitted"),
    ],
}

REQUIRED_CONTROL_EFFECTS = {
    "velocityHardnessCoupling": {
        "metric": "velocity_hardness_brightness",
        "features": {"partials_db", "log_mel_db", "centroid_semitones", "onset_tilt_db_oct"},
        "reason": "G7 must move a brightness observable, not only an f0/B estimator",
    },
    "decaySecondStage": {
        "metric": "two_stage_decay",
        "features": {"decay_log_ratio"},
        "reason": "G4 amount must move measured decay",
    },
    "decaySecondRatio": {
        "metric": "two_stage_decay_ratio",
        "features": {"decay_log_ratio"},
        "reason": "G4 late/early ratio must move measured decay",
    },
}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]


def manifest_rows(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {row["key"]: row for row in manifest["continuous"]}


def perturbations(spec, initial: dict[str, Any]) -> list[float]:
    centre = float(initial.get(spec.key, spec.default))
    delta = 0.1 * (spec.hi - spec.lo)
    candidates = [float(np.clip(centre - delta, spec.lo, spec.hi)),
                  float(np.clip(centre + delta, spec.lo, spec.hi))]
    return list(dict.fromkeys(value for value in candidates if abs(value - centre) > 1e-12))


def validate_audit_contract(audit: dict[str, Any], *, instrument: str,
                            references: list[dict[str, Any]], manifest: dict[str, Any],
                            initial: dict[str, Any] | None = None) -> None:
    """T-007 consuming-side assertion for fitter/audit handoff."""
    from .iterate import _renderer_contract_hash  # local: avoids import cycle
    from .score import SCORER_CONTRACT_VERSION
    errors = []
    if audit.get("instrument") != instrument:
        errors.append(f"instrument {audit.get('instrument')!r} != {instrument!r}")
    if audit.get("referenceContractHash") != canonical_hash(references):
        errors.append("reference manifest changed after controllability audit")
    if audit.get("parameterManifestHash") != canonical_hash(manifest):
        errors.append("free-parameter manifest changed after controllability audit")
    if initial is not None and audit.get("initialPresetHash") != canonical_hash(initial):
        errors.append("initial preset changed after controllability audit")
    if audit.get("status") != "clean":
        errors.append(f"audit status is {audit.get('status')!r}, not 'clean'")
    if audit.get("scorerContractVersion") != SCORER_CONTRACT_VERSION:
        errors.append("scorer contract changed after controllability audit")
    if audit.get("rendererContractHash") != _renderer_contract_hash():
        errors.append("renderer contract changed after controllability audit")
    if int(audit.get("schemaVersion", 0)) < 3:
        errors.append("repeat-render stability evidence is missing")
    unstable = set(audit.get("repeatability", {}).get("unstableFeatures", []))
    active_unstable = sorted(
        feature for feature in unstable
        if float(audit.get("weights", {}).get(feature, 0)) > 0)
    if active_unstable:
        errors.append(f"repeat-unstable features still carry weight: {active_unstable}")
    responders = audit.get("responders", {})
    for feature, weight in audit.get("weights", {}).items():
        if float(weight) > 0 and not responders.get(feature):
            errors.append(f"weighted feature {feature!r} has no responsive free parameter")
    if errors:
        raise ValueError("invalid controllability contract: " + "; ".join(errors))
