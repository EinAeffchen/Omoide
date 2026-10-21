"""Media API, split by concern. All routers share the /api/media prefix; the
list and folder routers come first so their static paths (``/images``,
``/folders``, ...) win over ``/{media_id}``."""

from fastapi import APIRouter

from . import core, desktop, folders, geotagging, listing, playback, scenes

router = APIRouter()
for _module in (listing, geotagging, folders, desktop, core, scenes, playback):
    router.include_router(_module.router)
