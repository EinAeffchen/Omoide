from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.api._resolve import resolve_media_action
from app.database import get_session
from app.models import Media
from app.schemas.shortvideos import ShortVideoItem, ShortVideoPage, ShortVideoResolveRequest

router = APIRouter()

_DEFAULT_MAX_DURATION = 10.0


def _base_filter(max_duration: float):
    return and_(
        Media.duration.isnot(None),
        Media.duration >= 0,
        Media.duration < max_duration,
    )


@router.get("", response_model=ShortVideoPage)
def get_short_videos(
    session: Session = Depends(get_session),
    max_duration: float = Query(_DEFAULT_MAX_DURATION, ge=0),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Paginated list of videos shorter than max_duration seconds, ordered shortest-first."""
    base_filter = _base_filter(max_duration)

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
    removed = resolve_media_action(
        session,
        action=request.action,
        media_ids=request.media_ids,
        select_all=request.select_all,
        base_filter=_base_filter(request.max_duration),
    )
    return {"removed": removed}
