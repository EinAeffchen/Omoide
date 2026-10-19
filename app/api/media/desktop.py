"""Desktop-only actions that reveal or open media in the local file browser."""

import os
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from app.config import settings
from app.database import get_session
from app.logger import logger
from app.models import Media

router = APIRouter()


def _is_within(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def _resolve_media_parent(path_value: str) -> tuple[Path | None, Path | None]:
    raw = Path(path_value)
    media_dirs = [base for base, _ in settings.general.resolved_media_dirs()]
    candidates: list[Path] = []

    if raw.is_absolute():
        candidates.append(raw)
    else:
        candidates.append(Path("/") / raw)

    for media_dir in media_dirs:
        candidates.append(media_dir / raw)

    seen: set[Path] = set()
    for candidate in candidates:
        try:
            normalized = candidate.resolve(strict=False)
        except RuntimeError:
            continue

        if normalized in seen:
            continue
        seen.add(normalized)

        if media_dirs and not any(
            _is_within(normalized, media_dir) for media_dir in media_dirs
        ):
            continue

        if normalized.exists():
            if normalized.is_dir():
                return normalized, None
            return normalized.parent, normalized

        parent = normalized.parent
        if parent.exists():
            return parent, None

    return None, None


def is_local_request(request: Request) -> bool:
    try:
        host = request.client.host if request.client else ""
    except Exception:
        return False
    return host in {"127.0.0.1", "::1", "localhost"}


def _select_in_explorer_windows(target: Path) -> None:
    # Use the shell API to avoid Explorer /select flakiness.
    import ctypes
    from ctypes import wintypes

    ole32 = ctypes.windll.ole32
    shell32 = ctypes.windll.shell32

    ole32.CoInitialize.argtypes = [ctypes.c_void_p]
    ole32.CoInitialize.restype = ctypes.c_long
    ole32.CoUninitialize.argtypes = []
    ole32.CoUninitialize.restype = None

    shell32.ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]
    shell32.ILCreateFromPathW.restype = ctypes.c_void_p
    shell32.ILFree.argtypes = [ctypes.c_void_p]
    shell32.ILFree.restype = None
    shell32.SHOpenFolderAndSelectItems.argtypes = [
        ctypes.c_void_p,
        wintypes.UINT,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    shell32.SHOpenFolderAndSelectItems.restype = ctypes.c_long

    hr = ole32.CoInitialize(None)
    com_initialized = hr in (0, 1)
    try:
        pidl = shell32.ILCreateFromPathW(str(target))
        if not pidl:
            raise OSError("ILCreateFromPathW failed")
        try:
            hr = shell32.SHOpenFolderAndSelectItems(pidl, 0, None, 0)
            if hr != 0:
                raise OSError(f"SHOpenFolderAndSelectItems failed: {hr}")
        finally:
            shell32.ILFree(pidl)
    finally:
        if com_initialized:
            ole32.CoUninitialize()


def _open_in_file_browser(parent: Path, resolved_file: Path | None) -> None:
    if sys.platform.startswith("win"):
        if resolved_file and resolved_file.exists():
            try:
                _select_in_explorer_windows(resolved_file)
                return
            except Exception as e:
                logger.warning("Failed to select file in Explorer via shell API: %s", e)
            explorer_path = os.path.join(os.environ["WINDIR"], "explorer.exe")
            normalized_file_path = os.path.normpath(str(resolved_file))
            try:
                subprocess.run(
                    [explorer_path, "/select,", normalized_file_path],
                    shell=False,
                    check=True,
                )
                return
            except Exception as e:
                logger.warning("Failed to open file in Explorer: %s", e)
        try:
            logger.debug("Opening folder through alternative opener")
            os.startfile(str(parent))
            return
        except Exception as e:
            logger.warning("Failed to open folder via startfile: %s", e)
            subprocess.Popen(["explorer.exe", str(parent)], shell=False)
        return

    if sys.platform == "darwin":
        if resolved_file and resolved_file.exists():
            subprocess.Popen(["open", "-R", str(resolved_file)])
        else:
            subprocess.Popen(["open", str(parent)])
        return

    subprocess.Popen(["xdg-open", str(parent)])


@router.post("/{media_id}/open-folder", status_code=204)
def open_media_folder(
    media_id: int, request: Request, session: Session = Depends(get_session)
):
    """Open the directory containing the media file in the OS file browser.

    Only supported when running as a packaged/binary app and not in Docker.
    """
    if settings.general.is_docker:
        raise HTTPException(400, "Opening folders not supported in Docker")
    if not settings.general.is_binary and not is_local_request(request):
        raise HTTPException(
            400,
            "Opening folders only allowed in the desktop app or from a local session",
        )

    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")

    parent, resolved_file = _resolve_media_parent(media.path)
    logger.debug(parent)
    if not parent or not parent.exists():
        if is_local_request(request):
            try:
                candidate = Path(media.path).expanduser().resolve(strict=False)
            except Exception:
                candidate = None
            if candidate is not None:
                if candidate.exists():
                    if candidate.is_dir():
                        parent = candidate
                        resolved_file = None
                    else:
                        parent = candidate.parent
                        resolved_file = candidate
                elif candidate.parent.exists():
                    parent = candidate.parent
                    resolved_file = None
        if not parent or not parent.exists():
            raise HTTPException(404, "Media directory not found")

    try:
        _open_in_file_browser(parent, resolved_file)
    except Exception as e:
        raise HTTPException(500, f"Failed to open folder: {e}")


@router.post("/{media_id}/open-file", status_code=204)
def open_media_file(
    media_id: int, request: Request, session: Session = Depends(get_session)
):
    """Open the media file directly in the OS default application.

    Only supported when running as a packaged/binary app and not in Docker.
    """
    if settings.general.is_docker:
        raise HTTPException(400, "Opening files not supported in Docker")
    if not settings.general.is_binary and not is_local_request(request):
        raise HTTPException(
            400, "Opening files only allowed in the desktop app or from a local session"
        )

    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")

    _, resolved_file = _resolve_media_parent(media.path)
    if not resolved_file:
        if is_local_request(request):
            try:
                candidate = Path(media.path).expanduser().resolve(strict=False)
            except Exception:
                candidate = None
            if candidate is not None and candidate.is_file():
                resolved_file = candidate
        if not resolved_file:
            raise HTTPException(404, "Media file not found")

    try:
        if sys.platform.startswith("win"):
            os.startfile(str(resolved_file))
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(resolved_file)])
        else:
            subprocess.Popen(["xdg-open", str(resolved_file)])
    except Exception as e:
        raise HTTPException(500, f"Failed to open file: {e}")
