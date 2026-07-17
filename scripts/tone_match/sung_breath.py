#!/usr/bin/env python3
"""Compatibility facade for the superseded pass-06 T-067 prototype.

The renderer-bound observable lives in :mod:`pitch_sync_breath`.  The pass-07
room-decay seam is re-exported from :mod:`sung_room_decay`, which uses the
canonical separator rather than reviving the whole-note least-squares path.
"""

from __future__ import annotations

import argparse
import json

from .pitch_sync_breath import synthetic_roundtrip
from .sung_room_decay import (
    assess_canonical_room,
    assess_room_decay,
    synthetic_room_decay_round_trip,
)


def synthetic_round_trip(**_kwargs):
    result = synthetic_roundtrip()
    prominence = float(result["recovered"]["prominenceDb"])
    return {
        "schemaVersion": 2,
        "method": result["method"],
        "passed": result["status"] == "pass",
        "measured": {
            "peakErrorPercent": 100 * float(
                result["errors"]["frequencyFraction"]
            ),
            "pitch_sync_breath_db": prominence,
            "pitchSyncBreathDb": prominence,
        },
        "prominenceErrorDb": float(result["errors"]["prominenceDb"]),
        "canonicalSchema": result["schema"],
        "compatibility": "superseded-pass06-api",
        "roomDecayRoundTrip": synthetic_room_decay_round_trip(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("synthetic",))
    parser.parse_args(argv)
    result = synthetic_round_trip()
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
