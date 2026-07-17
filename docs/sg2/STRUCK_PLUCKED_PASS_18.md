# Struck/plucked pass 18 — damper surface, hierarchy triage, and consumer landing

Date: 2026-07-17

Scope: prepare and consume the T-069 piano anatomy adapter, T-072 bar controls,
and the L18 Zenph damper law; apply the strict residual hierarchy to nylon;
iterate only controls that were honest before T-072; and convert the exhausted
upright pre-roll audit into a concrete L17 acquisition plan.

## Outcome

All three engine consumers landed. T-069 preserves the measured piano action
point envelope and corrected L16 anomaly classes; its two-control grand-piano
response audit is clean. T-072 consumes pinned free-bar ratio offsets,
per-mode T60, free-free-beam strike position, and a hard bar/string-B firewall.
The integrated first bar render now passes the mode-1/mode-2 decay hierarchy,
centre-strike dip, six-mode economy, and B=0 gates. Upper audible-mode ratio
recovery still fails, so glockenspiel is not promoted.

The provisional L18 aggregation was corrected before pass end. The engine no
longer treats the register trend of broadband damper rates as a per-mode
frequency exponent, and it no longer fits raw staccato decay as contact alone.
It consumes 23 measured register x dynamic cells after subtracting each
take's velocity-matched OLPC legato baseline. The one absent cell is treble-pp;
MIDI 90 and above bypass damper contact entirely. The broadband corpus leaves
the modal exponent neutral and zero-weighted pending a per-mode differential
fit.

Nylon's 18 spectral failures remain a steady identity problem, not an onset
anomaly problem. The corrected L16 gate finds ten valid transient classes, but
all six middle-half partial cells fail while all six attack cells pass. The
criteria hierarchy therefore stops at the partial-table tier; whole-note mel
and band-balance results are downstream diagnostics only.

No preset is described as shipped or interim-shippable.

## L18 Zenph damper reference surface

The durable builder is `scripts/tone_match/damper_fit.py`; its pass artifact is
`sg2-data/analysis/struck-pass18/zenph-damper-reference.json`. Every admitted
row names both the staccato take and the velocity-matched legato sibling under
`downloads/olpc/extracted/yamahaGrandPiano44/`.

The fitted contact target is:

`abs(staccato post-knee dB/s) - 40 / matched-legato T40 seconds`.

This keeps the held string's L18 free decay and the note-off contact law
additive. Cell values below are median contact dB/s; parentheses give take
count.

| Register | pp | p | mf | f-ff |
|---|---:|---:|---:|---:|
| Sub-bass, MIDI 21-35 | 449.324 (22) | 317.800 (18) | 252.579 (16) | 201.067 (24) |
| Bass, 36-47 | 398.941 (25) | 311.798 (13) | 263.317 (11) | 204.217 (15) |
| Low-mid, 48-59 | 442.425 (22) | 363.770 (11) | 338.628 (9) | 293.121 (20) |
| Mid, 60-71 | 483.022 (22) | 425.120 (12) | 341.106 (9) | 260.161 (19) |
| High-mid, 72-83 | 471.678 (9) | 450.182 (9) | 317.252 (10) | 258.373 (19) |
| Treble, 84-89 | no evidence | 487.603 (4) | 453.571 (6) | 382.757 (8) |

Coverage is 333/333 admitted damped takes and 23/24 cells. Four corpus-derived
dynamic anchors are shared across registers: velocity 0.149606, 0.346457,
0.629921, and 0.937008. The consumer interpolates log-f0 within each dynamic
surface, then velocity between surfaces. Outside a surface it clamps to the
nearest measured boundary; it does not manufacture the missing treble-pp
corner. At MIDI 90 the result switches to natural free decay, not a clamped
MIDI-89 damper.

The engine-facing handoff is `sg2-piano-engine-handoffs-v2`, with reference
SHA-256 `69b869391d45c233da3f43182fcdaa95e0e8c3a0c5ea8593427162aedf3395f0`.
T-007 assertions cover all 333 takes, the 23-cell surface, velocity response,
neutral exponent, preset activation, and the MIDI-90 firewall.

The integrated T-069 grand response contract is clean with no uncontrolled
weighted feature: objective `4a867d8f089f7e16`, manifest
`d2195c508a024123`, parameter manifest `f564a2007ad0e9bf`, renderer
`d35cbe802578e938`, initial `b715bc41ddafb1bd`, and references
`2b006aeeab6c2d1c`. Repeatability is stable for weighted features; unstable
watch metrics remain zero. Both controls respond to partial, log-mel, attack,
and onset-noise observables; the anomaly control is the band-balance responder.

## Nylon: strict criteria hierarchy and L16 residual triage

The pass artifact is
`sg2-data/analysis/struck-pass18/nylon-spectral-triage.json`. It refuses to run
unless the corrected synthetic L16 gate passes: onset-only boost above the
mode's own extrapolated early law, excess early decay, and a positive velocity
slope.

| Criterion, in mandatory order | Pass | Fail | Interpretation |
|---|---:|---:|---|
| Partial table, middle half | 0 | 6 | first unresolved tier; steady course/register/dynamic identity is absent |
| Whole-note mel | 0 | 6 | masked downstream diagnostic |
| Attack T90 | 6 | 0 | onset timing already clears the bar |
| Sustained band balance | 0 | 6 | masked downstream diagnostic |

The 170 harmonic-envelope rows yield valid rank classes 15, 9, 8, 1, and 12.
The 204 fixed-band rows yield classes near 5079.68, 5701.75, 2850.88, 224.49,
and 1795.94 Hz. Every class has positive onset boost, positive excess decay,
positive velocity slope, and support in three notes. Guitar pick transients are
in protocol, so these rows remain valid nylon identity evidence for T-069.

They do not explain or waive the 18 spectral failures. L16 classes are
onset-only, whereas the first failing tier is measured from the note's middle
half. The next bounded identity control remains per-course register x dynamic
partial tables; T-028 contact time follows only after that steady tier is
consumed.

## Harp: current-profile pre-control iteration

The activated 23-note profile now has a clean and repeat-stable audit:

| Contract | Hash |
|---|---|
| Objective | `c4c30de091c3ed38` |
| Manifest | `70e3f6676dc160d3` |
| Parameter manifest | `d78275d50e816076` |
| Renderer | `095c293b83ebd244` |
| Initial preset | `a304a3e0589a4e8b` |
| References | `9d4cbe2d15c94c82` |

All weighted features have a responder. The seven-evaluation hierarchy-first
run moves only `excitationPosition`, from 0.12 to 0.2033437, reducing strict
failures 29 to 28 and loss 3.218117 to 3.217705 (0.013%). Tripwires remain
21 pass / 86 fail / 31 N/A. The lower-loss evaluation at 3.205961 is correctly
rejected because it restores the 29th strict failure.

The eight-variant audition and resource check completed; the resource gate
passes at 0.04793 ms/note, 11 oscillators, and 11 automation events. No
same-pitch/dynamic repeats exist, so both the distributional gate and reference
variability floor remain insufficient.

The old checklist incorrectly required harp and glockenspiel to classify as
sustained. Pass 18 corrects that construction law: L18 impulse-driven harp and
bar notes must classify as percussive. This does not rescue the harp candidate,
whose spectral tripwires remain far outside the gate. The filed limiting factor
is the anomalous 49 Hz attack row plus incomplete course-specific body/register
control; both require source-backed correction, not more global macro search.

## Glockenspiel: honest pre-T-072 iteration and integrated bar render

Before T-072, the only audited free controls were `excitationHardness`,
`attackNoiseLevel`, `attackNoiseDirect`, and `partialTilt`. Ratio, per-mode T60,
strike position, B, release damping, and the one-dynamic velocity slope were
excluded. The safe contract is clean and repeat-stable:

| Contract | Hash |
|---|---|
| Objective | `9c3d2ff1aaf661bb` |
| Manifest | `db484f5e2c485246` |
| Parameter manifest | `3f114ded87d1dbdc` |
| Renderer | `095c293b83ebd244` |
| Initial preset | `c3e035464b36225d` |
| References | `850758c1b2495d3f` |

Five evaluations move hardness 0.62 to 0.763932 and reduce loss 7.478093 to
7.442057 (0.48%), but leave 21 strict failures and tripwires 5 pass / 19 fail /
12 N/A. Resource use passes at 0.03894 ms/note, six oscillators, and six
automation events. No state or leaderboard row is promoted.

After T-072, the integrated first render passes the median mode-1/mode-2 T60
ratio at 7.404, the all-anchor centre-strike mode-2 dip, six-mode economy, and
B=0. The current shared-head renderer-files hash is `66b07f0af4e365d9`.
It still fails the 35-cent ratio gate in upper audible modes: mode 6 at
MIDI 79/84, mode 4 at MIDI 96, and mode 3 at MIDI 103. Those rows lie roughly
16.9-19 kHz and need a bandwidth-aware output estimator or corrected emitted
upper-mode level/selection; their failure is not permission to reintroduce B.

## Upright L17 plan after exhaustive pre-roll assessment

The durable audit is
`sg2-data/analysis/piano-anatomy/piano-upright-pre-roll-audit.json`. All 69
landed files were measured. Available pre-roll spans 0.000-6.984 ms, mean
2.545 ms; 0/69 meet the >=10 ms requirement. There is no honest subset.

The L17 plan is therefore:

1. Preserve the existing VSCO upright rows for spectral, B, body, and decay
   evidence only. They carry zero L17 action-noise weight.
2. Acquire lossless upright-piano takes with at least 10 ms of recorded room
   before the first broadband action event, covering at least three registers
   and two dynamics under one documented instrument/microphone identity.
3. Retain the true file start and do not onset-trim, denoise, or prepend digital
   silence. A silent pad does not recover missing mechanism audio.
4. Re-run the canonical L17 separator and require a positive pre-onset lead,
   independent non-flat point envelope, pinned spectral profile, and a fresh
   exact responder audit.
5. Activate an upright-only component. Grand action spectra, placement,
   envelope, and levels never transfer to upright.

No owner decision is needed; this is a bounded acquisition blocker.

## Family gate table

| Gate | Grand | Upright | Nylon | Harp | Glockenspiel |
|---|---|---|---|---|---|
| Legacy prior | PASS | PASS | PASS | PASS | PASS |
| Current controllability | T-069 clean | stale identity audit | post-L18 clean | pre-consumer clean | pre-T-072 safe clean; bar contract landed |
| L18 free decay | PASS | engine law | PASS | engine law | engine law |
| Damper/contact | 23/24 cells + MIDI-90 firewall | no upright transfer | N/A | N/A | free ring |
| Construction | latest old fit FAIL | FAIL | FAIL 11/12 | corrected impulse class; spectral fail | one-dynamic coverage fail |
| Spectral/identity tripwires | FAIL | FAIL | FAIL 6/18/12 | FAIL 21/86/31 | bar ratio FAIL; generic 5/19/12 |
| Resource | PASS | PASS | PASS | PASS | PASS |
| Distributional ship gate | INSUFFICIENT | INSUFFICIENT | INSUFFICIENT Human dimensions | INSUFFICIENT | INSUFFICIENT one dynamic |
| Owner listening | OPEN | OPEN | OPEN | OPEN | OPEN |
| Leaderboard updated | NO | NO | NO | NO | NO |

## Prior, leaderboard, state, and listening backstops

| Preset | Required prior row | Resolved hash |
|---|---|---|
| Grand piano | `piano-grand <- legacy piano (true legacy)` | `523993362b2a1140803bf4dedbd81bc43b624719f88cbcf2580092c0ec840f30` last ship |
| Upright piano | `piano-upright <- legacy piano craft; fitted upright identity` | `45f8b3247e07a86e0854b2dfcf8dbaa4ffcd5e418603a3bda14ac3443b616e7e` last ship |
| Nylon guitar | `guitar-nylon <- legacy piano craft adapted to pluck` | `3fed4ad7c40f95b5755708bed96fdfc906f287052578184bf1a874a1ba352253` current ship prior |
| Harp | `harp <- legacy piano craft, pluck defaults` | `a304a3e0589a4e8b706f18a570d93a769d02b876fad9b0ae3444c60a1443bffc` current ship prior |
| Glockenspiel | `glockenspiel <- legacy piano craft, strike defaults, bar class` | `c3e035464b36225d7bfed58874ae68bdf99773eada5596254be76d9d54aa52d2` current ship prior |

Harp and glock candidates do not lead their own baselines under the strict
gate ordering. Nylon remains numerically improved but gate-ineligible from
pass 17. Grand/upright have no fresh identity fit. Therefore no leaderboard or
state backstop is rewritten. The global listening page is rebuilt from the
unchanged eligible state plus the pass artifacts; failed diagnostics remain
available through their run-local audition pages.

## Exchange status and exit mandates

The live append-only exchange resolves as follows:

| Entry | Pass-18 status |
|---|---|
| T-067 held strike/pluck law | incorporated; impulse checklist corrected for harp/bar |
| T-068 piano pre-onset adapter | grand incorporated and response-audited; upright evidence blocked |
| T-069 corrected anomaly consumer | incorporated and response-audited; nylon values retained but cannot waive steady failures |
| T-072 bar modes | incorporated; decay/centre/B gates pass, upper audible-mode ratio recovery remains |
| L18 Zenph damper surface | incorporated v2; 333 takes, 23/24 cells, legato subtraction, neutral exponent, MIDI-90 bypass |
| T-059 criterion drift | hierarchy applied; no invalid downstream causal edge emitted |

Exit state is protocol §2.5(b), named limiting factors with filed fixes:

1. Grand: re-fit identity only under the clean T-069 contract; treble-pp
   damper contact and a modal frequency exponent remain explicit evidence
   holes, not inferred cells.
2. Upright: acquire genuine >=10 ms pre-roll under the five-step L17 plan.
3. Nylon: fit per-course register x dynamic steady partial identity, then
   reconsider T-028 and the retained onset anomaly classes.
4. Harp: repair/reacquire the 49 Hz attack row and fit course-specific body and
   register envelopes before another global macro pass.
5. Glockenspiel: diagnose upper audible-mode extraction/level recovery on the
   exact T-072 renderer; retain the B firewall and one-dynamic limitation.

## Verification

- Zenph damper-reference rebuild: PASS, 333 admitted takes, 23/24 cells.
- Handoff installer `--check`: PASS, schema
  `sg2-piano-engine-handoffs-v2`, reference SHA-256
  `69b869391d45c233da3f43182fcdaa95e0e8c3a0c5ea8593427162aedf3395f0`.
- Corrected L16 synthetic gate and nylon triage: PASS.
- Targeted damper/anatomy/bar/impulse-class tests: PASS.
- `npm test`: PASS, 11/11.
- `node scripts/verify_tone_model.mjs`: PASS, all tone-model v2 assertions.
- Full project Python suite: PASS, 256/256.
- `node scripts/render_note.mjs --verify`: PASS,
  `faf18ea5a17a9f4acc559f0179e9af55db717ae087dc8b775444c0ed0797c39f`.
- Current shared-head T-069 audit: clean, renderer contract
  `d35cbe802578e938`, no uncontrolled weighted feature.
- Current shared-head T-072 first render: expected residual FAIL only at the
  upper audible-mode ratio gate; renderer-files hash `66b07f0af4e365d9`.
- Global `sg2-data/listen.html` rebuild: PASS with fresh harp/glock renders.
- `git diff --check`: PASS.
