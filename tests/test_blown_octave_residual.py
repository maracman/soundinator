from __future__ import annotations

import copy

import numpy as np
import pytest

from scripts.tone_match.blown_octave_residual import (
    _sustain_blocks,
    apply_residual_to_params,
    synthetic_roundtrip,
)


def test_blown_octave_extractor_passes_harmonic_plus_air_roundtrip():
    result = synthetic_roundtrip()
    assert result["status"] == "pass"
    assert result["includesIndependentAir"] is True
    assert result["meanAbsResidualAfterDb"] <= .35
    assert result["maxAbsResidualAfterDb"] <= .75
    assert result["adaptiveShortTakeCase"]["status"] == "pass"
    assert result["adaptiveShortTakeCase"]["meanAbsResidualAfterDb"] <= .45
    assert result["adaptiveShortTakeCase"]["maxAbsResidualAfterDb"] <= 1.0


def test_octave_extractor_uses_cycle_normalised_mid_high_windows():
    samples = np.ones(round(.78 * 24_000))
    blocks = _sustain_blocks(
        samples, 24_000, f0_hz=660, active_duration_s=.78)
    assert len(blocks) == 3
    assert min(block.size / 24_000 for block in blocks) >= .08


def test_octave_extractor_keeps_conservative_low_note_support():
    samples = np.ones(round(.78 * 24_000))
    with pytest.raises(ValueError, match="cycle-normalised"):
        _sustain_blocks(
            samples, 24_000, f0_hz=65.4, active_duration_s=.78)


def test_octave_extractor_labels_independent_bow_roundtrip_without_air():
    result = synthetic_roundtrip(component_class="bow")
    assert result["status"] == "pass"
    assert result["includesIndependentAir"] is False
    assert result["includesIndependentComponent"] is True
    assert result["independentComponentClass"] == "bow"


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


def test_octave_residual_adapts_metadata_for_independent_bow_component():
    params = {
        "bodyBands": [{"freq": 900, "gain": 1, "width": .2}],
        "spectralPartialsByRegisterDynamic": {
            "rows": [{"register": "mid", "dynamic": "ff", "f0Hz": 500,
                      "partials": [1, .4, .2, .1]}],
        },
    }
    evidence = {
        "status": "pass", "f0Hz": 500,
        "octaveCentresHz": [63, 125, 250, 500, 1000, 2000, 4000, 8000],
        "medianResidualDb": [0, 0, 0, 0, 2, -2, 0, 0],
        "stableBands": [False, False, False, True, True, True, True, True],
        "sourceAddressable": [False, False, False, True, True, True, True, True],
    }
    candidate, audit = apply_residual_to_params(
        params, evidence, register="mid", dynamic="ff", gain=.5,
        component_class="bow")

    changed = candidate["spectralPartialsByRegisterDynamic"]["rows"][0]
    assert "postSourceAirOctaveCorrection" not in changed
    assert changed["postSourceBowOctaveCorrection"][
        "independentComponentClass"] == "bow"
    assert audit["independentComponentClass"] == "bow"
    assert audit["normalizationAnchor"] == "row-peak"
    assert audit["bodyChanged"] is False


def test_bow_octave_residual_preserves_zero_fundamental_and_peak_normalization():
    params = {
        "spectralPartialsByRegisterDynamic": {
            "rows": [{"register": "high", "dynamic": "pp", "f0Hz": 1000,
                      "partials": [0, 1, .4, .2]}],
        },
    }
    evidence = {
        "status": "pass", "f0Hz": 1000,
        "octaveCentresHz": [63, 125, 250, 500, 1000, 2000, 4000, 8000],
        "medianResidualDb": [0, 0, 0, 0, 2, -2, 0, 0],
        "stableBands": [False, False, False, False, True, True, True, True],
        "sourceAddressable": [False, False, False, False, True, True, True, True],
    }
    candidate, audit = apply_residual_to_params(
        params, evidence, register="high", dynamic="pp", gain=1,
        component_class="bow")

    changed = candidate["spectralPartialsByRegisterDynamic"]["rows"][0]
    assert changed["partials"][0] == 0
    assert max(changed["partials"]) == 1
    assert audit["maxAbsEffectiveDb"] <= 6
