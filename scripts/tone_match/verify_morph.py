"""Verify family morphs using only the declared exposed continuous controls.

Manifest rows contain sourceParams, targetParams, targetRef, note options,
exposedKeys and targetBestLoss. The verifier copies only exposed target values
onto the source preset, renders the result, and enforces <=25% excess loss.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from .score import score_files

ROOT = Path(__file__).resolve().parents[2]


def _json(value):
    return json.loads(Path(value).read_text()) if isinstance(value, str) else value


def verify(manifest_path: str, output_path: str | None = None) -> list[dict]:
    rows = _json(manifest_path)
    results = []
    with tempfile.TemporaryDirectory(prefix="sg2-morph-") as temp:
        temp = Path(temp)
        jobs = []
        for index, row in enumerate(rows):
            source, target = _json(row["sourceParams"]), _json(row["targetParams"])
            exposed = row["exposedKeys"]
            morphed = {**source, **{key: target[key] for key in exposed if key in target}}
            params_path, wav_path = temp / f"params-{index}.json", temp / f"morph-{index}.wav"
            params_path.write_text(json.dumps(morphed))
            note = row.get("note", {})
            jobs.append({"paramsFile": str(params_path), "out": str(wav_path), "midi": note.get("midi", 60),
                         "velocity": note.get("velocity", .62), "durationSec": note.get("durationSec", 1.5),
                         "sampleRate": note.get("sampleRate", 48000)})
        jobs_path = temp / "jobs.json"; jobs_path.write_text(json.dumps(jobs))
        process = subprocess.run(["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
                                 cwd=ROOT, text=True, capture_output=True)
        if process.returncode:
            raise RuntimeError(process.stderr or process.stdout)
        for row, job in zip(rows, jobs):
            score = score_files(row["targetRef"], job["out"])
            limit = float(row["targetBestLoss"]) * 1.25
            results.append({"family": row.get("family"), "source": row.get("source"), "target": row.get("target"),
                            "loss": score["composite"], "limit": limit, "pass": score["composite"] <= limit,
                            "features": score["features"]})
    if output_path:
        Path(output_path).write_text(json.dumps(results, indent=2) + "\n")
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    results = verify(args.manifest, args.out)
    print(json.dumps(results, indent=2))
    failed = [row for row in results if not row["pass"]]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
