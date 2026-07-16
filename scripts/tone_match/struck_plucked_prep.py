#!/usr/bin/env python3
"""Prepare the first WP-7 grand-piano and nylon-guitar campaigns.

This is deliberately a preflight builder, not a fitter.  It turns the
analysis-only corpus into reproducible matched-note manifests, records the
weak/absent take-pair evidence, and emits neutral family seed presets for the
controllability audit.  Audio remains below ``/private/tmp``.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from scripts.fit_profiles_from_samples import analyse_note, load_mono, segment_notes, sf
from scripts.tone_match.paths import sg2_data_root


VELOCITY = {"pp": 0.2, "p": 0.28, "f": 0.82, "ff": 0.92}

# Piano uses five anchors because its measured B changes strongly across the
# keyboard (STRUCK_PLUCKED_PREFLIGHT S3).  The guitar set stays source-matched
# at three registers and two dynamics; Iowa chromatic runs remain proxy-only
# humanisation material rather than being mixed into the Philharmonia loss.
CAMPAIGNS: dict[str, dict[str, Any]] = {
    "grand-piano": {
        "corpus": "piano",
        "profile": "piano",
        "excitation": "strike",
        "anchors": [
            {"register": "bass", "midi": 24, "pp": "Piano.pp.C1.aiff", "ff": "Piano.ff.C1.aiff"},
            {"register": "low-mid", "midi": 48, "pp": "Piano.pp.C3.aiff", "ff": "Piano.ff.C3.aiff"},
            {"register": "mid", "midi": 72, "pp": "Piano.pp.C5.aiff", "ff": "Piano.ff.C5.aiff"},
            {"register": "treble", "midi": 96, "pp": "Piano.pp.C7.aiff", "ff": "Piano.ff.C7.aiff"},
            {"register": "top", "midi": 108, "pp": "Piano.pp.C8.aiff", "ff": "Piano.ff.C8.aiff"},
        ],
        "dynamics": ("pp", "ff"),
        "source": "Iowa MIS",
    },
    "guitar-nylon": {
        "corpus": "guitar",
        "profile": "guitar",
        "excitation": "pluck",
        "anchors": [
            {"register": "low", "midi": 40,
             "p": "phil.guitar_E2_very-long_piano_normal.mp3",
             "f": "phil.guitar_E2_very-long_forte_normal.mp3"},
            {"register": "mid", "midi": 55,
             "p": "phil.guitar_G3_very-long_piano_normal.mp3",
             "f": "phil.guitar_G3_very-long_forte_normal.mp3"},
            {"register": "high", "midi": 76,
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
    if distance > 1:
        # The lowest piano strings can be dominated by an upper partial.  A
        # one-note source whose filename declares the pitch is still valid
        # reference audio; use the nominal f0 for scheduling and retain the
        # tracker miss as explicit evidence rather than relabelling the take.
        if _filename_declares_single_note(path):
            nominal = 440.0 * 2 ** ((target_midi - 69) / 12)
            return segment, sample_rate, nominal, {
                "method": "filename-nominal-fallback",
                "rawDetectedF0": round(float(f0), 3),
                "rawDetectedMidi": midi_of(f0),
            }
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


def seed_preset(spec: dict[str, Any], measured: dict[str, Any]) -> dict[str, Any]:
    profile = measured[spec["profile"]]
    performance = profile.get("performance") or {}
    attack = performance.get("attackNoise") or {}
    attack_registers = (profile.get("attack") or {}).get("byRegister") or []
    seed: dict[str, Any] = {
        "seed": 7331,
        "sg2Family": "struck-plucked",
        "voiceMode": "fourier",
        "spectralProfile": spec["profile"],
        "spectralMix": 1.0,
        "spectralPartials": 64,
        "excitationType": spec["excitation"],
        "resonatorClass": "string",
        "bodyType": "auto",
        "partialMaterial": (profile.get("material") or {}).get("suggestedMaterial", 0.35),
        "attackNoiseLevel": 1.0,
        "attackNoiseFreq": attack.get("freq"),
        "attackNoiseQ": attack.get("q"),
        "attackNoiseDecay": attack.get("decay"),
        "envelopeAttack": performance.get("envelopeAttack", 0.02),
        "envelopeDecay": performance.get("envelopeDecay", 0.8),
        "envelopeSustain": performance.get("envelopeSustain", 0.15),
        "envelopeRelease": performance.get("envelopeRelease", 0.12),
        "vibratoProb": 0,
        "excitationPosition": 0.13,
        "excitationHardness": 0.6,
        "excitationHuman": 0.0,
        "toneBreath": 0.0,
        "partialTransfer": 0.15,
        "partialTilt": 0.0,
        "spectralResonanceAmount": 1.0,
        "spectralDynamicAmount": 1.0,
        # Neutral until the family audit/fitting supplies values.  The audit
        # activates conditional contexts without smuggling fitted values in.
        "velocityHardnessCoupling": 0.0,
        "decaySecondStage": 0.0,
        "decaySecondRatio": 1.0,
    }
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
    if not profile.get("partialsByRegister"):
        seed["partialB"] = profile.get("partialB", 0)
    return {key: value for key, value in seed.items() if value is not None}


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
          output_root: Path) -> dict[str, Any]:
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
                "floorGroup": f"{midi}|{dynamic}|{spec['excitation']}|{spec['source']}",
                "sourceClass": spec["source"], "sourceFile": source.name,
            })
    measured = json.loads(measured_path.read_text())
    initial = seed_preset(spec, measured)
    pairs = _take_pairs(instrument, corpus)
    (output / "initial.json").write_text(json.dumps(initial, indent=2) + "\n")
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
    args = parser.parse_args(argv)
    instruments = args.instrument or list(CAMPAIGNS)
    summaries = [build(name, args.samples, args.measured, args.output) for name in instruments]
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
