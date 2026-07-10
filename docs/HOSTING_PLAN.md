# Public Hosting Plan — Free Launch + Community Library

Goal: put the Sound Studio out publicly so people can make and share music,
with **accounts** for clean per-user signal and an anti-junk quality gate —
without risking a surprise hosting bill.

This is the strategic plan for the **public/community launch**. It builds on
the two existing operational runbooks:

- [`PHASE0_HOSTING.md`](PHASE0_HOSTING.md) — original single-server hosting.
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — Render / Railway / Fly runbook for the Python server.
- [`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md) — **self-hosted, invite-only** deploy
  on a Hostinger VPS.

Where they differ, this document is the plan for the community launch; those two
remain correct for running the Python server on its own (e.g. for a closed study).

> **Two accounts models now exist.** This document describes the *open* community
> launch on **Supabase** (managed auth, open registration + moderation queue).
> A simpler, fully **self-hosted invite-only** alternative is now implemented in
> the Python server itself (SQLite accounts + invite codes, no external service)
> — see [`HOSTINGER_DEPLOY.md`](HOSTINGER_DEPLOY.md) and
> [`accounts.py`](../src/synthesiser/web/accounts.py). Use that for a closed beta
> or research cohort; use the Supabase model below if/when you want a large,
> self-serve public community. They are mutually exclusive — pick one.

---

## The core insight: this is a static app, not a compute service

Audio is synthesised **client-side** in each visitor's browser via Web Audio
(`web/static/synth.js`, `app.js`). Confirmed: the browser never calls the server
to make sound. The whole app is **~600 KB of JavaScript** that loads once and
then runs on the visitor's machine.

Consequences that drive every decision below:

- The server does none of the expensive work — 1,000 people making music is
  1,000 browsers working and one small backend resting.
- A visit costs ~600 KB once, then near-zero (cached).
- **Shares are JSON, not audio.** Any sound is reproducible from its seed +
  parameters, so a shared creation is a few KB of JSON that re-renders on the
  *recipient's* machine. This sidesteps the audio-storage/egress cost that kills
  most "SoundCloud for X" platforms. Sharing scales for kilobytes.

---

## Architecture: three separable parts

Split the app so the only part that can ever cost money is tiny and optional.

### A. The Studio (frontend) → free static host
- **Host:** Cloudflare Pages or GitHub Pages. Free, generous bandwidth, and
  **no billing relationship** — it cannot send you a bill.
- **What it serves:** the ~600 KB static bundle (`web/static/`). 99% of all
  traffic lands here.
- **Fail-safe:** even if the backend is down/paused, people can still make and
  export music. The core experience never depends on a paid service.

### B. Community backend (accounts + library + ratings) → Supabase free tier
- **Host:** Supabase (managed Postgres + Auth + Row-Level Security).
- **What it does:** sign-in, the shared preset library, ratings, favourites,
  the pending-queue moderation gate, reputation.
- **Why managed:** we do **not** hand-roll auth (no password hashing, resets,
  or breach liability). Supabase handles OAuth + magic-link and the database in
  one free tier.

### C. Research pipeline (anonymous study data) → keep the Python server
- **Host:** run locally, or deploy per `DEPLOYMENT.md` only when running a study.
- **What it does:** the offline stimulus generation, server-side validation
  render (`/api/render`), and consented anonymous event logging for the EEG/MVPA
  research.
- **Deliberate separation:** keep anonymous study data **separate** from the
  account-based community data. Cleaner for ethics (consented anonymous ratings
  ≠ named accounts) and keeps the public app stateless-except-for-Supabase.

---

## Cost model & "no surprise bill" guardrails

Realistic cost for a pilot of hundreds to low-thousands of users: **$0/month.**
You'd only start paying if it got genuinely popular — the problem you'd want.

Hard guardrails so it *stays* $0 no matter what:

1. **Use tiers that stop serving rather than bill** — Cloudflare/GitHub Pages
   (frontend) and Supabase free (backend). No credit-card overage.
2. **Keep `/api/render` disabled/gated for public launch.** It's the only
   server-side CPU path. It is not wired to Play, so playback is already safe —
   just don't expose it publicly. Add an env kill-switch before launch.
3. **Never store user audio server-side.** Exports download to the user's
   machine; shares stay as reproducible JSON.
4. **Rate limiting is already built in** (`PHASE0_RATE_LIMIT`, default
   120/min/IP) for any Python endpoints that stay live.
5. If a paid plan is ever used: **no autoscaling, one small instance, billing
   alert at $5.** A single fixed instance can't run away.

### Supabase free-tier caveats (verify current numbers at signup)
- Free projects **pause after ~1 week of inactivity** (one click to restore).
- **No built-in automated backups** on free — this is why we back up to Google
  Drive ourselves (see Backups). At your data size (tiny JSON) this is trivial.
- Roughly: 500 MB database, ~1 GB file storage, tens of thousands of monthly
  active auth users, 2 projects. You'll be nowhere near these.

---

## Accounts & anti-junk: the quality system

Two goals, two mechanisms:

- **"Proper signal per user"** → a stable identity on every rating/contribution,
  enabling dedup, reputation-weighting, and clean research data. Accounts via
  Supabase Auth (Google / GitHub OAuth + magic-link email; no passwords stored).
- **"Library doesn't fill with junk"** → a **pending-then-promote moderation
  pipeline**, enforced by the database. Accounts *help* (accountability,
  per-person rate limits) but the pipeline is the actual gate.

### Data model (Supabase / Postgres)

| Table | Key columns | Purpose |
|---|---|---|
| `profiles` | id (→ auth.users), handle, reputation | identity + trust score |
| `presets` | id, author_id, title, section, params (jsonb), preset_hash, seed, synth_version, **status** (`pending`/`public`/`rejected`), avg_rating, favourite_count, created_at | the library; `section` matches the per-panel presets |
| `ratings` | preset_id, user_id, rating, created_at — **unique(preset_id, user_id)** | one rating per person per sound = clean signal, no ballot-stuffing |
| `favourites` | user_id, preset_id, created_at | the "I'd use this" signal |
| `flags` | preset_id, reporter_id, reason, created_at | the report button |

### Row-Level Security (the gate, enforced by the DB not the client)
- **Read:** anyone can `SELECT` presets `WHERE status = 'public'`.
- **Submit:** signed-in users can `INSERT`, but status is **forced to
  `pending`** — they physically cannot self-publish.
- **Rate/favourite:** a user can write only their own row.
- **Promote (`pending → public`):** by admin (service role) early on; later
  automatic once weighted ratings cross a threshold. **Reputation** weights the
  votes — a trusted contributor's favourite counts more than a fresh account's.

---

## Backups → Google Drive

Because the DB is tiny and reproducible-from-seed, the whole thing dumps to a
small `.sql` file.

- **Method:** `supabase db dump -f backup.sql` (or `pg_dump` with the connection
  string) → upload to Google Drive (rclone or Drive API).
- **Schedule:** weekly is plenty at pilot scale. Run as a **free GitHub Action**
  on a cron, or a local scheduled task.
- **Payoff:** better disaster recovery than the paid Supabase backup, since the
  data also lives in your own Drive.

---

## Privacy & ethics (do not skip — this is a research project)

Accounts = collecting **personal data**, inside a project with consent flows and
an EEG/MVPA plan. Before public launch:

- Publish a **privacy notice** and **consent that covers account data**, not just
  ratings.
- Decide a **data-retention** policy (how long, deletion on request).
- Confirm **GDPR/UK basis** if anyone in the EU/UK can access it.
- Keep **anonymous study data separate from named community accounts** (see
  Architecture C).
- Loop in whoever handles ethics/IRB approval.

---

## Phased rollout

**Phase 1 — Launch-ready, seeded, gated**
- Frontend on Cloudflare/GitHub Pages; Supabase project stood up.
- Accounts live (OAuth + magic-link). Every rating/contribution tied to a user.
- Contributions land **pending**. You hand-curate the first wave and **seed
  30–50 genuinely good sounds yourself** (start from the 11 factory starters +
  7 measured instrument profiles) so the library is useful on day one.
- `/api/render` disabled; backups to Drive verified working.

**Phase 2 — Community does the filtering**
- Ratings above a weighted threshold auto-promote pending → public.
- Per-user **reputation** weights ratings (the "proper signal" payoff).
- Report/flag button for anything that slips through.

**Phase 3 — Only if it grows**
- Featured/curated collections, creator profiles.
- *Then* revisit monetisation (freemium Pro export/storage, sound packs,
  sync/licensing) — on top of a real quality signal, not a junk pile.

---

## Execution checklist (in order)

1. [ ] **Schema + RLS** — SQL file to paste into Supabase (all tables + the
   pending-gate policies). *Self-contained; safe to write now.*
2. [ ] **Backup script** — `db dump` → Google Drive, scheduled weekly.
   *Self-contained; verify before touching the app.*
3. [ ] **`/api/render` kill-switch** — env flag to hard-disable server render.
4. [ ] **Stand up Supabase project** — create, run schema, confirm backups.
5. [ ] **Frontend auth** — add Supabase JS client + sign-in UI.
6. [ ] **Swap library calls** — browse/submit/rate/favourite → Supabase instead
   of `global_presets.json`.
7. [ ] **Deploy frontend** to Cloudflare/GitHub Pages.
8. [ ] **Seed the library** with 30–50 curated sounds.
9. [ ] **Privacy notice + consent + retention** in place before public link.
10. [ ] **Soft launch** to one existing niche community (e.g. Xenharmonic
    Alliance / r/microtonal / Sevish's Discord), gather signal, iterate.

---

## Open decisions

- **Frontend host:** Cloudflare Pages vs GitHub Pages (both free; Cloudflare has
  more headroom and custom-domain ease).
- **Backup runner:** GitHub Action (cloud, hands-off) vs local scheduled task.
- **Auth providers to enable first:** Google + GitHub + magic-link is the
  default; confirm which your audience actually uses.
- **Do research event logs move to Supabase too, or stay in the Python JSONL?**
  Recommendation: stay separate (ethics). Revisit only if it simplifies a lot.
