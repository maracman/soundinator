import json

import numpy as np
from scipy.io import wavfile

from synthesiser.modes import ModeCConfig, generate_mode_c_events
from synthesiser.pipeline import RenderPipelineConfig, RenderingPipeline
from synthesiser.renderers.pitched import PitchedRenderer, PitchedRendererConfig


def test_render_pipeline_writes_wav_and_sidecar(tmp_path) -> None:
    config = ModeCConfig.default("on_beat")
    events = generate_mode_c_events(config, seed=42)
    renderer = PitchedRenderer(PitchedRendererConfig(sample_rate=16_000, random_seed=42))
    pipeline = RenderingPipeline(renderer, RenderPipelineConfig(sample_rate=16_000))
    sidecar = pipeline.render_stimulus(events, stimulus_id="test", output_dir=tmp_path, metadata=config.to_metadata(), seed=42)

    assert (tmp_path / "test.wav").exists()
    assert (tmp_path / "test.json").exists()
    assert sidecar["qc"]["event_count"] == 33
    assert sidecar["qc"]["probe_count"] == 1
    assert sidecar["qc"]["finite"] is True

    sr, audio = wavfile.read(tmp_path / "test.wav")
    assert sr == 16_000
    assert np.asarray(audio).size > 0

    loaded = json.loads((tmp_path / "test.json").read_text())
    assert loaded["schema_version"] == "0.1.0"
