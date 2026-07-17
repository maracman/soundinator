# Agent D pass 02 — analysis and bowed

Date: 2026-07-17  
Branch: `codex/sg2-d-analysis-r2`

## Outcome

Pass 02 closes the T-031/T-054/T-029 controllability blockers and establishes
the violin legacy prior as mandatory leaderboard entry #1. The two-control
candidate improves the deterministic objective and one hard gate, but its
fresh-seed SHIP distribution is still too narrow, so it is correctly withheld
from the leaderboard. The run exits `limiting-factor`, with T-033 per-string
consumption filed as the next concrete bowed work item.

The run is `agentd-pass02-legacy-ship-r2` under durable `SG2_DATA`. Its
guitar-pass-14-compatible `summary.json`, `RUN_REPORT.md`, candidate listening
page, audition manifest, SHIP renders, accepted-criteria log, leaderboard, and
`sg2-data/state/` backstop are present.

## Controllability re-audit

The integrated-head audit is clean and repeat-stable at the canonical 0.05
perceptual-unit threshold. Direct named responses are:

| Work item | Parameter → feature | Response | Verdict |
|---|---|---:|---|
| T-031 | `onsetWanderCents` → `onset_wander_cents` | 1.060422 | responsive |
| T-031 | `onsetWanderSettlePeriods` → `onset_scoop_settle_ms` | 7.382292 | responsive |
| T-031 | `bowScratchLevel` → `onset_noise_db` | 0.512844 | responsive |
| T-054 | `bowNoiseLevel` → `sustain_noise_db` | 4.151154 | responsive |
| T-029 | `vibratoDepth` → `body_am_db` | 0.125634 | responsive |

T-029 is no longer an absent consumer. Its physical construction gate remains
honestly red: the best render measures 0.607 dB against the literature-backed
3 dB requirement. This is the already-filed unexplained-residual obligation,
not permission to amplify the measured body.

## Violin legacy-prior rebaseline and SHIP result

- Legacy row: `violin ← legacy violin`.
- Tag/commit: `sg2-legacy` / `e8d3ac123c0f1c2647c4dbf03d48934b1966564d`.
- Row hash: `334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`.
- Resolved parameter hash: `23f77935465463a1f0756e18b072eaa95e022eb651e04de418f259cfb6e748b5`.
- Reference set: `0df92b8566382402`.
- Baseline loss: 18.031813; candidate loss: 17.865407 (−0.166406, 0.923%).
- Candidate: `bowNoiseLevel=0.337920`, `vibratoDepth=30.335`.
- Gates: 37 → 36 total hard failures; construction 15 PASS / 1 FAIL;
  strict §3 remains FAIL with 31 failed/missing aggregate cells.
- Dominant residual: `attack_ms`, 5.734109 perceptual units.
- Resource gate: FAIL (model math passes; oscillator and automation ratios do
  not).

Both the legacy prior and candidate fail the two-sided SHIP variation gate,
predominantly `too-little`. The candidate therefore does not beat legacy under
the shipping contract even though FIT loss improves. The durable leaderboard
contains only entry #1, the legacy baseline. The diagnostic candidate listening
page remains available at
`sg2-data/runs/violin/agentd-pass02-legacy-ship-r2/listen-violin-agentd-pass02-legacy-ship-r2.html`.

## T-055 amended decomposition

The 14 matched takes / 10 pairs were rerun under §2.5c.1b and §2.5c.2.
The verdict is `INCONCLUSIVE-MASKED`, not `FAIL-MISSING-DOF`: all 10 pairs
retain residuals, but the matched identity renders miss core bars and not all
qualified consumers are demonstrated by the supplied audit.

Double dissociation qualifies seven candidates: bow position, vibrato rate,
bow-noise level, bow-scratch level, attack-noise level, onset wander, and
onset settle. Vibrato depth, vibrato onset delay, vibrato ramp, and vibrato
rate drift do not qualify and remain outcome observables only. Qualified
ranges persist as standalone take-pair evidence; the masked verdict does not
widen any identity parameter.

## Empirical criteria hierarchy

Accepted best-so-far steps now persist their complete feature-loss vectors.
Each transition is compared against the hashed repeat-render noise floor;
directed `A⊣B` events populate a durable asymmetry matrix. This run records six
accepted steps and five directed-drift transitions in
`sg2-data/state/criteria-drift.json`. Evidence is still sparse: no relationship
has yet reached the six-event/binomial promotion threshold, so the working
order correctly remains the theoretical sparse-evidence fallback and reports
zero measured edges, symmetric couplings, or theory disagreements.

## Decision-13 tail audit

The mechanical audit updated all 13 available campaign manifests and emits
`sg2-data/state/tail-audit.json`. Violin contains 14 full-tail and 12 truncated
references; all 14 full-tail non-phrase rows are release-eligible. Ring time,
damping slope, and release noise floor are computed only for eligible rows.
No release-loudness feature exists. All release weights remain zero pending a
responsive note-off control, and builders apply the same audit to future
manifests.

## Sung family firewall

`assert_sung_family_firewall` now runs before canonical optimisation. It
rejects non-sung fitted profiles, family declarations, candidate/objective/
leaderboard provenance, non-vocal legacy priors, and cross-singer sung seeds.
Pinned vocal legacy craft, same-singer sung priors, and morphology-derived boy
soprano/basso presets with an explicit frozen adult sung parent and transform
pass. `evaluate_construction` exposes the same contract as a report assertion;
the required proof cases are executable tests.

## Pending mandates and exit state

- Session outcome: `limiting-factor`.
- Limiting factor: two global controls cannot remove cell-specific bowed
  spectral/attack residuals or supply the measured take spread.
- Filed work item: complete T-033 per-string table consumption before the next
  global spectral pass.
- Pending, zero-weight: release controls until note-off controllability lands.
- Owner decision needed: none. No candidate is presented as a freeze or SHIP
  winner.
