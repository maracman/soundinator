# SG2 construction dossier — struck and plucked strings

Status: research verdict complete; checklist implemented in
`scripts/tone_match/assertions.py` (checklist version 3; L18 hold law and L17
pinned-component activation added in Pass 16).

Scope: acoustic piano and acoustic guitar, isolated dry notes.

## 1. Mechanism to engine-stage mapping

| Instrument | EXCITOR | RESONATOR | BODY / radiation | Additive approximation and audible risk |
|---|---|---|---|---|
| Piano | Velocity-dependent felt hammer contacts the string for a finite time; harder/faster contact transmits more high-frequency energy | One to three stiff strings per note, stretched partials, coupled polarisations and unison beating | Bridge/soundboard impedance sets frequency-dependent decay; duplex and sympathetic strings add aftersound | `strike` + `string`, measured `B`, velocity→hardness, per-register partials and two-stage decay. A single oscillator per mode does not reproduce every unison/polarisation exchange; double decay is the minimum structural proxy. |
| Guitar | Finger/nail/plectrum releases a displaced string; pluck position creates mode-dependent notches | Stiff string with fret/bridge terminations | Bridge drives top/back and cavity; the coupled air mode is near the low end of the guitar range and body peaks stay fixed in Hz | `pluck` + `string`, excitation-position comb, measured `B`, fixed-Hz body bands and two-stage decay. Additive modes approximate the string well; body-mode time coupling is compressed into response/decay laws. |

The guitar's lowest strong body signature is not a pitch-scaled EQ bump.
Woodhouse's guitar work identifies the Helmholtz/air feature in roughly the
75–100 Hz band and a first top-plate region around 150–250 Hz
([guitar perception paper](https://www.lam.jussieu.fr/Publications/Articles/AAA_Woodhouse_2012.pdf));
the Euphonics treatment shows that air and plate motion are strongly coupled
in guitar bridge admittance
([signature modes](https://euphonics.org/5-3-signature-modes-and-formants/)).

## 2. Quantitative signatures used in fitting

- **Impulsive envelope.** At least two thirds of piano/guitar campaign notes
  must classify as percussive. A sustained majority is the wrong excitation,
  even if its steady spectrum matches.
- **Stiff-string inharmonicity.** `B` must be non-negative, measured per
  register, and meet the §3 factor-of-1.5 paired-reference tripwire. A piano
  must not inherit one keyboard-wide `B`; G1 interpolation is required.
- **Velocity→brightness.** Hammer contact becomes effectively harder/brighter
  at higher playing velocity. Pianoteq exposes separate piano/mf/forte hammer
  hardness and states that harder felt enriches high frequencies
  ([Pianoteq manual, Voicing](https://www.modartt.com/user_manual?product=pianoteq)).
  Guitar nail/plectrum force can also change source hardness. Both presets must
  opt into `velocityHardnessCoupling` and show a positive spectral-index slope.
- **Double decay.** Coupled string polarisations and body/string energy paths
  can yield a fast initial fall followed by slower aftersound. Woodhouse's
  analysis gives conditions for double-decay envelopes in stringed instruments
  and explicitly connects the phenomenon to piano-tone literature
  ([JASA paper](https://euphonics.org/wp-content/uploads/2022/03/Double_decays_JASA.pdf)).
  Both campaign presets must enable `decaySecondStage` with a late/early ratio
  greater than one; the exact values remain fitted.
- **Piano frequency-dependent decay.** Soundboard impedance controls global
  duration while its cutoff/slope changes how quickly high overtones die;
  Pianoteq exposes these as independent physical controls
  ([Pianoteq Design/Soundboard](https://www.modartt.com/user_manual?product=pianoteq)).
  SG2's per-band T60 and two-stage law must match the reference rather than one
  ADSR release.
- **Guitar air mode.** Where a rendered note has harmonics sampling the
  75–130 Hz region, the median prominence may not be more than 9 dB below its
  neighbouring band. The wider bound covers instrument variation and the
  sparse harmonic sampling of a single note.
- **Pluck/strike position.** A point excitation creates mode-selective dips.
  Position is fitted from the full partial pattern, not asserted as a single
  universal number; forcing a canonical 1/7 or 1/8 position would overstate
  the evidence.

## 3. Controls exposed by professional modellers

Pianoteq exposes hammer hardness by dynamic, strike point, hammer noise,
individual overtone profile, string length/inharmonicity, direct duration,
soundboard impedance/cutoff/slope, sympathetic resonance and duplex scale
([official manual](https://www.modartt.com/user_manual?product=pianoteq),
[official feature summary](https://www.modartt.com/pianoteq_features)). This is
strong independent evidence that SG2 should not collapse hardness, position,
noise, inharmonicity and decay into “brightness”.

WP-9 should consider excitation position, hardness and dynamic response as
performer-facing. `B`, per-register tables, body impedance proxies and
double-decay ratios are instrument construction/Advanced unless the ledger
shows meaningful user-facing sensitivity and spread.

## 4. Executable construction checklist

Both instruments inherit three-register coverage, at least two dynamics,
paired f0 lock and the impulsive-envelope check.

| Instrument | Assertion ID | Required fact |
|---|---|---|
| Piano | `piano.excitor`, `piano.resonator` | `strike` into a stiff string |
|  | `piano.stiff-string` | Median measured `B` is non-negative |
|  | `piano.hardness-coupling` | `velocityHardnessCoupling > 0` |
|  | `piano.dynamic-brightening` | Upper-partial index rises with velocity |
|  | `piano.double-decay` | Second stage enabled and late T60 exceeds early T60 |
|  | `piano.free-decay-no-plateau` | Every held-key ship render continues decaying; one plateau is an automatic fail |
|  | `piano.pre-onset-component-active` | Any pinned action-noise component is audible and uses its own fitted envelope |
| Guitar | `guitar.excitor`, `guitar.resonator` | `pluck` into a stiff string |
|  | `guitar.stiff-string`, `guitar.hardness-coupling` | Measured stiffness and velocity-dependent contact |
|  | `guitar.dynamic-brightening`, `guitar.double-decay` | Brighter forceful attacks and slower aftersound |
|  | `guitar.free-decay-no-plateau` | Held plucks decay freely until explicit hand/finger damping |
|  | `guitar.air-mode` | Fixed 75–130 Hz air region present where measurable |

The construction gate does not require sympathetic resonance or pedal noise
in isolated dry notes. Those cannot be used as cosmetic layers to rescue a
wrong string/hammer/body model.

## 5. Verdict on the §6 backlog

| Gap | Verdict | Consequence |
|---|---|---|
| G1 register-dependent spectra/B | **Confirmed.** Piano string scale and guitar body/string intersections vary across register. | Three-register partial and `B` tables are mandatory. |
| G4 two-stage decay | **Confirmed.** Double-decay envelopes arise from coupled energy paths/polarisations and are documented for piano/stringed instruments. | Both presets must opt in; ratio/amount are fitted, never hard-coded by family. |
| G5 attack stagger | **Confirmed as landed.** High-frequency modes and contact noise do not share one onset time. | Retain measured band T90/transient data. |
| G7 velocity→hardness | **Confirmed.** Professional physical modelling and hammer physics both separate hardness by dynamic. | Coupling must be nonzero and its audio consequence must pass the dynamic-brightening assertion. |
| Missing gap: sympathetic/duplex coupling | **Amended to deferred scope.** It matters for chords, pedal and long aftersound, but isolated-note fitting can first use `partialTransfer` and G4. | If piano residuals survive the variability floor specifically in late decay, file a bounded resonant-coupling WP; do not add an audio layer. |

Verdict: G1, G4 and G7 are confirmed. G4 is a structural minimum rather than
a claim that one two-exponential law captures every coupled string.
