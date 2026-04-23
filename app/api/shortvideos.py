from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.database import get_session
from app.models import Blacklist, Media
from app.schemas.shortvideos import ShortVideoItem, ShortVideoPage, ShortVideoResolveRequest
from app.utils import delete_file, delete_record

router = APIRouter()

_DEFAULT_MAX_DURATION = 10.0


@router.get("", response_model=ShortVideoPage)
def get_short_videos(
    session: Session = Depends(get_session),
    max_duration: float = Query(_DEFAULT_MAX_DURATION, ge=0),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Paginated list of videos shorter than max_duration seconds, ordered shortest-first."""
    base_filter = and_(
        Media.duration.isnot(None),
        Media.duration >= 0,
        Media.duration < max_duration,
    )

    total = session.exec(select(func.count(Media.id)).where(base_filter)).first() or 0

    query = select(Media).where(base_filter).order_by(
        Media.duration.asc(), Media.id.asc()
    )

    if cursor:
        try:
            dur_str, id_str = cursor.split("_", 1)
            cursor_dur = float(dur_str)
            cursor_id = int(id_str)
            query = query.where(
                or_(
                    Media.duration > cursor_dur,
                    and_(
                        Media.duration == cursor_dur,
                        Media.id > cursor_id,
                    ),
                )
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor format.")

    rows = session.exec(query.limit(limit)).all()

    items = [
        ShortVideoItem(
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
        last = rows[-1]
        next_cursor = f"{last.duration}_{last.id}"

    return ShortVideoPage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_short_videos(
    request: ShortVideoResolveRequest,
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
