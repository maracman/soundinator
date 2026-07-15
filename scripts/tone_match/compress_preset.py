"""Derive a scorer-gated lower-density playback preset after fitting."""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .score import score_files

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
        full_scores = [score_files(ref["path"], wav) for ref, wav in zip(references, full_wavs)]
        base_mel = float(np.mean([row["features"]["log_mel_db"] for row in full_scores]))
        for count in range(start - 1, max(1, args.min_partials) - 1, -1):
            candidate = {**full, "spectralPartials": count}
            wavs = _render(candidate, references, temp, f"p{count}")
            scores = [score_files(ref["path"], wav) for ref, wav in zip(references, wavs)]
            mel = float(np.mean([row["features"]["log_mel_db"] for row in scores]))
            row = {"partials": count, "melDistanceDb": mel, "deltaDb": mel - base_mel,
                   "composite": float(np.mean([item["composite"] for item in scores]))}
            history.append(row)
            if row["deltaDb"] > args.mel_budget_db:
                break
            shipping = candidate
    result = {"fullFidelity": full, "shipping": shipping, "history": history,
              "changed": shipping.get("spectralPartials") != full.get("spectralPartials")}
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"out": args.out, "fullPartials": start,
                      "shippingPartials": shipping.get("spectralPartials", start)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
