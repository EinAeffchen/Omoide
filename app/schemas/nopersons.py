from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class NoPersonsMediaItem(BaseModel):
    id: int
    filename: str
    path: str
    size: int
    thumbnail_path: str | None
    width: int | None
    height: int | None
    duration: float | None
    inserted_at: datetime
    faces_extracted: bool

    class Config:
        from_attributes = True


class NoPersonsPage(BaseModel):
    items: list[NoPersonsMediaItem]
    next_cursor: str | None
    total: int


class NoPersonsResolveRequest(BaseModel):
    media_ids: list[int] = []
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]
    select_all: bool = False
    media_type: str | None = None
    scope: str = "processed"
