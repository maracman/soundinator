"""Executable construction checklists for Sound Generator 2.0 campaigns.

The feature loss answers "how close is this render to this reference?".  These
assertions answer the orthogonal question "is it built like the named
instrument?" so a convenient spectral fit cannot hide a wrong excitor or
resonator.  The accompanying evidence and thresholds are documented in the
four ``docs/sg2/DOSSIER_*.md`` files.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

from .score import FeatureBundle


@dataclass(frozen=True)
class ConstructionSample:
    """One rendered note plus the campaign coordinates used by cross-note gates."""

    render: FeatureBundle
    reference: FeatureBundle | None = None
    register: str | None = None
    dynamic: str | float | None = None
    velocity: float | None = None


ALIASES = {
    "alto sax": "alto-sax", "alto saxophone": "alto-sax", "altosax": "alto-sax",
    "tenor sax": "tenor-sax", "tenor saxophone": "tenor-sax", "tenorsax": "tenor-sax",
    "french horn": "french-horn", "horn": "french-horn",
    "grand piano": "piano", "grand-piano": "piano",
    "acoustic guitar": "guitar", "classical guitar": "guitar",
    "guitar-nylon": "guitar", "nylon-string acoustic guitar": "guitar",
    "nylon-string-acoustic-guitar": "guitar",
    "male voice": "tenor", "male tenor": "tenor", "basso profondo": "contrabass",
    "oktavist": "contrabass", "bass voice": "contrabass", "mezzo soprano": "mezzo-soprano",
    "boy soprano": "boy-soprano", "treble": "boy-soprano",
}

FAMILY = {
    "flute": "blown", "clarinet": "blown", "alto-sax": "blown", "tenor-sax": "blown",
    "trumpet": "blown", "french-horn": "blown",
    "violin": "bowed", "cello": "bowed",
    "piano": "struck-plucked", "guitar": "struck-plucked",
    "tenor": "sung", "contrabass": "sung", "mezzo-soprano": "sung",
    "boy-soprano": "sung",
}

_DYNAMIC_LEVELS = {
    "pp": 0.15, "p": 0.25, "mp": 0.42, "mf": 0.62, "f": 0.82, "ff": 1.0,
    "soft": 0.25, "medium": 0.62, "loud": 0.9,
}


def normalize_instrument(name: str) -> str:
    key = name.strip().lower().replace("_", "-")
    key = " ".join(key.split())
    return ALIASES.get(key, key.replace(" ", "-"))


def _json_value(value: Any) -> Any:
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    return value


def _result(
    assertion_id: str,
    description: str,
    passed: bool | None,
    observed: Any,
    requirement: str,
    *,
    strict_evidence: bool,
) -> dict[str, Any]:
    status = "pass" if passed is True else "fail" if passed is False or strict_evidence else "not-applicable"
    return {
        "id": assertion_id,
        "description": description,
        "status": status,
        "observed": _json_value(observed),
        "requirement": requirement,
    }


def _partial_db(bundle: FeatureBundle, count: int = 24) -> np.ndarray:
    amps = np.maximum(np.asarray(bundle.note.partial_amps[:count], dtype=float), 1e-6)
    return 20 * np.log10(amps / max(float(np.max(amps)), 1e-6))


def _odd_even_contrast(bundle: FeatureBundle, count: int = 8) -> float:
    """Even-partial level minus neighbouring odd-partial level, in dB."""
    db = _partial_db(bundle, count)
    values: list[float] = []
    for harmonic in range(2, min(count, len(db)) + 1, 2):
        index = harmonic - 1
        neighbours = [db[index - 1]]
        if index + 1 < len(db):
            neighbours.append(db[index + 1])
        values.append(float(db[index] - np.mean(neighbours)))
    return float(np.mean(values)) if values else math.nan


def _spectral_index(bundle: FeatureBundle, count: int = 24) -> float:
    amps = np.maximum(np.asarray(bundle.note.partial_amps[:count], dtype=float), 0)
    power = amps * amps
    return float(np.dot(np.arange(1, len(power) + 1), power) / max(float(power.sum()), 1e-12))


def _tilt_db_per_octave(bundle: FeatureBundle, count: int = 20) -> float:
    db = _partial_db(bundle, count)
    harmonic = np.arange(1, len(db) + 1, dtype=float)
    audible = db > -55
    if np.count_nonzero(audible) < 4:
        return math.nan
    return float(np.polyfit(np.log2(harmonic[audible]), db[audible], 1)[0])


def _band_prominence(bundle: FeatureBundle, low_hz: float, high_hz: float) -> float:
    """Mean partial dB in a fixed-Hz band relative to adjacent octaves."""
    f0 = max(float(bundle.note.f0), 1)
    db = _partial_db(bundle, min(64, len(bundle.note.partial_amps)))
    freq = f0 * np.arange(1, len(db) + 1)
    inside = (freq >= low_hz) & (freq <= high_hz)
    flank = ((freq >= low_hz / 1.55) & (freq < low_hz)) | ((freq > high_hz) & (freq <= high_hz * 1.55))
    if not np.any(inside) or not np.any(flank):
        return math.nan
    return float(np.mean(db[inside]) - np.mean(db[flank]))


def _dynamic_value(sample: ConstructionSample) -> float | None:
    if sample.velocity is not None:
        return float(sample.velocity)
    if isinstance(sample.dynamic, (int, float)):
        return float(sample.dynamic)
    if isinstance(sample.dynamic, str):
        return _DYNAMIC_LEVELS.get(sample.dynamic.strip().lower())
    return None


def _register_groups(samples: list[ConstructionSample]) -> dict[str, list[ConstructionSample]]:
    groups: dict[str, list[ConstructionSample]] = {}
    for sample in samples:
        if sample.register:
            groups.setdefault(sample.register.strip().lower(), []).append(sample)
    return groups


def _dynamic_slope(samples: list[ConstructionSample], metric) -> tuple[float | None, int]:
    pairs: list[tuple[float, float]] = []
    for sample in samples:
        dynamic = _dynamic_value(sample)
        value = metric(sample.render)
        if dynamic is not None and np.isfinite(value):
            pairs.append((dynamic, value))
    if len({round(row[0], 3) for row in pairs}) < 2:
        return None, len(pairs)
    x = np.asarray([row[0] for row in pairs]); y = np.asarray([row[1] for row in pairs])
    return float(np.polyfit(x, y, 1)[0]), len(pairs)


def _param(params: dict[str, Any], key: str) -> Any:
    if key in params:
        return params[key]
    performance = params.get("performance")
    return performance.get(key) if isinstance(performance, dict) else None


def _topology_assertions(instrument: str, params: dict[str, Any], strict: bool) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    expected_excitation = {
        "violin": "bow", "cello": "bow", "piano": "strike", "guitar": "pluck", "flute": "blow",
        "clarinet": "blow", "alto-sax": "blow", "tenor-sax": "blow",
        "trumpet": "blow", "french-horn": "blow", "tenor": "blow",
        "contrabass": "blow", "mezzo-soprano": "blow", "boy-soprano": "blow",
    }.get(instrument)
    expected_resonator = {
        "violin": "string", "cello": "string", "piano": "string", "guitar": "string", "flute": "string",
        "clarinet": "closedTube", "alto-sax": "conicalTube", "tenor-sax": "conicalTube",
        "trumpet": "conicalTube", "french-horn": "conicalTube",
    }.get(instrument)
    if expected_excitation:
        actual = _param(params, "excitationType")
        rows.append(_result(f"{instrument}.excitor", "Correct physical excitation class", None if actual is None else actual == expected_excitation,
                            actual, f"excitationType = {expected_excitation}", strict_evidence=strict))
    if expected_resonator:
        actual = _param(params, "resonatorClass")
        rows.append(_result(f"{instrument}.resonator", "Correct resonator mode class", None if actual is None else actual == expected_resonator,
                            actual, f"resonatorClass = {expected_resonator}", strict_evidence=strict))
    return rows


def evaluate_construction(
    instrument: str,
    samples: Iterable[ConstructionSample],
    *,
    params: dict[str, Any] | None = None,
    strict_evidence: bool = True,
) -> dict[str, Any]:
    """Evaluate the dossier checklist for a note set.

    ``strict_evidence`` is true for campaign gates: absent register/dynamic or
    preset evidence fails.  The one-pair scorer sets it false and reports such
    cross-note checks as ``not-applicable``.
    """
    name = normalize_instrument(instrument)
    sample_list = list(samples)
    params = params or {}
    rows = _topology_assertions(name, params, strict_evidence)

    registers = _register_groups(sample_list)
    dynamic_values = {_dynamic_value(row) for row in sample_list if _dynamic_value(row) is not None}
    rows.append(_result(f"{name}.register-coverage", "Register evidence spans the instrument",
                        len(registers) >= 3 if registers else None, sorted(registers), "at least 3 named registers",
                        strict_evidence=strict_evidence))
    rows.append(_result(f"{name}.dynamic-coverage", "Dynamic evidence spans soft and loud playing",
                        len(dynamic_values) >= 2 if dynamic_values else None, len(dynamic_values), "at least 2 dynamics",
                        strict_evidence=strict_evidence))

    if name in {"flute", "clarinet", "alto-sax", "tenor-sax", "trumpet", "french-horn",
                "violin", "cello"}:
        # The bowed dossier makes the same demand as owner note L6 did for
        # blown: the body must be fitted from THIS instrument's corpus —
        # reusing another instrument's bands (or a pitch-shifted copy) is
        # structurally wrong for a fixed-Hz radiator.
        bands = _param(params, "bodyBands")
        valid_bands = [row for row in bands
                       if isinstance(row, dict) and
                       all(isinstance(row.get(key), (int, float))
                           for key in ("freq", "gain", "width")) and
                       row["freq"] > 0 and row["width"] > 0] \
            if isinstance(bands, list) else []
        body_valid = (len(valid_bands) >= 3 and
                      max(row["freq"] for row in valid_bands) /
                      min(row["freq"] for row in valid_bands) >= 2 and
                      max(abs(row["gain"]) for row in valid_bands) >= .05)
        rows.append(_result(f"{name}.measured-body",
                            "Fixed-Hz body is fitted from this instrument's corpus",
                            body_valid, len(valid_bands),
                            "at least 3 non-neutral fitted body bands spanning an octave",
                            strict_evidence=strict_evidence))

    pitch_errors = []
    for sample in sample_list:
        if sample.reference and sample.reference.note.f0 > 0 and sample.render.note.f0 > 0:
            pitch_errors.append(abs(1200 * math.log2(sample.render.note.f0 / sample.reference.note.f0)))
    pitch_max = max(pitch_errors) if pitch_errors else None
    rows.append(_result(f"{name}.pitch-lock", "Rendered source locks to the intended acoustic mode",
                        None if pitch_max is None else pitch_max <= 50, pitch_max, "maximum paired f0 error <= 50 cents",
                        strict_evidence=strict_evidence))

    notes = [sample.render.note for sample in sample_list]
    percussive_fraction = float(np.mean([note.percussive for note in notes])) if notes else None
    if name in {"piano", "guitar"}:
        rows.append(_result(f"{name}.impulsive-envelope", "Excitation produces a decaying, impulsive note",
                            None if percussive_fraction is None else percussive_fraction >= .67,
                            percussive_fraction, "at least 2/3 of notes classified percussive", strict_evidence=strict_evidence))
    else:
        rows.append(_result(f"{name}.sustained-envelope", "Continuous excitation sustains the note",
                            None if percussive_fraction is None else percussive_fraction <= .33,
                            percussive_fraction, "at most 1/3 of notes classified percussive", strict_evidence=strict_evidence))

    brightness_slope, brightness_count = _dynamic_slope(sample_list, _spectral_index)
    if name in {"flute", "clarinet", "alto-sax", "tenor-sax", "trumpet", "french-horn", "piano", "guitar"}:
        rows.append(_result(f"{name}.dynamic-brightening", "Upper-partial energy rises with playing intensity",
                            None if brightness_slope is None else brightness_slope > .15,
                            {"slope": brightness_slope, "samples": brightness_count}, "partial-index slope > 0.15 per unit velocity",
                            strict_evidence=strict_evidence))

    if name == "clarinet":
        low = registers.get("low", []) or registers.get("chalumeau", [])
        high = registers.get("high", []) or registers.get("clarino", [])
        low_contrast = float(np.mean([_odd_even_contrast(s.render) for s in low])) if low else None
        high_contrast = float(np.mean([_odd_even_contrast(s.render) for s in high])) if high else None
        rows.append(_result("clarinet.low-odd-series", "Low register favours odd harmonics",
                            None if low_contrast is None else low_contrast <= -6, low_contrast,
                            "even partials average >= 6 dB below odd neighbours in low register", strict_evidence=strict_evidence))
        rise = None if low_contrast is None or high_contrast is None else high_contrast - low_contrast
        rows.append(_result("clarinet.register-even-rise", "Even harmonics rise above the register break",
                            None if rise is None else rise >= 3, rise,
                            "high-minus-low even/odd contrast >= 3 dB", strict_evidence=strict_evidence))

    if name in {"alto-sax", "tenor-sax", "trumpet", "french-horn"}:
        contrast = float(np.mean([_odd_even_contrast(s.render) for s in sample_list])) if sample_list else None
        rows.append(_result(f"{name}.full-series", "Full harmonic series retains even modes",
                            None if contrast is None else contrast >= -12, contrast,
                            "even partials no more than 12 dB below odd neighbours", strict_evidence=strict_evidence))
        blare = _param(params, "dynamicBlare")
        rows.append(_result(f"{name}.blare-law", "Nonlinear forte enrichment is explicitly enabled",
                            None if blare is None else float(blare) > 0, blare, "dynamicBlare > 0",
                            strict_evidence=strict_evidence))
        if name == "french-horn":
            coupling = _param(params, "articulationCoupling")
            variation = _param(params, "articulationVariation")
            scoop_depth = _param(params, "onsetScoopDepthCents")
            scoop_settle = _param(params, "onsetScoopSettle")
            enabled = None if any(value is None for value in
                                  (coupling, variation, scoop_depth, scoop_settle)) else (
                float(coupling) > 0 and float(variation) > 0 and
                float(scoop_depth) > 0 and float(scoop_settle) > 0)
            rows.append(_result(f"{name}.coupled-articulation-law",
                                "One fitted articulation distribution couples plosive, breath lead and pitch scoop",
                                enabled,
                                {"coupling": coupling, "variation": variation,
                                 "depthCents": scoop_depth, "settle": scoop_settle},
                                "articulationCoupling/Variation and onset scoop depth/settle > 0",
                                strict_evidence=strict_evidence))
            correlation = _param(params, "onsetArticulationCorrelation")
            correlation_count = _param(params, "onsetPitchNotes")
            evidenced = None if correlation is None or correlation_count is None else (
                float(correlation) <= -.2 and int(correlation_count) >= 4)
            rows.append(_result(f"{name}.articulation-anticorrelation",
                                "WP-3 references demonstrate inverse plosive strength versus scoop depth",
                                evidenced,
                                {"correlation": correlation, "samples": correlation_count},
                                "at least 4 tracked reference onsets and Pearson r <= -0.2",
                                strict_evidence=strict_evidence))
        if name in {"alto-sax", "tenor-sax"}:
            breath_exponent = _param(params, "breathVelocityExponent")
            rows.append(_result(f"{name}.soft-breath-law",
                                "Soft reed dynamics retain proportionally more air noise",
                                None if breath_exponent is None else float(breath_exponent) < 1,
                                breath_exponent, "breathVelocityExponent < 1",
                                strict_evidence=strict_evidence))
            turbulence = _param(params, "breathTurbulence")
            rows.append(_result(f"{name}.turbulence-law",
                                "Sustained air has continuous seeded texture",
                                None if turbulence is None else float(turbulence) > 0,
                                turbulence, "breathTurbulence > 0",
                                strict_evidence=strict_evidence))
            body_air = _param(params, "breathBodyAmount")
            rows.append(_result(f"{name}.body-coloured-air",
                                "Air noise passes through the fitted instrument body",
                                None if body_air is None else float(body_air) > 0,
                                body_air, "breathBodyAmount > 0",
                                strict_evidence=strict_evidence))
            onset_tilt = _param(params, "onsetSpectrumTilt")
            onset_decay = _param(params, "onsetSpectrumDecay")
            onset_enabled = None if onset_tilt is None or onset_decay is None else (
                abs(float(onset_tilt)) > .01 and float(onset_decay) > 0)
            rows.append(_result(f"{name}.onset-spectrum-law",
                                "Onset harmonic colour is distinct from the sustain print",
                                onset_enabled, {"tilt": onset_tilt, "decay": onset_decay},
                                "abs(onsetSpectrumTilt) > 0.01 and onsetSpectrumDecay > 0",
                                strict_evidence=strict_evidence))
        if name == "french-horn":
            direct = _param(params, "attackNoiseDirect")
            rows.append(_result("french-horn.independent-onset", "Measured lip transient is not masked by the sustained ADSR",
                                None if direct is None else float(direct) > 0, direct,
                                "attackNoiseDirect > 0", strict_evidence=strict_evidence))
            exponent = _param(params, "attackNoiseVelocityExponent")
            rows.append(_result("french-horn.soft-onset-law", "Soft horn attacks retain a measured lip transient",
                                None if exponent is None else float(exponent) < 1, exponent,
                                "attackNoiseVelocityExponent < 1", strict_evidence=strict_evidence))
            onset_registers = _param(params, "attackNoiseByRegister")
            valid_onset_registers = [row for row in onset_registers
                                     if isinstance(row, dict) and isinstance(row.get("f0"), (int, float))] \
                if isinstance(onset_registers, list) else []
            rows.append(_result("french-horn.register-onset-law",
                                "Lip-transient shape follows the measured register",
                                len(valid_onset_registers) >= 3, len(valid_onset_registers),
                                "at least 3 attackNoiseByRegister anchors", strict_evidence=strict_evidence))
            envelope_registers = _param(params, "envelopeAttackByRegister")
            valid_envelope_registers = [row for row in envelope_registers
                                        if isinstance(row, dict) and
                                        isinstance(row.get("f0"), (int, float)) and
                                        isinstance(row.get("attack", row.get("envelopeAttack")),
                                                   (int, float))] \
                if isinstance(envelope_registers, list) else []
            rows.append(_result("french-horn.register-envelope-law",
                                "Amplitude-envelope attack follows the measured register",
                                len(valid_envelope_registers) >= 3,
                                len(valid_envelope_registers),
                                "at least 3 envelopeAttackByRegister anchors",
                                strict_evidence=strict_evidence))

    if name in {"violin", "cello"}:
        b_values = [s.render.note.B for s in sample_list if s.render.note.B is not None]
        b_max = max(b_values) if b_values else None
        rows.append(_result(f"{name}.near-harmonic-string", "Bowed-string modes remain near harmonic",
                            None if b_max is None else 0 <= b_max <= .003, b_max, "0 <= measured B <= 0.003",
                            strict_evidence=strict_evidence))
        low_hz, high_hz = ((2000, 3200) if name == "violin" else (180, 700))
        prominences = [_band_prominence(s.render, low_hz, high_hz) for s in sample_list]
        prominences = [x for x in prominences if np.isfinite(x)]
        median = float(np.median(prominences)) if prominences else None
        rows.append(_result(f"{name}.fixed-body-region", "A fixed-Hz body/bridge region survives pitch changes",
                            None if median is None else median >= -6, median,
                            f"median {low_hz}-{high_hz} Hz prominence >= -6 dB vs flanks", strict_evidence=strict_evidence))
        edge_slope, edge_count = _dynamic_slope(sample_list, _spectral_index)
        rows.append(_result(f"{name}.bow-force-edge", "Higher bow intensity does not darken the spectrum",
                            None if edge_slope is None else edge_slope >= -.05,
                            {"slope": edge_slope, "samples": edge_count}, "partial-index slope >= -0.05",
                            strict_evidence=strict_evidence))
        # FAMILY FIREWALL (OWNER_LISTENING_NOTES.md header): the onset /
        # articulation mechanisms may share code with blown, but every
        # slope, coupling and depth ships NEUTRAL for bowed until this
        # instrument's own corpus evidences it.  A bowed preset carrying a
        # non-neutral articulation law must carry the per-instrument
        # measurement that justifies it (same evidence rule the horn gate
        # uses) — blown-fitted values are never defaults for bow.
        firewall_keys = ("articulationCoupling", "articulationVariation",
                         "onsetScoopDepthCents", "onsetScoopVelocitySlope",
                         "onsetScoopRegisterSlope", "breathVelocityExponent")
        non_neutral = {key: _param(params, key) for key in firewall_keys
                       if isinstance(_param(params, key), (int, float))
                       and abs(float(_param(params, key))) > 1e-9
                       and not (key == "breathVelocityExponent"
                                and float(_param(params, key)) == 1)}
        correlation = _param(params, "onsetArticulationCorrelation")
        correlation_count = _param(params, "onsetPitchNotes")
        evidenced = (isinstance(correlation, (int, float)) and
                     isinstance(correlation_count, (int, float)) and
                     int(correlation_count) >= 4)
        rows.append(_result(f"{name}.family-firewall-neutral-onset",
                            "Excitation-generic onset laws stay neutral until string-corpus evidence fits them",
                            (not non_neutral) or evidenced,
                            {"nonNeutral": sorted(non_neutral),
                             "correlation": correlation, "samples": correlation_count},
                            "articulation/scoop/breath laws all neutral, or >= 4 tracked onsets from this instrument's references",
                            strict_evidence=strict_evidence))

    if name in {"piano", "guitar"}:
        b_values = [s.render.note.B for s in sample_list if s.render.note.B is not None]
        b_med = float(np.median(b_values)) if b_values else None
        rows.append(_result(f"{name}.stiff-string", "String stiffness produces non-negative inharmonicity",
                            None if b_med is None else b_med >= 0, b_med, "median measured B >= 0",
                            strict_evidence=strict_evidence))
        coupling = _param(params, "velocityHardnessCoupling")
        rows.append(_result(f"{name}.hardness-coupling", "Playing velocity changes contact hardness",
                            None if coupling is None else float(coupling) > 0, coupling, "velocityHardnessCoupling > 0",
                            strict_evidence=strict_evidence))
        second = _param(params, "decaySecondStage")
        ratio = _param(params, "decaySecondRatio")
        rows.append(_result(f"{name}.double-decay", "Fast direct decay and slower aftersound are enabled",
                            None if second is None or ratio is None else float(second) > 0 and float(ratio) > 1,
                            {"amount": second, "lateEarlyRatio": ratio}, "decaySecondStage > 0 and decaySecondRatio > 1",
                            strict_evidence=strict_evidence))
        if name == "guitar":
            air = [_band_prominence(s.render, 75, 130) for s in sample_list]
            air = [x for x in air if np.isfinite(x)]
            air_med = float(np.median(air)) if air else None
            rows.append(_result("guitar.air-mode", "Low guitar air mode is represented in fixed Hz",
                                None if air_med is None else air_med >= -9, air_med,
                                "75-130 Hz prominence >= -9 dB vs flanks where measurable", strict_evidence=strict_evidence))

    if FAMILY.get(name) == "sung":
        tilt_values = [_tilt_db_per_octave(s.render) for s in sample_list]
        tilt_values = [x for x in tilt_values if np.isfinite(x)]
        tilt = float(np.median(tilt_values)) if tilt_values else None
        rows.append(_result(f"{name}.glottal-rolloff", "Glottal source rolls off toward upper harmonics",
                            None if tilt is None else -18 <= tilt <= -1, tilt,
                            "median source-envelope slope between -18 and -1 dB/octave", strict_evidence=strict_evidence))
        glottal = _param(params, "glottalTilt")
        rows.append(_result(f"{name}.glottal-law", "Glottal tilt law is explicitly fitted",
                            None if glottal is None else -1 <= float(glottal) <= 1, glottal, "glottalTilt fitted in [-1, 1] (zero is admissible)",
                            strict_evidence=strict_evidence))
        if name != "boy-soprano":
            singer = _param(params, "singerFormantAmount")
            rows.append(_result(f"{name}.singer-formant-law", "Singer-formant body control is explicitly fitted",
                                None if singer is None else float(singer) >= 0, singer, "singerFormantAmount fitted (zero allowed)",
                                strict_evidence=strict_evidence))
        sync = _param(params, "voiceBreathSync")
        reference_noise = [s.reference.note.attack_noise.get("level", 0) for s in sample_list
                           if s.reference and isinstance(s.reference.note.attack_noise, dict)]
        needs_sync = bool(reference_noise) and float(np.median(reference_noise)) >= .02
        rows.append(_result(f"{name}.pitch-sync-breath", "Breath component is pitch-synchronous rather than a static bed",
                            None if sync is None else (float(sync) > 0 if needs_sync else float(sync) >= 0),
                            {"voiceBreathSync": sync, "referenceNoiseMedian": float(np.median(reference_noise)) if reference_noise else None},
                            "voiceBreathSync > 0 when reference noise level >= 0.02; zero otherwise allowed",
                            strict_evidence=strict_evidence))
        if name in {"tenor", "contrabass"}:
            prominence = [_band_prominence(s.render, 2700, 3300) for s in sample_list]
            prominence = [x for x in prominence if np.isfinite(x)]
            median = float(np.median(prominence)) if prominence else None
            rows.append(_result(f"{name}.singer-formant-band", "Carrying voice has a fixed-Hz 3 kHz cluster",
                                None if median is None else median >= -6, median,
                                "2.7-3.3 kHz prominence >= -6 dB vs flanks", strict_evidence=strict_evidence))
        if name == "boy-soprano":
            morphology = params.get("boyMorphology") if isinstance(params.get("boyMorphology"), dict) else {}
            tract = morphology.get("tractScale")
            base_formants = np.asarray(morphology.get("baseFormantsHz", []), dtype=float)
            child_formants = np.asarray(morphology.get("scaledFormantsHz", []), dtype=float)
            scale_consistent = None
            observed_ratios: list[float] = []
            if tract is not None and len(base_formants) >= 3 and len(child_formants) == len(base_formants):
                observed_ratios = (child_formants / np.maximum(base_formants, 1)).tolist()
                expected_ratio = 1 / float(tract)
                ratio_ok = bool(np.all(np.abs(child_formants / base_formants - expected_ratio) <= .12 * expected_ratio))
                bands = params.get("bodyBands") if isinstance(params.get("bodyBands"), list) else []
                band_freqs = np.asarray([row.get("freq") for row in bands
                                         if isinstance(row, dict) and isinstance(row.get("freq"), (int, float))], dtype=float)
                applied = len(band_freqs) >= 3 and all(
                    bool(np.any(np.abs(band_freqs - target) <= .12 * target)) for target in child_formants[:3])
                scale_consistent = ratio_ok and applied
            rows.append(_result("boy-soprano.tract-scale", "Child morphology shortens the adult vocal tract",
                                None if tract is None else .75 <= float(tract) <= .9, tract,
                                "boyMorphology.tractScale in [0.75, 0.90], then fit vowel-wise", strict_evidence=strict_evidence))
            rows.append(_result("boy-soprano.formant-scaling", "Scaled formants implement the declared tract morphology",
                                scale_consistent, observed_ratios,
                                "at least 3 scaled/base formants within 12% of 1/tractScale and applied as bodyBands",
                                strict_evidence=strict_evidence))
            singer = _param(params, "singerFormantAmount")
            rows.append(_result("boy-soprano.no-adult-singer-cluster", "Adult male singer-formant boost is not imposed",
                                None if singer is None else float(singer) <= .35, singer,
                                "singerFormantAmount <= 0.35 unless a child reference demonstrates otherwise",
                                strict_evidence=strict_evidence))

    failed = [row for row in rows if row["status"] == "fail"]
    missing = [row for row in rows if row["status"] == "not-applicable"]
    return {
        "checklistVersion": 1,
        "instrument": name,
        "family": FAMILY.get(name),
        "passed": not failed and (not strict_evidence or not missing),
        "counts": {
            "pass": sum(row["status"] == "pass" for row in rows),
            "fail": len(failed),
            "notApplicable": len(missing),
        },
        "assertions": rows,
    }


__all__ = ["ConstructionSample", "evaluate_construction", "normalize_instrument"]
