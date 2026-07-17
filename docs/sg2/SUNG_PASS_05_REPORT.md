# SG2 sung campaign — pass 05 classifier calibration, breath spec and bass start

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-e-sung-r2`
Exit state: calibrated vowel watch and canonical bass baseline landed; no section frozen

## Outcome

The raw-LPC vowel watch was measuring the wrong thing for the sparse additive
sung source. Its poles lock to individual harmonics, and at higher f0 the
estimator often returns no usable pair. The replacement watch is label-blind:
it measures the transfer of paired body-on/body-bypass FIT audio, compares it
with every installed vowel model, selects the closest model, and independently
checks that model's F1/F2 centres against the class-scaled annex regions. The
hard T-058 emitted-body assertion remains separate and cannot be overridden by
either watch.

Tenor and soprano both classify 10/10 under the calibrated method. The new m8
bass baseline classifies 8/10: `/a/` is correctly selected from all five models,
but its fitted F2 is 1023.755 Hz, just below the 1034 Hz bass annex floor, so
both low and mid `/a/` watch rows correctly fail. Raw LPC remains visible as a
diagnostic-only watch and scores 1/10 tenor, 3/10 soprano and 2/10 bass.

A render-domain source correction was attempted for tenor and soprano in the
required order: partial table, mel spectrum, measured attack/onset, then band
balance. It improves the scalar result, but neither identity closes a strict
aggregate cell; the deterministic source/body fits remain far above 1 dB.
The candidates therefore remain interim and §2.5c is not eligible.

## Current-objective gate table

Pass-04 numbers are not reused as comparison rows because the shared scorer
and release-eligibility reference contract advanced. Both legacy leaders were
re-rendered and rescored under the exact pass-05 objective and renderer hashes.
Selection is lexicographic: construction failures, strict failed/missing cells,
emitted-body rows, vowel rows, Human gate, then comparable composite.

| Preset / entry | Composite | Construction | Strict §3 | Emitted body | Vowel | Classifier watch | §2.5c Human | Overall |
|---|---:|---|---|---|---|---|---|---|
| Tenor current-objective legacy | 4.289210 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Tenor render-corrected candidate | 4.191012 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano current-objective legacy | 4.955311 | PASS 10/10 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Soprano render-corrected candidate | 4.536039 | PASS 10/10 | FAIL, 27 cells + 1 missing | PASS 10/10 | PASS 10/10 | PASS 10/10 | not run | **FAIL** |
| Mezzo pass-04 leader, carried | 4.079181 | FAIL 8/9 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | legacy watch unavailable | not run | **FAIL** |
| Bass m8 entry 1 | 4.155330 | FAIL 10/11 | FAIL, 36 cells | PASS 10/10 | PASS 10/10 | FAIL 8/10 | not run | **FAIL** |

The only tenor and bass construction failure is pitch-synchronous breath. The
soprano construction gate stays clean. No strict spectral aggregate cell passes
for tenor, soprano or bass; this is the pass limiter, not vowel plumbing. With
all higher-priority gate counts tied, the corrected tenor and soprano candidates
lead by reducing the comparable composite by 0.098198 and 0.419273 respectively.

## Source/body fits and bass m8

| Voice | Primary | Corpus refs | Spectral analysed | Reconstruction median / P95 | Vibrato analysed |
|---|---|---:|---:|---:|---:|
| Tenor | male3 | carried canonical manifest | 30/45 | 4.8419 / 18.6591 dB | 2/10 |
| Soprano | female1 | carried canonical manifest | 45/50 | 4.8293 / 16.3499 dB | 0/10 |
| Bass | male8 | 128 | 37/45 | 6.9179 / 20.3413 dB | 0/15 |

The bass campaign was rebuilt as the standard section `bass` identity rather
than the stale `contrabass` label. Its official VocalSet m8 manifest spans all
five vowels, low/mid/high, ff/mf/pp, and straddles the declared passaggio. This
is a canonical legacy-prior integration baseline, not a freeze.

The render correction pools reference-minus-real-render harmonic residuals,
removes note-level intercepts and applies 65% of the robust per-harmonic result
with a ±6 dB bound. Tenor's median absolute applied correction is 2.043260 dB;
soprano's is 0 dB with a 3.9 dB maximum. Corpus-measured ADSR and onset-noise
fields are pinned after the spectral step. Vowel bodies are unchanged, and
paired consumption remains 10/10.

## Pitch-synchronous breath handoff

`A-VOICE-04` and exchange item `T-061` file the blocking engine contract to
Agent A. `voiceBreathSync` is currently read only by `_renderBreath`, which
returns immediately for every Fourier/blow note; the canonical sung airflow is
actually emitted by `_renderBlowFloor`.

The required consumer modulates the one existing body-routed blow floor at the
instantaneous glottal rate and composes with ADSR, velocity, turbulence,
articulation and vowel body. Consuming assertions require exact neutral PCM at
zero, a ≥6 dB envelope line at f0 for sync 0.8, octave tracking within 2%, a
rendered `pitch_sync_breath_db` responder before weighting, and body colour
change without modulation-frequency change. Engine and analysis dispositions
remain pending; mezzo construction is explicitly blocked on this landing.

## Consonant activation audit

The licensed/adapted provisional table remains healthy: 48 plosive, 48 nasal
and 48 fricative observations, with spoken fields kept distinct from the annex
S31–S33 sung adaptation. All five consonant feature weights remain exactly
zero. None of the A-VOICE-03 schema keys, renderer consumers or headless
consuming assertions has landed, so the pass-05 activation audit is
`blocked-generator-consumer-absent`. A tenor onset fit was not run; doing so
would fit an inaudible control.

## Controllability and prior ledger

Fresh candidate audits consume renderer hash `cf173478fa0481d1`. The minimal
manifest hashes `partialTilt` (`a579e74e30d52b3b`) because the pass-04 full
matrix already showed it moves every currently positive-weight sung feature;
the fresh direct response matrix reconfirms that contract.

| Voice | Objective hash | Repeatability | Zeroed unstable watch | Clean |
|---|---|---|---|---|
| Tenor | `b6d4a7fe678e2af3` | stable | none | yes |
| Soprano | `fd6c4e9cf0facd4e` | watch zeroed | `inharmonicity_log_ratio` | yes |
| Bass | `bb1f5ca5bb748c98` | stable | none | yes |

All fits retain the pinned `vocal` prior at tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`. FIT scoring is deterministic. Candidate audition pages use
fresh SHIP seeds; current-objective legacy comparisons are explicitly
scoring-only and are not substituted into listening evidence.

## §2.5c eligibility

No identity stabilised. All deterministic reconstruction medians exceed the
1 dB source/body bar and every active voice still fails strict spectral cells;
tenor, mezzo and bass also lack the rendered pitch-synchronous breath consumer.
No `humanRanges` or seeded two-sided distribution claim was emitted. T-055
remains `adapted-not-run-identity-unstable`.

## Pass-end artifacts and exit

Objective-scoped leaderboards, selected `best.json` files, per-run
`RUN_REPORT.md` tables and `sg2-data/state/<instrument>/` backstops are present
for tenor, soprano and bass. `EXCHANGE_STATUS.json` is regenerated from the
append-only exchange with a bound source SHA-256. The listening page is rebuilt
from leaderboard `paramsByVowel`, so sung rows no longer fall back silently to
a generic vocal preset.

The final suite is green: all Python tests, 11 JavaScript suites, all tone-model
v2 assertions, and the headless render-note verification pass. `git diff
--check` is clean.

No owner decision is required. Next pass order is:

1. close at least one partial/mel strict aggregate cell before lower-priority
   attack and band-balance work;
2. consume A-VOICE-04 and re-run mezzo/tenor/bass construction;
3. bring bass `/a/` F2 inside its annex region without weakening the box;
4. activate consonant onset fitting only after A-VOICE-03 consumes and audits;
5. run §2.5c only when one deterministic identity passes its eligibility bars.
