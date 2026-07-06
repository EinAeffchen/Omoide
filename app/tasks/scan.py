from __future__ import annotations

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
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
from app.utils import generate_thumbnail, process_file, save_thumbnail_image
from .state import clear_task_progress, record_task_failure, set_task_progress

__all__ = ["run_scan"]

# Per-file work (metadata probes, image decodes, ffmpeg subprocesses) releases
# the GIL, so a small thread pool scales well; DB writes stay single-threaded.
_PROCESS_WORKERS = max(2, min(8, os.cpu_count() or 4))
_PROCESS_BATCH_SIZE = _PROCESS_WORKERS * 4

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
    media_dirs = [base for base, _ in settings.general.resolved_media_dirs()]
    allowed_suffixes = frozenset(
        settings.scan.VIDEO_SUFFIXES + settings.scan.IMAGE_SUFFIXES
    )

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
                    suffix = os.path.splitext(fname)[1].lower()
                    if suffix not in allowed_suffixes:
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

    def process_candidate(filepath: Path):
        logger.debug("Parsing: %s", filepath)
        set_task_progress(
            task_id,
            current_item=os.fspath(filepath),
            current_step="processing",
        )
        return process_file(filepath)

    def create_thumbnail(item) -> tuple[str | None, str | None]:
        media_obj, thumb_img = item
        try:
            if thumb_img is not None:
                thumb, thumb_error = save_thumbnail_image(media_obj, thumb_img)
                thumb_img.close()
                if thumb:
                    return thumb, thumb_error
            # Videos, plus images whose in-memory thumbnail failed: use the
            # full pipeline (ffmpeg / re-decode with HEIC fallbacks).
            return generate_thumbnail(media_obj)
        except Exception as exc:  # pragma: no cover - defensive safeguard
            logger.exception(
                "Unexpected error thumbnailing %s: %s", media_obj.path, exc
            )
            return None, f"Unexpected error generating thumbnail: {exc}"

    with heavy_writer(name="scan", cancelled=is_cancelled):
        with Session(db.engine) as sess:
            task = sess.get(ProcessingTask, task_id)
            processed = task.processed or 0
            check_every_sec = 5
            next_cancel_check = time.monotonic() + check_every_sec

            set_task_progress(
                task_id, current_step="processing", current_item=None
            )

            with ThreadPoolExecutor(max_workers=_PROCESS_WORKERS) as pool:
                for start in range(0, len(new_files), _PROCESS_BATCH_SIZE):
                    if time.monotonic() >= next_cancel_check:
                        next_cancel_check = time.monotonic() + check_every_sec
                        sess.refresh(task, attribute_names=["status"])
                        if task.status == "cancelled":
                            logger.info("Scan cancelled by user.")
                            break

                    batch = new_files[start : start + _PROCESS_BATCH_SIZE]

                    # Metadata, phash and thumbnail decoding run in parallel;
                    # all DB access stays on this thread.
                    results = list(pool.map(process_candidate, batch))

                    pending = []
                    for filepath, (media_obj, thumb_img, process_error) in zip(
                        batch, results
                    ):
                        if not media_obj:
                            reason = (
                                process_error
                                or "Failed to extract media metadata."
                            )
                            logger.warning(
                                "Skipping %s due to processing error: %s",
                                filepath,
                                reason,
                            )
                            record_task_failure(
                                task_id, os.fspath(filepath), reason
                            )
                            continue
                        try:
                            with sess.begin_nested():
                                sess.add(media_obj)
                        except IntegrityError:
                            if thumb_img is not None:
                                thumb_img.close()
                            continue
                        pending.append((media_obj, thumb_img))

                    # Thumbnails need the flushed media id; saving prepared
                    # images and running ffmpeg parallelize safely.
                    thumb_results = list(pool.map(create_thumbnail, pending))

                    for (media_obj, _), (thumb, thumb_error) in zip(
                        pending, thumb_results
                    ):
                        if not thumb:
                            reason = (
                                thumb_error or "Failed to generate thumbnail."
                            )
                            logger.warning(
                                "Thumbnail generation failed for %s: %s",
                                media_obj.path,
                                reason,
                            )
                            record_task_failure(
                                task_id, media_obj.path, reason
                            )
                            media_obj.processing_error = reason
                            sess.add(media_obj)
                            continue
                        media_obj.thumbnail_path = thumb
                        sess.add(media_obj)
                        processed += 1

                    task.processed = processed
                    sess.add(task)
                    safe_commit(sess)

            sess.refresh(task)
            task.status = (
                "completed" if task.status != "cancelled" else "cancelled"
            )
            task.finished_at = datetime.now(timezone.utc)
            task.processed = processed
            sess.add(task)
            safe_commit(sess)
            set_task_progress(task_id, current_step="finalizing", current_item=None)

    clear_task_progress(task_id)
