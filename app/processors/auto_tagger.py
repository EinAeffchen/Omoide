import os

import numpy as np
import torch
from cv2.typing import MatLike
from PIL.ImageFile import ImageFile
from sqlmodel import Session, select, text

import app.database as db
from app.api.tags import attach_tag_to_media, get_or_create_tag
from app.config import get_clip_bundle, settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, Scene
from app.processors.base import MediaProcessor
from app.tagging import (
    CALIBRATION_SAMPLE_SIZE,
    SIMILARITY_THRESHOLD,
    build_tag_vector_map,
    calibrate_tag_thresholds,
    sanitize_custom_tag_list,
)
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
            self._tag_names: list[str] = []
            self._tag_matrix: np.ndarray | None = None
            self._tag_thresholds: np.ndarray | None = None
            return

        # Use shared CLIP and keep it warm to avoid re-init leaks
        self._clip_model, _, self._tokenizer = get_clip_bundle()
        self.tag_map = build_tag_vector_map(tags)
        # Pre-stack vectors into a matrix for vectorized similarity scoring
        self._tag_names = list(self.tag_map.keys())
        self._tag_matrix = np.stack(list(self.tag_map.values())) if self._tag_names else None
        self._tag_thresholds = self._calibrate_thresholds()

    def unload(self):
        """Used to load models into memory before use"""
        self.tags = []
        self.tag_map = {}
        self._tag_names = []
        self._tag_matrix = None
        self._tag_thresholds = None

    def _calibrate_thresholds(self) -> np.ndarray | None:
        """Sample existing embeddings to derive a per-tag similarity cutoff.

        Runs once per load_model() (i.e. once per processing run), so
        thresholds stay current as the library grows.
        """
        if self._tag_matrix is None:
            return None

        with Session(db.engine) as session:
            rows = session.exec(
                text(
                    """
                    SELECT me.embedding AS embedding
                    FROM media AS m
                    JOIN media_embeddings AS me ON me.media_id = m.id
                    WHERE m.missing_since IS NULL
                    ORDER BY RANDOM()
                    LIMIT :limit
                    """
                ).bindparams(limit=CALIBRATION_SAMPLE_SIZE)
            ).all()

        sample_vectors = [
            vec
            for row in rows
            if (vec := vector_from_stored(row[0])) is not None and vec.size > 0
        ]
        sample_matrix = (
            np.stack(sample_vectors).astype(np.float32, copy=False)
            if sample_vectors
            else np.empty((0, self._tag_matrix.shape[1]), dtype=np.float32)
        )
        return calibrate_tag_thresholds(self._tag_matrix, sample_matrix)

    def _tag_to_vector(self, tag) -> np.ndarray:
        tokenized_text = self._tokenizer([tag])
        try:
            device = next(self._clip_model.parameters()).device
        except StopIteration:
            device = torch.device("cpu")
        if hasattr(tokenized_text, "to"):
            tokenized_text = tokenized_text.to(device)
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
        tag_matrix = getattr(self, "_tag_matrix", None)
        tag_names = getattr(self, "_tag_names", None)
        tag_thresholds = getattr(self, "_tag_thresholds", None)
        if tag_matrix is not None and tag_names:
            scores = tag_matrix @ media_embedding  # single matmul: (N,)
            thresholds = (
                tag_thresholds
                if tag_thresholds is not None
                else np.full(len(tag_names), SIMILARITY_THRESHOLD, dtype=np.float32)
            )
            for tag, score, threshold in zip(tag_names, scores, thresholds):
                if score > threshold:
                    tag_obj = get_or_create_tag(tag, session)
                    attach_tag_to_media(
                        media.id, tag_obj.id, session, score=float(score)
                    )
        else:
            for tag, tag_vector in self.tag_map.items():
                similarity_score = float(np.dot(media_embedding, tag_vector))
                if similarity_score > SIMILARITY_THRESHOLD:
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

    def get_pending_condition(self):
        return Media.ran_auto_tagging == False  # noqa: E712

    def reset_for_media(self, media: Media, session: Session) -> None:
        media.ran_auto_tagging = False
        session.add(media)
