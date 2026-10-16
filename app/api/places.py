from __future__ import annotations


from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, func, select

from app.database import get_session
from app.models import ExifData, Media
from app.pagination import media_newest_first, paginate
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
    )
    if country == "Unknown":
        # The UI uses this label for rows whose country was not resolved.
        # Treat it as NULL, not as an omitted filter, otherwise cities with
        # the same name in other countries are mixed into the result.
        q = q.where(ExifData.country.is_(None))
    elif country:
        q = q.where(ExifData.country == country)
    results, next_cursor = paginate(
        session, q, media_newest_first(), cursor=cursor, limit=limit
    )
    return CursorPage(items=results, next_cursor=next_cursor)
