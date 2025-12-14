from fastapi import HTTPException
from sqlmodel import Session, select, delete, update
import app.database as db
from app.logger import logger
from app.models import (
    Media,
    ProcessingTask,
    DuplicateGroup,
    DuplicateMedia,
    Blacklist,
    DuplicateIgnore,
)
from sqlalchemy import func
from datetime import datetime, timezone
from app.config import settings, DuplicateHandlingRule, DuplicateKeepRule
from app.utils import delete_file, delete_record
import imagehash

class UnionFind:
    def __init__(self, elements):
        self.parent = {el: el for el in elements}

    def find(self, i):
        if self.parent[i] == i:
            return i
        self.parent[i] = self.find(self.parent[i])
        return self.parent[i]

    def union(self, i, j):
        root_i = self.find(i)
        root_j = self.find(j)
        if root_i != root_j:
            self.parent[root_j] = root_i


class DuplicateProcessor:
    name = "duplicate_processor"
    def __init__(
        self, task_id: str, threshold: int = 4
    ):  # Note: threshold is now an integer Hamming distance
        self.task_id = task_id
        self.threshold = threshold  # A threshold of 0-5 is common for pHash

    def _update_task_progress_and_check_status(
        self, session: Session, processed: int, total: int
    ) -> bool | None:
        task = session.get(ProcessingTask, self.task_id)
        if task:
            task.processed = processed
            task.total = total
            session.add(task)
            session.commit()
            session.refresh(task)
            if task.status == "cancelled":
                return True

    def _update_task_status(self, session: Session, status: str):
        task = session.get(ProcessingTask, self.task_id)
        if task:
            task.status = status
            task.started_at = datetime.now(timezone.utc)
            if status == "completed" or status == "failed":
                task.finished_at = datetime.now(timezone.utc)
            session.add(task)
            session.commit()
            session.refresh(task)

    def _media_resolution(self, media: Media) -> int:
        width = media.width or 0
        height = media.height or 0
        return int(width) * int(height)

    def _media_timestamp(self, media: Media) -> datetime:
        for candidate in (media.created_at, media.inserted_at):
            if isinstance(candidate, datetime):
                if candidate.tzinfo is not None:
                    return candidate.replace(tzinfo=None)
                return candidate
        return datetime.min

    def _select_master_media(self, media_items: list[Media]) -> Media | None:
        if not media_items:
            return None
        rule = settings.duplicates.duplicate_auto_keep_rule
        if rule == DuplicateKeepRule.BIGGEST:
            return max(
                media_items,
                key=lambda m: ((m.size or 0), m.id),
            )
        if rule == DuplicateKeepRule.SMALLEST:
            return min(
                media_items,
                key=lambda m: ((m.size or 0), m.id),
            )
        if rule == DuplicateKeepRule.HIGHEST_RES:
            return max(
                media_items,
                key=lambda m: (self._media_resolution(m), m.id),
            )
        if rule == DuplicateKeepRule.LOWEST_RES:
            return min(
                media_items,
                key=lambda m: (self._media_resolution(m), m.id),
            )
        if rule == DuplicateKeepRule.NEWEST:
            return max(
                media_items,
                key=lambda m: (self._media_timestamp(m), m.id),
            )
        # Default to OLDEST
        return min(
            media_items,
            key=lambda m: (self._media_timestamp(m), m.id),
        )

    def _apply_duplicate_action(self, session: Session, media: Media) -> None:
        rule = settings.duplicates.duplicate_auto_handling
        if rule is DuplicateHandlingRule.REMOVE:
            logger.info("Auto-removing duplicate record id=%s path=%s", media.id, media.path)
            delete_record(media.id, session)
            return
        if rule is DuplicateHandlingRule.BLACKLIST:
            if media.path:
                existing = session.exec(
                    select(Blacklist).where(Blacklist.path == media.path)
                ).first()
                if not existing:
                    session.add(Blacklist(path=media.path))
            logger.info("Auto-blacklisting duplicate record id=%s path=%s", media.id, media.path)
            delete_record(media.id, session)
            return
        if rule is DuplicateHandlingRule.DELETE:
            logger.info("Auto-deleting duplicate file id=%s path=%s", media.id, media.path)
            try:
                delete_file(session, media.id)
            except HTTPException as exc:
                if exc.status_code == 403:
                    logger.warning(
                        "Skip deleting duplicate id=%s because path is read-only: %s",
                        media.id,
                        exc.detail,
                    )
                    return
                raise
            return

    def _auto_resolve_media_items(
        self, session: Session, media_items: list[Media]
    ) -> None:
        if (
            settings.duplicates.duplicate_auto_handling
            is DuplicateHandlingRule.KEEP
        ):
            return
        unique_media = {media.id: media for media in media_items if media is not None}
        if len(unique_media) <= 1:
            return
        master = self._select_master_media(list(unique_media.values()))
        if master is None:
            return
        processed = 0
        for media_id, media in unique_media.items():
            if media_id == master.id:
                continue
            self._apply_duplicate_action(session, media)
            processed += 1
        logger.info(
            "Duplicate auto-handling applied rule=%s (kept id=%s, processed=%s others)",
            settings.duplicates.duplicate_auto_handling.value,
            master.id if master else None,
            processed,
        )

    def _auto_resolve_duplicates_by_ids(
        self, session: Session, media_ids: list[int]
    ) -> None:
        if len(media_ids) <= 1:
            return
        media_items = session.exec(
            select(Media).where(Media.id.in_(media_ids))
        ).all()
        if len(media_items) <= 1:
            return
        self._auto_resolve_media_items(session, media_items)

    def _pair_key(self, media_id_a: int, media_id_b: int) -> tuple[int, int]:
        if media_id_a <= media_id_b:
            return media_id_a, media_id_b
        return media_id_b, media_id_a

    def _load_ignored_pairs(self, session: Session) -> set[tuple[int, int]]:
        rows = session.exec(
            select(DuplicateIgnore.media_id_a, DuplicateIgnore.media_id_b)
        ).all()
        return {(row[0], row[1]) for row in rows}

    def _partition_non_ignored_groups(
        self, media_ids: list[int], ignored_pairs: set[tuple[int, int]]
    ) -> list[list[int]]:
        if len(media_ids) < 2:
            return []

        uf = UnionFind(media_ids)
        ordered_ids = list(media_ids)
        for idx in range(len(ordered_ids)):
            media_a = ordered_ids[idx]
            for jdx in range(idx + 1, len(ordered_ids)):
                media_b = ordered_ids[jdx]
                if self._pair_key(media_a, media_b) in ignored_pairs:
                    continue
                uf.union(media_a, media_b)

        cluster_map: dict[int, list[int]] = {}
        for media_id in ordered_ids:
            root = uf.find(media_id)
            cluster_map.setdefault(root, []).append(media_id)

        return [
            members for members in cluster_map.values() if len(members) > 1
        ]

    def process(self):
        with Session(db.engine) as session:
            self._update_task_status(session, "running")
            logger.info(
                f"Starting pHash duplicate detection task {self.task_id}"
            )

            try:
                ignored_pairs = self._load_ignored_pairs(session)
                progress_total = 0
                progress_processed = 0

                # --- Phase 1: Group by IDENTICAL Hashes ---

                # Find all hashes that appear more than once
                stmt = (
                    select(Media.phash, func.count(Media.id).label("count"))
                    .where(
                        Media.phash.is_not(None),
                        func.length(Media.phash) > 0,
                    )
                    .group_by(Media.phash)
                    .having(func.count(Media.id) > 1)
                )
                duplicate_hashes = session.exec(stmt).all()
                progress_total += len(duplicate_hashes)

                if progress_total:
                    if self._update_task_progress_and_check_status(
                        session, progress_processed, progress_total
                    ):
                        logger.info(
                            "Duplicate detection task %s cancelled before processing identical hashes",
                            self.task_id,
                        )
                        return

                # For each duplicate hash, find all associated media
                for phash, count in duplicate_hashes:
                    media_with_same_hash_stmt = select(Media).where(
                        Media.phash == phash
                    )
                    media_items = session.exec(media_with_same_hash_stmt).all()
                    media_by_id = {m.id: m for m in media_items}
                    image_ids = [
                        m.id for m in media_items if m.duration is None
                    ]
                    video_ids = [
                        m.id for m in media_items if m.duration is not None
                    ]

                    image_groups = self._partition_non_ignored_groups(
                        image_ids, ignored_pairs
                    )
                    video_groups = self._partition_non_ignored_groups(
                        video_ids, ignored_pairs
                    )

                    if settings.duplicates.duplicate_auto_handling is DuplicateHandlingRule.KEEP:
                        for group_ids in image_groups:
                            self._create_or_update_group(session, group_ids)
                        for group_ids in video_groups:
                            self._create_or_update_group(session, group_ids)
                    else:
                        for group_ids in image_groups:
                            image_media = [
                                media_by_id[mid] for mid in group_ids
                            ]
                            self._auto_resolve_media_items(
                                session, image_media
                            )
                        for group_ids in video_groups:
                            video_media = [
                                media_by_id[mid] for mid in group_ids
                            ]
                            self._auto_resolve_media_items(
                                session, video_media
                            )

                    progress_processed += 1
                    if self._update_task_progress_and_check_status(
                        session, progress_processed, progress_total
                    ):
                        logger.info(
                            "Duplicate detection task %s cancelled while processing identical hash %s",
                            self.task_id,
                            phash,
                        )
                        return

                logger.info(
                    f"Completed grouping {len(duplicate_hashes)} sets of identical media hashes."
                )

                near_duplicate_groups = 0
                if self.threshold and self.threshold > 0:
                    video_stmt = (
                        select(Media.id, Media.phash)
                        .where(
                            Media.duration.is_not(None),
                            Media.phash.is_not(None),
                            func.length(Media.phash) > 0,
                        )
                    )
                    video_candidates = session.exec(video_stmt).all()
                    valid_video_hashes: list[tuple[int, imagehash.ImageHash]] = []
                    for media_id, phash in video_candidates:
                        try:
                            hash_obj = imagehash.hex_to_hash(phash)
                        except (ValueError, TypeError) as exc:
                            logger.debug(
                                "Skipping video %s due to invalid pHash %s: %s",
                                media_id,
                                phash,
                                exc,
                            )
                            continue
                        valid_video_hashes.append((media_id, hash_obj))

                    if len(valid_video_hashes) > 1:
                        processed_before_video = progress_processed
                        progress_total += len(valid_video_hashes)
                        if self._update_task_progress_and_check_status(
                            session, progress_processed, progress_total
                        ):
                            logger.info(
                                "Duplicate detection task %s cancelled before near-duplicate video analysis",
                                self.task_id,
                            )
                            return

                        uf = UnionFind([media_id for media_id, _ in valid_video_hashes])
                        for idx, (media_a, hash_a) in enumerate(valid_video_hashes):
                            for jdx in range(idx + 1, len(valid_video_hashes)):
                                media_b, hash_b = valid_video_hashes[jdx]
                                try:
                                    distance = hash_a - hash_b
                                except Exception as exc:
                                    logger.debug(
                                        "Failed to compare hashes for %s and %s: %s",
                                        media_a,
                                        media_b,
                                        exc,
                                    )
                                    continue
                                if distance <= self.threshold:
                                    if (
                                        self._pair_key(media_a, media_b)
                                        in ignored_pairs
                                    ):
                                        continue
                                    uf.union(media_a, media_b)

                            progress_processed = processed_before_video + idx + 1
                            if self._update_task_progress_and_check_status(
                                session, progress_processed, progress_total
                            ):
                                logger.info(
                                    "Duplicate detection task %s cancelled while analysing near-duplicate video %s",
                                    self.task_id,
                                    media_a,
                                )
                                return

                        cluster_map: dict[int, list[int]] = {}
                        for media_id, _ in valid_video_hashes:
                            root = uf.find(media_id)
                            cluster_map.setdefault(root, []).append(media_id)

                        for group_media_ids in cluster_map.values():
                            if len(group_media_ids) < 2:
                                continue
                            if (
                                settings.duplicates.duplicate_auto_handling
                                is DuplicateHandlingRule.KEEP
                            ):
                                self._create_or_update_group(
                                    session, group_media_ids
                                )
                            else:
                                self._auto_resolve_duplicates_by_ids(
                                    session, group_media_ids
                                )
                            near_duplicate_groups += 1

                logger.info(
                    "Identified %d near-duplicate video groups using threshold %d",
                    near_duplicate_groups,
                    self.threshold,
                )
                if progress_total:
                    self._update_task_progress_and_check_status(
                        session, progress_processed, progress_total
                    )

                self._update_task_status(session, "completed")
                logger.info("pHash duplicate detection task finished.")

            except Exception as e:
                logger.error(
                    f"Duplicate detection task {self.task_id} failed: {e}",
                    exc_info=True,
                )
                self._update_task_status(session, "failed")

    def _create_or_update_group(self, session: Session, media_ids: list[int]):
        """
        Takes a list of media IDs that are duplicates and puts them in the same group.
        Handles merging if some items are already in different groups.
        This is a transactional unit of work that COMMITS at the end.
        """
        if not media_ids:
            return

        # Find all existing groups these media belong to
        existing_groups_stmt = select(DuplicateMedia).where(
            DuplicateMedia.media_id.in_(media_ids)
        )
        existing_dms = session.exec(existing_groups_stmt).all()

        connected_group_ids = {dm.group_id for dm in existing_dms}

        if not connected_group_ids:
            # No existing groups, create a new one
            new_group = DuplicateGroup()
            session.add(new_group)
            session.flush()  # Assigns an ID to new_group
            target_group_id = new_group.id
        else:
            # Items belong to existing groups, merge them all into the smallest group ID
            target_group_id = min(connected_group_ids)

        unique_media_ids: list[int] = []
        seen_media_ids: set[int] = set()
        for media_id in media_ids:
            if media_id in seen_media_ids:
                continue
            seen_media_ids.add(media_id)
            unique_media_ids.append(media_id)

        if not unique_media_ids:
            return

        # Remove existing mappings for these media so we can rebuild them cleanly
        session.exec(
            delete(DuplicateMedia).where(
                DuplicateMedia.media_id.in_(unique_media_ids)
            )
        )

        session.bulk_insert_mappings(
            DuplicateMedia,
            [
                {"group_id": target_group_id, "media_id": media_id}
                for media_id in unique_media_ids
            ],
        )

        # Merge other groups into the target group if necessary
        if len(connected_group_ids) > 1:
            other_group_ids = [
                gid for gid in connected_group_ids if gid != target_group_id
            ]
            session.exec(
                update(DuplicateMedia)
                .where(DuplicateMedia.group_id.in_(other_group_ids))
                .values(group_id=target_group_id)
            )
            # You might also want to delete the now-empty DuplicateGroup rows

        session.commit()  # Commit this unit of work
