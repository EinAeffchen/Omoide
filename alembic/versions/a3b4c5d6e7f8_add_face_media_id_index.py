"""Add missing index on face.media_id

The Face model has declared media_id as indexed since it was introduced,
but databases created before that never got a matching index (index=True
on a SQLModel field only affects fresh table creation, not existing
tables). Without it, any query that counts/filters faces per media
(e.g. Highlights scoring) does a full table scan of `face` for every
candidate media row.

Revision ID: a3b4c5d6e7f8
Revises: f7a8b9c0d1e2
Create Date: 2026-08-03 00:00:00.000000

"""

from typing import Sequence, Union

from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    existing = {ix["name"] for ix in inspector.get_indexes("face")}
    if "ix_face_media_id" not in existing:
        op.create_index("ix_face_media_id", "face", ["media_id"])


def downgrade() -> None:
    op.drop_index("ix_face_media_id", table_name="face")
