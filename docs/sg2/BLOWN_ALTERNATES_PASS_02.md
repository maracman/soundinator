# Blown alternate-take pass 02 — 2026-07-17

## Scope and corpus outcome

This pass supersedes the missing-alternate decision in
`BLOWN_REACQUIRED_REBASELINE.md`. The deterministic campaign builder consumed
the restored sample corpus and cleared every `missingAlternates` list. No
identity parameter was widened from Human residuals and no instrument was
frozen.

| Instrument | References | Matched floor groups | Missing alternates |
|---|---:|---:|---:|
| Flute | 12 | 6 | 0 |
| Clarinet | 11 | 4 | 0 |
| Alto sax | 12 | 6 | 0 |
| Trumpet | 7 | 1 | 0 |
| French horn | 12 | 6 | 0 |

The clarinet high-soft Iowa take was detected at MIDI 85 rather than the
declared MIDI 84, and one high alternate also failed the builder's exact-pitch
check; neither can form a defensible duplicate group. The trumpet fortissimo
alternate remains hard-excluded under the owner's T-012 rejection, leaving
the accepted high-pianissimo pair. These are evidence-quality exclusions, not
missing files.

## §2.5c differential result

The five campaigns were rerun under the schema-v2 three-valued decomposition
and §2.5c.1b double-dissociation machinery landed at `124eb60`.

| Instrument | Groups / pairs | Verdict | Failed residual pairs | Qualified candidates | Functional qualified consumers |
|---|---:|---|---:|---:|---:|
| Flute | 6 / 6 | `INCONCLUSIVE-MASKED` | 6 | 11 | 1 |
| Clarinet | 4 / 4 | `INCONCLUSIVE-MASKED` | 4 | 6 | 1 |
| Alto sax | 6 / 6 | `INCONCLUSIVE-MASKED` | 6 | 10 | 1 |
| Trumpet | 1 / 1 | `INCONCLUSIVE-MASKED` | 1 | 6 | 1 |
| French horn | 6 / 6 | `INCONCLUSIVE-MASKED` | 5 | 10 | 1 |

Horn's preceding binary failure is therefore reclassified. Its 5/6 residual
failures are masked by identity fits outside the core bars and by unaudited or
non-functional qualified consumers; they do not evidence a missing Human DOF.
The same rule applies to the other four instruments. Qualified take-pair
ranges remain standalone measured evidence, as they do for the 7/11 violin
precedent, but cannot widen identity.

The current candidate registry is bow-centric (T-062): several qualified rows use
bow-specific names or consumers (`bowNoiseLevelDb`, `bowScratchLevelDb`, and
bow-only onset wander) for blown observations. Only `excitationPosition` is
functional in each refreshed blown audit. The engine therefore does not
silently consume these ranges. A blown-specific analysis adapter and a hashed
runtime consumer assertion remain an explicit F4 work item before the
distribution gate can pass.

## Controllability and bounded fit

All five fit-contract audits are repeat-stable, clean, and have zero
uncontrolled weighted features. They are sealed under each campaign's
`audit-r2-isolated` directory, except trumpet's corrected SHIP/FIT-separated
audit at `audit-r3-fit-contract`. `excitationHuman` is deliberately absent
from trumpet's FIT free-parameter manifest.

Run ID: `blown-alternates-r3-isolated`. Every run used the matched rebuilt
campaign seed, its hashed audit, six fresh SHIP variants, and the unchanged
`sg2-legacy` prior at commit `e8d3ac1`.

| Instrument | Evaluations | Baseline | Best | Delta | Construction fails | Tripwire fails | §2.5c.6 checks (pass / little / much) |
|---|---:|---:|---:|---:|---:|---:|---|
| Flute | 16 | 3.8860 | 3.7042 | -0.1818 | 4 | 24 | FAIL (4 / 54 / 3) |
| Clarinet | 16 | 3.4357 | 3.3201 | -0.1157 | 5 | 21 | FAIL (2 / 30 / 1) |
| Alto sax | 11 | 3.7301 | 3.6540 | -0.0760 | 5 | 23 | FAIL (2 / 59 / 0) |
| Trumpet | 16 | 3.5001 | 3.4863 | -0.0137 | 4 | 24 | FAIL (0 / 9 / 0) |
| French horn | 13 | 2.9657 | 2.9433 | -0.0224 | 8 | 27 | FAIL (3 / 52 / 0) |

All five sessions exit `limiting-factor`. The search improved the scalar
objective but did not clear the higher-priority gate tuple. Construction
failures remain:

- Flute: air-jet breath, body stability, band balance, and envelope peak.
- Clarinet: band balance/concentration, soft-breath, turbulence, and
  body-coloured-air laws.
- Alto sax: band balance, soft-breath, turbulence, body-coloured-air, and
  onset-spectrum laws.
- Trumpet: band balance, envelope peak, dynamic articulation, and
  onset-spectrum laws.
- French horn: band balance; soft-breath, turbulence, and body-coloured-air;
  onset-spectrum; independent-onset; soft-onset; and register-onset laws.

The alternate corpus makes the distribution gate evaluable for all five, but
its dominant result is now evidenced `too-little` SHIP spread rather than
`insufficient-evidence`. The sparse `too-much` flute/clarinet cells also show
why a global Human multiplier is not an admissible repair.

| Instrument | Legacy lookup row | Row hash | Resolved parameter hash |
|---|---|---|---|
| Flute | `flute ← legacy flute` | `274cb12161abc1ef…` | `704ba5bbca24f99a…` |
| Clarinet | `clarinet ← legacy clarinet` | `53634a68fcca5ff4…` | `014b7999e44481cc…` |
| Alto sax | `alto-sax ← legacy clarinet` | `010f064f9ea3ecf7…` | `dc1f40565e4ddd6a…` |
| Trumpet | `trumpet ← legacy trumpet` | `86fb9e6aff837318…` | `3d1ab496eac94d71…` |
| French horn | `french-horn ← legacy trombone` | `bd3fc126a7976146…` | `aed8af1b92463a80…` |

## Criteria drift

Every accepted best-so-far optimizer step records its full normalized feature
vector and repeat-render noise floor in the run-local
`accepted-criteria-steps.json` and the live
`sg2-data/state/criteria-drift.json` matrix. Two flute steps from the aborted
non-authoritative `blown-alternates-r2` renderer are excluded from the sealed
state. At merged-state seal the matrix contains 78 accepted steps and 58 directed
transitions overall. This blown wave contributes 42 steps and 37 transitions
(flute 11/10, clarinet 10/9, alto sax 6/5, trumpet 7/6, horn 8/7).

Eleven asymmetric edges clear the six-event/binomial threshold; 86 pairs remain
strong symmetric-coupling candidates. Two measured edges reverse the sparse
theoretical order: `log_mel_db → inharmonicity_log_ratio` and
`onset_scoop_cents → release_noise_db`. These disagreements remain visible;
the theoretical hierarchy is not rewritten by assertion.

## Exit state

The rebuilt alternate evidence removes the old `insufficient-evidence`
condition. It does not by itself make any blown preset freeze-eligible:
construction, tripwire, and two-sided distribution gates must all pass on the
same renderer contract. Factory presets and the parameter ledger remain
unchanged.

The fitter now has an explicit `--resume` contract. It rejects a changed
legacy prior, restores saved evaluation/cache state, preserves saved SHIP
seeds, and renders only missing WAVs. This closed the batch-server interruption
without changing any completed evidence row.

Verification is green on the integrated shared head: `npm test` (11),
`verify_tone_model.mjs`, full Python pytest (206), the targeted SHIP-resume
regression, and isolated
`render_note.mjs --verify` at
`56d9efdf64dfd8188b059d78a5646de00e18f47d509a0126ec7aff93700b8e71`.
