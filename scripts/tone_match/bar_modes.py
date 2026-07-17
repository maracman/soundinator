#!/usr/bin/env python3
"""Measure non-harmonic bar modes without routing them through string B.

Glockenspiel is the first SG2 ``bar`` campaign.  This extractor follows the
verified free-bar table and measures per-mode frequency offsets, levels and
decays.  It deliberately has no stiffness-B input or output.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal
import soundfile as sf


SCHEMA = "sg2-bar-mode-fit-v1"
VALIDATION_SCHEMA = "sg2-bar-mode-validation-v1"
BAR_RATIOS = (1.0, 2.756, 5.404, 8.933, 13.344, 18.638)
MIN_OFFSET_CENTS = -386.0
MAX_OFFSET_CENTS = 35.0


def _load(path: Path) -> tuple[np.ndarray, int]:
    values, sample_rate = sf.read(path, always_2d=True, dtype="float64")
    return np.mean(values, axis=1), int(sample_rate)


def _onset(samples: np.ndarray, sample_rate: int) -> int:
    frame = max(32, round(.004 * sample_rate))
    smooth = np.sqrt(signal.convolve(samples * samples, np.ones(frame) / frame,
                                     mode="same") + 1e-20)
    peak = float(np.max(smooth))
    active = np.flatnonzero(smooth >= peak * 10 ** (-35 / 20))
    return int(active[0]) if active.size else int(np.argmax(smooth))


def _quadratic_peak(freqs: np.ndarray, db: np.ndarray, index: int) -> float:
    if index <= 0 or index >= len(db) - 1:
        return float(freqs[index])
    left, centre, right = db[index - 1:index + 2]
    denominator = left - 2 * centre + right
    delta = 0.0 if abs(denominator) < 1e-12 else .5 * (left - right) / denominator
    return float(freqs[index] + np.clip(delta, -.5, .5) *
                 (freqs[index + 1] - freqs[index]))


def _mode_decay(samples: np.ndarray, sample_rate: int, onset: int,
                frequency: float) -> tuple[float | None, float | None]:
    low = max(20.0, frequency * .985) / (sample_rate / 2)
    high = min(sample_rate * .49, frequency * 1.015) / (sample_rate / 2)
    if not 0 < low < high < 1:
        return None, None
    filtered = signal.sosfiltfilt(
        signal.butter(3, [low, high], btype="band", output="sos"), samples)
    analytic = np.abs(signal.hilbert(filtered))
    frame = max(16, round(.008 * sample_rate))
    envelope = np.sqrt(signal.convolve(analytic * analytic,
                                       np.ones(frame) / frame, mode="same") + 1e-20)
    peak_index = onset + int(np.argmax(envelope[onset:onset + max(1, round(.12 * sample_rate))]))
    peak = max(float(envelope[peak_index]), 1e-12)
    db = 20 * np.log10(np.maximum(envelope / peak, 1e-8))
    start = peak_index + round(.008 * sample_rate)
    stop = min(len(samples), peak_index + round(2.5 * sample_rate))
    indices = np.arange(start, stop)
    audible = indices[(db[indices] <= -3) & (db[indices] >= -38)]
    if audible.size < max(20, round(.035 * sample_rate)):
        return None, None
    # Use the first continuous audible fall.  Late room/noise-floor rises are
    # excluded rather than being reinterpreted as a second bar decay.
    gaps = np.flatnonzero(np.diff(audible) > 1)
    if gaps.size:
        audible = audible[:gaps[0] + 1]
    if audible.size < max(20, round(.035 * sample_rate)):
        return None, None
    times = (audible - peak_index) / sample_rate
    slope = float(np.polyfit(times, db[audible], 1)[0])
    if slope >= -1:
        return None, None
    rate = -slope
    return 60.0 / rate, rate


def analyse_bar(samples: np.ndarray, sample_rate: int, expected_f0_hz: float,
                max_modes: int = 6) -> dict[str, Any]:
    onset = _onset(samples, sample_rate)
    start = onset
    stop = min(len(samples), onset + round(.35 * sample_rate))
    segment = samples[start:stop]
    nfft = max(16384, 2 ** int(math.ceil(math.log2(max(2048, len(segment))))))
    windowed = segment * signal.windows.hann(len(segment), sym=False)
    spectrum = np.abs(np.fft.rfft(windowed, n=nfft))
    freqs = np.fft.rfftfreq(nfft, 1 / sample_rate)
    db = 20 * np.log10(np.maximum(spectrum, 1e-12))
    modes = []
    for index, ratio in enumerate(BAR_RATIOS[:max_modes], start=1):
        nominal = expected_f0_hz * ratio
        if nominal >= sample_rate * .47:
            break
        lo_cents = -50 if index == 1 else MIN_OFFSET_CENTS
        hi_cents = 50 if index == 1 else MAX_OFFSET_CENTS
        low = nominal * 2 ** (lo_cents / 1200)
        high = nominal * 2 ** (hi_cents / 1200)
        candidates = np.flatnonzero((freqs >= low) & (freqs <= high))
        if candidates.size < 3:
            continue
        peak_bin = int(candidates[np.argmax(db[candidates])])
        frequency = _quadratic_peak(freqs, db, peak_bin)
        offset = 1200 * math.log2(frequency / nominal)
        t60, rate = _mode_decay(samples, sample_rate, onset, frequency)
        modes.append({
            "mode": index,
            "baseRatio": ratio,
            "frequencyHz": round(frequency, 4),
            "ratio": round(frequency / expected_f0_hz, 7),
            "offsetCents": round(offset, 3),
            "levelDbRaw": round(float(db[peak_bin]), 3),
            "t60Seconds": round(t60, 4) if t60 is not None else None,
            "decayDbPerSecond": round(rate, 3) if rate is not None else None,
        })
    if modes:
        fundamental = modes[0]["frequencyHz"]
        for row in modes:
            row["ratio"] = round(row["frequencyHz"] / fundamental, 7)
            row["offsetCents"] = round(
                1200 * math.log2(row["ratio"] / row["baseRatio"]), 3)
        reference = max(row["levelDbRaw"] for row in modes)
        for row in modes:
            row["levelDb"] = round(row.pop("levelDbRaw") - reference, 3)
    return {"expectedF0Hz": expected_f0_hz,
            "onsetSec": round(onset / sample_rate, 6), "modes": modes}


def _synthetic(f0: float, sample_rate: int = 48000) -> np.ndarray:
    duration = 3.0
    onset = .08
    times = np.arange(round(duration * sample_rate)) / sample_rate
    active = np.maximum(0, times - onset)
    offsets = (0, -120, -240)
    t60s = (3.0, .35, .18)
    levels = (1.0, .32, .18)
    values = np.zeros_like(times)
    for ratio, offset, t60, level in zip(BAR_RATIOS, offsets, t60s, levels):
        frequency = f0 * ratio * 2 ** (offset / 1200)
        envelope = 10 ** (-60 * active / (20 * t60)) * (times >= onset)
        values += level * envelope * np.sin(2 * np.pi * frequency * active)
    return values


def validate(output: Path) -> dict[str, Any]:
    recovered = []
    checks = []
    for f0 in (392.0, 783.9909):
        fit = analyse_bar(_synthetic(f0), 48000, f0, max_modes=3)
        recovered.append(fit)
        offsets = [row["offsetCents"] for row in fit["modes"]]
        t60s = [row["t60Seconds"] for row in fit["modes"]]
        checks.append(len(offsets) == 3 and
                      max(abs(a - b) for a, b in zip(offsets, (0, -120, -240))) <= 20 and
                      all(value is not None for value in t60s) and
                      t60s[0] / max(t60s[1], 1e-6) >= 5)
    result = {"schema": VALIDATION_SCHEMA,
              "status": "pass" if all(checks) else "fail",
              "injectedOffsetsCents": [0, -120, -240],
              "injectedT60Seconds": [3.0, .35, .18],
              "recovered": recovered, "checks": checks}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    if result["status"] != "pass":
        raise RuntimeError("bar-mode synthetic round trip failed")
    return result


def extract(references: Path, validation: Path, output: Path) -> dict[str, Any]:
    gate = json.loads(validation.read_text())
    if gate.get("schema") != VALIDATION_SCHEMA or gate.get("status") != "pass":
        raise RuntimeError("real bar extraction requires a passing synthetic gate")
    rows = []
    manifest = json.loads(references.read_text())
    reference_rows = manifest.get("references", []) if isinstance(manifest, dict) else manifest
    for ref in reference_rows:
        expected = float(ref.get("expectedF0Hz") or
                         440 * 2 ** ((float(ref["midi"]) - 69) / 12))
        samples, sample_rate = _load(Path(ref["path"]))
        fit = analyse_bar(samples, sample_rate, expected)
        rows.append({"sourceFile": ref.get("sourceFile", Path(ref["path"]).name),
                     "midi": ref["midi"], "register": ref.get("register"),
                     "writtenMidi": ref.get("writtenMidi"),
                     "writtenNote": ref.get("writtenNote"),
                     "dynamic": ref.get("dynamic"), **fit})
    audible_modes = max((len(row["modes"]) for row in rows), default=0)
    partial_rows = []
    offset_rows = []
    decay_rows = []
    for row in rows:
        levels = np.full(6, -80.0)
        offsets: list[float | None] = [0.0] + [None] * 5
        decays: list[float | None] = [None] * 6
        for mode in row["modes"]:
            slot = mode["mode"] - 1
            levels[slot] = mode["levelDb"]
            offsets[slot] = mode["offsetCents"]
            decays[slot] = mode["t60Seconds"]
        amps = np.power(10.0, levels / 20)
        if float(np.max(amps)) > 0:
            amps /= float(np.max(amps))
        partial_rows.append({
            "f0": round(row["expectedF0Hz"], 4), "partialB": 0.0,
            "partials": [{"amp": round(float(amp), 5), "spread": .1}
                         for amp in amps],
        })
        offset_rows.append({"f0": round(row["expectedF0Hz"], 4),
                            "offsetsCents": offsets})
        decay_rows.append({"f0": round(row["expectedF0Hz"], 4),
                           "t60Seconds": decays})
    pooled = []
    for mode in range(6):
        values = [row["partials"][mode]["amp"] for row in partial_rows]
        pooled.append({"amp": round(float(np.median(values)), 5), "spread": .1})
    hierarchy = []
    for row in decay_rows:
        one, two = row["t60Seconds"][:2]
        if one is not None and two is not None:
            hierarchy.append(one / max(two, 1e-6))
    result = {
        "schema": SCHEMA, "instrument": "glockenspiel", "validation": gate,
        "constructionClass": "bar", "stringBForbidden": True,
        "baseBarRatios": list(BAR_RATIOS), "notes": rows,
        "audibleModeCountMax": audible_modes,
        "modeRatioOffsetsCentsByRegister": offset_rows,
        "modeT60ByRegister": decay_rows,
        "mode1ToMode2T60RatioMedian": (round(float(np.median(hierarchy)), 4)
                                        if hierarchy else None),
        "measuredProfile": {
            "partials": pooled, "partialB": 0.0,
            "partialsByRegister": partial_rows,
            "barModeRatioOffsetsCentsByRegister": offset_rows,
            "barModeT60ByRegister": decay_rows,
            "resonances": [],
            "material": {"suggestedMaterial": .05, "basis": "bar-mode first fit; per-mode consumer pending"},
            "performance": {
                "envelopeAttack": .006, "envelopeDecay": .5,
                "envelopeSustain": 0.0, "envelopeRelease": 1.5,
                "vibratoProb": 0.0,
                "attackNoise": {"level": .6, "freq": 5800, "q": 2.5, "decay": .12},
            },
            "notesAnalysed": [{"file": row["sourceFile"], "midi": row["midi"]}
                              for row in rows],
            "provenance": {"source": "VSCO 2 CE; CC0-1.0"},
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n")
    return result


def install_profile(profiles_path: Path, fit_path: Path) -> dict[str, Any]:
    """Install the gated bar fit into the canonical measured-profile set."""
    profiles = json.loads(profiles_path.read_text())
    fit = json.loads(fit_path.read_text())
    if fit.get("schema") != SCHEMA or not fit.get("stringBForbidden"):
        raise RuntimeError("refusing to install an ungated/non-bar glock fit")
    profiles["glockenspiel"] = fit["measuredProfile"]
    ordered = {name: profiles[name] for name in sorted(profiles)}
    profiles_path.write_text(json.dumps(ordered, indent=1) + "\n")
    return {"status": "ok", "instrument": "glockenspiel",
            "profilePath": str(profiles_path),
            "fitSha256": hashlib.sha256(fit_path.read_bytes()).hexdigest()}


def _canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def audit_contract(fit_path: Path, initial_path: Path, manifest_path: Path,
                   output: Path) -> dict[str, Any]:
    """File the bar-specific controls that the generic scorer cannot audit."""
    fit = json.loads(fit_path.read_text())
    initial = json.loads(initial_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    continuous = {row["key"] for row in manifest.get("continuous", [])}
    structured = set(manifest.get("structured", {}))
    available = continuous | structured | set(initial)
    requirements = [
        {
            "feature": "mode-ratio-cents",
            "requiredControl": "barModeRatioOffsetsCents",
            "spec": "T-027",
            "weight": 0.0,
            "reason": "structured ratio control absent from manifest and renderer",
        },
        {
            "feature": "mode-t60-hierarchy",
            "requiredControl": "barModeT60",
            "spec": "T-070/N5b",
            "weight": 0.0,
            "reason": "one shared material law cannot reproduce measured per-mode decay",
        },
        {
            "feature": "centre-strike-mode-shape",
            "requiredControl": "barStrikePositionWeights",
            "spec": "T-070/N5c",
            "weight": 0.0,
            "reason": "string sin(n*pi*x) position comb is not a free-bar mode shape",
        },
    ]
    for row in requirements:
        row["present"] = row["requiredControl"] in available
        row["status"] = "available" if row["present"] else "failed-uncontrollable"
    mode_targets = [{"midi": row["midi"],
                     "offsets": [mode["offsetCents"] for mode in row["modes"]],
                     "t60": [mode["t60Seconds"] for mode in row["modes"]]}
                    for row in fit["notes"]]
    b_firewall = {
        "feature": "string-B-firewall",
        "status": "failed-engine-firewall",
        "campaignPinnedB": initial.get("partialB"),
        "campaignForbidsB": initial.get("stringBForbidden") is True,
        "engineFinding": "partialFrequency applies the stiff-string multiplier after every resonator table, including bar",
        "spec": "T-027",
        "fitAction": "B excluded and pinned to zero; never optimize it for glockenspiel",
    }
    result = {
        "schema": "sg2-bar-controllability-v1",
        "instrument": "glockenspiel",
        "status": ("clean" if all(row["present"] for row in requirements)
                   and b_firewall["status"] == "pass" else "failed-required-controls"),
        "objectiveHash": _canonical_hash({
            "fitSha256": hashlib.sha256(fit_path.read_bytes()).hexdigest(),
            "targets": mode_targets,
            "thresholds": {"ratioCents": 35, "mode1To2T60Ratio": 5,
                           "centreStrikeMode2DipDb": -6},
        }),
        "manifestHash": _canonical_hash(manifest),
        "initialPresetHash": _canonical_hash(initial),
        "fitSha256": hashlib.sha256(fit_path.read_bytes()).hexdigest(),
        "requirements": requirements,
        "stringBFirewall": b_firewall,
        "evidence": {
            "references": len(fit["notes"]),
            "dynamics": ["mf"],
            "mode1ToMode2T60RatioMedian": fit.get("mode1ToMode2T60RatioMedian"),
            "audibleModeCountMax": fit.get("audibleModeCountMax"),
            "malletBrightness": "not estimable: one dynamic only",
        },
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "controllability.json").write_text(json.dumps(result, indent=2) + "\n")
    lines = [
        "# Glockenspiel bar controllability — pass 17\n\n",
        f"Status: **{result['status']}**  \n",
        f"Objective hash: `{result['objectiveHash']}`  \n",
        f"Manifest hash: `{result['manifestHash']}`\n\n",
        "| Feature | Required control | Status | Weight | Spec |\n",
        "|---|---|---|---:|---|\n",
    ]
    for row in requirements:
        lines.append(f"| {row['feature']} | `{row['requiredControl']}` | "
                     f"{row['status']} | {row['weight']:.1f} | {row['spec']} |\n")
    lines.extend([
        f"| string-B-firewall | bar ignores stiff-string B | {b_firewall['status']} | 0.0 | T-027 |\n\n",
        "The first fit pins B to zero. Missing bar controls remain zero-weight "
        "and cannot be replaced by B or the string strike-position comb.\n",
    ])
    (output / "CONTROLLABILITY.md").write_text("".join(lines))
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p_validate = sub.add_parser("validate")
    p_validate.add_argument("--output", type=Path, required=True)
    p_extract = sub.add_parser("extract")
    p_extract.add_argument("--references", type=Path, required=True)
    p_extract.add_argument("--validation", type=Path, required=True)
    p_extract.add_argument("--output", type=Path, required=True)
    p_install = sub.add_parser("install-profile")
    p_install.add_argument("--profiles", type=Path, required=True)
    p_install.add_argument("--fit", type=Path, required=True)
    p_audit = sub.add_parser("audit-contract")
    p_audit.add_argument("--fit", type=Path, required=True)
    p_audit.add_argument("--initial", type=Path, required=True)
    p_audit.add_argument("--manifest", type=Path, required=True)
    p_audit.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.command == "validate":
        result = validate(args.output)
        summary = {"status": result["status"], "output": str(args.output)}
    elif args.command == "extract":
        result = extract(args.references, args.validation, args.output)
        summary = {"status": "ok", "output": str(args.output)}
    elif args.command == "install-profile":
        summary = install_profile(args.profiles, args.fit)
    else:
        result = audit_contract(args.fit, args.initial, args.manifest, args.output)
        summary = {"status": result["status"], "output": str(args.output),
                   "objectiveHash": result["objectiveHash"],
                   "manifestHash": result["manifestHash"]}
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
