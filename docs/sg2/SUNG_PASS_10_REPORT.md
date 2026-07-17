# SG2 sung campaign — pass 10 body consumption, strict cells and T-067

Date: 2026-07-17  
Owner: Agent E / sung lane  
Branch: `codex/sg2-e-sung-r2`  
Exit state: §2.5 state **(a)** — four measurable upstream improvements entered the current-objective leaderboards; none is ship-eligible

## Outcome

The named body/vowel blocker is closed. Fresh authoritative auditions pass
emitted-body consumption 10/10 and vowel identity 10/10 for tenor, soprano,
bass and mezzo. Six pass-09 misses were analysis plumbing; one bass row also
had a real annex-fit defect. The repair preserves the accepted joint-hull
source law and does not widen a tolerance.

T-067 now earns weight. The canonical frame-local complex-STFT harmonic
subtraction, multiband residual-envelope observable passes its synthetic,
partial-muted engine and octave gates. A balanced lossless corpus supplies ten
room-screened rows per adult voice. All four ordinary identity audits are
clean and repeat-stable with `pitch_sync_breath_db=1`, a
`voiceBreathSync` responder and no uncontrolled weighted feature. The fitted
seeds are tenor 0.16, soprano 0.12, bass 0.27 and mezzo 0.17.

The bounded source-cell refiner improves the first unresolved canonical
partial tier in every voice. No partial aggregate reaches 3 dB, however, so
later tiers and §2.5c remain masked. These are interim failing leaders, not
shipped or audited presets.

## Shared-head reconciliation

Shared advanced twice during the pass. Every score-producing artifact from
renderer `d35cbe802578e938` was quarantined with a renderer/commit suffix and
rerun after merging. The authoritative renderer contract is
`9b18b3bb7bfc75eb`. T-067's six engine WAVs were byte-identical across both
changes, but the final evidence was still regenerated rather than relabelled.

The second merge brought pass-07 room analysis whose historical whole-note
observable conflicted with the canonical weighted T-067 implementation. The
resolution preserves only its non-negative exponential room-tail fitter in
`sung_room_decay.py`; it obtains residuals through the canonical STFT
separator. `sung_breath.py` remains a compatibility facade. The historical
broad room scan remains durable watch evidence, while the later balanced
clean subset is the corpus actually consumed by the weighted objective.

## T-058 failure classification and repair

| Voice / row | Pass-09 failure | Classification | Resolution |
|---|---|---|---|
| Tenor `/i/ low-mf` | tail-dominated paired ratio | plumbing | symmetric -50 dB common audibility floor |
| Tenor `/u/ low-mf` | tail-dominated paired ratio | plumbing | same |
| Soprano `/u/ low-mf` | tail-dominated paired ratio | plumbing | same |
| Bass `/o/ mid-mf` | tail-dominated paired ratio | plumbing | same |
| Bass `/u/ low-mf` | tail-dominated paired ratio | plumbing | same |
| Mezzo `/o/ mid-mf` | tail-dominated paired ratio | plumbing | same |
| Bass `/a/ mid-mf` | F2 1023.755 Hz below 1034 Hz annex floor | plumbing + fit | floor plus constrained F2=1034 Hz refit |

The prior analyser admitted numerically SNR-valid source-table tails below
-50 dB, so inaudible leakage dominated shape correlation and the paired
ratio. The new consumer records pre/post harmonic counts and thresholds and
compares a dedicated body-on/body-bypass pair with source, breath, onset,
vibrato and consonants neutral in both arms. The bass constraint changes only
the fitted/emitted `/a/` F2; gains, widths and source rows are unchanged.

## Current-objective gate table

| Preset / entry | Composite | Construction | Strict cells | Body | Vowel | Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy | **3.683058** | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor prior | 3.799193 | FAIL 10/11 | FAIL 0 / 36 / 0 | FAIL 9/10 | FAIL 9/10 | masked | **FAIL** |
| Tenor pass-10 | 3.784696 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Soprano legacy | 4.465091 | FAIL 9/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano prior | 4.118235 | FAIL 9/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano pass-10 | **4.108306** | **PASS 10/10** | FAIL 0 / 27 / 1 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Bass legacy | **3.436306** | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass prior | 3.436418 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass pass-10 | 3.452731 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Mezzo legacy | **3.733679** | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo prior | 3.733787 | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo pass-10 | 3.748193 | **PASS 10/10** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |

Soprano high/p sustained band balance remains missing evidence, not a fitted
failure. Legacy and prior rows fail construction because frozen
`voiceBreathSync=0` cannot satisfy the newly earned observable. Composite is
not the selector while construction and partial identity remain unresolved.

## Canonical selection evidence

| Voice | Composite, prior → candidate | Required-cell partial residual, prior → candidate | Body, prior → candidate | Decision |
|---|---:|---:|---:|---|
| Tenor | 3.799193 → **3.784696** | 5.884974 → **5.802613** | 9/10 → **10/10** | promote interim leader |
| Soprano | 4.118235 → **4.108306** | 6.608454 → **6.329833** | 10/10 → 10/10 | promote interim leader |
| Bass | **3.436418** → 3.452731 | 5.971774 → **5.642416** | 10/10 → 10/10 | promote upstream winner |
| Mezzo | **3.733787** → 3.748193 | 5.349991 → **4.893441** | 10/10 → 10/10 | promote upstream winner |

Every candidate also removes the one breath construction failure. The
hierarchy therefore promotes all four rows even where composite is slightly
worse. Mel, attack and band changes remain downstream diagnostics until the
partial tier passes.

## T-067 evidence and controllability

Engine audit SHA-256 is
`70e8fe732206a089eee84096dab008ef35dd7cdad5f82daf88cd492bacbfa4a1`;
calibration SHA-256 is
`58126bd64b4e9ef25063e26b2cb285cc2e0e193c0285052d8d51b7c4bf23e4d0`.
The engine response is 21.315168 dB above zero and octave ratio error is
0.0019484. Corpus medians are 20.641544 dB tenor, 18.585184 dB soprano,
23.887340 dB bass and 20.754777 dB mezzo; no selected row is room-suspected.

Narrow responder audit SHA-256 values are tenor `c458b7491cac75407d8e60d599971f2814a0a4caaffe87827cf8fab1721cb5db`,
soprano `1243191d500431f6064ed8868381bff93c2c2971b0eab7d69587c8294c53ef26`,
bass `1986ba52ace99435103d917687e1accb3245fa9b8be46342998fa7b0ebc56da7`
and mezzo `e14416a1691f47c370b79e3775281037fe61278d9ba3e8ea542841d0b87dfba1`.
Ordinary identity audit file hashes are tenor `c66032460479c66d08948897f34eded9d0a125dc4901e858e0843d85561cb40b`,
soprano `e68f5e25fe86239ad73cda2ea9c3bd6dcfa4dc12810398b6c7d148e5def642a1`,
bass `87dd4cc756d69513a240dc5745a8f17ee42d46f12ca02523fde337945b87b393`
and mezzo `a49319130b95abb6944cc5fe06b0cb669f3682241417e37ad3d0d0a6e92105b9`.

## Source and consonant consumers

Current-head source audits are clean for partial, log-mel and band balance.
Their audit hashes are tenor `7e5f81dbf0cb3f98fa9032f8cd157fec44e71ac7fba65efefae3f2eed7fc23ab`,
soprano `9b7ceac04eba61b50ed56f2197145b7b2b95537f366283953f8292e1306f0072`,
bass `0bc378b2cce12880a692d2c81c7a7c39c0a0b9a9424ce28949357d54c1f82626`
and mezzo `40f47d1d6ca24e11bf84ef9b6e06e9598280d27905f28772d667b84b87c739f4`.

All adult voices already contain the five measured consonant onset classes;
there was no remaining voice to extend. Fresh output audits pass activation
and earn all five weights. Audit hashes are tenor
`48b3857f4f58caa4024e4ad6537c9f3de3e65970b7f21cf9ff8b74ee9e09b96c`,
soprano `135020042cf2939d9bf128d794cbefcb7135aa8ba2f23e69f4328d49bde19b39`,
bass `bf880feb70d2e17cfedcdccd325b6db373c49e664afed243adf208589d388421`
and mezzo `e81f6bfb736b3e1bf6f473bce3646bfe22d1a8dac9536403b88478855db7c3bb`.

## Prior, F13 and pass artifacts

All four voices retain prior row `voice-soprano/mezzo/tenor/bass -> legacy
vocal`, tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`.

F13 is applied per goal. The selected lossless rows are full-strength breath
evidence after explicit room screening; excluded room-like rows remain logged
and do not enter the objective. Deterministic partial identity still fails in
every voice, so §2.5c is `INCONCLUSIVE-MASKED`; no Human range is widened.

Pass snapshot SHA-256 is
`22488aa2d594764745a0d644406d1eb319633af388fadaeeb99d55d8d1c4ceee`.
Controllability table SHA-256 is
`b641a7ea76d235cea55c04ed3ccb1e4d4be8331bd03c4791127f784179f6cc70`.
Final exchange source SHA-256 is
`3d66ded0b5bae026ae9134fb2f8bc511ba2b7db3c1a7278877d69b19e466a655`.
Leaderboard and best backstops are copied under `sg2-data/state/voice-*`;
fresh seeded SHIP audition manifests live in each selected pass-10 run.

## Verification and next work

The required suite passes:

- `npm test` — 11/11 pass
- `node scripts/verify_tone_model.mjs` — all tone-model v2 assertions pass
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` — pass
- `PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`
  — pass, `6492fe9e8996bc7d0c5fa2ac75ee6602b3fd7d8052748445c71d5e7d0b8cd474`

The next limiting factor is the still-failing per-register × dynamic partial
surface: 9/9 required cells fail for tenor, bass and mezzo, and 7/7 fail for
soprano. Continue upstream spectral refinement without reopening the accepted
source hull, body consumer, breath observable or consonant weights. No owner
decision or final freeze is requested.
