"""Seeded precision/jitter stage."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from synthesiser.schema import events_to_dicts, validate_event


@dataclass(slots=True)
class JitterConfig:
    pitch_cents: float = 0.0
    timing_ms: float = 0.0
    intensity_db: float = 0.0
    attack_ms: float = 0.0
    duration_ms: float = 0.0
    skip_probes: bool = True


class JitterStage:
    def __init__(self, config: JitterConfig | None = None) -> None:
        self.config = config or JitterConfig()

    def apply(self, events: list[Mapping], *, seed: int | None = None) -> list[dict]:
        rng = np.random.default_rng(seed)
        jittered: list[dict] = []
        for event in events_to_dicts(events):
            if self.config.skip_probes and event.get("kind") == "probe":
                jittered.append(event)
                continue

            updated = dict(event)
            tags = dict(updated.get("tags", {}))
            applied: dict[str, float] = {}

            if updated.get("pitch_hz") is not None and self.config.pitch_cents > 0:
                delta = float(rng.normal(0.0, self.config.pitch_cents))
                updated["pitch_hz"] = float(updated["pitch_hz"]) * (2.0 ** (delta / 1200.0))
                applied["pitch_cents"] = delta

            if self.config.timing_ms > 0:
                delta = float(rng.normal(0.0, self.config.timing_ms))
                updated["onset_s"] = max(0.0, float(updated["onset_s"]) + delta / 1000.0)
                applied["timing_ms"] = delta

            if self.config.intensity_db > 0:
                delta = float(rng.normal(0.0, self.config.intensity_db))
                updated["intensity_db"] = float(updated.get("intensity_db", 65.0)) + delta
                applied["intensity_db"] = delta

            if self.config.attack_ms > 0:
                delta = float(rng.normal(0.0, self.config.attack_ms))
                updated["attack_ms"] = max(0.0, float(updated.get("attack_ms", 0.0)) + delta)
                applied["attack_ms"] = delta

            if self.config.duration_ms > 0:
                delta = float(rng.normal(0.0, self.config.duration_ms))
                updated["duration_s"] = max(0.001, float(updated["duration_s"]) + delta / 1000.0)
                applied["duration_ms"] = delta

            if applied:
                tags["jitter"] = applied
                updated["tags"] = tags

            validate_event(updated)
            jittered.append(updated)
        return events_to_dicts(jittered)
