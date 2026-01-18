from __future__ import annotations

from collections import deque
from collections.abc import Iterable
from datetime import datetime, timezone

import hdbscan
import numpy as np
from sqlalchemy import func, text, update
from sqlmodel import Session, select
from tqdm import tqdm

import app.database as db
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import (
    Face,
    Person,
    ProcessingTask,
    TimelineEvent,
)
from app.utils import (
    _distance_to_similarity,
    complete_task,
    recalculate_person_appearance_counts,
    remove_person,
    vector_from_stored,
    vector_to_blob,
)

from .relationships import rebuild_person_relationships
from .state import clear_task_progress, set_task_progress

__all__ = [
    "assign_to_existing_persons",
    "merge_person_with_similar",
    "merge_similar_persons",
    "rebuild_person_embedding",
    "run_person_clustering",
]


def _fetch_faces_and_embeddings(
    session: Session, limit: int = 10000, last_id: int = 0
) -> tuple[list[int], np.ndarray]:
    sql = text(
        """
        SELECT f.id, fe.embedding
          FROM face            AS f
          JOIN face_embeddings AS fe
               ON fe.face_id = f.id
         WHERE f.person_id IS NULL
           AND f.id > :last_id
         ORDER BY f.id
         LIMIT :limit
        """
    ).bindparams(last_id=last_id, limit=limit)

    rows = session.exec(sql).all()
    if not rows:
        return [], np.array([])

    face_ids: list[int] = []
    vectors: list[np.ndarray] = []
    for face_id, raw_embedding in rows:
        vec = vector_from_stored(raw_embedding)
        if vec is None or vec.size == 0:
            logger.debug(
                "Skipping face %s for clustering due to missing embedding",
                face_id,
            )
            continue
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm == 0.0:
            logger.debug(
                "Skipping face %s for clustering due to zero-norm embedding",
                face_id,
            )
            continue
        face_ids.append(int(face_id))
        vectors.append((vec / norm).astype(np.float32, copy=False))

    if not face_ids:
        return [], np.array([])

    embeddings = np.vstack(vectors).astype(np.float32, copy=False)
    return face_ids, embeddings


def _cluster_embeddings(
    embeddings: np.ndarray, min_cluster_size=None, min_samples=None
) -> np.ndarray:
    if embeddings.size == 0:
        return np.array([], dtype=int)

    embeddings_64 = embeddings.astype(np.float64, copy=False)

    min_faces_required = max(2, int(settings.face_recognition.person_min_face_count))
    sample_count = embeddings_64.shape[0]

    base_min_cluster_size = int(
        min_cluster_size
        if min_cluster_size is not None
        else settings.face_recognition.hdbscan_min_cluster_size
    )
    base_min_samples = int(
        min_samples
        if min_samples is not None
        else settings.face_recognition.hdbscan_min_samples
    )

    base_min_cluster_size = int(
        np.clip(base_min_cluster_size, min_faces_required, sample_count)
    )
    base_min_samples = int(np.clip(base_min_samples, 1, sample_count))
    base_min_samples = min(base_min_samples, base_min_cluster_size)

    attempted: set[tuple[int, int]] = set()
    best_labels: np.ndarray | None = None
    best_score: tuple[int, float] | None = None

    current_min_cluster_size = base_min_cluster_size
    current_min_samples = base_min_samples

    for _ in range(3):
        params = (current_min_cluster_size, current_min_samples)
        if params in attempted:
            break
        attempted.add(params)

        clusterer = hdbscan.HDBSCAN(
            metric="cosine",
            min_cluster_size=current_min_cluster_size,
            min_samples=current_min_samples,
            cluster_selection_method=settings.face_recognition.hdbscan_cluster_selection_method,
            cluster_selection_epsilon=settings.face_recognition.hdbscan_cluster_selection_epsilon,
            algorithm="generic",
        )
        labels = clusterer.fit_predict(embeddings_64)

        non_noise = labels[labels >= 0]
        cluster_count = int(np.unique(non_noise).size)
        noise_ratio = float(np.mean(labels == -1)) if labels.size else 1.0

        logger.debug(
            "HDBSCAN attempt clusters=%d noise=%.2f min_cluster_size=%d min_samples=%d",
            cluster_count,
            noise_ratio,
            current_min_cluster_size,
            current_min_samples,
        )

        score = (cluster_count, -noise_ratio)
        if best_score is None or score > best_score:
            best_score = score
            best_labels = labels

        should_relax = current_min_cluster_size > min_faces_required and (
            cluster_count == 0
            or (
                cluster_count <= 1
                and noise_ratio > 0.85
                and sample_count >= min_faces_required * 3
            )
            or noise_ratio >= 0.95
        )

        if should_relax:
            current_min_cluster_size = max(2, current_min_cluster_size // 2)
            current_min_samples = max(1, current_min_samples // 2)
        else:
            break

    if best_labels is None:
        return np.array([], dtype=int)
    return best_labels


def _group_faces_by_cluster(
    labels: np.ndarray, face_ids: list[int], embeddings: np.ndarray
) -> dict[int, tuple[list[int], list[np.ndarray]]]:
    clusters: dict[int, tuple[list[int], list[np.ndarray]]] = {}
    for face, label, emb in zip(face_ids, labels, embeddings):
        if label == -1:
            continue
        clusters.setdefault(label, ([], []))
        clusters[label][0].append(face)
        clusters[label][1].append(emb)
    return clusters


def rebuild_person_embedding(session: Session, person_id: int) -> None:
    rows = session.exec(
        text("SELECT embedding FROM face_embeddings WHERE person_id = :pid").bindparams(
            pid=person_id
        )
    ).all()
    vectors: list[np.ndarray] = []
    for (stored,) in rows:
        vec = vector_from_stored(stored)
        if vec is None or vec.size == 0:
            continue
        norm = float(np.linalg.norm(vec))
        if not np.isfinite(norm) or norm == 0.0:
            continue
        vectors.append((vec / norm).astype(np.float32, copy=False))

    # In case the person we try to recalculate the embedding for has no faces,
    # we can safely remove that person, otherwise only remove the person embeddings
    # so it can be recalculated later, when face embeddings are calculated
    if not vectors:
        faces_count_row = session.exec(
            select(func.count(Face.id)).where(Face.person_id == person_id)
        ).one()
        faces_count = (
            int(faces_count_row[0])
            if isinstance(faces_count_row, tuple)
            else int(faces_count_row)
        )
        if faces_count == 0:
            remove_person(person_id, session)
        else:
            logger.debug(
                "Skipping centroid rebuild for person %s; no embeddings available yet",
                person_id,
            )
        return

    session.exec(
        text("DELETE FROM person_embeddings WHERE person_id = :pid").bindparams(
            pid=person_id
        )
    )

    centroid = np.vstack(vectors).mean(axis=0)
    norm = float(np.linalg.norm(centroid))
    if norm > 0.0 and np.isfinite(norm):
        centroid = (centroid / norm).astype(np.float32, copy=False)
    else:
        centroid = centroid.astype(np.float32, copy=False)

    blob = vector_to_blob(centroid)
    if blob is not None:
        session.exec(
            text(
                """
                INSERT INTO person_embeddings(person_id, embedding)
                VALUES (:pid, :emb)
                """
            ).bindparams(pid=person_id, emb=blob)
        )


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

    session.exec(
        update(Face).where(Face.person_id == drop_id).values(person_id=keep_id)
    )
    session.exec(
        text(
            "UPDATE face_embeddings SET person_id = :keep WHERE person_id = :drop"
        ).bindparams(keep=keep_id, drop=drop_id)
    )

    if drop.profile_face_id and not keep.profile_face_id:
        keep.profile_face_id = drop.profile_face_id
        session.add(keep)

    session.exec(
        update(TimelineEvent)
        .where(TimelineEvent.person_id == drop_id)
        .values(person_id=keep_id)
    )

    remove_person(drop_id, session)

    safe_commit(session)
    recalculate_person_appearance_counts(session, [keep_id])
    rebuild_person_embedding(session, keep_id)
    safe_commit(session)
    return keep_id, drop_id


def merge_person_with_similar(
    session: Session,
    person_id: int,
    percent_threshold: float | None = None,
    k: int = 20,
) -> list[int]:
    """
    Merge the specified person with all similar persons whose similarity
    exceeds the configured threshold. Returns the list of person IDs that were
    merged into the surviving record.
    """
    threshold = float(
        percent_threshold
        if percent_threshold is not None
        else getattr(
            settings.face_recognition,
            "person_merge_percent_similarity",
            75.0,
        )
    )

    row = session.exec(
        text(
            "SELECT embedding FROM person_embeddings WHERE person_id = :pid"
        ).bindparams(pid=person_id)
    ).first()
    if not row:
        return []

    vec = vector_from_stored(row[0])
    if vec is None or vec.size == 0:
        return []

    norm = float(np.linalg.norm(vec))
    if not np.isfinite(norm) or norm == 0.0:
        return []

    normed_vec = (vec / norm).astype(np.float32, copy=False)
    blob = vector_to_blob(normed_vec)
    if blob is None:
        return []

    candidates = session.exec(
        text(
            """
            SELECT person_id, distance
              FROM person_embeddings
             WHERE person_id != :pid
               AND embedding MATCH :vec
          ORDER BY distance ASC
          LIMIT :limit_val
            """
        ).bindparams(
            pid=person_id,
            vec=blob,
            limit_val=max(1, int(k)),
        )
    ).all()

    merged_ids: list[int] = []
    current_id = person_id
    for candidate_id, distance in candidates:
        if candidate_id is None:
            continue
        similarity = _distance_to_similarity(distance)
        if float(similarity) < threshold:
            continue
        merge_result = _merge_person_pair(session, current_id, int(candidate_id))
        if merge_result is None:
            continue
        keep_id, dropped_id = merge_result
        merged_ids.append(dropped_id)
        current_id = keep_id

    return merged_ids


def merge_similar_persons(
    task_id: str, candidate_person_ids: Iterable[int] | None = None
) -> int:
    logger.debug("Merging similar persons")

    percent_threshold = float(
        getattr(
            settings.face_recognition,
            "person_merge_percent_similarity",
            75.0,
        )
    )
    logger.debug("Person merge threshold set to: %s", percent_threshold)
    unique_candidate_ids = {
        int(pid) for pid in (candidate_person_ids or []) if pid is not None
    }
    candidate_ids: deque[int] = deque(unique_candidate_ids)
    search_limit = max(
        1,
        int(
            getattr(
                settings.face_recognition,
                "person_merge_search_k",
                20,
            )
        ),
    )
    set_task_progress(
        task_id,
        current_step="merging_similar_persons",
        current_item=None,
    )
    total_merged = 0
    try:
        if candidate_ids:
            merge_processed = 0
            last_saved_progress: tuple[int, int] = (-1, -1)

            with Session(db.engine) as session:
                task = session.get(ProcessingTask, task_id)
                if task:
                    task.processed = 0
                    task.total = len(candidate_ids)
                    session.add(task)
                    safe_commit(session)

            def update_progress(force: bool = False) -> None:
                nonlocal last_saved_progress
                pending_count = len(candidate_ids)
                total_work = merge_processed + pending_count
                if total_work <= 0:
                    total_work = max(merge_processed, pending_count)
                set_task_progress(
                    task_id,
                    current_step="merging_similar_persons",
                    current_item=f"queued: {pending_count} (merged {total_merged})",
                    merge_processed=merge_processed,
                    merge_total=total_work,
                    merge_pending=pending_count,
                )

                progress_tuple = (merge_processed, total_work)
                if not force and progress_tuple == last_saved_progress:
                    return

                with Session(db.engine) as progress_session:
                    task = progress_session.get(ProcessingTask, task_id)
                    if task:
                        task.processed = merge_processed
                        task.total = total_work
                        progress_session.add(task)
                        safe_commit(progress_session)
                        last_saved_progress = progress_tuple

            if candidate_ids:
                update_progress(force=True)
            while candidate_ids:
                person_id = candidate_ids.popleft()
                merge_processed += 1
                update_progress()
                with Session(db.engine) as session:
                    task = session.get(ProcessingTask, task_id)
                    if task and task.status == "cancelled":
                        return total_merged

                    person_embedding = session.exec(
                        text(
                            "SELECT person_id, embedding FROM person_embeddings WHERE"
                            " person_id=:pid"
                        ).bindparams(pid=person_id)
                    ).all()
                    if not person_embedding:
                        logger.debug("No embedding found for person %s", person_id)
                        continue

                    logger.debug("Embeddings: %s", person_embedding)

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
                        ).bindparams(
                            pid=person_id,
                            limit_val=search_limit,
                        )  # type: ignore
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
        similarity = _distance_to_similarity(distance)
        if similarity < percent_threshold:
            continue
        candidate_pairs.append((int(candidate_id), similarity))
    return candidate_pairs


def _filter_embeddings_by_id(
    all_face_ids: list[int],
    all_embeddings: np.ndarray,
    unassigned_ids: list[int],
) -> tuple[list[int], np.ndarray]:
    id_to_emb_map = dict(zip(all_face_ids, all_embeddings))
    unassigned_embs = np.array([id_to_emb_map[id] for id in unassigned_ids])
    return unassigned_ids, unassigned_embs


def _assign_faces_to_clusters(
    clusters: dict[int, tuple[list[int], list[np.ndarray]]],
    task_id: str,
    *,
    update_progress: bool = True,
) -> tuple[int, list[int]]:
    created = 0
    new_person_ids: list[int] = []
    for face_ids, embeddings in tqdm(clusters.values()):
        if len(face_ids) < settings.face_recognition.person_min_face_count:
            logger.debug(
                "Skipping cluster with %d faces (< person_min_face_count %d)",
                len(face_ids),
                settings.face_recognition.person_min_face_count,
            )
            continue

        embeddings_arr = np.array(embeddings)
        centroid = embeddings_arr.mean(axis=0)
        similarities = embeddings_arr @ centroid

        best_face_id = face_ids[np.argmax(similarities)]

        diffs = embeddings_arr - centroid
        l2_radii = np.linalg.norm(diffs, axis=1)
        if np.max(l2_radii) > settings.face_recognition.person_cluster_max_l2_radius:
            logger.info(
                "Skipping loose cluster (max radius=%.3f > %.3f) with %d faces",
                float(np.max(l2_radii)),
                settings.face_recognition.person_cluster_max_l2_radius,
                len(face_ids),
            )
            continue

        with Session(db.engine) as session:
            task = session.get(ProcessingTask, task_id)
            if task.status == "cancelled":
                break
            media_count = session.exec(
                select(func.count(func.distinct(Face.media_id))).where(
                    Face.id.in_(face_ids)
                )
            ).first()
            media_count = int(media_count or 0)

            if media_count < settings.face_recognition.person_min_media_count:
                # logger.debug(
                #     "Skipping cluster with %d media (< person_min_media_count %d)",
                #     media_count,
                #     settings.face_recognition.person_min_media_count,
                # )
                continue
            new_person = Person(
                name=None,
                profile_face_id=best_face_id,
                appearance_count=media_count,
            )
            session.add(new_person)
            session.flush()

            created += 1
            new_person_ids.append(new_person.id)

            for face_id in face_ids:
                face = session.get(Face, face_id)
                if face:
                    face.person_id = new_person.id
                    session.add(face)

            for face_id in face_ids:
                sql_face_emb = text(
                    "UPDATE face_embeddings SET person_id = :p_id WHERE face_id= :f_id"
                ).bindparams(p_id=new_person.id, f_id=face_id)
                session.exec(sql_face_emb)

            session.exec(
                text(
                    """
                    DELETE FROM person_embeddings WHERE person_id=:p_id
                    """
                ).bindparams(p_id=new_person.id)
            )
            centroid_blob = vector_to_blob(centroid)
            if centroid_blob is None:
                logger.warning(
                    "Unable to serialize centroid for new person %s; skipping embedding"
                    " write",
                    new_person.id,
                )
            else:
                sql_person_emb = text(
                    """
                    INSERT INTO person_embeddings(person_id, embedding)
                    VALUES (:p_id, :emb)
                    """
                ).bindparams(p_id=new_person.id, emb=centroid_blob)
                session.exec(sql_person_emb)

            if update_progress:
                task.processed += len(face_ids)
                session.add(task)
            safe_commit(session)
    return created, new_person_ids


def assign_to_existing_persons(
    face_ids: list[int], embs: np.ndarray, task_id: str, threshold_per: float
) -> list[int]:
    unassigned: list[int] = []

    with Session(db.engine) as session:
        affected_person_ids: set[int] = set()

        def bump_progress(task: ProcessingTask) -> None:
            task.processed += 1
            if task.processed % 100 == 0:
                if affected_person_ids:
                    recalculate_person_appearance_counts(
                        session, affected_person_ids
                    )
                    affected_person_ids.clear()
                session.add(task)
                safe_commit(session)

        for face_id, emb in tqdm(zip(face_ids, embs), total=len(face_ids)):
            face = session.get(Face, face_id)
            task = session.get(ProcessingTask, task_id)
            assert task

            if task.status == "cancelled":
                break

            vec_param = vector_to_blob(emb)
            if vec_param is None:
                logger.warning(
                    "Skipping face %s due to invalid embedding payload",
                    face_id,
                )
                bump_progress(task)
                continue

            sql = text(
                """
                    SELECT person_id, distance FROM person_embeddings
                    WHERE embedding MATCH :vec
                    and k = 2
                    ORDER BY distance
                """
            ).bindparams(vec=vec_param)
            rows = session.exec(sql).all()

            if not rows or len(rows[0]) < 2:
                unassigned.append(face_id)
                bump_progress(task)
                continue

            if not _distance_to_similarity(rows[0][1]) >= threshold_per:
                unassigned.append(face_id)
                bump_progress(task)
                continue

            person_id = rows[0][0]

            if len(rows) > 1:
                best_cos = 1.0 - 0.5 * float(rows[0][1]) ** 2
                second_cos = 1.0 - 0.5 * float(rows[1][1]) ** 2
                min_margin = getattr(
                    settings.face_recognition,
                    "existing_person_min_cosine_margin",
                    0.0,
                )
                if (best_cos - second_cos) < float(min_margin):
                    unassigned.append(face_id)
                    bump_progress(task)
                    continue

            if person_id is None:
                logger.warning(
                    "Found person_embeddings row with NULL person_id; cleaning up."
                )
                session.exec(
                    text("DELETE FROM person_embeddings WHERE person_id IS NULL")
                )
                unassigned.append(face_id)
                bump_progress(task)
                continue

            person = session.get(Person, person_id)

            if person is None:
                logger.warning(
                    "Dangling person_id %s in person_embeddings; removing and"
                    " skipping face %s",
                    person_id,
                    face_id,
                )
                session.exec(
                    text(
                        "DELETE FROM person_embeddings WHERE person_id = :p_id"
                    ).bindparams(p_id=person_id)
                )
                unassigned.append(face_id)
                bump_progress(task)
                continue

            min_apps = getattr(
                settings.face_recognition,
                "existing_person_min_media_count",
                0,
            )
            if (person.appearance_count or 0) < int(min_apps):
                unassigned.append(face_id)
                bump_progress(task)
                continue

            if face is not None:
                face.person_id = person_id
                session.add(face)

                session.exec(
                    text(
                        """
                        UPDATE face_embeddings
                            SET person_id = :p_id
                            WHERE face_id   = :f_id
                        """
                    ).bindparams(p_id=person_id, f_id=face_id)
                )

                affected_person_ids.add(person_id)
            else:
                logger.warning(
                    "Face %s not found during assignment; skipping update.",
                    face_id,
                )

            bump_progress(task)

        if affected_person_ids:
            recalculate_person_appearance_counts(session, affected_person_ids)
            affected_person_ids.clear()
        session.add(task)
        safe_commit(session)
    return unassigned


def _get_face_total(session: Session) -> int:
    sql = text(
        """
        SELECT COUNT(*)
          FROM face            AS f
          JOIN face_embeddings AS fe ON fe.face_id = f.id
         WHERE f.person_id IS NULL
        """
    )
    row = session.exec(sql).first()
    return int(row[0]) if row else 0


def run_person_clustering(task_id: str) -> None:
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        task.total = _get_face_total(session)
        logger.info("Got %s faces to cluster!", task.total)
        safe_commit(session)

    def is_cancelled() -> bool:
        with Session(db.engine) as s:
            t = s.get(ProcessingTask, task_id)
            return bool(t and t.status == "cancelled")

    with heavy_writer(name="cluster_persons", cancelled=is_cancelled):
        last_id = 0
        new_person_candidates: list[int] = []
        while True:
            logger.info("--- Starting new Clustering Batch ---")
            with Session(db.engine) as session:
                logger.debug("Continuing from id: %s", last_id)
                batch_face_ids, batch_embeddings = _fetch_faces_and_embeddings(
                    session,
                    last_id=last_id,
                    limit=settings.face_recognition.cluster_batch_size,
                )
                if batch_face_ids:
                    last_id = batch_face_ids[-1]

            if len(batch_face_ids) == 0:
                logger.info("No more unassigned faces found. Finishing process.")
                break

            logger.info("Processing batch of %d faces...", len(batch_face_ids))

            person_exists = False
            with Session(db.engine) as session:
                person_exists = (
                    session.exec(select(Person).limit(1)).first() is not None
                )

            if person_exists:
                unassigned_face_ids = assign_to_existing_persons(
                    batch_face_ids,
                    batch_embeddings,
                    task_id,
                    threshold_per=settings.face_recognition.face_match_min_percent,
                )
                if not unassigned_face_ids:
                    logger.info("All faces in batch were assigned to existing persons.")
                    continue

                new_faces_ids, new_embs = _filter_embeddings_by_id(
                    batch_face_ids, batch_embeddings, unassigned_face_ids
                )
            else:
                new_faces_ids, new_embs = batch_face_ids, batch_embeddings

            if len(new_embs) >= max(
                2, int(settings.face_recognition.person_min_face_count)
            ):
                labels = _cluster_embeddings(new_embs)
                clusters = _group_faces_by_cluster(labels, new_faces_ids, new_embs)
                created_count, created_person_ids = _assign_faces_to_clusters(
                    clusters,
                    task_id,
                    update_progress=not person_exists,
                )
                if created_person_ids:
                    new_person_candidates.extend(created_person_ids)
                logger.info(
                    "Cluster batch produced %d new persons out of %d candidate"
                    " clusters",
                    created_count,
                    len(clusters),
                )
            if len(batch_face_ids) < settings.face_recognition.cluster_batch_size:
                break
        merge_similar_persons(task_id, new_person_candidates)

        with Session(db.engine) as session:
            task = session.get(ProcessingTask, task_id)
            logger.info("FINISHED CLUSTERING!")
            complete_task(session, task)
    rebuild_person_relationships()
