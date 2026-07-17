# Agent D pass 08 report

Date: 2026-07-18  
Exit state: `limiting-factor` — the cello-owned body and residual construction
blockers are closed, the pinned L14 bow-noise component is installed and active,
and all applicable factory presets pass the SHIP activation assertion. The
remaining limiting factor is ordinary bowed identity: every matched take misses
one or more §3 core bars, so both locked §2.5c decompositions are masked.  
Legacy prior: `cello ← legacy cello`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, row hash
`a86e5a44b3b5b6443ea4ed7cc4a49bd6d827021e5854b31b6daaad6b3f00ff9b`,
resolved pass-08 parameter hash
`464fcf02b023eb8e78edcdc0926c577a1af7a8b9fcb4e76665d447175f79bf46`.

## Priority-zero preset/profile seam

The common bowed factory-preset constructor now supplies
`bowNoiseLevel: 1` whenever the preset selects the pinned violin or cello bow
profile, while an explicit preset value still wins. This activates the cello
component in exactly these six applicable presets:

1. `factory-sub-cello-natural`
2. `factory-sub-cello-moss`
3. `factory-sub-cello-grit`
4. `factory-sub-low-lantern`
5. `factory-patch-deep-walker`
6. `factory-patch-blue-lantern`

The tone verifier's exhaustive assertion now passes for every applicable
factory preset. Repair commit `f795b9e` was merged to shared as `f7aa81b`.
The verified cello SHIP candidate independently reports `bowNoise`, level 1,
effective level 1, a 92.88 ms pre-onset lead and an independent non-flat
envelope. Its activation audit is
`state/cello/pinned-component-activation-l17.json`, SHA-256
`a390631d365a5df556a85bc0ece0d96d60401ad6ee980557505862bbfa42bd96`.

## §2.5c violin and cello decomposition verdicts

The three-valued rule is applied literally: `PASS` requires the locked residual
bars to pass after Human removal; `FAIL-MISSING-DOF` additionally requires a
good ordinary per-take identity fit and functional consumers; otherwise the
only permitted result is `INCONCLUSIVE-MASKED`.

| Instrument | Pairs | Failed residual pairs | Identity near core bars | Qualified consumers | Verdict |
|---|---:|---:|---:|---:|---|
| violin | 10 | 10 | 0/14 takes | 7/7 functional | `INCONCLUSIVE-MASKED` |
| cello | 12 | 12 | 0/16 takes | 9/9 functional | `INCONCLUSIVE-MASKED` |

The render paths are fully functional and no take has an analysis failure, but
every take misses partial, log-mel or attack identity; several additionally
miss the B bar. Therefore renderer/identity misfit can explain the residuals.
The `FAIL-MISSING-DOF` prerequisite is false for both instruments, so **no DoF
spec is filed**. Filing one from these data would violate the three-valued
rule rather than complete it.

The installed decomposition contract is in `web/static/measured_profiles.json`
(SHA-256 `3a4033a25b8281f7953e68f5839892e39ccc7ef586b30a4a077e1cde95471755`).
Evidence contracts:

- violin ranges `c4a89d74416350efb8b79df292fafb9205e6b34b71cc8f8ab36fb6bfed6ec4b9`;
  identity audit `c2a2e605a4a198eb0ab8342ec71944e588c9b443805e4b6782342412626701ef`;
- cello ranges `642e91d8bf3207de28ef512c67bd1c1fe9cd40c9b193ca2bb861c968ac4433dc`;
  identity audit `125a2c240c9bbf5cf37ca56847aaf9e46493ad4a59e3f80d8540a67547be2846`;
- T-074 isolated consumer contract
  `4d287dbf67327b2a197c88162699927040dccf8ec83eea04996da3fa89df58ca`;
  violin aggregate audit
  `dbe25abaff33c53af1639fc01d4475d15d42026ae38fa423c38d5a9a2961a8a5`.

### Measured qualified Human distributions

Values are centre, observed min–max, median paired difference, p90 paired
difference, and calibrated draw half-range. They remain measured ranges even
though the decomposition verdict is masked.

| Violin dimension | Centre | Min–max | Pair median | Pair p90 | Draw half-range | Qualified pairs |
|---|---:|---:|---:|---:|---:|---:|
| excitation position | 0.06775 | 0.0352–0.1919 | 0.06075 | 0.14400 | 0.101823 | 9/10 |
| vibrato rate (Hz) | 0 | 0–4.731638 | 0 | 0.056666 | 0.040069 | 1/10 |
| bow noise (dB) | -27.751744 | -34.9149–-22.72882 | 2.189232 | 5.171217 | 3.656602 | 9/10 |
| bow scratch (dB) | -19.412348 | -28.515058–-4.044352 | 5.721840 | 14.619187 | 10.337326 | 10/10 |
| attack-noise ratio | 0.026650 | 0.002875–0.185423 | 0.017487 | 0.133802 | 0.094612 | 6/10 |
| onset wander (cents) | 26.078911 | 3.192626–183.467890 | 21.664156 | 150.476978 | 106.403291 | 8/10 |
| wander settle (ms) | 70.691610 | 0–190.545351 | 14.965986 | 151.097506 | 106.842071 | 8/10 |

Violin vibrato depth, onset delay, ramp and rate drift do not qualify and stay
neutral/zero-weight.

| Cello dimension | Centre | Min–max | Pair median | Pair p90 | Draw half-range | Qualified pairs |
|---|---:|---:|---:|---:|---:|---:|
| excitation position | 0.072000 | 0.0303–0.2447 | 0.037867 | 0.178956 | 0.126541 | 12/12 |
| vibrato rate (Hz) | 0 | 0–5.793457 | 0 | 2.819824 | 1.993917 | 3/12 |
| vibrato depth (cents) | 0 | 0–15.264357 | 0 | 13.426888 | 9.494243 | 3/12 |
| vibrato onset delay (ms) | 0 | 0–46.439909 | 0 | 41.795918 | 29.554177 | 2/12 |
| bow noise (dB) | -33.228167 | -153.871448–-18.143892 | 3.544419 | 10.996809 | 7.775918 | 11/12 |
| bow scratch (dB) | -4.684178 | -27.258266–0 | 2.998025 | 25.511678 | 18.039481 | 8/12 |
| attack-noise ratio | 0.000682 | 0–0.065255 | 0.000325 | 0.005400 | 0.003818 | 7/12 |
| onset wander (cents) | 31.474778 | 3.784456–123.320329 | 17.509263 | 58.014725 | 41.022606 | 12/12 |
| wander settle (ms) | 131.836735 | 0–230.956916 | 61.578231 | 128.674117 | 90.986341 | 12/12 |

Cello vibrato ramp and rate drift do not qualify. Lossless adjacent pairs
supply grade A for note-local dimensions; matched duration-robust repeats
supply grade A for rate/depth/delay. Codec/window-sensitive noise dimensions
retain their declared grade B rather than being promoted.

## T-058 cello body resolution

The exact-source body-on/body-bypass audit now passes all six cells. Paired
ratios require both arms above -36 dB; this excludes comb-notch leakage but
does not change the 1 dB median-error, 0.9 correlation or four-common-harmonic
bars.

| Cell | Median transfer error (dB) | Correlation | Low-confidence ratios excluded | Verdict |
|---|---:|---:|---:|---|
| low/pp | 0.003876 | 0.999937 | 0 | PASS |
| low/ff | 0.113201 | 0.995904 | 0 | PASS |
| mid/pp | 0.010614 | 0.999991 | 1 | PASS |
| mid/ff | 0.518505 | 0.971735 | 1 | PASS |
| high/pp | 0.007476 | 0.999979 | 2 | PASS |
| high/ff | 0.314569 | 0.988386 | 1 | PASS |

Audit SHA-256:
`551e0f0d91279e8570b94e9171e236a5d6a9857af17a6a41e34e7bda0783120b`.

## `sulG/mf` and cello L14 resolution

The failing pool contained 25 segments from four source runs with counts
11/6/4/4. Legacy note weighting gave 3.607 dB median shape error; the
unbalanced per-note diagnostic gave 2.941 dB. Median-within-run followed by an
equal-weight cross-run median gives 1.781 dB and 0.9467 correlation. The four
run-to-balanced errors are 1.421, 2.614, 1.926 and 1.636 dB. No source run or
note is deleted, contamination evidence is false, and the 3 dB bar is
unchanged. This is an unequal segmentation-count weighting correction.

All 12 string×dynamic pools now pass. The accepted cello-owned profile uses
206 lossless Iowa notes (pp/mf/ff = 66/67/73), is
`accepted-pinned-component`, `profilePinned=true`, and
`activationEligible=true`. Its pp/mf/ff noise powers are
-57.267/-52.278/-40.989 dB, NHR values are -24.135/-27.582/-21.753 dB, and
the measured velocity exponent is 1.0685. Dynamic-shape pp–mf, pp–ff and mf–ff
correlations are 0.9901, 0.9544 and 0.9550.

Artifact SHA-256:
`39ecf42c8b3dc87b80fbc834100a45b6388ba1c44c52abf654ffa99cd15f24c9`.
The generalizable aggregation rule is appended as T-076.

## Pass-end gates, controllability and state

The current-profile cello audit is CLEAN/STABLE with objective
`e5a56c534363c4fc`, manifest `a579e74e30d52b3b`, renderer
`c40eb906eba5422b`, no uncontrolled weighted feature, and SHA-256
`7c2762d5f0e3559fb8bc8a8516667d890f43013aaec55d695fc39ccd9d8954f2`.

| Preset/row | Pinned activation | Construction | Strict §3 | Distribution | Leaderboard |
|---|---|---|---|---|---|
| persisted legacy cello + pass-08 pinned activation | PASS | FAIL 16/18 | FAIL: 6 pass, 20 fail, 100 N/A | insufficient evidence | unchanged; loss 2.833292 |
| `factory-sub-cello-natural` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| `factory-sub-cello-moss` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| `factory-sub-cello-grit` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| `factory-sub-low-lantern` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| `factory-patch-deep-walker` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| `factory-patch-blue-lantern` | PASS | profile/body evidence PASS | not independently scored | factory preset | not a fit row |
| T-058 exact body audit | N/A | PASS 6/6 | evidence row | N/A | not a fit row |
| cello L14 pinned profile | PASS | PASS 12/12 pools | component evidence row | N/A | installed, not identity promotion |

The zero-budget seal is
`runs/cello/agentd-pass08-gates/summary.json`, SHA-256
`94b21cd1b0f71245a7f1f156f6dabf3d5bd12726c593f090c3afb7f4ed801406`.
The two remaining construction failures are onset lock-in (19.953 periods vs
18) and vibrato body AM. Resource limits also fail at 38 oscillators and 532
automation events per note versus factory medians 20 and 200. Model math stays
under 4 ms. The run cannot form a same-pitch/same-dynamic measured take-pair
group, so its five-seed two-sided SHIP variation verdict is honestly
`insufficient-evidence`. No leaderboard promotion occurs. The leaderboard and
`state/cello/leaderboard.json` backstop were refreshed.

Live exchange state is generated at
`state/agent-d-pass08-exchange-statuses.json`: 79 entries, source SHA-256
`7cba59020eea4353b725e6ffcb6d994a5ee23484be1e26356e5436ac9a16f1d0`,
artifact SHA-256
`613b0f501b435a659c73aee3c79950fc339a53928c38f1d3768476fc3e0333ab`.

## Pass-end deliverables and mandates

The owner listening page is rebuilt from merged shared head with fresh seeds.
Its cello row resolves the verified active pinned-component SHIP candidate,
not the older neutral leaderboard row.

Pending mandates:

1. Refit cello string/register/dynamic partial identity and attack surfaces,
   then rerun the locked §2.5c decomposition.
2. Refit violin per-take partial/log-mel/attack identity before interpreting
   its locked residuals.
3. Keep both verdicts `INCONCLUSIVE-MASKED`; do not file a missing-DoF spec or
   widen Human ranges unless ordinary identity first passes.
4. Address cello onset lock-in, vibrato body AM and resource tripwires before
   any identity leaderboard promotion.

OWNER DECISION NEEDED: none.
