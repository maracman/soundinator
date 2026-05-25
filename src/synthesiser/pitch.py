"""Pitch lattices and quantisation controls."""

from __future__ import annotations

from dataclasses import dataclass, field
from math import log2
from typing import Iterable

import numpy as np


def hz_to_cents(hz: float, reference_hz: float) -> float:
    return 1200.0 * log2(float(hz) / float(reference_hz))


def cents_to_hz(cents: float, reference_hz: float) -> float:
    return float(reference_hz) * (2.0 ** (float(cents) / 1200.0))


@dataclass(slots=True)
class PitchSystem:
    """Equal-division pitch system with an optional active scale subset."""

    tonic_hz: float = 261.6255653005986
    octave_division: int = 12
    octave_ratio: float = 2.0
    scale_degrees: tuple[int, ...] | None = None
    degree_weights: tuple[float, ...] | None = None
    label: str = "12-EDO"
    _scale_degrees: tuple[int, ...] = field(init=False, repr=False)
    _weights: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if self.octave_division < 1:
            raise ValueError("octave_division must be positive")
        if self.octave_ratio <= 1.0:
            raise ValueError("octave_ratio must be greater than 1")

        degrees = self.scale_degrees
        if degrees is None:
            degrees = tuple(range(self.octave_division))
        if not degrees:
            raise ValueError("scale_degrees cannot be empty")
        normalised = tuple(int(degree) % self.octave_division for degree in degrees)
        if len(set(normalised)) != len(normalised):
            raise ValueError("scale_degrees must be unique within the octave")
        object.__setattr__(self, "_scale_degrees", normalised)

        if self.degree_weights is None:
            weights = np.ones(len(normalised), dtype=float)
        else:
            if len(self.degree_weights) != len(normalised):
                raise ValueError("degree_weights must match scale_degrees length")
            weights = np.asarray(self.degree_weights, dtype=float)
            if np.any(weights < 0) or not np.any(weights > 0):
                raise ValueError("degree_weights must contain positive mass")
        object.__setattr__(self, "_weights", weights / weights.sum())

    @property
    def active_degrees(self) -> tuple[int, ...]:
        return self._scale_degrees

    @property
    def weights(self) -> np.ndarray:
        return self._weights.copy()

    def lattice_frequency(self, lattice_degree: int, octave: int = 0) -> float:
        exponent = (int(lattice_degree) / self.octave_division) + int(octave)
        return self.tonic_hz * (self.octave_ratio**exponent)

    def pitch_for_degree(self, scale_degree: int, octave: int = 0) -> float:
        scale_len = len(self._scale_degrees)
        wrapped = int(scale_degree) % scale_len
        octave_offset = int(scale_degree) // scale_len
        lattice_degree = self._scale_degrees[wrapped]
        return self.lattice_frequency(lattice_degree, octave + octave_offset)

    def scale_frequencies(self, octaves: Iterable[int] = (0,)) -> list[float]:
        return [
            self.lattice_frequency(degree, octave)
            for octave in octaves
            for degree in self._scale_degrees
        ]

    def nearest_grid_pitch(
        self,
        continuous_hz: float,
        quantisation_strength: float,
        *,
        search_octaves: int = 4,
        attraction_sigma_cents: float = 35.0,
        rng: np.random.Generator | None = None,
    ) -> float:
        """Pull a continuous pitch toward the nearest active grid point.

        Strength 0 leaves the pitch untouched. Strength 1 snaps to the grid.
        Intermediate values interpolate in log-frequency space and optionally
        add a small residual attraction noise that vanishes at both endpoints.
        """

        if continuous_hz <= 0:
            raise ValueError("continuous_hz must be positive")
        strength = float(np.clip(quantisation_strength, 0.0, 1.0))
        if strength == 0.0:
            return float(continuous_hz)

        centre_octave = int(np.floor(log2(continuous_hz / self.tonic_hz)))
        octaves = range(centre_octave - search_octaves, centre_octave + search_octaves + 1)
        candidates = np.asarray(self.scale_frequencies(octaves), dtype=float)
        nearest = float(candidates[np.argmin(np.abs(np.log2(candidates / continuous_hz)))])
        if strength == 1.0:
            return nearest

        continuous_cents = hz_to_cents(continuous_hz, self.tonic_hz)
        nearest_cents = hz_to_cents(nearest, self.tonic_hz)
        pulled_cents = continuous_cents + strength * (nearest_cents - continuous_cents)

        if rng is not None and attraction_sigma_cents > 0:
            endpoint_taper = strength * (1.0 - strength)
            pulled_cents += float(rng.normal(0.0, attraction_sigma_cents * endpoint_taper))

        return cents_to_hz(pulled_cents, self.tonic_hz)

    def sample_degree(self, rng: np.random.Generator) -> int:
        return int(rng.choice(np.arange(len(self._scale_degrees)), p=self._weights))
