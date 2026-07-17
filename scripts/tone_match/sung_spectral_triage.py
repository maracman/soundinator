#!/usr/bin/env python3
"""Triage sung strict spectral cells without folding residuals into vowels.

The sung identity contract is one pooled glottal source plus one fixed-Hz
body per vowel.  This module keeps that separation while answering two pass
questions:

* which strict partial/mel/band cells fail, in criteria-hierarchy order; and
* whether the remaining source residual is expressible by the renderer's one
  global dynamic-brightness scalar or requires a register/dynamic source law.

The register/dynamic fits are counterfactual diagnostics only.  They are never
written into vowel params until the engine has a consuming source-table law.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
from typing import Any
import warnings

import numpy as np

from scripts.tone_match.sung_features import _body_transfer_db


CRITERIA_ORDER = (
    "partial-table", "mel-spectrogram", "attack-t90", "band-balance",
)


def _load(path: Path) -> Any:
    return json.loads(path.read_text())


def _reference_residuals(analysed: list[dict[str, Any]],
                         vowel_bodies: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for item in analysed:
        reference = item["reference"]
        analysis = item["analysis"]
        amps = np.asarray(analysis["partial_amps"], dtype=float)
        audible = np.asarray(analysis["partial_snr_ok"], dtype=bool)
        partial_db = 20 * np.log10(
            np.maximum(amps, 1e-6) / max(float(np.max(amps)), 1e-12)
        )
        partial_db[~audible] = np.nan
        harmonics = np.arange(1, len(partial_db) + 1, dtype=float)
        f0_hz = float(analysis["f0"])
        body_db = _body_transfer_db(
            vowel_bodies[reference["vowel"]]["bands"], f0_hz * harmonics,
        )
        source_db = partial_db - body_db
        finite = np.isfinite(source_db)
        if np.any(finite):
            source_db -= float(np.nanmedian(source_db))
        rows.append({
            "vowel": reference["vowel"],
            "register": reference["register"],
            "dynamic": reference["dynamic"],
            "velocity": float(reference["velocity"]),
            "f0Hz": f0_hz,
            "sourceId": reference.get("sourceFile"),
            "sourceDb": source_db,
        })
    return rows


def _dynamic_unit_db(count: int, velocity: float) -> np.ndarray:
    harmonics = np.arange(1, count + 1, dtype=float)
    exponent = 0.5 * np.log2(1 + harmonics)
    return 20 * exponent * np.log10(max(0.08, velocity / 0.62))


def fit_global_dynamic_amount(rows: list[dict[str, Any]], *,
                              lower: float = 0.0, upper: float = 2.5,
                              steps: int = 201) -> dict[str, Any]:
    """Fit the renderer's one lawful dynamic scalar to de-bodied sources."""

    candidates = np.linspace(lower, upper, steps)
    best = None
    for amount in candidates:
        adjusted = [
            row["sourceDb"] - _dynamic_unit_db(len(row["sourceDb"]), row["velocity"]) * amount
            for row in rows
        ]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            pooled = np.nanmedian(np.asarray(adjusted), axis=0)
        finite = np.isfinite(pooled)
        if np.any(finite):
            pooled -= pooled[np.flatnonzero(finite)[0]]
        row_errors = []
        all_errors = []
        for row in rows:
            predicted = pooled + _dynamic_unit_db(
                len(row["sourceDb"]), row["velocity"],
            ) * amount
            valid = np.isfinite(row["sourceDb"]) & np.isfinite(predicted)
            if np.count_nonzero(valid) < 4:
                continue
            delta = row["sourceDb"][valid] - predicted[valid]
            delta -= float(np.median(delta))
            absolute = np.abs(delta)
            row_errors.append(float(np.mean(absolute)))
            all_errors.extend(absolute.tolist())
        if not row_errors:
            continue
        objective = float(np.mean(row_errors))
        if best is None or objective < best[0]:
            best = (objective, float(amount), pooled.copy(), all_errors, row_errors)
    if best is None:
        raise ValueError("no analysable rows for sung dynamic fit")
    objective, amount, pooled, all_errors, row_errors = best
    return {
        "method": "pooled-source-body-deconvolved-grid-fit",
        "spectralDynamicAmount": round(amount, 6),
        "meanPerNotePartialMaeDb": round(objective, 6),
        "medianPartialErrorDb": round(float(np.median(all_errors)), 6),
        "p95PartialErrorDb": round(float(np.percentile(all_errors, 95)), 6),
        "notesWithinThreeDb": sum(value <= 3 for value in row_errors),
        "analysedNotes": len(row_errors),
        "sourcePartialsDiagnostic": [
            round(float(10 ** (value / 20)), 8) if np.isfinite(value) else 0.0
            for value in pooled
        ],
        "bounds": [lower, upper],
        "steps": steps,
    }


def _stratified_error(rows: list[dict[str, Any]], fields: tuple[str, ...]) -> dict[str, Any]:
    groups: dict[tuple[Any, ...], list[np.ndarray]] = {}
    for row in rows:
        key = tuple(row[field] for field in fields) if fields else ("pooled",)
        groups.setdefault(key, []).append(row["sourceDb"])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        medians = {
            key: np.nanmedian(np.asarray(values), axis=0)
            for key, values in groups.items()
        }
    errors = []
    row_errors = []
    for row in rows:
        key = tuple(row[field] for field in fields) if fields else ("pooled",)
        predicted = medians[key]
        valid = np.isfinite(row["sourceDb"]) & np.isfinite(predicted)
        if np.count_nonzero(valid) < 4:
            continue
        delta = row["sourceDb"][valid] - predicted[valid]
        delta -= float(np.median(delta))
        absolute = np.abs(delta)
        errors.extend(absolute.tolist())
        row_errors.append(float(np.mean(absolute)))
    return {
        "strata": list(fields) if fields else ["pooled"],
        "groups": len(groups),
        "medianPartialErrorDb": round(float(np.median(errors)), 6),
        "p95PartialErrorDb": round(float(np.percentile(errors, 95)), 6),
        "meanPerNotePartialMaeDb": round(float(np.mean(row_errors)), 6),
        "notesWithinThreeDb": sum(value <= 3 for value in row_errors),
        "analysedNotes": len(row_errors),
    }


def triage(scores_path: Path, fit_root: Path) -> dict[str, Any]:
    scores = _load(scores_path)
    source_fit = _load(fit_root / "SOURCE_VOWEL_FIT.json")
    analysed = _load(fit_root / "ANALYSED_REFERENCES.json")
    cells = scores["tripwires"]["cells"]
    by_bar = {}
    for bar in CRITERIA_ORDER:
        selected = [row for row in cells if row["bar"] == bar]
        by_bar[bar] = {
            "pass": sum(row["status"] == "pass" for row in selected),
            "fail": sum(row["status"] == "fail" for row in selected),
            "missing": sum(row["status"] not in {"pass", "fail"}
                           for row in selected),
            "cells": selected,
        }
    residuals = _reference_residuals(analysed, source_fit["fit"]["vowelBodies"])
    stratified = {
        "pooled": _stratified_error(residuals, ()),
        "register": _stratified_error(residuals, ("register",)),
        "dynamic": _stratified_error(residuals, ("dynamic",)),
        "registerDynamic": _stratified_error(
            residuals, ("register", "dynamic"),
        ),
    }
    pooled = stratified["pooled"]["medianPartialErrorDb"]
    register_dynamic = stratified["registerDynamic"]["medianPartialErrorDb"]
    improvement = (pooled - register_dynamic) / max(pooled, 1e-9)
    return {
        "schemaVersion": 1,
        "instrument": scores["instrument"],
        "run": scores["run"],
        "criteriaOrder": list(CRITERIA_ORDER),
        "strictCellsByCriterion": by_bar,
        "dynamicScalarFit": fit_global_dynamic_amount(residuals),
        "sourceStratificationCounterfactual": stratified,
        "registerDynamicMedianImprovementFraction": round(float(improvement), 6),
        "limitingFactor": (
            "engine-law-limited-register-dynamic-source-tables"
            if improvement >= 0.20 else "continue-pooled-source-fitting"
        ),
        "firewall": (
            "counterfactual tables are diagnostic only; no register/dynamic "
            "residual is folded into per-vowel body identity"
        ),
    }


def write_dynamic_candidate(fit_root: Path, output_root: Path,
                            triage_payload: dict[str, Any]) -> None:
    if output_root.exists() and any(output_root.iterdir()):
        raise ValueError(f"dynamic candidate output is not empty: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    amount = triage_payload["dynamicScalarFit"]["spectralDynamicAmount"]
    for name in ("SOURCE_VOWEL_FIT.json", "ANALYSED_REFERENCES.json"):
        source = fit_root / name
        if source.exists():
            shutil.copy2(source, output_root / name)
    payload = _load(output_root / "SOURCE_VOWEL_FIT.json")
    payload["baseParams"]["spectralDynamicAmount"] = amount
    payload["spectralTriage"] = {
        "criteriaOrder": triage_payload["criteriaOrder"],
        "dynamicScalarFit": triage_payload["dynamicScalarFit"],
        "limitingFactor": triage_payload["limitingFactor"],
    }
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n"
    )
    for vowel in "aeiou":
        params = _load(fit_root / f"initial-{vowel}.json")
        params["spectralDynamicAmount"] = amount
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scores", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--dynamic-candidate-out", type=Path)
    args = parser.parse_args()
    result = triage(args.scores, args.fit_root)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    if args.dynamic_candidate_out:
        write_dynamic_candidate(args.fit_root, args.dynamic_candidate_out, result)
    print(json.dumps({
        "instrument": result["instrument"],
        "limitingFactor": result["limitingFactor"],
        "spectralDynamicAmount": result["dynamicScalarFit"]["spectralDynamicAmount"],
        "registerDynamicMedianImprovementFraction":
            result["registerDynamicMedianImprovementFraction"],
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
