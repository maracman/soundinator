# UI Direction — FabFilter-inspired (owner decision, 2026-07-03)

Owner brief: take design cues from the best-designed VSTs, in particular the
FabFilter series. This replaces the A/B/C proposal choice; closest ancestor
was Direction C (visualisation-forward dark instrument), now specified
through FabFilter's actual design language.

## What makes FabFilter UIs work (the cues we're taking)

1. **The display is the interface.** Pro-Q's analyser isn't decoration — it
   is where you look and increasingly where you act. Controls orbit the
   visualisation, not the other way round.
2. **Chrome is monochrome; colour belongs to data.** The shell is a calm
   desaturated dark blue-grey. Vivid hues appear only as data: curves,
   bands, active nodes — each *layer* gets its own hue, consistently.
3. **Floating, contextual editing.** Click a thing, get a small floating
   panel with exactly that thing's controls. Global controls live in a slim
   bottom toolbar.
4. **Precision readouts.** Values are small, monospace-tabular, live, and
   exact. Sliders/knobs are thin and elegant; the value is the star, not
   the widget.
5. **Restraint everywhere else.** One subtle elevation system, tiny
   all-caps tracking labels, no ornamental borders, animation ≤150ms and
   purposeful.

## Token system

Palette (shell is near-monochrome; hues reserved for data):

    --bg:        #16181d   deep blue-charcoal ground
    --display:   #101216   visualiser wells (darkest surface)
    --surface:   #1d2026   panels
    --surface2:  #24272e   raised controls
    --border:    #2b2f37   hairlines only
    --text:      #e8eaee
    --text2:     #9aa0ab
    --text3:     #5d636e   micro-labels

Data hues (layer identity, used in visualisers, sliders' fills, chips):

    --gen:       #f5a623   generation layer (amber, kept from current)
    --acc:       #4caf7d   accuracy/repetition layer (green)
    --surp:      #38bdf8   surprise layer (cyan, kept)
    --root:      #8b7cf6   root/tonality markers (violet)

Semantic: --good #4caf7d, --warn #e5a53a, --danger #e5484d (distinct from
data hues in usage, may share values).

Type: system sans (SF/Segoe/Inter-fallback); micro-labels 10-11px caps
+0.12em tracking; values SF Mono/Menlo tabular; no display face — the
display *is* the display.

## Layout moves (phased)

- **F3a — reskin (tokens + chrome):** apply palette/type/spacing discipline
  to existing layout; thin slider tracks (3px) with data-hue fills keyed to
  the panel's layer; monospace readouts right-aligned in a fixed column;
  panels lose heavy borders, gain one soft elevation.
- **F3b — display-forward layout:** visualiser strip becomes the hero
  (taller, full-width, always visible above the fold); macro-distribution
  canvases restyled to FabFilter-curve language (filled translucent curves,
  glowing stroke, hover crosshair + readout).
- **F3c — contextual panels:** scale-note grid and vowel pad (B4a) become
  direct-manipulation surfaces; clicking a note/vowel opens a compact
  floating editor for its per-item weights, replacing always-visible
  sub-panels where sensible.
- Transport simplifies toward a slim toolbar: play/stop + seed + tempo +
  master; rating stays one obvious friendly control (volunteer-facing,
  never buried).

## Approachability guardrail

FabFilter reads professional but never cluttered — that's the point for lay
volunteers too: fewer visible controls at rest, progressive disclosure on
interaction. The welcome card, rating slider, and starter presets keep
plain-language labels; research vocabulary stays out of the shell.
