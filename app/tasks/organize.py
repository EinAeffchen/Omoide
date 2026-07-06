from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlmodel import Session, func, select

import app.database as db
from app.concurrency import heavy_writer
from app.database import safe_commit
from app.logger import logger
from app.models import (
    Event,
    EventMediaLink,
    ExifData,
    Media,
    ProcessingTask,
)
from .state import clear_task_progress, set_task_progress

__all__ = ["run_build_events", "run_geocode_places"]

# A new event starts when consecutive media are further apart than this.
EVENT_GAP = timedelta(hours=6)
# Clusters smaller than this are noise, not an "event".
EVENT_MIN_MEDIA = 3
GEOCODE_BATCH = 500


def _get_task(session: Session, task_id: str) -> ProcessingTask | None:
    task = session.get(ProcessingTask, task_id)
    if not task:
        logger.error("Task %s not found.", task_id)
    return task


def _start_task(session: Session, task: ProcessingTask) -> None:
    task.status = "running"
    task.processed = 0
    task.started_at = datetime.now(timezone.utc)
    session.add(task)
    safe_commit(session)


def _finish_task(session: Session, task: ProcessingTask, status: str) -> None:
    session.refresh(task)
    task.status = status if task.status != "cancelled" else "cancelled"
    task.finished_at = datetime.now(timezone.utc)
    session.add(task)
    safe_commit(session)


def _is_cancelled(task_id: str) -> bool:
    with Session(db.engine) as s:
        t = s.get(ProcessingTask, task_id)
        return bool(t and t.status == "cancelled")


def _event_title(cities: Counter, countries: Counter) -> str | None:
    if cities:
        top = [city for city, _ in cities.most_common(2)]
        return " · ".join(top)
    if countries:
        return countries.most_common(1)[0][0]
    return None


def run_build_events(task_id: str) -> None:
    """Cluster the whole library into time-based events.

    Media are sorted by taken date; a gap larger than EVENT_GAP starts a new
    event. Existing events are rebuilt from scratch, so re-running after new
    scans or geocoding always produces a consistent result.
    """
    with heavy_writer(name="build_events", cancelled=lambda: _is_cancelled(task_id)):
        with Session(db.engine) as session:
            task = _get_task(session, task_id)
            if not task:
                return
            _start_task(session, task)
            set_task_progress(task_id, current_step="clustering", current_item=None)

            rows = session.exec(
                select(
                    Media.id,
                    Media.created_at,
                    ExifData.city,
                    ExifData.country,
                )
                .join(ExifData, ExifData.media_id == Media.id, isouter=True)
                .where(
                    Media.processing_error.is_(None),
                    Media.missing_since.is_(None),
                )
                .order_by(Media.created_at.asc(), Media.id.asc())
            ).all()

            task.total = len(rows)
            session.add(task)
            safe_commit(session)

            clusters: list[list[tuple]] = []
            current: list[tuple] = []
            prev_time: datetime | None = None
            for row in rows:
                taken = row[1]
                if prev_time is not None and taken - prev_time > EVENT_GAP:
                    clusters.append(current)
                    current = []
                current.append(row)
                prev_time = taken

            if current:
                clusters.append(current)

            # Rebuild from scratch.
            for link in session.exec(select(EventMediaLink)).all():
                session.delete(link)
            for event in session.exec(select(Event)).all():
                session.delete(event)
            session.flush()

            created = 0
            processed = 0
            for cluster in clusters:
                processed += len(cluster)
                if len(cluster) < EVENT_MIN_MEDIA:
                    continue
                if _is_cancelled(task_id):
                    logger.info("build_events cancelled.")
                    break
                cities = Counter(
                    row[2] for row in cluster if row[2] is not None
                )
                countries = Counter(
                    row[3] for row in cluster if row[3] is not None
                )
                event = Event(
                    title=_event_title(cities, countries),
                    start_at=cluster[0][1],
                    end_at=cluster[-1][1],
                    media_count=len(cluster),
                    cover_media_id=cluster[0][0],
                )
                session.add(event)
                session.flush()
                for row in cluster:
                    session.add(
                        EventMediaLink(event_id=event.id, media_id=row[0])
                    )
                created += 1
                task.processed = processed
                if created % 50 == 0:
                    session.add(task)
                    safe_commit(session)

            task.processed = processed
            session.add(task)
            safe_commit(session)
            logger.info(
                "build_events: %d events from %d media.", created, len(rows)
            )
            _finish_task(session, task, "completed")
    clear_task_progress(task_id)


def _fail_task(task_id: str, message: str) -> None:
    logger.error(message)
    with Session(db.engine) as session:
        task = _get_task(session, task_id)
        if task:
            task.status = "failed"
            task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            safe_commit(session)
    clear_task_progress(task_id)


def run_geocode_places(task_id: str) -> None:
    """Reverse-geocode media GPS coordinates into city/country (offline)."""
    try:
        import reverse_geocoder as rg
    except ImportError:
        _fail_task(
            task_id, "reverse_geocoder is not installed; cannot geocode places."
        )
        return

    # Fail fast if the offline dataset is missing (e.g. not bundled into a
    # frozen build). reverse_geocoder would otherwise silently try to download
    # it from geonames.org — no timeout, no log output — which looks like a
    # task that hangs forever.
    dataset = Path(rg.__file__).resolve().parent / "rg_cities1000.csv"
    if not dataset.exists():
        _fail_task(
            task_id,
            f"reverse_geocoder dataset missing at {dataset}; cannot geocode"
            " offline. (Binary builds must bundle it — see main.spec.)",
        )
        return

    with heavy_writer(
        name="geocode_places", cancelled=lambda: _is_cancelled(task_id)
    ):
        with Session(db.engine) as session:
            task = _get_task(session, task_id)
            if not task:
                return
            _start_task(session, task)
            set_task_progress(task_id, current_step="geocoding", current_item=None)

            pending_filter = (
                ExifData.lat.is_not(None),
                ExifData.lon.is_not(None),
                ExifData.city.is_(None),
            )
            pending_stmt = select(ExifData).where(*pending_filter)
            task.total = int(
                session.exec(
                    select(func.count()).select_from(ExifData).where(*pending_filter)
                ).one()
            )
            session.add(task)
            safe_commit(session)
            logger.info(
                "geocode_places: %d locations pending; loading dataset...",
                task.total,
            )

            processed = 0
            while True:
                if _is_cancelled(task_id):
                    logger.info("geocode_places cancelled.")
                    break
                batch = session.exec(pending_stmt.limit(GEOCODE_BATCH)).all()
                if not batch:
                    break
                coords = [(row.lat, row.lon) for row in batch]
                # mode=1: single-process K-D tree lookup (Windows-safe).
                # verbose=False: rg prints progress to stdout otherwise, which
                # is useless in windowed/frozen builds.
                results = rg.search(coords, mode=1, verbose=False)
                for row, place in zip(batch, results):
                    row.city = place.get("name") or "Unknown"
                    row.country = place.get("cc")
                    session.add(row)
                processed += len(batch)
                task.processed = processed
                session.add(task)
                safe_commit(session)
                set_task_progress(
                    task_id,
                    current_step="geocoding",
                    current_item=f"{processed}/{task.total} locations",
                )

            logger.info("geocode_places: geocoded %d locations.", processed)
            _finish_task(session, task, "completed")
    clear_task_progress(task_id)
