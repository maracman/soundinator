# Layout Redesign Proposal — Intuitive Groupings, Nestings & a Unified Preset Browser

Status: proposal for owner review · 2026-07-07
Scope: layout, grouping, tab structure, visibility, and the preset system ONLY.
No engine, audio, or generation-semantics changes. Builds on owner-chosen
directions that are treated as fixed: the FabFilter design language
(docs/UI_DIRECTION.md), the CHORDA four-stage rail EXCITOR→RESONATOR→BODY→SPACE
with the tone print as the central truth display, and the 2026-07-07 brief
(docs/OWNER_BRIEF_2026-07-07.md).

---

## 1. TL;DR

1. **One preset system, one browser, everywhere.** Factory ("Starters"), user,
   and community presets merge into a single **Preset Browser** with source
   badges and ratings on every row. It renders in two containers from one
   component: a **centered overlay** (studio views — the owner's instinct is
   right there) and a **docked left panel** (Producer — where drag-to-timeline
   requires the browser and the timeline to be visible at once, so an overlay
   would be wrong). Every current save/load surface — the top-bar
   name+section+SAVE+rating strip, the five per-card "X presets…" bars, the
   bottom library card, the instrument-save button — collapses into this one
   system plus a single **Save dialog**.

2. **Delete the bottom library card and reclaim its 155 px row.** The
   workspace grows from ~434 px to ~612 px tall (+41%). This single move
   dissolves most of the reported crowding symptoms (crammed envelope,
   crowded layers, half-empty columns): they were rationing artifacts of a
   workspace squeezed between a 148 px hero and a 155 px always-on library.

3. **A consistent card anatomy** across every panel: `LABEL · [◧ presets ▾]
   chip · body`, and inside every Macro Probability tab the same four
   sub-panel order — **Generation → Accuracy → Surprise → Register/Monitor** —
   so the four tabs read as four instances of one idea instead of four
   hand-made screens. This is the systemic fix behind "controls misaligned".

4. **The app bar becomes a real transport bar** (38 px, unchanged height):
   view tabs left, transport centre-left, a **current-preset chip** (name +
   dirty dot) centre-right, and exactly two buttons on the right — `Presets`
   (opens the browser, ⌘P) and `Save` (opens the Save dialog, ⌘S). Rating
   moves into the Save dialog and browser rows; the seed field stays with
   transport (it is a playback control, not a preset control).

5. **Keep the fixed 1440×790 scaled canvas** (with an explicit rationale and
   one escape hatch for Producer later). Keep the three-view structure.
   Sub-note keeps rail + inspector + tone print exactly as designed; the
   layer-editing state gets a hue-tinted frame instead of a banner. Producer
   keeps its skeleton; the pinned strips get permanent labelled headers so
   collapse state is never ambiguous.

6. **Nine-step migration plan**, each step shippable and testable on its own,
   ordered so the data model unifies before any UI is deleted.

---

## 2. The systemic diagnosis (why the symptoms happened)

The owner-reported pain points ("envelope crammed", "advanced half-empty",
"layers crowded", "preset saving scattered", "strips collapse confusion",
"controls misaligned") share three root causes:

**R1 — Space rationing.** The studio grid reserves 148 px for the hero and
155 px for a library card that is irrelevant during 95% of sound-design time.
Everything else fights over ~434 px. Each fight was settled locally (cram the
envelope, cap the layers band, orphan a column), producing globally
inconsistent density. Fix: reclaim the library row; slim the hero to 128 px.

**R2 — The preset system grew by accretion, not design.** Six save/load
surfaces exist because each round of feedback patched presets *where the
complaint was*: the top bar (full rigs), five panel bars (sections), the
library card (browse + community), the instrument button (voices), the
producer browser (arranging), the contribute box (sharing). Each has its own
naming ("Starters"/"Library"/"My Presets"), its own save affordance
(`prompt()` vs input field), and only one shows ratings. Fix: one data model,
one browser component, one save dialog; delete the rest.

**R3 — No shared card anatomy.** Cards were designed one at a time, so
identical concepts (Accuracy, Surprise) appear at different positions with
different orderings across the four Macro tabs, preset bars sit at different
depths, and monitors are sometimes beside, sometimes below the controls.
Fix: a single card contract (§4.2) applied everywhere.

A note on vocabulary (aligns with P9 in the owner brief): this proposal
standardises on **Preset** (any saved thing), **Scope** (what it captures:
*Full rig*, one of seven *Sections*, or *Instrument* — a voice), and
**Source** (*Factory*, *Mine*, *Community*). "Starters", "Library",
"Shared library", "My presets" all disappear as UI words.

---

## 3. Core journeys → what must be visible at once

| # | Journey | Simultaneously visible (non-negotiable) | On demand (tab/drawer/overlay) |
|---|---------|------------------------------------------|-------------------------------|
| J1 | **Design a sound** (Sub-note) | Tone print · selected stage inspector · envelope · f₀/profile header · transport | Other three stages (rail cards), layers band, advanced shaping, performance drawer, preset browser |
| J2 | **Shape behaviour** (Macro) | Scale circle · ONE probability domain's controls *and its monitor side-by-side* · sequence/surprise card · hero visual | Other three probability domains (tabs), percussion, output detail, preset browser |
| J3 | **Arrange** (Producer) | Timeline + ruler + track heads · transport/toolbar · region toolbar when a region is selected · **the browser panel while dragging presets in** | Palette detail, global strips (expanded), roll drawer, per-note drill-down |
| J4 | **Audition, rate & choose** (musician *and* researcher) | Preset rows with name, scope, source, description, **rating** · preview control · the sound keeps playing | Everything else — this is a mode, which is exactly why an overlay fits in studio views |
| J5 | **Tune / research provenance** | Seed (transport), engine stats (hero) | Ratings history, sharing consent (Save dialog); research identifiers stay non-user-facing |

Two derived rules used throughout:

- **A monitor never lives behind a different tab than its controls.** (Already
  true in Macro tabs; the redesign keeps controls-left / monitor-right within
  each tab and makes the split ratio identical across tabs.)
- **Anything you drag *into* another surface must coexist with that surface.**
  This is the one hard argument that decides overlay vs docked per view (§6.3).

---

## 4. The global frame

### 4.1 Keep the fixed 1440×790 scaled canvas — with reasons and one hatch

**Recommendation: keep it.** Honest evaluation:

*For keeping:* (a) every canvas visual (tone print, scale circle, cylinder,
distribution monitors) is tuned to fixed proportions; a fluid layout re-opens
all of them. (b) Research stimuli benefit from pixel-identical presentation
across participants' machines. (c) The "plugin" identity is an owner-chosen
aesthetic (FabFilter direction). (d) The capstone QA requirement ("a resized
window never hides sections") is trivially satisfied by uniform scaling.

*Against keeping:* (a) Producer is the one view that genuinely wants more
vertical room for many tracks — DAWs are the one software genre where fixed
plugin canvases feel wrong. (b) On very wide monitors the scale-up softens
text slightly.

**Verdict:** keep 1440×790 everywhere for this redesign. Log a **Producer
full-height mode** (canvas keeps 1440 logical width, height becomes
viewport-proportional, timeline gets the extra rows) as a post-migration
option — it only touches the Producer grid, not the studio views. Do not do
it in the same change set as this redesign.

### 4.2 The shared card contract (fixes "controls misaligned")

Every card in every view follows one anatomy:

```
┌─ CARD ────────────────────────────────────────────────┐
│ SECTION-LABEL (10px caps)          [◧ presets ▾]      │  ← header line, 22px
│ ── optional one-line micro-note ──                    │
│ [subhead] controls-grid (label 110px | slider | 46px  │
│           monospace readout — SAME column widths      │
│           across the whole app)                       │
│ [monitor canvas, if any, right-aligned or full-width] │
└───────────────────────────────────────────────────────┘
```

- The `[◧ presets ▾]` chip is the ONLY per-card preset affordance (§6.5). It
  appears on exactly the cards that map to a preset Scope: Scale & Root
  (melody), Duration tab (rhythm), Dynamics tab (dynamics), Sequence &
  Surprise (surprise), Percussion (percussion), and the Sub-note header
  (sound / instrument).
- Control rows use one grid app-wide: `110px label | 1fr slider | 46px value`.
  Today `.control-row` already exists; the fix is auditing the stragglers that
  hand-roll their own rows (world-tunings row, edo row, ch-mix, etc.) onto it.

### 4.3 The app bar (row 1, 38 px — replaces the transport card)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ MACRO │ SUB-NOTE │ PRODUCER ║ ▶ ■  ↻restart  ⚄randomise  seed[42137]  ♩120 ║          │
│                             ║        « Warm Gamelan Walk • »  [Presets ⌘P] [Save ⌘S] │
└──────────────────────────────────────────────────────────────────────────────────────┘
  view tabs (left)              transport cluster (centre-left)      preset cluster (right)
```

- **View tabs** left, unchanged behaviour.
- **Transport cluster**: play/stop, restart-seq, randomise, seed field, tempo
  (compact drag-number; hidden in Producer, which has its own toolbar tempo).
  Randomise gets an icon+word (it is destructive-ish and popular; do not
  bury it).
- **Preset cluster** (right): the **current-preset chip** shows the loaded
  preset's name with a `•` dirty dot once any parameter diverges; clicking it
  opens the browser scrolled to that preset. `Presets` opens the browser
  (⌘P / Ctrl-P). `Save` opens the Save dialog (⌘S) — Save with an unmodified
  loaded user preset offers "Update 'name'" as the primary action.
- **Deleted from the top bar:** preset name input, section dropdown, rating
  slider + readout, `My Presets`, `Library`. All absorbed by the browser and
  Save dialog (§6). The bar stops being three UIs sharing 38 px.

### 4.4 The hero visual (row 2, slimmed 148 → 128 px)

Unchanged in content: Spec/Motif/Roll switch (vertical buttons at right edge),
surprise-event flash, engine stats. Stats move **into** the canvas footer line
(monospace, bottom-right) instead of a separate `engine-state` row — that row
is where 20 px of the reclaimed height comes from. Hero stays visible in Macro
and Sub-note; Producer already replaces it with the timeline (correct — the
timeline IS its hero).

### 4.5 Row plan (studio views)

```
790 total, 3px outer padding & gutters
  38  app bar
 128  hero visual
 612  workspace  (was ~434 — the +41% that pays for everything below)
```

The 155 px library row is deleted (§6). The output card leaves the frame and
docks inside the Macro STRUCTURE column (§5.1) — Sub-note and Producer have
their own metering contexts (Sub-note: none needed beyond the hero; Producer:
track meters).

---

## 5. Per-view layouts

### 5.1 MACRO — "how the instrument behaves"

Three columns inside the 612 px workspace, left→right = pitch → note
behaviour → structure. This mirrors the mental model: *what notes are legal*
→ *how each note is chosen* → *how notes chain into sequences and dressing*.

```
┌ PITCH & SCALE 330px ┐ ┌ NOTE BEHAVIOUR ~660px ──────────────────┐ ┌ STRUCTURE ~430px ────────┐
│ SCALE & ROOT  [◧▾] │ │ MACRO PROBABILITY                        │ │ SEQUENCE & SURPRISE [◧▾] │
│ 12-tone | N-EDO    │ │ ┌Melody┬Tuning┬Duration┬Dynamics┐        │ │ Sequence                 │
│ Preset ▾ World ▾   │ │ │ (tab strip, top of card)      │        │ │  motif states / loop len │
│                    │ │ ├───────────────┬───────────────┤        │ │  order bias / mutation   │
│    ◯ SCALE CIRCLE  │ │ │ CONTROLS 55%  │ MONITOR 45%   │        │ │ Surprise                 │
│   (≈250px, click   │ │ │ Generation    │ live histogram│        │ │  chance / incorporation  │
│    cycles, drag =  │ │ │ Accuracy      │ + tab-specific│        │ │  max incorporated ▾      │
│    cents, dblclick │ │ │ Surprise      │ extras (e.g.  │        │ │  ☐ multiple features/note│
│    resets)         │ │ │ Register /    │ Note connect- │        │ │ Feature weights (6 rows: │
│ legend ····        │ │ │  Loudness reg │ ion diagram)  │        │ │  pitch tuning rhythm     │
│ Root Pull          │ │ └───────────────┴───────────────┘        │ │  formant dynamics rest — │
│  sub-scale weight  │ │  identical sub-panel ORDER in all four   │ │  weight+distance pairs)  │
│  root pull         │ │  tabs: Generation → Accuracy → Surprise  │ ├──────────────────────────┤
│  pull shape        │ │  → Register; absent groups are omitted,  │ │ PERCUSSION [◧▾]  (35%)   │
│ [root-pull canvas] │ │  never reordered                         │ │ Beat/Motif/Downbeat rows │
└────────────────────┘ └──────────────────────────────────────────┘ │ (sound ▾ + vol each)     │
                                                                    │ downbeat every [n]       │
                                                                    ├──────────────────────────┤
                                                                    │ OUTPUT (compact, 70px)   │
                                                                    │ L/R meters · master · lim│
                                                                    └──────────────────────────┘
```

Decisions, card by card:

- **Scale & Root** keeps everything it has; the melody `[◧ presets ▾]` chip
  replaces its inline preset bar. The scale circle grows to ~250 px (it is the
  view's signature interaction and was cramped). The world-tunings select
  moves onto the same row as the scale-preset select (they are alternatives,
  not a hierarchy): `Preset ▾ · World ▾`.
- **Macro Probability** keeps its four tabs — four domains genuinely never
  need simultaneous editing (J2), and the shared Accuracy/Surprise pattern
  makes tab-switching cheap once the ordering is standardised. Changes:
  - **Fixed sub-panel order in every tab: Generation → Accuracy → Surprise →
    Register.** Melody: pattern segment (Walk/Arp↑/Arp↓/Arp↕) + walk/arp
    params = Generation; Register (+8va buttons, mini canvas) closes the
    column. Tuning has only Accuracy + Surprise — same order, gaps omitted.
    Duration: beat divisions / note-length / onset / rests = Generation.
    Dynamics: variability = Generation; Loudness Register mirrors melody's
    Register slot. This is the "misaligned controls" fix at the pattern level,
    not the pixel level.
  - **Monitor column is always the right 45%** of the card, top-aligned with
    the controls, one histogram style. Duration's **Breaks & Slides** content
    is renamed **NOTE CONNECTION** (per owner P3: glide-vs-ring lives here)
    and stacks under the duration histogram in the monitor column with its
    illustrated gap/overlap diagram — it is diagram-led, so it belongs on the
    display side.
  - The Duration tab hosts the rhythm `[◧▾]` chip; Dynamics hosts the
    dynamics chip — chips sit in the tab strip's right end, swapping with the
    active tab so scope is unambiguous.
- **Sequence & Surprise** is unchanged in content (it already reads well);
  the per-feature weight+distance sliders render as a compact 6-row,
  2-slider-per-row grid under a "Feature weights" subhead. Chip: surprise.
- **Percussion** compresses to three one-line layer rows (sound ▾ + volume
  slider each) + downbeat-every. The "playback dressing only" micro-note
  stays. Chip: percussion.
- **Output** docks at the bottom of the structure column, 70 px compact:
  horizontal L/R meters, master as a horizontal fader, limiter toggle. It
  loses its own card row; master level is a set-and-forget control and does
  not merit 155-px-row real estate.
- **Bottom strip**: the palette-edit banner (Save to palette / Save as copy /
  Discard) becomes a hue-tinted **frame** around the whole canvas + a slim
  32 px docked bar under the app bar when editing a producer instrument —
  same treatment as sub-note layer editing (§5.2), so "you are editing a
  thing that lives elsewhere" is one consistent visual grammar app-wide. The
  research-sharing note moves into the Save dialog (it is about sharing, and
  that is where sharing happens).

### 5.2 SUB-NOTE — CHORDA tone designer

The owner-chosen skeleton is right; with +178 px of height the crowding
resolves without restructuring. Kept identical: the rail of four stage cards
with thumbnails, the resizable inspector, the tone print as the one truth
display (FOCUS chips, draggable stems, LENS, strip), envelope in the right
column, advanced shaping as its drawer.

```
612px workspace:
┌ header 44px ─────────────────────────────────────────────────────────────────┐
│ TONE DESIGNER  Violin ▾  mix ──○──   f₀ 261.6Hz · C4 · 20 partials  [◧ sounds ▾] │
├ rail 78px ────────────────────────────────────────────────────────────────────┤
│ [01 EXCITOR ▓thumb] › [02 RESONATOR ▓] › [03 BODY ▓] › [04 SPACE ▓]           │
├ main 424px ┬──────────────────────────────────────────────┬ right col 300px ──┤
│ INSPECTOR  │  FOCUS  All Odd Even Coupled Longring Wobbly │ ENVELOPE          │
│ (selected  │  ┌────────────────────────────────────────┐  │  variation chance │
│  stage,    │  │        TONE PRINT (truth canvas)       │  │  A/D/S/R mean+SD  │
│  resizable │  │   drag stem=level · click=pin readout  │  │  [draggable ADSR] │
│  300–420px)│  └────────────────────────────────────────┘  │ ──────────────    │
│            │  LENS ═══════ brush ═══════                  │ ▸ ADVANCED SHAPING│
│            │  strip ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪              │   (drawer: odd/   │
│            │                                              │   even, comb, six │
│            │                                              │   octave groups)  │
├ status 20px┴──────────────────────────────────────────────┴───────────────────┤
├ LAYERS band: collapsed 26px header  ▸ LAYERS (3) · sync-variation ●            │
│              expanded 165px (pushes main up): ＋add · rows · sync panel        │
└────────────────────────────────────────────────────────────────────────────────┘
```

Changes (all layout/affordance, no control moves beyond these):

- **Layers band gets an explicit, labelled, two-state header** (26 px
  collapsed: "▸ LAYERS (3) · sync ●"), persisted per user. Expanding
  **pushes** the main row up (tone print scales; it is a canvas) rather than
  overlaying — overlap was the "layers crowded editors" complaint. With
  612 px total, expanded layers still leave the main row ~283 px, more than
  the *entire* old arrangement had.
- **Layer editing mode**: clicking a layer row still loads it into the whole
  editor, but the signal becomes the layer's **hue as a 2 px frame around the
  workspace** + the header title swaps to "EDITING LAYER 2 — [Done]". The old
  banner line is deleted. Same grammar as producer palette-editing (§5.1).
- **The header's profile select stays** (it is a synthesis starting point,
  not a preset load — it feeds `spectralProfile`), but gains a companion
  `[◧ sounds ▾]` chip on the far right: the preset chip scoped to
  **Instrument** (voices) + **Sound source** section presets. "Save current
  voice as instrument" (today buried in the library card's Instruments tab)
  becomes an action inside this chip's popover and the Save dialog scope.
- **Performance drawer stays inside EXCITOR** (owner-chosen CH-B2); no move.
- **SPACE inspector unchanged** (full-circle pad, own-head checkbox) — P7/P8
  own its semantics.
- Right column: with the extra height, Envelope gets its natural size
  (ADSR editor ~150 px tall) and Advanced shaping opens without scrolling.
  Nothing else is added to the column — resist the temptation to fill it;
  half-empty beats crammed, and the drawer pattern already absorbs overflow.

### 5.3 PRODUCER — timeline arranger

Skeleton kept: toolbar / left panel / pinned strips / timeline / region
toolbar / roll drawer. Producer's whole 790 px belongs to it (no hero).

```
┌ toolbar 40px ──────────────────────────────────────────────────────────────────┐
│ ◂back  Arrangement ▾ +new ✎ ✕ ║ ▶ ■ ⟲loop  12.3 ♩120 Key C ▾ ║ ↩ zoom−○+ snap ▾ │
│                                                    ║ WAV · Export · Import · MIDI ▾ │
├ left 280px (resizable 220–380) ─┬ main ────────────────────────────────────────┤
│ ┌ PRESET BROWSER (docked, same │ ┌ GLOBAL SCALE ── ▸ header 22px, always ─────┐│
│ │  component as overlay,      │ │   expanded 84px: piano-roll-over-time,     ││
│ │  compact density)           │ │   change-point lines, cell editor          ││
│ │ [search────────]            │ ├ GLOBAL SPACE ── ▸ header 22px, always ─────┤│
│ │ All·Factory·Mine·Community  │ │   expanded 110px: cross-section + cylinder ││
│ │ scope chips · splits ▾      │ ├ ruler: bars · loop drag · playhead · ＋8 ──┤│
│ │ rows: name·kind·★4.6·▶·＋   │ │ track heads │ lanes with regions           ││
│ │ (drag row → timeline)       │ │ (two-row:   │ (name·seed chip·badges·gain  ││
│ ├ PALETTE ────────────────────┤ │  hue·name·  │  tag·resize; drag/copy/split)││
│ │ instrument cards: badges,   │ │  dB·✕/M·S·G │                              ││
│ │  ✎ edit · ＋track · ⏱ ·     │ │  ·●rec·gain │ [new-track drop lane]        ││
│ │  MACRO|BOTH|SUB-NOTE armed  │ │  ·pan)      │                              ││
│ └─────────────────────────────┘ └─────────────┴──────────────────────────────┘│
├ region toolbar (pinned) 34px: ▶loop ◆bake ✎notes ↻reroll ✂split mute level →studio ✕ │
└ (roll drawer slides over lower half when a baked region is opened)             │
```

Changes:

- **The BROWSER panel becomes the docked Preset Browser** — same component,
  data, filters, and row anatomy as the overlay (§6), compact density
  (28 px rows). This is the view where **docked beats overlay**, because rows
  are dragged onto the timeline and onto palette cards; an overlay would have
  to be dismissed mid-drag. Ratings become visible here for the first time
  (`★4.6` community / `●●●●○○○ 4/7` own) — directly satisfying "ratings
  visible… in multiple parts of the interface".
- **Pinned strips get permanent 22 px labelled headers** that never disappear:
  `▸ GLOBAL SCALE  [enable ○]` / `▸ GLOBAL SPACE  [enable ○]`. The chevron
  rotates; the header row is identical whether collapsed or expanded; the
  enable toggle lives in the header in BOTH states. This kills the "strips
  collapse confusion": today the collapsed state is a bare chevron whose
  meaning depends on remembering what was there. Collapsed total: 44 px.
- **Toolbar groups into three clusters** with hairline separators —
  *arrangement* (back, select, new/rename/delete), *transport* (play/stop,
  loop, position, tempo, key, undo), *canvas & I/O* (zoom, snap, WAV/Export/
  Import, MIDI). Today's single row of 15 controls has no rhythm; three
  clusters give it one without moving anything off the bar.
- **Region toolbar and multi-select bulk bar unchanged** (recent, working).
  Roll drawer + per-note drill-down unchanged (P6 owns their evolution).
- **First-visit tour** gains one step: "this panel is the same Preset Browser
  as ⌘P in the studio".

---

## 6. The Unified Preset Browser

### 6.1 One data model

Every saved thing becomes a `PresetEntry`:

```
{ id, name, description?, family?,           // percussive|bass|atmos|melody
  scope,      // 'full' | section key (melody|rhythm|dynamics|surprise|percussion|space|sound) | 'instrument'
  source,     // 'factory' | 'user' | 'community'
  rating,     // own 1–7 (editable inline)
  communityRating?, communityCount?,         // community rows only
  parameters, badges (splits, grid, tempo, surprise dims — P4), app_version, created_at }
```

Factory presets, `loadPresets()` user entries, `loadInstruments()` voices, and
the shared-library fetch all normalise into this shape behind one registry
module. (Note: `PRESET_SECTIONS` still contains the legacy `sound` key even
though the Sound Source box was deleted — it survives as a legitimate scope:
"tone only, no behaviour", saved from the Sub-note chip.)

### 6.2 The browser (one component, two containers)

```
OVERLAY (studio views) — 1160×620 centred in the canvas, scrim over the plugin
┌──────────────────────────────────────────────────────────────────────────┐
│ PRESETS      [search…………………]  All·Factory·Mine·Community   Sort: Rating ▾│
├ facet rail 200px ┬ list ────────────────────────────────────────────────┤
│ SCOPE            │ ▶ Warm Gamelan Walk   FULL  melody-fam   ●●●●●○○ 5/7 │
│  ● All           │    "slendro walk, gentle surprise"  [Load] [⋯]       │
│  ○ Full rigs     │ ▶ Tight Kit Rhythm    RHYTHM              ●●●●●●○ 6/7│
│  ○ Instruments   │ ▶ Cathedral Voice     INSTR  atmos  ★4.6(23) COMMUNITY│
│  ○ Melody & scale│    "airy blown voice…"  [Load] [⋯]                    │
│  ○ Rhythm & rests│   …                                                   │
│  ○ Dynamics      │                                                       │
│  ○ Seq & surprise│                                                       │
│  ○ Percussion    │                                                       │
│  ○ Space         │                                                       │
│  ○ Sound source  │                                                       │
│ FAMILY chips     │                                                       │
│ SPLITS ▾         │                                                       │
├──────────────────┴───────────────────────────────────────────────────────┤
│ preview keeps the engine playing · Esc closes      [＋ Save current… ⌘S] │
└──────────────────────────────────────────────────────────────────────────┘
```

Row anatomy (identical in both containers, density differs):
`▶ preview · name · SCOPE chip · family tag · source badge · description
(one line, truncated) · rating · [Load] · [⋯]` where `⋯` = rename, duplicate,
edit description, **Share to community** (with consent text — replaces the
contribute box), delete (user rows only). Own rating is seven tap-targets
(dots), editable inline right in the row — rating a preset should never
require a save round-trip.

Behaviour:

- **Preview** (▶) auditions non-destructively via the existing
  `startPresetPreview` machinery: the engine plays the merged params, the ▶
  becomes ■, and closing the browser or pressing ■ reverts to the working
  state (`endPresetPreview`). **Load** commits. This distinction is the core
  of J4 and already half-built — the browser just gives it one home.
- **Sort:** Rating (default) / Newest / Name / Most used. Community rows sort
  by community average within the same list; a source badge disambiguates.
- **Filters compose:** source segment × scope facet × family chips × splits ▾
  × search. Opening from a card chip (§6.5) pre-applies the scope facet.
- **Keyboard:** ⌘P toggles, type-to-search, ↑↓ move, Space previews, Enter
  loads, Esc closes (ending preview).

### 6.3 Overlay vs docked — the honest evaluation

The owner suspects an overlay. Verdict: **overlay in Macro and Sub-note,
docked in Producer** — decided by the drag rule from §3, not by taste.

*Overlay pros (studio):* browsing is a deliberate mode-switch ("what else is
there?"), not a parallel activity; the studio screen is fully contended (J1/J2
need every pixel); an overlay can afford full row anatomy — descriptions and
ratings visible, the owner's stated requirement; audio continuing under the
scrim preserves auditioning context. *Overlay cons:* you cannot tweak a knob
while comparing two presets (mitigated: preview/revert is faster than
tweak-while-browsing, and Esc is one key); slight modality cost (mitigated:
non-blocking — transport keeps running, Esc always works, no nested modals).

*Docked pros (producer):* drag-to-timeline and drop-onto-palette-card demand
coexistence; arranging *is* a browse-heavy activity where the list is a
peer of the timeline, like every DAW's browser. *Docked cons in studio:* would
permanently tax the workspace we just reclaimed — rejected.

One component, two densities, zero duplicated logic: the 10k-line file today
has four separate preset-list renderers (`renderPresetList`, the producer
browser, panel bars, instrument tab); this consolidation is also a code-health
win.

### 6.4 The Save dialog (one, app-wide, ⌘S)

```
┌ SAVE PRESET ────────────────────────────────────┐
│ Name        [Warm Gamelan Walk……………]            │
│ Scope       [Everything ▾]   ← prefilled from    │
│              context (card chip → that section;  │
│              sub-note chip → Instrument)         │
│ Family      ( Percussive Bass Atmos Melody — )   │
│ Description [optional, one or two lines……]       │
│ Your rating ●●●●●○○  5/7                         │
│ ☐ Share to the community library                 │
│    (consent text + research-sharing note here)   │
│              [Update "Warm Gamelan Walk"] [Save as new] │
└──────────────────────────────────────────────────┘
```

Replaces: the top-bar name+section+SAVE+rating strip, every `prompt()`-based
section save, the instrument-save button, and the contribute-consent box.
Rating is captured **at save time and editable any time in a row** — the two
moments it is meaningful. The research-sharing note renders under the share
checkbox, where it is actually relevant.

### 6.5 The per-card preset chip (what replaces the five section bars)

Every scoped card header carries `[◧ presets ▾]`. Clicking opens a **small
anchored popover**, not the full overlay:

```
┌ MELODY & SCALE PRESETS ──────────────┐
│ ▶ Slendro base          ●●●●●○○ [Load]│
│ ▶ Maqam rast            ●●●●○○○ [Load]│
│ ▶ My pentatonic drift   ●●●●●●○ [Load]│   ← 5 most recent/top-rated, scoped
│ ──────────────────────────────────── │
│ Browse all melody presets…  (→ overlay, pre-filtered)
│ ＋ Save current melody settings…  (→ Save dialog, scope prefilled)
└───────────────────────────────────────┘
```

This keeps the owner's earlier, still-correct instinct — "presets live where
the controls live" — while removing the five inconsistent `select` bars and
their `prompt()` saves. One-click section loading survives (the popover's
top rows); the full browse is two clicks with context carried along.
Section loads keep today's merge semantics (`mergedPresetParams`: section
presets merge over the current state; full rigs replace).

### 6.6 What gets deleted (explicit list)

| Deleted surface | Absorbed by |
|---|---|
| Top-bar preset name input + scope dropdown + SAVE | Save dialog (⌘S) |
| Top-bar rating slider + `x/7` output | Save dialog + inline row rating |
| Top-bar `My Presets`, `Library` buttons | one `Presets` button (⌘P) |
| Five `panelPresetBarHTML` bars (Scale, Duration, Dynamics, Sequence, Percussion) | per-card `[◧ presets ▾]` chips |
| Bottom library card (tabs Starters/My/Instruments/Shared + filter chips + 155 px row) | overlay browser; the row's space returns to the workspace |
| `Save current voice as instrument` button (library card) | Save dialog, scope = Instrument, reachable from the Sub-note header chip |
| Contribute box + consent checkbox (`#contributeArea`) | Share action in Save dialog and row `⋯` menu |
| Producer browser's bespoke renderer | docked instance of the shared component (UI looks similar; code unifies) |

---

## 7. Control-by-control mapping (old home → new home)

Legend: **unchanged** = same place, possibly re-styled to the card contract.

### Transport / app frame

| Control | Old home | New home |
|---|---|---|
| Macro / Sub-note / Producer tabs | workspace tabs row | app bar, left — unchanged |
| Play / Stop | transport card | app bar transport cluster |
| Randomise, Restart seq | transport card | app bar transport cluster |
| Seed field | transport card | app bar transport cluster |
| Tempo (studio) | transport card control row | app bar compact drag-number (hidden in Producer) |
| Preset name / scope ▾ / SAVE | transport card | **Save dialog** |
| Rating slider `x/7` | transport card | **Save dialog + inline browser rows** |
| My Presets / Library | transport card | **`Presets` button (⌘P)** |
| Hero visualiser (Spec/Motif/Roll, flash) | visual card | hero strip, 128 px — unchanged |
| Engine stats (motifs/sequence/notes) | own row under canvas | inside canvas footer, monospace |
| Master fader / L-R meters / limiter | Output card (own grid cell) | compact Output block, bottom of Macro STRUCTURE column |
| Palette-edit banner (save/copy/discard) | bottom strip banner | hue-tinted canvas frame + 32 px docked bar under app bar |
| Research-sharing note | bottom strip | Save dialog, under the share checkbox |

### Macro view

| Control | Old home | New home |
|---|---|---|
| Melody-section preset bar | Scale card top | Scale card header chip `[◧▾]` |
| 12-tone/N-EDO, scale preset ▾, world tunings ▾ | Scale card, stacked rows | Scale card, one selects row (Preset ▾ · World ▾) under the mode toggle |
| Scale circle + legend | Scale card | unchanged, enlarged to ~250 px |
| Root Pull group + distribution canvas | Scale card | unchanged |
| Melody/Tuning/Duration/Dynamics tabs | Macro Probability card | unchanged; chips for rhythm/dynamics ride the tab strip's right end |
| Pattern segment (Walk/Arp↑↓↕) + walk/arp params | Melody tab | Melody tab → **Generation** sub-panel (first) |
| Accuracy (prob, hit range) — all tabs | varied positions | **Accuracy** sub-panel, always second |
| Surprise (enable, amount, range…) — all tabs | varied positions | **Surprise** sub-panel, always third |
| Register (centre/width/skew/8va, mini canvas) | Melody tab | **Register** sub-panel, always last |
| Loudness Register | Dynamics tab | Dynamics tab Register slot (mirrors melody) |
| Rhythm preset bar | Duration tab | rhythm chip on tab strip |
| Beat divisions / note-length / onsets / rests | Duration tab | Duration **Generation** sub-panel |
| Breaks & Slides (chance/min/max/slope/timing/gap, Glide-vs-Ring segment, slide speed, diagram) | Duration monitor area | Duration monitor column, renamed **NOTE CONNECTION**, under the histogram |
| Per-tab monitors (4 histograms) | right/below, varied | right 45% column of every tab, top-aligned |
| Sequence preset bar | Sequence card | surprise chip in card header |
| Motif states / loop length / order bias / mutation | Sequence card | unchanged |
| Surprise chance / incorporation / max incorporated / multi-feature ☐ | Sequence card | unchanged |
| Per-feature weight+distance sliders ×6 | Sequence card | "Feature weights" subhead, compact 6-row grid — same card |
| Percussion preset bar | Percussion card | percussion chip in card header |
| 3 accent layers + downbeat-every | Percussion card | unchanged, one line per layer |

### Sub-note view

| Control | Old home | New home |
|---|---|---|
| Profile ▾, mix, f₀ readout | header | unchanged |
| Editing-layer banner + Done | header banner | hue frame + header title swap + Done — same data, new grammar |
| Instrument save | library card Instruments tab | header `[◧ sounds ▾]` chip → Save dialog (scope Instrument) |
| Stage rail (4 thumbnail cards) | rail | unchanged |
| EXCITOR/RESONATOR/BODY/SPACE inspectors (all knobs, diagrams, Performance drawer, EQ chips, position pad, own-head ☐) | inspector | unchanged (resizable 300–420 px) |
| Tone print (FOCUS chips, stems, pin, LENS, strip) | centre | unchanged — remains the truth display |
| Envelope panel (+ ADSR editor) | right column | unchanged, gains natural height |
| Advanced shaping drawer | right column | unchanged |
| Layers band (add, rows, solo, recapture, sync panel) | bottom, height-capped | labelled 26 px collapsed / 165 px expanded drawer that **pushes** the main row |

### Producer view

| Control | Old home | New home |
|---|---|---|
| Toolbar (all 15 controls) | one flat row | same row, three separated clusters (arrangement / transport / canvas & I-O) |
| BROWSER (search, chips, splits ▾, rows, drag) | left panel, bespoke | left panel, **docked unified browser** (adds ratings + source filter) |
| PALETTE (cards, badges, edit, arm segment, drop-to-load) | left panel below browser | unchanged |
| GLOBAL SCALE / GLOBAL SPACE strips | chevron strips | permanent 22 px labelled headers with enable toggles; bodies unchanged |
| Ruler, track heads, lanes, regions, drop lane | timeline | unchanged |
| Region toolbar + bulk bar | pinned bottom | unchanged |
| Roll drawer + per-note drill-down | drawer | unchanged |
| Tour, ? shortcuts | overlays | unchanged (+1 tour step for the browser) |

---

## 8. Migration plan — nine shippable steps

Ordered so data unifies before UI deletes, and each step leaves the app fully
usable. Steps 1–5 are the preset system (highest owner priority); 6–9 are the
layout re-grouping.

1. **Preset registry (no visible change).** One module normalising factory /
   user / instrument / community entries to `PresetEntry` (§6.1); route
   existing renderers through it. Add `description` and inline-rating fields
   to stored entries (migrating old ones defaults description empty, rating
   from `rating` or 4). Ship: behaviour identical; storage forward-compatible.
2. **Overlay browser, additive.** Build the overlay + facets + preview/load
   on the registry. Wire the existing `My Presets` / `Library` buttons to
   open it (pre-filtered to Mine / Community). Old surfaces stay. Ship: new
   browser usable alongside everything old — a safe soak period.
3. **Save dialog.** Build it; point the top-bar SAVE at it; then delete the
   top-bar name/scope/rating strip and swap in the current-preset chip +
   `Presets` + `Save` cluster (§4.3). Ship: app bar reaches final form.
4. **Card chips replace section bars.** Add `[◧ presets ▾]` chips + popovers
   to the five scoped cards; delete `panelPresetBarHTML`/`wirePanelPresetBars`.
   Ship: section workflow intact, one grammar.
5. **Delete the library card; reclaim the row.** Move instrument-save into
   the Sub-note chip, contribute-consent into the Save dialog, then remove
   the card and re-template the studio grid rows to 38/128/612 (§4.5). The
   workspace stretches; nothing else moves yet. Ship: the big spatial win,
   isolated so any canvas-size regressions bisect to this step.
6. **Macro re-grouping.** Three-column arrangement, standardised
   Generation→Accuracy→Surprise→Register order in all four tabs, monitors to
   the fixed 45% column, NOTE CONNECTION rename, Output docked compact,
   control-row grid audit. Ship: Macro final.
7. **Sub-note polish.** Layers drawer push-behaviour + labelled header; hue
   frame for layer editing; right-column heights to natural sizes. Ship:
   Sub-note final.
8. **Producer browser unification + strip headers.** Swap the bespoke browser
   renderer for the docked component (keeping drag sources byte-compatible);
   permanent strip headers with in-header enable; toolbar clusters; +1 tour
   step. Ship: Producer final.
9. **Sweep.** Vocabulary pass (kills "Starters/Library/Shared" wording —
   fulfils part of P9), tooltip/`TIPS` text updates, screenshot QA at several
   window sizes (capstone), delete dead CSS.

---

## 9. Trade-offs & risks — stated honestly

- **Browsing becomes modal in the studio.** You cannot tweak parameters while
  the overlay is open. Accepted deliberately: preview/revert covers the
  compare loop, and the reclaimed 155 px row is worth far more than an
  always-on list. If soak (step 2) shows real pain, the fallback is a docked
  right-rail browser mode in the studio too — the component supports both by
  construction.
- **Section loading gains a click** (chip → popover row vs today's one
  `select`). Mitigated by putting the top 5 scoped presets directly in the
  popover; honest cost: one extra click for the 6th-plus preset.
- **Serendipity loss.** The always-visible library occasionally invited
  exploration. Mitigation: the `Presets` button and current-preset chip are
  permanent, and Producer keeps a permanently visible browser.
- **Update-vs-save-as-new is new UX.** Today every save creates a new entry;
  the dialog's "Update" primary action changes that for loaded user presets.
  Small behaviour change; needs one line in the Save dialog explaining it.
- **Step 5 is the riskiest layout change** — canvas-sized elements (tone
  print 1200×330, vis 980×210, monitors) may need re-measured heights when
  the workspace stretches. It is isolated in its own step for exactly this
  reason; budget QA time there.
- **Community ratings vs own ratings can confuse.** Two visually distinct
  treatments (●●●●○○○ own vs ★4.6 (23) community) and a sort that is honest
  about which key it uses. If it still confuses, drop community sort to a
  filter-only role.
- **The fixed canvas stays**, so Producer's track count per screen does not
  improve in this pass. The full-height Producer option is logged, not built.

## 10. Open questions for the owner

1. **Community section-presets and instruments** — is the shared library
   full-rigs only (today's behaviour), or should sections/instruments be
   shareable too? The unified model supports it; policy is yours.
2. **The `sound` scope** — keep it as "tone only, no behaviour" alongside
   Instruments (voice = tone + expression + sequence behaviour), or fold it
   into Instruments and delete the scope? Proposal keeps it; weakly held.
3. **Rating as research signal** — the old top-bar slider allowed rating the
   *currently playing state* continuously, not just presets. If the research
   protocol needs listen-time ratings decoupled from saving, we should add a
   small transient rating affordance (e.g. long-press the current-preset
   chip); the experiment pipeline (Arm 1) may already cover this — confirm.
4. **Producer full-height mode** (§4.1) — appetite for it after migration?
5. **Update-in-place default** (§9) — comfortable with "Update" as the
   primary action when a loaded user preset is dirty, or prefer save-as-new
   primary with Update secondary?
6. **Popover depth** — top 5 by *recency* or by *your rating* in the card
   chips? (Proposal: rating, tie-broken by recency.)
