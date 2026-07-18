from scripts.tone_match.blown_octave_sweep import (
    _candidate_rank,
    _materialise_surface,
)


def test_sweep_materialises_only_the_instrument_owned_source_surface():
    params = {"excitationType": "blow", "bodyBands": [{"freq": 500}]}
    handoff = {
        "handoff": "BLOWN-SUSTAIN-01",
        "instruments": {
            "flute": {"rows": [{"register": "mid", "dynamic": "ff"}]},
            "clarinet": {"rows": [{"register": "low", "dynamic": "pp"}]},
        },
    }
    result = _materialise_surface(params, handoff, "flute")
    assert result["bodyBands"] == params["bodyBands"]
    assert result["spectralPartialsByRegisterDynamic"]["rows"] == [
        {"register": "mid", "dynamic": "ff"}]
    assert "spectralPartialsByRegisterDynamic" not in params


def test_sweep_prefers_a_cleared_cell_then_best_bounded_balance():
    failing = {"gain": 1.0, "balance": {
        "status": "measured", "meanDb": 3.01, "maxOctaveDb": 5.0}}
    passing = {"gain": .5, "balance": {
        "status": "measured", "meanDb": 2.99, "maxOctaveDb": 5.9}}
    better = {"gain": .75, "balance": {
        "status": "measured", "meanDb": 2.5, "maxOctaveDb": 4.0}}
    assert min([failing, passing, better], key=_candidate_rank) is better
