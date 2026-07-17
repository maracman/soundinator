#!/usr/bin/env python3
"""Refine a measured sung source surface from strict render residuals.

The A-VOICE-05 interpolation and hull law stays fixed.  This campaign step
updates only the already-measured register x dynamic rows, pooling each
harmonic correction across all five vowels so no vowel-specific glottal
source can be created.  Vowel bodies are copied byte-for-byte into the
candidate fit root and remain independently audited by T-058.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any
import warnings

import numpy as np

from scripts.tone_match.analysis import analyse_audio_file


VOICE_KEYS = {
    "tenor": "tenor",
    "soprano": "soprano",
    "bass": "bass",
    "mezzo-soprano": "mezzo",
}


def _selected_references(path: Path) -> list[dict[str, Any]]:
    rows = [
        row for row in json.loads(path.read_text())
        if "spectral" in row.get("roles", [])
    ]
    rows.sort(key=lambda row: (
        "aeiou".index(row["vowel"]),
        ("low", "mid", "high").index(row["register"]),
        row.get("velocity", 0), row["sourceFile"],
    ))
    return rows


def _surface(calibration: dict[str, Any], voice_class: str) -> dict[str, Any]:
    key = VOICE_KEYS[voice_class]
    table = calibration["voices"][key]
    return {
        "schemaVersion": calibration["schemaVersion"],
        "handoff": calibration["handoff"],
        "evidenceSha256": calibration["evidenceSha256"],
        "sourceIdentity": table["sourceIdentity"],
        "interpolation": calibration["interpolationContract"],
        "dynamicComposition": calibration["dynamicComposition"],
        "rows": table["rows"],
    }


def refine(
    references_path: Path,
    fit_root: Path,
    baseline_run: Path,
    calibration_path: Path,
    output_root: Path,
    *,
    correction_fraction: float = 0.65,
    max_correction_db: float = 6.0,
    minimum_vowels: int = 2,
) -> dict[str, Any]:
    references = _selected_references(references_path)
    manifest = json.loads((baseline_run / "audition-manifest.json").read_text())
    if len(references) != len(manifest):
        raise ValueError(
            f"reference/render cardinality changed: {len(references)} != {len(manifest)}"
        )
    voice_classes = {row["voiceClass"] for row in references}
    if len(voice_classes) != 1:
        raise ValueError(f"source refinement requires one voice class: {voice_classes}")
    voice_class = next(iter(voice_classes))
    calibration = json.loads(calibration_path.read_text())
    surface = _surface(calibration, voice_class)

    by_cell: dict[tuple[str, str], list[list[float]]] = {}
    analysed_rows = 0
    for row, trial in zip(references, manifest):
        try:
            reference = analyse_audio_file(
                trial["reference"], n_partials=64,
                expected_f0_hz=row["expectedF0Hz"],
            )
            rendered = analyse_audio_file(
                trial["fitRender"], n_partials=64,
                expected_f0_hz=row["expectedF0Hz"],
            )
        except (ValueError, RuntimeError):
            continue
        count = min(len(reference.partial_amps), len(rendered.partial_amps), 64)
        valid = (
            np.asarray(reference.partial_snr_ok[:count], dtype=bool)
            & np.asarray(rendered.partial_snr_ok[:count], dtype=bool)
            & (np.asarray(reference.partial_amps[:count]) > 1e-4)
            & (np.asarray(rendered.partial_amps[:count]) > 1e-4)
        )
        if np.count_nonzero(valid) < 4:
            continue
        delta = np.full(64, np.nan)
        values = 20 * np.log10(
            np.asarray(reference.partial_amps[:count])[valid]
            / np.asarray(rendered.partial_amps[:count])[valid]
        )
        values -= float(np.median(values))
        delta[np.flatnonzero(valid)] = values
        by_cell.setdefault((row["register"], row["dynamic"]), []).append(
            delta.tolist()
        )
        analysed_rows += 1

    correction_rows = []
    for source_row in surface["rows"]:
        cell = (source_row["register"], source_row["dynamic"])
        evidence = np.asarray(by_cell.get(cell, []), dtype=float)
        if evidence.size:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=RuntimeWarning)
                correction_db = np.nanmedian(evidence, axis=0)
            counts = np.sum(np.isfinite(evidence), axis=0)
        else:
            correction_db = np.full(64, np.nan)
            counts = np.zeros(64, dtype=int)
        old = np.asarray(source_row["partials"], dtype=float)
        count = min(len(old), len(correction_db))
        applied = np.zeros_like(old)
        eligible = (
            np.arange(len(old)) < count
        ) & (old > 0)
        eligible[:count] &= (
            np.isfinite(correction_db[:count])
            & (counts[:count] >= int(minimum_vowels))
        )
        applied[eligible] = np.clip(
            correction_fraction * correction_db[:len(old)][eligible],
            -max_correction_db, max_correction_db,
        )
        new = old * 10 ** (applied / 20)
        anchors = np.flatnonzero(new > 0)
        if anchors.size:
            new /= new[anchors[0]]
        source_row["partials"] = [round(float(value), 8) for value in new]
        source_row["pass10Correction"] = {
            "method": "cross-vowel-reference-minus-current-render-cell-median",
            "correctionFraction": correction_fraction,
            "maxCorrectionDb": max_correction_db,
            "minimumVowelsPerPartial": minimum_vowels,
            "analysedNotes": int(len(evidence)),
            "correctedPartials": int(np.count_nonzero(eligible)),
            "medianAbsAppliedDb": round(
                float(np.median(np.abs(applied[eligible]))) if np.any(eligible) else 0.0,
                6,
            ),
            "maxAbsAppliedDb": round(
                float(np.max(np.abs(applied[eligible]))) if np.any(eligible) else 0.0,
                6,
            ),
        }
        correction_rows.append({
            "register": cell[0], "dynamic": cell[1],
            **source_row["pass10Correction"],
        })

    source_fit = json.loads((fit_root / "SOURCE_VOWEL_FIT.json").read_text())
    base = dict(source_fit["baseParams"])
    base["spectralPartialsByRegisterDynamic"] = surface
    output_root.mkdir(parents=True, exist_ok=True)
    for vowel in "aeiou":
        params = json.loads((fit_root / f"initial-{vowel}.json").read_text())
        params["spectralPartialsByRegisterDynamic"] = surface
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )
    payload = {
        **source_fit,
        "baseParams": base,
        "renderDomainSourceRefinement": {
            "method": "bounded-cross-vowel-cell-source-correction",
            "baselineRun": str(baseline_run),
            "sourceCalibration": str(calibration_path),
            "voiceClass": voice_class,
            "analysedRows": analysed_rows,
            "oneSourcePerSinger": True,
            "jointHullLawChanged": False,
            "vowelBodiesChanged": False,
            "rows": correction_rows,
        },
    }
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n"
    )
    analysed_path = fit_root / "ANALYSED_REFERENCES.json"
    if analysed_path.exists():
        (output_root / "ANALYSED_REFERENCES.json").write_text(
            analysed_path.read_text()
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--baseline-run", type=Path, required=True)
    parser.add_argument("--calibration", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--correction-fraction", type=float, default=.65)
    parser.add_argument("--max-correction-db", type=float, default=6.0)
    parser.add_argument("--minimum-vowels", type=int, default=2)
    args = parser.parse_args()
    payload = refine(
        args.references, args.fit_root, args.baseline_run, args.calibration,
        args.out, correction_fraction=args.correction_fraction,
        max_correction_db=args.max_correction_db,
        minimum_vowels=args.minimum_vowels,
    )
    print(json.dumps(payload["renderDomainSourceRefinement"], indent=2))


if __name__ == "__main__":
    main()
