from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlmodel import Field, SQLModel

from app.models import Face, Person
from app.schemas.face import FaceRead
from app.schemas.person import PersonRead, PersonReadSimple
from app.schemas.scene import SceneRead
from app.schemas.tag import TagSimple


class MediaRead(SQLModel):
    id: int
    path: str
    filename: str
    size: int
    duration: float | None
    width: int | None
    height: int | None
    views: int
    inserted_at: datetime
    created_at: datetime
    faces: list[FaceRead]
    persons: list[PersonReadSimple] = []  # we'll fill this in manually
    scenes: list[SceneRead]
    tags: list[TagSimple]
    extracted_scenes: bool
    thumbnail_path: str | None = None
    is_favorite: bool = False

    model_config = ConfigDict(from_attributes=True)


class MediaPreview(SQLModel):
    id: int
    filename: str
    duration: float | None
    width: int | None
    height: int | None
    views: int
    path: str
    inserted_at: datetime
    created_at: datetime
    thumbnail_path: str | None
    size: int | None
    is_favorite: bool = False


class MediaLocation(SQLModel):
    id: int
    latitude: float
    longitude: float
    thumbnail: str


class FaceWithPerson(SQLModel):
    id: int
    thumbnail_path: str
    person: Person  # your Person model


class MediaDetail(SQLModel):
    media: MediaRead
    persons: list[PersonRead] = Field(default_factory=list)
    faces: list[Face] = Field(default_factory=list)
    orphans: list[Face] = Field(default_factory=list)
    # A browser-playable copy exists at /api/media/{id}/converted.
    converted_available: bool = False
    model_config = ConfigDict(from_attributes=True)


class GeoUpdate(SQLModel):
    latitude: float
    longitude: float


class FavoriteUpdate(SQLModel):
    is_favorite: bool


class CursorPage(BaseModel):
    items: list[MediaPreview]
    next_cursor: str | None


class MissingGeoMedia(MediaPreview):
    # Why a location cannot be written into this file; None when it can (or
    # when locations are only stored in the database).
    write_block_reason: str | None = None


class MissingGeoPage(BaseModel):
    items: list[MissingGeoMedia]
    next_cursor: str | None


class MissingGeoFolder(BaseModel):
    # Forward-slash path, passed back as the `folder` filter.
    path: str
    name: str
    # 0 for a configured media directory (or a folder outside all of them).
    depth: int
    # Un-located media in this folder and all of its subfolders.
    media_count: int
    # None when locations are only stored in the database.
    write_status: Literal["writable", "blocked", "mixed"] | None = None
    write_block_reason: str | None = None


class MissingGeoFolders(BaseModel):
    folders: list[MissingGeoFolder]
    write_to_files: bool


class MediaFolderPreview(BaseModel):
    id: int
    path: str
    filename: str
    thumbnail_path: str | None = None


class MediaFolderEntry(BaseModel):
    path: str
    name: str
    parent_path: str | None
    depth: int
    media_count: int
    subfolder_count: int
    previews: list[MediaFolderPreview] = Field(default_factory=list)


class MediaFolderBreadcrumb(BaseModel):
    name: str
    path: str | None


class MediaFolderListing(BaseModel):
    current_path: str | None
    parent_path: str | None
    depth: int
    direct_media_count: int
    folders: list[MediaFolderEntry] = Field(default_factory=list)
    breadcrumbs: list[MediaFolderBreadcrumb] = Field(default_factory=list)
