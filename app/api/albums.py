from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, func, select

from app.database import get_session, safe_commit
from app.logger import logger
from app.models import Album, AlbumMediaLink, Media
from app.pagination import media_newest_first, paginate
from app.schemas.media import CursorPage

router = APIRouter()


class AlbumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class AlbumUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    cover_media_id: int | None = None


class AlbumMediaRequest(BaseModel):
    media_ids: list[int]


class AlbumRead(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime
    media_count: int
    cover_thumbnail: str | None


def _cover_thumbnail(session: Session, album: Album) -> str | None:
    if album.cover_media_id:
        cover = session.get(Media, album.cover_media_id)
        if cover and cover.thumbnail_path:
            return cover.thumbnail_path
    row = session.exec(
        select(Media.thumbnail_path)
        .join(AlbumMediaLink, AlbumMediaLink.media_id == Media.id)
        .where(
            AlbumMediaLink.album_id == album.id,
            Media.thumbnail_path.is_not(None),
            Media.missing_since.is_(None),
        )
        .order_by(AlbumMediaLink.created_at.desc())
        .limit(1)
    ).first()
    return row


def _album_read(session: Session, album: Album) -> AlbumRead:
    count = (
        session.exec(
            select(func.count(AlbumMediaLink.media_id)).where(
                AlbumMediaLink.album_id == album.id
            )
        ).first()
        or 0
    )
    return AlbumRead(
        id=album.id,
        name=album.name,
        description=album.description,
        created_at=album.created_at,
        media_count=count,
        cover_thumbnail=_cover_thumbnail(session, album),
    )


@router.get("", response_model=list[AlbumRead])
def list_albums(session: Session = Depends(get_session)):
    albums = session.exec(
        select(Album).order_by(Album.created_at.desc())
    ).all()
    return [_album_read(session, album) for album in albums]


@router.post("", response_model=AlbumRead)
def create_album(body: AlbumCreate, session: Session = Depends(get_session)):
    album = Album(name=body.name.strip(), description=body.description)
    session.add(album)
    safe_commit(session)
    session.refresh(album)
    logger.info("Created album %s (%s)", album.id, album.name)
    return _album_read(session, album)


@router.get("/{album_id}", response_model=AlbumRead)
def get_album(album_id: int, session: Session = Depends(get_session)):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Album not found")
    return _album_read(session, album)


@router.patch("/{album_id}", response_model=AlbumRead)
def update_album(
    album_id: int,
    body: AlbumUpdate,
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Album not found")
    if body.name is not None:
        album.name = body.name.strip()
    if body.description is not None:
        album.description = body.description
    if body.cover_media_id is not None:
        in_album = session.exec(
            select(AlbumMediaLink).where(
                AlbumMediaLink.album_id == album_id,
                AlbumMediaLink.media_id == body.cover_media_id,
            )
        ).first()
        if not in_album:
            raise HTTPException(400, "Cover media is not part of this album")
        album.cover_media_id = body.cover_media_id
    session.add(album)
    safe_commit(session)
    session.refresh(album)
    return _album_read(session, album)


@router.delete("/{album_id}")
def delete_album(album_id: int, session: Session = Depends(get_session)):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Album not found")
    for link in session.exec(
        select(AlbumMediaLink).where(AlbumMediaLink.album_id == album_id)
    ).all():
        session.delete(link)
    # Flush the link deletes before the album delete: SQLAlchemy only orders
    # cross-mapper deletes via a declared relationship(), which these models
    # don't have, so without this the album delete can be emitted first and
    # trip the foreign key constraint.
    session.flush()
    session.delete(album)
    safe_commit(session)
    return {"status": "deleted"}


@router.post("/{album_id}/media", response_model=AlbumRead)
def add_media_to_album(
    album_id: int,
    body: AlbumMediaRequest,
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Album not found")
    existing = set(
        session.exec(
            select(AlbumMediaLink.media_id).where(
                AlbumMediaLink.album_id == album_id,
                AlbumMediaLink.media_id.in_(body.media_ids),
            )
        ).all()
    )
    valid_ids = set(
        session.exec(
            select(Media.id).where(Media.id.in_(body.media_ids))
        ).all()
    )
    for media_id in valid_ids - existing:
        session.add(AlbumMediaLink(album_id=album_id, media_id=media_id))
    safe_commit(session)
    return _album_read(session, album)


@router.delete("/{album_id}/media", response_model=AlbumRead)
def remove_media_from_album(
    album_id: int,
    body: AlbumMediaRequest,
    session: Session = Depends(get_session),
):
    album = session.get(Album, album_id)
    if not album:
        raise HTTPException(404, "Album not found")
    for link in session.exec(
        select(AlbumMediaLink).where(
            AlbumMediaLink.album_id == album_id,
            AlbumMediaLink.media_id.in_(body.media_ids),
        )
    ).all():
        session.delete(link)
    if album.cover_media_id in body.media_ids:
        album.cover_media_id = None
        session.add(album)
    safe_commit(session)
    return _album_read(session, album)


@router.get("/{album_id}/media", response_model=CursorPage)
def list_album_media(
    album_id: int,
    cursor: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
):
    if not session.get(Album, album_id):
        raise HTTPException(404, "Album not found")
    q = (
        select(Media)
        .join(AlbumMediaLink, AlbumMediaLink.media_id == Media.id)
        .where(
            AlbumMediaLink.album_id == album_id,
            Media.processing_error.is_(None),
            Media.missing_since.is_(None),
        )
    )
    results, next_cursor = paginate(
        session, q, media_newest_first(), cursor=cursor, limit=limit
    )
    return CursorPage(items=results, next_cursor=next_cursor)
