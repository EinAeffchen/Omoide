import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import and_, func, or_, text, tuple_
from sqlalchemy.orm import aliased, selectinload
from sqlmodel import Session, select

from app.config import ReadOnlyMediaError, settings
from app.database import get_session
from app.logger import logger
from app.models import ExifData, Face, Media, Person, Scene, Tag
from app.schemas.face import FaceRead
from app.schemas.media import (
    CursorPage,
    GeoUpdate,
    MediaDetail,
    MediaFolderBreadcrumb,
    MediaFolderEntry,
    MediaFolderListing,
    MediaFolderPreview,
    MediaLocation,
    MediaNeighbors,
    MediaPreview,
    MediaRead,
    SceneRead,
)
from app.schemas.person import PersonRead
from app.utils import (
    delete_file,
    delete_record,
    update_exif_gps,
)

router = APIRouter()


def _normalize_relative_path(value: str | None) -> str:
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
                name=name,
                path=segment_path if segment_path else None,
            )
        )
    return breadcrumbs


def _is_within(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def _resolve_media_parent(path_value: str) -> tuple[Path | None, Path | None]:
    raw = Path(path_value)
    media_dirs = [base for base, _ in settings.general.resolved_media_dirs()]
    candidates: list[Path] = []

    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.append(Path("/") / raw)

    for media_dir in media_dirs:
        candidates.append(media_dir / raw)

    seen: set[Path] = set()
    for candidate in candidates:
        try:
            normalized = candidate.resolve(strict=False)
        except RuntimeError:
            continue

        if normalized in seen:
            continue
        seen.add(normalized)

        if media_dirs and not any(
            _is_within(normalized, media_dir) for media_dir in media_dirs
        ):
            continue

        if normalized.exists():
            if normalized.is_dir():
                return normalized, None
            return normalized.parent, normalized

        parent = normalized.parent
        if parent.exists():
            return parent, None

    return None, None


def _is_local_request(request: Request) -> bool:
    try:
        host = request.client.host if request.client else ""
    except Exception:
        return False
    return host in {"127.0.0.1", "::1", "localhost"}


def _select_in_explorer_windows(target: Path) -> None:
    # Use the shell API to avoid Explorer /select flakiness.
    import ctypes
    from ctypes import wintypes

    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32

    ole32.CoInitialize.argtypes = [ctypes.c_void_p]
    ole32.CoInitialize.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoUninitialize.restype = None

    shell32.ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]
    shell32.ILCreateFromPathW.restype = ctypes.c_void_p
    shell32.ILFree.argtypes = [ctypes.c_void_p]
    shell32.ILFree.restype = None
    shell32.SHOpenFolderAndSelectItems.argtypes = [
        ctypes.c_void_p,
        wintypes.UINT,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    shell32.SHOpenFolderAndSelectItems.restype = ctypes.c_long

    hr = ole32.CoInitialize(None)
    com_initialized = hr in (0, 1)
    try:
        pidl = shell32.ILCreateFromPathW(str(target))
        if not pidl:
            raise OSError("ILCreateFromPathW failed")
        try:
            hr = shell32.SHOpenFolderAndSelectItems(pidl, 0, None, 0)
            if hr != 0:
                raise OSError(f"SHOpenFolderAndSelectItems failed: {hr}")
        finally:
            shell32.ILFree(pidl)
    finally:
        if com_initialized:
            ole32.CoUninitialize()


def _open_in_file_browser(parent: Path, resolved_file: Path | None) -> None:
    if sys.platform.startswith("win"):
        if resolved_file and resolved_file.exists():
            try:
                _select_in_explorer_windows(resolved_file)
                return
            except Exception as e:
                logger.warning(
                    "Failed to select file in Explorer via shell API: %s", e
                )
            explorer_path = os.path.join(os.environ["WINDIR"], "explorer.exe")
            normalized_file_path = os.path.normpath(str(resolved_file))
            try:
                subprocess.run(
                    [explorer_path, "/select,", normalized_file_path],
                    shell=False,
                    check=True,
                )
                return
            except Exception as e:
                logger.warning("Failed to open file in Explorer: %s", e)
        try:
            logger.debug("Opening folder through alternative opener")
            os.startfile(str(parent))
            return
        except Exception as e:
            logger.warning("Failed to open folder via startfile: %s", e)
            subprocess.Popen(["explorer.exe", str(parent)], shell=False)
        return

    if sys.platform == "darwin":
        if resolved_file and resolved_file.exists():
            subprocess.Popen(["open", "-R", str(resolved_file)])
        else:
            subprocess.Popen(["open", str(parent)])
        return

    subprocess.Popen(["xdg-open", str(parent)])


@dataclass
class _FolderAccumulator:
    path: str
    name: str
    parent_path: str | None
    depth: int
    media_count: int = 0
    subfolders: set[str] = field(default_factory=set)
    previews: list[MediaFolderPreview] = field(default_factory=list)


def format_timestamp(seconds: float) -> str:
    """
    Turn seconds (e.g. 12.3456) into a WebVTT timestamp like "00:00:12.346".
    """
    td = timedelta(seconds=seconds)
    # total seconds → hours, minutes, seconds, milliseconds
    total_ms = int(td.total_seconds() * 1000)
    hrs, rem = divmod(total_ms, 3_600_000)
    mins, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"


@router.get("/missing-geo", response_model=CursorPage)
def get_missing_geo(
    session: Session = Depends(get_session),
    cursor: str | None = None,  # 1. Accept an optional string cursor
    limit: int = 100,  # 2. Make the limit a parameter
):
    stmt = (
        select(Media)
        .join(ExifData)
        .where(ExifData.lat.is_(None))
        # Add a secondary unique sort key for stable ordering
        .order_by(Media.inserted_at.desc(), Media.id.desc())
    )

    # 3. If a cursor is provided, add it to the query
    if cursor:
        try:
            # The cursor will be the `inserted_at` timestamp of the last item from the previous page
            cursor_datetime = datetime.fromisoformat(cursor)
            stmt = stmt.where(Media.inserted_at < cursor_datetime)
        except ValueError:
            # Handle invalid cursor format if necessary
            pass

    # Apply the limit to get one page of results
    stmt = stmt.limit(limit)

    results = session.exec(stmt).all()

    # 4. Determine the next cursor
    next_cursor = None
    if len(results) == limit:
        # If we got a full page, the next cursor is the timestamp of the last item
        last_item_timestamp = results[-1].inserted_at
        next_cursor = last_item_timestamp.isoformat()

    # 5. Return the data in the correct object shape
    return CursorPage(items=results, next_cursor=next_cursor)


@router.get("/", response_model=CursorPage)
def list_media(
    tags: list[str] | None = Query(
        None, description="Filter by tag name(s), comma-separated"
    ),
    person_id: int | None = Query(None, description="Filter by detected person ID"),
    folder: str | None = Query(
        None,
        description=(
            "Relative folder path (POSIX style). Use empty string for root-level items."
        ),
    ),
    recursive: bool = Query(
        True,
        description="Include media in nested subfolders when filtering by folder.",
    ),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<value>_<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or"
            " `2500_1234`"
        ),
    ),
    limit: int = Query(100, ge=1, le=200),
    session: Session = Depends(get_session),
):
    q = select(Media)
    # select by tags
    if tags and len(tags) > 0:
        q = q.join(Media.tags).where(Tag.name.in_(tags))

    normalized_folder = ""
    if folder is not None:
        normalized_folder = _normalize_relative_path(folder)
        normalized_path_expr = func.replace(Media.path, "\\", "/")
        if normalized_folder:
            prefix = f"{normalized_folder}/"
            q = q.where(normalized_path_expr.like(f"{prefix}%"))
            if not recursive:
                q = q.where(~normalized_path_expr.like(f"{prefix}%/%"))
        elif not recursive:
            q = q.where(~normalized_path_expr.like("%/%"))

    if sort == "newest":
        sort_col = Media.created_at
        parse_val_from_cursor = lambda val_str: datetime.fromisoformat(val_str)
    elif sort == "latest":
        sort_col = Media.inserted_at
        parse_val_from_cursor = lambda val_str: datetime.fromisoformat(val_str)
    else:
        raise ValueError(f"Unsupported sort option: {sort}")

    q = q.order_by(sort_col.desc(), Media.id.desc())

    if cursor:
        try:
            val_str, id_str = cursor.split("_", 1)
            prev_cursor_val = parse_val_from_cursor(val_str)
            prev_cursor_id = int(id_str)
        except ValueError:
            logger.warning("Warning: Invalid cursor format: %s", cursor)
        else:
            q = q.where(
                or_(
                    sort_col < prev_cursor_val,
                    and_(sort_col == prev_cursor_val, Media.id < prev_cursor_id),
                )
            )
    if person_id:
        q = q.join(Media.faces).where(Face.person_id == person_id)

    results = session.exec(q.limit(limit)).all()
    if len(results) == limit:
        last = results[-1]
        v = getattr(last, "created_at" if sort == "newest" else "inserted_at")
        val_token = v.isoformat()
        next_cursor = f"{val_token}_{last.id}"
    else:
        next_cursor = None
    return CursorPage(items=results, next_cursor=next_cursor)


@router.get("/folders", response_model=MediaFolderListing)
def list_media_folders(
    parent: str | None = Query(
        None,
        description="Relative folder path (POSIX style). Omit or empty for root.",
    ),
    preview_limit: int = Query(
        4,
        ge=0,
        le=12,
        description="Maximum number of media previews to include per folder.",
    ),
    session: Session = Depends(get_session),
):
    normalized_parent = _normalize_relative_path(parent)
    parent_parts = _split_relative_path(normalized_parent)

    normalized_path_expr = func.replace(Media.path, "\\", "/")
    stmt = select(
        Media.id,
        Media.path,
        Media.filename,
        Media.thumbnail_path,
    ).order_by(Media.created_at.desc(), Media.id.desc())

    if normalized_parent:
        stmt = stmt.where(normalized_path_expr.like(f"{normalized_parent}/%"))

    rows = session.exec(stmt).all()

    folder_details: dict[str, _FolderAccumulator] = {}
    direct_media_count = 0

    for media_id, media_path, filename, thumbnail_path in rows:
        path_parts = _split_relative_path(media_path)
        if len(path_parts) <= len(parent_parts):
            continue

        relative_parts = path_parts[len(parent_parts) :]
        if not relative_parts:
            continue

        if len(relative_parts) == 1:
            direct_media_count += 1
            continue

        folder_name = relative_parts[0]
        folder_path_segments = [*parent_parts, folder_name]
        folder_path = "/".join(folder_path_segments)
        parent_path_value = "/".join(parent_parts) if parent_parts else None

        entry = folder_details.get(folder_path)
        if entry is None:
            entry = _FolderAccumulator(
                path=folder_path,
                name=folder_name,
                parent_path=parent_path_value,
                depth=len(parent_parts) + 1,
            )
            folder_details[folder_path] = entry

        entry.media_count += 1

        if len(relative_parts) > 2:
            subfolder_name = relative_parts[1]
            entry.subfolders.add(subfolder_name)

        if preview_limit > 0:
            if len(entry.previews) < preview_limit:
                entry.previews.append(
                    MediaFolderPreview(
                        id=media_id,
                        path=media_path,
                        filename=filename,
                        thumbnail_path=thumbnail_path,
                    )
                )

    folders = [
        MediaFolderEntry(
            path=entry.path,
            name=entry.name,
            parent_path=entry.parent_path,
            depth=entry.depth,
            media_count=entry.media_count,
            subfolder_count=len(entry.subfolders),
            previews=list(entry.previews),
        )
        for entry in folder_details.values()
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


@router.get("/locations", response_model=list[MediaLocation])
def list_locations(
    session: Session = Depends(get_session),
    north: float | None = None,
    south: float | None = None,
    east: float | None = None,
    west: float | None = None,
):
    """
    Lists media locations. If bounding box parameters (north, south, east, west)
    are provided, it returns only locations within that box.
    """
    stmt = (
        select(
            Media.id,
            Media.thumbnail_path,
            ExifData.lat.label("latitude"),
            ExifData.lon.label("longitude"),
        )
        .join(ExifData, ExifData.media_id == Media.id)
        .where(ExifData.lat.is_not(None), ExifData.lon.is_not(None))
    )

    # Check if all bounding box parameters are present
    if all(p is not None for p in [north, south, east, west]):
        stmt = stmt.where(
            ExifData.lat >= south,
            ExifData.lat <= north,
            ExifData.lon >= west,
            ExifData.lon <= east,
        )

    # Add a reasonable limit to prevent sending overwhelming amounts of data
    # for very dense areas, even within the viewport.
    stmt = stmt.limit(5000)

    rows = session.exec(stmt).all()
    results = []
    for row in rows:
        thumbnail_path = (
            f"{row.id}.jpg" if not row.thumbnail_path else row.thumbnail_path
        )
        results.append(
            MediaLocation(
                id=row.id,
                latitude=row.latitude,
                longitude=row.longitude,
                thumbnail=thumbnail_path,
            )
        )
    return results


@router.get("/images", response_model=CursorPage, summary="List all images")
def list_images(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<value>_<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or"
            " `2500_1234`"
        ),
    ),
):
    stmt = select(Media).where(Media.duration.is_(None))  # images have no duration

    if sort == "newest":
        sort_col = Media.created_at
        parse_val_from_cursor = lambda val_str: datetime.fromisoformat(val_str)
    elif sort == "latest":
        sort_col = Media.inserted_at
        parse_val_from_cursor = lambda val_str: datetime.fromisoformat(val_str)
    else:
        raise ValueError(f"Unsupported sort option: {sort}")

    stmt = stmt.order_by(sort_col.desc(), Media.id.desc())

    if cursor:
        try:
            val_str, id_str = cursor.split("_", 1)
            prev_cursor_val = parse_val_from_cursor(val_str)
            prev_cursor_id = int(id_str)
        except ValueError:
            logger.warning("Warning: Invalid cursor format: %s", cursor)
        else:
            stmt = stmt.where(
                or_(
                    sort_col < prev_cursor_val,
                    and_(sort_col == prev_cursor_val, Media.id < prev_cursor_id),
                )
            )

    medias = session.exec(stmt.limit(limit)).all()
    if len(medias) == limit:
        last = medias[-1]
        v = getattr(last, "created_at" if sort == "newest" else "inserted_at")
        val_token = v.isoformat()
        next_cursor = f"{val_token}_{last.id}"
    else:
        next_cursor = None
    return CursorPage(items=medias, next_cursor=next_cursor)


@router.get("/videos", response_model=CursorPage, summary="List all videos")
def list_videos(
    limit: int = Query(50, ge=1, le=200),
    session: Session = Depends(get_session),
    cursor: str | None = Query(
        None,
        description=(
            "encoded as `<id>`; e.g. `2025-05-05T12:34:56.789012_1234` or `2500_1234`"
        ),
    ),
):
    stmt = select(Media).where(Media.duration != None)  # videos have a duration
    stmt = stmt.order_by(Media.inserted_at.desc())
    if cursor:
        before_id = int(cursor)
        stmt = stmt.where(Media.id < before_id)
    results = session.exec(stmt.limit(limit)).all()
    next_cursor = str(results[-1].id) if len(results) == limit else None
    return CursorPage(items=results, next_cursor=next_cursor)


@router.post("/{media_id}/open-folder", status_code=204)
def open_media_folder(
    media_id: int,
    request: Request,
    session: Session = Depends(get_session),
):
    """Open the directory containing the media file in the OS file browser.

    Only supported when running as a packaged/binary app and not in Docker.
    """
    if settings.general.is_docker:
        raise HTTPException(400, "Opening folders not supported in Docker")
    if not settings.general.is_binary and not _is_local_request(request):
        raise HTTPException(
            400,
            "Opening folders only allowed in the desktop app or from a local session",
        )

    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")

    parent, resolved_file = _resolve_media_parent(media.path)
    logger.debug(parent)
    if not parent or not parent.exists():
        if _is_local_request(request):
            try:
                candidate = Path(media.path).expanduser().resolve(strict=False)
            except Exception:
                candidate = None
            if candidate is not None:
                if candidate.exists():
                    if candidate.is_dir():
                        parent = candidate
                        resolved_file = None
                    else:
                        parent = candidate.parent
                        resolved_file = candidate
                elif candidate.parent.exists():
                    parent = candidate.parent
                    resolved_file = None
        if not parent or not parent.exists():
            raise HTTPException(404, "Media directory not found")

    try:
        _open_in_file_browser(parent, resolved_file)
    except Exception as e:
        raise HTTPException(500, f"Failed to open folder: {e}")
    return


@router.get("/{media_id}/neighbors", response_model=MediaNeighbors)
def get_neighbors(
    media_id: int,
    session: Session = Depends(get_session),
    sort: Annotated[str, Query(enum=["newest", "latest"])] = "newest",
    filter_people: list[int] | None = Query(
        [], description="Provide a persons context for navigation"
    ),
):
    if sort == "newest":
        sort_col = Media.created_at
        sort_col_name = "created_at"
    elif sort == "latest":
        sort_col = Media.inserted_at
        sort_col_name = "inserted_at"
    else:
        raise ValueError(f"Unsupported sort option: {sort}")

    original = session.get(Media, media_id)
    if not original:
        raise HTTPException(404, "Media not found")

    original_sort_value = getattr(original, sort_col_name)
    q = select(Media)

    if filter_people:
        q = q.join(Face, Face.media_id == Media.id).where(
            Face.person_id.in_(filter_people)
        )

    previous_query = (
        q.where(tuple_(sort_col, Media.id) > (original_sort_value, original.id))
        .order_by(sort_col.asc(), Media.id.asc())
        .limit(1)
    )
    next_query = (
        q.where(tuple_(sort_col, Media.id) < (original_sort_value, original.id))
        .order_by(sort_col.desc(), Media.id.desc())
        .limit(1)
    )
    prev_row = session.exec(previous_query).first()
    next_row = session.exec(next_query).first()
    next_media = None
    previous_media = None
    if next_row:
        next_media = MediaPreview.model_validate(next_row)
    if prev_row:
        previous_media = MediaPreview.model_validate(prev_row)
    return MediaNeighbors(
        next_media=next_media,
        previous_media=previous_media,
    )


@router.get("/{media_id}", response_model=MediaDetail)
def get_media(media_id: int, session: Session = Depends(get_session)):
    profile_face_alias = aliased(Face)

    statement = (
        select(
            Media,
            Person,
        )
        .outerjoin(Media.faces)
        .outerjoin(Face.person)
        .outerjoin(profile_face_alias, Person.profile_face)
        .where(Media.id == media_id)
        .group_by(Person.id)
        .options(selectinload(Media.tags))
    )
    rows = session.exec(statement).all()
    if not rows:
        raise HTTPException(404, "Media not found")

    media = rows[0][0]
    seen = set()
    persons: list[PersonRead] = []
    orphans: list[Face] = []
    for _, person in rows:
        if person and person.id not in seen:
            seen.add(person.id)
            persons.append(
                PersonRead(
                    **person.model_dump(),
                    profile_face=(
                        FaceRead(**person.profile_face.model_dump())
                        if person.profile_face
                        else None
                    ),
                )
            )
    orphans = [f for f in media.faces if not f.person]
    return MediaDetail(media=media, persons=persons, orphans=orphans)


@router.get(
    "/{media_id}/scenes.vtt",
    response_class=PlainTextResponse,
    summary="Serve a WebVTT file mapping scene start/end → thumbnail",
)
def scenes_vtt(
    media_id: int, request: Request, session: Session = Depends(get_session)
):
    scenes = session.exec(
        select(Scene).where(Scene.media_id == media_id).order_by(Scene.start_time)
    ).all()
    if not scenes:
        if request.method == "HEAD":
            raise HTTPException(404, "No scenes found for that media")
        empty_vtt = "WEBVTT\n\n"
        return PlainTextResponse(empty_vtt, media_type="text/vtt")

    lines = ["WEBVTT", ""]
    for s in scenes:
        start = format_timestamp(s.start_time)
        end_time = s.end_time or (s.start_time + 0.1)
        end = format_timestamp(end_time)
        lines += [
            f"{start} --> {end}",
            f"/thumbnails/{s.thumbnail_path}",
            "",
        ]

    return PlainTextResponse("\n".join(lines), media_type="text/vtt")


@router.delete(
    "/{media_id}/file",
    summary="Permanently delete the media file & its thumbnail from disk",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_media_file(media_id: int, session: Session = Depends(get_session)):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    delete_file(session, media_id)


@router.delete(
    "/{media_id}",
    summary="Delete media record (and dependent faces) from database",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_media_record(
    media_id: int,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    delete_record(media_id, session)


@router.get("/exif/{media_id}", response_model=ExifData)
def read_exif(media_id: int, session=Depends(get_session)):
    ex = session.exec(select(ExifData).where(ExifData.media_id == media_id)).first()
    if not ex:
        raise HTTPException(404, "No EXIF data")
    return ex


@router.get("/{media_id}/get-similar", response_model=list[MediaPreview])
def get_similar_media(media_id: int, k: int = 8, session=Depends(get_session)):
    # Ensure an anchor embedding exists for this media
    has_vec = session.exec(
        text("SELECT 1 FROM media_embeddings WHERE media_id = :id").bindparams(
            id=media_id
        )
    ).first()
    if not has_vec:
        raise HTTPException(404, "No embedding found for this media")

    max_dist = 2.0 - settings.ai.min_similarity_dist
    # Fully in-DB nearest-neighbor query using the anchor vector via subquery
    rows = session.exec(
        text(
            """
            SELECT media_id
              FROM media_embeddings
             WHERE embedding MATCH (
                       SELECT embedding
                         FROM media_embeddings
                        WHERE media_id = :id
                   )
                AND media_id != :id
               AND k = :k
               AND distance < :maxd
             ORDER BY distance
            """
        ).bindparams(id=media_id, k=k + 1, maxd=max_dist)
    ).all()

    # Exclude the anchor and preserve order; cap to k
    if not rows:
        return []

    media_ids = [row.media_id for row in rows]
    media_objs = session.exec(select(Media).where(Media.id.in_(media_ids))).all()
    id_to_obj = {m.id: m for m in media_objs}
    ordered = [id_to_obj[mid] for mid in media_ids if mid in id_to_obj]
    return [MediaPreview.model_validate(m) for m in ordered]


@router.get("/{media_id}/scenes", response_model=list[SceneRead])
def get_scenes(media_id: int, session: Session = Depends(get_session)):
    return session.exec(
        select(Scene).where(Scene.media_id == media_id).order_by(Scene.start_time)
    ).all()


@router.patch("/{media_id}/geolocation", response_model=MediaRead)
def update_geolocation(
    media_id: int,
    data: GeoUpdate,
    session: Session = Depends(get_session),
):
    if settings.general.presentation_mode:
        return HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    media = session.exec(
        select(Media).options(selectinload(Media.exif)).where(Media.id == media_id)
    ).first()
    if not media:
        raise HTTPException(404, "Media not found")
    try:
        settings.general.ensure_media_path_writable(Path(media.path))
    except ReadOnlyMediaError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    media.exif.lat = data.latitude
    media.exif.lon = data.longitude
    update_exif_gps(media.path, data.longitude, data.latitude)
    session.add(media)
    session.commit()
    session.refresh(media)
    return media
