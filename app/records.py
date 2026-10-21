"""Deleting media records (and optionally their files) with everything that references them."""

from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import or_
from sqlmodel import Session, delete, select, text, update

from app.config import settings
from app.conversion import existing_converted_copy
from app.database import safe_commit
from app.logger import logger
from app.models import (
    Album,
    AlbumMediaLink,
    DuplicateIgnore,
    DuplicateMedia,
    Event,
    EventMediaLink,
    ExifData,
    Face,
    Media,
    MediaTagLink,
    Person,
    PersonMediaLink,
    PersonRelationship,
    Scene,
)
from app.persons import auto_select_profile_face


def delete_record(media_id, session: Session):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    to_unlink: list[Path] = []
    thumbnail = media.thumbnail_path
    if not thumbnail:
        thumbnail = str(media.id)
    thumb = Path(settings.general.thumb_dir / thumbnail)
    if thumb.is_file():
        to_unlink.append(thumb)
    converted = existing_converted_copy(media.id)
    if converted is not None:
        to_unlink.append(converted)
    faces = session.exec(select(Face).where(Face.media_id == media.id)).all()
    affected_person_ids: set[int] = set()
    linked_person_ids = session.exec(
        select(PersonMediaLink.person_id).where(PersonMediaLink.media_id == media.id)
    ).all()
    for linked_person_id in linked_person_ids:
        if linked_person_id is not None:
            affected_person_ids.add(linked_person_id)
    for face in faces:
        if face.person_id is not None:
            affected_person_ids.add(face.person_id)
        if face.thumbnail_path:
            thumb = Path(settings.general.thumb_dir / face.thumbnail_path)
            if thumb.is_file():
                to_unlink.append(thumb)
        sql = text(
            """
            DELETE FROM face_embeddings
            WHERE face_id=:f_id
            """
        ).bindparams(f_id=face.id)
        session.exec(sql)

    sql = text(
        """
        DELETE FROM media_embeddings
        WHERE media_id=:m_id
        """
    ).bindparams(m_id=media.id)
    session.exec(sql)

    session.exec(
        text(
            """
            DELETE FROM scene_embeddings
            WHERE media_id = :m_id
            """
        ).bindparams(m_id=media.id)
    )

    faces = session.exec(select(Face).where(Face.media_id == media.id)).all()
    face_ids = [f.id for f in faces]
    if face_ids:
        session.exec(
            update(Person)
            .where(Person.profile_face_id.in_(face_ids))
            .values(profile_face_id=None)
        )
    session.exec(delete(Face).where(Face.media_id == media_id))
    session.exec(delete(PersonMediaLink).where(PersonMediaLink.media_id == media_id))
    session.exec(delete(MediaTagLink).where(MediaTagLink.media_id == media_id))
    session.exec(delete(ExifData).where(ExifData.media_id == media_id))
    session.exec(delete(Scene).where(Scene.media_id == media.id))
    session.exec(
        delete(PersonRelationship).where(PersonRelationship.last_media_id == media.id)
    )
    session.exec(delete(DuplicateMedia).where(DuplicateMedia.media_id == media.id))
    session.exec(
        delete(DuplicateIgnore).where(
            or_(
                DuplicateIgnore.media_id_a == media.id,
                DuplicateIgnore.media_id_b == media.id,
            )
        )
    )
    session.exec(delete(AlbumMediaLink).where(AlbumMediaLink.media_id == media.id))
    linked_event_ids = session.exec(
        select(EventMediaLink.event_id).where(EventMediaLink.media_id == media.id)
    ).all()
    session.exec(delete(EventMediaLink).where(EventMediaLink.media_id == media.id))
    if linked_event_ids:
        session.exec(
            update(Event)
            .where(Event.id.in_(linked_event_ids), Event.media_count > 0)
            .values(media_count=Event.media_count - 1)
        )
    session.exec(
        update(Album)
        .where(Album.cover_media_id == media.id)
        .values(cover_media_id=None)
    )
    session.exec(
        update(Event)
        .where(Event.cover_media_id == media.id)
        .values(cover_media_id=None)
    )
    for pid in affected_person_ids:
        auto_select_profile_face(session, pid)
    session.delete(media)
    safe_commit(session)

    for p in to_unlink:
        try:
            p.unlink()
        except FileNotFoundError:
            pass


def delete_file(session: Session, media_id: int):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    orig = Path(media.path)
    try:
        settings.general.ensure_media_path_writable(orig)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    # Captured before delete_record() deletes and commits the row — accessing
    # attributes on `media` afterward raises ObjectDeletedError since the row
    # backing it no longer exists to refresh from.
    thumbnail_path = media.thumbnail_path

    delete_record(media_id, session)

    # delete original file
    try:
        orig.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete original file %s: %s", orig, exc)

    # delete thumbnail (delete_record() already removes it; this is a no-op
    # safety net in case that step was skipped)
    if not thumbnail_path:
        thumb = settings.general.thumb_dir / f"{media_id}.jpg"
    else:
        thumb = settings.general.thumb_dir / thumbnail_path
    try:
        thumb.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete thumbnail %s: %s", thumb, exc)
