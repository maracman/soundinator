import math

import numpy as np

from synthesiser.pitch import PitchSystem


def test_12_edo_octave() -> None:
    pitch = PitchSystem(tonic_hz=220.0, octave_division=12)
    assert math.isclose(pitch.lattice_frequency(12), 440.0, rel_tol=1e-9)


def test_scale_degree_wraps_octave() -> None:
    pitch = PitchSystem(tonic_hz=220.0, octave_division=12, scale_degrees=(0, 2, 4, 5, 7, 9, 11))
    assert pitch.pitch_for_degree(7) > pitch.pitch_for_degree(6)
    assert math.isclose(pitch.pitch_for_degree(7), 440.0, rel_tol=1e-9)


def test_quantisation_endpoints() -> None:
    pitch = PitchSystem(tonic_hz=220.0, octave_division=12)
    continuous = 230.0
    assert pitch.nearest_grid_pitch(continuous, 0.0) == continuous
    snapped = pitch.nearest_grid_pitch(continuous, 1.0, rng=np.random.default_rng(1))
    assert snapped != continuous
