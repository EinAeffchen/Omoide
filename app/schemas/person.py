from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlmodel import SQLModel

from app.schemas.face import FaceRead


class ProfileFace(BaseModel):
    id: int
    thumbnail_path: str


class TagSimple(SQLModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class PersonDetail(BaseModel):
    id: int
    name: str | None
    profile_face_id: int | None
    profile_face: ProfileFace | None
    tags: list[TagSimple]
    appearance_count: int


class PersonUpdate(BaseModel):
    name: str | None = None
    profile_face_id: int | None = None


class PersonMediaExportRequest(BaseModel):
    destination_path: str
    mode: Literal["copy", "move"]


class PersonMedia(SQLModel):
    id: int
    path: str
    duration: float | None
    filename: str
    width: int | None
    height: int | None
    thumbnail_path: str | None


class PersonMinimal(SQLModel):
    id: int
    name: str | None = None


class PersonRead(SQLModel):
    id: int
    name: str | None
    profile_face: FaceRead | None
    appearance_count: int | None

    model_config = ConfigDict(from_attributes=True)


class PersonReadSimple(SQLModel):
    id: int
    name: str | None
    profile_face: FaceRead | None

    model_config = ConfigDict(from_attributes=True)


class MergePersonsRequest(BaseModel):
    source_id: int
    target_id: int


class MergePersonsBulkRequest(BaseModel):
    source_ids: list[int]


class MergePersonsResult(BaseModel):
    merged_ids: list[int]
    skipped_ids: list[int]


class PersonBulkDeleteRequest(BaseModel):
    person_ids: list[int]


class PersonBulkDeleteResponse(BaseModel):
    deleted_ids: list[int]
    skipped_ids: list[int]


class SimilarPerson(SQLModel):
    id: int
    name: str | None
    similarity: float
    thumbnail: str | None = None


class RelationshipNode(BaseModel):
    id: int
    name: str | None
    profile_thumbnail: str | None = None
    depth: int


class RelationshipEdge(BaseModel):
    source: int
    target: int
    weight: int


class RelationshipGraph(BaseModel):
    nodes: list[RelationshipNode]
    edges: list[RelationshipEdge]
    root_id: int
    max_depth: int


class CursorPage(BaseModel):
    items: list[PersonRead]
    next_cursor: str | None


class MediaCursorPage(BaseModel):
    items: list[PersonMedia]
    next_cursor: str | None
