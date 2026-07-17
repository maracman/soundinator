# SG2 sung campaign — pass 06 strict spectral hierarchy and source-law triage

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-e-sung-r2`
Exit state: three lawful dynamic-source improvements retained; strict spectral cells remain engine-law-limited; no section frozen

## Outcome

Tenor, soprano and bass were triaged cell-by-cell in the declared strict order:
partial table → mel spectrum → attack → band balance. Mezzo received the same
work wherever A-VOICE-04 was not the gating mechanism. The fitted
`spectralDynamicAmount` improved the upstream partial residual for soprano,
bass and mezzo, so those candidates became the current leaders. Tenor's trial
lowered the scalar composite but worsened the upstream partial residual; the
criteria hierarchy rejected it and retained the pass-05 incumbent.

No partial or mel strict aggregate cell closed. The residual is not repairable
with the renderer's one pooled explicit source table: after exact fitted-vowel
body subtraction, a register × dynamic source counterfactual lowers median
partial error by 34.6–52.7% across the four voices. `A-VOICE-05` and exchange
item T-065 therefore specify the missing consuming law. The counterfactual
tables remain diagnostic; no register/dynamic residual was folded into vowel
bodies or unrelated identity parameters.

## Current-objective gate table

Selection is lexicographic: construction; strict partial, mel, attack and band
cell failures plus the residual at each tier; total strict cells; emitted body;
vowel; Human; then comparable composite.

| Preset / entry | Composite | Construction | Strict §3 | Emitted body | Vowel | Classifier watch | §2.5c Human | Overall |
|---|---:|---|---|---|---|---|---|---|
| Tenor current-objective legacy | 4.289210 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Tenor pass-05 incumbent **retained** | 4.191012 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Tenor dynamic trial, rejected upstream | 4.159448 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano current-objective legacy | 4.955311 | PASS 10/10 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano pass-05 incumbent | 4.536039 | PASS 10/10 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano dynamic candidate **leader** | 4.510623 | PASS 10/10 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Bass m8 pass-05 baseline | 4.155330 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | FAIL 8/10 | not run | **FAIL** |
| Bass dynamic candidate **leader** | 4.147851 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | FAIL 8/10 | not run | **FAIL** |
| Mezzo current-objective incumbent | 4.079154 | FAIL 9/10 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo dynamic candidate **leader** | 4.074528 | FAIL 9/10 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |

Tenor, bass and mezzo construction each fail only pitch-synchronous breath.
Soprano construction is clean. The soprano missing cell is high/p band
balance: all four eligible rows are too short for sustained evidence, so the
strict aggregator correctly reports no evidence rather than converting it to
a fit failure.

## Strict spectral cell triage

| Voice | Partial cells | Mel cells | Attack cells | Band cells | Upstream partial residual, incumbent → trial | Decision |
|---|---|---|---|---|---:|---|
| Tenor | 0 pass / 9 fail | 0 / 9 | 0 / 9 | 0 / 9 | 7.195 → 7.630 units | reject trial; retain 0.80 |
| Soprano | 0 / 7 | 0 / 7 | 0 / 7 | 0 / 6 + 1 missing | 8.558 → 8.480 | accept 1.20 |
| Bass | 0 / 9 | 0 / 9 | 0 / 9 | 0 / 9 | 8.453 → 8.452 | accept 0.40 |
| Mezzo | 0 / 9 | 0 / 9 | 0 / 9 | 0 / 9 | 6.592 → 6.529 | accept 0.95 |

The soprano and mezzo steps improve partials while mel and band balance drift
slightly worse; hierarchy ordering retains the upstream gain and defers those
downstream criteria. Bass improves partial, mel and band balance together.
Tenor demonstrates why the scalar composite cannot select a candidate by
itself: its composite improves while partial, mel and band residuals worsen.

## A-VOICE-05 engine specification

The existing `registerProfileAt` consumer cannot solve this sung residual.
`_spectralFingerprint` uses profile register tables only as fallbacks, then
explicit sung `spectralPartialMeans` override every harmonic. There is also no
velocity-indexed source table. A-VOICE-05 specifies a pinned
register × dynamic sung-source surface, interpolated in log-f0 and velocity
before the fixed-Hz vowel body. Its assertions cover absent-table PCM identity,
endpoint/midpoint/clamp behaviour, velocity interpolation, one-source/many-body
separation, exact T-058 vowel transfer and fresh controllability responders.

Counterfactual median partial-error reductions are tenor 39.9%, soprano 34.6%,
bass 52.7% and mezzo 46.4%. These establish a missing-law limitation, not
permission to fit five vowel sources or distort vowel formants.

## Criteria drift

T-059 is now executed for sung rather than report-only. Soprano, bass and
mezzo each retain an incumbent vector and an accepted candidate vector in
`accepted-criteria-steps.json`. Their directed drift events were accumulated
in `sg2-data/state/criteria-drift.json`; the tenor rejection is absent. After
the sung steps were logged, the shared state contained 86 accepted steps and
62 directed transitions. Other lanes continued advancing the live aggregate
during finalisation, so no later fleet-wide count is claimed as sung-owned. The
six sung run-local IDs remain present in shared state; no rejected tenor ID is
present.

## L16 disposition

L16's envelope-anomaly mechanism is adapted for possible future sung onsets in
T-064. A consonant or glottal-onset component may eventually need an onset
boost plus faster per-frequency decay separated from the baseline envelope.
Piano values and class assignments do not transfer. Sung activation requires
its own per-partial onset tracks, fixed-Hz versus harmonic-rank separation,
synthetic round-trip and licensed sung-onset evidence. With A-VOICE-03 still
unconsumed during the fit and zero-weight, no envelope-anomaly fit was run this
pass. Shared head `b5f91b7` landed the neutral, provenance-gated base consonant
consumer during finalisation; the anomaly-specific law and licensed sung
evidence remain absent, so activation correctly remains off.

## Mezzo work outside the breath blocker

Mezzo received a fresh current-renderer controllability audit and a
current-objective incumbent re-render before comparison. The audit is clean and
stable; the 0.95 dynamic scalar improves the upstream partial residual and the
composite from 4.079154 to 4.074528. Emitted vowel bodies and the calibrated
classifier stay 10/10. A-VOICE-04 remains only the construction failure and was
not used to idle the source fit. Its engine consumer landed during finalisation
and fresh audits now prove `voiceBreathSync` is audible, but the fitted values
remain neutral and the required dedicated analysis observable is still
pending; no value was invented after the spectral fit.

## Controllability and prior ledger

| Voice | Objective hash | Manifest hash | Repeatability | Clean |
|---|---|---|---|---|
| Tenor | `b6d4a7fe678e2af3` | `a579e74e30d52b3b` | stable | yes |
| Soprano | `fd6c4e9cf0facd4e` | `a579e74e30d52b3b` | unstable watch zeroed | yes |
| Bass | `ba8081c6e2063ac0` | `a579e74e30d52b3b` | stable | yes |
| Mezzo | `570e3a53d5189bb3` | `a579e74e30d52b3b` | stable | yes |

After merging the advancing shared head, all audits were refreshed and all ten
objective-comparator score sets were revalidated without metric drift. The
final A-VOICE consumer sync changed only bass's objective seal by activating
previously dead responders; its score values did not drift. All audits consume
renderer hash `6528359e37786bc0`. Every fit retains the
pinned `vocal` prior at tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`. FIT scoring is deterministic; selected listening renders
are fresh-seeded SHIP mode.

## §2.5c eligibility

No reconstruction stabilised enough to qualify. Every active voice still
fails all partial and mel aggregate cells, and deterministic source/body
reconstruction remains above the 1 dB bar. Tenor, bass and mezzo additionally
retain the pitch-sync construction failure at their neutral fitted value; the
consumer landed only during finalisation. No differential identity widening or
`humanRanges` claim was emitted; T-055 remains
`adapted-not-run-identity-unstable` under the §2.5c.1b double-dissociation rule.

## Pass-end artifacts and exit

Objective-scoped leaderboards, selected `best.json` files, generated run gate
tables and `sg2-data/state/<instrument>/` backstops are current for all four
adult sections. The live exchange disposition file is regenerated at
`sg2-data/runs/sung-pass06/EXCHANGE_STATUS.json`. The listening page is rebuilt
from fresh SHIP renders. The final suite is green and `git diff --check` is
clean.

No owner decision is required. Next pass order is:

1. consume A-VOICE-05, emit synthetic-round-trip-validated pinned source rows,
   and re-run partial then mel cells;
2. fit A-VOICE-04 only after its dedicated rendered observable lands, then
   re-run tenor/bass/mezzo construction;
3. keep soprano high/p band balance missing until an eligible sustained row is
   acquired; do not weaken the evidence rule;
4. retain the bass `/a/` classifier watch at 8/10 until its fitted F2 enters
   the annex region without moving the annex;
5. run §2.5c only when one deterministic identity clears its masking gates.
