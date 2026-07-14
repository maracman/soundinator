"""Community layer: profiles, shared patches/modules/compositions, ratings.

Sits alongside :mod:`synthesiser.web.accounts` on the same SQLite database and
follows the same design rules — standard library only, one connection per
operation (WAL keeps that safe under ThreadingHTTPServer), and all validation
server-side so the API can never be talked into storing something the UI
wouldn't produce.

Anti-gaming rules enforced here rather than in the UI:

* one rating per (user, item) — the primary key; editing is an UPSERT
* you can never rate your own item (checked against the item's owner)
* averages are only reported once an item has ``MIN_RATERS_FOR_VISIBILITY``
  distinct raters, and general browse/search hides items below that threshold
  (author profile pages and direct-by-id fetches always work)
* free-text fields reject anything that looks like a link
"""

from __future__ import annotations

import base64
import json
import re
import sqlite3
import time
from contextlib import contextmanager
from http import HTTPStatus
from pathlib import Path
from typing import Any, Iterator, Optional
from urllib.parse import unquote
from uuid import uuid4

from synthesiser.web import mailer
from synthesiser.web.accounts import AccountError

# ── Tunables ────────────────────────────────────────────────────────────────

MIN_RATERS_FOR_VISIBILITY = 5
MAX_SHARED_ITEMS_PER_USER = 200
MAX_TAGS_PER_ITEM = 8
MAX_COMPOSITION_SECONDS = 300.0
MAX_RATINGS_PER_USER_PER_DAY = 200
MAX_AVATAR_BYTES = 131_072
MAX_ITEM_DATA_BYTES = 256_000
# Arrangements embed every patch they use (plus hand-edited baked notes), so
# compositions get more headroom than single modules/patches. Must stay under
# the server's JSON body cap (1 MB) with room for the request envelope.
MAX_COMPOSITION_DATA_BYTES = 900_000
MAX_BROWSE_LIMIT = 100
# Anti-harvest throttle: how many *distinct* items a user may pull full data
# for per rolling hour. Audio renders client-side, so anyone allowed to play an
# item necessarily receives its JSON — this cap can't stop capture entirely,
# but it makes bulk scraping slow and visible. Sized against real behaviour:
# auditioning one new random item every ~20 seconds non-stop for an hour is
# 180 fetches, so 200 leaves headroom for the heaviest genuine listener while
# holding a scraper to <5k items/day. Re-fetching an item already counted this
# hour is free (replays, A/B flipping), and your own items never count.
MAX_ITEM_DATA_FETCHES_PER_HOUR = 200

# Exactly three shareable things (owner 2026-07-14): a synth (the sub-note
# instrument incl. its space), a note engine (the macro behaviour incl.
# percussion and scale), and a composition (a whole arrangement).
ITEM_KINDS = ("synth", "engine", "composition")
# Section survives as an optional legacy hint on old rows; new shares leave it
# empty, so the accepted set stays permissive.
ITEM_SECTIONS = (
    "sound", "melody", "rhythm", "dynamics", "surprise", "percussion",
    "space", "full", "",
)

_TAG_RE = re.compile(r"^[a-z0-9][a-z0-9 -]{0,23}$")
# "No links" policy for profile bios, item names/descriptions and tags. Errs
# on the side of rejection (e.g. "deep.walker" trips it) — that is the point.
_NO_URLS_RE = re.compile(r"(?i)(https?://|www\.|[a-z0-9-]{2,}\.[a-z]{2,}(/|\b))")

# Accepted avatar formats, sniffed from the decoded bytes rather than trusting
# the client's MIME string.
_AVATAR_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


class CommunityError(AccountError):
    """A user-facing community error (bad input, forbidden action, etc.)."""


class CommunityRateLimited(CommunityError):
    """Distinct-item data-fetch budget exhausted; the server maps this to 429."""


def _reject_links(value: str, field: str) -> str:
    if _NO_URLS_RE.search(value or ""):
        raise CommunityError(f"links are not allowed in {field}")
    return value


def _sniff_avatar_mime(blob: bytes) -> str:
    for magic, mime in _AVATAR_MAGIC:
        if blob.startswith(magic):
            return mime
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return "image/webp"
    raise CommunityError("avatar must be a PNG, JPEG, or WebP image")


def _clean_tags(tags: Any) -> list[str]:
    if tags is None:
        return []
    if not isinstance(tags, list):
        raise CommunityError("tags must be a list")
    cleaned: list[str] = []
    for raw in tags:
        tag = str(raw or "").strip().lower()
        if not tag:
            continue
        if not _TAG_RE.match(tag):
            raise CommunityError(
                "tags must be 1–24 chars: lowercase letters, numbers, spaces, hyphens"
            )
        _reject_links(tag, "tags")
        if tag not in cleaned:
            cleaned.append(tag)
    if len(cleaned) > MAX_TAGS_PER_ITEM:
        raise CommunityError(f"at most {MAX_TAGS_PER_ITEM} tags per item")
    return cleaned


def composition_duration_seconds(data: Any) -> float:
    """Recompute a shared arrangement's duration — never trust the client.

    Duration is the furthest region end (or the arrangement's own
    ``lengthBeats``, whichever is greater) at the arrangement's context tempo.
    The tempo is clamped to a sane musical range so an absurd tempo can't
    smuggle a long piece under the cap.
    """
    if not isinstance(data, dict) or not isinstance(data.get("tracks"), list):
        raise CommunityError("composition data must be an arrangement (with tracks)")
    tempo = None
    context = data.get("context")
    if isinstance(context, dict):
        tempo = context.get("tempo")
    if not isinstance(tempo, (int, float)) or isinstance(tempo, bool):
        tempo = 96.0
    tempo = min(400.0, max(20.0, float(tempo)))

    def _num(value: Any) -> float:
        return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0

    end_beats = _num(data.get("lengthBeats"))
    for track in data["tracks"]:
        if not isinstance(track, dict):
            continue
        for region in track.get("regions") or []:
            if isinstance(region, dict):
                end_beats = max(end_beats, _num(region.get("startBeat")) + _num(region.get("lengthBeats")))
    return end_beats * 60.0 / tempo


# ── Schema ──────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY,
    display_name TEXT NOT NULL DEFAULT '',
    bio          TEXT NOT NULL DEFAULT '',
    avatar       BLOB,
    avatar_mime  TEXT,
    updated_at   REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_items (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    section     TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL,
    duration_s  REAL,
    source_id   TEXT,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_citems_user ON community_items(user_id);
CREATE INDEX IF NOT EXISTS idx_citems_kind ON community_items(kind, section);

CREATE TABLE IF NOT EXISTS item_tags (
    item_id TEXT NOT NULL,
    tag     TEXT NOT NULL,
    PRIMARY KEY (item_id, tag),
    FOREIGN KEY (item_id) REFERENCES community_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON item_tags(tag);

CREATE TABLE IF NOT EXISTS ratings (
    user_id    INTEGER NOT NULL,
    item_id    TEXT NOT NULL,
    stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES community_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ratings_item ON ratings(item_id);

CREATE TABLE IF NOT EXISTS user_library (
    user_id  INTEGER NOT NULL,
    item_id  TEXT NOT NULL,
    added_at REAL NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES community_items(id) ON DELETE CASCADE
);

-- One row per (user, item) whose full data the user has ever pulled; the
-- timestamp advances on re-fetch. Doubles as the hourly anti-harvest budget
-- (COUNT WHERE fetched_at > now-3600) and an audit trail of who pulled what.
CREATE TABLE IF NOT EXISTS item_data_fetches (
    user_id    INTEGER NOT NULL,
    item_id    TEXT NOT NULL,
    fetched_at REAL NOT NULL,
    PRIMARY KEY (user_id, item_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES community_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_fetches_user_time ON item_data_fetches(user_id, fetched_at);
"""

# Shared SELECT core: one row per item with author identity and rating
# aggregates, computed live (rating volumes are small; the item_id index makes
# the correlated aggregates cheap).
_ITEM_SELECT = """
SELECT i.id, i.user_id, i.kind, i.name, i.section, i.description,
       i.duration_s, i.source_id, i.created_at, i.updated_at,
       u.handle AS author_handle,
       COALESCE(p.display_name, '') AS author_display_name,
       (SELECT COUNT(*) FROM ratings r WHERE r.item_id = i.id)   AS rating_count,
       (SELECT AVG(stars) FROM ratings r WHERE r.item_id = i.id) AS avg_stars
FROM community_items i
JOIN users u ON u.id = i.user_id
LEFT JOIN profiles p ON p.user_id = i.user_id
"""


def _like_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CommunityStore:
    """Thread-safe (connection-per-operation) SQLite-backed community store.

    Shares the accounts database so profile/user joins are plain SQL and the
    single-file backup story stays true.
    """

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
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

    # ── Users / profiles ─────────────────────────────────────────────────────

    @staticmethod
    def _resolve_user(conn: sqlite3.Connection, ref: str | int) -> Optional[sqlite3.Row]:
        text = str(ref or "").strip()
        if not text:
            return None
        if text.isdigit():
            row = conn.execute("SELECT * FROM users WHERE id = ?", (int(text),)).fetchone()
            if row is not None:
                return row
        return conn.execute(
            "SELECT * FROM users WHERE handle = ? COLLATE NOCASE", (text,)
        ).fetchone()

    def public_profile(self, ref: str | int) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            user = self._resolve_user(conn, ref)
            if user is None:
                return None
            profile = conn.execute(
                "SELECT * FROM profiles WHERE user_id = ?", (user["id"],)
            ).fetchone()
            stats = conn.execute(
                """
                SELECT COUNT(DISTINCT i.id) AS items,
                       COUNT(r.user_id)     AS ratings_received,
                       AVG(r.stars)         AS avg_stars
                FROM community_items i
                LEFT JOIN ratings r ON r.item_id = i.id
                WHERE i.user_id = ?
                """,
                (user["id"],),
            ).fetchone()
        return {
            "id": user["id"],
            "handle": user["handle"],
            "display_name": (profile["display_name"] if profile else "") or user["handle"],
            "bio": profile["bio"] if profile else "",
            "has_avatar": bool(profile and profile["avatar"]),
            "created_at": user["created_at"],
            "stats": {
                "items": stats["items"],
                "ratings_received": stats["ratings_received"],
                "avg_stars": round(stats["avg_stars"], 2) if stats["avg_stars"] is not None else None,
            },
        }

    def update_profile(
        self, user_id: int, *, display_name: str | None = None, bio: str | None = None
    ) -> dict[str, Any]:
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)"
                " ON CONFLICT(user_id) DO NOTHING",
                (user_id, now),
            )
            if display_name is not None:
                display_name = _reject_links(display_name.strip()[:40], "your display name")
                conn.execute(
                    "UPDATE profiles SET display_name = ?, updated_at = ? WHERE user_id = ?",
                    (display_name, now, user_id),
                )
            if bio is not None:
                bio = _reject_links(bio.strip()[:140], "your description")
                conn.execute(
                    "UPDATE profiles SET bio = ?, updated_at = ? WHERE user_id = ?",
                    (bio, now, user_id),
                )
        return self.public_profile(user_id)  # type: ignore[return-value]

    def set_avatar(self, user_id: int, image_base64: str) -> None:
        try:
            blob = base64.b64decode(image_base64 or "", validate=True)
        except (ValueError, TypeError):
            raise CommunityError("avatar upload is not valid base64")
        if not blob:
            raise CommunityError("avatar upload is empty")
        if len(blob) > MAX_AVATAR_BYTES:
            raise CommunityError("avatar is too large (max 128 KB after resizing)")
        mime = _sniff_avatar_mime(blob)
        now = time.time()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO profiles (user_id, avatar, avatar_mime, updated_at)"
                " VALUES (?, ?, ?, ?)"
                " ON CONFLICT(user_id) DO UPDATE SET"
                "   avatar = excluded.avatar, avatar_mime = excluded.avatar_mime,"
                "   updated_at = excluded.updated_at",
                (user_id, blob, mime, now),
            )

    def get_avatar(self, ref: str | int) -> Optional[tuple[bytes, str]]:
        with self._connect() as conn:
            user = self._resolve_user(conn, ref)
            if user is None:
                return None
            row = conn.execute(
                "SELECT avatar, avatar_mime FROM profiles WHERE user_id = ?", (user["id"],)
            ).fetchone()
        if row is None or not row["avatar"]:
            return None
        return bytes(row["avatar"]), row["avatar_mime"] or "application/octet-stream"

    # ── Shared items ─────────────────────────────────────────────────────────

    def _item_public(
        self,
        row: sqlite3.Row,
        *,
        tags: list[str],
        viewer_id: int | None,
        my_rating: int | None,
        include_data: bool = False,
        data: Any = None,
    ) -> dict[str, Any]:
        count = row["rating_count"]
        item: dict[str, Any] = {
            "id": row["id"],
            "kind": row["kind"],
            "name": row["name"],
            "section": row["section"],
            "description": row["description"],
            "duration_s": row["duration_s"],
            "source_id": row["source_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "tags": tags,
            "author": {
                "id": row["user_id"],
                "handle": row["author_handle"],
                "display_name": row["author_display_name"] or row["author_handle"],
            },
            "rating_count": count,
            # The average only exists once enough distinct people have rated —
            # below the threshold the UI shows "n ratings so far".
            "avg_stars": (
                round(row["avg_stars"], 2)
                if row["avg_stars"] is not None and count >= MIN_RATERS_FOR_VISIBILITY
                else None
            ),
            "mine": viewer_id is not None and row["user_id"] == viewer_id,
            "my_rating": my_rating,
        }
        if include_data:
            item["data"] = data
        return item

    def _tags_for(self, conn: sqlite3.Connection, item_id: str) -> list[str]:
        return [
            r["tag"]
            for r in conn.execute(
                "SELECT tag FROM item_tags WHERE item_id = ? ORDER BY tag", (item_id,)
            )
        ]

    def _my_rating(
        self, conn: sqlite3.Connection, viewer_id: int | None, item_id: str
    ) -> int | None:
        if viewer_id is None:
            return None
        row = conn.execute(
            "SELECT stars FROM ratings WHERE user_id = ? AND item_id = ?",
            (viewer_id, item_id),
        ).fetchone()
        return row["stars"] if row else None

    def share_item(
        self,
        user_id: int,
        *,
        kind: str,
        name: str,
        data: Any,
        section: str = "",
        description: str = "",
        tags: Any = None,
        source_id: str | None = None,
    ) -> dict[str, Any]:
        kind = (kind or "").strip()
        if kind not in ITEM_KINDS:
            raise CommunityError(f"kind must be one of: {', '.join(ITEM_KINDS)}")
        section = (section or "").strip()
        if section not in ITEM_SECTIONS:
            raise CommunityError("unknown section")
        name = _reject_links((name or "").strip()[:120], "item names")
        if not name:
            raise CommunityError("a name is required")
        description = _reject_links((description or "").strip()[:140], "descriptions")
        clean_tags = _clean_tags(tags)
        if data is None:
            raise CommunityError("data is required")
        blob = json.dumps(data, separators=(",", ":"))
        size_cap = MAX_COMPOSITION_DATA_BYTES if kind == "composition" else MAX_ITEM_DATA_BYTES
        if len(blob) > size_cap:
            raise CommunityError("item is too large to share")
        duration_s: float | None = None
        if kind == "composition":
            duration_s = composition_duration_seconds(data)
            if duration_s > MAX_COMPOSITION_SECONDS:
                raise CommunityError(
                    "compositions shared to your profile are capped at 5 minutes"
                )
        source_id = (source_id or "").strip()[:120] or None

        now = time.time()
        with self._connect() as conn:
            existing = None
            if source_id:
                # Re-sharing the same local item updates the shared copy in
                # place (keeping its ratings) instead of creating a duplicate.
                existing = conn.execute(
                    "SELECT id FROM community_items WHERE user_id = ? AND source_id = ?",
                    (user_id, source_id),
                ).fetchone()
            if existing:
                item_id = existing["id"]
                conn.execute(
                    "UPDATE community_items SET kind = ?, name = ?, section = ?,"
                    " description = ?, data = ?, duration_s = ?, updated_at = ?"
                    " WHERE id = ?",
                    (kind, name, section, description, blob, duration_s, now, item_id),
                )
            else:
                count = conn.execute(
                    "SELECT COUNT(*) FROM community_items WHERE user_id = ?", (user_id,)
                ).fetchone()[0]
                if count >= MAX_SHARED_ITEMS_PER_USER:
                    raise CommunityError(
                        f"shared item limit reached ({MAX_SHARED_ITEMS_PER_USER})"
                    )
                item_id = uuid4().hex
                conn.execute(
                    "INSERT INTO community_items"
                    " (id, user_id, kind, name, section, description, data,"
                    "  duration_s, source_id, created_at, updated_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (item_id, user_id, kind, name, section, description, blob,
                     duration_s, source_id, now, now),
                )
            conn.execute("DELETE FROM item_tags WHERE item_id = ?", (item_id,))
            conn.executemany(
                "INSERT INTO item_tags (item_id, tag) VALUES (?, ?)",
                [(item_id, tag) for tag in clean_tags],
            )
        return self.get_item(item_id, viewer_id=user_id)  # type: ignore[return-value]

    def unshare_item(self, user_id: int, item_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM community_items WHERE id = ? AND user_id = ?",
                (item_id, user_id),
            )
            return cur.rowcount > 0

    def _record_data_fetch(
        self, conn: sqlite3.Connection, viewer_id: int | None, item_id: str, owner_id: int
    ) -> None:
        """Charge one distinct-item data fetch against the viewer's hourly budget.

        Re-fetching an item already counted this hour is free; your own items
        never count. Raises :class:`CommunityRateLimited` when the budget is
        spent — callers translate that to HTTP 429.
        """
        if viewer_id is None or viewer_id == owner_id:
            return
        now = time.time()
        cutoff = now - 3600
        row = conn.execute(
            "SELECT fetched_at FROM item_data_fetches WHERE user_id = ? AND item_id = ?",
            (viewer_id, item_id),
        ).fetchone()
        if row is None or row["fetched_at"] <= cutoff:
            used = conn.execute(
                "SELECT COUNT(*) FROM item_data_fetches WHERE user_id = ? AND fetched_at > ?",
                (viewer_id, cutoff),
            ).fetchone()[0]
            if used >= MAX_ITEM_DATA_FETCHES_PER_HOUR:
                raise CommunityRateLimited(
                    "you've loaded a lot of community items this hour — "
                    "please slow down and try again in a little while"
                )
        conn.execute(
            "INSERT INTO item_data_fetches (user_id, item_id, fetched_at) VALUES (?, ?, ?)"
            " ON CONFLICT(user_id, item_id) DO UPDATE SET fetched_at = excluded.fetched_at",
            (viewer_id, item_id, now),
        )

    def get_item(
        self,
        item_id: str,
        *,
        viewer_id: int | None = None,
        count_fetch: bool = False,
    ) -> Optional[dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                _ITEM_SELECT + " WHERE i.id = ?", (item_id,)
            ).fetchone()
            if row is None:
                return None
            if count_fetch:
                self._record_data_fetch(conn, viewer_id, item_id, row["user_id"])
            data_row = conn.execute(
                "SELECT data FROM community_items WHERE id = ?", (item_id,)
            ).fetchone()
            tags = self._tags_for(conn, item_id)
            my_rating = self._my_rating(conn, viewer_id, item_id)
        return self._item_public(
            row,
            tags=tags,
            viewer_id=viewer_id,
            my_rating=my_rating,
            include_data=True,
            data=json.loads(data_row["data"]),
        )

    def browse(
        self,
        *,
        viewer_id: int,
        q: str = "",
        user_q: str = "",
        tag: str = "",
        kind: str = "",
        section: str = "",
        sort: str = "top",
        limit: int = 40,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """General discovery: only items past the rating threshold (plus your own)."""
        limit = max(1, min(int(limit), MAX_BROWSE_LIMIT))
        offset = max(0, int(offset))
        where: list[str] = []
        params: list[Any] = []
        if kind:
            where.append("kind = ?")
            params.append(kind)
        if section:
            where.append("section = ?")
            params.append(section)
        if q:
            like = f"%{_like_escape(q.strip().lower())}%"
            where.append(
                "(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(description) LIKE ? ESCAPE '\\'"
                " OR EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = id"
                "            AND t.tag LIKE ? ESCAPE '\\'))"
            )
            params.extend([like, like, like])
        if user_q:
            like = f"%{_like_escape(user_q.strip().lower())}%"
            where.append(
                "(LOWER(author_handle) LIKE ? ESCAPE '\\'"
                " OR LOWER(author_display_name) LIKE ? ESCAPE '\\')"
            )
            params.extend([like, like])
        if tag:
            where.append("EXISTS (SELECT 1 FROM item_tags t WHERE t.item_id = id AND t.tag = ?)")
            params.append(tag.strip().lower())

        where.append("(rating_count >= ? OR user_id = ?)")
        params.extend([MIN_RATERS_FOR_VISIBILITY, viewer_id])

        order = (
            "ORDER BY avg_stars DESC, rating_count DESC, created_at DESC"
            if sort != "new"
            else "ORDER BY created_at DESC"
        )
        sql = (
            f"SELECT * FROM ({_ITEM_SELECT}) WHERE {' AND '.join(where)} {order}"
            " LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [
                self._item_public(
                    row,
                    tags=self._tags_for(conn, row["id"]),
                    viewer_id=viewer_id,
                    my_rating=self._my_rating(conn, viewer_id, row["id"]),
                )
                for row in rows
            ]

    def items_for_user(
        self, ref: str | int, *, viewer_id: int | None = None, kind: str = ""
    ) -> Optional[list[dict[str, Any]]]:
        """Everything a user has shared — profile pages show the lot, no threshold."""
        with self._connect() as conn:
            user = self._resolve_user(conn, ref)
            if user is None:
                return None
            where = "WHERE i.user_id = ?"
            params: list[Any] = [user["id"]]
            if kind:
                where += " AND i.kind = ?"
                params.append(kind)
            rows = conn.execute(
                _ITEM_SELECT + where + " ORDER BY i.updated_at DESC", params
            ).fetchall()
            return [
                self._item_public(
                    row,
                    tags=self._tags_for(conn, row["id"]),
                    viewer_id=viewer_id,
                    my_rating=self._my_rating(conn, viewer_id, row["id"]),
                )
                for row in rows
            ]

    # ── Ratings ──────────────────────────────────────────────────────────────

    def rate(self, user_id: int, item_id: str, stars: Any) -> dict[str, Any]:
        if not isinstance(stars, int) or isinstance(stars, bool) or not 1 <= stars <= 5:
            raise CommunityError("stars must be a whole number from 1 to 5")
        now = time.time()
        with self._connect() as conn:
            item = conn.execute(
                "SELECT user_id FROM community_items WHERE id = ?", (item_id,)
            ).fetchone()
            if item is None:
                raise CommunityError("item not found")
            if item["user_id"] == user_id:
                raise CommunityError("you can't rate your own item")
            existing = conn.execute(
                "SELECT 1 FROM ratings WHERE user_id = ? AND item_id = ?",
                (user_id, item_id),
            ).fetchone()
            if existing is None:
                today = conn.execute(
                    "SELECT COUNT(*) FROM ratings WHERE user_id = ? AND created_at > ?",
                    (user_id, now - 86400),
                ).fetchone()[0]
                if today >= MAX_RATINGS_PER_USER_PER_DAY:
                    raise CommunityError("rating limit reached for today")
            conn.execute(
                "INSERT INTO ratings (user_id, item_id, stars, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(user_id, item_id) DO UPDATE SET"
                "   stars = excluded.stars, updated_at = excluded.updated_at",
                (user_id, item_id, stars, now, now),
            )
            agg = conn.execute(
                "SELECT COUNT(*) AS n, AVG(stars) AS avg FROM ratings WHERE item_id = ?",
                (item_id,),
            ).fetchone()
        visible = agg["n"] >= MIN_RATERS_FOR_VISIBILITY
        return {
            "rating_count": agg["n"],
            "avg_stars": round(agg["avg"], 2) if visible else None,
            "my_rating": stars,
        }

    def set_tags(self, user_id: int, item_id: str, tags: Any) -> list[str]:
        clean = _clean_tags(tags)
        with self._connect() as conn:
            owner = conn.execute(
                "SELECT 1 FROM community_items WHERE id = ? AND user_id = ?",
                (item_id, user_id),
            ).fetchone()
            if owner is None:
                raise CommunityError("item not found")
            conn.execute("DELETE FROM item_tags WHERE item_id = ?", (item_id,))
            conn.executemany(
                "INSERT INTO item_tags (item_id, tag) VALUES (?, ?)",
                [(item_id, tag) for tag in clean],
            )
        return clean

    # ── Top users ────────────────────────────────────────────────────────────

    def top_users(self, *, limit: int = 20) -> list[dict[str, Any]]:
        """Rank contributors by their best rated work.

        Each threshold-passing item gets a Bayesian-smoothed score (pulled
        toward 3.5 with 10 pseudo-votes so a lone 5★×5 doesn't outrank a
        4.8★×40); a user's score is the mean of their top three items.
        """
        limit = max(1, min(int(limit), 100))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT i.id, i.user_id, i.name, i.kind, i.section,
                       COUNT(r.user_id) AS n, SUM(r.stars) AS total, AVG(r.stars) AS avg
                FROM community_items i
                JOIN ratings r ON r.item_id = i.id
                GROUP BY i.id
                HAVING n >= ?
                """,
                (MIN_RATERS_FOR_VISIBILITY,),
            ).fetchall()
            by_user: dict[int, list[dict[str, Any]]] = {}
            for row in rows:
                score = (row["total"] + 3.5 * 10) / (row["n"] + 10)
                by_user.setdefault(row["user_id"], []).append({
                    "id": row["id"],
                    "name": row["name"],
                    "kind": row["kind"],
                    "section": row["section"],
                    "avg_stars": round(row["avg"], 2),
                    "rating_count": row["n"],
                    "score": score,
                })
            ranked = []
            for user_id, items in by_user.items():
                items.sort(key=lambda it: it["score"], reverse=True)
                top = items[:3]
                user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                profile = conn.execute(
                    "SELECT display_name FROM profiles WHERE user_id = ?", (user_id,)
                ).fetchone()
                ranked.append({
                    "user": {
                        "id": user_id,
                        "handle": user["handle"],
                        "display_name": (profile["display_name"] if profile else "") or user["handle"],
                    },
                    "score": round(sum(it["score"] for it in top) / len(top), 3),
                    "top_items": [
                        {k: v for k, v in it.items() if k != "score"} for it in top
                    ],
                })
        ranked.sort(key=lambda entry: entry["score"], reverse=True)
        return ranked[:limit]

    # ── Per-user library ("added" community items) ───────────────────────────

    def library_list(self, user_id: int) -> list[dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM ({_ITEM_SELECT}) WHERE id IN"
                " (SELECT item_id FROM user_library WHERE user_id = ?)"
                " ORDER BY created_at DESC",
                (user_id,),
            ).fetchall()
            items = []
            for row in rows:
                data_row = conn.execute(
                    "SELECT data FROM community_items WHERE id = ?", (row["id"],)
                ).fetchone()
                items.append(
                    self._item_public(
                        row,
                        tags=self._tags_for(conn, row["id"]),
                        viewer_id=user_id,
                        my_rating=self._my_rating(conn, user_id, row["id"]),
                        include_data=True,
                        data=json.loads(data_row["data"]),
                    )
                )
        return items

    def library_add(self, user_id: int, item_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            item = conn.execute(
                "SELECT user_id FROM community_items WHERE id = ?", (item_id,)
            ).fetchone()
            if item is None:
                raise CommunityError("item not found")
            if item["user_id"] == user_id:
                raise CommunityError("that's your own item — it's already in your library")
            conn.execute(
                "INSERT INTO user_library (user_id, item_id, added_at) VALUES (?, ?, ?)"
                " ON CONFLICT(user_id, item_id) DO NOTHING",
                (user_id, item_id, time.time()),
            )
        return self.get_item(item_id, viewer_id=user_id, count_fetch=True)  # type: ignore[return-value]

    def library_remove(self, user_id: int, item_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM user_library WHERE user_id = ? AND item_id = ?",
                (user_id, item_id),
            )
            return cur.rowcount > 0

    # ── Random visible items (auditioner "randomise") ────────────────────────

    def random_items(
        self, *, viewer_id: int, kind: str = "", section: str = "", count: int = 1
    ) -> list[dict[str, Any]]:
        count = max(1, min(int(count), 20))
        where: list[str] = ["rating_count >= ?"]
        params: list[Any] = [MIN_RATERS_FOR_VISIBILITY]
        if kind:
            where.append("kind = ?")
            params.append(kind)
        if section:
            where.append("section = ?")
            params.append(section)
        sql = (
            f"SELECT * FROM ({_ITEM_SELECT}) WHERE {' AND '.join(where)}"
            " ORDER BY RANDOM() LIMIT ?"
        )
        params.append(count)
        with self._connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            items = []
            for row in rows:
                self._record_data_fetch(conn, viewer_id, row["id"], row["user_id"])
                data_row = conn.execute(
                    "SELECT data FROM community_items WHERE id = ?", (row["id"],)
                ).fetchone()
                items.append(
                    self._item_public(
                        row,
                        tags=self._tags_for(conn, row["id"]),
                        viewer_id=viewer_id,
                        my_rating=self._my_rating(conn, viewer_id, row["id"]),
                        include_data=True,
                        data=json.loads(data_row["data"]),
                    )
                )
        return items


# ── HTTP routes (mixed into the request handler) ────────────────────────────

class CommunityRoutes:
    """Community endpoints, dispatched from the main handler's do_GET/POST/DELETE.

    Each ``handle_community_*`` returns True when it owned the path. The host
    class provides ``send_json``/``send_error_json``/``current_user`` and the
    auth gate has already run — every path here carries a valid session.
    """

    def _community_store(self) -> CommunityStore:
        store = getattr(self.server, "community", None)  # type: ignore[attr-defined]
        if store is None:
            raise ValueError("community backend not configured")
        return store

    def _send_avatar(self, ref: str) -> None:
        result = self._community_store().get_avatar(ref)
        if result is None:
            self.send_error_json(HTTPStatus.NOT_FOUND, "no avatar")  # type: ignore[attr-defined]
            return
        blob, mime = result
        self.send_response(HTTPStatus.OK)  # type: ignore[attr-defined]
        self.send_header("Content-Type", mime)  # type: ignore[attr-defined]
        self.send_header("Content-Length", str(len(blob)))  # type: ignore[attr-defined]
        self.send_header("X-Content-Type-Options", "nosniff")  # type: ignore[attr-defined]
        self.send_header("Cache-Control", "max-age=3600")  # type: ignore[attr-defined]
        self.end_headers()  # type: ignore[attr-defined]
        self.wfile.write(blob)  # type: ignore[attr-defined]

    @staticmethod
    def _q(query: dict[str, list[str]], key: str, default: str = "") -> str:
        values = query.get(key)
        return values[0] if values else default

    def handle_community_get(self, path: str, query: dict[str, list[str]]) -> bool:
        if not path.startswith(("/api/users/", "/api/community/")):
            return False
        store = self._community_store()
        user = self.current_user()  # type: ignore[attr-defined]

        if path.startswith("/api/users/"):
            rest = unquote(path.removeprefix("/api/users/"))
            if rest.endswith("/avatar"):
                self._send_avatar(rest.removesuffix("/avatar").strip("/"))
                return True
            profile = store.public_profile(rest)
            if profile is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "user not found")  # type: ignore[attr-defined]
            else:
                self.send_json(profile)  # type: ignore[attr-defined]
            return True

        if path == "/api/community/browse":
            self.send_json({  # type: ignore[attr-defined]
                "items": store.browse(
                    viewer_id=user["id"],
                    q=self._q(query, "q"),
                    user_q=self._q(query, "user"),
                    tag=self._q(query, "tag"),
                    kind=self._q(query, "kind"),
                    section=self._q(query, "section"),
                    sort=self._q(query, "sort", "top"),
                    limit=int(self._q(query, "limit", "40") or 40),
                    offset=int(self._q(query, "offset", "0") or 0),
                )
            })
            return True

        if path == "/api/community/top-users":
            self.send_json({  # type: ignore[attr-defined]
                "users": store.top_users(limit=int(self._q(query, "limit", "20") or 20))
            })
            return True

        if path == "/api/community/library":
            self.send_json({"items": store.library_list(user["id"])})  # type: ignore[attr-defined]
            return True

        if path == "/api/community/random":
            self.send_json({  # type: ignore[attr-defined]
                "items": store.random_items(
                    viewer_id=user["id"],
                    kind=self._q(query, "kind"),
                    section=self._q(query, "section"),
                    count=int(self._q(query, "count", "1") or 1),
                )
            })
            return True

        if path.startswith("/api/community/users/"):
            rest = unquote(path.removeprefix("/api/community/users/"))
            ref = rest.removesuffix("/items").strip("/")
            items = store.items_for_user(ref, viewer_id=user["id"], kind=self._q(query, "kind"))
            if items is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "user not found")  # type: ignore[attr-defined]
            else:
                self.send_json({"items": items})  # type: ignore[attr-defined]
            return True

        if path.startswith("/api/community/items/"):
            item = store.get_item(
                unquote(path.removeprefix("/api/community/items/")),
                viewer_id=user["id"],
                count_fetch=True,
            )
            if item is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "item not found")  # type: ignore[attr-defined]
            else:
                self.send_json({"item": item})  # type: ignore[attr-defined]
            return True

        return False

    def handle_community_post(self, path: str, payload: dict[str, Any]) -> bool:
        store = self._community_store()
        user = self.current_user()  # type: ignore[attr-defined]

        if path == "/api/profile":
            profile = store.update_profile(
                user["id"],
                display_name=payload.get("display_name"),
                bio=payload.get("bio"),
            )
            self.send_json({"ok": True, "profile": profile})  # type: ignore[attr-defined]
            return True

        if path == "/api/profile/avatar":
            store.set_avatar(user["id"], payload.get("image_base64", ""))
            self.send_json({"ok": True})  # type: ignore[attr-defined]
            return True

        if path == "/api/community/share":
            # Sharing is the one public-content action, so it demands a
            # confirmed inbox — the anti-abuse anchor once invites loosen.
            # Only enforced while email sending is configured: without a mail
            # provider nobody could complete verification, and the invite gate
            # is already doing the real access control.
            if mailer.email_configured() and not user.get("email_verified", True):
                self.send_error_json(  # type: ignore[attr-defined]
                    HTTPStatus.FORBIDDEN,
                    "please verify your email address first — check your inbox, "
                    "or resend the link from the account menu",
                )
                return True
            item = store.share_item(
                user["id"],
                kind=str(payload.get("kind", "")),
                name=str(payload.get("name", "")),
                section=str(payload.get("section", "")),
                description=str(payload.get("description", "")),
                data=payload.get("data"),
                tags=payload.get("tags"),
                source_id=str(payload.get("source_id", "") or ""),
            )
            self.send_json({"ok": True, "item": item}, status=HTTPStatus.CREATED)  # type: ignore[attr-defined]
            return True

        if path == "/api/community/rate":
            result = store.rate(
                user["id"], str(payload.get("item_id", "")), payload.get("stars")
            )
            self.send_json({"ok": True, **result})  # type: ignore[attr-defined]
            return True

        if path == "/api/community/tags":
            tags = store.set_tags(
                user["id"], str(payload.get("item_id", "")), payload.get("tags")
            )
            self.send_json({"ok": True, "tags": tags})  # type: ignore[attr-defined]
            return True

        if path == "/api/community/library":
            item = store.library_add(user["id"], str(payload.get("item_id", "")))
            self.send_json({"ok": True, "item": item}, status=HTTPStatus.CREATED)  # type: ignore[attr-defined]
            return True

        return False

    def handle_community_delete(self, path: str) -> bool:
        store = self._community_store()
        user = self.current_user()  # type: ignore[attr-defined]

        if path.startswith("/api/community/items/"):
            item_id = unquote(path.removeprefix("/api/community/items/"))
            if not store.unshare_item(user["id"], item_id):
                self.send_error_json(HTTPStatus.NOT_FOUND, "item not found")  # type: ignore[attr-defined]
            else:
                self.send_json({"ok": True})  # type: ignore[attr-defined]
            return True

        if path.startswith("/api/community/library/"):
            item_id = unquote(path.removeprefix("/api/community/library/"))
            if not store.library_remove(user["id"], item_id):
                self.send_error_json(HTTPStatus.NOT_FOUND, "not in your library")  # type: ignore[attr-defined]
            else:
                self.send_json({"ok": True})  # type: ignore[attr-defined]
            return True

        return False
