#!/usr/bin/env python3
"""Cumulatively apply T-078 to declared blown spectral cells.

The runner keeps the shipping preset as the durable candidate, but measures
and selects corrections only through deterministic FIT-mode renders.  Each
accepted step changes exactly one existing register/dynamic source row; body
bands and the independent air-level surface are immutable throughout.
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
from typing import Any

from scripts.tone_match.blown_octave_residual import (
    SCHEMA,
    apply_residual_to_params,
    extract_stable_residual_files,
)
from scripts.tone_match.iterate import _mode_params, FIT_MODE
from scripts.tone_match.score import band_balance_report, extract_features


SWEEP_SCHEMA = "sg2-blown-post-source-air-octave-sweep-v1"


def _sha_bytes(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def _midi_f0(midi: float) -> float:
    return 440.0 * 2 ** ((float(midi) - 69.0) / 12.0)


def _materialise_surface(params: dict[str, Any], handoff: dict[str, Any],
                         instrument: str) -> dict[str, Any]:
    result = copy.deepcopy(params)
    if isinstance(result.get("spectralPartialsByRegisterDynamic"), dict):
        return result
    table = handoff.get("instruments", {}).get(instrument)
    if not isinstance(table, dict) or not isinstance(table.get("rows"), list):
        raise ValueError(f"source handoff has no rows for {instrument!r}")
    result["spectralPartialsByRegisterDynamic"] = {
        "schemaVersion": handoff.get("schemaVersion", 1),
        "handoff": handoff.get("handoff", "BLOWN-SUSTAIN-01"),
        "evidenceSha256": handoff.get("evidenceSha256"),
        "interpolation": handoff.get(
            "interpolationContract",
            "log-f0 x velocity; clamp outside measured hull"),
        "rows": copy.deepcopy(table["rows"]),
    }
    return result


def _render(repo_root: Path, params: dict[str, Any], reference: dict[str, Any],
            out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    params_path = out.with_suffix(".params.json")
    params_path.write_text(json.dumps(params, indent=2) + "\n")
    python = os.environ.get("PYTHON")
    env = dict(os.environ)
    if python:
        env["PYTHON"] = python
    process = subprocess.run([
        "node", "scripts/render_note.mjs", "--params", str(params_path),
        "--midi", str(reference["midi"]),
        "--velocity", str(reference.get("velocity", .62)),
        "--duration", str(reference.get("durationSec", 1.5)),
        "--sample-rate", str(reference.get("sampleRate", 48000)),
        "--out", str(out),
    ], cwd=repo_root, env=env, capture_output=True, text=True, timeout=1800)
    if process.returncode:
        raise RuntimeError(process.stderr[-2000:] or process.stdout[-2000:])


def _balance(reference: dict[str, Any], render: Path) -> dict[str, Any]:
    f0 = float(reference.get("expectedF0Hz") or _midi_f0(reference["midi"]))
    ref = extract_features(reference["path"], expected_f0_hz=f0,
                           trust_expected_f0=True)
    sounded = extract_features(
        render, active_duration_s=reference.get("durationSec"),
        expected_f0_hz=f0, trust_expected_f0=True)
    return band_balance_report(ref, sounded)


def _candidate_rank(row: dict[str, Any]) -> tuple[float, ...]:
    balance = row["balance"]
    passed = balance.get("status") == "measured" and \
        balance["meanDb"] <= 3.0 and balance["maxOctaveDb"] <= 6.0
    return (
        0.0 if passed else 1.0,
        float(balance.get("meanDb") or math.inf) / 3.0 +
        float(balance.get("maxOctaveDb") or math.inf) / 6.0,
        float(balance.get("meanDb") or math.inf),
        float(balance.get("maxOctaveDb") or math.inf),
        -float(row["gain"]),
    )


def run_sweep(*, instrument: str, initial: dict[str, Any],
              references: list[dict[str, Any]], source_handoff: dict[str, Any],
              synthetic: dict[str, Any], output: Path, repo_root: Path,
              gains: list[float], selected_cells: set[str] | None = None,
              cap_db: float = 3.0) -> dict[str, Any]:
    if synthetic.get("schema") != SCHEMA or synthetic.get("status") != "pass":
        raise ValueError("T-078 synthetic evidence is absent, stale, or failing")
    current = _materialise_surface(initial, source_handoff, instrument)
    initial_body = copy.deepcopy(current.get("bodyBands"))
    initial_air = copy.deepcopy(current.get("windBreathLevelByRegisterDynamic"))
    rows = []
    seen = set()
    spectral = []
    for ref in references:
        cell = f"{ref.get('register')}/{ref.get('dynamic')}"
        if "spectral" not in ref.get("roles", []) or cell in seen:
            continue
        seen.add(cell)
        if selected_cells is None or cell in selected_cells:
            spectral.append((cell, ref))

    for sequence, (cell, ref) in enumerate(spectral, start=1):
        register, dynamic = cell.split("/", 1)
        cell_dir = output / f"{sequence:02d}-{register}-{dynamic}"
        fit_current = _mode_params(current, FIT_MODE)
        baseline_wav = cell_dir / "baseline.wav"
        _render(repo_root, fit_current, ref, baseline_wav)
        baseline_balance = _balance(ref, baseline_wav)
        f0 = float(ref.get("expectedF0Hz") or _midi_f0(ref["midi"]))
        try:
            evidence = extract_stable_residual_files(
                Path(ref["path"]), baseline_wav, f0_hz=f0,
                active_duration_s=ref.get("durationSec"))
        except ValueError as exc:
            rows.append({
                "cell": cell, "status": "not-applicable",
                "reason": str(exc), "baseline": baseline_balance,
            })
            continue
        evidence["syntheticRoundtrip"] = {
            "schema": synthetic["schema"], "status": synthetic["status"],
            "sha256": _sha_bytes(synthetic),
        }
        (cell_dir / "evidence.json").write_text(
            json.dumps(evidence, indent=2) + "\n")
        if evidence.get("status") != "pass":
            rows.append({
                "cell": cell, "status": "not-applicable",
                "reason": "no stable source-addressable octave band",
                "baseline": baseline_balance,
            })
            continue

        candidates = []
        for gain in gains:
            ship_candidate, audit = apply_residual_to_params(
                current, evidence, register=register, dynamic=dynamic,
                gain=gain, cap_db=cap_db)
            candidate_path = cell_dir / f"candidate-{gain:g}.json"
            candidate_path.write_text(json.dumps(ship_candidate, indent=2) + "\n")
            render_path = cell_dir / f"candidate-{gain:g}.wav"
            _render(repo_root, _mode_params(ship_candidate, FIT_MODE), ref, render_path)
            candidates.append({
                "gain": gain, "balance": _balance(ref, render_path),
                "application": audit, "params": ship_candidate,
                "paramsSha256": _sha_bytes(ship_candidate),
            })
        improving = [row for row in candidates
                     if row["balance"].get("status") == "measured" and
                     row["balance"]["meanDb"] < baseline_balance["meanDb"] and
                     row["balance"]["maxOctaveDb"] < baseline_balance["maxOctaveDb"]]
        if not improving:
            rows.append({
                "cell": cell, "status": "rejected-no-two-sided-improvement",
                "baseline": baseline_balance,
                "candidates": [{k: v for k, v in row.items() if k != "params"}
                               for row in candidates],
            })
            continue
        selected = min(improving, key=_candidate_rank)
        current = selected["params"]
        rows.append({
            "cell": cell,
            "status": "accepted-pass" if _candidate_rank(selected)[0] == 0
            else "accepted-improvement",
            "baseline": baseline_balance,
            "selected": {k: v for k, v in selected.items() if k != "params"},
            "candidates": [{k: v for k, v in row.items() if k != "params"}
                           for row in candidates],
        })

    if current.get("bodyBands") != initial_body:
        raise AssertionError("T-078 sweep changed body bands")
    if current.get("windBreathLevelByRegisterDynamic") != initial_air:
        raise AssertionError("T-078 sweep changed the air-level surface")
    output.mkdir(parents=True, exist_ok=True)
    final_path = output / "selected-cumulative.json"
    final_path.write_text(json.dumps(current, indent=2) + "\n")
    summary = {
        "schema": SWEEP_SCHEMA,
        "instrument": instrument,
        "status": "complete",
        "syntheticStatus": synthetic["status"],
        "syntheticSha256": _sha_bytes(synthetic),
        "initialSha256": _sha_bytes(initial),
        "selectedSha256": _sha_bytes(current),
        "selectedPath": str(final_path.resolve()),
        "bodyChanged": False,
        "airSurfaceChanged": False,
        "cells": rows,
    }
    (output / "sweep-summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--initial", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--source-handoff", type=Path, required=True)
    parser.add_argument("--synthetic-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    parser.add_argument("--gains", default="0.25,0.5,0.75,1")
    parser.add_argument("--cells", help="comma-separated register/dynamic cells")
    parser.add_argument("--cap-db", type=float, default=3.0)
    args = parser.parse_args()
    summary = run_sweep(
        instrument=args.instrument,
        initial=json.loads(args.initial.read_text()),
        references=json.loads(args.references.read_text()),
        source_handoff=json.loads(args.source_handoff.read_text()),
        synthetic=json.loads(args.synthetic_evidence.read_text()),
        output=args.output.resolve(), repo_root=args.repo_root.resolve(),
        gains=[float(value) for value in args.gains.split(",")],
        selected_cells=set(args.cells.split(",")) if args.cells else None,
        cap_db=args.cap_db,
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
