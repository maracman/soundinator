#!/usr/bin/env python3
"""Prepare the first WP-7 grand-piano and nylon-guitar campaigns.

This is deliberately a preflight builder, not a fitter.  It turns the
analysis-only corpus into reproducible matched-note manifests, records the
weak/absent take-pair evidence, and emits §2.4c strongest-prior presets for
the controllability audit.  Audio remains under the durable SG2 data root.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from scripts.fit_profiles_from_samples import (
    analyse_note,
    guitar_course_for_midi,
    load_mono,
    segment_notes,
    sf,
)
from scripts.tone_match.paths import sg2_data_root
from scripts.tone_match.legacy_prior import resolve_legacy_prior
from scripts.tone_match.tail_audit import audit_references


VELOCITY = {"pp": 0.2, "p": 0.28, "f": 0.82, "ff": 0.92}

# Piano uses five anchors because its measured B changes strongly across the
# keyboard (STRUCK_PLUCKED_PREFLIGHT S3).  The guitar set stays source-matched
# at three registers and two dynamics; Iowa chromatic runs remain proxy-only
# humanisation material rather than being mixed into the Philharmonia loss.
CAMPAIGNS: dict[str, dict[str, Any]] = {
    "grand-piano": {
        "instrument": "grand-piano",
        "corpus": "piano",
        "profile": "piano",
        "excitation": "strike",
        "anchors": [
            {"register": "bass", "midi": 24, "pp": "Piano.pp.C1.aiff", "ff": "Piano.ff.C1.aiff"},
            {"register": "low-mid", "midi": 36, "pp": "Piano.pp.C2.aiff", "ff": "Piano.ff.C2.aiff"},
            {"register": "mid", "midi": 60, "pp": "Piano.pp.C4.aiff", "ff": "Piano.ff.C4.aiff"},
            {"register": "treble", "midi": 84, "pp": "Piano.pp.C6.aiff", "ff": "Piano.ff.C6.aiff"},
            {"register": "top", "midi": 108, "pp": "Piano.pp.C8.aiff", "ff": "Piano.ff.C8.aiff"},
        ],
        "dynamics": ("pp", "ff"),
        "source": "Iowa MIS",
    },
    "guitar-nylon": {
        "instrument": "guitar-nylon",
        "corpus": "guitar",
        "profile": "guitar",
        "excitation": "pluck",
        "anchors": [
            {"register": "low", "midi": 40,
             "string": "string6",
             "p": "phil.guitar_E2_very-long_piano_normal.mp3",
             "f": "phil.guitar_E2_very-long_forte_normal.mp3"},
            {"register": "mid", "midi": 55,
             "string": "string3",
             "p": "phil.guitar_G3_very-long_piano_normal.mp3",
             "f": "phil.guitar_G3_very-long_forte_normal.mp3"},
            {"register": "high", "midi": 76,
             "string": "string1",
             "p": "phil.guitar_E5_very-long_piano_normal.mp3",
             "f": "phil.guitar_E5_very-long_forte_normal.mp3"},
        ],
        "dynamics": ("p", "f"),
        "source": "Philharmonia classical guitar",
    },
}


def midi_of(f0: float) -> int:
    return int(round(69 + 12 * math.log2(f0 / 440.0)))


def _filename_declares_single_note(path: Path) -> bool:
    return path.name.startswith("Piano.") or path.name.startswith("phil.guitar_")


def select_note(path: Path, target_midi: int) -> tuple[np.ndarray, int, float, dict[str, Any]]:
    """Select the analysed segment nearest ``target_midi`` from a source."""
    samples, sample_rate = load_mono(str(path))
    candidates = []
    raw_segments = list(segment_notes(samples, sample_rate, merge_gap_s=0.12))
    for start, end in raw_segments:
        segment = samples[start:end]
        note = analyse_note(segment, sample_rate, str(path), 24)
        if note is not None:
            candidates.append((abs(midi_of(note.f0) - target_midi), segment, note.f0))
    if not candidates:
        if _filename_declares_single_note(path):
            start, end = max(raw_segments, key=lambda span: span[1] - span[0]) \
                if raw_segments else (0, len(samples))
            nominal = 440.0 * 2 ** ((target_midi - 69) / 12)
            return samples[start:end], sample_rate, nominal, {
                "method": "filename-nominal-no-f0-track",
                "rawDetectedF0": None,
            }
        raise RuntimeError(f"no analysable note in {path}")
    distance, segment, f0 = min(candidates, key=lambda row: row[0])
    if _filename_declares_single_note(path):
        nominal = 440.0 * 2 ** ((target_midi - 69) / 12)
        return segment, sample_rate, nominal, {
            "method": "filename-nominal-anchor",
            "rawDetectedF0": round(float(f0), 3),
            "rawDetectedMidi": midi_of(f0),
        }
    if distance > 1:
        raise RuntimeError(
            f"{path}: closest detected MIDI {midi_of(f0)} is not target {target_midi}"
        )
    return segment, sample_rate, f0, {"method": "analysed-f0"}


def write_reference(source: Path, target_midi: int, target: Path) -> tuple[int, float, float, dict[str, Any]]:
    segment, sample_rate, f0, pitch_evidence = select_note(source, target_midi)
    peak = float(np.max(np.abs(segment)))
    if peak > 0.99:
        segment = segment * (0.99 / peak)
    sf.write(target, segment, sample_rate, subtype="PCM_16")
    duration = len(segment) / sample_rate
    # The renderer includes its own release tail.  Fit the active decay, not
    # source-file trailing silence, and retain longer piano tails than winds.
    render_duration = max(0.6, min(3.0, duration * 0.78))
    return midi_of(f0), f0, render_duration, pitch_evidence


def seed_preset(spec: dict[str, Any], measured: dict[str, Any], *,
                mode: str = "fit", repo_root: Path | None = None) -> dict[str, Any]:
    """Overlay measured identity on the table-selected immutable craft prior."""
    profile = measured[spec["profile"]]
    performance = profile.get("performance") or {}
    attack = performance.get("attackNoise") or {}
    attack_registers = (profile.get("attack") or {}).get("byRegister") or []
    topology = {
        "seed": 7331,
        "sg2Family": "struck-plucked",
        "voiceMode": "fourier",
        "spectralProfile": spec["profile"],
        "spectralMix": 1.0,
        "spectralPartials": 64,
        "excitationType": spec["excitation"],
        "resonatorClass": "string",
        "bodyType": "auto",
    }
    seed, provenance = resolve_legacy_prior(
        spec["instrument"], topology, mode=mode,
        repo_root=repo_root or Path(__file__).resolve().parents[2])
    measured_identity: dict[str, Any] = {
        # The measured profile owns the transient shape; this control is its
        # unity gain, not a replacement hand value.
        "attackNoiseLevel": 1.0,
        "vibratoProb": 0,
        "toneBreath": 0.0,
        "partialTilt": 0.0,
        "spectralResonanceAmount": 1.0,
        "spectralDynamicAmount": 1.0,
        # Neutral until the family audit/fitting supplies values.  The audit
        # activates conditional contexts without smuggling fitted values in.
        "velocityHardnessCoupling": 0.0,
        "decaySecondStage": 0.0,
        "decaySecondRatio": 1.0,
    }
    material = (profile.get("material") or {}).get("suggestedMaterial")
    if material is not None:
        measured_identity["partialMaterial"] = material
    for target, source in (
        ("attackNoiseFreq", "freq"), ("attackNoiseQ", "q"),
        ("attackNoiseDecay", "decay"),
    ):
        if attack.get(source) is not None:
            measured_identity[target] = attack[source]
    for key in ("envelopeAttack", "envelopeDecay", "envelopeSustain",
                "envelopeRelease"):
        if performance.get(key) is not None:
            measured_identity[key] = performance[key]
    seed.update(measured_identity)
    resonances = profile.get("resonances") or []
    if len(resonances) >= 3:
        seed["bodyBands"] = resonances
    if attack_registers:
        seed["envelopeAttackByRegister"] = [
            {"f0": row["f0"], "attack": row["envelopeAttack"]}
            for row in attack_registers
            if row.get("f0") is not None and row.get("envelopeAttack") is not None
        ]
    # T-007 consuming side: G1 profiles with anchors must not be shadowed by
    # one scalar B.  Legacy/sparse profiles retain the scalar fallback.
    if profile.get("partialsByRegister"):
        seed.pop("partialB", None)
    else:
        seed["partialB"] = profile.get("partialB", 0)
    seed["_sg2Mode"] = mode
    seed["_sg2Prior"] = provenance
    return {key: value for key, value in seed.items() if value is not None}


def rebase_fitted_preset(fitted: dict[str, Any],
                         refreshed_seed: dict[str, Any]) -> dict[str, Any]:
    """Carry fitted controls while refreshing profile-derived structural data."""
    params = fitted.get("params") if isinstance(fitted.get("params"), dict) else fitted
    if not isinstance(params, dict):
        raise ValueError("fitted preset must be a parameter object or contain params")
    rebased = dict(params)
    # These anchors are generated from measured-profile pitch evidence and are
    # not optimizer-owned. Keeping an old copy after a profile correction
    # silently reintroduces the superseded register model.
    for key in ("envelopeAttackByRegister",):
        if key in refreshed_seed:
            rebased[key] = refreshed_seed[key]
        else:
            rebased.pop(key, None)
    return rebased


def _take_pairs(instrument: str, corpus: Path) -> dict[str, Any]:
    if instrument == "guitar-nylon":
        proxies = [
            {"file": path.name,
             "method": "same-string/same-dynamic adjacent semitones with register trend removed"}
            for path in sorted(corpus.glob("Guitar.*.aif"))
        ]
        reason = "No true repeated take at the same pitch/dynamic; Iowa chromatic runs are proxy evidence."
    else:
        proxies = [
            {"files": [f"Piano.{dynamic}.C{octave}.aiff", f"Piano.{dynamic}.C{octave + 1}.aiff"],
             "method": "adjacent-register proxy only; remove keyboard trend before use"}
            for dynamic in ("pp", "mf", "ff") for octave in range(1, 8)
        ]
        reason = "No true repeated take at the same pitch/dynamic in the delivered Iowa set."
    return {"trueDuplicates": [], "proxyPairs": proxies, "evidence": "proxy", "reason": reason}


def build(instrument: str, samples_root: Path, measured_path: Path,
          output_root: Path, rebase_state: Path | None = None) -> dict[str, Any]:
    spec = CAMPAIGNS[instrument]
    corpus = samples_root / spec["corpus"]
    coverage = corpus / "COVERAGE.md"
    if not coverage.exists():
        raise RuntimeError(f"coverage contract missing: {coverage}")
    output = output_root / instrument
    notes_dir = output / "references"
    notes_dir.mkdir(parents=True, exist_ok=True)
    references = []
    for anchor in spec["anchors"]:
        for dynamic in spec["dynamics"]:
            source = corpus / anchor[dynamic]
            if not source.exists():
                raise RuntimeError(f"coverage-listed source missing: {source}")
            target = notes_dir / f"{spec['corpus']}-{anchor['register']}-{dynamic}-{anchor['midi']}.wav"
            midi, f0, duration, pitch_evidence = write_reference(source, anchor["midi"], target)
            if midi != anchor["midi"]:
                raise RuntimeError(f"{source}: detected MIDI {midi}, expected {anchor['midi']}")
            references.append({
                "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
                "pitchEvidence": pitch_evidence,
                "velocity": VELOCITY[dynamic], "dynamic": dynamic,
                "register": anchor["register"], "durationSec": duration,
                "articulation": spec["excitation"], "vibrato": "nonvib",
                **({"string": anchor["string"]} if anchor.get("string") else {}),
                "floorGroup": (
                    f"{midi}|{dynamic}|{spec['excitation']}|"
                    f"{anchor.get('string', 'unlabelled')}|{spec['source']}"
                ),
                "sourceClass": spec["source"], "sourceFile": source.name,
            })
            if anchor.get("string") and guitar_course_for_midi(midi) != anchor["string"]:
                raise RuntimeError(
                    f"{source}: declared {anchor['string']} disagrees with "
                    f"T-033 auto course {guitar_course_for_midi(midi)}"
                )
    measured = json.loads(measured_path.read_text())
    initial = seed_preset(spec, measured, mode="fit")
    ship_prior = seed_preset(spec, measured, mode="ship")
    if rebase_state is not None:
        initial = rebase_fitted_preset(
            json.loads(rebase_state.read_text()),
            initial,
        )
    pairs = _take_pairs(instrument, corpus)
    (output / "initial.json").write_text(json.dumps(initial, indent=2) + "\n")
    (output / "ship-prior.json").write_text(json.dumps(ship_prior, indent=2) + "\n")
    (output / "prior.json").write_text(
        json.dumps(ship_prior["_sg2Prior"], indent=2) + "\n")
    references = audit_references(references)
    (output / "references.json").write_text(json.dumps(references, indent=2) + "\n")
    (output / "take-pairs.json").write_text(json.dumps(pairs, indent=2) + "\n")
    summary = {
        "instrument": instrument,
        "corpus": str(corpus),
        "coverageVerified": str(coverage),
        "references": len(references),
        "registers": sorted({row["register"] for row in references}),
        "dynamics": sorted({row["dynamic"] for row in references}),
        "floorGroupsWithAlternates": 0,
        "humanisationEvidence": pairs["evidence"],
        "priorRow": ship_prior["_sg2Prior"]["row"],
        "priorHash": ship_prior["_sg2Prior"]["resolvedHash"],
        "fitModeHuman": initial.get("excitationHuman"),
        "shipModeHuman": ship_prior.get("excitationHuman"),
        "rebasedFrom": str(rebase_state) if rebase_state else None,
        "fittingGate": "blocked-until-P5-and-controllability-clean",
    }
    (output / "BUILD.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", choices=sorted(CAMPAIGNS), action="append")
    data_root = sg2_data_root()
    parser.add_argument("--samples", type=Path, default=data_root / "samples")
    parser.add_argument("--measured", type=Path, default=Path("web/static/measured_profiles.json"))
    parser.add_argument("--output", type=Path, default=data_root / "campaigns")
    parser.add_argument(
        "--rebase-state", type=Path,
        help="carry fitted parameters from a best.json while refreshing "
             "profile-derived structural anchors (single instrument only)",
    )
    args = parser.parse_args(argv)
    instruments = args.instrument or list(CAMPAIGNS)
    if args.rebase_state and len(instruments) != 1:
        parser.error("--rebase-state requires exactly one --instrument")
    summaries = [
        build(name, args.samples, args.measured, args.output, args.rebase_state)
        for name in instruments
    ]
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
