#!/usr/bin/env python3
"""Output-side controllability audit for A-VOICE-05 sung source surfaces."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import numpy as np
import soundfile as sf

from scripts.tone_match.iterate import _renderer_contract_hash
from scripts.tone_match.score import compare_features, extract_features


TARGET_FEATURES = ("partials_db", "log_mel_db", "band_balance_db")
RESPONSE_THRESHOLD = 0.05
# The shared sustain-balance extractor removes 250 ms of onset and 100 ms of
# offset, then requires one full second. Shorter output audits silently turn
# band balance into a zero-valued not-applicable feature.
AUDIT_DURATION_SEC = 1.6
VOICE_KEYS = {
    "voice-bass": "bass",
    "voice-tenor": "tenor",
    "voice-mezzo": "mezzo",
    "voice-soprano": "soprano",
}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _pcm(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    return np.mean(samples, axis=1, dtype=np.float64), int(sample_rate)


def _relative_pcm_db(left: np.ndarray, right: np.ndarray) -> float:
    count = min(len(left), len(right))
    reference = max(
        math.sqrt(float(np.mean(left[:count] ** 2))),
        math.sqrt(float(np.mean(right[:count] ** 2))),
        1e-12,
    )
    difference = math.sqrt(float(np.mean((left[:count] - right[:count]) ** 2)))
    return 20 * math.log10(max(difference, 1e-12) / reference)


def summarize_responses(rows: list[dict[str, Any]]) -> dict[str, Any]:
    repeat_floor = {
        feature: max(
            (float(row["repeatNormalized"][feature]) for row in rows),
            default=0.0,
        )
        for feature in TARGET_FEATURES
    }
    maximum = {
        feature: max(
            (float(row["surfaceVsFallbackNormalized"][feature]) for row in rows),
            default=0.0,
        )
        for feature in TARGET_FEATURES
    }
    responders = {
        feature: maximum[feature] >= max(
            RESPONSE_THRESHOLD, repeat_floor[feature] + RESPONSE_THRESHOLD,
        )
        for feature in TARGET_FEATURES
    }
    return {
        "repeatFloorNormalized": repeat_floor,
        "maximumSurfaceResponseNormalized": maximum,
        "responsiveFeatures": responders,
        "passed": bool(rows) and all(responders.values()) and all(
            bool(row["pcmDistinct"]) for row in rows
        ),
    }


def audit(repo_root: Path, instrument: str, best_path: Path,
          source_path: Path, run_root: Path,
          render_script: Path | None = None) -> dict[str, Any]:
    if instrument not in VOICE_KEYS:
        raise ValueError(f"unsupported voice {instrument!r}")
    best = json.loads(best_path.read_text())
    if best.get("instrument") != instrument:
        raise ValueError(
            f"{best_path} belongs to {best.get('instrument')!r}, not {instrument!r}"
        )
    handoff = json.loads(source_path.read_text())
    if handoff.get("syntheticRoundTrip", {}).get("passed") is not True:
        raise ValueError("refusing source surface without passing synthetic round trip")
    if "never rectangular extrapolation" not in handoff.get(
            "interpolationContract", ""):
        raise ValueError("source surface lacks the joint measured-hull contract")
    if "suppress generic spectralDynamicAmount" not in handoff.get(
            "dynamicComposition", ""):
        raise ValueError("source surface lacks explicit dynamic-composition semantics")
    table = handoff["voices"][VOICE_KEYS[instrument]]
    if table.get("coverage", {}).get("complete") is not True:
        raise ValueError(f"refusing incomplete source surface for {instrument}")
    surface = {
        "schemaVersion": handoff.get("schemaVersion"),
        "handoff": handoff.get("handoff"),
        "evidenceSha256": handoff.get("evidenceSha256"),
        "sourceIdentity": table.get("sourceIdentity"),
        "interpolation": handoff.get("interpolationContract"),
        "dynamicComposition": handoff.get("dynamicComposition"),
        "rows": table["rows"],
    }
    base = dict(best["paramsByVowel"]["a"])
    base.update({
        "seed": 80505,
        "excitationHuman": 0,
        "envelopeProb": 0,
        "vibratoProb": 0,
        "reverbWet": 0,
    })
    render_root = run_root / "renders"
    render_root.mkdir(parents=True, exist_ok=True)
    jobs = []
    cells = []
    for index, row in enumerate(surface["rows"]):
        cell = f"{row['register']}-{row['dynamic']}"
        midi = 69 + 12 * math.log2(float(row["f0Hz"]) / 440)
        common = {
            "midi": midi,
            "velocity": float(row["velocity"]),
            "durationSec": AUDIT_DURATION_SEC,
            "sampleRate": 24000,
        }
        for mode, source_surface in (
            ("active", surface),
            ("active-repeat", surface),
            ("absent", {"rows": []}),
        ):
            output = render_root / f"{index:02d}-{cell}-{mode}.wav"
            jobs.append({
                "params": {
                    **base,
                    "spectralPartialsByRegisterDynamic": source_surface,
                },
                **common,
                "out": str(output),
            })
        cells.append({**common, "cell": cell, "expectedF0Hz": row["f0Hz"]})
    jobs_path = run_root / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    render_script = render_script or repo_root / "scripts/render_note.mjs"
    subprocess.run(
        ["node", str(render_script), "--batch", str(jobs_path)],
        cwd=repo_root, check=True, env={**os.environ, "PYTHON": sys.executable},
    )

    rows = []
    for index, cell in enumerate(cells):
        prefix = render_root / f"{index:02d}-{cell['cell']}"
        paths = {
            mode: Path(f"{prefix}-{mode}.wav")
            for mode in ("active", "active-repeat", "absent")
        }
        features = {
            mode: extract_features(
                path, active_duration_s=cell["durationSec"],
                expected_f0_hz=cell["expectedF0Hz"],
            )
            for mode, path in paths.items()
        }
        surface_response = compare_features(
            features["active"], features["absent"],
            {feature: 1.0 for feature in TARGET_FEATURES},
        )["normalized"]
        repeat_response = compare_features(
            features["active"], features["active-repeat"],
            {feature: 1.0 for feature in TARGET_FEATURES},
        )["normalized"]
        active_pcm, active_rate = _pcm(paths["active"])
        absent_pcm, absent_rate = _pcm(paths["absent"])
        if active_rate != absent_rate:
            raise ValueError("source audit renders have inconsistent sample rates")
        pcm_difference = _relative_pcm_db(active_pcm, absent_pcm)
        rows.append({
            **cell,
            "surfaceVsFallbackNormalized": {
                feature: float(surface_response[feature])
                for feature in TARGET_FEATURES
            },
            "repeatNormalized": {
                feature: float(repeat_response[feature])
                for feature in TARGET_FEATURES
            },
            "surfaceVsFallbackRelativePcmDb": round(pcm_difference, 4),
            "pcmDistinct": pcm_difference >= -60,
        })
    summary = summarize_responses(rows)
    payload = {
        "schemaVersion": 1,
        "handoff": "A-VOICE-05",
        "instrument": instrument,
        "status": "clean" if summary["passed"] else "not-clean",
        "sourceIdentity": table.get("sourceIdentity"),
        "consumer": "spectralPartialsByRegisterDynamic",
        "consumerPresent": "sourcePartialsAt" in (
            repo_root / "web/static/synth.js"
        ).read_text(),
        "sourceEvidenceSha256": handoff.get("evidenceSha256"),
        "sourceCalibrationSha256": _sha256(source_path),
        "voiceBestSha256": _sha256(best_path),
        "rendererContractHash": _renderer_contract_hash(repo_root),
        "rows": rows,
        **summary,
    }
    if not payload["consumerPresent"]:
        payload["status"] = "blocked-consumer-absent"
        payload["passed"] = False
    payload["auditSha256"] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    run_root.mkdir(parents=True, exist_ok=True)
    (run_root / "AUDIT.json").write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--instrument", choices=sorted(VOICE_KEYS), required=True)
    parser.add_argument("--best", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--render-script", type=Path)
    args = parser.parse_args()
    result = audit(
        args.repo_root, args.instrument, args.best, args.source, args.run_root,
        render_script=args.render_script,
    )
    print(json.dumps({
        "instrument": result["instrument"],
        "status": result["status"],
        "responsiveFeatures": result["responsiveFeatures"],
        "auditSha256": result["auditSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
