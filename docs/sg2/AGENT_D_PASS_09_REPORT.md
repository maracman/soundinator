# Agent D pass 09 report

Date: 2026-07-18  
Exit state: `limiting-factor` — lossless source/body separation now gives
violin a partial-table PASS in every score-applicable spectral cell and gives
cello a low/ff partial PASS. Full-rank source evidence also improves selected
mel and band-balance cells. Ordinary per-take identity is still 0/14 violin
and 0/15 cello, so neither §2.5c.2 mask cleared and neither locked
decomposition was rerun.  
Legacy priors: `violin ← legacy violin`, row hash
`334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`,
resolved hash
`5d00c6780007e42e8b70b79c44dd18cf5ca6cd99734c16668bfb7b55b076303e`;
`cello ← legacy cello`, row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`,
resolved hash
`0f6ad9814bf418c963b85257947a1ddfcf974f85de5b873d7a153c0c318e6461`.
Both resolve from `sg2-legacy` commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d` with SHIP Human 0.4.

## Identity hierarchy result

The pass followed pitch/membership → source partials → mel/band balance →
attack. Body bands, L14 bow components, onset components, modulation, noise,
and measured Human episode consumers stayed active; Human widths were not
widened.

The direct source emitter now divides each lossless reference's harmonic
shape by the exact emitted fixed-Hz body, analyses all 64 renderer ranks, and
requires every corpus-declared spectral cell rather than a fabricated six-cell
rectangle. Cello supplies all six register×dynamic cells. Violin supplies five
cells; low/pp is absent evidence and remains governed only by the declared
measured-hull clamp.

| Instrument/cell | Partial (≤3 dB) | Mel (≤4 dB) | Band mean/max (≤3/6 dB) | Attack | Verdict |
|---|---:|---:|---:|---:|---|
| violin low/ff | **0.89 PASS** | 5.72 FAIL | 4.62/9.04 FAIL | 146.5 ms FAIL | source PASS; downstream open |
| violin mid/pp | **1.02 PASS** | 13.78 FAIL | 22.79/57.53 FAIL | 67.4 ms FAIL | source PASS; downstream open |
| violin mid/ff | **1.30 PASS** | 11.16 FAIL | 14.08/52.11 FAIL | 91.7 ms FAIL | source PASS; downstream open |
| violin high/pp, high/ff | N/A at strict scorer | N/A | N/A | N/A | measured rows retained; not called PASS |
| cello low/pp | 17.55 FAIL | 9.80 FAIL | 3.36/9.33 FAIL | 101.0 ms FAIL | open |
| cello low/ff | **0.87 PASS** | 25.29 FAIL | 2.52/6.97 FAIL | 57.3 ms FAIL | source PASS; max octave open |
| cello mid/pp | 11.93 FAIL | 6.25 FAIL | N/A | 206.8 ms FAIL | open |
| cello mid/ff | 6.40 FAIL | 11.54 FAIL | N/A | 159.9 ms FAIL | open |
| cello high/pp | 8.27 FAIL | 7.86 FAIL | N/A | 191.4 ms FAIL | open |
| cello high/ff | 3.97 FAIL | 9.64 FAIL | N/A | 152.0 ms FAIL | open |

Violin's 32→64-rank change improves low/ff mel 7.42→5.72 dB and band mean
5.77→4.62 dB without losing its partial PASS. Cello low/ff band mean improves
4.00→2.52 dB, though the maximum octave remains 6.97 dB. The candidate source
evidence hashes are
`cd1320287c29a8ee1d6f591fb5a3019a7655a1b74cd7244b8f3816e6de2fbfb9`
for violin and
`e639c1afa58d3e50dc4757c8e8e4ca0e55127125dfe864d4cac4f39f3e070e9a`
for cello.

### Escalation and drift guidance

The cello ladder ran a clean direct six-cell surface, a bounded same-cell
render-residual correction, pooled-tilt probes, and a wider bounded correction.
The smaller correction improved five partial cells, including low/ff
0.81→0.30 dB. `partialTilt=-0.2` damaged low/pp and mid/pp; `+0.2` helped
low/pp but damaged low/ff and mid/ff. The 12 dB correction reached low/ff
0.01 dB and high/ff 2.94 dB but sharply regressed low/pp and mid/pp and made
pitch-derived inharmonicity non-applicable. It is rejected. No pooled source
control or wider correction is promoted.

This is independent evidence for a cell-local source edge and against a
global tilt. It does not create a causal criteria-drift edge: the bounded
steps are a separate intervention lineage and the rejected wide step loses an
earlier pitch criterion. T-071 therefore leaves the live matrix unchanged.
The next order remains cell-local spectral identity, then mel/band residuals,
then attack; modulation, noise and Human remain frozen downstream.

## §2.5c.2 masking and decomposition

| Instrument | Ordinary matched takes | Good takes | Functional consumers | Mask cleared | Decomposition action |
|---|---:|---:|---:|---:|---|
| violin | 14 | 0 | 7/7 | no | retain `INCONCLUSIVE-MASKED`; no rerun |
| cello | 15 | 0 | 9/9 | no | retain `INCONCLUSIVE-MASKED`; no rerun |

Every ordinary take still fails partial, log-mel and attack. Five takes per
instrument also fail inharmonicity. There are no analysis failures and the
render paths are functional. The violin audit contract is
`c413f0203f48126bc72656c74d1cc9c04b3b6cd67647cf1eaeddcf6f8f959f39`;
the cello contract is
`426655285d04a8f19f55b27d86ca8e744d39655be031258628a369597f1ea6b3`.
Because `allMatchedTakesNearBars=false` for both, the immediate decomposition
trigger is false. A `FAIL-MISSING-DOF` claim or wider Human range would violate
the three-valued rule.

## Pass-end gates, controllability and state

| Preset/row | Pinned stack | Construction/strict §3 | Distribution | Leaderboard |
|---|---|---|---|---|
| violin legacy prior + 64-rank source candidate | all bowed components active | FAIL: 7 pass, 9 fail, 38 N/A | insufficient evidence | not promoted; loss 32.756853 |
| cello legacy prior + 64-rank source candidate | all bowed components active | FAIL: 7 pass, 19 fail, 100 N/A | insufficient evidence | not promoted; loss 2.737658 |
| `factory-sub-cello-natural` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| `factory-sub-cello-moss` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| `factory-sub-cello-grit` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| `factory-sub-low-lantern` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| `factory-patch-deep-walker` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| `factory-patch-blue-lantern` | PASS, unchanged pass-08 exhaustive assertion | profile/body/component construction PASS; identity not independently scored | factory preset | not a fit row |
| violin and cello persisted legacy rows | PASS for installed components | strict candidate gates above remain open | unchanged | retained backstop rows |

Both exact candidate controllability audits are CLEAN/STABLE with no
uncontrolled weighted feature. Violin objective is `c792c044d4efda59` and
audit file SHA-256 is
`e592b4558a977d23623811103c20be73a5d4d1eb3225d92125704c8be6977044`.
Cello objective is `e5a56c534363c4fc` and audit file SHA-256 is
`fe60549022c3ae7c2335484b113d22e3cda8919c4207915a7954a81bab0182f5`.
Run summary SHA-256 values are
`aa777f43d2733e078a2186aca0ee165d59b5622684b0845659f8996357ac8299`
and `23485d97346e60f633825a6db55b90a455e1ab20f4a8c97f77b5ca455b7426b4`.
The leaderboard and `state/{violin,cello}/leaderboard.json` backstops were
refreshed; neither candidate is promoted.

Live exchange snapshot: 81 entries, source SHA-256
`3eebbdf9e66f03aeecc9d8021c40899dcdca7747087ee0562751bda53c9b15f3`,
artifact SHA-256
`90c98e4c62370e31a46b2a39bfaa850b1dc1472349ea612a7fbaf7d19a3c1d79`.  
Fresh owner listening page rebuilt at engine `1f24b79` with build seed
`1784315585`; `sg2-data/listen.html` SHA-256 is
`f53a9cf3d075577fc2ad9093789882badaa7b57d81e522a5a7dec887e0057621`.
The unpromoted 64-rank experimental auditions remain separately available in
the pass-09 run directories; the global page correctly retains verified
leaderboard/pinned-component SHIP rows.  
Final verification is green: `npm test` 11/11 PASS;
`node scripts/verify_tone_model.mjs` all assertions PASS;
`PYTHONPATH=src:. .venv/bin/python -m pytest -q` full suite PASS; and
`PYTHON=.venv/bin/python node scripts/render_note.mjs --verify` PASS at
renderer hash
`22622734125e89718d57499ba1399fcaac4cac8eff3a821e37a2b51236768a73`.  
Shared merge: PENDING.

## Pending mandates

1. Extract a stable post-source octave/mel residual per violin cell, especially
   mid/pp and mid/ff, before considering a body refit or changing bow-noise
   levels.
2. Continue cello per-cell source calibration inside the 6 dB accepted bound;
   do not reuse the rejected 12 dB surface or pooled tilt.
3. Fit/activate cello's missing register×dynamic attack surface and re-audit
   violin attack only after the remaining spectral tier is stable.
4. Rerun each locked decomposition immediately when its ordinary per-take
   identity audit reports every matched take near the core bars.
5. Keep both verdicts `INCONCLUSIVE-MASKED`; do not widen Human or file a
   missing-DoF specification before that trigger.

OWNER DECISION NEEDED: none.
