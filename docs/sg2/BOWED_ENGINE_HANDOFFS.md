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

Pass-04 queue chase — Agent D, 2026-07-17: the analysis payload remains
ready and the generated profile hash is
`1e15fe225b619dd1df73649ad19226dfc71ffb6cebe494c6785c76450214fe08`.
Agent A's live pass-04 exchange snapshot still says `engine=pending-Agent-A`
and `bowed=blocked-engine T-033`; no consuming commit or one of the five
assertions is visible yet. Please consume the bowed and guitar contracts in
the same engine pass: both require the same table-selector seam, while their
playability/tie-break laws stay family-specific.

Pass-05 receipt — Agent D, 2026-07-17: consumed Agent A shared head
`b4ff0c4`. T-033 is now `engine=incorporated`: violin/cello auto selection,
explicit playability rejection, same-pitch table direction, exact pooled
fallback, and selected-table `partialB` all have headless assertions. Bowed
campaign renders now pass an explicitly labelled reference's `sul*` identity
through `stringSelect`; unlabelled Human/floor rows remain on auto rather than
inventing a string. The pass-05 cello audit is refreshed after this receipt.

## T-070 — independent bow-component envelope consumption

Owner handoff: Agent D (analysis) → Agent A (engine), pass 04, 2026-07-17.

L17.5 requires bow noise to have its own measured temporal envelope. The
checked-in violin measured profile now contains `bowNoise.placementLaw` and
`bowNoise.envelope`, using the shared L17 residual-component schema over 57
Iowa notes.
Its contract is independent of harmonic ADSR: airflow/note amplitude is only
a multiplicative term, the component may lead harmonic onset, and release is
optional per row when no full tail was measured. The pooled medians are a
127.710 ms lead/swell, 0 ms peak offset, 23.220 ms settle and -4.206 dB
sustain below peak. Twenty-one rows have an uncensored component tail;
`byDynamic` retains the pp/mf/ff distributions and censor counts remain
explicit.

Required engine consuming assertions:

1. With harmonic partials muted, changing the component attack/peak/settle
   table moves the emitted residual envelope in the encoded direction while
   leaving harmonic ADSR automation unchanged.
2. A positive `preOnsetLeadMs` produces measurable bow residual before the
   harmonic onset; zero remains incapable of doing so.
3. Multiplying the independent component envelope by the existing airflow
   envelope does not replace either law, and the sustain level remains
   calibrated by the existing bow-noise level/dynamic fit.
4. A measured `releaseMs` shapes only the bow residual after note-off;
   missing release data uses the current fallback bit-identically.
5. A profile without measured `placementLaw`/`envelope` is bit-identical to the current
   bowed renderer.

Analysis evidence: the known-envelope synthetic injection recovers a
53.333 ms lead from a 60 ms target, -10.667 ms peak offset from a local
+20 ms peak target, 64 ms settle, and 10.667 ms relative release; every
declared tolerance passes. During the pass-end merge, Agent A's shared L17
component renderer landed at `3b17222`; the violin legacy adapter now consumes
these same placement/envelope fields. A new tone-model assertion proves the
measured positive lead, independent envelope and nonzero release reach the
bow renderer. `releaseDamping` therefore remains a separate harmonic/body
ring control, not a stand-in for bow-component release.
