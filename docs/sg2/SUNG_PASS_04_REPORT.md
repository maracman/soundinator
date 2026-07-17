# SG2 sung campaign — pass 04 vowel consumption, soprano coverage and mezzo start

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-e-sung-r2`
Exit state: measurable construction-gate improvement; no section frozen

## Outcome

The tenor 0/10 vowel failure was not an engine-plumbing defect.  Ten paired
FIT renders, each with the selected fitted body enabled and bypassed, recover
the exact emitted band law with 0.06–0.19 dB median scale-free shape error and
0.862–0.998 correlation.  All fitted tenor F1/F2 centres also lie inside their
adult-male annex regions, so the consuming gate is now 10/10.  The previous raw
LPC result remains 0/10 (six missing estimates and four harmonic-root
artefacts) as an explicit watch.  No engine escalation is evidenced.

Female1's annotated slow-piano scale now contributes one high-register
spectral cell per vowel at MIDI 79 / 783.99 Hz.  This is above the declared
698.46 Hz soprano passaggio; it changes the campaign from low/mid-only to a
true three-register objective without admitting another singer or relabelling
female2 repeat evidence as identity.  The source-stem filename fix also stops
C- and F-start scale rows from silently overwriting one another.

Female5 (`f5`) is now the canonical mezzo-soprano primary under the same
official-annotation, pooled-source, per-vowel-body, legacy-prior and hashed
controllability pipeline.  Her first canonical run is an integration baseline,
not a fitted freeze.

## Canonical gate table and legacy rows

The durable objective-scoped leaderboards are
`sg2-data/runs/voice-{tenor,soprano,mezzo}/leaderboard.json`; each has a
backstop at `sg2-data/state/<instrument>/leaderboard.json`.  The first
legacy-initialized row is entry 1.  Soprano and mezzo have no later comparable
candidate yet, so their entry-1 baselines remain their current leaders while
failing ship gates.

| Preset / entry | Composite | Construction | Strict §3 | Emitted body | Vowel | §2.5c Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy baseline, pass03 | 4.289207 | FAIL 9/10 | FAIL | unmeasured / FAIL | FAIL 0/10 | not run | **FAIL** |
| Tenor pass04 candidate | 4.289171 | FAIL 9/10 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano legacy-initialized entry 1 | 4.955247 | PASS 9/9 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo legacy-initialized entry 1 | 4.079181 | FAIL 8/9 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | not run | **FAIL** |

Tenor's candidate leads its current comparable objective because it closes two
hard gates without a composite regression.  It does not overwrite or pretend
comparability with the pass-02 objective; the prior state is retained inside
the schema-3 leaderboard as `previousObjectiveBoard`.

## Corpus fits

| Voice | Primary | Spectral analysed | Registers / dynamics / vowels | Reconstruction median / P95 | Vibrato analysed |
|---|---|---:|---|---:|---:|
| Tenor | male3 | 30/45 | 3 / 3 / 5 | 4.8419 / 18.6591 dB | 0 |
| Soprano | female1 | 45/50 | 3 / 4 / 5 | 4.8293 / 16.3499 dB | 0 |
| Mezzo-soprano | female5 | 42/45 | 3 / 3 / 5 | 5.3986 / 17.8810 dB | 0 |

The soprano rebuild contains 114 references: 50 spectral/onset, 10 vibrato,
44 floor and 15 humanisation-role rows.  `passaggioStraddled=true`.  Five
explicit high `/a e i o u/` cells come from female1 only.  The extra evidence
slightly worsens the raw reconstruction statistic relative to pass 03
(4.8025 → 4.8293 dB) but closes the required register contract.

The mezzo rebuild contains 122 references: 45 spectral/onset, 15 vibrato, 47
floor and 15 humanisation-role rows, spanning all five vowels, three registers
and ff/mf/pp.  The first fit analyses 42 rows and records three pitch-lock
rejects.

## Controllability and prior ledger

All positive-weight features have at least one measured responder.  The exact
audits below are consumed by the canonical runner before rendering.  After
merging the latest shared engine, all three audits were fully regenerated and
match renderer contract hash `9d21ecad9acce077`.

| Voice | Objective hash | Manifest hash | Repeatability | Zeroed unstable watch | Clean |
|---|---|---|---|---|---|
| Tenor | `8933926c01eeb666` | `3ce7106e74cde4b9` | stable | none | yes |
| Soprano | `45c9829cd0af41a5` | `3ce7106e74cde4b9` | watch zeroed | `inharmonicity_log_ratio` | yes |
| Mezzo-soprano | `bd875841a4b89802` | `3ce7106e74cde4b9` | stable | none | yes |

Every fit names the legacy `vocal` prior at tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, canonical sung-fit parameter
hash `8b1047dfbe83d6ba`.  Soprano's audit-resolved parameter hash is
`be4d2f6dc0b4e6ea`; mezzo's is `2300edfb9f8e89bf`.  FIT scoring is
deterministic; the audition manifests retain fresh SHIP seeds and performance
craft.

## §2.5c eligibility

No voice identity stabilised enough for a differential Human fit.  Tenor and
mezzo still fail pitch-synchronous breath construction and all three voices
remain far above the 1 dB source/body reconstruction bar with strict spectral
tripwire failures.  Running §2.5c now would let take variation absorb identity
error.

Female2 (`f2`) has same-singer repeats and remains admissible soprano Human
evidence.  She is not female1 and therefore cannot supply or widen female1's
deterministic identity.  This pass records `T-055` as
`adapted-not-run-identity-unstable`; no `humanRanges` were emitted.

## Exchange, artifacts and exit

`T-058` records the paired emitted-body method and the evidenced decision not
to escalate engine plumbing.  Exchange dispositions are generated directly
from the live append-only file into
`sg2-data/runs/sung-pass04/EXCHANGE_STATUS.json`, including its source SHA-256.
Leaderboard-selected `best.json` files and per-run `RUN_REPORT.md` gate tables
are present for tenor, soprano and mezzo and copied to durable state backstops.

No owner decision is required.  The limiting factors for the next pass are,
in order:

1. reduce pooled-source/per-vowel-body reconstruction below 1 dB and close the
   partial, mel, attack and band-balance strict cells;
2. fit or consume pitch-synchronous breath for tenor and mezzo;
3. recover stable vibrato trajectories (all three current identity fits
   analyse zero vibrato rows);
4. only then fit same-singer differential Human ranges and run the seeded
   two-sided distribution gate.
