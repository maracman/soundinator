# Struck/plucked pass 19 — complete grand anatomy and identity consumers

Date: 2026-07-18

Scope: consume the 23-cell L18 grand damper surface in current presets; refit
grand under the complete L16 anomaly, L17 action, and L18 free-decay/damper
anatomy; close nylon's T-033 course-identity blocker; recover glockenspiel's
upper audible modes; and turn upright L17 acquisition step one into an
executable hub scout.

## Outcome

The owner's grand listening candidate now carries all four audible mechanisms:
one independent measured action component, six corrected onset-anomaly classes,
plateau-free held decay, and the 23 measured register × dynamic damper cells.
It is PCM-verified and selected by the listening-page backstop, but is not
identity-promoted: strict corpus, resource, and variation gates remain open.

The renderer now ends the measured piano action point envelope after its own
release instead of holding its last point until note-off. Preset activation
reports also distinguish excitation applicability from explicit activation;
an omitted required control is applicable-but-inactive and fails SHIP. Every
factory piano/strike preset therefore explicitly activates both action and
anomaly controls.

Nylon's pooled `spectralPartialMeans` shadow has been removed. T-033's measured
string 6/3/1 tables now select distinct partial spectra and B at equal pitch in
real PCM. Glockenspiel's bar-only audible ceiling is 20 kHz, while other
families retain 16 kHz; a target-aware narrowband output estimator recovers all
audible annex modes without weakening the 35-cent gate or allowing string B.

## Grand L16+L17+L18 refit

The regenerated seed contains 23 damper rows, one 41-point action envelope,
six anomaly classes, and explicit `pianoActionNoiseLevel = 1` and
`envelopeAnomalyLevel = 1`. It no longer emits a pooled partial array that can
shadow the measured source profile.

The twelve-control audit is CLEAN. Contract hashes are objective
`b7f33c47b9ef10aa`, manifest `1c34b599316848a3`, parameter manifest
`5d07f72db25c66d4`, renderer `b5d4708786f7ee51`, initial
`f188aedd983882ef`, and references `7ab732aa5a9ba227`. Repeatability is clean
after zero-weighting the unstable inharmonicity watch metric; no weighted
feature is uncontrolled.

The 24-evaluation hierarchy-first run is
`sg2-data/runs/grand-piano/pass19-full-anatomy-refit/`:

| Result | Baseline | Selected |
|---|---:|---:|
| Strict failures | 42 | 40 |
| Construction pass/fail | 9 / 3 | 10 / 2 |
| Tripwire pass/fail/N/A | — | 2 / 38 / 20 |
| Composite loss | 8.681222 | 8.562287 |
| Action/anomaly level | 1 / 1 | 1 / 1 |

The selected position is `0.2606302875`. A lower composite candidate at
8.553515 was rejected because it restored the 42nd strict failure. The run is
not promoted: construction and strict tripwires fail, the resource gate fails
at 39 oscillators versus the 1.25× allowance, and the SHIP variation gate is
`insufficient-evidence` because no same-pitch/same-dynamic group has two takes.

### Output anatomy gate

Durable report:
`sg2-data/state/grand-piano/complete-struck-ship-pass19.json`.

| Mechanism | Rendered evidence | Gate |
|---|---:|---|
| L17 action lead | peak difference 17.583 ms before harmonic t0; pre-onset difference RMS 0.004608 | PASS |
| L16 anomaly classes | anomaly-off onset difference RMS 0.177037 | PASS |
| L18 held free decay | −9.376 dB/s; plateau fraction 0.0; 23.498 dB hold drop | PASS |
| L18 fitted damper, pp / ff | +43.823 / +28.192 dB attenuation versus natural release | PASS |
| Damper boundary MIDI 89 / 90 | +43.088 / 0.00000029 dB | PASS |

The action activation audit additionally proves 41 non-flat independent points,
explicit preset activation, and a non-neutral level of one. The 150 ms
allocated pre-roll is placement capacity; the rendered component's strongest
pre-tone difference occurs 17.583 ms before harmonic onset.

Agent A's damper consumer state is complete for the available evidence. All
333 verified damped takes form 23 measured cells after matched-legato
subtraction; MIDI 90+ is explicitly undamped. The broadband corpus does not
identify differential modal damping, so `damperFrequencyExponent = 0` remains
`neutral-unidentified-zero-weight`. Treble-pp remains the sole absent cell.

## Nylon T-033 course identity

The campaign builder now treats `partialsByString` as the selected source
surface and removes stale `spectralPartialMeans` during seed/rebase. The real
guitar profile and sounded fingerprint have consuming assertions for three
independent course rows.

Output report:
`sg2-data/runs/guitar-nylon/pass19-course-identity/AUDIT.json`.

| Equal-pitch pair at MIDI 64 | Median normalized spectral difference |
|---|---:|
| string 6 ↔ string 3 | 12.717 dB |
| string 6 ↔ string 1 | 17.526 dB |
| string 3 ↔ string 1 | 4.891 dB |

All three PCM hashes differ. Their fitted B values are 8.65e−6, 7.532e−5,
and 1.6151e−4 respectively. The named “engine does not consume per-course
identity” blocker is resolved. Existing whole-instrument nylon tripwires remain
the pass-18 6 pass / 18 fail / 12 N/A until a fresh post-consumer fit is run;
this mechanism result does not claim identity promotion.

## Glockenspiel upper audible modes

Durable report:
`sg2-data/runs/glockenspiel/pass19-upper-audible/first-fit.json`, renderer hash
`6f67268daf246189`.

The audit distinguishes discovery from verification: corpus extraction searches
the complete physical offset range, while output verification estimates the
pinned annex line in a ±35-cent band and requires at least 3 dB local
prominence. Audible means target frequency ≤20 kHz/Nyquist and target level
≥−60 dB. The previously missed upper lines now recover at MIDI 79 mode 6
(error +0.109 cents), MIDI 96 mode 4 (+1.241 cents), and MIDI 103 mode 3
(−5.962 cents).

All audible ratio rows pass 35 cents. The median mode-1/mode-2 T60 ratio is
7.404, centre-strike mode-2 suppression passes at every anchor, the renderer
uses six modes, and B remains zero. The old generic identity row remains
unpromoted because it still has 21 strict failures and only one measured
dynamic.

## Upright L17 step one

The executable hub contract is
`sg2-data/analysis/struck-pass19/UPRIGHT_L17_STEP1_SCOUT.md`. Its primary scout
is BiVib v0.9.1, Zenodo record 2573232: a separately archived Yamaha
Disklavier upright recorded under one documented chain, every key at ten
velocities, 24-bit/96-kHz binaural WAV. Step one fetches and checksum-verifies
the Zenodo metadata, documentation, Kontakt map, and SuperCollider map before
authorizing the approximately 14.7 GB upright-only archive.

The six first audit cells are MIDI 36/60/84 × low/high velocity. Every cell
must retain at least 10 ms of true recorded room before the first broadband
action event. Trimming, denoising, lossy audio, digital silence padding, mixed
instrument identity, corrupt rows, and all grand transfer are hard rejects.
The existing 0/69 VSCO pre-roll result remains zero-weight for L17.

## Pass-end gates and state

| Preset | Construction / strict identity | Mechanism result | Leaderboard |
|---|---|---|---|
| Grand | FAIL 2 construction; tripwires 2/38/20 | complete L16+L17+L18 PCM PASS | unchanged; listening candidate only |
| Upright | stale FAIL; acquisition-blocked | step-one hub scout executable | unchanged |
| Nylon | previous tripwires 6/18/12 | T-033 equal-pitch PCM PASS | unchanged |
| Glockenspiel | previous generic strict failures 21 | all audible bar ratios PASS | unchanged |

No failed or insufficient candidate is described as shipped. The grand state
adds a separate complete-anatomy listening selector; the identity leaderboard
remains untouched.

## Verification

- Grand twelve-control current-renderer audit: CLEAN; no uncontrolled weighted feature.
- Grand complete-anatomy output audit: PASS, four/four gates.
- Nylon course output audit: PASS, four/four gates.
- Glockenspiel upper-audible first render: PASS, all bar-specific gates.
- `npm test`: PASS, 11/11.
- `node scripts/verify_tone_model.mjs`: PASS, all assertions.
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q`: PASS.
- `node scripts/render_note.mjs --verify`: PASS,
  `6a926308b886b7a583dd758a7a4a9a2d31ca7643fa3b6f1dece2bdac9985c7a1`.
- `git diff --check`: PASS.

