import gc

import cv2
import numpy as np
from PIL import Image, ImageOps
from PIL.ImageFile import ImageFile
from cv2.typing import MatLike
from sqlmodel import col, select

from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Media, Scene
from app.processors.base import MediaProcessor

# Downscale to this before computing Laplacian — enough for blur detection, much faster.
_MAX_SIZE = 512
# Cap the number of video frames evaluated per media item.
_MAX_SCENES = 5

# Shared CLAHE instance — clipLimit prevents noise amplification in flat regions.
_CLAHE = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))


def _laplacian_score(arr: np.ndarray) -> float:
    """Compute Laplacian variance on a grayscale or RGB uint8 array.

    CLAHE normalises local contrast before the Laplacian so that dark or
    low-key images score based on edge sharpness, not absolute brightness.
    Without this, a dark-but-sharp photo scores as low as a blurry one.
    """
    h, w = arr.shape[:2]
    if max(h, w) > _MAX_SIZE:
        scale = _MAX_SIZE / max(h, w)
        arr = cv2.resize(arr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    if arr.ndim == 3:
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    else:
        gray = arr
    gray = _CLAHE.apply(gray)
    return float(cv2.Laplacian(gray, cv2.CV_32F).var())


class BlurProcessor(MediaProcessor):
    name = "blur"
    order = 5  # before embedding/faces, no heavy models needed

    def process(
        self,
        media: Media,
        session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ) -> bool | None:
        if session.exec(
            select(Media).where(
                Media.id == media.id,
                Media.laplacian_score.isnot(None),
            )
        ).first():
            return True

        scores: list[float] = []
        # Sample at most _MAX_SCENES frames for long videos.
        sampled = list(scenes)
        if len(sampled) > _MAX_SCENES:
            step = len(sampled) // _MAX_SCENES
            sampled = sampled[::step][:_MAX_SCENES]

        for scene in sampled:
            try:
                if isinstance(scene, tuple):
                    # video frame — already an RGB ndarray
                    arr: np.ndarray = scene[1]
                elif isinstance(scene, Scene):
                    # stored scene thumbnail on disk — open directly as gray
                    arr = np.array(
                        Image.open(settings.general.thumb_dir / scene.thumbnail_path).convert("L")
                    )
                else:
                    # PIL ImageFile — convert directly to gray, skip RGB round-trip
                    arr = np.array(ImageOps.exif_transpose(scene).convert("L"))
            except OSError:
                continue

            if arr is None or arr.size == 0:
                continue

            scores.append(_laplacian_score(arr))

        if not scores:
            media.laplacian_score = -1.0
            session.add(media)
            return True

        media.laplacian_score = float(np.median(scores))
        session.add(media)
        safe_commit(session)
        return True

    def load_model(self):
        if settings.processors.blur_processor_active:
            self.active = True

    def unload(self):
        gc.collect()

    def get_results(self, media_id: int, session):
        result = session.exec(select(Media).where(Media.id == media_id)).first()
        if result and result.laplacian_score is not None:
            return {"laplacian_score": result.laplacian_score}
        return {}

    def get_pending_condition(self):
        return col(Media.laplacian_score).is_(None)

    def reset_for_media(self, media: Media, session) -> None:
        media.laplacian_score = None
        session.add(media)
