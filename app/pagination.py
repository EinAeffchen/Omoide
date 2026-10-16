"""Keyset (cursor) pagination shared by the list endpoints.

A list is ordered by ``keys``: ``(expression, ascending)`` pairs whose last
entry must be unique (normally the primary key) so the order is total. The
cursor is an opaque token holding the last row's key values plus a ``tag``
naming the ordering, so a cursor from one sort order is rejected by another.
Key expressions must not be NULL for rows in the result; wrap nullable
columns in ``coalesce`` or filter them out.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Sequence
from datetime import date, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session
from sqlmodel.sql.expression import Select, SelectOfScalar

from app.models import Media

SortKey = tuple[ColumnElement, bool]

_DATETIME = "$dt"
_DATE = "$d"


def _encode_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return {_DATETIME: value.isoformat()}
    if isinstance(value, date):
        return {_DATE: value.isoformat()}
    return value


def _decode_value(value: Any) -> Any:
    if isinstance(value, dict):
        if _DATETIME in value:
            return datetime.fromisoformat(value[_DATETIME])
        if _DATE in value:
            return date.fromisoformat(value[_DATE])
        raise ValueError("unknown cursor value")
    return value


def encode_cursor(tag: str, values: Sequence[Any]) -> str:
    raw = json.dumps(
        [tag, *(_encode_value(v) for v in values)], separators=(",", ":")
    ).encode()
    return base64.urlsafe_b64encode(raw).decode()


def decode_cursor(cursor: str, tag: str, key_count: int) -> list[Any]:
    try:
        decoded = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        if not isinstance(decoded, list):
            raise ValueError("cursor is not a list")
        values = [_decode_value(v) for v in decoded[1:]]
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, "Invalid cursor format") from exc
    if len(values) != key_count or decoded[0] != tag:
        raise HTTPException(400, "Cursor does not match the requested sort")
    return values


def keyset_after(keys: Sequence[SortKey], values: Sequence[Any]):
    """Rows strictly after ``values`` in the (possibly mixed-direction) order."""
    clauses = []
    for i, (expr, ascending) in enumerate(keys):
        prefix = [keys[j][0] == values[j] for j in range(i)]
        step = expr > values[i] if ascending else expr < values[i]
        clauses.append(and_(*prefix, step))
    return or_(*clauses)


def paginate(
    session: Session,
    stmt: Select | SelectOfScalar,
    keys: Sequence[SortKey],
    *,
    cursor: str | None,
    limit: int,
    tag: str = "",
) -> tuple[list[Any], str | None]:
    """Return one page of ``stmt``'s rows and the cursor for the next page.

    ``stmt`` selects a single entity (``select(Media).where(...)``) without an
    ORDER BY; ordering comes from ``keys``. The key values are selected along
    with each row, so the next cursor never re-derives them in Python.
    """
    labelled = [expr.label(f"_page_key_{i}") for i, (expr, _) in enumerate(keys)]
    query = stmt.add_columns(*labelled)
    if cursor:
        query = query.where(keyset_after(keys, decode_cursor(cursor, tag, len(keys))))
    query = query.order_by(
        *(expr.asc() if ascending else expr.desc() for expr, ascending in keys)
    )
    # SQLModel's exec() would collapse a select(Entity) to its first column
    # even after add_columns(); the plain ORM execute keeps the key columns.
    rows = OrmSession.execute(session, query.limit(limit)).all()
    items = [row[0] for row in rows]
    next_cursor = None
    if len(rows) == limit:
        next_cursor = encode_cursor(tag, list(rows[-1][1:]))
    return items, next_cursor


def count_rows(session: Session, entity_id: ColumnElement, *conditions) -> int:
    """Total rows matching ``conditions``, for pages that report a total."""
    return int(session.scalar(select(func.count(entity_id)).where(*conditions)) or 0)


def media_newest_first() -> list[SortKey]:
    """The default order of media grids: capture time, newest first."""
    return [(Media.created_at, False), (Media.id, False)]
