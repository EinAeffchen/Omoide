from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import List

import numpy as np
import torch

from app.config import get_clip_bundle

SIMILARITY_THRESHOLD: float = 0.2


def _clip_device(model: torch.nn.Module) -> torch.device:
    try:
        return next(model.parameters()).device
    except StopIteration:
        return torch.device("cpu")


def sanitize_custom_tag_list(raw_tags: Iterable[str]) -> list[str]:
    """Normalize user-provided tag strings while preserving order.

    Whitespace is stripped, empty entries are discarded, and duplicates are
    removed using case-insensitive comparison.
    """
    seen: set[str] = set()
    sanitized: list[str] = []
    for raw in raw_tags:
        if not isinstance(raw, str):
            continue
        cleaned = raw.strip()
        if not cleaned:
            continue
        normalized = cleaned.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        sanitized.append(cleaned)
    return sanitized


def build_tag_vector_map(tags: Sequence[str]) -> dict[str, np.ndarray]:
    """Encode the provided tags into normalized CLIP embeddings."""
    if not tags:
        return {}

    model, _, tokenizer = get_clip_bundle()
    tokens = tokenizer(list(tags))
    device = _clip_device(model)
    if hasattr(tokens, "to"):
        tokens = tokens.to(device)
    with torch.no_grad():
        embeddings = model.encode_text(tokens)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)

    vectors: dict[str, np.ndarray] = {}
    for idx, tag in enumerate(tags):
        vectors[tag] = (
            embeddings[idx].detach().cpu().numpy().astype(np.float32, copy=False)
        )
    return vectors


__all__ = [
    "SIMILARITY_THRESHOLD",
    "build_tag_vector_map",
    "sanitize_custom_tag_list",
]
