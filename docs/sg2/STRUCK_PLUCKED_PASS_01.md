# Agent C struck/plucked pass 01 — reference + controllability preflight

Date: 2026-07-16  
Branch: `codex/sg2-struck-preflight-audit`  
Scope: grand piano and nylon-string acoustic guitar only; no fitting or preset freeze.

`RESEARCH_STRUCK_PLUCKED.md` landed late in the pass and was read in full;
its C1–C42/N1–N6 findings supersede the provisional beating/bar specs below.
The FAMILY FIREWALL is active: no
blown/bowed fitted value was transferred. No open owner L-note is currently
scoped to struck/plucked; L3/T-012 reference QC and L6's general consuming-side
body lesson were adapted as methods only.

## Gate table

| Gate | Grand piano | Nylon guitar | Evidence / action |
|---|:---:|:---:|---|
| Coverage contract present | PASS | PASS | `/private/tmp/sg2/samples/piano/COVERAGE.md`; `/private/tmp/sg2/samples/guitar/COVERAGE.md` |
| Reference registers × dynamics | PASS | PASS | 5 × pp/ff = 10; 3 × p/f = 6 |
| Reference pitch QC | FAIL | FAIL | Filename-known pitch is logged, but the free f0 tracker jumps modes/fails on many percussive notes; T-020 filed |
| S4.1 canonical P5 tripwire gate | FAIL | FAIL | `scripts/tone_match/tripwires.py` is not on this branch; wait for canonical T-009/T-013/T-017 landing |
| S4.2 controllability contract | FAIL | PASS | Grand `blocked-analysis` (89/132 contexts unanalysable); nylon `clean` (132/132) |
| G4 two-stage decay control | WATCH | PASS | Grand result untrusted until T-020; nylon amount and ratio both move `decay_log_ratio` |
| G7 velocity→hardness brightness | WATCH | WATCH | Grand result untrusted; nylon coupling moved only the B estimator, not a brightness feature; T-025 filed, weight 0 |
| T-003/T-004/T-014/T-018 body round-trip contract | FAIL | FAIL | Unity seeds emitted, but v3 reconstruction/low-F0 consuming assertions are not closed |
| Annex verdict available | PASS | PASS | Annex read; C1–C42/N1–N6 reconciled into exchange T-026–T-028 |
| Annex §7a decay-aligned scorer | FAIL | FAIL | Onset/early/late broken-stick features and tolerances are not yet in the canonical scorer |
| Annex §7b expanded construction gates | FAIL | FAIL | Pair, contact-time, decay-ratio and glock/harp assertions are not yet implemented |
| Eligible to fit | **NO** | **NO** | Fitting begins only after P5 + body/scorer/assertion contracts and a clean consumable audit |

## Controllability table

Threshold: mean movement ≥0.01 perceptual units or any probe ≥0.05, using a
10%-of-declared-range perturbation. Conditional neutral laws use manifest-only
`auditContext`; those values are not preset defaults.

| Instrument | Audit | Analysable contexts | Active loss features | Zero-weight watches | Contract |
|---|---|---:|---:|---:|---|
| Grand piano | `blocked-analysis` | 43/132 | 0 | 16 | `reference=92f88d204f44e5df`; `manifest=3a4c8fe4bb62bfbe` |
| Nylon guitar | `clean` | 132/132 | 10 | 4 | `reference=d94909426507bc92`; `manifest=3a4c8fe4bb62bfbe` |

Grand zero-weight watches: every otherwise-active score feature while T-020
is open, plus two-polarisation beating, damper release, sympathetic bloom,
decay-aligned band balance, and both G4 control effects. Nylon zero-weight
watches: two-polarisation beating, sympathetic bloom, decay-aligned band
balance, and velocity→hardness brightness.

The clean nylon report proves `excitationPosition`, contact/noise controls,
partial tilt/transfer, body amount, and both G4 parameters move at least one
appropriate scored feature. It does **not** authorise fitting while P5/body
gates remain open.

## Exchange status

| IDs | Struck/plucked disposition |
|---|---|
| T-001–T-008 | Incorporated/adapted under FAMILY FIREWALL; sustained-air and blown onset values remain neutral |
| T-009–T-010 | Adapt canonical gates; block body-weighted fitting until emitted reconstruction contracts close |
| T-011 | Rejected for this lane: G7 hardness, not blown articulation velocity, owns struck dynamics |
| T-012–T-014 | Incorporated: exclusions before hashes, strict bar×register×dynamic evidence, exact deconvolution mask |
| T-015–T-016 | Not applicable (open bore/flute prior) |
| T-017–T-019 | Strict per-bar coverage incorporated; blown migration N/A but v3 schema required here |
| T-020 | Filed: known-note anchored percussive f0 analysis |
| T-021 | Superseded after annex: cents-split oscillator proposal rejected |
| T-022 | Superseded after annex: one-dimensional bar spread rejected |
| T-023 | Engine landed upstream as `06f7455`; rebase/re-audit after integration; glock held-decay remains N5b |
| T-024 | Incorporated: hashed audit is a consuming fitter contract |
| T-025 | Filed: G7 needs an audio-side brightness assertion |
| T-026 | Filed: annex-aligned 0.1–3 Hz amplitude-domain beating law |
| T-027 | Filed: per-mode bar ratio trims; B forbidden for bar |
| T-028 | Filed: register/velocity contact-time low-pass for G7/N2 |

## Leaderboard state

| Instrument | Leaderboard | Best preset | Reason |
|---|---|---|---|
| Grand piano | not created | none | fitting correctly not started |
| Nylon guitar | not created | none | fitting correctly not started |

No best-so-far state was overwritten.

## Artifacts

- Grand campaign: `/private/tmp/sg2/campaigns/grand-piano/`
- Grand audit/report: `/private/tmp/sg2/grand-piano/audit-preflight-02/`
- Grand listen directory: `/private/tmp/sg2/grand-piano/audit-preflight-02/listen-controllability/`
- Nylon campaign: `/private/tmp/sg2/campaigns/guitar-nylon/`
- Nylon audit/report: `/private/tmp/sg2/guitar-nylon/audit-preflight-01/`
- Nylon listen directory: `/private/tmp/sg2/guitar-nylon/audit-preflight-01/listen-controllability/`

## Session outcome (§2.5)

Named limiting factors were filed rather than treating the preflight as a fit:

1. percussive f0 anchoring (T-020) blocks grand controllability and reliable B scoring;
2. P5 canonical tripwires are not merged (T-009/T-013/T-017);
3. measured-body round-trip/low-F0 contracts are open (T-010/T-014/T-018);
4. G7 lacks the required nylon brightness consequence and contact-time law (T-025/T-028);
5. polarisation, bar tuning and decay-aligned balance remain zero-weight watch metrics (T-026/T-027);
6. release damping landed upstream (`06f7455`) but is not yet integrated into this branch/audit;
7. annex §7a decay-aligned features and §7b expanded/cross-preset gates are not implemented.
