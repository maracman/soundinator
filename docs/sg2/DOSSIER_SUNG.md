# SG2 construction dossier — sung voice

Status: research verdict complete; checklist implemented in
`scripts/tone_match/assertions.py` (checklist version 1).

Scope: adult tenor, basso profondo/oktavist construction, mezzo-soprano and
boy soprano. Sustained vowels are the fitting unit; language synthesis is not.

## 1. Mechanism to engine-stage mapping

| Voice | EXCITOR | RESONATOR | BODY / radiation | Additive approximation and audible risk |
|---|---|---|---|---|
| Adult sung voice | Quasi-periodic glottal airflow pulses plus aspiration/noise; phonation changes spectral tilt | Vocal tract area function creates vowel formants and source–filter interaction | Lip radiation and clustered higher resonances; trained male classical voices may develop a carrying cluster near 3 kHz | SG2 uses `blow` as the airflow excitor, `glottalTilt`, pitch-synchronous breath and harmonic modes; articulated fixed-Hz body bands represent the vocal tract. Additive harmonics plus filters omit full nonlinear fold/tract feedback, so formant tuning must be measured rather than inferred from f0. |
| Basso profondo | Adult male source with lower f0 and long-tract formants; oktavist extension may require permitted model reference | Same source–filter structure | Adult male body; singer-formant strength is reference-dependent | Construct from the fitted adult bass/tenor evidence, then extend only the uncovered octave under §9.1. |
| Boy soprano | Prepubertal male folds and a shorter, development-dependent vocal tract | Higher formants on average, but scaling is age-, sex- and vowel-dependent | No automatic adult-male singer-formant assumption | Construct from fitted voices using explicit morphology metadata and scaled body bands when no reference exists (§9.2). It is best-effort, but still must pass its topology/morphology checklist. |

The separable source/filter mapping is not merely a synthesizer convention.
GOLF uses a glottal-flow-inspired harmonic source with vocal-tract LPC filters
and reports competitive singing synthesis with an interpretable compact model
([Yu & Fazekas](https://arxiv.org/abs/2306.17252)). Measurements also show
that singers tune vocal-tract formants under some conditions
([Schutte, Miller & Svec](https://pubmed.ncbi.nlm.nih.gov/8541972/)). SG2's
body bands therefore remain fixed in Hz/vowel space; they do not scale with
each sung pitch.

## 2. Quantitative signatures used in fitting

- **Glottal spectral rolloff.** The harmonic source must fall toward high
  partials. The gate accepts a broad median slope of -18 to -1 dB/octave,
  leaving exact phonation to paired partial/mel scoring. Measurements of voice
  source spectra show systematic sex/source differences in spectral tilt
  rather than a flat comb
  ([Hanson & Chuang](https://pubmed.ncbi.nlm.nih.gov/10462811/)).
- **Singer's formant is conditional.** Sundberg reports the classical singer's
  formant as a cluster in the vicinity of 3 kHz
  ([Sundberg review](https://pubmed.ncbi.nlm.nih.gov/11411472/)). Adult tenor
  and contrabass gates look for a broad 2.7–3.3 kHz prominence; mezzo and boy
  do not automatically receive that male-classical threshold. A zero
  `singerFormantAmount` remains valid when the reference does not show it.
- **Breath is source-related.** When reference analysis finds audible noise,
  `voiceBreathSync` must be nonzero so the component follows phonation rather
  than becoming an unrelated static bed. Clean references may legitimately
  fit zero.
- **Vibrato/formant tuning.** Rate/depth use the §3 paired-reference limits;
  no voice-class constant replaces measurement. Formant centres are scored in
  fixed Hz and by log-mel distance because wide harmonic spacing makes
  high-pitch formant measurement difficult.
- **Coverage.** Adult voices still require three named registers and two
  dynamics. Boy soprano without a public reference is exempt from the §3
  quantitative match, not from rendering a three-register/two-dynamic grid or
  from construction assertions.

### Boy-soprano morphology law (§9.2)

The plan's “formants up ~15–20%” is an **initializer, not a universal law**.
For a geometrically similar lossless tract, resonance frequencies scale
approximately inversely with tract length. A 15–20% formant rise corresponds
to a tract-length scale around `1/1.20…1/1.15 = 0.83…0.87`. The scorer permits
`0.75…0.90` to cover age/individual variation, but requires the declared
scaled/base formants to agree with `1 / tractScale` within 12%.

That uniform initializer must then be amended vowel by vowel:

1. Store `boyMorphology.tractScale`, `baseFormantsHz`, and
   `scaledFormantsHz` with the constructed preset/run record.
2. Start with adult fitted formants multiplied by `1/tractScale`; use at least
   three bands.
3. Refit individual bands against any child reference or child-vowel
   literature; do not preserve one ratio by force. Measurements of 11-year-old
   spoken and sung vowels found higher child formants but also vowel-dependent,
   non-uniform sex differences
   ([White](https://pubmed.ncbi.nlm.nih.gov/10622522/)).
4. Keep f0 independent of tract scale. Child identity depends on both glottal
   pulse rate and vocal-tract length; listeners use both cues
   ([Smith, Walters & Patterson](https://pubmed.ncbi.nlm.nih.gov/18247770/)).
5. Use lighter vibrato and a steeper/purer source only as fitted priors, not
   anatomical identities. Age-specific data show considerable developmental
   variation, and f0 decreases with age in children
   ([pediatric acoustic study](https://pubmed.ncbi.nlm.nih.gov/20835536/)).
6. Do not impose the adult male 3 kHz cluster. `singerFormantAmount <= 0.35`
   unless a child reference demonstrates otherwise.

The permitted range is consistent with age-dependent vocal-tract modelling
that derives separate length warping and cross-dimension scaling from imaging,
rather than one adult EQ shifted wholesale
([Story et al.](https://pubmed.ncbi.nlm.nih.gov/29857736/)).

## 3. Controls exposed by professional/research modellers

There is no SWAM sung-voice counterpart in the cited product family, so this
dossier does not invent a commercial control list. Physical and
source-filter singing systems expose the analogous independent quantities:
glottal waveform/source, f0, tract/formant filter, articulation and noise.
GOLF explicitly separates glottal-flow wavetables from vocal-tract filters
([paper](https://doi.org/10.5334/tismir.210)); SPASM/Singer exposes tract
segment radii and a formant editor
([Cook, SPASM/Singer](https://citeseerx.ist.psu.edu/document?doi=2cdec110712f132d825a362f15ee04a9ddcadc9d&repid=rep1&type=pdf)).

For WP-9 this supports performer-facing expression, vibrato, breath/phonation
and articulation/vowel position. Glottal tilt, tract-scale metadata, exact
formant centres/bandwidths and singer-formant amount should begin in Advanced.

## 4. Executable construction checklist

Every voice inherits strict register/dynamic coverage, paired f0 lock when a
reference exists, and sustained-envelope classification.

| Voice | Assertion ID | Required fact |
|---|---|---|
| All | `<voice>.glottal-rolloff` | Median harmonic slope between -18 and -1 dB/octave |
|  | `<voice>.glottal-law` | `glottalTilt` is explicitly present/fitted in range |
|  | `<voice>.pitch-sync-breath` | Sync amount is positive when reference noise is audible; zero otherwise allowed |
| Tenor | `tenor.singer-formant-law`, `tenor.singer-formant-band` | Formant control fitted and 2.7–3.3 kHz carrying region present |
| Contrabass | Corresponding `contrabass.*` IDs | Same adult-male checks across the constructed low extension |
| Mezzo-soprano | `mezzo-soprano.singer-formant-law` | Control fitted, with no forced adult-male 3 kHz prominence |
| Boy soprano | `boy-soprano.tract-scale` | Declared morphology scale in 0.75…0.90 |
|  | `boy-soprano.formant-scaling` | At least three scaled/base formants agree with inverse scale within 12% and appear in the preset's `bodyBands` |
|  | `boy-soprano.no-adult-singer-cluster` | Adult singer-formant amount not imposed without evidence |

If no boy reference exists, `pitch-lock` is reported missing in pair scoring
but the construction campaign supplies an intended-pitch grid; the final
plausibility judgement remains the capstone audition under §9.2.

## 5. Verdict on the §6 backlog

| Gap | Verdict | Consequence |
|---|---|---|
| G1 register-dependent spectra | **Confirmed, with restraint.** Voice source and tuning strategy change with register, while tract resonances remain fixed in Hz/vowel space. | Use register source tables plus fixed-Hz articulated body bands; never pitch-shift the entire vocal tract with f0. |
| G6 glottal tilt | **Confirmed.** Source spectra require an independently fitted rolloff/phonation control. | Keep `glottalTilt`; zero remains an admissible fitted result. |
| G6 singer's-formant body band | **Confirmed but conditional.** The ~3 kHz cluster is characteristic of some trained adult classical voices, not a universal “voice” feature. | Fit amount per voice; hard prominence gate only for tenor/contrabass in this campaign, and only reopen it if their references lack the cluster. |
| G6 pitch-synchronous breath | **Confirmed conditionally.** Aspiration belongs to the glottal source, but clean references can fit zero. | Require nonzero sync only when measured reference noise crosses the documented threshold. |
| Boy morphology scaling | **Amended.** 15–20% uniform uplift is a starting prior; anatomy and measured child singing require nonuniform, vowel-dependent adjustment. | Persist morphology evidence, assert inverse-length consistency, then fit bands individually. |
| Missing gap: full source–tract coupling | **Deferred, not hidden.** It matters near resonance tuning, but current fixed-Hz formants plus register source tables are testable first. | File a model gap only if residuals cluster around formant crossings after the existing laws and scorer pass everywhere else. |

Verdict: G6 is confirmed with two crucial guards—singer formant and breath are
evidence-dependent—and the boy-soprano law is explicitly amended from a
blanket percentage to a documented, vowel-wise construction procedure.
