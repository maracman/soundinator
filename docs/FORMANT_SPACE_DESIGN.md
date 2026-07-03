# Formant Space Redesign

Owner flag (2026-07-03): the "formant circle" (ee–eh–ah–oh–oo with modular
wraparound) is probably wrong — vowel space is more like a line, and on a
line the surprise mechanic can only deviate in one direction at the
extremes. Needs proper thinking through.

## What's actually wrong with the circle

Confirmed in code: `_formantStep` wraps modulo the vowel list and
`formantFreqsAt` interpolates around the ring, treating every adjacent pair
as one equal step, including ee↔oo. Two distortions follow:

1. **The wrap is a fiction.** ee→oo is treated as one step, the same
   distance as ee→eh, but acoustically that edge spans nearly the whole F2
   axis (~2300 Hz → ~850 Hz).
2. **Equal steps aren't equal.** Circle-step distance ignores the very
   different acoustic gaps between vowel pairs, so "surprise distance" is
   not a consistent perceptual unit — bad for the music and worse for the
   research, where surprise distance should be a measurable variable.

But a pure line is wrong too, for exactly the reason flagged: at "ee" the
only legal deviation is towards "eh", so extreme vowels get half the
surprise distribution (or, with folding, a biased one).

## The actual shape: a 2D horseshoe

Phonetically, vowels live in a two-dimensional acoustic space — F1
(openness) × F2 (frontness) — and the five presets trace the classic vowel
horseshoe through it (approx, Hz):

    ee (300, 2300)   eh (550, 1900)   ah (750, 1200)
    oh (500, 900)    oo (300, 850)

The circle intuition wasn't crazy — the horseshoe nearly closes (ee and oo
share low F1) — but the closure edge is long in F2, and the space between
the arms is real, reachable vowel territory (schwa-like centre vowels).

## Proposed model: continuous 2D vowel space

Operate in (log F1, log F2) — log because perceptual spacing is roughly
geometric (bark/ERB would also do; log keeps it dependency-free).

- **Position**: a note's vowel is a point in the space; the five presets are
  landmarks. F3, bandwidths, and amplitudes resolve by inverse-distance
  weighting from the landmark vowels.
- **Accuracy miss**: displacement in a uniformly random *direction* with
  magnitude from the existing accuracy-range distribution, expressed in
  perceptual units (log-Hz). Clamp/reflect at the boundary of the vowel
  region (convex hull of the landmarks, slightly inflated).
- **Surprise**: same mechanics, larger magnitude via the existing distance
  parameter. From an extreme vowel like "ee" the reachable directions
  simply fan inward across the space — the distribution stays symmetric in
  area, no dead end and no fictitious wrap. This is the core fix.
- **Research payoff**: surprise/accuracy distance becomes a real acoustic
  measure (Δ log-Hz), which slots directly into the Phase B per-note
  surprisal metrics; formant surprisal can be computed from the actual
  displacement distribution rather than circle steps.

## UI implication

The formant weight circle becomes a **2D vowel pad** (the vowel trapezoid,
familiar from vowel-filter XY pads on synths): landmarks drawn as labelled
anchors, per-vowel weights as dot sizes, live note positions as the moving
point. More honest and, for musicians, more intuitive than the ring.

## Migration notes

- Keep `FORMANT_PRESETS` as landmark definitions; deprecate `FORMANT_ORDER`
  stepping (`_formantStep`, circle-step ranges like `formantAccuracyRange`
  in "steps") in favour of distances in log-Hz units.
- Existing presets store circle-step ranges; map old step units to
  approximate log-Hz distances on load (1 step ≈ mean adjacent-landmark
  distance).
- `formantFreqsAt(formant, dev)` (1D dev along the ring) is replaced by
  `formantFreqsAtPoint({x, y})`; the note model stores the realised point
  and the intended landmark, mirroring the pitch model's
  intended-vs-realised split (and the bake feature's dual representation).

Scheduled as roadmap task B4a (before formant surprisal metrics land in B3
summaries).
