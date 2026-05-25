"""Probe and violation injection."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np

from synthesiser.schema import AcousticEvent, events_to_dicts, next_event_id


@dataclass(slots=True)
class StartleProbeConfig:
    placement: str = "on_beat"
    probe_count: int = 1
    duration_s: float = 0.05
    intensity_db: float = 100.0
    pre_beat_offset_s: float = -0.250
    off_beat_offset_s: float = 0.300
    timbre: str = "white_noise"


class ProbeInjector:
    """Inject startle probes into an existing event list."""

    VALID_PLACEMENTS = {"on_beat", "pre_beat", "off_beat"}

    def __init__(self, config: StartleProbeConfig | None = None) -> None:
        self.config = config or StartleProbeConfig()
        if self.config.placement not in self.VALID_PLACEMENTS:
            raise ValueError(f"unknown probe placement: {self.config.placement}")
        if self.config.probe_count < 0:
            raise ValueError("probe_count cannot be negative")

    def inject(
        self,
        events: list[AcousticEvent | Mapping],
        *,
        seed: int | None = None,
        eligible_tag: str = "beat_index",
    ) -> list[dict]:
        cfg = self.config
        serialised = events_to_dicts(events)
        eligible = [event for event in serialised if eligible_tag in event.get("tags", {})]
        if not eligible or cfg.probe_count == 0:
            return serialised

        rng = np.random.default_rng(seed)
        count = min(cfg.probe_count, len(eligible))
        chosen = sorted(rng.choice(np.arange(len(eligible)), size=count, replace=False).tolist())
        probes: list[AcousticEvent] = []
        for index, eligible_index in enumerate(chosen):
            anchor = eligible[eligible_index]
            onset = self._probe_onset(float(anchor["onset_s"]))
            if onset < 0:
                onset = 0.0
            probes.append(
                AcousticEvent(
                    event_id=next_event_id("probe", index),
                    onset_s=onset,
                    duration_s=cfg.duration_s,
                    kind="probe",
                    pitch_hz=None,
                    intensity_db=cfg.intensity_db,
                    velocity=1.0,
                    timbre=cfg.timbre,
                    attack_ms=0.5,
                    decay_ms=1.0,
                    sustain_level=1.0,
                    release_ms=1.0,
                    tags={
                        "probe": True,
                        "probe_type": "startle",
                        "placement": cfg.placement,
                        "anchor_event_id": anchor["event_id"],
                        "anchor_beat_index": anchor.get("tags", {}).get("beat_index"),
                        "trigger_code": self.trigger_code(cfg.placement),
                    },
                )
            )
        return events_to_dicts(serialised + [probe.to_dict() for probe in probes])

    def _probe_onset(self, anchor_onset_s: float) -> float:
        if self.config.placement == "on_beat":
            return anchor_onset_s
        if self.config.placement == "pre_beat":
            return anchor_onset_s + self.config.pre_beat_offset_s
        return anchor_onset_s + self.config.off_beat_offset_s

    @staticmethod
    def trigger_code(placement: str) -> int:
        return {"on_beat": 21, "pre_beat": 22, "off_beat": 23}[placement]


# ---------------------------------------------------------------------------
# Level-tagged violation injector (Modes D, G)
# ---------------------------------------------------------------------------

VIOLATION_TRIGGER_CODES: dict[str, int] = {
    "acoustic": 31,
    "pitch": 32,
    "motif": 33,
    "structural": 34,
    "mistuned": 35,
    "out_of_scale": 36,
}


@dataclass(slots=True)
class ViolationConfig:
    violation_type: str = "pitch"
    count: int = 4
    magnitude: float = 1.0
    deviation_cents: float = 100.0
    formant_deviation_hz: float = 400.0

    def __post_init__(self) -> None:
        if self.violation_type not in VIOLATION_TRIGGER_CODES:
            raise ValueError(
                f"unknown violation_type {self.violation_type!r}; "
                f"choose from {sorted(VIOLATION_TRIGGER_CODES)}"
            )


class ViolationInjector:
    """Insert level-tagged violations into an event list.

    Violation types and their ERP targets (per the experiment plan):
      - ``acoustic``: formant outlier → N100
      - ``pitch``: out-of-set pitch → P200
      - ``motif``: unexpected continuation → N400
      - ``structural``: premature theme return → P600
      - ``mistuned``: pitch drifted N cents from grid (Mode G)
      - ``out_of_scale``: pitch replaced by one outside the active set (Mode G)
    """

    def __init__(self, configs: list[ViolationConfig] | None = None) -> None:
        self.configs = configs or [ViolationConfig()]

    def inject(
        self,
        events: list[AcousticEvent | Mapping],
        pitch_system: "PitchSystem | None" = None,
        *,
        seed: int | None = None,
    ) -> list[dict]:
        from synthesiser.pitch import PitchSystem as _PS, cents_to_hz, hz_to_cents

        serialised = events_to_dicts(events)
        rng = np.random.default_rng(seed)
        tone_indices = [i for i, ev in enumerate(serialised) if ev.get("kind") == "tone"]
        if not tone_indices:
            return serialised

        for cfg in self.configs:
            count = min(cfg.count, len(tone_indices))
            if count <= 0:
                continue
            chosen = sorted(
                rng.choice(np.asarray(tone_indices), size=count, replace=False).tolist()
            )
            for target_idx in chosen:
                ev = dict(serialised[target_idx])
                tags = dict(ev.get("tags", {}))
                tags["violation"] = True
                tags["violation_type"] = cfg.violation_type
                tags["trigger_code"] = VIOLATION_TRIGGER_CODES[cfg.violation_type]

                if cfg.violation_type == "acoustic":
                    base_f1 = float(ev.get("formants", {}).get("f1_hz", 900.0))
                    direction = 1.0 if rng.random() > 0.5 else -1.0
                    ev["formants"] = {
                        "f1_hz": max(200.0, base_f1 + direction * cfg.formant_deviation_hz),
                        "bandwidth_hz": 120.0,
                    }
                    ev["timbre"] = "formant_noise"
                    tags["deviation_f1_hz"] = direction * cfg.formant_deviation_hz

                elif cfg.violation_type == "pitch":
                    if ev.get("pitch_hz") and pitch_system is not None:
                        all_lattice = set(range(pitch_system.octave_division))
                        active = set(pitch_system.active_degrees)
                        out_of_set = sorted(all_lattice - active)
                        if out_of_set:
                            degree = int(rng.choice(np.asarray(out_of_set)))
                            octave = ev["tags"].get("pitch_degree", 0) // len(pitch_system.active_degrees)
                            ev["pitch_hz"] = pitch_system.lattice_frequency(degree, octave)
                            tags["deviant_lattice_degree"] = degree

                elif cfg.violation_type == "motif":
                    if ev.get("pitch_hz") and pitch_system is not None:
                        n = len(pitch_system.active_degrees)
                        leap = int(rng.integers(max(2, n // 2), max(3, n)))
                        old_degree = tags.get("pitch_degree", 0)
                        new_degree = (old_degree + leap) % n
                        ev["pitch_hz"] = pitch_system.pitch_for_degree(new_degree, 0)
                        tags["original_degree"] = old_degree
                        tags["deviant_degree"] = new_degree

                elif cfg.violation_type == "structural":
                    tags["structural_violation"] = "premature_return"

                elif cfg.violation_type == "mistuned":
                    if ev.get("pitch_hz"):
                        direction = 1.0 if rng.random() > 0.5 else -1.0
                        delta = direction * cfg.deviation_cents
                        ref = 261.6255653005986
                        original_cents = hz_to_cents(float(ev["pitch_hz"]), ref)
                        ev["pitch_hz"] = cents_to_hz(original_cents + delta, ref)
                        tags["mistuning_cents"] = delta

                elif cfg.violation_type == "out_of_scale":
                    if ev.get("pitch_hz") and pitch_system is not None:
                        all_lattice = set(range(pitch_system.octave_division))
                        active = set(pitch_system.active_degrees)
                        out_of_set = sorted(all_lattice - active)
                        if out_of_set:
                            degree = int(rng.choice(np.asarray(out_of_set)))
                            ev["pitch_hz"] = pitch_system.lattice_frequency(degree, 0)
                            tags["deviant_lattice_degree"] = degree

                ev["tags"] = tags
                serialised[target_idx] = ev

            tone_indices = [i for i in tone_indices if i not in chosen]

        return events_to_dicts(serialised)
