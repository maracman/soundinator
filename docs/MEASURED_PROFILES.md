# Measured instrument profiles

`web/static/measured_profiles.json` is the full analysis record and
`web/static/measured_profiles.js` is the engine-facing projection. No source
audio ships in this repository. The July 2026 WP-3 refresh analysed 11 covered
instruments; the earlier flute and trombone fits remain for saved-preset
compatibility, giving 13 measured catalogue entries in total. A subsequent
owner-requested addition promoted flute into the same refreshed corpus, so 12
entries now use the current WP-3 contract and only trombone remains legacy.

## Reproduce the fit

The corpus handoff is complete only when every instrument folder has both
`PROVENANCE.json` and `COVERAGE.md`:

```bash
PYTHONPATH=src:. python3 scripts/tone_match/finalize_corpus.py \
  --samples /private/tmp/sg2/samples \
  --vocalset-root /private/tmp/sg2/vocalset_extract/FULL

PYTHONPATH=src:. python3 -m scripts.tone_match.strings_prep \
  --instrument violin \
  --samples /private/tmp/sg2/samples \
  --output /private/tmp/sg2/campaigns

PYTHONPATH=src:. python3 scripts/fit_profiles_from_samples.py \
  --samples /private/tmp/sg2/samples \
  --body-references /private/tmp/sg2/campaigns \
  --out web/static/measured_profiles.json \
  --partials 64 --require-contract

python3 scripts/gen_measured_profiles_module.py
node scripts/verify_tone_model.mjs
```

`finalize_corpus.py` does not download anything. It selects material already
present in the external corpus, records file-level provenance, and writes the
strict handoff contracts. Audio stays under `/private/tmp/sg2`.

## Sources and licences

| Source | Instruments | Terms used by this project |
|---|---|---|
| [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MIS.html) | flute, violin, cello, piano, guitar, clarinet, alto saxophone, trumpet, French horn | Public downloads; Iowa permits use in projects. Only derived parameters are committed. |
| [Philharmonia Orchestra sound samples](https://philharmonia.co.uk/resources/sound-samples/) | alternate string, guitar, and horn takes | Free project use under Philharmonia's sample terms; raw samples are not redistributed. |
| [VocalSet, Zenodo record 1193957](https://zenodo.org/records/1193957) | adult voice measurements | CC BY 4.0. The dataset paper describes 20 professional singers and the recording/technique design. |

The authoritative, file-by-file source URL and licence statement lives in each
external instrument folder's `PROVENANCE.json`.

## Stored measurements

- `partials` contains the 64-partial aggregate table; `partialsByRegister`
  contains three log-f0 anchors consumed by `registerProfileAt()`.
- `partialB` and `partialBByNote` store stiff-string inharmonicity.
- `material` stores the fitted T60 power law and closest engine material.
- `performance` stores ADSR, attack-noise, vibrato, and slow f0-drift
  statistics. Designated vibrato takes describe vibrato when used, not its
  musical probability.
- `attack.lowToHighStaggerMs` stores the measured spectral-onset stagger.
- Voice entries additionally store F1-F5 and bandwidths by labelled vowel in
  `vowelFormants`. The engine exposes these as fixed-Hz measured body presets.

## WP-3 results

F0 ranges are the analyser's detected ranges, not advertised playable ranges.
T60 on sustained instruments is a player-damped release-tail estimate; on
guitar and piano it is a free-decay estimate.

| Instrument | Notes | f0 Hz | B | T60 @ C4 / slope | Vibrato Hz / ±cents | Slow drift SD (cents) | Tail dB/oct |
|---|---:|---:|---:|---:|---:|---:|---:|
| alto saxophone | 96 | 139–856 | 0 | 0.174 / −0.465 | 4.71 / 6.43 | 1.08 | −10.0 |
| cello | 142 | 65–1505 | 0 | 4.504 / 0.377 | 4.10 / 11.05 | 0.11 | −13.1 |
| clarinet | 126 | 146–1924 | 0 | 0.180 / −0.220 | 3.41 / 3.74 | 0.45 | −8.2 |
| French horn | 110 | 56–699 | 0 | 0.467 / −0.236 | 4.33 / 5.67 | 1.03 | −15.6 |
| acoustic guitar | 25 | 59–1424 | 5.83e−5 | 4.849 / 0.827 | — | 2.20 | −9.2 |
| piano | 23 | 66–1104 | 1.16e−4 | 16.211 / 0.637 | — | 0.03 | −11.3 |
| trumpet | 107 | 164–1254 | 4.0e−8 | 0.325 / −0.231 | 4.81 / 6.18 | 1.30 | −14.9 |
| violin | 117 | 195–2039 | 0 | 1.274 / −0.088 | 5.91 / 30.34 | 1.00 | −15.5 |
| bass-voice proxy | 27 | 127–841 | 0 | 0.471 / −0.292 | 5.38 / 82.12 | 11.80 | −14.0 |
| mezzo-voice proxy | 28 | 257–637 | 0 | 4.167 / 0.492 | 3.01 / 84.11 | 5.47 | −5.1 |
| tenor-voice proxy | 57 | 127–556 | 0 | 0.438 / −0.084 | 5.80 / 77.36 | 4.90 | −10.6 |
| flute | 109 | 247–2016 | 3.2e−7 | 0.331 / −0.041 | 4.89 / 12.62 | 0.58 | +2.3† |
| trombone (legacy retained) | 24 | 131–499 | 8.0e−8 | 0.140 / −0.598 | — | — | −26.3 |

### Per-instrument interpretation

- **Alto saxophone:** three dynamics and three register runs produce the
  interim measured conical-reed fingerprint used by WP-5. It is not relabelled
  as tenor saxophone.
- **Flute:** 18 Iowa runs now cover three registers and pp/mf/ff with and
  without vibrato. The positive aggregate tail diagnostic is dominated by
  sparse, near-noise-floor high partial detections in the upper register; it
  is not used as a damping law. The per-register tables and measured attack,
  breath, and vibrato fields remain valid campaign inputs.
- **Clarinet:** the low anchor is strongly odd-dominant, while even energy
  rises sharply in the upper anchor. This directly exercises the G1
  register-dependent tables and the closed-tube construction assertion.
- **Trumpet and French horn:** the profiles retain their measured dynamic and
  register variation; WP-5 must still prove the nonlinear forte-brightening
  gate rather than assuming it from the aggregate table. The horn refit also
  removed an obsolete 100 Hz aggregation cutoff: all 110 accepted notes now
  contribute, including 26 observations below 100 Hz. Its register anchors
  moved from 163/342/571 Hz to 84/256/533 Hz, so the B1 campaign no longer
  receives a clamped mid-low spectrum.
- **Violin:** its fixed-Hz body now comes from a dedicated 48-note,
  pitch-anchored Iowa subset whose low partials tile 250–600 Hz. The fit
  recovers positive A0/B1 bands at 301/474 Hz with split-half correlation
  0.894; the broader 117-note corpus remains responsible for excitation and
  performance tables. **Cello:** partial spread remains high because
  adjacent notes move through strong fixed-Hz body resonances; per-register
  tables reduce, but do not eliminate, that source/body confound.
- **Piano:** the larger corpus revises the old four-note B estimate downward
  to 1.16e−4. The register anchors retain the per-register progression, and
  the 16.2 s T60 remains outside the engine's single-stage material range.
- **Guitar:** non-zero B and a two-stage-feeling decay support the G4/G5
  struck/plucked campaign, but the vibrato detector output is not consumed as
  a guitar performance default.
- **Adult voices:** VocalSet does not publish a singer-ID-to-voice-type table.
  `male1+male5`, `male3+male11`, and `female2+female6` are explicitly
  empirical bass, tenor, and mezzo register proxies, respectively. They are
  stepping stones, not metadata claims.

## Voice formants and current limitation

Each voice proxy contains all five labelled vowels (`a e i o u`) and five LPC
bands per vowel. Bass and tenor low bands are stable across held tones and
straight scales. The mezzo source f0 (257–637 Hz) is high enough that F1 is
sometimes below the first resolved harmonic; consequently its low F1/F2 bands
are marked as resolution-limited evidence and must be rechecked during WP-8.
The fix is filed as **SG2-WP8-FORMANT-LOWBAND**: add lower straight-vowel takes
or a harmonic-envelope/formant tracker designed for high-f0 singing before a
mezzo preset can claim the reference-variability floor.

The very wide vocal vibrato depths come from VocalSet's designated vibrato
technique. They are conditional technique measurements and are not copied into
factory preset probability/depth without the WP-8 optimiser.

## General limitations

1. Source filenames encode dynamics and techniques, but loudness calibration
   is not shared across Iowa, Philharmonia, and VocalSet.
2. Sustained-note release tails measure player damping as well as instrument
   damping; negative fitted slopes therefore remain diagnostics, not universal
   material laws.
3. `spread` includes performer/take variance and residual body-response motion.
4. Vocal proxy identity is empirical. Contrabass is constructed from the bass
   stepping stone and boy soprano from the documented morphology law; neither
   is fabricated as a direct recording fit.
5. Quantitative tripwires are ship minimums. Campaign completion still requires
   the run report's per-group reference-variability-floor evidence or a named
   limiting factor and filed fix.

† Diagnostic only; see the flute note above.
