"""Derive a scorer-gated lower-density playback preset after fitting."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .assertions import ConstructionSample, evaluate_construction
from .score import extract_features, score_files

ROOT = Path(__file__).resolve().parents[2]


def _render(params: dict, references: list[dict], directory: Path, label: str) -> list[str]:
    params_path = directory / f"{label}.json"; params_path.write_text(json.dumps(params))
    jobs = []
    for index, ref in enumerate(references):
        out = directory / f"{label}-{index}.wav"
        jobs.append({"paramsFile": str(params_path), "out": str(out), "midi": ref.get("midi", 60),
                     "velocity": ref.get("velocity", .62), "durationSec": ref.get("durationSec", 1.5),
                     "sampleRate": ref.get("sampleRate", 48000)})
    jobs_path = directory / f"{label}-jobs.json"; jobs_path.write_text(json.dumps(jobs))
    result = subprocess.run(["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
                            cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return [job["out"] for job in jobs]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--params", required=True)
    parser.add_argument("--references", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--mel-budget-db", type=float, default=.5)
    parser.add_argument("--min-partials", type=int, default=8)
    args = parser.parse_args()
    full = json.loads(Path(args.params).read_text())
    references = json.loads(Path(args.references).read_text())
    start = int(full.get("spectralPartials", 64))
    history, shipping = [], dict(full)
    with tempfile.TemporaryDirectory(prefix="sg2-compress-") as temp_name:
        temp = Path(temp_name)
        full_wavs = _render(full, references, temp, "full")
        full_scores = [score_files(ref["path"], wav, instrument=args.instrument, params=full)
                       for ref, wav in zip(references, full_wavs)]
        base_mel = float(np.mean([row["features"]["log_mel_db"] for row in full_scores]))

        def assess(candidate: dict, label: str, change: dict) -> dict:
            wavs = _render(candidate, references, temp, label)
            scores = [score_files(ref["path"], wav, instrument=args.instrument, params=candidate)
                      for ref, wav in zip(references, wavs)]
            samples = [
                ConstructionSample(extract_features(
                                       wav, active_duration_s=ref.get("durationSec", 1.5)),
                                   extract_features(ref["path"]),
                                   ref.get("register"), ref.get("dynamic"), ref.get("velocity"))
                for ref, wav in zip(references, wavs)
            ]
            construction = evaluate_construction(args.instrument, samples, params=candidate,
                                                 strict_evidence=True)
            mel = float(np.mean([row["features"]["log_mel_db"] for row in scores]))
            return {**change, "melDistanceDb": mel, "deltaDb": mel - base_mel,
                    "composite": float(np.mean([item["composite"] for item in scores])),
                    "constructionPassed": construction["passed"],
                    "constructionFailures": construction["counts"]["fail"]}

        # First raise the renderer-only audibility floor. This preserves the
        # full measured/register-dependent print and removes the weakest modes
        # wherever they occur, unlike bluntly chopping every high harmonic.
        base_cull = float(full.get("spectralCullThreshold", .0005))
        for threshold in np.arange(base_cull + .0001, .01001, .0001):
            threshold = round(float(threshold), 4)
            candidate = {**full, "spectralCullThreshold": threshold}
            row = assess(candidate, f"c{threshold:.4f}",
                         {"strategy": "audibility-cull", "spectralCullThreshold": threshold})
            history.append(row)
            if row["deltaDb"] > args.mel_budget_db or not row["constructionPassed"]:
                break
            shipping = candidate
        # If even the first cull step is invalid, retain the legacy density
        # fallback for profiles whose energy is strictly low-order.
        if shipping == full:
            for count in range(start - 1, max(1, args.min_partials) - 1, -1):
                candidate = {**full, "spectralPartials": count}
                row = assess(candidate, f"p{count}",
                             {"strategy": "partial-count", "partials": count})
                history.append(row)
                if row["deltaDb"] > args.mel_budget_db or not row["constructionPassed"]:
                    break
                shipping = candidate
    result = {"fullFidelity": full, "shipping": shipping, "history": history,
              "changed": shipping != full}
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"out": args.out, "fullPartials": start,
                      "shippingPartials": shipping.get("spectralPartials", start),
                      "shippingCullThreshold": shipping.get("spectralCullThreshold", .0005)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
