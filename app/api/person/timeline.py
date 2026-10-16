"""Person timeline: dated media and user-defined life events."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, literal_column, union_all
from sqlmodel import Session, select

from app.database import get_session
from app.models import Face, Media, PersonMediaLink, TimelineEvent
from app.schemas.timeline import TimelineEventCreate, TimelineEventUpdate, TimelinePage

router = APIRouter()


@router.get("/{person_id}/timeline", response_model=TimelinePage)
def get_person_timeline(
    person_id: int,
    session: Session = Depends(get_session),
    cursor: str | None = None,
    limit: int = 1000,
):
    media_ids_union = union_all(
        select(Face.media_id.label("media_id")).where(Face.person_id == person_id),
        select(PersonMediaLink.media_id.label("media_id")).where(
            PersonMediaLink.person_id == person_id
        ),
    ).subquery()
    media_ids_subquery = select(media_ids_union.c.media_id).distinct()
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
                status_code=400, detail="Invalid cursor format. Use YYYY-MM-DD."
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
            TimelineEvent.person_id == person_id, TimelineEvent.recurrence == "yearly"
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
                {"type": "media", "date": get_date(item), "items": item}
            )
        elif isinstance(item, TimelineEvent):
            timeline_items.append(
                {"type": "event", "date": get_date(item), "event": item}
            )

    return {"items": timeline_items, "next_cursor": next_cursor}


@router.post("/{person_id}/events", response_model=TimelineEvent)
def create_person_event(
    person_id: int, event: TimelineEventCreate, session: Session = Depends(get_session)
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
