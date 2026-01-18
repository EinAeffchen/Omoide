import os

import numpy as np
import torch
from cv2.typing import MatLike
from PIL.ImageFile import ImageFile
from sqlmodel import Session, select, text

from app.api.tags import attach_tag_to_media, get_or_create_tag
from app.config import get_clip_bundle, settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, Scene
from app.processors.base import MediaProcessor
from app.tagging import build_tag_vector_map, sanitize_custom_tag_list
from app.utils import vector_from_stored


class AutoTagger(MediaProcessor):
    """
    A piece of logic that, given a Media row,
    may insert or update other tables to enrich it.
    """

    name = "auto_tagger"
    order = 30

    default_tags = [
        "home",
        "work / office",
        "school / university",
        "outdoors",
        "indoors",
        "city / urban",
        "nature",
        "beach / coast",
        "mountains",
        "forest / woods",
        "park",
        "restaurant / cafe / bar",
        "museum / gallery",
        "airport / station",
        "travel / trip",
        "road trip",
        "birthday",
        "party",
        "wedding",
        "anniversary",
        "graduation",
        "halloween",
        "vacation",
        "concert / live music",
        "festival",
        "sports event",
        "conference",
        "couple",
        "group photo",
        "kids / children",
        "baby",
        "pet",
        "dog",
        "cat",
        "eating / dining",
        "cooking / baking",
        "bbq",
        "sports",
        "hiking / walking",
        "running",
        "cycling",
        "skiing / snowboarding",
        "swimming",
        "shopping",
        "music / playing instrument",
        "art / crafting",
        "gardening",
        "food / drink",
        "architecture / buildings",
        "car / vehicle",
        "flowers / plants",
        "art / design",
        "fashion / outfit",
        "technology / gadgets",
        "spring",
        "summer",
        "autumn / fall",
        "winter",
        "morning",
        "afternoon",
        "evening / night",
        "sunrise / sunset",
        "funny / humorous",
        "candid",
        "posed",
        "sentimental / nostalgic",
        "relaxing / calm",
        "action / dynamic",
        "landscape",
        "portrait",
        "black and white",
        "close-up / macro",
        "panorama",
        "blurry / abstract",
        "scenic",
    ]
    tag_map: dict[str, np.ndarray] = dict()

    def load_model(self):
        self.active = settings.tagging.auto_tagging
        if not self.active:
            self.tag_map = {}
            return

        tags: list[str] = []
        if settings.tagging.use_default_tags:
            tags.extend(self.default_tags)

        # Merge config-driven and legacy environment-provided custom tags
        config_custom = sanitize_custom_tag_list(settings.tagging.custom_tags)
        if config_custom:
            tags.extend(config_custom)

        if env_custom := os.environ.get("CUSTOM_TAGS"):
            tags.extend(
                sanitize_custom_tag_list(env_custom.split(","))
            )

        tags = sanitize_custom_tag_list(tags)
        if not tags:
            self.tag_map = {}
            return

        # Use shared CLIP and keep it warm to avoid re-init leaks
        self._clip_model, _, self._tokenizer = get_clip_bundle()
        self.tag_map = build_tag_vector_map(tags)

    def unload(self):
        """Used to load models into memory before use"""
        self.tags = []
        self.tag_map = {}

    def _tag_to_vector(self, tag) -> np.ndarray:
        tokenized_text = self._tokenizer([tag])
        with torch.no_grad():
            # Encode the tokenized text
            text_embedding = self._clip_model.encode_text(tokenized_text)
            # Normalize the embedding to a unit vector
            text_embedding /= text_embedding.norm(dim=-1, keepdim=True)
        # Return as a NumPy array
        return text_embedding.squeeze(0).cpu().numpy()

    def process(
        self,
        media: Media,
        session: Session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ) -> bool | None:
        if media.ran_auto_tagging is True:
            return True
        if media.embeddings_created is False:
            if not settings.processors.image_embedding_processor_active:
                media.ran_auto_tagging = True
                session.add(media)
                safe_commit(session)
            return True

        sql = text(
            """
            SELECT embedding
                FROM media_embeddings
                WHERE media_id=:m_id
            """
        ).bindparams(
            m_id=media.id,
        )
        raw_media_embedding_bytes = session.exec(sql).first()
        if not raw_media_embedding_bytes:
            logger.warning(
                "AutoTagger: No embedding found for %s: %s, skipping auto-tagging for this item and resetting embedding created flag",
                media.id,
                media.path,
            )

            media.embeddings_created = False
            if not settings.processors.image_embedding_processor_active:
                media.ran_auto_tagging = True
            session.add(media)
            safe_commit(session)
            return True
        media_embedding = vector_from_stored(raw_media_embedding_bytes[0])
        if media_embedding is None or media_embedding.size == 0:
            logger.warning(
                "AutoTagger: Failed to decode embedding for %s; skipping",
                media.path,
            )
            media.embeddings_created = False
            if not settings.processors.image_embedding_processor_active:
                media.ran_auto_tagging = True
            session.add(media)
            safe_commit(session)
            return True
        for tag, tag_vector in self.tag_map.items():
            similarity_score = np.dot(media_embedding, tag_vector)
            if similarity_score > 0.2:
                tag_obj = get_or_create_tag(tag, session)
                attach_tag_to_media(
                    media.id, tag_obj.id, session, score=similarity_score
                )
        media.ran_auto_tagging = True
        safe_commit(session)
        return True

    def get_results(self, media_id: int, session: Session):
        """
        Return something JSON‑serializable about this media.
        Default: empty dict.
        Override in subclasses to return meaningful data.
        """
        return session.exec(
            select(Media.tags).where(Media.id == media_id)
        ).all()
