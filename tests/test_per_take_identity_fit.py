from scripts.tone_match.per_take_identity_fit import (
    residual_quality,
    tier_drift_matrix,
)


def test_per_take_quality_reports_first_physical_failure_tier():
    result = residual_quality({
        "inharmonicity_log_ratio": .2,
        "partials_db": 1.3,
        "log_mel_db": 4.0,
        "band_balance_db": 0.0,
        "attack_ms": 8.0,
    })
    assert not result["good"]
    assert result["firstFailingTier"] == "partial-identity"
    assert result["tiers"][1]["failedFeatures"] == ["partials_db"]


def test_per_take_quality_accepts_every_core_bar_at_or_below_one():
    result = residual_quality({
        "inharmonicity_log_ratio": 1.0,
        "partials_db": .9,
        "log_mel_db": 1.0,
        "band_balance_db": 0.0,
        "attack_ms": .8,
    })
    assert result["good"]
    assert result["firstFailingTier"] is None


def test_tier_drift_matrix_names_which_improvement_steals_from_which():
    transitions = [{
        "takeIndex": 0, "from": "incumbent", "to": "source-fit",
        "previous": {"partials_db": 2.0, "log_mel_db": 3.0,
                     "band_balance_db": 0.0, "attack_ms": 2.0,
                     "inharmonicity_log_ratio": 0.0},
        "current": {"partials_db": 1.0, "log_mel_db": 2.0,
                    "band_balance_db": 0.0, "attack_ms": 3.0,
                    "inharmonicity_log_ratio": 0.0},
    }]
    matrix = tier_drift_matrix(transitions, {
        "partials_db": .05, "log_mel_db": .05, "band_balance_db": .05,
        "attack_ms": .05, "inharmonicity_log_ratio": .05,
    })
    assert matrix["directedTransitions"] == 1
    assert matrix["dominantTierTheft"] == {
        "improvedTier": "continuous-spectrum",
        "degradedTier": "temporal-identity",
        "events": 1,
        "finding": "continuous-spectrum improvement steals from temporal-identity",
    }
