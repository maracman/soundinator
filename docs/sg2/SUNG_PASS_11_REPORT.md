# SG2 sung campaign — pass 11 cumulative strict-cell refinement

Date: 2026-07-18  
Owner: Agent E / sung lane  
Branch: `codex/sg2-e-sung-r2`  
Exit state: §2.5 state **(a)** — four measurable current-objective improvements entered the durable leaderboards; none is ship-eligible

## Outcome

All four adult voices advance on the first unresolved spectral tier under the
current renderer contract `de30a803305d06c4`. Relative to freshly regenerated
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
bowed-preset activation at `f7aa81b`, then through Agent A's bounded blown-air
consumer at `1f24b79`. Both shared heads were merged. Every authoritative
comparator, T-067 audit, source audit, consonant audit and identity audit was
regenerated after the final advance under `de30a803305d06c4`; all four
identity audits are clean, repeat-stable and renderer-bound.

The pass-10 score artifacts were produced under renderer contract
`9b18b3bb7bfc75eb`. They were not relabelled. Legacy, incumbent and candidate
comparators were all regenerated under `de30a803305d06c4` before leaderboard
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
| Tenor legacy | **3.683254** | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor incumbent | 3.784623 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor pass-11 | 3.757606 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Soprano legacy | 4.464968 | FAIL 9/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano incumbent | 4.107657 | **PASS 10/10** | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano pass-11 | **4.101324** | **PASS 10/10** | FAIL 0 / 27 / 1 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Bass legacy | **3.436431** | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass incumbent | 3.452878 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass pass-11 | 3.437700 | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |
| Mezzo legacy | **3.733439** | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo incumbent | 3.747968 | **PASS 10/10** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo pass-11 | 3.743150 | **PASS 10/10** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL** |

Soprano high/p band balance remains missing evidence, not a fitted failure.
Legacy rows fail construction because the frozen craft preset does not satisfy
the evidence-earned pitch-synchronous breath assertion.

## Canonical selection evidence

| Voice | Composite incumbent → candidate | Partial residual | Log-mel residual | Band residual | Decision |
|---|---:|---:|---:|---:|---|
| Tenor | 3.784623 → **3.757606** | 5.802616 → **5.696844** | 3.144315 → **3.090789** | 3.560660 → **3.509172** | promote interim leader |
| Soprano | 4.107657 → **4.101324** | 6.329838 → **6.215642** | 3.590632 → **3.548389** | 4.311563 → **4.257179** | promote interim leader |
| Bass | 3.452878 → **3.437700** | 5.642416 → **5.393156** | 3.025516 → **2.890739** | 3.396587 → **3.287181** | promote interim leader |
| Mezzo | 3.747968 → **3.743150** | 4.893445 → **4.753692** | 3.352707 → **3.256055** | 3.955659 → **3.908626** | promote interim leader |

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
`530aaa5ad6893932d33c1bf232b69c478d56cae32d9eb3cce66d6c6433b62fca`,
soprano `971567bb30f0386dcf2ddbe655e0d7fc349ccf9f1ca0506f43a5cb6c8705fd74`,
bass `5a4902256ce9edb0ca77caa04805074928e02f091f58ca740d5de4714a9ccf33`
and mezzo `f244c15bba4249421d3730a46cb658235f450e815f8c290477418a8f97a159a1`.

## Body/vowel and consonant enumeration

Fresh candidate auditions pass emitted-body consumption 10/10 and vowel
identity 10/10 for tenor, soprano, bass and mezzo. No body/vowel remainder is
left behind this pass; the next blocker is still the strict source/body
spectral residual.

All four adult voices already carry the five measured sung-adapted consonant
classes. Current output audits still pass activation and retain all five
weights. Audit SHA-256 values are tenor
`31a7ebbe8b56e92cd859bf311abe8254737ca7686560e72eb563a095d94a8443`,
soprano `a23fbbb9b400072ee4ad8cac511b4d96ef7e5991632cbf51a30ed86f06b815da`,
bass `1b6fd0724cb8eee456ae914d489c30e793c79e967295b3f5c1c5599b259e7a3d`
and mezzo `d70bf4156e9e4141a57c742e3cf128ead2f45324f530b71001788d7a885a9c11`.
There is no remaining adult voice to extend and no cross-family value transfer.

## Prior, artifacts and pending mandate

All voices retain prior row `voice-soprano/mezzo/tenor/bass -> legacy vocal`,
tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`.

Pass snapshot internal SHA-256 is
`0ef31b26030e3c9d7d6ccc7829ac4083665b537771d283b461bb92a9b16dfca6`.
Controllability table internal SHA-256 is
`c6f3dee61617e7914b4e9bf43de2db2fd0e1109a09fedb0b95cd1be75a56c16b`.
Final exchange source SHA-256 is
`c9502750a0404f130375eccefa06795dc7919a06fabd09d770dc29ccab2cbe47`.
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
  — pass, `94b1c1f7013236fbd780a277c0c12cf27e035f1694d5dc413e3a385cc731c13e`

The limiting factor is now precisely bounded: every active source cell moves
the partial objective in the correct direction, but the remaining cross-vowel
all-row residual still exceeds 3 dB after two cumulative bounded corrections.
Continue the existing-cell refinement ladder, then separate pooled source
residual from vowel-specific sparse-body residual before proposing any new
law. No owner decision or final freeze is requested.
