# Sound Generator 2.0 parameter ledger

Derived by `scripts/tone_match/iterate.py`; lower loss is better. Instrument
rows are appended only when a run becomes the best-so-far result. The private
leaderboards and rendered audio remain under `/private/tmp/sg2/`.

## alto-sax — wp5-alto-sax-pass3

Composite loss: `5.914747` on reference set `e7de2797a29b9587`. Construction
passed; all three eligible same-note/dynamic groups reached the measured
reference-variability floor. The earlier six-reference pass improved from
`5.848736` to `5.648564`; unlike reference sets are intentionally not ranked.

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.381472 | -0.000037 |
| `breathNoiseColor` | 0.415559 | 0.001716 |
| `dynamicBlare` | 1.029472 | 0.002003 |
| `excitationHuman` | 0.600441 | 0.025500 |
| `excitationPosition` | 0.160507 | -0.005278 |
| `partialTilt` | 0.000000 | 0.073860 |
| `partialTransfer` | 0.236068 | 0.011406 |
| `spectralResonanceAmount` | 0.350000 | -0.000156 |
| `toneBreath` | 0.362690 | 0.000059 |

Negative averages mean the two-sided perturbation happened to improve this
particular scorer objective; refinement still stops because the independent
reference-variability floor is already demonstrated. Playback compression is
separate: `spectralCullThreshold = 0.002` adds `0.2264 dB` mel distance while
meeting the construction and resource tripwires; the full 64-partial fit is
retained in the external run dossier.

## clarinet — wp5-clarinet-pass1

Composite loss: `3.832757` on reference set `08fb213770122ba8`, improved from
the corrected-engine baseline `4.066620`. All nine construction assertions
passed and all five eligible same-note/dynamic groups reached the measured
reference-variability floor. The tightest group is middle-register `pp` at
`0.9991×` its take-to-take floor.

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.000000 | -0.000078 |
| `breathNoiseColor` | 0.000000 | -0.016883 |
| `dynamicBlare` | 0.000000 | -0.001408 |
| `excitationHuman` | 0.500000 | 0.013784 |
| `excitationPosition` | 0.150000 | 0.053647 |
| `partialTilt` | 0.000000 | 0.107363 |
| `partialTransfer` | 0.050000 | 0.026097 |
| `spectralResonanceAmount` | 0.350000 | 0.001492 |
| `toneBreath` | 0.030000 | 0.000019 |

This run also corrected the construction mapping that preceded fitting:
`closedTube` retains the passive `1:3:5…` bore-mode law, while measured
radiated partial tables are indexed on integer output harmonics. That change
made the dossier-required high-register even-partial rise possible instead of
misplacing every measured table entry after the fundamental.

WP-P resource flag: the full-fidelity preset benchmarks at 34 oscillators and
340 automation events/note against current-factory medians of 20/190. The
first scalar cull that passes the 1.25× resource gate (`0.00121`, 23/230) adds
`0.5070 dB` mean mel distance and reopens middle-register `pp` to `1.0227×`
its reference floor, so it is rejected. The external work item specifies a
scorer-guided per-partial shipping mask; the converged research fit remains
frozen and is not regressed to satisfy the later compression pass.
