"""add person-media manual appearance link table

Revision ID: c13f0d6d8e11
Revises: 71b51c6758b2
Create Date: 2026-02-24 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c13f0d6d8e11"
down_revision: Union[str, None] = "71b51c6758b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "personmedialink",
        sa.Column("person_id", sa.Integer(), nullable=False),
        sa.Column("media_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["person_id"],
            ["person.id"],
        ),
        sa.ForeignKeyConstraint(
            ["media_id"],
            ["media.id"],
        ),
        sa.PrimaryKeyConstraint("person_id", "media_id"),
    )
    op.create_index(
        op.f("ix_personmedialink_media_id"),
        "personmedialink",
        ["media_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_personmedialink_media_id"), table_name="personmedialink")
    op.drop_table("personmedialink")
