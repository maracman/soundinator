# Agent D pass 05 — analysis and bowed

Date: 2026-07-17  
Branch: `codex/sg2-d-analysis-r2`

## Outcome

Pass 05 lands the cello A0/T-033 identity campaign, completes the §2.5c
Human differential fit, and applies owner ruling F13 dimension by dimension.
The authoritative identity run improves 2.697633 → 2.514053 in 39 evaluations,
but exits `limiting-factor`: construction, strict §3, distribution and resource
gates remain red. No leaderboard promotion is claimed.

The crash left one coherent unfinished change-set. It passed the focused suite
after one stale test was corrected to the already-filed T-072 law: bowed
release metrics are watch-only without labelled bow-lift anchors. No crash work
was discarded. Shared head `fb63253` (including F13) was merged before the
recovery audit and all subsequent fitting/reporting.

## §3 gate table

| Cello row | Loss | Construction | Strict §3 | SHIP variation | Leaderboard |
|---|---:|---:|---:|---:|---:|
| Legacy baseline, current objective | 2.697633 | FAIL | FAIL | insufficient evidence | retained mandatory baseline |
| Pass-05 T-033/A0 candidate | 2.514053 | 16 PASS / 2 FAIL | 6 PASS / 20 FAIL / 10 N/A | insufficient evidence | not promoted |

The two construction failures are `cello.pp-noise-rise` and
`cello.vibrato-body-am`. All six measured inharmonicity cells pass. Partial
table, mel spectrum and attack fail in every register×dynamic cell; the two
measured low-register band-balance cells fail, and the remaining four lack
evidence. The identity view intentionally has no same-pitch duplicate groups,
so its SHIP distribution gate is `insufficient-evidence`, not PASS.

## Current-HEAD controllability before fitting

The recovery audit is
`campaigns/cello/audit-agentd-crash-recovery-e80cc69/controllability.json`.
It is clean, repeat-stable and has no uncontrolled weighted feature. Its hashes
are identical to the pre-crash authoritative audit, proving the completed r2
run remains comparable after merging current shared head:

| Contract | Hash |
|---|---|
| objective | `df19e42d56eae4e7` |
| renderer | `01a5621ff1bd1a11` |
| references | `a88a94217af673ca` |
| parameter manifest | `7adc49c61c35cd05` |
| initial preset | `f3af8be2373457b1` |

Release ring, release damping/floor, onset timing trajectory and vibrato
trajectory remain visible watch metrics. No fitting began before this audit.

## Cello identity fit and exit

The legacy row is exactly `cello ← legacy cello`, row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`,
resolved parameter hash
`f3af8be2373457b10b9a494c4c76c46c02a76823e8d5682a2b606e3efd56ba16`.
The candidate improves the composite by 0.183580, but its dominant residual is
centroid (9.32675 perceptual units), followed by the already named attack,
partial-table and nonharmonic-noise limitations.

The resource tripwire also fails: 36 oscillators, 504 automation events/note
and 0.0498 ms model work/note; oscillator and automation ratios are 1.80× and
2.52× their medians. Sensitivity was correctly skipped after the hard gates.
The mandatory legacy baseline was copied to
`state/cello/leaderboard.json`; the failing candidate was not. The limiting
factor and proposed next fix were appended to `state/cello/work-items.json`:
consume the measured bowed fixed-Hz envelope class and finish the cello Human
response audit without reactivating unanchored release-floor terms.

## §2.5c Human ranges and F13

The matched acquisition contributes six cells, 15 common-window takes and 12
pairs. These MP3 rows retain explicit duration, codec, session and unverified
string limitations and remain Human-only. F13 adds 47 lossless within-run
adjacent-note pairs across 11 source/dynamic/string groups. After removal of a
local linear register trend, those adjacent deltas are the primary per-note
width for eligible dimensions; repeat rows remain the double-dissociation
evidence and the fallback for duration-robust dimensions.

Nine of eleven candidate parameters qualify. Full-strength lossless-adjacent
p90 widths are 0.178956 bow-position fraction, 25.511678 dB onset scratch,
0.005400 attack-noise ratio, 58.014725 cents onset wander and 128.674117 ms
settle. Vibrato rate/depth/onset-delay use full-strength common-window repeat
evidence because those observables are duration-robust. Sustained bow-noise is
weaker evidence (10.996809 dB p90): its generic lossless adjacent residual was
confounded by harmonic subtraction and room floor, so L14—not an 81.7 dB
shortcut—owns future promotion. Vibrato ramp and rate drift remain weak and do
not qualify.

All 12 decompositions still fail and every matched identity take remains
outside the core bars, so the verdict remains `INCONCLUSIVE-MASKED`. The
dedicated hashed native-episode audit is clean and stable, but only four of
nine qualified adapters exceed the response threshold: bow position, sustained
bow noise, onset wander and onset settle. Vibrato rate/depth/delay, scratch and
attack-noise delivery remain non-functional at the tested Human step. This is
not evidence of a missing Human DOF and never widens identity.

## Exchange and owner status

- T-033: `engine=incorporated`; explicit bowed string identity is consumed.
- T-063: `bowed=incorporated`; the engine owns one zero-inflated note episode,
  and campaign SHIP rejects the retired second Python draw.
- T-072: fixed-Hz violin class measured; generic bowed consumer pending. L18
  remains blocked on labelled bow-lift evidence.
- T-073/F13: per-dimension evidence incorporated; cello distribution remains
  blocked by five non-responsive qualified adapters and the two-sided seeded
  spread gate.
- OWNER DECISION NEEDED: none.

## Verification

Final verification and listening-page rebuild are recorded in the pass-end
commit. The run-local listening page is
`runs/cello/agentd-pass05-t033-a0-globals-r2/listen-cello-agentd-pass05-t033-a0-globals-r2.html`;
the shared listening index is rebuilt from fresh seeds at pass end.
