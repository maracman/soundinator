"""Tests for the account layer: password hashing, invite-gated registration,
sessions, private patches, and the opt-in auth gate on the web server."""

import http.cookiejar
import json
import threading
import urllib.error
import urllib.request

import pytest

from synthesiser.web.accounts import (
    AccountError,
    AccountStore,
    hash_password,
    verify_password,
)
from synthesiser.web.server import build_server


# ── AccountStore unit tests ──────────────────────────────────────────────────

def test_password_hash_roundtrip() -> None:
    encoded = hash_password("correct horse")
    assert encoded.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse", encoded)
    assert not verify_password("wrong horse", encoded)
    assert not verify_password("correct horse", "garbage")


def test_short_password_rejected() -> None:
    with pytest.raises(AccountError):
        hash_password("short")


def test_register_requires_valid_invite(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    with pytest.raises(AccountError):
        store.register("a@b.com", "password1", invite_code="does-not-exist")

    code = store.create_invite(note="beta")["code"]
    user = store.register("a@b.com", "password1", invite_code=code)
    assert user["email"] == "a@b.com"
    assert user["handle"]  # auto-derived from the email local part
    assert user["is_admin"] is False


def test_invite_is_single_use_by_default(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    code = store.create_invite()["code"]
    store.register("first@b.com", "password1", invite_code=code)
    with pytest.raises(AccountError):
        store.register("second@b.com", "password1", invite_code=code)


def test_invite_max_uses(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    code = store.create_invite(max_uses=2)["code"]
    store.register("first@b.com", "password1", invite_code=code)
    store.register("second@b.com", "password1", invite_code=code)
    with pytest.raises(AccountError):
        store.register("third@b.com", "password1", invite_code=code)


def test_duplicate_email_rejected(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    store.register("dup@b.com", "password1", invite_code=None, require_invite=False)
    with pytest.raises(AccountError):
        # case-insensitive uniqueness
        store.register("DUP@b.com", "password1", invite_code=None, require_invite=False)


def test_admin_bootstrap_skips_invite(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    admin = store.register(
        "admin@b.com", "password1", invite_code=None, require_invite=False, is_admin=True
    )
    assert admin["is_admin"] is True
    assert store.count_users() == 1


def test_authenticate(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    store.register("a@b.com", "password1", invite_code=None, require_invite=False)
    assert store.authenticate("a@b.com", "password1") is not None
    assert store.authenticate("A@B.COM", "password1") is not None  # case-insensitive
    assert store.authenticate("a@b.com", "nope") is None
    assert store.authenticate("ghost@b.com", "password1") is None


def test_session_lifecycle(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    user = store.register("a@b.com", "password1", invite_code=None, require_invite=False)
    token = store.create_session(user["id"])
    assert store.user_for_session(token)["email"] == "a@b.com"
    assert store.user_for_session("bogus") is None
    store.delete_session(token)
    assert store.user_for_session(token) is None


def test_patch_crud_isolated_per_user(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    alice = store.register("alice@b.com", "password1", invite_code=None, require_invite=False)
    bob = store.register("bob@b.com", "password1", invite_code=None, require_invite=False)

    p = store.save_patch(alice["id"], name="Warm Pad", data={"seed": 1}, kind="preset")
    assert store.list_patches(alice["id"])[0]["name"] == "Warm Pad"
    assert store.list_patches(bob["id"]) == []  # bob can't see alice's patch

    # update in place
    p2 = store.save_patch(alice["id"], name="Warm Pad v2", data={"seed": 2}, patch_id=p["id"])
    assert p2["id"] == p["id"]
    assert store.list_patches(alice["id"])[0]["data"] == {"seed": 2}
    assert len(store.list_patches(alice["id"])) == 1

    # bob cannot delete alice's patch
    assert store.delete_patch(bob["id"], p["id"]) is False
    assert store.delete_patch(alice["id"], p["id"]) is True
    assert store.list_patches(alice["id"]) == []


# ── Server integration: the opt-in auth gate ─────────────────────────────────

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
    no_redirect = _NoRedirect()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), no_redirect), cj


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None  # surface the 3xx as an HTTPError instead of following it


def _req(opener, base, method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    try:
        resp = opener.open(request, timeout=20)
        raw = resp.read().decode("utf-8")
        return resp.status, raw, resp
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8"), exc


def test_locked_server_full_flow(tmp_path) -> None:
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.auth_required = True  # simulate RESONA_AUTH_REQUIRED without env
    base = _serve(server)
    opener, cookies = _opener()
    try:
        # Pre-mint an invite through the same store the server uses.
        code = server.accounts.create_invite(note="test")["code"]

        # 1. Locked: the app shell stays public (the client shows the
        # invite-only welcome screen); other pages still bounce to /login.
        status, _, resp = _req(opener, base, "GET", "/")
        assert status == 200
        (tmp_path / "web" / "static" / "other.html").write_text("x", encoding="utf-8")
        status, _, resp = _req(opener, base, "GET", "/other.html")
        assert status == 302
        assert resp.headers["Location"] == "/login"

        # 2. Protected API without a session → 401.
        status, _, _ = _req(opener, base, "POST", "/api/explore/event", {"event_type": "x"})
        assert status == 401

        # 3. /login and /api/health stay open.
        assert _req(opener, base, "GET", "/login")[0] == 200
        assert _req(opener, base, "GET", "/api/health")[0] == 200

        # 4. Register without an invite is rejected...
        status, _, _ = _req(
            opener, base, "POST", "/api/auth/register",
            {"email": "u@b.com", "password": "password1"},
        )
        assert status == 400

        # ...but succeeds with the invite and sets a session cookie.
        status, raw, _ = _req(
            opener, base, "POST", "/api/auth/register",
            {"email": "u@b.com", "password": "password1", "invite_code": code},
        )
        assert status == 201
        assert json.loads(raw)["user"]["email"] == "u@b.com"
        assert any(c.name == "resona_session" for c in cookies)

        # 5. Now the session unlocks protected APIs and /api/auth/me.
        me = json.loads(_req(opener, base, "GET", "/api/auth/me")[1])
        assert me["user"]["email"] == "u@b.com"
        assert _req(opener, base, "POST", "/api/explore/event", {"event_type": "x"})[0] == 200

        # 6. Patch CRUD over HTTP with the session cookie.
        status, raw, _ = _req(
            opener, base, "POST", "/api/patches", {"name": "P1", "data": {"seed": 5}}
        )
        assert status == 201
        pid = json.loads(raw)["patch"]["id"]
        listing = json.loads(_req(opener, base, "GET", "/api/patches")[1])
        assert [p["name"] for p in listing["patches"]] == ["P1"]
        assert _req(opener, base, "DELETE", f"/api/patches/{pid}")[0] == 200
        assert json.loads(_req(opener, base, "GET", "/api/patches")[1])["patches"] == []

        # 7. Logout clears the session.
        assert _req(opener, base, "POST", "/api/auth/logout")[0] == 200
        assert json.loads(_req(opener, base, "GET", "/api/auth/me")[1])["user"] is None
    finally:
        server.shutdown()
        server.server_close()


def test_open_server_preserves_anonymous_access(tmp_path) -> None:
    """With the gate off (the default), anonymous research/explore is unchanged."""
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    assert server.auth_required is False
    base = _serve(server)
    opener, _ = _opener()
    try:
        # GET / serves the app directly — no redirect.
        status, raw, _ = _req(opener, base, "GET", "/")
        assert status == 200
        assert '<div id="app">' in raw

        # Anonymous explore events still work.
        assert _req(opener, base, "POST", "/api/explore/event", {"event_type": "x"})[0] == 200

        # Patches always require a login, even in open mode (can't own data anon).
        assert _req(opener, base, "GET", "/api/patches")[0] == 401
    finally:
        server.shutdown()
        server.server_close()


# ── Email verification + password reset ──────────────────────────────────────

def test_email_token_roundtrip_and_single_use(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    user = store.register("v@x.com", "password1", invite_code=None, require_invite=False)
    assert user["email_verified"] is False

    token = store.create_email_token(user["id"], "verify")
    # Wrong kind, wrong token: no redemption.
    assert store.consume_email_token(token, "reset") is None
    assert store.consume_email_token("nonsense", "verify") is None
    # Right token redeems exactly once.
    assert store.consume_email_token(token, "verify") == user["id"]
    assert store.consume_email_token(token, "verify") is None

    store.mark_email_verified(user["id"])
    assert store.get_user(user["id"])["email_verified"] is True

    # Re-requesting a token invalidates the previous one.
    first = store.create_email_token(user["id"], "reset")
    second = store.create_email_token(user["id"], "reset")
    assert store.consume_email_token(first, "reset") is None
    assert store.consume_email_token(second, "reset") == user["id"]


def test_cli_created_accounts_are_preverified(tmp_path) -> None:
    store = AccountStore(tmp_path / "accounts.db")
    user = store.register(
        "owner@x.com", "password1", invite_code=None, require_invite=False, mark_verified=True
    )
    assert user["email_verified"] is True


def test_verify_link_flow_over_http(tmp_path) -> None:
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.open_signup = True
    base = _serve(server)
    opener, _ = _opener()
    try:
        status, raw, _ = _req(opener, base, "POST", "/api/auth/register",
                              {"email": "new@x.com", "password": "password1"})
        assert status == 201
        user = json.loads(raw)["user"]
        assert user["email_verified"] is False
        me = json.loads(_req(opener, base, "GET", "/api/auth/me")[1])
        assert me["user"]["email_verified"] is False

        # Expired/garbage token bounces without verifying.
        status, _, resp = _req(opener, base, "GET", "/verify?token=garbage")
        assert status == 302 and resp.headers["Location"] == "/?verified=expired"

        # A real token (as the emailed link would carry) verifies the account.
        token = server.accounts.create_email_token(user["id"], "verify")
        status, _, resp = _req(opener, base, "GET", f"/verify?token={token}")
        assert status == 302 and resp.headers["Location"] == "/?verified=1"
        me = json.loads(_req(opener, base, "GET", "/api/auth/me")[1])
        assert me["user"]["email_verified"] is True

        # Resend endpoint acknowledges the already-verified state.
        status, raw, _ = _req(opener, base, "POST", "/api/auth/resend-verification", {})
        assert status == 200 and json.loads(raw).get("already_verified") is True
    finally:
        server.shutdown()
        server.server_close()


def test_password_reset_flow_over_http(tmp_path) -> None:
    _make_static(tmp_path)
    server = build_server("127.0.0.1", 0, root=tmp_path)
    server.open_signup = True
    base = _serve(server)
    opener, _ = _opener()
    try:
        _req(opener, base, "POST", "/api/auth/register",
             {"email": "resetme@x.com", "password": "oldpassword1"})

        # Unknown addresses get the same 200 as known ones (no enumeration).
        assert _req(opener, base, "POST", "/api/auth/request-reset",
                    {"email": "nobody@x.com"})[0] == 200
        assert _req(opener, base, "POST", "/api/auth/request-reset",
                    {"email": "resetme@x.com"})[0] == 200

        user = server.accounts.user_by_email("resetme@x.com")
        token = server.accounts.create_email_token(user["id"], "reset")

        # A too-short password is rejected BEFORE the token is consumed, so
        # the emailed link survives the typo and the retry succeeds.
        status, raw, _ = _req(opener, base, "POST", "/api/auth/reset",
                              {"token": token, "password": "short"})
        assert status == 400
        status, raw, _ = _req(opener, base, "POST", "/api/auth/reset",
                              {"token": token, "password": "newpassword1"})
        assert status == 200

        # The old session died with the reset; the old password no longer works.
        assert _req(opener, base, "GET", "/api/patches")[0] == 401
        assert _req(opener, base, "POST", "/api/auth/login",
                    {"email": "resetme@x.com", "password": "oldpassword1"})[0] == 401
        status, raw, _ = _req(opener, base, "POST", "/api/auth/login",
                              {"email": "resetme@x.com", "password": "newpassword1"})
        assert status == 200
        # Completing a reset proves inbox ownership → verified.
        assert json.loads(raw)["user"]["email_verified"] is True

        # A consumed reset token can't be replayed.
        assert _req(opener, base, "POST", "/api/auth/reset",
                    {"token": token, "password": "anotherpass1"})[0] == 400
    finally:
        server.shutdown()
        server.server_close()
