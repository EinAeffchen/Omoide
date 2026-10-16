"""Encoding of embedding vectors stored in the sqlite-vec tables."""

import json
from typing import Any

import numpy as np

from app.logger import logger


def _coerce_vector_array(value: Any) -> np.ndarray | None:
    """Normalize assorted embedding representations into a 1D float32 array."""
    if value is None:
        return None

    if isinstance(value, np.ndarray):
        arr = value.astype(np.float32, copy=False)
    elif isinstance(value, memoryview) or isinstance(value, (bytes, bytearray)):
        arr = np.frombuffer(value, dtype=np.float32)
    elif isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            logger.debug("Failed to decode embedding JSON; value=%s", value[:32])
            return None
        return _coerce_vector_array(parsed)
    else:
        try:
            arr = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError):
            return None

    if arr.ndim == 0:
        return None
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    return arr


def vector_to_blob(value: Any) -> bytes | None:
    """Convert a sequence/JSON/blob embedding to the raw bytes sqlite-vec expects."""
    arr = _coerce_vector_array(value)
    if arr is None:
        return None
    return arr.tobytes()


def vector_from_stored(value: Any) -> np.ndarray | None:
    """Decode a stored sqlite-vec embedding (bytes/JSON/list) into a numpy vector."""
    arr = _coerce_vector_array(value)
    if arr is None:
        return None
    return arr


def distance_to_similarity(dist: float) -> float:
    similarity = (1.0 - (float(dist) * float(dist)) / 2.0) * 100.0
    return round(max(0.0, min(100.0, similarity)), 2)
