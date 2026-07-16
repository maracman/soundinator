# SG2 research annex — struck and plucked decaying tones

Status: research annex to `docs/sg2/DOSSIER_STRUCK_PLUCKED.md`, commissioned
2026-07-16 for the WP-7 campaign (grand piano, upright piano, steel-string
acoustic guitar, nylon-string acoustic guitar, harp, glockenspiel). It
answers, with citations and numbers, WHAT makes each of these decaying tones
sound like itself — prioritised by perceptual importance — and what
separates the two morph-test pairs (grand↔upright, steel↔nylon). Findings
map onto the engine's three stages (excitation spectrum × position comb →
64-partial resonator with ratio classes `string`/`bar` and stiff-string `B`
→ fixed-Hz body EQ). Feeds STRUCK_PLUCKED_PREFLIGHT.md S1/S2.

Conventions (as RESEARCH_BOWED_REALISM.md):

- Claims are numbered `C1…C52` with evidence and a **Synthesis consequence**
  line each.
- `[single-source]` marks claims verified against only one independent
  source; treat numbers as provisional and re-measure on the campaign corpus
  before freezing. `[derived]` marks values we computed from a cited law.
- All decay figures are for isolated dry notes; LTAS-style sustain windows
  do NOT apply to this family — see §7a for the decay-aligned windowing that
  replaces them.

Primary sources (abbreviated in claims):

- **Weinreich 1977** — G. Weinreich, "Coupled piano strings", JASA 62(6)
  1474–1484 ([JASA PDF](https://pubs.aip.org/asa/jasa/article-pdf/62/6/1474/11470322/1474_1_online.pdf));
  companion KTH Five Lectures page
  ([speech.kth.se](https://www.speech.kth.se/music/5_lectures/weinreic/motion.html)).
- **Wogram KTH** — K. Wogram, "The strings and the soundboard", KTH Five
  Lectures ([decay page](https://www.speech.kth.se/music/5_lectures/wogram/decay.html)).
- **A&J KTH** — A. Askenfelt & E. Jansson, "From touch to string
  vibrations", KTH Five Lectures
  ([string contact](https://www.speech.kth.se/music/5_lectures/askenflt/stricont.html)).
- **Hall/Russell** — D. Russell, "The piano hammer as a nonlinear spring"
  (PSU, summarising Hall & Askenfelt JASA measurements;
  [acs.psu.edu](https://www.acs.psu.edu/drussell/piano/nonlinearhammer.html));
  Stulov hammer-felt models ([IOC](https://homes.ioc.ee/stulov/klaver2.pdf)).
- **Ege 2012** — K. Ege & X. Boutillon, "Comparison of the vibroacoustical
  characteristics of different pianos", Acoustics 2012
  ([arXiv 1210.3948](https://arxiv.org/pdf/1210.3948)).
- **Conklin KTH** — H. Conklin, "Longitudinal string modes", KTH Five
  Lectures ([page](https://www.speech.kth.se/music/5_lectures/conklin/longitudinal.html));
  Bank & Sujbert, "Generation of longitudinal vibrations in piano strings",
  JASA 117 (2005) ([PDF](https://home.mit.bme.hu/~bank/publist/jasa05.pdf)).
- **FBS 1962** — H. Fletcher, E. Blackham & R. Stratton, "Quality of piano
  tones", JASA 34(6) 749–761
  ([BYU record](https://physics.byu.edu/download/publication/1504)).
- **AA 2021** — "Piano bass strings with reduced inharmonicity: theory and
  experiments", Acta Acustica 5
  ([EDP full text](https://acta-acustica.edpsciences.org/articles/aacus/full_html/2021/01/aacus200053/aacus200053.html)).
- **Euph 5.3** — J. Woodhouse, *Euphonics*,
  [5.3 Signature modes and formants](https://euphonics.org/5-3-signature-modes-and-formants/).
- **Guitar I/II** — J. Woodhouse, "On the synthesis of guitar plucks" and
  "Plucked guitar transients: comparison of measurements and synthesis",
  Acta Acustica 90 (2004)
  ([Guitar I](https://euphonics.org/wp-content/uploads/2022/03/Guitar_I.pdf),
  [Guitar II](https://euphonics.org/wp-content/uploads/2022/03/Guitar_II.pdf)).
- **Woodhouse 2021** — "A necessary condition for double-decay envelopes in
  stringed instruments", JASA 150(6) 4375
  ([JASA](https://pubs.aip.org/asa/jasa/article/150/6/4375/994397/A-necessary-condition-for-double-decay-envelopes)).
- **Järveläinen** — H. Järveläinen et al., audibility-of-inharmonicity and
  decay-tolerance studies
  ([guitar perceptibility](https://www.researchgate.net/publication/233604568_Perceptibility_of_Inharmonicity_in_the_Acoustic_Guitar),
  [string-instrument audibility](https://www.academia.edu/16866101/Audibility_of_inharmonicity_in_string_instrument_sounds_and_implications_to_digital_sound_synthesis),
  [decay tolerances](https://www.researchgate.net/publication/290691628_Perceptual_tolerances_for_decay_parameters_in_plucked_string_synthesis)).
- **Chadefaux 2012/2013** — D. Chadefaux, J.-L. Le Carrou et al.,
  "Experimentally based description of harp plucking", JASA 131(1) 844
  ([JASA](https://pubs.aip.org/asa/jasa/article/131/1/844/823102/Experimentally-based-description-of-harp-plucking),
  [Institut Langevin PDF](https://www.institut-langevin.espci.fr/biblio/2020/3/5/770/files/2012_experimentally_based_description_of_harp_plucking.pdf));
  "A model of harp plucking", JASA 133
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/23556609/)).
- **Le Carrou radiation** — J.-L. Le Carrou et al., "Some characteristics of
  the concert harp's acoustic radiation", JASA 127(5) 3203 (2010)
  ([LAM PDF](https://www.lam.jussieu.fr/Membres/LeCarrou/Articles/A4_LeCarrou_HarpAcousticRadiation.pdf)).
- **Le Carrou sympathetic** — "Sympathetic string modes in the concert
  harp", Acta Acustica 95 (2009)
  ([HAL](https://inria.hal.science/hal-00945199v1));
  "Theoretical and experimental investigations of harp's sympathetic modes"
  ([HAL](https://inria.hal.science/hal-00945297)).
- **Woodhouse harp string** — J. Woodhouse & J. Tall, "The acoustics of a
  plucked harp string", J. Sound & Vibration 523 (2022)
  ([Cambridge repository PDF](https://www.repository.cam.ac.uk/bitstreams/79e423bc-9060-4e2e-93e0-f0012f9e623e/download),
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0022460X21006817)).
- **CCRMA percussion** — Stanford CCRMA course notes on percussion
  instruments (Rossing-derived)
  ([ccrma](https://ccrma.stanford.edu/CCRMA/Courses/150/percussion.html)).
- **C&D 1997** — A. Chaigne & V. Doutaut, "Numerical simulations of
  xylophones. I. Time-domain modeling of the vibrating bars", JASA 101
  (1997) (and Part II, JASA 104, 1998; via
  [Chaigne publication list](https://sites.google.com/view/achaigne-homepage/home-page/publications)).
- **Pianoteq** — Modartt, Pianoteq manual and product pages
  ([manual](https://www.modartt.com/user_manual?product=pianoteq&lang=en),
  [features](https://www.modartt.com/pianoteq_features),
  [U4 upright](https://www.modartt.com/u4),
  [Harp](https://www.modartt.com/harp),
  [Celeste pack](https://www.modartt.com/celeste)).
- **AAS Strum** — Applied Acoustics Systems, Strum GS-2 physical-modelling
  guitar ([product page](https://www.applied-acoustics.com/strum-gs-2/),
  [manual](https://www.applied-acoustics.com/strum-gs-2/manual/),
  [MusicRadar review](https://www.musicradar.com/reviews/tech/applied-acoustics-systems-strum-gs-2-626643)).

---

## 1. Piano

### 1.1 The double decay: measured values and mechanism

**C1.** The canonical measurement: a struck piano note's partial envelope
breaks into two segments — the initial "prompt sound" decaying at about
**8 dB/s** and the "aftersound" at **less than one quarter of that rate**
(≲ 2 dB/s), measured at E♭4 (311 Hz). — Evidence: Weinreich 1977 (JASA) and
the KTH lecture reproduction of the same measurement; both carry the 8 dB/s
and quarter-rate figures. *Synthesis consequence:* `decaySecondStage` /
late-vs-early ratio for piano mid-range should target an early:late decay-
rate ratio of roughly **4:1 or steeper** at mezzo dynamics; a mild 1.5:1
knee will not read as piano.

**C2.** Two mechanisms produce it, both already named in the dossier: (a)
the **two polarisations** of a single string — vertical motion pumps energy
into the soundboard efficiently (fast decay), horizontal motion couples
weakly (slow decay); the audible envelope is their sum, and the breakpoint
sits where the fast curve falls below the slow one; (b) **unison coupling**
— 2–3 strings per note, slightly mistuned, move from in-phase (fast,
radiating) to anti-phase (slow, trapped) motion; aftersound level and beat
pattern depend on the tuning state and on hammer irregularities. —
Evidence: Weinreich 1977 (theory + experiment for both); the KTH page shows
the single-string polarisation case explicitly. *Synthesis consequence:*
the additive proxy (one two-stage law per partial) captures the envelope
but not the **beating** that rides on it; see gap N3. The breakpoint is not
a free parameter: it emerges from the two rates and the initial mix, so the
fit should parameterise (early rate, late rate, late-component initial
level), not (breakpoint time).

**C3.** Decay time varies enormously and non-monotonically across the
keyboard: measured T20 values on one upright were **3.5 s (F♯4) vs 0.7 s
(G4)** — a 5:1 jump between adjacent semitones — and chord members C3/C4/G4
measured 3.8/1.7/0.7 s while D3/D4/A4 measured 3.4/3.3/2.3 s. The cause is
the soundboard impedance curve: strings ending on an impedance peak decay
slowly, on a valley quickly. — Evidence: Wogram KTH (measured values);
mechanism corroborated by Ege 2012 and Pianoteq's impedance control (C13).
*Synthesis consequence:* (a) piano decay laws must be per-register fitted
with **dense anchors** (preflight S3 ≥ 5 is a floor, not a target); (b) a
smooth global decay-vs-f0 law is *wrong in kind* — real pianos have rough
note-to-note decay variation, and a perfectly smooth fit is a synthesizer
tell. A small seeded per-note decay-rate jitter (§2.5c-style) is
evidence-backed.

**C4.** General condition: double-decay envelopes require two coupled
energy paths with sufficiently different loss rates and comparable initial
excitation — Woodhouse gives the necessary condition and connects it to the
piano literature. Guitars satisfy it more weakly than pianos (single
strings; polarisation-only). — Evidence: Woodhouse 2021. *Synthesis
consequence:* fit `decaySecondStage` strongly for piano, mildly for guitar
(dossier already says this); for harp expect string-dependent presence, and
for glockenspiel none (a bar mode has one loss path — any measured knee is
the mounting, C31).

**C5.** Una corda (grand): shifting the action so the hammer strikes 2 of 3
strings converts the un-struck string into a coupled reservoir — the
aftersound becomes **relatively larger** and the decay more uniform, while
the struck-string contact force is actually larger and longer; the hammer
also meets un-grooved felt, giving a duller/warmer attack. Upright "soft"
pedals instead move the hammers closer (half-blow), reducing velocity, not
string count. — Evidence: Weinreich 1977 (aftersound control is the una
corda's acoustic function); ISVR Southampton una-corda model 2024
([PDF](https://generic.wordpress.soton.ac.uk/isvr-new/wp-content/uploads/sites/422/2024/12/una-corda-effect-in-pianos.pdf));
mechanism summary [Wikipedia Soft pedal](https://en.wikipedia.org/wiki/Soft_pedal).
*Synthesis consequence:* an SG2 una-corda variation preset is expressible
with existing parameters: hardness down (fresh felt), excitation level
down, `decaySecondStage`/late-ratio **up**. No new engine mechanism needed
for isolated notes; cheap-win row for S5.

### 1.2 Inharmonicity B by register, grand vs upright

**C6.** Published magnitudes: B ≈ **10⁻⁴** for mid-range strings rising to
≈ **10⁻²** at the top octave; in the bass, B stays near **10⁻⁴ for a large
grand but reaches 10⁻³ for an upright** (shorter, thicker wound strings).
Measured upright bass values: B falling **5.75×10⁻⁴ (A−1/A0 region) →
3.2×10⁻⁴ (G0)** as the wound strings lengthen; the B-vs-note curve is
V-shaped — decreasing through the wound bass, minimum near the
wound-to-plain transition (octaves 2–3), then rising monotonically through
the plain treble. — Evidence: AA 2021 (magnitudes and upright bass values);
V-shape independently in the RWC grand-piano B curve
([figure](https://www.researchgate.net/figure/RWC-grand-piano-2-a-Inharmonicity-coefficient-B-b-octave-type-parameter-q-and_fig8_236662633))
and an upright measurement
([figure](https://www.researchgate.net/figure/Figura-4-Inharmonicity-coefficients-B-of-an-upright-piano-The-two-parts-of-the-data_fig4_221933427));
Edinburgh student measurement of a Yamaha GB1 confirms the two-branch trend
against Fletcher 1964
([ESJS](https://journals.ed.ac.uk/esjs/article/download/9815/12844/35937)).
*Synthesis consequence:* G1 per-register B tables are confirmed as
mandatory with **at least 5 anchors** and a V-shaped interpolation (the
repo's measured 1.4×10⁻⁴ → 7.3×10⁻⁴ span is consistent). One global B is
wrong everywhere; linear-in-f0 interpolation is wrong in the bass.

**C7.** Same-note comparison across piano classes: a contra-octave study
measured B at the same two-tone region as **105.3×10⁻⁶ (Steinway C baby
grand) vs 201.6×10⁻⁶ and 296.2×10⁻⁶ (two uprights)** — roughly **2–3×
higher B in uprights at the same bass notes**. — Evidence:
[contra-octave study](https://ojs.southfloridapublishing.com/ojs/index.php/jdev/article/download/2832/2162)
`[single-source for exact values; direction corroborated by C6]`.
*Synthesis consequence:* the grand↔upright morph pair differs in the bass
half of the B table by a factor ≈ 2–3, shrinking toward the treble (short
treble strings are similar in both). This is deliverable (d)'s first row.

**C8.** Perception of B: FBS 1962 found synthetic piano tones sound more
natural *with* inharmonicity ("warmth"), and measured that bass-range
inharmonicity raises perceived pitch by **1/12 to nearly 1 semitone**;
Järveläinen's threshold work shows audibility is greatest for low notes and
that typical treble amounts sit near threshold. Spectral envelope and
inharmonicity trade in the piano bass
([perceptual-significance study](https://www.researchgate.net/publication/225284530_Perceptual_relevance_of_inharmonicity_and_spectral_envelope_in_the_piano_bass_range)).
— Evidence: FBS 1962; BYU pitch study
([effect of inharmonic partials on pitch](https://physics.byu.edu/docs/publication/1516));
Järveläinen. *Synthesis consequence:* (a) B fitting effort belongs in the
bass and low-mid registers; (b) because inharmonicity shifts perceived
pitch, the §2.5c paired f0 lock must compare **partial-1 frequency**, not
perceived pitch, or bass fits will chase a semitone ghost.

### 1.3 Hammer: hardness, velocity, contact time

**C9.** The felt hammer is a nonlinear spring: static and dynamic
force-compression follows F ∝ x^p with **p ≈ 2.2–3.5 for hammers taken
from pianos**; the felt is history-dependent (hysteretic), and the
effective slope stiffens with impact velocity. — Evidence: Hall/Russell
(p range; Hall & Askenfelt measurement method); Stulov hysteretic model.
*Synthesis consequence:* G7 `velocityHardnessCoupling` is the right
abstraction and must stay **nonlinear-positive** (hardness grows with
velocity); its audio effect is a *contact-time* change, see C10.

**C10.** Hammer-string contact duration: **≈ 4 ms in the bass falling to
< 1 ms in the top treble** (about 10% of the fundamental period in the
bass), and at a fixed mid-range note it varies **≈ ±20%** from piano to
fortissimo (shorter when louder). Shorter contact ⇒ more high-partial
energy: the contact acts as a low-pass whose corner scales as 1/τ. —
Evidence: A&J KTH (values); Hall/Russell (τ–force–p relation).
*Synthesis consequence:* the excitation spectrum's hardness law should be a
**sinc-like contact-time low-pass whose corner moves ≈ ±20–30% over the
dynamic range and scales with register** (bass hammers are softer/heavier:
corner low; treble: corner high). A brightness *tilt* alone has the wrong
shape — the contact filter rolls off above a corner rather than tilting the
whole spectrum.

**C11.** Dynamics change the piano spectrum by *both* gain and slope: the
pianissimo spectrum is much steeper than fortissimo — high partials grow
far faster than the fundamental as velocity rises — but unlike bowed
strings the broadband gain change is also large (piano dynamics span tens
of dB). — Evidence: A&J KTH (qualitative but measured); independent
spectral comparison
([TRU analysis](https://rtaylor.sites.tru.ca/2017/01/05/digital-piano-reproduction-frequency-response/))
`[exact dB-per-dynamic slopes not published — corpus-fit]`. *Synthesis
consequence:* per-dynamic targets: `dynamic-brightening` (upper-partial
index rises with velocity) plus a **gain law of order 20–40 dB pp→ff**;
allocate brightness via the C10 contact filter, not a generic tilt. This is
the opposite weighting from bowed (gain-dominant vs tilt-dominant) — do not
inherit bowed dynamic laws (FAMILY FIREWALL).

**C12.** Longitudinal string modes and "phantom partials": the first
longitudinal mode sits **3 octaves + a fifth to 4 octaves + a third above
the transverse fundamental**; tension modulation additionally generates
phantom partials at sums/differences of transverse partial frequencies.
They are audible and contribute "the distinctive character of low piano
notes"; formal listening tests confirm perceptibility mainly in the bass. —
Evidence: Conklin KTH; Bank & Sujbert 2005; JASA-EL perception study
([JASA 128 EL117](https://pubs.aip.org/asa/jasa/article/128/3/EL117/598974/Perception-of-longitudinal-components-in-piano)).
*Synthesis consequence:* engine gap N4: for bass-register piano presets a
small fixed set of extra inharmonic components (or one band-limited onset
"zing" at ≈ 8–16× f0, decaying fast) is the additive proxy. Defer unless
bass residuals survive the variability floor — but log it now, because no
combination of the 64 stretched partials can produce these components
(they sit far off the B-stretched series).

### 1.4 Soundboard and body: grand vs upright

**C13.** Soundboard physics: modal density and characteristic impedance
(order 10³ kg/s, ≈ 1000–3000 kg/s across pianos) govern string decay and
radiated level; above a transition **fg ≈ 1.2 kHz** the ribbed board stops
behaving as a homogeneous plate (inter-rib localisation). **Grands have
both larger modal density and larger characteristic impedance than
uprights** — a deliberate design outcome, since for a plain plate the two
would trade against each other. Between individual pianos of the same
class the differences are small. — Evidence: Ege 2012 (all values);
Giordano's measured impedance reproduced there. *Synthesis consequence:*
(a) higher impedance ⇒ slower energy drain ⇒ grand notes sustain longer at
equal pitch: the grand↔upright pair should show **longer early-stage T60 in
the grand**, all else equal; (b) body-EQ differences between the two are
modest in mode structure — the audible upright signature is more about
radiation/enclosure (C14) and B (C7) than about soundboard resonances.

**C14.** Radiation: a grand radiates via a horizontal board + reflecting
lid toward the listener; an upright radiates from a vertical board facing a
wall with a closed cabinet — measured comparisons report stronger
low-frequency boxiness/comb effects and less direct high-frequency
projection for uprights. — Evidence: ISMA/DAGA comparison paper "Grand
piano and upright piano differences in sound and radiation"
([RG record](https://www.researchgate.net/publication/393941069_GRAND_PIANO_AND_UPRIGHT_PIANO_DIFFERENCES_IN_SOUND_AND_RADIATION))
`[single-source; not yet read in full]`; consistent with Ege's structural
findings and Pianoteq's separate U4 model (C44). *Synthesis consequence:*
fit grand and upright `bodyBands` separately from their own references
(never morph one from the other and re-label); expect the upright fit to
carry more low-mid irregularity and a duller top. Exact bands are
corpus-fitted, not literature-anchored — pianos lack published universal
formant tables (unlike violin A0/B1).

---

## 2. Guitar

### 2.1 Body: the fixed-Hz signature is real and similar across classes

**C15.** Classical guitar signature modes (example instrument): **103, 205,
286, 436 Hz**, the first two being the strongly coupled air(Helmholtz) +
top-plate pair "breathing" through the soundhole; typical classical ranges
≈ 97–110 Hz (coupled air) and ≈ 180–220 Hz (coupled top). — Evidence: Euph
5.3 (numbers); coupling physics
([Euph 4.2.2](https://euphonics.org/4-2-2-coupling-of-a-helmholtz-resonator-and-a-body-mode/));
laser modal study of classical bodies
([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11360423/)).
*Synthesis consequence:* keeps the dossier's fixed 75–130 Hz air-mode gate;
add the **top-plate band ≈ 180–230 Hz** as a second fitted-body
expectation for both guitars.

**C16.** Steel-string (Martin D-28 flat-top) low resonances measured at
**102, 204, 376, 436 Hz** (Popp & Rossing 1986) — the air/top pair sits at
essentially the *same* frequencies as the classical example in C15. —
Evidence: Popp & Rossing via Fletcher & Rossing, *The Physics of Musical
Instruments* (secondary web citation:
[summary](https://schoolofoudonline.com/the-lute/)) `[single-source chain
for the exact Hz]`. *Synthesis consequence:* **steel-vs-nylon identity does
not live in the low body modes.** The pair's body difference is in mid/high
response (bracing mass/stiffness) and radiation efficiency; the dominant
pair separators are the strings and drive spectrum (C18–C19). This is a
firewall against "fixing" a nylon render by moving the air mode.

**C17.** Above its signature modes the guitar bridge admittance is
"almost featureless: it simply trends gently downwards" — there is **no
bridge-hill formant**; any weak elevation sits near 1.7 kHz. — Evidence:
Euph 5.3. *Synthesis consequence:* guitar `bodyBands` should be a few
low-frequency peaks plus a smooth downward trend; a violin-style mid-band
hill in a guitar fit is a fitting artefact and should trip review.

### 2.2 Strings: steel vs nylon

**C18.** Inharmonicity: audibility experiments (resynthesised real
recordings) found inharmonicity **easily detected on the lowest steel
strings**, while for nylon it was detectable mainly with the transient
removed, and nylon thresholds sat at-or-above typical real values.
Steel-string B at the same pitch is substantially higher (steel's higher
E×d²/l² stiffness term); typical acoustic-guitar B values are ≈ 10⁻⁵–10⁻⁴
(steel low strings at the top of that range). — Evidence: Järveläinen
(guitar perceptibility + string-instrument audibility);
[USC musical-string inharmonicity survey](https://dornsife.usc.edu/sergey-lototsky/wp-content/uploads/sites/211/2023/06/Musical-string-inharmonicity-Chris-Murray.pdf)
`[exact per-string B tables single-source; measure on corpus]`.
*Synthesis consequence:* both guitars keep measured non-negative B per
register; expect the fitted steel table to exceed the nylon table clearly
on wound bass strings and to converge on the trebles. Audibly, nylon B is
a near-threshold seasoning — do not exaggerate it to "add realism".

**C19.** String damping dominates decay character and differs by
construction: intrinsic damping of classical strings **varies by an order
of magnitude across the audible band**, and an accurate frequency-dependent
damping model is "essential" to match plucks; wound-string damping rises
with age/contamination. Steel strings sustain longer; nylon notes decay
faster, with high partials dying fastest. — Evidence: Guitar II (measured);
material comparison direction from Järveläinen test-tone sets and
string-sensor study ([MDPI Sensors](https://doi.org/10.3390/s25216514)).
*Synthesis consequence:* per-register **per-band decay tables** (already in
the engine as band T60 laws) carry more identity than the spectral tables
here; the steel↔nylon pair must differ in (a) global T60 scale (steel
longer), (b) high-frequency decay exponent (nylon steeper). Exact numbers
are corpus-fitted; the *sign* is literature-backed.

### 2.3 Pluck: position, finger vs pick, per-note variance

**C20.** The pluck-position comb is real, measurable to millimetres from
recordings (comb-filter delay estimation; median errors of a few mm), and
players move the pluck point note-to-note and phrase-to-phrase (sul tasto ↔
ponticello equivalents). — Evidence: Traube & Smith / Traube & Depalle
plucking-point estimation
([RG](https://www.researchgate.net/publication/3927332_Extracting_the_fingering_and_the_plucking_points_on_a_guitar_string_from_a_recording));
under-saddle time-domain method
([Applied Acoustics](https://www.sciencedirect.com/science/article/abs/pii/S0003682X04001057)).
*Synthesis consequence:* as for bowed β: fit `excitationPosition` per
register from the partial pattern (dossier §2 already forbids a canonical
1/7), and give it a **seeded per-note wander** (§2.5b/c) of a few percent
of string length; a frozen comb identical on every note is the plucked
family's loudest synthesizer tell.

**C21.** Finger vs pick is an excitation-spectrum and transient-noise
difference: fingertip plucks are a two-phase stick/slip release with
initial conditions mixing displacement, velocity and rotation (measured on
harp, same mechanics on guitar); picks are stiffer and release faster —
brighter spectrum, sharper transient; pick stiffness/damping/position are
exactly the per-string parameters a commercial physical model exposes.
Micro-changes in pluck trajectory are audible in synthesis tests. —
Evidence: Chadefaux 2012 (finger mechanics); AAS Strum (pick Type/
Position/stiffness/damping per string); pluck-trajectory study
([arXiv 2606.24356](https://arxiv.org/pdf/2606.24356)). *Synthesis
consequence:* steel-string presets default to a harder/faster excitation
(pick) with more broadband contact noise; nylon/classical to a softer
slower release (flesh+nail) — expressed through existing hardness, onset
colour and excitation-noise parameters, fitted from onset windows.

**C22.** Two polarisations: measured guitar "string modes" appear as
**doublets split by a few Hz** — more than body coupling explains
(different effective lengths from rolling at fret/bridge) — producing
audible beating and double-exponential decays within single partials. —
Evidence: Guitar II (measurements + attribution); independent
polarisation-coupling study
([Acta Acustica 2020](https://acta-acustica.edpsciences.org/articles/aacus/full_html/2020/03/aacus200019.html)).
*Synthesis consequence:* engine gap N3 (shared with piano unisons): a
bounded per-partial beat parameter (seeded rate ≈ 0.1–3 Hz, depth fitted)
would let single held notes shimmer as recordings do. G4's two-stage
envelope alone renders the energy but not the movement.

---

## 3. Harp

**C23.** Structure and radiation: 47 strings on a tapered soundboard with a
cavity and five sound holes. Lowest resonances are coupled
soundboard/sound-hole modes measured at **134 Hz, 148 Hz, 166 Hz** (plus
higher modes 250, 384, 460, 486 Hz…); the instrument is **omnidirectional
below ≈ 220 Hz**, directional 400–2000 Hz; sound-hole (cavity) contribution
to radiation is limited below 200 Hz. — Evidence: Le Carrou radiation
(all numbers); Waltham & Kotlicki soundboard localisation (tapered board →
per-register localised modes) via Woodhouse harp string §refs.
*Synthesis consequence:* harp `bodyBands`: expect the strongest fitted
peaks in ≈ 130–170 Hz and structure to ≈ 500 Hz, with no violin-style hill
above; below ≈ 130 Hz radiated fundamentals weaken (bass wire strings rely
on partials 2+), so do not force p1 energy on the bottom octave.

**C24.** Strings by register: wire-wound bass (roughly octaves 1–2), gut
mid, nylon top — three material regimes on one instrument, each with its
own B, damping and brightness; gauge choices sit close to the
internal-damping limit, and plucks show an initial nonlinear **pitch
glide** on large-amplitude low notes. — Evidence: Woodhouse harp string
(damping-limit finding, pitch glide, per-material damping model);
string-material layout is standard practice
([composingforharp](https://composingforharp.com/wp-content/uploads/2014/09/special-techniques-all.pdf)).
*Synthesis consequence:* treat the harp as **three instruments sharing one
body**: register anchors must at minimum sit per material zone (S3's
"dense anchors" = one per zone boundary plus interiors); expect the wire
bass to behave piano-like (low B, long ring) and the nylon top guitar-like
(fast decay).

**C25.** Plucking point and finger: harpists pluck **near the middle of the
string** in normal technique — the sin(nπx) comb then suppresses even
partials strongly (x ≈ 0.5), which is a large part of the harp's hollow,
flute-warm colour; the standard *harmonic* technique (touch middle while
plucking) isolates the octave. Finger-pad release is a stick/slip event
whose initial conditions (displacement+velocity+rotation) measurably
differ per player. — Evidence: Chadefaux 2012 (positions and finger
mechanics measured with high-speed camera); comb factor is textbook
(same law as engine's position comb); Modartt harp notes the
mid-string harmonic behaviour (C45). *Synthesis consequence:*
`excitationPosition` for harp defaults near **0.5** (versus guitar
0.1–0.25) — this single parameter carries much of the harp-vs-guitar
family difference on otherwise similar strings; near-0.5 even-partial
notches must survive the fit (a fitter that "repairs" p2's dip toward a
smooth envelope destroys the harp).

**C26.** Près-de-la-table: plucking close to the soundboard (small x)
produces the documented "nasal, brittle, guitar-like" timbre — the same
comb law moved to guitar-like positions. — Evidence: orchestration/
technique literature
([composingforharp](https://composingforharp.com/wp-content/uploads/2014/09/special-techniques-all.pdf),
[timbre & orchestration resource](https://timbreandorchestration.org/isfee/extreme-orchestration/harp/scoring)).
*Synthesis consequence:* p.d.l.t. is a **performance variation of
`excitationPosition` only** (→ WP-9 performer-facing), not a separate
construction; a preset morph 0.5 → 0.12 should audibly pass harp→guitarish,
which doubles as a cheap engine sanity check of the comb law.

**C27.** Sympathetic halo: harp strings are undamped by default; plucking
one string excites the other 46 through the soundboard, creating a
measured "halo of sound" and multi-component partials (sympathetic modes
confirmed theoretically and experimentally). Hand-damping (étouffé) is the
marked exception. — Evidence: Le Carrou sympathetic (both papers).
*Synthesis consequence:* isolated-note fitting can proxy the halo with
`partialTransfer` + G4 late stage (dossier §5 already rules this way for
piano); but the harp's halo is louder in the mix than piano duplex — if
harp late-decay residuals persist, the bounded resonant-coupling WP
flagged in the dossier should name harp, not piano, as its first customer.

---

## 4. Glockenspiel

**C28.** Mode ratios: transverse modes of a uniform bar free at both ends
fall at **1 : 2.76 : 5.40 : 8.93 : 13.34 : 18.64** (Euler–Bernoulli). The
engine's `bar` table `[1, 2.756, 5.404, 8.933, 13.344, 18.638]`
(web/static/synth.js:1005) matches exactly. Glockenspiel bars are plain
rectangular steel (2.5–3.2 cm wide, 6–9 mm thick) — unlike marimba
(arch-cut, overtone tuned to 4.0) and xylophone (tuned to 3.0), glock bars
are **not undercut**, so the free-bar series is the right default. —
Evidence: CCRMA percussion (ratios; tuned-bar contrasts);
[Physics LibreTexts](https://phys.libretexts.org/Bookshelves/Waves_and_Acoustics/Sound_-_An_Interactive_eBook_(Forinash_and_Christian)/12:_Percussion/12.01:_Percussion_and_Drumheads/12.1.04:_Harmonic_Percussion_Instruments);
[UBC PHYS341](https://wiki.ubc.ca/Course:PHYS341/Archive/2016wTerm2/glockenspiel)
(dimensions). *Synthesis consequence:* `bar` ratio class confirmed for
glockenspiel; marimba/xylophone/vibraphone (S5 cheap wins) need **tuned**
ratio variants (≈ 1:4:9.2 marimba, 1:3 xylophone, 1:4 vibraphone) — one
per-preset ratio-table override, not new physics (gap N5).

**C29.** Thick-bar correction: real glock bars are stocky (thickness/length
ratio grows toward the treble), and shear deformation + rotary inertia
(Timoshenko) lower the upper-mode ratios below the Euler–Bernoulli values
by up to ≈ 10–20% for the stockiest bars. — Evidence: Timoshenko-beam
literature ([overview](https://en.wikipedia.org/wiki/Timoshenko%E2%80%93Ehrenfest_beam_theory));
applied to bars in Fletcher & Rossing's treatment of glockenspiels
`[derived — no per-bar published table found this survey]`. *Synthesis
consequence:* per-preset **mode-ratio trim** on the `bar` class (gap N5)
should allow downward trims of that order per register; the scorer must
score measured mode frequencies against the reference's own bar table
(preflight S1 already says: mode RATIOS, not B — never bend stiff-string
`B` to fake a bar).

**C30.** Audibility-relevant mode count: playing range G5–C8 (**784–4186
Hz** fundamentals). Mode 2 (2.76×) of the top bar lands ≈ 11.6 kHz; mode 3
(5.40×) ≈ 22.6 kHz — beyond hearing. Even the lowest bar's mode 4 (8.93×)
sits ≈ 7 kHz. So **2–4 transverse modes cover everything audible** (4 at
the bottom of the range, 1–2 at the top), plus brief torsional/lateral
content in the strike transient. `[derived from C28 ratios × range]` —
Evidence: CCRMA (range); arithmetic ours. *Synthesis consequence:* the
64-partial resonator is massively over-provisioned for glock — presets
should zero partials beyond the bar table rather than letting a fitter
distribute energy into inaudible or aliased slots; scorer weight belongs on
modes 1–3 frequencies/levels/decays and the strike transient.

**C31.** Mounting and decay: bars are supported at the fundamental's nodal
lines (**0.224 L** from each end), which deliberately damps every mode
*except* the fundamental; consequently the strike produces a bright
inharmonic flash that fades quickly into a near-pure fundamental ring.
Mounting condition measurably changes vibration and directivity (dedicated
JASA-EL study). — Evidence: CCRMA; UBC PHYS341 (node support);
[JASA-EL 5(9) 093201 (2025)](https://pubs.aip.org/asa/jel/article/5/9/093201/3364478/)
(mounting effects; paywalled — numbers unread) `[decay-time table: none
published found this survey — corpus-fit]`. *Synthesis consequence:*
per-mode decay hierarchy is structural: **T60(mode 1) ≫ T60(modes 2+)**
(seconds vs tens-of-ms–hundreds-of-ms). The `bar` class needs per-mode
decay control (gap N5b) — a single frequency-decay law tuned for strings
may not produce a fundamental that outlives mode 2 by an order of
magnitude.

**C32.** Strike point and mallet: centre strikes hit the antinode of modes
1 and 3 and the **node of mode 2** (which has a nodal line at the bar
centre), so normal centre playing suppresses the 2.76× partial; strikes
toward the nodal supports mute the fundamental (softer, "edge" colour).
Hard mallets (brass/plastic) shorten contact and excite the upper modes —
same contact-time low-pass physics as the piano hammer (C10); Chaigne &
Doutaut's xylophone model treats mallet-bar interaction exactly this way.
— Evidence: CCRMA; UBC PHYS341;
[jeremyli PHYS project](https://jeremyli.wixsite.com/glockenspiel/physics);
C&D 1997. *Synthesis consequence:* the engine's string-shaped position
comb sin(nπx) does **not** describe bar mode shapes (free-bar modes are
cosh/cos combinations; the "position comb" for a bar needs the bar's own
mode-shape weights) — gap N5c. Short-term proxy: fit per-mode levels
directly per strike-point preset and expose mallet hardness through the
existing hardness/contact law.

**C33.** Perceived pitch: the glockenspiel sounds **two octaves above its
written part**; the fundamental carries the pitch (upper modes decay too
fast to fix pitch), and near the top of the range fundamentals approach
the ≈ 4–5 kHz ceiling where musical interval perception weakens. —
Evidence: orchestration practice
([Wikipedia](https://en.wikipedia.org/wiki/Glockenspiel),
[VSL Academy](https://www.vsl.info/en/academy/percussion/glockenspiel));
pitch-salience ceiling is standard psychoacoustics `[derived]`.
*Synthesis consequence:* f0 lock for glock references must track the
fundamental mode only (never a virtual pitch from the inharmonic set), and
top-octave scoring should down-weight pitch-interval features in favour of
spectral/decay match.

---

## 5. Perception: what carries identity in decaying tones

**C34.** Attack transients are decisive for identification of percussive/
plucked tones: excising attacks markedly reduced instrument identification
(Saldanha & Corso 1964); timbre spaces repeatedly recover an attack-time
dimension alongside spectral centroid (Iverson & Krumhansl 1993); onset
windows carry a disproportionate share of identity information. —
Evidence: reviewed with citations in McAdams, "The perception of musical
timbre" ([Oxford handbook chapter](https://www.mcgill.ca/mpcl/files/mpcl/mcadams_2015_oxfordhdbkmuspsychol.pdf));
onset-relevance study
([RG](https://www.researchgate.net/publication/331367954_Specifying_the_perceptual_relevance_of_onset_transients_for_musical_instrument_identification)).
*Synthesis consequence:* the scorer's onset-window spectrum (S1 "attack
transient spectrum") deserves weight comparable to the whole decay
envelope; for this family L2's onset-vs-post-onset split is not a
refinement, it is where identity lives.

**C35.** The amplitude-envelope *shape* is itself an identity cue: a piano
tone played backwards — identical long-term spectrum, reversed envelope —
reads as an organ/reed instrument, the classic demonstration that
attack-then-decay asymmetry, not spectrum alone, says "struck". —
Evidence: standard demonstration, documented across pedagogy
([discussion](https://reverseaudioapp.com/blog/why-does-reversed-audio-sound-weird));
originating with Schaeffer-era cut-bell/reversal experiments.
*Synthesis consequence:* the preflight's impulsive-envelope classifier
(dossier §2) is perceptually justified as a **hard gate**, senior to any
spectral match.

**C36.** Tolerances for decay parameters (directly reusable): listeners
accept overall decay time-constant deviations of **75%–140%** of the
reference, and frequency-dependent-decay parameter deviations of
**83%–116%**, before plucked-string resynthesis is distinguishable; decay
JNDs in general sit ≈ 25–30%. — Evidence: Järveläinen & Tolonen, JAES 2001
(tolerances; tested at 0.6 s and 2.0 s tone lengths); general JND
literature. *Synthesis consequence:* scorer tolerance bars for T60-type
features: **±25% warn / −25%…+40% hard bounds** on early-stage decay, ±17%
on the frequency-decay exponent — tighter is wasted effort, looser is
audible. These are the family's analogue of the 3 dB/6 dB band rules in
RESEARCH_SUSTAIN_BALANCE.md C14.

**C37.** For piano bass specifically, spectral envelope and inharmonicity
interact perceptually — listeners' quality judgments respond to both, and
neither alone suffices. — Evidence: Järveläinen et al., piano bass range
([RG](https://www.researchgate.net/publication/225284530_Perceptual_relevance_of_inharmonicity_and_spectral_envelope_in_the_piano_bass_range)).
*Synthesis consequence:* do not let a B-table fix and a spectral-table fix
be scored/iterated independently in the bass register — iterate them as a
pair (fit protocol note for the campaign runner).

---

## 6. What professional modellers expose

**C38.** Pianoteq (Modartt) — the direct commercial precedent for this
whole family (physical modelling, not samples). Grand-piano parameter
surface: hammer hardness at three velocity anchors (piano/mezzo/forte),
spectrum profile (per-overtone gains), hammer noise, strike point, string
length/inharmonicity, unison detune, direct sound duration, **soundboard
impedance / cutoff / slope**, sympathetic resonance, duplex scale, pedal
set (incl. una corda, half-pedal), lid position; Pro edition exposes these
**per note**. — Evidence: Pianoteq manual + features pages. *Synthesis
consequence:* confirms the SG2 split — performer-facing: velocity map,
strike point, pedals; construction: B tables, per-register hammer/decay/
body data. Pianoteq's impedance/cutoff/slope trio is precisely SG2's
per-band T60 + two-stage law (dossier §2) — an independent vote that decay
shaping, not reverb-like sustain, is the piano's body axis.

**C39.** Pianoteq U4 upright is shipped as a **separate model**, marketed
on the upright's own signature (vertical board, cabinet colouration,
"cozy/character" vs concert clarity) rather than as a detuned grand. —
Evidence: Modartt U4 page. *Synthesis consequence:* supports deliverable
(d): grand↔upright is a construction-table swap (B, hammer, body, decay),
not a macro morph on one preset.

**C40.** Pianoteq Concert Harp: modelled 47-string Salvi grand harp (plus
34-string Aoyama Celtic variant); every string resonates freely
(sympathetic model always on); pedal mechanics simulated; mid-string
harmonic technique reproduced (octave-only spectrum). — Evidence: Modartt
Harp page. *Synthesis consequence:* commercial confirmation that (a)
free-ringing sympathetic behaviour is considered essential to harp
identity, (b) the mid-string pluck/harmonic geometry (C25) is the core
playable axis.

**C41.** Pianoteq Celeste pack ships a **modelled glockenspiel** whose
headline "humanization" feature is seeded **strike-point variation** ("the
musician never hits the plates at the exact same point"); Xylo pack ships
modelled xylophone + bass marimba. — Evidence: Modartt Celeste page +
retailer descriptions ([Sweetwater](https://www.sweetwater.com/store/detail/PianoteqCG--modartt-celeste-requires-pianoteq)).
*Synthesis consequence:* per-note seeded strike-point draws (§2.5c) are the
single "life" feature the market leader chose for bars — implement the
seeded draw before any subtler bar refinement.

**C42.** Guitar: Ample Sound's acoustic guitars are **sample-based** (a
correction to the brief's framing — there is no "Ample physical guitar
model"); the physical-modelling reference is AAS **Strum GS-2**: per-string
string material (nylon/steel), pick/finger **Position and Type**, pick
stiffness/damping/timing, hammer-on amplitude, string tone/decay, body
type and size (steel/nylon body variants), integrated bridge coupling. —
Evidence: AAS product page/manual; MusicRadar review (32–36 parameters,
9 per string); Ample product pages
([plugins4free listing](https://plugins4free.com/plugin/2233)).
*Synthesis consequence:* the steel↔nylon morph set (deliverable d) matches
what AAS chose to parameterise: string material (B + damping), pick vs
finger excitation, pluck position, body variant — no additional hidden
axis was needed commercially.

---

## 7. What the ear needs, ranked — and what to build

Ranking: measured effect size × perceptual evidence × distance from current
engine behaviour.

| Rank | Feature | Size / evidence | Engine stage |
|---|---|---|---|
| 1 | Impulsive attack-then-decay envelope with correct early rate (C34–C36) | identity-defining; hard gate | resonator decay laws |
| 2 | Two-stage decay with ≈4:1 rate break (piano; milder guitar/harp) (C1–C4) | 8 dB/s → <2 dB/s measured | `decaySecondStage`/ratio |
| 3 | Onset spectrum: contact-time low-pass moved by velocity/hardness (C9–C11, C32) | ±20–30% corner over dynamics; 4→<1 ms register trend | excitor hardness/contact law |
| 4 | Register tables: B (V-shaped), per-band decay, per-material zones (C6–C8, C19, C24) | B spans 10⁻⁴→10⁻²; decay 5:1 adjacent | G1 tables |
| 5 | Position comb incl. harp mid-string and per-note wander (C20, C25–C26) | even-partial suppression; mm-measurable | excitationPosition + seeds |
| 6 | Fixed-Hz body: guitar air+top pair, harp 130–170 Hz cluster, piano board character (C13–C17, C23) | ≈10–20 dB local features | bodyBands |
| 7 | Partial-level beating (polarisation/unison) and sympathetic halo (C2, C22, C27) | few-Hz doublets, measured | gap N3 / partialTransfer |
| 8 | Bar-class exactness: ratios, per-mode decays, strike-point (C28–C33) | whole glock identity | gap N5 |

### 7a. Scorer features — decay-aligned windowing and targets

**Windowing methodology (replaces LTAS sustain windows for this family):**

```
onset window:      [attack_start, attack_start + max(30 ms, 3 periods)]
early window:      [peak, peak + t_E]  where t_E = time of −20 dB re peak
late window:       [peak + t_E, release or −45 dB, whichever first]
per-partial decay: heterodyne each tracked partial; fit dB-linear
                   regression separately in early/late windows; a
                   two-segment ("broken-stick") fit with free knee gives
                   (rate_early, rate_late, knee_dB) per partial
band decay:        same broken-stick fit on 1/3-octave band energies
spectral prints:   onset-window FFT vs early-window FFT (L2 split);
                   NEVER average a spectrum across the full decay — the
                   spectrum is nonstationary by construction (C19, C31)
floors:            take-to-take variability computed per window, per
                   register, per dynamic (same-floor philosophy as §2.5)
```

Targets (⊙ = corpus-derived at fit time; tolerances from C36 where they are
decay-shaped, ±3/6 dB where they are spectral, per the sustain annex):

| Feature | Grand | Upright | Steel gtr | Nylon gtr | Harp | Glock | Source |
|---|---|---|---|---|---|---|---|
| `decay_rate_ratio` (early/late, mid register) | ≥ 3 | ≥ 3 | 1.2–3 | 1.2–3 | ⊙ (per zone) | n/a (single stage) | C1–C4 |
| `early_t60_s` (mid C4-region) | ⊙ ±25% | ⊙ ±25% (expect < grand) | ⊙ | ⊙ (< steel) | ⊙ | mode-1 ⊙ | C3, C13, C19, C36 |
| `decay_freq_exponent` (high bands die faster) | ⊙ ±17% | ⊙ ±17% | ⊙ | ⊙ steeper than steel | ⊙ | per-mode table | C19, C36 |
| `B_register_table` | V-shape; bass ≈ 1×10⁻⁴ | V-shape; bass 2–3× grand | > nylon on wound strings | near-threshold values | 3 material zones | **forbidden** (ratio table instead) | C6–C7, C18, C24, C28 |
| `mode_ratio_cents` (bar modes vs table) | — | — | — | — | — | modes 2–3 within ±35 cents of fitted table | C28–C29 |
| `onset_centroid_velocity_slope` | >0, gain 20–40 dB pp→ff ⊙ | same | >0 | >0 (smaller ⊙) | >0 | >0 (mallet) | C10–C11, C21, C32 |
| `attack_spectrum_dist` (onset-window vs reference, mel/band) | ≤ floor+tol | same | same | same | same | same (incl. strike flash) | C34 |
| `even_odd_partial_ratio` (comb signature) | position-fitted | same | pos 0.1–0.25 ⊙ | pos ⊙ | even partials suppressed (pos ≈ 0.5) | centre-strike mode-2 dip | C20, C25, C32 |
| `air_mode_band` (75–130 Hz, existing gate) | — | — | ≥ −9 dB | ≥ −9 dB | — | — | dossier §2 |
| `body_low_cluster` | ⊙ | ⊙ + low-mid irregularity | 180–230 Hz top-plate band present | same | peak(s) in 130–170 Hz | none (no body) | C14–C16, C23 |
| `partial_beat_presence` (spectral doublets / envelope ripple) | present on unisons ⊙ | same | present, fewer Hz ⊙ | same | ⊙ | absent | C2, C22 |
| `late_ring_bloom` (sympathetic proxy: late-window energy vs early extrapolation) | ⊙ (pedal takes only) | ⊙ | small | small | ⊙ (largest) | none | C5, C27 |

### 7b. Construction-checklist assertions (assertions.py format)

Rows via `_result(id, description, passed, value, threshold)`; all inherit
strict-evidence handling. Shared family rows (impulsive-envelope
supermajority, excitor/resonator class, stiff-string B ≥ 0 where `string`)
stay as in the dossier; new rows:

| Assertion ID | Required fact | Threshold |
|---|---|---|
| `grand-piano.double-decay-ratio` | Broken-stick fit on mid-register notes: early rate / late rate | ≥ 3 |
| `grand-piano.b-register-shape` | B table V-shaped: bass anchor > minimum, treble anchor > minimum, ≥ 5 anchors | shape + count |
| `grand-piano.contact-brightening` | Onset spectral corner rises with velocity (contact-time law) | positive slope; gain 20–40 dB pp→ff (provisional ⊙) |
| `grand-piano.decay-register-span` | Early T60 varies across registers as fitted, not one global | ≥ 2:1 span bass→treble ⊙ |
| `upright-piano.b-exceeds-grand` | Paired-register bass B exceeds the grand preset's | ratio 1.5–4 |
| `upright-piano.shorter-early-t60` | Mid-register early T60 below grand's at same dynamic | ratio < 1 ⊙ |
| `upright-piano.body-distinct` | `bodyBands` fitted from upright references, not copied from grand | table provenance flag |
| `steel-guitar.air-and-top-modes` | Fixed bands present near 75–130 Hz and 180–230 Hz | both, ≥ −9 dB prominence |
| `steel-guitar.b-exceeds-nylon` | Wound-string register B exceeds nylon preset's | ratio > 1.3 ⊙ |
| `nylon-guitar.faster-hf-decay` | High-band decay exponent steeper than steel preset's | sign only, values ⊙ |
| `nylon-guitar.softer-onset` | Onset-window centroid below steel preset's at same dynamic/register | sign only |
| `guitar.position-wander` | Seeded per-note excitationPosition draw enabled, bounded few % | enabled + bounds |
| `harp.mid-string-comb` | Default excitationPosition ≈ 0.5; rendered even/odd partial ratio shows even suppression | pos 0.4–0.55; even/odd ≤ −6 dB low partials ⊙ |
| `harp.material-zones` | ≥ 3 register zones (wire/gut/nylon) with independent B/decay tables | zone count ≥ 3 |
| `harp.body-cluster` | Fitted body peak(s) within 130–170 Hz | present |
| `harp.late-bloom` | Late-window energy above single-exponential extrapolation (sympathetic proxy) | > 0 dB ⊙ |
| `glockenspiel.resonator-class` | `bar` ratio class; stiff-string B unused | class check; B absent/0 |
| `glockenspiel.mode-ratios` | Rendered modes 2–3 vs fitted bar table (thick-bar trims allowed downward ≤ 20%) | ±35 cents of fitted table |
| `glockenspiel.mode-decay-hierarchy` | T60(mode1) exceeds T60(mode2) | ratio ≥ 5 ⊙ |
| `glockenspiel.centre-strike-dip` | Mode-2 level below neighbours for centre-strike preset | ≤ −6 dB ⊙ |
| `glockenspiel.mallet-brightening` | Upper-mode level rises with velocity/hardness | positive slope |
| `glockenspiel.partial-economy` | No fitted energy beyond bar-table modes (top slots zeroed) | leakage ≤ −40 dB |

Notes: (i) all ⊙ thresholds are set from the first corpus fit and may
tighten, never silently loosen; (ii) the pair assertions
(`upright-piano.b-exceeds-grand`, `steel-guitar.b-exceeds-nylon`, the
decay/onset sign rows) are **cross-preset** — they need both fitted presets
loaded, a new but small assertion-runner capability.

### 7c. Engine capability gaps beyond plan §6

- **N1 · G7 velocity→hardness: verify landed, then gate.** The renderer
  already routes `velocityHardnessCoupling` through `velocityHardness()`
  (synth.js:2626), though STRUCK_PLUCKED_PREFLIGHT.md S2 lists G7 as
  "still pending". Reconcile: add the `*.contact-brightening` assertion as
  a headless render check so the coupling can never silently no-op. The
  law's *shape* should follow C10 (contact-time low-pass corner, ±20–30%
  over the dynamic range), not a plain tilt.
- **N2 · Contact-time excitation law (upgrade, small).** Express hammer/
  mallet/pick hardness as an effective contact-duration filter (sinc-like
  corner ∝ 1/τ, τ scaled by register and velocity) on the excitation
  spectrum. Piano bass→treble τ 4→<1 ms and mallet hardness (C32) both
  need it; a spectral tilt cannot produce the measured flat-then-rolloff
  shape.
- **N3 · Two-polarisation / unison beating (new, bounded).** Per-partial
  seeded beat: rate 0.1–3 Hz (fitted bounds), depth fitted, default 0.
  Evidence: few-Hz doublets on guitar (C22), unison/polarisation beats and
  aftersound movement on piano (C2). G4 gives the two-stage energy but a
  static envelope; recordings shimmer. Distinct from vibrato (no FM
  needed): amplitude-domain, per-partial, seeded per note (§2.5c).
- **N4 · Longitudinal/phantom components for piano bass (defer, log).** A
  small fixed set of fast-decaying inharmonic onset components around
  8–16× f0 for bass presets (C12). Off the B-stretched series by
  construction, so unreachable by the 64-partial table. File; implement
  only if bass residuals survive the variability floor.
- **N5 · Bar-class completion (required for glock; enables S5 wins).**
  (a) per-preset mode-ratio table override/trim (tuned marimba/xylo
  ratios; thick-bar downward trims, C28–C29); (b) **per-mode decay**
  control so T60(mode1) ≫ T60(mode2+) (C31); (c) strike-position law
  using bar mode shapes (or, short-term, direct per-mode level fitting per
  strike-point preset) because sin(nπx) is a string law (C32); (d) seeded
  strike-point wander (Pianoteq precedent, C41).
- **N6 · Cross-preset assertion runner (tooling, not engine).** The morph
  pairs need assertions comparing two fitted presets (7b); today
  assertions.py sees one bundle at a time.
- **Confirmations, not gaps:** decay-aligned windowing is scorer-side (7a);
  una corda and près-de-la-table are variation presets on existing
  parameters (C5, C26); sympathetic halo stays proxied by
  `partialTransfer` + G4 unless harp late-decay residuals force the
  bounded resonant-coupling WP (C27, dossier §5).

### 7d. The morph-pair differentiating parameter sets

**Grand ↔ upright (same mechanism, different construction):**

| Axis | Direction (grand → upright) | Evidence |
|---|---|---|
| B table, bass half | ×2–3 up | C6–C7 |
| Early-stage T60 | down (lower soundboard impedance) | C3, C13 |
| Body bands | re-fit: more low-mid irregularity, duller top, cabinet colouration | C14 |
| Hammer/contact corner | slightly down + noisier onset ⊙ (worn/cheaper regulation is anecdotal — fit, don't assert) | C9–C10 |
| Double-decay ratio | broadly preserved (mechanism identical) | C1–C4 |
| What must NOT change | ratio class, comb law, impulsive gate | firewall |

**Steel ↔ nylon (string + excitation + body trim):**

| Axis | Direction (steel → nylon) | Evidence |
|---|---|---|
| B table, wound strings | down (÷ ≳ 1.3, toward near-threshold) | C18 |
| Global T60 | down; HF decay exponent steeper | C19 |
| Onset (pick → flesh/nail) | contact corner down, onset noise softer/shorter | C21 |
| Body bands | low air+top pair ≈ unchanged (≈ 100/200 Hz); mid/high response re-fitted per construction | C15–C17 |
| Pluck position | both fitted; typically slightly farther from bridge for classical ⊙ | C20 |
| What must NOT change | air-mode gate, position-wander seeds, impulsive gate | firewall |

These two tables are the WP-9 §morph test matrices: a family morph that
moves any "must NOT change" row is malformed.

---

## Appendix: corrections and evidence-quality notes

1. **Ample Guitar is sample-based**, not a physical model — the brief's §6
   framing is corrected; the physical-modelling guitar reference is AAS
   Strum GS-2 (C42). Pianoteq, by contrast, genuinely covers four of the
   six campaign targets (grand, upright, harp, glockenspiel) as physical
   models — the closest commercial mirror any SG2 family has had (C38–C41).
2. **Weakest numbers in this annex** (re-measure before freezing):
   grand-vs-upright same-note B values (C7, single paper); D-28 mode
   frequencies (C16, secondary citation chain); thick-bar ratio trims
   (C29, derived); glockenspiel per-mode decay times (C31 — no published
   table found; corpus is the source of truth); pp→ff gain span (C11).
3. **No published double-decay breakpoint-by-register table exists** in
   the surveyed literature: Weinreich gives rates and mechanism at one
   note; D. W. Martin's "Decay rates of piano tones" (JASA 19:535, 1947,
   [record](https://pubs.aip.org/asa/jasa/article-abstract/19/4/535/763628/Decay-Rates-of-Piano-Tones)),
   Hundley, Benioff & Martin, "Factors contributing to the multiple rate of
   piano tone decay" (JASA 64, 1978)
   and Cheng/Dixon/Mauch (ICASSP 2015,
   [PDF](https://www.eecs.qmul.ac.uk/~simond/pub/2015/ChengDixonMauch-ICASSP2015-Decay.pdf))
   confirm multi-rate decay across the keyboard. Hence 7a parameterises
   (rate_early, rate_late, knee) per register from our own references
   rather than asserting literature breakpoints.
4. **Family firewall reminders encoded above:** glock scores mode ratios,
   never B (C28–C29); piano dynamics are gain+contact-corner, not the
   bowed tilt law (C11); harp is three string-material zones, not one
   instrument (C24); steel-vs-nylon does not live in the air mode (C16).

## Source index

| # | Source | Used for |
|---|---|---|
| 1 | Weinreich, JASA 62:1474 (1977) + KTH lecture | C1, C2, C5 |
| 2 | Wogram, KTH Five Lectures | C3 |
| 3 | Woodhouse, JASA 150:4375 (2021) | C4 |
| 4 | ISVR Southampton una-corda model (2024) + Wikipedia soft pedal | C5 |
| 5 | Acta Acustica 5 (2021) piano bass strings | C6 |
| 6 | Contra-octave upright study (S. Florida OJS) | C7 |
| 7 | FBS JASA 34:749 (1962); BYU pitch study | C8 |
| 8 | Russell PSU hammer pages; Stulov felt models | C9, C10 |
| 9 | Askenfelt & Jansson, KTH Five Lectures | C10, C11 |
| 10 | Conklin KTH; Bank & Sujbert JASA 117 (2005); JASA 128:EL117 (2010) | C12 |
| 11 | Ege & Boutillon, arXiv 1210.3948 | C13 |
| 12 | ISMA grand/upright radiation comparison (RG 393941069) | C14 |
| 13 | Euphonics 5.3 + 4.2.2 | C15, C17 |
| 14 | Popp & Rossing 1986 via Fletcher & Rossing PMI | C16 |
| 15 | Järveläinen et al. (inharmonicity audibility; guitar; decay tolerances) | C8, C18, C36, C37 |
| 16 | Woodhouse Guitar I/II, Acta Acustica 90 (2004) | C19, C22 |
| 17 | Acta Acustica 4 (2020) polarization coupling | C22 |
| 18 | Traube et al. plucking-point estimation; Applied Acoustics 2005 | C20 |
| 19 | Chadefaux et al. JASA 131:844 (2012); JASA 133 (2013) | C21, C25 |
| 20 | arXiv 2606.24356 pluck micro-trajectory | C21 |
| 21 | Le Carrou et al. JASA 127:3203 (2010) | C23 |
| 22 | Le Carrou et al. sympathetic modes (2005/2009, HAL) | C27 |
| 23 | Woodhouse & Tall, JSV 523 (2022) harp string | C24 |
| 24 | composingforharp; timbre & orchestration resource | C24, C26 |
| 25 | CCRMA percussion notes; Physics LibreTexts; UBC PHYS341 | C28–C32 |
| 26 | Timoshenko beam literature | C29 |
| 27 | JASA-EL 5:093201 (2025) glockenspiel mounting | C31 |
| 28 | Chaigne & Doutaut JASA 101/104 (1997/98) | C32 |
| 29 | Wikipedia glockenspiel; VSL Academy | C33 |
| 30 | McAdams handbook chapter; onset-relevance study; Saldanha & Corso; Iverson & Krumhansl (via #30) | C34 |
| 31 | Reversed-audio pedagogy | C35 |
| 32 | Modartt: manual, features, U4, Harp, Celeste (+ Sweetwater) | C38–C41 |
| 33 | AAS Strum GS-2 pages; MusicRadar review; Ample listings | C42 |
| 34 | Martin JASA 19:535 (1947); Hundley/Benioff/Martin JASA 64 (1978); Cheng et al. ICASSP 2015 | Appendix 3 |

Verification status: C1–C4, C6, C9–C10, C15, C18–C23, C25, C27–C28, C32,
C34, C36, C38–C42 rest on ≥ 2 independent sources as marked. C5 (una-corda
aftersound detail), C7, C11 (exact spans), C12 (perception study), C14,
C16, C29–C31 (glock decay numbers), C33 (pitch-salience framing) are
single-source, derived, or unread-in-full and are marked accordingly; none
of them backs a hard gate without a corpus fit behind it.
