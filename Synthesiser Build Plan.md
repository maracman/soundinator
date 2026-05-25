# Synthesiser Build Plan

## Practical architecture, staging, and stack for the experiment programme

**Author:** Marcus Anderson
**Date:** 2026-05-19
**Companion to:** *Experiment Plan — Synth, EEG, MVPA.md*
**Status:** Planning draft

---

## 1. The headline decision

**One Python codebase with two pre-rendered renderers (covering Modes A–H), plus a hybrid Python-orchestrator + SuperCollider real-time engine for the one interactive mode (Mode I), plus a Psynet web deployment for population-scale discovery (Phase 0). Six release tiers.**

The instrument serves two distinct research modes: **confirmatory** (in-lab EEG with the Modes A–I described in the experiment plan) and **discovery** (online, behavioural-only, N ≈ 1,000–5,000, via Psynet). The same Python symbolic generator and PitchedRenderer feed both — Psynet runs the renderer server-side and streams audio to participants' browsers. This means the work of building the synth pays off twice: lab-grade EEG stimuli for the confirmatory studies, and a population-scale data-collection instrument that informs the parameters and hypotheses of those studies.

The experimental programme (Modes A–H) appears at first to demand a single grand instrument that produces everything from realistic laugh-like vocalisations to 19-EDO scale exercises to startle-probe-laden isochronous beats. Building it that way is the wrong call. The eight modes split cleanly into two engineering problems that share metadata, sequencer logic, and experiment-running infrastructure but not their audio DSP, and forcing them into one renderer makes both worse and delays everything.

The right architecture is one Python package with shared symbolic generator, calibration, trigger, QC, and experiment-runner layers, plus two swappable audio renderers behind a common interface:

- **`PitchedRenderer`** — for the hierarchical-music modes (C, D, F, G, H). Simple, ships fast.
- **`VocalisationRenderer`** — for the vocal-simulation modes (A, B, E). Hard, ships later.

Modes select a renderer at trial-generation time. The same JSON metadata sidecar and trigger schema work for both. The same experiment runner plays the WAVs and logs the EEG markers. The renderers can be developed in parallel by different people (or the same person at different times) without contention.

This is *not* "two synthesisers." It is one synthesiser whose audio backend is pluggable. The user-facing artefact — pre-rendered WAVs + JSON sidecars — is identical across modes, and downstream EEG analysis is mode-agnostic.

---

## 2. Why this split, and not a true monolith

A monolithic instrument that produced everything from glottal-pulse-modulated vocalisations to deeply nested 19-EDO sequencers would be elegant. It is also a poor engineering bet for these reasons:

**The DSP layers don't overlap.** Vocalisation synthesis is a source–filter problem: drive an LF glottal-pulse generator with a controllable F0 contour through a cascade of formant filters whose centre frequencies trace independent F1/F2/F3 trajectories, add aspiration noise, shape the amplitude envelope. The hierarchical-music renderer needs almost none of this. It needs a clean tone (sine, triangle, simple formant-filtered noise, optionally a piano-like additive timbre) at controllable pitch and duration, triggered from the symbolic event list. Putting both into one renderer means either the vocal source contaminates the pitched stimuli (unwanted formants colouring tonal experiments) or the pitched logic constrains the vocal renderer (discrete-pitch quantisation pulling on a system designed for continuous contour).

**Their failure modes are different.** The vocal renderer's risk is *naturalism* — does it sound like a vocalisation at all? Getting glottal source, formant trajectories, voice quality (modal/breathy/pressed), and intensity envelope to combine into something a participant accepts as vocal rather than synthetic is months of iteration. The pitched renderer's risk is *timing and entropy correctness* — does the 19-EDO E4-equivalent emerge at the right cents, does the Markov chain produce the requested entropy, are trigger times accurate to <1 ms. These are different debugging worlds.

**Their release schedules are different.** Mode C (on-beat PPI) only needs a pitched renderer, an L1 sequencer, and a startle probe. That is the cleanest single falsification in the programme. The pitched stack can pilot Mode C within 6 months. If the vocal renderer were a blocker, the whole project sits idle.

**Their authoring complexity is asymmetric.** The hierarchical sequencer (Modes D, F, G, H) is mostly *symbolic* code — pure Python event-list construction, Markov chains, probability distributions. That work is fast and testable. The vocal renderer is *DSP* code — numerics, frequency-domain analysis, comparison against natural recordings. Slow and qualitative.

Separating them lets the easier side ship first, gives the harder side the time it needs, and produces a system that is genuinely tractable to maintain.

---

## 3. Module map

```
┌──────────────────────────────────────────────────────────────────┐
│                    SYMBOLIC GENERATOR (Python)                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ PitchSystem      │  │ Sequencer        │  │ ProbeInjector  │  │
│  │ - octave division│  │ - L1 beat        │  │ - startle      │  │
│  │ - scale subset   │  │ - L2 motif       │  │ - violations   │  │
│  │ - quantisation σ │  │ - L3 phrase      │  │ - oddballs     │  │
│  │ - tonal centre   │  │ - L4 form        │  │                │  │
│  └──────────────────┘  └──────────────────┘  └────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│                      Event list (JSON-serializable)               │
│                              │                                    │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ JitterStage  (per-event Gaussian noise on every parameter)  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼ choose renderer per mode
        ┌──────────────────────┴──────────────────────┐
        │                                             │
┌───────▼─────────────────┐              ┌────────────▼────────────┐
│   PitchedRenderer       │              │   VocalisationRenderer  │
│   - sine / triangle     │              │   - LF glottal source   │
│   - formant-filtered    │              │   - 3-formant cascade   │
│     noise (simple)      │              │   - F0 contour          │
│   - additive piano-like │              │   - aspiration noise    │
│   - ADSR envelope       │              │   - voice quality       │
│   - clean limiter       │              │     (modal/breathy/     │
│                         │              │     pressed)            │
│                         │              │   - vibrato / tremolo   │
└───────┬─────────────────┘              └────────────┬────────────┘
        │                                             │
        └─────────────────┬───────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────────────┐
       │  RenderingPipeline                              │
       │  - loudness normalisation (LUFS)                │
       │  - peak limiting                                │
       │  - WAV export (48 kHz / 24-bit)                 │
       │  - JSON sidecar (full metadata + seed)          │
       │  - automated QC pass                            │
       └────────────────────┬────────────────────────────┘
                            │
                            ▼
       ┌─────────────────────────────────────────────────┐
       │  ExperimentRunner (PsychoPy)                    │
       │  - trial scheduling                             │
       │  - audio playback via sounddevice (ASIO/CoreA)  │
       │  - TTL triggers via Cedrus / LabJack            │
       │  - LSL marker stream                            │
       │  - behavioural rating UI                        │
       │  - per-session calibration / audio loopback     │
       └────────────────────┬────────────────────────────┘
                            │
                            ▼
                       [EEG amplifier]
```

The dashed boundaries are the API seams. The symbolic generator emits a JSON-serializable event list with no audio commitments. Renderers consume the event list; they don't know which renderer ran last week or which mode is being run today. The experiment runner consumes WAVs + JSON sidecars and is itself ignorant of how they were generated.

---

## 4. The five core software modules

### 4.1 Symbolic generator

A pure-Python package, no audio dependencies, fully unit-testable.

**`PitchSystem`** computes a pitch lattice (octave division, EDO, ratio-based, or random log-spaced) and a scale subset over that lattice (size, asymmetry rule, tonic, scale-degree probability weights, mistuning σ). Exposes methods like `nearest_grid_pitch(continuous_hz, quantisation_strength)` that implement the continuous-to-quantised slider as a Gaussian attractor toward grid points with controllable σ_attraction. This is the module that makes Mode G's discretisation-boundary analysis possible.

**`Sequencer`** is hierarchical. Each layer (L1 beat, L2 motif, L3 phrase, L4 form) is a class with the same interface — `generate(prior_state)` returns a list of child events with probabilities and metadata. Layers can be selectively disabled (Mode H) and their entropy can be set independently (Modes D, F, G). The Markov-chain machinery, transition matrices, and form-level schedules live here.

**`ProbeInjector`** schedules startle probes and violation events onto an existing event list. Knows about on-beat / pre-beat / off-beat placement (Mode C) and about violation type tagging (Mode D's level-specific N100/P200/N400/P600 violations, Mode G's out-of-scale and mistuned deviants).

**`JitterStage`** applies per-parameter Gaussian noise to every event in the list (the precision-control layer from §2.2 of the experiment plan). Independent σ for pitch (cents), timing (ms), intensity (dB), onset attack (ms), formant centroid (Hz). Seeded RNG for reproducibility.

The output is a list of dictionaries — one per acoustic event — each describing onset time, pitch, duration, intensity, envelope shape, formant targets, voice quality (for the vocal renderer), and probe / violation tags (for the experiment runner's trigger codes). This list is the contract with the renderers.

**Estimate:** 8–12 weeks for a complete implementation including unit tests, with the bulk of the time on the hierarchical Markov logic and on the pitch-system quantisation slider.

### 4.2 PitchedRenderer

Consumes the event list, produces a numpy float32 audio array.

Implementation sketch in numpy/scipy:

```
for each event in event_list:
    sample event start = round(event.onset_s * sr)
    # generate carrier (sine / triangle / additive depending on timbre setting)
    carrier = generate_carrier(event.pitch_hz, event.duration_s, sr)
    # apply formant filter for "vowel-like" timbre option (single fixed formant)
    if event.timbre_mode == 'formant_filtered':
        carrier = apply_formant_filter(carrier, formant_hz, bandwidth_hz)
    # apply ADSR envelope
    envelope = adsr(event.attack_ms, event.decay_ms,
                    event.sustain_level, event.release_ms,
                    event.duration_s, sr)
    # mix into output buffer at sample-accurate onset
    output[sample_start:sample_start+len(carrier)] += carrier * envelope
output = apply_brick_wall_limiter(output, max_db=-1.0)
output = loudness_normalise(output, target_lufs=-23.0)
```

What's deliberately absent: vocal source-filter modelling (that's the other renderer), reverb, compression beyond the limiter, any effect that would obscure the relationship between symbolic parameters and acoustic outcome.

**Estimate:** 4–6 weeks for a clean implementation with tests and the standard set of carriers (sine, triangle, formant-filtered noise, additive piano-like).

### 4.3 VocalisationRenderer

The hard module. Source–filter model with the LF glottal source driving a cascade of bandpass filters representing the vocal tract resonances.

Components:

- **LF glottal source** — generates a glottal flow waveform with controllable open-quotient, return-phase, and amplitude, parameterised over time so that voice quality (modal / breathy / pressed) can shift during a vocalisation. F0 is the rate of glottal cycle repetition; F0 contour is supplied externally.
- **Formant cascade** — three parallel/series biquad bandpass filters with time-varying centre frequencies F1, F2, F3 and bandwidths. The F1/F2/F3 trajectories are interpolated from waypoints supplied by the symbolic generator. Independent control of F0 and formants is the key capability that Mode B needs.
- **Aspiration noise generator** — bandpass-filtered white noise modulated by the inverse of the glottal flow (more aspiration during open phase). Level controllable for breathy / pressed distinctions.
- **Amplitude envelope** — overall intensity contour, ADSR plus optional jitter on the attack time (Mode A's σ_onset).
- **Vibrato / tremolo LFO** — sinusoidal modulation of F0 and amplitude. Rate and depth controllable.

Validation method: re-synthesise a small library of natural vocalisations (a laugh, a cry, an "ah", a "coo") by hand-tuning the parameters and confirming spectral and perceptual match. If the validation library can be re-synthesised convincingly, the renderer is ready to generate parametric stimuli with controlled deviations from those exemplars.

This is where the project's largest single execution risk sits. The published LF model is well-defined and there are open-source reference implementations (e.g., the implementation in Praat's source code, and the work by Drugman and others on Liljencrants-Fant modelling), but achieving naturalism still requires perceptual iteration.

**Estimate:** 4–8 months of focused work, with the wide range reflecting how much vocal-naturalism iteration the modes actually demand. Modes A and B can tolerate a renderer that is *clearly synthesised but parametrically clean*. Mode E (self-simulation) benefits most from naturalism, because the cross-decoding test asks whether listening EEG patterns align with production EEG patterns — and naturalism likely helps that alignment.

A pragmatic fallback for Mode E: instead of synthesising the vocalisations, record a participant's own voice in the production block and resample / time-stretch / pitch-shift the recordings to create the parametric variations. This avoids the synthesis problem entirely for Mode E, at the cost of variability across participants in the source material.

### 4.4 Rendering pipeline

Wraps the renderers. For each requested stimulus:

1. Read the event list and the renderer choice.
2. Render to a float32 buffer.
3. Compute integrated loudness (LUFS, via `pyloudnorm`); normalise to a target level (e.g., −23 LUFS for sustained passages, with peak headroom for startle probes).
4. Apply a brick-wall limiter (−1 dBFS peak).
5. Write WAV (48 kHz / 24-bit) and JSON sidecar.
6. Run automated QC: confirm realised loudness within ±0.5 LU of target, realised information rate per layer within ±10% of intended, no clipping, no DC offset.

Stimuli that fail QC are flagged; the experimenter decides whether to re-render or to record the QC failure as a known property.

**Estimate:** 3–4 weeks.

### 4.5 Experiment runner

PsychoPy-based, mode-aware via a configuration file rather than separate scripts.

Key responsibilities:

- Audio playback through `sounddevice` with ASIO (Windows) or CoreAudio (macOS) backend. Pre-load the next trial's WAV during the inter-trial interval to avoid disk-load latency.
- TTL triggers via Cedrus StimTracker or LabJack U3 USB, fired at sample-accurate onset times derived from the JSON event list. Critical: trigger-to-audio jitter ≤ 1 ms, validated each session.
- LSL marker stream as a redundant channel for offline alignment.
- Audio loopback channel recorded onto the EEG amplifier's aux input — this is the final ground-truth alignment between audio and EEG.
- Behavioural rating UI (Likert sliders for musicality, liking, urge to move, arousal, valence, familiarity, beat confidence).
- Calibration routine: at session start, plays a 1 kHz tone at known digital amplitude through the insert earphones into a calibration coupler; confirms target dB SPL at the participant's ear. Logs the calibration result with the session data.

**Estimate:** 6–8 weeks, with most of the time spent on trigger validation and on building a robust audio playback path.

---

## 5. Release tiers

Each tier produces a runnable system that unlocks specific modes. Tiers can overlap in time — the VocalisationRenderer (Tier 3) is developed in parallel with Tier 2 — but the deliverable structure is linear.

### Tier 0 — Infrastructure (weeks 1–4)

Goal: validate the full chain end-to-end with a placeholder synthesiser before any experiment-specific work.

- Project skeleton, Python package layout, CI, JSON schema version 0.1.
- ExperimentRunner skeleton with a "play a sine, fire a trigger" trial.
- Hardware procurement and benchmark: audio interface, trigger box, insert earphones, calibration mic.
- Trigger-to-audio loopback test. Target ≤ 1 ms jitter; document actual.
- LSL marker stream confirmed.
- Pre-registration template for Mode C (drafting the first study while infrastructure work is happening).

**Output:** a system that plays beeps with EEG triggers correctly. Nothing scientifically interesting, but every later piece depends on this chain working.

### Tier 1 — PitchedRenderer + L1 sequencer + Probes (months 2–6)

Goal: ship Mode C.

- PitchSystem (basic — EDO and 12-EDO diatonic enough for now).
- L1 beat sequencer with isochrony, tempo, accent-pattern control.
- PitchedRenderer with sine and simple formant-filtered timbres.
- ProbeInjector for startle probes (50 ms 100 dB white-noise burst) with on-beat / pre-beat / off-beat placement.
- Loudness normalisation and brick-wall limiter.
- JSON sidecar v1.0 schema frozen.
- Automated QC pass.
- ExperimentRunner mode-aware.
- Mode C pilot study (n = 8) to validate timing and effect direction.

**Output:** Mode C runnable. First paper feasible 9–12 months from project start.

### Tier 2 — Full hierarchical sequencer + L2/L3/L4 + violations (months 7–12)

Goal: ship Modes D, F, G, H.

- L2 motif sequencer (Markov over scale degrees).
- L3 phrase sequencer (motif vocabulary, repetition probability).
- L4 form sequencer (explicit schedule rather than emergent-from-Markov; this is more reliable).
- Violation injector for level-tagged violations (acoustic, pitch, motif, structural).
- Full PitchSystem with octave division (5-EDO through 24-EDO), scale subset rules, quantisation slider, mistuning, tonal-centre weighting.
- Familiarisation-block infrastructure (multi-session exposure logging) for Mode F.
- Mode G pilot (octave division + scale learning).
- Mode D pilot (hierarchical violations).

**Output:** Modes D, F, G, H runnable. Three additional papers feasible.

### Tier 3 — VocalisationRenderer (months 9–18, parallel track)

Goal: ship Modes A, B, E.

- LF glottal source.
- Three-formant cascade with independent F0/F1/F2/F3.
- Voice quality controls (modal / breathy / pressed).
- Aspiration noise generator.
- Vibrato / tremolo LFO.
- Validation library: a small set of natural vocalisations re-synthesised to perceptual match.
- Mode B pilot (affective vs phonemic axis).
- Mode A pilot (precision sweep).
- Mode E (self-simulation localiser) — including production block protocol and the recorded-voice fallback path.

This track runs in parallel with Tier 2 because it has no dependency on the hierarchical sequencer. It is staffed independently if possible.

**Output:** Modes A, B, E runnable. Three more papers feasible. Total addressable papers from the synth: eight.

### Tier 4 — Adaptive mode + Researcher GUI (months 15–24)

Goal: individualised optimal-complexity work, plus quality-of-life.

- Bayesian / staircase procedure for individualised information-rate estimation (Mode F full version). This is *between-trial* adaptation — the next pre-rendered stimulus is chosen based on responses to previous ones — and stays in Python.
- Researcher GUI: auditioning interface (live synthesis via the same renderers), batch renderer, QC dashboard, stimulus library browser.
- Versioned stimulus library with provenance.
- API for external collaborators to reuse the synth.

**Output:** a research platform usable by people other than the original developer. Mode F's individualised analyses become tractable.

### Tier W — Public web synthesiser + global preset library (months 5–12, parallel with Tier 2)

Goal: deliver the free-exploration arm of Phase 0 — a browser-native interactive synthesiser that any visitor can use, with personal preset saving and voluntary contribution to a global research corpus.

This is the most user-facing piece of the project and the one with the most ongoing maintenance burden, but it is also the one that produces the most distinctive data: thousands to millions of intentionally-curated aesthetic configurations from self-selected creators. The investment is justified by the data corpus it produces, by its role in establishing the synth as a research instrument in the public sphere, and by the validation it provides for the lab studies ("the parameter values we tested in EEG are the values real people gravitate to in the wild").

**Why a browser-native port rather than server-rendered streaming.**

The Tier P Psynet paradigms (slider, pairwise, GSP) deliver one stimulus per trial — server-side rendering with cache works perfectly. Free exploration is different: the user expects to twiddle a knob and hear immediate sonic change. A 200 ms server round-trip on every parameter adjustment destroys the perceptual coupling that makes the tool feel like an instrument. The synth needs to run *in the browser*, with parameter changes resolving inside the audio callback at sub-frame latency. This is a real port, not a configuration tweak.

**Stack additions.**

- **JavaScript / TypeScript synth engine** using Tone.js for high-level scheduling and basic sound sources, plus Web Audio API AudioWorklet nodes for any custom DSP (e.g., the LF glottal source when the vocal renderer is ported in a later wave). Tone.js handles ADSR envelopes, oscillators, filters, and timing; AudioWorklet runs custom DSP off the main thread.
- **Browser-side symbolic generator** — a JavaScript port of the Markov chains, scale generators, and motif transformers. This is mechanical and well-tested in the Python version; the port is straightforward but must produce *bit-identical* event lists for matched seeds so that lab and web stimuli are reproducible across implementations.
- **React + Web UI** for the player interface: slider/knob controls for each parameter group, transport (play/stop/loop), preset save/load, library browser, contribution prompt. Tailwind for styling. Designed to feel like a music tool, not a survey.
- **Backend services** (Python, FastAPI, deployed on AWS/Heroku):
  - Anonymous session tracking and engagement metrics (time spent, presets saved, revisits)
  - Preset save/sync (optional cloud sync for registered users; IndexedDB local-only by default)
  - Global library API (browse, search, contribute, withdraw)
  - Contribution-eligibility logic (threshold checks: minimum engagement before the contribution prompt is shown)
  - Postgres database for presets and metadata
  - Curation tooling for the research team (flag low-quality contributions, dedupe near-identical presets, export for analysis)
- **Hosting**: static frontend on Cloudflare Pages / Vercel (free or low-cost), backend on a small AWS or Heroku instance (~£50–200/month depending on traffic). Hosting cost scales with usage; budget for a year of moderate traffic.

**Parameter-compatibility audit.**

The web synth and the Python lab synth must produce perceptually indistinguishable audio for matched parameters. A periodic audit renders the same parameter spec through both implementations and compares the resulting audio: spectral centroid, RMS envelope shape, F0 trajectory, onset timing. Discrepancies above perceptual threshold are bugs in one renderer or the other. This audit runs in CI; any commit that breaks parameter compatibility blocks the release.

**Preset and contribution data model.**

A contributed preset is exactly the JSON sidecar already defined in §2.3 (the same schema used for EEG stimuli), plus a small contribution-metadata block:

```
{
  "preset_id": "uuid",
  "synth_params": { ... },           // identical schema to EEG sidecar
  "synth_version": "1.4.2",          // for reproducibility across versions
  "contributed_at": "ISO 8601",
  "engagement": {
    "time_crafting_seconds": 480,
    "revisit_count": 7,
    "self_tagged_favourite": true
  },
  "self_report": {                   // all optional
    "tags": ["dreamy", "atmospheric"],
    "mood": "calm",
    "genre_association": "ambient",
    "rationale_text": "I like how the repetition feels..."
  },
  "demographics": {                  // all optional, pre-screen
    "age_band": "25-34",
    "musical_training_years": 5,
    "primary_listening_genres": ["jazz", "electronic"],
    "country": "GB"
  }
}
```

Withdrawal is implemented as a tombstone (the row is retained but flagged not-for-research-use); this preserves stability of any DOI-cited corpus snapshot while honouring the contributor's intent.

**Engagement-weighted analysis.**

Not all contributions are equally informative. The analysis pipeline weights each preset by an engagement score derived from time crafting, revisit count, and explicit favourite-flag, with weights piloted empirically against a hand-curated subsample of high-effort presets. This dampens the influence of accidental saves and exploratory configurations the contributor wasn't actually committed to.

**Selection-bias mitigation by cross-arm comparison.**

The web-tool sample is self-selected; the Psynet sample (Tier P) is recruited. Reporting the two sample distributions side-by-side, with parameter-by-parameter overlay plots, lets readers see exactly how the self-selected creator population diverges from the recruited population. Where they agree, both findings are strengthened; where they diverge, the divergence is interpretable rather than a hidden confound.

**Output:** a live, recruiting, voluntary-contribution web tool that produces a growing public corpus of aesthetic presets. First publishable result from this arm is the launch paper describing the tool and a snapshot of the global library at, say, N = 5,000 contributed presets — feasible 12–18 months from project start. Subsequent papers analyse the corpus as a research resource. The launch paper is independently publishable alongside the Tier P Psynet population-mapping paper.

### Tier P — Psynet web deployment for Phase 0 population mapping (months 4–9, sequential with Tier 1; parallel with start of Tier 2)

Goal: deliver the population-scale discovery phase before the confirmatory EEG modes are designed.

This tier is the bridge between the synth and a large-N online sample. It is sized to be runnable as soon as Tier 1 (PitchedRenderer + L1 sequencer) is complete, which is months earlier than the confirmatory studies. The Phase 0 data informs the parameter ranges and central points used in Tiers 2 and 3.

**Why Psynet specifically.** Psynet (Harrison et al., built on Dallinger) is Python-based, integrates with Prolific for recruitment, supports the four paradigms (slider, pairwise, GSP, continuous rating) the discovery phase needs as first-class experiment types, handles ethics-grade data storage, and runs on standard cloud infrastructure (AWS/Heroku). Building an equivalent in-house would be 6+ months of work duplicating mature open-source infrastructure. Using Psynet, the integration work is mostly schema mapping and a thin adaptor layer.

**Stack additions.**

- **Psynet + Dallinger** running on a cloud server (Heroku for early waves, AWS for scale). Python-native, so the existing symbolic generator and PitchedRenderer code import directly.
- **Server-side rendering service**: a Flask or FastAPI process that accepts a JSON parameter spec (the same schema as Tier 0's sidecar), runs the symbolic generator + renderer, and returns a WAV. Stimuli are cached by (synth-version-hash, parameter-spec-hash) so repeated requests hit cache, not the renderer.
- **Audio delivery to the browser**: standard HTTP streaming of pre-rendered WAVs. Browser playback via the Web Audio API, with `preload="auto"` and small leading silence to mask buffering latency. We do *not* port the synth to JavaScript / Web Audio — that's an unnecessary rewrite given the server-side rendering pattern works.
- **Recruitment via Prolific** at ~£8/hour. Demographic and listening-history pre-screens align with the in-lab Goldsmiths MSI for cross-study comparability.

**What runs in the browser, and what doesn't.**

- *In the browser:* audio playback, sliders, rating UI, pairwise-choice UI, GSP iteration logic (provided by Psynet), demographic forms.
- *On the server:* stimulus generation via the Python synth, response logging, adaptive algorithm state, data export.

This split keeps the browser thin (audio playback is well-supported, novel DSP is not) and concentrates novel code in Python on the server where it is already maintained for the lab studies. The same renderer code path runs in lab and online; bugs are fixed once.

**Latency profile (online).**

Population-mapping paradigms don't require lab-grade timing. Pre-rendered stimuli streamed to browsers achieve typical playback start latencies of 100–500 ms (acceptable for slider / pairwise tasks that don't depend on neural-millisecond alignment), and the audio itself plays sample-accurately once started (browser audio engines are reliable for playback timing, just not for trigger fanout). No EEG, no triggers required.

**Data export.**

Each session exports a JSON file with the full trial-by-trial parameter trajectory, ratings, response times, demographic data, and the synth-version hash so that any reported finding can be reproduced from the same code path. Population data is filed alongside the corresponding Mode's pre-registration and feeds into the central-point and range decisions for that Mode.

**Output:** a deployed, recruiting Psynet study that produces population preference data within 6–9 months of project start. First publishable result (the population aesthetic-preference landscape paper) is feasible before the first lab paper, and serves as the empirical foundation for everything that follows.

### Tier 5 — Real-time interactive engine for Mode I (months 18–30, parallel-tracked)

Goal: ship Mode I (interactive aesthetic-optimum exploration).

This tier is architecturally distinct from Tiers 0–4 because it requires *real-time* synthesis with sub-20-ms input-to-audio latency, which is outside the pre-rendered Python pipeline's design centre. Building it as a separate engine that interoperates with the existing Python infrastructure is the right call; rebuilding the whole stack in C++ would be vast overkill for the one mode that needs it.

**Stack additions.**

- **SuperCollider 3.13+** as the real-time synthesis server. Reasons: well-supported in computer-music research, native sub-10-ms latency on macOS/Linux with proper driver setup, parameter ramping is a language primitive (`Lag`, `VarLag`), OSC interface is first-class, lab community familiarity. Alternatives — JUCE/C++ or Faust — are viable but would force the project to maintain a custom audio engine; SuperCollider's scsynth already is one.
- **SuperCollider patch (SynthDef)** that re-implements the Tier 1+2 sequencer's *audio-rate output stage* in SC's signal-flow language. The symbolic generation can stay in Python — Python generates the event schedule, sends it to SuperCollider via OSC, and SuperCollider plays it back through its sound source with the controlled parameter applied at audio rate. Only the *parameter being interactively controlled* needs to be a live variable inside the patch; everything else is set per trial.
- **python-osc** for the Python ↔ SuperCollider OSC bridge.
- **MIDI controller** for participant input: Korg nanoKONTROL2 (8 sliders + 8 knobs, ~£60) or Behringer X-Touch Mini (8 rotary encoders + buttons, ~£75). Both are USB-MIDI class-compliant; Python reads via `mido` or PsychoPy's MIDI module and forwards to SuperCollider.
- **Audio interface and trigger box** as in Tiers 0–1; no new hardware needed beyond the MIDI controller.

**Latency budget and validation.**

The target is ≤ 20 ms from physical knob turn to audible parameter change at the participant's ear. Budget breakdown:

| Stage | Typical | Budget |
|---|---|---|
| USB-MIDI controller → Python event handler | 1–3 ms | 5 ms |
| Python OSC send → SuperCollider receive | 0.5–2 ms | 3 ms |
| SuperCollider parameter ramp start (≤ 1 audio buffer) | 1.3 ms @ 64-sample / 48 kHz | 2 ms |
| Audio buffer → DAC → ear | 5–10 ms | 10 ms |
| **Total** | **8–16 ms** | **20 ms** |

The audio-loopback validation routine from Tier 0 is extended: a USB MIDI event injected programmatically triggers both a TTL pulse and a SuperCollider parameter change; the parameter change is verified to produce an audible spectral shift in the loopback within the budget. This validates the whole chain end-to-end per session.

**Parameter-ramping discipline.**

Direct parameter jumps cause zipper-noise artefacts that contaminate the stimulus. SuperCollider's `Lag.kr` or `VarLag.kr` provides exponential or linear smoothing at audio rate. The default smoothing time should be ~50 ms — fast enough that the participant feels coupled to the control, slow enough to avoid clicks. The smoothing time itself is a parameter: for some experiment variants (e.g., testing whether the participant can detect parameter changes), it may be desirable to ramp slower.

**Triggers for EEG.**

The Python orchestrator continues to fire TTL triggers via the hardware trigger box. The new trigger codes are:

- Trial start (parameter at random initial value)
- Each parameter-adjustment event (with the new value logged in LSL metadata, *not* a separate hardware trigger — the EEG sample timestamps suffice for trajectory analysis)
- "Adoption" trigger when the participant has held the control within ε for ≥ 5 s
- Trial end

The settling epoch is the analytically clean window; the trajectory data are continuous logs aligned to the EEG via LSL.

**What stays in Python.**

Everything outside the audio inner loop. Trial scheduling, MIDI event ingestion, TTL trigger firing, LSL marker streaming, behavioural rating UI, data logging, all analysis. Python is the orchestrator; SuperCollider is the instrument.

**Output:** Mode I runnable. Total addressable papers from the synth becomes nine. The hybrid architecture is documented as a reference pattern for any future closed-loop experiments (e.g., EEG-state-contingent stimulus modulation), so adding such studies later is a straightforward extension rather than a rebuild.

---

## 6. Stack decisions

**Language: Python 3.11+.** Reasons: the sequencer is symbolic and Python is the natural fit; numpy/scipy handle the DSP for both renderers without performance issues at offline rendering speeds; PsychoPy is Python; MNE-Python is the downstream EEG analysis target so the whole stack is one language; hiring and handover are easier than SuperCollider or Csound.

### 6.1 Why not C++ for lower audio latency

A reasonable instinct: surely a C++ stack would give us tighter trigger-to-audio timing? The answer is no, for our specific use case, and it is worth documenting why so that the question doesn't keep returning.

The latency-critical path in EEG stimulus delivery is not in the language the sequencer is written in. It is in the audio driver and the trigger hardware. When Python's `sounddevice` plays a WAV, it wraps PortAudio, which is C, which dispatches the audio buffer to CoreAudio (macOS), ASIO (Windows), or JACK/ALSA (Linux). The audio-callback loop itself runs in a real-time priority C thread inside the driver; Python's role is only to hand a pre-loaded buffer to that thread and to fire a TTL trigger via a hardware trigger box at the appropriate sample. A C++ program would call the same drivers via the same APIs and obtain the same playback latency. The trigger itself does not flow through user-space code at all — it leaves the machine via a hardware trigger box (Cedrus StimTracker, LabJack U3) whose own microcontroller handles the timing.

Concretely: with ASIO or CoreAudio at a 64-sample buffer and a hardware trigger box, trigger-to-audio latency lands in the 5–10 ms range with sub-millisecond jitter, in either language. PsychoPy — which is Python — is the lab-standard EEG experiment runner precisely because it routinely achieves this on properly configured systems.

C++ would offer genuine advantage in two scenarios. The first applies to us: real-time interactive synthesis during the EEG session, where a participant controls a synthesis parameter via a physical knob and the audio must respond within a perceptually-coupled latency budget (≤ 20 ms round trip, ideally ≤ 10 ms). This is exactly the use case for Mode I (interactive aesthetic-optimum exploration). For Mode I we adopt a hybrid stack: Python orchestrates the experiment as in all other modes, but the real-time synthesis runs in SuperCollider, communicating with Python via OSC. SuperCollider's audio thread, parameter ramping semantics, and sub-10-ms input-to-output latency are what the closed-loop paradigm requires; Python could not match this without substantially more engineering effort and would still be at a structural disadvantage from the GIL.

The second scenario — applications shipped to end users where startup time and binary size matter — does not apply.

For Modes A–H (pre-rendered stimuli), nothing in the C++ argument bites: the audio callback is already running in C-level driver code regardless of which language wrote the WAV, and hardware trigger boxes handle timing outside user-space. Python plus numpy plus PsychoPy delivers the same timing as a C++ equivalent for these modes.

The performance escape hatch we should keep available regardless: if any inner DSP loop becomes a bottleneck during stimulus pre-rendering (the most likely candidates are the LF glottal-source generator and the formant filter cascade when batching thousands of stimuli), port that single function to C via Cython, or rewrite it as vectorised numpy operations that already run at C speed under the hood. The rest of the stack stays Python. This is the pattern numpy, scipy, and librosa use internally and it gives near-native performance without paying the cost of writing the whole system in C++.

The summary: choose C++ when the language choice changes the latency you can deliver to the participant's ear, or when real-time synthesis is required. Neither holds here. For pre-rendered EEG stimuli with hardware trigger boxes, Python plus numpy plus PsychoPy is the lower-risk, faster-to-ship, easier-to-maintain choice that meets the timing requirements identically.

**Audio DSP libraries:** `numpy`, `scipy.signal`, `soundfile`, `pyloudnorm`, `librosa` (for validation/analysis only). For the LF glottal source, port the published model into pure numpy rather than depending on an external native library — the model is simple enough that this is the lowest-maintenance path.

**Experiment runner: PsychoPy.** The Python ecosystem is the deciding factor; PsychoPy is mature, integrates with parallel-port and USB trigger boxes, and the lab community is large.

**Trigger hardware: Cedrus StimTracker Quad or LabJack U3.** Both deliver sub-millisecond TTL latency; both work cross-platform. StimTracker is more polished but more expensive.

**Audio interface: RME Fireface UCX II (preferred) or Focusrite Scarlett 4i4 (budget).** The RME's driver stability and round-trip latency are well-documented in EEG labs; the Scarlett is acceptable if validated.

**Insert earphones: Etymotic ER-3C.** Standard in psychoacoustics; the manufacturer-supplied calibration curve is usable.

**Calibration mic: miniDSP UMIK-1.** USB, factory-calibrated, ~$100. Sufficient for the dB-SPL calibration required.

**EEG amplifier:** assumed pre-existing. The system must accept TTL triggers via parallel port or USB; modern Brain Products, Biosemi, and EGI systems all do.

**Synchronisation: LSL + audio loopback.** LSL for marker stream redundancy. Audio loopback (output cable into an aux EEG channel) for ground-truth offline alignment.

**Storage and reproducibility: Git for code, Git-LFS or DVC for stimulus library, BIDS-compatible derivatives for EEG output.** Every stimulus is reproducible from (code commit hash + JSON sidecar + random seed). The stimulus library can be regenerated at any time.

---

## 7. Practical risks and mitigations

**Risk: Trigger jitter exceeds 1 ms.**
This kills sub-millisecond ERP timing. Mitigation: validate every session with audio loopback; for the on-beat PPI experiment specifically, the audio-loopback channel onto EEG aux is the offline truth — even if trigger jitter is 2 ms, post-hoc realignment from the audio channel recovers timing. If software trigger paths prove unreliable, fall back to hardware audio-trigger boxes (StimTracker has an audio-onset trigger mode that fires from the audio waveform itself).

**Risk: VocalisationRenderer never reaches perceptual naturalism.**
Mitigation: design Modes A, B, E so that "clearly synthesised but parametrically clean" is acceptable. The theory's claim is about acoustic parameters, not about realism. For Mode E specifically, the recorded-voice fallback (participants' own vocalisations, parametrically manipulated by pitch-shifting / time-stretching) sidesteps the synthesis problem entirely.

**Risk: Pitch-quantisation slider is hard to implement smoothly.**
Mitigation: implement as a Gaussian attractor — for each rendered continuous-pitch value, sample from a Gaussian centred at the nearest grid point with σ scaled by (1 − quantisation_strength). At strength = 0 the contour is free; at strength = 1 the σ is zero and pitch snaps to grid. Test that the slider produces audibly graded discretisation in pilot listening sessions before relying on it in Mode G.

**Risk: L4 form-level entropy is hard to compute reliably from emergent Markov processes.**
Mitigation: don't try. Define form-level schedules explicitly (e.g., AABA, ABCBA, theme-return-after-N-bars) and compute entropy from the explicit schedule. The Markov assumption breaks at the form level anyway because long-range structure is not a first-order process.

**Risk: Stimulus library balloons combinatorially.**
With independent parameters at multiple layers, the full factorial design has hundreds of thousands of cells. Mitigation: pre-define experimental design matrices per mode; render only the cells that appear in those matrices. The symbolic generator can produce any stimulus on demand, so the rendered library is finite and small.

**Risk: JSON schema breaks reusing old stimuli after a refactor.**
Mitigation: version the schema (semver); ship a migration script for every breaking change. Treat old stimuli as immutable; only newly-rendered stimuli use the new schema.

**Risk: Loudness equalisation across stimulus types is imperfect.**
Different timbres, pitch ranges, and durations have different perceived loudness even at matched integrated LUFS. Mitigation: in pilot, ask listeners to rate perceived loudness across the full stimulus space; iterate the normalisation target until perceived loudness is flat. For startle probes specifically, calibrate by dB SPL rather than LUFS.

**Risk: Researcher single-point-of-failure.**
Mitigation: documentation as a first-class deliverable. Every module has a README, examples, and a test suite. The handover document is written before the work, not after.

---

## 8. What deliberately is *not* being built

- Real-time interactive performance synthesis *for the pre-rendered modes (A–H)*. Mode I is the deliberate exception and uses the SuperCollider engine specifically because real-time is the point of that experiment.
- High-fidelity sampled instruments. Defeats the point of removing learned associations.
- Audio effects (reverb, chorus, compression beyond a brick-wall limiter). Adds variance without informational value.
- Spatial audio / room simulation. Same reason.
- A participant-facing GUI for free musical exploration. Out of scope.
- MIDI input from external controllers, except possibly in the auditioning interface for the researcher.
- Cross-platform mobile / browser playback. Lab desktop only, at least for EEG sessions. (Behavioural-only data collection via Psynet could be added later if needed.)

These exclusions are listed because they will be requested — by collaborators, by reviewers, or by your own future self — and each request costs months. Being explicit now lets you decline politely with reference to this document.

---

## 9. Cost and timeline summary

| Tier | Deliverable | Unlocks | Duration |
|---|---|---|---|
| 0 | Infrastructure, trigger chain, JSON v0.1 | nothing scientifically, but de-risks everything else | weeks 1–4 |
| 1 | PitchedRenderer + L1 sequencer + probes | Mode C, and powers Phase 0 Waves 0A and 0B | months 2–6 |
| P | Psynet web deployment for Phase 0 | Population-scale discovery (Waves 0A → 0E as later tiers complete) | months 4–9 |
| 2 | Full hierarchical sequencer + violations | Modes D, F, G, H; powers Phase 0 Waves 0C and 0D | months 7–12 |
| 3 | VocalisationRenderer (parallel track) | Modes A, B, E; later powers Phase 0 Wave 0E | months 9–18 |
| 4 | Adaptive mode + GUI | Mode F full version, broader lab use | months 15–24 |
| 5 | Real-time interactive engine (Python + SuperCollider) | Mode I | months 18–30 |

**First publishable result:** the Phase 0 population aesthetic-preference landscape (Waves 0A + 0B), ~6–9 months from project start. This serves as the empirical foundation for the lab programme and establishes the synth as a research tool in its own right. The on-beat PPI result (Mode C) follows ~9–12 months from start as the first confirmatory mechanistic paper — the cleanest single falsification of the motor-suppression theory's distinguishing prediction and strong enough to anchor a thesis chapter.

**Full eight-mode programme:** approximately 24 months of focused work for the synth and pilot studies, with the full experimental programme (n = 30–40 per mode, multiple sessions) extending across the remainder of a PhD timeline.

**Direct hardware cost:** audio interface (£500–1,200), insert earphones (£300), trigger box (£300–800), calibration mic (£100), miscellaneous cabling (£100). Total: £1,300–2,400. EEG amplifier and lab PC assumed pre-existing.

---

## 10. Summary

One Python codebase, two swappable audio renderers for the eight pre-rendered modes (A–H), a hybrid Python + SuperCollider real-time engine for the interactive Mode I, and a Psynet web deployment for the population-scale discovery phase. Six release tiers.

Pitched-music modes ship first because they're easier, because Mode C delivers the cleanest single falsification of the theory, and because the same PitchedRenderer powers the early Phase 0 Psynet waves — meaning Tier 1's investment pays off twice. The Psynet deployment (Tier P) goes live as soon as Tier 1 is rendering, so population data is collected in parallel with Tier 2 development and feeds back into the design of the later confirmatory studies. The vocalisation renderer is developed in parallel and isn't a blocker. The real-time engine is parallel-tracked after Tier 2, because Mode I is a converging measure on Mode F rather than a prerequisite.

Every pre-rendered stimulus is reproducible from a seed and a JSON sidecar. Pre-render everything for Modes A–H; never live-synthesise during EEG recording for those modes. The Psynet deployment uses the same server-side rendering pattern — browser plays pre-rendered audio, server runs the Python synth. Validate the trigger chain (lab modes) and the full knob-to-ear loop (Mode I) every session with audio loopback.

The instrument is not a music-making tool. It is both a confirmatory EEG stimulus engine and a discovery-phase data-collection instrument, designed to make nine specific lab experiments possible while removing the confounds (learned associations, genre familiarity, performance expression) that have made every previous attempt at testing these theories ambiguous, *and* to map the population-scale aesthetic landscape that grounds those lab experiments empirically. Once the current programme is done, the same engine — confirmatory in the lab, discovery online — remains useful for whatever the next set of theoretical questions turns out to be. The hybrid architecture established in Tier 5 generalises naturally to any future closed-loop paradigm, including EEG-state-contingent stimulus modulation. But the build plan above is sized to the current programme, not to indefinite future ambition.
