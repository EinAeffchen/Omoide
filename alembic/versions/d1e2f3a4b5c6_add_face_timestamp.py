"""Add timestamp column to face table

Revision ID: d1e2f3a4b5c6
Revises: b2c3d4e5f6a7
Create Date: 2026-05-19 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c["name"] for c in inspector.get_columns("face")]
    if "timestamp" not in columns:
        op.add_column(
            "face",
            sa.Column("timestamp", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("face", "timestamp")
