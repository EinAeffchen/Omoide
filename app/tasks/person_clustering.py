from __future__ import annotations

import math
import time
from collections import deque
from collections.abc import Iterable
from datetime import UTC, datetime

import hdbscan
import networkx as nx
import numpy as np
from sklearn.decomposition import PCA
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


def _quality_seed_filter() -> tuple[str, dict[str, float]]:
    """
    SQL fragment (aliased on ``f``) excluding low-confidence and hard-profile
    faces from seeding new clusters: their embeddings are unreliable and tend
    to agglomerate into junk "people". They stay unassigned and are picked up
    by the leftover matching pass instead. Faces without quality data (NULL,
    extracted before the quality columns existed) are kept.
    """
    return (
        """
           AND (f.det_score IS NULL OR f.det_score >= :min_det_score)
           AND (f.frontality IS NULL OR f.frontality >= :min_frontality)
        """,
        {
            "min_det_score": float(
                settings.face_recognition.cluster_seed_min_det_score
            ),
            "min_frontality": float(
                settings.face_recognition.cluster_seed_min_frontality
            ),
        },
    )


def _fetch_faces_and_embeddings(
    session: Session,
    limit: int = 10000,
    last_id: int = 0,
    *,
    quality_seed_only: bool = False,
) -> tuple[list[int], np.ndarray]:
    quality_filter = ""
    params: dict[str, float | int] = {"last_id": last_id, "limit": limit}
    if quality_seed_only:
        quality_filter, quality_params = _quality_seed_filter()
        params.update(quality_params)

    sql = text(
        f"""
        SELECT f.id, fe.embedding
          FROM face            AS f
          JOIN face_embeddings AS fe
               ON fe.face_id = f.id
         WHERE f.person_id IS NULL
           AND f.id > :last_id
           {quality_filter}
         ORDER BY f.id
         LIMIT :limit
        """
    ).bindparams(**params)

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


def _trim_clusters_by_centroid_similarity(
    labels: np.ndarray,
    embeddings: np.ndarray,
    min_similarity: float,
    max_iterations: int = 3,
) -> tuple[np.ndarray, int]:
    """
    Demote cluster members whose cosine similarity to their cluster centroid
    falls below ``min_similarity`` to noise (-1).

    Graph label propagation (Chinese Whispers) merges transitively: A-B and
    B-C edges pull A and C together even when A and C are dissimilar. This
    pass enforces a compactness guarantee per cluster; trimmed faces stay
    unassigned and can still be attached to a person by the leftover
    matching pass. Recomputes the centroid after each trim since dropping
    outliers shifts it.
    """
    if labels.size == 0 or min_similarity <= 0.0:
        return labels, 0

    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    normed = embeddings / norms

    labels = labels.copy()
    dropped_total = 0
    for cluster_id in np.unique(labels):
        if cluster_id < 0:
            continue
        member_idx = np.flatnonzero(labels == cluster_id)
        for _ in range(max_iterations):
            if member_idx.size < 2:
                break
            centroid = normed[member_idx].mean(axis=0)
            centroid_norm = float(np.linalg.norm(centroid))
            if centroid_norm <= 0.0 or not np.isfinite(centroid_norm):
                break
            centroid /= centroid_norm
            sims = normed[member_idx] @ centroid
            keep = sims >= min_similarity
            if keep.all():
                break
            drop_idx = member_idx[~keep]
            labels[drop_idx] = -1
            dropped_total += int(drop_idx.size)
            member_idx = member_idx[keep]
    return labels, dropped_total


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
            # with duplicate embeddings the self match is not guaranteed to
            # be at position 0, so guard explicitly
            if neighbor_idx == i:
                continue
            if mutual_nn and i not in neighbor_sets[neighbor_idx]:
                continue

            similarity = 1.0 - dist

            if similarity > threshold:
                G.add_edge(i, neighbor_idx, weight=similarity)
                edge_count += 1

    logger.info(f"Similarity graph built with {edge_count} edges")

    # 3. Chinese Whispers Iterations
    # Seeded RNG so repeated runs over the same faces give the same clusters
    # (makes threshold tuning reproducible).
    rng = np.random.default_rng(42)
    nodes = list(G.nodes())
    for iteration in range(iterations):
        rng.shuffle(nodes)
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

    # 5. Purity pass: enforce per-cluster compactness that label propagation
    # cannot guarantee (breaks up "assimilation" clusters built from chains).
    min_member_similarity = float(
        getattr(settings.face_recognition, "cw_min_member_similarity", 0.0)
    )
    cluster_labels, dropped = _trim_clusters_by_centroid_similarity(
        cluster_labels, embeddings, min_member_similarity
    )
    if dropped:
        logger.info(
            "CW purity pass demoted %d chain-merged faces to noise", dropped
        )

    return cluster_labels


def _cluster_embeddings_hdbscan(
    embeddings: np.ndarray, min_cluster_size=None, min_samples=None
) -> np.ndarray:
    logger.info("INSIDE HDBSCAN CLUSTERING")
    if embeddings.size == 0:
        return np.array([], dtype=int)

    # L2-normalize so euclidean distance is monotonic with cosine similarity
    # (embeddings are stored normalized, but older rows may not be).
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    embeddings_normed = embeddings / norms

    # Reduce with PCA instead of UMAP: PCA is a rotation + truncation, so it
    # approximately preserves distances. UMAP manufactures density (its job is
    # visualization-style manifold compression), which turned loose groups of
    # side profiles/statues into tight blobs HDBSCAN then confidently merged.
    n_components = min(64, embeddings_normed.shape[0], embeddings_normed.shape[1])
    if embeddings_normed.shape[1] > n_components:
        embeddings_reduced = PCA(
            n_components=n_components, random_state=42
        ).fit_transform(embeddings_normed)
    else:
        embeddings_reduced = embeddings_normed
    embeddings_reduced = np.ascontiguousarray(embeddings_reduced, dtype=np.float64)
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
            # needed for relative_validity_ (DBCV) scoring below
            gen_min_span_tree=True,
        )
        labels = clusterer.fit_predict(embeddings_reduced)

        # Demote weakly attached members to noise; they can still be matched
        # to the resulting persons in the leftover pass.
        min_membership = float(
            getattr(
                settings.face_recognition,
                "hdbscan_min_membership_probability",
                0.0,
            )
        )
        if min_membership > 0.0 and len(labels) > 0:
            weak = (labels >= 0) & (clusterer.probabilities_ < min_membership)
            if np.any(weak):
                labels = labels.copy()
                labels[weak] = -1
                logger.debug(
                    "HDBSCAN demoted %d weak members to noise", int(np.sum(weak))
                )

        # Score attempts with DBCV (density-based cluster validity). The old
        # np.mean(probabilities_) counted noise points as 0, which rewarded
        # cramming everything into clusters — i.e. exactly the over-merging
        # we are trying to avoid.
        if len(labels) > 0:
            try:
                current_score = float(clusterer.relative_validity_)
            except Exception:
                non_noise = labels >= 0
                if np.any(non_noise):
                    current_score = float(
                        np.mean(clusterer.probabilities_[non_noise])
                    ) - float(np.mean(labels == -1))
                else:
                    current_score = -1.0
        else:
            current_score = -1.0

        non_noise_mask = labels >= 0
        cluster_count = int(np.unique(labels[non_noise_mask]).size)
        noise_ratio = float(np.mean(labels == -1))

        logger.debug(
            "HDBSCAN attempt clusters=%d noise=%.2f score=%.3f",
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


def _assign_faces_to_clusters(
    clusters: dict[int, tuple[list[int], list[np.ndarray]]],
    task_id: str,
    *,
    update_progress: bool = True,
) -> tuple[int, list[int]]:
    created = 0
    new_person_ids: list[int] = []
    min_face_count = int(settings.face_recognition.person_min_face_count)
    max_radius = float(settings.face_recognition.person_cluster_max_l2_radius)
    for face_ids, embeddings in tqdm(clusters.values()):
        if len(face_ids) < min_face_count:
            continue

        # Trim outliers instead of discarding the whole cluster: one bad face
        # used to poison an otherwise-good cluster of dozens, sending all of
        # them back to manual assignment. Iterate because dropping outliers
        # shifts the centroid. Trimmed faces stay unassigned and get another
        # chance in the leftover matching pass. Note this check cannot catch
        # junk-hub clusters (they are compact); those are handled by the
        # quality gate at seeding time.
        face_ids_arr = np.asarray(face_ids)
        embeddings_arr = np.array(embeddings)
        trimmed = 0
        for _ in range(5):
            centroid = embeddings_arr.mean(axis=0)
            l2_radii = np.linalg.norm(embeddings_arr - centroid, axis=1)
            keep = l2_radii <= max_radius
            if keep.all():
                break
            trimmed += int(np.sum(~keep))
            face_ids_arr = face_ids_arr[keep]
            embeddings_arr = embeddings_arr[keep]
            if len(face_ids_arr) < min_face_count:
                break
        if len(face_ids_arr) < min_face_count:
            logger.info(
                "Skipping loose cluster (%d of %d faces left after radius trim)",
                len(face_ids_arr),
                len(face_ids),
            )
            continue
        if trimmed:
            logger.info(
                "Trimmed %d outlier faces (radius > %.3f) from cluster of %d",
                trimmed,
                max_radius,
                len(face_ids),
            )
        face_ids = [int(fid) for fid in face_ids_arr]

        centroid = embeddings_arr.mean(axis=0)
        similarities = embeddings_arr @ centroid
        best_face_id = face_ids[int(np.argmax(similarities))]

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

            if update_progress and task is not None:
                task.processed += len(face_ids)
                session.add(task)
            safe_commit(session)
    return created, new_person_ids


def _get_face_total(session: Session, *, quality_seed_only: bool = False) -> int:
    quality_filter = ""
    params: dict[str, float] = {}
    if quality_seed_only:
        quality_filter, params = _quality_seed_filter()
    sql = text(
        f"""
        SELECT COUNT(*)
          FROM face            AS f
          JOIN face_embeddings AS fe ON fe.face_id = f.id
         WHERE f.person_id IS NULL
           {quality_filter}
        """
    )
    if params:
        sql = sql.bindparams(**params)
    row = session.exec(sql).first()
    return int(row[0]) if row else 0


def _is_task_cancelled(session: Session, task_id: str) -> bool:
    row = session.exec(
        text(
            """
            SELECT status
              FROM processingtask
             WHERE id = :task_id
            """
        ).bindparams(task_id=task_id)
    ).first()
    if not row:
        return False
    status = row[0] if isinstance(row, tuple) else row
    return str(status) == "cancelled"


def _iter_chunks(values: list[int], chunk_size: int) -> Iterable[list[int]]:
    size = max(1, int(chunk_size))
    for i in range(0, len(values), size):
        yield values[i : i + size]


def _build_in_clause_params(
    values: list[int], *, prefix: str
) -> tuple[str, dict[str, int]]:
    placeholders: list[str] = []
    params: dict[str, int] = {}
    for idx, value in enumerate(values):
        key = f"{prefix}{idx}"
        placeholders.append(f":{key}")
        params[key] = int(value)
    return ", ".join(placeholders), params


def _compute_person_prototypes(vectors: np.ndarray, k: int) -> np.ndarray:
    """
    Reduce a person's face embeddings (L2-normalized, shape (n, d)) to up to
    ``k`` prototype vectors via farthest-point seeding + a few spherical
    k-means iterations. Multiple prototypes capture pose modes (frontal,
    left/right profile) that a single centroid — dominated by frontal shots —
    washes out.
    """

    def _norm_rows(matrix: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        norms[norms == 0.0] = 1.0
        return matrix / norms

    centroid = _norm_rows(vectors.mean(axis=0, keepdims=True))
    if k <= 1 or vectors.shape[0] <= 1:
        return centroid.astype(np.float32, copy=False)

    centers = [centroid[0]]
    for _ in range(k - 1):
        sims = vectors @ np.vstack(centers).T
        best_sim = sims.max(axis=1)
        centers.append(vectors[int(np.argmin(best_sim))])
    centers_arr = np.vstack(centers)

    for _ in range(4):
        assignment = np.argmax(vectors @ centers_arr.T, axis=1)
        for j in range(centers_arr.shape[0]):
            members = vectors[assignment == j]
            if members.shape[0]:
                centers_arr[j] = members.mean(axis=0)
        centers_arr = _norm_rows(centers_arr)

    return centers_arr.astype(np.float32, copy=False)


def _load_person_prototype_matrix(
    session: Session,
    *,
    per_person_cap: int = 64,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Build the matching matrix from per-person prototypes computed over the
    persons' face embeddings (instead of the single stored centroid). Returns
    (person_ids, matrix) where person_ids has one entry per prototype row and
    may contain the same person several times.
    """
    max_prototypes = max(
        1,
        int(
            getattr(settings.face_recognition, "person_matching_max_prototypes", 3)
        ),
    )
    # Prefer quality faces for the prototypes so junk members (blurry/profile
    # faces mistakenly attached to a person) do not become attachment anchors.
    # Persons with no quality-rated faces fall back to all of their faces.
    quality_filter, quality_params = _quality_seed_filter()
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
    grouped.update(
        {pid: vecs for pid, vecs in quality_grouped.items() if vecs}
    )


    proto_person_ids: list[int] = []
    proto_vectors: list[np.ndarray] = []
    for person_id, vecs in grouped.items():
        if not vecs:
            continue
        arr = np.vstack(vecs)
        # only spend extra prototypes on persons with enough faces to
        # actually exhibit distinct pose modes (~4 faces per prototype)
        k = min(max_prototypes, max(1, arr.shape[0] // 4))
        for proto in _compute_person_prototypes(arr, k):
            proto_person_ids.append(person_id)
            proto_vectors.append(proto)

    if not proto_person_ids:
        return np.array([], dtype=np.int64), np.empty((0, 0), dtype=np.float32)

    return np.array(proto_person_ids, dtype=np.int64), np.vstack(
        proto_vectors
    ).astype(np.float32, copy=False)


def _bulk_assign_faces_to_persons(
    session: Session,
    assignments: dict[int, int],
    *,
    chunk_size: int = 500,
) -> None:
    if not assignments:
        return

    by_person_id: dict[int, list[int]] = {}
    for face_id, person_id in assignments.items():
        by_person_id.setdefault(int(person_id), []).append(int(face_id))

    for person_id, person_face_ids in by_person_id.items():
        for face_chunk in _iter_chunks(person_face_ids, chunk_size):
            placeholders, params = _build_in_clause_params(face_chunk, prefix="f")
            sql_face = text(
                f"UPDATE face SET person_id = :pid WHERE id IN ({placeholders})"
            ).bindparams(pid=person_id, **params)
            session.exec(sql_face)

            sql_face_embedding = text(
                "UPDATE face_embeddings SET person_id = :pid"
                f" WHERE face_id IN ({placeholders})"
            ).bindparams(pid=person_id, **params)
            session.exec(sql_face_embedding)


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

    threshold_cosine = float(
        getattr(settings.face_recognition, "existing_person_cosine_threshold", 0.0)
    )
    if threshold_cosine <= 0.0 or threshold_cosine > 1.0:
        threshold_cosine = float(
            getattr(settings.face_recognition, "person_merge_percent_similarity", 75.0)
        ) / 100.0
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
        1,
        int(getattr(settings.face_recognition, "matching_cancel_check_every", 8)),
    )
    cancelled = False

    logger.info("Attempting to match %d faces to existing persons...", len(face_ids))
    total_faces = len(face_ids)
    for start in range(0, total_faces, chunk_size):
        end = min(start + chunk_size, total_faces)
        chunk_number = (start // chunk_size) + 1
        if (
            start == 0 or chunk_number % cancel_check_every == 0
        ) and _is_task_cancelled(session, task_id):
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
            second_scores = np.where(
                np.isfinite(second_scores), second_scores, -1.0
            )

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


def _match_remaining_single_faces(
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
        remaining_total = _get_face_total(session)
        task = session.get(ProcessingTask, task_id)
        if task and task.status != "cancelled":
            task.processed = 0
            task.total = remaining_total
            session.add(task)
            safe_commit(session)
    while True:
        with Session(db.engine) as session:
            face_ids, embeddings = _fetch_faces_and_embeddings(
                session, limit=batch_size, last_id=last_id
            )
            if not face_ids:
                break
            last_id = face_ids[-1]

            still_unassigned_ids = _match_unassigned_to_existing(
                session,
                face_ids,
                embeddings,
                task_id,
                prototypes=prototypes,
            )
            if _is_task_cancelled(session, task_id):
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


def run_person_clustering(task_id: str) -> None:
    cluster_chunk_size = settings.face_recognition.cluster_batch_size
    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = "running"
        task.started_at = datetime.now(UTC)
        # count only faces eligible to seed clusters so the progress bar
        # matches what the batch loop actually processes; the quality-excluded
        # remainder is accounted for separately in the matching phase
        task.total = _get_face_total(session, quality_seed_only=True)
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

    def finalize_cancelled() -> None:
        with Session(db.engine) as session:
            task = session.get(ProcessingTask, task_id)
            if task and task.status == "cancelled" and task.finished_at is None:
                task.finished_at = datetime.now(UTC)
                session.add(task)
                safe_commit(session)
        clear_task_progress(task_id)

    with heavy_writer(name="cluster_persons", cancelled=is_cancelled) as acquired:
        if not acquired:
            with Session(db.engine) as session:
                task = session.get(ProcessingTask, task_id)
                if task:
                    task.status = "cancelled"
                    task.finished_at = datetime.now(UTC)
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
                    # only quality faces may seed new persons; low-quality
                    # faces are attached in the leftover matching pass below
                    quality_seed_only=True,
                )
                if not batch_face_ids:
                    break

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
                        clusters, task_id, update_progress=False
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
        if is_cancelled():
            logger.info("Clustering task %s cancelled before leftover matching.", task_id)
            finalize_cancelled()
            return
        logger.info("Starting leftover single-face match pass after clustering")
        (
            matched_leftovers,
            scanned_leftovers,
            cancelled_during_match,
        ) = (
            _match_remaining_single_faces(
                task_id,
                batch_size=settings.face_recognition.cluster_batch_size,
            )
        )
        logger.info(
            "Leftover single-face pass finished: scanned=%d matched=%d",
            scanned_leftovers,
            matched_leftovers,
        )
        if cancelled_during_match or is_cancelled():
            logger.info("Clustering task %s cancelled during matching phase.", task_id)
            finalize_cancelled()
            return

        with Session(db.engine) as session:
            task = session.get(ProcessingTask, task_id)
            logger.info("FINISHED CLUSTERING!")
            complete_task(session, task)
    rebuild_person_relationships()
