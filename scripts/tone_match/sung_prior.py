"""The mandatory SG2 legacy ``vocal`` craft prior for sung campaigns.

The values are an explicit lookup from tag ``sg2-legacy`` (e8d3ac1), not
neutral defaults or a voice-class judgement.  Corpus-fitted source partials
and per-vowel bodies are overlaid by :mod:`sung_fit`; craft values remain
unless the singer's own evidence measures a replacement.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


LEGACY_VOCAL_PRIOR_ROW = "voice-soprano/mezzo/tenor/bass -> legacy vocal"
LEGACY_VOCAL_PRIOR_TAG = "sg2-legacy"
LEGACY_VOCAL_PRIOR_COMMIT = "e8d3ac123c0f1c2647c4dbf03d48934b1966564d"

# Flattened effective craft lookup: the legacy Vocal Foundation factory module
# wins where it explicitly overlaid the SPECTRAL_PERFORMANCE.vocal row.  The
# ordinary legacy DEFAULTS provide envelopeProb and toneBreath.
LEGACY_VOCAL_CRAFT: dict[str, Any] = {
    "voiceMode": "fourier",
    "spectralMix": 0.9,
    "excitationType": "blow",
    "excitationPosition": 0.28,
    "excitationHardness": 0.42,
    "excitationHuman": 0.35,
    "envelopeProb": 0.35,
    "envelopeAttack": 0.06,
    "envelopeAttackSd": 0.02,
    "envelopeDecay": 0.06,
    "envelopeSustain": 0.78,
    "envelopeRelease": 0.28,
    "vibratoProb": 0.85,
    "vibratoRate": 5.5,
    "vibratoRateSd": 0.5,
    "vibratoDepth": 18.0,
    "vibratoDepthSd": 6.0,
    "attackNoiseLevel": 0.14,
    "attackNoiseFreq": 2200.0,
    "attackNoiseQ": 0.9,
    "attackNoiseDecay": 0.05,
    "partialMaterial": 0.42,
    "partialTransfer": 0.2,
    "spectralDynamicAmount": 0.8,
    "toneBreath": 0.03,
}


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


LEGACY_VOCAL_PRIOR_HASH = canonical_hash(LEGACY_VOCAL_CRAFT)


def prior_provenance() -> dict[str, str]:
    return {
        "row": LEGACY_VOCAL_PRIOR_ROW,
        "tag": LEGACY_VOCAL_PRIOR_TAG,
        "commit": LEGACY_VOCAL_PRIOR_COMMIT,
        "parameterHash": LEGACY_VOCAL_PRIOR_HASH,
    }


def params_for_mode(params: dict[str, Any], mode: str, *, seed: int | None = None) -> dict[str, Any]:
    """Resolve fit/ship render modes without mutating the fitted preset.

    Fit mode removes stochastic performance only for single-take scoring.
    Ship mode retains the complete craft layer and accepts a fresh build seed.
    """

    key = mode.strip().lower().replace("_", "-")
    result = dict(params)
    if key == "fit":
        result["excitationHuman"] = 0.0
        result["envelopeProb"] = 0.0
        result["vibratoProb"] = 0.0
    elif key == "ship":
        if float(result.get("excitationHuman", 0) or 0) <= 0:
            raise ValueError("ship-mode sung preset cannot carry excitationHuman <= 0")
        if float(result.get("envelopeProb", 0) or 0) <= 0:
            raise ValueError("ship-mode sung preset cannot omit envelope variation")
        if seed is not None:
            result["seed"] = int(seed)
    else:
        raise ValueError(f"unknown sung render mode: {mode!r}")
    result["sg2RenderMode"] = key
    return result


__all__ = [
    "LEGACY_VOCAL_CRAFT",
    "LEGACY_VOCAL_PRIOR_HASH",
    "params_for_mode",
    "prior_provenance",
]
