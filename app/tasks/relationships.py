from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime
from itertools import combinations

from sqlalchemy import union_all
from sqlmodel import Session, select, delete

import app.database as db
from app.logger import logger
from app.models import Face, PersonMediaLink, PersonRelationship


def rebuild_person_relationships() -> None:
    """Recompute co-appearance counts for all persons."""
    logger.info("Rebuilding person relationship graph...")
    with Session(db.engine) as session:
        rows = session.exec(
            union_all(
                select(
                    Face.media_id.label("media_id"),
                    Face.person_id.label("person_id"),
                ).where(Face.person_id.is_not(None)),
                select(
                    PersonMediaLink.media_id.label("media_id"),
                    PersonMediaLink.person_id.label("person_id"),
                ),
            )
        ).all()

        if not rows:
            session.exec(delete(PersonRelationship))
            session.commit()
            logger.info("No person relationships found; table cleared.")
            return

        media_to_persons: dict[int, set[int]] = defaultdict(set)
        for media_id, person_id in rows:
            if media_id is None or person_id is None:
                continue
            media_to_persons[int(media_id)].add(int(person_id))

        pair_counts: Counter[tuple[int, int]] = Counter()
        last_media: dict[tuple[int, int], int] = {}

        for media_id, persons in media_to_persons.items():
            if len(persons) < 2:
                continue
            for a, b in combinations(sorted(persons), 2):
                pair_counts[(a, b)] += 1
                last_media[(a, b)] = media_id

        session.exec(delete(PersonRelationship))
        relationships: list[PersonRelationship] = [
            PersonRelationship(
                person_a_id=a,
                person_b_id=b,
                coappearance_count=count,
                last_media_id=last_media.get((a, b)),
                updated_at=datetime.utcnow(),
            )
            for (a, b), count in pair_counts.items()
            if count > 0
        ]
        session.add_all(relationships)
        session.commit()
        logger.info(
            "Stored %d person relationship edges.",
            len(relationships),
        )
