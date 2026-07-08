# Macro Lanes Change Spec

Date: 2026-07-08

This note describes the current target for the Macro Explorer lane display.
It supersedes the earlier "projected next motif pass" concept.

## Core Philosophy

The right side of the playhead should not look like a predicted note stream.
The generator cannot honestly know the next visual contour until the current
state has advanced, so an exact-looking future line is misleading.

Instead, the right side should look like a possible future field for the current
settings. The mental model is: roll the generator many times with the same
macro settings, aggregate the results into a heat map, then draw one
representative modal path through the highest-density area:

- show where the patch tends to live over many possible rolls;
- show how wide or narrow the likely behaviour is;
- show rhythmic density, rest climate, and articulation climate;
- show surprise risk as a broad setting-driven field;
- show motif-memory tendency without naming exact future motifs.

An experienced user should be able to look at the field and infer the sound:
"this will be sparse and stable", "this will be jumpy and wide", "this has a
high surprise climate", "this is rhythmically dense with low rest pressure".

## Temporal Model

Move the playhead left, around one third of the lane canvas width.

Left of playhead: `Recent History`

- realized notes and rests only;
- solid pitch contour;
- measured rhythm durations;
- measured information bits;
- solid motif identity, drift, and incorporation state.

Playhead: `Now`

- strong amber vertical line;
- small top handle;
- clear `NOW` label.

Right of playhead: `Possible Future Field`

- heat maps;
- soft bounds;
- probability density;
- one representative high-likelihood path where that helps comprehension;
- broad pass windows;
- setting risk fields.

Do not draw exact future notes, exact future pitch dots, exact future motif
labels, or question-mark candidate events. Dashed and translucent marks should
mean "uncertain field", not "scheduled upcoming note".

The future field should be cached from the relevant settings. It should update
when a relevant macro parameter, scale/seed, rhythm setting, surprise setting,
or motif setting changes. It should not change merely because a new note has
started playing.

## Lane Functions

### 1. Melody / Pitch

Permanent header:

- `MELODY / PITCH`
- `contour - hit distance`

Display:

- amber solid line for realized pitch contour;
- faint rolling expectation line from realized history;
- Monte Carlo-style heat field from many deterministic setting-roll samples;
- representative modal pitch path through the highest-density bins;
- field width controlled by interval range, hit distance, surprise distance,
  motif-hit probability, momentum, and sequence/mutation pressure;
- soft upper/lower likelihood bounds;
- heat backing behind realized notes where distance from expectation is high;
- solid surprise tags on realized notes, such as `P 5.2b`.

Purpose:

Show the melodic tendency and uncertainty envelope without pretending to know
the next contour.

### 2. Rhythm & Rests

Permanent header:

- `RHYTHM & RESTS`
- `onsets - durations - rests`

Display:

- blue onset bars for realized notes;
- horizontal note-duration bodies;
- blue heat backing for realized duration deviation;
- muted red rest blocks;
- lower micro-row for gap/legato;
- future onset-density heat columns;
- future duration-density heat bands;
- future rest-pressure heat bands;
- future gap/legato climate band.

Purpose:

Make rhythm legible as density, duration, silence, and articulation, rather
than only vertical onset sticks.

### 3. Surprise / Information

Permanent header:

- `SURPRISE / INFORMATION`
- `bits - distance from mean`

Display:

- measured information trace left of playhead;
- mean and threshold reference lines;
- stacked feature tags on realized surprise events:
  - `P` pitch;
  - `T` tuning;
  - `R` rhythm;
  - `D` dynamics;
  - `F` formant;
  - `Rest` silence.
- future settings-risk heat field;
- broad pass divisions to suggest where risk can recur.

Purpose:

Show why the output is surprising, not only that a surprise happened.

### 4. Motif Memory

Permanent header:

- `MOTIF MEMORY`
- `identity - drift - incorporation`

Display:

- solid realized motif blocks labelled `A`, `B`, `C`, `A'`, etc.;
- stable motifs in calm green;
- evolving variants in teal;
- new or incorporated variants with amber emphasis;
- pitch-drift and rhythm-drift heat strips inside realized motif blocks;
- solid diamonds for realized incorporation;
- future generic motif-memory slots;
- each slot shows repeat / variant / new pressure as simple probability colour
  bars;
- no exact `A next` or `B projected` labels.

Purpose:

Make motif identity, variant growth, and memory drift visible without implying
that the renderer has predicted the next motif identity.

## Left Header And Key Interaction

The left lane column should remain quiet.

Each lane header should contain only:

- lane number;
- lane title;
- short subtitle;
- small circular `i` info button.

Clicking the `i` button opens a contextual key for that lane.

Key behaviour:

- only one key open at a time;
- key is anchored to the clicked lane;
- closes on `Esc`, outside click, close button, or another lane key opening;
- contains compact swatches and labels;
- does not resize the lane canvas.

The key should explain visual encoding without turning the permanent left side
into a legend wall.

## Bottom Summary

The bottom summary should act as a quick readout, not an alert banner.

Tiles:

- `Motifs`;
- `Variants`;
- `Sequence`;
- `Notes`;
- `Rests`;
- `Mean info`;
- `Surprises`.

Status chip:

- playing: `Now playing - possible future field`;
- stopped: `Stopped - showing the last take`.

## Data Requirements

Already available in the current event timeline:

- `when`;
- `dur`;
- `frequency`;
- `degree`;
- `velocity`;
- `isRest`;
- `isSurprise`;
- `motifIndex`;
- `baseIndex`;
- `isVariant`;
- `motifNoteIndex`;
- `motifNotesCount`;
- `isMotifStart`;
- `durationDivs`;
- `intonationCents`;
- `pitchDev`;
- `rhythmDev`;
- `pitchBits`;
- `dynBits`;
- `restBits`;
- `surpriseFeatures`.

Future-field rendering should come from current macro settings, not from
scheduled exact notes. Useful settings include interval range, interval
peakedness, momentum, motif-hit probability/range, onset probabilities, rest
probabilities, gap probability, same-length probability, surprise probability,
surprise dimensions, motif mutation, incorporation, sequence order, motif
length, and seed.

## Implementation Notes

Current relevant code:

- `LANES_PLAYHEAD_FRAC` in `web/static/app.js`;
- `LANES_GUTTER` in `web/static/app.js`;
- `drawBehaviorLanes()` in `web/static/app.js`;
- `LANE_KEYS` in `web/static/app.js`;
- `visGroupMotifs()` in `web/static/app.js`;
- `getNoteTimeline()` in `web/static/synth.js`.

Implementation rules:

1. Draw realized events left of the playhead as solid measured marks.
2. Build right-side fields from settings and seed, with no dependency on the
   current note.
3. Avoid exact future pitch dots, future contour lines, and named future motif
   predictions.
4. Use heat and bounds to communicate uncertainty.
5. Draw a representative modal pitch path through the sampled density field.
6. Keep lane labels compact; put details behind the `i` keys.

## Reference Renders

These renders are historical design references. Their broad layout still
applies, but any exact future-note or exact future-motif language should be
read as superseded by this possible-field spec.

- `audit/ui-audit-2026-07-08/renders/phase-02-macro-lanes-v2-information-heat.png`
- `audit/ui-audit-2026-07-08/renders/phase-02-macro-lanes-v3-projection-field.png`
- `audit/ui-audit-2026-07-08/renders/phase-02-macro-lanes-v4-contextual-info-keys.png`
