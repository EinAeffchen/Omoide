"""
Task orchestration helpers extracted from `app.api.tasks`.

This package hosts reusable services that power background jobs such as
media processing, scanning, clustering, and duplicate detection. API
routers can import from here instead of carrying large helper blocks.
"""

from __future__ import annotations

from . import state
from .auto_tagging import run_custom_auto_tagging, schedule_custom_auto_tagging
from .backfill import run_backfill_face_timestamps
from .blur import compute_blur_scores
from .common import create_and_run_task
from .duplicates import run_duplicate_detection
from .hashes import generate_hashes
from .maintenance import (
    clean_missing_files,
    reset_clustering,
    reset_processing,
)
from .media_processing import (
    run_media_processing,
    run_media_processing_and_chain,
    run_processors_for_media,
    run_single_processor,
)
from .person_clustering import (
    merge_similar_persons,
    rebuild_person_embedding,
    run_person_clustering,
)
from .organize import run_build_events, run_geocode_places
from .pipeline import run_cleanup_and_chain, run_scan_and_chain
from .relationships import rebuild_person_relationships
from .scan import run_scan

__all__ = [
    "clean_missing_files",
    "compute_blur_scores",
    "run_backfill_face_timestamps",
    "create_and_run_task",
    "generate_hashes",
    "merge_similar_persons",
    "rebuild_person_embedding",
    "reset_clustering",
    "reset_processing",
    "run_custom_auto_tagging",
    "run_cleanup_and_chain",
    "schedule_custom_auto_tagging",
    "run_duplicate_detection",
    "run_media_processing",
    "run_media_processing_and_chain",
    "run_processors_for_media",
    "run_single_processor",
    "run_person_clustering",
    "rebuild_person_relationships",
    "run_build_events",
    "run_geocode_places",
    "run_scan",
    "run_scan_and_chain",
    "state",
]
