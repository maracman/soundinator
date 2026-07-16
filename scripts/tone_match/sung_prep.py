#!/usr/bin/env python3
"""Build identity-safe VocalSet reference manifests for the SG2 sung campaign.

The builder consumes local VocalSet audio plus the official Annotated VocalSet
CSV note boundaries. It never pools singers. Each output row carries singer,
vowel, technique, source context, expected f0/MIDI, register, roles, and a
same-singer floor group.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
import hashlib
import io
import json
import math
from pathlib import Path
import re
from typing import Iterable

import numpy as np
import soundfile as sf

from scripts.fit_profiles_from_samples import load_mono, segment_notes


AUDIO_RE = re.compile(
    r"(?P<short>[mf]\d+)_(?P<context>long|scales|arpeggios).*_(?P<vowel>[aeiou])\.wav$",
    re.IGNORECASE,
)

VOICE_CLASSES = {
    "tenor": {"male2", "male3", "male7", "male11"},
    "contrabass": {"male4", "male8", "male10"},
    "mezzo-soprano": {"female5", "female8"},
}

# Initial physiological register boundaries. They are explicitly priors, not
# fitted facts; pass 01 records whether the references straddle them.
PASSAGGIO_PRIOR_HZ = {
    "tenor": 330.0,
    "contrabass": 260.0,
    "mezzo-soprano": 523.25,
}

DYNAMIC = {
    "pp": ("pp", 0.20),
    "straight": ("mf", 0.62),
    "forte": ("ff", 0.92),
    "messa": ("variable", 0.62),
    "slow_piano": ("p", 0.30),
    "slow_forte": ("f", 0.84),
    "vibrato": ("mf", 0.62),
}


@dataclass(frozen=True)
class VocalSetFile:
    path: Path
    singer: str
    singer_short: str
    context: str
    technique: str
    vowel: str


def parse_vocalset_file(path: str | Path) -> VocalSetFile:
    path = Path(path)
    match = AUDIO_RE.search(path.name)
    if not match:
        raise ValueError(f"not a recognised VocalSet vowel file: {path}")
    parts = path.parts
    singer = next(
        (part.lower() for part in parts if re.fullmatch(r"(?:male|female)\d+", part, re.I)),
        None,
    )
    if singer is None:
        raise ValueError(f"VocalSet singer directory missing from {path}")
    technique = path.parent.name.lower()
    context = path.parent.parent.name.lower()
    return VocalSetFile(
        path=path,
        singer=singer,
        singer_short=match.group("short").lower(),
        context=context,
        technique=technique,
        vowel=match.group("vowel").lower(),
    )


def discover_files(root: Path, singer: str) -> list[VocalSetFile]:
    rows = []
    for path in sorted(root.rglob("*.wav")):
        try:
            row = parse_vocalset_file(path)
        except ValueError:
            continue
        if row.singer == singer.lower():
            rows.append(row)
    return rows


def _annotation_rows(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    marker = "Sequence, Start time, End time"
    offset = text.find(marker)
    if offset < 0:
        raise ValueError(f"annotation header missing from {path}")
    reader = csv.DictReader(io.StringIO(text[offset:]), skipinitialspace=True)
    rows = []
    for row in reader:
        if (row.get("Type") or "").strip().lower() != "sound":
            continue
        try:
            rows.append({
                "start": float(row["Start time"]),
                "end": float(row["End time"]),
                "expectedMidi": int(round(float(row["Ground Truth MIDI code"]))),
                "expectedF0Hz": float(row["Ground Truth Frequency"]),
                "note": (row.get("Ground truth Note name") or "").strip(),
            })
        except (TypeError, ValueError, KeyError):
            continue
    if not rows:
        raise ValueError(f"no sound rows in {path}")
    return rows


def _annotation_index(path: Path) -> dict[str, list[dict]]:
    """Read Annotated VocalSet's consolidated ``all files.csv`` once."""

    groups: dict[str, list[dict]] = {}
    with path.open(encoding="utf-8-sig", errors="replace", newline="") as handle:
        for row in csv.DictReader(handle, skipinitialspace=True):
            if (row.get("Type") or "").strip().lower() != "sound":
                continue
            stem = (row.get("File Name") or "").strip()
            if not stem:
                continue
            try:
                groups.setdefault(stem, []).append({
                    "start": float(row["Start time"]),
                    "end": float(row["End time"]),
                    "expectedMidi": int(round(float(row["Ground Truth MIDI code"]))),
                    "expectedF0Hz": float(row["Ground Truth Frequency"]),
                    "note": (row.get("Ground truth Note name") or "").strip(),
                })
            except (TypeError, ValueError, KeyError):
                continue
    if not groups:
        raise ValueError(f"no sound annotations in {path}")
    return groups


def find_annotation(annotation_root: Path, audio: VocalSetFile) -> Path:
    matches = sorted(annotation_root.rglob(f"{audio.path.stem}.csv"))
    if not matches:
        raise FileNotFoundError(f"annotation CSV missing for {audio.path.name}")
    # Prefer the final corrected set with file metadata where present.
    matches.sort(key=lambda path: ("extended 4" not in str(path), "with file header" not in str(path)))
    return matches[0]


def register_for_f0(voice_class: str, f0_hz: float) -> str:
    boundary = PASSAGGIO_PRIOR_HZ[voice_class]
    if f0_hz < boundary / 1.60:
        return "low"
    if f0_hz <= boundary * 1.05:
        return "mid"
    return "high"


def _roles(audio: VocalSetFile) -> list[str]:
    if audio.context == "long_tones" and audio.technique in {"straight", "pp", "forte"}:
        return ["spectral", "onset"]
    if audio.technique == "vibrato":
        return ["vibrato"]
    if audio.technique in {"slow_piano", "slow_forte", "straight"}:
        return ["floor"]
    if audio.technique == "messa":
        return ["humanisation"]
    return []


def _reference_annotation_rows(
    audio: VocalSetFile,
    rows: list[dict],
    voice_class: str,
) -> list[dict]:
    """Keep all long-tone events and three anchored scale register events."""

    if audio.context == "long_tones":
        return rows
    by_register: dict[str, list[dict]] = {"low": [], "mid": [], "high": []}
    for row in rows:
        by_register[register_for_f0(voice_class, row["expectedF0Hz"])].append(row)
    boundary = PASSAGGIO_PRIOR_HZ[voice_class]
    targets = {"low": boundary / 1.5, "mid": boundary, "high": boundary * 1.5}
    selected = []
    for register, candidates in by_register.items():
        if candidates:
            selected.append(min(
                candidates,
                key=lambda row: abs(math.log2(row["expectedF0Hz"] / targets[register])),
            ))
    return sorted(selected, key=lambda row: row["start"])


def _pp_rows_from_template(
    samples: np.ndarray,
    sample_rate: int,
    template_rows: list[dict],
) -> list[dict]:
    """Pair amplitude-segmented pp notes with the score-anchored long-tone order."""

    if not template_rows:
        return []
    segments = segment_notes(samples, sample_rate, merge_gap_s=0.12)
    if len(segments) != len(template_rows):
        template_end = max(row["end"] for row in template_rows)
        scale = (len(samples) / sample_rate) / max(template_end, 1e-9)
        return [
            {
                **template,
                "start": template["start"] * scale,
                "end": template["end"] * scale,
            }
            for template in template_rows
        ]
    return [
        {
            **template,
            "start": start / sample_rate,
            "end": end / sample_rate,
        }
        for (start, end), template in zip(segments, template_rows)
    ]


def build_references(
    *,
    voice_class: str,
    singer: str,
    samples_root: Path,
    annotation_root: Path,
    output_root: Path,
) -> dict:
    voice_class = voice_class.strip().lower().replace("_", "-").replace(" ", "-")
    allowed = VOICE_CLASSES.get(voice_class)
    if allowed is None:
        raise ValueError(f"unsupported adult voice class: {voice_class}")
    if singer not in allowed:
        raise ValueError(f"{singer} is not documented as {voice_class}; allowed: {sorted(allowed)}")

    discovered = discover_files(samples_root, singer)
    eligible = [
        row for row in discovered
        if (row.context == "long_tones" and row.technique in {"straight", "pp", "forte", "messa"})
        or (row.context in {"scales", "arpeggios"} and row.technique in {
            "straight", "slow_piano", "slow_forte", "vibrato"
        })
    ]
    if not eligible:
        raise ValueError(f"no eligible VocalSet files for {singer} under {samples_root}")

    consolidated = _annotation_index(annotation_root) if annotation_root.is_file() else None
    notes_dir = output_root / "references"
    notes_dir.mkdir(parents=True, exist_ok=True)
    for stale in notes_dir.glob("*.wav"):
        stale.unlink()
    references = []
    source_hashes = {}
    exclusions = []
    for audio in eligible:
        samples, sample_rate = load_mono(str(audio.path))
        annotation = annotation_root
        annotation_label = annotation_root.name
        if consolidated is not None:
            annotation_rows = consolidated.get(audio.path.stem, [])
            annotation_label = annotation_root.name
        else:
            try:
                annotation = find_annotation(annotation_root, audio)
                annotation_rows = _annotation_rows(annotation)
                annotation_label = annotation.name
            except FileNotFoundError:
                annotation_rows = []
        if not annotation_rows and audio.technique == "pp":
            template_stem = f"{audio.singer_short}_long_straight_{audio.vowel}"
            if consolidated is not None:
                template = consolidated.get(template_stem, [])
                annotation_label = f"{annotation_root.name}#{template_stem}"
            else:
                template_matches = sorted(annotation_root.rglob(f"{template_stem}.csv"))
                template = _annotation_rows(template_matches[0]) if template_matches else []
                if template_matches:
                    annotation_label = f"{template_matches[0].name}#pp-boundaries"
            annotation_rows = _pp_rows_from_template(samples, sample_rate, template)
        if not annotation_rows:
            exclusions.append({
                "sourceFile": audio.path.name,
                "reason": "official note annotation unavailable; excluded before objective hash",
            })
            continue
        source_hashes[str(audio.path)] = hashlib.sha256(audio.path.read_bytes()).hexdigest()
        dynamic, velocity = DYNAMIC.get(audio.technique, ("mf", 0.62))
        selected_annotations = _reference_annotation_rows(
            audio, annotation_rows, voice_class
        )
        for sequence, note in enumerate(selected_annotations, 1):
            start = max(0, int(round(note["start"] * sample_rate)))
            end = min(len(samples), int(round(note["end"] * sample_rate)))
            segment = np.asarray(samples[start:end], dtype=np.float32)
            if len(segment) < int(0.18 * sample_rate):
                continue
            register = register_for_f0(voice_class, note["expectedF0Hz"])
            target = notes_dir / (
                f"{singer}-{audio.context}-{audio.technique}-{audio.vowel}-"
                f"{sequence:02d}-m{note['expectedMidi']}_{audio.vowel}.wav"
            )
            sf.write(target, segment, sample_rate, subtype="PCM_16")
            duration = len(segment) / sample_rate
            roles = _roles(audio)
            references.append({
                "path": str(target.resolve()),
                "midi": note["expectedMidi"],
                "expectedF0Hz": note["expectedF0Hz"],
                "velocity": velocity,
                "dynamic": dynamic,
                "register": register,
                "durationSec": round(duration, 6),
                "sampleRate": sample_rate,
                "vowel": audio.vowel,
                "singer": singer,
                "voiceClass": voice_class,
                "technique": audio.technique,
                "context": audio.context,
                "vibrato": "vib" if audio.technique == "vibrato" else "nonvib",
                "roles": roles,
                "floorGroup": "|".join(map(str, (
                    singer, audio.vowel, note["expectedMidi"], dynamic,
                    audio.context, audio.technique,
                ))),
                "sourceClass": "VocalSet",
                "sourceFile": audio.path.name,
                "annotationFile": annotation_label,
            })

    registers = sorted({row["register"] for row in references if "spectral" in row["roles"]})
    dynamics = sorted({row["dynamic"] for row in references if "spectral" in row["roles"]})
    vowels = sorted({row["vowel"] for row in references if "spectral" in row["roles"]})
    boundary = PASSAGGIO_PRIOR_HZ[voice_class]
    spectral_f0 = [
        row["expectedF0Hz"] for row in references if "spectral" in row["roles"]
    ]
    coverage = {
        "voiceClass": voice_class,
        "primarySinger": singer,
        "referenceCount": len(references),
        "spectralRegisters": registers,
        "spectralDynamics": dynamics,
        "spectralVowels": vowels,
        "passaggioPriorHz": boundary,
        "passaggioStraddled": (
            any(f0 < boundary for f0 in spectral_f0)
            and any(f0 > boundary for f0 in spectral_f0)
        ),
        "roles": {
            role: sum(role in row["roles"] for row in references)
            for role in ("spectral", "onset", "vibrato", "floor", "humanisation")
        },
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "references.json").write_text(
        json.dumps(references, indent=2) + "\n", encoding="utf-8"
    )
    (output_root / "REFERENCE_BUILD.json").write_text(
        json.dumps({
            "schemaVersion": 1,
            "coverage": coverage,
            "sourceHashes": source_hashes,
            "exclusions": exclusions,
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    return {"references": references, "coverage": coverage}


def qc_candidate(files: Iterable[VocalSetFile]) -> dict:
    """Cheap identity-selection QC: completeness, clipping, DC and SNR proxy."""

    rows = []
    unreadable = []
    for audio in files:
        try:
            samples, sample_rate = load_mono(str(audio.path))
        except Exception as exc:
            unreadable.append({"path": str(audio.path), "error": str(exc)})
            continue
        peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
        clipping = float(np.mean(np.abs(samples) >= 0.999)) if len(samples) else 1.0
        rms = float(np.sqrt(np.mean(samples * samples))) if len(samples) else 0.0
        edge = max(1, int(0.08 * len(samples)))
        noise = np.concatenate([samples[:edge], samples[-edge:]])
        noise_rms = float(np.sqrt(np.mean(noise * noise))) if len(noise) else 0.0
        snr = 20 * math.log10(max(rms, 1e-9) / max(noise_rms, 1e-9))
        rows.append({
            "path": str(audio.path),
            "context": audio.context,
            "technique": audio.technique,
            "vowel": audio.vowel,
            "durationSec": len(samples) / sample_rate,
            "peak": peak,
            "clippingFraction": clipping,
            "dc": float(np.mean(samples)) if len(samples) else 0.0,
            "edgeSnrDb": snr,
        })
    required = {
        (technique, vowel)
        for technique in ("straight", "pp", "forte")
        for vowel in "aeiou"
    }
    present = {(row["technique"], row["vowel"]) for row in rows}
    return {
        "files": rows,
        "requiredCoverage": len(required & present),
        "requiredTotal": len(required),
        "complete": required <= present,
        "unreadableFiles": unreadable,
        "clippedFiles": sum(row["clippingFraction"] > 1e-4 for row in rows),
        "medianEdgeSnrDb": float(np.median([row["edgeSnrDb"] for row in rows])) if rows else None,
        "medianPeak": float(np.median([row["peak"] for row in rows])) if rows else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    qc = sub.add_parser("qc")
    qc.add_argument("--samples-root", type=Path, required=True)
    qc.add_argument("--singer", required=True)
    qc.add_argument("--out", type=Path, required=True)

    build = sub.add_parser("build")
    build.add_argument("--voice-class", required=True)
    build.add_argument("--singer", required=True)
    build.add_argument("--samples-root", type=Path, required=True)
    build.add_argument("--annotation-root", type=Path, required=True)
    build.add_argument("--out", type=Path, required=True)

    args = parser.parse_args()
    if args.command == "qc":
        payload = qc_candidate(discover_files(args.samples_root, args.singer))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
        print(json.dumps(payload, indent=2))
    else:
        payload = build_references(
            voice_class=args.voice_class,
            singer=args.singer,
            samples_root=args.samples_root,
            annotation_root=args.annotation_root,
            output_root=args.out,
        )
        print(json.dumps(payload["coverage"], indent=2))


if __name__ == "__main__":
    main()
