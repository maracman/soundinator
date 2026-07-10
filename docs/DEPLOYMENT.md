# Deployment Runbook

The Sound Studio ships as one dependency-light Python server (stdlib HTTP +
numpy/scipy for server-side rendering). Audio runs client-side in the
browser; the server hosts static files, collects study/explore data, and
serves the preset library — so a single small instance is plenty for a
pilot study.

## What the server needs

| Env var              | Required | Purpose                                             |
|----------------------|----------|-----------------------------------------------------|
| `PORT`               | set by PaaS | Listen port (defaults to 8765 locally)           |
| `HOST`               | no       | Procfile passes `--host 0.0.0.0` already            |
| `PHASE0_DATA_DIR`    | **yes, in production** | Where JSONL/preset data is written — point at a persistent volume or all collected data dies with the instance |
| `PHASE0_CACHE_DIR`   | no       | Server-render cache; safe to lose (regenerable)     |
| `PHASE0_ADMIN_TOKEN` | recommended | Enables `/api/export.csv`; keep it secret        |
| `PHASE0_RATE_LIMIT`  | no       | POSTs/min/IP (default 120; 0 disables)              |
| `RESONA_AUTH_REQUIRED` | no     | `1` locks the whole app behind sign-in (logged-out → `/login`, protected APIs → 401). Unset = open, anonymous mode (default). |
| `RESONA_OPEN_SIGNUP` | no       | `1` allows self-registration without a code. Leave unset to keep registration **invite-only** (the default). |
| `RESONA_COOKIE_SECURE` | no     | `1` marks the session cookie `Secure` (set it whenever the app is served over HTTPS). |

Process command (already in `Procfile`):

```
web: PYTHONPATH=src python3 -m synthesiser.web.server --host 0.0.0.0
```

## Railway (quickest)

1. `railway init` in the repo (or "Deploy from GitHub repo" in the dashboard).
2. Add a **Volume**, mount it at `/data`.
3. Set env vars: `PHASE0_DATA_DIR=/data`, `PHASE0_ADMIN_TOKEN=<long random string>`.
4. Railway injects `PORT` automatically; the Procfile is detected as the start command. Python deps install from `requirements.txt`.
5. Deploy, then check `https://<app>.up.railway.app/api/health` —
   `data_dir_writable` must be `true` and `data_dir` must be `/data`.

## Render

1. New → Web Service → connect the repo.
2. Build command: `pip install -r requirements.txt`; start command: copy the Procfile line.
3. Add a **Disk** (e.g. 1 GB) mounted at `/var/data`; set `PHASE0_DATA_DIR=/var/data`.
4. Set `PHASE0_ADMIN_TOKEN`. Render injects `PORT`.

## Fly.io

1. `fly launch --no-deploy` (accept the generated fly.toml; internal port = 8080, so set `PORT=8080` in `[env]`).
2. `fly volumes create phase0_data --size 1`.
3. In fly.toml add a `[mounts]` section: `source = "phase0_data"`, `destination = "/data"`, and `PHASE0_DATA_DIR = "/data"` under `[env]`.
4. `fly secrets set PHASE0_ADMIN_TOKEN=<long random string>` then `fly deploy`.

## After deploying

- **Health**: `GET /api/health` → confirm `ok`, `data_dir_writable: true`,
  `export_enabled: true`.
- **Pull data** (no shell needed):
  `curl -o ratings.csv "https://<app>/api/export.csv?table=ratings&token=$TOKEN"` —
  tables: `events`, `ratings`, `stimuli`, `study_trials`, `presets`.
- **Back up**: schedule a periodic `export.csv` pull for each table, or snapshot
  the volume. `stimuli.csv` + the app version is sufficient to regenerate any
  rated sound exactly.

## Accounts & invite codes (optional, self-hosted)

The server ships an optional, dependency-light account layer (SQLite + stdlib
crypto — no external database). It is **off unless `RESONA_AUTH_REQUIRED=1`**, so
the anonymous research/explore flows above are unchanged by default.

To run an invite-only deployment (per-user profiles + private "cloud patches"):

1. Set `RESONA_AUTH_REQUIRED=1` and `RESONA_COOKIE_SECURE=1` (behind HTTPS).
2. Seed the first owner and mint invites with the CLI (writes to
   `PHASE0_DATA_DIR/accounts.db`):

   ```bash
   PYTHONPATH=src python3 -m synthesiser.web.accounts create-admin \
       --email you@example.com --password '<strong>' --handle owner
   PYTHONPATH=src python3 -m synthesiser.web.accounts create-invite --count 10
   ```

3. Testers redeem a code on the **Create account** tab at `/login`.

For a full one-box VPS walkthrough (systemd + nginx + Let's Encrypt), see
[`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md).

## Notes

- The server is threaded with flock-guarded appends; run **one instance**
  (multiple instances would each need their own volume — don't).
- CORS is open (`*`) on JSON endpoints; data-collection endpoints are
  rate-limited per IP.
- `web/cache/` on ephemeral disk is fine; server-rendered WAVs regenerate
  from parameter hashes on demand.
