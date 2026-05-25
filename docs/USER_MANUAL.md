# Sound Studio User Manual

Last checked against `web/static/app.js` and `web/static/synth.js` on 2026-05-25.

This manual describes the current Sound Studio interface and what each value does. The main idea is that the synthesiser is probabilistic at several musical time scales:

- Repertoire scale: which motifs exist, how the loop grows, and whether surprises become part of the repeated material.
- Note scale: scale degrees, intervals, rhythm, rests, tuning, formants, and dynamics.
- Sub-note scale: harmonic amplitudes, vibrato, onset/decay shape, breath/noise, and held-note timbral drift.

Musically, you can think of it like a small improvising player. The scale gives the player its pitch vocabulary, Melody and Rhythm set its habits, Surprise lets habits mutate into new repeated material, and Sub-note controls shape the instrument-like body of each note.

## Quick Start

1. Press `Play`.
2. Change one family of controls at a time.
3. Use `Randomise` to find unexpected areas.
4. Use `Save` when you find a sound worth returning to.
5. Use `Shared library` to hear other saved presets.

The same `Seed` and same parameters should produce the same generative path, which is useful when you want to reproduce a setting.

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

## Sound Source

Sound Source lives in the Sub-note tab. It chooses which tone-production model is active.

| Control | Meaning | Musical analogy |
|---|---|---|
| Formant | Uses a sawtooth source through vowel-like bandpass filters. The Fourier decomposition controls are greyed out and do not affect the sound. | A synthetic voice or reed-like resonant body. |
| Fourier | Uses additive harmonic partials from the Instrument Fourier Print. Formant-specific controls are greyed out. | An instrument-like spectrum built from fixed harmonics. |

The inactive path is disabled intentionally: this keeps the vowel/formant model and the harmonic/Fourier model from being confused with one another.

## Surprise

Surprise controls whether an unexpected event is introduced at the motif-pass level. The feature-specific surprise checkboxes and weights now live beside the relevant musical controls where possible.

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

## Rating And Presets

| Control | Meaning |
|---|---|
| Rating | Subjective liking score from 1 to 7. |
| Preset name | Name for the current settings. |
| Save | Saves the current full parameter set locally in the browser. |
| My presets | Local presets saved in this browser. |
| Shared library | Community presets submitted to the server. |

The preset stores the parameter settings, not a rendered audio file.

## Sub-note Tab

The Sub-note tab gives the whole screen to tone production details. These controls affect what happens inside a single note and across held notes.

## Formant Voice

Formant Voice is editable when `Sound Source > Formant` is active.

| Control | Meaning | Musical analogy |
|---|---|---|
| Formant chips: ah, ee, oo, eh, oh | Chooses the vowel palette available to notes. | The mouth shape of a sung tone. |
| Formant change | Probability of switching vowel/formant between notes. | Changing sung vowel from note to note. |
| Formant surprise | Includes vowel/formant as a possible surprise feature. | Unexpected vowel colour. |
| Surprise weight | Relative chance that a surprise uses formant once global Surprise fires. | How often timbre is the dimension of surprise. |
| Formant weights | Relative probability for each active formant when the formant palette is sampled. | Biasing the singer toward some vowels. |

The formant display lays vowels out as a circular sequence so you can see repeated vowel space rather than a one-way list. Orange bars show the ordinary formant probabilities; blue indicates the formant surprise contribution when Formant surprise is enabled. Baked formant surprises now persist because playback no longer overwrites stored motif formants.

## Harmonic Decomposition And Instrument Fourier Print

This section is active when `Sound Source > Fourier` is selected. It is the instrument-like spectral fingerprint. Each harmonic has a fixed frequency slot:

- H1 = 1 x f0, the fundamental.
- H2 = 2 x f0, the second harmonic.
- H3 = 3 x f0, and so on.

The amplitude of each harmonic is controlled by a probability distribution.

| Control | Meaning | Musical analogy |
|---|---|---|
| Instrument profile | Loads an approximate harmonic fingerprint: flute, clarinet, violin, cello, trumpet, trombone, piano, or vocal. | Choosing the instrument family. |
| Sample chance | Chance that each new note samples every harmonic amplitude from its current mean/SD distribution. If it does not sample, it uses the current dynamics/register/resonance-shaped means. | Whether each note gets a fresh spectral fingerprint. |
| Mix | Overall level of the additive harmonic fingerprint. At zero, Fourier mode is effectively silent except for any breath/noise. | How much the instrument body dominates. |
| Harmonics | Number of harmonic partials used, from 1 to 20. | How rich/bright the spectrum can be. |
| Dyn response | Global strength of each harmonic's dynamics sensitivity. | Upper harmonics blooming when played louder. |
| Reg response | Global strength of register sensitivity. | Timbre changing across low and high notes. |
| Resonance | Strength of fixed instrument resonances acting on harmonic frequencies. | Body resonances or formant-like spectral peaks. |
| Loud norm | How much random harmonic amplitude draws are normalised back toward expected loudness. | Timbre variation without huge volume jumps. |
| Hold drift | Chance that harmonic amplitudes continue wandering during a held note long enough for drift to be scheduled. | Living tone rather than static oscillator. |
| Drift depth | How much of each harmonic's SD is used for held-note drift. | Subtle shimmer vs unstable tone. |
| Drift rate | How often held-note harmonic amplitudes redraw and glide. | Slow timbral breathing vs rapid flicker. |
| Freq stretch | Optional high-harmonic frequency stretch in cents. `0` keeps harmonic frequencies fixed at integer multiples. | Piano-string-like inharmonicity. |

Per-harmonic controls:

| Label | Meaning |
|---|---|
| Hn | Harmonic number. H5 means 5 x f0 before optional stretch. |
| M | Mean amplitude for this harmonic. |
| SD | Standard deviation for this harmonic's amplitude distribution. |
| D | Dynamics sensitivity for this harmonic. Positive values bloom with higher velocity; negative values shrink with higher velocity. |
| R | Register sensitivity for this harmonic. Positive values favour higher registers; negative values favour lower registers. |

The display shows:

- Orange line: amplitude mean.
- Blue band: standard deviation around the mean.
- Grey/green lines: low-register and high-register response.
- Bottom sum: combined waveform from the visible harmonics.

## Colour Distribution

Colour Distribution is part of the Formant path. It changes the formant-filter/body colour of a note and is greyed out in Fourier mode.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Probability that a note receives this tone-colour variation. |
| Formant | Random shift of formant filter positions. | Slight mouth/throat shape change. |
| Resonance | Random shift of formant filter resonance/Q. | Narrower or wider vowel resonance. |
| Breath | Adds probabilistic noise/breath component. | Air in the tone. |

These controls are active only in Formant mode in the interface.

## Vibrato Distribution

Vibrato changes pitch within a note.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Chance that a connected phrase receives vibrato. |
| Depth | Mean vibrato depth in cents. |
| Depth SD | Standard deviation of vibrato depth. Sampled every vibrato cycle. |
| Rate | Mean vibrato rate in Hz. |
| Rate SD | Standard deviation of vibrato rate. Sampled every vibrato cycle. |

If notes are joined by the Breaks controls, vibrato phase continues across the joined notes instead of restarting.

## Envelope Distribution

Envelope controls onset, decay, sustain, and release. The classic ADSR diagram is shown with mean and SD banding.

| Control | Meaning | Musical analogy |
|---|---|---|
| Chance | Probability that the ADSR values are sampled from their distributions for a note. |
| Attack mean/SD | How fast the note reaches full level, and how variable that time is. | Bow/tongue/pick onset. |
| Decay mean/SD | How quickly the note falls from attack peak to sustain. | Initial settling. |
| Sustain mean/SD | Held level after the attack/decay. | How much the sound is maintained. |
| Release mean/SD | How long the note takes to fade after its end. | Tail of the note. |

If `Chance` is zero, the means are used and the SD controls have no audible effect.

## How Formants Work With The Fourier Section

The current synth now treats Formant and Fourier as two separate sound paths.

1. `Sound Source > Formant` chooses the vowel/filter model.
   - A sawtooth oscillator is sent through three bandpass filters: F1, F2, and F3.
   - The selected vowel chip (`ah`, `ee`, `oo`, `eh`, `oh`) chooses the filter frequencies.
   - `Formant change` changes the audible vowel label between notes. Formant surprise can also bake a vowel change into the motif.
   - Fourier decomposition controls are disabled and the engine sets the Fourier mix to zero for playback.

2. `Sound Source > Fourier` chooses the additive harmonic model.
   - It creates sine oscillators at H1, H2, H3, etc.
   - Each harmonic amplitude can be drawn from its own mean/SD distribution at note onset, depending on `Sample chance`.
   - Dynamics, register, resonances, and held-note drift reshape those amplitudes.
   - Formant-specific controls are disabled.

Practical interpretation:

- Formant = vowel or resonator shape.
- Fourier Print = instrument spectral fingerprint.
- Colour Distribution = small per-note shifts in the vowel/resonator when Formant is active.
- Harmonic editor = direct control over the amplitudes of each harmonic when Fourier is active.

## Current Redundancies And Things To Flag

These are not necessarily bugs, but they are places where the interface can confuse users.

1. `Formant` appears in several places.
   - Voice chips choose vowel categories.
   - `Formant change` changes vowels between notes.
   - `Formant surprise` creates an unexpected vowel change that can be baked into the motif.
   - `Colour Distribution > Formant` shifts filter positions inside individual notes.
   Suggested wording: rename the chips to `Vowel palette`, Formant surprise to `Vowel surprise`, and Colour Distribution to `Filter drift`.

2. `Hit prob` and `Tune prob` both sound like precision.
   - `Hit prob` is scale-degree accuracy.
   - `Tune prob` is cents-level intonation accuracy.
   Suggested wording: `Scale-degree hit` and `Tuning hit`.

3. Rest controls exist as performance rests and baked surprise rests.
   - Rhythm rests are transient density/performance rests.
   - Rest surprise can be baked into a motif.
   Suggested UI flag: show "performance" vs "baked" in tooltips.

4. Breaks can be overridden by `Phrase`.
   - Even if `Min` and `Max` are zero, `Phrase` can still insert gaps at motif boundaries.
   Suggested UI flag: make `Phrase` visually part of the same zero-line articulation graph.

5. `Probability` in Surprise and `Whole motif` both grow the repertoire.
   - `Probability` chooses one surprised note within a motif pass.
   - `Whole motif` currently creates a new motif variant by changing one random note at a boundary. The label sounds broader than the implementation.
   - Both count toward `Max baked`.
   Suggested UI flag: group them as "note-slot surprise" vs "boundary motif variant".

6. `Sample chance` and `Hold drift` both randomise harmonic amplitudes.
   - `Sample chance` samples once at note onset.
   - `Hold drift` keeps sampling during a held note.
   Suggested wording: `New-note sample` and `Held-note drift`.

7. `Freq stretch` breaks strictly fixed harmonic frequencies.
   - At zero, harmonics are fixed integer multiples of f0.
   - Above or below zero, higher harmonics are stretched in cents.
   If the research design requires fixed harmonic frequencies, leave this at zero or remove it from participant-facing presets.

8. `spectralSpread` is currently a hidden/legacy global SD initializer.
   - It affects SD when a spectral profile is reset or randomised.
   - It is not currently visible as a direct control.
   Suggested action: either expose it as "Global SD" or remove it from saved preset vocabulary after per-harmonic SD controls are stable.

9. `envelopeRange` appears to be a hidden/legacy field.
   - The current envelope UI uses per-parameter mean/SD controls instead.
   Suggested action: remove it from defaults/randomisation unless it is planned for a future compact control.

10. Legacy presets made before the Sound Source split may contain old `sine` or `triangle` voice-mode names. The current interface normalises them into the two user-facing modes.
   - This is expected from the current synthesis path.
   Suggested action: no user-facing change needed unless old shared-library presets should be migrated on the server.

11. Downbeat percussion can overlap with motif accent.
   - At motif start, `Motif` and `Down` can both fire.
   This can be useful, but high volumes may make the boundary click louder than expected.

12. Very high `Incorporation`, `Whole motif`, and `Max baked = Infinity` can make the loop grow continuously.
   - This is musically interesting but less controlled for comparison tasks.
   Suggested participant setting: use a finite `Max baked` for structured listening studies.

13. Not every control updates in the same way during playback.
   - Reverb changes are live space-effect changes.
   - Many Sub-note, Surprise, and articulation values update the running generation engine without rebuilding the repertoire.
   - Scale, voice mode, motif structure, some melody/rhythm controls, and percussion sound/volume changes can restart the current take because they require a rebuilt engine or playback bus.
   Suggested UI flag: show a small "live" vs "rebuilds take" indicator for controls during testing.
