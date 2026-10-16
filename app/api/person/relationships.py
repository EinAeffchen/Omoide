"""The co-appearance graph between persons."""

from collections import deque

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.models import Person, PersonRelationship
from app.schemas.person import RelationshipEdge, RelationshipGraph, RelationshipNode

router = APIRouter()


@router.get("/{person_id}/relationships", response_model=RelationshipGraph)
def get_person_relationships(
    person_id: int,
    depth: int = Query(3, ge=1, le=5, description="Number of generations to include"),
    max_nodes: int | None = Query(
        None, ge=1, le=500, description="Maximum number of nodes to include"
    ),
    session: Session = Depends(get_session),
):
    person = session.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    effective_max_nodes = (
        max_nodes
        if max_nodes is not None
        else settings.general.person_relationship_max_nodes
    )
    effective_max_nodes = int(max(1, min(500, effective_max_nodes)))

    nodes: dict[int, dict[str, object]] = {}
    edges: dict[tuple[int, int], int] = {}
    person_cache: dict[int, Person] = {}

    def _load_person(pid: int) -> Person | None:
        cached = person_cache.get(pid)
        if cached is not None:
            return cached
        obj = session.get(Person, pid)
        if obj is not None:
            person_cache[pid] = obj
        return obj

    def _ensure_node(pid: int, node_depth: int) -> bool:
        node = nodes.get(pid)
        if node:
            node["depth"] = min(node["depth"], node_depth)
            return True

        person_obj = _load_person(pid)
        if person_obj is None:
            return False

        thumbnail = None
        if person_obj.profile_face and person_obj.profile_face.thumbnail_path:
            thumbnail = person_obj.profile_face.thumbnail_path

        nodes[pid] = {
            "id": pid,
            "name": person_obj.name,
            "profile_thumbnail": thumbnail,
            "depth": node_depth,
        }
        return True

    visited: set[int] = set()
    queue: deque[tuple[int, int]] = deque([(person_id, 0)])

    while queue and len(nodes) < effective_max_nodes:
        current_id, current_depth = queue.popleft()
        if current_id in visited:
            continue
        visited.add(current_id)

        if not _ensure_node(current_id, current_depth):
            continue

        if current_depth >= depth:
            continue

        relationships = session.exec(
            select(PersonRelationship)
            .where(
                or_(
                    PersonRelationship.person_a_id == current_id,
                    PersonRelationship.person_b_id == current_id,
                )
            )
            .where(PersonRelationship.coappearance_count > 0)
            .order_by(PersonRelationship.coappearance_count.desc())
        ).all()

        for rel in relationships:
            neighbour_id = (
                rel.person_b_id if rel.person_a_id == current_id else rel.person_a_id
            )

            weight = int(rel.coappearance_count or 0)
            if weight <= 0:
                continue

            if len(nodes) >= effective_max_nodes and neighbour_id not in nodes:
                continue

            added = _ensure_node(neighbour_id, current_depth + 1)
            if not added:
                continue

            edge_key = tuple(sorted((current_id, neighbour_id)))
            existing_weight = edges.get(edge_key, 0)
            edges[edge_key] = max(existing_weight, weight)

            if neighbour_id not in visited and (current_depth + 1) <= depth:
                queue.append((neighbour_id, current_depth + 1))

    if person_id not in nodes:
        _ensure_node(person_id, 0)

    node_models = [
        RelationshipNode(**node_data)
        for node_data in sorted(
            nodes.values(), key=lambda node: (node["depth"], node["id"])
        )
    ]
    edge_models = [
        RelationshipEdge(source=edge[0], target=edge[1], weight=weight)
        for edge, weight in edges.items()
        if edge[0] in nodes and edge[1] in nodes
    ]

    return RelationshipGraph(
        nodes=node_models, edges=edge_models, root_id=person_id, max_depth=depth
    )
