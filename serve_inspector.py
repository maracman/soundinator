"""Lightweight localhost server for inspecting rendered experiment stimuli."""

import json
import mimetypes
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
STIMULI_DIR = ROOT / "stimuli"
PORT = int(os.environ.get("PORT", "8800"))

MODE_DIRS = {
    "A": "mode_a",
    "B": "mode_b",
    "C": "mode_c",
    "D": "mode_d",
    "E": "mode_e",
    "F": "mode_f",
    "G": "mode_g",
    "H": "mode_h",
    "I": "mode_i",
}


def build_manifest():
    manifest = []
    for mode_key, dirname in sorted(MODE_DIRS.items()):
        mode_path = STIMULI_DIR / dirname
        if not mode_path.is_dir():
            continue
        files = sorted(f.name for f in mode_path.iterdir() if f.is_file())
        manifest.append({"mode": mode_key, "dir": dirname, "files": files})
    return manifest


class Handler(BaseHTTPRequestHandler):
    server_version = "SynthInspector/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path == "/" or path == "/index.html":
            self.serve_file(STIMULI_DIR / "inspect.html")
        elif path == "/api/manifest":
            self.send_json(build_manifest())
        elif path.startswith("/stimuli/"):
            rel = path.removeprefix("/stimuli/")
            self.serve_file(STIMULI_DIR / rel)
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def serve_file(self, filepath: Path):
        try:
            resolved = filepath.resolve()
            if not (resolved == STIMULI_DIR.resolve() or STIMULI_DIR.resolve() in resolved.parents):
                self.send_error(HTTPStatus.FORBIDDEN)
                return
            if not resolved.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            content_type = mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
            data = resolved.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)
        except BrokenPipeError:
            pass

    def send_json(self, data):
        encoded = json.dumps(data, sort_keys=True).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"\n  Experiment Synthesiser Inspector")
    print(f"  http://127.0.0.1:{PORT}\n")
    print(f"  Serving {sum(1 for d in STIMULI_DIR.iterdir() if d.is_dir())} mode directories")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
