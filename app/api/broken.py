from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.config import settings
from app.database import get_session
from app.models import Blacklist, Media
from app.schemas.broken import (
    BrokenMediaItem,
    BrokenMediaPage,
    BrokenResolveRequest,
    BrokenResolveResponse,
    BrokenRetryRequest,
    BrokenRetryResponse,
)
from app.utils import delete_file, delete_record, generate_thumbnail

router = APIRouter()


@router.get("", response_model=BrokenMediaPage)
def list_broken_media(
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Paginated list of media that could not be processed, ordered newest-first."""
    base_filter = col(Media.processing_error).isnot(None)

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
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation mode.",
        )

    if request.select_all:
        media_list = session.exec(
            select(Media).where(col(Media.processing_error).isnot(None))
        ).all()
    else:
        if not request.media_ids:
            raise HTTPException(status_code=400, detail="No media IDs provided.")
        media_list = session.exec(
            select(Media).where(
                Media.id.in_(request.media_ids),
                col(Media.processing_error).isnot(None),
            )
        ).all()

    if not media_list:
        raise HTTPException(status_code=404, detail="No matching broken media found.")

    removed = 0
    for media in media_list:
        if request.action == "DELETE_FILES":
            delete_file(session, media.id)
        elif request.action == "DELETE_RECORDS":
            delete_record(media.id, session)
        elif request.action == "BLACKLIST_RECORDS":
            try:
                session.add(Blacklist(path=media.path))
                session.flush()
            except Exception:
                pass  # already blacklisted
            delete_record(media.id, session)
        else:
            raise HTTPException(
                status_code=400, detail=f"Unknown action: {request.action}"
            )
        removed += 1

    session.commit()
    return BrokenResolveResponse(removed=removed)


@router.post("/retry", response_model=BrokenRetryResponse)
def retry_broken(
    request: BrokenRetryRequest,
    session: Session = Depends(get_session),
):
    """Retry thumbnail generation for broken media. Clears the error for items that succeed."""
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation mode.",
        )

    if request.select_all:
        media_list = session.exec(
            select(Media).where(col(Media.processing_error).isnot(None))
        ).all()
    else:
        if not request.media_ids:
            raise HTTPException(status_code=400, detail="No media IDs provided.")
        media_list = session.exec(
            select(Media).where(
                Media.id.in_(request.media_ids),
                col(Media.processing_error).isnot(None),
            )
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
    )
