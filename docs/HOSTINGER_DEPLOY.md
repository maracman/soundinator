# Hostinger Deployment — invite-only, self-hosted profiles

This runbook stands up Soundinator on Hostinger with **user accounts locked behind an
invite-code system**, all on one box. It complements the platform-agnostic
[`DEPLOYMENT.md`](DEPLOYMENT.md); the account layer itself is documented in the
code at [`src/synthesiser/web/accounts.py`](../src/synthesiser/web/accounts.py).

The whole thing is dependency-light: the account store is **SQLite + Python
standard library** (no external database, no Supabase, no monthly service bill).
Turn it on with one env var; leave it off and the server behaves exactly as it
did before (open, anonymous research mode).

> **Production status (2026-07-14):** this runbook has been executed —
> Soundinator is live at [thesoundinator.com](https://thesoundinator.com)
> (Hostinger KVM 1, fully locked: `RESONA_AUTH_REQUIRED=1`,
> `RESONA_COOKIE_SECURE=1`; DNS at Hover). Ship updates with
> `scripts/vps_update.sh` — see §9.

---

## 0. Which Hostinger plan — read this first

**You need a Hostinger VPS.** Soundinator's backend is a long-running Python process,
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
RESONA_COOKIE_SECURE=1      # session cookie only sent over HTTPS (nginx terminates TLS)
PHASE0_ADMIN_TOKEN=<long-random-string>   # optional: enables /api/export.csv
# RESONA_AUTH_REQUIRED=1    # optional: lock EVERY page behind /login (see below)
# RESONA_OPEN_SIGNUP=1      # leave UNSET — keeps registration invite-only
# RESONA_EXPERIMENTS=1      # leave UNSET — hides the old study/research surfaces
```

The community-launch posture is **open to try, invite-gated to participate**:

- With `RESONA_AUTH_REQUIRED` unset, anyone with the link can play the synth
  (their work lives in their browser's localStorage). Everything under
  `/api/community/*`, `/api/profile*`, `/api/users/*`, and `/api/patches`
  still requires a signed-in session — saving or sharing pops the in-app
  create-profile overlay, and registration needs an invite code.
- Set `RESONA_AUTH_REQUIRED=1` only if you want the fully locked behaviour.
  The welcome screen (`/`) stays visible so visitors see what they're being
  invited to; the client shows an "early access — invite only" notice when
  they try to enter the studio, and every data API returns 401 without a
  session.
- Users can send bug reports from the account menu ("⚑ Report a problem");
  they land in `feedback.jsonl` under the data dir (screenshots in
  `feedback_shots/`) and export via
  `/api/export.csv?table=feedback&token=$PHASE0_ADMIN_TOKEN`.
- Registration is **invite-only by default** — a valid invite code is required
  to create an account unless you explicitly set `RESONA_OPEN_SIGNUP=1`.
- `RESONA_EXPERIMENTS` stays unset in production: the legacy study routes and
  the anonymous preset-contribute endpoints return 404, and the study cards
  disappear from the landing page.

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

# the launch pattern: ONE code on listentomarcus, good for 50 sign-ups —
# swap it for a fresh one when it fills so the studio never gets overwhelmed
PYTHONPATH=src python3 -m synthesiser.web.accounts create-invite --max-uses 50 --note "launch wave 1"

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
Description=Soundinator studio
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
    client_max_body_size 2m;   # shared compositions + avatar uploads are ~1 MB JSON bodies
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

- Visit `https://studio.yourdomain.com` → the studio loads and plays without an
  account; the top-right shows **Create profile / Log in**.
- **Create profile** (with an invite code from step 5) works in place — no page
  navigation, current sound untouched.
- Signed in: the account pill (top-right) → **My profile**, **My cloud patches**,
  **Sign out**. In the Producer, the Browser header's **☄ Community** button opens
  the community browser; right-clicking one of your presets offers
  **Share to community…**.
- `https://studio.yourdomain.com/#study/consent` falls through to the studio
  (experiments hidden) unless `RESONA_EXPERIMENTS=1`.

---

## 9. Updating the deployed version

Deploys are **pull-based**: the VPS has a normal git clone, so shipping an
update is "push to GitHub, then tell the server to catch up". No CI/CD needed
at this scale — [`scripts/vps_update.sh`](../scripts/vps_update.sh) makes it
one command and refuses to leave the server half-updated.

One-time setup — let the `resona` user restart its own service (as root):

```bash
echo 'resona ALL=(root) NOPASSWD: /usr/bin/systemctl restart resona' \
    > /etc/sudoers.d/resona-restart && chmod 440 /etc/sudoers.d/resona-restart
```

Then every update, from your own machine:

```bash
git push                                            # your normal push to GitHub
ssh resona@<vps> 'resona-app/scripts/vps_update.sh' # pull + deps + restart + health check
```

The script fast-forwards to `origin/main` (it aborts if the server checkout
has diverged, rather than merging), reinstalls `requirements.txt` (a no-op
when unchanged), restarts systemd, and curls `/api/health`. If the health
check fails it prints the exact one-line rollback (`git reset --hard <old>` +
restart) so a bad deploy is a 30-second incident.

Notes:

- **User data is never touched** — everything lives in `PHASE0_DATA_DIR`
  outside the repo, so pulls and rollbacks can't harm accounts or patches.
- A restart drops no sessions (they're in SQLite); users don't notice beyond
  a ~2-second blip. Deploying the session-hashing change signs everyone out
  once.
- **Remember the cache-buster**: when `app.js` / `styles.css` change, bump the
  `?v=` in `web/static/index.html` in the same commit, or returning browsers
  keep the old bundle.
- Skip auto-deploy-on-push (GitHub Actions) for now: at beta scale it mostly
  adds a way for an untested commit to take the site down. Revisit if pushes
  become frequent enough that the ssh line feels like friction — and gate it
  on the test suite if you do.

---

## Backups

Everything lives in `PHASE0_DATA_DIR` (`/home/resona/data`):

| File | Contents | Sensitivity |
|---|---|---|
| `accounts.db` | users (salted+hashed passwords), invites, sessions, private patches, **and all community data** (profiles, avatars, shared items, ratings, tags, libraries) | **high — never commit or share** |
| `study_sessions.jsonl`, `explore_events.jsonl` | anonymous research data | consented research data |
| `global_presets.json` | legacy shared preset library (only served when `RESONA_EXPERIMENTS=1`) | public |

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
