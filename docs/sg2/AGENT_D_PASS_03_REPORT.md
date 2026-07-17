# Agent D pass 03 — analysis and bowed

Date: 2026-07-17  
Branch: `codex/sg2-d-analysis-r2`

## Outcome

Pass 03 promotes `agentd-pass03-human-release-r5` as the first violin
leaderboard candidate that both beats its current-objective legacy row and
passes the two-sided, fresh-seed SHIP variation gate. Seven
dissociation-qualified `humanRanges` now drive deterministic per-note bowed
performance overrides in SHIP mode while FIT mode remains deterministic.

The pass also starts the cello campaign with four independent per-string
tables, a six-cell starter reference contract, a clean single-parameter
controllability audit, and a first optimisation run scored against
`cello ← legacy cello`. The cello candidate improves deterministic loss but is
correctly withheld because no qualified take-pair floor exists.

## §3 gate table

| Preset / row | Loss | Construction | Strict §3 | SHIP variation | Leaderboard |
|---|---:|---:|---:|---:|---:|
| Violin legacy baseline | 22.727603 | 14 PASS / 2 FAIL | 6 PASS / 13 FAIL | FAIL | mandatory baseline |
| Violin pass-03 r5 | **22.581497** | 15 PASS / 1 FAIL | 6 PASS / 13 FAIL | **PASS** | **new leader** |
| Cello legacy baseline | 3.142243 | 15 PASS / 3 FAIL | 0 PASS / 20 FAIL | insufficient evidence | mandatory baseline |
| Cello pass-03 start | 2.768351 | 15 PASS / 3 FAIL | 0 PASS / 20 FAIL | insufficient evidence | withheld |

The violin improvement is 0.146105 composite units (0.643%). The candidate
fits `bowNoiseLevel=0.763932`, `vibratoDepth=25.143`, and
`releaseDamping=0`. Its remaining construction failure is the 3 dB
vibrato/body-AM bar; its dominant weighted residual is release noise at
11.2787 perceptual units. The resource gate remains red on oscillator and
automation ratios even though model math passes.

The cello start improves by 0.373892 units. Its strict bars are deliberately
not softened: the low positive-A0 body cluster, soft-dynamic noise rise, and
vibrato/body-AM construction assertions remain red, and centroid error is the
dominant residual.

## Violin Human variation result

The rebuilt violin profile retains all seven T-055-qualified ranges: bow
position, vibrato rate, bow-noise level, bow-scratch level, attack-noise level,
onset wander, and onset settle. The SHIP adapter draws only these declared
ranges, records every seed/override, clips to engine support, and includes one
measured articulation latent coupling. The fixed calibration seeds make the
gate reproducible.

For the qualified MIDI-61 pair, the two direct controllable observables pass
both sides of the 0.5×–2× floor interval:

| Observable | Measured spread | SHIP spread | Ratio | Verdict |
|---|---:|---:|---:|---|
| partial table | 10.0397 | 19.3090 | 1.923× | PASS |
| sustain noise | 1.8833 | 2.9376 | 1.560× | PASS |

Two direct observables remain named `watch-unreachable`, not hidden identity
dimensions. Saturating scratch/onset-noise actuation reached only 0.274× the
measured onset-noise spread; reducing the fitted wander draw to 0.04× still
left an intrinsic engine floor at 2.458× measured. These are excluded only
after empirical actuator-bound evidence and remain visible in the gate JSON.
The unmatched MIDI-62 group is explicitly `not-qualified-pair`.

The legacy row fails because sustain-noise spread is only 0.2544 dB against a
1.8833 dB measured floor. The r5 candidate reaches 2.9376 dB and passes.

## T-033 per-string consumption handoff

`BOWED_ENGINE_HANDOFFS.md` lands the exact Agent A consumer contract. It
requires explicit sul-string labels, a 24-semitone playability check,
lowest-pitched covering-string resolution for auto selection, per-string
`partialB`, and bit-identical pooled fallback. Five named engine assertions
must prove selection, auto routing, invalid-selection rejection, no cross-string
pooling, and unchanged fallback PCM.

Analysis-side consuming assertions are live: profile fitting accepts only
explicit filename labels and emits independent tables without pooling. The
generated profiles contain violin `sulG/sulD/sulA/sulE` and cello
`sulC/sulG/sulD/sulA`. T-033/T-043 remain `pending-Agent-A` for the engine
consumer; this pass does not claim that engine-owned step complete.

## Cello campaign start

The cello builder now handles complementary Iowa reacquisition runs rather
than assuming one filename covers a complete string. Its durable campaign has:

- six scored references spanning low/mid/high × pp/ff;
- 17 fitted fixed-Hz body resonances and four independent string tables;
- one true catalogue duplicate, six documented adjacent-semitone proxy pairs,
  and 351 single-bow trims;
- four mechanically full-tail references and two truncated references;
- a clean `partialTilt` audit, with no uncontrolled weighted feature.

The adjacent-semitone pairs are documented as proxy sensitivity evidence only;
they do not create a Human variability floor. The first run exits
`limiting-factor` and files acquisition of same-performance matched takes plus
a low-register positive-A0 body anchor as the next work item.

Legacy prior: `cello ← legacy cello`; row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`;
resolved parameter hash
`24c6e9ef416a53764219469fc5185106249266625afa8114f48b575d7cc2e8ef`.

## Release controllability

The refreshed tail audit finds 17 mechanically eligible violin rows, a strict
superset of the 14 rows known at pass start. The clean, repeat-stable audit
retains all three release features at weight 1:

| Feature | Best responder | Response | Weight |
|---|---|---:|---:|
| release ring | `releaseDamping` | 10.3000 units | 1 |
| damping slope | `releaseDamping` | 50.0940 units | 1 |
| release noise | `releaseDamping` | 32.3372 units | 1 |

Scorer contract: `sg2-score-release-tail-v5`; audit manifest hash
`8cc51260a37bd471`; objective hash `1baddc24fa13f721`; renderer contract hash
`7593498d36e0ca41`. Release weights are activated for violin only. Cello stays
at zero until it passes its own release audit.

## Empirical criteria hierarchy

At the pass-end snapshot, the shared matrix contains 101 accepted steps, 16
significant asymmetric edges, 80 symmetric-coupling candidates, and one
theory-order disagreement. The first ordered promoted edge is
`inharmonicity_log_ratio ⊣ release_noise_db` (18 vs 7 events,
`p=0.0432853`), so the working hierarchy now begins with measured evidence
rather than the sparse-evidence fallback. The strongest current edge is
`log_mel_db ⊣ release_noise_db` (25 vs 5, `p=0.000324914`). Concurrent lanes
continue to append to the same durable matrix.

## Leaderboard, backstop, and listening artifacts

Violin legacy row: `violin ← legacy violin`; row hash
`334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`;
resolved parameter hash
`91e2efb81d45e60c455612a93ed9f5008906836f9c9d6c9b3af4008b3388ff01`.

`sg2-data/runs/violin/leaderboard.json` and
`sg2-data/state/violin/leaderboard.json` are byte-identical and identify r5 as
`shipEligible`, `beatsLegacyComposite`, and variation-passed. The run-local
best snapshot is also present under `sg2-data/state/violin/`. The global
listening, dashboard, and versions pages were rebuilt after merging the live
shared branch.

## Verification

- `npm test`: 11/11 PASS.
- `node scripts/verify_tone_model.mjs`: all tone-model assertions PASS.
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: 214/214 PASS.
- `PORT=8897 SG2_URL=http://127.0.0.1:8897 ... node scripts/render_note.mjs --verify`:
  PASS, renderer hash
  `b479fbef58634ff93e2123cd548a4d69ad611933e837910aad20cbafa0a0f624`.
- `python3 scripts/sg2_listen_page.py`: PASS.

## Pending mandates and exit state

- Violin session outcome: `improvement`; promoted to the leaderboard, not
  frozen as an owner-approved factory preset.
- Cello session outcome: `limiting-factor`; matched Human takes and the missing
  low positive-A0 anchor are filed work.
- T-033 engine consumer and its five consuming assertions remain pending Agent
  A; analysis storage and no-pooling assertions are landed.
- Violin strict §3, resource, vibrato/body-AM, and two unreachable Human
  observable obligations remain visible.
- OWNER DECISION NEEDED: none.
