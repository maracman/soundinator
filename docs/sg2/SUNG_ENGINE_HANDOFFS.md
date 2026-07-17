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

Landing status (shared head `b5f91b7`, observed during pass-06 finalisation):
the neutral/provenance-gated A-VOICE-03 class planner and renderer consumer are
present with executable assertions. No licensed sung consonant row or
envelope-anomaly class has been activated; their score weights remain zero.

## A-VOICE-04 · Pitch-synchronous breath in the Fourier/blow path (Agent A, BLOCKS mezzo)

Problem: the current `voiceBreathSync` oscillator exists only in
`_renderBreath`, but `_renderBreath` returns immediately for every
`excitationType=blow` note.  All canonical sung presets use the Fourier/blow
path, whose actual breath consumer is `_renderBlowFloor`; that consumer carries
`voiceBreathSync` on the note but never reads it.  The parameter therefore
audits dead and the mezzo/tenor `*.pitch-sync-breath` construction item cannot
be closed by setting a JSON value.  This is a concrete F4/T-007 consumption
gap, not a fit choice.

Engine contract:

- Keep `voiceBreathSync` in [0,1], default 0.  Zero must leave the current
  blown-floor fingerprint, node graph and PCM bit-compatible.
- In `_renderBlowFloor`, use nonzero `voiceBreathSync` to amplitude-modulate
  the existing body-routed breath noise at the note's instantaneous glottal
  pulse rate.  The modulation remains an airflow component: it follows the
  same ADSR, breath velocity/inefficiency law, turbulence trace and vowel body
  route already consumed by the floor.
- Modulation depth is monotonic in `voiceBreathSync`, bounded so the noise gain
  never changes sign and never creates a separate pitched sine.  A starting
  bound of 0.65 × the local breath gain at sync=1 preserves the legacy
  `_renderBreath` scale; Agent A may tighten it from the audio assertion.
- The pulse rate follows onset approach, f0 wander and vibrato scheduling used
  by the harmonic source.  A static oscillator fixed at the nominal MIDI f0 is
  insufficient when the source pitch moves.
- Do not add a second noise source.  This law modulates the one T-001/L4
  airflow floor, so breath body colour and soft-dynamic ratio remain composed.

Consuming-side assertions (required in the same Agent A landing):

1. A Fourier/blow sung render with `voiceBreathSync=0` is byte-identical to the
   pre-change PCM for a fixed seed; wind presets with the neutral default are
   unchanged.
2. With harmonic partials muted for measurement, sync=0 has no significant
   noise-envelope line at f0 while sync=0.8 produces one: envelope modulation
   at tracked instantaneous f0 is at least 6 dB above the adjacent side bins
   and at least 6 dB above the same-seed sync=0 render.
3. Re-render at two pitches an octave apart; the measured modulation peak also
   doubles within 2%, proving pitch consumption rather than a fixed-rate LFO.
4. Add/land the analysis observable `pitch_sync_breath_db`; a fresh sung
   controllability audit must name `voiceBreathSync` as a responder before the
   feature receives nonzero weight.  The construction assertion consumes this
   rendered value, not merely `voiceBreathSync > 0` in params.
5. A body-on/body-bypass breath pair changes noise colour by the selected
   vowel-band transfer while retaining the same modulation frequency, proving
   composition with the existing body-routed floor.

Defaults-neutral proof: `voiceBreathSync=0` does not create an oscillator or
automation event.  The new branch is opt-in and affects no non-sung preset
unless it explicitly enables the already-public parameter.

Landing status (shared head `b5f91b7`, observed during pass-06 finalisation):
the Fourier/blow consumer, zero-identity proof, octave-tracking proof and body
route proof are present. Fresh audits at renderer contract
`d43b3435a042d441` name `voiceBreathSync` as an audible responder for all four
adult voices. The dedicated `pitch_sync_breath_db` analysis observable and
corpus-fitted nonzero values remain pending, so construction stays failing at
the neutral value; this is now an analysis/activation task rather than a
missing engine consumer.

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

## A-VOICE-05 · Register × dynamic sung-source tables (Agent A, BLOCKS strict spectral cells)

Problem: all tenor, soprano and bass partial-table cells remain strict failures
after the lawful pooled-source correction and a corpus-fitted
`spectralDynamicAmount`. The same is true for mezzo outside the A-VOICE-04
construction blocker. The existing renderer can interpolate a measured
profile's `partialsByRegister`, but `_spectralFingerprint` then unconditionally
prefers explicit sung `spectralPartialMeans` at every harmonic. Sung params
therefore have no consuming path for their measured passaggio/register source
change, nor for source-shape changes across pp/mf/ff. A single global dynamic
exponent is measurably insufficient.

Pass-06 evidence: after subtracting the exact emitted vowel body, replacing one
pooled source with a register × dynamic counterfactual reduces median partial
error by 39.9% tenor, 34.6% soprano, 52.7% bass and 46.4% mezzo. These tables
are diagnostic and were not folded into vowel bodies or unrelated identity
macros. The mechanism is required by SUNG_PREFLIGHT V0.4 and annex S4/S5; its
values remain per singer.

Contract:

1. Add one neutral-when-absent param/profile surface for pinned sung source
   rows, e.g. `spectralPartialsByRegisterDynamic`, with each row carrying a
   measured f0/register anchor, velocity anchor and partial amplitudes.
2. Resolve/interpolate the source table before vowel body response, glottal
   tilt and performance variation. All vowels of one fitted singer consume the
   same table; the law must never create per-vowel source identities.
3. Interpolate in log-f0 and velocity, clamp outside the measured hull to the
   nearest row, and retain `spectralPartialMeans` as the exact absent-table
   fallback. Table entries are pinned analysis output, never free optimiser
   dimensions.
4. The engine/profile schema carries provenance plus passaggio anchors. A
   fitted table is not considered delivered until explicit params override the
   generic measured-profile fallback through this consumer.

Consuming assertions:

1. Table absent is PCM-identical to the current explicit-means path.
2. Two synthetic register anchors with opposite second-harmonic amplitudes
   produce the expected endpoint partial ratios and a log-f0 midpoint between
   them; above/below-range notes clamp to the nearest anchor.
3. Two velocity anchors similarly interpolate at mf without changing f0,
   resonator ratios, or the selected vowel-body bands.
4. Rendering `/a/` and `/i/` with the same source-table row proves identical
   pre-body source partials while the body-on/bypass transfer remains the exact
   vowel law (T-058).
5. A fresh sung controllability audit names the table consumer as a responder
   for `partials_db`, `log_mel_db` and `band_balance_db`; no table-derived
   feature receives weight before that audit.

Owner: Agent A / engine. Analysis supplies pinned rows only after synthetic
round-trip validation. Sung disposition: spec filed; no identity parameter was
bent to emulate the missing law.
