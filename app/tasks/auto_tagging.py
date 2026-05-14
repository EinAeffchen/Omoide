from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone
import threading

import numpy as np
from sqlalchemy import select, text
from sqlmodel import Session

import app.database as db
from app.database import safe_commit
from app.logger import logger
from app.models import MediaTagLink, ProcessingTask, Tag
from app.tagging import (
    SIMILARITY_THRESHOLD,
    build_tag_vector_map,
    sanitize_custom_tag_list,
)
from app.tasks.state import (
    clear_task_progress,
    record_task_failure,
    set_task_progress,
)
from app.utils import vector_from_stored

COUNT_CUSTOM_AUTOTAG_MEDIA_SQL = text(
    """
    SELECT COUNT(1)
    FROM media AS m
    JOIN media_embeddings AS me ON me.media_id = m.id
    WHERE m.missing_since IS NULL
      AND m.embeddings_created = 1
    """
)
SELECT_CUSTOM_AUTOTAG_MEDIA_SQL = text(
    """
    SELECT
        m.id   AS media_id,
        m.path AS path,
        me.embedding AS embedding
    FROM media AS m
    JOIN media_embeddings AS me ON me.media_id = m.id
    WHERE m.missing_since IS NULL
      AND m.embeddings_created = 1
    """
)


def _get_or_create_tag(
    session: Session,
    tag_name: str,
    cache: dict[str, Tag],
) -> Tag:
    """Retrieve or create a Tag by lowercased name without eager commits."""
    key = tag_name.lower()
    cached = cache.get(key)
    if cached is not None:
        return cached

    existing = session.exec(select(Tag).where(Tag.name == key)).first()
    if existing is not None:
        cache[key] = existing
        return existing
    tag = Tag(name=key)
    session.add(tag)
    session.flush()  # Ensure ID is assigned before linking
    cache[key] = tag
    return tag


def run_custom_auto_tagging(task_id: str, tags: Sequence[str]) -> None:
    """Apply auto-tagging for the provided tag list across all media embeddings."""
    sanitized_tags = sanitize_custom_tag_list(tags)
    if not sanitized_tags:
        logger.info("Auto-tagging task %s skipped: no tags to process.", task_id)
        return

    tag_vectors = build_tag_vector_map(sanitized_tags)
    if not tag_vectors:
        logger.info(
            "Auto-tagging task %s skipped: failed to build tag vectors.", task_id
        )
        return

    ordered_tags = list(tag_vectors.keys())
    tag_matrix = np.stack(
        [tag_vectors[tag] for tag in ordered_tags], axis=0
    ).astype(np.float32, copy=False)

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if task is None:
            logger.warning(
                "Auto-tagging task %s aborted: processing task record missing.",
                task_id,
            )
            return

        total = session.exec(COUNT_CUSTOM_AUTOTAG_MEDIA_SQL).scalar_one_or_none() or 0
        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        task.processed = 0
        task.total = total
        session.add(task)
        safe_commit(session)

        set_task_progress(
            task_id,
            current_step="preparing",
            current_item=None,
            tags=len(ordered_tags),
        )

        if total == 0:
            task.status = "completed"
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
            clear_task_progress(task_id)
            return

        tag_cache: dict[str, Tag] = {}
        pending_links = 0
        processed = 0
        cancelled = False

        try:
            rows = session.exec(SELECT_CUSTOM_AUTOTAG_MEDIA_SQL).mappings()
            for row in rows:
                session.refresh(task, attribute_names=["status"])
                if task.status == "cancelled":
                    cancelled = True
                    break

                media_id = row["media_id"]
                media_path = row["path"] or ""
                embedding_blob = row["embedding"]

                set_task_progress(
                    task_id,
                    current_step="tagging",
                    current_item=str(media_path),
                )

                embedding = vector_from_stored(embedding_blob)
                if embedding is None or embedding.size == 0:
                    logger.debug(
                        "Auto-tagging skipped for media %s: missing embedding.",
                        media_id,
                    )
                    continue

                scores = np.dot(tag_matrix, embedding.astype(np.float32, copy=False))
                try:
                    for idx, similarity in enumerate(scores):
                        if float(similarity) <= SIMILARITY_THRESHOLD:
                            continue
                        tag_name = ordered_tags[idx]
                        tag_obj = _get_or_create_tag(session, tag_name, tag_cache)
                        if session.get(
                            MediaTagLink, (media_id, tag_obj.id)
                        ) is None:
                            session.add(
                                MediaTagLink(
                                    media_id=media_id,
                                    tag_id=tag_obj.id,
                                    auto_score=float(similarity),
                                )
                            )
                            pending_links += 1
                except Exception as exc:
                    logger.exception(
                        "Auto-tagging failed for media %s (%s): %s",
                        media_id,
                        media_path,
                        exc,
                    )
                    record_task_failure(
                        task_id,
                        path=str(media_path) or f"media:{media_id}",
                        reason=str(exc),
                    )
                    session.rollback()
                    continue

                processed += 1
                task.processed = processed
                session.add(task)

                if pending_links >= 50:
                    safe_commit(session)
                    pending_links = 0
                elif processed % 25 == 0:
                    safe_commit(session)
        except Exception as exc:
            session.rollback()
            logger.exception(
                "Auto-tagging task %s encountered a fatal error: %s", task_id, exc
            )
            task.status = "failed"
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
            clear_task_progress(task_id)
            return

        if pending_links:
            safe_commit(session)

        if not cancelled:
            task.status = "completed"
        task.finished_at = datetime.now(timezone.utc)
        session.add(task)
        safe_commit(session)
        clear_task_progress(task_id)


def schedule_custom_auto_tagging(tags: Sequence[str]) -> ProcessingTask | None:
    """Create (if needed) and launch a background task to auto-tag provided tags."""
    sanitized_tags = sanitize_custom_tag_list(tags)
    if not sanitized_tags:
        return None

    with Session(db.engine) as session:
        existing = session.exec(
            select(ProcessingTask).where(
                ProcessingTask.task_type == "auto_tag_custom",
                ProcessingTask.status.in_(("pending", "running")),
            )
        ).first()
        if existing:
            logger.info(
                "Auto-tagging task already active (id=%s); skipping new schedule.",
                existing.id,
            )
            return existing

        total = session.exec(COUNT_CUSTOM_AUTOTAG_MEDIA_SQL).scalar_one_or_none() or 0
        if total == 0:
            logger.info(
                "Auto-tagging task skipped: no embedded media available for tagging."
            )
            return None

        task = ProcessingTask(task_type="auto_tag_custom")
        session.add(task)
        safe_commit(session)
        session.refresh(task)
        task_id = task.id

    thread = threading.Thread(
        target=run_custom_auto_tagging,
        args=(task_id, tuple(sanitized_tags)),
        name=f"auto-tag-custom-{task_id}",
        daemon=True,
    )
    thread.start()
    return task
