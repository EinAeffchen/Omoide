from __future__ import annotations

import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy import union_all
from sqlmodel import Session, select

import app.database as db
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Face, Media, PersonMediaLink, ProcessingTask

from .state import clear_task_progress, record_task_failure, set_task_progress

__all__ = ["run_person_media_export"]

ExportMode = Literal["copy", "move"]


def _resolve_media_source(path_value: str) -> Path | None:
    """Resolve a stored media path against the configured media directories."""
    raw_path = Path(path_value).expanduser()
    candidates = [raw_path] if raw_path.is_absolute() else []
    candidates.extend(
        media_dir / raw_path
        for media_dir, _read_only in settings.general.resolved_media_dirs()
    )
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=False)
        except (OSError, RuntimeError):
            continue
        if resolved.is_file():
            return resolved
    return None


def _available_destination(destination_dir: Path, filename: str) -> Path:
    """Return a non-existing destination path without overwriting a file."""
    requested = Path(filename)
    candidate = destination_dir / requested.name
    if not candidate.exists():
        return candidate

    stem = requested.stem or "media"
    suffix = requested.suffix
    index = 1
    while True:
        candidate = destination_dir / f"{stem} ({index}){suffix}"
        if not candidate.exists():
            return candidate
        index += 1


def _person_media_ids(person_id: int):
    media_ids = union_all(
        select(Face.media_id.label("media_id")).where(Face.person_id == person_id),
        select(PersonMediaLink.media_id.label("media_id")).where(
            PersonMediaLink.person_id == person_id
        ),
    ).subquery()
    return select(media_ids.c.media_id).distinct()


def _export_one(
    session: Session, media: Media, destination_dir: Path, mode: ExportMode
) -> str | None:
    """Copy or move one original. Returns a skip reason, or None on success."""
    source_path = _resolve_media_source(media.path)
    if source_path is None:
        return "File not found"
    if source_path.parent == destination_dir:
        return "File is already in the selected folder"
    if mode == "move":
        try:
            settings.general.ensure_media_path_writable(source_path)
        except PermissionError as exc:
            return str(exc)

    target_path = _available_destination(destination_dir, media.filename)
    if mode == "copy":
        shutil.copy2(source_path, target_path)
        return None

    shutil.move(str(source_path), str(target_path))
    old_path, old_filename = media.path, media.filename
    media.path = str(target_path)
    media.filename = target_path.name
    session.add(media)
    try:
        safe_commit(session)
    except Exception:
        # Keep the database and filesystem in sync if persisting the new
        # path fails after the file has been moved.
        try:
            shutil.move(str(target_path), str(source_path))
        except Exception as rollback_exc:
            logger.error(
                "Failed to roll back moved media %s: %s", target_path, rollback_exc
            )
        media.path, media.filename = old_path, old_filename
        raise
    return None


def run_person_media_export(
    task_id: str, person_id: int, destination_dir: Path, mode: ExportMode
) -> None:
    """Copy or move each unique original containing the person."""
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return
        media_items = session.exec(
            select(Media)
            .where(Media.id.in_(_person_media_ids(person_id)))
            .order_by(Media.id)
        ).all()
        task.status = "running"
        task.started_at = datetime.now(UTC)
        task.total = len(media_items)
        task.processed = 0
        session.add(task)
        safe_commit(session)

        for media in media_items:
            session.refresh(task)
            if task.status == "cancelled":
                logger.info("Person media export %s cancelled.", task_id)
                break
            set_task_progress(
                task_id, current_step=mode, current_item=media.filename
            )
            try:
                reason = _export_one(session, media, destination_dir, mode)
            except Exception as exc:
                logger.warning(
                    "Failed to %s media %s for person %s: %s",
                    mode,
                    media.path,
                    person_id,
                    exc,
                )
                reason = str(exc)
            if reason:
                record_task_failure(task_id, media.filename, reason)
            task.processed += 1
            session.add(task)
            safe_commit(session)

        session.refresh(task)
        if task.status != "cancelled":
            task.status = "completed"
        task.finished_at = datetime.now(UTC)
        session.add(task)
        safe_commit(session)
    clear_task_progress(task_id)
