# WP-6 bowed campaign — preflight scaffold

Lessons from the blown campaign (reviews + owner listening L1–L5b),
converted into scaffold that must exist BEFORE the first violin/cello fit.
Rationale for the ordering rule: every audible deficiency the owner found
in blown was in a dimension the scorer could not measure — the loop can
only fix what it can see. Give the scorer its senses first.

## P1 · Scorer senses for bowed (add before fitting)

| Feature | Why (blown lesson) | Bowed specifics |
|---|---|---|
| Sustained noise-to-harmonic ratio per dynamic | L1 — breath ratio was invisible | Bow-hair friction noise is the strings' breath; expect ratio ↑ at pp and near the bridge |
| Onset-window vs sustain spectrum | L2 — plosive was invisible | Bow starts: scratch/creak band before Helmholtz lock-in |
| Onset f0 trajectory | L5 — scoop was invisible | Bow onsets wander/settle rather than scoop from below; measure, don't assume |
| Onset noise-lead time | L4 — breath led the tone at pp | Scratch-lead before the tone speaks at soft starts |
| **Vibrato trajectory** (new) | rate/depth alone proved too coarse | Onset delay (vibrato starts after the note settles), depth ramp-in, rate drift — strings are THE vibrato family; a static rate/depth fit will sound mechanical |
| **Body-AM depth under vibrato** (new) | — | FM→AM through body ridges already exists in-engine (T5); the scorer must measure AM depth so the fit exercises it |

## P2 · Body deconvolution in analysis (the violin spread problem)

The original fit saturated violin/cello per-partial spread at the 0.8 cap
because fixed-Hz body resonances re-weight partials differently at every
semitone (docs/MEASURED_PROFILES.md, Limitations 3). Do not fit per-partial
tables directly from single notes. Scaffold: estimate the fixed-Hz body
envelope FIRST from the across-note ensemble (partial (f, amp) points from
all takes form a dense sampling of the body response — fit a smooth
envelope / peak set), assign it to `bodyBands`, divide it out, THEN fit
the per-partial excitation tables on the residual. This is the
excitor/body separation the architecture was built for; it should make
string spectra fit with small spreads and make register tables meaningful.
Validate: refit violin, check per-partial spread drops well below the cap
and fitted body peaks sit at note-independent frequencies.

## P3 · Reference handling rules (blown mistakes, pre-empted)

- **Per-string identity**: Iowa string takes are labelled sulA/sulD/sulG…
  The same pitch on different strings is a different sound. Carry `string`
  through references.json; floor groups must be same-string (extend the
  same-source, duration-matched floor rule from the review fixes).
- **Bow-change segmentation**: long arco takes can contain bow direction
  changes mid-note. The analysis must detect amplitude/flux dips and trim
  to single-bow segments, or fits will chase bow-change artifacts as if
  they were timbre.
- **Vibrato routing**: Iowa arco is senza vibrato (spectral truth),
  Philharmonia supplies vibrato takes (vibrato truth). Keep the roles
  separate as in the original fit; QC screen per L3 (take-specific, not
  source-blanket).
- **Outlier screen** runs on the string corpus before the reference sets
  are frozen, with flagged takes listed in COVERAGE.md for owner ears.

## P4 · Excitation-generic onset + noise architecture

**FAMILY FIREWALL applies (OWNER_LISTENING_NOTES.md header): mechanisms
transfer, values never do.** Every blown-fitted slope/coupling/exponent
ships neutral for bowed until the bowed dossier supports the mechanism
AND the string corpus fits the value. Within-instrument vs
across-instrument slopes are separate parameters (they had opposite
signs for blown scoop — assume nothing for bow). Imperfections are
human: Human-scaled, subtle by default, suppressed by strong
articulation draws.

Design the L2/L4/L5/L5b rework EXCITATION-GENERIC now, not blow-specific,
so strings inherit it instead of getting a parallel implementation:

- **Excitation noise floor** (L4 rework): one architecture — noise source
  → body-band routing → envelope-coupled gain (airflow/bow-speed proxy) ×
  inefficiency ratio law (↑ at pp) + seeded turbulence texture. Blow:
  breath. Bow: hair friction (scratch colour differs; higher centroid,
  position-dependent). Same params, per-excitation defaults.
- **Articulation strength** (L5b): the latent per-note draw generalises —
  martelé/accented bow ⟷ soft floated start maps exactly to
  tongued ⟷ breath-started. Strong: crisp scratch transient, immediate
  pitch. Weak: scratch lead, slow speak, pitch settle. Same
  anticorrelation structure, coupling fitted per family.
- **Scoop generalisation**: for bow the onset pitch behaviour may be
  wander/settle rather than scoop-from-below — fit the measured
  trajectory shape rather than hard-coding the blown shape (P1 feature
  makes this possible).

## P5 · Discipline gates (must be closed before WP-6 starts)

From the branch review — non-negotiable preconditions:
1. Tripwire gate implemented, with the recorded recalibration verdict.
2. Leaderboard reference-set carry-forward rule (re-score prior best on
   any new set as mandatory baseline).
3. `registerProfileAt` above-range bug fixed + above-anchor assertion
   (strings will hit high registers immediately).
4. Render-path golden landed, and the D1/D2 neutrality decision recorded.

## Progress notes — Agent B (analysis lane), 2026-07-16

**P1 scorer senses: LANDED.** New score features (all zero-weight for blown
— comparability rule; the objective id changes, so blown leaderboards
re-baseline per P5.2 on their next run): `vibrato_onset_delay_ms`,
`vibrato_ramp_ms`, `vibrato_rate_drift` (vibrato trajectory, measured in
`vibrato_stats` as additive keys), `body_am_db` (tracked-partial AM at the
vibrato rate), `onset_noise_db` + `onset_noise_centroid_oct` (scratch-window
spectrum), `noise_lead_ms` (noise-lead before the tone speaks),
`onset_wander_cents` (onset f0 wander both directions — the blown
scoop-from-below semantics are untouched). Each landed with a unit test.

**P2 body deconvolution: LANDED, validation split verdict.**
- Fitter: `fit_fixed_body` v2 — alternating rank/note/body robust fit,
  ~1/3-octave Gaussian bands (band count adapts to corpus span), ridge
  regularised, emitted as `resonances` with a `resonancesFit` provenance
  record including a per-fit split-half stability self-check.
- Measurement: sustained notes now use a vibrato-robust per-frame harmonic
  tracker (band-energy readout; the old long-window FFT peak-read produced
  5+ dB errors and 30–50 dB outliers under vibrato). Percussive notes keep
  the legacy early-window path.
- **Body note-independence: DEMONSTRATED.** Violin split-half envelope corr
  0.70 with the bridge-hill peak stable at 2343/2387 Hz (27 cents apart,
  inside the dossier's 2.0–3.2 kHz gate); cello 0.94; most instruments
  0.7–0.98. Each profile records its own numbers in `resonancesFit`.
- **Spread de-saturation: DISPROVEN by evidence.** The 0.8 saturation was
  NOT caused by body re-weighting alone. Three fixes landed (body division,
  within-file same-string/same-dynamic pair estimator replacing the pooled
  cross-dynamic chain, robust measurement) and the saturation persists for
  most ranks ≥ 3 because the per-note deviation is real: violin shows
  bow-position comb wander (deep single-partial notches that move note to
  note, e.g. p3 −33 dB on one semitone); clarinet fingering makes every
  note a different tube (p2 jumps −43 → −10 dB across the break). The
  historic estimator saturated EVERY instrument for a different reason
  (pooled cross-dynamic diffs); the honest per-note variability for strings
  still sits at/above the cap. §2.5(b) work item: model per-note variation
  structurally — seeded per-note excitationPosition/articulation draws
  calibrated from take pairs (§2.5c) — rather than widening independent
  per-partial noise.
- Profiles regenerated for all 12 corpus instruments (trombone legacy fit
  carried forward; `--keep-existing` flag added so partial or full re-runs
  can never silently drop an instrument again).

**Data contract (proposed to Agent A — ack requested in the landing PR/commit):**
`resonances`: list of `{freq: Hz, gain: log2 (clipped ±1.5), width: log2-
octave sigma}` — unchanged from the shape the engine already consumes.
`resonancesFit` (new, sibling key, analysis-side provenance only — not
copied into measured_profiles.js): `{method: "ensemble-rank-note-body-v2",
bands, points, notes, widthLog2, splitHalfCorr, peakHzA, peakHzB}`.
Band count is now up to 16 (was 7) and widths ~0.18 log2 (was ~0.5).
**Blown partial tables and spreads changed materially** (better measurement
+ finer body division; clarinet media ~5 dB per-partial): blown campaign
leaderboards must re-baseline (P5.2) — which the L6 refits require anyway.

**P3 references: in progress.** P4 is design guidance for Agent A's engine
work; P5 gates remain Agent A's to close.

## P6 · Cheap wins to bank while set up (decision 7)

- Iowa has violin/cello **pizzicato** takes: fitting them is nearly free
  once the bowed corpus is loaded (pluck excitation, same body from P2 —
  a strong validation that the body/excitor separation works: same fitted
  bodyBands must serve arco AND pizz). Ship as interim presets.
- The P2 body-envelope method, once proven on violin, applies retroactively
  to the blown family (horn body ridges) — note the re-fit opportunity in
  the work-items list, don't block on it.
