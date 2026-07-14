"""Populate a DEV database with dummy community profiles, items, and ratings.

Everything the community UI needs to be exercised end-to-end: eight profiles
with avatars and bios, ~40 shared modules/patches/compositions with tags,
cross-ratings (most items past the five-rater visibility threshold, a few
deliberately below it), and some pre-filled libraries.

Strictly a development tool. It refuses to run without an explicit database
path AND the --i-know-this-is-dev flag, and it refuses to touch a database
that already has real (non-seed) users unless --force is given.

Usage:
    PYTHONPATH=src python3 scripts/seed_community_dev.py \
        --db web/data/accounts.db --i-know-this-is-dev
"""

from __future__ import annotations

import argparse
import base64
import json
import random
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from synthesiser.web.accounts import AccountStore
from synthesiser.web.community import CommunityStore

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "community_seed" / "items.json"
SEED_DOMAIN = "seed.resona.dev"
SEED_PASSWORD = "seed-dev-only-1"

USERS = [
    ("aria.k",      "Aria K",          "Slow bass and patient rooms. Everything under 70 bpm.",          (242, 166, 35)),
    ("pulsewidth",  "Pulsewidth",      "Percussion first, melody if there's room left.",                 (94, 197, 255)),
    ("glasswing",   "Glasswing",       "High partials, glass hits, air. Chasing shimmer.",               (186, 129, 255)),
    ("moss",        "Moss",            "Field-recording brain, synthesiser hands.",                      (110, 214, 130)),
    ("tinears",     "Tin Ears",        "I rate honestly. Share your weird ones.",                        (255, 122, 122)),
    ("lowlantern",  "Low Lantern",     "Warm foundations for other people's ideas.",                     (255, 200, 87)),
    ("veskaya",     "Veskaya",         "Scale Lab resident. 17-EDO apologist.",                          (129, 224, 214)),
    ("driftline",   "Driftline",       "Compositions mostly. Trying to make 5 minutes feel like 30.",    (200, 200, 210)),
]


def make_avatar_png(rgb: tuple[int, int, int]) -> bytes:
    """A 64×64 two-tone diagonal-gradient PNG, standard library only."""
    width = height = 64
    r0, g0, b0 = rgb
    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter: none
        for x in range(width):
            t = (x + y) / (width + height - 2)
            rows += bytes((int(r0 * (1 - t) + 24 * t), int(g0 * (1 - t) + 26 * t), int(b0 * (1 - t) + 32 * t)))

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="seed-community-dev", description=__doc__)
    parser.add_argument("--db", required=True, help="path to the DEV accounts.db")
    parser.add_argument("--i-know-this-is-dev", action="store_true",
                        help="required: acknowledges this fills the DB with dummy data")
    parser.add_argument("--force", action="store_true",
                        help="run even if the DB already contains non-seed users")
    args = parser.parse_args(argv)

    if not args.i_know_this_is_dev:
        parser.error("refusing to run without --i-know-this-is-dev")
    if not FIXTURES.exists():
        parser.error(f"missing fixtures — run `node scripts/export_factory_json.mjs` first ({FIXTURES})")

    accounts = AccountStore(Path(args.db))
    community = CommunityStore(Path(args.db))

    real_users = [u for u in accounts.list_users() if not u["email"].endswith("@" + SEED_DOMAIN)]
    if real_users and not args.force:
        parser.error(
            f"database already has {len(real_users)} non-seed user(s) "
            f"(e.g. {real_users[0]['email']}); pass --force to seed anyway"
        )

    rng = random.Random(20260713)
    print(f"  DB: {accounts.db_path}")

    # 1. Users + profiles + avatars (idempotent: skip handles that exist).
    existing = {u["handle"].lower() for u in accounts.list_users()}
    users = []
    for handle, display, bio, rgb in USERS:
        if handle.lower() in existing:
            users.append(next(u for u in accounts.list_users() if u["handle"].lower() == handle.lower()))
            continue
        user = accounts.register(
            f"{handle.replace('.', '-')}@{SEED_DOMAIN}", SEED_PASSWORD,
            invite_code=None, handle=handle, require_invite=False,
        )
        community.update_profile(user["id"], display_name=display, bio=bio)
        community.set_avatar(user["id"], base64.b64encode(make_avatar_png(rgb)).decode())
        users.append(user)
    print(f"  users: {len(users)} seed profiles ready")

    # 2. Shared items spread round-robin across the seed users. Fixture kinds
    #    predate the three-kind taxonomy (owner 2026-07-14): sound/space
    #    modules and full patches become synths (full params merge fine when a
    #    synth loads first), behaviour modules become note engines.
    def seed_kind(item: dict) -> str:
        if item["kind"] == "composition":
            return "composition"
        if item["kind"] == "patch" or item.get("section") in ("sound", "space", "full", ""):
            return "synth"
        return "engine"

    def seed_data(item: dict, kind: str) -> dict:
        # Synths never carry percussion (owner 2026-07-15): drums belong to
        # the note engine, so perc params are scrubbed off synth items.
        data = dict(item["data"])
        if kind == "synth":
            params = dict(data.get("parameters") or {})
            data["parameters"] = {k: v for k, v in params.items() if not k.startswith("perc")}
        return data

    items = json.loads(FIXTURES.read_text(encoding="utf-8"))
    shared = []
    for i, item in enumerate(items):
        author = users[i % len(users)]
        # Driftline is "compositions mostly" — give the arrangements to them.
        if item["kind"] == "composition":
            author = users[-1]
        kind = seed_kind(item)
        shared.append((author, community.share_item(
            author["id"],
            kind=kind,
            name=item["name"],
            section=item.get("section", ""),
            description=item.get("description", ""),
            data=seed_data(item, kind),
            tags=item.get("tags"),
            source_id=item.get("source_id"),
        )))
    print(f"  items: {len(shared)} shared")

    # 3. Cross-ratings. ~3/4 of items pass the five-rater threshold; the rest
    #    sit at 1–4 ratings so the hidden-until-threshold state stays testable.
    rated = 0
    for author, item in shared:
        raters = [u for u in users if u["id"] != author["id"]]
        rng.shuffle(raters)
        n = rng.choice([5, 5, 6, 7]) if rng.random() < 0.75 else rng.randint(1, 4)
        base_quality = rng.uniform(2.6, 4.7)
        for rater in raters[:n]:
            stars = max(1, min(5, round(base_quality + rng.uniform(-1.2, 1.2))))
            community.rate(rater["id"], item["id"], stars)
            rated += 1
    print(f"  ratings: {rated} cast")

    # 4. A few pre-filled libraries so the Community browser tier has content.
    for user in users[:4]:
        picks = [it for a, it in shared if a["id"] != user["id"] and it["kind"] != "composition"]
        rng.shuffle(picks)
        for item in picks[:3]:
            community.library_add(user["id"], item["id"])
    print("  libraries: 4 users have community items in their browser")
    print(f"  done — log in as e.g. aria-k@{SEED_DOMAIN} / {SEED_PASSWORD}")


if __name__ == "__main__":
    main()
