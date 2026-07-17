from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import scripts.tone_match.iterate as iterate_module
import scripts.tone_match.score as score_module
import scripts.tone_match.struck_plucked_prep as struck_prep_module
from scripts.tone_match.piano_anatomy import VALIDATION_SCHEMA as PIANO_ANATOMY_VALIDATION_SCHEMA, validate as validate_piano_anatomy

from scripts.fit_profiles_from_samples import NoteAnalysis, aggregate_instrument, bowed_string_from_filename, expected_single_note_f0, fit_fixed_body, fit_take_spread, guitar_course_for_midi, harmonic_frame_amps, merge_profile_sets, onset_pitch_stats, validate_bowed_body_modes, validate_corpus_contract, vibrato_stats, vowel_from_filename
from scripts.tone_match.finalize_corpus import _dynamics, _note_span, _vibrato, _vowel
from scripts.tone_match.assertions import (
    ConstructionSample,
    SUNG_DERIVED_PRESETS,
    SUNG_SECTION_TYPES,
    assert_sung_family_firewall,
    evaluate_construction,
    normalize_instrument,
)
from scripts.tone_match.build_campaign import CAMPAIGNS, PHILHARMONIA_WOODWIND_ALTERNATES, RESONATOR
from scripts.tone_match.controllability import (
    canonical_hash,
    manifest_contract_hash,
    objective_contract_hash,
    perturbations,
    validate_audit_contract,
)
from scripts.tone_match.iterate import (
    FreeParam,
    ToneMatcher,
    _append_ledger,
    _band_limits_for_reference,
    _candidate_fingerprint,
    _consume_controllability_audit,
    _dominant_residual,
    _distributional_variation_gate,
    _ensure_legacy_baseline,
    _floor_evidence,
    _free_manifest_contract,
    _load_preset,
    _mode_params,
    _native_human_episode_profile,
    _params,
    _reference_set_id,
    _reference_render_params_override,
    _reference_variability,
    _render_ship_variants,
    _renderer_contract_hash,
    _technique_exchange_statuses,
    _tripwire_gate,
    _update_leaderboard,
    _write_run_report,
)
from scripts.tone_match.legacy_prior import resolve_legacy_prior
from scripts.tone_match.humanisation import fit_excitation_position, ship_human_overrides
from scripts.tone_match.struck_plucked_prep import CAMPAIGNS as STRUCK_CAMPAIGNS, STRUCK_OBJECTIVE_ROLES, rebase_fitted_preset, seed_preset
from scripts.tone_match.strings_prep import BODY_REFERENCE_RUNS, ONSET_ROLE_MIDIS, PHIL_ANCHOR_NOTES, STRING_CAMPAIGNS, VIBRATO_ROLE_FILES, bowed_seed, find_catalogue_duplicates, inventory_take_pairs, iowa_filename_span, parse_phil_name, parse_string_label, screen_outliers, trim_to_single_bow
from scripts.tone_match.score import SCORER_CONTRACT_VERSION, FeatureBundle, OCTAVE_CENTRES, THIRD_OCTAVE_CENTRES, _BOWED_P1_FEATURES, _fractional_octave_profile, _mel_bank, _noise_and_onset_observables, _resample_time, _trajectory_power, band_balance_distance, band_balance_report, band_profile, compare_features, hold_decay_metrics, inharmonicity_comparison, ltas_rolloff, octave_summary_db, quantitative_tripwires, weights_for_instrument
from scripts.tone_match.build_campaign import _run_start_midi
from scripts.tone_match.tripwires import aggregate_by_cell, evaluate_tripwires, reference_roles, required_cells_by_bar, tripwire_table_markdown
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


def test_l18_hold_decay_metric_rejects_a_plateau_and_accepts_free_decay():
    sample_rate = 8_000
    times = np.arange(3 * sample_rate) / sample_rate
    attack = np.minimum(1.0, times / .01)
    plateau = attack * np.sin(2 * np.pi * 220 * times)
    free = attack * np.power(10.0, -3.0 * times / 20.0) * np.sin(
        2 * np.pi * 220 * times)
    flat_metrics = hold_decay_metrics(plateau, sample_rate)
    free_metrics = hold_decay_metrics(free, sample_rate)
    assert flat_metrics is not None and free_metrics is not None
    assert flat_metrics["slopeDbPerSecond"] > -.15
    assert flat_metrics["plateauFraction"] >= .5
    assert free_metrics["slopeDbPerSecond"] == pytest.approx(-3.0, abs=.08)
    assert free_metrics["plateauFraction"] < .5


def test_l16_l17_l18_piano_anatomy_extractor_passes_synthetic_roundtrip(tmp_path):
    output = tmp_path / "piano-anatomy-validation.json"
    result = validate_piano_anatomy(output)
    assert result["schema"] == PIANO_ANATOMY_VALIDATION_SCHEMA
    assert result["status"] == "pass"
    assert all(result["checks"].values())
    assert output.exists()


def test_l16_onset_boost_is_temporal_not_relative_to_fundamental():
    from scripts.tone_match.piano_anatomy import _component_rows, _synthetic_note

    sample_rate = 24_000
    f0 = 220.0
    samples = _synthetic_note(f0, .9, sample_rate=sample_rate)
    partials, bands, _ = _component_rows(
        samples, sample_rate, f0, .9, "synthetic")
    rank_six = next(row for row in partials if row["rank"] == 6)
    assert rank_six["onsetBoostDb"] > 0
    assert rank_six["onsetLevelRelativeToFundamentalDb"] < 0
    assert all("onsetLevelRelativeToBandMedianDb" in row for row in bands)


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
    distance = band_balance_report(reference, rendered)
    assert distance["status"] == "measured"
    assert distance["meanDb"] == pytest.approx(16 / distance["validBands"])
    assert distance["maxOctaveDb"] == 7
    result = compare_features(reference, rendered, weights_for_instrument("flute"))
    gates = quantitative_tripwires(reference, rendered, result, "flute")
    by_name = {row["name"]: row for row in gates["rows"]}
    assert by_name["band-balance-mean"]["status"] == "pass"
    assert by_name["band-balance-max-octave"]["status"] == "fail"


def test_reacquired_chromatic_run_names_resolve_their_first_midi():
    assert _run_start_midi("BbClar.pp.D3B3.aiff") == 50
    assert _run_start_midi("AltoSax.NoVib.ff.Db3B3.aiff") == 49
    assert _run_start_midi("Horn.ff.Bb1B1.aiff") == 34


def test_requested_blown_controls_have_controllability_probes():
    from scripts.tone_match.controllability import BOWED_FREE_PARAMS
    assert {
        "breathLevelScale", "breathVelocityExponent", "breathTurbulence",
        "breathBodyAmount", "onsetSpectrumTilt", "onsetSpectrumDecay",
        "articulationVelocitySlope",
    } <= set(BOWED_FREE_PARAMS)


def test_qualified_human_ranges_survive_a_masked_decomposition():
    from scripts.tone_match.humanisation import _consume_profile_ranges
    profiles = {"french-horn": {"partials": []}}
    empty = {"decompositionTest": {"verdict": "INCONCLUSIVE-MASKED"},
             "ranges": {}}
    assert not _consume_profile_ranges(profiles, "french-horn", empty)
    assert "humanRanges" not in profiles["french-horn"]
    masked = {"decompositionTest": {"verdict": "INCONCLUSIVE-MASKED"},
              "ranges": {"excitationPosition": {"status": "measured"}}}
    assert _consume_profile_ranges(profiles, "french-horn", masked)
    assert profiles["french-horn"]["humanRanges"] is masked


def test_humanisation_group_is_separate_from_stopping_floor_group():
    from scripts.tone_match.humanisation import _pair_group

    reference = {
        "roles": ["humanisation"],
        "humanisationGroup": "55|pp|arco-normal|sulD|PhilCat",
        "floorGroup": "humanisation-only|take-a",
    }
    assert _pair_group(reference) == reference["humanisationGroup"]


def test_bowed_release_metrics_wait_for_a_labelled_bow_lift_contract():
    for instrument in ("violin", "cello"):
        weights = weights_for_instrument(instrument)
        assert weights["release_ring_ms"] == 0
        assert weights["release_damp_db_per_s"] == 0
        assert weights["release_noise_db"] == 0


def test_human_candidate_requires_double_dissociation_in_both_directions():
    from scripts.tone_match.humanisation import _double_dissociation
    left = {"excitationPosition": .08}
    right = {"excitationPosition": .14}
    qualified = _double_dissociation("excitationPosition", left, right)
    assert qualified["v1ImprovesTake1AndWorsensTake2"]
    assert qualified["v2ImprovesTake2AndWorsensTake1"]
    assert qualified["qualified"]
    same = _double_dissociation(
        "excitationPosition", left, {"excitationPosition": .0805})
    assert not same["qualified"]


def test_f13_adjacent_note_variation_removes_register_trend_per_dimension():
    from scripts.tone_match.humanisation import (
        _dimension_evidence, _trend_removed_adjacent_deltas)
    rows = [{"midi": midi, "path": f"note-{midi}.wav"}
            for midi in (60, 61, 62, 63)]
    observations = []
    for index, position in enumerate((.10, .12, .105, .13)):
        row = {key: 0.0 for key in (
            "excitationPosition", "vibratoRateHz", "vibratoDepthCents",
            "vibratoOnsetDelayMs", "vibratoRampMs",
            "vibratoRateDriftHzPerSecond", "sustainNoiseDb",
            "onsetNoiseDb", "onsetNoiseCentroidOct", "noiseLeadMs",
            "onsetWanderCents", "onsetSettleMs", "attackNoiseLevel")}
        row["excitationPosition"] = position
        row["onsetWanderCents"] = 10 + 2 * index + (4 if index == 2 else 0)
        observations.append(row)
    result = _trend_removed_adjacent_deltas(rows, observations)
    assert len(result["pairs"]) == 3
    assert max(result["deltas"]["excitationPosition"]) > 0
    assert max(result["deltas"]["onsetWanderCents"]) > 0
    evidence = _dimension_evidence(
        "excitationPosition", matched_pairs=2, adjacent_pairs=3)
    assert evidence["strength"] == "full-strength"
    assert evidence["primaryBasis"] == \
        "lossless-within-run-adjacent-note-trend-removed"


def test_f13_duration_robust_repeat_is_not_blanket_downgraded():
    from scripts.tone_match.humanisation import _dimension_evidence
    onset = _dimension_evidence(
        "onsetWanderCents", matched_pairs=4, adjacent_pairs=0)
    noise_floor = _dimension_evidence(
        "vibratoRateDriftHzPerSecond", matched_pairs=4, adjacent_pairs=0)
    assert onset["strength"] == "full-strength"
    assert onset["durationMismatchAffectsGoal"] is False
    assert noise_floor["strength"] == "weaker-evidence"


def test_native_human_episode_requires_hashed_delivery_and_feature_response():
    from scripts.tone_match.humanisation import _consumer_status

    qualification = {
        "vibratoRate": {"status": "qualified-humanisation"},
        "onsetWanderCents": {"status": "qualified-humanisation"},
    }
    audit = {
        "clean": True,
        "humanRangeDelivery": "engine-native-zero-inflated-note-episode",
        "humanRangeContractHash": "contract-hash",
        "responsiveParameters": {
            "vibrato": [],
            "onset_wander_cents": ["excitationHuman"],
        },
    }
    status = _consumer_status(audit, qualification)
    assert not status["parameters"]["vibratoRate"]["functional"]
    assert status["parameters"]["onsetWanderCents"]["functional"]
    assert status["parameters"]["onsetWanderCents"]["delivery"] == \
        "engine-native-zero-inflated-note-episode"
    assert not status["allQualifiedConsumersFunctional"]

    audit["humanRangeContractHash"] = None
    unhashed = _consumer_status(audit, qualification)
    assert not unhashed["parameters"]["onsetWanderCents"]["functional"]


def test_human_decomposition_verdict_is_three_valued():
    from scripts.tone_match.humanisation import _decomposition_verdict
    assert _decomposition_verdict(0, False, False) == "PASS"
    assert _decomposition_verdict(2, True, True) == "FAIL-MISSING-DOF"
    assert _decomposition_verdict(2, False, True) == "INCONCLUSIVE-MASKED"
    assert _decomposition_verdict(2, True, False) == "INCONCLUSIVE-MASKED"


def test_criteria_drift_records_directed_tradeoffs_and_asymmetry():
    from scripts.tone_match.criteria_drift import directed_drift, rebuild_state
    first = {"partials_db": 2.0, "attack_ms": 1.0}
    second = {"partials_db": 1.0, "attack_ms": 1.5}
    drift = directed_drift(first, second, {
        "partials_db": .01, "attack_ms": .01})
    assert drift["improved"] == ["partials_db"]
    assert drift["degraded"] == ["attack_ms"]
    assert drift["events"] == ["partials_db⊣attack_ms"]
    steps = [{
        "id": f"violin:r:{index}",
        "featureLossVector": second,
        "driftFromPrevious": drift,
    } for index in range(6)]
    state = rebuild_state(steps)
    cell = state["asymmetryMatrix"]["partials_db"]["attack_ms"]
    assert cell["improveLeftDegradeRight"] == 6
    assert cell["significantEdge"]
    assert state["measuredEdges"][0]["from"] == "partials_db"


def test_criteria_drift_ignores_changes_inside_repeat_noise_floor():
    from scripts.tone_match.criteria_drift import directed_drift
    assert directed_drift(
        {"partials_db": 1.0, "attack_ms": 1.0},
        {"partials_db": .99, "attack_ms": 1.01},
        {"partials_db": .02, "attack_ms": .02}) is None


def test_tail_audit_distinguishes_full_release_from_truncation_and_phrases():
    from scripts.tone_match.tail_audit import analyse_tail_samples, phrase_take
    sample_rate = 8_000
    t = np.arange(sample_rate) / sample_rate
    decay = np.exp(-14 * np.maximum(0, t - .35))
    released = np.sin(2 * np.pi * 220 * t) * decay
    full = analyse_tail_samples(released, sample_rate)
    assert full["hasRelease"]
    assert full["releaseFeatures"]["releaseRingMs"] >= 0
    truncated = analyse_tail_samples(
        np.sin(2 * np.pi * 220 * t), sample_rate)
    assert not truncated["hasRelease"]
    assert truncated["releaseFeatures"] is None
    assert phrase_take({"sourceFile": "violin_C4_phrase_legato.wav"})


def test_bow_component_envelope_extractor_passes_synthetic_roundtrip():
    from scripts.tone_match.bow_noise import validate_component_envelope_roundtrip
    validation = validate_component_envelope_roundtrip()
    assert validation["status"] == "pass"
    assert all(validation["checks"].values())


def test_release_features_are_corpus_gated_and_watch_only_without_bow_lift_anchors():
    weights = weights_for_instrument("violin")
    for feature in ("release_ring_ms", "release_damp_db_per_s",
                    "release_noise_db"):
        assert weights[feature] == 0.0
    reference = _bundle(); rendered = _bundle()
    reference.release_ring_ms = 100.0; rendered.release_ring_ms = 600.0
    comparison = compare_features(reference, rendered, weights)
    assert comparison["features"]["release_ring_ms"] == 500.0
    assert comparison["composite"] == compare_features(
        reference, reference, weights)["composite"]

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


def test_trumpet_l9_articulation_slope_enters_blown_optimizer_free_set():
    manifest = json.loads((Path(__file__).parents[1] /
                           "scripts/tone_match/manifest.json").read_text())
    row = next(row for row in manifest["continuous"]
               if row["key"] == "articulationVelocitySlope")
    assert {key: row[key] for key in ("min", "max", "step", "default", "appliesTo")} == {
        "min": -1.5, "max": 1.5, "step": 0.01, "default": 0.0,
        "appliesTo": ["blow"],
    }
    resolved = _params(
        manifest,
        {"excitationType": "blow", "spectralProfile": "trumpet"},
        ["articulationVelocitySlope"],
    )
    assert resolved == [FreeParam("articulationVelocitySlope", -1.5, 1.5, 0.0)]
    assert _params(
        manifest,
        {"excitationType": "bow", "spectralProfile": "violin"},
        ["articulationVelocitySlope"],
    ) == []


def test_reference_set_id_changes_when_the_scored_manifest_changes():
    base = [{"path": "/tmp/a.wav", "midi": 60, "velocity": .2}]
    assert _reference_set_id(base) == _reference_set_id([dict(base[0])])
    assert _reference_set_id(base) != _reference_set_id(base + [
        {"path": "/tmp/b.wav", "midi": 60, "velocity": .2}
    ])
    assert _reference_set_id(base, weights={"partials_db": 1}) != \
        _reference_set_id(base, weights={"partials_db": 0})
    assert _reference_set_id(base, prior_hash="a") != \
        _reference_set_id(base, prior_hash="b")


def test_exchange_status_parser_uses_latest_per_lane_update(tmp_path, monkeypatch):
    exchange = tmp_path / "docs/sg2/TECHNIQUES_EXCHANGE.md"
    exchange.parent.mkdir(parents=True)
    exchange.write_text(
        "### T-001 · Example\n"
        "Status: analysis=pending engine=pending bowed=blocked-engine\n"
        "Status update: engine=incorporated abc analysis=adapted\n")
    monkeypatch.setattr(iterate_module, "ROOT", tmp_path)
    assert _technique_exchange_statuses() == [{
        "id": "T-001", "title": "Example", "engine": "incorporated abc",
        "analysis": "adapted", "bowed": "blocked-engine", "sung": "missing",
        "struck/plucked": "missing",
    }]


def test_humanisation_position_fit_recovers_existing_comb_law():
    rank = np.arange(1, 33, dtype=float)
    position = .137
    comb = 20 * np.log10(np.maximum(
        np.abs(np.sin(np.pi * rank * position)), 1e-3))
    observed = comb + 2.5 - 4.0 * np.log2(rank)
    fitted = fit_excitation_position(observed)
    assert fitted["position"] == pytest.approx(position, abs=.002)
    assert fitted["residualDb"] < .1


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
    upright = STRUCK_CAMPAIGNS["piano-upright"]
    nylon = STRUCK_CAMPAIGNS["guitar-nylon"]
    assert len(piano["anchors"]) >= 5
    assert [row["midi"] for row in piano["anchors"]] == [24, 36, 60, 84, 108]
    assert piano["dynamics"] == ("pp", "ff")
    assert len(upright["anchors"]) >= 5
    assert [row["midi"] for row in upright["anchors"]] == [21, 37, 53, 69, 85, 101, 108]
    assert upright["dynamics"] == ("p", "mf", "ff")
    assert upright["velocity"] == {"p": 30 / 127, "mf": 85 / 127, "ff": 119 / 127}
    assert len(nylon["anchors"]) >= 3
    assert nylon["source"].startswith("Philharmonia")
    assert [row["string"] for row in nylon["anchors"]] == \
        ["string6", "string3", "string1"]


def test_declared_single_piano_note_wins_even_over_nearby_tracker_mode(
        tmp_path, monkeypatch):
    monkeypatch.setattr(
        struck_prep_module, "load_mono",
        lambda _path: (np.ones(4_800, dtype=float) * .1, 48_000))
    monkeypatch.setattr(
        struck_prep_module, "segment_notes",
        lambda *_args, **_kwargs: [(0, 4_800)])
    monkeypatch.setattr(
        struck_prep_module, "analyse_note",
        lambda *_args, **_kwargs: SimpleNamespace(f0=1094.219))
    _samples, _rate, f0, evidence = struck_prep_module.select_note(
        tmp_path / "Piano.pp.C6.aiff", 84)
    assert f0 == pytest.approx(1046.502261, rel=1e-6)
    assert evidence == {
        "method": "filename-nominal-anchor",
        "rawDetectedF0": 1094.219,
        "rawDetectedMidi": 85,
    }


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
    assert expected_single_note_f0("vsco2.Player_dyn1_rr1_000.wav") == pytest.approx(27.5)
    assert expected_single_note_f0("vsco2.Player_dyn2_rr1_020.wav") == pytest.approx(277.182631, rel=1e-6)
    assert expected_single_note_f0("vsco2.Player_dyn3_rr1_044.wav") == pytest.approx(4186.009045, rel=1e-6)
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


def test_upright_alias_consumes_piano_construction_and_struck_scoring_policy():
    assert normalize_instrument("piano-upright") == "piano"
    weights = weights_for_instrument("piano-upright")
    assert weights["vibrato"] == 0
    assert weights["onset_noise_db"] == 1
    assert weights["decay_log_ratio"] == 1


def test_upright_measured_profile_retains_five_region_b_curve():
    measured = json.loads(
        (iterate_module.ROOT / "web/static/measured_profiles.json").read_text())
    anchors = measured["piano-upright"]["partialsByRegister"]
    assert len(anchors) == 5
    assert anchors[0]["partialB"] > anchors[2]["partialB"]
    assert anchors[-1]["partialB"] > anchors[2]["partialB"]


def test_profile_rebase_refreshes_structural_anchors_but_keeps_fitted_controls():
    fitted = {"params": {
        "partialTilt": .34,
        "attackNoiseLevel": .7,
        "excitationHuman": .1,
        "_sg2Mode": "ship",
        "_sg2Prior": {"mode": "ship", "resolvedHash": "old"},
        "envelopeAttackByRegister": [{"f0": 120, "attack": .03}],
    }}
    refreshed = {
        "partialTilt": 0,
        "attackNoiseLevel": 1,
        "excitationHuman": 0,
        "_sg2Mode": "fit",
        "_sg2Prior": {"mode": "fit", "resolvedHash": "new"},
        "envelopeAttackByRegister": [{"f0": 82.407, "attack": .028}],
    }
    rebased = rebase_fitted_preset(fitted, refreshed)
    assert rebased["partialTilt"] == .34
    assert rebased["attackNoiseLevel"] == .7
    assert rebased["excitationHuman"] == 0
    assert rebased["_sg2Mode"] == "fit"
    assert rebased["_sg2Prior"] == refreshed["_sg2Prior"]
    assert rebased["envelopeAttackByRegister"] == refreshed["envelopeAttackByRegister"]


def test_struck_campaign_roles_use_the_shared_tripwire_taxonomy():
    assert reference_roles({"roles": list(STRUCK_OBJECTIVE_ROLES)}) == {
        "spectral", "onset",
    }


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


def test_legacy_prior_uses_pinned_tag_craft_and_measured_overlay():
    resolved, prior = resolve_legacy_prior("violin", {
        "sg2Family": "bowed", "spectralProfile": "violin",
        "excitationType": "bow", "excitationHuman": 0,
        "vibratoRate": 6.125, "bodyBands": [{"freq": 280, "gain": .4}],
    })
    assert prior["tag"] == "sg2-legacy"
    assert prior["commit"] == "e8d3ac123c0f1c2647c4dbf03d48934b1966564d"
    assert prior["blobs"]["web/static/synth.js"] == \
        "ea9ed79adbb2412bf2078f1a68af68374f76a017"
    assert prior["source"] == "violin"
    assert resolved["excitationHuman"] == pytest.approx(.4)
    assert resolved["envelopeAttack"] == pytest.approx(.085)
    assert resolved["vibratoRate"] == pytest.approx(6.125)  # measured wins
    assert resolved["bodyBands"] == [{"freq": 280, "gain": .4}]
    assert len(prior["rowHash"]) == len(prior["resolvedParameterHash"]) == 64


def test_nylon_prior_uses_piano_craft_with_separate_fit_and_ship_human():
    topology = {
        "sg2Family": "struck-plucked", "spectralProfile": "guitar",
        "excitationType": "pluck", "resonatorClass": "string",
    }
    fitted, fit_prior = resolve_legacy_prior(
        "guitar-nylon", topology, mode="fit")
    shipped, ship_prior = resolve_legacy_prior(
        "guitar-nylon", topology, mode="ship")
    assert fit_prior["row"] == \
        "guitar-nylon ← legacy piano craft adapted to pluck"
    assert fit_prior["source"] == ship_prior["source"] == "piano"
    assert fitted["excitationType"] == shipped["excitationType"] == "pluck"
    assert fitted["excitationHuman"] == 0
    assert shipped["excitationHuman"] > 0
    assert fit_prior["resolvedHash"] != ship_prior["resolvedHash"]


def test_fit_mode_zeros_human_draws_without_stripping_ship_craft():
    params = {"excitationHuman": .4, "vibratoDepth": 18,
              "vibratoRateSd": .5, "envelopeAttack": .08,
              "attackNoiseLevel": .3}
    fitted = _mode_params(params, "fit")
    shipped = _mode_params(params, "ship")
    assert fitted["excitationHuman"] == 0
    assert fitted["vibratoRateSd"] == 0
    assert fitted["vibratoDepth"] == 18
    assert fitted["attackNoiseLevel"] == .3
    assert shipped["excitationHuman"] == .4
    assert shipped["vibratoRateSd"] == .5


def test_measured_human_ranges_drive_seeded_ship_controls_only():
    params = {
        "excitationHuman": 1.0, "excitationPosition": .13,
        "vibratoRate": 5.9, "bowNoiseLevel": .34,
        "attackNoiseLevel": .3,
        "humanRanges": {"ranges": {
            "excitationPosition": {"status": "measured", "drawHalfRange": .1},
            "vibratoRate": {"status": "measured", "drawHalfRange": .04},
            "bowNoiseLevelDb": {"status": "measured", "drawHalfRange": 3.6},
            "bowScratchLevelDb": {"status": "measured", "centre": -19,
                                  "drawHalfRange": 10},
            "attackNoiseLevel": {"status": "measured", "centre": .027,
                                 "drawHalfRange": .09},
            "onsetWanderCents": {"status": "measured", "centre": 26,
                                 "drawHalfRange": 106},
            "onsetWanderSettleMs": {"status": "measured", "centre": 71,
                                    "drawHalfRange": 107},
        }},
    }
    first = ship_human_overrides(params, midi=55, seed=44)
    assert first == ship_human_overrides(params, midi=55, seed=44)
    assert first != ship_human_overrides(params, midi=55, seed=45)
    assert set(first) == {
        "excitationPosition", "vibratoRate", "bowNoiseLevel",
        "bowScratchLevel", "attackNoiseLevel", "onsetWanderCents",
        "onsetWanderSettlePeriods",
    }
    assert .02 <= first["excitationPosition"] <= .5
    assert 0 <= first["onsetWanderCents"] <= 120
    assert 2 <= first["onsetWanderSettlePeriods"] <= 30
    assert ship_human_overrides({**params, "excitationHuman": 0},
                                midi=55, seed=44) == {}


def test_ship_articulation_latent_anticorrelates_scratch_and_wander():
    params = {
        "excitationHuman": 1.0,
        "humanRanges": {"ranges": {
            "bowScratchLevelDb": {"status": "measured", "centre": -19,
                                  "drawHalfRange": 10},
            "onsetWanderCents": {"status": "measured", "centre": 60,
                                 "drawHalfRange": 40},
        }},
    }
    draws = [ship_human_overrides(params, midi=60, seed=seed)
             for seed in range(24)]
    correlation = np.corrcoef(
        [row["bowScratchLevel"] for row in draws],
        [row["onsetWanderCents"] for row in draws])[0, 1]
    assert correlation < -.95


def test_ship_calibration_scales_only_the_declared_midi_draws():
    params = {
        "excitationHuman": 1.0,
        "humanRanges": {"ranges": {
            "onsetWanderCents": {"status": "measured", "centre": 60,
                                   "drawHalfRange": 40},
        }},
    }
    plain = ship_human_overrides(params, midi=61, seed=9)
    calibrated = ship_human_overrides({
        **params, "shipHumanCalibration": {
            "byMidi": {"61": {"onsetWanderCents": .2}}}},
        midi=61, seed=9)
    assert abs(calibrated["onsetWanderCents"] - 60) == pytest.approx(
        abs(plain["onsetWanderCents"] - 60) * .2)
    assert ship_human_overrides({
        **params, "shipHumanCalibration": {
            "byMidi": {"61": {"onsetWanderCents": .2}}}},
        midi=62, seed=9) == ship_human_overrides(params, midi=62, seed=9)


def test_ship_calibration_nonfinite_midi_scale_is_missing_not_renderer_nan():
    params = {
        "excitationHuman": 1.0, "excitationPosition": .13,
        "humanRanges": {"ranges": {
            "excitationPosition": {
                "status": "measured", "drawHalfRange": .1},
        }},
    }
    plain = ship_human_overrides(params, midi=84, seed=9)
    fitted = ship_human_overrides({
        **params, "shipHumanCalibration": {
            "byMidi": {"84": {"excitationPosition": float("nan")}}}},
        midi=84, seed=9)
    assert fitted == plain
    assert all(np.isfinite(value) for value in fitted.values())


def test_t031_bowed_controls_are_auditable_but_not_identity_fit_dimensions():
    manifest = json.loads((
        iterate_module.ROOT / "scripts/tone_match/manifest.json").read_text())
    params = {"excitationType": "bow", "onsetWanderCents": 80,
              "onsetWanderSettlePeriods": 18, "bowScratchLevel": 1}
    keys = ["onsetWanderCents", "onsetWanderSettlePeriods", "bowScratchLevel"]
    assert _params(manifest, params, keys, mode="fit") == []
    assert {row.key for row in _params(manifest, params, keys, mode="ship")} == {
        "onsetWanderCents", "onsetWanderSettlePeriods", "bowScratchLevel"}
    assert _mode_params(params, "ship")["onsetWanderCents"] == 80


def test_bowed_audit_declares_conditional_settle_and_t054_level_control():
    manifest = json.loads((
        iterate_module.ROOT / "scripts/tone_match/manifest.json").read_text())
    rows = {row["key"]: row for row in manifest["continuous"]}
    assert rows["onsetWanderSettlePeriods"]["auditContext"] == {
        "onsetWanderCents": 80.0}
    assert rows["bowNoiseLevel"]["min"] == 0.0
    assert rows["bowNoiseLevel"]["max"] == 2.0


def test_distributional_variation_gate_is_two_sided(monkeypatch):
    variability = {"status": "measured", "groups": [{
        "group": "same-note", "referenceIndices": [0],
        "floorFeatures": {"vibrato": 2.0},
    }]}

    def compare(left, right, _weights):
        return {"features": {"vibrato": abs(left - right)}}

    monkeypatch.setattr(iterate_module, "compare_features", compare)
    passed = _distributional_variation_gate(
        variability, {0: [0.0, 2.0, 4.0]}, {"vibrato": 1})
    assert passed["passed"]
    sterile = _distributional_variation_gate(
        variability, {0: [0.0, 0.0, 0.0]}, {"vibrato": 1})
    assert not sterile["passed"]
    assert sterile["groups"][0]["checks"][0]["status"] == "too-little"
    sloppy = _distributional_variation_gate(
        variability, {0: [0.0, 10.0, 20.0]}, {"vibrato": 1})
    assert not sloppy["passed"]
    assert sloppy["groups"][0]["checks"][0]["status"] == "too-much"


def test_distributional_gate_excludes_floor_groups_without_qualified_pair(monkeypatch):
    variability = {"status": "measured", "groups": [
        {"group": "qualified", "referenceIndices": [0],
         "floorFeatures": {"vibrato": 2.0}},
        {"group": "unmatched", "referenceIndices": [1],
         "floorFeatures": {"vibrato": 200.0}},
    ]}
    monkeypatch.setattr(iterate_module, "compare_features",
                        lambda left, right, _weights: {
                            "features": {"vibrato": abs(left - right)}})
    gate = _distributional_variation_gate(
        variability, {0: [0.0, 2.0, 4.0], 1: [0.0, 2.0, 4.0]},
        {"vibrato": 1}, eligible_groups={"qualified"})
    assert gate["passed"]
    assert gate["groups"][1]["status"] == "not-qualified-pair"


def test_distributional_gate_keeps_unreachable_observable_as_named_watch(monkeypatch):
    variability = {"status": "measured", "groups": [{
        "group": "qualified", "referenceIndices": [0],
        "floorFeatures": {"vibrato": 2.0, "onset_noise_db": 10.0},
    }]}
    monkeypatch.setattr(iterate_module, "compare_features",
                        lambda left, right, _weights: {"features": {
                            "vibrato": abs(left - right),
                            "onset_noise_db": 0.0}})
    gate = _distributional_variation_gate(
        variability, {0: [0.0, 2.0, 4.0]}, {"vibrato": 1},
        watch_features={"onset_noise_db": "audited actuator span"})
    assert gate["passed"]
    watched = next(row for row in gate["groups"][0]["checks"]
                   if row["feature"] == "onset_noise_db")
    assert watched["status"] == "watch-unreachable"
    assert watched["watchReason"] == "audited actuator span"


def test_ship_variants_record_one_failed_note_without_aborting(tmp_path, monkeypatch):
    monkeypatch.setattr(iterate_module.subprocess, "run", lambda *_args, **_kwargs:
                        SimpleNamespace(returncode=0, stdout="", stderr=""))
    monkeypatch.setattr(iterate_module, "extract_features", lambda path, **_kwargs:
                        (_ for _ in ()).throw(ValueError("unpitched"))
                        if "note-1.wav" in str(path) else str(path))
    monkeypatch.setattr(iterate_module, "_distributional_variation_gate",
                        lambda *_args, **_kwargs: {"passed": False,
                                                   "status": "insufficient-evidence"})
    result = _render_ship_variants(
        tmp_path, "candidate", "violin", {"excitationType": "bow"},
        [{"midi": 60}, {"midi": 72}], {}, {}, 2, repo_root=tmp_path)
    assert len(result["analysisFailures"]) == 2
    assert {row["referenceIndex"] for row in result["analysisFailures"]} == {1}
    assert result["primaryRenderDirectory"].endswith("variant-00")


def test_native_human_episode_retires_the_second_python_draw(tmp_path):
    profile_dir = tmp_path / "web" / "static"
    profile_dir.mkdir(parents=True)
    (profile_dir / "measured_profiles.json").write_text(json.dumps({
        "violin": {"humanRanges": {"ranges": {
            "excitationPosition": {"status": "measured"},
        }}},
    }))
    assert _native_human_episode_profile(
        {"spectralProfile": "violin"}, tmp_path)
    assert not _native_human_episode_profile(
        {"spectralProfile": "cello"}, tmp_path)


def test_ship_variants_resume_saved_seeds_and_skip_completed_wavs(tmp_path, monkeypatch):
    calls = []

    def render(_command, **_kwargs):
        calls.append(_command)
        jobs = json.loads(Path(_command[-1]).read_text())
        for job in jobs:
            output = Path(job["out"])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"RIFF" + b"\0" * 64)
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(iterate_module.subprocess, "run", render)
    monkeypatch.setattr(iterate_module, "extract_features",
                        lambda path, **_kwargs: str(path))
    monkeypatch.setattr(iterate_module, "_distributional_variation_gate",
                        lambda *_args, **_kwargs: {"passed": False,
                                                   "status": "fail"})
    args = (tmp_path, "candidate", "flute", {"excitationType": "blow"},
            [{"midi": 60}, {"midi": 72}], {}, {}, 2)
    first = _render_ship_variants(*args, repo_root=tmp_path)
    saved_jobs = json.loads(
        (tmp_path / "ship-mode" / "candidate" / "jobs.json").read_text())
    second = _render_ship_variants(*args, repo_root=tmp_path)
    assert len(calls) == 1
    assert first["seeds"] == second["seeds"]
    assert first["seeds"] == [saved_jobs[0]["seed"], saved_jobs[2]["seed"]]


def test_legacy_baseline_is_mandatory_leaderboard_entry_one(tmp_path, monkeypatch):
    monkeypatch.setattr(iterate_module, "DEFAULT_RUN_ROOT", tmp_path / "runs")
    monkeypatch.setattr(iterate_module, "STATE_ROOT", tmp_path / "state")
    best = {"loss": 2.0, "params": {"excitationHuman": .4},
            "construction": {"passed": False, "counts": {"fail": 1}},
            "tripwires": {"strictPassed": False, "cells": [],
                          "strictMissingCells": []}, "gateFailures": 1}
    prior = {"instrument": "violin", "source": "violin",
             "rowHash": "a", "resolvedParameterHash": "b"}
    entry = _ensure_legacy_baseline(
        "violin", tmp_path / "pass-1", best, "objective", prior,
        {"passed": False, "status": "fail"})
    board = json.loads((tmp_path / "runs" / "violin" / "leaderboard.json").read_text())
    assert entry["kind"] == "legacy-baseline"
    assert board["runs"][0]["entryNumber"] == 1
    assert board["legacyBaselineByReferenceSet"]["objective"]["prior"] == prior
    assert (tmp_path / "state" / "violin" / "leaderboard.json").exists()


def test_sung_section_aliases_and_derived_rows_follow_decision_12():
    assert SUNG_SECTION_TYPES == {"soprano", "mezzo-soprano", "tenor", "bass"}
    assert normalize_instrument("voice-soprano") == "soprano"
    assert normalize_instrument("voice-bass") == "bass"
    assert normalize_instrument("contrabass") == "basso-profondo"
    assert SUNG_DERIVED_PRESETS["basso-profondo"] == "bass"
    derived = evaluate_construction("contrabass", [], params={
        "excitationType": "blow", "derivedFrom": "voice-bass-fitted",
        "bassoMorphology": {"transform": {"formantScale": .94}},
    }, strict_evidence=False)
    assert derived["instrument"] == "basso-profondo"
    assert derived["targetClass"] == "derived-preset"
    ids = {row["id"] for row in derived["assertions"]}
    assert "basso-profondo.derived-parent" in ids
    assert "basso-profondo.glottal-law" not in ids


def test_sung_family_firewall_rejects_non_sung_objective_and_seed_sources():
    for source in ("violin", "cello", "trumpet"):
        with pytest.raises(ValueError, match="family firewall"):
            assert_sung_family_firewall("tenor", {
                "sg2Family": "sung", "spectralProfile": "voice-tenor",
                "candidateTable": {"instrument": source},
            })
    with pytest.raises(ValueError, match="objective row"):
        assert_sung_family_firewall(
            "tenor", {"sg2Family": "sung", "spectralProfile": "voice-tenor"},
            references=[{"singer": "male2", "family": "bowed"}],
        )


def test_sung_family_firewall_accepts_vocal_legacy_and_same_singer_prior():
    report = assert_sung_family_firewall(
        "tenor", {
            "sg2Family": "sung", "spectralProfile": "voice-tenor",
            "primarySinger": "male2",
            "fittedFrom": {"family": "sung", "singer": "male2"},
        },
        references=[{"singer": "male2", "voiceClass": "tenor"}],
        prior={"source": "vocal", "family": "sung"},
    )
    assert report["passed"] and report["singers"] == ["male2"]
    with pytest.raises(ValueError, match="does not match objective singer"):
        assert_sung_family_firewall(
            "tenor", {"sg2Family": "sung", "spectralProfile": "voice-tenor",
                      "primarySinger": "male3"},
            references=[{"singer": "male2", "voiceClass": "tenor"}],
        )


def test_sung_family_firewall_derived_classes_need_frozen_sung_parent_and_transform():
    assert assert_sung_family_firewall("boy soprano", {
        "sg2Family": "sung", "spectralProfile": "voice-soprano",
        "derivedFrom": "frozen-sung-voice-soprano",
        "boyMorphology": {"tractScale": .84},
    })["passed"]
    assert assert_sung_family_firewall("basso profondo", {
        "sg2Family": "sung", "spectralProfile": "voice-bass",
        "derivedFrom": "frozen-sung-voice-bass",
        "bassoMorphology": {"tractScale": 1.08},
    })["passed"]
    with pytest.raises(ValueError, match="frozen sung soprano"):
        assert_sung_family_firewall("boy soprano", {
            "sg2Family": "sung", "spectralProfile": "voice-soprano",
            "derivedFrom": "violin", "boyMorphology": {"tractScale": .84},
        })


def test_l9_articulation_velocity_slope_is_in_canonical_manifest():
    manifest = json.loads((iterate_module.ROOT / "scripts" / "tone_match" /
                           "manifest.json").read_text())
    row = next(row for row in manifest["continuous"]
               if row["key"] == "articulationVelocitySlope")
    assert (row["min"], row["max"], row["default"], row["appliesTo"]) == (
        -1.5, 1.5, 0.0, ["blow"])


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


def test_l18_struck_construction_fails_any_ship_hold_plateau():
    samples = []
    for register in ("low", "mid", "high"):
        for velocity in (.25, .9):
            bundle = _bundle(percussive=True)
            bundle.hold_decay_db_per_s = -2.0
            bundle.hold_plateau_fraction = .1
            samples.append(ConstructionSample(
                bundle, bundle, register, velocity, velocity))
    params = {
        "excitationType": "strike", "resonatorClass": "string",
        "velocityHardnessCoupling": .5,
        "decaySecondStage": .8, "decaySecondRatio": 4,
    }
    passed = evaluate_construction("piano", samples, params=params)
    by_id = {row["id"]: row for row in passed["assertions"]}
    assert by_id["piano.free-decay-no-plateau"]["status"] == "pass"
    samples[-1].render.hold_decay_db_per_s = 0.0
    samples[-1].render.hold_plateau_fraction = 1.0
    failed = evaluate_construction("piano", samples, params=params)
    by_id = {row["id"]: row for row in failed["assertions"]}
    assert by_id["piano.free-decay-no-plateau"]["status"] == "fail"


def test_l17_pinned_pre_onset_component_must_be_active_with_own_envelope():
    samples = []
    for register in ("low", "mid", "high"):
        for velocity in (.25, .9):
            bundle = _bundle(percussive=True)
            bundle.hold_decay_db_per_s = -2.0
            bundle.hold_plateau_fraction = .1
            bundle.noise_lead_ms = 18.0
            samples.append(ConstructionSample(
                bundle, bundle, register, velocity, velocity))
    component = {
        "component": "pianoActionNoise", "profilePinned": True, "level": 1,
        "envelope": {"independentOfHarmonicEnvelope": True,
                     "points": [{"timeMs": -20, "gainDb": -12},
                                {"timeMs": -5, "gainDb": 0},
                                {"timeMs": 30, "gainDb": -20}]},
    }
    base = {"excitationType": "strike", "resonatorClass": "string",
            "velocityHardnessCoupling": .5,
            "decaySecondStage": .8, "decaySecondRatio": 4,
            "preOnsetComponents": [component]}
    result = evaluate_construction("piano", samples, params=base)
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["piano.pre-onset-component-active"]["status"] == "pass"
    result = evaluate_construction("piano", samples, params={
        **base, "preOnsetComponents": [{**component, "level": 0}]})
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["piano.pre-onset-component-active"]["status"] == "fail"
    result = evaluate_construction("piano", samples, params={
        **base, "preOnsetComponents": [{**component, "envelope": {
            "independentOfHarmonicEnvelope": True,
            "points": [{"timeMs": -20, "gainDb": 0},
                       {"timeMs": -5, "gainDb": 0},
                       {"timeMs": 30, "gainDb": 0}],
        }}]})
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["piano.pre-onset-component-active"]["status"] == "fail"


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


@pytest.mark.parametrize("instrument", ["clarinet", "french-horn"])
def test_f5_breath_laws_scope_close_requested_blown_families(instrument):
    samples = [ConstructionSample(_bundle(), _bundle(), register, dynamic, dynamic)
               for register in ("low", "mid", "high") for dynamic in (.25, .9)]
    base = {
        "excitationType": "blow", "resonatorClass": "conicalTube", "dynamicBlare": .2,
        "breathVelocityExponent": 1, "breathTurbulence": 0, "breathBodyAmount": 0,
    }
    owner_ids = {f"{instrument}.soft-breath-law", f"{instrument}.turbulence-law",
                 f"{instrument}.body-coloured-air"}
    failed = evaluate_construction(instrument, samples, params=base)
    failed_ids = {row["id"] for row in failed["assertions"] if row["status"] == "fail"}
    assert owner_ids <= failed_ids
    fitted = evaluate_construction(instrument, samples, params={
        **base, "breathVelocityExponent": .5, "breathTurbulence": .2,
        "breathBodyAmount": .4,
    })
    by_id = {row["id"]: row["status"] for row in fitted["assertions"]}
    assert all(by_id[key] == "pass" for key in owner_ids)


@pytest.mark.parametrize("instrument", ["trumpet", "french-horn"])
def test_f5_onset_spectrum_scope_closes_requested_blown_families(instrument):
    samples = [ConstructionSample(_bundle(), _bundle(), register, dynamic, dynamic)
               for register in ("low", "mid", "high") for dynamic in (.25, .9)]
    base = {
        "excitationType": "blow", "resonatorClass": "conicalTube", "dynamicBlare": .2,
        "onsetSpectrumTilt": 0, "onsetSpectrumDecay": .06,
    }
    assertion_id = f"{instrument}.onset-spectrum-law"
    failed = evaluate_construction(instrument, samples, params=base)
    by_id = {row["id"]: row["status"] for row in failed["assertions"]}
    assert by_id[assertion_id] == "fail"
    fitted = evaluate_construction(instrument, samples, params={
        **base, "onsetSpectrumTilt": .2,
    })
    by_id = {row["id"]: row["status"] for row in fitted["assertions"]}
    assert by_id[assertion_id] == "pass"


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

    quiet_render = {
        "scores": [{"composite": 0.0}, {"composite": 0.0}, {"composite": 99.0}],
        "construction": {"passed": True},
        "tripwires": {"strictPassed": True},
    }
    evidence = _floor_evidence(variability, quiet_render)
    assert evidence["status"] == "demonstrated"
    assert evidence["groups"][0]["atOrBelowFloor"]
    quiet_render["tripwires"]["strictPassed"] = False
    assert _floor_evidence(variability, quiet_render)["status"] == "above-floor"
    bad_render = {
        "scores": [{"composite": 99.0}, {"composite": 99.0}, {"composite": 0.0}],
        "construction": {"passed": True},
        "tripwires": {"strictPassed": True},
    }
    assert _floor_evidence(variability, bad_render)["status"] == "above-floor"


def test_controllability_contract_rejects_objective_or_manifest_drift(tmp_path):
    instrument = "violin"
    references = [{"path": "ref.wav", "midi": 69, "dynamic": "mf"}]
    weights = weights_for_instrument(instrument)
    free = [FreeParam("partialTilt", -1.0, 1.0, 0.0)]
    contract = _free_manifest_contract(free)
    responders = {feature: (["partialTilt"] if weight > 0 else [])
                  for feature, weight in weights.items()}
    audit = {
        "schemaVersion": 3,
        "instrument": instrument,
        "objectiveHash": objective_contract_hash(instrument, references, weights),
        "manifestHash": manifest_contract_hash(contract),
        "referenceContractHash": canonical_hash(references),
        "parameterManifestHash": canonical_hash(contract),
        "initialPresetHash": canonical_hash({"partialTilt": 0}),
        "scorerContractVersion": SCORER_CONTRACT_VERSION,
        "rendererContractHash": _renderer_contract_hash(),
        "startingWeights": weights,
        "finalWeights": weights,
        "responsiveParameters": responders,
        "repeatability": {"status": "stable", "unstableFeatures": []},
        "uncontrolledWeightedFeatures": [],
        "clean": True,
        "verdicts": [],
    }
    path = tmp_path / "controllability.json"
    path.write_text(json.dumps(audit))
    assert _consume_controllability_audit(
        path, instrument, references, free, weights,
        initial={"partialTilt": 0})["clean"]
    with pytest.raises(ValueError, match="objective hash mismatch"):
        _consume_controllability_audit(
            path, instrument, references + [{"path": "other.wav"}], free, weights)
    with pytest.raises(ValueError, match="manifest hash mismatch"):
        _consume_controllability_audit(
            path, instrument, references,
            [FreeParam("partialTransfer", 0.0, 1.0, 0.15)], weights)
    path.write_text(json.dumps({**audit, "schemaVersion": 1}))
    with pytest.raises(ValueError, match="repeat-render stability"):
        _consume_controllability_audit(
            path, instrument, references, free, weights)
    unstable = {
        **audit,
        "repeatability": {
            "status": "watch-metrics-zeroed",
            "unstableFeatures": ["partials_db"],
        },
    }
    path.write_text(json.dumps(unstable))
    with pytest.raises(ValueError, match="repeat-unstable"):
        _consume_controllability_audit(
            path, instrument, references, free, weights)


def test_leaderboard_ignores_subthreshold_score_jitter(tmp_path, monkeypatch):
    import scripts.tone_match.iterate as iterate
    monkeypatch.setattr(iterate, "DEFAULT_RUN_ROOT", tmp_path)
    construction = {"passed": False, "counts": {"fail": 2}}
    tripwires = {"strictPassed": False, "cells": [], "strictMissingCells": []}
    first = {"loss": 4.0, "params": {}, "construction": construction,
             "tripwires": tripwires, "gateFailures": 2}
    improved, _ = _update_leaderboard(
        "violin", tmp_path / "run-a", first, "objective")
    assert improved
    jitter = {**first, "loss": 3.998}
    improved, previous = _update_leaderboard(
        "violin", tmp_path / "run-b", jitter, "objective")
    assert not improved and previous == 4.0
    real = {**first, "loss": 3.99}
    improved, _ = _update_leaderboard(
        "violin", tmp_path / "run-c", real, "objective")
    assert improved


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
    assert string["body_am_db"] == 1
    assert string["onset_wander_cents"] == 0
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


def test_profile_regeneration_preserves_independent_human_and_noise_contracts():
    refreshed = {"violin": {"partials": [1], "resonances": [{"freq": 300}]}}
    prior = {"violin": {
        "partials": [.5],
        "humanRanges": {"ranges": {"excitationPosition": {"status": "measured"}}},
        "bowNoise": {"profilePinned": True, "profile": [{"freq": 1000}]},
    }}
    merged = merge_profile_sets(refreshed, prior)
    assert merged["violin"]["partials"] == [1]
    assert merged["violin"]["humanRanges"] == prior["violin"]["humanRanges"]
    assert merged["violin"]["bowNoise"] == prior["violin"]["bowNoise"]


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


def test_t033_bowed_tables_consume_only_explicit_string_labels():
    assert bowed_string_from_filename("Violin.arco.pp.sulG.G3B3.aiff") == "sulG"
    assert bowed_string_from_filename("Cello.arco.ff.sulC.C2A2.aiff") == "sulC"
    assert bowed_string_from_filename("phil.violin_C5_1_normal.mp3") is None
    notes = []
    for label, second_partial in (("sulA", .15), ("sulE", .85)):
        for dynamic in ("pp", "ff"):
            note = _bundle(
                f0=1046.5,
                partials=[1, second_partial, .05, .02, .01, .005, .002, .001],
            ).note
            note.file = f"Violin.arco.{dynamic}.{label}.C6.aiff"
            notes.append(note)
    fitted = aggregate_instrument(
        notes, [], 8,
        string_selector=lambda note: bowed_string_from_filename(note.file))
    strings = fitted["partialsByString"]
    assert set(strings) == {"sulA", "sulE"}
    assert strings["sulA"][0]["partials"][1]["amp"] == pytest.approx(.15)
    assert strings["sulE"][0]["partials"][1]["amp"] == pytest.approx(.85)


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


def test_body_fit_recovers_corpus_supported_violin_a0_b1_centres():
    rng = np.random.default_rng(17)
    notes = []
    for index in range(36):
        f0 = 195 * 2 ** ((index % 13) / 12)
        freqs = f0 * np.arange(1, 25)
        source = np.arange(1, 25, dtype=float) ** -1.1
        a0 = .55 * np.exp(-.5 * (np.log2(freqs / 280) / .16) ** 2)
        b1 = .75 * np.exp(-.5 * (np.log2(freqs / 500) / .18) ** 2)
        amps = source * 2 ** (a0 + b1) * np.exp(rng.normal(0, .025, 24))
        amps /= amps.max()
        notes.append(NoteAnalysis(
            f"body-{index:03d}", f0, "test", 1, amps, freqs,
            np.ones(24, dtype=bool)))
    bands, _, fit_info = fit_fixed_body(
        notes, 24, diagnostic_centres_hz=(280.0, 500.0))
    assert any(250 <= band["freq"] <= 310 and band["gain"] > .1
               for band in bands)
    assert any(420 <= band["freq"] <= 600 and band["gain"] > .1
               for band in bands)
    assert fit_info["splitHalfCorr"] >= .8


def test_violin_body_mode_gate_rejects_missing_or_unstable_modes():
    good = [
        {"freq": 280, "gain": .2, "width": .18},
        {"freq": 500, "gain": .3, "width": .18},
    ]
    evidence = validate_bowed_body_modes(
        "violin", good, {"splitHalfCorr": .9})
    assert evidence["bands"]["A0"]["freq"] == 280
    with pytest.raises(ValueError, match="coverage gap.*B1"):
        validate_bowed_body_modes(
            "violin", good[:1], {"splitHalfCorr": .9})
    with pytest.raises(ValueError, match="splitHalfCorr"):
        validate_bowed_body_modes(
            "violin", good, {"splitHalfCorr": .5})


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
    assert 10 < lockin_periods < 18              # organisation follows scratch


def test_lockin_measures_harmonic_organisation_not_slow_amplitude_bloom():
    sr = 44_100
    t = np.arange(int(1.2 * sr)) / sr
    # A stable harmonic tone is organised from its first audible frame even
    # though its amplitude takes a full second to bloom.
    ramp = np.clip(t / 1.0, 0, 1)
    samples = ramp * (
        np.sin(2 * np.pi * 440 * t) +
        .25 * np.sin(2 * np.pi * 880 * t))
    from scipy import signal as _sig
    _, times, spectrum = _sig.stft(
        samples, fs=sr, nperseg=2048, noverlap=1536,
        boundary=None, padded=False)
    power = np.abs(spectrum) ** 2
    freqs = np.fft.rfftfreq(2048, 1 / sr)
    (*_noise_stats, lockin_periods) = _noise_and_onset_observables(
        power, freqs, times, 440.0)
    assert lockin_periods is not None
    assert lockin_periods <= 5


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
    # T-005 is active for the rebuilt blown objective; the rebaseline gives
    # it a fresh reference-set id rather than comparing unlike leaderboards.
    assert blown["band_balance_db"] == 1.0
    for key in _BOWED_P1_FEATURES:
        assert blown[key] == 0.0
        if key in _BOWED_WATCH_METRICS:
            # §2.3 controllability audit: no generating engine param yet —
            # measured and reported, but weighted zero until the filed
            # engine specs (N1/N4) land and the audit is re-run
            assert bowed[key] == 0.0
        else:
            assert bowed[key] == 1.0
    assert bowed["decay_log_ratio"] == 0.0
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


def test_reference_roles_define_bar_specific_coverage_without_floor_leakage():
    references = [
        {"register": "low", "dynamic": "pp",
         "roles": ["spectral", "onset"]},
        {"register": "mid", "dynamic": "mf", "roles": ["vibrato"]},
        {"register": "high", "dynamic": "ff", "roles": ["floor"]},
    ]
    contract = required_cells_by_bar(
        references,
        ["partial-table", "attack-t90", "vibrato", "band-balance"])
    assert contract == {
        "attack-t90": [("low", "pp")],
        "band-balance": [("low", "pp")],
        "partial-table": [("low", "pp")],
        "vibrato": [("mid", "mf")],
    }
    assert reference_roles({"roles": "floor"}) == {"floor"}
    assert reference_roles({}) == {"spectral", "onset", "vibrato"}
    with pytest.raises(ValueError, match="unknown reference roles"):
        reference_roles({"roles": ["mystery"]})


def test_reference_render_override_declares_vibrato_role_without_role_leakage():
    assert _reference_render_params_override({"roles": ["vibrato"]}) == {
        "performanceRole": "vibrato",
    }
    assert _reference_render_params_override({"roles": ["spectral", "onset"]}) == {
        "performanceRole": "non-vibrato",
    }
    assert _reference_render_params_override({"roles": ["floor"]}) == {
        "performanceRole": "non-vibrato",
    }
    assert _reference_render_params_override({
        "roles": ["spectral"], "string": "sulD",
    }) == {"performanceRole": "non-vibrato", "stringSelect": "sulD"}
    assert "stringSelect" not in _reference_render_params_override({
        "roles": ["humanisation"], "string": "unlabelled",
    })
    # Legacy references without explicit roles retain their existing all-role
    # interpretation and therefore still exercise the vibrato scorer.
    assert _reference_render_params_override({}) == {"performanceRole": "vibrato"}


def test_bowed_construction_uses_spectral_and_vibrato_roles_separately():
    spectral = _bundle()
    spectral.ltas_rolloff_db_oct = -15.0
    vibrato = _bundle()
    vibrato.ltas_rolloff_db_oct = 0.0
    vibrato.note.vibrato = {
        "present": True, "depth": 30.0, "bodyAmDepthDb": 4.0,
    }
    samples = [
        ConstructionSample(
            spectral, spectral, register, dynamic, dynamic,
            frozenset({"spectral", "onset"}))
        for register in ("low", "mid", "high")
        for dynamic in (0.2, 0.9)
    ]
    samples.append(ConstructionSample(
        vibrato, vibrato, "mid", 0.62, 0.62, frozenset({"vibrato"})))
    result = evaluate_construction("violin", samples, params={
        "excitationType": "bow", "resonatorClass": "string",
        "bodyBands": [
            {"freq": 275, "gain": .5, "width": .2},
            {"freq": 500, "gain": .6, "width": .2},
            {"freq": 2300, "gain": 1.0, "width": .3},
        ],
    })
    by_id = {row["id"]: row for row in result["assertions"]}
    assert by_id["violin.radiated-rolloff"]["status"] == "pass"
    assert by_id["violin.radiated-rolloff"]["observed"] == -15.0
    assert by_id["violin.vibrato-body-am"]["status"] == "pass"
    assert by_id["violin.vibrato-body-am"]["observed"] == 4.0


def test_floor_and_vibrato_roles_do_not_create_unrelated_tripwire_cells():
    ref = _bundle(partials=[1] * 40, B=0.0)
    render = _bundle(partials=[1] * 40, B=0.0004)
    result = compare_features(
        ref, render, weights_for_instrument("violin"))
    gate = evaluate_tripwires("violin", [
        {"register": "mid", "dynamic": "mp", "roles": ["floor"],
         "result": result, "ref": ref, "render": render},
        {"register": "high", "dynamic": "mf", "roles": ["vibrato"],
         "result": result, "ref": ref, "render": render},
    ])
    floor_rows = [
        row for row in gate["bars"]
        if row["register"] == "mid" and row["dynamic"] == "mp"
    ]
    assert floor_rows and {row["status"] for row in floor_rows} == {
        "not-applicable"}
    vibrato_rows = [
        row for row in gate["bars"]
        if row["register"] == "high" and row["dynamic"] == "mf"
    ]
    assert next(
        row for row in vibrato_rows if row["bar"] == "partial-table"
    )["status"] == "not-applicable"
    contract = {
        "vibrato": [("high", "mf")],
    }
    aggregate = aggregate_by_cell(
        gate, required_cells_by_bar=contract, family="bowed")
    assert not any(
        row["bar"] == "band-balance"
        for row in aggregate["strictMissingCells"])


def test_violin_vibrato_role_inventory_covers_three_registers_and_two_dynamics():
    rows = VIBRATO_ROLE_FILES["violin"]
    assert {(row["register"], row["dynamic"]) for row in rows} == {
        (register, dynamic)
        for register in ("low", "mid", "high")
        for dynamic in ("mf", "f")
    }
    assert all(parse_phil_name(row["file"]) for row in rows)


def test_violin_onset_role_inventory_covers_three_registers_and_two_dynamics():
    rows = ONSET_ROLE_MIDIS["violin"]
    assert {
        (register, dynamic)
        for register, by_dynamic in rows.items()
        for dynamic in by_dynamic
    } == {
        (register, dynamic)
        for register in ("low", "mid", "high")
        for dynamic in ("pp", "ff")
    }
    assert rows["low"] == {"pp": 55, "ff": 55}
    assert rows["mid"] == {"pp": 79, "ff": 79}
    assert rows["high"] == {"pp": 88, "ff": 88}


def test_zero_weighted_tripwire_feature_is_watch_only():
    ref = _bundle(partials=[1] * 40, B=0.0)
    render = _bundle(partials=[1] * 40, B=0.0004)
    weights = weights_for_instrument("violin")
    weights["inharmonicity_log_ratio"] = 0.0
    result = compare_features(ref, render, weights)
    gate = evaluate_tripwires("violin", [{
        "register": "mid", "dynamic": "mf", "result": result,
        "ref": ref, "render": render,
    }], weights=weights)
    inharmonicity = next(
        row for row in gate["bars"] if row["bar"] == "inharmonicity")
    assert inharmonicity["status"] == "not-applicable"
    assert "inharmonicity" not in gate["activeBars"]
    aggregate = aggregate_by_cell(
        gate, required_cells=[("mid", "mf")],
        required_bars=gate["activeBars"], family="bowed")
    assert not any(
        row["bar"] == "inharmonicity"
        for row in aggregate["strictMissingCells"])


def test_near_zero_inharmonicity_uses_stretch_cents_instead_of_b_ratio():
    ref = _bundle(partials=[1] * 40, B=0.0)
    tiny = _bundle(partials=[1] * 40, B=1e-8)
    stretched = _bundle(partials=[1] * 40, B=0.0004)
    near_zero = inharmonicity_comparison(ref.note, tiny.note)
    assert near_zero["kind"] == "cents"
    assert near_zero["passed"]
    assert near_zero["errorCents"] < 3
    too_stretched = inharmonicity_comparison(ref.note, stretched.note)
    assert not too_stretched["passed"]
    assert too_stretched["errorCents"] > 3

    nonzero_ref = _bundle(partials=[1] * 40, B=0.0002)
    nonzero_render = _bundle(partials=[1] * 40, B=0.00025)
    ordinary = inharmonicity_comparison(
        nonzero_ref.note, nonzero_render.note)
    assert ordinary["kind"] == "factor"
    assert ordinary["factor"] == pytest.approx(1.25)
    assert ordinary["passed"]

    ref.note.partial_snr_ok[30:] = False
    stretched.note.partial_snr_ok[30:] = False
    ref.note.partial_snr_ok[29] = False
    stretched.note.partial_snr_ok[28] = False
    common_mode = inharmonicity_comparison(ref.note, stretched.note)
    assert common_mode["mode"] == 28


def test_tone_matcher_reuses_exact_duplicate_candidate_objective(tmp_path):
    matcher = ToneMatcher(
        "violin", {"partialTilt": 0.0}, [],
        [FreeParam("partialTilt", -1, 1, 0)], tmp_path,
        weights={"partials_db": 1.0})
    fingerprint = _candidate_fingerprint(
        matcher.free, {"partialTilt": 0.0})
    matcher._objective_cache[fingerprint] = (12.5, 2.5)
    assert matcher.evaluate(np.asarray([0.0])) == 12.5
    assert matcher.evaluations == []
    assert not (tmp_path / "renders").exists()


def test_tone_matcher_penalizes_unanalysable_candidate_without_aborting(
        tmp_path, monkeypatch):
    matcher = ToneMatcher(
        "violin",
        {"partialTilt": 0.0, "sg2Family": "bowed"},
        [
            {"path": "reference-0.wav", "midi": 55, "velocity": .2,
             "register": "low", "dynamic": "pp",
             "roles": ["spectral", "onset"]},
            {"path": "reference-1.wav", "midi": 72, "velocity": .9,
             "register": "mid", "dynamic": "ff",
             "roles": ["spectral", "onset"]},
        ],
        [FreeParam("partialTilt", -1, 1, 0)], tmp_path)
    monkeypatch.setattr(
        iterate_module.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout="", stderr=""))

    def features(path, **_kwargs):
        name = str(path)
        if name.endswith("note-0.wav"):
            raise ValueError("no stable pitched note detected")
        return _bundle()

    monkeypatch.setattr(iterate_module, "extract_features", features)
    objective = matcher.evaluate(np.asarray([0.0]))
    record = matcher.evaluations[0]
    jobs = json.loads((tmp_path / "renders" / "eval-0000" / "jobs.json").read_text())
    assert [job["paramsOverride"] for job in jobs] == [
        {"performanceRole": "non-vibrato"},
        {"performanceRole": "non-vibrato"},
    ]
    assert np.isfinite(objective)
    assert len(record["analysisFailures"]) == 1
    assert record["scores"][0]["composite"] == 100.0
    assert record["gateFailures"] >= 1


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


def test_iowa_run_span_routes_reacquired_chromatic_files_by_declared_pitch():
    assert iowa_filename_span(Path("Violin.arco.ff.sulG.G3B3.aiff")) == (55, 59)
    assert iowa_filename_span(Path("Violin.arco.pp.sulA.Bb5Ab6.aiff")) == (82, 92)
    assert iowa_filename_span(Path("not-a-declared-run.aiff")) is None


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


def test_catalogue_duplicate_finder_accepts_provenance_prefixed_samples(tmp_path):
    names = ("phil.cello_G3_05_pianissimo_arco-normal.mp3",
             "phil.cello_G3_1_pianissimo_arco-normal.mp3",
             "phil.cello_G3_15_pianissimo_arco-normal.mp3")
    for name in names:
        (tmp_path / name).write_bytes(b"")
    groups = find_catalogue_duplicates(tmp_path, "cello")
    assert len(groups) == 1
    assert groups[0]["midi"] == 55
    assert groups[0]["files"] == list(names)


def test_string_campaigns_cover_three_registers_and_two_dynamics():
    for instrument, anchors in STRING_CAMPAIGNS.items():
        assert {a["register"] for a in anchors} == {"low", "mid", "high"}
        for anchor in anchors:
            assert anchor["string"].startswith("sul")
            assert "pp" in anchor and "ff" in anchor


def test_violin_body_reference_runs_tile_low_signature_region():
    runs = BODY_REFERENCE_RUNS["violin"]
    assert {row["string"] for row in runs} == {"sulG", "sulD", "sulA"}
    fundamentals = [440 * 2 ** ((midi - 69) / 12)
                    for row in runs for midi in row["midis"]]
    partials = sorted(freq * rank for freq in fundamentals
                      for rank in range(1, 5)
                      if 250 <= freq * rank <= 600)
    assert partials[0] <= 295
    assert partials[-1] >= 585
    assert max(np.diff(partials)) < 50


def test_cello_body_reference_runs_tile_low_a0_region():
    runs = BODY_REFERENCE_RUNS["cello"]
    assert {row["string"] for row in runs} == {"sulC", "sulG"}
    fundamentals = [440 * 2 ** ((midi - 69) / 12)
                    for row in runs for midi in row["midis"]]
    partials = sorted(freq * rank for freq in fundamentals
                      for rank in range(1, 5)
                      if 80 <= freq * rank <= 300)
    assert partials[0] <= 83
    assert partials[-1] >= 293
    assert max(np.diff(partials)) < 17


def test_bowed_seed_pins_measured_body_and_unity_reconstruction():
    seed = bowed_seed("violin", {
        "material": {"suggestedMaterial": .08},
        "performance": {
            "vibratoProb": .88, "vibratoDepth": 30.3, "vibratoRate": 5.91,
        },
        "resonances": [
            {"freq": 280, "gain": .2, "width": .18},
            {"freq": 500, "gain": .3, "width": .18},
            {"freq": 2300, "gain": .9, "width": .18},
        ],
        "resonancesFit": {
            "reconstructionAmount": 1,
            "splitHalfCorr": .9,
            "peakHzA": 2300,
            "peakHzB": 2300,
        },
    })
    assert len(seed["bodyBands"]) == 3
    assert seed["spectralResonanceAmount"] == 1
    assert seed["bodyStability"]["splitHalfCorr"] == .9


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
