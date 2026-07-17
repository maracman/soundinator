#!/usr/bin/env python3
"""Fit pinned blown register x dynamic source rows from paired references.

This is the blown-family counterpart to A-VOICE-05.  It does not copy the
reference LTAS into the body: each cell adjusts the already deconvolved,
instrument-owned register source by the measured reference/render harmonic
residual.  The fixed-Hz body and existing excitation/dynamic laws remain in
their canonical renderer stages.  Duplicate spectral takes are pooled by
median in dB and every source/render file is sealed into the evidence record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from scripts.tone_match.score import extract_features


ROOT = Path(__file__).resolve().parents[2]
PROFILE_PATH = ROOT / "web" / "static" / "measured_profiles.json"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _profile_partials(profile: dict[str, Any], f0: float) -> np.ndarray:
    rows = sorted((row for row in profile.get("partialsByRegister", [])
                   if row.get("partials") and row.get("f0")),
                  key=lambda row: row["f0"])
    if not rows:
        return np.asarray([row["amp"] for row in profile["partials"]], float)
    if f0 <= rows[0]["f0"]:
        chosen = rows[0]["partials"]
        return np.asarray([row["amp"] for row in chosen], float)
    if f0 >= rows[-1]["f0"]:
        chosen = rows[-1]["partials"]
        return np.asarray([row["amp"] for row in chosen], float)
    hi = next(index for index, row in enumerate(rows) if row["f0"] >= f0)
    left, right = rows[hi - 1], rows[hi]
    amount = math.log(f0 / left["f0"]) / math.log(right["f0"] / left["f0"])
    a = np.asarray([row["amp"] for row in left["partials"]], float)
    b = np.asarray([row["amp"] for row in right["partials"]], float)
    size = max(len(a), len(b))
    a = np.pad(a, (0, size - len(a)))
    b = np.pad(b, (0, size - len(b)))
    return a + (b - a) * amount


def fit_instrument(instrument: str, references_path: Path,
                   jobs_path: Path) -> dict[str, Any]:
    profiles = json.loads(PROFILE_PATH.read_text())
    profile = profiles[instrument]
    references = json.loads(references_path.read_text())
    jobs = json.loads(jobs_path.read_text())
    if not references or len(jobs) % len(references):
        raise ValueError(
            f"{instrument}: {len(jobs)} jobs is not whole variants of "
            f"{len(references)} references")
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for job_index, job in enumerate(jobs):
        reference = references[job_index % len(references)]
        if "spectral" not in reference.get("roles", []):
            continue
        render_path = Path(job["out"])
        reference_path = Path(reference["path"])
        if not render_path.exists() or not reference_path.exists():
            raise FileNotFoundError(render_path if not render_path.exists() else reference_path)
        ref = extract_features(
            reference_path, n_partials=32,
            expected_f0_hz=reference.get("expectedF0Hz"), trust_expected_f0=True)
        render = extract_features(
            render_path, n_partials=32, active_duration_s=reference["durationSec"],
            expected_f0_hz=reference.get("expectedF0Hz"), trust_expected_f0=True)
        grouped.setdefault((reference["register"], reference["dynamic"]), []).append({
            "reference": reference,
            "job": job,
            "deltaDb": np.asarray(ref.partial_db) - np.asarray(render.partial_db),
            "referenceSha256": _sha(reference_path),
            "renderSha256": _sha(render_path),
        })
    rows = []
    for (register, dynamic), evidence in sorted(grouped.items()):
        f0 = float(np.median([row["reference"]["expectedF0Hz"] for row in evidence]))
        velocity = float(np.median([row["reference"]["velocity"] for row in evidence]))
        adjustment = np.nanmedian(np.asarray([row["deltaDb"] for row in evidence]), axis=0)
        base = _profile_partials(profile, f0)
        adjusted = base.copy()
        count = min(len(adjusted), len(adjustment))
        adjusted[:count] *= 10 ** (adjustment[:count] / 20)
        adjusted = np.maximum(adjusted, 0)
        peak = float(np.max(adjusted))
        if not np.isfinite(peak) or peak <= 0:
            raise ValueError(f"{instrument} {register}/{dynamic}: invalid source row")
        adjusted /= peak
        rows.append({
            "register": register,
            "dynamic": dynamic,
            "f0Hz": round(f0, 6),
            "velocity": round(velocity, 6),
            "partials": [round(float(value), 8) for value in adjusted],
            "nTakes": len(evidence),
            "medianAbsCorrectionDb": round(float(np.nanmedian(np.abs(adjustment))), 6),
            "provenance": [{
                "sourceFile": row["reference"].get("sourceFile"),
                "referenceSha256": row["referenceSha256"],
                "renderSha256": row["renderSha256"],
            } for row in evidence],
        })
    expected = {(register, dynamic) for register in ("low", "mid", "high")
                for dynamic in ("pp", "ff")}
    emitted = {(row["register"], row["dynamic"]) for row in rows}
    if emitted != expected:
        raise ValueError(f"{instrument}: missing cells {sorted(expected - emitted)}")
    params_path = Path(jobs[0]["paramsFile"])
    return {
        "instrument": instrument,
        "method": "paired-harmonic-residual-on-deconvolved-register-source",
        "paramsSha256": _sha(params_path),
        "referencesSha256": _sha(references_path),
        "rows": rows,
        "coverage": {"requiredCells": 6, "emittedCells": len(rows), "complete": True},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", action="append", required=True,
                        help="instrument=references.json=fit-jobs.json")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    tables = {}
    for spec in args.instrument:
        instrument, references, jobs = spec.split("=", 2)
        tables[instrument] = fit_instrument(
            instrument, Path(references), Path(jobs))
    payload = {
        "schemaVersion": 1,
        "handoff": "BLOWN-SUSTAIN-01",
        "status": "pinned-paired-evidence",
        "interpolationContract": "log-f0 x velocity; clamp outside measured hull",
        "firewall": "rows remain per instrument; no cross-instrument values",
        "instruments": tables,
    }
    payload["evidenceSha256"] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({
        "out": str(args.out), "evidenceSha256": payload["evidenceSha256"],
        "instruments": {key: value["coverage"] for key, value in tables.items()},
    }, indent=2))


if __name__ == "__main__":
    main()
