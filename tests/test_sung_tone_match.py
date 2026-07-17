from __future__ import annotations

import json
import numpy as np
import pytest

from scripts.tone_match.assertions import normalize_instrument
from scripts.tone_match.controllability import objective_contract_hash
from scripts.tone_match.score import SCORER_CONTRACT_VERSION
from scripts.tone_match.sung_audition import _consume_audit
from scripts.tone_match.sung_features import (
    SungObservation,
    classify_rendered_vowel_body_transfer,
    compare_rendered_vowel_body_transfer,
    fit_pooled_source_vowel_bodies,
    vowel_classification_gate,
    vowel_regions_for_class,
)
from scripts.tone_match.sung_prep import (
    VOICE_CLASSES,
    VocalSetFile,
    _roles,
    parse_vocalset_file,
    register_for_f0,
)
from scripts.tone_match.sung_fit import fit_campaign
from scripts.tone_match.sung_consonants import (
    CONSONANT_FEATURE_WEIGHTS,
    SungAdaptationPolicy,
    adapt_spoken_measurement,
    parse_phone_tier,
)
from scripts.tone_match.sung_consonant_audit import (
    VOICE_AUDIT_MIDI,
    audit as audit_consonant_generator,
)
from scripts.tone_match.sung_exchange_status import extract as extract_exchange
from scripts.tone_match.sung_pass_state import _selection_key
from scripts.tone_match.sung_pass_snapshot import build as build_pass_snapshot
from scripts.tone_match.sung_spectral_triage import fit_global_dynamic_amount
from scripts.tone_match.sung_source_tables import (
    DYNAMIC_COMPOSITION,
    INTERPOLATION_CONTRACT,
    _emit_rows,
    synthetic_round_trip,
)
from scripts.tone_match.sung_source_audit import summarize_responses
from scripts.tone_match.sung_prior import (
    LEGACY_VOCAL_CRAFT,
    LEGACY_VOCAL_PRIOR_HASH,
    params_for_mode,
    prior_provenance,
)
from scripts.tone_match.tripwires import reference_roles
from scripts.sg2_listen_page import selected_audition_manifest


def test_vocalset_parser_carries_identity_vowel_and_technique():
    row = parse_vocalset_file(
        "/corpus/voice-tenor/vocalset/male11/long_tones/straight/"
        "m11_long_straight_i.wav"
    )
    assert row.singer == "male11"
    assert row.context == "long_tones"
    assert row.technique == "straight"
    assert row.vowel == "i"


def test_register_prior_straddles_passaggio():
    assert register_for_f0("tenor", 180) == "low"
    assert register_for_f0("tenor", 260) == "mid"
    assert register_for_f0("tenor", 330) == "mid"
    assert register_for_f0("tenor", 440) == "high"


def test_standard_section_voice_classes_are_first_class():
    assert VOICE_CLASSES["bass"] == {"male8"}
    assert VOICE_CLASSES["soprano"] == {
        "female1", "female2", "female3", "female4", "female6", "female7", "female9"
    }
    assert "male7" not in VOICE_CLASSES["tenor"]
    assert register_for_f0("bass", 260) == "mid"
    assert register_for_f0("soprano", 880) == "high"
    assert vowel_regions_for_class("soprano")["i"][0][0] > (
        vowel_regions_for_class("mezzo-soprano")["i"][0][0]
    )
    assert normalize_instrument("voice-soprano") == "soprano"
    assert normalize_instrument("voice-mezzo") == "mezzo-soprano"
    assert normalize_instrument("voice-tenor") == "tenor"
    assert normalize_instrument("voice-bass") == "bass"


def test_vowel_gate_uses_class_scaled_regions():
    tenor = vowel_regions_for_class("tenor")
    mezzo = vowel_regions_for_class("mezzo-soprano")
    assert mezzo["i"][0][0] > tenor["i"][0][0]
    rendered = {
        vowel: {
            "low": (
                np.sqrt(regions[0][0] * regions[0][1]),
                np.sqrt(regions[1][0] * regions[1][1]),
            ),
            "mid": (
                np.sqrt(regions[0][0] * regions[0][1]),
                np.sqrt(regions[1][0] * regions[1][1]),
            ),
        }
        for vowel, regions in tenor.items()
    }
    assert vowel_classification_gate(rendered, "tenor")["passed"]
    rendered["i"]["mid"] = rendered["u"]["mid"]
    assert not vowel_classification_gate(rendered, "tenor")["passed"]


def test_rendered_vowel_body_transfer_consumes_exact_fitted_shape():
    f0 = 130.8128
    frequencies = f0 * np.arange(1, 49)
    bands = [
        {"freq": 520.0, "gain": 1.1, "width": 0.13},
        {"freq": 1750.0, "gain": 0.8, "width": 0.16},
    ]
    source = np.exp(-0.08 * np.arange(48))
    log2_gain = np.zeros(48)
    for band in bands:
        log2_gain += band["gain"] * np.exp(
            -0.5 * (np.log2(frequencies / band["freq"]) / band["width"]) ** 2
        )
    body = source * np.clip(2 ** log2_gain, 0.2, 4.5)
    result = compare_rendered_vowel_body_transfer(
        body, source, np.ones(48, dtype=bool),
        f0_hz=f0, bands=bands,
    )
    assert result["passed"]
    assert result["medianShapeErrorDb"] < 1e-9
    wrong = compare_rendered_vowel_body_transfer(
        source, source, np.ones(48, dtype=bool),
        f0_hz=f0, bands=bands,
    )
    assert not wrong["passed"]


def test_paired_transfer_classifier_compares_all_vowels_and_keeps_annex_box():
    f0 = 130.8128
    frequencies = f0 * np.arange(1, 49)
    centres = {
        "a": (768.0, 1333.0),
        "e": (580.0, 1799.0),
        "i": (342.0, 2322.0),
        "o": (497.0, 910.0),
        "u": (378.0, 997.0),
    }
    bodies = {}
    for vowel, pair in centres.items():
        bodies[vowel] = {
            "formantsHz": list(pair),
            "bands": [
                {"freq": pair[0], "gain": 1.1, "width": 0.13},
                {"freq": pair[1], "gain": 0.8, "width": 0.16},
            ],
        }
    source = np.exp(-0.08 * np.arange(48))
    log2_gain = np.zeros(48)
    for band in bodies["e"]["bands"]:
        log2_gain += band["gain"] * np.exp(
            -0.5 * (np.log2(frequencies / band["freq"]) / band["width"]) ** 2
        )
    render = source * np.clip(2 ** log2_gain, 0.2, 4.5)
    result = classify_rendered_vowel_body_transfer(
        render, source, np.ones(48, dtype=bool),
        f0_hz=f0, vowel_bodies=bodies, voice_class="tenor",
    )
    assert result["passed"]
    assert result["classifiedAs"] == "e"
    assert result["annexRegionPassed"]

    bodies["e"]["formantsHz"][1] = 4000.0
    result = classify_rendered_vowel_body_transfer(
        render, source, np.ones(48, dtype=bool),
        f0_hz=f0, vowel_bodies=bodies, voice_class="tenor",
    )
    assert not result["passed"]


def test_soprano_above_passaggio_scale_role_is_explicit_and_firewalled():
    audio = VocalSetFile(
        path="f1_scales_c_slow_piano_a.wav",
        singer="female1", singer_short="f1", context="scales",
        technique="slow_piano", vowel="a",
    )
    assert _roles(audio, "soprano", "high") == ["spectral", "onset", "floor"]
    assert _roles(audio, "soprano", "mid") == ["floor"]
    assert _roles(audio, "mezzo-soprano", "high") == ["floor"]
    assert _roles(VocalSetFile(
        path="f2_scales_c_slow_piano_a.wav",
        singer="female2", singer_short="f2", context="scales",
        technique="slow_piano", vowel="a",
    ), "soprano", "high") == ["floor"]


def test_sung_audition_rejects_a_stale_renderer_audit(tmp_path):
    path = tmp_path / "controllability.json"
    path.write_text(json.dumps({
        "instrument": "tenor",
        "finalWeights": {},
        "objectiveHash": objective_contract_hash("tenor", [], {}),
        "scorerContractVersion": SCORER_CONTRACT_VERSION,
        "rendererContractHash": "stale-renderer",
        "clean": True,
        "responsiveParameters": {},
    }))
    with pytest.raises(ValueError, match="renderer contract changed"):
        _consume_audit(path, "tenor", [])


def test_alternating_fit_separates_one_source_from_five_bodies():
    rng = np.random.default_rng(7)
    source_db = -8 * np.log2(np.arange(1, 25))
    formants = {
        "a": (700, 1250, 2500, 3400, 4400),
        "e": (520, 1750, 2600, 3500, 4500),
        "i": (340, 2300, 3000, 3800, 4700),
        "o": (500, 900, 2450, 3400, 4400),
        "u": (380, 1000, 2350, 3350, 4300),
    }
    observations = []
    for vowel, centres in formants.items():
        for f0 in (130.81, 196.0, 293.66):
            freqs = f0 * np.arange(1, 25)
            body = np.zeros_like(freqs)
            for centre, gain in zip(centres, (7, 5, 3, 2, 1)):
                body += gain * np.exp(-0.5 * (np.log2(freqs / centre) / 0.16) ** 2)
            observations.append(SungObservation(
                vowel=vowel,
                f0_hz=f0,
                partial_db=source_db + body + rng.normal(0, 0.08, len(freqs)),
                formants_hz=centres,
                bandwidths_hz=(90, 130, 180, 220, 260),
            ))
    result = fit_pooled_source_vowel_bodies(observations, n_partials=24)
    assert result["observations"] == 15
    assert set(result["vowelBodies"]) == set("aeiou")
    assert all(len(row["bands"]) == 5 for row in result["vowelBodies"].values())
    assert result["roundTripMedianAbsDb"] < 1.0
    assert result["sourcePartials"][0]["amp"] == 1.0


def test_identity_fit_rejects_cross_singer_manifest(tmp_path):
    references = tmp_path / "references.json"
    references.write_text("""[
      {"singer":"male11","voiceClass":"tenor","roles":[]},
      {"singer":"male3","voiceClass":"tenor","roles":[]}
    ]""")
    try:
        fit_campaign(references, tmp_path / "out")
    except ValueError as exc:
        assert "exactly one singer" in str(exc)
    else:
        raise AssertionError("cross-singer identity manifest was accepted")


def test_legacy_vocal_prior_keeps_craft_and_splits_fit_ship_modes():
    provenance = prior_provenance()
    assert provenance["tag"] == "sg2-legacy"
    assert provenance["parameterHash"] == LEGACY_VOCAL_PRIOR_HASH
    assert LEGACY_VOCAL_CRAFT["excitationHuman"] > 0
    assert LEGACY_VOCAL_CRAFT["envelopeProb"] > 0
    assert LEGACY_VOCAL_CRAFT["toneBreath"] > 0
    assert LEGACY_VOCAL_CRAFT["vibratoProb"] > 0
    fit = params_for_mode(LEGACY_VOCAL_CRAFT, "fit")
    ship = params_for_mode(LEGACY_VOCAL_CRAFT, "ship", seed=991)
    assert fit["excitationHuman"] == fit["envelopeProb"] == fit["vibratoProb"] == 0
    assert ship["excitationHuman"] == LEGACY_VOCAL_CRAFT["excitationHuman"]
    assert ship["envelopeProb"] == LEGACY_VOCAL_CRAFT["envelopeProb"]
    assert ship["seed"] == 991


def test_spoken_to_sung_adaptation_is_directional_and_zero_weighted():
    policy = SungAdaptationPolicy()
    common = {
        "spokenDurationMs": 100.0,
        "spokenVotMs": 60.0,
        "spokenTransitionMs": 80.0,
    }
    voiceless = adapt_spoken_measurement({**common, "voiced": False}, policy)
    voiced = adapt_spoken_measurement({**common, "voiced": True}, policy)
    assert voiceless["durationMs"] < common["spokenDurationMs"]
    assert voiceless["votMs"] < common["spokenVotMs"]
    assert voiced["votMs"] > common["spokenVotMs"]
    assert voiceless["anchor"] == "vowel-on-beat"
    assert set(CONSONANT_FEATURE_WEIGHTS.values()) == {0.0}


def test_humanisation_role_is_explicit_but_not_a_quantitative_bar():
    assert reference_roles({"roles": ["humanisation"]}) == {"humanisation"}


def test_phone_tier_parser_reads_only_phone_intervals(tmp_path):
    grid = tmp_path / "x.TextGrid"
    grid.write_text(
        'name = "words"\nintervals [1]:\n xmin = 0\n xmax = 1\n text = "day"\n'
        'name = "phones"\nintervals [1]:\n xmin = 0.1\n xmax = 0.2\n text = "D"\n'
        'intervals [2]:\n xmin = 0.2\n xmax = 0.5\n text = "EY1"\n'
    )
    assert [row["phone"] for row in parse_phone_tier(grid)] == ["D", "EY1"]


def test_consonant_audit_keeps_weights_zero_when_generator_consumer_is_absent(tmp_path):
    repo = tmp_path / "repo"
    (repo / "web/static").mkdir(parents=True)
    (repo / "scripts").mkdir()
    (repo / "web/static/params.js").write_text("consonantClass")
    (repo / "web/static/synth.js").write_text("")
    (repo / "scripts/verify_tone_model.mjs").write_text("")
    fit = tmp_path / "fit.json"
    fit.write_text(json.dumps({
        "featureWeights": CONSONANT_FEATURE_WEIGHTS,
        "classes": {name: {"count": 8} for name in ("plosive", "nasal", "fricative")},
    }))
    result = audit_consonant_generator(repo, fit, tmp_path / "audit.json")
    assert result["status"] == "blocked-generator-consumer-absent"
    assert not result["generatorLanded"]
    assert result["zeroWeightSafe"]
    assert result["tenorOnsetFit"] == "not-run-generator-consumer-absent"


def test_consonant_audit_enumerates_all_standard_voice_sections(tmp_path):
    assert VOICE_AUDIT_MIDI == {
        "voice-bass": 48,
        "voice-tenor": 60,
        "voice-mezzo": 67,
        "voice-soprano": 72,
    }
    repo = tmp_path / "repo"
    (repo / "web/static").mkdir(parents=True)
    (repo / "scripts").mkdir()
    (repo / "web/static/params.js").write_text("")
    (repo / "web/static/synth.js").write_text("")
    (repo / "scripts/verify_tone_model.mjs").write_text("")
    fit = tmp_path / "fit.json"
    fit.write_text(json.dumps({
        "featureWeights": CONSONANT_FEATURE_WEIGHTS,
        "classes": {name: {"count": 8} for name in ("plosive", "nasal", "fricative")},
    }))
    for instrument in VOICE_AUDIT_MIDI:
        result = audit_consonant_generator(
            repo, fit, tmp_path / f"{instrument}.json", instrument=instrument,
        )
        assert result["instrument"] == instrument
        assert result["voiceOnsetFit"] == "not-run-generator-consumer-absent"
        assert ("tenorOnsetFit" in result) == (instrument == "voice-tenor")


def test_consonant_objective_hash_is_voice_scoped(tmp_path):
    repo = tmp_path / "repo"
    (repo / "web/static").mkdir(parents=True)
    (repo / "scripts").mkdir()
    (repo / "web/static/params.js").write_text("")
    (repo / "web/static/synth.js").write_text("")
    (repo / "scripts/verify_tone_model.mjs").write_text("")
    fit = tmp_path / "fit.json"
    fit.write_text(json.dumps({
        "featureWeights": CONSONANT_FEATURE_WEIGHTS,
        "classes": {name: {"count": 8} for name in ("plosive", "nasal", "fricative")},
    }))
    tenor = audit_consonant_generator(
        repo, fit, tmp_path / "tenor.json", instrument="voice-tenor",
    )
    soprano = audit_consonant_generator(
        repo, fit, tmp_path / "soprano.json", instrument="voice-soprano",
    )
    assert tenor["objectiveHash"] != soprano["objectiveHash"]


def test_a_voice_05_source_emitter_pools_vowels_without_creating_vowel_sources():
    residuals = []
    for vowel in "ai":
        residuals.append({
            "vowel": vowel, "register": "mid", "dynamic": "mf",
            "velocity": .62, "f0Hz": 220.0,
            "sourceId": f"/{vowel}.wav",
            "sourceDb": np.asarray([0.0, -6.0, -12.0, -18.0]),
        })
    rows = _emit_rows(residuals)
    assert len(rows) == 1
    assert rows[0]["vowels"] == ["a", "i"]
    assert rows[0]["partials"] == pytest.approx([1.0, .50118723, .25118864, .12589254])
    assert rows[0]["nNotes"] == 2


def test_a_voice_05_source_emitter_passes_synthetic_body_deconvolution_round_trip():
    result = synthetic_round_trip()
    assert result["passed"]
    assert result["maxAbsShapeErrorDb"] <= result["toleranceDb"]


def test_a_voice_05_contract_forbids_sparse_hull_extrapolation_and_dynamic_double_count():
    assert "never rectangular extrapolation" in INTERPOLATION_CONTRACT
    assert "suppress generic spectralDynamicAmount" in DYNAMIC_COMPOSITION


def test_a_voice_05_output_audit_requires_partial_mel_and_band_responders():
    rows = [{
        "pcmDistinct": True,
        "repeatNormalized": {
            "partials_db": 0.0, "log_mel_db": 0.0, "band_balance_db": 0.0,
        },
        "surfaceVsFallbackNormalized": {
            "partials_db": 0.6, "log_mel_db": 0.4, "band_balance_db": 0.2,
        },
    }]
    assert summarize_responses(rows)["passed"]
    rows[0]["surfaceVsFallbackNormalized"]["band_balance_db"] = 0.01
    summary = summarize_responses(rows)
    assert not summary["passed"]
    assert not summary["responsiveFeatures"]["band_balance_db"]


def test_exchange_status_update_is_applied_only_to_its_named_id(tmp_path):
    exchange = tmp_path / "exchange.md"
    exchange.write_text(
        "### T-001 · First\nStatus: sung=incorporated\n\n"
        "Status update — lane: T-002\nsung=blocked\n\n"
        "### T-002 · Second\nStatus: sung=pending\n"
    )
    entries = {row["id"]: row for row in extract_exchange(exchange)["entries"]}
    assert entries["T-001"]["sungStatus"] == "incorporated"
    assert entries["T-002"]["sungStatus"] == "blocked"


def test_sung_leaderboard_closes_strict_cells_before_composite():
    def entry(strict_fail, composite):
        return {
            "meanComposite": composite,
            "gates": {
                "construction": {"counts": {"fail": 0}},
                "strictTripwires": {
                    "requiredFail": strict_fail, "requiredMissing": 0,
                },
                "vowelBodyConsumption": {"requiredRows": 10, "passedRows": 10},
                "vowelClassification": {"requiredRows": 10, "passedRows": 10},
                "humanisation": {"passed": False},
            },
        }

    assert _selection_key(entry(4, 9.0)) < _selection_key(entry(5, 1.0))


def test_sung_leaderboard_orders_partial_before_downstream_spectral_cells():
    def entry(partial, mel, partial_residual=0.0):
        return {
            "meanComposite": 1.0,
            "gates": {
                "construction": {"counts": {"fail": 0}},
                "strictTripwires": {
                    "requiredFail": partial + mel, "requiredMissing": 0,
                    "byBar": {
                        "partial-table": {"fail": partial, "missing": 0,
                                          "meanNormalizedResidual": partial_residual},
                        "mel-spectrogram": {"fail": mel, "missing": 0},
                    },
                },
                "vowelBodyConsumption": {"requiredRows": 10, "passedRows": 10},
                "vowelClassification": {"requiredRows": 10, "passedRows": 10},
                "humanisation": {"passed": False},
            },
        }

    assert _selection_key(entry(0, 3)) < _selection_key(entry(1, 0))
    assert _selection_key(entry(1, 3, 1.0)) < _selection_key(entry(1, 0, 2.0))


def test_sung_dynamic_scalar_is_recovered_from_debodied_source_rows():
    amount = 0.65
    source = -7.0 * np.log2(np.arange(1, 25))
    rows = []
    for velocity, dynamic in ((.2, "pp"), (.62, "mf"), (.92, "ff")):
        exponent = .5 * np.log2(1 + np.arange(1, 25))
        dynamic_db = 20 * exponent * np.log10(velocity / .62) * amount
        for vowel in "aeiou":
            rows.append({
                "vowel": vowel, "register": "mid", "dynamic": dynamic,
                "velocity": velocity, "sourceId": vowel,
                "sourceDb": source + dynamic_db,
            })
    result = fit_global_dynamic_amount(rows)
    assert result["spectralDynamicAmount"] == pytest.approx(amount, abs=.013)
    assert result["medianPartialErrorDb"] < 1e-6


def test_listening_page_uses_selected_sung_ship_manifest(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    scores = run / "baseline-scores.json"
    scores.write_text("{}")
    (run / "audition-manifest.json").write_text(json.dumps([
        {"reference": "/real/a.wav", "render": "/ship/a.wav"},
    ]))
    assert selected_audition_manifest({"scoresPath": str(scores)}) == {
        "/real/a.wav": "/ship/a.wav",
    }


def test_pass_snapshot_preserves_legacy_and_leader_gate_rows(tmp_path):
    state = tmp_path / "state"
    run = tmp_path / "run"
    for voice in ("tenor", "soprano", "bass", "mezzo"):
        root = state / f"voice-{voice}"
        root.mkdir(parents=True)
        rows = [{
            "entryNumber": 1, "kind": "legacy-baseline", "run": "legacy",
            "status": "interim-gates-failing", "shipEligible": False,
            "meanComposite": 2.0, "objectiveHash": f"objective-{voice}",
            "manifestHash": "manifest", "gates": {"strict": {"passed": False}},
            "isLeader": False,
        }, {
            "entryNumber": 2, "kind": "candidate", "run": "candidate",
            "status": "interim-gates-failing", "shipEligible": False,
            "meanComposite": 1.0, "objectiveHash": f"objective-{voice}",
            "manifestHash": "manifest", "gates": {"strict": {"passed": False}},
            "isLeader": True,
        }]
        (root / "leaderboard.json").write_text(json.dumps({
            "objectiveHash": f"objective-{voice}", "runs": rows, "best": rows[1],
        }))
    gates, table = build_pass_snapshot("sung-test", state, run)
    assert all(len(row["entries"]) == 2 for row in gates["voices"].values())
    assert gates["snapshotSha256"]
    assert table["tableSha256"]
