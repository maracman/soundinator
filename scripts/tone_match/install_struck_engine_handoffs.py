#!/usr/bin/env python3
"""Install measured piano/bar handoffs into the engine-facing profile JSON.

This is deliberately a narrow adapter, not a fitter. L16/L17 values are
copied from the gated piano-anatomy artifacts. L18 consumes the register x
dynamic Zenph reference cells after matched-legato free decay is subtracted.
Notes at MIDI 90 and above are physically undamped and never receive an
extrapolated contact law.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from scripts.tone_match.paths import ROOT, sg2_data_root


PROFILE_PATH = ROOT / "web" / "static" / "measured_profiles.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _damper_rows(reference: dict) -> list[dict]:
    if reference.get("schema") != "sg2-zenph-damper-reference-v1":
        raise ValueError("unexpected Zenph damper-reference schema")
    coverage = reference.get("coverage", {})
    if (coverage.get("admittedTakes") != 333 or
            coverage.get("measuredCells") != 23 or
            coverage.get("requiredCells") != 24):
        raise ValueError("unexpected Zenph damper-reference coverage")
    undamped = reference.get("undampedZone", {})
    if undamped.get("fromMidiInclusive") != 90:
        raise ValueError("damper reference must begin the undamped zone at MIDI 90")
    cutoff = 440.0 * 2 ** ((90 - 69) / 12)
    rows = []
    for cell in reference.get("referenceRows", []):
        if cell.get("status") != "measured":
            continue
        rate = float(cell.get("damperContactDbPerSecond", {}).get("median", 0))
        velocity = float(cell.get("velocityAnchor", -1))
        if rate <= 0 or not 0 <= velocity <= 1:
            raise ValueError(f"invalid measured damper cell {cell.get('register')}:{cell.get('dynamic')}")
        if cell.get("frequencyExponent") is not None:
            raise ValueError("broadband Zenph cells may not identify a per-mode exponent")
        rows.append({
            "f0": float(cell["f0"]),
            "midi": float(cell["midiAnchor"]),
            "register": cell["register"],
            "dynamic": cell["dynamic"],
            "velocityAnchor": velocity,
            "velocityAnchorMidi": float(cell["velocityAnchorMidi"]),
            "dampDbPerSecondAtFundamental": rate,
            # Neutral, not fitted: broadband rate-vs-register is not a modal
            # frequency exponent. A future per-mode differential fit owns it.
            "frequencyExponent": 0.0,
            "frequencyExponentStatus": cell["frequencyExponentStatus"],
            "evidenceCount": int(cell["takes"]),
            "p10": float(cell["damperContactDbPerSecond"]["p10"]),
            "p90": float(cell["damperContactDbPerSecond"]["p90"]),
            "undampedAboveF0": round(cutoff, 6),
            "source": "Zenph staccato contact minus velocity-matched OLPC legato free-decay baseline",
        })
    if len(rows) != 23 or sum(row["evidenceCount"] for row in rows) != 333:
        raise ValueError("damper cell payload lost measured takes")
    return rows


def _anomaly_classes(l16: dict) -> list[dict]:
    rows = []
    for deviant in l16.get("harmonicRankDeviants", []):
        rank = int(deviant["rank"])
        rows.append({
            "id": f"piano-harmonic-rank-{rank}",
            "home": "harmonicRank",
            "ranks": [rank],
            "notes": int(deviant["notes"]),
            "onsetBoostDb": float(deviant["onsetBoostDb"]),
            "excessDecayDbPerSecond": float(deviant["excessDecayDbPerSecond"]),
            "velocitySlopeDbPerUnit": float(deviant["velocitySlopeDbPerUnit"]),
            "velocityReference": .62,
            "level": 1,
            "levelControl": "envelopeAnomalyLevel",
            "classificationPinned": True,
            "source": "corrected L16 piano-anatomy harmonic-rank assignment",
        })
    for deviant in l16.get("fixedHzDeviants", []):
        frequency = float(deviant["frequencyHz"])
        rows.append({
            "id": f"piano-fixed-{round(frequency)}hz",
            "home": "fixedHz",
            "frequencyHz": frequency,
            "widthOctaves": 1 / 6,
            "notes": int(deviant["notes"]),
            "onsetBoostDb": float(deviant["onsetBoostDb"]),
            "excessDecayDbPerSecond": float(deviant["excessDecayDbPerSecond"]),
            "velocitySlopeDbPerUnit": float(deviant["velocitySlopeDbPerUnit"]),
            "velocityReference": .62,
            "level": 1,
            "levelControl": "envelopeAnomalyLevel",
            "classificationPinned": True,
            "source": "corrected L16 piano-anatomy fixed-Hz assignment",
        })
    if not rows or not all(row["onsetBoostDb"] > 0 for row in rows):
        raise ValueError("corrected L16 anomaly rows are absent or invalid")
    return rows


def install(check_only: bool = False) -> dict:
    data = sg2_data_root()
    l17_path = data / "analysis" / "piano-anatomy" / "grand-piano.json"
    l16_path = data / "analysis" / "piano-anatomy" / "grand-piano-corrected.json"
    provenance_path = data / "samples" / "piano-grand" / "PROVENANCE.json"
    damper_reference_path = (data / "analysis" / "struck-pass18" /
                             "zenph-damper-reference.json")
    upright_l16_path = (data / "analysis" / "struck-pass20" /
                        "piano-upright-corrected.json")
    upright_scout_path = (data / "acquisition" / "piano-upright" /
                          "bivib-2573232" / "scout" / "SCOUT.json")
    l17 = _load(l17_path).get("L17", {})
    l16 = _load(l16_path).get("L16", {})
    if l17.get("status") != "measured" or l17.get("profilePinned") is not True:
        raise ValueError("refusing unmeasured/unpinned L17 piano action component")
    if len(l17.get("envelope", {}).get("points", [])) < 20:
        raise ValueError("refusing reduced L17 point envelope")
    damper_rows = _damper_rows(_load(damper_reference_path))
    profiles = _load(PROFILE_PATH)
    piano = profiles["piano"]
    piano["preOnsetComponents"] = [l17]
    piano["envelopeAnomalyClasses"] = _anomaly_classes(l16)
    piano["damperByRegister"] = damper_rows
    piano.setdefault("provenance", {})["engineHandoffs"] = {
        "schema": "sg2-piano-engine-handoffs-v2",
        "l16Sha256": _sha256(l16_path),
        "l17Sha256": _sha256(l17_path),
        "l18ProvenanceSha256": _sha256(provenance_path),
        "l18ReferenceSha256": _sha256(damper_reference_path),
        "verifiedDamperTakes": sum(row["evidenceCount"] for row in damper_rows),
        "measuredDamperCells": len(damper_rows),
        "requiredDamperCells": 24,
        "missingDamperCells": ["treble:pp"],
        "matchedLegatoBaselineSubtracted": True,
        "damperFrequencyExponent": 0.0,
        "damperFrequencyExponentStatus": "neutral-unidentified-zero-weight",
        "undampedFromMidi": 90,
        "undampedPolicy": "natural held-string decay; never extrapolate lower-note damper contact",
    }
    upright_artifact = _load(upright_l16_path)
    upright_l16 = upright_artifact.get("L16", {})
    upright_l17 = upright_artifact.get("L17", {})
    upright_l18 = upright_artifact.get("L18", {})
    if upright_l17.get("status") != "insufficient-pre-roll":
        raise ValueError("upright L17 must remain blocked until pre-roll is measured")
    if upright_l18.get("status") != "blocked-incomplete-physical-damper-fit":
        raise ValueError("unexpected upright L18 gate status")
    if upright_l18.get("damperByRegister"):
        raise ValueError("upright L18 may not install ungated damper diagnostics")
    upright = profiles["piano-upright"]
    upright["envelopeAnomalyClasses"] = _anomaly_classes(upright_l16)
    # Deliberately omit preOnsetComponents and damperByRegister. The source
    # corpus cannot identify the former, while the latter failed its physical
    # modal-fit gate. Grand-piano action and damper values are not transferable.
    upright.setdefault("provenance", {})["engineHandoffs"] = {
        "schema": "sg2-upright-engine-handoffs-v1",
        "l16Sha256": _sha256(upright_l16_path),
        "l16Status": "measured-installed",
        "l16AnomalyClasses": len(upright["envelopeAnomalyClasses"]),
        "l17Status": "blocked-insufficient-pre-roll",
        "l17ScoutSha256": _sha256(upright_scout_path),
        "l17ScoutDecision": "fetch-upright-archive",
        "l18Status": "blocked-incomplete-physical-damper-fit",
        "l18DetectedKnees": len(upright_l18.get("damperDetections", [])),
        "l18InstalledDamperRows": 0,
        "constructionFirewall": "no grand-piano L17/L18 value transfer",
    }
    if not check_only:
        PROFILE_PATH.write_text(json.dumps(profiles, indent=1) + "\n")
    return {
        "piano": piano["provenance"]["engineHandoffs"],
        "piano-upright": upright["provenance"]["engineHandoffs"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="validate sources and construct payload without writing")
    args = parser.parse_args()
    print(json.dumps(install(args.check), indent=2))


if __name__ == "__main__":
    main()
