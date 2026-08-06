from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import (
    Album,
    Event,
    ExifData,
    Face,
    Media,
    MediaTagLink,
    Person,
    Tag,
)

router = APIRouter()


class StatsTotals(BaseModel):
    media: int
    images: int
    videos: int
    favorites: int
    size_bytes: int
    video_seconds: float
    with_gps: int
    persons: int
    faces: int
    tags: int
    albums: int
    events: int


class YearCount(BaseModel):
    year: int
    images: int
    videos: int


class MonthCount(BaseModel):
    month: str  # YYYY-MM
    count: int


class CameraCount(BaseModel):
    make: str | None
    model: str | None
    count: int


class TagCount(BaseModel):
    id: int
    name: str
    count: int


class PersonCount(BaseModel):
    id: int
    name: str | None
    count: int


class LibraryStats(BaseModel):
    totals: StatsTotals
    per_year: list[YearCount]
    per_month: list[MonthCount]
    cameras: list[CameraCount]
    top_tags: list[TagCount]
    top_people: list[PersonCount]


def _scalar(session: Session, stmt) -> int:
    return session.exec(stmt).first() or 0


@router.get("", response_model=LibraryStats)
def get_stats(session: Session = Depends(get_session)):
    is_video = Media.duration.is_not(None)

    totals = StatsTotals(
        media=_scalar(session, select(func.count(Media.id))),
        images=_scalar(
            session,
            select(func.count(Media.id)).where(Media.duration.is_(None)),
        ),
        videos=_scalar(session, select(func.count(Media.id)).where(is_video)),
        favorites=_scalar(
            session,
            select(func.count(Media.id)).where(Media.is_favorite.is_(True)),
        ),
        size_bytes=_scalar(session, select(func.sum(Media.size))),
        video_seconds=float(
            session.exec(
                select(func.sum(Media.duration)).where(is_video)
            ).first()
            or 0.0
        ),
        with_gps=_scalar(
            session,
            select(func.count(ExifData.id)).where(ExifData.lat.is_not(None)),
        ),
        persons=_scalar(session, select(func.count(Person.id))),
        faces=_scalar(session, select(func.count(Face.id))),
        tags=_scalar(session, select(func.count(Tag.id))),
        albums=_scalar(session, select(func.count(Album.id))),
        events=_scalar(session, select(func.count(Event.id))),
    )

    year_expr = func.strftime("%Y", Media.created_at)
    per_year = [
        YearCount(year=int(year), images=images or 0, videos=videos or 0)
        for year, images, videos in session.exec(
            select(
                year_expr.label("year"),
                func.sum(func.iif(Media.duration.is_(None), 1, 0)),
                func.sum(func.iif(is_video, 1, 0)),
            )
            .group_by("year")
            .order_by(year_expr.asc())
        ).all()
        if year is not None
    ]

    month_expr = func.strftime("%Y-%m", Media.created_at)
    per_month = [
        MonthCount(month=month, count=count)
        for month, count in session.exec(
            select(month_expr.label("month"), func.count(Media.id))
            .group_by("month")
            .order_by(month_expr.desc())
            .limit(24)
        ).all()
        if month is not None
    ][::-1]

    cameras = [
        CameraCount(make=make, model=model, count=count)
        for make, model, count in session.exec(
            select(ExifData.make, ExifData.model, func.count(ExifData.id))
            .where(ExifData.model.is_not(None))
            .group_by(ExifData.make, ExifData.model)
            .order_by(func.count(ExifData.id).desc())
            .limit(15)
        ).all()
    ]

    top_tags = [
        TagCount(id=tag_id, name=name, count=count)
        for tag_id, name, count in session.exec(
            select(Tag.id, Tag.name, func.count(MediaTagLink.media_id))
            .join(MediaTagLink, MediaTagLink.tag_id == Tag.id)
            .group_by(Tag.id)
            .order_by(func.count(MediaTagLink.media_id).desc())
            .limit(15)
        ).all()
    ]

    top_people = [
        PersonCount(id=pid, name=name, count=count or 0)
        for pid, name, count in session.exec(
            select(Person.id, Person.name, Person.appearance_count)
            .where(Person.name.is_not(None))
            .order_by(Person.appearance_count.desc())
            .limit(15)
        ).all()
    ]

    return LibraryStats(
        totals=totals,
        per_year=per_year,
        per_month=per_month,
        cameras=cameras,
        top_tags=top_tags,
        top_people=top_people,
    )


@router.get("/cameras", response_model=list[CameraCount])
def list_cameras(session: Session = Depends(get_session)):
    """All distinct cameras, for the media grid's camera filter."""
    return [
        CameraCount(make=make, model=model, count=count)
        for make, model, count in session.exec(
            select(ExifData.make, ExifData.model, func.count(ExifData.id))
            .where(ExifData.model.is_not(None))
            .group_by(ExifData.make, ExifData.model)
            .order_by(func.count(ExifData.id).desc())
        ).all()
    ]
