# T-041–T-044 violin iteration report

Date: 2026-07-16

## Repeat-render quarantine decision

The authoritative T-041 audit was run on a checkout-isolated server:

- audit: `/private/tmp/sg2/campaigns/violin/audit-agentd-t041-isolated`;
- objective hash: `7c58c1ab437a5463`;
- manifest hash: `aa8a7073573ba923`;
- repeat threshold: 0.05 perceptual units;
- unstable features: none;
- largest repeat mean: 0.001503 (`onset_tilt_db_oct`);
- largest repeat peak: 0.005839 (`onset_tilt_db_oct`).

No violin feature is quarantined or zero-weighted. Inharmonicity remains
active under T-037.

An earlier non-isolated audit attached to port 8765 and reported
inharmonicity as unstable (0.141 mean / 0.845 peak). During the subsequent
optimizer pass, port ownership was observed in another custody worktree.
That partial run was interrupted and marked invalid. Because the isolated
rerun was stable by a wide margin, the non-isolated quarantine decision is
superseded rather than consumed.

## Iterations

| Run | Focus | Loss | Gates | Outcome |
|---|---|---:|---:|---|
| `agentd-t041-isolated-rebaseline` | full stable objective | 4.020718 | 42 | baseline |
| `agentd-t042-spectral-r2-isolated` | tilt, then transfer | 3.477058 | 40 | accepted; two B cells pass |
| `agentd-t043-spectral-r3-isolated` | material, spectral dynamics | 3.474247 | 40 | plateau; not leaderboard-significant |
| `agentd-t044-controls-r4-isolated` | resonance, then blare | **3.448324** | **40** | accepted score improvement |

The final loss is 14.2% below the isolated baseline. Gate count improves by
two. The accepted fit uses:

| Parameter | Baseline | Accepted |
|---|---:|---:|
| `partialTilt` | 0.0 | −0.387629 |
| `partialTransfer` | 0.1 | 0.819660 |
| `spectralResonanceAmount` | 1.0 | 0.778869 |

## Residual disposition

The 40 remaining failures are filed exactly as:

- 4 param-fixable: three inharmonicity cells and one evidenced vibrato cell;
- 29 engine/data-contract: 27 spectral/onset cells plus two construction
  gaps;
- 7 corpus/reference-role: six vibrato holes and one floor-only band hole.

See `VIOLIN_INTERIM_TRIAGE.md` for the consuming specs and ordered next pass.

## T-040 continuity

The seed continues to consume the densified measured body:

- A0: 301.1 Hz, +0.3137 log2;
- B1: 473.6 Hz, +0.4261 log2;
- split-half correlation: 0.894;
- reconstruction amount: 1.

Both body construction rows remain passing throughout the iterations.
