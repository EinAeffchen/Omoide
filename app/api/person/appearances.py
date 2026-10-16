"""Where a person appears: faces, media appearances, suggestions and export."""

from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    HTTPException,
    Query,
    Request,
    status,
)
from sqlalchemy import func, union_all
from sqlmodel import Session, delete, select, text

from app.api.media.desktop import is_local_request
from app.config import settings
from app.database import get_session, safe_commit
from app.models import Face, Media, Person, PersonMediaLink, ProcessingTask, Tag
from app.pagination import media_newest_first, paginate
from app.persons import (
    get_person_embedding,
    rebuild_person_embedding,
    recalculate_person_appearance_counts,
    set_face_embedding_person,
)
from app.schemas.face import CursorPage as FaceCursorPage
from app.schemas.person import FaceRead, MediaCursorPage, PersonMediaExportRequest
from app.tasks import create_and_run_task
from app.tasks.export import run_person_media_export
from app.vectors import distance_to_similarity

router = APIRouter()


@router.get("/{person_id}/suggest-faces", response_model=list[FaceRead])
def suggest_faces(
    person_id: int,
    limit: int = Query(default=100, ge=10, le=300),
    session: Session = Depends(get_session),
):
    # 1) must exist
    if not session.get(Person, person_id):
        raise HTTPException(404, "Person not found")

    # 2) get the person’s average embedding
    target = get_person_embedding(session, person_id)
    if target is None:
        return []
    sql = text(
        """
            SELECT face_id, distance
              FROM face_embeddings
             WHERE embedding MATCH :vec
                    and k = :k
                    and person_id = -1
                    and distance < 1.3
             ORDER BY distance
            """
    ).bindparams(vec=target, k=limit)
    rows = session.exec(sql).all()
    face_ids = [r[0] for r in rows]
    distance_map = {int(row[0]): float(row[1]) for row in rows if row[1] is not None}

    faces = session.exec(select(Face).where(Face.id.in_(face_ids))).all()
    id_map = {f.id: f for f in faces}
    ordered = [id_map[f] for f in face_ids if f in id_map]

    face_return = []
    for f in ordered:
        if dist := distance_map.get(f.id):
            similarity = distance_to_similarity(dist)
            face_return.append(
                FaceRead(
                    id=f.id,
                    media_id=f.media_id,
                    thumbnail_path=f.thumbnail_path,
                    similarity=similarity,
                )
            )
    return face_return


@router.post("/{person_id}/media/{media_id}/detach", status_code=200)
def detach_media_from_person(
    person_id: int, media_id: int, session: Session = Depends(get_session)
):
    """Detach all faces linking this person to this media, and remove any manual PersonMediaLink."""
    faces = session.exec(
        select(Face).where(Face.person_id == person_id, Face.media_id == media_id)
    ).all()

    for face in faces:
        face.person_id = None
        session.add(face)
    set_face_embedding_person(session, [face.id for face in faces], None)

    link = session.exec(
        select(PersonMediaLink).where(
            PersonMediaLink.person_id == person_id, PersonMediaLink.media_id == media_id
        )
    ).first()
    if link:
        session.delete(link)

    recalculate_person_appearance_counts(session, {person_id})
    rebuild_person_embedding(session, person_id)
    safe_commit(session)
    return {"message": "Media detached from person"}


@router.get("/{person_id}/faces", response_model=FaceCursorPage)
def get_faces(
    person_id: int,
    session: Session = Depends(get_session),
    cursor: str | None = Query(None),
    sort_by: str = Query("id_desc"),
    media_id: int | None = Query(None),
    limit: int = 10,
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if media_id is not None:
        faces = session.exec(
            select(Face).where(Face.person_id == person_id, Face.media_id == media_id)
        ).all()
        return FaceCursorPage(next_cursor=None, items=faces)

    if sort_by in ("date_desc", "date_asc"):
        ascending = sort_by == "date_asc"
        q = (
            select(Face)
            .join(Media, Face.media_id == Media.id)
            .where(Face.person_id == person_id)
        )
        keys = [(Media.created_at, ascending), (Face.id, ascending)]
    else:
        q = select(Face).where(Face.person_id == person_id)
        keys = [(Face.id, False)]
    faces, next_cursor = paginate(
        session, q, keys, cursor=cursor, limit=limit, tag=sort_by
    )

    return FaceCursorPage(next_cursor=next_cursor, items=faces)


@router.get("/{person_id}/media-appearances", response_model=MediaCursorPage)
def get_appearances(
    person_id: int,
    with_person_ids: list[int] = Query(
        [], description="Filter for media that also includes these person IDs"
    ),
    tags: list[str] | None = Query(
        None, description="Filter by tag name(s), comma-separated"
    ),
    limit: int = 30,
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    all_required_ids = list(set([person_id] + with_person_ids))
    required_ids_count = len(all_required_ids)

    appearance_pairs = union_all(
        select(
            Face.person_id.label("person_id"), Face.media_id.label("media_id")
        ).where(Face.person_id.in_(all_required_ids)),
        select(
            PersonMediaLink.person_id.label("person_id"),
            PersonMediaLink.media_id.label("media_id"),
        ).where(PersonMediaLink.person_id.in_(all_required_ids)),
    ).subquery()

    media_id_q = (
        select(appearance_pairs.c.media_id)
        .group_by(appearance_pairs.c.media_id)
        .having(
            func.count(func.distinct(appearance_pairs.c.person_id))
            == required_ids_count
        )
    )
    q = select(Media).where(Media.id.in_(media_id_q))
    if tags:
        tag_media_ids = (
            select(Media.id).join(Media.tags).where(Tag.name.in_(tags)).distinct()
        )
        q = q.where(Media.id.in_(tag_media_ids))

    items, next_cursor = paginate(
        session, q, media_newest_first(), cursor=cursor, limit=limit
    )

    return MediaCursorPage(next_cursor=next_cursor, items=items)


@router.post("/{person_id}/export-media", response_model=ProcessingTask)
def export_person_media(
    person_id: int,
    export: PersonMediaExportRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    """Start a background task copying or moving each unique original
    containing this person's appearance."""
    if settings.general.is_docker:
        raise HTTPException(
            status_code=400,
            detail="Exporting media is only available in the desktop app.",
        )
    if not settings.general.is_binary and not is_local_request(request):
        raise HTTPException(
            status_code=400,
            detail="Exporting media is only allowed in the desktop app or local session.",
        )

    if not session.get(Person, person_id):
        raise HTTPException(status_code=404, detail="Person not found")

    try:
        destination_dir = (
            Path(export.destination_path).expanduser().resolve(strict=True)
        )
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=400, detail="Selected folder does not exist"
        ) from exc
    if not destination_dir.is_dir():
        raise HTTPException(status_code=400, detail="Selected path is not a folder")

    # create_and_run_task would hand back a running export for a different
    # person or folder, so refuse instead of silently reusing it.
    if session.exec(
        select(ProcessingTask.id).where(
            ProcessingTask.task_type == "export_person_media",
            ProcessingTask.status == "running",
        )
    ).first():
        raise HTTPException(
            status_code=409, detail="Another media export is still running."
        )

    return create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="export_person_media",
        callable_task=lambda task_id: run_person_media_export(
            task_id, person_id, destination_dir, export.mode
        ),
    )


@router.post(
    "/{person_id}/media",
    summary="Manually attach media to a person when no face is detected",
    status_code=status.HTTP_200_OK,
)
def add_media_appearance(
    person_id: int,
    media_id: int = Body(..., embed=True),
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    has_detected_face = session.exec(
        select(Face.id).where(Face.person_id == person_id, Face.media_id == media_id)
    ).first()
    if has_detected_face:
        session.exec(
            delete(PersonMediaLink).where(
                PersonMediaLink.person_id == person_id,
                PersonMediaLink.media_id == media_id,
            )
        )
        recalculate_person_appearance_counts(session, [person_id])
        safe_commit(session)
        return {"person_id": person_id, "media_id": media_id, "added": False}

    existing_link = session.exec(
        select(PersonMediaLink).where(
            PersonMediaLink.person_id == person_id, PersonMediaLink.media_id == media_id
        )
    ).first()
    if existing_link:
        return {"person_id": person_id, "media_id": media_id, "added": False}

    session.add(PersonMediaLink(person_id=person_id, media_id=media_id))
    recalculate_person_appearance_counts(session, [person_id])
    safe_commit(session)
    return {"person_id": person_id, "media_id": media_id, "added": True}
