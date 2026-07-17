#!/usr/bin/env python3
"""Emit instrument-owned bowed register x dynamic source estimates.

The pass-06 compatibility path applies a reference/render correction and is
retained only so its rejected evidence remains reproducible.  The canonical
path in pass 07 estimates the source directly from a lossless reference by
dividing its harmonic amplitudes by the exact emitted fixed-Hz body.  Rows are
neutral until a per-cell hierarchy audit accepts them; a rejected cell emits
the upstream per-string source unchanged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from .score import extract_features


def body_gain_db(bands: list[dict[str, Any]], frequencies_hz: np.ndarray,
                 amount: float = 1.0, *, fundamental_hz: float | None = None,
                 lowest_f0_hz: float | None = None) -> np.ndarray:
    """Return the engine's emitted log-frequency Gaussian body response."""
    frequencies = np.maximum(np.asarray(frequencies_hz, float), 20.0)
    gain_log2 = np.zeros(frequencies.shape, dtype=float)
    for band in bands:
        centre = max(20.0, float(band["freq"]))
        width = max(1e-6, float(band["width"]))
        gain_log2 += float(band["gain"]) * np.exp(
            -.5 * (np.log2(frequencies / centre) / width) ** 2)
    if (fundamental_hz is not None and lowest_f0_hz is not None and
            fundamental_hz <= lowest_f0_hz * 1.01 and len(gain_log2)):
        raw = gain_log2.copy()
        for index, (frequency, log_gain) in enumerate(zip(frequencies, raw)):
            local = np.sort(raw[max(0, index - 1):min(len(raw), index + 2)])
            median = float(np.median(local))
            best_weight, best_fwhm = 0.0, math.inf
            for band in bands:
                centre = max(20.0, float(band["freq"]))
                width = max(.08, float(band["width"]))
                distance = math.log2(float(frequency) / centre)
                weight = abs(float(band["gain"])) * math.exp(
                    -.5 * (distance / width) ** 2)
                if weight > best_weight:
                    best_weight = weight
                    best_fwhm = centre * (
                        2 ** (1.1775 * width) - 2 ** (-1.1775 * width))
            ratio = (fundamental_hz / best_fwhm
                     if np.isfinite(best_fwhm) and best_fwhm > 0 else 0.0)
            mix = float(np.clip(ratio - 1.0, 0.0, 1.0))
            capped = median + float(np.clip(log_gain - median, -1.0, 1.0))
            gain_log2[index] = log_gain + (capped - log_gain) * mix
    linear = np.clip(2 ** gain_log2, .2, 4.5)
    return 20 * np.log10(linear)


def deconvolve_source(partial_db: np.ndarray, frequencies_hz: np.ndarray,
                      bands: list[dict[str, Any]], amount: float = 1.0, *,
                      fundamental_hz: float | None = None,
                      lowest_f0_hz: float | None = None) -> np.ndarray:
    """Divide observed harmonics by the emitted body, scale-free."""
    observed = np.asarray(partial_db, float)
    frequencies = np.asarray(frequencies_hz, float)
    count = min(len(observed), len(frequencies))
    source_db = np.full(observed.shape, np.nan)
    valid = np.isfinite(observed[:count]) & np.isfinite(frequencies[:count]) & \
        (frequencies[:count] > 0)
    source_db[:count][valid] = observed[:count][valid] - body_gain_db(
        bands, frequencies[:count][valid], amount,
        fundamental_hz=fundamental_hz, lowest_f0_hz=lowest_f0_hz)
    finite = np.isfinite(source_db)
    if np.count_nonzero(finite) < 4:
        raise ValueError("fewer than four harmonics survive body deconvolution")
    source_db[finite] -= float(np.max(source_db[finite]))
    source = np.zeros(source_db.shape, dtype=float)
    source[finite] = 10 ** (source_db[finite] / 20)
    return source


def synthetic_deconvolution_round_trip() -> dict[str, Any]:
    """Prove the direct source/body separator before corpus use."""
    f0 = 73.416
    frequencies = f0 * np.arange(1, 33, dtype=float)
    source = np.arange(1, 33, dtype=float) ** -1.17
    source *= 1 + .08 * np.sin(np.arange(1, 33) * .71)
    source /= np.max(source)
    bands = [
        {"freq": 102.6, "gain": .4975, "width": .1904},
        {"freq": 210.8, "gain": .5264, "width": .1904},
        {"freq": 889.3, "gain": .6451, "width": .1904},
    ]
    observed_db = 20 * np.log10(source) + body_gain_db(bands, frequencies)
    recovered = deconvolve_source(observed_db, frequencies, bands)
    error = 20 * np.log10(np.maximum(recovered, 1e-12) /
                          np.maximum(source, 1e-12))
    error -= float(np.median(error))
    maximum = float(np.max(np.abs(error)))
    return {
        "schema": "sg2-bowed-source-deconvolution-validation-v1",
        "status": "pass" if maximum <= .01 else "fail",
        "maximumShapeErrorDb": round(maximum, 9),
        "maximumAllowedShapeErrorDb": .01,
        "emissionConvention": "20log10(2) * sum(gain * gaussian(log2(f/fc)))",
    }


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _string_partials(params: dict[str, Any], string: str, f0: float) -> np.ndarray:
    rows = sorted((row for row in params.get("partialsByString", {}).get(string, [])
                   if row.get("partials") and row.get("f0")),
                  key=lambda row: row["f0"])
    if not rows:
        raise ValueError(f"missing fitted string source {string}")
    if f0 <= rows[0]["f0"]:
        left = right = rows[0]
        amount = 0.0
    elif f0 >= rows[-1]["f0"]:
        left = right = rows[-1]
        amount = 0.0
    else:
        hi = next(index for index, row in enumerate(rows) if row["f0"] >= f0)
        left, right = rows[hi - 1], rows[hi]
        amount = math.log(f0 / left["f0"]) / math.log(right["f0"] / left["f0"])
    a = np.asarray([partial["amp"] for partial in left["partials"]], float)
    b = np.asarray([partial["amp"] for partial in right["partials"]], float)
    size = max(len(a), len(b))
    a, b = np.pad(a, (0, size - len(a))), np.pad(b, (0, size - len(b)))
    return a + (b - a) * amount


def build(instrument: str, references_path: Path, jobs_path: Path,
          params_path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    references = json.loads(references_path.read_text())
    jobs = json.loads(jobs_path.read_text())
    params = json.loads(params_path.read_text())
    if len(jobs) != len(references):
        raise ValueError("source attempt requires one retained render per reference")
    rows = []
    for reference, job in zip(references, jobs):
        reference_path, render_path = Path(reference["path"]), Path(job["out"])
        f0 = float(reference.get("expectedF0Hz") or reference["detectedF0"])
        ref = extract_features(reference_path, n_partials=32,
                               expected_f0_hz=f0, trust_expected_f0=True)
        rendered = extract_features(
            render_path, n_partials=32,
            active_duration_s=reference["durationSec"],
            expected_f0_hz=f0, trust_expected_f0=True)
        delta = np.asarray(ref.partial_db) - np.asarray(rendered.partial_db)
        base = _string_partials(params, reference["string"], f0)
        adjusted = base.copy()
        count = min(len(adjusted), len(delta))
        finite = np.isfinite(delta[:count])
        indices = np.flatnonzero(finite)
        adjusted[indices] *= 10 ** (delta[indices] / 20)
        adjusted = np.maximum(adjusted, 0)
        peak = float(np.max(adjusted))
        if not np.isfinite(peak) or peak <= 0:
            raise ValueError(f"invalid row {reference['register']}/{reference['dynamic']}")
        adjusted /= peak
        rows.append({
            "register": reference["register"],
            "dynamic": reference["dynamic"],
            "string": reference["string"],
            "f0Hz": round(f0, 6),
            "velocity": round(float(reference["velocity"]), 6),
            "partials": [round(float(value), 8) for value in adjusted],
            "activationStatus": "candidate-pending-consuming-audit-and-section-3",
            "medianAbsCorrectionDb": round(float(np.nanmedian(np.abs(delta))), 6),
            "provenance": {
                "sourceFile": reference.get("sourceFile"),
                "referenceSha256": _sha(reference_path),
                "renderSha256": _sha(render_path),
            },
        })
    cells = {(row["register"], row["dynamic"]) for row in rows}
    if len(rows) != 6 or len(cells) != 6:
        raise ValueError(f"expected six distinct cells, got {len(rows)}/{len(cells)}")
    table = {
        "schemaVersion": 1,
        "handoff": "D-BOWED-SOURCE-01",
        "instrument": instrument,
        "status": "candidate-pending-consuming-audit-and-section-3",
        "method": "paired-harmonic-residual-on-fitted-local-string-source",
        "interpolation": "joint log-f0 x velocity measured hull; clamp outside",
        "dynamicComposition": (
            "rows contain source shape at measured velocity; suppress generic "
            "spectralDynamicAmount while a row is active"),
        "firewall": f"{instrument}-only; no cross-instrument values",
        "paramsSha256": _sha(params_path),
        "referencesSha256": _sha(references_path),
        "rows": rows,
        "activationEligible": len(accepted_cells) == 6,
        "activationRule": (
            "the current renderer's dynamic-ownership flag is table-wide; emit no "
            "mixed accepted/neutral table. All six cells must clear their upstream "
            "hierarchy audits before candidate consumption"),
    }
    table["evidenceSha256"] = hashlib.sha256(json.dumps(
        table, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    candidate = dict(params)
    if table["activationEligible"]:
        candidate["spectralPartialsByRegisterDynamic"] = {
            key: table[key] for key in (
                "schemaVersion", "handoff", "evidenceSha256", "interpolation",
                "dynamicComposition", "rows")}
    else:
        candidate["spectralSourceAttempt"] = {
            "handoff": table["handoff"], "evidenceSha256": table["evidenceSha256"],
            "status": "not-consumed-mixed-cell-activation-forbidden",
        }
    return table, candidate


def build_deconvolved(
    instrument: str,
    references_path: Path,
    params_path: Path,
    accepted_cells: set[tuple[str, str]] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build six direct, body-divided cello source cells.

    ``accepted_cells`` is deliberately explicit.  Merely measuring a row may
    not activate it; the caller supplies only cells that passed the upstream
    partial tier and did not regress earlier construction bars.
    """
    accepted_cells = accepted_cells or set()
    references = json.loads(references_path.read_text())
    params = json.loads(params_path.read_text())
    validation = synthetic_deconvolution_round_trip()
    if validation["status"] != "pass":
        raise RuntimeError(f"synthetic source deconvolution failed: {validation}")
    bands = params.get("bodyBands") or []
    if not bands:
        raise ValueError(f"{instrument} has no emitted bodyBands to deconvolve")
    amount = float(params.get("spectralResonanceAmount", 1.0))
    profile_path = Path(__file__).resolve().parents[2] / "web/static/measured_profiles.json"
    profiles = json.loads(profile_path.read_text())
    lowest_f0_hz = (profiles.get(instrument, {}).get("resonancesFit", {})
                    .get("lowestF0Hz"))
    rows = []
    for reference in references:
        if "spectral" not in reference.get("roles", []):
            continue
        path = Path(reference["path"])
        source_file = str(reference.get("sourceFile", ""))
        if Path(source_file).suffix.lower() not in {".aif", ".aiff"}:
            continue
        f0 = float(reference.get("expectedF0Hz") or reference.get("detectedF0"))
        analysed = extract_features(
            path, n_partials=32, expected_f0_hz=f0, trust_expected_f0=True)
        frequencies = np.asarray(analysed.note.partial_freqs, float)
        attempted = deconvolve_source(
            np.asarray(analysed.partial_db, float), frequencies, bands, amount,
            fundamental_hz=f0, lowest_f0_hz=lowest_f0_hz)
        upstream = _string_partials(params, reference["string"], f0)
        size = max(len(attempted), len(upstream))
        attempted = np.pad(attempted, (0, size - len(attempted)))
        upstream = np.pad(upstream, (0, size - len(upstream)))
        audible = (attempted > 1e-5) & (upstream > 1e-5)
        correction = 20 * np.log10(
            np.maximum(attempted[audible], 1e-12) /
            np.maximum(upstream[audible], 1e-12))
        correction -= float(np.median(correction)) if correction.size else 0.0
        cell = (str(reference["register"]), str(reference["dynamic"]))
        accepted = cell in accepted_cells
        emitted = attempted if accepted else upstream
        peak = float(np.max(emitted))
        if peak <= 0 or not np.isfinite(peak):
            raise ValueError(f"invalid deconvolved row {cell}")
        emitted = emitted / peak
        rows.append({
            "register": cell[0], "dynamic": cell[1],
            "string": reference["string"], "f0Hz": round(f0, 6),
            "velocity": round(float(reference["velocity"]), 6),
            "partials": [round(float(value), 8) for value in emitted],
            "attemptedDeconvolvedPartials": [
                round(float(value), 8) for value in attempted],
            "upstreamPartials": [round(float(value), 8) for value in upstream],
            "activationStatus": (
                "accepted-by-per-cell-upstream-hierarchy-audit" if accepted else
                "neutralized-pending-per-cell-upstream-hierarchy-audit"),
            "medianAbsCorrectionFromUpstreamDb": round(
                float(np.median(np.abs(correction))) if correction.size else 0.0, 6),
            "provenance": {"sourceFile": source_file,
                           "referenceSha256": _sha(path)},
        })
    cells = {(row["register"], row["dynamic"]) for row in rows}
    expected = {(register, dynamic) for register in ("low", "mid", "high")
                for dynamic in ("pp", "ff")}
    if cells != expected or len(rows) != 6:
        raise ValueError(f"expected six lossless cells, got {len(rows)}: {sorted(cells)}")
    table = {
        "schemaVersion": 2,
        "handoff": "D-BOWED-SOURCE-02",
        "instrument": instrument,
        "status": "per-cell-deconvolved-hierarchy-gated",
        "method": "lossless-reference-harmonics-divided-by-exact-emitted-body",
        "interpolation": "joint log-f0 x velocity measured hull; clamp outside",
        "dynamicComposition": (
            "accepted rows own source shape at measured velocity; suppress generic "
            "spectralDynamicAmount while a row is active"),
        "firewall": f"{instrument}-only; no cross-instrument values",
        "syntheticRoundTrip": validation,
        "bodyAuditContract": {
            "intervention": "same source surface, bodyBands on versus empty",
            "neutralized": ["partialTransfer", "attackNoiseLevel", "bowNoiseLevel",
                            "bowScratchLevel", "vibratoProb", "excitationHuman"],
            "requiredMedianTransferErrorDbMax": 1.0,
            "purpose": "T-058 uncontaminated paired emitted-body audit adapted to cello",
        },
        "paramsSha256": _sha(params_path),
        "emittedBodyLowestF0Hz": lowest_f0_hz,
        "referencesSha256": _sha(references_path),
        "rows": rows,
    }
    table["evidenceSha256"] = hashlib.sha256(json.dumps(
        table, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    candidate = {
        **params,
        "spectralPartialsByRegisterDynamic": {
            key: table[key] for key in (
                "schemaVersion", "handoff", "evidenceSha256", "interpolation",
                "dynamicComposition", "rows")},
    }
    return table, candidate


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--jobs", type=Path)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--direct-deconvolution", action="store_true")
    parser.add_argument("--accept-cell", action="append", default=[],
                        help="hierarchy-approved register=dynamic cell")
    args = parser.parse_args()
    if args.direct_deconvolution:
        accepted = {tuple(value.split("=", 1)) for value in args.accept_cell}
        table, candidate = build_deconvolved(
            args.instrument, args.references, args.params, accepted)
    else:
        if args.jobs is None:
            parser.error("--jobs is required without --direct-deconvolution")
        table, candidate = build(
            args.instrument, args.references, args.jobs, args.params)
    for path, payload in ((args.out, table), (args.candidate, candidate)):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"out": str(args.out), "candidate": str(args.candidate),
                      "evidenceSha256": table["evidenceSha256"],
                      "rows": len(table["rows"])}, indent=2))


if __name__ == "__main__":
    main()
