from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import delete, func, text, update
from sqlmodel import Session, select

import app.database as db
from app.records import delete_record
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import (
    Face,
    Media,
    Person,
    PersonRelationship,
    PersonTagLink,
    ProcessingTask,
    TimelineEvent,
)

__all__ = [
    "clean_missing_files",
    "reset_clustering",
    "reset_processing",
]


def reset_processing(session: Session) -> str:
    with heavy_writer(name="reset_processing"):
        face_rows = list(session.exec(select(Face.id, Face.thumbnail_path)))

        session.exec(update(Media).values(faces_extracted=False))
        session.exec(update(Media).values(embeddings_created=False))
        session.exec(update(Face).values(person_id=None))

        session.exec(delete(PersonTagLink))
        session.exec(delete(TimelineEvent))
        session.exec(delete(PersonRelationship))
        session.exec(delete(Person))

        session.exec(text("DELETE FROM face_embeddings"))
        session.exec(text("DELETE FROM media_embeddings"))
        session.exec(delete(Face))
        safe_commit(session)

        for _, thumb_path in face_rows:
            if not thumb_path:
                continue
            try:
                path_obj = Path(thumb_path)
            except Exception:
                continue
            if path_obj.exists():
                try:
                    path_obj.unlink()
                except Exception:
                    logger.debug(
                        "Failed to remove face thumbnail %s", path_obj
                    )
    return "OK"


def reset_clustering(session: Session) -> str:
    with heavy_writer(name="reset_clustering"):
        session.exec(
            update(Face).values(person_id=None).where(Face.person_id != None)
        )
        session.exec(text("UPDATE face_embeddings SET person_id=-1"))
        session.exec(text("DELETE FROM person_embeddings"))
        session.exec(delete(TimelineEvent))
        session.exec(delete(PersonTagLink))
        session.exec(delete(PersonRelationship))
        session.exec(delete(Person))
        safe_commit(session)
    return "OK"


def clean_missing_files(task_id: str) -> None:
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found", task_id)
            return

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        task.total = session.exec(select(func.count(Media.id))).first()
        session.commit()

        processed = 0
        flagged = 0
        recovered = 0
        auto_deleted = 0
        batch_size = 200
        last_id = 0

        def is_cancelled() -> bool:
            try:
                session.refresh(task, attribute_names=["status"])
                return task.status == "cancelled"
            except Exception:
                return False

        grace_hours = max(0, settings.scan.auto_cleanup_grace_hours)
        grace_delta = timedelta(hours=grace_hours)
        auto_cleanup_enabled = settings.scan.auto_cleanup_without_review

        with heavy_writer(name="clean_missing_files", cancelled=is_cancelled):
            while True:
                media_batch = session.exec(
                    select(Media)
                    .where(Media.id > last_id)
                    .order_by(Media.id)
                    .limit(batch_size)
                ).all()

                if not media_batch:
                    break

                for media in media_batch:
                    last_id = media.id
                    processed += 1
                    media_path = Path(media.path)
                    current_time = datetime.now(timezone.utc)

                    if not media_path.exists():
                        if media.missing_since is None:
                            media.missing_since = current_time
                        if auto_cleanup_enabled:
                            cutoff = current_time - grace_delta
                            if grace_delta == timedelta(0) or (
                                media.missing_since
                                and media.missing_since <= cutoff
                            ):
                                delete_record(media.id, session)
                                auto_deleted += 1
                                continue
                        media.missing_confirmed = False
                        session.add(media)
                        flagged += 1
                    else:
                        if (
                            media.missing_since is not None
                            or media.missing_confirmed
                        ):
                            media.missing_since = None
                            media.missing_confirmed = False
                            session.add(media)
                            recovered += 1

                task.processed = processed
                session.commit()

        task.status = "completed"
        task.finished_at = datetime.now(timezone.utc)
        session.commit()
        logger.info(
            "Missing files cleanup processed=%d flagged=%d recovered=%d auto_deleted=%d",
            processed,
            flagged,
            recovered,
            auto_deleted,
        )
