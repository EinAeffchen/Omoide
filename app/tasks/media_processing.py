from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import numpy as np
from PIL import Image, UnidentifiedImageError
from sqlalchemy import func, or_
from sqlmodel import Session, select

import app.database as db
from app.api.media import delete_record
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, ProcessingTask
from app.processor_registry import load_processors, processors
from app.utils import split_video
from .state import clear_task_progress, set_task_progress

__all__ = [
    "run_media_processing",
    "run_media_processing_and_chain",
]


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
    return conditions


def _count_media_to_process(session: Session) -> int:
    conditions = _media_processing_conditions()
    if not conditions:
        return 0
    return (
        session.exec(
            select(func.count(Media.id)).where(or_(*conditions))
        ).first()
        or 0
    )


def _fetch_media_batch_to_process(session: Session, limit: int) -> list[Media]:
    conditions = _media_processing_conditions()
    if not conditions:
        return []
    return session.exec(
        select(Media)
        .where(or_(*conditions), Media.missing_since.is_(None))
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
        logger.warning("Skipping broken image file: %s.", media_path_obj)
        media.extracted_scenes = True
        session.add(media)
        return []
    except Exception:
        logger.exception("Failed to extract scenes for %s.", media.path)
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
