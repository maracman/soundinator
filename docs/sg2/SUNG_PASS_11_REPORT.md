# SG2 sung campaign — pass 11 cumulative strict-cell refinement

Date: 2026-07-18  
Owner: Agent E / sung lane  
Branch: `codex/sg2-e-sung-r2`  
Exit state: §2.5 state **(a)** — four measurable current-objective improvements entered the durable leaderboards; none is ship-eligible

## Outcome

All four adult voices advance on the first unresolved spectral tier under the
current renderer contract `c40eb906eba5422b`. Relative to freshly regenerated
pass-10 incumbents, required-cell partial residual improves by 0.106 dB tenor,
0.114 dB soprano, 0.249 dB bass and 0.140 dB mezzo. Log-mel and band balance
also improve in every voice. Construction, emitted-body consumption and vowel
identity remain clean.

No strict partial cell clears the 3 dB all-row aggregate. Identity therefore
remains unstable and §2.5c is correctly `INCONCLUSIVE-MASKED`; no measured
Human range is widened. The selected rows are interim failing leaders, not
shipped or audited presets.

## Shared-head and interrupted-relaunch reconciliation

Pass 10 was already merged to shared at `a16a851`. The branch fast-forwarded
to that exact shared head before pass-11 work began. The earlier provider-
capacity relaunch had regenerated then-current-renderer identity audits for
soprano, bass and mezzo but stopped after rendering tenor and before writing
its audit. Tenor was completed, after which shared advanced through Agent D's
bowed-preset activation at `f7aa81b`. That shared head was merged and every
authoritative comparator, T-067 audit, source audit, consonant audit and
identity audit was regenerated under `c40eb906eba5422b`; all four identity
audits are clean, repeat-stable and renderer-bound.

The pass-10 score artifacts were produced under renderer contract
`9b18b3bb7bfc75eb`. They were not relabelled. Legacy, incumbent and candidate
comparators were all regenerated under `c40eb906eba5422b` before leaderboard
selection.

## Cumulative source-refinement repair

The first pass-11 attempt found two pass-boundary defects before any candidate
was scored:

1. Renderer-suffix quarantine renamed run directories while each audition
   manifest still named its original FIT-render paths. The refiner now resolves
   the same render basename inside the supplied baseline run and records every
   rejected-row reason.
2. The refiner rebuilt each candidate from the pass-07 calibration rows. A
   second refinement could therefore discard the selected pass-10 correction.
   It now validates source identity/interpolation/dynamic semantics against the
   calibration but starts from the selected fit's cumulative surface.

A consuming regression test proves both relocation and cumulative behaviour.
The accepted refit analyses 30 tenor, 45 soprano, 37 bass and 42 mezzo rows;
all nine source cells per tenor/bass/mezzo and all seven soprano cells retain
multi-vowel evidence. The joint measured-hull law, one-source-per-singer
identity and all vowel bodies remain unchanged.

## Current-objective gate table

| Voice / entry | Composite | Construction | Strict cells | Body | Vowel | Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy | **3.683092** | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor incumbent | 3.784624 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor pass-11 | 3.757564 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Soprano legacy | 4.464865 | FAIL 9/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano incumbent | 4.108071 | **PASS 10/10** | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano pass-11 | **4.101409** | **PASS 10/10** | FAIL 0 / 27 / 1 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Bass legacy | **3.436373** | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass incumbent | 3.452769 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass pass-11 | 3.437736 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Mezzo legacy | **3.733598** | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo incumbent | 3.748144 | **PASS 10/10** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo pass-11 | 3.743200 | **PASS 10/10** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |

Soprano high/p band balance remains missing evidence, not a fitted failure.
Legacy rows fail construction because the frozen craft preset does not satisfy
the evidence-earned pitch-synchronous breath assertion.

## Canonical selection evidence

| Voice | Composite incumbent → candidate | Partial residual | Log-mel residual | Band residual | Decision |
|---|---:|---:|---:|---:|---|
| Tenor | 3.784624 → **3.757564** | 5.802613 → **5.696848** | 3.144316 → **3.090797** | 3.560661 → **3.509181** | promote interim leader |
| Soprano | 4.108071 → **4.101409** | 6.329836 → **6.215647** | 3.590629 → **3.548350** | 4.311564 → **4.257172** | promote interim leader |
| Bass | 3.452769 → **3.437736** | 5.642421 → **5.393149** | 3.025524 → **2.890723** | 3.396596 → **3.287176** | promote interim leader |
| Mezzo | 3.748144 → **3.743200** | 4.893439 → **4.753695** | 3.352721 → **3.256049** | 3.955652 → **3.908621** | promote interim leader |

Attack changes are −0.013 dB-equivalent units for bass and +0.003–0.004 for
the other voices, below the improvement on the controlling partial tier. The
hierarchy therefore selects every candidate before consulting composite.

## T-067 room-screened breath consumption

Agent D's balanced-subset verdict remains consumable and unchanged: ten
lossless, room-screened rows per adult voice carry the objective; historical
room-like rows remain separately logged watch evidence and do not enter the
instrument parameters. The current-head engine audit passes at 21.315168 dB
above zero with octave-ratio error 0.0019484. Corpus medians remain 20.641544
dB tenor, 18.585184 soprano, 23.887340 bass and 20.754777 mezzo.

All four ordinary identity audits retain `pitch_sync_breath_db=1`, a
`voiceBreathSync` responder, stable repeats and zero uncontrolled weighted
features. Their SHA-256 values are tenor
`97376f1035c939867ee1a7d394e11908c756ec8f306903ffd140282995e3b62c`,
soprano `f0d0a3f58cf0656305fa2e9ecd3d509493befa846049d479aeb5f00a192f2d73`,
bass `98bf62e816b9dda41303e2b869ed6caab924dab768a84552a362a19ed64c4bd6`
and mezzo `52bd4ec08939d379fd1dd1e98da0b439b2da6f1b7ac4d0fd59713623315a7954`.

## Body/vowel and consonant enumeration

Fresh candidate auditions pass emitted-body consumption 10/10 and vowel
identity 10/10 for tenor, soprano, bass and mezzo. No body/vowel remainder is
left behind this pass; the next blocker is still the strict source/body
spectral residual.

All four adult voices already carry the five measured sung-adapted consonant
classes. Current output audits still pass activation and retain all five
weights. Audit SHA-256 values are tenor
`7d14f487f8c577d33ea2599ac50b0c0084be6f4fa6b44b5e678247b72a2d0336`,
soprano `79eda326ea2422b04f0c0e64e36d156799f95f1712633cc089845caf416c83c4`,
bass `6db10adfaa593b3821b2b0e189b518acfd7b5ab574acf95097abb76335ee6f38`
and mezzo `62b2cf2871a67cda962fc1e51127c15e5873ceae596344952430d09be7a31733`.
There is no remaining adult voice to extend and no cross-family value transfer.

## Prior, artifacts and pending mandate

All voices retain prior row `voice-soprano/mezzo/tenor/bass -> legacy vocal`,
tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`.

Pass snapshot internal SHA-256 is
`6425de7d20e4e8d5d96d6942af0f18b6d434e24ab736b77bb67629cbacd3558a`.
Controllability table internal SHA-256 is
`0ca06dc7d5edcbfa0b3d719a734cfa45253fdc2ae31226420df746ec0ca96f79`.
Final exchange source SHA-256 is
`790053bee941029e98e976b4d24e0447fbdeaa2075a3f644cbd3749e41281885`.
Leaderboard and `best.json` backstops are copied under
`sg2-data/state/voice-*`; candidate SHIP manifests contain fresh seeds and the
16-instrument listening page was rebuilt from the merged shared renderer head.

Flagged pending mandate: §2.5c differential fitting and the two-sided seeded
distribution gate must run immediately when deterministic identity first
passes the strict partial tier. Until then the three-valued verdict remains
`INCONCLUSIVE-MASKED`, never `FAIL-MISSING-DOF`, and no `humanRanges` delivery
is permitted.

## Verification and next work

The required landing suite passes:

- `npm test` — 11/11 pass
- `node scripts/verify_tone_model.mjs` — all tone-model v2 assertions pass
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` — pass
- `PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`
  — pass, `82ef39ee1d6d8d9d22feb768b9a6d673ba270a8ca8c771d2e5eead2c0148e253`

The limiting factor is now precisely bounded: every active source cell moves
the partial objective in the correct direction, but the remaining cross-vowel
all-row residual still exceeds 3 dB after two cumulative bounded corrections.
Continue the existing-cell refinement ladder, then separate pooled source
residual from vowel-specific sparse-body residual before proposing any new
law. No owner decision or final freeze is requested.
