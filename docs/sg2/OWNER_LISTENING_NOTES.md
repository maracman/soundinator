# Owner listening notes

Ear feedback from the owner on campaign renders/references. Each note is a
work item: engine evidence checked at entry time, fix tracked through the
normal loop (§2.5). Newest first.

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
