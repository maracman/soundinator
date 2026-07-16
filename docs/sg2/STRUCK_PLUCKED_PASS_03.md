# Struck/plucked pass 03 — durable recovery and nylon plateau

Date: 2026-07-16  
Scope: durable SG2 delivery migration, deterministic nylon recovery, and
focused continuation passes 05–08.

## Outcome

The iteration pipeline is operational and measuring error. All
campaign-critical artifacts now live under `<repo>/sg2-data/` (or
`SG2_DATA`), including references, audits, runs, leaderboards, accepted
`best.json` snapshots, work items, listening renders, and the owner page.

Three accepted passes improved their own hashed objectives:

| Pass | Baseline | Best | Improvement | Result |
|---|---:|---:|---:|---|
| `pass05-focused` | 3.493823 | 3.475820 | 0.52% | accepted |
| `pass06-focused` | 4.080068 | 4.060831 | 0.47% | accepted |
| `pass07-spectral` | 4.066990 | 3.725441 | 8.40% | accepted leader |
| `pass08-refine` | 3.470322 | 3.470322 | 0.00% | limiting factor |

Losses across different reference/objective hashes are not compared as one
continuous curve. Within each pass, the baseline and candidate use the same
hashed references, renderer, preset, scorer, manifest, and active weights.
Pass 08's lower numeric baseline reflects repeat-instability quarantine, not
an unearned improvement over pass 07.

Pass 08 exhausted all seven remaining shared spectrum/onset controls across
44 optimizer evaluations. No candidate beat the baseline. The pipeline is
not stopped by infrastructure, missing error measurement, corpus loss, or an
owner decision. The genuine nylon stopper is T-033: per-string/course
identity must land before the six cell-specific mel residuals can move
independently.

## Gate table

| Gate | Status | Evidence |
|---|:---:|---|
| Durable artifact root | PASS | all rebuilt campaign state is under `sg2-data/`; `/tmp` is not used |
| Deterministic reference rebuild | PASS | six provenance-backed Philharmonia nylon references, low/mid/high × p/f |
| Controllability audit | PASS with watches | schema-v3 identity hashes match; repeat-unstable metrics are zero-weight |
| Guitar construction | PASS | 11/11 assertions |
| Resource tripwire | PASS | 9 oscillators, 9 automation events/note, 0.056 model ms/note |
| Automated §3 active gates | FAIL | all six mel-spectrogram cells remain above bar |
| Reference-variability floor | NOT DEMONSTRATED | no same-pitch/same-dynamic alternate takes |
| Owner listening | OPEN | no family L-note is open; ear acceptance remains the final stage |
| Further global-control iteration | BLOCKED | pass 08 measured a 0.00% plateau; T-033 is required |

## Measured error and residual

The pass-08 objective retained stable, controllable features:
`log_mel_db`, `centroid_semitones`, `attack_ms`, `noise`,
`onset_tilt_db_oct`, `onset_noise_db`, and
`onset_noise_centroid_oct`.

The dominant residual is `centroid_semitones = 10.0190` perceptual units.
Every low/mid/high × p/f mel cell fails the 4 dB gate. Attack passes all six
cells. The partial-table values remain visible but cannot carry loss or gate
weight in this pass because identical renders crossed the repeatability
threshold.

## Controllability

| State | Features |
|---|---|
| Active weighted | `log_mel_db`, `centroid_semitones`, `attack_ms`, `noise`, `onset_tilt_db_oct`, `onset_noise_db`, `onset_noise_centroid_oct` |
| Zero-weight repeat watches | `partials_db`, `decay_log_ratio`, `inharmonicity_log_ratio` |
| Zero-weight control watches | `band_balance_db`, `ltas_rolloff_db_oct`, `onset_lockin_periods` |
| Planned watches | two-polarisation beating, sympathetic bloom, decay-aligned band balance |

The seven pass-08 controls were
`spectralResonanceAmount`, `partialTransfer`, `attackNoiseLevel`,
`attackNoiseDirect`, `partialTilt`, `excitationPosition`, and
`partialMaterial`. Each is demonstrably responsive in the audit; their
combined search still did not lower the stable objective.

## Exchange status

| Entry | Struck/plucked status |
|---|---|
| T-020 pitch-anchored percussive analysis | incorporated |
| T-025 G7 audio-side brightness assertion | incorporated |
| T-028 contact-time hardness | adapted; no longer the dominant residual |
| T-033 per-string identity tables | blocked-engine; exact guitar course selection law, fallback, bounds, and headless assertions filed |
| T-041 repeat-render contract | incorporated; three unstable sensors quarantined |
| T-042 checkout-isolated identity | adapted; durable run hashes renderer/profile bytes |

## Leaderboard and state

`pass07-spectral` remains the accepted overall leader at `3.725441` for
reference set `8a932481f89649ef`. Its durable best-so-far snapshot is:

`sg2-data/state/guitar-nylon/pass07-spectral/best.json`

Pass 08 is deliberately absent from the leaderboard and parameter ledger
because it filed a limiting factor without improvement. Its open work item is:

`sg2-data/state/guitar-nylon/work-items.json`

## Owner listening artifacts

- Auto-built page: `sg2-data/listen.html`
- Accepted pass-07 renders:
  `sg2-data/runs/guitar-nylon/pass07-spectral/renders/eval-0039/`
- Accepted pass-07 run report:
  `sg2-data/runs/guitar-nylon/pass07-spectral/RUN_REPORT.md`
- Pass-08 plateau renders:
  `sg2-data/runs/guitar-nylon/pass08-refine/renders/eval-0000/`
- Pass-08 run report:
  `sg2-data/runs/guitar-nylon/pass08-refine/RUN_REPORT.md`
- Pass-08 controllability:
  `sg2-data/audits/guitar-nylon/pass08-audit/CONTROLLABILITY.md`

## Stop condition

This pass stops under the standing orders only because the limiting factor is
demonstrated and the required consumer is owned by the engine single writer.
Unblock by landing T-033's `stringSelect`/`partialsByString` consumer and its
headless assertions. Then rerun the audit and continue automatically from the
durable pass-07 accepted state; do not promote pass 08's unchanged candidate.

## Verification

- Full Python suite: PASS
- JavaScript suite: 11/11 PASS
- Tone-model v2 headless assertions: PASS
- Headless render verification: PASS
- Owner listening page rebuild: PASS; `pass07-spectral` selected from the
  durable leaderboard
