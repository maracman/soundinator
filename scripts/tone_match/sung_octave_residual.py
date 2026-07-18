#!/usr/bin/env python3
"""Evaluate T-078 octave residuals without folding vowel colour into source.

Sung references share one glottal source across five independently fitted
vowel bodies.  A final-render octave residual is therefore source-addressable
only when it passes T-078's within-take temporal bars and repeats across
vowels in the same register/dynamic cell.  Eligible cells are fit-limited by
the existing measured source surface; rejected cells are law-limited and may
not trigger a body refit.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np

from scripts.tone_match.blown_octave_residual import (
    apply_residual_to_params,
    extract_stable_residual_files,
    synthetic_roundtrip,
)


CRITERIA_ORDER = ("partial-table", "mel-spectrogram", "attack-t90", "band-balance")


def _load(path: Path) -> Any:
    return json.loads(path.read_text())


def _sha(payload: Any) -> str:
    return hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _selected_references(path: Path) -> list[dict[str, Any]]:
    rows = [row for row in _load(path) if "spectral" in row.get("roles", [])]
    rows.sort(key=lambda row: (
        "aeiou".index(row["vowel"]),
        ("low", "mid", "high").index(row["register"]),
        row.get("velocity", 0), row["sourceFile"],
    ))
    return rows


def _render_path(trial: dict[str, Any], run_root: Path) -> Path:
    recorded = Path(trial["fitRender"])
    if recorded.exists():
        return recorded
    relocated = run_root / "fit-renders" / recorded.name
    if relocated.exists():
        return relocated
    return recorded


def aggregate_vowel_cell(
    rows: list[dict[str, Any]],
    *,
    f0_hz: float,
    minimum_vowels: int = 3,
    maximum_cross_vowel_mad_db: float = 2.0,
    minimum_sign_agreement: float = 2 / 3,
) -> dict[str, Any]:
    """Pool only temporally stable bands that recur across vowel bodies."""

    if not rows:
        raise ValueError("cannot aggregate an empty sung octave-residual cell")
    centres = np.asarray(rows[0]["evidence"]["octaveCentresHz"], dtype=float)
    band_count = len(centres)
    for row in rows:
        if len(row["evidence"]["octaveCentresHz"]) != band_count:
            raise ValueError("octave residual rows use incompatible band grids")

    medians = np.asarray([
        row["evidence"]["medianResidualDb"] for row in rows
    ], dtype=float)
    eligible = np.asarray([
        np.asarray(row["evidence"]["stableBands"], dtype=bool)
        & np.asarray(row["evidence"]["sourceAddressable"], dtype=bool)
        for row in rows
    ])
    pooled = np.zeros(band_count, dtype=float)
    mad = np.full(band_count, np.inf, dtype=float)
    agreement = np.zeros(band_count, dtype=float)
    vowel_counts = np.zeros(band_count, dtype=int)
    evidence_counts = np.zeros(band_count, dtype=int)
    stable = np.zeros(band_count, dtype=bool)
    for index in range(band_count):
        selected = np.flatnonzero(eligible[:, index])
        if selected.size == 0:
            continue
        values = medians[selected, index]
        pooled[index] = float(np.median(values))
        mad[index] = float(np.median(np.abs(values - pooled[index])))
        if abs(pooled[index]) <= 1e-12:
            agreement[index] = float(np.mean(np.abs(values) <= 1e-12))
        else:
            agreement[index] = float(np.mean(
                np.sign(values) == np.sign(pooled[index])))
        vowels = {rows[item]["vowel"] for item in selected}
        vowel_counts[index] = len(vowels)
        evidence_counts[index] = selected.size
        stable[index] = (
            vowel_counts[index] >= minimum_vowels
            and mad[index] <= maximum_cross_vowel_mad_db
            and agreement[index] >= minimum_sign_agreement
        )

    # The selected cell's normalisation anchor, not the lowest contributing
    # take, defines which octave bands can address its harmonic source row.
    source_addressable = centres * np.sqrt(2) >= float(f0_hz) * .95
    stable &= source_addressable
    return {
        "status": "pass" if np.count_nonzero(stable) >= 2 else "fail",
        "f0Hz": float(f0_hz),
        "octaveCentresHz": centres.tolist(),
        "medianResidualDb": pooled.tolist(),
        "medianAbsoluteDeviationDb": mad.tolist(),
        "signAgreement": agreement.tolist(),
        "sourceAddressable": source_addressable.tolist(),
        "stableBands": stable.tolist(),
        "distinctVowelsByBand": vowel_counts.tolist(),
        "evidenceRowsByBand": evidence_counts.tolist(),
        "bars": {
            "minimumDistinctVowels": minimum_vowels,
            "maximumCrossVowelMadDb": maximum_cross_vowel_mad_db,
            "minimumSignAgreement": minimum_sign_agreement,
            "minimumStableBands": 2,
        },
    }


def _cell_residuals(scores: dict[str, Any]) -> dict[tuple[str, str], dict[str, float]]:
    grouped: dict[tuple[str, str], dict[str, list[float]]] = {}
    for row in scores.get("rows", []):
        key = (row["register"], row["dynamic"])
        target = grouped.setdefault(key, {criterion: [] for criterion in CRITERIA_ORDER})
        normalized = row.get("normalized", {})
        mapping = {
            "partial-table": "partials_db",
            "mel-spectrogram": "log_mel_db",
            "attack-t90": "attack_ms",
            "band-balance": "band_balance_db",
        }
        for criterion, feature in mapping.items():
            value = normalized.get(feature)
            if isinstance(value, (int, float)):
                target[criterion].append(float(value))
    return {
        key: {
            criterion: float(np.mean(values)) if values else float("inf")
            for criterion, values in criteria.items()
        }
        for key, criteria in grouped.items()
    }


def evaluate(
    references_path: Path,
    run_root: Path,
    fit_root: Path,
    scores_path: Path,
    *,
    minimum_vowels: int = 3,
) -> dict[str, Any]:
    references = _selected_references(references_path)
    manifest = _load(run_root / "audition-manifest.json")
    if len(references) != len(manifest):
        raise ValueError(
            f"reference/render cardinality changed: {len(references)} != {len(manifest)}")
    source_fit = _load(fit_root / "SOURCE_VOWEL_FIT.json")
    surface = source_fit["baseParams"]["spectralPartialsByRegisterDynamic"]
    surface_rows = {
        (row["register"], row["dynamic"]): row for row in surface["rows"]
    }
    if len(surface_rows) != len(surface["rows"]):
        raise ValueError("sung source surface contains duplicate cells")

    synthetic = synthetic_roundtrip(component_class="pitch-synchronous-breath")
    if synthetic["status"] != "pass":
        raise ValueError("T-078 synthetic independent-component round trip failed")

    by_cell: dict[tuple[str, str], list[dict[str, Any]]] = {}
    rejected = []
    for reference, trial in zip(references, manifest):
        key = (reference["register"], reference["dynamic"])
        try:
            evidence = extract_stable_residual_files(
                Path(trial["reference"]), _render_path(trial, run_root),
                f0_hz=float(reference["expectedF0Hz"]),
                active_duration_s=float(reference["durationSec"]),
                component_class="pitch-synchronous-breath",
            )
        except (FileNotFoundError, ValueError, RuntimeError) as exc:
            rejected.append({
                "vowel": reference["vowel"], "register": key[0],
                "dynamic": key[1], "sourceFile": reference.get("sourceFile"),
                "reason": str(exc),
            })
            continue
        by_cell.setdefault(key, []).append({
            "vowel": reference["vowel"],
            "sourceFile": reference.get("sourceFile"),
            "evidence": evidence,
        })

    residuals = _cell_residuals(_load(scores_path))
    cells = []
    for key, source_row in surface_rows.items():
        aggregate = aggregate_vowel_cell(
            by_cell.get(key, []), f0_hz=float(source_row["f0Hz"]),
            minimum_vowels=minimum_vowels,
        ) if by_cell.get(key) else {
            "status": "fail", "stableBands": [],
            "reason": "no temporally eligible take evidence",
        }
        criterion_residuals = residuals.get(key, {
            criterion: float("inf") for criterion in CRITERIA_ORDER
        })
        cells.append({
            "register": key[0], "dynamic": key[1],
            "sourceF0Hz": source_row["f0Hz"],
            "temporalEvidenceRows": len(by_cell.get(key, [])),
            "distinctVowels": len({row["vowel"] for row in by_cell.get(key, [])}),
            "criterionResiduals": criterion_residuals,
            "octaveResidual": aggregate,
            "limitingFactor": (
                "fit-limited-existing-source-cell"
                if aggregate["status"] == "pass"
                else "law-limited-no-cross-vowel-stable-source-residual"
            ),
        })
    cells.sort(key=lambda row: tuple(
        row["criterionResiduals"][criterion] for criterion in CRITERIA_ORDER))
    for index, row in enumerate(cells, start=1):
        row["hierarchyRank"] = index
    payload = {
        "schema": "sg2-sung-post-source-breath-octave-v1",
        "instrument": _load(scores_path)["instrument"],
        "sourceRun": run_root.name,
        "criteriaOrder": list(CRITERIA_ORDER),
        "syntheticRoundTrip": synthetic,
        "surfaceIdentity": {
            key: surface.get(key) for key in (
                "sourceIdentity", "interpolation", "dynamicComposition")
        },
        "cells": cells,
        "rejectedRows": rejected,
        "fitLimitedCells": sum(
            row["limitingFactor"].startswith("fit-limited") for row in cells),
        "lawLimitedCells": sum(
            row["limitingFactor"].startswith("law-limited") for row in cells),
        "bodyChanged": False,
        "breathParametersChanged": False,
        "humanControlsChanged": False,
    }
    payload["evidenceSha256"] = _sha(payload)
    return payload


def apply_cell(
    fit_root: Path,
    evidence: dict[str, Any],
    output_root: Path,
    *,
    register: str,
    dynamic: str,
    gain: float,
    cap_db: float = 3.0,
) -> dict[str, Any]:
    selected = next((row for row in evidence["cells"]
                     if row["register"] == register and row["dynamic"] == dynamic), None)
    if selected is None:
        raise ValueError(f"unknown sung octave-residual cell: {register}/{dynamic}")
    if not selected["limitingFactor"].startswith("fit-limited"):
        raise ValueError(f"sung octave-residual cell is law-limited: {register}/{dynamic}")
    output_root.mkdir(parents=True, exist_ok=False)
    source_fit = _load(fit_root / "SOURCE_VOWEL_FIT.json")
    original_base = source_fit["baseParams"]
    candidate_base, audit = apply_residual_to_params(
        original_base, selected["octaveResidual"], register=register,
        dynamic=dynamic, gain=gain, cap_db=cap_db,
        component_class="pitch-synchronous-breath",
        normalization_anchor="fundamental",
    )
    for name in ("toneBreath", "voiceBreathSync", "bodyBands", "humanRanges"):
        if candidate_base.get(name) != original_base.get(name):
            raise ValueError(f"T-078 candidate changed forbidden field: {name}")
    for vowel in "aeiou":
        params = _load(fit_root / f"initial-{vowel}.json")
        candidate, _ = apply_residual_to_params(
            params, selected["octaveResidual"], register=register,
            dynamic=dynamic, gain=gain, cap_db=cap_db,
            component_class="pitch-synchronous-breath",
            normalization_anchor="fundamental",
        )
        for name in ("toneBreath", "voiceBreathSync", "bodyBands", "humanRanges"):
            if candidate.get(name) != params.get(name):
                raise ValueError(f"T-078 candidate changed {vowel} forbidden field: {name}")
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(candidate, indent=2) + "\n")
    payload = copy.deepcopy(source_fit)
    payload["baseParams"] = candidate_base
    payload["sungOctaveResidualRefinement"] = {
        "method": "T-078-post-source-post-breath-cross-vowel-stable-cell",
        "evidenceSha256": evidence["evidenceSha256"],
        "cell": f"{register}/{dynamic}",
        "hierarchyRank": selected["hierarchyRank"],
        "gain": gain, "capDb": cap_db,
        "startingSurface": "selected-fit-cumulative-surface",
        "oneSourcePerSinger": True,
        "vowelBodiesChanged": False,
        "breathParametersChanged": False,
        "humanControlsChanged": False,
        "audit": audit,
    }
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n")
    analysed = fit_root / "ANALYSED_REFERENCES.json"
    if analysed.exists():
        (output_root / "ANALYSED_REFERENCES.json").write_text(analysed.read_text())
    return payload["sungOctaveResidualRefinement"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--scores", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--minimum-vowels", type=int, default=3)
    parser.add_argument("--candidate-out", type=Path)
    parser.add_argument("--register")
    parser.add_argument("--dynamic")
    parser.add_argument("--gain", type=float, default=.5)
    parser.add_argument("--cap-db", type=float, default=3.0)
    args = parser.parse_args()
    payload = evaluate(
        args.references, args.run_root, args.fit_root, args.scores,
        minimum_vowels=args.minimum_vowels,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    if args.candidate_out:
        if not args.register or not args.dynamic:
            raise ValueError("--candidate-out requires --register and --dynamic")
        apply_cell(
            args.fit_root, payload, args.candidate_out,
            register=args.register, dynamic=args.dynamic,
            gain=args.gain, cap_db=args.cap_db,
        )
    print(json.dumps({
        "instrument": payload["instrument"],
        "fitLimitedCells": payload["fitLimitedCells"],
        "lawLimitedCells": payload["lawLimitedCells"],
        "evidenceSha256": payload["evidenceSha256"],
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
