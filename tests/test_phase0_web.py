import json
import threading
import urllib.error
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
    server.experiments = True  # legacy library now lives behind RESONA_EXPERIMENTS
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


def test_explore_event_records_provenance(tmp_path) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    server = build_server("127.0.0.1", 0, root=tmp_path)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    try:
        response = post_json(
            f"{base}/api/explore/event",
            {
                "event_type": "rate",
                "participant_id": "p-123",
                "session_id": "s-456",
                "stimulus_id": "abcdef0123456789",
                "app_version": "sound-studio-0.2.0",
                "client_ts": "2026-07-03T10:00:00.000Z",
                "parameters": {"seed": 42, "tempo": 104},
                "rating": 6,
                "rating_latency_ms": 5400,
                "play_count": 3,
            },
        )
        assert response["ok"] is True

        events_path = tmp_path / "web" / "data" / "explore_events.jsonl"
        lines = events_path.read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        event = json.loads(lines[0])
        assert event["schema_version"] == "explore-event-1.0"
        assert event["event_type"] == "rate"
        assert event["session_id"] == "s-456"
        assert event["stimulus_id"] == "abcdef0123456789"
        assert event["app_version"] == "sound-studio-0.2.0"
        assert event["client_ts"] == "2026-07-03T10:00:00.000Z"
        assert event["rating"] == 6
        assert event["rating_latency_ms"] == 5400
        assert event["play_count"] == 3
        assert event["parameters"]["seed"] == 42
    finally:
        server.shutdown()
        server.server_close()


def test_concurrent_explore_events_do_not_corrupt_jsonl(tmp_path) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    server = build_server("127.0.0.1", 0, root=tmp_path, rate_limit_per_minute=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    n_threads, n_posts = 8, 5
    errors: list[Exception] = []

    def worker(worker_id: int) -> None:
        for i in range(n_posts):
            try:
                post_json(
                    f"{base}/api/explore/event",
                    {"event_type": "play", "participant_id": f"w{worker_id}", "play_count": i},
                )
            except Exception as exc:  # pragma: no cover - captured for assertion
                errors.append(exc)

    try:
        workers = [threading.Thread(target=worker, args=(w,)) for w in range(n_threads)]
        for t in workers:
            t.start()
        for t in workers:
            t.join()
        assert not errors
        lines = (tmp_path / "web" / "data" / "explore_events.jsonl").read_text(
            encoding="utf-8"
        ).strip().splitlines()
        assert len(lines) == n_threads * n_posts
        for line in lines:
            json.loads(line)  # every line is intact JSON
    finally:
        server.shutdown()
        server.server_close()


def test_health_reports_deployment_state(tmp_path, monkeypatch) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    monkeypatch.setenv("PHASE0_ADMIN_TOKEN", "sekrit")
    server = build_server("127.0.0.1", 0, root=tmp_path)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    try:
        health = get_json(f"http://{host}:{port}/api/health")
        assert health["ok"] is True
        assert health["data_dir_writable"] is True
        assert health["cache_dir_writable"] is True
        assert health["export_enabled"] is True
        assert health["rate_limit_per_minute"] == 120
    finally:
        server.shutdown()
        server.server_close()


def test_post_rate_limit(tmp_path) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    server = build_server("127.0.0.1", 0, root=tmp_path, rate_limit_per_minute=3)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    try:
        for _ in range(3):
            post_json(f"{base}/api/explore/event", {"event_type": "play"})
        try:
            post_json(f"{base}/api/explore/event", {"event_type": "play"})
            raised = False
        except urllib.error.HTTPError as exc:
            raised = True
            assert exc.code == 429
        assert raised
    finally:
        server.shutdown()
        server.server_close()


def _static(tmp_path) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    (tmp_path / "web" / "static" / "login.html").write_text("login", encoding="utf-8")


def _start(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host, port = server.server_address
    return f"http://{host}:{port}"


def _post_raw(url: str, payload: dict, cookie: str = ""):
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST"
    )
    try:
        resp = urllib.request.urlopen(request, timeout=20)
        return resp.status, json.loads(resp.read().decode("utf-8")), resp
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8")), exc


def test_feedback_endpoint_appends_report_and_screenshot(tmp_path) -> None:
    _static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    base = _start(server)
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
    try:
        import base64 as b64
        status, body, _ = _post_raw(f"{base}/api/feedback", {
            "description": "The drum editor froze after undo.",
            "category": "bug",
            "route": "#produce",
            "app_version": "test-1.0",
            "errors": ["TypeError: x is undefined (app.js:12)"],
            "image_base64": b64.b64encode(png).decode(),
        })
        assert status == 201 and body["ok"] is True

        # Missing description is rejected.
        assert _post_raw(f"{base}/api/feedback", {"description": ""})[0] == 400
        # Garbage screenshot is rejected.
        assert _post_raw(f"{base}/api/feedback", {
            "description": "x", "image_base64": b64.b64encode(b"notanimage").decode(),
        })[0] == 400

        lines = (tmp_path / "web" / "data" / "feedback.jsonl").read_text().splitlines()
        assert len(lines) == 1
        record = json.loads(lines[0])
        assert record["description"].startswith("The drum editor froze")
        assert record["errors"] == ["TypeError: x is undefined (app.js:12)"]
        shot = tmp_path / "web" / "data" / "feedback_shots" / record["screenshot"]
        assert shot.read_bytes() == png

        # Feedback rides the admin export like every other table.
        server.admin_token = "sekrit"
        with urllib.request.urlopen(f"{base}/api/export.csv?table=feedback&token=sekrit") as resp:
            csv_text = resp.read().decode("utf-8")
        assert "The drum editor froze" in csv_text
    finally:
        server.shutdown()
        server.server_close()


def test_security_headers_on_html_and_json(tmp_path) -> None:
    _static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    base = _start(server)
    try:
        with urllib.request.urlopen(f"{base}/") as resp:
            assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
            assert resp.headers["X-Frame-Options"] == "DENY"
            assert resp.headers["X-Content-Type-Options"] == "nosniff"
            assert resp.headers["Referrer-Policy"] == "same-origin"
        with urllib.request.urlopen(f"{base}/api/health") as resp:
            assert resp.headers["X-Content-Type-Options"] == "nosniff"
            assert resp.headers.get("Content-Security-Policy") is None
    finally:
        server.shutdown()
        server.server_close()


def test_login_backoff_blocks_after_repeated_failures(tmp_path) -> None:
    _static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.accounts.register(
        "carol@x.com", "correct-horse", invite_code=None, require_invite=False
    )
    base = _start(server)
    try:
        for _ in range(5):
            status, body, _ = _post_raw(f"{base}/api/auth/login",
                                        {"email": "carol@x.com", "password": "wrong"})
            assert status == 401
        # Sixth attempt is refused outright — even with the right password.
        status, body, _ = _post_raw(f"{base}/api/auth/login",
                                    {"email": "carol@x.com", "password": "correct-horse"})
        assert status == 429
        # A different account on the same IP is unaffected.
        server.accounts.register(
            "dave@x.com", "password1", invite_code=None, require_invite=False
        )
        assert _post_raw(f"{base}/api/auth/login",
                         {"email": "dave@x.com", "password": "password1"})[0] == 200
    finally:
        server.shutdown()
        server.server_close()


def test_session_tokens_stored_hashed(tmp_path) -> None:
    _static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.open_signup = True
    base = _start(server)
    try:
        status, body, resp = _post_raw(f"{base}/api/auth/register",
                                       {"email": "erin@x.com", "password": "password1"})
        assert status == 201
        cookie = resp.headers["Set-Cookie"].split(";", 1)[0]
        raw_token = cookie.split("=", 1)[1]

        import sqlite3
        conn = sqlite3.connect(tmp_path / "web" / "data" / "accounts.db")
        stored = [r[0] for r in conn.execute("SELECT token FROM sessions")]
        conn.close()
        assert len(stored) == 1
        assert stored[0] != raw_token          # never the bearer token itself
        assert len(stored[0]) == 64            # sha256 hex digest
        # ...and the cookie still authenticates.
        request = urllib.request.Request(f"{base}/api/patches", headers={"Cookie": cookie})
        with urllib.request.urlopen(request, timeout=20) as r:
            assert json.loads(r.read())["patches"] == []
    finally:
        server.shutdown()
        server.server_close()


def test_locked_deployment_keeps_landing_public(tmp_path) -> None:
    _static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.auth_required = True
    base = _start(server)
    try:
        # The app shell and login page load without a session...
        with urllib.request.urlopen(f"{base}/") as resp:
            assert resp.status == 200
        with urllib.request.urlopen(f"{base}/login") as resp:
            assert resp.status == 200
        # ...but data APIs stay gated.
        try:
            urllib.request.urlopen(f"{base}/api/patches")
            raised = False
        except urllib.error.HTTPError as exc:
            raised = True
            assert exc.code == 401
        assert raised
    finally:
        server.shutdown()
        server.server_close()
