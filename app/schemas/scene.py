from sqlmodel import SQLModel


class PersonInScene(SQLModel):
    id: int
    name: str | None
    profile_face_id: int | None = None
    profile_thumbnail: str | None = None


class SceneRead(SQLModel):
    id: int
    start_time: float
    end_time: float
    thumbnail_path: str | None = None
    description: str | None = None
    persons: list[PersonInScene] = []


class SceneCreate(SQLModel):
    start_time: float
    end_time: float | None = None
    description: str | None = None
