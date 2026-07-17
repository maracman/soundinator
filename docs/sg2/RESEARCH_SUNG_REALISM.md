# SG2 research annex — sung-voice realism (tenor, basso profondo, mezzo, boy soprano)

Status: research annex to `docs/sg2/DOSSIER_SUNG.md`, commissioned by the owner
2026-07-16 to feed the `SUNG_PREFLIGHT.md` V-sections. The owner directive: this
family needs more design thought than the others — the vowels genuinely differ
per note, and **consonant onsets are a first-class modelling target** (preflight
V0.3, V1, V4). This document answers, with citations and numbers, WHAT makes an
additive render sound like a *singing human voice* and like a *specific voice
class*, and maps each finding onto the engine's three stages (glottal-like
excitation spectrum → 64-partial resonator → per-vowel formant-band body EQ,
with `glottalTilt`, `singerFormantAmount`, `voiceBreathSync`, `bodyArticulation`,
vibrato FM→AM through the body bands).

Conventions (identical to `RESEARCH_BOWED_REALISM.md`):

- Claims are numbered `S1…S72` for cross-reference by coding agents. Each claim
  carries its evidence and a **Synthesis consequence** line.
- `[single-source]` marks claims verified against only one independent source;
  treat their numbers as provisional and re-measure on the VocalSet corpus (or
  the fitted consonant corpus) before freezing.
- `[derived]` marks any number the owner asked to be flagged as **extrapolation**
  — a value I computed or interpolated rather than read directly from a source
  (e.g. the boy-soprano 8–12 yr formant scale, sung-consonant duration scaling).
  Every `[derived]` value is an initializer, never a gate constant.
- "Voice class" here = tenor, contrabass (basso profondo / oktavist extension),
  mezzo-soprano, boy soprano — the four SG2 targets.

Primary sources (abbreviated in claims; full URLs in the Source Index §11):

- **Sundberg 1988** — J. Sundberg, "Vocal Tract Resonance in Singing", *The NATS
  Journal* Mar/Apr 1988 (formant ranges, singer's formant, formant tuning).
- **Sundberg SSV** — J. Sundberg, *The Science of the Singing Voice* (1987) —
  the standard reference; its printed vowel-formant and singer's-formant tables
  are the canonical source, cited here via the 1988/2001 papers that reproduce
  them.
- **Joliveau 2004** — E. Joliveau, J. Smith & J. Wolfe, "Vocal tract resonances
  in singing: the soprano voice", *JASA* 116(4):2434 and "Tuning of vocal tract
  resonance by sopranos", *Nature* 427:116 (soprano R1≈f0 tuning).
- **Wolfe 2009** — J. Wolfe, M. Garnier & J. Smith, "Vocal tract resonances in
  speech, singing, and playing musical instruments", *HFSP Journal* 3(1):6.
- **Sundberg 2001** — J. Sundberg, "Level and centre frequency of the singer's
  formant", *J. Voice* 15:176 (measured centre frequencies per class).
- **Müller 2022** — F. Müller et al., singer's-formant centre-frequency study
  (bass/baritone/tenor/soprano centres), via the voicescience.org lexicon.
- **Cleveland & Sundberg 1983 / Bloothooft & Plomp 1986** — singer's-formant
  level scaling with loudness.
- **Hillenbrand 1995** — J. Hillenbrand et al., "Acoustic characteristics of
  American English vowels", *JASA* 97:3099 (Table V — the spoken formant anchor).
- **Peterson & Barney 1952** — the original men's vowel-formant table.
- **Gauffin & Sundberg 1989** — "Spectral correlates of glottal voice source
  waveform characteristics", *JSLHR* 32:556 (tilt vs phonation mode).
- **Hanson & Chuang 1999** — "Glottal characteristics of male speakers", *JASA*
  106(2):1064 (H1–H2, H1–A1, H1–A3 tables; male/female tilt difference).
- **Klatt & Klatt 1990** — "Analysis, synthesis and perception of voice quality
  variations among female and male talkers", *JASA* 87:820 (breathy/pressed tilt,
  KLGLOTT88 OQ↔H1–H2).
- **Prame 1994/1997** — E. Prame, vibrato rate (1994) and extent/intonation
  (1997) in professional Western lyric singing.
- **Nix 2016** — J. Nix et al., vibrato rate by voice class (college majors).
- **Maher & Beauchamp 1990** — "An investigation of vocal vibrato for synthesis",
  *Applied Acoustics* 30:219 (per-partial FM→AM measurement).
- **Blumstein & Stevens 1979** — burst-spectrum place templates.
- **Lisker & Abramson 1964 / Cho & Ladefoged 1999** — VOT categories and ranges.
- **Delattre, Liberman & Cooper 1955** — F2 locus theory.
- **Kewley-Port 1982** — formant-transition durations in CV syllables.
- **Fujimura 1962** — nasal-consonant analysis (murmur + antiresonances).
- **Jongman, Wayland & Wong 2000** — "Acoustic characteristics of English
  fricatives", *JASA* 108:1252 (fricative spectral moments).
- **McCrea & Morris 2007** — VOT in trained/untrained singers (speech vs singing).
- **Fitch & Giedd 1999** — MRI vocal-tract-length vs age (child scaling).
- **Lee, Potamianos & Narayanan 1999** — children's speech-acoustic development.
- **Smith & Patterson 2005** — f0 + vocal-tract-length as the joint size/sex cue.

---

## 1. Sung vowel formants (F1–F5, and how sung ≠ spoken)

### 1.1 The spoken anchor (baseline before any singing correction)

**S1.** Adult-male spoken formant centres (Hillenbrand 1995 Table V, corroborated
against Peterson & Barney 1952) for the cardinal vowels, Hz:

| Vowel | F1 | F2 | F3 | F4 |
|---|---|---|---|---|
| /i/ (beet) | 342 | 2322 | 3000 | 3657 |
| /ɛ/ (bet)  | 580 | 1799 | 2605 | 3677 |
| /ɑ/ (father)| 768 | 1333 | 2522 | 3687 |
| /o/ (boat) | 497 | 910  | 2459 | 3384 |
| /u/ (boot) | 378 | 997  | 2343 | 3357 |

Adult-female formants average **~15% higher** than male; children **~40%
higher** (Sundberg 1988; Fitch & Giedd 1999). — Evidence: Hillenbrand 1995 (read
from Table V); Peterson & Barney 1952 `[corroborated]`. *Synthesis consequence:*
these are the **initializer** centres for the per-vowel `bodyBands` of a tenor;
scale by the class factors (§7, §1.3) for contrabass/mezzo/boy. They are NOT the
fit target — the fit target is the class's own VocalSet vowels; use these only to
seed the deconvolution and to sanity-check the vowel-classification gate (§9b).

**S2.** Typical spoken formant **bandwidths** (Klatt 1980, standard synthesis
values): B1 ≈ 50–80 Hz, B2 ≈ 70–140 Hz, B3 ≈ 100–240 Hz, higher formants
B ≈ 0.05·F (B4 ≈ 140, B5 ≈ 190 Hz). Bandwidths *widen* with glottal opening (a
breathy/high-open-quotient source raises B1). — Evidence: Klatt 1980 via Praat
KlattGrid docs `[single-source]` (widely reused). *Synthesis consequence:* the
engine's `formantBandwidth` multiplier (default 1) should be fitted per class,
not per vowel first; a breathy mezzo/boy sits toward wider B1 than a pressed
tenor. Sung-specific bandwidths are sparse (S6) — treat these as priors.

### 1.2 Sung differs from spoken: formant tuning

**S3.** For **male voices and altos below their top range**, sung vowels keep
speech-like F1/F2, plus a *vowel-colouring* shift: to gain the singer's formant
(§2), F2 and F3 of close vowels drop toward the /y/ region (e.g. sung /i/ loses
some F2/F3 height). The distinguishing sung feature is the added ~3 kHz cluster,
**not** wholesale F1/F2 retuning. — Evidence: Sundberg 1988 Fig. 9 `[single-source
but primary]`. *Synthesis consequence:* for tenor and contrabass, fit per-vowel
bodies close to the spoken map (S1), then let `singerFormantAmount` (§2) add the
cluster; do NOT retune F1 to f0 for these classes (S4/S5).

**S4.** **Sopranos (and mezzos at the top) tune F1 to f0.** As long as f0 lies
below the vowel's normal (speech) F1, the singer uses the normal F1. **Once f0
rises above that speech F1, the singer abandons the vowel's F1 and raises R1 (F1)
so R1 ≈ f0** (tuned slightly *above* f0 to keep an inertive load on the folds).
The tuning line holds over **~600 Hz to ~1000 Hz**; it continues to ~1 kHz for
unrounded vowels (/ɑ ɜ/) but falls below the line for rounded vowels (/ɔ u/)
because rounding cannot push R1 that high. R2 rises mostly as a by-product; R3–R5
are **not** tuned to harmonics. The payoff is a sound-level gain **up to ~30 dB**;
the price is loss of vowel intelligibility (vowels converge on the F1–F2 plane at
high pitch). — Evidence: Joliveau 2004 (JASA + Nature, read in full); Sundberg
1988; Wolfe 2009 `[corroborated]`. *Synthesis consequence:* the mezzo needs a
**formant-tuning law** — a fitted rule that, above a per-vowel f0 threshold,
overrides the fitted body's F1 band and slaves it to (≈1.0–1.15×) f0. This is a
new engine capability (gap §9c-N4); it is class-conditional (mezzo yes, tenor/
contrabass no, boy soprano partially — S46). Because the body bands are fixed-Hz,
this cannot be a static preset; it must re-evaluate F1 per note from f0.

**S5.** **Tuning threshold by class** (Sundberg 1988): basses essentially never
need formant tuning (their f0 rarely exceeds F1); baritones need it only for
close vowels /i y u/ at the very top; altos/mezzos need it for all vowels except
/ɑ æ/ in their top range; sopranos use it extensively. Because most vowels' F1
lies between ~250 Hz (/i u/) and ~900 Hz (/ɑ/), tuning becomes necessary roughly
from **~C5 (523 Hz) upward** for close vowels and only near the top for open
vowels. — Evidence: Sundberg 1988 `[single-source but primary]`; mechanism
corroborated by Joliveau 2004. *Synthesis consequence:* gate the S4 formant-tuning
law on `f0 > perVowelThresholdHz`, with the threshold ≈ the fitted F1 of that
vowel. Contrabass: threshold effectively out of range (law inert). Tenor:
threshold near the top of range only. Mezzo: active across the upper register.

**S6.** Sung-vowel measurement precision (soprano, Joliveau 2004): resonances
measurable to ±11 Hz; between-singer SD ≈ 25 Hz (R1), 60 Hz (R2/R3), 90 Hz (R4).
In high sopranos above ~932 Hz the upper spectral peak is **broad (bandwidth ≥ 2
kHz)** rather than a narrow cluster. — Evidence: Joliveau 2004; Weiss, Brown &
Morris 2001 `[corroborated]`. *Synthesis consequence:* at high f0 the wide
harmonic spacing makes high-pitch formant estimation unreliable — score high-mezzo
vowels by log-mel distance and fixed-Hz band balance (as the dossier §2 already
mandates), not by precise formant-peak Hz; keep the vowel-classification gate
(§9b) at low/mid registers where F1/F2 are well sampled.

### 1.3 Per-class scaling of the vowel map

**S7.** Vocal-tract length sets the overall formant scale: adult male VTL ≈
16.9 cm, adult female ≈ 14.1 cm (Fitch & Giedd 1999); formant frequencies scale
approximately inversely with VTL. So a mezzo's whole vowel map sits ≈ **1.15–1.20×**
above a tenor's, and a contrabass's ≈ **0.92–0.96×** below (longer tract). —
Evidence: Fitch & Giedd 1999; Sundberg 1988 (~15% female uplift) `[corroborated]`.
*Synthesis consequence:* seed contrabass vowel bodies from the tenor fit ×~0.94
and mezzo from ×~1.15 `[derived]` initializers, then fit each class's bands
against its own corpus (contrabass low register is exactly the sparse-partial
case — T-003/T-004 apply). Boy soprano scaling is larger and handled in §7.

---

## 2. The singer's formant (cluster) — centre, level, and when absent

**S8.** The singer's formant is a clustering of **F3, F4 and F5** into one broad
reinforced peak, produced by a **lowered larynx** plus a **narrowed epilaryngeal
tube** relative to a **widened pharynx** (Sundberg's model condition: pharynx
cross-section ≥ ~6× the epilarynx opening — the "1:6" ratio; the epilarynx then
acts as a separate resonator/impedance-matcher near ~2.8 kHz). — Evidence:
Sundberg 1974 via Sundberg 1988; Wolfe 2009 `[corroborated]`. *Synthesis
consequence:* the engine models this as an added body band (`singerFormantAmount`
→ a peak the render adds at 3 kHz, `synth.js:2737`). This is correct in shape but
its **centre is hardcoded at 3000 Hz** regardless of class — see S9 and gap
§9c-N5.

**S9.** **Centre frequency rises bass → tenor → soprano, and the literature
disagrees on exact Hz.** Two source sets:

| Voice | Sundberg 1988 lecture | Sundberg 2001 (measured) | Müller 2022 |
|---|---|---|---|
| Bass | ~2.2 kHz | ~2.42 kHz | 2384 Hz |
| Baritone | ~2.7 kHz | ~2.55 kHz | 2454 Hz |
| Tenor | ~3.2 kHz | ~2.84 kHz | 2705 Hz |
| Alto/mezzo | ~2.8 kHz | — | — |
| Soprano | (≈ ordinary F3/F4 — see S11) | — | 3092 Hz |

The **1988 lecture numbers are outliers** (tenor 3.2 kHz; alto>tenor ordering);
Sundberg's own 2001 measured study and Müller 2022 agree far better with each
other. Modern consensus: **bass ~2.4 kHz, baritone ~2.5 kHz, tenor ~2.7–2.8 kHz**,
with the monotonic bass<baritone<tenor ordering robust. — Evidence: Sundberg 1988;
Sundberg 2001; Müller 2022 `[corroborated for ordering; centres disagree — flag]`.
*Synthesis consequence:* replace the hardcoded 3000 Hz singer-formant band with a
**per-class centre**: contrabass ≈ 2.35–2.45 kHz, tenor ≈ 2.7–2.85 kHz (gap
§9c-N5). The existing `tenor.singer-formant-band` gate window (2.7–3.3 kHz,
`assertions.py`) is right for tenor; the **contrabass window must be lowered to
~2.3–2.6 kHz** — the current code reuses the tenor 2.7–3.3 kHz window for
contrabass, which is ~300–400 Hz too high (see §9b).

**S10.** **Level scales faster than loudness.** A +10 dB rise in overall SPL
produces a **+12–15 dB** rise in the singer's-formant region (Cleveland &
Sundberg 1983) — or **+16–19 dB** (Bloothooft & Plomp 1986). Both agree the
effect originates in the voice *source* (faster glottal closure), not just the
filter, and that the cluster's job is to poke through the orchestral LTAS (which
rolls off ~9 dB/oct above 500 Hz, leaving a "gap" near 2–4 kHz). — Evidence:
Cleveland & Sundberg 1983; Bloothooft & Plomp 1986 `[corroborated for the effect;
the two dB slopes disagree — flag]`. *Synthesis consequence:* couple
`singerFormantAmount` weakly to the dynamic axis (louder → stronger cluster) with
a small fitted slope; because the mechanism is source-driven, this coupling should
ride the same effort control as glottal tilt (§3), not be an independent EQ automation.

**S11.** **The soprano singer's formant is debated / effectively absent.**
Sundberg: a soprano's ~3 kHz peak "is nothing but a perfectly normal third and
fourth formant". Weiss, Brown & Morris 2001 ("Singer's formant in sopranos: fact
or fiction?") found any high peak weak, broad (BW ≥ 2 kHz above ~932 Hz), or
absent — the wide harmonic spacing at high f0 makes a narrow cluster impossible
to populate. **What replaces it: F1≈f0 formant tuning (S4)**, which boosts level
at the fundamental instead of at 3 kHz. — Evidence: Sundberg 1988; Weiss et al.
2001; Wolfe 2009 `[corroborated]`. *Synthesis consequence:* the dossier §2 rule
stands — **mezzo does not automatically receive the adult-male 3 kHz gate**;
`singerFormantAmount` may fit low or zero for mezzo, and the loudness/projection
job is carried by formant tuning (§9c-N4). No `mezzo.singer-formant-band`
prominence gate.

**S12.** **Absent in untrained voices and (largely) in boy sopranos.** The
singer's formant is the main spectral difference between *trained* male singers
and non-singers (loudness is not the difference; Gramming et al. 1987 via Sundberg
1988). It is suppressed in choral vs solo singing (Rossing et al. 1985/86). Boy
sopranos do not develop the concentrated laryngeal-lowering cluster of adult
tenors; boys'-choir spectra do show some 2.5–3.5 kHz energy that grows with the
boy's size, but it is not the adult cluster and is poorly sampled at treble f0. —
Evidence: Sundberg 1988; Rossing et al. 1985/86; boys'-choir spectral study
`[corroborated for the trained-adult-only conclusion; boy-specific detail
single-source]`. *Synthesis consequence:* boy soprano ships
`singerFormantAmount ≤ 0.35` (dossier `boy-soprano.no-adult-singer-cluster`
already enforces this) — keep it; do not add a boy singer-formant prominence gate.

---

## 3. Glottal source: spectral tilt and H1–H2 vs effort and phonation

**S13.** The idealized glottal-flow source rolls off at **−12 dB/octave** above
its cutoff for a source with an abrupt closure discontinuity (−6 dB/oct below the
glottal-formant cutoff, steepening to −12 above). A posterior glottal chink adds
a further ~+6 dB/oct of tilt. — Evidence: Flanagan 1957 via Childers & Lee 1991;
Hanson & Chuang 1999 `[corroborated]`. *Synthesis consequence:* the −12 dB/oct
modal reference is the anchor for `glottalTilt`; every deviation is a fitted,
mechanism-named term (effort, phonation mode, class).

**S14.** **Tilt flattens with effort/loudness, steepens when soft or breathy.**
Approximate dB/octave anchors:

| Condition | Source slope | Source |
|---|---|---|
| Loud / pressed-flow ("bright") | ~−9 dB/oct (extreme loud ~−3) | excised-larynx & loudness studies |
| Normal modal chest | ~−12 dB/oct | Childers & Lee; Gauffin & Sundberg 1989 |
| Falsetto | ~−18 to −20 dB/oct | Gauffin & Sundberg 1989 (−18); Childers & Lee (−20) |
| Breathy | ~−18 dB/oct or steeper | Gauffin & Sundberg 1989; Childers & Lee |

A doubling of subglottal pressure yields **+6–9 dB SPL**, achieved largely by
flattening tilt (upper partials rise faster than the fundamental) — loudness is a
*tilt* control, not a gain control. — Evidence: Gauffin & Sundberg 1989; Childers
& Lee 1991; Nordenberg & Sundberg 2004 `[corroborated in direction; exact loud/
soft dB from paywalled abstracts — single-source for the exact figure]`.
*Synthesis consequence:* the dynamic law for the voice is the **same slope law as
the bowed string (C2)** — most of the audible dynamic change is spectral tilt, not
broadband gain. `glottalTilt` (currently a static param, default 0) needs a
**dynamic slope** so loud takes flatten toward −6…−9 and soft takes steepen toward
−15…−18 dB/oct (gap §9c-N6). This is the same inefficiency-law mechanism as T-001.

**S15.** The dossier's current `<voice>.glottal-rolloff` gate accepts a median
source slope of **−18 to −1 dB/octave** (`assertions.py`). This is consistent
with S13/S14 (falsetto/breathy floor −18; loud ceiling near −3, rounded to −1).
— Evidence: cross-check of dossier §2 against S14 `[corroborated]`. *Synthesis
consequence:* keep the broad gate as a *sanity* bound, but add a **per-dynamic
sign gate**: slope(pp) < slope(f) (soft is steeper). This is the sung analogue of
`*.dynamic-tilt` in the bowed annex (§9b).

**S16.** **H1–H2** (level of the first harmonic minus the second) is the primary
breathiness/open-quotient proxy: large positive → long open phase → breathy;
small/negative → pressed/adducted. Operational ranges (approximate, corroborated
in trend; boundaries voice/vowel-dependent):

| Phonation | H1–H2 |
|---|---|
| Pressed / creaky | ~−5 to 0 dB |
| Modal / flow | ~0 to +3 dB |
| Breathy | ~+3 to +10 dB |

Measured male mean H1*–H2* ≈ **0 dB** (range −3.3 to +4.2, SD 1.8; Hanson &
Chuang 1999, read from Table VIII). — Evidence: Klatt & Klatt 1990; Hanson &
Chuang 1999; Garellek handbook `[corroborated for trend; class boundaries
approximate]`. *Synthesis consequence:* breathiness is an H1–H2 axis, and it
**rises at pp** (the inefficiency law, dossier §2). The engine has no explicit
H1–H2 control today; the closest surrogate is `glottalTilt` + `voiceBreathSync`.
Add an `openQuotient`/`h1h2` source control (gap §9c-N7) OR fit the H1–H2 target
through the combination of tilt + a boosted-fundamental term; either way the
scorer must *measure* H1–H2 per dynamic (§9a).

**S17.** **Sex/class tilt difference.** Female voices have markedly stronger
spectral tilt (weaker highs) than male: **H1–A3 ~9.6 dB higher for females**, and
**H1–H2 ~5.7 dB higher** (Klatt & Klatt 1990 data via Hanson & Chuang 1999) —
attributed to a more prevalent posterior glottal chink and less complete closure.
H1–A1 male mean −6.9 dB, H1–A3 male mean 13.8 dB (Hanson & Chuang Table VIII). —
Evidence: Klatt & Klatt 1990; Hanson & Chuang 1999 `[corroborated]`. *Synthesis
consequence:* the mezzo source ships a **steeper tilt and higher H1–H2** prior
than tenor/contrabass `[derived]` initializer; it is a *prior*, refined per corpus.
Do not copy male-fitted source values across the sex boundary (FAMILY FIREWALL).

**S18.** **Flow phonation** (Sundberg) is the efficient middle: full closure (not
noisy/breathy) but large flow amplitude and moderate open quotient → strong
fundamental, moderate H1–H2, high maximum-flow-declination-rate (MFDR). MFDR is
the single best predictor of radiated level and high-frequency source energy — a
good "excitation strength" knob. — Evidence: Gauffin & Sundberg 1989 `[corroborated]`.
*Synthesis consequence:* map the dynamic axis onto (tilt flattening + MFDR-like
excitation strength) together, keeping H1–H2 near modal at mf and letting it rise
only toward pp; this reproduces flow phonation without an explicit glottal-flow
waveform.

**Caveat (S16–S17):** H1–H2 alone is an unreliable breathiness index (Kreiman et
al.) and H1–A1/H1–A3 are vowel/formant-dependent. Prefer a *set* — H1–H2, H2–H4,
plus a high-band tilt (H1–A3) — in the scorer.

---

## 4. Vibrato: rate, extent, onset, and the FM→AM body coupling

**S19.** **Rate.** Professional opera central rate is best stated as **~5.5–6.2
Hz** with real study-to-study spread: Prame 1994 mean 6.0 Hz (rising ~15% at
phrase endings); Glasner & Johnson 2022 mean 5.3 Hz; a one-century soprano survey
mean 6.22 Hz. By voice class (Nix 2016, college majors): **soprano 5.42,
baritone 5.11, tenor 4.91, mezzo 4.62 Hz** — high voices tend faster, and **women
faster/wider than men** across studies (the tenor-vs-soprano ordering can invert
by dataset). — Evidence: Prame 1994; Nix 2016; Glasner & Johnson 2022; soprano
century survey `[corroborated for range and women-faster; exact class means
single-source]`. *Synthesis consequence:* default `vibratoRate` per class ≈ mezzo
5.4, tenor 5.4, contrabass 5.0, boy ~0 (S43) `[derived from the above spread]`;
keep `vibratoRateSd` ≈ 0.5–0.7 (real ±10% within-note jitter, S22). The engine
default 5.5 Hz is a fine tenor/mezzo starting value; contrabass should sit lower.

**S20.** **Extent.** Prame 1997: per-tone extent ranged **±34 to ±123 cents**,
grand mean **≈ ±71 cents**, correlating ~linearly with mean f0 (higher notes →
wider cents) and *increasing over the tone's duration*. College normative total
extent ~50–120 cents (±25–60). — Evidence: Prame 1997; Nix 2016 `[corroborated]`.
*Synthesis consequence:* the engine default `vibratoDepth` 18 cents (±) is on the
*narrow* side of operatic norms — for adult classical presets fit toward ±40–70
cents; keep it a fitted per-class value with an f0/register slope (wider higher).
`vibratoDepthSd` ≈ 5 is reasonable. Boy soprano stays near ±0 (S43).

**S21.** **Onset delay & ramp.** Vibrato onset (delay from phonation to first
vibrato cycle) is a recognized parameter (Seashore; Sundberg's four variables:
rate, extent, regularity, waveform), and *earlier onset is rated more appropriate*
by expert teachers. **No corroborated numeric norm exists** — reported values are
highly singer/context-dependent (often a few hundred ms up to ~1 s on sustained
notes). — Evidence: ICPhS 1999 onset study; Sundberg SSV `[single-source;
genuinely variable — no norm]`. *Synthesis consequence:* ship the trajectory
*mechanism* (delay → ramp → drift) with fitted per-class values; a plausible prior
is delay 200–600 ms, ramp 300–800 ms on long notes `[derived prior, not a target]`.
This mirrors the bowed N4 gap; if the engine's vibrato lacks fade-in/onset-delay
keys they are new neutral (=instant) defaults (gap §9c-N8).

**S22.** **Pitch drift and rate jitter.** A slow random drift of mean f0, extent
**≈ ±1% ≈ ±17 cents**, bandwidth ~1/3 of vibrato rate (males), ~1/2 (females);
rate varies up to **±10%** over one sustained note (Maher & Beauchamp 1990;
matches the ±15 cents choir-singer scatter of Ternström & Sundberg). — Evidence:
Maher & Beauchamp 1990 `[single-source for the ±10%; ±17 cents drift corroborated]`.
*Synthesis consequence:* add slow ±~15 cents f0 drift and ±10% rate jitter rather
than a locked LFO — this is the §2.5c human-variability item for the voice, and
the "mechanical vibrato" tell the preflight warns about.

**S23.** **FM→AM body coupling (THE "alive" mechanism, same as bowed C28).** As
f0 oscillates, every harmonic sweeps up/down in frequency and is filtered by the
fixed formant envelope: a partial on a rising formant slope is boosted, one on a
falling slope attenuated → amplitude modulation at the vibrato rate even though
the *source* amplitude is nearly constant. **Per-partial AM is much larger than
the RMS (overall) AM** — individual partials swing by several to >10 dB while the
loudness ripple stays ~1–3 dB, because partials peak out of phase (Maher &
Beauchamp 1990, 4 professional singers). Per-partial AM depth scales with
**vibrato extent × local formant slope** (the small-extent alto tone showed the
smallest ripple). Removing the AM in resynthesis caused a clearly audible quality
loss. — Evidence: Maher & Beauchamp 1990 (read from PDF); mechanism corroborated
by the Laryngeal-Level-AM study `[corroborated mechanism; exact per-partial dB
single-source/approximate]`. *Synthesis consequence:* this is identical to the
bowed T5 path — under vibrato, each partial's body gain **must** be re-evaluated
per audio block from the interpolated `bodyBands` curve at its *instantaneous*
frequency. A body EQ sampled once per note produces zero AM. Reuse the bowed
`vibrato-body-am` scorer feature (median tracked-partial AM ≥ 3 dB) for the voice
(§9b). This is the highest-value shared mechanism between families.

**S24.** Perceptual weighting (from the bowed literature but mechanism-general):
removing the AM changes perceived quality markedly; removing the FM (keeping AM)
changes it little. — Evidence: Mellody & Wakefield 2000; Fletcher & Sanders 1967
`[corroborated, cross-family]`. *Synthesis consequence:* weight `body_am_db`
above exact FM-depth match in scoring, as the bowed annex does.

---

## 5. Consonant onsets (OWNER PRIORITY) — a burst + VOT + transition model

The target model (preflight V0.3): a consonant = a strong articulation-strength
draw with a per-class spectral signature = **noise burst (spectrum, duration) +
voice-onset-time gap + F1/F2 formant-transition ramp** into the vowel over ~40–150
ms. Scope minimum: one plosive class (/d/-like), one nasal (/m/-like), one
fricative (/s/-like). The literature below supplies the published values.

### 5.1 Plosive burst spectra (per place of articulation)

**S25.** Burst spectral templates (Blumstein & Stevens 1979 — the auditory system
integrates the first ~20 ms; gross shape gives ~84% place identification):

| Place | Template | Energy concentration |
|---|---|---|
| Labial /b p/ | diffuse-falling | low–mid, ~600–800 Hz |
| Alveolar /d t/ | diffuse-rising | high, ≥ 4 kHz (peaks ~4.5 & 7.5 kHz) |
| Velar /g k/ | compact | single mid peak ~1.8–2 kHz, *tracking the following vowel* (rises to ~4.7 kHz before front vowels — the "velar pinch") |

— Evidence: Blumstein & Stevens 1979 `[corroborated for template scheme]`;
concrete Hz bands from Coleman `[single-source/textbook]`. *Synthesis consequence:*
the burst is a **shaped noise transient** on the excitation: labial = weak
low-pass falling; alveolar = bright high-pass (≥4 kHz); velar = band-pass mid peak
that should track the vowel's F2/F3. For the /d/-like minimum-scope class, use the
alveolar high-pass burst.

**S26.** Burst **duration** ordering: labial < alveolar < velar; velar bursts
often show a double burst. Textbook approximations (no clean primary ms table):
labial ~5–15 ms, alveolar ~15–25 ms, velar ~25–40 ms. — Evidence: Stevens
(release mechanisms); Coleman `[single-source/textbook approximation]`.
*Synthesis consequence:* burst-duration param default ~10–25 ms, place-scaled;
this is the front end of the VOT interval (S27), not a separate timer.

### 5.2 Voice-onset time (the burst→phonation gap)

**S27.** English VOT (Lisker & Abramson 1964; Cho & Ladefoged 1999):
- **Voiced /b d g/**: short-lag, **~0 to +25 ms** (voicing starts near release);
  optional prevoicing (**−60 to −100 ms**) is dialect/position-dependent.
- **Voiceless aspirated /p t k/**: long-lag, **~40 to 90+ ms** (an aspiration-noise
  gap before harmonic voicing).
- **VOT increases labial → alveolar → velar** (robust cross-language; English
  means e.g. /p/ 46–58, /t/ 56–69, /k/ 67–75 ms).
— Evidence: Lisker & Abramson 1964; Cho & Ladefoged 1999; corroborated means from
two independent studies `[corroborated for categories and ordering; exact means
single-source each]`. *Synthesis consequence:* the VOT param is a **gap** between
the burst and the onset of pitched phonation: voiced ≈ 0–20 ms (or a negative
"voicing lead" that starts a low-level pitched murmur *before* the burst);
voiceless ≈ 40–80 ms of aspiration noise. Scale by place (p<t<k).

### 5.3 Formant transitions and locus

**S28.** Transition duration: F1/F2/F3 glide from release to vowel steady-state
over **~40–100 ms**, with the primary place cue in the **first 20–40 ms**. F1
rises from a low locus (~200–300 Hz at release, since the constriction lowers F1)
up to the vowel F1. F2 points toward a **place-specific locus**:

| Place | F2 locus |
|---|---|
| Labial /b p/ | ~720 Hz (Delattre) / ~1000–1200 Hz (operational) |
| Alveolar /d t/ | ~1800 Hz (stable — flattest locus-equation slope) |
| Velar /g k/ | variable, up to ~3000 Hz before front vowels; no stable back-vowel locus |

— Evidence: Delattre, Liberman & Cooper 1955; Kewley-Port 1982; Harrington
`[corroborated for ordering and alveolar ~1800; labial operational range
single-source]`. *Synthesis consequence:* at release set F2-start at the place
locus, then ramp linearly (or slightly curved) to the vowel's fitted F2 over ~40–80
ms; ramp F1 from ~250 Hz up to the vowel F1 over the same window. In engine terms
this is a **timed override of the vowel body's F1/F2 band centres at note onset**,
relaxing to the sustained vowel body — it rides `bodyArticulation`. Make the velar
locus vowel-dependent; the alveolar (/d/-scope) locus is a stable ~1800 Hz.

### 5.4 Nasal murmur

**S29.** Nasal murmur (Fujimura 1962): a low first nasal formant **≈ 250 Hz**
plus a resonance **≈ 1000 Hz**, heavily low-pass, with **antiresonances (zeros)**
whose frequency signals place: **/m/ ~750–1250 Hz, /n/ ~1450–2200 Hz, /ŋ/ >3000
Hz** (and most variable). The murmur opens into the vowel via the homorganic
formant transition. Murmur duration ~50–150 ms (textbook). — Evidence: Fujimura
1962; Coleman `[corroborated for pole/zero ordering; durations single-source]`.
*Synthesis consequence:* the /m/-scope nasal = a fixed low pole ~250 Hz + pole
~1000 Hz + a **zero** near ~1000 Hz (for /m/), a strongly low-pass murmur for ~80
ms, then the labial (~1000–1200 Hz F2) transition into the vowel. The murmur is
*pitched* (it carries voicing), unlike the plosive burst.

### 5.5 Fricative noise

**S30.** Fricative spectra (Jongman, Wayland & Wong 2000):

| Fricative | Character | Peak / centroid |
|---|---|---|
| /s z/ (alveolar sibilant) | sharp, high | peak ~4–8 kHz; centre-of-gravity ~6.1 kHz |
| /ʃ ʒ/ (postalveolar) | strong, mid | peak ~2.5–4 kHz (lower CoG than /s/) |
| /f v, θ ð/ (labiodental/dental) | flat, diffuse, weak | no dominant peak; low amplitude |

Voiced /z v ð ʒ/ = noise + a low-frequency voicing bar, and are **shorter** than
their voiceless counterparts (duration itself cues voicing). — Evidence: Jongman
et al. 2000 `[corroborated for sibilant-vs-nonsibilant; exact CoG 6.1 kHz and
durations single-source]`. *Synthesis consequence:* the /s/-scope fricative = a
shaped **noise source** high-pass/band-pass ~6 kHz for ~100–150 ms, no pitched
component (voiceless), transitioning into the vowel; /z/-like adds a low voicing
bar and shortens. /f θ/ = broadband low-level flat noise.

### 5.6 Singing vs speech consonants

**S31.** In trained singing, **vowels are lengthened and consonants compressed to
protect legato** — the vowel:consonant duration ratio rises from ~5:1 (speech)
toward extreme values in singing (one report ~200:1). — Evidence: Vurma 2025
`[single-source for the ratio; the qualitative direction corroborated across
choral pedagogy]`. *Synthesis consequence:* in the sung consonant model, **compress
the whole burst+VOT+transition envelope toward the *front* of the note** so the
vowel target lands on the beat; keep vowel steady-states long.

**S32.** **Consonants are placed *before* the beat so the vowel lands on the
downbeat**; voiced consonants (m, n, l, z, v) carry pitch and can be sustained/
tuned; unvoiced consonants are clipped and anticipatory. — Evidence: choral-diction
pedagogy (multiple sources) `[corroborated as performance-practice convention, not
lab ms]`. *Synthesis consequence:* the consonant onset should have a small
**pre-beat anticipation** (the pitched murmur / voicing lead begins before the
notated onset), coupling to the portamento/approach law (§9c-N9).

**S33.** Measured sung VOT (McCrea & Morris 2007, female singers): **voiceless
/p/ VOT is significantly *longer in speech than in singing*** (sung /p/ is
compressed), while voiced /b/ VOT is *longer in singing*; no significant
trained-vs-untrained main effect. — Evidence: McCrea & Morris 2007 `[single-source
but a direct measured study — the most concrete sung-consonant datum found]`.
*Synthesis consequence:* when porting speech-fitted VOT values into the sung
model, **shorten voiceless VOT** and slightly lengthen voiced VOT `[derived
adaptation]`; do not use raw speech VOT as the sung target.

**S34.** Sung consonants (and more so vowels) lose intelligibility vs speech;
consonant cues are processed more left-lateralized than the stable vowel/pitch
information ("vowels sing but consonants speak"). — Evidence: Cognition study;
J. Voice intelligibility study `[corroborated]`. *Synthesis consequence:*
consonant realism is a *garnish* on identity, not the identity carrier — weight
the consonant-onset scorer features below the sustained-vowel/vibrato features
(preflight V5: no consonant feature carries weight until its reference source is
landed and QC'd).

---

## 6. Consonant reference datasets (OWNER PRIORITY) — survey and verdict

The consonant onset model needs audio with **consonant→vowel material and
phoneme-level time alignment**. VocalSet (the identity corpus) has **NO
consonants** — vowels only (S37). The survey:

**S35. NUS-48E (NUS Sung and Spoken Lyrics Corpus).** English pop lyrics, 12
subjects, 48 recordings of 20 songs, 169 min, with **both sung AND spoken**
versions and **hand-checked phone-level time alignment** (25,474 phone instances,
full consonant inventory). Sample rate commonly reported 44.1 kHz/16-bit
(unconfirmed). **Licence: not publicly stated — an NUS research/non-commercial
distribution, historically by request/download link.** — `[single-source for exact
SR; licence must be confirmed with SMC NUS]`. **This is the strongest candidate:
the only findable English corpus that is sung+spoken *and* phone-aligned including
consonants**, letting onset models be fit on *sung* material and compared to the
*spoken* baseline directly.

**S36. NHSS (NUS-HLT Speech and Singing).** English pop, 10 singers (5M/5F), ~7 h,
sung + spoken counterpart, **automatic (word-anchored) phoneme alignment**.
**Licence: formal NUS End-User Licence Agreement (research/non-commercial), EULA
document published.** — Strong second: larger, same parallel design, but alignment
is auto (not hand-corrected at phone level).

**S37. VocalSet.** VERIFIED **vowels only, NO consonants/words** — 10.1 h, 20 pro
singers (9M/11F), 17 techniques (vibrato, straight, belt, breathy, trill, vocal
fry, spoken, …), scales/arpeggios/long-tones on the 5 vowels. No lyric text, no
phoneme alignment. **Licence: CC BY 4.0.** — Excellent for vowel/technique/vibrato
identity (the SG2 corpus already uses it), **useless for consonant onsets**.

**S38. CSD (Children's Song Dataset, KAIST).** 50 Korean + 50 English children's
songs, one adult female pro, **IPA phoneme + grapheme annotation, MIDI + lyrics**,
consonants present. **Licence: CC BY-NC-SA 4.0** (freely downloadable, Zenodo/
GitHub). — Clean-licence sung option with IPA-aligned consonants; single adult
female singing children's *songs* (not a child voice); NC-SA restricts commercial
use.

**S39. vocadito.** 40 short solo singing excerpts, 7 languages, with lyrics text
and f0/note annotations but **NO phoneme-level alignment**. **Licence: CC BY 4.0.**
— Most permissive, but needs your own forced alignment before consonant use.

**S40. Spoken fallbacks.** **TIMIT** — 630 speakers, hand-aligned phonetic
transcriptions, 16 kHz, full consonant inventory; **licence paid via LDC
(LDC93S1, ~$125–250 academic), not redistributable**. **LibriSpeech** — ~1000 h
read English, 16 kHz, **CC BY 4.0**, transcripts text-only (run Montreal Forced
Aligner; LibriSpeech-Alignments available separately). **VCTK** — 109 English
speakers, ~44 h, **48 kHz, CC BY 4.0**, align yourself. Other sung corpora (PJS
CC BY-SA, JVS-MuSiC, Opencpop/M4Singer/OpenSinger CC BY-NC-SA) are Mandarin/
Japanese — only partial English-consonant transfer. — `[corroborated licences]`.

**S41. Commercial choir libraries** (Spitfire Eric Whitacre Choir, EastWest
Symphonic Choirs + WordBuilder, Strezov, Soundiron) do record consonant
articulations, but are **EULA-restricted (no redistribution, no ML-training use)
and not research-annotated** — **unsuitable as a fitting corpus on licence
grounds**.

**S42. VERDICT.** Best source for fitting consonant-onset models, licence-checked:
1. **First choice: NUS-48E** — sung+spoken, English, hand phone-aligned including
   consonants. Confirm the NUS research licence before use/redistribution.
2. **Second: NHSS** — same design, larger, auto phone-alignment, formal research
   EULA.
3. **Clean-licence sung: CSD (CC BY-NC-SA)** — IPA-aligned sung consonants, but
   adult female / children's songs and NC-SA.
4. **If only cleanly-redistributable sources are acceptable, only SPOKEN corpora
   are truly viable**: TIMIT (paid, best hand-alignment) or the free CC BY 4.0
   pair **LibriSpeech + VCTK** (supply your own forced alignment).
   **Sung-adaptation caveat (S31–S33):** speech consonants are longer, less
   compressed and less coarticulated than sung ones; a speech-fitted onset library
   **over-estimates consonant duration** — scale consonant durations *down*,
   shorten voiceless VOT, and re-anchor onsets to the vowel onset (pre-beat) when
   porting into the singing engine. State this caveat in the preset provenance.
   If no sung source is licensable, **reduce scope to burst+VOT without formant-
   transition fitting** (preflight V2) — the transition loci (S28) are stable
   enough to hard-set from the literature.

**Download plan (concrete):**
- **Now (free, redistributable):** LibriSpeech (openslr.org/12) + LibriSpeech-
  Alignments, and VCTK (datashare.ed.ac.uk/10283/3443). Run Montreal Forced
  Aligner → phone boundaries. Fit the *baseline* burst/VOT/transition library here.
- **In parallel (sung, gated on licence):** email SMC/HLT NUS to request NUS-48E
  and NHSS; sign the EULA. Use these to derive **speech→singing scaling factors**
  (S31–S33), not as the primary fit.
- **Free sung references:** CSD (Zenodo) for IPA-aligned sung consonants (NC),
  VocalSet (Zenodo) for vowel/technique/vibrato priors (already in corpus).
- **Only if hand-aligned ground truth is required:** budget TIMIT (LDC ~$125–250).
- Store all under the sg2-data rule; carry `phoneme`, `place`, `voiced`,
  `sungVsSpoken` through references.json.

---

## 7. Boy soprano morphology (construction from adult fits — §9 decision 2)

**S43.** **Vocal-tract-length scaling.** Adult male VTL ≈ 16.9 cm (Fitch & Giedd
1999); an 8–12 yr old boy ≈ **12–14 cm** `[derived, interpolated from Fitch &
Giedd's age curve]`, giving a formant scale factor vs adult male of ≈ **1.20–1.35
(formants ~20–35% higher)**. Younger children (~4 yr) reach ~1.4–1.5; the factor
falls toward 1.0 at male puberty. Higher formants scale slightly more than F1
(Lee, Potamianos & Narayanan 1999; Martland 1996). — Evidence: Fitch & Giedd 1999;
Lee et al. 1999 `[corroborated for the trend; the 8–12 yr 1.2–1.35 is derived]`.
*Note:* this is **larger** than the dossier's plan-inherited "formants up ~15–20%"
figure. The dossier §9.2 already reframed 15–20% as a starting prior with a
permitted `tractScale` of **0.75–0.90** (i.e. a 1/scale of 1.11–1.33) — consistent
with the low-to-mid of this range. *Synthesis consequence:* keep the dossier's
0.75–0.90 `tractScale` gate but bias the **initializer to ~0.80** (1/0.80 = 1.25),
not 0.85, to match the child-acoustics literature; still refit each vowel band
individually (dossier §9.2 step 3). See the construction table §9d.

**S44.** **f0 range.** Prepubertal children's speaking f0 ≈ 220–275 Hz regardless
of sex. Boy soprano / treble singing range: comfortable **A3–F5 (~220–698 Hz)**,
trained cathedral trebles routinely to **G5–A5 (784–880 Hz)**, some to C6 (1046
Hz); folds ~8–12 mm. **f0 is independent of tract scale** — child identity needs
both a high glottal-pulse rate and a short tract (Smith & Patterson 2005; dossier
§9.2 step 4). — Evidence: Wikipedia/DPA voice ranges; Smith & Patterson 2005
`[corroborated for range; some speaking-f0 figures single-source]`. *Synthesis
consequence:* boy soprano f0 grid ≈ **250–700 Hz** typical (extendable to ~880),
tessitura ~D4–D5; do NOT derive f0 from `tractScale` (dossier gate keeps them
independent).

**S45.** **Vibrato.** Boy sopranos/trebles characteristically sing with a **largely
straight tone / minimal vibrato** (Anglican-cathedral tradition); hard boy-specific
vibrato numbers are scarce. — Evidence: choral tradition sources `[single-source /
qualitative]`. *Synthesis consequence:* boy soprano vibrato prior = **near-zero
extent, low/irregular rate** (a straight-tone prior); do NOT apply the adult 5–6 Hz
/ ±40–70 cents defaults. `vibratoDepth` → ~0–5 cents, `vibratoProb` low.

**S46.** **Spectral purity / singer's formant.** The treble timbre is light, pure,
focused, with fewer strong overtones than a trained adult male; **the classical
singer's-formant cluster is weak-to-absent** (S12). At treble f0 the wide harmonic
spacing makes any high peak poorly sampled (as for adult sopranos above ~932 Hz).
— Evidence: voicescience lexicon; boys'-choir spectral study; Weiss et al. 2001
`[corroborated]`. *Synthesis consequence:* `singerFormantAmount ≤ 0.35` (dossier
gate); model a purer spectrum (steeper glottal tilt prior, S14 breathy end is
*wrong* — boys are pure, not breathy: use a clean modal source with few overtones).
Formant tuning (S4) may apply for the boy at the very top of the treble range, but
is a low-confidence prior — the capstone audition judges plausibility (dossier §4).

---

## 8. Perception: what carries "human voice" and voice-class identity

**S47.** **For voice-class / gender / age identity: f0 ≳ formants (VTL) >
breathiness/tilt > fine detail.** f0 is the single most salient gender cue
(dominating even when it conflicts with formants); the vocal-tract-length cue
(formant scale/spacing) is the strong second, mapping to perceived body size.
Both are needed and jointly (not fully) determine sex/size/age (Smith & Patterson
2005). — Evidence: Smith & Patterson 2005; gender-perception weighting studies
`[corroborated]`. *Synthesis consequence:* get **f0 (absolute + contour) and
formant scale (VTL / class multiplier §7, §1.3) right first** — these carry class
identity. For the boy soprano, high f0 + ~1.25 formant scaling is what reads as
"child"; neither alone suffices.

**S48.** **For "this is a living human voice" (naturalness): time-varying source
detail dominates.** The recurring "uncanny" tells: (1) unnaturally regular/steady
pitch and vibrato (constant mechanical vibrato); (2) over-clean/absent breath and
aspiration noise; (3) a static spectral envelope not co-modulating with vibrato
(no FM→AM, S23); (4) metronomic onset timing with no human deviation; (5) metallic
timbre from an over-clean harmonic source with no source–tract interaction. Adding
vibrato **attack/release + irregularity** significantly improves naturalness. —
Evidence: SVS naturalness studies (MOS); Maher & Beauchamp 1990 `[corroborated]`.
*Synthesis consequence:* the naturalness budget goes to (a) body-coupled vibrato AM
(S23, shared with bowed), (b) `voiceBreathSync` breath that pulses with f0 (not a
static bed), (c) vibrato onset delay/ramp/drift (S21–S22), (d) human onset timing
(pre-beat consonants, S32). Static perfection is the tell — the same lesson as the
bowed "mechanical vibrato" warning.

---

## 9. Deliverables

### 9a. Scorer feature targets and tolerances per voice class

All spectral targets apply to the rendered note *after* body EQ, measured as the
scorer measures references. Values marked ⊙ are **corpus-derived at fit time**
(store in the measured profile; the tolerance is on render-vs-reference distance,
not an absolute). Formant regions are the fitted-vowel gate ranges, not per-vowel
Hz (those live in the per-vowel body presets).

| Feature | Tenor | Contrabass | Mezzo-soprano | Boy soprano |
|---|---|---|---|---|
| Singer-formant centre (fixed-Hz cluster) | 2.7–2.85 kHz, prominence ≥ −6 dB | **2.3–2.6 kHz**, ≥ −6 dB | none (no gate; formant tuning instead) | none |
| Singer-formant amount | > 0 fitted | > 0 fitted | ≥ 0 (zero allowed) | ≤ 0.35 |
| Glottal source slope (median) | −18…−1 dB/oct; sign: slope(pp) < slope(f) | same | steeper prior (−15…−1); sign gate | steep/pure prior (−15…−4) |
| H1–H2 by dynamic ⊙ | pp: +3…+8; mf: 0…+3; f: −3…0 dB | same | +2 dB higher than male (S17) ⊙ | modal, clean (0…+3), low noise |
| Vibrato rate | 5.0–6.2 Hz | 4.6–5.6 Hz | 4.6–5.8 Hz | ~0 (straight; if present 5–7 Hz) |
| Vibrato half-extent (mid register) | ±35–70 cents | ±30–60 | ±35–75 (wider higher) | ±0–5 cents |
| Vibrato drift / rate jitter | ±15 cents / ±10% | same | same | n/a (straight) |
| `body_am_db` (median partial AM at vib rate) | ≥ 3 dB; best partial ≥ 8 dB | same | same | n/a (no vibrato) |
| Formant-tuning (F1≈f0) above threshold | inactive except top | inactive | **active above per-vowel F1 threshold**, R1/f0 in [1.0, 1.15] | prior, top of range only |
| Onset f0 approach (portamento) ⊙ | fitted distribution | fitted | fitted (scoop common) | light/straight |
| Consonant onset features (when corpus landed) | burst spectrum+dur, VOT, F1/F2 slope over first 150 ms | same | same | reduced (children compress diction) |

Notes: (i) the contrabass singer-formant window **must be lowered** from the
tenor's 2.7–3.3 kHz to ~2.3–2.6 kHz (S9) — the current code reuses the tenor
window for contrabass. (ii) No `mezzo.singer-formant-band` prominence gate (S11).
(iii) Consonant features carry **zero weight** until the reference source (§6) is
landed and QC'd (preflight V5).

### 9b. Construction-checklist assertions (`assertions.py` format)

New/changed rows for `evaluate_construction`, matching the existing
`_result(id, description, passed, value, threshold, strict_evidence=…)` style and
the sung block (`if FAMILY.get(name) == "sung":`). Existing sung assertions
(`glottal-rolloff`, `glottal-law`, `singer-formant-law`, `pitch-sync-breath`,
`tenor/contrabass.singer-formant-band`, `boy-soprano.*`) stand; these extend them.

| Assertion ID | Required fact | Threshold |
|---|---|---|
| `contrabass.singer-formant-band` (**fix**) | Lower the reused tenor window to the bass centre (S9) | 2.3–2.6 kHz prominence ≥ −6 dB (replaces the 2.7–3.3 kHz window for contrabass) |
| `<voice>.dynamic-tilt` | Source slope flattens with dynamic (loud brighter), same-register (S14–S15) | slope(f) − slope(pp) ≥ +2 dB/oct (soft is steeper) |
| `<voice>.h1h2-dynamic` ⊙ | H1–H2 rises toward soft dynamics / breathier pp (S16) | H1–H2(pp) − H1–H2(f) ≥ +2 dB (provisional until ⊙) |
| `<voice>.vibrato-body-am` | Vibrato render (depth ≥ 10 cents) shows median tracked-partial AM at the vibrato rate (S23) — reuse the bowed feature | `body_am_db` ≥ 3 dB (n/a for boy-soprano straight tone) |
| `<voice>.vowel-classification-gate` | Each fitted vowel body, rendered at 3 registers, lands in that reference vowel's F1/F2 region (preflight V1, hard construction assertion) | rendered (F1,F2) within the fitted vowel's region for ≥ 5/5 cardinal vowels at low+mid registers |
| `mezzo-soprano.formant-tuning-law` | Above the per-vowel F1 threshold, R1 is slaved to f0 (S4–S5) | for f0 > fitted F1: rendered F1 / f0 in [1.0, 1.20]; law inert below threshold |
| `mezzo-soprano.no-forced-cluster` (exists as `singer-formant-law`) | No adult-male 3 kHz prominence forced (S11) | `singerFormantAmount` fitted, zero allowed; **no** band-prominence gate |
| `<voice>.consonant-onset-evidenced` (gated) | Consonant onset params stay NEUTRAL until this voice's consonant corpus (§6) is landed (mirrors the bowed family-firewall pattern) | consonant burst/VOT/transition params neutral, OR ≥ N tracked consonant onsets from this voice's references |
| `boy-soprano.straight-tone` | Boy vibrato prior is near-straight (S45) | `vibratoDepth` ≤ 8 cents unless a child reference demonstrates otherwise |
| `boy-soprano.pure-source` | Boy source is clean/modal, not breathy (S46) | `voiceBreathSync` low and no breathy H1–H2 elevation forced |

**Vowel-classification gate regions** (the V1 hard gate — the fitted vowel body
rendered at 3 registers must classify as its vowel). Use F1/F2 boxes seeded from
S1 and scaled by the class multiplier (§7); refit per class. Adult-male seed
boxes (Hz), widened ±20% for the gate:

| Vowel | F1 box | F2 box |
|---|---|---|
| /i/ | 270–410 | 1900–2800 |
| /ɛ/ | 460–700 | 1500–2150 |
| /ɑ/ | 610–920 | 1100–1600 |
| /o/ | 400–600 | 730–1100 |
| /u/ | 300–460 | 800–1200 |

Scale the boxes by ×1.15 (mezzo), ×0.94 (contrabass), ×1.25 (boy) `[derived]`
before gating each class, and disable the gate above the register where F1/F2
become unreliable (S6).

### 9c. Engine gap specs (consonant onset layer + portamento; defaults NEUTRAL)

Verify existing sung params first (`glottalTilt`, `singerFormantAmount`,
`voiceBreathSync`, `bodyArticulation` all present in `params.js`; vibrato and
`onsetScoop*` present). New keys, all neutral by default so every existing sound
is preserved:

- **N4 · Formant-tuning law (mezzo, S4–S5).** `formantTuneToF0` ∈ [0, 1.2],
  default 0 (off). When > 0, above a per-vowel threshold the render slaves the F1
  body band to `formantTuneToF0 × f0` (≈1.0–1.15). `formantTuneThresholdSource`:
  derive threshold from the fitted vowel F1. Class-conditional (mezzo on, tenor/
  contrabass off, boy prior). Requires per-block F1 re-evaluation from f0 — the
  body bands are fixed-Hz, so this is a targeted override, not a preset.
- **N5 · Per-class singer-formant centre (S9).** Replace the hardcoded
  `{ freq: 3000 }` singer-formant band (`synth.js:2737`) with
  `singerFormantHz`, default 3000; contrabass ≈ 2400, tenor ≈ 2800. Keep
  `singerFormantAmount` as the gain.
- **N6 · Dynamic glottal tilt (S14).** `glottalTiltDynamicSlope` ∈ [−1, 1],
  default 0. Tilts the source flatter at loud, steeper at soft, around the static
  `glottalTilt` anchor — the sung analogue of the bowed dynamic-tilt law.
- **N7 · Open-quotient / H1–H2 source control (S16).** `sourceOpenQuotient` (or
  `h1h2Boost`) ∈ [0, 1], default 0 (modal). Raises H1 relative to H2 for a
  breathier/flow source; couples to the dynamic axis (breathier pp). Optional if
  the tilt+fundamental combination already reproduces the measured H1–H2.
- **N8 · Vibrato trajectory (S21–S22).** If missing from DEFAULTS:
  `vibratoOnsetDelayMs` (default 0 = instant), `vibratoRampMs` (default 0),
  `vibratoRateDrift`/`vibratoDepthDrift` (default 0). Neutral = locked LFO
  (current behaviour); fitted values give the alive trajectory.
- **N9 · Consonant onset layer (the one genuinely new mechanism, S25–S33).** A
  per-onset consonant class riding the articulation draw (must extend the L2/L5b
  onset architecture, NOT a bolt-on). Parameters, all neutral (no consonant) by
  default:
  - `consonantClass` ∈ {none, plosive, nasal, fricative}, default none.
  - `consonantPlace` ∈ {labial, alveolar, velar}, default alveolar.
  - `consonantVoiced` bool, default true.
  - `consonantBurstHz` (band centre of the noise burst): labial ~700, alveolar
    ~5000, velar ~1900 (vowel-tracked); default from place.
  - `consonantBurstDurationMs` ∈ [0, 60], default place-scaled (~10/20/35).
  - `consonantVotMs` ∈ [−100, 120]: voiced 0–20 (or negative lead), voiceless
    40–80, place-scaled; default from voiced/place.
  - `consonantF2LocusHz`: labial ~1100, alveolar ~1800, velar vowel-dependent;
    the F2 start the transition ramps from.
  - `consonantTransitionMs` ∈ [20, 150], default ~60: F1 (from ~250 Hz) and F2
    (from locus) ramp to the vowel targets, riding `bodyArticulation`.
  - `consonantNasalZeroHz` (nasal only): m ~1000, n ~1800, ŋ ~3000+.
  - `consonantFricativeHz` (fricative only): /s/ ~6000, /ʃ/ ~3300, /f θ/ flat.
  - `consonantStrength` ∈ [0, 1], default 0: the articulation-strength draw that
    the onset colour rides (preflight V0.3).
  - **Sung adaptation (S31–S33):** all durations are the *sung* (compressed)
    values; if fit from spoken data, apply a `sungConsonantScale` < 1 to burst/
    VOT/transition durations and anchor the onset pre-beat.
- **N10 · Portamento / approach f0 for sung onsets (S32, S48).** `onsetScoop*`
  keys already exist for the generic onset; verify they cover the sung scoop
  distribution (singers approach from below or above). If a **pre-beat
  anticipation** for pitched consonants is not expressible, add
  `consonantPreBeatMs` ∈ [0, 120], default 0.

**Priority order:** N5 (cheap band-centre fix, unblocks the contrabass gate) →
N4/N6 (mezzo tuning + dynamic tilt, the two class-defining laws) → N9 (consonant
layer, owner priority, but gated on the §6 corpus) → N8/N7/N10 (naturalness
polish). N9 must not carry scorer weight until its corpus is QC'd (preflight V5).

### 9d. Boy-soprano construction table (from adult fits)

| Quantity | Value | Basis |
|---|---|---|
| `tractScale` (initializer) | **0.80** (1/0.80 = 1.25 formant uplift) | S43 `[derived]`; dossier gate 0.75–0.90 kept |
| Formant scale factor | ×1.20–1.35 (F3+ slightly larger) | S43 (Fitch & Giedd 1999; Lee 1999) |
| Base formants | adult tenor fitted per-vowel | S1, dossier §9.2 step 2 |
| Scaled formants | tenor × 1/`tractScale`, then **refit per vowel** | dossier §9.2 step 3 (do not force one ratio) |
| f0 range (sing) | ~250–700 Hz (to ~880 A5) | S44 |
| f0 (independent of tract) | yes | S44, dossier §9.2 step 4 |
| Vibrato | near-straight: `vibratoDepth` ~0–5 cents, low `vibratoProb` | S45 |
| Glottal source | clean modal, few overtones (pure, NOT breathy) | S46 |
| `singerFormantAmount` | ≤ 0.35 (no adult cluster) | S12, S46; dossier gate |
| Formant tuning | prior only, top of treble range | S46 (low confidence) |
| Gate status | exempt from quantitative match; must pass topology/morphology + vowel-classification | dossier §2, §4; preflight V2 |

### 9e. Consonant dataset verdict + download plan

See §6, S42. Summary: **NUS-48E** is the best fitting source (sung+spoken,
English, hand phone-aligned incl. consonants — confirm the NUS research licence);
**NHSS** second; **CSD** the clean-licence sung option (CC BY-NC-SA). If only
redistributable sources are acceptable, **spoken-only** is the fallback:
**LibriSpeech + VCTK (CC BY 4.0, self-aligned)** now, **TIMIT (LDC, paid)** only
if hand-aligned ground truth is required — with the documented **sung-adaptation
caveat** (compress consonant durations, shorten voiceless VOT, anchor onsets
pre-beat). If no sung source licenses, **reduce scope to burst+VOT** and hard-set
the transition loci from S28.

---

## 10. Appendix: corrections and evidence-quality notes

1. **Engine correction — singer-formant band is hardcoded at 3000 Hz**
   (`synth.js:2737`) and the `contrabass.singer-formant-band` gate reuses the
   tenor 2.7–3.3 kHz window. Per S9 the bass cluster sits ~2.3–2.6 kHz; both need
   the per-class centre (N5). This is the clearest engine/annex mismatch found.
2. **Dossier consistency:** the annex confirms DOSSIER_SUNG §5 verdicts — G1
   register tables + fixed-Hz vowel bodies (never pitch-shift the tract with f0,
   *except* the class-conditional mezzo formant-tuning override S4), G6 glottal
   tilt (zero admissible), conditional singer's formant (tenor/contrabass only),
   conditional breath, and the amended boy-soprano vowel-wise scaling. The one
   addition is the **mezzo formant-tuning law** (S4–S5), which the dossier does not
   yet carry.
3. **Weakest numbers in this annex** (re-measure/verify before freezing): exact
   singer-formant centres per class (S9, sources disagree ~300–400 Hz); singer-
   formant level-scaling dB (S10, 12–15 vs 16–19); loud/soft glottal-tilt dB (S14,
   partly paywalled abstracts); vibrato onset-delay norms (S21, no norm exists);
   per-partial vibrato-AM dB (S23, single-source/approximate); all sung-consonant
   duration/VOT scalings (S31–S33, sparse); boy 8–12 yr VTL/scale (S43, `[derived]`).
   Everything marked ⊙ in §9a shares this status by design.
4. **Family firewall:** male-fitted source, vibrato and consonant values are never
   defaults for the mezzo or boy soprano — cross-sex and cross-age priors are
   `[derived]` initializers only, refit per corpus (preflight V0.2).
5. **VocalSet has no consonants** (S37) — the identity corpus cannot supply the
   consonant onset fit; that is the entire reason for the §6 dataset survey.

---

## 11. Source index (full URLs)

Vowel formants & singer's formant:
- Sundberg (1988), "Vocal Tract Resonance in Singing", *NATS Journal* —
  https://www.nats.org/_Library/Kennedy_JOS_Files_2013/JOS-044-4-1988-011.pdf
- Joliveau, Smith & Wolfe (2004), *JASA* 116(4):2434 —
  https://www.phys.unsw.edu.au/~jw/reprints/Joliveauetal.pdf ; *Nature* 427:116 —
  https://www.nature.com/articles/427116a
- Wolfe, Garnier & Smith (2009), *HFSP Journal* 3(1):6 —
  https://www.phys.unsw.edu.au/jw/reprints/WolfeGarnierSmith.pdf ;
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2689615/
- Sundberg (2001), "Level and centre frequency of the singer's formant", *J.
  Voice* 15:176 —
  https://www.sciencedirect.com/science/article/abs/pii/S0892199701000194
- Voice Science lexicon, "Singer's Formant" (Müller 2022; Bloothooft & Plomp 1986;
  Weiss 2001; Björkner 2008) — https://www.voicescience.org/lexicon/singers-formant/
- Weiss, Brown & Morris (2001), "Singer's formant in sopranos: fact or fiction?",
  *J. Voice* 15:457 —
  https://www.sciencedirect.com/science/article/abs/pii/S0892199701000467
- Hillenbrand et al. (1995) Table V —
  https://www.acsu.buffalo.edu/~jsawusch/PSY719/Vowels.pdf
- Peterson & Barney (1952) men's table —
  https://www.sfu.ca/sonic-studio-webdav/handbook/Formant.html
- Klatt (1980) bandwidths via Praat KlattGrid —
  https://www.fon.hum.uva.nl/praat/manual/Create_KlattGrid_from_vowel___.html

Glottal source:
- Gauffin & Sundberg (1989), *JSLHR* 32:556 —
  https://pubs.asha.org/doi/10.1044/jshr.3203.556
- Hanson & Chuang (1999), *JASA* 106(2):1064 —
  https://graphics.stanford.edu/~echuang/glottal.pdf
- Childers & Lee (1991), *JASA* —
  https://linguistics.berkeley.edu/~kjohnson/LSA317/Childers&Lee1991.pdf
- Garellek, "The Phonetics of Voice" —
  https://idiom.ucsd.edu/~mgarellek/files/Garellek_Phonetics_of_Voice_Handbook_final.pdf
- Nordenberg & Sundberg (2004), *JASA* 115(3):1270 —
  https://pubmed.ncbi.nlm.nih.gov/10089615/
- Klatt & Klatt (1990), *JASA* 87:820 (via Hanson & Chuang and secondary summaries)

Vibrato:
- Prame (1994/1997), rate and extent/intonation (via voicescience lexicon and
  JASA records) — https://www.voicescience.org/lexicon/vibrato-rate/
- Nix et al. (2016), vibrato rate by voice class — https://www.voicescience.org/lexicon/vibrato-rate/
- Maher & Beauchamp (1990), *Applied Acoustics* 30:219 —
  https://www.montana.edu/rmaher/publications/maher_applac_0290_219-245.pdf
- Soprano century survey, *JASA* 130(3):1683 —
  https://pubs.aip.org/asa/jasa/article-abstract/130/3/1683/912858
- Laryngeal-level AM in vibrato, *J. Voice* (2008) —
  https://pubmed.ncbi.nlm.nih.gov/17658720/

Consonant acoustics:
- Blumstein & Stevens (1979) —
  https://sail.usc.edu/~lgoldste/Ling582/Week%2012/Blumstein%20&%20Stevens%201979.pdf
- Coleman, "Acoustic structure of consonants" —
  https://www.phon.ox.ac.uk/jcoleman/consonant_acoustics.htm
- Lisker & Abramson VOT (Haskins) — https://www.haskinslaboratories.org/vot ;
  VOT-at-50 review — https://pmc.ncbi.nlm.nih.gov/articles/PMC5665574/
- Cho & Ladefoged (1999) / Keating et al. cross-language VOT —
  https://linguistics.ucla.edu/people/keating/KMG1981.pdf
- Delattre, Liberman & Cooper (1955), *JASA* 28:578 —
  https://pubs.aip.org/asa/jasa/article/28/4/578/761601/
- Kewley-Port (1982) — https://pubmed.ncbi.nlm.nih.gov/7119280/
- Fujimura (1962), *JASA* 34:1865 —
  https://pubs.aip.org/asa/jasa/article-abstract/34/12/1865/684899/
- Jongman, Wayland & Wong (2000), *JASA* 108:1252 —
  https://www.researchgate.net/publication/12314438
- McCrea & Morris (2007), VOT in trained/untrained singers —
  https://pubmed.ncbi.nlm.nih.gov/17113096/
- Vurma (2025), voiced-consonant duration in singing —
  https://www.isca-archive.org/interspeech_2025/vurma25_interspeech.pdf
- "Vowels sing but consonants speak" (Cognition) —
  https://www.sciencedirect.com/science/article/abs/pii/S0010027709000596

Datasets:
- NUS-48E —
  https://smcnus.comp.nus.edu.sg/archive/pdf/2012-2013/2013_05-Pub-NUS-48E.pdf ;
  https://github.com/jayneelparekh/sp2si-code
- NHSS — https://ar5iv.labs.arxiv.org/html/2012.00337 ; EULA —
  https://hltnus.github.io/NHSSDatabase/uploads/NUSLicence.pdf
- CSD — https://github.com/equal-singer/CSD
- vocadito — https://zenodo.org/records/5578807
- VocalSet — https://zenodo.org/records/1193957
- TIMIT — https://en.wikipedia.org/wiki/TIMIT ; https://catalog.ldc.upenn.edu (LDC93S1)
- LibriSpeech — https://www.openslr.org/12
- VCTK — https://datashare.ed.ac.uk/handle/10283/3443

Boy-soprano morphology & perception:
- Fitch & Giedd (1999), *JASA* 106(3):1511 —
  https://pmc.ncbi.nlm.nih.gov/articles/PMC2669667/
- Lee, Potamianos & Narayanan (1999), *JASA* 105(3):1455 —
  https://pubmed.ncbi.nlm.nih.gov/10089598/
- Martland (1996), estimating child formants from adult data —
  https://www.isca-archive.org/icslp_1996/martland96_icslp.pdf
- Boy soprano range/timbre — https://en.wikipedia.org/wiki/Boy_soprano ;
  https://www.dpamicrophones.com/dict/singing-voices-and-frequencies/
- Boys'-choir spectral energy —
  https://www.sciencedirect.com/science/article/abs/pii/S0892199723002928
- Smith & Patterson (2005), f0 + VTL —
  https://www.pdn.cam.ac.uk/system/files/documents/SPjasa05.pdf
- SVS vibrato/naturalness — https://arxiv.org/pdf/2211.00996
- SVS timing naturalness/MOS — https://arxiv.org/pdf/2301.02262
