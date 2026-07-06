from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlmodel import Session, select

from app.database import get_session
from app.logger import logger
from app.models import Event, EventMediaLink, Media
from app.schemas.media import CursorPage

router = APIRouter()


class EventRead(BaseModel):
    id: int
    title: str | None
    start_at: datetime
    end_at: datetime
    media_count: int
    cover_thumbnail: str | None


def _event_read(session: Session, event: Event) -> EventRead:
    cover_thumbnail = None
    if event.cover_media_id:
        cover = session.get(Media, event.cover_media_id)
        if cover:
            cover_thumbnail = cover.thumbnail_path
    if cover_thumbnail is None:
        cover_thumbnail = session.exec(
            select(Media.thumbnail_path)
            .join(EventMediaLink, EventMediaLink.media_id == Media.id)
            .where(
                EventMediaLink.event_id == event.id,
                Media.thumbnail_path.is_not(None),
            )
            .limit(1)
        ).first()
    return EventRead(
        id=event.id,
        title=event.title,
        start_at=event.start_at,
        end_at=event.end_at,
        media_count=event.media_count,
        cover_thumbnail=cover_thumbnail,
    )


class EventPage(BaseModel):
    items: list[EventRead]
    next_cursor: str | None


@router.get("", response_model=EventPage)
def list_events(
    cursor: str | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
    session: Session = Depends(get_session),
):
    q = select(Event).order_by(Event.start_at.desc(), Event.id.desc())
    if cursor:
        try:
            val_str, id_str = cursor.split("_", 1)
            prev_val = datetime.fromisoformat(val_str)
            prev_id = int(id_str)
        except ValueError:
            logger.warning("Invalid event cursor: %s", cursor)
        else:
            q = q.where(
                or_(
                    Event.start_at < prev_val,
                    and_(Event.start_at == prev_val, Event.id < prev_id),
                )
            )
    events = session.exec(q.limit(limit)).all()
    next_cursor = None
    if len(events) == limit:
        last = events[-1]
        next_cursor = f"{last.start_at.isoformat()}_{last.id}"
    return EventPage(
        items=[_event_read(session, e) for e in events],
        next_cursor=next_cursor,
    )


@router.get("/{event_id}", response_model=EventRead)
def get_event(event_id: int, session: Session = Depends(get_session)):
    event = session.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return _event_read(session, event)


@router.get("/{event_id}/media", response_model=CursorPage)
def list_event_media(
    event_id: int,
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    if not session.get(Event, event_id):
        raise HTTPException(404, "Event not found")
    q = (
        select(Media)
        .join(EventMediaLink, EventMediaLink.media_id == Media.id)
        .where(
            EventMediaLink.event_id == event_id,
            Media.processing_error.is_(None),
        )
        .order_by(Media.created_at.desc(), Media.id.desc())
    )
    if cursor:
        try:
            val_str, id_str = cursor.split("_", 1)
            prev_val = datetime.fromisoformat(val_str)
            prev_id = int(id_str)
        except ValueError:
            logger.warning("Invalid event media cursor: %s", cursor)
        else:
            q = q.where(
                or_(
                    Media.created_at < prev_val,
                    and_(Media.created_at == prev_val, Media.id < prev_id),
                )
            )
    results = session.exec(q.limit(limit)).all()
    next_cursor = None
    if len(results) == limit:
        last = results[-1]
        next_cursor = f"{last.created_at.isoformat()}_{last.id}"
    return CursorPage(items=results, next_cursor=next_cursor)
