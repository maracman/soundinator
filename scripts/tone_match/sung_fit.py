#!/usr/bin/env python3
"""Fit an interim sung identity from one singer's labelled references."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np

from scripts.tone_match.analysis import analyse_audio_file, note_to_json
from scripts.tone_match.sung_features import (
    SungObservation,
    fit_pooled_source_vowel_bodies,
    vowel_regions_for_class,
)


PROFILE_BY_CLASS = {
    "tenor": "voice-tenor",
    "contrabass": "voice-bass",
    "mezzo-soprano": "voice-mezzo",
}

ADULT_MALE_FORMANT_PRIORS = {
    "a": (768.0, 1333.0, 2522.0, 3687.0, 4500.0),
    "e": (580.0, 1799.0, 2605.0, 3677.0, 4500.0),
    "i": (342.0, 2322.0, 3000.0, 3657.0, 4500.0),
    "o": (497.0, 910.0, 2459.0, 3384.0, 4300.0),
    "u": (378.0, 997.0, 2343.0, 3357.0, 4250.0),
}


def _formants_for_fit(note, vowel: str, voice_class: str) -> tuple[tuple[float, ...], bool]:
    """Use corpus LPC when plausible; otherwise retain a flagged class prior."""

    regions = vowel_regions_for_class(voice_class)
    scale = {"tenor": 1.0, "contrabass": .94, "mezzo-soprano": 1.15}[voice_class]
    prior = tuple(value * scale for value in ADULT_MALE_FORMANT_PRIORS[vowel])
    if len(note.formants) < 5:
        return prior, True
    values = tuple(float(value) for value in note.formants[:5])
    f1_box, f2_box = regions[vowel]
    plausible = (
        f1_box[0] * .8 <= values[0] <= f1_box[1] * 1.2
        and f2_box[0] * .8 <= values[1] <= f2_box[1] * 1.2
        and all(left < right for left, right in zip(values, values[1:]))
    )
    return (values, False) if plausible else (prior, True)


def _median(values, default):
    finite = [float(value) for value in values
              if isinstance(value, (int, float)) and np.isfinite(value)]
    return float(np.median(finite)) if finite else default


def fit_campaign(references_path: Path, output_root: Path) -> dict:
    references = json.loads(references_path.read_text())
    singer_ids = {row.get("singer") for row in references}
    voice_classes = {row.get("voiceClass") for row in references}
    if len(singer_ids) != 1:
        raise ValueError(f"identity fit requires exactly one singer, found {singer_ids}")
    if len(voice_classes) != 1:
        raise ValueError(f"identity fit requires exactly one voice class, found {voice_classes}")
    singer = next(iter(singer_ids))
    voice_class = next(iter(voice_classes))

    spectral_rows = [row for row in references if "spectral" in row.get("roles", [])]
    vibrato_rows = [row for row in references if "vibrato" in row.get("roles", [])]
    observations = []
    analysed = []
    rejected = []
    formant_fallbacks = []
    for row in spectral_rows:
        try:
            note = analyse_audio_file(
                row["path"], n_partials=64,
                expected_f0_hz=row["expectedF0Hz"],
            )
        except (ValueError, RuntimeError) as exc:
            rejected.append({"path": row["path"], "error": str(exc)})
            continue
        formants, used_prior = _formants_for_fit(note, row["vowel"], voice_class)
        bandwidths = (
            tuple(note.formant_bandwidths[:5])
            if not used_prior and len(note.formant_bandwidths) >= 5
            else (80.0, 120.0, 180.0, 220.0, 260.0)
        )
        if used_prior:
            formant_fallbacks.append({
                "path": row["path"],
                "vowel": row["vowel"],
                "reason": "LPC outside class-scaled vowel region; literature prior used as provisional centre",
            })
        amps = np.asarray(note.partial_amps, dtype=float)
        partial_db = 20 * np.log10(np.maximum(amps, 1e-6) / max(float(np.max(amps)), 1e-12))
        partial_db[~np.asarray(note.partial_snr_ok, dtype=bool)] = np.nan
        observations.append(SungObservation(
            vowel=row["vowel"],
            f0_hz=note.f0,
            partial_db=partial_db,
            formants_hz=formants,
            bandwidths_hz=bandwidths,
            register=row["register"],
            dynamic=row["dynamic"],
            source_id=row["sourceFile"],
        ))
        analysed.append({"reference": row, "analysis": note_to_json(note)})

    fit = fit_pooled_source_vowel_bodies(observations)

    vibrato_analyses = []
    for row in vibrato_rows:
        try:
            note = analyse_audio_file(
                row["path"], n_partials=32,
                expected_f0_hz=row["expectedF0Hz"],
            )
        except (ValueError, RuntimeError):
            continue
        if note.vibrato:
            vibrato_analyses.append(note.vibrato)
    present_vibrato = [row for row in vibrato_analyses if row.get("present")]
    vibrato_rate = _median([row.get("rate") for row in present_vibrato], 5.5)
    vibrato_depth = _median([row.get("depth") for row in present_vibrato], 40.0)

    source_amps = [row["amp"] for row in fit["sourcePartials"]]
    base = {
        "seed": 7331,
        "sg2Family": "sung",
        "voiceMode": "fourier",
        "spectralProfile": PROFILE_BY_CLASS[voice_class],
        "spectralMix": 1.0,
        "spectralPartials": len(source_amps),
        "spectralPartialMeans": source_amps,
        "spectralPartialSds": [0.0] * len(source_amps),
        "excitationType": "blow",
        "resonatorClass": "string",
        "partialB": 0.0,
        "bodyType": "auto",
        "spectralResonanceAmount": 1.0,
        "glottalTilt": 0.0,
        "singerFormantAmount": 0.0,
        "voiceBreathSync": 0.0,
        "bodyArticulation": 0.0,
        "excitationHuman": 0.0,
        "toneBreath": 0.0,
        "vibratoProb": 1.0 if present_vibrato else 0.0,
        "vibratoRate": round(vibrato_rate, 4),
        "vibratoDepth": round(vibrato_depth, 4),
        "spectralDynamicAmount": 0.8,
        "partialTransfer": 0.1,
        "partialTilt": 0.0,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    params_by_vowel = {}
    for vowel, body in fit["vowelBodies"].items():
        params = {**base, "bodyBands": body["bands"], "activeVowel": vowel}
        params_by_vowel[vowel] = params
        (output_root / f"initial-{vowel}.json").write_text(
            json.dumps(params, indent=2) + "\n"
        )
    payload = {
        "schemaVersion": 1,
        "voiceClass": voice_class,
        "primarySinger": singer,
        "fit": fit,
        "spectralReferences": len(spectral_rows),
        "analysedReferences": len(analysed),
        "rejectedReferences": rejected,
        "formantFallbacks": formant_fallbacks,
        "vibratoReferences": len(vibrato_rows),
        "vibratoAnalysed": len(vibrato_analyses),
        "baseParams": base,
    }
    (output_root / "SOURCE_VOWEL_FIT.json").write_text(
        json.dumps(payload, indent=2) + "\n"
    )
    (output_root / "ANALYSED_REFERENCES.json").write_text(
        json.dumps(analysed, indent=2) + "\n"
    )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--references", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    payload = fit_campaign(args.references, args.out)
    print(json.dumps({
        "voiceClass": payload["voiceClass"],
        "primarySinger": payload["primarySinger"],
        "spectralReferences": payload["spectralReferences"],
        "analysedReferences": payload["analysedReferences"],
        "rejectedReferences": len(payload["rejectedReferences"]),
        "roundTripMedianAbsDb": payload["fit"]["roundTripMedianAbsDb"],
        "roundTripP95AbsDb": payload["fit"]["roundTripP95AbsDb"],
        "vibratoAnalysed": payload["vibratoAnalysed"],
    }, indent=2))


if __name__ == "__main__":
    main()
