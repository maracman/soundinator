# Improvement Roadmap (autonomous loop working document)

This file is the working state of the autonomous improvement loop. Each
iteration picks the next unchecked task, implements it as a reviewable commit,
and updates this file in the same commit. Priorities were set by the project
owner on 2026-07-03.

## Loop state

- Iteration: 2
- Current phase: A (study flow foundations)
- Baseline commit: 2c4eec7 (in-progress macro workspace committed, tests green)

## Audit summary (2026-07-03)

Full audits in the loop transcript; the load-bearing findings:

- Ratings are logged with full parameters but **not** with the seed of the
  audio actually heard, no per-play stimulus identity, no session id (only a
  persistent participant uuid), no consent audit trail in explore mode.
- Surprise machinery (`surpriseProb`, per-feature weights/distances,
  `incorporationRate`, motif repertoire) drives generation only. **No
  expectancy/information-rate/repetition metrics are computed or logged** —
  the timeline built in synth.js (noteRole, isSurprise, motifIndex, devs) is
  discarded after visualisation.
- Presets are monolithic snapshots in localStorage (`phase0.presets.v3`);
  global submissions go to `web/data/global_presets.json`. No per-section
  (modular) presets. UI already has natural section boundaries: Sound Source,
  Formant Voice, Colour, Fourier Print, Vibrato, Envelope, Scale & Root,
  Macro Probability, Sequence & Surprise, Percussion, Space.
- Sound: formant (saw → 3 bandpass), Fourier additive, simple modes; hard
  brick-wall limiter only; oscillator start/stop without ramps (clicks),
  short default release, no soft clip, no master EQ; spectral renorm can jump.
- Server: dependency-light stdlib HTTP server; endpoints for study submit,
  explore events, preset contribute/list, server render. Append-only JSONL
  with **no locking**; open CORS; no rate limiting; PaaS-ready except
  ephemeral-disk risk (needs `PHASE0_DATA_DIR` on a volume) and no export API.
- No export tooling (JSONL → CSV), no CI, no lint config. Stimulus regen from
  seed works server-side via preset hash + sidecars.
- Frontend is a single 5.6k-line app.js with template-string rendering; a11y
  basics present; canvases not responsive; no code splitting.

## Phase A — Volunteer appeal-data study flow (priority 1)

- [ ] A1. Stimulus identity & provenance: give every generated performance a
  `stimulus_id` (seed + params hash + app version); log it with every play,
  rating, and save event; include client timestamp and a per-visit
  `session_id` alongside the persistent participant id.
- [ ] A2. Rate-what-you-hear: tie the rating to the most recent play (log
  rating events with the stimulus_id heard, rating latency, and play count)
  rather than a free-floating slider value.
- [ ] A3. Friendly opt-in flow for explore mode: lightweight welcome/consent
  card (plain language, version-stamped consent event), optional minimal
  demographics (age band, musical training), skippable — tinkering must work
  without it.
- [ ] A4. Parameter-change telemetry (throttled) so appeal can be related to
  what the volunteer adjusted between plays.
- [ ] A5. Server hardening for collection: file locking on JSONL appends,
  schema_version field on every record, basic payload validation and size
  caps, simple per-IP rate limiting.

## Phase B — Expectation/surprise & repetition instrumentation (priority 2)

- [ ] B1. Per-note metrics in synth.js at generation time: model surprisal
  (-log2 p) of each realised pitch/duration/dynamics choice under the actual
  sampling distributions used; flag distance-from-expectation for surprise
  notes (continuous, not just boolean).
- [ ] B2. Repetition metrics: motif reuse counts, variant-vs-base identity,
  n-gram repetition rate, time-since-last-occurrence; incorporation events
  (which surprises got baked in) logged.
- [ ] B3. Phrase/performance summaries: mean & variance of surprisal,
  information rate (bits/s), repetition ratio — attached to every play event
  and therefore joinable to ratings via stimulus_id.
- [ ] B4. Keep it invisible to lay users (no UI change beyond maybe a subtle
  "science inside" note in the about card).

## Phase C — Data export & regeneration (priority 3)

- [ ] C1. `synthesiser export` CLI: JSONL → tidy CSVs (ratings.csv,
  plays.csv, sessions.csv, presets.csv) with flattened parameters + metrics,
  schema-version aware.
- [ ] C2. Admin-token-protected `/api/export.csv` endpoint for pulling data
  off a PaaS without shell access.
- [ ] C3. Regeneration check: CLI command that takes a stimulus_id/seed row
  and re-renders the exact stimulus; test covering seed determinism.

## Phase D — Music production quality (priority 4)

- [ ] D1. Click/harshness pass: gain ramps on oscillator start/stop, soft
  clipper before the brick-wall limiter, gentle master high-shelf/low-cut,
  clamp spectral-renorm jumps.
- [ ] D2. Nice defaults: retune DEFAULTS so first play sounds musical
  (tempo, reverb wet > 0, warmer profile), audition each voice mode.
- [ ] D3. Modular presets: per-section save/load (sound source, melody/scale,
  rhythm/duration, dynamics, surprise/sequence, percussion, space) with
  section chips in the library UI; full-rig presets remain; localStorage
  schema v4 with migration from v3.
- [ ] D4. Curated starter library: 8–12 factory presets (full + per-section)
  shipped with the app so first-time users have good starting points.

## Phase E — Deployment readiness (priority 5)

- [ ] E1. Procfile/env polish (PORT respected — verify, document
  PHASE0_DATA_DIR volume setup for Railway/Render/Fly), health endpoint
  reports data-dir writability.
- [ ] E2. Deployment doc: one-page runbook for Railway/Render/Fly with
  persistent volume, plus backup/download-data instructions.
- [ ] E3. Basic ops: request logging, graceful handling of missing dirs,
  smoke test hitting all endpoints.

## Phase F — UI/design (priority 6, gated on user approval)

- [ ] F1. Usability fixes that need no approval: responsive canvases,
  touch-friendly slider sizing, consistent spacing, loading/error states.
- [ ] F2. Produce 2–3 rendered visual direction proposals (artifact with
  mockups: e.g. dark pro-studio, warm approachable, current-mock-converged)
  — STOP and wait for user choice before restyling.
- [ ] F3. Apply chosen direction across the app.

## Phase G — Producer mode: orchestration / DAW-ish arrangement (owner request 2026-07-03)

Design doc: `docs/DAW_MODE_DESIGN.md` (parameter scoping, take/seed model,
repertoire state). Builds on D3 modular presets — an "instrument" is a saved
synth configuration pulled into arrangement tracks.

- [ ] G1. Design sign-off: parameter scoping tiers (session context vs
  instrument vs region) and return-to-pattern semantics reviewed by owner.
- [ ] G2. Instrument library: save current synth state as a named instrument
  (excluding session-scoped params); instrument browser to pull into tracks.
- [ ] G3. Arrangement view: tracks × timeline regions; each region references
  an instrument + pattern settings + seed (a "take"); loop-over-region
  playback; region reroll for a fresh take.
- [ ] G4. Session context layer: tempo, key/root & scale, master dynamics,
  shared space/reverb inherited by instruments unless locked per-instrument.
- [ ] G5. Multi-voice scheduling in synth.js: N concurrent instrument voices
  with per-track gain/pan and a shared master bus/limiter.
- [ ] G6. Arrangement save/load (localStorage + export as JSON), and mixdown
  export (WAV render of the arrangement).

## Cross-cutting

- [ ] X1. CI: GitHub Actions running pytest + node --check on push.
- [ ] X2. Tests for new server behaviour (locking, validation, export).

## Completed

- [x] Iteration 1 (2026-07-03): environment set up, baseline commit 2c4eec7,
  full frontend + backend audits, this roadmap.
