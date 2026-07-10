# Factory library plan

## Purpose

The factory library is the dependable starting point for the public Sound
Studio. It must let a new creator make a useful musical part immediately, and
must use the same record shape, tags and validation rules as a community
submission. Factory is therefore a quality/source badge, not a separate
library.

## Composition model

The browser's existing sections are the authoring boundary:

| Layer | Preset sections | Job |
|---|---|---|
| Sub-note | `sound`, `space` | What a note/hit sounds like and where it stands |
| Macro | `melody`, `rhythm`, `dynamics`, `surprise` | Pitch vocabulary and behaviour through time |
| Percussion | `percussion` | Expandable role-triggered hit layers (`percLayers`) |
| Patch | `full` | A resolved, immediately playable bundle of modules |

Full patches retain `moduleIds` as provenance, but carry resolved parameters so
the current loader remains backwards compatible. Percussion layers may use a
built-in hit or a single-attack Sub-note instrument; they never rely on the
retired fixed Beat/Motif/Downbeat parameter slots.

## v1 catalog

The factory catalog is exactly 180 authored items:

- 55 Sub-note sound modules: measured-profile foundations, acoustic variants,
  resonators, formant voices, one-shot hit voices and character treatments.
- 65 Macro/percussion modules: 16 melody, 14 rhythm, 10 dynamics, 13
  sequence/surprise and 12 expandable percussion-kit templates.
- 12 space modules.
- 48 full patches: eight each for bass, percussive, melody, atmosphere,
  vocal and experimental roles.

Every entry has a stable ID, plain-language description, role/tags, a
machine-readable brief, a preview fixture, and (for full patches) module
provenance. The generated list replaces the old starter presets entirely.

## Non-human release gates

`scripts/verify_factory_library.mjs` is the factory gate. It must fail if an
entry has an invalid ID/section/parameter key, no brief, an invalid section
boundary, duplicate resolved parameters, unusable percussion layers, or cannot
generate a deterministic musical event stream. It also checks the catalog
coverage/count contract above.

The next increment should add browser-offline audio renders to this script and
measure true peak, silence, DC, tail, loudness, spectral centroid/band balance
and stereo safety. Brief claims then receive bounded expected values for the
fixed seed/pitch/velocity fixtures. Automated checks prove the declared
technical and behavioural brief; listener ratings remain the measure of taste.

## Community parity

Community records should persist the same metadata fields and go through the
same normaliser/verifier before entering the pending queue. Search indexes name,
description, family, role and tags across both sources. Ranking can boost
verified factory items and trusted community work, without hiding either.
