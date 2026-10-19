from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    status,
)
from sqlalchemy import text
from sqlalchemy.orm import aliased, selectinload
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session, safe_commit
from app.media_files import update_exif_gps
from app.models import (
    ExifData,
    Face,
    Media,
    Person,
    PersonMediaLink,
)
from app.records import delete_file, delete_record
from app.schemas.face import FaceRead
from app.schemas.media import (
    FavoriteUpdate,
    GeoUpdate,
    MediaDetail,
    MediaPreview,
    MediaRead,
)
from app.schemas.person import PersonRead

router = APIRouter()


@router.get("/{media_id}", response_model=MediaDetail)
def get_media(media_id: int, session: Session = Depends(get_session)):
    profile_face_alias = aliased(Face)

    statement = (
        select(
            Media,
            Person,
        )
        .outerjoin(Media.faces)
        .outerjoin(Face.person)
        .outerjoin(profile_face_alias, Person.profile_face)
        .where(Media.id == media_id)
        .group_by(Person.id)
        .options(selectinload(Media.tags))
    )
    rows = session.exec(statement).all()
    if not rows:
        raise HTTPException(404, "Media not found")

    media = rows[0][0]
    seen = set()
    persons: list[PersonRead] = []
    orphans: list[Face] = []
    for _, person in rows:
        if person and person.id not in seen:
            seen.add(person.id)
            persons.append(
                PersonRead(
                    **person.model_dump(),
                    profile_face=(
                        FaceRead(**person.profile_face.model_dump())
                        if person.profile_face
                        else None
                    ),
                )
            )
    manual_person_ids = session.exec(
        select(PersonMediaLink.person_id).where(
            PersonMediaLink.media_id == media_id
        )
    ).all()
    if manual_person_ids:
        manual_persons = session.exec(
            select(Person).where(Person.id.in_(manual_person_ids))
        ).all()
        for person in manual_persons:
            if person.id in seen:
                continue
            seen.add(person.id)
            persons.append(
                PersonRead(
                    **person.model_dump(),
                    profile_face=(
                        FaceRead(**person.profile_face.model_dump())
                        if person.profile_face
                        else None
                    ),
                )
            )
    orphans = session.exec(
        select(Face).where(
            Face.media_id == media_id, Face.person_id.is_(None)
        ),
    ).all()
    return MediaDetail(media=media, persons=persons, orphans=orphans)


@router.delete(
    "/{media_id}/file",
    summary="Permanently delete the media file & its thumbnail from disk",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_media_file(media_id: int, session: Session = Depends(get_session)):
    delete_file(session, media_id)


@router.delete(
    "/{media_id}",
    summary="Delete media record (and dependent faces) from database",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_media_record(
    media_id: int,
    session: Session = Depends(get_session),
):
    delete_record(media_id, session)


@router.get("/{media_id}/get-similar", response_model=list[MediaPreview])
def get_similar_media(media_id: int, k: int = 8, session=Depends(get_session)):
    # Ensure an anchor embedding exists for this media
    has_vec = session.exec(
        text("SELECT 1 FROM media_embeddings WHERE media_id = :id").bindparams(
            id=media_id
        )
    ).first()
    if not has_vec:
        raise HTTPException(404, "No embedding found for this media")

    max_dist = 2.0 - settings.ai.min_similarity_dist
    # Fully in-DB nearest-neighbor query using the anchor vector via subquery
    rows = session.exec(
        text(
            """
            SELECT media_id
              FROM media_embeddings
             WHERE embedding MATCH (
                       SELECT embedding
                         FROM media_embeddings
                        WHERE media_id = :id
                   )
                AND media_id != :id
               AND k = :k
               AND distance < :maxd
             ORDER BY distance
            """
        ).bindparams(id=media_id, k=k + 1, maxd=max_dist)
    ).all()

    # Exclude the anchor and preserve order; cap to k
    if not rows:
        return []

    media_ids = [row.media_id for row in rows]
    media_objs = session.exec(
        select(Media).where(Media.id.in_(media_ids))
    ).all()
    id_to_obj = {m.id: m for m in media_objs}
    ordered = [id_to_obj[mid] for mid in media_ids if mid in id_to_obj]
    return [MediaPreview.model_validate(m) for m in ordered]


@router.patch("/{media_id}/geolocation", response_model=MediaRead)
def update_geolocation(
    media_id: int,
    data: GeoUpdate,
    session: Session = Depends(get_session),
):
    media = session.exec(
        select(Media)
        .options(selectinload(Media.exif))
        .where(Media.id == media_id)
    ).first()
    if not media:
        raise HTTPException(404, "Media not found")
    try:
        settings.general.ensure_media_path_writable(Path(media.path))
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    exif = media.exif
    if exif is None:
        exif = ExifData(media_id=media.id)
        media.exif = exif
        session.add(exif)
    exif.lat = data.latitude
    exif.lon = data.longitude
    update_exif_gps(media.path, data.longitude, data.latitude)
    session.add(media)
    session.commit()
    session.refresh(media)
    return media


@router.patch("/{media_id}/favorite", response_model=MediaRead)
def update_favorite(
    media_id: int,
    data: FavoriteUpdate,
    session: Session = Depends(get_session),
):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    media.is_favorite = data.is_favorite
    session.add(media)
    safe_commit(session)
    session.refresh(media)
    return media