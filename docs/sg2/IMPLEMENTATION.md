# Sound Generator 2.0 implementation workflow

This directory records the executable portion of
`docs/SOUND_GENERATOR_2_PLAN.md`. Public reference-corpus downloads and
optimization artifacts remain outside git under `/private/tmp/sg2/`.

## Owner-note preflight

Before starting or resuming any SG2 fitting, refinement, compression, or
freeze session, read `docs/sg2/OWNER_LISTENING_NOTES.md` from the top and
check for additions since the previous run. Treat every applicable new entry
as a work item in the normal §2.5 loop: verify its engine/scorer evidence,
implement or file the identified gap, and rerun affected instruments before
freeze. A prior read is not sufficient because the file is intentionally a
live owner-feedback queue.

## Reference layout

Reconstruct the corpus as:

```text
/private/tmp/sg2/samples/
  <instrument>/
    PROVENANCE.json
    COVERAGE.md
    <pitch>-<dynamic>[-vib|-nonvib].wav
```

Each `PROVENANCE.json` records source, direct URL, licence, performer (when
known), download date, pitch, dynamic and any conversion. Do not copy source
audio into this repository. `COVERAGE.md` records the landed register,
dynamic, vibrato and gap coverage. Campaign analysis always uses the strict
contract flag so a partially written acquisition folder cannot be fitted.

## Commands

```bash
# Fit measured/pinned parameters.
python3 scripts/fit_profiles_from_samples.py \
  --samples /private/tmp/sg2/samples \
  --body-references /private/tmp/sg2/campaigns \
  --out web/static/measured_profiles.json --partials 64 --require-contract
python3 scripts/gen_measured_profiles_module.py

# Render exactly one browser-engine note with neutral space.
node scripts/render_note.mjs --params preset.json --midi 60 --out note.wav

# Compare a render and reference and write the HTML report.
python3 -m scripts.tone_match.score --ref reference.wav --render note.wav \
  --json score.json --report report.html

# Optimize the free-tier manifest and append best-so-far ledger evidence.
python3 -m scripts.tone_match.iterate --instrument clarinet \
  --initial clarinet.json --references clarinet-references.json

# Verify ledger-approved family morphs and derive a playback-density variant.
python3 -m scripts.tone_match.verify_morph --manifest morphs.json --out morph-results.json
python3 -m scripts.tone_match.compress_preset --params fitted.json \
  --references references.json --out shipping.json

# Build the one-file capstone listening kit.
python3 -m scripts.tone_match.audition --manifest audition.json --out audition.html
```

Install the optional analysis/test dependencies with
`pip install -e '.[audio,dev]'`. The renderer also requires `npm install` and
Playwright Chromium.

## Campaign gates

The fitting campaigns are fully automated: every candidate must pass the §3
feature tripwires plus its dossier construction assertions. Refinement follows
§2.5 and continues until the run report demonstrates the reference-variability
floor, or the session records a measurable improvement or a named limiting
factor with a concrete follow-up work item. Human A/B/X audition is deferred to
the capstone and does not block fitting or preset freezing.

Construction assertions live in `scripts/tone_match/assertions.py`; the four
evidence dossiers in this directory define their physical meaning and source
thresholds. `score.py --instrument ... --params ...` reports note-local checks
and marks unavailable cross-note evidence `not-applicable`. `iterate.py` runs
the same checklist in strict campaign mode: missing register/dynamic/preset
evidence is a failure, every failure receives a separate hard objective
penalty, and best-candidate selection ranks construction failures before raw
perceptual loss. Reference manifests must label every row with `register` and
either `dynamic` or `velocity`.

Reference manifests may include multiple takes of the same pitch/dynamic.
Give them the same optional `floorGroup` (otherwise MIDI, dynamic,
articulation and vibrato labels define the group). The optimiser writes
`referenceVariabilityFloor` evidence to `summary.json` and a readable
`RUN_REPORT.md`. A run may exit successfully only after a leaderboard
improvement, a per-group render distance at or below the take-to-take floor,
or an evidenced plateau supplied with both `--limiting-factor` and a concrete
`--work-item`; the latter is filed in the instrument's external
`work-items.json`. An unqualified plateau exits nonzero as `invalid-stop`.

The reference recordings are public corpus inputs (Iowa MIS, Philharmonia and
VocalSet) stored outside git. Tenor sax uses the approved modelling-synth gap
path; boy soprano uses a found reference or the dossier's approved morphology
construction. Audio is never committed.

## Corrected-objective audit

The blown-family objective was corrected to give stiff-string `B` zero weight
and to ignore sub-audible transient-centre errors. Presets frozen before that
change must be re-audited; an old green report is not grandfathered.

The 2026-07-15 audit reopened clarinet and trumpet. Their construction
checklists still pass, but the clarinet MIDI-72 `pp` group is 1.3618× its
alternate-take floor and the trumpet MIDI-72 `pp` group is 1.1385×. Corrected
audit artifacts and filed fixes live beside the external runs under
`/private/tmp/sg2/<instrument>/`; neither preset is considered frozen until a
current-engine render demonstrates every available group at or below floor.

WP-3 register-envelope evidence then improved the reopened leaders: clarinet
loss fell from 3.5683 to 3.5565 and its worst ratio to 1.3421×; trumpet loss
fell from 3.8301 to 3.8050, while its 1.1385× high-soft limit was unchanged.
These are committed improvements, not freeze claims; both external work items
remain open for corrected-objective refinement.

Flute was added to the covered WP-5 matrix with six Iowa/Philharmonia
alternate-take groups and a measured three-anchor register attack table. Its
first formal pass improved loss from 4.3298 to 4.1344 with construction green.
Low-forte and both high-register groups reached their variability floors;
low-soft (1.1741×), mid-forte (1.0412×), and mid-soft (1.2017×) remain open.
The corrected weighted residual report identifies spectral centroid—not the
zero-weight stiff-string diagnostic—as the next refinement target.

A focused onset-law pass then improved flute again from 4.1344 to 3.9170.
`attackNoiseVelocityExponent ≈ 0.0011` and 30% independent transient routing
closed the low-soft floor without weakening construction. Mid-forte is now
1.0420× floor and mid-soft 1.1805×; those two groups keep the campaign open.

Alto sax was then reopened under the same process. Its campaign matrix now
contains 12 Iowa/Philharmonia references and all six low/mid/high × pp/ff
variability-floor groups; WP-3 supplies three measured register-attack
anchors. The corrected baseline ran 98 evaluations, passed all construction
checks, and reached five floors, leaving only high-ff at 1.1499×.

The owner-note preflight then exposed two missing observables/laws: soft reed
air retained separately from tone, and onset-only harmonic colour. Neutral
engine controls and explicit sustained-noise/onset-tilt score dimensions were
added, then encoded as sax construction assertions. The 100-evaluation
owner-note pass improved its versioned objective from 3.9226 to 3.8672 and
passed all 13 assertions. Five groups remain at/below floor; high-ff is
1.2425× under the stricter objective. The interim factory preset now carries
that audited best. A filed external work item limits the next change to
register/dynamic-conditioned breath and onset anchors; alto sax is not frozen.
The full-fidelity preset initially failed renderer-density tripwires at 39
oscillators/390 automation events. Scorer-gated audibility culling selected
`spectralCullThreshold = 0.0024` (0.465 dB log-mel delta, construction green;
0.0025 exceeded the 0.5 dB budget). The resulting interim passes resource
gates at 23 oscillators and 230 events, 1.15×/1.21× the factory median.

## P5.2 blown-family baseline reset (2026-07-16)

Agent B's P2 fit regenerated the harmonic source tables after separating each
instrument's fixed-Hz body and corrected the sustained-note partial estimator.
The bowed-only scorer dimensions remain zero-weight for blown instruments, but
the objective identity and source tables changed; no loss above this section is
comparable to the baselines below. Frozen reference manifests were retained.
Each input combines its last valid fitted free values with the new measured
ADSR/onset pins, the L4 deterministic blown-air engine path, and its own
13–15-band body at reconstruction strength.

| Instrument | Objective ID | Baseline loss | Construction | Floor groups | Worst ratio | Dominant residual |
|---|---|---:|---|---:|---:|---|
| Flute | `9f851b331f59cb1e` | 3.9317 | pass | 1 / 6 | 1.5627× | centroid, 8.99 semitones |
| Clarinet | `62f5373d70abab8e` | 3.6407 | pass | 1 / 5 | 1.4552× | centroid, 6.70 semitones |
| Alto sax | `e21eda13e72af06e` | 3.9264 | pass | 3 / 6 | 1.2109× | centroid, 13.16 semitones |
| Trumpet | `ad19b84dad5525e6` | 3.1211 | pass | 0 / 2 | 1.3968× | centroid, 7.26 semitones |
| French horn | `0ffe1905b2a96981` | 2.8883 | pass | 1 / 6 | 1.8805× | onset scoop, 5.82 perceptual units |

All five campaigns remain open. The table is the new lineage baseline, not an
improvement claim and not a freeze decision. Refinement starts from these
reports only; prior leaderboards are retained as historical artifacts but are
excluded from comparisons.
