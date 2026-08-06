"""Add title_is_custom column to event table

Marks events whose title was manually set by the user, so "Rebuild events"
can carry the title over to the best-matching new cluster instead of
overwriting it with an auto-generated one.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-08-03 00:00:01.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "b4c5d6e7f8a9"
down_revision: Union[str, None] = "a3b4c5d6e7f8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [c["name"] for c in inspector.get_columns("event")]
    if "title_is_custom" not in columns:
        op.add_column(
            "event",
            sa.Column(
                "title_is_custom",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )


def downgrade() -> None:
    op.drop_column("event", "title_is_custom")
