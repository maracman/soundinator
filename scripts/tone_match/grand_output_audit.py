#!/usr/bin/env python3
"""Render-level L16+L17+L18 SHIP audit for the grand-piano preset.

The audit deliberately compares PCM from the real browser renderer.  It does
not accept parameter presence as evidence that action noise, anomaly classes,
free-decay hold, or the fitted damper law are audible.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
from typing import Any

import numpy as np
import soundfile as sf

from .score import hold_decay_metrics


SCHEMA = "sg2-grand-output-audit-v1"
PRE_ROLL_SEC = 0.4
SAMPLE_RATE = 24000


def _unwrap(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload
    while isinstance(value.get("params"), dict):
        value = value["params"]
    return value


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _load_mono(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    return np.mean(samples, axis=1), int(sample_rate)


def _window(samples: np.ndarray, sample_rate: int,
            start: float, end: float) -> np.ndarray:
    lo = max(0, round(start * sample_rate))
    hi = min(len(samples), round(end * sample_rate))
    return samples[lo:hi]


def _rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.asarray(samples) ** 2) + 1e-20))


def _difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    size = min(len(a), len(b))
    return np.asarray(a[:size]) - np.asarray(b[:size])


def _release_attenuation_db(fitted: np.ndarray, free: np.ndarray,
                            sample_rate: int, note_off: float) -> float:
    fitted_rms = _rms(_window(fitted, sample_rate,
                              note_off + .08, note_off + .28))
    free_rms = _rms(_window(free, sample_rate,
                            note_off + .08, note_off + .28))
    return float(20 * math.log10(max(free_rms, 1e-12) /
                                 max(fitted_rms, 1e-12)))


def audit(params_path: Path, output_dir: Path, repo_root: Path) -> dict[str, Any]:
    params_path = params_path.resolve()
    params = _unwrap(json.loads(params_path.read_text()))
    output_dir.mkdir(parents=True, exist_ok=True)
    damper_rows = params.get("damperByRegister") or []
    # A missing table invokes the legacy note-off fallback, which is not the
    # L18 no-contact counterfactual.  Preserve the measured rows and source
    # lifetime while moving their physical undamped boundary below all piano
    # notes; damperByRegisterAt then returns its explicit natural-decay state.
    natural_release_rows = [
        {**row, "undampedAboveF0": 1.0} for row in damper_rows
    ]
    action_rows = params.get("preOnsetComponents") or []
    anomaly_rows = params.get("envelopeAnomalyClasses") or []

    base = dict(params)
    jobs: list[dict[str, Any]] = []

    def add(name: str, *, midi: int, velocity: float, duration: float,
            override: dict[str, Any] | None = None) -> None:
        selected = {**base, **(override or {})}
        jobs.append({
            "params": selected,
            "midi": midi,
            "velocity": velocity,
            "durationSec": duration,
            "sampleRate": SAMPLE_RATE,
            "preRollSec": PRE_ROLL_SEC,
            "out": str((output_dir / f"{name}.wav").resolve()),
        })

    add("full-hold", midi=60, velocity=.62, duration=3.0)
    add("action-neutral", midi=60, velocity=.62, duration=3.0,
        override={"pianoActionNoiseLevel": 0})
    add("anomaly-neutral", midi=60, velocity=.62, duration=3.0,
        override={"envelopeAnomalyLevel": 0})
    for dynamic, velocity in (("pp", .2), ("ff", .92)):
        add(f"release-{dynamic}-fitted", midi=60, velocity=velocity,
            duration=1.2)
        add(f"release-{dynamic}-free", midi=60, velocity=velocity,
            duration=1.2, override={"damperByRegister": natural_release_rows})
    for midi in (89, 90):
        add(f"boundary-{midi}-fitted", midi=midi, velocity=.62,
            duration=1.2)
        add(f"boundary-{midi}-free", midi=midi, velocity=.62,
            duration=1.2, override={"damperByRegister": natural_release_rows})

    jobs_path = output_dir / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    env = dict(os.environ)
    env["PATH"] = f"{(repo_root / '../../../.venv/bin').resolve()}:{env.get('PATH', '')}"
    subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path.resolve())],
        cwd=repo_root, env=env, check=True)

    audio: dict[str, np.ndarray] = {}
    rates: set[int] = set()
    hashes: dict[str, str] = {}
    for job in jobs:
        path = Path(job["out"])
        samples, rate = _load_mono(path)
        audio[path.stem] = samples
        rates.add(rate)
        hashes[path.stem] = hashlib.sha256(path.read_bytes()).hexdigest()
    if rates != {SAMPLE_RATE}:
        raise RuntimeError(f"unexpected sample rates: {sorted(rates)}")

    t0 = PRE_ROLL_SEC
    full = audio["full-hold"]
    action_diff = _difference(full, audio["action-neutral"])
    action_pre = _window(action_diff, SAMPLE_RATE, t0 - .30, t0 - .002)
    action_peak_index = int(np.argmax(np.abs(action_pre)))
    action_peak_time = t0 - .30 + action_peak_index / SAMPLE_RATE
    action_lead_ms = max(0.0, (t0 - action_peak_time) * 1000)
    action_diff_rms = _rms(action_pre)

    anomaly_diff = _difference(full, audio["anomaly-neutral"])
    anomaly_onset_rms = _rms(_window(
        anomaly_diff, SAMPLE_RATE, t0, t0 + .12))

    active_hold = _window(full, SAMPLE_RATE, t0, t0 + 3.0)
    hold = hold_decay_metrics(active_hold, SAMPLE_RATE) or {}

    note_off = PRE_ROLL_SEC + 1.2
    release: dict[str, float] = {}
    for name in ("pp", "ff"):
        release[name] = _release_attenuation_db(
            audio[f"release-{name}-fitted"],
            audio[f"release-{name}-free"], SAMPLE_RATE, note_off)
    boundary: dict[str, float] = {}
    for midi in (89, 90):
        boundary[str(midi)] = _release_attenuation_db(
            audio[f"boundary-{midi}-fitted"],
            audio[f"boundary-{midi}-free"], SAMPLE_RATE, note_off)

    gates = {
        "actionNoiseLead": bool(
            len(action_rows) >= 1 and params.get("pianoActionNoiseLevel", 0) > 0 and
            1 <= action_lead_ms <= 300 and action_diff_rms >= 1e-7 and
            hashes["full-hold"] != hashes["action-neutral"]),
        "anomalyClasses": bool(
            len(anomaly_rows) >= 1 and params.get("envelopeAnomalyLevel", 0) > 0 and
            anomaly_onset_rms >= 1e-7 and
            hashes["full-hold"] != hashes["anomaly-neutral"]),
        "freeDecayHold": bool(
            hold.get("slopeDbPerSecond", 0) <= -.30 and
            hold.get("plateauFraction", 1) < .50),
        "fittedDamperRelease": bool(
            len(damper_rows) == 23 and release["pp"] >= 3 and
            release["ff"] >= 3 and abs(release["pp"] - release["ff"]) >= .5 and
            boundary["89"] >= .5 and abs(boundary["90"]) <= .05),
    }
    report = {
        "schema": SCHEMA,
        "label": "pass19 L16+L17+L18 (PCM verified)",
        "paramsFile": str(params_path),
        "paramsHash": _canonical_hash(params),
        "outputDir": str(output_dir.resolve()),
        "render": {"sampleRate": SAMPLE_RATE, "preRollSec": PRE_ROLL_SEC,
                   "hashes": hashes},
        "evidence": {
            "damperCells": len(damper_rows),
            "actionComponents": len(action_rows),
            "anomalyClasses": len(anomaly_rows),
            "actionPeakLeadMs": round(action_lead_ms, 3),
            "actionPreOnsetDifferenceRms": action_diff_rms,
            "anomalyOnsetDifferenceRms": anomaly_onset_rms,
            "hold": hold,
            "damperReleaseAttenuationDb": release,
            "damperBoundaryAttenuationDb": boundary,
        },
        "gates": gates,
        "passed": all(gates.values()),
    }
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path("."))
    args = parser.parse_args()
    report = audit(args.params, args.output_dir, args.repo_root.resolve())
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
