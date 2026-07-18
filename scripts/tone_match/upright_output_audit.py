#!/usr/bin/env python3
"""Render-level audit of the upright piano's evidence-limited anatomy."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any

import numpy as np
import soundfile as sf

from .score import hold_decay_metrics


SAMPLE_RATE = 24000
PRE_ROLL_SEC = .4


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    while isinstance(payload.get("params"), dict):
        payload = payload["params"]
    return payload


def _rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.asarray(samples) ** 2) + 1e-20))


def audit(params_path: Path, output_dir: Path, repo_root: Path) -> dict[str, Any]:
    params_path = params_path.resolve()
    params = _unwrap(json.loads(params_path.read_text()))
    output_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for name, override in (("anatomy", {}),
                           ("anomaly-neutral", {"envelopeAnomalyLevel": 0})):
        jobs.append({
            "params": {**params, **override}, "midi": 69, "velocity": .62,
            "durationSec": 3.0, "sampleRate": SAMPLE_RATE,
            "preRollSec": PRE_ROLL_SEC,
            "out": str((output_dir / f"{name}.wav").resolve()),
        })
    jobs_path = output_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    env = dict(os.environ)
    env["PATH"] = f"{(repo_root / '../../../.venv/bin').resolve()}:{env.get('PATH', '')}"
    subprocess.run(["node", "scripts/render_note.mjs", "--batch",
                    str(jobs_path.resolve())], cwd=repo_root, env=env, check=True)

    audio = {}
    hashes = {}
    for job in jobs:
        path = Path(job["out"])
        samples, rate = sf.read(path, always_2d=True, dtype="float64")
        if rate != SAMPLE_RATE:
            raise RuntimeError(f"unexpected sample rate: {rate}")
        audio[path.stem] = np.mean(samples, axis=1)
        hashes[path.stem] = hashlib.sha256(path.read_bytes()).hexdigest()
    start = round(PRE_ROLL_SEC * SAMPLE_RATE)
    end = start + round(.12 * SAMPLE_RATE)
    anomaly_rms = _rms(audio["anatomy"][start:end] -
                       audio["anomaly-neutral"][start:end])
    hold = hold_decay_metrics(
        audio["anatomy"][start:start + round(3 * SAMPLE_RATE)], SAMPLE_RATE) or {}
    anomaly_rows = params.get("envelopeAnomalyClasses") or []
    action_rows = params.get("preOnsetComponents") or []
    damper_rows = params.get("damperByRegister") or []
    gates = {
        "l16AnomalyConsumer": bool(
            len(anomaly_rows) == 15 and params.get("envelopeAnomalyLevel") == 1 and
            anomaly_rms >= 1e-7 and hashes["anatomy"] != hashes["anomaly-neutral"]),
        "l18FreeDecayHold": bool(
            hold.get("slopeDbPerSecond", 0) <= -.30 and
            hold.get("plateauFraction", 1) < .50),
        "l17BlockedNotInvented": len(action_rows) == 0,
        "l18BlockedDamperFitNotInvented": len(damper_rows) == 0,
    }
    return {
        "schema": "sg2-upright-evidence-limited-output-audit-v1",
        "label": "pass20 upright L16 + L18 free decay (PCM verified; L17/damper blocked)",
        "paramsFile": str(params_path),
        "paramsHash": hashlib.sha256(json.dumps(
            params, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "outputDir": str(output_dir.resolve()),
        "render": {"sampleRate": SAMPLE_RATE, "preRollSec": PRE_ROLL_SEC,
                   "hashes": hashes},
        "evidence": {"anomalyClasses": len(anomaly_rows),
                     "actionComponents": len(action_rows),
                     "damperRows": len(damper_rows),
                     "anomalyOnsetDifferenceRms": anomaly_rms, "hold": hold},
        "gates": gates,
        "passed": all(gates.values()),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    args = parser.parse_args()
    report = audit(args.params, args.output_dir, args.repo_root.resolve())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
