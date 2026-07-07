from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Literal

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

import app.database as db
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import ProcessingTask

from .state import clear_task_progress

__all__ = ["create_and_run_task"]


def _run_task_guarded(callable_task: Callable[[str], None], task_id: str) -> None:
    """
    Run a background task and surface crashes.

    Without this, an unhandled exception dies inside the server's background
    executor: nothing reaches the app log and the task row stays "running"
    forever — indistinguishable from a hang for the user.
    """
    try:
        callable_task(task_id)
    except Exception:
        logger.exception(
            "Background task %s crashed with an unhandled exception", task_id
        )
        try:
            with Session(db.engine) as session:
                task = session.get(ProcessingTask, task_id)
                if task and task.status in ("pending", "running"):
                    task.status = "failed"
                    task.finished_at = datetime.now(timezone.utc)
                    session.add(task)
                    safe_commit(session)
        except Exception:
            logger.exception("Could not mark crashed task %s as failed", task_id)
        finally:
            clear_task_progress(task_id)


def create_and_run_task(
    session: Session,
    background_tasks: BackgroundTasks,
    task_type: Literal[
        "scan",
        "process_media",
        "cluster_persons",
        "find_duplicates",
        "clean_missing_files",
        "compute_blur_scores",
        "run_processor",
        "run_processor_for_media",
        "backfill_face_quality",
        "backfill_face_timestamps",
        "build_events",
        "geocode_places",
    ],
    callable_task: Callable[[str], None],
) -> ProcessingTask:
    """
    Creates a processing task in the database and adds the actual job to the
    background task queue.
    """
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403, detail="Not allowed in presentation_mode mode."
        )

    try:
        existing_task = session.exec(
            select(ProcessingTask).where(
                ProcessingTask.task_type == task_type,
                ProcessingTask.status == "running",
            )
        ).first()
    except OperationalError as exc:
        logger.warning("Database error while checking tasks: %s", exc)
        raise HTTPException(
            status_code=503, detail="Database is busy; try again shortly."
        )

    if existing_task:
        logger.info("%s is already running. Reusing existing task.", task_type)
        return existing_task

    task = ProcessingTask(task_type=task_type, total=0, processed=0)
    session.add(task)
    session.commit()
    session.refresh(task)

    background_tasks.add_task(_run_task_guarded, callable_task, task.id)
    return task
