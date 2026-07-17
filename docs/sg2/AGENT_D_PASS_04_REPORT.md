# Agent D pass 04 — analysis and bowed

Date: 2026-07-17
Branch: `codex/sg2-d-analysis-r2`

## Outcome

Pass 04 retains `agentd-pass03-human-release-r5` as the violin leader. The
§0.6% escalation ladder was completed against the dominant release residual:
a fresh one-key audit was clean and repeat-stable, then 12 bounded
`releaseDamping` evaluations showed that every positive setting improved
ring time but made damping slope and raw release-floor agreement worse. No
non-comparable diagnostic row is promoted.

The pass lands the missing L17.5 bow-component envelope extractor and its
synthetic trust gate, builds a dense 60-note cello low-register body set, and
places a positive cello A0-region mode at 102.6 Hz. T-033 remains explicitly
queued to Agent A. The first empirical drift edge is retained as raw evidence
but quarantined from causal use after validation found scorer-tracking and
pseudo-replication artefacts.

## §3 gate table

No comparable violin or cello optimisation candidate is promoted this pass,
so the authoritative gate rows remain:

| Preset / row | Loss | Construction | Strict §3 | SHIP variation | Leaderboard |
|---|---:|---:|---:|---:|---:|
| Violin legacy baseline | 22.727603 | 14 PASS / 2 FAIL | 6 PASS / 13 FAIL | FAIL | mandatory baseline |
| Violin pass-03 r5 | **22.581497** | 15 PASS / 1 FAIL | 6 PASS / 13 FAIL | **PASS** | **retained leader** |
| Cello legacy baseline | 3.142243 | 15 PASS / 3 FAIL | 0 PASS / 20 FAIL | insufficient evidence | mandatory baseline |
| Cello pass-03 start | 2.768351 | 15 PASS / 3 FAIL | 0 PASS / 20 FAIL | insufficient evidence | withheld |

Violin r5 still beats its stable-objective legacy row by 0.146105 composite
units (0.643%). Its owner-side two-seed check independently verifies the
runtime Human path: +2.5 dB relative seed difference and onset noise at
-15.5 dB relative. The construction failure remains vibrato/body AM; the
resource gate and strict residuals remain red rather than being softened.

## Violin §2.5 escalation and 17-row release result

The fresh audit starts from the immutable r5 parameters and changes only
`releaseDamping`. It is clean, stable and consumes all 17 mechanically
eligible full-tail rows. The diagnostic objective deliberately weights only
features responsive to that control, so its absolute losses are not
leaderboard-comparable. Its decisive points are:

| `releaseDamping` | Diagnostic loss | Ring loss | Damping-slope loss | Release-noise loss |
|---:|---:|---:|---:|---:|
| 0.0000 (r5 bound) | **24.8345** | 8.8529 | **5.4383** | **13.9325** |
| 0.1000 | 28.4583 | 5.9235 | 6.5075 | 38.1114 |
| 0.1369 | 28.4162 | 5.1059 | 7.0414 | 38.1114 |
| 0.3820 | 29.5826 | 1.9059 | 17.1114 | 38.1114 |
| 0.6180 | 34.4374 | **0.7412** | 47.9834 | 38.1114 |

All 11 positive probes exhibit the same discontinuous release-noise penalty.
The shared scalar can shorten the rendered ring, but it cannot reproduce the
mixture of zero/short/long reference rings and the independent residual-noise
tail. This is the pass exit limiting factor: a register/dynamic release law
and T-064's independent bow-component release are required before another
meaningful search. The raw `release_noise_db` reference is also a recorded
tail/room floor, so it must not be interpreted as a pure physical bow-release
amplitude. r5 remains sacred and unchanged.

## L17.5 bow-component envelope

`bow_noise.py` now measures non-harmonic residual power per STFT frame after
an f0-comb separation. It fits lead, attack, peak timing/gain, settle, sustain
and eligible release independently of the harmonic ADSR. The synthetic gate
recovers a 45.333 ms lead from a 60 ms injection, +16 ms peak offset from
+20 ms, 72 ms settle, and 32 ms release; all declared checks pass.

The 57-note Iowa profile reports pooled values of 121.905 ms lead,
400.544 ms attack, +235.102 ms peak offset, 1.397 peak/sustain gain,
17.415 ms settle and 238.005 ms release across 16 measurable release rows.
Separate pp/mf/ff values remain in the profile. The engine does not yet
consume this independent envelope, so T-064 is filed to Agent A with five
named assertions; the present renderer's main-envelope bow-noise path is not
misreported as complete.

## Cello low-A0 anchor and matched-take plan

The T-040-style body set uses complementary Iowa chromatic runs on sulC
(MIDI 36–47) and sulG (43–50), at pp/mf/ff. It contributes 60 lossless body
references and 143 fundamental/partial points across 80–300 Hz: measured
coverage is 81.3–297.4 Hz with a maximum 9.2 Hz gap. The refit uses 2,211
body points, has split-half correlation 0.954, round-trip error 0.006 dB and
lowest fitted f0 65.8 Hz. Its first three modes are +0.4975 at 102.6 Hz,
-0.3514 at 130.5 Hz and +0.5264 at 210.8 Hz. The missing positive A0-region
anchor is therefore present; this is analysis evidence, not a new cello
leaderboard claim.

Matched-take acquisition remains the cello Human blocker. The plan is a
same-instrument, same-string, same-articulation, same-performance protocol
with at least two full-tail, duration-matched lossless takes per cell. The
minimum exact cells are low C2 sulC pp/ff, mid G3 sulD pp/ff and high E5 sulA
pp/ff. The existing F#2 mp duplicate is provisional low/mp evidence only.
Vibrato/non-vibrato pairs may calibrate vibrato-specific dimensions but not
general Human spread; adjacent-semitone proxies remain trend-removed
sensitivity evidence. Fit identity first, freeze it, then require the usual
double dissociation and two-sided seeded distribution gate.

## T-033 Agent A queue chase

The current generated profile hash is
`c1fc16842bb30bc38e6cd459315d690af93ea546ed87011f4449aba35d95e844`.
The live Agent A pass-04 status still records
`engine=pending-Agent-A (guitar and bowed contracts are ready for one-pass
consumption)` and `bowed=blocked-engine T-033`. No engine commit implementing
the five bowed assertions is visible. `BOWED_ENGINE_HANDOFFS.md` now asks for
the bowed and guitar consumers in the same selector pass while preserving
their different playability laws. Analysis storage, generator preservation
and no-cross-string pooling remain complete.

## Drift-matrix validation

The shared snapshot has 106 accepted steps, 16 significant asymmetric edges,
80 symmetric-coupling candidates and one theory disagreement. The first
promoted edge remains `inharmonicity_log_ratio ⊣ release_noise_db` at
18 forward versus 7 reverse events (`p=0.0432853`). It is not physical enough
for causal triage:

- 11/18 forward events are blown instruments, where a stiff-string
  inharmonicity feature is not an active physical control;
- 7 violin events repeat essentially the same calibration intervention over
  r1–r5, which is pseudo-replication rather than seven independent trials;
- most blown tail-floor movements are only 1e-6–1e-3 units against a default
  zero feature-specific repeat floor;
- the sole materially large event is one guitar transition, insufficient to
  establish a mechanism.

The validation verdict is scorer-tracking artefact. The raw edge stays in the
matrix for auditability but is quarantined from the working causal hierarchy.
T-065 requires active-feature admission, nonzero feature-specific repeat
floors and intervention-lineage deduplication before re-promotion.

## Leaderboard, backstop, hashes and exit state

Violin legacy row: `violin ← legacy violin`; row hash
`334debe975d7613fe7911ce903cadc533aacefd715aaf7d08ea4318c06aaa3b4`;
resolved parameter hash
`91e2efb81d45e60c455612a93ed9f5008906836f9c9d6c9b3af4008b3388ff01`.

Cello legacy row: `cello ← legacy cello`; row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`;
resolved parameter hash
`24c6e9ef416a53764219469fc5185106249266625afa8114f48b575d7cc2e8ef`.

The violin run/state leaderboards remain byte-identical with r5 marked
`shipEligible`, `beatsLegacyComposite` and variation-passed. No diagnostic
pass-04 row is added. The bow analysis artifact hash is
`a782348c2f13bb1f6a99671e6dae1721d5857a9e2ea55f2269b3540ba7e7db47`.

- Violin session outcome: `limiting-factor`; r5 retained, pending independent
  bow-component/release consumption and a less confounded tail-floor scorer.
- Cello session outcome: `evidence-improvement`; low A0 anchor landed, matched
  Human takes remain pending before optimisation resumes.
- T-033 remains pending Agent A; T-064 is a new engine handoff.
- Strict §3, resource and vibrato/body-AM obligations remain visible.
- OWNER DECISION NEEDED: none.

## Verification

Verification results are recorded after the merged pass-end rebuild.
