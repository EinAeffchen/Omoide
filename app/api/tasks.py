from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session, safe_commit
from app.logger import logger
from app.models import Media, ProcessingTask, ProcessingTaskRead
from app.tasks import (
    clean_missing_files,
    compute_blur_scores,
    create_and_run_task,
    run_duplicate_detection,
    run_media_processing,
    run_person_clustering,
    run_processors_for_media,
    run_scan,
    run_single_processor,
)
from app.tasks import (
    reset_clustering as reset_clustering_task,
)
from app.tasks import (
    reset_processing as reset_processing_task,
)
from app.tasks import (
    state as task_state,
)
from app.utils import get_image_taken_date

router = APIRouter()


@router.post(
    "/process_media",
    response_model=ProcessingTask,
    summary="Detect faces and compute embeddings for all unprocessed media",
)
async def start_media_processing(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    logger.info("Starting processing!")
    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="process_media",
        callable_task=run_media_processing,
    )


@router.post(
    "/refresh_creation_date",
    summary="Refresh creation timestamps for media without EXIF info",
)
async def start_creation_refresh(
    session: Session = Depends(get_session),
):
    logger.info("Starting creation_date refresh!")
    batch_size = 100
    batch_count = 0
    offset = 0
    while True:
        media_batch = session.exec(select(Media).offset(offset).limit(batch_size)).all()

        if not media_batch:
            break

        for media in media_batch:
            if media.duration is not None:
                continue

            media_path_obj = Path(media.path)
            if not media_path_obj.exists():
                continue
            media.created_at = get_image_taken_date(media_path_obj)

        offset += batch_size
        session.commit()
        batch_count += 1
        logger.info("Finished batch: %s", batch_count)
    return {"status": "ok"}


@router.post(
    "/cluster_persons",
    response_model=ProcessingTask,
    summary="Cluster face embeddings into Person identities",
)
def start_person_clustering(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    task = create_and_run_task(
        session,
        background_tasks,
        "cluster_persons",
        callable_task=run_person_clustering,
    )
    return task


@router.post(
    "/scan", response_model=ProcessingTask, summary="Enqueue a media-scan task"
)
def start_scan(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    if not settings.general.media_dirs:
        raise HTTPException(status_code=400, detail="No media directories configured.")
    task = create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="scan",
        callable_task=run_scan,
    )
    return task


@router.post(
    "/find_duplicates",
    response_model=ProcessingTask,
    summary="Find and group duplicate images",
)
def start_duplicate_detection(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    threshold: int = 2,
):
    task = create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="find_duplicates",
        callable_task=lambda task_id: run_duplicate_detection(task_id, threshold),
    )
    return task


@router.post(
    "/clean_missing_files",
    summary="Scan for and delete records of files that no longer exist",
    response_model=ProcessingTask,
)
async def start_missing_files_cleanup(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="clean_missing_files",
        callable_task=clean_missing_files,
    )


@router.post(
    "/compute_blur_scores",
    summary="Compute Laplacian blur scores for all unscored media",
    response_model=ProcessingTask,
)
async def start_blur_scoring(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="compute_blur_scores",
        callable_task=compute_blur_scores,
    )


@router.post(
    "/run_processor/{processor_name}",
    response_model=ProcessingTask,
    summary="Run a single processor over all media",
)
async def start_single_processor(
    processor_name: str,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    force: bool = False,
):
    """Run one processor by name.

    force=false (default) – only processes media not yet handled by this processor.
    force=true – resets existing results and reprocesses all media.
    """
    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="run_processor",
        callable_task=lambda task_id: run_single_processor(
            task_id, processor_name, force=force
        ),
    )


class RunProcessorsForMediaRequest(BaseModel):
    media_ids: list[int]
    processor_names: list[str]


@router.post(
    "/run_processors_for_media",
    response_model=ProcessingTask,
    summary="Run selected processors on a specific set of media items",
)
async def start_processors_for_media(
    body: RunProcessorsForMediaRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """Run one or more processors over a specific list of media IDs.

    Always resets and reprocesses the given items regardless of their current state.
    """
    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="run_processor_for_media",
        callable_task=lambda task_id: run_processors_for_media(
            task_id, body.processor_names, body.media_ids
        ),
    )


@router.post("/reset/processing", summary="Resets media processing status")
def reset_processing(session: Session = Depends(get_session)):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    return reset_processing_task(session)


@router.post("/reset/clustering", summary="Resets person clustering")
def reset_clustering(session: Session = Depends(get_session)):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    return reset_clustering_task(session)


@router.post("/{task_id}/cancel", summary="Cancel a running task")
def cancel_task(
    task_id: str,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    task = session.get(ProcessingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel task in status {task.status}",
        )
    task.status = "cancelled"
    task.finished_at = datetime.now(timezone.utc)
    session.add(task)
    safe_commit(session)
    return task


@router.get("/", response_model=list[ProcessingTask], summary="List all tasks")
def list_tasks(session: Session = Depends(get_session)):
    return session.exec(select(ProcessingTask)).all()


@router.get(
    "/active",
    response_model=list[ProcessingTaskRead],
    summary="List all active tasks with transient details",
)
def list_active_tasks(session: Session = Depends(get_session)):
    try:
        active = session.exec(
            select(ProcessingTask).where(ProcessingTask.status == "running")
        ).all()
        progress_map = task_state.get_task_progress()
        result: list[ProcessingTaskRead] = []
        for task in active:
            base = task.model_dump()
            base.update(progress_map.get(task.id, {}))
            base["failure_count"] = task_state.get_failure_count(task.id)
            result.append(ProcessingTaskRead(**base))
        return result
    except OperationalError:
        # database might be contended; retry briefly
        time.sleep(0.5)
        return list_active_tasks(session)


@router.get(
    "/{task_id}/failures",
    response_model=list[task_state.TaskFailure],
    summary="List captured errors for a task",
)
def get_task_failures_endpoint(task_id: str, session: Session = Depends(get_session)):
    task = session.get(ProcessingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_state.get_task_failures(task_id)


@router.get(
    "/{task_id}",
    response_model=ProcessingTaskRead,
    summary="Get task status",
)
def get_task(task_id: str, session: Session = Depends(get_session)):
    task = session.get(ProcessingTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    base = task.model_dump()
    base.update(task_state.get_task_progress().get(task_id, {}))
    base["failure_count"] = task_state.get_failure_count(task_id)
    return ProcessingTaskRead(**base)
