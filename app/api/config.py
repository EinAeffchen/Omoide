import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

import app.database as db
from app.config import (
    AppSettings,
    read_bootstrap,
    reload_settings,
    save_settings,
    settings,
    write_bootstrap,
)
from app.models import ProcessingTask
from app.tagging import sanitize_custom_tag_list
from app.tasks import schedule_custom_auto_tagging


def _ensure_config_access_allowed() -> None:
    if settings.general.presentation_mode:
        raise HTTPException(
            status_code=403,
            detail="Configuration endpoints are disabled in read-only mode.",
        )


router = APIRouter(dependencies=[Depends(_ensure_config_access_allowed)])
logger = logging.getLogger(__name__)


@router.post("/reload", status_code=204)
async def reload_settings_endpoint():
    """Reloads the settings from the config.yaml file."""
    reload_settings()
    try:
        # Import locally to avoid circular import during app startup.
        from app.main import configure_auto_scan_job  # noqa:WPS433

        configure_auto_scan_job()
    except Exception as exc:  # pragma: no cover - scheduler reconfiguration
        logger.warning(
            "Failed to reconfigure auto-scan scheduler after reload: %s",
            exc,
        )


@router.get("/", response_model=AppSettings)
async def get_settings():
    """Returns the current settings model."""
    return settings


@router.post("/", response_model=AppSettings)
async def save_settings_endpoint(
    settings_model: AppSettings,
):
    """Saves the settings model to the config.yaml file."""
    incoming_custom = sanitize_custom_tag_list(settings_model.tagging.custom_tags)
    existing_custom = sanitize_custom_tag_list(settings.tagging.custom_tags)

    existing_normalized = {tag.lower() for tag in existing_custom}
    new_tags: list[str] = []
    seen_new: set[str] = set()
    for tag in incoming_custom:
        normalized = tag.lower()
        if normalized in existing_normalized or normalized in seen_new:
            continue
        seen_new.add(normalized)
        new_tags.append(tag)

    # Persist sanitized tags in the saved configuration
    settings_model.tagging.custom_tags = incoming_custom
    save_settings(settings_model)

    if new_tags and settings_model.tagging.auto_tagging:
        schedule_custom_auto_tagging(new_tags)
    return settings_model


@router.get("/pick-directory")
def pick_directory():
    """
    Opens a native folder selection dialog and returns the chosen path.
    Only meaningful for local/binary usage; not supported in Docker.
    """
    if settings.general.is_docker:
        raise HTTPException(
            status_code=400, detail="Folder picker not available in Docker."
        )

    # Prefer the running pywebview window (Qt dialog) when available so users
    # get a native experience even from the packaged binary.
    try:
        import webview

        window = next(iter(webview.windows), None)
        if window is not None:
            try:
                selection = window.create_file_dialog(webview.FOLDER_DIALOG)
                if isinstance(selection, (list, tuple)):
                    for item in selection:
                        if item:
                            return {"path": str(item)}
                    return {"path": ""}
                if isinstance(selection, str):
                    return {"path": selection}
                return {"path": ""}
            except Exception as exc:  # pragma: no cover - GUI specific
                logger.debug("pywebview folder picker failed: %s", exc)
    except Exception:
        # Either pywebview is not installed or no window is active; fallback to
        # the tkinter implementation below.
        pass

    # As a fallback keep the tkinter dialog for local development scenarios.
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        try:
            # Bring dialog to front
            root.wm_attributes("-topmost", 1)
        except Exception:
            pass
        path = filedialog.askdirectory()
        try:
            root.destroy()
        except Exception:
            pass
        return {"path": path or ""}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Folder picker failed: {e}")


@router.get("/profiles")
def list_profiles():
    if settings.general.is_docker:
        raise HTTPException(status_code=400, detail="Profiles not supported in Docker.")
    bs = read_bootstrap() or {}
    return {
        "active_path": bs.get("active_profile", str(settings.general.data_dir)),
        "profiles": bs.get("profiles", []),
    }


@router.get("/profile-health")
def profile_health():
    """Return simple diagnostics about the active profile.

    This helps the UI detect if the profile may have been moved manually and
    offer a relink flow. We avoid creating or modifying paths here.
    """
    try:
        bs = read_bootstrap() or {}
        active_path = bs.get("active_profile", str(settings.general.data_dir))
    except Exception:
        active_path = str(settings.general.data_dir)

    ap = Path(active_path)
    active_exists = ap.exists()

    # Check for presence of a database file in the currently running settings
    # (which reflect the active profile at runtime)
    try:
        db_file = Path(settings.general.database_dir) / "omoide.db"
        has_db = db_file.exists()
    except Exception:
        has_db = False

    # Check if there are any thumbnails present
    try:
        tdir = Path(settings.general.thumb_dir)
        has_thumbs = any(tdir.iterdir()) if tdir.exists() else False
    except Exception:
        has_thumbs = False

    return {
        "active_path": active_path,
        "active_exists": bool(active_exists),
        "has_db": bool(has_db),
        "has_thumbs": bool(has_thumbs),
    }


def _assert_no_active_tasks():
    """Prevent profile modifications while tasks are running.

    Only 'running' tasks are considered blocking. 'pending' tasks can be
    leftovers from failed starts and should not block profile changes.
    """
    with Session(db.engine) as session:
        active = session.exec(
            select(ProcessingTask).where(ProcessingTask.status == "running")
        ).first()
        if active:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Profile changes are blocked while processing tasks are running. "
                    "Please wait for tasks to finish."
                ),
            )


class SwitchProfileRequest(BaseModel):
    path: str


def _sanitize_profile_path(p: Path) -> Path:
    """Ensure chosen profile roots are not inside an internal '.omoide' directory.

    If a user accidentally picks a path containing a '.omoide' segment, lift the
    profile root out of that internal directory to prevent nested '.omoide'
    folders such as 'E:\\ .omoide \\ test \\.omoide\\thumbnails'.
    """
    parts = list(p.parts)
    if ".omoide" in parts:
        i = parts.index(".omoide")
        try:
            p = Path(*parts[:i], *parts[i + 1 :])
        except Exception:
            return p
    return p


@router.post("/profiles/switch", status_code=204)
def switch_profile(req: SwitchProfileRequest):
    if settings.general.is_docker:
        raise HTTPException(
            status_code=400,
            detail="Switching profiles not supported in Docker.",
        )
    _assert_no_active_tasks()
    dest = Path(req.path).expanduser()
    dest = _sanitize_profile_path(dest)
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)

    # If target profile has no config yet, bootstrap it with defaults
    try:
        target_config = dest / "config.yaml"
        if not target_config.exists():
            import yaml

            from app.config import AppSettings

            defaults = AppSettings().model_dump(mode="json")
            # Remove derived paths and data_dir; they are computed by runtime
            general = defaults.get("general", {})
            for k in [
                "data_dir",
                "database_dir",
                "omoide_dir",
                "thumb_dir",
                "models_dir",
                "static_dir",
                "database_url",
            ]:
                general.pop(k, None)
            defaults["general"] = general
            with open(target_config, "w") as f:
                yaml.safe_dump(defaults, f, sort_keys=False, indent=2)
    except Exception:
        # Non-fatal; continue with runtime defaults
        pass

    bs = read_bootstrap() or {}
    profiles = bs.get("profiles", [])
    # ensure profile exists in list
    if not any(p.get("path") == str(dest) for p in profiles):
        profiles.append({"name": dest.name or "Profile", "path": str(dest)})
    bs["profiles"] = profiles
    bs["active_profile"] = str(dest)
    write_bootstrap(bs)
    reload_settings()


class CreateProfileRequest(BaseModel):
    path: str
    name: str | None = None


@router.post("/profiles/create", status_code=204)
def create_profile(req: CreateProfileRequest):
    if settings.general.is_docker:
        raise HTTPException(
            status_code=400,
            detail="Creating profiles not supported in Docker.",
        )
    _assert_no_active_tasks()
    # Interpret the given path as a base directory when a name is provided.
    # If the final path already ends with the given name, do not double-nest.
    base = Path(req.path).expanduser()
    base = _sanitize_profile_path(base)
    provided_name = (req.name or base.name or "Profile").strip() or "Profile"

    dest = base
    try:
        if req.name and base.name.lower() != provided_name.lower():
            dest = base / provided_name
    except Exception:
        # Fall back to simple concatenation if needed
        dest = base / provided_name if req.name else base

    # Resolve to absolute path without requiring existence
    try:
        dest = dest.resolve()
    except Exception:
        dest = dest

    if dest.exists() and any(dest.iterdir()):
        raise HTTPException(
            status_code=400, detail="Destination exists and is not empty."
        )
    dest.mkdir(parents=True, exist_ok=True)

    # Write a default config.yaml for the new profile (always overwrite)
    try:
        target_config = dest / "config.yaml"
        import yaml

        from app.config import AppSettings

        defaults = AppSettings().model_dump(mode="json")
        general = defaults.get("general", {})
        for k in [
            "data_dir",
            "database_dir",
            "omoide_dir",
            "thumb_dir",
            "models_dir",
            "static_dir",
            "database_url",
        ]:
            general.pop(k, None)
        defaults["general"] = general
        with open(target_config, "w") as f:
            yaml.safe_dump(defaults, f, sort_keys=False, indent=2)
    except Exception:
        pass

    # Create a fresh config in the new profile upon switch via reload

    bs = read_bootstrap() or {}
    profiles = bs.get("profiles", [])
    name = provided_name or (dest.name or "Profile")
    if not any(p.get("path") == str(dest) for p in profiles):
        profiles.append({"name": name, "path": str(dest)})
    bs["profiles"] = profiles
    bs["active_profile"] = str(dest)
    write_bootstrap(bs)
    reload_settings()


class RemoveProfileRequest(BaseModel):
    path: str


@router.post("/profiles/remove", status_code=204)
def remove_profile(req: RemoveProfileRequest):
    if settings.general.is_docker:
        raise HTTPException(
            status_code=400,
            detail="Removing profiles not supported in Docker.",
        )
    _assert_no_active_tasks()

    bs = read_bootstrap() or {}
    active = bs.get("active_profile")

    # Normalize paths for comparison
    try:
        target = str(Path(req.path).expanduser().resolve())
        active_norm = str(Path(active).expanduser().resolve()) if active else None
    except Exception:
        target = req.path
        active_norm = active

    if active_norm and target == active_norm:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove the active profile. Switch to another profile first.",
        )

    profiles = bs.get("profiles", [])
    new_profiles = [p for p in profiles if str(p.get("path", "")) != target]
    bs["profiles"] = new_profiles
    write_bootstrap(bs)


class AddProfileRequest(BaseModel):
    path: str
    name: str | None = None


@router.post("/profiles/add", status_code=204)
def add_profile(req: AddProfileRequest):
    """Register an existing profile directory without switching to it.

    This is useful when a user has copied a profile from another machine
    and wants to make it selectable. We do minimal validation and do not
    attempt to mutate the directory structure.
    """
    if settings.general.is_docker:
        raise HTTPException(status_code=400, detail="Profiles not supported in Docker.")
    _assert_no_active_tasks()

    p = Path(req.path).expanduser()
    p = _sanitize_profile_path(p)
    try:
        p = p.resolve()
    except Exception:
        p = p

    if not p.exists() or not p.is_dir():
        raise HTTPException(
            status_code=400,
            detail="Selected path does not exist or is not a directory.",
        )

    bs = read_bootstrap() or {}
    profiles = bs.get("profiles", [])
    if not any(entry.get("path") == str(p) for entry in profiles):
        name = (req.name or p.name or "Profile").strip() or "Profile"
        profiles.append({"name": name, "path": str(p)})
        bs["profiles"] = profiles
        write_bootstrap(bs)
