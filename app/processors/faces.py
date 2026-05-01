import gc
import os
import time
from pathlib import Path

import cv2
import numpy as np
from cv2.typing import MatLike
from PIL import Image, ImageOps
from PIL.ImageFile import ImageFile
from sqlmodel import select, text
from tqdm import tqdm

from app.accelerators import resolve_onnx_providers
from app.api.media import delete_media_record
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import ExifData, Face, Media, Scene
from app.processors.base import MediaProcessor
from app.utils import get_thumb_folder, to_posix_str, vector_to_blob


class FaceProcessor(MediaProcessor):
    name = "faces"
    order = 20

    @staticmethod
    def _iou(a: list, b: list) -> float:
        ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
        ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        if inter == 0:
            return 0.0
        area_a = (a[2] - a[0]) * (a[3] - a[1])
        area_b = (b[2] - b[0]) * (b[3] - b[1])
        union = area_a + area_b - inter
        return inter / union if union > 0 else 0.0

    def _merge_faces(self, base: list, extra: list, iou_threshold: float = 0.45) -> list:
        """Add faces from extra that don't substantially overlap any face already in base."""
        merged = list(base)
        for fb in extra:
            if not any(self._iou(fa.bbox, fb.bbox) > iou_threshold for fa in merged):
                merged.append(fb)
        return merged

    def _crop_with_margin(self, img: np.ndarray, bbox: list[int], pad_pct: float = 0.2):
        """
        img: HxWx3 BGR or RGB array
        bbox: [x, y, w, h]
        pad_pct: fraction of width/height to pad on each side
        """
        h_img, w_img = img.shape[:2]
        x, y, w, h = bbox

        # compute pad in pixels
        pad_x = int(w * pad_pct)
        pad_y = int(h * pad_pct)

        # apply, but clamp to image edges
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(w_img, x + w + pad_x)
        y2 = min(h_img, y + h + pad_y)

        return img[y1:y2, x1:x2]

    def _parse_faces(
        self, faces: list, scene: MatLike, media: Media
    ) -> list[tuple[Face, np.ndarray]]:
        face_entries: list[tuple[Face, np.ndarray]] = []
        for i, f in enumerate(faces):
            x1, y1, x2, y2 = map(int, f.bbox)
            crop = self._crop_with_margin(
                scene, [x1, y1, x2 - x1, y2 - y1], pad_pct=0.2
            )
            h, w = crop.shape[:2]
            if h * w < settings.face_recognition.face_recognition_min_face_pixels:
                continue

            if settings.face_recognition.face_sharpness_filter_enabled:
                gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
                if cv2.Laplacian(gray, cv2.CV_64F).var() < settings.face_recognition.face_sharpness_min_variance:
                    continue

            ts = int(time.time() * 1000)
            name = f"{Path(media.path).stem}_ins_{i}_{ts}.jpg"
            thumb_dir = get_thumb_folder(settings.general.thumb_dir / "faces")
            thumb_file = thumb_dir / name
            pil_img = Image.fromarray(crop)
            pil_img.thumbnail((320, -1), Image.LANCZOS)
            pil_img.save(
                thumb_file,
                format="JPEG",
                quality=85,
                optimize=True,
                progressive=True,
            )
            vec = np.array(f.embedding, dtype=np.float32)
            norm = np.linalg.norm(vec)
            if norm > 0:
                vec /= norm
            face = Face(
                media=media,
                thumbnail_path=to_posix_str(
                    thumb_file.relative_to(settings.general.thumb_dir)
                ),
                bbox=[x1, y1, x2 - x1, y2 - y1],
            )
            face_entries.append((face, vec))
        return face_entries

    def process(
        self,
        media: Media,
        session,
        scenes: list[tuple[Scene, MatLike]] | list[ImageFile] | list[Scene],
    ):
        # 1) skip if already extracted
        if session.exec(
            select(Media).where(
                Media.id == media.id,
                Media.faces_extracted.is_(True),
            )
        ).first():
            return True
        for scene in tqdm(scenes):
            try:
                if isinstance(scene, tuple):
                    # scenes from videos arrive as RGB ndarray already
                    scene = scene[1]
                elif isinstance(scene, Scene):
                    # stored scene thumbnails on disk → open as RGB
                    scene = Image.open(
                        settings.general.thumb_dir / scene.thumbnail_path
                    )
                    scene = ImageOps.exif_transpose(scene)
                    scene = np.array(scene.convert("RGB"))
                else:
                    # plain PIL.Image -> ensure correct orientation + RGB
                    scene = ImageOps.exif_transpose(scene)
                    scene = np.array(scene.convert("RGB"))
            except OSError:
                logger.warning("FAILED ON %s", media.path)
                delete_media_record(media.id, session)
                return False

            # Guard against invalid/empty frames
            if scene is None:
                logger.warning("Skipping empty scene frame for media: %s", media.path)
                continue
            if not isinstance(scene, np.ndarray) or scene.size == 0:
                logger.warning("Skipping invalid scene array for media: %s", media.path)
                continue

            h_orig, w_orig = scene.shape[:2]

            # Pre-scale for memory/compute efficiency. Note: this does NOT improve
            # detection sensitivity — the minimum detectable face size in the original
            # equals 16px × (original_size / det_size) regardless of pre-scaling.
            # We still do it to avoid feeding 4032×3024 images into ONNX directly.
            MAX_DET_DIM = 1280
            if max(h_orig, w_orig) > MAX_DET_DIM:
                s = MAX_DET_DIM / max(h_orig, w_orig)
                scene_det = cv2.resize(
                    scene,
                    (int(w_orig * s), int(h_orig * s)),
                    interpolation=cv2.INTER_AREA,
                )
            else:
                scene_det = scene

            try:
                faces = self.model.get(scene_det)
            except Exception as e:
                logger.exception(
                    "InsightFace failed on media %s scene: %s", media.path, e
                )
                continue

            face_entries = self._parse_faces(faces, scene_det, media)

            if not face_entries:
                continue

            session.add_all([face for face, _ in face_entries])
            session.flush()

            for face_obj, embedding_vec in face_entries:
                blob = vector_to_blob(embedding_vec)
                if blob is None:
                    logger.error(
                        "FaceProcessor: failed to encode embedding for face %s in"
                        " media %s",
                        face_obj.id,
                        media.path,
                    )
                    continue
                sql = text(
                    """
                        INSERT OR REPLACE INTO face_embeddings(face_id, person_id, embedding)
                        VALUES (:id, -1, :emb)
                        """
                ).bindparams(id=face_obj.id, emb=blob)
                session.exec(sql)
        media.faces_extracted = True
        session.add(media)
        safe_commit(session)
        return True

    def load_model(self):
        if settings.general.enable_people and settings.processors.face_processor_active:
            self.active = True
        # Reduce ORT's long-lived CPU memory arenas so memory is released faster
        os.environ.setdefault("ORT_DISABLE_MEMORY_ARENA", "1")
        # Import InsightFace lazily to speed up application startup
        from insightface.app import FaceAnalysis

        prefer_gpu = getattr(settings.processors, "prefer_gpu", True)
        providers, uses_gpu = resolve_onnx_providers(prefer_gpu)
        self._ctx_id = 0 if uses_gpu else -1
        self.model = FaceAnalysis(
            "buffalo_l",
            root=str(settings.general.models_dir),
            # Avoid 3D landmark module which can error on some frames.
            allowed_modules=["detection", "landmark_2d_106", "recognition"],
            providers=providers,
        )
        self.model.prepare(ctx_id=self._ctx_id, det_size=(640, 640))

    def unload(self):
        try:
            if getattr(self, "model", None) is not None:
                # Drop references and encourage release of ORT allocations
                self.model = None
        finally:
            gc.collect()

    def get_results(self, media_id: int, session):
        return session.exec(
            select(ExifData).where(ExifData.media_id == media_id)
        ).first()

    def get_pending_condition(self):
        return Media.faces_extracted == False  # noqa: E712

    def reset_for_media(self, media: Media, session) -> None:
        media.faces_extracted = False
        session.add(media)
