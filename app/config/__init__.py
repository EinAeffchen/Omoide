"""Application settings: the live ``settings`` object plus loading, saving
and reloading it from config.yaml and OMOIDE_* environment overrides."""

import os
import sys
from typing import Any

import yaml

from app.logger import configure_file_logging, logger

from .profiles import IS_DOCKER, get_user_data_path
from .schema import AppSettings, ClipModel

ENV_PREFIX = "OMOIDE_"


def load_config_from_file() -> dict:
    """Loads settings from the user's YAML file."""
    config_path = get_user_data_path() / "config.yaml"
    if not config_path.exists():
        base_settings = AppSettings()
        seeded_data = base_settings.model_dump(mode="json")
        _apply_env_overrides(seeded_data)
        seeded_settings = AppSettings.model_validate(seeded_data)
        save_settings(seeded_settings)
    with open(config_path, "r") as f:
        return yaml.safe_load(f) or {}


def _coerce_env_value(value: str, current_value: Any = None) -> Any:
    """
    Convert raw env strings into reasonable Python types.

    Uses the existing config value to disambiguate list overrides so that
    blank list values (e.g., CUSTOM_TAGS=) become [] instead of "".
    """
    trimmed = value.strip()

    # Keep list overrides usable (comma-separated or explicit empty)
    if isinstance(current_value, list) or "," in trimmed:
        if trimmed == "":
            return []
        return [v.strip() for v in trimmed.split(",") if v.strip()]

    lowered = trimmed.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered == "null":
        return None
    try:
        if "_" not in trimmed:
            return int(trimmed)
    except ValueError:
        pass
    try:
        return float(trimmed)
    except ValueError:
        pass
    return trimmed


def _apply_env_overrides(config_data: dict) -> None:
    for key, raw_value in os.environ.items():
        if not key.startswith(ENV_PREFIX):
            continue
        path_segments = key[len(ENV_PREFIX) :].split("__")
        if not path_segments:
            continue
        target = config_data
        for segment in path_segments[:-1]:
            segment_lower = segment.lower()
            current = target.get(segment_lower)
            if not isinstance(current, dict):
                current = {}
                target[segment_lower] = current
            target = current
        final_key = path_segments[-1].lower()
        current_value = target.get(final_key)
        target[final_key] = _coerce_env_value(raw_value, current_value)


def load_settings() -> AppSettings:
    """
    Loads settings with a clear priority:
    1. Environment variables (for Docker)
    2. User's config.yaml file (for desktop app)
    3. Pydantic model defaults (hardcoded fallback)
    """
    # Start with an empty dict
    config_data = {}

    # 1. Load from user's config.yaml file
    file_config = load_config_from_file()
    if file_config:
        config_data.update(file_config)

    _apply_env_overrides(config_data)
    # 3. Load into Pydantic model. This applies defaults for any missing values.
    settings_model = AppSettings.model_validate(config_data)
    # Runtime-only flags should not be overridden by persisted config.
    settings_model.general.is_binary = bool(getattr(sys, "frozen", False))
    settings_model.general.is_docker = IS_DOCKER
    return settings_model


def _sanitize_for_save(settings_model: AppSettings) -> dict:
    """Return a dict for config.yaml that excludes derived fields and enforces
    data_dir from the active bootstrap profile.

    We avoid persisting computed paths (database_dir, omoide_dir, thumb_dir,
    models_dir, static_dir, database_url) and the mutable data_dir itself.
    On load, data_dir always derives from the active profile in bootstrap.
    """
    data = settings_model.model_dump(mode="json")
    general = data.get("general", {})
    # Force data_dir to the active profile path (or omit entirely)
    # Omitting keeps YAML clean; runtime will compute from bootstrap.
    for k in [
        "data_dir",
        "database_dir",
        "omoide_dir",
        "thumb_dir",
        "models_dir",
        "static_dir",
        "database_url",
        "is_binary",
        "is_docker",
    ]:
        general.pop(k, None)
    data["general"] = general
    return data


def save_settings(settings_model: AppSettings):
    """Saves the provided settings model to the config.yaml file."""
    config_file = get_user_data_path() / "config.yaml"
    with open(config_file, "w") as f:
        yaml.dump(
            _sanitize_for_save(settings_model),
            f,
            sort_keys=False,
            indent=2,
        )


def reload_settings():
    """Reloads the settings and the model."""
    global settings
    logger.info("Reloading settings...")
    new_settings = load_settings()
    # Always anchor data_dir to the active profile from bootstrap, ignoring
    # any stale values that may exist in config.yaml (e.g., copied from
    # another profile).
    try:
        new_settings.general.data_dir = get_user_data_path()
    except Exception:
        pass
    # Ensure required directories exist for the (possibly new) data_dir
    try:
        new_settings.general.database_dir.mkdir(parents=True, exist_ok=True)
        new_settings.general.omoide_dir.mkdir(parents=True, exist_ok=True)
        new_settings.general.thumb_dir.mkdir(parents=True, exist_ok=True)
        new_settings.general.models_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.warning("Could not create profile directories: %s", e)
    # Update the existing settings object in place, skipping computed fields
    for section_name in new_settings.model_fields:
        if not hasattr(settings, section_name):
            continue
        section = getattr(settings, section_name)
        # Determine assignable fields on this section (exclude computed properties)
        try:
            assignable_keys = set(section.model_fields.keys())  # type: ignore[attr-defined]
        except Exception:
            # Fallback: allow all keys from dump if model_fields unavailable
            assignable_keys = set()

        section_settings = getattr(new_settings, section_name)
        if hasattr(section_settings, "model_dump"):
            section_dump = section_settings.model_dump()
        else:
            section_dump = {}

        for key, value in section_dump.items():
            if assignable_keys and key not in assignable_keys:
                # Skip computed or non-settable attributes
                continue
            value = getattr(section_settings, key, value)
            if section_name == "ai" and key == "clip_model":
                setattr(section, key, ClipModel(value))
            else:
                try:
                    setattr(section, key, value)
                except AttributeError:
                    # Some attributes may be properties without setters (computed fields)
                    continue

    # Rebuild DB engine to reflect possible database_url changes after profile switch
    try:
        from app.database import (
            ensure_vec_tables,
            reset_engine,
            run_migrations,
        )

        reset_engine(settings.general.database_url)
        # Ensure schema and vector tables exist on the new DB
        run_migrations()
        ensure_vec_tables()
    except Exception as e:
        logger.warning(
            "Could not reset database engine or run migrations: %s", e
        )

    # Invalidate CLIP encoder to reflect possible AI model changes; will reload lazily
    from app.clip_onnx import reset_clip_encoder

    reset_clip_encoder()
    try:
        from app.processor_registry import reset_processors

        reset_processors()
    except Exception as e:
        logger.warning("Could not reset processors after config reload: %s", e)
    try:
        configure_file_logging(settings.general.data_dir / "logs")
    except Exception as e:
        logger.warning("Could not reconfigure file logging: %s", e)
    try:
        logger.info(
            "Active profile: data_dir=%s omoide_dir=%s thumb_dir=%s db_dir=%s",
            settings.general.data_dir,
            settings.general.omoide_dir,
            settings.general.thumb_dir,
            settings.general.database_dir,
        )
    except Exception:
        pass
    logger.info("Settings reloaded successfully.")


settings = load_settings()