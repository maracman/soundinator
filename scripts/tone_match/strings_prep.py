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
- Iowa arco keeps the spectral role, selected clean Iowa notes keep a
  separate onset role, and Philharmonia vibrato takes keep the vibrato role
  (roles never mix inside one reference row);
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
from scripts.tone_match.score import extract_features, weights_for_instrument
from scripts.tone_match.tripwires import (
    ENVELOPE_PEAK_ANCHORS,
    ROLE_BARS,
    TRIPWIRE_FEATURES,
    required_cells_by_bar,
)
from scripts.tone_match.paths import sg2_data_root
from scripts.tone_match.tail_audit import audit_references
from scripts.fit_profiles_from_samples import (
    analyse_note,
    estimate_f0,
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

# T-048: onset truth is selected independently of spectral truth.  These
# existing Iowa notes have a clean harmonic lock-in under the C18
# organisation metric while retaining low/mid/high x pp/ff coverage.
# Register-only attack anchors proved insufficient because the measured
# pp/ff band-T90 intervals do not always overlap.
ONSET_ROLE_MIDIS: dict[str, dict[str, dict[str, int]]] = {
    "violin": {
        "low": {"pp": 55, "ff": 55},
        "mid": {"pp": 79, "ff": 79},
        "high": {"pp": 88, "ff": 88},
    },
}

# T-040 body evidence is intentionally separate from the scoring anchors.
# These existing Iowa runs provide three dynamics over three lower/mid strings; the
# selected fundamentals and their low harmonics densely tile 250–600 Hz.
BODY_REFERENCE_RUNS: dict[str, list[dict[str, Any]]] = {
    "violin": [
        {"string": "sulG", "midis": tuple(range(55, 60))},
        {"string": "sulD", "midis": tuple(range(62, 70))},
        {"string": "sulA", "midis": tuple(range(72, 75))},
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

# T-044: dedicated vibrato-role evidence from the already-held curated
# Philharmonia takes. These rows never stand in for spectral/onset evidence.
VIBRATO_ROLE_FILES: dict[str, list[dict[str, Any]]] = {
    "violin": [
        {"file": "phil.violin_G3_1_mezzo-forte_molto-vibrato.mp3",
         "register": "low", "dynamic": "mf", "velocity": 0.62},
        {"file": "phil.violin_G3_long_forte_molto-vibrato.mp3",
         "register": "low", "dynamic": "f", "velocity": 0.82},
        {"file": "phil.violin_E5_1_mezzo-forte_molto-vibrato.mp3",
         "register": "mid", "dynamic": "mf", "velocity": 0.62},
        {"file": "phil.violin_E5_long_forte_molto-vibrato.mp3",
         "register": "mid", "dynamic": "f", "velocity": 0.82},
        {"file": "phil.violin_A6_1_mezzo-forte_molto-vibrato.mp3",
         "register": "high", "dynamic": "mf", "velocity": 0.62},
        {"file": "phil.violin_A6_long_forte_molto-vibrato.mp3",
         "register": "high", "dynamic": "f", "velocity": 0.82},
    ],
}


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
_IOWA_SPAN_RE = re.compile(
    r"\.([A-G](?:b|#)?-?\d)([A-G](?:b|#)?-?\d)\.aiff$", re.IGNORECASE)


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


def _named_note_midi(note: str) -> int:
    match = re.fullmatch(r"([A-Ga-g])([b#]?)(-?\d)", note)
    if not match:
        raise ValueError(f"invalid note name: {note}")
    letter, accidental, octave_text = match.groups()
    accidental_offset = 1 if accidental == "#" else -1 if accidental == "b" else 0
    return ((int(octave_text) + 1) * 12 + _NOTE_TO_MIDI[letter.upper()]
            + accidental_offset)


def iowa_filename_span(path: Path) -> tuple[int, int] | None:
    """Declared inclusive MIDI span of an Iowa chromatic-run filename."""
    match = _IOWA_SPAN_RE.search(path.name)
    if not match:
        return None
    endpoints = sorted((_named_note_midi(match.group(1)),
                        _named_note_midi(match.group(2))))
    return endpoints[0], endpoints[1]


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


def _nearest_harmonic_candidate(f0: float, target_hz: float) -> float:
    candidates = [f0 * ratio for k in range(1, 7)
                  for ratio in (1.0 / k, float(k))]
    return min(candidates,
               key=lambda value: abs(1200 * math.log2(value / target_hz)))


def select_chromatic_segments(path: Path, target_midis: tuple[int, ...],
                              max_error_cents: float = 85.0):
    """Assign one trimmed Iowa-run segment to each known chromatic pitch.

    The low violin fundamental can be weaker than its second harmonic, and
    long bows can create extra amplitude-separated regions.  Match the
    detected periodicity harmonically to the known run order/pitches, keep
    each segment at most once, and preserve the adjusted measured f0 rather
    than replacing it with equal temperament.
    """
    samples, sample_rate = load_mono(str(path))
    candidates = []
    for index, (start, end) in enumerate(
            segment_notes(samples, sample_rate, merge_gap_s=0.25)):
        segment, _ = trim_to_single_bow(samples[start:end], sample_rate)
        unconstrained = estimate_f0(segment, sample_rate)
        if unconstrained is not None and np.isfinite(unconstrained) and unconstrained > 0:
            candidates.append((index, segment, float(unconstrained)))
    selected = []
    used: set[int] = set()
    for midi in target_midis:
        target_hz = 440 * 2 ** ((midi - 69) / 12)
        ranked = []
        for index, segment, unconstrained in candidates:
            if index in used:
                continue
            adjusted = _nearest_harmonic_candidate(unconstrained, target_hz)
            cents = abs(1200 * math.log2(adjusted / target_hz))
            ranked.append((cents, index, segment, unconstrained, adjusted))
        if not ranked:
            raise RuntimeError(f"{path}: no remaining segment for MIDI {midi}")
        cents, index, segment, unconstrained, adjusted = min(
            ranked, key=lambda row: row[0])
        if cents > max_error_cents:
            raise RuntimeError(
                f"{path}: MIDI {midi} best segment is {cents:.1f} cents away")
        used.add(index)
        selected.append((midi, segment, sample_rate, unconstrained,
                         adjusted, cents))
    return selected


def select_chromatic_across_runs(sources: list[Path],
                                 target_midis: tuple[int, ...]):
    """Select target pitches across complementary Iowa acquisition runs.

    Reacquisition can split a string/dynamic corpus into several declared
    chromatic spans. Assign each requested pitch to the narrowest filename
    span that contains it, then retain the within-run one-segment-per-pitch
    constraint in :func:`select_chromatic_segments`.
    """
    assignments: dict[Path, list[int]] = {}
    for midi in target_midis:
        eligible = []
        for source in sources:
            span = iowa_filename_span(source)
            if span is not None and span[0] <= midi <= span[1]:
                eligible.append((span[1] - span[0], source.name, source))
        if not eligible:
            raise RuntimeError(
                f"no declared Iowa run covers MIDI {midi}: "
                f"{', '.join(source.name for source in sources)}")
        source = min(eligible)[2]
        assignments.setdefault(source, []).append(midi)

    selected = []
    for source, midis in assignments.items():
        for row in select_chromatic_segments(source, tuple(midis)):
            selected.append((*row, source))
    return sorted(selected, key=lambda row: target_midis.index(row[0]))


def bowed_seed(instrument: str, profile: dict[str, Any]) -> dict[str, Any]:
    """Campaign seed that pins the measured body decision for assertions."""
    performance = profile.get("performance") or {}
    fit = profile.get("resonancesFit") or {}
    resonances = profile.get("resonances") or []
    seed = {
        "seed": 7331,
        "sg2Family": "bowed",
        "voiceMode": "fourier",
        "spectralProfile": instrument,
        "spectralMix": 1.0,
        "spectralPartials": 64,
        "excitationType": "bow",
        "resonatorClass": "string",
        "bodyType": "auto",
        "excitationPosition": 0.09 if instrument == "violin" else 0.12,
        "excitationHuman": 0.0,
        "attackNoiseLevel": 1.0,
        "partialMaterial": (profile.get("material") or {}).get(
            "suggestedMaterial", 0.2),
        "partialTransfer": 0.1,
        "partialTilt": 0.0,
        "spectralDynamicAmount": 0.8,
        "spectralResonanceAmount": fit.get("reconstructionAmount", 1.0),
        "dynamicBlare": 0.0,
        "vibratoProb": performance.get("vibratoProb", 0.0),
        "vibratoDepth": performance.get("vibratoDepth", 0.0),
        "vibratoRate": performance.get("vibratoRate", 5.5),
    }
    if profile.get("partialsByString"):
        seed["partialsByString"] = profile["partialsByString"]
    if profile.get("humanRanges"):
        seed["humanRanges"] = profile["humanRanges"]
    if resonances or fit.get("omittedReason"):
        seed["bodyBands"] = resonances
        seed["bodyStability"] = {
            key: fit[key] for key in
            ("splitHalfCorr", "peakHzA", "peakHzB", "omittedReason")
            if fit.get(key) is not None
        }
    return seed


def build_string_references(instrument: str, samples_root: Path,
                            output_root: Path,
                            catalogue_root: Path | None = None,
                            measured_path: Path | None = None) -> dict[str, Any]:
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

    # ── T-040 dedicated body references: low chromatic, pitch-anchored ──
    body_references = []
    body_dir = output / "body-references"
    if instrument in BODY_REFERENCE_RUNS:
        body_dir.mkdir(parents=True, exist_ok=True)
        for dynamic in ("ff", "mf", "pp"):
            for run in BODY_REFERENCE_RUNS[instrument]:
                sources = sorted(corpus.glob(
                    f"{instrument.capitalize()}.arco.{dynamic}."
                    f"{run['string']}.*.aiff"))
                if not sources:
                    raise RuntimeError(
                        f"{instrument} {dynamic} {run['string']}: "
                        "no Iowa acquisition run found")
                for (midi, segment, sample_rate, unconstrained, expected_f0,
                     cents, source) in select_chromatic_across_runs(
                         sources, run["midis"]):
                    peak = float(np.max(np.abs(segment)))
                    if peak > 0.99:
                        segment = segment * (0.99 / peak)
                    target = body_dir / (
                        f"low-{midi:03d}-{dynamic}-{run['string']}.wav")
                    sf.write(target, segment, sample_rate, subtype="PCM_16")
                    # Consume the pitch anchor now so a generated manifest can
                    # never contain a segment the fitter will later reject.
                    check = analyse_note(
                        segment, sample_rate, str(target), 24,
                        expected_f0_hz=expected_f0)
                    if check is None:
                        raise RuntimeError(f"{target}: body reference rejected")
                    body_references.append({
                        "path": str(target),
                        "midi": midi,
                        "dynamic": dynamic,
                        "string": run["string"],
                        "sourceClass": "Iowa MIS",
                        "sourceFile": source.name,
                        "unconstrainedF0Hz": round(unconstrained, 6),
                        "expectedF0Hz": round(expected_f0, 6),
                        "pitchErrorCents": round(cents, 2),
                        "role": "fixed-body",
                    })

    partial_tile = sorted(
        partial
        for row in body_references
        for rank in range(1, 5)
        if 250 <= (partial := row["expectedF0Hz"] * rank) <= 600
    )
    tile_summary = None
    if partial_tile:
        tile_gaps = [
            partial_tile[0] - 250,
            *np.diff(partial_tile),
            600 - partial_tile[-1],
        ]
        tile_summary = {
            "targetHz": [250, 600],
            "points": len(partial_tile),
            "lowestHz": round(partial_tile[0], 1),
            "highestHz": round(partial_tile[-1], 1),
            "maxGapHz": round(max(tile_gaps), 1),
        }
    (output / "body-references.json").write_text(json.dumps({
        "instrument": instrument,
        "purpose": "T-040 low-register fixed-body evidence",
        "partialTiling": tile_summary,
        "references": body_references,
    }, indent=2) + "\n")

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
                "articulation": "arco", "vibrato": "not-vibrato-role",
                "roles": (
                    ["spectral"] if instrument in ONSET_ROLE_MIDIS
                    else ["spectral", "onset"]
                ),
                "floorGroup": (f"{midi}|{dynamic}|arco|{anchor['string']}|Iowa|"
                               f"{_duration_bucket(render_duration)}"),
                "sourceClass": "Iowa MIS", "sourceFile": source.name,
            })

    # ── T-048 dedicated onset-role rows ──
    onset_references = []
    attack_contract = []
    onset_midis = ONSET_ROLE_MIDIS.get(instrument, {})
    for anchor in STRING_CAMPAIGNS[instrument]:
        register = anchor["register"]
        for dynamic in ("pp", "ff"):
            target_midi = onset_midis.get(register, {}).get(dynamic)
            if target_midi is None:
                continue
            source = corpus / anchor[dynamic]
            [(midi, segment, sample_rate, unconstrained, expected_f0,
              cents)] = select_chromatic_segments(source, (target_midi,))
            peak = float(np.max(np.abs(segment)))
            if peak > 0.99:
                segment = segment * (0.99 / peak)
            target = notes_dir / (
                f"iowa-onset-{register}-{dynamic}-{anchor['string']}-{midi}.wav")
            sf.write(target, segment, sample_rate, subtype="PCM_16")
            bundle = extract_features(target, expected_f0_hz=expected_f0)
            lockin = bundle.onset_lockin_periods
            if lockin is None or lockin > 18:
                raise RuntimeError(
                    f"{source}: declared onset-role MIDI {midi} has "
                    f"lock-in {lockin!r}, expected <= 18 periods")
            band_t90 = {
                str(freq): round(
                    float(value.get("t90", 0) if isinstance(value, dict)
                          else value) * 1000, 3)
                for freq, value in bundle.note.band_t90.items()
            }
            if not band_t90:
                raise RuntimeError(
                    f"{source}: onset-role MIDI {midi} has no band-T90 evidence")
            mean_t90_ms = float(np.mean(list(band_t90.values())))
            duration = len(segment) / sample_rate
            render_duration = max(0.5, min(2.0, duration * 0.72))
            row = {
                "path": str(target), "midi": midi,
                "detectedF0": round(expected_f0, 3),
                "velocity": VELOCITY[dynamic], "dynamic": dynamic,
                "register": register, "string": anchor["string"],
                "durationSec": render_duration,
                "articulation": "arco", "vibrato": "not-vibrato-role",
                "roles": ["onset"],
                "floorGroup": (
                    f"{midi}|{dynamic}|arco-onset|{anchor['string']}|Iowa|"
                    f"{_duration_bucket(render_duration)}"),
                "sourceClass": "Iowa MIS", "sourceFile": source.name,
            }
            references.append(row)
            onset_references.append(row)
            attack_contract.append({
                "register": register,
                "dynamic": dynamic,
                "midi": midi,
                "f0": round(expected_f0, 6),
                "attack": round(mean_t90_ms / 1000, 6),
                "meanBandT90Ms": round(mean_t90_ms, 3),
                "bandT90Ms": band_t90,
                "onsetLockinPeriods": round(float(lockin), 6),
                "sourceFile": source.name,
                "pitchErrorCents": round(cents, 2),
                "unconstrainedF0Hz": round(unconstrained, 6),
            })

    # ── T-044 dedicated vibrato-role rows ──
    vibrato_references = []
    vibrato_contract = []
    for spec in VIBRATO_ROLE_FILES.get(instrument, []):
        source = corpus / spec["file"]
        if not source.exists() or is_excluded(source.name.replace("phil.", "")):
            continue
        parsed = parse_phil_name(source.name)
        if parsed is None:
            raise RuntimeError(f"cannot parse vibrato-role filename: {source}")
        segment, sample_rate, f0 = _select_segment(source, parsed["midi"])
        segment, _ = trim_to_single_bow(segment, sample_rate)
        peak = float(np.max(np.abs(segment)))
        if peak > 0.99:
            segment = segment * (0.99 / peak)
        midi = _midi_of(f0)
        target = notes_dir / (
            f"phil-vibrato-{spec['register']}-{spec['dynamic']}-{midi}.wav")
        sf.write(target, segment, sample_rate, subtype="PCM_16")
        check = analyse_note(
            segment, sample_rate, str(target), 24, expected_f0_hz=f0)
        measured_vibrato = (check.vibrato or {}) if check is not None else {}
        if not measured_vibrato.get("present"):
            raise RuntimeError(
                f"{source}: declared vibrato-role take has no stable "
                "measured vibrato")
        duration = len(segment) / sample_rate
        render_duration = max(0.5, min(2.0, duration * 0.72))
        row = {
            "path": str(target), "midi": midi, "detectedF0": round(f0, 3),
            "velocity": spec["velocity"], "dynamic": spec["dynamic"],
            "register": spec["register"], "string": "unlabelled",
            "durationSec": render_duration,
            "articulation": "arco", "vibrato": "molto-vibrato",
            "roles": ["vibrato"],
            "floorGroup": (
                f"{midi}|{spec['dynamic']}|arco-molto-vibrato|"
                f"unlabelled|Philharmonia|{_duration_bucket(render_duration)}"),
            "sourceClass": "Philharmonia", "sourceFile": source.name,
        }
        references.append(row)
        vibrato_references.append(row)
        vibrato_contract.append({
            "register": row["register"],
            "dynamic": row["dynamic"],
            "midi": row["midi"],
            "prob": 1.0,
            "rate": round(float(measured_vibrato["rate"]), 6),
            "depth": round(float(measured_vibrato["depth"]), 6),
            "sourceFile": row["sourceFile"],
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
                "roles": ["floor"],
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
                    "roles": ["floor"],
                    "floorGroup": (f"{midi}|{group['dynamic']}|arco-normal|"
                                   f"unlabelled|PhilCat|"
                                   f"{_duration_bucket(render_duration)}"),
                    "sourceClass": "Philharmonia catalogue",
                    "sourceFile": file_name,
                })
                used.append(file_name)
            if len(used) >= 2:
                catalogue_groups.append({**group, "files": used})

    references = audit_references(references)
    (output / "references.json").write_text(json.dumps(references, indent=2) + "\n")
    coverage_weights = weights_for_instrument(instrument)
    active_coverage_bars = {
        bar for bar, feature in TRIPWIRE_FEATURES.items()
        if float(coverage_weights.get(feature, 0)) > 0
    }
    if instrument in ENVELOPE_PEAK_ANCHORS:
        active_coverage_bars.add("envelope-peak")
    coverage_contract = required_cells_by_bar(
        references, active_coverage_bars)
    (output / "coverage-contract.json").write_text(json.dumps({
        "instrument": instrument,
        "roles": {role: sorted(bars) for role, bars in ROLE_BARS.items()},
        "requiredCellsByBar": coverage_contract,
    }, indent=2) + "\n")
    (output / "vibrato-contract.json").write_text(json.dumps({
        "instrument": instrument,
        "purpose": "T-047 register/dynamic vibrato consumer contract",
        "vibratoByRegisterDynamic": vibrato_contract,
    }, indent=2) + "\n")
    (output / "attack-contract.json").write_text(json.dumps({
        "instrument": instrument,
        "purpose": "T-048 register/dynamic local bow-attack contract",
        "envelopeAttackByRegisterDynamic": attack_contract,
    }, indent=2) + "\n")
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
    if measured_path and measured_path.is_file():
        measured = json.loads(measured_path.read_text())
        if instrument in measured:
            seed = bowed_seed(instrument, measured[instrument])
            if vibrato_contract:
                seed["vibratoByRegisterDynamic"] = vibrato_contract
            if attack_contract:
                seed["envelopeAttackByRegisterDynamic"] = attack_contract
            (output / "initial.json").write_text(
                json.dumps(seed, indent=2) + "\n")

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
        "referencesByRole": {
            role: sum(role in row.get("roles", []) for row in references)
            for role in ROLE_BARS
        },
        "vibratoReferences": len(vibrato_references),
        "onsetReferences": len(onset_references),
        "coverageContract": coverage_contract,
        "bodyReferences": len(body_references),
        "bodyPartialTiling": tile_summary,
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
    parser.add_argument("--measured", type=Path,
                        default=Path("web/static/measured_profiles.json"),
                        help="measured profile JSON used to pin the bowed seed")
    args = parser.parse_args(argv)
    instruments = args.instrument or list(STRING_CAMPAIGNS)
    summaries = [build_string_references(name, args.samples, args.output,
                                         catalogue_root=args.phil_catalogue,
                                         measured_path=args.measured)
                 for name in instruments]
    print(json.dumps(summaries, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
