# How The Probabilistic Music Synthesiser Works

This document describes the current architecture at a practical level: what the
system generates, where the probabilities live, and how the browser interface
maps onto the audio engine.

## Core Idea

The synthesiser treats music as a set of nested probability distributions rather
than a fixed score. A seed plus a parameter set produces a reproducible stream
of motifs, notes, rests, articulations, and timbral details.

The web app is designed for listener exploration. A listener adjusts the
distributions until the result is aesthetically pleasing, saves that setting as
a preset, and can voluntarily contribute favourite presets to a shared library
for later research analysis.

## Main Timescales

### 1. Pitch Vocabulary

The Scale panel defines the available pitch classes.

- `12-tone` mode uses common scale presets such as major, minor, pentatonic,
  blues, dorian, mixolydian, harmonic minor, and whole tone.
- `N-EDO` mode divides the octave into an arbitrary number of equal steps.
- Notes can be off, in-scale, or weighted sub-scale notes.
- Sub-scale weighting makes selected notes more likely without removing the
  rest of the scale.

### 2. Note-To-Note Melody

The Melody panel shapes how the next note relates to the current one.

- Interval shape controls how much the melody prefers small steps over leaps.
- Interval range limits the maximum scale-degree leap.
- Hit probability controls whether playback hits the expected motif note.
- Hit range controls how far a miss can move in scale degrees.
- Tune probability and cents range add intonation variation around the target.

Hit probability is motif accuracy. Tune probability is pitch-cent accuracy. They
sound related, but they act at different musical levels.

### 3. Motifs And Repertoire

Motifs are short repeated patterns. The repertoire is the list and playback
order of those motifs.

- Motif count sets how many patterns exist at generation start.
- Motif length sets each motif's length in beats.
- Sequence probability controls fixed-order playback versus random motif choice.
- Surprise can change one note in a motif pass.
- Feature-specific surprise checkboxes and weights decide whether that note
  changes pitch, duration, formant, dynamics, rest state, or several of those at
  once.
- Incorporation can bake that surprise into the repertoire.
- Max baked limits how many surprise variants can be remembered.

When a surprise happens, the engine creates a projected continuation from the
surprised note using the ordinary generation rules. It then snaps back to the
original motif once the affected feature or features become compatible again.
For duration surprises, the current implementation uses the simpler
onset-alignment rule: it waits for projected and original duration positions to
align, otherwise it stays projected until motif end.

When a surprise is baked, the loop grows by appending a new cycle with that
projected motif variant included. This is intended to model "a variation
becoming part of the piece" rather than a one-off random error.

### 4. Rhythm, Rests, And Articulation

Rhythm controls note starts on a metrical grid.

- Beat divisions define rhythmic resolution.
- On-beat and off-beat probabilities control metrical and syncopated onsets.
- Same length encourages duration repetition.
- Rest ratios independently control motif-start rests, on-meter rests, and
  off-meter rests.

Breaks shape how adjacent notes connect.

- Positive break values leave silence before the next note.
- Zero or negative break values connect notes.
- Connected notes can slide into the next pitch at the selected slide speed.
- Phrase gap can still enforce separation at motif boundaries.

### 5. Sub-Note Tone Production

The Sub-note tab controls what happens inside each sounded note.

There are two sound-source modes:

- `Formant` mode uses a sawtooth source through vowel-like filters.
- `Fourier` mode uses additive sine partials at fixed harmonic frequencies.

The inactive sound path is greyed out and disabled. This matters technically:
Formant mode does not use Fourier amplitudes for playback, and Fourier mode does
not use formant colour drift.

## Formant Mode

Formant mode is a simplified vocal/resonator model.

The active vowel chip chooses three formant frequencies:

- F1
- F2
- F3

The engine sends a sawtooth oscillator through three parallel bandpass filters.
The formant-change probability can switch the vowel label between notes.

Colour Distribution controls small note-level variations:

- Formant drift shifts filter positions.
- Resonance drift changes filter sharpness.
- Breath adds noise-like texture.

This mode is useful for voice-like or reed-like timbres.

## Fourier Mode

Fourier mode is an additive harmonic model.

Each harmonic partial has a fixed frequency slot:

- H1 = 1 x f0
- H2 = 2 x f0
- H3 = 3 x f0
- and so on, up to the selected harmonic count

Each harmonic has its own amplitude distribution:

- `M` is the amplitude mean.
- `SD` is the standard deviation.
- `D` is dynamics sensitivity.
- `R` is register sensitivity.

For each note, the engine can sample every harmonic amplitude from its
distribution. During held notes, hold drift can keep sampling and gliding those
amplitudes so the timbre moves within the note instead of sounding frozen.

Dynamics and register then reshape the harmonic means:

- dynamics can make upper harmonics bloom or shrink
- register response can make the same instrument brighter or darker across low
  and high notes
- resonance response adds broad fixed instrument-body peaks
- loudness normalisation can partially correct amplitude draws so timbre changes
  do not become uncontrolled volume jumps

This mode is useful for instrument-like timbres and direct spectral research.

## Vibrato And Envelope

Vibrato is a distribution, not a single fixed oscillator.

- Chance determines whether a connected phrase receives vibrato.
- Depth and depth SD control cents-level pitch movement.
- Rate and rate SD control vibrato speed.
- Depth and rate are resampled every vibrato cycle.
- If notes are joined, vibrato phase continues across the join.

Envelope Distribution controls ADSR values:

- attack
- decay
- sustain
- release

Each value has a mean and SD. If envelope chance is zero, the mean values are
used directly.

## Web Architecture

The browser app lives in `web/static/`.

- `app.js` renders the interface, manages presets, handles user interaction, and
  draws probability visualisations.
- `synth.js` contains the generative engine and Web Audio rendering engine.
- `styles.css` defines the compact dashboard and Sub-note workspace.
- `index.html` loads the app.

The Python server lives in `src/synthesiser/web/server.py`.

It provides:

- static file serving
- health endpoint
- shared preset library endpoint
- study/session event endpoints
- optional server-side render endpoint

The web app renders audio client-side for immediate feedback. The server keeps
runtime data under `web/data/`, and that local data is ignored by git.

## Python Research Toolkit

The Python package under `src/synthesiser/` contains earlier and supporting
research infrastructure:

- pitch systems and EDO helpers
- event schemas
- sequencers and Markov-style motif tools
- jitter stages
- offline renderers
- WAV/sidecar render pipeline
- dry-run experiment runner

This code supports reproducible offline stimulus generation alongside the
browser-based exploration workflow.

## Reproducibility

The important reproducibility rule is:

```text
same seed + same parameters = same generated structure
```

The browser engine uses seeded pseudo-randomness for musical generation. Saved
presets store the parameter set, not rendered audio. Shared presets therefore
record the recipe that produced a sound, which can be replayed, compared, and
analysed later.
