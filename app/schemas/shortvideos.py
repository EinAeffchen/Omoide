from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ShortVideoItem(BaseModel):
    id: int
    filename: str
    path: str
    size: int
    thumbnail_path: str | None
    width: int | None
    height: int | None
    duration: float
    inserted_at: datetime

    class Config:
        from_attributes = True


class ShortVideoPage(BaseModel):
    items: list[ShortVideoItem]
    next_cursor: str | None
    total: int


class ShortVideoResolveRequest(BaseModel):
    media_ids: list[int] = []
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]
    select_all: bool = False
    max_duration: float = 10.0
