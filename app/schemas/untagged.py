from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class UntaggedMediaItem(BaseModel):
    id: int
    filename: str
    path: str
    size: int
    thumbnail_path: str | None
    width: int | None
    height: int | None
    duration: float | None
    inserted_at: datetime

    class Config:
        from_attributes = True


class UntaggedPage(BaseModel):
    items: list[UntaggedMediaItem]
    next_cursor: str | None
    total: int


class UntaggedResolveRequest(BaseModel):
    media_ids: list[int]
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]
