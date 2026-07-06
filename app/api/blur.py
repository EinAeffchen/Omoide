from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlmodel import Session, select

from app.api._resolve import resolve_media_action
from app.database import get_session
from app.models import Media
from app.schemas.blur import BlurMediaItem, BlurPage, BlurResolveRequest

router = APIRouter()

_DEFAULT_THRESHOLD = 100.0


def _base_filter(threshold: float, media_type: str | None):
    base_filter = and_(
        Media.laplacian_score.isnot(None),
        Media.laplacian_score >= 0,
        Media.laplacian_score < threshold,
    )
    if media_type == "image":
        base_filter = and_(base_filter, Media.duration.is_(None))
    elif media_type == "video":
        base_filter = and_(base_filter, Media.duration.isnot(None))
    return base_filter


@router.get("", response_model=BlurPage)
def get_blurry_media(
    session: Session = Depends(get_session),
    threshold: float = Query(_DEFAULT_THRESHOLD, ge=0),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    media_type: str | None = Query(None, description="'image', 'video', or omit for all"),
):
    """Paginated list of media with laplacian_score below the threshold, ordered blurriest-first."""
    base_filter = _base_filter(threshold, media_type)

    total = session.exec(select(func.count(Media.id)).where(base_filter)).first() or 0

    query = select(Media).where(base_filter).order_by(
        Media.laplacian_score.asc(), Media.id.asc()
    )

    if cursor:
        try:
            score_str, id_str = cursor.split("_", 1)
            cursor_score = float(score_str)
            cursor_id = int(id_str)
            query = query.where(
                or_(
                    Media.laplacian_score > cursor_score,
                    and_(
                        Media.laplacian_score == cursor_score,
                        Media.id > cursor_id,
                    ),
                )
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor format.")

    rows = session.exec(query.limit(limit)).all()

    items = [
        BlurMediaItem(
            id=m.id,
            filename=m.filename,
            path=m.path,
            size=m.size or 0,
            thumbnail_path=m.thumbnail_path,
            laplacian_score=m.laplacian_score,
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
        next_cursor = f"{last.laplacian_score}_{last.id}"

    return BlurPage(items=items, next_cursor=next_cursor, total=total)


@router.post("/resolve")
def resolve_blurry(
    request: BlurResolveRequest,
    session: Session = Depends(get_session),
):
    removed = resolve_media_action(
        session,
        action=request.action,
        media_ids=request.media_ids,
        select_all=request.select_all,
        base_filter=_base_filter(request.threshold, request.media_type),
    )
    return {"removed": removed}
