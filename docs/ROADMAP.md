# Roadmap — every recent feature request and the execution plan

Single source of truth for what was asked, what's shipped, and how the
rest gets built. Verbatim owner quotes:
[OWNER_BRIEF_2026-07-07.md](OWNER_BRIEF_2026-07-07.md). Tone-model
design detail: [TONE_MODEL_V2_DESIGN.md](TONE_MODEL_V2_DESIGN.md).
Producer detail: [PRODUCER_V3_SPEC.md](PRODUCER_V3_SPEC.md).
Updated 2026-07-07. Historical loop phases A–H are archived at the
bottom of this file.

---

## 1 · Ledger — requests and status

### Shipped (commit · build)

| Request | Asked | Landed |
|---|---|---|
| Tone model v2: excitor→resonator→body→space, true-ratio transfer, bow imperfection replacing amplitude probability, 64 partials, character variables surfaced | 07-05 brief | T1–T8, 97+ physics assertions |
| CHORDA sub-note UI ("hard move over to that design") | 07-06 | stage rail + inspectors + tone print + lens |
| Space v1: distance/angle positioning, arrival delay, air absorption, proximity effect | 07-06 | space pad + headless laws |
| Producer v3 overnight rebuild: undo/redo, loop range, seed chips, split/duplicate, drop preview, dbl-click create | 07-06 | blocks E/A/B1/D1 |
| Roll batch: intended-vs-realised duration/onset ghosts, velocity pins behind a checkbox, ⇧ micro-drag off grid, grid/scale/key readout, drop-location preview, "incorporated" not "baked" for surprises | 07-06 | `9ac003a` v141 |
| Formant/body rethink: articulation manipulates the SELECTED body; click each formant to see its EQ in the field; per-band more/less extreme; bodies as editable presets | 07-07 | `aaf2914` v143 |
| Realistic presets from downloaded samples (measure-and-fit, no audio ships) | 07-06 | `b08b37b` + `9e6b913` v145 (7 instruments) |
| P1 Arpeggiator: up/down over the same interval notes | 07-07 brief | `270b50b` v146 |
| Surprise walk-only in arps + can't-turn-surprise-off bug | 07-07 | `151823a` v147 |
| CH-B2 performance block: draggable ADSR, vibrato, onset-noise scaling in EXCITOR | tone audit | `fb76fbb` v148 |
| P2 family starter patches: percussive / bass / atmos / melody + library family filters | 07-07 brief | `b17a63a` v149 |
| P3 note connection: glide (mono) ↔ ring (multiphonic) where glide lives | 07-07 brief | `da5111b` v150 |

### Queued — build order (Q1 first)

| # | Request | Source |
|---|---|---|
| Q1 | P4+P11 patch transparency in producer + macro/subnote module halves | brief + notes batch 2 |
| Q2 | P5 remove standalone global reverb (room/cathedral type → Global Space only) | brief, owner-clarified |
| Q3 | P6 baked-note drill-down (per-note glide, envelope, vibrato, tuning…) | brief |
| Q4 | P7 binaural head model + space in front AND behind | brief |
| Q5 | P8a global scale strip above the timeline | brief |
| Q6 | P8b global space designer (cylinder + cross-section) | brief |
| Q7 | CH-B5 layered subnote modules (coloured block strip) | audit + notes batch 2 |
| Q8 | CH-B4 imperfections (pitch scoop, attack stagger, release ring, f0 wander) | tone audit |
| Q9 | Producer remainders: roll parity, multi-select, track headers, onboarding | producer spec |
| Q10 | P10 MIDI recording + the three N-EDO keyboard-mapping choices | notes batch 2 |
| Q11 | P9 whole-app vocabulary audit | brief |
| Q12 | CAPSTONE: browser QA screenshot sweep + adjustable/resizable panels | 07-07 morning |

### Requires owner decision (docs to write, no build)

- **Harmony instrument patches** — distinct from overlap-multiphonic and
  from sub-note layering. Proposal to spec: a voicing layer on the
  melody walk (chord degrees in scale-degree space, satellite voices per
  generated note, composes with arp mode).
- **Hosting / monetisation** — moat analysis + sharing-platform write-up.

---

## 2 · Execution plan

Ordering rule: engine data before the UI that reads it; the head model
(Q4) before the space designer (Q6) that edits it; vocabulary (Q11) and
QA (Q12) last so they sweep finished surfaces.

### Q1 — Patch transparency + module halves (producer)
**What.** Regions/palette entries surface: surprise on/off + which
dimensions (P·T·R·F·D·rest), scale name + number of splits, grid
divisions, the patch's original tempo with a "set session tempo to
this" action, and a glide/ring badge. Patch browser gains a
filter-by-splits control. The palette loads a preset into the MACRO
half or the SUBNOTE half of an instrument independently, with the
active half unmistakably visible.
**How.** Patches already store full params — derive all badges at
render time, no schema change. Adopt-tempo writes arrangement.tempo.
Half-loading merges preset params filtered through PRESET_SECTIONS
(sound → subnote half; melody/rhythm/dynamics/sequence → macro half);
palette chips get a two-segment target switch.
**Verify.** Badge truth vs params headlessly; adopt-tempo determinism
(stimulus ids stable); live click-through.

### Q2 — Global reverb removal
**What.** The standalone reverb card leaves the macro production tab;
each patch keeps its own space. Reverb TYPE (room/cathedral…) returns
only inside the Global Space Designer (Q6) as a property of the shared
performance space.
**How.** Remove section markup; one-time migration folds saved global
reverb values into patch space params on load. Engine reverb path stays
(per patch).
**Verify.** Old presets A/B render identically; the card is gone.

### Q3 — Baked-note drill-down
**What.** Click a baked note in the roll → card showing what varies per
note but isn't drawn: glide in/out, the envelope draw actually used,
vibrato draw, vowel position, tuning deviation, micro-timing, velocity.
**How.** renderSpan already computes these — persist the per-note draw
record at bake time (region.notes[i].performance); read-only card
first, editing later through the same record.
**Verify.** Drill-down values equal the audible render params in a
headless bake; live click-through.

### Q4 — Binaural head model + front/behind (owner design confirmed)
**What.** earDistance (0.12–0.25 m) drives interaural time difference;
headDensity (0–1) drives the far-ear level shadow; a pinna filter makes
behind audibly different from in front ("head size" was the redundant
third — it IS ear distance). The space pad becomes a full circle.
**How.** Replace the HRTF panner with an explicit per-ear chain:
delay (Woodworth ITD = (d/2)(θ+sinθ)/c) → lowpass+gain (ILD × density)
→ merger; sources behind get a high-shelf cut + ~8 kHz notch scaling
with |angle| beyond ±90°. Pure functions (itdSeconds, ildDb,
pinnaParams) so the laws are headlessly testable; keep the v1
distance/air/proximity laws.
**Verify.** ITD zero at 0°/180°, max at ±90°, scales with earDistance;
ILD grows with density; notch only behind; live left/right flip.

### Q5 — Global scale strip (P8a)
**What.** Collapsible strip above the timeline. User drops MARKERS; per
marker a mini piano-roll where clicking a division cycles its operator:
in-scale / out-of-scale / sub-scale / tonic (same operators as
patches). Tracks opt in per track; opted-in tracks follow the marker
from its beat onward. Baked notes never change.
**How.** arrangement.globalScale = [{atBeat, degrees, subs, roots}];
regionPlayParams merges marker state over track params for opted-in
tracks (same merge point as track.space). Baked regions replay stored
notes, so they bypass by construction.
**Verify.** Headless: opted-in render follows the marker, opted-out
unchanged, baked region byte-identical.

### Q6 — Global space designer (P8b, after Q4)
**What.** Two linked views per the owner's spec. CYLINDER: collapsible
above the timeline, horizontal along time, the space implied only by
each instrument's THREAD (distance + radial angle around the listener);
slow slight rocking conveys depth; dragging vertically rolls the space
and it snaps back on release. CROSS-SECTION at the playhead: the head
(ear distance/density) and each track as a dot; selected track
highlighted; drag position or add anchors — first anchor auto-creates
start+end anchors, double-click adds more, dragging an anchor curves
between neighbours by chosen smoothness, non-anchored drags snap back;
clicking a highlighted anchor jumps the playhead. On activation:
"smartly arrange instruments in space, or keep patch positions?"
Override-or-offset per that choice; owns head params + reverb type.
**How.** arrangement.space = {head:{earDistance, density, reverbType},
tracks:{id:[{beat, angle, dist, smooth}]}}; per-frame interpolation
feeds the Q4 chain. Two canvases, pseudo-3D line rendering, no libs.
**Verify.** Interpolation assertions (smoothness 0 = linear, anchors
hit exactly); live drag/anchor/playhead interactions; determinism.

### Q7 — Layered subnote modules (CH-B5, per notes batch 2)
**What.** ＋ adds the current subnote module as a layer; coloured
blocks along the bottom, one per layer; per-block distance/position and
volume; every new layer inherits head size/density unless "independent
head"; block strip offers "override envelope probabilities" to drive
all layers' envelope variation in sync.
**How.** params.layers = [{subnoteParams, space, gain, independentHead,
envOverride}]; engine renders layers as ONE stream — union of partials
with cross-layer transfer coupling (the T-series law is already pure);
single seed. The sync override reuses envelopeProbBlockHTML verbatim
(built liftable in CH-B2 for exactly this).
**Verify.** Layered fingerprint = union with coupling; sync override
yields identical envelope draws across layers; per-layer space audible.

### Q8 — Imperfections (CH-B4)
Onset pitch scoop (excitation-scaled f0 approach) → attack stagger (the
measured lowToHighStaggerMs is already in the fit JSON) → release ring
(T60 tail after note-off) → slow f0 wander. Each one: a pure law + an
assertion + a knob only if audible.

### Q9 — Producer remainders
D2 roll parity (pencil add, ⌫ delete, M note-mute, Q quantize, arrow
nudges, audition-on-edit) → B2 multi-select (⇧click, rubber-band, bulk
ops) → C track headers (hue, dB readout, per-track space mini-pad —
folds into Q6's data) → F onboarding + ? shortcut overlay. Also:
relabel Key as "Key (root pitch)".

### Q10 — MIDI recording (P10)
**What.** Web MIDI input, record-arm per track. Incoming notes override
melody/duration/dynamics; the patch still supplies glide/ring,
envelope-probability draws, and the whole subnote voice. The three
owner mapping choices become a per-patch MIDI-map setting: (1) white
keys only vs white+black; (2) all subdivisions mapped vs all mapped
with out-of-scale muted vs in-scale packed consecutively; (3) degree 0
anchored to C repeating at the next C vs repeating at the very next
key. Recorded notes are baked notes (Q3 drill-down applies).
**Verify.** Mapping-table assertions for every option combination; live
via synthesized MIDIMessageEvents (virtual device if available).

### Q11 — Vocabulary audit (P9)
Full-surface terminology pass: replace jargon where a plain word exists;
hover explainers where a term must stay; produce a terminology table in
docs so future features stay consistent.

### Q12 — QA capstone + adjustable panels
Screenshot sweep of every view (macro, sub-note × 4 stage inspectors,
producer, roll, library, welcome) at ≥3 widths via preview_resize
(1280 / 1000 / 768); fix every quirk found; then the layout rework:
draggable column dividers + grid minmax so panels adapt and nothing
becomes unreachable on resize (known offender: the BODY inspector's
271 px scroll-clip; the dashboard's overflow:hidden at 790 px).

---

## 3 · Working discipline

pytest + `node scripts/verify_tone_model.mjs` before every commit;
cache-buster bump on every change; live browser verification with a
window.onerror probe before claiming done; one reviewable commit per
chunk; milestone reports to the owner; web/data/ stays gitignored;
sample audio never enters the repo — only fitted parameters.

---

# Archive — original loop phases A–H (2026-07-03 → 2026-07-06)

Historical working state, kept for provenance. Everything below is
superseded by the ledger and plan above (producer v2 was signed off and
rebuilt as v3; tone v2 audition passed; formant mode was retired into
articulated bodies).

- **Phase A — study flow** (A1–A5 done): stimulus identity + provenance,
  rate-what-you-hear, plain-language opt-in consent, parameter-change
  telemetry, server hardening (locked appends, validation, rate limits).
- **Phase B — expectancy instrumentation** (B1–B4a done): per-note
  surprisal, repetition metrics, metrics-1.0 summaries on events,
  research machinery invisible to lay users, continuous vowel space.
- **Phase C — export & regeneration** (C1–C3 done): export CLI → CSVs,
  token-gated /api/export.csv, exact stimulus round-trip from seeds.
- **Phase D — production quality** (D1–D7 done): soft clip + master EQ +
  click-free stop, defaults, modular section presets, factory starters,
  per-instrument performance + attack noise, per-panel preset bars,
  partial macros / material damping / 32 partials / 5-formant bank.
- **Phase E — deployment** (E1–E3 done): health endpoint, DEPLOYMENT.md
  runbooks, endpoint test suite.
- **Phase F — UI/design** (done exc. F3c-2b, folded into producer line):
  responsive hero, FabFilter-inspired reskin, Tonalic preset browser,
  vowel pad, hover readouts.
- **Phase G — producer**: v1 → owner rejection ("rethought from the
  ground up… like Pro Tools or Logic") → v2 rebuild (P1–P7 + U0–U13) →
  signed off → superseded by v3 (PRODUCER_V3_SPEC.md).
- **Phase H — tone model v2** (T0–T8 done): physics chain, audition
  passed, formant mode retired into articulated bodies.
- **Cross-cutting**: GitHub Actions CI (pytest + node --check); 20-test
  endpoint/behaviour suite.
