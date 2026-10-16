"""Frame extraction and scene detection that feed the ML processors."""

import math
import os
import re
import subprocess
import threading
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import ExifTags, Image, ImageOps
from scenedetect import FrameTimecode, HistogramDetector, SceneManager, open_video
from scenedetect.video_splitter import TimecodePair

from app.config import settings
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.media_files import _ffprobe_json
from app.models import Media, Scene
from app.subprocess_helpers import popen_silent, run_silent
from app.thumbnails import get_thumb_folder, to_posix_str


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


# Longest side of the frames handed to the processors. Face detection runs at
# this size (stored face boxes are in its coordinates); CLIP (224px) and blur
# (512px) need less, so nothing gains from decoding or keeping more.
PROCESSING_MAX_DIM = 1280


def processing_size(width: int, height: int) -> tuple[int, int]:
    longest = max(width, height)
    if longest <= PROCESSING_MAX_DIM:
        return width, height
    scale = PROCESSING_MAX_DIM / longest
    return int(width * scale), int(height * scale)


def fit_processing_size(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    target = processing_size(width, height)
    if target == (width, height):
        return rgb
    return cv2.resize(rgb, target, interpolation=cv2.INTER_AREA)


@dataclass
class PhotoScene:
    """A photo prepared once for all processors."""

    # opened source file, for metadata such as EXIF
    image: Image.Image
    # EXIF-oriented RGB pixels, capped at PROCESSING_MAX_DIM
    rgb: np.ndarray
    # EXIF-oriented luma at decode resolution (>= half the original), for the
    # blur score, which depends on fine detail the processing size loses
    gray: np.ndarray


_ORIENTATIONS_SWAPPING_AXES = {5, 6, 7, 8}


def load_photo_scene(path: Path) -> PhotoScene:
    """Decode a photo once, oriented and at processing size.

    Large JPEGs are decoded at half DCT scale, roughly 4x faster than a full
    decode. Smaller scales would be faster still but shift blur scores
    (measured -8% at 1/4, -30% at 1/8 vs. ~-2% at 1/2).
    """
    image = Image.open(path)
    width, height = image.size
    orientation = image.getexif().get(ExifTags.Base.Orientation, 1)
    swaps_axes = orientation in _ORIENTATIONS_SWAPPING_AXES
    target_w, target_h = processing_size(
        *((height, width) if swaps_axes else (width, height))
    )
    # draft() picks the largest reduction that still covers the requested
    # size; it works in stored (unrotated) orientation.
    image.draft(
        "RGB",
        (
            max(math.ceil(width / 2), target_h if swaps_axes else target_w),
            max(math.ceil(height / 2), target_w if swaps_axes else target_h),
        ),
    )
    decoded = ImageOps.exif_transpose(image).convert("RGB")
    gray = np.asarray(decoded.convert("L"))
    rgb = np.asarray(decoded)
    if (rgb.shape[1], rgb.shape[0]) != (target_w, target_h):
        rgb = cv2.resize(rgb, (target_w, target_h), interpolation=cv2.INTER_AREA)
    return PhotoScene(image=image, rgb=rgb, gray=gray)


def _frame_result(
    frame_bgr: np.ndarray | None,
    idx: int,
    timestamps: list[float],
    duration: float,
    media_id: int,
) -> tuple | None:
    """Write the scene thumbnail for an extracted frame.

    Returns (ts, next_ts, frame_rgb, thumb_file) or None for an unusable frame.
    """
    if frame_bgr is None:
        return None

    height, width = frame_bgr.shape[:2]
    if width <= 0 or height <= 0:
        return None

    target_width = 360
    if width > target_width:
        scale = target_width / float(width)
        new_size = (target_width, max(1, int(height * scale)))
        thumb_bgr = cv2.resize(frame_bgr, new_size, interpolation=cv2.INTER_AREA)
    else:
        thumb_bgr = frame_bgr

    thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")
    thumb_file = thumb_dir / f"{media_id}_frame_{idx}.jpg"
    cv2.imwrite(str(thumb_file), thumb_bgr)

    frame_rgb = fit_processing_size(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    ts = timestamps[idx]
    next_ts = timestamps[idx + 1] if idx + 1 < len(timestamps) else max(ts, duration)
    return ts, next_ts, frame_rgb, thumb_file


# Inputs per ffmpeg process when extracting many frames at once. Each input is
# an open demuxer + decoder, so this bounds memory and command-line length.
FRAME_EXTRACT_CHUNK_SIZE = 16


# ffmpeg decodes the seeks of one process largely serially; splitting the
# timestamps over a few batched processes measured ~30% faster than one
# process per frame on phone-style (1s GOP) video and ~40% faster than a
# single batched process.
FRAME_EXTRACT_MAX_PROCESSES = 4


def _extract_frames_batch(
    ffmpeg_binary: Path, video_path: Path, indices: list[int], timestamps: list[float]
) -> dict[int, np.ndarray]:
    """Extract the frames at ``timestamps[i]`` for all *indices* with a single
    ffmpeg process.

    Every timestamp becomes its own input with input seeking (``-ss`` before
    ``-i``), so each output frame is identical to a single-frame grab, without
    paying process startup and container probing per frame.
    Returns BGR frames keyed by index; missing indices failed.
    """
    import tempfile

    cmd = [str(ffmpeg_binary), "-hide_banner", "-loglevel", "error"]
    for idx in indices:
        cmd += ["-ss", f"{timestamps[idx]}", "-i", os.fspath(video_path)]

    frames: dict[int, np.ndarray] = {}
    with tempfile.TemporaryDirectory(prefix="omoide_frames_") as tmp:
        outputs: dict[int, Path] = {}
        for input_no, idx in enumerate(indices):
            out_file = Path(tmp) / f"{idx}.jpg"
            outputs[idx] = out_file
            cmd += [
                "-map",
                f"{input_no}:V:0?",
                "-frames:v",
                "1",
                "-q:v",
                "2",
                "-strict",
                "-1",
                "-update",
                "1",
                "-y",
                os.fspath(out_file),
            ]
        try:
            result = run_silent(
                cmd,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=60 + 10 * len(indices),
            )
            if result.returncode != 0:
                logger.debug(
                    "ffmpeg batch frame extraction exited with %s: %s",
                    result.returncode,
                    result.stderr.decode(errors="ignore"),
                )
        except Exception as exc:
            logger.warning("ffmpeg batch frame extraction failed: %s", exc)

        for idx, out_file in outputs.items():
            if not out_file.exists():
                continue
            frame = cv2.imdecode(np.fromfile(out_file, np.uint8), cv2.IMREAD_COLOR)
            if frame is not None:
                frames[idx] = frame
    return frames


def _extract_frame_worker(
    ffmpeg_binary: Path,
    video_path: Path,
    ts: float,
    idx: int,
    timestamps: list[float],
    duration: float,
    media_id: int,
) -> tuple[int, tuple | None]:
    """Extract one video frame at timestamp *ts* and write its thumbnail.

    Returns (idx, (ts, next_ts, frame_rgb, thumb_file)) on success or
    (idx, None) on any failure.  Fallback for frames the batched extraction
    could not produce; spawns its own ffmpeg process.
    """
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
        "-strict",
        "-1",
        "-vcodec",
        "mjpeg",
        "-",
    ]
    try:
        result = run_silent(
            cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE
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
    return idx, _frame_result(frame_bgr, idx, timestamps, duration, media_id)


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

    thumb_dir = get_thumb_folder(settings.general.thumb_dir / "scenes")
    thumb_file = thumb_dir / f"{media.id}_manual_{int(_t.time() * 1000)}.jpg"

    cmd = [
        str(ffmpeg_binary),
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
            cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except Exception as exc:
        logger.warning(
            "Frame extraction failed at %.2fs for %s: %s", start_time, media.path, exc
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
    thumb_relative = to_posix_str(thumb_file.relative_to(settings.general.thumb_dir))
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
    # Extract the frames with a few parallel ffmpeg processes, each handling
    # a chunk of timestamps.
    frame_results: dict[int, tuple] = {}
    all_indices = list(range(len(timestamps)))
    workers = min(FRAME_EXTRACT_MAX_PROCESSES, len(all_indices))
    chunk_size = min(FRAME_EXTRACT_CHUNK_SIZE, math.ceil(len(all_indices) / workers))
    chunks = [
        all_indices[start : start + chunk_size]
        for start in range(0, len(all_indices), chunk_size)
    ]
    with ThreadPoolExecutor(max_workers=workers) as executor:
        batches = list(
            executor.map(
                lambda chunk: _extract_frames_batch(
                    ffmpeg_binary, video_path, chunk, timestamps
                ),
                chunks,
            )
        )
    for frames in batches:
        for idx, frame_bgr in frames.items():
            data = _frame_result(frame_bgr, idx, timestamps, duration, media.id)
            if data is not None:
                frame_results[idx] = data

    # Retry frames the batch could not produce one by one, so a single bad
    # seek does not take the rest of its chunk down with it.
    missing = [idx for idx in all_indices if idx not in frame_results]
    if missing:
        logger.debug(
            "Retrying %d/%d frames individually for %s",
            len(missing),
            len(timestamps),
            video_path,
        )
        with ThreadPoolExecutor(max_workers=min(4, len(missing))) as executor:
            futures = [
                executor.submit(
                    _extract_frame_worker,
                    ffmpeg_binary,
                    video_path,
                    timestamps[idx],
                    idx,
                    timestamps,
                    duration,
                    media.id,
                )
                for idx in missing
            ]
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
        max_by_density = int(math.ceil(duration_seconds / density_window_seconds))
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


def _video_frame_info(path: Path, media: Media) -> tuple[int, float]:
    """Read frame count and fps from the container header (no decoding)."""
    cap = cv2.VideoCapture(os.fspath(path))
    try:
        if not cap.isOpened():
            return 0, 0.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if total <= 0 and media.duration and fps > 0:
            total = int(float(media.duration) * fps)
        return max(total, 0), fps
    finally:
        cap.release()


# Same cut rule as PySceneDetect's HistogramDetector(threshold=0.2): a cut is
# a drop of the luma-histogram correlation to <= 0.8 between samples.
_SCENE_HIST_MIN_CORRELATION = 0.8


_KEYFRAME_SAMPLE_SIZE = (160, 90)


def _detect_scenes_from_keyframes(
    path: Path, fps: float, duration: float
) -> list[TimecodePair] | None:
    """Scene-detect using only the video's keyframes.

    ``-discard nokey`` drops every non-keyframe packet in the demuxer, so
    ffmpeg reads and decodes roughly one frame per GOP (~1/s for phone
    video) instead of all of them — ~17x faster than full decoding. Cuts are
    only placed on keyframes, which is far finer than the minimum scene length.
    Returns None when keyframes are too sparse to sample the video reliably
    (or ffmpeg fails), so the caller can fall back to full-decode detection.
    """
    import tempfile

    ffmpeg_binary = ensure_ffmpeg_available()
    if not ffmpeg_binary or fps <= 0:
        return None
    width, height = _KEYFRAME_SAMPLE_SIZE
    frame_bytes = width * height
    min_scene_seconds = _SCENE_MIN_LEN_FRAMES / fps
    cmd = [
        str(ffmpeg_binary),
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "info",
        "-skip_frame",
        "nokey",
        "-discard",
        "nokey",
        "-an",
        "-sn",
        "-dn",
        "-i",
        os.fspath(path),
        "-vf",
        f"scale={width}:{height},showinfo",
        "-fps_mode",
        "passthrough",
        "-pix_fmt",
        "gray",
        "-f",
        "rawvideo",
        "-",
    ]
    histograms: list[np.ndarray] = []
    # showinfo reports each frame's timestamp on stderr; spool it to a file
    # so a chatty stderr can never block the stdout frame stream.
    with tempfile.TemporaryFile() as stderr_file:
        try:
            proc = popen_silent(cmd, stdout=subprocess.PIPE, stderr=stderr_file)
        except Exception as exc:
            logger.debug("Keyframe scene detection failed to start: %s", exc)
            return None
        timer = threading.Timer(120 + duration, proc.kill)
        timer.start()
        try:
            while True:
                buf = proc.stdout.read(frame_bytes)
                if len(buf) < frame_bytes:
                    break
                luma = np.frombuffer(buf, np.uint8).reshape(height, width)
                hist = cv2.calcHist([luma], [0], None, [256], [0, 256])
                histograms.append(cv2.normalize(hist, hist).flatten())
            returncode = proc.wait()
        finally:
            timer.cancel()
            proc.stdout.close()
        stderr_file.seek(0)
        stderr = stderr_file.read().decode(errors="ignore")

    timestamps = [float(t) for t in re.findall(r"pts_time:\s*(-?[\d.]+)", stderr)]
    if returncode != 0 or len(timestamps) != len(histograms):
        logger.debug(
            "Keyframe scene detection unusable for %s (code=%s, %d frames, "
            "%d timestamps)",
            path,
            returncode,
            len(histograms),
            len(timestamps),
        )
        return None
    if len(timestamps) < 2 or np.median(np.diff(timestamps)) > min_scene_seconds / 2:
        logger.debug("Keyframes too sparse for scene detection in %s", path)
        return None

    cuts: list[float] = []
    last_cut = timestamps[0]
    for i in range(1, len(histograms)):
        correlation = cv2.compareHist(
            histograms[i - 1], histograms[i], cv2.HISTCMP_CORREL
        )
        if (
            correlation <= _SCENE_HIST_MIN_CORRELATION
            and timestamps[i] - last_cut >= min_scene_seconds
        ):
            cuts.append(timestamps[i])
            last_cut = timestamps[i]
    if not cuts:
        return []

    end = max(duration, timestamps[-1])
    bounds = [0.0, *cuts, end]
    return [
        (
            FrameTimecode(timecode=float(start), fps=fps),
            FrameTimecode(timecode=float(stop), fps=fps),
        )
        for start, stop in zip(bounds, bounds[1:])
    ]


def _detect_video_scenes(media: Media, path: Path) -> list[TimecodePair]:
    """Scene-detect a video, skipping work that cannot produce a usable result.

    Detection decodes the whole file, so videos too short to ever contain
    the minimum number of minimum-length scenes skip it entirely — they
    would fall back to frame sampling anyway.
    """
    total_frames, fps = _video_frame_info(path, media)
    if total_frames and total_frames < _SCENE_MIN_USEFUL_SCENES * _SCENE_MIN_LEN_FRAMES:
        logger.debug(
            "Skipping scene detection for %s (%d frames is too short).",
            path,
            total_frames,
        )
        return []

    duration = float(media.duration or 0.0) or (total_frames / fps if fps > 0 else 0.0)
    scenes = _detect_scenes_from_keyframes(path, fps, duration)
    if scenes is not None:
        return scenes

    logger.debug("Detecting scenes (full decode)...")
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


def split_video(media: Media, path: Path) -> list[tuple[Scene, cv2.typing.MatLike]]:
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
