#!/usr/bin/env python3
"""Compatibility shim for the superseded pass-06 T-067 prototype.

The renderer-bound implementation lives in :mod:`pitch_sync_breath`.  This
module preserves the historical synthetic-round-trip API used by the pass-06
report while ensuring there is only one live observable implementation.
"""

from __future__ import annotations

import argparse
import json

from .pitch_sync_breath import synthetic_roundtrip


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
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("synthetic",))
    args = parser.parse_args(argv)
    result = synthetic_round_trip()
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
