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
