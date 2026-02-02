from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Iterable

from pydantic import BaseModel

from app.models import Media


class MissingSummaryEntry(BaseModel):
    folder: str
    count: int


class MissingMediaRead(BaseModel):
    id: int
    path: str
    filename: str
    size: int
    missing_since: datetime | None
    missing_confirmed: bool
    parent_directory: str
    thumbnail_path: str | None

    @staticmethod
    def from_media(media: Media) -> "MissingMediaRead":
        return MissingMediaRead(
            id=media.id,
            path=media.path,
            filename=media.filename,
            size=media.size,
            missing_since=media.missing_since,
            missing_confirmed=media.missing_confirmed,
            parent_directory=str(Path(media.path).parent),
            thumbnail_path=media.thumbnail_path,
        )


class MissingMediaPage(BaseModel):
    items: list[MissingMediaRead]
    next_cursor: str | None
    total: int
    summary: list[MissingSummaryEntry]


class MissingBulkActionRequest(BaseModel):
    media_ids: list[int] = []
    select_all: bool = False
    exclude_ids: list[int] = []
    path_prefix: str | None = None
    include_confirmed: bool = False


class MissingConfirmResponse(BaseModel):
    deleted: int


class MissingResetResponse(BaseModel):
    cleared: int


def build_summary(entries: Iterable[str], limit: int = 25) -> list[MissingSummaryEntry]:
    counts: dict[str, int] = {}
    for path in entries:
        parent = str(Path(path).parent)
        counts[parent] = counts.get(parent, 0) + 1
    sorted_items = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    top_items = sorted_items[:limit]
    return [MissingSummaryEntry(folder=folder, count=count) for folder, count in top_items]
