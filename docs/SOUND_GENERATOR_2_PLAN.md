# Sound Generator 2.0 — Sub-note page iteration plan

*Rev 1, 2026-07-15 — handoff spec for coding agents. Each work package (WP)
is self-contained: context, exact anchors, steps, acceptance criteria. Read
§1–§4 before starting any WP.*

**Owner's goal.** The sub-note page's single-layer presets must sound like
the live instrument — at the quality bar of professional modelling synths
(SWAM, Pianoteq, Audio Modeling class) — for eleven targets:

| Family | Instruments |
|---|---|
| Bowed | violin, cello |
| Struck/plucked | grand piano, upright piano, steel-string acoustic guitar, nylon-string acoustic guitar, harp, glockenspiel *(family expanded — §9 decision 10)* |
| Blown | clarinet, tenor saxophone, trumpet, French horn |
| Sung | male voice (tenor), male voice (contrabass/basso profondo), mezzo-soprano, boy soprano |

Two deliverables, produced by one iteration loop:

1. **Perfected single-layer presets** — one per instrument, fitted to
   reference audio and confirmed by ear.
2. **The optimal user-facing parameter set** — the continuous dials exposed
   on the sub-note page must be able to travel between the instruments of a
   family (e.g. clarinet → French horn using only exposed dials). Everything
   else moves behind Advanced disclosure.

**Hard scope boundary.** Changes may touch the EXCITOR, RESONATOR and BODY
stages (engine laws + their inspectors) only. **No changes to LAYERS,
EFFECTS, or SPACE** — not their engine chain, not their UI. The downstream
boundary in code: everything after the per-partial oscillator sum
(`_ensureLayerChain`, effects host, space nodes, master chain in
`web/static/synth.js:3699+`) is off-limits.

---

## 1. Orientation (read first)

- **Repo**: vanilla ES modules, no bundler. App served by a Python stdlib
  server: `PYTHONPATH=src .venv/bin/python -m synthesiser.web.server`
  (port 8765). Tests: `npm test` (node --test), `npm run test:browser`
  (Playwright), `pytest tests/`, `node scripts/verify_tone_model.mjs`
  (headless tone-model assertions, wired into CI).
- **Engine** (`web/static/synth.js`, ~4.7k lines): additive Fourier
  synthesis. The excitor/resonator/body are *pure math laws* that compute
  per-partial frequency/amplitude/decay; audio is a bank of WebAudio
  `OscillatorNode` sines. No worklet. The law functions are exported and
  Node-importable (used by `verify_tone_model.mjs`):
  `excitationDrive` (:978), `positionComb` (:992), `hardnessRolloff`
  (:1001), `excitationSpectrum` (:1009), `resonatorRatio` (:931),
  `partialFrequency` (:944), `materialT60` (:963), `bodyResponse` (:756),
  `dynamicBrightness` (:1017), `transferCoupling`/`transferDeltas`.
- **Per-note pipeline**: `_spectralFingerprint()` (synth.js:2244) computes
  the spectrum (amp × dynamics × body × excitation × macros);
  `_renderSpectralPartials()` (synth.js:4465) renders it (one oscillator
  per partial, material decay via `setTargetAtTime`, FM→AM body shimmer,
  blow-noise floor, attack noise, breath).
- **Params**: flat per-layer dict `layer.sound{}`; canonical inventory
  `DEFAULTS` in `web/static/params.js:337`; engine view via
  `engineParams()`/`enginePlayParams()` (params.js:177/304).
- **Measured-profiles pipeline already exists** (docs/MEASURED_PROFILES.md):
  `scripts/fit_profiles_from_samples.py` analyses single-note recordings
  (segmentation, f0, 64-partial tables, inharmonicity B, T60 law fits,
  attack transient + band stagger, vibrato stats, ADSR) →
  `measured_profiles.json` → `scripts/gen_measured_profiles_module.py` →
  `web/static/measured_profiles.js`, merged into `SPECTRAL_PROFILES` at
  module init. Fits exist for flute, clarinet, violin, cello, trumpet,
  trombone, piano. **No audio ships with the repo — only fitted
  parameters.** That rule stands for everything below.
- **Sub-note UI** ("CHORDA" stage rail): builder `subnoteWorkspaceHTML`
  (app.js:11078), per-stage inspectors `chInspectorHTML` (app.js:14199),
  knobs via `knobHTML` (app.js:13720), live-update routing through the
  `liveSubnoteParams` set (app.js:8890) → `synth.updateGenerationParams`.
  Progressive disclosure already exists (`<details class="formant-detail">`
  "Advanced shaping", app.js:14251).
- **Cache-busting rule**: any change to `web/static/*.js|css` bumps the
  `?v=NNN` query in `web/static/index.html`.
- **Do NOT deploy** (owner-run; docs/HOSTINGER_DEPLOY.md). Every WP is a
  separate commit that leaves the suite green and the app clickable.

### Delivery model — trunk-based, no long-lived feature branch

- **Short-lived branch per WP → PR → merge to `main`** (days, not weeks).
  This works because every WP is required to be green AND user-invisible
  on landing: engine gaps are neutral-by-default (§6 rule d — golden
  fixtures unchanged until a preset opts in), and fitted presets land as
  data, not behaviour changes. `main` is NOT production — deploys are
  owner-run — so main may accumulate the feature safely.
- **Do not run this on one big feature branch.** app.js (22k lines) and
  synth.js are shared with the concurrent layer-unification WPs; two
  long-lived branches over the same monolith is the highest-risk option.
  If a mid-WP state must be shared or paused, push the WP branch — never
  let it live longer than its WP.
- **Two "switch" PRs concentrate everything user-visible**, each landing
  only after its gate: (S1) the factory-preset swap + legacy
  retirement/classic-tagging, after the capstone audition (WP-11); (S2)
  the inspector re-ranking/UI changes, after owner sign-off (WP-10).
  Optionally, fitted presets may land earlier tagged "beta" in the
  browser strip for live listening — one line to flip at S1.
- **Iteration artifacts stay out of git** (`/private/tmp/sg2/` — renders,
  leaderboards, reports). Committed: fitted parameters, dossiers, the
  ledger, scripts, manifest.
- **Tag each campaign freeze** (`sg2-blown-frozen`, `sg2-bowed-frozen`, …)
  so open-ended refinement re-runs (§2.5) always have a comparable
  baseline in history.
- **Coordinate with layer unification**: before starting a UI-touching WP
  (WP-10, S1/S2), check which layer-unification WPs are mid-flight in the
  same app.js regions and sequence rather than collide.
- **Durable artifact storage (2026-07-16 INCIDENT rule)**: /private/tmp
  was reaped twice, destroying the sample corpus, all blown reference
  sets, leaderboards, and run state. ALL SG2 artifacts (corpus,
  campaign references, leaderboards, run reports, best params, renders)
  now live under `<repo>/sg2-data/` (gitignored; env override
  `SG2_DATA`). Nothing campaign-critical may be written under /tmp or
  /private/tmp, including git worktrees — put worktrees under the
  project directory. Leaderboards and best.json params additionally get
  copied into `sg2-data/state/` on every freeze (cheap JSON — this is
  the best-so-far-is-sacred backstop).
- **Shared-branch integration cadence (owner, 2026-07-16)**: the shared
  SG2 branch is the single integration point and must advance. Every
  agent merges its green, landed work to the shared branch AT LEAST once
  per pass (small merges, immediately after the suite passes) — private
  branches live hours, not days. No agent builds on another agent's
  unmerged branch except through an explicit custody handover. Forked
  copies of another lane's code (e.g. analysis logic inlined into an
  engine branch) are defects: one canonical implementation per component,
  owned by its lane, consumed by everyone else from the shared branch.
- **Techniques exchange (owner, 2026-07-16)**: when multiple agents work
  in parallel, generalisable techniques (anything affecting parameters,
  validation criteria, or fitting method beyond one instrument) are
  written to `docs/sg2/TECHNIQUES_EXCHANGE.md` — append-only, firewall-
  levelled entries. EVERY agent reads new entries at the start of every
  pass and marks each one incorporated / adapted / rejected-with-reason;
  an entry left pending across two passes must be flagged in that agent's
  summary. Cross-agent knowledge moves through the file, not through the
  owner.
- **Determinism is a research requirement**: all randomness through the
  seeded RNG; new param keys are schema additions — bump `APP_VERSION`
  once when the first Sound Generator 2.0 engine param lands, so
  `stimulus_id`s never collide.
- **Prior art to read**: docs/TONE_MODEL_V2_DESIGN.md (the v2 model,
  audit A1–A14, CH-B arcs), docs/MEASURED_PROFILES.md (fit semantics and
  limitations), docs/FORMANT_SPACE_DESIGN.md (vowel space).

### Status check — DONE (2026-07-15)

CH-B4's five imperfections were checked against synth.js (they landed as
the "Q8" batch): onset pitch scoop ✅ (`onsetScoopCents`, synth.js:1276/4224),
per-partial attack stagger ✅ (`partialOnsetDelay` :1289, measured
`bandT90ms` consumed :2333, rendered :4494), release ring ✅
(`releaseRingSeconds` :1297/4696), Human f0 wander ✅ (`f0WanderTrace`
:1305/4227), velocity→attack-noise level ✅ (burst scaled by velocity,
:4640). Still missing: **velocity→hardness coupling** (harder strike =
brighter hammer spectrum — `excitationSpectrum` takes hardness but nothing
modulates it by velocity) and **two-stage decay** — both remain in §6.

---

## 2. The iteration loop (the core of this plan)

One loop, run per instrument, that simultaneously (a) fits the preset and
(b) accumulates evidence about which parameters matter to users.

```
        ┌──────────────────────────────────────────────────────────┐
        │  0. REFERENCE   clean samples, ≥3 registers × ≥2 dynamics │
        └──────────────┬───────────────────────────────────────────┘
                       ▼
        1. ANALYSE     fit_profiles_from_samples.py → measured params
                       (partial tables, B, T60 law, attack, vibrato)
                       ▼
        2. INITIALISE  preset = measured params + physics defaults
                       ▼
   ┌──► 3. RENDER      headless engine render of matched notes
   │                   (same pitch/velocity/duration as each reference)
   │                   ▼
   │    4. SCORE       feature-wise loss vs reference (§2.3)
   │                   ▼
   │    5. ADJUST      optimiser step over the free-parameter manifest
   │                   (measured params stay pinned; §2.4)
   └──── no ──── converged? ── yes ──▼
                       6. AUTOMATED GATE   §3 tripwires + the family
                                           dossier's construction checklist
                       ▼
        7. TRIAGE RESIDUALS
           (a) param-fixable → widen manifest / adjust bounds, re-loop
           (b) MODEL GAP → engine WP (§6): no parameter setting can fix it
           (c) gates pass → freeze preset, log parameter ledger (§2.5)

        8. HUMAN AUDITION — the very last stage, not per-iteration
           (owner decision 2026-07-15: minimise human intervention).
           Blind A/B/X kit over ALL frozen presets at the capstone;
           failures reopen that instrument's loop.
```

Every loop run writes an artifact directory (git-ignored):
`/private/tmp/sg2/<instrument>/<run>/` containing rendered WAVs, reference
features, per-iteration loss curves, and an HTML report (spectra overlay,
envelope overlay, decay scatter, vibrato tracks). Human audition (step 6)
uses these files directly — nothing enters the repo except fitted
parameters and the ledger.

### 2.1 Reference corpus (WP-0)

Per instrument: single, clean, solo notes at **low / mid / high register**
(≥3 pitches spanning the practical range) × **≥2 dynamics** (p and f; mf
where only one exists), plus one vibrato take and one non-vibrato take for
instruments that vibrate. Candidate sources, in preference order:

1. **Univ. of Iowa MIS** — already used; free/unrestricted. Has violin,
   cello, piano, Bb clarinet, trumpet, French horn, classical guitar,
   alto/soprano sax (NOT tenor — verify current catalogue).
2. **Philharmonia Orchestra samples** — free to use; has French horn,
   saxophone, guitar; short notes, mp3 (fine for vibrato/spectral shape,
   already precedented).
3. **VSCO 2 CE** (CC0) — gap-filler.
4. **VocalSet** (Zenodo, CC BY 4.0, ~3 GB) — the adult voices: tenor,
   bass (nearest to contrabass), mezzo-soprano; multiple vowels,
   vibrato/straight takes. Download budget was the previous blocker; it is
   now justified — voices are 4 of the 11 targets and currently the only
   hand-tuned, unmeasured profile.
5. **Professional modelling-synth captures** — per the owner brief, output
   of top-line modelling synths is an acceptable reference standard.
   Use for anything the free corpora can't cover — expected: **tenor sax**
   (if Iowa/Philharmonia only have alto). Capture single notes from
   demo/trial instances locally. These recordings are analysis input only,
   never redistributed, never committed — same posture as all reference
   audio. **Boy soprano is best-effort** (§9 decision 2): use a reference
   if one is found; otherwise construct from the fitted adult voices +
   morphology scaling, exempt from the quantitative tripwires.

Layout follows the existing convention: `<samples>/<instrument>/*.aiff|mp3`
with `vib`/`nonvib` name tagging (fit script auto-routes them). Every
source + licence recorded in docs/MEASURED_PROFILES.md's source table.

### 2.2 Headless render (WP-1)

The loop needs to render *exactly what the browser engine renders*, offline
and scriptable. Today offline render exists only for full arrangements
(`mixdownArrangement`, app.js:2630 — `OfflineAudioContext` + fresh
`SynthEngine` + `init(off, off.destination)`), which proves the engine is
offline-safe. Build the single-note version:

- New export in synth.js (or a small `web/static/render-note.js` module):
  `renderNoteOffline(soundParams, {midi, velocity, durationSec, sampleRate})`
  → `AudioBuffer`. Internally: `OfflineAudioContext` → `SynthEngine` →
  `init(off, off.destination)` → schedule one note through the normal
  fingerprint/render path → `startRendering()`. **Space must be neutral**:
  bypass/dry settings so the loop fits the instrument, not the room
  (reverb wet 0, distance minimal, no ear model colouration — use the
  existing params, do not modify the space code).
- Driver `scripts/render_note.mjs`: Playwright chromium (dep already in
  repo) loads the dev server, calls the export in-page, returns Float32
  channels; batch mode renders N parameter-sets per page load (startup
  amortised — target <1 s per render in batch). Writes WAV (reuse the
  16-bit encoder logic from `audioBufferToWavBlob`, app.js:2604, moved to
  a shared module or duplicated in the script).
- Determinism: fixed seed in params → byte-identical renders across runs
  (assert in tests).

### 2.3 Scoring (WP-2)

Python module `scripts/tone_match/` (imports the analysis internals of
`fit_profiles_from_samples.py` — refactor its per-note analysis into an
importable function rather than copy-pasting). Features, each normalised to
a perceptual unit so the composite is interpretable:

| Feature | Distance | Unit |
|---|---|---|
| Partial amplitude table (first 32, per register) | L1 on dB values, audibility-floored | dB |
| Log-mel spectrogram of the whole note (loudness-matched) | L1 | dB |
| Spectral centroid trajectory | L1 over time | semitones |
| Attack: per-octave-band T90 + low→high stagger | abs diff | ms |
| Decay: per-partial T60 vs fitted law | log-ratio | dB/s |
| Inharmonicity B | log-ratio | — |
| Vibrato rate / depth | abs diff | Hz / cents |
| Transient/sustain noise ratio + noise centroid | abs diff | dB / octaves |

**Controllability rule (owner, 2026-07-16): a feature may carry non-zero
weight for an instrument ONLY if at least one free manifest parameter
demonstrably moves it.** Enforced mechanically, not by convention: the
loop runs a controllability audit at campaign start — perturb each free
parameter, record which features respond; any weighted feature with no
responsive parameter is an ERROR that either (a) zero-weights the feature
(it becomes a watch metric + a filed §6 engine gap), or (b) blocks the
campaign until the generating parameter lands. Measurement may lead
generation (senses first), but weighting must follow controllability.
Every run report includes the controllability table, so "the agent is
being scored on something it cannot adjust" is impossible by
construction.

**Empirical criteria hierarchy (owner, 2026-07-17).** The validation
criteria form a dependency hierarchy. A theoretical ordering exists
(T0 pitch/partial-membership → spectral amplitudes → temporal →
modulation → noise/transients → humanisation; upstream failure masks
downstream measurement), but the hierarchy is also TRACKED EMPIRICALLY:
1. Every accepted optimiser step persists the full per-feature loss
   vector (already computed each evaluation).
2. Directed drift events are logged: step improves criterion A while
   degrading criterion B beyond the noise floor ⇒ event A⊣B. The
   accumulated asymmetry matrix (across passes and instruments) defines
   measured edges: A→B when drift is significantly asymmetric.
3. The measured graph's topological order is the working hierarchy;
   emitted to `sg2-data/state/criteria-drift.json` for the owner
   progress page. Disagreements with the theoretical tiers are flagged
   findings: either an unpredicted physical coupling, or two features
   measuring the same thing (strong SYMMETRIC coupling ⇒ candidates for
   merging/reweighting — a scorer-redundancy detector for free).
4. Consumption: triage order and masking flags follow the MEASURED
   hierarchy once it has evidence (falling back to theoretical tiers
   where sparse); optimisers converge upstream criteria before spending
   budget downstream.

Composite = weighted sum; weights start uniform-per-feature and are tuned
once against ear judgements on the first converged family (a single
listening session), then frozen so scores stay comparable across
instruments. The report generator renders the HTML comparison page per run.

WP-2 also delivers the **blind audition kit** used at the capstone: a
self-contained local HTML page that loads reference/render pairs from run
directories, randomises A/B/X order, and records verdicts to JSON — so the
final human gate needs zero setup beyond opening a file.

### 2.4 Optimisation (WP-4)

Two tiers — **measure what can be measured, optimise only the rest**:

- **Pinned tier** (set directly from analysis, never optimised): partial
  amp tables, `partialB`, `materialT60` fit, attack stagger/transient
  stats, vibrato stats, ADSR. This is the existing pipeline's output.
- **Free tier** (the optimiser's manifest): the perceptual dials analysis
  cannot set directly — `excitationType` (categorical, enumerate),
  `excitationPosition`, `excitationHardness`, `excitationHuman`,
  `toneBreath`, `attackNoiseLevel`, `partialTilt`, `partialTransfer`,
  `spectralResonanceAmount`, `bodyType` (categorical), body band trims,
  plus any new engine params from §6 WPs. Manifest is a declarative JSON
  (name, bounds, categorical values, default) so the loop and the ledger
  share one source of truth.
- The manifest is drafted: `scripts/tone_match/manifest.json` (bounds
  mirror the inspector knobs so every fitted preset stays UI-reachable).
- Optimiser: `scipy.optimize` Nelder–Mead / Powell over the continuous
  subset per categorical combination (the categorical space is tiny);
  CMA-ES (`cma` package) as fallback if the landscape proves multimodal.
  Budget ~200–400 renders per instrument — feasible at <1 s/render.
- Convergence: composite loss plateau (<1% over 20 evals) or budget —
  this ends one *optimiser run*, never the refinement itself: a plateau
  hands over to the §2.5 escalation ladder, not to "done".
- **Residual triage is the point**: after convergence, the per-feature
  residual table says exactly what the model *cannot* express (e.g. "sax
  renders converge but mel-distance stays >6 dB in 500–1500 Hz at forte" →
  a body/nonlinearity gap, §6). Param-fixable residuals widen the manifest;
  model gaps become engine WPs; the loop re-runs after each engine WP.

### 2.5 Open-ended refinement — "near enough" is not a stopping rule

Owner directive (2026-07-15): the loop must be able to run as long as the
owner likes, always finding ways to get more accurate. Agents must NOT
stop at the §3 tripwires — those are the minimum bar to ship at all, not
the target. Rules:

- **The only principled floor is reference variability.** For each
  instrument, compute the feature-distance between different *takes* of
  the same reference note (different recordings/performers of the same
  pitch/dynamic). When render↔reference distance is at or below
  take↔take distance, further fitting is chasing noise — that is the one
  legitimate "done", and it must be *demonstrated in the run report*, not
  asserted.
- **Every refinement session must end in exactly one of three states**:
  (a) a measurable composite-loss improvement, committed to the run
  leaderboard; (b) a named, evidenced limiting factor (which parameter is
  pinned at a bound, which feature dominates the residual, which model
  law caps it) with a filed work item to remove it — widened manifest,
  new scorer feature, §6 engine WP, better reference audio; or
  (c) the reference-variability floor demonstrated per the point above.
  "Converged, looks close" is not an exit state.
- **Escalation ladder when the optimiser plateaus** (in order): re-run
  from N random restarts → widen manifest bounds / free a pinned param
  with justification → per-register fitting instead of shared params →
  add the dominating residual as a new scorer feature → file/land the
  engine gap → acquire better reference takes. Each rung is cheap to try
  and each is logged, so a later session never re-treads a rung already
  exhausted.
- **Best-so-far is sacred**: every instrument keeps a leaderboard
  (`/private/tmp/sg2/<instrument>/leaderboard.json` + the frozen preset in
  git history); a refinement run that regresses never overwrites the best
  preset, and the loop can always be resumed from it — so re-running the
  loop is always safe and always additive.

### 2.4c Strongest-prior initialisation and the sterility bias (owner, 2026-07-17 — MANDATORY)

Root-caused after every campaign independently converged on sterile,
toy-synth renders (violin/tenor bests carried Human 0, no envelope, no
breath, no onset noise):

1. **Initialise from the strongest known sound, never from neutral.**
   Every campaign preset starts as: the LEGACY factory preset + measured
   profile + SPECTRAL_PERFORMANCE craft defaults (the pre-SG2 sound that
   passed owner ears for two years), overlaid with campaign-pinned
   measurements. Evidence rules govern what may MOVE and which NEW laws
   may enable — they never zero legacy craft parameters. Absence of
   corpus evidence for a legacy parameter means KEEP THE LEGACY VALUE.
   T-008 neutrality applies to new mechanisms only.
1b. **The legacy prior is a LOOKUP, not a judgement call.** Anchor: git
   tag `sg2-legacy` (e8d3ac1). Each campaign takes its prior from this
   table — the CRAFT layer (SPECTRAL_PERFORMANCE envelope/vibrato/Human/
   attack-noise idioms + excitation-type defaults) always comes from the
   named legacy source; spectral/body content comes from the campaign's
   own fits (legacy tables serve as spectral fallback only for the eight
   true-legacy instruments). Every run report names its prior row and
   the resolved parameter hash. An instrument not in this table =
   owner escalation, never a guess.

   | Campaign instrument | Legacy prior at `sg2-legacy` | Notes |
   |---|---|---|
   | violin, cello, flute, clarinet, trumpet, trombone | its own legacy preset | TRUE legacy — full prior incl. spectral fallback |
   | piano-grand | legacy `piano` | TRUE legacy |
   | piano-upright | legacy `piano` craft; fitted upright tables/B | pair-morph target of grand |
   | guitar-nylon, guitar-steel | legacy `piano` craft adapted to pluck (engine pluck-type defaults at anchor) | no true legacy guitar |
   | harp | legacy `piano` craft, pluck defaults | |
   | glockenspiel (+ marimba/xylo/vibes interims) | legacy `piano` craft, strike defaults, `bar` class | short-envelope percussion idiom |
   | alto sax (+ tenor when sourced) | legacy `clarinet` craft (reed) | spectral from fitted only |
   | french-horn | legacy `trombone` craft (brass) | |
   | voice-soprano/mezzo/tenor/bass | legacy `vocal` craft (incl. formant-era vibrato/breath idioms); per-vowel fitted bodies on top | one prior for all four classes |
   | basso profondo, boy soprano | DERIVED from fitted bass / adult voices (§9 d.2, d.12) — their prior is the fitted parent, not sg2-legacy | |

2. **Legacy is leaderboard entry #1.** Score the legacy preset under the
   current objective as every campaign's founding baseline. A "best"
   that loses to legacy — on composite OR owner ear — is not a best.
   Campaigns ship improvements over the legacy sound or nothing.
3. **The sterility bias is a named objective defect**: scoring against a
   single take rewards Human→0 (randomness adds loss variance). Split
   modes: FIT-MODE may hold Human/variation at 0 for deterministic
   spectral fitting; SHIP-MODE (leaderboard entries, listening-page
   renders, frozen presets) carries the full performance layer — legacy
   or §2.5c-fitted Human, envelope idiom, onset noise, breath/bow noise,
   vibrato trajectory. A shipping preset with Human 0 or a missing
   craft layer is a DEFECT unless the instrument is mechanical.
   Listening-page renders are always ship-mode.
4. Where the scorer cannot yet measure a craft parameter, it rides along
   at its legacy/fitted value as a watch dimension — it is never
   optimised to zero by omission.

### 2.5c Humanisation calibration — take-pair differential fitting (owner, 2026-07-16)

Where the corpus holds matched takes (same instrument, note, dynamic,
articulation — differences are purely human), do not use them only as the
stopping floor (§2.5). Additionally:

1. **Differential fit**: fit each take individually (identity parameters
   frozen at the instrument's converged values; only Human-designated
   parameters free — breath level, articulation strength, scoop
   depth/settle, drive level, vibrato depth/phase, onset noise level).
   The per-parameter deltas between matched takes are MEASUREMENTS of
   human variation.
1b. **Qualification criterion — DOUBLE DISSOCIATION (owner, 2026-07-17)**:
   a parameter qualifies as a humanisation parameter for an instrument
   only if it TRADES OFF between matched takes: frozen at v₁ it improves
   the match to take 1 AND worsens take 2; frozen at v₂ it improves
   take 2 AND worsens take 1. The playing range is the interval swept
   between per-take optima (pooled across pairs → the humanRanges
   distribution). A parameter that improves both takes at the same value
   is an IDENTITY parameter mis-filed as human — move it to the identity
   fit. A parameter that never trades off is not humanisation for that
   instrument. Because qualified parameters are physical playing
   properties, every value inside the swept range corresponds to
   something a real player did — which is the naturalness guarantee for
   per-note draws.
2. **Decomposition validation (falsifiable, THREE-VALUED — owner
   correction 2026-07-17)**: the verdict distinguishes two failure causes
   that must never be conflated:
   - **PASS**: matched takes reconcile within Human-designated params.
   - **FAIL-MISSING-DOF**: takes do not reconcile AND the per-take
     identity fit is itself good (each take individually fits near the
     §3 bars through a fully-functional render path) — only THEN is the
     residual evidence of a missing human degree of freedom.
   - **INCONCLUSIVE-MASKED**: takes do not reconcile but the identity
     fit is poor or any consumed render component is non-functional —
     the residual is dominated by model/renderer misfit and says nothing
     about the human axis yet. Re-run after the masking defect clears.
   In all non-PASS cases: file the limiting factor, never widen the
   identity set to absorb it. The measured take-pair spread tables are
   valid standalone evidence regardless of verdict (they are
   model-independent measurements).
3. **Calibrated ranges**: the observed delta distributions become the
   per-instrument humanisation ranges — the Human dial at 1.0 spans the
   measured take spread, so any draw within range is a humanly-possible
   sound by construction. Store the fitted ranges in the measured profile
   (`humanRanges`), consumed by the per-note draw machinery; ledger the
   spreads alongside sensitivities.
4b. **Per-dimension evidence doctrine (owner oversight, 2026-07-17 —
   F13)**: when ideal pairs are unavailable, evidence strength is judged
   PER DIMENSION against the goal, never blanket-labelled. Repeat takes
   that differ in duration or codec are FULL-STRENGTH evidence for
   duration-robust dimensions (onset wander/lead, articulation level,
   bow-position comb, vibrato rate/depth); within-run adjacent-note
   deltas (register-trend removed) are the PRIMARY measure of per-note
   variation — the quantity the synth actually ships; only genuinely
   affected dimensions (e.g. MP3-derived noise-floor levels) carry the
   weaker-evidence flag. Cello applies this doctrine now.
4. **Pair sources**: Philharmonia multi-takes, vib/nonvib pairs, VocalSet
   repetitions; where no true duplicate exists, adjacent-semitone takes
   with the register trend removed are the fallback proxy (per the
   original spread estimator's method). Log which source calibrated each
   range — proxy-calibrated ranges are weaker evidence.
5. **Research payoff**: Human becomes a calibrated stimulus dimension —
   per-note imperfection draws are measured player variation in physical
   units, directly usable in the appeal/surprisal studies.
6. **ENFORCEMENT (owner, 2026-07-17 — status audit found §2.5c
   scaffolded but never executed, while shipped bests zeroed Human):**
   (a) the differential fits are CAMPAIGN WORK, not capstone work — each
   campaign runs them as soon as its identity fit stabilises, and
   `humanRanges` lands in the measured profile then, not at WP-11;
   (b) **variation is scored distributionally, never against single
   takes**: render N seeded ship-mode variants per note, measure their
   per-feature spread, and gate TWO-SIDED against the measured take-pair
   spread — too little variation (sterile) is a failure exactly as much
   as too much (sloppy). A single-take loss term must never see
   ship-mode randomness, so stripping variation can never again improve
   any score; (c) the listening page and leaderboard renders draw fresh
   seeds per build — the owner should never hear the same "performance"
   twice unless auditioning determinism itself.

### 2.5b The parameter ledger (feeds WP-9/WP-10)

Every converged run appends per-parameter evidence to
`docs/SG2_PARAM_LEDGER.md` (checked in — it is derived data, no audio):

- **fitted value** per instrument;
- **sensitivity** — loss increase when the param is perturbed ±10% of its
  range around the optimum (one-at-a-time sweep, cheap: ~2 renders/param);
- **between-instrument spread** of fitted values, within-family and
  across-family.

Exposure rule derived from the ledger: a parameter earns a **top-level
knob** if it is *both* sensitive (moving it audibly matters) *and* spread
(instruments genuinely differ on it). Sensitive-but-uniform → Advanced
(technical tweakability, sensibly hidden). Insensitive → candidate for
removal from the UI entirely.

---

## 3. What "matching" means — acceptance targets

"Exactly like the live instrument" is operationalised as:

**These are minimum ship bars, not targets** — passing them permits a
preset to ship; it does not end refinement (§2.5). The loop keeps
improving on demand until the reference-variability floor is demonstrated.

- **Quantitative** (per register, at mf): partial-table distance ≤ 3 dB
  mean; mel-spectrogram distance ≤ 4 dB mean; attack T90 within ±30% or
  ±20 ms (whichever is larger); vibrato rate ±0.3 Hz, depth ±30%;
  B within a factor of 1.5 where measured.
- **Construction checklist** (from the family dossier, WP-R): the fitted
  preset must pass every per-instrument physics assertion. Together with
  the tripwires this is the *automated* gate that drives iteration —
  no human in the loop.
- **Qualitative gate (the real bar, run ONCE at the capstone)**: blind
  A/B/X audition — owner + one naive listener — over all frozen presets,
  rendered vs reference at three registers, via a self-contained local
  audition kit (§WP-2). Pass = "recognisably the same instrument;
  differences read as a different player/room, not a different
  instrument." Verdicts logged by the kit; a failure reopens only that
  instrument's loop.
- **Resource tripwire** (§9 decision 8): every run report logs the
  preset's playback cost — post-culling oscillator count and automation
  events/sec (the T-B7 benchmark method). Fitting at 64 partials is fine
  for accuracy, but a preset drifting far above current factory cost gets
  flagged for the WP-P compression pass rather than silently shipped.
- The quantitative targets are tripwires, not the goal — if a preset passes
  numbers but fails ears, the loss weights get revisited (once, §2.3),
  or the residual is triaged as a model gap.

---

## 4. Work packages — infrastructure

### WP-R · Instrument construction dossiers (research stage)
Before fitting anything, verify we are *constructing* each instrument
correctly — the loop optimises within the model structure, so a structural
error (wrong bore class, missing air mode, wrong source spectrum) converges
to a plausible-but-wrong preset with the error hidden in the amp tables.
One dossier per family in `docs/sg2/DOSSIER_<family>.md`, each answering:

1. **Mechanism → stage mapping.** How the real instrument produces sound
   (excitation mechanism, resonator physics, body/radiation), mapped
   explicitly onto EXCITOR/RESONATOR/BODY, flagging where the additive
   model approximates and whether the approximation is audible. Primary
   references: Fletcher & Rossing *The Physics of Musical Instruments*;
   Benade (winds/brass); Sundberg *The Science of the Singing Voice*;
   Askenfelt/Chaigne (piano); Woodhouse (bowed strings, guitar).
2. **Quantitative signatures.** Published numbers the preset must land in:
   spectral-envelope shape per register, fixed-Hz body/formant regions
   (violin bridge hill ~2–3 kHz, guitar air mode ~100 Hz, singer's formant
   ~2.8–3.2 kHz), inharmonicity B ranges, T60 behaviour, vibrato norms,
   attack times, dynamics→brightness behaviour.
3. **What the professional modellers expose.** The user-facing parameter
   sets of SWAM / Pianoteq / Audio Modeling-class instruments for this
   family — independent commercial evidence for WP-9's exposure decisions.
4. **Construction checklist.** 5–10 measurable facts per instrument (e.g.
   "clarinet: even partials ≥20 dB below odd neighbours through n≈6 below
   the break, rising with register"; "brass: centroid rises ≥X with
   dynamics"; "violin: body peaks fixed in Hz across notes"). These become
   per-instrument sanity assertions in the WP-2 scorer, checked separately
   from the composite loss so a low loss cannot mask wrong physics.
5. **Verdict on §6.** For each pre-seeded gap relevant to the family:
   confirmed-with-citation, rejected, or amended; plus any gap the
   literature predicts that §6 missed.

Suitable for the deep-research workflow (one run per family). Dossiers are
derived text — committed to the repo.
**Accept**: four dossiers reviewed by the owner; §6 backlog updated with
citations/verdicts; each dossier's checklist encoded as scorer assertions
(landing with WP-2); WP-0's register/dynamic selections cross-checked
against the dossier (e.g. clarinet takes must straddle the register break).

### WP-0 · Reference corpus + provenance
Assemble §2.1 corpus under `/private/tmp/sg2/samples/` (git-ignored;
document the layout so it is reconstructible). Verify actual availability
per instrument (Iowa catalogue has moved before — check tenor sax, French
horn, guitar coverage; check Philharmonia sax type). For boy soprano and
any other gap, capture modelling-synth references locally. Update the
source/licence table in docs/MEASURED_PROFILES.md.
**Accept**: every one of the 11 instruments has ≥3 registers × ≥2 dynamics
+ vib/nonvib where applicable; licences recorded; zero audio staged for
commit (`git status` clean of audio).

### WP-1 · Headless single-note renderer
Per §2.2. Also add a golden test: `tests/js/` or a new
`scripts/verify_render_note.mjs` asserting determinism (same seed ⇒
identical PCM hash) and space-neutrality (energy outside the dry path ≈ 0).
**Accept**: `node scripts/render_note.mjs --params <json> --midi 60 --out x.wav`
produces a WAV; batch of 50 renders < 60 s; determinism test green; CI
still green; no changes to layer/effects/space code.

### WP-2 · Analysis → loss module + report
Per §2.3. Refactor `fit_profiles_from_samples.py`'s per-note analysis into
an importable `scripts/tone_match/analysis.py` (the CLI keeps working —
regression: re-run it on one cached instrument and diff the JSON).
**Accept**: `python -m tone_match.score --ref a.wav --render b.wav` emits
the feature table + composite; report HTML renders; existing fit-script
output unchanged on the regression instrument.

### WP-3 · Extend measured fits to the new instruments
Run the (refactored) fit pipeline over WP-0's corpus: acoustic guitar,
tenor sax, French horn, and the four voices; refresh violin/cello/piano/
clarinet/trumpet with the richer multi-register, multi-dynamic corpus.
Voices need modest analyser additions: vowel-conditioned analysis (fit per
vowel, store formant bands F1–F5 per voice type → body presets) and f0
micro-drift stats. Extend `measured_profiles.json` → regenerate
`measured_profiles.js` → merge check. **Register-dependence**: store
per-register partial tables (`partialsByRegister`) and per-register B —
engine consumption comes in WP-5, storage comes now.
**Accept**: measured_profiles.json has all 11 instruments;
docs/MEASURED_PROFILES.md updated (results table + per-instrument notes +
limitations); `verify_tone_model.mjs` green; app boots with merged
profiles, zero console errors.

### WP-4 · The optimiser loop
Per §2.4: `scripts/tone_match/iterate.py` — manifest-driven, calls the
WP-1 renderer as a subprocess (batch), writes run artifacts + appends the
ledger. Include the ±10% sensitivity sweep at convergence.
**Accept**: end-to-end run on **clarinet** (best-measured baseline)
converges, produces the report + ledger rows, and the converged preset
beats the pre-loop measured-only preset on composite loss.

---

## 5. Work packages — the per-family campaigns

Run the loop family-by-family (shared physics ⇒ shared model gaps surface
together). Order: **blown → bowed → struck/plucked → sung** (blown has the
best measured baseline and the clearest family-morph test; sung is hardest
and benefits from every engine improvement landed before it).

Each campaign WP has the same shape:
0. Read the family dossier (WP-R); confirm the engine can structurally
   represent the family's mechanism before fitting (or land the blocking
   §6 WP first).
1. Loop each instrument in the family to convergence — the dossier's
   construction checklist must pass alongside the composite loss.
2. Triage residuals → file/land the §6 engine WPs the family needs → re-loop.
3. Freeze presets: write them as factory sub-note modules in
   `web/static/factory-presets.js` (shape per the `sound()` factory,
   factory-presets.js:31), replacing/upgrading the existing starters.
   **Interim instruments ship too** (§9 decision 7): any instrument fitted
   to convergence as a stepping stone toward a target (e.g. standard bass
   en route to basso profondo, alto sax if used for tenor, adult voices
   feeding the boy-soprano construction) is frozen and stored as a factory
   preset in its own right — it passed the same gates, so it's free
   catalogue value.
4. Family-morph check (feeds WP-9): starting from instrument A's preset,
   reach instrument B using **only the currently-exposed continuous
   dials** (+ excitation type). Record which hidden params had to move —
   those are exposure candidates. Quantify: morphed preset's loss vs B's
   reference within 25% of B's own converged loss.
5. Family gate is AUTOMATED (§3 tripwires + dossier checklist). Human
   audition is deferred to the capstone kit — at most a quick informal
   listen here to sanity-check the loss weights.

- **WP-5 · Blown campaign** (clarinet, tenor sax, trumpet, French horn).
  Expected engine gaps (verify via residuals before building, §6): conical
  bore class, register-dependent even/odd (clarinet's even partials rise
  with register), brass nonlinear brightening at forte, breath-noise
  spectrum shaping.
- **WP-6 · Bowed campaign** (violin, cello). **Preflight scaffold is
  mandatory: docs/sg2/BOWED_PREFLIGHT.md** (scorer senses first, body
  deconvolution, per-string references, excitation-generic onset/noise
  architecture, discipline gates P5). Expected gaps: bow-noise sustain
  texture (P4), body-resonance note-to-note re-weighting (the "spread
  saturation" problem — addressed structurally by P2 body deconvolution
  plus §6-G1 register tables), vibrato trajectory (P1).
- **WP-7 · Struck/plucked campaign** (piano, acoustic guitar). Expected
  gaps: double decay (two-stage T60), release ring/damper (CH-B4), pluck
  position + body air-mode for guitar, velocity→hardness/noise coupling.
- **WP-8 · Sung campaign** (tenor, contrabass, mezzo-soprano, boy soprano).
  **Preflight scaffold is mandatory: docs/sg2/SUNG_PREFLIGHT.md** (V0
  structural differences — one-source/many-bodies fitting shape, singers
  are instruments not takes, consonant onsets as articulation gestures,
  passaggio registers; plus RESEARCH_SUNG_REALISM annex incl. the
  consonant-onset dataset survey).
  Builds on articulated bodies (CH-B1). Expected gaps: glottal-source
  spectral tilt vs vocal effort, singer's formant band (~2.8–3.2 kHz),
  breathiness (pitch-synchronous noise), f0 drift/portamento personality;
  voice-type = source tilt + formant scaling (body presets per voice from
  WP-3), so one "voice" family morphs across the four targets.

**Accept (each campaign)**: all family presets pass §3 quantitative
tripwires and the owner audition; factory presets committed with migration
safety (old saved presets still load — `migrateToneParams` extended if any
key changes); `verify_tone_model.mjs` + `npm test` + pytest + browser smoke
green; family-morph results recorded in the ledger.

---

## 6. Engine gap backlog (pre-seeded; confirmed by WP-R dossiers and/or loop residuals)

Rules: every engine change is (a) a physical law with citable behaviour
(cite the family dossier),
(b) inside `_spectralFingerprint`/`_renderSpectralPartials`/the pure law
functions only, (c) covered by new headless assertions in
`scripts/verify_tone_model.mjs`, (d) defaulted to bit-compatible/neutral so
existing presets are untouched until a preset opts in, (e) a new `DEFAULTS`
key + `PARAM_DESC` tooltip, initially in Advanced disclosure only —
promotion to a knob is WP-10's job, not the engine WP's.

- **G1 · Register-dependent spectra**: consume `partialsByRegister` (WP-3)
  — interpolate partial tables + B across the keyboard instead of one
  mid-register compromise. The single highest-impact realism item for
  strings and piano.
- **G2 · Conical bore resonator class**: sax/horn family (full harmonic
  series with characteristic drive; distinguishes sax from clarinet
  physically rather than by amp-table accident) + clarinet's
  register-dependent even-partial rise.
- **G3 · Nonlinear dynamic brightening**: extend `dynamicBrightness` with a
  per-preset "blare" curvature (brass spectral enrichment at forte; also
  serves bowed sul-pont-ish edge at high force).
- **G4 · Two-stage decay**: double T60 (fast early stage / slow
  aftersound) for struck/plucked. (Release ring on note-off already
  landed — `releaseRingSeconds`, synth.js:1297.)
- **G5 · ~~Attack stagger~~ — LANDED** (`partialOnsetDelay`, synth.js:1289;
  measured `bandT90ms` consumed). No work remains; listed to prevent
  re-filing.
- **G6 · Voice source model**: glottal tilt parameter + singer's-formant
  body band + pitch-synchronous breathiness. (f0 wander already landed —
  `f0WanderTrace`, synth.js:1305.)
- **G7 · Velocity→hardness coupling**: harder strike = brighter hammer
  spectrum, needed for piano/guitar dynamics realism.
  (Velocity→attackNoise level already landed — synth.js:4640.)

Each gap = its own commit with the standard acceptance: headless assertions
green, neutral-by-default proven (golden generation fixtures unchanged),
zero console errors in a live walkthrough.

---

## 7. Work packages — user settings and UI

### WP-9 · Family-morph validation of the exposed set
Consolidate the ledger + morph results into the decision table: for each
continuous parameter → **expose as knob / Advanced / retire**, per stage.
The acceptance test for the exposed set is executable: for each family, a
scripted morph (only exposed dials) from each instrument to each other
instrument reaches ≤ 25% excess loss (§5 step 4), asserted by a
`scripts/tone_match/verify_morph.py` run over the frozen presets.
**Accept**: decision table in this doc (appended as §9); morph script
green for all four families; owner sign-off on the table before WP-10.

### WP-P · Playback compression pass (after fine-tuning, before UI)
Separate, deliberately last-of-the-audio-work (§9 decision 8): fidelity is
fitted first at full density; then, per preset, derive the shipping
variant so lesser hardware can play it.

- **Measure first**: benchmark each frozen preset's real cost (per-note
  model math + live oscillator count + automation load, the T-B7 method;
  8-voice polyphony on a throttled-CPU Playwright run as the stress case)
  against the median current factory starter. **If a preset is no more
  effort than current sounds, it ships as-is — no compression.**
- **Automated compression where needed**: greedy reduction driven by the
  WP-2 scorer — drop the least-audible partials / lower `spectralPartials`
  / thin automation (transfer, body-AM strides) step by step, re-scoring
  each step, until the next step would cost more than a fixed
  perceptual budget (e.g. +0.5 dB mel distance or any construction-
  checklist failure). Ship the compressed variant as the playback preset.
- The full-fidelity parameter set is retained alongside (it is just
  params — no storage cost) for research use, offline export, and future
  hardware; compressed vs full pairs go into the capstone audition kit so
  the human gate also confirms the compression is transparent.
- No engine changes expected (audibility culling already exists); if a
  cheap win needs one (e.g. a per-preset automation-stride cap), it
  follows §6 rules.

**Accept**: every shipping preset ≤ 1.25× median current-factory cost on
the benchmark AND 8-voice polyphony clean on the throttled run; compressed
vs full A/B/X indistinguishable at the capstone (or the delta documented
and owner-accepted); zero changes outside excitor/resonator/body scope.

### WP-10 · Sub-note inspector iteration
The current CHORDA rail is the baseline; deviations need written
justification against the ledger (this is the owner's explicit rule —
usability first, no added confusion). Anticipated changes, all inside the
three in-scope inspectors (`chInspectorHTML`, app.js:14200–14297):

- Re-rank knobs so ledger-validated dials come first; demote uniform/
  insensitive params into the existing `<details>` Advanced pattern
  (app.js:14251) — same component, no new UI vocabulary.
- New engine params (§6) surface as ordinary `knobHTML` knobs or Advanced
  sliders with `PARAM_DESC` tooltips; register keys in `liveSubnoteParams`
  (app.js:8890) so drags are live.
- Visual cues, reusing existing canvases: bore shape on the excitor
  string/drive diagram (`drawStringDiag`, app.js:15071) when blow is
  active; two-stage decay visible in the resonator thumbnail T60 curve
  (`drawChThumbs`, app.js:14497); singer-formant band on the body ridge
  (`drawBodyRidge`, app.js:16106). No new visualisation *types* without
  justification.
- Preset cards: the 11 instruments appear in the browser strip as factory
  sound modules (already the mechanism — `m2PresetStripHTML`, app.js:9927);
  no browser-strip redesign.

**Accept**: Playwright walkthrough extended (`tests/browser/`): open
sub-note tab, load each of the 11 presets, touch every exposed knob, zero
console errors; all existing tests green; cache-bust bumped; screenshots at
3 window widths attached to the PR; **owner sign-off on the built UI**.

### WP-11 · Capstone QA + docs
Full sweep: all 11 presets × play/tweak/save/reload; saved-preset
migration from pre-2.0 params verified; USER_MANUAL.md + TERMINOLOGY.md +
ROADMAP.md updated; `APP_VERSION` bumped (if not already at first engine
WP); ledger and this doc marked final.
**Accept**: CI green; owner final audition of all 11 (the §3 blind gate);
docs updated; no layers/effects/space diffs anywhere in the branch history
(`git diff --stat` audit against the boundary files);
**humanisation calibrated (§2.5c) — HARD GATE for the production suite
(owner, 2026-07-16)**: every shipped preset carries fitted `humanRanges`
from take-pair differential fits (or the documented proxy), the
decomposition test has run per instrument with its verdict recorded, and
the Human dial demonstrably spans measured player variation — no preset
ships with hand-guessed humanisation ranges.

---

## 8. Sequence and dependencies

```
WP-R dossiers ─┬───────────▶ (checklists → WP-2 scorer; verdicts → §6; controls survey → WP-9)
WP-0 corpus ───┼▶ WP-3 fits ─┐
WP-1 render ───┤             ├─▶ WP-4 loop ─▶ WP-5 blown ─▶ WP-6 bowed ─▶ WP-7 struck ─▶ WP-8 sung
WP-2 score ────┘             │                  (each campaign pulls §6 gap WPs as its dossier or
                             │                   residuals demand; G1 register-spectra is
                             │                   near-certain and can start as soon as WP-3 lands)
                             └───────────────────────────▶ ledger accumulates throughout
WP-9 morph validation (after campaigns) ─▶ WP-P compression ─▶ WP-10 UI ─▶ WP-11 capstone
```

WP-R/0/1/2 are independent — run in parallel (WP-R informs WP-0's register
selection and WP-2's sanity assertions, so start it first). Campaign order may interleave
with §6 engine WPs; each engine WP triggers a cheap re-loop (renders are
fast, references cached) of every already-frozen preset to catch
regressions.

## 9. Owner decisions — RESOLVED 2026-07-15

1. **"Contrabass" male voice = basso profondo / oktavist.** Fit a normal
   bass from VocalSet, extend the lowest octave using a modelling-synth or
   choir-library capture.
2. **Boy soprano — best-effort tier.** Use a good reference if the corpus
   search finds one; otherwise CONSTRUCT the preset from the other fitted
   voice presets plus vocal-morphology knowledge (smaller tract →
   formants scaled up ~15–20%, higher f0 range, lighter vibrato, purer
   spectrum — the sung dossier must include the scaling laws). Owner:
   "no big deal if it doesn't fit as well as the others." It is exempt
   from the §3 quantitative tripwires when no reference exists; the
   capstone audition still judges it for plausibility.
3. **VocalSet download approved** (~3 GB, CC BY 4.0) for the adult voices.
4. **Tenor sax**: modelling-synth capture stands (per the original brief)
   if the corpus check confirms no free tenor source.
5. **Human intervention is minimised.** The loop gates on automated
   metrics + dossier checklists only. One blind A/B/X audition at the
   capstone: owner + one naive listener (owner's spouse), run from the
   WP-2 audition kit — human ears are the very last stage.
6. **Factory slots** (refined 2026-07-15): the 11 fitted presets replace
   the starters outright. A "classic" tag is used ONLY where a legacy
   starter is significantly different in character from its replacement —
   if the new preset is a clear improvement on the same instrument and
   ships before the platform has many users, drop the legacy version, no
   tag. Decide per starter during each campaign's freeze step (WP-5..8
   step 3); old *saved user presets* still migrate regardless.
7. **Interim instruments become presets** (2026-07-15): every instrument
   fitted to convergence as a stepping stone toward a requested target
   (standard bass → basso profondo, alto sax → tenor sax, adult voices →
   boy soprano construction) is itself frozen, gated, ledgered, and
   shipped as a factory preset — the catalogue grows beyond the 11 at no
   extra fitting cost. Same rule applies to already-measured instruments
   refreshed in passing (flute, trombone) if their loops are re-run.
8. **Resource constraint** (2026-07-15): if a fitted preset costs no more
   to play than current sounds, ship it untouched. Otherwise a SEPARATE
   compression pass (WP-P), run after fine-tuning, derives a cheaper
   playback variant (scorer-guided partial/automation reduction) so
   presets stay usable on lesser hardware; the full-fidelity parameter
   set is kept alongside. Fidelity is never sacrificed during fitting —
   compression is a distinct, later stage.
9. **No "good enough" stopping** (2026-07-15): the loop runs as long as
   the owner likes. Tripwires are ship minimums, not targets; agents may
   only stop refining by demonstrating the reference-variability floor
   (§2.5), and every session must end with an improvement, a named
   limiting factor + filed fix, or that demonstration. Best-so-far presets
   are never regressed.
14. **Soundscape synth phase — PROPOSED, GATED** (owner, 2026-07-17):
    a future SG2 extension for non-instrument sounds fitting the app's
    philosophy — rainfall, wind, engine sounds, breathing, fans, etc.
    Phase shape when unlocked: (a) brainstorm + research annex of
    synthesisable-and-useful sounds, taxonomised into CONTINUOUS
    (wind, fans, engines, breathing) vs HITS (drips, impacts, gusts);
    (b) recorded-reference availability check per candidate BEFORE any
    modelling (same corpus methodology; licence-checked); (c) campaign
    per accepted sound under the standard loop. Technical note: the
    engine's newest machinery is unusually well-suited (noise-floor
    architecture T-001, envelope-anomaly classes L16, bar/membrane
    resonator classes, stochastic per-note draws) — rain is an ensemble
    of hits, an engine is periodic+noise, wind is a body-filtered noise
    floor. **HARD GATE (owner: "before embarking I need to see the
    current models reach a higher level of accuracy — I'm not confident
    we can get there")**: no soundscape work of any kind until [proposed
    unlock, owner-adjustable]: at least two instrument families have
    presets passing ALL gate families (construction + tripwires +
    distributional) with an owner listening verdict of "same instrument,
    different player". Until then this decision exists only so the idea
    and gate are on record.
13. **Criteria-gap verdicts** (owner, 2026-07-17): (a) **Loudness stays
    normalised** — sources are inconsistently level-normalised, so
    absolute-loudness fitting would fit recording levels, not
    instruments; "ff feels ff" is carried by normalisation-surviving
    features (tilt, blare, noise ratio). Do not add a loudness
    criterion. (b) **Release/note-off criterion commissioned,
    corpus-gated**: a mechanical TAIL AUDIT first labels every
    reference `hasRelease` (energy decays into the noise floor before
    file end) vs truncated; release features (post-note-off ring time,
    damp rate, release noise) exist ONLY on hasRelease rows, and
    acquisition prefers full-tail takes. (c) **Note transitions remain
    out of scope** (single-note fitting) — the tail audit additionally
    tags phrase/legato takes (Philharmonia has them) as future
    transition material, unscored for now.
12. **Sung targets revised to standard voice sections** (2026-07-17):
    the sung family targets are now the typical section types —
    **soprano, mezzo-soprano, tenor, bass** — each fitted from its
    approved VocalSet identity singer (tenor=m3, bass=m8, mezzo=f5;
    soprano primary to be selected from the corpus-labelled sopranos by
    the same evidence procedure). **Basso profondo is demoted to a
    SECONDARY nice-to-have**: approximated AFTER the four section types
    pass their gates, derived from the fitted bass (downward f0/formant
    extension per the morphology method), no dedicated capture required
    unless the approximation fails owner ears. Boy soprano remains
    decision-2 best-effort construction. Decisions 1's capture extension
    is superseded by this derivation-first approach.
11. **Agent B retired; lanes reorganised** (2026-07-16): Agent D owns
    BOTH the bowed campaign and the analysis infrastructure
    (`scripts/tone_match/**`, `scripts/fit_profiles_from_samples.py`,
    profile/reference pipelines) inherited from B. Agents A and C are
    consumers of that infrastructure (specs via the exchange, T-007
    assertions on every handoff). First-order handover debt: B's
    unmerged branch `agentb/analysis-lane` (recalibrated profiles v3,
    unity-reproduction convention, T-025 contract spec) must be
    verified and integrated by D before any of its contents are
    trusted or built upon.
10. **Struck/plucked family expanded** (2026-07-16): piano splits into
    grand + upright; acoustic guitar splits into steel-string +
    nylon-string; harp and glockenspiel added. Glockenspiel exercises the
    `bar` resonator class (strongly inharmonic mode set) — the first
    non-stringed struck target. Decision 7 (interim presets ship) and all
    standing rules apply. A dedicated agent (Agent C) owns this family
    end-to-end per the multi-agent operating mode.

## 10. Exposure decision table

*(Populated by WP-9 from the ledger — placeholder until then.)*
