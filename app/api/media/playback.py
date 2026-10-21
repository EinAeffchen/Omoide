"""Playable versions of videos the browser cannot decode itself."""

import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session

from app.conversion import existing_converted_copy, stream_converted
from app.database import get_session
from app.models import Media

router = APIRouter()


@router.get(
    "/{media_id}/converted",
    summary="The browser-playable copy kept alongside the original",
)
def get_converted_copy(media_id: int):
    copy = existing_converted_copy(media_id)
    if copy is None:
        raise HTTPException(404, "No converted copy exists for this media")
    return FileResponse(copy, media_type="video/mp4")


@router.get(
    "/{media_id}/stream",
    summary="Convert a video on the fly while it plays",
)
async def stream_video(
    media_id: int,
    start: float = Query(0.0, ge=0, description="Start position in seconds"),
    session: Session = Depends(get_session),
):
    """A fragmented MP4 converted from `start`. The stream cannot be seeked
    itself; players request a new stream at the target position instead."""
    media = session.get(Media, media_id)
    if not media or media.duration is None:
        raise HTTPException(404, "Video not found")
    source = Path(media.path)
    if not source.is_file():
        raise HTTPException(404, "Video file not found")

    chunks = stream_converted(source, start)

    async def body():
        # Read ffmpeg's output off the event loop; closing the generator (the
        # client went away or seeked) kills the ffmpeg process.
        try:
            while True:
                chunk = await asyncio.to_thread(next, chunks, None)
                if chunk is None:
                    break
                yield chunk
        finally:
            await asyncio.to_thread(chunks.close)

    return StreamingResponse(body(), media_type="video/mp4")
