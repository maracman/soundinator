"""Phase 0 web experiment server.

Serves both arms of the Phase 0 population-mapping study:

  Arm 1 (Study)   – receives structured trial data (slider / pairwise paradigms)
  Arm 2 (Explore) – hosts the free-play Sound Studio, manages global presets

Audio rendering is client-side via Web Audio; the server's role is data
collection, preset management, and static file serving.  Server-side rendering
via the Python synth is still available for validation and the preset library.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import tempfile
import threading
import time

try:
    import fcntl
except ImportError:  # non-POSIX platform; appends fall back to unlocked
    fcntl = None
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import hmac
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

from synthesiser.web.phase0 import (
    PHASE0_SCHEMA_VERSION,
    SYNTH_VERSION_HASH,
    Phase0Parameters,
    render_phase0_preset,
)


# Version stamp for records appended to explore_events.jsonl; bump on any
# field addition/rename so exports can branch on record shape.
EXPLORE_EVENT_SCHEMA_VERSION = "explore-event-1.0"


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def truncate_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    """Append one record to a JSONL file under an exclusive file lock.

    The lock covers concurrent processes as well as this server's threads, so
    simultaneous submissions cannot interleave partial lines.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        if fcntl is not None:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
            handle.flush()
        finally:
            if fcntl is not None:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def as_number(value: Any) -> float | int | None:
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def as_dict(value: Any) -> dict[str, Any] | None:
    return value if isinstance(value, dict) else None


def read_json_file(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(data, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temp_name = handle.name
    Path(temp_name).replace(path)


class Phase0RequestHandler(BaseHTTPRequestHandler):
    server_version = "Phase0/0.2"

    @property
    def roots(self) -> dict[str, Path]:
        return self.server.roots  # type: ignore[attr-defined]

    # ── GET routes ──────────────────────────────────────────

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            self.send_json({
                "ok": True,
                "phase0_schema_version": PHASE0_SCHEMA_VERSION,
                "synth_version_hash": SYNTH_VERSION_HASH,
            })
            return

        if path == "/api/presets/global":
            self.send_json(read_json_file(self.roots["library"], []))
            return

        # Admin data export: /api/export.csv?table=ratings&token=...
        # Requires PHASE0_ADMIN_TOKEN to be set server-side; disabled otherwise.
        if path == "/api/export.csv":
            self.handle_export(parse_qs(parsed.query))
            return

        # Legacy alias
        if path == "/api/global-presets":
            self.send_json(read_json_file(self.roots["library"], []))
            return

        if path.startswith("/api/cache/"):
            self.serve_file(self.roots["cache"] / Path(unquote(path.removeprefix("/api/cache/"))).name)
            return

        # Static files
        if path == "/":
            self.serve_file(self.roots["static"] / "index.html")
            return

        static_path = self.roots["static"] / path.lstrip("/")
        self.serve_file(static_path)

    # ── POST routes ─────────────────────────────────────────

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if not self.check_rate_limit():
            self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, "rate limit exceeded")
            return
        try:
            payload = self.read_json_body()

            if parsed.path == "/api/study/submit":
                self.handle_study_submit(payload)
                return

            if parsed.path == "/api/render":
                self.handle_render(payload)
                return

            if parsed.path in ("/api/presets/contribute", "/api/global-presets"):
                self.handle_contribute(payload)
                return

            if parsed.path in ("/api/explore/event", "/api/session-events"):
                self.handle_explore_event(payload)
                return

            self.send_error_json(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception as exc:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"server error: {exc}")

    # ── Arm 1: Study data collection ────────────────────────

    def handle_study_submit(self, payload: dict[str, Any]) -> None:
        """Receive a complete study session (all trials + demographics)."""
        entry = {
            "id": uuid4().hex,
            "schema_version": "study-session-1.0",
            "received_at": datetime.now(timezone.utc).isoformat(),
            "participant_id": truncate_text(payload.get("participant_id"), 60),
            "paradigm": truncate_text(payload.get("paradigm"), 20),
            "demographics": as_dict(payload.get("demographics")) or {},
            "headphone_passed": bool(payload.get("headphone_passed")),
            "responses": payload.get("responses", []),
            "total_time_ms": as_number(payload.get("total_time_ms")),
            "submitted_at": truncate_text(payload.get("submitted_at"), 40),
        }

        append_jsonl(self.roots["study_data"], entry)

        n = len(entry["responses"])
        print(f"  Study session received: {entry['paradigm']}, {n} responses, "
              f"participant={entry['participant_id'][:8]}...")

        self.send_json({"ok": True, "session_id": entry["id"], "response_count": n},
                       status=HTTPStatus.CREATED)

    # ── Arm 2: Explore endpoints ────────────────────────────

    def handle_render(self, payload: dict[str, Any]) -> None:
        """Server-side render (kept for validation / high-fidelity re-renders)."""
        parameters = Phase0Parameters.from_mapping(payload.get("parameters", payload))
        sidecar = render_phase0_preset(parameters, output_dir=self.roots["cache"])
        self.send_json({
            "preset_hash": sidecar["preset_hash"],
            "audio_url": f"/api/cache/{sidecar['paths']['wav']}",
            "sidecar_url": f"/api/cache/{sidecar['paths']['sidecar']}",
            "parameters": parameters.to_dict(),
            "qc": sidecar.get("qc", {}),
            "phase0_schema_version": PHASE0_SCHEMA_VERSION,
            "synth_version_hash": SYNTH_VERSION_HASH,
        })

    def handle_contribute(self, payload: dict[str, Any]) -> None:
        """Add a preset to the global shared library."""
        if payload.get("share_consent") is not True:
            raise ValueError("share_consent must be true")

        # Store parameters as-is (validated client-side, supports new 3-timescale schema)
        parameters = payload.get("parameters", {})
        if not isinstance(parameters, dict):
            raise ValueError("parameters must be a dict")

        phase0_keys = {
            "tempo_bpm", "motif_entropy", "octave_division", "scale_size",
            "scale_geometry", "note_density", "steps", "tonic_hz", "octave",
            "timbre", "seed",
        }
        if payload.get("preset_hash"):
            preset_hash = truncate_text(payload.get("preset_hash"), 80)
        elif set(parameters).issubset(phase0_keys):
            preset_hash = Phase0Parameters.from_mapping(parameters).hash()
        else:
            encoded = json.dumps(parameters, sort_keys=True, separators=(",", ":")).encode("utf-8")
            preset_hash = hashlib.sha256(encoded).hexdigest()[:20]

        entry = {
            "id": uuid4().hex,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "preset_name": truncate_text(payload.get("preset_name"), 80) or "Untitled",
            "participant_alias": truncate_text(payload.get("participant_alias"), 60),
            "notes": truncate_text(payload.get("notes"), 400),
            "favourite_rating": float(payload.get("favourite_rating", 0) or 0),
            "parameters": parameters,
            "preset_hash": preset_hash,
            "stimulus_id": truncate_text(payload.get("stimulus_id"), 80),
            "session_id": truncate_text(payload.get("session_id"), 60),
            "app_version": truncate_text(payload.get("app_version"), 40),
            "phase0_schema_version": PHASE0_SCHEMA_VERSION,
        }

        library = read_json_file(self.roots["library"], [])
        library.insert(0, entry)
        write_json_atomic(self.roots["library"], library[:1000])
        self.send_json({"ok": True, "entry": entry}, status=HTTPStatus.CREATED)

    def handle_export(self, query: dict[str, list[str]]) -> None:
        """Serve a CSV table of collected data, gated on the admin token."""
        expected = getattr(self.server, "admin_token", "") or ""
        supplied = (query.get("token") or [""])[0]
        if not expected:
            self.send_error_json(HTTPStatus.FORBIDDEN, "export disabled: PHASE0_ADMIN_TOKEN not set")
            return
        if not hmac.compare_digest(supplied, expected):
            self.send_error_json(HTTPStatus.FORBIDDEN, "invalid token")
            return
        from synthesiser.web.export import TABLES, build_table

        table = (query.get("table") or ["ratings"])[0]
        if table not in TABLES:
            self.send_error_json(
                HTTPStatus.BAD_REQUEST, f"unknown table {table!r}; expected one of {', '.join(TABLES)}"
            )
            return
        csv_text = build_table(table, self.roots["events"].parent)
        encoded = csv_text.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{table}.csv"')
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def handle_explore_event(self, payload: dict[str, Any]) -> None:
        """Log an explore-mode interaction event."""
        event = {
            "id": uuid4().hex,
            "schema_version": EXPLORE_EVENT_SCHEMA_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "event_type": truncate_text(payload.get("event_type"), 40),
            "participant_id": truncate_text(payload.get("participant_id"), 60),
            "session_id": truncate_text(payload.get("session_id"), 60),
            "stimulus_id": truncate_text(payload.get("stimulus_id"), 80),
            "app_version": truncate_text(payload.get("app_version"), 40),
            "client_ts": truncate_text(payload.get("client_ts"), 40),
            "parameters": as_dict(payload.get("parameters")),
            "rating": as_number(payload.get("rating")),
            "rating_latency_ms": as_number(payload.get("rating_latency_ms")),
            "play_count": as_number(payload.get("play_count")),
            "metrics": as_dict(payload.get("metrics")),
            "consent": as_dict(payload.get("consent")),
            "changes": as_dict(payload.get("changes")),
        }
        append_jsonl(self.roots["events"], event)
        self.send_json({"ok": True})

    # ── File serving ────────────────────────────────────────

    def serve_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            allowed = [self.roots["static"].resolve(), self.roots["cache"].resolve()]
            if not any(resolved == r or r in resolved.parents for r in allowed):
                self.send_error_json(HTTPStatus.FORBIDDEN, "forbidden")
                return
            if not resolved.is_file():
                self.send_error_json(HTTPStatus.NOT_FOUND, "not found")
                return

            content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
            # Ensure .js files get the right MIME type for ES modules
            if resolved.suffix == ".js":
                content_type = "application/javascript"

            data = resolved.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except BrokenPipeError:
            return

    # ── JSON helpers ────────────────────────────────────────

    def check_rate_limit(self) -> bool:
        """Sliding one-minute window per client IP across all POST routes."""
        server = self.server
        limit = getattr(server, "rate_limit_per_minute", 0)
        if not limit:
            return True
        now = time.monotonic()
        ip = self.client_address[0]
        with server.rate_lock:  # type: ignore[attr-defined]
            window = server.rate_state.setdefault(ip, [])  # type: ignore[attr-defined]
            cutoff = now - 60.0
            while window and window[0] < cutoff:
                window.pop(0)
            if len(window) >= limit:
                return False
            window.append(now)
        return True

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        if length > 512_000:
            raise ValueError("request body too large")
        raw = self.rfile.read(length).decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    def send_json(self, data: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(data, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(encoded)

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"ok": False, "error": message}, status=status)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"  {self.address_string()} - {format % args}")


# ── Server factory ──────────────────────────────────────────

def build_server(
    host: str,
    port: int,
    root: Path | None = None,
    data_dir: Path | None = None,
    cache_dir: Path | None = None,
    rate_limit_per_minute: int | None = None,
) -> ThreadingHTTPServer:
    root = root or project_root()
    data = data_dir or root / "web" / "data"
    roots = {
        "root": root,
        "static": root / "web" / "static",
        "cache": cache_dir or root / "web" / "cache",
        "library": data / "global_presets.json",
        "events": data / "explore_events.jsonl",
        "study_data": data / "study_sessions.jsonl",
    }
    roots["cache"].mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)
    if not roots["library"].exists():
        write_json_atomic(roots["library"], [])
    server = ThreadingHTTPServer((host, port), Phase0RequestHandler)
    server.roots = roots  # type: ignore[attr-defined]
    if rate_limit_per_minute is None:
        rate_limit_per_minute = int(os.environ.get("PHASE0_RATE_LIMIT", "120"))
    server.rate_limit_per_minute = rate_limit_per_minute  # type: ignore[attr-defined]
    server.rate_state = {}  # type: ignore[attr-defined]
    server.rate_lock = threading.Lock()  # type: ignore[attr-defined]
    server.admin_token = os.environ.get("PHASE0_ADMIN_TOKEN", "")  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="synthesiser-web")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8765")))
    parser.add_argument("--data-dir", default=os.environ.get("PHASE0_DATA_DIR"))
    parser.add_argument("--cache-dir", default=os.environ.get("PHASE0_CACHE_DIR"))
    args = parser.parse_args(argv)
    server = build_server(
        args.host,
        args.port,
        data_dir=Path(args.data_dir) if args.data_dir else None,
        cache_dir=Path(args.cache_dir) if args.cache_dir else None,
    )
    print(f"\n  Phase 0 Web Experiment")
    print(f"  http://{args.host}:{args.port}")
    print(f"")
    print(f"  Arm 1 (Study)  : consent -> demographics -> headphones -> paradigm -> debrief")
    print(f"  Arm 2 (Explore): real-time Web Audio synth + preset library")
    print(f"  Data directory : {server.roots['study_data'].parent}")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
