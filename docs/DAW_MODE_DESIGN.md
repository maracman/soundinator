# Producer Mode — Orchestration / Arrangement Design

Owner request (2026-07-03): a DAW-ish section where you build layered
instruments orchestration-style — make a full synth setting, save it, pull it
into the arrangement, and loop over regions. The hard design questions are
parameter scoping (what defaults to session context?) and what happens when
you return to a previously used synth pattern. This doc proposes answers for
sign-off before implementation (roadmap Phase G).

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
