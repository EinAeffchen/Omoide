from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import numpy as np
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, or_
from sqlmodel import Session, col, select

import app.database as db
from app.api.media import delete_record
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, ProcessingTask, Status
from app.processor_registry import load_processors, processors
from app.utils import split_video
from .state import clear_task_progress, set_task_progress

__all__ = [
    "run_media_processing",
    "run_media_processing_and_chain",
    "run_single_processor",
    "run_processors_for_media",
]


def _is_task_cancelled(task_id: str) -> bool:
    """Check cancellation using a fresh session.

    The long-lived processing session holds an open transaction whose snapshot
    predates any cancel committed by the API endpoint.  A throw-away session
    always starts a new transaction and therefore reads the latest committed
    status, making cancel responsive within a single item rather than a full
    batch.
    """
    try:
        with Session(db.engine) as s:
            task = s.get(ProcessingTask, task_id)
            return task is not None and task.status == Status.CANCELLED
    except Exception:
        return False


def _media_processing_conditions() -> list:
    """Return filter clauses for media rows needing processing."""
    conditions: list = []
    active_processors = {
        proc.name for proc in processors if getattr(proc, "active", False)
    }
    if active_processors & {"faces", "embedding_extractor", "auto_tagger"}:
        conditions.append(Media.extracted_scenes.is_(False))
    flag_columns = {
        "faces": Media.faces_extracted,
        "auto_tagger": Media.ran_auto_tagging,
        "embedding_extractor": Media.embeddings_created,
    }
    for name, column in flag_columns.items():
        if name in active_processors:
            conditions.append(column.is_(False))
    if "blur" in active_processors:
        conditions.append(col(Media.laplacian_score).is_(None))
    return conditions


def _count_media_to_process(session: Session) -> int:
    conditions = _media_processing_conditions()
    if not conditions:
        return 0
    return (
        session.exec(
            select(func.count(Media.id)).where(
                or_(*conditions),
                col(Media.missing_since).is_(None),
                col(Media.processing_error).is_(None),
            )
        ).first()
        or 0
    )


def _fetch_media_batch_to_process(session: Session, limit: int) -> list[Media]:
    conditions = _media_processing_conditions()
    if not conditions:
        return []
    return session.exec(
        select(Media)
        .where(
            or_(*conditions),
            col(Media.missing_since).is_(None),
            col(Media.processing_error).is_(None),
        )
        .order_by(Media.duration.asc())
        .limit(limit)
    ).all()


def _get_or_extract_scenes(
    media: Media, session: Session
) -> list[Image.Image | tuple]:
    media_path_obj = Path(media.path)
    suffix = media_path_obj.suffix.lower()

    if media.extracted_scenes and suffix not in settings.scan.IMAGE_SUFFIXES:
        return media.scenes

    try:
        if suffix in settings.scan.IMAGE_SUFFIXES:
            scenes = [Image.open(media_path_obj)]
        else:
            scenes = split_video(media, media_path_obj)
    except FileNotFoundError:
        logger.warning("File not found: %s. Deleting record.", media.path)
        delete_record(media.id, session)
        return []
    except UnidentifiedImageError:
        if media.extracted_scenes:
            logger.warning(
                "Transient PIL error re-opening previously-processed image %s; skipping without marking broken.",
                media_path_obj,
            )
            return []
        logger.warning("Skipping broken image file: %s.", media_path_obj)
        media.extracted_scenes = True
        media.processing_error = "Unrecognized image format: PIL could not identify this file."
        session.add(media)
        return []
    except Exception as exc:
        if media.extracted_scenes:
            logger.warning(
                "Transient error re-opening previously-processed image %s; skipping without marking broken. %s: %s",
                media_path_obj,
                type(exc).__name__,
                exc,
            )
            return []
        logger.exception("Failed to extract frames for %s.", media.path)
        media.extracted_scenes = True
        media.processing_error = (
            f"Failed to extract frames: {type(exc).__name__}: {str(exc)}"
        )[:500]
        session.add(media)
        return []

    media.extracted_scenes = True
    session.add(media)

    for scene in scenes:
        if isinstance(scene, tuple) and hasattr(scene[0], "id"):
            session.add(scene[0])

    return scenes


def _apply_processors(
    media: Media, scenes: list, session: Session, task_id: str | None = None
) -> bool:
    if not scenes:
        logger.warning(
            "Skipping processors for %s due to no scenes.", media.filename
        )
        media.faces_extracted = True
        media.ran_auto_tagging = True
        media.embeddings_created = True
        if media.laplacian_score is None:
            media.laplacian_score = -1.0
        session.add(media)
        return True

    success = True
    current_item = os.fspath(media.path) if media.path else None
    for proc in processors:
        if not proc.active:
            continue
        try:
            if task_id and current_item:
                set_task_progress(
                    task_id,
                    current_item=current_item,
                    current_step=proc.name,
                )
            if not proc.process(media, session, scenes=scenes):
                logger.error(
                    "Processor '%s' failed for media %s.",
                    proc.name,
                    media.path,
                )
                logger.error(
                    "Marking media %s as processed after '%s' failure to prevent re-queue; please investigate logs above.",
                    media.id,
                    proc.name,
                )
                media.faces_extracted = True
                media.ran_auto_tagging = True
                media.embeddings_created = True
                if media.laplacian_score is None:
                    media.laplacian_score = -1.0
                session.add(media)
                success = False
                break
        except Exception:
            logger.exception(
                "Processor '%s' raised an exception on media %s",
                proc.name,
                media.path,
            )
            logger.error(
                "Marking media %s as processed after exception in '%s' to prevent re-queue; please investigate stack above.",
                media.id,
                proc.name,
            )
            media.faces_extracted = True
            media.ran_auto_tagging = True
            media.embeddings_created = True
            if media.laplacian_score is None:
                media.laplacian_score = -1.0
            session.add(media)
            success = False
            break
    return success


def run_media_processing_and_chain(task_id: str) -> None:
    run_media_processing(task_id)

    logger.info("Media processing finished.")
    if settings.general.enable_people and settings.scan.auto_cluster_on_scan:
        logger.info("Starting Person Clustering...")
        with Session(db.engine) as new_session:
            next_task = ProcessingTask(
                task_type="cluster_persons", total=0, processed=0
            )
            new_session.add(next_task)
            new_session.commit()
            new_session.refresh(next_task)

        from .person_clustering import run_person_clustering

        run_person_clustering(next_task.id)
    logger.info("Task chain completed")


def run_media_processing(task_id: str) -> None:
    try:
        _run_media_processing(task_id)
    except Exception:
        logger.exception("Unhandled error in run_media_processing (task %s)", task_id)
        try:
            with Session(db.engine) as s:
                task = s.get(ProcessingTask, task_id)
                if task and task.status == "running":
                    task.status = "failed"
                    task.finished_at = datetime.now(timezone.utc)
                    s.add(task)
                    safe_commit(s)
        except Exception:
            logger.exception("Failed to mark task %s as failed", task_id)


def _run_media_processing(task_id: str) -> None:
    configured_batch_size = getattr(
        settings.processors, "media_batch_size", None
    )
    try:
        batch_size = int(configured_batch_size or 0)
    except (TypeError, ValueError):
        batch_size = 0
    if batch_size <= 0:
        batch_size = 100

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task with id %s not found!", task_id)
            return

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        session.add(task)
        safe_commit(session)

        set_task_progress(task_id, current_step="preparing", current_item=None)

        def is_cancelled() -> bool:
            try:
                session.refresh(task, attribute_names=["status"])
                return task.status == "cancelled"
            except Exception:
                return False

        if not processors:
            logger.debug("Processor registry empty; loading processors now.")
            set_task_progress(task_id, current_step="loading_models")
            load_processors()

        with heavy_writer(
            name="process_media", cancelled=is_cancelled
        ) as acquired:
            if not acquired:
                session.refresh(task)
                task.status = "cancelled"
                task.finished_at = datetime.now(timezone.utc)
                session.add(task)
                safe_commit(session)
                clear_task_progress(task_id)
                return

            for proc in processors:
                proc.active = False
                proc.load_model()

            task.total = _count_media_to_process(session)
            session.add(task)
            safe_commit(session)

            while True:
                session.refresh(task, attribute_names=["status"])
                if task.status == "cancelled":
                    logger.info("Task cancelled. Stopping before next batch.")
                    break

                medias_batch = _fetch_media_batch_to_process(session, batch_size)
                if not medias_batch:
                    logger.info("No more media to process. Finishing.")
                    break

                logger.info(
                    "Processing batch of %d media items...",
                    len(medias_batch),
                )

                batch_dirty = False
                cancelled_mid_batch = False

                for media in medias_batch:
                    session.refresh(task, attribute_names=["status"])
                    if task.status == "cancelled":
                        logger.info("Task cancelled mid-batch. Stopping.")
                        cancelled_mid_batch = True
                        break

                    media_path = Path(media.path) if media.path else None

                    if media_path is None or not media_path.exists():
                        if not media.missing_since:
                            media.missing_since = datetime.now(timezone.utc)
                            session.add(media)
                            batch_dirty = True
                        continue
                    if media.missing_since:
                        media.missing_since = None
                        media.missing_confirmed = False
                        session.add(media)
                        batch_dirty = True

                    logger.info("Processing: %s", media.filename)
                    set_task_progress(
                        task_id,
                        current_item=os.fspath(media.path),
                        current_step="extracting_scenes",
                    )
                    scenes = _get_or_extract_scenes(media, session)
                    logger.debug(
                        "Scenes for %s: %s",
                        media.filename,
                        len(scenes) if scenes is not None else 0,
                    )
                    if not scenes and (
                        media_path is None or not media_path.exists()
                    ):
                        batch_dirty = True
                        set_task_progress(task_id, current_step="idle")
                        continue

                    _apply_processors(media, scenes, session, task_id=task_id)
                    session.add(media)

                    task.processed += 1
                    batch_dirty = True
                    session.add(task)
                    set_task_progress(task_id, current_step="idle")

                if batch_dirty:
                    remaining = _count_media_to_process(session)
                    task.total = task.processed + remaining
                    session.add(task)
                    safe_commit(session)

                if cancelled_mid_batch:
                    break

            for proc in processors:
                try:
                    proc.unload()
                except Exception:
                    pass

            session.refresh(task)
            remaining = _count_media_to_process(session)
            task.total = task.processed + remaining
            task.status = (
                "completed" if task.status != "cancelled" else "cancelled"
            )
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
            clear_task_progress(task_id)


def run_single_processor(
    task_id: str, processor_name: str, force: bool = False
) -> None:
    """Run one named processor over all media.

    force=False  – skip media already processed by this processor (default)
    force=True   – reset each item's result and reprocess everything
    """
    if not processors:
        load_processors()

    target = next((p for p in processors if p.name == processor_name), None)
    if target is None:
        logger.error("Processor '%s' not found.", processor_name)
        return

    target.load_model()
    target.active = True  # run regardless of per-processor config flag

    pending_condition = None if force else target.get_pending_condition()
    # When there is no pending condition and we are not forcing, treat every
    # media item as a candidate (e.g. exif processor has no completion flag).
    use_offset_paging = force or pending_condition is None

    batch_size = 100

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = Status.RUNNING
        task.started_at = datetime.now(timezone.utc)
        session.add(task)
        safe_commit(session)

        set_task_progress(task_id, current_step="preparing", current_item=None)

        with heavy_writer(
            name=f"run_processor_{processor_name}",
            cancelled=lambda: _is_task_cancelled(task_id),
        ) as acquired:
            if not acquired:
                session.refresh(task)
                task.status = Status.CANCELLED
                task.finished_at = datetime.now(timezone.utc)
                session.add(task)
                safe_commit(session)
                clear_task_progress(task_id)
                return

            def _count() -> int:
                stmt = select(func.count(col(Media.id))).where(
                    col(Media.missing_since).is_(None)
                )
                if pending_condition is not None:
                    stmt = stmt.where(pending_condition)
                return session.exec(stmt).first() or 0

            task.total = _count()
            session.add(task)
            safe_commit(session)

            offset = 0
            while True:
                if _is_task_cancelled(task_id):
                    logger.info("Task cancelled. Stopping before next batch.")
                    break

                stmt = select(Media).where(col(Media.missing_since).is_(None))
                if pending_condition is not None:
                    stmt = stmt.where(pending_condition)
                if use_offset_paging:
                    stmt = stmt.order_by(col(Media.id).asc()).offset(offset)
                else:
                    stmt = stmt.order_by(col(Media.duration).asc())
                stmt = stmt.limit(batch_size)

                batch: List[Media] = session.exec(stmt).all()
                if not batch:
                    break

                logger.info(
                    "Processor '%s': processing batch of %d items (offset %d).",
                    processor_name,
                    len(batch),
                    offset,
                )

                batch_dirty = False
                cancelled_mid_batch = False

                for media in batch:
                    if _is_task_cancelled(task_id):
                        cancelled_mid_batch = True
                        break

                    media_path = Path(media.path) if media.path else None
                    if media_path is None or not media_path.exists():
                        offset += 1
                        continue

                    if force:
                        target.reset_for_media(media, session)

                    set_task_progress(
                        task_id,
                        current_item=os.fspath(media.path),
                        current_step="extracting_scenes",
                    )
                    scenes = _get_or_extract_scenes(media, session)

                    if scenes:
                        set_task_progress(
                            task_id,
                            current_item=os.fspath(media.path),
                            current_step=processor_name,
                        )
                        target.process(media, session, scenes=scenes)
                        session.add(media)

                    task.processed += 1
                    batch_dirty = True
                    session.add(task)
                    set_task_progress(task_id, current_step="idle")

                if batch_dirty:
                    safe_commit(session)

                if cancelled_mid_batch:
                    break

                if use_offset_paging:
                    offset += len(batch)

            try:
                target.unload()
            except Exception:
                pass

            remaining = _count()
            task.total = task.processed + remaining
            task.status = (
                Status.CANCELLED
                if _is_task_cancelled(task_id)
                else Status.COMPLETED
            )
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
            clear_task_progress(task_id)


def run_processors_for_media(
    task_id: str, processor_names: list[str], media_ids: list[int]
) -> None:
    """Run a specific set of processors over a specific set of media IDs.

    Each processor is run in sequence; each media item is reset before reprocessing.
    """
    if not processors:
        load_processors()

    targets = [p for p in processors if p.name in processor_names]
    if not targets:
        logger.error("None of the requested processors were found: %s", processor_names)
        return

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = Status.RUNNING
        task.started_at = datetime.now(timezone.utc)
        task.total = len(media_ids) * len(targets)
        session.add(task)
        safe_commit(session)

        set_task_progress(task_id, current_step="preparing", current_item=None)

        with heavy_writer(
            name="run_processors_for_media",
            cancelled=lambda: _is_task_cancelled(task_id),
        ) as acquired:
            if not acquired:
                session.refresh(task)
                task.status = Status.CANCELLED
                task.finished_at = datetime.now(timezone.utc)
                session.add(task)
                safe_commit(session)
                clear_task_progress(task_id)
                return

            for target in targets:
                if _is_task_cancelled(task_id):
                    break

                target.load_model()
                target.active = True

                batch_size = 100
                cancelled_processor = False

                for batch_start in range(0, len(media_ids), batch_size):
                    if _is_task_cancelled(task_id):
                        cancelled_processor = True
                        break

                    batch_ids = media_ids[batch_start : batch_start + batch_size]
                    batch: List[Media] = session.exec(
                        select(Media).where(
                            col(Media.id).in_(batch_ids),
                            col(Media.missing_since).is_(None),
                        )
                    ).all()

                    batch_dirty = False
                    for media in batch:
                        if _is_task_cancelled(task_id):
                            cancelled_processor = True
                            break

                        media_path = Path(media.path) if media.path else None
                        if media_path is None or not media_path.exists():
                            task.processed += 1
                            continue

                        target.reset_for_media(media, session)

                        set_task_progress(
                            task_id,
                            current_item=os.fspath(media.path),
                            current_step="extracting_scenes",
                        )
                        scenes = _get_or_extract_scenes(media, session)

                        if scenes:
                            set_task_progress(
                                task_id,
                                current_item=os.fspath(media.path),
                                current_step=target.name,
                            )
                            target.process(media, session, scenes=scenes)
                            session.add(media)

                        task.processed += 1
                        batch_dirty = True
                        session.add(task)
                        set_task_progress(task_id, current_step="idle")

                    if batch_dirty:
                        safe_commit(session)

                    if cancelled_processor:
                        break

                try:
                    target.unload()
                except Exception:
                    pass

                if cancelled_processor:
                    break

            task.status = (
                Status.CANCELLED
                if _is_task_cancelled(task_id)
                else Status.COMPLETED
            )
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
            clear_task_progress(task_id)
