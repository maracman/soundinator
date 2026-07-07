# Harmony instrument patches — proposal (owner decision required, nothing built)

**The ask.** "Harmony instrument patches" — instruments that play chords,
not single notes.

## The design in one sentence

Harmony is a **voicing layer on the melody walk**: the patch declares
chord degrees in *scale-degree space*, and every note the generator
produces carries satellite voices at those offsets.

## Why this shape and not another

The engine's melody is a walk over scale degrees; everything downstream
(bake, roll, MIDI, global scale markers) speaks degree-space. If harmony
is degree offsets:

- **It transposes for free.** `[0, +2, +4]` (a triad in scale steps) is
  right in every key, every scale, every EDO — the same reason baked
  notes survive key changes.
- **It follows the global scale strip.** A Q5 marker changes the degree
  list; the voicing re-voices itself.
- **It composes with arp mode.** The walk (or arp) picks the *root* of
  each voicing; satellites ride along. Arp over a triad voicing = broken
  chords without new machinery.

## How it is distinct from what already shipped

| Feature | What overlaps | Harmony patches |
|---|---|---|
| P3 note connection (ring) | *Temporal* overlap — consecutive walk notes ringing together | *Simultaneous* planned voices per note |
| Q7 layers | Same fundamental, different timbres | Same timbre, different fundamentals |

All three compose: a layered patch with a triad voicing and ring
connection is a pad.

## Sketch of the schema (for reaction, not implementation)

```
params.harmonyDegrees   = null | [0, 2, 4]     // satellite offsets in scale steps (0 = the walk note)
params.harmonyGains     = null | [1, 0.7, 0.7] // per-voice level
params.harmonySpread    = 0..1                 // stereo/space spread of satellites around the patch position
params.harmonyHumanize  = 0..1                 // per-voice onset stagger (a strummed feel at 1)
```

Engine: in `nextNote`, when `harmonyDegrees` is set, emit satellite
sub-notes (degree = `stepFrom(walkDegree, offset)`) sharing the note's
duration/velocity envelope but drawing their own fingerprints — exactly
the Q7 `layerRenders` transport, so the render path needs almost nothing
new. Bake persists satellites as ordinary notes (chords appear naturally
in the roll).

## Open questions for the owner

1. **Voicing per patch or per section?** A patch-level list is simplest;
   markers on the timeline (like the global scale) would allow harmonic
   rhythm — bigger build.
2. **Do satellites obey the sub-scale weighting** (they could re-voice to
   the nearest sub-scale degree) or stay literal offsets?
3. **Surprise interaction:** may a surprise hit a satellite, or only the
   root? (Proposal: root only, satellites follow.)
4. **CPU:** 3-voice harmony × 64 partials × layers multiplies oscillator
   count; the audibility cull helps but a per-satellite partial cap
   (e.g. 24) is probably wanted.
