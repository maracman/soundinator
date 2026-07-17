# SG2 sung campaign — pass 07 first consonant onsets and A-VOICE-05 evidence

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-e-sung-r2`
Exit state: first consonant classes measurably reach tenor audio; strict identity cells remain A-VOICE-05-consumer-limited

## Outcome

A-VOICE-03 passed a fresh output-side controllability audit on the integrated
renderer. The provisional LibriSpeech-adapted plosive, nasal and fricative
classes were fitted to the tenor `/a/` incumbent and rendered against the
same-seed vowel-only onset. All three consonant outputs differ measurably from
the vowel-only output, every burst/VOT/transition perturbation clears the
repeat floor, and the unlicensed request remains neutral. The auxiliary onset
objective therefore moves its five weights from zero to 1.0. This does not
replace the vowel-only identity leaderboard entry and does not claim that
spoken-adapted values equal a licensed sung-consonant measurement.

A-VOICE-05 now has pinned source evidence for all available cells in all four
adult voices. The emitter subtracts the already-fitted fixed-Hz vowel body,
pools source residuals across vowels under one primary singer, and passes a
synthetic known-source + two-vowel-body round trip. The tables remain neutral
because the engine consumer is still pending; no partial, mel or band cell was
claimed from counterfactual evidence.

Breath remains neutral. T-067 gives Agent D the required lossless-reference,
synthetic-round-trip and rendered octave-pair contract for
`pitch_sync_breath_db`; no `voiceBreathSync` value or weight moved.

## Current-objective gate table

No identity candidate changed this pass, so these are the current generated
leaderboard gates, rechecked on the integrated head. Construction and strict
cells remain failures; the auxiliary consonant onset fit is reported
separately below and cannot hide them.

| Preset / entry | Composite | Construction | Strict §3 cells | Emitted body | Vowel | §2.5c Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy | 4.289210 | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Tenor pass-05 incumbent retained | 4.191012 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano legacy | 4.955311 | PASS 10/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano pass-06 leader retained | 4.510623 | PASS 10/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Bass legacy | 4.155330 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Bass pass-06 leader retained | 4.147851 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo current-objective legacy | 4.079154 | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo pass-06 leader retained | 4.074528 | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |

Soprano's missing row remains high-register sustained evidence. It was not
converted into a fitted failure or filled by interpolation.

## First consonant onset fit

Corpus: LibriSpeech dev-clean + LibriSpeech Alignments, CC BY 4.0, 48 rows per
class. These are the annex's spoken-fallback initialisers with durations and
VOT compressed for singing and the vowel anchored on beat.

| Class | Fitted tenor gesture |
|---|---|
| Plosive | alveolar voiceless; burst 3210.09 Hz × 23.8 ms; VOT 24.7 ms; F2 locus 1800 Hz; transition 52.5 ms; pre-beat 120 ms |
| Nasal | labial voiced; murmur 56 ms; zero 1000 Hz; F2 locus 1100 Hz; transition 52.5 ms; pre-beat 115.5 ms |
| Fricative | alveolar voiceless; frication 5566.57 Hz × 70 ms; F2 locus 1800 Hz; transition 52.5 ms; pre-beat 120 ms |

Output audit at MIDI 60, velocity 0.62, 24 kHz FIT mode:

| Output comparison | Relative PCM difference |
|---|---:|
| Plosive vs vowel-only | -34.1128 dB |
| Nasal vs vowel-only | -23.4919 dB |
| Fricative vs vowel-only | -34.4325 dB |
| Repeat noise floor | -95.0419 dB |

The five targeted perturbation effects are -37.1574 dB burst centre,
-37.6219 dB burst duration, -23.5341 dB VOT, -27.9659 dB F1-transition and
-37.1584 dB F2-transition relative difference. Each clears the required 6 dB
margin above the repeat floor. The provenance-gated unlicensed render remains
neutral within the renderer's one-16-bit-LSB determinism tolerance.

Audit objective hash: `33db98179f237a02`; audit SHA-256:
`b0f7f7e39b3623bcc338fbc74c6ca7c3c6138c9ffd67bc646f6cb2ab5537d635`;
renderer SHA-256:
`dae86a8fc19f34f896c7a61c1276a19c1f9da71fb0438b3fcc48bbf67795a32b`.

## A-VOICE-05 pinned evidence

| Voice / primary singer | Available cells emitted | Rectangular-hull caveat |
|---|---:|---|
| Tenor / male3 | 9/9 | complete 3 registers × 3 dynamics |
| Soprano / female1 | 7/7 | sparse high-register hull; high has only measured `p` anchor |
| Bass / male8 | 9/9 | complete 3 × 3 |
| Mezzo / female5 | 9/9 | complete 3 × 3 |

The synthetic round trip recovers the emitted source shape within
`2.16e-6 dB` maximum error against a `0.01 dB` tolerance. Evidence SHA-256:
`4dd80c25716c0054ab3c3cfa6866b8989c8bd438d36c45c6acfcec14fd1433ff`.
Tables interpolate only in log-f0 × velocity inside the measured hull and
clamp outside it. Values remain one-source-per-singer and never per-vowel.

## Controllability and prior ledger

| Objective | Hash / manifest | Result |
|---|---|---|
| Tenor identity | `b6d4a7fe678e2af3` / `3ce7106e74cde4b9` | clean; unchanged |
| Soprano identity | `fd6c4e9cf0facd4e` / `3ce7106e74cde4b9` | clean; unstable repeat watch zeroed |
| Bass identity | `ba8081c6e2063ac0` / `3ce7106e74cde4b9` | clean; unchanged |
| Mezzo identity | `570e3a53d5189bb3` / `3ce7106e74cde4b9` | clean; unchanged |
| Tenor consonant auxiliary objective | `33db98179f237a02` / fitted class surface | clean; five features earned weight |

All four identities retain prior row
`voice-soprano/mezzo/tenor/bass -> legacy vocal`, tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`. The tenor consonant calibration overlays only the selected
onset gesture on that fitted identity; it does not zero or replace legacy
craft.

## Pass-end artifacts

- `sg2-data/runs/sung-pass07/CONSONANT_CONTROLLABILITY_AUDIT.json`
- `sg2-data/runs/sung-pass07/consonant-audit/` including same-seed vowel-only,
  plosive, nasal and fricative WAVs plus listening manifest
- `sg2-data/runs/sung-pass07/A_VOICE_05_EVIDENCE.json`
- `sg2-data/runs/sung-pass07/EXCHANGE_STATUS.json`
- `sg2-data/runs/sung-pass07/PASS_END_GATE_SNAPSHOT.json`
- `sg2-data/runs/sung-pass07/CONTROLLABILITY_TABLE.json` (table SHA-256
  `dfb9555e9cfcfcc78bedfa8b96ce136338c98d62aba13fd1751920ad93df4a22`)
- checked-in consonant and source-table calibrations under
  `scripts/tone_match/calibrations/`
- current objective leaderboards and `sg2-data/state/voice-*` best/backstop
  copies retained without regression
- `sg2-data/listen.html` rebuilt in fresh-seed SHIP mode with the auxiliary
  consonant comparison clearly marked as not the identity leader

The required suite is green: `npm test`, `node scripts/verify_tone_model.mjs`,
full pytest, `node scripts/render_note.mjs --verify`, and `git diff --check`.

## Exit state and pending mandates

This pass ends in §2.5 state **(b)** for the adult identity fits: A-VOICE-05 is
the named limiting law, and its complete pinned evidence plus consuming
assertions are filed for Agent A. Until that consumer lands, the current
upstream partial failures remain authoritative and no downstream identity
candidate is promoted.

Pending mandates:

1. Agent A consumes A-VOICE-05, then Agent E reruns fresh partial → mel →
   attack → band cells and accepts only hierarchy-lawful improvements.
2. Agent D reviews/lands T-067 `pitch_sync_breath_db`; all breath values remain
   neutral until its real rendered observable and corpus measurement pass.
3. The consonant fit remains explicitly provisional spoken-adapted evidence;
   a licensed sung corpus supersedes its duration/VOT transforms when one is
   legally available.
4. L16 consonant envelope-anomaly classes remain neutral pending their own
   sung onset extraction and synthetic round trip.
5. §2.5c remains `not-run-identity-unstable`; no Human range is widened through
   masked deterministic residuals.

No owner decision is required.
