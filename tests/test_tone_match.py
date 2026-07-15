from __future__ import annotations

import json

import numpy as np
import pytest

from scripts.fit_profiles_from_samples import NoteAnalysis, validate_corpus_contract, vowel_from_filename
from scripts.tone_match.finalize_corpus import _dynamics, _note_span, _vibrato, _vowel
from scripts.tone_match.assertions import ConstructionSample, evaluate_construction
from scripts.tone_match.iterate import _floor_evidence, _reference_variability
from scripts.tone_match.score import FeatureBundle, _mel_bank, _resample_time


def test_mel_bank_is_nonnegative_and_has_requested_shape():
    bank = _mel_bank(48_000, 2048, bands=40)
    assert bank.shape == (40, 1025)
    assert np.all(bank >= 0)
    assert np.all(bank.sum(axis=1) > 0)


def test_time_resampling_is_stable_at_endpoints():
    source = np.array([[1.0, 2.0, 4.0]])
    result = _resample_time(source, 9)
    assert result.shape == (1, 9)
    assert result[0, 0] == 1.0
    assert result[0, -1] == 4.0


def _bundle(*, f0=220.0, partials=None, percussive=False, B=0.0002):
    partials = np.asarray(partials or [1, .3, .7, .2, .5, .15, .35, .1], dtype=float)
    note = NoteAnalysis("test", f0, "A3", 1.0, partials, f0 * np.arange(1, len(partials) + 1),
                        np.ones(len(partials), dtype=bool), B=B, percussive=percussive)
    return FeatureBundle(note, 20 * np.log10(np.maximum(partials, 1e-6)), np.zeros((48, 120)), np.full(120, f0 * 2))


def test_clarinet_checklist_catches_wrong_resonator_even_with_good_notes():
    samples = []
    for register, partials in (("low", [1, .08, .7, .06, .5, .05, .3, .04]),
                               ("mid", [1, .15, .7, .12, .5, .1, .3, .09]),
                               ("high", [1, .35, .7, .3, .5, .25, .3, .2])):
        for velocity in (.25, .9):
            bundle = _bundle(partials=partials)
            samples.append(ConstructionSample(bundle, bundle, register, velocity, velocity))
    result = evaluate_construction("clarinet", samples,
                                   params={"excitationType": "blow", "resonatorClass": "string"})
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["clarinet.resonator"]["status"] == "fail"
    assert by_id["clarinet.low-odd-series"]["status"] == "pass"
    assert by_id["clarinet.register-even-rise"]["status"] == "pass"
    assert not result["passed"]


def test_single_note_checklist_marks_campaign_evidence_not_applicable():
    bundle = _bundle(percussive=True)
    result = evaluate_construction("piano", [ConstructionSample(bundle, bundle)],
                                   params={"excitationType": "strike", "resonatorClass": "string"},
                                   strict_evidence=False)
    assert result["counts"]["notApplicable"] > 0
    assert {row["status"] for row in result["assertions"]} <= {"pass", "fail", "not-applicable"}


def test_boy_morphology_requires_scaled_formants_to_reach_body_stage():
    bundle = _bundle()
    samples = [ConstructionSample(bundle, bundle, register, dynamic, dynamic)
               for register in ("low", "mid", "high") for dynamic in (.25, .9)]
    params = {
        "excitationType": "blow", "glottalTilt": .2, "voiceBreathSync": .1,
        "singerFormantAmount": .1,
        "boyMorphology": {"tractScale": .84, "baseFormantsHz": [500, 1500, 2500],
                          "scaledFormantsHz": [595, 1786, 2976]},
        "bodyBands": [{"freq": 595}, {"freq": 1786}, {"freq": 2976}],
    }
    result = evaluate_construction("boy soprano", samples, params=params)
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["boy-soprano.tract-scale"]["status"] == "pass"
    assert by_id["boy-soprano.formant-scaling"]["status"] == "pass"
    result_without_bands = evaluate_construction("boy soprano", samples, params={**params, "bodyBands": []})
    by_id = {row["id"]: row for row in result_without_bands["assertions"]}
    assert by_id["boy-soprano.formant-scaling"]["status"] == "fail"


def test_corpus_contract_requires_both_uppercase_sidecars(tmp_path):
    folder = tmp_path / "clarinet"
    folder.mkdir()
    (folder / "C4-mf.wav").touch()
    with pytest.raises(ValueError, match="missing PROVENANCE.json"):
        validate_corpus_contract(str(tmp_path))
    (folder / "PROVENANCE.json").write_text(json.dumps({"source": "public corpus"}))
    (folder / "COVERAGE.md").write_text("# Coverage\n\nlow/mf\n")
    assert validate_corpus_contract(str(tmp_path)) == ["clarinet"]


def test_reference_variability_floor_uses_only_matching_take_groups():
    bundles = {
        "take-a": _bundle(partials=[1, .2, .7, .1, .4, .08]),
        "take-b": _bundle(partials=[1, .3, .6, .16, .35, .1]),
        "loud": _bundle(partials=[1, .5, .8, .4, .7, .3]),
    }
    references = [
        {"path": "take-a", "midi": 57, "dynamic": "mf"},
        {"path": "take-b", "midi": 57, "dynamic": "mf"},
        {"path": "loud", "midi": 57, "dynamic": "f"},
    ]
    variability = _reference_variability(references, bundles.__getitem__)
    assert variability["status"] == "measured"
    assert len(variability["groups"]) == 1
    assert variability["groups"][0]["referenceIndices"] == [0, 1]
    assert variability["groups"][0]["floorComposite"] > 0

    quiet_render = {"scores": [{"composite": 0.0}, {"composite": 0.0}, {"composite": 99.0}],
                    "construction": {"passed": True}}
    evidence = _floor_evidence(variability, quiet_render)
    assert evidence["status"] == "demonstrated"
    assert evidence["groups"][0]["atOrBelowFloor"]

    bad_render = {"scores": [{"composite": 99.0}, {"composite": 99.0}, {"composite": 0.0}],
                  "construction": {"passed": True}}
    assert _floor_evidence(variability, bad_render)["status"] == "above-floor"


def test_reference_variability_floor_requires_alternate_takes():
    result = _reference_variability(
        [{"path": "only", "midi": 60, "dynamic": "mf"}],
        lambda _: _bundle(),
    )
    assert result["status"] == "insufficient-evidence"


def test_corpus_sidecar_filename_classification():
    assert _dynamics("AltoSax.NoVib.ff.C4B4.aiff") == "ff"
    assert _dynamics("vocalset.m3.scales.slow_piano.m3_scales_c_slow_piano_a.wav") == "p"
    assert _vibrato("phil.violin_A4_mezzo-piano_non-vibrato.mp3") == "nonvib"
    assert _vibrato("vocalset.m3.scales.vibrato.m3_scales_vibrato_a.wav") == "vib"
    assert _note_span("BbClar.mf.D3B3.aiff") == "D3–B3"
    assert _vowel("m3_long_straight_u.wav") == "u"
    assert _vowel("AltoSax.NoVib.ff.C4B4.aiff") is None
    assert vowel_from_filename("vocalset.m3.long.m3_long_straight_i.wav") == "i"
