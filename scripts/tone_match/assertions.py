"""Executable construction checklists for Sound Generator 2.0 campaigns.

The feature loss answers "how close is this render to this reference?".  These
assertions answer the orthogonal question "is it built like the named
instrument?" so a convenient spectral fit cannot hide a wrong excitor or
resonator.  The accompanying evidence and thresholds are documented in the
four ``docs/sg2/DOSSIER_*.md`` files.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from typing import Any, Iterable

import numpy as np

from .score import FeatureBundle, OCTAVE_CENTRES, THIRD_OCTAVE_CENTRES, band_balance_report


@dataclass(frozen=True)
class ConstructionSample:
    """One rendered note plus the campaign coordinates used by cross-note gates."""

    render: FeatureBundle
    reference: FeatureBundle | None = None
    register: str | None = None
    dynamic: str | float | None = None
    velocity: float | None = None
    roles: frozenset[str] | None = None
    band_mean_limit_db: float = 3.0
    band_max_octave_limit_db: float = 6.0


ALIASES = {
    "alto sax": "alto-sax", "alto saxophone": "alto-sax", "altosax": "alto-sax",
    "tenor sax": "tenor-sax", "tenor saxophone": "tenor-sax", "tenorsax": "tenor-sax",
    "french horn": "french-horn", "horn": "french-horn",
    "grand piano": "piano", "grand-piano": "piano",
    "upright piano": "piano", "upright-piano": "piano", "piano-upright": "piano",
    "acoustic guitar": "guitar", "classical guitar": "guitar",
    "guitar-nylon": "guitar", "nylon-string acoustic guitar": "guitar",
    "nylon-string-acoustic-guitar": "guitar",
    "male voice": "tenor", "male tenor": "tenor",
    "voice-tenor": "tenor", "voice-bass": "bass",
    "voice-mezzo": "mezzo-soprano", "voice-soprano": "soprano",
    "basso profondo": "basso-profondo", "contrabass": "basso-profondo",
    "oktavist": "basso-profondo", "bass voice": "bass",
    "mezzo soprano": "mezzo-soprano",
    "boy soprano": "boy-soprano", "treble": "boy-soprano",
}

SUNG_SECTION_TYPES = frozenset({"soprano", "mezzo-soprano", "tenor", "bass"})
SUNG_DERIVED_PRESETS = {"basso-profondo": "bass", "boy-soprano": "soprano"}

_NON_SUNG_PROFILES = frozenset({
    "flute", "clarinet", "alto-sax", "tenor-sax", "trumpet", "horn",
    "french-horn", "violin", "cello", "piano", "grand-piano", "guitar",
    "guitar-nylon", "guitar-steel", "harp", "glockenspiel", "marimba",
    "xylophone", "vibraphone",
})

FAMILY = {
    "flute": "blown", "clarinet": "blown", "alto-sax": "blown", "tenor-sax": "blown",
    "trumpet": "blown", "french-horn": "blown",
    "violin": "bowed", "cello": "bowed",
    "piano": "struck-plucked", "guitar": "struck-plucked",
    "soprano": "sung", "mezzo-soprano": "sung", "tenor": "sung",
    "bass": "sung", "basso-profondo": "sung", "boy-soprano": "sung",
}

_DYNAMIC_LEVELS = {
    "pp": 0.15, "p": 0.25, "mp": 0.42, "mf": 0.62, "f": 0.82, "ff": 1.0,
    "soft": 0.25, "medium": 0.62, "loud": 0.9,
}


def normalize_instrument(name: str) -> str:
    key = name.strip().lower().replace("_", "-")
    key = " ".join(key.split())
    return ALIASES.get(key, key.replace(" ", "-"))


def sung_family_firewall(
    instrument: str,
    params: dict[str, Any] | None,
    *,
    references: Iterable[dict[str, Any]] | None = None,
    prior: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Reject non-sung fitted state before a sung objective is evaluated.

    Neutral engine mechanisms and common parameter *names* are allowed.  The
    firewall acts only on declared provenance, fitted profiles, candidate
    tables, and objective rows, so a bowed/brass preset cannot seed a voice
    merely because its fields happen to be schema-compatible.
    """
    name = normalize_instrument(instrument)
    if FAMILY.get(name) != "sung":
        return {"passed": True, "applicable": False, "violations": []}

    preset = params or {}
    violations: list[dict[str, Any]] = []

    def reject(field: str, value: Any, reason: str) -> None:
        violations.append({"field": field, "value": value, "reason": reason})

    for key in ("sg2Family", "sourceFamily", "fittedFamily", "candidateFamily",
                "objectiveFamily"):
        value = preset.get(key)
        if value is not None and str(value).strip().lower() != "sung":
            reject(key, value, "declared family is not sung")

    profile = str(preset.get("spectralProfile", "")).strip().lower()
    if profile in _NON_SUNG_PROFILES:
        reject("spectralProfile", profile, "non-sung fitted spectral profile")

    provenance_fields = (
        "fittedFrom", "seededFrom", "candidateTable", "objectiveRows",
        "leaderboardSource", "presetSource",
    )
    for key in provenance_fields:
        value = preset.get(key)
        if value is None:
            continue
        text = json.dumps(value, sort_keys=True).lower() if not isinstance(value, str) else value.lower()
        for token in sorted(_NON_SUNG_PROFILES):
            if re.search(rf"(^|[^a-z]){re.escape(token)}([^a-z]|$)", text):
                reject(key, value, f"imports fitted state from {token}")
                break

    prior_value = prior or (preset.get("legacyPrior")
                            if isinstance(preset.get("legacyPrior"), dict) else None)
    if prior_value:
        source = str(prior_value.get("source", "")).strip().lower()
        family = str(prior_value.get("family", "")).strip().lower()
        if source and source not in {"vocal", "voice", "sung", name}:
            reject("legacyPrior.source", source, "legacy prior is not vocal/sung")
        if family and family != "sung":
            reject("legacyPrior.family", family, "legacy prior family is not sung")

    singers = {str(row.get("singer")) for row in references or [] if row.get("singer")}
    for index, row in enumerate(references or []):
        family = row.get("sg2Family", row.get("family"))
        if family is not None and str(family).strip().lower() != "sung":
            reject(f"references[{index}].family", family,
                   "objective row declares a non-sung family")
        row_profile = str(row.get("spectralProfile", "")).strip().lower()
        if row_profile in _NON_SUNG_PROFILES:
            reject(f"references[{index}].spectralProfile", row_profile,
                   "objective row imports a non-sung fitted profile")

    source_singer = preset.get("primarySinger", preset.get("singer"))
    fitted_from = preset.get("fittedFrom")
    if source_singer is None and isinstance(fitted_from, dict):
        source_singer = fitted_from.get("singer")
    if (source_singer is not None and singers and name not in SUNG_DERIVED_PRESETS
            and str(source_singer) not in singers):
        reject("primarySinger", source_singer,
               f"sung seed does not match objective singer(s) {sorted(singers)}")

    if name in SUNG_DERIVED_PRESETS:
        expected_parent = SUNG_DERIVED_PRESETS[name]
        derived = str(preset.get("derivedFrom", "")).strip().lower()
        morphology_key = "boyMorphology" if name == "boy-soprano" else "bassoMorphology"
        morphology = preset.get(morphology_key)
        if expected_parent not in derived or not any(
                token in derived for token in ("voice", "sung", "vocal")):
            reject("derivedFrom", derived,
                   f"derived preset must name frozen sung {expected_parent} parent")
        if not isinstance(morphology, dict) or not morphology:
            reject(morphology_key, morphology,
                   "derived sung preset requires an explicit morphology transform")

    return {
        "passed": not violations,
        "applicable": True,
        "instrument": name,
        "singers": sorted(singers),
        "violations": violations,
    }


def assert_sung_family_firewall(
    instrument: str,
    params: dict[str, Any] | None,
    *,
    references: Iterable[dict[str, Any]] | None = None,
    prior: dict[str, Any] | None = None,
) -> dict[str, Any]:
    report = sung_family_firewall(
        instrument, params, references=references, prior=prior)
    if not report["passed"]:
        details = "; ".join(
            f"{row['field']}: {row['reason']}" for row in report["violations"])
        raise ValueError(f"sung family firewall rejected {instrument}: {details}")
    return report


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


def _band_profile(bundle: FeatureBundle) -> np.ndarray | None:
    """Owner-readable octave LTAS from the same path used by the scorer."""
    if bundle.octave_balance_db is None:
        return None
    profile = np.asarray(bundle.octave_balance_db, dtype=float)
    return profile if profile.shape == OCTAVE_CENTRES.shape else None


def _profile_peak(bundle: FeatureBundle) -> float | None:
    profile = _band_profile(bundle)
    if profile is None or not np.any(np.isfinite(profile)):
        return None
    return float(OCTAVE_CENTRES[int(np.nanargmax(profile))])


def _dynamic_subset(samples: list[ConstructionSample], *, soft: bool) -> list[ConstructionSample]:
    rows = []
    for sample in samples:
        value = _dynamic_value(sample)
        if value is not None and ((soft and value <= .35) or (not soft and value >= .75)):
            rows.append(sample)
    return rows


def _median_octave_profile(samples: list[ConstructionSample]) -> np.ndarray | None:
    profiles = [_band_profile(sample.render) for sample in samples]
    profiles = [profile for profile in profiles if profile is not None]
    return np.median(np.stack(profiles), axis=0) if profiles else None


def _high_side_slope(profile: np.ndarray | None) -> float | None:
    if profile is None:
        return None
    mask = (OCTAVE_CENTRES >= 1000) & np.isfinite(profile) & (profile > -60)
    if np.count_nonzero(mask) < 3:
        return None
    return float(np.polyfit(np.log2(OCTAVE_CENTRES[mask]), profile[mask], 1)[0])


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


def _samples_for_role(
        samples: list[ConstructionSample],
        role: str,
        ) -> list[ConstructionSample]:
    """Filter explicit role evidence while preserving legacy campaigns."""
    return [
        sample for sample in samples
        if sample.roles is None or role in sample.roles
    ]


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
        "violin": "bow", "cello": "bow", "piano": "strike", "guitar": "pluck",
        "harp": "pluck", "glockenspiel": "strike", "flute": "blow",
        "clarinet": "blow", "alto-sax": "blow", "tenor-sax": "blow",
        "trumpet": "blow", "french-horn": "blow", "soprano": "blow",
        "mezzo-soprano": "blow", "tenor": "blow", "bass": "blow",
        "basso-profondo": "blow", "boy-soprano": "blow",
    }.get(instrument)
    expected_resonator = {
        "violin": "string", "cello": "string", "piano": "string", "guitar": "string",
        "harp": "string", "glockenspiel": "bar", "flute": "openTube",
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
    firewall = sung_family_firewall(name, params)
    if firewall["applicable"]:
        rows.append(_result(
            f"{name}.family-firewall",
            "Sung fitted state is isolated from non-sung families",
            firewall["passed"], firewall["violations"],
            "only vocal/sung presets, priors, candidate tables, and objective rows",
            strict_evidence=True,
        ))

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
    # L18 impulse-driven families free-decay after strike/pluck. Requiring a
    # sustained classification for harp or bars reverses the owner law and
    # incorrectly makes a physical transient a construction failure.
    if name in {"piano", "piano-upright", "guitar", "harp", "glockenspiel"}:
        rows.append(_result(f"{name}.impulsive-envelope", "Excitation produces a decaying, impulsive note",
                            None if percussive_fraction is None else percussive_fraction >= .67,
                            percussive_fraction, "at least 2/3 of notes classified percussive", strict_evidence=strict_evidence))
        hold_rows = [
            {"register": sample.register, "dynamic": sample.dynamic,
             "slopeDbPerSecond": sample.render.hold_decay_db_per_s,
             "plateauFraction": sample.render.hold_plateau_fraction}
            for sample in sample_list
            if sample.render.hold_decay_db_per_s is not None and
            sample.render.hold_plateau_fraction is not None
        ]
        hold_pass = None if not hold_rows else all(
            float(row["slopeDbPerSecond"]) <= -.30 and
            float(row["plateauFraction"]) < .50
            for row in hold_rows)
        rows.append(_result(
            f"{name}.free-decay-no-plateau",
            "Held strike/pluck notes decay freely until damping on release (L18)",
            hold_pass, hold_rows,
            "every rendered hold: slope <= -0.30 dB/s and plateau fraction < 0.50",
            strict_evidence=strict_evidence))
        components = _param(params, "preOnsetComponents")
        components = components if isinstance(components, list) else []
        pinned = [component for component in components
                  if isinstance(component, dict) and
                  component.get("profilePinned") is True]
        if pinned:
            leads = [float(sample.render.noise_lead_ms) for sample in sample_list
                     if sample.render.noise_lead_ms is not None]
            lead = float(np.median(leads)) if leads else None
            component_rows = []
            schema_ok = True
            for component in pinned:
                envelope = component.get("envelope")
                points = envelope.get("points") if isinstance(envelope, dict) else None
                fitted_points = [point for point in points
                                 if isinstance(point, dict) and
                                 isinstance(point.get("timeMs"), (int, float)) and
                                 isinstance(point.get("gainDb"), (int, float))] \
                    if isinstance(points, list) else []
                gains = [float(point["gainDb"]) for point in fitted_points]
                peak_index = int(np.argmax(gains)) if gains else 0
                transient_shape = (len(gains) >= 3 and max(gains) - min(gains) >= 12 and
                                   any(gain <= gains[peak_index] - 12
                                       for gain in gains[peak_index + 1:]))
                own_envelope = (isinstance(envelope, dict) and
                                envelope.get("independentOfHarmonicEnvelope") is True and
                                isinstance(points, list) and
                                len(fitted_points) == len(points) and
                                any(float(point["timeMs"]) < 0 for point in fitted_points) and
                                transient_shape)
                active = float(component.get("level", 0) or 0) > 0
                schema_ok &= own_envelope and active
                component_rows.append({"component": component.get("component"),
                                       "activeLevel": component.get("level"),
                                       "ownEnvelope": own_envelope})
            rows.append(_result(
                f"{name}.pre-onset-component-active",
                "Every pinned pre-onset component is audible with its own fitted envelope (L17)",
                schema_ok and lead is not None and lead >= 3,
                {"components": component_rows, "renderNoiseLeadMs": lead},
                "pinned component level > 0, independent fitted envelope, and rendered median noise lead >= 3 ms",
                strict_evidence=strict_evidence))
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

    if name == "flute":
        breath = _param(params, "toneBreath")
        turbulence = _param(params, "breathTurbulence")
        rows.append(_result("flute.air-jet-breath-law",
                            "An air-jet instrument carries fitted breath and turbulence",
                            None if breath is None or turbulence is None else
                            float(breath) > 0 and float(turbulence) > 0,
                            {"toneBreath": breath, "breathTurbulence": turbulence},
                            "toneBreath > 0 and breathTurbulence > 0",
                            strict_evidence=strict_evidence))
        stability_info = params.get("bodyStability") \
            if isinstance(params.get("bodyStability"), dict) else {}
        flute_bands = params.get("bodyBands") \
            if isinstance(params.get("bodyBands"), list) else []
        if len(flute_bands) >= 3:
            corr = stability_info.get("splitHalfCorr")
            peak_a = stability_info.get("peakHzA")
            peak_b = stability_info.get("peakHzB")
            stable = (isinstance(corr, (int, float)) and corr >= .8 and
                      isinstance(peak_a, (int, float)) and
                      isinstance(peak_b, (int, float)) and
                      abs(math.log2(peak_a / peak_b)) <= 1 / 3)
            rows.append(_result("flute.body-stability",
                                "A non-minimal air-jet body clears the T-016 stability gate",
                                stable, stability_info,
                                "splitHalfCorr >= 0.80 and |log2(peakA/peakB)| <= 1/3",
                                strict_evidence=strict_evidence))
        else:
            rows.append(_result("flute.body-stability",
                                "Body omission is evidence-backed, not accidental",
                                stability_info.get("omittedReason") == "unstable-air-jet-body"
                                if not flute_bands else None,
                                stability_info.get("omittedReason"),
                                "empty bodyBands must carry omittedReason 'unstable-air-jet-body'",
                                strict_evidence=strict_evidence))

    if FAMILY.get(name) == "blown":
        balance_rows = []
        for sample in sample_list:
            if sample.reference is None:
                continue
            distance = band_balance_report(sample.reference, sample.render)
            balance_rows.append({"register": sample.register, "dynamic": sample.dynamic,
                                 **distance})
        measured_balance = [row for row in balance_rows if row["status"] == "measured"]
        balance_pass = None if not measured_balance or len(measured_balance) != len(sample_list) else all(
            row["meanDb"] <= sample.band_mean_limit_db and
            row["maxOctaveDb"] <= sample.band_max_octave_limit_db
            for row, sample in zip(balance_rows, sample_list))
        for row, sample in zip(balance_rows, sample_list):
            row["meanLimitDb"] = sample.band_mean_limit_db
            row["maxOctaveLimitDb"] = sample.band_max_octave_limit_db
        rows.append(_result(
            f"{name}.band-balance", "Sustained broad-band balance matches paired references",
            balance_pass, balance_rows,
            "every register/dynamic pair: mean <= 3 dB and max octave <= 6 dB (or measured take floor)",
            strict_evidence=strict_evidence))

        soft_samples = _dynamic_subset(sample_list, soft=True)
        loud_samples = _dynamic_subset(sample_list, soft=False)
        soft_profile = _median_octave_profile(soft_samples)
        loud_profile = _median_octave_profile(loud_samples)
        all_profile = _median_octave_profile(sample_list)
        peak = lambda profile: None if profile is None else float(
            OCTAVE_CENTRES[int(np.nanargmax(profile))])

        if name in {"alto-sax", "tenor-sax"}:
            expected_peak = 500.0
            drop_required = 12.0 if name == "alto-sax" else 15.0
            peak_band = peak(all_profile)
            index_500 = int(np.argmin(np.abs(OCTAVE_CENTRES - 500)))
            index_2k = int(np.argmin(np.abs(OCTAVE_CENTRES - 2000)))
            drop = None if all_profile is None else float(all_profile[index_500] - all_profile[index_2k])
            rows.append(_result(
                f"{name}.envelope-peak", "Published saxophone envelope anchors the sustained mid-band",
                None if peak_band is None or drop is None else peak_band == expected_peak and drop >= drop_required,
                {"peakHz": peak_band, "drop500To2kDb": drop},
                f"peak octave = 500 Hz and 2 kHz at least {drop_required:g} dB below it",
                strict_evidence=strict_evidence))

        if name == "clarinet":
            soft_third = [np.asarray(sample.render.band_balance_db, dtype=float)
                          for sample in soft_samples
                          if sample.render.band_balance_db is not None]
            below_fraction = None
            if soft_third:
                profile = np.median(np.stack(soft_third), axis=0)
                power = np.power(10.0, profile / 10)
                below_fraction = float(np.sum(power[THIRD_OCTAVE_CENTRES < 1500]) /
                                       max(np.sum(power), 1e-12))
            low_samples = registers.get("low", []) or registers.get("chalumeau", [])
            low_soft = _dynamic_subset(low_samples, soft=True)
            low_loud = _dynamic_subset(low_samples, soft=False)
            centroid = lambda items: float(np.median([
                np.mean(item.render.centroid_hz) for item in items])) if items else None
            soft_centroid, loud_centroid = centroid(low_soft), centroid(low_loud)
            centroid_ratio = None if not soft_centroid or loud_centroid is None else loud_centroid / soft_centroid
            rows.append(_result(
                "clarinet.band-concentration", "Clarinet balance follows its tonehole cutoff and dynamics",
                None if below_fraction is None or centroid_ratio is None else
                below_fraction >= .8 and centroid_ratio >= 1.8,
                {"softEnergyBelow1500": below_fraction, "lowRegisterLoudSoftCentroidRatio": centroid_ratio},
                "at piano >= 80% energy below 1.5 kHz; low-register centroid loud/soft >= 1.8",
                strict_evidence=strict_evidence))

        if name == "trumpet":
            loud_peak = peak(loud_profile)
            pp_drops = []
            for sample in soft_samples:
                profile = _band_profile(sample.render)
                if profile is None:
                    continue
                fundamental_index = int(np.argmin(np.abs(np.log2(
                    np.maximum(OCTAVE_CENTRES, 1) / max(sample.render.note.f0, 1)))))
                high = profile[OCTAVE_CENTRES >= 2000]
                if high.size:
                    pp_drops.append(float(profile[fundamental_index] - np.max(high)))
            pp_drop = float(np.median(pp_drops)) if pp_drops else None
            rows.append(_result(
                "trumpet.envelope-peak", "Trumpet formant and pp collapse match published balance",
                None if loud_peak is None or pp_drop is None else
                loud_peak in {1000.0, 2000.0} and pp_drop >= 20,
                {"loudPeakHz": loud_peak, "ppFundamentalToHighDropDb": pp_drop},
                "loud peak octave in 1-2 kHz; pp fundamental band >= 20 dB above bands >= 2 kHz",
                strict_evidence=strict_evidence))

        if name == "french-horn":
            peaks = [_profile_peak(sample.render) for sample in sample_list]
            peaks = [value for value in peaks if value is not None]
            soft_slope, loud_slope = _high_side_slope(soft_profile), _high_side_slope(loud_profile)
            horn_pass = None if not peaks or soft_slope is None or loud_slope is None else (
                all(value in {250.0, 500.0} for value in peaks) and
                -25 <= soft_slope <= -6 and -25 <= loud_slope <= -6 and
                loud_slope > soft_slope)
            rows.append(_result(
                "french-horn.envelope-peak", "Horn warmth peak and high-side slope follow dynamics",
                horn_pass, {"peakHz": peaks, "softSlopeDbOct": soft_slope,
                            "loudSlopeDbOct": loud_slope},
                "peak octave contains 340 Hz; high slope -25..-6 dB/oct and shallower when loud",
                strict_evidence=strict_evidence))

        if name == "flute":
            soft_peak, loud_peak = peak(soft_profile), peak(loud_profile)
            rows.append(_result(
                "flute.envelope-peak", "Flute broad envelope follows the measured air-jet formant",
                None if soft_peak is None or loud_peak is None else
                soft_peak <= 500 and loud_peak in {500.0, 1000.0},
                {"softPeakHz": soft_peak, "loudPeakHz": loud_peak},
                "soft peak <= 500 Hz; loud peak octave in 500-1000 Hz",
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

    if name in {"alto-sax", "tenor-sax", "clarinet", "french-horn"}:
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

    if name in {"alto-sax", "tenor-sax", "trumpet", "french-horn"}:
        contrast = float(np.mean([_odd_even_contrast(s.render) for s in sample_list])) if sample_list else None
        rows.append(_result(f"{name}.full-series", "Full harmonic series retains even modes",
                            None if contrast is None else contrast >= -12, contrast,
                            "even partials no more than 12 dB below odd neighbours", strict_evidence=strict_evidence))
        blare = _param(params, "dynamicBlare")
        rows.append(_result(f"{name}.blare-law", "Nonlinear forte enrichment is explicitly enabled",
                            None if blare is None else float(blare) > 0, blare, "dynamicBlare > 0",
                            strict_evidence=strict_evidence))
        if name == "trumpet":
            # T-011 consuming-side assertion (L9): the fitted articulation
            # slope is positive AND the rendered loud-minus-soft onset
            # transient direction matches this instrument's own references.
            slope = _param(params, "articulationVelocitySlope")

            def _onset_level(bundle):
                noise_fit = bundle.note.attack_noise or {}
                return float(noise_fit.get("level", 0) or 0)

            def _direction(pick):
                soft = [_onset_level(pick(s)) for s in sample_list
                        if (_dynamic_value(s) or .5) <= .35 and pick(s)]
                loud = [_onset_level(pick(s)) for s in sample_list
                        if (_dynamic_value(s) or .5) >= .7 and pick(s)]
                if not soft or not loud:
                    return None
                return float(np.median(loud) - np.median(soft))

            ref_direction = _direction(lambda s: s.reference)
            render_direction = _direction(lambda s: s.render)
            direction_match = None
            if ref_direction is not None and render_direction is not None:
                direction_match = (ref_direction * render_direction >= 0)
            passed = None if slope is None or direction_match is None else (
                float(slope) > 0 and direction_match)
            rows.append(_result("trumpet.dynamic-articulation",
                                "Forte onsets are more firmly articulated, matching the references (L9/T-011)",
                                passed,
                                {"slope": slope, "refDirection": ref_direction,
                                 "renderDirection": render_direction},
                                "articulationVelocitySlope > 0 and rendered loud-minus-soft onset direction matches references",
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
        if name in {"alto-sax", "tenor-sax", "trumpet", "french-horn"}:
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
        spectral_samples = _samples_for_role(sample_list, "spectral")
        onset_samples = _samples_for_role(sample_list, "onset")
        vibrato_samples = _samples_for_role(sample_list, "vibrato")
        b_values = [s.render.note.B for s in spectral_samples
                    if s.render.note.B is not None]
        b_max = max(b_values) if b_values else None
        rows.append(_result(f"{name}.near-harmonic-string", "Bowed-string modes remain near harmonic",
                            None if b_max is None else 0 <= b_max <= .003, b_max, "0 <= measured B <= 0.003",
                            strict_evidence=strict_evidence))
        low_hz, high_hz = ((2000, 3200) if name == "violin" else (180, 700))
        prominences = [_band_prominence(s.render, low_hz, high_hz)
                       for s in spectral_samples]
        prominences = [x for x in prominences if np.isfinite(x)]
        median = float(np.median(prominences)) if prominences else None
        rows.append(_result(f"{name}.fixed-body-region", "A fixed-Hz body/bridge region survives pitch changes",
                            None if median is None else median >= -6, median,
                            f"median {low_hz}-{high_hz} Hz prominence >= -6 dB vs flanks", strict_evidence=strict_evidence))
        # RESEARCH_BOWED_REALISM 7b: `dynamic-tilt` SUPERSEDES the weak
        # one-sided `bow-force-edge` bound (slope >= -0.05 accepted a
        # spectrally static render — the baseline failure mode).  Bow force
        # is THE brightness control (C3): the same-register centroid proxy
        # must rise by 1.2-3.0x from the soft to the loud takes.
        tilt_lo = 1.25 if name == "violin" else 1.2
        ratios = []
        for register_samples in _register_groups(spectral_samples).values():
            by_level = [(_dynamic_value(s), _spectral_index(s.render))
                        for s in register_samples
                        if _dynamic_value(s) is not None]
            soft = [v for level, v in by_level if level is not None and level <= .35]
            loud = [v for level, v in by_level if level is not None and level >= .7]
            if soft and loud and np.isfinite(np.mean(soft)) and np.mean(soft) > 0:
                ratios.append(float(np.mean(loud) / np.mean(soft)))
        tilt_ratio = float(np.median(ratios)) if ratios else None
        rows.append(_result(f"{name}.dynamic-tilt",
                            "Loud bowing brightens the spectrum like bow force does (C2/C3)",
                            None if tilt_ratio is None else tilt_lo <= tilt_ratio <= 3.0,
                            {"ratio": tilt_ratio, "registers": len(ratios)},
                            f"same-register loud/soft partial-index ratio in [{tilt_lo}, 3.0]",
                            strict_evidence=strict_evidence))

        # C5/C9 body-peak clusters: the fitted body must carry the signature
        # low modes, not merely any three bands (values are bowed-instrument
        # constants from the literature; cello Hz are [single-source] and
        # re-measured against the corpus fit before freezing).
        cluster_ranges = ((250, 310), (420, 600)) if name == "violin" else \
            ((88, 112), (160, 235))
        bands = _param(params, "bodyBands")
        band_rows = [row for row in bands if isinstance(row, dict)] \
            if isinstance(bands, list) else []
        cluster_hits = [
            any(lo <= float(row.get("freq", 0)) <= hi and
                float(row.get("gain", 0)) > 0 for row in band_rows)
            for lo, hi in cluster_ranges]
        rows.append(_result(f"{name}.body-peak-cluster",
                            "Fitted body carries the signature low-mode clusters",
                            None if not band_rows else all(cluster_hits),
                            {"ranges": cluster_ranges, "hits": cluster_hits},
                            "positive-gain fitted band in each signature range",
                            strict_evidence=strict_evidence))

        if name == "cello":
            # C9: the two radiated mid "hills" — the 180-700 Hz gate alone
            # leaves renders woolly
            for label, lo_hz, hi_hz in (("mid-hill-1k", 800, 1200),
                                        ("mid-hill-2k", 1800, 2500)):
                prominences = [_band_prominence(s.render, lo_hz, hi_hz)
                               for s in spectral_samples]
                prominences = [x for x in prominences if np.isfinite(x)]
                median = float(np.median(prominences)) if prominences else None
                rows.append(_result(f"cello.{label}",
                                    "Radiated mid hill survives pitch changes (C9)",
                                    None if median is None else median >= -6,
                                    median, f"median {lo_hz}-{hi_hz} Hz prominence >= -6 dB",
                                    strict_evidence=strict_evidence))

        # C7 radiated rolloff: 3-8 kHz sustained LTAS slope at mf-ish takes
        rolloff_lo, rolloff_hi = (-19, -11) if name == "violin" else (-20, -10)
        slopes = [s.render.ltas_rolloff_db_oct for s in spectral_samples
                  if getattr(s.render, "ltas_rolloff_db_oct", None) is not None]
        slope_med = float(np.median(slopes)) if slopes else None
        rows.append(_result(f"{name}.radiated-rolloff",
                            "Rendered LTAS above 3 kHz falls like a radiated string (C7)",
                            None if slope_med is None else rolloff_lo <= slope_med <= rolloff_hi,
                            slope_med, f"{rolloff_lo} <= dB/oct <= {rolloff_hi}",
                            strict_evidence=strict_evidence))

        # C18 onset lock-in: stable harmonic regime within 18 nominal periods
        lockins = [s.render.onset_lockin_periods for s in onset_samples
                   if getattr(s.render, "onset_lockin_periods", None) is not None]
        lockin_med = float(np.median(lockins)) if lockins else None
        rows.append(_result(f"{name}.onset-lockin",
                            "Onset reaches the harmonic regime within the G&A acceptance window",
                            None if lockin_med is None else lockin_med <= 18,
                            lockin_med, "median onset lock-in <= 18 nominal periods",
                            strict_evidence=strict_evidence))

        # C15/C16 pp noise rise: bow noise ratio grows toward soft dynamics
        # (sign gate only; values are corpus-fitted per C16)
        soft_nhr = [s.render.sustain_noise_db for s in spectral_samples
                    if (_dynamic_value(s) or .5) <= .35]
        loud_nhr = [s.render.sustain_noise_db for s in spectral_samples
                    if (_dynamic_value(s) or .5) >= .7]
        nhr_rise = (float(np.median(soft_nhr)) - float(np.median(loud_nhr))) \
            if soft_nhr and loud_nhr else None
        rows.append(_result(f"{name}.pp-noise-rise",
                            "Sustained noise-to-harmonic ratio rises toward soft dynamics (C15)",
                            None if nhr_rise is None else nhr_rise >= 2,
                            nhr_rise, "NHR(pp) - NHR(f) >= +2 dB (provisional until corpus-fitted)",
                            strict_evidence=strict_evidence))

        # C28/C29 vibrato body-AM: the FM->AM mechanism must be audible on a
        # vibrato render (depth >= 10 cents); a set with no vibrato render
        # reports not-applicable, which strict campaigns must cover
        am_values = [
            float((s.render.note.vibrato or {}).get("bodyAmDepthDb", 0) or 0)
            for s in vibrato_samples
            if (s.render.note.vibrato or {}).get("present")
            and float((s.render.note.vibrato or {}).get("depth", 0) or 0) >= 10]
        am_med = float(np.median(am_values)) if am_values else None
        rows.append(_result(f"{name}.vibrato-body-am",
                            "Vibrato produces body-coupled per-partial AM (C28)",
                            None if am_med is None else am_med >= 3,
                            am_med, "median tracked-partial AM at vibrato rate >= 3 dB",
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

    if name in SUNG_SECTION_TYPES:
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
        singer = _param(params, "singerFormantAmount")
        rows.append(_result(f"{name}.singer-formant-law", "Singer-formant body control is explicitly fitted",
                            None if singer is None else float(singer) >= 0, singer, "singerFormantAmount fitted (zero allowed)",
                            strict_evidence=strict_evidence))
        sync = _param(params, "voiceBreathSync")
        reference_sync = [float(s.reference.pitch_sync_breath_db)
                          for s in sample_list if s.reference and
                          s.reference.pitch_sync_breath_db is not None and
                          np.isfinite(s.reference.pitch_sync_breath_db)]
        rendered_sync = [float(s.render.pitch_sync_breath_db)
                         for s in sample_list
                         if s.render.pitch_sync_breath_db is not None and
                         np.isfinite(s.render.pitch_sync_breath_db)]
        reference_median = (float(np.median(reference_sync))
                            if reference_sync else None)
        rendered_median = (float(np.median(rendered_sync))
                           if rendered_sync else None)
        needs_sync = reference_median is not None and reference_median >= 6
        breath_consumed = (
            sync is not None and reference_median is not None and
            rendered_median is not None and
            ((float(sync) > 0 and rendered_median >= 6)
             if needs_sync else float(sync) >= 0)
        )
        rows.append(_result(f"{name}.pitch-sync-breath", "Breath component is pitch-synchronous rather than a static bed",
                            breath_consumed,
                            {"voiceBreathSync": sync,
                             "referencePitchSyncBreathDb": reference_median,
                             "renderPitchSyncBreathDb": rendered_median,
                             "observable": "pitch_sync_breath_db"},
                            "rendered pitch_sync_breath_db >= 6 dB and voiceBreathSync > 0 when lossless reference prominence >= 6 dB; measured zero otherwise allowed",
                            strict_evidence=strict_evidence))
        if name in {"tenor", "bass"}:
            low, high = ((2700, 3300) if name == "tenor" else (2300, 2600))
            prominence = [_band_prominence(s.render, low, high) for s in sample_list]
            prominence = [x for x in prominence if np.isfinite(x)]
            median = float(np.median(prominence)) if prominence else None
            rows.append(_result(f"{name}.singer-formant-band", "Carrying voice has its class-specific fixed-Hz cluster",
                                None if median is None else median >= -6, median,
                                f"{low/1000:.1f}-{high/1000:.1f} kHz prominence >= -6 dB vs flanks",
                                strict_evidence=strict_evidence))

    if name in SUNG_DERIVED_PRESETS:
        expected_parent = SUNG_DERIVED_PRESETS[name]
        morphology_key = "boyMorphology" if name == "boy-soprano" else "bassoMorphology"
        morphology = params.get(morphology_key) if isinstance(
            params.get(morphology_key), dict) else {}
        declared_parent = params.get("derivedFrom") or morphology.get("sourcePreset")
        rows.append(_result(
            f"{name}.derived-parent", "Derived preset names its frozen fitted parent",
            None if declared_parent is None else expected_parent in str(declared_parent).lower(),
            declared_parent, f"derived from frozen fitted {expected_parent} preset",
            strict_evidence=strict_evidence))
        transform = morphology.get("transform") or params.get("morphologyTransform")
        rows.append(_result(
            f"{name}.derived-transform", "Derived preset carries a frozen morphology transform",
            None if transform is None else bool(transform), transform,
            "non-empty morphology derivation recipe; no quantitative fitted-target claim",
            strict_evidence=strict_evidence))
        if name == "boy-soprano":
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
                                "boyMorphology.tractScale in [0.75, 0.90]", strict_evidence=strict_evidence))
            rows.append(_result("boy-soprano.formant-scaling", "Scaled formants implement the declared tract morphology",
                                scale_consistent, observed_ratios,
                                "at least 3 scaled/base formants within 12% of 1/tractScale and applied as bodyBands",
                                strict_evidence=strict_evidence))

    failed = [row for row in rows if row["status"] == "fail"]
    missing = [row for row in rows if row["status"] == "not-applicable"]
    return {
        "checklistVersion": 3,
        "instrument": name,
        "family": FAMILY.get(name),
        "targetClass": ("fitted-section" if name in SUNG_SECTION_TYPES else
                        "derived-preset" if name in SUNG_DERIVED_PRESETS else
                        "fitted-instrument"),
        "passed": not failed and (not strict_evidence or not missing),
        "counts": {
            "pass": sum(row["status"] == "pass" for row in rows),
            "fail": len(failed),
            "notApplicable": len(missing),
        },
        "assertions": rows,
    }


__all__ = ["ConstructionSample", "SUNG_DERIVED_PRESETS", "SUNG_SECTION_TYPES",
           "evaluate_construction", "normalize_instrument"]
