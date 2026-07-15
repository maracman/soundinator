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
import json
import math
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from scipy.optimize import minimize

from .assertions import ConstructionSample, evaluate_construction
from .score import extract_features, score_files, write_report

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RUN_ROOT = Path("/private/tmp/sg2")


@dataclass
class FreeParam:
    key: str
    lo: float
    hi: float
    default: float


def _load(path: str | Path) -> Any:
    return json.loads(Path(path).read_text())


def _params(manifest: dict, initial: dict, only: set[str] | None) -> list[FreeParam]:
    result = []
    excitation = initial.get("excitationType")
    family = initial.get("sg2Family")
    for row in manifest["continuous"]:
        if only and row["key"] not in only:
            continue
        applies = row.get("appliesTo")
        if applies and excitation not in applies and family not in applies:
            continue
        result.append(FreeParam(row["key"], float(row["min"]), float(row["max"]),
                                float(initial.get(row["key"], row["default"]))))
    return result


class ToneMatcher:
    def __init__(self, instrument: str, initial: dict, references: list[dict], free: list[FreeParam], run_dir: Path):
        self.instrument, self.initial, self.references, self.free = instrument, initial, references, free
        self.run_dir = run_dir
        self.evaluations: list[dict] = []
        self.best: dict | None = None

    def decode(self, values: np.ndarray) -> dict:
        params = dict(self.initial)
        for spec, value in zip(self.free, values):
            params[spec.key] = float(np.clip(value, spec.lo, spec.hi))
        return params

    def evaluate(self, values: np.ndarray, *, retain_audio: bool = False) -> float:
        params = self.decode(values)
        index = len(self.evaluations)
        target = self.run_dir / "renders" / f"eval-{index:04d}"
        target.mkdir(parents=True, exist_ok=True)
        params_path = target / "params.json"
        params_path.write_text(json.dumps(params, indent=2) + "\n")
        jobs = []
        for ref_index, ref in enumerate(self.references):
            jobs.append({"paramsFile": str(params_path), "midi": ref.get("midi", 60),
                         "velocity": ref.get("velocity", .62), "durationSec": ref.get("durationSec", 1.5),
                         "sampleRate": ref.get("sampleRate", 48000), "out": str(target / f"note-{ref_index}.wav")})
        jobs_path = target / "jobs.json"
        jobs_path.write_text(json.dumps(jobs))
        process = subprocess.run(["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
                                 cwd=ROOT, text=True, capture_output=True)
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)
        scores = [score_files(ref["path"], job["out"], instrument=self.instrument, params=params,
                              context={"register": ref.get("register"), "dynamic": ref.get("dynamic"),
                                       "velocity": ref.get("velocity")})
                  for ref, job in zip(self.references, jobs)]
        construction_samples = [
            ConstructionSample(render=extract_features(job["out"]), reference=extract_features(ref["path"]),
                               register=ref.get("register"), dynamic=ref.get("dynamic"),
                               velocity=ref.get("velocity"))
            for ref, job in zip(self.references, jobs)
        ]
        construction = evaluate_construction(self.instrument, construction_samples, params=params,
                                             strict_evidence=True)
        loss = float(np.mean([row["composite"] for row in scores]))
        # Construction is a hard gate, not another feature that a low
        # composite can average away.  The large objective penalty guides
        # Powell back into a valid topology while reports retain raw loss.
        gate_penalty = 100.0 * construction["counts"]["fail"]
        objective = loss + gate_penalty
        record = {"evaluation": index, "loss": loss, "params": {p.key: params[p.key] for p in self.free},
                  "objective": objective, "construction": construction, "scores": scores}
        self.evaluations.append(record)
        (self.run_dir / "loss_curve.json").write_text(json.dumps(self.evaluations, indent=2) + "\n")
        if self.best is None or (construction["counts"]["fail"], loss) < (self.best["construction"]["counts"]["fail"], self.best["loss"]):
            self.best = {"loss": loss, "objective": objective, "params": params, "evaluation": index,
                         "construction": construction, "scores": scores}
            (self.run_dir / "best.json").write_text(json.dumps(self.best, indent=2) + "\n")
        if not retain_audio and self.best and self.best["evaluation"] != index:
            for job in jobs:
                Path(job["out"]).unlink(missing_ok=True)
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
            losses.append(matcher.evaluations[-1]["loss"])
        rows[spec.key] = {"minus": losses[0], "plus": losses[1],
                          "increase": float(np.mean(losses) - best["loss"])}
    return rows


def _update_leaderboard(instrument: str, run_dir: Path, best: dict) -> bool:
    board_path = DEFAULT_RUN_ROOT / instrument / "leaderboard.json"
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board = _load(board_path) if board_path.exists() else {"instrument": instrument, "runs": []}
    entry = {"run": run_dir.name, "loss": best["loss"], "params": best["params"], "time": time.time()}
    board["runs"].append(entry)
    board["runs"].sort(key=lambda row: row["loss"])
    improved = board["runs"][0]["run"] == run_dir.name
    board["best"] = board["runs"][0]
    board_path.write_text(json.dumps(board, indent=2) + "\n")
    return improved


def _append_ledger(instrument: str, run_dir: Path, best: dict, sensitivity: dict) -> None:
    ledger = ROOT / "docs" / "SG2_PARAM_LEDGER.md"
    if not ledger.exists():
        ledger.write_text("# Sound Generator 2.0 parameter ledger\n\nDerived by `scripts/tone_match/iterate.py`; lower loss is better.\n\n")
    rows = [f"\n## {instrument} — {run_dir.name}\n\nComposite loss: `{best['loss']:.6f}`\n\n| Parameter | Fitted | ±10% sensitivity |\n|---|---:|---:|\n"]
    for key, value in sorted(best["params"].items()):
        if key in sensitivity:
            rows.append(f"| `{key}` | {value!s} | {sensitivity[key]['increase']:.6f} |\n")
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
    args = parser.parse_args(argv)
    initial, references, manifest = _load(args.initial), _load(args.references), _load(args.manifest)
    only = set(args.keys.split(",")) if args.keys else None
    free = _params(manifest, initial, only)
    if not free:
        raise SystemExit("no applicable free parameters")
    run_dir = DEFAULT_RUN_ROOT / args.instrument / args.run
    run_dir.mkdir(parents=True, exist_ok=False)
    (run_dir / "run.json").write_text(json.dumps(vars(args), indent=2) + "\n")
    matcher = ToneMatcher(args.instrument, initial, references, free, run_dir)
    x0 = np.asarray([p.default for p in free])
    bounds = [(p.lo, p.hi) for p in free]
    matcher.evaluate(x0, retain_audio=True)
    baseline = matcher.evaluations[0]["loss"]
    result = minimize(matcher.evaluate, x0, method="Powell", bounds=bounds,
                      options={"maxfev": max(1, args.budget - 1), "ftol": .01, "xtol": .002})
    best = matcher.best or {"loss": baseline, "params": initial}
    sensitivity = {} if args.skip_sensitivity else _sensitivity(matcher, best)
    (run_dir / "sensitivity.json").write_text(json.dumps(sensitivity, indent=2) + "\n")
    improved = _update_leaderboard(args.instrument, run_dir, best)
    if improved:
        _append_ledger(args.instrument, run_dir, best, sensitivity)
    summary = {"baselineLoss": baseline, "bestLoss": best["loss"], "improvement": baseline - best["loss"],
               "evaluations": len(matcher.evaluations), "optimizer": {"success": bool(result.success), "message": str(result.message)},
               "leaderboardImproved": improved}
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"runDir": str(run_dir), **summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
