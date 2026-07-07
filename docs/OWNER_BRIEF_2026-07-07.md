# Owner brief 2026-07-07 — patches, space, producer universals

Verbatim intent captured from the owner; sequencing + design notes added.
Supersedes ordering of the previous producer queue where they overlap.

## P1 — Arpeggiator (melody pattern mode)

Owner: "Can we build something like an arpeggiator with existing macro
settings? If not we should add sufficient parameters… Doesn't need to
change chord, just go up and down over the same interval notes."

Audit answer: NO — the Markov walk can bias toward runs (momentum +
peaked intervals) but cannot produce a strict deterministic cycle.

Build: `melodyPattern` = `walk` (default, current) | `arpUp` | `arpDown`
| `arpUpDown`. Arp note set = scale degrees within `intervalRange` above
the root (in-scale, existing operators apply), plus `arpOctaves` (1–3).
Deterministic ordering, seeded phase; duration/rest/dynamics machinery
unchanged on top. AMENDED (owner): surprise does NOT apply to arp
patterns — arps are deterministic by contract; surprise is walk-only
(engine-gated, DONE with the all-dimensions-off fix). Macro UI:
segmented control in MELODY.

## P2 — Factory patch families (need P1 first)

- **Percussive**: not the percussion engine — pitch-flat (registerWidth ~0,
  root-locked), tight consistent duration/rhythm, percussive envelope
  (instant attack, fast decay, low sustain), strike excitation, hard
  hardness, high attack-noise.
- **Bass**: low register, mono, narrow intervals, longer notes, darker
  body, sits low in the mix (gain default).
- **Atmos**: slow attacks, long release, high reverb/space distance,
  sparse onsets, wide register drift, gentle surprise.
- **Melody**: mid register, walk mode, moderate surprise, singing body.

## P3 — Note connection: glide ↔ overlap multiphonic

Owner: "Ability to have multiphonic when notes overlap (should be set in
the same place as where you say if there is a glide between notes)."

One control cluster ("Note connection"): mono+glide (current slideSpeed
behaviour) vs polyphonic let-ring (overlapping notes keep ringing —
engine stops stealing the voice; releases overlap next onsets).

## P4 — Patch transparency in producer

Regions/palette chips surface: surprise on/off + WHICH dimensions,
scale (+ splits count), grid divisions, original tempo with
"set session tempo to this", poly/mono badge.
Patch browser: filter by number of scale-split separations.

## P5 — Remove global space/reverb (scope clarified by owner)

Each patch owns its own space. The reverb space TYPE (room, cathedral,
etc.) lives ONLY in the producer section, as part of Global Space —
i.e. the room character is a property of the shared performance space
when Global Space is active, not a per-patch or standalone-global knob.
Remove the standalone global reverb section from the macro production
tab; migrate saved global values into per-patch defaults on load; the
type selector reappears inside the Global Space Designer (P8).

## P6 — Baked-note drill-down

Click a baked note (roll) → inspector for per-note data not drawn in the
roll: glide in/out, envelope actually used, vibrato draw, formant pos,
attack noise, tuning deviation, per-note space offset. Read-only first;
editable later.

## P7 — Binaural head model + front/behind space

Owner: ear-to-ear distance, head size, head density — "maybe one is
redundant"; ear-shape modelling so front vs behind is audible.

Design: head size IS ear distance (redundant — confirmed). Parameters:
- `earDistance` (0.12–0.25 m): interaural time difference — per-ear
  DelayNodes, ITD = (d/2)(θ+sinθ)/c (Woodworth).
- `headDensity` (0–1): interaural level difference — far-ear lowpass +
  attenuation scaling.
- Pinna front/back filter: sources behind get the ear-shape spectral
  cue (high-shelf rolloff + ~7–9 kHz notch, depth by |angle| beyond
  ±90°). Space pad becomes a full circle (front AND behind).
Replaces/augments the HRTF PannerNode with an explicit, parameterised
chain so the owner's knobs are real. Headless assertions on ITD/ILD laws.

## P8 — Producer universal settings

### Global scale
- Collapsible strip above the timeline; user adds MARKERS; per marker a
  mini piano-roll where clicking a division cycles its operator:
  scale / out-of-scale / sub-scale / tonic. Same operators as patches.
- Per-track opt-in ("use global scale"). Overrides track scale params
  from the marker onward. Baked notes never change.

### Global space designer (after P7)
- Overrides patch space, or uses patch position as an offset (user choice
  on activation) and owns listener head params (ear distance, density).
- Cylinder view: collapsible above timeline; horizontal cylinder along
  time implied only by instrument THREADS (position = 2D around listener:
  distance + radial angle). Slow slight rocking to convey 3D; drag
  up/down rolls the space, snaps back on release.
- Cross-section view at playhead: head (size/ear distance/density),
  each track a point; selected track highlighted. Drag position or add
  anchors (first anchor auto-creates start+end anchors; double-click to
  add; drag anchor curves between neighbours by chosen smoothness;
  non-anchored drags snap back).
- Selected track highlights its thread + anchors; clicking an anchor
  moves the playhead there.
- On first activation: prompt "smartly arrange instruments in space, or
  keep patch positions?"

## P9 — Vocabulary audit

Whole-app pass: precise, non-jargon terms; where a term must stay,
hover explainers. Aligns with the capstone QA pass.

## Capstone (from 2026-07-07 morning)

Full browser QA sweep with screenshots at several window sizes; fix
quirks/inconsistencies; adjustable/resizable panels so a resized window
never hides sections.

## P10 — MIDI recording (owner notes, second batch)

- MIDI controller input records into the producer, overriding most of
  the patch's duration/dynamics/melody; the patch still supplies glides,
  homophonic-vs-poly behaviour, and all probabilistic synth settings
  (e.g. envelope probability draws).
- N-EDO keyboard mapping options:
  1. white keys only vs white+black;
  2. all subdivisions mapped (out-of-scale playable) vs all mapped but
     out-of-scale MUTED vs in-scale-only packed consecutively;
  3. degree 0 anchored to C repeating at the next C vs repeating
     immediately at the next key after the scale wraps.
- Needs Web MIDI API; record-arm per track; captured notes become baked
  notes (drill-down P6 applies).

## P11 — Modules: macro engine × subnote module (second batch)

Each instrument patch = a MACRO ENGINE + a SUBNOTE MODULE. Presets load
into either half independently while the other stays put. Navigation and
visibility of which half you're editing/loading must be intuitive —
merges with P4's palette composition ('tone × behaviour' labels).

## CH-B5 amendment — layered subnote modules (second batch)

- In the sub-note view, a ＋ adds the current subnote module as a LAYER;
  layers build a strip of coloured blocks along the bottom.
- Per-block controls: distance + position (space) and volume.
- Head model: every new layer inherits the same head size/density;
  a per-layer 'independent head' toggle detaches it so edits stop
  affecting all layers at once.
- Block strip also offers 'override envelope probabilities': removes the
  per-layer envelope variation draws and drives envelope probability for
  ALL layers from one place so they vary in sync.
- Implication for CH-B2: envelope-probability controls must be built as
  a liftable unit (one component, param-scoped) so the layer override
  can reuse it.

## Requires thought (no build yet — owner to react)

- **Harmony instrument patches**: distinct from overlap-multiphonic
  (temporal) and sub-note layering (same fundamental). Proposal: a
  voicing layer on the melody walk — patch declares chord degrees in
  scale-degree space; each generated note carries satellite voices;
  composes with arp mode. Spec before building.
- **Hosting/monetisation**: moat = shared patch/arrangement library w/
  attribution + remixing (network effects outlive the framing novelty);
  free studio + hosted sharing, paid private libraries/exports/collab;
  research/education niche as a defensible anchor. Write-up owed.

## Existing queue folded in

CH-B2 (performance block → EXCITOR, ADSR canvas), CH-B4 imperfections,
CH-B5 layering, D2 roll parity remainder, B2 multi-select, C track
headers, F onboarding — interleave where they touch the same code
(e.g. CH-B2 envelope work pairs with P2 percussive envelopes; C track
headers pair with P8 space designer).
