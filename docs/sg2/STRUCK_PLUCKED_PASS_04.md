# Struck/plucked pass 04 — course storage, anchor repair, and nylon convergence

Date: 2026-07-16  
Scope: T-033 analysis storage, acquisition atomicity, stale-anchor repair, and
automatic nylon continuation passes 09–13.

## Outcome

The iteration pipeline is working and measuring error. Pass 08's apparent
plateau was traced to stale `envelopeAttackByRegister` values retained from
the pre-profile-repair model (`120/459/1206 Hz`). Rebasing the fitted controls
onto the corrected measured anchors (`82/196/659 Hz`) reopened optimization.

The analysis side of T-033 is now complete. The fitter emits course-specific
`partialsByString` tables before pooling; the nylon profile has:

| Course | Evidence | Anchor |
|---|---:|---:|
| `string6` | E2 p/f | 82.407 Hz |
| `string3` | G3 p/f | 195.998 Hz |
| `string1` | E5 p/f | 659.255 Hz |

The engine does not consume these tables yet. Pass 13 exhausted the seven
global spectrum/onset controls without beating the comparable pass-10 leader,
so T-033's engine consumer is now the genuine stopper.

## Iteration results

Different reference-set hashes are separate objectives and are never compared
as one continuous loss curve.

| Pass | Objective state | Baseline | Best | Improvement | Active failures | Result |
|---|---|---:|---:|---:|---:|---|
| 09 | stable watches | 3.477841 | 3.317939 | 4.60% | 6 | accepted |
| 10 | same as 09 | 3.318138 | 3.317250 | 0.027% | 6 | accepted comparable leader |
| 11 | decay stable | 3.163714 | 3.152017 | 0.37% | 6 | accepted |
| 12 | fully repeat-stable | 4.011533 | 3.723190 | 7.19% | 14 (from 15) | accepted full-objective leader |
| 13 | stable watches | 3.541300 | 3.378844 | 4.59% | 6 (from 7) | rejected: worse than comparable pass 10 |

Pass 12 is the authoritative restart state after the engine changes because it
is the accepted leader for the complete partial/mel/centroid/attack/decay/
inharmonicity/onset objective. Pass 10 remains the stable-watch leader for its
own hash.

## Gate table

| Gate | Status | Evidence |
|---|:---:|---|
| Durable artifact root | PASS | all corpus, audit, run, state, and listen artifacts under `sg2-data/` |
| Acquisition atomicity | PASS | strict fit rejects undeclared audio while acquisition sidecars are stale |
| Immutable sparse-profile merge | PASS | committed body bands preserved; rejected mixed-body artifacts quarantined |
| T-033 analysis storage | PASS | course tables emitted, generated into JS, and covered by consuming tests |
| Pass-12 controllability | PASS | repeat stability fully clean; all applicable features active |
| Guitar construction | PASS | 11/11 assertions |
| Resource tripwire | PASS | 9 oscillators, 9 automation events/note, 0.055 model ms/note |
| Automated §3 gate | FAIL | 14 active failures; all six partial and mel cells remain above bar |
| Reference-variability floor | NOT DEMONSTRATED | no same-pitch/same-dynamic alternate takes |
| Owner listening | OPEN | no struck/plucked L-note is open; owner ears remain final acceptance |
| Further global-control iteration | BLOCKED | pass 13 cannot beat comparable leader; T-033 engine consumer required |

## Error measurement

Pass 12 is the strongest measurement state: no repeat-unstable features.
Its dominant residual is `centroid_semitones = 10.7814` perceptual units.
Partial-table and mel gates fail in every low/mid/high × p/f cell; attack
passes five of six, and inharmonicity passes five of six. Dynamic brightening
passes at slope `0.396`.

Pass 13 re-quarantined partials, decay, and inharmonicity for that distinct
seed. This baseline-specific quarantine is expected under T-041 and is why
the pass-13 loss cannot replace pass 12's full-objective evidence.

## Controllability

| Pass | Active weighted features | Repeat watches |
|---|---|---|
| 12 | partials, mel, centroid, attack, decay, inharmonicity, noise, onset tilt/level/centroid | none |
| 13 | mel, centroid, attack, noise, onset tilt/level/centroid | partials, decay, inharmonicity |

Control watches remain `band_balance_db`, `ltas_rolloff_db_oct`, and
`onset_lockin_periods`; two-polarisation beating, sympathetic bloom, and
decay-aligned band balance remain planned watch metrics.

## Exchange status

| Entry | Struck/plucked status |
|---|---|
| T-020 pitch-anchored analysis | incorporated |
| T-025 G7 audio brightness | incorporated |
| T-033 per-string identity | analysis incorporated; engine blocked with exact course law and five headless assertions |
| T-041 repeat-render contract | incorporated; baseline-specific quarantine working |
| T-042 checkout identity | adapted; renderer/profile hashes bind every audit |

## Leaderboard and durable state

- Full-objective leader: `pass12-full-stable`, loss `3.723190`, reference set
  `31139c0334214788`.
- Stable-watch comparable leader: `pass10-refine`, loss `3.317250`,
  reference set `0c45049b7585a56c`.
- Restart after T-033 engine landing:
  `sg2-data/state/guitar-nylon/pass12-full-stable/best.json`.
- Open work item: `sg2-data/state/guitar-nylon/work-items.json`.

Pass 13 is absent from the leaderboard/ledger because its candidate did not
beat the comparable leader. The earlier pass-08 work item is marked
superseded by the profile rebase.

## Owner listening artifacts

- Auto-built page: `sg2-data/listen.html`
- Full-objective leader renders:
  `sg2-data/runs/guitar-nylon/pass12-full-stable/renders/eval-0032/`
- Full-objective report:
  `sg2-data/runs/guitar-nylon/pass12-full-stable/RUN_REPORT.md`
- Limiting-factor report:
  `sg2-data/runs/guitar-nylon/pass13-stable-refine/RUN_REPORT.md`
- Final audit:
  `sg2-data/audits/guitar-nylon/pass13-audit/CONTROLLABILITY.md`

## Stop condition

Stop under the standing orders: the analysis and iteration pipeline are
runnable, no owner decision is pending, and the reference floor is not
demonstrated, but all currently consumable global controls have been tested
and cannot beat the comparable leader. Unblock by landing T-033's
`stringSelect`/`partialsByString` engine consumer and headless assertions.
Then re-audit and resume automatically from pass 12.

## Verification

- Full Python suite: PASS
- JavaScript suite: 11/11 PASS
- Tone-model v2 headless assertions: PASS
- Headless render verification: PASS
- Owner page rebuild: PASS; `pass12-full-stable` selected as the nylon
  full-objective leaderboard state
