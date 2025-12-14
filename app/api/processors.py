import subprocess
from datetime import datetime, timezone
from pathlib import Path

import ffmpeg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session

import app.database as db
from app.config import ReadOnlyMediaError, settings
from app.database import get_session
from app.logger import logger
from app.models import Media, ProcessingTask
from app.processor_registry import load_processors
from app.subprocess_helpers import popen_silent

router = APIRouter()


@router.get("/media/{media_id}/processors", summary="List all processors")
def list_processors():
    return [p.name for p in load_processors()]


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


@router.post(
    "/media/{media_id}/converter",
    summary="Converts video to web compatible format",
)
def start_conversion(
    media_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    try:
        settings.general.ensure_media_path_writable(Path(media.path))
    except ReadOnlyMediaError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    task = ProcessingTask(
        task_type="convert",
        status="pending",
        total=100,  # we’ll treat this as a percentage 0–100
        processed=0,
        created_at=datetime.now(timezone.utc),
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    background_tasks.add_task(_run_conversion, task.id, str(media.path), media.id)
    return task


def _run_conversion(task_id: str, media_path: str, media_id: int):
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error(f"Task {task_id} not found.")
            return

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        session.add(task)
        session.commit()

        media_path_obj = Path(media_path)
        temp_output_path = media_path_obj.with_name(media_path_obj.stem + "_temp.mp4")

        try:
            settings.general.ensure_media_path_writable(media_path_obj)
        except ReadOnlyMediaError as exc:
            logger.warning("Conversion blocked: %s", exc)
            task.status = "failed"
            task.error = str(exc)
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            session.commit()
            return

        try:
            info = ffmpeg.probe(str(media_path_obj))
            dur_s = float(info["format"]["duration"])
            dur_us = dur_s * 1000000
            # run ffmpeg with stderr piped so we can parse “progress=…”
            # Here’s one way using the “-progress” flag:
            cmd = [
                "ffmpeg",
                "-i",
                str(media_path_obj),
                "-c:v",
                "libx264",
                "-filter:v",
                "fps=30",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "use_metadata_tags+faststart",
                "-progress",
                "pipe:1",  # emits key=value pairs on stdout
                "-nostats",
                "-y",
                str(temp_output_path),
            ]
            logger.info(f"Running FFmpeg command: {' '.join(cmd)}")
            proc = popen_silent(cmd, stdout=subprocess.PIPE, text=True)

            for line in proc.stdout:
                if line.startswith("out_time_ms="):
                    out_us: str = line.split("=")[1].strip()
                    if out_us.isnumeric():
                        out_us = int(out_us)
                        pct = min(100, int(out_us / dur_us * 100))
                        if pct > task.processed:
                            task.processed = pct
                            session.add(task)
                            session.commit()
                if line.startswith("progress=end"):
                    break

            stdout, stderr = proc.communicate()
            if proc.returncode != 0:
                logger.error(
                    f"FFmpeg failed for {media_path} with exit code {proc.returncode}"
                )
                logger.error(f"FFmpeg stderr: {stderr}")
                raise Exception(f"FFmpeg conversion failed: {stderr}")

            task.processed = 100
            task.status = "completed"
            task.finished_at = datetime.now(timezone.utc)

            media = session.get(Media, media_id)
            if media and temp_output_path.exists():
                media_path_obj.unlink()
                new_file = temp_output_path.rename(media_path_obj)
                media.path = str(new_file)
                media.filename = new_file.name
                session.add(media)
            session.add(task)
            session.commit()
        except Exception as e:
            logger.error(f"Conversion task {task_id} failed: {e}")
            task.status = "failed"
            task.error = str(e)
            session.add(task)
            session.commit()
            if temp_output_path.exists():
                temp_output_path.unlink()  # Clean up temp file on failure
