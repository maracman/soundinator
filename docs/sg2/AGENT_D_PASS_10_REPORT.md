# Agent D pass 10 report

Date: 2026-07-18
Exit state: `limiting-factor` — bounded full-rank source refinement and the
T-078 stable post-source/post-bow octave method were applied to violin and
cello. Violin retains its three score-applicable partial-table PASS cells and
improves selected mel/band residuals, but every scored spectral cell still
fails mel and band balance. Cello retains only low/ff partial PASS and the
candidate trails the pass-09 incumbent. Current-renderer matched-take identity
audits remain 0/14 violin and 0/15 cello, so neither §2.5c.2 masking condition
cleared and neither locked decomposition was rerun.

Legacy priors: `violin ← legacy violin`, row hash
`334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`,
resolved candidate hash
`d89c9df1f42aa409e5276d0224d518dd13ed2768dea9a24937a54109ce5f0327`;
`cello ← legacy cello`, row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`,
resolved candidate hash
`11b722b48306ded12f16fabaf5e067d9517ea59c4c4e379a5c7f064d725a7337`.
Both resolve from `sg2-legacy` commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d` with SHIP Human 0.4.

## Source refinement and T-078

`bowed_source_refine` started from the selected pass-09 cumulative 64-rank
surface, moved only present harmonics in each declared lossless cell, and kept
body, independent bow component, and Human controls fixed. Evidence hashes:

- violin report SHA-256
  `55458584fcc82957132a0d3a71fb168816fbd40a1de1017bd0f172151018f465`,
  surface evidence
  `3e7fd7b253de16c95affe4711e1caaa49e06d55f7210cf8b1141f31f00330f28`;
- cello report SHA-256
  `a24e49b52f691e1190bbb9b45863f2cf317747a914f32f542777b05afdb13552`,
  surface evidence
  `cb3b12ba0a8a7c2bbeb7944dbd34301a96cb34b0588da863d5effd94aaedad8a`.

The shared T-078 extractor was adapted to label an independent bow component
and to preserve bowed rows' native peak normalisation. The synthetic
harmonic-plus-independent-bow round trip passes at 0.242 dB mean and 0.460 dB
maximum remaining residual; artifact SHA-256 is
`afd8232ffb630a4eea4e374077625474d2769b7678cd619009260a94c4799879`.
All five violin cells pass the three-block temporal MAD/sign gate. Cello
low/pp and low/ff pass; cello mid/high are correctly not applicable because
their active sustains cannot supply three post-onset/pre-release 250 ms
blocks. Each accepted application changed exactly one existing source cell,
used gain 1 with a 3 dB octave cap, preserved absent harmonics, and left body,
bow component and Human controls unchanged.

The first attempted bowed application exposed an inadmissible normalisation
assumption: the blown surface is fundamental-normalised, while bowed rows are
peak-normalised and may have an inaudible fundamental. The unadapted law would
have turned a nominal 3 dB cap into 7–24 dB effective shifts. No such candidate
was audited. Commit `dc40a78` preserves the native anchor and adds consuming
tests, recorded as exchange T-080; shared merge `eb3af48` lands it.

## Core identity hierarchy

| Instrument/cell | Pass 09 partial / mel / band | Source-refine | T-078 | Verdict |
|---|---|---|---|---|
| violin low/ff | 0.89 / 5.72 / 4.62, 9.04 | 0.48 / 5.05 / 4.38, 7.54 | 2.41 / 4.77 / 4.58, 7.91 | partial PASS; mel/band FAIL |
| violin mid/pp | 1.02 / 13.78 / 22.79, 57.53 | 0.55 / 13.84 / 22.80, 56.69 | 1.03 / 13.63 / 22.43, 56.73 | partial PASS; mel/band FAIL |
| violin mid/ff | 1.30 / 11.16 / 14.08, 52.11 | 0.87 / 11.19 / 14.05, 52.48 | 1.27 / 11.50 / 14.49, 53.67 | partial PASS; downstream regression, not promoted |
| cello low/pp | 17.55 / 9.80 / 3.36, 9.33 | 18.19 / 10.25 / 3.76, 9.57 | 20.26 / 10.18 / 3.59, 9.49 | core FAIL |
| cello low/ff | 0.87 / 25.29 / 2.52, 6.97 | 0.32 / 25.35 / 2.44, 6.96 | 0.52 / 25.47 / 2.39, 6.74 | partial PASS; mel/max-octave FAIL |
| cello mid/high | pass-09 core set open | partials improve in four cells | T-078 unavailable: sustains too short | core FAIL |

Values are dB; band values are mean, maximum octave. Violin T-078 composite
is 32.755939 versus pass 09's 32.756853, but the gain is below a promotion
claim and one scored cell regresses downstream. Cello T-078 composite is
2.769751 versus pass 09's 2.737658 and is rejected. Best-so-far presets and
factory rows are unchanged.

## §2.5c.2 masking trigger

| Instrument | Ordinary matched takes | Good takes | Functional path | Mask cleared | Action |
|---|---:|---:|---:|---:|---|
| violin | 14 | 0 | yes, renderer `de30a803305d06c4` | no | retain `INCONCLUSIVE-MASKED`; no decomposition rerun |
| cello | 15 | 0 | yes, renderer `de30a803305d06c4` | no | retain `INCONCLUSIVE-MASKED`; no decomposition rerun |

Violin audit SHA-256 is
`ccc530b2415ee3fa43e4479db0e9cb4ee371262f5fc19561cb2a7f742522449b`;
cello is
`434e31771d8f84776b06a15edad33ef1bd4f564043122da99aba545aeb550f09`.
The immediate decomposition trigger is false for both. Human ranges remain
unchanged and no missing-DoF claim is made.

## Pass-end gates and controllability

| Preset/row | Construction | Strict §3 | Distribution | Leaderboard |
|---|---|---|---|---|
| violin legacy-prior + T-078 diagnostic candidate | FAIL: 13 pass, 3 fail | FAIL: 7 pass, 9 fail, 38 N/A | insufficient qualified spread evidence | not promoted; loss 32.755939 |
| cello legacy-prior + T-078 diagnostic candidate | FAIL: 16 pass, 2 fail | FAIL: 7 pass, 19 fail, 100 N/A | insufficient same-pitch pair evidence in run objective | not promoted; loss 2.769751 |
| violin persisted legacy/leaderboard row | unchanged | current diagnostic gate above still open | unchanged | retained backstop best |
| cello persisted legacy/leaderboard row | unchanged | current diagnostic gate above still open | unchanged | retained backstop best |

Both exact T-078 controllability audits are CLEAN/STABLE with no uncontrolled
weighted feature. Violin objective is `c792c044d4efda59`; audit SHA-256 is
`ed50afb73e2667787954356b2778f27b7c6553f861b33bc6da6bdba064bde5f0`.
Cello objective is `e5a56c534363c4fc`; audit SHA-256 is
`bade8dcedde3711e337931d870673da8316b5a559e04563deaa965eb4fe09ff6`.
The common manifest hash is `a579e74e30d52b3b`.

Run summary SHA-256 values are violin
`97a6c989138a83b1a9c779e2c5c9ba9781f898bd94ac12afea6b8a1c5c10e7ad`
and cello
`1e82dcb7f85e7a7c2482b281256d98b9e26966ad6df60d3c5403bdaa17ae6ca1`.
Run-local SHIP auditions use fresh seeds 880478984 and 361945865. The
leaderboard and `state/{violin,cello}/leaderboard.json` backstops agree;
SHA-256 values are
`ad1b3bdb2a91c299d1677f0bb0159f60511e782c0abb20c54e14e60758212353`
and `31c4d1da7b3a3b8436e601ff664a911ce6433af25108853f80c6ec326a55bae2`.
A synthetic test-row overwrite detected during pass-end QA was repaired from
the valid run leaderboard before these hashes were frozen.

Live exchange snapshot: 83 entries, source SHA-256
`15b784cb061112f0c7ba78f9cba0bda9fb8c0ab076afe526befc40c096012041`,
artifact SHA-256
`5e6ae6aa2e55e6df2214321dc07ccd2f80a3f75016d41ab528cc245bc30fb944`.
The canonical `sg2-data/listen.html` was rebuilt from combined head
`eb3af48` with fresh build seed 1784328594; SHA-256 is
`302e56d9771ccd9653589a4025ef16800662dfe6552816caa6098cfcf971af91`.
It retains verified leaderboard/pinned-component SHIP rows and excludes the
unpromoted pass-10 bowed diagnostics.

Final verification is green: `npm test` 11/11 PASS;
`node scripts/verify_tone_model.mjs` all assertions PASS;
`PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` full suite PASS;
and `PYTHON=../../../.venv/bin/python node scripts/render_note.mjs --verify`
PASS at PCM hash
`9ca80ec2c4c591a24ea3e48bc33c153090b9def2586dfe59531efd8481deb5da`.

## Pending mandates / next pass

1. Retain violin low/ff and mid/pp T-078 evidence as cell-local diagnostics;
   do not promote the cumulative candidate while mid/ff regresses and all
   mel/band cells fail.
2. Retain pass-09 cello as best-so-far. Acquire or derive admissible longer
   lossless sustains before T-078 can address cello mid/high; do not shorten
   the three-block stability bar.
3. The remaining dominant spectral residual is not permission for a body
   refit: body, independent bow component and Human controls stay fixed while
   source-cell/mel causes are isolated.
4. After the spectral tier stabilises, fit/activate cello's missing
   register×dynamic attack surface and re-audit violin attack.
5. Rerun each locked decomposition immediately when its ordinary identity
   audit reports every matched take near the core bars.

OWNER DECISION NEEDED: none.
