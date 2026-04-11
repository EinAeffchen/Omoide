import ctypes
import ctypes.util
import os
import sys
import time
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine.result import ScalarResult
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, create_engine

from app.config import settings
from app.logger import logger


def _sqlite3_db_ptr(conn) -> int | None:
    """Return the raw sqlite3* pointer from a CPython sqlite3.Connection.

    CPython's pysqlite_Connection layout on 64-bit (stable across 3.6–3.13):
      offset  0 : ob_refcnt  (8 bytes)
      offset  8 : ob_type    (8 bytes)
      offset 16 : db         (8 bytes) ← sqlite3* we need
    """
    try:
        return ctypes.c_void_p.from_address(id(conn) + 16).value
    except Exception:
        return None


def _open_libsqlite3() -> "ctypes.CDLL | None":
    """Load libsqlite3 via ctypes, trying known platform paths."""
    candidates: list[str] = []
    found = ctypes.util.find_library("sqlite3")
    if found:
        candidates.append(found)
    if sys.platform == "darwin":
        candidates += ["/usr/lib/libsqlite3.dylib", "/usr/lib/libsqlite3.0.dylib"]
    elif sys.platform.startswith("linux"):
        candidates += [
            "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
            "/usr/lib/libsqlite3.so.0",
        ]
    for path in candidates:
        try:
            return ctypes.CDLL(path)
        except OSError:
            continue
    return None


def _ctypes_load_extension(conn, ext_path: str) -> None:
    """Load a SQLite extension when enable_load_extension is not exposed.

    On macOS, Apple's system libsqlite3 (and many Python builds) omit
    SQLITE_ENABLE_LOAD_EXTENSION, so ``sqlite3.Connection`` has no
    ``enable_load_extension`` method.  However the underlying C library
    always exports ``sqlite3_enable_load_extension``; we call it directly
    via ctypes using the raw ``sqlite3*`` extracted from the CPython object.
    """
    lib = _open_libsqlite3()
    if lib is None:
        raise RuntimeError("Could not load libsqlite3 via ctypes")

    db_ptr = _sqlite3_db_ptr(conn)
    if db_ptr is None:
        raise RuntimeError("Could not extract sqlite3* pointer from connection")

    enable_fn = lib.sqlite3_enable_load_extension
    enable_fn.argtypes = [ctypes.c_void_p, ctypes.c_int]
    enable_fn.restype = ctypes.c_int

    rc = enable_fn(db_ptr, 1)
    if rc != 0:
        raise RuntimeError(f"sqlite3_enable_load_extension returned {rc}")

    try:
        load_fn = lib.sqlite3_load_extension
        load_fn.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,
            ctypes.c_char_p,
            ctypes.POINTER(ctypes.c_char_p),
        ]
        load_fn.restype = ctypes.c_int

        errmsg = ctypes.c_char_p()
        rc = load_fn(db_ptr, ext_path.encode(), None, ctypes.byref(errmsg))
        if rc != 0:
            msg = errmsg.value.decode() if errmsg.value else f"error code {rc}"
            try:
                free_fn = lib.sqlite3_free
                free_fn.argtypes = [ctypes.c_void_p]
                free_fn.restype = None
                free_fn(errmsg)
            except Exception:
                pass
            raise RuntimeError(f"sqlite3_load_extension failed: {msg}")
    finally:
        enable_fn(db_ptr, 0)


def _attach_engine_listeners(eng):
    """Attach sqlite-vec loader and PRAGMA setup to the given engine."""

    def _load_sqlite_extensions(dbapi_conn, connection_record):
        # Resolve path to the bundled vec0 binary (frozen build only).
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            base = Path(sys._MEIPASS)
            if not os.environ.get("SQLITE_VEC_PATH"):
                candidates: list[Path] = []
                try:
                    for pat in ("vec0*.dll", "vec0*.so", "vec0*.dylib"):
                        candidates += list(base.glob(pat))
                except Exception:
                    candidates = []
                if candidates:
                    os.environ["SQLITE_VEC_PATH"] = str(candidates[0])
                else:
                    vec_name = {
                        "win32": "vec0.dll",
                        "cygwin": "vec0.dll",
                        "darwin": "vec0.dylib",
                    }.get(sys.platform, "vec0.so")
                    os.environ["SQLITE_VEC_PATH"] = str(base / vec_name)

        vec_path = os.environ.get("SQLITE_VEC_PATH")

        if hasattr(dbapi_conn, "enable_load_extension"):
            # Standard path: sqlite3 compiled with SQLITE_ENABLE_LOAD_EXTENSION.
            dbapi_conn.enable_load_extension(True)
            try:
                if vec_path and Path(vec_path).exists():
                    dbapi_conn.load_extension(vec_path)
                else:
                    try:
                        import sqlite_vec
                        sqlite_vec.load(dbapi_conn)
                    except Exception as e:
                        raise RuntimeError(f"Failed to load sqlite-vec extension: {e}")
            finally:
                dbapi_conn.enable_load_extension(False)
        else:
            # Fallback for macOS (and other builds) where Apple's libsqlite3 /
            # the Python _sqlite3 extension was compiled without
            # SQLITE_ENABLE_LOAD_EXTENSION.  We call the C API directly via
            # ctypes, bypassing the Python-level guard.
            if vec_path and Path(vec_path).exists():
                _ctypes_load_extension(dbapi_conn, vec_path)
            else:
                try:
                    import sqlite_vec
                    _ctypes_load_extension(dbapi_conn, sqlite_vec.loadable_path())
                except Exception as e:
                    raise RuntimeError(
                        f"Failed to load sqlite-vec extension via ctypes: {e}"
                    )

    def _set_sqlite_pragmas(dbapi_conn, connection_record):
        try:
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL;")
            cur.execute("PRAGMA synchronous=NORMAL;")
            cur.execute("PRAGMA foreign_keys=ON;")
            cur.close()
        except Exception as e:
            logger.warning("Failed to set SQLite pragmas: %s", e)

    event.listen(eng, "connect", _load_sqlite_extensions)
    event.listen(eng, "connect", _set_sqlite_pragmas)


def _make_engine(url: str):
    eng = create_engine(
        url,
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 30},
        pool_size=5,
        max_overflow=10,
    )
    _attach_engine_listeners(eng)
    return eng


engine = _make_engine(settings.general.database_url)


def reset_engine(new_url: str):
    """Recreate the global engine for a new database URL."""
    global engine
    try:
        engine.dispose()
    except Exception:
        pass
    engine = _make_engine(new_url)


def run_migrations():
    """Ensure schema exists for the current database.

    Prefer Alembic migrations; if unavailable or failing (e.g., env
    requires external sqlite-vec path), fall back to creating tables
    via SQLModel metadata to support fresh/empty databases.
    """
    # Try Alembic first
    try:
        from alembic.config import Config

        from alembic import command

        # Locate alembic.ini and scripts both in dev and PyInstaller
        if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
            base_dir = Path(sys._MEIPASS)
        else:
            base_dir = Path(__file__).resolve().parent.parent

        ini_path = base_dir / "alembic.ini"
        scripts_path = base_dir / "alembic"

        if ini_path.exists():
            alembic_cfg = Config(str(ini_path))
        else:
            alembic_cfg = Config()

        alembic_cfg.set_main_option("script_location", str(scripts_path))
        alembic_cfg.set_main_option("sqlalchemy.url", settings.general.database_url)
        alembic_cfg.attributes["configure_logger"] = False

        command.upgrade(alembic_cfg, "head")
        logger.info("Alembic migrations applied successfully.")
        return
    except Exception as e:
        logger.warning("Alembic upgrade failed: %s ", e)


def ensure_vec_tables():
    """Ensure vec0 virtual tables exist (idempotent)."""
    # Try best to ensure the sqlite-vec extension can be located in binary mode
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        # Provide default path to bundled vec0 binary if not set
        base = Path(sys._MEIPASS)
        if not os.environ.get("SQLITE_VEC_PATH"):
            candidates = []
            try:
                for pat in ("vec0*.dll", "vec0*.so", "vec0*.dylib"):
                    candidates += list(base.glob(pat))
            except Exception:
                candidates = []
            if candidates:
                os.environ["SQLITE_VEC_PATH"] = str(candidates[0])
            else:
                vec_name = {
                    "win32": "vec0.dll",
                    "cygwin": "vec0.dll",
                    "darwin": "vec0.dylib",
                }.get(sys.platform, "vec0.so")
                os.environ.setdefault("SQLITE_VEC_PATH", str(base / vec_name))

    dim_media = settings.ai.clip_model_embedding_size
    with engine.begin() as conn:
        conn.exec_driver_sql(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS media_embeddings
            USING vec0(
                media_id  integer primary key,
                embedding float[{dim_media}]
            );
            """
        )
        conn.exec_driver_sql(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS face_embeddings
            USING vec0(
                face_id   integer primary key,
                person_id integer,
                embedding float[512]
            );
            """
        )
        conn.exec_driver_sql(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS person_embeddings
            USING vec0(
                person_id integer,
                embedding float[512]
               );
            """
        )
        conn.exec_driver_sql(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS scene_embeddings
            USING vec0(
                scene_id integer primary key,
                media_id integer,
                embedding float[{dim_media}]
            );
            """
        )


def safe_commit(session, retries=5, delay=0.5):
    for i in range(retries):
        try:
            session.commit()
            return
        except OperationalError as e:
            logger.error("OPERATION ERROR: %s", str(e))
            if "locked" in str(e):
                session.rollback()
                if i < retries - 1:
                    time.sleep(delay * (2**i))
                    continue
            session.rollback()
            raise
    raise RuntimeError("Failed to commit due to database lock.")


def safe_execute(session: Session, query, retries=5, delay=0.5) -> ScalarResult:
    for i in range(retries):
        try:
            return session.exec(query)
        except OperationalError as e:
            if "locked" in str(e):
                session.rollback()
                if i < retries - 1:
                    time.sleep(delay * (2**i))
                    continue
            session.rollback()
            raise
    raise RuntimeError("Failed to commit due to database lock.")


def get_session():
    with Session(engine) as session:
        yield session
