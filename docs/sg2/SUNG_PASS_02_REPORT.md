# SG2 sung campaign — pass 02

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-sung-pass02`
Exit state: §2.5(a), measurable same-objective improvement frozen

## Outcome

Owner decision 12 is now the target contract: **soprano, mezzo-soprano,
tenor, bass** are the four corpus-fitted section identities. Basso profondo and
boy soprano are morphology-derived, quantitative-tripwire-exempt presets built
only after their adult source sections pass.

The tenor continued on the unchanged m3 objective. A bounded per-vowel body
gain sweep reduced mean composite distance from `4.188353` to `3.904919`
(6.77%) with exactly the same 8 scored rows and 7 strict expected-f0 rejects.
No gate was lost or hidden. The §3 and vowel construction gates still fail, so
this is an improved interim baseline rather than a shippable preset.

## Decision-12 target registry

| Target | Identity source | Current state |
|---|---|---|
| Soprano | VocalSet corpus-labelled soprano, primary TBD | Await repaired `voice-soprano/`; select by coverage, clipping/SNR, straight/vibrato completeness, and annotated pitch lock before fitting |
| Mezzo-soprano | VocalSet f5 | 122-row reference set frozen; fit waits on the shared F1→f0 consumer |
| Tenor | VocalSet m3 | Pass-02 baseline frozen and audible |
| Bass | VocalSet m8 | 128-row evidence exists; the next repaired-library build will rename the fitted class from `contrabass` to `bass` before its first fit |

Secondary derivations are not fitted target rows:

| Derived preset | Source | Quantitative tripwires | Acceptance |
|---|---|---|---|
| Basso profondo | frozen fitted bass + downward f0/formant morphology | exempt | frozen transform provenance + capstone audition |
| Boy soprano | frozen fitted adult voices + upward formant/clean-source morphology | exempt | frozen transform provenance + capstone audition |

The sung builder now recognises `soprano`, `mezzo-soprano`, `tenor`, and
`bass` as first-class classes. Soprano's high-register R1 tuning reuses
A-VOICE-02 with separately fitted class values; no duplicate engine mechanism
was filed.

## Library repair / P5.2 check

The current tenor snapshot was compared to the pass-01 source-hash ledger:

- all 44 files that entered the objective are present and byte-identical;
- the other 6 m3 WAVs remain the same annotation-excluded optional scales;
- all 50 top-level m3 views resolve;
- the 116-row reference manifest and objective hash are therefore unchanged.

P5.2 re-baselining did **not** trigger for tenor. Soprano selection and any
bass/mezzo rebuild wait for the library-repair task's completed
`COVERAGE.md`/`PROVENANCE.json`; this does not interrupt the tenor loop.

## Tenor refinement

The pass-01 alternating fit left several body bands at the ±1.5-log2
(approximately ±9 dB) bound while the pooled source fell steeply. Pass 02
tested bounded body-gain scales with source identity frozen. Candidates that
added a QC reject could not outrank the baseline. The selected per-vowel scales
are:

| Vowel | Body-gain scale |
|---|---:|
| `/a/` | 1.0 |
| `/e/` | 1.0 |
| `/i/` | 2.0 |
| `/o/` | 3.0 |
| `/u/` | 2.5 |

The final scale is clipped to ±4 log2 in the emitted body contract. It is a
measured objective refinement, not a family-transferred value.

Frozen state:

- run: `sg2-data/runs/voice-tenor/pass02-final-body`
- objective hash: `df4be02ce7995b09`
- reference hash: `7ff982ea31d819c3`
- preset-bundle hash: `cad5d4be36b34a20`
- mean composite: `3.904919` (pass 01: `4.188353`)
- scored / rejected rows: `8 / 7` in both passes
- status: `interim-improvement-gates-failing`

## §3 gate table — fitted section targets

| Section | Partials ≤3 dB | Mel ≤4 dB | Attack tolerance | Vibrato | Construction | Human ranges | Overall |
|---|---|---|---|---|---|---|---|
| Soprano | FAIL (corpus pending) | FAIL | FAIL | FAIL | FAIL: identity not selected; F1→f0 consumer absent | FAIL | **FAIL / pending corpus** |
| Mezzo-soprano f5 | FAIL (not run) | FAIL | FAIL | FAIL | FAIL: high-register F1→f0 consumer absent | FAIL | **FAIL** |
| Tenor m3 | FAIL 0/8 | FAIL 0/8 | FAIL 0/8 | FAIL/watch | FAIL: vowel 0/10; source/body median 4.84 dB | FAIL | **FAIL, improved interim** |
| Bass m8 | FAIL (not run) | FAIL | FAIL | FAIL | FAIL: bass singer-formant centre consumer absent | FAIL | **FAIL** |

The derived basso-profondo and boy-soprano rows are intentionally absent from
this quantitative table. Their separate registry above records their exempt
status without implying a PASS.

## Controllability and resource watch

The pass-02 repeat-render audit is stable and clean only after the same required
zero-weighting as pass 01. Objective hash remains unchanged because references
and weights did not change; the new preset-bundle hash distinguishes the
candidate. Weighted features remain partials, log-mel, centroid, attack, noise,
sustain noise, onset tilt/noise, band balance, and LTAS rolloff. Body AM, decay,
inharmonicity, noise lead, scoop/wander/lock-in, and vibrato trajectory remain
zero-weight watches.

Audit limitation: the shared scalar audit samples the unchanged `/a/` baseline.
Structured per-vowel body responsiveness remains a filed D-VOICE-01 consumer
gap and is not represented as clean evidence by the scalar audit.

The full-fidelity bundle uses at most 43 post-cull oscillators over the
5-vowel × 3-register grid. It stays a WP-P watch because the shared custom
factory-relative benchmark consumer is absent.

## Remaining gates and handoffs

- Vowel classification remains 0/10. Stronger `/i o u/` bodies improve
  reference distance but do not make the shared LPC consumer reliably recover
  vowel identity.
- Fifteen of 45 spectral rows remain strict expected-f0 rejects and 23 of 30
  analysed rows required flagged literature formant priors.
- A-VOICE-01 now names fitted **bass**, with derived basso profondo inheriting
  it.
- A-VOICE-02 explicitly serves both mezzo and soprano with class-fitted values.
- D-VOICE-01 still owns shared formant/vowel consumers, per-vowel bundle
  iteration/listening, and structured controllability.
- T-053 records the fitted-section versus derived-morphology gate firewall.

## Listening checkpoint

The authoritative owner checkpoint is `sg2-data/listen-sung.html`: 15 labelled
m3 reference/render pairs grouped by `/a e i o u/` and low/mid/high register,
now using preset bundle `cad5d4be36b34a20`. The shared all-instrument page is
rebuilt separately but remains non-authoritative for voice until it consumes
the five-body bundle.
