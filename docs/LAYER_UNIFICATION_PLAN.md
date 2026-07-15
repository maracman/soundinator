# Layer Unification Plan — base becomes `layers[0]`

*Drafted 2026-07-15, after the owner's audit question: "why is the base layer
special at all?" The quick half (unified editing UX + `enginePlayParams()`
true-stack monitoring) shipped the same day; this plan covers the full
structural refactor, gated on a test harness built first.*

## Why the base is special today (audit findings)

The app predates layers: everything is built on ONE flat parameter object
(`exploreParams`). Every knob binding, the synth engine, preset/patch
serialization, community sharing, and producer regions read and write
top-level keys (`spectralProfile`, `envelopeAttack`, `effectsChain`, …). The
"base" sound IS that top level. Layers arrived later (2026-07-07) as nested
`layers[] = {id, subnote: {…sound-half…}, space, gain, mute, solo, hue}`.

Concrete anchors of the asymmetry:

- **Engine**: the primary voice renders from top-level params; `layers[]`
  render additionally per note (`synth.js` ~1999–2023, `_layerRender`).
  The base also guarantees play always sounds *something*.
- **Editor**: all controls bind to top-level keys, so editing a layer swaps
  its `subnote` into the top level and stashes the base
  (`enterLayerEdit`/`exitLayerEdit`, `_chLayerEdit`). The swap machinery is
  pure workaround, and historically leaked (wrong monitoring mix, layer edits
  committing as the whole patch — both fixed 2026-07-15).
- **Persistence**: a preset/patch/community share is the flat dict; the
  "notes" capture part = the base sound-half (`_soundHalf`). Producer palette
  items, region `paramsOverride`, bakes and mixdowns all assume it.
- **Special-case params**: `baseLayerGain`, `baseLayerSolo`,
  `spaceAzimuth`/`spaceDistance` doubling as "layer 1's position".

## Target model

- `exploreParams.layers[]` is the whole sound stack; **`layers[0]` always
  exists** (the playability guarantee moves into `ensureLayers(p)`).
- Each layer: `{id, name, sound: {…sound-half…}, space, gain, mute, solo, hue}`.
- Top level keeps what is genuinely shared: the macro half (melody, rhythm,
  dynamics, surprise, scale), the one room/head/air, percussion (note-engine
  domain), and session context.
- The editor binds to `selectedLayerId` (defaults to `layers[0].id`) through
  a single accessor; `enterLayerEdit`/`exitLayerEdit`/`_chLayerEdit`/
  `baseStash` are deleted; `enginePlayParams()` collapses to
  `{...exploreParams}`.
- `baseLayerGain`/`baseLayerSolo` become `layers[0].gain`/`.solo`.

## Phases (each lands green on the full suite)

**Phase 0 — test harness first.** No refactor commits until the suite below
exists and passes on today's code. It freezes current behaviour so every later
phase is checked against it.

**Phase 1 — extract & accessor (behaviour-neutral).** Pull the pure param
helpers out of the 22k-line `app.js` into an importable module
(`web/static/params.js`): `migrateToneParams`, `extractSectionParams` /
`extractInstrumentParams`, `_soundHalf`, `capturePartsFor`, `ensurePercLayers`,
`enginePlayParams`, DEFAULTS. Introduce `soundParam(key)` get/set and sweep
every sound-half control binding through it (still pointing at the top level).
Mechanical, diffable, no behaviour change — the suite proves it.

**Phase 2 — engine dual-read.** `SynthEngine`/`GenerationEngine` accept both
shapes behind `ensureLayers(p)`: if `layers[0]` carries a sound, it is the
primary voice; else fall back to flat top-level keys. Golden-render tests must
be bit-identical for legacy-shape input.

**Phase 3 — flip the editor.** `soundParam` reads/writes
`layers[selectedLayerId].sound`. Selection replaces the swap machinery. The
LAYERS strip, space stage, effects stage and browser drop targets address
layers uniformly (row 1 loses its special cases).

**Phase 4 — serialization & migration.** `migrateToneParams` moves flat sound
keys into `layers[0].sound` on load (idempotent; `subnote` key kept as an
accepted alias on read). **Dual-write for at least one release**: saving also
mirrors `layers[0].sound` to the top level so older clients and already-shared
community params stay loadable both directions. Update capture parts,
community share/audition merge, producer `regionPlayParams`, bake and mixdown
paths.

**Phase 5 — cleanup.** Remove dual-write, `baseLayer*` keys, "BASE" badge
special-casing, and the legacy fallbacks once prod data has soaked.

## Test suite (Phase 0 deliverable)

Today `tests/` covers only the Python server; the JS synth and app logic have
none. The refactor is not safe without these:

1. **Runner**: `node:test` (built into Node, zero deps) for unit/golden tests;
   Playwright for browser smoke. A `package.json` with `npm test` appears at
   the repo root.

2. **Golden-render tests** (the load-bearing ones). With fixed seeds the
   engines are deterministic. Snapshot as JSON fixtures:
   - `GenerationEngine(params)` note streams (first ~64 notes) for a patch
     matrix: flat legacy patch, 1-layer, 3-layer with per-layer fx + space,
     percussion on/off, solo/mute combos, formant vs fourier voice.
   - `SynthEngine` per-note render plans (`out` + `out.layerRenders` shapes,
     frequencies, envelope numbers) for the same matrix, with Web Audio node
     construction stubbed.
   Every refactor phase must reproduce these bit-exact for legacy inputs.

3. **Migration round-trips**: every factory preset, factory session, and a
   corpus exported from the prod community DB: load → migrate → serialize →
   reload converges to the same canonical form; old-shape and new-shape inputs
   produce identical engine output (via the golden fixtures).

4. **Invariant/regression tests**:
   - `enginePlayParams` truth: entering/leaving a layer edit never changes
     the engine-visible params (this week's monitoring bug, frozen forever).
   - `commitPaletteEdit` targets region `paramsOverride` when region-keyed,
     palette item otherwise; a layer edit in progress folds back before commit
     (this week's producer bugs, as tests).
   - add/remove/reorder layer preserves the other layers' sounds; capture
     "notes" part equals the edited stack's primary sound.

5. **Playwright smoke** (headless, against the real dev server): boot, add a
   layer, swap rows while playing, edit knobs during playback, producer
   round-trip (✎ → edit → back → value persisted), save/load a patch, logo →
   landing → back. Assert key DOM states and **zero console errors**.

6. **CI**: a GitHub Action running `node --check`, unit + golden tests, and
   the Playwright smoke on every push. Deploys stay manual (per
   HOSTINGER_DEPLOY.md §9) — CI gates merges, not releases.

## Risks & mitigations

- **Prod data** (localStorage arrangements, SQLite community params) can't be
  batch-migrated — hence read-side migration + dual-write, removed only in
  Phase 5 after soak.
- **Sweep size** (hundreds of bindings in `app.js`): the Phase 1 accessor
  makes the Phase 3 flip a one-line change instead of a thousand-line one.
- **Community contract**: shared "sound module" semantics must not shift;
  migration corpus tests pin them.

## Estimate

Harness 1–2 days · Phase 1 sweep 1–2 days · Phases 2–3 2–3 days ·
Phase 4 + soak 2 days. Each phase ships independently behind green tests.
