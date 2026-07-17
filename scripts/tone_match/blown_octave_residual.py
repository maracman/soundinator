#!/usr/bin/env python3
"""Extract a stable post-source/post-air octave residual for blown notes.

The residual is measured from the final sustained render, after both the
pinned harmonic source and the independent air component have sounded.  It is
then projected back onto one existing register x dynamic harmonic-source row.
No body band or air-level value is fitted here.  A real extraction is refused
unless the same implementation has first passed its synthetic harmonic+air
round trip (SG2 protocol section 4).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from scipy import signal

from scripts.fit_profiles_from_samples import load_mono
from scripts.tone_match.score import OCTAVE_CENTRES, _active_sample_span


SCHEMA = "sg2-blown-post-source-air-octave-v1"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _sustain_blocks(samples: np.ndarray, sample_rate: int, *,
                    active_duration_s: float | None = None,
                    block_count: int = 3) -> list[np.ndarray]:
    values = np.asarray(samples, dtype=float)
    if active_duration_s is not None:
        values = values[:round(float(active_duration_s) * sample_rate)]
    span = _active_sample_span(values, sample_rate)
    if span is None:
        raise ValueError("no active note span for octave residual")
    start = span[0] + round(.25 * sample_rate)
    stop = span[1] - round(.10 * sample_rate)
    if stop <= start:
        raise ValueError("no post-onset/pre-release sustain for octave residual")
    sustain = values[start:stop]
    # Three blocks are the real-data stability minimum.  Each must retain at
    # least 250 ms so the result is not a single FFT-frame accident.
    if sustain.size < block_count * round(.25 * sample_rate):
        raise ValueError(
            f"stable octave residual needs {block_count} x 250 ms sustain blocks")
    edges = np.linspace(0, sustain.size, block_count + 1, dtype=int)
    return [sustain[left:right] for left, right in zip(edges[:-1], edges[1:])]


def _octave_profile(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    nperseg = min(4096, samples.size)
    freqs, psd = signal.welch(
        samples, fs=sample_rate, window="hann", nperseg=nperseg,
        noverlap=min(nperseg - 1, round(nperseg * .75)), scaling="density")
    ratio = math.sqrt(2)
    energies = []
    for centre in OCTAVE_CENTRES:
        selected = (freqs >= centre / ratio) & (freqs < centre * ratio)
        energies.append(
            float(np.trapezoid(psd[selected], freqs[selected]))
            if np.count_nonzero(selected) >= 2 else 0.0)
    energies = np.asarray(energies, dtype=float)
    total = float(np.sum(energies))
    if total <= 1e-20:
        raise ValueError("octave residual has no measurable sustained energy")
    return 10 * np.log10(np.maximum(energies / total, 1e-12))


def extract_stable_residual_samples(
    reference: np.ndarray,
    rendered: np.ndarray,
    sample_rate: int,
    *,
    render_sample_rate: int | None = None,
    f0_hz: float,
    active_duration_s: float | None = None,
    block_count: int = 3,
    maximum_mad_db: float = 2.0,
    minimum_sign_agreement: float = 2 / 3,
) -> dict[str, Any]:
    """Return temporally stable reference-minus-render octave residuals."""
    render_rate = int(render_sample_rate or sample_rate)
    ref_blocks = _sustain_blocks(
        reference, sample_rate, active_duration_s=active_duration_s,
        block_count=block_count)
    render_blocks = _sustain_blocks(
        rendered, render_rate, active_duration_s=active_duration_s,
        block_count=block_count)
    residuals = np.asarray([
        _octave_profile(ref, sample_rate) - _octave_profile(render, render_rate)
        for ref, render in zip(ref_blocks, render_blocks)
    ])
    median = np.median(residuals, axis=0)
    mad = np.median(np.abs(residuals - median), axis=0)
    sign_agreement = np.mean(
        np.sign(residuals) == np.sign(median)[None, :], axis=0)
    # The played fundamental is the first source-addressable evidence.  Room
    # and noise below it cannot become a harmonic-source correction.
    source_addressable = OCTAVE_CENTRES * math.sqrt(2) >= f0_hz * .95
    stable = (source_addressable & np.isfinite(median) &
              (mad <= maximum_mad_db) &
              (sign_agreement >= minimum_sign_agreement))
    return {
        "schema": SCHEMA,
        "status": "pass" if np.any(stable) else "fail",
        "f0Hz": float(f0_hz),
        "blockCount": block_count,
        "octaveCentresHz": OCTAVE_CENTRES.tolist(),
        "residualsDb": residuals.tolist(),
        "medianResidualDb": median.tolist(),
        "medianAbsoluteDeviationDb": mad.tolist(),
        "signAgreement": sign_agreement.tolist(),
        "sourceAddressable": source_addressable.tolist(),
        "stableBands": stable.tolist(),
        "stabilityBars": {
            "maximumMadDb": maximum_mad_db,
            "minimumSignAgreement": minimum_sign_agreement,
            "minimumBlocks": 3,
        },
    }


def extract_stable_residual_files(
    reference_path: Path,
    render_path: Path,
    *,
    f0_hz: float,
    active_duration_s: float | None = None,
) -> dict[str, Any]:
    reference, reference_rate = load_mono(str(reference_path))
    rendered, render_rate = load_mono(str(render_path))
    result = extract_stable_residual_samples(
        reference, rendered, reference_rate, render_sample_rate=render_rate,
        f0_hz=f0_hz,
        active_duration_s=active_duration_s)
    result.update({
        "reference": str(reference_path.resolve()),
        "referenceSha256": _sha(reference_path),
        "render": str(render_path.resolve()),
        "renderSha256": _sha(render_path),
        "referenceSampleRate": reference_rate,
        "renderSampleRate": render_rate,
        "activeDurationSec": active_duration_s,
        "measurementStage": "final-sustain-after-harmonic-source-and-air",
        "roomHandling": (
            "active sustain only; onset and release/tail excluded; no room "
            "component is inferred or fitted"),
    })
    return result


def _partial_correction_db(evidence: dict[str, Any], partial_frequencies: np.ndarray,
                           *, cap_db: float) -> np.ndarray:
    centres = np.asarray(evidence["octaveCentresHz"], dtype=float)
    residual = np.asarray(evidence["medianResidualDb"], dtype=float)
    stable = np.asarray(evidence["stableBands"], dtype=bool)
    # Unstable octave cells are exact zero anchors, preventing a neighbouring
    # residual from being extrapolated through unsupported evidence.
    supported = np.asarray(evidence["sourceAddressable"], dtype=bool)
    values = np.where(stable, np.clip(residual, -cap_db, cap_db), 0.0)
    selected_centres = centres[supported]
    selected_values = values[supported]
    if selected_centres.size < 2:
        raise ValueError("fewer than two source-addressable octave anchors")
    frequencies = np.asarray(partial_frequencies, dtype=float)
    result = np.zeros(frequencies.size, dtype=float)
    inside = (frequencies >= selected_centres[0] / math.sqrt(2)) & \
             (frequencies < selected_centres[-1] * math.sqrt(2))
    result[inside] = np.interp(
        np.log2(frequencies[inside]), np.log2(selected_centres), selected_values)
    return result


def apply_residual_to_params(
    params: dict[str, Any],
    evidence: dict[str, Any],
    *,
    register: str,
    dynamic: str,
    gain: float,
    cap_db: float = 3.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Apply a bounded correction to exactly one existing source cell."""
    if evidence.get("status") != "pass":
        raise ValueError("real octave residual did not pass stability bars")
    candidate = copy.deepcopy(params)
    surface = candidate.get("spectralPartialsByRegisterDynamic")
    if not isinstance(surface, dict) or not isinstance(surface.get("rows"), list):
        raise ValueError("selected fit has no source register/dynamic surface")
    matches = [row for row in surface["rows"]
               if row.get("register") == register and row.get("dynamic") == dynamic]
    if len(matches) != 1:
        raise ValueError(
            f"expected one selected-fit source row for {register}/{dynamic}, "
            f"found {len(matches)}")
    row = matches[0]
    partials = np.asarray(row.get("partials", []), dtype=float)
    if partials.size < 2 or partials[0] <= 0:
        raise ValueError("selected source row has no normalisable partial table")
    f0 = float(row.get("f0Hz") or evidence["f0Hz"])
    raw_db = _partial_correction_db(
        evidence, f0 * np.arange(1, partials.size + 1), cap_db=cap_db)
    bounded_db = gain * raw_db
    corrected = partials * 10 ** (bounded_db / 20)
    corrected[partials <= 0] = 0.0
    corrected /= corrected[0]
    # Record the effective correction after first-partial normalisation.
    effective_db = np.zeros_like(corrected)
    active = partials > 0
    effective_db[active] = 20 * np.log10(
        np.maximum(corrected[active], 1e-20) / partials[active])
    evidence_hash = hashlib.sha256(json.dumps(
        evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    row["partials"] = [round(float(value), 8) for value in corrected]
    row["activationStatus"] = "bounded-post-source-post-air-octave-correction"
    row["postSourceAirOctaveCorrection"] = {
        "schema": SCHEMA,
        "startingSurface": "selected-fit-cumulative-surface",
        "evidenceSha256": evidence_hash,
        "gain": float(gain),
        "capDb": float(cap_db),
        "rawDbByPartial": raw_db.tolist(),
        "effectiveDbByPartial": effective_db.tolist(),
        "bodyChanged": False,
        "airSurfaceChanged": False,
    }
    audit = {
        "schema": SCHEMA,
        "status": "candidate",
        "cell": f"{register}/{dynamic}",
        "gain": float(gain),
        "capDb": float(cap_db),
        "startingSurface": "selected-fit-cumulative-surface",
        "changedRows": 1,
        "unchangedRows": len(surface["rows"]) - 1,
        "bodyChanged": candidate.get("bodyBands") != params.get("bodyBands"),
        "airSurfaceChanged": (
            candidate.get("windBreathLevelByRegisterDynamic") !=
            params.get("windBreathLevelByRegisterDynamic")),
        "medianAbsEffectiveDb": float(np.median(np.abs(effective_db[active]))),
        "maxAbsEffectiveDb": float(np.max(np.abs(effective_db[active]))),
        "evidenceSha256": evidence_hash,
    }
    return candidate, audit


def _synth_note(partials: np.ndarray, *, sample_rate: int, duration_s: float,
                f0_hz: float, air: np.ndarray) -> np.ndarray:
    times = np.arange(round(sample_rate * duration_s)) / sample_rate
    tone = np.zeros(times.size, dtype=float)
    for index, amplitude in enumerate(partials, start=1):
        if index * f0_hz >= sample_rate / 2:
            break
        tone += amplitude * np.sin(2 * np.pi * index * f0_hz * times)
    ramp = np.minimum(1.0, times / .04) * np.minimum(
        1.0, (duration_s - times) / .06)
    return (tone + air) * np.maximum(ramp, 0.0)


def synthetic_roundtrip() -> dict[str, Any]:
    """Prove recovery on a known harmonic source plus independent air."""
    sample_rate, duration_s, f0 = 24_000, 2.4, 500.0
    count = 16
    base = 1 / np.arange(1, count + 1, dtype=float) ** 1.15
    known_centres = np.asarray([500, 1000, 2000, 4000, 8000], dtype=float)
    known_db = np.asarray([-1.0, 1.5, 2.5, -1.5, -3.0], dtype=float)
    frequencies = f0 * np.arange(1, count + 1)
    injected_db = np.interp(
        np.log2(frequencies), np.log2(known_centres), known_db)
    reference_partials = base * 10 ** (injected_db / 20)
    rng = np.random.default_rng(81731)
    air = signal.sosfilt(
        signal.butter(3, [250 / (sample_rate / 2), 9500 / (sample_rate / 2)],
                      btype="bandpass", output="sos"),
        rng.standard_normal(round(sample_rate * duration_s))) * .004
    rendered = _synth_note(
        base, sample_rate=sample_rate, duration_s=duration_s, f0_hz=f0, air=air)
    reference = _synth_note(
        reference_partials, sample_rate=sample_rate, duration_s=duration_s,
        f0_hz=f0, air=air)
    extracted = extract_stable_residual_samples(
        reference, rendered, sample_rate, f0_hz=f0,
        active_duration_s=duration_s)
    applied_db = _partial_correction_db(
        extracted, frequencies, cap_db=6.0)
    corrected = _synth_note(
        base * 10 ** (applied_db / 20), sample_rate=sample_rate,
        duration_s=duration_s, f0_hz=f0, air=air)
    remaining = extract_stable_residual_samples(
        reference, corrected, sample_rate, f0_hz=f0,
        active_duration_s=duration_s)
    valid = np.asarray(extracted["sourceAddressable"], dtype=bool)
    before = np.asarray(extracted["medianResidualDb"], dtype=float)[valid]
    after = np.asarray(remaining["medianResidualDb"], dtype=float)[valid]
    result = {
        "schema": SCHEMA,
        "status": "pass" if (
            extracted["status"] == "pass" and
            float(np.mean(np.abs(after))) <= .35 and
            float(np.max(np.abs(after))) <= .75) else "fail",
        "includesIndependentAir": True,
        "injectedDbByPartial": injected_db.tolist(),
        "appliedDbByPartial": applied_db.tolist(),
        "meanAbsResidualBeforeDb": float(np.mean(np.abs(before))),
        "meanAbsResidualAfterDb": float(np.mean(np.abs(after))),
        "maxAbsResidualAfterDb": float(np.max(np.abs(after))),
        "bars": {"meanAbsAfterDb": .35, "maxAbsAfterDb": .75},
        "extraction": extracted,
        "remaining": remaining,
    }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthetic-out", type=Path)
    parser.add_argument("--synthetic-evidence", type=Path)
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--render", type=Path)
    parser.add_argument("--params", type=Path)
    parser.add_argument("--source-surface", type=Path,
                        help="effective profile surface when params inherit it")
    parser.add_argument("--instrument")
    parser.add_argument("--register")
    parser.add_argument("--dynamic")
    parser.add_argument("--f0-hz", type=float)
    parser.add_argument("--duration-sec", type=float)
    parser.add_argument("--gain", type=float, default=.5)
    parser.add_argument("--cap-db", type=float, default=3.0)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--evidence-out", type=Path)
    args = parser.parse_args()
    if args.synthetic_out:
        result = synthetic_roundtrip()
        args.synthetic_out.parent.mkdir(parents=True, exist_ok=True)
        args.synthetic_out.write_text(json.dumps(result, indent=2) + "\n")
        print(json.dumps(result, indent=2))
        if result["status"] != "pass":
            raise SystemExit(1)
        return
    required = (args.synthetic_evidence, args.reference, args.render,
                args.params, args.register, args.dynamic, args.f0_hz,
                args.out, args.evidence_out)
    if any(value is None for value in required):
        parser.error("real extraction requires synthetic evidence and all input/output fields")
    synthetic = json.loads(args.synthetic_evidence.read_text())
    if synthetic.get("schema") != SCHEMA or synthetic.get("status") != "pass":
        raise ValueError("synthetic round-trip evidence is absent, stale, or failing")
    evidence = extract_stable_residual_files(
        args.reference, args.render, f0_hz=args.f0_hz,
        active_duration_s=args.duration_sec)
    evidence["syntheticRoundtrip"] = {
        "path": str(args.synthetic_evidence.resolve()),
        "sha256": _sha(args.synthetic_evidence),
        "status": synthetic["status"],
    }
    params = json.loads(args.params.read_text())
    if not params.get("spectralPartialsByRegisterDynamic"):
        if not args.source_surface or not args.instrument:
            raise ValueError(
                "params inherit their source surface; provide --source-surface "
                "and --instrument to materialise the selected fit")
        handoff = json.loads(args.source_surface.read_text())
        table = (handoff.get("instruments", {}).get(args.instrument)
                 if isinstance(handoff, dict) else None)
        if not isinstance(table, dict) or not isinstance(table.get("rows"), list):
            raise ValueError(
                f"{args.source_surface}: no {args.instrument!r} source rows")
        params["spectralPartialsByRegisterDynamic"] = {
            "schemaVersion": handoff.get("schemaVersion", 1),
            "handoff": handoff.get("handoff", "BLOWN-SUSTAIN-01"),
            "evidenceSha256": handoff.get("evidenceSha256"),
            "interpolation": handoff.get(
                "interpolationContract",
                "log-f0 x velocity; clamp outside measured hull"),
            "rows": copy.deepcopy(table["rows"]),
        }
        evidence["materialisedEffectiveSourceSurface"] = {
            "path": str(args.source_surface.resolve()),
            "sha256": _sha(args.source_surface),
            "instrument": args.instrument,
            "rowCount": len(table["rows"]),
        }
    candidate, audit = apply_residual_to_params(
        params, evidence, register=args.register, dynamic=args.dynamic,
        gain=args.gain, cap_db=args.cap_db)
    evidence["application"] = audit
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.evidence_out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(candidate, indent=2) + "\n")
    args.evidence_out.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"candidate": str(args.out), "evidence": evidence}, indent=2))


if __name__ == "__main__":
    main()
