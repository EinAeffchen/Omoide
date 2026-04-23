from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlmodel import Session, select

from app.database import get_session
from app.models import Blacklist, ExifData, Media
from app.schemas.noexifdate import NoExifDateItem, NoExifDatePage, NoExifDateResolveRequest
from app.utils import delete_file, delete_record

router = APIRouter()


@router.get("", response_model=NoExifDatePage)
def get_no_exif_date_media(
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    media_type: str | None = Query(None, description="'image', 'video', or omit for all"),
):
    """Paginated list of media with no EXIF capture timestamp, ordered newest-first."""
    has_exif_date = select(ExifData.media_id).where(ExifData.timestamp.isnot(None))
    base_filter = Media.id.not_in(has_exif_date)

    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))

    total = session.exec(select(func.count(Media.id)).where(base_filter)).first() or 0

    query = select(Media).where(base_filter).order_by(Media.id.desc())

    if cursor:
        try:
            cursor_id = int(cursor)
            query = query.where(Media.id < cursor_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor format.")

    rows = session.exec(query.limit(limit)).all()

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

    next_cursor = None
    if len(rows) == limit:
        next_cursor = str(rows[-1].id)

    return NoExifDatePage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_no_exif_date(
    request: NoExifDateResolveRequest,
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
