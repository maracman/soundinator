# WP-7 struck/plucked campaign — preflight scaffold

Targets (§9 decision 10): grand piano, upright piano, steel-string
acoustic guitar, nylon-string acoustic guitar, harp, glockenspiel.
This scaffold encodes every standing lesson so the campaign starts where
blown/bowed arrived, not where they began. Binding context, read first:
docs/SOUND_GENERATOR_2_PLAN.md (§2 loop, §2.3 controllability, §2.5/2.5c,
§3 gates, §6 rules), docs/sg2/OWNER_LISTENING_NOTES.md (FAMILY FIREWALL
header — all of it applies), docs/sg2/TECHNIQUES_EXCHANGE.md (protocol +
T-001..T-008), docs/sg2/DOSSIER_STRUCK_PLUCKED.md, and
docs/sg2/RESEARCH_STRUCK_PLUCKED.md (annex commissioned 2026-07-16).

## S1 · Scorer senses (before fitting — controllability-audited before weighting)

| Feature | Source lesson | Family specifics |
|---|---|---|
| Two-stage decay (fast early / slow aftersound, per-partial breakpoints) | G4, engine has decaySecondStage/Ratio | Piano's defining envelope; guitar shows it milder |
| Release/damper ring vs undamped ring | Q8 release ring landed | Piano damper vs sustain-pedal; harp hand-damping; glock rings free |
| Attack transient spectrum (hammer/pluck/mallet thump vs sustain) | L2 generalised | Onset-window vs post-onset FFT; velocity-dependent (T-002 applies at reduced variance — hammers can't wobble mid-note) |
| Inharmonicity B per register | G1; piano B measured 1.4e-4→7.3e-4 | Also steel vs nylon guitar B difference; glock is a BAR — inharmonic mode RATIOS, not stretched harmonics: score mode frequencies against the bar table, not B |
| Sympathetic bloom / cross-string resonance | T4 transfer exists | Piano (una-corda/pedal), harp (open strings), guitar body+strings |
| Double polarisation beat (two close decay rates per partial) | dossier/annex to confirm | Piano unison strings, guitar |
| Band balance (sustained→decaying adaptation) | T-005 | LTAS windowing must adapt: no sustain window on percussive notes — use decay-aligned windows per the annex methodology |
| Body/soundboard envelope | T-003/T-004 conventions | Guitar box + air mode (~100 Hz), harp soundboard, piano soundboard; glock: minimal body, resonator-tube coupling if present in references |

## S2 · Known physics going in (verify against annex before weighting)

- **Grand vs upright**: same mechanism, different soundboard/body envelope,
  B profile, and hammer character — expect the DIFFERENCE to live in body
  bands + B + hardness/velocity coupling (G7, still pending in engine).
  The pair is the family-morph test case (§WP-9) inside one instrument.
- **Steel vs nylon**: string material → B, drive spectrum brightness,
  attack transient colour, decay rates. Same guitar body per construction
  type — nylon references are classical guitars, steel are flat-tops:
  bodies differ too; fit separately, compare in the ledger.
- **Glockenspiel**: `bar` resonator class end-to-end for the first time —
  controllability-audit the bar ratio table's parameters explicitly;
  expect engine gaps (bar mode tuning, mallet hardness interaction) and
  file them rather than bending B to fake bar ratios (firewall: wrong
  mechanism).
- **Harp**: pluck excitation, per-string variation (44+ strings — treat
  register anchors densely), strong sympathetic coupling, finger-pad vs
  nail transient.
- **Excitation asymmetry law (L4/T-001) applies at onset only** — no
  sustained airflow. The noise floor is the strike/pluck contact +
  soundboard early reflections; it decays, never sustains. Do NOT inherit
  blown breath defaults (T-008).

## S3 · Reference handling

- Segmentation: percussive auto-segmentation exists in the fit pipeline;
  extend floor groups per T-conventions (same-source, same dynamic,
  duration-matched decay windows).
- Per-register density: piano needs ≥5 register anchors (B varies 5× over
  the range; D4-class extrapolation errors are loudest here); harp
  similar.
- §2.5c pairing: pianos have repetition takes in most corpora — build the
  pairing table at reference-build time.
- L3 outlier screen + COVERAGE.md queue for owner ears, as always.

## S4 · Discipline gates (inherited, must be closed before fitting)

1. P5 gates (tripwire gate with band-balance bars, D4 fix, render-path
   golden, leaderboard carry-forward) — closed by Agent A.
2. Controllability audit clean for every weighted feature (§2.3).
3. T-003/T-004 body conventions landed (they apply to guitar/harp/piano
   soundboards identically).
4. Corpus landed with provenance/coverage per WP-0 conventions
   (acquisition running for the four new instruments).

## S5 · Cheap wins (decision 7)

- Iowa marimba/xylophone/vibraphone ride the same bar-class work as
  glockenspiel — near-free interim presets once glock fits.
- Piano una-corda / pedal-up-down takes, if present in the corpus, become
  variation presets of the grand.
