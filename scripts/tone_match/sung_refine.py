#!/usr/bin/env python3
"""Apply a render-domain correction to a canonical sung source/body fit.

The first alternating fit reconstructs analysed reference partials, but the
real renderer subsequently applies its excitation and dynamics laws.  This
pass compares those real FIT renders with their matched references, estimates
one robust per-harmonic source correction, and pins corpus-measured ADSR/onset
values.  Vowel bodies remain untouched, preserving the paired T-058 consumer.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

from scripts.tone_match.analysis import analyse_audio_file


def _finite_median(values, default=None):
    rows = [float(value) for value in values
            if isinstance(value, (int, float)) and np.isfinite(value)]
    return float(np.median(rows)) if rows else default


def refine(
    references_path: Path,
    fit_root: Path,
    baseline_run: Path,
    output_root: Path,
    *,
    correction_fraction: float = 0.65,
    max_correction_db: float = 6.0,
) -> dict:
    references = json.loads(references_path.read_text())
    selected = [row for row in references if "spectral" in row.get("roles", [])]
    selected.sort(key=lambda row: (
        "aeiou".index(row["vowel"]),
        ("low", "mid", "high").index(row["register"]),
        row.get("velocity", 0), row["sourceFile"],
    ))
    manifest = json.loads((baseline_run / "audition-manifest.json").read_text())
    if len(selected) != len(manifest):
        raise ValueError(
            f"reference/render cardinality changed: {len(selected)} != {len(manifest)}"
        )

    source_fit = json.loads((fit_root / "SOURCE_VOWEL_FIT.json").read_text())
    base = dict(source_fit["baseParams"])
    count = len(base.get("spectralPartialMeans", []))
    corrections: list[list[float]] = [[] for _ in range(count)]
    adsr = {key: [] for key in ("attack", "decay", "sustain", "release")}
    attack_noise = {key: [] for key in ("level", "freq", "q", "decay")}
    analysed_rows = 0

    for row, trial in zip(selected, manifest):
        try:
            reference = analyse_audio_file(
                trial["reference"], n_partials=count,
                expected_f0_hz=row["expectedF0Hz"],
            )
            rendered = analyse_audio_file(
                trial["fitRender"], n_partials=count,
                expected_f0_hz=row["expectedF0Hz"],
            )
        except (ValueError, RuntimeError):
            continue
        valid = (
            np.asarray(reference.partial_snr_ok, dtype=bool)
            & np.asarray(rendered.partial_snr_ok, dtype=bool)
            & (np.asarray(reference.partial_amps) > 1e-6)
            & (np.asarray(rendered.partial_amps) > 1e-6)
        )
        if np.count_nonzero(valid) >= 4:
            delta = 20 * np.log10(
                np.maximum(reference.partial_amps, 1e-8)
                / np.maximum(rendered.partial_amps, 1e-8)
            )
            # Both analysers normalise note level.  Remove the surviving
            # intercept before pooling a source-shape correction.
            delta -= float(np.median(delta[valid]))
            for index in np.flatnonzero(valid):
                if index < count:
                    corrections[int(index)].append(float(delta[index]))
        for key in adsr:
            adsr[key].append(reference.adsr.get(key))
        if isinstance(reference.attack_noise, dict):
            for key in attack_noise:
                attack_noise[key].append(reference.attack_noise.get(key))
        analysed_rows += 1

    old = np.asarray(base["spectralPartialMeans"], dtype=float)
    correction_db = np.asarray([
        np.clip(_finite_median(rows, 0.0), -max_correction_db, max_correction_db)
        for rows in corrections
    ])
    new = old * 10 ** (correction_fraction * correction_db / 20)
    peak = float(np.max(new)) if len(new) else 1.0
    if peak > 0:
        new /= peak
    base["spectralPartialMeans"] = [round(float(value), 8) for value in new]

    # ADSR is pinned tier (§2.4), not a free craft judgement.  The scalar
    # renderer caps non-bowed attacks at 180 ms, so retain the measured median
    # with that explicit current-engine bound.
    base["envelopeAttack"] = round(min(.18, _finite_median(adsr["attack"], .06)), 6)
    base["envelopeDecay"] = round(min(.5, _finite_median(adsr["decay"], .06)), 6)
    base["envelopeSustain"] = round(float(np.clip(
        _finite_median(adsr["sustain"], .78), .05, 1.0)), 6)
    base["envelopeRelease"] = round(min(.6, _finite_median(adsr["release"], .28)), 6)
    level = _finite_median(attack_noise["level"])
    if level is not None:
        base["attackNoiseLevel"] = round(float(np.clip(level, 0, 1)), 6)
    frequency = _finite_median(attack_noise["freq"])
    if frequency is not None:
        base["attackNoiseFreq"] = round(float(np.clip(frequency, 80, 12000)), 3)
    q_value = _finite_median(attack_noise["q"])
    if q_value is not None:
        base["attackNoiseQ"] = round(float(np.clip(q_value, .1, 12)), 6)
    decay = _finite_median(attack_noise["decay"])
    if decay is not None:
        base["attackNoiseDecay"] = round(float(np.clip(decay, .005, .5)), 6)

    output_root.mkdir(parents=True, exist_ok=True)
    for vowel in "aeiou":
        prior = json.loads((fit_root / f"initial-{vowel}.json").read_text())
        params = {**prior, **base}
        # The vowel body is the immutable fitted identity for this file.
        params["bodyBands"] = prior["bodyBands"]
        params["activeVowel"] = vowel
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )

    payload = {
        **source_fit,
        "baseParams": base,
        "renderDomainRefinement": {
            "method": "robust-per-harmonic-reference-minus-real-render",
            "baselineRun": str(baseline_run),
            "analysedRows": analysed_rows,
            "correctionFraction": correction_fraction,
            "maxCorrectionDb": max_correction_db,
            "medianAbsAppliedCorrectionDb": round(float(np.median(
                np.abs(correction_fraction * correction_db))), 6),
            "maxAbsAppliedCorrectionDb": round(float(np.max(
                np.abs(correction_fraction * correction_db))), 6),
            "criteriaOrder": ["partial-table", "mel-spectrogram", "attack-t90", "band-balance"],
        },
    }
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n"
    )
    analysed_path = fit_root / "ANALYSED_REFERENCES.json"
    if analysed_path.exists():
        (output_root / "ANALYSED_REFERENCES.json").write_text(
            analysed_path.read_text()
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--fit-root", type=Path, required=True)
    parser.add_argument("--baseline-run", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--correction-fraction", type=float, default=.65)
    parser.add_argument("--max-correction-db", type=float, default=6.0)
    args = parser.parse_args()
    payload = refine(
        args.references, args.fit_root, args.baseline_run, args.out,
        correction_fraction=args.correction_fraction,
        max_correction_db=args.max_correction_db,
    )
    print(json.dumps(payload["renderDomainRefinement"], indent=2))


if __name__ == "__main__":
    main()
