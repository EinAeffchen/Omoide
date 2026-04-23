from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps
from sqlalchemy import func
from sqlmodel import Session, select

import app.database as db
from app.concurrency import heavy_writer
from app.config import settings
from app.logger import logger
from app.models import Media, ProcessingTask

__all__ = ["compute_blur_scores"]

_BATCH_SIZE = 200
_WORKERS = 4
_MAX_SIZE = 512  # match processor constant


def _score_from_path(path: str) -> float | None:
    """
    Compute Laplacian variance from a file path.

    Fast path for JPEGs: PIL draft mode requests a downscaled decode directly
    from the JPEG stream, avoiding full-resolution decompression. For all other
    formats we open normally and resize before computing.
    """
    try:
        img = Image.open(path)
        if getattr(img, "format", None) == "JPEG":
            # Ask the JPEG decoder for the smallest version that still covers _MAX_SIZE.
            img.draft("L", (_MAX_SIZE, _MAX_SIZE))
        if img.mode != "L":
            img = img.convert("L")
        w, h = img.size
        if max(w, h) > _MAX_SIZE:
            img = img.resize(
                (int(w * _MAX_SIZE / max(w, h)), int(h * _MAX_SIZE / max(w, h))),
                Image.BILINEAR,
            )
        arr = np.array(img, dtype=np.uint8)
        return float(cv2.Laplacian(arr, cv2.CV_32F).var())
    except Exception as exc:
        logger.debug("Failed to compute blur score for %s: %s", path, exc)
        return None


def _score_media(thumb_dir: Path, thumb_rel: str | None, original: str) -> float:
    """
    Return a Laplacian score for one media item.

    Prefers the thumbnail (already small JPEG, very fast to load) and falls
    back to the original file with JPEG draft mode.
    """
    # Fast path: use existing thumbnail
    if thumb_rel:
        thumb_path = thumb_dir / thumb_rel
        if thumb_path.exists():
            score = _score_from_path(str(thumb_path))
            if score is not None:
                return score
    # Fallback: original file
    if not original or not Path(original).exists():
        return -1.0
    score = _score_from_path(original)
    return score if score is not None else -1.0


def compute_blur_scores(task_id: str) -> None:
    thumb_dir = settings.general.thumb_dir

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)

        total = session.exec(
            select(func.count(Media.id)).where(Media.laplacian_score.is_(None))
        ).first() or 0
        if task:
            task.total = total
            task.processed = 0
            session.add(task)
            session.commit()

        def is_cancelled() -> bool:
            if not task:
                return False
            session.refresh(task, attribute_names=["status"])
            return task.status == "cancelled"

        processed = 0
        with heavy_writer(name="compute_blur_scores", cancelled=is_cancelled):
            while True:
                if is_cancelled():
                    return

                batch: list[Media] = session.exec(
                    select(Media)
                    .where(Media.laplacian_score.is_(None))
                    .limit(_BATCH_SIZE)
                ).all()
                if not batch:
                    break

                # Build lightweight tuples so threads don't touch the session.
                work = [(m.id, m.thumbnail_path, m.path) for m in batch]

                scores: dict[int, float] = {}
                with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
                    futures = {
                        pool.submit(_score_media, thumb_dir, thumb_rel, path): media_id
                        for media_id, thumb_rel, path in work
                    }
                    for future in as_completed(futures):
                        media_id = futures[future]
                        try:
                            scores[media_id] = future.result()
                        except Exception as exc:
                            logger.warning("Blur score failed for media %s: %s", media_id, exc)
                            scores[media_id] = -1.0

                # Write results back via the session (single-threaded).
                for media in batch:
                    media.laplacian_score = scores.get(media.id, -1.0)
                    session.add(media)
                processed += len(batch)
                session.commit()

                if task:
                    remaining = session.exec(
                        select(func.count(Media.id)).where(Media.laplacian_score.is_(None))
                    ).first() or 0
                    task.total = processed + remaining
                    task.processed = processed
                    session.add(task)
                    session.commit()

        if task:
            task.status = "completed"
            session.add(task)
            session.commit()
