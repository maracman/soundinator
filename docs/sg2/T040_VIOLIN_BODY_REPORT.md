# T-040 violin low-mode body report

Date: 2026-07-16  
Corpus: University of Iowa MIS violin arco runs already held under
`/private/tmp/sg2/samples/violin/`

## Result

T-040 is resolved without owner escalation. A dedicated, pitch-anchored body
reference set now separates fixed-Hz body evidence from scoring/floor roles
and from the broader excitation corpus.

| Metric | Before | Densified body fit |
|---|---:|---:|
| Body evidence notes | 117 mixed-role notes | 48 Iowa body-role notes |
| Split-half correlation | 0.451 | **0.894** |
| A0 evidence, 250–310 Hz | none | **301.1 Hz, +0.3137 log2** |
| Diagnostic A0 centre | outside/pruned | **280.0 Hz, +0.1590 log2** |
| B1 evidence, 420–600 Hz | 579.5 Hz, −0.4012 log2 | **473.6 Hz, +0.4261 log2** |
| Diagnostic B1 centre | absent | **500.0 Hz, +0.2463 log2** |
| Unstable bands pruned | 6 | **0** |
| Round-trip shape maximum | 0.002 dB | **0.004 dB** |

Both split halves retain the same bridge-hill maximum at 2345.4 Hz. The
positive A0/B1 gains are fitted from the corpus; no resonance gain is
hand-injected.

## Corpus densification

`scripts/tone_match/strings_prep.py` now emits
`body-references.json` plus external WAV artifacts for three dynamics over:

- sul G: MIDI 55–59;
- sul D: MIDI 62–69;
- sul A: MIDI 72–74.

Those fundamentals and low harmonics provide 54 observations inside the
250–600 Hz target. The internal spacing is at most 26.3 Hz; including the
250 Hz lower boundary, the largest uncovered interval is 41.7 Hz.

The fitter consumes this manifest only for the fixed-Hz body solve. The
original 117 accepted spectral notes still own the partial, register,
performance, attack, material, and humanisation tables. This avoids using
duplicated low notes to bias the excitation model.

## Emission and quarantine decision

The densified profile is emitted, not quarantined:

- split-half correlation exceeds the 0.80 production threshold;
- positive corpus-supported bands exist in both required mode regions;
- the body round-trip remains within tolerance;
- Agent A's measured-body consumer already applies
  `reconstructionAmount: 1` and `lowestF0Hz`.

Profile generation now raises a named fixed-body coverage error if violin
A0, B1, or split-half stability is missing. Therefore a future sparse run
cannot silently replace this profile. Owner escalation was not filed because
the densified corpus supports both modes.

## Iteration-loop rebaseline

The prior best parameters were re-rendered on the unchanged 20-reference
objective using the regenerated unity-body seed and a fresh clean
controllability audit.

| Gate accounting | Before T-040 | After T-040 |
|---|---:|---:|
| Construction failures | 4 | **2** |
| §3 measured-cell failures | 35 | 35 |
| Strict evidence holes | 7 | 7 |
| Total gate failures | 46 | **44** |

`violin.measured-body` and `violin.body-peak-cluster` now pass. The remaining
construction failures are the already-filed bow-noise and vibrato-body-AM
engine gaps. The new run is
`/private/tmp/sg2/violin/agentd-t040-densified-body-baseline-r2`; it becomes
the leaderboard best because hard-gate count improved, although its raw
composite loss is 4.345179 versus 4.278410 for the stale 0.35-body baseline.
Five of six variability-floor groups remain above floor.
