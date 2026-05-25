"""Phase 0 preset rendering.

The online discovery phase needs a friendly parameter surface, but the output
still has to be reproducible from a compact schema. This module maps web UI
controls onto the existing symbolic generator and pitched renderer.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from synthesiser.pitch import PitchSystem
from synthesiser.pipeline import RenderPipelineConfig, RenderingPipeline
from synthesiser.renderers.pitched import PitchedRenderer, PitchedRendererConfig
from synthesiser.sequencer import MarkovMotifConfig, MarkovMotifSequencer

PHASE0_SCHEMA_VERSION = "phase0-web-0.1.0"
SYNTH_VERSION_HASH = "tier1-phase0-0.1.0"


def clamp(value: Any, minimum: float, maximum: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not np.isfinite(number):
        return default
    return float(min(max(number, minimum), maximum))


def clamp_int(value: Any, minimum: int, maximum: int, default: int) -> int:
    return int(round(clamp(value, minimum, maximum, default)))


@dataclass(slots=True)
class Phase0Parameters:
    """Public web preset schema for early population mapping."""

    tempo_bpm: int = 104
    motif_entropy: float = 0.55
    octave_division: int = 12
    scale_size: int = 7
    scale_geometry: str = "asymmetric"
    note_density: float = 0.48
    steps: int = 48
    tonic_hz: float = 261.6255653005986
    octave: int = 0
    timbre: str = "triangle"
    seed: int = 1001

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any] | None) -> "Phase0Parameters":
        data = data or {}
        defaults = cls()
        octave_division = clamp_int(data.get("octave_division"), 5, 24, defaults.octave_division)
        scale_size = clamp_int(data.get("scale_size"), 3, min(12, octave_division), min(7, octave_division))
        scale_geometry = str(data.get("scale_geometry", defaults.scale_geometry))
        if scale_geometry not in {"asymmetric", "even", "clustered"}:
            scale_geometry = defaults.scale_geometry
        timbre = str(data.get("timbre", defaults.timbre))
        if timbre not in {"sine", "triangle", "additive_piano", "formant_noise"}:
            timbre = defaults.timbre
        return cls(
            tempo_bpm=clamp_int(data.get("tempo_bpm"), 60, 180, defaults.tempo_bpm),
            motif_entropy=clamp(data.get("motif_entropy"), 0.0, 1.0, defaults.motif_entropy),
            octave_division=octave_division,
            scale_size=scale_size,
            scale_geometry=scale_geometry,
            note_density=clamp(data.get("note_density"), 0.18, 0.92, defaults.note_density),
            steps=clamp_int(data.get("steps"), 16, 96, defaults.steps),
            tonic_hz=clamp(data.get("tonic_hz"), 110.0, 523.26, defaults.tonic_hz),
            octave=clamp_int(data.get("octave"), -1, 2, defaults.octave),
            timbre=timbre,
            seed=clamp_int(data.get("seed"), 1, 2_147_483_647, defaults.seed),
        )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def hash(self) -> str:
        payload = {
            "schema": PHASE0_SCHEMA_VERSION,
            "synth_version_hash": SYNTH_VERSION_HASH,
            "parameters": self.to_dict(),
        }
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()[:20]


def scale_degrees(octave_division: int, scale_size: int, geometry: str) -> tuple[int, ...]:
    """Derive an active scale subset from web-facing scale controls."""

    if scale_size >= octave_division:
        return tuple(range(octave_division))

    if geometry == "even":
        raw = np.linspace(0, octave_division, scale_size, endpoint=False)
        degrees = [int(round(value)) % octave_division for value in raw]
    elif geometry == "clustered":
        cluster = max(2, scale_size // 2)
        lower = np.linspace(0, octave_division * 0.38, cluster, endpoint=False)
        upper = np.linspace(octave_division * 0.58, octave_division, scale_size - cluster, endpoint=False)
        degrees = [int(round(value)) % octave_division for value in np.concatenate([lower, upper])]
    else:
        # A compact deterministic asymmetric pattern that preserves a tonic and
        # avoids the overly familiar equal-spacing shape in discovery waves.
        increments = np.array([2, 1, 3, 2, 2, 1, 4, 1, 3, 2, 1, 2], dtype=float)
        scaled = increments[:scale_size] * (octave_division / increments[:scale_size].sum())
        degrees = [0]
        current = 0.0
        for step in scaled[:-1]:
            current += step
            degrees.append(int(round(current)) % octave_division)

    unique: list[int] = []
    for degree in degrees:
        candidate = degree % octave_division
        while candidate in unique:
            candidate = (candidate + 1) % octave_division
        unique.append(candidate)
    return tuple(sorted(unique[:scale_size]))


def generate_phase0_events(parameters: Phase0Parameters) -> list[dict[str, Any]]:
    degrees = scale_degrees(parameters.octave_division, parameters.scale_size, parameters.scale_geometry)
    pitch_system = PitchSystem(
        tonic_hz=parameters.tonic_hz,
        octave_division=parameters.octave_division,
        scale_degrees=degrees,
        label=f"{parameters.octave_division}-EDO {parameters.scale_geometry}",
    )
    sequencer = MarkovMotifSequencer(
        MarkovMotifConfig(
            steps=parameters.steps,
            entropy=parameters.motif_entropy,
            tempo_bpm=parameters.tempo_bpm,
            note_duration_fraction=parameters.note_density,
            octave=parameters.octave,
            timbre=parameters.timbre,
            intensity_db=64.0,
        )
    )
    return [event.to_dict() for event in sequencer.generate(pitch_system, seed=parameters.seed)]


def render_phase0_preset(
    parameters: Phase0Parameters,
    *,
    output_dir: str | Path,
    force: bool = False,
    sample_rate: int = 44_100,
) -> dict[str, Any]:
    """Render a Phase 0 preset into cache and return sidecar metadata."""

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    preset_hash = parameters.hash()
    sidecar_path = output / f"{preset_hash}.json"
    wav_path = output / f"{preset_hash}.wav"
    if not force and sidecar_path.exists() and wav_path.exists():
        return json.loads(sidecar_path.read_text(encoding="utf-8"))

    events = generate_phase0_events(parameters)
    renderer = PitchedRenderer(PitchedRendererConfig(sample_rate=sample_rate, random_seed=parameters.seed))
    pipeline = RenderingPipeline(
        renderer,
        RenderPipelineConfig(sample_rate=sample_rate, target_lufs=-24.0, peak_db=-1.0),
    )
    sidecar = pipeline.render_stimulus(
        events,
        stimulus_id=preset_hash,
        output_dir=output,
        metadata={
            "mode": "Phase0",
            "phase0_schema_version": PHASE0_SCHEMA_VERSION,
            "synth_version_hash": SYNTH_VERSION_HASH,
            "parameters": parameters.to_dict(),
            "scale_degrees": scale_degrees(
                parameters.octave_division,
                parameters.scale_size,
                parameters.scale_geometry,
            ),
        },
        seed=parameters.seed,
    )
    sidecar["preset_hash"] = preset_hash
    sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True), encoding="utf-8")
    return sidecar
