# Blown reacquired-corpus rebaseline — 2026-07-17

## OWNER DECISION NEEDED

The durable corpus contains the primary Iowa references for all five blown
instruments, but it does not contain the expected alternate takes for flute,
clarinet, alto sax, or the trumpet low/high cells. Please either re-acquire
the 20 named alternates recorded in each campaign's `BUILD.json`, or approve a
new same-pitch/same-dynamic pairing source. Until then, the §2.5c.6
distributional gate is necessarily `insufficient-evidence` for those four
instruments and none may freeze.

## Scope and outcome

This pass rebuilt the five blown objectives deterministically from
`$SG2_DATA/samples`, reset their P5.2 baselines, activated the blown
`band_balance_db` weight, audited every fitted control, and ran one bounded
ship-mode wave from the required §2.4c legacy priors. The legacy row is
leaderboard entry 1 in every report. All candidates lowered their objective,
but none passed construction, tripwire, and distributional gates together.
No factory preset or parameter-ledger row was changed or frozen.

The preceding P5.2 losses in `IMPLEMENTATION.md` used the pre-incident frozen
reference manifests and are not comparable with this reacquired-corpus
objective. These reports are the new lineage baseline for the rebuilt
reference sets.

## Deterministic corpus rebuild

The builder resolves each explicit source filename from the durable sample
tree, records missing optional alternates instead of substituting material,
and declares reference roles. Iowa WAVs carry `spectral`, `onset`, and `floor`
roles; alternate MP3s carry `floor` only and therefore never enter noise-floor
extraction.

| Instrument | References | Matched floor groups | Missing alternates |
|---|---:|---:|---:|
| Flute | 6 | 0 | 6 |
| Clarinet | 6 | 0 | 6 |
| Alto sax | 6 | 0 | 6 |
| Trumpet | 6 | 0 | 2 |
| French horn | 12 | 6 | 0 |

The horn differential Human fit is retained as failed evidence: only 1 of 6
matched cells passes the identity/Human decomposition. The consumer therefore
does not write those ranges into `measured_profiles.json`.

## §2.4c prior and controllability evidence

Every audit is clean, has zero uncontrolled weighted features, and includes
the now-active band-balance feature. Trumpet's audit intentionally excludes
`excitationHuman`, because FIT-mode controls and SHIP-mode Human variation are
separate contracts.

| Instrument | Legacy row | Resolved parameter hash | Ship Human | Audit objective |
|---|---|---|---:|---|
| Flute | `flute ← legacy flute` | `704ba5bbca24f99a…` | 0.50 | `7448ca96ca4a6089` |
| Clarinet | `clarinet ← legacy clarinet` | `014b7999e44481cc…` | 0.35 | `6e76f47c038585ed` |
| Alto sax | `alto-sax ← legacy clarinet` | `dc1f40565e4ddd6a…` | 0.35 | `8c8cf3010c890702` |
| Trumpet | `trumpet ← legacy trumpet` | `3d1ab496eac94d71…` | 0.35 | `3c8b79559d1dd943` |
| French horn | `french-horn ← legacy trombone` | `aed8af1b92463a80…` | 0.35 | `b3b8b61dfa856a14` |

## Refit and §3 gate result

Run ID: `blown-reacquired-r1`. Each run used 17 evaluations, ship mode, four
fresh seeded variants, its explicit controllability manifest, and the active
band-balance weight.

| Instrument | Legacy loss | Best loss | Delta | Construction | Tripwires | §2.5c.6 | Largest failed octave balance |
|---|---:|---:|---:|---|---|---|---:|
| Flute | 3.5661 | 3.3363 | -0.2298 | FAIL (4) | FAIL (28) | insufficient evidence | 37.54 dB |
| Clarinet | 3.3236 | 3.1179 | -0.2057 | FAIL (5) | FAIL (22) | insufficient evidence | 24.67 dB |
| Alto sax | 3.6070 | 3.4872 | -0.1198 | FAIL (5) | FAIL (29) | insufficient evidence | 22.61 dB |
| Trumpet | 3.3171 | 3.2974 | -0.0197 | FAIL (4) | FAIL (30) | insufficient evidence | 18.63 dB |
| French horn | 2.9658 | 2.9392 | -0.0265 | FAIL (8) | FAIL (27) | FAIL | 23.90 dB |

The construction failures also scope-close the owner's open-ear concerns:

- Flute: air-jet breath law, body stability, band balance, and envelope peak.
- Clarinet: band balance/concentration plus soft-breath, turbulence, and
  body-coloured-air laws.
- Alto sax: band balance, three breath laws, and onset-spectrum law.
- Trumpet: band balance, envelope peak, dynamic articulation, and
  onset-spectrum law; this directly retains the forte-plosive work item.
- French horn: band balance, three breath laws, onset-spectrum law, and all
  three independent/soft/register onset laws.

## Exit state

All five sessions exit as `limiting-factor`, not `plateau` or `freeze`.
Durable summaries, listening pages, audition manifests, render artifacts, and
work-item backstops live under
`$SG2_DATA/runs/<instrument>/blown-reacquired-r1` and
`$SG2_DATA/state/<instrument>/`. The next pass should first restore valid
take-pair evidence, then fit the failing family laws under the same objective;
identity parameters must not be widened to absorb failed Human decomposition.
