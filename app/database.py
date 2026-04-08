import os
import sqlite3 as _std_sqlite3
import sys
import time
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.engine.result import ScalarResult
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, create_engine

from app.config import settings
from app.logger import logger


def _sqlite_module():
    """Return a sqlite3-compatible module that supports enable_load_extension.

    On macOS, Apple's system libsqlite3 is compiled with
    SQLITE_OMIT_LOAD_EXTENSION, so the standard ``sqlite3`` module does not
    expose ``enable_load_extension``.  In that case we fall back to
    ``pysqlite3`` (provided by the ``pysqlite3-binary`` package) which
    bundles its own sqlite3 compiled with extension loading enabled.
    """
    _c = _std_sqlite3.connect(":memory:")
    _has = hasattr(_c, "enable_load_extension")
    _c.close()
    if _has:
        return _std_sqlite3
    try:
        import pysqlite3 as _ps3  # type: ignore[import-untyped]
        return _ps3
    except ImportError:
        logger.warning(
            "sqlite3 extension loading is unavailable and pysqlite3-binary is "
            "not installed.  Vector search features will not work.  Install "
            "pysqlite3-binary to fix this."
        )
        return _std_sqlite3


_SQLITE = _sqlite_module()
_USE_PYSQLITE3 = _SQLITE is not _std_sqlite3


def _attach_engine_listeners(eng):
    """Attach sqlite-vec loader and PRAGMA setup to the given engine."""

    def _load_sqlite_extensions(dbapi_conn, connection_record):
        dbapi_conn.enable_load_extension(True)
        try:
            # Provide a reasonable default path in frozen mode if unset
            if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
                base = Path(sys._MEIPASS)
                # Only set if not already provided by environment
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
                        os.environ["SQLITE_VEC_PATH"] = str(base / vec_name)

            vec_path = os.environ.get("SQLITE_VEC_PATH")
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
    if _USE_PYSQLITE3:
        # SQLAlchemy's sqlite dialect uses the built-in sqlite3 by default.
        # When we need pysqlite3 (e.g. macOS), supply the connection via a
        # creator so the correct module is used.  URL query-string pragmas
        # (WAL, synchronous, foreign_keys) are handled by the event listener
        # below, so we only need the bare file path here.
        _db_path = url.split("sqlite:///", 1)[-1].split("?")[0]

        def _creator():
            return _SQLITE.connect(_db_path, check_same_thread=False, timeout=30)

        eng = create_engine(url, creator=_creator, echo=False, pool_size=5, max_overflow=10)
    else:
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
