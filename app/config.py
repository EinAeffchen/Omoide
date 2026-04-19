import gc
import math
import os
import shutil
import sys
import threading
from enum import Enum
from pathlib import Path
from typing import Any, TypeVar

import yaml
from pydantic import (
    BaseModel,
    Field,
    PlainSerializer,
    computed_field,
    field_validator,
)
from typing_extensions import Annotated

from app.logger import configure_file_logging, logger

E = TypeVar("E", bound=Enum)
IS_DOCKER = os.getenv("IS_DOCKER", False)
ENV_PREFIX = "OMOIDE_"


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
        base = Path(os.getenv("XDG_CONFIG_HOME") or Path.home() / "Library" / "Application Support")
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
                    profiles.append(
                        {
                            "name": p.name or "Profile",
                            "path": str(p),
                        }
                    )
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
        "profiles": [
            {"name": "Default", "path": str(default_profile)},
        ],
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
    elif os.environ.get("IS_DOCKER"):
        # The path is absolute within the container
        static_dir = Path("/app/static")

    # 3. Fallback to local development path
    static_dir.mkdir(exist_ok=True, parents=True)
    return static_dir


class DuplicateKeepRule(Enum):
    """Defines the set of valid rules for keeping a duplicate file."""

    BIGGEST = "biggest"
    SMALLEST = "smallest"
    HIGHEST_RES = "highest_res"
    LOWEST_RES = "lowest_res"
    OLDEST = "oldest"
    NEWEST = "newest"

    @classmethod
    def get_default(cls):
        return cls.OLDEST

    def __str__(self):
        return self.value


class DuplicateHandlingRule(Enum):
    """Defines the set of valid rules for keeping a duplicate file."""

    KEEP = "keep"
    REMOVE = "remove"
    BLACKLIST = "blacklist"
    DELETE = "delete"

    @classmethod
    def get_default(cls):
        return cls.KEEP

    def __str__(self):
        return self.value


class MediaDirectory(BaseModel):
    path: Path
    read_only: bool = False


class ReadOnlyMediaError(PermissionError):
    def __init__(self, target: Path, base: Path):
        self.target = target
        self.base = base
        super().__init__(f"Media directory '{base}' is read-only.")


def _resolve_path_safe(value: Path) -> Path:
    try:
        return value.expanduser().resolve()
    except Exception:
        try:
            return value.expanduser()
        except Exception:
            return value


def _is_within(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


class ClipModel(Enum):
    ROBERTA_LARGE_VIT_H_14 = (
        "xlm-roberta-large-ViT-H-14",
        1024,
        "frozen_laion5b_s13b_b90k",
    )
    ROBERTA_BASE_VIT_B_32 = (
        "xlm-roberta-base-ViT-B-32",
        512,
        "laion5b_s13b_b90k",
    )
    VIT_L_14 = ("ViT-L-14", 768, "laion2b_s32b_b82k")
    VIT_B_32 = ("ViT-B-32", 512, "laion2b_s34b_b79k")
    CONVNEXT_BASE_W = ("convnext_base_w", 640, "laion2b_s13b_b82k_augreg")

    def __init__(self, model_name: str, embedding_size: int, pretrained: str):
        """
        This initializer is called for each member, assigning the tuple
        values to attributes on the member itself.
        """
        self.model_name = model_name
        self.embedding_size = embedding_size
        self.pretrained = pretrained

    @classmethod
    def _missing_(cls, value: object):
        """This custom hook correctly finds an enum member from a string."""
        if isinstance(value, str):
            for member in cls:
                if member.model_name.lower() == value.lower():
                    return member
        return None

    @classmethod
    def get_default(cls):
        # Define the default model
        return cls.ROBERTA_LARGE_VIT_H_14

    def __str__(self):
        return self.model_name


class GeneralSettings(BaseModel):
    port: int = 8123
    # Run system in presentation_mode mode or not
    presentation_mode: bool = False
    # Enable face recognition and other person related features
    enable_people: bool = True
    meme_mode: bool = False
    is_docker: bool = bool(os.environ.get("IS_DOCKER", False))
    # Whether the app is running as a packaged/binary executable (e.g., PyInstaller)
    is_binary: bool = bool(getattr(sys, "frozen", False))
    # Prefer GPU acceleration when available.
    # Maximum nodes to request for the person relationship graph
    person_relationship_max_nodes: int = 100
    # Which host the system runs on. Mostly only relevant if hosted online.
    domain: str = f"http://localhost:{port}"
    # Optional override to point at a specific ffmpeg binary
    ffmpeg_path: Path | None = None
    # maximum number of thumbnails per folder, adjust according to your systems inodes
    thumb_dir_folder_size: int = 1000
    # GitHub repo (owner/name) used for update checks. Set to None to disable.
    update_check_repo: str | None = "EinAeffchen/Omoide"
    # How long (in minutes) to cache the latest release lookup.
    update_check_cache_minutes: int = 180
    # Timeout (seconds) for contacting the GitHub API.
    update_check_timeout_seconds: float = 5.0

    data_dir: Path = Field(default_factory=get_user_data_path)

    # Derived paths (computed fields) keep in sync with data_dir
    @computed_field
    @property
    def database_dir(self) -> Path:
        return self.data_dir / "database"

    @computed_field
    @property
    def omoide_dir(self) -> Path:
        return self.data_dir / ".omoide"

    @computed_field
    @property
    def thumb_dir(self) -> Path:
        return self.omoide_dir / "thumbnails"

    # only relevant when run as binary
    media_dirs: list[MediaDirectory] = Field(default_factory=list)
    static_dir: Path = get_static_assets_dir()

    @computed_field
    @property
    def models_dir(self) -> Path:
        if IS_DOCKER:
            return self.omoide_dir / "models"
        return get_os_app_config_dir() / "models"

    @computed_field
    @property
    def database_url(self) -> str:
        return (
            f"sqlite:///{self.database_dir}/omoide.db?cache=shared&mode=rwc"
            "&_journal_mode=WAL&_synchronous=NORMAL"
        )

    @field_validator("media_dirs", mode="before")
    @classmethod
    def _coerce_media_dirs(cls, value):
        if value is None:
            return []
        if not isinstance(value, list):
            return value
        normalized: list[dict[str, object]] = []
        for item in value:
            if isinstance(item, dict):
                path_value = item.get("path") or item.get("dir") or item.get("value")
                if path_value is None:
                    continue
                read_only = bool(item.get("read_only", False))
                normalized.append({"path": path_value, "read_only": read_only})
            elif isinstance(item, (str, Path)):
                normalized.append({"path": item, "read_only": False})
        return normalized

    def model_post_init(self, context) -> None:
        # Presentation/read-only mode is only configurable via Docker runtime env.
        # Force it off in binaries/local runs so the UI/config file cannot enable it.
        if not IS_DOCKER:
            self.presentation_mode = False

        # Ensure required directories exist based on current data_dir
        self.database_dir.mkdir(parents=True, exist_ok=True)
        self.omoide_dir.mkdir(parents=True, exist_ok=True)
        self.thumb_dir.mkdir(parents=True, exist_ok=True)
        self.models_dir.mkdir(parents=True, exist_ok=True)
        if not IS_DOCKER:
            legacy_models_dir = self.omoide_dir / "models"
            try:
                if legacy_models_dir.exists() and legacy_models_dir != self.models_dir:
                    migrated_any = False
                    for item in legacy_models_dir.iterdir():
                        dest = self.models_dir / item.name
                        if dest.exists():
                            continue
                        try:
                            shutil.move(str(item), dest)
                            migrated_any = True
                        except Exception as move_err:
                            logger.warning(
                                "Could not migrate legacy model %s -> %s: %s",
                                item,
                                dest,
                                move_err,
                            )
                    if migrated_any:
                        logger.info(
                            "Migrated profile models into shared cache: %s",
                            self.models_dir,
                        )
                    try:
                        legacy_models_dir.rmdir()
                    except OSError:
                        pass
            except Exception as e:
                logger.warning("Could not migrate legacy models directory: %s", e)
        if IS_DOCKER:
            self.media_dirs = [MediaDirectory(path=Path("/app/media"))]

    def resolved_media_dirs(self) -> list[tuple[Path, bool]]:
        """Return unique, resolved media directories paired with read-only flag."""
        resolved: list[tuple[Path, bool]] = []
        seen: set[Path] = set()
        for entry in self.media_dirs:
            base = _resolve_path_safe(entry.path)
            if base in seen:
                continue
            seen.add(base)
            resolved.append((base, bool(entry.read_only)))
        return resolved

    def ensure_media_path_writable(self, target: Path) -> None:
        """Raise if the path lives inside a read-only media directory."""
        normalized = _resolve_path_safe(target)
        for base, read_only in self.resolved_media_dirs():
            if _is_within(normalized, base):
                if read_only:
                    raise ReadOnlyMediaError(normalized, base)
                return


class TaggingSettings(BaseModel):
    auto_tagging: bool = True
    # whether to use the default system defined tags.
    use_default_tags: bool = True
    # add any tags in any language supported by the chosen clip model
    custom_tags: list[str] = []


class ScanSettings(BaseModel):
    # enables automatic background scans for new files
    auto_scan: bool = False
    # How often to scan for files in minutes
    scan_interval_minutes: int = 15
    # If autoscan should also automatically clean the database from missing files
    auto_clean_on_scan: bool = False
    # Automatically delete records for files that remain missing without manual review
    auto_cleanup_without_review: bool = False
    # Grace period in hours before auto cleanup removes a missing record
    auto_cleanup_grace_hours: int = 72
    # If autoscan should also automatically cluster all faces.
    # Not recommended if you manually adjusted people
    auto_cluster_on_scan: bool = False
    # sometimes images are rotated based on their exif data
    # this is automatically caught by most apps and the user doesn't notice
    # this option automatically rotates them to the correct direction and removes
    # the exif rotation information
    auto_rotate: bool = True
    # Skip files that look like thumbnails while scanning media directories
    skip_thumbnails_on_scan: bool = True
    VIDEO_SUFFIXES: list[str] = [
        ".mp4",
        ".mov",
        ".wmv",
        ".avi",
        ".flv",
        ".mkv",
        ".webm",
        ".gp3",
        ".gif",
        ".ts",
        ".mpeg",
    ]
    IMAGE_SUFFIXES: list[str] = [
        ".jpg",
        ".jpeg",
        ".png",
        ".tiff",
        ".bmp",
    ]


class AISettings(BaseModel):
    # which model to use for image processing. Options:
    # 1. xlm-roberta-large-ViT-H-14 -> Cross language large model
    # 2. xlm-roberta-base-ViT-B-32 -> Cross language small model
    # Below models are not tested yet and might need adjustments on the database
    # vector sizes
    # 3. ViT-L-14 -> english only large model
    # 4. laion2b_s32b_b82k -> english only large model
    # 5. ViT-B-32 -> english only base model
    # 6. convnext_base_w -> english only convolution base model
    clip_model: Annotated[
        ClipModel,
        PlainSerializer(lambda x: x.model_name, return_type=str),
    ] = ClipModel.ROBERTA_BASE_VIT_B_32

    # @computed_field
    @property
    def clip_model_embedding_size(self) -> int:
        return self.clip_model.embedding_size

    # @computed_field
    @property
    def clip_model_pretrained(self) -> str:
        return self.clip_model.pretrained

    # Strictness of the search results. Higher -> more accurate but less hits.
    # Internally: max_dist = 2.0 - min_search_dist. For L2 distance on unit
    # vectors this translates to a minimum cosine similarity of
    # 1 - (max_dist² / 2).  At 0.68 that is ~13 %; at 0.80 it is ~28 %.
    min_search_dist: float = 0.80
    # Defines the maximum distance for similarity between two images.
    # Used to reduce/increase number of similar images. Higher -> stronger similarity
    min_similarity_dist: float = 1.2
    # (cluster-specific knobs moved to face_recognition)


class FaceClusteringPreset(str, Enum):
    STRICT = "strict"
    NORMAL = "normal"
    LOOSE = "loose"
    CUSTOM = "custom"


FACE_RECOGNITION_PRESETS: dict[
    FaceClusteringPreset, dict[str, float | int | str | bool]
] = {
    FaceClusteringPreset.STRICT: {
        "face_recognition_min_confidence": 0.6,
        "existing_person_cosine_threshold": 0.86,
        "existing_person_min_cosine_margin": 0.07,
        "face_recognition_min_face_pixels": 1600,
        "person_min_face_count": 3,
        "person_min_media_count": 2,
        "person_merge_search_k": 30,
        "person_cluster_max_l2_radius": 0.95,
        "person_merge_percent_similarity": 78,
        "cluster_batch_size": 15000,
        "hdbscan_min_cluster_size": 6,
        "hdbscan_min_samples": 12,
        "hdbscan_cluster_selection_method": "eom",
        "hdbscan_cluster_selection_epsilon": 0.07,
        "cw_threshold": 0.6,
        "cw_k_neighbors":10,
        "cw_iterations": 20,
    },
    FaceClusteringPreset.NORMAL: {
        "face_recognition_min_confidence": 0.5,
        "existing_person_cosine_threshold": 0.80,
        "existing_person_min_cosine_margin": 0.05,
        "face_recognition_min_face_pixels": 1600,
        "person_min_face_count": 2,
        "person_min_media_count": 2,
        "person_merge_search_k": 40,
        "person_cluster_max_l2_radius": 1,
        "person_merge_percent_similarity": 72,
        "cluster_batch_size": 15000,
        "hdbscan_min_cluster_size": 6,
        "hdbscan_min_samples": 10,
        "hdbscan_cluster_selection_method": "eom",
        "hdbscan_cluster_selection_epsilon": 0.10,
        "cw_threshold": 0.6,
        "cw_k_neighbors":10,
        "cw_iterations": 20,
    },
    FaceClusteringPreset.LOOSE: {
        "face_recognition_min_confidence": 0.4,
        "existing_person_cosine_threshold": 0.75,
        "existing_person_min_cosine_margin": 0.03,
        "face_recognition_min_face_pixels": 1200,
        "person_min_face_count": 2,
        "person_min_media_count": 2,
        "person_merge_search_k": 50,
        "person_cluster_max_l2_radius": 1.04,
        "person_merge_percent_similarity": 68,
        "cluster_batch_size": 15000,
        "hdbscan_min_cluster_size": 4,
        "hdbscan_min_samples": 4,
        "hdbscan_cluster_selection_method": "eom",
        "hdbscan_cluster_selection_epsilon": 0.11,
        "cw_threshold": 0.6,
        "cw_k_neighbors":10,
        "cw_iterations": 20,
    },
}


class FaceRecognitionSettings(BaseModel):
    preset: FaceClusteringPreset = FaceClusteringPreset.LOOSE
    # minimum confidence needed to extract a face
    face_recognition_min_confidence: float = 0.5
    # stricter threshold for assigning new faces to existing persons (vs general usage)
    existing_person_cosine_threshold: float = 0.80
    # requires a margin between best and second-best match (cosine space)
    existing_person_min_cosine_margin: float = 0.05
    # minimum size of a face in pixels to be detected. Base size for detection
    # is the original image, not a thumbnail!
    face_recognition_min_face_pixels: int = 1600
    # number of faces needed to automatically create a person
    person_min_face_count: int = 2
    # require a person to span at least this many distinct media assets
    person_min_media_count: int = 2
    # enforce intra-cluster compactness when forming a new person
    # maximum allowed L2 radius around centroid (normalized vectors)
    person_cluster_max_l2_radius: float = 1.04
    # merge previously created persons when their embeddings are extremely similar
    person_merge_percent_similarity: int = 80
    person_merge_search_k: int = 20
    # reduce if ram is an issue, the higher the more accurate the clustering.
    cluster_batch_size: int = 15000
    # clustering algorithm to use for person discovery
    # graph k-NN clustering settings (similarity in percent)
    cw_threshold: float = 0.6
    cw_iterations: int = 20
    cw_k_neighbors: int = 10
    # Cap per-HDBSCAN batch size to keep large datasets from stalling.
    # HDBSCAN tuning to reduce over-merged clusters (e.g., side profiles)
    hdbscan_min_cluster_size: int = 6
    hdbscan_min_samples: int = 10
    hdbscan_cluster_selection_method: str = "eom"  # "leaf" for finer clusters
    hdbscan_cluster_selection_epsilon: float = 0.10

    def model_post_init(self, __context: Any) -> None:
        fields_set = getattr(self, "model_fields_set", set())
        if "preset" not in fields_set:
            matched = self._infer_preset()
            object.__setattr__(self, "preset", matched)
            return

        if self.preset == FaceClusteringPreset.CUSTOM:
            return

        preset_values = FACE_RECOGNITION_PRESETS.get(self.preset)
        if not preset_values:
            object.__setattr__(self, "preset", FaceClusteringPreset.CUSTOM)
            return

        for field_name, value in preset_values.items():
            object.__setattr__(self, field_name, value)

    def _infer_preset(self) -> FaceClusteringPreset:
        for preset, values in FACE_RECOGNITION_PRESETS.items():
            if self._matches_values(values):
                return preset
        return FaceClusteringPreset.CUSTOM

    def _matches_values(self, expected: dict[str, float | int | str]) -> bool:
        for field_name, value in expected.items():
            current = getattr(self, field_name)
            if isinstance(value, float):
                if not math.isclose(
                    float(current), float(value), rel_tol=1e-4, abs_tol=1e-4
                ):
                    return False
            else:
                if current != value:
                    return False
        return True


class DuplicateSettings(BaseModel):
    """Defines how to handle detected duplicate files"""

    # what to do with duplicates. Default = Keep = do nothing automatically
    duplicate_auto_handling: DuplicateHandlingRule = DuplicateHandlingRule.KEEP
    # Which image/video to keep in case auto_handling != keep
    duplicate_auto_keep_rule: DuplicateKeepRule = DuplicateKeepRule.HIGHEST_RES


class VideoSettings(BaseModel):
    """These settings control the video processing. By default we automatically
    detect scenes in a video and retrieve thumbnails for the scene overlay
    and the content searchability. If scene detection fails we split videos every
    n seconds into a maximum of :max_frames_per_video scenes."""

    # automatically detect scenes to split video into images
    auto_scene_detection: bool = True
    # Max number of frames detected per video if automatic scene detection fails
    max_frames_per_video: int = 30


class ContentProcessorSettings(BaseModel):
    # extract exif data from images/videos
    exif_processor_active: bool = True
    # extract faces from content. Only active when enable_people=true.
    face_processor_active: bool = True
    # image embedding creator active. Needed for all AI related features
    # if you want to deactivate all smart features, set this to False
    image_embedding_processor_active: bool = True
    # number of media rows processed per batch when running the heavy pipeline
    media_batch_size: int = 125


class AppSettings(BaseModel):
    general: GeneralSettings = Field(default_factory=GeneralSettings)
    scan: ScanSettings = Field(default_factory=ScanSettings)
    ai: AISettings = Field(default_factory=AISettings)
    tagging: TaggingSettings = Field(default_factory=TaggingSettings)
    face_recognition: FaceRecognitionSettings = Field(
        default_factory=FaceRecognitionSettings
    )
    duplicates: DuplicateSettings = Field(default_factory=DuplicateSettings)
    video: VideoSettings = Field(default_factory=VideoSettings)
    processors: ContentProcessorSettings = Field(
        default_factory=ContentProcessorSettings
    )


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
    settings_model.general.is_docker = bool(os.environ.get("IS_DOCKER", False))
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


def get_model(settings: AppSettings):
    """Create a new OpenCLIP model bundle on the selected device.

    Note: This constructs a fresh model; callers should prefer the
    acquire_clip()/get_clip_bundle() helpers below to reuse a shared instance.
    """
    import open_clip

    from app.accelerators import resolve_torch_device

    device = resolve_torch_device(False)
    model, preprocess, _ = open_clip.create_model_and_transforms(
        settings.ai.clip_model.model_name,
        pretrained=settings.ai.clip_model_pretrained,
        device=device,
    )

    tokenizer = open_clip.get_tokenizer(settings.ai.clip_model.model_name)
    return model, preprocess, tokenizer


# ----- Lazy, shared CLIP bundle management -----
_clip_lock = threading.RLock()
_clip_model = None
_clip_preprocess = None
_clip_tokenizer = None
_clip_refs = 0


def get_clip_bundle():
    """Return a shared CLIP bundle, loading it lazily if needed.

    Does not change the reference count; use acquire_clip()/release_clip()
    when you want lifecycle management (e.g., processors and long tasks).
    """
    global _clip_model, _clip_preprocess, _clip_tokenizer
    with _clip_lock:
        if _clip_model is None:
            logger.info("Loading OpenCLIP bundle (lazy)...")
            _clip_model, _clip_preprocess, _clip_tokenizer = get_model(settings)
        return _clip_model, _clip_preprocess, _clip_tokenizer


def acquire_clip():
    """Acquire a reference to the shared CLIP bundle and return it.

    While at least one reference is held, the bundle remains loaded.
    """
    global _clip_refs
    with _clip_lock:
        model, preprocess, tokenizer = get_clip_bundle()
        _clip_refs += 1
        return model, preprocess, tokenizer


def release_clip():
    """Release a previously acquired CLIP bundle reference.

    When the refcount drops to zero, unload the bundle to free memory.
    """
    global _clip_refs, _clip_model, _clip_preprocess, _clip_tokenizer
    with _clip_lock:
        if _clip_refs > 0:
            _clip_refs -= 1
        if _clip_refs == 0 and _clip_model is not None:
            logger.info("Releasing OpenCLIP bundle from memory")
            try:
                _clip_model = None
                _clip_preprocess = None
                _clip_tokenizer = None
            finally:
                gc.collect()


def _reset_clip_after_settings_change():
    """Clear the shared CLIP bundle if nothing is using it.

    If references are held, defer reset until they are released.
    """
    global _clip_model, _clip_preprocess, _clip_tokenizer
    with _clip_lock:
        if _clip_refs == 0:
            _clip_model = None
            _clip_preprocess = None
            _clip_tokenizer = None
        else:
            logger.info(
                "Deferring CLIP reload until current users release it (refs=%s)",
                _clip_refs,
            )


def reload_settings():
    """Reloads the settings and the model."""
    global settings, model, preprocess, tokenizer
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
        logger.warning("Could not reset database engine or run migrations: %s", e)

    # Invalidate CLIP bundle to reflect possible AI model changes; will reload lazily
    _reset_clip_after_settings_change()
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
