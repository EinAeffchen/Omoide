from __future__ import annotations

import math
import time
from datetime import UTC, datetime

import numpy as np
from sqlalchemy import func
from sqlmodel import Session, select

import app.database as db
from app.concurrency import heavy_writer
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import (
    Face,
    Person,
    ProcessingTask,
)
from app.persons import (
    rebuild_person_embedding,
    set_face_embedding_person,
)
from app.tasks.common import complete_task

from .clustering_algorithms import group_faces_by_cluster, run_clustering
from .clustering_queries import fetch_faces_and_embeddings, get_face_total
from .face_matching import match_remaining_single_faces
from .person_merging import merge_similar_persons
from .relationships import rebuild_person_relationships
from .state import clear_task_progress, set_task_progress

__all__ = ["run_person_clustering"]


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
    for face_ids, embeddings in clusters.values():
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

            for face in session.exec(
                select(Face).where(Face.id.in_(face_ids))
            ).all():
                face.person_id = new_person.id
                session.add(face)
            set_face_embedding_person(session, face_ids, new_person.id)
            rebuild_person_embedding(session, new_person.id)

            if update_progress and task is not None:
                task.processed += len(face_ids)
                session.add(task)
            safe_commit(session)
    return created, new_person_ids


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
        task.total = get_face_total(session, quality_seed_only=True)
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
                batch_face_ids, batch_embeddings = fetch_faces_and_embeddings(
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
                            run_clustering(
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
                        clusters = group_faces_by_cluster(
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
                        run_clustering(
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
                    clusters = group_faces_by_cluster(
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
            match_remaining_single_faces(
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
