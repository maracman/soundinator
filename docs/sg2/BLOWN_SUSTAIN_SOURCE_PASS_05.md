# SG2 Agent A — blown sustain-source recovery pass 05

Date: 2026-07-17  
Lane: Agent A / engine + blown  
Base integrated head: `f537bd3`
Exit state: **limiting-factor** for all five blown presets  
Owner decision: **none**

## Outcome and crash recovery

The interrupted pass was recovered without discarding any coherent work. The
dirty tree contained one connected change: measured register × dynamic source
rows were being admitted only when the upstream partial objective improved,
with rejected rows retaining their attempted evidence but emitting the exact
pooled source anchor. The same dirty tree also made non-finite Human calibration
provenance strict-JSON-safe before renderer emission. JSON validation,
`git diff --check`, the full Python/npm/tone-model suites and the isolated
current-worktree renderer verification all passed, so the changes were kept.
Nothing coherent was lost.

Two older `sustain-source-r6` result sets had timestamps before the final
hierarchy gate and evaluated every measured row as active. They are retained as
non-authoritative crash provenance only. All tables below come from fresh
integrated-head audits and `sustain-source-r6-recovery-integrated` runs made
after the gate was final and the harp/glockenspiel plus bowed/struck landings
were merged.

The recovered `BLOWN-SUSTAIN-01` handoff remains complete for every required
cell and preserves every attempted measured row. Activation is deliberately
sparse:

| Instrument | Activated cells | Neutralised cells | Accepted cells |
|---|---:|---:|---|
| Flute | 0 | 6 | none |
| Clarinet | 3 | 3 | low/pp, mid/ff, mid/pp |
| Alto sax | 1 | 5 | high/ff |
| Trumpet | 2 | 4 | high/pp, low/pp |
| French horn | 4 | 2 | high/ff, high/pp, low/pp, mid/pp |

The consumer assertions enumerate all five instruments, require those exact
activation counts, and prove every neutralised cell equals its pooled source
anchor. `attemptedPartials` preserves the rejected fitted value, while
`activationStatus` makes the hierarchy decision inspectable. This is a
per-dimension F13 decision: the paired evidence is full-strength partial-shape
evidence, but a row that worsens that upstream dimension is not reclassified as
weak evidence or allowed to alter downstream identity.

The calibration is
`scripts/tone_match/calibrations/blown-sustain-source-pass05.json`; its generated
consumer is `web/static/measured_profiles.js`.

## Current-head controllability

Controllability was rerun before any new FIT evaluation. Every audit is clean
and repeat-stable, uses renderer contract `095c293b83ebd244`, and reports no
uncontrolled weighted feature. `decay_log_ratio` and `vibrato` remain explicit
zero-weight watch metrics in all five audits.

| Instrument | Free controls | Objective hash | Manifest hash | Result |
|---|---:|---|---|---|
| Flute | 13 | `d30648e15e6cc119` | `d74255af171c3c4e` | CLEAN |
| Clarinet | 12 | `9575c25ca4bd5e68` | `38b607269a3c9212` | CLEAN |
| Alto sax | 13 | `c726fc3d732d19ca` | `029eca70b7584ac7` | CLEAN |
| Trumpet | 12 | `c3540929aa8dfabb` | `2e5e2c8b1fa62363` | CLEAN |
| French horn | 17 | `a5e15cfcf130f152` | `3c73f4c655d737e4` | CLEAN |

Authoritative audits are under
`sg2-data/campaigns/<instrument>/audit-sustain-r6-recovery-current/` and are
backstopped as
`sg2-data/state/<instrument>/controllability-sustain-r6-recovery-current.json`.
Trumpet's Identity manifest contains 12 controls: the initially considered
`excitationHuman` control is Human-only and was correctly excluded before the
authoritative audit and FIT contract were frozen.

## §3 candidate and legacy gates

Each candidate was evaluated once in deterministic FIT mode, then rendered in
SHIP mode with six fresh seeds. Distribution counts are
`pass / too-little / too-much`; the legacy row is recomputed against the same
current objective and fresh SHIP comparison.

| Preset | Loss | Construction pass/fail | Strict tripwire pass/fail/N/A | Missing strict bar-cells | Distribution | Overall |
|---|---:|---:|---:|---:|---:|---|
| Flute candidate | 3.738809 | 8/4 | 2/24/49 | 4 | 16/39/6 | FAIL |
| Flute legacy | 3.738809 | —/4 | —/28/— | — | 26/30/5 | FAIL |
| Clarinet candidate | 2.855045 | 10/5 | 3/21/42 | 0 | 9/21/3 | FAIL |
| Clarinet legacy | 2.855045 | —/5 | —/21/— | — | 12/17/4 | FAIL |
| Alto sax candidate | 3.791879 | 11/5 | 1/23/48 | 6 | 23/32/6 | FAIL |
| Alto sax legacy | 3.791879 | —/5 | —/29/— | — | 20/37/4 | FAIL |
| Trumpet candidate | 3.295428 | 10/4 | 1/23/18 | 6 | 4/5/0 | FAIL |
| Trumpet legacy | 3.295428 | —/4 | —/29/— | — | 3/6/0 | FAIL |
| French horn candidate | 2.825698 | 14/8 | 5/25/48 | 0 | 27/21/7 | FAIL |
| French horn legacy | 2.825698 | —/8 | —/25/— | — | 23/24/8 | FAIL |

The current strict consumer names missing evidence by bar × register ×
dynamic. Flute lacks low/pp band-balance plus three pp envelope-peak cells;
alto sax and trumpet lack envelope-peak evidence in all six cells. Clarinet and
horn have complete strict coverage but still fail measured bars. Construction
failures remain physical and named in the run summaries: band balance is common
to all five; the remaining failures are breath/turbulence/body-air, envelope,
dynamic-articulation, onset-spectrum and register/onset laws as applicable.

No candidate clears construction, strict tripwire and two-sided distribution
together, so no leaderboard best is promoted. The durable incumbent
leaderboards remain under `sg2-data/state/<instrument>/leaderboard.json`; the
three previously selected blown `best.json` backstops remain byte-unchanged,
and trumpet/horn still have no selected freeze artifact to fabricate. Fresh
summaries are copied to
`sg2-data/state/<instrument>/sustain-source-r6-recovery-integrated-summary.json`.

## Legacy-prior identity

| Instrument | Lookup row | Prior row hash | Resolved parameter hash |
|---|---|---|---|
| Flute | `flute <- legacy flute` | `274cb12161abc1efc3b4cce73a918d4d70af1f3334b789988a0ca894b1ff39d5` | `b2efb135c5728a44955835f51cd1243c97959b653eb41c59600e41c231ec7fbf` |
| Clarinet | `clarinet <- legacy clarinet` | `53634a68fcca5ff4eb7a0bcfd4a82deca219cd7772cb533f99066e70f7c64593` | `2fd55a38fdeb75507145793f02fce0cd2cd25c6b37b8cab44d5eb8678316084a` |
| Alto sax | `alto-sax <- legacy clarinet` | `010f064f9ea3ecf7754c98bba584b6c75301f15a4eb02ac9f50467dc39acbce3` | `91d175b9ccbebb4bcd322d88e5550ef830b9b28f5667313b1e43a3f361b2b3bc` |
| Trumpet | `trumpet <- legacy trumpet` | `86fb9e6aff837318eeb50d2925aeeb6247d872f48cd3152d8b55ccdc30059b16` | `5eafebcaffec85f6ecf4126e2d846af8de0d2372ae4f14b6f1a8da24349a55a7` |
| French horn | `french-horn <- legacy trombone` | `bd3fc126a7976146c6feffce524536da216c526f65313d00a3de2410c0529a8d` | `d3fe1f631f3d47646d867621f73032d1caebd6bf3bcf2d8c6051d37bea1fc2e0` |

## Exchange reconciliation and mandates

The live exchange parser now reports T-013 and T-017 as incorporated canonical
consumers and names bar-specific strict gaps. It also reconciles already-landed
T-033, T-065 and held-strike/pluck T-067 against their actual commits, while
keeping the sung T-067 base consumer distinct and restoring T-071 to
`engine=n/a`. The generated snapshot is
`sg2-data/state/agent-a-pass05-exchange-statuses.json`.

T-069 remains `engine=pending-Agent-A`: pinned envelope-deviation anomaly
classes cannot enter a preset until their neutral consumer and consuming
assertions land. No source value is guessed in this pass. T-064 consequently
remains a neutral later-family adaptation rather than permission to transfer
struck/plucked values into sung or blown presets.

The newly integrated T-072 bar-mode contract is also correctly preserved as
`engine=pending-Agent-A`; later status prose for incorporated T-033, T-065 and
held-strike/pluck T-067 no longer overwrites that separate bar consumer.

## Listening page, verification and next work

`sg2-data/listen.html` was rebuilt from integrated engine `f537bd3` in SHIP
mode with fresh build seed `1784291636`. It contains 16 instruments and this
build re-rendered 12 sections: alto sax, cello, clarinet, flute, French horn,
glockenspiel, grand piano, nylon guitar, harp, upright piano, trumpet and
violin.

Pass-end verification:

- `npm test` — PASS;
- `node scripts/verify_tone_model.mjs` — PASS;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` — PASS;
- `PYTHON=../../../.venv/bin/python node scripts/render_note.mjs --verify` —
  PASS, PCM hash
  `01cdeb76545687020b66a48a62c1b16f1d066904d34296d778c76fa5598ab9dc`;
- calibration JSON validation and `git diff --check` — PASS.

The bare host `python3` renderer check initially met the macOS 3.9
`dataclass(slots=...)` incompatibility; rerunning with the repository Python
environment passed and is the authoritative result. This is an environment
selection issue, not an audio or model failure.

Exit state is **limiting-factor** for flute, clarinet, alto sax, trumpet and
French horn. Each durable work item is
`clear-the-next-upstream-partial-cell-before-any-downstream-refinement` in
`sg2-data/state/<instrument>/work-items.json`. The engine lane's separate next
consumer item is T-069. No final freeze and no owner decision are claimed.
