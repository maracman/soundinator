"""Sound Generator 2.0 strongest-prior lookup (§2.4c).

The lookup is deliberately data, not a heuristic.  Values below are the
effective craft parameters of the named legacy source at ``sg2-legacy``
(``e8d3ac1``).  Campaign builders overlay measured identity fields on this
craft layer; fit mode suppresses only stochastic Human draws, while ship mode
retains them.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from copy import deepcopy
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
LEGACY_TAG = "sg2-legacy"
LEGACY_COMMIT = "e8d3ac123c0f1c2647c4dbf03d48934b1966564d"
LEGACY_BLOBS = {
    "web/static/synth.js": "ea9ed79adbb2412bf2078f1a68af68374f76a017",
    "web/static/factory-presets.js": "99ecce9d63a72f8a1834b5145ce025f655a5018f",
}

# factory-sub-piano-natural, followed by SPECTRAL_PERFORMANCE.piano at the
# immutable anchor.  The performance layer wins for craft fields; measured
# campaign identity (tables/B/body/attack analysis) is overlaid afterwards.
_PIANO_FACTORY = {
    "voiceMode": "fourier",
    "spectralProfile": "piano",
    "spectralMix": 0.9,
    "excitationType": "strike",
    "excitationPosition": 0.12,
    "excitationHardness": 0.62,
    "excitationHuman": 0.35,
    "envelopeAttack": 0.006,
    "envelopeRelease": 0.28,
}
_PIANO_CRAFT = {
    "envelopeAttack": 0.004,
    "envelopeAttackSd": 0.001,
    "envelopeDecay": 0.35,
    "envelopeSustain": 0.28,
    "envelopeRelease": 0.3,
    "vibratoProb": 0.0,
    "vibratoRate": 5.0,
    "vibratoRateSd": 0.0,
    "vibratoDepth": 0.0,
    "vibratoDepthSd": 0.0,
    "attackNoiseLevel": 0.26,
    "attackNoiseFreq": 350.0,
    "attackNoiseQ": 0.7,
    "attackNoiseDecay": 0.02,
    "partialMaterial": 0.7,
    "excitationType": "strike",
    "excitationPosition": 0.12,
    "excitationHardness": 0.62,
    "excitationHuman": 0.1,
    "partialTransfer": 0.3,
    "spectralDynamicAmount": 1.0,
}

STRUCK_PRIOR_ROWS: dict[str, dict[str, Any]] = {
    "grand-piano": {
        "row": "piano-grand ← legacy piano (true legacy)",
        "profile": "piano", "excitation": "strike", "resonator": "string",
    },
    "piano-grand": {
        "row": "piano-grand ← legacy piano (true legacy)",
        "profile": "piano", "excitation": "strike", "resonator": "string",
    },
    "upright-piano": {
        "row": "piano-upright ← legacy piano craft; fitted upright identity",
        "profile": "piano-upright", "excitation": "strike", "resonator": "string",
    },
    "piano-upright": {
        "row": "piano-upright ← legacy piano craft; fitted upright identity",
        "profile": "piano-upright", "excitation": "strike", "resonator": "string",
    },
    "guitar-nylon": {
        "row": "guitar-nylon ← legacy piano craft adapted to pluck",
        "profile": "guitar", "excitation": "pluck", "resonator": "string",
    },
    "guitar-steel": {
        "row": "guitar-steel ← legacy piano craft adapted to pluck",
        "profile": "guitar-steel", "excitation": "pluck", "resonator": "string",
    },
    "harp": {
        "row": "harp ← legacy piano craft, pluck defaults",
        "profile": "harp", "excitation": "pluck", "resonator": "string",
    },
    "glockenspiel": {
        "row": "glockenspiel ← legacy piano craft, strike defaults, bar class",
        "profile": "glockenspiel", "excitation": "strike", "resonator": "bar",
        "shortEnvelope": True,
    },
    "marimba": {
        "row": "marimba interim ← legacy piano craft, strike defaults, bar class",
        "profile": "marimba", "excitation": "strike", "resonator": "bar",
        "shortEnvelope": True,
    },
    "xylophone": {
        "row": "xylophone interim ← legacy piano craft, strike defaults, bar class",
        "profile": "xylophone", "excitation": "strike", "resonator": "bar",
        "shortEnvelope": True,
    },
    "vibraphone": {
        "row": "vibraphone interim ← legacy piano craft, strike defaults, bar class",
        "profile": "vibraphone", "excitation": "strike", "resonator": "bar",
        "shortEnvelope": True,
    },
}


def canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()[:16]


def verify_anchor(repo_root: Path = ROOT) -> dict[str, Any]:
    """Fail loudly if the lookup tag or either evidence blob is not exact."""
    commit = subprocess.run(
        ["git", "rev-parse", LEGACY_TAG], cwd=repo_root, check=True,
        capture_output=True, text=True,
    ).stdout.strip()
    if commit != LEGACY_COMMIT:
        raise ValueError(f"{LEGACY_TAG} resolved to {commit}, expected {LEGACY_COMMIT}")
    resolved_blobs = {}
    for source, expected in LEGACY_BLOBS.items():
        actual = subprocess.run(
            ["git", "rev-parse", f"{LEGACY_TAG}:{source}"], cwd=repo_root,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        if actual != expected:
            raise ValueError(f"legacy source blob changed for {source}: {actual} != {expected}")
        resolved_blobs[source] = actual
    return {"tag": LEGACY_TAG, "commit": commit, "blobs": resolved_blobs}


def resolve_legacy_prior(instrument: str, *, mode: str = "ship",
                         repo_root: Path = ROOT) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return the table-selected struck prior and its resolved provenance."""
    if mode not in {"fit", "ship"}:
        raise ValueError(f"unknown prior mode: {mode}")
    key = instrument.strip().lower()
    if key not in STRUCK_PRIOR_ROWS:
        raise ValueError(f"OWNER ESCALATION: no §2.4c legacy-prior row for {instrument!r}")
    anchor = verify_anchor(repo_root)
    row = STRUCK_PRIOR_ROWS[key]
    params = {**deepcopy(_PIANO_FACTORY), **deepcopy(_PIANO_CRAFT)}
    params.update({
        "sg2Family": "struck-plucked",
        "spectralProfile": row["profile"],
        "excitationType": row["excitation"],
        "resonatorClass": row["resonator"],
    })
    if row.get("shortEnvelope"):
        params.update({
            "envelopeAttack": 0.004, "envelopeDecay": 0.12,
            "envelopeSustain": 0.12, "envelopeRelease": 0.3,
        })
    ship_human = float(params["excitationHuman"])
    if mode == "fit":
        params["excitationHuman"] = 0.0
    provenance = {
        **anchor,
        "instrument": key,
        "row": row["row"],
        "sourcePreset": "factory-sub-piano-natural",
        "sourceCraft": "SPECTRAL_PERFORMANCE.piano",
        "adaptation": row["excitation"],
        "mode": mode,
        "shipHuman": ship_human,
    }
    provenance["resolvedHash"] = canonical_hash(params)
    return params, provenance


def ship_mode_params(fit_params: dict[str, Any], ship_prior: dict[str, Any]) -> dict[str, Any]:
    """Restore the performance layer without changing fitted identity."""
    result = deepcopy(fit_params)
    result["excitationHuman"] = max(
        float(result.get("excitationHuman", 0.0) or 0.0),
        float(ship_prior.get("excitationHuman", 0.0) or 0.0),
    )
    if isinstance(ship_prior.get("_sg2Prior"), dict):
        result["_sg2Prior"] = deepcopy(ship_prior["_sg2Prior"])
    result["_sg2Mode"] = "ship"
    return result
