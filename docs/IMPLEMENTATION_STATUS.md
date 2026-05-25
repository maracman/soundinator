# Implementation Status

This build follows `Synthesiser Build Plan.md` as a staged research instrument rather than a one-shot monolith.

## Built Now

Tier 0/Tier 1 foundations:

- Python package layout and CLI
- event schema version `0.1.0`
- EDO `PitchSystem` with scale subsets and quantisation helper
- L1 beat sequencer for Mode C
- small first-order L2 Markov motif sequencer for early Tier 2 work
- startle probe injector with on-beat, pre-beat, and off-beat trigger codes
- reproducible jitter stage for pitch, timing, intensity, attack, and duration
- offline `PitchedRenderer`
- render pipeline with WAV export, JSON sidecars, seed/provenance metadata, and QC
- dry-run experiment runner that derives trigger schedules from sidecars
- Web Sound Studio deployment prototype:
  - dependency-light Python HTTP server
  - client-side Web Audio rendering for live exploration
  - server-side rendering/caching endpoint retained for validation and high-fidelity re-renders
  - browser controls for scale, melody, root pull, register, rhythm, rests, motif repertoire, surprise/incorporation, breaks, percussion, convolution reverb, rating, and presets
  - Sub-note workspace with Formant and Fourier sound-source modes
  - Formant mode: vowel palette, formant switching, colour/filter drift, resonance drift, and breath/noise
  - Fourier mode: per-harmonic amplitude mean/SD controls, dynamics sensitivity, register sensitivity, instrument resonances, loudness normalisation, and held-note harmonic drift
  - vibrato and ADSR envelope distributions
  - personal preset saving in browser `localStorage`
  - direct community preset submissions to `web/data/global_presets.json`
  - session-event logging for play/save/share events
- tests covering pitch, event generation, jitter reproducibility, rendering, WAV export, and sidecar creation

## Deliberately Stubbed

- `VocalisationRenderer`: Tier 3. It needs the LF glottal source, time-varying formant cascade, aspiration noise, and validation against natural vocalisations before Modes A/B/E should use it.
- `PsychoPyExperimentRunner`: requires lab hardware decisions and installed PsychoPy/trigger dependencies.
- SuperCollider real-time engine: Tier 5 for Mode I.

## Current Mode C Caveat

The Mode C demo includes high-intensity startle probes. Because those probes consume the available digital peak headroom, whole-file RMS/LUFS can sit below the nominal target after peak limiting. That is expected for startle-bearing files unless the bed is calibrated lower or probes are rendered/played through a separate calibrated path.

Before piloting with participants, decide the lab calibration convention:

- single WAV path with baseline bed kept low enough to leave probe headroom, or
- separate calibrated probe channel/path if the trigger/audio hardware supports it.

The sidecar keeps the intended SPL-style `intensity_db` metadata either way.

## Current Web Sound Studio Caveat

The current web app is the lightweight hostable prototype, not the full Psynet/Dallinger recruitment deployment. It is useful for sharing with collaborators and early participants, collecting favourite presets, and hardening the parameter schema. For paid large-N collection, wrap the same `synthesiser.web.phase0` rendering functions in Psynet so recruitment, consent, dropout handling, compensation, and ethics-grade data export are handled by the established experiment platform.

## Next Build Steps

1. Freeze JSON schema `1.0` once the lab trigger-code table is known.
2. Add a sidecar migration script before any breaking schema change.
3. Add a hardware loopback validation module once the audio interface and trigger box are chosen.
4. Expand Tier 2 sequencers: L3 phrases, L4 explicit form schedules, level-tagged violation injectors.
5. Start the vocal renderer as a separate branch of work with perceptual validation stimuli.
6. Add a Psynet adaptor that maps slider, pairwise, GSP, and continuous-rating trials onto the Phase 0 parameter schema.
