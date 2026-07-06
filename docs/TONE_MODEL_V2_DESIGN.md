# Tone Model v2 — Ground-Up Redesign (owner brief 2026-07-05)

Owner: fix the tone design; make it far more intuitive; this feeds a
ground-up UI redesign. Ignore the current design principles — plan fully
before implementing. Starting points, verbatim from the brief:

1. **Resonant frequency transfer dial** — for each frequency, does it
   interact with the octave/fifth etc.? Grounded in *actual frequencies*,
   not equal temperament.
2. Replace **amplitude probability** with something physical — "imagine a
   string instrument pulling a bow; how do we mimic imperfections?"
3. **Number of frequencies** should parallel the best instrument modellers.
4. The **key variables of instrument character** must be easily surfaced.
5. **Re-inspect every current interaction** for grounding in acoustic
   theory, physics, and instrument-modelling practice.
6. **UI ground-up**: don't show all frequencies at once — an intuitive,
   aesthetic way to filter through them that shows up visually in the tone
   print.

Decisions taken with the owner (2026-07-05):

- **Scope**: tone/timbre section first; its design language extends to the
  rest of the app in a later phase.
- **Reference**: no image — this text is the brief; visual direction is
  proposed via mockups for owner review.
- **Formant path**: unified into one physical model (excitation →
  resonator → body). Vowels become body settings.
- **Presets**: best-effort migration; factory starters rebuilt natively.

---

## 1. Audit — what the current model gets wrong (and right)

Confirmed in `web/static/synth.js` as of `f27da48`:

| # | Current behaviour | Physical reality | Verdict |
|---|---|---|---|
| A1 | Each partial's amplitude is drawn **independently** from its own Gaussian (mean/SD) at note onset; "Hold drift" redraws each partial independently during the note. | Spectral fluctuation in real instruments is **excitation-driven and coherent**: bow force/velocity, breath pressure, or strike variation move the whole spectrum together (with rank-dependent sensitivity — Schelleng: higher partials react more to bow force). Independent flicker per partial is the signature of *additive synthesis*, not an instrument. | **Replace** — the owner's bow-imperfection point, exactly. |
| A2 | Material damping scales decay by **harmonic rank**: `tau ∝ 1/(1 + m·(n−1)^0.9)`. | Damping is a function of **frequency in Hz** (viscoelastic + radiation losses rise with f). A partial at 4 kHz should decay the same whether it is n=4 of a high note or n=16 of a low one. Rank-based damping makes low notes unrealistically dead and high notes unrealistically ringy. | **Reground** in true Hz: `T60(f)`. |
| A3 | Material `tau` is derived from **note duration** (`baseTau = (t1−t0)·0.9`). | A struck/plucked mode's T60 is a property of the *instrument*, not of how long the player holds the key. | **Reground** — absolute T60s. |
| A4 | Inharmonic stretch: quadratic cents ramp by rank, **normalised by the number of visible partials** (`maxIndex = partials.length−1`), capped ±24¢. | Stiff-string physics: `f_n = n·f0·√(1 + B·n²)`. The same B must give the same frequencies regardless of how many partials are rendered; the current form changes pitch content when the partial count dial moves. | **Replace** with the real formula; expose B. |
| A5 | **No interaction between partials whatsoever.** | Sympathetic energy transfer between near-coincident modes (string↔string, string↔body, mode↔mode) is a defining behaviour of acoustic instruments — the bloom of a piano chord, the singing of a violin's open-string sympathies. | **Add** — the transfer dial (§3.4). |
| A6 | Fixed-Hz body resonances exist (`SPECTRAL_RESONANCES`, log-distance Gaussians) but are computed **once per note onset** as a static gain. | Right idea, right units — this is the one physically honest piece. But static-per-note means vibrato does not produce the AM that real bodies impose on FM (a large part of "alive" vibrato). | **Keep & promote** to a first-class Body stage; track modulation. |
| A7 | Per-partial `reg` coefficients scale amplitude by register (rank-based, ±2 range). | Register-dependent timbre in real instruments emerges from **fixed-Hz body filtering** (A6) plus excitation scaling — not from per-partial hand overrides. | **Retire**; emerges from Body. |
| A8 | Hidden `1.4/√harmonic` gain rolloff baked into the render path, invisible to the UI. | Undocumented shaping contradicts "the print is the truth". | **Remove**; fold into excitation spectra. |
| A9 | Loudness normalisation slew-hack corrects random draw energy. | With coherent excitation-driven variation (A1), energy is conserved by construction — the excitation has one level. | **Retire** with A1. |
| A10 | 32 partials, measured up to 16 then stride-2 extrapolated. | RipplerX-class modal modellers run **64 partials** from ratio tables; Pianoteq-class models more. | **Grow to 64** (§3.2, with audibility culling). |
| A11 | Comb macro groups by harmonic-number log distance. | Harmonic numbers *are* true ratios for a harmonic series, so this is fine — but once inharmonicity bends the series (A4), grouping must follow **realised Hz**, not nominal rank. | **Reground** on realised frequencies. |
| A12 | Formant mode: separate sawtooth → 5 bandpass bank; Fourier mode disables it (and vice versa). | A voice IS excitation (glottal pulse ≈ tilted harmonic-rich source) → resonator → body (vocal tract). The two-mode split is an implementation seam, not a physical distinction. | **Unify** (owner decision): vowels become Body presets. |
| A13 | Attack: all partials start together under one shared envelope (plus attack-noise sample). | Bowed/blown attacks develop **low→high** (upper partials arrive late); struck/plucked attacks start **all-at-once then shed highs**. Onset order is a strong instrument-identity cue (McAdams). | **Add** per-partial onset behaviour from excitation type. |
| A14 | Velocity→timbre via per-partial `dyn` exponents. | Directionally right (louder = brighter is real physics: nonlinear string/air behaviour). Keep the *behaviour*, replace per-partial hand grids with one **dynamic-brightness law** + excitation nonlinearity. | **Simplify & keep.** |

**Summary**: the bones worth keeping are the fixed-Hz body resonances (A6),
velocity→brightness (A14), Nyquist culling, deterministic seeding, and the
macro write-through philosophy. The amplitude-probability core (A1/A9), the
rank-based laws (A2/A3/A4/A7), and the two-source split (A12) are replaced
by a physical signal chain.

---

## 2. The model in one sentence

**Every sound is an excitation driving a resonator heard through a body** —
three stages, each with few, physically meaningful controls; the partial
set is computed, not hand-painted; randomness enters only where physics
puts it (the human driving the excitation).

    EXCITATION ──▶ RESONATOR (64 modes) ──▶ BODY (fixed-Hz) ──▶ [Space]
    how energy      what frequencies exist,   what the box       existing
    enters          how they ring & couple    around it does     reverb

This is the architecture every serious modeller converges on (RipplerX:
exciter → modal resonator × material; Resonarium: exciter → waveguide bank →
coupling; Pianoteq: hammer → stiff string → soundboard).

---

## 3. Stage specifications

### 3.1 Excitation — replaces "amplitude probability"

| Parameter | Range | Physics |
|---|---|---|
| Type | bow · pluck · strike · blow | Selects the drive spectrum, its time behaviour, and the imperfection character. |
| Position | 0.02–0.5 | Where the string/tube/membrane is excited. Imposes the node comb `sin(nπx)` on mode n — pluck at 1/2 kills even partials (this *absorbs* the odd/even macro and the comb macro into one physical control); near the bridge = bright, middle = hollow. |
| Force / velocity | 0–1 | Drive level; nonlinearly brightens (dynamic-brightness law, A14). |
| Hardness (strike/pluck) | 0–1 | Contact time → spectral rolloff corner: soft mallet = long contact = dark; hard hammer = short = bright. |
| **Human** | 0–1 | The imperfection dial (below). |

**Drive spectra** (per type, before position comb): bow ≈ 1/n (sustained
Helmholtz sawtooth, continuously driven); pluck ≈ 1/n² (displacement
initial condition); strike ≈ flat-to-1/n with hardness-set corner (force
impulse); blow ≈ 1/n with breath-noise floor and odd-harmonic bias option
(closed tube).

**The Human dial — bowing imperfection, done physically.** One pink-noise
(1/f) fluctuation source *per note* modulates the excitation coherently:

- Drive level wobbles slowly (bow-pressure drift, breath support).
- Spectral slope wobbles with it (Schelleng: more force = brighter), so
  all partials move **together**, upper ones proportionally more.
- Type-specific micro-events ride on top: bow re-grip grain and slip
  noise; breath turbulence bursts; strike/pluck get per-note variation
  only (velocity/hardness jitter — a hammer cannot wobble mid-note).
- Depth of all of this = the one dial. Rate is derived (bow ≈ 0.5–4 Hz
  drift + 20–80 Hz grain; breath ≈ 0.3–2 Hz).

Deterministic: the fluctuation is drawn from the seeded RNG, so takes
remain exactly reproducible (research requirement).

This **replaces**: per-partial SD grid as independent randomness, Sample
chance, Hold drift depth/rate, loudness normalisation. The old per-partial
SD values are reinterpreted on migration as per-partial *sensitivity* to
the shared fluctuation (normalised), preserving the flavour of presets
that had wildly uneven SDs.

### 3.2 Resonator — the 64 modes

- **Count**: 64 partials (parity with RipplerX-class modellers), culled at
  render time to those below min(16 kHz, Nyquist·0.45) *and* above an
  audibility floor (−60 dB post-shaping) — typical sounding set is 20–40
  oscillators, so CPU stays close to today's.
- **Frequencies**: from the ratio table of the selected resonator class —
  string/open tube (1,2,3…), closed tube (1,3,5…), membrane (Bessel
  ratios), bar/plate (inharmonic set) — then bent by **Inharmonicity B**
  via the true stiff-string law `f_n = n·f0·√(1+B·n²)` (fixes A4; B is
  count-independent and physically citable: piano bass B≈1e-4, treble
  ≈1e-3).
- **Levels**: computed = drive spectrum × position comb × per-partial
  offsets (the only hand-editable layer, default 0 dB, preserved from old
  presets' means where meaningful).
- **Decay**: Material as a **T60-vs-frequency law in true Hz** (fixes
  A2/A3): `T60(f) = T60₀ · (f/f₀)^(−slope)` with Material morphing
  (glass/metal: T60₀ high, slope shallow → everything rings; wood: mid;
  felt/skin: T60₀ low, slope steep → highs die instantly). Sustained
  excitations (bow/blow) continuously re-supply energy, so Material there
  shapes the *release* and the attack bloom instead — one law, both
  behaviours, like reality.

### 3.3 Body — unified fixed-Hz resonances (absorbs formants)

- A body = 3–8 fixed-Hz resonance bands (freq, gain, width) applied to
  realised partial frequencies — today's `SPECTRAL_RESONANCES` promoted to
  a first-class, user-visible stage.
- **Vowels are bodies**: the five vowel landmarks (and the 2D vowel pad,
  which stays) become body presets in the same bank as "violin body",
  "guitar box", "soundboard", "brass bell". The formant/Fourier mode
  split disappears (A12); the vowel pad is simply the pad view of body
  space when a vocal body is selected.
- **FM→AM**: body gain is evaluated against the partial's *modulated*
  frequency, so vibrato through a body ridge produces the amplitude
  shimmer real instruments have (fixes A6-static). Implementation:
  per-partial gain automation at the vibrato rate when vibrato is active —
  scheduled, cheap, deterministic.

### 3.4 Resonant transfer — the new dial (owner idea #1)

Sympathetic energy exchange between modes whose **realised frequencies**
(post-inharmonicity, post-detune — never their nominal ranks, never any
12-TET grid) sit near small-integer ratios:

- For each partial pair (i,j): ratio candidates 2:1, 3:2, 4:3, 5:4, 5:3,
  6:5, 7:4… Coupling weight
  `C_ij = exp(−Δ²/2σ²) / (p·q)` where Δ = distance of `f_j/f_i` from
  `p/q` in **cents of the actual frequencies**, σ ≈ 20 cents, and the
  `1/(p·q)` factor (Tenney height) makes simple ratios couple hardest —
  octaves strongest, then fifths, fourths, thirds…
- **Behaviour**: during a note, energy flows from strong coupled partials
  into weak ones at a rate set by the Transfer dial (first-order exchange,
  scheduled as slow gain envelopes at render time — no live feedback
  needed, fully deterministic). Audible as bloom, ring, "singing" sustain.
- **Physics honesty**: as Inharmonicity bends partials away from just
  ratios, Δ grows and coupling *automatically* weakens — detuned modes
  exchange less energy. The dial interacts with B exactly the way real
  sympathetic strings detune out of resonance.
- **UI**: one Transfer dial in the character panel; on the tone print,
  selecting a partial draws coupling arcs to its relatives, labelled with
  the true ratio and its cents offset (§5).

### 3.5 What survives from today

Envelope distributions, vibrato distributions (now with FM→AM), attack
noise per excitation type, percussion, Space, the seeded determinism, and
the macro write-through principle: **the print always shows the final
computed result**, and hand edits are stored as offsets on top of the
model, never as absolute overrides that macros could contradict.

---

## 4. The character panel — key variables surfaced (owner idea #4)

Eight dials, each mapped to a perceptually validated timbre dimension
(McAdams et al.: attack time, spectral centroid, spectral flux, harmonic
structure; plus the modal-synthesis canon):

| Dial | Physics | Perceptual axis |
|---|---|---|
| Excitation (type + position) | how energy enters | attack character, hollowness |
| Brightness | drive slope + dynamic-brightness law | spectral centroid |
| Material | T60(f) law | ring vs thud; glass→wood→felt |
| Inharmonicity | stiff-string B | piano-ness, bell-ness, tension |
| Transfer | mode coupling rate | bloom, singing sustain |
| Body | fixed-Hz resonance set + pad position | vowel, box, formant identity |
| Human | coherent excitation fluctuation | aliveness, player presence |
| Level/Mix | resonator output | (utility) |

An **instrument = one setting of these eight** (plus offsets). The eight
factory instruments are re-derived in these terms — e.g. *violin* = bow +
position 0.13 + wood Material + violin body + Human 0.4; *piano* = strike
(hardness by velocity) + position 0.12 + B 3e-4 + soundboard body +
Transfer 0.3 (sympathetic bloom) + Human 0.1.

Progressive disclosure: the eight dials are always visible; everything
else (per-partial offsets, band editing, T60 curve, coupling matrix) lives
inside the tone print's focus lens (§5).

---

## 5. The tone print — UI ground-up (owner idea #6)

One large interactive display is the centre of the tone section. Nothing
else shows "all the frequencies"; the print is the single place partials
appear, and it filters *visually*, in place.

**Canvas**: log-frequency axis 30 Hz–18 kHz. Each partial is a phosphor
needle at its **realised Hz** for the current fundamental:

- **Height** = level (post-everything: excitation × comb × Material state
  × body — the truth, per the write-through rule).
- **Afterglow trail** = decay: long-ringing partials (glassy Material)
  leave long phosphor persistence; damped ones snuff out. Material becomes
  *visible* — the CRT aesthetic the owner chose is kept and made literal.
- **Body ridge** = translucent curve behind the needles (the fixed-Hz
  resonance profile); vowel pad appears beside it when a vocal body is
  active.
- **Excitation comb** = faint underlay showing `sin(nπx)` zeros moving as
  Position turns — you *see* the even partials die as position → 1/2.
- Live playback lights the needles from the analyser.

**Filtering through the partials — three lenses, no grids:**

1. **Relationship lens** (default): tap a partial → its true-ratio
   relatives light up (2:1, 3:2, 5:4…), each labelled `3:2 −4¢`, with
   Transfer coupling arcs whose opacity = coupling strength. This is the
   owner's "for each frequency, does it interact with the octave/fifth"
   made directly visible — and it is honest: with inharmonicity the labels
   drift away from the pure ratios and the arcs fade.
2. **Focus lens**: drag a span of the axis → that band expands (fisheye)
   for editing; the rest compresses but stays in context. Inside the lens:
   drag a needle = level offset; ⌥-drag = per-partial detune in cents;
   scroll = per-partial T60 scale. A compact numeric strip appears for the
   focused band only. (Replaces the 32-column slider grid and the paginated
   harmonic editor entirely.)
3. **Band chips**: `fundamental · low body · mid · presence · air` chips
   (Hz-defined bands, not rank-defined) jump the focus lens; band-level
   quick faders replace the old six octave-group faders.

**Layout** (tone section, ground-up — REVISED per owner feedback
2026-07-06: "I don't see where the Excitor, resonator, body and space
paradigm sits" — the signal chain must BE the layout, not an implicit
grouping of dials):

    ┌────────────────────────────────────────────────────────────┐
    │ INSTRUMENT: [violin ▾]        character preset bar (save/load) │
    ├────────────────────────────────────────────────────────────┤
    │ 1·EXCITOR → 2·RESONATOR → 3·BODY → 4·SPACE   (stage cards) │
    │  excite      material       body sel   room/wet             │
    │  position    inharmonic     ridge vis  (links existing      │
    │  hardness    transfer       vowel pad   Space section)      │
    │  human       bright·level   when vocal                      │
    ├────────────────────────────────────────────────────────────┤
    │ 2·RESONATOR — TONE PRINT (the resonator's expanded view)    │
    │   needles · afterglow · body curve · excitor comb           │
    │   on-canvas legend · axis title · [relationships|focus]     │
    ├────────────────────────────────────────────────────────────┤
    │ disclosure: envelope/vibrato · attack noise · T60 curve ·   │
    │ coupling matrix · per-partial table                         │
    └────────────────────────────────────────────────────────────┘

Every control lives visibly inside its stage; the arrows are the signal
path; the print is labelled as the RESONATOR's view, with the body curve
and excitor comb overlays explicitly attributed to their stages. Owner
also flagged the print itself as "not amazingly intuitive" — rev B adds
an on-canvas legend, an axis title, and fewer/clearer coupling arcs, and
T7 must treat print legibility as a first-class acceptance concern.

Design language: dark pro-audio shell retained; the print's phosphor/CRT
identity becomes the app's signature element and the reference for the
later whole-app redesign phase. A static HTML mockup accompanies this doc
(`docs/mockups/tone-print-v2.html`) for owner review before any engine
work begins.

---

## 6. Research integration

- New parameter keys form schema `tone-2.0`; `APP_VERSION` bumps when T1
  lands so `stimulus_id`s never collide across models. Old event logs stay
  interpretable via their recorded app_version.
- The Human dial's fluctuation trace is seeded → per-note surprisal and
  repetition metrics remain exactly reproducible.
- Transfer, Inharmonicity, Material become *quantifiable stimulus
  dimensions* (real physical units: coupling rate, B, T60 slope) — better
  variables for the appeal study than the old ad-hoc grids.

## 7. Migration map (best-effort, per owner decision)

| Old | New |
|---|---|
| spectralProfile | instrument = excitation type + ratio table + body preset + dial settings (8 rebuilt natively) |
| spectralPartialMeans | per-partial level offsets vs computed print |
| spectralPartialSds | per-partial Human sensitivity (normalised) |
| spectralPartialDyns/Regs, spectralDynamic/RegisterAmount | dynamic-brightness law (global); per-partial grids retired |
| partialTilt | Brightness |
| partialMaterial | Material (rank law → T60(f) law, calibrated to sound alike at C4) |
| spectralStretchCents | Inharmonicity B (converted at 32-partial reference) |
| partialOddEven, partialComb/Freq | Excitation position (+ odd bias for closed-tube blow) |
| partialGroup1–6 | band quick-faders (Hz bands) |
| Formant mode, vowel pad, FORMANT_PRESETS | vocal Body presets; pad drives body when vocal body active |
| spectralProb, spectralDrift* | Human dial |

Loader translates old presets/instruments on read (like the producer's
slot→beat migration); a calibration pass makes each factory instrument's
migrated sound as close as the new model allows, then the native rebuild
supersedes it.

## 8. Acceptance bar — ALL must pass before "done"

Functional:
- [ ] T-B1 Excitation types audibly distinct and physically behaved
      (position comb kills the right partials — measured, not eyeballed).
- [ ] T-B2 Material is a true-Hz T60 law: same-Hz partials decay alike
      across different fundamentals (headless assertion).
- [ ] T-B3 Inharmonicity uses `f_n = n·f0·√(1+B·n²)`; partial count does
      not change frequencies (headless assertion).
- [ ] T-B4 Human dial: fluctuations coherent across partials (correlation
      test), deterministic per seed, zero at 0.
- [ ] T-B5 Transfer: energy exchange strongest at just ratios of realised
      frequencies, weakens with cents distance and with rising B
      (headless assertion); audible bloom demo.
- [ ] T-B6 Body unification: vowel pad reproduces the five vowels through
      the body stage; vibrato produces AM through body ridges.
- [x] T-B7 CPU budget — model math measured at 0.037 ms/note at 64
      partials with Transfer 0.3 + Human 0.5 (2000-note benchmark,
      ~100x under the 4 ms budget); live 64-partial playback through
      the full T-Q1 walkthrough with zero errors. (8-voice producer
      re-check rides the producer re-audition, which the owner has
      deprioritised.)
- [ ] T-B8 Tone print: relationship lens (true-ratio labels + arcs),
      focus lens editing (level/detune/T60), band chips — all functional
      with zero console errors.
- [ ] T-B9 Old presets/instruments load via the migration map; factory
      eight rebuilt natively; producer regions using saved instruments
      still play.

Quality:
- [x] T-Q1 Scripted end-to-end walkthrough (2026-07-06): all 8 profiles
      played, all 4 excitation types switched mid-play, vowel bodies
      swapped live, 13 print needle selections + drag edit, every band
      chip, formant-mode round-trip — zero console errors/warnings.
- [x] T-Q2 A/B — adapted: instead of static WAV pairs, the OLD engine
      (pre-T1, commit 2a9caf7) is served live from a git worktree at
      http://localhost:8766 beside the new build at :8765, so the
      audition can A/B any instrument interactively. (Worktree:
      /private/tmp/synth-oldtone; restart with PYTHONPATH=src python3
      -m synthesiser.web.server --port 8766 from that dir.)
- [x] T-Q3 Tests green (20/20 + 85 tone assertions in CI);
      APP_VERSION → 0.3.0 at T1 so stimulus_ids never collide; new
      params ride event payloads/exports as ordinary parameter keys.
- [x] T-Q4 OWNER SIGN-OFF on the mockup (before build) — APPROVED
      2026-07-06: "the breaking down into Excitor, resonator, body and
      space is sensible and makes good sense for how to represent it in
      a UI too. I approve." T1+ unlocked.
- [ ] T-Q5 OWNER SIGN-OFF on the built tone section (after T8). Until
      then the roadmap marks tone v2 in progress.

## 9. Implementation stages (one reviewable commit each)

- **T0 Mockup**: static tone-print + character-panel mockup for sign-off
  (T-Q4 gate). *No engine work before this is approved.*
- **T1 Resonator core** — DONE (2026-07-06): 64-partial tables (parity-
  preserving extrapolation), RESONATOR_CLASSES ratio tables (string /
  closed tube / membrane / bar), anchored stiff-string law
  `f_n = n·f0·√((1+Bn²)/(1+B))` via exported `partialFrequency` (new
  `partialB` param; legacy spectralStretchCents maps exactly at n=32 via
  `legacyStretchToB`), Material regrounded as `materialT60(fHz, m)` —
  duration- and rank-independent; harmonic-signature display shows the
  same realised frequencies; Nyquist + 16 kHz + audibility culling;
  headless harness `scripts/verify_tone_model.mjs` (27 assertions,
  T-B2/T-B3 covered) wired into CI; APP_VERSION → 0.3.0.
- **T2 Excitation** — DONE (2026-07-06): excitationType/Position/Hardness
  params with per-instrument defaults in SPECTRAL_PERFORMANCE (bow:
  violin/cello/vocal, blow: winds/brass, strike: piano); drive spectra
  (bow 1/n, pluck 1/n², strike flat-to-corner, blow 1/n^1.15), position
  comb |sin(nπx)|, hardness contact-time rolloff (600 Hz–14 kHz corner,
  12 dB/oct) — applied as a transform NORMALISED against the profile's
  natural excitation so measured tables/old presets are untouched at
  defaults; dynamic-brightness law 0.5·log2(1+n)·dynAmount replaces the
  per-partial dyn grids (D column removed); hidden 1.4/√n renderer
  shaping retired (A8); body resonances + hardness now act on REALISED
  frequencies (T1 law). Headless: +15 assertions incl. T-B1 (comb
  silences modes 2/4 at ½, 3/6 at ⅓, measured through the engine) and
  the normalisation identity. Verified live (piano re-seats to strike,
  mid-play pluck switch clean).
- **T3 Human** — DONE (2026-07-06): excitationHuman param (per-instrument
  defaults: piano 0.1 … flute/vocal 0.5); one seeded mean-reverting
  fluctuation per note (slow pressure drift + faster grain, bow-slip dips
  / breath bursts) drives every partial together with Schelleng shaping
  (humanPartialShape); old SD grid reinterpreted as per-partial
  sensitivity (sd/mean); coherent single-draw onset variation replaces
  per-partial Gaussian sampling (A1 closed); strike/pluck get per-note
  hardness+level jitter only; continuous breath-noise floor for blown
  excitation; Sample chance / Hold drift / Drift depth / Drift rate /
  Loud norm retired from engine and UI (A9 closed — coherent excitation
  conserves its own energy). Headless: +10 assertions (T-B4 —
  determinism, coherence direction test, zero-at-0, spectralProb proven
  inert). Verified live on flute (blow floor + trace), zero console
  errors.
- **T4 Transfer** — DONE (2026-07-06): transferCoupling() — Gaussian in
  cents (σ 20) from the nearest of ten simple ratios, Tenney-weighted
  1/(p·q); transferDeltas() — pairwise-conserving first-order exchange
  from strong to weak coupled partials, computed on REALISED frequencies;
  renderer blooms the deltas over the sustain (τ 0.9 s) on the same
  automation timeline as the Human trace (checkpoint grid when Human 0);
  partialTransfer param + slider, per-instrument defaults (piano 0.3
  sympathetic bloom … winds 0.08). Headless: +11 assertions (T-B5 —
  octave max, Tenney ordering, cents falloff, true-3:2-beats-12-TET,
  inharmonicity decoupling of the 4:8 pair, silent-octave bloom with
  pairwise conservation). Verified live (piano re-seats to 0.3), zero
  console errors.
- **T5 Body** — DONE (2026-07-06): BODY_PRESETS registry — instrument
  bodies from SPECTRAL_RESONANCES plus all five vowels as vocal bodies
  (F1–F5 bands, Klatt-descending log2 gains scaled inside the response
  ceiling, widths from measured bandwidths); bodyType param + Body
  select ("Auto (instrument)" default = pre-T5 behaviour); exported
  bodyBandsFor/bodyResponse; fingerprint register response is body-only
  (per-partial reg grids + Reg response amount retired and PROVEN inert
  — audit A7; R column removed); FM→AM — the same vibrato events that
  bend pitch re-evaluate body gain at the modulated frequency per
  partial (AM node only on meaningful slopes, stride-capped, phase-
  locked, deterministic); notes carry bodyBands/bodyAmount. Remaining
  for T6: vowel-PAD continuous point as a body (per-vowel presets in
  now), full formant-mode unification. Headless: +12 assertions (T-B6
  — vowels-as-bodies frequencies, peak/slope behaviour, ee/oo
  distinctness, AM-on-slope vs stillness-at-peak, A7 inertness).
  Verified live (violin + vowel-ah body + vibrato), zero console
  errors.
- **T6 Character panel + migration** — DONE (2026-07-06, 1132744): the
  tone section IS the staged chain (rev B) — four numbered stage cards
  with flow arrows; physical B slider replaces legacy Freq stretch
  (piano re-derived natively at B 1.2e-4); body ridge mini-vis; side
  panel slimmed to Instrument + Mix + Advanced disclosure (odd/even,
  comb, octave groups); migrateToneParams() applied at preset,
  instrument, and palette-edit load (stretch→B exact, drift→Human,
  dead keys dropped — T-B9 partial). Formant source mode retained;
  unification decision deferred to T8 owner audition.
- **T7 Tone print** — DONE (2026-07-06): interactive print replaces the
  harmonic-signature display, engine-true (same fingerprint code as
  playback, Human 0): phosphor needles at realised Hz, afterglow = ring
  time (T60 law), body ridge + excitor comb overlays attributed to
  their stages, axis title. Relationship lens: tap a partial → true-
  ratio relatives arc up, labelled "p:q ±¢" with coupling-weighted
  opacity, readout strip with level/T60/couplings. Direct editing:
  vertical drag on a needle writes the per-partial level live. Band
  chips (Hz-defined: fund/low/mid/presence/air) focus-shade the print
  and scope the per-partial editor strip to the band. Old 64-column
  editor demoted to the band-scoped strip.
- **T8 Walkthrough + A/B + audition prep** — DONE (2026-07-06) except
  the audition itself: T-Q1 walkthrough clean, T-B7 benchmarked,
  live A/B servers standing (old :8766 / new :8765), statuses updated.
  **AWAITING T-Q5 OWNER AUDITION.** Open owner question: now that
  vowels are bodies, should the separate Formant sound-source mode be
  retired in favour of one unified chain (vocal body + a pad-driven
  continuous body point), or kept as a distinct source?

## 10. Open questions (non-blocking, owner input welcome)

1. Transfer default: on (subtle, e.g. 0.15) for all instruments, or off
   except where physical (piano/sitar-like)?
2. Should the old harmonic-editor grid remain reachable as a "legacy
   table" behind the advanced disclosure for one release, or go entirely?
3. Producer palette items store instrument params — migrate stored
   palettes eagerly on load, or lazily per region play?

---
*Status: APPROVED 2026-07-06 (T-Q4). Implementation in progress, stage
by stage per §9. Producer v2's Q4 re-audition remains a separate open
item.*
