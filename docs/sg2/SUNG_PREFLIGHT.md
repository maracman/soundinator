# WP-8 sung campaign — preflight scaffold

Targets (§9 decision 12, 2026-07-17): the standard voice sections —
**soprano, mezzo-soprano, tenor, bass** (identity singers: soprano TBD by
evidence procedure, mezzo=f5, tenor=m3, bass=m8). Basso profondo =
secondary nice-to-have, DERIVED from the fitted bass after the four
sections pass gates. Boy soprano = best-effort construction (§9
decision 2). Owner
directive (2026-07-16): this family needs more design thought than the
others — different vowel sounds at minimum, and consonant onsets are a
candidate modelling target. Binding context first: the plan (§2, §2.3,
§2.5/2.5c, §3, §6, §9), OWNER_LISTENING_NOTES.md (FAMILY FIREWALL),
TECHNIQUES_EXCHANGE.md (all T-entries), DOSSIER_SUNG.md, and
RESEARCH_SUNG_REALISM.md (annex commissioned 2026-07-16 — includes the
consonant-onset reference survey).

## V0 · What is structurally NEW about this family (read before anything)

1. **One source, many bodies.** A voice class has ONE glottal source but a
   DIFFERENT body per vowel. The engine supports this (vowel bodies,
   `bodyArticulation`, the vowel pad/walk — CH-B1). The FITTING shape is
   new: glottal-source parameters (tilt, breathiness, vibrato, onset) are
   fitted pooled across all vowels of a voice class; the body
   deconvolution runs PER VOWEL on vowel-labelled reference subsets,
   emitting per-vowel formant band sets (F1–F5) into that voice class's
   vowel-body presets. Consuming assertion: rendering vowel X through the
   fitted body must classify as vowel X (see V1).
2. **Singers are instruments, not takes (firewall level!).** Multiple
   singers per class exist in the corpus. Cross-singer differences are
   ACROSS-INSTRUMENT variation — never pooled into one identity fit.
   Pick ONE primary singer per voice class (most coverage, cleanest
   takes, vibrato+straight both present); fit identity from that singer
   only. Other singers: same-note cross-singer distances calibrate how
   far "a different voice" sits (morph/ledger evidence); same-singer
   repeats are the only §2.5c humanisation pairs.
3. **Consonant onsets are articulation gestures.** A consonant = a strong
   articulation-strength draw with a per-consonant-class spectral
   signature: noise burst (spectrum, duration), voice-onset-time (gap
   between burst and phonation), and formant TRANSITIONS sweeping into
   the vowel target over ~50–150 ms. This extends the L2/L5b onset
   architecture — one latent draw, consonant colour on top — it must NOT
   be a separate bolt-on system. Scope minimum: 2–3 consonant classes
   (e.g. plosive /d/-like, nasal /m/-like, fricative /s/-like lead-ins)
   as onset presets; vowels remain the sustained identity. The research
   annex supplies published burst/VOT/transition values and the
   reference-dataset options (VocalSet has NO consonants).
4. **Registers are physiological.** Chest/head/passaggio breaks are the
   voice's register system — reference coverage must straddle the
   passaggio per class, and per-register source changes are expected
   (the clarinet-break precedent: register tables are mandatory, and the
   break location is a per-voice-class fitted fact).

## V1 · Scorer senses (before fitting; controllability-audited before weighting)

| Feature | Source lesson | Sung specifics |
|---|---|---|
| Formant tracks F1–F3 (trajectory, not static) | new | Per-note; the identity carrier. Sustained window → vowel position; onset window → consonant transitions |
| **Vowel classification gate** | new (construction, not loss) | Fitted vowel body rendered at 3 registers must land in the reference vowel's F1/F2 region — hard construction assertion per vowel |
| Singer's formant band (2.4–3.2 kHz, per-class centre) | G6/annex | Energy ratio vs neighbours; class-dependent (basses lower centre than tenors; boy soprano: annex verdict) |
| Glottal tilt / H1–H2 per dynamic | L1 analogue | Breathiness ratio ↑ at pp (inefficiency law is the SAME mechanism as T-001; values fitted per class) |
| Vibrato trajectory + body-AM | bowed P1 | Voices: onset delay, depth ramp, rate drift; AM through formant slopes is strong — scorer must see it |
| Onset f0 approach | L5/L11 generalisation | Singers approach from below (scoop) or above; distribution fitted per class — blown/bowed values never transfer |
| Consonant onset features | owner directive | Burst spectrum + duration, VOT, F1/F2 transition slopes over the first 150 ms — active only for consonant-tagged references |
| Sustained band balance | T-005 | Per vowel × register × dynamic (a vowel IS a band-balance target) |

## V2 · Reference handling

- **Corpus**: VocalSet (voice-tenor/, voice-bass/, voice-mezzo/ in
  sg2-data/samples/) — vowel labels and technique labels come from its
  file/folder structure; carry `vowel`, `singer`, `technique` through
  references.json. Long tones = spectral truth; scales/arpeggios =
  segmentation input (f0-anchored per T-034-style expected-pitch
  contract); vibrato vs straight routed like Iowa/Philharmonia roles.
- **Techniques**: fit identity from `vibrato` + `straight` long tones
  only. Exclude belt/breathy/trill/etc. from identity fits — bank them
  as future expressive interim presets (decision 7 cheap wins).
- **Floor groups**: same-singer + same-vowel + same-note + same-dynamic
  ONLY. Cross-singer pairs are logged separately as across-instrument
  distance evidence, never as the variability floor.
- **Boy soprano**: no corpus expected — construction from morphology per
  §9 decision 2 (annex supplies scaling laws: formants up ~15–20%, f0
  range, lighter vibrato, purer glottal spectrum). Exempt from
  quantitative tripwires; capstone audition judges plausibility.
- **Consonant references**: per the research annex's dataset verdict
  (candidates to verify: NUS-48E sung+spoken, CSD children's songs,
  vocadito, TIMIT as spoken fallback — licences checked before download).
  If no clean sung source exists, consonant onsets fit from spoken
  corpora with a documented sung-adaptation step, or reduce scope to
  noise-burst+VOT without formant-transition fitting — owner informed
  either way.

## V3 · Fitting shape (differs from all other families)

1. Segment + label references (vowel, singer, technique, register).
2. Per-class GLOTTAL SOURCE fit pooled across vowels: partial tables of
   the source are what remains after dividing each vowel's fitted body —
   the deconvolution loop alternates source ↔ per-vowel bodies until
   stable (extends fit_fixed_body; split-half checks per vowel).
3. Per-vowel BODY fits → vowel-body presets for the voice class
   (engine machinery exists; T-004 unity convention and T-003
   granularity law apply — bass voice low register is exactly the sparse-
   partial case).
4. Performance layer: vibrato trajectory, breathiness law, onset f0
   distribution, consonant onset classes (when references exist).
5. §2.5c humanisation from same-singer repeats; §2.5 refinement loop and
   all gates as standard.

## V4 · Expected engine gaps (file specs, never bend other params)

- Consonant onset layer (burst + VOT + formant-transition ramp riding the
  articulation draw) — the one genuinely new mechanism; spec to Agent A
  after the annex lands.
- Portamento/approach f0 for sung onsets (distribution; wander/scoop
  shapes both occur).
- Passaggio register tables for the source (mechanism exists via
  G1/register anchors; voice-class values fitted).
- Verify existing sung params (glottalTilt, singerFormantAmount,
  voiceBreathSync, bodyArticulation) against the annex before adding
  anything new — G6 is partially landed.

## V5 · Gates

All inherited gates apply (tripwires with per-vowel band-balance bars,
controllability audit, T-004/T-003 consuming assertions, leaderboard
carry-forward, sg2-data storage rule). Plus sung-specific: the V1 vowel
classification gate, and no consonant feature carries weight until its
reference source is landed and QC'd.

## V6 · Cheap wins (decision 7)

- Expressive technique interims per class (breathy, belt, straight-tone)
  once identity fits are frozen — the corpus already contains the takes.
- The per-vowel body machinery doubles as the "articulated wah" for any
  instrument (CH-B1) — improvements flow back to the whole engine.
