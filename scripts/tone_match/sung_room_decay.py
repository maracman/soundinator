#!/usr/bin/env python3
"""Room-tail screening for the canonical pitch-synchronous breath residual."""

from __future__ import annotations

import math

import numpy as np

from .pitch_sync_breath import _stft_harmonic_residual


ROOM_METHOD = "nonnegative-exponential-residual-power-decomposition-v1"


def assess_room_decay(residual: np.ndarray, sample_rate: int, *,
                      frame_seconds: float = .025,
                      hop_seconds: float = .0125) -> dict:
    """Fit a non-negative floor plus exponential decay to residual power."""
    audio = np.asarray(residual, float)
    frame = max(64, int(round(frame_seconds * sample_rate)))
    hop = max(32, int(round(hop_seconds * sample_rate)))
    if len(audio) < frame * 8:
        raise ValueError("room-decay assessment needs at least eight frames")
    window = np.hanning(frame)
    scale = max(float(np.sum(window ** 2)), 1e-12)
    powers = np.asarray([
        float(np.sum((audio[start:start + frame] * window) ** 2) / scale)
        for start in range(0, len(audio) - frame + 1, hop)
    ])
    times = (np.arange(len(powers)) * hop + frame / 2) / sample_rate
    keep = times >= min(.12, times[-1] * .15)
    powers, times = powers[keep], times[keep]
    times = times - times[0]
    floor = float(np.percentile(powers, 10))
    target = np.maximum(powers - floor, 0.0)
    total = float(np.sum(powers)) + 1e-20
    best = None
    for tau in np.geomspace(.06, 2.5, 96):
        basis = np.exp(-times / tau)
        amplitude = max(0.0, float(np.dot(target, basis) /
                                   max(np.dot(basis, basis), 1e-20)))
        predicted = floor + amplitude * basis
        error = float(np.sum((powers - predicted) ** 2))
        if best is None or error < best[0]:
            best = (error, float(tau), amplitude, basis)
    assert best is not None
    error, tau, amplitude, basis = best
    variance = float(np.sum((powers - np.mean(powers)) ** 2))
    r_squared = max(0.0, 1.0 - error / max(variance, 1e-20))
    fraction = float(np.sum(amplitude * basis) / total)
    suspected = bool(
        fraction >= .20 and r_squared >= .40 and amplitude > floor * .25
    )
    return {
        "method": ROOM_METHOD,
        "roomSuspected": suspected,
        "suspectedDecayFraction": round(float(np.clip(fraction, 0, 1)), 6),
        "suspectedDecayPercent": round(float(np.clip(fraction, 0, 1)) * 100, 3),
        "decayTimeConstantSeconds": round(tau, 6),
        "estimatedT60Seconds": round(tau * math.log(1000), 6),
        "fitRSquared": round(r_squared, 6),
        "powerFloor": round(floor, 12),
        "frames": len(powers),
        "decisionThresholds": {
            "fractionMin": .20, "rSquaredMin": .40,
            "amplitudeToFloorMin": .25,
        },
        "disposition": (
            "log-separately-never-breath" if suspected
            else "screened-not-room-like"
        ),
    }


def assess_canonical_room(samples: np.ndarray, sample_rate: int,
                          f0_hz: float) -> dict:
    """Screen room decay after the one canonical T-067 separator."""
    residual, _tracked = _stft_harmonic_residual(samples, sample_rate, f0_hz)
    return assess_room_decay(residual, sample_rate)


def synthetic_room_decay_round_trip(*, sample_rate: int = 12000,
                                    seed: int = 67467) -> dict:
    duration = 2.2
    time = np.arange(round(duration * sample_rate)) / sample_rate
    rng = np.random.default_rng(seed)
    dry = .012 * rng.standard_normal(len(time))
    room = .05 * rng.standard_normal(len(time)) * np.exp(-time / .48)
    mixed = dry + room
    measured = assess_room_decay(mixed, sample_rate)
    injected_fraction = float(np.sum(room ** 2) /
                              max(np.sum(mixed ** 2), 1e-20))
    error = abs(measured["suspectedDecayFraction"] - injected_fraction)
    return {
        "passed": bool(measured["roomSuspected"] and error <= .20),
        "injectedDecayEnergyFraction": round(injected_fraction, 6),
        "recoveredDecayFraction": measured["suspectedDecayFraction"],
        "absoluteFractionError": round(error, 6),
        "maximumFractionError": .20,
        "measured": measured,
    }
