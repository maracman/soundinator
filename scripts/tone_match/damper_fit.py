#!/usr/bin/env python3
"""Build L18 damper targets from paired Zenph staccato/legato takes.

The OLPC report already contains one mechanically verified damper event per
staccato take plus the T40 of its velocity-matched legato sibling.  This
module turns those per-take observations into register x dynamic reference
cells without confusing the undamped string decay with damper contact.

The output is evidence for a renderer fit, not a fitted engine table.  In
particular the broadband report cannot identify the damper's per-mode
frequency exponent, so that field is deliberately left unresolved rather
than filled with a physics-shaped guess.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "sg2-zenph-damper-reference-v1"

REGISTERS = (
    ("sub-bass", 21, 35),
    ("bass", 36, 47),
    ("low-mid", 48, 59),
    ("mid", 60, 71),
    ("high-mid", 72, 83),
    ("treble", 84, 89),
)

DYNAMICS = (
    ("pp", 1, 31),
    ("p", 32, 63),
    ("mf", 64, 95),
    ("f-ff", 96, 127),
)


def _bucket(value: int, rows: tuple[tuple[str, int, int], ...]) -> str | None:
    return next((name for name, low, high in rows if low <= value <= high), None)


def _percentiles(values: list[float]) -> dict[str, float]:
    samples = np.asarray(values, dtype=float)
    return {
        "p10": round(float(np.percentile(samples, 10)), 3),
        "median": round(float(np.median(samples)), 3),
        "p90": round(float(np.percentile(samples, 90)), 3),
    }


def _take_path(root: Path | None, midi: int, velocity: int, suffix: str) -> str | None:
    if root is None:
        return None
    names = (f"pno{midi:03d}v{velocity}{suffix}.wav",
             f"pno{midi}v{velocity}{suffix}.wav")
    found = next((root / name for name in names if (root / name).is_file()), None)
    if found is None:
        raise FileNotFoundError(
            f"missing OLPC take for MIDI {midi}, velocity {velocity}, {suffix}"
        )
    return str(found.resolve())


def build_reference(report_path: Path, output: Path,
                    extracted_root: Path | None = None) -> dict[str, Any]:
    per_take = json.loads(report_path.read_text())
    if not isinstance(per_take, list):
        raise ValueError("Zenph damper report must be a list of per-take rows")

    admitted: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    for source in per_take:
        midi = int(source["midi"])
        velocity = int(source["vel"])
        if midi >= 90:
            exclusions.append({
                "file": source["file"], "midi": midi, "velocity": velocity,
                "reason": "physical undamped zone at and above MIDI 90",
            })
            continue
        register = _bucket(midi, REGISTERS)
        dynamic = _bucket(velocity, DYNAMICS)
        if not source.get("damperEvent") or register is None or dynamic is None:
            exclusions.append({
                "file": source["file"], "midi": midi, "velocity": velocity,
                "reason": "missing verified event or outside declared fit grid",
            })
            continue
        legato_t40 = float(source["legT40"])
        observed_rate = abs(float(source["dampRateDbPerSec"]))
        # T40 is a duration-robust matched-sibling measure.  Subtracting its
        # average free-decay rate keeps the engine target additive: L18 first
        # continues the undamped string law, then adds damper contact.
        undamped_rate = 40.0 / legato_t40
        contact_rate = max(0.0, observed_rate - undamped_rate)
        admitted.append({
            "file": source["file"], "midi": midi, "velocity": velocity,
            "staccatoTake": _take_path(extracted_root, midi, velocity, "sta"),
            "register": register, "dynamic": dynamic,
            "matchedLegatoVelocity": int(source["legVelMatched"]),
            "matchedLegatoTake": _take_path(
                extracted_root, midi, int(source["legVelMatched"]), "leg"),
            "legatoT40Seconds": legato_t40,
            "undampedBaselineDbPerSecond": undamped_rate,
            "observedPostKneeDbPerSecond": observed_rate,
            "damperContactDbPerSecond": contact_rate,
            "legatoToStaccatoT40Ratio": float(source["legStaT40Ratio"]),
        })

    cells: list[dict[str, Any]] = []
    for register, midi_low, midi_high in REGISTERS:
        for dynamic, velocity_low, velocity_high in DYNAMICS:
            members = [row for row in admitted
                       if row["register"] == register and row["dynamic"] == dynamic]
            if not members:
                cells.append({
                    "register": register, "dynamic": dynamic,
                    "midiSpan": [midi_low, midi_high],
                    "velocitySpan": [velocity_low, velocity_high],
                    "status": "no-evidence", "takes": 0,
                })
                continue
            midi_anchor = float(np.median([row["midi"] for row in members]))
            cells.append({
                "register": register, "dynamic": dynamic,
                "midiSpan": [midi_low, midi_high],
                "velocitySpan": [velocity_low, velocity_high],
                "status": "measured", "takes": len(members),
                "midiAnchor": round(midi_anchor, 3),
                "f0": round(440 * 2 ** ((midi_anchor - 69) / 12), 4),
                "observedPostKneeDbPerSecond": _percentiles([
                    row["observedPostKneeDbPerSecond"] for row in members]),
                "undampedBaselineDbPerSecond": _percentiles([
                    row["undampedBaselineDbPerSecond"] for row in members]),
                "damperContactDbPerSecond": _percentiles([
                    row["damperContactDbPerSecond"] for row in members]),
                "legatoToStaccatoT40Ratio": _percentiles([
                    row["legatoToStaccatoT40Ratio"] for row in members]),
                "frequencyExponent": None,
                "frequencyExponentStatus": (
                    "unidentified-by-broadband-per-take-report; retain zero "
                    "weight until a per-mode differential fit passes"
                ),
            })

    required = len(REGISTERS) * len(DYNAMICS)
    measured = sum(row["status"] == "measured" for row in cells)
    result = {
        "schema": SCHEMA,
        "instrument": "grand-piano",
        "sourceReport": str(report_path.resolve()),
        "sourceReportSha256": hashlib.sha256(report_path.read_bytes()).hexdigest(),
        "extractedTakeRoot": (
            str(extracted_root.resolve()) if extracted_root is not None else None
        ),
        "fitSemantics": (
            "damperContact = abs(staccato post-knee rate) - 40/legato T40; "
            "the matched legato sibling is the undamped baseline"
        ),
        "coverage": {
            "admittedTakes": len(admitted), "measuredCells": measured,
            "requiredCells": required,
            "status": "complete" if measured == required else "incomplete",
        },
        "undampedZone": {
            "fromMidiInclusive": 90,
            "dampDbPerSecondAtFundamental": 0.0,
            "frequencyExponent": 0.0,
            "basis": (
                "grand-piano dampers end near MIDI 88-90; OLPC staccato takes "
                "at/above 90 show no verified damper knee"
            ),
            "rendererRequirement": (
                "MIDI >= 90 bypasses damper contact; do not interpolate or "
                "clamp the last damped row upward"
            ),
        },
        "referenceRows": cells,
        "perTakeRows": admitted,
        "exclusions": exclusions,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--extracted-root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    result = build_reference(args.report, args.output, args.extracted_root)
    print(json.dumps({"status": result["coverage"]["status"],
                      **result["coverage"], "output": str(args.output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
