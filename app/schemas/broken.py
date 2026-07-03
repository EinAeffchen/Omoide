from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

from app.models import Media


class BrokenMediaItem(BaseModel):
    id: int
    path: str
    filename: str
    size: int
    processing_error: str
    parent_directory: str
    thumbnail_path: str | None
    inserted_at: datetime

    @staticmethod
    def from_media(media: Media) -> "BrokenMediaItem":
        return BrokenMediaItem(
            id=media.id,
            path=media.path,
            filename=media.filename,
            size=media.size,
            processing_error=media.processing_error or "",
            parent_directory=str(Path(media.path).parent),
            thumbnail_path=media.thumbnail_path,
            inserted_at=media.inserted_at,
        )


class BrokenMediaPage(BaseModel):
    items: list[BrokenMediaItem]
    next_cursor: str | None
    total: int


class BrokenResolveRequest(BaseModel):
    media_ids: list[int] = []
    select_all: bool = False
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]


class BrokenResolveResponse(BaseModel):
    removed: int


class BrokenRetryRequest(BaseModel):
    media_ids: list[int] = []
    select_all: bool = False


class BrokenRetryResponse(BaseModel):
    retried: int
    cleared: int
    still_broken: int
