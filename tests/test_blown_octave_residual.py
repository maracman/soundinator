from __future__ import annotations

import copy

from scripts.tone_match.blown_octave_residual import (
    apply_residual_to_params,
    synthetic_roundtrip,
)


def test_blown_octave_extractor_passes_harmonic_plus_air_roundtrip():
    result = synthetic_roundtrip()
    assert result["status"] == "pass"
    assert result["includesIndependentAir"] is True
    assert result["meanAbsResidualAfterDb"] <= .35
    assert result["maxAbsResidualAfterDb"] <= .75


def test_octave_residual_changes_only_selected_cumulative_source_cell():
    params = {
        "bodyBands": [{"freq": 900, "gain": 1, "width": .2}],
        "windBreathLevelByRegisterDynamic": {
            "rows": [{"register": "mid", "dynamic": "ff", "levelScale": .7}],
        },
        "spectralPartialsByRegisterDynamic": {
            "rows": [
                {"register": "mid", "dynamic": "pp", "f0Hz": 500,
                 "partials": [1, .5, .25, .125]},
                {"register": "mid", "dynamic": "ff", "f0Hz": 500,
                 "partials": [1, .4, .2, .1]},
            ],
        },
    }
    original = copy.deepcopy(params)
    evidence = {
        "status": "pass", "f0Hz": 500,
        "octaveCentresHz": [63, 125, 250, 500, 1000, 2000, 4000, 8000],
        "medianResidualDb": [0, 0, 0, 0, 2, -2, 0, 0],
        "stableBands": [False, False, False, True, True, True, True, True],
        "sourceAddressable": [False, False, False, True, True, True, True, True],
    }
    candidate, audit = apply_residual_to_params(
        params, evidence, register="mid", dynamic="ff", gain=.5)

    assert candidate["bodyBands"] == original["bodyBands"]
    assert candidate["windBreathLevelByRegisterDynamic"] == \
        original["windBreathLevelByRegisterDynamic"]
    assert candidate["spectralPartialsByRegisterDynamic"]["rows"][0] == \
        original["spectralPartialsByRegisterDynamic"]["rows"][0]
    changed = candidate["spectralPartialsByRegisterDynamic"]["rows"][1]
    assert changed["partials"] != original[
        "spectralPartialsByRegisterDynamic"]["rows"][1]["partials"]
    assert changed["postSourceAirOctaveCorrection"]["startingSurface"] == \
        "selected-fit-cumulative-surface"
    assert audit["changedRows"] == 1
    assert audit["bodyChanged"] is False
    assert audit["airSurfaceChanged"] is False
