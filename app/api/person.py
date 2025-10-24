from collections import deque
from datetime import date, datetime

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from sqlalchemy import (
    and_,
    desc,
    func,
    literal_column,
    or_,
    tuple_,
    union_all,
)
from sqlmodel import Session, delete, distinct, select, text, update

from app.config import settings
from app.database import get_session, safe_commit, safe_execute
from app.logger import logger
from app.models import (
    Face,
    Media,
    Person,
    PersonRelationship,
    PersonTagLink,
    TimelineEvent,
)
from app.schemas.face import CursorPage as FaceCursorPage
from app.schemas.person import (
    CursorPage,
    FaceRead,
    MediaCursorPage,
    MergePersonsBulkRequest,
    MergePersonsRequest,
    MergePersonsResult,
    PersonDetail,
    PersonRead,
    PersonReadSimple,
    PersonBulkDeleteRequest,
    PersonBulkDeleteResponse,
    PersonUpdate,
    ProfileFace,
    RelationshipEdge,
    RelationshipGraph,
    RelationshipNode,
    SimilarPerson,
)
from app.schemas.timeline import (
    TimelineEventCreate,
    TimelineEventUpdate,
    TimelinePage,
)
from app.utils import (
    _distance_to_similarity,
    auto_select_profile_face,
    get_person_embedding,
    recalculate_person_appearance_counts,
    remove_person,
    update_person_embedding,
)

router = APIRouter()


# Timeline events
@router.get("/{person_id}/timeline", response_model=TimelinePage)
def get_person_timeline(
    person_id: int,
    session: Session = Depends(get_session),
    cursor: str | None = None,
    limit: int = 1000,
):
    media_ids_subquery = (
        select(Face.media_id).where(Face.person_id == person_id).distinct()
    )
    media_query = (
        select(
            Media.id.label("item_id"),
            func.date(Media.created_at).label("timeline_date"),
            literal_column("'media'").label("item_type"),
        )
        .where(Media.id.in_(media_ids_subquery))
        .where(Media.created_at.is_not(None))
    )

    # Subquery for one-time TimelineEvent items
    events_query = (
        select(
            TimelineEvent.id.label("item_id"),
            TimelineEvent.event_date.label("timeline_date"),
            literal_column("'event'").label("item_type"),
        )
        .where(TimelineEvent.person_id == person_id)
        .where(TimelineEvent.recurrence.is_(None))
    )

    timeline_cte = union_all(media_query, events_query).cte("timeline")

    final_query = select(
        timeline_cte.c.item_id,
        timeline_cte.c.timeline_date.label("timeline_date"),
        timeline_cte.c.item_type,
    )
    if cursor:
        try:
            cursor_date = date.fromisoformat(cursor)
            final_query = final_query.where(timeline_cte.c.timeline_date < cursor_date)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Invalid cursor format. Use YYYY-MM-DD.",
            )

    final_query = final_query.order_by(timeline_cte.c.timeline_date.desc()).limit(
        limit + 1
    )

    page_items_result = session.exec(final_query).all()

    has_next_page = len(page_items_result) > limit
    page_items = page_items_result[:limit]

    next_cursor = str(page_items[-1].timeline_date) if has_next_page else None

    if not page_items:
        return {"items": [], "next_cursor": None}

    page_min_date = date.fromisoformat(page_items[-1].timeline_date)
    page_max_date = date.fromisoformat(page_items[0].timeline_date)

    media_ids_to_fetch = [
        item.item_id for item in page_items if item.item_type == "media"
    ]
    event_ids_to_fetch = [
        item.item_id for item in page_items if item.item_type == "event"
    ]

    media_on_page = session.exec(
        select(Media).where(Media.id.in_(media_ids_to_fetch))
    ).all()
    events_on_page = session.exec(
        select(TimelineEvent).where(TimelineEvent.id.in_(event_ids_to_fetch))
    ).all()

    media_map = {m.id: m for m in media_on_page}
    event_map = {e.id: e for e in events_on_page}

    combined_items = []
    for item in page_items:
        if item.item_type == "media":
            combined_items.append(media_map.get(item.item_id))
        elif item.item_type == "event":
            combined_items.append(event_map.get(item.item_id))

    combined_items = [i for i in combined_items if i]

    recurring_events = session.exec(
        select(TimelineEvent).where(
            TimelineEvent.person_id == person_id,
            TimelineEvent.recurrence == "yearly",
        )
    ).all()

    for event in recurring_events:
        for year in range(page_min_date.year, page_max_date.year + 1):
            try:
                occurrence_date = event.event_date.replace(year=year)
                if page_min_date <= occurrence_date <= page_max_date:
                    event_data = event.model_dump()
                    event_data["event_date"] = occurrence_date
                    event_occurrence = TimelineEvent.model_validate(event_data)
                    combined_items.append(event_occurrence)
            except ValueError:
                continue

    def get_date(item: Media | TimelineEvent) -> date:
        return item.created_at.date() if isinstance(item, Media) else item.event_date

    combined_items.sort(key=get_date, reverse=True)

    timeline_items = []
    for item in combined_items:
        if isinstance(item, Media):
            timeline_items.append(
                {
                    "type": "media",
                    "date": get_date(item),
                    "items": item,
                }
            )
        elif isinstance(item, TimelineEvent):
            timeline_items.append(
                {
                    "type": "event",
                    "date": get_date(item),
                    "event": item,
                }
            )

    return {"items": timeline_items, "next_cursor": next_cursor}


@router.post("/{person_id}/events", response_model=TimelineEvent)
def create_person_event(
    person_id: int,
    event: TimelineEventCreate,
    session: Session = Depends(get_session),
):
    """Create a new timeline event for a specific person."""
    db_event = TimelineEvent.model_validate(event, update={"person_id": person_id})
    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


@router.put("/{person_id}/events/{event_id}", response_model=TimelineEvent)
def update_person_event(
    person_id: int,  # Included for RESTful consistency, though not strictly needed for the query
    event_id: int,
    event_update: TimelineEventUpdate,
    session: Session = Depends(get_session),
):
    """Update an existing timeline event."""
    db_event = session.get(TimelineEvent, event_id)
    if not db_event or db_event.person_id != person_id:
        raise HTTPException(status_code=404, detail="Event not found")

    update_data = event_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_event, key, value)

    session.add(db_event)
    session.commit()
    session.refresh(db_event)
    return db_event


@router.delete("/{person_id}/events/{event_id}", status_code=204)
def delete_person_event(
    person_id: int, event_id: int, session: Session = Depends(get_session)
):
    """Delete a timeline event."""
    db_event = session.get(TimelineEvent, event_id)
    if db_event and db_event.person_id == person_id:
        session.delete(db_event)
        session.commit()
    return {"ok": True}  # Return nothing on 204


@router.get("/", response_model=CursorPage)
def list_persons(
    name: str | None = Query(None, description="Filter by substring match on name"),
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or `2500_1234`"
        ),
    ),
    limit: int = 50,
    session: Session = Depends(get_session),
):
    before_count = None
    before_id = None
    if cursor:
        try:
            count, raw_id = cursor.split("_")
            before_count = int(count)
            before_id = int(raw_id)
        except (ValueError, TypeError):
            raise HTTPException(400, "Invalid cursor format")

    q = select(Person)

    if name:
        q = q.where(Person.name.ilike(f"%{name}%"))

    if cursor and before_id is not None and before_count is not None:
        q = q.where(
            or_(
                Person.appearance_count < before_count,
                and_(
                    Person.appearance_count == before_count,
                    Person.id < before_id,
                ),
            )
        )

    q = q.order_by(Person.appearance_count.desc(), Person.id.desc())
    q = q.limit(limit)
    people_with_counts = session.exec(q).all()
    items = [
        PersonRead(
            **person.model_dump(),
            profile_face=(
                FaceRead(**person.profile_face.model_dump())
                if person.profile_face
                else None
            ),
        )
        for person in people_with_counts
    ]

    next_cursor = None
    if len(items) == limit:
        last_person = people_with_counts[-1]
        next_cursor = f"{last_person.appearance_count}_{last_person.id}"

    return CursorPage(next_cursor=next_cursor, items=items)


@router.get("/{person_id}/suggest-faces", response_model=list[FaceRead])
def suggest_faces(
    person_id: int, limit: int = 20, session: Session = Depends(get_session)
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
            similarity = _distance_to_similarity(dist)
            face_return.append(
                FaceRead(
                    id=f.id,
                    media_id=f.media_id,
                    thumbnail_path=f.thumbnail_path,
                    similarity=similarity,
                )
            )
    return face_return


@router.get("/{person_id}/faces", response_model=FaceCursorPage)
def get_faces(
    person_id: int,
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None,
        description="encoded as `<id>`; e.g. `1234`",
    ),
    limit: int = 10,
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    before_id = None
    if cursor:
        before_id = int(cursor)
    q = select(Face).where(Face.person_id == person.id).order_by(Face.id.desc())
    if before_id:
        q = q.where(Face.id < before_id)

    faces = safe_execute(session, q.limit(limit)).all()
    if len(faces) == limit:
        next_cursor = str(faces[-1].id)
    else:
        next_cursor = None

    return FaceCursorPage(next_cursor=next_cursor, items=faces)


@router.get("/all-simple", response_model=list[PersonReadSimple])
def get_all_persons_simple(session: Session = Depends(get_session)):
    """Returns a lightweight list of all persons for filter selections."""
    people = session.exec(select(Person).order_by(Person.name)).all()
    return [PersonReadSimple.model_validate(p) for p in people]


@router.get("/{person_id}/media-appearances", response_model=MediaCursorPage)
def get_appearances(
    person_id: int,
    with_person_ids: list[int] = Query(
        [], description="Filter for media that also includes these person IDs"
    ),
    limit: int = 30,
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or `2500_1234`"
        ),
    ),
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    all_required_ids = list(set([person_id] + with_person_ids))
    required_ids_count = len(all_required_ids)

    media_id_q = (
        select(Face.media_id)
        .where(Face.person_id.in_(all_required_ids))
        .group_by(Face.media_id)
        .having(func.count(func.distinct(Face.person_id)) == required_ids_count)
    )
    matching_media_ids = session.exec(media_id_q).all()

    if not matching_media_ids:
        return CursorPage(items=[], next_cursor=None)

    q = (
        select(Media)
        .where(Media.id.in_(matching_media_ids))
        .order_by(Media.created_at.desc())
    )

    if cursor:
        try:
            created_at_str, media_id_str = cursor.rsplit("_", 1)
            logger.debug(cursor)
            logger.debug(created_at_str)
            cursor_created_at = datetime.fromisoformat(created_at_str)
            cursor_media_id = int(media_id_str)
            q = q.where(
                tuple_(Media.created_at, Media.id)
                < (cursor_created_at, cursor_media_id)
            )
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid cursor format")

    q = q.order_by(desc(Media.created_at), desc(Media.id)).limit(limit)

    items = session.exec(q).all()

    next_cursor = None
    if len(items) == limit:
        last_item = items[-1]
        next_cursor = f"{last_item.created_at.isoformat()}_{last_item.id}"

    return MediaCursorPage(next_cursor=next_cursor, items=items)


@router.get("/{person_id}", response_model=PersonDetail)
def get_person(person_id: int, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    if person.profile_face_id and not person.profile_face:
        person.profile_face_id = None
        session.add(person)
        session.commit()
        session.refresh(person)
    stmt = (
        select(func.count(distinct(Media.id)))
        .join_from(Person, Face, Face.person_id == Person.id)
        .join_from(Face, Media, Face.media_id == Media.id)
        .where(Person.id == person_id)
    )
    media_count = session.scalar(stmt)
    if person.profile_face:
        profile_face = ProfileFace(
            id=person.profile_face.id,
            thumbnail_path=person.profile_face.thumbnail_path,
        )
    else:
        profile_face = None
    return PersonDetail(
        id=person.id,
        name=person.name,
        profile_face_id=person.profile_face_id,
        profile_face=profile_face,
        tags=person.tags,
        appearance_count=media_count,
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
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )
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


@router.post("/{person_id}/profile_face", response_model=Person)
def set_profile_face(
    person_id: int,
    face_id: int | None,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    person.profile_face_id = face_id
    session.add(person)
    safe_commit(session)
    session.refresh(person)
    return person


@router.post(
    "/{person_id}/profile_face/auto",
    response_model=Person,
)
def auto_profile_face(
    person_id: int,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    auto_select_profile_face(session, person_id)
    safe_commit(session)
    session.refresh(person)
    return person


def _merge_person_into_target(
    session: Session, source_id: int, target_id: int
) -> Person:
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
    safe_commit(session)

    update_person_embedding(session, target_id)
    session.exec(
        text(
            """
            DELETE FROM person_embeddings
            WHERE person_id=:p_id
            """
        ).bindparams(p_id=source_id)
    )
    recalculate_person_appearance_counts(session, [target_id])
    safe_commit(session)
    session.refresh(target)
    return target


@router.post(
    "/merge",
    summary="Merge one person into another",
    status_code=status.HTTP_200_OK,
)
def merge_persons(
    body: MergePersonsRequest,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )
    merged = _merge_person_into_target(session, body.source_id, body.target_id)
    return merged


@router.post(
    "/{person_id}/merge-multiple",
    response_model=MergePersonsResult,
    summary="Merge multiple persons into the specified person",
)
def merge_multiple_persons(
    person_id: int,
    request: MergePersonsBulkRequest,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )
    merged_ids: list[int] = []
    skipped_ids: list[int] = []
    seen: set[int] = set()
    for source_id in request.source_ids:
        if source_id in seen:
            continue
        seen.add(source_id)
        if source_id == person_id:
            skipped_ids.append(source_id)
            continue
        try:
            _merge_person_into_target(session, source_id, person_id)
            merged_ids.append(source_id)
        except HTTPException as exc:
            if exc.status_code in (400, 404):
                skipped_ids.append(source_id)
            else:
                raise
    return MergePersonsResult(merged_ids=merged_ids, skipped_ids=skipped_ids)


@router.post(
    "/bulk-delete",
    response_model=PersonBulkDeleteResponse,
    summary="Delete multiple persons and their related data",
)
def delete_persons_bulk(
    payload: PersonBulkDeleteRequest,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed in settings.general.read_only mode.",
        )

    deleted_ids: list[int] = []
    skipped_ids: list[int] = []
    seen: set[int] = set()

    for person_id in payload.person_ids:
        if person_id in seen:
            continue
        seen.add(person_id)

        try:
            result = remove_person(person_id, session)
            if isinstance(result, HTTPException):
                raise result
            deleted_ids.append(person_id)
            session.expire_all()
        except HTTPException as exc:
            if exc.status_code == status.HTTP_403_FORBIDDEN:
                raise
            skipped_ids.append(person_id)
            logger.warning(
                "Skipping deletion of person %s due to API error: %s",
                person_id,
                exc.detail,
            )
        except Exception as exc:  # pragma: no cover - defensive
            skipped_ids.append(person_id)
            logger.exception(
                "Unexpected error while deleting person %s", person_id
            )

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
    return remove_person(person_id, session)


@router.get(
    "/{person_id}/similarities",
    response_model=list[SimilarPerson],
    summary="Get stored similarity scores for a person including name and thumbnail",
)
def get_similarities(
    person_id: int,
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    vec = get_person_embedding(session, person_id)
    if vec is None:
        return []

    k_val = 20

    sql = text(
        """
        SELECT
            p.id                          AS person_id,
            p.name                        AS person_name, -- aliased to avoid confusion if 'name' is a keyword
            profile_f.thumbnail_path      AS thumbnail_path,
            ROUND(
                (1.0 - (MIN(pe.distance) * MIN(pe.distance)) / 2.0) * 100,
                2
            )                             AS similarity_pct
        FROM person_embeddings AS pe
        JOIN person AS p
            ON p.id = pe.person_id
        LEFT JOIN face AS profile_f -- LEFT JOIN to include persons even if they don't have a profile face
            ON p.profile_face_id = profile_f.id -- Assuming Person table has profile_face_id
        WHERE
            pe.person_id != :p_id          -- Exclude the person themselves
            AND pe.embedding MATCH :vec    -- Vector similarity match (specific to your pg_embedding setup)
            AND pe.k = :k_param            -- If 'k' is a parameter for the MATCH or a column in person_embeddings
                                           -- Ensure this 'k' usage is correct for your pg_embedding extension.
                                           -- Often, for KNN, you'd use ORDER BY embedding_distance LIMIT k.
                                           -- If pe.k is a column, this is filtering on that column.
        GROUP BY
            p.id, p.name, profile_f.thumbnail_path -- Include all selected non-aggregated columns
        ORDER BY
            MIN(pe.distance) ASC           -- Closest first
        LIMIT :limit_val                   -- Limit the number of results
        """
    ).bindparams(
        p_id=person_id,
        vec=vec,  # Handle numpy array or list
        k_param=k_val,  # Parameter for the 'pe.k = :k_param' condition
        limit_val=k_val,  # Parameter for the LIMIT clause
    )

    result_rows = session.exec(sql).all()

    similar_persons_list = []
    for row in result_rows:
        similar_persons_list.append(
            SimilarPerson(
                id=row.person_id,
                name=row.person_name,
                thumbnail=row.thumbnail_path,  # Populate the new thumbnail field
                similarity=row.similarity_pct,
            )
        )

    return similar_persons_list


@router.post(
    "/{person_id}/merge-similar",
    response_model=MergePersonsResult,
    summary="Automatically merge similar persons that exceed the merge threshold",
)
def auto_merge_similar_persons(
    person_id: int,
    session: Session = Depends(get_session),
):
    if settings.general.read_only:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.read_only mode.",
        )

    threshold = float(
        getattr(
            settings.face_recognition,
            "person_merge_percent_similarity",
            75.0,
        )
    )
    similar_people = get_similarities(person_id, session)
    candidate_ids = [
        similar.id
        for similar in similar_people
        if similar.id is not None
        and similar.similarity is not None
        and float(similar.similarity) >= threshold
    ]

    merged_ids: list[int] = []
    skipped_ids: list[int] = []

    seen_ids: set[int] = set()

    for source_id in candidate_ids:
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)
        if source_id == person_id:
            continue
        try:
            _merge_person_into_target(session, source_id, person_id)
            merged_ids.append(source_id)
        except HTTPException as exc:
            if exc.status_code in (400, 404):
                skipped_ids.append(source_id)
            else:
                raise

    return MergePersonsResult(merged_ids=merged_ids, skipped_ids=skipped_ids)


@router.get(
    "/{person_id}/relationships",
    response_model=RelationshipGraph,
)
def get_person_relationships(
    person_id: int,
    depth: int = Query(3, ge=1, le=5, description="Number of generations to include"),
    max_nodes: int | None = Query(
        None, ge=1, le=500, description="Maximum number of nodes to include"
    ),
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    effective_max_nodes = (
        max_nodes
        if max_nodes is not None
        else settings.general.person_relationship_max_nodes
    )
    effective_max_nodes = int(max(1, min(500, effective_max_nodes)))

    nodes: dict[int, dict[str, object]] = {}
    edges: dict[tuple[int, int], int] = {}
    person_cache: dict[int, Person] = {}

    def _load_person(pid: int) -> Person | None:
        cached = person_cache.get(pid)
        if cached is not None:
            return cached
        obj = session.get(Person, pid)
        if obj is not None:
            person_cache[pid] = obj
        return obj

    def _ensure_node(pid: int, node_depth: int) -> bool:
        node = nodes.get(pid)
        if node:
            node["depth"] = min(node["depth"], node_depth)
            return True

        person_obj = _load_person(pid)
        if person_obj is None:
            return False

        thumbnail = None
        if person_obj.profile_face and person_obj.profile_face.thumbnail_path:
            thumbnail = person_obj.profile_face.thumbnail_path

        nodes[pid] = {
            "id": pid,
            "name": person_obj.name,
            "profile_thumbnail": thumbnail,
            "depth": node_depth,
        }
        return True

    visited: set[int] = set()
    queue: deque[tuple[int, int]] = deque([(person_id, 0)])

    while queue and len(nodes) < effective_max_nodes:
        current_id, current_depth = queue.popleft()
        if current_id in visited:
            continue
        visited.add(current_id)

        if not _ensure_node(current_id, current_depth):
            continue

        if current_depth >= depth:
            continue

        relationships = session.exec(
            select(PersonRelationship)
            .where(
                or_(
                    PersonRelationship.person_a_id == current_id,
                    PersonRelationship.person_b_id == current_id,
                )
            )
            .where(PersonRelationship.coappearance_count > 0)
            .order_by(PersonRelationship.coappearance_count.desc())
        ).all()

        for rel in relationships:
            neighbour_id = (
                rel.person_b_id if rel.person_a_id == current_id else rel.person_a_id
            )

            weight = int(rel.coappearance_count or 0)
            if weight <= 0:
                continue

            if len(nodes) >= effective_max_nodes and neighbour_id not in nodes:
                continue

            added = _ensure_node(neighbour_id, current_depth + 1)
            if not added:
                continue

            edge_key = tuple(sorted((current_id, neighbour_id)))
            existing_weight = edges.get(edge_key, 0)
            edges[edge_key] = max(existing_weight, weight)

            if neighbour_id not in visited and (current_depth + 1) <= depth:
                queue.append((neighbour_id, current_depth + 1))

    if person_id not in nodes:
        _ensure_node(person_id, 0)

    node_models = [
        RelationshipNode(**node_data)
        for node_data in sorted(
            nodes.values(), key=lambda node: (node["depth"], node["id"])
        )
    ]
    edge_models = [
        RelationshipEdge(source=edge[0], target=edge[1], weight=weight)
        for edge, weight in edges.items()
        if edge[0] in nodes and edge[1] in nodes
    ]

    return RelationshipGraph(
        nodes=node_models,
        edges=edge_models,
        root_id=person_id,
        max_depth=depth,
    )
