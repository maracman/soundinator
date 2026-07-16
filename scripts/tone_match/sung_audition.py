#!/usr/bin/env python3
"""Render and score the first per-vowel sung baseline."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import subprocess

import numpy as np

from scripts.tone_match.score import (
    compare_features,
    extract_features,
    weights_for_instrument,
)
from scripts.tone_match.sung_features import vowel_classification_gate


ZERO_WEIGHT_WATCHES = {
    "decay_log_ratio",
    "inharmonicity_log_ratio",
    "vibrato",
    "vibrato_onset_delay_ms",
    "vibrato_ramp_ms",
    "vibrato_rate_drift",
    "body_am_db",
    "noise_lead_ms",
    "onset_scoop_cents",
    "onset_scoop_settle_ms",
    "onset_wander_cents",
    "onset_lockin_periods",
}


def build(references_path: Path, fit_root: Path, output_root: Path, repo_root: Path) -> dict:
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
    selected = [
        row for row in references
        if row.get("technique") == "straight"
        and "spectral" in row.get("roles", [])
    ]
    selected.sort(key=lambda row: ("aeiou".index(row["vowel"]),
                                   ("low", "mid", "high").index(row["register"])))
    if len(selected) != 15:
        raise ValueError(f"expected 15 straight vowel/register rows, found {len(selected)}")

    output_root.mkdir(parents=True, exist_ok=True)
    renders = output_root / "renders"
    renders.mkdir(exist_ok=True)
    jobs = []
    manifest = []
    for index, row in enumerate(selected):
        params = json.loads((fit_root / f"initial-{row['vowel']}.json").read_text())
        params["vibratoProb"] = 0.0
        out = renders / f"{index:02d}-{row['register']}_{row['vowel']}.wav"
        jobs.append({
            "params": params,
            "midi": row["midi"],
            "velocity": row["velocity"],
            "durationSec": row["durationSec"],
            "sampleRate": row.get("sampleRate", 44100),
            "out": str(out),
        })
        manifest.append({
            "label": f"{voice_class} /{row['vowel']}/ {row['register']} MIDI {row['midi']}",
            "vowel": row["vowel"],
            "register": row["register"],
            "reference": row["path"],
            "render": str(out),
            "sourceFile": row["sourceFile"],
        })
    jobs_path = output_root / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=repo_root, check=True,
    )

    weights = weights_for_instrument(voice_class)
    for feature in ZERO_WEIGHT_WATCHES:
        weights[feature] = 0.0
    score_rows = []
    rendered_formants: dict[str, dict[str, tuple[float, float]]] = {}
    for row, trial in zip(selected, manifest):
        try:
            reference = extract_features(
                trial["reference"], expected_f0_hz=row["expectedF0Hz"]
            )
            rendered = extract_features(
                trial["render"], active_duration_s=row["durationSec"],
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
        if len(formants) >= 2:
            rendered_formants.setdefault(row["vowel"], {})[row["register"]] = (
                float(formants[0]), float(formants[1])
            )
        reference_attack = [
            float(value.get("t90", 0) if isinstance(value, dict) else value)
            for value in reference.note.band_t90.values()
        ]
        attack_tolerance_ms = max(
            20.0,
            .30 * (float(np.mean(reference_attack)) * 1000
                   if reference_attack else 0.0),
        )
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
            "gates": {
                "partials": score["features"]["partials_db"] <= 3.0,
                "mel": score["features"]["log_mel_db"] <= 4.0,
                "attack": score["features"]["attack_ms"] <= attack_tolerance_ms,
            },
        })
    vowel_gate = vowel_classification_gate(rendered_formants, voice_class)
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
        "gateCounts": {
            key: {
                "pass": sum(row["gates"].get(key, False) for row in score_rows),
                "total": sum(key in row["gates"] for row in score_rows),
            }
            for key in ("partials", "mel", "attack")
        },
        "vowelClassification": vowel_gate,
        "weights": weights,
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
            f"<td>{html.escape(trial['register'])}</td>"
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
        "<p>Interim baseline. Straight-tone rows are grouped by vowel and register; production gates remain active.</p>"
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
    args = parser.parse_args()
    summary = build(args.references, args.fit_root, args.out, args.repo_root)
    print(json.dumps({
        "meanComposite": summary["meanComposite"],
        "gateCounts": summary["gateCounts"],
        "vowelClassification": {
            "passed": summary["vowelClassification"]["passed"],
            "passedRows": summary["vowelClassification"]["passedRows"],
            "requiredRows": summary["vowelClassification"]["requiredRows"],
        },
    }, indent=2))


if __name__ == "__main__":
    main()
