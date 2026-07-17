#!/usr/bin/env python3
"""Generate a durable all-lane status snapshot from the live exchange."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from scripts.tone_match.iterate import _technique_exchange_statuses


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exchange", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    text = args.exchange.read_text()
    payload = {
        "schemaVersion": 1,
        "source": str(args.exchange),
        "sourceSha256": hashlib.sha256(text.encode()).hexdigest(),
        "entries": _technique_exchange_statuses(),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "sourceSha256": payload["sourceSha256"],
        "entries": len(payload["entries"]),
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
