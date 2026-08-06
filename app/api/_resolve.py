from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.config import settings
from app.logger import logger
from app.models import Blacklist, Media
from app.utils import delete_file, delete_record


def resolve_media_action(
    session: Session,
    *,
    action: str,
    media_ids: list[int],
    select_all: bool,
    base_filter: Any,
    filter_ids: bool = True,
    not_found_detail: str = "No matching media found.",
) -> int:
    """Shared handler for the maintenance resolve endpoints.

    When ``select_all`` is true the action applies to every media row matching
    ``base_filter``; otherwise it applies only to given IDs that still match
    that filter. This prevents a stale review selection from affecting media
    outside the currently selected review category.
    """
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in presentation mode.",
        )

    if action not in ("DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"):
        raise HTTPException(
            status_code=400, detail=f"Unknown action: {action}"
        )

    if select_all:
        query = select(Media).where(base_filter)
    else:
        if not media_ids:
            raise HTTPException(
                status_code=400, detail="No media IDs provided."
            )
        query = select(Media).where(Media.id.in_(media_ids))
        if filter_ids:
            query = query.where(base_filter)

    media_list = session.exec(query).all()
    if not media_list:
        raise HTTPException(status_code=404, detail=not_found_detail)

    processed = 0
    for media in media_list:
        if action == "DELETE_FILES":
            try:
                delete_file(session, media.id)
            except HTTPException as exc:
                if exc.status_code == 403:
                    logger.warning(
                        "Skipping delete for media id=%s: %s",
                        media.id,
                        exc.detail,
                    )
                    continue
                raise
        elif action == "DELETE_RECORDS":
            delete_record(media.id, session)
        else:
            existing = session.exec(
                select(Blacklist).where(Blacklist.path == media.path)
            ).first()
            if existing is None:
                session.add(Blacklist(path=media.path))
            delete_record(media.id, session)
        processed += 1

    session.commit()
    return processed
