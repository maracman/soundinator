#!/usr/bin/env python3
"""Activation/controllability audit for the sung consonant generator."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import soundfile as sf


SCHEMA_KEYS = (
    "consonantClass", "consonantPlace", "consonantVoiced",
    "consonantStrength", "consonantBurstHz", "consonantBurstDurationMs",
    "consonantVotMs", "consonantF2LocusHz", "consonantTransitionMs",
    "consonantNasalZeroHz", "consonantFricativeHz",
)

FEATURE_RESPONDERS = {
    "consonant_burst_centroid_hz": ("burst-low", "burst-high"),
    "consonant_burst_duration_ms": ("burst-short", "burst-long"),
    "consonant_vot_ms": ("vot-short", "vot-long"),
    "consonant_f1_transition_hz_s": ("transition-short", "transition-long"),
    "consonant_f2_transition_hz_s": ("locus-low", "locus-high"),
}

VOICE_AUDIT_MIDI = {
    "voice-bass": 48,
    "voice-tenor": 60,
    "voice-mezzo": 67,
    "voice-soprano": 72,
}


def _pcm(path: Path) -> tuple[np.ndarray, int]:
    samples, sample_rate = sf.read(path, dtype="float32", always_2d=True)
    return np.mean(samples, axis=1, dtype=np.float64), int(sample_rate)


def _relative_difference_db(left: np.ndarray, right: np.ndarray,
                            sample_rate: int, *, end_ms: float = 220.0) -> float:
    count = min(len(left), len(right), int(round(end_ms * sample_rate / 1000)))
    reference = max(
        math.sqrt(float(np.mean(left[:count] ** 2))),
        math.sqrt(float(np.mean(right[:count] ** 2))),
        1e-12,
    )
    difference = math.sqrt(float(np.mean((left[:count] - right[:count]) ** 2)))
    return 20 * math.log10(max(difference, 1e-12) / reference)


def _class_params(fit: dict, name: str) -> dict:
    classes = fit["classes"]
    adapted = classes[name]["sungAdaptedMedian"]
    spoken = classes[name]["spokenMedian"]
    duration = adapted["durationMs"]
    if name == "plosive":
        duration = (spoken["spokenBurstDurationMs"]
                    * fit["sungAdaptation"]["consonant_duration_scale"])
    duration = round(float(duration), 4)
    common = {
        "consonantClass": name,
        "consonantPlace": "labial" if name == "nasal" else "alveolar",
        "consonantVoiced": name == "nasal",
        "consonantStrength": 0.75,
        "consonantBurstDurationMs": duration,
        "consonantVotMs": adapted["votMs"] or 0,
        "consonantF2LocusHz": 1100 if name == "nasal" else 1800,
        "consonantTransitionMs": adapted["transitionMs"],
        "consonantPreBeatMs": min(120, adapted["preBeatMs"]),
    }
    if name == "plosive":
        common["consonantBurstHz"] = spoken["spokenBurstCentroidHz"]
    elif name == "nasal":
        common["consonantNasalZeroHz"] = 1000
    else:
        common["consonantFricativeHz"] = spoken["spokenBurstCentroidHz"]
    return common


def _render_output_audit(repo_root: Path, fit: dict, instrument: str,
                         voice_best: Path, run_root: Path,
                         render_script: Path) -> dict:
    best = json.loads(voice_best.read_text())
    if best.get("instrument") != instrument:
        raise ValueError(
            f"{voice_best} belongs to {best.get('instrument')!r}, not {instrument!r}"
        )
    base = dict(best["paramsByVowel"]["a"])
    base.update({
        "seed": 70703,
        "excitationHuman": 0,
        "envelopeProb": 0,
        "vibratoProb": 0,
        "reverbWet": 0,
    })
    provenance = {
        "source": fit["source"],
        "license": fit["license"],
        "qc": True,
        "sourceMode": fit["sourceMode"],
        "sungAdaptation": fit["sungAdaptation"],
    }
    plosive = _class_params(fit, "plosive")
    candidates = {
        "neutral": {"consonantClass": "none", "consonantStrength": 0,
                    "consonantProvenance": provenance},
        "neutral-repeat": {"consonantClass": "none", "consonantStrength": 0,
                           "consonantProvenance": provenance},
        "unlicensed": {**plosive, "consonantProvenance": None},
        "plosive": {**plosive, "consonantProvenance": provenance},
        "plosive-repeat": {**plosive, "consonantProvenance": provenance},
        "nasal": {**_class_params(fit, "nasal"),
                  "consonantProvenance": provenance},
        "fricative": {**_class_params(fit, "fricative"),
                      "consonantProvenance": provenance},
        "burst-low": {**plosive, "consonantBurstHz": 900,
                      "consonantProvenance": provenance},
        "burst-high": {**plosive, "consonantBurstHz": 6000,
                       "consonantProvenance": provenance},
        "burst-short": {**plosive, "consonantBurstDurationMs": 8,
                        "consonantProvenance": provenance},
        "burst-long": {**plosive, "consonantBurstDurationMs": 55,
                       "consonantProvenance": provenance},
        "vot-short": {**plosive, "consonantVotMs": 5,
                      "consonantProvenance": provenance},
        "vot-long": {**plosive, "consonantVotMs": 75,
                     "consonantProvenance": provenance},
        "transition-short": {**plosive, "consonantTransitionMs": 20,
                             "consonantProvenance": provenance},
        "transition-long": {**plosive, "consonantTransitionMs": 140,
                            "consonantProvenance": provenance},
        "locus-low": {**plosive, "consonantF2LocusHz": 800,
                      "consonantProvenance": provenance},
        "locus-high": {**plosive, "consonantF2LocusHz": 2800,
                       "consonantProvenance": provenance},
    }
    render_root = run_root / "renders"
    render_root.mkdir(parents=True, exist_ok=True)
    jobs = []
    midi = VOICE_AUDIT_MIDI[instrument]
    for name, override in candidates.items():
        jobs.append({
            "params": {**base, **override},
            "midi": midi,
            "velocity": 0.62,
            "durationSec": 0.8,
            "sampleRate": 24000,
            "out": str(render_root / f"{name}.wav"),
        })
    jobs_path = run_root / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(
        ["node", str(render_script), "--batch", str(jobs_path)],
        cwd=repo_root, check=True,
        env={**os.environ, "PYTHON": sys.executable},
    )
    pcm = {}
    sample_rate = None
    for name in candidates:
        pcm[name], rate = _pcm(render_root / f"{name}.wav")
        sample_rate = rate if sample_rate is None else sample_rate
        if rate != sample_rate:
            raise ValueError("consonant audit renders have inconsistent sample rates")
    (run_root / "consonant-listening-manifest.json").write_text(json.dumps({
        "title": f"{instrument} · fitted consonant onsets (pass 08)",
        "status": "provisional LibriSpeech spoken-to-sung adaptation",
        "baseline": str(render_root / "neutral.wav"),
        "rows": [
            {"label": name, "render": str(render_root / f"{name}.wav")}
            for name in ("plosive", "nasal", "fricative")
        ],
    }, indent=2) + "\n")
    neutral_difference = {
        name: round(_relative_difference_db(pcm["neutral"], pcm[name], sample_rate), 4)
        for name in ("plosive", "nasal", "fricative")
    }
    responder_effects = {
        feature: round(_relative_difference_db(pcm[left], pcm[right], sample_rate), 4)
        for feature, (left, right) in FEATURE_RESPONDERS.items()
    }
    unlicensed_max = float(np.max(np.abs(pcm["neutral"] - pcm["unlicensed"])))
    repeat_floor_db = max(
        _relative_difference_db(pcm["neutral"], pcm["neutral-repeat"], sample_rate),
        _relative_difference_db(pcm["plosive"], pcm["plosive-repeat"], sample_rate),
    )
    output_distinct = all(
        value >= max(-45, repeat_floor_db + 6)
        for value in neutral_difference.values()
    )
    responders = {
        feature: effect >= max(-50, repeat_floor_db + 6)
        for feature, effect in responder_effects.items()
    }
    return {
        "renderer": str(render_script),
        "sampleRate": sample_rate,
        "instrument": instrument,
        "midi": midi,
        "velocity": 0.62,
        "fitMode": True,
        "vowelOnlyToClassRelativeDifferenceDb": neutral_difference,
        "featurePerturbationRelativeDifferenceDb": responder_effects,
        "featureResponders": responders,
        "repeatNoiseFloorRelativeDifferenceDb": round(repeat_floor_db, 4),
        "minimumEffectMarginAboveRepeatDb": 6.0,
        "unlicensedNeutralMaxPcmDifference": unlicensed_max,
        "provenanceGateNeutral": unlicensed_max <= 1 / 32768,
        "outputDistinct": output_distinct,
        "passed": output_distinct and all(responders.values())
                  and unlicensed_max <= 1 / 32768,
        "classParams": {
            name: _class_params(fit, name)
            for name in ("plosive", "nasal", "fricative")
        },
    }


def _write_calibration(path: Path, payload: dict) -> None:
    output_audit = payload["outputAudit"]
    calibration = {
        "schemaVersion": 1,
        "instrument": payload["instrument"],
        "scope": "first-consonant-onset-classes",
        "status": "fitted-spoken-fallback-provisional-sung-adaptation",
        "sourceFitSha256": payload["fitSha256"],
        "objectiveHash": payload["objectiveHash"],
        "controllabilityAuditSha256": payload["auditSha256"],
        "rendererSha256": payload["rendererSha256"],
        "featureWeights": payload["earnedFeatureWeights"],
        "classes": output_audit["classParams"],
        "provenance": {
            "source": "LibriSpeech dev-clean + LibriSpeech Alignments",
            "license": "CC BY 4.0",
            "qc": True,
            "sourceMode": "spoken-fallback",
            "sungAdaptationCaveat": (
                "Durations/VOT are provisional speech-to-singing transforms; "
                "vowel onset is beat-anchored and the gesture anticipates it. "
                "Replace from a licensed sung corpus when available."
            ),
        },
        "outputVerification": {
            "passed": output_audit["passed"],
            "vowelOnlyToClassRelativeDifferenceDb":
                output_audit["vowelOnlyToClassRelativeDifferenceDb"],
            "featurePerturbationRelativeDifferenceDb":
                output_audit["featurePerturbationRelativeDifferenceDb"],
            "provenanceGateNeutral": output_audit["provenanceGateNeutral"],
            "repeatNoiseFloorRelativeDifferenceDb":
                output_audit["repeatNoiseFloorRelativeDifferenceDb"],
        },
        "activation": (
            f"available to {payload['instrument']} consonant-onset renders; not a replacement "
            "for the vowel-only identity leaderboard entry"
        ),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(calibration, indent=2) + "\n")


def audit(repo_root: Path, fit_path: Path, output: Path, *,
          instrument: str = "voice-tenor", voice_best: Path | None = None,
          tenor_best: Path | None = None, run_root: Path | None = None,
          render_script: Path | None = None) -> dict:
    if instrument not in VOICE_AUDIT_MIDI:
        raise ValueError(
            f"unsupported voice {instrument!r}; expected one of {sorted(VOICE_AUDIT_MIDI)}"
        )
    if voice_best is not None and tenor_best is not None:
        raise ValueError("pass only one of voice_best or the legacy tenor_best alias")
    if tenor_best is not None:
        if instrument != "voice-tenor":
            raise ValueError("tenor_best alias may only be used with voice-tenor")
        voice_best = tenor_best
    fit = json.loads(fit_path.read_text())
    params_text = (repo_root / "web/static/params.js").read_text()
    synth_text = (repo_root / "web/static/synth.js").read_text()
    verify_text = (repo_root / "scripts/verify_tone_model.mjs").read_text()
    schema = {key: key in params_text for key in SCHEMA_KEYS}
    consumer = {key: key in synth_text for key in SCHEMA_KEYS}
    assertions = {key: key in verify_text for key in SCHEMA_KEYS}
    weights = fit.get("featureWeights", {})
    generator_landed = all(schema.values()) and all(consumer.values())
    consuming_assertion_landed = generator_landed and all(assertions.values())
    zero_weight_safe = bool(weights) and all(float(value) == 0 for value in weights.values())
    fitted_classes = {
        key: int(value.get("count", 0))
        for key, value in fit.get("classes", {}).items()
    }
    enough_rows = all(fitted_classes.get(key, 0) >= 4
                      for key in ("plosive", "nasal", "fricative"))
    output_audit = None
    if (generator_landed and consuming_assertion_landed and enough_rows
            and voice_best is not None and run_root is not None):
        output_audit = _render_output_audit(
            repo_root, fit, instrument, voice_best, run_root,
            render_script or repo_root / "scripts/render_note.mjs",
        )
    output_clean = bool(output_audit and output_audit["passed"])
    earned_weights = {
        feature: 1.0 if output_clean and output_audit["featureResponders"][feature] else 0.0
        for feature in weights
    }
    activation_allowed = bool(
        generator_landed and consuming_assertion_landed and enough_rows
        and output_clean and all(value > 0 for value in earned_weights.values())
    )
    if not generator_landed or not consuming_assertion_landed:
        status = "blocked-generator-consumer-absent"
        voice_fit = "not-run-generator-consumer-absent"
    elif not enough_rows:
        status = "blocked-adapted-evidence-insufficient"
        voice_fit = "not-run-adapted-evidence-insufficient"
    elif output_audit is None:
        status = "pending-output-controllability-audit"
        voice_fit = "not-run-output-audit-required"
    elif not output_clean:
        status = "blocked-output-controllability"
        voice_fit = "not-run-output-audit-failed"
    else:
        status = "ready-for-voice-onset-fit"
        voice_fit = "eligible"
    payload = {
        "schemaVersion": 1,
        "instrument": instrument,
        "status": status,
        "generatorLanded": generator_landed,
        "consumingAssertionLanded": consuming_assertion_landed,
        "licensedAdaptedRowsReady": enough_rows,
        "activationAllowed": activation_allowed,
        "schemaKeys": schema,
        "consumerKeys": consumer,
        "headlessAssertionKeys": assertions,
        "featureWeights": weights,
        "earnedFeatureWeights": earned_weights,
        "zeroWeightSafe": zero_weight_safe,
        "classCounts": fitted_classes,
        "voiceOnsetFit": voice_fit,
        "outputAudit": output_audit,
        "requiredNextAssertion": (
            "A-VOICE-03 neutral PCM + burst/VOT/transition + shared-latent "
            "headless consumer, followed by feature responsiveness"
        ),
        "fitPath": str(fit_path),
        "fitSha256": hashlib.sha256(fit_path.read_bytes()).hexdigest(),
    }
    if voice_best is not None:
        payload["voiceBestPath"] = str(voice_best)
        payload["voiceBestSha256"] = hashlib.sha256(voice_best.read_bytes()).hexdigest()
    if instrument == "voice-tenor":
        # Compatibility for pass-07 artifacts and existing consumers.
        payload["tenorOnsetFit"] = voice_fit
    render_note_path = repo_root / "web/static/render-note.js"
    payload["rendererSha256"] = hashlib.sha256(
        synth_text.encode()
        + (render_note_path.read_bytes() if render_note_path.exists() else b"")
    ).hexdigest()
    objective_contract = {
        "instrument": instrument,
        "fitSha256": payload["fitSha256"],
        "voiceBestSha256": payload.get("voiceBestSha256"),
        "rendererSha256": payload["rendererSha256"],
        "featureResponders": (output_audit or {}).get("featureResponders", {}),
        "earnedFeatureWeights": earned_weights,
        "classCounts": fitted_classes,
    }
    payload["objectiveHash"] = hashlib.sha256(json.dumps(
        objective_contract, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()[:16]
    payload["auditSha256"] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--fit", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--instrument", choices=sorted(VOICE_AUDIT_MIDI),
                        default="voice-tenor")
    parser.add_argument("--voice-best", type=Path)
    parser.add_argument("--tenor-best", type=Path)
    parser.add_argument("--run-root", type=Path)
    parser.add_argument("--render-script", type=Path)
    parser.add_argument("--calibration-out", type=Path)
    args = parser.parse_args()
    result = audit(
        args.repo_root, args.fit, args.out,
        instrument=args.instrument, voice_best=args.voice_best,
        tenor_best=args.tenor_best, run_root=args.run_root,
        render_script=args.render_script,
    )
    if args.calibration_out:
        if not result["activationAllowed"]:
            raise ValueError(
                f"refusing to emit {args.instrument} consonant fit before clean output audit"
            )
        _write_calibration(args.calibration_out, result)
    print(json.dumps({
        "status": result["status"],
        "generatorLanded": result["generatorLanded"],
        "consumingAssertionLanded": result["consumingAssertionLanded"],
        "instrument": result["instrument"],
        "voiceOnsetFit": result["voiceOnsetFit"],
    }, indent=2))


if __name__ == "__main__":
    main()
