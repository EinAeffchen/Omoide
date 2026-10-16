from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_
from sqlmodel import Session, select

from app.api._resolve import resolve_media_action
from app.database import get_session
from app.models import ExifData, Media
from app.pagination import count_rows, paginate
from app.schemas.noexifdate import NoExifDateItem, NoExifDatePage, NoExifDateResolveRequest

router = APIRouter()


def _base_filter(media_type: str | None):
    has_exif_date = select(ExifData.media_id).where(ExifData.timestamp.isnot(None))
    base_filter = Media.id.not_in(has_exif_date)

    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))
    return base_filter


@router.get("", response_model=NoExifDatePage)
def get_no_exif_date_media(
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    media_type: str | None = Query(None, description="'image', 'video', or omit for all"),
):
    """Paginated list of media with no EXIF capture timestamp, ordered newest-first."""
    base_filter = _base_filter(media_type)

    total = count_rows(session, Media.id, base_filter)
    rows, next_cursor = paginate(
        session,
        select(Media).where(base_filter),
        [(Media.id, False)],
        cursor=cursor,
        limit=limit,
    )

    items = [
        NoExifDateItem(
            id=m.id,
            filename=m.filename,
            path=m.path,
            size=m.size or 0,
            thumbnail_path=m.thumbnail_path,
            width=m.width,
            height=m.height,
            duration=m.duration,
            inserted_at=m.inserted_at,
        )
        for m in rows
    ]

    return NoExifDatePage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_no_exif_date(
    request: NoExifDateResolveRequest,
    session: Session = Depends(get_session),
):
    removed = resolve_media_action(
        session,
        action=request.action,
        media_ids=request.media_ids,
        select_all=request.select_all,
        base_filter=_base_filter(request.media_type),
    )
    return {"removed": removed}
