"""Finding similar persons and merging them."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, text

from app.config import settings
from app.database import get_session
from app.models import Person
from app.persons import get_person_embedding, merge_person_into
from app.schemas.person import (
    MergePersonsBulkRequest,
    MergePersonsRequest,
    MergePersonsResult,
    SimilarPerson,
)

router = APIRouter()


@router.post(
    "/merge", summary="Merge one person into another", status_code=status.HTTP_200_OK
)
def merge_persons(body: MergePersonsRequest, session: Session = Depends(get_session)):
    merged = merge_person_into(session, body.source_id, body.target_id)
    return merged


@router.post(
    "/{person_id}/merge-multiple",
    response_model=MergePersonsResult,
    summary="Merge multiple persons into the specified person",
)
def merge_multiple_persons(
    person_id: int,
    request: MergePersonsBulkRequest,
    session: Session = Depends(get_session),
):
    merged_ids: list[int] = []
    skipped_ids: list[int] = []
    seen: set[int] = set()
    for source_id in request.source_ids:
        if source_id in seen:
            continue
        seen.add(source_id)
        if source_id == person_id:
            skipped_ids.append(source_id)
            continue
        try:
            merge_person_into(session, source_id, person_id)
            merged_ids.append(source_id)
        except HTTPException as exc:
            if exc.status_code in (400, 404):
                skipped_ids.append(source_id)
            else:
                raise
    return MergePersonsResult(merged_ids=merged_ids, skipped_ids=skipped_ids)


@router.get(
    "/{person_id}/similarities",
    response_model=list[SimilarPerson],
    summary="Get stored similarity scores for a person including name and thumbnail",
)
def get_similarities(person_id: int, session: Session = Depends(get_session)):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    vec = get_person_embedding(session, person_id)
    if vec is None:
        return []

    k_val = 20

    sql = text(
        """
        SELECT
            p.id                          AS person_id,
            p.name                        AS person_name, -- aliased to avoid confusion if 'name' is a keyword
            profile_f.thumbnail_path      AS thumbnail_path,
            ROUND(
                (1.0 - (MIN(pe.distance) * MIN(pe.distance)) / 2.0) * 100,
                2
            )                             AS similarity_pct
        FROM person_embeddings AS pe
        JOIN person AS p
            ON p.id = pe.person_id
        LEFT JOIN face AS profile_f -- LEFT JOIN to include persons even if they don't have a profile face
            ON p.profile_face_id = profile_f.id -- Assuming Person table has profile_face_id
        WHERE
            pe.person_id != :p_id          -- Exclude the person themselves
            AND pe.embedding MATCH :vec    -- Vector similarity match (specific to your pg_embedding setup)
            AND pe.k = :k_param            -- If 'k' is a parameter for the MATCH or a column in person_embeddings
                                           -- Ensure this 'k' usage is correct for your pg_embedding extension.
                                           -- Often, for KNN, you'd use ORDER BY embedding_distance LIMIT k.
                                           -- If pe.k is a column, this is filtering on that column.
        GROUP BY
            p.id, p.name, profile_f.thumbnail_path -- Include all selected non-aggregated columns
        ORDER BY
            MIN(pe.distance) ASC           -- Closest first
        LIMIT :limit_val                   -- Limit the number of results
        """
    ).bindparams(
        p_id=person_id,
        vec=vec,  # Handle numpy array or list
        k_param=k_val,  # Parameter for the 'pe.k = :k_param' condition
        limit_val=k_val,  # Parameter for the LIMIT clause
    )

    result_rows = session.exec(sql).all()

    similar_persons_list = []
    for row in result_rows:
        similar_persons_list.append(
            SimilarPerson(
                id=row.person_id,
                name=row.person_name,
                thumbnail=row.thumbnail_path,  # Populate the new thumbnail field
                similarity=row.similarity_pct,
            )
        )

    return similar_persons_list


@router.post(
    "/{person_id}/merge-similar",
    response_model=MergePersonsResult,
    summary="Automatically merge similar persons that exceed the merge threshold",
)
def auto_merge_similar_persons(person_id: int, session: Session = Depends(get_session)):
    threshold = float(
        getattr(settings.face_recognition, "person_merge_percent_similarity", 75.0)
    )
    similar_people = get_similarities(person_id, session)
    candidate_ids = [
        similar.id
        for similar in similar_people
        if similar.id is not None
        and similar.similarity is not None
        and float(similar.similarity) >= threshold
    ]

    merged_ids: list[int] = []
    skipped_ids: list[int] = []

    seen_ids: set[int] = set()

    for source_id in candidate_ids:
        if source_id in seen_ids:
            continue
        seen_ids.add(source_id)
        if source_id == person_id:
            continue
        try:
            merge_person_into(session, source_id, person_id)
            merged_ids.append(source_id)
        except HTTPException as exc:
            if exc.status_code in (400, 404):
                skipped_ids.append(source_id)
            else:
                raise

    return MergePersonsResult(merged_ids=merged_ids, skipped_ids=skipped_ids)
