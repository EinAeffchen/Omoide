import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import ffmpeg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlmodel import Session

import app.database as db
from app.accelerators import get_ffmpeg_accel_config
from app.config import settings
from app.database import get_session
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.models import Media, ProcessingTask
from app.processor_registry import load_processors
from app.subprocess_helpers import popen_silent
from app.tasks.state import set_task_progress

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
    except PermissionError as exc:
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
        progress_path = media_path_obj.with_name(
            f"{media_path_obj.stem}_{task_id}.progress"
        )

        try:
            settings.general.ensure_media_path_writable(media_path_obj)
        except PermissionError as exc:
            logger.warning("Conversion blocked: %s", exc)
            task.status = "failed"
            task.error = str(exc)
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            session.commit()
            return

        try:
            ffmpeg_bin = ensure_ffmpeg_available()
            if not ffmpeg_bin:
                raise RuntimeError(
                    "ffmpeg is required to convert videos but could not be located."
                )
            ffprobe_name = (
                "ffprobe.exe" if sys.platform.startswith("win") else "ffprobe"
            )
            ffprobe_path = ffmpeg_bin.with_name(ffprobe_name)
            ffprobe_cmd = str(ffprobe_path) if ffprobe_path.exists() else "ffprobe"

            info = ffmpeg.probe(str(media_path_obj), cmd=ffprobe_cmd)
            try:
                dur_s = float(info.get("format", {}).get("duration") or 0.0)
            except Exception:
                dur_s = 0.0
            dur_us = dur_s * 1000000
            accel = get_ffmpeg_accel_config(settings.processors.prefer_gpu)
            video_encoder = accel.video_encoder or "libx264"
            # run ffmpeg with stderr piped so we can parse “progress=…”
            # Here’s one way using the “-progress” flag:
            cmd = [
                str(ffmpeg_bin),
                *accel.hwaccel_args,
                "-i",
                str(media_path_obj),
                "-c:v",
                video_encoder,
                "-filter:v",
                "fps=30",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "use_metadata_tags+faststart",
                "-progress",
                str(progress_path),
                "-nostats",
                "-y",
                str(temp_output_path),
            ]
            logger.info(f"Running FFmpeg command: {' '.join(cmd)}")
            if progress_path.exists():
                progress_path.unlink()

            proc = popen_silent(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )

            def _parse_out_time(value: str) -> int | None:
                raw = value.strip()
                if not raw or raw.upper() == "N/A":
                    return None
                if raw.isnumeric():
                    return int(raw)
                parts = raw.split(":")
                if len(parts) != 3:
                    return None
                try:
                    hours = int(parts[0])
                    minutes = int(parts[1])
                    seconds = float(parts[2])
                except Exception:
                    return None
                return int((hours * 3600 + minutes * 60 + seconds) * 1_000_000)

            def _read_progress() -> tuple[int | None, bool]:
                try:
                    content = progress_path.read_text(errors="ignore")
                except FileNotFoundError:
                    return None, False
                except OSError:
                    return None, False
                out_candidates: list[int] = []
                progress_end = False
                for line in content.splitlines():
                    if line.startswith(("out_time_us=", "out_time_ms=")):
                        value = line.split("=", 1)[1].strip()
                        parsed = _parse_out_time(value)
                        if parsed is not None:
                            out_candidates.append(parsed)
                    elif line.startswith("out_time="):
                        value = line.split("=", 1)[1].strip()
                        parsed = _parse_out_time(value)
                        if parsed is not None:
                            out_candidates.append(parsed)
                    elif line.startswith("progress="):
                        if line.split("=", 1)[1].strip() == "end":
                            progress_end = True
                out_us = max(out_candidates) if out_candidates else None
                return out_us, progress_end

            try:
                while True:
                    out_us, progress_end = _read_progress()
                    if out_us is not None and dur_us > 0:
                        pct = min(99, int(out_us / dur_us * 100))
                        if pct > task.processed:
                            task.processed = pct
                            session.add(task)
                            session.commit()
                        set_task_progress(
                            task_id,
                            current_step="converting video",
                            current_item=f"Progress: {pct}%",
                        )
                    if proc.poll() is not None:
                        break
                    if progress_end and task.processed < 99:
                        task.processed = 99
                        session.add(task)
                        session.commit()
                    time.sleep(0.5)
                stdout, stderr = proc.communicate()
            finally:
                if progress_path.exists():
                    progress_path.unlink()
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
