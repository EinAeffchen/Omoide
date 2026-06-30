import os
from collections import defaultdict
from itertools import combinations
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import selectinload
from sqlmodel import Session, delete, select

from app.database import get_session
from app.models import (
    Blacklist,
    DuplicateGroup,
    DuplicateIgnore,
    DuplicateMedia,
    Media,
)
from app.schemas.duplicates import (
    DuplicateFolderStat,
    DuplicateGroup as DuplicateGroupSchema,
    DuplicatePage,
    DuplicateStats,
    DuplicateTypeSummary,
    ResolveDuplicatesRequest,
)
from app.schemas.media import MediaPreview
from app.utils import delete_file, delete_record

router = APIRouter()


@router.get("", response_model=DuplicatePage)
def get_duplicates(
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None,
        description=(
            "Cursor for pagination, formatted as '<sort_key>_<group_id>'. "
            "Use the `next_cursor` value from the previous page."
        ),
    ),
    limit: int = Query(10, ge=1, le=50),
    sort_by: Literal["count", "size"] = Query("count"),
    media_type: Literal["image", "video"] | None = Query(None),
    min_count: int = Query(2, ge=2, description="Minimum number of items in a duplicate group"),
):
    """
    Returns a paginated list of duplicate groups. Supports sorting by item count or
    total file size, and filtering by media type.
    """
    counts_subquery = (
        select(
            DuplicateMedia.group_id,
            func.count(DuplicateMedia.media_id).label("item_count"),
        )
        .group_by(DuplicateMedia.group_id)
        .subquery()
    )

    if sort_by == "size":
        size_subquery = (
            select(
                DuplicateMedia.group_id,
                func.coalesce(func.sum(Media.size), 0).label("total_size"),
            )
            .join(Media, Media.id == DuplicateMedia.media_id)
            .group_by(DuplicateMedia.group_id)
            .subquery()
        )
        query = (
            select(DuplicateGroup, counts_subquery.c.item_count, size_subquery.c.total_size)
            .join(counts_subquery, DuplicateGroup.id == counts_subquery.c.group_id)
            .join(size_subquery, DuplicateGroup.id == size_subquery.c.group_id)
            .options(
                selectinload(DuplicateGroup.media_links).selectinload(DuplicateMedia.media)
            )
            .where(counts_subquery.c.item_count >= min_count)
            .order_by(size_subquery.c.total_size.desc(), DuplicateGroup.id.asc())
        )
        sort_col = size_subquery.c.total_size
    else:
        query = (
            select(DuplicateGroup, counts_subquery.c.item_count)
            .join(counts_subquery, DuplicateGroup.id == counts_subquery.c.group_id)
            .options(
                selectinload(DuplicateGroup.media_links).selectinload(DuplicateMedia.media)
            )
            .where(counts_subquery.c.item_count >= min_count)
            .order_by(counts_subquery.c.item_count.desc(), DuplicateGroup.id.asc())
        )
        sort_col = counts_subquery.c.item_count

    if media_type is not None:
        type_filter = (
            select(DuplicateMedia.group_id)
            .join(Media, Media.id == DuplicateMedia.media_id)
            .where(
                Media.duration.is_(None) if media_type == "image"
                else Media.duration.isnot(None)
            )
            .distinct()
        )
        query = query.where(DuplicateGroup.id.in_(type_filter))

    cursor_key = None
    cursor_id = None
    if cursor:
        try:
            if "_" in cursor:
                cursor_key_str, cursor_id_str = cursor.split("_", 1)
                cursor_key = int(cursor_key_str)
                cursor_id = int(cursor_id_str)
            else:
                # Backwards compatibility with the previous integer-only cursor.
                cursor_id = int(cursor)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid cursor format. Expected '<sort_key>_<group_id>'.",
            )

    if cursor_key is not None:
        query = query.where(
            or_(
                sort_col < cursor_key,
                and_(sort_col == cursor_key, DuplicateGroup.id > cursor_id),
            )
        )
    elif cursor_id is not None:
        query = query.where(DuplicateGroup.id > cursor_id)

    duplicate_groups_db = session.exec(query.limit(limit)).all()

    response_items: list[DuplicateGroupSchema] = []
    last_sort_key: int | None = None
    last_group_id: int | None = None
    for row in duplicate_groups_db:
        if sort_by == "size":
            group_db, item_count, total_size = row
            last_sort_key = int(total_size or 0)
        else:
            group_db, item_count = row
            last_sort_key = int(item_count or 0)

        media_objects = sorted(
            [link.media for link in group_db.media_links], key=lambda m: m.id
        )
        group_schema = DuplicateGroupSchema(
            group_id=group_db.id,
            items=[MediaPreview.model_validate(m) for m in media_objects],
        )
        response_items.append(group_schema)
        last_group_id = group_db.id

    next_cursor = None
    if len(duplicate_groups_db) == limit and last_group_id is not None:
        next_cursor = f"{last_sort_key}_{last_group_id}"

    return DuplicatePage(items=response_items, next_cursor=next_cursor)


@router.get("/stats", response_model=DuplicateStats)
def get_duplicate_stats(session: Session = Depends(get_session)) -> DuplicateStats:
    data_stmt = (
        select(
            DuplicateMedia.group_id,
            Media.path,
            Media.size,
            Media.duration,
        )
        .join(Media, Media.id == DuplicateMedia.media_id)
    )

    rows = session.exec(data_stmt).all()
    if not rows:
        return DuplicateStats(
            total_groups=0,
            total_items=0,
            total_size_bytes=0,
            total_reclaimable_bytes=0,
            type_breakdown=[],
            top_folders=[],
        )

    group_counts: dict[int, int] = defaultdict(int)
    for group_id, *_ in rows:
        group_counts[group_id] += 1

    active_group_ids = {gid for gid, count in group_counts.items() if count > 1}
    if not active_group_ids:
        return DuplicateStats(
            total_groups=0,
            total_items=0,
            total_size_bytes=0,
            total_reclaimable_bytes=0,
            type_breakdown=[],
            top_folders=[],
        )

    total_items = 0
    total_size = 0
    group_sizes: dict[int, list[int]] = defaultdict(list)
    folder_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"items": 0, "size": 0})
    folder_groups: dict[str, set[int]] = defaultdict(set)
    folder_labels: dict[str, str] = {}
    type_items = {"image": 0, "video": 0}
    type_sizes = {"image": 0, "video": 0}
    type_groups: dict[str, set[int]] = {"image": set(), "video": set()}

    def folder_from_path(path_value: str | None) -> tuple[str, str]:
        if not path_value:
            return ("unknown", "Unknown")
        try:
            folder_display = Path(path_value).parent.as_posix()
        except Exception:
            folder_display = str(path_value)
        folder_key = folder_display.casefold() if os.name == "nt" else folder_display
        return (folder_key, folder_display)

    for group_id, media_path, media_size, media_duration in rows:
        if group_id not in active_group_ids:
            continue
        size_value = int(media_size or 0)
        total_items += 1
        total_size += size_value
        group_sizes[group_id].append(size_value)

        media_type = "video" if media_duration is not None else "image"
        type_items[media_type] += 1
        type_sizes[media_type] += size_value
        type_groups[media_type].add(group_id)

        folder_key, folder_display = folder_from_path(media_path)
        totals = folder_totals[folder_key]
        totals["items"] += 1
        totals["size"] += size_value
        folder_groups[folder_key].add(group_id)
        folder_labels.setdefault(folder_key, folder_display)

    total_groups = len(active_group_ids)
    total_reclaimable = sum(
        max(sum(sizes) - max(sizes), 0) for sizes in group_sizes.values() if sizes
    )

    type_breakdown = [
        DuplicateTypeSummary(
            type=type_name,
            items=type_items[type_name],
            groups=len(type_groups[type_name]),
            size_bytes=type_sizes[type_name],
        )
        for type_name in ("image", "video")
        if type_items[type_name] > 0
    ]

    folder_entries = [
        DuplicateFolderStat(
            folder=folder_labels.get(folder_key, folder_key),
            items=totals["items"],
            groups=len(folder_groups[folder_key]),
            size_bytes=totals["size"],
        )
        for folder_key, totals in folder_totals.items()
    ]
    folder_entries.sort(key=lambda entry: (entry.items, entry.size_bytes), reverse=True)

    return DuplicateStats(
        total_groups=total_groups,
        total_items=total_items,
        total_size_bytes=total_size,
        total_reclaimable_bytes=total_reclaimable,
        type_breakdown=type_breakdown,
        top_folders=folder_entries[:5],
    )




@router.post("/resolve")
def resolve_duplicate_group(
    request: ResolveDuplicatesRequest, session: Session = Depends(get_session)
):
    # 1. Find all media IDs in the group
    stmt = select(DuplicateMedia).where(
        DuplicateMedia.group_id == request.group_id
    )
    all_duplicates_in_group = session.exec(stmt).all()
    all_media_ids_in_group = {dm.media_id for dm in all_duplicates_in_group}

    if not all_media_ids_in_group:
        raise HTTPException(
            status_code=404, detail="Duplicate group not found."
        )

    if len(all_media_ids_in_group) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Duplicate group must contain at least two items.",
        )

    if request.action == "MARK_NOT_DUPLICATE":
        sorted_ids = sorted(all_media_ids_in_group)
        existing_pairs = {
            (row[0], row[1])
            for row in session.exec(
                select(
                    DuplicateIgnore.media_id_a, DuplicateIgnore.media_id_b
                ).where(
                    DuplicateIgnore.media_id_a.in_(sorted_ids),
                    DuplicateIgnore.media_id_b.in_(sorted_ids),
                )
            ).all()
        }
        for media_a, media_b in combinations(sorted_ids, 2):
            pair = (min(media_a, media_b), max(media_a, media_b))
            if pair in existing_pairs:
                continue
            session.add(
                DuplicateIgnore(media_id_a=pair[0], media_id_b=pair[1])
            )
    else:
        if request.master_media_id is None:
            raise HTTPException(
                status_code=400, detail="master_media_id is required."
            )
        if request.master_media_id not in all_media_ids_in_group:
            raise HTTPException(
                status_code=404,
                detail="Master media ID not found in the specified group.",
            )

        ids_to_process = all_media_ids_in_group - {request.master_media_id}

        media_to_process_stmt = select(Media).where(
            Media.id.in_(ids_to_process)
        )
        media_to_process = session.exec(media_to_process_stmt).all()

        # 2. Perform the requested action on all other media items
        for media in media_to_process:
            if request.action == "DELETE_FILES":
                delete_file(session, media.id)

            elif request.action == "DELETE_RECORDS":
                delete_record(media.id, session)

            elif request.action == "BLACKLIST_RECORDS":
                blacklist_entry = Blacklist(path=media.path)
                session.add(blacklist_entry)
                delete_record(media.id, session)
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported action {request.action}",
                )

    # 3. Delete the original DuplicateMedia entries and the group itself
    session.exec(
        delete(DuplicateMedia).where(
            DuplicateMedia.group_id == request.group_id
        )
    )
    session.exec(
        delete(DuplicateGroup).where(DuplicateGroup.id == request.group_id)
    )

    session.commit()

    return {"message": f"Group {request.group_id} resolved successfully."}
