"""Experiment runner skeleton.

Hardware triggering and PsychoPy presentation are intentionally isolated from
stimulus generation so rendered WAV+JSON pairs can be tested without lab gear.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class Marker:
    onset_s: float
    code: int
    label: str
    event_id: str


def markers_from_sidecar(sidecar: dict[str, Any]) -> list[Marker]:
    markers: list[Marker] = []
    for event in sidecar.get("events", []):
        tags = event.get("tags", {})
        if tags.get("probe"):
            code = int(tags.get("trigger_code", 20))
            label = f"probe/{tags.get('placement', 'unknown')}"
        else:
            code = int(tags.get("trigger_code", 10))
            label = f"{event.get('kind', 'event')}/{tags.get('layer', 'unlayered')}"
        markers.append(
            Marker(
                onset_s=float(event["onset_s"]),
                code=code,
                label=label,
                event_id=str(event["event_id"]),
            )
        )
    return sorted(markers, key=lambda marker: marker.onset_s)


class DryRunExperimentRunner:
    """Print the marker schedule that a hardware runner would fire."""

    def load_sidecar(self, path: str | Path) -> dict[str, Any]:
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def trial_schedule(self, path: str | Path) -> list[Marker]:
        return markers_from_sidecar(self.load_sidecar(path))


class PsychoPyExperimentRunner:
    """Boundary for the lab runner to be filled once hardware is known."""

    def __init__(self) -> None:
        try:
            import psychopy  # noqa: F401
        except Exception as exc:
            raise RuntimeError(
                "PsychoPy is not installed. Install the experiment extras and "
                "configure trigger hardware before using the live runner."
            ) from exc
