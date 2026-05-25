# Probabilistic Music Synthesiser

A research synthesiser for exploring how people shape, hear, rate, save, and
share aesthetically pleasing algorithmic music.

The project combines two layers:

- a Python stimulus-generation toolkit for reproducible research material
- a hostable Web Audio sound studio where listeners can explore probabilistic
  musical settings, save local presets, and voluntarily add favourites to a
  shared preset library

The name is intentionally broader than "Markov music generator". The early
offline generator includes Markov-style motif work, but the current web
synthesiser also models scale-degree melody, motif surprise/incorporation,
articulation, rests, register, rhythm, formant tone, Fourier harmonic
decomposition, vibrato, envelope distributions, percussion, and convolution
reverb.

## Quick Start

Python 3.11 or newer is required.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev]"
python -m pytest
```

Run the local web app:

```bash
PYTHONPATH=src python -m synthesiser.web.server --host 127.0.0.1 --port 8765
```

Then open:

```text
http://127.0.0.1:8765
```

## Web Sound Studio

The Sound Studio is the current user-facing interface. It runs audio live in the
browser through Web Audio, while the Python server handles static hosting,
shared preset storage, and optional server-side rendering endpoints.

Listeners can:

- press Play to hear the current probabilistic synthesiser
- tune melody, scale, rhythm, register, surprise, articulation, rest density,
  percussion, and reverb
- switch the Sub-note sound source between Formant and Fourier modes
- edit per-harmonic amplitude means and standard deviations in Fourier mode
- save personal presets in browser localStorage
- voluntarily submit favourite presets to a shared research library

Local event logs and contributed preset libraries are written under `web/data/`.
That directory is ignored by git so participant/session data is not published by
accident.

## How It Works

The engine is organised around probability distributions at several musical
timescales:

- Scale and melody choose available pitch degrees and the likelihood of moving
  by different interval sizes.
- Motifs repeat, but notes can miss the expected motif target, drift in cents,
  or be changed by surprise events.
- Surprise happens at motif-pass level and can be baked into the repertoire,
  growing the loop with remembered variants.
- Rhythm controls on-beat and off-beat note starts, repeated durations, and rest
  ratios for motif starts, metrical notes, and off-meter notes.
- Breaks sample articulation around a zero line: positive values leave silence,
  while zero or negative values connect notes and can slide into the next pitch.
- Sub-note controls operate inside each sounded note: formant/filter colour,
  Fourier harmonic amplitudes, held-note harmonic drift, vibrato, and ADSR
  envelope variation.

For a detailed user-facing description of every parameter, see
[`docs/USER_MANUAL.md`](docs/USER_MANUAL.md).

For a developer/research overview of the implementation, see
[`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md).

## Repository Layout

```text
src/synthesiser/        Python package, generators, renderers, web server
web/static/             Browser Sound Studio: UI, Web Audio engine, styles
web/data/               Local runtime data, ignored except .gitkeep
web/cache/              Local rendered audio cache, ignored except .gitkeep
docs/                   Design notes, user manual, hosting notes, UI assets
examples/               Small reproducible configuration examples
tests/                  Python test suite
```

Generated audio stimuli and web caches are intentionally not committed. They can
be regenerated from seeds, parameters, and sidecars.

## Offline Stimulus Tools

The Python toolkit can also render reproducible WAV/JSON sidecar stimuli for
lab-style experiments:

```bash
PYTHONPATH=src python -m synthesiser.cli render-mode-c --output stimuli/mode_c_demo --trials 3 --seed 42
PYTHONPATH=src python -m synthesiser.cli dry-run stimuli/mode_c_demo/mode_c_000.json
```

Each rendered stimulus produces:

- a WAV file
- a JSON sidecar with seed, renderer, config, events, trigger-ready tags, and QC
  metrics

The sidecar is the source of truth for reproducibility and later EEG/lab
alignment.

## Current Status

The browser synthesiser is the most active part of the project. It currently
supports the hostable free-play preset workflow and a detailed Sub-note tab for
probabilistic timbre design.

The Python package also contains earlier staged research tooling for pitch,
event generation, jitter, rendering, sidecars, and dry-run experiment checks.
Some later research components remain deliberately stubbed until hardware and
validation decisions are made.

See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for the
current build status and caveats.
