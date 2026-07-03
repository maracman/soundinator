# Partial Macros & Higher-Fidelity Formants

Owner cue (2026-07-03): study Resonarium (Soule DSP) and RipplerX (tiagolr)
for ways to add higher-detail formants/partials without complicating the
visual UI — group related frequencies (octaves etc.) under one knob,
progressive disclosure for the rest, and a sensible way to build more waves
into the Fourier tone.

## What the reference synths teach

**RipplerX (modal synthesis, open source).** A resonator = up to 64
partials. Their frequencies are not free parameters — they come from a
physical model's ratio table (String → 1,2,3…; Closed tube → odd
harmonics; Membrane/Drumhead → Bessel ratios; Plate/Beam/Marimba →
inharmonic ratio sets). The user never touches 64 numbers: four macro
sliders shape the whole set —
- **Ratio**: stretches/compresses the ratio table,
- **Inharmonicity**: bends ratios away from harmonic,
- **Tone**: spectral tilt (per-partial gain vs frequency),
- **Material**: damping-vs-frequency law (per-partial DECAY, not gain —
  bright partials die faster on wood, ring on glass/metal).
Two resonators (A/B) can couple serially or in parallel.

**Resonarium (waveguide).** Exciter/resonator separation; 4 blocks × 8
resonators with coupling modes; macro-heavy control over grouped resonant
elements.

**The shared lesson:** fidelity comes from MORE resonant elements, usability
comes from controlling them through FEWER, physically meaningful macros.
Detail is always there, revealed only when you dig.

## What we already have

- Fourier tone: up to 20 partials with per-partial mean/SD/dyn/reg — and a
  Harmonic Editor that IS the dig-down level.
- `spectralStretchCents` — a primitive Inharmonicity macro (piano already
  uses it).
- Instrument resonance tables (broad fixed formants per profile).
- Formant mode: 3 parallel bandpasses (F1–F3) driven by the 2D vowel pad.

## Proposed: three additions

### 1. Partial macro layer (the RipplerX move)

New macro params shaping ALL partials at once, applied as transforms over
the profile's base table (harmonic editor still edits the result):

- `partialTilt` (−1..+1): spectral slope, dB/octave gain ramp.
- `partialOddEven` (−1..+1): odd/even harmonic balance — one knob sweeps
  brass/string (both) toward clarinet/closed-tube (odd) or hollow even.
- `partialComb` + `partialCombFreq`: one movable resonance/anti-resonance
  group — boosts partials near a centre frequency, the "one knob controls a
  related frequency group" request in its most useful form.
- **Octave group gains**: partials grouped by octave relation to the
  fundamental (1 | 2 | 3–4 | 5–8 | 9–16 | 17–32); one small fader each.
  Six faders control 32 partials meaningfully.
- `partialMaterial` (0..1): damping law — per-partial decay rate scaling
  with frequency (see 2). Glass/metal at 0 (all ring), wood/felt at 1
  (highs die fast).

### 2. Per-partial decay (Material — the big realism lever)

Currently every partial shares one ADSR. Real instruments: each mode has
its own T60, generally shorter for higher partials. Implement in
`_renderSpectralPartials`: multiply each partial's gain by
`exp(-t / tau_n)` with `tau_n = tau0 / (1 + material * (n-1)^p)`.
Cheap (one setTargetAtTime per partial), transforms struck/plucked realism
(piano!) and adds body to sustained tones.

### 3. Higher-fidelity formant bank (Resonarium move, formant mode)

Grow F1–F3 to a 5-formant bank (F4/F5 ≈ singer's-formant region) with
per-formant bandwidth and level. The 2D vowel pad stays exactly as it is —
it drives F1/F2 (the perceptually dominant pair); F3–F5 and bandwidths are
"advanced" rows revealed by a disclosure toggle under the pad. Vowel
landmarks gain F4/F5 defaults from published vowel tables.

## UI: progressive disclosure

- Sub-note Fourier panel shows ONLY: profile select, the macro knobs
  (tilt, odd/even, comb, material) and the six octave-group faders.
- "Edit 32 partials" disclosure opens the existing Harmonic Editor
  (paginated 1–16 / 17–32).
- Macros write through to the per-partial arrays (the editor shows the
  post-macro result), so the two levels never disagree; per-partial edits
  become offsets preserved when macros move.
- Formant mode: pad + vowel palette visible; "Formant detail" disclosure
  reveals F3–F5 rows.

## Sequencing

- D7a: partial macro layer + octave group faders (engine transform + UI).
- D7b: per-partial decay (Material) in the renderer.
- D7c: 32-partial support + paginated harmonic editor.
- D7d: 5-formant bank + vowel-pad disclosure rows.
Fits after current producer-mode iterations or interleaved; each lands
independently.
