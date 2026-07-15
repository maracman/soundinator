# Sound Generator 2.0 implementation workflow

This directory records the executable portion of
`docs/SOUND_GENERATOR_2_PLAN.md`. Public reference-corpus downloads and
optimization artifacts remain outside git under `/private/tmp/sg2/`.

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
