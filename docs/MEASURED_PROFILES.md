# Measured instrument profiles

Fitted parameters for the tone model in `web/static/synth.js`, derived from
real instrument recordings by `scripts/fit_profiles_from_samples.py`.
Machine-readable output: `web/static/measured_profiles.json`.
**No audio ships with the repo** — only fitted parameters. Analysis ran over
a small download set (~100 MB) under `/private/tmp/sample-fit/`.

## Reproduction

```bash
python3 -m venv /private/tmp/sample-fit/venv
/private/tmp/sample-fit/venv/bin/pip install numpy scipy soundfile
# lay out samples as <dir>/<instrument>/*.aiff|mp3 (multi-note chromatic
# run files are auto-segmented; "vib"-named files feed only the vibrato
# analysis, "nonvib"/"non-vibrato" only the spectral analyses)
/private/tmp/sample-fit/venv/bin/python scripts/fit_profiles_from_samples.py \
    --samples /private/tmp/sample-fit/samples \
    --out web/static/measured_profiles.json
```

## Sources and licences

| Source | Used for | Licence |
|---|---|---|
| University of Iowa EMS, Musical Instrument Samples (theremin.music.uiowa.edu) | All spectral / envelope / attack / inharmonicity / T60 measurements (mf, anechoic chamber, Neumann KM 84) | Free and unrestricted use (stated on the MIS site) |
| Philharmonia Orchestra sound samples (philharmonia.co.uk) | Violin and cello **vibrato statistics only** (Iowa pre-2012 arco is played senza vibrato) | Free to use in your own projects (Philharmonia sound-samples terms) |
| VSCO 2 Community Edition (CC0) | Checked; not needed (no solo voice either) | CC0 |

**Vocal: not measured.** None of the three preferred sources contains solo
sung vowels: Iowa MIS has no voice, Philharmonia is orchestral instruments
only, and VSCO 2 CE contains brass/keys/percussion/strings/winds only.
Free solo-voice datasets that do exist (e.g. VocalSet, ~3 GB on Zenodo)
exceeded the download budget and licence-verification effort for this pass.
The existing hand-tuned `vocal` profile in `synth.js` is unchanged.

## What each fitted field means (engine mapping)

* `partials[n].amp` — median across the analysed notes (an octave around
  C4/A4 at mf) of the FFT peak amplitude at partial *n*, per-note normalised
  so the strongest partial is 1. Matches `SPECTRAL_PROFILES[].partials[].amp`.
* `partials[n].spread` — the engine draws `A_n ~ N(amp, amp·spread·0.5)`,
  so spread = 2 × relative sd. Estimated from successive log-amplitude
  differences between pitch-adjacent takes (kills smooth register trends);
  clipped to [0.08, 0.8]. Where fewer than 4 takes detected a partial, the
  engine's tail rule (+0.04 per stride-2 step) fills the gap.
* `partialB` — least-squares fit of measured partial frequencies to
  `f_n = n·f0·√((1+B·n²)/(1+B))` (`partialFrequency()` in synth.js);
  two-stage fit so mis-picked peaks can't drag B to zero. Preset value is
  the mid-register median; per-note values in `partialBByNote`.
* `material.t60Ref`, `material.slope` — Theil–Sen fit of per-partial decay
  times to `T60(f) = t60Ref·(f/261.63 Hz)^(−slope)` (`materialT60()`).
  `suggestedMaterial` is the m ∈ [0,1] whose engine curve
  (glass 7.0 s/0.25 … felt 0.55 s/1.35, log-interpolated) best matches the
  measured points.
* `performance.attackNoise` — non-harmonic onset energy: spectral centroid
  → `freq`; `q` = centroid / (2.355·spectral spread) (−3 dB-equivalent);
  `decay` from the transient's dB/s slope (time to fall 50 dB, the engine's
  ramp depth); `level` = 10 × (transient/sustain RMS ratio), a crude
  calibration into the engine's burst-peak units — the raw ratio is kept as
  `measuredLevelRatio`.
* `performance.envelope*` — RMS-envelope statistics (see per-instrument
  notes and Limitations).
* `performance.vibrato*` — rate = modulation-spectrum peak (3–9 Hz) of the
  f0 track; depth = √2·sd of the detrended cents track (≈ peak deviation).
* `attack.bandT90ms` — time from onset to 90 % of each octave band's
  early-sustain level (percussive: its own peak); `lowToHighStaggerMs` =
  mean of the two highest carrying bands minus mean of the two lowest.

## Results

One line per instrument (details below):

| Instrument | Notes | B (mid) | T60 fit (ref s @C4, slope) | m* | ADSR (A/D/S/R) | Vibrato (Hz, ±cents) | attackNoise (level, Hz, Q, s) | Stagger low→high |
|---|---|---|---|---|---|---|---|---|
| flute | 13 (B3–B4 mf) | ≈0 | 0.15, −0.35 (release) | 0.50† | 0.32/0/0.95/0.12 | 4.7, 13.5 | 0.10, 2566, 1.2, 0.145 | +49 ms |
| clarinet | 12 (C4–B4 mf) | ≈0 | 0.10, −0.54 (release) | 0.39† | 0.10/0/0.96/0.09 | none (prob 0) | 0.05, 2520, 1.35, 0.148 | +77 ms |
| violin | 15 (B3–B4 mf) | ≈0 | 1.62, −0.05 (release) | 0.06† | 0.46/0/0.97/0.96 | 5.7, 25.3 | 0.09, 1000, 0.84, 0.194 | +161 ms |
| cello | 22 (D3–B4 mf) | ≈0 | 0.73, +0.33 (release) | 0.49† | 0.50/0.10/0.85/0.34 | 5.3, 10.8 | 0.40, 1557, 0.97, 0.169 | −7 ms |
| trumpet | 12 (C4–B4 mf) | ≈0 | 0.11, −0.53 (release) | 0.31† | 0.20/0/0.93/0.18 | 4.9, 6.7 | 0.60, 1419, 1.76, 0.102 | +172 ms |
| trombone | 24 (C3–B4 mf) | ≈0 | 0.14, −0.60 (release) | 0.35† | 0.32/0/0.94/0.31 | none (prob 0) | 0.17, 653, 1.26, 0.190 | +22 ms |
| piano | 4 (C2,B3,C4,A4 mf) | **3.6e−4** | **12.3, +0.41 (struck decay)** | 0.0 | 0.016/–/0.085@1s/9.7 | none | 0.60, 525, 0.86, 0.25* | −11 ms |
| vocal | — | — | — | — | — | — | — | not measured |

† Sustained instruments: T60 comes from player-damped release tails — a
lower bound on free decay, and the material mapping is weak evidence.
\* Clipped at the estimator bound.

---

### Flute (Iowa MIS, `Flute.nonvib.mf.B3B4` + `Flute.vib.mf.B3B4`)

First 16 partial amps (median over 13 notes B3–B4):

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 0.858 1.000 0.615 0.154 0.111 0.157 0.026 0.023 0.022 0.008 0.007 0.007 0.004 0.003 0.002 0.002
spr 0.32  0.18  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.43  0.80  0.58  0.80
```

Tail slope (n ≥ 8): −13.3 dB/oct. Note: in the first octave the flute's
**2nd harmonic rivals or exceeds the fundamental** — quite different from
the hand-tuned profile's dominant fundamental (that profile reads more like
a high-register flute).

* B ≈ 0 (per-note values ≤ 1e−5 — measurement noise; open tube, as expected).
* Vibrato (from the vib takes): 4.70 ± 0.15 Hz, depth 13.5 ± 5.2 cents.
* attackNoise: centroid 2566 Hz (breath chiff), Q 1.2, decay 0.145 s,
  measured transient/sustain ratio 0.010 → level 0.10.
* Attack stagger +49 ms (upper octave bands settle after the low ones).
* ADSR: attack 0.32 ± 0.08 s to the early-stable level (see Limitations —
  these are gently-started sustained tones), sustain 0.95, release 0.12 s.

### Clarinet (Iowa MIS, `BbClar.mf.C4B4`)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 1.000 0.025 0.585 0.062 0.090 0.036 0.021 0.008 0.005 0.005 0.003 0.003 0.002 0.003 0.001 0.002
spr 0.08  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80
```

Textbook odd-harmonic dominance (even partials 20–40× weaker than their odd
neighbours through n≈6); tail −10.9 dB/oct. The measured even/odd contrast
is much deeper than the hand-tuned profile's. Fundamental extremely stable
across takes (spread at the 0.08 floor). No vibrato detected on any note
(prob 0 — matches clarinet tradition). Attack 0.10 s, the fastest of the
sustained winds here; attackNoise 2520 Hz, very quiet (ratio 0.004);
stagger +77 ms.

### Violin (Iowa MIS arco senza vibrato; Philharmonia molto-vibrato for vibrato)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 1.000 0.394 0.144 0.203 0.105 0.081 0.048 0.033 0.043 0.034 0.017 0.018 0.009 0.006 0.005 0.003
spr 0.54  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80  0.80
```

Tail −15.9 dB/oct. Note-to-note spread saturates the 0.8 cap for most
partials: on the G string the body resonances re-weight partials strongly
between adjacent semitones, and the estimator cannot fully separate that
from take variability. B ≈ 0.

* Vibrato (Philharmonia `molto-vibrato`, 4 notes G4–C5): 5.74 ± 0.14 Hz,
  depth 25.3 ± 4.1 cents. (Iowa arco takes measure ~1 cent — played straight,
  which is why the Philharmonia set was added.)
* attackNoise: 1000 Hz centroid, Q 0.84 (broad bow scratch), ratio 0.009.
* Stagger +161 ms; ADSR attack 0.46 ± 0.11 s (slow bow starts, see
  Limitations), release 0.96 s (open-string/body ring after bow lift).

### Cello (Iowa MIS arco; Philharmonia arco-normal for vibrato)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 0.788 1.000 0.479 0.271 0.410 0.195 0.175 0.085 0.077 0.040 0.032 0.020 0.018 0.013 0.007 0.007
spr 0.80 (saturated for all shown partials — same body-resonance caveat as violin)
```

Tail −14.0 dB/oct; strong 2nd harmonic (wolf-region body coupling), local
bump at n=5. B ≈ 0. Vibrato (Philharmonia, 8 short notes, 4 detected):
5.28 Hz, depth 10.8 ± 7.1 cents (short 1.5 s takes — depth varies a lot).
attackNoise 1557 Hz, ratio 0.040 → level 0.40, the scratchiest onset of the
strings/winds set. Stagger ≈ 0 (−7 ms). Attack 0.50 ± 0.04 s (gentle Iowa
bow starts), decay 0.10 to sustain 0.85, release 0.34 s.

### Trumpet (Iowa MIS, `Trumpet.novib.mf.C4B4` + vib takes)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 0.277 0.507 1.000 0.872 0.568 0.388 0.221 0.115 0.073 0.046 0.030 0.020 0.011 0.007 0.005 0.004
spr 0.34  0.18  0.24  0.22  0.38  0.37  0.34  0.32  0.31  0.41  0.43  0.51  0.53  0.53  0.78  0.65
```

Spectral peak at n=3 (~780 Hz), tail −25.5 dB/oct — close in shape to the
hand-tuned profile but with a weaker fundamental (0.28 vs 0.58). Spread
well-measured here (0.2–0.5, rising with n). B ≈ 0. Vibrato (vib takes):
4.85 ± 0.10 Hz, 6.7 ± 1.3 cents — light, as expected for trumpet.
attackNoise 1419 Hz, Q 1.76, ratio 0.124 (strong lip transient) → level
clipped at 0.6, decay 0.10 s. Stagger +172 ms: the top of the brass
spectrum blooms noticeably after the onset as the player's dynamic settles.

### Trombone (Iowa MIS, `TenorTrombone.mf.C3B3` + `C4B4`)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 0.699 0.992 1.000 0.817 0.574 0.443 0.283 0.196 0.142 0.101 0.070 0.051 0.037 0.026 0.018 0.012
spr 0.26  0.23  0.27  0.33  0.38  0.40  0.42  0.45  0.42  0.56  0.44  0.46  0.50  0.71  0.59  0.63
```

Broad peak across n=2–3, tail −26.3 dB/oct; agrees well with the hand-tuned
table (which peaks at n=2). 24 notes over two octaves (C3–B4) — the widest
register pool here, so amp values average over more register change than
the other instruments. B ≈ 0. No vibrato detected (prob 0 on ordinary
takes). attackNoise 653 Hz (low buzz), decay 0.19 s, ratio 0.017.
Stagger +22 ms. Attack 0.32 ± 0.05 s.

### Piano (Iowa MIS, `Piano.mf.C2/B3/C4/A4`)

```
n     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16
amp 1.000 0.466 0.201 0.082 0.052 0.108 0.082 0.012 0.005 0.002 0.004 0.001 0.001 0.001 0.000 0.000
spr 0.29  0.33  0.33  0.37  0.37  0.41  0.41  0.45  0.45  0.49  0.49  0.53  0.53  0.57  0.57  0.61
```

(amp table from the three mid-register notes; C2 excluded from it but used
for B and T60. spread mostly engine-extrapolated — only 3 takes.)

* **Inharmonicity** — the headline measurement. Textbook stiff-string
  progression: C2 B=1.4e−4, B3 B=3.3e−4, C4 B=3.6e−4, A4 B=7.3e−4.
  Suggested preset `partialB = 3.6e−4` (mid-register) — the engine's current
  hand-set 1.2e−4 is ~3× too low for a C4 reference.
* **T60**: struck free decay, first-25-dB estimator, Theil–Sen fit over 69
  partial measurements 66 Hz–3.6 kHz: `t60Ref = 12.3 s`, `slope = 0.41`.
  A real piano rings far longer than any engine material can express
  (glass anchor = 7.0 s), hence `suggestedMaterial = 0.0` with residual
  error. The engine's preset (0.7 → 1.2 s at C4) is a deliberate
  playability choice, not a measurement.
* ADSR: attack 16 ± 8 ms (RMS-window-limited; true hammer contact is
  faster), sustain 0.085 = envelope level 1 s after the strike peak (decay
  fixed at 1.0 s by that definition), "release" 9.7 s = the undamped ring
  from −20 dB to the noise floor — these notes are held, so no damper
  release was measurable.
* attackNoise: 525 Hz thump, ratio 1.18 (the onset is mostly transient) —
  level and decay both clipped at estimator bounds (0.6, 0.25 s).
* Stagger −11 ms: the top arrives marginally EARLIER (hammer transient).

### Vocal — not measured

No solo-voice source in Iowa MIS / Philharmonia / VSCO 2 CE (see Sources).
Existing hand-tuned values retained.

## Limitations (read before trusting numbers)

1. **Attack times reflect these performances, not the instruments' minimum
   speak time.** Iowa players ease into sustained mf notes; the measured
   0.1–0.5 s attacks are typical of that style. The engine presets
   (0.03–0.1 s) describe detached playing. Use the measured values for
   legato-feel presets; don't read them as physical speak times.
2. **T60 for sustained instruments comes from release tails**, which are
   damped by the player (bow stays on string, breath stops). They are lower
   bounds on free decay and give the material mapping only weak support.
   The piano fit is the only true free-decay measurement.
3. **`spread` conflates take-to-take variability with residual register
   dependence.** Notes span an octave (two for trombone); a successive-
   difference estimator removes smooth trends but not the violin/cello body
   resonances, whose partial weighting changes per semitone — hence the
   saturated 0.8 values for strings. Trumpet/trombone/piano spreads are the
   trustworthy ones.
4. **`attackNoise.level` calibration is crude** (ratio × 10 into engine
   burst-peak units); the measured RMS ratio is preserved alongside.
   The `decay` estimates for sustained instruments (0.10–0.19 s) include
   breath/bow noise that persists into the sustain and reads long.
5. **Vibrato probabilities are conditional** where measured on designated
   vibrato takes (flute, trumpet, violin, cello): they say "how deep/fast
   when vibrating", not how often a player vibrates. Clarinet/trombone
   prob 0 is a genuine observation on ordinary takes.
6. **Piano double decay** is summarised by a single exponential via a
   first-25-dB estimator; the fast early stage and the long aftersound are
   both real and neither is exactly this number. Beating between unison
   strings limits per-partial precision (hence robust fitting).
7. **Register averaging**: amp tables are medians over ~an octave, so they
   are a mid-register compromise, and the engine's Body stage re-shapes
   them by design. The mp3 (Philharmonia) files were used only for vibrato,
   where lossy coding is irrelevant.
8. Amplitudes above ~partial 40 for the higher notes exceed Nyquist or the
   anechoic noise floor and appear as 0 — genuine content up there is below
   measurement range anyway.
