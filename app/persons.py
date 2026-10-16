"""Person bookkeeping: appearance counts, profile faces, centroids, merging
and removal."""

from collections.abc import Iterable
from datetime import datetime

import numpy as np
from fastapi import HTTPException
from sqlalchemy import and_, distinct, func, or_, union_all
from sqlmodel import Session, delete, select, text, update

from app.database import safe_commit
from app.logger import logger
from app.models import (
    Face,
    Person,
    PersonMediaLink,
    PersonRelationship,
    PersonTagLink,
    TimelineEvent,
)
from app.presentation import ensure_writable
from app.vectors import vector_from_stored, vector_to_blob


def recalculate_person_appearance_counts(
    session: Session, person_ids: Iterable[int]
) -> None:
    ids = {pid for pid in person_ids if pid is not None}
    if not ids:
        return

    session.flush()

    appearance_pairs = union_all(
        select(
            Face.person_id.label("person_id"), Face.media_id.label("media_id")
        ).where(Face.person_id.in_(ids)),
        select(
            PersonMediaLink.person_id.label("person_id"),
            PersonMediaLink.media_id.label("media_id"),
        ).where(PersonMediaLink.person_id.in_(ids)),
    ).subquery()

    rows = session.exec(
        select(
            appearance_pairs.c.person_id,
            func.count(distinct(appearance_pairs.c.media_id)),
        ).group_by(appearance_pairs.c.person_id)
    ).all()
    counts = {pid: count for pid, count in rows}
    for pid in ids:
        person = session.get(Person, pid)
        if person is None:
            continue
        person.appearance_count = counts.get(pid, 0)
        session.add(person)


def auto_select_profile_face(session: Session, person_id: int) -> int | None:
    """Assigns a suitable profile face for the given person.

    Prefers the face whose embedding is closest to the centroid of the
    person's embeddings (same approach as clustering). Falls back to
    a thumbnail/area heuristic when embeddings are missing.
    Returns the selected face id, or None if no face could be chosen.
    """
    person = session.get(Person, person_id)
    if not person:
        return None

    faces = session.exec(select(Face).where(Face.person_id == person_id)).all()

    if not faces:
        if person.profile_face_id is not None:
            person.profile_face_id = None
            session.add(person)
        return None

    embedding_face_ids: list[int] = []
    embedding_vectors: list[np.ndarray] = []

    for face in faces:
        row = session.exec(
            text(
                """
                SELECT embedding
                  FROM face_embeddings
                 WHERE face_id = :fid
                """
            ).bindparams(fid=face.id)
        ).first()
        if not row:
            continue
        vector = vector_from_stored(row[0])
        if vector is None or vector.size == 0:
            continue
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(norm) or norm == 0.0:
            continue
        embedding_face_ids.append(face.id)
        embedding_vectors.append((vector / norm).astype(np.float32, copy=False))

    best_face_id: int | None = None
    if embedding_face_ids:
        embeddings_arr = np.vstack(embedding_vectors)
        centroid = embeddings_arr.mean(axis=0)
        centroid_norm = float(np.linalg.norm(centroid))
        if centroid_norm > 0:
            centroid = centroid / centroid_norm
        similarities = embeddings_arr @ centroid
        best_face_id = int(embedding_face_ids[int(np.argmax(similarities))])

    def fallback_score(face: Face) -> tuple[int, int, int]:
        has_thumb = 1 if face.thumbnail_path else 0
        area = 0
        try:
            if face.bbox and len(face.bbox) >= 4:
                x1, y1, x2, y2 = face.bbox[:4]
                area = max(0, int(x2) - int(x1)) * max(0, int(y2) - int(y1))
        except Exception:  # pragma: no cover - defensive
            area = 0
        return (has_thumb, area, -face.id)

    if best_face_id is None or not any(face.id == best_face_id for face in faces):
        best_face = max(faces, key=fallback_score)
        best_face_id = best_face.id

    if person.profile_face_id != best_face_id:
        person.profile_face_id = best_face_id
        session.add(person)
    return best_face_id


def _normalized_person_face_vectors(
    session: Session, person_id: int
) -> list[np.ndarray]:
    """Unit-length embeddings of every face assigned to the person, skipping
    missing, empty or degenerate vectors."""
    rows = session.exec(
        text("SELECT embedding FROM face_embeddings WHERE person_id = :pid").bindparams(
            pid=person_id
        )
    ).all()
    vectors: list[np.ndarray] = []
    for (stored,) in rows:
        vec = vector_from_stored(stored)
        if vec is None or vec.size == 0:
            continue
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm == 0.0:
            continue
        vectors.append((vec / norm).astype(np.float32, copy=False))
    return vectors


def compute_person_centroid(session: Session, person_id: int) -> np.ndarray | None:
    """Normalized mean of the person's normalized face embeddings, or None if
    the person has no usable face embeddings."""
    vectors = _normalized_person_face_vectors(session, person_id)
    if not vectors:
        return None
    centroid = np.vstack(vectors).mean(axis=0)
    norm = float(np.linalg.norm(centroid))
    if norm > 0.0 and np.isfinite(norm):
        centroid = centroid / norm
    return centroid.astype(np.float32, copy=False)


def get_person_embedding(session: Session, person_id: int) -> bytes | None:
    """The person's stored centroid, computed on the fly if none is stored."""
    row = session.exec(
        text(
            "SELECT embedding FROM person_embeddings WHERE person_id=:p_id"
        ).bindparams(p_id=person_id)
    ).first()
    if row:
        blob = vector_to_blob(row[0])
        if blob:
            return blob
    centroid = compute_person_centroid(session, person_id)
    if centroid is None:
        logger.debug("No usable face embeddings for person %s", person_id)
        return None
    return vector_to_blob(centroid)


def person_has_appearances(session: Session, person_id: int) -> bool:
    """True if any face or manual media link still points at the person."""
    if session.exec(select(Face.id).where(Face.person_id == person_id)).first():
        return True
    return (
        session.exec(
            select(PersonMediaLink.media_id).where(
                PersonMediaLink.person_id == person_id
            )
        ).first()
        is not None
    )


def rebuild_person_embedding(session: Session, person_id: int) -> bool:
    """Recompute and store the person's centroid after their faces changed.

    Also cleans up after the change: a person left without any faces or
    manual media links is removed, and a profile face that no longer belongs
    to the person is re-selected. Returns False if the person no longer
    exists. Does not commit.
    """
    person = session.get(Person, person_id)
    if person is None:
        return False
    session.flush()
    if not person_has_appearances(session, person_id):
        remove_person(person_id, session)
        return False

    session.exec(
        text("DELETE FROM person_embeddings WHERE person_id = :pid").bindparams(
            pid=person_id
        )
    )
    centroid = compute_person_centroid(session, person_id)
    blob = vector_to_blob(centroid) if centroid is not None else None
    if blob is not None:
        session.exec(
            text(
                """
                INSERT INTO person_embeddings(person_id, embedding)
                VALUES (:pid, :emb)
                """
            ).bindparams(pid=person_id, emb=blob)
        )

    profile = person.profile_face
    if (
        person.profile_face_id is None
        or profile is None
        or (profile.person_id != person_id)
    ):
        auto_select_profile_face(session, person_id)
    return True


def set_face_embedding_person(
    session: Session, face_ids: Iterable[int], person_id: int | None
) -> None:
    """Mirror face→person assignments into the face_embeddings vec table
    (-1 means unassigned)."""
    params = [
        {"p_id": person_id if person_id is not None else -1, "f_id": fid}
        for fid in face_ids
    ]
    if params:
        session.connection().execute(
            text("UPDATE face_embeddings SET person_id=:p_id WHERE face_id=:f_id"),
            params,
        )


def delete_face_embeddings(session: Session, face_ids: Iterable[int]) -> None:
    params = [{"f_id": fid} for fid in face_ids]
    if params:
        session.connection().execute(
            text("DELETE FROM face_embeddings WHERE face_id=:f_id"), params
        )


def remove_person(person_id, session):
    """Delete a person, unassigning their faces and dropping everything that
    references them. Does not commit."""
    ensure_writable()
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    faces = session.exec(select(Face).where(Face.person_id == person_id)).all()
    for face in faces:
        face.person_id = None
        session.add(face)
    set_face_embedding_person(session, [face.id for face in faces], None)
    sql = text(
        """
        DELETE FROM person_embeddings
        WHERE person_id=:p_id
        """
    ).bindparams(p_id=person.id)
    session.exec(sql)
    session.exec(delete(PersonTagLink).where(PersonTagLink.person_id == person_id))
    session.exec(delete(TimelineEvent).where(TimelineEvent.person_id == person_id))
    session.exec(
        delete(PersonRelationship).where(
            or_(
                PersonRelationship.person_a_id == person_id,
                PersonRelationship.person_b_id == person_id,
            )
        )
    )
    session.exec(delete(PersonMediaLink).where(PersonMediaLink.person_id == person_id))
    session.delete(person)


def name_contains_all_terms(column, query: str):
    """Case-insensitive partial name match: every whitespace-separated term
    must appear somewhere in ``column`` (so "emi" matches "Emily Stone" and
    "Anna Emig", and "em st" matches "Emily Stone"). Returns None for a blank
    query."""
    terms = [t for t in query.split() if t]
    if not terms:
        return None
    clauses = []
    for term in terms:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append(column.ilike(f"%{escaped}%", escape="\\"))
    return and_(*clauses)


def merge_person_into(session: Session, source_id: int, target_id: int) -> Person:
    """Fold ``source`` into ``target``: faces, manual media links, tags,
    timeline events and relationships move over, then ``source`` is deleted.
    An unnamed target inherits the source's name. Commits."""
    if source_id == target_id:
        raise HTTPException(
            status_code=400, detail="source_id and target_id must differ"
        )

    source = session.get(Person, source_id)
    target = session.get(Person, target_id)
    if not source or not target:
        raise HTTPException(status_code=404, detail="Source or target person not found")

    session.exec(
        update(Face).where(Face.person_id == source_id).values(person_id=target_id)
    )
    session.exec(
        text(
            """
            UPDATE face_embeddings
            SET person_id = :target_id
            WHERE person_id = :source_id
            """
        ).bindparams(target_id=target_id, source_id=source_id)
    )
    session.exec(
        update(TimelineEvent)
        .where(TimelineEvent.person_id == source_id)
        .values(person_id=target_id)
    )

    source_tag_ids = set(
        session.exec(
            select(PersonTagLink.tag_id).where(PersonTagLink.person_id == source_id)
        ).all()
    )
    if source_tag_ids:
        target_tag_ids = set(
            session.exec(
                select(PersonTagLink.tag_id).where(PersonTagLink.person_id == target_id)
            ).all()
        )
        for tag_id in source_tag_ids - target_tag_ids:
            session.add(PersonTagLink(person_id=target_id, tag_id=tag_id))
    session.exec(delete(PersonTagLink).where(PersonTagLink.person_id == source_id))

    if target.profile_face_id is None and source.profile_face_id is not None:
        target.profile_face_id = source.profile_face_id
    if not (target.name or "").strip() and (source.name or "").strip():
        target.name = source.name
    target.is_favorite = bool(target.is_favorite or source.is_favorite)

    source_media_ids = set(
        session.exec(
            select(PersonMediaLink.media_id).where(
                PersonMediaLink.person_id == source_id
            )
        ).all()
    )
    if source_media_ids:
        target_media_ids = set(
            session.exec(
                select(PersonMediaLink.media_id).where(
                    PersonMediaLink.person_id == target_id
                )
            ).all()
        )
        for media_id in source_media_ids - target_media_ids:
            session.add(PersonMediaLink(person_id=target_id, media_id=media_id))
    session.exec(delete(PersonMediaLink).where(PersonMediaLink.person_id == source_id))

    relationships_to_merge = session.exec(
        select(PersonRelationship).where(
            or_(
                PersonRelationship.person_a_id == source.id,
                PersonRelationship.person_b_id == source.id,
            )
        )
    ).all()

    existing_cache: dict[tuple[int, int], PersonRelationship] = {}

    for relationship in relationships_to_merge:
        other_id = (
            relationship.person_b_id
            if relationship.person_a_id == source.id
            else relationship.person_a_id
        )

        session.delete(relationship)

        if other_id == target.id:
            continue

        new_a, new_b = sorted((target.id, other_id))
        cache_key = (new_a, new_b)

        existing = existing_cache.get(cache_key)
        if existing is None:
            existing = session.exec(
                select(PersonRelationship).where(
                    and_(
                        PersonRelationship.person_a_id == new_a,
                        PersonRelationship.person_b_id == new_b,
                    )
                )
            ).first()
            if existing:
                existing_cache[cache_key] = existing

        if existing:
            existing.coappearance_count = (existing.coappearance_count or 0) + (
                relationship.coappearance_count or 0
            )
            if relationship.updated_at and (
                existing.updated_at is None
                or relationship.updated_at > existing.updated_at
            ):
                existing.updated_at = relationship.updated_at
                existing.last_media_id = relationship.last_media_id
            elif (
                existing.last_media_id is None
                and relationship.last_media_id is not None
            ):
                existing.last_media_id = relationship.last_media_id
            continue

        new_relationship = PersonRelationship(
            person_a_id=new_a,
            person_b_id=new_b,
            coappearance_count=relationship.coappearance_count,
            last_media_id=relationship.last_media_id,
            updated_at=relationship.updated_at or datetime.utcnow(),
        )
        session.add(new_relationship)
        existing_cache[cache_key] = new_relationship

    if target.profile_face_id is None:
        auto_select_profile_face(session, target.id)

    session.delete(source)
    session.exec(
        text(
            """
            DELETE FROM person_embeddings
            WHERE person_id=:p_id
            """
        ).bindparams(p_id=source_id)
    )
    recalculate_person_appearance_counts(session, [target_id])
    rebuild_person_embedding(session, target_id)
    safe_commit(session)
    session.refresh(target)
    return target
