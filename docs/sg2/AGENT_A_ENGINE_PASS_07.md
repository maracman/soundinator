# SG2 Agent A — engine + blown pass 07

Date: 2026-07-18  
Lane: Agent A / engine + blown  
Engine change first shared at: `4810c30`  
Exit state: **limiting-factor**, no ship, preset promotion, or freeze claim

## Outcome

The interrupted pass was recovered and completed on the shared head. The
engine now has a neutral-by-default, instrument-owned wind air-level surface
for register × dynamic evidence. Its absent state is exact identity, its
interpolator uses the same measured joint hull as the blown source surfaces,
and the scalar `windBreathLevel` remains the master. The schema, browser
fingerprint consumer, all five blown-family enumeration, midpoint behaviour,
and absent-state identity are verifier-covered.

The surface was then used only as a bounded flute probe. A mid/ff scale of
0.70 improved the upstream objective and the targeted band-balance cell, but
did not cross the construction bar. A lower 0.45 row demonstrated a
non-monotonic mean/max tradeoff rather than a hidden clearance. Neither fitted
row was committed to the factory preset.

No new L18/T-069 engine seam appeared from Agent C during this pass. Its
current grand-piano result remains output-verified with all 23 damper cells,
the 41-point action component, six anomaly classes, 17.583 ms action lead,
−9.376 dB/s held decay, and the MIDI-90 undamped firewall. Agent E's pass-11
source refinement likewise surfaced no engine seam: T-058 body/vowel
consumption, T-065 current-head source refinement, T-067 weighted
pitch-synchronous breath, and T-064 consonant enumeration remain active. Per
the pass instruction, T-074 was not reopened.

## Why band balance stayed first

The live criteria-drift matrix contains 172 accepted evaluations, 105
directed transitions, 22 measured edges, 135 symmetric couplings, and four
theory disagreements. Its working order begins
`inharmonicity_log_ratio → band_balance_db → centroid_semitones → log_mel_db →
ltas_rolloff_db_oct → partials_db → pitch_sync_breath_db`. T-071 quarantines
the inactive inharmonicity criterion for blown triage, leaving band balance as
the first active criterion. No independent empirical edge promotes downstream
breath/noise polish ahead of it.

The pass-06 global partial-tilt edge was already exhausted: its lower
composite retained 32 gate failures, while the hierarchy-favoured row worsened
the composite. The scalar air sweep then showed that air level materially
controls band balance but cannot satisfy incompatible register cells. The
register/dynamic surface was therefore the next bounded source-adjacent edge,
not a downstream polish or an unevidenced body mutation.

## Controllability audit

| Preset/run | Status | Objective | Manifest | Renderer | Initial preset | Responders | Uncontrolled weighted |
|---|:---:|---|---|---|---|---|:---:|
| Flute r10, mid/ff 0.70 | CLEAN/STABLE | `3552d37cfd7f6d19` | `77f24acf2fb45653` | `de30a803305d06c4` | `30a10e1f0179e54b` | `windBreathLevel`, `breathVelocityExponent` | 0 |

The structured surface is a fixed candidate input, not a free fit parameter;
the sounded output supplies its consumer evidence. The audit parameter
manifest hash is `38fe5eec147c785d`, the reference contract is
`2eeab3e96793b76d`, every perturbation analysed successfully, and repeatability
is stable.

## Flute gate table

| Gate | Candidate r10 | True-legacy baseline | Result |
|---|---:|---:|---|
| Strongest prior resolved | `flute ← legacy flute` | same | PASS |
| Construction | 9 pass / 3 fail | 9 pass / 3 fail | FAIL: air-jet breath law, body stability, band balance |
| Strict tripwire | 2 pass / 24 fail / 49 n/a; 4 strict cells missing | 28 tripwire failures | FAIL |
| Two-sided SHIP variation | 19 pass / 37 too-little / 5 too-much | FAIL | FAIL |
| Reference-variability floor | overall above-floor; 3/6 groups at-or-below | same corpus | WATCH |
| Resource | 25 oscillators, 250 events, 0.0799 ms model math | n/a | PASS, 1.25×/1.25× and under 4 ms |
| Owner listening | OPEN | OPEN | OPEN |
| Leaderboard promoted | NO | NO | NO |

The four strict missing cells are band-balance low/pp and envelope-peak
low/pp, mid/pp, and high/pp. Construction-paired band-balance mean/max values
are: low/ff 6.059/7.612 dB, mid/pp 9.425/13.096 dB, mid/ff
3.031/5.845 dB, and high/ff 3.267/7.464 dB; the two pp edge cells have no
strict paired value. Against r8, only mid/ff changed materially:
3.070/6.251 → 3.031/5.845 dB.

## Strongest prior and durable state

The strongest-prior row is `flute ← legacy flute`, tag `sg2-legacy`, row hash
`274cb12161abc1efc3b4cce73a918d4d70af1f3334b789988a0ca894b1ff39d5`.
The r10 resolved parameter hash is
`30a10e1f0179e54b641b45f380b10637da4ea5fe094d5aefc6c603c7a43491f7`;
SHIP Human remains nonzero at 0.62.

Run evidence is durable under
`sg2-data/runs/flute/sustain-source-r10-air-surface-midff070`; its summary
SHA-256 is `c01baa5cda368636776f41010aa04656d6ad7060aafbc6c047b63af94a2abe35`.
The family leaderboard and state backstop are byte-identical at SHA-256
`94dfcd943db0939b3613fdb1742b579c09b63b7417c1cccf0d8cece27d473464`.
The live criteria-drift state is SHA-256
`e8fd4ca6b6219316a30998d0b08d9284742794313547650ca7688ac05431322f`.

## Exit state and next work

The accepted r10 probe improves the cross-run composite from 3.193881 to
3.186308 (0.007573) while preserving the five untargeted anchors. It does not
clear a gate. The r11 0.45 probe worsens the composite to 3.191103 and the
target mean to 3.120 dB despite lowering its maximum, confirming the bounded
edge's non-monotonic plateau.

The named limiting factor is
`post-air-surface-band-balance-residual-remains-upstream`. The filed next work
is `extract-stable-post-source-post-air-octave-residual-before-any-body-refit`.
That analysis must also resolve the independent T-016 body-stability failure
(`splitHalfCorr=0.825`, peaks 1427.5/1852.1 Hz) before any body table changes.
No owner decision is required.

## Pass-end artifacts and verification

The live exchange status snapshot contains 80 parsed entries, is bound to
exchange source SHA-256
`577bd57958e6ce190a7ae809377bb7e7bd01e1939cd65d395f1ef7e4777a5ffc`,
and is stored at `sg2-data/state/agent-a-pass07-exchange-statuses.json`. The
global listening build's final hash is recorded in
`sg2-data/state/agent-a-pass07-summary.json`.

The global owner page was freshly rebuilt for all 16 instruments against
audio-equivalent engine head `aaf01bf`, with no render failures. Its
`listen.html` SHA-256 is
`d266b4353cac86fd2853fef9205d7b51f906ee31186a83f43edf05b750172923`.

- `npm test`: PASS, 11/11;
- `node scripts/verify_tone_model.mjs`: PASS;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS;
- `PYTHON=../../../.venv/bin/python node scripts/render_note.mjs --verify`:
  PASS, PCM SHA-256
  `18abfcbf08d26a5cf2f9b1fc6f132bf41217b4ab31d140057e281ac83a5a21b4`;
- leaderboard/state byte comparison and `git diff --check`: PASS.

The engine change was merged to the shared branch during the pass; this
report and T-077 are the final documentation merge.
