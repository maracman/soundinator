"""Renderer interfaces."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Mapping

import numpy as np


class Renderer(ABC):
    name: str

    @abstractmethod
    def render(self, events: list[Mapping]) -> np.ndarray:
        """Render events to a mono float32 array in [-1, 1-ish]."""
