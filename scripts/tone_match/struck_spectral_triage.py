#!/usr/bin/env python3
"""Hierarchy-first residual triage for struck/plucked spectral failures."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from .piano_anatomy import (
    VALIDATION_SCHEMA,
    _baseline_and_deviants,
    _component_rows,
    _load,
)


SCHEMA = "sg2-struck-spectral-triage-v1"
CRITERIA_ORDER = ("partial-table", "mel-spectrogram", "attack-t90", "band-balance")


def triage(references_path: Path, summary_path: Path, validation_path: Path,
           output: Path) -> dict[str, Any]:
    validation = json.loads(validation_path.read_text())
    if validation.get("schema") != VALIDATION_SCHEMA or validation.get("status") != "pass":
        raise RuntimeError("L16 real-corpus triage requires the corrected synthetic gate")
    references = json.loads(references_path.read_text())
    summary = json.loads(summary_path.read_text())

    partial_rows: list[dict[str, Any]] = []
    band_rows: list[dict[str, Any]] = []
    for ref in references:
        samples, sample_rate = _load(Path(ref["path"]))
        f0 = float(ref.get("expectedF0Hz") or ref.get("detectedF0"))
        note = f"{ref['register']}:{ref['dynamic']}:{ref['midi']}"
        partials, bands, _ = _component_rows(
            samples, sample_rate, f0, float(ref["velocity"]), note,
        )
        partial_rows.extend(partials)
        band_rows.extend(bands)
    rank = _baseline_and_deviants(partial_rows, "rank")
    fixed = _baseline_and_deviants(band_rows, "frequencyHz")

    bars = summary["tripwires"]["bars"]
    criteria = []
    for bar in CRITERIA_ORDER:
        rows = [row for row in bars if row["bar"] == bar]
        criteria.append({
            "criterion": bar,
            "pass": sum(row["status"] == "pass" for row in rows),
            "fail": sum(row["status"] == "fail" for row in rows),
            "notApplicable": sum(row["status"] == "not-applicable" for row in rows),
            "cells": rows,
        })
    first_unresolved = next((row["criterion"] for row in criteria if row["fail"]), None)

    anomaly_count = len(rank["deviants"]) + len(fixed["deviants"])
    result = {
        "schema": SCHEMA,
        "instrument": summary["instrument"],
        "sourceRun": summary["run"],
        "sourceSummarySha256": hashlib.sha256(summary_path.read_bytes()).hexdigest(),
        "validation": {
            "schema": validation["schema"], "status": validation["status"],
            "correctedSemantics": (
                "onset-only boost over the mode's extrapolated early law + "
                "excess early decay + positive velocity slope"
            ),
        },
        "criteriaOrder": list(CRITERIA_ORDER),
        "criteria": criteria,
        "firstUnresolvedCriterion": first_unresolved,
        "maskingConclusion": (
            "all downstream whole-note mel and sustained band-balance cells "
            "remain masked while every steady-state partial-table cell fails"
            if first_unresolved == "partial-table" else
            "follow the first unresolved criterion in criteriaOrder"
        ),
        "L16": {
            "scope": (
                "guitar pick/finger transients are explicitly in protocol; "
                "values remain nylon-corpus identity evidence"
            ),
            "baselinePartialLaw": rank["baseline"],
            "harmonicRankDeviants": rank["deviants"],
            "baselineBandLaw": fixed["baseline"],
            "fixedHzDeviants": fixed["deviants"],
            "partialEnvelopeRows": len(partial_rows),
            "bandEnvelopeRows": len(band_rows),
        },
        "residualVerdict": {
            "anomaliesPresent": anomaly_count > 0,
            "anomalyClasses": anomaly_count,
            "explainsAll18SpectralFailures": False,
            "reason": (
                "L16 classes are onset-only deviations. The partial-table "
                "feature is measured from the middle half of each note and "
                "fails all six cells; the six attack-T90 cells already pass. "
                "Anomaly consumption can improve onset/whole-note colour but "
                "cannot replace per-course/register/dynamic steady identity."
            ),
            "nextIdentityControl": (
                "per-course register/dynamic partial tables first; T-028 "
                "contact-time law next for onset corner after the steady tier"
            ),
            "anomalyConsumerAction": (
                "retain the measured nylon rank/fixed-Hz classes for T-069, "
                "but do not use them to waive or down-rank a partial-table failure"
            ),
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    result = triage(args.references, args.summary, args.validation, args.output)
    print(json.dumps({
        "instrument": result["instrument"],
        "firstUnresolvedCriterion": result["firstUnresolvedCriterion"],
        "anomalyClasses": result["residualVerdict"]["anomalyClasses"],
        "explainsAll18": result["residualVerdict"]["explainsAll18SpectralFailures"],
        "output": str(args.output),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
