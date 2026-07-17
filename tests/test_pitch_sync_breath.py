from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from scipy import signal
import soundfile as sf

from scripts.fit_profiles_from_samples import NoteAnalysis
from scripts.tone_match.assertions import ConstructionSample, evaluate_construction
from scripts.tone_match.pitch_sync_breath import (
    measure_pitch_sync_breath_file,
    synthetic_roundtrip,
    validate_engine_pairs,
)
from scripts.tone_match.score import FeatureBundle, compare_features


def _bundle(value: float | None) -> FeatureBundle:
    partials = np.asarray([1, .7, .5, .3, .2, .1], dtype=float)
    note = NoteAnalysis(
        "pitch-sync", 220.0, "A3", 1.0, partials,
        220 * np.arange(1, len(partials) + 1),
        np.ones(len(partials), dtype=bool), B=0.0)
    return FeatureBundle(
        note, 20 * np.log10(partials), np.zeros((48, 120)),
        np.full(120, 440.0), pitch_sync_breath_db=value)


def test_t067_synthetic_am_noise_roundtrip_meets_frequency_and_prominence_bars():
    result = synthetic_roundtrip(duration_s=3.0)
    assert result["status"] == "pass"
    assert result["errors"]["frequencyFraction"] <= .02
    assert result["errors"]["prominenceDb"] <= 1


def test_t067_lossy_reference_is_rejected_before_noise_floor_extraction(tmp_path):
    with pytest.raises(ValueError, match="lossless-only gate"):
        measure_pitch_sync_breath_file(tmp_path / "voice.mp3", 220.0)


def test_t067_score_and_construction_consume_rendered_observable():
    reference, good, absent = _bundle(12.0), _bundle(9.0), _bundle(1.0)
    distance = compare_features(reference, good)
    assert distance["features"]["pitch_sync_breath_db"] == 3
    assert distance["weights"]["pitch_sync_breath_db"] == 0
    good_gate = evaluate_construction(
        "voice-tenor", [ConstructionSample(good, reference)], params={
            "excitationType": "blow", "glottalTilt": .2,
            "singerFormantAmount": .2, "voiceBreathSync": .8,
        }, strict_evidence=False)
    absent_gate = evaluate_construction(
        "voice-tenor", [ConstructionSample(absent, reference)], params={
            "excitationType": "blow", "glottalTilt": .2,
            "singerFormantAmount": .2, "voiceBreathSync": .8,
        }, strict_evidence=False)
    by_id = lambda gate: {row["id"]: row for row in gate["assertions"]}
    assert by_id(good_gate)["tenor.pitch-sync-breath"]["status"] == "pass"
    assert by_id(absent_gate)["tenor.pitch-sync-breath"]["status"] == "fail"


def test_t067_partial_muted_same_seed_engine_pair_consumes_octave(tmp_path):
    sample_rate, duration, seed = 24_000, 2.5, 61061
    times = np.arange(round(sample_rate * duration)) / sample_rate
    def noise() -> np.ndarray:
        raw = np.random.default_rng(seed).standard_normal(times.size)
        return signal.sosfiltfilt(signal.butter(
            4, [350 / (sample_rate / 2), 9500 / (sample_rate / 2)],
            btype="bandpass", output="sos"), raw) * .08
    paths = [tmp_path / name for name in ("zero.wav", "low.wav", "high.wav")]
    sf.write(paths[0], noise(), sample_rate, subtype="FLOAT")
    sf.write(paths[1], noise() * (1 + .52 * np.sin(2 * np.pi * 220 * times)),
             sample_rate, subtype="FLOAT")
    sf.write(paths[2], noise() * (1 + .52 * np.sin(2 * np.pi * 440 * times)),
             sample_rate, subtype="FLOAT")
    muted = [0.0] * 32
    jobs = []
    for path, midi, sync in zip(paths, (57, 57, 69), (0, .8, .8)):
        jobs.append({
            "out": str(path), "midi": midi,
            "params": {
                "seed": seed, "voiceBreathSync": sync,
                "spectralPartialMeans": muted,
                "spectralPartialSds": muted,
                "spectralPartialsByRegisterDynamic": {"rows": []},
            },
        })
    manifest = tmp_path / "jobs.json"
    manifest.write_text(json.dumps(jobs))
    result = validate_engine_pairs(
        paths[0], paths[1], paths[2], f0_low_hz=220,
        f0_high_hz=440, seed=seed, render_manifest=manifest)
    assert result["status"] == "pass"
    assert all(result["checks"].values())

