from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.database import get_session
from app.models import Blacklist, Media
from app.schemas.lowresolution import LowResMediaItem, LowResPage, LowResResolveRequest
from app.utils import delete_file, delete_record

router = APIRouter()

_DEFAULT_MAX_PIXELS = 1_000_000  # 1 MP


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
    base_filter = and_(
        Media.width.isnot(None),
        Media.height.isnot(None),
        pixel_count < max_pixels,
    )

    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))

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
    if not request.media_ids:
        raise HTTPException(status_code=400, detail="No media IDs provided.")

    media_list = session.exec(
        select(Media).where(Media.id.in_(request.media_ids))
    ).all()

    if not media_list:
        raise HTTPException(status_code=404, detail="No matching media found.")

    for media in media_list:
        if request.action == "DELETE_FILES":
            delete_file(session, media.id)
        elif request.action == "DELETE_RECORDS":
            delete_record(media.id, session)
        elif request.action == "BLACKLIST_RECORDS":
            session.add(Blacklist(path=media.path))
            delete_record(media.id, session)
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {request.action}")

    session.commit()
    return {"removed": len(media_list)}
