"""Importable façade over the measured-profile per-note analyser.

The original fitter remains the CLI and source of truth.  This module turns
its array-oriented primitives into a stable per-file API shared by scoring,
reports and optimization, avoiding a second implementation of f0/partial/B/
attack/decay/vibrato analysis.
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

import numpy as np

from scripts.fit_profiles_from_samples import (  # re-exported intentionally
    NoteAnalysis,
    aggregate_instrument,
    analyse_instrument,
    analyse_note,
    load_mono,
    segment_notes,
)


def _strongest_segment(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    segments = segment_notes(samples, sample_rate)
    if not segments:
        return samples
    start, end = max(segments, key=lambda item: float(np.max(np.abs(samples[item[0]:item[1]]))))
    return samples[start:end]


def analyse_audio_samples(
    samples: np.ndarray,
    sample_rate: int,
    *,
    name: str = "audio",
    n_partials: int = 64,
    expected_f0_hz: float | None = None,
) -> NoteAnalysis:
    """Analyse the strongest note in mono samples using the profile fitter."""
    mono = np.asarray(samples, dtype=float)
    if mono.ndim != 1:
        mono = np.mean(mono, axis=-1)
    # A fitted soft render may intentionally be flute-like or breathy with
    # only two resolved low partials.  Corpus fitting keeps the stricter
    # five-partial noise rejection; paired scoring already has a known file,
    # stable f0 and reference, so accepting two prevents valid candidates
    # from crashing an optimiser session.
    note = analyse_note(_strongest_segment(mono, sample_rate), sample_rate, name,
                        n_partials, min_detected_partials=2,
                        expected_f0_hz=expected_f0_hz)
    if note is None:
        raise ValueError(f"no stable pitched note detected in {name}")
    return note


def analyse_audio_file(path: str | Path, *, n_partials: int = 64,
                       expected_f0_hz: float | None = None) -> NoteAnalysis:
    """Load and analyse the strongest note in an audio file."""
    path = Path(path)
    samples, sample_rate = load_mono(str(path))
    return analyse_audio_samples(samples, sample_rate, name=str(path),
                                 n_partials=n_partials,
                                 expected_f0_hz=expected_f0_hz)


def note_to_json(note: NoteAnalysis) -> dict[str, Any]:
    """JSON-safe representation used in cached run artifacts."""
    result = asdict(note)
    for key in ("partial_amps", "partial_freqs", "partial_snr_ok"):
        result[key] = np.asarray(result[key]).tolist()
    result["t60"] = [list(item) for item in result["t60"]]
    result["band_t90"] = {str(k): v for k, v in result["band_t90"].items()}
    return result


__all__ = [
    "NoteAnalysis", "aggregate_instrument", "analyse_instrument", "analyse_note",
    "load_mono", "segment_notes", "analyse_audio_samples", "analyse_audio_file",
    "note_to_json",
]
