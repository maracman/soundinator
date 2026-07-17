import json
from pathlib import Path

from scripts.tone_match.damper_fit import build_reference


def test_zenph_damper_rows_subtract_legato_and_model_90_plus_undamped(tmp_path: Path):
    report = tmp_path / "report.json"
    report.write_text(json.dumps([
        {
            "file": "pno021v20sta.wav", "midi": 21, "vel": 20,
            "dampRateDbPerSec": -120.0, "legVelMatched": 20,
            "legT40": 8.0, "legStaT40Ratio": 8.0, "damperEvent": True,
        },
        {
            "file": "pno090v100sta.wav", "midi": 90, "vel": 100,
            "dampRateDbPerSec": -20.0, "legVelMatched": 100,
            "legT40": 2.0, "legStaT40Ratio": 1.0, "damperEvent": False,
        },
    ]))
    output = tmp_path / "fit.json"
    result = build_reference(report, output)
    measured = next(row for row in result["referenceRows"]
                    if row["register"] == "sub-bass" and row["dynamic"] == "pp")
    assert measured["undampedBaselineDbPerSecond"]["median"] == 5.0
    assert measured["damperContactDbPerSecond"]["median"] == 115.0
    assert measured["frequencyExponent"] is None
    assert result["undampedZone"]["fromMidiInclusive"] == 90
    assert result["undampedZone"]["dampDbPerSecondAtFundamental"] == 0.0
    assert result["exclusions"][0]["reason"].startswith("physical undamped zone")
