# Roadmap — every recent feature request and the execution plan

Single source of truth for what was asked, what's shipped, and how the
rest gets built — written so a FRESH MODEL/CONTEXT can execute it cold.
Verbatim owner quotes: [OWNER_BRIEF_2026-07-07.md](OWNER_BRIEF_2026-07-07.md).
Tone-model design: [TONE_MODEL_V2_DESIGN.md](TONE_MODEL_V2_DESIGN.md).
Producer design: [PRODUCER_V3_SPEC.md](PRODUCER_V3_SPEC.md).
Updated 2026-07-07. Historical loop phases A–H archived at the bottom.

---

## 0 · Context primer for a fresh executor

Read this before touching anything.

### Architecture

| File | Role |
|---|---|
| `web/static/app.js` (~8.7k lines) | ALL UI. Hash router `route()` (~line 949): hash `""` → studio (`renderExplore()`, ~3651), `#produce` → producer. Views are template strings injected via `mount()`; **every render re-creates the DOM, so all event wiring lives inside the render function and re-attaches per render**. Cross-render state lives in module-scoped `let`s: `exploreParams`, `arrangement`, `_chStage`, `_chFocus`, `_chBodySel`, `_chPerfOpen`, `workspaceTab`, `macroTab`, `libraryFilter`… |
| `web/static/synth.js` (~3.4k lines) | Engine, importable headlessly in Node. `GenerationEngine`: `initialise()`, `nextNote()`, `_generateMotif()`, `_arpSequence()`, `_pickBiasedNote()`, `_spectralFingerprint(velocity, fundamentalHz, degree, formantPos)`, `_articulatedBands()`, `_surpriseCandidates()`; playback/render: `playNotes()`, `renderSpan()`, `renderNotesSpan(params, notes, t0, …)`, `captureSpan()` (bake). `Scale` class (`div`, `all`, `sub`, `norm()`, `nearest()`, `stepFrom()`, `degreeToHz()`). Pure exported laws (headlessly testable): `materialT60`, `partialFrequency`, `excitationSpectrum`, `transferCoupling`, `bodyBandsFor`, `bodyResponse`, `spaceAirCutoff`, `spaceProximityDb`, `spaceArrivalDelay`, `formantFreqsAtPoint`, `migrateToneParams`. Tables: `SPECTRAL_PROFILES` (8 instruments), `BODY_PRESETS`, `FORMANT_PRESETS`, `VOWEL_POINTS`, `SPECTRAL_PERFORMANCE`; imports `MEASURED_PROFILES` from `measured_profiles.js` and merges at module init. |
| `web/static/factory-presets.js` | `FACTORY_PRESETS` array: `{id, name, section: "full"\|<sectionKey>, family?, description, parameters}`. Parameter keys MUST exist in `DEFAULTS` (validate before committing). |
| `web/static/measured_profiles.js` | GENERATED — regenerate via `python3 scripts/gen_measured_profiles_module.py` from `measured_profiles.json`. Never hand-edit. |
| `web/static/styles.css` | Single stylesheet. CHORDA tokens `.ch-*`, producer `.tl2-*`, roll `.roll-*`. |
| `web/static/index.html` | Cache-buster `?v=NNN` on script tags (currently **v152**). **Bump on EVERY change** or the browser serves the stale build — this has burned hours. |
| `scripts/verify_tone_model.mjs` | Headless assertion suite (**140 passing**, incl. the Q1 badge/bucket block). Pattern: `check(name, condition, detail?)`; add new blocks immediately before the final `if (failures)` line. Run: `node scripts/verify_tone_model.mjs`. |
| `src/synthesiser/…` + `tests/` | Python stdlib HTTP server + 20 pytest tests. Run: `.venv/bin/python -m pytest -q`. |

### Key data structures

- **Params object** (one flat dict drives everything): defaults in
  `DEFAULTS` (app.js ~157), tooltips in `PARAM_DESC` (~330). UI controls
  bind by attribute: sliders `input[data-param]`, selects
  `[data-param-select]`, checkboxes `[data-param-check]`, rotary knobs
  `[data-knob]` (built by `knobHTML()`), segmented buttons follow the
  pattern of `data-exc-type` / `data-melody-pattern` /
  `data-note-connection` (add a new `data-*` + a wiring block in
  renderExplore). Params in `liveSubnoteParams` /`liveReverbParams`
  sets (inside renderExplore) apply live without restarting the
  sequence — add new engine params there.
- **Arrangement** (producer, localStorage): created by
  `blankArrangement()` (app.js ~1053) =
  `{id, name, version: 2, lengthBeats, tracks[], palette[], context}`.
  `palette[i] = {id, name, kindLabel, params}` (a full voice).
  `track = {id, name, gain, pan, muted, soloed, regions[], space?}`.
  `region = {id, paletteId, seed, startBeat, lengthBeats, type:
  "take"|"baked", notes?[], takeOffsetBeats?, muted?, gain?}`.
  `regionPlayParams(track, region)` (~1234) merges
  `{...DEFAULTS, ...arrangement.context, ...paletteVoice, seed}` — this
  is THE merge point for anything global-per-track (global scale Q5,
  global space Q6 hook here).
  Undo: `saveArrangement(label)` (~1091) pushes `_undoStack` (120 deep).
- **Baked notes** (`region.notes[i]`): `{degree, offsetDivs,
  durationDivs, velocity, intonationCents, beatDivisions, gapFraction,
  legatoFromPrevious, isSurprise, noteRole, onsetDevDivs?,
  durationDevDivs?, formantPos?, …}`. Roll: `drawRoll(region)` (~1859),
  `wireRoll(v)` (~2019). QA hook: `window._rollHitsQA`.
- **Section classifier**: `PRESET_SECTIONS` (app.js ~82) + `_MELODY_PARAMS`
  etc. key-sets right below — these define the macro-half vs
  subnote-half split for Q1 (sound → subnote; melody/rhythm/dynamics/
  surprise → macro; percussion/space are context-ish).

### Working discipline (non-negotiable)

1. `.venv/bin/python -m pytest -q` AND `node scripts/verify_tone_model.mjs`
   green before every commit. One reviewable commit per chunk with the
   reasoning in the message.
2. Bump the `?v=NNN` cache-buster in index.html with every change.
3. Live-verify in the browser before claiming done: preview server
   `sound-studio` from `.claude/launch.json` (autoPort — :3000 when free,
   otherwise auto-assigned; a recent run landed on :49898).
   The page may be sitting on `#produce` — set `location.hash = ""` and
   wait ~250 ms before querying studio DOM.
4. Install a probe BEFORE interacting: `window.__errs = [];
   window.onerror = m => window.__errs.push(String(m))` — renderExplore
   failures are silent in the console capture.
5. `web/data/` is gitignored (participant data — NEVER publish). Sample
   audio never enters the repo; only fitted parameters do.
6. If a change alters what parameters MEAN (not just UI), bump
   `APP_VERSION` (app.js) so `stimulus_id` provenance stays honest.
7. Durable owner-facing servers: :8765 (current), :8766 (old-engine
   A/B) — leave them alone; use the preview server for verification.

### Coordination between contexts

More than one context works this plan. Before starting a Q item run
`git status` — UNCOMMITTED work in the tree probably IS that item,
half-done by another context. Review the diff, continue or leave it;
never blindly reset. Claim an item by committing early and often.

### Gotchas that have already burned time

- **Template div balance**: an unbalanced `</div>` in a workspace
  template silently re-parents later markup and breaks wiring with
  `null.onclick` errors far from the cause. After editing big templates
  run a `<div>`-vs-`</div>` count over the changed function.
- **Bulk edits**: use python heredoc patches with
  `assert src.count(old) == 1` anchors, then `node --check` the file.
  Never regex-rewrite big ranges — a past bulk edit swallowed a whole
  function (`wireSpacePad`) between two anchors.
- **Synthetic interaction**: element selection handlers are `onclick` —
  use `el.click()`, not mousedown+mouseup. Knob drags DO work
  synthetically: dispatch `mousedown` on the cell then `mousemove`/`
  mouseup` on `window`. A11y text is CSS-uppercased — match
  `"Sub-note"`, not `"SUB-NOTE"`.
- **Re-render kills controls mid-drag**: never `renderExplore()` inside
  a slider's `oninput`; do it on `change` (drag end). Persist
  `<details>` open-state in a module var (`_chPerfOpen` pattern).
- **Slider ranges clamp display, not the param** — a param can
  legitimately exceed its slider's max (e.g. preset envelope attack).

---

## 1 · Ledger — requests and status

### Shipped (commit · build)

| Request | Asked | Landed |
|---|---|---|
| Tone model v2: excitor→resonator→body→space, true-ratio transfer, bow imperfection replacing amplitude probability, 64 partials | 07-05 brief | T1–T8, physics assertions in verify script |
| CHORDA sub-note UI | 07-06 | stage rail + inspectors + tone print + lens |
| Space v1: distance/angle, arrival delay, air absorption, proximity | 07-06 | space pad + headless laws |
| Producer v3: undo/redo, loop range, seed chips, split/duplicate, drop preview, dbl-click create | 07-06 | blocks E/A/B1/D1 |
| Roll batch: intended-vs-realised ghosts, velocity pins, ⇧ micro-drag, grid/scale/key readout, "incorporated" | 07-06 | `9ac003a` v141 |
| Articulation manipulates the SELECTED body; per-band EQ chips; preset-then-editable bodies | 07-07 | `aaf2914` v143 |
| Realistic presets measured from real samples (no audio ships) | 07-06 | `b08b37b` + `9e6b913` v145 |
| P1 Arpeggiator (walk/arpUp/arpDown/arpUpDown, stride, octaves) | 07-07 | `270b50b` v146 |
| Surprise walk-only + can't-turn-surprise-off bug | 07-07 | `151823a` v147 |
| CH-B2: draggable ADSR + vibrato + onset noise in EXCITOR; liftable `envelopeProbBlockHTML`/`vibratoBlockHTML` | audit | `fb76fbb` v148 |
| P2 family starters (percussive/bass/atmos/melody) + library family filter chips | 07-07 | `b17a63a` v149 |
| P3 note connection: `noteConnection` glide\|ring | 07-07 | `da5111b` v150 |
| Q1 patch transparency: badge row (scale/splits/grid/tempo/connection/✦dims), adopt-tempo, splits filter, MACRO\|BOTH\|SUB-NOTE half-loads via drop-on-card | 07-07 brief | `7b75e76` v151 |
| Q2 standalone reverb card removed from macro production tab (type parks until Q6's designer; patch SPACE inspector untouched) | 07-07 brief | `b67537b` v153 |
| Q3 baked-note drill-down: `performance` persisted per note at bake (`notePerformance` law), read-only card in the roll drawer, legacy bakes degrade with a re-bake hint | 07-07 brief | `c15ddbd` v154 |
| Q4 binaural head: `itdSeconds`/`ildDb`/`headShadowCutoff`/`pinnaParams`/`spaceDistanceGain` laws, explicit per-ear graph replaces the HRTF panner, `earDistance`+`headDensity` knobs, full-circle pad (±180°, behind shaded). APP_VERSION → 0.4.0 | 07-07 brief | `6a75198` v155 |
| Q5 global scale strip: `arrangement.globalScale` markers + `globalScaleAt` law, per-track G opt-in, merge after voice in `regionPlayParams`, collapsible strip + mini-roll operator cycling (off→scale→sub→root) | 07-07 brief | `5b343a5` v156 |
| Q6 global space designer: `trackSpaceAt` interpolator, `arrangement.space` (mode override/offset, head owns reverb type per Q2), cross-section editor (drag/snap-back/dblclick-anchor, first anchor seeds start+end), rocking cylinder with roll-spring + anchor→playhead jump, smart-arrange activation modal, per-beat walker retarget | 07-07 brief | v157 |

### Queued — build order

Q1 patch transparency + module halves → Q2 global-reverb removal →
Q3 baked-note drill-down → Q4 binaural head → Q5 global scale strip →
Q6 global space designer → Q7 layered subnotes → Q8 imperfections →
Q9 producer remainders → Q10 MIDI recording → Q11 vocabulary audit →
Q12 QA capstone + resizable panels.

Rationale: engine data before the UI that reads it; Q4's head model
before Q6's designer that edits it; Q11/Q12 last to sweep finished
surfaces.

### Requires owner decision (write docs, build nothing)

- **Harmony instrument patches**: to spec as a voicing layer on the
  melody walk — the patch declares chord degrees in scale-degree space;
  each generated note carries satellite voices; composes with arp mode.
  Distinct from P3 overlap (temporal) and Q7 layering (same
  fundamental).
- **Hosting/monetisation**: moat = shared patch/arrangement library with
  attribution + remixing; free studio + paid private libraries/exports;
  research/education niche. Owner asked "is there a path?" — draft the
  analysis, let the owner react.

---

## 2 · Execution plan (handoff-grade)

### Q1 — Patch transparency + module halves (producer)

**STATUS 2026-07-07 ~15:30 — IMPLEMENTED, UNCOMMITTED, one verification
gap.** All of Q1 exists in the working tree (built by a parallel
context): `patchBadges`/`splitsBucketOf` pure in synth.js (+14
assertions, suite at 140), `patchBadgesHTML` + `loadPresetIntoPatch` +
`_palHalfSel`/`splitsFilter` + adopt-tempo wiring in app.js, `.pb-*`
CSS, cache at v152. Layered on top (same tree): the ORIGIN-SCALE FIX —
palette voices strip session context (scale/tempo), so badges lied
("Major · 7 splits" for a pent-minor patch); `addToPalette` now
captures `pl.originScale` {scaleMode, scalePreset, customDegrees,
edoDivisions}, both `patchBadgesHTML` call sites merge it back, and
macro/BOTH loads refresh it alongside `originTempo`.

Verified live (port 49898): badges truthful after re-add
("Pentatonic minor · 5 splits · grid 4 · 112 bpm · glide · ✦ R·D"),
half selector arms (`.half-armed`), adopt button renders, zero console
errors; pytest + verify green. REMAINING: (1) live-verify the
drop-preset-on-patch half-load — synthetic drags must use MOUSE events
(`mousedown` on the card via `card.onmousedown` → `document`
`mousemove` ≥5 px to pass the drag threshold → `document` `mouseup`
over the palette item; the earlier PointerEvent attempt silently
no-ops). Assert via localStorage `phase0.arrangements.v1` (map of
id→arrangement; current id in `phase0.arrangement.current`): SUBNOTE
load of Slow Sky onto Wood Talk ⇒ `excitationType` "strike"→"blow",
`bodyArticulation` 0→0.55, while `onBeatProb` 0.92 / `registerWidth` 0
survive. (2) Also verify old palette items (pre-originScale) degrade
gracefully. (3) Commit the whole Q1 chunk.

**Owner intent.** "Patches should have certain settings that are
transparent in producer mode… surprise, which dimensions… their scale.
Number of splits (duration). Original tempo (ability to set session
tempo to this), polyphony/mono." Filter browser by splits. Batch 2:
each patch = MACRO ENGINE + SUBNOTE MODULE; load presets into one half
keeping the other; which-half navigation must be intuitive.

**Files/anchors.** app.js: palette card render (search `tl2-` and
`arrangement.palette`), region markup (search `tl2-seed` — seed chips
already render on regions, follow that pattern), `regionPlayParams`,
`PRESET_SECTIONS` + `_MELODY_PARAMS`-style key sets (~82–130), preset
browser `renderPresetList` + `libraryFilter`.

**Build.**
1. `patchBadges(params)` pure helper → `{surpriseOn, dims:
   ["P","T","R","F","D","rest"] filtered by surprise*Enabled &&
   weight>0, scaleLabel (scalePreset or "N-EDO n"), splits:
   customDegrees.length, grid: beatDivisions, tempo, connection:
   noteConnection}`. Render as a badge row on palette cards and (small)
   on region hover/selected state.
2. "Adopt tempo" button on the palette card: sets
   `arrangement.context.tempo = patch.params.tempo`,
   `saveArrangement("adopt tempo")`, re-render, live-update playing walk.
3. Browser filter: a splits dropdown (5/6/7/8+/12/other) beside the
   family chips; filters `FACTORY_PRESETS`+user presets by
   `parameters.customDegrees?.length`.
4. Module halves: on each palette card, a two-segment control
   `MACRO | SUBNOTE` (module state var, default whole-patch load per
   current behaviour + an explicit `BOTH`). Loading a preset with a half
   selected merges ONLY that half's keys: subnote half = the `sound`
   section key-set; macro half = melody+rhythm+dynamics+surprise sets.
   The active half must be visually loud (accent border + label swap).
5. Persist nothing new in the schema — badges derive from params.

**Verify.** Headless: badges computed from a params fixture match by
hand. Live: badge row renders on all palette cards; adopt-tempo changes
the session bar and survives reload; half-load: load a Sound preset
onto a patch with SUBNOTE selected → melody params unchanged (assert via
before/after param diff in the console probe).

### Q2 — Remove standalone global reverb

**Owner intent (clarified).** "The reverb space type option (room,
cathedral etc.) is only in the producer section when you use the global
space. Otherwise each patch can have its own space."

**Files/anchors.** app.js macro production tab: search
`data-param-select="reverbType"` (~4722) and the production/space card
around it; `liveReverbParams`; migration entry point = wherever saved
params load (`loadPresets`, explore boot).

**Build.** Delete the standalone reverb card from the macro production
tab (reverb params remain in the params object — patches still use
them; the SUBNOTE space section keeps its own controls). One-time
migration: if a loaded arrangement context carries reverb keys, leave
them (context reverb becomes Q6's global space seed). Park the
`reverbType` selector until Q6 (it returns inside the designer).

**Verify.** Old presets A/B: render a fixed seed before/after — same
audio params reach the engine. UI: card gone from production tab; patch
space section unaffected.

### Q3 — Baked-note drill-down

**Owner intent.** "After baking a note series you should be able to
drill down into a note to see things that vary per note and aren't
shown in duration, velocity information. E.g. glide, envelope settings."

**Files/anchors.** synth.js `captureSpan` (~2725) — the bake source;
`renderNotesSpan` shows which per-note fields the audible path uses.
app.js `drawRoll`/`wireRoll` + the roll readout (search
`rollReadoutText`).

**Build.**
1. At bake time, persist the per-note performance draw:
   extend the captured note with `performance: {envelope: {a,d,s,r},
   vibrato: {depth,rate}|null, glideFrom: hz|null, glideMs,
   attackNoiseLevel, tuningCents, formantPos}` — all already computed in
   the engine when the note renders; capture instead of discarding.
2. Roll: clicking a note (existing hit-test in `wireRoll`) opens a
   drill-down card in the drawer (read-only v1): rows for each
   performance field, values formatted with units.
3. Backfill: baked regions from before this change lack `performance` —
   card shows "re-bake to capture performance detail".

**Verify.** Headless: bake a region, assert `notes[i].performance`
fields are present + match a re-render's audible params. Live: click a
baked note → card shows glide/envelope values; old regions degrade
gracefully.

### Q4 — Binaural head model + front/behind

**Owner intent.** Space in front AND behind; per-ear arrival time; knobs
ear-to-ear distance, head size, head density ("maybe one redundant");
ear-shape modelling so behind sounds different from front.

**Design (already confirmed in brief).** "Head size" IS ear distance —
drop it. Params: `earDistance` (0.12–0.25 m, default 0.175),
`headDensity` (0–1, default 0.5). Pinna cue is a law, not a knob.

**Files/anchors.** synth.js spatial chain: search `_configureSpace` and
the master→proximity→air→delay→HRTF panner graph; space laws
(`spaceArrivalDelay` etc.) near the other pure laws. app.js space pad:
`drawSpacePad`/`wireSpacePad`/`_spacePadGeom` (pad currently frontal).

**Build.**
1. Pure laws in synth.js (export for tests):
   `itdSeconds(angleRad, earDistance)` = Woodworth
   `(d/2)(θ+sinθ)/343` with θ folded to [-π/2, π/2] laterality;
   `ildDb(angleRad, freqHint, headDensity)` → far-ear shadow, scale
   0–1 density to 0–12 dB max shadow + lowpass 1.2–8 kHz;
   `pinnaParams(angleRad)` → `{shelfDb, notchHz≈8000, notchDepthDb}`
   zero in front, scaling smoothly for |angle|>90°.
2. Audio graph: replace the HRTF `PannerNode` with an explicit split:
   source → [L: delayL→shadowL(biquad lowpass+gain)] +
   [R: delayR→shadowR] → pinna filter (shared biquad pair, set by
   source angle) → merger → existing air/proximity/reverb chain. Keep
   `spaceDistance` semantics identical.
3. Params: DEFAULTS + PARAM_DESC + knobs in the SPACE stage inspector
   (`earDistance`, `headDensity`); add to `liveSubnoteParams`… note
   these are LISTENER properties — Q6/Q7 will inherit them (layer
   blocks default-inherit, per owner).
4. Space pad: full circle (listener centre), angle range ±180°;
   behind-region subtly shaded; drag anywhere on the circle.
5. `migrateToneParams`: nothing to migrate (new params default sanely).

**Verify (assertions).** ITD: 0 at 0° and 180°, max at ±90°,
∝ earDistance. ILD: 0 at 0°, grows with density and angle. Pinna:
notch depth 0 in front, >0 behind only. Live: drag pad left/right —
probe `AudioContext` graph or assert delay node values; A/B front vs
behind audibly different (owner audition note).

### Q5 — Global scale strip (P8a)

**Owner intent.** Collapsible section above the timeline; add MARKERS;
per marker a mini piano-roll where clicking note divisions cycles
operators (scale / out-of-scale / sub-scale / tonic — same as patch
scale operators); per-track opt-in; baked notes don't change.

**Files/anchors.** app.js producer view markup (timeline header, search
`tl2-loop-range` / ruler markup), `regionPlayParams` (the merge point),
scale editing UI in macro (`SCALE & ROOT` card) for the operator-cycling
interaction to mirror.

**Build.**
1. Schema: `arrangement.globalScale = {enabled, markers: [{atBeat,
   degrees: number[], subScaleNotes: number[], rootNotes: number[]}]}`;
   `track.useGlobalScale = bool` (default false; toggle in track head).
2. Merge: in `regionPlayParams`, if `track.useGlobalScale` and a marker
   exists at/before the region's play position, spread
   `{customDegrees, subScaleNotes, rootNotes}` from the marker AFTER the
   voice params. Take-type regions regenerate under it; baked regions
   replay stored notes → untouched by construction.
3. UI: collapsible strip above the ruler (chevron + "Global scale");
   "+ marker" at playhead; markers draw as flags on the strip; selected
   marker opens a 12/N-division mini-roll where clicking a division
   cycles off→scale→sub→root (colour language identical to the macro
   scale card: dark/lit/gold/violet).
4. `saveArrangement("global scale")` on every edit for undo.

**Verify.** Headless: params for an opted-in track after the marker
carry the marker's degrees; opted-out track byte-identical; baked
region notes unchanged. Live: click-through cycle on the mini-roll,
marker flag renders, per-track toggle works, undo restores.

### Q6 — Global space designer (P8b, after Q4)

**Owner intent (full spec in brief §P8).** Cylinder along the timeline
implied only by instrument threads (distance + radial position), slow
rocking, drag-up/down rolls with snap-back; cross-section at the
playhead with head (ear distance/density) + track dots; drag or anchor
(first anchor auto-creates start+end; double-click adds; smoothness
curves; non-anchored drags snap back); selected track highlights its
thread; clicking an anchor jumps the playhead; on activation ask
"smartly arrange or keep patch positions?"; overrides patch space or
offsets it; owns reverb type (from Q2).

**Schema.** `arrangement.space = {enabled, mode: "override"|"offset",
head: {earDistance, headDensity, reverbType}, tracks: {trackId:
[{beat, angle, dist, smooth: 0..1}]}}`.

**Build order.**
1. Interpolator (pure, in app.js or a small module):
   `trackSpaceAt(anchors, beat)` — Catmull-Rom-ish with per-anchor
   smoothness (smooth 0 = linear); assertions first.
2. Playback hook: in `regionPlayParams`/the walker tick, resolve each
   track's `{angle, dist}` at the playhead and push into the voice's
   space params (override or add-as-offset per mode); head params merge
   from `arrangement.space.head`.
3. Cross-section canvas (build FIRST — it's the editor): top-down
   circle, head at centre (radius ∝ earDistance), dots per track,
   selected = accent colour; drag selected dot → if no anchor at
   playhead beat, snap back unless double-click (creates anchor; the
   very first anchor for a track also creates start+end anchors).
4. Cylinder canvas (visualisation): x = time, thread y/thickness from
   angle/dist projection; idle rocking = slow sine on the projection
   angle; vertical drag adds roll offset, springs back on release;
   anchor dots on the selected thread; click → `arrPos = anchor.beat`.
5. Activation flow: toggling "Global space" on first use → modal
   "Smartly arrange instruments in space?" (distribute tracks evenly
   around the listener by track index, distance by family if known) vs
   "Keep patch positions" (mode = offset).
6. Reverb type selector moves into the designer head panel (closes Q2).

**Verify.** Interpolator assertions (linear at smooth 0, anchor hit
exact, clamping); live: thread renders per track, anchor add/drag/jump
interactions, rocking + roll-snap-back animation, smart-arrange
distributes, mode=offset adds to patch space.

### Q7 — Layered subnote modules (CH-B5)

**Owner intent (batch 2).** ＋ adds current subnote module as a layer;
coloured blocks along the bottom; per-block distance/position + volume;
layers inherit head size/density unless "independent head"; block strip
has "override envelope probabilities" syncing envelope variation across
layers.

**Files/anchors.** synth.js `_spectralFingerprint` + `_render*` (layer
render = union of partial sets), `transferCoupling` (cross-layer);
app.js sub-note view bottom (below the CHORDA card), CH-B2's
`envelopeProbBlockHTML` (reuse VERBATIM for the override).

**Build.**
1. Schema: `params.layers = [{id, hue, subnote: {…subnote-half params},
   space: {angle, dist}, gain, independentHead: bool}]` +
   `params.layerEnvOverride: null | {envelopeProb, envelopeAttack…}`.
   The BASE instrument is layer 0 implicitly.
2. Engine: per note, render each layer's fingerprint; merge into ONE
   stream — union of partials, cross-layer transfer coupling via the
   existing law over the union set; per-layer gain + spatial position
   (each layer gets its own Q4 spatial chain unless inheriting); ONE
   seed drives all layers (offset per layer index for decorrelation).
   Envelope draws: if `layerEnvOverride`, one draw shared by all layers;
   else independent draws per layer.
3. UI: block strip along the sub-note view bottom; ＋ copies the current
   subnote half as a new layer block (auto hue); click block → mini
   panel: gain slider, space mini-pad, "independent head" toggle,
   remove. Strip header: "override envelope probabilities" checkbox →
   swaps in `envelopeProbBlockHTML(overrideParams)`.
4. Persistence: layers ride the params object → presets/palette work
   free of charge, but bump `APP_VERSION` (semantics change).

**Verify.** Assertions: layered fingerprint = union with coupling;
sync override → identical envelope draws across layers (seeded);
independent → different draws; layer gain scales its partials only.
Live: add/remove blocks, per-block edits audible, override swap works.

### Q8 — Imperfections (CH-B4)

Order and law sketches (each = pure law + assertion + knob only if
audibly needed; measured data for 2 already exists):
1. **Onset pitch scoop**: f0 approaches from below over the attack —
   depth scaled by excitation type (bow/blow > strike/pluck) and
   `excitationHuman`; implement as a frequency ramp at note start in the
   render path.
2. **Attack stagger**: low partials speak first for bow/blow (measured
   `lowToHighStaggerMs` is in `measured_profiles.json` → regenerate the
   JS module to expose it); per-partial onset delay ∝ partial index.
3. **Release ring**: after note-off the resonator keeps ringing at
   `materialT60(f)` — currently the envelope cuts; let partial tails
   decay naturally (cap for CPU).
4. **f0 wander**: very slow seeded random walk (<±4 cents) during
   sustain, scaled by Human.

### Q9 — Producer remainders

- **D2 roll parity**: pencil-add (click empty cell in add-mode), ⌫
  delete selected note, M mute note (velocity 0 flag, not removal), Q
  quantize (zero `onsetDevDivs`), arrows nudge (←→ division, ↑↓ scale
  row, ⌥↑↓ cents), audition-on-edit (short `playNotes` of the touched
  note). All in `wireRoll`; keyboard handler on the roll drawer.
- **B2 multi-select**: `⇧click` extends, drag on empty lane = rubber
  band; selection set on module state; bulk gain/mute/delete/duplicate.
- **C track headers**: hue swatch, dB readout, per-track space mini-pad
  (writes `track.space`, merged in `regionPlayParams` after voice —
  NOTE: Q6 supersedes when global space enabled), reorder by drag,
  delete with confirm.
- **F onboarding**: first-visit producer tour (3 steps), `?` overlay
  listing shortcuts. Relabel Key control → "Key (root pitch)".

### Q10 — MIDI recording (P10)

**Owner intent (batch 2).** MIDI input overrides duration/dynamics/
melody; patch supplies glide/ring, probabilistic settings (envelope
draws), voice. N-EDO mapping options: (1) white-only vs white+black;
(2) all subdivisions mapped vs all-mapped-but-out-of-scale-muted vs
in-scale-packed-consecutive; (3) degree 0 at C repeating at next C vs
repeating at the very next key.

**Build.**
1. `midiMapDegree(noteNumber, scale, opts)` pure function implementing
   the 2×3×2 option grid; exhaustive assertions per combination
   (this is the risky logic — write the table tests FIRST).
2. `navigator.requestMIDIAccess()`; device picker in producer; per-track
   record-arm button; while armed+playing, incoming noteon/noteoff spawn
   engine notes through the patch voice (velocity → dynamics, duration
   from noteoff) and append to a recording buffer.
3. Stop → buffer becomes a BAKED region (notes in beat-space via the
   session tempo), so Q3 drill-down and the roll work unchanged.
4. Patch-level `midiMap` setting {keys: "white"|"all", coverage:
   "all"|"muted"|"packed", anchor: "octave"|"consecutive"}.

**Verify.** Mapping table assertions all 12 combinations × 12-EDO and
19-EDO; live with synthesized `MIDIMessageEvent`s (no hardware needed).

### Q11 — Vocabulary audit (P9)

Sweep every user-facing string (renderExplore + producer templates +
PARAM_DESC + USER_MANUAL.md). Deliverables: a terminology table in
docs (term → meaning → where used); renames where plain words exist
(candidates: "stimulus"→never user-facing, "fingerprint"→"tone print"
consistently, "incorporated"→already done, "sub-note"→consider
"instrument designer", "macro"→consider "behaviour"); hover explainers
(`title=` via `PARAM_DESC`) for terms that stay. Keep research-side
identifiers (stimulus_id, schema versions) UNCHANGED — they're
protocol, not UI.

### Q12 — QA capstone + adjustable panels

1. **Sweep**: `preview_resize` at 1280/1000/768 × every view: macro,
   sub-note × 4 stage inspectors (EXCITOR perf drawer open),
   producer (palette, timeline, roll drawer, dyn lane), library tabs,
   welcome card. Screenshot each; log every quirk (clipped controls,
   overlaps, unreadable text, dead buttons) as a checklist in the QA
   commit message; fix all.
2. **Adjustable panels**: the studio grid columns
   (`.explore-dashboard`, CHORDA `.ch-main`/`.ch-inspector` split,
   producer browser/timeline split) get draggable dividers — pattern
   already exists in producer v2 (search `resiz` in app.js; persisted
   panel sizes) — extend it to the studio; grid `minmax()` floors;
   inspectors get `max-height: none` + own scroll only as fallback.
   Known offenders: BODY inspector clips at 271 px; `.explore-dashboard`
   `overflow: hidden` at 790 px hides overflow instead of scrolling.
3. Re-run the sweep after the rework; both screenshot sets into the
   final report to the owner.

---

## 3 · Requires-thought deliverables (docs only)

Write as `docs/HARMONY_PATCHES_PROPOSAL.md` and
`docs/HOSTING_STRATEGY.md`; summarise to the owner; DO NOT build until
the owner reacts. Content directions are in §1 above.

---

# Archive — original loop phases A–H (2026-07-03 → 2026-07-06)

Historical, superseded. Producer v2 was signed off then rebuilt as v3;
tone v2 audition passed; formant mode retired into articulated bodies.

- **A — study flow** (done): stimulus identity, rate-what-you-hear,
  opt-in consent, adjust telemetry, server hardening.
- **B — expectancy instrumentation** (done): per-note surprisal,
  repetition metrics, metrics-1.0 event summaries, continuous vowel
  space.
- **C — export** (done): CSV export CLI, token-gated /api/export.csv,
  stimulus round-trip.
- **D — production quality** (done): soft clip/master EQ/click-free
  stop, modular section presets, factory starters, per-instrument
  performance, partial macros, 32 partials, 5-formant bank.
- **E — deployment** (done): health endpoint, DEPLOYMENT.md, endpoint
  tests.
- **F — UI** (done exc. direct-manipulation editors → producer line):
  responsive hero, FabFilter reskin, preset browser, vowel pad.
- **G — producer**: v1 → rejection → v2 (P1-P7 + U0-U13, signed off) →
  v3 (current; PRODUCER_V3_SPEC.md).
- **H — tone v2**: T0-T8 done; audition passed.
- **Cross-cutting**: GitHub Actions CI; 20-test server suite.
