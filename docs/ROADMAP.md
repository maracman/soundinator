# Improvement Roadmap (autonomous loop working document)

This file is the working state of the autonomous improvement loop. Each
iteration picks the next unchecked task, implements it as a reviewable commit,
and updates this file in the same commit. Priorities were set by the project
owner on 2026-07-03.

## Loop state

- Updated: 2026-07-06 (commit 65c759d)
- Phases A–F complete; producer rebuilt as v2 + full v2.1 usability
  backlog (see Phase G / docs/PRODUCER_V2_DESIGN.md).
- **Two owner gates open — nothing ships past them:**
  1. Producer v2 Q4 re-audition (docs/PRODUCER_V2_DESIGN.md).
  2. Tone model v2 plan sign-off T-Q4 (Phase H below); no tone engine
     work until the plan/mockup is approved.
- While gated: safe idle polish only. Recently landed: USER_MANUAL
  refresh (b30933a), device-pixel distribution canvases (dada8d5),
  first-visit welcome-card overlay fix (8607998), loading/feedback
  states (f27da48), mixdown progress % + scheduling yields (65c759d).
- Baseline commit: 2c4eec7

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
- [x] B4. Research machinery is invisible to lay users: metrics ride the
  event payloads only; the welcome card + footer sharing note are the only
  research-facing UI, in plain language.
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

- [x] D5 (owner feedback 2026-07-03): instruments didn't sound like the
  instruments. Root cause: all profiles shared one generic envelope/vibrato
  and Fourier mode had no onset transient. Added SPECTRAL_PERFORMANCE per
  instrument (envelope speech times, vibrato idiom, piano inharmonic
  stretch) applied on profile selection, plus per-profile attack-noise
  transients (breath chiff / bow noise / lip buzz / hammer thump) rendered
  at note onset. Needs owner listening pass; harmonic tables can be
  refined further against published spectra if still off.
- [x] D6 (owner feedback 2026-07-03): per-panel preset bars — each section
  panel now has its own load-select (factory + user presets for that
  section) and Save button: Scale & Root (melody), Duration tab (rhythm),
  Dynamics tab, Sequence & Surprise, Reverb (space), Percussion, Sound
  Source (sound). Loads merge into that section only; saves capture only
  that section. Verified live: Cathedral Wash loaded from the Reverb
  panel, a percussion kit saved from its panel appears in its dropdown
  with exactly the 7 percussion params. Top-bar scope selector retained.

- [ ] D7 (owner cue 2026-07-03): partial macros & higher-fidelity formants
  per docs/PARTIAL_MACROS_DESIGN.md (RipplerX/Resonarium patterns):
  - [x] D7a. Partial macro layer: partialTilt (spectral slope, ±4.5dB/oct),
    partialOddEven (−1 mutes evens → clarinet, +1 mutes odds; fundamental
    exempt), partialComb + centre (movable keytracked group boost), six
    octave-group faders (1|2|3-4|5-8|9-16|17+) — all applied in the
    fingerprint over the profile base table, live-updating. Headlessly
    verified exact (odd −1 → evens ×0.08; tilt −1 → h8 ×0.044; comb@8 →
    h8 ×3; group1=0 zeroes fundamental only). Harmonic editor unchanged as
    the dig-down; full write-through/disclosure polish rides with D7c.
  - [x] D7b. Material damping law: each partial above the fundamental gets
    its own decay node, tau falling with harmonic number scaled by the new
    partialMaterial param (0 glass/metal → 1 wood/felt). Per-instrument
    defaults ride the profiles (piano 0.7 … trumpet 0.28); Material slider
    in the Fourier print panel, live-updating. Verified: piano profile
    sets slider to 0.7, playback clean.
  - [x] D7c. 32 partials: profile tables extrapolated 20→32 by stride-2
    geometric continuation (clarinet odd/even parity preserved in the
    tail); Harmonics + Comb centre sliders to 32; harmonic editor renders
    all 32 in its scrollable grid (explicit pagination unnecessary).
    Nyquist guard already skips unfittable partials. Verified in browser
    at 32 partials, playback clean.
  - [x] D7d. 5-formant bank: FORMANT_PRESETS carry F4/F5 + per-formant
    bandwidths (Klatt-style tables); renderer runs five parallel bandpasses
    with Q derived from vowel bandwidth × user scale; F3-F5 levels +
    bandwidth behind a native "Formant detail" disclosure; vowel pad
    unchanged (F3-F5/bw resolve by inverse-distance weighting). Verified:
    ah resolves 2440/3300/3750 Hz with bw 90; live playback clean.
    D7 COMPLETE — owner audition pass requested.

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

- [x] F1. Hero visualiser is now responsive + high-DPI (ResizeObserver
  matches backing store to CSS size at up to 2x DPR — verified 1015css →
  2030px backing on retina); coarse-pointer media query enlarges slider
  thumbs and tap targets (38px min buttons/tabs/chips). Remaining nits
  (loading states, dist-canvas DPI) fold into ongoing polish.
- [x] F2. Proposals delivered (artifact with three rendered directions);
  owner chose a fourth path: FabFilter-inspired design language. Design
  system specified in docs/UI_DIRECTION.md (monochrome shell, data-owned
  colour, display-forward, contextual editing, precision readouts).
- [x] F3a. Reskin: FabFilter token system applied (blue-charcoal shell,
  layer-hue vars); sliders are thin monochrome precision controls with
  data-hued fills keyed to their subsection (generation amber / accuracy
  green / surprise cyan); amber glows retired; readouts tabular mono.
  Verified in browser; playback regression clean.
- [x] F3b-1. Tonalic preset browser: section filter chips across all
  library tabs + per-preset in-context preview (non-destructive: auditions
  the preset merged into current settings, reverts exactly on toggle-off;
  Load commits). Verified in browser.
- [x] F3b-2 (partial). Hero visualiser: main display row raised across all
  three layout variants (~2x taller); distribution displays harmonised into
  the new shell (neutral glass/grid replacing green phosphor tint, softer
  scanlines/vignette; layer-colour data unchanged). Owner decision: KEEP the
  CRT/LED display character (harmonised); FabFilter curve replacement
  rejected. Hover readouts pending (F3c).
- [x] F3c-1. 2D vowel pad: the formant weight circle is now a true vowel
  pad (log-F1 × log-F2, classic vowel-chart orientation: ee front-closed
  top-left, oo back-closed top-right, ah open bottom), weights as dot
  sizes, horseshoe outline, display-well styling. Completes B4a's UI.
- [x] F3c-2a. Hover readouts: probability displays show a floating
  layer-coloured readout at the cursor (step offset + exact gen/acc/surp
  probabilities), hidden when the pointer leaves. Verified in browser.
- [ ] F3c-2b. Direct manipulation: note-grid / vowel-pad click-to-edit with
  floating per-item editors (deferred; candidates for the producer-mode
  editor pass).

## Phase G — Producer mode: orchestration / DAW-ish arrangement (owner request 2026-07-03)

Design doc: `docs/DAW_MODE_DESIGN.md` (parameter scoping, take/seed model,
repertoire state). Builds on D3 modular presets — an "instrument" is a saved
synth configuration pulled into arrangement tracks.

- [ ] G1. Design sign-off: parameter scoping tiers (session context vs
  instrument vs region) and return-to-pattern semantics reviewed by owner.
- [x] G2. Instrument library: "Save current voice as instrument" captures
  everything timbral/behavioural (116 params) excluding the session-context
  tier (tempo, key/scale, master dynamics, space, seed); Instruments tab in
  the library with preview/load/remove; loading merges over current state
  so the musical context survives (verified: session tempo preserved).
  These entries become the draggable sources for the G3 timeline.
- [x] G3 (v1). Arrangement view at #produce: Tonalic dual-panel (instrument
  browser above — saved instruments + factory voices; timeline below).
  Tracks × 16 slots; click-to-place regions each holding a deterministic
  take (seed, with reroll + seed history); loop-region playback via the
  single synth voice; arrangement persists to localStorage. Producer link
  in the studio header; volunteers at #explore never see it. Verified live
  end-to-end. v2 needs: drag placement/extend, region length, playhead.
- [x] G4. Session context bar: the arrangement owns its Tier-1 context
  (tempo, key, scale, master dynamics, space) shown as an editable Session
  bar in #produce; regions inherit it live (playing region re-parameterises
  on change); persists with the arrangement. Per-track lock overrides
  deferred to a later polish pass. Verified: key→G, tempo→92 stored and
  played.
- [x] G5. Multi-voice arrangement playback: SynthEngine.init() accepts a
  shared AudioContext + destination, so each track runs its own engine
  voice into a common producer bus; per-track gain via setMasterVolume;
  "Play arrangement" transport walks the slot grid at session tempo (4
  beats/slot), starting each track's region take at its slot and silencing
  empty cells, with a cyan playhead sweeping the timeline. Verified live
  (playhead 0→1 at tempo, clean stop).
- [x] G-v2 polish (partial): multi-slot regions (grid-span rendering, ×N
  badge, +/− Longer/Shorter with collision clamping; playback sustains a
  voice through its span; mixdown honours lengthSlots), per-track gain
  slider in the track head (live on the playing voice), drag regions
  between cells/tracks with span-fit checks. Remaining polish: per-track
  pan, per-track context locks, region take history UI.
- [x] G6. Export/Import: self-contained arrangement JSON (context + tracks
  with inline instrument params + region seeds) downloads/uploads via
  buttons in the producer bar. WAV mixdown: SynthEngine.renderSpan()
  deterministically schedules each region's notes into an
  OfflineAudioContext (fresh voice per region, timing mirrors the realtime
  scheduler), rendered and encoded to 16-bit stereo WAV. Verified: 3
  regions render 12.4s with energy at their slots, peak 0.42.
- [~] G7. (Stretch) Bake to piano roll — STAGE 1 DONE: ◆ Bake captures the
  region's deterministic take as data (captureSpan: beat-space offsets,
  degree, cents, velocity, frozen per-note spectral fingerprint); baked
  regions play/mix via renderNotesSpan/playNotes at the CURRENT session
  tempo; Unbake reverts (seed retained, non-destructive); reroll disabled
  while baked. Verified live round-trip (11 notes, badge, playback,
  revert). STAGE 2 DONE: '✎ Edit notes' opens a piano-roll canvas — rows
  are scale degrees (root rows violet), columns beat divisions; note bodies
  sit at their PRECISE pitch (cents as fractional row offset) with dashed
  ghost outlines at the intended degree when intonation missed; surprise
  notes cyan; click-to-inspect readout (degree, ±cents, velocity,
  duration). Verified live with screenshot.
  STAGE 3 DONE: snap-drag moves notes between scale rows with the cents
  offset riding along (verified: deg −3→−1, 220→246.95 Hz exact, cents
  preserved); shift-drag snaps clean; alt-drag fine-tunes cents only;
  horizontal drag moves onset on the division grid clamped to the region;
  frequency recomputed from the region's scale context; edited notes wear
  a dot; edits persist and play in baked playback/mixdown.
  ── OWNER REVIEW (2026-07-03): producer section REJECTED — "nothing like
  I wanted… needs to be rethought from the ground up… follows the same
  logic as a DAW like Pro Tools or Logic." Full redesign specified in
  docs/PRODUCER_V2_DESIGN.md with an explicit acceptance bar (B1-B9 +
  Q1-Q4 incl. owner sign-off).
- [~] G8. **Producer v2 rebuild — BUILT, AWAITING OWNER SIGN-OFF (Q4).**
  All stages P1–P7 and the entire v2.1 usability backlog U0–U13 are done
  and verified (docs/PRODUCER_V2_DESIGN.md is the source of truth):
  three-zone DAW layout with persisted resizable/collapsible panels,
  card browser → palette rack → beat-based lanes with pointer drag,
  regions that move/copy/extend/loop with collision blocking, bake →
  double-click piano-roll drawer (G7 roll internals docked), palette
  edit round-trip, M/S/pan/gain per track, keyboard transport, zoom +
  snap, multiple named arrangements, single-level undo, per-region
  level, →Studio, JSON export/import, WAV mixdown with live progress %.
  The key control now truly transposes (tonic moves; baked notes
  recompute from degree-space). Producer stays IN PROGRESS until the
  owner re-auditions (Q4).
  Remaining post-sign-off polish candidates: per-track context locks,
  region take-history UI. (Dist-canvas DPI and loading states: done,
  see Loop state.)

## Phase H — Tone model v2: physics-grounded redesign (owner brief 2026-07-05)

Design doc: `docs/TONE_MODEL_V2_DESIGN.md`; direction mockup:
`docs/mockups/tone-print-v2.html`. Owner brief: ground-up rethink of the
tone design — resonant-frequency transfer grounded in actual frequencies
(never 12-TET), bow-style imperfection instead of amplitude probability,
partial count at instrument-modeller parity, key character variables
surfaced, every interaction re-grounded in acoustics, and a tone-print UI
that filters frequencies visually instead of showing them all. Decisions:
tone section first; formant path unified (excitation → resonator → body);
best-effort preset migration. Supersedes the D5/D7 tone line: remaining
tone-fidelity concerns fold into this model.

- [x] H0 (=T0). Plan + audit + mockup (2a9caf7); T-Q4 APPROVED
  2026-07-06; rev B mockup made the staged chain the layout (ad42f0f).
- [x] H1–H7 (=T1–T7). ALL BUILT 2026-07-06, one commit per stage:
  resonator core (2804dab) → excitation (6ad3bfd) → Human (bb083b2) →
  transfer (d05b2d1) → body/vowels-as-bodies + FM→AM (babee65) →
  staged-chain tone builder + migration (1132744) → interactive tone
  print (ed591e2). 85 headless physics assertions in CI.
- [~] H8 (=T8). Walkthrough clean (T-Q1), CPU benchmarked (T-B7), live
  A/B servers standing (old engine :8766 / new :8765).
  **AWAITING T-Q5 OWNER AUDITION** — plus owner decision on retiring
  the separate Formant source mode now that vowels are bodies.

## Cross-cutting

- [x] X1. CI: GitHub Actions (pytest + node --check) on push/PR.
- [x] X2. Tests for locking, validation, rate limiting, export, health
  (20 tests total as of iteration 12).

## Completed

- [x] Iteration 1 (2026-07-03): environment set up, baseline commit 2c4eec7,
  full frontend + backend audits, this roadmap.
