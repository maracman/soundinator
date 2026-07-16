#!/usr/bin/env python3
"""Materialise analysis-only WP-5 note references and pinned seed presets.

Source audio remains under /private/tmp.  Iowa chromatic runs are segmented
into individual notes; already-downloaded Philharmonia notes are used only as
same-pitch/same-dynamic alternate takes for the variability floor.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from scripts.fit_profiles_from_samples import analyse_note, load_mono, segment_notes, sf


VELOCITY = {"pp": 0.2, "ff": 0.92}
RESONATOR = {"flute": "string", "clarinet": "closedTube", "alto-sax": "conicalTube",
             "trumpet": "conicalTube", "french-horn": "conicalTube"}

# Every campaign spans named low/mid/high registers at pp and ff.  Filenames
# identify the run; target MIDI selects one detected segment from that run.
CAMPAIGNS: dict[str, list[dict[str, Any]]] = {
    "flute": [
        {"register": "low", "midi": 60, "pp": "Flute.nonvib.pp.B3B4.aiff", "ff": "Flute.nonvib.ff.B3B4.aiff"},
        {"register": "mid", "midi": 72, "pp": "Flute.nonvib.pp.B4Bb5.aiff", "ff": "Flute.nonvib.ff.C5B5.aiff"},
        {"register": "high", "midi": 84, "pp": "Flute.nonvib.pp.C6Bb6.aiff", "ff": "Flute.nonvib.ff.C6B6.aiff"},
    ],
    "clarinet": [
        {"register": "low", "midi": 54, "pp": "BbClar.pp.D3B3.aiff", "ff": "BbClar.ff.D3B3.aiff"},
        {"register": "mid", "midi": 72, "pp": "BbClar.pp.C5B5.aiff", "ff": "BbClar.ff.C5B5.aiff"},
        {"register": "high", "midi": 84, "pp": "BbClar.pp.C6B6.aiff", "ff": "BbClar.ff.C6B6.aiff"},
    ],
    "alto-sax": [
        {"register": "low", "midi": 51, "pp": "AltoSax.NoVib.pp.Db3B3.aiff", "ff": "AltoSax.NoVib.ff.Db3B3.aiff"},
        {"register": "mid", "midi": 60, "pp": "AltoSax.NoVib.pp.C4B4.aiff", "ff": "AltoSax.NoVib.ff.C4B4.aiff"},
        {"register": "high", "midi": 74, "pp": "AltoSax.NoVib.pp.C5Ab5.aiff", "ff": "AltoSax.NoVib.ff.C5Ab5.aiff"},
    ],
    "trumpet": [
        {"register": "low", "midi": 52, "pp": "Trumpet.novib.pp.E3B3.aiff", "ff": "Trumpet.novib.ff.E3B3.aiff"},
        {"register": "mid", "midi": 60, "pp": "Trumpet.novib.pp.C4B4.aiff", "ff": "Trumpet.novib.ff.C4B4.aiff"},
        {"register": "high", "midi": 72, "pp": "Trumpet.novib.pp.C5B5.aiff", "ff": "Trumpet.novib.ff.C5B5.aiff"},
    ],
    "french-horn": [
        {"register": "low", "midi": 35, "pp": "Horn.pp.Bb1B1.aiff", "ff": "Horn.ff.Bb1B1.aiff"},
        {"register": "mid", "midi": 60, "pp": "Horn.pp.C4B4.aiff", "ff": "Horn.ff.C4B4.aiff"},
        {"register": "high", "midi": 72, "pp": "Horn.pp.C5F5.aiff", "ff": "Horn.ff.C5F5.aiff"},
    ],
}

PHILHARMONIA_ALTERNATES = {
    "trumpet": [
        {"register": "high", "midi": 72, "dynamic": "pp", "file": "trumpet_C5_15_pianissimo_normal.mp3"},
        {"register": "high", "midi": 72, "dynamic": "ff", "file": "trumpet_C5_15_fortissimo_normal.mp3"},
    ],
    "french-horn": [
        {"register": "low", "midi": 35, "dynamic": "pp", "file": "french-horn_B1_15_piano_normal.mp3"},
        {"register": "low", "midi": 35, "dynamic": "ff", "file": "french-horn_B1_15_fortissimo_normal.mp3"},
        {"register": "mid", "midi": 60, "dynamic": "pp", "file": "french-horn_C4_15_piano_normal.mp3"},
        {"register": "mid", "midi": 60, "dynamic": "ff", "file": "french-horn_C4_15_fortissimo_normal.mp3"},
        {"register": "high", "midi": 72, "dynamic": "pp", "file": "french-horn_C5_15_piano_normal.mp3"},
        {"register": "high", "midi": 72, "dynamic": "ff", "file": "french-horn_C5_15_fortissimo_normal.mp3"},
    ],
}

# The Philharmonia archive calls its saxophone simply "saxophone". Its
# D3-E6 sounding range matches the alto corpus used here; retain the source's
# own label in the manifest rather than silently asserting extra metadata.
PHILHARMONIA_WOODWIND_ALTERNATES = {
    "flute": [
        {"register": "low", "midi": 60, "dynamic": "pp", "file": "flute_C4_15_pianissimo_normal.mp3"},
        {"register": "low", "midi": 60, "dynamic": "ff", "file": "flute_C4_15_forte_normal.mp3"},
        {"register": "mid", "midi": 72, "dynamic": "pp", "file": "flute_C5_15_pianissimo_normal.mp3"},
        {"register": "mid", "midi": 72, "dynamic": "ff", "file": "flute_C5_15_forte_normal.mp3"},
        {"register": "high", "midi": 84, "dynamic": "pp", "file": "flute_C6_05_piano_normal.mp3"},
        {"register": "high", "midi": 84, "dynamic": "ff", "file": "flute_C6_05_forte_normal.mp3"},
    ],
    "clarinet": [
        {"register": "low", "midi": 54, "dynamic": "pp", "file": "clarinet_Fs3_15_pianissimo_normal.mp3"},
        {"register": "low", "midi": 54, "dynamic": "ff", "file": "clarinet_Fs3_15_fortissimo_normal.mp3"},
        {"register": "mid", "midi": 72, "dynamic": "pp", "file": "clarinet_C5_15_pianissimo_normal.mp3"},
        {"register": "mid", "midi": 72, "dynamic": "ff", "file": "clarinet_C5_05_fortissimo_normal.mp3"},
        {"register": "high", "midi": 84, "dynamic": "pp", "file": "clarinet_C6_15_pianissimo_normal.mp3"},
        {"register": "high", "midi": 84, "dynamic": "ff", "file": "clarinet_C6_15_fortissimo_normal.mp3"},
    ],
    "alto-sax": [
        {"register": "low", "midi": 51, "dynamic": "pp", "file": "saxophone_Ds3_05_pianissimo_normal.mp3"},
        {"register": "low", "midi": 51, "dynamic": "ff", "file": "saxophone_Ds3_05_fortissimo_normal.mp3"},
        {"register": "mid", "midi": 60, "dynamic": "pp", "file": "saxophone_C4_15_pianissimo_normal.mp3"},
        {"register": "mid", "midi": 60, "dynamic": "ff", "file": "saxophone_C4_15_fortissimo_normal.mp3"},
        {"register": "high", "midi": 74, "dynamic": "pp", "file": "saxophone_D5_05_pianissimo_normal.mp3"},
        {"register": "high", "midi": 74, "dynamic": "ff", "file": "saxophone_D5_05_fortissimo_normal.mp3"},
    ],
}


def _midi(f0: float) -> int:
    return int(round(69 + 12 * math.log2(f0 / 440.0)))


def _select(path: Path, target_midi: int) -> tuple[np.ndarray, int, float]:
    samples, sample_rate = load_mono(str(path))
    candidates = []
    for start, end in segment_notes(samples, sample_rate, merge_gap_s=0.12):
        segment = samples[start:end]
        note = analyse_note(segment, sample_rate, str(path), 16)
        if note is not None:
            candidates.append((abs(_midi(note.f0) - target_midi), segment, note.f0))
    if not candidates:
        raise RuntimeError(f"no analysable note in {path}")
    _, segment, f0 = min(candidates, key=lambda row: row[0])
    if abs(_midi(f0) - target_midi) > 1:
        raise RuntimeError(f"{path}: closest detected MIDI {_midi(f0)} is not target {target_midi}")
    return segment, sample_rate, f0


def _write_reference(source: Path, target_midi: int, output: Path) -> tuple[int, float, float]:
    segment, sample_rate, f0 = _select(source, target_midi)
    peak = float(np.max(np.abs(segment)))
    if peak > 0.99:
        segment = segment * (0.99 / peak)
    sf.write(output, segment, sample_rate, subtype="PCM_16")
    duration = len(segment) / sample_rate
    return _midi(f0), f0, max(0.5, min(2.0, duration * 0.72))


def _seed(instrument: str, measured: dict[str, Any]) -> dict[str, Any]:
    profile = measured[instrument]
    performance = profile.get("performance") or {}
    attack = performance.get("attackNoise") or {}
    attack_registers = (profile.get("attack") or {}).get("byRegister") or []
    seed = {
        "seed": 7331,
        "sg2Family": "blown",
        "voiceMode": "fourier",
        "spectralProfile": instrument,
        "spectralMix": 1.0,
        "spectralPartials": 64,
        "excitationType": "blow",
        "resonatorClass": RESONATOR[instrument],
        "bodyType": "auto",
        "partialMaterial": (profile.get("material") or {}).get("suggestedMaterial", 0.35),
        "attackNoiseLevel": 1.0,
        "attackNoiseFreq": attack.get("freq"),
        "attackNoiseQ": attack.get("q"),
        "attackNoiseDecay": attack.get("decay"),
        "envelopeAttack": performance.get("envelopeAttack", 0.04),
        "envelopeDecay": performance.get("envelopeDecay", 0.05),
        "envelopeSustain": performance.get("envelopeSustain", 0.85),
        "envelopeRelease": performance.get("envelopeRelease", 0.12),
        "vibratoProb": 0,
        "excitationPosition": 0.15 if instrument in {"clarinet", "alto-sax"} else 0.3,
        "excitationHuman": 0.2,
        "toneBreath": 0.03,
        "breathNoiseColor": 0.0,
        "partialTransfer": 0.1,
        "partialTilt": 0.0,
        "spectralResonanceAmount": 0.35,
        "spectralDynamicAmount": 0.8 if instrument in {"clarinet", "alto-sax"} else 1.2,
        "dynamicBlare": 0.25 if instrument in {"alto-sax", "trumpet", "french-horn"} else 0.0,
    }
    resonances = profile.get("resonances") or []
    if len(resonances) >= 3:
        # Pin the exact WP-3 body evidence into the run report/checklist.
        # The partial tables above have been divided by this full-strength
        # fixed-Hz envelope, so unity reconstructs the measured spectrum.
        seed["bodyBands"] = resonances
        seed["spectralResonanceAmount"] = 1.0
    if attack_registers:
        seed["envelopeAttackByRegister"] = [
            {"f0": row["f0"], "attack": row["envelopeAttack"]}
            for row in attack_registers
            if row.get("f0") is not None and row.get("envelopeAttack") is not None
        ]
    # Owner L5/L5b is fitted only where the analysed take set demonstrates
    # the proposed inverse articulation relation.  Horn currently clears the
    # dossier gate; trumpet does not, so its neutral defaults remain absent.
    correlation = performance.get("onsetArticulationCorrelation")
    scoop_depth = performance.get("onsetScoopDepthCents")
    scoop_sd = performance.get("onsetScoopDepthSd")
    scoop_settle_ms = performance.get("onsetScoopSettleMs")
    if (instrument == "french-horn" and isinstance(correlation, (int, float)) and
            correlation <= -.2 and isinstance(scoop_depth, (int, float)) and
            scoop_depth > 0):
        seed.update({
            "excitationHuman": .8,
            "articulationCoupling": min(1., max(.1, -float(correlation) / .5)),
            "articulationStrength": .5,
            "articulationVariation": min(1., max(.1, float(scoop_sd or 0) /
                                                   max(float(scoop_depth), 1))),
            # At mean strength .5 and Human 1, the plan emits half this max.
            "onsetScoopDepthCents": min(180., 2 * float(scoop_depth)),
            "onsetScoopSettle": min(.35, max(.015, float(scoop_settle_ms or 60) / 1000)),
            "onsetScoopRearticulatedScale": .35,
            "onsetScoopRegisterSlope": .35,
            # Soft underplaying is the owner prior; the optimiser/scorer must
            # still demonstrate its magnitude on this instrument.
            "onsetScoopVelocitySlope": -.25,
            "onsetArticulationCorrelation": float(correlation),
            "onsetPitchNotes": int(performance.get("onsetPitchNotes") or 0),
        })
    # A scalar preset B would override the measured G1 register anchors in
    # the engine. Keep it only for legacy/sparse profiles without register
    # evidence; multi-register campaigns consume each anchor directly.
    if not profile.get("partialsByRegister"):
        seed["partialB"] = profile.get("partialB", 0)
    return {key: value for key, value in seed.items() if value is not None}


def build(instrument: str, samples_root: Path, measured_path: Path, output_root: Path,
          phil_root: Path, phil_woodwind_root: Path) -> dict[str, Any]:
    if instrument not in CAMPAIGNS:
        raise ValueError(f"unsupported WP-5 instrument: {instrument}")
    output = output_root / instrument
    notes_dir = output / "references"
    notes_dir.mkdir(parents=True, exist_ok=True)
    references = []
    for register in CAMPAIGNS[instrument]:
        for dynamic in ("pp", "ff"):
            source = samples_root / instrument / register[dynamic]
            target = notes_dir / f"iowa-{register['register']}-{dynamic}-{register['midi']}.wav"
            midi, f0, duration = _write_reference(source, register["midi"], target)
            references.append({
                "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
                "velocity": VELOCITY[dynamic], "dynamic": dynamic,
                "register": register["register"], "durationSec": duration,
                "articulation": "normal", "vibrato": "nonvib",
                "floorGroup": f"{midi}|{dynamic}|normal", "sourceClass": "Iowa MIS",
                "sourceFile": source.name,
            })
    for alternate in PHILHARMONIA_ALTERNATES.get(instrument, []):
        family = "trumpet" if instrument == "trumpet" else "french horn"
        source = phil_root / family / alternate["file"]
        dynamic = alternate["dynamic"]
        target = notes_dir / f"phil-{alternate['register']}-{dynamic}-{alternate['midi']}.wav"
        midi, f0, duration = _write_reference(source, alternate["midi"], target)
        references.append({
            "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
            "velocity": VELOCITY[dynamic], "dynamic": dynamic,
            "register": alternate["register"], "durationSec": duration,
            "articulation": "normal", "vibrato": "nonvib",
            "floorGroup": f"{midi}|{dynamic}|normal", "sourceClass": "Philharmonia",
            "sourceFile": source.name,
        })
    for alternate in PHILHARMONIA_WOODWIND_ALTERNATES.get(instrument, []):
        family = "saxophone" if instrument == "alto-sax" else instrument
        source = phil_woodwind_root / family / alternate["file"]
        dynamic = alternate["dynamic"]
        target = notes_dir / f"phil-{alternate['register']}-{dynamic}-{alternate['midi']}.wav"
        midi, f0, duration = _write_reference(source, alternate["midi"], target)
        # A few very high reed samples fool the conservative monophonic f0
        # tracker by almost a semitone. They cannot form a defensible
        # same-pitch floor group, so omit them rather than relabel the take.
        if midi != alternate["midi"]:
            target.unlink(missing_ok=True)
            continue
        references.append({
            "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
            "velocity": VELOCITY[dynamic], "dynamic": dynamic,
            "register": alternate["register"], "durationSec": duration,
            "articulation": "normal", "vibrato": "nonvib",
            "floorGroup": f"{midi}|{dynamic}|normal", "sourceClass": f"Philharmonia {family}",
            "sourceFile": source.name,
        })
    measured = json.loads(measured_path.read_text())
    initial = _seed(instrument, measured)
    (output / "initial.json").write_text(json.dumps(initial, indent=2) + "\n")
    (output / "references.json").write_text(json.dumps(references, indent=2) + "\n")
    summary = {"instrument": instrument, "output": str(output), "references": len(references),
               "floorGroups": sum(1 for group in {row["floorGroup"] for row in references}
                                  if sum(item["floorGroup"] == group for item in references) >= 2)}
    (output / "BUILD.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", choices=sorted(CAMPAIGNS), action="append",
                        help="repeatable; defaults to all WP-5 covered instruments")
    parser.add_argument("--samples", type=Path, default=Path("/private/tmp/sg2/samples"))
    parser.add_argument("--measured", type=Path, default=Path("web/static/measured_profiles.json"))
    parser.add_argument("--output", type=Path, default=Path("/private/tmp/sg2/campaigns"))
    parser.add_argument("--philharmonia", type=Path,
                        default=Path("/private/tmp/sg2/phil_brass/Brass"))
    parser.add_argument("--philharmonia-woodwind", type=Path,
                        default=Path("/private/tmp/sg2/phil_woodwind/Woodwind"))
    args = parser.parse_args(argv)
    instruments = args.instrument or list(CAMPAIGNS)
    summaries = [build(name, args.samples, args.measured, args.output, args.philharmonia,
                       args.philharmonia_woodwind)
                 for name in instruments]
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
