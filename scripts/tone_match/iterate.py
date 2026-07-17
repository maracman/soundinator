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
import subprocess
import tempfile
import time
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import numpy as np
from scipy.optimize import minimize

from .assertions import ConstructionSample, evaluate_construction
from .audition import build as build_audition
from .controllability import objective_contract_hash, manifest_contract_hash
from .paths import sg2_data_root
from .legacy_prior import ship_mode_params
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


def _renderer_contract_hash() -> str:
    digest = hashlib.sha256()
    for relative in RENDERER_CONTRACT_FILES:
        path = ROOT / relative
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
                        "piano", "grand-piano", "upright-piano", "guitar",
                        "guitar-nylon", "guitar-steel", "harp", "glockenspiel",
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


def _build_listening_page(run_dir: Path, instrument: str, best: dict[str, Any],
                          references: list[dict[str, Any]],
                          ship_params: dict[str, Any]) -> dict[str, Any]:
    """Render a fresh-seeded ship performance; never expose fit-mode audio."""
    render_dir = run_dir / "ship-renders"
    render_dir.mkdir(parents=True, exist_ok=True)
    seed_base = time.time_ns() & 0x7fffffff
    jobs = []
    for index, reference in enumerate(references):
        params = deepcopy(ship_params)
        params["seed"] = seed_base + index * 7919
        jobs.append({
            "params": params,
            "midi": reference.get("midi", 60),
            "velocity": reference.get("velocity", .62),
            "durationSec": reference.get("durationSec", 1.5),
            "sampleRate": reference.get("sampleRate", 48000),
            "out": str(render_dir / f"note-{index}.wav"),
        })
    jobs_path = render_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    process = subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=ROOT, text=True, capture_output=True)
    if process.returncode:
        raise RuntimeError(process.stderr or process.stdout)
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
            "auditionManifest": str(manifest_path), "mode": "ship",
            "freshSeedBase": seed_base}


def _technique_exchange_statuses(lane: str = "struck/plucked") -> list[dict[str, str]]:
    path = ROOT / "docs" / "sg2" / "TECHNIQUES_EXCHANGE.md"
    if not path.exists():
        return [{"id": "exchange", "title": "techniques exchange",
                 "lane": "FAIL: file missing from branch"}]
    import re
    statuses = []
    chunks = re.split(r"(?=^### T-\d+ · )", path.read_text(), flags=re.MULTILINE)
    for chunk in chunks:
        heading = re.match(r"^### (T-\d+) · ([^\n]+)", chunk)
        if not heading:
            continue
        matches = re.findall(
            rf"{re.escape(lane)}=([^\n]+)", chunk, flags=re.IGNORECASE)
        status = matches[-1].strip() if matches else "missing — lane disposition required"
        statuses.append({"id": heading.group(1), "title": heading.group(2),
                         "lane": status})
    return statuses


def _write_run_report(path: Path, summary: dict[str, Any]) -> None:
    floor = summary["referenceVariabilityFloor"]
    prior = summary.get("legacyPrior", {})
    lines = [f"# SG2 run report — {summary['instrument']} / {summary['run']}\n\n",
             f"Session outcome: **{summary['sessionOutcome']['state']}**  \n",
             f"Baseline loss: `{summary['baselineLoss']:.6f}`  \n",
             f"Best loss: `{summary['bestLoss']:.6f}`  \n",
             f"Improvement: `{summary['improvement']:.6f}`  \n",
             f"Construction gate: `{'pass' if summary['constructionPassed'] else 'fail'}`  \n",
             f"§3 tripwire gate: `{'pass' if summary.get('tripwirePassed', summary.get('automatedGatePassed')) else 'fail'}`  \n",
             f"Reference-variability status: `{floor['status']}`\n\n",
             "## §2.4c strongest prior\n\n",
             f"Prior row: `{prior.get('row', 'missing')}`  \n",
             f"Anchor: `{prior.get('tag', 'missing')}` / `{prior.get('commit', 'missing')}`  \n",
             f"Resolved parameter hash: `{prior.get('resolvedHash', 'missing')}`  \n",
             f"Fit mode Human: `{summary.get('fitModeHuman')}`; ship mode Human: "
             f"`{summary.get('shipModeHuman')}`.\n\n",
             "Legacy leaderboard baseline: **" +
             ("PASS" if summary.get("candidateBeatsLegacy") else "FAIL") +
             f"** (legacy `{summary.get('legacyBaselineLoss')}`, candidate "
             f"`{summary['bestLoss']:.6f}`).\n\n"]
    controllability = summary.get("controllability")
    if controllability:
        lines.extend(["## Controllability contract\n\n",
                      f"Objective/reference hash: `{controllability.get('objectiveHash') or controllability.get('referenceContractHash')}`  \n",
                      f"Manifest hash: `{controllability.get('manifestHash') or controllability.get('parameterManifestHash')}`  \n",
                      f"Verdict: `{'CLEAN' if controllability.get('clean', controllability.get('status') == 'clean') else 'NOT CLEAN'}`\n\n",
                      "| Feature | Weight | Responsive parameters | Status |\n",
                      "|---|---:|---|---|\n"])
        verdicts = controllability.get("verdicts") or [
            {"feature": feature, "weight": weight,
             "status": ("watch-metric" if float(weight) == 0 else "controllable")}
            for feature, weight in controllability.get("weights", {}).items()
        ]
        responsive = (controllability.get("responsiveParameters") or
                      controllability.get("responders") or {})
        for verdict in verdicts:
            responders = responsive.get(verdict["feature"], [])
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
    lines.extend(["\n## Techniques exchange statuses (generated live)\n\n",
                  "| Entry | Struck/plucked status |\n|---|---|\n"])
    for row in summary.get("exchangeStatuses", []):
        lines.append(f"| `{row['id']}` {row['title']} | {row['lane']} |\n")
    board = summary["leaderboardState"]
    variation = summary.get("distributionalVariationGate", {})
    lines.extend(["\n## Leaderboard state\n\n",
                  f"Reference set: `{summary['referenceSet']}`. Current run is "
                  f"**{'leader' if board['isLeader'] else 'not leader'}**; "
                  f"previous comparable best: `{board.get('previousBestLoss')}`; "
                  f"current loss: `{summary['bestLoss']:.6f}`.\n",
                  "Leaderboard row 1: `legacy-baseline` (ship mode).\n",
                  "\n## Distributional variation / freeze gate\n\n",
                  f"Status: **{variation.get('status', 'missing')}**.  \n",
                  f"{variation.get('reason', 'No variation-gate evidence recorded.')}\n",
                  "\n## Owner render directories\n\n",
                  f"Best renders: `{summary['renderArtifacts']['bestRenderDirectory']}`  \n",
                  f"Listening page: `{summary['renderArtifacts']['listeningPage']}`  \n",
                  f"Manifest: `{summary['renderArtifacts']['auditionManifest']}`  \n",
                  f"Mode: `{summary['renderArtifacts'].get('mode', 'missing')}`; "
                  f"fresh seed base: "
                  f"`{summary['renderArtifacts'].get('freshSeedBase', 'missing')}`.\n"])
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
        # Struck/plucked lane (pass05): impulsive references are analysed
        # with a trusted expected f0 and forced-percussive segmentation so a
        # damped low course cannot be mis-tracked as sustained.
        struck = (params.get("sg2Family") == "struck-plucked" or
                  (self.instrument or "").strip().lower() in {
                      "piano", "grand-piano", "upright-piano", "guitar",
                      "guitar-nylon", "guitar-steel", "harp", "glockenspiel"})
        for ref_index, (ref, job) in enumerate(zip(self.references, jobs)):
            analysis_kwargs = {}
            if struck:
                analysis_kwargs = {
                    "expected_f0_hz": 440.0 * 2 ** (
                        (float(ref.get("midi", 60)) - 69) / 12),
                    "trust_expected_f0": True,
                    "force_percussive": True,
                }
            reference_bundle = extract_features(ref["path"], **analysis_kwargs)
            try:
                render_bundle = extract_features(
                    job["out"], active_duration_s=ref.get(
                        "durationSec", 1.5), **analysis_kwargs)
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
                      weights: dict[str, float] | None = None,
                      prior_hash: str | None = None) -> str:
    """Identify the scored objective so unlike manifests are never ranked."""
    objective = {
        "references": references,
        "weights": weights or weights_for_instrument(instrument),
        "priorHash": prior_hash,
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
                                   manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"missing controllability audit: {path}")
    audit = _load(path)
    # The merged struck lane uses the identity-bound schema-v3 contract.  Keep
    # the earlier schema-v2 consumer below for other in-flight campaigns.
    if int(audit.get("schemaVersion", 0)) >= 3 and isinstance(audit.get("weights"), dict):
        if initial is None or manifest is None:
            raise ValueError("schema-v3 controllability requires initial preset and manifest")
        from .controllability import validate_audit_contract
        validate_audit_contract(
            audit, instrument=instrument, references=references,
            manifest=manifest, initial=initial)
        return audit
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


def _write_leaderboard_copies(instrument: str, board: dict[str, Any]) -> None:
    for path in (DEFAULT_RUN_ROOT / instrument / "leaderboard.json",
                 STATE_ROOT / instrument / "leaderboard.json"):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(board, indent=2) + "\n")


def _ensure_legacy_baseline(instrument: str, baseline: dict[str, Any],
                            ship_params: dict[str, Any], reference_set: str,
                            prior: dict[str, Any]) -> dict[str, Any]:
    """Make the table-selected legacy prior the immutable founding row."""
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board = _load(board_path) if board_path.exists() else {"instrument": instrument, "runs": []}
    prior_hash = prior.get("resolvedHash")
    existing = next((row for row in board.get("runs", [])
                     if row.get("entryType") == "legacy-baseline" and
                     row.get("referenceSet") == reference_set and
                     row.get("priorHash") == prior_hash), None)
    if existing is None:
        tripwires = baseline.get("tripwires", {})
        existing = {
            "run": "legacy-baseline", "entryType": "legacy-baseline",
            "mode": "ship", "loss": float(baseline["loss"]),
            "params": deepcopy(ship_params),
            "fitParams": deepcopy(baseline.get("params", {})),
            "referenceSet": reference_set, "priorHash": prior_hash,
            "priorRow": prior.get("row"), "time": time.time(),
            "constructionPassed": bool(baseline.get("construction", {}).get("passed")),
            "constructionFailures": int(baseline.get("construction", {}).get("counts", {}).get("fail", 0)),
            "tripwirePassed": bool(tripwires.get("strictPassed")),
            "tripwireFailures": int(
                sum(row.get("status") == "fail" for row in tripwires.get("cells", [])) +
                len(tripwires.get("strictMissingCells", []))),
            "gateFailures": int(baseline.get("gateFailures", 0)),
        }
        # Row 1 is a contract, so historical pre-§2.4c entries follow it and
        # are never silently treated as comparable ship candidates.
        board["runs"] = [existing, *board.get("runs", [])]
    board.setdefault("bestByReferenceSet", {}).setdefault(reference_set, existing)
    board["best"] = board["bestByReferenceSet"][reference_set]
    _write_leaderboard_copies(instrument, board)
    return existing


def _update_leaderboard(instrument: str, run_dir: Path, best: dict,
                        reference_set: str, *, persist: bool = True,
                        ship_params: dict[str, Any] | None = None,
                        prior: dict[str, Any] | None = None) -> tuple[bool, float | None]:
    """Compare a candidate with the board, optionally recording it.

    Invalid stops and filed plateaus must not become fitted presets merely
    because they reduce a hard-gate failure count while worsening raw error.
    Callers preview first, classify the session, then persist accepted runs.
    """
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board = _load(board_path) if board_path.exists() else {"instrument": instrument, "runs": []}
    prior_hash = (prior or {}).get("resolvedHash")
    comparable = [row for row in board.get("runs", [])
                  if row.get("referenceSet") == reference_set and
                  (prior_hash is None or row.get("priorHash") == prior_hash)]
    previous = min(comparable, key=lambda row: (row.get("gateFailures",
                                                        row.get("constructionFailures", 0)),
                                                row["loss"])) \
        if comparable else None
    previous_loss = float(previous["loss"]) if previous and "loss" in previous else None
    entry = {"run": run_dir.name, "loss": best["loss"],
             "params": deepcopy(ship_params or best["params"]),
             "fitParams": deepcopy(best["params"]), "mode": "ship",
             "priorHash": prior_hash, "priorRow": (prior or {}).get("row"),
             "time": time.time(),
             "referenceSet": reference_set,
             "constructionPassed": bool(best.get("construction", {}).get("passed")),
             "constructionFailures": int(best.get("construction", {}).get("counts", {}).get("fail", 0)),
             "tripwirePassed": bool(best.get("tripwires", {}).get("strictPassed")),
             "tripwireFailures": int(
                 sum(row.get("status") == "fail"
                     for row in best.get("tripwires", {}).get("cells", [])) +
                 len(best.get("tripwires", {}).get("strictMissingCells", []))),
             "gateFailures": int(best.get("gateFailures", 0))}
    if previous is None:
        current = entry
        improved = True
    else:
        previous_gates = previous.get(
            "gateFailures", previous.get("constructionFailures", 0))
        entry_gates = entry.get("gateFailures", entry.get("constructionFailures", 0))
        legacy = next((row for row in comparable
                       if row.get("entryType") == "legacy-baseline"), None)
        beats_legacy = legacy is None or entry["loss"] < float(legacy["loss"]) * (
            1.0 - MEASURABLE_REL_IMPROVEMENT)
        improved = beats_legacy and (
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
        _write_leaderboard_copies(instrument, board)
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
    parser.add_argument("--initial", required=True, help="initial/pinned preset JSON")
    parser.add_argument("--ship-prior",
                        help="ship-mode legacy prior (defaults beside --initial)")
    parser.add_argument("--references", required=True, help="reference-note manifest JSON")
    parser.add_argument("--manifest", default=str(Path(__file__).with_name("manifest.json")))
    parser.add_argument("--controllability", help="clean audit JSON for this exact instrument/reference/manifest")
    parser.add_argument("--keys", help="comma-separated free keys; default is every applicable continuous key")
    parser.add_argument("--budget", type=int, default=200)
    parser.add_argument("--run", default=time.strftime("%Y%m%d-%H%M%S"))
    parser.add_argument("--skip-sensitivity", action="store_true")
    parser.add_argument("--limiting-factor", help="evidenced plateau cause when this run neither improves nor reaches the floor")
    parser.add_argument("--work-item", help="concrete fix to file for --limiting-factor")
    parser.add_argument("--repo-root", type=Path, default=ROOT,
                        help="engine checkout used for headless renders")
    args = parser.parse_args(argv)
    initial = _load_preset(args.initial)
    ship_path = (Path(args.ship_prior) if args.ship_prior else
                 Path(args.initial).with_name("ship-prior.json"))
    if not ship_path.exists():
        raise ValueError(f"missing mandatory ship-mode prior: {ship_path}")
    ship_prior = _load_preset(ship_path)
    prior = ship_prior.get("_sg2Prior")
    if not isinstance(prior, dict) or not prior.get("resolvedHash"):
        raise ValueError(f"{ship_path}: missing resolved §2.4c prior provenance")
    if float(ship_prior.get("excitationHuman", 0) or 0) <= 0:
        raise ValueError("ship-mode Human 0 is a defect")
    if initial.get("_sg2Mode") != "fit" or ship_prior.get("_sg2Mode") != "ship":
        raise ValueError("initial/ship prior mode contract is missing")
    references, manifest = _load(args.references), _load(args.manifest)
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
                  SG2_DATA_ROOT / "campaigns" / args.instrument /
                  "audit" / "controllability.json")
    controllability = _consume_controllability_audit(
        audit_path, args.instrument, references, free, starting_weights,
        initial=initial, manifest=manifest)
    scoring_weights = controllability.get("weights") or controllability["finalWeights"]
    variability = _reference_variability(
        references, weights=scoring_weights, instrument=args.instrument)
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
    baseline_best = deepcopy(matcher.best or matcher.evaluations[0])
    reference_set = _reference_set_id(
        references, args.instrument, weights=scoring_weights,
        prior_hash=prior["resolvedHash"])
    legacy_entry = _ensure_legacy_baseline(
        args.instrument, baseline_best, ship_prior, reference_set, prior)
    baseline_floor = _floor_evidence(variability, baseline_best)
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
    ship_best = ship_mode_params(best["params"], ship_prior)
    resource_best = {**best, "params": ship_best}
    resource = _benchmark_resources(run_dir, args.instrument, resource_best)
    render_artifacts = _build_listening_page(
        run_dir, args.instrument, best, references, ship_best)
    candidate_improved, previous_best_loss = _update_leaderboard(
        args.instrument, run_dir, best, reference_set, persist=False,
        ship_params=ship_best, prior=prior)
    floor = _floor_evidence(variability, best)
    relative_improvement = ((baseline - best["loss"]) / max(abs(baseline), 1e-12))
    measurable_loss_improvement = (
        candidate_improved and relative_improvement >= MEASURABLE_REL_IMPROVEMENT)
    gate_improvement = (
        candidate_improved and previous_best_loss is not None and
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
                   "reason": "no measurable raw composite improvement, floor demonstration, or filed limiting factor"}
    improved = False
    if outcome["state"] in {"improvement", "gate-improvement",
                            "reference-variability-floor"}:
        improved, previous_best_loss = _update_leaderboard(
            args.instrument, run_dir, best, reference_set, persist=True,
            ship_params=ship_best, prior=prior)
        if improved:
            _append_ledger(args.instrument, run_dir, best, sensitivity, free)
            _snapshot_best(args.instrument, run_dir, resource_best)
    candidate_beats_legacy = best["loss"] < float(legacy_entry["loss"]) * (
        1.0 - MEASURABLE_REL_IMPROVEMENT)
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
               "shipParams": ship_best,
               "legacyPrior": prior,
               "legacyBaselineLoss": legacy_entry["loss"],
               "candidateBeatsLegacy": candidate_beats_legacy,
               "fitModeHuman": initial.get("excitationHuman"),
               "shipModeHuman": ship_best.get("excitationHuman"),
               "distributionalVariationGate": {
                   "status": "pending-identity-stability",
                   "reason": "proxy take-pair differential fit has not run; freeze forbidden",
               },
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
