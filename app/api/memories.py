from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlmodel import Session, select

from app.database import get_session
from app.models import Face, Media
from app.schemas.media import MediaPreview

router = APIRouter()

_BROWSABLE = lambda: (  # noqa: E731 - shared filter for user-facing media
    Media.processing_error.is_(None),
    Media.missing_since.is_(None),
    Media.thumbnail_path.is_not(None),
)


class MemoryGroup(BaseModel):
    year: int
    items: list[MediaPreview]


@router.get("", response_model=list[MemoryGroup])
def get_memories(
    date: str | None = Query(
        None,
        pattern=r"^\d{2}-\d{2}$",
        description="Month-day (MM-DD); defaults to today.",
    ),
    per_year: int = Query(12, ge=1, le=50),
    session: Session = Depends(get_session),
):
    """Media taken on this day in previous years, grouped by year."""
    now = datetime.now()
    month_day = date or now.strftime("%m-%d")

    rows = session.exec(
        select(Media)
        .where(
            *_BROWSABLE(),
            func.strftime("%m-%d", Media.created_at) == month_day,
            func.strftime("%Y", Media.created_at) < str(now.year),
        )
        .order_by(Media.created_at.desc(), Media.id.desc())
    ).all()

    groups: dict[int, list[Media]] = {}
    for media in rows:
        year = media.created_at.year
        bucket = groups.setdefault(year, [])
        if len(bucket) < per_year:
            bucket.append(media)

    return [
        MemoryGroup(year=year, items=groups[year])
        for year in sorted(groups, reverse=True)
    ]


@router.get("/highlights", response_model=list[MediaPreview])
def get_highlights(
    year: int = Query(..., ge=1900, le=2200),
    limit: int = Query(60, ge=1, le=200),
    session: Session = Depends(get_session),
):
    """Best media of a year, ranked from signals we already compute:
    favorites, number of faces, sharpness and view count."""
    face_count = (
        select(func.count(Face.id))
        .where(Face.media_id == Media.id)
        .correlate(Media)
        .scalar_subquery()
    )
    score = (
        case((Media.is_favorite.is_(True), 4), else_=0)
        + func.min(face_count, 3)
        + case(
            (Media.laplacian_score > 100, 1),
            else_=0,
        )
        + func.min(func.coalesce(Media.views, 0), 5) * 0.4
    )

    rows = session.exec(
        select(Media)
        .where(
            *_BROWSABLE(),
            func.strftime("%Y", Media.created_at) == str(year),
        )
        .order_by(score.desc(), Media.created_at.desc(), Media.id.desc())
        .limit(limit)
    ).all()
    return rows


class HighlightYear(BaseModel):
    year: int
    count: int


@router.get("/highlights/years", response_model=list[HighlightYear])
def get_highlight_years(session: Session = Depends(get_session)):
    """Years that have browsable media, newest first."""
    rows = session.exec(
        select(
            func.strftime("%Y", Media.created_at).label("year"),
            func.count(Media.id),
        )
        .where(*_BROWSABLE())
        .group_by("year")
        .order_by(func.strftime("%Y", Media.created_at).desc())
    ).all()
    return [
        HighlightYear(year=int(year), count=count)
        for year, count in rows
        if year is not None
    ]
