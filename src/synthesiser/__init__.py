"""Research music synthesiser package."""

from synthesiser.pitch import PitchSystem
from synthesiser.schema import SCHEMA_VERSION, AcousticEvent
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
from synthesiser.jitter import JitterConfig, JitterStage
from synthesiser.probe import ProbeInjector, StartleProbeConfig, ViolationConfig, ViolationInjector
from synthesiser.modes import MODE_REGISTRY

__all__ = [
    "AcousticEvent",
    "HierarchicalConfig",
    "HierarchicalSequencer",
    "JitterConfig",
    "JitterStage",
    "L1BeatConfig",
    "L1BeatSequencer",
    "L3PhraseConfig",
    "L3PhraseSequencer",
    "L4FormConfig",
    "L4FormSequencer",
    "MODE_REGISTRY",
    "MarkovMotifConfig",
    "MarkovMotifSequencer",
    "PitchSystem",
    "ProbeInjector",
    "SCHEMA_VERSION",
    "StartleProbeConfig",
    "ViolationConfig",
    "ViolationInjector",
]
