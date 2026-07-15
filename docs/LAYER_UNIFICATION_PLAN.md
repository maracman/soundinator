# Layer Unification Plan — base becomes `layers[0]`

*Rev 2, 2026-07-15 — fleshed out as a handoff spec for coding agents. Each
work package (WP) below is self-contained: context, exact anchors, steps,
acceptance criteria. Read §1–§3 before starting any WP.*

**Owner's goal.** Remove the base/layer structural asymmetry in the studio's
sound model. Today the "base" sound is the flat top level of the parameter
object and extra layers are nested copies; after this refactor the whole
sound stack is `layers[]`, `layers[0]` always exists, and the editor binds to
"the selected layer". No behaviour change for users except the removal of
base-only special cases.

---

## 1. Orientation (read first)

- **Repo**: `github.com/maracman/soundinator` (this repo). The web app is
  vanilla ES modules, no bundler, no framework, served by a Python stdlib
  server (`src/synthesiser/web/server.py`). There is **no package.json yet**.
- **The three JS files that matter**:
  - `web/static/synth.js` (~4.8k lines) — the engines. **Already a clean ES
    module importable in Node** (verified: 61 exports incl. `GenerationEngine`,
    `SynthEngine`, `SeededRNG`, `migrateToneParams`, `layerMixPlan`). Imports
    `./kemar-hrir.js` and `./effects/index.js` (also plain ES modules).
  - `web/static/app.js` (~22k lines) — the entire UI, monolithic, mutates the
    DOM at import time. **Not importable in Node** without the WP-1 extraction.
  - `web/static/factory-presets.js`, `web/static/factory-sessions.js` — data.
- **Run the app**: `PYTHONPATH=src .venv/bin/python -m synthesiser.web.server`
  (port 8799; see `.claude/launch.json`). Python tests: `pytest tests/`.
- **Cache-busting rule**: any change to `web/static/*.js|css` must bump the
  `?v=NNN` query in `web/static/index.html` (both the stylesheet link and the
  `import("/app.js?v=NNN")`), or users get stale code.
- **Do NOT deploy.** Deploys are owner-run (`docs/HOSTINGER_DEPLOY.md` §9).
  Land commits on `main` only when your WP's full acceptance criteria pass.
- **Every WP is a separate commit/PR** that leaves the suite green and the app
  manually clickable (add layer, swap rows, play — no console errors).
- **Domain rule you must not break**: percussion belongs to the NOTE ENGINE,
  never the synth patch. Shared community synths never carry `perc*` params.
  Do not fold percussion into the layer stack.

---

## 2. Current architecture reference

### 2.1 The parameter object

One flat dict (`exploreParams` in app.js) drives everything. Key groups
(classifier: `sectionForParam(key)` in app.js — grep it):

| Section      | Keys (by rule)                                              | Stays top-level after refactor? |
|--------------|-------------------------------------------------------------|---------------------------------|
| `sound`      | everything not matched below: `voiceMode`, `spectral*`, `tone*`, `formant*`, `vibrato*`, `envelope*`, `effectsChain`, `stageEffectsOn`, … | **No → `layers[n].sound`** |
| `space`      | `reverb*`, `space*`, `pinnaScale`, `earModel`               | Yes (one room/head/air, shared) — EXCEPT `spaceAzimuth`/`spaceDistance`, which are really layer-0's position (see §2.3) |
| `percussion` | `perc*` (incl. `percLayers`, `percAzimuth`, `percDistance`) | Yes (note-engine domain) |
| `melody`/`rhythm`/`dynamics`/`surprise` | `_MELODY_PARAMS`, `_RHYTHM_PARAMS`, etc. | Yes (macro half, shared) |
| n/a          | `seed`                                                      | Yes |

`DEFAULTS` (app.js, grep `const DEFAULTS =`) is the canonical key inventory.

### 2.2 The layer shape (today)

```js
exploreParams.layers = [            // extra layers only; base is NOT in here
  {
    id: "uuid",
    name?: "string",
    hue: 106,                        // (36 + i*70) % 360
    subnote: { /* a sound-half snapshot: extractSectionParams(p,"sound")
                  minus keys starting with "layer"/"baseLayer";
                  effectsChain deep-cloned (cloneFxChain) */ },
    space: { angle: -30, dist: 2.5 },// own position from birth
    gain: 0.8, mute?: bool, solo?: bool,
  },
]
```

The base sound = the top-level `sound`-section keys. Base-only params:
`baseLayerGain`, `baseLayerSolo` (consumed in `synth.js` `layerMixPlan`, grep
`baseLayerGain`), `spectralProfileName` (the base's display name), and
`spaceAzimuth`/`spaceDistance` double as the base's stage position.

### 2.3 The swap machinery (what we are deleting)

app.js, grep these names: `_chLayerEdit` (state `{layerId, baseStash,
baseSpace}`), `enterLayerEdit`, `exitLayerEdit`, `_soundHalf`,
`enginePlayParams`. Editing layer N copies `layers[N].subnote` into the top
level and stashes the base; `exitLayerEdit` writes it back. As of 2026-07-15
every studio→engine update goes through `enginePlayParams()`, which rebuilds
the TRUE stack during an edit (stashed base at top level, live edits in the
edited layer's slot). **Invariant to preserve forever: the engine-visible
params are identical whether or not a layer edit is in progress.**

### 2.4 Engine consumption

`synth.js`:
- `GenerationEngine` (exported, pure w.r.t. Web Audio; seeded via `SeededRNG`
  xorshift32) — note stream generation. `new GenerationEngine(params)`,
  `.initialise()`, `.nextNote()`. Deterministic for a fixed `params.seed`.
- `SynthEngine._render(note, t)` renders the base voice from top-level params
  and `out.layerRenders = p.layers.map(_layerRender)` (grep `layerRenders`).
  `layerMixPlan(params, layerRenders)` (exported, pure) computes the final
  gain plan incl. `baseLayerGain`/`baseLayerSolo`/solo semantics.
- Entry points that receive params: `play`, `playNotes`, `renderSpan`,
  `captureSpan`, `updateGenerationParams`, `updateReverb`, `updateEffects`,
  `updatePercLayers`. `updateEffects` walks `params.layers[].subnote
  .effectsChain` for per-layer chains (`_layerChains`).

### 2.5 Persistence surfaces (all must keep working)

1. **Library presets** (localStorage + community): items `{section, params}`;
   `voiceParamsFor(item)` (app.js) normalises. Community share strips
   percussion (`auditionerSynthParams`).
2. **Factory data**: `FACTORY_PRESETS`, `FACTORY_SESSIONS` (flat param dicts).
3. **Producer**: palette items `pl.params`; regions play from
   `region.paramsOverride` ONLY (never `region.params` — see
   `regionVoiceParams`; this was a bug class already fixed). `regionPlayParams`
   composes `{...DEFAULTS, ...context, ...regionVoiceParams(), seed}`.
4. **Capture parts**: `CAPTURE_PARTS = ["notes","space","stave","clef",
   "percussion"]`; the "notes" part = the base sound-half. Shared modules in
   the community depend on this meaning.
5. **Server-side**: `web/data/global_presets.json` and the community SQLite DB
   store the same flat dicts. The Python server never interprets sound params
   (verify with `grep -rn "spectral" src/` — treat as opaque).
6. **Migrations**: `migrateToneParams` (exported from synth.js) already
   translates the tone-v1 model; it runs on every preset load. New shape
   migration slots in alongside it.

### 2.6 Target model

```js
exploreParams = {
  layers: [   // ALWAYS ≥ 1; layers[0] is what used to be "the base"
    { id, name, hue, sound: {…sound-half…}, space: {angle,dist}, gain, mute, solo },
    …
  ],
  selectedLayerId,        // transient UI state — NOT serialized
  /* unchanged top level: macro half, shared space (room/head/air),
     percussion (perc*), seed, session context */
}
```

- `layers[0].gain`/`.solo` replace `baseLayerGain`/`baseLayerSolo`.
- `layers[0].space` replaces `spaceAzimuth`/`spaceDistance` as layer position;
  the *listener/room* keys (`reverb*`, `head*`, `earModel`, …) stay top-level.
- `layers[0].name` replaces `spectralProfileName`.
- Serialized patches keep a flat mirror during the transition (WP-4).
- `subnote` remains accepted as a read alias for `sound` indefinitely.

---

## 3. Ground rules for every WP

1. Test suite green before AND after (`npm test`; from WP-0 on).
2. `node --check web/static/app.js web/static/synth.js` passes.
3. Manual smoke in the browser via the dev server: load app → SUB-NOTE tab →
   add layer → swap rows 1↔2 → play → tweak a knob while playing → producer:
   double-click region → ✎ edit → change value → Back to Producer → re-open,
   value persisted. Zero console errors.
4. Bump `?v=NNN` in `index.html` when web/static changes.
5. No new dependencies beyond: `node:test` (builtin), Playwright (dev-only),
   and nothing else without owner sign-off.
6. Commit messages explain *why*, reference this doc ("LAYER_UNIFICATION WP-n").

---

## WP-0 — Test harness (BLOCKS everything else)

**Goal**: freeze today's behaviour in executable form. No refactor commits
until this is merged and green.

### Deliverables

1. **`package.json`** at repo root: `{"type":"module"}` (silences Node's
   module warning and makes intent explicit), `scripts: {"test": "node
   --test tests/js/", "test:browser": "playwright test"}`. Playwright as the
   only devDependency.

2. **`tests/js/` unit + golden tests** (runner: `node --test`). synth.js
   imports cleanly in Node today — no extraction needed for these:

   - **`golden-generation.test.js`** — for each fixture patch (see matrix
     below): `const e = new GenerationEngine({...DEFAULTS-like fixture,
     seed: 12345}); e.initialise();` collect the first 64 notes of
     `e.nextNote()` and deep-compare against a committed JSON fixture
     (`tests/js/fixtures/gen-<name>.json`). Compare a stable projection of
     each note (degree, frequency, durationDivs, offsetDivs, velocity,
     beatDivisions, rest/surprise flags) — build the projection by inspecting
     actual note objects, then LOCK it.
   - **`golden-mixplan.test.js`** — `layerMixPlan(params, layerRenders)` is
     exported and pure: snapshot its output for the matrix incl.
     `baseLayerGain`/`baseLayerSolo`/layer solo/mute combos, and synthetic
     `layerRenders` arrays.
   - **`golden-migrate.test.js`** — `migrateToneParams` on: every entry in
     `FACTORY_PRESETS` (importable), every `FACTORY_SESSIONS` palette item,
     plus `tests/js/fixtures/community-corpus.json` (see below). Snapshot the
     migrated output; assert idempotence (`migrate(migrate(x)) ===
     migrate(x)` deep-equal).
   - **`synthengine-render.test.js`** — investigate how far `SynthEngine`
     runs without Web Audio: constructing it and calling pure/planning methods
     may work with a stub `ctx`. Aim to snapshot the per-note *render plan*
     (frequencies, envelope numbers, `layerRenders` length/values) with node
     construction stubbed. If a minimal AudioContext stub proves > ~150 lines,
     STOP and instead extend golden coverage at the `GenerationEngine` +
     `layerMixPlan` + `_layerRender`-input level; note the decision in the
     test file header. Do not sink days into a Web Audio mock.

   **Fixture matrix** (encode each as a params JSON in `tests/js/fixtures/`):
   flat legacy patch (no `layers`) · 1 extra layer · 3 layers with distinct
   per-layer `space` + `effectsChain` · percussion on (percLayers with
   audible vol) · percussion off · `baseLayerSolo` on · one layer `solo` ·
   one layer `mute` · formant voice (`voiceMode:"formant"`) · fourier voice ·
   `layerEnvOverride` on. Seeds: two per patch (12345, 99991).

3. **Fixture generation script** — `tests/js/generate-fixtures.mjs`: imports
   synth.js, writes all `fixtures/*.json`. Fixtures are COMMITTED; the script
   is run only deliberately when behaviour is *supposed* to change, and the
   diff reviewed. Add an npm script `test:regen`.

4. **Community corpus** — `tests/js/fixtures/community-corpus.json`: ask the
   owner for an export from the production DB, or (if unavailable) build it
   from `web/data/global_presets.json` in this repo (it contains the seeded
   community presets). ≥ 20 diverse param dicts.

5. **Playwright smoke** — `tests/browser/smoke.spec.js`, launched against the
   Python dev server (spawn it in `globalSetup` with `PYTHONPATH=src python3
   -m synthesiser.web.server` on a free port, or document a `--port` flag if
   one is needed). Steps, asserting after each that `page.on('console')`
   collected zero `error`-type entries:
   a. Load `/` → dismiss welcome card ("Just Play") → skip tour.
   b. SUB-NOTE tab → `#layerAdd` → expect `.layer-edit-tag` text
      `editing Layer 2` and the new row `.sel`.
   c. Click base row → tag `editing Layer 1`.
   d. Click `#playBtn` → expect it to flip to stop state; move a
      `input[type=range]` while playing; stop.
   e. Producer: landing → Load Demo → dblclick `.tl2-region` → `[data-patch-edit="subnote"]`
      → expect `.palette-edit-banner`; change the "Variation chance" slider to
      0.77; click `#palBackProducer`; re-open ✎ → slider reads 0.77.
   f. Logo (`.tb-home`) → landing shows `#landingBack`; click it → back.
   Keep selectors in one `selectors.js` module — the WP-3 flip may rename
   some; the smoke must be cheap to update.

6. **CI** — `.github/workflows/test.yml`: on push/PR → checkout, setup Node
   20 + Python 3.12, `pip install -r requirements.txt`, `node --check` both
   JS files, `npm test`, `pytest tests/`, then Playwright smoke (install
   chromium only). CI gates merges; it must NOT deploy.

### Acceptance
- `npm test` and Playwright pass locally and in CI **against unmodified
  current code**.
- Deliberately breaking a sound param (e.g. flip a default) makes a golden
  test fail — prove the harness bites (include this experiment in the PR
  description, then revert).

---

## WP-1 — Extract param helpers + `soundParam` accessor (behaviour-neutral)

**Goal**: make app.js's param logic importable/testable and create the single
indirection point the flip (WP-3) will use.

### Steps

1. Create `web/static/params.js` exporting, MOVED (not copied) from app.js:
   `sectionForParam`, `extractSectionParams`, `extractInstrumentParams`,
   `CAPTURE_PARTS`, `capturePartForParam`, `capturePartsFor`, `DEFAULTS`,
   `PARAM_DESC` (if separable), `ensurePercLayers`, `resolvePercEnabled`,
   `cloneFxChain`, `_soundHalf` (rename `soundHalf`), `enginePlayParams`
   (parameterised: `enginePlayParams(exploreParams, chLayerEdit)` — app.js
   keeps a thin arrow that passes its module state). Watch for hidden
   dependencies (`_MELODY_PARAMS`, `_RHYTHM_PARAMS`, `_SURPRISE_EXTRAS`,
   `PERC_ROLES`…) — move them too. app.js imports the lot; **zero logic
   changes**.
2. Add to params.js the accessor pair (used nowhere yet except tests):
   ```js
   export function getSoundParam(p, sel, key) { … }   // sel: layer id | null(=base)
   export function setSoundParam(p, sel, key, value) { … }
   ```
   In this WP they read/write the top level when `sel` targets the base and
   `layers[i].subnote` otherwise — i.e. they codify TODAY's storage.
3. Sweep app.js sound-half control bindings through the accessor **only where
   mechanical** (the big `bindSlider`-style helpers); leave odd one-offs for
   WP-3 but list them in `docs/LAYER_UNIFICATION_NOTES.md` as you find them.
4. Move the WP-0 tests that duplicated any app.js logic to import params.js.
   Add unit tests: accessor get/set round-trips for base and layer targets;
   `enginePlayParams` invariant (edit in progress vs not → identical engine
   params — port of the 2026-07-15 fix).

### Acceptance
- Suite green, goldens byte-identical (this WP must not change fixtures).
- `git diff --stat` on app.js shows mostly deletions/import lines; any logic
  diff needs a comment justifying it.
- Browser smoke passes; bundle still loads with plain ES imports (no build).

---

## WP-2 — Engine dual-read

**Goal**: `synth.js` accepts both shapes; legacy flat input stays bit-exact.

### Steps

1. Add `ensureLayers(p)` to params.js (import into synth.js is fine —
   synth.js may not import app.js, but params.js must stay DOM-free):
   - If `p.layers?.[0]?.sound` exists → new shape; return as-is.
   - Else synthesise a view: `layers[0] = {id:"base", sound: soundHalf(p),
     space:{angle:p.spaceAzimuth??0, dist:p.spaceDistance??2.5},
     gain:p.baseLayerGain??1, solo:!!p.baseLayerSolo,
     name:p.spectralProfileName}` + existing `layers[]` entries mapped
     `subnote→sound` alias. **Non-mutating** (return a derived object) so
     research-event logging of raw params is unaffected.
2. At each SynthEngine/GenerationEngine entry point (§2.4 list), normalise
   once via `ensureLayers` and make the primary voice read `layers[0].sound`
   + `layers[0].gain/solo/space`, additional voices `layers[1..]`. Kill the
   direct `baseLayerGain`/`baseLayerSolo`/top-level-sound reads inside the
   engines (they now come through the normalised view).
3. `updateEffects`/`updatePercLayers`/`_layerChains` keyed by layer id: the
   synthesised base gets the stable id `"base"` so live chain updates keep
   matching across calls.

### Acceptance
- ALL WP-0 goldens pass unchanged for legacy-shape fixtures (bit-exact).
- New-shape twins of every fixture (auto-derived by `ensureLayers` in the
  test) produce IDENTICAL golden output to their legacy twins.
- Browser smoke passes (app still sends legacy shape at this point).

---

## WP-3 — Flip the editor

**Goal**: selection replaces the swap; app state adopts the new shape.

### Steps

1. `exploreParams` is created/loaded through a new `migrateParamsShape(p)`
   (params.js): moves top-level sound keys into `layers[0].sound`, converts
   `subnote→sound`, `baseLayerGain/Solo → layers[0]`, `spectralProfileName →
   layers[0].name`, `spaceAzimuth/Distance → layers[0].space`. Idempotent.
   Applied at every load boundary: boot, preset load (`voiceParamsFor`),
   palette edit round-trip, arrangement load.
2. Introduce `selectedLayerId` (default `layers[0].id`). Point the WP-1
   accessor at `layers[find(selectedLayerId)].sound`. Delete `_chLayerEdit`,
   `enterLayerEdit`, `exitLayerEdit`, `soundHalf` stash usage,
   `enginePlayParams` (now literally `{...exploreParams}` — keep the function
   as a trivial wrapper so call sites don't churn).
3. LAYERS strip: row 1 renders from `layers[0]` like any row (keep the BASE
   badge unless the owner says otherwise); row click = set `selectedLayerId`
   + `renderExplore()`. `＋` add pushes a layer cloned from the SELECTED
   layer's sound and selects it. Remove-layer on `layers[0]` stays forbidden.
4. Sweep the one-offs listed in `LAYER_UNIFICATION_NOTES.md` (space stage
   `applyAt` base branch, effects stage bindings, preview badge path
   `synth.play({...exploreParams, ...sound, layers:null})` — that preview
   semantic becomes "solo a temporary layer", implement as
   `{...p, layers:[{id:"preview", sound, …}]}`).
5. Serialization TEMPORARILY still emits the flat mirror — that's WP-4's
   dual-write; in this WP call the (new) `serializeParams(p)` at every save
   boundary so there is exactly one place WP-4 has to touch.

### Acceptance
- Goldens unchanged (engines already dual-read; the app now feeds new shape).
- New invariant tests: swap selection during playback → engine params stable
  except the edited values; add/remove/reorder layers preserves others'
  sounds; save→load round-trip through `serializeParams`+`migrateParamsShape`
  is identity.
- Playwright smoke updated where selectors changed, still zero console errors.
- Manual: owner-level click-through of the §3 smoke plus: rename layer 1,
  drag row pads, per-layer effects editing, community share/audition of a
  patch, producer ✎ round-trip on a region.

---

## WP-4 — Serialization dual-write + external surfaces

**Goal**: stored/shared data stays compatible in both directions.

### Steps

1. `serializeParams(p)`: emits the new shape PLUS a flat mirror of
   `layers[0].sound` (and `baseLayerGain/Solo`, `spectralProfileName`,
   `spaceAzimuth/Distance`) at the top level. Older clients then read the
   patch as "base + N−1 layers" — acceptable degradation; document it.
2. Apply `migrateParamsShape` at EVERY inbound boundary: community fetch,
   library import, arrangement registry load, region `paramsOverride` read,
   `regionPlayParams` composition, auditioner merge. Grep checklist:
   `voiceParamsFor`, `regionVoiceParams`, `regionPlayParams`,
   `commitPaletteEdit`, `applyItemCapturePart`, `auditionerSynthParams`,
   `loadArrangement`, `mergedPresetParams`, bake (`captureSpan`) and mixdown
   (`renderSpan`) call sites.
3. Capture parts: "notes" part = `layers[selected].sound` of the edited stack
   (confirm with owner: sharing a sound module shares the SELECTED layer's
   sound — previously always the base). Keep `capturePartForParam` working on
   flat dicts (it classifies keys of a sound-half — unchanged).
4. Percussion: untouched — `perc*` stays top-level; re-run the community
   strip tests.

### Acceptance
- Migration corpus round-trips: old→new→serialize→reload converges (fixture
  test); new-shape data survives a pass through an OLD reader (simulate: take
  the flat mirror only, drop `layers[0].sound`, reload → engine output equals
  the flat-legacy golden for that patch).
- Producer bake/mixdown byte-compare: bake the demo arrangement pre/post WP
  (WP-0 should capture a `captureSpan` golden for one region to enable this).

---

## WP-5 — Cleanup (after prod soak; owner triggers)

Remove: the flat mirror in `serializeParams`, `baseLayer*` key handling,
legacy fallbacks in `ensureLayers` (keep `subnote` read-alias and
`migrateParamsShape` forever — cheap and protects old exports), dead CSS/UI
special cases. Bump a `paramsShape: 2` version field on serialization for
future-proofing. Suite + corpus must stay green with the legacy fixtures
still passing THROUGH `migrateParamsShape` (they become migration tests, not
direct-engine tests).

---

## Dependencies & sizing

```
WP-0 (harness)        ~1–2 days   ← blocks all
WP-1 (extract)        ~1–2 days   ← blocks WP-2/3
WP-2 (engine dual-read) ~1–2 days ← blocks WP-3
WP-3 (editor flip)    ~2–3 days   ← blocks WP-4
WP-4 (serialization)  ~1–2 days   ← blocks WP-5
WP-5 (cleanup)        ~0.5 day, after prod soak (owner decides)
```

Suggested agent assignment: WP-0 and WP-1 can run in parallel by two agents
(WP-1 rebases its tests onto WP-0's runner at merge). Everything after is
serial.

## Known traps (learned the hard way — don't rediscover them)

- Regions play from `region.paramsOverride` ONLY. `region.params` is a dead
  store; never write to it (2026-07-15 bug class).
- A layer edit in progress must never leak into a save/commit
  (`commitPaletteEdit` folds first today; after WP-3 the problem class
  disappears, but keep its regression test).
- `percEnabled` must NOT appear in `DEFAULTS` (old percussive presets would
  be silenced — see `resolvePercEnabled` comment).
- `Date.now()`/randomness in fixtures = flaky goldens; everything seeded.
- `spaceAzimuth`/`spaceDistance` are consumed by BOTH the base voice position
  and several visualisers (`drawSpacePad`, stage, ears view) — when they move
  into `layers[0].space`, sweep `grep -n "spaceAzimuth" web/static/app.js`
  (48 hits at time of writing) exhaustively.
- The effects registry registers by side effect of importing
  `effects/index.js` — keep import order when extracting modules.
- localStorage keys are versioned (`phase0.*.v1`) — shape migration happens
  in code, not by bumping storage keys (users must not lose arrangements).
