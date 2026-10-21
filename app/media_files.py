"""Reading media files: capture dates, EXIF/ffprobe metadata and GPS writing."""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import imagehash
import piexif
import pillow_heif
from dateutil import parser as date_parser
from PIL import ExifTags, Image, UnidentifiedImageError

from app.config import settings
from app.logger import logger
from app.models import Media
from app.phash import generate_perceptual_hash
from app.subprocess_helpers import run_silent
from app.thumbnails import _apply_thumbnail_orientation


def _read_exif_datetime(img: Image.Image) -> str | None:
    """Read the EXIF taken date from an open image.

    Uses the modern Exif API, which works for every PIL plugin (including
    pillow_heif's HEIC/HEIF images); the legacy _getexif() only exists on the
    JPEG/TIFF plugins. Prefers DateTimeOriginal, then DateTime.
    """
    try:
        exif = img.getexif()
        value = exif.get_ifd(ExifTags.IFD.Exif).get(
            ExifTags.Base.DateTimeOriginal
        ) or exif.get(ExifTags.Base.DateTime)
        if value:
            return str(value)
    except Exception:
        pass
    try:
        legacy = img._getexif()
    except (AttributeError, SyntaxError):
        legacy = None
    if legacy and (value := legacy.get(36867)):
        return str(value)
    return None


def _exif_taken_date(img: Image.Image, img_path: Path) -> datetime:
    """Extract the EXIF taken date from an already-open image.

    Falls back to the file creation time when no usable EXIF date exists.
    """
    alt_time = datetime.fromtimestamp(img_path.stat().st_ctime)
    creation_date = _read_exif_datetime(img)
    if creation_date:
        try:
            return datetime.strptime(creation_date, "%Y:%m:%d %H:%M:%S")
        except ValueError:
            logger.debug("Received invalid time for %s: %s", img_path, creation_date)
    return alt_time


def get_image_taken_date(img_path: Path | None = None) -> datetime:
    try:
        with Image.open(str(img_path)) as img:
            return _exif_taken_date(img, img_path)
    except UnidentifiedImageError:
        # fallback use creation time
        return datetime.fromtimestamp(img_path.stat().st_ctime)


def _parse_video_creation_time(value: str) -> datetime | None:
    """Parse a container creation_time tag into a naive local datetime.

    The tag is usually an ISO timestamp in UTC; convert it to local time and
    drop the tzinfo so it compares consistently with EXIF dates. Epoch-era
    placeholder dates written by some encoders are treated as missing.
    """
    try:
        parsed = date_parser.parse(value)
    except (ValueError, OverflowError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    if parsed.year < 1980:
        return None
    return parsed


def get_video_taken_date(video_path: Path) -> datetime | None:
    """Read the recording date from a video's container metadata."""
    probe = _ffprobe_json(video_path)
    if not probe:
        return None
    tags = probe.get("format", {}).get("tags") or {}
    creation = tags.get("creation_time")
    if not creation:
        return None
    return _parse_video_creation_time(str(creation))


def _ffprobe_json(path: Path, timeout: int = 15) -> dict | None:
    """Run ffprobe with a timeout and return parsed JSON, or None on failure.

    Using subprocess directly allows us to enforce a timeout to avoid hangs
    on corrupted or tricky media files.
    """

    def _run(arg_path: str) -> tuple[dict | None, str | None]:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            arg_path,
        ]
        try:
            result = run_silent(
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return None, f"timeout after {timeout}s"
        except Exception as exc:
            return None, str(exc)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()
            return None, stderr or f"ffprobe exited with {result.returncode}"
        try:
            return json.loads(result.stdout or "{}"), None
        except json.JSONDecodeError as exc:
            return None, f"invalid ffprobe output: {exc}"

    data, err = _run(os.fspath(path))
    if data is not None:
        return data

    if sys.platform.startswith("win"):
        encoded = "file:" + quote(path.as_posix(), safe="/:")
        if encoded != os.fspath(path):
            data, err = _run(encoded)
            if data is not None:
                return data

    if err:
        logger.warning("ffprobe failed for %s: %s", path, err)
    return None


def _open_primary_image(filepath: Path) -> Image.Image:
    """Open an image, falling back to the primary HEIF frame for containers
    that fail default decoding (e.g. spatial HEICs with depth images)."""
    try:
        return Image.open(filepath)
    except UnidentifiedImageError:
        raise
    except Exception:
        if filepath.suffix.lower() in (".heic", ".heif"):
            heif_file = pillow_heif.open_heif(filepath)
            return heif_file[0].to_pillow()
        raise


def process_file(filepath: Path) -> tuple[Media | None, Image.Image | None, str | None]:
    """Reads metadata from the file and prepares a Media record.

    Images are decoded exactly once: dimensions, EXIF taken date, perceptual
    hash and a resized thumbnail image all come from the same decode. The
    prepared thumbnail (second element, images only) still needs to be saved
    via save_thumbnail_image() once the record has an id.

    Adds timeouts to external probing to avoid hangs and returns a tuple of
    (Media | None, thumbnail image | None, error message | None).
    """
    try:
        try:
            size = os.path.getsize(filepath)
        except OSError as exc:
            logger.warning("Could not stat %s: %s", filepath, exc)
            return None, None, f"Unable to read file information: {exc}"

        suffix = filepath.suffix.lower()

        duration: float | None = None
        width: int | None = None
        height: int | None = None
        phash: str | None = None
        taken_at: datetime | None = None
        thumb_img: Image.Image | None = None

        if suffix in settings.scan.VIDEO_SUFFIXES:
            # Prefer ffprobe with a timeout for videos
            probe = _ffprobe_json(filepath, timeout=15)
            if probe:
                try:
                    duration = float(probe.get("format", {}).get("duration", 0))
                except Exception:
                    duration = 0.0
                try:
                    vs = [
                        s
                        for s in probe.get("streams", [])
                        if s.get("codec_type") == "video"
                    ]
                    if vs:
                        width = int(vs[0].get("width") or 0) or None
                        height = int(vs[0].get("height") or 0) or None
                except Exception:
                    width = width or None
                    height = height or None
                tags = probe.get("format", {}).get("tags") or {}
                creation = tags.get("creation_time")
                if creation:
                    taken_at = _parse_video_creation_time(str(creation))
            else:
                logger.warning("Skipping video probe metadata for %s", filepath)
                # Preserve video classification even if metadata probe fails.
                duration = 0.0
        else:
            # Images: avoid ffprobe entirely; decode once with PIL and derive
            # dimensions, EXIF date, phash and the thumbnail from that decode.
            try:
                with _open_primary_image(filepath) as im:
                    width, height = im.size
                    taken_at = _exif_taken_date(im, filepath)
                    try:
                        phash = str(imagehash.phash(im))
                    except Exception:
                        logger.warning(
                            "Failed to generate perceptual hash for %s",
                            filepath,
                            exc_info=True,
                        )
                    thumb_img = _apply_thumbnail_orientation(im, filepath)
                    if thumb_img is im:
                        thumb_img = im.copy()
                    thumb_img.thumbnail((360, -1))
            except UnidentifiedImageError:
                thumb_img = None
                logger.warning("Skipping %s, not an image!", filepath)
            except (OSError, ValueError) as exc:
                thumb_img = None
                logger.warning("Image %s could not be opened: %s", filepath, exc)

        if taken_at is None:
            taken_at = datetime.fromtimestamp(filepath.stat().st_ctime)

        media = Media(
            path=str(filepath),
            filename=filepath.name,
            size=size,
            duration=duration,
            width=width,
            height=height,
            faces_extracted=False,
            embeddings_created=False,
            created_at=taken_at,
            embedding=None,
            phash=phash,
        )
        if media.duration is not None:
            media.phash = generate_perceptual_hash(media, type="video")
        return media, thumb_img, None
    except Exception as exc:  # pragma: no cover - defensive safeguard
        logger.exception("Failed to process file %s: %s", filepath, exc)
        return None, None, str(exc)


def _decimal_to_dms(value: float):
    """
    Convert decimal degrees into the EXIF rational format:
    ((deg,1),(min,1),(sec*100,100))
    """
    deg = int(abs(value))
    minutes_full = (abs(value) - deg) * 60
    minute = int(minutes_full)
    sec = round((minutes_full - minute) * 60 * 100)  # two‐decimals
    return ((deg, 1), (minute, 1), (sec, 100))


def update_exif_gps(path: str, lon: float, lat: float):
    try:
        exif_dict: dict = piexif.load(path)
    except Exception:
        exif_dict: dict = {
            "0th": {},
            "Exif": {},
            "GPS": {},
            "1st": {},
            "thumbnail": None,
        }

    lat_ref = b"N" if lat >= 0 else b"S"
    lng_ref = b"E" if lon >= 0 else b"W"
    lat_dms = _decimal_to_dms(lat)
    lng_dms = _decimal_to_dms(lon)
    gps_ifd = {
        piexif.GPSIFD.GPSLatitudeRef: lat_ref,
        piexif.GPSIFD.GPSLatitude: lat_dms,
        piexif.GPSIFD.GPSLongitudeRef: lng_ref,
        piexif.GPSIFD.GPSLongitude: lng_dms,
    }
    exif_dict["GPS"].update(gps_ifd)
    exif_bytes = piexif.dump(exif_dict)
    try:
        # Write the EXIF block in place without re-encoding the pixel data.
        piexif.insert(exif_bytes, str(path))
    except PermissionError:
        # Not a format problem: re-saving would fail the same way and hide
        # the real reason, so let the caller report it.
        raise
    except Exception:
        # Non-JPEG formats: re-save with the updated EXIF attached to the
        # original (un-transposed) image so the Orientation tag stays valid.
        with Image.open(str(path)) as img:
            img.save(str(path), exif=exif_bytes)
