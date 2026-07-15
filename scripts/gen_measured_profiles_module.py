#!/usr/bin/env python3
"""Regenerate web/static/measured_profiles.js from measured_profiles.json.

The JSON is the full fit output of scripts/fit_profiles_from_samples.py
(diagnostics included); the JS module is the trimmed subset the engine
imports: 64 partial amps/spreads, suggested partialB and material, the
performance block (envelope/vibrato) and attack-noise fit.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "static" / "measured_profiles.json"
DST = ROOT / "web" / "static" / "measured_profiles.js"

PERF_KEYS = [
    "envelopeAttack", "envelopeAttackSd", "envelopeDecay", "envelopeSustain",
    "envelopeRelease", "vibratoProb", "vibratoRate", "vibratoRateSd",
    "vibratoDepth", "vibratoDepthSd",
    # Q8 attack stagger: measured low-to-high partial onset spread; flows to
    # the renderer when a future fit run provides it (hand defaults apply
    # until then — the current measured_profiles.json predates the fitter's
    # stagger support).
    "lowToHighStaggerMs",
]


def main():
    d = json.loads(SRC.read_text())
    out = {}
    for key, v in d.items():
        if not isinstance(v, dict) or "partials" not in v:
            continue
        perf = {k: round(v["performance"][k], 4) for k in PERF_KEYS
                if isinstance(v["performance"].get(k), (int, float))}
        entry = {
            "partials": [{"amp": round(p["amp"], 5), "spread": round(p["spread"], 3)}
                         for p in v["partials"]],
            "partialB": v.get("partialB"),
            "material": round(v["material"]["suggestedMaterial"], 3),
            "performance": perf,
            "source": (v.get("provenance", {}) or {}).get("source", ""),
        }
        registers = v.get("partialsByRegister")
        if isinstance(registers, list) and registers:
            entry["partialsByRegister"] = [{
                "f0": row["f0"],
                "partialB": row.get("partialB"),
                "partials": [{"amp": round(p["amp"], 5), "spread": round(p["spread"], 3)}
                             for p in row.get("partials", [])],
            } for row in registers if isinstance(row, dict) and row.get("partials")]
        an = v["performance"].get("attackNoise")
        if isinstance(an, dict):
            entry["attackNoise"] = {k: round(x, 4) for k, x in an.items()
                                    if isinstance(x, (int, float))}
        out[key] = entry

    DST.write_text(
        "// GENERATED from web/static/measured_profiles.json by "
        "scripts/fit_profiles_from_samples.py\n"
        "// (see docs/MEASURED_PROFILES.md for sources, licences and method).\n"
        "// Fitted from real recordings — no audio ships, only these parameters.\n"
        "// Regenerate: python3 scripts/gen_measured_profiles_module.py\n"
        "export const MEASURED_PROFILES = " + json.dumps(out, indent=2) + ";\n")
    print(f"wrote {DST} ({DST.stat().st_size} bytes, {len(out)} instruments)")


if __name__ == "__main__":
    main()
