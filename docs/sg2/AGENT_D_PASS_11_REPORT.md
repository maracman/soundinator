# Agent D pass 11 report

Date: 2026-07-18  
Exit state: `limiting-factor` — F13 goal-level analysis shows that cello's
mid/high T-078 blocker was primarily the fixed-window method, not an
inadequate corpus and not blanket physical instability. The pitch-aware method
admits all four cells, but the resulting bounded corrections do not clear the
identity hierarchy. Violin retains three partial-table PASS cells while every
scored mel/band cell fails. No candidate is promoted and both locked Human
decompositions remain correctly masked.

Legacy priors: `violin ← legacy violin`, row hash
`334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`,
resolved candidate hash
`d89c9df1f42aa409e5276d0224d518dd13ed2768dea9a24937a54109ce5f0327`;
`cello ← legacy cello`, row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`,
resolved candidate hash
`37d79e71cf546a782519a88a56939ebc4e6a91812d9860c7ea4903e45d1a2a28`.
Both resolve from `sg2-legacy` commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d` with SHIP Human 0.4.

## F13 cello diagnosis: corpus, method, or physical

The T-078 goal is to establish a temporally repeatable broad-octave residual
from three independent post-onset/pre-release observations. A fixed 250 ms
block is a means, not the goal. At pass 10 it required at least 1.10 seconds
of active audio after the fixed 250 ms onset and 100 ms release exclusions and
refused the four cello mid/high cells before calculating a stability metric.

| Cell | Shorter ref/render block | Fundamental cycles in shorter block | Stable source-addressable bands | F13 verdict |
|---|---:|---:|---:|---|
| cello mid/pp | 252 / 242 ms | 48.1 | 6 | full-strength stability evidence; method-limited before |
| cello mid/ff | 241 / 316 ms | 45.3 | 5 | full-strength with one band-local unstable residual |
| cello high/pp | 165 / 151 ms | 98.7 | 5 | full-strength; short wall time is not short cycle evidence |
| cello high/ff | 144 / 137 ms | 88.8 | 4 | full-strength for four bands; high-band drift remains physical/local |

Classification:

1. **Corpus/take length: not the primary blocker.** The existing lossless
   Iowa takes provide 45–99 cycles per shorter block, enough evidence for a
   broad-octave statistic. Acquisition remains appropriate only if the new
   cycle-aware minimum fails.
2. **Method/window: primary blocker.** The canonical minimum is now
   `max(80 ms, min(250 ms, 16/f0))`, while retaining three disjoint blocks,
   the 250/100 ms onset/release exclusions, MAD <= 2 dB and sign agreement
   >= 2/3.
3. **Physical instability: band-local, not blanket.** All four cells have
   4–6 stable bands. Cello high/ff's maximum reference-profile MAD is
   2.565 dB and the highest residual MAD is 2.045 dB; unsupported bands remain
   exact zero anchors and are not forced into the source.

T-083 records the reusable method. The v2 synthetic artifact SHA-256 is
`245afdc3ee68105d96006e19cdfbdfb6c22ef9e9cd316e6cdd2a711e6b20d0a2`.
It retains the long-take recovery at 0.242/0.460 dB mean/max and adds a
780 ms, 660 Hz branch at 0.399/0.865 dB under declared 0.45/1.0 dB bars.
Cell evidence SHA-256 values are mid/pp
`60e707c2d038afa0db42cae41a375fbc69e1b99121176375d946c92076afdb3a`,
mid/ff `431f85a7ea3693d7fb9b1aa435f538308db7bbe12eea6412caacc35e234f9e3e`,
high/pp `5ac644ffb355e29fefcf3517c2daa9fbd1fdc43c319f27221f15d76eb75f2ca3`
and high/ff
`90daff417ff0be76c413b3223e2c47b57bd4b2e92b3b5a7cae83e21de911fd97`.

## Cumulative identity hierarchy

Every accepted application changed exactly one existing source cell, used
gain 1 with a 3 dB octave cap, preserved absent ranks and peak normalisation,
and left body, independent bow component and Human controls unchanged.

The all-six cello diagnostic improves the pass-10 diagnostic composite from
2.769751 to 2.762122 on the final shared renderer, but it is rejected:

- mid/pp mel improves 6.47→6.29 dB while partial identity regresses
  9.34→14.13 dB;
- mid/ff partial/mel improve 6.10→5.98 and 11.40→11.37 dB, but attack
  regresses 147.4→159.9 ms;
- high/pp improves partial/mel/attack 6.35→6.16 dB, 7.84→7.78 dB and
  193.5→191.0 ms;
- high/ff attack improves 152.0→151.6 ms while partial identity regresses
  3.36→3.46 dB.

The selective cello candidate retaining only mid/ff and high/pp scores
2.827482 and is also rejected. The pass-09 incumbent remains the cello
best-so-far backstop.

For violin, a cumulative candidate excluding the known-regressing mid/ff cell
scores 32.894638 and is rejected. The pass-10 all-cell diagnostic is retained
only as evidence: low/ff, mid/pp and mid/ff still pass partial identity at
2.41, 1.03 and 1.27 dB, while their mel values are 4.77, 13.63 and 11.50 dB
and their band mean/max values are 4.58/7.91, 22.45/56.82 and 14.49/53.67
dB. No violin T-078 surface is promoted.

The final shared-head violin controllability audit conservatively zero-weights
`inharmonicity_log_ratio` after repeat renders crossed its stability threshold.
Its objective is therefore `231e64a1e47b874e`, not directly comparable with
pass 10's objective; the three partial-table verdicts above remain unchanged.

## §2.5c.2 immediate trigger

| Instrument | Ordinary matched takes | Good takes | Renderer | Trigger | Action |
|---|---:|---:|---|:---:|---|
| violin | 14 | 0 | `21e9ce780a8ee56a` | false | retain `INCONCLUSIVE-MASKED`; no decomposition rerun |
| cello | 15 | 0 | `21e9ce780a8ee56a` | false | retain `INCONCLUSIVE-MASKED`; no decomposition rerun |

Violin identity audit SHA-256 is
`c1367034420de977d2586e4d54d19079c6bcc404d289d8aeb769b4c03b1489e1`;
cello is
`9b42ed0c7fc3e6a1ac8bfb36a86f0165250f6f24901fa28a00205dbea3f0be1d`.
The trigger was evaluated immediately after the shared-head identity audits.
Because it remained false, rerunning either locked decomposition would have
violated the masking contract. Human ranges and verdicts remain unchanged.

## Pass-end gates and controllability

| Preset/row | Construction | Strict §3 | Distribution | Resource | Leaderboard |
|---|---|---|---|---|---|
| violin cumulative T-078 diagnostic | FAIL: 13 pass, 3 fail | FAIL: 4 pass, 9 fail, 41 N/A | insufficient qualified Human spread | FAIL: 53 oscillators, 742 events | not promoted; loss 32.894687 under new objective |
| violin mandatory legacy-baseline row | FAIL: 3 assertions | FAIL: 17 failures | insufficient qualified Human spread | same candidate benchmark | mandatory entry present; incumbent preserved |
| cello all-six T-078 diagnostic | FAIL: 16 pass, 2 fail | FAIL: 7 pass, 19 fail, 100 N/A | no qualified same-pitch group in objective | FAIL: 48 oscillators, 672 events | not promoted; loss 2.762122 |
| cello mandatory legacy-baseline row | FAIL: 2 assertions | FAIL: 23 failures | no qualified same-pitch group in objective | same candidate benchmark | mandatory entry present; pass-09 incumbent preserved |

Both final controllability audits are CLEAN. Violin is repeat-conservative
with one watch metric zeroed; audit SHA-256 is
`d6ab173c1206cd2ee077f6396d3e923ed637420f4f4a05b14a8e517d4d9b072c`.
Cello is repeat-stable with no uncontrolled weighted feature; audit SHA-256 is
`2c6cb4f9f4a09ac3526d0bf8a15293060bae7122a76361a4a57792e597f9d732`.
The common manifest hash is `a579e74e30d52b3b` and renderer contract is
`21e9ce780a8ee56a`.

Run summary SHA-256 values are violin
`3f095bc04f16860b2ccfefdd0ce5a92b5baecd1feeaac75412dcb6e3a5f47c1a`
and cello
`52ead84daed0ff44fb5b8644d8ab37c47906e628cc326e77d8359ad63d851742`.
Run-local SHIP auditions use fresh primary seeds 40106248 and 534325242.

Live exchange snapshot: 86 entries, source SHA-256
`16264348baed4d909536189c79fbfda49b350d9384a9c58c476561caa113e76f`,
artifact SHA-256
`eba65e74fa0f1bf5cc6d53c5d0cbd34cd498c352d2be1fe82dcc1df32b442c3c`.
The leaderboard and `state/{violin,cello}/leaderboard.json` backstops are
repaired after the synthetic persistence test and byte-identical at final
freeze. Their SHA-256 values are violin
`628d29948a25c5a3a13ea4021ca3af775a4bf216dbfefc764286cf2ae1f082e5`
and cello
`f3cb923e133f59acbead5fd1ea2731e4eb69be785bc3f41438cda69d28d9ee57`.
The canonical `sg2-data/listen.html` was rebuilt from shared head
`8cea72d` with fresh build seed 1784349921; SHA-256 is
`4151dde65f8474c563b7b3ee8ac88ab47a374bf550cc07f415acd27685af8e70`.
It contains verified leaderboard/pinned-component SHIP rows and excludes all
unpromoted pass-11 diagnostics.

Final verification on the integrated method is green: `npm test` 11/11 PASS;
`node scripts/verify_tone_model.mjs` all assertions PASS;
`PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` full suite PASS; and
`PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`
PASS at PCM hash
`91b790963a69cbc18810f60058787abcff97af152f7451e505080818d761b084`.

## Pending mandates / next pass

1. Retain T-083's cycle-aware method and its per-band instability reporting;
   do not reacquire cello takes solely to satisfy the retired fixed 250 ms
   window.
2. Reject the cello mid/pp and high/ff corrections; retain high/pp as useful
   cell-local evidence and mid/ff as mixed evidence, not as a preset surface.
3. Preserve violin's three partial PASS cells while isolating the dominant
   scale-free mel/band residual. Body, independent bow component and Human
   controls remain fixed until that source tier resolves.
4. Re-audit violin inharmonicity repeatability before restoring its weight;
   never compare the new objective's composite directly with pass 10.
5. Rerun each locked decomposition immediately when its ordinary identity
   audit reports every matched take near the core bars.

OWNER DECISION NEEDED: none.
