# Agent D custody report — analysis lane and bowed campaign

Date: 2026-07-16  
Branch: `codex/sg2-agentd-analysis-custody`

## Predecessor review verdict

The inherited `agentb/analysis-lane` was reviewed from a detached worktree at
`642eefa` and was **not green at its submitted head**:

- `npm test`: pass.
- Python suite: 115 pass using the project-compatible runtime.
- render determinism: pass.
- `node scripts/verify_tone_model.mjs`: fail at
  `L6 every measured blown body reaches the effective profile unchanged`.

The failure is a consuming-side contract bug, not a stale assertion. The v3
flute fit intentionally emits an empty `resonances` list with
`resonancesFit.omittedReason = "unstable-air-jet-body"`, but the engine keeps
the old hand-authored flute body. An explicit evidence-backed omission must
mean **no fitted body**, never fallback. This is a T-007 failure.

## Integration decision

The analysis/scorer/assertion work through `b68d67f` is retained. The bulk
v3 profile-data commit `642eefa` is reverted by `b359f32` and remains
quarantined until an engine checkout consumes all three contracts:

1. explicit evidence-backed body omission;
2. `reconstructionAmount: 1` as the measured-body unity convention;
3. `lowestF0Hz` through the T-003 low-register neighbour-gain cap.

No bowed fit may claim the recalibrated profiles as its engine baseline until
the body round-trip assertion passes through the real render consumer.

## Infrastructure findings fixed during custody

The inherited optimizer did not consume either of the contracts its reports
claimed:

- `controllability.json` had no objective/manifest hashes and `iterate.py`
  did not validate it;
- the canonical §3 tripwire evaluator existed but `iterate.py` did not call
  it.

Agent D added hashed controllability contracts, mandatory optimizer-side
validation, strict per-bar/register/dynamic tripwire consumption, gate-aware
leaderboard ordering, tripwire/controllability tables in run reports, and a
separate `--repo-root` so analysis can render against Agent A's engine
worktree without crossing the `synth.js` ownership boundary.

## Current bowed dependencies

- T-003 low-register body granularity: pending engine consumption.
- T-024 neutral bow excitation defaults: present in Agent A's current engine
  branch for blown scoop isolation, but bow scratch/wander values remain
  neutral pending the bowed corpus fit.
- T-025 measured-profile contract: blocked by the explicit-empty-body,
  unity, and low-register consumer assertions above.
- Body AM under vibrato, vibrato delay/ramp/drift, bow onset wander/scratch,
  and per-string table selection remain zero-weight watch metrics until
  their generating engine controls land and a fresh controllability audit
  proves response.

## Corpus limitation

Cello has no true duplicate take-pairs. Its variability floor and any
humanisation range derived from it use adjacent-semitone proxies with the
register trend removed. This is weaker evidence and must remain named in
every cello report until duplicate takes are acquired.

## Interim violin baseline

The first controllable-now violin baseline was rendered against Agent A's
current engine commit `c4712c9`, using that checkout's provably consumed
profile/body version rather than the quarantined v3 rows.

- Objective hash: `7c58c1ab437a5463`.
- Free-manifest hash: `380ad9f8663e89d0`.
- Clean controllability audit: yes.
- Leaderboard reference-set ID: `d88da9cd4056732d`.
- Best interim loss: `4.278461`.
- Construction gate: fail (4 rows).
- Strict §3 gate: fail (42 aggregated bar/cell failures; 46 total gates).
- Reference-variability floor: above floor in five of six measured groups;
  the low/ff catalogue group is already at the take-to-take floor.
- Correct session exit: `limiting-factor` in
  `/private/tmp/sg2/violin/agentd-interim-v2-baseline-r3`.

The dominant numerical residual is the render-side inharmonicity estimate,
but the broad audible failures are more informative: partial-table distance,
mel distance, attack timing, and coarse band balance all miss across the
registers. These results prioritise the measured-body contract, bow onset,
body-AM, and per-string consumers; they are not a freeze candidate.

Detailed classification and consuming assertions are filed in
`docs/sg2/VIOLIN_INTERIM_TRIAGE.md` and exchange entries T-036…T-040.

## Shared-branch integration

The custody branch was merged into `codex/sg2-l4-l5-engine` at `95118d4`
after owner governance commit `bb8ef3f`. The only merge conflict was the
append-only parameter ledger; both histories were preserved. The final v3
bulk profile data remains intentionally reverted until T-032/T-035 pass.
