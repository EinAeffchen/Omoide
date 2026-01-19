from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.ffmpeg import ensure_ffmpeg_available
from app.logger import logger
from app.subprocess_helpers import run_silent

_ENCODER_RE = re.compile(r"^\s*[A-Z\.]{6}\s+(\S+)")


@dataclass(frozen=True)
class FFmpegAccelConfig:
    hwaccel_args: tuple[str, ...] = ()
    video_encoder: str | None = None


def _run_ffmpeg_query(ffmpeg_bin: Path, args: list[str]) -> str:
    try:
        result = run_silent(
            [str(ffmpeg_bin), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
    except Exception as exc:
        logger.debug("ffmpeg query failed: %s", exc)
        return ""
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        logger.debug(
            "ffmpeg query failed (code=%s): %s", result.returncode, stderr
        )
        return ""
    return result.stdout or ""


def _parse_ffmpeg_encoders(text: str) -> set[str]:
    encoders: set[str] = set()
    for line in text.splitlines():
        match = _ENCODER_RE.match(line)
        if match:
            encoders.add(match.group(1))
    return encoders


def _parse_ffmpeg_hwaccels(text: str) -> set[str]:
    accels: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.lower().startswith("hardware acceleration"):
            continue
        accels.add(stripped.split()[0])
    return accels


def _probe_ffmpeg_encoder(
    ffmpeg_bin: Path, encoder: str, hwaccel: str | None
) -> bool:
    cmd = [str(ffmpeg_bin), "-hide_banner", "-loglevel", "error"]
    if hwaccel:
        cmd.extend(["-hwaccel", hwaccel])
    cmd.extend(
        [
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=16x16:d=0.1",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ]
    )
    try:
        result = run_silent(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
        )
    except Exception as exc:
        logger.debug("ffmpeg encoder probe failed: %s", exc)
        return False
    if result.returncode == 0:
        return True
    stderr = (result.stderr or "").strip()
    if stderr:
        logger.debug("ffmpeg encoder probe failed for %s: %s", encoder, stderr)
    return False


@lru_cache(maxsize=2)
def resolve_torch_device(prefer_gpu: bool) -> str:
    if not prefer_gpu:
        return "cpu"
    try:
        import torch
    except Exception as exc:
        logger.debug("Torch unavailable for GPU detection: %s", exc)
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@lru_cache(maxsize=2)
def resolve_onnx_providers(prefer_gpu: bool) -> tuple[list[str], bool]:
    try:
        import onnxruntime as ort
    except Exception as exc:
        logger.debug("ONNXRuntime unavailable for GPU detection: %s", exc)
        return ["CPUExecutionProvider"], False

    if not prefer_gpu:
        return ["CPUExecutionProvider"], False

    available = ort.get_available_providers()
    gpu_priority = [
        "CUDAExecutionProvider",
        "ROCMExecutionProvider",
        "TensorrtExecutionProvider",
        "MIGraphXExecutionProvider",
        "DirectMLExecutionProvider",
        "DmlExecutionProvider",
        "CoreMLExecutionProvider",
    ]
    gpu_providers = [p for p in gpu_priority if p in available]
    if gpu_providers:
        providers = gpu_providers + ["CPUExecutionProvider"]
        return providers, True
    return ["CPUExecutionProvider"], False


@lru_cache(maxsize=2)
def get_ffmpeg_accel_config(prefer_gpu: bool) -> FFmpegAccelConfig:
    if not prefer_gpu:
        return FFmpegAccelConfig()

    ffmpeg_bin = ensure_ffmpeg_available()
    if not ffmpeg_bin:
        return FFmpegAccelConfig()

    encoders_text = _run_ffmpeg_query(
        ffmpeg_bin, ["-hide_banner", "-loglevel", "error", "-encoders"]
    )
    encoders = _parse_ffmpeg_encoders(encoders_text)
    if not encoders:
        return FFmpegAccelConfig()

    hwaccels_text = _run_ffmpeg_query(
        ffmpeg_bin, ["-hide_banner", "-loglevel", "error", "-hwaccels"]
    )
    hwaccels = _parse_ffmpeg_hwaccels(hwaccels_text)

    candidates = [
        ("h264_nvenc", "cuda"),
        ("h264_qsv", "qsv"),
        ("h264_videotoolbox", "videotoolbox"),
        ("h264_amf", "d3d11va"),
    ]
    for encoder, hwaccel in candidates:
        if encoder not in encoders:
            continue
        if _probe_ffmpeg_encoder(ffmpeg_bin, encoder, None):
            hwaccel_args = ("-hwaccel", hwaccel) if hwaccel in hwaccels else ()
            return FFmpegAccelConfig(
                hwaccel_args=hwaccel_args, video_encoder=encoder
            )
        if hwaccel in hwaccels and _probe_ffmpeg_encoder(
            ffmpeg_bin, encoder, hwaccel
        ):
            return FFmpegAccelConfig(
                hwaccel_args=("-hwaccel", hwaccel), video_encoder=encoder
            )

    return FFmpegAccelConfig()
