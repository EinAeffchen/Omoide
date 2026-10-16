"""Database helpers shared by the person clustering and face matching passes."""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
from sqlalchemy import text
from sqlmodel import Session

from app.config import settings
from app.logger import logger
from app.vectors import vector_from_stored


def quality_seed_filter() -> tuple[str, dict[str, float]]:
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


def fetch_faces_and_embeddings(
    session: Session,
    limit: int = 10000,
    last_id: int = 0,
    *,
    quality_seed_only: bool = False,
) -> tuple[list[int], np.ndarray]:
    quality_filter = ""
    params: dict[str, float | int] = {"last_id": last_id, "limit": limit}
    if quality_seed_only:
        quality_filter, quality_params = quality_seed_filter()
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
                    "Skipping face %s for clustering due to missing embedding", face_id
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


def get_face_total(session: Session, *, quality_seed_only: bool = False) -> int:
    quality_filter = ""
    params: dict[str, float] = {}
    if quality_seed_only:
        quality_filter, params = quality_seed_filter()
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


def is_task_cancelled(session: Session, task_id: str) -> bool:
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


def iter_chunks(values: list[int], chunk_size: int) -> Iterable[list[int]]:
    size = max(1, int(chunk_size))
    for i in range(0, len(values), size):
        yield values[i : i + size]


def build_in_clause_params(
    values: list[int], *, prefix: str
) -> tuple[str, dict[str, int]]:
    placeholders: list[str] = []
    params: dict[str, int] = {}
    for idx, value in enumerate(values):
        key = f"{prefix}{idx}"
        placeholders.append(f":{key}")
        params[key] = int(value)
    return ", ".join(placeholders), params
