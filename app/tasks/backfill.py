from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import cv2
import ffmpeg
import numpy as np
from sqlmodel import Session, col, select

import app.database as db
from app.config import settings
from app.database import safe_commit
from app.logger import logger
from app.models import Face, Media, ProcessingTask, Scene, Status
from app.processor_registry import load_processors, processors
from app.tasks.state import clear_task_progress, set_task_progress

__all__ = ["run_backfill_face_timestamps"]


def _iou(a: list[int], b: list[int]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    if inter == 0:
        return 0.0
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _stored_bbox_to_xyxy(bbox: list[int] | None) -> list[int] | None:
    if not bbox or len(bbox) < 4:
        return None
    x, y, w, h = map(int, bbox[:4])
    if w <= 0 or h <= 0:
        return None
    return [x, y, x + w, y + h]


def _extract_frame_rgb(media_path: str, timestamp: float) -> np.ndarray | None:
    """Extract a single video frame at the given timestamp as an RGB ndarray."""
    try:
        out, _ = (
            ffmpeg.input(media_path, ss=timestamp)
            .output("pipe:", vframes=1, format="image2", vcodec="mjpeg")
            .run(capture_stdout=True, quiet=True)
        )
        arr = np.frombuffer(out, np.uint8)
        frame_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame_bgr is None:
            return None
        return cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    except Exception as exc:
        logger.debug("Frame extraction failed at %.2fs from %s: %s", timestamp, media_path, exc)
        return None


def run_backfill_face_timestamps(task_id: str) -> None:
    """Backfill timestamp=NULL faces in videos by re-detecting on the original frames."""
    if not processors:
        load_processors()

    face_proc = next((p for p in processors if p.name == "faces"), None)
    if face_proc is None:
        logger.error("FaceProcessor not found; cannot backfill timestamps.")
        return

    face_proc.load_model()

    with Session(db.engine) as session:
        task = session.get(ProcessingTask, task_id)
        if not task:
            logger.error("Task %s not found.", task_id)
            return

        task.status = Status.RUNNING
        task.started_at = datetime.now(timezone.utc)
        session.add(task)
        safe_commit(session)

        set_task_progress(task_id, current_step="preparing", current_item=None)

        # Videos with extracted scenes that still have faces with no timestamp
        media_ids: list[int] = session.exec(
            select(Face.media_id)
            .join(Media, Media.id == Face.media_id)
            .where(
                Face.timestamp.is_(None),
                Media.duration.isnot(None),
                Media.extracted_scenes.is_(True),
                col(Media.missing_since).is_(None),
            )
            .distinct()
        ).all()

        task.total = len(media_ids)
        session.add(task)
        safe_commit(session)

        logger.info("Backfilling timestamps for %d video(s).", len(media_ids))

        for idx, media_id in enumerate(media_ids):
            if session.get(ProcessingTask, task_id).status == Status.CANCELLED:
                break

            media = session.get(Media, media_id)
            if not media or not media.path or not Path(media.path).exists():
                task.processed = idx + 1
                session.add(task)
                safe_commit(session)
                continue

            set_task_progress(
                task_id,
                current_item=os.fspath(media.path),
                current_step="backfilling",
            )

            # All faces with null timestamps for this media
            null_faces = session.exec(
                select(Face).where(
                    Face.media_id == media_id,
                    Face.timestamp.is_(None),
                )
            ).all()

            if not null_faces:
                task.processed = idx + 1
                session.add(task)
                safe_commit(session)
                continue

            # Build list of (xyxy bbox in det space, Face) for matching
            null_face_bboxes: list[tuple[list[int], Face]] = []
            for face in null_faces:
                xyxy = _stored_bbox_to_xyxy(face.bbox)
                if xyxy:
                    null_face_bboxes.append((xyxy, face))

            scenes = session.exec(
                select(Scene)
                .where(Scene.media_id == media_id)
                .order_by(Scene.start_time)
            ).all()

            updated_ids: set[int] = set()
            MAX_DET_DIM = 1280

            for scene in scenes:
                # Only unmatched faces still need timestamps
                remaining = [(bb, f) for bb, f in null_face_bboxes if f.id not in updated_ids]
                if not remaining:
                    break

                frame = _extract_frame_rgb(media.path, float(scene.start_time))
                if frame is None:
                    continue

                h_orig, w_orig = frame.shape[:2]
                if max(h_orig, w_orig) > MAX_DET_DIM:
                    s = MAX_DET_DIM / max(h_orig, w_orig)
                    frame_det = cv2.resize(
                        frame,
                        (int(w_orig * s), int(h_orig * s)),
                        interpolation=cv2.INTER_AREA,
                    )
                else:
                    frame_det = frame

                try:
                    detections = face_proc.model.get(frame_det)
                except Exception as exc:
                    logger.debug("Detection failed on frame: %s", exc)
                    continue

                scene_ts = float(scene.start_time)

                for det in detections:
                    x1, y1, x2, y2 = map(int, det.bbox)
                    det_xyxy = [x1, y1, x2, y2]

                    best_iou = 0.0
                    best_face: Face | None = None
                    for existing_xyxy, face in remaining:
                        if face.id in updated_ids:
                            continue
                        iou = _iou(det_xyxy, existing_xyxy)
                        if iou > best_iou:
                            best_iou = iou
                            best_face = face

                    if best_face and best_iou > 0.3:
                        best_face.timestamp = scene_ts
                        session.add(best_face)
                        updated_ids.add(best_face.id)

            # Faces that could not be matched via re-detection get a sentinel of -1.0
            # so they no longer appear as NULL in subsequent backfill runs without being
            # incorrectly placed in any scene (all scene filters require timestamp >= 0).
            still_unmatched = [f for _, f in null_face_bboxes if f.id not in updated_ids]
            for face in still_unmatched:
                face.timestamp = -1.0
                session.add(face)

            safe_commit(session)
            logger.info(
                "Media %d: matched %d/%d null-timestamp face(s) (%d marked unresolvable).",
                media_id,
                len(updated_ids),
                len(null_faces),
                len(still_unmatched),
            )

            task.processed = idx + 1
            session.add(task)
            safe_commit(session)

        session.refresh(task)
        task.status = (
            Status.CANCELLED if task.status == Status.CANCELLED else Status.COMPLETED
        )
        task.finished_at = datetime.now(timezone.utc)
        session.add(task)
        safe_commit(session)
        clear_task_progress(task_id)
