"""Symbolic event generation.

Layers L1–L4 correspond to the hierarchical timescales described in the
experiment plan: beat → motif → phrase → form.  Each layer is a class with a
``generate`` method that returns ``list[AcousticEvent]``.  Layers can be
composed via :class:`HierarchicalSequencer` or used independently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from synthesiser.pitch import PitchSystem
from synthesiser.schema import AcousticEvent, next_event_id


@dataclass(slots=True)
class L1BeatConfig:
    tempo_bpm: float = 100.0
    beats: int = 32
    note_duration_fraction: float = 0.42
    accent_pattern: tuple[float, ...] = (1.0, 0.72, 0.82, 0.72)
    pitch_degree: int = 0
    octave: int = 0
    timbre: str = "sine"
    intensity_db: float = 65.0
    attack_ms: float = 8.0
    release_ms: float = 24.0


class L1BeatSequencer:
    """Isochronous beat generator used by Mode C."""

    def __init__(self, config: L1BeatConfig | None = None) -> None:
        self.config = config or L1BeatConfig()
        if self.config.tempo_bpm <= 0:
            raise ValueError("tempo_bpm must be positive")
        if self.config.beats < 1:
            raise ValueError("beats must be positive")

    @property
    def beat_interval_s(self) -> float:
        return 60.0 / self.config.tempo_bpm

    def generate(self, pitch_system: PitchSystem) -> list[AcousticEvent]:
        cfg = self.config
        duration = self.beat_interval_s * cfg.note_duration_fraction
        events: list[AcousticEvent] = []
        for beat in range(cfg.beats):
            accent = cfg.accent_pattern[beat % len(cfg.accent_pattern)]
            events.append(
                AcousticEvent(
                    event_id=next_event_id("beat", beat),
                    onset_s=beat * self.beat_interval_s,
                    duration_s=duration,
                    kind="tone",
                    pitch_hz=pitch_system.pitch_for_degree(cfg.pitch_degree, cfg.octave),
                    intensity_db=cfg.intensity_db,
                    velocity=float(accent),
                    timbre=cfg.timbre,
                    attack_ms=cfg.attack_ms,
                    release_ms=cfg.release_ms,
                    tags={
                        "layer": "L1",
                        "beat_index": beat,
                        "beat_phase": "onset",
                        "pitch_degree": cfg.pitch_degree,
                    },
                )
            )
        return events


@dataclass(slots=True)
class MarkovMotifConfig:
    steps: int = 64
    order: int = 1
    entropy: float = 0.65
    tempo_bpm: float = 100.0
    note_duration_fraction: float = 0.46
    octave: int = 0
    timbre: str = "triangle"
    intensity_db: float = 65.0


class MarkovMotifSequencer:
    """Small L2 Markov generator for Tier 2-facing tests and demos."""

    def __init__(self, config: MarkovMotifConfig | None = None) -> None:
        self.config = config or MarkovMotifConfig()
        if self.config.order != 1:
            raise NotImplementedError("only first-order Markov motifs are implemented")
        if not 0.0 <= self.config.entropy <= 1.0:
            raise ValueError("entropy must be in [0, 1]")

    @property
    def step_interval_s(self) -> float:
        return 60.0 / self.config.tempo_bpm

    def transition_matrix(self, pitch_system: PitchSystem) -> np.ndarray:
        """Create a controllable-entropy transition matrix.

        Entropy 0 strongly favours stepwise/local motion and tonic return.
        Entropy 1 is uniform over the active scale.
        """

        n = len(pitch_system.active_degrees)
        uniform = np.full((n, n), 1.0 / n)
        structured = np.zeros((n, n), dtype=float)
        for row in range(n):
            distances = np.abs(np.arange(n) - row)
            distances = np.minimum(distances, n - distances)
            local = np.exp(-distances)
            local[0] += 0.8 if row != 0 else 0.2
            structured[row] = local / local.sum()
        mix = self.config.entropy
        matrix = (1.0 - mix) * structured + mix * uniform
        return matrix / matrix.sum(axis=1, keepdims=True)

    def generate(self, pitch_system: PitchSystem, seed: int | None = None) -> list[AcousticEvent]:
        cfg = self.config
        rng = np.random.default_rng(seed)
        matrix = self.transition_matrix(pitch_system)
        current = pitch_system.sample_degree(rng)
        duration = self.step_interval_s * cfg.note_duration_fraction
        events: list[AcousticEvent] = []
        for step in range(cfg.steps):
            current = int(rng.choice(np.arange(matrix.shape[1]), p=matrix[current]))
            events.append(
                AcousticEvent(
                    event_id=next_event_id("motif", step),
                    onset_s=step * self.step_interval_s,
                    duration_s=duration,
                    kind="tone",
                    pitch_hz=pitch_system.pitch_for_degree(current, cfg.octave),
                    intensity_db=cfg.intensity_db,
                    timbre=cfg.timbre,
                    tags={"layer": "L2", "step_index": step, "pitch_degree": current},
                )
            )
        return events


def empirical_entropy_bits(values: Sequence[int | str]) -> float:
    if not values:
        return 0.0
    _, counts = np.unique(np.asarray(values), return_counts=True)
    probabilities = counts / counts.sum()
    return float(-(probabilities * np.log2(probabilities)).sum())


# ---------------------------------------------------------------------------
# L3 — Phrase sequencer
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class L3PhraseConfig:
    motif_vocabulary_size: int = 4
    motif_steps: int = 8
    motif_entropy: float = 0.65
    motifs_per_phrase: int = 4
    phrase_count: int = 4
    repetition_probability: float = 0.3
    call_and_response: bool = False
    tempo_bpm: float = 100.0
    note_duration_fraction: float = 0.46
    octave: int = 0
    timbre: str = "triangle"
    intensity_db: float = 65.0


class L3PhraseSequencer:
    """Arrange motifs drawn from a vocabulary into phrases.

    Each motif in the vocabulary is a sequence of ``(scale_degree, relative_onset_s)``
    pairs generated via a first-order Markov chain.  Phrases are built by
    selecting motifs from the vocabulary, with *repetition_probability*
    controlling how often the previous motif is reused.  When *call_and_response*
    is enabled, odd-numbered motif positions within a phrase receive a
    transformation (transpose, invert, or retrograde) of the preceding motif.
    """

    def __init__(self, config: L3PhraseConfig | None = None) -> None:
        self.config = config or L3PhraseConfig()
        if self.config.motif_vocabulary_size < 1:
            raise ValueError("motif_vocabulary_size must be positive")

    @property
    def step_interval_s(self) -> float:
        return 60.0 / self.config.tempo_bpm

    @property
    def motif_duration_s(self) -> float:
        return self.step_interval_s * self.config.motif_steps

    def _transition_matrix(self, n: int) -> np.ndarray:
        uniform = np.full((n, n), 1.0 / n)
        structured = np.zeros((n, n), dtype=float)
        for row in range(n):
            distances = np.abs(np.arange(n) - row)
            distances = np.minimum(distances, n - distances)
            local = np.exp(-distances)
            local[0] += 0.8 if row != 0 else 0.2
            structured[row] = local / local.sum()
        mix = self.config.motif_entropy
        matrix = (1.0 - mix) * structured + mix * uniform
        return matrix / matrix.sum(axis=1, keepdims=True)

    def _build_vocabulary(
        self, pitch_system: PitchSystem, rng: np.random.Generator,
    ) -> list[list[tuple[int, float]]]:
        n = len(pitch_system.active_degrees)
        matrix = self._transition_matrix(n)
        vocabulary: list[list[tuple[int, float]]] = []
        for _ in range(self.config.motif_vocabulary_size):
            current = pitch_system.sample_degree(rng)
            pattern: list[tuple[int, float]] = []
            for step in range(self.config.motif_steps):
                current = int(rng.choice(np.arange(n), p=matrix[current]))
                pattern.append((current, step * self.step_interval_s))
            vocabulary.append(pattern)
        return vocabulary

    @staticmethod
    def _transform_motif(
        pattern: list[tuple[int, float]],
        n_degrees: int,
        rng: np.random.Generator,
    ) -> list[tuple[int, float]]:
        kind = rng.choice(np.array([0, 1, 2]))
        if kind == 0:
            shift = int(rng.integers(1, max(2, n_degrees)))
            return [((d + shift) % n_degrees, t) for d, t in pattern]
        if kind == 1:
            pivot = pattern[0][0] if pattern else 0
            return [((2 * pivot - d) % n_degrees, t) for d, t in pattern]
        max_t = max((t for _, t in pattern), default=0.0)
        return [(d, max_t - t) for d, t in reversed(pattern)]

    def generate(
        self, pitch_system: PitchSystem, *, seed: int | None = None,
    ) -> list[AcousticEvent]:
        cfg = self.config
        rng = np.random.default_rng(seed)
        vocabulary = self._build_vocabulary(pitch_system, rng)
        note_dur = self.step_interval_s * cfg.note_duration_fraction
        n_deg = len(pitch_system.active_degrees)

        events: list[AcousticEvent] = []
        idx = 0
        time_cursor = 0.0

        for phrase_idx in range(cfg.phrase_count):
            last_motif: int | None = None
            for motif_pos in range(cfg.motifs_per_phrase):
                if last_motif is not None and rng.random() < cfg.repetition_probability:
                    motif_idx = last_motif
                    pattern = list(vocabulary[motif_idx])
                    if cfg.call_and_response and motif_pos % 2 == 1:
                        pattern = self._transform_motif(pattern, n_deg, rng)
                else:
                    motif_idx = int(rng.integers(len(vocabulary)))
                    pattern = list(vocabulary[motif_idx])

                for degree, rel_onset in pattern:
                    events.append(
                        AcousticEvent(
                            event_id=next_event_id("phr", idx),
                            onset_s=time_cursor + rel_onset,
                            duration_s=note_dur,
                            kind="tone",
                            pitch_hz=pitch_system.pitch_for_degree(degree, cfg.octave),
                            intensity_db=cfg.intensity_db,
                            timbre=cfg.timbre,
                            tags={
                                "layer": "L3",
                                "phrase_index": phrase_idx,
                                "motif_position": motif_pos,
                                "motif_vocab_index": motif_idx,
                                "pitch_degree": degree,
                                "step_index": idx,
                            },
                        )
                    )
                    idx += 1
                time_cursor += self.motif_duration_s
                last_motif = motif_idx
        return events


# ---------------------------------------------------------------------------
# L4 — Form sequencer
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class L4FormConfig:
    schedule: str = "AABA"
    inter_section_s: float = 1.0
    theme_transformation_amount: float = 0.0
    motif_vocabulary_size: int = 4
    motif_steps: int = 8
    motif_entropy: float = 0.65
    motifs_per_phrase: int = 4
    phrases_per_section: int = 2
    repetition_probability: float = 0.3
    tempo_bpm: float = 100.0
    note_duration_fraction: float = 0.46
    octave: int = 0
    timbre: str = "triangle"
    intensity_db: float = 65.0


class L4FormSequencer:
    """Generate form-level structure from an explicit section schedule.

    Each unique letter in *schedule* gets a deterministic phrase realisation.
    When a letter recurs the same phrase is replayed (with optional
    transformation controlled by *theme_transformation_amount*).
    """

    def __init__(self, config: L4FormConfig | None = None) -> None:
        self.config = config or L4FormConfig()
        if not self.config.schedule:
            raise ValueError("schedule must not be empty")

    def _section_labels(self) -> list[str]:
        return list(self.config.schedule.upper())

    def _phrase_config(self) -> L3PhraseConfig:
        cfg = self.config
        return L3PhraseConfig(
            motif_vocabulary_size=cfg.motif_vocabulary_size,
            motif_steps=cfg.motif_steps,
            motif_entropy=cfg.motif_entropy,
            motifs_per_phrase=cfg.motifs_per_phrase,
            phrase_count=cfg.phrases_per_section,
            repetition_probability=cfg.repetition_probability,
            tempo_bpm=cfg.tempo_bpm,
            note_duration_fraction=cfg.note_duration_fraction,
            octave=cfg.octave,
            timbre=cfg.timbre,
            intensity_db=cfg.intensity_db,
        )

    def generate(
        self, pitch_system: PitchSystem, *, seed: int | None = None,
    ) -> list[AcousticEvent]:
        cfg = self.config
        rng = np.random.default_rng(seed)
        labels = self._section_labels()
        unique = sorted(set(labels))

        section_seeds: dict[str, int] = {
            label: int(rng.integers(2**31)) for label in unique
        }

        phrase_cfg = self._phrase_config()
        all_events: list[AcousticEvent] = []
        time_cursor = 0.0
        global_idx = 0

        for section_idx, label in enumerate(labels):
            section_events = L3PhraseSequencer(phrase_cfg).generate(
                pitch_system, seed=section_seeds[label],
            )
            if cfg.theme_transformation_amount > 0 and labels[:section_idx].count(label) > 0:
                section_events = self._apply_theme_transform(
                    section_events, pitch_system, cfg.theme_transformation_amount, rng,
                )

            for ev in section_events:
                all_events.append(
                    AcousticEvent(
                        event_id=next_event_id("form", global_idx),
                        onset_s=ev.onset_s + time_cursor,
                        duration_s=ev.duration_s,
                        kind=ev.kind,
                        pitch_hz=ev.pitch_hz,
                        intensity_db=ev.intensity_db,
                        velocity=ev.velocity,
                        timbre=ev.timbre,
                        attack_ms=ev.attack_ms,
                        decay_ms=ev.decay_ms,
                        sustain_level=ev.sustain_level,
                        release_ms=ev.release_ms,
                        tags={
                            **ev.tags,
                            "layer": "L4",
                            "section_index": section_idx,
                            "section_label": label,
                            "form_schedule": cfg.schedule,
                        },
                    )
                )
                global_idx += 1

            section_dur = (
                max(ev.onset_s + ev.duration_s for ev in section_events)
                if section_events
                else 0.0
            )
            time_cursor += section_dur + cfg.inter_section_s

        return all_events

    @staticmethod
    def _apply_theme_transform(
        events: list[AcousticEvent],
        pitch_system: PitchSystem,
        amount: float,
        rng: np.random.Generator,
    ) -> list[AcousticEvent]:
        if not events or amount <= 0:
            return events
        n_to_alter = max(1, int(len(events) * amount))
        indices = rng.choice(np.arange(len(events)), size=min(n_to_alter, len(events)), replace=False)
        n_deg = len(pitch_system.active_degrees)
        shift = int(rng.integers(1, max(2, n_deg)))
        transformed = list(events)
        for i in indices:
            ev = transformed[int(i)]
            if ev.pitch_hz is not None:
                degree = (ev.tags.get("pitch_degree", 0) + shift) % n_deg
                transformed[int(i)] = AcousticEvent(
                    event_id=ev.event_id,
                    onset_s=ev.onset_s,
                    duration_s=ev.duration_s,
                    kind=ev.kind,
                    pitch_hz=pitch_system.pitch_for_degree(degree, pitch_system.tonic_hz),
                    intensity_db=ev.intensity_db,
                    velocity=ev.velocity,
                    timbre=ev.timbre,
                    attack_ms=ev.attack_ms,
                    decay_ms=ev.decay_ms,
                    sustain_level=ev.sustain_level,
                    release_ms=ev.release_ms,
                    tags={**ev.tags, "pitch_degree": degree, "theme_transformed": True},
                )
        return transformed


# ---------------------------------------------------------------------------
# Hierarchical sequencer — combines L1–L4 with selective enabling
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class HierarchicalConfig:
    enable_beat: bool = True
    enable_motif: bool = True
    enable_phrase: bool = True
    enable_form: bool = True
    beat: L1BeatConfig = field(default_factory=L1BeatConfig)
    motif: MarkovMotifConfig = field(default_factory=MarkovMotifConfig)
    phrase: L3PhraseConfig = field(default_factory=L3PhraseConfig)
    form: L4FormConfig = field(default_factory=L4FormConfig)


class HierarchicalSequencer:
    """Compose L1–L4 layers with selective enabling.

    Generation starts at the highest enabled layer and falls through.
    Disabling a layer removes its structural repetition while keeping the
    timing and note content from lower layers.  This powers Mode H's
    six conditions.
    """

    def __init__(self, config: HierarchicalConfig | None = None) -> None:
        self.config = config or HierarchicalConfig()

    def generate(
        self, pitch_system: PitchSystem, *, seed: int | None = None,
    ) -> list[AcousticEvent]:
        cfg = self.config
        rng = np.random.default_rng(seed)

        if cfg.enable_form:
            return L4FormSequencer(cfg.form).generate(
                pitch_system, seed=int(rng.integers(2**31)),
            )
        if cfg.enable_phrase:
            return L3PhraseSequencer(cfg.phrase).generate(
                pitch_system, seed=int(rng.integers(2**31)),
            )
        if cfg.enable_motif:
            return MarkovMotifSequencer(cfg.motif).generate(
                pitch_system, seed=int(rng.integers(2**31)),
            )
        if cfg.enable_beat:
            return L1BeatSequencer(cfg.beat).generate(pitch_system)
        return []
