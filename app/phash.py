"""Perceptual hashes used for duplicate detection."""

import os
from pathlib import Path
from typing import Literal

import cv2
import imagehash
import numpy as np
from PIL import Image

from app.logger import logger
from app.models import Media
from app.thumbnails import _frame_to_image


def _generate_video_perceptual_hash(media: Media) -> str | None:
    """Derive a single perceptual hash for a video by sampling a few frames."""
    path = Path(media.path)
    if not path.exists():
        logger.warning("Video path does not exist for hashing: %s", path)
        return None

    target_samples = 8
    cap = cv2.VideoCapture(os.fspath(path))
    if not cap.isOpened():
        logger.warning("Could not open video for hashing: %s", path)
        return None

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = float(media.duration or 0.0)
        if duration <= 0 and fps > 0 and frame_count > 0:
            duration = frame_count / fps

        timestamps: list[float] = []
        if duration > 0:
            effective_samples = (
                min(target_samples, frame_count) if frame_count else target_samples
            )
            effective_samples = max(effective_samples, 1)
            timestamps = (
                np.linspace(
                    0,
                    max(duration - 1.0 / max(fps, 1.0), 0),
                    effective_samples,
                    endpoint=False,
                )
                .astype(float)
                .tolist()
            )
        elif fps > 0 and frame_count > 0:
            frame_indices = np.linspace(
                0, frame_count - 1, min(target_samples, frame_count), dtype=np.int64
            )
            timestamps = [int(idx) / fps for idx in frame_indices]

        hashes: list[imagehash.ImageHash] = []

        def _hash_frame_at(ts_seconds: float) -> None:
            cap.set(cv2.CAP_PROP_POS_MSEC, ts_seconds * 1000.0)
            success, frame = cap.read()
            if not success:
                return
            img = _frame_to_image(frame)
            if img is None:
                return
            try:
                hashes.append(imagehash.phash(img))
            except Exception as exc:
                logger.debug(
                    "Failed to hash video frame at %.2fs (%s): %s",
                    ts_seconds,
                    path,
                    exc,
                )

        for ts in timestamps:
            _hash_frame_at(ts)
            if len(hashes) >= target_samples:
                break

        if not hashes:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            remaining = min(
                target_samples, frame_count if frame_count > 0 else target_samples
            )
            while remaining > 0:
                success, frame = cap.read()
                if not success:
                    break
                img = _frame_to_image(frame)
                if img is None:
                    remaining -= 1
                    continue
                try:
                    hashes.append(imagehash.phash(img))
                except Exception:
                    pass
                remaining -= 1

        if not hashes:
            return None

        try:
            hash_matrix = np.stack([h.hash for h in hashes]).astype(np.float32)
        except ValueError:
            return str(hashes[0])

        majority = hash_matrix.mean(axis=0) >= 0.5
        combined = imagehash.ImageHash(majority)
        return str(combined)
    finally:
        cap.release()


def generate_perceptual_hash(
    media: Media, type: Literal["image", "video"]
) -> str | None:
    try:
        if type == "image":
            with Image.open(media.path) as img:
                return str(imagehash.phash(img))
        if type == "video":
            return _generate_video_perceptual_hash(media)
    except Exception:
        logger.warning(
            "Failed to generate perceptual hash for %s", media.path, exc_info=True
        )
