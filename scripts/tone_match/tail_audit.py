#!/usr/bin/env python3
"""Decision-13 mechanical reference-tail audit.

Labels each campaign reference ``hasRelease`` versus truncated, tags phrase/
legato material for future transition work, and exposes release measurements
only for eligible full-tail single notes. No release metric receives weight
until a responsive note-off control passes a fresh controllability audit.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np

from .analysis import load_mono
from .paths import sg2_data_root


TAIL_AUDIT_VERSION = "sg2-tail-audit-v1"
_PHRASE = re.compile(r"(?:^|[._\-])(phrase|legato)(?:[._\-]|$)", re.I)


def phrase_take(reference: dict[str, Any]) -> bool:
    text = " ".join(str(reference.get(key, ""))
                    for key in ("sourceFile", "path", "articulation"))
    return bool(_PHRASE.search(text))


def analyse_tail_samples(samples: np.ndarray, sample_rate: int) -> dict[str, Any]:
    samples = np.asarray(samples, dtype=float)
    frame = max(32, round(.020 * sample_rate))
    hop = max(16, round(.010 * sample_rate))
    if samples.size < frame * 8:
        return {"version": TAIL_AUDIT_VERSION, "status": "insufficient-audio",
                "hasRelease": False, "releaseFeatures": None}
    frames = np.lib.stride_tricks.sliding_window_view(samples, frame)[::hop]
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-20)
    peak = float(np.max(rms))
    if peak <= 1e-9:
        return {"version": TAIL_AUDIT_VERSION, "status": "silent",
                "hasRelease": False, "releaseFeatures": None}
    db = 20 * np.log10(np.maximum(rms / peak, 1e-8))
    peak_index = int(np.argmax(rms))
    noise_floor_db = float(np.median(np.sort(db)[:max(3, len(db) // 5)]))
    floor_threshold_db = max(-45.0, noise_floor_db + 6.0)
    quiet = db <= floor_threshold_db
    quiet_run = max(3, round(.050 / (hop / sample_rate)))
    first_quiet = None
    for index in range(peak_index + 1, max(peak_index + 1, len(quiet) - quiet_run + 1)):
        if bool(np.all(quiet[index:index + quiet_run])):
            first_quiet = index
            break
    tail_frames = max(quiet_run, round(.100 / (hop / sample_rate)))
    tail_median_db = float(np.median(db[-tail_frames:]))
    has_release = bool(first_quiet is not None and
                       first_quiet < len(db) - quiet_run and
                       tail_median_db <= floor_threshold_db)
    features = None
    if has_release and first_quiet is not None:
        # The release begins at the final -6 dB crossing before the floor.
        above_six = np.flatnonzero(db[peak_index:first_quiet + 1] >= -6.0)
        release_start = (peak_index + int(above_six[-1])) if above_six.size else peak_index
        ring_ms = max(0.0, (first_quiet - release_start) * hop / sample_rate * 1000)
        segment = db[release_start:first_quiet + 1]
        times = np.arange(len(segment), dtype=float) * hop / sample_rate
        damp = 0.0
        if len(segment) >= 3 and float(np.ptp(times)) > 0:
            damp = max(0.0, -float(np.polyfit(times, segment, 1)[0]))
        features = {
            "releaseRingMs": ring_ms,
            "releaseDampDbPerSecond": damp,
            "releaseNoiseDb": noise_floor_db,
        }
    return {
        "version": TAIL_AUDIT_VERSION,
        "status": "full-tail" if has_release else "truncated",
        "hasRelease": has_release,
        "durationSec": samples.size / sample_rate,
        "noiseFloorDb": noise_floor_db,
        "floorThresholdDb": floor_threshold_db,
        "tailMedianDb": tail_median_db,
        "firstNoiseFloorSec": (first_quiet * hop / sample_rate
                               if first_quiet is not None else None),
        "releaseFeatures": features,
    }


def audit_reference(reference: dict[str, Any]) -> dict[str, Any]:
    samples, sample_rate = load_mono(str(reference["path"]))
    audit = analyse_tail_samples(samples, sample_rate)
    is_phrase = phrase_take(reference)
    return {
        **reference,
        "hasRelease": bool(audit["hasRelease"]),
        "phraseTake": is_phrase,
        "transitionMaterial": "future-unscored" if is_phrase else None,
        "releaseEligible": bool(audit["hasRelease"] and not is_phrase),
        "tailAudit": audit,
    }


def audit_references(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Apply the corpus gate at manifest-build time as well as retroactively."""
    return [audit_reference(reference) for reference in references]


def audit_manifest(path: Path) -> dict[str, Any]:
    references = json.loads(path.read_text())
    audited = audit_references(references)
    path.write_text(json.dumps(audited, indent=2) + "\n")
    return {
        "manifest": str(path), "references": len(audited),
        "hasRelease": sum(row["hasRelease"] for row in audited),
        "truncated": sum(not row["hasRelease"] for row in audited),
        "phraseTakes": sum(row["phraseTake"] for row in audited),
        "releaseEligible": sum(row["releaseEligible"] for row in audited),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--references", type=Path, action="append")
    parser.add_argument("--all", action="store_true",
                        help="audit every SG2_DATA campaign references.json")
    args = parser.parse_args(argv)
    paths = list(args.references or [])
    if args.all:
        paths.extend(sorted((sg2_data_root() / "campaigns").glob(
            "*/references.json")))
    paths = list(dict.fromkeys(path.resolve() for path in paths))
    if not paths:
        parser.error("provide --references or --all")
    reports = [audit_manifest(path) for path in paths]
    output = sg2_data_root() / "state" / "tail-audit.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"version": TAIL_AUDIT_VERSION,
                                  "manifests": reports}, indent=2) + "\n")
    print(json.dumps({"output": str(output), "manifests": reports}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
