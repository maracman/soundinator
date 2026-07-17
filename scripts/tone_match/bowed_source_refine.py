#!/usr/bin/env python3
"""Boundedly refine an active bowed source surface from strict FIT renders.

The physical body-deconvolved surface and its measured-hull law remain fixed.
Only harmonics already present in each declared lossless cell may move, using
the scale-free reference-minus-current-render residual for that same take.
This is the render-domain calibration rung after direct body deconvolution,
not a new full-chain or cross-instrument source estimate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from .score import extract_features


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _surface_hash(surface: dict[str, Any]) -> str:
    payload = dict(surface)
    payload.pop("evidenceSha256", None)
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def apply_bounded_partial_correction(
    partials: list[float],
    residual_db: np.ndarray,
    *,
    correction_fraction: float = .65,
    max_correction_db: float = 6.0,
) -> tuple[list[float], dict[str, Any]]:
    """Apply a bounded shape residual without activating absent harmonics."""
    old = np.asarray(partials, dtype=float)
    residual = np.asarray(residual_db, dtype=float)
    count = min(len(old), len(residual))
    eligible = np.zeros(len(old), dtype=bool)
    eligible[:count] = (old[:count] > 0) & np.isfinite(residual[:count])
    applied = np.zeros(len(old), dtype=float)
    applied[:count][eligible[:count]] = np.clip(
        correction_fraction * residual[:count][eligible[:count]],
        -max_correction_db, max_correction_db)
    new = old * 10 ** (applied / 20)
    peak = float(np.max(new)) if len(new) else 0.0
    if not np.isfinite(peak) or peak <= 0:
        raise ValueError("bounded source correction produced an invalid row")
    new /= peak
    evidence = {
        "correctionFraction": correction_fraction,
        "maxCorrectionDb": max_correction_db,
        "correctedPartials": int(np.count_nonzero(eligible)),
        "medianAbsAppliedDb": round(
            float(np.median(np.abs(applied[eligible]))) if np.any(eligible) else 0.0,
            6),
        "maxAbsAppliedDb": round(
            float(np.max(np.abs(applied[eligible]))) if np.any(eligible) else 0.0,
            6),
    }
    return [round(float(value), 8) for value in new], evidence


def refine(
    instrument: str,
    references_path: Path,
    jobs_path: Path,
    params_path: Path,
    *,
    correction_fraction: float = .65,
    max_correction_db: float = 6.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    references = json.loads(references_path.read_text())
    jobs = json.loads(jobs_path.read_text())
    params = json.loads(params_path.read_text())
    if len(references) != len(jobs):
        raise ValueError(
            f"reference/render cardinality changed: {len(references)} != {len(jobs)}")
    surface = json.loads(json.dumps(
        params.get("spectralPartialsByRegisterDynamic") or {}))
    if not surface.get("rows"):
        raise ValueError("candidate has no active bowed source surface")
    by_cell = {
        (str(row["register"]), str(row["dynamic"])): row
        for row in surface["rows"]
    }
    if len(by_cell) != len(surface["rows"]):
        raise ValueError("source surface contains duplicate cells")

    corrections = []
    analysed_cells: set[tuple[str, str]] = set()
    for reference, job in zip(references, jobs):
        if "spectral" not in reference.get("roles", []):
            continue
        if Path(str(reference.get("sourceFile", ""))).suffix.lower() \
                not in {".aif", ".aiff"}:
            continue
        cell = (str(reference["register"]), str(reference["dynamic"]))
        if cell not in by_cell:
            raise ValueError(f"lossless spectral cell absent from surface: {cell}")
        if cell in analysed_cells:
            raise ValueError(f"multiple lossless spectral references for cell: {cell}")
        analysed_cells.add(cell)
        f0 = float(reference.get("expectedF0Hz") or reference.get("detectedF0"))
        observed = extract_features(
            Path(reference["path"]), n_partials=64,
            expected_f0_hz=f0, trust_expected_f0=True)
        rendered = extract_features(
            Path(job["out"]), n_partials=64,
            active_duration_s=float(reference["durationSec"]),
            expected_f0_hz=f0, trust_expected_f0=True)
        ref_db = np.asarray(observed.partial_db, dtype=float)
        render_db = np.asarray(rendered.partial_db, dtype=float)
        count = min(len(ref_db), len(render_db))
        residual = np.full(max(len(ref_db), len(render_db)), np.nan)
        valid = np.isfinite(ref_db[:count]) & np.isfinite(render_db[:count])
        residual[:count][valid] = ref_db[:count][valid] - render_db[:count][valid]
        if np.count_nonzero(valid) < 4:
            raise ValueError(f"fewer than four shared harmonics for cell {cell}")
        residual[:count][valid] -= float(np.median(residual[:count][valid]))
        row = by_cell[cell]
        row["partials"], evidence = apply_bounded_partial_correction(
            row["partials"], residual,
            correction_fraction=correction_fraction,
            max_correction_db=max_correction_db)
        row["renderDomainCorrection"] = {
            "method": "same-take-scale-free-reference-minus-strict-fit-render",
            "referenceSha256": _sha(Path(reference["path"])),
            "renderSha256": _sha(Path(job["out"])),
            **evidence,
        }
        corrections.append({
            "register": cell[0], "dynamic": cell[1],
            **row["renderDomainCorrection"],
        })

    missing = set(by_cell) - analysed_cells
    if missing:
        raise ValueError(f"surface cells lack lossless strict-render evidence: {sorted(missing)}")
    surface["handoff"] = "D-BOWED-SOURCE-03"
    surface["evidenceSha256"] = _surface_hash(surface)
    candidate = dict(params)
    candidate["spectralPartialsByRegisterDynamic"] = surface
    report = {
        "schema": "sg2-bowed-source-render-domain-refinement-v1",
        "instrument": instrument,
        "status": "candidate-pending-strict-hierarchy-audit",
        "method": "bounded-same-cell-render-domain-source-correction",
        "referencesSha256": _sha(references_path),
        "jobsSha256": _sha(jobs_path),
        "inputParamsSha256": _sha(params_path),
        "surfaceEvidenceSha256": surface["evidenceSha256"],
        "jointHullLawChanged": False,
        "bodyBandsChanged": False,
        "humanControlsChanged": False,
        "rows": corrections,
    }
    report["evidenceSha256"] = hashlib.sha256(json.dumps(
        report, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return report, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--jobs", type=Path, required=True)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--correction-fraction", type=float, default=.65)
    parser.add_argument("--max-correction-db", type=float, default=6.0)
    args = parser.parse_args()
    report, candidate = refine(
        args.instrument, args.references, args.jobs, args.params,
        correction_fraction=args.correction_fraction,
        max_correction_db=args.max_correction_db)
    for path, payload in ((args.out, report), (args.candidate, candidate)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "out": str(args.out), "candidate": str(args.candidate),
        "evidenceSha256": report["evidenceSha256"],
        "surfaceEvidenceSha256": report["surfaceEvidenceSha256"],
        "rows": len(report["rows"]),
    }, indent=2))


if __name__ == "__main__":
    main()
