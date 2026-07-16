# SG2 research annex — bowed-string realism (violin, cello)

Status: research annex to `docs/sg2/DOSSIER_BOWED.md`, written 2026-07-16 in
response to the owner baseline verdict "the strings don't sound like strings"
(baseline violin/cello renders vs Iowa references). This document answers,
with citations and numbers, WHAT makes a bowed string sound bowed, ranked by
perceptual importance, and maps each finding onto the engine's three stages
(excitation spectrum × position comb → 64-partial resonator → fixed-Hz body
EQ).

Conventions:

- Claims are numbered `C1…C54` for cross-reference by coding agents. Each
  claim carries its evidence and a **Synthesis consequence** line.
- `[single-source]` marks claims verified against only one independent
  source; treat their numbers as provisional and re-measure on the Iowa/
  Philharmonia corpus before freezing.
- "Period-scaled" means a duration expressed in nominal f0 periods, to be
  converted per note (violin G3 196 Hz: 1 period ≈ 5.1 ms; cello C2 65.4 Hz:
  1 period ≈ 15.3 ms).

Primary sources (abbreviated in claims):

- **Euph 5.3 / 9.x** — J. Woodhouse, *Euphonics* (euphonics.org), chapters
  [5.3 Signature modes and formants](https://euphonics.org/5-3-signature-modes-and-formants/),
  [9.2 Beyond Helmholtz](https://euphonics.org/9-2-beyond-helmholtz/),
  [9.3.1 Schelleng's bow force limits](https://euphonics.org/9-3-1-shellengs-bow-force-limits/).
- **Woodhouse 2004** — "The bowed string as we know it today", Acta Acustica
  90 ([review PDF](https://euphonics.org/wp-content/uploads/2022/03/BowedStringReview.pdf)).
- **Schoonderwaldt 2009** — E. Schoonderwaldt, *Mechanics and acoustics of
  violin bowing*, KTH doctoral thesis
  ([diva-portal PDF](https://www.diva-portal.org/smash/get/diva2:133385/FULLTEXT01.pdf)),
  containing Paper I (Schelleng empirics) and Paper II "The violinist's sound
  palette: spectral centroid, pitch flattening and anomalous low frequencies"
  (JASA 2009; [RG record](https://www.researchgate.net/publication/233566597_The_Violinist's_Sound_Palette_Spectral_Centroid_Pitch_Flattening_and_Anomalous_Low_Frequencies)).
- **G&A 1997** — K. Guettler & A. Askenfelt, "Acceptance limits for the
  duration of pre-Helmholtz transients in bowed string attacks", JASA 101(5)
  2903–2913 ([JASA record](https://pubs.aip.org/asa/jasa/article-abstract/101/5/2903/563485/)).
- **Guettler IOA 1997** — K. Guettler, "Bow notes", Proc. Institute of
  Acoustics 19(5) ([PDF](http://www.knutsacoustics.com/files/Bow-notes--I.O.A-1997-.pdf)).
- **Guettler CISM** — K. Guettler, "The violin bow in action — a
  sound-sculpturing wand" ([PDF](http://knutsacoustics.com/files/The-Sound-Sculpturing-bow-CISM_7opl67i1.pdf)).
- **MSW 1981** — McIntyre, Schumacher & Woodhouse, "Aperiodicity in
  bowed-string motion", Acustica 49, 13–32 (and 1982 follow-up on
  differential slipping; summarized in Woodhouse 2004 and Euph 9.2).
- **M&W 2000** — M. Mellody & G. Wakefield, "The time-frequency
  characteristics of violin vibrato: modal distribution analysis and
  synthesis", JASA 107(1) 598–611
  ([JASA record](https://pubs.aip.org/asa/jasa/article-abstract/107/1/598/550459/)).
- **Gough 2005** — C. Gough, "Measurement, modelling and synthesis of violin
  vibrato sounds", Acta Acustica 91
  ([PDF](https://violinacoustics.com/wp-content/uploads/2015/08/acustica-vibrato-paper.pdf)).
- **F&S 1967** — H. Fletcher & L. Sanders, "Quality of violin vibrato tones",
  JASA 41, 1534–1544 ([BYU record](https://physics.byu.edu/docs/publication/1499)).
- **P&L 2010** — J. Pätynen & T. Lokki, "Directivities of symphony orchestra
  instruments", Acta Acustica 96, 138–167
  ([DOI](https://doi.org/10.3813/AAA.918265)).
- **Buen 2005** — A. Buen, "Comparing the sound of golden age and modern
  violins: long-time-average spectra", VSA Papers 1(1)
  ([akutek PDF](https://www.akutek.info/Papers/AB_Violin_spectra_2005.pdf)).
- **Fritz 2010** — C. Fritz, J. Woodhouse et al., "Perceptual studies of
  violin body damping and vibrato", JASA 127(1)
  ([PubMed](https://pubmed.ncbi.nlm.nih.gov/20058996/)); with Fritz et al.
  2007, "Perceptual thresholds for detecting modifications applied to the
  acoustical properties of a violin", JASA 121
  ([RG record](https://www.researchgate.net/publication/5604079_Perceptual_thresholds_for_detecting_modifications_applied_to_the_acoustical_properties_of_a_violin)).
- **SWAM manual** — Audio Modeling, *SWAM Solo Strings User Manual v3.0.2*
  ([PDF](https://static.audiomodeling.com/manuals/strings/SWAM%20Solo%20Strings%20-%20User%20Manual%20-%20v3.0.2.pdf));
  Sound On Sound review
  ([SOS](https://www.soundonsound.com/reviews/audio-modeling-swam-solo-instruments)).

---

## 1. Sustained-tone spectral envelope

### 1.1 The source: a sawtooth whose corner moves with dynamics

**C1.** The bridge force of ideal Helmholtz motion is a sawtooth: the nth
harmonic amplitude is proportional to 1/n, i.e. a −6 dB/octave source
envelope, before any bow-position comb or body filtering. — Evidence:
Euph 2.2.1/9.2; Guettler CISM ("the bridge force of ideal Helmholtz motion is
a sawtooth signal, corresponding to a spectrum with a monotonically
decreasing envelope with slope −6 dB per octave"). *Synthesis consequence:*
the EXCITOR partial table for `bow` should start from a 1/n baseline, not a
flat or Gaussian-lump spectrum; every deviation from 1/n is a fitted,
mechanism-named term (comb, corner rounding, body).

**C2.** Real bowed strings never achieve the ideal sawtooth: damping rounds
the Helmholtz corner in transit and the bow re-sharpens it each sticking
phase (Cremer's "corner rounding", 1972–73). At low bow force the spectrum
falls *steeper* than −6 dB/oct; raising bow force sharpens the corner and
flattens the slope back toward (and locally beyond) the sawtooth reference.
— Evidence: Guettler CISM ("due to substantial rounding of the Helmholtz
corner, the spectrum shows a slope steeper than −6 dB per octave"); Euph 9.2
(higher force "shifts the balance in favour of corner-sharpening");
Woodhouse 2004. *Synthesis consequence:* the dynamic law for bowed strings is
a **slope/tilt law, not a gain law**: `dynamicBrightness` must tilt the
per-partial envelope around a low anchor as intensity rises, keeping f0-band
level nearly constant (loudness on a string grows far less than brightness —
see C5/C6).

**C3.** Bow force is *the* dominant control of brightness. On a bowing
machine covering the playable region, spectral centroid ranged 0.8 kHz (low
force, bow far from bridge) to 3.0 kHz (high force, near bridge); multiple
regression confirmed force "totally dominating", with bow velocity mildly
*darkening* (higher speed = duller) and bow-bridge distance nearly
irrelevant at constant force. — Evidence: Schoonderwaldt 2009 ch. 2.4,
Fig. 2.4/2.5 (forces 58 mN–1466 mN, β from 1/30 = 11 mm to 1/6 = 55 mm);
corroborated by Guettler/Schoonderwaldt/Askenfelt SMAC'03 "Bow speed or
bowing position — which one influences the spectrum the most?".
*Synthesis consequence:* map the preset dynamic axis primarily onto the
C2 tilt term; expected radiated centroid roughly doubles from p to f on the
same note. The existing `violin.bow-force-edge` gate (slope ≥ −0.05) is far
too weak to produce this — see §7 targets.

**C4.** The bow-position comb: bowing at fractional distance β from the
bridge suppresses harmonics near multiples of 1/β (factor sin(nπβ) on the
excitation). Normal playing spans β ≈ 1/30…1/6, with ordinary positions
around 1/12–1/9. The comb's *audible* footprint at normal β is modest
(C3: spectrum barely depends on β at constant force) but its per-note
*variability* is real — the fit found deep single-partial notches moving
note-to-note in the Iowa violin corpus (BOWED_PREFLIGHT.md P2 findings, e.g.
p3 −33 dB on one semitone). — Evidence: Schelleng 1973 via Woodhouse 2004;
Schoonderwaldt 2009 (β ranges); repo evidence for wander.
*Synthesis consequence:* keep `excitationPosition` ≈ 0.08–0.11 as the comb
seed; do NOT fit deep static combs into per-partial tables (they are per-note
draws, §2.5b) — a frozen notch pattern repeated identically on every note is
a synthesizer tell.

### 1.2 The body: fixed-Hz formants that the moving harmonics sweep across

**C5.** Violin signature modes (typical good instrument): A0 (air/Helmholtz)
≈ 270–280 Hz; CBR ≈ 405 Hz (weak radiator); B1− ≈ 450–480 Hz; B1+ ≈ 530–570
Hz. Example instrument in Euph 5.3: A0 = 272 Hz, CBR = 407 Hz, B1− = 462 Hz,
B1+ = 551 Hz. — Evidence: Euph 5.3; corroborating mode tables in Jansson,
*Acoustics for violin and guitar makers* ([KTH PDF](https://www.speech.kth.se/music/acviguit4/part1.pdf))
and Strad3D/Curtin modal data ([strad3d](https://www.strad3d.org/modalvid.html)).
*Synthesis consequence:* fitted violin `bodyBands` must include a narrow
peak in 250–310 Hz (A0) and at least one strong peak in 420–600 Hz (B1
cluster). Below A0 the radiated fundamental collapses — G3–B3 fundamentals
are weak and the *ear infers* them from harmonics 2–4; do not "fix" this by
boosting p1.

**C6.** The violin **bridge hill**: a broad radiated-response elevation
peaking ≈ 2.3–2.5 kHz, of order 20 dB above the underlying trend and several
hundred Hz wide, present in nearly all violins. — Evidence: Euph 5.3 ("peaks
around semitone 40 (2.3 kHz)… about 20 dB"); Durup & Jansson, "The quest of
the violin bridge-hill", Acta Acustica 91 (2005); Woodhouse, "On the bridge
hill of the violin", Acta Acustica 91 (2005) (both already anchored in
DOSSIER_BOWED.md §1). *Synthesis consequence:* the 2.0–3.2 kHz fixed-Hz gate
stands; in `bodyBands` terms the hill is a *broad* band (width ≈ 0.3–0.5
octave), not a high-Q peak — the analysis fit's stable 2343/2387 Hz peak is
the right shape of answer.

**C7.** Averaged over many notes and directions, the violin's radiated
long-term spectrum shows power peaks near ≈ 290, 530, 1500 and 3350 Hz, and
above ≈ 3 kHz rolls off at roughly −15 dB/octave. — Evidence: P&L 2010
Fig. 38 (measured, octave-smoothed; anechoic 22-mic average) citing Fletcher
& Rossing for the −15 dB/oct figure — two independent measurement chains.
*Synthesis consequence:* after body EQ, the *rendered* LTAS above 3 kHz must
fall at −12…−20 dB/oct at mezzo-forte. A too-shallow high end reads as
"synth string"; a too-steep one as "behind a door". This is a scorer feature
(§7a) — the current mel distance can trade this region away.

**C8.** Perceptually named LTAS regions for violin (useful bands for band
diagnostics): low-mid 275–410 Hz (body warmth), "nasal" band 650 Hz–1.3 kHz
(stronger here = nasal/boxy), "low brilliance" 1.5–2.5 kHz, "high
brilliance" 3–6.5 kHz, >5 kHz = sharpness. Old Italian instruments were
stronger at 275–410 Hz and 3–6 kHz and *weaker* at 650–1300 Hz than modern
ones. Average level near a played violin ≈ 86 dB. — Evidence: Buen 2005
`[single-source]` (band naming is his, but band behaviour is cross-checked
against Gabrielsson & Jansson's 22-violin LTAS study,
[Semantic Scholar record](https://www.semanticscholar.org/paper/71befcd4282e07f079db20b2b33e160b33dfcd0c)).
*Synthesis consequence:* when the owner says a render is "boxy/honky",
look at 650–1300 Hz relative to 275–410 Hz first; keep the nasal band at or
below the low-mid band in fitted bodies.

**C9.** Cello body: A0 ≈ 90–105 Hz; main wood/B1 resonances form the highest
low-frequency peaks below ≈ 300 Hz (main body resonance commonly ≈ 147–196
Hz; the wolf region ≈ F#3–G3, 175–196 Hz, sits on it). Radiated response
shows two broad "hills" ≈ 1 kHz and ≈ 2–2.3 kHz (bridge resonances with feet
clamped: sway ≈ 1.5 kHz, bend ≈ 2.2 kHz, bounce ≈ 3.1 kHz). — Evidence:
Euph 5.3 (hills, bridge resonances); A0/B1 figures aggregated from cello
modal literature via
[Wolf Terminator physics page](https://wolfterminator.com/the-physics-of-the-wolf-note/)
and RG modal-analysis figures — treat exact A0/B1 Hz as `[single-source]`
until P2's own fit confirms them on the Iowa cello corpus.
*Synthesis consequence:* cello `bodyBands` need a low cluster (≈ 90–110 Hz
and ≈ 165–230 Hz) *plus* mid hills near 1 kHz and 2–2.3 kHz. The existing
180–700 Hz cello gate misses both hills — add the ≈1 kHz region to the
scorer (§7a) or cello renders will stay "woolly".

**C10.** Body filtering is why the same instrument sounds different on every
note: harmonics move; formants don't. The P2 deconvolution already
demonstrated note-independent fitted peaks (violin split-half bridge-hill at
2343/2387 Hz, corr 0.70; cello 0.94). — Evidence: repo P2 results;
mechanism per Woodhouse 2004. *Synthesis consequence:* G1 register tables +
fixed `bodyBands` is the right factorisation; never let a fitting fallback
re-absorb body ripple into per-partial tables.

**C11.** Tolerances for body fitting: mode *frequencies* and levels matter
more than exact Q. Changes of mode Q up to ~40% produced only slight
perceptual differences; detection thresholds for vibrato depth and for body
damping are mutually independent. — Evidence: Fritz et al. 2007; Fritz 2010.
*Synthesis consequence:* spend fitting budget on band centre frequencies and
gains, not on width refinement below ~±20%; a coarse-Q body that PEAKS in
the right places beats an exact-Q body that peaks in the wrong ones.

### 1.3 Dynamics of the whole envelope

**C12.** Playing dynamics changes a string's spectrum more than its level:
at A4 forte vs piano the high-order harmonics are emphasized while
directivity and low-harmonic level barely move. The playable force range at
one β spans ≈ 25× (58→1466 mN), yet radiated *loudness* change is modest
compared to the centroid change (0.8→3 kHz). — Evidence: P&L 2010 (Fig. 35);
Schoonderwaldt 2009. *Synthesis consequence:* per dynamic step, allocate
most of the audible change to spectral tilt (C2/C3) and noise mix (§2), and
comparatively little (≈ 3–6 dB) to broadband gain. A velocity→gain-dominant
mapping is a piano law, not a string law.

---

## 2. Bow noise (the strings' breath)

**C13.** Mechanisms are established even where ratios are not: three
measured sources of aperiodicity ride on Helmholtz motion — (a) flyback
jitter (period-to-period timing noise of the slip), (b) sub-harmonic
perturbations, (c) **differential slipping** of individual bow hairs during
nominal sticking, which releases miniature secondary corners. — Evidence:
MSW 1981 + 1982 follow-up; Woodhouse 2004; Euph 9.2.
*Synthesis consequence:* bowed sustain noise is **pitch-synchronous plus
broadband**: a component gated at the slip rate (f0-correlated roughness)
and a hair-friction hiss. The P4 excitation-noise architecture (noise source
→ body-band routing → envelope-coupled gain) fits; the seeded turbulence
texture should be partially comb-filtered at f0 to mimic slip-synchronous
spikes rather than pure white breathiness.

**C14.** Noise character moves with bow force: at low force the friction
spikes are frequent and small (dense, hiss-like); as force rises they become
sparser and individually stronger (rougher, granular). — Evidence: Guettler
CISM ("irregular spikes… decrease in frequency and increase in intensity as
the bow force rises"); MSW 1981. *Synthesis consequence:* one noise level
knob is not enough; couple noise *texture density* (turbulence seed rate) to
the dynamic axis: pp = dense fine hiss, f = sparse coarse grit.

**C15.** Below Schelleng's minimum bow force the string falls into
double/multiple slipping ("surface sound"): the fundamental weakens, upper
harmonics and noise dominate, and the pitch class can ambiguate toward the
octave. Crucially this is the *pianissimo* failure mode, so soft playing
lives near it: quiet bowed notes carry proportionally more high, noisy
content, not less. Below the lower limit the spectral centroid *increases*.
— Evidence: Schoonderwaldt 2009 (centroid rise below lower limit; Paper I
minimum-force empirics); Euph 9.3.1 (Schelleng limits: f_max ∝ 1/β, f_min ∝
1/β²; f_max/f_min = 4βR/Z₀); Bader-school cochlear study of cello
double-slip ([arXiv 1804.05695](https://arxiv.org/pdf/1804.05695)).
*Synthesis consequence:* the inefficiency law from blown ("noise ratio ↑ at
pp") transfers as a mechanism, with a bowed twist: at pp the added noise and
partial energy sit *higher* in the spectrum (surface sheen), while the
harmonic core is *darker* (C2 low-force corner rounding). Fit the two signs
independently; do not copy blown values (FAMILY FIREWALL).

**C16.** No published table of sustained noise-to-harmonic ratio (NHR) per
dynamic for violin/cello was found in this survey — voice-style HNR norms
(0 dB = equal energy; >20 dB = very clean) exist only for speech. Residual
noise is nonetheless established as necessary for realism: synthesis studies
that added a separate residual/bow-noise component were judged markedly more
natural (F&S 1967 noted bow noise "added realism"; the HpRNet violin model
[Michelashvili & Wolf 2020](https://arxiv.org/abs/2008.08405) architecturally
separates harmonic and residual parts). — Evidence: as cited; absence of
norms verified across searches. *Synthesis consequence:* the P1
`noise-to-harmonic ratio per dynamic` scorer feature must derive its target
**from the Iowa corpus itself** (per instrument, per dynamic, per string);
the construction gate can only assert the *sign* (NHR(pp) > NHR(f)) until
those numbers exist. This is the correct division: measured values in
profiles, laws in the dossier.

**C17.** Bow direction changes inside long notes produce brief
amplitude/flux dips with a re-articulation transient; the analysis lane
already trims references to single-bow segments (76 violin / 134 cello
segments). — Evidence: repo P3; bow-change mechanics per Guettler IOA
(détaché stops "mute the string… quickly enough to be masked").
*Synthesis consequence:* fitting is safe, but *playback* of notes longer
than a realistic bow (≈ 4–8 s at moderate dynamic) with a perfectly static
sustain is a tell; see gap N3 in §7c.

---

## 3. Onset: from scratch to Helmholtz lock-in

**C18.** The canonical numbers: listeners (20 advanced string players)
accept pre-Helmholtz transients up to **50 ms (≤ 10 nominal periods) for
"prolonged-period" (creaky/choked) onsets** and up to **90 ms (≤ 18–19
periods) for "multiple-flyback" (loose/slipping) onsets** on the violin open
G (196 Hz); a playing test with two professional violinists confirmed the
limits. — Evidence: G&A 1997 (JASA abstract carries the numbers); Guettler
IOA 1997 Fig. 1 (same numbers, 7755-simulation Guettler diagram).
*Synthesis consequence:* onsets are period-scaled. For the engine: normal
attacks should reach a stable harmonic regime within ≤ 18 periods of f0
(violin A4: ≤ 41 ms; cello C2: ≤ 275 ms), and *good* attacks within ≤ 10.
The measured `bandT90ms` stagger already landed (G5); what is missing is the
audible pre-lock-in **content** (C20).

**C19.** A "perfect attack" (Helmholtz from the first slip) exists only in a
wedge of the (bow force, acceleration) plane — the Guettler diagram; players
hit it far from always, and each articulation is a different trajectory
through that plane. Martelé = high initial force + high acceleration
("consonant-like" bite, near-immediate triggering, initial force released
right after the start); gentle legato/détaché starts = low acceleration,
longer aperiodic phase. Normal sustained bow force: 0.5–1.5 N (violin);
ricochet gives 10–20 crisp attacks/s. — Evidence: Guettler IOA 1997; G&A
1997; Guettler thesis
([PDF](http://knutsacoustics.com/files/thesis-guettler-020607.pdf));
recent experimental confirmation of Guettler-diagram playability in
[Acta Acustica 2024](https://acta-acustica.edpsciences.org/articles/aacus/full_html/2024/01/aacus240063/).
*Synthesis consequence:* the P4 articulation-strength draw maps cleanly:
strong draw → short scratch, immediate pitch, extra contact "bite"
(transient force spike also excites body percussively); weak draw → longer
noise lead, slower speak. Couplings must be fitted from string onsets, never
inherited from blown (firewall assertion already in place).

**C20.** The two pre-Helmholtz classes sound different and sit on opposite
sides of nominal pitch: *prolonged periods* (excess force for the
acceleration) sound creaky/raspy with instantaneous frequency BELOW f0 —
this is the classic forte "scratch"; *multiple flyback* (insufficient force)
sounds whistly/loose with energy concentrated around and above the upper
harmonics, ambiguous toward the octave. — Evidence: G&A 1997 (attack
classes); Schoonderwaldt 2009 (prolonged periods pull the centroid down;
multiple slip boosts upper harmonics); cello double-slip study (arXiv
1804.05695: secondary slip creates "two periodicities… around double the
fundamental periodicity"). *Synthesis consequence:* the scorer's
`onset_noise_centroid_oct` should discriminate the classes: accented-forte
reference onsets → low-centroid crackle; soft onsets → high-centroid
surface whistle. The engine's onset colour (`onsetSpectrumTilt`-family, now
excitation-generic) needs to support both signs; a single fixed "scratch
colour" cannot cover the articulation axis.

**C21.** Onset pitch behaviour is wander/settle, not scoop-from-below as a
law: prolonged-period starts sit flat (period lengthened), multiple-slip
starts flicker sharp/octave-ambiguous, and the settled pitch itself depends
on bow force (C22). — Evidence: G&A 1997 attack taxonomy; Schoonderwaldt
2009 pitch maps. *Synthesis consequence:* fit the measured trajectory shape
per articulation class (P1 `onset_wander_cents` measures both directions);
hard-coding the blown scoop shape would be wrong in sign for soft bowed
starts.

**C22.** The flattening effect (audible correlate of the Schelleng upper
limit): near the upper force limit the Helmholtz corner's release hysteresis
prolongs the period; measured flattening reached **26 cents at bow speed
5 cm/s and up to 77 cents (13 Hz) at 20 cm/s**; contours of 5–10 cent
flattening run parallel to the upper force limit but a factor 2–3 lower in
force — so *musically loud playing already flattens by 5–10 cents*.
Sharpening is smaller (≤ ~10 cents, from vibration-amplitude tension rise
at small β/high speed; bowed pitch ≈ 6 cents above the pizzicato decay pitch
of the same string). — Evidence: Schoonderwaldt 2009 Paper II; mechanism
McIntyre/Schumacher/Woodhouse 1977 & Boutillon 1991 via Woodhouse 2004.
*Synthesis consequence:* a small *downward* pitch offset coupled to the
dynamic axis (0 at p, −5…−10 cents toward ff, plus onset-transient
exaggeration) is a cheap, evidence-backed "bow is pressing" cue no additive
render currently carries. See gap N2.

---

## 4. Per-string identity

**C23.** The same written pitch on different strings is a different
spectrum: a stopped note high on a thick wound string carries fewer strong
harmonics (heavier, more damped, shorter vibrating length) than the same
pitch low on a thinner string. Bridge-force spectra of violin open strings
show the steel E sustaining significant harmonics to extreme frequencies
while the wound G concentrates its energy in its lowest ~6 harmonics
(below ≈ 5 kHz). — Evidence: Euph 9.2 `[single-source, but Woodhouse's own
measurements]`; corroborated qualitatively by string-material timbre study
([Sci. Reports 2025](https://www.nature.com/articles/s41598-025-23548-0),
bowing-machine recordings showing material-dependent formant/high-band
differences). *Synthesis consequence:* per-string partial tables (or at
minimum a per-string high-shelf + damping-slope difference) are required for
same-pitch-different-string pairs; the P3 `string` key must reach the
renderer's table selection, not just the reference floors.

**C24.** String-dependent physics that the engine already parameterises:
inharmonicity B and per-partial decay differ per string (solid steel E vs
gut/synthetic-core wound G/D/A; cello analogues). Flattening (C22) is
strongest "in a high position on a thicker string" — per-string onset and
pitch behaviour co-vary with the string, not just with f0. — Evidence:
Euph 9.2; Schoonderwaldt 2009. *Synthesis consequence:* G1 register tables
should be keyed by (string, register-on-string) where corpus coverage
allows, falling back to f0 registers; the same f0 must be able to produce
two fitted table rows (sulA vs sulD).

**C25.** Vibrato depth also carries string identity: for cellists, the same
physical finger motion produces radically different cents depth depending on
position and string (measured: pitch variation in cents *increases* toward
the bridge even though physical finger excursion decreases; combined-corpus
fits R² ≈ 0.4–0.6). — Evidence:
[arXiv 2512.18162](https://arxiv.org/abs/2512.18162) (cello vibrato registry
study); MacLeod register findings (C31). *Synthesis consequence:* vibrato
depth defaults should be per-register (wider higher), not global.

---

## 5. Vibrato: the body-filter AM engine of string "life"

**C26.** Rate norms: violin vibrato ≈ 4–6.5 Hz. Measured means: 5.9 Hz
(M&W 2000, ten pitches across the range); 4–6 Hz typical (Gough 2005);
professional soloist case study 5.7 Hz (1st position) rising to 6.3 Hz (5th)
([Allen, Geringer & MacLeod 2009](https://journals.sagepub.com/doi/abs/10.1177/1948499209OS-400103)).
*Synthesis consequence:* default rates 5.5 ± 0.7 Hz violin, ≈ 5 ± 0.7 Hz
cello; add slow drift/randomness (C32) rather than a locked LFO.

**C27.** Depth norms: mean FM excursion ±15.2 cents (M&W 2000); Gough's
Stradivari D4 example ≈ ±quarter-tone at the extreme of expressive width;
student/professional corpus means 34 cents (low register) to 58 cents
(high), soloists up to 108 cents peak-to-peak in 5th position; forte adds
≈ +4 cents vs piano; cello literature summarises 0.2–0.35 semitones
peak-to-peak. — Evidence: M&W 2000; Gough 2005; MacLeod 2008 (JRME);
Allen/Geringer/MacLeod 2009; arXiv 2512.18162. *Synthesis consequence:*
half-extent defaults: violin ≈ 15–25 cents (mid register), scaling toward
30–50 in high positions; cello ≈ 10–20 cents low, 25–35 high. These are
*peak* excursions of a near-sinusoid, not RMS.

**C28.** The body converts vibrato FM into large per-partial AM: with
partials sweeping across densely spaced body resonances (mean spacing
estimated ≈ 45 Hz by Cremer), measured amplitude fluctuations of individual
partials are typically **3–15 dB and sometimes exceed 25 dB** close to the
instrument (Meyer, via Gough), with cyclic modulation "sometimes as large as
100%", strongly asymmetric in time, and AM spectra peaking at integer
multiples of the vibrato rate. — Evidence: Gough 2005 (measurement +
modelling); M&W 2000 (independent measurement: "significant amplitude
variation in each partial… peaks primarily at integer multiples of the
vibrato rate"); F&S 1967 (earliest measurement: per-harmonic level variation
at the vibrato rate). Three independent sources. *Synthesis consequence:*
this is THE mechanism behind "alive" string sustain. The engine's FM→AM
through fixed body ridges (T5) must be exercised: under vibrato, each
partial's gain must be re-evaluated per audio block from the interpolated
`bodyBands` curve at its *instantaneous* frequency — a body EQ applied to a
static partial frequency produces zero AM and will fail the
`body_am_db` scorer feature.

**C29.** Perceptual weighting: removing the AM changes perceived quality
markedly; removing the FM (keeping AM) changes it little. Synthetic tones
with both, plus bow noise, were "very difficult to distinguish" from real
ones as early as 1967. — Evidence: M&W 2000 (MDS experiment); F&S 1967.
*Synthesis consequence:* scoring weight for `body_am_db` should exceed the
weight for exact FM depth match; a render with correct ±cents but flat
partial amplitudes is the "mechanical vibrato" the preflight warns about.

**C30.** Vibrato interacts with the room: at a distance, direct +
delayed/reflected FM sounds combine into more complex, partly randomised
AM/FM; close-mic (Iowa-style) references show the cleaner quasi-periodic
behaviour. — Evidence: Gough 2005 (measurements at increasing distance;
Meyer's observations). *Synthesis consequence:* fit vibrato/AM against dry
close references only (Philharmonia vibrato takes, per P3 role separation);
leave room complexity to the space stage — do not bake it into the timbre
model.

**C31.** Vibrato varies with register and dynamics (wider/faster higher;
slightly wider louder): +0.32 Hz and ≈ +26 cents from low to high register
across 60 players; +4 cents forte vs piano. — Evidence: MacLeod 2008;
Allen/Geringer/MacLeod 2009. *Synthesis consequence:* couple vibrato depth
(and weakly rate) to register tables and the dynamic axis with small fitted
slopes — defaults neutral, evidence from Philharmonia takes.

**C32.** Vibrato onset delay and ramp: no peer-reviewed norm table was found
for string players (this survey) — the trajectory features (onset delay,
ramp-in, rate drift) are nonetheless what commercial modellers expose
(SWAM: `Vibrato Fade In` in ms, `Vibrato Rate Rand`), and the P1 scorer
features (`vibrato_onset_delay_ms`, `vibrato_ramp_ms`, `vibrato_rate_drift`)
already landed to measure them. — Evidence: SWAM manual; repo P1.
`[single-source for norms — must be fitted from Philharmonia takes]`
*Synthesis consequence:* ship the trajectory *mechanism* (delay → ramp →
drift) with per-instrument fitted values; a plausible starting prior from
practice literature is delay 200–600 ms and ramp 300–800 ms on long
expressive notes, but treat these as priors, not targets.

---

## 6. What professional string modellers expose and model

**C33.** SWAM Solo Strings (Audio Modeling; waveguide-based physical model
descended from J.O. Smith's digital-waveguide work, per SOS review) exposes,
per note in real time: Expression/dynamics, **Bow Pressure** ("weight of the
bow"; max + high expression = labelled **Scratch** regime), **Bow/Pizz
Position** (sul ponticello ↔ sul tasto), **Bow Noise** ("amount of noise
produced by the bow rubbing the string"), **Rosin** (bow-string
stickiness), **Attack Ramp Speed**, **Bow Lift** (on/off-string release —
on-string stops the string), Play Mode (bow/pizzicato/col legno), Tremolo
(slow/fast = 1.5×), Harmonics (natural/artificial), **Vibrato Depth/Rate**
plus **Vibrato Rate Rand** and **Vibrato Fade In (ms)**, Portamento/advanced
legato (string-crossing split ratio), **Alternate Fingering** (which string
a pitch is played on), **Random Bow Amount** (seeded drift of pressure,
speed and position), **Random Finger** (pitch micro-drift), String
Resonance + **Open Strings** sympathetic resonance, Sordino, and selectable
**Instrument body** variants. — Evidence: SWAM manual v3.0.2 (parameter
descriptions read directly);
[SOS review](https://www.soundonsound.com/reviews/audio-modeling-swam-solo-instruments)
(waveguide lineage; bow-pressure extremes turning to "violently noisy,
unpitched scratch"). *Synthesis consequence:* independent confirmation of
the SG2 control split — user-facing: dynamics, bow position/edge, vibrato
(depth/rate/fade/randomness), articulation; construction data: body, tables,
B. Note which "life" features SWAM deems worth a knob: bow noise level,
seeded bow drift, finger pitch drift, vibrato fade-in — exactly the P4/§2.5c
human-variability items.

**C34.** Correction to the WP brief: **Modartt/Pianoteq ships no violin or
cello** — its modelled catalogue is keyboards/harp/percussion; bowed strings
remain a user-forum request ("Stringteq"). — Evidence:
[Pianoteq features](https://www.modartt.com/pianoteq_features);
[Modartt forum thread](https://forum.modartt.com/viewtopic.php?id=3815).
*Synthesis consequence:* there is no commercial *additive/modal* bowed
string to imitate; SWAM (waveguide) and sample libraries are the reference
points. SG2's additive route must therefore lean on the measured-feature
literature above rather than a competitor teardown. (No Audio Modeling
paper by "Fontana" was found; the engine's public technical lineage is
Smith's waveguide synthesis. The nearest academic thread is Serafin's bowed
friction models, e.g.
[Serafin & Young SMAC'03](https://opera.media.mit.edu/papers/SerafinYoung_SMAC03.pdf).)

**C35.** Neural/hybrid literature confirms the harmonic+residual split:
HpRNet ([Michelashvili & Wolf 2020](https://arxiv.org/abs/2008.08405))
generates violin as separate harmonic and residual-noise streams (carried
from the DDSP tradition), because harmonic-only reconstruction audibly
lacks the bow. — Evidence: as cited; consistent with F&S 1967 (C16).
*Synthesis consequence:* keeps DOSSIER §5's "residual bow noise —
representable via existing noise paths" verdict, now with the P4
architecture as the designated carrier.

---

## 7. What the ear needs, ranked — and what to build

Ranking criterion: measured size of the effect × strength of perceptual
evidence × distance from what the baseline render already does.

| Rank | Feature | Size / evidence | Engine stage |
|---|---|---|---|
| 1 | Fixed-Hz body formants incl. bridge hill over a 1/n source (C1, C5–C10) | ~20 dB features; universal in measurements | body EQ (fitted `bodyBands`), source tables |
| 2 | Vibrato with body-coupled per-partial AM (C28–C29) | 3–15 dB (to >25 dB) per-partial AM; AM ≫ FM perceptually | resonator FM × body EQ (T5 path) |
| 3 | Onset transient: period-scaled scratch → lock-in (C18–C21) | 50/90 ms acceptance limits; class-dependent colour | excitor noise + onset colour + partial stagger |
| 4 | Force→brightness tilt as THE dynamic law (C2–C3, C12) | centroid 0.8→3 kHz; force "totally dominating" | excitor dynamic tilt law |
| 5 | Sustained bow noise, dynamic-dependent texture (C13–C16) | mechanism proven; ratios to be corpus-fitted | P4 noise architecture |
| 6 | Per-note / per-string variability (C4, C23–C25) | −30 dB single-partial notch wander measured in-corpus | seeded position/articulation draws; per-string tables |
| 7 | Pitch micro-behaviour: flattening, settle, drift (C21–C22) | 5–10 cents at musical forte; up to 77 cents at limits | resonator f0 laws |

Items 1–2 are jointly sufficient to stop a sustained tone sounding "not like
a string"; items 3–5 govern whether *notes* (as opposed to tones) convince;
items 6–7 separate "good synth" from "recording".

### 7a. Proposed scorer features and targets

All spectral targets apply to the rendered note *after* body EQ, measured as
the scorer measures references. Values marked ⊙ are corpus-derived at fit
time (store in the measured profile; the tolerance is on render-vs-reference
distance, not on an absolute).

| Feature | Violin target | Cello target | Source |
|---|---|---|---|
| `ltas_rolloff_db_oct` (3–8 kHz, mf) | −15 ± 4 dB/oct | −15 ± 5 dB/oct (measure ⊙; less published) | C7 |
| `body_peak_A0_hz` (fitted band) | 250–310 Hz | 88–112 Hz `[single-source]` | C5, C9 |
| `body_peak_B1_hz` (fitted band) | 420–600 Hz | 160–235 Hz `[single-source]` | C5, C9 |
| bridge-hill / mid-hill prominence | 2.0–3.2 kHz ≥ −6 dB (existing gate) | add 0.8–1.2 kHz AND 1.8–2.5 kHz regions ≥ −6 dB | C6, C9 |
| `centroid_dynamic_ratio` (f vs p, same note/string) | ≥ 1.25, ≤ 3.0 | ≥ 1.2, ≤ 3.0 | C3, C12 |
| `gain_dynamic_db` (f vs p broadband) | 3–8 dB | 3–8 dB | C12 ⊙ |
| `vibrato_rate_hz` | 4.8–6.6 | 4.3–6.0 | C26 |
| `vibrato_halfextent_cents` (mid register) | 10–30 | 8–25 | C27 |
| `body_am_db` (median partial AM at vib rate, partials 2–10) | ≥ 3 dB; best partial ≥ 8 dB | ≥ 3 dB; best partial ≥ 8 dB | C28 |
| `onset_lockin_periods` (normal détaché) | ≤ 18 periods (good ≤ 10) | ≤ 18 periods (good ≤ 10) | C18 |
| `onset_noise_centroid_oct` sign | accented ↓ vs sustain, soft ↑ vs sustain | same | C20 |
| `noise_ratio_dynamic_sign` | NHR(pp) > NHR(f), values ⊙ | same | C15–C16 |
| `onset_pitch_offset_cents` (forte accents) | −5…−25, settling ≤ 18 periods | −5…−25, settling ≤ 18 periods | C21–C22 |

### 7b. Proposed construction-checklist assertions (assertions.py format)

Format matches `_result(id, description, passed, value, threshold)` rows in
`scripts/tone_match/assertions.py`; all inherit `strict_evidence` handling.

| Assertion ID | Required fact | Threshold |
|---|---|---|
| `violin.radiated-rolloff` | Rendered LTAS slope 3–8 kHz at mf | −19 ≤ slope ≤ −11 dB/oct |
| `violin.body-peak-cluster` | Fitted `bodyBands` contain ≥ 1 positive-gain band with centre in 250–310 Hz and ≥ 1 in 420–600 Hz | both present |
| `violin.vibrato-body-am` | A rendered vibrato note (depth ≥ 10 cents) shows median tracked-partial AM at the vibrato rate | `body_am_db` ≥ 3 dB |
| `violin.onset-lockin` | Onset aperiodic/noise window before stable harmonic regime, normal articulation | ≤ 18 nominal periods; accented presets ≤ 10 |
| `violin.pp-noise-rise` | Sustained noise-to-harmonic ratio rises toward soft dynamics | NHR(pp) − NHR(f) ≥ +2 dB (provisional until ⊙) |
| `violin.dynamic-tilt` | Same-note centroid ratio forte/piano (replaces the weak one-sided `bow-force-edge` bound) | 1.25 ≤ ratio ≤ 3.0 |
| `violin.per-string-tables` | Same-pitch different-string reference pairs resolve to distinct fitted rows | ≥ 1 sul-pair with per-string tables when corpus provides one |
| `cello.radiated-rolloff` | As violin | −20 ≤ slope ≤ −10 dB/oct (wider until ⊙) |
| `cello.body-peak-cluster` | ≥ 1 band centre in 88–112 Hz and ≥ 1 in 160–235 Hz | both present |
| `cello.mid-hills` | Usable energy in fixed 0.8–1.2 kHz and 1.8–2.5 kHz regions across notes (supplements the 180–700 Hz gate) | median prominence ≥ −6 dB |
| `cello.vibrato-body-am` | As violin | ≥ 3 dB |
| `cello.onset-lockin` | As violin, period-scaled (C2 ≈ 275 ms allowed) | ≤ 18 periods; accented ≤ 10 |
| `cello.pp-noise-rise` | As violin | ≥ +2 dB (provisional) |
| `cello.dynamic-tilt` | As violin | 1.2 ≤ ratio ≤ 3.0 |

Notes: (i) `*.dynamic-tilt` supersedes, not merely supplements,
`*.bow-force-edge` — the current slope ≥ −0.05 gate accepts a spectrally
static render, which is the baseline failure mode. (ii) `*.pp-noise-rise`
and rolloff bounds should be re-tightened from corpus measurements at first
fit (C16), with the provisional numbers above as the floor.

### 7c. Engine capability gaps not already in plan §6

- **N1 · Instantaneous body evaluation under FM (verify, likely present).**
  C28 requires each partial's body gain to track its instantaneous frequency
  during vibrato/wander. BOWED_PREFLIGHT.md P1 states FM→AM "already exists
  in-engine (T5)" — add a headless assertion that a vibrato render produces
  `body_am_db` ≥ 3 dB (7b) so a regression can never silently flatten it.
  If the body EQ is currently sampled once per note, this is the single
  highest-priority engine fix in this annex.
- **N2 · Dynamic pitch-offset law (new, small).** A bounded downward pitch
  offset coupled to the dynamic axis with onset exaggeration (C22):
  `dynamicFlattenCents` ∈ [0, 25], default 0 (neutral), fitted per
  instrument. Not in §6; distinct from the scoop/wander onset laws (it
  applies to the settled pitch at forte).
- **N3 · Bow-change re-articulation for long sustains (playback-side).**
  Notes held beyond a plausible bow length need a periodic micro-dip +
  mini-onset (C17). References are single-bow segments, so no fit demands
  it; file as a renderer/playback gap (severity: exposed by any held chord),
  default off.
- **N4 · Vibrato trajectory parameters (engine side of P1).** Scorer senses
  landed; the renderer needs matching controls — vibrato onset delay, ramp
  time, rate drift/randomness (C32; SWAM precedent `Vibrato Fade In`,
  `Vibrato Rate Rand`). If any are missing from DEFAULTS, they are new keys
  (neutral = instant, no drift).
- **N5 · Sympathetic open-string resonance (low priority).** SWAM exposes
  it (C33); it colours releases and legato on real instruments. Cheap
  additive approximation: brief release-ring at open-string f0s when the
  played note shares a partial within a tolerance. Defer unless owner
  listening flags "dead releases".
- **Confirmations, not gaps:** per-note seeded excitation-position wander is
  already §2.5(b)/(c) work; sustained bow-hair noise is P4; register/string
  tables are G1 (extended per-string by C24).

---

## Appendix: corrections and evidence-quality notes

1. **Pianoteq**: contrary to the WP-6 brief wording, no Modartt bowed-string
   product exists to study (C34).
2. **Bow-position ≠ brightness**: players and much folklore say "closer to
   the bridge = brighter"; the machine data attribute brightness to force,
   with β nearly irrelevant at constant force (C3). Do not add a
   position→brightness coupling to the engine; position drives the comb and
   the *playable force window* (which indirectly forces louder/brighter
   playing near the bridge).
3. **Weakest numbers in this annex** (re-measure before freezing): cello
   A0/B1 exact Hz (C9), per-string bridge-force spectra (C23), vibrato
   onset-delay/ramp norms (C32), all NHR values (C16). Everything in §7a
   marked ⊙ shares this status by design.
4. **Iowa corpus is senza vibrato**: every vibrato claim (C26–C32) must be
   fitted from the Philharmonia vibrato role only, per P3 routing; the AM
   assertion (7b `*.vibrato-body-am`) tests the *engine mechanism* with a
   synthetic vibrato render against the fitted body, so it stays valid on a
   senza-vibrato spectral corpus.
