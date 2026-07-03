# Producer v2 — Ground-Up Redesign (owner feedback 2026-07-03)

The first producer implementation (slot grid, click-to-place) failed the
owner's bar: "nothing like I wanted… it just follows the same logic as a DAW
like Pro Tools or Logic." This document is the full rethink, plus the
acceptance bar that must pass before it is called done. The v1 code is
treated as scaffolding to be replaced, not extended.

## The mental model (straight from the owner's description)

1. **Presets are created in the synth section.** The producer consumes them.
2. **Browser**: a really nice, complete library of default + user presets,
   laid out well in a browser-style window (cards, categories, search,
   preview) — not a chip strip.
3. **Palette**: your working set for this project. Select or drag presets
   from the browser into the palette. The palette is the instrument rack.
4. **Tracks**: drag a palette item onto a track to create a region at that
   position. A track can hold MANY regions, one after another, and regions
   on one track may use different palette instruments (Logic audio-region
   logic: the region carries the sound; the track is a lane).
5. **Regions behave like MIDI regions in a DAW**: drag to shift along the
   track or between tracks; drag the right edge out to LOOP/extend along
   the track; snapped to a musical grid (beats/bars, not coarse slots).
6. **Editing an instrument**: select a palette item → edit it in the synth
   editor → save → every region using it plays the new sound (fork to copy
   instead is offered when saving).
7. **Bake → double-click**: baking freezes a region; double-clicking a baked
   region opens it in the BOTTOM PANEL — the piano-roll editor (the
   existing dual-pitch roll, docked like Logic's editor drawer).
8. **Panels are adjustable and collapsible like a DAW**: left
   browser/palette column and bottom editor are resizable by drag and
   collapsible; layout state persists.

## Layout

    ┌─────────────────────────────────────────────────────────────┐
    │ TRANSPORT: ▶ ■ · playhead position · tempo · key · scale ·   │
    │            space · WAV mixdown · export/import               │
    ├───────────────┬─────────────────────────────────────────────┤
    │ BROWSER       │ RULER (bars.beats, click = set playhead)     │
    │  search       │─────────────────────────────────────────────│
    │  category     │ TRACK LANES                                  │
    │  cards + prev │  [head: name·gain·mute] [regions……………]       │
    │───────────────│  [head]                [regions……………]        │
    │ PALETTE       │  + drop a palette item below = new track     │
    │  instrument   │                                              │
    │  rack (edit/  │                                              │
    │  remove)      │                                              │
    ├───────────────┴─────────────────────────────────────────────┤
    │ EDITOR DRAWER (collapsible): piano roll of the double-       │
    │ clicked baked region · note readout                          │
    └─────────────────────────────────────────────────────────────┘

- Splitters: vertical between left column and lanes; horizontal above the
  editor drawer. Both draggable; both panels collapsible via chevrons.
  Layout state in localStorage.
- The timeline grid is beat-based: default snap 1 beat, bar lines every 4,
  numbered ruler. Regions have `startBeat` and `lengthBeats`.

## Data model (replaces v1 slots)

    palette:   [{ id, name, source: presetRef|custom, params }]
    track:     { id, name, gain, muted, regions: [] }
    region:    { id, paletteId, startBeat, lengthBeats, seed,
                 type?: "baked", notes?, loopSourceBeats? }

- A generative region regenerates deterministically from (palette params ×
  session context × seed) for its length.
- Loop-extend on a baked region repeats its notes every `loopSourceBeats`.
  Loop-extend on a generative region simply lengthens the generated span
  (deterministic, so still stable).
- Session context bar carries over from v1 (it was right): tempo, key,
  scale, dynamics, space owned by the arrangement.

## Migration

v1 arrangements (slot-based) auto-convert on load: slot × 4 → startBeat,
lengthSlots × 4 → lengthBeats, inline instrumentParams become a palette
entry per distinct track sound.

## Acceptance bar — ALL must pass before "done"

Functional:
- [x] B1 Browser lists every factory + user preset and every saved
      instrument as cards with name/section/description, category filter
      chips, text search, and in-context preview.
- [x] B2 Drag (or click-add) browser card → palette; palette persists with
      the arrangement.
- [x] B3 Drag palette item → lane creates a region at the snapped drop
      beat; drag below the last lane creates a new track. Click-fallbacks
      exist for all drag actions.
- [x] B4 Regions drag along a track and across tracks (snap to grid,
      collision-blocked), and the right edge drags out to extend/loop.
- [x] B5 One track holds multiple regions with different palette
      instruments back-to-back; playback honours each region's own sound.
- [x] B6 Palette edit round-trip: edit → save → regions using that palette
      item sound different on next play; "save as copy" forks.
- [x] B7 Bake, then double-click the region → editor drawer opens with the
      piano roll; edits persist and are audible.
- [x] B8 Browser column and editor drawer resize by drag and collapse;
      layout survives reload.
- [x] B9 Transport plays the arrangement from the playhead (click ruler to
      set), multi-voice, with a moving playhead line; mixdown matches.

Quality:
- [x] Q1 A scripted end-to-end walkthrough of B1–B9 runs with zero console
      errors.
- [x] Q2 Screenshots at each stage look like a credible DAW section, not a
      grid of buttons (subjective pre-check before owner review).
- [x] Q3 Tests still green; arrangement JSON round-trips.
- [ ] Q4 OWNER SIGN-OFF: the owner has used it and agrees it follows DAW
      logic. Until then the roadmap marks producer v2 as in progress, not
      done.

## Implementation stages (one reviewable commit each)

1. **P1 Shell** — DONE: three-zone layout (transport strip with compact
   session context, collapsible/resizable left column, centre lanes,
   collapsible/resizable editor drawer that the piano roll docks into;
   double-click on a baked region opens it). Layout persists. v1 timeline
   embedded pending P3.
2. **P2 Browser + palette** — DONE: card browser over all factory/user
   presets + instruments (name, kind chip, description, category chips,
   text search with focus-preserving re-render, in-context preview) and a
   palette rack (drag or click-add from browser, remove, persists on the
   arrangement, items draggable for P3 lanes and usable as track sources).
   Bar items B1/B2 functionally met pending the P7 walkthrough.
3. **P3 Region model** — DONE: beat-based lanes under a numbered bar
   ruler; regions {paletteId, startBeat, lengthBeats, seed} rendered
   proportionally; palette items drop onto lanes (or the new-track zone) to
   create regions at the snapped beat; regions drag along/between tracks
   (collision-blocked) and resize by right-edge drag; playback/mixdown/
   bake all beat-based; playhead line on the ruler; v1 slot arrangements
   auto-migrate (regions → beats, inline instruments → palette entries).
   Bar items B3/B4/B5 functionally met pending the P7 walkthrough.
4. **P4 Playback** — DONE: click the ruler to set the playhead (line
   visible while stopped; Play starts there; stop returns to it); baked
   regions store loopSourceBeats at bake time and repeat their notes every
   loop across an extended length, in live playback, region-loop, and
   mixdown; generative regions regenerate deterministically for their span.
   Bar item B9 functionally met pending the P7 walkthrough.
5. **P5 Editor drawer**: piano roll docked; double-click opens; bake flow.
6. **P6 Palette editing** — DONE: ✎ on a palette item loads its voice
   (under the arrangement's session context) into the Sound Studio with a
   persistent banner; 'Save to palette' writes the edited voice back
   (regions follow), 'Save as copy' forks a new palette entry, 'Discard'
   returns unchanged. Verified: stretch 6→20 round-trip, session params
   still excluded, state cleared, returned to #produce. B6 functionally
   met pending the P7 walkthrough.
7. **P7 Walkthrough** — DONE (2026-07-03): scripted clean-state pass of
   B1-B9 in the browser, zero console errors, screenshots reviewed, one
   gap found and fixed (B3 click-fallback: palette "+" now creates the
   track WITH a starter region). Explore flow verified unregressed.
   AWAITING Q4 OWNER SIGN-OFF — producer v2 is not "done" until then.
