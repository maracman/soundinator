from __future__ import annotations

import json

import numpy as np
import pytest
import scripts.tone_match.iterate as iterate_module
import scripts.tone_match.score as score_module

from scripts.fit_profiles_from_samples import NoteAnalysis, aggregate_instrument, fit_fixed_body, fit_take_spread, harmonic_frame_amps, onset_pitch_stats, validate_corpus_contract, vibrato_stats, vowel_from_filename
from scripts.tone_match.finalize_corpus import _dynamics, _note_span, _vibrato, _vowel
from scripts.tone_match.assertions import ConstructionSample, evaluate_construction
from scripts.tone_match.build_campaign import CAMPAIGNS, PHILHARMONIA_WOODWIND_ALTERNATES, RESONATOR
from scripts.tone_match.iterate import FreeParam, _append_ledger, _band_limits_for_reference, _dominant_residual, _floor_evidence, _params, _reference_set_id, _reference_variability, _tripwire_gate, _write_run_report
from scripts.tone_match.strings_prep import STRING_CAMPAIGNS, inventory_take_pairs, parse_phil_name, parse_string_label, screen_outliers, trim_to_single_bow
from scripts.tone_match.score import FeatureBundle, OCTAVE_CENTRES, THIRD_OCTAVE_CENTRES, _BOWED_P1_FEATURES, _fractional_octave_profile, _mel_bank, _noise_and_onset_observables, _resample_time, band_balance_distance, compare_features, quantitative_tripwires, weights_for_instrument


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


def test_sustained_band_profile_is_gain_invariant_and_uses_third_octaves():
    sr = 44_100
    t = np.arange(int(1.7 * sr)) / sr
    envelope = np.minimum(1, t / .03) * np.minimum(1, (1.7 - t) / .05)
    tone = envelope * (np.sin(2 * np.pi * 500 * t) + .3 * np.sin(2 * np.pi * 2000 * t))
    profile = _fractional_octave_profile(tone, sr, THIRD_OCTAVE_CENTRES, 3)
    quieter = _fractional_octave_profile(tone * .07, sr, THIRD_OCTAVE_CENTRES, 3)
    assert profile is not None and profile.shape == (21,)
    assert quieter is not None
    assert np.max(np.abs(profile - quieter)) < 1e-8
    assert THIRD_OCTAVE_CENTRES[int(np.argmax(profile))] == 500


def test_band_balance_distance_and_tripwires_expose_octave_tilt():
    reference = _bundle()
    rendered = _bundle()
    reference.band_balance_db = np.full(21, -20.0)
    rendered.band_balance_db = reference.band_balance_db.copy()
    reference.octave_balance_db = np.full(8, -12.0)
    rendered.octave_balance_db = reference.octave_balance_db.copy()
    rendered.band_balance_db[-4:] += 4
    rendered.octave_balance_db[-1] += 7
    distance = band_balance_distance(reference, rendered)
    assert distance["status"] == "measured"
    assert distance["meanDb"] == pytest.approx(16 / distance["validBands"])
    assert distance["maxOctaveDb"] == 7
    result = compare_features(reference, rendered, weights_for_instrument("flute"))
    gates = quantitative_tripwires(reference, rendered, result, "flute")
    by_name = {row["name"]: row for row in gates["rows"]}
    assert by_name["band-balance-mean"]["status"] == "pass"
    assert by_name["band-balance-max-octave"]["status"] == "fail"


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


def test_band_tripwire_only_widens_to_measured_take_variability():
    variability = {"status": "measured", "groups": [{
        "referenceIndices": [0, 1],
        "floorFeatures": {"band_balance_db": 4.5},
        "floorBandMaxOctaveDb": 8.0,
    }]}
    assert _band_limits_for_reference(0, variability) == (4.5, 8.0)
    assert _band_limits_for_reference(2, variability) == (3.0, 6.0)
    lower = {"status": "measured", "groups": [{
        "referenceIndices": [0], "floorFeatures": {"band_balance_db": 1.0},
        "floorBandMaxOctaveDb": 2.0,
    }]}
    assert _band_limits_for_reference(0, lower) == (3.0, 6.0)


def test_campaign_tripwire_table_applies_floor_and_keeps_other_failures():
    checks = [
        {"name": "partial-table", "status": "fail", "observed": 4.0, "limit": "<=3"},
        {"name": "inharmonicity-b", "status": "not-applicable", "observed": None, "limit": "n/a"},
        {"name": "band-balance-mean", "status": "fail", "observed": 4.0, "limit": "<=3"},
        {"name": "band-balance-max-octave", "status": "fail", "observed": 7.0, "limit": "<=6"},
    ]
    score = {"tripwires": {"rows": checks}, "bandBalance": {}}
    variability = {"status": "measured", "groups": [{
        "referenceIndices": [0], "floorFeatures": {"band_balance_db": 5.0},
        "floorBandMaxOctaveDb": 9.0,
    }]}
    gate = _tripwire_gate([score], [{"register": "low", "dynamic": "pp", "midi": 60}],
                          variability, {"passed": True, "counts": {"fail": 0}})
    by_name = {row["name"]: row for row in gate["rows"][0]["checks"]}
    assert by_name["band-balance-mean"]["status"] == "pass"
    assert by_name["band-balance-max-octave"]["status"] == "pass"
    assert by_name["partial-table"]["status"] == "fail"
    assert not gate["passed"]


def test_run_report_ends_with_required_owner_pass_artifacts(tmp_path):
    check = {"name": "band-balance-mean", "status": "pass", "observed": 2.0,
             "limit": "<= 3 dB"}
    construction = {"passed": True, "assertions": [{"id": "flute.band-balance",
                    "status": "pass", "requirement": "paired profile"}]}
    summary = {
        "instrument": "flute", "run": "pass", "baselineLoss": 2.0,
        "bestLoss": 1.5, "improvement": .5, "constructionPassed": True,
        "construction": construction, "automatedGatePassed": True,
        "referenceVariabilityFloor": {"status": "above-floor", "groups": []},
        "dominantResidual": None, "sessionOutcome": {"state": "improvement"},
        "tripwireGate": {"rows": [{"register": "low", "dynamic": "pp", "midi": 60,
                            "passed": True, "checks": [check]}]},
        "resourceTripwire": {"passed": True, "preset": {"oscillators": 20,
                                "automationEventsPerNote": 100, "modelMsPerNote": .1}},
        "freeParameters": ["toneBreath"], "bestParams": {"toneBreath": .2},
        "sensitivity": {"toneBreath": {"minus": 1.6, "plus": 1.7, "increase": .15}},
        "exchangeStatuses": [{"id": "T-005", "title": "bands", "engine": "incorporated"}],
        "leaderboardState": {"isLeader": True, "previousBestLoss": 2.0},
        "referenceSet": "abc", "renderArtifacts": {"bestRenderDirectory": "/tmp/renders",
            "listeningPage": "/tmp/listen-flute.html", "auditionManifest": "/tmp/audition.json"},
    }
    path = tmp_path / "RUN_REPORT.md"
    _write_run_report(path, summary)
    report = path.read_text()
    for heading in ("Automated §3 gate", "Controllability", "Techniques exchange statuses",
                    "Leaderboard state", "Owner render directories"):
        assert heading in report
    assert report.rstrip().endswith("`/tmp/audition.json`")


def test_blown_scoring_does_not_fit_stiff_string_inharmonicity():
    blown = weights_for_instrument("french-horn")
    string = weights_for_instrument("violin")
    assert blown["inharmonicity_log_ratio"] == 0
    assert string["inharmonicity_log_ratio"] == 1
    assert weights_for_instrument("trumpet", {"noise": .5})["noise"] == .5


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
    assert fit_info["method"] == "ensemble-rank-note-body-v2"
    assert fit_info["notes"] == 12


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
     onset_centroid_oct, noise_lead_ms) = _noise_and_onset_observables(
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
    blown = weights_for_instrument("clarinet")
    bowed = weights_for_instrument("violin")
    for key in _BOWED_P1_FEATURES:
        assert blown[key] == 0.0
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
        expected = "string" if instrument == "flute" else "closedTube" if instrument == "clarinet" else "conicalTube"
        assert RESONATOR[instrument] == expected
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["clarinet"]) == 6
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["alto-sax"]) == 6
    assert len(PHILHARMONIA_WOODWIND_ALTERNATES["flute"]) == 6
