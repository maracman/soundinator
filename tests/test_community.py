"""Tests for the community layer: profiles, shared items, ratings, tags,
per-user libraries, and the always-on auth gate over the community API."""

import base64
import http.cookiejar
import json
import threading
import urllib.error
import urllib.request

import pytest

from synthesiser.web.accounts import AccountStore
from synthesiser.web.community import (
    MIN_RATERS_FOR_VISIBILITY,
    CommunityError,
    CommunityStore,
    composition_duration_seconds,
)
from synthesiser.web.server import build_server

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24


def _stores(tmp_path):
    db = tmp_path / "accounts.db"
    return AccountStore(db), CommunityStore(db)


def _users(accounts, n):
    return [
        accounts.register(f"user{i}@example.com", "password1", invite_code=None, require_invite=False)
        for i in range(n)
    ]


def _arrangement(beats, tempo=96):
    return {
        "lengthBeats": beats,
        "tracks": [{"regions": [{"startBeat": 0, "lengthBeats": beats}]}],
        "context": {"tempo": tempo},
    }


# ── Profiles ─────────────────────────────────────────────────────────────────

def test_profile_update_and_lookup_by_handle(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    (alice,) = _users(accounts, 1)
    profile = community.update_profile(alice["id"], display_name="Aria", bio="I make slow bass.")
    assert profile["display_name"] == "Aria"
    assert profile["bio"] == "I make slow bass."
    by_handle = community.public_profile(alice["handle"])
    assert by_handle["id"] == alice["id"]
    assert by_handle["stats"]["items"] == 0


def test_bio_and_display_name_reject_links(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    (alice,) = _users(accounts, 1)
    for bad in ("see https://example.com", "www.example.com", "find me at example.com/x"):
        with pytest.raises(CommunityError):
            community.update_profile(alice["id"], bio=bad)
    with pytest.raises(CommunityError):
        community.update_profile(alice["id"], display_name="visit.me")


def test_avatar_validation_and_roundtrip(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    (alice,) = _users(accounts, 1)

    community.set_avatar(alice["id"], base64.b64encode(PNG).decode())
    blob, mime = community.get_avatar(alice["id"])
    assert blob == PNG and mime == "image/png"
    assert community.public_profile(alice["id"])["has_avatar"] is True

    with pytest.raises(CommunityError):  # not an image
        community.set_avatar(alice["id"], base64.b64encode(b"GIF89a not allowed").decode())
    with pytest.raises(CommunityError):  # not base64
        community.set_avatar(alice["id"], "!!not base64!!")
    with pytest.raises(CommunityError):  # too large
        community.set_avatar(alice["id"], base64.b64encode(PNG + b"\x00" * 200_000).decode())


# ── Sharing and visibility ───────────────────────────────────────────────────

def test_browse_hides_items_until_rating_threshold(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    users = _users(accounts, MIN_RATERS_FOR_VISIBILITY + 1)
    author, raters = users[0], users[1:]

    item = community.share_item(
        author["id"], kind="synth", name="Low Lantern", section="sound",
        description="a deep hum", data={"parameters": {"x": 1}}, tags=["bass", "warm"],
    )
    # The author always sees their own item; others don't until the threshold.
    assert [i["id"] for i in community.browse(viewer_id=author["id"])] == [item["id"]]
    assert community.browse(viewer_id=raters[0]["id"]) == []
    # Direct fetch by id always works (links must resolve).
    assert community.get_item(item["id"], viewer_id=raters[0]["id"])["name"] == "Low Lantern"
    # Profile listings show everything regardless of threshold.
    assert len(community.items_for_user(author["handle"], viewer_id=raters[0]["id"])) == 1

    for i, rater in enumerate(raters[:-1]):
        result = community.rate(rater["id"], item["id"], 4)
        assert result["avg_stars"] is None  # below threshold: no average yet
        assert community.browse(viewer_id=raters[-1]["id"]) == []

    result = community.rate(raters[-1]["id"], item["id"], 5)
    assert result["rating_count"] == MIN_RATERS_FOR_VISIBILITY
    assert result["avg_stars"] == pytest.approx(4.2)
    listed = community.browse(viewer_id=raters[0]["id"])
    assert [i["id"] for i in listed] == [item["id"]]
    assert listed[0]["avg_stars"] == pytest.approx(4.2)
    assert listed[0]["tags"] == ["bass", "warm"]


def test_cannot_rate_own_item_and_rating_edits_upsert(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    author, rater = _users(accounts, 2)
    item = community.share_item(author["id"], kind="engine", name="Deep Walker", data={"p": 1})

    with pytest.raises(CommunityError):
        community.rate(author["id"], item["id"], 5)
    with pytest.raises(CommunityError):
        community.rate(rater["id"], item["id"], 0)
    with pytest.raises(CommunityError):
        community.rate(rater["id"], item["id"], 4.5)

    community.rate(rater["id"], item["id"], 2)
    result = community.rate(rater["id"], item["id"], 5)  # edit, not a second vote
    assert result["rating_count"] == 1
    assert result["my_rating"] == 5


def test_share_validation(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    (alice,) = _users(accounts, 1)
    with pytest.raises(CommunityError):
        community.share_item(alice["id"], kind="widget", name="X", data={})
    with pytest.raises(CommunityError):
        community.share_item(alice["id"], kind="synth", name="", data={})
    with pytest.raises(CommunityError):
        community.share_item(alice["id"], kind="synth", name="visit www.spam.com", data={})
    with pytest.raises(CommunityError):
        community.share_item(alice["id"], kind="synth", name="X", data={}, tags=["<bad>"])
    with pytest.raises(CommunityError):
        community.share_item(alice["id"], kind="synth", name="X", data={}, tags=[f"t{i}" for i in range(9)])


def test_reshare_same_source_updates_in_place(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    author, rater = _users(accounts, 2)
    first = community.share_item(
        author["id"], kind="synth", name="V1", data={"v": 1}, source_id="user:abc"
    )
    community.rate(rater["id"], first["id"], 5)
    second = community.share_item(
        author["id"], kind="synth", name="V2", data={"v": 2}, source_id="user:abc"
    )
    assert second["id"] == first["id"]  # updated, not duplicated
    assert second["name"] == "V2"
    assert second["rating_count"] == 1  # ratings preserved


def test_tags_owner_only_and_replace(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    author, other = _users(accounts, 2)
    item = community.share_item(author["id"], kind="synth", name="X", data={}, tags=["one"])
    assert community.set_tags(author["id"], item["id"], ["two", "three"]) == ["two", "three"]
    assert community.get_item(item["id"])["tags"] == ["three", "two"]  # stored sorted
    with pytest.raises(CommunityError):
        community.set_tags(other["id"], item["id"], ["hijack"])


def test_unshare_cascades(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    author, rater = _users(accounts, 2)
    item = community.share_item(author["id"], kind="synth", name="X", data={}, tags=["t"])
    community.rate(rater["id"], item["id"], 3)
    community.library_add(rater["id"], item["id"])

    assert community.unshare_item(rater["id"], item["id"]) is False  # not the owner
    assert community.unshare_item(author["id"], item["id"]) is True
    assert community.get_item(item["id"]) is None
    assert community.library_list(rater["id"]) == []


# ── Compositions ─────────────────────────────────────────────────────────────

def test_composition_duration_and_cap(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    (alice,) = _users(accounts, 1)

    ok = community.share_item(
        alice["id"], kind="composition", name="Short Piece", data=_arrangement(400, tempo=96)
    )
    assert ok["duration_s"] == pytest.approx(250.0)

    with pytest.raises(CommunityError):  # 500 beats @96bpm = 312.5s > 5min
        community.share_item(alice["id"], kind="composition", name="Long", data=_arrangement(500, 96))
    with pytest.raises(CommunityError):  # absurd tempo is clamped, can't smuggle length
        community.share_item(alice["id"], kind="composition", name="Sneaky", data=_arrangement(40_000, 10_000))
    with pytest.raises(CommunityError):  # not an arrangement
        community.share_item(alice["id"], kind="composition", name="X", data={"no": "tracks"})


def test_duration_uses_furthest_region_end() -> None:
    data = _arrangement(10, tempo=60)
    data["tracks"].append({"regions": [{"startBeat": 100, "lengthBeats": 50}]})
    assert composition_duration_seconds(data) == pytest.approx(150.0)


# ── Library ──────────────────────────────────────────────────────────────────

def test_library_add_list_remove(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    author, member = _users(accounts, 2)
    item = community.share_item(author["id"], kind="engine", name="Glass", data={"p": 2})

    with pytest.raises(CommunityError):  # own items are already in your browser
        community.library_add(author["id"], item["id"])

    community.library_add(member["id"], item["id"])
    community.library_add(member["id"], item["id"])  # idempotent
    listing = community.library_list(member["id"])
    assert len(listing) == 1
    assert listing[0]["data"] == {"p": 2}  # full snapshot for the local cache
    assert listing[0]["author"]["handle"] == author["handle"]

    assert community.library_remove(member["id"], item["id"]) is True
    assert community.library_remove(member["id"], item["id"]) is False
    assert community.library_list(member["id"]) == []


# ── Top users and random ─────────────────────────────────────────────────────

def test_top_users_ranked_by_smoothed_score(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    users = _users(accounts, 8)
    good, mediocre, raters = users[0], users[1], users[2:]

    hit = community.share_item(good["id"], kind="synth", name="Hit", data={})
    meh = community.share_item(mediocre["id"], kind="synth", name="Meh", data={})
    for rater in raters:
        community.rate(rater["id"], hit["id"], 5)
        community.rate(rater["id"], meh["id"], 2)

    top = community.top_users()
    assert [t["user"]["handle"] for t in top] == [good["handle"], mediocre["handle"]]
    assert top[0]["top_items"][0]["name"] == "Hit"
    assert top[0]["top_items"][0]["avg_stars"] == pytest.approx(5.0)


def test_random_items_only_visible(tmp_path) -> None:
    accounts, community = _stores(tmp_path)
    users = _users(accounts, MIN_RATERS_FOR_VISIBILITY + 2)
    author, viewer, raters = users[0], users[1], users[1:]

    visible = community.share_item(author["id"], kind="synth", name="Seen", section="sound", data={})
    community.share_item(author["id"], kind="synth", name="Unseen", section="sound", data={})
    for rater in raters:
        community.rate(rater["id"], visible["id"], 4)

    picks = community.random_items(viewer_id=viewer["id"], kind="synth", section="sound", count=5)
    assert [p["name"] for p in picks] == ["Seen"]
    assert picks[0]["data"] == {}


# ── Server integration ───────────────────────────────────────────────────────

def _make_static(tmp_path) -> None:
    static = tmp_path / "web" / "static"
    static.mkdir(parents=True)
    (static / "index.html").write_text('<div id="app"></div>', encoding="utf-8")
    (static / "login.html").write_text("<title>Resona login</title>", encoding="utf-8")


def _serve(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    return f"http://{host}:{port}"


def _opener():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj)), cj


def _req(opener, base, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        resp = opener.open(request, timeout=20)
        return resp.status, resp.read(), resp
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc


def _json(raw):
    return json.loads(raw.decode("utf-8"))


def test_community_api_over_http(tmp_path) -> None:
    """Open deployment: app is public, but every community endpoint is gated."""
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    assert server.auth_required is False
    base = _serve(server)
    try:
        anon, _ = _opener()
        # Community/profile endpoints demand a session even on an open server.
        for method, path, body in [
            ("GET", "/api/community/browse", None),
            ("GET", "/api/users/1", None),
            ("POST", "/api/profile", {"bio": "hi"}),
            ("POST", "/api/community/share", {"kind": "synth", "name": "X", "data": {}}),
        ]:
            assert _req(anon, base, method, path, body)[0] == 401

        # Legacy experiment endpoints are gone unless RESONA_EXPERIMENTS is set.
        assert _req(anon, base, "GET", "/api/presets/global")[0] == 404
        assert _req(anon, base, "POST", "/api/study/submit", {"responses": []})[0] == 404
        me = _json(_req(anon, base, "GET", "/api/auth/me")[1])
        assert me["features"] == {"community": True, "experiments": False}

        # Two invite-gated accounts.
        code = server.accounts.create_invite(max_uses=10)["code"]
        alice, _ = _opener()
        bob, _ = _opener()
        for opener, email in ((alice, "alice@x.com"), (bob, "bob@x.com")):
            status, raw, _ = _req(opener, base, "POST", "/api/auth/register",
                                  {"email": email, "password": "password1", "invite_code": code})
            assert status == 201

        # Alice sets up a profile and avatar.
        assert _req(alice, base, "POST", "/api/profile",
                    {"display_name": "Aria", "bio": "Slow bass."})[0] == 200
        assert _req(alice, base, "POST", "/api/profile",
                    {"bio": "see www.spam.com"})[0] == 400
        assert _req(alice, base, "POST", "/api/profile/avatar",
                    {"image_base64": base64.b64encode(PNG).decode()})[0] == 200
        status, raw, resp = _req(bob, base, "GET", "/api/users/alice/avatar")
        assert status == 200 and raw == PNG
        assert resp.headers["Content-Type"] == "image/png"

        # Share → rate → library over HTTP.
        status, raw, _ = _req(alice, base, "POST", "/api/community/share",
                              {"kind": "synth", "name": "Low Lantern", "section": "sound",
                               "data": {"parameters": {"x": 1}}, "tags": ["bass"]})
        assert status == 201
        item_id = _json(raw)["item"]["id"]

        assert _req(alice, base, "POST", "/api/community/rate",
                    {"item_id": item_id, "stars": 5})[0] == 400  # own item
        status, raw, _ = _req(bob, base, "POST", "/api/community/rate",
                              {"item_id": item_id, "stars": 4})
        assert status == 200 and _json(raw)["rating_count"] == 1

        status, raw, _ = _req(bob, base, "POST", "/api/community/library", {"item_id": item_id})
        assert status == 201
        lib = _json(_req(bob, base, "GET", "/api/community/library")[1])
        assert [i["id"] for i in lib["items"]] == [item_id]
        assert lib["items"][0]["my_rating"] == 4

        # Profile view shows the item pre-threshold; browse (for bob) doesn't.
        items = _json(_req(bob, base, "GET", "/api/community/users/alice/items")[1])["items"]
        assert [i["name"] for i in items] == ["Low Lantern"]
        assert _json(_req(bob, base, "GET", "/api/community/browse")[1])["items"] == []

        # Unshare cleans up bob's library too.
        assert _req(bob, base, "DELETE", f"/api/community/items/{item_id}")[0] == 404
        assert _req(alice, base, "DELETE", f"/api/community/items/{item_id}")[0] == 200
        assert _json(_req(bob, base, "GET", "/api/community/library")[1])["items"] == []
    finally:
        server.shutdown()
        server.server_close()


# ── Anti-harvest fetch cap ───────────────────────────────────────────────────

def test_data_fetch_cap_counts_distinct_items_per_hour(tmp_path, monkeypatch) -> None:
    import synthesiser.web.community as community_mod
    from synthesiser.web.community import CommunityRateLimited

    monkeypatch.setattr(community_mod, "MAX_ITEM_DATA_FETCHES_PER_HOUR", 2)
    accounts, community = _stores(tmp_path)
    author, viewer = _users(accounts, 2)
    items = [
        community.share_item(author["id"], kind="synth", name=f"S{i}", section="sound", data={"i": i})
        for i in range(3)
    ]

    # Two distinct items are fine; re-fetching one already counted is free.
    community.get_item(items[0]["id"], viewer_id=viewer["id"], count_fetch=True)
    community.get_item(items[1]["id"], viewer_id=viewer["id"], count_fetch=True)
    community.get_item(items[0]["id"], viewer_id=viewer["id"], count_fetch=True)

    with pytest.raises(CommunityRateLimited):
        community.get_item(items[2]["id"], viewer_id=viewer["id"], count_fetch=True)

    # The author is never charged for their own items.
    for item in items:
        community.get_item(item["id"], viewer_id=author["id"], count_fetch=True)

    # Once the window slides past, the budget frees up.
    with community._connect() as conn:
        conn.execute("UPDATE item_data_fetches SET fetched_at = fetched_at - 7200")
    community.get_item(items[2]["id"], viewer_id=viewer["id"], count_fetch=True)


def test_data_fetch_cap_maps_to_http_429(tmp_path, monkeypatch) -> None:
    import synthesiser.web.community as community_mod

    monkeypatch.setattr(community_mod, "MAX_ITEM_DATA_FETCHES_PER_HOUR", 1)
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    base = _serve(server)
    try:
        code = server.accounts.create_invite(max_uses=10)["code"]
        alice, _ = _opener()
        bob, _ = _opener()
        for opener, email in ((alice, "alice@x.com"), (bob, "bob@x.com")):
            assert _req(opener, base, "POST", "/api/auth/register",
                        {"email": email, "password": "password1", "invite_code": code})[0] == 201
        ids = []
        for name in ("One", "Two"):
            status, raw, _ = _req(alice, base, "POST", "/api/community/share",
                                  {"kind": "synth", "name": name, "section": "sound", "data": {}})
            assert status == 201
            ids.append(_json(raw)["item"]["id"])

        assert _req(bob, base, "GET", f"/api/community/items/{ids[0]}")[0] == 200
        # Same item again: free (already counted this hour).
        assert _req(bob, base, "GET", f"/api/community/items/{ids[0]}")[0] == 200
        # A second distinct item breaches the cap → 429.
        status, raw, _ = _req(bob, base, "GET", f"/api/community/items/{ids[1]}")
        assert status == 429
        assert "slow down" in _json(raw)["error"]
        # Metadata-only surfaces (browse, profiles) are unaffected.
        assert _req(bob, base, "GET", "/api/community/browse")[0] == 200
        # The author can still load their own items freely.
        assert _req(alice, base, "GET", f"/api/community/items/{ids[1]}")[0] == 200
    finally:
        server.shutdown()
        server.server_close()


def test_share_requires_verified_email(tmp_path, monkeypatch) -> None:
    # The verified-email gate only arms once a mail provider is configured —
    # without one, nobody could complete verification.
    from synthesiser.web import mailer
    monkeypatch.setattr(mailer, "email_configured", lambda: True)

    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.open_signup = True
    base = _serve(server)
    try:
        maker, _ = _opener()
        _req(maker, base, "POST", "/api/auth/register",
             {"email": "unverified@x.com", "password": "password1"})

        # Unverified: sharing is refused; everything else still works.
        status, raw, _ = _req(maker, base, "POST", "/api/community/share",
                              {"kind": "synth", "name": "Blocked", "section": "sound", "data": {}})
        assert status == 403
        assert "verify your email" in _json(raw)["error"]
        assert _req(maker, base, "GET", "/api/community/browse")[0] == 200
        assert _req(maker, base, "POST", "/api/patches",
                    {"name": "private ok", "data": {}})[0] == 201

        # Verified: the same share goes through.
        user = server.accounts.user_by_email("unverified@x.com")
        server.accounts.mark_email_verified(user["id"])
        assert _req(maker, base, "POST", "/api/community/share",
                    {"kind": "synth", "name": "Allowed", "section": "sound", "data": {}})[0] == 201
    finally:
        server.shutdown()
        server.server_close()
