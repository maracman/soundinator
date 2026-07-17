#!/usr/bin/env python3
"""Render and score every matched §2.5c take through the current identity path."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any

import numpy as np
import soundfile as sf

from .iterate import _load_preset, _mode_params, _renderer_contract_hash
from .score import score_files


CORE_FEATURES = (
    "partials_db", "log_mel_db", "attack_ms", "band_balance_db",
    "inharmonicity_log_ratio",
)


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _matched_rows(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = [row for row in references if set(row.get("roles", [])).intersection(
        {"humanisation", "floor"})]
    counts: dict[str, int] = {}
    for row in candidates:
        group = str(row.get("humanisationGroup") or row.get("floorGroup") or "")
        counts[group] = counts.get(group, 0) + 1
    return [row for row in candidates if counts.get(str(
        row.get("humanisationGroup") or row.get("floorGroup") or ""), 0) >= 2]


def _rows_from_human_ranges(human_ranges_path: Path,
                            prepared_dir: Path) -> list[dict[str, Any]]:
    """Recover the exact prepared-take set named by a durable fit report.

    The source MP3 cache is disposable; the prepared common-window WAVs and
    fit report are the durable evidence.  This path never reclassifies those
    lossy rows as identity or noise-floor material.
    """
    report = json.loads(human_ranges_path.read_text())
    by_source: dict[str, str] = {}
    groups: dict[str, set[str]] = {}
    for pair in report.get("pairFits", []):
        group = str(pair.get("group", ""))
        for side in ("left", "right"):
            source = str(pair.get(side, ""))
            if source:
                groups.setdefault(group, set()).add(source)
    for path in prepared_dir.glob("*.wav"):
        name = path.stem
        for prefix in ("philcat-", "phil-floor-"):
            if name.startswith(prefix):
                name = name[len(prefix):]
        by_source[name] = str(path.resolve())
        by_source[name.removeprefix("phil.")] = str(path.resolve())
    velocity = {
        "pp": .2, "pianissimo": .2, "mp": .42, "mezzo-piano": .42,
        "mf": .62, "mezzo-forte": .62, "f": .82, "forte": .82,
        "ff": 1.0, "fortissimo": 1.0,
    }
    rows = []
    for group, sources in sorted(groups.items()):
        fields = group.split("|")
        midi = int(fields[0])
        dynamic = fields[1]
        for source in sorted(sources):
            stem = Path(source).stem
            path = by_source.get(stem) or by_source.get(stem.removeprefix("phil."))
            if path is None:
                raise FileNotFoundError(f"prepared Human take missing for {source}")
            info = sf.info(path)
            rows.append({
                "path": path, "sourceFile": source, "midi": midi,
                "velocity": velocity.get(dynamic, .62), "dynamic": dynamic,
                "register": "low" if midi < 55 else "mid" if midi <= 76 else "high",
                "durationSec": max(.5, min(2.0, info.duration * .72)),
                "roles": ["humanisation"], "humanisationGroup": group,
            })
    return rows


def audit(instrument: str, references_path: Path | None, params_path: Path,
          output: Path, repo_root: Path, *,
          human_ranges_path: Path | None = None,
          prepared_dir: Path | None = None) -> dict[str, Any]:
    if human_ranges_path is not None:
        if prepared_dir is None:
            raise ValueError("--human-ranges requires --prepared-dir")
        rows = _rows_from_human_ranges(human_ranges_path, prepared_dir)
    elif references_path is not None:
        rows = _matched_rows(json.loads(references_path.read_text()))
    else:
        raise ValueError("one of references_path or human_ranges_path is required")
    if not rows:
        raise ValueError(f"{instrument}: no matched Human takes")
    params = _mode_params(_load_preset(params_path), "fit")
    output.mkdir(parents=True, exist_ok=True)

    # The dedicated audit is admissible for §2.5c.2 only when the complete
    # renderer assertion suite, including T-074, passes on this checkout.
    subprocess.run(
        ["node", "scripts/verify_tone_model.mjs"], cwd=repo_root, check=True,
        stdout=subprocess.DEVNULL,
        env={**os.environ, "PYTHON": sys.executable},
    )
    jobs = []
    rendered = []
    for index, reference in enumerate(rows):
        target = output / "renders" / f"{index:02d}.wav"
        target.parent.mkdir(parents=True, exist_ok=True)
        jobs.append({
            "params": params,
            "midi": reference["midi"],
            "velocity": reference["velocity"],
            "durationSec": reference["durationSec"],
            "sampleRate": 44100,
            "out": str(target),
        })
        rendered.append(target)
    jobs_path = output / "jobs.json"
    jobs_path.write_text(json.dumps(jobs, indent=2) + "\n")
    subprocess.run(
        ["node", "scripts/render_note.mjs", "--batch", str(jobs_path)],
        cwd=repo_root, check=True,
        env={**os.environ, "PYTHON": sys.executable},
    )

    audited = []
    for reference, render_path in zip(rows, rendered):
        result = score_files(
            reference["path"], render_path, instrument=instrument,
            params=params, context=reference,
        )
        normalized = result.get("normalized", {})
        failures = [feature for feature in CORE_FEATURES
                    if feature in normalized and
                    np.isfinite(normalized[feature]) and
                    float(normalized[feature]) > 1.0]
        analysis_failure = result.get("analysisFailure")
        audited.append({
            "path": str(reference["path"]),
            "sourceFile": reference.get("sourceFile"),
            "group": reference.get("humanisationGroup") or reference.get("floorGroup"),
            "good": bool(normalized) and not analysis_failure and not failures,
            "failedCoreFeatures": failures,
            "analysisFailure": analysis_failure,
            "normalizedCoreFeatures": {
                key: normalized.get(key) for key in CORE_FEATURES
            },
            "renderSha256": _sha(render_path),
        })
    payload = {
        "schema": "sg2-human-per-take-identity-audit-v1",
        "instrument": instrument,
        "method": "current-deterministic-fit-render-per-matched-take",
        "fullyFunctionalRenderPath": True,
        "rendererContractHash": _renderer_contract_hash(repo_root),
        "referencesSha256": _sha(references_path) if references_path else None,
        "humanRangesSha256": _sha(human_ranges_path) if human_ranges_path else None,
        "paramsSha256": _sha(params_path),
        "takes": len(audited),
        "goodTakes": sum(row["good"] for row in audited),
        "allMatchedTakesNearBars": bool(audited) and all(row["good"] for row in audited),
        "rows": audited,
    }
    payload["auditSha256"] = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    (output / "AUDIT.json").write_text(json.dumps(payload, indent=2) + "\n")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--references", type=Path)
    parser.add_argument("--human-ranges", type=Path)
    parser.add_argument("--prepared-dir", type=Path)
    parser.add_argument("--params", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    payload = audit(
        args.instrument, args.references, args.params, args.out, args.repo_root,
        human_ranges_path=args.human_ranges, prepared_dir=args.prepared_dir)
    print(json.dumps({key: payload[key] for key in (
        "instrument", "takes", "goodTakes", "allMatchedTakesNearBars",
        "rendererContractHash", "auditSha256")}, indent=2))
    return 0 if payload["allMatchedTakesNearBars"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
