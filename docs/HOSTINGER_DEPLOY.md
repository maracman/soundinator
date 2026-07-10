# Hostinger Deployment — invite-only, self-hosted profiles

This runbook stands up Resona on Hostinger with **user accounts locked behind an
invite-code system**, all on one box. It complements the platform-agnostic
[`DEPLOYMENT.md`](DEPLOYMENT.md); the account layer itself is documented in the
code at [`src/synthesiser/web/accounts.py`](../src/synthesiser/web/accounts.py).

The whole thing is dependency-light: the account store is **SQLite + Python
standard library** (no external database, no Supabase, no monthly service bill).
Turn it on with one env var; leave it off and the server behaves exactly as it
did before (open, anonymous research mode).

---

## 0. Which Hostinger plan — read this first

**You need a Hostinger VPS.** Resona's backend is a long-running Python process,
and only the VPS tier can run that:

| Hostinger tier | Runs the Python server? | Why |
|---|---|---|
| **VPS (KVM 1+)** | ✅ Yes | Full root SSH, systemd, nginx, free Let's Encrypt SSL. KVM 1 (1 vCPU / 4 GB) is plenty — the browser does all the audio work. |
| Web / shared hosting | ❌ No | PHP/MySQL only, no root, no persistent processes — the Python interpreter can't even be installed. |
| Cloud hosting | ❌ No | Same limitation as shared: no root access. |

If your current Hostinger plan is Web/shared or Cloud, either **upgrade to a VPS
(KVM 1, the cheapest)**, or keep the frontend on Hostinger static hosting and run
the Python backend on a free PaaS per [`DEPLOYMENT.md`](DEPLOYMENT.md) — but note
that splitting the frontend and backend across two origins complicates the
cookie-based sign-in, so **one VPS is strongly recommended**.

> There is no free Hostinger tier. KVM 1 is ~$6–7/mo at time of writing. If you'd
> rather not pay Hostinger at all, the same code deploys unchanged to a free
> Render/Railway/Fly instance (see `DEPLOYMENT.md`) — the invite system works
> identically there.

---

## 1. Point a domain / subdomain at the VPS

In hPanel → VPS, note the server's IP. Add a DNS **A record** (e.g.
`studio.yourdomain.com → <VPS IP>`). You'll use this hostname for HTTPS.

## 2. First SSH in and install prerequisites

Use hPanel's Browser Terminal or SSH. On Ubuntu 24.04:

```bash
apt update && apt install -y python3 python3-venv python3-pip git nginx
adduser --disabled-password --gecos "" resona    # run the app as a non-root user
```

## 3. Get the code and install dependencies

```bash
sudo -iu resona
git clone <your-repo-url> resona-app && cd resona-app
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt      # numpy / scipy / PyYAML
mkdir -p /home/resona/data           # persistent data dir (SQLite + JSONL live here)
```

## 4. Configure the environment

Create `/home/resona/resona.env` (owned by `resona`, `chmod 600`):

```ini
HOST=127.0.0.1
PORT=8765
PHASE0_DATA_DIR=/home/resona/data
RESONA_AUTH_REQUIRED=1      # LOCK the app: sign-in required for every page
RESONA_COOKIE_SECURE=1      # session cookie only sent over HTTPS (nginx terminates TLS)
PHASE0_ADMIN_TOKEN=<long-random-string>   # optional: enables /api/export.csv
# RESONA_OPEN_SIGNUP=1      # leave UNSET — keeps registration invite-only
```

The two flags that create the behaviour you asked for:

- **`RESONA_AUTH_REQUIRED=1`** — every page load is gated; logged-out visitors are
  bounced to `/login`, and data APIs return 401 without a session.
- Registration is **invite-only by default** — a valid invite code is required to
  create an account unless you explicitly set `RESONA_OPEN_SIGNUP=1`.

## 5. Bootstrap the first admin + invite codes

Accounts are created by redeeming an invite; the very first account is seeded
from the CLI (which bypasses the invite requirement):

```bash
cd /home/resona/resona-app && . .venv/bin/activate
export PHASE0_DATA_DIR=/home/resona/data

# your own owner account (no invite needed)
PYTHONPATH=src python3 -m synthesiser.web.accounts create-admin \
    --email you@example.com --password '<a-strong-password>' --handle owner

# mint invite codes to hand out (one single-use code shown per line)
PYTHONPATH=src python3 -m synthesiser.web.accounts create-invite --count 10 --note "beta wave 1"

# a reusable code for a small group, expiring in 14 days:
PYTHONPATH=src python3 -m synthesiser.web.accounts create-invite --max-uses 25 --expires-days 14 --note "class"

PYTHONPATH=src python3 -m synthesiser.web.accounts list-invites   # review outstanding codes
PYTHONPATH=src python3 -m synthesiser.web.accounts list-users     # who has signed up
```

Give each tester one code; they enter it on the **Create account** tab at
`/login`. The store enforces single-use (or `--max-uses`) and expiry atomically,
so a code can't be over-redeemed.

## 6. Run it as a systemd service

Create `/etc/systemd/system/resona.service` (as root):

```ini
[Unit]
Description=Resona studio
After=network.target

[Service]
User=resona
WorkingDirectory=/home/resona/resona-app
EnvironmentFile=/home/resona/resona.env
Environment=PYTHONPATH=/home/resona/resona-app/src
ExecStart=/home/resona/resona-app/.venv/bin/python3 -m synthesiser.web.server
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now resona
systemctl status resona           # should be active (running)
curl -s localhost:8765/api/health # {"ok": true, ...}
```

## 7. Put nginx + HTTPS in front

Create `/etc/nginx/sites-available/resona`:

```nginx
server {
    server_name studio.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/resona /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d studio.yourdomain.com     # free Let's Encrypt cert + auto-HTTPS
```

Certbot rewrites the nginx block to serve HTTPS and redirect HTTP → HTTPS. Because
`RESONA_COOKIE_SECURE=1`, the session cookie is now only sent over that TLS
connection.

## 8. Verify

- Visit `https://studio.yourdomain.com` → you should be redirected to **/login**.
- Sign in with the owner account from step 5 → you land in the studio with the
  account pill (top-right) → **My cloud patches** and **Sign out**.
- **Save current sound** stores a private patch tied to your account; sign in from
  another browser and it's there, isolated per user.

---

## Backups

Everything lives in `PHASE0_DATA_DIR` (`/home/resona/data`):

| File | Contents | Sensitivity |
|---|---|---|
| `accounts.db` | users (salted+hashed passwords), invites, sessions, private patches | **high — never commit or share** |
| `study_sessions.jsonl`, `explore_events.jsonl` | anonymous research data | consented research data |
| `global_presets.json` | shared preset library | public |

`accounts.db` is a single SQLite file — back it up with a nightly cron:

```bash
sqlite3 /home/resona/data/accounts.db ".backup '/home/resona/backups/accounts-$(date +\%F).db'"
```

`.gitignore` already excludes `*.db` so the account database can never be
committed to the repo.

---

## Security notes

- Passwords are stored as `pbkdf2_sha256` (600k iterations, per-user salt),
  verified in constant time — no plaintext, no reversible storage.
- Sessions are opaque random tokens in an **HttpOnly, SameSite=Lax** cookie
  (with `Secure` when `RESONA_COOKIE_SECURE=1`). SameSite=Lax blocks the common
  cross-site POST CSRF vector for this beta-scale deployment.
- Registration is closed by default — no invite code, no account.
- Keep `RESONA_OPEN_SIGNUP` **unset** unless you deliberately want anyone to
  self-register.
- Run one instance only (the SQLite store and JSONL appends assume a single box).

## Privacy / ethics reminder

Accounts collect **personal data** (email) inside a research project. Before a
public invite wave, put a privacy notice + consent covering account data in
place, and keep the anonymous study data separate from named accounts — see the
Privacy section of [`HOSTING_PLAN.md`](HOSTING_PLAN.md).

---

Sources for the plan-tier limitation:
[Is Python supported at Hostinger?](https://www.hostinger.com/support/3648030-is-python-supported-at-hostinger/) ·
[Hostinger supported technologies](https://www.hostinger.com/support/features/supported-technologies-and-functions/)
