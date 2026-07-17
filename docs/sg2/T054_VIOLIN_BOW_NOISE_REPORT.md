# T-054 violin bow-noise extraction report

Date: 2026-07-17

## Verdict

The L14 extraction passes. The Iowa lossless corpus supports one pinned,
body-coloured violin bow-noise spectrum over **200–14,400 Hz**. Its shape is
stable across pp/mf/ff; only level changes materially. The engine can consume
one spectrum table plus the fitted level law rather than three dynamic tables.

Philharmonia p/mp material is excluded from profile extraction because it is
MP3. Lossy coding alters the low-level broadband floor being measured. Those
takes remain admissible only for qualitative listening checks.

## Corpus and separator

The extraction used 57 Iowa arco, non-vibrato note segments: 19 each at pp,
mf, and ff. Forty-eight are the T-040 dense-body notes on sulG/sulD/sulA;
nine additional sulE segments (three chromatic pitches per dynamic) were
selected from the raw lossless runs.

For every note, Welch PSD analysis uses its measured f0 to remove harmonic
bins with a 35-cent comb mask (at least two FFT bins per side). Residuals are
reduced to 1/6-octave bands. Within each exact dynamic/string group the median
across pitches is the common bow component. Dynamic profiles then pool the
four string medians equally, preventing the denser sulD set from dominating.
Pitch-varying residual is diagnosed as leakage and is never admitted to the
pinned table.

The empirical usable band is 200–14,400 Hz. The background estimate takes the
quietest 20% of STFT frames from each note's own raw Iowa run. Across the
retained band the weakest median residual-to-background margin is 22.863 dB,
and the weakest 25th-percentile margin is 15.388 dB. At the edges, the p25
margins are 15.388 dB at 200 Hz and 21.300 dB at 14.368 kHz. Thus neither end
is retained on assumption: 200 Hz is the lowest robust multi-bin 1/6-octave
estimate at nfft 4096, and 14.368 kHz is the final complete analysed band
below 16 kHz.

## Synthetic trust gate

The extractor was validated before it was permitted to read the real corpus.
The actual SG2 engine rendered a matched pair at A4: harmonic plus seeded,
body-routed noise, and the same harmonic signal with noise disabled. Their
difference is the known injected noise profile. Harmonic subtraction from the
mixed render recovered that profile over 200–14,400 Hz with:

| Metric | Achieved | Gate |
|---|---:|---:|
| Shape correlation | 0.9655 | >= 0.90 |
| Median absolute shape error | 1.515 dB | <= 1.6 dB |
| 95th-percentile shape error | 1.998 dB | <= 4.0 dB |

`scripts/tone_match/bow_noise.py extract` refuses to run unless its supplied
validation artifact has schema `sg2-bow-noise-validation-v1` and status
`pass`.

## Cross-pitch and dynamic result

Within-string/dynamic median pitch-shape errors range from 0.631 to 2.312 dB.
The weakest group correlation is ff/sulG at 0.8104; it remains a small-error
common profile rather than a separate shape. Cross-dynamic pooled results are:

| Pair | Correlation | Median abs difference | P95 difference |
|---|---:|---:|---:|
| pp–mf | 0.9607 | 1.853 dB | 5.821 dB |
| pp–ff | 0.9358 | 1.938 dB | 5.313 dB |
| mf–ff | 0.9579 | 1.743 dB | 4.526 dB |

This confirms the owner's hypothesis: the tonal profile is stable across the
Iowa pp→mf→ff ladder. No per-dynamic spectrum table is justified.

One 9.051 kHz band changes by 4.116 dB when the harmonic-notch width changes.
It is flagged as harmonic leakage and omitted from the emitted table; the
engine interpolates between the retained 8.064 and 10.159 kHz anchors. Window
tests at 2048/4096/8192 samples and notch tests at 25/35/50 cents flag no other
retained band. Vibrato smear is excluded structurally by the non-vibrato Iowa
role.

## Quarantine decision

No Iowa take or source file is quarantined: every same-string/dynamic group
has a median pitch-shape error below 2.4 dB, and the full retained range clears
its own raw-run background floor. The sole quarantine is the 9.051 kHz
analysis row. Its notch-width sensitivity exceeds the declared 3 dB artifact
threshold, so it is logged in `artifactScreen.flaggedBands` and absent from
the pinned profile. This is a band-local analysis-artifact decision, not a
corpus exclusion. Philharmonia remains excluded by format policy, not by a
failed take-level screen.

## Level law and soft inefficiency

The fitted absolute amplitude law is:

`bowNoiseGain = bowNoiseLevel * envelope * velocity ** 0.9309`

with a 2.061 dB three-rung fit RMSE. Median measured powers are:

| Dynamic | Velocity | Noise power | Noise / harmonic |
|---|---:|---:|---:|
| pp | 0.20 | -69.134 dB | -24.042 dB |
| mf | 0.62 | -63.520 dB | -28.725 dB |
| ff | 0.92 | -55.440 dB | -27.727 dB |

Absolute bow noise rises with playing level, but pp carries about 4 dB more
noise relative to the harmonic component. That is the T-001 inefficiency
effect and closes the measured sign question left open by T-039.

## Agent A engine contract

The measured profile is emitted as `violin.bowNoise` in
`measured_profiles.json` and the generated JS module. Its 37 retained rows are
immutable analysis data (`profilePinned: true`); optimisation must never edit
frequency or gain.

- Add `bowNoiseLevel` as a user-facing violin control. Zero remains the exact
  neutral/legacy identity; measured violin default is 1 after the consumer is
  enabled.
- Add/consume `bowNoiseVelocityExponent`, fitted here to 0.9309. Couple noise
  to the held-note envelope and preserve the pp relative-inefficiency result.
- Route the component through the selected measured body with amount 1. Treat
  the pinned table as the post-body target: derive the pre-body excitation
  filter once, then assert that body routing reconstructs the pinned table.
  Do not apply the measured body colour twice.
- Use seeded continuous texture; do not gate the component per note. Changing
  `bowNoiseLevel` may scale level only. It may not reshape harmonics or the
  pinned residual spectrum.
- Consuming assertions: level 0 is PCM-identical to legacy; level 1 recovers
  the pinned table within 2 dB median / 4 dB P95; body bypass measurably removes
  the fitted fixed-frequency colour; pp NHR exceeds ff NHR by at least 2 dB;
  profile rows are absent from the free-parameter manifest.

This supersedes T-039's provisional generic colour scalar for violin. The
shared excitation-noise architecture remains correct, but L14 supplies the
measured multi-band profile and exact consumption contract.

## Reproduction

```sh
node scripts/render_note.mjs --batch tests/fixtures/bow-noise-engine-batch.json
PYTHONPATH=. python -m scripts.tone_match.bow_noise validate \
  --mixed /private/tmp/sg2/bow-noise-l14/engine-mixed.wav \
  --harmonic-only /private/tmp/sg2/bow-noise-l14/engine-harmonic-only.wav \
  --f0 440 --output /private/tmp/sg2/bow-noise-l14/validation.json
PYTHONPATH=. python -m scripts.tone_match.bow_noise extract \
  --body-references /private/tmp/sg2/campaigns/violin/body-references.json \
  --samples /private/tmp/sg2/samples/violin \
  --validation /private/tmp/sg2/bow-noise-l14/validation.json \
  --output /private/tmp/sg2/bow-noise-l14/iowa-profile.json \
  --measured web/static/measured_profiles.json
python scripts/gen_measured_profiles_module.py
```

The external JSON artifacts retain all per-group diagnostics; no source audio
is committed.
