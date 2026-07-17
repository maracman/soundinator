#!/usr/bin/env python3
"""Activation/controllability audit for the sung consonant generator."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


SCHEMA_KEYS = (
    "consonantClass", "consonantPlace", "consonantVoiced",
    "consonantStrength", "consonantBurstHz", "consonantBurstDurationMs",
    "consonantVotMs", "consonantF2LocusHz", "consonantTransitionMs",
    "consonantNasalZeroHz", "consonantFricativeHz",
)


def audit(repo_root: Path, fit_path: Path, output: Path) -> dict:
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
    activation_allowed = bool(
        generator_landed and consuming_assertion_landed and enough_rows
        and not zero_weight_safe
    )
    if not generator_landed or not consuming_assertion_landed:
        status = "blocked-generator-consumer-absent"
        tenor_fit = "not-run-generator-consumer-absent"
    elif zero_weight_safe:
        status = "blocked-zero-weight"
        tenor_fit = "not-run-features-remain-watch-only"
    elif not enough_rows:
        status = "blocked-adapted-evidence-insufficient"
        tenor_fit = "not-run-adapted-evidence-insufficient"
    else:
        status = "ready-for-tenor-onset-fit"
        tenor_fit = "eligible"
    payload = {
        "schemaVersion": 1,
        "status": status,
        "generatorLanded": generator_landed,
        "consumingAssertionLanded": consuming_assertion_landed,
        "licensedAdaptedRowsReady": enough_rows,
        "activationAllowed": activation_allowed,
        "schemaKeys": schema,
        "consumerKeys": consumer,
        "headlessAssertionKeys": assertions,
        "featureWeights": weights,
        "zeroWeightSafe": zero_weight_safe,
        "classCounts": fitted_classes,
        "tenorOnsetFit": tenor_fit,
        "requiredNextAssertion": (
            "A-VOICE-03 neutral PCM + burst/VOT/transition + shared-latent "
            "headless consumer, followed by feature responsiveness"
        ),
        "fitPath": str(fit_path),
        "fitSha256": hashlib.sha256(fit_path.read_bytes()).hexdigest(),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--fit", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.repo_root, args.fit, args.out)
    print(json.dumps({
        "status": result["status"],
        "generatorLanded": result["generatorLanded"],
        "consumingAssertionLanded": result["consumingAssertionLanded"],
        "tenorOnsetFit": result["tenorOnsetFit"],
    }, indent=2))


if __name__ == "__main__":
    main()
