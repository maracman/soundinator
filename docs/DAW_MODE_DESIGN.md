# Producer Mode — Orchestration / Arrangement Design

Owner request (2026-07-03): a DAW-ish section where you build layered
instruments orchestration-style — make a full synth setting, save it, pull it
into the arrangement, and loop over regions. The hard design questions are
parameter scoping (what defaults to session context?) and what happens when
you return to a previously used synth pattern. This doc proposes answers for
sign-off before implementation (roadmap Phase G).

## Layout & interaction reference: Celemony Tonalic (owner cue, 2026-07-03)

Tonalic's arranger demonstrates the interaction model producer mode should
borrow (it independently validates several decisions below):

- **Dual-panel structure.** Upper panel: a rich browse/search/audition
  space for pattern presets ("Tonalics") — filterable by category, shown as
  lists or visual sets, with in-context preview (audition against the
  current session, not in isolation). Lower panel: the arrangement
  timeline where those presets are dragged in as **Regions**.
  → Our producer mode adopts this: instrument/section presets and saved
  patterns are draggable chips in a browser panel; dropping one on a track
  creates a region referencing it.
- **Context adaptation.** Tonalic regions automatically adapt to the
  session's chords, tempo, and groove — exactly our Tier 1 session-context
  inheritance (tempo/key/scale flow into regions unless locked).
- **Region mechanics.** Edge-drag to extend; content re-generates to fill.
  Maps directly to our loop-over-region + deterministic take model.
- **Refine mode.** Clicking a region opens a deep per-note editor
  (Melodyne-style) with focused tools — the exact entry pattern for our
  bake-to-piano-roll editor (G7): arrangement stays simple, depth appears
  on demand.
- **Preview-in-context** is the audition default: preset browsing plays
  against the current session context rather than a canned demo.

## Core objects

- **Instrument** — a saved synth configuration: sound source (formant/fourier
  + all sub-note settings), envelope, vibrato, surprise/sequence config,
  melody-shaping distributions. Everything needed to reproduce "this voice",
  *excluding* session-scoped parameters (below). Built directly on the
  modular preset system (roadmap D3): an instrument is a bundle of section
  presets, so sections stay individually swappable inside an instrument.
- **Pattern** — an instrument playing with particular generative settings
  (motif repertoire config, density, register). Instrument = what it sounds
  like; pattern = what it plays. A pattern always references an instrument.
- **Region** — a placement of a pattern on a track over a time span, with a
  **take** (seed + generative-state snapshot). Regions can loop.
- **Track** — a lane holding regions for one instrument, with gain/pan and
  session-inherit/lock flags.
- **Session** — the arrangement plus the shared musical context.

## Parameter scoping tiers

Three tiers, chosen by the question "if the user changes this mid-project,
what should already-placed material do?"

**Tier 1 — Session context (inherited by all instruments by default):**
tempo, key/root notes, scale (mode + EDO divisions), master dynamics level,
shared space (reverb type/wet/decay), master volume. These define the "room
and the piece". Every instrument inherits them live — change session tempo
and everything follows, like a DAW.

- Per-track **lock/override**: any track can pin its own value for a Tier 1
  parameter (e.g. a drone ignoring key changes, percussion with drier space).
  UI shows a small link/lock icon per parameter: linked = inherits session.

**Tier 2 — Instrument-local:** everything timbral and behavioural — sound
source, formants/harmonics, envelope, vibrato, surprise weights/distances,
incorporation rate, motif count/length, interval shaping, register (stored
as offset relative to session register centre so ensembles transpose
sensibly), articulation, rests. Saved in the instrument; editing the
instrument updates all regions that use it (with an option to "fork" an
edited copy instead).

**Tier 3 — Region-local:** seed/take, loop length, density multiplier,
dynamics offset, mute/solo, and the generative-state snapshot (below).
Cheap per-placement variation without touching the instrument.

## Returning to a previously used pattern (the stateful-generation problem)

Two sources of non-determinism when you revisit a region:

1. **Sampling randomness** — solved by the take model. A region stores a
   seed; playback regenerates deterministically from (instrument params ×
   session context × seed). Looping a region replays the identical take.
   A **Reroll** action draws a new seed (keeping history, so you can go back
   to an earlier take). An optional per-region **Live** mode re-samples every
   loop pass for evolving jam-style playback — off by default, because DAW
   users expect regions to be stable.

2. **Repertoire evolution** — the surprise-incorporation mechanism grows the
   motif repertoire *during* playback, so a pattern's output depends on how
   long it has been playing. Proposal: each region stores a **repertoire
   snapshot** at region start. Default behaviour **Reset per region**: the
   region always starts from its snapshot, so returning to it sounds the way
   it did when you placed it. Per-track option **Evolve across arrangement**:
   the repertoire carries over region-to-region in timeline order for
   through-composed development — still deterministic given the seeds, just
   order-dependent (and the UI should say so).

Net effect: same region → same audio, always, unless you explicitly opt into
Live or Evolve. This also keeps the research property intact: any arrangement
is exactly regenerable from its JSON (seeds + snapshots), so produced music
remains valid, provenance-complete stimulus material.

## Bake: from generative region to editable piano roll (stretch goal, owner 2026-07-03)

**Bake** converts a region's take into a concrete, editable note clip. The
engine already builds the full realised timeline per play (onset, duration,
frequency, degree, velocity, intonation cents, deviations, envelope draws),
so baking materialises that list; the region flips from *generative* to
*baked* while remembering its source (instrument + seed) so "regenerate"
can always reset it.

### Dual pitch representation

Every baked note stores two things:

- `intended_degree` — the scale note it was "supposed" to play; and
- `cents_offset` — the realised intonation deviation from it (the product of
  tuning accuracy/surprise at generation time).

On the roll, the note body sits at its **precise frequency position**
(fractional row placement), while a ghost outline marks the intended scale
row, so you can see both the target and the miss at a glance. Two edit
modes follow directly:

- **Snap-drag** moves `intended_degree` between scale rows (and onsets along
  the beat grid); `cents_offset` is preserved by default, so a
  characterfully flat note stays characterfully flat on its new pitch.
  Modifier-drag (or a toggle) snaps clean, zeroing the offset.
- **Fine-tune** drags `cents_offset` directly with a live ±cents readout;
  double-click resets to 0 (or back to the take's original value).

### Per-note editing and the relativistic-edit problem

Properties fall into three classes, and the class decides what an edit means:

1. **Baked scalars** (onset, duration, intended degree, cents offset,
   velocity): stored absolutely on the note, edited directly.
2. **Instrument-distribution properties** (attack, decay, vibrato depth,
   timbre drift — anything sampled per note from an instrument-level
   distribution): the note stores its **draw** (the quantile/z-score it
   sampled), not the resolved value. Playback resolves
   `value = instrument_distribution(current params) at note's draw`, so
   turning the instrument's attack up later still moves every baked note
   coherently. A per-note edit in the inspector nudges the *draw* (this is
   the relativistic edit — "this note, a bit snappier than its siblings"),
   and an explicit **lock** escalates to an absolute per-note override,
   shown with a badge, immune to instrument changes.
3. **Session context** (tempo, key/root): baked notes live in beat-space and
   degree-space, so they follow tempo and key changes like generative
   material; a key change re-anchors `intended_degree` and offsets ride
   along.

Clicking a note opens a compact inspector (Pitch / Time / Expression tabs)
with per-field "reset to take". Edits are stored as a diff over the take, so
a baked region remains regenerable and partially revertible.

### UI intuitions to preserve

- The roll must read at a glance: body = what you hear, ghost = what was
  intended; drag = musical (snapped), modifier-drag = microtonal.
- Relativistic vs locked edits must be visually distinct (tint vs badge).
- Baking is never destructive: source instrument, seed, and the unedited
  take are retained on the region.

## Other defaults worth stating

- New track's instrument starts linked to all Tier 1 params; overrides are
  opt-in and visually flagged.
- Editing an instrument used by many regions prompts: apply everywhere vs
  fork ("Instrument 2").
- Regions render on a shared master bus (existing limiter + planned soft
  clip); per-track gain/pan pre-bus.
- Arrangement JSON export includes instrument definitions inline so a saved
  arrangement is self-contained and shareable.

## Decisions (owner, 2026-07-03)

1. **Priority:** producer mode builds after the research phases (A–C) and
   the production-quality/preset groundwork (D1–D3) it depends on.
2. **Mode split:** separate entry points sharing the same synth-editor
   component. Volunteers land in simple Explore mode and never see
   tracks/timeline; producer mode reuses the editor as its instrument editor.
3. **Mixdown:** single stereo WAV export; per-track stems deferred.
