from typing import Literal

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import (
    ColumnElement,
    case,
    func,
    union_all,
)
from sqlmodel import Session, distinct, select

from app.config import settings
from app.database import get_session, safe_commit
from app.logger import logger
from app.models import (
    Face,
    Person,
    PersonMediaLink,
)
from app.pagination import paginate
from app.persons import (
    auto_select_profile_face,
    name_contains_all_terms,
    remove_person,
)
from app.schemas.media import FavoriteUpdate
from app.schemas.person import (
    CursorPage,
    FaceRead,
    PersonBulkDeleteRequest,
    PersonBulkDeleteResponse,
    PersonDetail,
    PersonRead,
    PersonUpdate,
    ProfileFace,
)

router = APIRouter()


PersonSort = Literal[
    "appearances_desc",
    "appearances_asc",
    "name_asc",
    "name_desc",
    "views_desc",
    "favorites",
    "newest",
    "oldest",
]


def _person_sort_keys(sort: PersonSort) -> list[tuple[ColumnElement, bool]]:
    """Ordered (expression, ascending) keys for a person sort. Every key list
    ends with Person.id so the ordering is total and keyset-paginatable."""
    appearances = func.coalesce(Person.appearance_count, 0)
    if sort == "appearances_asc":
        return [(appearances, True), (Person.id, True)]
    if sort in ("name_asc", "name_desc"):
        ascending = sort == "name_asc"
        name = func.trim(func.coalesce(Person.name, ""))
        # Unnamed people always go last, regardless of direction.
        unnamed = case((name == "", 1), else_=0)
        return [
            (unnamed, True),
            (func.lower(name), ascending),
            (Person.id, ascending),
        ]
    if sort == "views_desc":
        return [
            (func.coalesce(Person.views, 0), False),
            (appearances, False),
            (Person.id, False),
        ]
    if sort == "favorites":
        return [
            (case((Person.is_favorite.is_(True), 1), else_=0), False),
            (appearances, False),
            (Person.id, False),
        ]
    if sort == "newest":
        return [(Person.id, False)]
    if sort == "oldest":
        return [(Person.id, True)]
    return [(appearances, False), (Person.id, False)]


@router.get("/", response_model=CursorPage)
def list_persons(
    name: str | None = Query(
        None, description="Filter by partial match on name (all terms must match)"
    ),
    sort: PersonSort = Query("appearances_desc", description="Sort order"),
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
    limit: int = 50,
    session: Session = Depends(get_session),
):
    q = select(Person)
    if name:
        name_clause = name_contains_all_terms(Person.name, name)
        if name_clause is not None:
            q = q.where(name_clause)

    persons, next_cursor = paginate(
        session, q, _person_sort_keys(sort), cursor=cursor, limit=limit, tag=sort
    )
    items = [
        PersonRead(
            **person.model_dump(),
            profile_face=(
                FaceRead(**person.profile_face.model_dump())
                if person.profile_face
                else None
            ),
        )
        for person in persons
    ]
    return CursorPage(next_cursor=next_cursor, items=items)


@router.get("/{person_id}", response_model=PersonDetail)
def get_person(person_id: int, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    profile_face = person.profile_face
    if person.profile_face_id and not profile_face:
        # Self-heal a dangling profile face, except in read-only mode.
        if not settings.general.presentation_mode:
            person.profile_face_id = None
            session.add(person)
            safe_commit(session)
            session.refresh(person)
    media_ids_union = union_all(
        select(Face.media_id.label("media_id")).where(Face.person_id == person_id),
        select(PersonMediaLink.media_id.label("media_id")).where(
            PersonMediaLink.person_id == person_id
        ),
    ).subquery()
    media_count = session.scalar(
        select(func.count(distinct(media_ids_union.c.media_id)))
    )
    if profile_face:
        profile_face = ProfileFace(
            id=profile_face.id,
            thumbnail_path=profile_face.thumbnail_path,
        )
    return PersonDetail(
        id=person.id,
        name=person.name,
        profile_face_id=profile_face.id if profile_face else None,
        profile_face=profile_face,
        tags=person.tags,
        appearance_count=int(media_count or 0),
        is_favorite=bool(person.is_favorite),
    )


@router.patch(
    "/{person_id}",
    response_model=Person,
    summary="Update a person's details",
)
def update_person(
    person_id: int,
    data: PersonUpdate,
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    updates = data.model_dump(exclude_unset=True)
    for key, val in updates.items():
        setattr(person, key, val)
    session.add(person)
    safe_commit(session)
    session.refresh(person)
    return person


@router.patch("/{person_id}/favorite", response_model=PersonRead)
def update_person_favorite(
    person_id: int,
    data: FavoriteUpdate,
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    person.is_favorite = data.is_favorite
    session.add(person)
    safe_commit(session)
    session.refresh(person)
    return PersonRead.model_validate(person)


@router.post(
    "/{person_id}/profile_face/auto",
    response_model=Person,
)
def auto_profile_face(
    person_id: int,
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    auto_select_profile_face(session, person_id)
    safe_commit(session)
    session.refresh(person)
    return person


@router.post(
    "/bulk-delete",
    response_model=PersonBulkDeleteResponse,
    summary="Delete multiple persons and their related data",
)
def delete_persons_bulk(
    payload: PersonBulkDeleteRequest,
    session: Session = Depends(get_session),
):
    deleted_ids: list[int] = []
    skipped_ids: list[int] = []
    seen: set[int] = set()

    for person_id in payload.person_ids:
        if person_id in seen:
            continue
        seen.add(person_id)

        try:
            remove_person(person_id, session)
            safe_commit(session)
            deleted_ids.append(person_id)
            session.expire_all()
        except HTTPException as exc:
            if exc.status_code == status.HTTP_403_FORBIDDEN:
                raise
            session.rollback()
            skipped_ids.append(person_id)
            logger.warning(
                "Skipping deletion of person %s due to API error: %s",
                person_id,
                exc.detail,
            )
        except Exception:  # pragma: no cover - defensive
            session.rollback()
            skipped_ids.append(person_id)
            logger.exception("Unexpected error while deleting person %s", person_id)

    return PersonBulkDeleteResponse(
        deleted_ids=deleted_ids,
        skipped_ids=skipped_ids,
    )


@router.delete(
    "/{person_id}",
    summary="Delete a person and all their faces",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_person(person_id: int, session: Session = Depends(get_session)):
    remove_person(person_id, session)
    safe_commit(session)