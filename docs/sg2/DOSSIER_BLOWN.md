# SG2 construction dossier — blown instruments

Status: research verdict complete; checklist implemented in
`scripts/tone_match/assertions.py` (checklist version 1).

Scope: concert flute, B-flat clarinet, alto/tenor saxophone, trumpet, and French horn. The
word *conical* below describes an acoustic mode-series abstraction when it is
used as an SG2 enum. It must not be read as a claim that every centimetre of a
modern brass bore is a cone.

## 1. Mechanism to engine-stage mapping

| Instrument | EXCITOR | RESONATOR | BODY / radiation | Additive approximation and audible risk |
|---|---|---|---|---|
| Concert flute | Air jet oscillating at the embouchure edge; blowing pressure and jet delay control register and brightness | Approximately open cylindrical bore with a complete harmonic ladder | Open holes and embouchure radiation create a frequency-dependent cutoff and breath component | `blow` + SG2 `string` mode ratios, whose UI label is “String / open tube”. The ratio law is correct for the open-pipe abstraction; breath noise and register-dependent spectra remain separately fitted. |
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
  passive impedance inharmonicity as string `B`.
- **Continuous drive, not free decay.** A held air jet, reed or lip valve keeps
  supplying energy throughout the note. The renderer must therefore retain
  its driven upper modes during sustain; frequency-dependent free-decay laws
  apply to impulse-driven strike/pluck notes, not to a held wind tone. The
  sustained/full-series/dynamic gates jointly catch this construction error.
- **Acceptance values not redefined here.** Partial, mel, attack, vibrato and
  resource limits remain the per-register §3 tripwires. This dossier adds
  topology and cross-register/dynamic gates; it does not weaken those limits.

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
| Clarinet | `clarinet.excitor` | `excitationType = blow` |
|  | `clarinet.resonator` | `resonatorClass = closedTube` |
|  | `clarinet.low-odd-series` | Low-register even modes average at least 6 dB below odd neighbours |
|  | `clarinet.register-even-rise` | High-minus-low even/odd contrast rises at least 3 dB |
|  | `clarinet.dynamic-brightening` | Upper-partial index slope is positive with velocity |
| Alto sax | `alto-sax.excitor`, `alto-sax.resonator` | Blown, full-series/conical mode class |
|  | `alto-sax.full-series` | Even modes are not suppressed like a low clarinet |
|  | `alto-sax.dynamic-brightening` | Louder notes are spectrally brighter |
|  | `alto-sax.blare-law` | Nonlinear curvature is explicitly fitted, not hidden in one table |
| Tenor sax | Corresponding `tenor-sax.*` IDs | Same physics; the modelling-synth reference remains permitted by §9.4 |
| Trumpet | `trumpet.excitor`, `trumpet.resonator` | Lip-reed approximation and SG2 full-series class |
|  | `trumpet.full-series`, `trumpet.dynamic-brightening`, `trumpet.blare-law` | Complete series and nonlinear forte enrichment |
| French horn | Corresponding `french-horn.*` IDs | Full series, sustained drive, and fitted nonlinear dynamic response |

`conicalTube` in the trumpet/horn assertion means “SG2 full-series wind
resonator”. A future enum rename would be semantically cleaner, but is not an
acoustic blocker because its implemented frequency law is the required one.

## 5. Verdict on the §6 backlog

| Gap | Verdict | Consequence |
|---|---|---|
| G1 register-dependent spectra | **Confirmed.** Clarinet odd/even balance changes across the break; sax high-range behaviour also cannot be one table. | Per-register tables are mandatory and their transitions are checked in the campaign. |
| G2 conical bore class | **Confirmed for sax; amended for brass.** Full-series behaviour is correct, but modern trumpet/horn are compound bores, not ideal cones. | Keep the full-series law. Treat `conicalTube` as an acoustic abstraction for brass and do not cite it as literal geometry. Clarinet must remain `closedTube`. |
| G2 closed-tube output mapping | **Amended.** The clarinet's passive bore resonances favour 1:3:5…, but deleting even radiated harmonics contradicts the cited high-register spectra and misindexes measured harmonic tables. | Retain `closedTube` as construction metadata and its passive `resonatorRatio`; render measured tables on integer `outputPartialRatio` harmonics so their register-dependent odd/even levels remain physically possible. |
| G3 nonlinear dynamic brightening | **Confirmed.** Brass nonlinear propagation produces upper-spectrum enrichment with level. | `dynamicBlare > 0` plus measured dynamic brightening are hard gates for trumpet/horn and the sax interim fits. |
| G5 attack stagger | **Confirmed as already landed.** Tonguing/reed and lip attacks are frequency-dependent and cannot be replaced by one gain ramp. | Measure and retain transient-band timing; no new engine work from WP-R. |
| Renderer audit: free decay under continuous drive | **Rejected.** Applying the struck/plucked material-decay envelope during a held wind note extinguishes upper modes despite ongoing excitation. | Gate material free decay to impulse-driven excitation; retain the normal note-release envelope for wind notes. |
| Missing gap | **No new pre-fit engine gap.** Full reed/lip–bore feedback and sax altissimo tract coupling are real, but the present campaign covers dry, standard-range sustained notes. | If residuals localise to attack instability or altissimo rather than fitted params, file a bounded model gap; do not widen the optimiser to disguise it. |

Verdict: the existing G2/G3 laws are justified, with the stated semantic
amendment. WP-5 may begin once WP-3 produces strict register/dynamic manifests.
