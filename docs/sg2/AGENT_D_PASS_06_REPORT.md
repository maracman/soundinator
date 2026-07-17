# Agent D pass 06 report

Date: 2026-07-17  
Exit state: `limiting-factor` — the first six-cell cello source-surface attempt
was rejected by construction and §3; the prior non-eligible leaderboard row is
unchanged.  
Legacy prior: `cello ← legacy cello`, commit `e8d3ac1`, row hash
`a86e5a44b3b5b644`, resolved parameter hash
`df797ee02f58da21c303497966f5d53ff24ffb9dacb1fb3f5e3617cef86ba18e`.

## §2.5c/F13 cello differential fit

`humanRanges` schema 4 now states an explicit evidence grade per dimension.
Eleven lossless source/dynamic/string runs contribute 47 adjacent-note pairs;
their local linear register trend is removed before a note-local width is
estimated. All 12 same-note Philharmonia pairs remain full-strength for the
duration-robust vibrato rate, depth and onset-delay objectives. This applies
F13 per dimension; it does not blanket-downgrade the fit because other repeat
observables are window/floor sensitive.

| Qualified range | Evidence grade | Draw half-range |
|---|---|---:|
| bow position | A — lossless adjacent | 0.126541 fraction |
| vibrato rate | A — duration-robust repeat | 1.993917 Hz |
| vibrato depth | A — duration-robust repeat | 9.494243 cents |
| vibrato onset delay | A — duration-robust repeat | 29.554177 ms |
| sustained bow noise | B — common-window repeat | 7.775918 dB |
| onset scratch | A — lossless adjacent | 18.039481 dB |
| attack-noise ratio | A — lossless adjacent | 0.003818 |
| onset wander | A — lossless adjacent | 41.022606 cents |
| onset settle | A — lossless adjacent | 90.986341 ms |

Vibrato ramp, rate drift and the sustained-noise floor remain separately
weaker evidence; the invalid generic lossless floor shortcut is still excluded.
The durable report is `campaigns/cello/humanisation-fit-pass06.json` (SHA-256
`b9fff0912028f732f315ef8b9619654f93e104b98ff26130e5c082c179afbe44`).

The final current-shared-head native-episode audit is clean and repeat-stable:
renderer `bde97ef9a7eddcff`, objective `3eb2e21c6ca4470b`, Human contract
`701f65c47237a5ae`. Four of nine adapters respond above 0.05: bow position,
sustained bow noise, onset wander and onset settle. All 12 identity
decompositions still fail the core bars, so the verdict remains
`INCONCLUSIVE-MASKED`; no missing-Human-DOF claim or widening is permitted.

Scope correction: the durable 4/9 audit is a **cello** audit. Violin uses the
same bowed adapter functions, but its currently checked-in violin Human
contract has seven older qualified ranges, not a current violin-specific 4/9
artifact. T-074 therefore files shared violin/cello engine specs without
inventing violin evidence or copying cello values across the firewall.

## T-074 — five blocked Human adapters

The exact current-head blockers are filed in
`docs/sg2/BOWED_ENGINE_HANDOFFS.md`:

1. Vibrato rate moves the `vibrato` observable only 0.034545; a rate-only
   intervention is inaudible unless the same episode holds positive depth.
2. Vibrato depth moves `body_am_db` only 0.042904.
3. Vibrato onset delay has exactly zero estimator response because no isolated
   active-vibrato prerequisite is held during the aggregate perturbation.
4. Scratch multiplies a strongest-prior `bowScratchLevel` of zero, so its dB
   adapter is an exact zero trap.
5. Attack noise adds the raw 0.003818 ratio width after profile scaling and
   moves the combined `onset_noise_db` observable only 0.041642; the already
   declared ×10 ratio calibration is not consumed at that seam.

Each spec requires a hashed forced episode, one range at a time, physical
prerequisites held fixed, encoded-direction response above 0.05 and exact
Human-0/no-episode PCM identity. The decomposition mask stays in force until
all five isolated consumers pass and the six-cell aggregate audit is rerun.

## Cello construction and §3 grind

Pass 05's local best remains the useful non-promoted comparator at loss
2.514053 with 16/18 construction assertions, but it has 26 hard gate failures.
The persisted leaderboard therefore still points to the older legacy row.

Pass 06 emitted `D-BOWED-SOURCE-01`, six instrument-owned string/register/
dynamic rows derived from paired reference/render harmonic residuals. The
evidence hash is `8272511f7253bcdecec23dba6615f8b702506b63300765f8e1cbceb5078cd2f6`;
cell corrections span 4.32–14.36 dB. A fresh consuming audit was clean, but
the actual §3 attempt proved the correction cannot be activated wholesale:
loss rose to 20.014749, construction fell to 14/18 and no measured strict bar
passed.

| Row | Loss | Construction | Strict §3 | Distribution | Leaderboard |
|---|---:|---:|---:|---|---|
| persisted legacy `agentd-pass03-start` | 3.142243 | 3 fail | 24 fail | not evidenced | unchanged |
| pass-05 local best | 2.514053 | 16 pass / 2 fail | 26 gate failures | failed | not promoted |
| pass-06 source attempt | 20.014749 | 14 pass / 4 fail | 0 pass / 17 fail / 13 N/A | insufficient evidence | rejected |

The source attempt failed pitch lock by 4141 cents, dynamic tilt at 5.71,
radiated rolloff at -24.23 dB/oct and the vibrato-body-AM assertion. Its §3
partial cells range from 7.25 to 61.2 dB against the 3 dB bar. Resource gates
also fail oscillator (2.0×) and automation (2.8×) ratios. It is retained as a
failed hierarchy experiment, never emitted into the measured profile or
leaderboard. The work item now requires per-cell acceptance against the
upstream partial tier and a cello-owned pinned bow residual; a full-chain
reference/render correction is not an eligible source estimate.

## Sung support: T-058 and T-067

T-058 now renders a dedicated body-audit pair. Both arms hold the exact
register/dynamic source surface fixed and neutralise downstream
`partialTransfer`, attack/breath noise and vibrato; only `bodyBands` differs.
The paired emitted-body classifier consumes this pair while full FIT identity
scoring remains unchanged. This removes the source-surface/partial-transfer
contamination that appeared after A-VOICE-05. The isolated consumer test is
green; Agent E still owns the current-head four-voice 10-row comparator rerun.

T-067 is implemented as tracked-f0 harmonic reconstruction/subtraction,
Hilbert residual-noise envelope and modulation prominence at tracked f0 against
adjacent/same-band floors. The known harmonic plus body-filtered AM-noise round
trip passes the 2% frequency and 1 dB prominence bars. Partial-muted engine
pairs pass at 27.837/28.716 dB for the low/octave enabled renders, 21.092 dB
above the same-seed zero render, with 0.136% octave error. The audit SHA-256 is
`eee84bcf569e90271e16bd097b2ef76606f06a37ca813ea9c49ab2b658e6f01f`.

Lossless VocalSet measurement emits 44 tenor, 45 soprano, 45 bass and 45
mezzo rows; 1/5/0/0 rows respectively are excluded by analysis. Every retained
row is explicitly `unassessed-separate` for room residuals. Consequently
`activationEligible=false`, `pitch_sync_breath_db` remains zero-weight and all
adult `voiceBreathSync` values remain zero.

## Exchange, state and pass-end gates

Live exchange status is materialised at
`state/agent-d-pass06-exchange-statuses.json` (77 parsed entries). Relevant
rows are T-058 `analysis=incorporated-paired-consumer-fix`, sung T-067
`analysis=observable-incorporated-values-still-neutral`, T-073
`analysis=F13-per-dimension-grades-incorporated`, and T-074
`engine=pending-five-isolated-adapters`.

Verification on the final merged head:

- `npm test`: 11/11 pass.
- `node scripts/verify_tone_model.mjs`: all assertions pass.
- `PYTHONPATH=src:. python -m pytest -q`: full suite passes.
- `node scripts/render_note.mjs --verify`: pass, hash
  `13e2bb56723c9cfe79875ec3043492408907fff59aa5ac603db3e52938e61180`.
- `scripts/sg2_listen_page.py`: 16 instruments rebuilt; 12 re-rendered. A
  final page-only metadata seal reports 700 audio links, zero dead links and
  zero missing placeholders at `sg2-data/listen.html`.

Pending mandates:

1. Agent A: consume T-074's five isolated bowed adapters and rerun the hashed
   aggregate Human audit.
2. Agent E: rerun the T-058 ten-row comparator for all voices; keep T-067
   values neutral until room screening and scorer/responder activation close.
3. Agent D: replace the rejected full-chain cello correction with
   deconvolved, per-cell hierarchy-gated source estimates and extract a
   cello-owned L14 bow residual before distribution promotion.

OWNER DECISION NEEDED: none.
