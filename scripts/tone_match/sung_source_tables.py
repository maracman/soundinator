#!/usr/bin/env python3
"""Emit A-VOICE-05 register x dynamic sung-source evidence tables.

The rows are pinned measurements: harmonic source residuals after subtracting
the already-fitted fixed-Hz vowel body.  Values remain one-source-per-singer,
pooled across vowels within each register/dynamic cell.  No engine activation
is implied until A-VOICE-05 consumes the table and passes its own audit.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any
import warnings

import numpy as np

from scripts.tone_match.sung_features import _body_transfer_db
from scripts.tone_match.sung_spectral_triage import _reference_residuals


VOICE_ORDER = ("tenor", "soprano", "bass", "mezzo")
INTERPOLATION_CONTRACT = (
    "joint log-f0 x velocity measured-hull interpolation; project to "
    "the nearest measured hull boundary outside; never rectangular extrapolation"
)
DYNAMIC_COMPOSITION = (
    "rows contain observed source shape at their measured velocity; "
    "suppress generic spectralDynamicAmount while a table row is active"
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _portable(path: Path) -> str:
    parts = path.parts
    if "sg2-data" in parts:
        return str(Path(*parts[parts.index("sg2-data"):]))
    return path.name


def _emit_rows(residuals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in residuals:
        groups.setdefault((row["register"], row["dynamic"]), []).append(row)
    emitted = []
    for (register, dynamic), rows in sorted(groups.items()):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            source_db = np.nanmedian(
                np.asarray([row["sourceDb"] for row in rows], dtype=float), axis=0,
            )
        finite = np.isfinite(source_db)
        if np.count_nonzero(finite) < 4:
            continue
        anchor = int(np.flatnonzero(finite)[0])
        source_db -= source_db[anchor]
        amplitudes = np.where(finite, 10 ** (source_db / 20), 0.0)
        counts = np.sum(np.asarray([
            np.isfinite(row["sourceDb"]) for row in rows
        ]), axis=0)
        emitted.append({
            "register": register,
            "dynamic": dynamic,
            "f0Hz": round(float(np.median([row["f0Hz"] for row in rows])), 6),
            "velocity": round(float(np.median([row["velocity"] for row in rows])), 6),
            "partials": [round(float(value), 8) for value in amplitudes],
            "observationsPerPartial": [int(value) for value in counts],
            "nNotes": len(rows),
            "vowels": sorted({row["vowel"] for row in rows}),
            "sourceFileIds": sorted({
                Path(row["sourceId"]).name for row in rows if row["sourceId"]
            }),
        })
    return emitted


def synthetic_round_trip() -> dict[str, Any]:
    bodies = {
        "a": {"bands": [
            {"freq": 700, "gain": 1.0, "width": .16},
            {"freq": 1250, "gain": .7, "width": .18},
        ]},
        "i": {"bands": [
            {"freq": 330, "gain": .8, "width": .15},
            {"freq": 2300, "gain": 1.1, "width": .18},
        ]},
    }
    analysed = []
    expected = {}
    for register, f0, register_tilt in (("low", 130.8128, -.7),
                                        ("high", 261.6256, .9)):
        for dynamic, velocity, dynamic_tilt in (("pp", .25, -.5),
                                                 ("ff", .9, .6)):
            harmonic = np.arange(1, 25, dtype=float)
            source_db = (-7.2 * np.log2(harmonic)
                         + (register_tilt + dynamic_tilt) * np.log2(harmonic))
            source_db -= source_db[0]
            expected[(register, dynamic)] = source_db
            for vowel, body in bodies.items():
                observed_db = source_db + _body_transfer_db(body["bands"], f0 * harmonic)
                amplitudes = 10 ** (observed_db / 20)
                analysed.append({
                    "reference": {
                        "vowel": vowel, "register": register,
                        "dynamic": dynamic, "velocity": velocity,
                        "sourceFile": f"synthetic-{register}-{dynamic}-{vowel}",
                    },
                    "analysis": {
                        "partial_amps": amplitudes.tolist(),
                        "partial_snr_ok": [True] * len(amplitudes),
                        "f0": f0,
                    },
                })
    rows = _emit_rows(_reference_residuals(analysed, bodies))
    maximum = 0.0
    for row in rows:
        recovered = 20 * np.log10(np.maximum(np.asarray(row["partials"]), 1e-12))
        target = expected[(row["register"], row["dynamic"])]
        maximum = max(maximum, float(np.max(np.abs(recovered - target))))
    return {
        "method": "known-source-plus-two-fixed-vowel-bodies-deconvolve-and-emit",
        "cells": len(rows),
        "maxAbsShapeErrorDb": round(maximum, 8),
        "toleranceDb": 0.01,
        "passed": maximum <= 0.01,
    }


def build_voice_table(voice: str, fit_root: Path) -> dict[str, Any]:
    fit_path = fit_root / "SOURCE_VOWEL_FIT.json"
    analysed_path = fit_root / "ANALYSED_REFERENCES.json"
    fit = json.loads(fit_path.read_text())
    analysed = json.loads(analysed_path.read_text())
    residuals = _reference_residuals(analysed, fit["fit"]["vowelBodies"])
    rows = _emit_rows(residuals)
    expected_cells = {
        (row["register"], row["dynamic"]) for row in residuals
    }
    emitted_cells = {(row["register"], row["dynamic"]) for row in rows}
    registers = sorted({row["register"] for row in residuals})
    dynamics = sorted({row["dynamic"] for row in residuals})
    rectangular_cells = {(register, dynamic) for register in registers for dynamic in dynamics}
    return {
        "instrument": f"voice-{voice}",
        "method": "fixed-vowel-body-subtraction-then-cross-vowel-cell-median",
        "sourceIdentity": fit.get("primarySinger"),
        "rows": rows,
        "coverage": {
            "expectedCells": len(expected_cells),
            "emittedCells": len(emitted_cells),
            "missingCells": [list(cell) for cell in sorted(expected_cells - emitted_cells)],
            "complete": expected_cells == emitted_cells,
            "availableEvidenceComplete": expected_cells == emitted_cells,
            "rectangularHullCells": len(rectangular_cells),
            "rectangularHullMissing": [
                list(cell) for cell in sorted(rectangular_cells - emitted_cells)
            ],
            "sparseHullCaveat": (
                "interpolate only inside measured log-f0/velocity hull; clamp outside"
            ),
        },
        "provenance": {
            "fitRoot": _portable(fit_root),
            "sourceVowelFitSha256": _sha256(fit_path),
            "analysedReferencesSha256": _sha256(analysed_path),
        },
    }


def build(specs: dict[str, Path]) -> dict[str, Any]:
    round_trip = synthetic_round_trip()
    if not round_trip["passed"]:
        raise ValueError(f"source-table synthetic round-trip failed: {round_trip}")
    tables = {voice: build_voice_table(voice, specs[voice]) for voice in VOICE_ORDER}
    if not all(table["coverage"]["complete"] for table in tables.values()):
        raise ValueError("refusing incomplete A-VOICE-05 source evidence")
    payload = {
        "schemaVersion": 1,
        "handoff": "A-VOICE-05",
        "status": "pinned-evidence-ready-engine-consumer-pending",
        "interpolationContract": INTERPOLATION_CONTRACT,
        "dynamicComposition": DYNAMIC_COMPOSITION,
        "firewall": "one source table per primary singer; rows pooled across vowels",
        "activation": "neutral/pending until engine consumer and fresh controllability audit",
        "syntheticRoundTrip": round_trip,
        "voices": tables,
    }
    payload["evidenceSha256"] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", action="append", required=True,
                        help="voice=fit-root; exactly tenor,soprano,bass,mezzo")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--calibration-out", type=Path)
    args = parser.parse_args()
    specs = {}
    for item in args.voice:
        name, separator, raw_path = item.partition("=")
        if not separator:
            raise ValueError(f"invalid --voice {item!r}; expected voice=fit-root")
        specs[name] = Path(raw_path)
    if set(specs) != set(VOICE_ORDER):
        raise ValueError(f"--voice must name exactly {VOICE_ORDER}")
    payload = build(specs)
    for path in (args.out, args.calibration_out):
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "status": payload["status"],
        "syntheticRoundTrip": payload["syntheticRoundTrip"],
        "coverage": {
            voice: payload["voices"][voice]["coverage"] for voice in VOICE_ORDER
        },
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
