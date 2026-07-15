#!/usr/bin/env python3
"""Finish the external SG2 corpus handoff without downloading anything.

The acquisition archives and audio remain under /private/tmp.  This script
selects already-extracted VocalSet material, copies those references into the
instrument layout, and generates the per-instrument PROVENANCE.json and
COVERAGE.md contract consumed by fit_profiles_from_samples.py.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import Any


AUDIO_EXTENSIONS = {".aif", ".aiff", ".wav", ".flac", ".ogg", ".mp3"}
TODAY = "2026-07-15"
IOWA_BASE = "https://theremin.music.uiowa.edu/"
IOWA_LICENCE = (
    "University of Iowa Musical Instrument Samples: freely downloadable and usable "
    "for projects without restrictions (MIS catalogue terms)."
)
PHILHARMONIA_SOURCE = (
    "https://philharmonia.co.uk/resources/sound-samples/ "
    "(Brass.zip / Strings.zip public sample archive)"
)
PHILHARMONIA_LICENCE = (
    "Philharmonia Orchestra sound samples: free for project/commercial use; the raw "
    "samples or a sampler instrument made from them may not be redistributed as-is."
)
VOCALSET_SOURCE = "https://zenodo.org/records/1193957 (VocalSet.zip; DOI 10.5281/zenodo.1193957)"
VOCALSET_LICENCE = "Creative Commons Attribution 4.0 (CC BY 4.0)."

# VocalSet publishes anonymous singer IDs and aggregate voice-type counts, not
# a singer-ID → Fach table. These pairs were selected empirically from the
# downloaded straight/soft/loud material by stable analysed pitch range.
VOCAL_SELECTION = {
    "voice-tenor": {
        "singers": ["male3", "male11"],
        "basis": "higher/mid male pair; tenor proxy selected from measured usable range",
    },
    "voice-bass": {
        "singers": ["male1", "male5"],
        "basis": "lowest stable male pair; standard-bass stepping stone for §9.1",
    },
    "voice-mezzo": {
        "singers": ["female2", "female6"],
        "basis": "lower female pair; mezzo-soprano proxy selected from measured usable range",
    },
}

NOTE_RE = re.compile(r"([A-Ga-g])([b#s]?)(\d)")
VOWEL_RE = re.compile(r"_([aeiou])\.wav$", re.IGNORECASE)


def _audio_files(folder: Path) -> list[Path]:
    return sorted(path for path in folder.iterdir()
                  if path.is_file() and path.suffix.lower() in AUDIO_EXTENSIONS)


def _dynamics(name: str) -> str:
    low = name.lower()
    for token, label in (
        ("fortissimo", "ff"), ("mezzo-forte", "mf"), ("mezzo-piano", "mp"),
        ("pianissimo", "pp"), ("slow_forte", "f"), ("slow_piano", "p"),
        (".ff.", "ff"), (".mf.", "mf"), (".mp.", "mp"), (".pp.", "pp"),
        ("_forte", "f"), ("_piano", "p"),
    ):
        if token in low:
            return label
    return "unspecified"


def _vibrato(name: str) -> str:
    low = name.lower()
    if any(token in low for token in ("nonvib", "novib", "non-vib", "non_vib")):
        return "nonvib"
    if "vib" in low or "molto-vibrato" in low:
        return "vib"
    return "ordinary"


def _note_span(name: str) -> str | None:
    matches = NOTE_RE.findall(name)
    if not matches:
        return None
    notes = [f"{letter.upper()}{accidental.replace('s', '#')}{octave}" for letter, accidental, octave in matches]
    return notes[0] if len(notes) == 1 else f"{notes[0]}–{notes[-1]}"


def _vowel(name: str) -> str | None:
    match = VOWEL_RE.search(name)
    return match.group(1).lower() if match else None


def _load_iowa_manifest(path: Path) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        instrument, relative = line.split("|", 1)
        result[(instrument, Path(relative).name)] = IOWA_BASE + relative.replace(" ", "%20")
    return result


def select_vocalset(vocalset_root: Path, samples_root: Path) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for instrument, selection in VOCAL_SELECTION.items():
        destination = samples_root / instrument
        destination.mkdir(parents=True, exist_ok=True)
        copied = []
        for singer in selection["singers"]:
            source_root = vocalset_root / singer
            if not source_root.is_dir():
                raise FileNotFoundError(f"missing extracted VocalSet singer: {source_root}")
            for source in sorted(source_root.rglob("*.wav")):
                technique = source.parent.name
                if technique not in {"slow_piano", "slow_forte", "straight", "vibrato", "pp", "forte"}:
                    continue
                vowel = _vowel(source.name)
                if vowel is None:
                    continue
                # Keep the broad dynamics/register corpus on /a/.  The four
                # other vowels use steady held tones plus straight scales:
                # high-f0 voices need the scale's lower notes to resolve F1.
                # Dynamic/vibrato variants would multiply runtime without
                # adding independent formant evidence.
                if vowel != "a" and not (technique == "straight" and
                                          ("long_tones" in source.parts or "scales" in source.parts)):
                    continue
                relative = source.relative_to(source_root)
                safe_relative = ".".join(relative.parts[:-1])
                target = destination / f"vocalset.{singer}.{safe_relative}.{source.name}"
                shutil.copy2(source, target)
                copied.append(target.name)
        if not copied:
            raise RuntimeError(f"no VocalSet files selected for {instrument}")
        summary[instrument] = {**selection, "files": copied}
    return summary


def _entry(instrument: str, path: Path, iowa: dict[tuple[str, str], str],
           vocal_selection: dict[str, Any]) -> dict[str, Any]:
    name = path.name
    if (instrument, name) in iowa:
        source, licence, source_class = iowa[(instrument, name)], IOWA_LICENCE, "Iowa MIS"
        selection_basis = None
    elif name.startswith("phil."):
        source, licence, source_class = PHILHARMONIA_SOURCE, PHILHARMONIA_LICENCE, "Philharmonia"
        selection_basis = None
    elif name.startswith("vocalset.") and instrument in vocal_selection:
        source, licence, source_class = VOCALSET_SOURCE, VOCALSET_LICENCE, "VocalSet"
        selection_basis = vocal_selection[instrument]["basis"]
    else:
        raise ValueError(f"unresolved provenance: {instrument}/{name}")
    result = {
        "file": name,
        "bytes": path.stat().st_size,
        "sourceClass": source_class,
        "source": source,
        "licence": licence,
        "downloaded": TODAY,
        "dynamic": _dynamics(name),
        "vibrato": _vibrato(name),
        "noteSpanFromFilename": _note_span(name),
        "vowel": _vowel(name),
    }
    if selection_basis:
        result["selectionBasis"] = selection_basis
    return result


def write_contract(samples_root: Path, iowa_manifest: Path,
                   vocal_selection: dict[str, Any]) -> list[str]:
    iowa = _load_iowa_manifest(iowa_manifest)
    completed = []
    for folder in sorted(path for path in samples_root.iterdir() if path.is_dir()):
        files = _audio_files(folder)
        if not files:
            continue
        entries = [_entry(folder.name, path, iowa, vocal_selection) for path in files]
        provenance = {
            "instrument": folder.name,
            "generated": TODAY,
            "audioPolicy": "analysis-only external corpus; never commit or redistribute audio",
            "files": entries,
        }
        (folder / "PROVENANCE.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

        dynamics = Counter(row["dynamic"] for row in entries)
        vibrato = Counter(row["vibrato"] for row in entries)
        sources = Counter(row["sourceClass"] for row in entries)
        spans = [row["noteSpanFromFilename"] for row in entries if row["noteSpanFromFilename"]]
        lines = [
            f"# Coverage — {folder.name}\n\n",
            f"Audio files: **{len(entries)}**  \n",
            f"Sources: {', '.join(f'{key} ({value})' for key, value in sorted(sources.items()))}  \n",
            f"Dynamics: {', '.join(f'{key} ({value})' for key, value in sorted(dynamics.items()))}  \n",
            f"Vibrato labels: {', '.join(f'{key} ({value})' for key, value in sorted(vibrato.items()))}  \n",
            f"Vowels: {', '.join(sorted({row['vowel'] for row in entries if row['vowel']})) or 'not applicable'}  \n",
            f"Filename pitch spans: {', '.join(spans) if spans else 'multi-note VocalSet C/F scales plus held tones'}\n\n",
        ]
        if folder.name in vocal_selection:
            selection = vocal_selection[folder.name]
            lines.extend([
                "## Voice-source selection\n\n",
                f"Singer IDs: `{', '.join(selection['singers'])}`  \n",
                f"Basis: {selection['basis']}. VocalSet does not publish an ID-to-voice-type table; "
                "this is an empirically measured proxy and performer variability pair.\n\n",
            ])
        lines.extend([
            "## Files\n\n",
            "| File | Source | Dynamic | Vibrato | Pitch span |\n",
            "|---|---|---:|---:|---|\n",
        ])
        for row in entries:
            lines.append(f"| `{row['file']}` | {row['sourceClass']} | {row['dynamic']} | "
                         f"{row['vibrato']} | {row['noteSpanFromFilename'] or 'multi-note/held'} |\n")
        (folder / "COVERAGE.md").write_text("".join(lines), encoding="utf-8")
        completed.append(folder.name)
    return completed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=Path, default=Path("/private/tmp/sg2/samples"))
    parser.add_argument("--iowa-list", type=Path, default=Path("/private/tmp/sg2/iowa_list.txt"))
    parser.add_argument("--vocalset-root", type=Path,
                        default=Path("/private/tmp/sg2/vocalset_extract/FULL"))
    parser.add_argument("--skip-vocal-selection", action="store_true")
    args = parser.parse_args(argv)
    selection = {} if args.skip_vocal_selection else select_vocalset(args.vocalset_root, args.samples)
    completed = write_contract(args.samples, args.iowa_list, selection)
    print(json.dumps({"instruments": completed, "vocalSelection": selection}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
