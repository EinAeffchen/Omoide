"""Paged media lists (all, images, videos, favorites) and map locations."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, union_all
from sqlmodel import Session, col, select

from app.database import get_session
from app.models import ExifData, Face, Media, PersonMediaLink, Tag
from app.pagination import SortKey, paginate
from app.schemas.media import CursorPage, MediaLocation

from .folders import normalize_relative_path

router = APIRouter()


def _media_sort_keys(sort: str) -> list[SortKey]:
    """ "newest" orders by capture time, "latest" by when it was added."""
    column = Media.created_at if sort == "newest" else Media.inserted_at
    return [(column, False), (Media.id, False)]


@router.get("/", response_model=CursorPage)
def list_media(
    tags: list[str] | None = Query(
        None, description="Filter by tag name(s), comma-separated"
    ),
    person_id: int | None = Query(None, description="Filter by detected person ID"),
    folder: str | None = Query(
        None,
        description=(
            "Relative folder path (POSIX style). Use empty string for root-level items."
        ),
    ),
    recursive: bool = Query(
        True, description="Include media in nested subfolders when filtering by folder."
    ),
    camera_make: str | None = Query(None, description="Filter by EXIF camera make."),
    camera_model: str | None = Query(None, description="Filter by EXIF camera model."),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
    limit: int = Query(100, ge=1, le=200),
    session: Session = Depends(get_session),
):
    q = select(Media).where(col(Media.processing_error).is_(None))
    # select by tags
    if tags and len(tags) > 0:
        q = q.join(Media.tags).where(Tag.name.in_(tags))

    if camera_make or camera_model:
        q = q.join(ExifData, ExifData.media_id == Media.id)
        if camera_make:
            q = q.where(ExifData.make == camera_make)
        if camera_model:
            q = q.where(ExifData.model == camera_model)

    normalized_folder = ""
    if folder is not None:
        normalized_folder = normalize_relative_path(folder)
        normalized_path_expr = func.replace(Media.path, "\\", "/")
        if normalized_folder:
            prefix = f"{normalized_folder}/"
            q = q.where(normalized_path_expr.like(f"{prefix}%"))
            if not recursive:
                q = q.where(~normalized_path_expr.like(f"{prefix}%/%"))
        elif not recursive:
            q = q.where(~normalized_path_expr.like("%/%"))

    if person_id:
        media_links_union = union_all(
            select(Face.media_id.label("media_id")).where(Face.person_id == person_id),
            select(PersonMediaLink.media_id.label("media_id")).where(
                PersonMediaLink.person_id == person_id
            ),
        ).subquery()
        q = q.where(Media.id.in_(select(media_links_union.c.media_id)))

    results, next_cursor = paginate(
        session, q, _media_sort_keys(sort), cursor=cursor, limit=limit, tag=sort
    )
    return CursorPage(items=results, next_cursor=next_cursor)


@router.get("/locations", response_model=list[MediaLocation])
def list_locations(
    session: Session = Depends(get_session),
    north: float | None = None,
    south: float | None = None,
    east: float | None = None,
    west: float | None = None,
):
    """
    Lists media locations. If bounding box parameters (north, south, east, west)
    are provided, it returns only locations within that box.
    """
    stmt = (
        select(
            Media.id,
            Media.thumbnail_path,
            ExifData.lat.label("latitude"),
            ExifData.lon.label("longitude"),
        )
        .join(ExifData, ExifData.media_id == Media.id)
        .where(ExifData.lat.is_not(None), ExifData.lon.is_not(None))
    )

    # Check if all bounding box parameters are present
    if all(p is not None for p in [north, south, east, west]):
        stmt = stmt.where(
            ExifData.lat >= south,
            ExifData.lat <= north,
            ExifData.lon >= west,
            ExifData.lon <= east,
        )

    # Add a reasonable limit to prevent sending overwhelming amounts of data
    # for very dense areas, even within the viewport.
    stmt = stmt.limit(5000)

    rows = session.exec(stmt).all()
    results = []
    for row in rows:
        thumbnail_path = (
            f"{row.id}.jpg" if not row.thumbnail_path else row.thumbnail_path
        )
        results.append(
            MediaLocation(
                id=row.id,
                latitude=row.latitude,
                longitude=row.longitude,
                thumbnail=thumbnail_path,
            )
        )
    return results


@router.get("/images", response_model=CursorPage, summary="List all images")
def list_images(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
):
    stmt = select(Media).where(
        Media.duration.is_(None), col(Media.processing_error).is_(None)
    )  # images have no duration

    medias, next_cursor = paginate(
        session, stmt, _media_sort_keys(sort), cursor=cursor, limit=limit, tag=sort
    )
    return CursorPage(items=medias, next_cursor=next_cursor)


@router.get("/videos", response_model=CursorPage, summary="List all videos")
def list_videos(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
):
    stmt = select(Media).where(
        Media.duration != None, col(Media.processing_error).is_(None)
    )  # videos have a duration
    results, next_cursor = paginate(
        session, stmt, _media_sort_keys("latest"), cursor=cursor, limit=limit
    )
    return CursorPage(items=results, next_cursor=next_cursor)


@router.get("/favorites", response_model=CursorPage, summary="List favorite media")
def list_favorites(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
):
    stmt = select(Media).where(
        Media.is_favorite == True, col(Media.processing_error).is_(None)
    )

    medias, next_cursor = paginate(
        session, stmt, _media_sort_keys(sort), cursor=cursor, limit=limit, tag=sort
    )
    return CursorPage(items=medias, next_cursor=next_cursor)
