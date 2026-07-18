# Struck/plucked pass 20 — source-class correction and gate-completeness audit

Date: 2026-07-18

Scope: resume the interrupted nylon/harp FIT-to-SHIP evaluation; correct the
measured-source excitation normalisation for plucked instruments; re-audit
glockenspiel's upper audible modes against its complete gate table; install
only the evidence-supported upright L16 anatomy; and close every pass-end
artifact without promoting a failing identity.

## Outcome

The pass does not freeze or promote a preset. Glockenspiel clears every
bar-specific assertion, including all audible upper modes within 35 cents,
but it is not the family's first gate-complete identity: generic construction
is 6 PASS / 1 FAIL because the corpus has only one measured dynamic, while the
current-renderer strict identity table is 3 PASS / 21 FAIL / 12 N/A. Its
§2.5c decomposition is therefore `INCONCLUSIVE-MASKED`; the reference floor
and two-sided §2.5c.6 SHIP distribution gate are both
`insufficient-evidence`. No freeze language is used.

The pass-20 nylon and harp runs completed all eight fresh-seed SHIP variants
for both the legacy baseline and fitted candidate. Neither candidate enters a
leaderboard. Nylon regresses its comparable baseline and still fails double
decay, all 18 active spectral tripwires, resources, and distributional
evidence. Harp improves deterministic loss by 0.044711 and passes construction
and resources, but retains 84 raw tripwire failures, two strict evidence
holes, and no matched-take distributional evidence.

## T-081 measured source-class correction

`SPECTRAL_PERFORMANCE.guitar` and `.harp` now identify `pluck` as the unity
excitation class. Their legacy piano prior still supplies the documented
position/hardness craft anchors, but no longer becomes the denominator of an
instrument-owned plucked source table. Piano, upright, and glockenspiel remain
`strike`.

The consuming assertion preserves guitar/harp position `0.12` and hardness
`0.62`. Nylon's same-MIDI course audit remains distinct after the correction:

| Equal-pitch pair at MIDI 64 | Median normalised difference |
|---|---:|
| string 6 ↔ string 3 | 21.824 dB |
| string 6 ↔ string 1 | 25.771 dB |
| string 3 ↔ string 1 | 6.777 dB |

All three PCM hashes differ and their fitted B values reach the sounded
fingerprint. Audit SHA-256:
`a3700d82dcd5bc2c1e7ef33f3563663a214b4ba44a14aeddbf7086220ba6c3f6`.

## Glockenspiel complete-table assessment

Current-renderer bar audit:
`sg2-data/runs/glockenspiel/pass20-upper-audible/audit/first-fit.json`.
Artifact SHA-256:
`19707764b41b138951e2695a592f3099e0bc7fbfd48af0c415c51960807b7b9b`.

| Gate family / row | Result | Evidence |
|---|:---:|---|
| Resonator class / B firewall | PASS | `bar`; B is exactly zero/ignored |
| Modes 2–3 vs fitted ratios | PASS | every scored row within ±35 cents |
| All upper audible modes | PASS | MIDI79/m6 +0.098c; MIDI96/m4 +1.237c; MIDI103/m3 −5.962c |
| Mode-1 / mode-2 T60 | PASS | median ratio 7.404, limit ≥5 |
| Centre-strike mode-2 dip | PASS | every measured anchor |
| Partial economy | PASS | six physical bar modes only |
| Held free decay | PASS | slopes −5.749 to −30.164 dB/s; plateau fraction 0 |
| Generic dynamic coverage | **FAIL** | one dynamic (`mf`), requirement ≥2 |
| Generic §3 identity | **FAIL** | raw 3 PASS / 21 FAIL / 12 N/A |
| Resource | not re-promoted | prior generic identity is already failing |
| §2.5c identity eligibility | **INCONCLUSIVE-MASKED** | generic identity fails upstream |
| §2.5c.6 seeded spread | **INSUFFICIENT-EVIDENCE** | no repeated pitch × dynamic group |

The generic failures comprise all six partial-table, all six mel, all six
band-balance, and three of six attack cells. Glock is therefore a complete
bar-mechanism implementation but not a gate-complete preset. The existing
leaderboard remains unchanged and its acquisition work item remains: add a
second documented dynamic plus repeats before velocity/Human calibration.

## Upright continuation: evidence-limited anatomy

The corrected upright L16 extraction installs 15 positive,
velocity-coupled anomaly classes. The PCM audit passes with anomaly-on/off
onset RMS difference `0.401918`, held slope `−7.429306 dB/s`, plateau
fraction zero, and 16.868 dB hold drop.

L17 and fitted damper rows remain absent by evidence, not omission:

- all 69 VSCO rows have less than 10 ms genuine pre-roll;
- the checksum-verified BiVib record-2573232 scout remains the next nine-cell
  acquisition path;
- six detected file-tail knees have negative modal exponents and fail the
  physical damper gate;
- no grand action or damper value transfers to upright.

State audit:
`sg2-data/state/piano-upright/evidence-limited-anatomy-pass20.json`, SHA-256
`312242fc255ea450cf0d07fc83c2b43d13ad20986e07f227e80476f4901b8343`.
This row is eligible for the listening page only as explicitly labelled
evidence-limited anatomy; it is not an identity or SHIP promotion.

## Nylon continuation and completed SHIP evaluation

Run: `sg2-data/runs/guitar-nylon/pass20-course-identity/`.

| Result | Baseline | Selected search row |
|---|---:|---:|
| Composite loss | 3.831134 | 4.222711 |
| Construction | — | 11 PASS / 1 FAIL |
| Tripwires | — | 6 PASS / 18 FAIL / 12 N/A |
| Resource | — | FAIL, 26 oscillators = 1.30× factory median |
| §2.5c.6 | insufficient | insufficient |
| SHIP variants | 8 | 8 |

The search row regresses and is rejected. `guitar.double-decay` remains the
construction failure; all partial, mel, and band-balance cells fail while all
six attack cells pass. The clean audit hashes are objective
`511f5ae6e87639cd`, manifest `340412ce5aa8a9ca`, renderer
`e3b66ebc1d93e94d`, reference `0cc4b7d62f50f5ae`, and initial
`3fed4ad7c40f95b5`. Repeat-unstable decay and inharmonicity remain zero-weight
watches. The filed limiting factor is sparse one-row-per-course evidence;
the next legal control surface requires at least two pitches × two dynamics
per nylon course.

Strongest prior: `guitar-nylon ← legacy piano craft adapted to pluck`, tag
`sg2-legacy` / `e8d3ac1`, resolved SHIP hash
`3fed4ad7c40f95b5755708bed96fdfc906f287052578184bf1a874a1ba352253`.

## Harp resumed FIT/SHIP evaluation

Run: `sg2-data/runs/harp/pass20-pluck-normalisation/`.

| Result | Baseline | Selected search row |
|---|---:|---:|
| Composite loss | 3.345067 | 3.300356 |
| Construction | — | 7 PASS / 0 FAIL |
| Raw tripwires | — | 24 PASS / 84 FAIL / 30 N/A |
| Strict evidence holes | — | 2 |
| Resource | — | PASS, 11 oscillators |
| §2.5c.6 | insufficient | insufficient |
| SHIP variants | 8 | 8 |

The deterministic improvement is real but cannot enter the leaderboard while
identity and two-sided spread gates fail. The clean audit hashes are objective
`df31a34dc6050501`, manifest `70e3f6676dc160d3`, renderer
`e3b66ebc1d93e94d`, reference `42cf5ed1bef65731`, and initial
`afe6064c35d04c56`. The filed limiting factor is sparse/imbalanced dynamic
coverage; acquire balanced repeated mp/mf/f anchors in all wire, gut, and
nylon zones before fitting a register × dynamic residual surface.

Strongest prior: `harp ← legacy piano craft, pluck defaults`, tag
`sg2-legacy` / `e8d3ac1`, resolved SHIP hash
`afe6064c35d04c5656fee09c5852dea4bbb40c810bf984fe8cfa6bbbe4ba7044`.

## Pass-end gate table and leaderboard state

Every row below is the latest applicable strict table; mechanism-only output
passes never replace an identity row.

| Preset | Construction | §3 identity | Resource | §2.5c / §2.5c.6 | Leaderboard |
|---|---|---|---|---|---|
| Grand piano | FAIL 2 (pass 19) | 2 PASS / 38 FAIL / 20 N/A | FAIL, 39 oscillators | INCONCLUSIVE-MASKED / insufficient | unchanged; complete-anatomy listen row only |
| Upright piano | stale identity FAIL 84 total gates | no fresh identity promotion | not re-promoted | INCONCLUSIVE-MASKED / insufficient | unchanged; evidence-limited anatomy listen row only |
| Steel guitar | corpus absent | not run | not run | not eligible | no leaderboard |
| Nylon guitar | 11 PASS / 1 FAIL | 6 / 18 / 12 | FAIL | INCONCLUSIVE-MASKED / insufficient | unchanged; candidate rejected |
| Harp | 7 PASS / 0 FAIL | 24 / 84 / 30; 2 holes | PASS | INCONCLUSIVE-MASKED / insufficient | unchanged; candidate not eligible |
| Glockenspiel | 6 PASS / 1 FAIL; bar rows 7/7 PASS | 3 / 21 / 12 | not re-promoted | INCONCLUSIVE-MASKED / insufficient | unchanged |

The live and `sg2-data/state/<instrument>/leaderboard.json` backstop files are
byte-identical for grand, upright, nylon, harp, and glockenspiel. No state is
created for absent-corpus steel guitar.

## Controllability and exchange deliverables

| Instrument / contract | Status | Objective | Renderer | Notes |
|---|:---:|---|---|---|
| Nylon pass 20 | CLEAN | `511f5ae6e87639cd` | `e3b66ebc1d93e94d` | decay/B repeat instability zero-weighted |
| Harp pass 20 | CLEAN | `df31a34dc6050501` | `e3b66ebc1d93e94d` | repeat-stable |
| Glock bar mechanism | PASS | `6671dcb6dd1ab276` | `65b849c7e0327941` | full bar-specific output table; generic identity fails |
| Upright anatomy | PASS | output-only | current checkout | L16 active; L17/damper evidence blocked |

Generated exchange snapshot:
`sg2-data/analysis/struck-pass20/exchange-statuses.json`; source SHA-256
`8c5a0a47bd11d1fe84f3fa1a833effe77abb14efb7b4b6c418059d4f39ec9f7f`,
84 parsed entries. T-081 is incorporated in struck/plucked; other lanes are
marked adapted because the method transfers but values never do.

## §2.5 exit state

This pass exits in named limiting-factor state, not convergence:

1. Glock: second documented dynamic plus matched repeats are required before
   velocity and Human gates can run; generic spectral/attack residuals remain.
2. Upright: fetch and audit the BiVib nine-cell pre-roll subset; existing
   files cannot identify L17 or physical damper contact.
3. Nylon: acquire at least two pitches × two dynamics per course before a
   course surface can replace global controls.
4. Harp: balance/repeat dynamics across all three material zones.
5. Steel guitar remains corpus-blocked.

No owner decision is pending. No mandate is silently deferred: §2.5c was
explicitly evaluated before the possible glock freeze claim and correctly
blocked by upstream identity plus missing repeat evidence.

## Verification

- `npm test`: PASS, 11/11.
- `node scripts/verify_tone_model.mjs`: PASS, including T-081 excitation
  unity/craft-anchor assertions and upright L16/L17/L18 firewall assertions.
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS.
- `node scripts/render_note.mjs --verify`: PASS,
  `0cec7b12c5cc573eca66cde58234cf21b1f11f83cd160c0d2bfff77d15f4d775`.
- `python3 scripts/gen_measured_profiles_module.py`: PASS, regenerated 17
  profiles from the checked JSON source.
- `python -m scripts.tone_match.install_struck_engine_handoffs --check`:
  PASS for grand and upright contracts.
- Upright final PCM output audit: PASS, four/four evidence/firewall gates.
- Nylon course output audit: PASS, four/four gates.
- Glock bar-specific current-renderer audit: PASS, seven/seven gates.
- Global `sg2-data/listen.html`: rebuilt at 2026-07-18 14:19, engine
  `79eaf6e`, 16 instruments, SHA-256
  `ad10b2357082a795de17c16e35dc0fa06912113148f928c1b68feba1fcd23c08`.
- `git diff --check`: PASS.
