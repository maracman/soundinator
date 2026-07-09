# Producer Mode UI Audit - 2026-07-08

Scope: look, feel, and user experience only. This pass intentionally avoids new
production features and works with the producer mode that already exists.

Target mockups:

- `docs/mockups/producer-target-full-2026-07-08.png`
- `docs/mockups/producer-target-detail-2026-07-08.png`

## Summary

Producer mode already has the right functional skeleton: browser, palette,
arrangement selector, transport, ruler, track lanes, deterministic seed chips,
region actions, global scale/space strips, draggable panels, and an editor
drawer. The main issue is not capability. The issue is that the visual system
still feels like accumulated implementation layers instead of one finished
production environment.

The target feel should be closer to a compact DAW/plugin hybrid: dense, calm,
grid-aligned, high-contrast enough for long sessions, with data colors used for
track identity and musical state rather than general decoration.

## What Works

- The mental model is correct: browser to palette to tracks to regions.
- Seed chips are present on regions, which is essential for generative trust.
- Track lanes, ruler, playhead, loop range, region toolbar, and editor drawer
match expected production conventions.
- Palette persistence and region selection state give the mode real arranging
substance.
- The built-in demo arrangement is valuable for first-run comprehension.

## Main Findings

1. Transport hierarchy is not production-grade yet.
   The top bar is a flat sequence of controls. At 1024 px wide it wraps into a
   131 px-tall block, mixing transport, session, zoom, I/O, and MIDI controls
   without clear grouping. Professional production tools need transport rhythm:
   arrangement, playback, position, session context, editing, and export should
   read as separate clusters.

2. The UI is too low-contrast in important working states.
   The palette, global strip labels, empty-state copy, toolbar hints, and some
   browser rows are dim enough that the interface feels inactive. A dark DAW can
   be quiet, but primary work surfaces still need crisp text, grid lines, and
   selected-state edges.

3. Browser add actions are clipped.
   Browser rows render `+ Add`, but the inherited `.br-btn` fixed width clips
   the button down to a small `+A` shape. This makes the primary onboarding path
   look broken.

4. Track identity is weaker than it should be.
   Tracks have hue dots, but the headers, meters, and regions do not yet form a
   continuous color identity. A producer should be able to glance from palette
   item to track header to region and know what belongs together.

5. Region bodies read as generic blocks.
   Seeds are visible, but generative regions do not yet have enough musical
   texture. The selected region outline helps, but the default body looks more
   like a disabled placeholder than a take on a timeline.

6. The selected-region toolbar has the right actions but not enough command
   weight.
   It is pinned correctly, but it reads as a loose row at the bottom rather than
   a focused inspector/action strip. Loop, bake, reroll, split, gain, studio,
   and delete should feel like one selected-region surface.

7. The left browser/palette panel is structurally right but visually noisy.
   The browser and palette use several button/chip styles with uneven metrics.
   Palette cards are close to useful, but their actions and module-half selector
   need tighter alignment and stronger affordance.

8. Global scale and global space collapsed states are too cryptic.
   The labels exist, but collapsed strips appear as faint text floating above
   the ruler. They need a clearer compact header treatment so users understand
   those rows are arrangement-level production controls.

## Implementation Plan For This Pass

- Restyle the producer shell only: do not change engine behavior or add new
  workflows.
- Group the transport into explicit clusters and make wrapping deliberate.
- Fix browser add button sizing and row affordance.
- Add per-track hue CSS variables to track headers and regions.
- Upgrade region visual language: stronger selected state, seed chip, subtle
  take texture, and clearer baked/generative distinction.
- Tighten track headers, mute/solo/global buttons, fader rows, and dB readouts.
- Restyle the selected-region toolbar as a compact inspector/action strip.
- Improve global strip header contrast and overall panel/grid polish.
- Verify at desktop and narrow laptop viewports.
