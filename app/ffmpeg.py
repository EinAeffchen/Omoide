from __future__ import annotations

import os
import platform
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path
from urllib.request import urlopen

from app.config import settings
from app.logger import logger

FFMPEG_RELEASES: dict[str, dict[str, str]] = {
    "windows": {
        "url": "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
        "archive_name": "ffmpeg-release-essentials.zip",
        "binary_name": "ffmpeg.exe",
    },
    "darwin": {
        "url": "https://evermeet.cx/ffmpeg/ffmpeg-6.1.zip",
        "archive_name": "ffmpeg-macos.zip",
        "binary_name": "ffmpeg",
    },
}


def _find_existing_ffmpeg(custom_path: Path | None) -> Path | None:
    candidates: list[Path] = []
    if custom_path:
        candidates.append(custom_path)
    env_path = os.environ.get("FFMPEG_PATH")
    if env_path:
        candidates.append(Path(env_path))

    for candidate in candidates:
        if candidate and candidate.exists():
            executable = candidate if candidate.is_file() else candidate / "ffmpeg"
            if executable.exists():
                return executable
            exe = candidate / "ffmpeg.exe"
            if exe.exists():
                return exe

    which_path = shutil.which("ffmpeg")
    if which_path:
        return Path(which_path)
    return None


def _download_and_extract(url: str, archive_name: str, target_dir: Path) -> Path | None:
    target_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Downloading ffmpeg from %s", url)
    try:
        with urlopen(url) as response:
            data = response.read()
    except Exception as exc:
        logger.warning("Failed to download ffmpeg: %s", exc)
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        archive_path = Path(tmpdir) / archive_name
        archive_path.write_bytes(data)
        try:
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(target_dir)
        except zipfile.BadZipFile as exc:
            logger.warning("Downloaded ffmpeg archive is invalid: %s", exc)
            return None

    return _locate_binary(target_dir)


def _locate_binary(root: Path) -> Path | None:
    binary_names = ["ffmpeg.exe", "ffmpeg"]
    for name in binary_names:
        matches = list(root.rglob(name))
        if matches:
            return matches[0]
    return None


def _make_executable(path: Path) -> None:
    try:
        mode = path.stat().st_mode
        path.chmod(mode | stat.S_IEXEC)
    except Exception:
        pass


def ensure_ffmpeg_available() -> Path | None:
    custom_path = settings.general.ffmpeg_path
    existing = _find_existing_ffmpeg(custom_path)
    if existing:
        _inject_into_path(existing.parent)
        logger.debug("Found existing ffmpeg at %s", existing)
        return existing

    current_platform = platform.system().lower()
    if current_platform not in FFMPEG_RELEASES:
        logger.warning(
            "ffmpeg not found on PATH. Please install ffmpeg manually and set OMOIDE_GENERAL__ffmpeg_path."
        )
        return None

    release_info = FFMPEG_RELEASES[current_platform]
    tools_dir = settings.general.data_dir / "tools"
    install_dir = tools_dir / "ffmpeg"
    install_dir.mkdir(parents=True, exist_ok=True)

    binary = _locate_binary(install_dir)
    if not binary or not binary.exists():
        binary = _download_and_extract(
            release_info["url"], release_info["archive_name"], install_dir
        )
    if not binary or not binary.exists():
        logger.warning(
            "Unable to provision ffmpeg automatically. Please install it manually."
        )
        return None

    _make_executable(binary)
    _inject_into_path(binary.parent)
    logger.info("ffmpeg available at %s", binary)
    return binary


def _inject_into_path(bin_dir: Path) -> None:
    path_str = os.environ.get("PATH", "")
    bin_str = str(bin_dir)
    if bin_str not in path_str.split(os.pathsep):
        os.environ["PATH"] = os.pathsep.join([bin_str, path_str]) if path_str else bin_str
    os.environ.setdefault("FFMPEG_PATH", bin_str)
