import cv2
import numpy as np
import torch
from cv2.typing import MatLike
from PIL import Image
from PIL.ImageFile import ImageFile
from sqlalchemy import text
from sqlmodel import select
from tqdm import tqdm

from app.api.media import delete_media_record
from app.config import settings, get_clip_bundle
from app.logger import logger
from app.models import Media, Scene, Tag
from app.processors.base import MediaProcessor
from app.utils import safe_commit, vector_to_blob, vector_from_stored


class EmbeddingExtractor(MediaProcessor):
    name = "embedding_extractor"
    order = 10

    def load_model(self):
        if settings.processors.image_embedding_processor_active:
            self.active = True
            # Use shared CLIP bundle; keep it warm to avoid repeated init
            self._clip_model, self._preprocess, _ = get_clip_bundle()
            try:
                self._clip_device = next(self._clip_model.parameters()).device
            except StopIteration:
                self._clip_device = torch.device("cpu")

    def unload(self):
        # Keep CLIP warm; no action needed here to avoid per-task reinit
        pass

    def _get_embeddings_batch(self, images: list) -> list[np.ndarray | None]:
        """Run CLIP encode_image on a batch of raw images in sub-batches.

        Accepts PIL ImageFile or numpy RGB arrays. Returns a list of float32
        embeddings (or None for any image that failed preprocessing).
        """
        batch_size = max(1, getattr(settings.processors, "embedding_batch_size", 16))
        results: list[np.ndarray | None] = [None] * len(images)

        for chunk_start in range(0, len(images), batch_size):
            chunk = images[chunk_start : chunk_start + batch_size]
            preprocessed: list[torch.Tensor] = []
            valid_in_chunk: list[int] = []

            for i, img in enumerate(chunk):
                try:
                    if not isinstance(img, Image.Image):
                        img = Image.fromarray(img).convert("RGB")
                    preprocessed.append(self._preprocess(img))
                    valid_in_chunk.append(i)
                except OSError as e:
                    logger.error(
                        "EmbeddingExtractor: failed to preprocess image: %s", e
                    )

            if not preprocessed:
                continue

            batch_tensor = torch.stack(preprocessed)
            if hasattr(self, "_clip_device"):
                batch_tensor = batch_tensor.to(self._clip_device)

            with torch.no_grad():
                features = self._clip_model.encode_image(batch_tensor)
            features = features / features.norm(dim=-1, keepdim=True)
            features_np = features.cpu().numpy().astype(np.float32)

            for feat_i, chunk_i in enumerate(valid_in_chunk):
                results[chunk_start + chunk_i] = features_np[feat_i]

        return results

    def process(
        self,
        media: Media,
        session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ):
        # 1) skip if already extracted
        if session.exec(
            select(Media).where(
                Media.embeddings_created.is_(True), Media.id == media.id
            )
        ).first():
            return True

        embeddings: list[np.ndarray] = []

        # Fast path: scenes are already-stored Scene DB objects — load from DB
        if scenes and isinstance(scenes[0], Scene):
            for scene in tqdm(scenes):
                row = session.exec(
                    text(
                        "SELECT embedding FROM scene_embeddings WHERE scene_id = :sid"
                    ).bindparams(sid=scene.id)
                ).first()
                if not row:
                    logger.debug(
                        "EmbeddingExtractor: no stored embedding for scene %s; skipping",
                        scene.id,
                    )
                    continue
                vec = vector_from_stored(row[0])
                if vec is None or vec.size == 0:
                    logger.debug(
                        "EmbeddingExtractor: invalid stored embedding for scene %s; skipping",
                        scene.id,
                    )
                    continue
                embeddings.append(vec.astype(np.float32, copy=False))
        else:
            # Collect all raw images and their associated Scene objects (if any)
            # then run a single batched CLIP forward pass.
            raw_images: list = []
            scene_objects: list[Scene | None] = []
            for scene in scenes:
                if isinstance(scene, ImageFile):
                    raw_images.append(scene)
                    scene_objects.append(None)
                elif isinstance(scene, tuple):
                    scene_obj, frame = scene
                    raw_images.append(frame)
                    scene_objects.append(scene_obj)
                else:
                    logger.warning(
                        "EmbeddingExtractor: unexpected scene type %s for %s",
                        type(scene),
                        media.path,
                    )

            if raw_images:
                batch_results = self._get_embeddings_batch(raw_images)

                for scene_obj, embedding in zip(scene_objects, batch_results):
                    if embedding is None:
                        logger.error(
                            "EmbeddingExtractor: model returned empty embedding for %s",
                            media.path,
                        )
                        delete_media_record(media.id, session)
                        safe_commit(session)
                        return False

                    embeddings.append(embedding)

                    if scene_obj is not None:
                        session.add(scene_obj)
                        session.flush()
                        blob = vector_to_blob(embedding)
                        if blob is None:
                            logger.error(
                                "EmbeddingExtractor: failed to encode scene embedding"
                                " for scene %s in media %s",
                                scene_obj.id,
                                media.path,
                            )
                        else:
                            session.exec(
                                text(
                                    """
                                    INSERT OR REPLACE INTO scene_embeddings(scene_id, media_id, embedding)
                                    VALUES (:sid, :mid, :emb)
                                    """
                                ).bindparams(
                                    sid=scene_obj.id, mid=media.id, emb=blob
                                )
                            )

        if not embeddings:
            logger.warning(
                "EmbeddingExtractor: no embeddings produced for %s", media.path
            )
            return True

        if media.duration is None:  # is photo/picture
            vec_embedding = embeddings[0]
        else:
            arr = np.stack([np.array(e, dtype=np.float32) for e in embeddings])
            avg = arr.mean(axis=0)
            norm = np.linalg.norm(avg)
            if norm > 0:
                avg /= norm
            vec_embedding = avg

        media.embeddings_created = True
        session.add(media)
        blob = vector_to_blob(vec_embedding)
        if blob is None:
            logger.error(
                "EmbeddingExtractor: failed to convert embedding for %s", media.path
            )
            return False
        sql = text(
            """
            INSERT OR REPLACE INTO media_embeddings(media_id, embedding)
            VALUES (:id, :emb)
            """
        ).bindparams(id=media.id, emb=blob)
        session.exec(sql)
        safe_commit(session)
        return True

    def get_results(self, media_id: int, session):
        return session.exec(
            select(Tag).join(Tag.media).where(Media.id == media_id)
        ).first()

    def get_pending_condition(self):
        return Media.embeddings_created == False  # noqa: E712

    def reset_for_media(self, media: Media, session) -> None:
        media.embeddings_created = False
        session.add(media)
