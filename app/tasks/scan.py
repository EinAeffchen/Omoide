from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

import app.database as db
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, ProcessingTask
from app.utils import generate_thumbnail, process_file
from .state import clear_task_progress, record_task_failure, set_task_progress

__all__ = ["run_scan"]

THUMBNAIL_DIR_NAMES = {
    ".thumbs",
    ".thumbnails",
    "thumb",
    "thumbs",
    "thumbnail",
    "thumbnails",
}
THUMBNAIL_NAME_TOKENS = {"thumb", "thumbs", "thumbnail", "thumbnails"}


def _looks_like_thumbnail(path: Path) -> bool:
    try:
        parts = [part.lower() for part in path.parts]
    except Exception:
        parts = [os.fspath(path).lower()]
    for part in parts[:-1]:
        if part in THUMBNAIL_DIR_NAMES:
            return True

    name = path.stem.lower()
    if not name:
        return False
    tokens = [t for t in re.split(r"[^a-z0-9]+", name) if t]
    if any(token in THUMBNAIL_NAME_TOKENS for token in tokens):
        return True

    def has_affix(value: str, affix: str, is_prefix: bool) -> bool:
        if is_prefix:
            if not value.startswith(affix):
                return False
            if len(value) == len(affix):
                return True
            return not value[len(affix)].isalpha()
        if not value.endswith(affix):
            return False
        if len(value) == len(affix):
            return True
        return not value[-len(affix) - 1].isalpha()

    for affix in ("thumb", "thumbnail"):
        if has_affix(name, affix, True) or has_affix(name, affix, False):
            return True

    return False


def _scan_path_key(value: str | Path) -> str:
    try:
        return os.path.normcase(os.path.abspath(os.fspath(value)))
    except Exception:
        return os.fspath(value)


def run_scan(task_id: str) -> None:
    discovery_update_batch = 200
    discovery_update_interval = 2.0
    progress_batch_threshold = 50
    progress_update_interval = 2.0
    media_dirs = [base for base, _ in settings.general.resolved_media_dirs()]

    with Session(db.engine) as sess:
        task = sess.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return
        task.status = "running"
        task.processed = 0
        task.started_at = datetime.now(timezone.utc)
        safe_commit(sess)
        set_task_progress(task_id, current_step="indexing", current_item=None)

    def walk_candidates():
        def on_walk_error(err: OSError) -> None:
            logger.warning(
                "Scan walk error in %s: %s", err.filename or "unknown", err
            )

        for media_dir in media_dirs:
            for root, dirs, files in os.walk(
                media_dir,
                topdown=True,
                followlinks=True,
                onerror=on_walk_error,
            ):
                if ".omoide" in dirs:
                    dirs.remove(".omoide")
                for fname in files:
                    suffix = Path(fname).suffix.lower()
                    if (
                        suffix
                        not in settings.scan.VIDEO_SUFFIXES
                        + settings.scan.IMAGE_SUFFIXES
                    ):
                        continue
                    try:
                        candidate = Path(root) / fname
                    except Exception as exc:
                        logger.warning(
                            "Skipping %s in %s due to path error: %s",
                            fname,
                            root,
                            exc,
                        )
                        continue
                    if (
                        settings.scan.skip_thumbnails_on_scan
                        and _looks_like_thumbnail(candidate)
                    ):
                        continue
                    yield candidate

    new_files: list[Path] = []
    existing_paths: set[str] = set()
    missing_candidates: dict[str, int] = {}

    with Session(db.engine) as sess:
        try:
            for d in media_dirs:
                try:
                    prefix = os.fspath(Path(d).resolve())
                except Exception:
                    prefix = os.fspath(Path(d))
                lo = prefix
                hi = prefix + "\uffff"
                try:
                    rows = sess.exec(
                        select(
                            Media.id,
                            Media.path,
                            Media.missing_since,
                            Media.missing_confirmed,
                        ).where(Media.path >= lo, Media.path < hi)
                    ).all()
                    for media_id, p, missing_since, missing_confirmed in rows:
                        path_key = _scan_path_key(p)
                        existing_paths.add(path_key)
                        if missing_since is not None or missing_confirmed:
                            missing_candidates[path_key] = media_id
                except Exception:
                    pass
        except Exception:
            pass

        task = sess.get(ProcessingTask, task_id)
        since_update = 0
        next_total_update = time.monotonic() + discovery_update_interval
        recovered_ids: set[int] = set()
        for path in walk_candidates():
            spath = os.fspath(path)
            path_key = _scan_path_key(spath)
            candidate_id = missing_candidates.pop(path_key, None)
            if candidate_id is not None:
                recovered_ids.add(candidate_id)
            if path_key in existing_paths:
                continue
            new_files.append(path)
            existing_paths.add(path_key)
            since_update += 1
            if (
                since_update >= discovery_update_batch
                or time.monotonic() >= next_total_update
            ):
                task.total = len(new_files)
                sess.add(task)
                safe_commit(sess)
                since_update = 0
                next_total_update = time.monotonic() + discovery_update_interval
        if recovered_ids:
            sess.exec(
                update(Media)
                .where(Media.id.in_(tuple(recovered_ids)))
                .values(missing_since=None, missing_confirmed=False)
            )

        task.total = len(new_files)
        logger.info("Found %s new files!", len(new_files))
        sess.add(task)
        safe_commit(sess)

    if not new_files:
        with Session(db.engine) as sess:
            task = sess.get(ProcessingTask, task_id)
            task.status = "completed"
            task.finished_at = datetime.now(timezone.utc)
            safe_commit(sess)
        clear_task_progress(task_id)
        logger.info("No new files to process. Scan finished.")
        return

    def is_cancelled() -> bool:
        with Session(db.engine) as s:
            t = s.get(ProcessingTask, task_id)
            return bool(t and t.status == "cancelled")

    with heavy_writer(name="scan", cancelled=is_cancelled):
        with Session(db.engine) as sess:
            task = sess.get(ProcessingTask, task_id)
            processed = task.processed or 0
            batch_since_commit = 0
            check_every_sec = 5
            next_cancel_check = time.monotonic() + check_every_sec
            next_progress_update = time.monotonic() + progress_update_interval

            set_task_progress(
                task_id, current_step="processing", current_item=None
            )

            for filepath in new_files:
                logger.debug("Parsing: %s", filepath)
                set_task_progress(
                    task_id,
                    current_item=os.fspath(filepath),
                    current_step="processing",
                )
                if time.monotonic() >= next_cancel_check:
                    next_cancel_check = time.monotonic() + check_every_sec
                    sess.refresh(task, attribute_names=["status"])
                    if task.status == "cancelled":
                        logger.info("Scan cancelled by user.")
                        if batch_since_commit > 0:
                            task.processed = processed
                            sess.add(task)
                            safe_commit(sess)
                            batch_since_commit = 0
                            next_progress_update = (
                                time.monotonic() + progress_update_interval
                            )
                        break

                media_obj, process_error = process_file(filepath)
                if not media_obj:
                    reason = (
                        process_error or "Failed to extract media metadata."
                    )
                    logger.warning(
                        "Skipping %s due to processing error: %s",
                        filepath,
                        reason,
                    )
                    record_task_failure(task_id, os.fspath(filepath), reason)
                    continue

                sess.add(media_obj)
                try:
                    sess.flush()
                except IntegrityError:
                    sess.rollback()
                    continue

                thumb, thumb_error = generate_thumbnail(media_obj)
                if not thumb:
                    reason = thumb_error or "Failed to generate thumbnail."
                    logger.warning(
                        "Thumbnail generation failed for %s: %s",
                        filepath,
                        reason,
                    )
                    record_task_failure(task_id, os.fspath(filepath), reason)
                    try:
                        sess.delete(media_obj)
                    except Exception:
                        pass
                    safe_commit(sess)
                    continue

                media_obj.thumbnail_path = thumb
                sess.add(media_obj)

                processed += 1
                batch_since_commit += 1
                if (
                    batch_since_commit >= progress_batch_threshold
                    or time.monotonic() >= next_progress_update
                ):
                    task.processed = processed
                    sess.add(task)
                    safe_commit(sess)
                    batch_since_commit = 0
                    next_progress_update = (
                        time.monotonic() + progress_update_interval
                    )

            sess.refresh(task)
            task.status = (
                "completed" if task.status != "cancelled" else "cancelled"
            )
            task.finished_at = datetime.now(timezone.utc)
            sess.add(task)
            if batch_since_commit > 0:
                task.processed = processed
            safe_commit(sess)
            set_task_progress(task_id, current_step="finalizing", current_item=None)

    clear_task_progress(task_id)
