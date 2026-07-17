# SG2 Agent A — engine + blown pass 08

Date: 2026-07-18  
Lane: Agent A / engine + blown  
Pass first merged to shared at: `3ca100a`
Exit state: **§2.5(b), named limiting factor**; no ship, preset promotion, or freeze claim

## Outcome

Pass 08 adds a synthetic-gated extractor for the stable octave residual left
after the pinned harmonic source and independent air component have sounded.
It measures three disjoint blocks of active sustain, rejects unstable and
sub-fundamental bands, and maps only the stable source-addressable residual
back onto one existing register × dynamic source row. Body bands and the air
surface are immutable inputs to this step.

The required synthetic harmonic-plus-air round trip passes before real data:
mean absolute residual falls from 1.584 to 0.242 dB and the maximum remaining
residual is 0.460 dB, under the declared 0.35/0.75 dB bars. The real flute
mid/ff extraction then finds five stable source-addressable octave bands. A
bounded gain-one correction reduces the target construction cell from pass
07's 3.031/5.845 dB mean/max to **2.513/4.116 dB**, crossing both 3/6 dB
bars. The other five source rows are unchanged; body and air surfaces are
unchanged.

This is a conditional diagnostic candidate, not a factory preset. The proof
starts from pass 07's non-promoted mid/ff air probe, and flute still fails the
air-jet breath-law, body-stability, aggregate band-balance, strict identity,
and distributional-variation gates. Promoting only the final source row would
discard one of its tested upstream conditions, so neither surface is committed
to the factory preset.

## Synthetic-first and real-data evidence

The synthetic artifact is
`sg2-data/campaigns/flute/pass08-post-source-air-octave/synthetic-roundtrip.json`
(SHA-256 `963d50665886785b54fba85ccb54e77cb17587968f5b56dd920aeeaeffd9b097`).
It contains an independent band-limited air component in addition to the
harmonic source and refuses real extraction unless this same schema reports
PASS.

The real extraction compares Iowa `iowa-mid-ff-72.wav` with the final
post-source/post-air pass-07 render. Onset, release, and tail are excluded; no
room component is inferred or fitted.

| Octave centre | Median residual | MAD | Sign agreement | Source-addressable stable |
|---:|---:|---:|---:|:---:|
| 63 Hz | +8.277 dB | 1.463 dB | 3/3 | no |
| 125 Hz | +2.582 dB | 0.535 dB | 3/3 | no |
| 250 Hz | −3.111 dB | 0.278 dB | 3/3 | no |
| 500 Hz | −0.154 dB | 0.274 dB | 2/3 | yes |
| 1 kHz | −0.644 dB | 0.031 dB | 3/3 | yes |
| 2 kHz | +2.037 dB | 0.801 dB | 3/3 | yes |
| 4 kHz | −0.477 dB | 0.879 dB | 2/3 | yes |
| 8 kHz | −5.321 dB | 1.920 dB | 3/3 | yes |

Stability requires three blocks, MAD ≤2 dB and sign agreement ≥2/3. The
correction is capped at ±3 dB before interpolation; first-partial
normalisation leaves a measured maximum effective change of 2.814 dB.
Evidence SHA-256 is
`1770d45a309b78fb0f5de76c9073fcd8efd58a0bfbf7bc964591a439f2bf1975`;
the gain-one candidate SHA-256 is
`125964a5003924a14d859faa303d990febfeacf37a5120877262f66372c2e48d`.

## Bounded correction ladder

| Gain | Composite | Partial | Log-mel | Band | Mid/ff mean/max | Gate failures |
|---:|---:|---:|---:|---:|---:|---:|
| 0.25 | 2.682216 | 6.386472 | 2.405654 | 1.013615 | 2.874 / 5.372 dB | 31 |
| 0.50 | 2.684195 | 6.351659 | 2.403726 | 1.009432 | 2.719 / 4.924 dB | 30 |
| 0.75 | 2.683090 | 6.345562 | 2.401691 | 1.006809 | 2.614 / 4.504 dB | 30 |
| **1.00** | **2.681507** | **6.331715** | **2.399810** | **1.003914** | **2.513 / 4.116 dB** | **30** |

Gain 1.00 is selected because it is bounded, clears the target construction
cell, and is best on every upstream spectral diagnostic in the ladder. It
does not improve enough higher-level gates to become leaderboard-eligible.

## Cross-lane seam consumption

Agent C's current pass-19 upright-anatomy report leaves no new engine consumer
for Agent A: grand's 23 damper cells, 41-point action component, six anomaly
classes and MIDI-90 firewall are already output-verified. Upright L17 remains
an acquisition-only blocker with an executable scout; no grand or synthetic
value transfers to upright or blown instruments.

Agent E pass 11 exposed a relevant refinement defect: rebuilding from an old
calibration seed discards previously selected corrections. Pass 08 therefore
validates the inherited surface but starts correction from the selected fit's
**cumulative** effective source surface. E's room-screening safeguard is also
adapted: room-suspected onset/release/tail evidence remains excluded rather
than becoming an instrument or body parameter. T-078 records this transferable
method without copying flute values across families.

## Controllability audit

| Preset/run | Status | Objective | Manifest | Renderer | Initial preset | Responders | Uncontrolled weighted |
|---|:---:|---|---|---|---|---|:---:|
| Flute r12, octave mid/ff gain 1 | CLEAN/STABLE | `3552d37cfd7f6d19` | `77f24acf2fb45653` | `de30a803305d06c4` | `e9f978dd2d843616` | `windBreathLevel`, `breathVelocityExponent` | 0 |

The fixed octave-corrected surface is a candidate input, not a free optimiser
parameter. The parameter-manifest hash is `38fe5eec147c785d`, reference
contract `2eeab3e96793b76d`, and scorer contract
`sg2-score-pitch-sync-breath-v9`. Every perturbation analyses successfully;
repeatability is stable. Audit SHA-256 is
`684915a415473a65dbec52b9c90d961f8bfc977c91a013d1f1b3aafb46e7be74`.

## Flute gate table

| Gate | Candidate r12 | True-legacy baseline | Result |
|---|---:|---:|---|
| Strongest prior resolved | `flute ← legacy flute` | same | PASS |
| Construction | 9 pass / 3 fail | 9 pass / 3 fail | FAIL: breath law, body stability, aggregate band balance |
| Strict tripwire | 3 pass / 23 fail / 49 n/a; 4 strict cells missing | 27 tripwire failures | FAIL |
| Target mid/ff band cell | 2.513 / 4.116 dB, PASS | not separately cell-resolved | PASS only for candidate cell |
| Two-sided SHIP variation | 22 pass / 35 too-little / 4 too-much | FAIL | FAIL |
| Reference-variability floor | overall above-floor; 3/6 groups at-or-below | same corpus | WATCH |
| Resource | 25 oscillators, 250 events, 0.0720 ms model math | n/a | PASS: 1.25×/1.25× and under 4 ms |
| Owner listening | OPEN | OPEN | OPEN |
| Leaderboard promoted | NO | NO | NO |

The four strict missing cells remain band-balance low/pp and envelope-peak
low/pp, mid/pp, and high/pp. Other measured band-balance cells remain failing:
low/ff 6.059/7.612 dB, mid/pp 9.425/13.096 dB and high/ff
3.267/7.464 dB. Body stability still reports split-half correlation 0.825 but
peaks 1427.5/1852.1 Hz outside the one-third-octave agreement bar; body refit
remains prohibited.

## Strongest prior, leaderboard and durable state

The strongest-prior row is `flute ← legacy flute`, tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, row hash
`274cb12161abc1efc3b4cce73a918d4d70af1f3334b789988a0ca894b1ff39d5`
and resolved parameter hash
`e9f978dd2d843616e9b27793f8304e9105a6b508e95defe7a67ba3a40646ee13`.
SHIP Human remains nonzero at 0.62.

The durable run is
`sg2-data/runs/flute/sustain-source-r12-octave-midff100`; its summary SHA-256
is `1421e860d1a5037265d871b670f560eb46bb551834edd4074520a76b9b2cc900`.
No incumbent best was overwritten. The family leaderboard and state backstop
are byte-identical at SHA-256
`3430b4c490cc0f7a3efe9a591ccfbf3eb138d5e54a936f67f2853be6e7d39374`;
the existing frozen `best.json` backstop remains SHA-256
`9d9a806ee5a6f44e5558b8a263b929feb5c81aa998c383c509647b91a19dced5`.
The candidate SHIP audition uses fresh seed `1732333437` and is linked from
the run-local listening page.

## Exit state, next work and pending mandates

The §2.5 exit is state **(b)**. The pass clears the closest band-balance cell
but the aggregate source/body hierarchy remains above the tripwire and the
reference-variability floor is not demonstrated. The named limiting factor is
`remaining-post-source-post-air-band-balance-cells`. The filed next work is
`extract-stable-high-ff-post-source-post-air-octave-residual-before-body-stability-resolution`:
high/ff is the next closest measured cell, followed by low/ff and mid/pp.

No body table may change until the post-source/post-air source residual ladder
and the independent T-016 body-stability failure are resolved. §2.5c Human
differential fitting remains pending and masked until deterministic identity
passes the strict spectral tier. No owner decision is required.

## Pass-end artifacts and verification

The live exchange snapshot contains 81 parsed entries and includes T-078. It
is bound to source SHA-256
`cb695c4eba08239833f0cd367b453001bceb67dda7a7b6df7ff35f2d0f57c34a`
and stored at `sg2-data/state/agent-a-pass08-exchange-statuses.json` (snapshot
SHA-256 `117fd32039e56ba9f4d7cfbbfd53878dba064ce7b54a4a744f92296d7c3075ea`).
The global owner page was rebuilt for all 16 instruments on exact shared head
`3ca100a`. Twelve non-manifest instruments were freshly rendered with one
build seed through the project Python 3.12 environment; no render-failure row
remains. `listen.html` SHA-256 is
`cb228eb7c724d7b40aa20202f97e301d718086b276aa024f8cb5efa1c32448c6`.
The final report and shared integration commits are recorded in the durable
pass summary.

- `npm test`: PASS, 11/11;
- `node scripts/verify_tone_model.mjs`: PASS, all tone-model assertions;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS;
- `PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`:
  PASS, PCM SHA-256
  `40eec882cb92af9c70218d8e02a46df53f72c79143fba4520f63ea8b9d960eb4`;
- leaderboard/state byte comparison and `git diff --check`: PASS.
