import json
import math
from pathlib import Path

import numpy as np
from scipy import signal
import soundfile as sf

from scripts.tone_match.bow_noise import (
    DEFAULT_BAND_HZ,
    assert_lossless_source,
    component_envelope_evidence,
    extract_pinned_component,
    residual_spectrum,
    validate_component_roundtrip,
    validate_engine_roundtrip,
)


def _l17_note(sample_rate, f0, velocity, seed):
    seconds = 1.35
    t = np.arange(round(sample_rate * seconds)) / sample_rate
    harmonic_env = np.zeros_like(t)
    attack = (t >= .22) & (t < .25)
    sustain = (t >= .25) & (t < 1.08)
    release = (t >= 1.08) & (t < 1.16)
    harmonic_env[attack] = (t[attack] - .22) / .03
    harmonic_env[sustain] = 1
    harmonic_env[release] = 1 - (t[release] - 1.08) / .08
    harmonic = velocity * harmonic_env * sum(
        (0.16 / n) * np.sin(2 * np.pi * f0 * n * t)
        for n in range(1, min(18, int(6000 // f0) + 1)))

    breath_env = np.zeros_like(t)
    swell = (t >= .145) & (t < .22)
    settle = (t >= .22) & (t < .34)
    ride = (t >= .34) & (t < 1.08)
    breath_release = (t >= 1.08) & (t < 1.24)
    breath_env[swell] = (t[swell] - .145) / .075
    breath_env[settle] = 1 - .55 * (t[settle] - .22) / .12
    breath_env[ride] = .45
    breath_env[breath_release] = .45 * (1 - (t[breath_release] - 1.08) / .16)
    rng = np.random.default_rng(seed)
    breath = signal.lfilter([.04, -.012, .006], [1, -.72, .16],
                            rng.standard_normal(t.size))
    return harmonic, velocity ** .7 * breath_env * breath


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


def test_l17_component_roundtrip_carries_preonset_envelope_contract(tmp_path):
    sample_rate = 16000
    harmonic, breath = _l17_note(sample_rate, 220, .5, 17)
    mixed = tmp_path / "mixed.wav"
    harmonic_only = tmp_path / "harmonic.wav"
    sf.write(mixed, harmonic + breath, sample_rate, subtype="FLOAT")
    sf.write(harmonic_only, harmonic, sample_rate, subtype="FLOAT")

    result = validate_component_roundtrip(
        mixed, harmonic_only, 220, tmp_path / "validation.json",
        instrument="flute", component="windBreath", band_hz=(200, 6000))
    envelope = component_envelope_evidence(
        harmonic + breath, sample_rate, 220, band_hz=(200, 6000))

    assert result["schema"] == "sg2-pinned-noise-validation-v1"
    assert result["status"] == "pass"
    assert result["instrument"] == "flute"
    assert envelope["noiseLeadMs"] > 25
    assert envelope["preOnsetSwellMs"] > 25
    assert envelope["peakOffsetMs"] <= 50
    assert envelope["releaseMs"] > 0


def test_l17_generic_extraction_pools_each_dynamic_and_emits_own_envelope(tmp_path):
    sample_rate = 16000
    records = []
    for dynamic, velocity in (("pp", .2), ("ff", .92)):
        for index, f0 in enumerate((220.0, 277.18, 329.63)):
            harmonic, breath = _l17_note(sample_rate, f0, velocity, index + (1 if dynamic == "pp" else 20))
            path = tmp_path / f"flute-{dynamic}-{index}.wav"
            sf.write(path, harmonic + breath, sample_rate, subtype="FLOAT")
            records.append({
                "path": str(path), "sourceFile": f"Flute.{dynamic}.{index}.aiff",
                "dynamic": dynamic, "velocity": velocity, "expectedF0Hz": f0,
                "durationSec": 1.16, "hasRelease": True,
            })
    manifest = tmp_path / "records.json"
    manifest.write_text(json.dumps({
        "schema": "sg2-pinned-noise-records-v1", "instrument": "flute",
        "component": "windBreath", "componentClass": "pinnedPreOnsetNoise",
        "levelControl": "windBreathLevel", "bandHz": [200, 6000],
        "records": records,
    }))
    harmonic, breath = _l17_note(sample_rate, 220, .5, 99)
    mixed = tmp_path / "gate-mixed.wav"
    harmonic_only = tmp_path / "gate-harmonic.wav"
    sf.write(mixed, harmonic + breath, sample_rate, subtype="FLOAT")
    sf.write(harmonic_only, harmonic, sample_rate, subtype="FLOAT")
    validation = tmp_path / "validation.json"
    validate_component_roundtrip(
        mixed, harmonic_only, 220, validation, instrument="flute",
        component="windBreath", band_hz=(200, 6000))

    result = extract_pinned_component(
        manifest, validation, tmp_path / "profile.json")

    assert result["profilePinned"] is True
    assert set(result["profilesByDynamic"]) == {"pp", "ff"}
    assert len(result["crossPitchGroups"]) == 2
    assert all(row["notes"] == 3 for row in result["crossPitchGroups"])
    assert result["placementLaw"]["sense"] == "canonical score.py noise_lead_ms"
    assert result["envelope"]["toneAdsrSlave"] is False
    assert result["engineContract"]["levelControl"] == "windBreathLevel"
    assert result["engineContract"]["independentEnvelopeRequired"] is True


def test_l17_lossless_gate_rejects_lossy_provenance_even_for_wav(tmp_path):
    path = tmp_path / "decoded.wav"
    sf.write(path, np.zeros(2048), 16000, subtype="PCM_16")
    with np.testing.assert_raises_regex(ValueError, "lossless-only gate"):
        assert_lossless_source(path, "phil.flute.mp3")


def test_measured_wind_components_preserve_dynamic_placement_and_envelopes():
    root = Path(__file__).resolve().parents[1]
    measured = json.loads((root / "web/static/measured_profiles.json").read_text())
    for instrument in ("flute", "clarinet", "alto-sax"):
        component = measured[instrument]["pinnedNoiseComponents"]["windBreath"]
        assert component["componentClass"] == "pinnedPreOnsetNoise"
        assert component["profilePinned"] is True
        assert set(component["profilesByDynamic"]) == {"pp", "ff"}
        assert component["shapeStableAcrossDynamics"] is False
        assert component["engineContract"]["levelControl"] == "windBreathLevel"
        assert component["engineContract"]["excitationTypes"] == ["blow"]
        assert component["engineContract"]["independentEnvelopeRequired"] is True
        assert [row["dynamic"] for row in component["placementLaw"]["byDynamic"]] == ["pp", "ff"]
        assert all(row["noiseLeadMs"]["median"] > 0
                   for row in component["placementLaw"]["byDynamic"])
        assert component["envelope"]["toneAdsrSlave"] is False
