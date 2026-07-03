# Improvement Roadmap (autonomous loop working document)

This file is the working state of the autonomous improvement loop. Each
iteration picks the next unchecked task, implements it as a reviewable commit,
and updates this file in the same commit. Priorities were set by the project
owner on 2026-07-03.

## Loop state

- Iteration: 13
- Phases A-E done (+ CI). F2 decided: FabFilter-inspired direction (see
  docs/UI_DIRECTION.md). Next: F3a reskin (tokens + chrome), folding in F1
  usability fixes, then F3b display-forward layout, F3c contextual panels
  (incl. B4a vowel pad).
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

- [x] B1. Per-note surprisal: every sounded note gets -log2 p of its pitch
  under the static melodic prior (interval shape × sub-scale × register ×
  root pull, momentum excluded — documented approximation), plus dynamics
  surprisal (branch + binned triangular density) and rest-branch surprisal.
  Note: fixed-model surprisal means repertoire replays/motif-boundary leaps
  can score high under a peaked prior — a property, not a bug (IDyOM-like).
- [x] B2. Repetition metrics: repetition_ratio (replayed-note fraction),
  pitch+duration bigram novelty ratio, motif pass counts/max reuse,
  incorporated-variant count. (time-since-last-occurrence: deferred.)
- [x] B3. Performance summary (metrics-1.0) from GenerationEngine
  .getMetricsSummary(), attached to every explore event; rate events carry
  the summary of everything heard up to the rating moment. Verified
  headlessly in Node (deterministic per seed; responds correctly to
  surpriseProb/sequenceProb manipulations) and live in browser.
- [ ] B4. Keep it invisible to lay users (no UI change beyond maybe a subtle
  "science inside" note in the about card).
- [x] B4a. Formant space redesign (engine): vowels are landmarks in
  continuous log-F1 × log-F2 space; accuracy misses and surprises displace
  by random direction + magnitude, clamped to the vowel region (verified:
  deviations from extreme "ee" cover all directions symmetrically). Legacy
  step/distance params mapped to acoustic units; realised-vs-intended
  distance logged per note and summarised as mean_formant_deviation_loghz.
  Remaining: 2D vowel-pad UI (do with Phase F restyle).

## Phase C — Data export & regeneration (priority 3)

- [x] C1. `synthesiser export` CLI → events.csv, ratings.csv, stimuli.csv,
  study_trials.csv, presets.csv with param_/metric_/demo_ flattening,
  schema-tolerant (skips torn lines; legacy records export cleanly).
- [x] C2. `/api/export.csv?table=…&token=…` gated on PHASE0_ADMIN_TOKEN
  (constant-time compare; disabled when unset).
- [x] C3. Regeneration bundle: stimuli.csv holds one row per stimulus_id
  with the complete parameter set + seed (verified exact round-trip in
  tests); engine determinism per seed verified headlessly in iteration 6;
  server-side Phase0 re-render remains available via /api/render.

## Phase D — Music production quality (priority 4)

- [x] D1. Click/harshness pass: tanh soft clipper (2x oversampled) before
  the limiter; master 28Hz low-cut + -2.5dB high shelf @9.5kHz; click-free
  stop (25ms master fade, deferred node kill, gain restored on next play);
  spectral loudness renorm slew-limited to ±30%/step. (Per-note envelopes
  already ramped to zero — verified, no change needed.)
- [x] D2. Defaults: reverbWet 0→0.16 (room), envelopeRelease 0.08→0.12 so
  first play isn't clinical-dry. Further tone tuning rides with D4
  audition pass.
- [x] D3. Modular presets: 7 sections (sound source, melody & scale,
  rhythm & rests, dynamics, sequence & surprise, percussion, space) via a
  parameter classifier; save-scope selector next to the preset name;
  section chips in the library; section presets merge over current state on
  load (verified: loading a Space preset reverts reverb, keeps tempo).
  Additive schema — old v3 entries read as "Full", no migration needed.
- [x] D4. Starter library: 11 factory presets in factory-presets.js — 5 full
  rigs (Glass Bells, Night Choir, Clockwork, Wandering Flute, Restless
  Weaver) + 6 section starters (Warm Cello, Airy Voice, Pentatonic Drift,
  Gentle Pulse, Cathedral Wash, Dry Studio) — in a default "Starters"
  library tab. Keys validated against DEFAULTS; loaded & played in browser.
  Deeper listening/tuning pass welcome once owner auditions them.

## Phase E — Deployment readiness (priority 5)

- [x] E1. Health endpoint now reports data/cache-dir writability, schema
  versions, rate limit, and export-enabled state; PORT/HOST env handling
  verified (PORT read from env, Procfile passes 0.0.0.0).
- [x] E2. docs/DEPLOYMENT.md: Railway/Render/Fly runbooks with persistent
  volume setup, env table, health verification, and no-shell data pulls
  via the export endpoint.
- [x] E3. Request logging pre-existed; dirs are mkdir'd at startup; test
  suite hits every endpoint (health/render/presets/events/export/rate
  limit) — 20 tests.

## Phase F — UI/design (priority 6, gated on user approval)

- [ ] F1. Usability fixes that need no approval: responsive canvases,
  touch-friendly slider sizing, consistent spacing, loading/error states.
- [x] F2. Proposals delivered (artifact with three rendered directions);
  owner chose a fourth path: FabFilter-inspired design language. Design
  system specified in docs/UI_DIRECTION.md (monochrome shell, data-owned
  colour, display-forward, contextual editing, precision readouts).
- [ ] F3a. Reskin: apply token system + chrome discipline to the existing
  layout (thin tracks, layer-hued fills, mono readouts, soft elevation).
- [ ] F3b. Display-forward layout: hero visualiser strip; distribution
  canvases restyled to filled-curve language with hover readouts.
- [ ] F3c. Contextual panels: note grid & 2D vowel pad (B4a) as
  direct-manipulation surfaces with floating per-item editors.

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

- [x] X1. CI: GitHub Actions (pytest + node --check) on push/PR.
- [x] X2. Tests for locking, validation, rate limiting, export, health
  (20 tests total as of iteration 12).

## Completed

- [x] Iteration 1 (2026-07-03): environment set up, baseline commit 2c4eec7,
  full frontend + backend audits, this roadmap.
