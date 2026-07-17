# SG2 Agent Operating Protocol (v2 relaunch, 2026-07-17)

One canonical rulebook. Kickoffs are thin; THIS is the contract. It
consolidates the plan's rules and every mitigation earned from the v1
campaigns' failure modes. Where this file and older prose disagree, this
file and docs/SOUND_GENERATOR_2_PLAN.md govern.

## 0 · Mission

Aesthetically pleasing AND accurate models of each instrument, matched to
real reference samples, with human-facing parameters that are ultimately
flexible and understandable. **Accuracy to the sample is the main job.**
UI packaging is downstream: the existing paradigms and complexity are
fine — the direct per-partial (Fourier) and body/EQ band surfaces are
legitimate LAST-RESORT parameter homes. Never block or contort a fidelity
improvement because it lacks a tidy macro; park it in the direct surface,
note it for WP-9/WP-10, move on.

## 1 · Read order (before first action)

1. docs/SOUND_GENERATOR_2_PLAN.md — §2 loop, §2.3 controllability, §2.4c
   strongest-prior + legacy table + ship-mode, §2.5 exit discipline,
   §2.5c humanisation + §2.5c.6 distributional gate, §3 gates, §6 engine
   rules, §9 decisions, delivery model (integration cadence, durable
   storage, exchange protocol).
2. docs/sg2/OWNER_LISTENING_NOTES.md — FAMILY FIREWALL header + all
   L-notes. Every L-note is a binding requirement with an ID.
3. docs/sg2/TECHNIQUES_EXCHANGE.md — full read; statuses marked for your
   lane at the start of EVERY pass; entries generated from the live file,
   never hand-copied into reports.
4. Your family's PREFLIGHT + RESEARCH annex + DOSSIER.
5. This file, §3 (failure-mode ledger) — these are not hypotheticals;
   each one happened.

## 2 · Non-negotiable mechanics

- Own git worktree INSIDE the project directory; short-lived branches off
  `codex/sg2-l4-l5-engine`; merge green work to that shared branch at
  least once per pass. Never fork shared components — one canonical
  implementation per component (analysis stack lives in
  scripts/tone_match/, engine in web/static/synth.js).
- Suite green at every landing: `npm test`,
  `node scripts/verify_tone_model.mjs`,
  `PYTHONPATH=src:. .venv/bin/python -m pytest -q`,
  `node scripts/render_note.mjs --verify`.
- ALL artifacts under sg2-data/ via scripts/tone_match/paths.py
  (SG2_DATA). Nothing campaign-critical under /tmp, ever. Leaderboard +
  best.json copied to sg2-data/state/<inst>/ at every freeze.
- No audio in git. Fitted parameters, docs, scripts only.
- Standing marching orders: when your §2.5 exit state allows another pass
  and no owner decision is pending — CONTINUE. Do not idle for
  acknowledgement. Stop only for: genuine blocker (named, with what
  unblocks it), owner decision not covered by §9, final-freeze gate, or
  the demonstrated reference-variability floor.
- Owner communication: the integrator (Claude session) is the hub. Owner
  decisions requested via a clearly marked `OWNER DECISION NEEDED` block
  at the top of your pass summary — nothing else reaches the owner
  directly except the listening page.

## 3 · Failure-mode ledger → binding mitigations

| # | v1 failure (real) | Binding rule |
|---|---|---|
| F1 | Sterility bias: optimisers drove Human→0 because single-take scoring punishes variation; owner heard "toy synths" | FIT-MODE may be deterministic; SHIP-MODE (leaderboards, listening page, freezes) carries the full performance layer. Variation is scored DISTRIBUTIONALLY (§2.5c.6): N seeded variants, two-sided spread gate vs measured take-pair spread. Shipping Human 0 = defect |
| F2 | Craft layer stripped: campaigns initialised from neutral zeros, discarding two years of tuned envelope/vibrato/onset idioms | §2.4c legacy-prior LOOKUP TABLE (tag `sg2-legacy`). Prior row + resolved hash in every run report. No evidence for a legacy param = KEEP the legacy value. Legacy preset = leaderboard entry #1; ship only what beats it |
| F3 | Documented ≠ executed (§2.5c sat scaffolded while bests shipped sterile) | A mandate you adopt lands as code/assertion in the SAME pass, or your summary flags it pending with a date — silence is a violation |
| F4 | Delivered ≠ consumed (D4, L6 plumbing: "fixed" upstream, dead at the consumer) | T-007: every cross-lane handoff carries a consuming-side assertion. Data is not done until the consumer provably uses it |
| F5 | Scope-miss (reed laws never reached brass; sax-only assertions while L1/L2 named clarinet/trumpet/horn) | When a law/assertion lands for one instrument, the SAME commit enumerates the family's other instruments: applied, or recorded why not |
| F6 | Stale bookkeeping (exchange statuses lagging code both directions) | Statuses reconciled AGAINST CODE each pass; report sections generated from live files; the two-pass staleness tripwire is honoured in summaries |
| F7 | /tmp reaping destroyed the corpus and all blown campaign state | §2 storage rule above; paths.py only |
| F8 | Fork divergence (18-commit parallel gate stack) | Integration cadence above; merging is part of the pass, not optional |
| F9 | Idle-await ("no hard stopper" then stopping anyway) | Standing marching orders above |
| F10 | Gates absent while "shippable" was claimed | No preset described as shipped/audited/interim-shippable in any summary without the attached §3 gate PASS/FAIL table |
| F11 | Blindly-weighted features the optimiser could not move | §2.3 controllability audit before weight; failed features = zero-weight watch + filed generator spec |
| F12 | Cross-family value leakage (blown onset defaults made bows sound like brass) | FAMILY FIREWALL: mechanisms transfer, values never; per-excitation defaults neutral until family-fitted; within- vs across-instrument slopes are separate named parameters |
| F13 | Spec-literalism: a fetch declared take-pair evidence "unobtainable" and downgraded to proxy labels, when goal-level analysis showed the obtained takes were FULL-STRENGTH evidence for the dimensions that matter (duration-robust axes; per-note variation measured directly by within-run deltas) | **Specs are means; goals govern.** When a specification is unobtainable or a fallback is invoked, STOP and re-derive from the stated aim (the L-note/plan goal): identify per-dimension what the alternative evidence genuinely supports at full strength, what it weakens, and the best goal-serving path — then proceed with THAT analysis recorded. "Downgrade-and-proceed" without a goal-level re-derivation is a violation. Applies to the hub as much as the lanes |

## 4 · Analysis cautions

- **Room sound (owner, 2026-07-17)**: some reference samples contain room
  acoustics. Treat as a known confound: residual extractions (bow noise,
  breath) may capture room decay; body fits may absorb room colour. Do
  NOT attempt room modelling at current fidelity — log room-suspected
  residual components separately instead of forcing them into instrument
  parameters. (Eventually some room may be needed to match samples
  exactly; that is a later, owner-gated step.)
- Lossy sources (MP3) never feed noise-floor extraction (L14 rule).
- Extractors prove themselves on synthetic round-trips before touching
  real data (L14 step 4 — generalise this to every new measurement).

## 5 · Pass-end deliverables (every pass, every lane)

1. §3 gate PASS/FAIL table per preset (generated by evaluate_tripwires,
   incl. legacy-baseline row).
2. Controllability table (hashed audit).
3. Exchange statuses (generated from live file).
4. Leaderboard state + sg2-data/state/ backstop copy.
5. Listening page rebuild: `python3 scripts/sg2_listen_page.py`
   (ship-mode, fresh seeds).
6. Summary: §2.5 exit state, work items, `OWNER DECISION NEEDED` block if
   any, prior-row + hash, flagged pending mandates.
