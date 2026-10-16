"""Matching unassigned faces to existing persons via per-person prototypes."""

from __future__ import annotations

import numpy as np
from sqlalchemy import text
from sqlmodel import Session

import app.database as db
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import ProcessingTask
from app.vectors import vector_from_stored

from .clustering_algorithms import compute_person_prototypes
from .clustering_queries import (
    build_in_clause_params,
    fetch_faces_and_embeddings,
    get_face_total,
    is_task_cancelled,
    iter_chunks,
    quality_seed_filter,
)
from .state import set_task_progress


def _load_person_prototype_matrix(
    session: Session, *, per_person_cap: int = 64
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build the matching matrix from per-person prototypes computed over the
    persons' face embeddings (instead of the single stored centroid). Returns
    (person_ids, matrix) where person_ids has one entry per prototype row and
    may contain the same person several times.
    """
    max_prototypes = max(
        1, int(getattr(settings.face_recognition, "person_matching_max_prototypes", 3))
    )
    # Prefer quality faces for the prototypes so junk members (blurry/profile
    # faces mistakenly attached to a person) do not become attachment anchors.
    # Persons with no quality-rated faces fall back to all of their faces.
    quality_filter, quality_params = quality_seed_filter()
    rows = session.exec(
        text(
            f"""
            SELECT f.person_id, fe.embedding,
                   CASE WHEN 1=1 {quality_filter} THEN 1 ELSE 0 END AS is_quality
              FROM face            AS f
              JOIN face_embeddings AS fe ON fe.face_id = f.id
             WHERE f.person_id IS NOT NULL
            """
        ).bindparams(**quality_params)
    ).all()

    quality_grouped: dict[int, list[np.ndarray]] = {}
    fallback_grouped: dict[int, list[np.ndarray]] = {}
    for person_id, raw_embedding, is_quality in rows:
        if person_id is None:
            continue
        target = quality_grouped if is_quality else fallback_grouped
        vecs = target.setdefault(int(person_id), [])
        if len(vecs) >= per_person_cap:
            continue
        vec = vector_from_stored(raw_embedding)
        if vec is None or vec.size == 0:
            continue
        if not np.all(np.isfinite(vec)) or not np.any(vec):
            continue
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm == 0.0:
            continue
        vecs.append((vec / norm).astype(np.float32, copy=False))

    grouped: dict[int, list[np.ndarray]] = dict(fallback_grouped)
    grouped.update({pid: vecs for pid, vecs in quality_grouped.items() if vecs})

    proto_person_ids: list[int] = []
    proto_vectors: list[np.ndarray] = []
    for person_id, vecs in grouped.items():
        if not vecs:
            continue
        arr = np.vstack(vecs)
        # only spend extra prototypes on persons with enough faces to
        # actually exhibit distinct pose modes (~4 faces per prototype)
        k = min(max_prototypes, max(1, arr.shape[0] // 4))
        for proto in compute_person_prototypes(arr, k):
            proto_person_ids.append(person_id)
            proto_vectors.append(proto)

    if not proto_person_ids:
        return np.array([], dtype=np.int64), np.empty((0, 0), dtype=np.float32)

    return np.array(proto_person_ids, dtype=np.int64), np.vstack(proto_vectors).astype(
        np.float32, copy=False
    )


def _bulk_assign_faces_to_persons(
    session: Session, assignments: dict[int, int], *, chunk_size: int = 500
) -> None:
    if not assignments:
        return

    by_person_id: dict[int, list[int]] = {}
    for face_id, person_id in assignments.items():
        by_person_id.setdefault(int(person_id), []).append(int(face_id))

    for person_id, person_face_ids in by_person_id.items():
        for face_chunk in iter_chunks(person_face_ids, chunk_size):
            placeholders, params = build_in_clause_params(face_chunk, prefix="f")
            sql_face = text(
                f"UPDATE face SET person_id = :pid WHERE id IN ({placeholders})"
            ).bindparams(pid=person_id, **params)
            session.exec(sql_face)

            sql_face_embedding = text(
                "UPDATE face_embeddings SET person_id = :pid"
                f" WHERE face_id IN ({placeholders})"
            ).bindparams(pid=person_id, **params)
            session.exec(sql_face_embedding)


# Video faces whose embeddings are at least this similar (cosine) are treated
# as one person's track. Measured within videos of a 40-person library:
# links 83% of same-person frame pairs, while different persons never exceeded
# 0.26 within a video (0.44 at the 99.99th percentile across all photos).
_VIDEO_TRACK_LINK_COSINE = 0.5


def _pool_video_tracks(
    session: Session, face_ids: list[int], embeddings: np.ndarray
) -> np.ndarray:
    """Replace each video face's embedding by the mean of its track.

    Faces of one video are grouped greedily: a face joins the most similar
    track whose mean it matches with at least _VIDEO_TRACK_LINK_COSINE and
    that has no face from the same frame (those are different people).
    Matching on the pooled embedding lets clear frames carry blurry or
    profile frames of the same person (measured: 99.55% -> 100% correct).
    """
    position = {face_id: idx for idx, face_id in enumerate(face_ids)}
    frames_by_video: dict[int, list[tuple[int, float]]] = {}
    for chunk in iter_chunks(face_ids, 500):
        placeholders, params = build_in_clause_params(chunk, prefix="f")
        rows = session.exec(
            text(
                "SELECT id, media_id, timestamp FROM face"
                f" WHERE timestamp IS NOT NULL AND id IN ({placeholders})"
            ).bindparams(**params)
        ).all()
        for face_id, media_id, timestamp in rows:
            frames_by_video.setdefault(int(media_id), []).append(
                (position[int(face_id)], float(timestamp))
            )

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    unit = np.divide(embeddings, norms, out=np.zeros_like(embeddings), where=norms > 0)
    pooled = embeddings.copy()
    for members in frames_by_video.values():
        if len(members) < 2:
            continue
        tracks: list[tuple[np.ndarray, set[float], list[int]]] = []
        for idx, timestamp in members:
            vec = unit[idx]
            if not np.any(vec):
                continue
            best, best_sim = None, _VIDEO_TRACK_LINK_COSINE
            for track in tracks:
                if timestamp in track[1]:
                    continue
                total = track[0]
                sim = float(vec @ total) / float(np.linalg.norm(total))
                if sim >= best_sim:
                    best, best_sim = track, sim
            if best is None:
                tracks.append((vec.copy(), {timestamp}, [idx]))
            else:
                best[0][:] += vec
                best[1].add(timestamp)
                best[2].append(idx)
        for total, _, indices in tracks:
            if len(indices) > 1:
                pooled[indices] = total / np.linalg.norm(total)
    return pooled


def _match_unassigned_to_existing(
    session: Session,
    face_ids: list[int],
    embeddings: np.ndarray,
    task_id: str,
    prototypes: tuple[np.ndarray, np.ndarray] | None = None,
) -> list[int]:
    """
    Attempts to assign faces to existing persons by comparing against
    per-person pose prototypes. Returns a list of face_ids that were NOT
    assigned and still need clustering. ``prototypes`` allows callers that
    loop over batches to load the (person_ids, matrix) pair once.
    """
    if not face_ids:
        return []

    if prototypes is None:
        prototypes = _load_person_prototype_matrix(session)
    person_ids, person_matrix = prototypes
    if person_matrix.size == 0:
        logger.info("No existing persons found, skipping to clustering!")
        return face_ids
    if (
        embeddings.ndim != 2
        or person_matrix.ndim != 2
        or embeddings.shape[1] != person_matrix.shape[1]
    ):
        logger.warning(
            "Skipping single-face match due to embedding dim mismatch"
            " (faces=%s persons=%s)",
            tuple(embeddings.shape),
            tuple(person_matrix.shape),
        )
        return face_ids

    embeddings = _pool_video_tracks(
        session, face_ids, embeddings.astype(np.float32, copy=False)
    )

    threshold_cosine = float(
        getattr(settings.face_recognition, "existing_person_cosine_threshold", 0.0)
    )
    if threshold_cosine <= 0.0 or threshold_cosine > 1.0:
        threshold_cosine = (
            float(
                getattr(
                    settings.face_recognition, "person_merge_percent_similarity", 75.0
                )
            )
            / 100.0
        )
    threshold_cosine = float(np.clip(threshold_cosine, 0.0, 1.0))
    min_margin = float(
        max(
            0.0,
            getattr(settings.face_recognition, "existing_person_min_cosine_margin", 0),
        )
    )

    unassigned_after_match = []
    assignments: dict[int, int] = {}
    chunk_size = 512
    cancel_check_every = max(
        1, int(getattr(settings.face_recognition, "matching_cancel_check_every", 8))
    )
    cancelled = False

    logger.info("Attempting to match %d faces to existing persons...", len(face_ids))
    total_faces = len(face_ids)
    for start in range(0, total_faces, chunk_size):
        end = min(start + chunk_size, total_faces)
        chunk_number = (start // chunk_size) + 1
        if (start == 0 or chunk_number % cancel_check_every == 0) and is_task_cancelled(
            session, task_id
        ):
            logger.info(
                "Task %s cancelled during matching; stopping at %d/%d faces.",
                task_id,
                start,
                total_faces,
            )
            unassigned_after_match.extend(int(fid) for fid in face_ids[start:])
            cancelled = True
            break

        chunk_face_ids = face_ids[start:end]
        chunk_embs = embeddings[start:end].astype(np.float32, copy=False)
        chunk_size_real = len(chunk_face_ids)

        norms = np.linalg.norm(chunk_embs, axis=1)
        valid_mask = np.isfinite(norms) & (norms > 0.0)
        assigned_person_for_chunk = np.full(chunk_size_real, -1, dtype=np.int64)

        if np.any(valid_mask):
            valid_indices = np.flatnonzero(valid_mask)
            normed_chunk = chunk_embs[valid_mask] / norms[valid_mask][:, None]
            similarities = normed_chunk @ person_matrix.T

            best_indices = np.argmax(similarities, axis=1)
            best_scores = similarities[np.arange(similarities.shape[0]), best_indices]
            best_persons = person_ids[best_indices]

            # The margin must be against the best *other* person — several
            # prototype rows can belong to the winning person, so mask all of
            # its rows out before taking the runner-up score.
            same_person_mask = person_ids[None, :] == best_persons[:, None]
            other_similarities = np.where(same_person_mask, -np.inf, similarities)
            second_scores = np.max(other_similarities, axis=1)
            second_scores = np.where(np.isfinite(second_scores), second_scores, -1.0)

            accept_mask = (best_scores >= threshold_cosine) & (
                (best_scores - second_scores) >= min_margin
            )
            accepted_global_indices = valid_indices[accept_mask]
            assigned_person_for_chunk[accepted_global_indices] = best_persons[
                accept_mask
            ]

        for local_idx, face_id in enumerate(chunk_face_ids):
            assigned_person_id = int(assigned_person_for_chunk[local_idx])
            if assigned_person_id > 0:
                assignments[int(face_id)] = assigned_person_id
            else:
                unassigned_after_match.append(int(face_id))

        if start == 0 or (start // chunk_size) % 8 == 0:
            set_task_progress(
                task_id,
                current_step="matching_known_persons",
                current_item=f"Matching face {end}/{total_faces} in current batch",
            )

    assigned_count = len(assignments)
    if assigned_count > 0:
        _bulk_assign_faces_to_persons(session, assignments)
        safe_commit(session)
        logger.info("Matched %d faces to existing persons.", assigned_count)
    if cancelled:
        logger.info("Matching was cancelled; leaving remaining faces unassigned.")

    return unassigned_after_match


def match_remaining_single_faces(
    task_id: str, *, batch_size: int
) -> tuple[int, int, bool]:
    total_scanned = 0
    total_matched = 0
    last_id = 0
    cancelled = False

    set_task_progress(
        task_id,
        current_step="matching_known_persons",
        current_item="starting leftover single-face pass",
    )
    # Load per-person prototypes once for the whole pass instead of once per
    # batch (persons do not change during matching). Also repoint the task's
    # processed/total at this phase — the merge phase left them at its own
    # counts, which made the progress bar meaningless for the rest of the run.
    with Session(db.engine) as session:
        prototypes = _load_person_prototype_matrix(session)
        remaining_total = get_face_total(session)
        task = session.get(ProcessingTask, task_id)
        if task and task.status != "cancelled":
            task.processed = 0
            task.total = remaining_total
            session.add(task)
            safe_commit(session)
    while True:
        with Session(db.engine) as session:
            face_ids, embeddings = fetch_faces_and_embeddings(
                session, limit=batch_size, last_id=last_id
            )
            if not face_ids:
                break
            last_id = face_ids[-1]

            still_unassigned_ids = _match_unassigned_to_existing(
                session, face_ids, embeddings, task_id, prototypes=prototypes
            )
            if is_task_cancelled(session, task_id):
                cancelled = True

        scanned = len(face_ids)
        matched = scanned - len(still_unassigned_ids)
        total_scanned += scanned
        total_matched += matched

        set_task_progress(
            task_id,
            current_step="matching_known_persons",
            current_item=(
                f"leftover pass scanned={total_scanned} matched={total_matched}"
            ),
        )
        with Session(db.engine) as progress_session:
            task = progress_session.get(ProcessingTask, task_id)
            if task and task.status != "cancelled":
                task.processed = total_scanned
                progress_session.add(task)
                safe_commit(progress_session)

        if cancelled:
            logger.info(
                "Task %s cancelled during leftover matching; stopping pass.", task_id
            )
            break
        if scanned < batch_size:
            break

    return total_matched, total_scanned, cancelled
