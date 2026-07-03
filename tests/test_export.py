import csv
import io
import json
import os
import threading
import urllib.error
import urllib.request

from synthesiser.web.export import (
    build_table,
    export_all,
    export_ratings,
    export_stimuli,
    flatten_event,
)
from synthesiser.web.server import build_server


EVENT = {
    "id": "e1",
    "schema_version": "explore-event-1.0",
    "created_at": "2026-07-03T10:00:00+00:00",
    "event_type": "rate",
    "participant_id": "p-1",
    "session_id": "s-1",
    "stimulus_id": "abc123",
    "app_version": "sound-studio-0.2.0",
    "client_ts": "2026-07-03T10:00:00.000Z",
    "parameters": {"seed": 42, "tempo": 104, "rootNotes": [0, 4]},
    "rating": 6,
    "rating_latency_ms": 5400,
    "play_count": 3,
    "metrics": {"mean_pitch_surprisal_bits": 5.6, "repetition_ratio": 0.8},
    "consent": None,
    "changes": None,
}


def _write_events(tmp_path, events):
    data_dir = tmp_path / "web" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    with (data_dir / "explore_events.jsonl").open("w", encoding="utf-8") as fh:
        for e in events:
            fh.write(json.dumps(e) + "\n")
    return data_dir


def test_flatten_event_prefixes_nested_fields() -> None:
    row = flatten_event(EVENT)
    assert row["param_seed"] == 42
    assert row["param_rootNotes"] == "[0,4]"
    assert row["metric_repetition_ratio"] == 0.8
    assert row["rating"] == 6
    assert "parameters" not in row


def test_ratings_and_stimuli_tables(tmp_path) -> None:
    play = {**EVENT, "id": "e0", "event_type": "play", "rating": None}
    dup = {**EVENT, "id": "e2"}  # same stimulus_id — deduped in stimuli
    other = {
        **EVENT,
        "id": "e3",
        "event_type": "play",
        "stimulus_id": "def456",
        "parameters": {"seed": 43, "tempo": 120},
    }
    data_dir = _write_events(tmp_path, [play, EVENT, dup, other])

    ratings_csv = build_table("ratings", data_dir)
    rows = list(csv.DictReader(io.StringIO(ratings_csv)))
    assert len(rows) == 2  # only event_type == "rate"
    assert rows[0]["stimulus_id"] == "abc123"
    assert rows[0]["metric_mean_pitch_surprisal_bits"] == "5.6"

    stimuli = export_stimuli([play, EVENT, dup, other])
    assert len(stimuli) == 2
    by_id = {s["stimulus_id"]: s for s in stimuli}
    # Regeneration bundle: the full parameter set incl. seed survives exactly
    assert by_id["abc123"]["seed"] == 42
    assert by_id["def456"]["param_tempo"] == 120


def test_export_all_writes_five_tables(tmp_path) -> None:
    data_dir = _write_events(tmp_path, [EVENT])
    out = tmp_path / "exports"
    written = export_all(data_dir, out)
    assert set(written) == {"events", "ratings", "stimuli", "study_trials", "presets"}
    for path in written.values():
        assert path.exists()


def test_export_skips_corrupt_lines(tmp_path) -> None:
    data_dir = _write_events(tmp_path, [EVENT])
    with (data_dir / "explore_events.jsonl").open("a", encoding="utf-8") as fh:
        fh.write('{"torn json...\n')
        fh.write(json.dumps({**EVENT, "id": "e9"}) + "\n")
    csv_text = build_table("events", data_dir)
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    assert [r["id"] for r in rows] == ["e1", "e9"]


def test_export_endpoint_requires_token(tmp_path, monkeypatch) -> None:
    (tmp_path / "web" / "static").mkdir(parents=True)
    (tmp_path / "web" / "static" / "index.html").write_text("ok", encoding="utf-8")
    _write_events(tmp_path, [EVENT])
    monkeypatch.setenv("PHASE0_ADMIN_TOKEN", "sekrit")
    server = build_server("127.0.0.1", 0, root=tmp_path)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    try:
        # no token → 403
        try:
            urllib.request.urlopen(f"{base}/api/export.csv?table=ratings", timeout=10)
            raised = False
        except urllib.error.HTTPError as exc:
            raised = True
            assert exc.code == 403
        assert raised
        # good token → CSV with the rating row
        with urllib.request.urlopen(
            f"{base}/api/export.csv?table=ratings&token=sekrit", timeout=10
        ) as response:
            body = response.read().decode("utf-8")
            assert response.headers["Content-Type"].startswith("text/csv")
        rows = list(csv.DictReader(io.StringIO(body)))
        assert len(rows) == 1
        assert rows[0]["stimulus_id"] == "abc123"
    finally:
        server.shutdown()
        server.server_close()
