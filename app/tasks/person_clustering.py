from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Iterable
from datetime import datetime, timezone

import hdbscan
import networkx as nx
import numpy as np
import umap
from sklearn.neighbors import NearestNeighbors
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

    logger.info("Getting faces!")
    rows = session.exec(sql).all()
    logger.info("Got %s faces!", len(rows))
    if not rows:
        return [], np.array([])

    face_ids: list[int] = []
    vectors: list[np.ndarray] = []
    for face_id, raw_embedding in rows:
        try:
            vec = vector_from_stored(raw_embedding)
            if vec is None or vec.size == 0:
                logger.debug(
                    "Skipping face %s for clustering due to missing embedding",
                    face_id,
                )
                continue
            # norm = float(np.linalg.norm(vec))
            if not np.all(np.isfinite(vec)) or not np.any(vec):
                logger.debug(
                    "Skipping face %s for clustering due to zero-norm embedding",
                    face_id,
                )
                continue
            face_ids.append(int(face_id))
            vectors.append(vec.astype(np.float32, copy=False))
        except Exception:
            logger.exception("Failure while processing face!")

    if not face_ids:
        return [], np.array([])

    logger.debug("Transforming embeddings")
    embeddings = np.vstack(vectors).astype(np.float32, copy=False)
    return face_ids, embeddings


def _cluster_embeddings(
    embeddings: np.ndarray,
    *,
    face_ids: list[int] | None = None,
    min_cluster_size=None,
    min_samples=None,
) -> np.ndarray:
    logger.info("Running as binary: %s", settings.general.is_binary)
    if settings.general.is_binary:
        return _cluster_embeddings_chinese_whispers(
            face_ids=face_ids, embeddings=embeddings
        )

    return _cluster_embeddings_hdbscan(
        embeddings,
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
    )


def _cluster_embeddings_chinese_whispers(
    face_ids: list[int],
    embeddings: np.ndarray,
) -> np.ndarray:
    """
    Clustering using Chinese Whispers.
    """
    if embeddings.size == 0:
        return np.array([], dtype=int)

    num_faces = len(face_ids)

    k = settings.face_recognition.cw_k_neighbors  # e.g. 10
    threshold = settings.face_recognition.cw_threshold  # cosine similarity, e.g. 0.6
    iterations = settings.face_recognition.cw_iterations
    mutual_nn = getattr(settings.face_recognition, "cw_mutual_nn", True)

    # 1. Build kNN index (cosine distance = 1 - similarity)
    logger.info(f"Building kNN graph for {num_faces} faces (k={k})...")

    nn = NearestNeighbors(
        n_neighbors=min(k + 1, num_faces),  # +1 because first neighbor is self
        metric="cosine",
        algorithm="auto",
    ).fit(embeddings)

    distances, indices = nn.kneighbors(embeddings)
    neighbor_sets = [set(row[1:]) for row in indices]

    # 2. Build the Graph
    G = nx.Graph()
    for i in range(num_faces):
        G.add_node(i, label=i)  # Initial state: each face is its own cluster
    edge_count = 0

    for i in range(num_faces):
        for neighbor_idx, dist in zip(indices[i][1:], distances[i][1:]):
            if mutual_nn and i not in neighbor_sets[neighbor_idx]:
                continue

            similarity = 1.0 - dist

            if similarity > threshold:
                G.add_edge(i, neighbor_idx, weight=similarity)
                edge_count += 1

    logger.info(f"Similarity graph built with {edge_count} edges")

    # 3. Chinese Whispers Iterations
    nodes = list(G.nodes())
    for iteration in range(iterations):
        np.random.shuffle(nodes)
        changed = False

        for node in nodes:
            neighbors = G[node]
            if not neighbors:
                continue

            # Count the total weight for each label in the neighborhood
            label_scores = {}
            for neighbor, edge_data in neighbors.items():
                neigh_label = G.nodes[neighbor]["label"]
                weight = edge_data.get("weight", 1.0)
                label_scores[neigh_label] = label_scores.get(neigh_label, 0) + weight

            best_label = max(label_scores, key=label_scores.get)
            if G.nodes[node]["label"] != best_label:
                G.nodes[node]["label"] = best_label
                changed = True
        logger.debug(f"CW iteration {iteration+1}, changed={changed}")
        if not changed:
            logger.info(f"Chinese Whispers converged after {iteration+1} iterations")
            break

    # 4. Map back to HDBSCAN-style labels
    labels = nx.get_node_attributes(G, "label")
    unique_labels = {label: i for i, label in enumerate(set(labels.values()))}

    cluster_labels = np.array([unique_labels[labels[i]] for i in range(num_faces)])

    logger.info(f"Found {len(unique_labels)} clusters using Chinese Whispers")

    return cluster_labels


def _cluster_embeddings_hdbscan(
    embeddings: np.ndarray, min_cluster_size=None, min_samples=None
) -> np.ndarray:
    logger.info("INSIDE HDBSCAN CLUSTERING")
    if embeddings.size == 0:
        return np.array([], dtype=int)

    reducer = umap.UMAP(
        n_neighbors=15,
        n_components=10,  # Drastic reduction works best for HDBSCAN
        metric="cosine",
        random_state=42,
    )
    embeddings_reduced = reducer.fit_transform(embeddings)
    embeddings_reduced = embeddings_reduced.astype("float64")
    min_faces_required = max(2, int(settings.face_recognition.person_min_face_count))
    sample_count = embeddings.shape[0]

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
    best_score: float | None = None

    current_min_cluster_size = base_min_cluster_size
    current_min_samples = base_min_samples

    for i in range(3):
        logger.info("Running clustering iteration %s", i)
        params = (current_min_cluster_size, current_min_samples)
        if params in attempted:
            break
        attempted.add(params)

        clusterer = hdbscan.HDBSCAN(
            metric="euclidean",
            min_cluster_size=current_min_cluster_size,
            min_samples=current_min_samples,
            cluster_selection_method=settings.face_recognition.hdbscan_cluster_selection_method,
            cluster_selection_epsilon=settings.face_recognition.hdbscan_cluster_selection_epsilon,
            algorithm="best",
            gen_min_span_tree=False,
        )
        labels = clusterer.fit_predict(embeddings_reduced)

        if len(labels) > 0:
            current_score = float(np.mean(clusterer.probabilities_))
        else:
            current_score = -1

        non_noise_mask = labels >= 0
        cluster_count = int(np.unique(labels[non_noise_mask]).size)
        noise_ratio = float(np.mean(labels == -1))

        logger.debug(
            "HDBSCAN attempt clusters=%d noise=%.2f FinalScore=%d",
            cluster_count,
            noise_ratio,
            current_score,
        )

        if best_score is None or current_score > best_score:
            best_score = current_score
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
    return best_labels if best_labels is not None else np.full(len(embeddings), -1)


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


def _summarize_labels(labels: np.ndarray) -> tuple[int, float]:
    if labels.size == 0:
        return 0, 1.0
    non_noise = labels[labels >= 0]
    cluster_count = int(np.unique(non_noise).size)
    noise_ratio = float(np.mean(labels == -1))
    return cluster_count, noise_ratio


def _run_clustering(
    *,
    embeddings: np.ndarray,
    face_ids: list[int],
) -> tuple[np.ndarray, int, float, float]:
    started = time.monotonic()
    labels = _cluster_embeddings(
        embeddings,
        face_ids=face_ids,
    )
    elapsed = time.monotonic() - started
    cluster_count, noise_ratio = _summarize_labels(labels)
    return labels, cluster_count, noise_ratio, elapsed


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
            merge_started = time.monotonic()
            last_merge_log = merge_started
            last_saved_progress: tuple[int, int] = (-1, -1)

            with Session(db.engine) as session:
                task = session.get(ProcessingTask, task_id)
                if task:
                    task.processed = 0
                    task.total = len(candidate_ids)
                    session.add(task)
                    safe_commit(session)

            def update_progress(force: bool = False) -> None:
                nonlocal last_saved_progress, last_merge_log
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
            if task and task.status == "cancelled":
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


def _match_unassigned_to_existing(
    session: Session, face_ids: list[int], embeddings: np.ndarray, task_id: str
) -> list[int]:
    """
    Attempts to assign faces to existing persons via vector search.
    Returns a list of face_ids that were NOT assigned and still need clustering.
    """
    if not face_ids:
        return []

    row = session.exec(
        text(
            """
            SELECT person_id, distance 
            FROM person_embeddings 
            WHERE k = 1
        """
        )
    ).first()

    if not row:
        return face_ids

    threshold = float(
        getattr(settings.face_recognition, "person_merge_percent_similarity", 75.0)
    )
    unassigned_after_match = []
    assigned_count = 0

    logger.info("Attempting to match %d faces to existing persons...", len(face_ids))

    for i, (face_id, emb) in enumerate(zip(face_ids, embeddings)):
        # Convert embedding to blob for sqlite-vec
        if i % 100 == 0:
            set_task_progress(
                task_id,
                current_step="matching_known_persons",
                current_item=f"Matching face {i}/{len(face_ids)} in current batch",
            )
            with Session(db.engine) as progress_session:
                task = progress_session.get(ProcessingTask, task_id)
                if task and task.status == "running":  # Keep standard status
                    task.processed = i
                    progress_session.add(task)
                    safe_commit(progress_session)
        blob = vector_to_blob(emb.astype(np.float32, copy=False))

        # Search for the single closest existing person
        row = session.exec(
            text(
                """
                SELECT person_id, distance 
                FROM person_embeddings 
                WHERE embedding MATCH :vec 
                AND k = 1
            """
            ).bindparams(vec=blob)
        ).first()

        if row:
            person_id, distance = row
            similarity = _distance_to_similarity(distance)

            if similarity >= threshold:
                # Direct assignment
                session.exec(
                    update(Face).where(Face.id == face_id).values(person_id=person_id)
                )
                session.exec(
                    text(
                        "UPDATE face_embeddings SET person_id = :pid WHERE face_id ="
                        " :fid"
                    ).bindparams(pid=person_id, fid=face_id)
                )

                assigned_count += 1
                continue

        unassigned_after_match.append(face_id)

    with Session(db.engine) as progress_session:
        task = progress_session.get(ProcessingTask, task_id)
        if task and task.status != "cancelled":
            task.processed = 0
            progress_session.add(task)
            safe_commit(progress_session)
    if assigned_count > 0:
        safe_commit(session)
        logger.info("Matched %d faces to existing persons.", assigned_count)

    return unassigned_after_match


def run_person_clustering(task_id: str) -> None:
    cluster_chunk_size = settings.face_recognition.cluster_batch_size
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = "running"
        task.started_at = datetime.now(timezone.utc)
        task.total = _get_face_total(session)
        logger.info(
            "Got %s faces to cluster! batch_size=%d",
            task.total,
            settings.face_recognition.cluster_batch_size,
        )
        safe_commit(session)

    def is_cancelled() -> bool:
        with Session(db.engine) as s:
            t = s.get(ProcessingTask, task_id)
            return bool(t and t.status == "cancelled")

    with heavy_writer(name="cluster_persons", cancelled=is_cancelled) as acquired:
        if not acquired:
            with Session(db.engine) as session:
                task = session.get(ProcessingTask, task_id)
                if task:
                    task.status = "cancelled"
                    task.finished_at = datetime.now(timezone.utc)
                    session.add(task)
                    safe_commit(session)
            clear_task_progress(task_id)
            return

        set_task_progress(
            task_id, current_step="clustering_batches", current_item="starting"
        )
        last_id = 0
        batch_index = 0
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
                if not batch_face_ids:
                    break

                remaining_ids = _match_unassigned_to_existing(
                    session, batch_face_ids, batch_embeddings, task_id
                )

                if len(remaining_ids) != len(batch_face_ids):
                    batch_face_ids, batch_embeddings = _filter_embeddings_by_id(
                        batch_face_ids, batch_embeddings, remaining_ids
                    )

            if batch_face_ids:
                last_id = batch_face_ids[-1]

            logger.info("Processing batch of %d faces...", len(batch_face_ids))
            batch_index += 1
            batch_started = time.monotonic()
            set_task_progress(
                task_id,
                current_step="clustering_batch",
                current_item=(
                    f"batch {batch_index} ({len(batch_face_ids)} faces, last_id"
                    f" {last_id})"
                ),
            )

            min_faces_required = max(
                2, int(settings.face_recognition.person_min_face_count)
            )
            if len(batch_embeddings) >= min_faces_required:
                if (
                    cluster_chunk_size > 0
                    and len(batch_embeddings) > cluster_chunk_size
                ):
                    total_chunks = math.ceil(len(batch_embeddings) / cluster_chunk_size)
                    logger.info(
                        "Clustering %d unassigned faces in %d chunks (max %d per"
                        " chunk)",
                        len(batch_embeddings),
                        total_chunks,
                        cluster_chunk_size,
                    )
                    total_created = 0
                    total_clusters = 0
                    for chunk_index, start in enumerate(
                        range(0, len(batch_embeddings), cluster_chunk_size), start=1
                    ):
                        if is_cancelled():
                            logger.info("Clustering cancelled mid-chunk.")
                            break
                        end = start + cluster_chunk_size
                        chunk_faces = batch_face_ids[start:end]
                        chunk_embs = batch_embeddings[start:end]
                        set_task_progress(
                            task_id,
                            current_step="clustering_unassigned",
                            current_item=(
                                f"batch {batch_index} chunk {chunk_index}/"
                                f"{total_chunks} ({len(chunk_faces)} faces)"
                            ),
                        )
                        logger.info(
                            "Batch %d chunk %d/%d: running on %d faces",
                            batch_index,
                            chunk_index,
                            total_chunks,
                            len(chunk_faces),
                        )
                        labels, cluster_count, noise_ratio, chunk_elapsed = (
                            _run_clustering(
                                embeddings=chunk_embs,
                                face_ids=chunk_faces,
                            )
                        )
                        logger.info(
                            "Batch %d chunk %d/%d: done in %.1fs (clusters=%d"
                            " noise=%.2f)",
                            batch_index,
                            chunk_index,
                            total_chunks,
                            chunk_elapsed,
                            cluster_count,
                            noise_ratio,
                        )
                        clusters = _group_faces_by_cluster(
                            labels, chunk_faces, chunk_embs
                        )
                        created_count, created_person_ids = _assign_faces_to_clusters(
                            clusters,
                            task_id,
                            update_progress=False,
                        )
                        total_created += created_count
                        total_clusters += len(clusters)
                        if created_person_ids:
                            new_person_candidates.extend(created_person_ids)
                        set_task_progress(
                            task_id,
                            current_step="clustering_unassigned",
                            current_item=(
                                f"batch {batch_index} chunk {chunk_index}/"
                                f"{total_chunks} created {total_created} persons"
                            ),
                        )
                        with Session(db.engine) as progress_session:
                            task = progress_session.get(ProcessingTask, task_id)
                            if task and task.status != "cancelled":
                                task.processed += len(chunk_faces)
                                progress_session.add(task)
                                safe_commit(progress_session)
                    logger.info(
                        "Cluster batch produced %d new persons out of %d candidate"
                        " clusters",
                        total_created,
                        total_clusters,
                    )
                else:
                    logger.info(
                        "Batch %d: running on %d unassigned faces",
                        batch_index,
                        len(batch_embeddings),
                    )
                    labels, cluster_count, noise_ratio, cluster_elapsed = (
                        _run_clustering(
                            embeddings=batch_embeddings,
                            face_ids=batch_face_ids,
                        )
                    )
                    logger.info(
                        "Batch %d: done in %.1fs (clusters=%d noise=%.2f)",
                        batch_index,
                        cluster_elapsed,
                        cluster_count,
                        noise_ratio,
                    )
                    clusters = _group_faces_by_cluster(
                        labels, batch_face_ids, batch_embeddings
                    )
                    created_count, created_person_ids = _assign_faces_to_clusters(
                        clusters,
                        task_id,
                        update_progress=False,
                    )
                    if created_person_ids:
                        new_person_candidates.extend(created_person_ids)
                    logger.info(
                        "Cluster batch produced %d new persons out of %d candidate"
                        " clusters",
                        created_count,
                        len(clusters),
                    )
                    set_task_progress(
                        task_id,
                        current_step="clustering_unassigned",
                        current_item=(
                            f"batch {batch_index} created {created_count} persons"
                        ),
                    )
            else:
                logger.info(
                    "Batch %d: only %d unassigned faces (< min %d). Skipping"
                    " clustering.",
                    batch_index,
                    len(batch_embeddings),
                    settings.face_recognition.person_min_face_count,
                )
                set_task_progress(
                    task_id,
                    current_step="clustering_unassigned",
                    current_item=(
                        f"batch {batch_index} skipped (only"
                        f" {len(batch_embeddings)} faces)"
                    ),
                )
            if batch_face_ids:
                with Session(db.engine) as session:
                    task = session.get(ProcessingTask, task_id)
                    if task and task.status != "cancelled":
                        task.processed += len(batch_face_ids)
                        session.add(task)
                        safe_commit(session)
            logger.info(
                "Finished batch %d in %.1fs",
                batch_index,
                time.monotonic() - batch_started,
            )
            if len(batch_face_ids) < settings.face_recognition.cluster_batch_size:
                break
            set_task_progress(
                task_id,
                current_step="clustering_batches",
                current_item=f"waiting for next batch after id {last_id}",
            )
        logger.info(
            "Starting merge of similar persons (%d candidates)",
            len(new_person_candidates),
        )
        merge_similar_persons(task_id, new_person_candidates)

        with Session(db.engine) as session:
            task = session.get(ProcessingTask, task_id)
            logger.info("FINISHED CLUSTERING!")
            complete_task(session, task)
    rebuild_person_relationships()
