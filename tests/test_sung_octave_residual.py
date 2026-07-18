from __future__ import annotations

import copy

from scripts.tone_match.blown_octave_residual import apply_residual_to_params
from scripts.tone_match.sung_octave_residual import aggregate_vowel_cell


def _row(vowel: str, residual: list[float], stable: list[bool]) -> dict:
    return {
        "vowel": vowel,
        "evidence": {
            "octaveCentresHz": [125, 250, 500, 1000],
            "medianResidualDb": residual,
            "stableBands": stable,
            "sourceAddressable": [False, True, True, True],
        },
    }


def test_sung_octave_residual_requires_cross_vowel_recurrence():
    rows = [
        _row("a", [0, 1.0, -1.0, 2.0], [False, True, True, True]),
        _row("e", [0, 1.2, -1.2, 1.8], [False, True, True, True]),
        _row("i", [0, .8, -.9, 2.1], [False, True, True, True]),
        _row("o", [0, 7.0, 8.0, -8.0], [False, True, True, True]),
    ]
    result = aggregate_vowel_cell(rows, f0_hz=250, minimum_vowels=3)
    assert result["status"] == "pass"
    assert result["stableBands"] == [False, True, True, True]
    assert result["distinctVowelsByBand"][1:] == [4, 4, 4]


def test_sung_octave_residual_rejects_vowel_specific_direction():
    rows = [
        _row("a", [0, 2, 2, 2], [False, True, True, True]),
        _row("e", [0, -2, -2, -2], [False, True, True, True]),
        _row("i", [0, 2, 2, 2], [False, True, True, True]),
        _row("o", [0, -2, -2, -2], [False, True, True, True]),
    ]
    result = aggregate_vowel_cell(rows, f0_hz=250, minimum_vowels=3)
    assert result["status"] == "fail"
    assert not any(result["stableBands"])


def test_sung_source_correction_preserves_fundamental_and_breath_controls():
    params = {
        "toneBreath": .1,
        "voiceBreathSync": .2,
        "bodyBands": [{"freq": 800, "gain": 2}],
        "spectralPartialsByRegisterDynamic": {"rows": [{
            "register": "mid", "dynamic": "mf", "f0Hz": 250,
            "partials": [1, .5, .25, .125],
        }]},
    }
    original = copy.deepcopy(params)
    evidence = {
        "status": "pass", "f0Hz": 250,
        "octaveCentresHz": [125, 250, 500, 1000],
        "medianResidualDb": [0, 1, -1, 2],
        "stableBands": [False, True, True, True],
        "sourceAddressable": [False, True, True, True],
    }
    candidate, audit = apply_residual_to_params(
        params, evidence, register="mid", dynamic="mf", gain=.5,
        component_class="pitch-synchronous-breath",
        normalization_anchor="fundamental",
    )
    changed = candidate["spectralPartialsByRegisterDynamic"]["rows"][0]
    assert changed["partials"][0] == 1
    assert changed["partials"] != original[
        "spectralPartialsByRegisterDynamic"]["rows"][0]["partials"]
    assert candidate["toneBreath"] == original["toneBreath"]
    assert candidate["voiceBreathSync"] == original["voiceBreathSync"]
    assert candidate["bodyBands"] == original["bodyBands"]
    assert audit["normalizationAnchor"] == "fundamental"
