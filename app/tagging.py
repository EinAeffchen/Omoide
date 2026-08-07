from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import List

import numpy as np
import torch

from app.config import get_clip_bundle

# Fallback flat cutoff used only when no per-tag calibration sample is
# available yet (e.g. an empty library on first run).
SIMILARITY_THRESHOLD: float = 0.2

# CLIP's text encoder is trained on photo captions, so a bare word like "dog"
# embeds less reliably than a caption-style phrase. Averaging a few templates
# per tag raises recall without touching the scoring/threshold logic.
PROMPT_TEMPLATES: tuple[str, ...] = (
    "{tag}",
    "a photo of {tag}",
    "a photo of a {tag}",
    "a picture of {tag}",
)

# Per-tag threshold calibration: how many samples to draw from the existing
# library, how many standard deviations above a tag's own mean score counts
# as "notably above typical", and the bounds that keep a degenerate
# distribution (tiny sample, near-zero variance) from producing an unusable
# cutoff.
CALIBRATION_SAMPLE_SIZE: int = 2000
CALIBRATION_STD_MULTIPLIER: float = 2.0
CALIBRATION_FLOOR: float = 0.15
CALIBRATION_CEILING: float = 0.45


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
    """Encode the provided tags into normalized CLIP embeddings.

    Each tag is embedded once per entry in PROMPT_TEMPLATES and the results
    are averaged, then re-normalized to a unit vector.
    """
    if not tags:
        return {}

    model, _, tokenizer = get_clip_bundle()
    device = _clip_device(model)

    prompts = [
        template.format(tag=tag) for tag in tags for template in PROMPT_TEMPLATES
    ]
    tokens = tokenizer(prompts)
    if hasattr(tokens, "to"):
        tokens = tokens.to(device)
    with torch.no_grad():
        embeddings = model.encode_text(tokens)
        embeddings = embeddings / embeddings.norm(dim=-1, keepdim=True)

    embeddings_np = embeddings.detach().cpu().numpy().astype(np.float32, copy=False)

    vectors: dict[str, np.ndarray] = {}
    n_templates = len(PROMPT_TEMPLATES)
    for idx, tag in enumerate(tags):
        chunk = embeddings_np[idx * n_templates : (idx + 1) * n_templates]
        averaged = chunk.mean(axis=0)
        norm = np.linalg.norm(averaged)
        if norm > 0:
            averaged /= norm
        vectors[tag] = averaged
    return vectors


def calibrate_tag_thresholds(
    tag_matrix: np.ndarray, sample_embeddings: np.ndarray
) -> np.ndarray:
    """Derive a per-tag similarity cutoff from that tag's own score distribution.

    A flat global cutoff treats every tag as if it sits on the same
    similarity scale, but CLIP's baseline affinity for a phrase varies a lot
    tag to tag. Instead, require a tag's score to clear its own mean by a few
    standard deviations, so generic tags need a bigger stand-out margin than
    rare/specific ones. Bounded by CALIBRATION_FLOOR/CEILING so a degenerate
    sample (too small, near-zero variance) can't produce an unusable cutoff.
    """
    n_tags = tag_matrix.shape[0]
    if sample_embeddings.size == 0 or sample_embeddings.shape[0] < 2:
        return np.full(n_tags, SIMILARITY_THRESHOLD, dtype=np.float32)

    scores = tag_matrix @ sample_embeddings.T  # (N_tags, N_samples)
    thresholds = scores.mean(axis=1) + CALIBRATION_STD_MULTIPLIER * scores.std(axis=1)
    return np.clip(thresholds, CALIBRATION_FLOOR, CALIBRATION_CEILING).astype(
        np.float32
    )


__all__ = [
    "SIMILARITY_THRESHOLD",
    "CALIBRATION_SAMPLE_SIZE",
    "build_tag_vector_map",
    "calibrate_tag_thresholds",
    "sanitize_custom_tag_list",
]
