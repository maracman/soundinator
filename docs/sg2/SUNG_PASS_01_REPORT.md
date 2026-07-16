# SG2 sung campaign — pass 01

> Historical report. Owner decision 12 (2026-07-17) supersedes this report's
> target table: the fitted sections are now soprano, mezzo-soprano, tenor, and
> bass. Basso profondo and boy soprano are derived audition-only extensions.
> See `SUNG_PASS_02_REPORT.md` for the current gate registry.

Date: 2026-07-16
Owner: Agent E / sung lane
Branch: `codex/sg2-sung-pass01`
Exit state: §2.5(b), evidenced limiting factors with consuming-side fixes filed

## Outcome

Pass 01 establishes identity-safe adult reference sets, a sung-only
source/body fitter, a controllability policy, engine/analysis handoffs, and the
first real-engine tenor baseline. The baseline is not shippable: every scored
§3 row fails the partial, mel, and attack gates; the V0.1 vowel construction
gate passes 0/10 required low/mid rows. It is frozen as an
`interim-limiting-factor` baseline so the next pass can improve from a stable
objective instead of waiting for perfect scaffolding.

No reference audio is tracked by git. All corpus, reference, audit, run,
leaderboard, and listening artifacts are under durable `SG2_DATA`.

## Primary singer identities

| Target | Primary identity | Decision |
|---|---|---|
| Tenor | VocalSet `male3` | VocalSet labels m3 a tenor. A same-material annotated-note pitch screen gave 20/30 locks overall and 9/10 in the high register, versus m11's 20/30 overall but 2/10 high. M2 passed 15/30; m7's type is uncertain. |
| Contrabass / basso-profondo construction | VocalSet `male8` | VocalSet labels m8 a bass. It has 15/15 required long-tone cells, no clipped files, and 7.58 dB median edge-SNR. M4 is uncertain and m10 is bass-baritone. The requested lower basso-profondo octave remains the owner-approved later capture extension. |
| Mezzo-soprano | VocalSet `female5` | F5 is corpus-labelled mezzo, complete, unclipped, and has 13.59 dB median edge-SNR. F8 has a clipped/near-full-scale forte `/i/` and 3.88 dB median edge-SNR. |
| Boy soprano | none | No suitable corpus was found. Per §9 decision 2, construction waits for the fitted adult morphology and remains exempt from quantitative tripwires, but not from construction or owner-ear gates. |

The carried `voice-bass` and `voice-mezzo` measured profiles are quarantined:
they pool m1+m5 baritones and f2+f6 sopranos respectively. A plausible profile
key cannot override corpus identity metadata.

## Reference sets

| Target | Rows | Spectral/onset | Vibrato | Floor | Humanisation | Passaggio |
|---|---:|---:|---:|---:|---:|---|
| Tenor m3 | 116 | 45 | 10 | 46 | 15 | 330 Hz straddled |
| Bass m8 | 128 | 45 | 15 | 53 | 15 | 260 Hz straddled |
| Mezzo f5 | 122 | 45 | 15 | 47 | 15 | 523.25 Hz straddled |

Every spectral row carries singer, vowel, technique/context, dynamic,
official annotation MIDI/f0, register, role, and same-singer floor group. Each
adult set covers `/a e i o u/`, low/mid/high, and pp/mf/ff. Missing optional
annotation files are excluded before hashing; tenor pp long tones reuse the
official straight-note score anchors with amplitude-derived boundaries.

VocalSet source: Zenodo record 10200775, CC BY 4.0, archive MD5
`8d39344bbc775aa040840783ae73cfa4`. The selected archive members and corrected
extended-4 annotations were extracted by HTTP range request rather than
duplicating the 2.5 GB archive.

## Tenor fit and frozen leaderboard

Method: alternate one harmonic-rank source pooled across m3 observations with
five independent fixed-Hz Gaussian vowel bodies. Per-note level is removed on
each update, and the emitted engine body basis is the reconstruction basis.

| Measure | Result |
|---|---:|
| Spectral references | 45 |
| Analysed / strict f0 rejects | 30 / 15 |
| Literature-prior formant fallbacks | 23 |
| Scale-free source/body reconstruction, median | 4.8419 dB |
| Reconstruction P95 | 18.6591 dB |
| Valid vibrato analyses | 2 |
| Real-engine audition rows scored / rejected | 8 / 7 |
| Mean composite on final zero-weight policy | 4.188353 |
| Vowel construction gate | FAIL, 0/10 |

Frozen state:

- run: `sg2-data/runs/voice-tenor/pass01-m3-source-vowels`
- objective hash: `df4be02ce7995b09`
- reference hash: `7ff982ea31d819c3`
- manifest hash: `987dd39834fdedd0`
- status: `interim-limiting-factor`
- m11 pass: retained as `superseded-identity`, not compared on the m3 objective

## §3 per-preset gate table

`FAIL (not run)` means the preset cannot pass merely because a required fit or
consumer does not yet exist.

| Preset | Partials ≤3 dB | Mel ≤4 dB | Attack tolerance | Vibrato | Construction | Human ranges | Resource | Overall |
|---|---|---|---|---|---|---|---|---|
| Tenor m3 | FAIL 0/8 | FAIL 0/8 | FAIL 0/8 | FAIL/watch; only 2 valid analyses and trajectory controls are absent | FAIL: vowel 0/10; source/body median 4.84 dB | FAIL | FAIL/watch: 43/42/38 post-cull oscillators at MIDI 48/60/65; no factory-relative custom benchmark | **FAIL** |
| Contrabass m8 | FAIL (not run) | FAIL (not run) | FAIL (not run) | FAIL (not run) | FAIL: per-class singer-formant centre consumer absent | FAIL | not benchmarked | **FAIL** |
| Mezzo f5 | FAIL (not run) | FAIL (not run) | FAIL (not run) | FAIL (not run) | FAIL: high-register F1→f0 law absent | FAIL | not benchmarked | **FAIL** |
| Boy soprano | exempt | exempt | exempt | exempt | FAIL: adult-derived morphology construction not started | FAIL | not benchmarked | **FAIL / best-effort pending** |

Inharmonicity B and bowed lock-in are family-inapplicable watch metrics for a
harmonic glottal source. The capstone A/B/X qualitative gate is pending for all
four targets.

## Controllability policy

The m3 audit is repeat-render stable and clean only after required
zero-weighting.

| Weighted and responsive | Zero-weight watch metrics |
|---|---|
| partials, log-mel, centroid, attack, noise, sustain noise, onset tilt, onset noise level/centroid, band balance, LTAS rolloff | body AM, decay, inharmonicity, noise lead, onset lock-in, onset scoop depth/settle, onset wander, vibrato scalar, vibrato delay/ramp/drift |

Sung-only zero-weight senses are formant tuning and consonant burst/VOT/formant
transition. They cannot acquire loss weight until the responsible engine law,
licensed corpus, and responsiveness assertion exist.

The complete feature-by-feature table is in
`sg2-data/audits/voice-tenor/pass01-m3-controllability/CONTROLLABILITY_FINAL.md`.

## Humanisation hard gate

The references contain same-singer duplicate floor candidates:

- tenor: 6 groups / 12 rows;
- bass: 5 groups / 10 rows;
- mezzo: 6 groups / 12 rows.

No identity-frozen differential fit has yet produced `humanRanges`, so §2.5c
is **FAIL** for every adult voice. These pairs are evidence availability, not
permission to ship guessed variation.

## NUS-48E licence escalation

The official NUS Sound and Music Computing page exposes the corpus through a
Google Drive link, and the NUS-48E paper describes the recordings, but neither
states a licence. A separate NUS corpus licence found during the check is
non-commercial, non-transferable, and explicitly tied to its named
corpus/order; it cannot be presumed to cover NUS-48E.

Decision required from the owner/NUS: confirm the exact NUS-48E licence/EULA
before acquisition. No NUS audio was downloaded, consonant scorer weights stay
zero, and all consonant parameters remain neutral. If permission is not
available, evaluate the filed CSD/spoken fallback path rather than silently
substituting a corpus.

## Filed consuming-side fixes

Detailed schemas and assertions are in `docs/sg2/SUNG_ENGINE_HANDOFFS.md`.

| ID | Owner | Blocking evidence | Required consumer |
|---|---|---|---|
| A-VOICE-01 | Agent A | singer-formant centre is hardcoded at 3000 Hz; bass cluster needs about 2.3–2.6 kHz | defaults-neutral `singerFormantHz`, plus rendered centre assertions |
| A-VOICE-02 | Agent A | mezzo upper register needs class-conditional F1 tracking of f0 | defaults-neutral `formantTuneToF0`, moving only F1 above its fitted threshold |
| A-VOICE-03 | Agent A | consonants are absent from VocalSet and no generator exists | corpus-gated burst/VOT/formant-transition gestures on the shared articulation latent |
| D-VOICE-01 | Agent D | shared scorer/iterator lacks sung contracts and still has reaped-root defaults | sung feature consumers, identity/annotation guards, durable `SG2_DATA`, and per-vowel bundle listening/iteration |

The immediate tenor residual is dominated by unreliable formant observations
(23 literature fallbacks), strict f0 rejects (15/45), and an engine output that
does not preserve fitted vowel identity. The next legal pass is therefore:
improve/ack the sung formant consumer, land the per-vowel bundle contract, then
refit m3. Contrabass and mezzo follow after their class-defining engine laws
have consuming assertions.

## Exchange and owner-note accounting

- `TECHNIQUES_EXCHANGE.md` records sung dispositions for T-001–T-048.
- T-049 freezes corpus identity labels as evidence.
- T-050 records the pooled-source/per-vowel-body method.
- T-051 freezes official annotation f0 as the segmentation contract.
- T-052 records that a public link is not a licence.
- FAMILY FIREWALL applied: only shared architecture transfers. No blown/bowed
  slopes or fitted values enter the sung defaults.
- L4 architecture is adapted only as the future sung aspiration path; values
  stay neutral pending the primary singer's own evidence.
- L12/T-003 sparse-partial body application is carried into the contrabass
  handoff rather than ignored.

## Listening

The authoritative labelled sung page is
`sg2-data/listen-sung.html`, with 15 m3 straight-tone rows grouped by vowel and
register. The shared `sg2-data/listen.html` was rebuilt from the engine checkout
for five current instruments. Its voice row remains non-authoritative until
D-VOICE-01 proves it consumes the five-body sung bundle.
