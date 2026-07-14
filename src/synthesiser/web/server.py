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
import base64
import hashlib
import json
import mimetypes
import os
import tempfile
import threading
import time
import traceback

try:
    import fcntl
except ImportError:  # non-POSIX platform; appends fall back to unlocked
    fcntl = None
from datetime import datetime, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
import hmac
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

from synthesiser.web.accounts import (
    MIN_PASSWORD_LENGTH,
    SESSION_TTL_DAYS,
    AccountError,
    AccountStore,
)
from synthesiser.web.community import (
    CommunityRateLimited,
    CommunityRoutes,
    CommunityStore,
)
from synthesiser.web import mailer
from synthesiser.web.phase0 import (
    PHASE0_SCHEMA_VERSION,
    SYNTH_VERSION_HASH,
    Phase0Parameters,
    render_phase0_preset,
)


# Version stamp for records appended to explore_events.jsonl; bump on any
# field addition/rename so exports can branch on record shape.
EXPLORE_EVENT_SCHEMA_VERSION = "explore-event-1.0"

# Name of the session cookie set on sign-in.
SESSION_COOKIE = "resona_session"

# Sentinel so current_user() can cache a None result for the request's lifetime.
_UNSET = object()

# Feedback ("report a problem") limits: keep the JSONL rows bounded and the
# optional screenshot comfortably under the 1 MB request-body cap once
# base64-decoded.
FEEDBACK_MAX_DESCRIPTION = 4000
FEEDBACK_MAX_ERRORS = 30
FEEDBACK_MAX_ERROR_CHARS = 600
FEEDBACK_MAX_IMAGE_BYTES = 600_000

# Login backoff: after this many failed attempts for the same (IP, email)
# within the window, sign-in is refused until the window slides past.
LOGIN_MAX_FAILURES = 5
LOGIN_FAILURE_WINDOW_S = 900.0

# Screenshot formats accepted by /api/feedback, sniffed from decoded bytes.
_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"\xff\xd8\xff", ".jpg"),
)


def _sniff_image_ext(blob: bytes) -> str:
    for magic, ext in _IMAGE_MAGIC:
        if blob.startswith(magic):
            return ext
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return ".webp"
    raise ValueError("screenshot must be a PNG, JPEG, or WebP image")


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


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


class Phase0RequestHandler(CommunityRoutes, BaseHTTPRequestHandler):
    server_version = "Phase0/0.2"

    @property
    def roots(self) -> dict[str, Path]:
        return self.server.roots  # type: ignore[attr-defined]

    # ── GET routes ──────────────────────────────────────────

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        # ── Auth surfaces (always available, even in auth-required mode) ──
        if path in ("/login", "/login.html"):
            self.serve_file(self.roots["static"] / "login.html")
            return

        if path == "/reset":
            self.serve_file(self.roots["static"] / "reset.html")
            return

        # Email-verification landing: consume the token, bounce to the app.
        if path == "/verify":
            token = (parse_qs(parsed.query).get("token") or [""])[0]
            store = self._accounts()
            user_id = store.consume_email_token(token, "verify")
            if user_id is None:
                self.redirect("/?verified=expired")
                return
            store.mark_email_verified(user_id)
            print(f"  Email verified for user #{user_id}")
            self.redirect("/?verified=1")
            return

        if path == "/api/auth/me":
            self.send_json({
                "user": self.current_user(),
                "auth_required": bool(getattr(self.server, "auth_required", False)),
                "open_signup": bool(getattr(self.server, "open_signup", False)),
                "features": {
                    "experiments": bool(getattr(self.server, "experiments", False)),
                    "community": True,
                },
            })
            return

        # ── Access gate (no-op unless RESONA_AUTH_REQUIRED is set) ──
        if self._page_requires_login(path) and not self.current_user():
            self.redirect("/login")
            return
        if self._api_requires_auth(path) and not self.current_user():
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "authentication required")
            return

        if path == "/api/patches":
            self.handle_patches_list()
            return

        # Community: profiles, shared items, ratings, per-user libraries.
        # The gate above guarantees a signed-in user on every one of these.
        try:
            if self.handle_community_get(path, parse_qs(parsed.query)):
                return
        except CommunityRateLimited as exc:
            self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, str(exc))
            return
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return

        if path == "/api/health":
            data_dir = self.roots["events"].parent
            cache_dir = self.roots["cache"]
            self.send_json({
                "ok": True,
                "phase0_schema_version": PHASE0_SCHEMA_VERSION,
                "synth_version_hash": SYNTH_VERSION_HASH,
                "explore_event_schema_version": EXPLORE_EVENT_SCHEMA_VERSION,
                "data_dir": str(data_dir),
                "data_dir_writable": os.access(data_dir, os.W_OK),
                "cache_dir_writable": os.access(cache_dir, os.W_OK),
                "rate_limit_per_minute": getattr(self.server, "rate_limit_per_minute", None),
                "export_enabled": bool(getattr(self.server, "admin_token", "")),
            })
            return

        # Legacy anonymous preset library (superseded by the community layer);
        # only served when the experiment surfaces are enabled.
        if path in ("/api/presets/global", "/api/global-presets"):
            if not getattr(self.server, "experiments", False):
                self.send_error_json(HTTPStatus.NOT_FOUND, "unknown endpoint")
                return
            self.send_json(read_json_file(self.roots["library"], []))
            return

        # Admin data export: /api/export.csv?table=ratings&token=...
        # Requires PHASE0_ADMIN_TOKEN to be set server-side; disabled otherwise.
        if path == "/api/export.csv":
            self.handle_export(parse_qs(parsed.query))
            return

        if path.startswith("/api/cache/"):
            self.serve_file(self.roots["cache"] / Path(unquote(path.removeprefix("/api/cache/"))).name)
            return

        # The producer's five-part notation badge is authored as PNG
        # layers outside the generated/static bundle so the artwork remains
        # directly editable. Expose only those named image files here.
        if path.startswith("/saem-icons/"):
            name = Path(unquote(path.removeprefix("/saem-icons/"))).name
            self.serve_file(self.roots["saem_icons"] / name)
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

            # ── Auth endpoints (open even when the app is locked) ──
            if parsed.path == "/api/auth/register":
                self.handle_register(payload)
                return
            if parsed.path == "/api/auth/login":
                self.handle_login(payload)
                return
            if parsed.path == "/api/auth/logout":
                self.handle_logout()
                return
            if parsed.path == "/api/auth/resend-verification":
                self.handle_resend_verification()
                return
            if parsed.path == "/api/auth/request-reset":
                self.handle_request_reset(payload)
                return
            if parsed.path == "/api/auth/reset":
                self.handle_password_reset(payload)
                return

            # ── Access gate for every other POST endpoint ──
            if self._api_requires_auth(parsed.path) and not self.current_user():
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "authentication required")
                return

            if parsed.path == "/api/patches":
                self.handle_patch_save(payload)
                return

            if parsed.path == "/api/feedback":
                self.handle_feedback(payload)
                return

            if self.handle_community_post(parsed.path, payload):
                return

            # Legacy study submission + anonymous preset contribution: only
            # accepted while the experiment surfaces are enabled.
            if parsed.path in ("/api/study/submit", "/api/presets/contribute", "/api/global-presets"):
                if not getattr(self.server, "experiments", False):
                    self.send_error_json(HTTPStatus.NOT_FOUND, "unknown endpoint")
                    return
                if parsed.path == "/api/study/submit":
                    self.handle_study_submit(payload)
                else:
                    self.handle_contribute(payload)
                return

            if parsed.path == "/api/render":
                self.handle_render(payload)
                return

            if parsed.path in ("/api/explore/event", "/api/session-events"):
                self.handle_explore_event(payload)
                return

            self.send_error_json(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except CommunityRateLimited as exc:
            self.send_error_json(HTTPStatus.TOO_MANY_REQUESTS, str(exc))
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except Exception:
            # Never echo internals to the client; the traceback goes to the
            # server log where it belongs.
            print(f"  ! unhandled error on POST {parsed.path}\n{traceback.format_exc()}")
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "internal server error")

    # ── DELETE routes ───────────────────────────────────────

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if self._api_requires_auth(path) and not self.current_user():
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "authentication required")
            return
        try:
            if path.startswith("/api/patches/"):
                self.handle_patch_delete(unquote(path.removeprefix("/api/patches/")))
                return
            if self.handle_community_delete(path):
                return
        except ValueError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "unknown endpoint")

    # ── Accounts: sessions, invite-gated registration, patches ──

    def _accounts(self) -> AccountStore:
        store = getattr(self.server, "accounts", None)
        if store is None:
            raise ValueError("accounts backend not configured")
        return store

    def _session_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def current_user(self) -> dict[str, Any] | None:
        cached = getattr(self, "_user_cache", _UNSET)
        if cached is not _UNSET:
            return cached
        store = getattr(self.server, "accounts", None)
        user = store.user_for_session(self._session_token()) if store else None
        self._user_cache = user
        return user

    def _page_requires_login(self, path: str) -> bool:
        """True when an unauthenticated page load should bounce to /login.

        The app shell ("/") stays viewable even on a locked deployment so
        visitors land on the welcome screen; the client shows the invite-only
        notice when they try to enter the studio, and every data API below is
        still session-gated.
        """
        if not getattr(self.server, "auth_required", False):
            return False
        if path in ("/", "/index.html", "/login", "/login.html"):
            return False
        return path.endswith(".html")

    def _api_requires_auth(self, path: str) -> bool:
        """True when an API call must carry a valid session.

        Patch, community, and profile endpoints always require a signed-in
        owner (the community is invite-only even on an open deployment); every
        other API requires auth only when the whole app is locked
        (RESONA_AUTH_REQUIRED). Health and the auth endpoints stay open.
        """
        if path.startswith(("/api/patches", "/api/community", "/api/profile", "/api/users")):
            return True
        if not getattr(self.server, "auth_required", False):
            return False
        if path == "/api/health" or path.startswith("/api/auth/"):
            return False
        return path.startswith("/api/")

    def _cookie_header(self, token: str, max_age: int) -> str:
        secure = "; Secure" if getattr(self.server, "cookie_secure", False) else ""
        return (f"{SESSION_COOKIE}={token}; Max-Age={max_age}; Path=/; "
                f"HttpOnly; SameSite=Lax{secure}")

    def _clear_cookie_header(self) -> str:
        secure = "; Secure" if getattr(self.server, "cookie_secure", False) else ""
        return f"{SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax{secure}"

    def redirect(self, location: str) -> None:
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def handle_register(self, payload: dict[str, Any]) -> None:
        store = self._accounts()
        open_signup = bool(getattr(self.server, "open_signup", False))
        try:
            user = store.register(
                payload.get("email", ""),
                payload.get("password", ""),
                invite_code=truncate_text(payload.get("invite_code"), 80) or None,
                handle=truncate_text(payload.get("handle"), 40) or None,
                require_invite=not open_signup,
            )
        except AccountError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self._send_verification_email(user)
        token = store.create_session(user["id"])
        self.send_json(
            {"ok": True, "user": user},
            status=HTTPStatus.CREATED,
            cookies=[self._cookie_header(token, SESSION_TTL_DAYS * 86400)],
        )

    def _login_backoff_key(self, email: str) -> str:
        return f"{self.client_address[0]}|{(email or '').strip().lower()}"

    def _login_blocked(self, email: str) -> bool:
        """Sliding-window failure counter per (IP, email).

        The global POST rate limit still allows thousands of guesses a day, so
        credential attempts get their own much tighter budget.
        """
        server = self.server
        now = time.monotonic()
        with server.rate_lock:  # type: ignore[attr-defined]
            window = server.login_failures.setdefault(self._login_backoff_key(email), [])  # type: ignore[attr-defined]
            cutoff = now - LOGIN_FAILURE_WINDOW_S
            while window and window[0] < cutoff:
                window.pop(0)
            return len(window) >= LOGIN_MAX_FAILURES

    def _login_note_failure(self, email: str) -> None:
        server = self.server
        with server.rate_lock:  # type: ignore[attr-defined]
            server.login_failures.setdefault(self._login_backoff_key(email), []).append(time.monotonic())  # type: ignore[attr-defined]

    def _login_clear_failures(self, email: str) -> None:
        server = self.server
        with server.rate_lock:  # type: ignore[attr-defined]
            server.login_failures.pop(self._login_backoff_key(email), None)  # type: ignore[attr-defined]

    def handle_login(self, payload: dict[str, Any]) -> None:
        store = self._accounts()
        email = payload.get("email", "")
        if self._login_blocked(email):
            self.send_error_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                "too many failed sign-in attempts — try again in a few minutes",
            )
            return
        user = store.authenticate(email, payload.get("password", ""))
        if not user:
            self._login_note_failure(email)
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "invalid email or password")
            return
        self._login_clear_failures(email)
        token = store.create_session(user["id"])
        self.send_json(
            {"ok": True, "user": user},
            cookies=[self._cookie_header(token, SESSION_TTL_DAYS * 86400)],
        )

    def handle_logout(self) -> None:
        store = getattr(self.server, "accounts", None)
        if store is not None:
            store.delete_session(self._session_token())
        self.send_json({"ok": True}, cookies=[self._clear_cookie_header()])

    # ── Email verification + password reset ─────────────────

    def _send_verification_email(self, user: dict[str, Any]) -> None:
        """Mail a fresh verify link; log it instead when email isn't set up."""
        token = self._accounts().create_email_token(user["id"], "verify")
        link = f"{mailer.public_url()}/verify?token={token}"
        sent = mailer.send_email(
            user["email"],
            "Confirm your Soundinator email",
            f"Hi {user['handle']},\n\n"
            "Click the link below to confirm this email address for your "
            "Soundinator account:\n\n"
            f"  {link}\n\n"
            "The link is valid for 48 hours. If you didn't create this "
            "account, you can ignore this email.\n",
        )
        if not sent:
            print(f"  Email not configured — verification link for {user['email']}: {link}")

    def handle_resend_verification(self) -> None:
        user = self.current_user()
        if not user:
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "authentication required")
            return
        if user.get("email_verified"):
            self.send_json({"ok": True, "already_verified": True})
            return
        self._send_verification_email(user)
        self.send_json({"ok": True, "email_sent": mailer.email_configured()})

    def handle_request_reset(self, payload: dict[str, Any]) -> None:
        """Start a password reset. Responds identically whether or not the
        address has an account, so the endpoint can't enumerate users."""
        store = self._accounts()
        user = store.user_by_email(str(payload.get("email", "")))
        if user is not None:
            token = store.create_email_token(user["id"], "reset")
            link = f"{mailer.public_url()}/reset?token={token}"
            sent = mailer.send_email(
                user["email"],
                "Reset your Soundinator password",
                f"Hi {user['handle']},\n\n"
                "Someone (hopefully you) asked to reset the password for this "
                "Soundinator account. Set a new one here:\n\n"
                f"  {link}\n\n"
                "The link is valid for 2 hours and works once. If this wasn't "
                "you, ignore this email — your password is unchanged.\n",
            )
            if not sent:
                print(f"  Email not configured — reset link for {user['email']}: {link}")
        self.send_json({"ok": True})

    def handle_password_reset(self, payload: dict[str, Any]) -> None:
        store = self._accounts()
        # Validate the new password BEFORE consuming the single-use token, so
        # a typo doesn't burn the emailed link.
        password = payload.get("password", "")
        if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
            self.send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"password must be at least {MIN_PASSWORD_LENGTH} characters",
            )
            return
        user_id = store.consume_email_token(
            truncate_text(payload.get("token"), 120), "reset"
        )
        if user_id is None:
            self.send_error_json(
                HTTPStatus.BAD_REQUEST, "this reset link has expired or was already used"
            )
            return
        try:
            store.set_password(user_id, password)
        except AccountError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        # Completing a reset proves control of the inbox on file.
        store.mark_email_verified(user_id)
        print(f"  Password reset completed for user #{user_id}")
        self.send_json({"ok": True})

    def handle_patches_list(self) -> None:
        store = self._accounts()
        user = self.current_user()  # gate guarantees a user here
        self.send_json({"patches": store.list_patches(user["id"])})

    def handle_patch_save(self, payload: dict[str, Any]) -> None:
        store = self._accounts()
        user = self.current_user()
        if payload.get("data") is None:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "data is required")
            return
        try:
            patch = store.save_patch(
                user["id"],
                name=truncate_text(payload.get("name"), 120),
                data=payload.get("data"),
                kind=truncate_text(payload.get("kind"), 40) or "preset",
                patch_id=truncate_text(payload.get("id"), 64) or None,
            )
        except AccountError as exc:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        self.send_json({"ok": True, "patch": patch}, status=HTTPStatus.CREATED)

    def handle_patch_delete(self, patch_id: str) -> None:
        store = self._accounts()
        user = self.current_user()
        if not store.delete_patch(user["id"], patch_id):
            self.send_error_json(HTTPStatus.NOT_FOUND, "patch not found")
            return
        self.send_json({"ok": True})

    # ── Feedback / bug reports ──────────────────────────────

    def handle_feedback(self, payload: dict[str, Any]) -> None:
        """Store one problem report: description, captured errors, optional screenshot.

        Appended to feedback.jsonl (exportable via /api/export.csv?table=feedback);
        the screenshot, if any, lands in data/feedback_shots/<id>.<ext>.
        """
        description = truncate_text(payload.get("description"), FEEDBACK_MAX_DESCRIPTION)
        if not description:
            raise ValueError("a description is required")

        errors_raw = payload.get("errors")
        errors = [
            truncate_text(e, FEEDBACK_MAX_ERROR_CHARS)
            for e in (errors_raw if isinstance(errors_raw, list) else [])[:FEEDBACK_MAX_ERRORS]
        ]

        report_id = uuid4().hex
        screenshot = None
        image_b64 = payload.get("image_base64")
        if image_b64:
            try:
                blob = base64.b64decode(str(image_b64), validate=True)
            except (ValueError, TypeError):
                raise ValueError("screenshot is not valid base64")
            if len(blob) > FEEDBACK_MAX_IMAGE_BYTES:
                raise ValueError("screenshot is too large (max ~600 KB)")
            ext = _sniff_image_ext(blob)
            shots_dir = self.roots["feedback"].parent / "feedback_shots"
            shots_dir.mkdir(parents=True, exist_ok=True)
            screenshot = f"{report_id}{ext}"
            (shots_dir / screenshot).write_bytes(blob)

        user = self.current_user()
        entry = {
            "id": report_id,
            "schema_version": "feedback-1.0",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "user_id": user["id"] if user else None,
            "user_handle": user["handle"] if user else None,
            "category": truncate_text(payload.get("category"), 40),
            "description": description,
            "route": truncate_text(payload.get("route"), 200),
            "app_version": truncate_text(payload.get("app_version"), 40),
            "user_agent": truncate_text(self.headers.get("User-Agent"), 300),
            "errors": errors,
            "screenshot": screenshot,
        }
        append_jsonl(self.roots["feedback"], entry)
        print(f"  Feedback received: {entry['category'] or 'general'} "
              f"from {entry['user_handle'] or 'anonymous'} ({report_id})")
        self.send_json({"ok": True, "id": report_id}, status=HTTPStatus.CREATED)

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

    # Everything is same-origin and self-contained (no CDNs, fonts, or
    # analytics). 'unsafe-inline' for scripts/styles is required by the inline
    # boot script and the app's inline handlers; external script/frame/object
    # sources stay blocked.
    _HTML_CSP = (
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "media-src 'self' blob: data:; font-src 'self' data:; "
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; "
        "base-uri 'self'; form-action 'self'"
    )

    def _send_security_headers(self, *, html: bool) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        if html:
            self.send_header("Content-Security-Policy", self._HTML_CSP)
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "same-origin")

    def serve_file(self, path: Path) -> None:
        try:
            resolved = path.resolve()
            allowed = [
                self.roots["static"].resolve(),
                self.roots["cache"].resolve(),
                self.roots["saem_icons"].resolve(),
            ]
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
            self._send_security_headers(html=resolved.suffix in (".html", ".htm"))
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
        # 1 MB: shared compositions embed whole arrangements (patches + baked
        # notes); everything else stays far below this.
        if length > 1_048_576:
            raise ValueError("request body too large")
        raw = self.rfile.read(length).decode("utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("body must be a JSON object")
        return data

    def send_json(
        self,
        data: Any,
        status: HTTPStatus = HTTPStatus.OK,
        cookies: list[str] | None = None,
    ) -> None:
        encoded = json.dumps(data, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("X-Content-Type-Options", "nosniff")
        # Credentialed (cookie-bearing) responses can't use a wildcard origin;
        # auth is same-origin, so only advertise open CORS for cookieless JSON.
        if not cookies:
            self.send_header("Access-Control-Allow-Origin", "*")
        for cookie in cookies or []:
            self.send_header("Set-Cookie", cookie)
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
        "saem_icons": root / "png icons",
        "cache": cache_dir or root / "web" / "cache",
        "library": data / "global_presets.json",
        "events": data / "explore_events.jsonl",
        "study_data": data / "study_sessions.jsonl",
        "feedback": data / "feedback.jsonl",
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
    server.login_failures = {}  # type: ignore[attr-defined]
    server.admin_token = os.environ.get("PHASE0_ADMIN_TOKEN", "")  # type: ignore[attr-defined]
    # Accounts / invite gate. The store is always available (so profiles work
    # locally), but sign-in is only *enforced* when RESONA_AUTH_REQUIRED is set.
    server.accounts = AccountStore(data / "accounts.db")  # type: ignore[attr-defined]
    server.community = CommunityStore(data / "accounts.db")  # type: ignore[attr-defined]
    server.auth_required = _env_flag("RESONA_AUTH_REQUIRED")  # type: ignore[attr-defined]
    server.open_signup = _env_flag("RESONA_OPEN_SIGNUP")  # type: ignore[attr-defined]
    server.cookie_secure = _env_flag("RESONA_COOKIE_SECURE")  # type: ignore[attr-defined]
    server.experiments = _env_flag("RESONA_EXPERIMENTS")  # type: ignore[attr-defined]
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
    if getattr(server, "auth_required", False):
        signup = "open" if getattr(server, "open_signup", False) else "invite-only"
        print(f"  Access         : LOCKED — sign-in required ({signup} registration)")
    else:
        print(f"  Access         : open (accounts optional; set RESONA_AUTH_REQUIRED=1 to lock)")
    print(f"  Ctrl+C to stop\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
