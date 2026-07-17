# Struck/plucked Pass 17 — measured harp/bar activation and post-L18 nylon continuation

Date: 2026-07-17

Scope: recover and validate the crashed pass; activate measured harp and
glockenspiel identities; prove the live glock render against its bar evidence;
reconcile T-067/T-068/T-069; and resume nylon only under a current post-L18
controllability contract.

## Outcome

The crashed worktree contained two coherent edits: the glock first-render
consumer in `bar_modes.py` and an append-only exchange update. The durable
`pass17-first-fit` artifact exactly reproduced objective
`6671dcb6dd1ab276` and renderer-files hash `95537f15b8134e8e`; a consuming
regression test was added, and the complete suite passed. Both edits were
retained. No crash work was discarded or lost.

Measured source identities are now live for harp and glockenspiel. Harp uses
23 VSCO anchors across wire, gut and nylon courses. Glockenspiel uses six
sounding G5-C8 anchors, a validated free-bar extractor, six-mode economy and
an explicit B=0 campaign firewall. These are evidence activations, not ship
claims.

The first activated glock render fails all three identity gates that require
missing engine controls: measured mode ratios, the 12.3427 corpus median
mode-1/mode-2 T60 hierarchy, and the centre-strike mode-2 dip. T-072 specifies
the required ratio-offset, per-mode T60, free-bar strike-shape and engine B
firewall consumers. Optimisation cannot begin while their objective weights
are correctly zero.

Nylon was reopened after the T-067 free-decay law landed. Its exact current
audit is clean. A nine-key search reduced loss from `4.616871` to `4.338724`,
an absolute `0.278148` or 6.03% improvement in five unique evaluations. The
candidate is not leaderboard-eligible: `guitar.double-decay` still fails,
the spectral tripwire remains 6 pass / 18 fail / 12 N/A, and the six-cell
corpus cannot prove a distributional Human range. The durable run records the
limiting factor and work item rather than promoting a gate-ineligible best.

## Evidence activation

| Preset | Evidence admitted | Measured identity | Activation state |
|---|---|---|---|
| Harp | 23 VSCO notes | wire/gut/nylon course anchors and measured spectral profile | live; current-profile audit still required before fitting |
| Glockenspiel | 6 VSCO mf notes | free-bar ratios, per-mode T60s, centre-strike levels, max 6 audible modes | live evidence; engine controls blocked by T-072 |
| Nylon guitar | 6 Philharmonia cells, low/mid/high x p/f | deterministic spectral/onset cell objectives | current audit and focused fit complete |

The bar extractor's known-source round trip passes at two octaves with
injected ratio offsets `[0,-120,-240]` cents and T60 values
`[3.0,0.35,0.18]` seconds. It therefore distinguishes extraction validity
from renderer controllability.

## Controllability contracts

| Preset | Contract | Status | Objective | Manifest | Action |
|---|---|:---:|---|---|---|
| Grand piano | pre-v6 pass01 audit | stale | `0d7049c213ec83d5` | `54da9dc108d5d927` | no fit; T-068/T-069 preset consumers remain neutral |
| Upright piano | pre-v6 pass01 audit | stale | `8d662c2c3a6879be` | `54da9dc108d5d927` | no fit; no >=10 ms pre-roll row exists |
| Nylon guitar | `pass17-l18-reopen` | **clean/current** | `151b91aa63c04c54` | `340412ce5aa8a9ca` | nine audited keys fitted |
| Harp | `pass17-first-fit` recovery residue | **incomplete/superseded** | none emitted | none emitted | no fit; saved base predates profile activation |
| Glockenspiel | `pass17-bar-contract` | **failed required controls** | `4d4f2dabe5197a86` | `e92a9a40b4fc69c8` | ratio/T60/position weights zero; B excluded |

The nylon audit uses scorer `sg2-score-release-tail-struck-hold-v6`, renderer
contract `3629da50977f0fc1`, initial hash `3fed4ad7c40f95b5`, and reference
contract `d659b99f0ee016b2`. Positive weights are present only on responsive
features. Repeat-unstable decay/B metrics and the unresponsive onset-lockin
metric are zero-weight watches.

The recovered harp directory contains 98 of 102 renders, but its baseline has
`attackNoiseLevel=0.26` while the activated initial preset has 1.0. Completing
four repeat files would not repair that initial-preset mismatch. The residue
is preserved for auditability and is not represented as a valid contract.

## Glock first-render gate

| Gate | Result | Evidence |
|---|:---:|---|
| Modes 2-3 within 35 cents of fitted ratios | **FAIL** | no `barModeRatioOffsetsCents` consumer |
| Median rendered T60(mode 1)/T60(mode 2) >= 5 | **FAIL** | 1.3453 rendered vs 12.3427 measured |
| Centre strike suppresses mode 2 in all measured anchors | **FAIL** | renderer still uses the string position comb |
| Partial economy <= 6 audible modes | PASS | six-mode bar profile |
| Campaign string B pinned zero | PASS | B excluded from the fit |
| Engine B firewall | **FAIL/BLOCKED** | live engine still applies B after bar ratios |

T-072, not parameter search, is the filed fix. The corpus has only mf samples,
so mallet-brightness dynamics are separately unidentifiable and remain neutral.

## Nylon focused continuation

The current contract authorises exactly:
`excitationPosition`, `excitationHardness`, `velocityHardnessCoupling`,
`attackNoiseLevel`, `attackNoiseDirect`, `partialTilt`,
`spectralResonanceAmount`, `decaySecondStage`, and `decaySecondRatio`.
An attempted narrower five-key invocation was rejected before rendering by the
manifest hash guard. The exact nine-key invocation then completed.

| Measure | Baseline | Candidate | Result |
|---|---:|---:|---|
| Composite loss | 4.616871 | 4.338724 | 6.03% better |
| `excitationPosition` | 0.120000 | 0.090031 | accepted search movement |
| Construction | 11 pass / 1 fail | 11 pass / 1 fail | `guitar.double-decay` still fails |
| Tripwires | 6 / 18 / 12 | 6 / 18 / 12 | all attack cells pass; all spectral cells fail |
| Resource benchmark | PASS | PASS | 0.187 ms/note, 10 oscillators, 10 automation events |
| Distributional variation | insufficient | insufficient | no repeated pitch/dynamic group |
| Leaderboard eligibility | no | no | candidate retained only as run evidence |

Every partial, log-mel and band-balance cell improved, but none crossed its
gate. Examples are low-p partial 34.13 -> 32.24, log-mel 13.28 -> 11.73 and
band balance 16.31 -> 14.03 perceptual units; mid-p becomes 21.87 -> 18.98,
22.53 -> 20.29 and 19.92 -> 18.09. The dominant remaining residual is
`centroid_semitones` at 9.7352 units. The next bounded intervention is
per-cell/course spectral control or the T-028 contact-time law, selected from
the resulting residual after consumption.

Host-wide concurrent renderer saturation made eight ship variants
disproportionately expensive. The interrupted eight-variant directory is
preserved as `ship-mode-interrupted-8-variants`; the completed audition uses
two fresh ship variants. This does not weaken the deterministic fit result.

### F13 per-dimension evidence re-derivation

The six references are one pitch at each of three registers, each at p and f.
They are full-strength evidence for deterministic mean, register and dynamic
cell objectives, including the reported spectral and attack errors. They are
not evidence for per-note stochastic spread: cross-pitch differences would
conflate note identity with variation, and there are neither same-cell repeats
nor adjacent-semitone runs from which to remove a register trend. Therefore no
Human range is fitted, transferred or downgraded into a proxy claim. The
distribution gate remains honestly insufficient only for the dimensions it
cannot identify.

## Family gate table

No preset is described as shipped, audited for shipment, or interim-shippable.

| Gate | Grand | Upright | Nylon | Harp | Glockenspiel |
|---|:---:|:---:|:---:|:---:|:---:|
| Legacy baseline/prior present | PASS | PASS | PASS | PASS | PASS |
| Current controllability | STALE | STALE | **PASS** | INCOMPLETE | **FAIL required controls** |
| L18 free decay | engine incorporated | engine incorporated | PASS | engine incorporated | engine incorporated |
| Latest construction | FAIL | FAIL | **FAIL 11/12** | not run | **FAIL identity gates** |
| Latest tripwires | FAIL | FAIL | **FAIL 6/18/12** | not run | bar gate FAIL |
| Resource tripwire | PASS | PASS | PASS | not run | partial-economy PASS |
| Distributional ship gate | INSUFFICIENT | INSUFFICIENT | INSUFFICIENT per Human dimensions | not run | INSUFFICIENT one dynamic |
| Reference-variability floor | INSUFFICIENT | INSUFFICIENT | INSUFFICIENT | not run | INSUFFICIENT |
| Owner listening | OPEN | OPEN | OPEN | OPEN | OPEN |
| Leaderboard updated | NO | NO | NO | NO | NO |

## Prior and leaderboard state

| Preset | Required prior row | Resolved hash used |
|---|---|---|
| Grand piano | `piano-grand <- legacy piano (true legacy)` | `523993362b2a1140803bf4dedbd81bc43b624719f88cbcf2580092c0ec840f30` (last ship) |
| Upright piano | `piano-upright <- legacy piano craft; fitted upright identity` | `45f8b3247e07a86e0854b2dfcf8dbaa4ffcd5e418603a3bda14ac3443b616e7e` (last ship) |
| Nylon guitar | `guitar-nylon <- legacy piano craft adapted to pluck` | `3fed4ad7c40f95b5755708bed96fdfc906f287052578184bf1a874a1ba352253` (current ship prior) |
| Harp | `harp <- legacy piano craft, pluck defaults` | `e9b252f86a71eca29e73d05242e9e51ea8dd2dda3d435a0bb772068b6014cdb0` (fit prior) |
| Glockenspiel | `glockenspiel <- legacy piano craft, strike defaults, bar class` | `aaa378d8ad31f7ceb8d13ef9f21d4dded8cac5906fc9d873dd3944b08800894e` (fit prior) |

Nylon live and `state/guitar-nylon/leaderboard.json` files are byte-identical.
The best comparable entry for reference set `2231bb853d1bcc2f` remains the
gate-failing legacy baseline at `4.617001609772294`; the numerically lower
Pass-17 candidate is not inserted because construction and tripwire gates
fail. Harp and glock first-fit artifacts are analysis/activation diagnostics,
not eligible optimiser runs, so no leaderboard rows or fabricated state
backstops are created for them.

## Exchange status

Statuses are generated/reconciled from the live append-only exchange:

| Entry | Struck/plucked status |
|---|---|
| T-033/T-043 per-course/per-string tables | engine incorporated on current shared head |
| T-067 held strike/pluck law | engine incorporated at `b4ff0c4`; nylon re-audited |
| T-068 pinned pre-onset component | generic engine consumer incorporated; piano point-envelope adapter/activation pending; upright corpus pre-roll exhausted |
| T-069 envelope-deviation classes | analysis incorporated; engine pending Agent A |
| T-072 bar ratio/decay/position/B firewall | engine pending Agent A; glock objective correctly zero-weighted |
| T-059 criterion drift | one complete nine-key intervention; no causal edge fabricated |
| T-063 measured Human episodes | F13 applied; no spread emitted without identifiable variation evidence |

## Exit state and pending mandates

Exit state §2.5(b): named, evidenced limiting factors with filed fixes.

1. Nylon: deterministic loss improved 6.03%, but the full audited search did
   not clear the construction or spectral plateau. The durable work item is
   per-cell/course control or T-028 contact-time consumption, followed by a
   fresh exact audit.
2. Glockenspiel: Agent A must land T-072's ratio-offset, per-mode T60,
   free-bar strike-position and engine B-firewall consumers. Re-audit before
   assigning any bar-objective weight.
3. Harp: run a new current-profile controllability audit from the activated
   initial preset before any optimiser invocation. Do not resume the
   pre-activation partial audit.
4. Grand/upright: T-068's piano point-envelope adapter and T-069's envelope
   anomaly consumer remain neutral and pending. Upright still needs genuine
   >=10 ms pre-roll evidence.
5. Acquire repeated/adjacent nylon runs only for stochastic Human dimensions;
   do not relabel the existing deterministic six-cell evidence as weak.

No owner decision is required. These are bounded engine, audit and evidence
tasks rather than policy choices.

## Verification

- Crash artifact exact replay and consuming regression: PASS.
- Glock synthetic bar round trip: PASS.
- Targeted Python tests: PASS.
- Full Python suite (project Python): PASS, 100% with no failures.
- `npm test`: 11/11 PASS.
- `node scripts/verify_tone_model.mjs`: PASS.
- `node scripts/render_note.mjs --verify`: PASS,
  `17cda4acb06231a766787c287925d8b3272b4969ef1d26ac8fec0d414fe52675`.
- Listening page rebuild: PASS; global `sg2-data/listen.html` regenerated from
  ship-mode/leaderboard artifacts with fresh renderer outputs.
