from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.albums import AlbumRead, _album_read
from app.database import get_session, safe_commit
from app.logger import logger
from app.models import Album, AlbumMediaLink, Event, EventMediaLink, Media
from app.pagination import media_newest_first, paginate
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
                Media.missing_since.is_(None),
            )
            .order_by(Media.created_at.desc())
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
    events, next_cursor = paginate(
        session,
        select(Event),
        [(Event.start_at, False), (Event.id, False)],
        cursor=cursor,
        limit=limit,
    )
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


class EventUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


@router.patch("/{event_id}", response_model=EventRead)
def update_event(
    event_id: int,
    body: EventUpdate,
    session: Session = Depends(get_session),
):
    event = session.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    event.title = body.title.strip()
    event.title_is_custom = True
    session.add(event)
    safe_commit(session)
    session.refresh(event)
    return _event_read(session, event)


class EventToAlbumRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)


@router.post("/{event_id}/convert-to-album", response_model=AlbumRead)
def convert_event_to_album(
    event_id: int,
    body: EventToAlbumRequest,
    session: Session = Depends(get_session),
):
    """Move an event's media into a new album and remove the event."""
    event = session.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    name = (body.name or event.title or "").strip()
    if not name:
        name = f"{event.start_at.date()} – {event.end_at.date()}"

    album = Album(name=name, cover_media_id=event.cover_media_id)
    session.add(album)
    session.flush()

    media_ids = session.exec(
        select(EventMediaLink.media_id).where(
            EventMediaLink.event_id == event_id
        )
    ).all()
    for media_id in media_ids:
        session.add(AlbumMediaLink(album_id=album.id, media_id=media_id))
    for link in session.exec(
        select(EventMediaLink).where(EventMediaLink.event_id == event_id)
    ).all():
        session.delete(link)
    # Flush the link deletes before the event delete: SQLAlchemy only orders
    # cross-mapper deletes via a declared relationship(), which these models
    # don't have, so without this the event delete can be emitted first and
    # trip the foreign key constraint.
    session.flush()
    session.delete(event)

    safe_commit(session)
    session.refresh(album)
    logger.info(
        "Converted event %s to album %s (%s)", event_id, album.id, album.name
    )
    return _album_read(session, album)


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
            Media.missing_since.is_(None),
        )
    )
    results, next_cursor = paginate(
        session, q, media_newest_first(), cursor=cursor, limit=limit
    )
    return CursorPage(items=results, next_cursor=next_cursor)
