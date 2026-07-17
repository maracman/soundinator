from __future__ import annotations

import json

import soundfile as sf

from scripts.tone_match.bowed_anatomy import SCHEMA, extract
from scripts.tone_match.piano_anatomy import (
    VALIDATION_SCHEMA,
    _synthetic_note,
)


def test_bowed_anatomy_reuses_validated_l16_and_rejects_unanchored_floor(tmp_path):
    validation = tmp_path / "validation.json"
    validation.write_text(json.dumps({
        "schema": VALIDATION_SCHEMA,
        "status": "pass",
        "checks": {"harmonicRank": True, "fixedHz": True},
    }))
    references = []
    for index, f0 in enumerate((110.0, 146.83, 196.0, 261.63)):
        for velocity, dynamic in ((.2, "pp"), (.9, "ff")):
            path = tmp_path / f"note-{index}-{dynamic}.wav"
            sf.write(path, _synthetic_note(f0, velocity), 24000)
            references.append({
                "path": str(path), "sourceFile": path.name,
                "roles": ["spectral"], "register": f"r{index}",
                "dynamic": dynamic, "velocity": velocity,
                "midi": 45 + index * 5, "expectedF0Hz": f0,
                "string": "sulG", "releaseEligible": True,
            })
    manifest = tmp_path / "references.json"
    manifest.write_text(json.dumps(references))
    output = tmp_path / "bowed-anatomy.json"
    result = extract(manifest, validation, output, "violin")

    assert result["schema"] == SCHEMA
    assert result["L16"]["status"] == "measured-anomalies"
    assert any(row["rank"] == 6
               for row in result["L16"]["harmonicRankDeviants"])
    assert result["L18BowLift"]["noteOffAlignedNotes"] == 0
    assert result["L18BowLift"]["status"] == "inconclusive-no-bow-lift-anchor"
