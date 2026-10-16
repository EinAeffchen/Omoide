"""Thumbnail storage layout and generation for photos and videos."""

import os
import subprocess
import threading
from pathlib import Path, PurePosixPath, PureWindowsPath

import cv2
import numpy as np
import pillow_heif
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import settings
from app.logger import logger
from app.models import Media
from app.subprocess_helpers import run_silent


pillow_heif.register_heif_opener()


def to_posix_str(s: Path) -> str:
    """
    Get a POSIX-style string (forward slashes) regardless of input style.
    """
    if "\\" in str(s) and "/" not in str(s):
        return PureWindowsPath(s).as_posix()
    return PurePosixPath(s).as_posix()


# Cache of (current folder, file count) per thumbnail base dir so repeated
# calls (e.g. 30k+ during a scan) don't re-list the directory every time.
_thumb_folder_lock = threading.Lock()
_thumb_folder_cache: dict[str, tuple[Path, int]] = {}


def _load_thumb_folder_state(path: Path) -> tuple[Path, int]:
    path.mkdir(parents=True, exist_ok=True)
    folders = [folder for folder in path.iterdir() if folder.is_dir()]
    if not folders:
        new_folder = path / "1"
        new_folder.mkdir(exist_ok=True)
        return new_folder, 0
    folders.sort(key=lambda p: int(p.name))
    latest = folders[-1]
    file_count = sum(1 for file in latest.iterdir() if file.is_file())
    return latest, file_count


def get_thumb_folder(path: Path) -> Path:
    key = os.path.normcase(os.path.abspath(os.fspath(path)))
    with _thumb_folder_lock:
        state = _thumb_folder_cache.get(key)
        if state is None or not state[0].is_dir():
            state = _load_thumb_folder_state(path)
        folder, count = state
        if count >= settings.general.thumb_dir_folder_size:
            folder = path / str(int(folder.name) + 1)
            folder.mkdir(exist_ok=True)
            count = 0
        _thumb_folder_cache[key] = (folder, count + 1)
        return folder


def _apply_thumbnail_orientation(img: Image.Image, source_path: Path) -> Image.Image:
    """Apply EXIF orientation in-memory for thumbnail generation."""
    if not settings.scan.auto_rotate:
        return img
    try:
        return ImageOps.exif_transpose(img)
    except Exception:
        logger.warning(
            "Image: %s has unreadable EXIF orientation data, using un-rotated decode for thumbnail.",
            source_path,
        )
        return img


def _frame_to_image(frame: np.ndarray) -> Image.Image | None:
    """Convert a raw OpenCV BGR frame into a PIL image."""
    if frame is None:
        return None
    try:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    except cv2.error as exc:
        logger.debug("Failed to convert frame to RGB for hashing: %s", exc)
        return None
    return Image.fromarray(rgb)


def save_thumbnail_image(
    media: Media, img: Image.Image
) -> tuple[str | None, str | None]:
    """Persist an already-prepared thumbnail image for a media record."""
    thumb_folder = get_thumb_folder(settings.general.thumb_dir / "media")
    thumb_path = thumb_folder / f"{media.id}.jpg"
    try:
        img.convert("RGB").save(thumb_path, format="JPEG")
    except Exception as exc:
        logger.warning("Failed to save thumbnail for %s: %s", media.path, exc)
        return None, f"Unable to save thumbnail: {exc}"
    return (to_posix_str(thumb_path.relative_to(settings.general.thumb_dir)), None)


def generate_thumbnail(media: Media) -> tuple[str | None, str | None]:
    thumb_folder = get_thumb_folder(settings.general.thumb_dir / "media")
    thumb_path = thumb_folder / f"{media.id}.jpg"
    filepath = Path(media.path)
    if filepath.suffix.lower() in settings.scan.VIDEO_SUFFIXES:
        # Use direct subprocess to enforce a timeout; skip on failure.
        # Single-frame grabs stay on the CPU decoder: hardware decoder setup
        # costs more than decoding one frame.
        last_error: str | None = None
        for seek in ("1", "0"):
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                seek,
                "-i",
                os.fspath(filepath),
                "-vf",
                "scale=360:-1",
                "-vframes",
                "1",
                "-y",
                os.fspath(thumb_path),
            ]
            try:
                run_silent(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=20,
                    check=True,
                )
            except subprocess.TimeoutExpired:
                logger.error(
                    "ffmpeg timed out generating thumbnail for %s (20s)", filepath
                )
                return None, "ffmpeg timed out while generating thumbnail"
            except subprocess.CalledProcessError as e:
                last_error = f"ffmpeg failed to generate thumbnail: {e}"
                logger.debug(
                    "ffmpeg failed with -ss %s for %s, %s",
                    seek,
                    filepath,
                    "retrying with -ss 0" if seek == "1" else "giving up",
                )
                continue
            except Exception as exc:  # pragma: no cover - defensive safeguard
                logger.exception(
                    "Unexpected ffmpeg error while thumbnailing %s: %s", filepath, exc
                )
                return None, f"Unexpected ffmpeg error: {exc}"
            if thumb_path.exists():
                break
        else:
            logger.error("ffmpeg failed to generate thumbnail for %s", filepath)
            return (None, last_error or "ffmpeg did not produce a thumbnail file")
        if not thumb_path.exists():
            return None, "ffmpeg did not produce a thumbnail file"
    else:
        try:
            try:
                with Image.open(filepath) as src_img:
                    img_obj = _apply_thumbnail_orientation(src_img, filepath)
                    img_obj.thumbnail((360, -1))
            except Exception:
                if filepath.suffix.lower() in (".heic", ".heif"):
                    # Spatial HEICs (and other multi-image HEIF containers) can
                    # fail when pillow_heif tries to decode auxiliary depth/
                    # disparity images. Open only the primary image explicitly.
                    heif_file = pillow_heif.open_heif(filepath)
                    img_obj = heif_file[0].to_pillow()
                    img_obj = _apply_thumbnail_orientation(img_obj, filepath)
                    img_obj.thumbnail((360, -1))
                else:
                    raise
            try:
                img_obj.convert("RGB").save(thumb_path, format="JPEG")
            except (OSError, ValueError) as save_exc:
                if filepath.suffix.lower() in (".heic", ".heif"):
                    # Spatial/auxiliary HEIC frames can fail lazy-decode on save;
                    # re-decode the primary frame directly via pillow_heif.
                    try:
                        heif_file = pillow_heif.open_heif(filepath)
                        img_obj = heif_file[0].to_pillow()
                        img_obj = _apply_thumbnail_orientation(img_obj, filepath)
                        img_obj.thumbnail((360, -1))
                        img_obj.convert("RGB").save(thumb_path, format="JPEG")
                    except Exception as heic_exc:
                        logger.warning(
                            "Failed to save HEIC thumbnail for %s: %s",
                            filepath,
                            heic_exc,
                        )
                        return (None, f"Unable to save HEIC thumbnail: {heic_exc}")
                else:
                    logger.warning(
                        "Failed to save thumbnail for %s: %s", filepath, save_exc
                    )
                    return None, f"Unable to save thumbnail: {save_exc}"
        except UnidentifiedImageError:
            logger.warning("Couldn't open %s", filepath)
            return None, "File is not a valid image"
        except OSError as exc:
            logger.warning("Failed to process image %s, because of: %s", filepath, exc)
            return None, f"Unable to read image: {exc}"
        except Exception as exc:
            logger.warning("Unexpected error thumbnailing %s: %s", filepath, exc)
            return None, f"Unexpected error generating thumbnail: {exc}"

        if not thumb_path.is_file():
            return None, "Thumbnail file was not created"
    return (to_posix_str(thumb_path.relative_to(settings.general.thumb_dir)), None)
