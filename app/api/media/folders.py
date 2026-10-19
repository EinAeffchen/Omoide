"""Browsing media by folder relative to the configured media directories."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlmodel import Session, select

from app.database import get_session
from app.models import Media
from app.schemas.media import (
    MediaFolderBreadcrumb,
    MediaFolderEntry,
    MediaFolderListing,
    MediaFolderPreview,
)

router = APIRouter()


def normalize_relative_path(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.replace("\\", "/").strip("/")
    if not normalized:
        return ""
    parts = [segment for segment in normalized.split("/") if segment]
    if any(part in {"..", "."} for part in parts):
        raise HTTPException(status_code=400, detail="Invalid folder path")
    return "/".join(parts)


def _split_relative_path(path_value: str) -> list[str]:
    normalized = path_value.replace("\\", "/").strip("/")
    if not normalized:
        return []
    return [segment for segment in normalized.split("/") if segment]


def _build_breadcrumbs(parts: list[str]) -> list[MediaFolderBreadcrumb]:
    breadcrumbs: list[MediaFolderBreadcrumb] = []
    for index, name in enumerate(parts):
        segment_path = "/".join(parts[: index + 1])
        breadcrumbs.append(
            MediaFolderBreadcrumb(
                name=name, path=segment_path if segment_path else None
            )
        )
    return breadcrumbs


@router.get("/folders", response_model=MediaFolderListing)
def list_media_folders(
    parent: str | None = Query(
        None, description="Relative folder path (POSIX style). Omit or empty for root."
    ),
    preview_limit: int = Query(
        4,
        ge=0,
        le=12,
        description="Maximum number of media previews to include per folder.",
    ),
    session: Session = Depends(get_session),
):
    normalized_parent = normalize_relative_path(parent)
    parent_parts = _split_relative_path(normalized_parent)

    normalized_path_expr = func.replace(Media.path, "\\", "/")

    where_clauses = []
    if normalized_parent:
        where_clauses.append(normalized_path_expr.like(f"{normalized_parent}/%"))
        rel_expr = func.substr(normalized_path_expr, len(normalized_parent) + 2)
    else:
        rel_expr = func.ltrim(normalized_path_expr, "/")

    slash_pos = func.instr(rel_expr, "/")
    first_seg = func.substr(rel_expr, 1, slash_pos - 1)
    rest_expr = func.substr(rel_expr, slash_pos + 1)
    rest_slash = func.instr(rest_expr, "/")
    second_seg = case(
        (rest_slash > 0, func.substr(rest_expr, 1, rest_slash - 1)), else_=None
    )

    direct_media_count = (
        session.exec(
            select(func.count(Media.id)).where(*where_clauses, slash_pos == 0)
        ).first()
        or 0
    )

    folder_rows = session.exec(
        select(
            first_seg.label("name"),
            func.count(Media.id).label("media_count"),
            func.count(func.distinct(second_seg)).label("subfolder_count"),
        )
        .where(*where_clauses, slash_pos > 0)
        .group_by(first_seg)
    ).all()

    previews_by_folder: dict[str, list[MediaFolderPreview]] = {}
    if preview_limit > 0 and folder_rows:
        row_number = (
            func.row_number()
            .over(
                partition_by=first_seg,
                order_by=(Media.created_at.desc(), Media.id.desc()),
            )
            .label("rn")
        )
        preview_subq = (
            select(
                Media.id,
                Media.path,
                Media.filename,
                Media.thumbnail_path,
                first_seg.label("folder_name"),
                row_number,
            )
            .where(*where_clauses, slash_pos > 0)
            .subquery()
        )
        preview_rows = session.exec(
            select(
                preview_subq.c.id,
                preview_subq.c.path,
                preview_subq.c.filename,
                preview_subq.c.thumbnail_path,
                preview_subq.c.folder_name,
            )
            .where(preview_subq.c.rn <= preview_limit)
            .order_by(preview_subq.c.folder_name, preview_subq.c.rn)
        ).all()
        for media_id, media_path, filename, thumbnail_path, folder_name in preview_rows:
            previews_by_folder.setdefault(folder_name, []).append(
                MediaFolderPreview(
                    id=media_id,
                    path=media_path,
                    filename=filename,
                    thumbnail_path=thumbnail_path,
                )
            )

    folder_parent_path = "/".join(parent_parts) if parent_parts else None
    folders = [
        MediaFolderEntry(
            path="/".join([*parent_parts, folder_name]),
            name=folder_name,
            parent_path=folder_parent_path,
            depth=len(parent_parts) + 1,
            media_count=int(media_count),
            subfolder_count=int(subfolder_count),
            previews=previews_by_folder.get(folder_name, []),
        )
        for folder_name, media_count, subfolder_count in folder_rows
    ]

    folders.sort(key=lambda entry: entry.name.lower())

    breadcrumbs = _build_breadcrumbs(parent_parts)
    current_path = "/".join(parent_parts) if parent_parts else None
    parent_path_value = "/".join(parent_parts[:-1])
    if parent_path_value == "":
        parent_path_value = None

    return MediaFolderListing(
        current_path=current_path,
        parent_path=parent_path_value,
        depth=len(parent_parts),
        direct_media_count=direct_media_count,
        folders=folders,
        breadcrumbs=breadcrumbs,
    )
