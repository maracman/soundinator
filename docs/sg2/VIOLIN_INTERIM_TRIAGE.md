# Violin iteration residual triage

Date: 2026-07-16

Authoritative role-aware baseline:
`/private/tmp/sg2/violin/agentd-t045-roles-rebaseline-r2`

Accepted best:
`/private/tmp/sg2/violin/agentd-t046-vibrato-rate-r3`

Reference objective: `78f215f0f35f307f`

Controllability objective: `8843f5e6efdc13e0`

## Current result

T-036/T-044 role routing is now active. The 26-reference manifest contains:

- six Iowa `spectral+onset` anchors;
- six Philharmonia `vibrato` anchors covering low/mid/high × mf/f;
- fourteen `floor` rows used for variability only.

Strict evidence holes are zero. The floor-only mid/mezzo-piano band cell no
longer exists, and non-vibrato rows no longer manufacture vibrato
obligations.

| Metric | Pre-role accepted best | Role-aware baseline | Rate-first best |
|---|---:|---:|---:|
| Composite loss | 3.448324 | 3.602851 | 3.604090 |
| Total gate failures | 40 | 31 | **30** |
| Construction failures | 2 | 2 | 2 |
| Measured §3 cell failures | 31 | 29 | **28** |
| Strict evidence holes | 7 | **0** | **0** |

The raw loss is not comparable across the pre-role and role-aware objective.
On the new objective, `vibratoRate = 5.431206` closes one additional cell
despite a 0.00127 loss increase, so it is accepted as a hard-gate
improvement.

## Quarantine decision

The accepted-seed T-045 audit is checkout-isolated and clean, but
inharmonicity is repeat-unstable at 0.0163 mean / 0.0844 peak perceptual
units. T-041 therefore zero-weights it as a watch metric for this objective.
No other feature is quarantined.

## Exact remaining failures

| Class | Count | Evidence / blocker |
|---|---:|---|
| Spectral/onset engine-data contract | 24 | Partial table 6, mel 6, attack 6, band balance 6. T-031/T-038 and T-033/T-043 remain blocking. |
| Vibrato engine-data contract | 4 | Mid mf/f pass; low mf/f and high mf/f fail. Probability and depth plateau; one global rate cannot cover the measured 5.60–6.58 Hz and 7.62–37.93 cent table. T-047 is blocking. |
| Bow-noise engine gap | 1 | `violin.pp-noise-rise = -5.09 dB`, requirement ≥ +2 dB. T-039. |
| Vibrato body-AM engine gap | 1 | `violin.vibrato-body-am = 1.63 dB`, requirement ≥ 3 dB. T-029. |
| Corpus/role gaps | **0** | T-044 is resolved from existing holdings. |
| **Total** | **30** |  |

## Blockers

There is no analysis-corpus stopper. Further gate closure depends on engine
consumers:

1. T-047: consume `vibratoByRegisterDynamic` with deterministic presence for
   declared vibrato-role notes.
2. T-033/T-043: per-string/register/dynamic spectral tables.
3. T-038/T-031: local bow attack and lock-in contracts.
4. T-039: soft-dynamic sustained bow-noise law.
5. T-029: instantaneous-frequency body FM→AM.

The optimizer itself no longer aborts on an unanalysable candidate: such a
candidate is recorded with its failed reference, receives a hard analysis
penalty, and is rejected while the search continues.

The T-040 A0/B1 body result remains passing, so no owner escalation is
required for body modes.
