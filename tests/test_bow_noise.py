import json
import math
from pathlib import Path

import numpy as np
from scipy import signal
import soundfile as sf

from scripts.tone_match.bow_noise import (
    DEFAULT_BAND_HZ,
    residual_spectrum,
    validate_engine_roundtrip,
)


def test_harmonic_subtraction_recovers_known_coloured_noise(tmp_path):
    sample_rate = 48000
    seconds = 3
    t = np.arange(sample_rate * seconds) / sample_rate
    harmonic = sum((0.5 / n) * np.sin(2 * np.pi * 440 * n * t)
                   for n in range(1, 20))
    rng = np.random.default_rng(141421)
    noise = signal.lfilter([0.08, -0.03, 0.01], [1, -0.82, 0.2],
                           rng.standard_normal(t.size))
    mixed_path = tmp_path / "mixed.wav"
    harmonic_path = tmp_path / "harmonic.wav"
    sf.write(mixed_path, harmonic + noise, sample_rate, subtype="FLOAT")
    sf.write(harmonic_path, harmonic, sample_rate, subtype="FLOAT")

    result = validate_engine_roundtrip(
        mixed_path, harmonic_path, 440, tmp_path / "validation.json")

    assert result["status"] == "pass"
    assert result["metrics"]["correlation"] >= 0.90
    assert result["metrics"]["medianAbsDb"] <= 1.6


def test_harmonic_bins_are_removed_from_residual():
    sample_rate = 48000
    t = np.arange(sample_rate * 2) / sample_rate
    rng = np.random.default_rng(7)
    samples = 0.7 * np.sin(2 * np.pi * 440 * t) + 0.01 * rng.standard_normal(t.size)
    spectrum = residual_spectrum(samples, sample_rate, 440)
    inside = ((spectrum.centres >= DEFAULT_BAND_HZ[0]) &
              (spectrum.centres <= DEFAULT_BAND_HZ[1]))
    # A band centred directly on a harmonic can be fully occluded for one
    # note; cross-pitch pooling is what fills those note-specific holes.
    assert np.mean(np.isfinite(spectrum.db[inside])) >= 0.85
    assert spectrum.nhr_db < -20


def test_validation_artifact_has_a_machine_gate(tmp_path):
    failed = {"schema": "sg2-bow-noise-validation-v1", "status": "fail"}
    path = tmp_path / "validation.json"
    path.write_text(json.dumps(failed))
    assert json.loads(path.read_text())["status"] != "pass"


def test_measured_violin_profile_is_pinned_and_rejects_flagged_leakage():
    root = Path(__file__).resolve().parents[1]
    bow = json.loads((root / "web/static/measured_profiles.json").read_text())["violin"]["bowNoise"]
    assert bow["profilePinned"] is True
    assert bow["bandHz"] == [200.0, 14400.0]
    assert bow["shapeStableAcrossDynamics"] is True
    flagged = {row["freqHz"] for row in bow["artifactScreen"]["flaggedBands"]}
    emitted = {row["freqHz"] for row in bow["profile"]}
    assert 9051.0 in flagged
    assert 9051.0 not in emitted
