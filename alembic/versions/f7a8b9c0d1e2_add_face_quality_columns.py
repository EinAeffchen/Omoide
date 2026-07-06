"""Add det_score and frontality columns to face table

Revision ID: f7a8b9c0d1e2
Revises: e5f6a7b8c9d0
Create Date: 2026-07-05 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c["name"] for c in inspector.get_columns("face")]
    if "det_score" not in columns:
        op.add_column(
            "face",
            sa.Column("det_score", sa.Float(), nullable=True),
        )
    if "frontality" not in columns:
        op.add_column(
            "face",
            sa.Column("frontality", sa.Float(), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("face", "frontality")
    op.drop_column("face", "det_score")
