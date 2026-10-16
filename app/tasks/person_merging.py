"""Merging persons whose centroids are similar enough to be the same individual."""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Iterable

from sqlalchemy import text
from sqlmodel import Session

import app.database as db
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Person, ProcessingTask
from app.persons import merge_person_into, rebuild_person_embedding
from app.vectors import distance_to_similarity

from .state import clear_task_progress, set_task_progress


def _merge_person_pair(
    session: Session, id_a: int, id_b: int
) -> tuple[int, int] | None:
    if id_a == id_b:
        return None

    person_a = session.get(Person, id_a)
    person_b = session.get(Person, id_b)
    if not person_a or not person_b:
        return None

    count_a = int(person_a.appearance_count or 0)
    count_b = int(person_b.appearance_count or 0)
    if count_b > count_a:
        keep, drop = person_b, person_a
    else:
        keep, drop = person_a, person_b

    keep_id = int(keep.id)
    drop_id = int(drop.id)
    if keep_id == drop_id:
        return None
    merge_person_into(session, drop_id, keep_id)
    return keep_id, drop_id


def merge_similar_persons(
    task_id: str, candidate_person_ids: Iterable[int] | None = None
) -> int:
    logger.debug("Merging similar persons")

    percent_threshold = float(
        getattr(settings.face_recognition, "person_merge_percent_similarity", 75.0)
    )
    logger.debug("Person merge threshold set to: %s", percent_threshold)
    unique_candidate_ids = {
        int(pid) for pid in (candidate_person_ids or []) if pid is not None
    }
    candidate_ids: deque[int] = deque(unique_candidate_ids)
    search_limit = max(
        1, int(getattr(settings.face_recognition, "person_merge_search_k", 20))
    )
    set_task_progress(
        task_id, current_step="merging_similar_persons", current_item=None
    )
    total_merged = 0
    try:
        if candidate_ids:
            merge_processed = 0
            merge_started = time.monotonic()
            last_merge_log = merge_started

            # Progress for this phase is published only via the merge_*
            # fields of set_task_progress. Deliberately do NOT overwrite the
            # task's DB processed/total: those carry the clustering-phase
            # numbers, and clobbering them with merge counts corrupted the
            # progress display for the rest of the run.
            def update_progress() -> None:
                nonlocal last_merge_log
                pending_count = len(candidate_ids)
                total_work = merge_processed + pending_count
                if total_work <= 0:
                    total_work = max(merge_processed, pending_count)
                now = time.monotonic()
                elapsed = now - merge_started
                merge_rate = merge_processed / max(0.1, elapsed)
                set_task_progress(
                    task_id,
                    current_step="merging_similar_persons",
                    current_item=(
                        f"queued: {pending_count} (merged {total_merged}, "
                        f"{merge_rate:.1f}/s, {elapsed:.0f}s)"
                    ),
                    merge_processed=merge_processed,
                    merge_total=total_work,
                    merge_pending=pending_count,
                )

                if (now - last_merge_log) >= 15.0:
                    logger.info(
                        "Merging similar persons: processed=%d pending=%d merged=%d"
                        " (%.1f/s)",
                        merge_processed,
                        pending_count,
                        total_merged,
                        merge_rate,
                    )
                    last_merge_log = now

            if candidate_ids:
                update_progress()
            while candidate_ids:
                person_id = candidate_ids.popleft()
                merge_processed += 1
                update_progress()
                with Session(db.engine) as session:
                    task = session.get(ProcessingTask, task_id)
                    if task and task.status == "cancelled":
                        return total_merged

                    person_obj = session.get(Person, person_id)
                    if not person_obj:
                        logger.debug(
                            "Skipping merge candidate %s because person no longer exists",
                            person_id,
                        )
                        continue

                    person_embedding = session.exec(
                        text(
                            "SELECT person_id, embedding FROM person_embeddings WHERE"
                            " person_id=:pid"
                        ).bindparams(pid=person_id)
                    ).all()
                    if not person_embedding:
                        logger.debug(
                            "No embedding found for existing person %s; rebuilding",
                            person_id,
                        )
                        rebuild_person_embedding(session, int(person_id))
                        safe_commit(session)
                        person_embedding = session.exec(
                            text(
                                "SELECT person_id, embedding FROM person_embeddings"
                                " WHERE person_id=:pid"
                            ).bindparams(pid=person_id)
                        ).all()
                        if not person_embedding:
                            logger.debug(
                                "Skipping person %s after rebuild; still no embedding",
                                person_id,
                            )
                            continue

                    rows = session.exec(
                        text(
                            """
                            SELECT person_id, distance
                              FROM person_embeddings
                             WHERE embedding MATCH vec_f32((
                                SELECT embedding 
                                FROM person_embeddings
                                WHERE person_id = :pid))
                             AND person_id != :pid
                             AND k=:limit_val
                          ORDER BY distance 
                            """
                        ).bindparams(pid=person_id, limit_val=search_limit)  # type: ignore
                    ).all()  # type: ignore
                    candidate_pairs = _reduce_candidates_by_threshold(
                        percent_threshold, rows
                    )

                    logger.debug("Got %s candidates", len(candidate_pairs))
                    merged_this_round = False
                    for candidate_id, similarity in candidate_pairs:
                        logger.debug(
                            "Merging candidate persons %s and %s (similarity %.2f %%)",
                            person_id,
                            candidate_id,
                            similarity,
                        )
                        merge_result = _merge_person_pair(
                            session, int(person_id), int(candidate_id)
                        )
                        if merge_result is not None:
                            keep_id, _ = merge_result
                            total_merged += 1
                            candidate_ids.appendleft(keep_id)
                            update_progress()
                            merged_this_round = True
                            break

                    if merged_this_round:
                        continue
                    update_progress()
            if total_merged:
                logger.info(
                    "Merged %d newly created person clusters after targeted pass",
                    total_merged,
                )
            return total_merged

    finally:
        clear_task_progress(task_id)


def _reduce_candidates_by_threshold(percent_threshold, rows):
    candidate_pairs: list[tuple[int, float]] = []
    for candidate_id, distance in rows:
        if candidate_id is None:
            continue
        similarity = distance_to_similarity(distance)
        if similarity < percent_threshold:
            continue
        candidate_pairs.append((int(candidate_id), similarity))
    return candidate_pairs
