"""Offline pitched renderer for Modes C, D, F, G, and H."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
from scipy import signal

from synthesiser.audio import adsr_envelope
from synthesiser.renderers.base import Renderer
from synthesiser.schema import events_to_dicts


@dataclass(slots=True)
class PitchedRendererConfig:
    sample_rate: int = 48_000
    tail_s: float = 0.15
    reference_intensity_db: float = 65.0
    random_seed: int = 0


class PitchedRenderer(Renderer):
    name = "pitched"

    def __init__(self, config: PitchedRendererConfig | None = None) -> None:
        self.config = config or PitchedRendererConfig()

    @property
    def sample_rate(self) -> int:
        return self.config.sample_rate

    def render(self, events: list[Mapping]) -> np.ndarray:
        serialised = events_to_dicts(events)
        if not serialised:
            return np.zeros(0, dtype=np.float32)

        end_s = max(float(event["onset_s"]) + float(event["duration_s"]) for event in serialised)
        total_samples = int(np.ceil((end_s + self.config.tail_s) * self.sample_rate))
        output = np.zeros(total_samples, dtype=np.float32)
        rng = np.random.default_rng(self.config.random_seed)

        for event in serialised:
            start = int(round(float(event["onset_s"]) * self.sample_rate))
            duration_s = float(event["duration_s"])
            n = max(1, int(round(duration_s * self.sample_rate)))
            carrier = self._carrier(event, n, rng)
            envelope = adsr_envelope(
                duration_s,
                self.sample_rate,
                attack_ms=float(event.get("attack_ms", 8.0)),
                decay_ms=float(event.get("decay_ms", 20.0)),
                sustain_level=float(event.get("sustain_level", 0.85)),
                release_ms=float(event.get("release_ms", 20.0)),
            )
            gain = float(event.get("velocity", 1.0))
            gain *= 10.0 ** ((float(event.get("intensity_db", 65.0)) - self.config.reference_intensity_db) / 20.0)
            segment = (carrier[:n] * envelope[:n] * gain).astype(np.float32)
            stop = min(total_samples, start + len(segment))
            if stop > start:
                output[start:stop] += segment[: stop - start]

        return output.astype(np.float32)

    def _carrier(self, event: Mapping, n: int, rng: np.random.Generator) -> np.ndarray:
        timbre = str(event.get("timbre", "sine"))
        if event.get("kind") == "probe" or timbre == "white_noise":
            return rng.uniform(-1.0, 1.0, n).astype(np.float32)

        pitch_hz = float(event["pitch_hz"])
        t = np.arange(n, dtype=np.float64) / self.sample_rate

        if timbre == "sine":
            return np.sin(2.0 * np.pi * pitch_hz * t).astype(np.float32)
        if timbre == "triangle":
            return signal.sawtooth(2.0 * np.pi * pitch_hz * t, width=0.5).astype(np.float32)
        if timbre == "additive_piano":
            partials = np.zeros(n, dtype=np.float64)
            for harmonic, weight in ((1, 1.0), (2, 0.42), (3, 0.22), (4, 0.12), (5, 0.07)):
                partials += weight * np.sin(2.0 * np.pi * pitch_hz * harmonic * t)
            return (partials / max(1.0, np.max(np.abs(partials)))).astype(np.float32)
        if timbre == "formant_noise":
            noise = rng.normal(0.0, 0.35, n)
            formant_hz = float(event.get("formants", {}).get("f1_hz", 900.0))
            bandwidth_hz = float(event.get("formants", {}).get("bandwidth_hz", 120.0))
            q = max(0.1, formant_hz / bandwidth_hz)
            b, a = signal.iirpeak(formant_hz, q, fs=self.sample_rate)
            filtered = signal.lfilter(b, a, noise)
            peak = np.max(np.abs(filtered))
            if peak > 0:
                filtered = filtered / peak
            return filtered.astype(np.float32)

        raise ValueError(f"unsupported timbre: {timbre}")
