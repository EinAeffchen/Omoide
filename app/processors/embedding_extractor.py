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

    def _get_embedding(self, media: ImageFile | cv2.typing.MatLike):
        if not isinstance(media, ImageFile):
            media_obj = Image.fromarray(media).convert("RGB")
        else:
            media_obj = media
        try:
            img_tensor = self._preprocess(media_obj).unsqueeze(0)
        except OSError as e:
            logger.error("EmbeddingExtractor: failed to preprocess image for %s due to %s", getattr(media_obj, 'filename', 'image'), e)
            return False
        if hasattr(self, "_clip_device"):
            img_tensor = img_tensor.to(self._clip_device)
        with torch.no_grad():
            img_features = self._clip_model.encode_image(img_tensor)
        img_features /= img_features.norm(dim=-1, keepdim=True)
        return img_features.squeeze(0).cpu().numpy().astype(np.float32)

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
        for scene in tqdm(scenes):
            if isinstance(scene, ImageFile):
                embedding = self._get_embedding(scene)
                if embedding is None:
                    logger.error("EmbeddingExtractor: model returned empty embedding for %s", media.path)
                    delete_media_record(media.id, session)
                    safe_commit(session)
                    return False
                embeddings.append(embedding)
            elif isinstance(scene, tuple):
                scene_obj, frame = scene
                embedding = self._get_embedding(frame)
                if embedding is None:
                    logger.error("EmbeddingExtractor: model returned empty embedding for %s", media.path)
                    delete_media_record(media.id, session)
                    safe_commit(session)
                    return False
                embeddings.append(embedding)
                session.add(scene_obj)
                session.flush()
                blob = vector_to_blob(embedding)
                if blob is None:
                    logger.error(
                        "EmbeddingExtractor: failed to encode scene embedding for scene %s in media %s",
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
                        ).bindparams(sid=scene_obj.id, mid=media.id, emb=blob)
                    )
            elif isinstance(scene, Scene):
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
                logger.warning("Got instance: %s", type(scene))

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
            logger.error("EmbeddingExtractor: failed to convert embedding for %s", media.path)
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
