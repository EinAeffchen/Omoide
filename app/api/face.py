from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel
from sqlalchemy import or_
from sqlmodel import Session, delete, select, text

from app.config import settings
from app.database import get_session, safe_commit, safe_execute
from app.logger import logger
from app.models import Face, Person, PersonMediaLink, PersonRelationship, PersonTagLink
from app.schemas.face import CursorPage, FaceAssign
from app.schemas.person import PersonMinimal
from app.utils import (
    recalculate_person_appearance_counts,
    update_person_embedding,
)

router = APIRouter()


@router.post(
    "/assign",
    summary="Assign existing faces to a person",
    status_code=status.HTTP_200_OK,
)
async def assign_faces(
    body: FaceAssign = Body(...),
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    new_person_id = body.person_id
    new_person = session.get(Person, new_person_id)
    if not new_person:
        raise HTTPException(status_code=404, detail="Person not found")

    affected_person_ids: set[int] = set()
    if new_person_id is not None:
        affected_person_ids.add(new_person_id)

    for face_id in body.face_ids:
        face = session.get(Face, face_id)
        if not face:
            logger.warning(f"Face with ID {face_id} not found, skipping assignment.")
            continue

        original_person_id = face.person_id
        if original_person_id == new_person_id:
            continue
        if original_person_id is not None:
            affected_person_ids.add(original_person_id)

        face.person = new_person
        session.add(face)

        if original_person_id and original_person_id != body.person_id:
            old_person_can_be_deleted(session, original_person_id)
        update_face_embedding(session, face_id, new_person_id)

    recalculate_person_appearance_counts(session, affected_person_ids)
    if new_person_id and new_person_id > 0:
        update_person_embedding(session, new_person_id)
    safe_commit(session)
    return {"message": "Faces assigned successfully"}


@router.post(
    "/detach",
    summary="Detaches existing faces from their persons",
    status_code=status.HTTP_200_OK,
)
async def detach_faces(
    face_ids: list[int] = Body(..., embed=True),
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )

    affected_person_ids: set[int] = set()

    for face_id in face_ids:
        face = session.get(Face, face_id)
        if not face:
            logger.warning(f"Face with ID {face_id} not found, skipping detachment.")
            continue

        person_id = face.person_id
        if person_id:
            affected_person_ids.add(person_id)

        face.person_id = None
        session.add(face)

        if person_id:
            old_person_can_be_deleted(session, person_id)
        update_face_embedding(
            session, face_id, -1
        )  # -1 detaches face from person in embedding table
        # update embedding of person to fix suggested faces after detach
    recalculate_person_appearance_counts(session, affected_person_ids)
    for pid in affected_person_ids:
        if session.get(Person, pid):
            update_person_embedding(session, pid)
    safe_commit(session)
    return {"message": "Faces detached successfully"}


def update_face_embedding(
    session: Session,
    face_id: int,
    person_id: int | None,
    delete_face: bool = False,
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    if not delete_face and person_id:
        sql = text(
            """
            UPDATE face_embeddings
            set person_id=:p_id
            WHERE face_id=:f_id
            """
        ).bindparams(p_id=person_id, f_id=face_id)
    else:
        sql = text(
            """DELETE FROM face_embeddings
                   WHERE face_id=:f_id"""
        ).bindparams(f_id=face_id)
    safe_execute(session, sql)


@router.delete(
    "/",
    summary="Delete multiple face records (and their thumbnail files)",
    status_code=status.HTTP_200_OK,
)
def delete_faces(
    face_ids: list[int] = Query(..., alias="face_ids"),
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    affected_person_ids: set[int] = set()
    for face_id in face_ids:
        face = session.get(Face, face_id)
        if not face:
            logger.warning(f"Face with ID {face_id} not found, skipping deletion.")
            continue

        # remove thumbnail from disk
        thumb = settings.general.thumb_dir / face.thumbnail_path
        if thumb.exists():
            thumb.unlink()

        if person := face.person:
            person_id = face.person.id
            affected_person_ids.add(person_id)
        else:
            person_id = None
        session.delete(face)

        update_face_embedding(session, face_id, person_id, delete_face=True)
        if person_id:
            old_person_can_be_deleted(session, person_id)
    recalculate_person_appearance_counts(session, affected_person_ids)
    for pid in affected_person_ids:
        if session.get(Person, pid):
            update_person_embedding(session, pid)
    safe_commit(session)
    return {"message": "Faces deleted successfully"}


class FaceCreatePerson(BaseModel):
    name: str | None = None


@router.get("/orphans", response_model=CursorPage)
def get_orphans(
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or `2500_1234`"
        ),
    ),
    limit: int = 48,
):
    before_id = None
    if cursor:
        before_id = int(cursor)
    query = select(Face).where(Face.person_id.is_(None)).order_by(Face.id.desc())
    if before_id:
        query = query.where(Face.id < before_id)
    orphans = safe_execute(session, query.limit(limit)).all()

    if len(orphans) == limit:
        next_cursor = str(orphans[-1].id)
    else:
        next_cursor = None
    return CursorPage(next_cursor=next_cursor, items=orphans)


@router.post(
    "/create_person",
    summary="Create a new person from multiple faces and assign",
    response_model=PersonMinimal,
    status_code=status.HTTP_201_CREATED,
)
async def create_person_from_faces(
    face_ids: list[int] = Body(..., embed=True),
    name: str | None = Body(None),
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    if not face_ids:
        raise HTTPException(status_code=400, detail="No face IDs provided")

    faces = []
    for face_id in face_ids:
        face = session.get(Face, face_id)
        if not face:
            logger.warning(f"Face with ID {face_id} not found, skipping.")
            continue
        faces.append(face)

    if not faces:
        raise HTTPException(status_code=404, detail="No valid faces found")

    media_ids = {face.media_id for face in faces}

    # Create the Person
    person = Person(
        name=name,
        profile_face_id=faces[0].id,  # Set profile to the first face
        appearance_count=len(media_ids),
    )
    session.add(person)
    session.flush()
    person_id = person.id

    previous_person_ids: set[int] = set()
    for face in faces:
        previous_person = face.person
        face.person_id = person_id
        session.add(face)
        if previous_person and previous_person.id != person_id:
            previous_person_ids.add(previous_person.id)
            old_person_can_be_deleted(session, previous_person.id)
        update_face_embedding(session, face.id, person_id)
    target_person_ids = set(previous_person_ids)
    target_person_ids.add(person_id)
    recalculate_person_appearance_counts(session, target_person_ids)
    if person_id:
        update_person_embedding(session, person_id)
    safe_commit(session)
    session.close()
    return PersonMinimal(id=person_id)


def old_person_can_be_deleted(session: Session, person_id: int | None):
    if person_id is None:
        return True
    remaining = safe_execute(
        session, select(Face).where(Face.person_id == person_id)
    ).first()
    if remaining:
        return False
    remaining_manual_link = safe_execute(
        session,
        select(PersonMediaLink).where(PersonMediaLink.person_id == person_id),
    ).first()
    if remaining_manual_link:
        return False

    # delete any tag links
    safe_execute(
        session,
        delete(PersonTagLink).where(PersonTagLink.person_id == person_id),
    )
    person = session.get(Person, person_id)
    session.exec(
        delete(PersonRelationship).where(
            or_(
                PersonRelationship.person_a_id == person_id,
                PersonRelationship.person_b_id == person_id,
            )
        )
    )
    session.delete(person)
    safe_commit(session)
    return True
