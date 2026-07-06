"""Add album/event tables and reverse-geocoded place columns on exifdata

Revision ID: e5f6a7b8c9d0
Revises: d1e2f3a4b5c6
Create Date: 2026-07-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    tables = inspector.get_table_names()

    if "album" not in tables:
        op.create_table(
            "album",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(), nullable=False, index=True),
            sa.Column("description", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column(
                "cover_media_id",
                sa.Integer(),
                sa.ForeignKey("media.id"),
                nullable=True,
            ),
        )

    if "albummedialink" not in tables:
        op.create_table(
            "albummedialink",
            sa.Column(
                "album_id",
                sa.Integer(),
                sa.ForeignKey("album.id"),
                primary_key=True,
            ),
            sa.Column(
                "media_id",
                sa.Integer(),
                sa.ForeignKey("media.id"),
                primary_key=True,
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    if "event" not in tables:
        op.create_table(
            "event",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("title", sa.String(), nullable=True),
            sa.Column("start_at", sa.DateTime(), nullable=False, index=True),
            sa.Column("end_at", sa.DateTime(), nullable=False, index=True),
            sa.Column("media_count", sa.Integer(), nullable=False),
            sa.Column(
                "cover_media_id",
                sa.Integer(),
                sa.ForeignKey("media.id"),
                nullable=True,
            ),
        )

    if "eventmedialink" not in tables:
        op.create_table(
            "eventmedialink",
            sa.Column(
                "event_id",
                sa.Integer(),
                sa.ForeignKey("event.id"),
                primary_key=True,
            ),
            sa.Column(
                "media_id",
                sa.Integer(),
                sa.ForeignKey("media.id"),
                primary_key=True,
            ),
        )

    if "exifdata" in tables:
        columns = [c["name"] for c in inspector.get_columns("exifdata")]
        if "city" not in columns:
            op.add_column("exifdata", sa.Column("city", sa.String(), nullable=True))
            op.create_index("ix_exifdata_city", "exifdata", ["city"])
        if "country" not in columns:
            op.add_column(
                "exifdata", sa.Column("country", sa.String(), nullable=True)
            )
            op.create_index("ix_exifdata_country", "exifdata", ["country"])


def downgrade() -> None:
    op.drop_table("eventmedialink")
    op.drop_table("event")
    op.drop_table("albummedialink")
    op.drop_table("album")
    op.drop_index("ix_exifdata_city", "exifdata")
    op.drop_index("ix_exifdata_country", "exifdata")
    op.drop_column("exifdata", "city")
    op.drop_column("exifdata", "country")
