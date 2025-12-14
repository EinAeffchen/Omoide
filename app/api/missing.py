from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, not_, or_, select
from sqlmodel import Session

from app.config import settings
from app.database import get_session
from app.logger import logger
from app.models import Media
from app.schemas.missing import (
    MissingBulkActionRequest,
    MissingConfirmResponse,
    MissingMediaPage,
    MissingMediaRead,
    MissingResetResponse,
    build_summary,
)
from app.utils import delete_record

router = APIRouter()


def _base_conditions(include_confirmed: bool, path_prefix: str | None):
    conditions = [Media.missing_since.is_not(None)]
    if not include_confirmed:
        conditions.append(Media.missing_confirmed.is_(False))
    if path_prefix:
        like_pattern = f"{path_prefix.rstrip('/\\')}%"
        conditions.append(Media.path.like(like_pattern))
    return conditions


@router.get("/", response_model=MissingMediaPage)
def list_missing_media(
    session: Session = Depends(get_session),
    limit: int = Query(100, ge=1, le=200),
    cursor: str | None = Query(None),
    path_prefix: str | None = Query(None),
    include_confirmed: bool = Query(False),
):
    conditions = _base_conditions(include_confirmed, path_prefix)
    stmt = select(Media).where(*conditions)
    stmt = stmt.order_by(Media.missing_since.desc(), Media.id.desc())

    if cursor:
        try:
            cursor_time_str, cursor_id_str = cursor.rsplit("_", 1)
            cursor_time = datetime.fromisoformat(cursor_time_str)
            cursor_id = int(cursor_id_str)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid cursor") from exc

        stmt = stmt.where(
            or_(
                Media.missing_since < cursor_time,
                and_(
                    Media.missing_since == cursor_time,
                    Media.id < cursor_id,
                ),
            )
        )

    items = session.exec(stmt.limit(limit)).scalars().all()

    next_cursor = None
    if len(items) == limit:
        last = items[-1]
        if last.missing_since is not None:
            next_cursor = f"{last.missing_since.isoformat()}_{last.id}"

    total = (
        session.exec(select(func.count(Media.id)).where(*conditions)).scalars().first()
        or 0
    )
    try:
        summary_rows = session.exec(select(Media.path).where(*conditions)).all()
        summary = build_summary((row[0] for row in summary_rows))
    except IndexError:
        summary = []

    return MissingMediaPage(
        items=[MissingMediaRead.from_media(media) for media in items],
        next_cursor=next_cursor,
        total=int(total),
        summary=summary,
    )


def _resolve_target_ids(
    session: Session,
    payload: MissingBulkActionRequest,
    *,
    allow_empty: bool = False,
) -> list[int]:
    if payload.select_all:
        conditions = _base_conditions(
            payload.include_confirmed,
            payload.path_prefix,
        )
        if payload.exclude_ids:
            conditions.append(not_(Media.id.in_(payload.exclude_ids)))
        stmt = select(Media.id).where(*conditions)
        return [row[0] for row in session.exec(stmt).all()]

    if not payload.media_ids and not allow_empty:
        raise HTTPException(status_code=400, detail="No media selected")
    return payload.media_ids


@router.post("/confirm", response_model=MissingConfirmResponse)
def confirm_missing(
    payload: MissingBulkActionRequest,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation_mode mode.",
        )

    target_ids = _resolve_target_ids(session, payload)
    if not target_ids:
        return MissingConfirmResponse(deleted=0)

    medias = session.exec(select(Media).where(Media.id.in_(target_ids))).scalars().all()
    deleted = 0
    for media in medias:
        if media.missing_since is None and not media.missing_confirmed:
            continue
        media.missing_confirmed = True
        delete_record(media.id, session)
        deleted += 1

    session.commit()
    logger.info("Confirmed deletion for %d missing media", deleted)
    return MissingConfirmResponse(deleted=deleted)


@router.post("/reset", response_model=MissingResetResponse)
def reset_missing_flags(
    payload: MissingBulkActionRequest,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation_mode mode.",
        )

    target_ids = _resolve_target_ids(session, payload)
    if not target_ids:
        return MissingResetResponse(cleared=0)

    medias = session.exec(select(Media).where(Media.id.in_(target_ids))).scalars().all()
    cleared = 0
    for media in medias:
        if media.missing_since is None and not media.missing_confirmed:
            continue
        media.missing_since = None
        media.missing_confirmed = False
        session.add(media)
        cleared += 1

    session.commit()
    logger.info("Cleared missing flags for %d media", cleared)
    return MissingResetResponse(cleared=cleared)
