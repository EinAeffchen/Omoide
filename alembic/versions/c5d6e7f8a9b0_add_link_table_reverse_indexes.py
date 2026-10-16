"""Index the second key column of link tables

Composite primary keys only serve lookups on their leading column, so
queries going the other way (media of a tag, albums/events/duplicate groups
of a media, the "b" side of relationships and duplicate ignores) scanned the
whole table.

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-10-16 00:00:00.000000

"""

from typing import Sequence, Union

from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, column) pairs; index names follow SQLModel's ix_<table>_<column>.
INDEXES = [
    ("mediataglink", "tag_id"),
    ("persontaglink", "tag_id"),
    ("albummedialink", "media_id"),
    ("eventmedialink", "media_id"),
    ("duplicatemedia", "media_id"),
    ("duplicateignore", "media_id_b"),
    ("person_relationship", "person_b_id"),
    ("personmedialink", "media_id"),
]


def upgrade() -> None:
    inspector = Inspector.from_engine(op.get_bind())
    tables = set(inspector.get_table_names())
    for table, column in INDEXES:
        if table not in tables:
            continue
        existing = {ix["name"] for ix in inspector.get_indexes(table)}
        name = f"ix_{table}_{column}"
        if name not in existing:
            op.create_index(name, table, [column])


def downgrade() -> None:
    # personmedialink's index predates this revision (c13f0d6d8e11).
    for table, column in INDEXES:
        if table == "personmedialink":
            continue
        op.drop_index(f"ix_{table}_{column}", table_name=table)
