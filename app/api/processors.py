from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.config import settings
from app.conversion import ConversionMode
from app.database import get_session
from app.models import Media, ProcessingTask
from app.processor_registry import load_processors
from app.tasks.common import create_and_run_task
from app.tasks.conversion import run_convert_media

router = APIRouter()


@router.get(
    "/media/{media_id}/processors/{processor_name}",
    summary="Get a processor’s output",
)
def get_processor(
    media_id: int,
    processor_name: str,
    session: Session = Depends(get_session),
):
    for p in load_processors():
        if p.name == processor_name:
            return p.get_results(media_id, session)
    raise HTTPException(404, f"Processor {processor_name} not found")


class ConversionRequest(BaseModel):
    # No default: the caller must choose whether the original is kept.
    mode: ConversionMode


@router.post(
    "/media/{media_id}/converter",
    response_model=ProcessingTask,
    summary="Convert a video into a browser-playable MP4",
)
def start_conversion(
    media_id: int,
    body: ConversionRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    if body.mode == "replace_original":
        try:
            settings.general.ensure_media_path_writable(Path(media.path))
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc))
    # create_and_run_task would hand back a running conversion of another
    # video, so refuse instead of silently reusing it.
    if session.exec(
        select(ProcessingTask.id).where(
            ProcessingTask.task_type == "convert_media",
            ProcessingTask.status == "running",
        )
    ).first():
        raise HTTPException(409, "Another video conversion is still running.")
    return create_and_run_task(
        session,
        background_tasks,
        "convert_media",
        callable_task=lambda task_id: run_convert_media(
            task_id, media.id, body.mode
        ),
    )
