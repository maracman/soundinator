# Agent D pass 07 report

Date: 2026-07-18  
Exit state: `limiting-factor` — the cello source and bow-residual measurements
are now instrument-owned and synthetic-gated, but the source remains
uninstalled because the uncontaminated body transfer fails two forte cells and
one of twelve cello L14 string×dynamic pools fails cross-pitch commonality.  
Legacy prior: `cello ← legacy cello`, commit `e8d3ac1`, row hash
`a86e5a44b3b5b644`, resolved parameter hash
`9810c866572672ea27bc1fd36adb5777169e976dad1e2a526e4bb55400a833a9`.

## T-074 — five bowed Human consumers

Agent A's consumer commit is integrated. All five blocked adapters now have
isolated, hash-pinned consuming assertions: rate with positive depth held,
depth/body AM, onset delay, absolute scratch out of the zero prior, and the
attack ratio's single ×10 calibration. Human-0 PCM identity passes for both
violin and cello with the measured contract present versus removed.

The fresh six-cell cello aggregate audit is clean and repeat-stable at
`campaigns/cello/audit-agent-a-pass07-t074/controllability.json` (SHA-256
`66074715b58faf53d2fb73728201c7e5a4a44ac576e55a4bd4b2de28b0ec1a96`),
renderer `9b18b3bb7bfc75eb`, Human contract `701f65c47237a5ae`. Aggregate
vibrato response is 1.7799 and body-AM response is 2.1367 perceptual units.
This proves consumption; it does not repair identity. Both violin and cello
decomposition verdicts remain `INCONCLUSIVE-MASKED`, so no missing-Human-DOF
claim or width change is made.

## D-BOWED-SOURCE-02 — cello per-cell deconvolution

The rejected pass-06 full-chain correction is replaced by six lossless Iowa
source estimates. Each row divides measured reference harmonics by the exact
emitted cello body, including the low-register T-003 neighbour cap at the
measured 65.8 Hz boundary. The known-source/body synthetic round trip passes
at 0.0 dB maximum shape error against a 0.01 dB limit. No violin value enters
the calculation.

| Cell | String | Median difference from upstream source | Status |
|---|---|---:|---|
| low/pp | sulC | 3.980 dB | neutral |
| low/ff | sulC | 4.777 dB | neutral |
| mid/pp | sulD | 1.784 dB | neutral |
| mid/ff | sulD | 2.512 dB | neutral |
| high/pp | sulA | 2.028 dB | neutral |
| high/ff | sulA | 1.884 dB | neutral |

The evidence artifact is
`campaigns/cello/bowed-source-pass07-deconvolved.json`, SHA-256 contract
`a3f0ce70713943c155a58059445bbb96768e939ba88452b8960a04e41ebbd694`.
All cells are deliberately unconsumed. Source-table dynamic ownership is
currently table-wide, so a mixed accepted/neutral surface would suppress the
generic dynamic law for neutral cells. The candidate therefore contains only
a non-consuming evidence pointer; all six cells must pass before activation.

## Cello-owned L14 bow residual

The violin extractor transfers as a method only. Cello uses 206 lossless Iowa
notes, all four cello strings, cross-pitch pooling within each string and a
cell-owned pp/mf/ff ladder (66/67/73 notes). Philharmonia MP3 is explicitly
excluded. The cello-specific harmonic+known-noise synthetic round trip passes.

Eleven of twelve string×dynamic pools pass the 3 dB commonality bar.
`sulG/mf` fails at 3.607 dB median shape error with correlation 0.7763.
Consequently `iowa-profile.json` is `rejected-cross-pitch-commonality`,
`profilePinned=false`, `activationEligible=false`, and the checked-in cello
profile is untouched. The measured ladder remains diagnostic: pp/mf/ff noise
power is -57.267/-52.278/-40.989 dB and the fitted amplitude exponent is
1.0685, but none of those cello values reaches the engine while the pool gate
fails.

## T-058 adapted uncontaminated cello body audit

The six source cells were rendered as body-on/body-bypass pairs with the exact
source fixed and `partialTransfer`, attack noise, bow noise, scratch, vibrato,
Human and reverb neutral in both arms. Four cells pass the 1 dB / 0.9
correlation emitted-body bar: all three pp cells plus low/ff. Mid/ff fails at
2.480 dB and 0.445 correlation; high/ff has 0.693 dB median error but fails
correlation at 0.760. The audit is therefore FAIL, SHA-256
`be533e4a49f27433661f7b47fd14b7e9b858572cce270ad71c705fdfd0d3b688`.

This is the construction hierarchy blocker. The forte discrepancy cannot be
filed into source partials until the paired body seam is understood.

## T-067 room-residual assessment

The pitch-synchronous breath observable now fits a non-negative residual-power
floor plus exponential decay and reports the fitted component separately. A
known dry-floor plus decaying-room synthetic fixture recovers the injected
share within the 0.20 absolute tolerance. Per-row room-suspected components
are never included in breath weight.

| Voice | Retained | Excluded | Room-suspected | Mean suspected share | Activation |
|---|---:|---:|---:|---:|---|
| bass | 45 | 0 | 2 | 59.91% | blocked |
| mezzo | 45 | 0 | 3 | 61.28% | blocked |
| soprano | 45 | 5 | 1 | 64.10% | blocked |
| tenor | 44 | 1 | 8 | 49.92% | blocked |

All four durable `pitch-sync-breath-pass07-room-assessed.json` artifacts have
`activationEligible=false`. `pitch_sync_breath_db` remains zero-weight and
every adult `voiceBreathSync` remains zero.

## Pass-end gates and state

The fresh current-renderer controllability audit is CLEAN/STABLE at objective
`3e46b2808545db9e`, manifest `a579e74e30d52b3b`, renderer
`9b18b3bb7bfc75eb`, with no uncontrolled weighted feature.

| Preset/row | Construction | Strict §3 | Distribution | Leaderboard |
|---|---|---|---|---|
| persisted legacy cello | FAIL (2 construction failures) | FAIL (20 measured failures + 4 required cells without evidence) | insufficient evidence | unchanged; loss 2.680191 |
| D-BOWED-SOURCE-02 | blocked by body audit 4/6 | not eligible | not eligible | not promoted |
| cello L14 profile | commonality 11/12 | not eligible | not eligible | not promoted |

The fresh zero-budget seal is
`runs/cello/agentd-pass07-gates/summary.json`. Baseline and best loss are both
2.6801910903604, so improvement is zero. The strict gate records 0 pass, 20
fail and 106 not-applicable observations; high/pp, high/ff, mid/pp and mid/ff
band-balance cells additionally have no evidence. The five-seed ship pass
cannot form a measured same-pitch/same-dynamic take-pair group, so its
two-sided variation verdict is `insufficient-evidence`. The resource gate also
fails: 38 oscillators and 532 automation events per note exceed the 1.25×
factory-median limits, although model math remains below its limit. The
leaderboard entry and `state/cello/leaderboard.json` backstop were refreshed,
but this non-leading row is not promoted.

Live exchange state is generated at
`state/agent-d-pass07-exchange-statuses.json` (78 entries, source SHA-256
`b977573a61b4b567a9e45182625030348618545167b8fed5eed19fd836402a7b`). Relevant rows are
T-067 `analysis=room-decay-quantified-values-still-neutral`, T-074
`engine=incorporated-five-isolated-adapters+human0-pcm-identity`, and T-075
`analysis=incorporated-rejected-artifacts`.

The pass-end regression suite is green: all 11 JavaScript migration tests,
the full Python suite, all tone-model assertions, and render-note verification
pass. Render-note verification reports contract hash
`e46795003922400cdae2775621ac4ae77d22e028c6c23b44df8525040e7f4ea2`.

Pending mandates:

1. Agent D: isolate the mid/ff and high/ff paired body-transfer failure before
   activating any cello source row.
2. Agent D: split or robustly refit `sulG/mf` cello bow residual without
   relaxing the 3 dB cross-pitch bar; rerun all twelve pools.
3. Bowed identity: keep both Human decompositions masked until the ordinary
   identity bars pass, despite T-074 consumer completion.
4. Sung: keep T-067 weight and adult sync values at zero while any selected
   room-suspected component remains.

OWNER DECISION NEEDED: none.
