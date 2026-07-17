# SG2 sung campaign — pass 03 integration and soprano selection

Date: 2026-07-17
Owner: Agent E / sung lane
Branch: `codex/sg2-e-sung-r2`
Exit state: canonical gate integration complete; no section frozen

## Outcome

The SUNG runner now consumes the shared construction and §3 tripwire gates
instead of recreating local gate tables. It also consumes a hash-locked
controllability audit: the exact 45-row tenor spectral objective and final
weight table must match before rendering. The audit is pitch-anchored to the
official VocalSet annotations, repeat-stable, and clean.

Every identity fit now begins from the pinned legacy `vocal` craft prior
(`sg2-legacy` / `e8d3ac123c0f1c2647c4dbf03d48934b1966564d`, parameter hash
`8b1047dfbe83d6ba`). Singer-specific pooled partials and per-vowel bodies are
laid over its envelope, aspiration, humanisation and vibrato idioms. FIT mode
temporarily removes randomness for scoring; SHIP mode restores the craft prior
and uses fresh seeds for listening.

No section passes freeze gates. Tenor and soprano body reconstruction remains
well beyond the 1 dB research gate, and soprano lacks an above-passaggio
long-tone cell.

## Soprano primary selection

All seven official corpus-labelled soprano candidates were admitted to the
same evidence procedure: required role coverage, clipping, edge SNR, straight
and vibrato completeness, then official-annotation pitch lock. `female1` is the
primary.

| Singer | Complete required matrix | Clipped files | Median edge SNR |
|---|---:|---:|---:|
| female1 | yes | 0 | 25.39 dB |
| female2 | yes | 1 | 15.83 dB |
| female3 | yes | 1 | 18.12 dB |
| female4 | yes by tuple QC; no usable straight-scale extension | 0 | 15.21 dB |
| female6 | yes | 2 | 14.06 dB |
| female7 | yes | 0 | 15.07 dB |
| female9 | yes | 2 | 13.68 dB |

Female1 has zero clipped files and a roughly 7.3 dB SNR advantage over the
next-best complete candidate. Its 45 spectral segments then produced 41
strictly analyzable rows and four explicit rejects. All 41 analyzed rows pass
the ±50-cent annotation lock (median absolute 13.00 cents, P95 47.34 cents,
maximum 49.74 cents).

Durable evidence:

- candidate QC: `sg2-data/samples/voice-soprano/SOPRANO_CANDIDATE_SIGNAL_QC.json`
- reference build: `sg2-data/campaigns/voice-soprano/REFERENCE_BUILD.json`
- pitch QC: `sg2-data/campaigns/voice-soprano/SOPRANO_PRIMARY_PITCH_QC.json`
- first fit: `sg2-data/runs/voice-soprano/pass03-f1-source-vowels`

The reference set has 114 rows: 45 spectral, 45 onset, 10 vibrato, 44 floor,
and 15 humanisation-role rows, spanning all five vowels and ff/mf/pp. Its
available spectral anchors are MIDI 60, 72 and 77. Under the declared soprano
passaggio prior, MIDI 77 lies on rather than above the boundary, so coverage is
only low/mid and `passaggioStraddled=false`. This is a corpus limiter, not a
reason to relabel the boundary or claim a high-register pass.

The first female1 alternating fit analyzes 41/45 rows, with 4.8025 dB median
and 16.1111 dB P95 scale-free reconstruction error. It has begun, but it is not
a candidate for canonical scoring or freezing until the missing high cell and
body error are resolved.

## Tenor canonical integration

The male3 source/vowel fit was regenerated on the legacy craft prior. It
analyzes 30/45 spectral rows, rejects 15 at the strict pitch gate, and reports
4.8419 dB median / 18.6591 dB P95 reconstruction error. The canonical run is
`sg2-data/runs/voice-tenor/pass03-canonical`; its audit is
`sg2-data/runs/voice-tenor/pass03-controllability`.

Controllability contract:

- objective hash: `8933926c01eeb666`
- manifest hash: `72c3dc64fddc64e1`
- repeat stability: PASS
- positive-weight features without responders: none
- retained positive-weight features: partials, log-mel, centroid, attack,
  noise, sustain noise, onset tilt/noise, band balance and LTAS rolloff
- zero-weight watches: decay, inharmonicity, vibrato/trajectory, body AM,
  noise lead and sung scoop/wander/lock-in measures

The construction, tripwire and vowel rows below are emitted by the shared
`evaluate_construction`, `evaluate_tripwires`, `required_cells_by_bar` and
`aggregate_by_cell` consumers. They are intentionally not hand-authored.

| Gate | Result |
|---|---|
| Construction | FAIL, 9/10 assertions pass; pitch-synchronous breath fails (`voiceBreathSync=0`, reference noise median 0.02170) |
| Strict §3 tripwires | FAIL; partial, mel, attack and band-balance each fail 9/9 required register × dynamic cells; no missing cells |
| Vowel classification | FAIL, 0/10 required vowel × low/mid rows |
| Distributional humanisation | FAIL / not yet fitted |
| Overall | **FAIL / integration baseline only** |

The shared runner scores 30 rows and explicitly rejects 15 pitch-unlocked
references. Mean composite distance is `4.289207`. Canonical construction
confirms the correct excitation, coverage, pitch lock, sustained envelope,
glottal rolloff/law, singer-formant law and tenor singer-formant band; the
remaining construction failure is therefore a specific consumer/fit gap, not
an ambiguous overall score.

## Consonant adaptation and zero-weight firewall

The landed phone-aligned LibriSpeech subset now has a deterministic
spoken-to-sung feature build at
`sg2-data/campaigns/sung-consonants/CONSONANT_ONSET_FIT.json`. It balances 48
plosives, 48 nasals and 48 fricatives and retains both spoken measurements and
the provisional S31–S33 adaptation. The first adapted medians are 49/56/70 ms
duration for plosive/nasal/fricative, with burst centroids 3210/770/5567 Hz;
plosive VOT is 24.7 ms.

All burst-centroid, burst-duration, VOT and F1/F2-transition weights are
exactly zero. A-VOICE-03 and D-VOICE-02 now specify the generator and feature
consumers; no weight may activate until the controllability audit passes.
D-VOICE-03 requests the family-firewall assertion covering both fitted-value
imports and optimizer/leaderboard seeds.

## Remaining gates

- Obtain or record above-passaggio long-tone evidence for female1; do not
  weaken the declared three-register coverage contract.
- Refine tenor and soprano source/body fits below the reconstruction gate and
  pass shared vowel classification.
- Complete D's per-vowel structured controllability and family firewall.
- Fit §2.5c same-singer repeat distributions only after each deterministic
  identity stabilises; pass the distributional gate before any freeze.
- Keep mezzo f5 and bass m8 unfrozen until their class-specific engine
  consumers and canonical runs pass.
