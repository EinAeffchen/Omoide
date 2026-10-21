"""Making videos playable in the browser.

Browsers (and the desktop app's web view) only decode a few video codecs, so
e.g. HEVC phone videos play as audio over a black picture and AVI/WMV files not
at all. This module decides which files need converting and runs ffmpeg in one
of three ways:

* streamed on the fly while the video plays (nothing is written),
* into a playable copy in Omoide's data folder (the original is kept),
* replacing the original file with the converted MP4.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Literal

from sqlmodel import Session

from app.accelerators import get_ffmpeg_accel_config
from app.config import settings
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.media_files import _ffprobe_json
from app.models import Media
from app.subprocess_helpers import popen_silent

ConversionMode = Literal["keep_original", "replace_original"]

# What Chromium-based browsers decode without extra OS codecs.
_PLAYABLE_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
_PLAYABLE_AUDIO_CODECS = {"aac", "mp3", "opus", "vorbis", "flac"}
_PLAYABLE_CONTAINERS = {".mp4", ".m4v", ".mov", ".webm", ".mkv"}

# Shared by file conversion and streaming so both produce the same output.
_OUTPUT_ARGS = [
    "-map", "0:v:0", "-map", "0:a:0?",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
]


class ConversionError(RuntimeError):
    pass


def is_browser_playable(path: Path) -> bool:
    """Best-effort check whether the browser can show this video as is."""
    if path.suffix.lower() not in _PLAYABLE_CONTAINERS:
        return False
    info = _ffprobe_json(path)
    if not info:
        return False
    streams = info.get("streams") or []
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    if not video or video[0].get("codec_name") not in _PLAYABLE_VIDEO_CODECS:
        return False
    return not audio or audio[0].get("codec_name") in _PLAYABLE_AUDIO_CODECS


def converted_copy_path(media_id: int) -> Path:
    """Where the playable copy of a video lives when the original is kept."""
    return settings.general.omoide_dir / "converted" / f"{media_id}.mp4"


def existing_converted_copy(media_id: int) -> Path | None:
    path = converted_copy_path(media_id)
    return path if path.is_file() else None


def _ffmpeg() -> Path:
    ffmpeg_bin = ensure_ffmpeg_available()
    if not ffmpeg_bin:
        raise ConversionError(
            "ffmpeg is required to convert videos but could not be located."
        )
    return ffmpeg_bin


def _duration_seconds(path: Path) -> float:
    info = _ffprobe_json(path) or {}
    try:
        return float((info.get("format") or {}).get("duration") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def convert_file(
    source: Path,
    target: Path,
    *,
    on_progress: Callable[[int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> None:
    """Convert `source` into a browser-playable MP4 at `target`.

    Writes to a temporary file next to `target` and only moves it into place
    once ffmpeg succeeded, so a failed or cancelled run leaves nothing behind.
    """
    accel = get_ffmpeg_accel_config(settings.processors.prefer_gpu)
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.stem + ".partial.mp4")
    duration_us = _duration_seconds(source) * 1_000_000
    cmd = [
        str(_ffmpeg()),
        # Never read stdin: ffmpeg treats it as a key-command channel and can
        # stall when it is a pipe.
        "-nostdin",
        *accel.hwaccel_args,
        "-i", str(source),
        "-c:v", accel.video_encoder or "libx264",
        *_OUTPUT_ARGS,
        "-movflags", "use_metadata_tags+faststart",
        "-progress", "pipe:1",
        "-nostats",
        "-y", str(partial),
    ]
    logger.info("Converting %s -> %s", source, target)
    # stderr goes to a file: a piped stderr that is only read at the end
    # deadlocks ffmpeg once a broken file produces enough warnings.
    errors = tempfile.TemporaryFile()
    proc = popen_silent(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=errors,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    try:
        assert proc.stdout is not None
        # ffmpeg reports "out_time_us=<µs>" lines on stdout via -progress.
        for line in proc.stdout:
            if cancelled and cancelled():
                proc.kill()
                raise ConversionError("Conversion cancelled.")
            key, _, value = line.strip().partition("=")
            if key == "out_time_us" and value.isdigit() and duration_us > 0:
                if on_progress:
                    on_progress(min(99, int(int(value) / duration_us * 100)))
        if proc.wait() != 0:
            errors.seek(0)
            tail = errors.read().decode("utf-8", "replace")[-2000:]
            raise ConversionError(f"ffmpeg failed (exit {proc.returncode}): {tail}")
        os.replace(partial, target)
    finally:
        if proc.poll() is None:
            proc.kill()
        errors.close()
        partial.unlink(missing_ok=True)


def _available_name(path: Path) -> Path:
    """`path`, or `name (1).mp4` etc. if another file already uses it."""
    if not path.exists():
        return path
    index = 1
    while True:
        candidate = path.with_name(f"{path.stem} ({index}){path.suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def convert_media(
    session: Session,
    media: Media,
    mode: ConversionMode,
    *,
    on_progress: Callable[[int], None] | None = None,
    cancelled: Callable[[], bool] | None = None,
) -> Path:
    """Make `media` playable using `mode` and return the playable file.

    keep_original: the copy goes to Omoide's data folder (not the library, so
    it is never indexed as a duplicate); the original stays untouched.
    replace_original: the original is replaced by `<name>.mp4` in the same
    folder; it is deleted only after the conversion succeeded. Commits.
    """
    source = Path(media.path)
    if not source.is_file():
        raise ConversionError(f"File not found: {source}")

    if mode == "keep_original":
        target = converted_copy_path(media.id)
        convert_file(source, target, on_progress=on_progress, cancelled=cancelled)
        return target

    settings.general.ensure_media_path_writable(source)
    staging = settings.general.omoide_dir / "converted" / f"{media.id}.replace.mp4"
    convert_file(source, staging, on_progress=on_progress, cancelled=cancelled)
    final = source.with_suffix(".mp4")
    if final != source:
        final = _available_name(final)
    try:
        shutil.move(str(staging), str(final))
        if final != source:
            source.unlink()
    except Exception:
        staging.unlink(missing_ok=True)
        raise
    media.path = str(final)
    media.filename = final.name
    media.size = final.stat().st_size
    session.add(media)
    session.commit()
    # The original is gone; a kept copy of it would now be stale.
    converted_copy_path(media.id).unlink(missing_ok=True)
    return final


def stream_converted(source: Path, start_seconds: float = 0.0) -> Iterator[bytes]:
    """Yield a fragmented MP4 of `source` converted on the fly from
    `start_seconds`. Seeking means starting a new stream; the ffmpeg process
    is killed when the consumer stops reading."""
    cmd = [
        str(_ffmpeg()),
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, start_seconds):.3f}",
        "-i", str(source),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        *_OUTPUT_ARGS,
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4", "pipe:1",
    ]
    proc = popen_silent(
        cmd,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert proc.stdout is not None
        while chunk := proc.stdout.read(256 * 1024):
            yield chunk
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
