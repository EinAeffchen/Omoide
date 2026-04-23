from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class LowResMediaItem(BaseModel):
    id: int
    filename: str
    path: str
    size: int
    thumbnail_path: str | None
    width: int
    height: int
    pixel_count: int
    duration: float | None
    inserted_at: datetime

    class Config:
        from_attributes = True


class LowResPage(BaseModel):
    items: list[LowResMediaItem]
    next_cursor: str | None
    total: int


class LowResResolveRequest(BaseModel):
    media_ids: list[int]
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]
