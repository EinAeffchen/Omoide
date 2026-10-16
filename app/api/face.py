from fastapi import (
    APIRouter,
    Body,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel
from sqlmodel import Session, select, update

from app.config import settings
from app.database import get_session, safe_commit
from app.logger import logger
from app.models import Face, Person
from app.pagination import paginate
from app.schemas.face import CursorPage, FaceAssign
from app.schemas.person import PersonMinimal
from app.utils import (
    delete_face_embeddings,
    rebuild_person_embedding,
    recalculate_person_appearance_counts,
    set_face_embedding_person,
)

router = APIRouter()


def _load_faces(session: Session, face_ids: list[int]) -> list[Face]:
    """Fetch faces in request order with one query, logging unknown ids."""
    if not face_ids:
        return []
    by_id = {
        face.id: face
        for face in session.exec(select(Face).where(Face.id.in_(face_ids))).all()
    }
    missing = [fid for fid in face_ids if fid not in by_id]
    if missing:
        logger.warning("Skipping unknown face ids: %s", missing)
    return [by_id[fid] for fid in dict.fromkeys(face_ids) if fid in by_id]


def _refresh_persons(session: Session, person_ids: set[int]) -> None:
    """Update counts and centroids of persons whose faces changed, removing
    persons that were left without any faces or media links."""
    recalculate_person_appearance_counts(session, person_ids)
    for pid in person_ids:
        rebuild_person_embedding(session, pid)


@router.post(
    "/assign",
    summary="Assign existing faces to a person",
    status_code=status.HTTP_200_OK,
)
def assign_faces(
    body: FaceAssign = Body(...),
    session: Session = Depends(get_session),
):
    new_person_id = body.person_id
    if not session.get(Person, new_person_id):
        raise HTTPException(status_code=404, detail="Person not found")

    affected_person_ids: set[int] = {new_person_id}
    moved: list[int] = []
    for face in _load_faces(session, body.face_ids):
        if face.person_id == new_person_id:
            continue
        if face.person_id is not None:
            affected_person_ids.add(face.person_id)
        face.person_id = new_person_id
        session.add(face)
        moved.append(face.id)

    set_face_embedding_person(session, moved, new_person_id)
    _refresh_persons(session, affected_person_ids)
    safe_commit(session)
    return {"message": "Faces assigned successfully"}


@router.post(
    "/detach",
    summary="Detaches existing faces from their persons",
    status_code=status.HTTP_200_OK,
)
def detach_faces(
    face_ids: list[int] = Body(..., embed=True),
    session: Session = Depends(get_session),
):
    affected_person_ids: set[int] = set()
    detached: list[int] = []
    for face in _load_faces(session, face_ids):
        if face.person_id is None:
            continue
        affected_person_ids.add(face.person_id)
        face.person_id = None
        session.add(face)
        detached.append(face.id)

    set_face_embedding_person(session, detached, None)
    _refresh_persons(session, affected_person_ids)
    safe_commit(session)
    return {"message": "Faces detached successfully"}


@router.delete(
    "/",
    summary="Delete multiple face records (and their thumbnail files)",
    status_code=status.HTTP_200_OK,
)
def delete_faces(
    face_ids: list[int] = Query(..., alias="face_ids"),
    session: Session = Depends(get_session),
):
    faces = _load_faces(session, face_ids)
    affected_person_ids = {f.person_id for f in faces if f.person_id is not None}
    thumbnails = [f.thumbnail_path for f in faces if f.thumbnail_path]
    face_ids = [f.id for f in faces]
    # Release profile-face references first; _refresh_persons re-picks one.
    session.exec(
        update(Person)
        .where(Person.profile_face_id.in_(face_ids))
        .values(profile_face_id=None)
    )
    delete_face_embeddings(session, face_ids)
    for face in faces:
        session.delete(face)
    _refresh_persons(session, affected_person_ids)
    safe_commit(session)

    # Only remove files once the rows are gone for good.
    for thumbnail_path in thumbnails:
        (settings.general.thumb_dir / thumbnail_path).unlink(missing_ok=True)
    return {"message": "Faces deleted successfully"}


class FaceCreatePerson(BaseModel):
    name: str | None = None


@router.get("/orphans", response_model=CursorPage)
def get_orphans(
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
    limit: int = 48,
):
    orphans, next_cursor = paginate(
        session,
        select(Face).where(Face.person_id.is_(None)),
        [(Face.id, False)],
        cursor=cursor,
        limit=limit,
    )
    return CursorPage(next_cursor=next_cursor, items=orphans)


@router.post(
    "/create_person",
    summary="Create a new person from multiple faces and assign",
    response_model=PersonMinimal,
    status_code=status.HTTP_201_CREATED,
)
def create_person_from_faces(
    face_ids: list[int] = Body(..., embed=True),
    name: str | None = Body(None),
    session: Session = Depends(get_session),
):
    if not face_ids:
        raise HTTPException(status_code=400, detail="No face IDs provided")

    faces = _load_faces(session, face_ids)
    if not faces:
        raise HTTPException(status_code=404, detail="No valid faces found")

    person = Person(
        name=name,
        profile_face_id=faces[0].id,
        appearance_count=len({face.media_id for face in faces}),
    )
    session.add(person)
    session.flush()
    person_id = person.id

    affected_person_ids: set[int] = {person_id}
    for face in faces:
        if face.person_id is not None:
            affected_person_ids.add(face.person_id)
        face.person_id = person_id
        session.add(face)

    set_face_embedding_person(session, [f.id for f in faces], person_id)
    _refresh_persons(session, affected_person_ids)
    safe_commit(session)
    return PersonMinimal(id=person_id)
