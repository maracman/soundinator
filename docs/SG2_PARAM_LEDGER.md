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

## trumpet — wp5-trumpet-pass1

Composite loss: `3.664635` on reference set `618957c6167cedd3`, improved from
`4.301156`. All nine construction assertions passed. Both eligible
high-register same-note/dynamic groups reached the measured variability floor:
`ff = 0.9775×` and `pp = 0.7930×` their respective take-to-take distances.

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.000000 | -0.000045 |
| `breathNoiseColor` | 0.000000 | 0.010672 |
| `dynamicBlare` | 0.250000 | 0.015055 |
| `excitationHuman` | 0.800000 | 0.105983 |
| `excitationPosition` | 0.300000 | -0.094447 |
| `partialTilt` | -0.100000 | 0.194935 |
| `partialTransfer` | 0.100000 | 0.017431 |
| `spectralResonanceAmount` | 0.350000 | 0.068296 |
| `toneBreath` | 0.030000 | -0.000076 |

The shipping playback variant uses `spectralCullThreshold = 0.0006`: 23
oscillators and 230 automation events/note, both within 1.25× the current
factory medians. It adds `0.2108 dB` mean mel distance versus the full fit and
preserves every construction assertion and both measured-floor groups.

## flute — wp5-flute-pass1

Composite loss: `4.134439`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.695930318309064 | 0.000215 |
| `breathNoiseColor` | 0.17102302745352282 | 0.002085 |
| `excitationHuman` | 0.6463232212150435 | 0.011840 |
| `excitationPosition` | 0.27160207847800744 | 0.121688 |
| `partialTilt` | 0.0 | 0.316496 |
| `partialTransfer` | 0.0 | 0.015301 |
| `spectralResonanceAmount` | 0.35 | 0.001674 |
| `toneBreath` | 0.2784344436125379 | 0.000001 |

## flute — wp5-flute-pass2

Composite loss: `3.917010`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.30284110384850393 | not run |
| `attackNoiseLevel` | 1.6640631626276137 | not run |
| `attackNoiseVelocityExponent` | 0.001056068160506296 | not run |
| `breathNoiseColor` | 0.17102302745352282 | not run |
| `excitationHuman` | 0.6463232212150435 | not run |
| `excitationPosition` | 0.27160207847800744 | not run |
| `partialTilt` | 0.0 | not run |
| `partialTransfer` | 0.0 | not run |
| `spectralResonanceAmount` | 0.35 | not run |

## alto-sax — wp5-alto-sax-corrected-pass1b

Composite loss: `4.645456`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 0.5266877345078729 | 0.000093 |
| `breathNoiseColor` | 0.2795888588276901 | 0.002166 |
| `dynamicBlare` | 0.4 | 0.001597 |
| `excitationHuman` | 0.364403648667616 | 0.006970 |
| `excitationPosition` | 0.08315571358214188 | 0.369585 |
| `partialTilt` | 0.0 | 0.183420 |
| `partialTransfer` | 0.1 | 0.002441 |
| `spectralResonanceAmount` | 0.35 | 0.002479 |
| `toneBreath` | 0.3055728090000841 | -0.000000 |

## alto-sax — wp5-alto-sax-owner-notes-pass2

Composite loss: `3.867218`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 0.5266877345078729 | 0.000024 |
| `breathBodyAmount` | 0.7835799563788599 | 0.002858 |
| `breathLevelScale` | 2.0233281560585272 | -0.000061 |
| `breathNoiseColor` | 0.03606797749978963 | 0.004457 |
| `breathTurbulence` | 0.616623651029748 | 0.008380 |
| `breathVelocityExponent` | 0.23432013743870406 | 0.015026 |
| `dynamicBlare` | 0.4 | -0.000155 |
| `onsetSpectrumDecay` | 0.06980930789040009 | 0.002184 |
| `onsetSpectrumTilt` | -0.21878552323970732 | 0.002691 |
| `partialTilt` | 0.0 | 0.174295 |

## flute — flute-p52

Composite loss: `3.931730`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `spectralResonanceAmount` | 1.0 | not run |

## clarinet — clarinet-p52

Composite loss: `3.640671`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `spectralResonanceAmount` | 1.0 | not run |

## alto-sax — alto-sax-p52

Composite loss: `3.926406`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `spectralResonanceAmount` | 1.0 | not run |

## trumpet — trumpet-p52

Composite loss: `3.121096`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `spectralResonanceAmount` | 1.0 | not run |

## french-horn — french-horn-p52

Composite loss: `2.888251`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `spectralResonanceAmount` | 1.0 | not run |

## violin — agentd-interim-v2-baseline-r2

Composite loss: `4.278461`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.0 | not run |
| `dynamicBlare` | 0.0 | not run |
| `excitationPosition` | 0.09 | not run |
| `partialMaterial` | 0.08 | not run |
| `partialTilt` | 0.0 | not run |
| `partialTransfer` | 0.1 | not run |
| `spectralDynamicAmount` | 0.8 | not run |
| `spectralResonanceAmount` | 0.35 | not run |
| `vibratoDepth` | 30.335 | not run |
| `vibratoProb` | 0.88 | not run |
| `vibratoRate` | 5.911 | not run |
