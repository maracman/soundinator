"""The §3 quantitative tripwire gate (SOUND_GENERATOR_2_PLAN.md §3).

Owner note L10 found this gate still unimplemented ("are we meeting these
baselines" must be answerable at a glance) — this module makes every §3 bar
an explicit per-(register × dynamic) PASS/FAIL row, including the T-005
band-balance bar (RESEARCH_SUSTAIN_BALANCE 5.c).

These are minimum ship bars, not targets (§2.5 keeps refining beyond them).
A bar a note cannot evidence (short note, no vibrato reference) reports
`not-applicable`, never a silent pass.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from .score import (
    FeatureBundle,
    OCTAVE_CENTRES_HZ,
    band_balance_distance,
    inharmonicity_comparison,
    octave_summary_db,
    weights_for_instrument,
)

# Published envelope-peak anchors (RESEARCH_SUSTAIN_BALANCE 5.c/5.d):
# octave band that must contain the sustained envelope peak, keyed by the
# dynamics at which the anchor is evidenced.  Bowed instruments have no
# published single-peak anchor (their body clusters are gated in
# assertions.py instead), so they are absent here.
ENVELOPE_PEAK_ANCHORS: dict[str, dict[str, Any]] = {
    "alto-sax": {"peakHz": 650, "dynamics": {"mf"}},
    "tenor-sax": {"peakHz": 480, "dynamics": {"mf"}},
    "french-horn": {"peakHz": 340, "dynamics": {"pp", "p", "mp", "mf", "f", "ff"}},
    "trumpet": {"peakRangeHz": (1000, 2000), "dynamics": {"mf", "f"}},
    "flute": {"peakRangeHz": (500, 1000), "dynamics": {"f", "ff"}},
}

BARS = {
    "partials_db": 3.0,        # dB mean, audibility-floored
    "log_mel_db": 4.0,         # dB mean
    "attack_pct": 0.30,        # ±30% or ±20 ms, whichever larger
    "attack_ms_floor": 20.0,
    "vibrato_rate_hz": 0.3,
    "vibrato_depth_pct": 0.30,
    "inharmonicity_factor": 1.5,
    "band_mean_db": 3.0,       # T-005: mean 1/3-oct deviation
    "band_octave_db": 6.0,     # T-005: max octave-summary deviation
}

TRIPWIRE_FEATURES = {
    "partial-table": "partials_db",
    "mel-spectrogram": "log_mel_db",
    "attack-t90": "attack_ms",
    "vibrato": "vibrato",
    "inharmonicity": "inharmonicity_log_ratio",
    "band-balance": "band_balance_db",
}

ROLE_BARS = {
    "spectral": {
        "partial-table", "mel-spectrogram", "inharmonicity",
        "band-balance", "envelope-peak",
    },
    "onset": {"attack-t90"},
    "vibrato": {"vibrato"},
    "floor": set(),
}


def reference_roles(reference: dict[str, Any]) -> set[str]:
    """Return declared evidence roles; legacy rows retain prior behaviour."""
    raw = reference.get("roles")
    if raw is None:
        return {"spectral", "onset", "vibrato"}
    if isinstance(raw, str):
        raw = [raw]
    roles = {str(role) for role in raw}
    unknown = sorted(roles - set(ROLE_BARS))
    if unknown:
        raise ValueError(f"unknown reference roles: {unknown}")
    return roles


def role_evidences_bar(roles: set[str], bar: str) -> bool:
    return any(bar in ROLE_BARS[role] for role in roles)


def required_cells_by_bar(
        references: list[dict[str, Any]],
        active_bars: list[str] | set[str],
        ) -> dict[str, list[tuple[str, str]]]:
    """Derive the strict coverage contract from explicit reference roles."""
    result: dict[str, set[tuple[str, str]]] = {
        bar: set() for bar in active_bars
    }
    for reference in references:
        register = reference.get("register")
        dynamic = reference.get("dynamic")
        if register is None or dynamic is None:
            continue
        roles = reference_roles(reference)
        for bar in result:
            if role_evidences_bar(roles, bar):
                result[bar].add((str(register), str(dynamic)))
    return {
        bar: sorted(cells)
        for bar, cells in sorted(result.items())
        if cells
    }


def _row(bar: str, register: str | None, dynamic: Any, value: Any,
         limit: str, passed: bool | None) -> dict[str, Any]:
    status = "pass" if passed is True else "fail" if passed is False else "not-applicable"
    return {"bar": bar, "register": register, "dynamic": dynamic,
            "value": value, "limit": limit, "status": status}


def _octave_band_of(freq_hz: float) -> int:
    return int(np.argmin([abs(math.log2(freq_hz / centre))
                          for centre in OCTAVE_CENTRES_HZ]))


def evaluate_tripwires(instrument: str,
                       notes: list[dict[str, Any]],
                       weights: dict[str, float] | None = None,
                       ) -> dict[str, Any]:
    """Evaluate every §3 bar for a set of scored note pairs.

    ``notes`` rows carry {register, dynamic, result (compare_features
    output), ref (FeatureBundle), render (FeatureBundle)}.  Returns the
    per-row bar table plus an overall verdict; `not-applicable` rows do
    not fail the gate but are always listed (no silent passes).
    """
    weights = weights or weights_for_instrument(instrument)
    active_bars = {
        bar for bar, feature in TRIPWIRE_FEATURES.items()
        if float(weights.get(feature, 0)) > 0
    }
    rows: list[dict[str, Any]] = []
    anchor = ENVELOPE_PEAK_ANCHORS.get((instrument or "").strip().lower())
    if anchor:
        active_bars.add("envelope-peak")

    for note in notes:
        register = note.get("register")
        dynamic = note.get("dynamic")
        roles = reference_roles(note)
        result = note["result"]
        ref: FeatureBundle = note["ref"]
        render: FeatureBundle = note["render"]
        features = result["features"]

        rows.append(_row(
            "partial-table", register, dynamic,
            round(features["partials_db"], 2)
            if "partial-table" in active_bars and
            role_evidences_bar(roles, "partial-table") else None,
            f"<= {BARS['partials_db']} dB mean",
            features["partials_db"] <= BARS["partials_db"]
            if "partial-table" in active_bars and
            role_evidences_bar(roles, "partial-table") else None))
        rows.append(_row(
            "mel-spectrogram", register, dynamic,
            round(features["log_mel_db"], 2)
            if "mel-spectrogram" in active_bars and
            role_evidences_bar(roles, "mel-spectrogram") else None,
            f"<= {BARS['log_mel_db']} dB mean",
            features["log_mel_db"] <= BARS["log_mel_db"]
            if "mel-spectrogram" in active_bars and
            role_evidences_bar(roles, "mel-spectrogram") else None))

        # attack: ±30% of the reference's mean band T90 or ±20 ms
        ref_t90 = [entry.get("t90", 0) if isinstance(entry, dict) else entry
                   for entry in (ref.note.band_t90 or {}).values()]
        if "attack-t90" not in active_bars or \
                not role_evidences_bar(roles, "attack-t90"):
            rows.append(_row("attack-t90", register, dynamic, None,
                             "±30% or ±20 ms", None))
        elif ref_t90:
            allowance = max(BARS["attack_ms_floor"],
                            BARS["attack_pct"] * float(np.mean(ref_t90)) * 1000)
            rows.append(_row("attack-t90", register, dynamic,
                             round(features["attack_ms"], 1),
                             f"<= {allowance:.0f} ms",
                             features["attack_ms"] <= allowance))
        else:
            rows.append(_row("attack-t90", register, dynamic, None,
                             "±30% or ±20 ms", None))

        # vibrato: rate ±0.3 Hz, depth ±30% — only when the reference vibrates
        ref_vib = ref.note.vibrato or {}
        render_vib = render.note.vibrato or {}
        if "vibrato" not in active_bars or \
                not role_evidences_bar(roles, "vibrato"):
            rows.append(_row("vibrato", register, dynamic, None,
                             "rate ±0.3 Hz, depth ±30%", None))
        elif ref_vib.get("present"):
            rate_err = abs(float(render_vib.get("rate", 0)) - float(ref_vib.get("rate", 0)))
            ref_depth = float(ref_vib.get("depth", 0) or 0)
            depth_err = abs(float(render_vib.get("depth", 0) or 0) - ref_depth)
            depth_ok = depth_err <= BARS["vibrato_depth_pct"] * max(ref_depth, 1e-9)
            rows.append(_row("vibrato", register, dynamic,
                             {"rateErrHz": round(rate_err, 2),
                              "depthErrCents": round(depth_err, 1)},
                             "rate ±0.3 Hz, depth ±30%",
                             bool(render_vib.get("present")) and
                             rate_err <= BARS["vibrato_rate_hz"] and depth_ok))
        else:
            rows.append(_row("vibrato", register, dynamic, None,
                             "rate ±0.3 Hz, depth ±30%", None))

        # T-037: a B ratio is ill-conditioned at zero. Near-harmonic
        # references use upper-mode stretch cents at the common reliable
        # harmonic; ordinary non-zero references retain the factor gate.
        inharmonicity = inharmonicity_comparison(ref.note, render.note)
        if "inharmonicity" in active_bars and \
                role_evidences_bar(roles, "inharmonicity") and \
                inharmonicity["applicable"]:
            if inharmonicity["kind"] == "cents":
                rows.append(_row(
                    "inharmonicity", register, dynamic,
                    {"mode": inharmonicity["mode"],
                     "errorCents": round(inharmonicity["errorCents"], 3)},
                    "upper-mode stretch error <= 3 cents",
                    inharmonicity["passed"]))
            else:
                rows.append(_row(
                    "inharmonicity", register, dynamic,
                    round(inharmonicity["factor"], 3),
                    f"within x{BARS['inharmonicity_factor']}",
                    inharmonicity["passed"]))
        else:
            rows.append(_row("inharmonicity", register, dynamic, None,
                             "3-cent near-zero error or within x1.5", None))

        # T-005 band balance (per register AND dynamic, never pooled)
        d_mean, d_max8 = band_balance_distance(ref, render)
        if "band-balance" not in active_bars or \
                not role_evidences_bar(roles, "band-balance") or \
                ref.band_profile_db is None or render.band_profile_db is None:
            rows.append(_row("band-balance", register, dynamic, None,
                             "mean <= 3 dB, max octave <= 6 dB", None))
        else:
            rows.append(_row("band-balance", register, dynamic,
                             {"meanDb": round(d_mean, 2),
                              "maxOctaveDb": round(d_max8, 2) if d_max8 is not None else None},
                             "mean <= 3 dB, max octave <= 6 dB",
                             d_mean <= BARS["band_mean_db"] and
                             (d_max8 is None or d_max8 <= BARS["band_octave_db"])))

        # published envelope-peak anchor, at evidenced dynamics only
        if anchor and role_evidences_bar(roles, "envelope-peak") and \
                render.band_profile_db is not None and \
                str(dynamic).lower() in anchor["dynamics"]:
            summary = octave_summary_db(render.band_profile_db)
            peak_band = int(np.argmax(summary))
            if "peakHz" in anchor:
                wanted = {_octave_band_of(anchor["peakHz"])}
                limit = f"peak octave contains ~{anchor['peakHz']} Hz"
            else:
                lo, hi = anchor["peakRangeHz"]
                wanted = {_octave_band_of(lo), _octave_band_of(hi)}
                limit = f"peak octave within {lo}-{hi} Hz"
            rows.append(_row("envelope-peak", register, dynamic,
                             OCTAVE_CENTRES_HZ[peak_band], limit,
                             peak_band in wanted))

    failed = [row for row in rows if row["status"] == "fail"]
    return {
        "instrument": instrument,
        "passed": not failed,
        "counts": {
            "pass": sum(row["status"] == "pass" for row in rows),
            "fail": len(failed),
            "notApplicable": sum(row["status"] == "not-applicable" for row in rows),
        },
        "bars": rows,
        "activeBars": sorted(active_bars),
    }


# Bars a family legitimately never measures (excluded from strict coverage)
FAMILY_INAPPLICABLE_BARS = {
    "blown": {"inharmonicity"},
}


def aggregate_by_cell(gate: dict[str, Any],
                      required_cells: list[tuple[str, str]] | None = None,
                      *,
                      required_cells_by_bar: dict[
                          str, list[tuple[str, str]]] | None = None,
                      required_bars: list[str] | None = None,
                      family: str | None = None,
                      ) -> dict[str, Any]:
    """T-013/T-017 campaign aggregation: evidence per BAR x register x dynamic.

    An individual short take stays visibly not-applicable; a (bar,
    register, dynamic) cell passes when at least one eligible take
    measured that bar there and every measured take clears its limit.
    Strict coverage is per bar-cell (T-017): an onset measurement can
    never stand in for a missing band-balance measurement.  Only
    explicitly family-inapplicable bars are excluded from required bars;
    `strictMissingCells` carries the bar name so the run report names the
    missing evidence.
    """
    cells: dict[tuple[str, Any, str], dict[str, int]] = {}
    for row in gate["bars"]:
        key = (row["bar"], row["register"], str(row["dynamic"]))
        counts = cells.setdefault(key, {"pass": 0, "fail": 0, "notApplicable": 0})
        counts["pass" if row["status"] == "pass" else
               "fail" if row["status"] == "fail" else "notApplicable"] += 1
    cell_rows = []
    for (bar, register, dynamic), counts in sorted(cells.items()):
        measured = counts["pass"] + counts["fail"]
        status = ("no-evidence" if measured == 0 else
                  "pass" if counts["fail"] == 0 else "fail")
        cell_rows.append({"bar": bar, "register": register, "dynamic": dynamic,
                          "counts": counts, "status": status})
    failed = [row for row in cell_rows if row["status"] == "fail"]
    strict_missing = []
    if required_cells_by_bar is not None:
        inapplicable = FAMILY_INAPPLICABLE_BARS.get(family or "", set())
        by_key = {(row["bar"], row["register"], row["dynamic"]): row
                  for row in cell_rows}
        for bar, required in sorted(required_cells_by_bar.items()):
            if bar in inapplicable:
                continue
            for register, dynamic in required:
                row = by_key.get((bar, register, str(dynamic)))
                if row is None or row["status"] == "no-evidence":
                    strict_missing.append({
                        "bar": bar, "register": register, "dynamic": dynamic,
                    })
    elif required_cells:
        inapplicable = FAMILY_INAPPLICABLE_BARS.get(family or "", set())
        bars_required = [bar for bar in
                         (required_bars or sorted({row["bar"] for row in cell_rows}))
                         if bar not in inapplicable]
        by_key = {(row["bar"], row["register"], row["dynamic"]): row
                  for row in cell_rows}
        for register, dynamic in required_cells:
            for bar in bars_required:
                row = by_key.get((bar, register, str(dynamic)))
                if row is None or row["status"] == "no-evidence":
                    strict_missing.append({"bar": bar, "register": register,
                                           "dynamic": dynamic})
    return {
        "cells": cell_rows,
        "passed": not failed,
        "strictPassed": not failed and not strict_missing,
        "strictMissingCells": strict_missing,
    }


def tripwire_table_markdown(gate: dict[str, Any]) -> str:
    """RUN_REPORT.md rendering — the owner's at-a-glance §3 answer."""
    lines = [f"## §3 tripwire gate — {'PASS' if gate['passed'] else 'FAIL'}",
             "", "| Bar | Register | Dynamic | Value | Limit | Status |",
             "|---|---|---|---|---|---|"]
    for row in gate["bars"]:
        lines.append(f"| {row['bar']} | {row['register']} | {row['dynamic']} | "
                     f"{row['value']} | {row['limit']} | {row['status'].upper()} |")
    return "\n".join(lines) + "\n"


__all__ = [
    "evaluate_tripwires", "tripwire_table_markdown", "BARS",
    "ENVELOPE_PEAK_ANCHORS", "ROLE_BARS", "reference_roles",
    "required_cells_by_bar", "role_evidences_bar",
]
