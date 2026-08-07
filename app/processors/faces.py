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
from app.models import ExifData, Face, Media, Person, Scene
from app.processors.base import MediaProcessor
from app.utils import (
    auto_select_profile_face,
    get_thumb_folder,
    to_posix_str,
    vector_to_blob,
)


class FaceProcessor(MediaProcessor):
    name = "faces"
    order = 20

    # SCRFD's anchors expect background context around a face; when a face
    # fills most of the frame it can fail to fire at all (see the backfill
    # quality-rescoring fix in app/tasks/backfill.py, which measured
    # 0/60 -> 60/60 detections after padding tight face crops by 40%). Retry
    # with padding whenever detection finds nothing, or when a detected face
    # dominates the frame enough that other faces sharing the shot could be
    # suffering the same failure.
    PADDED_RETRY_PAD_PCT = 0.3
    PADDED_RETRY_AREA_FRACTION = 0.3

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

    def _needs_padded_retry(self, faces: list, frame_h: int, frame_w: int) -> bool:
        if not faces:
            return True
        frame_area = frame_h * frame_w
        if frame_area <= 0:
            return False
        for f in faces:
            x1, y1, x2, y2 = f.bbox
            area = max(0.0, float(x2) - float(x1)) * max(0.0, float(y2) - float(y1))
            if area / frame_area > self.PADDED_RETRY_AREA_FRACTION:
                return True
        return False

    def _detect_with_padding_fallback(self, scene_det: np.ndarray, media_path) -> list:
        """Re-run detection on a gray-padded copy of the frame and translate
        the resulting boxes/keypoints back into scene_det's coordinate space."""
        h, w = scene_det.shape[:2]
        pad_x = int(w * self.PADDED_RETRY_PAD_PCT)
        pad_y = int(h * self.PADDED_RETRY_PAD_PCT)
        padded = cv2.copyMakeBorder(
            scene_det, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )
        try:
            retried = self.model.get(padded)
        except Exception as e:
            logger.exception(
                "Padded-retry detection failed on media %s: %s", media_path, e
            )
            return []
        offset_bbox = np.array([pad_x, pad_y, pad_x, pad_y], dtype=np.float32)
        offset_kps = np.array([pad_x, pad_y], dtype=np.float32)
        for f in retried:
            f.bbox = np.asarray(f.bbox, dtype=np.float32) - offset_bbox
            if f.kps is not None:
                f.kps = np.asarray(f.kps, dtype=np.float32) - offset_kps
        return retried

    @staticmethod
    def _estimate_frontality(kps) -> float | None:
        """
        Estimate how frontal a face is from the 5-point detector keypoints
        (left eye, right eye, nose, mouth corners). Projects the nose tip onto
        the eye-to-eye line: a frontal face lands near the midpoint (t=0.5),
        a hard profile lands near/beyond an eye. Returns 1.0 (frontal) to
        0.0 (extreme profile), or None if keypoints are unusable.
        """
        if kps is None:
            return None
        pts = np.asarray(kps, dtype=np.float64)
        if pts.ndim != 2 or pts.shape[0] < 3 or pts.shape[1] < 2:
            return None
        left_eye, right_eye, nose = pts[0], pts[1], pts[2]
        eye_vec = right_eye - left_eye
        denom = float(eye_vec @ eye_vec)
        if not np.isfinite(denom) or denom <= 1e-6:
            return 0.0
        t = float((nose - left_eye) @ eye_vec) / denom
        if not np.isfinite(t):
            return None
        return float(np.clip(1.0 - 2.0 * abs(t - 0.5), 0.0, 1.0))

    @staticmethod
    def _stored_bbox_to_xyxy(bbox: list[int] | None) -> list[int] | None:
        if not bbox or len(bbox) < 4:
            return None
        x, y, w, h = map(int, bbox[:4])
        if w <= 0 or h <= 0:
            return None
        return [x, y, x + w, y + h]

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
        self, faces: list, scene: MatLike, media: Media, timestamp: float | None = None
    ) -> list[tuple[Face, np.ndarray]]:
        face_entries: list[tuple[Face, np.ndarray]] = []
        min_confidence = float(
            settings.face_recognition.face_recognition_min_confidence
        )
        for i, f in enumerate(faces):
            det_score = getattr(f, "det_score", None)
            if det_score is not None:
                det_score = float(det_score)
                if det_score < min_confidence:
                    continue
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
                timestamp=timestamp,
                det_score=det_score,
                frontality=self._estimate_frontality(getattr(f, "kps", None)),
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
        dedupe_iou_threshold = settings.face_recognition.rerun_face_iou_dedupe_threshold
        existing_bboxes = [
            parsed
            for parsed in (
                self._stored_bbox_to_xyxy(face.bbox)
                for face in session.exec(
                    select(Face).where(Face.media_id == media.id)
                ).all()
            )
            if parsed is not None
        ]
        max_video_frames = int(
            getattr(
                settings.face_recognition, "face_detection_max_video_frames", 0
            )
            or 0
        )
        if (
            media.duration is not None
            and max_video_frames > 0
            and len(scenes) > max_video_frames
        ):
            # Sample frames evenly across the video — faces recur between
            # scenes, so scanning every scene frame adds little coverage.
            if max_video_frames == 1:
                indices = [0]
            else:
                indices = sorted(
                    {
                        int(
                            round(
                                i
                                * (len(scenes) - 1)
                                / (max_video_frames - 1)
                            )
                        )
                        for i in range(max_video_frames)
                    }
                )
            logger.debug(
                "Face detection: sampling %d of %d scene frames for %s",
                len(indices),
                len(scenes),
                media.path,
            )
            scenes = [scenes[i] for i in indices]

        for scene in tqdm(scenes):
            scene_timestamp: float | None = None
            try:
                if isinstance(scene, tuple):
                    # scenes from videos arrive as (Scene, RGB ndarray)
                    scene_obj = scene[0]
                    try:
                        raw_ts = scene_obj.start_time
                        get_secs = getattr(raw_ts, "get_seconds", None)
                        scene_timestamp = float(get_secs()) if get_secs is not None else float(raw_ts)
                    except (TypeError, AttributeError, ValueError):
                        scene_timestamp = None
                    scene = scene[1]
                elif isinstance(scene, Scene):
                    try:
                        scene_timestamp = float(scene.start_time)
                    except (TypeError, ValueError, AttributeError):
                        scene_timestamp = None
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

            det_h, det_w = scene_det.shape[:2]
            if self._needs_padded_retry(faces, det_h, det_w):
                retried_faces = self._detect_with_padding_fallback(
                    scene_det, media.path
                )
                if retried_faces:
                    merged_faces = self._merge_faces(faces, retried_faces)
                    if len(merged_faces) > len(faces):
                        logger.debug(
                            "Padded retry found %d additional face(s) in %s",
                            len(merged_faces) - len(faces),
                            media.path,
                        )
                    faces = merged_faces

            face_entries = self._parse_faces(faces, scene_det, media, timestamp=scene_timestamp)
            if existing_bboxes and face_entries:
                filtered_face_entries: list[tuple[Face, np.ndarray]] = []
                for face_obj, embedding_vec in face_entries:
                    candidate_bbox = self._stored_bbox_to_xyxy(face_obj.bbox)
                    if candidate_bbox is None:
                        continue
                    if any(
                        self._iou(existing_bbox, candidate_bbox)
                        > dedupe_iou_threshold
                        for existing_bbox in existing_bboxes
                    ):
                        continue
                    filtered_face_entries.append((face_obj, embedding_vec))
                    existing_bboxes.append(candidate_bbox)
                face_entries = filtered_face_entries

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
        if getattr(self, "model", None) is not None:
            return
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
        self.model.prepare(
            ctx_id=self._ctx_id,
            det_size=(640, 640),
            det_thresh=float(
                settings.face_recognition.face_recognition_min_confidence
            ),
        )

    def unload(self):
        pass  # Keep InsightFace warm to avoid reload cost on the next run

    def get_results(self, media_id: int, session):
        return session.exec(
            select(ExifData).where(ExifData.media_id == media_id)
        ).first()

    def get_pending_condition(self):
        return Media.faces_extracted == False  # noqa: E712

    def reset_for_media(self, media: Media, session) -> None:
        orphan_faces = session.exec(
            select(Face).where(
                Face.media_id == media.id,
                Face.person_id.is_(None),
            )
        ).all()

        if orphan_faces:
            face_ids = [face.id for face in orphan_faces]
            profile_owner_ids = session.exec(
                select(Person.id).where(Person.profile_face_id.in_(face_ids))
            ).all()

            for face in orphan_faces:
                session.exec(
                    text(
                        """
                        DELETE FROM face_embeddings
                        WHERE face_id=:f_id
                        """
                    ).bindparams(f_id=face.id)
                )
                session.delete(face)
                if not face.thumbnail_path:
                    continue
                thumb = settings.general.thumb_dir / face.thumbnail_path
                try:
                    thumb.unlink()
                except FileNotFoundError:
                    pass
                except OSError as exc:
                    logger.debug(
                        "Failed to remove face thumbnail %s: %s",
                        thumb,
                        exc,
                    )

            for person_id in profile_owner_ids:
                auto_select_profile_face(session, person_id)

        media.faces_extracted = False
        session.add(media)
