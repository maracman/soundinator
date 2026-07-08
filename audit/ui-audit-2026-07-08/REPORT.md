# Sound Studio Interface Audit

Target: `http://localhost:3000/#explore` and `#produce`  
Audit date: 2026-07-08  
Workspace: Music Synthesiser for Researching Aesthetics and Mechanistic Origins of Music  
Method: in-browser inspection, screenshots, interaction testing, responsive checks, DOM measurements, console log check, official competitor research, and generated concept renders.

## Executive Summary

The product has a genuinely differentiated core: a research-grade probabilistic synth, physics-based timbre controls, spatial/HRTF stage controls, microtonal/N-EDO support, and a deterministic generative Producer. The strongest current moments are the Sub-note Tone Designer, the Space stage, and the Producer's seed-region model after a track exists.

The biggest UX risk is that the product often behaves like a fully implemented engine wrapped in a microscope UI. Key workflows technically exist, but primary actions are tiny, hidden, clipped, or split across several concepts. This will reduce user comprehension and the quality of user-generated creations because users will rely on randomization or presets instead of shaping mechanisms intentionally.

No console errors or warnings were observed during the tested flows. The urgent issues are visual/interaction architecture issues rather than runtime crashes.

## Highest Priority Action Plan

### P0. Fix viewport and minimum-width behavior

Evidence: [mobile Explore](screenshots/13-mobile-explore.png), [mobile Producer](screenshots/14-mobile-producer.png). At 390 x 844 the app compresses into a tiny desktop surface. Producer becomes a narrow clipped timeline. Explore keeps a 10 px header/transport strip. This is not just a phone problem; it signals fragility at narrow tablet and small-window widths.

Solutions:

1. Desktop-only guardrail. Define a supported minimum width, for example 1024 or 1180 px. Below it, replace the app with a polished "Desktop required" surface that can still play a demo and explain why editing needs a wider viewport. This is fastest and honest.
2. Tablet responsive shell. Keep the engine desktop-first, but switch at smaller widths to stacked workspaces: transport, active display, one inspector, bottom navigation. Hide Producer timeline editing below tablet width or make it read-only.
3. Full responsive rebuild. Create separate mobile/tablet interaction models for Explore and Producer. This is highest cost and only worth it if participant use on mobile is required.

Recommended first move: implement option 1 immediately, then option 2 for tablets if public participant testing needs it.

### P0. Replace the clipped Library popover with a first-class browser

Evidence: [library popover](screenshots/06-library-panel.png), [library full-page capture](screenshots/06b-library-panel-fullpage.png), [scrolled page capture](screenshots/06c-library-panel-page-scrolled.png). The current Library panel opens near the bottom right, is clipped by the viewport, and defaults to an empty shared-library state while starter presets exist but are hidden.

Solutions:

1. Right drawer. A full-height right drawer with search, tabs, filters, preview, and load. See [Phase 05 Library Drawer](renders/phase-05-library-drawer.png). This preserves the current app and solves clipping.
2. Left persistent browser. Move library/presets into a persistent left browser, like Producer. This makes presets part of the instrument surface and aligns with the planned browser -> palette flow.
3. Center modal. Acceptable as a short-term fix for clipping, but weaker for audio workflows because it interrupts auditioning and editing.

Required behavior regardless of solution:

- Default `Library` to Starters or "All available", not an empty shared-library tab.
- Keep preview, load, and section identity visible per preset.
- Never open a panel partially outside the viewport.
- Show an empty state only inside the tab that is actually empty.

### P0. Make first creation in Producer obvious without requiring tiny plus buttons

Evidence: [empty Producer](screenshots/08-producer-empty-after-tour.png), [palette after add](screenshots/09-producer-after-add-to-palette.png), [track created](screenshots/10-producer-track-created.png). The flow works, but the primary path is split: browser row plus -> palette item plus -> track/region. The plus controls are 18-23 px and visually subordinate.

Solutions:

1. Primary buttons in rows/cards. Replace tiny `+` with labelled `Add` or `Add to Palette`; palette cards expose `Create Track` and `Drop Region` as visible buttons.
2. Direct browser-to-timeline creation. Let browser rows create a palette item and region in one drag/drop, with a confirmation only when replacing existing material.
3. Empty-state guided geometry. Keep the in-place path diagram visible until the first track exists: Pick sound -> Add to palette -> Drop region. See [Phase 06 Producer Empty](renders/phase-06-producer-empty.png).
4. Load Demo. Make `Load Demo Arrangement` a large first-run action. This teaches structure faster than a blank DAW.

Recommended first move: labelled add buttons plus a demo arrangement.

### P0. Enlarge hit targets and reduce micro-controls

Evidence from UI metrics:

- Explore/sub-note had 52 visible controls; 35 had at least one dimension under 24 px, and 48 were under 44 px.
- Producer had 86 visible controls; 60 had at least one dimension under 24 px, and all 86 were under 44 px by touch-target standards.
- Producer `+8 bars` was positioned offscreen at x=1369 in a 1280 px viewport.

Solutions:

1. Desktop minimum target system. Set icon-only controls to at least 28-32 px; reserve 44 px for touch/tablet.
2. Toolbar compaction. Group low-frequency actions under menus, but keep core actions visible: Play, Stop, Randomize/Reroll, Save/Load, Add Track, Bake, Edit.
3. Inspector promotion. Move selected-object actions into a larger contextual inspector instead of cramming them into regions or cards.
4. Use icons with tooltips consistently. Icon-only is fine for DAW users if the control is large enough and the glyph is conventional.

### P0. Decide the primary mental model for Explore

Evidence: [Macro view](screenshots/03-explore-top-after-scrolltop.png), [Sub-note view](screenshots/04-explore-subnote.png). Macro is a dense mechanism grid. Sub-note is a more coherent instrument chain. The current Explore screen asks users to understand scale, Markov sequence, motif surprise, percussion, output, presets, rating, and research consent at once.

Solutions:

1. Display-led Macro Explorer. Merge related controls around one large interactive display: layers for pitch distribution, rhythm density, surprise, repetition, scale/root. See [Phase 02 Macro Explorer](renders/phase-02-macro-explorer.png).
2. Task-mode left rail. Replace many always-visible panels with modes: Scale, Motion, Rhythm, Surprise, Output. The selected mode gets an inspector.
3. Beginner/Research toggle. Beginner exposes plain-language controls and live display; Research exposes exact distributions and parameters.
4. Preset-first start. Start from named musical goals, then let users inspect mechanisms after they hear something good.

Recommended direction: combine option 1 and option 2.

### P0. Fix first-run onboarding and scroll side effects

Evidence: [initial welcome](screenshots/01-explore-default-viewport.png), [after dismiss without scroll reset](screenshots/02-explore-dismissed-macro.png). The welcome panel competes with a fully rendered expert UI behind it. After "Just play", the viewport ended with top navigation partially above the viewport until manually scrolled to top.

Solutions:

1. Compact onboarding card over a less detailed background, then scroll to top on dismissal.
2. Non-blocking coach marks: show a small first-run strip near Play/Randomize/Library instead of a large modal.
3. Demo-first onboarding: ask whether the user wants to "Hear a good example", "Explore controls", or "Open Producer".

### P1. Strengthen the seed/determinism story in Producer

Evidence: [track created](screenshots/10-producer-track-created.png). Seed is visible, but compressed into a narrow 110 px region. The core concept is present but not memorable enough.

Solutions:

1. Region body truth. Generative regions should show contour/density from the take, with seed chip anchored left and clear reroll/freeze state. See [Phase 07 Producer Populated](renders/phase-07-producer-populated.png).
2. Region inspector. Put seed history, reroll candidates, freeze/bake, gain, and stage position in a right inspector. This avoids overloading the region body.
3. First-reroll tray. Hold reroll or click a dropdown for candidate seeds with A/B/C audition before commit.

### P1. Make Bake a stronger transition into editing

Evidence: [bake state](screenshots/11-producer-baked-drawer.png), [piano roll](screenshots/12-producer-piano-roll.png). Bake works and then exposes "Edit notes". The note editor is conceptually strong, especially realised-vs-intended notes, but the transition is quiet.

Solutions:

1. Bake opens the editor by default the first time, then allow a preference for "bake only".
2. Animate region body from seed contour to note dashes for 150 ms so the state change is visible.
3. Keep a reversible "Unbake" state with a clear warning only if hand edits exist.
4. Improve note editor hierarchy: large grid, scale-degree row labels, selected note inspector, visible cents/velocity lanes. See [Phase 08 Baked Note Editor](renders/phase-08-baked-note-editor.png).

### P1. Promote Space from hidden differentiator to product pillar

Evidence: [Sub-note Space](screenshots/05-subnote-space-stage.png). Space is one of the most unique and defensible features. It is currently strong but buried under Sub-note and small annotations.

Solutions:

1. Dedicated Stage view in both Explore and Producer. See [Phase 04 Spatial Stage](renders/phase-04-spatial-stage.png).
2. Replace pan language with stage language everywhere. In Producer metrics, a `.tl-pan` control still appeared; that conflicts with "stage replaces pan".
3. Stage chips on tracks/palette. Give each track a visible dot and distance/azimuth readout.

### P1. Clarify terminology and user roles

Current terms include Macro, Sub-note, Producer, Sound source, Formant, Fourier, Surprise, Motif, Incorporation, Root Pull, Global Space, Palette, Instrument, Preset, Section preset, and Shared library. Each term is legitimate, but the interface exposes too many at once.

Solutions:

1. Plain-language layer at rest: Sound, Scale, Motion, Rhythm, Surprise, Space, Output.
2. Expert labels in tooltips/expanded research mode.
3. Consistent objects: Preset = reusable settings, Instrument = saved playable voice, Region = timeline take, Arrangement = DAW document.

### P2. Add more visible creation-quality feedback

The interface should help users understand whether a generated result is coherent, surprising, repetitive, in tune, too dense, or spatially muddy.

Solutions:

1. Live "sound health" badges: density, surprise, range, clipping, tuning spread.
2. Preset compare: A/B current vs last good state.
3. Saved-favorite rationale: when rating high, offer optional tags like "calm", "interesting", "too busy", "clear melody".

## Detailed Findings

### Explore / Macro

Strengths:

- The display-first visual language is promising.
- Scale/root wheel and probability displays are valuable research affordances.
- Research opt-in is plain-language and non-coercive.

Issues:

- The first screen is cognitively overloaded.
- Many important controls live in scrollable cards, so users can miss parameters inside a visible panel.
- The visual display is more readout than editing surface.
- Some controls use exact research terms before the user has heard the consequence.

### Explore / Sub-note

Strengths:

- Excitor -> Resonator -> Body -> Space is a strong model.
- The visual language feels more like a professional instrument.
- Space/HRTF readouts are a real differentiator.

Issues:

- The switch between Fourier/Formant or sound-source paradigms was not discoverable in the first visible pass.
- Right-side envelope/partials controls are very dense.
- The inspector can scroll internally, hiding critical controls.

### Presets / Library

Strengths:

- Factory starters and section presets exist.
- Preset preview/load concepts are present.

Issues:

- Library opens clipped.
- `Library` defaults to empty shared-library state in the tested path.
- Starter preset cards exist in hidden DOM but are not what the user sees.
- The preset browser should be a primary surface, not a popover.

### Producer

Strengths:

- DAW-like zones are recognizable: transport, browser, palette, timeline, toolbar, editor.
- Adding a preset to palette and creating a track works.
- Seeded region selection, reroll, bake, edit notes, and unbake exist.
- Piano-roll editor correctly represents the research distinction between realised and intended notes.

Issues:

- Empty state is too low-contrast and too passive.
- Primary creation path depends on tiny plus buttons.
- Region body is too small to carry seed, badges, gain, identity, contour, and state.
- `+8 bars` was offscreen at default desktop viewport.
- The bottom toolbar can become a row of many equal-weight actions.

### Responsive Behavior

The current responsive behavior is not acceptable for public use below desktop width. If mobile is out of scope, the app should explicitly say so and provide a minimum-width message.

## Competitive Research

Screenshots are logged in `screenshots/comp-*.png`. Sources below are official product pages captured or consulted on 2026-07-08.

### Display-led professional audio tools

- [FabFilter Pro-Q 4](https://www.fabfilter.com/products/pro-q-4-equalizer-plug-in): official copy emphasizes "unrivalled interface workflow" and a large graph-first EQ. Lesson: the display is the main editing surface, and controls orbit the selected data.
- [Arturia Pigments](https://www.arturia.com/products/software-instruments/pigments/overview): official copy highlights multiple synthesis engines, drag-and-drop modulation, generative sequencing, and color-coded responsive UI. Lesson: complex engines become approachable through color-coded modulation and visible signal paths.
- [Bitwig The Grid](https://www.bitwig.com/the-grid/): official page frames modularity as "anything can be dragged anywhere" with interactive help. Lesson: flexible systems need visible patching/drag affordances and strong in-context learning.

### Physics-based audio and acoustic modeling

- [Pianoteq](https://www.modartt.com/pianoteq_overview): physically modeled piano suite with customization. Lesson: physics-based products sell expressivity and tweakability, but hide the math behind musical controls.
- [Chromaphone 3](https://www.applied-acoustics.com/chromaphone-3/): "acoustic object synthesizer" with real-life acoustic character. Lesson: object/material metaphors are easier than raw synthesis parameters.
- [Kaivo](https://madronalabs.com/products/kaivo): granular plus physical modeling synth. Lesson: semi-modular products benefit from visible flow and tactile modules.

### Research / computational music tools

- [Max](https://cycling74.com/downloads): interactive visual patching environment for musicians, artists, inventors, and prototypers. Lesson: research-grade flexibility is accepted when users can see the patching model.
- [SuperCollider](https://supercollider.github.io/): platform for audio synthesis and algorithmic composition used by musicians, artists, and researchers. Lesson: researcher tools can be powerful with text-first workflows, but this app is choosing a graphical instrument path and should not inherit code-tool density.

### N-EDO and microtonal tools

- [Entonal Studio](https://node.audio/products/entonal-studio): microtonal tool with radial graph, plugin hosting, presets, MTS-ESP/MIDI retuning. Lesson: the radial graph is a strong candidate for the app's scale editor.
- [ODDSound MTS-ESP Suite](https://oddsound.com/mtsespsuite.php): suite for keeping plugins and external synths in tune and changing/morphing tuning systems. Lesson: global tuning state must be visible and trusted.
- [Scala](https://www.huygens-fokker.org/scala/): long-standing tuning tool for creating, editing, comparing, analyzing, storing, and converting tunings. Lesson: import/export and scale-library depth matter to expert users.
- [Leimma & Apotome](https://isartum.net/): browser-based microtonal tuning and generative music environments. Lesson: web-native microtonal exploration can be educational and auditory, not just configuration.

## Screenshot Log

App audit:

- [01 Explore welcome](screenshots/01-explore-default-viewport.png)
- [02 Explore after welcome dismissal](screenshots/02-explore-dismissed-macro.png)
- [03 Explore top at desktop](screenshots/03-explore-top-after-scrolltop.png)
- [04 Sub-note Tone Designer](screenshots/04-explore-subnote.png)
- [05 Sub-note Space](screenshots/05-subnote-space-stage.png)
- [06 Library clipped](screenshots/06-library-panel.png)
- [06b Library full-page](screenshots/06b-library-panel-fullpage.png)
- [06c Library after page scroll](screenshots/06c-library-panel-page-scrolled.png)
- [07 Producer with tour](screenshots/07-producer-initial.png)
- [08 Producer empty](screenshots/08-producer-empty-after-tour.png)
- [09 Producer after palette add](screenshots/09-producer-after-add-to-palette.png)
- [10 Producer track created](screenshots/10-producer-track-created.png)
- [11 Producer baked region state](screenshots/11-producer-baked-drawer.png)
- [12 Producer piano roll](screenshots/12-producer-piano-roll.png)
- [13 Mobile Explore](screenshots/13-mobile-explore.png)
- [14 Mobile Producer](screenshots/14-mobile-producer.png)

Competitor screenshots:

- [FabFilter Pro-Q 4](screenshots/comp-fabfilter-pro-q-4.png)
- [Arturia Pigments](screenshots/comp-arturia-pigments.png)
- [Bitwig The Grid](screenshots/comp-bitwig-grid.png)
- [Pianoteq](screenshots/comp-pianoteq.png)
- [Chromaphone](screenshots/comp-chromaphone.png)
- [Kaivo](screenshots/comp-kaivo.png)
- [Entonal Studio](screenshots/comp-entonal-studio.png)
- [ODDSound MTS-ESP](screenshots/comp-oddsound-mts-esp.png)
- [Max](screenshots/comp-max.png)
- [SuperCollider](screenshots/comp-supercollider.png)
- [Scala](screenshots/comp-scala-huygens-fokker.png)
- [Leimma & Apotome](screenshots/comp-leimma-apotome.png)

## Interface Phases and Generated Renders

These are conceptual renders, not implementation-accurate wireframes. They explore UI directions where the current app needs stronger hierarchy.

### Phase 01 - Onboarding / First Audition

Functionality: choose Just Play, Share Ratings, or Load Demo; audition a short sound; show research sharing as optional and anonymous; keep the actual app visible but not distracting.

Render: [phase-01-onboarding.png](renders/phase-01-onboarding.png)

### Phase 02 - Macro Explorer

Functionality: central interactive mechanism display for pitch, rhythm, surprise, repetition, scale/root, and seed. Controls are contextual around selected layer instead of always visible in dense panels.

Render: [phase-02-macro-explorer.png](renders/phase-02-macro-explorer.png)

### Phase 03 - Tone Designer

Functionality: cleaned Sub-note workspace with Excitor, Resonator, Body, Space chain; selected stage opens a large direct-manipulation graph; presets are physical profiles.

Render: [phase-03-tone-designer.png](renders/phase-03-tone-designer.png)

### Phase 04 - Spatial Stage

Functionality: dedicated stage-as-mixer view. Drag instruments around the listener; inspect arrival, head shadow, air absorption, binaural correlation, room model, and HRTF/head model.

Render: [phase-04-spatial-stage.png](renders/phase-04-spatial-stage.png)

### Phase 05 - Library Drawer

Functionality: first-class preset/instrument browser with search, starter/my/shared tabs, tuning filters, N-EDO filters, waveform thumbnails, preview against current settings, load, and drag-to-palette.

Render: [phase-05-library-drawer.png](renders/phase-05-library-drawer.png)

### Phase 06 - Producer Empty Arrangement

Functionality: DAW-shaped empty state that teaches pick sound -> add to palette -> drop region. Includes visible Load Demo and Add Track actions.

Render: [phase-06-producer-empty.png](renders/phase-06-producer-empty.png)

### Phase 07 - Producer Populated Arrangement

Functionality: multi-track timeline with generative and baked regions; seed chips; reroll candidates; stage mini-pad; right inspector; key/scale/snap/export in transport.

Render: [phase-07-producer-populated.png](renders/phase-07-producer-populated.png)

### Phase 08 - Baked Note Editor

Functionality: bottom drawer piano roll for baked regions, with realised pitch, intended scale-degree ghosts, cents offsets, velocity, microtiming, quantize/humanize/audition, and note inspector.

Render: [phase-08-baked-note-editor.png](renders/phase-08-baked-note-editor.png)

### Phase 09 - Scale Lab

Functionality: dedicated N-EDO/microtonal editor with radial scale graph, ratio overlays, root/subscale/off states, selected degree inspector, MIDI mapping, keyboard mapping, Scala import/export.

Render: [phase-09-scale-lab.png](renders/phase-09-scale-lab.png)

## Suggested Implementation Sequence

1. Desktop guardrail and library drawer fix.
2. Producer first-creation flow: labelled Add, Load Demo, stronger empty state.
3. Minimum hit-target system and toolbar/icon cleanup.
4. Macro Explorer hierarchy pass: central display plus contextual inspector.
5. Producer region readability and seed inspector.
6. Bake/editor transition and note editor legibility.
7. Dedicated Stage view and pan-to-stage terminology cleanup.
8. Scale Lab as a focused N-EDO/microtonal workspace.

