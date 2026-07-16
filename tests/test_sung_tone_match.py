from __future__ import annotations

import numpy as np

from scripts.tone_match.sung_features import (
    SungObservation,
    fit_pooled_source_vowel_bodies,
    vowel_classification_gate,
    vowel_regions_for_class,
)
from scripts.tone_match.sung_prep import parse_vocalset_file, register_for_f0
from scripts.tone_match.sung_fit import fit_campaign


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
