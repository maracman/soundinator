# Owner listening notes

Ear feedback from the owner on campaign renders/references. Each note is a
work item: engine evidence checked at entry time, fix tracked through the
normal loop (§2.5). Newest first.

## FAMILY FIREWALL (owner, 2026-07-16 — read before applying any L-note)

Every observation below was heard in a SPECIFIC family (so far: blown) and
is a hypothesis scoped to that family. Rules for carrying anything across
families (e.g. into the bowed campaign):

1. **Architecture transfers; values never do.** The excitation-generic
   mechanisms (noise floor, articulation strength, onset spectrum, scoop
   distribution) may be shared code, but every slope, coupling, exponent
   and depth ships NEUTRAL in a new family until (a) that family's
   dossier supports the mechanism and (b) that family's own corpus
   evidence fits the value. Fitted blown values are never defaults for
   bow.
2. **Within-instrument and across-instrument slopes are SEPARATE
   parameters and may have opposite signs.** Owner's canonical example
   (scoop): across instruments, larger/louder instruments (higher-dB pp
   threshold) exhibit more onset imperfection; within one instrument's
   range, SOFT playing underplays the onset and scoops MORE, not less.
   "Loud always more than soft" is a category error unless the level
   (instrument-level vs note-level) is stated. Any assertion or fitted
   law must name its level explicitly.
3. **Imperfections are human, not mechanical.** Good players strive to
   hit the note exactly; these effects are deviations that increase with
   difficulty (soft onsets without plosive support, cold starts, large
   instruments) and decrease with skill. They scale with the Human dial,
   default subtle, and are suppressed when the articulation draw is
   strong (plosive-supported onsets — L5b). A campaign must never fit
   them as constants of the instrument.
4. **Evidence gates are per-instrument** (already enforced in
   assertions.py: measured correlations from that instrument's own
   references). Reopening a frozen preset when new evidence requirements
   land — as done for trumpet — is the correct behaviour, not churn.

## 2026-07-16 (later) — post-body-deconvolution renders (listen.html v4)

### L6 STATUS (owner re-confirmed, 2026-07-16 later): NOT FIXED — consumption gap
Owner, verbatim repeat of L6 on the post-deconvolution render: alto sax
"sounds the same as before — too bright, no richness in the mids, sounds
like someone blowing into the mouthpiece without the body attached."
Verified cause: the fitted `resonances` ARE in the measured profiles
(alto-sax: 13 bands) but synth.js still seeds the hand-me-down
(`alto-sax ← clarinet`, :572) and then UNCONDITIONALLY overwrites the
profile's resonances with that copy (:579). L6 fix item 2 (retire the
hand-me-down for measured instruments) was never done — this is the
pending Agent A data-contract ack in concrete form. Fix: profile's fitted
`resonances` win whenever present; hand-me-down only as logged fallback
for unmeasured profiles; headless assertion that each measured
instrument's effective body equals its fitted bands. The horn improved
despite this because its refit likely carries explicit `bodyBands` in
params, bypassing the profile plumbing — verify that too.

### L14 · Violin still very bad — OWNER EXTRACTION PROTOCOL: isolate the bow sound as its own component
Owner (2026-07-17), method prescribed in full: "find the bow sound,
extract all the partials to have it as its own separate control. I
believe they do not change significantly with volume — when they change
in volume they keep a much more similar tonal profile than the sound that
comes from the body of the instrument. Take the same expressed note at
different pitches and find the common frequencies that aren't affected by
the note fundamentals. Isolate the range in which we expect to hear the
bow sound. Do this at p, and separately at pp, first — preserving the
characteristics of the bow at those volumes. Then see if we can still
extract something at mp. Compare the profiles extracted at the different
volumes, and parse out any artifacts through analysis and then through
simulation."

Formalised protocol (Agent D lane, violin first, method generalises):
1. **Harmonic subtraction per note**: track the partials (f0-anchored),
   remove them (harmonic modelling or comb-notch), keep the residual
   spectrum. Restrict to the plausible bow-noise range first (annex: the
   scratch band; verify empirically rather than assume).
2. **Cross-pitch commonality**: pool residual spectra across many pitches
   of the SAME dynamic and articulation (same-string groups); the
   pitch-invariant common component = the bow-noise profile (body-
   coloured, which is correct — it should be body-routed per T-001).
   What varies with pitch = leakage/artifacts, flagged not kept.
3. **Dynamic ladder**: extract at pp and p SEPARATELY first (highest
   noise-to-tone ratio, cleanest); then attempt mp. Compare profile
   SHAPES across dynamics — owner hypothesis: shape is volume-stable
   (level changes, profile doesn't), unlike the harmonic sound. If
   confirmed: bow noise = pinned spectrum table + fitted level-vs-
   dynamic law (T-001 inefficiency law), NOT a per-dynamic shape.
4. **Artifact screening, analysis then simulation**: first inspect the
   extracted profiles for analysis artifacts (harmonic leakage, vibrato
   smear, window effects); then VALIDATE THE EXTRACTOR BY SIMULATION —
   synthesize a known harmonic+noise signal through the engine, run the
   extraction, verify it recovers the injected noise profile within
   tolerance. The extractor is not trusted until it passes its own
   synthetic round-trip.
5. **Engine consequence**: the extracted profile becomes a separate,
   user-controllable bow-noise component (T-001 architecture: fitted
   spectrum → body routing → envelope-coupled level × inefficiency law
   at pp), with its own level control exposed. Pinned from measurement;
   the optimiser never shapes it freely.
Method note: this is the noise-domain analogue of the P2 body
deconvolution (pitch-invariance as the separator) — exchange entry
warranted; breath extraction for winds and sung breathiness should
adopt the same cross-pitch residual method.

### L13 · "Strings seriously degraded" (2026-07-16 late) — INVESTIGATED, NO REGRESSION
Owner reported serious string degradation on the auto-built page.
Forensics: violin/cello renders are perceptually identical to the prior
session (diff ~80 dB below signal — renderer float tolerance; tails
bit-identical); regenerated references have natural onsets, no bad trims.
Verdict: perceptual contrast — blown improved dramatically on the same
page while strings remain the untouched pre-campaign baseline. NO agent
should hunt a string regression from this report. The actionable reading:
the owner's quality anchor has risen; prioritise clearing the bowed
campaign's remaining gates.

### L11 · Violin BASELINE: onsets "resemble embouchure, not the contact of bow with strings — sounds too similar to the brass" — FIREWALL CONFIRMED BY EAR
Owner, on the pre-campaign string baselines: the onset is rightly distinct
from the sustain, but its character is wind/brass-like. Mechanism: the
baseline renders pass through onset machinery built and tuned on blown —
the scoop-from-below pitch shape IS an embouchure gesture (pressure
building to pitch), and the attack-noise shaping carries blown character.
A bow start is broadband scratch/creak during Helmholtz lock-in, with
pitch WANDER/SETTLE, not scoop-from-below. This confirms BOWED_PREFLIGHT
P4's prediction empirically, before any fitting. Requirements for the
bowed campaign: (1) bow onset noise = broadband scratch (fit spectrum
from the references' onset windows — violin's old fit measured 1 kHz
centroid, Q 0.84 broad); (2) onset pitch model for bow = fitted
wander/settle trajectory, blown scoop shape must NOT apply (the L5
scoop-from-below is excitationType-gated to blow); (3) the articulation-
strength draw maps to bow accent (martelé ⟷ floated), with the scratch/
pitch coupling fitted from string references only.

### L12 · Low cello: "a weird harmonic with too much of a dissonant note to it... what has been added is too ham-fisted" — BODY APPLICATION GRANULARITY
Right diagnosis by the owner: the fitted body (right idea) is applied too
crudely at low register. Mechanism: the deconvolved body is ~14 narrow
(1/3-octave) Gaussian bands. At high register partials are dense vs the
bands → reads as an envelope. At LOW register partials are widely spaced
and individually resolved — a narrow band peak lands on ONE partial and
boosts it several dB into a prominent quasi-dissonant tone inside the
note. Real bodies are dense overlapping modes; the perceived colour is an
envelope, not single-partial spotlights. Fix directions (Agent B lane,
with A on the application side): (a) frequency-dependent width floor —
bands must always span ≥ ~1.5 partial spacings of the lowest supported
fundamental, or (b) apply the body as a smoothed envelope below a
crossover while keeping discrete peaks above, or (c) cap per-partial
body gain delta relative to neighbours at low register. Validate on the
low cello references; owner-ear acceptance: body colour without a
"resonant extra note".

### L10 · Alto sax (post-body-fix): "more character but the balance is still off — there should be a frequency profile that balances more broad frequency bands for the sustained note" — SCORER GAP + GATE STILL MISSING
Verified at entry: (a) the scorer has NO coarse band-balance feature — the
48-band mel distance lets a systematic octave-scale tilt hide inside fine
structure; (b) the §3 tripwire gate is STILL unimplemented anywhere in
scripts/tone_match/ (review fix #1 / preflight P5.1 — the second
twice-named gate item found open, after D4).
Fix: (1) add a sustained-window LTAS band-balance feature (octave or
1/3-octave energy profile, loudness-matched, render vs reference) as a
first-class scored feature; (2) implement the §3 tripwire gate NOW, with
band balance in it (e.g. no band > X dB off reference); (3) research run
commissioned (RESEARCH_SUSTAIN_BALANCE) to set per-instrument band
targets from published LTAS data rather than guessing. Owner's standing
question — "are we meeting these baselines" — must become answerable from
the run report at a glance: per-preset PASS/FAIL against every §3 bar.

### L7 · Flute: "very far from target — no breathiness at all, sounds like a kazoo" — REGRESSION-CLASS
State: flute rendered from pre-rework params (toneBreath fitted 0.28 —
substantial) through the new engine + newly fitted bodies. Two distinct
symptoms:
1. **No breath despite toneBreath 0.28** — the render path is not
   delivering fitted breath. Investigate the breath path state (legacy
   draw vs L4 rework interaction with old params) — flute is the
   breathiest wind; zero breath is a render-path fault, not a fit choice.
2. **Kazoo quality** = buzzy formant-like colour. Prime suspect: the
   deconvolved flute `resonances` — an air-jet instrument has weak
   fixed-body structure, and a 1/3-octave envelope fit over flute's steep
   spectrum can mint spurious formant bands that buzz on reapplication.
   Check flute's `resonancesFit` stability numbers; consider a
   family-aware prior (air-jet instruments: flat-to-minimal body unless
   evidence is strong). Agent B lane.
Gate: flute refit may not freeze while either symptom stands.

**L7 forensic update — Agent D custody review (2026-07-16).**
The final v3 analysis did exactly what L7 requested: flute's fitted-body
stability was only marginal (`splitHalfCorr = 0.802`) and its split-half
peaks disagreed at 1451 vs 1837.5 Hz, just beyond the one-third-octave
air-jet limit. Analysis therefore emitted `resonances: []` with
`omittedReason: "unstable-air-jet-body"` rather than minting the suspected
kazoo formant. The engine did not consume that decision: it retained the
legacy hand body (900/2200/5200 Hz bands), and the existing L6 headless
consumer assertion failed. Thus the kazoo report has direct evidence for a
second component: legacy-body fallback remained audible even after analysis
correctly rejected the unstable fitted body. Tracked by T-035; Agent A's
acceptance must prove explicit omission produces an empty effective body,
while a profile with no measured-body decision may still use a logged
fallback. In other words, the reported flute kazoo was partly the legacy-body
fallback that survived the analysis-side empty-body decision; this is direct
evidence for the L7 diagnosis, not merely a schema concern.

### L8 · French horn: high register "sounds like a clarinet/woodwind" (low/mid good) — likely D4
Verified at entry: the `registerProfileAt` above-range defect (review D4 /
preflight gate P5.3) is STILL UNFIXED — `hi <= 0` swallows the
above-top-anchor case and returns the LOWEST register's table
(synth.js:1039-ish). Horn's high references sit at the top anchor;
anything at/above it renders with low-horn tables — dark/hollow reads as
woodwind. Fix D4 first (it was a named precondition twice), re-render,
re-judge; if the woodwind quality persists, next suspects: fitted-body
envelope extrapolation beyond the corpus span, and missing high-register
brass brightening (cuivré) in the blare law.

### L9 · Trumpet: plosive missing at LOUDER dynamics — refit acceptance criterion
Expected (trumpet is pre-rework; onset laws neutral there), but the
specific observation binds the refit: plosive strength must scale up with
dynamics (articulation-strength draw biased strong at forte), and the
refit's acceptance includes an owner-audible plosive on ff onsets
matching the reference character.

## 2026-07-16 — blown-family first passes (listen.html session)

### L1 · Reed breathiness sits apart from the note at p/pp — MODEL GAP
Owner: "the clarinet and likely other reeds have a distinct breathiness
that sits separately from the note. It is distinct to the ear at piano and
pianissimo. Characteristically it maintains a more relative volume at the
lower dynamic range so it tends to stand out more."

Engine evidence: `_renderBreath` scales the breath floor at
`velocity * level * 0.2` (synth.js ~:4976) — linear in velocity, so the
breath/tone ratio is constant across dynamics. Real reeds: harmonic tone
falls faster than breath noise as dynamics drop.

Fix direction: a breath-dynamics law (e.g. breath ∝ velocity^k, k < 1 —
same concept as the existing `attackNoiseVelocityExponent`, applied to the
sustained noise floor), FITTED from the corpus: the pp/ff take pairs allow
measuring the noise-to-harmonic ratio at both dynamics per instrument and
pinning k. Perceptual requirement: at pp the breath must read as a
separate, co-located noise layer, not as a duller tone. Add a scorer
feature for sustained noise-to-harmonic ratio per dynamic so the loop can
see this dimension (currently analyser-blind to it).

### L2 · Onset plosive has its own spectral character — MODEL GAP
Owner: "for the trumpet and other instruments the onset has a different
plosive property... it isn't likely to be just an envelope adjustment but
something characteristic about the tone print that is separate from the
maintained tone after the onset."

Engine evidence: onset machinery is the filtered-noise burst
(attackNoise freq/q/decay) + per-band stagger + `attackNoiseDirect`
routing. There is NO mechanism for the harmonic spectrum of the first
~30–80 ms to differ from the sustain print — which is what a brass/reed
plosive is (transiently brighter/rougher partial weighting collapsing
into the sustain, plus the noise burst).

Fix direction: an onset-spectrum layer — a short-lived per-partial
weighting (or tilt+comb approximation) crossfaded into the sustain print
over a fitted time constant; measured per instrument from the references
(onset-window FFT vs sustain-window FFT — the analysis module already
windows both). The horn campaign's transient-manifest experiments are the
right thread; formalise per §6 rules (neutral at 0, headless assertion,
Advanced disclosure). Note stagger (G5) handles per-band TIMING; this
item is about per-partial LEVEL/colour at onset.

### L4 · French horn breath component: right idea, wrong behaviour — MODEL REFINEMENT (extends L1)
Owner: the breathy frequency in the horn renders "does add realism (better
with than without)" — KEEP it — but: (a) "it is too uniform as noise";
(b) "too much of a distinct separation between this and the note at louder
volumes"; (c) "it sounds too on-and-off gated... it is correct that it
responds less subtly to the difference in pressure but it is not binary.
We should hear it fade as the note fades — particularly because the
tapering of a note is associated with less air flow, whereas the lower
volume at the beginning of a pianissimo note is more associated with
reduced efficiency (i.e. more air escaping)."

**The owner's asymmetry law — adopt as the design spec for breath:**
- breath LEVEL tracks airflow → follow the note's amplitude envelope
  continuously (taper ⇒ breath fades with it);
- breath-to-tone RATIO tracks (in)efficiency → higher at soft dynamics
  and at onsets before the tone speaks; lower in settled loud sustain.
These are two separate couplings; conflating them is what makes the
current render read as binary.

Engine evidence (synth.js `_renderBreath`, ~:4951): (a) uniform — single
white-noise buffer through one static 900 Hz highpass, no bore/body
filtering, no turbulence texture; (b) separation — the noise bypasses the
resonator/body response entirely, so at ff it sits beside the tone
instead of inside the instrument; (c) gating — per-note level is
`rng.next() * toneBreath` (a uniform random draw: adjacent notes get full
breath or nearly none — the note-to-note binary), and within the note the
gain starts at full value at t0 with one linear ramp to zero at t1,
independent of the ADSR shape.

Fix direction:
1. Route breath through the SAME body response as the partials (and add a
   bore-coloured emphasis near the played f0 / lower resonances) so it
   fuses with the tone at all dynamics — this addresses (a) and (b)
   together.
2. Replace the per-note random draw with deterministic continuous
   variation from the seeded Human/turbulence trace (slow amplitude and
   colour wobble — real breath is textured, not steady).
3. Implement the asymmetry law: gain = airflow(env) × level;
   ratio-vs-tone = inefficiency(pressure), fitted from the pp/ff
   reference pairs per L1. Onset behaviour follows: at a pp onset the
   breath leads while the tone speaks late (matches the plosive-onset
   observations in L2); in a taper both fade together.
4. Applies to all blown instruments (and sung breathiness), not horn
   only; horn is where the owner heard it.

**L4 status check (owner, 2026-07-16 second listen): partially done.**
The ratio/texture/body laws landed and the refit alto-sax carries fitted
non-neutral values (breathVelocityExponent 0.23 = the pp-ratio law,
confirmed working by measurement). But fix item 2 was skipped: the
per-note uniform draw `toneBreathLevel = rng.next() * breath`
(synth.js:2541) is STILL the base level for every blown note, so the
note-to-note gating persists — audibly, per the owner — on clarinet,
horn, and (in principle) the refit sax too.

**Owner decision: the per-note random draw is a DEFECT, not preserved
character.** Replace it engine-wide for blown excitation (deterministic
level from the airflow/inefficiency laws + seeded Human-trace texture;
determinism per seed retained). This is an authorised behaviour change to
existing presets (D1-style, owner-approved here): do not hide it behind a
per-preset opt-in. Land it with the render-path golden updated
deliberately, then refit/re-audit clarinet and horn, whose current fits
predate all L1/L4 laws.

### L5 · Onset pitch scoop: right feature, wrong distribution — MODEL REFINEMENT
Owner (listening to the horn pairs): "there is a little scoop up to the
note that happens during the onset. I'm sure this isn't uniform and only
would appear when the player begins a phrase, but it is clear in many of
the notes. It is likely this is a feature of larger instruments that
require more air pressure to sound at volume."

Engine evidence: `onsetScoopCents(type, human)` (synth.js:1560) returns
`-base[type] × human` — a DETERMINISTIC constant. Every non-legato note of
a given preset scoops identically (depth and shape), which is why it reads
as uniform across the render set. No per-note variation, no
phrase-position law beyond the existing legato zeroing (synth.js:4532),
and no dependence on instrument size, register, or dynamic.

Fix direction:
1. **Measure it**: add onset-f0-trajectory to the analysis/scorer (depth
   in cents + settle time from the reference f0 tracks — the f0 tracker
   already exists for vibrato). Currently the loop is analyser-blind to
   onset pitch, so it can neither fit nor be penalised for it.
2. **Distribution, not constant**: seeded per-note draw of depth/settle
   time (Human-scaled spread), including a fraction of notes with
   negligible scoop — fitted to the measured distribution per instrument.
3. **Phrase-position law**: full scoop at phrase starts (first note /
   after a rest — the generative engine knows the preceding gap), reduced
   for re-articulated notes inside a phrase, zero for legato (already).
4. **Physical scaling** (owner's hypothesis, dossier to confirm): scoop
   depth/time grows with air-pressure demand — larger bore/lower
   instruments (horn > trumpet), lower registers. Replace the hand
   `_SCOOP_BASE_CENTS` table with per-instrument fitted values so this
   emerges from measurement.

**L5c · Dynamics direction corrected (owner, 2026-07-16):** within a
single instrument's playing range the slope is INVERSE to what item 4's
"louder cold starts" implied — "if a person is trying to play softly they
are likely to underplay the onset and scoop up to the note." Loud playing
recruits plosive support (L5b) and hits pitch. Across instruments the
original direction stands: larger instruments with a higher-decibel pp
threshold exhibit the imperfection more. Two slopes, two levels, opposite
signs — see the FAMILY FIREWALL rule 2. And it is a HUMAN imperfection:
good players strive to hit the note exactly; a slight version (when
plosives aren't relied upon for the onset) increases realism — fit the
distribution, keep the default subtle, scale with Human.

**L5b · Scoop ⟷ plosive coupling (owner, 2026-07-16): "the scoop is
probably inverse to the plosive sound in some sense — the plosive pushes
the air from the lips to hit pitch more accurately."** Design
consequence: the onset model (L2 + L4 + L5) should hang off ONE latent
per-note variable — ARTICULATION STRENGTH (tongued/accented ⟷
breath-started) — from which the correlated consequences derive:
- strong articulation → loud plosive transient (L2), pitch accurate from
  the first cycles (scoop ≈ 0), little breath lead;
- weak articulation → faint plosive, breath leads the tone (L4's pp-onset
  inefficiency), pitch scoops up as pressure builds (L5).
One seeded draw per note (biased by dynamic, phrase position, and the
Human dial) with anticorrelated outputs — NOT independent draws per
effect, which would produce impossible combinations (hard tongue + deep
scoop). Verify the anticorrelation in the references (per-note onset
transient energy vs scoop depth across each instrument's takes) and fit
the coupling strength from it.

**L5c · Human and dynamic direction clarification (owner, 2026-07-16).**
This is a human imperfection: good players strive to hit the pitch exactly,
so Human = 0 must produce no scoop. Within one instrument's playing range,
soft/underplayed, weakly plosive starts are more likely to scoop than a
firmly articulated loud onset. Across instruments, a physically larger
instrument whose practical pianissimo register still requires a higher
pressure/SPL threshold may exhibit a larger fitted imperfection. Model those
as separate levels: fit the soft↔loud slope within each instrument, fit the
base depth separately between instruments, and do not derive either from bore
size alone. A slight scoop when the onset does not rely on a strong plosive is
the realism target; it is not a mandatory defect on every note.

### L6 · Blown renders bright, no mid richness — "reed without the body attached" — STRUCTURAL
Owner (corrected alto-sax renders, and the family generally): "each one of
them, the tone is very bright without richness of colour in the mids. It
reminds me of someone blowing into the reed part of the instrument
without the body attached."

Diagnosis (verified): the BODY stage is effectively absent for the new
instruments —
1. WP-3 measured profiles carry NO fitted `resonances` (body bands were
   never extracted from the samples; alto-sax `vowelFormants` empty).
2. synth.js seeds SPECTRAL_RESONANCES for new instruments from
   hand-me-downs: `alto-sax ← clarinet`, `french-horn ← trombone`,
   `guitar ← piano` (synth.js ~:572,913). The sax plays through a
   clarinet's body.
3. `spectralResonanceAmount` sat at its 0.35 default with ~zero measured
   sensitivity — tuning the amount of the WRONG body does nothing, so the
   optimiser correctly ignored it.
Structural consequence: fixed-Hz formant colour cannot be represented by
per-rank partial tables across registers (a formant moves through partial
ranks as pitch changes), so without a fitted body the mid richness is
unreachable by ANY setting of the current free parameters — this is a
§2.5(b) limiting factor, and it plausibly accounts for much of the
16–26 dB mel tripwire residual flagged in the branch review.

Fix (= BOWED_PREFLIGHT P2, promoted to blown NOW):
1. Fit the fixed-Hz body envelope per instrument from the across-note
   ensemble (all takes' partial (f, amp) points), store as `resonances`
   in the measured profile; THEN refit per-partial excitation tables on
   the body-divided residual.
2. Retire the hand-me-down body seeding for measured instruments (keep
   only as explicit fallback with a logged warning).
3. Re-run the blown campaigns after; expect mel residuals to drop
   materially and `spectralResonanceAmount` to become sensitive.
4. Owner-ear acceptance: the mids regain "richness of colour"; the
   blowing-into-a-detached-mouthpiece quality disappears.

### L3 · Reference outlier: trumpet_C5_15_fortissimo_normal.mp3 — CORPUS QC
Owner: it "doesn't sound right... too much of a variation from the mean of
the sample set. It sounds like it has a mute on it."

The file is a Philharmonia take in the trumpet fitting set (midi 72,
high/ff) alongside Iowa's Trumpet.novib.ff.C5B5. Action: (a) exclude it
from spectral fitting and floor groups; (b) restrict Philharmonia material
to vibrato statistics (its original role, per docs/MEASURED_PROFILES.md)
unless a take passes QC; (c) add automated reference QC to the campaign
build step — per-file feature z-score against same-instrument
same-dynamic peers, auto-flag outliers into COVERAGE.md for owner ear
review before they enter a reference set. Converges with the review
finding that mixed-source, duration-mismatched pairs inflate the
variability floor.

Counter-datum (2026-07-16): the owner ear-checked
`saxophone_C4_15_fortissimo_normal.mp3` (Philharmonia, alto-sax set) and
passed it — "sounds fine". So L3 is take-specific QC, NOT a blanket
Philharmonia exclusion: takes that pass the automated screen and/or owner
ears stay eligible for spectral fitting.
