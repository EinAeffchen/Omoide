from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlmodel import Session, func, select

from app.database import get_session
from app.logger import logger
from app.models import ExifData, Media
from app.schemas.media import CursorPage

router = APIRouter()


class PlaceCity(BaseModel):
    city: str
    count: int
    cover_thumbnail: str | None


class PlaceCountry(BaseModel):
    country: str
    count: int
    cities: list[PlaceCity]


@router.get("", response_model=list[PlaceCountry])
def list_places(session: Session = Depends(get_session)):
    """Reverse-geocoded places grouped by country, largest first."""
    rows = session.exec(
        select(
            ExifData.country,
            ExifData.city,
            func.count(ExifData.media_id),
        )
        .join(Media, Media.id == ExifData.media_id)
        .where(
            ExifData.city.is_not(None),
            Media.processing_error.is_(None),
            Media.missing_since.is_(None),
        )
        .group_by(ExifData.country, ExifData.city)
        .order_by(func.count(ExifData.media_id).desc())
    ).all()

    covers: dict[tuple[str | None, str], str | None] = {}

    def cover_for(country: str | None, city: str) -> str | None:
        key = (country, city)
        if key not in covers:
            covers[key] = session.exec(
                select(Media.thumbnail_path)
                .join(ExifData, ExifData.media_id == Media.id)
                .where(
                    ExifData.city == city,
                    (
                        ExifData.country == country
                        if country is not None
                        else ExifData.country.is_(None)
                    ),
                    Media.thumbnail_path.is_not(None),
                )
                .order_by(Media.created_at.desc())
                .limit(1)
            ).first()
        return covers[key]

    grouped: dict[str, list[PlaceCity]] = {}
    for country, city, count in rows:
        label = country or "Unknown"
        grouped.setdefault(label, []).append(
            PlaceCity(
                city=city,
                count=count,
                cover_thumbnail=cover_for(country, city),
            )
        )

    return sorted(
        (
            PlaceCountry(
                country=country,
                count=sum(c.count for c in cities),
                cities=cities,
            )
            for country, cities in grouped.items()
        ),
        key=lambda entry: entry.count,
        reverse=True,
    )


@router.get("/media", response_model=CursorPage)
def list_place_media(
    city: str = Query(...),
    country: str | None = Query(None),
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    q = (
        select(Media)
        .join(ExifData, ExifData.media_id == Media.id)
        .where(
            ExifData.city == city,
            Media.processing_error.is_(None),
            Media.missing_since.is_(None),
        )
        .order_by(Media.created_at.desc(), Media.id.desc())
    )
    if country and country != "Unknown":
        q = q.where(ExifData.country == country)
    if cursor:
        try:
            val_str, id_str = cursor.split("_", 1)
            prev_val = datetime.fromisoformat(val_str)
            prev_id = int(id_str)
        except ValueError:
            logger.warning("Invalid place cursor: %s", cursor)
        else:
            q = q.where(
                or_(
                    Media.created_at < prev_val,
                    and_(Media.created_at == prev_val, Media.id < prev_id),
                )
            )
    results = session.exec(q.limit(limit)).all()
    next_cursor = None
    if len(results) == limit:
        last = results[-1]
        next_cursor = f"{last.created_at.isoformat()}_{last.id}"
    return CursorPage(items=results, next_cursor=next_cursor)
