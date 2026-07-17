# Struck/plucked pass 15 — upright identity, morph evidence, and nylon drift

Date: 2026-07-17  
Scope: upright-piano corpus contract and first fit, grand↔upright WP-9 morph
test, nylon band/attack continuation, glockenspiel/harp reference prep, and
renderer concurrency hardening.

## Outcome

Upright piano now has a corpus-owned campaign and measured identity. The
missing corpus contract was reconstructed from the landed VSCO files: 69
hashed stereo 44.1 kHz/24-bit WAVs, 23 pitches from A0 to C8, and three
dynamics. The fitting campaign uses 21 dense anchors across seven registers
and p/mf/ff. All anchors are isolated takes with mechanically audited release
tails; release metrics remain zero-weight watches because their dedicated
controls have not passed a release audit.

The upright is a legacy-piano craft adaptation, not a renamed grand. It keeps
the strike/string mechanism while consuming an independently measured
five-region B table, body, onset, and decay identity. Its exact 11-control
audit is clean. The first fit closes the double-decay assertion but does not
beat the legacy/measured seed on raw loss and remains blocked by velocity
hardness coupling, strict tripwires, and absent repeated-take evidence.

Nylon pass 15 improves its new repeat-stable objective by 4.75% while keeping
attack at 6/6 cells. Partial, mel, and band-balance bars remain 0/6, so this is
not a tripwire pass. Directed criterion-drift events show both composite
improvement with attack/band degradation and band improvement with attack
degradation.

## Upright corpus and campaign

| Contract item | Evidence |
|---|---|
| Durable corpus | `sg2-data/samples/piano-upright/` |
| Coverage | 69 WAVs; 23 pitches × p/mf/ff; A0–C8; rr1 only |
| Campaign | 21 references; seven registers × p/mf/ff |
| Register anchors | A0, C#2, F3, A4, C#6, F7, C8 |
| Provenance | VSCO 2 Community Edition, CC0-1.0; Simon Dalzell; UK medium room; Rode NT5 spaced pair at player position |
| Repeats | none; adjacent-pitch proxies only |
| Prior | `piano-upright ← legacy piano craft; fitted upright identity` |
| Prior hash | `4a3ec5f017315885a35bbfa1602a69d7d1d6c74ede6bc9699c3666cd125c0684` |
| Fit/ship Human | 0.0 / 0.1 |

The room/player-position capture is an explicit body and late-decay confound.
It does not license a room-compensated identity claim or a measured Human
distribution.

## WP-9 grand ↔ upright morph test

| Differentiating axis | Grand | Upright | Verdict |
|---|---:|---:|---|
| Comparable-bass median B, 55–132 Hz | 1.2916e−4 | 2.53555e−4 | upright/grand = **1.963×**, inside the annex C7 same-note ratios 1.91× and 2.81× |
| Aggregate B, diagnostic only | 1.4817e−4 | 2.1006e−4 | upright is 1.418×; not the morph gate |
| B-table resolution | 3 regions | 5 regions | upright satisfies the annex minimum |
| Five upright B anchors | — | 2.7688e−4, 2.4911e−4, 2.435e−5, 0, 4.8543e−4 | measured V-shape retained |
| Free-decay T60 proxy at C4 | 16.2109 s | 13.6576 s | shorter-upright direction; room-confounded |
| Dominant fitted body band | 820.5 Hz / +1.1269 | 393.3 Hz / +1.3449 | independently fitted bodies |
| Envelope attack | 21 ms | 16 ms | corpus-owned onset difference |
| Onset-noise centre / level ratio | 730 Hz / 1.703 | 389 Hz / 2.018 | independent upright onset identity |
| Mechanism | strike + string | strike + string | invariant, as required |

The upright body has split-half correlation 0.955 and 0.006 dB round-trip
shape error. The comparison is recorded in the parameter ledger; no global
`partialB` was bent to force the pair apart.

## Upright controllability and fit

Audit: `sg2-data/audits/piano-upright/pass01-tail-audited-fit-contract/`.

| Audit item | Result |
|---|---|
| Exact free controls | 11 |
| Register × dynamic cells | 21 |
| Perturbation renders | 525 |
| Weighted uncontrollable features | none |
| Repeat stability | watch metrics zeroed |
| Zeroed unstable metrics | decay ratio, inharmonicity ratio, generic noise |
| Release metrics | watch-only |

Authoritative run:
`sg2-data/runs/piano-upright/pass01-port-isolated-final/`.

| Result | Value |
|---|---:|
| Baseline loss | 4.066696 |
| Construction-aware candidate loss | 4.066708 |
| Evaluations | 30 |
| Construction | 9/10; velocity hardness coupling remains |
| Strict tripwires | 2 pass / 80 fail / 44 not applicable |
| Dominant residual | band balance, 8.3247 perceptual units |
| Resource tripwire | PASS; 0.0806 ms/note, 13 oscillators, 13 automation events |
| Leaderboard update | no |

The accepted construction-aware candidate uses `decaySecondStage=0.8541`
and `decaySecondRatio=1.7`, closing double decay. One-axis sensitivity found
lower raw-loss spectrum candidates, but they did not improve construction and
were not eligible combined fits. No repeated same-pitch/dynamic take exists,
so the §2.5c ship-variation gate and reference floor remain
`insufficient-evidence`.

## Nylon pass 15

Audit: `sg2-data/audits/guitar-nylon/pass15-band-attack/`.  
Run: `sg2-data/runs/guitar-nylon/pass15-band-attack/`.

This is a distinct objective hash from pass 14: repeat-unstable decay and
inharmonicity were zero-weighted, and the campaign was rebuilt with explicit
fit-mode Human 0 provenance.

| Result | Value |
|---|---:|
| Baseline loss | 4.627820 |
| Best loss | 4.408217 |
| Improvement | 0.219603 (4.75%) |
| Evaluations | 38 |
| Best excitation position | 0.091776 |
| Best excitation hardness | 0.867486 |
| Best attack-noise level | 0.06 |
| Construction | 10/11; double decay remains |
| Attack cells | **6/6 PASS** |
| Partial-table cells | 0/6 |
| Mel cells | 0/6 |
| Band-balance cells | 0/6 |
| Dominant residual | centroid, 12.1685 perceptual units |
| Resource tripwire | PASS; 0.0812 ms/note, 10 oscillators, 10 automation events |
| Leaderboard update | no; repeated-take ship gate unavailable |

### Directed criteria drift

The run summary contains the following owner-directed observations in
addition to the shared T-059 aggregate state:

- Evaluation 0→3 improved composite loss by 0.017593 while attack worsened by
  0.04551 and band balance worsened by 0.00365 perceptual units.
- Evaluation 4→10 improved band balance by 0.04695 while attack worsened by
  0.00417 perceptual units.
- Evaluation 16→29 produced the final low-noise raw leader while attack
  worsened by 0.01895; all six attack cells nevertheless remained inside the
  hard tripwire bar.

The state now contains nine accepted steps from pass 15. The evidence supports
local bidirectional coupling, not a universal validation hierarchy edge.

## Glockenspiel, harp, and steel guitar

| Instrument | Status | Coverage decision |
|---|---|---|
| Glockenspiel | prep-only | six G4–C7 anchors, mf only; bar-class firewall declared; no dynamic/repeat claim |
| Harp | prep-only | 23 E1–F7 anchors; 20 mf plus sparse mp/f; no balanced dynamic/repeat claim |
| Steel guitar | corpus absent | explicitly flagged; no proxy corpus or improvised identity |

Glockenspiel has not been promoted to an audit. Its sparse corpus cannot
support the full control grid, so no bar-mode failure or engine spec is
invented. When coverage permits, `resonatorClass=bar` remains mandatory and
any uncontrollable bar-mode parameter must become an engine spec rather than
a modified B value.

## Renderer concurrency repair

Concurrent family agents exposed that `render_note.mjs` reused fixed port
8765. A renderer could therefore consume another checkout's web assets or
time out while the port was saturated. Each renderer now owns an ephemeral
loopback port unless an explicit managed `SG2_URL` is supplied; server
readiness has a bounded 60-second window. Three simultaneous verification
runs and both final Agent C campaigns completed without port reuse.

Batch rendering remains memory-bounded, and rebase manifests now restore the
current fit-mode prior/Human fields instead of carrying a saved ship-mode
listening preset into the campaign declaration.

## Exchange status

| Entry | Struck/plucked status |
|---|---|
| T-055 differential Human fits | adapted; Identity remained frozen and no Human widening was claimed without repeated takes |
| T-056 craft prior vs fit mode | incorporated; rebases now declare Human 0 / fit provenance |
| T-059 criteria drift | incorporated; pass-14 backfill plus nine pass-15 accepted steps and directed run events |
| T-060 release scoring | adapted; upright tails audited, release remains zero-weight until controls pass |
| T-042 checkout identity | strengthened; per-process private ports prevent cross-worktree server reuse |

## Gate table

| Gate | Upright | Nylon |
|---|:---:|:---:|
| Durable artifact root | PASS | PASS |
| Corpus coverage contract | PASS | PASS |
| Deterministic fit / ship Human split | PASS | PASS |
| Controllability | PASS | PASS |
| Construction | FAIL (9/10) | FAIL (10/11) |
| Strict §3 tripwires | FAIL | FAIL |
| Resource tripwire | PASS | PASS |
| Reference-variability floor | INSUFFICIENT | INSUFFICIENT |
| Ship distribution gate | INSUFFICIENT | INSUFFICIENT |
| Owner listening | OPEN | OPEN |
| Leaderboard candidate accepted | NO | NO |

## Stop condition

Stop this pass with no owner decision pending. Upright and nylon both have
clean audited objectives, completed sensitivity, resource evidence, listening
pages, and filed repeat-evidence limiting factors. Resume upright from the
construction-aware candidate when same-note repeats or a scoped velocity-law
continuation is available. Resume nylon from pass 15 for combined double-decay
or cell-specific string-spectrum work; global band balance remains the main
tripwire blocker.

## Verification

- Full Python suite: PASS
- JavaScript suite: 11/11 PASS
- Tone-model v2 headless assertions: PASS
- Headless render verification: PASS
- Three-process concurrent render verification: PASS
- Owner listen-page rebuild: PASS

