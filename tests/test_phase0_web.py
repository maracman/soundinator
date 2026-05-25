import json
import threading
import urllib.request

from synthesiser.web.phase0 import Phase0Parameters, render_phase0_preset, scale_degrees
from synthesiser.web.server import build_server


def post_json(url: str, payload: dict) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url: str) -> dict | list:
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def test_phase0_parameters_clamp_and_hash() -> None:
    params = Phase0Parameters.from_mapping(
        {
            "tempo_bpm": 999,
            "motif_entropy": 2,
            "octave_division": 9,
            "scale_size": 99,
            "scale_geometry": "asymmetric",
            "timbre": "triangle",
            "seed": 123,
        }
    )
    assert params.tempo_bpm == 180
    assert params.motif_entropy == 1.0
    assert params.scale_size == 9
    assert params.hash() == Phase0Parameters.from_mapping(params.to_dict()).hash()


def test_scale_degrees_unique() -> None:
    degrees = scale_degrees(19, 7, "asymmetric")
    assert len(degrees) == 7
    assert len(set(degrees)) == 7
    assert all(0 <= degree < 19 for degree in degrees)


def test_phase0_render_writes_cached_audio(tmp_path) -> None:
    params = Phase0Parameters(steps=16, seed=77)
    sidecar = render_phase0_preset(params, output_dir=tmp_path, sample_rate=16_000)
    assert (tmp_path / f"{params.hash()}.wav").exists()
    assert (tmp_path / f"{params.hash()}.json").exists()
    assert sidecar["preset_hash"] == params.hash()
    assert sidecar["metadata"]["mode"] == "Phase0"


def test_phase0_server_render_and_global_library(tmp_path) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    server = build_server("127.0.0.1", 0, root=tmp_path)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    try:
        render = post_json(
            f"{base}/api/render",
            {"parameters": {"steps": 16, "seed": 88, "motif_entropy": 0.4}},
        )
        assert render["preset_hash"]
        assert render["audio_url"].endswith(".wav")

        shared = post_json(
            f"{base}/api/global-presets",
            {
                "share_consent": True,
                "preset_name": "Test favourite",
                "favourite_rating": 7,
                "parameters": {"steps": 16, "seed": 88, "motif_entropy": 0.4},
            },
        )
        assert shared["ok"] is True
        assert shared["entry"]["preset_name"] == "Test favourite"

        library = get_json(f"{base}/api/global-presets")
        assert len(library) == 1
        assert library[0]["preset_hash"] == render["preset_hash"]
    finally:
        server.shutdown()
        server.server_close()
