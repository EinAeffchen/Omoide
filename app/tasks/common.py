from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

from app.config import settings
from app.logger import logger
from app.models import ProcessingTask

__all__ = ["create_and_run_task"]


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

    background_tasks.add_task(callable_task, task.id)
    return task
