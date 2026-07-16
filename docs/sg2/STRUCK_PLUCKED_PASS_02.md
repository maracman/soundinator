# Struck/plucked pass 02 — iteration pipeline and nylon profile repair

Date: 2026-07-16  
Scope: nylon-string guitar iteration pipeline, scorer contract, and measured register profile.

## Outcome

The corrected renderer objective improved from `5.069215` to `4.064514`
(`19.82%`) while construction remained `11/11 PASS`, resource limits passed,
and active tripwire failures fell `16 → 14`. The accepted run is
`restored-iteration-04-profile-v2`.

The prior guitar profile had octave-misdetected register anchors near
`120/459/1206 Hz`. Single-note corpus filenames now supply trusted pitch
anchors, and the regenerated nylon profile uses `82.407/195.998/659.255 Hz`
for E2/G3/E5. Only the `guitar` measured profile changed.

## Gate table

| Gate | Status | Evidence |
|---|:---:|---|
| Reference/corpus contract | PASS | Six source-matched Philharmonia nylon references, low/mid/high × p/f |
| Active-window scorer | PASS | Reference and render trajectories share scheduled note windows; inaudible tails and codec bins are rejected |
| Controllability contract | PASS | Schema v3; references, manifest, initial preset, scorer, and renderer/profile bytes are hashed |
| Repeat-render stability | PASS with watch | `decay_log_ratio` repeat-unstable and zero-weighted |
| Guitar construction | PASS | 11/11 assertions; dynamic-brightening slope `0.415` |
| Resource tripwire | PASS | 10 oscillators, 10 automation events/note, model math below limit |
| Automated §3 gate | FAIL | 14 active bar×register×dynamic failures remain |
| Reference-variability floor | N/A | No same-pitch/same-dynamic alternate takes |
| Owner listening | OPEN | No struck/plucked L-note is currently open; owner ear acceptance is still required |

## Measured error

Values are mean normalized perceptual units over the six active references.

| Feature | Baseline | Accepted | Delta |
|---|---:|---:|---:|
| Partial table | 4.6211 | 7.4373 | +2.8162 |
| Log-mel spectrum | 3.7860 | 4.9314 | +1.1454 |
| Spectral centroid | 15.7392 | 11.4583 | -4.2809 |
| Attack | 0.6488 | 0.6070 | -0.0418 |
| Inharmonicity | 8.5083 | 1.7069 | -6.8014 |
| Residual noise | 8.0140 | 6.4734 | -1.5406 |
| Onset tilt | 2.3480 | 2.1199 | -0.2281 |
| Onset-noise level | 0.7119 | 1.7218 | +1.0098 |
| Onset-noise centroid | 1.2456 | 0.1246 | -1.1210 |

The accepted result is not declared converged: all 12 partial-table and
log-mel cells still fail. The improvement comes mainly from removing the
corrupt register/f0 model, closing inharmonicity errors, and lowering centroid
and residual-noise error. T-033 remains the named engine/data blocker for
steel↔nylon string identity.

## Controllability

| State | Features |
|---|---|
| Active weighted | `partials_db`, `log_mel_db`, `centroid_semitones`, `attack_ms`, `inharmonicity_log_ratio`, `noise`, `onset_tilt_db_oct`, `onset_noise_db`, `onset_noise_centroid_oct` |
| Zero-weight repeat watch | `decay_log_ratio` |
| Zero-weight control watches | `band_balance_db`, `ltas_rolloff_db_oct`, `onset_lockin_periods` |
| Planned watches | two-polarisation beating, sympathetic bloom, decay-aligned band balance |

## Exchange status

| Entry | Struck/plucked status |
|---|---|
| T-020 pitch-anchored percussive analysis | incorporated; profile generation now consumes declared single-note pitch |
| T-028 contact-time hardness | adapted; current G7 passes, but contact colour is not independently fit |
| T-033 per-string identity tables | blocked-engine; pooled guitar tables cannot close the steel↔nylon identity contract |
| T-041 repeat-render/audit contract | incorporated as schema v3 |

## Leaderboard

| Reference/renderer objective | Leader | Loss | Active failures |
|---|---|---:|---:|
| `55a85f671dbaf5a4` | `restored-iteration-02` | 4.765464 | 17 |
| `9a0e540648866dc9` | `restored-iteration-04-profile-v2` | 4.064514 | 14 |

The invalid gate-only `restored-iteration-01` entry was removed. Future
invalid stops and filed limiting factors cannot mutate the leaderboard or
parameter ledger.

## Owner listening artifacts

- Audit: `/private/tmp/sg2/guitar-nylon/restored-audit-03-profile-v2/`
- Accepted renders: `/private/tmp/sg2/guitar-nylon/restored-iteration-04-profile-v2/renders/eval-0019/`
- Listening page: `/private/tmp/sg2/guitar-nylon/restored-iteration-04-profile-v2/listen-guitar-nylon-restored-iteration-04-profile-v2.html`
- Run report: `/private/tmp/sg2/guitar-nylon/restored-iteration-04-profile-v2/RUN_REPORT.md`
- Plateau evidence/work item: `/private/tmp/sg2/guitar-nylon/restored-iteration-03/` and `/private/tmp/sg2/guitar-nylon/work-items.json`

## Verification

- Full Python test suite: PASS
- JavaScript tests: 11/11 PASS
- Tone-model v2 headless assertions: PASS
- Headless render verification: PASS
