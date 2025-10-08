import json
import math
import os
import subprocess
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Literal

import cv2
import ffmpeg
import imagehash
import numpy as np
import piexif
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from scenedetect import FrameTimecode, HistogramDetector, detect
from scenedetect.video_splitter import TimecodePair
from sqlalchemy import delete, distinct, func, text
from sqlmodel import Session, select, update
from tqdm import tqdm

from app.config import settings
from app.database import safe_commit
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.models import (
    DuplicateMedia,
    ExifData,
    Face,
    Media,
    MediaTagLink,
    Person,
    ProcessingTask,
    Scene,
)
from app.subprocess_helpers import run_silent


def _coerce_vector_array(value: Any) -> np.ndarray | None:
    """Normalize assorted embedding representations into a 1D float32 array."""
    if value is None:
        return None

    if isinstance(value, np.ndarray):
        arr = value.astype(np.float32, copy=False)
    elif isinstance(value, memoryview):
        arr = np.frombuffer(value, dtype=np.float32)
    elif isinstance(value, (bytes, bytearray)):
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
    return arr.astype(np.float32, copy=False)


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
    rows = session.exec(
        select(
            Face.person_id,
            func.count(distinct(Face.media_id)),
        )
        .where(Face.person_id.in_(ids))
        .group_by(Face.person_id)
    ).all()
    counts = {pid: count for pid, count in rows}
    for pid in ids:
        person = session.get(Person, pid)
        if person is None:
            continue
        person.appearance_count = counts.get(pid, 0)
        session.add(person)


def get_image_taken_date(img_path: Path | None = None) -> datetime:
    # fallback use creation time
    alt_time = datetime.fromtimestamp(img_path.stat().st_ctime)

    try:
        img = Image.open(str(img_path))
    except UnidentifiedImageError:
        return alt_time

    format_code = "%Y:%m:%d %H:%M:%S"
    try:
        exif = img._getexif()
    except AttributeError:
        exif = None
    except SyntaxError:
        exif = None
    if exif and (creation_date := exif.get(36867)):
        try:
            return datetime.strptime(creation_date, format_code)
        except ValueError:
            logger.debug(
                "Received invalid time for %s: %s", img_path, creation_date
            )
    return alt_time


def _ffprobe_json(path: Path, timeout: int = 15) -> dict | None:
    """Run ffprobe with a timeout and return parsed JSON, or None on failure.

    Using subprocess directly allows us to enforce a timeout to avoid hangs
    on corrupted or tricky media files.
    """
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        os.fspath(path),
    ]
    try:
        result = run_silent(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            logger.warning(
                "ffprobe failed for %s: %s", path, result.stderr.strip()
            )
            return None
        return json.loads(result.stdout or "{}")
    except subprocess.TimeoutExpired:
        logger.error("ffprobe timeout for %s after %ss", path, timeout)
        return None
    except Exception as e:
        logger.error("ffprobe exception for %s: %s", path, e)
        return None


def process_file(filepath: Path) -> tuple[Media | None, str | None]:
    """Reads metadata from the file and prepares a Media record.

    Adds timeouts to external probing to avoid hangs and returns a tuple of
    (Media | None, error message | None).
    """
    try:
        try:
            size = os.path.getsize(filepath)
        except OSError as exc:
            logger.warning("Could not stat %s: %s", filepath, exc)
            return None, f"Unable to read file information: {exc}"

        suffix = filepath.suffix.lower()

        duration: float | None = None
        width: int | None = None
        height: int | None = None

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
            else:
                logger.warning(
                    "Skipping video probe metadata for %s", filepath
                )
        else:
            # Images: avoid ffprobe entirely; use PIL for dimensions if possible
            try:
                with Image.open(filepath) as im:
                    width, height = im.size
            except UnidentifiedImageError:
                logger.warning("Skipping %s, not an image!", filepath)
            except OSError as exc:
                logger.warning(
                    "Image %s could not be opened: %s", filepath, exc
                )

        media = Media(
            path=str(filepath),
            filename=filepath.name,
            size=size,
            duration=duration,
            width=width,
            height=height,
            faces_extracted=False,
            embeddings_created=False,
            created_at=get_image_taken_date(img_path=filepath),
            embedding=None,
            phash=None,
        )
        if media.duration is None:
            media.phash = generate_perceptual_hash(media, type="image")
        else:
            media.phash = generate_perceptual_hash(media, type="video")
        return media, None
    except Exception as exc:  # pragma: no cover - defensive safeguard
        logger.exception("Failed to process file %s: %s", filepath, exc)
        return None, str(exc)


def to_posix_str(s: Path) -> str:
    """
    Get a POSIX-style string (forward slashes) regardless of input style.
    """
    if "\\" in str(s) and "/" not in str(s):
        return PureWindowsPath(s).as_posix()
    return PurePosixPath(s).as_posix()


def get_thumb_folder(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    folders = [folder for folder in path.iterdir() if folder.is_dir()]
    if not folders:
        new_folder = path / "1"
        new_folder.mkdir()
        return new_folder
    else:
        folders.sort(key=lambda p: int(p.name))
        latest = folders[-1]
        file_count = sum(1 for file in latest.iterdir() if file.is_file())
        if file_count >= settings.general.thumb_dir_folder_size:
            new_folder = path / str(int(latest.name) + 1)
            new_folder.mkdir(exist_ok=True)
            return new_folder
        return latest


def fix_image_rotation(full_path: Path) -> None:
    if not settings.scan.auto_rotate:
        return

    img = Image.open(full_path)
    try:
        exif = img.getexif()
        orientation = exif.get(274)
        if not orientation or orientation == 1:
            return
    except SyntaxError:
        return
    try:
        transposed = ImageOps.exif_transpose(img)
    except OSError:
        logger.warning(
            "Image: %s is truncated, you might want to delete it.", full_path
        )
        return
    del exif[274]
    exif_bytes = exif.tobytes()
    transposed.save(full_path, format=img.format, exif=exif_bytes)


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
                np.linspace(
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
            img = Image.open(media.path)
            return str(imagehash.phash(img))
        if type == "video":
            return _generate_video_perceptual_hash(media)
    except UnidentifiedImageError:
        logger.warning("Skipping %s, not an image!", media.path)
    except OSError:
        logger.warning(
            "Media %s is truncated and can't be processed:", media.path
        )


def generate_thumbnail(media: Media) -> tuple[str | None, str | None]:
    thumb_folder = get_thumb_folder(settings.general.thumb_dir / "media")
    thumb_path = thumb_folder / f"{media.id}.jpg"
    filepath = Path(media.path)
    if filepath.suffix.lower() in settings.scan.VIDEO_SUFFIXES:
        # Use direct subprocess to enforce a timeout; skip on failure
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            "1",
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
            logger.error(
                "ffmpeg failed to generate thumbnail for %s: %s", filepath, e
            )
            return None, f"ffmpeg failed to generate thumbnail: {e}"
        except Exception as exc:  # pragma: no cover - defensive safeguard
            logger.exception(
                "Unexpected ffmpeg error while thumbnailing %s: %s",
                filepath,
                exc,
            )
            return None, f"Unexpected ffmpeg error: {exc}"
        if not thumb_path.exists():
            return None, "ffmpeg did not produce a thumbnail file"
    else:
        try:
            fix_image_rotation(filepath)
            with Image.open(filepath) as img:
                img.thumbnail((360, -1))
                try:
                    img.save(thumb_path, format="JPEG")
                except OSError:
                    try:
                        img.convert("RGB").save(thumb_path, format="JPEG")
                    except OSError as rgb_exc:
                        logger.warning(
                            "Failed to save thumbnail for %s: %s",
                            filepath,
                            rgb_exc,
                        )
                        return None, f"Unable to save thumbnail: {rgb_exc}"
        except UnidentifiedImageError:
            logger.warning("Couldn't open %s", filepath)
            return None, "File is not a valid image"
        except OSError as exc:
            logger.warning(
                "Failed to process image %s, because of: %s", filepath, exc
            )
            return None, f"Unable to read image: {exc}"

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
    logger.info("Updating person_embedding!")
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
    scene_objs = []
    for i, (start_time, end_time) in tqdm(
        enumerate(scenes), total=len(scenes)
    ):
        thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")
        thumbnail_path = thumb_dir / f"{i}_{Path(media.path).stem}.jpg"
        ffmpeg.input(media.path, ss=start_time.get_seconds()).filter(
            "scale", 480, -1
        ).output(str(thumbnail_path), vframes=1).run(
            quiet=True, overwrite_output=True
        )
        out, _ = (
            ffmpeg.input(media.path, ss=start_time.get_seconds())
            .output(
                "pipe:",  # send to stdout
                vframes=1,  # just one frame
                format="image2",  # raw image container
                vcodec="mjpeg",  # JPEG in memory
            )
            .run(capture_stdout=True, quiet=True)
        )
        arr = np.frombuffer(out, np.uint8)
        frame_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        scene = Scene(
            media_id=media.id,
            start_time=start_time,
            end_time=end_time,
            thumbnail_path=to_posix_str(
                thumbnail_path.relative_to(settings.general.thumb_dir)
            ),
        )
        scene_objs.append((scene, frame_rgb))
    return scene_objs


def _split_by_frames(media: Media) -> list[tuple[Scene, cv2.typing.MatLike]]:
    logger.info("Splitting based on frames via ffmpeg")
    scene_entries: list[tuple[Scene, cv2.typing.MatLike]] = []
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
        timestamps = [max(0.0, i * step) for i in range(max_frames)]
        if timestamps and timestamps[-1] + 1.0 < duration:
            timestamps.append(duration)
    else:
        timestamps = [float(i) for i in range(max_frames)]

    thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")

    for idx, ts in enumerate(tqdm(timestamps)):
        try:
            cmd = [
                str(ffmpeg_binary),
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
                "-vcodec",
                "mjpeg",
                "-",
            ]
            result = run_silent(
                cmd,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except Exception as exc:
            logger.warning(
                "ffmpeg frame extraction failed at %.2fs: %s", ts, exc
            )
            continue

        if result.returncode != 0 or not result.stdout:
            logger.debug(
                "ffmpeg returned no data for %.2fs (code=%s, stderr=%s)",
                ts,
                result.returncode,
                result.stderr.decode(errors="ignore"),
            )
            continue

        frame_buf = np.frombuffer(result.stdout, np.uint8)
        frame_bgr = cv2.imdecode(frame_buf, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            continue

        height, width = frame_bgr.shape[:2]
        if width <= 0 or height <= 0:
            continue

        target_width = 360
        if width > target_width:
            scale = target_width / float(width)
            new_size = (target_width, max(1, int(height * scale)))
            thumb_bgr = cv2.resize(
                frame_bgr, new_size, interpolation=cv2.INTER_AREA
            )
        else:
            thumb_bgr = frame_bgr

        thumb_file = thumb_dir / f"{media.id}_frame_{idx}.jpg"
        cv2.imwrite(str(thumb_file), thumb_bgr)

        frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

        next_ts = (
            timestamps[idx + 1]
            if idx + 1 < len(timestamps)
            else max(ts, duration)
        )

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
    img = Image.open(str(path))
    img = ImageOps.exif_transpose(img)
    img.save(str(path), exif=exif_bytes)


def complete_task(session: Session, task: ProcessingTask):
    task.status = "completed"
    task.finished_at = datetime.now(timezone.utc)
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


def split_video(
    media: Media, path: Path
) -> list[tuple[Scene, cv2.typing.MatLike]]:
    """Returns select frames from a video and a list of scenes"""
    if settings.video.auto_scene_detection:
        scenes = detect(
            str(path),
            HistogramDetector(
                threshold=0.2,
                min_scene_len=500,
                # adaptive_threshold=3, window_width=5, min_scene_len=500
            ),
            show_progress=True,
        )
        logger.debug("Detecting scenes...")

        duration_seconds: float | None = None
        try:
            if media.duration is not None:
                duration_seconds = float(media.duration)
        except Exception:
            duration_seconds = None

        limited_scenes = _limit_scene_results(scenes, duration_seconds)
        if len(limited_scenes) >= 3:
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
    for face in faces:
        sql = text(
            """
            DELETE FROM face_embeddings
            WHERE face_id=:f_id
            """
        ).bindparams(f_id=face.id)
        session.exec(sql)
        if face.thumbnail_path:
            thumb = Path(settings.general.thumb_dir / face.thumbnail_path)
            if thumb.is_file():
                to_unlink.append(thumb)

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
    session.exec(delete(MediaTagLink).where(MediaTagLink.media_id == media_id))
    session.exec(delete(ExifData).where(ExifData.media_id == media_id))
    session.exec(delete(Scene).where(Scene.media_id == media.id))
    session.exec(
        delete(DuplicateMedia).where(DuplicateMedia.media_id == media.id)
    )
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

    delete_record(media_id, session)

    # delete original file
    orig = Path(media.path)
    try:
        orig.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete original file %s: %s", orig, exc)

    # delete thumbnail
    if not media.thumbnail_path:
        thumb = settings.general.thumb_dir / f"{media.id}.jpg"
    else:
        thumb = settings.general.thumb_dir / media.thumbnail_path
    try:
        thumb.unlink()
    except FileNotFoundError:
        pass
    except OSError as exc:
        logger.warning("Failed to delete thumbnail %s: %s", thumb, exc)
