"""Sung-voice-only source/body fitting and vowel construction checks.

This module deliberately does not modify the shared scorer or campaign runner.
It implements SUNG_PREFLIGHT V0.1's alternating fit:

    one pooled glottal source per singer identity
    + one fixed-Hz body per vowel

The emitted body bands use the engine's Gaussian-in-log-frequency convention:
``gain`` is log2 amplitude and ``width`` is Gaussian sigma in octaves.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Iterable

import numpy as np


VOWELS = ("a", "e", "i", "o", "u")

# RESEARCH_SUNG_REALISM §9b adult-male seed boxes. Class scaling is only a
# construction initializer; fitted corpus regions should replace it.
ADULT_MALE_VOWEL_BOXES_HZ = {
    "i": ((270.0, 410.0), (1900.0, 2800.0)),
    "e": ((460.0, 700.0), (1500.0, 2150.0)),
    "a": ((610.0, 920.0), (1100.0, 1600.0)),
    "o": ((400.0, 600.0), (730.0, 1100.0)),
    "u": ((300.0, 460.0), (800.0, 1200.0)),
}

VOICE_CLASS_FORMANT_SCALE = {
    "tenor": 1.0,
    "bass": 0.94,
    "mezzo-soprano": 1.15,
    "soprano": 1.18,
    "boy-soprano": 1.25,
}


@dataclass(frozen=True)
class SungObservation:
    """One analysed sustained note used by the alternating source/body fit."""

    vowel: str
    f0_hz: float
    partial_db: np.ndarray
    formants_hz: tuple[float, ...]
    bandwidths_hz: tuple[float, ...]
    register: str | None = None
    dynamic: str | None = None
    source_id: str | None = None


def _normalise_vowel(vowel: str) -> str:
    value = vowel.strip().lower()
    aliases = {"ah": "a", "eh": "e", "ee": "i", "oh": "o", "oo": "u"}
    value = aliases.get(value, value)
    if value not in VOWELS:
        raise ValueError(f"unsupported sung vowel: {vowel!r}")
    return value


def vowel_regions_for_class(
    voice_class: str,
    fitted_centres_hz: dict[str, tuple[float, float]] | None = None,
    fitted_fraction: float = 0.20,
) -> dict[str, tuple[tuple[float, float], tuple[float, float]]]:
    """Return F1/F2 construction regions for one voice class.

    When fitted centres exist, regions are centred on the primary singer's
    corpus rather than on a cross-singer literature mean.
    """

    key = voice_class.strip().lower().replace("_", "-").replace(" ", "-")
    if key not in VOICE_CLASS_FORMANT_SCALE:
        raise ValueError(f"unknown sung voice class: {voice_class!r}")
    scale = VOICE_CLASS_FORMANT_SCALE[key]
    regions = {}
    for vowel, (f1_box, f2_box) in ADULT_MALE_VOWEL_BOXES_HZ.items():
        if fitted_centres_hz and vowel in fitted_centres_hz:
            f1, f2 = fitted_centres_hz[vowel]
            regions[vowel] = (
                (f1 * (1 - fitted_fraction), f1 * (1 + fitted_fraction)),
                (f2 * (1 - fitted_fraction), f2 * (1 + fitted_fraction)),
            )
        else:
            regions[vowel] = (
                (f1_box[0] * scale, f1_box[1] * scale),
                (f2_box[0] * scale, f2_box[1] * scale),
            )
    return regions


def classify_vowel(
    f1_hz: float,
    f2_hz: float,
    regions: dict[str, tuple[tuple[float, float], tuple[float, float]]],
) -> str | None:
    """Classify an F1/F2 pair by containment, then nearest log-frequency box."""

    if not (np.isfinite(f1_hz) and np.isfinite(f2_hz) and f1_hz > 0 and f2_hz > 0):
        return None
    contained = [
        vowel for vowel, (f1_box, f2_box) in regions.items()
        if f1_box[0] <= f1_hz <= f1_box[1] and f2_box[0] <= f2_hz <= f2_box[1]
    ]
    if len(contained) == 1:
        return contained[0]
    if len(contained) > 1:
        return min(
            contained,
            key=lambda vowel: _region_distance(f1_hz, f2_hz, regions[vowel]),
        )
    return min(
        regions,
        key=lambda vowel: _region_distance(f1_hz, f2_hz, regions[vowel]),
        default=None,
    )


def _region_distance(
    f1_hz: float,
    f2_hz: float,
    region: tuple[tuple[float, float], tuple[float, float]],
) -> float:
    centres = [math.sqrt(bounds[0] * bounds[1]) for bounds in region]
    return float(
        (math.log2(f1_hz / centres[0])) ** 2
        + (math.log2(f2_hz / centres[1])) ** 2
    )


def vowel_classification_gate(
    rendered_formants: dict[str, dict[str, tuple[float, float]]],
    voice_class: str,
    fitted_centres_hz: dict[str, tuple[float, float]] | None = None,
    required_registers: tuple[str, ...] = ("low", "mid"),
) -> dict:
    """Evaluate V1's hard gate without pretending high-f0 LPC is reliable."""

    regions = vowel_regions_for_class(voice_class, fitted_centres_hz)
    rows = []
    for vowel in VOWELS:
        for register in required_registers:
            pair = (rendered_formants.get(vowel) or {}).get(register)
            classified = classify_vowel(*pair, regions) if pair else None
            rows.append({
                "vowel": vowel,
                "register": register,
                "formantsHz": list(pair) if pair else None,
                "classifiedAs": classified,
                "passed": classified == vowel,
            })
    return {
        "voiceClass": voice_class,
        "passed": bool(rows) and all(row["passed"] for row in rows),
        "passedRows": sum(row["passed"] for row in rows),
        "requiredRows": len(rows),
        "rows": rows,
    }


def _body_transfer_db(
    bands: Iterable[dict],
    frequencies_hz: np.ndarray,
    amount: float = 1.0,
) -> np.ndarray:
    """Mirror ``synth.js:bodyResponse`` in dB for a consuming-side audit.

    This deliberately implements the emitted-band law, not a fitted smooth
    approximation.  The render audit compares these exact expected gains with
    a body-on/body-bypassed audio pair, closing T-007/F4 at the final consumer.
    """

    frequencies = np.maximum(np.asarray(frequencies_hz, dtype=float), 20.0)
    log2_gain = np.zeros_like(frequencies)
    for band in bands:
        centre = max(20.0, float(band.get("freq", 1000.0)))
        width = max(0.08, float(band.get("width", 0.5)))
        gain = float(band.get("gain", 0.0))
        distance = np.log2(frequencies / centre)
        log2_gain += gain * np.exp(-0.5 * (distance / width) ** 2)
    response = np.clip(2.0 ** (log2_gain * float(amount)), 0.2, 4.5)
    return 20.0 * np.log10(response)


def compare_rendered_vowel_body_transfer(
    body_partial_amps: Iterable[float],
    bypass_partial_amps: Iterable[float],
    common_partial_mask: Iterable[bool],
    *,
    f0_hz: float,
    bands: Iterable[dict],
    amount: float = 1.0,
    max_frequency_hz: float = 8000.0,
    median_tolerance_db: float = 1.5,
    correlation_floor: float = 0.85,
) -> dict:
    """Compare the rendered body transfer with its fitted band law.

    The shared analyser normalises each note's strongest partial, so both the
    observed and expected curves have their median offsets removed.  Shape is
    what proves that the selected vowel body reached audio; overall note level
    remains the envelope/gain layer's responsibility.
    """

    body = np.asarray(tuple(body_partial_amps), dtype=float)
    bypass = np.asarray(tuple(bypass_partial_amps), dtype=float)
    common = np.asarray(tuple(common_partial_mask), dtype=bool)
    count = min(len(body), len(bypass), len(common))
    harmonics = np.arange(1, count + 1, dtype=float)
    frequencies = harmonics * float(f0_hz)
    valid = (
        common[:count]
        & np.isfinite(body[:count])
        & np.isfinite(bypass[:count])
        & (body[:count] > 1e-6)
        & (bypass[:count] > 1e-6)
        & (frequencies <= max_frequency_hz)
    )
    if np.count_nonzero(valid) < 6:
        return {
            "passed": False,
            "reason": "fewer than six common audible harmonics",
            "commonHarmonics": int(np.count_nonzero(valid)),
            "medianShapeErrorDb": None,
            "shapeCorrelation": None,
        }
    observed = 20.0 * np.log10(body[:count][valid] / bypass[:count][valid])
    expected = _body_transfer_db(bands, frequencies[valid], amount)
    observed -= float(np.median(observed))
    expected -= float(np.median(expected))
    error = np.abs(observed - expected)
    if float(np.std(expected)) < 1e-6 or float(np.std(observed)) < 1e-6:
        correlation = 1.0 if float(np.max(error)) <= median_tolerance_db else 0.0
    else:
        correlation = float(np.corrcoef(observed, expected)[0, 1])
    median_error = float(np.median(error))
    passed = bool(
        np.isfinite(correlation)
        and median_error <= median_tolerance_db
        and correlation >= correlation_floor
    )
    return {
        "passed": passed,
        "reason": None if passed else "rendered body transfer misses fitted bands",
        "commonHarmonics": int(np.count_nonzero(valid)),
        "medianShapeErrorDb": median_error,
        "p95ShapeErrorDb": float(np.percentile(error, 95)),
        "shapeCorrelation": correlation,
        "medianToleranceDb": median_tolerance_db,
        "correlationFloor": correlation_floor,
    }


def classify_rendered_vowel_body_transfer(
    body_partial_amps: Iterable[float],
    bypass_partial_amps: Iterable[float],
    common_partial_mask: Iterable[bool],
    *,
    f0_hz: float,
    vowel_bodies: dict[str, dict],
    voice_class: str,
    amount: float = 1.0,
) -> dict:
    """Classify a rendered vowel from its measured body transfer.

    Raw LPC is not a calibrated formant estimator for a sparse additive
    source: its poles lock to individual pitch harmonics and may disappear
    entirely at high f0.  The paired FIT render supplies the missing
    source/body separation without reading the requested vowel label.  This
    classifier compares that measured transfer against *all* installed vowel
    bodies, chooses the closest emitted law, and then independently requires
    the winning body's F1/F2 centres to remain inside the annex region.  The
    latter prevents a self-fitted body from redefining its own vowel box.
    """

    regions = vowel_regions_for_class(voice_class)
    candidates = {}
    for vowel in VOWELS:
        body = vowel_bodies.get(vowel) or {}
        result = compare_rendered_vowel_body_transfer(
            body_partial_amps,
            bypass_partial_amps,
            common_partial_mask,
            f0_hz=f0_hz,
            bands=body.get("bands", []),
            amount=amount,
        )
        candidates[vowel] = result
    eligible = {
        vowel: row for vowel, row in candidates.items()
        if row.get("medianShapeErrorDb") is not None
        and np.isfinite(row["medianShapeErrorDb"])
    }
    classified = min(
        eligible,
        key=lambda vowel: (
            eligible[vowel]["medianShapeErrorDb"],
            -float(eligible[vowel].get("shapeCorrelation") or -1),
        ),
        default=None,
    )
    centres = (vowel_bodies.get(classified) or {}).get("formantsHz", []) \
        if classified else []
    in_annex = False
    if len(centres) >= 2 and classified in regions:
        f1_box, f2_box = regions[classified]
        in_annex = bool(
            f1_box[0] <= float(centres[0]) <= f1_box[1]
            and f2_box[0] <= float(centres[1]) <= f2_box[1]
        )
    winning = candidates.get(classified, {}) if classified else {}
    return {
        "method": "paired-harmonic-transfer-all-vowel-models",
        "classifiedAs": classified,
        "formantsHz": [float(x) for x in centres[:2]] if len(centres) >= 2 else None,
        "annexRegionPassed": in_annex,
        "passed": bool(classified and winning.get("passed") and in_annex),
        "candidates": candidates,
        "rawLpcApplicability": "diagnostic-only-sparse-harmonic-root-bias",
    }


def _band_width_octaves(freq_hz: float, bandwidth_hz: float) -> float:
    """Convert approximate -3 dB bandwidth to engine Gaussian sigma octaves."""

    half = min(max(bandwidth_hz, 25.0) / 2, freq_hz * 0.8)
    lo = max(20.0, freq_hz - half)
    hi = freq_hz + half
    fwhm_oct = math.log2(hi / lo)
    return float(np.clip(fwhm_oct / 2.355, 0.08, 0.65))


def _basis(freqs_hz: np.ndarray, centres_hz: np.ndarray, widths_oct: np.ndarray) -> np.ndarray:
    log_distance = np.log2(
        np.maximum(freqs_hz[:, None], 20.0) / np.maximum(centres_hz[None, :], 20.0)
    )
    return np.exp(-0.5 * (log_distance / widths_oct[None, :]) ** 2)


def fit_pooled_source_vowel_bodies(
    observations: Iterable[SungObservation],
    *,
    n_partials: int = 64,
    iterations: int = 8,
    ridge: float = 0.08,
) -> dict:
    """Alternate a pooled rank source against independently fitted vowel bodies.

    A per-note intercept is removed every update so recording level cannot be
    misfiled as source identity or a vowel resonance. Source and body are
    normalised to a scale-free reconstruction; absolute level belongs to the
    ordinary envelope/gain path.
    """

    obs = [
        SungObservation(
            vowel=_normalise_vowel(row.vowel),
            f0_hz=float(row.f0_hz),
            partial_db=np.asarray(row.partial_db, dtype=float),
            formants_hz=tuple(float(x) for x in row.formants_hz),
            bandwidths_hz=tuple(float(x) for x in row.bandwidths_hz),
            register=row.register,
            dynamic=row.dynamic,
            source_id=row.source_id,
        )
        for row in observations
    ]
    if not obs:
        raise ValueError("at least one sung observation is required")
    missing = [vowel for vowel in VOWELS if not any(row.vowel == vowel for row in obs)]
    if missing:
        raise ValueError(f"missing vowel observations: {missing}")

    source = np.zeros(n_partials, dtype=float)
    source_counts = np.zeros(n_partials, dtype=int)
    for harmonic in range(n_partials):
        values = [
            row.partial_db[harmonic]
            for row in obs
            if harmonic < len(row.partial_db) and np.isfinite(row.partial_db[harmonic])
        ]
        if values:
            source[harmonic] = float(np.median(values))
            source_counts[harmonic] = len(values)
        elif harmonic:
            source[harmonic] = source[harmonic - 1]
    source -= source[0]

    bodies: dict[str, dict] = {}
    for _ in range(max(1, iterations)):
        for vowel in VOWELS:
            rows = [row for row in obs if row.vowel == vowel]
            centres = np.median(
                np.asarray([row.formants_hz[:5] for row in rows], dtype=float),
                axis=0,
            )
            bandwidths = np.median(
                np.asarray([row.bandwidths_hz[:5] for row in rows], dtype=float),
                axis=0,
            )
            widths = np.asarray([
                _band_width_octaves(freq, width)
                for freq, width in zip(centres, bandwidths)
            ])
            design_parts = []
            target_parts = []
            for row in rows:
                count = min(n_partials, len(row.partial_db))
                harmonic = np.arange(1, count + 1, dtype=float)
                freqs = row.f0_hz * harmonic
                target = row.partial_db[:count] - source[:count]
                finite = np.isfinite(target) & (freqs <= 12000)
                if np.count_nonzero(finite) < 4:
                    continue
                matrix = _basis(freqs[finite], centres, widths)
                # Remove note level before adding it to the shared vowel fit.
                target = target[finite] - float(np.median(target[finite]))
                design_parts.append(matrix)
                target_parts.append(target)
            if not design_parts:
                raise ValueError(f"no analysable observations for vowel {vowel}")
            design = np.vstack(design_parts)
            target = np.concatenate(target_parts)
            lhs = design.T @ design + ridge * np.eye(design.shape[1])
            gains_db = np.linalg.solve(lhs, design.T @ target)
            gains_db = np.clip(gains_db, -1.5 * 6.020599913, 1.5 * 6.020599913)
            bodies[vowel] = {
                "bands": [
                    {
                        "freq": round(float(freq), 3),
                        "gain": round(float(gain_db / 6.020599913), 6),
                        "width": round(float(width), 6),
                    }
                    for freq, gain_db, width in zip(centres, gains_db, widths)
                ],
                "formantsHz": [round(float(x), 3) for x in centres],
                "bandwidthsHz": [round(float(x), 3) for x in bandwidths],
                "nNotes": len(rows),
            }

        updates: list[list[float]] = [[] for _ in range(n_partials)]
        for row in obs:
            count = min(n_partials, len(row.partial_db))
            harmonic = np.arange(1, count + 1, dtype=float)
            freqs = row.f0_hz * harmonic
            bands = bodies[row.vowel]["bands"]
            centres = np.asarray([band["freq"] for band in bands])
            widths = np.asarray([band["width"] for band in bands])
            gains_db = np.asarray([band["gain"] * 6.020599913 for band in bands])
            body_db = _basis(freqs, centres, widths) @ gains_db
            residual = row.partial_db[:count] - body_db
            finite = np.isfinite(residual)
            if np.count_nonzero(finite) < 4:
                continue
            residual = residual - float(np.median(residual[finite]))
            for harmonic_index in np.flatnonzero(finite):
                updates[int(harmonic_index)].append(float(residual[harmonic_index]))
        for harmonic, values in enumerate(updates):
            if values:
                source[harmonic] = float(np.median(values))
                source_counts[harmonic] = len(values)
        source -= source[0]

    errors = []
    for row in obs:
        count = min(n_partials, len(row.partial_db))
        harmonic = np.arange(1, count + 1, dtype=float)
        freqs = row.f0_hz * harmonic
        bands = bodies[row.vowel]["bands"]
        body_db = _basis(
            freqs,
            np.asarray([band["freq"] for band in bands]),
            np.asarray([band["width"] for band in bands]),
        ) @ np.asarray([band["gain"] * 6.020599913 for band in bands])
        predicted = source[:count] + body_db
        actual = row.partial_db[:count]
        finite = np.isfinite(actual)
        if np.any(finite):
            delta = actual[finite] - predicted[finite]
            delta -= np.median(delta)
            errors.extend(np.abs(delta).tolist())

    source_linear = 10 ** (source / 20)
    source_linear /= max(float(np.max(source_linear)), 1e-12)
    return {
        "schemaVersion": 1,
        "method": "alternating-pooled-glottal-source-per-vowel-fixed-hz-body",
        "sourcePartials": [
            {"amp": round(float(amp), 7), "observations": int(count)}
            for amp, count in zip(source_linear, source_counts)
        ],
        "vowelBodies": bodies,
        "roundTripMedianAbsDb": round(float(np.median(errors)), 4) if errors else None,
        "roundTripP95AbsDb": round(float(np.percentile(errors, 95)), 4) if errors else None,
        "observations": len(obs),
    }


__all__ = [
    "SungObservation",
    "VOWELS",
    "classify_vowel",
    "classify_rendered_vowel_body_transfer",
    "compare_rendered_vowel_body_transfer",
    "fit_pooled_source_vowel_bodies",
    "vowel_classification_gate",
    "vowel_regions_for_class",
]
