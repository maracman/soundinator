"""Transactional email via the Resend HTTPS API — standard library only.

Configuration comes from the environment (resona.env in production):

    RESONA_EMAIL_API_KEY   Resend API key; email is silently disabled when unset
    RESONA_EMAIL_FROM      e.g. "Soundinator <no-reply@thesoundinator.com>"
    RESONA_PUBLIC_URL      canonical site origin used in emailed links

When no API key is configured, ``send_email`` returns False and the caller is
expected to print the would-have-been link to the server log instead — that
keeps local development and tests working with no provider account.

Sends run on a fire-and-forget daemon thread by default so a slow provider
can never stall a registration request.
"""

from __future__ import annotations

import json
import os
import threading
import urllib.error
import urllib.request

RESEND_ENDPOINT = "https://api.resend.com/emails"
SEND_TIMEOUT_S = 10.0


def email_configured() -> bool:
    return bool(os.environ.get("RESONA_EMAIL_API_KEY", "").strip())


def public_url() -> str:
    return os.environ.get("RESONA_PUBLIC_URL", "").strip().rstrip("/") or "http://127.0.0.1:8765"


def _send_now(to: str, subject: str, text: str) -> bool:
    api_key = os.environ.get("RESONA_EMAIL_API_KEY", "").strip()
    sender = os.environ.get("RESONA_EMAIL_FROM", "").strip()
    if not api_key or not sender:
        return False
    payload = json.dumps({
        "from": sender,
        "to": [to],
        "subject": subject,
        "text": text,
    }).encode("utf-8")
    request = urllib.request.Request(
        RESEND_ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Resend's API is fronted by Cloudflare, which 403s (error 1010)
            # the default "Python-urllib/x.y" agent. Identify as the app.
            "User-Agent": "Soundinator/1.0 (+https://thesoundinator.com)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=SEND_TIMEOUT_S) as response:
            ok = 200 <= response.status < 300
    except (urllib.error.URLError, OSError) as exc:
        print(f"  ! email send failed to {to}: {exc}")
        return False
    if not ok:
        print(f"  ! email send to {to} returned HTTP {response.status}")
    return ok


def send_email(to: str, subject: str, text: str, *, background: bool = True) -> bool:
    """Send one plain-text email. Returns False when email is not configured.

    With ``background=True`` (the default) the provider call happens on a
    daemon thread and the return value only reflects *configuration*, not
    delivery — callers that need the result (tests) pass background=False.
    """
    if not email_configured():
        return False
    if background:
        threading.Thread(target=_send_now, args=(to, subject, text), daemon=True).start()
        return True
    return _send_now(to, subject, text)
