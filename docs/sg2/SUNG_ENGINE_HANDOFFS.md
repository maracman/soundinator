# SG2 sung engine and analysis handoffs — pass 01

Date: 2026-07-16
Owner lane: Agent E / sung
Rule: delivered data is incomplete until the named consumer assertion passes.

## A-VOICE-01 · Per-class singer-formant centre (Agent A, priority 1)

Problem: `synth.js` constructs the singer-formant band at a hardcoded 3000 Hz.
The best-supported centres are about 2.35–2.45 kHz for bass and 2.7–2.85 kHz
for tenor. The current analysis gate also wrongly tests bass in the tenor
2.7–3.3 kHz window. Decision 12 makes bass the fitted section target; a later
derived basso-profondo preset inherits the fitted bass law.

Engine contract:

- Add `singerFormantHz`, finite range 1800–3600 Hz, default 3000.
- The parameter is inert while `singerFormantAmount = 0`.
- Replace only the hardcoded singer-formant band's centre; its amount and the
  remaining vowel body bands keep their current semantics.
- Omitted `singerFormantHz` and explicit 3000 must be bit-compatible with the
  current renderer.

Consuming-side assertions:

1. With amount zero, 2400/2800/3000 produce identical fingerprints and PCM.
2. With amount nonzero, a 2400-Hz setting moves the fixed-Hz prominence into
   2.3–2.6 kHz and a 2800-Hz setting moves it into 2.7–3.0 kHz.
3. A bass seed carrying 2400 is read by the real render path; absence of
   the key retains the 3000-Hz legacy path.
4. Agent D lowers `bass.singer-formant-band` to 2.3–2.6 kHz and the
   rendered consumer, not merely the JSON field, passes it.

Defaults-neutral proof: existing presets omit the key; the default equals the
old constant and amount zero remains inert.

## A-VOICE-02 · Mezzo F1-to-f0 tuning law (Agent A, priority 2)

Problem: above a vowel's fitted F1, upper mezzo singing raises R1 to roughly
1.0–1.15 × f0, with gains up to about 30 dB. Soprano uses this strategy more
extensively. A static fixed-Hz body cannot express this class-defining
mechanism; one law serves both classes with separately fitted values.

Engine contract:

- Add `formantTuneToF0` in [0, 1.2], default 0/off.
- When off, the active vowel body is unchanged.
- When on and `f0 > fitted vowel F1`, override only the active vowel body's
  first band centre with `formantTuneToF0 × instantaneous f0`.
- Below the fitted F1 threshold, the law is inert.
- F2–F5 remain fixed in Hz. This is a targeted source–tract interaction, not a
  wholesale pitch shift of the vocal tract.
- It composes with instantaneous-frequency body gain (T-029); it must not
  disable vibrato-induced body AM.

Consuming-side assertions:

1. Default zero is fingerprint/PCM-identical to the current renderer.
2. Below threshold, nonzero tuning is inert.
3. Above threshold, rendered F1/f0 lies in [1.0, 1.20] while F2–F5 do not move.
4. Three-register mezzo and soprano `/a/` grids consume the law only where each
   class's fitted F1 threshold is crossed.
5. Tenor/bass presets with the default remain unchanged.

## A-VOICE-03 · Consonant onset gesture layer (Agent A, corpus-gated)

Problem: VocalSet has no consonants. When a licensed consonant corpus lands,
the engine needs burst + VOT + F1/F2 transition gestures riding the existing
articulation-strength draw, not a bolt-on phoneme synthesiser.

Neutral schema:

- `consonantClass`: `none|plosive|nasal|fricative`, default `none`
- `consonantPlace`: `labial|alveolar|velar`, default `alveolar`
- `consonantVoiced`: boolean, default true
- `consonantStrength`: [0,1], default 0
- `consonantBurstHz`, `consonantBurstDurationMs`
- `consonantVotMs`
- `consonantF2LocusHz`, `consonantTransitionMs`
- `consonantNasalZeroHz`, `consonantFricativeHz`
- optional `consonantPreBeatMs`, default 0, only if the existing scheduling
  path cannot express voiced anticipation

Gesture law:

- Plosive: shaped noise burst, then VOT gap/aspiration, then phonation.
- Nasal: pitched low murmur plus pole/zero colour, transitioning into vowel.
- Fricative: shaped unpitched noise transitioning into vowel.
- F1 starts near 250 Hz and F2 at the place locus, relaxing to the fitted vowel
  body over the transition time.
- `consonantStrength` rides the shared per-note articulation latent:
  stronger = clearer transient/cleaner pitch/less breath lead; weaker = the
  inverse. No independent random consonant draw.

Consuming-side assertions:

1. `none` or strength zero is bit-identical to the current renderer.
2. Alveolar plosive energy is high-frequency and its phonation begins after
   the requested VOT.
3. Nasal and fricative classes measurably differ in pitched/unpitched energy.
4. F1/F2 reach the sustained vowel targets by the transition end.
5. Strong articulation raises consonant energy while reducing scoop/breath
   lead using the same latent draw.
6. A preset cannot enable the layer without provenance naming a QC'd licensed
   consonant corpus; until then every consonant score weight is zero.

## D-VOICE-01 · Sung scorer/runner contracts (Agent D)

Required shared-analysis changes; Agent E will not edit these unilaterally:

1. Add formant-track, H1–H2 and vowel-classification consumers using the new
   sung module as the family-specific measuring implementation.
2. Lower only the contrabass singer-formant assertion window to 2.3–2.6 kHz.
3. Keep consonant burst/VOT/transition features at zero weight until the exact
   corpus licence and QC provenance enter the objective hash.
4. Add a sung free-parameter audit set. `glottalTilt`,
   `singerFormantAmount`, `voiceBreathSync`, `bodyArticulation`, vibrato and
   per-vowel body parameters must demonstrate their responsive features.
5. Replace the remaining `/private/tmp/sg2` defaults in `iterate.py` and its
   filed-work-item path with `SG2_DATA`/repo `sg2-data`; an explicit run path is
   not enough because limiting-factor filing still writes to the reaped root.
6. Consume reference roles and official VocalSet `expectedF0Hz` anchors from
   `sung_prep.py`; reject any cross-singer identity manifest.
7. Add a per-vowel sung preset bundle contract to the shared iterator and
   listening-page builder. A voice run must render the `/a e i o u/` body that
   belongs to the labelled row; selecting one static `initial-*.json` for the
   whole instrument is not a valid consumer of the V0.1 fit.

Consuming-side assertions:

- a soprano-labelled singer cannot build a mezzo campaign;
- an identity manifest containing two singer IDs is rejected;
- a positive-weight sung feature without a responsive free parameter fails the
  controllability contract;
- changing singer, vowel labels, annotations, renderer bytes or weights changes
  the objective hash;
- the shared listening page produces five distinguishable labelled vowel rows
  from one singer bundle and each row's effective body equals that vowel's
  fitted bands;
- all limiting-factor and leaderboard files remain under durable `SG2_DATA`.

## D-VOICE-02 · Consonant-onset feature consumers (Agent D, activation-gated)

The landed `consonants-spoken/` LibriSpeech subset and alignments now have a
durable spoken-to-sung adaptation build. The first balanced extraction is 48
plosives, 48 nasals and 48 fricatives. Its adapted medians are:

| Class | Duration | Burst centroid | VOT | Transition | Pre-beat |
|---|---:|---:|---:|---:|---:|
| plosive | 49 ms | 3210 Hz | 24.7 ms | 52.5 ms | 122.6 ms |
| nasal | 56 ms | 770 Hz | 0 ms | 52.5 ms | 115.5 ms |
| fricative | 70 ms | 5567 Hz | 0 ms | 52.5 ms | 122.3 ms |

These are provisional S31–S33 adaptations, not sung measurements: consonant
duration ×0.70, F1/F2 transition time ×0.75, voiceless VOT ×0.65, and voiced
VOT ×1.10, with the sustained vowel placed on the beat and the consonant moved
pre-beat. The machine-readable source is
`sg2-data/campaigns/sung-consonants/CONSONANT_ONSET_FIT.json`.

Add family-specific extraction and scorer fields for burst centroid, burst
duration, VOT, F1 transition slope and F2 transition slope. Every weight must
remain exactly zero until A-VOICE-03 exists in the renderer and a fresh
controllability audit demonstrates a responsible parameter for each activated
feature. The objective hash must include the adaptation policy and corpus
provenance. A spoken measurement must never be represented as direct sung
ground truth.

## D-VOICE-03 · Sung family-firewall assertion (Agent D, requested)

Please add a shared assertion that fails if a SUNG run imports fitted values,
presets, candidate tables or objective rows from a non-sung family. Shared
neutral engine mechanisms are allowed; fitted bowed/blown/struck values are
not. The assertion must cover both direct preset consumption (F5) and
optimizer/leaderboard seeding (F12), and must run before evaluation rather than
appearing only in a report.

Required proof cases:

1. A `voice-*` objective seeded with a violin/cello/brass fitted candidate
   fails even when the parameter names exist in the common manifest.
2. A SUNG legacy `vocal` craft prior with pinned provenance passes.
3. A same-singer prior SUNG pass may seed the next pass.
4. A morphology-derived boy soprano or basso profondo names only its frozen
   adult SUNG source and transform.
5. The assertion is exercised through the canonical runner used by
   `evaluate_construction`/`evaluate_tripwires`.

Status update — Agent D pass 02, 2026-07-17: incorporated. The shared
`assert_sung_family_firewall` runs in `iterate.py` before controllability or
evaluation and the same check is exposed as the `*.family-firewall`
construction assertion. It rejects non-sung fitted profiles, declared
families, candidate/objective/leaderboard provenance and non-vocal priors;
the pinned vocal legacy prior, same-singer sung rows, and explicitly
transformed frozen adult sung parents pass. The proof cases are executable in
`tests/test_tone_match.py`.
