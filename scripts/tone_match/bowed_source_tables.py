#!/usr/bin/env python3
"""Emit an instrument-owned bowed register x dynamic source-table attempt.

Each row applies the reference/render harmonic residual to the fitted string
source used by that exact campaign cell.  This is an upstream source attempt,
not an LTAS/body copy: string identity stays local, reference and render bytes
are sealed, and activation still requires a fresh consuming audit and §3 score.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .score import extract_features


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _string_partials(params: dict[str, Any], string: str, f0: float) -> np.ndarray:
    rows = sorted((row for row in params.get("partialsByString", {}).get(string, [])
                   if row.get("partials") and row.get("f0")),
                  key=lambda row: row["f0"])
    if not rows:
        raise ValueError(f"missing fitted string source {string}")
    if f0 <= rows[0]["f0"]:
        left = right = rows[0]
        amount = 0.0
    elif f0 >= rows[-1]["f0"]:
        left = right = rows[-1]
        amount = 0.0
    else:
        hi = next(index for index, row in enumerate(rows) if row["f0"] >= f0)
        left, right = rows[hi - 1], rows[hi]
        amount = math.log(f0 / left["f0"]) / math.log(right["f0"] / left["f0"])
    a = np.asarray([partial["amp"] for partial in left["partials"]], float)
    b = np.asarray([partial["amp"] for partial in right["partials"]], float)
    size = max(len(a), len(b))
    a, b = np.pad(a, (0, size - len(a))), np.pad(b, (0, size - len(b)))
    return a + (b - a) * amount


def build(instrument: str, references_path: Path, jobs_path: Path,
          params_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    references = json.loads(references_path.read_text())
    jobs = json.loads(jobs_path.read_text())
    params = json.loads(params_path.read_text())
    if len(jobs) != len(references):
        raise ValueError("source attempt requires one retained render per reference")
    rows = []
    for reference, job in zip(references, jobs):
        reference_path, render_path = Path(reference["path"]), Path(job["out"])
        f0 = float(reference.get("expectedF0Hz") or reference["detectedF0"])
        ref = extract_features(reference_path, n_partials=32,
                               expected_f0_hz=f0, trust_expected_f0=True)
        rendered = extract_features(
            render_path, n_partials=32,
            active_duration_s=reference["durationSec"],
            expected_f0_hz=f0, trust_expected_f0=True)
        delta = np.asarray(ref.partial_db) - np.asarray(rendered.partial_db)
        base = _string_partials(params, reference["string"], f0)
        adjusted = base.copy()
        count = min(len(adjusted), len(delta))
        finite = np.isfinite(delta[:count])
        indices = np.flatnonzero(finite)
        adjusted[indices] *= 10 ** (delta[indices] / 20)
        adjusted = np.maximum(adjusted, 0)
        peak = float(np.max(adjusted))
        if not np.isfinite(peak) or peak <= 0:
            raise ValueError(f"invalid row {reference['register']}/{reference['dynamic']}")
        adjusted /= peak
        rows.append({
            "register": reference["register"],
            "dynamic": reference["dynamic"],
            "string": reference["string"],
            "f0Hz": round(f0, 6),
            "velocity": round(float(reference["velocity"]), 6),
            "partials": [round(float(value), 8) for value in adjusted],
            "activationStatus": "candidate-pending-consuming-audit-and-section-3",
            "medianAbsCorrectionDb": round(float(np.nanmedian(np.abs(delta))), 6),
            "provenance": {
                "sourceFile": reference.get("sourceFile"),
                "referenceSha256": _sha(reference_path),
                "renderSha256": _sha(render_path),
            },
        })
    cells = {(row["register"], row["dynamic"]) for row in rows}
    if len(rows) != 6 or len(cells) != 6:
        raise ValueError(f"expected six distinct cells, got {len(rows)}/{len(cells)}")
    table = {
        "schemaVersion": 1,
        "handoff": "D-BOWED-SOURCE-01",
        "instrument": instrument,
        "status": "candidate-pending-consuming-audit-and-section-3",
        "method": "paired-harmonic-residual-on-fitted-local-string-source",
        "interpolation": "joint log-f0 x velocity measured hull; clamp outside",
        "dynamicComposition": (
            "rows contain source shape at measured velocity; suppress generic "
            "spectralDynamicAmount while a row is active"),
        "firewall": f"{instrument}-only; no cross-instrument values",
        "paramsSha256": _sha(params_path),
        "referencesSha256": _sha(references_path),
        "rows": rows,
    }
    table["evidenceSha256"] = hashlib.sha256(json.dumps(
        table, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    candidate = {
        **params,
        "spectralPartialsByRegisterDynamic": {
            key: table[key] for key in (
                "schemaVersion", "handoff", "evidenceSha256", "interpolation",
                "dynamicComposition", "rows")},
    }
    return table, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--jobs", type=Path, required=True)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    table, candidate = build(
        args.instrument, args.references, args.jobs, args.params)
    for path, payload in ((args.out, table), (args.candidate, candidate)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "candidate": str(args.candidate),
                      "evidenceSha256": table["evidenceSha256"],
                      "rows": len(table["rows"])}, indent=2))


if __name__ == "__main__":
    main()
