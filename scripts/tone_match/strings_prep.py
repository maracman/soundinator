#!/usr/bin/env python3
"""P3 string reference preparation (BOWED_PREFLIGHT, WP-6 preflight).

Builds the violin/cello reference sets WITHOUT starting any fitting
campaign (fits are gated on P2 landing plus the engine lane's P5 gates):

- carries the STRING identity (sulG/sulD/...) through references.json —
  the same pitch on different strings is a different sound;
- floor groups are same-string AND same-source AND duration-matched
  (take pairs are trimmed to a common duration, so a "1s vs long" pair
  cannot inflate the variability floor);
- long arco takes are trimmed to a single bow (amplitude-dip detection)
  so fits cannot chase bow-change artifacts as timbre;
- Iowa arco keeps the spectral role, Philharmonia vibrato takes keep the
  vibrato role (roles never mix inside one reference row);
- the L3 outlier screen runs per same-string/same-dynamic peer group and
  flagged takes are appended to the corpus COVERAGE.md for owner ears —
  flagged takes are excluded from references.json until cleared;
- the §2.5c humanisation take-pair inventory (true duplicates vs
  adjacent-semitone proxies vs vib/nonvib pairs) is written as
  take-pairs.json — the differential fitting itself comes later.

Artifacts land under SG2_DATA/campaigns/<instrument>/ and are
never committed.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any

import numpy as np

from scripts.tone_match.exclusions import is_excluded
from scripts.tone_match.paths import sg2_data_root
from scripts.fit_profiles_from_samples import (
    analyse_note,
    load_mono,
    rms_envelope,
    segment_notes,
    sf,
)

VELOCITY = {"pp": 0.2, "mf": 0.62, "ff": 0.92}

# Register anchors chosen so both the pp and ff Iowa runs on the named
# string contain the target pitch (verified against the sampled spans).
STRING_CAMPAIGNS: dict[str, list[dict[str, Any]]] = {
    "violin": [
        {"register": "low", "midi": 55, "string": "sulG",
         "pp": "Violin.arco.pp.sulG.G3B3.aiff", "ff": "Violin.arco.ff.sulG.G3B3.aiff"},
        {"register": "mid", "midi": 72, "string": "sulA",
         "pp": "Violin.arco.pp.sulA.C5A5.aiff", "ff": "Violin.arco.ff.sulA.C5Db6.aiff"},
        {"register": "high", "midi": 88, "string": "sulE",
         "pp": "Violin.arco.pp.sulE.Ab6B7.aiff", "ff": "Violin.arco.ff.sulE.C6Gb7.aiff"},
    ],
    "cello": [
        {"register": "low", "midi": 36, "string": "sulC",
         "pp": "Cello.arco.pp.sulC.C2Gb2.aiff", "ff": "Cello.arco.ff.sulC.C2A2.aiff"},
        {"register": "mid", "midi": 55, "string": "sulD",
         "pp": "Cello.arco.pp.sulD.D3B3.aiff", "ff": "Cello.arco.ff.sulD.D3B3.aiff"},
        # the sampled pp run on the upper A-string octave is B4–Ab5 and the
        # ff run C5–Bb5 — E5 sits inside both
        {"register": "high", "midi": 76, "string": "sulA",
         "pp": "Cello.arco.pp.sulA.B4Ab5.aiff", "ff": "Cello.arco.ff.sulA.C5Bb5.aiff"},
    ],
}

# Philharmonia note names of the campaign anchor pitches (for the catalogue
# duplicate-take search; MIDI 55 = G3, 72 = C5, 88 = E6, 36 = C2, 76 = E5).
PHIL_ANCHOR_NOTES = {
    "violin": {55: "G3", 72: "C5", 88: "E6"},
    "cello": {36: "C2", 55: "G3", 76: "E5"},
}

# Philharmonia catalogue length codes >= 0.5 s (the analyser needs at least
# a 0.2 s mid-note window); the quarter-second "025" takes are unusable.
_CATALOGUE_LENGTHS = ("05", "1", "15", "long", "phrase")
_CATALOGUE_DYNAMICS = {"pp": "pianissimo", "ff": "fortissimo"}


def find_catalogue_duplicates(catalogue_dir: Path, instrument: str) -> list[dict[str, Any]]:
    """Same note/dynamic/articulation multi-take groups at the anchor pitches.

    The Philharmonia catalogue holds several independent takes of the same
    note+dynamic+articulation under different length codes — trimmed to a
    common duration these are TRUE duplicate groups (owner direction
    2026-07-16), replacing adjacent-semitone proxies as the variability
    floor wherever they exist.  arco-normal takes carry the player's normal
    vibrato, so they never enter the Iowa spectral fit corpus; they are
    floor/§2.5c material read straight from the downloaded catalogue.
    """
    groups = []
    for midi, note in PHIL_ANCHOR_NOTES.get(instrument, {}).items():
        for dynamic, catalogue_dynamic in _CATALOGUE_DYNAMICS.items():
            names = [f"{instrument}_{note}_{length}_{catalogue_dynamic}_arco-normal.mp3"
                     for length in _CATALOGUE_LENGTHS]
            present = [name for name in names if (catalogue_dir / name).exists()]
            if len(present) >= 2:
                groups.append({"midi": midi, "note": note, "dynamic": dynamic,
                               "articulation": "arco-normal", "files": present})
    return groups

_STRING_RE = re.compile(r"\bsul([A-G])\b|\.sul([A-G])\.", re.IGNORECASE)
_PHIL_RE = re.compile(
    r"^phil\.(?P<instrument>[a-z-]+)_(?P<note>[A-Ga-g]s?\d)_"
    r"(?P<length>[^_]+)_(?P<dynamic>[a-z-]+)_(?P<vibrato>[a-z-]+)\.mp3$")

_NOTE_TO_MIDI = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def parse_string_label(filename: str) -> str | None:
    """sulA/sulD/... from an Iowa string filename; None when unlabelled."""
    match = _STRING_RE.search(filename)
    if not match:
        return None
    return "sul" + (match.group(1) or match.group(2)).upper()


def parse_phil_name(filename: str) -> dict[str, Any] | None:
    """Philharmonia naming: instrument_Note_length_dynamic_vibrato.mp3."""
    match = _PHIL_RE.match(filename)
    if not match:
        return None
    note = match.group("note")
    letter = note[0].upper()
    sharp = "s" in note[1:-1].lower()
    octave = int(note[-1])
    midi = (octave + 1) * 12 + _NOTE_TO_MIDI[letter] + (1 if sharp else 0)
    return {
        "midi": midi,
        "length": match.group("length"),
        "dynamic": match.group("dynamic"),
        "vibrato": "vib" if "vibrato" in match.group("vibrato") and
                   "non" not in match.group("vibrato") else "nonvib",
    }


def trim_to_single_bow(segment: np.ndarray, sample_rate: int,
                       dip_ratio: float = 0.45) -> tuple[np.ndarray, bool]:
    """Trim a bowed take to its longest single-bow span.

    A bow direction change mid-note reads as a deep, short amplitude dip
    between two sustained plateaus.  Detect interior envelope minima below
    ``dip_ratio`` of the surrounding sustain level and keep the longest
    clean span.  Returns (trimmed segment, whether a change was detected).
    """
    envelope, hop = rms_envelope(segment, sample_rate)
    if len(envelope) < 24:
        return segment, False
    peak = float(np.max(envelope))
    if peak <= 0:
        return segment, False
    # interior: skip the attack and release quarters of the envelope
    lo = len(envelope) // 5
    hi = len(envelope) - max(2, len(envelope) // 8)
    if hi - lo < 8:
        return segment, False
    sustain = float(np.median(envelope[lo:hi]))
    if sustain <= 0:
        return segment, False
    cut_points = []
    j = lo
    while j < hi:
        if envelope[j] < dip_ratio * sustain:
            # centre of this dip
            k = j
            while k < hi and envelope[k] < dip_ratio * sustain:
                k += 1
            cut_points.append((j + k) // 2)
            j = k
        else:
            j += 1
    if not cut_points:
        return segment, False
    bounds = [0] + [int(c * hop) for c in cut_points] + [len(segment)]
    spans = [(bounds[i], bounds[i + 1]) for i in range(len(bounds) - 1)]
    start, end = max(spans, key=lambda span: span[1] - span[0])
    return segment[start:end], True


def _note_features(note) -> dict[str, float] | None:
    """Scalar features for the L3 z-score screen."""
    amps = np.maximum(np.asarray(note.partial_amps[:24], dtype=float), 1e-6)
    db = 20 * np.log10(amps / float(np.max(amps)))
    audible = db > -55
    if np.count_nonzero(audible) < 4:
        return None
    ranks = np.arange(1, len(db) + 1, dtype=float)
    tilt = float(np.polyfit(np.log2(ranks[audible]), db[audible], 1)[0])
    power = amps * amps
    index = float(np.dot(ranks, power) / max(float(power.sum()), 1e-12))
    noise = note.attack_noise or {}
    return {
        "tiltDbPerOct": tilt,
        "spectralIndex": index,
        "attackNoiseLevel": float(noise.get("level", 0) or 0),
    }


# Only SPECTRAL deviations auto-exclude a take (L3's motivating case was a
# mute — a spectral wrongness).  Attack-noise level varies note to note as
# normal human articulation — the very §2.5c signal the campaign wants to
# keep — so its flags are advisory: queued for owner ears, never auto-cut.
_ADVISORY_FEATURES = {"attackNoiseLevel"}


def screen_outliers(rows: list[dict[str, Any]], z_threshold: float = 2.5,
                    min_peers: int = 5) -> list[dict[str, Any]]:
    """L3 automated QC: flag takes whose features sit far from their peers.

    ``rows`` carry {group, name, features}; peers are rows sharing ``group``
    (same instrument, string, dynamic, source).  Returns flag records with
    the offending feature, its z-score and whether the flag is advisory.
    """
    flags = []
    by_group: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_group.setdefault(row["group"], []).append(row)
    for group, members in by_group.items():
        if len(members) < min_peers:
            continue
        keys = sorted(members[0]["features"])
        for key in keys:
            values = np.asarray([m["features"][key] for m in members], dtype=float)
            sd = float(values.std(ddof=1))
            if sd <= 1e-9:
                continue
            mean = float(values.mean())
            for member, value in zip(members, values):
                z = (float(value) - mean) / sd
                if abs(z) > z_threshold:
                    flags.append({"group": group, "name": member["name"],
                                  "feature": key, "z": round(float(z), 2),
                                  "value": round(float(value), 4),
                                  "advisory": key in _ADVISORY_FEATURES})
    return flags


def inventory_take_pairs(filenames: list[str]) -> dict[str, list[dict[str, Any]]]:
    """§2.5c pairing table from Philharmonia filenames.

    - trueDuplicates: same pitch, dynamic and vibrato — differences are
      purely human (strongest §2.5c evidence);
    - vibratoPairs: same pitch and dynamic, vib vs nonvib (vibrato
      differential evidence);
    - the adjacent-semitone PROXY class comes from Iowa chromatic runs and
      is inventoried per file rather than per pair (weaker evidence per
      §2.5c item 4 — log the source that calibrated each range).
    """
    parsed = []
    for name in filenames:
        meta = parse_phil_name(name)
        if meta:
            parsed.append({"file": name, **meta})
    true_duplicates: list[dict[str, Any]] = []
    vibrato_pairs: list[dict[str, Any]] = []
    for i in range(len(parsed)):
        for j in range(i + 1, len(parsed)):
            a, b = parsed[i], parsed[j]
            if a["midi"] != b["midi"] or a["dynamic"] != b["dynamic"]:
                continue
            record = {"midi": a["midi"], "dynamic": a["dynamic"],
                      "files": sorted([a["file"], b["file"]])}
            if a["vibrato"] == b["vibrato"]:
                true_duplicates.append({**record, "vibrato": a["vibrato"]})
            else:
                vibrato_pairs.append(record)
    return {"trueDuplicates": true_duplicates, "vibratoPairs": vibrato_pairs}


def _midi_of(f0: float) -> int:
    return int(round(69 + 12 * math.log2(f0 / 440.0)))


def _duration_bucket(seconds: float) -> str:
    return f"{round(seconds * 2) / 2:.1f}s"


def _select_segment(path: Path, target_midi: int):
    samples, sample_rate = load_mono(str(path))
    candidates = []
    for start, end in segment_notes(samples, sample_rate, merge_gap_s=0.25):
        segment = samples[start:end]
        note = analyse_note(segment, sample_rate, str(path), 16)
        if note is not None:
            candidates.append((abs(_midi_of(note.f0) - target_midi), segment, note.f0))
    if not candidates:
        raise RuntimeError(f"no analysable note in {path}")
    _, segment, f0 = min(candidates, key=lambda row: row[0])
    if abs(_midi_of(f0) - target_midi) > 1:
        raise RuntimeError(f"{path}: closest detected MIDI {_midi_of(f0)} "
                           f"is not target {target_midi}")
    return segment, sample_rate, f0


def build_string_references(instrument: str, samples_root: Path,
                            output_root: Path,
                            catalogue_root: Path | None = None) -> dict[str, Any]:
    if instrument not in STRING_CAMPAIGNS:
        raise ValueError(f"unsupported string instrument: {instrument}")
    corpus = samples_root / instrument
    output = output_root / instrument
    notes_dir = output / "references"
    notes_dir.mkdir(parents=True, exist_ok=True)

    # ── L3 screen over the Iowa spectral corpus, per string×dynamic ──
    screen_rows = []
    bow_trims = []
    for path in sorted(corpus.glob("*.aiff")):
        string = parse_string_label(path.name)
        dynamic = next((d for d in ("pp", "mf", "ff") if f".{d}." in path.name), None)
        if string is None or dynamic is None:
            continue
        samples, sample_rate = load_mono(str(path))
        for start, end in segment_notes(samples, sample_rate, merge_gap_s=0.25):
            segment = samples[start:end]
            trimmed, changed = trim_to_single_bow(segment, sample_rate)
            if changed:
                bow_trims.append({"file": path.name,
                                  "atSec": round(start / sample_rate, 2),
                                  "keptSec": round(len(trimmed) / sample_rate, 2)})
            note = analyse_note(trimmed, sample_rate, str(path), 24)
            if note is None:
                continue
            features = _note_features(note)
            if features is None:
                continue
            screen_rows.append({
                "group": f"{instrument}|{string}|{dynamic}|Iowa",
                "name": f"{path.name}#{_midi_of(note.f0)}",
                "features": features,
            })
    flags = screen_outliers(screen_rows)
    flagged_names = {flag["name"] for flag in flags if not flag["advisory"]}

    # ── reference rows: Iowa spectral anchors (single-bow, per-string) ──
    references = []
    for anchor in STRING_CAMPAIGNS[instrument]:
        for dynamic in ("pp", "ff"):
            source = corpus / anchor[dynamic]
            segment, sample_rate, f0 = _select_segment(source, anchor["midi"])
            segment, _ = trim_to_single_bow(segment, sample_rate)
            midi = _midi_of(f0)
            if f"{source.name}#{midi}" in flagged_names:
                continue  # flagged takes wait for owner ears (L3)
            peak = float(np.max(np.abs(segment)))
            if peak > 0.99:
                segment = segment * (0.99 / peak)
            target = notes_dir / (f"iowa-{anchor['register']}-{dynamic}-"
                                  f"{anchor['string']}-{midi}.wav")
            sf.write(target, segment, sample_rate, subtype="PCM_16")
            duration = len(segment) / sample_rate
            render_duration = max(0.5, min(2.0, duration * 0.72))
            references.append({
                "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
                "velocity": VELOCITY[dynamic], "dynamic": dynamic,
                "register": anchor["register"], "string": anchor["string"],
                "durationSec": render_duration,
                "articulation": "arco", "vibrato": "spectral-role",
                "floorGroup": (f"{midi}|{dynamic}|arco|{anchor['string']}|Iowa|"
                               f"{_duration_bucket(render_duration)}"),
                "sourceClass": "Iowa MIS", "sourceFile": source.name,
            })

    # ── Philharmonia same-pitch alternates (floor takes, duration-matched)
    # and the §2.5c pairing inventory.  Vibrato takes keep the vibrato role:
    # they are inventoried but never become spectral reference rows.
    phil_files = sorted(p.name for p in corpus.glob("phil.*.mp3"))
    pairs = inventory_take_pairs(phil_files)
    for pair in pairs["trueDuplicates"]:
        if pair["vibrato"] != "nonvib":
            continue  # spectral floor takes must be non-vibrato
        group_segments = []
        for file_name in pair["files"]:
            if is_excluded(file_name.replace("phil.", "")):
                continue  # T-012: owner-rejected take
            try:
                segment, sample_rate, f0 = _select_segment(corpus / file_name,
                                                           pair["midi"])
            except RuntimeError:
                continue
            segment, _ = trim_to_single_bow(segment, sample_rate)
            group_segments.append((file_name, segment, sample_rate, f0))
        if len(group_segments) < 2:
            continue
        # duration-match the pair by trimming to the shortest take
        min_len = min(len(seg) for _, seg, _, _ in group_segments)
        for file_name, segment, sample_rate, f0 in group_segments:
            segment = segment[:min_len]
            midi = _midi_of(f0)
            peak = float(np.max(np.abs(segment)))
            if peak > 0.99:
                segment = segment * (0.99 / peak)
            stem = Path(file_name).stem.replace("phil.", "")
            target = notes_dir / f"phil-floor-{stem}.wav"
            sf.write(target, segment, sample_rate, subtype="PCM_16")
            duration = len(segment) / sample_rate
            render_duration = max(0.5, min(2.0, duration * 0.72))
            references.append({
                "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
                "velocity": VELOCITY.get(pair["dynamic"], 0.42),
                "dynamic": pair["dynamic"],
                "register": "mid" if 55 <= midi <= 76 else
                            ("low" if midi < 55 else "high"),
                "string": "unlabelled",
                "durationSec": render_duration,
                "articulation": "arco", "vibrato": "nonvib",
                "floorGroup": (f"{midi}|{pair['dynamic']}|arco|unlabelled|"
                               f"Philharmonia|{_duration_bucket(render_duration)}"),
                "sourceClass": "Philharmonia", "sourceFile": file_name,
            })

    # ── Philharmonia CATALOGUE duplicate-take groups at the anchors ──
    # (owner direction 2026-07-16: real same-note/dynamic/articulation
    # takes replace adjacent-semitone proxies as the floor where they exist)
    catalogue_groups = []
    anchor_register = {a["midi"]: a["register"] for a in STRING_CAMPAIGNS[instrument]}
    catalogue_dir = (catalogue_root / instrument) if catalogue_root else None
    if catalogue_dir and catalogue_dir.is_dir():
        for group in find_catalogue_duplicates(catalogue_dir, instrument):
            group_segments = []
            for file_name in group["files"]:
                if is_excluded(file_name):
                    continue  # T-012: owner-rejected take
                try:
                    segment, sample_rate, f0 = _select_segment(
                        catalogue_dir / file_name, group["midi"])
                except RuntimeError:
                    continue
                segment, _ = trim_to_single_bow(segment, sample_rate)
                group_segments.append((file_name, segment, sample_rate, f0))
            if len(group_segments) < 2:
                continue
            min_len = min(len(seg) for _, seg, _, _ in group_segments)
            used = []
            for file_name, segment, sample_rate, f0 in group_segments:
                segment = segment[:min_len]
                midi = _midi_of(f0)
                peak = float(np.max(np.abs(segment)))
                if peak > 0.99:
                    segment = segment * (0.99 / peak)
                target = notes_dir / f"philcat-{Path(file_name).stem}.wav"
                sf.write(target, segment, sample_rate, subtype="PCM_16")
                duration = len(segment) / sample_rate
                render_duration = max(0.5, min(2.0, duration * 0.72))
                references.append({
                    "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
                    "velocity": VELOCITY[group["dynamic"]],
                    "dynamic": group["dynamic"],
                    "register": anchor_register.get(group["midi"], "mid"),
                    "string": "unlabelled",
                    "durationSec": render_duration,
                    "articulation": "arco", "vibrato": "normal",
                    "floorGroup": (f"{midi}|{group['dynamic']}|arco-normal|"
                                   f"unlabelled|PhilCat|"
                                   f"{_duration_bucket(render_duration)}"),
                    "sourceClass": "Philharmonia catalogue",
                    "sourceFile": file_name,
                })
                used.append(file_name)
            if len(used) >= 2:
                catalogue_groups.append({**group, "files": used})

    (output / "references.json").write_text(json.dumps(references, indent=2) + "\n")
    (output / "take-pairs.json").write_text(json.dumps({
        **pairs,
        "catalogueDuplicates": catalogue_groups,
        "adjacentSemitoneProxySources": [
            {"file": p.name, "string": parse_string_label(p.name),
             "note": "same-string same-dynamic chromatic run — register-trend-"
                     "removed adjacent notes are the §2.5c fallback proxy"}
            for p in sorted(corpus.glob("*.aiff")) if parse_string_label(p.name)
        ],
    }, indent=2) + "\n")

    # ── QC report → corpus COVERAGE.md (owner-ears queue, per L3) ──
    coverage = corpus / "COVERAGE.md"
    if coverage.exists():
        text = coverage.read_text()
        marker = "\n## Reference QC (automated L3 screen)\n"
        section = [marker]
        section.append(f"\nScreen run over {len(screen_rows)} single-bow notes; "
                       f"z-threshold 2.5 within same-string/same-dynamic/"
                       f"same-source peer groups.\n")
        if flags:
            section.append("\n| Take | Peer group | Feature | z | Action |\n"
                           "|---|---|---|---|---|\n")
            for flag in flags:
                action = "advisory (kept)" if flag["advisory"] else "excluded"
                section.append(f"| `{flag['name']}` | {flag['group']} | "
                               f"{flag['feature']} | {flag['z']} | {action} |\n")
            section.append("\nSpectral outliers are EXCLUDED from "
                           "references.json until owner ears pass them (L3 is "
                           "take-specific, not source-blanket); attack-noise "
                           "flags are advisory — articulation variation is "
                           "human material for §2.5c, not corpus damage.\n")
        else:
            section.append("\nNo outliers flagged.\n")
        if bow_trims:
            section.append(f"\nBow-change trims applied: {len(bow_trims)} "
                           "segments reduced to their longest single-bow span.\n")
        if marker in text:
            text = text.split(marker)[0]
        coverage.write_text(text + "".join(section))

    floor_groups = {}
    for row in references:
        floor_groups.setdefault(row["floorGroup"], 0)
        floor_groups[row["floorGroup"]] += 1
    summary = {
        "instrument": instrument,
        "references": len(references),
        "floorGroupsWithAlternates": sum(1 for n in floor_groups.values() if n >= 2),
        "flagged": flags,
        "bowChangeTrims": len(bow_trims),
        "trueDuplicatePairs": len(pairs["trueDuplicates"]),
        "catalogueDuplicateGroups": len(catalogue_groups),
        "vibratoPairs": len(pairs["vibratoPairs"]),
    }
    (output / "BUILD.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", choices=sorted(STRING_CAMPAIGNS),
                        action="append")
    data_root = sg2_data_root()
    parser.add_argument("--samples", type=Path, default=data_root / "samples")
    parser.add_argument("--output", type=Path, default=data_root / "campaigns")
    parser.add_argument("--phil-catalogue", type=Path,
                        default=data_root / "phil_strings" / "Strings",
                        help="downloaded Philharmonia strings catalogue root "
                             "(per-instrument folders) for duplicate-take floors")
    args = parser.parse_args(argv)
    instruments = args.instrument or list(STRING_CAMPAIGNS)
    summaries = [build_string_references(name, args.samples, args.output,
                                         catalogue_root=args.phil_catalogue)
                 for name in instruments]
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
