"""Vocalisation renderer — LF glottal source, formant cascade, aspiration noise.

This is the Tier 3 audio backend for Modes A, B, and E.  The source–filter
model drives a Liljencrants-Fant glottal-pulse generator through a cascade of
three bandpass filters representing the vocal-tract resonances F1–F3.

The implementation prioritises *parametric clarity* over naturalism: every
acoustic feature is independently addressable so that the experiment plan's
requirements (independent control of F0, formant frequencies, voice quality,
aspiration, vibrato, and amplitude envelope) are met directly.

References:
  Fant, G. (1995). The LF-model revisited.  STL-QPSR, 36(2-3), 119-156.
  Drugman, T., et al. (2012). Glottal source modelling.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
from scipy import signal as sig

from synthesiser.audio import adsr_envelope
from synthesiser.renderers.base import Renderer
from synthesiser.schema import events_to_dicts


# ---------------------------------------------------------------------------
# Voice quality presets — LF model parameter sets
# ---------------------------------------------------------------------------

_VOICE_QUALITY = {
    "modal": {"open_quotient": 0.55, "speed_quotient": 2.5, "return_phase": 0.10},
    "breathy": {"open_quotient": 0.72, "speed_quotient": 1.8, "return_phase": 0.20},
    "pressed": {"open_quotient": 0.38, "speed_quotient": 3.5, "return_phase": 0.05},
}


def _lf_glottal_pulse(
    n_samples: int,
    f0_hz: float,
    sample_rate: int,
    *,
    open_quotient: float = 0.55,
    speed_quotient: float = 2.5,
    return_phase: float = 0.10,
) -> np.ndarray:
    """Generate one or more periods of the LF glottal flow derivative.

    Simplified LF model: the open phase is a damped sinusoid and the return
    phase is an exponential recovery.  The waveform is normalised to [-1, 1].
    """

    period = sample_rate / max(f0_hz, 20.0)
    t_open = open_quotient * period
    t_return = return_phase * period
    t_peak = t_open / (1.0 + speed_quotient)

    output = np.zeros(n_samples, dtype=np.float64)
    pos = 0.0
    while int(pos) < n_samples:
        cycle_len = int(round(period))
        for i in range(cycle_len):
            idx = int(pos) + i
            if idx >= n_samples:
                break
            t = float(i)
            if t < t_open:
                omega = np.pi / max(t_peak, 1.0)
                alpha = 3.0 / max(t_open, 1.0)
                output[idx] = np.exp(-alpha * t) * np.sin(omega * t)
            elif t < t_open + t_return:
                frac = (t - t_open) / max(t_return, 1.0)
                output[idx] = -np.exp(-5.0 * frac)
            else:
                output[idx] = 0.0
        pos += period

    peak = np.max(np.abs(output))
    if peak > 0:
        output /= peak
    return output.astype(np.float64)


def _apply_vibrato(
    f0_contour: np.ndarray,
    sample_rate: int,
    rate_hz: float,
    depth_cents: float,
) -> np.ndarray:
    if depth_cents <= 0 or rate_hz <= 0:
        return f0_contour
    t = np.arange(len(f0_contour), dtype=np.float64) / sample_rate
    modulation = 2.0 ** (depth_cents / 1200.0 * np.sin(2.0 * np.pi * rate_hz * t))
    return f0_contour * modulation


def _formant_cascade(
    source: np.ndarray,
    sample_rate: int,
    formants: list[tuple[float, float]],
) -> np.ndarray:
    """Apply a cascade of biquad bandpass filters for F1, F2, F3.

    Each entry in *formants* is ``(centre_hz, bandwidth_hz)``.
    """

    filtered = source.copy()
    for centre_hz, bandwidth_hz in formants:
        if centre_hz <= 0 or centre_hz >= sample_rate / 2:
            continue
        q = max(0.5, centre_hz / max(bandwidth_hz, 1.0))
        b, a = sig.iirpeak(float(centre_hz), float(q), fs=sample_rate)
        filtered = sig.lfilter(b, a, filtered)
    peak = np.max(np.abs(filtered))
    if peak > 0:
        filtered = filtered / peak
    return filtered


def _aspiration_noise(
    n_samples: int,
    glottal_flow: np.ndarray,
    level_db: float,
    sample_rate: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Bandpass-filtered noise modulated by the inverse of glottal flow."""

    noise = rng.normal(0.0, 0.3, n_samples)
    b_bp, a_bp = sig.butter(2, [300.0, 3000.0], btype="band", fs=sample_rate)
    noise = sig.lfilter(b_bp, a_bp, noise)
    modulator = 1.0 - np.clip(np.abs(glottal_flow), 0.0, 1.0)
    gain = 10.0 ** (level_db / 20.0)
    return (noise * modulator * gain).astype(np.float64)


def _pitch_contour(
    n_samples: int,
    base_f0: float,
    contour_shape: str,
    excursion_semitones: float,
    sample_rate: int,
) -> np.ndarray:
    """Generate an F0 contour over the note duration."""

    t_norm = np.linspace(0.0, 1.0, n_samples)
    if contour_shape == "rising":
        semitone_offset = excursion_semitones * t_norm
    elif contour_shape == "falling":
        semitone_offset = excursion_semitones * (1.0 - t_norm)
    elif contour_shape == "arc":
        semitone_offset = excursion_semitones * np.sin(np.pi * t_norm)
    else:
        semitone_offset = np.zeros(n_samples)
    return base_f0 * (2.0 ** (semitone_offset / 12.0))


# ---------------------------------------------------------------------------
# Renderer
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class VocalisationRendererConfig:
    sample_rate: int = 48_000
    tail_s: float = 0.15
    reference_intensity_db: float = 65.0
    random_seed: int = 0


class VocalisationRenderer(Renderer):
    """Source–filter vocalisation renderer for Modes A, B, and E.

    Event tags consumed beyond the standard AcousticEvent fields:

      - ``voice_quality``: ``"modal"`` | ``"breathy"`` | ``"pressed"``
      - ``contour_shape``: ``"flat"`` | ``"rising"`` | ``"falling"`` | ``"arc"``
      - ``contour_excursion_st``: float (semitones)
      - ``vibrato_rate_hz``: float
      - ``vibrato_depth_cents``: float
      - ``aspiration_db``: float (dB relative to source)
      - ``f1_hz``, ``f2_hz``, ``f3_hz``: formant centres
      - ``f1_bw``, ``f2_bw``, ``f3_bw``: formant bandwidths
    """

    name = "vocalisation"

    def __init__(self, config: VocalisationRendererConfig | None = None) -> None:
        self.config = config or VocalisationRendererConfig()

    @property
    def sample_rate(self) -> int:
        return self.config.sample_rate

    def render(self, events: list[Mapping]) -> np.ndarray:
        serialised = events_to_dicts(events)
        if not serialised:
            return np.zeros(0, dtype=np.float32)

        sr = self.config.sample_rate
        end_s = max(float(ev["onset_s"]) + float(ev["duration_s"]) for ev in serialised)
        total = int(np.ceil((end_s + self.config.tail_s) * sr))
        output = np.zeros(total, dtype=np.float64)
        rng = np.random.default_rng(self.config.random_seed)

        for ev in serialised:
            if ev.get("kind") == "probe":
                segment = self._render_probe(ev, rng)
            else:
                segment = self._render_vocalisation(ev, rng)

            start = int(round(float(ev["onset_s"]) * sr))
            n = len(segment)
            stop = min(total, start + n)
            if stop > start:
                output[start:stop] += segment[: stop - start]

        return output.astype(np.float32)

    def _render_vocalisation(self, ev: Mapping, rng: np.random.Generator) -> np.ndarray:
        sr = self.config.sample_rate
        duration_s = float(ev["duration_s"])
        n = max(1, int(round(duration_s * sr)))

        base_f0 = float(ev.get("pitch_hz", 220.0))
        tags = ev.get("tags", {})

        contour_shape = str(tags.get("contour_shape", "flat"))
        excursion_st = float(tags.get("contour_excursion_st", 0.0))
        f0_contour = _pitch_contour(n, base_f0, contour_shape, excursion_st, sr)

        vibrato_rate = float(tags.get("vibrato_rate_hz", 0.0))
        vibrato_depth = float(tags.get("vibrato_depth_cents", 0.0))
        f0_contour = _apply_vibrato(f0_contour, sr, vibrato_rate, vibrato_depth)

        voice_quality = str(tags.get("voice_quality", "modal"))
        vq = _VOICE_QUALITY.get(voice_quality, _VOICE_QUALITY["modal"])

        glottal = _lf_glottal_pulse(n, float(np.mean(f0_contour)), sr, **vq)

        if len(f0_contour) > 1:
            mean_f0 = float(np.mean(f0_contour))
            if mean_f0 > 0:
                pitch_mod = f0_contour / mean_f0
                t_source = np.arange(n, dtype=np.float64) / sr
                phase = np.cumsum(pitch_mod) / sr * mean_f0
                period = sr / mean_f0
                source_idx = (phase * period).astype(np.int64) % max(1, int(period))
                glottal_full = _lf_glottal_pulse(int(period) + 1, mean_f0, sr, **vq)
                glottal = glottal_full[np.clip(source_idx, 0, len(glottal_full) - 1)]

        f1 = float(tags.get("f1_hz", 700.0))
        f2 = float(tags.get("f2_hz", 1200.0))
        f3 = float(tags.get("f3_hz", 2600.0))
        f1_bw = float(tags.get("f1_bw", 130.0))
        f2_bw = float(tags.get("f2_bw", 70.0))
        f3_bw = float(tags.get("f3_bw", 160.0))
        formants = [(f1, f1_bw), (f2, f2_bw), (f3, f3_bw)]

        voiced = _formant_cascade(glottal[:n], sr, formants)

        aspiration_db = float(tags.get("aspiration_db", -20.0))
        aspiration = _aspiration_noise(n, glottal[:n], aspiration_db, sr, rng)

        mixed = voiced + aspiration

        envelope = adsr_envelope(
            duration_s, sr,
            attack_ms=float(ev.get("attack_ms", 15.0)),
            decay_ms=float(ev.get("decay_ms", 30.0)),
            sustain_level=float(ev.get("sustain_level", 0.8)),
            release_ms=float(ev.get("release_ms", 40.0)),
        )

        gain = float(ev.get("velocity", 1.0))
        gain *= 10.0 ** (
            (float(ev.get("intensity_db", 65.0)) - self.config.reference_intensity_db) / 20.0
        )
        segment = (mixed[:n] * envelope[:n] * gain).astype(np.float64)

        peak = np.max(np.abs(segment))
        if peak > 1.0:
            segment /= peak
        return segment

    def _render_probe(self, ev: Mapping, rng: np.random.Generator) -> np.ndarray:
        sr = self.config.sample_rate
        n = max(1, int(round(float(ev["duration_s"]) * sr)))
        noise = rng.uniform(-1.0, 1.0, n)
        gain = float(ev.get("velocity", 1.0))
        gain *= 10.0 ** (
            (float(ev.get("intensity_db", 100.0)) - self.config.reference_intensity_db) / 20.0
        )
        envelope = adsr_envelope(
            float(ev["duration_s"]), sr,
            attack_ms=float(ev.get("attack_ms", 0.5)),
            decay_ms=float(ev.get("decay_ms", 1.0)),
            sustain_level=1.0,
            release_ms=float(ev.get("release_ms", 1.0)),
        )
        return (noise * envelope[:n] * gain).astype(np.float64)
