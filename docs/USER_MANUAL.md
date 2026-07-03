# Sound Studio User Manual

Last checked against `web/static/app.js` and `web/static/synth.js` on 2026-07-03.

This manual describes the current web app: the volunteer study flow, the
Sound Studio (Explore), the preset system, the Sub-note timbre workshop, and
Producer mode. The core idea throughout is that the synthesiser is
probabilistic at several musical time scales:

- Repertoire scale: which motifs exist, how the loop grows, and whether surprises become part of the repeated material.
- Note scale: scale degrees, intervals, rhythm, rests, tuning, formants, and dynamics.
- Sub-note scale: harmonic amplitudes, vibrato, onset/decay shape, breath/noise, and held-note timbral drift.

Musically, you can think of it like a small improvising player. The scale gives the player its pitch vocabulary, Melody and Rhythm set its habits, Surprise lets habits mutate into new repeated material, and Sub-note controls shape the instrument-like body of each note.

## The App At A Glance

The landing page offers two entry points; a third mode is reachable from the
Sound Studio:

| Area | What it is | Who it is for |
|---|---|---|
| Take the Study | A structured ~10 minute listening study: consent → optional demographics → headphone check → a slider or comparison task → debrief. | Volunteers contributing research data. |
| Explore Sounds | The full Sound Studio: play, tune every distribution, save/load presets, rate what you hear, optionally share settings with the research library. | Curious listeners and sound designers. |
| Producer | A DAW-style arrangement view (browser → palette → tracks) built on instruments captured in the Sound Studio. | Music production with the same engine. |

The same `Seed` and same parameters always produce the same generative path,
in the studio, in the study, and in Producer regions. Every rated sound is
exactly regenerable.

## The Study Flow

1. **Consent** — plain-language information about what the study involves and
   what is collected. Nothing is logged until the consent box is ticked and
   Continue is pressed. The consent text is versioned
   (`explore-consent-1.0`) and the version is stored with every decision.
2. **About You (step 1 of 4)** — brief optional demographics (age, years of
   musical training, and similar). Every field can be left blank.
3. **Headphone Check (step 2 of 4)** — three short tones panned left, right,
   or both; you say where you heard each. Failing does not block you, but the
   app recommends headphones and records that the check was not passed.
4. **Choose Your Task (step 3 of 4)** — either the **Slider task** (adjust
   one control until the sound is as pleasing as possible, 9 short trials) or
   the **Comparison task** (hear two sounds, pick the one you prefer, 12
   quick trials).
5. **Debrief** — what the study was about and how to keep exploring.

Every trial stores the full parameter set, the seed, a deterministic
`stimulus_id`, and the expectation/surprise/repetition metrics of what was
actually heard, so appeal can be modelled against the generative mechanisms.

## Research Data And Privacy

- Nothing is sent to the server before opt-in consent (in the study flow or
  via the research opt-in in Explore).
- After opt-in, plays, ratings, saves, and parameter changes are logged with
  a session id, `stimulus_id` (a deterministic hash of the parameters and app
  version), and a per-performance metrics summary: per-note surprisal under
  the generative prior, information rate in bits/s, and repetition/novelty
  ratios.
- Data lives in `web/data/` on the server (git-ignored) and is exported to
  tidy CSVs with `synthesiser export` (admin-token gated over HTTP).
- Shared-library preset submission has its own explicit consent checkbox.

## Quick Start (Explore)

1. Press `Play`.
2. Change one family of controls at a time.
3. Use `Randomise` to find unexpected areas.
4. Use a panel's `+ Save` to keep just that section, or the main `Save` for the whole rig.
5. Use `Shared library` to hear other saved presets, and the 11 factory starters to hear designed corners of the space.

## Transport And Visualiser

| Control | Meaning | Musical analogy |
|---|---|---|
| Play | Starts live Web Audio playback. | The player begins. |
| Stop | Stops playback and clears scheduled notes. | The player stops. |
| Randomise | Chooses a coherent random preset across the whole synth. | Asking for a new instrument/player personality. |
| Seed | Sets the pseudo-random sequence. Same seed plus same parameters gives the same output. | A repeatable take. |
| Tempo | Playback speed in BPM. | How fast the pulse moves. |

The visualiser shows live frequency-spectrum energy from the Web Audio analyser. The counters below it are:

| Counter | Meaning |
|---|---|
| Motifs | Total motif variants currently in the repertoire. This grows when surprises are baked in. |
| Sequence | Current length of the motif sequence loop. This grows as baked variants are appended. |
| Notes | Total note slots rendered since playback began. |

## Presets

Presets exist at three scopes:

1. **Section presets** — each major panel (Sound source, Melody & scale,
   Rhythm & rests, Dynamics, Sequence & surprise, Percussion, Space) has its
   own preset bar: a dropdown to load a saved section preset *into that
   section only* (everything else stays as it is) and a `+ Save` button that
   captures just that panel's parameters. This is how you mix, say, one
   preset's rhythm with another's tone.
2. **Full-rig presets** — the main Save control stores the complete parameter
   set. Loading one replaces everything.
3. **Instruments** — `Save current voice as instrument` captures the sound,
   expression, and sequence behaviour of the current voice *without* the
   session-level parameters (tempo, key/scale, seed, dynamics level, space).
   Instruments are the currency of Producer mode: the session context is
   supplied by the arrangement instead.

Eleven factory starters ship with the app: five full rigs (Glass Bells,
Night Choir, Clockwork, Wandering Flute, Restless Weaver) and six section
starters. Factory and user presets appear together in the panel dropdowns and
in the Producer browser.

| Control | Meaning |
|---|---|
| Rating | Subjective liking score from 1 to 7. |
| Preset name / Save | Saves the current full parameter set locally in the browser. |
| My presets | Local presets saved in this browser. |
| Shared library | Community presets submitted to the server (explicit consent checkbox per submission). |

Presets store parameter settings, not rendered audio.

## Scale

The Scale section decides which pitch classes are available.

| Control | Meaning | Musical analogy |
|---|---|---|
| 12-tone / N-EDO | Switches between standard 12-tone equal temperament and equal divisions of the octave. | Western pitch grid vs custom microtonal pitch grid. |
| Preset | In 12-tone mode, loads common pitch sets such as major, minor, pentatonic, blues, dorian, whole tone. | Choosing the mode/key flavour. |
| Divisions | In N-EDO mode, sets the number of equal octave divisions from 3 to 48. | How many equal steps fit inside an octave. |
| Note grid | Each pitch class cycles through Off, In scale, and Sub-scale. | Deciding which notes belong to the instrument's vocabulary. |
| Sub-scale weight | Bias toward gold sub-scale notes. `0.5` is roughly even; `1.0` strongly favours gold notes. | A tonal emphasis, like favouring chord tones. |

Important notes:

- Melody movement uses scale-degree steps, not raw chromatic semitones. In a pentatonic scale, a one-step move means one pentatonic degree.
- If no sub-scale is selected, the engine treats the whole scale as the sub-scale.
- N-EDO grid labels are currently zero-based in the UI. That is mathematically fine, but may be less friendly than 1-based labels for participants.

## Melody

Melody controls note-to-note movement and two different kinds of accuracy.

| Control | Meaning | Musical analogy |
|---|---|---|
| Interval shape | How strongly the melody favours small scale-degree steps. Low values are jumpier; high values are more stepwise. | Leaps vs conjunct singing. |
| Interval range | Maximum melodic leap in scale degrees. | The largest allowed interval gesture. |
| Hit prob | Probability that playback hits the motif's expected scale degree. | Performance memory accuracy. |
| Hit range | Maximum scale-degree miss when `Hit prob` fails. | How far the player may miss the written note. |
| Tune prob | Probability that a sounded note is tuned exactly to its target pitch. | Intonation reliability. |
| Cents range | Maximum cents-level tuning deviation when `Tune prob` fails. | Fine intonation wobble, smaller than a scale step. |
| Pitch surprise | Includes pitch as a possible surprise feature. | An unexpected melodic turn. |
| Surprise weight | Relative chance that a surprise uses pitch once global Surprise fires. | How often pitch is the dimension of surprise. |

Useful distinction:

- `Hit prob` and `Hit range` change the note at the scale-degree level, like playing the neighbouring note.
- `Tune prob` and `Cents range` change intonation around the chosen note, like being slightly sharp or flat.
- Neither is the same as Surprise. These are transient performance deviations and do not become new motif material.

The Melody accuracy display puts scale-degree difference on the vertical axis and likelihood on the horizontal axis. Orange shows the ordinary accuracy distribution centred on zero, blue shows the bimodal surprise distribution when Pitch surprise is enabled, and the bracket shows the finite display range around probability tails. The real pitch choice is still also shaped by Register, Root Pull, and the active scale; the display isolates the accuracy/surprise idea so it is readable.

The Tuning display uses cents on the vertical axis. Cents are hundredths of a 12-tone semitone, independent of the current scale or N-EDO subdivision.

## Root Pull

Root Pull adds tonal gravity toward selected in-scale notes.

| Control | Meaning | Musical analogy |
|---|---|---|
| Root note grid | Chooses one or more tonal centre notes. At least one remains active. | Tonic, drone centre, or harmonic anchor. |
| Pull strength | How strongly notes are biased toward the active root target. | Gravity toward home. |
| Pull shape | Where in the phrase the pull happens. `0` is constant; `1` waits until the phrase end. | Cadential pull near the end of a phrase. |

If multiple root notes are selected, the engine can move between them after arriving near a root. This can feel like modulating between tonal centres.

## Register

Register shapes where the melody sits in pitch height.

| Control | Meaning | Musical analogy |
|---|---|---|
| Centre | Comfortable centre of the pitch range, in scale degrees from the tonic. | The singer's middle range. |
| Width | How wide the comfortable pitch region is. | Narrow chant vs wide instrumental leaps. |
| Skew | Asymmetrically widens one side of the register curve. Negative favours a broader low tail; positive favours a broader high tail. | A melody that tends to reach upward or sink downward. |

The skew is a real skewed/split curve: it keeps the centre anchored and changes the width of the low and high tails.

## Rhythm

Rhythm generates motif note onsets on a beat grid.

| Control | Meaning | Musical analogy |
|---|---|---|
| Beat divisions | Number of subdivisions per beat. `1` gives quarter-note-level slots; higher values create finer grids. | Rhythmic resolution. |
| On-beat onset | Probability of starting a new note on a beat boundary. | Downbeat/metrical clarity. |
| Off-beat onset | Probability of starting a new note between beats. | Syncopation. |
| Same length | Boost for repeating the previous note length. | Rhythmic consistency or motor habit. |
| Rest motif | Probability that the first note slot of a motif becomes a rest. | Starting a phrase with silence. |
| Rest on | Probability that non-start, on-meter note slots become rests. | Dropping strong-beat notes. |
| Rest off | Probability that off-meter note slots become rests. | Dropping syncopated notes. |
| Duration surprise | Includes note-duration change as a possible surprise feature. | A note unexpectedly stretching or compressing. |
| Rest surprise | Includes silence/rest as a possible surprise feature. | A note unexpectedly disappearing. |
| Surprise weight | Relative chance that the corresponding feature is chosen once global Surprise fires. | How often duration/rest is the dimension of surprise. |

Important distinction:

- Rhythm rest ratios are transient performance/rest-density controls.
- Rest surprise creates a surprise rest that can be baked into the motif if incorporation succeeds.

The Duration display puts duration difference on the vertical axis and likelihood on the horizontal axis. The units are beat subdivisions, so the labels update when `Beat divisions` changes.

## Surprise

Surprise controls whether an unexpected event is introduced at the motif-pass level. The feature-specific surprise checkboxes and weights live beside the relevant musical controls where possible.

| Control | Meaning | Musical analogy |
|---|---|---|
| Probability | Chance that a motif pass contains one surprised note. | One unexpected event in a repeated phrase. |
| Dynamics surprise | Includes loud/soft dynamic change as a possible surprise feature. | Accent or ghost note. |
| Surprise weight | Relative chance that dynamics is chosen once global Surprise fires. | How often dynamics is the dimension of surprise. |
| Incorporation | Chance that a surprise becomes baked into the motif repertoire. | A mistake becoming part of the composition. |
| Max baked | Maximum number of baked surprise variants. `Infinity` lets the loop keep growing. | Memory capacity for new variants. |
| Tail bracket | Number of standard deviations shown by the finite range bracket in the accuracy/surprise diagrams. | How much of the probability tail the picture shows. |
| Multiple features on one note | Allows one surprised note to change more than one enabled feature at once. It still uses only one surprised note per motif pass. | A single event that is both a pitch and colour surprise. |

How baking works:

1. A motif pass begins.
2. `Probability` decides whether one note slot in that pass will be surprised.
3. The enabled feature weights decide what kind of surprise it is. If multiple features are allowed, several enabled dimensions can change on the same note.
4. The engine projects a continuation from the surprised note using the normal melodic/formant generation rules.
5. The projected route snaps back to the original motif when the affected features become compatible again. For duration surprises, this implementation uses the simpler onset-alignment rule: it waits until projected and original duration positions align, otherwise it stays projected until motif end.
6. If `Incorporation` succeeds, the projected variant is baked into the repertoire.
7. If baked, the sequence grows by appending one new base-length cycle with the surprised motif substituted for its source motif.
8. `Max baked` stops further growth after the selected number of baked variants.

`Whole motif` in the Motif Repertoire section is related but separate: at a motif boundary it currently creates a new variant by changing one random note inside a selected base motif. It also counts toward `Max baked`.

## Breaks

Breaks shape articulation between notes. The visual display has a zero line:

- Above zero means a positive gap, so the note ends before the next note starts.
- At or below zero means connected/legato, so the next note starts from the previous pitch and can slide.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Probability that the break/legato distribution is sampled. | How often articulation varies. |
| Min | Lower edge of the articulation distribution. Negative values connect notes. | Legato/tie end of the range. |
| Max | Upper edge of the articulation distribution. Positive values create silence. | Staccato/rest end of the range. |
| Slope | Makes larger melodic intervals move toward the upper break value. | Bigger leaps get more breathing room. |
| Range | Random timing variation around the chosen gap/legato value. | Precise vs inconsistent articulation. |
| Slide speed | Speed of glide when notes are joined. High is fast; low is slow. | Portamento speed. |
| Phrase | Minimum break at motif/phrase boundaries. | Breath mark between phrases. |

Important note: if `Min` and `Max` are zero but `Phrase` is positive, notes can still break at motif boundaries. Set `Phrase` to zero too if you want fully flowing joins.

## Percussion

Percussion adds optional accent layers. These are not part of the melodic motif itself; they mark structure.

| Layer | Meaning | Musical analogy |
|---|---|---|
| Beat | Fires on every beat if volume is above zero. | Metronome tick or pulse marker. |
| Motif | Fires at the start of each motif if volume is above zero. | Phrase-start accent. |
| Down | Fires every N beats within the motif if volume is above zero. | Downbeat or bar accent. |

Each layer has a sound selector and a volume control. Available sounds include clicks, ticks, hats, rim-like noises, snaps, pops, wood-like tones, and bells.

`Down` and `Motif` can both fire at the beginning of a motif, so high volumes may create stacked accents.

## Space

Space adds generated convolution reverb after the synth.

| Control | Meaning | Musical analogy |
|---|---|---|
| Reverb type | Room, plate, hall, cathedral, or spring-like impulse profile. | Acoustic environment. |
| Wet | Amount of reverb mixed into the output. | Dry close sound vs distant room sound. |
| Decay | Length of the reverb tail. | Small room vs large hall. |
| Tone | Brightness of the reverb tail. | Dark carpeted room vs bright reflective room. |
| Pre-delay | Delay before reverb begins. | Distance before first reflections. |

Changing reverb should not rebuild the motif sequence; it is a live space effect.

## Motif Repertoire

This section controls the larger repeated structure.

| Control | Meaning | Musical analogy |
|---|---|---|
| Motif count | Number of base motifs generated at the start. | How many phrase ideas the player begins with. |
| Motif (beats) | Length of each motif in beats. | Phrase length. |
| Sequence prob | How strictly motifs follow the current sequence. `1` cycles in order; `0` chooses randomly. | Ordered composition vs free selection. |
| Whole motif | Chance of a repertoire-level motif variant at motif boundaries. In the current code, this changes one random note inside a selected base motif rather than regenerating the entire motif. Counts toward `Max baked`. | A new variation of a phrase. |

The sequence grows when surprises or repertoire-level motif variants are incorporated. The `Sequence` counter shows that growth.

## Sub-note Tab

The Sub-note tab gives the whole screen to tone production details. These controls affect what happens inside a single note and across held notes.

### Sound Source

Sound Source chooses which tone-production model is active. The inactive
path's controls are greyed out intentionally so the two models are not
confused with one another.

| Control | Meaning | Musical analogy |
|---|---|---|
| Formant | A source signal shaped by a five-formant vowel filter bank. | A synthetic voice or reed-like resonant body. |
| Fourier | Additive harmonic partials from the Instrument Fourier Print. | An instrument-like spectrum built from fixed harmonics. |

### Formant Voice And The Vowel Pad

Active when `Sound Source > Formant` is selected. The vowel model is a
Klatt-style five-formant bank: each vowel sets F1–F5 centre frequencies and a
per-formant bandwidth.

The vowel display is a **2D vowel pad** laid out in log-F1 × log-F2 space —
the same space phoneticians use for vowel charts. The five named vowels
(`ee`, `eh`, `ah`, `oh`, `oo`) sit at their measured positions; any point on
the pad is a valid vowel, interpolated from the named ones by distance. This
means vowel "surprise" can move in two directions even from an extreme vowel
(a line or circle could not).

| Control | Meaning | Musical analogy |
|---|---|---|
| Vowel chips: ah, ee, oo, eh, oh | Chooses the vowel palette available to notes. | The mouth shape of a sung tone. |
| Formant change | Probability of switching vowel/formant between notes. | Changing sung vowel from note to note. |
| Formant surprise | Includes vowel/formant as a possible surprise feature. | Unexpected vowel colour. |
| Surprise weight | Relative chance that a surprise uses formant once global Surprise fires. | How often timbre is the dimension of surprise. |
| Formant weights | Relative probability for each active vowel when the palette is sampled. | Biasing the singer toward some vowels. |

Orange marks show the ordinary vowel probabilities on the pad; blue indicates
the surprise contribution when Formant surprise is enabled. Baked formant
surprises persist because playback does not overwrite stored motif formants.

### Colour Distribution

Part of the Formant path (greyed out in Fourier mode). It changes the
formant-filter/body colour inside individual notes.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Probability that a note receives this tone-colour variation. | |
| Formant | Random shift of formant filter positions. | Slight mouth/throat shape change. |
| Resonance | Random shift of formant filter resonance/Q. | Narrower or wider vowel resonance. |
| Breath | Adds probabilistic noise/breath component. | Air in the tone. |

### Instrument Fourier Print

Active when `Sound Source > Fourier` is selected. This is the instrument-like
spectral fingerprint. Each harmonic has a fixed frequency slot: H1 = 1 × f0
(the fundamental), H2 = 2 × f0, and so on, with each amplitude controlled by
a probability distribution.

The **Instrument profile** selector loads one of eight profiles built from
published spectral data: flute, clarinet, violin, cello, trumpet, trombone,
piano, or vocal. A profile carries more than amplitudes — each has a
*performance character*: its own envelope tendencies, vibrato behaviour,
attack noise (breath, bow, hammer), and a Material damping setting, so a
piano decays like a struck string and a flute breathes.

| Control | Meaning | Musical analogy |
|---|---|---|
| Instrument profile | Loads the harmonic fingerprint plus performance character for one of the eight instruments. | Choosing the instrument family. |
| Sample chance | Chance that each new note samples every harmonic amplitude from its current mean/SD distribution. If it does not sample, it uses the current dynamics/register/resonance-shaped means. | Whether each note gets a fresh spectral fingerprint. |
| Mix | Overall level of the additive harmonic fingerprint. At zero, Fourier mode is effectively silent except for any breath/noise. | How much the instrument body dominates. |
| Harmonics | Number of harmonic partials used, from 1 to 32. | How rich/bright the spectrum can be. |
| Dyn response | Global strength of each harmonic's dynamics sensitivity. | Upper harmonics blooming when played louder. |
| Reg response | Global strength of register sensitivity. | Timbre changing across low and high notes. |
| Resonance | Strength of fixed instrument resonances acting on harmonic frequencies. | Body resonances or formant-like spectral peaks. |
| Loud norm | How much random harmonic amplitude draws are normalised back toward expected loudness. | Timbre variation without huge volume jumps. |
| Hold drift | Chance that harmonic amplitudes continue wandering during a held note long enough for drift to be scheduled. | Living tone rather than static oscillator. |
| Drift depth | How much of each harmonic's SD is used for held-note drift. | Subtle shimmer vs unstable tone. |
| Drift rate | How often held-note harmonic amplitudes redraw and glide. | Slow timbral breathing vs rapid flicker. |
| Freq stretch | Optional high-harmonic frequency stretch in cents. `0` keeps harmonic frequencies fixed at integer multiples. | Piano-string-like inharmonicity. |

### Partial Macros

Rather than editing 32 harmonics one at a time, the macro controls transform
the whole harmonic set at once (an approach borrowed from physical-modelling
synths like RipplerX and Resonarium):

| Control | Meaning | Musical analogy |
|---|---|---|
| Tilt | Spectral slope: negative darkens (rolls off highs), positive brightens. | Playing closer to or further from the bridge. |
| Odd / even | Rebalances odd vs even harmonics. Fully negative mutes evens (hollow, clarinet-like); fully positive mutes odds. | Cylindrical vs conical bore character. |
| Comb boost / Comb centre | Boosts harmonics near a chosen harmonic number and its multiples. | Emphasising a body resonance. |
| Material | Damping law applied per note: low values let every partial ring (glass, metal); high values kill upper partials quickly (wood, felt). Higher harmonics always decay faster. | What the instrument is made of. |
| Octave-group faders: Fund (1), Oct (2), 3–4, 5–8, 9–16, 17+ | Level fader per octave band of harmonics. | A six-band graphic EQ over the harmonic series. |

The per-harmonic detail table (below the macros) still allows exact editing:

| Label | Meaning |
|---|---|
| Hn | Harmonic number. H5 means 5 × f0 before optional stretch. |
| M | Mean amplitude for this harmonic. |
| SD | Standard deviation for this harmonic's amplitude distribution. |
| D | Dynamics sensitivity. Positive values bloom with higher velocity. |
| R | Register sensitivity. Positive values favour higher registers. |

The display shows the amplitude mean (orange), SD band (blue), low/high
register response (grey/green), and the combined waveform sum at the bottom.

### Vibrato Distribution

| Control | Meaning |
|---|---|
| Chance | Chance that a connected phrase receives vibrato. |
| Depth / Depth SD | Mean vibrato depth in cents, and its per-cycle variability. |
| Rate / Rate SD | Mean vibrato rate in Hz, and its per-cycle variability. |

If notes are joined by the Breaks controls, vibrato phase continues across the joined notes instead of restarting.

### Envelope Distribution

Envelope controls onset, decay, sustain, and release, drawn as the classic
ADSR diagram with mean and SD banding.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Probability that the ADSR values are sampled from their distributions for a note. | |
| Attack mean/SD | How fast the note reaches full level, and how variable that is. | Bow/tongue/pick onset. |
| Decay mean/SD | How quickly the note falls from attack peak to sustain. | Initial settling. |
| Sustain mean/SD | Held level after the attack/decay. | How much the sound is maintained. |
| Release mean/SD | How long the note takes to fade after its end. | Tail of the note. |

If `Chance` is zero, the means are used and the SD controls have no audible
effect. Choosing an instrument profile re-seats these values to that
instrument's performance character.

## Producer Mode

Producer arranges instruments on a multi-track timeline, following the same
logic as a conventional DAW (Logic / Pro Tools): sounds are made in the
studio, browsed into a palette, and placed on tracks as regions.

### Layout

Three adjustable zones, DAW-style:

- **Left column** — the preset/instrument **Browser** (top) and your
  **Palette** rack (bottom).
- **Centre** — the transport strip, bar ruler, and **track lanes**.
- **Bottom** — the collapsible **editor drawer**, where the piano roll opens.

The left column and editor drawer resize by dragging their splitters and
collapse via chevrons; the layout persists across reloads.

### Browser → Palette → Tracks

1. **Browser**: every factory preset, user preset, and saved instrument as
   cards with name, kind, and description — filter by category chips or text
   search, and preview in context before committing.
2. **Palette**: your working set for this arrangement. Drag a card in (or
   click its add button). Drag a browser card *straight onto a lane* and it
   is added to the palette automatically.
3. **Tracks**: drag a palette item onto a lane to create a region at the
   snapped drop beat, or below the last lane to create a new track. The
   palette "+" button is the no-drag fallback: it creates a track with a
   starter region.

All dragging is pointer-based with a drag ghost and live lane highlighting.
A click is never mistaken for a drag (5 px threshold).

### Regions

A region is a placed span of music: it knows its palette instrument, start
beat, length, and seed. One track can hold many regions back to back, each
with a different instrument — the region carries the sound; the track is a
lane.

- **Move**: drag along a track or to another track (snap to grid,
  collision-blocked).
- **Copy**: hold Alt while dragging (the ghost shows ⧉), or select and press
  ⌘/Ctrl-D to duplicate into the next free span.
- **Extend/loop**: drag the right edge. A generative region simply generates
  more (deterministically); a baked region repeats its notes every loop, with
  thin tick marks at each loop boundary.
- **Region toolbar** (when selected): ▶ Loop region, ◆ Bake / Unbake,
  ✎ Edit notes, ↻ Reroll take (new seed, same instrument and context),
  ± length, a per-region level slider, **→ Studio** (open this region's exact
  voice + session context + seed in the Sound Studio), and Delete.

### Session Context vs Instrument vs Take

Parameters split into three tiers:

- **Session context** (owned by the arrangement, set in the transport strip):
  tempo, key, scale, dynamics level, space/reverb. Changing the key really
  transposes — all regions, including baked ones, follow because pitches are
  stored in scale-degree space, not frozen Hz.
- **Instrument** (owned by the palette item): everything about the voice.
- **Take** (owned by the region): the seed, and after baking, the notes.

### Editing Instruments From The Palette

Press ✎ on a palette item to open its voice in the Sound Studio under the
arrangement's session context. A persistent banner offers **Save to palette**
(all regions using it follow), **Save as copy** (fork a new palette entry),
or **Discard**.

### Bake And The Piano Roll

**◆ Bake** freezes a region's generated take into editable notes.
Double-click a baked region and the piano roll opens in the editor drawer:

- Note bodies sit at their *precise* pitch (including cents deviations);
  a dashed ghost marks the *intended* scale degree.
- Dragging snaps whole scale rows while preserving each note's cents
  character; hold Shift to zero the cents; hold Alt to fine-tune cents only.
- Edits persist with the arrangement and are audible immediately.
- **Unbake** returns the region to generative playback (the seed regenerates
  the same take).

### Transport, Arrangements, And Output

| Control | Meaning |
|---|---|
| Arrangement select + New / Rename / Delete | Multiple named arrangements; switching saves and swaps cleanly. |
| ▶ / ■ | Play the arrangement from the playhead (click the ruler to set it). |
| ↩ Undo | Single-level undo of the last arrangement change (⌘Z; press again to redo). |
| − / ＋ | Timeline zoom (persisted). |
| Snap select | Bar / Beat / ½-beat grid for drops, moves, and resizes. |
| ＋8 bars | Lengthen the arrangement. |
| ⬇ WAV | Offline mixdown of the whole arrangement to a 16-bit WAV download. |
| Export / Import | Arrangement JSON round-trip (includes the palette). |

Track heads have inline rename (double-click the name), a gain fader, a pan
slider, and **M**ute / **S**olo buttons — all honoured live and in mixdown.

Keyboard (inert while typing in a field): `Space` play/stop ·
`Delete`/`Backspace` remove selected region · `Escape` deselect / close
drawer · `⌘D` duplicate · `⌘Z` undo.

## Known Quirks And Flags

Not necessarily bugs, but places where the interface can confuse users:

1. `Formant` appears in several places: the vowel chips choose the palette,
   `Formant change` switches vowels between notes, `Formant surprise` bakes
   vowel changes into motifs, and `Colour Distribution > Formant` shifts
   filter positions inside notes. Tooltips distinguish them; the wording is
   still worth a pass (e.g. "Vowel palette" / "Filter drift").
2. `Hit prob` (scale-degree accuracy) and `Tune prob` (cents-level accuracy)
   both sound like precision. See the Melody section for the distinction.
3. Rest controls exist as transient performance rests (Rhythm) and baked
   surprise rests (Rest surprise).
4. Breaks can be overridden by `Phrase`: even with `Min`/`Max` at zero,
   `Phrase` still inserts gaps at motif boundaries.
5. Surprise `Probability` and Repertoire `Whole motif` both grow the
   repertoire and both count toward `Max baked`; the former surprises one
   note in a pass, the latter varies one note at a motif boundary.
6. `Sample chance` randomises harmonic amplitudes once at note onset;
   `Hold drift` keeps sampling during a held note.
7. `Freq stretch` above zero breaks strictly fixed harmonic frequencies.
   Research designs requiring exact integer harmonics should leave it at 0.
8. Very high `Incorporation`, `Whole motif`, and `Max baked = Infinity`
   grow the loop continuously — musically interesting, less controlled for
   comparison tasks. Use a finite `Max baked` for structured listening.
9. Downbeat percussion (`Down`) and `Motif` accent can stack at motif start.
10. Not every control updates the same way during playback: reverb is live,
    most Sub-note/Surprise/articulation values update the running engine,
    while scale, voice mode, motif structure, and percussion sound changes
    rebuild the current take.
