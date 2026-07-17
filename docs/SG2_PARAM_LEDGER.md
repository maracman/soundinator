# Sound Generator 2.0 parameter ledger

Derived by `scripts/tone_match/iterate.py`; lower loss is better. Instrument
rows are appended only when a run becomes the best-so-far result. The private
leaderboards and rendered audio remain under the durable `SG2_DATA` root.

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

## french-horn — wp5-french-horn-owner-l5-baseline

Composite loss: `2.842461`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `articulationCoupling` | 0.5518 | not run |
| `articulationStrength` | 0.5 | not run |
| `articulationVariation` | 1.0 | not run |
| `onsetScoopDepthCents` | 99.3814 | not run |
| `onsetScoopRearticulatedScale` | 0.35 | not run |
| `onsetScoopRegisterSlope` | 0.35 | not run |
| `onsetScoopSettle` | 0.1533333 | not run |
| `onsetScoopVelocitySlope` | -0.25 | not run |

## french-horn — wp5-french-horn-owner-l5-baseline-v2

Composite loss: `2.842462`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `articulationCoupling` | 0.5518 | not run |
| `articulationStrength` | 0.5 | not run |
| `articulationVariation` | 1.0 | not run |
| `onsetScoopDepthCents` | 99.3814 | not run |
| `onsetScoopRearticulatedScale` | 0.35 | not run |
| `onsetScoopRegisterSlope` | 0.35 | not run |
| `onsetScoopSettle` | 0.1533333 | not run |
| `onsetScoopVelocitySlope` | -0.25 | not run |

## french-horn — wp5-french-horn-owner-l6-baseline

Composite loss: `2.704752`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `onsetScoopDepthCents` | 107.304 | not run |
| `onsetScoopRegisterSlope` | 0.35 | not run |
| `onsetScoopSettle` | 0.1502268 | not run |
| `onsetScoopVelocitySlope` | -0.25 | not run |
| `spectralResonanceAmount` | 1.0 | not run |

## french-horn — wp5-french-horn-owner-l6-onset2

Composite loss: `2.517304`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `onsetScoopDepthCents` | 3.5774106744509737 | not run |
| `onsetScoopRegisterSlope` | 0.35 | not run |
| `onsetScoopSettle` | 0.1502268 | not run |
| `onsetScoopVelocitySlope` | -0.25 | not run |
| `spectralResonanceAmount` | 0.5854814992176212 | not run |

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

## violin — agentd-t040-densified-body-baseline-r2

Composite loss: `4.345179`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.0 | not run |
| `dynamicBlare` | 0.0 | not run |
| `excitationPosition` | 0.09 | not run |
| `partialMaterial` | 0.08 | not run |
| `partialTilt` | 0.0 | not run |
| `partialTransfer` | 0.1 | not run |
| `spectralDynamicAmount` | 0.8 | not run |
| `spectralResonanceAmount` | 1.0 | not run |
| `vibratoDepth` | 30.335 | not run |
| `vibratoProb` | 0.88 | not run |
| `vibratoRate` | 5.911 | not run |

## violin — agentd-t042-spectral-r2-isolated

Composite loss: `3.477058`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.0 | not run |
| `dynamicBlare` | 0.0 | not run |
| `excitationPosition` | 0.09 | not run |
| `partialMaterial` | 0.08 | not run |
| `partialTilt` | -0.38762905079032056 | not run |
| `partialTransfer` | 0.8196601125010515 | not run |
| `spectralDynamicAmount` | 0.8 | not run |
| `spectralResonanceAmount` | 1.0 | not run |
| `vibratoDepth` | 30.335 | not run |
| `vibratoProb` | 0.88 | not run |
| `vibratoRate` | 5.911 | not run |

## violin — agentd-t044-controls-r4-isolated

Composite loss: `3.448324`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.0 | not run |
| `dynamicBlare` | 0.0 | not run |
| `excitationPosition` | 0.09 | not run |
| `partialMaterial` | 0.08 | not run |
| `partialTilt` | -0.38762905079032056 | not run |
| `partialTransfer` | 0.8196601125010515 | not run |
| `spectralDynamicAmount` | 0.8 | not run |
| `spectralResonanceAmount` | 0.7788685649883007 | not run |
| `vibratoDepth` | 30.335 | not run |
| `vibratoProb` | 0.88 | not run |
| `vibratoRate` | 5.911 | not run |

## violin — agentd-t046-vibrato-rate-r3

Composite loss: `3.604090`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 1.0 | not run |
| `dynamicBlare` | 0.0 | not run |
| `excitationPosition` | 0.09 | not run |
| `partialMaterial` | 0.08 | not run |
| `partialTilt` | -0.38762905079032056 | not run |
| `partialTransfer` | 0.8196601125010515 | not run |
| `spectralDynamicAmount` | 0.8 | not run |
| `spectralResonanceAmount` | 0.7788685649883007 | not run |
| `vibratoDepth` | 30.335 | not run |
| `vibratoProb` | 0.88 | not run |
| `vibratoRate` | 5.431206365837876 | not run |
## guitar-nylon — iteration-stable-01

Composite loss: `9.205591`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `excitationPosition` | 0.13 | not run |
| `partialTilt` | 0.6677885819738671 | not run |
| `spectralResonanceAmount` | 1.0 | not run |
| `velocityHardnessCoupling` | 0.408288512677725 | not run |

## guitar-nylon — restored-iteration-02

Composite loss: `4.765464`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.0 | not run |
| `attackNoiseLevel` | 0.835135772995787 | not run |
| `attackNoiseVelocityExponent` | 1.0 | not run |
| `partialTransfer` | 0.3782651457196373 | not run |
| `spectralResonanceAmount` | 1.214176449778871 | not run |

## guitar-nylon — restored-iteration-04-profile-v2

Composite loss: `4.064514`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseLevel` | 0.835135772995787 | not run |
| `excitationPosition` | 0.20595744192774962 | not run |
| `partialMaterial` | 0.11769280432873208 | not run |
| `partialTilt` | 0.28887173476093186 | not run |
| `partialTransfer` | 0.3782651457196373 | not run |
| `spectralResonanceAmount` | 1.214176449778871 | not run |
| `velocityHardnessCoupling` | 0.22004370245514032 | not run |

## guitar-nylon — pass05-focused

Composite loss: `3.475820`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.0 | not run |
| `attackNoiseLevel` | 0.7061375269871879 | not run |
| `attackNoiseVelocityExponent` | 1.0 | not run |
| `excitationHardness` | 0.5763253001237215 | not run |
| `partialTransfer` | 0.06397533837347963 | not run |
| `spectralResonanceAmount` | 1.2718360893291012 | not run |
| `velocityHardnessCoupling` | 0.22004370245514032 | not run |

## guitar-nylon — pass06-focused

Composite loss: `4.060831`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.7061375269871879 | not run |
| `attackNoiseVelocityExponent` | 1.7989521929360355 | not run |
| `excitationHardness` | 0.6629495686284884 | not run |
| `partialTransfer` | 0.06397533837347963 | not run |
| `spectralResonanceAmount` | 1.2718360893291012 | not run |
| `velocityHardnessCoupling` | 0.3396880982871644 | not run |

## guitar-nylon — pass07-spectral

Composite loss: `3.725441`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.7061375269871879 | not run |
| `excitationPosition` | 0.11096717646718349 | not run |
| `partialMaterial` | 0.05250099611423774 | not run |
| `partialTilt` | 0.3456418637007195 | not run |
| `partialTransfer` | 0.06397533837347963 | not run |
| `spectralResonanceAmount` | 1.2718360893291012 | not run |

## guitar-nylon — pass09-corrected

Composite loss: `3.317939`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.31220299431803766 | not run |
| `excitationPosition` | 0.11096717646718349 | not run |
| `partialMaterial` | 0.05250099611423774 | not run |
| `partialTilt` | 0.3456418637007195 | not run |
| `partialTransfer` | 0.03444185374863304 | not run |
| `spectralResonanceAmount` | 1.4938622157744734 | not run |

## guitar-nylon — pass10-refine

Composite loss: `3.317250`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.3108349809789263 | not run |
| `excitationPosition` | 0.11096717646718349 | not run |
| `partialMaterial` | 0.05250099611423774 | not run |
| `partialTilt` | 0.3456418637007195 | not run |
| `partialTransfer` | 0.047962647141631135 | not run |
| `spectralResonanceAmount` | 1.492994890336873 | not run |

## guitar-nylon — pass11-decay-stable

Composite loss: `3.152017`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.3108349809789263 | not run |
| `excitationPosition` | 0.11096717646718349 | not run |
| `partialMaterial` | 0.05250099611423774 | not run |
| `partialTilt` | 0.3456418637007195 | not run |
| `partialTransfer` | 0.047962647141631135 | not run |
| `spectralResonanceAmount` | 1.2850530124660247 | not run |

## guitar-nylon — pass12-full-stable

Composite loss: `3.723190`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.15292252568423373 | not run |
| `attackNoiseLevel` | 0.4721359549995794 | not run |
| `excitationPosition` | 0.11096717646718349 | not run |
| `partialMaterial` | 0.05250099611423774 | not run |
| `partialTilt` | 0.3456418637007195 | not run |
| `partialTransfer` | 0.6180339887498948 | not run |
| `spectralResonanceAmount` | 0.6246117974981071 | not run |

## guitar-nylon — pass14-legacy-prior

Composite loss: `4.853343`

| Parameter | Fitted | ±10% sensitivity |
|---|---:|---:|
| `attackNoiseDirect` | 0.0 | 0.013667 |
| `attackNoiseLevel` | 0.40325224750231337 | 0.003383 |
| `attackNoiseVelocityExponent` | 1.0 | 0.012127 |
| `decaySecondRatio` | 1.0 | 0.006625 |
| `decaySecondStage` | 0.0 | 0.006777 |
| `excitationHardness` | 0.7668284148430117 | 0.012604 |
| `excitationPosition` | 0.2899482059642847 | 0.015769 |
| `partialTilt` | 0.2 | 0.012852 |
| `partialTransfer` | 0.3 | 0.012623 |
| `spectralResonanceAmount` | 1.0 | 0.015312 |
| `velocityHardnessCoupling` | 0.26585481862241056 | 0.012769 |

## grand piano ↔ upright piano — WP-9 morph evidence (upright pass 01)

The upright seed resolves from `piano-upright ← legacy piano craft; fitted
upright identity` at prior hash
`4a3ec5f017315885a35bbfa1602a69d7d1d6c74ede6bc9699c3666cd125c0684`.
It therefore retains the legacy piano strike/string mechanism while replacing
measured identity fields from the independent VSCO upright corpus.

| Differentiating axis | Grand | Upright | Grand → upright evidence |
|---|---:|---:|---|
| Bass B, median over comparable 55–132 Hz notes | 1.2916e−4 | 2.53555e−4 | **1.963×**, inside the annex C7 same-note upright ratios 1.91× and 2.81× |
| Lowest fitted B anchor | 1.4257e−4 @ 119.747 Hz | 2.7688e−4 @ 61.735 Hz | **1.942×**; anchors differ in centre, so the comparable-band statistic above is the morph gate |
| Aggregate B (diagnostic only) | 1.4817e−4 | 2.1006e−4 | 1.418×; whole-keyboard pooling is not the gate |
| B-table resolution | 3 legacy regions | **5 regions** | Upright now satisfies the research-annex minimum and exposes the measured V-shape: 2.7688e−4, 2.4911e−4, 2.435e−5, 0, 4.8543e−4 |
| Free-decay T60 proxy @ C4 | 16.2109 s | 13.6576 s | **0.8425×**, correct shorter-upright direction; medium-room tail remains a capture confound |
| Dominant fitted body band | 820.5 Hz / +1.1269 log2 gain | 393.3 Hz / +1.3449 log2 gain | Separately fitted bodies; upright split-half corr 0.955 and round-trip shape error 0.006 dB |
| Envelope attack | 21 ms | 16 ms | Corpus-owned onset difference, not a class-wide literature claim |
| Onset-noise centre / measured level ratio | 730 Hz / 1.703 | 389 Hz / 2.018 | Lower, relatively stronger upright onset measurement; retain as a fit axis |
| Mechanism firewall | strike + string | strike + string | **unchanged**, as required; ratio class, comb law, and impulsive gate do not morph |

The body and late-decay comparison is explicitly provisional because the
upright was captured in a UK medium room at player position. No same-note
repeat exists (`rr1` only), so this pair does not claim a measured
reference-variability floor or a frozen humanisation distribution.
