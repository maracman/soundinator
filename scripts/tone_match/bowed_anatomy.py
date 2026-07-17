#!/usr/bin/env python3
"""Family-generic L16 envelope and bowed-release anatomy probe.

This is the bowed consumer of the synthetic-validated envelope machinery in
``piano_anatomy``.  It deliberately keeps two questions separate:

* L16: do lossless bowed references contain repeatable harmonic-rank or
  fixed-Hz envelope deviations from the fitted baseline?
* L18 analogue: do full tails also contain a *note-off-aligned* bow-lift
  event, rather than merely reaching the recording/room floor?

The second distinction matters because ``hasRelease`` proves a complete
tail, but it does not identify when bow contact stopped.  A tail-floor value
must not be mistaken for a physical bow-lift level or absorbed by the scalar
harmonic ``releaseDamping`` control.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np

from .piano_anatomy import (
    VALIDATION_SCHEMA,
    _baseline_and_deviants,
    _component_rows,
    _damper_candidate,
    _load,
)
from .tail_audit import analyse_tail_samples


SCHEMA = "sg2-bowed-anatomy-v1"


def _lossless(reference: dict[str, Any]) -> bool:
    source = str(reference.get("sourceFile", "")).lower()
    codec = str(reference.get("codec", "")).lower()
    return not source.endswith(".mp3") and codec not in {"mp3", "aac", "ogg"}


def _f0(reference: dict[str, Any]) -> float:
    return float(reference.get("detectedF0") or reference.get("expectedF0Hz") or
                 440 * 2 ** ((float(reference["midi"]) - 69) / 12))


def _note_off_anchor(reference: dict[str, Any]) -> float | None:
    for key in ("noteOffSec", "bowLiftSec", "releaseTimeSec"):
        value = reference.get(key)
        if isinstance(value, (int, float)) and np.isfinite(value):
            return float(value)
    return None


def extract(references_path: Path, validation_path: Path,
            output: Path, instrument: str) -> dict[str, Any]:
    validation = json.loads(validation_path.read_text())
    if (validation.get("schema") != VALIDATION_SCHEMA or
            validation.get("status") != "pass"):
        raise RuntimeError(
            "bowed anatomy extraction requires the passing L16 synthetic round trip")

    references = json.loads(references_path.read_text())
    # L16 is an envelope question, so both sustained-spectrum and onset trims
    # are admissible.  Some manifests expose two role-specific trims from the
    # same performed note; deduplicate the physical note before fitting the
    # cross-note laws so a role assignment cannot masquerade as replication.
    envelope_refs = []
    envelope_seen = set()
    for row in references:
        roles = set(row.get("roles", []))
        if not roles.intersection({"spectral", "onset"}) or not _lossless(row):
            continue
        identity = (row.get("sourceFile"), row.get("midi"),
                    row.get("dynamic"), row.get("string"))
        if identity in envelope_seen:
            continue
        envelope_seen.add(identity)
        envelope_refs.append(row)
    partial_rows: list[dict[str, Any]] = []
    band_rows: list[dict[str, Any]] = []
    analysed = []
    for reference in envelope_refs:
        samples, sample_rate = _load(Path(reference["path"]))
        note_id = (f"{reference.get('register')}:{reference.get('dynamic')}:"
                   f"{reference.get('midi')}")
        partials, bands, _ = _component_rows(
            samples, sample_rate, _f0(reference),
            float(reference.get("velocity", .62)), note_id)
        partial_rows.extend(partials)
        band_rows.extend(bands)
        analysed.append({"note": note_id, "sourceFile": reference.get("sourceFile"),
                         "partials": len(partials), "bands": len(bands)})

    rank = _baseline_and_deviants(partial_rows, "rank")
    fixed = _baseline_and_deviants(band_rows, "frequencyHz")

    # Spectral and onset rows can be different trims of the same source note.
    # Count that intervention once in the release audit.
    release_rows = []
    seen = set()
    for reference in references:
        if not reference.get("releaseEligible") or not _lossless(reference):
            continue
        identity = (reference.get("sourceFile"), reference.get("midi"),
                    reference.get("dynamic"), reference.get("string"))
        if identity in seen:
            continue
        seen.add(identity)
        samples, sample_rate = _load(Path(reference["path"]))
        tail = analyse_tail_samples(samples, sample_rate)
        knee = _damper_candidate(samples, sample_rate, _f0(reference))
        release_rows.append({
            "sourceFile": reference.get("sourceFile"),
            "register": reference.get("register"),
            "dynamic": reference.get("dynamic"),
            "midi": reference.get("midi"),
            "string": reference.get("string"),
            "noteOffSec": _note_off_anchor(reference),
            "tail": tail,
            "finalKnee": knee,
        })

    anchored = [row for row in release_rows if row["noteOffSec"] is not None]
    detected = [row for row in release_rows if row["finalKnee"].get("detected")]
    floor_values = [row["tail"]["releaseFeatures"]["releaseNoiseDb"]
                    for row in release_rows
                    if row["tail"].get("releaseFeatures")]
    semantic_status = ("measured-noteoff-aligned" if anchored else
                       "inconclusive-no-bow-lift-anchor")
    result = {
        "schema": SCHEMA,
        "instrument": instrument,
        "validation": {
            "schema": validation["schema"],
            "status": validation["status"],
            "checks": validation.get("checks", {}),
        },
        "L16": {
            "losslessEnvelopeNotes": analysed,
            "deduplication": "sourceFile+midi+dynamic+string",
            "baselinePartialLaw": rank["baseline"],
            "harmonicRankDeviants": rank["deviants"],
            "baselineBandLaw": fixed["baseline"],
            "fixedHzDeviants": fixed["deviants"],
            "classificationRule": (
                "cross-note rank commonality => bow/excitation; fixed-Hz "
                "commonality => body/radiation"),
            "classAssignmentsPinned": True,
            "status": ("measured-anomalies" if rank["deviants"] or
                       fixed["deviants"] else "no-qualified-anomaly"),
        },
        "L18BowLift": {
            "releaseEligibleLosslessNotes": len(release_rows),
            "deduplication": "sourceFile+midi+dynamic+string",
            "noteOffAlignedNotes": len(anchored),
            "finalKneeDetections": len(detected),
            "releaseNoiseFloorRangeDb": ([round(float(min(floor_values)), 3),
                                           round(float(max(floor_values)), 3)]
                                          if floor_values else None),
            "rows": release_rows,
            "status": semantic_status,
            "limitingFactor": (
                "releaseNoiseDb is the recording/room tail floor, while "
                "releaseDamping changes harmonic ring; without a labelled "
                "bow-lift time the two cannot be fitted as one physical law"),
            "requiredAcquisition": (
                "lossless single notes with labelled bow-lift/note-off time, "
                "pre/post-lift harmonic envelopes, and residual bow-contact tail"),
            "roomSuspectedResidualLoggedSeparately": True,
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--instrument", required=True)
    args = parser.parse_args(argv)
    result = extract(args.references, args.validation, args.output,
                     args.instrument)
    print(json.dumps({
        "output": str(args.output),
        "L16": result["L16"]["status"],
        "L18BowLift": result["L18BowLift"]["status"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
