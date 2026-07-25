"""Environment configuration lookup with legacy-name fallback.

Settings are named ``SOUNDINATOR_*``. The app shipped under the working title
"Resona", so every setting is also accepted under its old ``RESONA_*`` name and
the legacy name wins only when the new one is absent. That keeps a deployment
whose env file still uses the old keys working untouched — important because
these flags fail *open* (an unread ``SOUNDINATOR_AUTH_REQUIRED`` would silently
unlock the whole site rather than erroring).

Drop the fallback once every deployment's env file has been migrated.
"""

from __future__ import annotations

import os

ENV_PREFIX = "SOUNDINATOR_"
LEGACY_ENV_PREFIX = "RESONA_"


def env_value(suffix: str) -> str:
    """Return ``SOUNDINATOR_<suffix>``, falling back to ``RESONA_<suffix>``."""
    for prefix in (ENV_PREFIX, LEGACY_ENV_PREFIX):
        value = os.environ.get(prefix + suffix)
        if value is not None:
            return value.strip()
    return ""


def env_flag(suffix: str) -> bool:
    """True when the setting is present and set to a truthy string."""
    return env_value(suffix).lower() in ("1", "true", "yes", "on")
