import json
import math
import os
import subprocess
import sys
import threading
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Literal
from urllib.parse import quote

import cv2
import imagehash
import numpy as np
import piexif
import pillow_heif
from dateutil import parser as date_parser
from fastapi import HTTPException
from PIL import ExifTags, Image, ImageOps, UnidentifiedImageError
from scenedetect import (
    FrameTimecode,
    HistogramDetector,
    SceneManager,
    open_video,
)
from scenedetect.video_splitter import TimecodePair
from sqlalchemy import delete, distinct, func, or_, text, union_all
from sqlmodel import Session, delete, select, text, update

from app.accelerators import get_ffmpeg_accel_config
from app.config import settings
from app.database import safe_commit
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.models import (
    Album,
    AlbumMediaLink,
    DuplicateIgnore,
    DuplicateMedia,
    Event,
    EventMediaLink,
    ExifData,
    Face,
    Media,
    MediaTagLink,
    Person,
    PersonMediaLink,
    PersonRelationship,
    PersonTagLink,
    ProcessingTask,
    Scene,
    TimelineEvent,
)
from app.subprocess_helpers import run_silent

pillow_heif.register_heif_opener()


def _coerce_vector_array(value: Any) -> np.ndarray | None:
    """Normalize assorted embedding representations into a 1D float32 array."""
    if value is None:
        return None

    if isinstance(value, np.ndarray):
        arr = value.astype(np.float32, copy=False)
    elif isinstance(value, memoryview) or isinstance(
        value, (bytes, bytearray)
    ):
        arr = np.frombuffer(value, dtype=np.float32)
    elif isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            logger.debug(
                "Failed to decode embedding JSON; value=%s", value[:32]
            )
            return None
        return _coerce_vector_array(parsed)
    else:
        try:
            arr = np.asarray(value, dtype=np.float32)
        except (TypeError, ValueError):
            return None

    if arr.ndim == 0:
        return None
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    return arr


def vector_to_blob(value: Any) -> bytes | None:
    """Convert a sequence/JSON/blob embedding to the raw bytes sqlite-vec expects."""
    arr = _coerce_vector_array(value)
    if arr is None:
        return None
    return arr.tobytes()


def vector_from_stored(value: Any) -> np.ndarray | None:
    """Decode a stored sqlite-vec embedding (bytes/JSON/list) into a numpy vector."""
    arr = _coerce_vector_array(value)
    if arr is None:
        return None
    return arr


def recalculate_person_appearance_counts(
    session: Session, person_ids: Iterable[int]
) -> None:
    ids = {pid for pid in person_ids if pid is not None}
    if not ids:
        return

    session.flush()

    appearance_pairs = union_all(
        select(
            Face.person_id.label("person_id"),
            Face.media_id.label("media_id"),
        ).where(Face.person_id.in_(ids)),
        select(
            PersonMediaLink.person_id.label("person_id"),
            PersonMediaLink.media_id.label("media_id"),
        ).where(PersonMediaLink.person_id.in_(ids)),
    ).subquery()

    rows = session.exec(
        select(
            appearance_pairs.c.person_id,
            func.count(distinct(appearance_pairs.c.media_id)),
        ).group_by(appearance_pairs.c.person_id)
    ).all()
    counts = {pid: count for pid, count in rows}
    for pid in ids:
        person = session.get(Person, pid)
        if person is None:
            continue
        person.appearance_count = counts.get(pid, 0)
        session.add(person)


def auto_select_profile_face(session: Session, person_id: int) -> int | None:
    """Assigns a suitable profile face for the given person.

    Prefers the face whose embedding is closest to the centroid of the
    person's embeddings (same approach as clustering). Falls back to
    a thumbnail/area heuristic when embeddings are missing.
    Returns the selected face id, or None if no face could be chosen.
    """
    person = session.get(Person, person_id)
    if not person:
        return None

    faces = session.exec(select(Face).where(Face.person_id == person_id)).all()

    if not faces:
        if person.profile_face_id is not None:
            person.profile_face_id = None
            session.add(person)
        return None

    embedding_face_ids: list[int] = []
    embedding_vectors: list[np.ndarray] = []

    for face in faces:
        row = session.exec(
            text(
                """
                SELECT embedding
                  FROM face_embeddings
                 WHERE face_id = :fid
                """
            ).bindparams(fid=face.id)
        ).first()
        if not row:
            continue
        vector = vector_from_stored(row[0])
        if vector is None or vector.size == 0:
            continue
        norm = float(np.linalg.norm(vector))
        if not np.isfinite(norm) or norm == 0.0:
            continue
        embedding_face_ids.append(face.id)
        embedding_vectors.append(
            (vector / norm).astype(np.float32, copy=False)
        )

    best_face_id: int | None = None
    if embedding_face_ids:
        embeddings_arr = np.vstack(embedding_vectors)
        centroid = embeddings_arr.mean(axis=0)
        centroid_norm = float(np.linalg.norm(centroid))
        if centroid_norm > 0:
            centroid = centroid / centroid_norm
        similarities = embeddings_arr @ centroid
        best_face_id = int(embedding_face_ids[int(np.argmax(similarities))])

    def fallback_score(face: Face) -> tuple[int, int, int]:
        has_thumb = 1 if face.thumbnail_path else 0
        area = 0
        try:
            if face.bbox and len(face.bbox) >= 4:
                x1, y1, x2, y2 = face.bbox[:4]
                area = max(0, int(x2) - int(x1)) * max(0, int(y2) - int(y1))
        except Exception:  # pragma: no cover - defensive
            area = 0
        return (has_thumb, area, -face.id)

    if best_face_id is None or not any(
        face.id == best_face_id for face in faces
    ):
        best_face = max(faces, key=fallback_score)
        best_face_id = best_face.id

    if person.profile_face_id != best_face_id:
        person.profile_face_id = best_face_id
        session.add(person)
    return best_face_id


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
            logger.debug(
                "Received invalid time for %s: %s", img_path, creation_date
            )
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


def process_file(
    filepath: Path,
) -> tuple[Media | None, Image.Image | None, str | None]:
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
                    duration = float(
                        probe.get("format", {}).get("duration", 0)
                    )
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
                logger.warning(
                    "Skipping video probe metadata for %s", filepath
                )
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
                logger.warning(
                    "Image %s could not be opened: %s", filepath, exc
                )

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


def _apply_thumbnail_orientation(
    img: Image.Image, source_path: Path
) -> Image.Image:
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


def _generate_video_perceptual_hash(media: Media) -> str | None:
    """Derive a single perceptual hash for a video by sampling a few frames."""
    path = Path(media.path)
    if not path.exists():
        logger.warning("Video path does not exist for hashing: %s", path)
        return None

    target_samples = 8
    cap = cv2.VideoCapture(os.fspath(path))
    if not cap.isOpened():
        logger.warning("Could not open video for hashing: %s", path)
        return None

    try:
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        duration = float(media.duration or 0.0)
        if duration <= 0 and fps > 0 and frame_count > 0:
            duration = frame_count / fps

        timestamps: list[float] = []
        if duration > 0:
            effective_samples = (
                min(target_samples, frame_count)
                if frame_count
                else target_samples
            )
            effective_samples = max(effective_samples, 1)
            timestamps = (
                np
                .linspace(
                    0,
                    max(duration - 1.0 / max(fps, 1.0), 0),
                    effective_samples,
                    endpoint=False,
                )
                .astype(float)
                .tolist()
            )
        elif fps > 0 and frame_count > 0:
            frame_indices = np.linspace(
                0,
                frame_count - 1,
                min(target_samples, frame_count),
                dtype=np.int64,
            )
            timestamps = [int(idx) / fps for idx in frame_indices]

        hashes: list[imagehash.ImageHash] = []

        def _hash_frame_at(ts_seconds: float) -> None:
            cap.set(cv2.CAP_PROP_POS_MSEC, ts_seconds * 1000.0)
            success, frame = cap.read()
            if not success:
                return
            img = _frame_to_image(frame)
            if img is None:
                return
            try:
                hashes.append(imagehash.phash(img))
            except Exception as exc:
                logger.debug(
                    "Failed to hash video frame at %.2fs (%s): %s",
                    ts_seconds,
                    path,
                    exc,
                )

        for ts in timestamps:
            _hash_frame_at(ts)
            if len(hashes) >= target_samples:
                break

        if not hashes:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            remaining = min(
                target_samples,
                frame_count if frame_count > 0 else target_samples,
            )
            while remaining > 0:
                success, frame = cap.read()
                if not success:
                    break
                img = _frame_to_image(frame)
                if img is None:
                    remaining -= 1
                    continue
                try:
                    hashes.append(imagehash.phash(img))
                except Exception:
                    pass
                remaining -= 1

        if not hashes:
            return None

        try:
            hash_matrix = np.stack([h.hash for h in hashes]).astype(np.float32)
        except ValueError:
            return str(hashes[0])

        majority = hash_matrix.mean(axis=0) >= 0.5
        combined = imagehash.ImageHash(majority)
        return str(combined)
    finally:
        cap.release()


def generate_perceptual_hash(
    media: Media, type: Literal["image", "video"]
) -> str | None:
    try:
        if type == "image":
            with Image.open(media.path) as img:
                return str(imagehash.phash(img))
        if type == "video":
            return _generate_video_perceptual_hash(media)
    except Exception:
        logger.warning(
            "Failed to generate perceptual hash for %s",
            media.path,
            exc_info=True,
        )


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
    return (
        to_posix_str(thumb_path.relative_to(settings.general.thumb_dir)),
        None,
    )


def generate_thumbnail(media: Media) -> tuple[str | None, str | None]:
    thumb_folder = get_thumb_folder(settings.general.thumb_dir / "media")
    thumb_path = thumb_folder / f"{media.id}.jpg"
    filepath = Path(media.path)
    if filepath.suffix.lower() in settings.scan.VIDEO_SUFFIXES:
        # Use direct subprocess to enforce a timeout; skip on failure
        accel = get_ffmpeg_accel_config(
            getattr(settings.processors, "prefer_gpu", True)
        )
        last_error: str | None = None
        for seek in ("1", "0"):
            cmd = [
                "ffmpeg",
                *accel.hwaccel_args,
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
                    "ffmpeg timed out generating thumbnail for %s (20s)",
                    filepath,
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
                    "Unexpected ffmpeg error while thumbnailing %s: %s",
                    filepath,
                    exc,
                )
                return None, f"Unexpected ffmpeg error: {exc}"
            if thumb_path.exists():
                break
        else:
            logger.error(
                "ffmpeg failed to generate thumbnail for %s", filepath
            )
            return (
                None,
                last_error or "ffmpeg did not produce a thumbnail file",
            )
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
                        img_obj = _apply_thumbnail_orientation(
                            img_obj, filepath
                        )
                        img_obj.thumbnail((360, -1))
                        img_obj.convert("RGB").save(thumb_path, format="JPEG")
                    except Exception as heic_exc:
                        logger.warning(
                            "Failed to save HEIC thumbnail for %s: %s",
                            filepath,
                            heic_exc,
                        )
                        return (
                            None,
                            f"Unable to save HEIC thumbnail: {heic_exc}",
                        )
                else:
                    logger.warning(
                        "Failed to save thumbnail for %s: %s",
                        filepath,
                        save_exc,
                    )
                    return None, f"Unable to save thumbnail: {save_exc}"
        except UnidentifiedImageError:
            logger.warning("Couldn't open %s", filepath)
            return None, "File is not a valid image"
        except OSError as exc:
            logger.warning(
                "Failed to process image %s, because of: %s", filepath, exc
            )
            return None, f"Unable to read image: {exc}"
        except Exception as exc:
            logger.warning(
                "Unexpected error thumbnailing %s: %s", filepath, exc
            )
            return None, f"Unexpected error generating thumbnail: {exc}"

        if not thumb_path.is_file():
            return None, "Thumbnail file was not created"
    return (
        to_posix_str(thumb_path.relative_to(settings.general.thumb_dir)),
        None,
    )


def get_person_embedding(
    session: Session,
    person_id: int,
    face_embeddings: list | None = None,
    new: bool = False,
) -> bytes | None:
    if not face_embeddings:
        if not new:
            person_embedding = session.exec(
                text(
                    "SELECT embedding FROM person_embeddings WHERE person_id=:p_id"
                ).bindparams(p_id=person_id)
            ).first()
            if person_embedding:
                blob = vector_to_blob(person_embedding[0])
                if blob:
                    return blob

        face_embeddings = [
            row[0]
            for row in session.exec(
                text(
                    "SELECT embedding FROM face_embeddings WHERE person_id = :p_id"
                ).bindparams(p_id=person_id)
            ).all()
        ]

    if not face_embeddings:
        logger.warning("No embeddings found for person %s", person_id)
        return None

    vectors: list[np.ndarray] = []
    for emb in face_embeddings:
        vec = vector_from_stored(emb)
        if vec is None:
            continue
        vectors.append(vec.astype(np.float32, copy=False))

    if not vectors:
        logger.warning("All embeddings were invalid for person %s", person_id)
        return None

    embeddings_array = np.stack(vectors)
    centroid = embeddings_array.mean(axis=0)
    norm = float(np.linalg.norm(centroid))
    if np.isfinite(norm) and norm > 0.0:
        centroid /= norm

    blob = vector_to_blob(centroid)
    return blob


def update_person_embedding(session: Session, person_id: int):
    centroid = get_person_embedding(session, person_id, new=True)
    if centroid is None:
        return
    del_sql = text(
        """
        DELETE FROM person_embeddings WHERE person_id=:p_id
    """
    ).bindparams(p_id=person_id)
    session.exec(del_sql)
    sql = text(
        """
        INSERT INTO person_embeddings(person_id, embedding)
        VALUES (:p_id, :emb)
    """
    ).bindparams(p_id=person_id, emb=centroid)
    session.exec(sql)
    safe_commit(session)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(a.dot(b) / (na * nb))


def _split_by_scenes(
    media: Media, scenes: Iterable[TimecodePair]
) -> list[tuple[Scene, cv2.typing.MatLike]]:
    """Extract one frame per detected scene.

    Detected scenes are contiguous (each scene ends where the next begins),
    so a single parallel extraction pass over the start timestamps rebuilds
    the same ranges — one decode per scene instead of two serial ffmpeg runs.
    """
    scene_list = list(scenes)
    if not scene_list:
        return []
    timestamps = [float(start.get_seconds()) for start, _ in scene_list]
    duration = float(scene_list[-1][1].get_seconds())
    return _extract_frames_at(media, timestamps, duration)


def _extract_frame_worker(
    ffmpeg_binary: Path,
    accel,
    video_path: Path,
    ts: float,
    idx: int,
    timestamps: list[float],
    duration: float,
    media_id: int,
) -> tuple[int, tuple | None]:
    """Extract one video frame at timestamp *ts* and write its thumbnail.

    Returns (idx, (ts, next_ts, frame_rgb, thumb_file)) on success or
    (idx, None) on any failure.  Designed to run inside a ThreadPoolExecutor —
    each call spawns its own ffmpeg process so there is no shared mutable state.
    """
    cmd = [
        str(ffmpeg_binary),
        *accel.hwaccel_args,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{ts}",
        "-i",
        os.fspath(video_path),
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-strict",
        "-1",
        "-vcodec",
        "mjpeg",
        "-",
    ]
    try:
        result = run_silent(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except Exception as exc:
        logger.warning("ffmpeg frame extraction failed at %.2fs: %s", ts, exc)
        return idx, None

    if result.returncode != 0 or not result.stdout:
        logger.debug(
            "ffmpeg returned no data for %.2fs (code=%s, stderr=%s)",
            ts,
            result.returncode,
            result.stderr.decode(errors="ignore"),
        )
        return idx, None

    frame_buf = np.frombuffer(result.stdout, np.uint8)
    frame_bgr = cv2.imdecode(frame_buf, cv2.IMREAD_COLOR)
    if frame_bgr is None:
        return idx, None

    height, width = frame_bgr.shape[:2]
    if width <= 0 or height <= 0:
        return idx, None

    target_width = 360
    if width > target_width:
        scale = target_width / float(width)
        new_size = (target_width, max(1, int(height * scale)))
        thumb_bgr = cv2.resize(
            frame_bgr, new_size, interpolation=cv2.INTER_AREA
        )
    else:
        thumb_bgr = frame_bgr

    thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")
    thumb_file = thumb_dir / f"{media_id}_frame_{idx}.jpg"
    cv2.imwrite(str(thumb_file), thumb_bgr)

    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    next_ts = (
        timestamps[idx + 1] if idx + 1 < len(timestamps) else max(ts, duration)
    )
    return idx, (ts, next_ts, frame_rgb, thumb_file)


def extract_scene_frame_and_thumbnail(
    media: Media, start_time: float
) -> tuple[str | None, np.ndarray | None]:
    """Extract one frame at *start_time* from a video, save a thumbnail, and
    return (thumbnail_relative_posix_path, frame_rgb) or (None, None) on failure.
    """
    import time as _t

    video_path = Path(media.path)
    if not video_path.exists():
        logger.warning("Video file missing: %s", video_path)
        return None, None

    ffmpeg_binary = ensure_ffmpeg_available()
    if not ffmpeg_binary:
        logger.error("ffmpeg is required but could not be provisioned.")
        return None, None

    accel = get_ffmpeg_accel_config(False)
    thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")
    thumb_file = thumb_dir / f"{media.id}_manual_{int(_t.time() * 1000)}.jpg"

    cmd = [
        str(ffmpeg_binary),
        *accel.hwaccel_args,
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(start_time),
        "-i",
        os.fspath(video_path),
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-strict",
        "-1",
        "-vcodec",
        "mjpeg",
        "-",
    ]
    try:
        result = run_silent(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except Exception as exc:
        logger.warning(
            "Frame extraction failed at %.2fs for %s: %s",
            start_time,
            media.path,
            exc,
        )
        return None, None

    if result.returncode != 0 or not result.stdout:
        logger.warning(
            "ffmpeg returned no data at %.2fs for %s (code=%s)",
            start_time,
            media.path,
            result.returncode,
        )
        return None, None

    frame_buf = np.frombuffer(result.stdout, np.uint8)
    frame_bgr = cv2.imdecode(frame_buf, cv2.IMREAD_COLOR)
    if frame_bgr is None:
        return None, None

    height, width = frame_bgr.shape[:2]
    if width <= 0 or height <= 0:
        return None, None

    target_width = 360
    if width > target_width:
        scale = target_width / float(width)
        thumb_bgr = cv2.resize(
            frame_bgr,
            (target_width, max(1, int(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        thumb_bgr = frame_bgr

    cv2.imwrite(str(thumb_file), thumb_bgr)
    frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    thumb_relative = to_posix_str(
        thumb_file.relative_to(settings.general.thumb_dir)
    )
    return thumb_relative, frame_rgb


def _extract_frames_at(
    media: Media, timestamps: list[float], duration: float
) -> list[tuple[Scene, cv2.typing.MatLike]]:
    """Extract one frame + thumbnail per timestamp and build contiguous
    Scene entries (each scene ends where the next one starts)."""
    if not timestamps:
        return []
    video_path = Path(media.path)
    if not video_path.exists():
        logger.warning("Video file missing: %s", video_path)
        return []

    ffmpeg_binary = ensure_ffmpeg_available()
    if not ffmpeg_binary:
        logger.error(
            "ffmpeg is required to extract scenes but could not be provisioned."
        )
        return []
    accel = get_ffmpeg_accel_config(False)

    # Run ffmpeg subprocesses in parallel — each seeks independently so wall
    # time drops from O(N) to O(1) relative to the number of workers.
    # Cap at 4 workers to avoid thrashing spinning disks or overloading CPU.
    max_workers = min(4, len(timestamps))
    frame_results: dict[int, tuple] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _extract_frame_worker,
                ffmpeg_binary,
                accel,
                video_path,
                ts,
                idx,
                timestamps,
                duration,
                media.id,
            ): idx
            for idx, ts in enumerate(timestamps)
        }
        for future in as_completed(futures):
            try:
                idx, data = future.result()
            except Exception as exc:
                logger.warning("Frame extraction worker raised: %s", exc)
                continue
            if data is not None:
                frame_results[idx] = data

    # Reassemble in original timestamp order
    scene_entries: list[tuple[Scene, cv2.typing.MatLike]] = []
    for idx in sorted(frame_results):
        ts, next_ts, frame_rgb, thumb_file = frame_results[idx]
        scene = Scene(
            media_id=media.id,
            start_time=float(ts),
            end_time=float(max(ts, next_ts)),
            thumbnail_path=to_posix_str(
                thumb_file.relative_to(settings.general.thumb_dir)
            ),
        )
        scene_entries.append((scene, frame_rgb))

    return scene_entries


def _split_by_frames(media: Media) -> list[tuple[Scene, cv2.typing.MatLike]]:
    logger.info("Splitting based on frames via ffmpeg")
    video_path = Path(media.path)
    if not video_path.exists():
        logger.warning("Video file missing: %s", video_path)
        return []

    duration = media.duration or 0.0
    if not duration:
        probe = _ffprobe_json(video_path)
        if probe:
            try:
                duration = float(probe.get("format", {}).get("duration", 0.0))
            except Exception:
                duration = 0.0

    max_frames = max(1, int(settings.video.max_frames_per_video))
    timestamps: list[float] = []
    if duration and duration > 0:
        step = duration / max_frames
        min_step = 2
        step = max(step, min_step)
        timestamps = [max(0.0, i * step) for i in range(max_frames)]
        # Seeks at or past EOF never return a frame; don't spawn ffmpeg for them.
        timestamps = [ts for ts in timestamps if ts < duration]
        if timestamps and timestamps[-1] + 1.0 < duration:
            timestamps.append(duration)
    else:
        timestamps = [float(i) for i in range(max_frames)]

    return _extract_frames_at(media, timestamps, duration)


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
    except Exception:
        # Non-JPEG formats: re-save with the updated EXIF attached to the
        # original (un-transposed) image so the Orientation tag stays valid.
        with Image.open(str(path)) as img:
            img.save(str(path), exif=exif_bytes)


def complete_task(session: Session, task: ProcessingTask):
    task.status = "completed"
    task.finished_at = datetime.now(UTC)
    session.add(task)
    safe_commit(session)


def _limit_scene_results(
    scenes: list[tuple[FrameTimecode, FrameTimecode]],
    duration_seconds: float | None,
    *,
    max_total: int = 50,
    min_total: int = 3,
    density_window_seconds: float = 5.0,
) -> list[tuple[FrameTimecode, FrameTimecode]]:
    """Clamp the number of detected scenes to keep UX predictable.

    - Never exceed `max_total` scenes.
    - Roughly limit density to one scene every `density_window_seconds`.
    - Always keep at least `min_total` scenes when possible so short videos
      still receive good search coverage.
    """
    if not scenes:
        return []

    if duration_seconds is None or duration_seconds <= 0:
        try:
            duration_seconds = float(scenes[-1][1].get_seconds())
        except Exception:
            duration_seconds = 0.0

    if duration_seconds <= 0:
        target_count = min(max_total, max(len(scenes), min_total))
    else:
        max_by_density = int(
            math.ceil(duration_seconds / density_window_seconds)
        )
        target_count = min(max_total, max(min_total, max_by_density))

    if len(scenes) <= target_count:
        return scenes

    step = (len(scenes) - 1) / max(target_count - 1, 1)
    selected_indices: list[int] = []
    for i in range(target_count):
        idx = int(round(i * step))
        idx = max(0, min(idx, len(scenes) - 1))
        if not selected_indices or idx != selected_indices[-1]:
            selected_indices.append(idx)

    limited = [scenes[i] for i in selected_indices]
    if len(limited) < min_total and len(scenes) >= min_total:
        # Ensure we don't fall below the desired minimum due to rounding.
        limited = scenes[: min(len(scenes), max(min_total, len(limited)))]
    return limited


_SCENE_MIN_LEN_FRAMES = 500
# split_video only uses detection results when they contain at least this
# many scenes; anything shorter falls back to frame sampling.
_SCENE_MIN_USEFUL_SCENES = 3


def _video_frame_count(path: Path, media: Media) -> int:
    """Read the frame count from the container header (no decoding)."""
    cap = cv2.VideoCapture(os.fspath(path))
    try:
        if not cap.isOpened():
            return 0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0 and media.duration:
            fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
            if fps > 0:
                total = int(float(media.duration) * fps)
        return max(total, 0)
    finally:
        cap.release()


def _detect_video_scenes(media: Media, path: Path) -> list[TimecodePair]:
    """Scene-detect a video, skipping work that cannot produce a usable result.

    Detection decodes the whole file, so videos too short to ever contain
    the minimum number of minimum-length scenes skip it entirely — they
    would fall back to frame sampling anyway.
    """
    total_frames = _video_frame_count(path, media)
    if (
        total_frames
        and total_frames < _SCENE_MIN_USEFUL_SCENES * _SCENE_MIN_LEN_FRAMES
    ):
        logger.debug(
            "Skipping scene detection for %s (%d frames is too short).",
            path,
            total_frames,
        )
        return []

    logger.debug("Detecting scenes...")
    frame_skip = max(0, int(settings.video.scene_detection_frame_skip))
    video = open_video(str(path))
    manager = SceneManager()
    manager.add_detector(
        HistogramDetector(
            threshold=0.2,
            min_scene_len=_SCENE_MIN_LEN_FRAMES,
            # adaptive_threshold=3, window_width=5, min_scene_len=500
        )
    )
    manager.detect_scenes(video, frame_skip=frame_skip, show_progress=False)
    return manager.get_scene_list()


def split_video(
    media: Media, path: Path
) -> list[tuple[Scene, cv2.typing.MatLike]]:
    """Returns select frames from a video and a list of scenes"""
    if settings.video.auto_scene_detection:
        scenes = _detect_video_scenes(media, path)

        duration_seconds: float | None = None
        try:
            if media.duration is not None:
                duration_seconds = float(media.duration)
        except Exception:
            duration_seconds = None

        limited_scenes = _limit_scene_results(scenes, duration_seconds)
        if len(limited_scenes) >= _SCENE_MIN_USEFUL_SCENES:
            if len(limited_scenes) < len(scenes):
                logger.debug(
                    "Trimming scene list from %d to %d entries (duration≈%.2fs)",
                    len(scenes),
                    len(limited_scenes),
                    (duration_seconds or 0.0),
                )
            return _split_by_scenes(media, limited_scenes)

    return _split_by_frames(media)


def delete_record(media_id, session: Session):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    to_unlink: list[Path] = []
    thumbnail = media.thumbnail_path
    if not thumbnail:
        thumbnail = str(media.id)
    thumb = Path(settings.general.thumb_dir / thumbnail)
    if thumb.is_file():
        to_unlink.append(thumb)
    faces = session.exec(select(Face).where(Face.media_id == media.id)).all()
    affected_person_ids: set[int] = set()
    linked_person_ids = session.exec(
        select(PersonMediaLink.person_id).where(
            PersonMediaLink.media_id == media.id
        )
    ).all()
    for linked_person_id in linked_person_ids:
        if linked_person_id is not None:
            affected_person_ids.add(linked_person_id)
    for face in faces:
        if face.person_id is not None:
            affected_person_ids.add(face.person_id)
        if face.thumbnail_path:
            thumb = Path(settings.general.thumb_dir / face.thumbnail_path)
            if thumb.is_file():
                to_unlink.append(thumb)
        sql = text(
            """
            DELETE FROM face_embeddings
            WHERE face_id=:f_id
            """
        ).bindparams(f_id=face.id)
        session.exec(sql)

    sql = text(
        """
        DELETE FROM media_embeddings
        WHERE media_id=:m_id
        """
    ).bindparams(m_id=media.id)
    session.exec(sql)

    session.exec(
        text(
            """
            DELETE FROM scene_embeddings
            WHERE media_id = :m_id
            """
        ).bindparams(m_id=media.id)
    )

    faces = session.exec(select(Face).where(Face.media_id == media.id)).all()
    face_ids = [f.id for f in faces]
    if face_ids:
        session.exec(
            update(Person)
            .where(Person.profile_face_id.in_(face_ids))
            .values(profile_face_id=None)
        )
    session.exec(delete(Face).where(Face.media_id == media_id))
    session.exec(
        delete(PersonMediaLink).where(PersonMediaLink.media_id == media_id)
    )
    session.exec(delete(MediaTagLink).where(MediaTagLink.media_id == media_id))
    session.exec(delete(ExifData).where(ExifData.media_id == media_id))
    session.exec(delete(Scene).where(Scene.media_id == media.id))
    session.exec(
        delete(PersonRelationship).where(
            PersonRelationship.last_media_id == media.id
        )
    )
    session.exec(
        delete(DuplicateMedia).where(DuplicateMedia.media_id == media.id)
    )
    session.exec(
        delete(DuplicateIgnore).where(
            or_(
                DuplicateIgnore.media_id_a == media.id,
                DuplicateIgnore.media_id_b == media.id,
            )
        )
    )
    session.exec(
        delete(AlbumMediaLink).where(AlbumMediaLink.media_id == media.id)
    )
    linked_event_ids = session.exec(
        select(EventMediaLink.event_id).where(
            EventMediaLink.media_id == media.id
        )
    ).all()
    session.exec(
        delete(EventMediaLink).where(EventMediaLink.media_id == media.id)
    )
    if linked_event_ids:
        session.exec(
            update(Event)
            .where(Event.id.in_(linked_event_ids), Event.media_count > 0)
            .values(media_count=Event.media_count - 1)
        )
    session.exec(
        update(Album)
        .where(Album.cover_media_id == media.id)
        .values(cover_media_id=None)
    )
    session.exec(
        update(Event)
        .where(Event.cover_media_id == media.id)
        .values(cover_media_id=None)
    )
    for pid in affected_person_ids:
        auto_select_profile_face(session, pid)
    session.delete(media)
    safe_commit(session)

    for p in to_unlink:
        try:
            p.unlink()
        except FileNotFoundError:
            pass


def delete_file(session: Session, media_id: int):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    orig = Path(media.path)
    try:
        settings.general.ensure_media_path_writable(orig)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    # Captured before delete_record() deletes and commits the row — accessing
    # attributes on `media` afterward raises ObjectDeletedError since the row
    # backing it no longer exists to refresh from.
    thumbnail_path = media.thumbnail_path

    delete_record(media_id, session)

    # delete original file
    try:
        orig.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete original file %s: %s", orig, exc)

    # delete thumbnail (delete_record() already removes it; this is a no-op
    # safety net in case that step was skipped)
    if not thumbnail_path:
        thumb = settings.general.thumb_dir / f"{media_id}.jpg"
    else:
        thumb = settings.general.thumb_dir / thumbnail_path
    try:
        thumb.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete thumbnail %s: %s", thumb, exc)


def remove_person(person_id, session):
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Not allowed in settings.general.presentation_mode mode.",
        )
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    faces = session.exec(select(Face).where(Face.person_id == person_id)).all()
    for face in faces:
        face.person_id = None
        sql = text(
            """
                Update face_embeddings
                SET person_id=-1
                WHERE face_id=:f_id
                """
        ).bindparams(f_id=face.id)
        session.exec(sql)
    sql = text(
        """
        DELETE FROM person_embeddings
        WHERE person_id=:p_id
        """
    ).bindparams(p_id=person.id)
    session.exec(sql)
    session.exec(
        delete(PersonTagLink).where(PersonTagLink.person_id == person_id)
    )
    session.exec(
        delete(TimelineEvent).where(TimelineEvent.person_id == person_id)
    )
    session.exec(
        delete(PersonRelationship).where(
            or_(
                PersonRelationship.person_a_id == person_id,
                PersonRelationship.person_b_id == person_id,
            )
        )
    )
    session.exec(
        delete(PersonMediaLink).where(PersonMediaLink.person_id == person_id)
    )
    session.delete(person)
    safe_commit(session)


def _distance_to_similarity(dist: float) -> float:
    similarity = (1.0 - (float(dist) * float(dist)) / 2.0) * 100.0
    return round(max(0.0, min(100.0, similarity)), 2)
