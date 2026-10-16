"""Where Omoide keeps its data: OS config dir, bootstrap.yaml profiles and static assets."""

import os
import sys
from pathlib import Path

import yaml

from app.logger import logger


def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


# Set by the Docker image (ENV IS_DOCKER=true); the single source of truth.
IS_DOCKER = _env_flag("IS_DOCKER")


# ----- Bootstrap/profile management -----
def get_os_app_config_dir() -> Path:
    """Returns the OS-specific config directory for omoide.

    This is the stable location for bootstrap.yaml that remembers
    which profile (data directory) is active.

    Platform defaults (can be overridden via env vars):
      Windows : %APPDATA%\\omoide          (e.g. C:\\Users\\<user>\\AppData\\Roaming\\omoide)
      macOS   : ~/Library/Application Support/omoide
      Linux   : $XDG_CONFIG_HOME/omoide   (e.g. ~/.config/omoide)
    """
    if sys.platform == "win32":
        base = Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path(
            os.getenv("XDG_CONFIG_HOME")
            or Path.home() / "Library" / "Application Support"
        )
    else:
        base = Path(os.getenv("XDG_CONFIG_HOME") or Path.home() / ".config")
    d = base / "omoide"
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_bootstrap_file() -> Path:
    return get_os_app_config_dir() / "bootstrap.yaml"


def read_bootstrap() -> dict:
    p = get_bootstrap_file()
    if not p.exists():
        return {}
    try:
        with open(p, "r") as f:
            data = yaml.safe_load(f) or {}
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_bootstrap(data: dict) -> None:
    p = get_bootstrap_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        yaml.safe_dump(data, f, sort_keys=False, indent=2)


def _default_local_profile_dir() -> Path:
    """Legacy default profile path used before profiles existed.

    We continue to use the same path for backward compatibility so
    existing users keep working seamlessly.
    """
    return get_os_app_config_dir()


def get_user_data_path() -> Path:
    """Resolve the active profile (data directory).

    Priority:
    - Docker: fixed to /app/data
    - Desktop/binary: read bootstrap.yaml for active_profile; if not present,
      bootstrap it pointing to the legacy default path.
    """
    if IS_DOCKER:
        p = Path("/app/data")
        p.mkdir(parents=True, exist_ok=True)
        return p

    bootstrap = read_bootstrap()
    active = bootstrap.get("active_profile")
    if active:
        p = Path(active)
        try:
            p.mkdir(parents=True, exist_ok=True)
            return p
        except Exception as e:
            # If the configured profile path is unavailable (e.g., missing drive
            # or network location), fall back to a safe local profile instead of
            # crashing on startup. Persist the fallback so the app can run.
            logger.warning(
                "Active profile '%s' is not accessible; falling back to default"
                " profile. Error: %s",
                active,
                e,
            )
            try:
                default_profile = _default_local_profile_dir()
                default_profile.mkdir(parents=True, exist_ok=True)
                # Keep the old profile listed for visibility; switch active to fallback
                bs = bootstrap or {}
                profiles = bs.get("profiles", [])
                if not any(
                    (isinstance(x, dict) and x.get("path") == str(p)) for x in profiles
                ):
                    profiles.append({"name": p.name or "Profile", "path": str(p)})
                bs["profiles"] = profiles
                bs["active_profile"] = str(default_profile)
                write_bootstrap(bs)
                return default_profile
            except Exception:
                # As a last resort, use a directory under the user's config dir
                d = _default_local_profile_dir()
                d.mkdir(parents=True, exist_ok=True)
                return d

    # Bootstrap missing: create initial profile using legacy location
    default_profile = _default_local_profile_dir()
    default_profile.mkdir(parents=True, exist_ok=True)
    bootstrap = {
        "active_profile": str(default_profile),
        "profiles": [{"name": "Default", "path": str(default_profile)}],
    }
    write_bootstrap(bootstrap)
    return default_profile


def get_static_assets_dir() -> Path:
    """
    Gets the correct path to the static assets folder for PyInstaller,
    Docker, and local development environments.
    """
    # 1. Check if running as a bundled executable (PyInstaller)
    static_dir = Path("dist/assets")
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # The path is absolute, inside the temporary _MEIPASS directory
        # This must match the DESTINATION part of your --add-data flag
        # e.g., --add-data "frontend/dist:dist"
        base_path = Path(sys._MEIPASS)
        static_dir = base_path / "dist"

    # 2. Check if running inside our Docker container via an env var
    elif IS_DOCKER:
        # The path is absolute within the container
        static_dir = Path("/app/static")

    # 3. Fallback to local development path
    static_dir.mkdir(exist_ok=True, parents=True)
    return static_dir
