# Producer — patch-editing hierarchy audit (2026-07-28)

Scope: what actually happens when you edit a patch in the Producer, which tier
wins, where the UI lies about it, and what to build instead. Every claim below
is cited to code; the two space claims were verified by running the real
`params.js` (`tmp/audit/spacecheck*.mjs`).

---

## 1 · The object model as built

| Object | Where it lives | What it owns |
|---|---|---|
| **Session context** | `arrangement.context` | `tempo` only, in practice. `SESSION_CONTEXT_PARAMS` is `{seed, tempo}` ([app.js:517](web/static/app.js:517)); `defaultArrangementContext()` also seeds `customDegrees` + `reverbWet` ([app.js:1458](web/static/app.js:1458)) but nothing in the Producer exposes them. |
| **Palette patch** | `arrangement.palette[]` | `params` (a complete voice) + `parts` (module identities) + `captureParts`. |
| **Module** | a slice of `params` | Five: `notes` (Sound), `space`, `stave` (melody/rhythm/dynamics/surprise), `clef` (Scale), `percussion` — [params.js:51](web/static/params.js:51), [params.js:58](web/static/params.js:58). |
| **Thread** ("track") | `arrangement.tracks[]` | `regions[]`, `gain`, `muted`, `solo`, `useGlobalScale`, `space`, `instrumentParams` (vestigial). |
| **Take** (region) | `track.regions[]` | `paletteId`, `seed`, `startBeat`, `lengthBeats`, `gain`, `muted`, and — the crux — `paramsOverride`. |
| **Harmonic guide** | `arrangement.globalScale.markers[]` | scale/sub-scale/root over time. |
| **Global space** | `arrangement.space` | per-thread anchors (`tracks`), static positions, and one shared `head` (listener + room). |

## 2 · The resolution law that actually runs

One function decides everything: `regionPlayParams()` ([app.js:1935](web/static/app.js:1935)).

```
DEFAULTS
  ← arrangement.context            (tempo)
  ← region.paramsOverride  OR  palette.params  OR  track.instrumentParams
  ← region.seed
  ← percussionOnly flag
  ← Harmonic guide marker          IF track.useGlobalScale        → scaleMode, edoDivisions, degrees, sub-scale, roots
  ← track.space                    → params.spaceAzimuth/Distance
  ← Global space thread            IF arrangement.space.enabled    → whole constellation via spApplyThreadToPatch()
  ← Global space head              IF enabled && !params.spaceOwnHead → ears, head density, room type/size/damping/wet/decay, yaw
```

Two things follow that are not visible anywhere in the UI:

1. **Take beats patch, always and silently.** The moment a region has a
   `paramsOverride`, its palette patch is dead to it forever.
2. **Global is not a top tier — it is a lateral claim on two specific modules.**
   Harmonic guide claims `clef` for opted-in threads. Global space claims
   `space` for all threads. Everything else is untouchable by the globals.
   That distinction is the missing sentence in the whole interface.

### Who wins, per module

| Module | Session | Patch | Take | Thread | Global |
|---|---|---|---|---|---|
| Sound (`notes`) | – | ✓ | **wins** | – | – |
| Note engine (`stave`) | tempo | ✓ | **wins** | – | – |
| Scale (`clef`) | – | ✓ | wins | HG opt-in | **HG wins** (opted-in threads only) |
| Space — position | – | ✓ | wins | `track.space` (broken, §3.4) | **thread wins** (when on) |
| Space — listener/room | – | ✓ | wins | – | **head wins** unless `spaceOwnHead` (no control exists) |
| Percussion | – | ✓ | **wins** | – | position only, via the thread |
| Level | `arrangement.master` × `track.gain` × `region.gain` — all three multiply ([app.js:1917](web/static/app.js:1917)) | | | | |

---

## 3 · Findings

Ranked by how much confusion each one causes.

### 3.1 — Double-clicking a palette patch edits a *region*, not the patch **(critical)**

Single-clicking a palette item sets `selectedRegion` to the first region
anywhere in the arrangement that uses it ([app.js:2229](web/static/app.js:2229)).
The second click calls `openPaletteInEditor()` ([app.js:7155](web/static/app.js:7155)),
which sets `editorMode = "patch"` but never clears that selection. And
`editorPatchSubject()` prefers the region whenever one is selected
([app.js:4515](web/static/app.js:4515)).

Result: you double-click "Warm Cello" in the Palette, the inspector opens on
*the first take of Warm Cello*, forks it, and your edits land in that take's
private copy. The palette patch is untouched. Meanwhile `openPaletteInEditor`
starts previewing the *palette* patch's audio — so you hear one thing and edit
another.

It only behaves correctly for a patch that has **no** regions placed. That is
why the same gesture appears to work sometimes.

### 3.2 — Opening the inspector on a take forks it, permanently and silently

`editorPatchSubject()` calls `ensureRegionPatchOverride()`
([app.js:4492](web/static/app.js:4492)), which deep-clones the palette params
into `region.paramsOverride` **on open**, before you have touched anything.
From then on `regionVoiceParams()` ([app.js:1929](web/static/app.js:1929))
reads the copy and the patch link is severed.

There is no revert: no code path anywhere deletes `paramsOverride`. There is no
marker on the region, the thread, or the palette row. The only signal is the
`Region-local edits` badge ([app.js:4778](web/static/app.js:4778)), which
appears immediately on open whether or not anything diverged, so it carries no
information.

### 3.3 — "Save to Palette" does not save to the palette

`data-patch-save-palette` is wired to `finishPatchSave`
([app.js:4922](web/static/app.js:4922) → [4916](web/static/app.js:4916)), which
sets `patchDirty = false`, recomputes `captureParts`, and calls
`saveArrangement()`. On a region subject `patch` **is the region** — no palette
entry is created or updated. The name field and the "Include" part selection
are read only by *Save to Library* ([app.js:4923](web/static/app.js:4923)).

So the exact feature you asked for — "changing a patch that's on a track should
make a new version in your palette" — exists as a button that does nothing.

### 3.4 — The thread's space dot moves only the base layer, and only sometimes

Verified by running the real module (`tmp/audit/spacecheck3.mjs`):

```
before: base:{"angle":0,"dist":2.5}   L2:{"angle":60,"dist":8}
after : base:{"angle":-70,"dist":9}   L2:{"angle":60,"dist":8}
```

`regionPlayParams` writes `track.space` into `params.spaceAzimuth/Distance`
([app.js:1962](web/static/app.js:1962)). In the unified param shape those are
non-enumerable accessors onto `layers[selectedLayerId]`
([params.js:236](web/static/params.js:236)) — i.e. **layer 1 only**. Layers 2+
and every percussion hit stay where they were.

Three inconsistencies stack on top of that:

- The dot is *drawn* at `_spTrackPos()`, which for a multi-layer patch returns
  the constellation **centroid** ([app.js:3136](web/static/app.js:3136)) — so
  the dot doesn't land where you dropped it.
- With Global space **on**, the same drag writes an anchor/static position and
  `spApplyThreadToPatch()` moves the **whole constellation**
  ([app.js:3094](web/static/app.js:3094)). Same control, opposite semantics.
- With Global space on and the thread anchored elsewhere, the drag silently
  snaps back ([app.js:8026](web/static/app.js:8026)).

### 3.5 — The one supersede warning that exists is wrong in both directions

`patchScaleHTML` ([app.js:4749](web/static/app.js:4749)) prints *"If this track
follows Harmonic guide, these patch-scale edits are stored but are not heard"*
for **every** region-scoped inspector — including threads with HG off (false
alarm) — and **never** for a palette patch, even though every HG thread using
that patch supersedes its scale (missing alarm).

### 3.6 — "baked notes stay put" is false across an EDO change

The HG button's tooltip promises baked notes are unaffected
([app.js:4412](web/static/app.js:4412)) and the code comment repeats it
([app.js:1946](web/static/app.js:1946)). But `renderNotesSpan` re-pitches every
stored note at schedule time via `scale.degreeToHz(degree)`
([synth.js:6062](web/static/synth.js:6062)), and that is
`tonicHz · 2^(degree/div)` ([synth.js:3587](web/static/synth.js:3587)).

Changing the *degree set* is safe. Changing `edoDivisions` — which a marker is
allowed to do ([app.js:1954](web/static/app.js:1954)) — re-pitches every baked
note on the thread. Also note HG markers carry no `degreeTuning`, so an
HG-following thread takes the marker's degrees while keeping the patch's
microtuning: a blend no part of the UI describes.

### 3.7 — Drop zones don't match modules, and invalid drops light up green

There are five capture parts but only three drop zones — `notes`, `space`,
`stave` ([app.js:4787](web/static/app.js:4787), [4792](web/static/app.js:4792),
[4798](web/static/app.js:4798)). Percussion and Scale have Library *route*
buttons but no drop target.

Worse, `pointerDragMove` adds `.drop-target` to whatever zone is under the
cursor without checking the item can supply that part
([app.js:6963](web/static/app.js:6963)). Drop a percussion kit on the Sub-note
pane: it highlights as a valid target, then `applyItemCapturePart` returns
`false` because the item has no `notes` part ([app.js:1807](web/static/app.js:1807))
and **nothing happens, with no message**. A scale module dropped on the Scale
card resolves to the enclosing `stave` zone and does the wrong thing.

### 3.8 — Percussion exists three times, in two different data models

1. Patch inspector **left** pane — `percLayers`, per-hit position/level/mute.
   Correct and current ([app.js:4731](web/static/app.js:4731)).
2. Patch inspector **right** pane — a module card with an on/off checkbox and a
   pencil ([app.js:4800](web/static/app.js:4800)). Pure duplication.
3. Studio macro page — `producerPercRowHTML` ([app.js:10588](web/static/app.js:10588)),
   still reading the **legacy** `percAzimuth` / `percBeatVol` / `percMotifVol`
   group model that percussion v2 replaced.

### 3.9 — Smaller, but each one costs trust

- **`spaceOwnHead` has no control.** It has a `PARAM_DESC` entry
  ([app.js:712](web/static/app.js:712)) and a live code path
  ([app.js:1977](web/static/app.js:1977)) — and no switch anywhere in the app.
  A patch cannot in fact keep its own room.
- **Palette edits reach some takes and not others, invisibly.** Un-forked takes
  follow live; forked ones don't. Nothing says which.
- **Editing a palette patch during playback doesn't update the voice.**
  `persist()` only calls `updateGenerationParams` for region subjects
  ([app.js:4889](web/static/app.js:4889)).
- **Vestigial tiers.** `track.instrumentParams` is reachable only via a
  dangling `paletteId` ([app.js:1932](web/static/app.js:1932));
  `arrangement.context.customDegrees` is written but never surfaced.
- **No test coverage.** `tests/js/` covers param shape and generation goldens;
  nothing asserts the resolution law. Every finding above is a silent
  regression risk.

---

## 4 · The paradigm question

### Where the DAW metaphor is actively hurting

**A "track" here is not a track.** In a DAW a track is a signal path that owns a
channel strip and is bound to one instrument. In this app the lane is a **thread
through space and time**: `_spTrackVoiceParams()` resolves the patch *at the
current beat* ([app.js:3020](web/static/app.js:3020)), and
`dropPaletteOnLane()` happily places a region from **any** palette patch onto
**any** lane ([app.js:6456](web/static/app.js:6456)) — `dropRegionOnLane` moves
regions between lanes with no instrument check at all
([app.js:6481](web/static/app.js:6481)), contrary to the V3 spec's own model.

So the thread is genuinely a *path*, and its head is drawn as a *channel strip*
— name, dB, M, S, gain fader, plus a space dot. That head duplicates the mixer
panel almost field for field ([app.js:5198](web/static/app.js:5198)) while
telling you nothing about the one thing only it can tell you: **which tier is in
charge of what, for this thread, right now.**

That is the root of "the hierarchy isn't understood". The interface has no
surface that answers it.

### Paradigms to keep, drop, or rename

| DAW paradigm | Verdict |
|---|---|
| Track → **Thread** | Rename. It is a path, not a bus. Kills the channel-strip framing that's causing the duplication. |
| Pan | Already correctly replaced by placement. Finish the job: distance *is* the loudness control, so label the fader "trim" and say so. |
| Buses / sends / inserts | Correctly absent. Effects are per layer; don't reintroduce. |
| Take lanes / comping | A take is a **seed**, not a recording. Comping is meaningless — but *seed history* is exactly a take lane, and surfacing it as one would land instantly. |
| Freeze / bounce | Bake already is this. Fine. |
| Automation lanes | Declared a non-goal in the V3 spec (§13) — yet Global space anchors are position automation and HG markers are scale automation. The app has two automation lanes and calls them something else. Admit it; name them **Global lanes**. |
| One instrument per track | **Not true here** and shouldn't be. A thread can carry several patches in sequence. The head must therefore describe the thread, not an instrument. |

---

## 5 · Recommendations

### 5.1 · State the law, in the UI, in one sentence per global

Put this in the strips panel, next to each global's toggle:

> **Global space** owns *Position* on every thread, and the *Listener & room* unless a patch opts out.
> **Harmonic guide** owns *Scale* on threads with HG on.

Nothing else is claimable by a global. Writing that down forbids the whole class
of future ambiguity.

### 5.2 · Three states, three treatments — everywhere a parameter appears

| State | Treatment |
|---|---|
| **Own** | Normal. |
| **Superseded** | Control greyed but *readable*, showing **the value that is actually winning**, with a chip naming the owner (`HG`, `GLOBAL SPACE`, `TAKE`). Clicking the chip jumps to the owner. Editing is still allowed; the field then reads "stored — not heard". |
| **Diverged** | Where a lower tier has forked a higher one, the lower shows a filled `●` and the higher shows "*3 takes differ*" with a click-through list. |

The `●` / `○` glyph is already specified for stage placement in the V3 spec
(M6) — generalise it to all five modules and it becomes a system rather than a
one-off. Never hide a superseded control, and never let a control accept input
that is silently discarded without saying so.

Fix §3.5 as the first instance: make the note conditional on
`track.useGlobalScale`, and show it on palette patches as "*superseded on 2 of 3
threads*".

> **Built 2026-07-28.** §5.3 below records the design as agreed with the owner
> and shipped. The resolution law now lives in
> [web/static/producer-resolve.js](web/static/producer-resolve.js) (DOM-free, so
> it is asserted headlessly by
> [tests/js/producer-hierarchy.test.js](tests/js/producer-hierarchy.test.js));
> module slicing lives in `extractModule` / `applyModule` in
> [web/static/params.js](web/static/params.js).

### 5.3 · Palette / In-use split + real versioning

Exactly as you described, and it also fixes §3.1–§3.3:

```
PALETTE                     patches available to place
  Warm Cello                ◫ ≋ ✦
  Warm Cello v2             ◫ ≋ ✦        ← auto-forked, 2026-07-28

IN THIS ARRANGEMENT         patches with takes on threads
  Warm Cello      3 takes   ● 1 diverged
  Kalimba Drift   1 take
```

As built:

- Overrides are **per module**, not whole-patch. Editing the engine of a take
  leaves its sound, space, scale and percussion following the patch — which is
  what lets one sound edit reach every take at once, baked ones included.
- **Fork on edit, not on open.** The inspector edits a resolved working copy;
  each control records only the module it touched, and a module edited back to
  the patch's value stops being an override at all.
- Edits land on the take immediately and a **staging strip** appears under the
  parent row: *Keep as variant · Apply to all N · Revert*. Doing nothing leaves
  it take-local — a legitimate resting state, marked `●` on the take count.
- Variants are **flat**: a variant's parent is always a root patch, so the rack
  is two levels deep however long you work. Labels are generated from the diff
  (`walk engine + Pentatonic major`), never `v2`.
- A variant identical to its parent **dissolves** and its takes re-point.
- "Apply to all" skips takes holding their own edit of that module, and says so
  rather than silently not-happening.
- "Save to Palette" actually creates the entry, honouring the name field and the
  Include selection.
- The double-click routing is fixed: `openPaletteInEditor` clears the selection,
  and the single-click "select the first region using this patch" behaviour is
  gone — it was the direct cause of §3.1.

Deferred deliberately: duplicate-variant merging (§ "the weakest of the five
rules" — it only fires on Library swaps), and retiring `track.instrumentParams`
(still load-bearing for v1 migration, factory sessions and MIDI arm).

### 5.4 · Thread head → a hierarchy readout

Replace the mini channel strip (which the mixer already provides) with the one
thing only this surface can show:

```
┌────────────────────────────┐
│ ● Cello thread      3 takes│   identity + what's on it
│ ◫ ≋ ⌾ ♪ ⊙                  │   five module glyphs, each in one of three states
│ M  S   ──────gain──── −2dB │   trim only; placement lives in the ⌾ glyph
└────────────────────────────┘
```

- Each glyph: **patch hue** = the patch owns it; **grey + owner initial** =
  superseded (`G` global space, `H` harmonic guide); **filled dot** = a take on
  this thread has diverged.
- The `HG` button disappears — the Scale glyph's superseded state *is* HG being
  on, and clicking it toggles.
- The space dot disappears into the Space glyph — one control, one meaning, and
  §3.4 gets fixed as part of the move (drag must transform the whole
  constellation through `spTransformSources`, identically whether or not Global
  space is on).
- Hovering any glyph gives the full chain for that module on that thread:
  `Scale · patch "Dorian Drift" → superseded by Harmonic guide @ bar 17`.

Twelve threads then read as a matrix of who-owns-what — which is the audit you
are currently doing in your head.

### 5.5 · The right pane: give the note engine quick settings

The pane is empty because the useful dials all live behind a round trip to the
Studio. The four that change what you hear most and are safe to vary *per take*:

- **Grid** (`beatDivisions`) — already shown, make it editable
- **Density** — one dial driving `onBeatProb`/`offBeatProb` together
- **Motif length** (`motifLengthBeats`) — it already draws the region's tick marks
- **Surprise ✦** (`surpriseProb`) — with the P·T·R·F·D dimension chips inline

Keep the badge row as the read-only truth. This is also the natural home for
"vary this take without touching the patch", which makes the fork *intentional*
instead of accidental.

### 5.6 · Percussion: one home, with drag-and-drop

- Delete the right-pane percussion card (§3.8 item 2).
- Give the left pane's `Percussion` group header the Library route icon and a
  real `data-patch-drop="percussion"` zone.
- Add a `clef` drop zone on the Scale card while you're there.
- Validate drop targets before highlighting: `pointerDragMove` should only add
  `.drop-target` when `item.captureParts[zone.part]` is true, and show a
  "no ✦ in this item" cursor otherwise (§3.7).
- Retire `producerPercRowHTML`'s legacy model (§3.8 item 3).

### 5.7 · Lock it down with tests

`tests/js/` has no coverage of the resolution law. Add
`producer-hierarchy.test.js` asserting, headlessly, that:

- a take with no override follows its palette patch; with one, it doesn't
- HG supersedes `clef` **only** on `useGlobalScale` threads
- a thread drag moves *every* source in the constellation, with Global space on
  and off, to the same result
- global head supersedes patch reverb unless `spaceOwnHead`
- baked degrees survive a degree-set change and are re-pitched by an EDO change
  (assert the real behaviour, then fix the tooltip to match)

---

## 6 · Suggested build order

1. **§3.1 + §3.2 + §3.3** — the fork/versioning trio. One coherent change; it is
   the bulk of the confusion and delivers the palette split you asked for.
2. **§5.2** — the three-state supersede treatment, applied first to Scale
   (fixes §3.5) and Space.
3. **§3.4** — one placement law for the thread dot, whatever the global state.
4. **§5.4** — thread head as hierarchy readout.
5. **§5.6 + §5.5** — percussion de-duplication, drop-zone validation, note-engine dials.
6. **§3.6, §3.9** — tooltip truth, `spaceOwnHead` control, vestigial tiers.
7. **§5.7** — tests, so none of it silently regresses again.
