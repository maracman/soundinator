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
from scripts.tone_match.sung_prior import (
    LEGACY_VOCAL_CRAFT,
    LEGACY_VOCAL_PRIOR_HASH,
    params_for_mode,
    prior_provenance,
)
from scripts.tone_match.tripwires import reference_roles


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
