# Violin iteration residual triage

Date: 2026-07-16

Authoritative role-aware onset baseline:
`/private/tmp/sg2/violin/agentd-t048-onset-rebaseline-r1`

Accepted scalar parameters carried from:
`/private/tmp/sg2/violin/agentd-t046-vibrato-rate-r3`

Reference objective: `89bd092537812ed4`

Controllability objective: `e848934b2568dfe1`

## Current result

T-036/T-044/T-048 role routing is now active. The 32-reference manifest
contains:

- six Iowa `spectral` anchors;
- six separately selected Iowa `onset` anchors;
- six Philharmonia `vibrato` anchors covering low/mid/high × mf/f;
- fourteen `floor` rows used for variability only.

Strict evidence holes are zero. The floor-only mid/mezzo-piano band cell no
longer exists, and non-vibrato rows no longer manufacture vibrato
obligations. Every onset anchor reaches harmonic organisation within 15.89
nominal periods.

| Metric | Pre-role accepted best | Rate-first best | T-048 onset baseline |
|---|---:|---:|---:|
| Composite loss | 3.448324 | 3.604090 | 3.541721 |
| Total gate failures | 40 | 30 | **30** |
| Construction failures | 2 | 2 | 2 |
| Measured §3 cell failures | 31 | 28 | **28** |
| Strict evidence holes | 7 | 0 | **0** |
| Onset lock-in construction | old amplitude-coupled metric | pass | **pass, median 0 periods** |

Raw loss is not comparable across these objectives. T-048 changes both the
reference manifest and the lock-in feature definition; no scalar parameter
change is claimed from its mandatory rebaseline.

## Quarantine decision

The checkout-isolated T-048 audit is stable. Peak repeat distances are
0.0357 for attack, 0.00726 for inharmonicity, and below 0.05 for every
feature. No feature is quarantined for this objective. The earlier T-045
inharmonicity quarantine remains valid only for that earlier baseline.

## Exact remaining failures

| Class | Count | Evidence / blocker |
|---|---:|---|
| Spectral engine-data contract | 18 | Partial table 6, mel 6, band balance 6. T-033/T-043 remain blocking. |
| Bow-attack engine-data contract | 6 | All six attack cells fail. High pp/ff measured intervals are disjoint, so register-only attack is insufficient. T-048 is blocking. |
| Vibrato engine-data contract | 4 | Mid mf/f pass; low mf/f and high mf/f fail. Probability and depth plateau; one global rate cannot cover the measured 5.60–6.58 Hz and 7.62–37.93 cent table. T-047 is blocking. |
| Bow-noise engine gap | 1 | L14/T-054 extraction is complete: pinned 200–14,400 Hz table plus fitted exponent 0.9309. The separate engine consumer and exposed level control remain pending. |
| Vibrato body-AM engine gap | 1 | `violin.vibrato-body-am = 1.63 dB`, requirement ≥ 3 dB. T-029. |
| Corpus/role gaps | **0** | T-044 is resolved from existing holdings. |
| **Total** | **30** |  |

## Blockers

There is no analysis-corpus stopper. Further gate closure depends on engine
consumers:

1. T-047: consume `vibratoByRegisterDynamic` with deterministic presence for
   declared vibrato-role notes.
2. T-033/T-043: per-string/register/dynamic spectral tables.
3. T-048/T-031: consume the register × dynamic bow-attack table; preserve
   harmonic-organisation lock-in.
4. T-054 (superseding the provisional T-039 violin spec): consume the pinned
   body-routed bow profile, fitted soft-dynamic law, and user-facing level.
5. T-029: instantaneous-frequency body FM→AM.

The optimizer itself no longer aborts on an unanalysable candidate: such a
candidate is recorded with its failed reference, receives a hard analysis
penalty, and is rejected while the search continues.

The T-040 A0/B1 body result remains passing, so no owner escalation is
required for body modes.
