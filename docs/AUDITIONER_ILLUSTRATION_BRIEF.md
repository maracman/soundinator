# Auditioner machine — illustration brief

A target illustration to replace the placeholder line-drawing in the community
browser's auditioner strip (`auditionerMachineSVG()` in `web/static/app.js`).
Draw it however you like stylistically — the constraints below are what the
code needs to wire it up unchanged.

## Concept

A **hand-cranked street organ / music box contraption** with a **one-man-band
percussion rig** standing beside it. It is the "try before you add" machine:
each physical part of the machine is one of Resona's seven module sections,
and dropping a community module onto the machine lights up the part it powers.
Whimsical, mechanical, slightly Victorian — think patent-drawing or tin-toy,
not skeuomorphic photo-realism.

## The seven parts (what maps to what)

| Machine part | Section | Reads as |
|---|---|---|
| Hand crank with wheel and knob handle | **rhythm** | you crank the tempo; it drives everything |
| Main music-box body/cabinet (visible comb teeth or organ pipes) | **sound** | the tone source |
| Pianola/player-piano paper roll turning on top (punched holes) | **melody** | the notes |
| Small spinner / fortune-wheel mounted on the cabinet front | **surprise** | chance |
| Lever with a quadrant gauge (like an old signal lever) on the cabinet | **dynamics** | loud/soft |
| Gramophone horn flaring out of the cabinet side | **space** | projects into the room |
| Separate stand with bass drum + mounted cymbal + mechanical mallet arm | **percussion** | the one-man band |

The percussion rig should read as its **own free-standing contraption** next to
the organ (connected by nothing, or at most a drive belt/cable if you like).

## Canvas & layout

- **Wide landscape strip, aspect ratio about 5.7 : 1** (the code uses a
  980 × 172 viewBox; any equivalent ratio works). It renders between ~90 px and
  ~160 px tall, so silhouettes must read at small sizes — bold shapes, no fine
  hatching that turns to mud.
- Left → right order that currently works well: **crank | cabinet (with
  spinner + dynamics lever on its face, roll on top) | horn | percussion rig**.
  Feel free to rearrange, but keep the seven parts clearly separable — each is
  a distinct hover/drop target, so parts shouldn't overlap much.
- A little ground/shadow line is nice. Transparent background.
- Leave visual breathing room on each part for a small icon badge (~40 × 26 px
  at full size) that the app pins on top of it — the notation icon telling you
  what goes where. Badges are rendered by the app, **don't draw them in**.

## Format & structure (important)

Ideally **SVG** with one group per part, in any order, using these exact ids /
attributes so the existing code binds without changes:

```
<g data-aud-slot="rhythm">     … includes child  <g id="audCrankArm">   (the rotating arm+knob)
<g data-aud-slot="sound">
<g data-aud-slot="melody">     … includes child  <g id="audReelHoles">  (the punched-hole strip, will scroll)
<g data-aud-slot="surprise">   … includes child  <g class="aud-spin">   (the spinning disc)
<g data-aud-slot="dynamics">   … includes child  <g id="audLever">      (the lever arm)
<g data-aud-slot="space">      … may include     <g class="aud-notes-out"> (floating ♪ that fade out)
<g data-aud-slot="percussion"> … includes        <g id="audMallet"> and <g id="audCymbal">
```

Animated children rotate/translate around their own pivot — if you can set
`transform-origin` (or just tell me the pivot points), the CSS keyframes do the
rest: crank turns, roll scrolls sideways, spinner spins, lever quivers, mallet
taps, cymbal shivers.

If SVG is a pain, a **layered file (Affinity/Illustrator/Procreate) or PNGs
with each part on its own layer** also works — I'll cut it up and rebuild the
SVG. A single flat PNG works too but loses per-part lighting and animation
granularity.

## Colour & theming

The app tints the drawing at runtime, so the ideal delivery is
**monochrome line art with flat fills** (dark strokes, one or two grey fill
tones). The code recolours it:

- empty part → ghosted (半 opacity, current border grey `#363b45`-ish)
- filled part → brass/amber (`#f5a623` family strokes, faint amber fill)
- drop hover → full amber glow

If you'd rather paint it in full colour, keep each part's palette
self-contained so a simple brightness/saturation shift can express
empty vs filled — but tintable line art is the safest.

Stroke weight: whatever looks right at ~130 px tall; the current placeholder
uses ~2.5 px non-scaling strokes on the 980-wide canvas.

## Bonus: the minimised button

The strip can be tucked away into a **58 px floating circle** showing a tiny
version of the machine. A simplified companion mark (crank + box + horn only,
squarish composition) that reads at 40 px would be lovely — otherwise I'll keep
the simplified glyph I generated.

## Reference

The current placeholder (screenshot it in the app: Producer → ☄ Community,
hit ◇ Randomise) shows the working layout, proportions, badge positions, and
the lit/ghost states — treat it as the wireframe to beautify, not a style
guide.
