from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import delete
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session, safe_commit
from app.models import Media, MediaTagLink, Person, PersonTagLink, Tag
from app.schemas.tag import CursorPage, TagRead

router = APIRouter()


@router.get("/", response_model=CursorPage)
def list_tags(
    limit: int = 50,
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<value>_<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or"
            " `2500_1234`"
        ),
    ),
    session: Session = Depends(get_session),
):
    before_id = None
    if cursor:
        before_id = int(cursor)
    query = (
        select(Tag)
        .options(selectinload(Tag.media))
        .order_by(Tag.id.desc())
        .limit(limit)
    )
    if before_id:
        query = query.where(Tag.id < before_id)
    results = session.exec(query).all()
    if len(results) == limit:
        next_cursor = str(results[-1].id)
    else:
        next_cursor = None
    return CursorPage(next_cursor=next_cursor, items=results)


def get_or_create_tag(name: str, session: Session) -> Tag:
    name = name.lower()
    tag = session.exec(select(Tag).where(Tag.name == name)).first()
    if not tag:
        tag = Tag(name=name)
        session.add(tag)
        safe_commit(session)
        session.refresh(tag)
    return tag


def attach_tag_to_media(
    media_id: int,
    tag_id: int,
    session: Session,
    score: float | None = None,
) -> None:
    # avoid dupes
    # ensure both exist
    if not session.get(Media, media_id):
        raise HTTPException(404, "Media not found")
    if not session.get(Tag, tag_id):
        raise HTTPException(404, "Tag not found")
    if session.exec(
        select(MediaTagLink).where(
            MediaTagLink.tag_id == tag_id, MediaTagLink.media_id == media_id
        )
    ).first():
        return
    link = MediaTagLink(media_id=media_id, tag_id=tag_id, auto_score=score)
    session.add(link)
    safe_commit(session)


@router.post("/", response_model=Tag, status_code=status.HTTP_201_CREATED)
def create_tag(
    *,
    name: str = Body(..., embed=True),
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    tag = get_or_create_tag(name, session)
    return tag


@router.get("/{tag_id}", response_model=TagRead)
def get_tag(tag_id: int, session: Session = Depends(get_session)):
    tag = session.get(Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    # relationships media & persons auto‑loaded
    return tag


# Assign / remove on Media
@router.post("/media/{media_id}/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_tag_to_media(
    media_id: int, tag_id: int, session: Session = Depends(get_session)
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    attach_tag_to_media(media_id, tag_id, session)


@router.delete("/media/{media_id}/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag_from_media(
    media_id: int, tag_id: int, session: Session = Depends(get_session)
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    session.exec(
        delete(MediaTagLink).where(
            MediaTagLink.media_id == media_id, MediaTagLink.tag_id == tag_id
        )
    )
    safe_commit(session)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag(tag_id: int, session: Session = Depends(get_session)):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    session.exec(delete(MediaTagLink).where(MediaTagLink.tag_id == tag_id))
    session.exec(delete(Tag).where(Tag.id == tag_id))
    safe_commit(session)


# Assign / remove on Person
@router.post("/person/{person_id}/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def add_tag_to_person(
    person_id: int, tag_id: int, session: Session = Depends(get_session)
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found")
    if not session.get(Tag, tag_id):
        raise HTTPException(404, "Tag not found")
    link = PersonTagLink(person_id=person_id, tag_id=tag_id)
    session.add(link)
    safe_commit(session)


@router.delete("/person/{person_id}/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_tag_from_person(
    person_id: int, tag_id: int, session: Session = Depends(get_session)
):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    session.exec(
        delete(PersonTagLink).where(
            PersonTagLink.person_id == person_id,
            PersonTagLink.tag_id == tag_id,
        )
    )
    safe_commit(session)
