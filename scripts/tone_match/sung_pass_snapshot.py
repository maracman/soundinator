#!/usr/bin/env python3
"""Generate hashed sung pass-end gate and controllability snapshots."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


VOICE_ORDER = ("tenor", "soprano", "bass", "mezzo")


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _seal(payload: dict[str, Any], key: str) -> dict[str, Any]:
    payload[key] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    return payload


def _entry(row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: row[key] for key in (
            "entryNumber", "kind", "run", "status", "shipEligible",
            "meanComposite", "objectiveHash", "manifestHash", "gates",
            "legacyPrior", "isLeader",
        ) if key in row
    }


def build(pass_name: str, state_root: Path, run_root: Path,
          consonant_audits: list[Path] | None = None,
          source_audits: list[Path] | None = None) -> tuple[dict, dict]:
    gate_voices = {}
    identity = {}
    for voice in VOICE_ORDER:
        instrument = f"voice-{voice}"
        board_path = state_root / instrument / "leaderboard.json"
        board = _load(board_path)
        best = board["best"]
        gate_voices[voice] = {
            "leaderboardSha256": _sha256(board_path),
            "objectiveHash": board["objectiveHash"],
            "leader": best["run"],
            "entries": [_entry(row) for row in board["runs"]],
        }
        identity[voice] = {
            "objectiveHash": best["objectiveHash"],
            "manifestHash": best["manifestHash"],
            "run": best["run"],
            "status": "clean-current-objective",
        }
    gates = _seal({
        "schemaVersion": 2,
        "pass": pass_name,
        "voices": gate_voices,
    }, "snapshotSha256")

    consonants = {}
    for path in consonant_audits or []:
        audit = _load(path)
        consonants[audit["instrument"]] = {
            "objectiveHash": audit["objectiveHash"],
            "auditSha256": audit["auditSha256"],
            "rendererSha256": audit["rendererSha256"],
            "status": audit["status"],
            "activationAllowed": audit["activationAllowed"],
            "midi": audit.get("outputAudit", {}).get("midi"),
            "repeatNoiseFloorRelativeDifferenceDb": audit.get(
                "outputAudit", {}
            ).get("repeatNoiseFloorRelativeDifferenceDb"),
            "weights": audit["earnedFeatureWeights"],
            "responders": audit.get("outputAudit", {}).get(
                "featureResponders", {}
            ),
        }
    sources = {}
    for path in source_audits or []:
        audit = _load(path)
        sources[audit["instrument"]] = {
            key: audit.get(key) for key in (
                "status", "passed", "auditSha256", "rendererContractHash",
                "sourceEvidenceSha256", "responsiveFeatures",
            )
        }
    controllability = _seal({
        "schemaVersion": 2,
        "pass": pass_name,
        "identity": identity,
        "consonantAuxiliary": consonants,
        "sourceSurface": sources,
    }, "tableSha256")
    run_root.mkdir(parents=True, exist_ok=True)
    (run_root / "PASS_END_GATE_SNAPSHOT.json").write_text(
        json.dumps(gates, indent=2) + "\n"
    )
    (run_root / "CONTROLLABILITY_TABLE.json").write_text(
        json.dumps(controllability, indent=2) + "\n"
    )
    return gates, controllability


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pass-name", required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--consonant-audit", action="append", type=Path)
    parser.add_argument("--source-audit", action="append", type=Path)
    args = parser.parse_args()
    gates, controllability = build(
        args.pass_name, args.state_root, args.run_root,
        args.consonant_audit, args.source_audit,
    )
    print(json.dumps({
        "gateSnapshotSha256": gates["snapshotSha256"],
        "controllabilityTableSha256": controllability["tableSha256"],
        "voices": len(gates["voices"]),
        "consonantAudits": len(controllability["consonantAuxiliary"]),
        "sourceAudits": len(controllability["sourceSurface"]),
    }, indent=2))


if __name__ == "__main__":
    main()
