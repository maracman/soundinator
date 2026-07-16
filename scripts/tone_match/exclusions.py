"""Owner-rejected reference takes — hard-excluded everywhere (T-012, L3).

A take the owner's ears rejected must be absent from spectral fitting,
tripwire rows, duplicate floors, controllability inputs, and the
reference-set/objective hash.  Exclusion is PER TAKE, never per source
(the owner passed `saxophone_C4_15_fortissimo_normal.mp3` explicitly).

Every reference builder consults this registry, and `assert_no_excluded`
is the consuming-side check (T-007): a references.json that slipped an
excluded take through fails before any campaign consumes it.
"""

from __future__ import annotations

from typing import Any

# sourceFile basename -> reason (owner note id + verdict)
OWNER_EXCLUDED_TAKES: dict[str, str] = {
    "trumpet_C5_15_fortissimo_normal.mp3":
        "L3: owner-rejected — 'sounds like it has a mute on it'",
}


def is_excluded(source_file: str) -> bool:
    return source_file in OWNER_EXCLUDED_TAKES


def assert_no_excluded(references: list[dict[str, Any]], context: str) -> None:
    """Raise when any reference row descends from an owner-rejected take."""
    offenders = sorted({row.get("sourceFile") for row in references
                        if row.get("sourceFile") in OWNER_EXCLUDED_TAKES})
    if offenders:
        details = "; ".join(f"{name} ({OWNER_EXCLUDED_TAKES[name]})"
                            for name in offenders)
        raise ValueError(
            f"{context}: owner-excluded take(s) in reference set: {details}. "
            "Rebuild the manifest; the objective/reference-set id must never "
            "hash an owner-rejected take (T-012).")


__all__ = ["OWNER_EXCLUDED_TAKES", "is_excluded", "assert_no_excluded"]
