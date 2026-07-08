# Macro Future Field Brief

Date: 2026-07-08

## Purpose

The Macro Explorer future display should help an experienced user understand
what the current macro settings are likely to sound like before, or while, the
patch plays.

It should not look like a literal prediction of the next notes. Instead, it
should look like the result of rolling the current generative settings many
times, aggregating those rolls into a probability surface, and drawing one
representative path through that surface.

The display should answer:

- What pitch region does this patch tend to occupy?
- How wide is the melodic uncertainty?
- Is the melody stepwise, jumpy, repetitive, drifting, or volatile?
- How dense is the rhythm?
- How much silence/rest pressure is present?
- How likely is repetition versus mutation/new motif material?
- How much surprise pressure exists, and in which dimensions?

## Current Problems

The current implementation is closer to the intended philosophy, but still has
several problems:

- The possible pitch path looks too uniform and mechanically zig-zagged.
- The future field does not appear scale-aware enough; it reads like arbitrary
  vertical pixels rather than valid scale-degree movement.
- The field feels static because it is drawn in place. Even if the underlying
  data is cached, the presentation should still appear to flow past the
  playhead.
- The rhythm future is visually regular and grid-like, so it feels more like a
  sequencer pattern than an aggregate probability climate.
- Motif future blocks are clearer than before, but they still need a stronger
  visual distinction between repeat pressure, variant pressure, and new-material
  pressure.
- The display lacks a convincing sense that many possible futures have been
  sampled and compressed into one readable picture.

## Desired Model

Use a settings-driven simulation field.

Conceptually:

1. Take the current macro settings and seed.
2. Generate many possible short future paths from those settings.
3. Quantize pitch samples to the active scale or EDO degree grid.
4. Aggregate the samples into a heat map.
5. Derive one representative modal path through the heat map.
6. Animate the field so it scrolls through the playhead like a looped audition
   of the current settings.

The simulation should update when relevant settings change, such as:

- scale, root, EDO, seed;
- interval range;
- interval shape/peakedness;
- momentum;
- motif hit probability and hit range;
- rhythm density/on-beat/off-beat settings;
- rest ratios;
- gap/legato probability;
- surprise probability and dimensions;
- motif count;
- motif length;
- sequence order;
- motif mutation;
- incorporation chance.

The simulation does not need to update on every note event. It may scroll or
loop visually during playback, but the sampled field should remain stable until
the relevant settings change.

## Pitch Lane

The pitch lane should be scale-aware.

Requirements:

- The vertical axis should represent valid scale or EDO steps, not arbitrary
  continuous pitch space.
- Heat should land on discrete scale-degree rows or softly blurred bands around
  those rows.
- The representative path should move by valid interval choices from the
  current interval distribution.
- If the scale is sparse, the heat map should visibly show fewer possible rows.
- If interval range is narrow, the heat should cluster tightly.
- If interval range is wide or surprise pitch distance is high, the field should
  widen and show more outlying energy.
- If interval shape is stepwise, the modal path should move smoothly.
- If interval shape is flat/jumpy, the modal path should show more leaps.
- Momentum should create visible directional runs rather than random wobble.

Avoid:

- uniform sawtooth or zig-zag lines;
- evenly spaced noise that ignores scale;
- future note dots;
- labels like `P?`;
- any exact-looking upcoming contour derived from scheduled notes.

## Rhythm Lane

The rhythm lane should feel like a density forecast, not a fixed pattern.

Requirements:

- Onset likelihood should be shown as repeated vertical density bands, but with
  enough variation to avoid a mechanical comb.
- Beat and subdivision structure should still be legible.
- On-beat probability should brighten beat columns.
- Off-beat probability should brighten subdivision columns.
- Same-length probability should make duration density more consistent.
- Rest pressure should show red/dark silence regions or probability bands.
- Gap/legato should remain a lower continuous articulation band.

Avoid:

- dashed note blocks that imply scheduled future notes;
- perfectly identical columns for long stretches;
- rhythm visuals that look like a piano-roll sequence.

## Surprise Lane

The surprise lane should show risk pressure rather than future surprise events.

Requirements:

- Show baseline information mean and threshold from realized history when
  available.
- Show a future risk field based on surprise probability and enabled dimensions.
- Dimension badges may appear as a compact legend, but not as predicted events.
- High surprise probability should visibly raise/brighten the future field.
- Multiple enabled surprise dimensions should make the field richer or layered.

Avoid:

- `P?`, `R?`, or future event markers;
- vertical spikes that look like scheduled surprises.

## Motif Lane

The motif lane should communicate future motif tendency, not future identity.

Requirements:

- Block future time into generic motif-pass windows.
- Each future block should show repeat / variant / new pressure.
- Repeat pressure should feel stable and green.
- Variant pressure should feel teal/evolving.
- New-material pressure should feel amber/hot.
- Blocks should not be named `A next`, `B projected`, etc.
- If order bias is high and mutation is low, repeat should dominate.
- If mutation/incorporation/surprise are high, variant or new pressure should
  become visually obvious.

Possible visual encodings:

- stacked probability bars inside each motif block;
- three small labeled chips: repeat, variant, new;
- block fill split into green/teal/amber proportions;
- border color determined by dominant probability;
- subtle heat strips for expected drift.

## Motion / Animation

The display should not feel frozen.

Preferred approach:

- Keep the sampled field cached until settings change.
- Animate only the presentation offset.
- The future field scrolls left toward the playhead.
- When it reaches the playhead, it wraps or crossfades into the next loop.
- The loop should be subtle enough to feel like a flowing audition surface, not
  a fake live prediction.

Important distinction:

- The field may move.
- The field should not re-randomize every note.
- The field should not chase the currently playing note.

## Scale Awareness

The pitch field should use the active scale model:

- 12-EDO preset scales;
- custom degree selections;
- N-EDO divisions;
- root offset;
- subscale weighting if relevant.

Display implication:

- Valid pitch rows should be visible through heat placement.
- Root or tonal centre may be subtly emphasized.
- Sparse scales should produce visibly sparse possible paths.
- Dense EDO scales may appear smoother, but should still be quantized.

## Acceptance Criteria

The next implementation should be considered successful if:

- A user can tell, without pressing play, whether the patch is sparse/dense,
  stepwise/jumpy, stable/mutating, and low/high surprise.
- The right side reads as a probability surface, not a predicted sequence.
- The representative path looks musically plausible and scale-valid.
- Changing interval range, interval shape, rhythm density, rest settings,
  surprise probability, and motif mutation visibly changes the field.
- The field animates or scrolls enough to feel alive while remaining stable for
  unchanged settings.
- No future section uses exact note dots, exact motif names, or question-mark
  future events.

## Suggested Implementation Plan

1. Build a pure `makeMacroFutureField(params, scaleState)` function.
2. Have it return pitch heat rows, modal pitch path, rhythm heat, surprise risk,
   and motif pressure windows.
3. Cache results by a stable hash of relevant settings.
4. Quantize generated pitch paths through the actual scale/EDO logic.
5. Render heat first, modal line second, labels last.
6. Add a time/phase offset only at render time for scrolling.
7. Validate against several extreme presets:
   - narrow stepwise;
   - wide jumpy;
   - high rest;
   - dense rhythm;
   - high mutation;
   - high surprise;
   - sparse custom scale;
   - high-division EDO.

