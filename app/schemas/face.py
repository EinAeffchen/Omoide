from pydantic import BaseModel, ConfigDict


class FaceRead(BaseModel):
    id: int
    media_id: int
    thumbnail_path: str
    similarity: float | None = None
    timestamp: float | None = None

    model_config = ConfigDict(from_attributes=True)


class FaceAssign(BaseModel):
    person_id: int
    face_ids: list[int]


class FaceAssignReturn(BaseModel):
    face_id: int
    person_id: int


class CursorPage(BaseModel):
    items: list[FaceRead]
    next_cursor: str | None
