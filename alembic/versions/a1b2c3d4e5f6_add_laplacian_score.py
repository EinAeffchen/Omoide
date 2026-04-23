"""Add laplacian_score column to media

Revision ID: a1b2c3d4e5f6
Revises: c13f0d6d8e11
Create Date: 2026-04-22 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c13f0d6d8e11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c["name"] for c in inspector.get_columns("media")]
    indices = [i["name"] for i in inspector.get_indexes("media")]
    if "laplacian_score" not in columns:
        op.add_column(
            "media",
            sa.Column("laplacian_score", sa.Float(), nullable=True),
        )
    if "ix_media_laplacian_score" not in indices:
        op.create_index(
            "ix_media_laplacian_score",
            "media",
            ["laplacian_score"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_media_laplacian_score", table_name="media")
    op.drop_column("media", "laplacian_score")
