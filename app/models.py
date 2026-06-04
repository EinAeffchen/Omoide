import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Optional

import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, Relationship, SQLModel


class Status(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    FAILED = "failed"


class TimelineEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    description: Optional[str] = None
    event_date: date

    # For recurrence, a simple string is robust and easy to start with
    # e.g., "yearly", "monthly". We'll start with just "yearly".
    recurrence: Optional[str] = Field(default=None)

    person_id: int = Field(foreign_key="person.id", index=True)
    person: "Person" = Relationship(back_populates="timeline_events")


class MediaTagLink(SQLModel, table=True):
    media_id: int = Field(default=None, foreign_key="media.id", primary_key=True)
    tag_id: int = Field(default=None, foreign_key="tag.id", primary_key=True)
    auto_score: float | None = Field(default=None)


class PersonMediaLink(SQLModel, table=True):
    person_id: int = Field(default=None, foreign_key="person.id", primary_key=True)
    media_id: int = Field(default=None, foreign_key="media.id", primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)

    person: "Person" = Relationship(back_populates="media_links")
    media: "Media" = Relationship(back_populates="person_links")


class Blacklist(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    path: str = Field(unique=True, index=True)


class PersonTagLink(SQLModel, table=True):
    person_id: int = Field(default=None, foreign_key="person.id", primary_key=True)
    tag_id: int = Field(default=None, foreign_key="tag.id", primary_key=True)


class Tag(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)

    media: list["Media"] = Relationship(
        back_populates="tags",
        link_model=MediaTagLink,
        sa_relationship_kwargs={"lazy": "selectin"},
    )
    persons: list["Person"] = Relationship(
        back_populates="tags",
        link_model=PersonTagLink,
        sa_relationship_kwargs={"lazy": "selectin"},
    )

    class Config:
        from_attributes = True


class Face(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    media_id: int = Field(foreign_key="media.id", index=True)
    person_id: int | None = Field(foreign_key="person.id", default=None, index=True)
    thumbnail_path: str | None = Field(default=None)
    bbox: list[int] = Field(sa_column=Column(JSON))
    timestamp: float | None = Field(default=None, nullable=True)  # video frame time in seconds

    media: "Media" = Relationship(back_populates="faces")
    person: Optional["Person"] = Relationship(
        back_populates="faces",
        sa_relationship_kwargs={"foreign_keys": "[Face.person_id]"},
    )

    class Config:
        from_attributes = True


class Media(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    path: str = Field(unique=True)
    filename: str = Field(index=True)
    thumbnail_path: str | None = Field(default=None, nullable=True)
    size: int
    duration: float | None = None
    width: int | None = None
    height: int | None = None
    views: int = Field(default=0, index=True)
    inserted_at: datetime = Field(default_factory=datetime.now, index=True)
    created_at: datetime = Field(default_factory=datetime.now, index=True)

    faces_extracted: bool = Field(default=False, index=True)
    embeddings_created: bool = Field(default=False, index=True)
    ran_auto_tagging: bool = Field(default=False)
    extracted_scenes: bool = Field(default=False)

    missing_since: datetime | None = Field(default=None, index=True)
    missing_confirmed: bool = Field(default=False, index=True)

    processing_error: str | None = Field(default=None, nullable=True)

    is_favorite: bool = Field(default=False)
    phash: str | None = Field(index=True)
    laplacian_score: float | None = Field(default=None, nullable=True, index=True)
    faces: list["Face"] = Relationship(back_populates="media")
    scenes: list["Scene"] = Relationship(back_populates="media")
    tags: list[Tag] = Relationship(back_populates="media", link_model=MediaTagLink)
    exif: "ExifData" = Relationship(back_populates="media")
    duplicate_entries: list["DuplicateMedia"] = Relationship(back_populates="media")
    person_links: list[PersonMediaLink] = Relationship(back_populates="media")

    class Config:
        from_attributes = True

    def __eq__(self, other: "Media"):
        if not isinstance(other, Media):
            return False

        if self.id == other.id:
            return True
        return False


class Scene(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    media_id: int = Field(foreign_key="media.id", index=True)
    start_time: float  # in seconds
    end_time: float  # in seconds
    thumbnail_path: str | None = Field(
        default=None, nullable=True
    )  # relative path under THUMB_DIR
    description: str | None = Field(default=None)

    media: "Media" = Relationship(back_populates="scenes")


class Person(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    name: str | None = None
    age: int | None = None
    gender: str | None = None
    views: int = Field(default=0, index=True)
    faces: list["Face"] = Relationship(
        back_populates="person",
        sa_relationship_kwargs={
            # same idea: this relationship uses Face.person_id to point back
            "foreign_keys": "[Face.person_id]"
        },
    )
    is_favorite: bool = Field(default=False)
    profile_face_id: int | None = Field(foreign_key="face.id", default=None, index=True)
    profile_face: Face | None = Relationship(
        sa_relationship_kwargs={
            "primaryjoin": "Person.profile_face_id==Face.id",
            "foreign_keys": "[Person.profile_face_id]",
            "uselist": False,
            "lazy": "selectin",
        }
    )
    tags: list[Tag] = Relationship(back_populates="persons", link_model=PersonTagLink)
    appearance_count: int = Field(default=None, index=True)
    timeline_events: list["TimelineEvent"] = Relationship(back_populates="person")
    media_links: list[PersonMediaLink] = Relationship(back_populates="person")

    class Config:
        from_attributes = True


class ProcessingTask(SQLModel, table=True):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), primary_key=True)
    task_type: str
    status: Status = Field(
        sa_column=sa.Column(
            sa.Enum(Status, values_callable=lambda obj: [item.value for item in obj]),
            default=Status.PENDING,
            nullable=False,
            index=True,
        )
    )
    total: int = Field(default=0)
    processed: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.now)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    class Config:
        from_attributes = True


# Read model that augments ProcessingTask with transient fields.
# These fields are not stored in the DB; we only use them for API responses.
class ProcessingTaskRead(ProcessingTask, table=False):
    current_item: str | None = None
    current_step: str | None = None
    failure_count: int | None = None
    merge_total: int | None = None
    merge_processed: int | None = None
    merge_pending: int | None = None


class ExifData(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    media_id: int = Field(foreign_key="media.id", index=True)

    # camera & capture
    make: str | None = Field(default=None, index=True)
    model: str | None = Field(default=None, index=True)
    timestamp: datetime | None = Field(default=None, index=True)

    # lens / exposure
    iso: int | None = Field(default=None, index=True)
    exposure_time: str | None = Field(default=None)
    aperture: str | None = Field(default=None)
    focal_length: float | None = Field(default=None)

    # GPS
    lat: float | None = Field(default=None, index=True)
    lon: float | None = Field(default=None, index=True)

    media: Media = Relationship(back_populates="exif")


class DuplicateGroup(SQLModel, table=True):
    id: int = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

    media_links: list["DuplicateMedia"] = Relationship(back_populates="group")


class DuplicateIgnore(SQLModel, table=True):
    media_id_a: int = Field(foreign_key="media.id", primary_key=True)
    media_id_b: int = Field(foreign_key="media.id", primary_key=True)
    created_at: datetime = Field(default_factory=datetime.now)

    class Config:
        from_attributes = True


class DuplicateMedia(SQLModel, table=True):
    group_id: int = Field(foreign_key="duplicategroup.id", primary_key=True)
    media_id: int = Field(foreign_key="media.id", primary_key=True)

    group: DuplicateGroup = Relationship(back_populates="media_links")
    media: Media = Relationship(back_populates="duplicate_entries")


class PersonRelationship(SQLModel, table=True):
    __tablename__ = "person_relationship"

    person_a_id: int = Field(foreign_key="person.id", primary_key=True)
    person_b_id: int = Field(foreign_key="person.id", primary_key=True)
    coappearance_count: int = Field(default=0, index=True)
    last_media_id: int | None = Field(default=None, foreign_key="media.id")
    updated_at: datetime = Field(default_factory=datetime.utcnow)
