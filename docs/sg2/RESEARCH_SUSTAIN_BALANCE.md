# Research annex — sustained-note band balance for blown instruments

Commissioned by OWNER_LISTENING_NOTES.md L10 (owner: alto sax "more character
but the balance is still off — there should be a frequency profile that
balances more broad frequency bands for the sustained note") and L6 ("too
bright, no richness in the mids"). Purpose: ground the new coarse
band-balance scorer feature and its §3 tripwire in published LTAS /
spectral-envelope measurements instead of guesses.

Scope: alto/tenor saxophone, B-flat clarinet, trumpet, French horn, concert
flute — the SG2 blown campaign set. Everything below is a numbered claim
with citation(s) and a synthesis consequence. Claims resting on one source
are tagged **[single-source]**; values we computed from a cited law (rather
than read from a published table) are tagged **[derived]** and the
derivation is shown. Per the FAMILY FIREWALL, all values are blown-family
evidence only.

---

## 1. Published spectral envelopes / LTAS per instrument

### Saxophone

**C1. The radiated alto/tenor sax spectrum at mezzoforte follows one
smooth broadband envelope: a +3 dB/oct rise below a break frequency and an
18 dB/oct fall above it.** Benade & Lutgen measured room-averaged spectra
of essentially all notes of the low and second registers of an E-flat alto
and B-flat tenor at mezzoforte; all component amplitudes fit
`E(x) = [N·x / (1 + x^7)]^(1/2)` with `x = f/f_b` — i.e. f^(1/2)
(+3 dB/oct) below the break and 1/f^3 (−18 dB/oct) above it
(A. H. Benade & S. J. Lutgen, "The saxophone spectrum", JASA 83(5):1900–1907,
1988 — https://pubs.aip.org/asa/jasa/article/83/5/1900/773641/The-saxophone-spectrumThe-saxophone-spectrum;
independently cited and discussed in Kergomard, Guillemain, Karkar, Dalmont &
Gazengel, "What we understand today on formants in saxophone sounds?",
Tecniacustica 2013 — https://hal.archives-ouvertes.fr/hal-01309204).
*Synthesis consequence:* the fitted alto/tenor sustained print must show a
single broadband maximum with gentle low-side rise and steep high-side fall;
a render whose octave profile rises monotonically to 2–4 kHz (the owner's
"too bright") violates a measured, two-source law.

**C2. The measured break frequencies are 837 Hz (alto) and 618 Hz
(tenor); the envelope maximum therefore sits near 650 Hz (alto) / 480 Hz
(tenor).** Break frequencies from Benade & Lutgen (C1 citation). Maximum
**[derived]**: dE²/dx = 0 for `x/(1+x^7)` gives `x_peak = 6^(-1/7) ≈ 0.774`,
i.e. ~648 Hz alto, ~478 Hz tenor.
*Synthesis consequence:* the alto's mid-band "richness" the owner misses is
literally the 500–1000 Hz octave band: published data puts the sustained
spectral-envelope peak there, not above 1 kHz.

**C3. The sax break frequency is physically the tonehole-lattice cutoff,
and on a real alto the local cutoff varies ~500–1500 Hz along the lattice
and decreases toward low-register fingerings.** Benade & Lutgen tie f_b to
lattice cutoff (C1); an independent Acta Acustica study derives alto-sax
cutoffs per fingering, "ranging from 500 Hz for cells near the end of the
lattice up to 1500 Hz for the highest cells", with cutoff decreasing from
high to low notes of the first register ("On the tonehole lattice cutoff
frequency of conical resonators: applications to the saxophone", Acta
Acustica 4(4), 2020 —
https://acta-acustica.edpsciences.org/articles/aacus/full_html/2020/04/aacus200005/aacus200005.html).
*Synthesis consequence:* the band-balance target for sax should be allowed a
mild per-register drift of the envelope-peak band (lower notes → slightly
lower peak band); one global peak frequency is an approximation, not a law.

**C4. "Saxophone formants" beyond this broadband envelope are real in the
external spectrum but their cause and stability are unresolved; fixed-Hz
formant structure must be fitted, not assumed.** Kergomard et al. 2013
(C1 citation) review the question, quote Benade's caution that much
traditionally-claimed formant structure "is in fact due to the rise and
fall of the spectrum envelope produced by the beating reed", and show
external-pressure formants that differ from internal ones with "the
question of what is the cause of the formants remains open".
*Synthesis consequence:* keep the L6 fitted `resonances` (measured bands)
as the carrier of sax mid colour; the band-balance feature should score the
coarse octave profile and leave fine formant detail to the fitted body —
do not hand-author extra sax formants from literature.

### Clarinet

**C5. Real B-flat clarinets have a tonehole-lattice cutoff near 1.5 kHz;
below cutoff even harmonics are drastically weaker than odd, and at forte
the even-harmonic envelope rises to meet the odd envelope at the cutoff.**
Petersen et al., "The link between the tonehole lattice cutoff frequency
and clarinet sound radiation: a quantitative study", Acta Acustica 4(5):18,
2020 — https://acta-acustica.edpsciences.org/articles/aacus/full_html/2020/05/aacus200020/aacus200020.html
("for actual clarinets the nominal cutoff approximates 1.5 kHz"; below
cutoff, forte, even harmonics "several decades weaker"; envelope of even
harmonics increases toward cutoff where "the even and odd harmonics are
equally strong"). Register behaviour independently: UNSW clarinet acoustics
(odd-harmonic chalumeau timbre; even harmonics gain from ~E4–A#4; above the
break the odd/even difference "almost disappears") —
https://newt.phys.unsw.edu.au/jw/clarinetacoustics.html.
*Synthesis consequence:* clarinet band balance is register-dependent by
construction (existing G1 gates); the coarse feature must be scored per
register, and a sustained-energy concentration below ~1.5 kHz is the
instrument-level anchor.

**C6. Clarinet spectral centroid measured on (simplified, clarinet-like)
resonators: ~0.22–0.28 kHz at piano vs ~0.55–1.12 kHz at forte.** Petersen
et al. 2020 (C5 citation): "the average spectral centroid for the
resonators with f_c = 1.0, 1.5, and 2.0 kHz cutoffs is 0.55, 0.94, 1.12 kHz
at forte playing levels, and 0.28, 0.22, 0.27 kHz at piano playing levels."
Caveat: simplified cylinders with idealised lattices, not orchestral
clarinets **[single-source for the exact numbers]**; the direction (louder
= much brighter) is corroborated by UNSW (harder blowing → clipped reed
flow → more/stronger high harmonics) and by Pätynen & Lokki's anechoic
clarinet observation that at piano the harmonics stay above −30 dB only to
~2.5 kHz but at fortissimo to ~5 kHz (J. Pätynen & T. Lokki, "Directivities
of symphony orchestra instruments", Acta Acustica united with Acustica
96:138–167, 2010 — https://users.aalto.fi/~ktlokki/Publs/patynen_aaua_2010.pdf).
*Synthesis consequence:* clarinet band targets must be per-dynamic: the
centroid roughly doubles-to-quadruples from p to f; a single band profile
across dynamics is unsupportable.

### Trumpet

**C7. Trumpet: spectral envelope cutoff ("corner") near 1000 Hz with an
average rolloff above it of ~15 dB/oct for scales at 68 dB SPL; the
rolloff rate decreases as playing intensity increases.** Luce & Clark,
"Physical correlates of brass-instrument tones", JASA 42(6):1232–1243, 1967
(average rolloffs at 68 dB average SPL: trumpet 15, trombone 20, tuba 17,
unstopped horn 16, stopped horn 30 dB/oct; trumpet envelope straight-line
fit above cutoff of 1000 cps; "as the intensity of a note increases, the
levels of the high-frequency partials increase more rapidly than the levels
of the low-frequency partials") —
https://pubs.aip.org/asa/jasa/article/42/6/1232/623784/Physical-Correlates-of-Brass-Instrument-Tones
(scanned copy: http://www.ibew.org.uk/dvarch/DV04046.pdf).
*Synthesis consequence:* trumpet band-balance targets are a knee near
1 kHz plus a dynamic-dependent high-side slope; fit the slope per dynamic
with ~15 dB/oct as the mf anchor.

**C8. Trumpet formant region ~1200–1400 Hz (secondary ~2500 Hz).** Backus'
orchestral-instrument data as tabulated by HyperPhysics ("Some data on
orchestral instruments": trumpet formants 1200–1400 Hz and 2500 Hz) —
https://hyperphysics.gsu.edu/hbase/Music/orchins.html. Consistent with
Lembke & McAdams' finding that the trumpet exhibits a main formant "of
considerable frequency extent" with a pitch-invariant trend (Lembke &
McAdams, "The role of spectral-envelope characteristics in perceptual
blending of wind-instrument sounds", Acta Acustica united with Acustica
101:1039–1051, 2015 — https://www.mcgill.ca/mpcl/files/mpcl/lembke_2015_actaacust.pdf).
*Synthesis consequence:* at mf/f the trumpet's strongest octave band should
be the 1–2 kHz band (unlike sax/horn), which is why borrowing profiles
across brass/wind instruments destroys identity.

**C9. At the softest playable trumpet dynamics the internal spectrum
collapses to nearly the fundamental alone, and spectra measured at
increasing levels join smoothly.** Benade, "Trumpet acoustics" (draft for
Encyclopaedia Britannica, 1973, CCRMA archive): as the player gets softer
"the higher-frequency partials become weak more quickly than the lower
ones", and at the weakest sustainable pianissimo the internal tone contains
"almost nothing beyond its fundamental"; swelled tones join smoothly —
https://ccrma.stanford.edu/marl/Benade/documents/Benade-Trumpet-1973.pdf.
Corroborated at the family level by C7 and by nonlinear-propagation
brightening (DOSSIER_BLOWN.md §2, UNSW brass, Campbell).
*Synthesis consequence:* the trumpet pp band profile is legitimately
fundamental-dominated; the scorer must not demand mid/high band energy at
pp that the literature says is absent — per-dynamic targets are mandatory.

### French horn

**C10. The horn has a main formant at ~340 Hz (vowel-"u" colour) with
ancillary formants near 750 Hz, 1225 Hz, 2000 Hz and ~3500 Hz; when playing
softly only the lower formants contribute, and rising volume feeds the
higher ones.** J. Meyer, *Acoustics and the Performance of Music*, Springer
(ch. 3, "Tonal characteristics of musical instruments") —
https://link.springer.com/chapter/10.1007/978-0-387-09517-2_3. A second,
partly independent tabulation (Backus data via HyperPhysics, C8 citation)
puts the horn formant at 400–500 Hz — same octave band, different
instrument/method.
*Synthesis consequence:* the horn's octave-band maximum for sustained notes
belongs in the 250–500 Hz band at all dynamics; the fitted body bands
(L6) should already express this — the band-balance bar makes its absence
a named failure instead of a hidden mel residual.

**C11. Horn high-side slope by dynamic, measured anechoically: −21 dB/oct
(piano), −13 dB/oct (forte), −9 dB/oct (fortissimo) above 800 Hz; the
p↔ff slope change (~12 dB/oct) was the largest of the recorded brass.**
Pätynen & Lokki 2010 (C6 citation), horn section; cross-checked against
Luce & Clark's −16 dB/oct (open horn) / −30 dB/oct (hand-stopped) at
68 dB SPL average level (C7 citation) — the mf-region values agree within
a few dB/oct once stopping is accounted for.
*Synthesis consequence:* horn band-balance targets get a per-dynamic
high-side slope directly from published numbers; this is the
best-quantified per-dynamic broadband law in the whole blown set and
should be implemented first.

### Flute

**C12. Flute "formant" description measured across players: at forte the
envelope rises ~+12 dB/oct up to 500 Hz, is flat 500–1000 Hz, and falls
~−12 dB/oct above 1 kHz; at piano the upper rolloff point drops to ~500 Hz
and the low-side rise shrinks — "we would in fact need different formants
for loud and soft playing".** N. H. Fletcher, "Acoustical correlates of
flute performance technique", JASA 57(1):233–237, 1975 —
https://www.phys.unsw.edu.au/music/people/publications/Fletcher1975.pdf.
Backus (via HyperPhysics, C8 citation) independently lists a flute formant
at ~800 Hz — inside Fletcher's forte plateau.
*Synthesis consequence:* flute band targets: peak octave band 500–1000 Hz
at forte, narrowing/peaking nearer 500 Hz at piano, symmetric-ish ±12 dB/oct
skirts. Note this also supports L7's diagnosis: flute has *weak fixed-Hz
body structure* — the broadband envelope, not sharp formant bands, carries
its balance (Lembke & McAdams classify the flute's formant structure as
"only weakly pronounced", C8 citation).

**C13. Flute dynamics act almost entirely on the upper partials: "amplitude
variations from piano to forte are largely confined to the upper partials,
particularly for notes in the low octave"; near the overblowing threshold
the fundamental can even *fall* as blowing pressure rises while upper
partials rise.** Fletcher 1975 (C12 citation).
*Synthesis consequence:* the flute's low-band (fundamental) level is nearly
dynamic-invariant — loudness normalisation must therefore not be done on the
fundamental alone, and the p→f band-profile change should be concentrated
above ~500 Hz.

### Cross-instrument

**C14. Pitch-generalised spectral envelopes at mezzoforte exist and are
formant-like for horn (strongly) and trumpet (moderately), but only weakly
for clarinet and flute; formant descriptors were operationalised with 3 dB
and 6 dB bounds around the envelope maximum.** Lembke & McAdams 2015 (C8
citation): VSL samples across full pitch ranges, sustained portions,
partial-tone detection plus cubic-spline fit over the composite (f, level)
distribution; horn/bassoon strong pitch-invariant formants, oboe/trumpet
moderate, clarinet/flute weak plateaus, clarinet's low register excluded
from pitch-invariance because the attenuated even partials move with pitch.
*Synthesis consequence:* (a) a fixed-Hz band profile per instrument is a
published, validated concept for exactly our instrument set; (b) 3 dB / 6 dB
are the literature's own granularity for "same formant region" — a natural
basis for the tripwire tolerances; (c) for clarinet (and flute), the band
profile must be fitted per register, not forced pitch-invariant.

**C15. A large-scale JASA study (5640 sounds, 50 sustained instruments,
three dynamic levels) confirms that spectral-envelope position and shape
encode instrument identity and are "significantly affected" by dynamic
level; its coarse-envelope method: 128-band ERB filterbank magnitudes,
RMS-normalised, log-transformed, DCT, first 13 coefficients kept.**
Siedenburg, Jacobsen & Reuter, "Spectral envelope position and shape in
sustained musical instrument sounds", JASA 149(6):3715–3726, 2021 —
https://pubs.aip.org/asa/jasa/article/149/6/3715/945955/Spectral-envelope-position-and-shape-in-sustained
(DOI 10.1121/10.0005088); method restated in Jacobsen & Siedenburg, Acta
Acustica 8:48, 2024 —
https://acta-acustica.edpsciences.org/articles/aacus/full_html/2024/01/aacus240075/aacus240075.html;
code: https://github.com/Music-Perception-and-Processing/spectral-envelope-study.
*Synthesis consequence:* "coarse spectral shape, fine structure discarded,
per dynamic" is the published state of the art for exactly the property the
owner is hearing; our band-balance feature is the octave/1/3-octave analogue
and must key on (instrument × register × dynamic).

---

## 2. Where "warmth / mid richness" lives perceptually

**C16. "Rich" (vs nasal) wind timbre correlates with a *low* spectral
centroid plus spectral variation over time; "nasal" with more energy in
upper harmonics.** Kendall & Carterette's wind-instrument semantic studies,
as reviewed in Saitis & Weinzierl, "The semantics of timbre", in *Timbre:
Acoustics, Perception, and Cognition*, Springer 2019 —
https://comma.eecs.qmul.ac.uk/assets/pdf/Saitis_chap5.pdf ("nasal versus
rich wind instrument sounds had more energy versus less energy,
respectively, in the upper harmonics, with rich timbres combining a low
spectral centroid with increased variations of the spectrum over time").
*Synthesis consequence:* the owner's "no richness in the mids" maps onto a
measured excess of upper-band energy relative to the 250–1000 Hz region —
i.e. a centroid/coarse-balance error, invisible to a fine 48-band mel mean
but directly visible to an octave-band profile.

**C17. "Warm–cold" (and velvety–metallic, round–angular) judgments of
steady tones track the spectral *slope*; sharpness/brightness tracks the
frequency position of the overall energy concentration (von Bismarck's
critical-band-weighted centroid).** Bloothooft & Plomp on sung vowels and
von Bismarck's sharpness model, both reviewed with citations in Saitis &
Weinzierl 2019 (C16 citation).
*Synthesis consequence:* score slope-like information explicitly: the
band-balance distance should preserve the *tilt* of the profile (e.g. by
comparing band levels re overall level, so a uniform gain cancels but a
tilt does not).

**C18. For saxophone specifically, listener semantics include a warm/soft
dimension, and sharpness-model energy weighting was the dominant predictor
of perceived sharpness/roughness.** Nykänen et al. 2009, via Saitis &
Weinzierl 2019 (C16 citation) **[single-source review chain]**.
*Synthesis consequence:* the alto-sax acceptance question "warmer, richer
mids?" is answerable by the coarse profile: more 250–1000 Hz energy re
overall, less 2–5 kHz — no new perceptual model needed.

**C19. The horn's warmth band and the classical "instrument warmth" EQ
region coincide with the 250–800 Hz span: Meyer's horn main formant 340 Hz
(C10), the u/ah vowel colours of horn formants (C10), the sax envelope
peaks 480–650 Hz (C2), and Lembke's observation that main formants near
500 Hz sit where a below-500 Hz masking-insensitive region ends (C14
citation, §7 discussion).** Recording-practice EQ charts place instrument
"warmth/body" in the same 200–800 Hz region but carry no measurement
provenance — treat them as folklore that happens to agree (e.g.
https://blog.sonicbids.com/the-ultimate-eq-cheat-sheet-for-every-common-instrument
**[anecdotal, do not gate on]**).
*Synthesis consequence:* adopt 250–500 and 500–1000 Hz as the two "mid
richness" bands the tripwire must protect for the blown family; deviations
there are the owner-audible defect.

---

## 3. How balance shifts with dynamics

**C20. Across winds and brass, louder playing raises high-frequency bands
faster than the overall level — quantified per instrument as high-side
slope flattening: horn −21→−9 dB/oct (p→ff, C11); trombone −15→−10 dB/oct
above 1 kHz; the effect is smallest for tuba and largest for horn among
measured brass; trumpet rolloff decreases with intensity (C7); clarinet
centroid roughly triples p→f (C6); flute confined to upper partials
(C13).** Pätynen & Lokki 2010 + Luce & Clark 1967 + Petersen 2020 +
Fletcher 1975 (citations above).
*Synthesis consequence:* band-balance targets are per-dynamic *by law*, and
the between-dynamic *difference* profile is itself checkable: high bands
(≥2 kHz) must rise relative to mids from p to f for every blown instrument
(this is the existing `dynamic-brightening` gate, now expressible in dB per
octave band).

**C21. In the voice — the best-measured continuously-driven instrument —
LTAS band level grows linearly with overall level but with a
frequency-dependent gain factor of ~0.5 dB/dB at low frequencies to
~1.5 dB/dB at 1.5–3 kHz.** Nordenberg & Sundberg, "Effect on LTAS of vocal
loudness variation", Logopedics Phoniatrics Vocology 29(4):183–191, 2004 —
https://www.tandfonline.com/doi/abs/10.1080/14015430410004689.
*Synthesis consequence:* (a) a render/reference comparison at mismatched
loudness *necessarily* misreads tilt — loudness matching is a correctness
precondition, not cosmetics; (b) if the campaign needs band targets at a
dynamic that was never recorded, interpolate band levels linearly in
overall dB (published behaviour), and mark the row extrapolated.

---

## 4. Measurement methodology for a 2-second-note LTAS

**C22. LTAS as a music-analysis tool is established (Jansson & Sundberg),
and its stability caveat — needing 30–90 s of signal — comes from
*nonstationary* material (speech/singing); a held single note is
quasi-stationary, so stability is governed by the number of averaged
frames, not wall-clock duration.** Jansson & Sundberg, "Long-time-average-
spectra applied to analysis of music", Acustica 34(1):15–19, 1975 (method;
constant-frequency-peak detection) —
https://www.semanticscholar.org/paper/71befcd4282e07f079db20b2b33e160b33dfcd0c;
30–90 s speech/singing convention documented across the voice-LTAS
literature (e.g. https://pubmed.ncbi.nlm.nih.gov/11824501/,
https://www.sciencedirect.com/science/article/abs/pii/S089219971000130X);
variance-reduction-by-averaged-periodograms is Welch's method (P. D. Welch,
IEEE Trans. Audio Electroacoust. 15(2):70–73, 1967). Lembke & McAdams (C14)
and Siedenburg et al. (C15) both compute their envelopes from the sustained
portion only, excluding onset and offset.
*Synthesis consequence:* for our 2 s notes, define the sustain window as
onset+0.25 s to release−0.1 s (≥1 s of signal); 4096-sample Hann at 44.1 kHz
(92.9 ms) with 75% overlap yields ~70 frames — ample for a stationary tone.
Do not demand 30 s; do exclude onset (L2's onset print would otherwise
contaminate the balance measurement).

**C23. Resolution trade-off: octave bands (7–9 values, 100 Hz–10 kHz) are
robust but can hide a formant sitting at a band edge; 1/3-octave
approximates the critical band above ~500 Hz and is the standard
fractional-octave analysis (IEC 61260-1 / ANSI S1.11 filter definitions);
full critical-band/ERB resolution (~40 bands) reintroduces the fine
structure the mel distance already covers.** Zwicker's critical bands ≈
1/3-octave above 500 Hz (E. Zwicker, "Subdivision of the audible frequency
range into critical bands", JASA 33:248, 1961); fractional-octave standard:
IEC 61260-1:2014; Pätynen & Lokki present instrument responses 1/3-octave
smoothed (C6 citation); Siedenburg et al. deliberately truncate to coarse
shape (13 DCT coefficients of 128 ERB bands, C15).
*Synthesis consequence:* compute at 1/3-octave (IEC centres 100 Hz–10 kHz,
21 bands) for the fitted feature; report and gate the tripwire at octave
resolution (8 bands, 63 Hz–8 kHz centres) so one number per broad band is
owner-legible ("are we meeting these baselines at a glance").

**C24. Loudness-matching pitfalls.** (a) Band levels and overall level are
confounded (C21) — always compare *normalised* profiles (band dB re total
sustained energy), never absolute dB, and only within the same dynamic
label. (b) Perceived balance depends on absolute playback SPL
(equal-loudness contours, ISO 226:2003), so scorer-domain matching must be
energy-based, not ear-based; A-weighting a 62 Hz horn note would delete its
fundamental from the comparison. (c) Percentile-based normalisation (the
mel feature's 95th-percentile trick, score.py:258) tracks the *loudest
band*, so a render that is only wrong by being too bright gets its excess
treated as the reference point and the error smeared into every other band
— total-energy normalisation avoids rewarding the defect. (d) Loudness
units built for programme material (ITU-R BS.1770 LUFS) embed K-weighting
(a high shelf) and are inappropriate for single-note band comparison; use
unweighted band energies. **[methodological synthesis of cited sources,
(c)/(d) are our analysis]**
*Synthesis consequence:* the feature spec below normalises each side by its
own total sustained-band energy and compares band-minus-overall dB.

---

## 5. Deliverables

### 5.a Band-balance scorer feature spec (for scripts/tone_match/score.py)

```
Feature name:      band_balance_db
Input:             sustained window = [onset + 0.25 s, release − 0.1 s],
                   minimum 1.0 s (else feature = not-applicable)
Spectrum:          Welch PSD, Hann 4096 @ 44.1 kHz, 75% overlap (~70 frames
                   on a 2 s note), unweighted                       [C22]
Bands:             1/3-octave, IEC 61260-1 nominal centres
                   100 Hz … 10 kHz (21 bands)                       [C23]
Normalisation:     L_k = 10·log10(E_k / Σ E_k)  (band re total sustained
                   energy; uniform gain cancels, tilt does not)     [C17, C24]
Validity mask:     compare band k only if reference L_k > −60 dB re total
                   (below that both sides are noise floor)
Distance:          d_mean = mean_k |L_k(render) − L_k(reference)|
                   d_max8 = max over the 8 octave summaries
                   (63…8k centres; octave summary = energy sum of its
                   1/3-octave members)                              [C23]
Scored value:      d_mean, weighted into the composite like other features;
                   weight per (instrument × register × dynamic) pair
                   normalised by reference take-to-take band variability
                   (same-floor philosophy as §2.5)
Report:            per-note octave bar chart render-vs-reference (dB re
                   overall) so the owner's "balance" question is visible
                   at a glance                                       [L10]
Keying:            per register AND per dynamic — never pooled across
                   dynamics                                          [C6, C9,
                                                                     C11, C20]
```

### 5.b Per-instrument target band profiles (dB re envelope-peak band)

Values below are **anchors for sanity/tripwire purposes**, not substitutes
for the paired-reference comparison: the scored feature always compares
against this project's own reference takes; these published anchors catch a
*systematically* wrong fit (e.g. a sax profile peaking at 2 kHz). Tolerance
±3 dB where the value is measured/derived from a measured law, ±6 dB where
extrapolated (granularity per Lembke's 3 dB/6 dB formant bounds, C14).

**Alto sax, mezzoforte** [derived from C1/C2 law, E_dB(f) =
10·log10(x) − 10·log10(1+x^7), x = f/837; band-centre evaluation ours]:

| Octave centre | 125 | 250 | 500 | 1k | 2k | 4k |
|---|---|---|---|---|---|---|
| dB re peak (≈650 Hz) | −6.5 | −3.5 | −0.6 | −4.0 | −21 | −39 |

Per-dynamic: no published alto per-dynamic table found — **extrapolate**
from C20/C21 (raise ≥2 kHz bands, ~flat ≤500 Hz, from p to f) and fit the
actual values from the pp/ff corpus takes; tolerance ±6 dB until fitted.

**Tenor sax, mezzoforte** [derived, same law with x = f/618]:

| Octave centre | 125 | 250 | 500 | 1k | 2k | 4k |
|---|---|---|---|---|---|---|
| dB re peak (≈480 Hz) | −5.2 | −2.2 | −0.1 | −10.9 | −29 | −47 |

**French horn** [measured anchors C10/C11; band values below computed from
the cited slopes, computation ours]. Peak band = the octave containing
340 Hz (250–500 Hz) at every dynamic. Above 800 Hz apply the measured
slope; between peak and 800 Hz allow 0…−3 dB:

| Octave centre | 250–500 (peak) | 1k | 2k | 4k |
|---|---|---|---|---|
| piano (−21 dB/oct) | 0 | ≈−8 | −29 | −50 |
| forte (−13 dB/oct) | 0 | ≈−5 | −18 | −31 |
| fortissimo (−9 dB/oct) | 0 | ≈−4 | −13 | −22 |

Below 250 Hz: falls off (u-vowel character, C10); fit exact low-band level
from corpus (horn B1 fundamental 62 Hz sits two octaves under the formant —
**extrapolated region**, ±6 dB).

**Trumpet**: peak octave band 1–2 kHz at mf/f (C7/C8, formant 1200–1400 Hz);
above the ~1 kHz knee, slope ≈ −15 dB/oct at mf, shallower at f/ff,
steeper at p (C7); at pp the profile legitimately collapses toward the
fundamental's band (C9) — encode pp as "fundamental band dominant,
≥2 kHz bands ≥ 20 dB down" **[qualitative, fit exact dB from corpus]**.
Below 1 kHz: rising toward the knee; exact low-side rise unpublished —
**extrapolated**, fit from corpus, ±6 dB.

**B-flat clarinet**: no single profile — per register (C5, C14). Anchors:
(a) sustained energy concentration below the ~1.5 kHz cutoff at p (C5/C6);
(b) centroid target p ≈ 0.2–0.3 kHz, f ≈ 0.6–1.1 kHz on low-register notes
(C6, simplified-resonator caveat, ±wide); (c) low register: odd-partial
bands dominate below cutoff (existing odd/even gates already enforce the
fine structure; the band feature sees only the coarse sum). Band tables:
**fit from corpus per register/dynamic**; gate only the render-vs-reference
distance plus centroid direction.

**Concert flute** [C12/C13, Fletcher's measured formant description]:

| Octave centre | 125 | 250 | 500–1000 (peak) | 2k | 4k |
|---|---|---|---|---|---|
| forte | −24 | −12 | 0 (plateau) | −12 | −24 |
| piano | ≈−24 | ≈−12 | 0 (peak ≤ ~600 Hz, plateau gone) | −24 | −36 |

(Piano row: upper rolloff point moves down to ~500 Hz per Fletcher; 2k/4k
values are one extra −12 dB/oct octave — **[derived]**, ±6 dB. Low octave
values apply to notes whose fundamental sits below the band in question;
bands under the played f0 are masked out by the validity rule.)

### 5.c Proposed §3 tripwire wording (SOUND_GENERATOR_2_PLAN.md §3 list)

> - **Band balance** (per register, per fitted dynamic): loudness-matched
>   sustained-window band profile (1/3-octave, 100 Hz–10 kHz, band dB re
>   total sustained energy) vs the paired reference: mean absolute
>   deviation ≤ 3 dB across valid bands, and no single octave-band summary
>   off by more than 6 dB. Additionally the envelope-peak octave band must
>   match the instrument's published anchor (alto sax ≈650 Hz / tenor
>   ≈480 Hz; horn 340 Hz; trumpet 1–2 kHz at mf/f; flute 500–1000 Hz at f)
>   at the
>   dynamics where the anchor is evidenced. Tolerances follow the
>   literature's 3 dB/6 dB formant-bound granularity (RESEARCH_SUSTAIN_
>   BALANCE.md C14); a reference set whose take-to-take band variability
>   exceeds a bar widens that bar to the measured variability, never the
>   reverse.

### 5.d Construction-checklist assertions (format per scripts/tone_match/assertions.py)

New shared helper: `_band_profile(bundle)` → octave-band dB re total from
the sustained window (same code path as the scorer feature; assertions and
feature must not diverge). Each row emitted via the existing `_result(...)`
shape. Cross-note assertions use `ConstructionSample.dynamic` exactly like
`dynamic-brightening`.

| Instrument | Assertion ID | Required fact (requirement string) |
|---|---|---|
| every covered blown instrument | `<instrument>.band-balance` | "sustained octave profile vs paired reference: mean abs dev <= 3 dB, max octave dev <= 6 dB, per register and dynamic" |
| alto-sax | `alto-sax.envelope-peak` | "envelope-peak octave band contains ~650 Hz (Benade peak; break 837 Hz) at mf; 2 kHz band at least 12 dB below peak band" |
| tenor-sax | `tenor-sax.envelope-peak` | "envelope-peak octave band contains ~480 Hz (Benade peak; break 618 Hz) at mf; 2 kHz band at least 15 dB below peak band" |
| clarinet | `clarinet.band-concentration` | "at piano, at least 80% of sustained energy below 1.5 kHz (tonehole cutoff); sustained centroid rises from p to f by at least a factor of 1.8 (low register)" |
| trumpet | `trumpet.envelope-peak` | "envelope-peak octave band within 1–2 kHz at mf/f; at pp the fundamental's band dominates and bands >= 2 kHz are >= 20 dB down" |
| french-horn | `french-horn.envelope-peak` | "envelope-peak octave band contains 340 Hz at every fitted dynamic; slope above 800 Hz between −25 and −6 dB/oct and monotonically shallower with dynamic (p steeper than ff)" |
| flute | `flute.envelope-peak` | "envelope-peak octave band within 500–1000 Hz at forte; peak at or below ~600 Hz at piano; skirts within ±12 dB/oct ± tolerance" |

Implementation notes for the coding agent:

1. The 80% clarinet threshold and the sax/trumpet peak-to-2 kHz drops are
   *derived* from C1/C5/C6 envelope laws, not read from a published table —
   set them as initial values and let the per-instrument corpus refine them
   (assertion thresholds may tighten with evidence, never silently loosen).
2. `french-horn.envelope-peak`'s slope window −25…−6 dB/oct is the union of
   Pätynen (−21…−9, C11) and Luce & Clark (−16 open, C7) with ±3 dB/oct.
3. Keep `not-applicable` semantics: a campaign without a pp manifest must
   fail strict mode (existing behaviour), but a single-note `score.py`
   check on an mf note simply skips the pp-specific clauses.
4. The band feature and these assertions answer L10's standing question:
   the run report's §3 table gains one "band balance" row per
   (register × dynamic) with PASS/FAIL and the octave bar chart.

---

## 6. Source index

| # | Source | Used for |
|---|---|---|
| 1 | Benade & Lutgen, JASA 83(5):1900, 1988 — https://pubs.aip.org/asa/jasa/article/83/5/1900/773641/The-saxophone-spectrumThe-saxophone-spectrum | C1, C2, sax tables |
| 2 | Kergomard et al., Tecniacustica 2013 — https://hal.archives-ouvertes.fr/hal-01309204 | C1 (verify), C4 |
| 3 | "Tonehole lattice cutoff … saxophone", Acta Acustica 4(4), 2020 — https://acta-acustica.edpsciences.org/articles/aacus/full_html/2020/04/aacus200005/aacus200005.html | C3 |
| 4 | Petersen et al., Acta Acustica 4(5):18, 2020 — https://acta-acustica.edpsciences.org/articles/aacus/full_html/2020/05/aacus200020/aacus200020.html | C5, C6 |
| 5 | UNSW clarinet acoustics — https://newt.phys.unsw.edu.au/jw/clarinetacoustics.html | C5, C6 (verify) |
| 6 | Luce & Clark, JASA 42(6):1232, 1967 — https://pubs.aip.org/asa/jasa/article/42/6/1232/623784/Physical-Correlates-of-Brass-Instrument-Tones (scan: http://www.ibew.org.uk/dvarch/DV04046.pdf) | C7, C11, C20 |
| 7 | Backus data via HyperPhysics — https://hyperphysics.gsu.edu/hbase/Music/orchins.html | C8, C10 (verify), C12 (verify) |
| 8 | Benade, Trumpet acoustics, 1973 — https://ccrma.stanford.edu/marl/Benade/documents/Benade-Trumpet-1973.pdf | C9 |
| 9 | Meyer, *Acoustics and the Performance of Music*, Springer — https://link.springer.com/chapter/10.1007/978-0-387-09517-2_3 | C10 |
| 10 | Pätynen & Lokki, Acta Acustica u. Acustica 96:138, 2010 — https://users.aalto.fi/~ktlokki/Publs/patynen_aaua_2010.pdf | C6 (verify), C11, C20 |
| 11 | Fletcher, JASA 57(1):233, 1975 — https://www.phys.unsw.edu.au/music/people/publications/Fletcher1975.pdf | C12, C13, flute table |
| 12 | Lembke & McAdams, Acta Acustica u. Acustica 101:1039, 2015 — https://www.mcgill.ca/mpcl/files/mpcl/lembke_2015_actaacust.pdf | C8, C14, tolerances |
| 13 | Siedenburg, Jacobsen & Reuter, JASA 149(6):3715, 2021 — https://pubs.aip.org/asa/jasa/article/149/6/3715/945955/Spectral-envelope-position-and-shape-in-sustained (method detail via Jacobsen & Siedenburg, Acta Acustica 8:48, 2024 — https://acta-acustica.edpsciences.org/articles/aacus/full_html/2024/01/aacus240075/aacus240075.html) | C15 |
| 14 | Saitis & Weinzierl, "The semantics of timbre", Springer 2019 — https://comma.eecs.qmul.ac.uk/assets/pdf/Saitis_chap5.pdf | C16, C17, C18 |
| 15 | Nordenberg & Sundberg, Log Phon Vocol 29(4):183, 2004 — https://www.tandfonline.com/doi/abs/10.1080/14015430410004689 | C21 |
| 16 | Jansson & Sundberg, Acustica 34(1):15, 1975 — https://www.semanticscholar.org/paper/71befcd4282e07f079db20b2b33e160b33dfcd0c | C22 |
| 17 | Voice-LTAS duration convention — https://pubmed.ncbi.nlm.nih.gov/11824501/, https://www.sciencedirect.com/science/article/abs/pii/S089219971000130X | C22 |
| 18 | Welch, IEEE Trans. Audio Electroacoust. 15(2):70, 1967; Zwicker, JASA 33:248, 1961; IEC 61260-1:2014; ISO 226:2003; ITU-R BS.1770 | C22–C24 (standard references, no fetch) |
| 19 | EQ-practice chart (anecdotal) — https://blog.sonicbids.com/the-ultimate-eq-cheat-sheet-for-every-common-instrument | C19 caveat only |

Verification status: C1, C2 (law), C5, C6 (direction), C7/C11 (horn slopes),
C10, C12 (peak region), C20 are each supported by at least two independent
sources as marked. C3, C6 (exact centroids), C9, C15, C18, C21 are
single-source or single-chain and are marked accordingly; none of them is
load-bearing for a hard gate without a corpus fit behind it.
