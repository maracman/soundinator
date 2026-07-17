#!/usr/bin/env python3
"""Constrain fitted vowel centres to the independent annex regions.

The alternating fit estimates formants from sparse harmonics.  A fitted centre
is not allowed to redefine its own construction box: when it falls outside the
voice-class-scaled annex region, move only that centre (and its corresponding
emitted Gaussian band) to the nearest boundary.  Source values and all body
gains/widths remain unchanged for the subsequent render-domain source co-fit.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from scripts.tone_match.sung_features import vowel_regions_for_class


def constrain(fit_root: Path, output_root: Path, voice_class: str) -> dict[str, Any]:
    source_fit = json.loads((fit_root / "SOURCE_VOWEL_FIT.json").read_text())
    regions = vowel_regions_for_class(voice_class)
    bodies = source_fit["fit"]["vowelBodies"]
    changes = []
    for vowel, body in bodies.items():
        centres = body.get("formantsHz", [])
        bands = body.get("bands", [])
        for index, bounds in enumerate(regions[vowel][:2]):
            if index >= len(centres) or index >= len(bands):
                continue
            old = float(centres[index])
            new = min(max(old, float(bounds[0])), float(bounds[1]))
            if abs(new - old) <= 1e-9:
                continue
            centres[index] = round(new, 3)
            bands[index]["freq"] = round(new, 3)
            changes.append({
                "vowel": vowel,
                "formant": index + 1,
                "oldHz": old,
                "newHz": round(new, 3),
                "annexBoundsHz": [float(bounds[0]), float(bounds[1])],
                "reason": "fitted centre outside independent class-scaled annex region",
            })

    output_root.mkdir(parents=True, exist_ok=True)
    base = dict(source_fit["baseParams"])
    source_fit["baseParams"] = base
    source_fit["annexConstraint"] = {
        "voiceClass": voice_class,
        "method": "nearest-independent-annex-boundary",
        "changes": changes,
    }
    for vowel in "aeiou":
        params = json.loads((fit_root / f"initial-{vowel}.json").read_text())
        params["bodyBands"] = bodies[vowel]["bands"]
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(source_fit, indent=2) + "\n"
    )
    analysed = fit_root / "ANALYSED_REFERENCES.json"
    if analysed.exists():
        (output_root / "ANALYSED_REFERENCES.json").write_text(analysed.read_text())
    return source_fit["annexConstraint"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--voice-class",
        choices=("tenor", "soprano", "bass", "mezzo-soprano"),
        required=True,
    )
    args = parser.parse_args()
    print(json.dumps(constrain(args.fit_root, args.out, args.voice_class), indent=2))


if __name__ == "__main__":
    main()
