# SG2 construction dossier — blown instruments

Status: research verdict complete; checklist implemented in
`scripts/tone_match/assertions.py` (checklist version 3; flute consumer rows
pending T-016 analysis incorporation).

Scope: concert flute, B-flat clarinet, alto/tenor saxophone, trumpet, and French horn. The
word *conical* below describes an acoustic mode-series abstraction when it is
used as an SG2 enum. It must not be read as a claim that every centimetre of a
modern brass bore is a cone.

## 1. Mechanism to engine-stage mapping

| Instrument | EXCITOR | RESONATOR | BODY / radiation | Additive approximation and audible risk |
|---|---|---|---|---|
| Concert flute | Air jet oscillating at the embouchure edge; blowing pressure and jet delay control register and brightness | Approximately open cylindrical bore with a complete harmonic ladder | Open holes and embouchure radiation create a frequency-dependent cutoff and breath component | `blow` + SG2 `openTube` mode ratios. The explicit enum separates the physically correct open-pipe construction from the mathematically identical string/full-series ratio law; breath noise and register-dependent spectra remain separately fitted. |
| Clarinet | Pressure-controlled single reed; reed-flow nonlinearity creates harmonics | Approximately closed cylindrical bore; passive modes favour 1:3:5… and the second register is reached at the twelfth | Tone-hole lattice, bell and radiation cutoff shape the envelope | `blow` + `closedTube`. The passive bore-mode law and radiated output must remain distinct: reed nonlinearity produces an integer harmonic output including even partials, especially above the break. A single harmonic table cannot cover chalumeau and clarino; register tables are mandatory. Attack/tonguing and player-tract coupling are reduced to transient/noise controls. |
| Alto/tenor sax | Pressure-controlled single reed | Truncated, approximately conical bore with an octave register relation and a full mode series | Large cone/bell radiates high frequencies efficiently; tone holes change the effective bore | `blow` + `conicalTube`. This is structurally distinct from clarinet. Additive modes approximate reed/bore locking but not altissimo tract coupling; the shipped range must remain inside the reference evidence. |
| Trumpet | Self-oscillating lip reed driven by mouth pressure | Compound mouthpiece–leadpipe–mostly narrow tube–bell system; playable resonances approximate a full harmonic ladder over the normal range | Bell radiation and high-amplitude nonlinear propagation strongly affect brightness | `blow` + SG2 `conicalTube` as the available **full-series** abstraction, not a literal geometry label. The missing lip-valve feedback is audible in attacks and extreme forte, so those residuals may not be buried in a partial table. |
| French horn | Lip reed, small mouthpiece, pressure/embouchure controlled | Long compound bore whose usable resonances are closely spaced in the normal register | Large flared, rear-facing bell; hand position and room reflection alter radiation | `blow` + SG2 full-series abstraction. The additive model covers steady held tones; hand-stopping and room directionality are outside this dry-note campaign. |

The pipe distinction is not cosmetic. UNSW measurements compare a conical
duct/saxophone with a cylindrical clarinet, and their pipe treatment derives a
complete low-order series for a cone versus the odd series of a closed
cylinder ([measured impedance comparison](https://phys.unsw.edu.au/jw/acoustic-impedance-measurement.html),
[cylindrical and conical pipes](https://phys.unsw.edu.au/jw/pipes.html)). The
saxophone bore is approximately conical and its first two resonances are close
to 2:1, whereas the clarinet's are near 3:1
([UNSW cutoff comparison](https://www.phys.unsw.edu.au/jw/cutoff.html)).
For flute, the open-bore resonances approximate integer multiples while the
air jet supplies the self-sustaining nonlinear excitor; the measured spectrum
changes substantially with blowing pressure and register
([UNSW flute acoustics](https://newt.phys.unsw.edu.au/jw/fluteacoustics.html)).

Modern brass is compound rather than ideal-conical. UNSW describes trumpet,
trombone and horn as long narrow tubing plus flare and shows why their usable
resonances nevertheless approach a harmonic ladder
([brass acoustics](https://www.phys.unsw.edu.au/jw/brassacoustics.html)). Thus
G2's frequency law is useful for brass, but the enum name is an abstraction.

## 2. Quantitative signatures used in fitting

- **Clarinet register law.** In the low register, first/third are strong and
  second/fourth weak; the systematic odd/even pattern does not hold in the
  clarino register. Louder reed motion generates more harmonics
  ([UNSW clarinet spectra](https://newt.phys.unsw.edu.au/jw/clarinetacoustics.html)).
  The gate therefore measures an odd-neighbour contrast of at least 6 dB in
  the low register and requires the even-partial contrast to rise by at least
  3 dB above the break. The plan's illustrative 20 dB value is **not adopted**
  as a universal absolute law: the cited measurements support “weak”, not a
  player- and fingering-independent 20 dB.
- **Sax register law.** The low-order impedance peaks approximate the complete
  series; the mouthpiece compensates the missing cone apex at low frequency,
  while the approximation deteriorates at high frequency
  ([UNSW inharmonic resonances](https://www.phys.unsw.edu.au/jw/inharmonic-resonances.html)).
  Even modes must therefore remain present; the gate rejects an average
  even/odd-neighbour deficit worse than 12 dB.
- **Bore/radiation limits.** Saxophone high-frequency bore resonances weaken
  because the cone radiates efficiently; altissimo requires strong vocal-tract
  tuning by expert players
  ([UNSW sax/tract study](https://www.phys.unsw.edu.au/~jw/SaxTract.html)).
  No preset may “repair” that range by extrapolating a low-register table.
- **Brass dynamics.** High internal pressures produce nonlinear propagation,
  transferring energy upward and, at extremes, shock-like waveforms. The
  effect is strongest in long narrow trumpet/trombone bores
  ([UNSW brass acoustics](https://www.phys.unsw.edu.au/jw/brassacoustics.html),
  [Campbell, *Why do brass instruments sound brassy?*](https://www.ioa.org.uk/system/files/proceedings/dm_campbell_why_do_brass_instruments_sound_brassy.pdf)).
  All wind/brass campaign grids must show rising upper-partial spectral index
  from soft to loud; brass must also opt into `dynamicBlare`.
- **Steady-note harmonicity.** Reed/lip oscillation mode-locks steady output
  close to a harmonic spectrum even though passive bore resonances are not
  perfectly harmonic ([UNSW harmonics](https://phys.unsw.edu.au/jw/harmonics.html)).
  The scorer checks output f0 against the paired reference rather than fitting
  passive impedance inharmonicity as string `B`. The analyser's estimated B
  remains in reports for diagnosis but has zero composite weight for the blown
  family, so noisy B estimates cannot reward nonphysical preset detuning.
- **Continuous drive, not free decay.** A held air jet, reed or lip valve keeps
  supplying energy throughout the note. The renderer must therefore retain
  its driven upper modes during sustain; frequency-dependent free-decay laws
  apply to impulse-driven strike/pluck notes, not to a held wind tone. The
  sustained/full-series/dynamic gates jointly catch this construction error.
- **Acceptance values not redefined here.** Partial, mel, attack, vibrato and
  resource limits remain the per-register §3 tripwires. This dossier adds
  topology and cross-register/dynamic gates; it does not weaken those limits.
- **Onset pitch and articulation.** Controlled clarinet experiments show that
  tongue release changes airflow abruptly, stronger tongue action starts notes
  sooner, and greater tongue force raises the third harmonic during the
  transient ([Li et al., JASA 2016](https://pubmed.ncbi.nlm.nih.gov/27586739/)).
  Player measurements also show that tonguing and mouth-pressure gestures vary
  by articulation and dynamic rather than forming one constant onset
  ([Pàmies-Vilà et al., 2018](https://pubmed.ncbi.nlm.nih.gov/29760672/)). An
  older time-frequency study measured trumpet attack pitch about 2% below the
  steady state and materially different attack durations for trumpet and
  trombone
  ([JASJ 1977](https://www.jstage.jst.go.jp/article/jasj/33/6/33_KJ00001454408/_article/-char/en)).
  These results **confirm** that onset f0 and plosive spectrum/timing must be
  measured jointly and distributed per note. They do **not** establish a
  universal geometry-only scoop law. The owner's refined hypothesis separates
  two effects: within one instrument, soft/breath-started underplaying can
  scoop more than a firmly articulated loud onset; across instruments, a large
  instrument with a higher practical pianissimo pressure/SPL threshold may
  retain a larger imperfection even in its soft register. These are therefore
  **amended to fitted hypotheses**: the per-instrument depth and neutral
  register/dynamic slopes may become nonzero only when that corpus supports the
  magnitude and sign. The owner's proposed plosive↔scoop inverse relation is
  likewise a plausible shared-control hypothesis, not a literature-derived
  constant; each brass campaign must demonstrate the anticorrelation in its
  own tracked onsets.

## 3. Controls exposed by professional modellers

Audio Modeling's current SWAM woodwind manual exposes continuous expression,
note transition behaviour, vibrato, breath/noise, formant/timbre controls,
instrument-specific harmonic structure, growl/flutter and key noise rather
than offering only an EQ preset
([SWAM Solo Woodwinds manual](https://static.audiomodeling.com/manuals/woodwinds/SWAM%20Solo%20Woodwinds%20v3.8.0%20-%20User%20Manual.pdf)).
This independently supports SG2 keeping expression/dynamics, attack,
vibrato, breath colour, body/formant and register structure as separate
controls. It does **not** justify exposing the internal bore enum as a casual
top-level timbre knob; that remains construction metadata/Advanced.

For WP-9, the likely performer-facing set is expression/dynamic, transition or
attack, vibrato depth/rate, breath amount/colour and a bounded timbre/formant
control. `resonatorClass`, register tables and blare curvature remain Advanced
unless the sensitivity/spread ledger proves otherwise.

## 4. Executable construction checklist

Every instrument also inherits `register-coverage`, `dynamic-coverage`,
`pitch-lock`, and `sustained-envelope`. Campaign mode is strict: missing
register/dynamic labels fail rather than skip.

| Instrument | Assertion ID | Required fact |
|---|---|---|
| Every covered blown instrument | `<instrument>.measured-body` | At least three non-neutral fixed-Hz body bands, fitted from that instrument's own corpus and spanning at least one octave |
| Concert flute | `flute.excitor`, `flute.resonator` | Air-jet blown excitation and the explicit open cylindrical full-series class |
|  | `flute.dynamic-brightening`, `flute.envelope-peak` | Louder playing brightens; soft peak is at or below 500 Hz and loud peak is in the 500–1000 Hz octave region |
|  | `flute.air-jet-breath-law` | The rendered Fourier path consumes non-zero fitted breath and continuous turbulence rather than silently dropping `toneBreath` |
|  | `flute.body-stability` | A non-minimal fixed body requires split-half correlation at least 0.80 and peak agreement within one third octave; otherwise `unstable-air-jet-body` explicitly omits it |
| Clarinet | `clarinet.excitor` | `excitationType = blow` |
|  | `clarinet.resonator` | `resonatorClass = closedTube` |
|  | `clarinet.low-odd-series` | Low-register even modes average at least 6 dB below odd neighbours |
|  | `clarinet.register-even-rise` | High-minus-low even/odd contrast rises at least 3 dB |
|  | `clarinet.dynamic-brightening` | Upper-partial index slope is positive with velocity |
| Alto sax | `alto-sax.excitor`, `alto-sax.resonator` | Blown, full-series/conical mode class |
|  | `alto-sax.full-series` | Even modes are not suppressed like a low clarinet |
|  | `alto-sax.dynamic-brightening` | Louder notes are spectrally brighter |
|  | `alto-sax.blare-law` | Nonlinear curvature is explicitly fitted, not hidden in one table |
|  | `alto-sax.soft-breath-law` | The pp air/tone ratio uses a fitted sublinear velocity law |
|  | `alto-sax.turbulence-law`, `alto-sax.body-coloured-air` | Sustained air has continuous texture and shares the fitted body colour |
|  | `alto-sax.onset-spectrum-law` | A short-lived harmonic onset print settles into the sustained print |
| Tenor sax | Corresponding `tenor-sax.*` IDs | Same physics; the modelling-synth reference remains permitted by §9.4 |
| Trumpet | `trumpet.excitor`, `trumpet.resonator` | Lip-reed approximation and SG2 full-series class |
|  | `trumpet.full-series`, `trumpet.dynamic-brightening`, `trumpet.blare-law` | Complete series and nonlinear forte enrichment |
| French horn | Corresponding `french-horn.*` IDs | Full series, sustained drive, and fitted nonlinear dynamic response |
|  | `french-horn.coupled-articulation-law`, `french-horn.articulation-anticorrelation` | A fitted seeded articulation distribution jointly controls plosive, breath lead and pitch scoop; WP-3 retains at least four tracked reference onsets with transient-energy versus scoop-depth Pearson `r <= -0.2` |
|  | `french-horn.independent-onset` | The measured fast lip transient is independently enveloped rather than suppressed by the sustained-note ADSR |
|  | `french-horn.soft-onset-law` | Soft attacks retain a measurable lip transient instead of inheriting a fixed linear velocity attenuation |
|  | `french-horn.register-onset-law` | At least three measured onset-shape anchors prevent a low-register high-frequency transient from being reused in the mid/high register |
|  | `french-horn.register-envelope-law` | At least three fitted amplitude-envelope attack anchors preserve the measured low/mid/high timing transition |

`conicalTube` in the trumpet/horn assertion means “SG2 full-series wind
resonator”. A future enum rename would be semantically cleaner, but is not an
acoustic blocker because its implemented frequency law is the required one.

## 5. Verdict on the §6 backlog

| Gap | Verdict | Consequence |
|---|---|---|
| G1 register-dependent spectra | **Confirmed.** Clarinet odd/even balance changes across the break; sax high-range behaviour also cannot be one table. | Per-register tables are mandatory and their transitions are checked in the campaign. |
| G2 bore classes | **Confirmed for flute/sax; amended for brass.** Flute and sax share a full integer ladder but not a geometry: flute is an open cylinder, sax is approximately conical. Modern trumpet/horn are compound bores. | Keep the common full-series law behind explicit `openTube` and `conicalTube` construction labels. Treat `conicalTube` as an acoustic abstraction for brass and do not cite it as literal geometry. Clarinet remains `closedTube`. |
| G2 closed-tube output mapping | **Amended.** The clarinet's passive bore resonances favour 1:3:5…, but deleting even radiated harmonics contradicts the cited high-register spectra and misindexes measured harmonic tables. | Retain `closedTube` as construction metadata and its passive `resonatorRatio`; render measured tables on integer `outputPartialRatio` harmonics so their register-dependent odd/even levels remain physically possible. |
| G3 nonlinear dynamic brightening | **Confirmed.** Brass nonlinear propagation produces upper-spectrum enrichment with level. | `dynamicBlare > 0` plus measured dynamic brightening are hard gates for trumpet/horn and the sax interim fits. |
| G5 attack stagger | **Confirmed, then amended by WP-3 evidence.** Tonguing/reed and lip attacks are frequency-dependent and cannot be replaced by one gain ramp. The 110-note horn fit measured low→high spreads of 89.8 ms at 84 Hz, 127.2 ms at 256 Hz, and effectively zero (-1.9 ms, clamped by playback) at 533 Hz; the former single 96 ms aggregate erased this transition. | Retain `attack.byRegister` band timing and interpolate its stagger in log-f0, falling back to the aggregate only for legacy profiles. The law reduced the active horn loss from 2.370006 to 2.369664; the campaign remains open because mid-forte is still 1.5311× its measured variability floor. |
| Renderer audit: free decay under continuous drive | **Rejected.** Applying the struck/plucked material-decay envelope during a held wind note extinguishes upper modes despite ongoing excitation. | Gate material free decay to impulse-driven excitation; retain the normal note-release envelope for wind notes. |
| Renderer audit: fast onset through sustained ADSR | **Rejected for measured horn attacks.** A transient with its own 5 ms rise and measured decay was attenuated again by the much slower sustained-note ADSR, leaving the paired high-register onsets roughly an order of magnitude too weak. | Add neutral `attackNoiseDirect`; keep `0` bit-compatible and require the horn fit to opt in before its construction gate can pass. |
| Renderer audit: linear onset-noise velocity | **Amended for horn.** Both Iowa and Philharmonia soft high-register takes retain a clear transient, while the legacy `level × velocity` law removes 80% at the campaign's `pp` point before the onset envelope is applied. | Add neutral `attackNoiseVelocityExponent` (`1` = legacy); require the horn fit to demonstrate a sub-linear soft-onset law rather than overdriving every dynamic with one level. |
| Renderer audit: pinned transient shape | **Rejected as previously wired.** WP-3 stored measured onset frequency, Q, and decay in each campaign seed, but the renderer silently reloaded the aggregate profile transient and consumed only the free level control. | Make explicit `attackNoiseFreq`, `attackNoiseQ`, and `attackNoiseDecay` win over the profile fallback; absent fields remain exactly legacy. Keep all three pinned during fitting. |
| Scorer audit: stiff-string B on blown tones | **Rejected.** The generic analyser can estimate a small, unstable B from a wind spectrum, but that number is neither the passive bore impedance nor a valid target for mode-locked radiated output. A horn grid falsely preferred constant B solely by reducing this residual. | Retain the diagnostic, set its composite weight to zero for the blown family, and version the reference-set objective with its weight policy. |
| WP-3 audit: spectral notes below 100 Hz | **Rejected.** The analyser accepts f0 down to 40 Hz, but aggregation discarded every spectral note below 100 Hz. This removed 26 valid horn observations and left its lowest register anchor at 163 Hz while WP-5 scores B1 near 62 Hz. | Align aggregation with the analyser's 40 Hz validity bound and regenerate affected multi-register fits; never substitute a mid-low table for an evidenced practical low register. |
| Horn residual: one onset shape for every register | **Rejected.** Paired B1 takes place their small non-harmonic residual near 6–7 kHz, while C4/C5 attacks centre roughly 0.4–0.9 kHz at materially higher relative level. A global 350 Hz fit improved total loss but could not close the low-soft or mid-forte floors. | Add neutral structured `attackNoiseByRegister` anchors, interpolated in log-f0; require three anchors in the horn construction checklist and keep the global fields as legacy fallback. |
| Horn residual: one amplitude-envelope attack for every register | **Rejected.** WP-3 measured mean attack values of 134.7 ms, 134.7 ms, and 57.4 ms at the low/mid/high register anchors. Forcing one global value discards this evidence. | Add neutral `envelopeAttackByRegister` interpolation and require three anchors. A fitted 45% blend from the former 160 ms global value toward those measured anchors reduced active horn loss from 2.3692 to 2.3551; mid-forte remains above floor, so the campaign is not frozen. |
| Scorer audit: missing sub-audible transient | **Rejected.** When the analyser found no burst in a render and only a ~0.01% residual in its reference, the noise feature substituted a 1 Hz centre and charged a large octave error for two effectively silent events. | Floor attack/sustain level at 0.1% and compare transient centre only when both sides clear that floor; do not hide audible level differences. |
| Owner L1/L4: soft reed breath and air/tone fusion | **Confirmed.** The former blown-air floor used a fixed linear velocity factor and one static filter. Its relative pp level, texture, and coupling to the fitted body were not independently representable, and the scorer had no sustained noise/harmonic observable. | Add neutral `breathVelocityExponent`, `breathTurbulence`, `breathBodyAmount`, and `breathLevelScale`; measure sustained noise/harmonic density explicitly and require sax fits to opt into the evidenced laws. The shared note envelope continues to make airflow fade with the note. |
| Owner L4 follow-up: per-note breath gate | **Rejected.** A uniform random draw for `toneBreathLevel` can remove the air component from an otherwise equivalent blown note. That is an incoherent gate, not performance variation; the continuously driven blow-floor path is already the correct location for seeded Human texture. | For `excitationType = blow`, derive the base breath level deterministically and keep the existing seeded continuous turbulence trace. Human 0 remains exact. Non-blown legacy tone-colour draws are unchanged. |
| Owner L2: onset harmonic colour | **Confirmed.** Filtered attack noise and per-band timing cannot change the harmonic partial weighting for the first 30–80 ms. | Add neutral `onsetSpectrumTilt` plus its settling time, and score onset-to-sustain harmonic tilt explicitly. Sax construction requires a non-neutral fitted onset print. |
| Owner L5: deterministic onset scoop | **Rejected.** Published trumpet analysis and the owner-reviewed horn pairs show onset pitch can approach the steady target, while articulation studies show player controls alter onset timing and spectrum. One class constant on every detached note cannot represent either distribution or phrase position. | Measure `onsetScoopDepthCents` and settle time from the f0 track; fit per-instrument depth/distribution, reduce re-articulated notes, and keep legato at exactly zero. The legacy class table remains only as compatibility fallback until a preset is refitted. |
| Owner L5 Human/instrument/dynamic scaling | **Amended to a corpus-tested two-level hypothesis.** Scoop is a human imperfection: a precise player/strong tongue strives to hit pitch directly. Within an instrument, soft breath-started underplaying is expected to scoop more; across instruments, a larger instrument's higher practical pianissimo pressure/SPL threshold may raise its fitted depth. The cited work supports condition-dependent onset behaviour but not a geometry-only formula. | Multiply fitted scoop by `excitationHuman` so Human 0 is exact. Fit a normally negative within-instrument velocity slope and the depth separately per instrument; enable register slope only from evidence. Geometry alone is not a construction assertion. |
| Owner L5b plosive↔scoop coupling | **Confirmed for horn, not generalized.** Tongue/blowing controls jointly affect flow, onset time and transient harmonics, so independent random draws can create mechanically incoherent combinations. Leakage-controlled reanalysis found 110 tracked horn onsets with transient-energy versus scoop-depth `r = -0.2553`, but 107 trumpet onsets gave only `r = -0.0136`. | Use one seeded `articulationStrength` draw for horn plosive gain, breath lead and scoop suppression and require the retained WP-3 reference evidence to have `r <= -0.2`. Do not impose that gate on trumpet: its coupling remains neutral unless a future take set demonstrates it. |
| Owner L6: measured body absent / borrowed body | **Confirmed.** A harmonic-rank table moves with f0 and therefore cannot by itself represent a fixed-Hz body envelope. Borrowing clarinet bands for sax or trombone bands for horn can preserve the excitor while losing the instrument's midrange identity. | WP-3 alternately fits partial-rank excitation, note level, and a smooth absolute-frequency envelope; it stores the latter as measured `resonances` and divides it out before refitting partial tables. Campaign seeds pin those body bands at full reconstruction strength, and `<instrument>.measured-body` fails any covered blown preset that lacks its own evidence. |
| Remaining model boundary | **Amended.** Full reed/lip–bore feedback and sax altissimo tract coupling remain outside the current standard-range sustained-note evidence. | If post-L1/L2 residuals localise to feedback instability or altissimo, file that bounded gap; do not widen unrelated parameters to disguise it. |

Verdict: the existing G2/G3 laws are justified, with the stated semantic
amendment. WP-5 may begin once WP-3 produces strict register/dynamic manifests.
