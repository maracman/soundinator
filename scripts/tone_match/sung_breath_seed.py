#!/usr/bin/env python3
"""Bind an evidence-gated T-067 breath seed into a sung FIT root."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


def seed_breath(fit_root: Path, output_root: Path, evidence_path: Path,
                calibration_path: Path, amount: float) -> dict[str, Any]:
    evidence = json.loads(evidence_path.read_text())
    calibration = json.loads(calibration_path.read_text())
    median = evidence.get("pitchSyncBreathDb", {}).get("median")
    if evidence.get("status") != "pass" or median is None or float(median) < 6:
        raise ValueError("T-067 lossless corpus evidence is not activation-eligible")
    if not 0 < float(amount) <= 0.6:
        raise ValueError("voiceBreathSync seed must be in (0, 0.6]")
    if evidence.get("roomSuspectedRows", 0) > evidence.get("measuredRows", 0):
        raise ValueError("invalid room-residual accounting")
    voice_class = evidence.get("voiceClass")
    expected = calibration.get("provisionalVoiceBreathSync", {}).get(voice_class)
    if calibration.get("schema") != "sg2-pitch-sync-breath-calibration-v1":
        raise ValueError("unsupported T-067 engine calibration")
    if expected is None or abs(float(expected) - float(amount)) > 1e-9:
        raise ValueError("seed does not match the engine-curve inversion")

    provenance = {
        "method": "bounded-monotone-engine-curve-seed",
        "status": "provisional-candidate-pending-fit-score",
        "voiceClass": voice_class,
        "voiceBreathSync": float(amount),
        "referenceMedianPitchSyncBreathDb": float(median),
        "referenceRows": int(evidence.get("cleanBreathRows", 0)),
        "roomSuspectedRowsExcluded": int(evidence.get("roomSuspectedRows", 0)),
        "corpusEvidence": str(evidence_path),
        "corpusEvidenceSha256": hashlib.sha256(evidence_path.read_bytes()).hexdigest(),
        "engineCalibration": str(calibration_path),
        "engineCalibrationSha256": hashlib.sha256(
            calibration_path.read_bytes()
        ).hexdigest(),
        "fitFrozen": False,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    for vowel in "aeiou":
        params = json.loads((fit_root / f"initial-{vowel}.json").read_text())
        params["voiceBreathSync"] = float(amount)
        params["pitchSyncBreathSeed"] = provenance
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )
    source_fit = json.loads((fit_root / "SOURCE_VOWEL_FIT.json").read_text())
    source_fit["baseParams"]["voiceBreathSync"] = float(amount)
    source_fit["pitchSyncBreathSeed"] = provenance
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(source_fit, indent=2) + "\n"
    )
    analysed = fit_root / "ANALYSED_REFERENCES.json"
    if analysed.exists():
        (output_root / "ANALYSED_REFERENCES.json").write_text(analysed.read_text())
    return provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--calibration", type=Path, required=True)
    parser.add_argument("--amount", type=float, required=True)
    args = parser.parse_args()
    print(json.dumps(seed_breath(
        args.fit_root, args.out, args.evidence, args.calibration, args.amount,
    ), indent=2))


if __name__ == "__main__":
    main()
