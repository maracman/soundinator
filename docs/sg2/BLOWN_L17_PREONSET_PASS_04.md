# Blown L17 pre-onset component pass 04 — 2026-07-17

## Scope and outcome

This pass implements owner L17 for flute, clarinet and alto sax. Wind breath
is now a shared pinned-noise component rather than a colour attached to the
harmonic tone ADSR: lossless cross-pitch extraction, a synthetic round-trip
trust gate, separate pp/ff spectra, measured pre-onset placement, and an
independently scheduled swell/peak/settle/sustain/release envelope all reach
the renderer. The component keeps the existing wind level, velocity,
turbulence and body-routing laws as multiplicative terms.

The engine-wide SHIP activation gate covers every applicable factory preset,
the legacy violin bow component, and arbitrary parameter files through
`scripts/audit_pinned_components.mjs`. It rejects both a neutral component
control and a silent upstream `toneBreath` law. The three r5 ship presets carry
explicit `windBreathLevel: 1` and have durable passing PARAM audits.

No identity leaderboard is promoted: construction, strict tripwire and
two-sided distribution gates still do not all pass. Exit state for all three
instruments is **limiting-factor**, with concrete follow-up work items in
`sg2-data/state/<instrument>/work-items.json`.

## L17 extraction and trust gates

The L14 implementation remains canonical in `bow_noise.py`; L17 generalises
that separator and campaign interface rather than forking it. Every accepted
real source is lossless PCM AIFF/WAV, and every instrument is bound to the
same passing engine-synthetic recovery artifact:

- correlation `0.9655` (minimum `0.90`);
- median absolute shape error `1.515 dB` (maximum `1.6 dB`);
- p95 absolute shape error `1.998 dB` (maximum `4 dB`).

| Instrument | Real evidence | Retained bands | Cross-pitch median shape error | pp / ff `noise_lead_ms` | Dynamic pooling |
|---|---:|---:|---|---:|---|
| Flute | 3 pitches × pp/ff | 30 | pp `1.929 dB`; ff `2.172 dB` | `81.270 / 34.830` | rejected; separate tables |
| Clarinet | 3 pitches × pp/ff | 28 | pp `1.766 dB`; ff `0.862 dB` | `267.029 / 23.220` | rejected; separate tables |
| Alto sax | 32 pitches × pp/ff | 26 | pp runs `2.446/1.464/2.813 dB`; ff runs `2.440/1.983/2.362 dB` | `232.200 / 23.220` | rejected; separate tables |

The first alto three-pitch attempt correctly failed at `5.086 dB` pp and
`4.006 dB` ff. Its blocked records remain durable. The installed result uses
64 canonically segmented notes from six Iowa chromatic AIFF runs and passes
the unchanged `<=3 dB` per-run gate; the failed table was never installed.

The fitted envelope tables remain per instrument and dynamic. The renderer
interpolates their measured pre-onset swell, peak offset, settle time,
sustain-below-peak and release, and sends that automation directly to the
component output rather than through the tone ADSR. An offline audio assertion
proves the component is deterministic, audible before harmonic t0, and still
precedes a deliberately slow harmonic attack.

## PARAM-level SHIP activation

| Instrument | Component control | Existing wind law | Effective audited level | Interpolated lead at preset velocity | Gate |
|---|---:|---:|---:|---:|---|
| Flute | `1.0` | `toneBreath=0.375805` | `0.375805` | `54.180 ms` | PASS |
| Clarinet | `1.0` | `toneBreath=0.146847` | `0.146847` | `124.807 ms` | PASS |
| Alto sax | `1.0` | `toneBreath=0.275335` | `0.275335` | `110.295 ms` | PASS |

The factory-preset verifier enumerates every pinned component. This also
closed the two historical violin failure modes: every violin/bow preset now
sets `bowNoiseLevel`, and the Violin Foundation is explicitly asserted active.
The listening-page builder prefers a verified pinned-component SHIP parameter
file when one exists, without rewriting or falsely promoting the identity
leaderboard.

## Fresh §3 candidate and legacy gate table

Candidate rows are fresh r5 FIT evaluations plus six fresh-seed SHIP variants.
Tripwire failures include strict missing cells. Legacy rows come from the
sealed generated legacy-baseline evaluations in
`blown-alternates-r3-isolated`; they remain leaderboard entry 1 and are shown
as the mandatory comparison, not as a fresh L17 claim.

| Preset row | Construction fails | Strict tripwire failures | Distribution pass / little / much | Gate |
|---|---:|---:|---:|---|
| Flute candidate r5 | 4 | 28 | `22 / 35 / 4` | FAIL |
| Flute legacy baseline | 4 | 28 | `4 / 55 / 2` | FAIL |
| Clarinet candidate r5 | 5 | 20 | `6 / 24 / 3` | FAIL |
| Clarinet legacy baseline | 5 | 22 | `3 / 30 / 0` | FAIL |
| Alto sax candidate r5 | 5 | 30 | `13 / 43 / 5` | FAIL |
| Alto sax legacy baseline | 5 | 29 | `1 / 60 / 0` | FAIL |

Relative to the immediately preceding r4 candidate distributions, aggregate
passing checks rise `27 -> 41` and `too-little` falls `121 -> 102`:

| Instrument | r4 pass / little / much | r5 pass / little / much | Evidence change |
|---|---:|---:|---|
| Flute | `10 / 47 / 4` | `22 / 35 / 4` | +12 pass, -12 sterile, no new excess |
| Clarinet | `6 / 26 / 1` | `6 / 24 / 3` | two sterile cells cross into excess |
| Alto sax | `11 / 48 / 2` | `13 / 43 / 5` | +2 pass, -5 sterile, +3 excess |

The mixed clarinet/alto result is preserved rather than hidden by a post-hoc
multiplier. The next lawful step is to clear the first upstream
band-balance/log-mel construction cell, then sweep only non-silent pinned
levels against both strict and two-sided distribution gates.

## Fresh controllability audits

All audits include the same 12 established blown controls plus
`windBreathLevel`, use two active endpoints (`1.0 -> 0.25`), are
repeatability-stable, and have zero uncontrolled weighted features.

| Instrument | Objective hash | Manifest hash | Renderer hash | Initial PARAM hash | Verdict |
|---|---|---|---|---|---|
| Flute | `d30648e15e6cc119` | `d74255af171c3c4e` | `f774d2a4dadffaad` | `d2601c5fe6f66989` | clean |
| Clarinet | `9575c25ca4bd5e68` | `985d2678347588dc` | `f774d2a4dadffaad` | `b79a64cfa48405cd` | clean |
| Alto sax | `c726fc3d732d19ca` | `22e3c4cfa8f8a775` | `f774d2a4dadffaad` | `8608f2b7f3cc372d` | clean |

Flute and clarinet retain their prior final weights. Alto's fresh audit
lawfully moves `decay_log_ratio` from weight 1 to a zero-weight watch metric
because no audited control crosses its response threshold under this renderer;
the r5 alto FIT and SHIP gates were recomputed with that final table.

## Strongest prior and freeze state

| Instrument | Legacy lookup row | Prior row hash | Resolved parameter hash |
|---|---|---|---|
| Flute | `flute <- legacy flute` | `274cb12161abc1efc3b4cce73a918d4d70af1f3334b789988a0ca894b1ff39d5` | `704ba5bbca24f99a4334f2591d9d9287c9957341ecc60848633b76941176b69f` |
| Clarinet | `clarinet <- legacy clarinet` | `53634a68fcca5ff4eb7a0bcfd4a82deca219cd7772cb533f99066e70f7c64593` | `014b7999e44481ccc28f8fce963e196bc66e3d14f966808c757b64963600f849` |
| Alto sax | `alto-sax <- legacy clarinet` | `010f064f9ea3ecf7754c98bba584b6c75301f15a4eb02ac9f50467dc39acbce3` | `dc1f40565e4ddd6ad5f81a8287723c71bf0c91ec4511cff14537dc6f6400ef58` |

No r5 row passes all gates, so no leaderboard best changes. Each durable
leaderboard and selected `best.json` is byte-copied to
`sg2-data/state/<instrument>/`. r5 summaries, variation gates, PARAM activation
audits and work items are durable beside those backstops.

## Exchange, listening and pending mandates

T-064 is generated from the live exchange as engine/analysis incorporated for
all three winds, bowed legacy-compatible, and a method handoff for sung and
struck/plucked. The full generated snapshot is
`sg2-data/state/agent-a-pass04-exchange-statuses.json`.

`sg2-data/listen.html` was rebuilt with fresh seed `1784274682`. Ten sections
re-rendered, including flute, clarinet and alto sax; all three are labeled
`blown-l17-ship-r5 (verified SHIP candidate)` and resolve the passing activation
audit before rendering.

L16 remains an upstream measurement handoff and was not guessed. Room-suspect
residuals remain flagged by the extractor rather than being reinterpreted as
an instrument room model. No owner decision is needed for this pass.

## Verification and exit state

Pass-end commands:

- `npm test`;
- `node scripts/verify_tone_model.mjs`;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`;
- isolated current-worktree `node scripts/render_note.mjs --verify`;
- focused L14/L17 extractor suite and `git diff --check`.

Exit state: **limiting-factor** for flute, clarinet and alto sax. The component
class, extraction evidence, renderer, activation gate, PARAM records and
listening delivery are complete; construction/strict/distribution cells remain
the named next work.
