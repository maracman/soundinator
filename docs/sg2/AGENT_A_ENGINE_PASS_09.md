# SG2 Agent A — engine + blown pass 09

Date: 2026-07-18  
Lane: Agent A / engine + blown  
Shared code landing: `8e37641`  
Exit state: **§2.5(b), named limiting factor**; no preset promotion or freeze

## Outcome and crash recovery

The provider-limited attempt left seven coherent octave-sweep files. Crash
protocol retained them after focused tests passed, then the full verifier found
one real consistency defect: T-016's explicit flute body omission had changed
the pooled source decomposition, while the higher-priority neutral blown-source
rows still contained the former anchors. The residue was therefore not green as
found.

The repair refreshes only rows explicitly declared `neutralized` against the
current pooled register source. Accepted cumulative rows remain immutable. The
flute v3 profile now has no body bands, records
`omittedReason=unstable-air-jet-body`, split-half correlation 0.865 and split
peaks 1439.0/1824.3 Hz. Its six neutral source rows were rebound under evidence
SHA-256 `d93b7f04347fd67a9ed890b8d91062f34de006a6d2070a1cf2738d52f15be5d3`.
Construction and merge assertions cover both the explicit omission and stale
body prevention. T-082 records the reusable provenance rule.

The corrected T-078 sweep then ran across all six declared spectral cells for
each of flute, clarinet, alto sax, trumpet and French horn. A step is accepted
only when both deterministic band mean and maximum improve. Each accepted step
changes one existing cumulative source row; body and independent air surfaces
are asserted unchanged. All five fixed candidates were responder-audited and
evaluated with six fresh SHIP variants plus their true-legacy baselines. None is
eligible for promotion.

## Deterministic octave-sweep cells

Values are mean/max octave dB before→after. `P` crosses both 3/6 dB bars, `I`
is a two-sided improvement that remains failing, and `R` is rejected or not
applicable.

| Instrument | low/pp | low/ff | mid/pp | mid/ff | high/pp | high/ff |
|---|---|---|---|---|---|---|
| flute | N/A R | 6.56/8.08→5.29/4.63 I | 10.13/14.97→8.89/13.84 I | 3.42/6.25→2.86/4.12 P | 3.89/8.19→3.12/4.99 I | 2.87/6.79→2.35/3.88 P |
| clarinet | 2.56/8.40→2.39/8.40 I | 5.17/9.32→4.28/8.55 I | 5.76/9.51→5.58/9.27 I | 5.09/29.42→5.04/28.95 I | 7.17/12.54→6.65/10.82 I | 3.31/3.21→3.09/2.48 I |
| alto-sax | 11.82/15.86 R | 2.99/7.03→2.91/4.75 P | 20.01/25.30→19.16/24.27 I | 4.40/3.92→4.27/1.54 I | 5.66/9.73→5.20/7.06 I | 3.02/1.05→2.85/0.55 P |
| trumpet | 3.30/15.79 R | 7.16/19.87 R | 6.55/11.17 R | 7.44/14.48 R | 4.68/17.29→4.51/15.34 I | 8.19/14.33→7.24/14.19 I |
| french-horn | 5.72/27.67 R | 9.14/24.05 R | 6.20/5.03→6.15/3.78 I | 5.04/4.42→4.48/2.49 I | 5.31/4.22 R | 5.70/3.40→5.35/3.17 I |

Selected cumulative hashes and accepted/rejected counts are:

| Instrument | Selected SHA-256 | Accepted | Rejected/N/A | Local PASS cells |
|---|---|---:|---:|---:|
| flute | `5e80209f043c9846380ffab0a2a7429e53e60c14918a72c8fa4202515db97e4c` | 5 | 1 | 2 |
| clarinet | `1014715f13b4480583536e5cbab3ea32255eb5519dd21056e8d8c9df247e3085` | 6 | 0 | 0 |
| alto-sax | `000f46ab874eb453d1ea46d713eac8e5a8f5543a0b7ec455c79184d3f5b556c3` | 5 | 1 | 2 |
| trumpet | `67c7cdaf0366d1d0803ea6a38465562d2e12860066c380b4b5c3976a09e3eca0` | 2 | 4 | 0 |
| french-horn | `bf7f2ef408286a7ededf77fae63fbc42803e6c2d0c3cead9b4dd8d68f968e2f4` | 3 | 3 | 0 |

## Full SHIP band-balance evaluation

The fixed-candidate evaluator pools all applicable reference rows and six fresh
SHIP variants. This stricter layer is authoritative for promotion. Flute mid/ff
is the only full-SHIP band cell that passes; the deterministic alto-sax and
flute high/ff local passes do not survive the complete distribution.

| Instrument | low/pp | low/ff | mid/pp | mid/ff | high/pp | high/ff |
|---|---|---|---|---|---|---|
| flute | N/A | 6.64/13.56 F | 12.63/24.49 F | 2.99/4.13 P | 9.17/24.29 F | 4.04/14.62 F |
| clarinet | 3.67/7.42 F | 4.40/8.21 F | 9.62/23.26 F | 5.07/28.97 F | 5.24/11.00 F | 3.12/2.61 F |
| alto-sax | 10.88/16.11 F | 3.21/4.88 F | 17.61/24.21 F | 4.29/1.57 F | 10.29/18.18 F | 3.77/5.50 F |
| trumpet | 4.14/15.82 F | 7.15/18.63 F | 6.65/11.16 F | 7.51/14.59 F | 4.59/15.32 F | 6.95/14.19 F |
| french-horn | 5.88/29.27 F | 8.31/23.95 F | 6.27/3.72 F | 4.64/2.48 F | 5.33/4.20 F | 6.46/16.03 F |

## Per-preset gate tables, including legacy

Counts are pass/fail/not-applicable. Variation counts are
pass/too-little/too-much. Every detailed generated row, including the legacy
baseline, remains in the named run's `RUN_REPORT.md`.

| Preset/run | Construction | Strict tripwire | Variation | Resource | Leaderboard |
|---|---|---|---|---|---|
| flute r14 candidate | 9/3/0 FAIL | 4/22/49 FAIL; 4 missing | 25/32/4 FAIL | PASS, 25 osc / 250 events | no |
| flute true legacy | 3 construction failures | 26 failures | FAIL | n/a | incumbent only |
| clarinet r8 candidate | 10/5/0 FAIL | 3/21/42 FAIL | 5/21/7 FAIL | FAIL, 41 osc / 410 events | no |
| clarinet true legacy | 5 construction failures | 21 failures | FAIL | n/a | incumbent only |
| alto-sax r8 candidate | 10/6/0 FAIL | 1/23/48 FAIL; 6 missing | 18/39/4 FAIL | FAIL, 60 osc / 600 events | no |
| alto-sax true legacy | 6 construction failures | 29 failures | FAIL | n/a | incumbent only |
| trumpet r8 candidate | 10/4/0 FAIL | 1/23/18 FAIL; 6 missing | 3/6/0 FAIL | FAIL, 39 osc / 390 events | no |
| trumpet true legacy | 4 construction failures | 29 failures | FAIL | n/a | incumbent only |
| french-horn r8 candidate | 14/8/0 FAIL | 5/25/48 FAIL | 21/28/6 FAIL | FAIL, 54 osc / 540 events | no |
| french-horn true legacy | 8 construction failures | 25 failures | FAIL | n/a | incumbent only |

Every candidate remains above the reference-variability floor overall. The
candidate groups at or below their local take-pair floor are flute 3/6,
clarinet 2/4, alto sax 5/6, trumpet 0/1 and horn 2/6. Fresh listening seeds are
38401519, 105004578, 63775234, 1685672091 and 2058964397 respectively.

## Controllability audits

All audits use only `windBreathLevel` and `breathVelocityExponent`, are clean,
repeat-render stable, and have zero uncontrolled weighted features. The scorer
contract is `sg2-score-pitch-sync-breath-v9`; all bind renderer/profile contract
`1121909721d62281`.

| Preset | Objective | Manifest | Initial | Audit SHA-256 |
|---|---|---|---|---|
| flute | `f0c6a3a451b065cd` | `77f24acf2fb45653` | `5e80209f043c9846` | `95bf722e342e390aa7f16371ad8abd45a7c2e1eb7d3641e297676c2ca753f28a` |
| clarinet | `7b940de3522ab37d` | `3ba069e6bddc019e` | `1014715f13b44805` | `9d8e0f34dce26edf25a9057bc5ef837f354f850d2fec919a8a84f41142dd7eb2` |
| alto-sax | `92dae624a7f11072` | `3ba069e6bddc019e` | `000f46ab874eb453` | `72c4cc665b0be6845bb32c4bd5cd0c300f0fe49ceed7925c7f560be71ca9ba31` |
| trumpet | `e8d4c68212ea4a02` | `3d6a99f82fa7f3d4` | `67c7cdaf0366d1d0` | `afa892d1d09fec586b3214e980685390d133264ca04b026736d46c2851365798` |
| french-horn | `3bcace6e5f2605f4` | `3d6a99f82fa7f3d4` | `bf7f2ef408286a7e` | `acf896ed642325d7b47dcd068f031250d99d1305556a917c4e2b51d5e08eb2f3` |

## Strongest priors, leaderboard and durable state

SHIP Human stays nonzero at 0.62. Strongest-prior rows and resolved hashes are:

| Preset | Prior row | Row hash | Resolved parameter hash |
|---|---|---|---|
| flute | `flute ← legacy flute` | `274cb12161abc1ef` | `5e80209f043c9846` |
| clarinet | `clarinet ← legacy clarinet` | `53634a68fcca5ff4` | `1014715f13b44805` |
| alto-sax | `alto-sax ← legacy clarinet` | `010f064f9ea3ecf7` | `000f46ab874eb453` |
| trumpet | `trumpet ← legacy trumpet` | `86fb9e6aff837318` | `67c7cdaf0366d1d0` |
| french-horn | `french-horn ← legacy trombone` | `bd3fc126a7976146` | `bf7f2ef408286a7e` |

No incumbent best was overwritten. All five family leaderboards are
byte-identical to their `sg2-data/state/<instrument>/leaderboard.json`
backstops. Existing frozen `best.json` backstops remain untouched; trumpet and
French horn have no frozen best backstop, so this failing pass does not invent
one.

The durable all-instrument record is
`sg2-data/state/agent-a-pass09-band-balance.json`, SHA-256
`dc2285a8408ea561af74e16eb98cfc4fd334cc0738b0be8b3176778bcf680070`.
Run summary SHA-256 values are flute `8ed3cbd6…`, clarinet `c29c0213…`, alto
sax `2d7efeb4…`, trumpet `fe71bfc2…` and horn `f4ec08b7…`.

## Exit state, next work and mandates

The §2.5 exit is state **(b)**. The named limiting factor remains
`remaining-post-source-post-air-band-balance-cells`. Filed work items are:

- flute: clear low/ff, high/pp and mid/pp without reintroducing an unstable body;
- clarinet: resolve the mid/ff octave outlier and remaining high cells;
- alto sax: resolve low/pp and mid/pp without a body refit;
- trumpet: classify the low/mid residual rejected in all four source probes;
- French horn: classify the low-register residual rejected in three source probes.

The trumpet and horn rejection patterns show those cells are not addressable by
this bounded source-row method. That is evidence to classify the residual, not
permission to fit a room component or copy another instrument's body. T-016
body stability, strict spectral identity, distributional variation and the
reference floor still block §2.5c decomposition. No owner decision is pending.

## Exchange, merge and verification

The live exchange snapshot contains 85 parsed entries and includes T-082. It
is bound to source SHA-256
`6f9ae7c2296109ecc8caeb0ce8587f9d10e722ed6772d4d174634601042f9c92`
and stored at `sg2-data/state/agent-a-pass09-exchange-statuses.json`, snapshot
SHA-256 `8e0ec4dac3a0d64ab55c37001cad72c1e270364daf165193d805b406d90f9bcf`.

The crash-recovery checkpoint is `aebc716`; the combined shared-code landing is
`8e37641`. The shared T-078 generalisation preserves blown fundamental
normalisation while adding bowed peak-normalisation metadata; its combined-head
tests pass without changing the completed blown measurements.

- `npm test`: PASS, 11/11;
- `node scripts/verify_tone_model.mjs`: PASS, all assertions;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS;
- `PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`:
  PASS, PCM SHA-256
  `16d46e40d86744c719af8154224bed215c03bfef391caef655fba7d13d23a6ca`;
- leaderboard/state comparisons and `git diff --check`: PASS.

The global ship-mode listening page is rebuilt after the pass report landing so
its receipt can bind the final shared code state.
