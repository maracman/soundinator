# T-055 violin §2.5c differential-fit report

Status: differential fit executed; `humanRanges` emitted; decomposition test
**FAIL** (named limiting factor, not widened into identity).

## Evidence basis

The fit uses the 14 eligible prepared floor takes in six true
same-note, same-dynamic, same-articulation groups: the curated C#4
non-vibrato duplicate plus five Philharmonia catalogue groups at G3, C5 and
E6. All paths resolve under durable `SG2_DATA/campaigns/violin/references/`.
The 12 Iowa same-string chromatic runs remain the secondary
register-trend-removed adjacent-semitone proxy; they do not override the true
duplicate calibration.

Each take is reduced with identity frozen to physical Human observables:
bow-position comb fraction, vibrato rate/depth/trajectory when detected,
sustain and onset noise level, onset-noise centroid, noise lead, onset wander
and settle. Pairwise p90 spreads include:

| Human dimension | Measured p90 take-pair spread |
|---|---:|
| Bow position | 0.144 string-length fraction |
| Sustained residual level | 5.171 dB |
| Onset residual level | 14.619 dB |
| Onset residual centroid | 0.793 octave |
| Noise lead | 94.041 ms |
| Onset wander | 150.477 cents |
| Onset settle | 151.098 ms |

The large onset tails are real catalogue-take evidence, but are not a claim
that every note should draw the p90 extreme. The emitted contract stores the
centre, 5–95% interval, median/p90 pair spread and independent-draw half
range so the engine can implement an episodic distribution rather than a
wide Gaussian.

## Decomposition verdict

**FAIL: 10/10 matched pairs retain identity-domain residual above the hard
test after allowing Human comb position plus broadband level/tilt.** The test
requires residual partial and fixed-body shape <=3 dB, near-zero string
stretch within 3 cents (otherwise B within 1.5x), and T60 within 1.5x.
Observed median partial residuals span 3.58–10.75 dB; several short lossy
catalogue takes also produce unstable B estimates. Per §2.5c.2, the fit does
not widen body bands, B, material or base partial tables to hide this.

Limiting factor: the Human set still lacks consuming controls for the
remaining pressure/body-AM take variation (T-029) and structured bow-position
draws. Re-run this decomposition after those consumers land; retain B as a
watch metric for short catalogue takes whose stretch estimate is unstable.

## Profile and consumer contract

The full fit and per-pair evidence live at
`SG2_DATA/campaigns/violin/humanisation-fit.json`. The fitted contract is in
`web/static/measured_profiles.json` under `violin.humanRanges`; the generated
JS preserves the engine-facing ranges, evidence and decomposition verdict.
No audio is committed.

## Cello proxy basis

Until cello's own differential run is commissioned, its fallback proxy is
the §2.5c.4 method already inventoried in `take-pairs.json`: same-string,
same-dynamic adjacent semitones from an Iowa chromatic run, with the register
trend removed before taking deltas. The four vib/non-vib pairs are useful for
vibrato bounds but are not pure duplicate takes. Downloaded catalogue
same-note groups should be preferred wherever their source identity,
articulation and trimmed duration match; proxy-derived ranges must remain
labelled weaker evidence.
