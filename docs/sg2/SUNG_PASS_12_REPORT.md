# SG2 sung campaign — pass 12 T-078 strict-cell triage

Date: 2026-07-18  
Owner: Agent E / sung lane  
Branch: `codex/sg2-e-sung-r2`  
Exit state: §2.5 state **(a)** — bass records a measurable hierarchy-first current-objective improvement; the other three bounded probes are rejected

## Outcome

Pass 12 re-synchronised from shared head `c7ae812` (including the audible
renderer changes through `34f14c7`), evaluated the shared T-078
post-source/post-independent-component octave residual on every adult sung
source cell, and added the missing one-source/many-body firewall. A residual is
now source-addressable only after it passes both three-block temporal stability
and cross-vowel recurrence (at least three vowels, cross-vowel MAD <= 2 dB,
sign agreement >= 2/3). The independent pitch-synchronous-breath synthetic
round trip passes at 0.241990 dB mean and 0.460304 dB maximum remaining
residual.

The audit classifies 16/34 cells fit-limited by an existing source row and
18/34 law-limited by absent cross-vowel recurrence:

| Voice | Fit-limited | Law-limited | Hierarchy-nearest bounded probe | Verdict |
|---|---:|---:|---|---|
| Tenor | 5/9 | 4/9 | high/pp | reject — partial tier 3.255731 -> 3.258117 |
| Bass | 5/9 | 4/9 | mid/mf | **promote** — partial tier 3.738466 -> 3.636217 |
| Mezzo | 3/9 | 6/9 | high/mf | reject — partial tier 2.490944 -> 2.493301 |
| Soprano | 3/7 | 4/7 | mid/pp | reject — partial tier 6.305639 -> 6.308310 |

All probes use gain 0.5 with a 3 dB cap, start from the selected pass-11
cumulative `r2` surface, change exactly one existing source row, retain the
fundamental normalisation anchor, and leave every body, breath, consonant and
Human field unchanged. Bass mid/mf also improves mel 2.293827 -> 2.290868 and
band balance 2.278654 -> 2.242984. Its full-grid composite improves 3.437833 ->
**3.432158**. Tenor, mezzo and soprano improve
some lower spectral tiers but are correctly rejected because partial identity
is upstream.

An unselected `pass11-source-fit-r3` directory was discovered during the first
probe attempt. The authoritative pass-11 score and leaderboard consumed `r2`.
All `r3`-based probe results were therefore quarantined as diagnostics and the
entire selection run was repeated from `r2`; no unselected surface entered a
leaderboard or listening-page row.

## Current-objective gate table

| Voice / entry | Composite | Construction | Strict cells | Body | Vowel | Human | Overall |
|---|---:|---|---|---|---|---|---|
| Tenor legacy | **3.683254** | FAIL 10/11 | FAIL 0 pass / 36 fail / 0 missing | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor incumbent | 3.757798 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Tenor T-078 | 3.757964 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL — rejected** |
| Soprano legacy | 4.464968 | FAIL 9/10 | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano incumbent | **4.101228** | **PASS 10/10** | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Soprano T-078 | 4.101497 | **PASS 10/10** | FAIL 0 / 27 / 1 | PASS 10/10 | PASS 10/10 | masked | **FAIL — rejected** |
| Bass legacy | 3.436431 | FAIL 10/11 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass incumbent | 3.437833 | **PASS 11/11** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Bass T-078 | **3.432158** | **PASS 11/11** | FAIL 0 / 36 / 0 | **PASS 10/10** | **PASS 10/10** | masked | **FAIL — interim leader** |
| Mezzo legacy | **3.733439** | FAIL 9/10 | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo incumbent | 3.743206 | **PASS 10/10** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL** |
| Mezzo T-078 | 3.741681 | **PASS 10/10** | FAIL 0 / 36 / 0 | PASS 10/10 | PASS 10/10 | masked | **FAIL — rejected** |

Soprano high/p band balance remains missing evidence. No preset is shipped,
frozen or described as identity-stable.

## Fit-limited versus law-limited disposition

The 16 fit-limited cells have at least two source-addressable octave bands that
survive both temporal and cross-vowel bars. This means the existing source
surface can lawfully express a bounded coarse correction; it does not mean the
correction outranks harmonic-level partial identity. Bass mid/mf demonstrates
the successful case.

The 18 law-limited cells do not repeat across vowel bodies strongly enough to
identify the glottal source. They remain decomposition/model-law findings: no
source widening, body refit or room component is permitted. For the rejected
fit-limited probes, the next upstream rung is same-cell harmonic-rank residual
fitting from the selected surface, not a larger octave correction. T-084 records
this distinction in the live exchange.

## §2.5c identity-clearing check

No voice clears even one strict aggregate partial cell. Deterministic identity
therefore remains poor despite construction and body/vowel 10/10. Under the
three-valued rule every adult voice stays `INCONCLUSIVE-MASKED`; no
`humanRanges` value is fitted, widened or delivered, and the two-sided seeded
distribution gate is not run. The mandate remains armed for the first identity
that clears masking.

## Controllability, prior and durable artifacts

Renderer contract is rebound to `21e9ce780a8ee56a`. The four identity audits remain
clean, repeat-stable and objective/manifest-bound; the source table remains a
responder for partial, mel and band balance. Bass uses the stable
incumbent-centred identity audit because the candidate-centred repeat probe was
zero-weighted; the promoted candidate is scored against the same unchanged
objective and manifest. Pass-end semantic seals:

- gate snapshot: `47a626fe527b39b30d74f1420d22cdf5285c1e4766e87000de1ed5c38355926b`;
- controllability table: `c21bebc7cab55d4bf3cd0e74f0eca0488c2ae089e8446af7281bc316517fd6c5`;
- live exchange source: `e934039ad6c67ebd3052df4ed7fc118b107c33b6c769a6f54725ecca2d589b2b`.

Leaderboard and `best.json` backstops are copied under
`sg2-data/state/voice-*`. Tenor, soprano and mezzo retain the pass-11 leader;
bass selects `pass12-t078-strict-r2`. All voices retain prior row
`voice-soprano/mezzo/tenor/bass -> legacy vocal`, tag `sg2-legacy`, commit
`e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`.

## Listening-page mandate repair

Pass-end verification found that selected sung audition manifests bypassed the
normal fresh-seed path, so a normal page build could reuse stale SHIP audio (or
the bass scoring-only FIT comparator). The builder now ignores selected
audition audio on normal builds and reuses it only under explicit `--cached`.
The same-pass test proves both branches. The final full 16-instrument rebuild
regenerates every row after landing; voice-bass resolves the promoted parameter
bundle and all four sung families use fresh `listen-live` PCM. The exact build
seed and engine commit are retained in each row's durable `stamp.json`.

## Verification and next work

The required landing suite passes after the final shared-head merge:

- `npm test` — 11/11 pass;
- `node scripts/verify_tone_model.mjs` — all tone-model v2 assertions pass;
- `PYTHONPATH=src:. ../../../.venv/bin/python -m pytest -q` — pass;
- `PYTHON="$PWD/../../../.venv/bin/python" node scripts/render_note.mjs --verify`
  — pass, `6178fa984dd184d91d2c6edef3b0485b349d62037e9554323f1683c2a712ce90`.

The next sung pass should resume per voice at the partial tier: use
harmonic-rank same-cell residuals for hierarchy-nearest fit-limited cells,
while treating the 18 cross-vowel-inconsistent cells as source/body
decomposition-law work. There is no owner decision request and no final-freeze
request.
