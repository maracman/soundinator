#!/usr/bin/env python3
"""Render and score the first per-vowel sung baseline."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import secrets
import subprocess

import numpy as np

from scripts.tone_match.assertions import ConstructionSample, evaluate_construction
from scripts.tone_match.controllability import objective_contract_hash
from scripts.tone_match.score import (
    compare_features,
    extract_features,
)
from scripts.tone_match.sung_features import vowel_classification_gate
from scripts.tone_match.sung_prior import params_for_mode
from scripts.tone_match.tripwires import (
    aggregate_by_cell,
    evaluate_tripwires,
    required_cells_by_bar,
)


def _consume_audit(path: Path, voice_class: str, references: list[dict]) -> dict:
    if not path.exists():
        raise ValueError(f"missing sung controllability audit: {path}")
    audit = json.loads(path.read_text())
    weights = audit.get("finalWeights") or {}
    errors = []
    if audit.get("instrument") != voice_class:
        errors.append(f"instrument {audit.get('instrument')!r} != {voice_class!r}")
    if audit.get("objectiveHash") != objective_contract_hash(voice_class, references, weights):
        errors.append("reference/weight objective hash mismatch")
    if not audit.get("clean"):
        errors.append("audit is not clean")
    uncontrolled = [
        feature for feature, weight in weights.items()
        if float(weight) > 0 and not audit.get("responsiveParameters", {}).get(feature)
    ]
    if uncontrolled:
        errors.append(f"positive-weight features lack responders: {uncontrolled}")
    if errors:
        raise ValueError("invalid sung controllability contract: " + "; ".join(errors))
    return audit


def build(
    references_path: Path,
    fit_root: Path,
    output_root: Path,
    repo_root: Path,
    audit_path: Path,
) -> dict:
    references = json.loads(references_path.read_text())
    voice_classes = {row.get("voiceClass") for row in references}
    if len(voice_classes) != 1:
        raise ValueError(f"audition requires exactly one voice class, found {voice_classes}")
    voice_class = next(iter(voice_classes))
    instrument = {
        "tenor": "voice-tenor",
        "bass": "voice-bass",
        "mezzo-soprano": "voice-mezzo",
        "soprano": "voice-soprano",
    }[voice_class]
    singer_ids = {row.get("singer") for row in references}
    if len(singer_ids) != 1:
        raise ValueError(f"audition requires exactly one identity singer, found {singer_ids}")
    selected = [row for row in references if "spectral" in row.get("roles", [])]
    audit = _consume_audit(audit_path, voice_class, selected)
    selected.sort(key=lambda row: ("aeiou".index(row["vowel"]),
                                   ("low", "mid", "high").index(row["register"]),
                                   row.get("velocity", 0), row["sourceFile"]))
    required_cells = {
        (row["vowel"], row["register"], row["dynamic"]) for row in selected
    }
    if len({row["vowel"] for row in selected}) != 5 or \
            len({row["register"] for row in selected}) < 3 or \
            len({row["dynamic"] for row in selected}) < 2:
        raise ValueError(
            "sung gate evidence must span five vowels, three registers and two dynamics"
        )

    output_root.mkdir(parents=True, exist_ok=True)
    fit_renders = output_root / "fit-renders"
    ship_renders = output_root / "ship-renders"
    fit_renders.mkdir(exist_ok=True)
    ship_renders.mkdir(exist_ok=True)
    jobs = []
    manifest = []
    ship_seed_base = secrets.randbits(30)
    for index, row in enumerate(selected):
        params = json.loads((fit_root / f"initial-{row['vowel']}.json").read_text())
        fit_params = params_for_mode(params, "fit")
        ship_params = params_for_mode(params, "ship", seed=ship_seed_base + index)
        fit_out = fit_renders / f"{index:03d}-{row['register']}_{row['dynamic']}_{row['vowel']}.wav"
        ship_out = ship_renders / f"{index:03d}-{row['register']}_{row['dynamic']}_{row['vowel']}.wav"
        jobs.append({
            "params": fit_params,
            "midi": row["midi"],
            "velocity": row["velocity"],
            "durationSec": row["durationSec"],
            "sampleRate": row.get("sampleRate", 44100),
            "out": str(fit_out),
        })
        jobs.append({
            "params": ship_params,
            "midi": row["midi"],
            "velocity": row["velocity"],
            "durationSec": row["durationSec"],
            "sampleRate": row.get("sampleRate", 44100),
            "out": str(ship_out),
        })
        manifest.append({
            "label": f"{voice_class} /{row['vowel']}/ {row['register']} {row['dynamic']} MIDI {row['midi']}",
            "vowel": row["vowel"],
            "register": row["register"],
            "dynamic": row["dynamic"],
            "reference": row["path"],
            "fitRender": str(fit_out),
            "render": str(ship_out),
            "shipSeed": ship_seed_base + index,
            "sourceFile": row["sourceFile"],
        })
    jobs_path = output_root / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=repo_root, check=True,
    )

    weights = dict(audit["finalWeights"])
    score_rows = []
    tripwire_notes = []
    construction_samples = []
    rendered_formants: dict[str, dict[str, tuple[float, float]]] = {}
    for row, trial in zip(selected, manifest):
        try:
            reference = extract_features(
                trial["reference"], expected_f0_hz=row["expectedF0Hz"]
            )
            rendered = extract_features(
                trial["fitRender"], active_duration_s=row["durationSec"],
                expected_f0_hz=row["expectedF0Hz"],
            )
        except (ValueError, RuntimeError) as exc:
            score_rows.append({
                "label": trial["label"],
                "vowel": row["vowel"],
                "register": row["register"],
                "dynamic": row["dynamic"],
                "midi": row["midi"],
                "composite": None,
                "features": {},
                "normalized": {},
                "weights": weights,
                "gates": {},
                "analysisError": str(exc),
            })
            continue
        score = compare_features(reference, rendered, weights)
        formants = rendered.note.formants
        if len(formants) >= 2 and row.get("technique") == "straight":
            rendered_formants.setdefault(row["vowel"], {})[row["register"]] = (
                float(formants[0]), float(formants[1])
            )
        roles = frozenset(row.get("roles", []))
        construction_samples.append(ConstructionSample(
            render=rendered,
            reference=reference,
            register=row["register"],
            dynamic=row["dynamic"],
            velocity=row["velocity"],
            roles=roles,
        ))
        tripwire_notes.append({
            "register": row["register"],
            "dynamic": row["dynamic"],
            "roles": sorted(roles),
            "result": score,
            "ref": reference,
            "render": rendered,
        })
        score_rows.append({
            "label": trial["label"],
            "vowel": row["vowel"],
            "register": row["register"],
            "dynamic": row["dynamic"],
            "midi": row["midi"],
            "composite": score["composite"],
            "features": score["features"],
            "normalized": score["normalized"],
            "weights": score["weights"],
        })
    vowel_gate = vowel_classification_gate(rendered_formants, voice_class)
    source_fit = json.loads((fit_root / "SOURCE_VOWEL_FIT.json").read_text())
    construction = evaluate_construction(
        voice_class,
        construction_samples,
        params=source_fit["baseParams"],
        strict_evidence=True,
    )
    raw_tripwires = evaluate_tripwires(
        voice_class, tripwire_notes, weights=weights
    )
    coverage_contract = required_cells_by_bar(references, raw_tripwires["activeBars"])
    tripwires = {
        **raw_tripwires,
        "coverageContract": coverage_contract,
        **aggregate_by_cell(
            raw_tripwires,
            required_cells_by_bar=coverage_contract,
            family="sung",
        ),
    }
    composites = [
        row["composite"] for row in score_rows
        if row["composite"] is not None
    ]
    summary = {
        "instrument": instrument,
        "run": output_root.name,
        "rows": score_rows,
        "meanComposite": float(np.mean(composites)) if composites else None,
        "scoredRows": sum(row["composite"] is not None for row in score_rows),
        "rejectedRows": sum(row["composite"] is None for row in score_rows),
        "requiredVowelRegisterDynamicCells": len(required_cells),
        "construction": construction,
        "tripwires": tripwires,
        "vowelClassification": vowel_gate,
        "weights": weights,
        "controllability": {
            "path": str(audit_path),
            "objectiveHash": audit["objectiveHash"],
            "manifestHash": audit["manifestHash"],
            "clean": audit["clean"],
            "zeroWeighted": audit.get("zeroWeighted", []),
        },
        "legacyPrior": source_fit.get("legacyPrior"),
        "renderModes": {
            "scoring": "fit",
            "listening": "ship",
            "shipSeedBase": ship_seed_base,
        },
    }
    (output_root / "audition-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    (output_root / "baseline-scores.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )
    _write_html(
        output_root / f"listen-{instrument}-{output_root.name}.html",
        manifest,
        score_rows,
        voice_class,
    )
    return summary


def _write_html(
    path: Path,
    manifest: list[dict],
    scores: list[dict],
    voice_class: str,
) -> None:
    rows = []
    for trial, score in zip(manifest, scores):
        composite = (
            f"{score['composite']:.3f}" if score["composite"] is not None
            else "QC reject"
        )
        feature_text = (
            f"{score['features']['partials_db']:.2f} / {score['features']['log_mel_db']:.2f}"
            if score["features"] else html.escape(score.get("analysisError", ""))
        )
        rows.append(
            "<tr>"
            f"<td><b>/{html.escape(trial['vowel'])}/</b></td>"
            f"<td>{html.escape(trial['register'])} / {html.escape(trial['dynamic'])}</td>"
            f"<td><audio controls preload='none' src='file://{html.escape(trial['reference'])}'></audio></td>"
            f"<td><audio controls preload='none' src='file://{html.escape(trial['render'])}'></audio></td>"
            f"<td>{composite}</td>"
            f"<td>{feature_text}</td>"
            "</tr>"
        )
    path.write_text(
        f"<!doctype html><meta charset='utf-8'><title>SG2 {html.escape(voice_class)} audition</title>"
        "<style>body{font:15px system-ui;background:#141518;color:#eee;margin:2em}"
        "table{border-collapse:collapse;width:100%}td,th{padding:7px;border-bottom:1px solid #333}"
        "audio{width:240px;height:32px}</style>"
        f"<h1>SG2 {html.escape(voice_class)} — pooled source + per-vowel bodies</h1>"
        "<p>SHIP-MODE performance renders (fresh seeds). Scores are computed separately from deterministic FIT-MODE renders.</p>"
        "<table><tr><th>Vowel</th><th>Register</th><th>Reference</th><th>Render</th>"
        "<th>Composite</th><th>Partial / mel dB</th></tr>"
        + "".join(rows) + "</table>",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--controllability", type=Path, required=True)
    args = parser.parse_args()
    summary = build(
        args.references, args.fit_root, args.out, args.repo_root,
        args.controllability,
    )
    print(json.dumps({
        "meanComposite": summary["meanComposite"],
        "constructionPassed": summary["construction"]["passed"],
        "tripwirePassed": summary["tripwires"]["strictPassed"],
        "vowelClassification": {
            "passed": summary["vowelClassification"]["passed"],
            "passedRows": summary["vowelClassification"]["passedRows"],
            "requiredRows": summary["vowelClassification"]["requiredRows"],
        },
    }, indent=2))


if __name__ == "__main__":
    main()
