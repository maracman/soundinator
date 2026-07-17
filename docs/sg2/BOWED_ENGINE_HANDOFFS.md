# Bowed engine handoffs

## T-033 — per-string partial-table consumption

Owner handoff: Agent D (analysis) → Agent A (engine), pass 03, 2026-07-17.

The checked-in `violin` and `cello` measured profiles now contain
`partialsByString`. Keys are `sulG/sulD/sulA/sulE` for violin and
`sulC/sulG/sulD/sulA` for cello. Each value is the same ordered register
anchor array already consumed from the pooled `partialsByRegister` path:
each anchor has `f0`, `partials`, `partialB`, and `nNotes`. Selection changes
only the table set; the existing f0 interpolation law remains authoritative.

`stringSelect` is `auto` or an explicit instrument-valid `sul*` key and
defaults to `auto`. Open-string MIDI values are violin 55/62/69/76 and cello
36/43/50/57 in low-to-high order. A string covers a MIDI when its open MIDI
is not above the note and its stopped interval is at most 24 semitones.
`auto` selects the lowest-pitched covering string. An explicit selection
outside that interval is invalid. If the selected table or
`partialsByString` is absent, consume the pooled register table through the
current code path with bit-identical PCM.

Required engine consuming assertions:

1. `auto` observes the declared open-MIDI/playability law for both violin and
   cello.
2. At the same playable MIDI, explicit `sulA` and `sulE` synthetic violin
   tables with opposite n≥8 versus n≤4 tilt move rendered high/low energy by
   at least 3 dB in the encoded direction.
3. Removing `partialsByString` is bit-identical to the pre-T-033 pooled
   renderer.
4. An unplayable or wrong-instrument explicit key is rejected rather than
   silently pooled.
5. Per-string `partialB` reaches the oscillator together with the selected
   partial amplitudes.

Analysis consuming assertion (landed): only filenames with an explicit
bowed `sul*` label enter a per-string table; an unlabelled take returns no
string identity and therefore cannot pool into any string table. Tests cover
both the parser and separate same-instrument string aggregation. The JSON
generator and bowed campaign seed preserve the tables unchanged.

Delivery evidence: `web/static/measured_profiles.json` and its generated JS
carry four string tables for each bowed instrument. The engine portion is
complete only when Agent A lands the five assertions above against the real
renderer.
