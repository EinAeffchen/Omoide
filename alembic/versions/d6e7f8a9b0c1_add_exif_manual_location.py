"""Track manually set locations on exifdata

`location_set_manually` marks coordinates set in the map editor, which may
exist only in the database (when writing locations into files is disabled).
`extracted` lets a forced EXIF re-run keep such a row while still marking it
as needing extraction.

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-10-21 00:00:00.000000

"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

from alembic import op

revision: str = "d6e7f8a9b0c1"
down_revision: Union[str, None] = "c5d6e7f8a9b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = Inspector.from_engine(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("exifdata")}
    if "location_set_manually" not in columns:
        op.add_column(
            "exifdata",
            sa.Column(
                "location_set_manually",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
        )
    if "extracted" not in columns:
        op.add_column(
            "exifdata",
            sa.Column(
                "extracted", sa.Boolean(), nullable=False, server_default=sa.true()
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("exifdata") as batch:
        batch.drop_column("extracted")
        batch.drop_column("location_set_manually")
