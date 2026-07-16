# Violin iteration residual triage

Date: 2026-07-16  
Authoritative baseline:
`/private/tmp/sg2/violin/agentd-t041-isolated-rebaseline`

Accepted best:
`/private/tmp/sg2/violin/agentd-t044-controls-r4-isolated`

Reference objective: `d88da9cd4056732d`

Controllability objective: `7c58c1ab437a5463`

The T-040 body fit is consumed and both body construction rows pass. T-037
and T-041 are active in the scorer. All authoritative renders used an
isolated server on port 8875; the earlier shared-port audit/run artifacts are
superseded and excluded.

## Iteration result

| Metric | Isolated baseline | Accepted best |
|---|---:|---:|
| Composite loss | 4.020718 | **3.448324** |
| Total gate failures | 42 | **40** |
| Construction failures | 2 | 2 |
| Measured §3 cell failures | 33 | **31** |
| Strict evidence holes | 7 | 7 |

The 14.2% loss reduction is real, but this is not a freeze candidate. Only
two hard thresholds crossed: inharmonicity at mid/pp and mid/mezzo-piano.
The accepted parameter changes are:

- `partialTilt = -0.387629`;
- `partialTransfer = 0.819660`;
- `spectralResonanceAmount = 0.778869`.

Material, spectral-dynamic, and blare searches produced no further gate
reduction. Five of six take-pair groups remain above their variability floor;
low/ff is below floor, but construction and strict tripwires still fail.

## Exact residual accounting

| Classification | Count | Evidence | Filed spec |
|---|---:|---|---|
| Param-fixable | 4 | Inharmonicity fails in low/pp, low/ff, mid/ff; vibrato fails in mid/pp. T-037 plus tilt already changed two B cells from fail to pass. The audit names controls for all four residuals. | Continue bounded one-control probes; vibrato must use vibrato-role references only. |
| Engine/data-contract gap | 29 | Partial table 7, mel 7, attack 7, band balance 6, plus `violin.pp-noise-rise` and `violin.vibrato-body-am`. Global spectral controls improved averages but plateaued without another cell crossing. | T-029, T-031, T-033, T-038, T-039, and T-043. |
| Corpus/reference-role gap | 7 | Six vibrato cells have no evidencing take; mid/mezzo-piano band balance is created by short floor-only rows. | T-036 and T-044. |
| **Total** | **40** |  |  |

## Decisions by residual

| Residual | Decision and rationale |
|---|---|
| Three remaining inharmonicity cells | **Param-fixable.** T-037 removed the near-zero ratio pathology and inharmonicity is no longer the dominant residual. The isolated audit is stable and names excitation position, tilt, transfer, dynamics, resonance, and vibrato controls as responders. Continue one-control probes; do not file an engine stiffness defect from the old ratio values. |
| Mid/pp vibrato failure | **Param-fixable.** `vibratoProb` is the audit's only direct responder. Fit it against declared vibrato-role takes after T-036/T-044, not against floor or non-vibrato rows. |
| Partial/mel/band failures in every measured cell | **Engine/data-contract gap after global-control plateau.** Tilt, transfer, material, dynamics, resonance, and blare were exercised. They reduced loss, but only tilt crossed gates and it did so on inharmonicity. The remaining cell-specific spectral errors promote per-string/register/dynamic table consumption from watch to blocking (T-033/T-043). |
| Attack failure in all seven cells | **Analysis + engine onset gap.** A slow whole-note envelope is not a bow lock-in measurement. T-038 must emit local attack anchors; T-031 consumes period-scaled scratch and wander/settle. Global spectral controls are not a valid substitute. |
| `violin.pp-noise-rise` | **Engine gap.** The accepted best still measures −6.75 dB against a required +2 dB soft-minus-loud sign. T-039 remains blocking. |
| `violin.vibrato-body-am` | **Engine gap.** The accepted best measures 0.133 dB against a required 3 dB. The audit finds no `body_am_db` responder, which directly supports T-029 rather than another parameter pass. |
| Six vibrato holes | **Corpus/role gap.** Add dedicated vibrato-role references from the existing Iowa/Philharmonia holdings and declare required coverage explicitly. |
| Mid/mezzo-piano band hole | **Reference-role bug.** Short floor duplicates inform variability only; they must not create a strict sustained-band obligation. |

## Ordered next pass

1. Land T-036/T-044 role-aware coverage and rebuild the reference objective.
2. Re-score the accepted best on that new objective before any fitting.
3. Run one-control probes for the three B cells and the evidenced vibrato
   cell.
4. Land T-038/T-031, T-039, and T-029 for onset, bow noise, and body-AM.
5. Implement T-033/T-043 per-string and register/dynamic spectral
   consumption, then rerun the partial/mel/band cells.

The T-040 corpus supports A0/B1, so no owner escalation is required for body
modes. The remaining blockers are now named implementation or evidence work,
not an undifferentiated optimizer plateau.
