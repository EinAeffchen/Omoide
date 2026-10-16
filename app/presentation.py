"""Presentation (read-only) mode enforcement.

Presentation mode can only be enabled through the Docker runtime environment.
While it is on, ``enforce_presentation_mode`` (installed as an app-wide
dependency) rejects every request that is not a read, so new endpoints are
protected without having to remember a per-endpoint check.
"""

from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException, Request, status

from app.config import settings

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_READ_ONLY_MARKER = "__omoide_read_only__"

_F = TypeVar("_F", bound=Callable)


def _forbidden() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Not allowed in presentation mode.",
    )


def ensure_writable() -> None:
    """Raise 403 in presentation mode.

    The request guard already covers endpoints; use this in helpers that
    change data and can also be reached outside a request (task launchers,
    shared delete helpers), or as a dependency to block a whole router.
    """
    if settings.general.presentation_mode:
        raise _forbidden()


def allow_in_presentation_mode(endpoint: _F) -> _F:
    """Mark a non-GET endpoint that only reads (e.g. search by uploaded
    image) so the presentation-mode guard lets it through."""
    setattr(endpoint, _READ_ONLY_MARKER, True)
    return endpoint


def enforce_presentation_mode(request: Request) -> None:
    """App-wide dependency: in presentation mode only reads pass."""
    if not settings.general.presentation_mode or request.method in SAFE_METHODS:
        return
    if getattr(request.scope.get("endpoint"), _READ_ONLY_MARKER, False):
        return
    raise _forbidden()
