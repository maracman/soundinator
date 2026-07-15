# SG2 construction dossier — bowed strings

Status: research verdict complete; checklist implemented in
`scripts/tone_match/assertions.py` (checklist version 1).

Scope: violin and cello, normal bowed sustained notes. Pizzicato, col legno,
room response and ensemble layering are not substitutes for this construction
gate.

## 1. Mechanism to engine-stage mapping

| Instrument | EXCITOR | RESONATOR | BODY / radiation | Additive approximation and audible risk |
|---|---|---|---|---|
| Violin | Rosined bow produces stick–slip (Helmholtz) motion; bow force, speed and bridge distance define a playable regime | Stiff string with near-harmonic transverse modes | Bridge and body convert string force into radiated sound; broad bridge/body features remain fixed in Hz while played harmonics move | `bow` + `string`, measured `B`, per-register partials, fixed-Hz body bands. Additive steady modes approximate periodic motion but can miss scratch/raucous regimes and residual bow noise. |
| Cello | Same frictional mechanism at larger scale, with lower strings and different bridge/body admittance | Stiff string, near harmonic with string-dependent loss | Strong low body/air modes and bridge response colour the radiated spectrum | Same mapping with cello-specific register tables, `B`, T60 slope and body bands. Reusing violin bands shifted by pitch is structurally wrong. |

Schoonderwaldt's measured bowing work places stable Helmholtz motion between
upper/lower bow-force limits that depend on bow–bridge distance and velocity
([KTH thesis](https://www.speech.kth.se/publications/pdfs/schoonderwaldt_e.pdf)).
The engine does not solve friction in real time, so its `excitationPosition`,
hardness/edge and dynamic laws are perceptual coordinates inside that regime,
not a claim to simulate the contact differential equation.

The body is not a pitch-tracking filter. Woodhouse and Galluzzo describe the
violin “bridge hill” as a broad response feature near 2.5 kHz
([paper record](https://www.researchgate.net/publication/228632416_On_the_bridge_hill_of_the_violin));
the Cambridge violin-acoustics review treats bridge admittance/body modes as
the transfer path from bowed string to radiation
([open repository review](https://www.repository.cam.ac.uk/items/0c6f4466-3e5f-4b7a-abcf-23d3bd259025)).
That supports SG2 fixed-Hz `bodyBands`, not register-shifted formants.

## 2. Quantitative signatures used in fitting

- **Sustained classification.** Normal bowing is continuously driven. At least
  two thirds of the campaign notes must analyse as sustained; a percussive
  majority indicates the wrong excitor/envelope.
- **Continuous drive, not free decay.** While the bow remains in contact it
  replenishes string-mode energy. The renderer must not apply a piano/guitar
  free-decay envelope to upper partials during the held portion of a bowed
  note; ordinary release still follows the note envelope.
- **Near harmonic, slightly stiff strings.** Real string modes are close to
  harmonic but stiffness stretches upper modes. The gate accepts measured
  `B` from 0 through 0.003; the §3 factor-of-1.5 reference match remains the
  tighter per-note test whenever `B` is measurable.
- **Fixed violin bridge/body region.** The violin gate requires usable energy
  in a fixed 2.0–3.2 kHz region across notes, with median prominence no worse
  than 6 dB below adjacent flanks. This is deliberately wider than “2.5 kHz”
  because bridge hills vary between instruments and are broad.
- **Cello body evidence.** The cello gate similarly checks a broad 180–700 Hz
  fixed-Hz region. This is a sanity band, not a replacement for fitted body
  peaks; its purpose is to catch an empty/string-only body stage.
- **Bow intensity and edge.** Increasing bow force at a fixed contact region
  may brighten or become raucous; the model must at least not systematically
  darken as the dynamic increases. The gate requires a non-negative (within a
  small tolerance) upper-partial-index slope. Schelleng-regime evidence makes
  this a bounded law, not permission for unlimited blare.
- **Register dependence.** A fixed-Hz bridge/body transfer means different
  harmonics meet the same resonances at different notes, while string and bow
  changes also alter source spectra. Therefore three named registers and
  per-register tables are required before freezing.
- **Noise.** Residual bow noise contributes to perceived realism and has been
  modelled as a separate residual component in violin synthesis
  ([Michelashvili & Wolf, HpRNet](https://arxiv.org/abs/2008.08405)). It is
  scored as noise/transient evidence, never baked into harmonic amplitudes.

## 3. Controls exposed by professional modellers

Audio Modeling's string instrument exposes expression/dynamics, bow pressure,
bow position, attack/start behaviour, vibrato rate/depth, tremolo, harmonics,
portamento, fingering and mute/play-mode controls
([SWAM Strings manual](https://support.audiomodeling.com/guides/strings210/SWAM%20Strings%20v2.1.0%20-%20User%20Manual.pdf),
[current release-note parameter list](https://kb.audiomodeling.com/support/solutions/articles/206000050990-swam-solo-strings-release-notes)).
This supports separate SG2 controls for expression, bow position/edge,
transitions and vibrato. The instrument body, measured `B`, partial tables and
bridge region are construction data and should remain Advanced or hidden.

## 4. Executable construction checklist

Both instruments inherit strict register/dynamic coverage, paired f0 lock and
the sustained-envelope check.

| Instrument | Assertion ID | Required fact |
|---|---|---|
| Violin | `violin.excitor` | `excitationType = bow` |
|  | `violin.resonator` | `resonatorClass = string` |
|  | `violin.near-harmonic-string` | Measured `B` lies in 0…0.003 |
|  | `violin.fixed-body-region` | 2.0–3.2 kHz bridge/body region is present across notes |
|  | `violin.bow-force-edge` | Higher intensity does not systematically darken the partial distribution |
| Cello | `cello.excitor`, `cello.resonator` | Bowed stiff string topology |
|  | `cello.near-harmonic-string` | Measured `B` lies in 0…0.003 |
|  | `cello.fixed-body-region` | 180–700 Hz body region is present across notes |
|  | `cello.bow-force-edge` | Dynamic spectral slope is not negative beyond tolerance |

The numerical body bands are broad tripwires. The fitted/reference mel and
partial distances remain responsible for the individual instrument's exact
peak pattern.

## 5. Verdict on the §6 backlog

| Gap | Verdict | Consequence |
|---|---|---|
| G1 register-dependent spectra | **Confirmed.** Moving harmonics intersect fixed body/bridge response differently, and strings/source conditions vary with register. | Violin and cello require three-register tables; a single mid-table cannot freeze. |
| G3 nonlinear dynamic brightening | **Amended.** A bounded edge response is justified, but brass-style unbounded “blare” is not the bowed-string law. | `dynamicBlare` may be fitted only where references show high-force enrichment; the audio gate merely forbids systematic darkening. |
| G5 attack stagger | **Confirmed as landed.** Bow establishment and residual noise are band-dependent. | Retain measured `bandT90ms`; no new engine change. |
| Renderer audit: free decay under continuous drive | **Rejected.** A struck-string decay law is not valid while the bow is still driving the string. | Gate material free decay to strike/pluck excitation; use the sustained-envelope and spectral gates to prevent recurrence. |
| Missing gap: explicit friction regime | **Rejected for the present steady-note scope.** Full stick–slip simulation would add controls and failure modes not demanded by the dry reference campaign. | File only if residuals show the current position/edge law cannot reproduce ordinary attacks without corrupting steady spectra. |
| Missing gap: residual bow noise | **Already representable.** Existing attack/breath-noise paths and scorer noise feature can carry it. | Fit separately from partials; promote to an engine gap only if sustained residual noise cannot be expressed without side effects. |

Verdict: G1 is structurally necessary; G3 is valid only as a bounded,
evidence-driven edge term. The existing neutral defaults remain correct.
