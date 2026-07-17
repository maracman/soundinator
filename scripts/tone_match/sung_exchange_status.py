#!/usr/bin/env python3
"""Extract the live sung dispositions from the append-only exchange."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re


HEADING = re.compile(r"^### (T-\d+) · (.+)$", re.MULTILINE)
SUNG_STATUS = re.compile(r"\bsung=([^\s]+)")
STATUS_UPDATE_BLOCK = re.compile(
    r"^Status update[^\n]*:\s*(T-\d+)([\s\S]*?)"
    r"(?=^Status update|^### |\Z)",
    re.MULTILINE,
)


def extract(path: Path) -> dict:
    text = path.read_text()
    matches = list(HEADING.finditer(text))
    entries = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        section = text[match.end():end]
        statuses = SUNG_STATUS.findall(section)
        if statuses:
            entries.append({
                "id": match.group(1),
                "title": match.group(2),
                # A later append-only ``Status update — ...: T-nnn`` may sit
                # before the next heading. It belongs to its named ID, not to
                # the enclosing heading; STATUS_UPDATE applies it below.
                "sungStatus": statuses[0].rstrip(".,;)"),
            })
    by_id = {entry["id"]: entry for entry in entries}
    for technique_id, block in STATUS_UPDATE_BLOCK.findall(text):
        statuses = SUNG_STATUS.findall(block)
        if technique_id in by_id and statuses:
            by_id[technique_id]["sungStatus"] = statuses[-1].rstrip(".,;)")
    return {
        "schemaVersion": 1,
        "source": str(path),
        "sourceSha256": hashlib.sha256(text.encode()).hexdigest(),
        "entries": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exchange", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.exchange)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({
        "sourceSha256": result["sourceSha256"],
        "sungDispositions": len(result["entries"]),
        "out": str(args.out),
    }, indent=2))


if __name__ == "__main__":
    main()
