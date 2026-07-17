import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from scripts.tone_match.sung_body_constraints import constrain
from scripts.tone_match.sung_breath_seed import seed_breath
from scripts.tone_match.sung_source_refine import refine


def _write_fit(root: Path, *, formant: float = 1050.0) -> None:
    centres = {
        "i": [320.0, 2000.0],
        "e": [500.0, 1600.0],
        "a": [700.0, formant],
        "o": [450.0, 850.0],
        "u": [350.0, 900.0],
    }
    bodies = {
        vowel: {
            "formantsHz": centres[vowel],
            "bands": [
                {"freq": centres[vowel][0], "gain": 2.0},
                {"freq": centres[vowel][1], "gain": 1.0},
            ],
        }
        for vowel in "aeiou"
    }
    payload = {
        "baseParams": {"toneBreath": 0.03},
        "fit": {"vowelBodies": bodies},
    }
    root.mkdir()
    (root / "SOURCE_VOWEL_FIT.json").write_text(json.dumps(payload))
    for vowel in "aeiou":
        (root / f"initial-{vowel}.json").write_text(json.dumps({
            "bodyBands": bodies[vowel]["bands"],
            "toneBreath": 0.03,
        }))


def test_annex_constraint_moves_only_fitted_centre_and_matching_band(tmp_path):
    fit = tmp_path / "fit"
    out = tmp_path / "out"
    _write_fit(fit, formant=1020.0)

    result = constrain(fit, out, "bass")

    change = next(row for row in result["changes"] if row["vowel"] == "a")
    assert change == {
        "vowel": "a",
        "formant": 2,
        "oldHz": 1020.0,
        "newHz": 1034.0,
        "annexBoundsHz": [1034.0, 1504.0],
        "reason": "fitted centre outside independent class-scaled annex region",
    }
    params = json.loads((out / "initial-a.json").read_text())
    assert params["bodyBands"][1]["freq"] == 1034.0
    assert params["bodyBands"][1]["gain"] == 1.0
    assert params["toneBreath"] == 0.03


def test_source_refinement_pools_one_correction_across_vowels(tmp_path, monkeypatch):
    fit = tmp_path / "fit"
    baseline = tmp_path / "baseline"
    out = tmp_path / "out"
    _write_fit(fit)
    references = []
    manifest = []
    for vowel in "aeiou":
        references.append({
            "roles": ["spectral"],
            "voiceClass": "tenor",
            "vowel": vowel,
            "register": "low",
            "dynamic": "mf",
            "velocity": 0.6,
            "sourceFile": f"{vowel}.wav",
            "expectedF0Hz": 220.0,
        })
        manifest.append({"reference": f"ref-{vowel}", "fitRender": f"fit-{vowel}"})
    references_path = tmp_path / "references.json"
    references_path.write_text(json.dumps(references))
    baseline.mkdir()
    (baseline / "audition-manifest.json").write_text(json.dumps(manifest))
    calibration = tmp_path / "source.json"
    calibration.write_text(json.dumps({
        "schemaVersion": 1,
        "handoff": "T-064",
        "evidenceSha256": "evidence",
        "interpolationContract": "joint-hull",
        "dynamicComposition": "measured-only",
        "voices": {"tenor": {
            "sourceIdentity": "one-source",
            "rows": [{
                "register": "low",
                "dynamic": "mf",
                "partials": [1.0] * 8,
            }],
        }},
    }))

    def fake_analysis(path, **_kwargs):
        is_reference = str(path).startswith("ref-")
        amps = np.ones(8)
        if is_reference:
            amps[1:] = 2.0
        return SimpleNamespace(
            partial_amps=amps,
            partial_snr_ok=np.ones(8, dtype=bool),
        )

    monkeypatch.setattr(
        "scripts.tone_match.sung_source_refine.analyse_audio_file",
        fake_analysis,
    )
    result = refine(
        references_path, fit, baseline, calibration, out,
        correction_fraction=1.0, minimum_vowels=2,
    )

    surface = json.loads((out / "initial-a.json").read_text())[
        "spectralPartialsByRegisterDynamic"
    ]
    assert surface["sourceIdentity"] == "one-source"
    assert surface["rows"][0]["pass10Correction"]["analysedNotes"] == 5
    assert result["renderDomainSourceRefinement"]["oneSourcePerSinger"] is True
    assert result["renderDomainSourceRefinement"]["vowelBodiesChanged"] is False
    assert json.loads((out / "initial-a.json").read_text())["bodyBands"] == \
        json.loads((fit / "initial-a.json").read_text())["bodyBands"]
    for vowel in "eiou":
        other = json.loads((out / f"initial-{vowel}.json").read_text())
        assert other["spectralPartialsByRegisterDynamic"] == surface


def test_source_refinement_is_cumulative_and_relocates_quarantined_renders(
        tmp_path, monkeypatch):
    fit = tmp_path / "fit"
    baseline = tmp_path / "baseline-renderer-contract"
    out = tmp_path / "out"
    _write_fit(fit)
    source_fit_path = fit / "SOURCE_VOWEL_FIT.json"
    source_fit = json.loads(source_fit_path.read_text())
    source_fit["baseParams"]["spectralPartialsByRegisterDynamic"] = {
        "schemaVersion": 1,
        "handoff": "T-064",
        "evidenceSha256": "evidence",
        "sourceIdentity": "one-source",
        "interpolation": "joint-hull",
        "dynamicComposition": "measured-only",
        "rows": [{
            "register": "low", "dynamic": "mf",
            "partials": [1.0, 0.5, 0.25, 0.125],
        }],
    }
    source_fit_path.write_text(json.dumps(source_fit))
    references = [{
        "roles": ["spectral"], "voiceClass": "tenor", "vowel": vowel,
        "register": "low", "dynamic": "mf", "velocity": 0.6,
        "sourceFile": f"{vowel}.wav", "expectedF0Hz": 220.0,
    } for vowel in "aeiou"]
    references_path = tmp_path / "references.json"
    references_path.write_text(json.dumps(references))
    (baseline / "fit-renders").mkdir(parents=True)
    manifest = []
    for index, vowel in enumerate("aeiou"):
        relocated = baseline / "fit-renders" / f"{index:03d}-{vowel}.wav"
        relocated.write_bytes(b"render")
        manifest.append({
            "reference": f"ref-{vowel}",
            "fitRender": str(tmp_path / "old-run" / relocated.name),
        })
    (baseline / "audition-manifest.json").write_text(json.dumps(manifest))
    calibration = tmp_path / "source.json"
    calibration.write_text(json.dumps({
        "schemaVersion": 1, "handoff": "T-064",
        "evidenceSha256": "evidence", "interpolationContract": "joint-hull",
        "dynamicComposition": "measured-only",
        "voices": {"tenor": {"sourceIdentity": "one-source", "rows": [{
            "register": "low", "dynamic": "mf", "partials": [1.0] * 4,
        }]}},
    }))

    def fake_analysis(path, **_kwargs):
        assert str(path).startswith("ref-") or Path(path).parent == baseline / "fit-renders"
        amps = np.ones(4)
        if str(path).startswith("ref-"):
            amps[1] = 2.0
        return SimpleNamespace(
            partial_amps=amps,
            partial_snr_ok=np.ones(4, dtype=bool),
        )

    monkeypatch.setattr(
        "scripts.tone_match.sung_source_refine.analyse_audio_file",
        fake_analysis,
    )
    result = refine(
        references_path, fit, baseline, calibration, out,
        correction_fraction=1.0, minimum_vowels=2,
    )

    emitted = json.loads((out / "initial-a.json").read_text())[
        "spectralPartialsByRegisterDynamic"
    ]["rows"][0]["partials"]
    assert result["renderDomainSourceRefinement"]["startingSurface"] == \
        "selected-fit-cumulative-surface"
    assert result["renderDomainSourceRefinement"]["analysedRows"] == 5
    assert result["renderDomainSourceRefinement"]["rejectedRows"] == []
    # The old selected partial 2 was 0.5.  Refinement doubles it to 1.0;
    # resetting to the calibration seed would incorrectly emit 2.0.
    assert emitted[1] == pytest.approx(0.99763116)


def test_breath_seed_requires_clean_lossless_activation_evidence(tmp_path):
    fit = tmp_path / "fit"
    out = tmp_path / "out"
    _write_fit(fit)
    evidence = tmp_path / "breath.json"
    evidence.write_text(json.dumps({
        "status": "pass",
        "voiceClass": "tenor",
        "measuredRows": 10,
        "cleanBreathRows": 9,
        "roomSuspectedRows": 1,
        "pitchSyncBreathDb": {"median": 20.0},
    }))
    calibration = tmp_path / "calibration.json"
    calibration.write_text(json.dumps({
        "schema": "sg2-pitch-sync-breath-calibration-v1",
        "provisionalVoiceBreathSync": {"tenor": 0.16},
    }))

    provenance = seed_breath(fit, out, evidence, calibration, 0.16)

    assert provenance["roomSuspectedRowsExcluded"] == 1
    assert provenance["fitFrozen"] is False
    assert json.loads((out / "initial-u.json").read_text())["voiceBreathSync"] == 0.16
    source = json.loads((out / "SOURCE_VOWEL_FIT.json").read_text())
    assert source["baseParams"]["voiceBreathSync"] == 0.16
