#!/usr/bin/env python3
"""Prepare the first WP-7 grand-piano and nylon-guitar campaigns.

This is deliberately a preflight builder, not a fitter.  It turns the
analysis-only corpus into reproducible matched-note manifests, records the
weak/absent take-pair evidence, and emits §2.4c strongest-prior presets for
the controllability audit.  Audio remains under the durable SG2 data root.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
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


VELOCITY = {"pp": 0.2, "p": 0.28, "mp": 0.45, "mf": 0.62,
            "f": 0.82, "ff": 0.92}
STRUCK_OBJECTIVE_ROLES = ("spectral", "onset")

VSCO_SOURCE = "https://versilian-studios.com/vsco-community/"
VSCO_METADATA = "https://freesound.org/people/sgossner/packs/21055/"
VSCO_LICENCE = "Creative Commons Zero 1.0 (CC0-1.0; public domain dedication)."
VSCO_DYNAMICS = {
    "dyn1": {"dynamic": "p", "velocityCenter": 30},
    "dyn2": {"dynamic": "mf", "velocityCenter": 85},
    "dyn3": {"dynamic": "ff", "velocityCenter": 119},
}

LIMITED_VSCO_RE = {
    "glockenspiel": re.compile(
        r"^vsco2\.glock_(medium)_([A-G](?:#|b)?-?\d)\.wav$", re.IGNORECASE),
    "harp": re.compile(
        r"^vsco2\.KSHarp_([A-G](?:#|b)?-?\d)_(mp|mf|f)\.wav$", re.IGNORECASE),
}


def _midi_from_note_name(note: str) -> int:
    match = re.fullmatch(r"([A-Ga-g])([#b]?)(-?\d)", note)
    if not match:
        raise ValueError(f"invalid note label: {note}")
    natural = {"C": 0, "D": 2, "E": 4, "F": 5,
               "G": 7, "A": 9, "B": 11}[match.group(1).upper()]
    accidental = {"": 0, "#": 1, "b": -1}[match.group(2)]
    return (int(match.group(3)) + 1) * 12 + natural + accidental


def write_limited_vsco_contracts(samples_root: Path,
                                 prep_root: Path) -> list[dict[str, Any]]:
    """Record honest sparse handoffs for the landed glock and harp WAVs."""
    prep_root.mkdir(parents=True, exist_ok=True)
    summaries = []
    for instrument in ("glockenspiel", "harp"):
        corpus = samples_root / instrument
        matcher = LIMITED_VSCO_RE[instrument]
        rows = []
        for path in sorted(corpus.glob("*.wav")):
            match = matcher.match(path.name)
            if not match:
                raise RuntimeError(f"unrecognised {instrument} filename: {path.name}")
            if instrument == "glockenspiel":
                dynamic_label, note = match.groups()
                dynamic = "mf"
                velocity = 0.62
                velocity_evidence = f"source filename label: {dynamic_label}"
            else:
                note, dynamic = match.groups()
                velocity = VELOCITY[dynamic]
                velocity_evidence = f"source filename label: {dynamic}"
            midi = _midi_from_note_name(note)
            info = sf.info(path)
            rows.append({
                "file": path.name,
                "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "sourceClass": "VSCO 2 CE",
                "source": VSCO_SOURCE,
                "licence": VSCO_LICENCE,
                "acquired": "present in landed Agent C handoff by 2026-07-17",
                "dynamic": dynamic,
                "velocity": velocity,
                "velocityEvidence": velocity_evidence,
                "midi": midi,
                "note": _note_name(midi),
                "sampleRate": info.samplerate,
                "channels": info.channels,
                "subtype": info.subtype,
                "roundRobin": None,
            })
        expected = 6 if instrument == "glockenspiel" else 23
        if len(rows) != expected:
            raise RuntimeError(
                f"expected {expected} landed {instrument} WAVs, found {len(rows)}")
        provenance = {
            "instrument": instrument,
            "generated": "2026-07-17",
            "audioPolicy": "analysis-only external corpus; never commit or redistribute audio",
            "sourceIdentity": {
                "library": "Versilian Studios Chamber Orchestra 2 Community Edition",
                "instrument": instrument,
                "performer": "not present in landed handoff",
                "capture": "not present in landed handoff",
                "licence": VSCO_LICENCE,
            },
            "files": rows,
        }
        (corpus / "PROVENANCE.json").write_text(
            json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

        dynamics = sorted({row["dynamic"] for row in rows})
        notes = sorted(rows, key=lambda row: row["midi"])
        if instrument == "glockenspiel":
            limitation = (
                "Six pitch anchors and one labelled medium dynamic support a "
                "register-spanning bar-class reference prep only. Dynamic, "
                "repeatability, and §2.5c distributional claims are blocked.")
            class_note = (
                "The future campaign must retain `resonatorClass=bar`; failures "
                "of bar-mode controls are engine specs, never a reason to bend B.")
        else:
            limitation = (
                "Twenty-three pitch anchors span the harp, but 20 are mf and "
                "only three files cover mp/f. Register identity is supported; "
                "a balanced dynamic grid and repeated-take floor are not.")
            class_note = (
                "These are plucked-string references; no glock/bar or piano "
                "construction parameters are borrowed.")
        coverage = [
            f"# Coverage — {instrument}\n\n",
            f"Durable corpus: **{len(rows)} VSCO 2 CE WAV files**, spanning ",
            f"{notes[0]['note']} (MIDI {notes[0]['midi']})–",
            f"{notes[-1]['note']} (MIDI {notes[-1]['midi']}).\n\n",
            f"- Source/licence: VSCO 2 Community Edition, CC0-1.0.\n",
            "- Performer/capture: absent from the landed handoff; explicitly unresolved.\n",
            f"- Dynamics present: {', '.join(dynamics)}.\n",
            f"- Coverage verdict: {limitation}\n",
            f"- Construction firewall: {class_note}\n",
            "- Steel-string guitar remains corpus-absent and is not inferred from these files.\n\n",
            "## Landed reference inventory\n\n",
            "| MIDI | Note | Dynamic | File |\n",
            "|---:|---|---|---|\n",
        ]
        for row in notes:
            coverage.append(
                f"| {row['midi']} | {row['note']} | {row['dynamic']} | `{row['file']}` |\n")
        (corpus / "COVERAGE.md").write_text("".join(coverage), encoding="utf-8")

        prep = {
            "instrument": instrument,
            "status": "reference-prep-only",
            "constructionClass": "bar" if instrument == "glockenspiel" else "string",
            "references": [{
                "path": str(corpus / row["file"]),
                "midi": row["midi"],
                "velocity": row["velocity"],
                "dynamic": row["dynamic"],
                # Evidence roles use the shared tripwire taxonomy. Decay is
                # measured by the spectral objective, not a standalone role.
                "roles": list(STRUCK_OBJECTIVE_ROLES),
                "sourceClass": row["sourceClass"],
            } for row in notes],
            "limitations": limitation,
        }
        prep_path = prep_root / f"{instrument}.json"
        prep_path.write_text(json.dumps(prep, indent=2) + "\n", encoding="utf-8")
        summaries.append({
            "instrument": instrument, "files": len(rows),
            "dynamics": dynamics, "prep": str(prep_path),
        })
    return summaries


def vsco_upright_midi(sample_index: int) -> int:
    """Map the VSCO upright sample-zone index to its declared MIDI root."""
    if sample_index == 44:
        return 108
    if 0 <= sample_index <= 42 and sample_index % 2 == 0:
        return 21 + 2 * sample_index
    raise ValueError(f"invalid VSCO upright sample index: {sample_index}")


def _note_name(midi: int) -> str:
    names = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def write_upright_contract(corpus: Path) -> dict[str, Any]:
    """Reconstruct the missing atomic COVERAGE/PROVENANCE handoff."""
    audio = sorted(corpus.glob("vsco2.Player_dyn[123]_rr1_*.wav"))
    if len(audio) != 69:
        raise RuntimeError(f"expected 69 VSCO upright WAVs, found {len(audio)}")
    rows = []
    pitch_counts: dict[int, int] = {}
    dynamic_counts = {key: 0 for key in VSCO_DYNAMICS}
    for path in audio:
        parts = path.stem.split("_")
        dynamic_code = parts[1]
        index = int(parts[-1])
        midi = vsco_upright_midi(index)
        pitch_counts[midi] = pitch_counts.get(midi, 0) + 1
        dynamic_counts[dynamic_code] += 1
        dynamic = VSCO_DYNAMICS[dynamic_code]
        rows.append({
            "file": path.name,
            "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sourceClass": "VSCO 2 CE",
            "source": VSCO_SOURCE,
            "metadataSource": VSCO_METADATA,
            "licence": VSCO_LICENCE,
            "downloaded": "2026-07-16",
            "dynamic": dynamic["dynamic"],
            "velocityCenter": dynamic["velocityCenter"],
            "midi": midi,
            "note": _note_name(midi),
            "vibrato": "nonvib",
            "roundRobin": 1,
        })
    if set(pitch_counts.values()) != {3} or len(pitch_counts) != 23:
        raise RuntimeError("upright acquisition is not 23 pitches x 3 dynamics")
    provenance = {
        "instrument": "piano-upright",
        "generated": "2026-07-17",
        "audioPolicy": "analysis-only external corpus; never commit or redistribute audio",
        "sourceIdentity": {
            "library": "Versilian Studios Chamber Orchestra 2 Community Edition",
            "instrument": "Upright Piano",
            "performer": "Simon Dalzell",
            "location": "UK medium room",
            "microphone": "Rode NT5 spaced pair, player position",
            "licence": VSCO_LICENCE,
        },
        "files": rows,
    }
    (corpus / "PROVENANCE.json").write_text(
        json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    anchors = CAMPAIGNS["piano-upright"]["anchors"]
    lines = [
        "# Coverage — piano-upright\n\n",
        "Durable corpus: **69 VSCO 2 CE Upright Piano WAV files** ",
        "(23 sampled pitches × 3 velocity layers, one round robin).\n\n",
        "- Source/licence: Versilian Studios VSCO 2 Community Edition, CC0-1.0.\n",
        "- Capture: Simon Dalzell; UK medium room; Rode NT5 spaced pair at player position.\n",
        "- Format: stereo, 44.1 kHz, 24-bit lossless WAV.\n",
        "- Pitch span: A0 (MIDI 21)–C8 (MIDI 108); major-third anchors through A7 plus C8.\n",
        "- Dynamics: p/MIDI 30, mf/MIDI 85, ff/MIDI 119; 23 files each.\n",
        "- Campaign grid: seven registers × p/mf/ff (21 strict cells), exceeding the preflight five-anchor floor.\n",
        "- Fit role: spectral, onset, decay, body and inharmonicity identity. No repeated same-pitch/same-dynamic takes exist (rr1 only), so §2.5c remains proxy-calibrated and no distributional freeze may be claimed.\n",
        "- Room note: the medium-room/player-position capture can colour body and late decay; room-suspected residuals stay separate per the operating protocol.\n\n",
        "## Required campaign files\n\n",
        "| Register | MIDI | Note | p | mf | ff |\n",
        "|---|---:|---:|---|---|---|\n",
    ]
    for anchor in anchors:
        lines.append(
            f"| {anchor['register']} | {anchor['midi']} | {_note_name(anchor['midi'])} | "
            f"`{anchor['p']}` | `{anchor['mf']}` | `{anchor['ff']}` |\n")
    lines.extend([
        "\nAll 21 required campaign files and all 69 provenance-declared audio files were present and hashed at contract reconstruction on 2026-07-17.\n",
        "Steel-string guitar remains corpus-absent; no upright sample is repurposed for it.\n",
    ])
    (corpus / "COVERAGE.md").write_text("".join(lines), encoding="utf-8")
    return {"files": len(rows), "pitches": len(pitch_counts),
            "dynamics": dynamic_counts, "campaignAnchors": len(anchors)}

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
    "piano-upright": {
        "instrument": "piano-upright",
        "corpus": "piano-upright",
        "profile": "piano-upright",
        "excitation": "strike",
        "anchors": [
            {"register": "bass", "midi": 21,
             "p": "vsco2.Player_dyn1_rr1_000.wav", "mf": "vsco2.Player_dyn2_rr1_000.wav", "ff": "vsco2.Player_dyn3_rr1_000.wav"},
            {"register": "low", "midi": 37,
             "p": "vsco2.Player_dyn1_rr1_008.wav", "mf": "vsco2.Player_dyn2_rr1_008.wav", "ff": "vsco2.Player_dyn3_rr1_008.wav"},
            {"register": "low-mid", "midi": 53,
             "p": "vsco2.Player_dyn1_rr1_016.wav", "mf": "vsco2.Player_dyn2_rr1_016.wav", "ff": "vsco2.Player_dyn3_rr1_016.wav"},
            {"register": "mid", "midi": 69,
             "p": "vsco2.Player_dyn1_rr1_024.wav", "mf": "vsco2.Player_dyn2_rr1_024.wav", "ff": "vsco2.Player_dyn3_rr1_024.wav"},
            {"register": "upper-mid", "midi": 85,
             "p": "vsco2.Player_dyn1_rr1_032.wav", "mf": "vsco2.Player_dyn2_rr1_032.wav", "ff": "vsco2.Player_dyn3_rr1_032.wav"},
            {"register": "treble", "midi": 101,
             "p": "vsco2.Player_dyn1_rr1_040.wav", "mf": "vsco2.Player_dyn2_rr1_040.wav", "ff": "vsco2.Player_dyn3_rr1_040.wav"},
            {"register": "top", "midi": 108,
             "p": "vsco2.Player_dyn1_rr1_044.wav", "mf": "vsco2.Player_dyn2_rr1_044.wav", "ff": "vsco2.Player_dyn3_rr1_044.wav"},
        ],
        "dynamics": ("p", "mf", "ff"),
        "velocity": {"p": 30 / 127, "mf": 85 / 127, "ff": 119 / 127},
        "source": "VSCO 2 CE Upright Piano",
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
    return (path.name.startswith("Piano.") or path.name.startswith("phil.guitar_") or
            path.name.startswith("vsco2.Player_"))


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
    # A saved best may be the ship-mode listening preset. Rebasing it must
    # restore the deterministic fit contract and current prior provenance;
    # iterate also enforces Human=0 at render time, but the manifest itself
    # must not claim that fitting starts in ship mode.
    for key in ("excitationHuman", "_sg2Mode", "_sg2Prior"):
        if key in refreshed_seed:
            rebased[key] = refreshed_seed[key]
        else:
            rebased.pop(key, None)
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
    elif instrument == "piano-upright":
        proxies = [
            {"files": [f"vsco2.Player_{dynamic}_rr1_{left:03d}.wav",
                       f"vsco2.Player_{dynamic}_rr1_{right:03d}.wav"],
             "method": "adjacent sampled pitches with register trend removed"}
            for dynamic in ("dyn1", "dyn2", "dyn3")
            for left, right in zip(range(0, 42, 2), range(2, 44, 2))
        ]
        reason = "VSCO upright acquisition has one round robin only; adjacent-pitch proxy is weaker than true repetition evidence."
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
                "velocity": spec.get("velocity", VELOCITY)[dynamic],
                "dynamic": dynamic,
                "register": anchor["register"], "durationSec": duration,
                "articulation": spec["excitation"], "vibrato": "nonvib",
                # Evidence roles use the shared tripwire taxonomy. Decay is
                # measured by the spectral objective, not a standalone role.
                "roles": list(STRUCK_OBJECTIVE_ROLES),
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
        "--write-upright-contract", action="store_true",
        help="reconstruct the missing VSCO upright COVERAGE/PROVENANCE sidecars",
    )
    parser.add_argument(
        "--write-secondary-contracts", action="store_true",
        help="write sparse glockenspiel/harp contracts and prep manifests",
    )
    parser.add_argument(
        "--rebase-state", type=Path,
        help="carry fitted parameters from a best.json while refreshing "
             "profile-derived structural anchors (single instrument only)",
    )
    args = parser.parse_args(argv)
    if args.write_upright_contract:
        contract = write_upright_contract(args.samples / "piano-upright")
        print(json.dumps({"uprightContract": contract}, indent=2))
    if args.write_secondary_contracts:
        secondary = write_limited_vsco_contracts(
            args.samples, sg2_data_root() / "reference-prep")
        print(json.dumps({"secondaryContracts": secondary}, indent=2))
    instruments = args.instrument or (
        [] if args.write_upright_contract or args.write_secondary_contracts
        else list(CAMPAIGNS))
    if args.rebase_state and len(instruments) != 1:
        parser.error("--rebase-state requires exactly one --instrument")
    summaries = [
        build(name, args.samples, args.measured, args.output, args.rebase_state)
        for name in instruments
    ]
    if summaries:
        print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
