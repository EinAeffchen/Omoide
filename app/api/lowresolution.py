from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.api._resolve import resolve_media_action
from app.database import get_session
from app.models import Media
from app.schemas.lowresolution import LowResMediaItem, LowResPage, LowResResolveRequest

router = APIRouter()

_DEFAULT_MAX_PIXELS = 1_000_000  # 1 MP


def _base_filter(max_pixels: int, media_type: str | None):
    pixel_count = Media.width * Media.height
    base_filter = and_(
        Media.width.isnot(None),
        Media.height.isnot(None),
        pixel_count < max_pixels,
    )

    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))
    return base_filter


@router.get("", response_model=LowResPage)
def get_low_res_media(
    session: Session = Depends(get_session),
    max_pixels: int = Query(_DEFAULT_MAX_PIXELS, ge=1),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    media_type: str | None = Query(None, description="'image', 'video', or omit for all"),
):
    """Paginated list of media whose pixel count (width × height) is below max_pixels, ordered lowest-first."""
    pixel_count = Media.width * Media.height
    base_filter = _base_filter(max_pixels, media_type)

    total = session.exec(select(func.count(Media.id)).where(base_filter)).first() or 0

    query = select(Media).where(base_filter).order_by(pixel_count.asc(), Media.id.asc())

    if cursor:
        try:
            px_str, id_str = cursor.split("_", 1)
            cursor_px = int(px_str)
            cursor_id = int(id_str)
            query = query.where(
                or_(
                    pixel_count > cursor_px,
                    and_(pixel_count == cursor_px, Media.id > cursor_id),
                )
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor format.")

    rows = session.exec(query.limit(limit)).all()

    items = [
        LowResMediaItem(
            id=m.id,
            filename=m.filename,
            path=m.path,
            size=m.size or 0,
            thumbnail_path=m.thumbnail_path,
            width=m.width,
            height=m.height,
            pixel_count=m.width * m.height,
            duration=m.duration,
            inserted_at=m.inserted_at,
        )
        for m in rows
    ]

    next_cursor = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = f"{last.width * last.height}_{last.id}"

    return LowResPage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_low_res(
    request: LowResResolveRequest,
    session: Session = Depends(get_session),
):
    removed = resolve_media_action(
        session,
        action=request.action,
        media_ids=request.media_ids,
        select_all=request.select_all,
        base_filter=_base_filter(request.max_pixels, request.media_type),
    )
    return {"removed": removed}
