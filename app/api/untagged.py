from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func
from sqlmodel import Session, select

from app.api._resolve import resolve_media_action
from app.database import get_session
from app.models import Media, MediaTagLink
from app.schemas.untagged import UntaggedMediaItem, UntaggedPage, UntaggedResolveRequest

router = APIRouter()


def _base_filter(media_type: str | None):
    has_tag = select(MediaTagLink.media_id)
    base_filter = Media.id.not_in(has_tag)

    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))
    return base_filter


@router.get("", response_model=UntaggedPage)
def get_untagged_media(
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    media_type: str | None = Query(None, description="'image', 'video', or omit for all"),
):
    """Paginated list of media with no tags assigned, ordered newest-first."""
    base_filter = _base_filter(media_type)

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
        UntaggedMediaItem(
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

    return UntaggedPage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_untagged(
    request: UntaggedResolveRequest,
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
