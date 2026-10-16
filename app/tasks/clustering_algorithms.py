"""Pure clustering algorithms over face embeddings (no database access)."""

from __future__ import annotations

import time

import hdbscan
import networkx as nx
import numpy as np
from sklearn.decomposition import PCA
from sklearn.neighbors import NearestNeighbors

from app.config import settings
from app.logger import logger


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
        embeddings, min_cluster_size=min_cluster_size, min_samples=min_samples
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
    face_ids: list[int], embeddings: np.ndarray
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
        logger.debug(f"CW iteration {iteration + 1}, changed={changed}")
        if not changed:
            logger.info(f"Chinese Whispers converged after {iteration + 1} iterations")
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
        logger.info("CW purity pass demoted %d chain-merged faces to noise", dropped)

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
                settings.face_recognition, "hdbscan_min_membership_probability", 0.0
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


def group_faces_by_cluster(
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


def run_clustering(
    *, embeddings: np.ndarray, face_ids: list[int]
) -> tuple[np.ndarray, int, float, float]:
    started = time.monotonic()
    labels = _cluster_embeddings(embeddings, face_ids=face_ids)
    elapsed = time.monotonic() - started
    cluster_count, noise_ratio = _summarize_labels(labels)
    return labels, cluster_count, noise_ratio, elapsed


def compute_person_prototypes(vectors: np.ndarray, k: int) -> np.ndarray:
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
