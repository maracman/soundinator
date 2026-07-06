# PRODUCER V3 — Functional Specification

*Designed from the program's idea, not its current interface. Companion mockup:
`docs/mockups/producer-v3.html`. Visual language inherited from the approved
CHORDA tone-designer mockup (`docs/mockups/tone-alt-freshtake.html`): dark,
mono-numeral, stage-hue accents (amber / blue / purple / green), display-is-truth.*

---

## Experience thesis

The Producer is where deterministic chance becomes a record. Every other DAW
arranges *recordings*; this one arranges *reproducible rolls of the dice* — a
region is not audio, it is `{instrument, seed, start, length}`, and the same
region always plays the same take, forever. The design therefore treats the
**seed as a first-class, visible, touchable object** (you reroll it, you keep
it, you freeze it), and treats the **stage as the mixer** (players are placed
in a room, not panned on a bus). Everything else deliberately copies the
Logic/Pro Tools muscle-memory contract — browser → palette → drag to track →
regions that trim, slip, loop and split → double-click opens an editor drawer —
because the owner's complaint ("non-intuitive, obvious features missing") is a
complaint about *missing convention*, and convention is exactly what a
generative engine needs to feel trustworthy. The rule for every interaction:
**if Logic does it, we do it the same way; if Logic can't do it (seeds, bakes,
stage placement, degree-space pitch), we make it look like it always belonged.**

---

## 0 · Object model & vocabulary

| Object | Definition |
|---|---|
| **Instrument** | Saved voice parameter set (timbre + melodic/rhythmic behaviour) incl. its own stage position (distance 0.3–30 m, azimuth ±90°). Factory or user. |
| **Region** | `{instrument, startBeat, lengthBeats, seed, gain}` on a track. **Generative** (deterministic from seed, rerollable) or **baked** (frozen editable notes: degree-space pitch + cents, per-note velocity/duration; loops its source every N beats when extended). |
| **Track** | A lane bound to one instrument; owns gain, mute, solo, stage placement override, colour. |
| **Arrangement** | Named document: tracks + regions + session context. Many per project. |
| **Session context** | Owned by the arrangement: tempo, key (true transposition — baked notes follow), scale, master dynamics, room reverb. |
| **The Stage** | The shared virtual room. Each track's instrument occupies a position in it, rendered with true HRTF, arrival delay, air absorption, proximity bass. |

Determinism contract (non-negotiable, stated in the UI): *same arrangement JSON
⇒ same audio, live or mixdown.* Any feature that would break this is out.

---

## 1 · Layout

Five zones, all Logic-shaped:

```
┌ HEADER — brand · arrangement selector · session context · undo/redo · export ┐
├ TRANSPORT — play/stop/loop · position · tempo/key/scale · snap · master ─────┤
├──────────┬────────────────────────────────────────────────────────────────────┤
│ BROWSER  │  TIMELINE — ruler · track headers · region lanes · playhead        │
│ ───────  │                                                                    │
│ PALETTE  │                                                                    │
├──────────┴────────────────────────────────────────────────────────────────────┤
│ DRAWER — piano-roll editor (collapsible, resizable)                           │
└ STATUS BAR — contextual hints · determinism statement ────────────────────────┘
```

- **L1 — Resizable panels.** Left panel and drawer have drag-handles; drawer collapses to a 24 px tab; left panel collapses to an icon rail. *Why:* owner asked for adjustable/collapsible panels; small laptops must still arrange. — **P0**
- **L2 — Panel state persists** per arrangement (widths, drawer open/closed, scroll, zoom). *Why:* reopening a piece should feel like returning to a desk, not resetting one. — **P1**
- **L3 — Single-window discipline.** No modals for core flow; the only overlays are menus and confirmations that destroy data. *Why:* modals break drag-and-drop mental flow. — **P0**

---

## 2 · Browser & Palette

The left panel is two stacked sections: the **Browser** (everything that
exists) and the **Palette** (the working set for *this* piece).

### Browser
- **B1 — Instrument list**, grouped `PALETTE-candidates → My instruments → Factory`, each row: stage-hue dot, name, excitor glyph (bow/pluck/strike/blow), f₀/register tag. *Why:* producers pick by ear-memory of timbre class; the glyph + register answer "what is this?" before audition. — **P0**
- **B2 — Search-as-you-type filter** across name and tags. *Why:* factory list will grow past scanning. — **P0**
- **B3 — One-click audition**: hovering a row shows a ▶; click plays a 2-bar deterministic preview phrase (fixed audition seed, current key/tempo) through the master chain; click again stops; only one audition at a time. *Why:* choosing instruments silently is the single biggest "non-intuitive" hole a browser can have. — **P0**
- **B4 — Drag anywhere useful**: rows drag onto the Palette, onto an existing track (re-instruments it, with confirm if regions exist), or onto empty lane space (creates a track). *Why:* browser → track directly must work even though palette is the recommended path. — **P0**
- **B5 — "Edit in Tone Designer" affordance** (⤴ icon per row) round-trips to CHORDA and back with the producer state intact. *Why:* the instrument is the composition's atom; editing it must not cost the arrangement. — **P1**
- **B6 — Instrument detail popover** (click the dot): mini partial-field thumbnail, stage default, behaviour summary (motif bias, surprise, rhythm density). *Why:* lay producers need plain-language answers about melodic behaviour, not just timbre. — **P1**

### Palette
- **B7 — Palette = working set**: a grid of slots the producer curates for this arrangement; dragging a browser row in fills a slot; slots are the primary drag source for regions. *Why (owner direction):* browser → palette → tracks is the requested Pro-Tools-shaped funnel; it also documents the piece's instrumentation at a glance. — **P0**
- **B8 — Palette slots carry colour**: the slot inherits the track hue it will create, and shows the instrument's stage-hue dot + name + a micro timbre sparkline. *Why:* colour continuity from palette to region to mixer teaches the identity system for free. — **P0**
- **B9 — Slot → new track in one gesture**: dragging a slot to the empty area below the last track creates a track named after the instrument and drops the first region where released. *Why:* "obvious features missing" — track creation must never be a separate ceremony. — **P0**
- **B10 — Palette is saved in the arrangement JSON.** *Why:* the working set is part of the piece. — **P0**
- **B11 — Slot context menu**: audition, replace instrument, edit in tone designer, remove from palette. — **P1**

---

## 3 · Timeline & Transport

### Transport
- **T1 — Transport cluster** `⏮ return-to-zero · ▶/⏸ play-pause · ⏹ stop · ⟳ loop toggle` with Space = play/pause, Return = RTZ. *Why:* the four verbs every DAW user's hands already know. — **P0**
- **T2 — Position readout** `bar.beat.tick` in mono numerals, click-to-type to locate. *Why:* precise navigation without scroll-hunting. — **P0**
- **T3 — Session context strip**: tempo (drag or type), key (real transposition; baked notes follow), scale, master dynamics, room reverb amount — all visible at all times, all in the transport bar. *Why:* these are arrangement-owned engine parameters; hiding them in a settings page is exactly the current non-intuitiveness. — **P0**
- **T4 — Loop/cycle range** drawn in the ruler's top half; drag to set, drag edges to resize, toggle with the loop button; playback cycles it. *Why:* audition-while-editing is the core arranging loop. — **P0**
- **T5 — Pre-roll count-in toggle** (1 bar, metronome-free — a dim beat-flash on the ruler). *Why:* deterministic takes need no click track, but the ear needs a runway. — **P2**
- **T6 — Master meter + master dynamics** mini-knob live in the transport, always visible. *Why:* one glance answers "is it clipping / how loud is the piece". — **P0**

### Ruler, grid, navigation
- **T7 — Bar ruler** with adaptive tick density (numbers every 1/2/4/8 bars by zoom); beat subdivision appears past a zoom threshold. *Why:* legibility at any zoom, mono numerals per the visual language. — **P0**
- **T8 — Click ruler = move playhead; drag ruler = scrub** (playhead follows, audio silent while scrubbing — determinism makes scrub-audio misleading). *Why:* standard, and honest about what the engine is. — **P0**
- **T9 — Zoom**: ⌘+/⌘−, pinch, and a zoom slider; horizontal scroll via wheel/drag; **Z = zoom-to-fit arrangement**, ⇧Z = zoom-to-selection. *Why:* the two zoom destinations producers actually want are "everything" and "this". — **P0**
- **T10 — Snap control** in the transport: `Bar / Beat / ½ beat / Off`, plus ⌥-drag always bypasses snap; active snap value shown next to the cursor during drags. *Why:* snap that can't be seen or bypassed is the classic "non-intuitive" complaint. — **P0**
- **T11 — Playhead** is a full-height hairline with an amber head; during playback the view auto-follows page-by-page (toggleable). *Why:* standard; page-flip beats smooth-scroll for editing while playing. — **P0**
- **T12 — Vertical track scroll + track height presets** (compact/normal/tall; tall reveals in-lane gain and the stage mini-pad). *Why:* 4 tracks want tall; 12 tracks want compact. — **P1**
- **T13 — Marker lane** (named flags in the ruler: "verse", "swell"). *Why:* research sessions reference structure verbally; markers make that shared. — **P2**

---

## 4 · Regions & editing

The heart of the fix. Regions must behave exactly like MIDI regions in Logic,
plus seed verbs.

### Creation & basic manipulation
- **R1 — Drag palette slot / browser row onto a lane** creates a region (default 8 beats) at the snapped drop beat, with a fresh seed. *Why:* the primary composing gesture. — **P0**
- **R2 — Move**: drag horizontally (snap + guides), drag vertically to another track **only if same instrument, else offer "move & re-instrument" on drop** (regions are instrument-bound through their track). *Why:* prevents silent timbre changes while keeping the gesture. — **P0**
- **R3 — Trim**: edge handles resize `lengthBeats`; generative regions expose more/less of the take; baked regions **loop their source** past its length, with loop-repeat tick marks rendered at each source boundary. *Why:* matches the engine's actual semantics; ticks make looping legible instead of magical. — **P0**
- **R4 — Duplicate**: ⌘D duplicates after itself (Logic-style, snap-aligned); ⌥-drag copies. **Duplicating a generative region keeps the seed** (a copy sounds identical — that's the point of determinism); ⇧⌘D = "duplicate with new seed" for variation. *Why:* this pair of verbs *is* generative arranging: repetition vs. variation as two keystrokes. — **P0**
- **R5 — Split at playhead** (⌘T) and **scissors on click** (T tool): generative regions split into two regions with the same seed and correct internal offsets (the later half plays the later part of the same take); baked regions split their note lists. *Why:* splitting is how arrangements breathe; determinism makes lossless splits possible and we should brag about it. — **P0**
- **R6 — Join** (⌘J) adjacent same-seed/same-instrument regions back into one. — **P1**
- **R7 — Delete/cut/copy/paste** with paste-at-playhead. *Why:* clipboard is an "obvious missing feature" category. — **P0**
- **R8 — Multi-select**: click, ⇧click range, rubber-band drag on empty lane space; all region verbs apply to selections. *Why:* arranging is mostly bulk operations. — **P0**
- **R9 — Region gain** handle (small dB tag on the region, drag vertically; also in inspector). — **P0** *(engine supports it; surface it.)*
- **R10 — Nudge**: ←/→ moves selection by one snap unit, ⌥←/→ by one tick. — **P1**

### Seed verbs (the generative layer)
- **R11 — Seed chip on every generative region** (`s·4271`), always visible at normal track height. *Why:* the seed is the identity of the take; hiding it makes the system feel random rather than deterministic. — **P0**
- **R12 — Reroll (R key / dice button)**: new seed, instant re-audition if playing over the region; **seed history per region** (last 8 seeds, ⇧R steps back). *Why:* "roll again — no wait, the previous one" is the producer's core loop; without history rerolling feels like gambling with no undo. — **P0**
- **R13 — Seed lock** (padlock on the chip) excludes a region from any bulk-reroll gesture. — **P1**
- **R14 — "Audition roll" popover**: hold the dice for a 3-slot tray of candidate seeds, audition each in place, commit one. *Why:* converts reroll roulette into A/B/C choice. — **P2**

### Bake (freeze into notes)
- **R15 — Bake (B key / context menu)** converts generative → baked: frozen note list (degree-space pitch + cents, velocity, duration), region redraws from seed-sparkline to true note dashes, corner glyph ▦. *Why:* the commit gesture between composing-with-dice and editing-by-hand. — **P0**
- **R16 — Bake is undoable and reversible** ("revert to generative" restores the stored seed; a warning notes hand-edits will be lost). *Why:* commitment must not be a trap. — **P0**
- **R17 — Baked regions are the only double-click-editable regions**; double-clicking a generative region offers one inline choice: **[Bake & edit] [Just peek]** (peek opens the drawer read-only with ghost notes). *Why:* protects determinism semantics while never dead-ending a double-click. — **P0**

### Visual identity of regions
- **R18 — Region body renders its truth**: generative = density/contour sparkline computed from the actual take; baked = literal note dashes; both in track hue. *Why:* display-is-truth extended to the timeline; you can *read* the music before playing it. — **P0**
- **R19 — Selected region**: brightened border, edge handles, gain tag, seed chip active; multi-selection shares the treatment. — **P0**
- **R20 — Mid-drag feedback**: ghost of origin stays put at 40 %, dragged body follows cursor, full-height snap guide at the target beat, delta tooltip (`bar 17 · +4 bars`), other tracks' regions at same beat get a faint alignment edge. *Why:* the strongest antidote to "non-intuitive" is showing the drop before it happens. — **P0**

---

## 5 · Tracks & mixing (the stage is the mixer)

- **M1 — Track header**: hue bar, name (double-click to rename), instrument label, `M` `S` toggles, gain slider (dB mono readout), stage mini-pad (see M5). *Why:* everything a channel strip owes you, in 60 px. — **P0**
- **M2 — Solo/mute with standard semantics** (solo-in-place; multiple solos sum; muted tracks render dim lanes). — **P0**
- **M3 — Track reorder by dragging headers**; delete with confirm when regions exist; duplicate track (with or without regions). — **P0/P1** *(reorder P0, duplicate P1)*
- **M4 — Per-track output gain is post-stage** (stage handles distance loudness; the fader is artistic trim). Signal order stated in a tooltip. *Why:* two loudness controls need one sentence of honesty or users fight themselves. — **P0**

### Stage placement (CHORDA's SPACE stage becomes the producer's pan)
- **M5 — Stage mini-pad on every track header**: a top-down half-disc (listener at bottom centre, log-distance rings 0.3–30 m, azimuth ±90°); the instrument is a dot you drag; readout `2.5 m · −20°`. **This replaces pan.** *Why:* the engine renders true HRTF/delay/air/proximity — a pan knob would be a lie about a smaller system; the pad states the real model in the same drawing language as CHORDA's SPACE thumbnail. — **P0**
- **M6 — Track placement overrides the instrument's saved default**, shown as `●` (overridden) vs `○` (inherited); right-click → "revert to instrument default" / "save to instrument". *Why:* the same violin sits front-left in one piece and far-right in another; the instrument keeps its identity, the arrangement keeps its staging. — **P0**
- **M7 — STAGE view (toggle in header): one large room** showing all tracks' players as labelled hue dots, draggable together, with the room-reverb amount as a wash around the walls. *Why:* placing an ensemble one half-disc at a time hides the gestalt; this is the "mixer window" of this DAW. — **P1**
- **M8 — Room is session-owned**: one room reverb for the arrangement, edited in the transport strip / STAGE view — never per track. *Why:* physical truth (players share a hall) and a guardrail against un-mixable soup. — **P0**
- **M9 — Distance affects the *sound* not just level** and the pad says so (micro-caption: "closer = bassier, drier, wider"). *Why:* lay producers must learn the physics is real or they will fight it with gain. — **P1**
- **M10 — Placement changes are live during playback** (like touching pan while a mix runs). — **P1**

---

## 6 · Piano-roll drawer

Opens as a bottom drawer (owner direction), never a window.

- **P1 — Double-click baked region opens the drawer** scrolled/zoomed to that region; drawer header names region, instrument, source length, loop count. — **P0**
- **P2 — Degree-space grid**: rows are scale degrees of the session key (labelled `1̂ 2̂ 3̂…` + pitch names); out-of-scale rows dimmed but usable. *Why:* the engine composes in degree space; the editor should think in the same coordinates so key changes stay honest. — **P0**
- **P3 — Dual pitch display**: each note shows intended degree; selected note's readout shows precise pitch incl. cents (`F♯4 +14¢ · intended 3̂`); a per-note cents offset drag (⌥-vertical). *Why:* the research value of the engine is exactly this intended-vs-realised distinction. — **P0**
- **P4 — Note editing verbs**: draw (pencil), move/copy, trim duration, delete, rubber-band select, velocity via vertical shading + a collapsible velocity lane. — **P0**
- **P5 — Loop-aware editing**: edits apply to the source pass; looped repeats redraw instantly; repeats rendered as ghosts after the source boundary line. *Why:* makes "baked regions loop their source" visible and editable without duplication. — **P0**
- **P6 — Quantise menu** (to snap grid, strength %) and **humanise ±tick** as note operations. — **P1**
- **P7 — Audition-on-edit**: drawing/moving a note sounds it through the track's instrument *at its stage position*. *Why:* editing deaf is the piano-roll equivalent of browsing silently. — **P0**
- **P8 — Drawer is resizable and collapsible**; ⌥E toggles; Esc closes; the timeline region highlights while its editor is open. — **P0**
- **P9 — Scale-snap toggle** (new notes land on scale degrees by default; chromatic when off). — **P1**

---

## 7 · Arrangement management

- **A1 — Arrangement selector in the header** (named tabs or dropdown): create, rename, duplicate, delete; switching is instant and stops playback. — **P0**
- **A2 — Autosave** every change to local storage; explicit "Save" only exists as export. *Why:* lay producers lose work; determinism makes autosave cheap and exact. — **P0**
- **A3 — Export/import arrangement JSON** (one file = the whole piece incl. palette, stage, session context; importing never overwrites silently). — **P0**
- **A4 — Offline WAV mixdown** button in the header with progress; filename auto-stamped `name·seedhash·date`; the UI states "identical to live playback". — **P0**
- **A5 — Duplicate arrangement as variation** (⇧⌘D on the tab) for A/B of structures. — **P1**
- **A6 — Arrangement metadata**: free-text notes field (research annotations travel with the JSON). — **P2**

---

## 8 · Undo model

- **U1 — Multi-level undo/redo (≥100 steps), command-pattern over the arrangement document**; every verb in this spec is one undo step; ⌘Z/⇧⌘Z; header buttons with hover-label of the step ("Undo: reroll region 'Kalimba 3'"). *Why:* single-level undo is the most "obvious missing feature" of all; a deterministic JSON document makes deep undo nearly free (store inverse ops or snapshots). — **P0**
- **U2 — Undo is arrangement-scoped** (switching arrangements switches stacks; stacks survive until app close). — **P1**
- **U3 — Non-undoables are explicit**: playback transport, panel layout, auditioning — never in the stack. *Why:* undo that "undoes" a scroll destroys trust. — **P0**
- **U4 — Destructive-with-warning ops** (delete track with regions, revert bake with hand edits) still undo cleanly; the warning exists because the *scope* is big, not because it's irreversible. — **P0**

---

## 9 · Keyboard map

| Key | Action | Pri |
|---|---|---|
| `Space` | Play / pause | P0 |
| `Return` | Return to zero | P0 |
| `L` | Toggle loop/cycle | P0 |
| `⌘Z / ⇧⌘Z` | Undo / redo | P0 |
| `⌘D` | Duplicate after (same seed) | P0 |
| `⇧⌘D` | Duplicate with new seed | P0 |
| `R` | Reroll seed on selection | P0 |
| `⇧R` | Previous seed (history) | P0 |
| `B` | Bake selection | P0 |
| `⌘T` | Split at playhead | P0 |
| `⌘J` | Join | P1 |
| `⌫` | Delete selection | P0 |
| `⌘C/⌘X/⌘V` | Copy / cut / paste at playhead | P0 |
| `⌘A` | Select all regions | P0 |
| `←/→` | Nudge by snap unit (⌥ = tick) | P1 |
| `↑/↓` | Select track above/below | P1 |
| `Z / ⇧Z` | Zoom to fit / to selection | P0 |
| `⌘+ / ⌘−` | Zoom in/out | P0 |
| `M / S` | Mute / solo selected track | P1 |
| `⌥E` | Toggle piano-roll drawer | P0 |
| `Esc` | Close drawer / cancel drag | P0 |
| `1–4` | Snap: bar / beat / ½ beat / off | P1 |
| `?` | Keyboard overlay (cheat-sheet) | P0 |

- **K1 — `?` overlay lists everything above** grouped by area, in the CHORDA hint style. *Why:* the status bar teaches one hint at a time; the overlay is the reference. — **P0**
- **K2 — All shortcuts also exist as visible UI** (no keyboard-only features): lay-producer rule. — **P0**

---

## 10 · Empty states & onboarding

- **E1 — Empty arrangement state**: dimmed ghost track with the literal instruction path drawn in-place — "① pick an instrument in the browser → ② drop it here"; ghost disappears on first region. *Why:* teach with the actual geometry of the task, not a welcome card (a floating card already caused layout pain elsewhere in this app). — **P0**
- **E2 — Empty palette hint** inside the empty slot grid: "drag instruments here to build this piece's working set". — **P0**
- **E3 — First-reroll toast** (once ever): "same seed = same take, forever. R rerolls; ⇧R goes back." *Why:* the one concept a Logic user won't guess. — **P0**
- **E4 — Status-bar hint line** rotates contextual hints keyed to selection state (region selected → seed/bake hints; drawer open → note-editing hints), exactly like the tone designer's footer. — **P0**
- **E5 — Producer-vs-volunteer safety**: the producer view is reachable only behind the existing role gate; nothing in this spec is shown to study volunteers. — **P0**
- **E6 — Demo arrangement** ("Quartet study") shippable as factory content; loading it is offered from the empty state. *Why:* a populated screen is the fastest teacher of all. — **P1**

---

## 11 · Visual feedback rules

Binding rules, not suggestions — inherited from the CHORDA charter:

- **V1 — Display is truth**: every region body is computed from the actual take (generative sparkline / baked note dashes); nothing decorative pretends to be data. — **P0**
- **V2 — Cause → effect in one glance**: any drag shows origin ghost + destination guide + numeric delta tooltip; any knob/slider shows value in mono numerals while touched. — **P0**
- **V3 — Hue system**: track hues rotate through the four stage colours (amber/blue/purple/green, then dimmed variants); a region, its palette slot, its track header, and its stage dot always share the hue. — **P0**
- **V4 — State glyphs are consistent**: `▦` baked, `s·nnnn` seed chip, `⟳` loop ticks, `●/○` stage override, padlock seed-lock. One glyph, one meaning, everywhere including the drawer header. — **P0**
- **V5 — Playing regions glow softly at the playhead crossing**; muted lanes dim to 40 %. — **P1**
- **V6 — Micro-caps labels, tabular mono numerals, hairline borders**, no skeuomorphism, per the approved look. — **P0**
- **V7 — Every destructive affordance is red-shifted only at the moment of commitment** (e.g. delete confirm), never ambiently. — **P1**

---

## 12 · How CHORDA's stage position becomes a producer feature

The tone designer ends with SPACE: a player standing somewhere real. The
producer inherits that literally. **The mixer's pan pot is replaced by a stage
placement pad** (M5): a top-down half-disc per track using the *same drawing*
as CHORDA's SPACE thumbnail — listener head at bottom, log-distance rings,
hue dot for the player. Placement is a track-level override of the
instrument's saved position (M6), so instruments carry a sensible default and
arrangements carry the staging. The **room is one shared session object**
(M8) edited alongside tempo and key, because players share a hall — this keeps
the physics honest and the mix coherent. At P1, the **STAGE view** (M7)
zooms the half-disc to full width and shows the whole ensemble at once: the
producer literally *seats the band*, and because rendering is true HRTF with
arrival delay and air absorption, seating **is** mixing — depth is distance,
width is azimuth, brightness is air, intimacy is proximity bass. This is the
feature that makes this DAW's mixer unlike any other, and it costs no new
engine work.

---

## 13 · Non-goals (explicit)

- **No audio recording** — no microphone, no audio import; regions are engine-generated only.
- **No third-party plugins** (VST/AU/CLAP) or external FX chains.
- **No MIDI hardware I/O** (no controller mapping, no MIDI file import in V3; export P2-consider later).
- **No automation lanes** (parameter curves over time) in V3 — session context is static per arrangement.
- **No time-signature changes / tempo ramps** — one meter, one tempo per arrangement.
- **No per-track EQ/compression/inserts** — the body+space physics is the processing.
- **No collaboration/multi-user editing, no cloud sync** beyond JSON export.
- **No mastering chain** (limiters, dither options); mixdown is the engine's honest output.
- **No freeform audio-region operations** (fades, time-stretch, reverse) — regions are notes, not waveforms.
- **Nothing volunteer-facing** — the producer never appears in study flows.

---

## 14 · Build order (priority rollup)

**P0 (must build):** L1 L3 · B1–B4 B7–B10 · T1–T4 T6–T11 · R1–R5 R7–R9 R11 R12 R15–R20 · M1 M2 M3(reorder) M4 M5 M6 M8 · P1–P5 P7 P8 · A1–A4 · U1 U3 U4 · K1 K2 + P0 keys · E1–E5 · V1–V4 V6.

**P1 (should):** L2 · B5 B6 B11 · T12 · R6 R10 R13 · M3(dup) M7 M9 M10 · P6 P9 · A5 · U2 · P1 keys · E6 · V5 V7.

**P2 (later):** T5 T13 · R14 · A6.

The P0 set alone delivers the owner's stated contract: browse → palette →
drag → regions that move/trim/split/bake like Logic → double-click → drawer →
place the players on a stage → mix down the exact take you heard.

---

## Overnight build plan (2026-07-07, owner-authorized autonomous build)

Merged with the implementer's audit (scratch: producer-audit.md). Build
order tonight, one commit per block, all in the CHORDA visual language,
reusing the v1 arrangement data model with ADDITIVE fields only
(track.space {d,az}, track.color, region.name/muted/seedHistory/
takeOffsetBeats, arrangement.loopRange):

- **E — Undo/redo stack first** (≥100 snapshots, labelled) — everything
  else hooks it. Replaces the single undo slot.
- **A — Shell & transport**: L1/L3, T1-T11 (loop range, scrub,
  bar.beat readout, session strip, snap incl. Off + ⌥ bypass, zoom
  slider + Z/⇧Z, master dynamics knob; master meter deferred P1).
- **B — Regions**: R1-R20 core (dbl-click create, ghost+guides+delta
  drags, trim w/ loop ticks, ⌘D same-seed / ⇧⌘D reroll-dup, ⌘T split
  preserving seed via takeOffsetBeats, clipboard, multi-select +
  rubber-band, gain tag, seed chip + R/⇧R seed history, mute; truth
  rendering: baked note dashes + generative cached take-sparklines).
- **C — Tracks & stage**: M1-M8 (headers w/ hue, rename, M/S
  solo-in-place, dB gain, STAGE MINI-PAD replacing pan with ●/○
  override badge, reorder by header drag, delete confirm; per-track
  meters deferred P1).
- **D — Drawer/roll upgrades**: P1-P8 (degree grid + dual pitch kept;
  velocity lane, pencil add, delete, duration trim, loop-aware ghost
  repeats, [Bake & edit]/[Just peek] on generative dbl-click,
  audition-on-edit at stage position).
- **F — Finish**: onboarding/empty states, "?" shortcut overlay,
  arrangement duplicate, autosave tick, keyboard map per §9.

Deferred honestly to P1 follow-ups: per-track/master METERS (needs a
shared analyser bus), browser audition phrase (B3 — existing preview
retained), track duplicate, drawer zoom-sync niceties, freeze/bounce.

## Addendum (owner, 2026-07-07 01:05): piano-roll parity bar

"Get to parity with something like Logic Pro for editing the baked notes."
Block D checklist (within the engine's monophonic-sequence note model,
overlaps resolved Logic-style by trimming the previous note):

- Selection: click, ⇧click, rubber-band, ⌘A; multi-select verbs
- Move: drag rows (degree) + time (snap; ⌥ bypass); arrow-key nudge
  (←→ grid, ↑↓ degree, ⌥↑↓ cents via the dual-pitch model)
- Trim: BOTH edges (right = duration, left = start+duration)
- Create: pencil (double-click empty cell) at grid, default duration =
  grid, velocity = neighbour's
- Delete: ⌫ on selection
- Clipboard: ⌘C/⌘V at playhead-in-region, ⌘D duplicate after selection
- Velocity: collapsible lane with draggable bars; note body brightness
  encodes velocity; multi-select velocity drag scales
- Note mute (M) — muted notes render hollow, skip at schedule
- Quantize Q to current grid (onsets)
- Zoom h/v in the drawer + scroll, auto-scroll to region on open
- Audition on create/move/click through the track instrument AT its
  stage position; toggleable
- Keep: dual precise/intended pitch, ⌥ cents drag, loop-source ghosts,
  loop-aware editing, region highlight while editing

## Addendum 2 (owner, 2026-07-07 morning): paradigm corrections

1. **Patches, not presets, are the palette's currency**: a patch =
   macro/behaviour params (melody, rhythm, sequence, surprise) × subnote/
   tone params, combined. Palette slots display both halves; dropping a
   SECTION preset onto an existing slot replaces just that half
   ("Warm Cello × Pentatonic Drift"). Only palette patches create regions.
2. **Roll duration editing is mandatory** (both-edge trim) — was already
   in the Logic-parity addendum; owner re-flagged. Build first.
3. **Roll rows must show the pitch system**: all scale divisions as rows;
   in-scale rows normal; sub-scale rows gold-tinted; root rows violet;
   out-of-scale divisions rendered dim and LOCKED from note drags by
   default (engine notes are degree-indexed; chromatic escape would need
   a note-model extension — documented, not built).
4. **Key = pitch reference of scale degree 0** (already true since U1) —
   relabel to make the semantics obvious ("Key (root pitch)").
5. **Paradigm audit** of producer concepts that assume a sample-DAW world:
   only patches are region sources (browser section presets act on palette
   slots instead); pan superseded by stage placement; re-instrument rules
   on cross-track drag; tempo/scale stay session-tier. Audit note kept in
   this spec; fixes land with blocks.
