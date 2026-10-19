"""Video scenes: listing, manual creation/deletion and the WebVTT chapter track."""

from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import selectinload
from sqlmodel import Session, col, select

from app.database import get_session, safe_commit
from app.frames import extract_scene_frame_and_thumbnail
from app.models import Face, Media, Person, Scene
from app.schemas.scene import PersonInScene, SceneCreate, SceneRead

router = APIRouter()


def format_timestamp(seconds: float) -> str:
    """
    Turn seconds (e.g. 12.3456) into a WebVTT timestamp like "00:00:12.346".
    """
    td = timedelta(seconds=seconds)
    # total seconds → hours, minutes, seconds, milliseconds
    total_ms = int(td.total_seconds() * 1000)
    hrs, rem = divmod(total_ms, 3_600_000)
    mins, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hrs:02d}:{mins:02d}:{secs:02d}.{ms:03d}"


@router.get(
    "/{media_id}/scenes.vtt",
    response_class=PlainTextResponse,
    summary="Serve a WebVTT file mapping scene start/end → thumbnail",
)
def scenes_vtt(
    media_id: int, request: Request, session: Session = Depends(get_session)
):
    scenes = session.exec(
        select(Scene).where(Scene.media_id == media_id).order_by(Scene.start_time)
    ).all()
    if not scenes:
        if request.method == "HEAD":
            raise HTTPException(404, "No scenes found for that media")
        empty_vtt = "WEBVTT\n\n"
        return PlainTextResponse(empty_vtt, media_type="text/vtt")

    lines = ["WEBVTT", ""]
    for s in scenes:
        start = format_timestamp(s.start_time)
        end_time = s.end_time or (s.start_time + 0.1)
        end = format_timestamp(end_time)
        thumb = quote(s.thumbnail_path, safe="/") if s.thumbnail_path else ""
        lines += [f"{start} --> {end}", f"/thumbnails/{thumb}", ""]

    return PlainTextResponse("\n".join(lines), media_type="text/vtt")


@router.get("/{media_id}/scenes", response_model=list[SceneRead])
def get_scenes(media_id: int, session: Session = Depends(get_session)):
    scenes = session.exec(
        select(Scene).where(Scene.media_id == media_id).order_by(Scene.start_time)
    ).all()

    # Gather faces with timestamps to map persons to scenes
    faces_with_ts = session.exec(
        select(Face).where(
            Face.media_id == media_id,
            Face.person_id.isnot(None),
            Face.timestamp.isnot(None),
        )
    ).all()

    persons_by_id: dict = {}
    if faces_with_ts:
        person_ids = {f.person_id for f in faces_with_ts}
        persons = session.exec(
            select(Person)
            .options(selectinload(Person.profile_face))
            .where(Person.id.in_(person_ids))
        ).all()
        persons_by_id = {p.id: p for p in persons}

    result = []
    for scene in scenes:
        seen_ids: set = set()
        scene_persons: list[PersonInScene] = []
        for face in faces_with_ts:
            if (
                face.person_id not in seen_ids
                and face.timestamp is not None
                and face.timestamp >= scene.start_time
                and face.timestamp < scene.end_time
            ):
                person = persons_by_id.get(face.person_id)
                if person:
                    scene_persons.append(
                        PersonInScene(
                            id=person.id,
                            name=person.name,
                            profile_face_id=person.profile_face_id,
                            profile_thumbnail=(
                                person.profile_face.thumbnail_path
                                if person.profile_face
                                else None
                            ),
                        )
                    )
                    seen_ids.add(face.person_id)
        result.append(
            SceneRead(
                id=scene.id,
                start_time=scene.start_time,
                end_time=scene.end_time,
                thumbnail_path=scene.thumbnail_path,
                description=scene.description,
                persons=scene_persons,
            )
        )
    return result


@router.post(
    "/{media_id}/scenes", response_model=SceneRead, status_code=status.HTTP_201_CREATED
)
def create_scene(
    media_id: int,
    data: SceneCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    media = session.get(Media, media_id)
    if not media:
        raise HTTPException(404, "Media not found")
    if not media.duration:
        raise HTTPException(400, "Not a video")

    if data.end_time is None:
        next_scene = session.exec(
            select(Scene)
            .where(Scene.media_id == media_id, Scene.start_time > data.start_time)
            .order_by(col(Scene.start_time))
            .limit(1)
        ).first()
        end_time = next_scene.start_time if next_scene else media.duration
    else:
        end_time = data.end_time

    if data.start_time >= end_time:
        raise HTTPException(400, "start_time must be less than end_time")
    scene = Scene(
        media_id=media_id,
        start_time=data.start_time,
        end_time=end_time,
        description=data.description,
    )
    session.add(scene)
    safe_commit(session)
    session.refresh(scene)

    thumb_relative, _ = extract_scene_frame_and_thumbnail(media, float(data.start_time))
    if thumb_relative:
        scene.thumbnail_path = thumb_relative
        session.add(scene)

    media.faces_extracted = False
    media.embeddings_created = False
    media.ran_auto_tagging = False
    session.add(media)
    safe_commit(session)

    from app.tasks import create_and_run_task, run_media_processing_and_chain

    create_and_run_task(
        session=session,
        background_tasks=background_tasks,
        task_type="process_media",
        callable_task=run_media_processing_and_chain,
    )

    return SceneRead(
        id=scene.id,
        start_time=scene.start_time,
        end_time=scene.end_time,
        thumbnail_path=scene.thumbnail_path,
        description=scene.description,
        persons=[],
    )


@router.delete("/{media_id}/scenes/{scene_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scene(media_id: int, scene_id: int, session: Session = Depends(get_session)):
    scene = session.exec(
        select(Scene).where(Scene.id == scene_id, Scene.media_id == media_id)
    ).first()
    if not scene:
        raise HTTPException(404, "Scene not found")
    session.delete(scene)
    safe_commit(session)
