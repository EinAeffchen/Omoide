from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from sqlmodel import Session, col, select

import app.database as db
from app.config import settings
from app.conversion import (
    ConversionError,
    ConversionMode,
    convert_media,
    existing_converted_copy,
    is_browser_playable,
)
from app.database import safe_commit
from app.logger import logger
from app.models import Media, ProcessingTask

from .state import clear_task_progress, record_task_failure, set_task_progress

__all__ = ["run_convert_media", "run_convert_unplayable_videos"]


def _cancelled(task_id: str) -> bool:
    with Session(db.engine) as s:
        task = s.get(ProcessingTask, task_id)
        return bool(task and task.status == "cancelled")


def _start(session: Session, task: ProcessingTask, total: int) -> None:
    task.status = "running"
    task.started_at = datetime.now(UTC)
    task.total = total
    task.processed = 0
    session.add(task)
    safe_commit(session)


def _finish(session: Session, task: ProcessingTask, status: str) -> None:
    session.refresh(task)
    if task.status != "cancelled":
        task.status = status
    task.finished_at = datetime.now(UTC)
    session.add(task)
    safe_commit(session)


def run_convert_media(task_id: str, media_id: int, mode: ConversionMode) -> None:
    """Convert one video; progress is reported in percent (total = 100)."""
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        media = session.get(Media, media_id)
        if not task or not media:
            logger.error("Conversion task %s: task or media missing", task_id)
            return
        _start(session, task, total=100)

        def progress(pct: int) -> None:
            if pct > task.processed:
                task.processed = pct
                session.add(task)
                safe_commit(session)
            set_task_progress(
                task_id, current_step="converting video", current_item=f"{pct}%"
            )

        try:
            convert_media(
                session,
                media,
                mode,
                on_progress=progress,
                cancelled=lambda: _cancelled(task_id),
            )
            task.processed = 100
            _finish(session, task, "completed")
        except (ConversionError, PermissionError, OSError) as exc:
            logger.warning("Conversion of %s failed: %s", media.path, exc)
            record_task_failure(task_id, media.path, str(exc))
            _finish(session, task, "failed")
    clear_task_progress(task_id)


def run_convert_unplayable_videos(
    task_id: str, mode: ConversionMode | None = None
) -> None:
    """Convert every video the browser cannot play, using `mode` (defaults to
    the configured automatic conversion mode)."""
    mode = mode or settings.video.auto_convert
    if mode == "off":
        logger.info("Automatic video conversion is off; nothing to do.")
        return
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            return
        videos = session.exec(
            select(Media).where(
                col(Media.duration).is_not(None),
                col(Media.missing_since).is_(None),
                col(Media.processing_error).is_(None),
            )
        ).all()
        _start(session, task, total=len(videos))
        converted = 0
        for media in videos:
            if _cancelled(task_id):
                break
            set_task_progress(
                task_id, current_step="checking videos", current_item=media.filename
            )
            try:
                needs_work = (
                    not existing_converted_copy(media.id)
                    and not is_browser_playable(Path(media.path))
                )
                if needs_work:
                    set_task_progress(
                        task_id,
                        current_step="converting video",
                        current_item=media.filename,
                    )
                    convert_media(
                        session, media, mode, cancelled=lambda: _cancelled(task_id)
                    )
                    converted += 1
            except (ConversionError, PermissionError, OSError) as exc:
                logger.warning("Conversion of %s failed: %s", media.path, exc)
                record_task_failure(task_id, media.path, str(exc))
            task.processed += 1
            session.add(task)
            safe_commit(session)
        logger.info("Converted %d of %d videos (%s).", converted, len(videos), mode)
        _finish(session, task, "completed")
    clear_task_progress(task_id)
