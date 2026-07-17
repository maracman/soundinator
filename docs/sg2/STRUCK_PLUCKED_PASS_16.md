# Struck/plucked Pass 16 — complete piano-note anatomy

Date: 2026-07-17  
Scope: L18 held-key/damper law first; L16 envelope-anomaly extraction; L17
piano action-noise extraction with independent envelopes; nylon continuation
only after those dependencies.

## Outcome

The live renderer does not implement the owner's piano envelope law. Its
`_adsr` still schedules `envelopeSustain`, while per-mode free decay excludes
the fundamental. The new L18 construction metric makes this audible plateau
an automatic struck/plucked failure. On the existing ship renders, all 10
grand notes and all 21 upright notes fail the plateau-fraction bound. The
engine law and exact consuming assertions are filed to Agent A as T-066.

One synthetic-gated extractor now measures the four composed anatomy parts:
baseline/two-stage hold decay, a separate damper knee, envelope-deviant
partial/band classes, and pinned pre-onset action noise with its own fitted
envelope. It passes injected harmonic-rank, fixed-Hz, action-lead, damper-rate,
and high-frequency-damping recoveries before either real corpus is admitted.
Durable artifacts are under `sg2-data/analysis/piano-anatomy/`.

Nylon spectral fitting did not resume. L18 changes the render graph against
which every partial/mel/band residual is measured; optimising the old graph
would make the residual comparison stale immediately. T-066 is therefore the
named engine blocker for grand, upright, and nylon continuation.

## L18 — held key is free decay; release is damper re-contact

### Construction assertion

`FeatureBundle` now carries `hold_decay_db_per_s` and
`hold_plateau_fraction`. Every strike/pluck ship render must have:

- hold slope <= -0.30 dB/s; and
- less than 50% of 250 ms hold windows effectively flat (within +/-0.15
  dB/s).

The new `*.free-decay-no-plateau` construction row fails the whole family if
one rendered note plateaus. The scorer/audit contract advances to
`sg2-score-release-tail-struck-hold-v6`; every earlier controllability audit is now
intentionally stale until the engine consumer lands and is re-audited.

| Existing ship render | Notes measured | Median hold slope | Median plateau fraction | L18 result |
|---|---:|---:|---:|---|
| Grand piano | 10 | -38.791 dB/s | 0.597 | **FAIL 10/10** |
| Upright piano | 21 | -35.902 dB/s | 0.619 | **FAIL 21/21** |
| Nylon guitar | 6 | -11.762 dB/s | 0.161 | PASS metric, but old ADSR semantics still blocked |

The large overall negative slopes do not rescue the pianos: decaying upper
partials fall onto a plateaued fundamental, which the sliding plateau metric
detects.

### Damper-tail fit

The synthetic fixture recovers a 120 dB/s note-off knee and positive
frequency exponent. Real `hasRelease` rows were then audited for a distinct
final knee rather than treating “file reaches its floor” as proof of key-off.

| Corpus | Full-tail rows | Distinct final knees | Physically qualified register rows | Status |
|---|---:|---:|---:|---|
| Iowa grand | 10 | 10 | 2/5 (bass, low-mid) | blocked — mid/treble coverage incomplete |
| VSCO upright | 21 | 6 | 0/7 | blocked — non-positive fitted frequency exponents |

Grand bass/low-mid rates are retained as diagnostics: 342.151 and 568.963
dB/s at the fundamental, with positive exponents 0.1278 and 0.0086. Negative
or missing exponents remain diagnostics and are not emitted as engine values:
they indicate edits/fades, room-floor crossings, or insufficient upper-mode
evidence rather than the owner-specified high-first damper contact. Acquisition
needs note-off-aligned, lossless damper takes in the uncovered registers.

## L16 — envelope-anomalous frequencies

The extractor tracks per-partial and 1/6-octave envelopes, fits a robust
instrument baseline `earlyRate = intercept + slope*log2(f/440)`, then requires
cross-note commonality, excess early decay, and a positive onset-vs-velocity
slope. Class homes are measured, never guessed.

| Result | Grand | Upright |
|---|---|---|
| Harmonic-rank deviants | 14 classes | 12 classes |
| Lowest robust ranks | 4, 7, 10, 14, 15 | 2, 9, 10, 11, 12 |
| Fixed-Hz deviants | 0 | 0 |
| Engine home supported | hammer/excitation rank classes | hammer/excitation rank classes |

The grand/upright sets overlap only partly and have different lowest classes.
That is the requested free validation: the extractor did not copy one generic
piano transient table. The absence of real fixed-Hz classes is also retained
as negative evidence, even though the synthetic 2.8 kHz fixture proves that
the fixed-Hz branch is detectable. T-068 files the immutable class schema and
render consumer to Agent A.

## L17 — piano action noise as the pre-onset validation case

The synthetic component recovery passes with a measured positive lead,
immutable spectrum, and independent point envelope relative to harmonic tone
onset. The preset construction consumer is mandatory:
`*.pre-onset-component-active` requires a pinned component to have level > 0,
an envelope explicitly independent of harmonic ADSR, a non-flat fitted
pre-onset transient with a measured post-peak fall, and rendered median
`noise_lead_ms >= 3`.

| Corpus | Result | Evidence |
|---|---|---|
| Iowa grand | measured | 5 usable lossless notes; pp profile from 2 pitches (peak -5 ms, -20 dB release 5 ms) and ff profile from 3 pitches (peak -25 ms, release 25 ms); pooled median lead 81.270 ms; 2 rows rejected for no usable pre-roll and 3 for no >=8 dB broadband pre-strike transient |
| VSCO upright | insufficient pre-roll | all 21 files begin within 2–3 ms of action/strike; no grand values transferred |

T-067 files the shared negative-time scheduler and independent-envelope
consumer to Agent A. No action component is activated in a preset until that
consumer assertion passes. The upright needs source files with genuine
pre-roll; this is a corpus gap, not permission to infer action noise from the
grand.

## Controllability contracts

These are the last clean exact-objective audits. They remain useful evidence
of the old objectives, but v6 correctly invalidates them for any new fit.

| Preset | Audit | Clean then | Objective hash | Manifest hash | v6 status |
|---|---|:---:|---|---|---|
| Grand piano | pass01-expected-f0 | yes | `0d7049c213ec83d5` | `54da9dc108d5d927` | stale — L18 consumer pending |
| Upright piano | pass01-tail-audited-fit-contract | yes | `8d662c2c3a6879be` | `54da9dc108d5d927` | stale — L18 consumer pending |
| Nylon guitar | pass15-band-attack | yes | `7bb86235d85a5123` | `340412ce5aa8a9ca` | stale — L18 consumer pending |

No positive-weight uncontrolled feature was present in any of those exact
contracts. A fresh audit is mandatory after T-066/T-067/T-068 consumption;
L16/L17 weights remain zero until their exact engine responders pass it.

## Gate table

The tripwire counts are generated from the latest comparable run summaries;
the L18 row is the new Pass-16 construction result. No preset is described as
shipped or interim-shippable.

| Gate | Grand | Upright | Nylon |
|---|:---:|:---:|:---:|
| Legacy baseline present | PASS | PASS | PASS |
| Latest comparable construction | FAIL (8/10) | FAIL (9/10) | FAIL (10/11) |
| L18 no-plateau construction | **FAIL (10/10 notes)** | **FAIL (21/21 notes)** | PASS metric; semantics blocked |
| Latest comparable tripwires | FAIL (7 pass / 40 fail / 13 N/A) | FAIL (2 / 80 / 44) | FAIL (6 / 18 / 12) |
| L16 extractor synthetic gate | PASS | PASS | PASS method-only |
| L17 preset activation | BLOCKED engine | BLOCKED corpus + engine | N/A |
| Resource tripwire | PASS | PASS | PASS |
| Distributional ship gate | INSUFFICIENT | INSUFFICIENT | INSUFFICIENT |
| Reference-variability floor | INSUFFICIENT | INSUFFICIENT | INSUFFICIENT |
| Owner listening | OPEN | OPEN | OPEN |
| Leaderboard updated | NO | NO | NO |

## Prior and leaderboard state

| Preset | Required prior row | Last resolved ship hash |
|---|---|---|
| Grand piano | `piano-grand <- legacy piano (true legacy)` | `523993362b2a1140803bf4dedbd81bc43b624719f88cbcf2580092c0ec840f30` |
| Upright piano | `piano-upright <- legacy piano craft; fitted upright identity` | `45f8b3247e07a86e0854b2dfcf8dbaa4ffcd5e418603a3bda14ac3443b616e7e` |
| Nylon guitar | `guitar-nylon <- legacy piano craft adapted to pluck` | `0f99e1a4334d0032` |

All three `sg2-data/state/<instrument>/leaderboard.json` backstops are
byte-identical to their live run leaderboards. No Pass-16 candidate was
eligible to replace a best.

## Exchange status

Generated from the live exchange file for this pass's new obligations:

| Entry | Struck/plucked status |
|---|---|
| T-066 held strike/pluck + damper law | analysis assertion incorporated; engine pending Agent A; physical damper table incomplete |
| T-067 pinned pre-onset independent envelope | extraction and preset assertion incorporated; engine pending Agent A; upright pre-roll blocked |
| T-068 envelope-deviation classes | both-piano extraction incorporated; engine pending Agent A |
| T-059 criterion drift | no optimiser step this pass; no fabricated edge |
| T-060 release audit | adapted; full-tail is no longer conflated with proven key-off |
| T-063 measured Human episodes | adapted; no new Human range emitted without qualified consumers |

## Exit state and pending mandates

Exit state §2.5(b): named, evidenced limiting factors with filed fixes.

1. T-066: Agent A must remove struck/plucked sustain semantics, include mode
   1 in free decay, and consume per-register frequency-dependent damper rates.
2. T-067: Agent A must support negative-time pinned components with their own
   fitted envelopes; grand activation remains blocked until the exact consumer
   passes.
3. T-068: Agent A must consume pinned envelope-anomaly classes before their
   measured assignments enter piano presets.
4. Acquire note-off-aligned lossless damper takes for grand mid/treble and all
   upright registers, plus upright takes with genuine pre-roll.
5. Re-run exact controllability audits and piano/nylon fits after the engine
   changes. Nylon resumes at partial/mel/band-balance 0/6 only then.

No owner decision is required. The blockers need engine consumption and
better-scoped evidence, not a policy choice.

## Verification

- Synthetic L16/L17/L18 round trip: PASS.
- Targeted L16/L17/L18 Python tests: PASS.
- Full Python suite (project Python 3.12): PASS.
- `npm test`: 11/11 PASS.
- `node scripts/verify_tone_model.mjs`: PASS.
- `node scripts/render_note.mjs --verify`: PASS,
  `6aabb93a16f7cd9677fcf96f66adba9f477299ddde718be1b7420681c176c562`.
- Listening page rebuild: PASS (ship mode, fresh seeds).
