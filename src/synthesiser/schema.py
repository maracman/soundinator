"""Event schema utilities.

The renderer contract is deliberately plain dictionaries so sidecars stay easy
to inspect and migrate. Dataclasses are used at generation time for safer
construction, then converted to JSON-serialisable dictionaries at boundaries.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

SCHEMA_VERSION = "0.1.0"


@dataclass(slots=True)
class AcousticEvent:
    """A single acoustic event in a rendered stimulus."""

    event_id: str
    onset_s: float
    duration_s: float
    kind: str = "tone"
    pitch_hz: float | None = None
    intensity_db: float = 65.0
    velocity: float = 1.0
    timbre: str = "sine"
    attack_ms: float = 8.0
    decay_ms: float = 20.0
    sustain_level: float = 0.85
    release_ms: float = 20.0
    pan: float = 0.0
    formants: dict[str, float] = field(default_factory=dict)
    tags: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        validate_event(data)
        return data


def validate_event(event: Mapping[str, Any]) -> None:
    """Validate the small subset of fields every renderer depends on."""

    required = ("event_id", "onset_s", "duration_s", "kind", "timbre")
    missing = [key for key in required if key not in event]
    if missing:
        raise ValueError(f"event missing required fields: {', '.join(missing)}")
    if float(event["onset_s"]) < 0:
        raise ValueError(f"event {event['event_id']} has negative onset")
    if float(event["duration_s"]) <= 0:
        raise ValueError(f"event {event['event_id']} has non-positive duration")
    if event["kind"] == "tone" and event.get("pitch_hz") is None:
        raise ValueError(f"tone event {event['event_id']} is missing pitch_hz")
    if event.get("pitch_hz") is not None and float(event["pitch_hz"]) <= 0:
        raise ValueError(f"event {event['event_id']} has non-positive pitch_hz")


def events_to_dicts(events: list[AcousticEvent | Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return validated plain dictionaries sorted by onset time."""

    serialised: list[dict[str, Any]] = []
    for event in events:
        data = event.to_dict() if isinstance(event, AcousticEvent) else dict(event)
        validate_event(data)
        serialised.append(data)
    return sorted(serialised, key=lambda item: (float(item["onset_s"]), item["event_id"]))


def next_event_id(prefix: str, index: int) -> str:
    return f"{prefix}_{index:04d}"
