#!/usr/bin/env python3
"""Install measured piano/bar handoffs into the engine-facing profile JSON.

This is deliberately a narrow adapter, not a fitter. L16/L17 values are
copied from the gated piano-anatomy artifacts and L18 is aggregated from the
333 provenance-pinned Zenph staccato damper events. Notes at MIDI 90 and above
are marked physically undamped and never receive an extrapolated contact law.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import statistics
from pathlib import Path

from scripts.tone_match.paths import ROOT, sg2_data_root


PROFILE_PATH = ROOT / "web" / "static" / "measured_profiles.json"


def _load(path: Path) -> dict:
    return json.loads(path.read_text())


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _midi_hz(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def _damper_rows(provenance: dict) -> tuple[list[dict], float]:
    takes = [row for row in provenance.get("files", [])
             if str(row.get("file", "")).startswith("zenph.sta_")]
    if len(takes) != 333:
        raise ValueError(f"expected 333 verified Zenph damper takes, got {len(takes)}")
    if max(int(row["midi"]) for row in takes) >= 90:
        raise ValueError("undamped MIDI 90+ take entered the damper evidence set")
    grouped: dict[int, list[float]] = {}
    for take in takes:
        rate = abs(float(take.get("damper", {}).get("dampRateDbPerSec", 0)))
        if rate <= 0:
            raise ValueError(f"missing positive damper rate for {take.get('file')}")
        grouped.setdefault(int(take["midi"]), []).append(rate)
    medians = {midi: statistics.median(values)
               for midi, values in sorted(grouped.items())}
    xs = [math.log(_midi_hz(midi)) for midi in medians]
    ys = [math.log(rate) for rate in medians.values()]
    x_mean, y_mean = statistics.mean(xs), statistics.mean(ys)
    exponent = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys)) / sum(
        (x - x_mean) ** 2 for x in xs)
    cutoff = _midi_hz(90)
    rows = []
    for midi, rate in medians.items():
        rows.append({
            "f0": round(_midi_hz(midi), 6),
            "midi": midi,
            "dampDbPerSecondAtFundamental": round(rate, 4),
            "frequencyExponent": round(exponent, 6),
            "evidenceCount": len(grouped[midi]),
            "undampedAboveF0": round(cutoff, 6),
            "source": "333 verified Zenph staccato key-release takes; per-file damper metrics in PROVENANCE.json",
        })
    return rows, exponent


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
    l17 = _load(l17_path).get("L17", {})
    l16 = _load(l16_path).get("L16", {})
    if l17.get("status") != "measured" or l17.get("profilePinned") is not True:
        raise ValueError("refusing unmeasured/unpinned L17 piano action component")
    if len(l17.get("envelope", {}).get("points", [])) < 20:
        raise ValueError("refusing reduced L17 point envelope")
    damper_rows, exponent = _damper_rows(_load(provenance_path))
    profiles = _load(PROFILE_PATH)
    piano = profiles["piano"]
    piano["preOnsetComponents"] = [l17]
    piano["envelopeAnomalyClasses"] = _anomaly_classes(l16)
    piano["damperByRegister"] = damper_rows
    piano.setdefault("provenance", {})["engineHandoffs"] = {
        "schema": "sg2-piano-engine-handoffs-v1",
        "l16Sha256": _sha256(l16_path),
        "l17Sha256": _sha256(l17_path),
        "l18ProvenanceSha256": _sha256(provenance_path),
        "verifiedDamperTakes": sum(row["evidenceCount"] for row in damper_rows),
        "damperRegisterExponent": round(exponent, 6),
        "undampedFromMidi": 90,
        "undampedPolicy": "natural held-string decay; never extrapolate lower-note damper contact",
    }
    if not check_only:
        PROFILE_PATH.write_text(json.dumps(profiles, indent=1) + "\n")
    return piano["provenance"]["engineHandoffs"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="validate sources and construct payload without writing")
    args = parser.parse_args()
    print(json.dumps(install(args.check), indent=2))


if __name__ == "__main__":
    main()
