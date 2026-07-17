#!/usr/bin/env python3
"""Verify T-033 nylon course identity in real rendered PCM."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
from typing import Any

import numpy as np
import soundfile as sf


COURSES = ("string6", "string3", "string1")


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload
    while isinstance(value.get("params"), dict):
        value = value["params"]
    return value


def _spectrum(path: Path) -> tuple[np.ndarray, int]:
    values, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    mono = np.mean(values, axis=1)
    start = round(.02 * sample_rate)
    stop = min(len(mono), start + round(.45 * sample_rate))
    segment = mono[start:stop]
    windowed = segment * np.hanning(len(segment))
    size = max(32768, 2 ** int(np.ceil(np.log2(max(2048, len(segment))))))
    spectrum = np.abs(np.fft.rfft(windowed, n=size))
    freqs = np.fft.rfftfreq(size, 1 / sample_rate)
    inside = (freqs >= 100) & (freqs <= min(12000, sample_rate * .45))
    db = 20 * np.log10(np.maximum(spectrum[inside], 1e-12))
    return db - np.max(db), sample_rate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    params_path = args.params.resolve()
    params = _unwrap(json.loads(params_path.read_text()))
    measured = json.loads((repo_root / "web/static/measured_profiles.json").read_text())
    course_rows = measured["guitar"].get("partialsByString") or {}
    args.output_dir.mkdir(parents=True, exist_ok=True)

    jobs = []
    for course in COURSES:
        jobs.append({
            "params": {**params, "stringSelect": course},
            "midi": 64,
            "velocity": .62,
            "durationSec": .9,
            "sampleRate": 24000,
            "out": str((args.output_dir / f"{course}.wav").resolve()),
        })
    jobs_path = args.output_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    env = dict(os.environ)
    env["PATH"] = f"{(repo_root / '../../../.venv/bin').resolve()}:{env.get('PATH', '')}"
    subprocess.run(["node", "scripts/render_note.mjs", "--batch",
                    str(jobs_path.resolve())], cwd=repo_root, env=env, check=True)

    hashes = {}
    spectra = {}
    rates = set()
    for course in COURSES:
        path = args.output_dir / f"{course}.wav"
        hashes[course] = hashlib.sha256(path.read_bytes()).hexdigest()
        spectra[course], rate = _spectrum(path)
        rates.add(rate)
    pairwise = {}
    for left_index, left in enumerate(COURSES):
        for right in COURSES[left_index + 1:]:
            pairwise[f"{left}:{right}"] = float(np.median(
                np.abs(spectra[left] - spectra[right])))
    gates = {
        "measuredThreeCourseTables": set(course_rows) == set(COURSES),
        "noPooledMeansShadow": "spectralPartialMeans" not in params,
        "distinctPcmHashes": len(set(hashes.values())) == len(COURSES),
        "distinctNormalisedSpectra": min(pairwise.values()) >= .5,
    }
    report = {
        "schema": "sg2-nylon-course-output-audit-v1",
        "paramsFile": str(params_path),
        "samePitchMidi": 64,
        "sampleRates": sorted(rates),
        "hashes": hashes,
        "medianAbsoluteSpectralDifferenceDb": pairwise,
        "courseEvidence": {
            course: {"rows": len(course_rows[course]),
                     "anchorF0Hz": course_rows[course][0]["f0"],
                     "partialB": course_rows[course][0]["partialB"]}
            for course in COURSES
        },
        "gates": gates,
        "passed": all(gates.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
