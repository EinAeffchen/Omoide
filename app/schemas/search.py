from pydantic import BaseModel
from typing import TYPE_CHECKING, Generic, TypeVar

T = TypeVar("T")


class CursorPage(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None


class SceneSearchResult(BaseModel):
    scene_id: int
    media_id: int
    media_filename: str
    media_thumbnail_path: str | None
    scene_thumbnail_path: str | None
    start_time: float
    end_time: float | None
    distance: float


# Imported lazily to avoid circular imports; typed here for IDE support only.
if TYPE_CHECKING:
    from app.schemas.media import MediaPreview
    from app.schemas.person import PersonRead


class CombinedMediaSearchResult(BaseModel):
    """Response for the /search/combined endpoint.

    ``persons`` is populated on the first page (cursor=None) only.
    ``media`` and ``next_cursor`` follow the usual cursor-page pattern.
    """
    persons: list = []   # list[PersonRead]
    media: list = []     # list[MediaPreview]
    next_cursor: str | None = None
