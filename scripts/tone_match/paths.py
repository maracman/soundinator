"""Durable filesystem locations for Sound Generator 2.0 artifacts."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def sg2_data_root() -> Path:
    """Return SG2_DATA or the primary repository's gitignored sg2-data."""
    override = os.environ.get("SG2_DATA")
    if override:
        return Path(override).expanduser().resolve()
    try:
        common = subprocess.run(
            ["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
            cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout.strip()
        return Path(common).resolve().parent / "sg2-data"
    except (OSError, subprocess.CalledProcessError):
        return ROOT / "sg2-data"
