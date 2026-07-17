# SG2 sung campaign — pass 08 four-voice consonants and source-law activation guard

Date: 2026-07-17  
Owner: Agent E / sung lane  
Branch: `codex/sg2-e-sung-r2`  
Exit state: four-voice consonant output improvement landed; adult identity work is blocked on a corrected A-VOICE-05 consumer and T-067 analysis

## Outcome

The fitted LibriSpeech-adapted plosive, nasal and fricative classes now reach
the current soprano, tenor, bass and mezzo identities. Each voice was rendered
at a representative register against the same-seed vowel-only onset. Every
class is distinct, all five burst/VOT/F1/F2 perturbations clear the repeat floor,
and the unlicensed provenance case remains neutral within one 16-bit PCM step.
All four auxiliary onset objectives therefore carry the five earned weights.
They remain provisional spoken-to-sung adaptations and do not replace the
vowel-only identity leaderboard entries.

A-VOICE-05 did not land this pass. A consuming review of Agent A's uncommitted
draft found two failures against the pass-07 handoff: it rectangularly
extrapolates soprano's sparse joint log-f0 × velocity hull, and it multiplies
already dynamic-specific observed rows by generic `spectralDynamicAmount` a
second time. The emitter contract is now explicit about both points and a
hashed output-side source audit is ready. The current canonical renderer fails
that audit as `blocked-consumer-absent`; consequently no strict identity cell
was rerun or promoted from draft code.

T-067 remains analysis-side pending. Agent D's clean tip `c8a8fe8` contains no
`pitch_sync_breath_db` observable, synthetic residual-envelope round trip,
corpus measurement or responder audit. The existing A-VOICE-04 engine checks
are necessary but insufficient, so every fitted `voiceBreathSync` remains zero
and breath weight remains zero.

## Current-objective gate table

No identity objective changed. These generated rows remain authoritative; the
pass snapshot retains every incumbent/candidate row in addition to the legacy
and selected rows shown here.

| Preset / selected entry | Composite | Construction | Strict §3 cells | Emitted body | Vowel | §2.5c Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy | 4.289210 | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Tenor pass-05 leader retained | 4.191012 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano legacy | 4.955311 | PASS 10/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano pass-06 leader retained | 4.510623 | PASS 10/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Bass legacy | 4.155330 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Bass pass-06 leader retained | 4.147851 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo current-objective legacy | 4.079154 | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo pass-06 leader retained | 4.074528 | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |

Soprano's high/p sustained band row remains missing evidence, not a fitted
failure. Tenor, bass and mezzo construction each retain the neutral
pitch-synchronous-breath failure.

## Four-voice consonant output verification

| Voice | MIDI | Objective | Repeat floor | Class difference range | Perturbation range | Result |
|---|---:|---|---:|---:|---:|---|
| Soprano | 72 | `fc88944abf047e17` | -100.8222 dB | -39.8473…-33.8148 dB | -44.7826…-23.4920 dB | PASS |
| Tenor | 60 | `a0ca2bb1d0138c7e` | -98.1594 dB | -34.4325…-23.4919 dB | -37.6220…-23.5340 dB | PASS |
| Bass | 48 | `1612fe14e05fbde5` | -99.4831 dB | -32.8959…-28.6302 dB | -39.3148…-16.3184 dB | PASS |
| Mezzo | 67 | `0d2b9c4f92e0b3f8` | -99.6756 dB | -36.6137…-30.1469 dB | -41.0051…-16.4591 dB | PASS |

The activation surface is voice-scoped: each objective includes that voice's
incumbent hash even though all four correctly share the same licensed spoken
source, sung-adaptation policy and fitted gesture values. This is an onset
articulation surface, not cross-singer identity pooling.

## A-VOICE-05 activation review

The strengthened evidence hash is
`7caa2ca6bc9268d7aa4e622413bce706812d8a34dc966cfa6724475b9713db7f`.
Coverage remains tenor 9/9, soprano 7/7, bass 9/9 and mezzo 9/9, with the
2.16e-6 dB synthetic deconvolution round trip still passing. The two added
consumer requirements are:

1. interpolate on the joint measured log-f0 × velocity support and project to
   the nearest measured hull boundary outside it; never manufacture the
   missing corners of soprano's sparse hull;
2. because every row already contains observed source shape at its measured
   dynamic, suppress generic `spectralDynamicAmount` while a row is active.

The pre-landing canonical audit is intentionally red: renderer contract
`b25485d1f6004d2d`, audit
`1d919c8bd08c848f9769e052af2042715d2df5de57d192da0ae27938da605a82`,
with no partial, mel or band-balance responder. Once a corrected consumer
lands, this exact audit runs for all four voices before the hierarchy restarts
at partial → mel → attack → band balance.

## T-067 breath coordination

The read-only Agent D audit found no analysis implementation to consume. The
engine-only sync-zero identity, envelope-line, octave-tracking and body-route
proofs from `b5f91b7` remain incorporated, but they do not subtract harmonics
from a lossless reference or distinguish room residuals. Breath therefore
cannot yet earn weight. The live exchange records
`analysis=pending-unimplemented` and `sung=values-neutral-weight-zero`.

## §2.5c eligibility

All four primary-singer manifests retain 15 explicitly inventoried
humanisation-role rows, but no identity is eligible for differential fitting.
Every voice still fails every strict partial and mel aggregate cell, and three
voices also retain the breath construction mask. Under the three-valued
§2.5c.2 rule, running the double-dissociation fit now would be
`INCONCLUSIVE-MASKED`, so no `humanRanges` value is widened. The repeats remain
queued and run immediately when a corrected source law stabilises an identity's
upstream cells.

## Controllability, exchange and prior ledger

Pass snapshot SHA-256:
`4479d0cb7bb878c4901e7da938fcc89be1d9b4f9a9d476e16da0269d5806a2d6`.
Controllability table SHA-256:
`d35d4ce1d1b4297dcd7ef543049dd73f061da77d9a31f7efb91dd38d12283649`.
Exchange source SHA-256:
`b60a41310bce66d44f5d72116e439ee147503539159fb562073758861bcb2ae0`.

All four identities retain prior row
`voice-soprano/mezzo/tenor/bass -> legacy vocal`, tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`. FIT scoring remains deterministic and the listening page is
rebuilt in fresh-seed SHIP mode.

## Pass-end artifacts and exit

- `sg2-data/runs/sung-pass08/consonant-audit/voice-*/AUDIT.json` and rendered
  comparison sets
- `sg2-data/runs/sung-pass08/A_VOICE_05_EVIDENCE.json`
- `sg2-data/runs/sung-pass08/source-controllability-prelanding/voice-tenor/AUDIT.json`
- `sg2-data/runs/sung-pass08/PASS_END_GATE_SNAPSHOT.json`
- `sg2-data/runs/sung-pass08/CONTROLLABILITY_TABLE.json`
- `sg2-data/runs/sung-pass08/EXCHANGE_STATUS_START.json` and
  `EXCHANGE_STATUS.json`
- current objective leaderboards and `sg2-data/state/voice-*` backstops retained
  byte-for-byte without a draft-law regression

Verification is pending the final pass seal.

This pass ends in §2.5 state **(a)** for the auxiliary articulation surface: a
measurable, output-verified consonant capability now covers all four adult
voices. Adult identity fitting ends in state **(b)** with two named limiting
factors: corrected A-VOICE-05 engine consumption and T-067 analysis. No owner
decision is required.
