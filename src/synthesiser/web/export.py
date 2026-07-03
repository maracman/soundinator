"""Tidy exports of the web study/explore data.

Turns the append-only JSONL logs under ``web/data/`` into flat CSV tables
ready for analysis, with full parameter and metric provenance per row:

- ``events.csv``    – every explore event (play/rate/save/adjust/consent)
- ``ratings.csv``   – committed rating events only (the appeal-model table)
- ``stimuli.csv``   – one row per distinct stimulus_id with its complete
  parameter set (seed included): the regeneration bundle. Loading these
  parameters in the synthesiser reproduces the stimulus exactly.
- ``study_trials.csv`` – Arm 1 study sessions, one row per trial response
- ``presets.csv``   – shared community preset library

Nested dicts are flattened with prefixes (``param_*``, ``metric_*``,
``demo_*``); records are schema-tolerant: missing fields become empty cells,
unknown fields become extra columns. List values are JSON-encoded strings.
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path
from typing import Any, Iterable

EXPORT_SCHEMA_VERSION = "export-1.0"

# Stable leading columns for event-shaped tables; anything else follows
# alphabetically so exports stay diff-friendly as schemas grow.
_EVENT_LEAD = [
    "id", "schema_version", "created_at", "client_ts", "event_type",
    "participant_id", "session_id", "stimulus_id", "app_version",
    "rating", "rating_latency_ms", "play_count",
]


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue  # skip torn/corrupt lines rather than losing the export
        if isinstance(record, dict):
            records.append(record)
    return records


def _scalar(value: Any) -> Any:
    if isinstance(value, (list, tuple, dict)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return value


def flatten_event(event: dict[str, Any]) -> dict[str, Any]:
    """One event record → one flat row with prefixed nested fields."""
    row: dict[str, Any] = {}
    for key, value in event.items():
        if key == "parameters" and isinstance(value, dict):
            for k, v in value.items():
                row[f"param_{k}"] = _scalar(v)
        elif key == "metrics" and isinstance(value, dict):
            for k, v in value.items():
                row[f"metric_{k}"] = _scalar(v)
        elif key == "consent" and isinstance(value, dict):
            row["consent_status"] = value.get("status")
            row["consent_version"] = value.get("consent_version")
            demo = value.get("demographics") or {}
            if isinstance(demo, dict):
                for k, v in demo.items():
                    row[f"demo_{k}"] = _scalar(v)
        elif key == "changes" and isinstance(value, dict):
            row["changes_count"] = len(value)
            row["changes_json"] = _scalar(value)
        else:
            row[key] = _scalar(value)
    return row


def export_events(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [flatten_event(e) for e in events]


def export_ratings(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return [flatten_event(e) for e in events if e.get("event_type") == "rate"]


def export_stimuli(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per distinct stimulus_id: the exact-regeneration bundle."""
    seen: dict[str, dict[str, Any]] = {}
    for e in events:
        sid = e.get("stimulus_id")
        params = e.get("parameters")
        if not sid or not isinstance(params, dict) or sid in seen:
            continue
        row: dict[str, Any] = {
            "stimulus_id": sid,
            "app_version": e.get("app_version"),
            "first_seen_at": e.get("created_at"),
            "seed": params.get("seed"),
        }
        for k, v in params.items():
            row[f"param_{k}"] = _scalar(v)
        seen[sid] = row
    return list(seen.values())


def export_study_trials(sessions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for s in sessions:
        base = {
            "session_id": s.get("id"),
            "schema_version": s.get("schema_version"),
            "received_at": s.get("received_at"),
            "participant_id": s.get("participant_id"),
            "paradigm": s.get("paradigm"),
            "headphone_passed": s.get("headphone_passed"),
            "total_time_ms": s.get("total_time_ms"),
        }
        demo = s.get("demographics") or {}
        if isinstance(demo, dict):
            for k, v in demo.items():
                base[f"demo_{k}"] = _scalar(v)
        responses = s.get("responses") or []
        if not responses:
            rows.append(dict(base))
        for r in responses:
            row = dict(base)
            if isinstance(r, dict):
                for k, v in r.items():
                    row[f"trial_{k}"] = _scalar(v)
            rows.append(row)
    return rows


def export_presets(presets: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for p in presets:
        if not isinstance(p, dict):
            continue
        row = {k: _scalar(v) for k, v in p.items() if k != "parameters"}
        for k, v in (p.get("parameters") or {}).items():
            row[f"param_{k}"] = _scalar(v)
        rows.append(row)
    return rows


def _columns(rows: list[dict[str, Any]], lead: list[str]) -> list[str]:
    keys = set()
    for row in rows:
        keys.update(row)
    ordered = [c for c in lead if c in keys]
    ordered += sorted(k for k in keys if k not in lead)
    return ordered


def rows_to_csv(rows: list[dict[str, Any]], lead: list[str] | None = None) -> str:
    buf = io.StringIO()
    columns = _columns(rows, lead or _EVENT_LEAD)
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


TABLES = ("events", "ratings", "stimuli", "study_trials", "presets")


def build_table(name: str, data_dir: Path) -> str:
    """Build one named CSV table from the data directory."""
    if name in ("events", "ratings", "stimuli"):
        events = _read_jsonl(data_dir / "explore_events.jsonl")
        if name == "events":
            return rows_to_csv(export_events(events))
        if name == "ratings":
            return rows_to_csv(export_ratings(events))
        return rows_to_csv(export_stimuli(events), lead=["stimulus_id", "app_version", "first_seen_at", "seed"])
    if name == "study_trials":
        sessions = _read_jsonl(data_dir / "study_sessions.jsonl")
        return rows_to_csv(export_study_trials(sessions), lead=["session_id", "received_at", "participant_id", "paradigm"])
    if name == "presets":
        path = data_dir / "global_presets.json"
        presets = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        return rows_to_csv(export_presets(presets), lead=["id", "created_at", "preset_name", "favourite_rating", "stimulus_id"])
    raise ValueError(f"unknown table: {name!r} (expected one of {', '.join(TABLES)})")


def export_all(data_dir: Path, out_dir: Path) -> dict[str, Path]:
    """Write every table to ``out_dir`` and return the written paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for name in TABLES:
        path = out_dir / f"{name}.csv"
        path.write_text(build_table(name, data_dir), encoding="utf-8")
        written[name] = path
    return written
