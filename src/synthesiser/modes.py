"""Mode-level assembly functions for the nine experiment modes.

Each mode is a self-contained sub-experiment described in the companion
*Experiment Plan*.  Functions here wire the symbolic generator, jitter stage,
probe/violation injectors, and pitch system together for each mode and return
a validated event list ready for rendering.

Modes A–H produce pre-rendered stimuli.  Mode I produces an event list and
OSC parameter specification for the real-time SuperCollider engine.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from synthesiser.jitter import JitterConfig, JitterStage
from synthesiser.pitch import PitchSystem
from synthesiser.probe import (
    ProbeInjector,
    StartleProbeConfig,
    ViolationConfig,
    ViolationInjector,
)
from synthesiser.schema import AcousticEvent, events_to_dicts, next_event_id
from synthesiser.sequencer import (
    HierarchicalConfig,
    HierarchicalSequencer,
    L1BeatConfig,
    L1BeatSequencer,
    L3PhraseConfig,
    L3PhraseSequencer,
    L4FormConfig,
    L4FormSequencer,
    MarkovMotifConfig,
    MarkovMotifSequencer,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _pitch_system_meta(ps: PitchSystem) -> dict[str, Any]:
    return {
        "tonic_hz": ps.tonic_hz,
        "octave_division": ps.octave_division,
        "octave_ratio": ps.octave_ratio,
        "scale_degrees": ps.active_degrees,
        "label": ps.label,
    }


def _default_diatonic() -> PitchSystem:
    return PitchSystem(
        octave_division=12,
        scale_degrees=(0, 2, 4, 5, 7, 9, 11),
        label="12-EDO diatonic",
    )


# ===================================================================
# Mode A — Repetition-precision sweep
# ===================================================================


@dataclass(slots=True)
class ModeAConfig:
    repetitions: int = 6
    token_duration_s: float = 2.0
    inter_token_s: float = 0.3
    base_f0_hz: float = 220.0
    contour_shape: str = "arc"
    contour_excursion_st: float = 3.0
    voice_quality: str = "modal"
    sigma_level: int = 2
    sigma_levels: tuple[float, ...] = (0.0, 15.0, 35.0, 60.0, 100.0)
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls, sigma_level: int = 2) -> "ModeAConfig":
        sigma = cls.__dataclass_fields__["sigma_levels"].default[sigma_level]
        return cls(
            sigma_level=sigma_level,
            jitter=JitterConfig(
                pitch_cents=sigma,
                timing_ms=sigma * 0.5,
                intensity_db=sigma * 0.05,
                attack_ms=sigma * 0.3,
            ),
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "A",
            "sigma_level": self.sigma_level,
            "sigma_value": self.sigma_levels[self.sigma_level],
            "repetitions": self.repetitions,
            "token_duration_s": self.token_duration_s,
            "contour_shape": self.contour_shape,
            "voice_quality": self.voice_quality,
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_a_events(config: ModeAConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode A events: a vocalisation token repeated *repetitions* times."""

    events: list[AcousticEvent] = []
    token_plus_gap = config.token_duration_s + config.inter_token_s

    for rep in range(config.repetitions):
        events.append(
            AcousticEvent(
                event_id=next_event_id("voc", rep),
                onset_s=rep * token_plus_gap,
                duration_s=config.token_duration_s,
                kind="tone",
                pitch_hz=config.base_f0_hz,
                intensity_db=65.0,
                timbre="vocalisation",
                attack_ms=15.0,
                decay_ms=30.0,
                sustain_level=0.8,
                release_ms=40.0,
                tags={
                    "layer": "source",
                    "repetition_index": rep,
                    "voice_quality": config.voice_quality,
                    "contour_shape": config.contour_shape,
                    "contour_excursion_st": config.contour_excursion_st,
                    "vibrato_rate_hz": 5.5,
                    "vibrato_depth_cents": 25.0,
                    "f1_hz": 700.0,
                    "f2_hz": 1200.0,
                    "f3_hz": 2600.0,
                    "f1_bw": 130.0,
                    "f2_bw": 70.0,
                    "f3_bw": 160.0,
                    "aspiration_db": -20.0,
                    "trigger_code": 10,
                },
            )
        )
    jittered = JitterStage(config.jitter).apply(events, seed=seed)
    return events_to_dicts(jittered)


# ===================================================================
# Mode B — Affective vs phonemic acoustic parameter axis
# ===================================================================


@dataclass(slots=True)
class ModeBConfig:
    condition: str = "affective"
    repetitions: int = 6
    token_duration_s: float = 2.0
    inter_token_s: float = 0.3
    base_f0_hz: float = 220.0
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls, condition: str = "affective") -> "ModeBConfig":
        if condition == "affective":
            return cls(
                condition="affective",
                jitter=JitterConfig(
                    pitch_cents=0.0,
                    timing_ms=0.0,
                    intensity_db=0.0,
                ),
            )
        return cls(
            condition="phonemic",
            jitter=JitterConfig(
                pitch_cents=60.0,
                timing_ms=15.0,
                intensity_db=3.0,
            ),
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "B",
            "condition": self.condition,
            "repetitions": self.repetitions,
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_b_events(config: ModeBConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode B events: affective vs phonemic repetition conditions.

    *Affective condition:* pitch contour and intensity repeat precisely;
    formant transitions vary randomly across repetitions.

    *Phonemic condition:* formant transitions repeat precisely; pitch contour
    and intensity vary randomly across repetitions.
    """

    import numpy as _np

    rng = _np.random.default_rng(seed)
    events: list[AcousticEvent] = []
    token_plus_gap = config.token_duration_s + config.inter_token_s

    base_formants = {"f1_hz": 700.0, "f2_hz": 1200.0, "f3_hz": 2600.0}
    base_contour = {"contour_shape": "arc", "contour_excursion_st": 3.0}

    for rep in range(config.repetitions):
        tags: dict[str, Any] = {
            "layer": "source",
            "condition": config.condition,
            "repetition_index": rep,
            "voice_quality": "modal",
            "vibrato_rate_hz": 5.5,
            "vibrato_depth_cents": 25.0,
            "aspiration_db": -20.0,
            "trigger_code": 10,
        }

        if config.condition == "affective":
            tags.update(base_contour)
            tags["f1_hz"] = base_formants["f1_hz"] + float(rng.normal(0, 80))
            tags["f2_hz"] = base_formants["f2_hz"] + float(rng.normal(0, 100))
            tags["f3_hz"] = base_formants["f3_hz"] + float(rng.normal(0, 120))
            tags["f1_bw"] = 130.0
            tags["f2_bw"] = 70.0
            tags["f3_bw"] = 160.0
        else:
            tags["f1_hz"] = base_formants["f1_hz"]
            tags["f2_hz"] = base_formants["f2_hz"]
            tags["f3_hz"] = base_formants["f3_hz"]
            tags["f1_bw"] = 130.0
            tags["f2_bw"] = 70.0
            tags["f3_bw"] = 160.0
            shapes = ["arc", "rising", "falling", "flat"]
            tags["contour_shape"] = shapes[int(rng.integers(len(shapes)))]
            tags["contour_excursion_st"] = float(rng.uniform(1.0, 5.0))

        events.append(
            AcousticEvent(
                event_id=next_event_id("voc", rep),
                onset_s=rep * token_plus_gap,
                duration_s=config.token_duration_s,
                kind="tone",
                pitch_hz=config.base_f0_hz,
                intensity_db=65.0,
                timbre="vocalisation",
                attack_ms=15.0,
                decay_ms=30.0,
                sustain_level=0.8,
                release_ms=40.0,
                tags=tags,
            )
        )

    jittered = JitterStage(config.jitter).apply(events, seed=seed)
    return events_to_dicts(jittered)


# ===================================================================
# Mode C — On-beat PPI (already implemented; kept here for registry)
# ===================================================================


@dataclass(slots=True)
class ModeCConfig:
    beat: L1BeatConfig
    probe: StartleProbeConfig
    jitter: JitterConfig
    pitch_system: PitchSystem

    @classmethod
    def default(cls, placement: str = "on_beat") -> "ModeCConfig":
        return cls(
            beat=L1BeatConfig(),
            probe=StartleProbeConfig(placement=placement),
            jitter=JitterConfig(),
            pitch_system=PitchSystem(
                octave_division=12,
                scale_degrees=(0, 2, 4, 5, 7, 9, 11),
                label="12-EDO diatonic",
            ),
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "C",
            "beat": asdict(self.beat),
            "probe": asdict(self.probe),
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_c_events(config: ModeCConfig, *, seed: int | None = None) -> list[dict]:
    beat_events = L1BeatSequencer(config.beat).generate(config.pitch_system)
    probed = ProbeInjector(config.probe).inject(beat_events, seed=seed)
    jittered = JitterStage(config.jitter).apply(probed, seed=seed)
    return events_to_dicts(jittered)


# ===================================================================
# Mode D — Hierarchical complexity and ERP level-mapping
# ===================================================================


@dataclass(slots=True)
class ModeDConfig:
    duration_target_s: float = 60.0
    violations_per_level: int = 4
    form: L4FormConfig = field(default_factory=lambda: L4FormConfig(
        schedule="AABAABC",
        motif_entropy=0.5,
        motif_steps=8,
        motifs_per_phrase=4,
        phrases_per_section=2,
        tempo_bpm=100.0,
    ))
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls) -> "ModeDConfig":
        return cls()

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "D",
            "duration_target_s": self.duration_target_s,
            "violations_per_level": self.violations_per_level,
            "form": asdict(self.form),
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_d_events(config: ModeDConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode D events: hierarchical sequence with level-tagged violations.

    Four violation types are injected at controlled frequency:
      - acoustic (formant outlier) → N100
      - pitch (out-of-set) → P200
      - motif (unexpected continuation) → N400
      - structural (premature theme return) → P600
    """

    base_events = L4FormSequencer(config.form).generate(config.pitch_system, seed=seed)
    jittered = JitterStage(config.jitter).apply(base_events, seed=seed)

    violations = ViolationInjector([
        ViolationConfig(violation_type="acoustic", count=config.violations_per_level,
                        formant_deviation_hz=400.0),
        ViolationConfig(violation_type="pitch", count=config.violations_per_level),
        ViolationConfig(violation_type="motif", count=config.violations_per_level),
        ViolationConfig(violation_type="structural", count=config.violations_per_level),
    ])
    return violations.inject(jittered, pitch_system=config.pitch_system, seed=seed)


# ===================================================================
# Mode E — Vocal self-simulation localiser
# ===================================================================


_VOCALISATION_TYPES = [
    {"label": "ah_falling_arc", "contour_shape": "arc", "contour_excursion_st": 4.0,
     "f1_hz": 700.0, "f2_hz": 1200.0, "f3_hz": 2600.0, "voice_quality": "modal"},
    {"label": "oo_rising", "contour_shape": "rising", "contour_excursion_st": 3.0,
     "f1_hz": 300.0, "f2_hz": 870.0, "f3_hz": 2240.0, "voice_quality": "modal"},
    {"label": "yawn_sigh", "contour_shape": "falling", "contour_excursion_st": 6.0,
     "f1_hz": 600.0, "f2_hz": 1000.0, "f3_hz": 2400.0, "voice_quality": "breathy"},
    {"label": "cry_wail", "contour_shape": "arc", "contour_excursion_st": 5.0,
     "f1_hz": 750.0, "f2_hz": 1400.0, "f3_hz": 2800.0, "voice_quality": "pressed"},
]


@dataclass(slots=True)
class ModeEConfig:
    tokens_per_type: int = 12
    token_duration_s: float = 1.5
    inter_token_s: float = 1.0
    base_f0_hz: float = 200.0
    sigma_levels: tuple[float, ...] = (0.0, 15.0, 35.0, 60.0, 100.0)
    sigma_level: int = 2
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls, sigma_level: int = 2) -> "ModeEConfig":
        sigma = cls.__dataclass_fields__["sigma_levels"].default[sigma_level]
        return cls(
            sigma_level=sigma_level,
            jitter=JitterConfig(
                pitch_cents=sigma,
                timing_ms=sigma * 0.4,
                intensity_db=sigma * 0.05,
                attack_ms=sigma * 0.2,
            ),
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "E",
            "sigma_level": self.sigma_level,
            "tokens_per_type": self.tokens_per_type,
            "vocalisation_types": [v["label"] for v in _VOCALISATION_TYPES],
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_e_events(config: ModeEConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode E listening-block events: four vocalisation types, repeated."""

    import numpy as _np
    rng = _np.random.default_rng(seed)

    events: list[AcousticEvent] = []
    token_gap = config.token_duration_s + config.inter_token_s
    idx = 0

    type_order = list(range(len(_VOCALISATION_TYPES))) * config.tokens_per_type
    rng.shuffle(type_order)

    for trial, vtype_idx in enumerate(type_order):
        vtype = _VOCALISATION_TYPES[vtype_idx]
        events.append(
            AcousticEvent(
                event_id=next_event_id("voc", idx),
                onset_s=trial * token_gap,
                duration_s=config.token_duration_s,
                kind="tone",
                pitch_hz=config.base_f0_hz,
                intensity_db=65.0,
                timbre="vocalisation",
                attack_ms=15.0,
                decay_ms=30.0,
                sustain_level=0.8,
                release_ms=40.0,
                tags={
                    "layer": "source",
                    "vocalisation_type": vtype["label"],
                    "vocalisation_type_index": vtype_idx,
                    "trial_index": trial,
                    "contour_shape": vtype["contour_shape"],
                    "contour_excursion_st": vtype["contour_excursion_st"],
                    "voice_quality": vtype["voice_quality"],
                    "vibrato_rate_hz": 5.5,
                    "vibrato_depth_cents": 20.0,
                    "f1_hz": vtype["f1_hz"],
                    "f2_hz": vtype["f2_hz"],
                    "f3_hz": vtype["f3_hz"],
                    "f1_bw": 130.0,
                    "f2_bw": 70.0,
                    "f3_bw": 160.0,
                    "aspiration_db": -18.0 if vtype["voice_quality"] == "breathy" else -22.0,
                    "trigger_code": 10 + vtype_idx,
                },
            )
        )
        idx += 1

    jittered = JitterStage(config.jitter).apply(events, seed=seed)
    return events_to_dicts(jittered)


# ===================================================================
# Mode F — Cultural model / individual differences in optimal complexity
# ===================================================================


@dataclass(slots=True)
class ModeFConfig:
    familiarisation_entropy: float = 0.45
    familiarisation_steps: int = 128
    probe_entropies: tuple[float, ...] = (0.15, 0.30, 0.45, 0.60, 0.75, 0.90)
    probe_steps: int = 48
    use_familiarised_scale: bool = True
    control_scale_degrees: tuple[int, ...] = (0, 1, 3, 5, 8, 10)
    motif_steps: int = 8
    motifs_per_phrase: int = 4
    phrases_per_section: int = 2
    tempo_bpm: float = 100.0
    timbre: str = "triangle"
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls) -> "ModeFConfig":
        return cls()

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "F",
            "familiarisation_entropy": self.familiarisation_entropy,
            "probe_entropies": self.probe_entropies,
            "use_familiarised_scale": self.use_familiarised_scale,
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_f_familiarisation(
    config: ModeFConfig, *, seed: int | None = None,
) -> list[dict]:
    """Generate the familiarisation-phase stimulus for Mode F."""

    seq = MarkovMotifSequencer(MarkovMotifConfig(
        steps=config.familiarisation_steps,
        entropy=config.familiarisation_entropy,
        tempo_bpm=config.tempo_bpm,
        timbre=config.timbre,
    ))
    events = seq.generate(config.pitch_system, seed=seed)
    return events_to_dicts(events)


def generate_mode_f_probe(
    config: ModeFConfig, *, entropy_index: int = 0, seed: int | None = None,
) -> list[dict]:
    """Generate one probe-phase stimulus at a specified entropy level."""

    entropy = config.probe_entropies[entropy_index]
    ps = config.pitch_system
    if not config.use_familiarised_scale:
        ps = PitchSystem(
            tonic_hz=ps.tonic_hz,
            octave_division=ps.octave_division,
            scale_degrees=config.control_scale_degrees,
            label=f"{ps.octave_division}-EDO control",
        )
    seq = L3PhraseSequencer(L3PhraseConfig(
        motif_vocabulary_size=4,
        motif_steps=config.motif_steps,
        motif_entropy=entropy,
        motifs_per_phrase=config.motifs_per_phrase,
        phrase_count=config.phrases_per_section,
        tempo_bpm=config.tempo_bpm,
        timbre=config.timbre,
    ))
    events = seq.generate(ps, seed=seed)
    jittered = JitterStage(config.jitter).apply(events, seed=seed)
    for ev in jittered:
        ev.setdefault("tags", {})["probe_entropy"] = entropy
        ev["tags"]["entropy_index"] = entropy_index
        ev["tags"]["familiarised_scale"] = config.use_familiarised_scale
    return events_to_dicts(jittered)


# ===================================================================
# Mode G — Octave division and scale learning
# ===================================================================


@dataclass(slots=True)
class ModeGConfig:
    octave_division: int = 19
    scale_size: int = 7
    scale_geometry: str = "asymmetric"
    quantisation_strengths: tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0)
    quantisation_index: int = 4
    violation_types: tuple[str, ...] = ("out_of_scale", "mistuned")
    violations_per_type: int = 4
    mistuning_cents: float = 50.0
    motif_steps: int = 64
    motif_entropy: float = 0.55
    tempo_bpm: float = 100.0
    timbre: str = "sine"
    jitter: JitterConfig = field(default_factory=JitterConfig)
    tonic_hz: float = 261.6255653005986

    @classmethod
    def default(cls, octave_division: int = 19, quantisation_index: int = 4) -> "ModeGConfig":
        return cls(octave_division=octave_division, quantisation_index=quantisation_index)

    def pitch_system(self) -> PitchSystem:
        from synthesiser.web.phase0 import scale_degrees
        degrees = scale_degrees(self.octave_division, self.scale_size, self.scale_geometry)
        return PitchSystem(
            tonic_hz=self.tonic_hz,
            octave_division=self.octave_division,
            scale_degrees=degrees,
            label=f"{self.octave_division}-EDO {self.scale_geometry}",
        )

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "G",
            "octave_division": self.octave_division,
            "scale_size": self.scale_size,
            "scale_geometry": self.scale_geometry,
            "quantisation_strength": self.quantisation_strengths[self.quantisation_index],
            "quantisation_index": self.quantisation_index,
            "violation_types": self.violation_types,
            "jitter": asdict(self.jitter),
        }


def generate_mode_g_events(config: ModeGConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode G events: motif sequence in a novel scale system with deviants.

    Pitch quantisation strength is applied post-generation to test the
    continuous → discrete boundary.
    """

    import numpy as _np

    ps = config.pitch_system()
    rng = _np.random.default_rng(seed)
    quant_strength = config.quantisation_strengths[config.quantisation_index]

    seq = MarkovMotifSequencer(MarkovMotifConfig(
        steps=config.motif_steps,
        entropy=config.motif_entropy,
        tempo_bpm=config.tempo_bpm,
        timbre=config.timbre,
    ))
    events = seq.generate(ps, seed=seed)
    serialised = events_to_dicts(events)

    if quant_strength < 1.0:
        for ev in serialised:
            if ev.get("pitch_hz") is not None:
                ev["pitch_hz"] = ps.nearest_grid_pitch(
                    float(ev["pitch_hz"]), quant_strength, rng=rng,
                )
                ev.setdefault("tags", {})["quantisation_strength"] = quant_strength

    violations = ViolationInjector([
        ViolationConfig(violation_type=vtype, count=config.violations_per_type,
                        deviation_cents=config.mistuning_cents)
        for vtype in config.violation_types
    ])
    with_violations = violations.inject(serialised, pitch_system=ps, seed=seed)
    jittered = JitterStage(config.jitter).apply(with_violations, seed=seed)
    return events_to_dicts(jittered)


# ===================================================================
# Mode H — Hierarchical-repetition timescale dissociation
# ===================================================================


MODEH_CONDITIONS = {
    "beat_only": {"enable_beat": True, "enable_motif": False, "enable_phrase": False, "enable_form": False},
    "motif_only": {"enable_beat": False, "enable_motif": True, "enable_phrase": False, "enable_form": False},
    "phrase_only": {"enable_beat": False, "enable_motif": False, "enable_phrase": True, "enable_form": False},
    "form_only": {"enable_beat": False, "enable_motif": False, "enable_phrase": False, "enable_form": True},
    "multi_level": {"enable_beat": True, "enable_motif": True, "enable_phrase": True, "enable_form": True},
    "no_repetition": {"enable_beat": False, "enable_motif": False, "enable_phrase": False, "enable_form": False},
}


@dataclass(slots=True)
class ModeHConfig:
    condition: str = "multi_level"
    beat: L1BeatConfig = field(default_factory=L1BeatConfig)
    motif: MarkovMotifConfig = field(default_factory=lambda: MarkovMotifConfig(entropy=0.5, steps=64))
    phrase: L3PhraseConfig = field(default_factory=lambda: L3PhraseConfig(
        repetition_probability=0.4, phrase_count=4, motifs_per_phrase=4,
    ))
    form: L4FormConfig = field(default_factory=lambda: L4FormConfig(
        schedule="AABA", motif_entropy=0.5,
    ))
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls, condition: str = "multi_level") -> "ModeHConfig":
        if condition not in MODEH_CONDITIONS:
            raise ValueError(
                f"unknown condition {condition!r}; "
                f"choose from {sorted(MODEH_CONDITIONS)}"
            )
        return cls(condition=condition)

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "H",
            "condition": self.condition,
            "layer_flags": MODEH_CONDITIONS[self.condition],
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_h_events(config: ModeHConfig, *, seed: int | None = None) -> list[dict]:
    """Generate Mode H events: selective hierarchical-layer enabling.

    When repetition is *disabled* at a level, that level is replaced with
    high-entropy / non-repeating content to preserve note count and density
    while removing structured repetition.

    Conditions:
      - beat_only: isochronous grid, non-repeating pitches
      - motif_only: recurring pitch motifs, irregular timing
      - phrase_only: phrase-level recurrence, varying motifs
      - form_only: theme return at form level, non-repeating below
      - multi_level: all layers active
      - no_repetition: high-entropy control
    """

    import numpy as _np

    flags = MODEH_CONDITIONS[config.condition]
    rng = _np.random.default_rng(seed)

    beat_cfg = L1BeatConfig(
        tempo_bpm=config.beat.tempo_bpm,
        beats=config.beat.beats,
        note_duration_fraction=config.beat.note_duration_fraction,
        timbre=config.beat.timbre,
        intensity_db=config.beat.intensity_db,
    )
    motif_cfg = MarkovMotifConfig(
        steps=config.motif.steps,
        entropy=config.motif.entropy if flags["enable_motif"] else 0.98,
        tempo_bpm=config.motif.tempo_bpm,
        timbre=config.motif.timbre,
        intensity_db=config.motif.intensity_db,
    )
    phrase_cfg = L3PhraseConfig(
        motif_vocabulary_size=config.phrase.motif_vocabulary_size,
        motif_steps=config.phrase.motif_steps,
        motif_entropy=config.phrase.motif_entropy if flags["enable_motif"] else 0.98,
        motifs_per_phrase=config.phrase.motifs_per_phrase,
        phrase_count=config.phrase.phrase_count,
        repetition_probability=config.phrase.repetition_probability if flags["enable_phrase"] else 0.0,
        call_and_response=config.phrase.call_and_response,
        tempo_bpm=config.phrase.tempo_bpm,
        timbre=config.phrase.timbre,
        intensity_db=config.phrase.intensity_db,
    )
    form_cfg = L4FormConfig(
        schedule=config.form.schedule if flags["enable_form"] else "ABCD",
        motif_entropy=config.form.motif_entropy if flags["enable_motif"] else 0.98,
        motif_steps=config.form.motif_steps,
        motifs_per_phrase=config.form.motifs_per_phrase,
        phrases_per_section=config.form.phrases_per_section,
        repetition_probability=phrase_cfg.repetition_probability,
        tempo_bpm=config.form.tempo_bpm,
        timbre=config.form.timbre,
        intensity_db=config.form.intensity_db,
    )

    hier_cfg = HierarchicalConfig(
        enable_beat=flags["enable_beat"],
        enable_motif=flags["enable_motif"] or flags["enable_phrase"] or flags["enable_form"],
        enable_phrase=flags["enable_phrase"] or flags["enable_form"],
        enable_form=flags["enable_form"],
        beat=beat_cfg,
        motif=motif_cfg,
        phrase=phrase_cfg,
        form=form_cfg,
    )

    if config.condition == "beat_only":
        events = L1BeatSequencer(beat_cfg).generate(config.pitch_system)
    elif config.condition == "no_repetition":
        no_rep_motif = MarkovMotifConfig(
            steps=64, entropy=0.98, tempo_bpm=motif_cfg.tempo_bpm,
            timbre=motif_cfg.timbre, intensity_db=motif_cfg.intensity_db,
        )
        events = MarkovMotifSequencer(no_rep_motif).generate(
            config.pitch_system, seed=int(rng.integers(2**31)),
        )
    else:
        events = HierarchicalSequencer(hier_cfg).generate(
            config.pitch_system, seed=int(rng.integers(2**31)),
        )

    jittered = JitterStage(config.jitter).apply(events, seed=seed)
    for ev in jittered:
        ev.setdefault("tags", {})["mode_h_condition"] = config.condition
    return events_to_dicts(jittered)


# ===================================================================
# Mode I — Interactive aesthetic-optimum exploration (Python orchestrator)
# ===================================================================


@dataclass(slots=True)
class ModeIConfig:
    controlled_parameter: str = "motif_entropy"
    parameter_range: tuple[float, float] = (0.05, 0.95)
    initial_value: float | None = None
    trial_duration_s: float = 75.0
    settling_threshold_s: float = 5.0
    settling_epsilon: float = 0.02
    sustained_epoch_s: float = 10.0
    baseline_s: float = 5.0
    motif_steps: int = 64
    tempo_bpm: float = 100.0
    timbre: str = "triangle"
    jitter: JitterConfig = field(default_factory=JitterConfig)
    pitch_system: PitchSystem = field(default_factory=_default_diatonic)

    @classmethod
    def default(cls, parameter: str = "motif_entropy") -> "ModeIConfig":
        return cls(controlled_parameter=parameter)

    def to_metadata(self) -> dict[str, Any]:
        return {
            "mode": "I",
            "controlled_parameter": self.controlled_parameter,
            "parameter_range": self.parameter_range,
            "initial_value": self.initial_value,
            "trial_duration_s": self.trial_duration_s,
            "settling_threshold_s": self.settling_threshold_s,
            "settling_epsilon": self.settling_epsilon,
            "sustained_epoch_s": self.sustained_epoch_s,
            "jitter": asdict(self.jitter),
            "pitch_system": _pitch_system_meta(self.pitch_system),
        }


def generate_mode_i_trial_spec(
    config: ModeIConfig, *, seed: int | None = None,
) -> dict[str, Any]:
    """Generate a Mode I trial specification for the SuperCollider engine.

    Mode I is real-time interactive: the participant controls a synthesis
    parameter via a MIDI knob while audio streams continuously.  This function
    produces the *trial spec* — the initial event list, OSC parameter mapping,
    and trigger schedule — that the Python orchestrator sends to SuperCollider
    via OSC at trial start.  It does NOT render audio.
    """

    import numpy as _np

    rng = _np.random.default_rng(seed)
    initial = config.initial_value
    if initial is None:
        lo, hi = config.parameter_range
        initial = float(rng.uniform(lo, hi))

    base_events = MarkovMotifSequencer(MarkovMotifConfig(
        steps=config.motif_steps,
        entropy=initial,
        tempo_bpm=config.tempo_bpm,
        timbre=config.timbre,
    )).generate(config.pitch_system, seed=seed)

    return {
        "mode": "I",
        "trial_spec": True,
        "controlled_parameter": config.controlled_parameter,
        "parameter_range": list(config.parameter_range),
        "initial_value": initial,
        "trial_duration_s": config.trial_duration_s,
        "baseline_s": config.baseline_s,
        "settling_threshold_s": config.settling_threshold_s,
        "settling_epsilon": config.settling_epsilon,
        "sustained_epoch_s": config.sustained_epoch_s,
        "osc_address": f"/synth/{config.controlled_parameter}",
        "osc_ramp_ms": 50.0,
        "seed": seed,
        "initial_events": events_to_dicts(base_events),
        "trigger_codes": {
            "trial_start": 40,
            "parameter_change": 41,
            "adoption": 42,
            "sustained_epoch_start": 43,
            "trial_end": 44,
        },
        "metadata": config.to_metadata(),
    }


# ---------------------------------------------------------------------------
# Mode registry
# ---------------------------------------------------------------------------

MODE_REGISTRY: dict[str, dict[str, Any]] = {
    "A": {
        "label": "Repetition-precision sweep",
        "config_class": ModeAConfig,
        "generator": generate_mode_a_events,
        "renderer": "vocalisation",
        "active_layers": ["source", "precision"],
    },
    "B": {
        "label": "Affective vs phonemic axis",
        "config_class": ModeBConfig,
        "generator": generate_mode_b_events,
        "renderer": "vocalisation",
        "active_layers": ["source", "precision"],
    },
    "C": {
        "label": "On-beat PPI",
        "config_class": ModeCConfig,
        "generator": generate_mode_c_events,
        "renderer": "pitched",
        "active_layers": ["L1", "probe"],
    },
    "D": {
        "label": "Hierarchical violations",
        "config_class": ModeDConfig,
        "generator": generate_mode_d_events,
        "renderer": "pitched",
        "active_layers": ["L1", "L2", "L3", "L4", "violation"],
    },
    "E": {
        "label": "Vocal self-simulation localiser",
        "config_class": ModeEConfig,
        "generator": generate_mode_e_events,
        "renderer": "vocalisation",
        "active_layers": ["source", "precision"],
    },
    "F": {
        "label": "Cultural model / optimal complexity",
        "config_class": ModeFConfig,
        "generator": generate_mode_f_probe,
        "renderer": "pitched",
        "active_layers": ["L1", "L2", "L3", "L4", "L5"],
    },
    "G": {
        "label": "Octave division & scale learning",
        "config_class": ModeGConfig,
        "generator": generate_mode_g_events,
        "renderer": "pitched",
        "active_layers": ["pitch_system", "L2", "violation"],
    },
    "H": {
        "label": "Hierarchical-repetition timescale",
        "config_class": ModeHConfig,
        "generator": generate_mode_h_events,
        "renderer": "pitched",
        "active_layers": ["L1", "L2", "L3", "L4"],
    },
    "I": {
        "label": "Interactive aesthetic optimum",
        "config_class": ModeIConfig,
        "generator": generate_mode_i_trial_spec,
        "renderer": "supercollider_realtime",
        "active_layers": ["L1", "L2", "L3", "L4"],
    },
}
