# Violin interim baseline — residual triage

Date: 2026-07-16  
Run: `/private/tmp/sg2/violin/agentd-interim-v2-baseline-r3`  
Engine scored: `c4712c9`  
Reference objective: `d88da9cd4056732d`

This is a prioritisation baseline, not a freeze candidate. It used the
profile/body version the engine demonstrably consumed before the final v3
contract, with Human fixed at zero. The v3 profile rows remain quarantined
until T-032/T-035 pass through Agent A's consumer.

## Gate accounting

The reported 46 failures comprise:

| Source | Failures | Breakdown |
|---|---:|---|
| Construction checklist | 4 | measured body, low body cluster, pp noise rise, vibrato body-AM |
| Measured §3 bar/cells | 35 | partial 7, mel 7, attack 7, B 7, band balance 6, vibrato 1 |
| Strict evidence holes | 7 | vibrato 6 cells; band balance 1 floor-only cell |

Five of six take-pair groups remain above their reference-variability floor.
Low-register ff Philharmonia catalogue takes are already at the floor
(ratio 0.995), but the construction and §3 gates still fail, so this is not
a stopping-floor demonstration.

T-040 rebaseline update: `agentd-t040-densified-body-baseline-r2` closes the
measured-body and body-peak-cluster construction rows, reducing total gate
failures from 46 to 44. The 35 measured-cell failures and 7 evidence holes
are unchanged; parameter-first optimisation resumes from the unity-body run.

## Triage table

| Residual evidence | Classification | Next action / consuming assertion |
|---|---|---|
| `violin.measured-body` has no evidence in the run params | **Engine/data-contract gap** | T-032/T-035: effective auto body must consume the emitted measured-body decision, including explicit omission semantics and unity reconstruction. Construction assertion must inspect the effective consumer result, not merely a duplicated `bodyBands` param. |
| `violin.body-peak-cluster` failed; the prior v3 bands had no positive 250–310 Hz A0 or 420–600 Hz B1 and split-half correlation was 0.451 | **Resolved analysis/corpus gap** | T-040 densified 48 Iowa body-role notes. The refit emits A0 at 301.1 Hz (+0.3137), B1 at 473.6 Hz (+0.4261), and split-half correlation 0.894. A hard emission gate now prevents recurrence; see `T040_VIOLIN_BODY_REPORT.md`. |
| Partial-table failures in all 7 cells (typically 11–33 dB) | **Mixed: param-first, then engine/data** | After T-032 lands, optimise `spectralDynamicAmount`, `partialTilt`, `excitationPosition`, `spectralResonanceAmount`, and bounded `dynamicBlare`. Re-score the old best on the unchanged objective. Residual same-pitch/string errors then exercise T-033 per-string tables. |
| Mel failures in all 7 cells (8.6–31 dB) | **Mixed: body consumer + param-fixable** | T-032 unity body first; then the same spectral free set. A body-consumed mid note must improve mel loss materially versus the quarantined baseline before v3 is accepted. |
| Band-balance failures in all 6 measured primary cells (mean 9.6–40 dB; octave maximum 22–65 dB) | **Mixed: body consumer + param-fixable + per-string** | T-032 is the first dependency. Optimise the controllable spectral set. If high-register mean remains above 12 dB, T-033 becomes blocking rather than watch-only. |
| Attack-T90 fails in 7 cells; 17 individual failures, often 125–291 ms | **Analysis/seed gap, followed by engine onset gap** | T-038 separates slow note-envelope fitting from pre-Helmholtz lock-in, emits register anchors, and asserts the campaign seed consumes them. T-031 then supplies bow scratch plus period-scaled wander/settle content. |
| Inharmonicity fails in 7 cells with factors up to 15,000 although fitted register B is zero | **Scorer conditioning gap** | T-037 replaces factor distance near B=0 with a highest-reliable-mode cents tolerance and requires the known f0 anchor. This residual is not evidence for an engine B failure. |
| Vibrato fails only mid/pp where evidence exists; six other cells are strict-missing | **Param-fixable + corpus gap + engine trajectory gap** | Fit `vibratoProb`, `vibratoDepth`, and `vibratoRate` only against vibrato-role takes. T-036 prevents non-vibrato/floor rows from creating vibrato coverage obligations. Acquire missing register/dynamic vibrato evidence before freeze. T-030/T-029 remain engine gaps for trajectory and body AM. |
| `violin.pp-noise-rise` fails | **Engine gap** | T-039 enables the excitation-generic noise architecture for bow and proves the corpus-fitted soft/loud sign through rendered audio. |
| `violin.vibrato-body-am` fails | **Engine gap** | T-029: instantaneous-frequency body evaluation; median partial AM ≥3 dB on the synthetic vibrato assertion. |
| Mid/mezzo-piano band balance is strict-missing only because the duplicate floor takes are short | **Reference-role/gate bug** | T-036: floor-only rows inform variability but do not create strict spectral gate cells. |

## Ordered next pass

1. Land T-032/T-035 in Agent A's engine and run the end-to-end body
   round-trip assertion.
2. Re-score `agentd-interim-v2-baseline-r2` unchanged under the new engine;
   this is the mandatory new-engine baseline.
3. Land the analysis-side T-036/T-037/T-038/T-040 corrections and rebuild
   the reference objective if required. Any objective change gets a new hash
   and re-scores the prior best before optimisation.
4. Run the spectral free-parameter optimiser. Do not use it to absorb
   per-string, bow-noise, body-AM, or onset-trajectory gaps.
5. Promote T-033/T-039/T-029/T-030/T-031 according to the residuals that
   remain after the body consumer and scorer corrections.

Cello remains independently limited by having no true duplicate take-pairs;
its floor and humanisation calibration use adjacent-semitone proxies.
