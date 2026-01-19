import io
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile
from sqlalchemy import desc, func, text, tuple_
from sqlmodel import Session, select
from PIL import Image

from app.config import settings, get_clip_bundle
from app.database import get_session
from app.logger import logger
from app.utils import vector_to_blob

from app.models import Media, Person, Scene, Tag
from app.schemas.media import MediaPreview
from app.schemas.person import PersonReadSimple
from app.schemas.search import CursorPage, SceneSearchResult
from app.schemas.tag import TagRead

router = APIRouter()


def encode_uploaded_image(image_bytes: bytes) -> np.ndarray:
    """
    Takes raw image bytes, preprocesses them for CLIP, and returns a
    normalized vector embedding.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        logger.error(f"Failed to open uploaded image: {e}")
        raise HTTPException(
            status_code=400, detail="Invalid or corrupt image file."
        )

    # Use a shared, persistent CLIP bundle to avoid per-call reinitialization
    # Lazy import torch to avoid heavy import cost during app boot
    import torch
    clip_model, preprocess, _ = get_clip_bundle()
    image_transformed = preprocess(image).unsqueeze(0)
    try:
        device = next(clip_model.parameters()).device
    except StopIteration:
        device = torch.device("cpu")
    if hasattr(image_transformed, "to"):
        image_transformed = image_transformed.to(device)
    with torch.no_grad():
        image_feat = clip_model.encode_image(image_transformed)
        image_feat /= image_feat.norm(dim=-1, keepdim=True)

    return image_feat.squeeze(0).cpu().numpy().tolist()


def encode_text_query(query: str) -> np.ndarray:
    # Lazy import torch to avoid heavy import cost during app boot
    import torch
    clip_model, _, tokenizer = get_clip_bundle()
    tokenized = tokenizer([query])
    try:
        device = next(clip_model.parameters()).device
    except StopIteration:
        device = torch.device("cpu")
    if hasattr(tokenized, "to"):
        tokenized = tokenized.to(device)
    with torch.no_grad():
        text_feat = clip_model.encode_text(tokenized)
    text_feat /= text_feat.norm(dim=-1, keepdim=True)
    return text_feat.squeeze(0).cpu().numpy().tolist()


@router.post(
    "/by-image",
    summary="Search for similar media by uploading an image",
    response_model=list[MediaPreview],
)
def search_by_image(
    file: UploadFile = File(...),
    limit: int = 20,
    session: Session = Depends(get_session),
):
    image_bytes = file.file.read()

    query_vector = encode_uploaded_image(image_bytes)

    max_dist = 2.0 - settings.ai.min_similarity_dist
    vec_blob = vector_to_blob(query_vector)
    if vec_blob is None:
        logger.warning("Failed to encode query vector for uploaded image search")
        return []

    sql = text(
        """
        SELECT media_id, distance
        FROM media_embeddings
        WHERE embedding MATCH :vec
            AND k = :k
            AND distance < :max_dist
        ORDER BY distance
        """
    ).bindparams(vec=vec_blob, max_dist=max_dist, k=limit)

    rows = session.exec(sql).all()
    media_ids = [row[0] for row in rows]

    if not media_ids:
        return []

    media_objs = session.exec(
        select(Media).where(Media.id.in_(media_ids))
    ).all()

    id_to_obj = {m.id: m for m in media_objs}
    ordered_media = [id_to_obj[mid] for mid in media_ids if mid in id_to_obj]

    return [MediaPreview.model_validate(m) for m in ordered_media]


@router.get(
    "/media",
    summary="Search media with cursor pagination",
    response_model=CursorPage[MediaPreview],
)
def search_media(
    limit: int = 20,
    cursor: str | None = Query(None, description="page_number"),
    query: str = Query("", description="Free-text or embedding query"),
    session: Session = Depends(get_session),
):
    if not query:
        return CursorPage(items=[], next_cursor=None)

    max_dist = 2.0 - settings.ai.min_search_dist
    max_pages = 3
    vec = encode_text_query(query)
    vec_blob = vector_to_blob(vec)
    if vec_blob is None:
        logger.warning("Failed to encode query vector for text search")
        return CursorPage(items=[], next_cursor=None)
    min_dist = 0
    if cursor:
        min_dist = float(cursor)

    sql = text(
        """
        SELECT media_id, distance
            FROM media_embeddings
            WHERE embedding MATCH :vec
            AND k = :k
            AND distance < :max_dist
            AND distance > :min_dist
            ORDER BY distance
        """
    ).bindparams(
        vec=vec_blob,
        max_dist=max_dist,
        min_dist=min_dist,
        k=limit * max_pages,
    )
    rows = session.exec(sql).all() 
    media_ids = [row[0] for row in rows]
    medias = session.exec(select(Media).where(Media.id.in_(media_ids))).all()
    id_map = {m.id: m for m in medias}
    ordered = [id_map[mid] for mid in media_ids if mid in id_map]
    if len(medias) == limit:
        next_cursor = str(rows[-1][1])
    else:
        next_cursor = None
    return CursorPage(
        items=[MediaPreview.model_validate(media) for media in ordered],
        next_cursor=next_cursor,
    )


@router.get(
    "/scenes",
    summary="Search video scenes by text query",
    response_model=CursorPage[SceneSearchResult],
)
def search_scenes(
    query: str = Query("", description="Free-text query for scene search"),
    limit: int = 20,
    cursor: str | None = Query(
        None, description="Distance cursor returned from previous request"
    ),
    session: Session = Depends(get_session),
):
    if not query:
        return CursorPage(items=[], next_cursor=None)

    max_dist = 2.0 - settings.ai.min_search_dist
    max_pages = 3

    vec = encode_text_query(query)
    vec_blob = vector_to_blob(vec)
    if vec_blob is None:
        logger.warning("Failed to encode query vector for scene search")
        return CursorPage(items=[], next_cursor=None)

    try:
        min_dist = float(cursor) if cursor else 0.0
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid cursor format")

    sql = text(
        """
        SELECT scene_id, media_id, distance
          FROM scene_embeddings
         WHERE embedding MATCH :vec
           AND k = :k
           AND distance < :max_dist
           AND distance > :min_dist
         ORDER BY distance
        """
    ).bindparams(
        vec=vec_blob,
        max_dist=max_dist,
        min_dist=min_dist,
        k=limit * max_pages,
    )

    rows = session.exec(sql).all()
    if not rows:
        return CursorPage(items=[], next_cursor=None)

    scene_ids = [row[0] for row in rows]
    distance_map = {row[0]: float(row[2]) for row in rows}

    scene_data = session.exec(
        select(Scene, Media)
        .join(Media, Scene.media_id == Media.id)
        .where(Scene.id.in_(scene_ids))
    ).all()

    if not scene_data:
        return CursorPage(items=[], next_cursor=None)

    scene_map = {scene.id: (scene, media) for scene, media in scene_data}

    ordered_results: list[SceneSearchResult] = []
    for scene_id in scene_ids:
        if scene_id not in scene_map:
            continue
        scene, media = scene_map[scene_id]
        ordered_results.append(
            SceneSearchResult(
                scene_id=scene.id,
                media_id=media.id,
                media_filename=media.filename,
                media_thumbnail_path=media.thumbnail_path,
                scene_thumbnail_path=scene.thumbnail_path,
                start_time=float(scene.start_time),
                end_time=float(scene.end_time) if scene.end_time is not None else None,
                distance=distance_map.get(scene.id, 0.0),
            )
        )

    if not ordered_results:
        return CursorPage(items=[], next_cursor=None)

    limited_results = ordered_results[:limit]

    next_cursor = None
    if limited_results and len(rows) > len(limited_results):
        next_cursor = str(limited_results[-1].distance)

    return CursorPage(items=limited_results, next_cursor=next_cursor)


@router.get(
    "/person",
    summary="Search people by name",
    response_model=CursorPage[PersonReadSimple],
)
def search_people(
    limit: int = 20,
    cursor: str | None = Query(None, description="Encoded as `<count>_<id>`"),
    query: str = Query("", description="Person name query"),
    session: Session = Depends(get_session),
):
    if not query:
        return CursorPage(items=[], next_cursor=None)

    q = select(Person).where(Person.name.ilike(f"%{query}%"))

    if cursor:
        try:
            cursor_count, cursor_id = map(int, cursor.split("_"))
            q = q.where(
                tuple_(Person.appearance_count, Person.id)
                < (cursor_count, cursor_id)
            )
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400, detail="Invalid cursor format"
            )

    q = q.order_by(desc(Person.appearance_count), desc(Person.id)).limit(limit)

    people = session.exec(q).all()

    next_cursor = None
    if len(people) == limit:
        last_person = people[-1]
        next_cursor = f"{last_person.appearance_count}_{last_person.id}"
    return CursorPage(
        items=[PersonReadSimple.model_validate(person) for person in people],
        next_cursor=next_cursor,
    )


@router.get(
    "/tags",
    summary="Search tags by name",
    response_model=CursorPage[TagRead],
)
def search_tags(
    limit: int = 20,
    cursor: str | None = Query(
        None, description="The ID of the last tag from the previous page"
    ),
    query: str = Query("", description="Tag name query"),
    session: Session = Depends(get_session),
):
    if not query:
        return CursorPage(items=[], next_cursor=None)

    q = select(Tag).where(Tag.name.ilike(f"%{query}%"))

    if cursor:
        try:
            cursor_id = int(cursor)
            q = q.where(Tag.id < cursor_id)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400, detail="Invalid cursor format"
            )

    q = q.order_by(desc(Tag.id)).limit(limit)

    tags = session.exec(q).all()

    next_cursor = None
    if len(tags) == limit:
        next_cursor = str(tags[-1].id)

    return CursorPage(
        items=[TagRead.model_validate(t) for t in tags],
        next_cursor=next_cursor,
    )
