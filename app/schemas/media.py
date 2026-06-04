from datetime import datetime

from sqlmodel import SQLModel, Field
from pydantic import ConfigDict, BaseModel

from app.schemas.face import FaceRead
from app.schemas.person import PersonRead, PersonReadSimple
from app.schemas.scene import PersonInScene, SceneCreate, SceneRead
from app.schemas.tag import TagSimple
from app.models import Face, Person, Media


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
    model_config = ConfigDict(from_attributes=True)


class MediaNeighbors(SQLModel):
    next_media: MediaPreview | None
    previous_media: MediaPreview | None


class GeoUpdate(SQLModel):
    latitude: float
    longitude: float


class CursorPage(BaseModel):
    items: list[MediaPreview]
    next_cursor: str | None


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
