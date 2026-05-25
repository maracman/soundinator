"""Audio utility functions used by renderers and the pipeline."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from scipy.io import wavfile


def db_to_amplitude(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def peak_dbfs(audio: np.ndarray) -> float:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 0:
        return float("-inf")
    return float(20.0 * np.log10(peak))


def rms_dbfs(audio: np.ndarray) -> float:
    if not audio.size:
        return float("-inf")
    rms = float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))
    if rms <= 0:
        return float("-inf")
    return float(20.0 * np.log10(rms))


def normalise_loudness(audio: np.ndarray, sample_rate: int, target_lufs: float) -> tuple[np.ndarray, float]:
    """Normalise to LUFS when pyloudnorm exists, otherwise RMS-as-LUFS fallback."""

    try:
        import pyloudnorm as pyln  # type: ignore

        meter = pyln.Meter(sample_rate)
        measured = float(meter.integrated_loudness(audio))
        if np.isfinite(measured):
            return pyln.normalize.loudness(audio, measured, target_lufs).astype(np.float32), measured
    except Exception:
        pass

    measured = rms_dbfs(audio)
    if not np.isfinite(measured):
        return audio.astype(np.float32), measured
    gain = db_to_amplitude(float(target_lufs) - measured)
    return (audio * gain).astype(np.float32), measured


def limit_peak(audio: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    ceiling = db_to_amplitude(peak_db)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= ceiling or peak == 0.0:
        return audio.astype(np.float32)
    return (audio * (ceiling / peak)).astype(np.float32)


def adsr_envelope(
    duration_s: float,
    sample_rate: int,
    *,
    attack_ms: float,
    decay_ms: float,
    sustain_level: float,
    release_ms: float,
) -> np.ndarray:
    n = max(1, int(round(duration_s * sample_rate)))
    attack = max(0, int(round(attack_ms * sample_rate / 1000.0)))
    decay = max(0, int(round(decay_ms * sample_rate / 1000.0)))
    release = max(0, int(round(release_ms * sample_rate / 1000.0)))
    sustain = max(0, n - attack - decay - release)

    overflow = attack + decay + release - n
    if overflow > 0:
        scale = n / max(1, attack + decay + release)
        attack = int(round(attack * scale))
        decay = int(round(decay * scale))
        release = max(0, n - attack - decay)
        sustain = 0

    parts: list[np.ndarray] = []
    if attack:
        parts.append(np.linspace(0.0, 1.0, attack, endpoint=False))
    if decay:
        parts.append(np.linspace(1.0, sustain_level, decay, endpoint=False))
    if sustain:
        parts.append(np.full(sustain, sustain_level))
    if release:
        start = sustain_level if (decay or sustain) else 1.0
        parts.append(np.linspace(start, 0.0, release, endpoint=True))
    if not parts:
        return np.ones(n, dtype=np.float32)
    envelope = np.concatenate(parts).astype(np.float32)
    if len(envelope) < n:
        envelope = np.pad(envelope, (0, n - len(envelope)), constant_values=0.0)
    return envelope[:n]


def write_wav(path: Path, audio: np.ndarray, sample_rate: int, *, bit_depth: int = 24) -> str:
    """Write WAV, preferring soundfile for PCM_24 and falling back to scipy."""

    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(audio, -1.0, 1.0).astype(np.float32)
    try:
        import soundfile as sf  # type: ignore

        subtype = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}.get(bit_depth, "PCM_24")
        sf.write(path, clipped, sample_rate, subtype=subtype)
        return subtype
    except Exception:
        pcm16 = (clipped * np.iinfo(np.int16).max).astype(np.int16)
        wavfile.write(path, sample_rate, pcm16)
        return "PCM_16_FALLBACK"
