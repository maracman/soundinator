# Improvement Roadmap (autonomous loop working document)

This file is the working state of the autonomous improvement loop. Each
iteration picks the next unchecked task, implements it as a reviewable commit,
and updates this file in the same commit. Priorities were set by the project
owner on 2026-07-03.

## Loop state

- Iteration: 5
- Phase A complete. Next: Phase B (surprise/expectancy/repetition metrics),
  starting with B1 (per-note surprisal in synth.js).
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

- [x] A1. Stimulus identity & provenance: every event now carries
  `stimulus_id` (FNV-1a over canonical params + APP_VERSION), per-visit
  `session_id`, `app_version`, `client_ts`, and `schema_version`
  ("explore-event-1.0"); presets and contributions stamped too.
- [x] A2. Rate-what-you-hear: committed rating changes log a "rate" event
  with the stimulus_id, rating latency since play start, and play count.
- [x] A3. Friendly opt-in flow: welcome card in explore view (plain language,
  optional age band + musical training, "Play and share my ratings" vs "Just
  play"), version-stamped consent event; **no events leave the browser unless
  opted in**; footer note shows sharing status with a Change link.
  Verified end-to-end in browser preview.
- [x] A4. Parameter-change telemetry: slider/select/checkbox changes buffer
  per control and flush as one "adjust" event ({from, to} per param) 3s
  after the last tweak or before the next play/rate/save event.
- [x] A5. Server hardening: flock-locked JSONL appends (verified by a
  concurrent-post test), type validation on numeric/dict payload fields,
  512KB body cap (pre-existing), per-IP sliding-window rate limiting
  (PHASE0_RATE_LIMIT env, default 120 POSTs/min, 429 on excess),
  schema_version on study records.

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
  export (single stereo WAV render of the arrangement).
- [ ] G7. (Stretch) Bake to piano roll: materialise a take into an editable
  clip with dual pitch representation (precise-frequency note body + ghost
  of the intended scale note), snap-drag preserving cents offsets,
  fine-tune repitching, and a per-note inspector with relativistic edits
  over instrument distributions (draw-nudge vs absolute lock). See design
  doc "Bake" section.

## Cross-cutting

- [ ] X1. CI: GitHub Actions running pytest + node --check on push.
- [ ] X2. Tests for new server behaviour (locking, validation, export).

## Completed

- [x] Iteration 1 (2026-07-03): environment set up, baseline commit 2c4eec7,
  full frontend + backend audits, this roadmap.
