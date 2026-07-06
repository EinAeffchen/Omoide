from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, text
from sqlmodel import Session, col, delete, select

from app.api._resolve import resolve_media_action
from app.config import settings
from app.database import get_session
from app.models import Media, Scene
from app.schemas.broken import (
    BrokenMediaItem,
    BrokenMediaPage,
    BrokenResolveRequest,
    BrokenResolveResponse,
    BrokenRetryRequest,
    BrokenRetryResponse,
)
from app.utils import generate_thumbnail

router = APIRouter()

_RETRY_BATCH_LIMIT = 25


def _broken_filter():
    return col(Media.processing_error).isnot(None)


def _delete_scenes(session: Session, media_id: int) -> None:
    session.exec(
        text(
            """
            DELETE FROM scene_embeddings
            WHERE media_id = :m_id
            """
        ).bindparams(m_id=media_id)
    )
    session.exec(delete(Scene).where(Scene.media_id == media_id))


@router.get("", response_model=BrokenMediaPage)
def list_broken_media(
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Paginated list of media that could not be processed, ordered newest-first."""
    base_filter = _broken_filter()

    total = (
        session.exec(select(func.count(Media.id)).where(base_filter)).first() or 0
    )

    query = select(Media).where(base_filter).order_by(Media.id.desc())

    if cursor:
        try:
            cursor_id = int(cursor)
            query = query.where(Media.id < cursor_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid cursor format.")

    rows = session.exec(query.limit(limit)).all()
    next_cursor = str(rows[-1].id) if len(rows) == limit else None

    return BrokenMediaPage(
        items=[BrokenMediaItem.from_media(m) for m in rows],
        next_cursor=next_cursor,
        total=int(total),
    )


@router.post("/resolve", response_model=BrokenResolveResponse)
def resolve_broken(
    request: BrokenResolveRequest,
    session: Session = Depends(get_session),
):
    removed = resolve_media_action(
        session,
        action=request.action,
        media_ids=request.media_ids,
        select_all=request.select_all,
        base_filter=_broken_filter(),
        filter_ids=True,
        not_found_detail="No matching broken media found.",
    )
    return BrokenResolveResponse(removed=removed)


@router.post("/retry", response_model=BrokenRetryResponse)
def retry_broken(
    request: BrokenRetryRequest,
    session: Session = Depends(get_session),
):
    """Retry thumbnail generation for broken media. Clears the error for items that succeed.

    Processes at most a fixed batch per call; `remaining` reports how many
    matching items were not attempted so clients can call again.
    """
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation mode.",
        )

    base_filter = _broken_filter()
    if request.select_all:
        count_query = select(func.count(Media.id)).where(base_filter)
        query = select(Media).where(base_filter)
    else:
        if not request.media_ids:
            raise HTTPException(status_code=400, detail="No media IDs provided.")
        count_query = select(func.count(Media.id)).where(
            Media.id.in_(request.media_ids), base_filter
        )
        query = select(Media).where(Media.id.in_(request.media_ids), base_filter)

    total = session.exec(count_query).first() or 0
    media_list = session.exec(
        query.order_by(Media.id.asc()).limit(_RETRY_BATCH_LIMIT)
    ).all()

    if not media_list:
        raise HTTPException(status_code=404, detail="No matching broken media found.")

    cleared = 0
    still_broken = 0
    for media in media_list:
        thumb, thumb_error = generate_thumbnail(media)
        if thumb:
            media.thumbnail_path = thumb
            media.processing_error = None
            media.extracted_scenes = False
            media.faces_extracted = False
            media.ran_auto_tagging = False
            media.embeddings_created = False
            media.laplacian_score = None
            _delete_scenes(session, media.id)
            session.add(media)
            cleared += 1
        else:
            media.processing_error = thumb_error or media.processing_error
            session.add(media)
            still_broken += 1
        session.commit()

    return BrokenRetryResponse(
        retried=len(media_list),
        cleared=cleared,
        still_broken=still_broken,
        remaining=max(int(total) - len(media_list), 0),
    )
