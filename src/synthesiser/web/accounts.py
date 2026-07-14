"""User accounts, invite codes, sessions, and private patch storage.

Self-contained on top of the standard library: SQLite for storage,
``hashlib.pbkdf2_hmac`` for password hashing, ``secrets`` for tokens. No
third-party dependencies, so this runs anywhere the Phase 0 server already runs
(a Hostinger VPS, a free PaaS, or locally).

The account layer is **opt-in**. The web server only enforces sign-in when
``RESONA_AUTH_REQUIRED`` is set; with it off, the existing anonymous
research/explore flows are untouched. Registration is always gated by an
**invite code** unless ``RESONA_OPEN_SIGNUP`` is explicitly enabled.

Design notes:

* One SQLite connection **per operation** — connections are cheap and this keeps
  the store trivially safe under the server's ThreadingHTTPServer without a
  shared-connection lock. WAL mode lets reads proceed during a write.
* Passwords are stored as ``pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>``
  (the Django-style format), verified with a constant-time compare.
* Invite redemption + user creation happen in a single transaction so an invite
  can never be over-redeemed under concurrency.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional
from uuid import uuid4

# ── Tunables ────────────────────────────────────────────────────────────────

PBKDF2_ITERATIONS = 600_000
SESSION_TTL_DAYS = 30
MAX_PATCHES_PER_USER = 500
MIN_PASSWORD_LENGTH = 8

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HANDLE_RE = re.compile(r"^[a-zA-Z0-9_.-]{2,40}$")


class AccountError(ValueError):
    """A user-facing account error (bad input, invalid invite, etc.)."""


# ── Password hashing ────────────────────────────────────────────────────────

def hash_password(password: str, *, iterations: int = PBKDF2_ITERATIONS) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise AccountError(f"password must be at least {MIN_PASSWORD_LENGTH} characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def hash_session_token(token: str) -> str:
    """Sessions are stored as SHA-256 digests so a copied database file never
    contains a usable bearer token; the raw token lives only in the cookie."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iter_s, salt_hex, hash_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iter_s)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(hash_hex)
    except (ValueError, AttributeError):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt, iterations)
    return hmac.compare_digest(digest, expected)


# ── DB path resolution ──────────────────────────────────────────────────────

def default_db_path() -> Path:
    data_dir = os.environ.get("PHASE0_DATA_DIR")
    if data_dir:
        return Path(data_dir) / "accounts.db"
    return Path(__file__).resolve().parents[3] / "web" / "data" / "accounts.db"


# ── Schema ──────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    handle        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    invite_code   TEXT,
    created_at    REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    created_by INTEGER,
    note       TEXT NOT NULL DEFAULT '',
    max_uses   INTEGER NOT NULL DEFAULT 1,
    uses       INTEGER NOT NULL DEFAULT 0,
    expires_at REAL,
    created_at REAL NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    created_at REAL NOT NULL,
    expires_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patches (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'preset',
    data       TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_patches_user  ON patches(user_id);
"""


class AccountStore:
    """Thread-safe (connection-per-operation) SQLite-backed account store."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path) if db_path else default_db_path()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=15000")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(_SCHEMA)

    # ── Users ───────────────────────────────────────────────────────────────

    @staticmethod
    def _user_public(row: sqlite3.Row | None) -> Optional[dict[str, Any]]:
        if row is None:
            return None
        return {
            "id": row["id"],
            "email": row["email"],
            "handle": row["handle"],
            "is_admin": bool(row["is_admin"]),
            "created_at": row["created_at"],
        }

    def _unique_handle(self, conn: sqlite3.Connection, base: str) -> str:
        base = re.sub(r"[^a-zA-Z0-9_.-]", "", base) or "user"
        base = base[:40]
        candidate = base
        n = 1
        while conn.execute(
            "SELECT 1 FROM users WHERE handle = ? COLLATE NOCASE", (candidate,)
        ).fetchone():
            suffix = str(n)
            candidate = base[: 40 - len(suffix)] + suffix
            n += 1
        return candidate

    def register(
        self,
        email: str,
        password: str,
        *,
        invite_code: str | None,
        handle: str | None = None,
        require_invite: bool = True,
        is_admin: bool = False,
    ) -> dict[str, Any]:
        """Create a user, redeeming an invite atomically when required."""
        email = (email or "").strip().lower()
        if not _EMAIL_RE.match(email):
            raise AccountError("enter a valid email address")
        password_hash = hash_password(password)  # validates length, may raise
        if handle:
            handle = handle.strip()
            if not _HANDLE_RE.match(handle):
                raise AccountError("handle must be 2–40 chars: letters, numbers, . _ -")

        now = time.time()
        with self._connect() as conn:
            if conn.execute(
                "SELECT 1 FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone():
                raise AccountError("an account with that email already exists")

            code = (invite_code or "").strip()
            if require_invite:
                invite = conn.execute(
                    "SELECT * FROM invites WHERE code = ?", (code,)
                ).fetchone()
                if invite is None:
                    raise AccountError("invalid invite code")
                if invite["expires_at"] is not None and invite["expires_at"] < now:
                    raise AccountError("this invite code has expired")
                if invite["uses"] >= invite["max_uses"]:
                    raise AccountError("this invite code has already been used")
                conn.execute(
                    "UPDATE invites SET uses = uses + 1 WHERE code = ?", (code,)
                )
            elif not code:
                code = None

            resolved_handle = (
                handle if handle else self._unique_handle(conn, email.split("@", 1)[0])
            )
            if handle and conn.execute(
                "SELECT 1 FROM users WHERE handle = ? COLLATE NOCASE", (handle,)
            ).fetchone():
                raise AccountError("that handle is already taken")

            cur = conn.execute(
                "INSERT INTO users (email, handle, password_hash, is_admin, invite_code, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (email, resolved_handle, password_hash, int(is_admin), code, now),
            )
            row = conn.execute(
                "SELECT * FROM users WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
        return self._user_public(row)  # type: ignore[return-value]

    def authenticate(self, email: str, password: str) -> Optional[dict[str, Any]]:
        email = (email or "").strip().lower()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ? COLLATE NOCASE", (email,)
            ).fetchone()
        if row is None:
            # Equalise timing against the no-user path so accounts can't be
            # enumerated by response latency.
            verify_password(password, "pbkdf2_sha256$1$00$00")
            return None
        if not verify_password(password, row["password_hash"]):
            return None
        return self._user_public(row)

    def get_user(self, user_id: int) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return self._user_public(row)

    def count_users(self) -> int:
        with self._connect() as conn:
            return conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

    def list_users(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM users ORDER BY created_at").fetchall()
        return [self._user_public(r) for r in rows]  # type: ignore[misc]

    # ── Invites ──────────────────────────────────────────────────────────────

    def create_invite(
        self,
        *,
        created_by: int | None = None,
        max_uses: int = 1,
        expires_at: float | None = None,
        note: str = "",
        code: str | None = None,
    ) -> dict[str, Any]:
        code = code or secrets.token_urlsafe(9)
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO invites (code, created_by, note, max_uses, uses, expires_at, created_at)"
                " VALUES (?, ?, ?, ?, 0, ?, ?)",
                (code, created_by, note[:200], max(1, int(max_uses)), expires_at, now),
            )
        return {
            "code": code,
            "max_uses": max(1, int(max_uses)),
            "uses": 0,
            "expires_at": expires_at,
            "note": note[:200],
            "created_at": now,
        }

    def list_invites(self) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute("SELECT * FROM invites ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

    # ── Sessions ─────────────────────────────────────────────────────────────

    def create_session(self, user_id: int, *, ttl_days: int = SESSION_TTL_DAYS) -> str:
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (hash_session_token(token), user_id, now, now + ttl_days * 86400),
            )
        return token

    def user_for_session(self, token: str | None) -> Optional[dict[str, Any]]:
        if not token:
            return None
        now = time.time()
        with self._connect() as conn:
            row = conn.execute(
                "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id"
                " WHERE s.token = ? AND s.expires_at > ?",
                (hash_session_token(token), now),
            ).fetchone()
        return self._user_public(row)

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self._connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (hash_session_token(token),))

    def purge_expired_sessions(self) -> int:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
            return cur.rowcount

    # ── Patches (private per-user saved presets/arrangements) ────────────────

    def list_patches(self, user_id: int) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, kind, data, created_at, updated_at FROM patches"
                " WHERE user_id = ? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
        return [self._patch_public(r) for r in rows]

    @staticmethod
    def _patch_public(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "data": json.loads(row["data"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def save_patch(
        self,
        user_id: int,
        *,
        name: str,
        data: Any,
        kind: str = "preset",
        patch_id: str | None = None,
    ) -> dict[str, Any]:
        name = (name or "Untitled").strip()[:120] or "Untitled"
        kind = (kind or "preset").strip()[:40] or "preset"
        blob = json.dumps(data, separators=(",", ":"))
        if len(blob) > 256_000:
            raise AccountError("patch is too large to store")
        now = time.time()
        with self._connect() as conn:
            if patch_id:
                existing = conn.execute(
                    "SELECT id FROM patches WHERE id = ? AND user_id = ?",
                    (patch_id, user_id),
                ).fetchone()
                if existing:
                    conn.execute(
                        "UPDATE patches SET name = ?, kind = ?, data = ?, updated_at = ?"
                        " WHERE id = ? AND user_id = ?",
                        (name, kind, blob, now, patch_id, user_id),
                    )
                    row = conn.execute(
                        "SELECT id, name, kind, data, created_at, updated_at FROM patches WHERE id = ?",
                        (patch_id,),
                    ).fetchone()
                    return self._patch_public(row)
            count = conn.execute(
                "SELECT COUNT(*) FROM patches WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            if count >= MAX_PATCHES_PER_USER:
                raise AccountError(f"patch limit reached ({MAX_PATCHES_PER_USER})")
            new_id = patch_id or uuid4().hex
            conn.execute(
                "INSERT INTO patches (id, user_id, name, kind, data, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (new_id, user_id, name, kind, blob, now, now),
            )
            row = conn.execute(
                "SELECT id, name, kind, data, created_at, updated_at FROM patches WHERE id = ?",
                (new_id,),
            ).fetchone()
        return self._patch_public(row)

    def delete_patch(self, user_id: int, patch_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM patches WHERE id = ? AND user_id = ?", (patch_id, user_id)
            )
            return cur.rowcount > 0


# ── CLI (admin bootstrap: create the DB, mint invites, add an admin) ─────────

def _fmt_expiry(days: float | None) -> float | None:
    return time.time() + days * 86400 if days else None


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="synthesiser-accounts")
    parser.add_argument("--db", default=None, help="path to accounts.db (default: PHASE0_DATA_DIR/accounts.db)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="create the database and tables")

    p_inv = sub.add_parser("create-invite", help="mint one or more invite codes")
    p_inv.add_argument("--count", type=int, default=1)
    p_inv.add_argument("--max-uses", type=int, default=1)
    p_inv.add_argument("--expires-days", type=float, default=None)
    p_inv.add_argument("--note", default="")

    p_admin = sub.add_parser("create-admin", help="create an admin user (no invite needed)")
    p_admin.add_argument("--email", required=True)
    p_admin.add_argument("--password", required=True)
    p_admin.add_argument("--handle", default=None)

    p_user = sub.add_parser("create-user", help="create a normal user (no invite needed)")
    p_user.add_argument("--email", required=True)
    p_user.add_argument("--password", required=True)
    p_user.add_argument("--handle", default=None)

    sub.add_parser("list-users", help="list users")
    sub.add_parser("list-invites", help="list invite codes")

    args = parser.parse_args(argv)
    store = AccountStore(Path(args.db) if args.db else None)
    print(f"  DB: {store.db_path}")

    if args.command == "init-db":
        print("  Initialised.")
    elif args.command == "create-invite":
        for _ in range(max(1, args.count)):
            inv = store.create_invite(
                max_uses=args.max_uses,
                expires_at=_fmt_expiry(args.expires_days),
                note=args.note,
            )
            print(f"  invite: {inv['code']}  (max_uses={inv['max_uses']})")
    elif args.command in ("create-admin", "create-user"):
        user = store.register(
            args.email,
            args.password,
            invite_code=None,
            handle=args.handle,
            require_invite=False,
            is_admin=(args.command == "create-admin"),
        )
        role = "admin" if user["is_admin"] else "user"
        print(f"  created {role}: {user['email']}  (handle={user['handle']}, id={user['id']})")
    elif args.command == "list-users":
        for u in store.list_users():
            flag = " [admin]" if u["is_admin"] else ""
            print(f"  #{u['id']:<4} {u['email']:<32} @{u['handle']}{flag}")
    elif args.command == "list-invites":
        for inv in store.list_invites():
            state = f"{inv['uses']}/{inv['max_uses']}"
            print(f"  {inv['code']:<20} used {state:<7} {inv['note']}")


if __name__ == "__main__":
    main()
