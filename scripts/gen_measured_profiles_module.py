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
    "microDriftCentsSd", "microDriftCentsRange", "microDriftCentsPerSecond",
    "onsetScoopProb", "onsetScoopDepthCents", "onsetScoopDepthSd",
    "onsetScoopSettleMs", "onsetArticulationCorrelation", "onsetPitchNotes",
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
        stagger = (v.get("attack") or {}).get("lowToHighStaggerMs")
        if isinstance(stagger, (int, float)):
            perf["lowToHighStaggerMs"] = round(stagger, 4)
        provenance_files = (v.get("provenance", {}) or {}).get("files", [])
        source_classes = sorted({row.get("sourceClass") for row in provenance_files
                                 if isinstance(row, dict) and row.get("sourceClass")})
        legacy_source = (v.get("provenance", {}) or {}).get("source", "")
        entry = {
            "partials": [{"amp": round(p["amp"], 5), "spread": round(p["spread"], 3)}
                         for p in v["partials"]],
            "partialB": v.get("partialB"),
            "material": round(v["material"]["suggestedMaterial"], 3),
            "performance": perf,
            "source": ", ".join(source_classes) or legacy_source,
            "notesAnalysed": len(v.get("notesAnalysed", [])),
        }
        resonances = v.get("resonances")
        if isinstance(resonances, list):
            entry["resonances"] = [{
                "freq": round(row["freq"], 1),
                "gain": round(row["gain"], 4),
                "width": round(row["width"], 4),
            } for row in resonances if isinstance(row, dict) and
                all(isinstance(row.get(key), (int, float))
                    for key in ("freq", "gain", "width"))]
            # T-010: the engine-facing subset of the fit provenance — the
            # JS consumer needs lowestF0Hz for the T-003 low-register
            # application cap and reconstructionAmount for the T-004
            # unity-at-default law; the engine's headless assertions fail
            # when these fields are absent or unused.
            fit = v.get("resonancesFit")
            if isinstance(fit, dict):
                entry["resonancesFit"] = {
                    key: fit[key] for key in
                    ("lowestF0Hz", "reconstructionAmount",
                     "roundTripShapeMaxDb", "bodyClampMaxDb",
                     "method", "splitHalfCorr", "peakHzA", "peakHzB",
                     "omittedReason")
                    if fit.get(key) is not None}
        vowel_formants = v.get("vowelFormants")
        if isinstance(vowel_formants, dict) and vowel_formants:
            entry["vowelFormants"] = vowel_formants
        registers = v.get("partialsByRegister")
        if isinstance(registers, list) and registers:
            entry["partialsByRegister"] = [{
                "f0": row["f0"],
                "partialB": row.get("partialB"),
                "partials": [{"amp": round(p["amp"], 5), "spread": round(p["spread"], 3)}
                             for p in row.get("partials", [])],
            } for row in registers if isinstance(row, dict) and row.get("partials")]
        strings = v.get("partialsByString")
        if isinstance(strings, dict) and strings:
            entry["partialsByString"] = {
                course: [{
                    "f0": row["f0"],
                    "partialB": row.get("partialB"),
                    "nNotes": row.get("nNotes"),
                    "partials": [
                        {"amp": round(p["amp"], 5),
                         "spread": round(p["spread"], 3)}
                        for p in row.get("partials", [])
                    ],
                } for row in rows if isinstance(row, dict) and row.get("partials")]
                for course, rows in sorted(strings.items())
                if isinstance(rows, list)
            }
        attack_registers = (v.get("attack") or {}).get("byRegister")
        if isinstance(attack_registers, list) and attack_registers:
            entry["attackByRegister"] = [{
                "f0": row["f0"],
                "envelopeAttack": row.get("envelopeAttack"),
                "lowToHighStaggerMs": row.get("lowToHighStaggerMs"),
                "bandT90ms": row.get("bandT90ms", {}),
            } for row in attack_registers if isinstance(row, dict) and
                isinstance(row.get("f0"), (int, float))]
        an = v["performance"].get("attackNoise")
        if isinstance(an, dict):
            entry["attackNoise"] = {k: round(x, 4) for k, x in an.items()
                                    if isinstance(x, (int, float))}
        # L14: the sustained bow residual is a measured, pinned component.
        # Keep its table and fitted level law intact; the optimiser may scale
        # the component but must never mutate this spectral shape.
        bow_noise = v.get("bowNoise")
        if isinstance(bow_noise, dict) and bow_noise.get("profilePinned") is True:
            entry["bowNoise"] = {
                "method": bow_noise.get("method"),
                "source": bow_noise.get("source"),
                "bandHz": bow_noise.get("bandHz"),
                "profilePinned": True,
                "profile": bow_noise.get("profile", []),
                "levelLaw": bow_noise.get("levelLaw", {}),
                "engineContract": bow_noise.get("engineContract", {}),
            }
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
