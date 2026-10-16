"""Person API, split by concern. All routers share the /api/person prefix;
``core`` is included first so its static paths (e.g. ``/all-simple``) win
over ``/{person_id}``."""

from fastapi import APIRouter

from . import appearances, core, merging, relationships, timeline

router = APIRouter()
for _module in (core, timeline, appearances, merging, relationships):
    router.include_router(_module.router)
