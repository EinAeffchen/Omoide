from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class BlurMediaItem(BaseModel):
    id: int
    filename: str
    path: str
    size: int
    thumbnail_path: str | None
    laplacian_score: float
    width: int | None
    height: int | None
    duration: float | None
    inserted_at: datetime

    class Config:
        from_attributes = True


class BlurPage(BaseModel):
    items: list[BlurMediaItem]
    next_cursor: str | None
    total: int


class BlurResolveRequest(BaseModel):
    media_ids: list[int] = []
    action: Literal["DELETE_FILES", "DELETE_RECORDS", "BLACKLIST_RECORDS"]
    select_all: bool = False
    threshold: float = 100.0
    media_type: str | None = None
