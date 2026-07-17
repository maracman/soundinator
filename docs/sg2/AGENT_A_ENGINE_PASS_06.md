# SG2 Agent A — priority consumer pass 06

Date: 2026-07-17  
Lane: Agent A / engine + blown  
Consumer commit merged to shared: `fd40124`  
Exit state: **limiting-factor**, no ship or freeze claim

## Outcome

The three cross-lane engine blockers landed in requested order:

1. Grand piano now consumes L17's measured action-noise spectrum and literal
   pp/ff point envelopes, plus the corrected L16 harmonic-rank/fixed-Hz
   anomaly classes. Piano Foundation and the grand campaign preset activate
   both consumers at level one.
2. Glockenspiel now consumes fitted per-register bar ratio offsets and
   per-mode held T60, uses free-free beam strike-position shapes, and has a
   hard B firewall. The existing Metal Bar factory preset now resolves the
   measured glockenspiel profile with `resonatorClass=bar` and `partialB=0`.
3. Grand piano now consumes all 333 verified Zenph key-release takes as its
   L18 damper law. MIDI 90+ is a physical-undamped sentinel and retains
   natural string decay; no lower-note contact rate is extrapolated upward.

No upright point envelope was invented: its pre-roll evidence remains
insufficient. No glock or piano result is described as shipped.

## Engine and profile contracts

The new `install_struck_engine_handoffs.py` adapter validates the two piano
anatomy artifacts and the Zenph provenance before updating the canonical
measured profile. The generated browser module now preserves
`preOnsetComponents`, `envelopeAnomalyClasses`, the complete damper metadata,
bar ratio/T60 rows, optional strike weights and the handoff hashes.

L17 scheduling preserves every measured point rather than deriving an ADSR.
L16 adds onset-only gain automation and asymptotically rejoins the existing
held decay. L18 checks the undamped sentinel before note-off automation. For
bars, ratio rows affect only `resonatorClass=bar`, null T60 cells retain the
material-law fallback, and B is forced to zero before frequency scheduling.

## T-007 and preset activation

The headless consumer suite proves:

- every pp/ff piano action envelope retains at least 40 literal points, is
  independent and non-flat, and reaches the sounded-note fingerprint with a
  nonzero Piano Foundation control;
- corrected positive L16 rank/fixed-Hz assignments reach the piano profile,
  velocity changes their onset gain, level zero is exact-neutral, and the
  active factory preset emits automation without moving frequency;
- the damper evidence counts sum to 333, MIDI 87 remains damped, MIDI 90
  returns the undamped sentinel, and the piano preset carries the exact table;
- bar offsets are class-firewalled, B=0 and B>0 give identical modal
  frequencies, T60 interpolates in log-f0/log-T60 with null fallback, centre
  suppresses mode 2 by at least 6 dB, and the Metal Bar preset carries the
  measured ratio/T60 tables into all six sounded-note frequencies.

## Current controllability and gates

| Preset | Audit | Objective | Manifest | Renderer/result |
|---|:---:|---|---|---|
| Grand piano L16/L17 | CLEAN | `4a867d8f089f7e16` | `f564a2007ad0e9bf` | `010a6139859ef420` |
| Glockenspiel bar | CLEAN | `4d4f2dabe5197a86` | `497d68499b5c00ce` | B firewall and all three consumers available |
| Flute partial grind | CLEAN/STABLE | `d30648e15e6cc119` | `a579e74e30d52b3b` | no uncontrollable weighted feature |

The post-T-072 six-note glock render clears per-mode decay hierarchy
(mode-1/mode-2 median `7.404 >= 5`), centre-strike suppression, six-mode
economy and campaign/engine B firewalls. Eleven of twelve scored mode-2/3
ratio cells are within 35 cents. C7 mode 3 is measured at -47.3 dB and falls
below the rendered analyser's leakage floor, so the aggregate live-audio
ratio gate remains **FAIL**. Its oscillator scheduling is nevertheless exact
under T-007; the failing audio gate is retained rather than relabelled pass.

## Blown gate continuation

Flute resumed from the hierarchy-gated source surface under a fresh
`partialTilt`-only audit. Five bounded evaluations were completed. The lowest
composite observed was `3.715898` at tilt `0.042566`, but it retained 32 gate
failures. The upstream hierarchy selected the 31-failure row at tilt
`0.236068`, whose composite is worse at `3.828890` versus baseline
`3.738837`. Construction, strict tripwires and the two-sided SHIP variation
gate all remain failing, so no leaderboard entry was promoted.

The filed limiting factor remains
`upstream-band-balance-partial-cell-still-above-strict-bar`; the next work is
`clear-next-register-dynamic-partial-cell-without-reshaping-pinned-source`.
This run did not spend effort on downstream breath polish or mutate pinned
source evidence.

## Family gate table

| Gate | Grand piano | Glockenspiel | Flute continuation |
|---|:---:|:---:|:---:|
| Legacy prior present | PASS | PASS | PASS |
| Current controllability | PASS | PASS | PASS/STABLE |
| Requested engine consumer | PASS | PASS | n/a |
| Preset activation | PASS | PASS | PASS/current |
| Construction | not rerun | bar controls PASS | FAIL |
| Strict/live identity | open | FAIL 11/12 ratio cells | FAIL 3/23/49 |
| Distributional gate | insufficient | insufficient one dynamic | FAIL |
| Owner listening | OPEN | OPEN | OPEN |
| Leaderboard promoted | NO | NO | NO |

## Legacy-prior and state backstops

| Preset | Prior row | Resolved hash |
|---|---|---|
| Grand piano | `piano-grand <- legacy piano (true legacy)` | `523993362b2a1140803bf4dedbd81bc43b624719f88cbcf2580092c0ec840f30` |
| Glockenspiel | `glockenspiel <- legacy piano craft, strike defaults, bar class` | `aaa378d8ad31f7ceb8d13ef9f21d4dded8cac5906fc9d873dd3944b08800894e` |
| Flute | `flute <- legacy flute` | `b2efb135c5728a44955835f51cd1243c97959b653eb41c59600e41c231ec7fbf` |

Durable state is recorded in
`sg2-data/state/agent-a-pass06-summary.json`; the live generated exchange
snapshot is `agent-a-pass06-exchange-statuses.json` (source SHA-256
`3cf25ddf90431198…`, 77 entries). Flute's automatically filed work item and
run summary remain under `state/flute` and `runs/flute`.

## Listening and verification

The global owner page was rebuilt from engine `fd40124` for 16 instruments;
12 affected sections were freshly rendered. `listen.html` SHA-256 is
`5ca1029e4192f5c87c8fa6aa74382c6c30a65047a931b359bd5be513a9f5e4fa`.

- `npm test`: PASS, 11/11;
- `node scripts/verify_tone_model.mjs`: PASS;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS;
- `PYTHON=../../../.venv/bin/python node scripts/render_note.mjs --verify`:
  PASS, PCM SHA-256
  `3aa4245553a06243f24f60cf613e0c8dc941cd2c2600453ec3f86fb8391bc38c`;
- handoff source validation, JSON validation and `git diff --check`: PASS.

The priority consumer commit was merged once to the shared branch before the
blown continuation. No owner decision is required; the remaining work items
are bounded analysis/fit limits, not policy choices.
