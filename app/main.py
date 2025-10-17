import json
import logging
import mimetypes
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from app.version import get_app_version

os.environ["QT_API"] = "pyside6"
import socket

import uvicorn
import webview
from anyio import to_thread
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import and_, or_
from sqlmodel import Session, select

import app.database as db
from app.api import (
    config,
    duplicates,
    face,
    media,
    missing,
    person,
    search,
    tags,
    tasks,
)
from app.api.processors import router as proc_router
from app.config import settings
from app.database import ensure_vec_tables
from app.ffmpeg import ensure_ffmpeg_available
from app.logger import configure_file_logging, logger
from app.models import ProcessingTask
from app.processor_registry import load_processors
from app.services.releases import get_latest_release_info
from app.tasks import run_cleanup_and_chain

# Configure uvicorn loggers' verbosity
logging.getLogger("uvicorn.error").setLevel(logging.INFO)
logging.getLogger("uvicorn.access").setLevel(logging.INFO)

scheduler = AsyncIOScheduler()
SCAN_JOB_ID = "scan_job"
APP_VERSION = get_app_version()


def scheduled_scan_job():
    logger.info("Running scheduled cleanup and process chain...")
    with Session(db.engine) as session:
        # Check if any part of the chain is already running
        running_task = session.exec(
            select(ProcessingTask).where(
                and_(
                    or_(
                        ProcessingTask.status == "running",
                        ProcessingTask.status == "pending",
                    ),
                    ProcessingTask.created_at
                    > datetime.now() - timedelta(hours=6),
                )
            )
        ).first()
        if running_task:
            logger.info(
                "A processing task is already running. Skipping scheduled run."
            )
            return

        # Create the first task in the chain
        task = ProcessingTask(
            task_type="clean_missing_files", total=0, processed=0
        )
        session.add(task)
        session.commit()
        session.refresh(task)

        # Start the chain
        run_cleanup_and_chain(task.id)


def configure_auto_scan_job() -> None:
    """Ensure the scheduler matches the current auto-scan settings."""
    job = scheduler.get_job(SCAN_JOB_ID)
    interval = settings.scan.scan_interval_minutes

    if not settings.scan.auto_scan:
        if job:
            scheduler.remove_job(SCAN_JOB_ID)
            logger.info("Auto scan disabled; removed scheduled job.")
        else:
            logger.info("Auto scan disabled; no scheduled job active.")
        return

    if job:
        scheduler.reschedule_job(
            SCAN_JOB_ID,
            trigger="interval",
            minutes=interval,
        )
        logger.info(
            "Auto scan interval updated. Scan job now runs every %s minutes.",
            interval,
        )
    else:
        scheduler.add_job(
            scheduled_scan_job,
            "interval",
            minutes=interval,
            id=SCAN_JOB_ID,
            misfire_grace_time=60,
            replace_existing=True,
        )
        logger.info(
            "Auto scan enabled. Scan job scheduled every %s minutes.", interval
        )

    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started for auto scan job management.")


def _cleanup_tasks_on_startup():
    """Cancel 'running' tasks and delete 'pending' tasks left from a previous run."""
    with Session(db.engine) as session:
        # Fetch all tasks; we'll resolve running/pending below
        tasks = session.exec(
            select(ProcessingTask).where(ProcessingTask.status != "finished")
        ).all()
        changed = False
        for t in tasks:
            if t.status == "running":
                t.status = "cancelled"
                t.finished_at = datetime.now()
                session.add(t)
                changed = True
            elif t.status == "pending":
                session.delete(t)
                changed = True
        if changed:
            session.commit()


def _cleanup_tasks_on_shutdown():
    """Delete 'pending' tasks and cancel any 'running' tasks on shutdown."""
    try:
        with Session(db.engine) as session:
            tasks = session.exec(select(ProcessingTask)).all()
            changed = False
            for t in tasks:
                if t.status == "running":
                    t.status = "cancelled"
                    t.finished_at = datetime.now()
                    session.add(t)
                    changed = True
                elif t.status == "pending":
                    session.delete(t)
                    changed = True
            if changed:
                session.commit()
    except Exception as e:
        logger.warning("Task cleanup on shutdown failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load the ML model
    load_processors()
    # Apply database migrations on startup (idempotent)
    try:
        db.run_migrations()
    except Exception as e:
        logger.warning("Database migrations failed at startup: %s", e)
    # Ensure vec0 tables exist even if Alembic couldn't create them (binary mode).
    try:
        ensure_vec_tables()
    except Exception as e:
        logger.warning("Could not ensure vec0 tables: %s", e)

    try:
        ensure_ffmpeg_available()
    except Exception as e:
        logger.warning("ffmpeg availability check failed: %s", e)

    # Clean up stale tasks from previous runs to avoid blocking actions
    _cleanup_tasks_on_startup()
    configure_auto_scan_job()
    yield
    # On shutdown, clean up tasks so next run starts cleanly
    _cleanup_tasks_on_shutdown()


logger.debug(settings)

# Enable persistent file logging inside the active data_dir
try:
    configure_file_logging(settings.general.data_dir / "logs")
except Exception:
    # Non-fatal if file logging cannot be initialized
    pass

app = FastAPI(lifespan=lifespan, redoc_url=None)
origins = [os.environ.get("DOMAIN", ""), "http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# @app.middleware("http")
# async def add_accept_ranges_header(request: Request, call_next):
#     # First, get the response from the actual endpoint (e.g., StaticFiles)
#     response = await call_next(request)

#     # Check if the request path was for the /originals mount point
#     if request.url.path.startswith("/originals"):
#         # If so, add the header to the response
#         response.headers["Accept-Ranges"] = "bytes"

#     return response


app.include_router(proc_router, prefix="/api", tags=["processors"])
app.include_router(media, prefix="/api/media", tags=["media"])
app.include_router(person, prefix="/api/person", tags=["person"])
app.include_router(tasks, prefix="/api/tasks", tags=["tasks"])
app.include_router(face, prefix="/api/faces", tags=["faces"])
app.include_router(tags, prefix="/api/tags", tags=["tags"])
app.include_router(search, prefix="/api/search", tags=["search"])
app.include_router(duplicates, prefix="/api/duplicates", tags=["duplicates"])
app.include_router(config, prefix="/api/config", tags=["config"])
app.include_router(missing, prefix="/api/missing", tags=["missing"])


@app.get("/thumbnails/{file_path:path}", include_in_schema=False)
async def serve_thumbnail(file_path: str):
    base = settings.general.thumb_dir
    requested = Path(file_path)
    # Prevent path traversal by resolving and ensuring base is a parent
    try:
        full_path = (base / requested).resolve()
        if not str(full_path).startswith(str(base.resolve())):
            raise HTTPException(status_code=404, detail="File not found")
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")

    if not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Guess MIME
    mime_type, _ = mimetypes.guess_type(full_path)
    if mime_type is None:
        mime_type = "application/octet-stream"

    resp = FileResponse(full_path, media_type=mime_type)
    resp.headers["Accept-Ranges"] = "bytes"
    return resp


@app.get("/originals/{file_path:path}", include_in_schema=False)
async def serve_original_media(file_path: str):
    logger.info(file_path)
    requested_path = Path(file_path)

    logger.info("PATH obj: %s", requested_path)
    media_dirs = [
        Path(media_dir).resolve() for media_dir in settings.general.media_dirs
    ]
    candidates: list[Path] = []

    if requested_path.is_absolute():
        candidates.append(requested_path)
    else:
        candidates.append(Path("/") / requested_path)

    for media_dir in media_dirs:
        candidates.append(media_dir / requested_path)

    def _is_within(path: Path, base: Path) -> bool:
        try:
            path.relative_to(base)
            return True
        except ValueError:
            return False

    resolved_target: Path | None = None
    seen: set[Path] = set()

    for candidate in candidates:
        try:
            normalized = candidate.resolve(strict=False)
        except RuntimeError:
            continue

        if normalized in seen:
            continue
        seen.add(normalized)

        if not any(
            _is_within(normalized, media_dir) for media_dir in media_dirs
        ):
            continue

        if not normalized.is_file():
            continue

        resolved_target = normalized
        break

    if resolved_target is None:
        raise HTTPException(status_code=404, detail="File not found")

    mime_type, _ = mimetypes.guess_type(resolved_target)
    if mime_type is None:
        mime_type = "application/octet-stream"

    response = FileResponse(resolved_target, media_type=mime_type)
    response.headers["Accept-Ranges"] = "bytes"

    return response


app.mount(
    "/static",
    StaticFiles(directory=str(settings.general.static_dir), html=True),
    name="static",
)
# app.mount(
#     "/media",
#     StaticFiles(directory=settings.general.media_dirs),
#     name="media",
# )


def resolve_path(path):
    """Get absolute path to resource, works for dev and for PyInstaller"""
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # Running in a PyInstaller bundle
        base_path = Path(sys._MEIPASS)
    else:
        # Running in a normal Python environment
        base_path = Path(".")

    return base_path / path


@app.get("/api/version", tags=["meta"])
async def get_version():
    return {"version": APP_VERSION}


@app.get("/api/version/update", tags=["meta"])
async def get_version_update():
    repo = settings.general.update_check_repo
    if not repo:
        return {
            "update_check_enabled": False,
            "current_version": APP_VERSION,
        }
    info = await to_thread.run_sync(
        get_latest_release_info,
        repo,
        APP_VERSION,
        settings.general.update_check_cache_minutes,
        settings.general.update_check_timeout_seconds,
    )
    return info


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_catch_all(full_path: str):
    index_html_path = settings.general.static_dir / "index.html"

    try:
        # 1. Read the static index.html file content
        with open(index_html_path, "r") as f:
            html_content = f.read()
    except FileNotFoundError:
        return Response(content="Frontend not found", status_code=404)

    def _bool_to_js(value: bool) -> str:
        return "true" if value else "false"

    config = {
        "VITE_API_READ_ONLY": _bool_to_js(bool(settings.general.read_only)),
        "VITE_API_ENABLE_PEOPLE": _bool_to_js(
            bool(settings.general.enable_people)
        ),
        "VITE_API_MEME_MODE": _bool_to_js(bool(settings.general.meme_mode)),
        "PERSON_RELATIONSHIP_MAX_NODES": str(
            settings.general.person_relationship_max_nodes
        ),
        "APP_VERSION": APP_VERSION,
    }
    config_script = (
        f"<script>window.runtimeConfig = {json.dumps(config)};</script>"
    )
    modified_html = html_content.replace(
        "</head>", f"{config_script}</head>", 1
    )

    return HTMLResponse(
        content=modified_html,
        headers={"Cache-Control": "no-cache, max-age=0, must-revalidate"},
    )


def run_server():
    """Runs the Uvicorn server."""
    global server
    config = uvicorn.Config(app, host="127.0.0.1", port=8123)
    server = uvicorn.Server(config)
    server.run()


def shutdown():
    """Signals the Uvicorn server to shut down."""
    if server:
        print("Shutting down Uvicorn server...")
        server.should_exit = True
        # Give the server a moment to close its connections
        time.sleep(1)


def run_migrations():
    """Runs Alembic migrations programmatically.

    Locates `alembic.ini` and the `alembic/` scripts whether running
    from source or from a PyInstaller bundle (sys._MEIPASS).
    """
    print("Running database migrations...")
    try:
        db.run_migrations()
        print("Migrations applied successfully.")
    except Exception as e:
        print(f"Error applying migrations: {e}")
        raise


def start_server():
    """Starts the Uvicorn server in a daemon thread."""
    uvicorn.run(app, host="0.0.0.0", port=8123)


if __name__ == "__main__":
    # 1. Run database migrations before starting the app
    # Ensure SQLITE_VEC_PATH is set to the correct bundled library name
    try:
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            # Prefer the actual bundled filename if present
            base = Path(sys._MEIPASS)
            candidates = []
            try:
                for pat in ("vec0*.dll", "vec0*.so", "vec0*.dylib"):
                    candidates += list(base.glob(pat))
            except Exception:
                candidates = []

            if candidates:
                os.environ["SQLITE_VEC_PATH"] = str(candidates[0])
            else:
                # Fallback to conventional name; env.py/database will also try stripping suffix
                if sys.platform in ("win32", "cygwin"):
                    vec_name = "vec0.dll"
                elif sys.platform == "darwin":
                    vec_name = "vec0.dylib"
                else:
                    vec_name = "vec0.so"
                os.environ["SQLITE_VEC_PATH"] = str(base / vec_name)
    except Exception:
        # Non-fatal: alembic/env.py and database hooks will also attempt to set this
        pass
    # Show the window immediately with a lightweight loading page
    loading_html = """
    <html>
      <head>
        <meta charset='utf-8' />
        <title>omoide</title>
        <style>
          body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0b0b0c; color:#e6e6e6; }
          .wrap { height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:16px; }
          .spinner { width:48px; height:48px; border:4px solid #2d2f36; border-top-color:#6aa3ff; border-radius:50%; animation:spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .sub { color:#9aa0a6; font-size:14px; }
        </style>
      </head>
      <body>
        <div class='wrap'>
          <div class='spinner'></div>
          <div>Starting omoide…</div>
          <div class='sub'>Preparing database and services</div>
        </div>
      </body>
    </html>
    """

    window = webview.create_window(
        "omoide",
        html=loading_html,
        width=1280,
        height=720,
    )

    def _boot_and_switch():
        logger.info("Boot: running migrations…")
        # Run migrations first (may take time on first launch)
        try:
            run_migrations()
        except Exception as e:
            logger.error("Migrations failed: %s", e)
        logger.info("Boot: starting server thread…")
        # Start the Uvicorn server in background
        server_thread = threading.Thread(target=run_server, daemon=True)
        server_thread.start()
        logger.info("Boot: waiting for server to become reachable…")
        # Wait until server is reachable, then switch the window to the app URL
        host, port = "127.0.0.1", 8123
        deadline = time.time() + 120
        while time.time() < deadline:
            try:
                with socket.create_connection((host, port), timeout=0.5):
                    break
            except OSError:
                time.sleep(0.25)
        logger.info("Boot: server reachable, loading app UI")
        try:
            window.load_url(f"http://{host}:{port}")
        except Exception:
            pass

    threading.Thread(target=_boot_and_switch, daemon=True).start()

    # Register shutdown and enter UI loop immediately
    window.events.closed += shutdown
    webview.start()
