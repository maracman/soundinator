"""Manifest-driven Sound Generator 2.0 optimizer.

Reference manifest example:
[
  {"path":"/private/tmp/sg2/samples/clarinet/C4-mf.wav","midi":60,
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
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
from scipy.optimize import minimize

from .assertions import ConstructionSample, evaluate_construction
from .audition import build as build_audition
from .controllability import objective_contract_hash, manifest_contract_hash
from .score import compare_features, extract_features, score_files, weights_for_instrument, write_report
from .tripwires import (
    aggregate_by_cell,
    evaluate_tripwires,
    reference_roles,
    required_cells_by_bar,
    tripwire_table_markdown,
)

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUN_ROOT = Path("/private/tmp/sg2")
MEASURABLE_REL_IMPROVEMENT = 1e-3
ANALYSIS_FAILURE_LOSS = 100.0


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
                           weights: dict[str, float] | None = None) -> dict[str, Any]:
    """Measure same-note/same-dynamic take-to-take feature distance."""
    groups: dict[str, list[int]] = {}
    for index, reference in enumerate(references):
        groups.setdefault(_floor_group(reference), []).append(index)
    eligible = {key: indices for key, indices in groups.items() if len(indices) >= 2}
    if not eligible:
        return {"status": "insufficient-evidence", "groups": [], "eligibleReferences": 0,
                "reason": "no same-pitch/same-dynamic group contains at least two takes"}
    cache = {index: feature_loader(references[index]["path"])
             for indices in eligible.values() for index in indices}
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


def _tripwire_gate(scores: list[dict[str, Any]], references: list[dict[str, Any]],
                   variability: dict[str, Any], construction: dict[str, Any]) -> dict[str, Any]:
    """Campaign-level §3 gate with owner-readable rows per register/dynamic."""
    rows = []
    failure_count = 0
    for index, (score, reference) in enumerate(zip(scores, references)):
        mean_limit, max_limit = _band_limits_for_reference(index, variability)
        checks = []
        for original in score.get("tripwires", {}).get("rows", []):
            check = dict(original)
            if check["name"] == "band-balance-mean":
                observed = check.get("observed")
                check.update(status="pass" if observed is not None and observed <= mean_limit else "fail",
                             limit=f"<= {mean_limit:.3f} dB (3 dB or take floor)")
            elif check["name"] == "band-balance-max-octave":
                observed = check.get("observed")
                check.update(status="pass" if observed is not None and observed <= max_limit else "fail",
                             limit=f"<= {max_limit:.3f} dB (6 dB or take floor)")
            checks.append(check)
        failed = [row for row in checks if row["status"] == "fail"]
        missing = [row for row in checks if row["status"] == "not-applicable" and
                   row["name"] != "inharmonicity-b"]
        passed = not failed and not missing
        failure_count += len(failed) + len(missing)
        rows.append({"referenceIndex": index, "register": reference.get("register"),
                     "dynamic": reference.get("dynamic"), "midi": reference.get("midi"),
                     "passed": passed, "checks": checks,
                     "bandBalance": score.get("bandBalance")})
    return {"passed": bool(construction.get("passed")) and failure_count == 0,
            "constructionPassed": bool(construction.get("passed")),
            "failureCount": failure_count + int(construction.get("counts", {}).get("fail", 0)),
            "rows": rows}


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
    path = DEFAULT_RUN_ROOT / instrument / "work-items.json"
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


def _build_listening_page(run_dir: Path, instrument: str, best: dict[str, Any],
                          references: list[dict[str, Any]]) -> dict[str, Any]:
    render_dir = run_dir / "renders" / f"eval-{int(best['evaluation']):04d}"
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
            "auditionManifest": str(manifest_path)}


def _technique_exchange_statuses() -> list[dict[str, str]]:
    path = ROOT / "docs" / "sg2" / "TECHNIQUES_EXCHANGE.md"
    if not path.exists():
        return [{"id": "exchange", "title": "techniques exchange",
                 "engine": "FAIL: file missing from branch"}]
    statuses, current_id, title = [], None, ""
    for line in path.read_text().splitlines():
        if line.startswith("### T-"):
            heading = line[4:].strip()
            current_id, _, title = heading.partition(" · ")
        elif current_id and line.startswith("Status:"):
            engine = line.split("engine=", 1)[1].split(" analysis=", 1)[0].strip() \
                if "engine=" in line else "missing"
            statuses.append({"id": current_id, "title": title, "engine": engine})
            current_id = None
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
            marks = [("PASS" if by_name[name]["status"] == "pass" else
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
    lines.extend(["\n## Techniques exchange statuses\n\n",
                  "| Entry | Engine/blown status |\n|---|---|\n"])
    for row in summary.get("exchangeStatuses", []):
        lines.append(f"| `{row['id']}` {row['title']} | {row['engine']} |\n")
    board = summary["leaderboardState"]
    lines.extend(["\n## Leaderboard state\n\n",
                  f"Reference set: `{summary['referenceSet']}`. Current run is "
                  f"**{'leader' if board['isLeader'] else 'not leader'}**; "
                  f"previous comparable best: `{board.get('previousBestLoss')}`; "
                  f"current loss: `{summary['bestLoss']:.6f}`.\n",
                  "\n## Owner render directories\n\n",
                  f"Best renders: `{summary['renderArtifacts']['bestRenderDirectory']}`  \n",
                  f"Listening page: `{summary['renderArtifacts']['listeningPage']}`  \n",
                  f"Manifest: `{summary['renderArtifacts']['auditionManifest']}`\n"])
    path.write_text("".join(lines), encoding="utf-8")


def _params(manifest: dict, initial: dict, only: list[str] | None) -> list[FreeParam]:
    """Resolve free parameters while retaining an explicit campaign order."""
    result: dict[str, FreeParam] = {}
    excitation = initial.get("excitationType")
    family = initial.get("sg2Family")
    for row in manifest["continuous"]:
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
                 variability: dict[str, Any] | None = None):
        self.instrument, self.initial, self.references, self.free = instrument, initial, references, free
        self.run_dir = run_dir
        self.repo_root = repo_root
        self.weights = weights or weights_for_instrument(instrument)
        self.variability = variability or {}
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
        params_path.write_text(json.dumps(params, indent=2) + "\n")
        jobs = []
        for ref_index, ref in enumerate(self.references):
            articulation_seed = None
            if float(params.get("articulationCoupling", 0) or 0) > 0:
                articulation_seed = int(params.get("seed", 7331)) + ref_index * 104729
            jobs.append({"paramsFile": str(params_path), "midi": ref.get("midi", 60),
                         "velocity": ref.get("velocity", .62), "durationSec": ref.get("durationSec", 1.5),
                         "sampleRate": ref.get("sampleRate", 48000),
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
        for ref_index, (ref, job) in enumerate(zip(self.references, jobs)):
            reference_bundle = extract_features(ref["path"])
            try:
                render_bundle = extract_features(
                    job["out"], active_duration_s=ref.get(
                        "durationSec", 1.5))
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
        record = {"evaluation": index, "loss": loss, "params": {p.key: params[p.key] for p in self.free},
                  "objective": objective, "gateFailures": gate_failures,
                  "analysisFailures": analysis_failures,
                  "construction": construction, "tripwires": tripwires,
                  "scores": scores}
        self.evaluations.append(record)
        (self.run_dir / "loss_curve.json").write_text(json.dumps(self.evaluations, indent=2) + "\n")
        if self.best is None or (gate_failures, loss) < (
                self.best["gateFailures"], self.best["loss"]):
            self.best = {"loss": loss, "objective": objective, "params": params, "evaluation": index,
                         "gateFailures": gate_failures,
                         "analysisFailures": analysis_failures,
                         "construction": construction, "tripwires": tripwires,
                         "scores": scores}
            (self.run_dir / "best.json").write_text(json.dumps(self.best, indent=2) + "\n")
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
                      weights: dict[str, float] | None = None) -> str:
    """Identify the scored objective so unlike manifests are never ranked."""
    objective = {
        "references": references,
        "weights": weights or weights_for_instrument(instrument),
    }
    canonical = json.dumps(objective, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _free_manifest_contract(free: list[FreeParam]) -> list[dict[str, Any]]:
    return [{"key": row.key, "min": row.lo, "max": row.hi,
             "default": row.default} for row in free]


def _consume_controllability_audit(path: Path, instrument: str,
                                   references: list[dict[str, Any]],
                                   free: list[FreeParam],
                                   starting_weights: dict[str, float]) -> dict[str, Any]:
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
    if int(audit.get("schemaVersion", 0)) < 2:
        errors.append("repeat-render stability evidence is missing")
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


def _update_leaderboard(instrument: str, run_dir: Path, best: dict,
                        reference_set: str) -> tuple[bool, float | None]:
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board = _load(board_path) if board_path.exists() else {"instrument": instrument, "runs": []}
    comparable = [row for row in board.get("runs", [])
                  if row.get("referenceSet") == reference_set]
    previous = min(comparable, key=lambda row: (row.get("gateFailures",
                                                        row.get("constructionFailures", 0)),
                                                row["loss"])) \
        if comparable else None
    previous_loss = float(previous["loss"]) if previous and "loss" in previous else None
    entry = {"run": run_dir.name, "loss": best["loss"], "params": best["params"], "time": time.time(),
             "referenceSet": reference_set,
             "constructionPassed": bool(best.get("construction", {}).get("passed")),
             "constructionFailures": int(best.get("construction", {}).get("counts", {}).get("fail", 0)),
             "tripwirePassed": bool(best.get("tripwires", {}).get("strictPassed")),
             "tripwireFailures": int(
                 sum(row.get("status") == "fail"
                     for row in best.get("tripwires", {}).get("cells", [])) +
                 len(best.get("tripwires", {}).get("strictMissingCells", []))),
             "gateFailures": int(best.get("gateFailures", 0))}
    board["runs"].append(entry)
    board["runs"].sort(key=lambda row: (
        row.get("referenceSet", ""),
        row.get("gateFailures", row.get("constructionFailures", 0)),
        row["loss"]))
    if previous is None:
        current = entry
        improved = True
    else:
        previous_gates = previous.get(
            "gateFailures", previous.get("constructionFailures", 0))
        entry_gates = entry.get("gateFailures", entry.get("constructionFailures", 0))
        improved = (
            entry_gates < previous_gates or
            (entry_gates == previous_gates and
             entry["loss"] < previous["loss"] *
             (1.0 - MEASURABLE_REL_IMPROVEMENT))
        )
        current = entry if improved else previous
    board.setdefault("bestByReferenceSet", {})[reference_set] = current
    board["best"] = current
    board_path.write_text(json.dumps(board, indent=2) + "\n")
    return improved, previous_loss


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
    parser.add_argument("--initial", required=True, help="initial/pinned preset JSON")
    parser.add_argument("--references", required=True, help="reference-note manifest JSON")
    parser.add_argument("--manifest", default=str(Path(__file__).with_name("manifest.json")))
    parser.add_argument("--keys", help="comma-separated free keys; default is every applicable continuous key")
    parser.add_argument("--budget", type=int, default=200)
    parser.add_argument("--run", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--limiting-factor", help="evidenced plateau cause when this run neither improves nor reaches the floor")
    parser.add_argument("--work-item", help="concrete fix to file for --limiting-factor")
    parser.add_argument("--controllability",
                        help="hashed controllability.json; defaults to the campaign audit")
    parser.add_argument("--repo-root", type=Path, default=ROOT,
                        help="engine checkout used for headless renders")
    args = parser.parse_args(argv)
    initial, references, manifest = _load(args.initial), _load(args.references), _load(args.manifest)
    # T-012 consuming-side assertion: an owner-rejected take must never be
    # scored, floored, or hashed into the objective id.
    from .exclusions import assert_no_excluded
    assert_no_excluded(references, f"{args.instrument} campaign manifest")
    if bool(args.limiting_factor) != bool(args.work_item):
        parser.error("--limiting-factor and --work-item must be supplied together")
    starting_weights = weights_for_instrument(args.instrument)
    only = list(dict.fromkeys(key.strip() for key in args.keys.split(",") if key.strip())) if args.keys else None
    free = _params(manifest, initial, only)
    if not free:
        raise SystemExit("no applicable free parameters")
    audit_path = (Path(args.controllability) if args.controllability else
                  DEFAULT_RUN_ROOT / "campaigns" / args.instrument /
                  "audit" / "controllability.json")
    controllability = _consume_controllability_audit(
        audit_path, args.instrument, references, free, starting_weights)
    scoring_weights = controllability["finalWeights"]
    variability = _reference_variability(
        references, weights=scoring_weights)
    run_dir = DEFAULT_RUN_ROOT / args.instrument / args.run
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "run.json").write_text(
        json.dumps(vars(args), indent=2, default=str) + "\n")
    matcher = ToneMatcher(args.instrument, initial, references, free, run_dir,
                          repo_root=args.repo_root, weights=scoring_weights,
                          variability=variability)
    x0 = np.asarray([p.default for p in free])
    bounds = [(p.lo, p.hi) for p in free]
    matcher.evaluate(x0, retain_audio=True)
    baseline = matcher.evaluations[0]["loss"]
    baseline_floor = _floor_evidence(variability, matcher.best or matcher.evaluations[0])
    if baseline_floor["status"] == "demonstrated":
        result = SimpleNamespace(success=True,
                                 message="baseline is at the reference-variability floor")
    else:
        result = minimize(matcher.evaluate, x0, method="Powell", bounds=bounds,
                          options={"maxfev": max(1, args.budget - 1), "ftol": .01, "xtol": .002})
    best = matcher.best or {"loss": baseline, "params": initial}
    sensitivity = {} if args.skip_sensitivity else _sensitivity(matcher, best)
    best = matcher.best or best
    (run_dir / "sensitivity.json").write_text(json.dumps(sensitivity, indent=2) + "\n")
    resource = _benchmark_resources(run_dir, args.instrument, best)
    render_artifacts = _build_listening_page(run_dir, args.instrument, best, references)
    reference_set = _reference_set_id(
        references, args.instrument, weights=scoring_weights)
    improved, previous_best_loss = _update_leaderboard(args.instrument, run_dir, best, reference_set)
    if improved:
        _append_ledger(args.instrument, run_dir, best, sensitivity, free)
    floor = _floor_evidence(variability, best)
    relative_improvement = ((baseline - best["loss"]) / max(abs(baseline), 1e-12))
    measurable_loss_improvement = (
        improved and relative_improvement >= MEASURABLE_REL_IMPROVEMENT)
    gate_improvement = (
        improved and previous_best_loss is not None and
        not measurable_loss_improvement)
    if floor["status"] == "demonstrated":
        outcome = {"state": "reference-variability-floor"}
    elif gate_improvement:
        outcome = {"state": "gate-improvement"}
    elif measurable_loss_improvement:
        outcome = {"state": "improvement"}
    elif args.limiting_factor and args.work_item:
        item_path = _file_work_item(args.instrument, run_dir, args.limiting_factor, args.work_item)
        outcome = {"state": "limiting-factor", "limitingFactor": args.limiting_factor,
                   "workItem": args.work_item, "workItemFile": str(item_path)}
    else:
        outcome = {"state": "invalid-stop",
                   "reason": "no leaderboard improvement, floor demonstration, or filed limiting factor"}
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
               "exchangeStatuses": _technique_exchange_statuses(),
               "leaderboardState": {"isLeader": improved,
                                    "previousBestLoss": previous_best_loss},
               "renderArtifacts": render_artifacts,
               "sessionOutcome": outcome}
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    _write_run_report(run_dir / "RUN_REPORT.md", summary)
    print(json.dumps({"runDir": str(run_dir), **summary}, indent=2))
    return 2 if outcome["state"] == "invalid-stop" else 0


if __name__ == "__main__":
    raise SystemExit(main())
