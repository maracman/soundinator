from __future__ import annotations

import json

import numpy as np
import pytest
import scripts.tone_match.iterate as iterate_module
import scripts.tone_match.score as score_module

from scripts.fit_profiles_from_samples import NoteAnalysis, aggregate_instrument, expected_single_note_f0, fit_fixed_body, fit_take_spread, guitar_course_for_midi, harmonic_frame_amps, merge_profile_sets, onset_pitch_stats, validate_corpus_contract, vibrato_stats, vowel_from_filename
from scripts.tone_match.finalize_corpus import _dynamics, _note_span, _vibrato, _vowel
from scripts.tone_match.assertions import ConstructionSample, evaluate_construction
from scripts.tone_match.build_campaign import CAMPAIGNS, PHILHARMONIA_WOODWIND_ALTERNATES, RESONATOR
from scripts.tone_match.controllability import canonical_hash, perturbations, validate_audit_contract
from scripts.tone_match.iterate import FreeParam, ToneMatcher, _append_ledger, _dominant_residual, _floor_evidence, _load_preset, _params, _reference_set_id, _reference_variability, _renderer_contract_hash, _tripwire_gate, _update_leaderboard
from scripts.tone_match.struck_plucked_prep import CAMPAIGNS as STRUCK_CAMPAIGNS, rebase_fitted_preset, seed_preset
from scripts.tone_match.strings_prep import PHIL_ANCHOR_NOTES, STRING_CAMPAIGNS, find_catalogue_duplicates, inventory_take_pairs, parse_phil_name, parse_string_label, screen_outliers, trim_to_single_bow
from scripts.tone_match.score import SCORER_CONTRACT_VERSION, FeatureBundle, _BOWED_P1_FEATURES, _mel_bank, _noise_and_onset_observables, _resample_time, _trajectory_power, band_balance_distance, band_profile, compare_features, ltas_rolloff, octave_summary_db, weights_for_instrument
from scripts.tone_match.tripwires import aggregate_by_cell, evaluate_tripwires, tripwire_table_markdown
from scripts.tone_match.exclusions import OWNER_EXCLUDED_TAKES, assert_no_excluded, is_excluded


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


def test_trajectory_power_rejects_inaudible_tail_and_codec_bins():
    freqs = np.asarray([50.0, 100.0, 200.0, 10_000.0])
    power = np.asarray([
        [.2, .2, .2, 0],
        [0, 0, 0, 0],
        [1, 1, 1, 0],
        [1e-4, 1e-4, 1e-4, 1e-6],
    ])
    mel_power, centroid_power = _trajectory_power(power, freqs, f0=200)
    assert mel_power.shape[1] == 3
    centroid = (freqs[:, None] * centroid_power).sum(axis=0) / centroid_power.sum(axis=0)
    assert centroid == pytest.approx([200, 200, 200])


def test_active_render_analysis_excludes_release_tail(monkeypatch):
    sample_rate = 48_000
    observed = {}
    monkeypatch.setattr(score_module, "load_mono",
                        lambda _path: (np.ones(sample_rate * 2), sample_rate))

    def analyse_active(samples, sr, **_kwargs):
        observed["frames"] = len(samples)
        assert sr == sample_rate
        return _bundle().note

    monkeypatch.setattr(score_module, "analyse_audio_samples", analyse_active)
    monkeypatch.setattr(score_module, "analyse_audio_file",
                        lambda *_args, **_kwargs: pytest.fail("full release tail was analysed"))
    score_module.extract_features("render.wav", active_duration_s=.5)
    assert observed["frames"] == round((.5 + .02) * sample_rate)


def test_nonvibrato_estimator_peaks_do_not_count_as_vibrato_distance():
    reference = _bundle()
    rendered = _bundle()
    reference.note.vibrato = {"present": False, "rate": 7.6, "depth": .5}
    rendered.note.vibrato = {"present": False, "rate": 3.1, "depth": .1}
    assert compare_features(reference, rendered)["features"]["vibrato"] == 0


def test_inaudible_attack_residual_has_no_phantom_frequency_penalty():
    reference = _bundle()
    rendered = _bundle()
    reference.note.attack_noise = {"level": .0001, "freq": 6000}
    rendered.note.attack_noise = {}
    assert compare_features(reference, rendered)["features"]["noise"] == 0
    reference.note.attack_noise = {"level": .01, "freq": 6000}
    rendered.note.attack_noise = {"level": .01, "freq": 3000}
    assert compare_features(reference, rendered)["features"]["noise"] == 1


def test_owner_listening_observables_are_explicit_score_dimensions():
    reference = _bundle()
    rendered = _bundle()
    reference.sustain_noise_db = -32
    rendered.sustain_noise_db = -23
    reference.onset_tilt_db_oct = 2.5
    rendered.onset_tilt_db_oct = -0.5
    reference.note.onset_pitch = {"depthCents": 42, "settleMs": 76}
    rendered.note.onset_pitch = {"depthCents": 17, "settleMs": 36}
    result = compare_features(reference, rendered)
    assert result["features"]["sustain_noise_db"] == 9
    assert result["normalized"]["sustain_noise_db"] == 3
    assert result["features"]["onset_tilt_db_oct"] == 3
    assert result["normalized"]["onset_tilt_db_oct"] == 1
    assert result["features"]["onset_scoop_cents"] == 25
    assert result["normalized"]["onset_scoop_cents"] == 2.5
    assert result["features"]["onset_scoop_settle_ms"] == 40
    assert result["normalized"]["onset_scoop_settle_ms"] == 2


def test_onset_pitch_tracker_measures_scoop_without_calling_it_vibrato():
    sr = 48_000
    duration = .8
    t = np.arange(round(sr * duration)) / sr
    settle = .08
    cents = -60 * np.maximum(0, 1 - t / settle)
    hz = 220 * np.power(2, cents / 1200)
    phase = 2 * np.pi * np.cumsum(hz) / sr
    envelope = np.minimum(1, t / .012) * np.minimum(1, (duration - t) / .03)
    audio = np.sin(phase) * envelope
    measured = onset_pitch_stats(audio, sr, 220, 0, np.array([1, .2, .1]))
    assert measured["direction"] == "from-below"
    assert 35 <= measured["depthCents"] <= 75
    assert 35 <= measured["settleMs"] <= 130

    stable = np.sin(2 * np.pi * 220 * t) * envelope
    measured_stable = onset_pitch_stats(stable, sr, 220, 0,
                                         np.array([1, .2, .1]))
    assert measured_stable["direction"] == "stable"
    assert measured_stable["depthCents"] == 0


def test_requested_parameter_order_is_preserved_for_construction_first_fits():
    manifest = {
        "continuous": [
            {"key": "excitationPosition", "min": 0, "max": 1, "default": .2},
            {"key": "dynamicBlare", "min": 0, "max": 1.5, "default": 0},
            {"key": "partialTilt", "min": -1, "max": 1, "default": 0},
        ]
    }
    resolved = _params(
        manifest,
        {"excitationType": "blow", "dynamicBlare": .25},
        ["dynamicBlare", "partialTilt", "excitationPosition", "dynamicBlare"],
    )
    assert [row.key for row in resolved] == ["dynamicBlare", "partialTilt", "excitationPosition"]
    assert resolved[0].default == .25


def test_reference_set_id_changes_when_the_scored_manifest_changes():
    base = [{"path": "/tmp/a.wav", "midi": 60, "velocity": .2}]
    assert _reference_set_id(base) == _reference_set_id([dict(base[0])])
    assert _reference_set_id(base) != _reference_set_id(base + [
        {"path": "/tmp/b.wav", "midi": 60, "velocity": .2}
    ])
    assert _reference_set_id(base, weights={"partials_db": 1}) != \
        _reference_set_id(base, weights={"partials_db": 0})


def test_state_best_wrapper_is_a_valid_initial_preset(tmp_path):
    path = tmp_path / "best.json"
    path.write_text(json.dumps({"loss": 1.2, "params": {
        "excitationType": "pluck", "spectralProfile": "guitar",
    }}))
    assert _load_preset(path)["excitationType"] == "pluck"


def test_renderer_contract_hash_changes_with_profile_bytes(tmp_path, monkeypatch):
    monkeypatch.setattr(iterate_module, "ROOT", tmp_path)
    for relative in iterate_module.RENDERER_CONTRACT_FILES:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(relative))
    before = _renderer_contract_hash()
    (tmp_path / "web/static/measured_profiles.js").write_text("changed profile")
    assert _renderer_contract_hash() != before


def test_conditional_controllability_perturbation_moves_off_neutral_bound():
    spec = FreeParam("decaySecondStage", 0, 1, 0)
    assert perturbations(spec, {"decaySecondStage": 0, "decaySecondRatio": 4}) == [.1]


def test_controllability_contract_asserts_exact_consumer_inputs():
    references = [{"path": "/tmp/ref.wav", "midi": 60, "velocity": .2}]
    manifest = {"continuous": [{"key": "partialTilt", "min": -1, "max": 1,
                                 "default": 0}]}
    audit = {
        "schemaVersion": 3, "scorerContractVersion": SCORER_CONTRACT_VERSION,
        "rendererContractHash": _renderer_contract_hash(),
        "instrument": "grand-piano", "status": "clean",
        "referenceContractHash": canonical_hash(references),
        "parameterManifestHash": canonical_hash(manifest),
        "initialPresetHash": canonical_hash({"partialTilt": 0}),
        "weights": {"partials_db": 1, "vibrato": 0},
        "responders": {"partials_db": ["partialTilt"]},
        "repeatability": {"status": "stable", "unstableFeatures": []},
    }
    validate_audit_contract(audit, instrument="grand-piano",
                            references=references, manifest=manifest,
                            initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="reference manifest changed"):
        validate_audit_contract(audit, instrument="grand-piano",
                                references=[{**references[0], "midi": 61}], manifest=manifest,
                                initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="has no responsive"):
        validate_audit_contract({**audit, "responders": {}}, instrument="grand-piano",
                                references=references, manifest=manifest,
                                initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="repeat-render stability"):
        validate_audit_contract({**audit, "schemaVersion": 2}, instrument="grand-piano",
                                references=references, manifest=manifest,
                                initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="scorer contract changed"):
        validate_audit_contract({
            **audit, "scorerContractVersion": "obsolete",
        }, instrument="grand-piano", references=references, manifest=manifest,
            initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="renderer contract changed"):
        validate_audit_contract({
            **audit, "rendererContractHash": "obsolete",
        }, instrument="grand-piano", references=references, manifest=manifest,
            initial={"partialTilt": 0})
    with pytest.raises(ValueError, match="initial preset changed"):
        validate_audit_contract(
            audit, instrument="grand-piano", references=references,
            manifest=manifest, initial={"partialTilt": .5})
    with pytest.raises(ValueError, match="repeat-unstable"):
        validate_audit_contract({
            **audit,
            "repeatability": {"status": "watch-metrics-zeroed",
                              "unstableFeatures": ["partials_db"]},
        }, instrument="grand-piano", references=references, manifest=manifest,
            initial={"partialTilt": 0})


def test_struck_preflight_has_dense_piano_and_source_matched_nylon_anchors():
    piano = STRUCK_CAMPAIGNS["grand-piano"]
    nylon = STRUCK_CAMPAIGNS["guitar-nylon"]
    assert len(piano["anchors"]) >= 5
    assert piano["dynamics"] == ("pp", "ff")
    assert len(nylon["anchors"]) >= 3
    assert nylon["source"].startswith("Philharmonia")
    assert [row["string"] for row in nylon["anchors"]] == \
        ["string6", "string3", "string1"]


def test_t033_guitar_auto_course_uses_minimum_fret_and_24_fret_bound():
    assert guitar_course_for_midi(40) == "string6"
    assert guitar_course_for_midi(55) == "string3"
    assert guitar_course_for_midi(64) == "string1"
    assert guitar_course_for_midi(76) == "string1"
    assert guitar_course_for_midi(89) is None


def test_single_note_corpus_filenames_supply_trusted_pitch_anchors():
    assert expected_single_note_f0("phil.guitar_E2_very-long_forte_normal.mp3") == \
        pytest.approx(82.406889, rel=1e-6)
    assert expected_single_note_f0("phil.guitar_G3_very-long_piano_normal.mp3") == \
        pytest.approx(195.997718, rel=1e-6)
    assert expected_single_note_f0("Piano.pp.C1.aiff") == pytest.approx(32.703196, rel=1e-6)
    assert expected_single_note_f0("Guitar.ff.sulE.E2B2.mono.aif") is None


def test_guitar_measured_profile_uses_nominal_nylon_register_anchors():
    measured = json.loads(
        (iterate_module.ROOT / "web/static/measured_profiles.json").read_text())
    assert [row["f0"] for row in measured["guitar"]["partialsByRegister"]] == \
        pytest.approx([82.407, 195.998, 659.255], abs=.001)
    assert {row["note"] for row in measured["guitar"]["notesAnalysed"]} == \
        {"E2", "G3", "E5"}
    strings = measured["guitar"]["partialsByString"]
    assert set(strings) == {"string6", "string3", "string1"}
    assert [strings[key][0]["f0"] for key in ("string6", "string3", "string1")] == \
        pytest.approx([82.407, 195.998, 659.255], abs=.001)
    assert all(strings[key][0]["nNotes"] == 2 for key in strings)


def test_struck_seed_keeps_family_defaults_neutral_and_consumes_register_tables():
    measured = {"piano": {
        "performance": {"attackNoise": {"freq": 800, "q": .8, "decay": .1}},
        "material": {"suggestedMaterial": .2},
        "attack": {"byRegister": [{"f0": 110, "envelopeAttack": .02}]},
        "resonances": [{"freq": 200, "gain": 2, "width": 1}] * 3,
        "partialsByRegister": [{"f0": 110, "partials": [1]}],
        "partialB": .001,
    }}
    seed = seed_preset(STRUCK_CAMPAIGNS["grand-piano"], measured)
    assert seed["toneBreath"] == 0
    assert seed["excitationHuman"] == 0
    assert seed["velocityHardnessCoupling"] == 0
    assert seed["decaySecondStage"] == 0
    assert seed["spectralResonanceAmount"] == 1
    assert "partialB" not in seed


def test_profile_rebase_refreshes_structural_anchors_but_keeps_fitted_controls():
    fitted = {"params": {
        "partialTilt": .34,
        "attackNoiseLevel": .7,
        "envelopeAttackByRegister": [{"f0": 120, "attack": .03}],
    }}
    refreshed = {
        "partialTilt": 0,
        "attackNoiseLevel": 1,
        "envelopeAttackByRegister": [{"f0": 82.407, "attack": .028}],
    }
    rebased = rebase_fitted_preset(fitted, refreshed)
    assert rebased["partialTilt"] == .34
    assert rebased["attackNoiseLevel"] == .7
    assert rebased["envelopeAttackByRegister"] == refreshed["envelopeAttackByRegister"]


def test_dominant_residual_ignores_zero_weight_diagnostics():
    best = {"scores": [{
        "normalized": {"partials_db": 2.0, "inharmonicity_log_ratio": 99.0},
        "weights": {"partials_db": 1.0, "inharmonicity_log_ratio": 0.0},
    }]}
    assert _dominant_residual(best)["feature"] == "partials_db"


def test_ledger_keeps_fitted_free_values_when_sensitivity_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(iterate_module, "ROOT", tmp_path)
    (tmp_path / "docs").mkdir()
    _append_ledger("flute", tmp_path / "pass2",
                   {"loss": 1.25, "params": {"attackNoiseDirect": .3, "partialB": 0}},
                   {}, [FreeParam("attackNoiseDirect", 0, 1, 0)])
    ledger = (tmp_path / "docs" / "SG2_PARAM_LEDGER.md").read_text()
    assert "| `attackNoiseDirect` | 0.3 | not run |" in ledger
    assert "partialB" not in ledger


def test_leaderboard_preview_does_not_record_unaccepted_candidate(tmp_path, monkeypatch):
    monkeypatch.setattr(iterate_module, "DEFAULT_RUN_ROOT", tmp_path)
    monkeypatch.setattr(iterate_module, "STATE_ROOT", tmp_path)
    best = {
        "loss": 1.5,
        "params": {"partialTilt": .2},
        "construction": {"passed": True, "counts": {"fail": 0}},
        "tripwireGate": {"passed": False, "failureCount": 2},
    }
    improved, previous = _update_leaderboard(
        "guitar-nylon", tmp_path / "invalid-stop", best, "objective-v2", persist=False)
    assert improved
    assert previous is None
    assert not (tmp_path / "guitar-nylon" / "leaderboard.json").exists()

    improved, previous = _update_leaderboard(
        "guitar-nylon", tmp_path / "accepted", best, "objective-v2", persist=True)
    assert improved
    assert previous is None
    board = json.loads((tmp_path / "guitar-nylon" / "leaderboard.json").read_text())
    assert [row["run"] for row in board["runs"]] == ["accepted"]


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


def test_alto_sax_owner_notes_are_construction_gates():
    samples = [ConstructionSample(_bundle(), _bundle(), register, dynamic, dynamic)
               for register in ("low", "mid", "high") for dynamic in (.25, .9)]
    base = {
        "excitationType": "blow", "resonatorClass": "conicalTube", "dynamicBlare": .2,
        "breathVelocityExponent": 1, "breathTurbulence": 0, "breathBodyAmount": 0,
        "onsetSpectrumTilt": 0, "onsetSpectrumDecay": .06,
    }
    failed = evaluate_construction("alto-sax", samples, params=base)
    failed_ids = {row["id"] for row in failed["assertions"] if row["status"] == "fail"}
    owner_ids = {"alto-sax.soft-breath-law", "alto-sax.turbulence-law",
                 "alto-sax.body-coloured-air", "alto-sax.onset-spectrum-law"}
    assert owner_ids <= failed_ids
    fitted = evaluate_construction("alto-sax", samples, params={
        **base, "breathVelocityExponent": .5, "breathTurbulence": .2,
        "breathBodyAmount": .4, "onsetSpectrumTilt": .2,
    })
    by_id = {row["id"]: row["status"] for row in fitted["assertions"]}
    assert all(by_id[key] == "pass" for key in owner_ids)


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
    (folder / "PROVENANCE.json").write_text(json.dumps({
        "source": "public corpus",
        "files": [{"file": "C4-mf.wav"}],
    }))
    (folder / "COVERAGE.md").write_text("# Coverage\n\nlow/mf\n")
    assert validate_corpus_contract(str(tmp_path)) == ["clarinet"]
    (folder / "D4-mf.wav").touch()
    with pytest.raises(ValueError, match="acquisition snapshot is not atomic"):
        validate_corpus_contract(str(tmp_path))


def test_partial_profile_refresh_can_use_an_immutable_merge_base():
    new = {"guitar": {"resonances": [], "resonancesFit": {},
                      "partialsByString": {"string6": [{"f0": 82.4}]}}}
    previous = {"guitar": {"resonances": [{"freq": 200}],
                           "resonancesFit": {"method": "frozen"}},
                "piano": {"partials": [1]}}
    merged = merge_profile_sets(new, previous)
    assert merged["guitar"]["resonances"] == [{"freq": 200}]
    assert merged["guitar"]["resonancesFit"]["method"] == "frozen"
    assert "piano" in merged


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


def test_blown_scoring_does_not_fit_stiff_string_inharmonicity():
    blown = weights_for_instrument("french-horn")
    string = weights_for_instrument("violin")
    assert blown["inharmonicity_log_ratio"] == 0
    assert string["inharmonicity_log_ratio"] == 1
    assert weights_for_instrument("trumpet", {"noise": .5})["noise"] == .5


def test_struck_scoring_firewalls_continuous_air_and_bow_observables():
    grand = weights_for_instrument("grand-piano")
    nylon = weights_for_instrument("guitar-nylon")
    for weights in (grand, nylon):
        assert weights["vibrato"] == 0
        assert weights["sustain_noise_db"] == 0
        assert weights["onset_scoop_cents"] == 0
        assert weights["onset_noise_db"] == 1
        assert weights["decay_log_ratio"] == 1


def test_horn_checklist_requires_register_onset_evidence():
    samples = [ConstructionSample(_bundle(), _bundle(), register, dynamic, velocity)
               for register in ("low", "mid", "high")
               for dynamic, velocity in (("pp", .2), ("ff", .92))]
    base = {
        "excitationType": "blow", "resonatorClass": "conicalTube",
        "dynamicBlare": .25, "attackNoiseDirect": 1,
        "attackNoiseVelocityExponent": .99,
    }
    missing = evaluate_construction("french-horn", samples, params=base)
    by_id = {row["id"]: row for row in missing["assertions"]}
    assert by_id["french-horn.register-onset-law"]["status"] == "fail"
    anchors = [{"f0": f0, "levelScale": 1} for f0 in (62, 262, 523)]
    fitted = evaluate_construction(
        "french-horn", samples, params={**base, "attackNoiseByRegister": anchors})
    by_id = {row["id"]: row for row in fitted["assertions"]}
    assert by_id["french-horn.register-onset-law"]["status"] == "pass"


def test_horn_checklist_requires_coupled_articulation_distribution():
    samples = []
    for index, (transient, depth) in enumerate(((.2, 60), (.3, 50), (.5, 35),
                                                (.7, 20), (.8, 10), (.9, 2))):
        bundle = _bundle()
        bundle.note.attack_noise = {"level": transient}
        bundle.note.onset_pitch = {"depthCents": depth, "settleMs": 60}
        samples.append(ConstructionSample(bundle, bundle,
                                           ("low", "mid", "high")[index // 2],
                                           .25 if index % 2 == 0 else .9,
                                           .25 if index % 2 == 0 else .9))
    base = {"excitationType": "blow", "resonatorClass": "conicalTube",
            "dynamicBlare": .2}
    missing = evaluate_construction("french-horn", samples, params=base)
    by_id = {row["id"]: row for row in missing["assertions"]}
    assert by_id["french-horn.coupled-articulation-law"]["status"] == "fail"
    fitted = evaluate_construction("french-horn", samples, params={
        **base, "articulationCoupling": .8, "articulationVariation": .5,
        "onsetScoopDepthCents": 70, "onsetScoopSettle": .08,
        "onsetArticulationCorrelation": -.6, "onsetPitchNotes": 6,
    })
    by_id = {row["id"]: row for row in fitted["assertions"]}
    assert by_id["french-horn.coupled-articulation-law"]["status"] == "pass"
    assert by_id["french-horn.articulation-anticorrelation"]["status"] == "pass"


def test_register_fit_retains_valid_notes_below_100_hz():
    notes = [_bundle(f0=f0, partials=partials).note for f0, partials in (
        (60, [1, .1, .05, .02, .01, .005, .002, .001]),
        (80, [1, .2, .08, .03, .01, .005, .002, .001]),
        (200, [1, .5, .2, .1, .05, .02, .01, .005]),
    )]
    fitted = aggregate_instrument(notes, [], 8)
    anchors = fitted["partialsByRegister"]
    assert [row["f0"] for row in anchors] == [60.0, 80.0, 200.0]
    assert anchors[0]["partials"][1]["amp"] == .1


def test_t033_string_tables_do_not_pool_other_courses():
    notes = []
    for f0, second_partial in (
        (82.4069, .1), (82.4069, .1),
        (195.9977, .8), (195.9977, .8),
    ):
        notes.append(_bundle(
            f0=f0,
            partials=[1, second_partial, .05, .02, .01, .005, .002, .001],
        ).note)
    fitted = aggregate_instrument(
        notes, [], 8,
        string_selector=lambda note: guitar_course_for_midi(
            int(round(69 + 12 * np.log2(note.f0 / 440.0)))),
    )
    strings = fitted["partialsByString"]
    assert strings["string6"][0]["partials"][1]["amp"] == pytest.approx(.1)
    assert strings["string3"][0]["partials"][1]["amp"] == pytest.approx(.8)


def test_profile_fit_retains_scoop_distribution_and_plosive_anticorrelation():
    notes = []
    for index, (transient, depth) in enumerate(((.8, 2), (.6, 18), (.4, 36), (.2, 55))):
        note = _bundle(f0=180 + index * 40).note
        note.attack_noise = {"level": transient, "freq": 1200, "q": 1,
                             "decay": .05, "bandwidth": 600}
        note.onset_pitch = {"depthCents": depth, "settleMs": 40 + depth}
        notes.append(note)
    performance = aggregate_instrument(notes, [], 8)["performance"]
    assert performance["onsetScoopProb"] == .75
    assert performance["onsetScoopDepthCents"] > 30
    assert performance["onsetArticulationCorrelation"] < -.9


def test_profile_fit_separates_fixed_hz_body_from_partial_rank():
    notes = []
    for index in range(12):
        f0 = 110 * 2 ** (index / 12)
        freqs = f0 * np.arange(1, 17)
        source = np.arange(1, 17, dtype=float) ** -1.15
        body = 2 ** (1.1 * np.exp(-.5 * (np.log2(freqs / 800) / .38) ** 2))
        amps = source * body
        amps /= amps.max()
        notes.append(NoteAnalysis(
            f"note-{index}", f0, "test", 1, amps, freqs,
            np.ones(16, dtype=bool)))
    bands, adjusted, fit_info = fit_fixed_body(notes, 16)
    assert len(bands) >= 3
    assert any(550 <= band["freq"] <= 1200 and band["gain"] > .1
               for band in bands)
    assert adjusted.shape == (12, 16)
    assert fit_info["method"] == "ensemble-rank-note-body-v3"
    assert fit_info["notes"] == 12


def test_body_fit_keeps_narrow_low_modes_and_exports_f0_floor():
    # L12/T-003: the fit must NOT smear narrow low modes (a width floor in
    # the basis was tried and reverted — it erased violin A0/B1); instead it
    # exports lowestF0Hz so the ENGINE can cap single-partial spotlights at
    # application time (exchange spec, option c).
    rng = np.random.default_rng(11)
    notes = []
    for index in range(14):
        f0 = 100 * 2 ** (index / 6)
        freqs = f0 * np.arange(1, 25)
        source = np.arange(1, 25, dtype=float) ** -1.0
        body = 2 ** (.9 * np.exp(-.5 * (np.log2(freqs / 400) / .18) ** 2))
        amps = source * body * np.exp(rng.normal(0, .05, 24))
        amps /= amps.max()
        notes.append(NoteAnalysis(
            f"file-{index % 4}", f0, "test", 1, amps, freqs,
            np.ones(24, dtype=bool)))
    bands, adjusted, fit_info = fit_fixed_body(notes, 24)
    assert bands, "body must still be fitted"
    peak = max(bands, key=lambda band: band["gain"])
    assert 300 <= peak["freq"] <= 550          # narrow 400 Hz mode recovered
    assert peak["width"] <= .35                # ...at honest resolution
    assert fit_info["lowestF0Hz"] == 100.0


def test_frame_tracked_partials_survive_vibrato():
    # A ±30-cent 5.5 Hz vibrato tone: the long-window FFT peak-read smears
    # each harmonic into sidebands, but the frame tracker must still recover
    # the underlying amplitude ratios.
    sr = 44_100
    duration = 2.4
    t = np.arange(int(sr * duration)) / sr
    f0 = 440.0
    cents = 30 * np.sin(2 * np.pi * 5.5 * t)
    inst_f = f0 * 2 ** (cents / 1200)
    phase = 2 * np.pi * np.cumsum(inst_f) / sr
    true_amps = np.array([1.0, .5, .25, .125, .0625])
    seg = sum(a * np.sin((k + 1) * phase) for k, a in enumerate(true_amps))
    result = harmonic_frame_amps(seg.astype(np.float64), sr, f0, n_partials=8)
    assert result is not None
    amps, freqs, ok = result
    assert ok[:5].all()
    measured = amps[:5] / amps[0]
    ratio_db = 20 * np.log10(measured / true_amps)
    assert np.abs(ratio_db).max() < 1.5
    assert abs(freqs[0] - f0) < 3.0


def test_take_spread_ignores_cross_file_dynamic_differences():
    # Two files (dynamics) share one partial table; within-file jitter is
    # sigma=0.1 ln.  File B carries a big constant tilt vs file A — the old
    # pooled chain conflated that tilt into spread; the within-file
    # estimator must report only the jitter (~0.2), nowhere near the cap.
    rng = np.random.default_rng(20260716)
    table = np.arange(1, 17, dtype=float) ** -1.0
    notes = []
    for file_name, tilt in (("take-pp.aiff", 0.0), ("take-ff.aiff", 1.2)):
        for index in range(10):
            f0 = 220 * 2 ** (index / 12)
            amps = table * np.exp(tilt * np.linspace(0, 1, 16)
                                  + rng.normal(0, .1, 16))
            amps /= amps.max()
            notes.append(NoteAnalysis(
                file_name, f0, "test", 1, amps,
                f0 * np.arange(1, 17), np.ones(16, dtype=bool)))
    A = np.stack([n.partial_amps for n in notes])
    OK = np.stack([n.partial_snr_ok for n in notes])
    spread, pairs = fit_take_spread(notes, A, OK, 16)
    assert pairs == 18
    values = [s for s in spread if s is not None]
    assert len(values) >= 12
    assert np.median(values) < .35
    assert max(values) < .5


def _vibrato_tone(duration=3.0, sr=44_100, f0=440.0, depth_cents=30.0,
                  rate_start=5.5, rate_end=5.5, vib_start=0.0, vib_ramp=0.0,
                  am_db=0.0):
    t = np.arange(int(sr * duration)) / sr
    envelope = np.clip((t - vib_start) / max(vib_ramp, 1e-6), 0, 1) \
        if (vib_start or vib_ramp) else np.ones_like(t)
    rate = rate_start + (rate_end - rate_start) * (t / duration)
    vib_phase = 2 * np.pi * np.cumsum(rate) / sr
    modulation = envelope * np.sin(vib_phase)
    inst_f = f0 * 2 ** (depth_cents * modulation / 1200)
    phase = 2 * np.pi * np.cumsum(inst_f) / sr
    gain = 10 ** (am_db * modulation / 20)
    return (gain * np.sin(phase)).astype(np.float64), sr


def test_vibrato_trajectory_measures_onset_delay_ramp_and_body_am():
    seg, sr = _vibrato_tone(vib_start=.8, vib_ramp=.4, am_db=2.0)
    stats = vibrato_stats(seg, sr, 440.0, np.array([1.0, .2, .1]))
    assert stats.get("present")
    assert 300 <= stats["onsetDelayMs"] <= 1400
    assert 0 <= stats["depthRampMs"] <= 900
    assert .8 <= stats["bodyAmDepthDb"] <= 3.5


def test_vibrato_trajectory_measures_rate_drift():
    seg, sr = _vibrato_tone(rate_start=5.0, rate_end=7.0)
    stats = vibrato_stats(seg, sr, 440.0, np.array([1.0, .2, .1]))
    assert stats.get("present")
    assert stats["rateDriftHzPerSecond"] > .2

    steady, sr = _vibrato_tone(rate_start=5.5, rate_end=5.5)
    steady_stats = vibrato_stats(steady, sr, 440.0, np.array([1.0, .2, .1]))
    assert abs(steady_stats["rateDriftHzPerSecond"]) < abs(stats["rateDriftHzPerSecond"])


def test_scratch_window_noise_leads_the_tone_at_soft_starts():
    sr = 44_100
    t = np.arange(int(1.2 * sr)) / sr
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, t.size)
    from scipy import signal as _sig
    sos = _sig.butter(4, [3000, 6000], btype="bandpass", fs=sr, output="sos")
    scratch = _sig.sosfiltfilt(sos, noise) * .15
    scratch[t > .35] *= .25                      # burst fades into sustain bed
    tone = .8 * np.sin(2 * np.pi * 440 * t)
    tone[t < .06] = 0                            # tone speaks 60 ms after noise
    samples = scratch + tone
    nfft = 2048
    _, times, spectrum = _sig.stft(samples, fs=sr, nperseg=nfft, noverlap=1536,
                                   boundary=None, padded=False)
    power = np.abs(spectrum) ** 2
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    (sustain_noise_db, _tilt, onset_noise_db,
     onset_centroid_oct, noise_lead_ms, lockin_periods) = _noise_and_onset_observables(
        power, freqs, times, 440.0)
    assert noise_lead_ms > 25
    assert onset_noise_db > sustain_noise_db + 3
    assert onset_centroid_oct > .8               # scratch sits well above 1 kHz


def test_onset_wander_measures_approach_from_above_without_calling_it_scoop():
    sr = 44_100
    t = np.arange(int(1.0 * sr)) / sr
    settle = np.clip(t / .1, 0, 1)
    cents = 40 * (1 - settle)                    # starts 40 cents SHARP
    inst_f = 440 * 2 ** (cents / 1200)
    seg = np.sin(2 * np.pi * np.cumsum(inst_f) / sr)
    stats = onset_pitch_stats(seg, sr, 440.0, 0.0, np.array([1.0, .1, .05]))
    assert stats["depthCents"] == 0.0            # no from-below scoop invented
    assert stats["wanderCents"] > 15


def test_bowed_p1_features_have_zero_weight_for_blown():
    from scripts.tone_match.score import _BOWED_WATCH_METRICS
    blown = weights_for_instrument("clarinet")
    bowed = weights_for_instrument("violin")
    for key in _BOWED_P1_FEATURES:
        assert blown[key] == 0.0
        if key in _BOWED_WATCH_METRICS:
            # §2.3 controllability audit: no generating engine param yet —
            # measured and reported, but weighted zero until the filed
            # engine specs (N1/N4) land and the audit is re-run
            assert bowed[key] == 0.0
        else:
            assert bowed[key] == 1.0
    # a blown composite must not move when only a P1 sense differs
    reference = _bundle()
    rendered_same = _bundle()
    rendered_diff = _bundle()
    rendered_diff.onset_noise_db = 9.0
    same = compare_features(reference, rendered_same, weights_for_instrument("clarinet"))
    diff = compare_features(reference, rendered_diff, weights_for_instrument("clarinet"))
    assert diff["composite"] == pytest.approx(same["composite"])
    assert diff["features"]["onset_noise_db"] == 9.0


def _sustained_tone(duration=2.2, sr=44_100, f0=440.0, tilt_db_oct=0.0):
    t = np.arange(int(sr * duration)) / sr
    tone = np.zeros_like(t)
    for k in range(1, 20):
        f = k * f0
        if f > 0.45 * sr:
            break
        gain_db = -6 * np.log2(k) + tilt_db_oct * np.log2(f / f0)
        tone += 10 ** (gain_db / 20) * np.sin(2 * np.pi * f * t)
    envelope = np.minimum(1, t / .02) * np.minimum(1, (duration - t) / .05)
    return tone * envelope


def test_band_profile_measures_octave_tilt_not_gain():
    sr = 44_100
    flat = band_profile(_sustained_tone(), sr)
    louder = band_profile(_sustained_tone() * 4, sr)
    assert flat is not None and louder is not None
    # uniform gain cancels in band-re-total space
    assert np.max(np.abs(flat - louder)) < .5
    bright = band_profile(_sustained_tone(tilt_db_oct=6), sr)
    diff = bright - flat
    # a +6 dB/oct tilt must raise high bands relative to low ones
    assert diff[-4:].mean() - diff[:4].mean() > 6
    short = band_profile(_sustained_tone(duration=.8), sr)
    assert short is None  # not-applicable below 1 s sustained


def test_band_balance_distance_flags_octave_scale_tilt():
    sr = 44_100
    ref = _bundle()
    ref.band_profile_db = band_profile(_sustained_tone(), sr)
    same = _bundle()
    same.band_profile_db = band_profile(_sustained_tone(), sr)
    tilted = _bundle()
    tilted.band_profile_db = band_profile(_sustained_tone(tilt_db_oct=6), sr)
    d_same, _ = band_balance_distance(ref, same)
    d_tilt, d_max8 = band_balance_distance(ref, tilted)
    assert d_same < .5
    assert d_tilt > 3
    assert d_max8 is not None and d_max8 > 6


def test_ltas_rolloff_recovers_synthetic_slope():
    sr = 44_100
    profile = band_profile(_sustained_tone(tilt_db_oct=-9), sr)
    slope = ltas_rolloff(profile)
    # source is -6 dB/oct (1/n) plus -9 tilt => ~-15 dB/oct up high
    assert slope is not None
    assert -20 < slope < -9


def test_tripwire_gate_reports_every_bar_with_no_silent_pass():
    sr = 44_100
    ref = _bundle()
    ref.band_profile_db = band_profile(_sustained_tone(), sr)
    render = _bundle()
    render.band_profile_db = band_profile(_sustained_tone(tilt_db_oct=6), sr)
    ref.note.band_t90 = {"500": {"t90": .05}}
    render.note.band_t90 = {"500": {"t90": .055}}
    result = compare_features(ref, render, weights_for_instrument("violin"))
    gate = evaluate_tripwires("violin", [{
        "register": "mid", "dynamic": "mf", "result": result,
        "ref": ref, "render": render,
    }])
    bars = {row["bar"]: row for row in gate["bars"]}
    for bar in ("partial-table", "mel-spectrogram", "attack-t90",
                "vibrato", "inharmonicity", "band-balance"):
        assert bar in bars
    assert bars["band-balance"]["status"] == "fail"   # the tilt trips it
    assert bars["vibrato"]["status"] == "not-applicable"
    assert not gate["passed"]
    table = tripwire_table_markdown(gate)
    assert "band-balance" in table and "FAIL" in table


def test_near_zero_inharmonicity_uses_stretch_cents_instead_of_b_ratio():
    ref = _bundle(partials=[1] * 40, B=0.0)
    tiny = _bundle(partials=[1] * 40, B=1e-8)
    stretched = _bundle(partials=[1] * 40, B=0.0004)

    def bar(render):
        result = compare_features(ref, render, weights_for_instrument("guitar"))
        gate = evaluate_tripwires("guitar", [{
            "register": "mid", "dynamic": "mf", "result": result,
            "ref": ref, "render": render,
        }])
        return next(row for row in gate["bars"] if row["bar"] == "inharmonicity")

    near_zero = bar(tiny)
    assert near_zero["status"] == "pass"
    assert near_zero["value"]["errorCents"] < 3
    too_stretched = bar(stretched)
    assert too_stretched["status"] == "fail"
    assert too_stretched["value"]["errorCents"] > 3

    nonzero_ref = _bundle(partials=[1] * 40, B=0.0002)
    nonzero_render = _bundle(partials=[1] * 40, B=0.00025)
    result = compare_features(nonzero_ref, nonzero_render,
                              weights_for_instrument("guitar"))
    gate = evaluate_tripwires("guitar", [{
        "register": "mid", "dynamic": "mf", "result": result,
        "ref": nonzero_ref, "render": nonzero_render,
    }])
    ordinary = next(row for row in gate["bars"] if row["bar"] == "inharmonicity")
    assert ordinary["status"] == "pass"
    assert ordinary["value"] == pytest.approx(1.25)


def test_tone_matcher_reuses_exact_duplicate_candidate_objective(tmp_path):
    matcher = ToneMatcher(
        "guitar-nylon", {"partialTilt": 0.0}, [],
        [FreeParam("partialTilt", -1, 1, 0)], tmp_path,
        {"status": "insufficient-evidence"}, weights={"partials_db": 1.0})
    fingerprint = iterate_module._candidate_fingerprint(
        matcher.free, {"partialTilt": 0.0})
    matcher._objective_cache[fingerprint] = 12.5
    assert matcher.evaluate(np.asarray([0.0])) == 12.5
    assert matcher.evaluations == []
    assert not (tmp_path / "renders").exists()


def test_bowed_dynamic_tilt_gate_rejects_static_dynamics():
    def sample(dynamic, partials):
        bundle = _bundle(partials=partials)
        return ConstructionSample(bundle, bundle, "mid", dynamic, dynamic)
    dull = [1, .3, .1, .05, .02, .01, .005, .002]
    bright = [1, .6, .45, .3, .25, .18, .12, .08]
    base = {"excitationType": "bow", "resonatorClass": "string"}
    static = evaluate_construction("violin", [sample(.2, dull), sample(.9, dull)],
                                   params=base)
    by_id = {row["id"]: row for row in static["assertions"]}
    assert by_id["violin.dynamic-tilt"]["status"] == "fail"
    tilted = evaluate_construction("violin", [sample(.2, dull), sample(.9, bright)],
                                   params=base)
    by_id = {row["id"]: row for row in tilted["assertions"]}
    assert by_id["violin.dynamic-tilt"]["status"] == "pass"
    assert "violin.bow-force-edge" not in {row["id"] for row in tilted["assertions"]}


def test_bowed_body_peak_cluster_requires_signature_modes():
    base = {"excitationType": "bow", "resonatorClass": "string"}
    wrong = evaluate_construction("violin", _bowed_samples(), params={
        **base, "bodyBands": [
            {"freq": 800, "gain": .4, "width": .2},
            {"freq": 2300, "gain": 1.0, "width": .3},
            {"freq": 4200, "gain": .2, "width": .3},
        ]})
    by_id = {row["id"]: row for row in wrong["assertions"]}
    assert by_id["violin.body-peak-cluster"]["status"] == "fail"
    right = evaluate_construction("violin", _bowed_samples(), params={
        **base, "bodyBands": [
            {"freq": 275, "gain": .5, "width": .2},   # A0
            {"freq": 500, "gain": .6, "width": .2},   # B1 cluster
            {"freq": 2300, "gain": 1.0, "width": .3},
        ]})
    by_id = {row["id"]: row for row in right["assertions"]}
    assert by_id["violin.body-peak-cluster"]["status"] == "pass"


def test_owner_excluded_takes_never_reach_a_reference_set():
    # T-012/L3: exclusion is per take, not per source
    assert is_excluded("trumpet_C5_15_fortissimo_normal.mp3")
    assert not is_excluded("saxophone_C4_15_fortissimo_normal.mp3")
    good = [{"sourceFile": "saxophone_C4_15_fortissimo_normal.mp3"}]
    assert_no_excluded(good, "test")   # passes silently
    bad = good + [{"sourceFile": "trumpet_C5_15_fortissimo_normal.mp3"}]
    with pytest.raises(ValueError, match="owner-excluded"):
        assert_no_excluded(bad, "test")


def test_tripwire_cell_aggregation_keeps_short_takes_visible():
    # T-013/T-017: strict coverage is per BAR x register x dynamic — an
    # onset measurement can never stand in for missing band-balance
    # evidence, and the missing-cell report names the bar.
    def gate_with(rows):
        return {"bars": [{"bar": bar, "register": "mid", "dynamic": "pp",
                          "value": None, "limit": "", "status": status}
                         for bar, status in rows]}
    mixed = aggregate_by_cell(
        gate_with([("band-balance", "not-applicable"), ("band-balance", "pass")]),
        required_cells=[("mid", "pp")], required_bars=["band-balance"])
    assert mixed["cells"][0]["status"] == "pass"
    assert mixed["cells"][0]["counts"]["notApplicable"] == 1
    assert mixed["strictPassed"]
    # two short takes: the band-balance BAR cell has no evidence even
    # though another bar measured there (T-017's exact scenario)
    all_short = aggregate_by_cell(
        gate_with([("band-balance", "not-applicable"),
                   ("band-balance", "not-applicable"),
                   ("partial-table", "pass")]),
        required_cells=[("mid", "pp")],
        required_bars=["band-balance", "partial-table"])
    assert not all_short["strictPassed"]
    assert all_short["strictMissingCells"] == [
        {"bar": "band-balance", "register": "mid", "dynamic": "pp"}]
    failing = aggregate_by_cell(gate_with([("band-balance", "pass"),
                                           ("band-balance", "fail")]),
                                required_cells=[("mid", "pp")])
    assert failing["cells"][0]["status"] == "fail" and not failing["passed"]
    # family-inapplicable bars never count as missing evidence
    blown = aggregate_by_cell(
        gate_with([("band-balance", "pass")]),
        required_cells=[("mid", "pp")],
        required_bars=["band-balance", "inharmonicity"], family="blown")
    assert blown["strictPassed"]


def test_iteration_tripwire_consumer_keeps_zero_weight_watch_bars_non_blocking(monkeypatch):
    def gate(_instrument, notes):
        status = notes[0]["result"]["partialStatus"]
        return {"bars": [
            {"bar": "partial-table", "register": "mid", "dynamic": "mf",
             "value": 2.0, "limit": "<= 3 dB", "status": status},
            {"bar": "band-balance", "register": "mid", "dynamic": "mf",
             "value": {"meanDb": 12}, "limit": "<= 3 dB", "status": "fail"},
        ]}
    monkeypatch.setattr(iterate_module, "evaluate_tripwires", gate)
    references = [{"register": "mid", "dynamic": "mf", "midi": 60}]
    construction = {"instrument": "guitar", "family": "struck-plucked",
                    "passed": True, "counts": {"fail": 0}}
    result = _tripwire_gate(
        [{"register": "mid", "dynamic": "mf",
          "result": {"partialStatus": "pass"}, "ref": _bundle(), "render": _bundle()}],
        references, construction, {"partials_db": 1.0, "band_balance_db": 0.0})
    assert result["passed"]
    assert result["failureCount"] == 0
    assert result["activeBars"] == ["partial-table"]
    assert result["watchBars"] == ["band-balance"]
    assert result["rows"][0]["passed"]

    failed = _tripwire_gate(
        [{"register": "mid", "dynamic": "mf",
          "result": {"partialStatus": "fail"}, "ref": _bundle(), "render": _bundle()}],
        references, construction, {"partials_db": 1.0, "band_balance_db": 0.0})
    assert not failed["passed"]
    assert failed["failureCount"] == 1
    assert not failed["rows"][0]["passed"]


def test_trumpet_dynamic_articulation_requires_reference_direction_match():
    def sample(dynamic, ref_level, render_level):
        ref = _bundle(); render = _bundle()
        ref.note.attack_noise = {"level": ref_level}
        render.note.attack_noise = {"level": render_level}
        return ConstructionSample(render, ref, "mid", dynamic, dynamic)
    base = {"excitationType": "blow", "resonatorClass": "conicalTube",
            "articulationVelocitySlope": .5}
    # references: loud onsets stronger; render matches => pass
    good = evaluate_construction("trumpet", [
        sample(.2, .02, .03), sample(.9, .08, .09)], params=base)
    by_id = {row["id"]: row for row in good["assertions"]}
    assert by_id["trumpet.dynamic-articulation"]["status"] == "pass"
    # render inverts the direction => fail
    inverted = evaluate_construction("trumpet", [
        sample(.2, .02, .09), sample(.9, .08, .01)], params=base)
    by_id = {row["id"]: row for row in inverted["assertions"]}
    assert by_id["trumpet.dynamic-articulation"]["status"] == "fail"


def test_deconvolution_mask_equals_emission_mask_round_trip():
    # T-014: raw ~= emittedBody(amount=1) x residual for every fitted point
    rng = np.random.default_rng(5)
    notes = []
    for index in range(12):
        f0 = 110 * 2 ** (index / 12)
        freqs = f0 * np.arange(1, 17)
        source = np.arange(1, 17, dtype=float) ** -1.15
        body = 2 ** (1.1 * np.exp(-.5 * (np.log2(freqs / 800) / .38) ** 2))
        amps = source * body
        amps /= amps.max()
        notes.append(NoteAnalysis(
            f"file-{index % 4}", f0, "test", 1, amps, freqs,
            np.ones(16, dtype=bool)))
    bands, adjusted, fit_info = fit_fixed_body(notes, 16)
    assert fit_info["reconstructionAmount"] == 1
    assert fit_info["roundTripShapeMaxDb"] <= 1.0
    # reconstruct: emitted body envelope x residual === raw (per-note scale free)
    def emitted_gain(freq):
        total = 0.0
        for band in bands:
            total += band["gain"] * np.exp(
                -.5 * ((np.log2(freq / band["freq"])) / band["width"]) ** 2)
        return 2 ** total
    worst = 0.0
    for note, residual in zip(notes, adjusted):
        recon = np.array([residual[i] * emitted_gain(note.partial_freqs[i])
                          for i in range(16)])
        ratio = note.partial_amps / np.maximum(recon, 1e-12)
        log_ratio = np.log(ratio)
        worst = max(worst, float(np.ptp(log_ratio)))   # scale-free shape error
    assert worst < .25, worst


def _mode_locked_tone(f0, dominant_harmonic, sr=44_100, duration=1.2,
                      n_partials=6):
    t = np.arange(int(sr * duration)) / sr
    tone = np.zeros_like(t)
    for k in range(1, n_partials + 1):
        gain = 1.0 if k == dominant_harmonic else .08
        tone += gain * np.sin(2 * np.pi * k * f0 * t)
    envelope = np.minimum(1, t / .01) * np.minimum(1, (duration - t) / .05)
    return tone * envelope


def test_anchored_f0_recovers_fundamental_from_dominant_third_mode():
    # T-020: low string with a dominant 3rd mode — tracker locks to 3*f0;
    # the known note anchor recovers the fundamental, keeps QC provenance.
    sr = 44_100
    f0 = 32.7 * 2                       # C2-ish, above the 40 Hz floor
    seg = _mode_locked_tone(f0, dominant_harmonic=3, sr=sr)
    from scripts.fit_profiles_from_samples import analyse_note
    anchored = analyse_note(seg, sr, "c2.wav", 16, min_detected_partials=2,
                            expected_f0_hz=f0)
    assert anchored is not None
    assert abs(1200 * np.log2(anchored.f0 / f0)) < 50
    assert anchored.f0_unconstrained is not None


def test_anchored_f0_far_from_every_candidate_fails_loudly():
    sr = 44_100
    seg = _mode_locked_tone(440.0, dominant_harmonic=1, sr=sr)
    from scripts.fit_profiles_from_samples import analyse_note
    with pytest.raises(ValueError, match="50 cents"):
        analyse_note(seg, sr, "off.wav", 16, min_detected_partials=2,
                     expected_f0_hz=555.0)   # ~402 cents off every candidate


def test_trusted_render_anchor_allows_the_piano_c1_range():
    sr = 24_000
    f0 = 32.703
    seg = _mode_locked_tone(f0, dominant_harmonic=2, sr=sr, n_partials=6)
    from scripts.fit_profiles_from_samples import analyse_note
    note = analyse_note(seg, sr, "scheduled-c1.wav", 16,
                        min_detected_partials=2, expected_f0_hz=f0,
                        trust_expected_f0=True, force_percussive=True)
    assert note is not None
    assert note.f0 == pytest.approx(f0)


def _bowed_samples():
    return [ConstructionSample(_bundle(), _bundle(), register, dynamic, dynamic)
            for register in ("low", "mid", "high") for dynamic in (.25, .9)]


def test_string_labels_are_carried_and_phil_names_parsed():
    assert parse_string_label("Violin.arco.pp.sulG.G3B3.aiff") == "sulG"
    assert parse_string_label("Cello.arco.ff.sulC.C2A2.aiff") == "sulC"
    assert parse_string_label("phil.violin_G3_15_piano_non-vibrato.mp3") is None
    meta = parse_phil_name("phil.violin_Cs4_long_mezzo-piano_non-vibrato.mp3")
    assert meta == {"midi": 61, "length": "long", "dynamic": "mezzo-piano",
                    "vibrato": "nonvib"}
    vib = parse_phil_name("phil.cello_A4_1_mezzo-piano_molto-vibrato.mp3")
    assert vib["vibrato"] == "vib" and vib["midi"] == 69


def test_bow_change_detection_trims_to_single_bow():
    sr = 44_100
    t = np.arange(int(2.0 * sr)) / sr
    tone = np.sin(2 * np.pi * 220 * t)
    envelope = np.ones_like(t)
    envelope[t < .05] = t[t < .05] / .05
    dip = np.abs(t - 1.2) < .04                  # bow change at 1.2 s
    envelope[dip] *= .12
    segment, changed = trim_to_single_bow(tone * envelope, sr)
    assert changed
    # the longest single-bow span is the first ~1.2 s
    assert 0.8 * sr <= len(segment) <= 1.35 * sr

    clean, changed_clean = trim_to_single_bow(tone * np.ones_like(t), sr)
    assert not changed_clean
    assert len(clean) == len(t)


def test_outlier_screen_flags_muted_take_within_peer_group():
    rng = np.random.default_rng(3)
    rows = [{"group": "violin|sulA|ff|Iowa", "name": f"take-{i}",
             "features": {"tiltDbPerOct": -6 + rng.normal(0, .4),
                          "spectralIndex": 3 + rng.normal(0, .2),
                          "attackNoiseLevel": .02 + rng.normal(0, .005)}}
            for i in range(9)]
    rows.append({"group": "violin|sulA|ff|Iowa", "name": "muted-take",
                 "features": {"tiltDbPerOct": -18.0, "spectralIndex": 1.2,
                              "attackNoiseLevel": .02}})
    rows.append({"group": "violin|sulA|ff|Iowa", "name": "hard-attack-take",
                 "features": {"tiltDbPerOct": -6.0, "spectralIndex": 3.0,
                              "attackNoiseLevel": .3}})
    flags = screen_outliers(rows)
    muted = [flag for flag in flags if flag["name"] == "muted-take"]
    assert muted and all(not flag["advisory"] for flag in muted)
    # a strong articulation is human variation: flagged for ears, advisory
    hard = [flag for flag in flags if flag["name"] == "hard-attack-take"]
    assert hard and all(flag["advisory"] for flag in hard)
    # small peer groups never flag (evidence, not guesswork)
    assert screen_outliers(rows[:3]) == []


def test_take_pair_inventory_separates_duplicates_from_vibrato_pairs():
    files = [
        "phil.violin_Cs4_1_mezzo-piano_non-vibrato.mp3",
        "phil.violin_Cs4_long_mezzo-piano_non-vibrato.mp3",   # true duplicate
        "phil.cello_A4_1_mezzo-piano_molto-vibrato.mp3",
        "phil.cello_A4_1_mezzo-piano_non-vibrato.mp3",        # vib/nonvib pair
        "phil.violin_E5_1_mezzo-forte_molto-vibrato.mp3",     # unpaired
    ]
    pairs = inventory_take_pairs(files)
    assert len(pairs["trueDuplicates"]) == 1
    assert pairs["trueDuplicates"][0]["midi"] == 61
    assert pairs["trueDuplicates"][0]["vibrato"] == "nonvib"
    assert len(pairs["vibratoPairs"]) == 1
    assert pairs["vibratoPairs"][0]["midi"] == 69


def test_catalogue_duplicate_finder_requires_two_usable_takes(tmp_path):
    # C2 fortissimo has two usable lengths; pianissimo has one usable and
    # one too-short (025) take, so it must not form a group.
    for name in ("cello_C2_1_fortissimo_arco-normal.mp3",
                 "cello_C2_15_fortissimo_arco-normal.mp3",
                 "cello_C2_05_pianissimo_arco-normal.mp3",
                 "cello_C2_025_pianissimo_arco-normal.mp3"):
        (tmp_path / name).write_bytes(b"")
    groups = find_catalogue_duplicates(tmp_path, "cello")
    assert len(groups) == 1
    group = groups[0]
    assert group["midi"] == 36 and group["dynamic"] == "ff"
    assert len(group["files"]) == 2
    # anchor notes stay consistent with the campaign tables
    for instrument, anchors in STRING_CAMPAIGNS.items():
        assert set(PHIL_ANCHOR_NOTES[instrument]) == {a["midi"] for a in anchors}


def test_string_campaigns_cover_three_registers_and_two_dynamics():
    for instrument, anchors in STRING_CAMPAIGNS.items():
        assert {a["register"] for a in anchors} == {"low", "mid", "high"}
        for anchor in anchors:
            assert anchor["string"].startswith("sul")
            assert "pp" in anchor and "ff" in anchor


def test_bowed_checklist_requires_instrument_specific_measured_body():
    base = {"excitationType": "bow", "resonatorClass": "string"}
    missing = evaluate_construction("violin", _bowed_samples(), params=base)
    by_id = {row["id"]: row for row in missing["assertions"]}
    assert by_id["violin.measured-body"]["status"] == "fail"
    fitted = evaluate_construction("violin", _bowed_samples(), params={
        **base, "bodyBands": [
            {"freq": 480, "gain": .3, "width": .2},
            {"freq": 1180, "gain": -.3, "width": .2},
            {"freq": 2330, "gain": 1.1, "width": .2},
        ],
    })
    by_id = {row["id"]: row for row in fitted["assertions"]}
    assert by_id["violin.measured-body"]["status"] == "pass"


def test_bowed_family_firewall_blocks_blown_fitted_onset_values():
    # A blown-fitted articulation law pasted onto a bowed preset without
    # string-corpus evidence must fail; the same values WITH per-instrument
    # onset evidence pass; fully neutral presets pass by construction.
    base = {"excitationType": "bow", "resonatorClass": "string"}
    neutral = evaluate_construction("cello", _bowed_samples(), params=base)
    by_id = {row["id"]: row for row in neutral["assertions"]}
    assert by_id["cello.family-firewall-neutral-onset"]["status"] == "pass"

    pasted = evaluate_construction("cello", _bowed_samples(), params={
        **base, "articulationCoupling": .6, "onsetScoopDepthCents": 40})
    by_id = {row["id"]: row for row in pasted["assertions"]}
    assert by_id["cello.family-firewall-neutral-onset"]["status"] == "fail"

    evidenced = evaluate_construction("cello", _bowed_samples(), params={
        **base, "articulationCoupling": .6, "onsetScoopDepthCents": 40,
        "onsetArticulationCorrelation": -.4, "onsetPitchNotes": 9})
    by_id = {row["id"]: row for row in evidenced["assertions"]}
    assert by_id["cello.family-firewall-neutral-onset"]["status"] == "pass"

    # legacy linear breath exponent (1.0) is neutral, not a fitted law
    linear = evaluate_construction("cello", _bowed_samples(), params={
        **base, "breathVelocityExponent": 1.0})
    by_id = {row["id"]: row for row in linear["assertions"]}
    assert by_id["cello.family-firewall-neutral-onset"]["status"] == "pass"


def test_blown_checklist_requires_instrument_specific_measured_body():
    samples = [ConstructionSample(_bundle(), _bundle(), register, dynamic, dynamic)
               for register in ("low", "mid", "high") for dynamic in (.25, .9)]
    base = {"excitationType": "blow", "resonatorClass": "conicalTube",
            "dynamicBlare": .2}
    missing = evaluate_construction("french-horn", samples, params=base)
    by_id = {row["id"]: row for row in missing["assertions"]}
    assert by_id["french-horn.measured-body"]["status"] == "fail"
    fitted = evaluate_construction("french-horn", samples, params={
        **base, "bodyBands": [
            {"freq": 300, "gain": -.2, "width": .5},
            {"freq": 800, "gain": .5, "width": .5},
            {"freq": 2200, "gain": .2, "width": .6},
        ],
    })
    by_id = {row["id"]: row for row in fitted["assertions"]}
    assert by_id["french-horn.measured-body"]["status"] == "pass"


def test_corpus_sidecar_filename_classification():
    assert _dynamics("AltoSax.NoVib.ff.C4B4.aiff") == "ff"
    assert _dynamics("vocalset.m3.scales.slow_piano.m3_scales_c_slow_piano_a.wav") == "p"
    assert _vibrato("phil.violin_A4_mezzo-piano_non-vibrato.mp3") == "nonvib"
    assert _vibrato("vocalset.m3.scales.vibrato.m3_scales_vibrato_a.wav") == "vib"
    assert _note_span("BbClar.mf.D3B3.aiff") == "D3–B3"
    assert _vowel("m3_long_straight_u.wav") == "u"
    assert _vowel("AltoSax.NoVib.ff.C4B4.aiff") is None
    assert vowel_from_filename("vocalset.m3.long.m3_long_straight_i.wav") == "i"


def test_blown_campaign_matrix_has_three_registers_and_two_dynamics():
    assert set(CAMPAIGNS) == {"flute", "clarinet", "alto-sax", "trumpet", "french-horn"}
    for instrument, rows in CAMPAIGNS.items():
        assert {row["register"] for row in rows} == {"low", "mid", "high"}
        assert all({"pp", "ff", "midi"}.issubset(row) for row in rows)
        # T-015: flute is an explicit open cylindrical bore, not a string alias
        expected = "openTube" if instrument == "flute" else "closedTube" if instrument == "clarinet" else "conicalTube"
        assert RESONATOR[instrument] == expected
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["clarinet"]) == 6
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["alto-sax"]) == 6
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["flute"]) == 6
