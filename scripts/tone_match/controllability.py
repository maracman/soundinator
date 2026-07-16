#!/usr/bin/env python3
"""Mechanically audit scorer-feature controllability before SG2 fitting.

Each applicable free manifest parameter is perturbed by ten percent of its
declared range.  The exact browser render path is exercised at every selected
register/dynamic.  A scored feature keeps non-zero weight only when at least
one perturbation moves it by a measurable fraction of a perceptual unit.

Conditional laws declare ``auditContext`` in ``manifest.json`` so an inert
neutral default (for example double-decay ratio while amount is zero) is
tested without turning a fitted value into a family default.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path
from typing import Any

import numpy as np

from .iterate import FreeParam, _params, _renderer_contract_hash
from .score import (
    SCORER_CONTRACT_VERSION,
    compare_features,
    extract_features,
    weights_for_instrument,
)


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = Path("/private/tmp/sg2")
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


def perturbations(spec: FreeParam, initial: dict[str, Any]) -> list[float]:
    centre = float(initial.get(spec.key, spec.default))
    delta = 0.1 * (spec.hi - spec.lo)
    candidates = [float(np.clip(centre - delta, spec.lo, spec.hi)),
                  float(np.clip(centre + delta, spec.lo, spec.hi))]
    return list(dict.fromkeys(value for value in candidates if abs(value - centre) > 1e-12))


def validate_audit_contract(audit: dict[str, Any], *, instrument: str,
                            references: list[dict[str, Any]], manifest: dict[str, Any],
                            initial: dict[str, Any] | None = None) -> None:
    """T-007 consuming-side assertion for fitter/audit handoff."""
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


def _render(run_dir: Path, initial: dict[str, Any], references: list[dict[str, Any]],
            free: list[FreeParam], rows: dict[str, dict[str, Any]]) -> dict[str, list[Path]]:
    configs: dict[str, dict[str, Any]] = {}
    config_by_hash: dict[str, str] = {}
    comparisons: dict[str, list[tuple[str, str]]] = {}

    def register_config(label: str, params: dict[str, Any]) -> str:
        fingerprint = canonical_hash(params)
        if fingerprint in config_by_hash:
            return config_by_hash[fingerprint]
        configs[label] = params
        config_by_hash[fingerprint] = label
        return label

    for spec in free:
        context = rows[spec.key].get("auditContext") or {}
        baseline = {**initial, **context}
        base_id = register_config(f"{spec.key}-base", baseline)
        comparisons[spec.key] = []
        for index, value in enumerate(perturbations(spec, baseline)):
            variant_id = register_config(f"{spec.key}-probe-{index}",
                                         {**baseline, spec.key: value})
            comparisons[spec.key].append((base_id, variant_id))
    # Chromium's offline graph may differ by a final PCM bit across contexts.
    # Render every distinct baseline twice more so the audit can detect any
    # feature extractor that amplifies that inaudible jitter into a loss.
    for base_id in dict.fromkeys(pair[0] for pairs in comparisons.values() for pair in pairs):
        for repeat in range(2):
            configs[f"{base_id}-repeat-{repeat}"] = dict(configs[base_id])

    render_dir = run_dir / "renders"
    listen_dir = run_dir / "listen-controllability"
    render_dir.mkdir(parents=True, exist_ok=True)
    listen_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    paths: dict[str, list[Path]] = {}
    for config_id, params in configs.items():
        paths[config_id] = []
        for ref_index, reference in enumerate(references):
            target = render_dir / f"{config_id}-{ref_index:02d}.wav"
            paths[config_id].append(target)
            jobs.append({
                "params": params, "midi": reference["midi"],
                "velocity": reference["velocity"],
                # Diagnostic sweep: enough attack/early decay to establish a
                # response, without paying full fitting-render cost.
                "durationSec": min(float(reference["durationSec"]), 0.75),
                "sampleRate": 24000,
                "out": str(target),
            })
    jobs_path = run_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    if all(Path(job["out"]).exists() for job in jobs):
        (run_dir / "render.stdout.log").write_text("reused complete render set\n")
        (run_dir / "render.stderr.log").write_text("")
    else:
        process = subprocess.run(
            ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
            cwd=ROOT, text=True, capture_output=True,
        )
        (run_dir / "render.stdout.log").write_text(process.stdout)
        (run_dir / "render.stderr.log").write_text(process.stderr)
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)

    # A compact listen directory: one baseline context per parameter at the
    # mid reference.  It exists for the owner's listening page even though
    # ears are not a preflight gate.
    mid = len(references) // 2
    for spec in free:
        base_id = comparisons[spec.key][0][0] if comparisons[spec.key] else f"{spec.key}-base"
        source = paths[base_id][mid]
        (listen_dir / f"{spec.key}-baseline.path.txt").write_text(str(source) + "\n")
        for direction, (_, variant_id) in enumerate(comparisons[spec.key]):
            (listen_dir / f"{spec.key}-probe-{direction}.path.txt").write_text(
                str(paths[variant_id][mid]) + "\n"
            )
    (run_dir / "comparisons.json").write_text(json.dumps(comparisons, indent=2) + "\n")
    return paths


def run_audit(instrument: str, initial: dict[str, Any], references: list[dict[str, Any]],
              manifest: dict[str, Any], run_dir: Path, keys: list[str],
              mean_threshold: float = 0.01, peak_threshold: float = 0.05) -> dict[str, Any]:
    free = _params(manifest, initial, keys)
    if not free:
        raise ValueError("no applicable free parameters selected")
    rows = manifest_rows(manifest)
    # Six probes cover low/mid/high × both dynamics.  The contract below still
    # hashes the complete reference objective; this is only render-cost
    # sampling, never permission to fit against a reduced set.
    registers = list(dict.fromkeys(row.get("register") for row in references))
    selected_registers = list(dict.fromkeys(
        registers[index] for index in (0, len(registers) // 2, len(registers) - 1)
        if registers
    ))
    probe_indices = [index for index, row in enumerate(references)
                     if row.get("register") in selected_registers]
    probe_references = [references[index] for index in probe_indices]
    paths = _render(run_dir, initial, probe_references, free, rows)
    comparisons = json.loads((run_dir / "comparisons.json").read_text())
    feature_cache: dict[str, Any] = {}
    analysis_failures = []
    for config_id, config_paths in paths.items():
        for probe_index, path in enumerate(config_paths):
            reference = probe_references[probe_index]
            expected_f0_hz = 440.0 * 2 ** ((float(reference["midi"]) - 69) / 12)
            try:
                feature_cache[str(path)] = extract_features(
                    path, active_duration_s=min(float(reference["durationSec"]), 0.75),
                    expected_f0_hz=expected_f0_hz, trust_expected_f0=True,
                    force_percussive=instrument in {
                        "piano", "grand-piano", "upright-piano", "guitar",
                        "guitar-nylon", "guitar-steel", "harp", "glockenspiel",
                    })
            except ValueError as error:
                analysis_failures.append({"config": config_id,
                                          "probeIndex": probe_indices[probe_index],
                                          "path": str(path), "error": str(error)})
    repeat_rows = []
    repeat_means: dict[str, float] = {}
    repeat_peaks: dict[str, float] = {}
    base_ids = list(dict.fromkeys(
        pair[0] for pairs in comparisons.values() for pair in pairs))
    for base_id in base_ids:
        for repeat in range(2):
            repeat_id = f"{base_id}-repeat-{repeat}"
            note_rows = [
                compare_features(feature_cache[str(base)], feature_cache[str(other)])
                for base, other in zip(paths[base_id], paths[repeat_id])
                if str(base) in feature_cache and str(other) in feature_cache
            ]
            if not note_rows:
                continue
            means = {
                feature: float(np.mean([row["normalized"][feature] for row in note_rows]))
                for feature in note_rows[0]["normalized"]
            }
            peaks = {
                feature: float(np.max([row["normalized"][feature] for row in note_rows]))
                for feature in note_rows[0]["normalized"]
            }
            for feature in means:
                repeat_means[feature] = max(repeat_means.get(feature, 0), means[feature])
                repeat_peaks[feature] = max(repeat_peaks.get(feature, 0), peaks[feature])
            repeat_rows.append({"baseline": base_id, "repeat": repeat_id,
                                "meanPerceptualUnits": means,
                                "peakPerceptualUnits": peaks})
    unstable_features = sorted(
        feature for feature in repeat_means
        if repeat_means[feature] >= mean_threshold or
        repeat_peaks[feature] >= peak_threshold
    )
    parameter_table: dict[str, Any] = {}
    responders: dict[str, list[str]] = {}
    for spec in free:
        directions = []
        best_by_feature: dict[str, float] = {}
        peak_by_feature: dict[str, float] = {}
        for base_id, variant_id in comparisons[spec.key]:
            note_rows = [compare_features(feature_cache[str(base)], feature_cache[str(variant)])
                         for base, variant in zip(paths[base_id], paths[variant_id])
                         if str(base) in feature_cache and str(variant) in feature_cache]
            if not note_rows:
                continue
            means = {feature: float(np.mean([row["normalized"][feature] for row in note_rows]))
                     for feature in note_rows[0]["normalized"]}
            peaks = {feature: float(np.max([row["normalized"][feature] for row in note_rows]))
                     for feature in note_rows[0]["normalized"]}
            for feature in means:
                best_by_feature[feature] = max(best_by_feature.get(feature, 0), means[feature])
                peak_by_feature[feature] = max(peak_by_feature.get(feature, 0), peaks[feature])
            directions.append({"variant": variant_id, "meanPerceptualUnits": means,
                               "peakPerceptualUnits": peaks})
        responsive = sorted(
            feature for feature in best_by_feature
            if best_by_feature[feature] >= mean_threshold or peak_by_feature[feature] >= peak_threshold
        )
        for feature in responsive:
            responders.setdefault(feature, []).append(spec.key)
        parameter_table[spec.key] = {
            "bounds": [spec.lo, spec.hi],
            "baseline": float(initial.get(spec.key, spec.default)),
            "auditContext": rows[spec.key].get("auditContext") or {},
            "responsiveFeatures": responsive,
            "maxMeanPerceptualUnits": best_by_feature,
            "maxPeakPerceptualUnits": peak_by_feature,
            "directions": directions,
        }

    starting_weights = weights_for_instrument(instrument)
    final_weights = dict(starting_weights)
    zero_weighted = []
    for feature, weight in starting_weights.items():
        if float(weight) > 0 and feature in unstable_features:
            final_weights[feature] = 0.0
            zero_weighted.append({
                "feature": feature,
                "reason": "repeat renders of identical parameters crossed the stability threshold",
                "previousWeight": weight,
                "status": "watch-metric",
            })
        elif float(weight) > 0 and not responders.get(feature):
            final_weights[feature] = 0.0
            zero_weighted.append({
                "feature": feature,
                "reason": "no selected free manifest parameter crossed the controllability threshold",
                "previousWeight": weight,
                "status": "watch-metric",
            })
    status = "clean"
    if analysis_failures:
        # A perturbation must not manufacture apparent controllability by
        # making the f0 tracker jump harmonics.  Until every probe context is
        # analysable, no observed feature response is safe to consume as a
        # loss contract.
        status = "blocked-analysis"
        for feature, weight in starting_weights.items():
            if float(weight) > 0 and final_weights.get(feature, 0) > 0:
                final_weights[feature] = 0.0
                zero_weighted.append({
                    "feature": feature,
                    "reason": "percussive f0 analysis failed in one or more audit contexts; apparent response is untrusted",
                    "previousWeight": weight,
                    "status": "watch-metric",
                })
    planned = [
        {"feature": feature, "reason": reason, "previousWeight": 0.0,
         "status": "watch-metric", "notEmittedByScorer": True}
        for feature, reason in PLANNED_WATCH_METRICS.get(instrument, [])
    ]
    control_failures = []
    for parameter, contract in REQUIRED_CONTROL_EFFECTS.items():
        if parameter not in parameter_table:
            continue
        observed = set(parameter_table[parameter]["responsiveFeatures"])
        if not observed.intersection(contract["features"]):
            row = {"feature": contract["metric"], "parameter": parameter,
                   "reason": contract["reason"], "previousWeight": 0.0,
                   "status": "watch-metric", "requiredFeatures": sorted(contract["features"])}
            planned.append(row)
            control_failures.append(row)
    report = {
        "schemaVersion": 3,
        "scorerContractVersion": SCORER_CONTRACT_VERSION,
        "rendererContractHash": _renderer_contract_hash(),
        "instrument": instrument,
        "status": status,
        "createdAt": time.time(),
        "referenceContractHash": canonical_hash(references),
        "parameterManifestHash": canonical_hash(manifest),
        "initialPresetHash": canonical_hash(initial),
        "thresholds": {"meanPerceptualUnits": mean_threshold,
                       "peakPerceptualUnits": peak_threshold},
        "probeReferenceIndices": probe_indices,
        "analysisFailures": analysis_failures,
        "repeatability": {
            "status": "stable" if not unstable_features else "watch-metrics-zeroed",
            "unstableFeatures": unstable_features,
            "maxMeanPerceptualUnits": repeat_means,
            "maxPeakPerceptualUnits": repeat_peaks,
            "comparisons": repeat_rows,
        },
        "controlFailures": control_failures,
        "parameters": parameter_table,
        "responders": {key: sorted(value) for key, value in responders.items()},
        "startingWeights": starting_weights,
        "weights": final_weights,
        "zeroWeighted": zero_weighted + planned,
        "listenDirectory": str(run_dir / "listen-controllability"),
    }
    if status == "clean":
        validate_audit_contract(
            report, instrument=instrument, references=references,
            manifest=manifest, initial=initial)
    return report


def write_markdown(path: Path, report: dict[str, Any]) -> None:
    lines = [
        f"# Controllability audit — {report['instrument']}\n\n",
        f"Status: **{report['status'].upper()}**  \n",
        f"Reference contract: `{report['referenceContractHash']}`  \n",
        f"Parameter manifest: `{report['parameterManifestHash']}`\n\n",
        "## Parameter responses\n\n",
        "| Parameter | Responsive scored features |\n|---|---|\n",
    ]
    for key, row in report["parameters"].items():
        features = ", ".join(f"`{feature}`" for feature in row["responsiveFeatures"]) or "none"
        lines.append(f"| `{key}` | {features} |\n")
    repeatability = report.get("repeatability", {})
    lines.extend([
        "\n## Repeat-render stability\n\n",
        f"Status: **{repeatability.get('status', 'missing').upper()}**  \n",
        "Unstable features: " +
        (", ".join(f"`{feature}`" for feature in repeatability.get("unstableFeatures", []))
         or "none") + "\n",
    ])
    lines.extend(["\n## Weight policy\n\n",
                  "| Feature | Weight | Responsive parameters |\n|---|---:|---|\n"])
    for feature, weight in report["weights"].items():
        params = ", ".join(f"`{key}`" for key in report["responders"].get(feature, [])) or "watch only"
        lines.append(f"| `{feature}` | {weight:g} | {params} |\n")
    lines.extend(["\n## Zero-weight watch metrics\n\n",
                  "| Feature | Reason |\n|---|---|\n"])
    for row in report["zeroWeighted"]:
        lines.append(f"| `{row['feature']}` | {row['reason']} |\n")
    path.write_text("".join(lines))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--initial", required=True, type=Path)
    parser.add_argument("--references", required=True, type=Path)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).with_name("manifest.json"))
    parser.add_argument("--keys", default=",".join(DEFAULT_KEYS))
    parser.add_argument("--run", default=time.strftime("audit-%Y%m%d-%H%M%S"))
    parser.add_argument("--resume", action="store_true", help="reuse an existing complete render set")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_ROOT)
    args = parser.parse_args(argv)
    run_dir = args.output_root / args.instrument / args.run
    run_dir.mkdir(parents=True, exist_ok=args.resume)
    initial = json.loads(args.initial.read_text())
    references = json.loads(args.references.read_text())
    manifest = json.loads(args.manifest.read_text())
    keys = list(dict.fromkeys(key.strip() for key in args.keys.split(",") if key.strip()))
    report = run_audit(args.instrument, initial, references, manifest, run_dir, keys)
    (run_dir / "controllability.json").write_text(json.dumps(report, indent=2) + "\n")
    write_markdown(run_dir / "CONTROLLABILITY.md", report)
    print(json.dumps({"runDir": str(run_dir), "status": report["status"],
                      "zeroWeighted": len(report["zeroWeighted"]),
                      "listenDirectory": report["listenDirectory"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
