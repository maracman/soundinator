#!/usr/bin/env python3
"""T-058-style uncontaminated emitted-body audit for bowed source work."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import numpy as np

from .bowed_source_tables import body_gain_db
from .score import extract_features


# A paired transfer is a division, so both arms need substantially more
# headroom than the ordinary -66 dB partial-distance floor. Below -36 dB
# (1/64 of the strongest analysed mode) a bowed comb notch can be dominated by
# leakage from a neighbouring retained oscillator; that ratio no longer
# identifies the emitted body's gain.
PAIR_RATIO_FLOOR_DB = -36.0


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _audit_params(params: dict[str, Any], *, bypass: bool) -> dict[str, Any]:
    """Hold the source fixed and neutralise every downstream confound."""
    return {
        **params,
        "bodyBands": [] if bypass else params.get("bodyBands", []),
        "partialTransfer": 0.0,
        "attackNoiseLevel": 0.0,
        "bowNoiseLevel": 0.0,
        "bowScratchLevel": 0.0,
        "vibratoProb": 0.0,
        "excitationHuman": 0.0,
        "spectralCullThreshold": .0001,
        "reverbWet": 0.0,
    }


def render_pairs(references_path: Path, params_path: Path, output: Path,
                 repo_root: Path) -> dict[str, Any]:
    references = [row for row in json.loads(references_path.read_text())
                  if "spectral" in row.get("roles", []) and
                  Path(str(row.get("sourceFile", ""))).suffix.lower() in {".aif", ".aiff"}]
    params = json.loads(params_path.read_text())
    output.mkdir(parents=True, exist_ok=True)
    jobs, rows = [], []
    for index, reference in enumerate(references):
        stem = f"{index:02d}-{reference['register']}-{reference['dynamic']}"
        body_path = output / f"{stem}-body.wav"
        bypass_path = output / f"{stem}-bypass.wav"
        common = {
            "midi": reference["midi"], "velocity": reference["velocity"],
            "durationSec": reference["durationSec"], "sampleRate": 44100,
        }
        jobs.extend([
            {**common, "params": _audit_params(params, bypass=False),
             "out": str(body_path)},
            {**common, "params": _audit_params(params, bypass=True),
             "out": str(bypass_path)},
        ])
        rows.append({
            "register": reference["register"], "dynamic": reference["dynamic"],
            "string": reference["string"], "midi": reference["midi"],
            "expectedF0Hz": reference.get("expectedF0Hz") or reference["detectedF0"],
            "renderedF0Hz": 440.0 * 2 ** ((float(reference["midi"]) - 69) / 12),
            "durationSec": reference["durationSec"],
            "bodyRender": str(body_path), "bypassRender": str(bypass_path),
            "sourceFile": reference["sourceFile"],
        })
    jobs_path = output / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
                   cwd=repo_root, check=True,
                   env={**os.environ, "PYTHON": sys.executable})
    manifest = {
        "schema": "sg2-bowed-body-audit-v1", "instrument": "cello",
        "method": "T-058 paired body-on/body-bypass with exact source fixed",
        "referencesSha256": _sha(references_path), "paramsSha256": _sha(params_path),
        "neutralized": ["partialTransfer", "attackNoiseLevel", "bowNoiseLevel",
                        "bowScratchLevel", "vibratoProb", "excitationHuman", "reverbWet"],
        "rows": rows,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def assess(manifest_path: Path, params_path: Path, output: Path) -> dict[str, Any]:
    manifest = json.loads(manifest_path.read_text())
    params = json.loads(params_path.read_text())
    profiles_path = Path(__file__).resolve().parents[2] / "web/static/measured_profiles.json"
    profile = json.loads(profiles_path.read_text())["cello"]
    bands = params.get("bodyBands") or []
    amount = float(params.get("spectralResonanceAmount", 1.0))
    lowest = profile.get("resonancesFit", {}).get("lowestF0Hz")
    rows = []
    for source in manifest["rows"]:
        # These files are synthesised from MIDI, not resampled to the source
        # recording's measured (and sometimes substantially detuned) f0.
        # Analysing the high-register E5 render at the corpus's 649.157 Hz
        # instead of equal-tempered 659.255 Hz displaced every harmonic bin
        # and manufactured the former high/ff transfer failure.
        f0 = float(source.get("renderedF0Hz") or
                   440.0 * 2 ** ((float(source["midi"]) - 69) / 12))
        body = extract_features(
            source["bodyRender"], active_duration_s=source["durationSec"],
            expected_f0_hz=f0, trust_expected_f0=True)
        bypass = extract_features(
            source["bypassRender"], active_duration_s=source["durationSec"],
            expected_f0_hz=f0, trust_expected_f0=True)
        count = min(len(body.partial_db), len(bypass.partial_db),
                    len(bypass.note.partial_freqs))
        frequencies = np.asarray(bypass.note.partial_freqs[:count], float)
        harmonic_ranks = np.arange(1, count + 1)
        # partialIsAudible() guarantees ranks 1..8 in both render arms.  Above
        # that boundary, body gain can itself change oscillator admission, so
        # an FFT peak in both files is not proof that the same source mode was
        # emitted; it may be leakage from a neighbouring retained oscillator.
        # T-058 is a source-cancellation audit and therefore consumes only the
        # jointly guaranteed modes, never cull-sensitive analysed peaks.
        valid = (np.isfinite(body.partial_db[:count]) &
                 np.isfinite(bypass.partial_db[:count]) &
                 np.isfinite(frequencies) & (frequencies > 0) &
                 (harmonic_ranks <= 8) &
                 (np.minimum(body.partial_db[:count], bypass.partial_db[:count]) >
                  PAIR_RATIO_FLOOR_DB))
        observed = body.partial_db[:count][valid] - bypass.partial_db[:count][valid]
        expected = body_gain_db(
            bands, frequencies[valid], amount,
            fundamental_hz=f0, lowest_f0_hz=lowest)
        observed -= float(np.median(observed))
        expected -= float(np.median(expected))
        error = np.abs(observed - expected)
        correlation = (float(np.corrcoef(observed, expected)[0, 1])
                       if len(observed) >= 4 and np.std(observed) > 1e-8 and
                       np.std(expected) > 1e-8 else 0.0)
        median_error = float(np.median(error)) if len(error) else float("inf")
        passed = bool(len(error) >= 4 and median_error <= 1.0 and correlation >= .9)
        rows.append({
            **{key: source[key] for key in ("register", "dynamic", "string", "midi")},
            "analysisF0Hz": round(f0, 6),
            "commonHarmonics": int(len(error)),
            "guaranteedEmittedHarmonicsMax": 8,
            "pairRatioFloorDb": PAIR_RATIO_FLOOR_DB,
            "excludedCullSensitiveHarmonics": int(np.count_nonzero(
                (harmonic_ranks > 8) &
                (np.maximum(body.partial_db[:count], bypass.partial_db[:count]) > -66))),
            "excludedLowConfidenceRatios": int(np.count_nonzero(
                (harmonic_ranks <= 8) &
                (np.minimum(body.partial_db[:count], bypass.partial_db[:count]) <=
                 PAIR_RATIO_FLOOR_DB))),
            "medianTransferErrorDb": round(median_error, 6),
            "p95TransferErrorDb": round(float(np.percentile(error, 95)), 6),
            "shapeCorrelation": round(correlation, 6), "passed": passed,
            "bodyRenderSha256": _sha(Path(source["bodyRender"])),
            "bypassRenderSha256": _sha(Path(source["bypassRender"])),
        })
    result = {
        "schema": "sg2-bowed-body-audit-v1", "instrument": "cello",
        "status": "pass" if all(row["passed"] for row in rows) else "fail",
        "method": manifest["method"], "limits": {
            "medianTransferErrorDbMax": 1.0, "shapeCorrelationMin": .9,
            "commonHarmonicsMin": 4},
        "harmonicAdmissionContract": (
            "renderer partialIsAudible guarantees modes 1-8 in both arms; "
            "higher analysed peaks are excluded as cull-sensitive; paired "
            "ratios additionally require both arms above -36 dB so a comb "
            "notch cannot turn neighbouring-mode leakage into body evidence"),
        "sourceCancellation": "paired body-on/body-bypass FIT renders",
        "rows": rows,
    }
    result["auditSha256"] = hashlib.sha256(json.dumps(
        result, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    render = sub.add_parser("render")
    render.add_argument("--references", type=Path, required=True)
    render.add_argument("--params", type=Path, required=True)
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--repo-root", type=Path, default=Path.cwd())
    check = sub.add_parser("assess")
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--params", type=Path, required=True)
    check.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = (render_pairs(args.references, args.params, args.output, args.repo_root)
              if args.command == "render" else
              assess(args.manifest, args.params, args.output))
    print(json.dumps({"status": result.get("status", "rendered"),
                      "rows": len(result["rows"]),
                      "output": str(args.output)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
