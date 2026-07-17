"""Pinned SG2 legacy-prior lookup and strongest-prior construction.

The craft rows are read from ``SPECTRAL_PERFORMANCE`` at the immutable
``sg2-legacy`` tag.  Spectral/body identity remains in the campaign seed;
measured pinned fields overlay the craft row.  This keeps the source of truth
at the owner-named anchor and makes every resolved prior independently
hashable in run reports.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
LEGACY_TAG = "sg2-legacy"


# This is the §2.4c table expressed as data.  Values never transfer between
# families: ``source`` selects only the named legacy craft idiom.
LEGACY_PRIOR_ROWS: dict[str, dict[str, Any]] = {
    "violin": {"source": "violin", "kind": "true-legacy"},
    "cello": {"source": "cello", "kind": "true-legacy"},
    "flute": {"source": "flute", "kind": "true-legacy"},
    "clarinet": {"source": "clarinet", "kind": "true-legacy"},
    "trumpet": {"source": "trumpet", "kind": "true-legacy"},
    "trombone": {"source": "trombone", "kind": "true-legacy"},
    "piano": {"source": "piano", "kind": "true-legacy"},
    "piano-grand": {"source": "piano", "kind": "true-legacy"},
    "grand-piano": {"source": "piano", "kind": "true-legacy"},
    "piano-upright": {"source": "piano", "kind": "craft-adaptation"},
    "upright-piano": {"source": "piano", "kind": "craft-adaptation"},
    "guitar-nylon": {"source": "piano", "kind": "pluck-adaptation"},
    "guitar-steel": {"source": "piano", "kind": "pluck-adaptation"},
    "guitar": {"source": "piano", "kind": "pluck-adaptation"},
    "harp": {"source": "piano", "kind": "pluck-adaptation"},
    "glockenspiel": {"source": "piano", "kind": "bar-strike-adaptation"},
    "marimba": {"source": "piano", "kind": "bar-strike-adaptation"},
    "xylophone": {"source": "piano", "kind": "bar-strike-adaptation"},
    "vibraphone": {"source": "piano", "kind": "bar-strike-adaptation"},
    "alto-sax": {"source": "clarinet", "kind": "reed-adaptation"},
    "tenor-sax": {"source": "clarinet", "kind": "reed-adaptation"},
    "french-horn": {"source": "trombone", "kind": "brass-adaptation"},
    "soprano": {"source": "vocal", "kind": "voice-class"},
    "mezzo-soprano": {"source": "vocal", "kind": "voice-class"},
    "tenor": {"source": "vocal", "kind": "voice-class"},
    "bass": {"source": "vocal", "kind": "voice-class"},
    "voice-soprano": {"source": "vocal", "kind": "voice-class"},
    "voice-mezzo": {"source": "vocal", "kind": "voice-class"},
    "voice-tenor": {"source": "vocal", "kind": "voice-class"},
    "voice-bass": {"source": "vocal", "kind": "voice-class"},
    "basso-profondo": {"kind": "derived", "parent": "bass"},
    "boy-soprano": {"kind": "derived", "parent": "soprano"},
}


# Campaign measurement fields are the final overlay in §2.4c.  Free craft
# controls such as excitationHuman and partialTransfer deliberately do not
# appear here: old sterile bests must not override the legacy prior.
PINNED_MEASUREMENT_KEYS = {
    "partialB", "partialMaterial", "materialT60", "bodyBands",
    "bodyStability", "resonancesFit", "partialsByRegister",
    "partialsByString", "attackNoiseFreq", "attackNoiseQ",
    "attackNoiseDecay", "attackNoiseByRegister", "bandT90ms",
    "envelopeAttack", "envelopeDecay", "envelopeSustain",
    "envelopeRelease", "envelopeAttackByRegister",
    "envelopeAttackByRegisterDynamic", "vibratoProb", "vibratoRate",
    "vibratoDepth", "vibratoRateSd", "vibratoDepthSd",
    "vibratoByRegisterDynamic", "bowNoise", "humanRanges",
}


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _extract_js_object(source: str, declaration: str) -> str:
    marker = f"const {declaration} ="
    start = source.find(marker)
    if start < 0:
        raise ValueError(f"{declaration} missing at {LEGACY_TAG}")
    start = source.find("{", start + len(marker))
    depth = 0
    quote: str | None = None
    escaped = False
    line_comment = block_comment = False
    for index in range(start, len(source)):
        char = source[index]
        nxt = source[index + 1] if index + 1 < len(source) else ""
        if line_comment:
            if char == "\n":
                line_comment = False
            continue
        if block_comment:
            if char == "*" and nxt == "/":
                block_comment = False
            continue
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char == "/" and nxt == "/":
            line_comment = True
            continue
        if char == "/" and nxt == "*":
            block_comment = True
            continue
        if char in {'"', "'", "`"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    raise ValueError(f"unterminated {declaration} at {LEGACY_TAG}")


@lru_cache(maxsize=1)
def legacy_performance_rows() -> tuple[str, dict[str, dict[str, Any]]]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", f"{LEGACY_TAG}^{{commit}}"], cwd=ROOT,
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        source = subprocess.run(
            ["git", "show", f"{LEGACY_TAG}:web/static/synth.js"], cwd=ROOT,
            check=True, capture_output=True, text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError(
            f"owner escalation required: legacy anchor {LEGACY_TAG!r} is unavailable"
        ) from error
    object_source = _extract_js_object(source, "SPECTRAL_PERFORMANCE")
    script = f"const rows = {object_source}; process.stdout.write(JSON.stringify(rows));"
    try:
        rendered = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=ROOT,
            check=True, capture_output=True, text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("could not resolve legacy craft table with Node") from error
    rows = json.loads(rendered)
    if not isinstance(rows, dict):
        raise ValueError("legacy SPECTRAL_PERFORMANCE did not resolve to an object")
    return commit, rows


def _flatten_performance(performance: dict[str, Any]) -> dict[str, Any]:
    attack = performance.get("attackNoise", {})
    excitation = performance.get("excitation", {})
    flat = {key: value for key, value in performance.items()
            if key not in {"attackNoise", "excitation"}}
    flat.update({
        "attackNoiseLevel": attack.get("level"),
        "attackNoiseFreq": attack.get("freq"),
        "attackNoiseQ": attack.get("q"),
        "attackNoiseDecay": attack.get("decay"),
        "excitationType": excitation.get("type"),
        "excitationPosition": excitation.get("position"),
        "excitationHardness": excitation.get("hardness"),
        "excitationHuman": excitation.get("human"),
    })
    return {key: value for key, value in flat.items() if value is not None}


def resolve_legacy_prior(instrument: str, campaign_seed: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return strongest-prior params and the reportable resolved row."""
    key = instrument.strip().lower().replace("_", "-").replace(" ", "-")
    row = LEGACY_PRIOR_ROWS.get(key)
    if row is None:
        raise ValueError(
            f"owner escalation required: {instrument!r} has no §2.4c legacy-prior row"
        )
    if row["kind"] == "derived":
        morphology = campaign_seed.get("morphology")
        declared_parent = campaign_seed.get("derivedFrom")
        if not declared_parent and isinstance(morphology, dict):
            declared_parent = morphology.get("sourcePreset")
        if not declared_parent:
            raise ValueError(
                f"{instrument}: derived prior requires a frozen fitted parent preset"
            )
        resolved = dict(campaign_seed)
        report = {"instrument": key, **row, "tag": None, "commit": None,
                  "declaredParent": declared_parent}
    else:
        commit, rows = legacy_performance_rows()
        source = row["source"]
        if source not in rows:
            raise ValueError(f"legacy craft source {source!r} missing at {LEGACY_TAG}")
        craft = _flatten_performance(rows[source])
        pinned = {key: campaign_seed[key] for key in PINNED_MEASUREMENT_KEYS
                  if key in campaign_seed}
        resolved = {**campaign_seed, **craft, **pinned}
        # Family adaptations retain their campaign topology.  Only the craft
        # idiom transfers (e.g. piano craft, but a guitar still plucks).
        for topology_key in ("excitationType", "resonatorClass", "spectralProfile",
                             "sg2Family", "bodyType"):
            if topology_key in campaign_seed:
                resolved[topology_key] = campaign_seed[topology_key]
        report = {"instrument": key, **row, "tag": LEGACY_TAG,
                  "commit": commit, "craftHash": canonical_hash(craft)}
    report["rowHash"] = canonical_hash(report)
    report["resolvedParameterHash"] = canonical_hash(resolved)
    return resolved, report
