"""Rendering pipeline, sidecar export, and QC."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

import numpy as np

from synthesiser.audio import limit_peak, normalise_loudness, peak_dbfs, rms_dbfs, write_wav
from synthesiser.renderers.base import Renderer
from synthesiser.schema import SCHEMA_VERSION, events_to_dicts


@dataclass(slots=True)
class RenderPipelineConfig:
    sample_rate: int = 48_000
    target_lufs: float = -23.0
    peak_db: float = -1.0
    bit_depth: int = 24


def qc_audio(audio: np.ndarray, sample_rate: int, target_lufs: float) -> dict[str, Any]:
    peak = peak_dbfs(audio)
    rms = rms_dbfs(audio)
    return {
        "duration_s": round(float(len(audio) / sample_rate), 6) if sample_rate else 0.0,
        "sample_count": int(len(audio)),
        "peak_dbfs": peak,
        "rms_dbfs": rms,
        "loudness_error_lu_approx": None if not np.isfinite(rms) else round(float(rms - target_lufs), 4),
        "dc_offset": float(np.mean(audio)) if audio.size else 0.0,
        "clipping_samples": int(np.sum(np.abs(audio) >= 1.0)),
        "finite": bool(np.all(np.isfinite(audio))),
    }


class RenderingPipeline:
    def __init__(self, renderer: Renderer, config: RenderPipelineConfig | None = None) -> None:
        self.renderer = renderer
        self.config = config or RenderPipelineConfig()

    def render_stimulus(
        self,
        events: list[Mapping],
        *,
        stimulus_id: str,
        output_dir: str | Path,
        metadata: dict[str, Any] | None = None,
        seed: int | None = None,
    ) -> dict[str, Any]:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        event_dicts = events_to_dicts(events)

        raw = self.renderer.render(event_dicts)
        normalised, measured_lufs = normalise_loudness(raw, self.config.sample_rate, self.config.target_lufs)
        limited = limit_peak(normalised, self.config.peak_db)

        wav_path = output_path / f"{stimulus_id}.wav"
        sidecar_path = output_path / f"{stimulus_id}.json"
        wav_subtype = write_wav(wav_path, limited, self.config.sample_rate, bit_depth=self.config.bit_depth)

        sidecar = {
            "schema_version": SCHEMA_VERSION,
            "stimulus_id": stimulus_id,
            "mode": (metadata or {}).get("mode"),
            "renderer": getattr(self.renderer, "name", self.renderer.__class__.__name__),
            "sample_rate": self.config.sample_rate,
            "random_seed": seed,
            "paths": {
                "wav": wav_path.name,
                "sidecar": sidecar_path.name,
            },
            "render_config": asdict(self.config),
            "wav_subtype": wav_subtype,
            "measured_loudness_before_normalisation": measured_lufs,
            "metadata": metadata or {},
            "events": event_dicts,
            "qc": {
                **qc_audio(limited, self.config.sample_rate, self.config.target_lufs),
                "event_count": len(event_dicts),
                "probe_count": sum(1 for event in event_dicts if event.get("kind") == "probe"),
            },
        }
        sidecar_path.write_text(json.dumps(sidecar, indent=2, sort_keys=True), encoding="utf-8")
        return sidecar
