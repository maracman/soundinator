#!/usr/bin/env python3
"""Persist a sung canonical gate table and objective-scoped leaderboard.

The sung pipeline is a staged fitter rather than ``iterate.py``'s generic
optimizer.  This small finalizer gives it the same durable pass-end contract:
legacy-initialized entry number one, an objective-scoped best, and an SG2_DATA
state backstop.  It never labels a gate-failing entry as frozen or shippable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
from typing import Any


def _load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def _canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _fit_summary(fit_root: Path) -> tuple[dict[str, Any], str, dict[str, Any]]:
    source_fit = _load(fit_root / "SOURCE_VOWEL_FIT.json")
    bundle = {
        vowel: _load(fit_root / f"initial-{vowel}.json")
        for vowel in "aeiou"
    }
    fit = source_fit["fit"]
    return ({
        "fitRoot": str(fit_root),
        "primarySinger": source_fit["primarySinger"],
        "spectralReferences": source_fit["spectralReferences"],
        "analysedReferences": source_fit["analysedReferences"],
        "rejectedReferences": len(source_fit["rejectedReferences"]),
        "vibratoReferences": source_fit["vibratoReferences"],
        "vibratoAnalysed": source_fit["vibratoAnalysed"],
        "medianAbsDb": fit["roundTripMedianAbsDb"],
        "p95AbsDb": fit["roundTripP95AbsDb"],
    }, _canonical_hash(bundle), bundle)


def _entry(scores_path: Path, fit_root: Path, kind: str, number: int) -> dict[str, Any]:
    scores = _load(scores_path)
    fit, bundle_hash, params_by_vowel = _fit_summary(fit_root)
    construction = scores["construction"]
    tripwires = scores["tripwires"]
    strict_pass = sum(row.get("status") == "pass" for row in tripwires["cells"])
    strict_fail = sum(row.get("status") == "fail" for row in tripwires["cells"])
    feature_for_bar = {
        "partial-table": "partials_db",
        "mel-spectrogram": "log_mel_db",
        "attack-t90": "attack_ms",
        "band-balance": "band_balance_db",
    }
    strict_by_bar = {
        bar: {
            "pass": sum(row.get("status") == "pass" for row in tripwires["cells"]
                        if row.get("bar") == bar),
            "fail": sum(row.get("status") == "fail" for row in tripwires["cells"]
                        if row.get("bar") == bar),
            "missing": sum(row.get("status") not in {"pass", "fail"}
                           for row in tripwires["cells"]
                           if row.get("bar") == bar),
            "meanNormalizedResidual": (
                sum(float(row["normalized"][feature_for_bar[bar]])
                    for row in scores.get("rows", [])
                    if isinstance(row.get("normalized", {}).get(feature_for_bar[bar]),
                                  (int, float)))
                / max(1, sum(
                    isinstance(row.get("normalized", {}).get(feature_for_bar[bar]),
                               (int, float))
                    for row in scores.get("rows", [])
                ))
            ),
        }
        for bar in ("partial-table", "mel-spectrogram", "attack-t90", "band-balance")
    }
    vowel = scores["vowelClassification"]
    consumption = scores.get("vowelBodyConsumption", {
        "passed": False,
        "passedRows": 0,
        "requiredRows": 10,
        "reason": "legacy row predates paired consuming assertion",
    })
    humanisation = {
        "passed": False,
        "status": "not-run-identity-unstable",
        "reason": (
            "deterministic identity has not passed reconstruction and strict "
            "spectral gates; same-singer differential ranges are ineligible"
        ),
    }
    gates = {
        "construction": {
            "passed": bool(construction["passed"]),
            "counts": construction["counts"],
        },
        "strictTripwires": {
            "passed": bool(tripwires["strictPassed"]),
            "requiredPass": strict_pass,
            "requiredFail": strict_fail,
            "requiredMissing": len(tripwires["strictMissingCells"]),
            "byBar": strict_by_bar,
        },
        "vowelBodyConsumption": {
            "passed": bool(consumption["passed"]),
            "passedRows": consumption["passedRows"],
            "requiredRows": consumption["requiredRows"],
        },
        "vowelClassification": {
            "passed": bool(vowel["passed"]),
            "passedRows": vowel["passedRows"],
            "requiredRows": vowel["requiredRows"],
        },
        "humanisation": humanisation,
    }
    overall = all(gate["passed"] for gate in gates.values())
    gate_failures = sum(not gate["passed"] for gate in gates.values())
    return {
        "entryNumber": number,
        "kind": kind,
        "instrument": scores["instrument"],
        "run": scores["run"],
        "status": "ship-eligible" if overall else "interim-gates-failing",
        "shipEligible": overall,
        "meanComposite": scores["meanComposite"],
        "scoredRows": scores["scoredRows"],
        "rejectedRows": scores["rejectedRows"],
        "gateFailures": gate_failures,
        "gates": gates,
        "lpcVowelClassificationWatch": scores.get(
            "lpcVowelClassificationWatch", scores["vowelClassification"]),
        "vowelClassifierWatch": scores.get("vowelClassifierWatch", {
            "passed": False,
            "passedRows": 0,
            "requiredRows": 10,
            "method": "not-available-in-legacy-row",
        }),
        "sourceBodyFit": fit,
        # The global listening-page resolver consumes this top-level wrapper.
        # Keeping all five presets avoids silently auditioning a generic vocal
        # fallback when the leaderboard entry is otherwise fully canonical.
        "paramsByVowel": params_by_vowel,
        "presetBundleHash": bundle_hash[:16],
        "scoresPath": str(scores_path),
        "objectiveHash": scores["controllability"]["objectiveHash"],
        "manifestHash": scores["controllability"]["manifestHash"],
        "legacyPrior": scores["legacyPrior"],
        "renderModes": scores["renderModes"],
    }


def _gate_mark(gate: dict[str, Any]) -> str:
    return "PASS" if gate["passed"] else "FAIL"


def _selection_key(entry: dict[str, Any]) -> tuple[float, ...]:
    """Apply the sung criteria hierarchy before the scalar composite."""

    gates = entry["gates"]
    construction = gates["construction"]["counts"]
    strict = gates["strictTripwires"]
    by_bar = strict.get("byBar", {})
    ordered_strict = tuple(
        value
        for bar in ("partial-table", "mel-spectrogram", "attack-t90", "band-balance")
        for value in (
            float(by_bar.get(bar, {}).get("fail", 0)
                  + by_bar.get(bar, {}).get("missing", 0)),
            float(by_bar.get(bar, {}).get("meanNormalizedResidual", 0)),
        )
    )
    body = gates["vowelBodyConsumption"]
    vowel = gates["vowelClassification"]
    return (
        float(construction.get("fail", 0)),
        *ordered_strict,
        float(strict["requiredFail"] + strict["requiredMissing"]),
        float(body["requiredRows"] - body["passedRows"]),
        float(vowel["requiredRows"] - vowel["passedRows"]),
        float(not gates["humanisation"]["passed"]),
        float(entry["meanComposite"]),
    )


def _write_run_report(path: Path, entry: dict[str, Any]) -> None:
    gates = entry["gates"]
    construction = gates["construction"]
    tripwires = gates["strictTripwires"]
    consumption = gates["vowelBodyConsumption"]
    vowel = gates["vowelClassification"]
    classifier = entry["vowelClassifierWatch"]
    lines = [
        f"# {entry['instrument']} — {entry['run']}",
        "",
        f"Objective hash: `{entry['objectiveHash']}`  ",
        f"Manifest hash: `{entry['manifestHash']}`  ",
        f"Preset bundle hash: `{entry['presetBundleHash']}`  ",
        ("Legacy prior: `%(tag)s` / `%(commit)s`, parameter hash "
         "`%(parameterHash)s`" % entry["legacyPrior"]),
        "",
        "| Gate | Result |",
        "|---|---|",
        (f"| Construction | {_gate_mark(construction)} — "
         f"{construction['counts']['pass']}/{sum(construction['counts'].values())} pass |"),
        (f"| Strict §3 tripwires | {_gate_mark(tripwires)} — "
         f"{tripwires['requiredPass']} pass, {tripwires['requiredFail']} fail, "
         f"{tripwires['requiredMissing']} missing |"),
        (f"| Emitted vowel-body consumption | {_gate_mark(consumption)} — "
         f"{consumption['passedRows']}/{consumption['requiredRows']} |"),
        (f"| Vowel classification | {_gate_mark(vowel)} — "
         f"{vowel['passedRows']}/{vowel['requiredRows']} |"),
        (f"| Calibrated vowel classifier watch | "
         f"{'PASS' if classifier.get('passed') else 'FAIL'} — "
         f"{classifier.get('passedRows', 0)}/{classifier.get('requiredRows', 10)}; "
         f"{classifier.get('method', 'unknown')} |"),
        "| §2.5c differential Human fit | NOT RUN — deterministic identity unstable |",
        f"| Overall | {'PASS' if entry['shipEligible'] else '**FAIL**'} |",
        "",
        (f"Mean composite: `{entry['meanComposite']:.6f}` over "
         f"{entry['scoredRows']} scored rows; {entry['rejectedRows']} rejects."),
        "",
        ("The raw LPC estimate is retained as a diagnostic-only sparse-harmonic "
         "measurement.  The calibrated classifier compares paired body-on/body-"
         "bypass audio against every installed vowel model, then independently "
         "checks the winning F1/F2 centres against the annex boxes.  Neither "
         "watch can override the emitted-body consuming assertion."),
        "",
    ]
    path.write_text("\n".join(lines))


def finalize(
    instrument: str,
    baseline_scores: Path,
    baseline_fit: Path,
    incumbent_scores: Path | None,
    incumbent_fit: Path | None,
    candidate_scores: Path | None,
    candidate_fit: Path | None,
    runs_root: Path,
    state_root: Path,
) -> dict[str, Any]:
    entries = [_entry(baseline_scores, baseline_fit, "legacy-baseline", 1)]
    if incumbent_scores is not None:
        if incumbent_fit is None:
            raise ValueError("--incumbent-fit is required with --incumbent-scores")
        entries.append(_entry(
            incumbent_scores, incumbent_fit, "incumbent", len(entries) + 1,
        ))
    if candidate_scores is not None:
        if candidate_fit is None:
            raise ValueError("--candidate-fit is required with --candidate-scores")
        entries.append(_entry(
            candidate_scores, candidate_fit, "candidate", len(entries) + 1,
        ))

    objective_hashes = {entry["objectiveHash"] for entry in entries}
    if len(objective_hashes) != 1:
        raise ValueError(f"leaderboard entries are not objective-comparable: {objective_hashes}")
    # Construction and strict cell closure outrank the scalar composite.  This
    # keeps an empirically useful hard-gate improvement from being discarded
    # merely because a lower-priority average moved slightly in the other
    # direction.
    best = min(entries, key=_selection_key)
    legacy = entries[0]
    for entry in entries:
        entry["selectionKey"] = list(_selection_key(entry))
        entry["beatsLegacy"] = _selection_key(entry) < _selection_key(legacy)
        entry["isLeader"] = entry is best

    board_path = runs_root / instrument / "leaderboard.json"
    prior_board = None
    state_board_path = state_root / instrument / "leaderboard.json"
    if state_board_path.exists():
        existing = _load(state_board_path)
        if existing.get("objectiveHash") != best["objectiveHash"]:
            prior_board = existing
        else:
            prior_board = existing.get("previousObjectiveBoard")
    board = {
        "schemaVersion": 3,
        "instrument": instrument,
        "objective": f"sung-canonical-{best['objectiveHash']}",
        "objectiveHash": best["objectiveHash"],
        "selectionRule": (
            "construction failures; strict partial, mel, attack and band-balance "
            "failed/missing cells plus residual at each criteria tier; total strict cells; "
            "emitted-body rows, vowel rows, humanisation, then comparable composite"
        ),
        "runs": entries,
        "legacyBaseline": legacy,
        "best": best,
    }
    if prior_board is not None:
        board["previousObjectiveBoard"] = prior_board
    board_path.parent.mkdir(parents=True, exist_ok=True)
    board_path.write_text(json.dumps(board, indent=2) + "\n")
    state_board_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(board_path, state_board_path)

    selected_scores = Path(best["scoresPath"])
    best_path = selected_scores.parent / "best.json"
    best_path.write_text(json.dumps(best, indent=2) + "\n")
    state_best = state_root / instrument / "best.json"
    shutil.copy2(best_path, state_best)
    snapshot = state_root / instrument / best["run"] / "best.json"
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best_path, snapshot)
    _write_run_report(selected_scores.parent / "RUN_REPORT.md", best)
    return board


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--baseline-scores", type=Path, required=True)
    parser.add_argument("--baseline-fit", type=Path, required=True)
    parser.add_argument("--incumbent-scores", type=Path)
    parser.add_argument("--incumbent-fit", type=Path)
    parser.add_argument("--candidate-scores", type=Path)
    parser.add_argument("--candidate-fit", type=Path)
    parser.add_argument("--runs-root", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    args = parser.parse_args()
    board = finalize(
        args.instrument, args.baseline_scores, args.baseline_fit,
        args.incumbent_scores, args.incumbent_fit,
        args.candidate_scores, args.candidate_fit, args.runs_root,
        args.state_root,
    )
    print(json.dumps({
        "instrument": args.instrument,
        "leader": board["best"]["run"],
        "shipEligible": board["best"]["shipEligible"],
        "leaderboardEntries": len(board["runs"]),
    }, indent=2))


if __name__ == "__main__":
    main()
