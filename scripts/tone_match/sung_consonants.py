#!/usr/bin/env python3
"""Measure aligned spoken consonant onsets and apply annex S31-S33.

LibriSpeech supplies a licensed baseline, not a sung target.  Every emitted
row therefore retains both the spoken measurement and its explicit,
provisional speech-to-singing transform.  All scorer weights remain zero
until the consonant generator passes a consuming controllability audit (F11).
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
import math
from pathlib import Path
import re
from typing import Any

import numpy as np
import soundfile as sf


TARGET_PHONES = {
    "D": ("plosive", "alveolar", True),
    "T": ("plosive", "alveolar", False),
    "M": ("nasal", "labial", True),
    "S": ("fricative", "alveolar", False),
    "Z": ("fricative", "alveolar", True),
}
VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY",
          "IH", "IY", "OW", "OY", "UH", "UW"}

CONSONANT_FEATURE_WEIGHTS = {
    "consonant_burst_centroid_hz": 0.0,
    "consonant_burst_duration_ms": 0.0,
    "consonant_vot_ms": 0.0,
    "consonant_f1_transition_hz_s": 0.0,
    "consonant_f2_transition_hz_s": 0.0,
}


@dataclass(frozen=True)
class SungAdaptationPolicy:
    """Provisional S31-S33 transform; values are initialisers, never gates."""

    consonant_duration_scale: float = 0.70
    transition_duration_scale: float = 0.75
    voiceless_vot_scale: float = 0.65
    voiced_vot_scale: float = 1.10
    prebeat_anchor: str = "vowel-on-beat"
    evidence: str = "RESEARCH_SUNG_REALISM S31-S33; derived initialisers"


def _strip_stress(phone: str) -> str:
    return re.sub(r"\d+$", "", phone.strip().upper())


def parse_phone_tier(path: Path) -> list[dict[str, Any]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    marker = 'name = "phones"'
    start = text.find(marker)
    if start < 0:
        raise ValueError(f"phones tier missing from {path}")
    body = text[start:]
    pattern = re.compile(
        r"intervals \[\d+\]:\s+xmin = ([0-9.]+)\s+xmax = ([0-9.]+)\s+text = \"([^\"]*)\"",
        re.MULTILINE,
    )
    return [
        {"start": float(lo), "end": float(hi), "phone": phone}
        for lo, hi, phone in pattern.findall(body)
    ]


def _spectral_centroid(samples: np.ndarray, sample_rate: int) -> float | None:
    if len(samples) < 16:
        return None
    windowed = samples * np.hanning(len(samples))
    magnitude = np.abs(np.fft.rfft(windowed))
    frequency = np.fft.rfftfreq(len(samples), 1 / sample_rate)
    keep = frequency >= 80
    total = float(np.sum(magnitude[keep]))
    return float(np.sum(frequency[keep] * magnitude[keep]) / total) if total > 1e-12 else None


def _burst_time(samples: np.ndarray, sample_rate: int, absolute_start: float) -> float:
    frame = max(16, int(round(0.005 * sample_rate)))
    hop = max(8, int(round(0.002 * sample_rate)))
    if len(samples) <= frame:
        return absolute_start
    starts = np.arange(0, len(samples) - frame + 1, hop)
    rms = np.asarray([
        math.sqrt(float(np.mean(samples[index:index + frame] ** 2)) + 1e-12)
        for index in starts
    ])
    delta = np.diff(np.log(rms + 1e-9), prepend=np.log(rms[0] + 1e-9))
    search_start = int(0.2 * len(delta))
    picked = search_start + int(np.argmax(delta[search_start:]))
    return absolute_start + float(starts[picked]) / sample_rate


def _formants(samples: np.ndarray, sample_rate: int) -> tuple[float, float] | None:
    if len(samples) < int(0.015 * sample_rate):
        return None
    signal = np.asarray(samples, dtype=float)
    signal = signal[1:] - 0.97 * signal[:-1]
    signal *= np.hamming(len(signal))
    order = min(16, max(8, 2 + sample_rate // 1000))
    corr = np.correlate(signal, signal, mode="full")[len(signal) - 1:len(signal) + order]
    if len(corr) <= order or corr[0] <= 1e-12:
        return None
    toeplitz = corr[np.abs(np.subtract.outer(np.arange(order), np.arange(order)))]
    try:
        coeff = np.linalg.solve(toeplitz + np.eye(order) * corr[0] * 1e-6, corr[1:order + 1])
    except np.linalg.LinAlgError:
        return None
    roots = np.roots(np.r_[1.0, -coeff])
    roots = roots[np.imag(roots) >= 0]
    frequencies = np.angle(roots) * sample_rate / (2 * np.pi)
    bandwidths = -0.5 * sample_rate / np.pi * np.log(np.maximum(np.abs(roots), 1e-9))
    candidates = sorted(float(freq) for freq, bw in zip(frequencies, bandwidths)
                        if 150 < freq < min(5000, sample_rate / 2 - 100) and 0 < bw < 700)
    return (candidates[0], candidates[1]) if len(candidates) >= 2 else None


def _transition(samples: np.ndarray, sample_rate: int, vowel_start: float,
                vowel_end: float) -> tuple[float | None, float | None]:
    def window(offset: float) -> np.ndarray:
        lo = int(round((vowel_start + offset) * sample_rate))
        hi = min(int(round(vowel_end * sample_rate)), lo + int(round(0.025 * sample_rate)))
        return samples[max(0, lo):max(0, hi)]

    early = _formants(window(0.005), sample_rate)
    late_offset = min(0.080, max(0.035, (vowel_end - vowel_start) * 0.45))
    late = _formants(window(late_offset), sample_rate)
    if not early or not late or late_offset <= 0:
        return None, None
    return ((late[0] - early[0]) / late_offset,
            (late[1] - early[1]) / late_offset)


def adapt_spoken_measurement(row: dict[str, Any],
                             policy: SungAdaptationPolicy) -> dict[str, Any]:
    vot_scale = policy.voiced_vot_scale if row["voiced"] else policy.voiceless_vot_scale
    duration = row["spokenDurationMs"] * policy.consonant_duration_scale
    vot = row["spokenVotMs"] * vot_scale if row.get("spokenVotMs") is not None else None
    transition = row.get("spokenTransitionMs")
    transition = transition * policy.transition_duration_scale if transition is not None else None
    lead = duration + max(0.0, vot or 0.0) + max(0.0, transition or 0.0)
    return {
        "durationMs": round(duration, 4),
        "votMs": round(vot, 4) if vot is not None else None,
        "transitionMs": round(transition, 4) if transition is not None else None,
        "preBeatMs": round(lead, 4),
        "anchor": policy.prebeat_anchor,
        "provisional": True,
    }


def measure_pair(audio_path: Path, grid_path: Path, phone_index: int,
                 phones: list[dict[str, Any]], policy: SungAdaptationPolicy) -> dict[str, Any]:
    current, following = phones[phone_index], phones[phone_index + 1]
    samples, sample_rate = sf.read(audio_path, dtype="float32", always_2d=False)
    if np.ndim(samples) > 1:
        samples = np.mean(samples, axis=1)
    lo = max(0, int(round(current["start"] * sample_rate)))
    hi = min(len(samples), int(round(current["end"] * sample_rate)))
    segment = np.asarray(samples[lo:hi], dtype=float)
    phone = _strip_stress(current["phone"])
    consonant_class, place, voiced = TARGET_PHONES[phone]
    burst_time = _burst_time(segment, sample_rate, current["start"])
    vot_ms = max(0.0, (following["start"] - burst_time) * 1000) if consonant_class == "plosive" else 0.0
    f1_slope, f2_slope = _transition(
        np.asarray(samples, dtype=float), sample_rate, following["start"], following["end"]
    )
    row = {
        "audio": str(audio_path),
        "alignment": str(grid_path),
        "phone": phone,
        "followingVowel": _strip_stress(following["phone"]),
        "class": consonant_class,
        "place": place,
        "voiced": voiced,
        "spokenDurationMs": round((current["end"] - current["start"]) * 1000, 4),
        "spokenBurstCentroidHz": _spectral_centroid(segment, sample_rate),
        "spokenBurstDurationMs": round(max(0.0, current["end"] - burst_time) * 1000, 4),
        "spokenVotMs": round(vot_ms, 4),
        "spokenTransitionMs": round(min(0.1, following["end"] - following["start"]) * 1000, 4),
        "spokenF1TransitionHzPerSec": f1_slope,
        "spokenF2TransitionHzPerSec": f2_slope,
        "sampleRate": sample_rate,
    }
    row["sungAdapted"] = adapt_spoken_measurement(row, policy)
    return row


def build_library(corpus_root: Path, output: Path, *, max_per_class: int = 64,
                  policy: SungAdaptationPolicy | None = None) -> dict[str, Any]:
    policy = policy or SungAdaptationPolicy()
    audio_root = corpus_root / "librispeech/LibriSpeech/dev-clean"
    alignment_root = corpus_root / "librispeech-alignments/dev-clean"
    rows = []
    counts = {"plosive": 0, "nasal": 0, "fricative": 0}
    for grid in sorted(alignment_root.rglob("*.TextGrid")):
        if all(value >= max_per_class for value in counts.values()):
            break
        audio = audio_root / grid.relative_to(alignment_root).with_suffix(".flac")
        if not audio.exists():
            continue
        phones = parse_phone_tier(grid)
        for index in range(len(phones) - 1):
            phone = _strip_stress(phones[index]["phone"])
            following = _strip_stress(phones[index + 1]["phone"])
            if phone not in TARGET_PHONES or following not in VOWELS:
                continue
            consonant_class = TARGET_PHONES[phone][0]
            if counts[consonant_class] >= max_per_class:
                continue
            rows.append(measure_pair(audio, grid, index, phones, policy))
            counts[consonant_class] += 1

    def median(key: str, group: list[dict[str, Any]]) -> float | None:
        values = [row[key] for row in group if isinstance(row.get(key), (int, float))]
        return round(float(np.median(values)), 4) if values else None

    classes = {}
    for consonant_class in counts:
        group = [row for row in rows if row["class"] == consonant_class]
        classes[consonant_class] = {
            "count": len(group),
            "spokenMedian": {
                key: median(key, group) for key in (
                    "spokenDurationMs", "spokenBurstCentroidHz",
                    "spokenBurstDurationMs", "spokenVotMs",
                    "spokenF1TransitionHzPerSec", "spokenF2TransitionHzPerSec",
                )
            },
            "sungAdaptedMedian": {
                key: round(float(np.median([
                    row["sungAdapted"][key] for row in group
                    if isinstance(row["sungAdapted"].get(key), (int, float))
                ])), 4) if group else None
                for key in ("durationMs", "votMs", "transitionMs", "preBeatMs")
            },
        }
    payload = {
        "schemaVersion": 1,
        "source": "LibriSpeech dev-clean + LibriSpeech Alignments",
        "license": "CC BY 4.0",
        "sourceMode": "spoken-fallback",
        "sungAdaptation": asdict(policy),
        "featureWeights": CONSONANT_FEATURE_WEIGHTS,
        "activationGate": "all weights remain zero until Agent A generator and Agent D responsiveness audit pass",
        "classes": classes,
        "rows": rows,
        "generatorSpec": {
            "latent": "existing shared articulation-strength draw",
            "neutral": {"consonantClass": "none", "consonantStrength": 0.0},
            "features": list(CONSONANT_FEATURE_WEIGHTS),
            "timing": "anticipate adapted gesture so the sustained vowel starts on beat",
            "transitions": "F1 starts near 250 Hz; F2 starts at place locus; both reach fitted vowel body by transition end",
        },
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--max-per-class", type=int, default=64)
    args = parser.parse_args()
    result = build_library(args.corpus, args.out, max_per_class=args.max_per_class)
    print(json.dumps({"classes": result["classes"], "weights": result["featureWeights"]}, indent=2))


if __name__ == "__main__":
    main()
