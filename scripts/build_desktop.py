"""Canonical, reproducible desktop build for local development and CI.

Run with ``uv run python scripts/build_desktop.py``. GitHub Actions invokes the
same command, so a local Windows build uses the same dependency lockfiles,
PyInstaller spec, entry point, versioning and Windows runtime workaround as
the release artifact.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"


def run(*args: str, cwd: Path = ROOT) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, check=True)


def git_output(*args: str) -> str | None:
    try:
        return subprocess.check_output(
            ["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def resolve_version() -> str:
    if version := os.environ.get("APP_VERSION"):
        return version

    tag = git_output("describe", "--exact-match", "--tags", "HEAD")
    if tag and tag.startswith("v"):
        return tag[1:]

    with (ROOT / "pyproject.toml").open("rb") as file:
        base_version = tomllib.load(file)["project"]["version"]
    revision = git_output("rev-parse", "--short", "HEAD")
    return f"{base_version}+{revision}" if revision else base_version


def bundle_windows_vcomp(app_name: str) -> None:
    """Copy OpenMP's VC runtime exactly as the release build does."""
    if os.name != "nt":
        return

    import sklearn  # Imported from the uv environment running this script.

    candidates = list(
        (Path(sklearn.__file__).resolve().parent / ".libs").glob(
            "vcomp140*.dll"
        )
    )
    if not candidates:
        system_root = Path(os.environ.get("SystemRoot", r"C:\\Windows"))
        candidates = [
            path
            for folder in ("System32", "SysWOW64")
            if (path := system_root / folder / "vcomp140.dll").exists()
        ]
    if not candidates:
        raise RuntimeError(
            "Unable to locate vcomp140.dll for the Windows build"
        )

    target_dir = ROOT / "dist" / app_name / "_internal" / "sklearn" / ".libs"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / "vcomp140.dll"
    shutil.copy2(candidates[0], target)
    print(f"Bundled {candidates[0]} -> {target}", flush=True)


def main() -> None:
    version = resolve_version()
    flavor = os.environ.setdefault("APP_FLAVOR", "cpu")
    os.environ.setdefault("OMOIDE_BUILD_FLAVOR", flavor)
    os.environ["APP_VERSION"] = version
    os.environ.setdefault("OMOIDE_VERSION", version)
    safe_version = "".join(
        char
        if (char.isascii() and char.isalnum()) or char in ".-_"
        else "_"
        for char in version
    )
    safe_flavor = "".join(
        char
        if (char.isascii() and char.isalnum()) or char in ".-_"
        else "_"
        for char in flavor
    )
    app_name = f"omoide-{safe_version}-{safe_flavor}"

    version_file = ROOT / "app" / "VERSION"
    original_version = version_file.read_bytes()
    version_file.write_text(version, encoding="utf-8")
    try:
        # A clean output is part of the build contract, rather than a CI-only step.
        for output_dir in (ROOT / "build", ROOT / "dist"):
            shutil.rmtree(output_dir, ignore_errors=True)

        # This PyInstaller workaround needs to be applied to local macOS builds too.
        if sys.platform == "darwin":
            os.environ.setdefault("PYINSTALLER_STRIP_SYMLINKS", "1")

        npm = "npm.cmd" if os.name == "nt" else "npm"
        run(npm, "ci", cwd=FRONTEND)
        run(npm, "run", "build", cwd=FRONTEND)
        run("uv", "sync", "--frozen", "--no-dev", "--extra", "build")
        run("uv", "run", "pyinstaller", "--clean", "--noconfirm", "main.spec")
        bundle_windows_vcomp(app_name)
    finally:
        # The embedded app has the stamped version, but a local build must not
        # leave a tracked source file modified.
        version_file.write_bytes(original_version)


if __name__ == "__main__":
    main()
