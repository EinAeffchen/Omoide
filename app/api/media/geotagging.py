"""Media without a location, for the map editor: filtered by folder, sorted,
and annotated with whether Omoide may write a location into each file."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.config import settings
from app.database import get_session
from app.models import ExifData, Media
from app.pagination import SortKey, paginate
from app.schemas.media import (
    MissingGeoFolder,
    MissingGeoFolders,
    MissingGeoMedia,
    MissingGeoPage,
)

router = APIRouter()

_SORT_KEYS: dict[str, list[SortKey]] = {
    "latest": [(Media.inserted_at, False), (Media.id, False)],
    "newest": [(Media.created_at, False), (Media.id, False)],
    "oldest": [(Media.created_at, True), (Media.id, True)],
    "path": [(Media.path, True), (Media.id, True)],
}

_normalized_path = func.replace(Media.path, "\\", "/")


def _missing_geo_select(*columns):
    """Media that still exist on disk and have no coordinates (including
    media without any EXIF row)."""
    return (
        select(*columns)
        .select_from(Media)
        .outerjoin(ExifData, ExifData.media_id == Media.id)
        .where(ExifData.lat.is_(None), col(Media.missing_since).is_(None))
    )


def _normalize_folder(value: str) -> str:
    normalized = value.replace("\\", "/").rstrip("/")
    return normalized or "/"


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _write_block_reason(path: Path) -> str | None:
    """Why the location cannot be written into ``path``, or None if it can.

    Opening for update without writing checks what the real write needs
    (ACLs, the read-only attribute, read-only mounts) without changing the file.
    """
    try:
        settings.general.ensure_media_path_writable(path)
    except PermissionError as exc:
        return str(exc)
    try:
        with open(path, "r+b"):
            pass
    except FileNotFoundError:
        return "The file no longer exists."
    except PermissionError as exc:
        return f"The OS denies write access to this file ({exc.strerror or exc})."
    except OSError as exc:
        return f"The file cannot be opened for writing ({exc.strerror or exc})."
    return None


def _probe_all(paths: list[str]) -> list[str | None]:
    # Probes are I/O-bound and can be slow on network shares.
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(lambda p: _write_block_reason(Path(p)), paths))


@router.get("/missing-geo", response_model=MissingGeoPage)
def get_missing_geo(
    session: Session = Depends(get_session),
    folder: str | None = Query(
        None,
        description="Only media in this folder or its subfolders (a `path` from /missing-geo/folders).",
    ),
    sort: Annotated[str, Query(enum=list(_SORT_KEYS))] = "latest",
    cursor: str | None = Query(
        None, description="Opaque cursor from the previous page's `next_cursor`"
    ),
    limit: int = Query(100, ge=1, le=200),
):
    stmt = _missing_geo_select(Media)
    if folder:
        prefix = _normalize_folder(folder).rstrip("/") + "/"
        stmt = stmt.where(_normalized_path.like(f"{_escape_like(prefix)}%", escape="\\"))
    results, next_cursor = paginate(
        session, stmt, _SORT_KEYS[sort], cursor=cursor, limit=limit, tag=sort
    )

    items = [MissingGeoMedia.model_validate(m, from_attributes=True) for m in results]
    if settings.general.write_location_to_files and items:
        for item, reason in zip(items, _probe_all([m.path for m in items])):
            item.write_block_reason = reason
    return MissingGeoPage(items=items, next_cursor=next_cursor)


def _ancestors(directory: str, bases: list[str]) -> list[str]:
    """``directory`` and its parents up to the media directory containing it."""
    folded = directory.casefold()
    for base in bases:
        base_folded = base.casefold()
        if folded == base_folded or folded.startswith(base_folded.rstrip("/") + "/"):
            chain = [base]
            rest = directory[len(base) :].strip("/")
            for segment in rest.split("/") if rest else []:
                chain.append(chain[-1].rstrip("/") + "/" + segment)
            return chain
    return [directory]


@router.get("/missing-geo/folders", response_model=MissingGeoFolders)
def get_missing_geo_folders(session: Session = Depends(get_session)):
    """Folders holding media without a location, as a tree under each media
    directory, with counts and whether locations can be written there."""
    # SQLite has no dirname(): stripping every non-slash character from the
    # right leaves the path up to and including its last slash.
    dir_expr = func.rtrim(_normalized_path, func.replace(_normalized_path, "/", ""))
    rows = session.exec(
        _missing_geo_select(
            dir_expr.label("dir"),
            func.count(Media.id),
            func.min(Media.path),
            func.max(Media.path),
        ).group_by(dir_expr)
    ).all()

    write_to_files = settings.general.write_location_to_files
    leaves = [(_normalize_folder(d), int(n)) for d, n, _, _ in rows]
    # Checking every file could mean tens of thousands of opens (and network
    # round trips), so the first and last file stand in for their folder.
    # Listed files are each checked again by /missing-geo.
    reasons: list[list[str | None]] = []
    if write_to_files:
        probed = iter(_probe_all([p for *_, first, last in rows for p in (first, last)]))
        reasons = [[next(probed), next(probed)] for _ in rows]

    bases = sorted(
        (_normalize_folder(str(base)) for base, _ in settings.general.resolved_media_dirs()),
        key=len,
        reverse=True,  # the most specific base wins for nested media dirs
    )
    roots: dict[str, int] = {}
    counts: dict[str, int] = {}
    leaf_reasons: dict[str, list[str | None]] = {}
    for index, (directory, count) in enumerate(leaves):
        chain = _ancestors(directory, bases)
        for depth, path in enumerate(chain):
            roots.setdefault(path, depth)
            counts[path] = counts.get(path, 0) + count
            if write_to_files:
                leaf_reasons.setdefault(path, []).extend(reasons[index])

    folders: list[MissingGeoFolder] = []
    for path, depth in roots.items():
        status = reason = None
        if write_to_files:
            below = leaf_reasons[path]
            blocked = [r for r in below if r is not None]
            if not blocked:
                status = "writable"
            elif len(blocked) == len(below):
                status = "blocked"
                reason = blocked[0] if len(set(blocked)) == 1 else (
                    "None of the files in these folders can be written."
                )
            else:
                status = "mixed"
                reason = "Some files in here are write-protected."
        folders.append(
            MissingGeoFolder(
                path=path,
                name=path if depth == 0 else path.rsplit("/", 1)[-1],
                depth=depth,
                media_count=counts[path],
                write_status=status,
                write_block_reason=reason,
            )
        )
    # Segment-wise so a folder's children directly follow it ("a b" would
    # otherwise sort between "a" and "a/x").
    folders.sort(key=lambda f: [s.casefold() for s in f.path.split("/")])
    return MissingGeoFolders(folders=folders, write_to_files=write_to_files)
