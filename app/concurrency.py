import threading
from contextlib import contextmanager
from typing import Callable, Optional, Iterator

from app.logger import logger


# Global, process-local lock to serialize long-running write-heavy tasks.
_heavy_write_lock = threading.RLock()


def _try_acquire(lock: threading.RLock, timeout: float | None = None) -> bool:
    # RLock.acquire in CPython supports a float timeout on all platforms.
    if timeout is None:
        return lock.acquire()  # blocks
    return lock.acquire(timeout=timeout)


def acquire_heavy_write_lock(
    *,
    name: str = "heavy_write",
    cancelled: Optional[Callable[[], bool]] = None,
    poll_seconds: float = 0.5,
    log_every_seconds: float = 10.0,
) -> bool:
    """
    Acquire the global heavy-write lock with cooperative cancellation.

    - If `cancelled` is provided, periodically checks and aborts if True.
    - Logs waiting status periodically to aid observability.
    Returns True if acquired, False if aborted due to cancellation.
    """
    waited = 0.0
    last_log = 0.0
    while True:
        if _try_acquire(_heavy_write_lock, timeout=poll_seconds):
            if waited > 0:
                logger.info(
                    "Acquired heavy DB lock for '%s' after %.1fs of waiting.",
                    name,
                    waited,
                )
            return True
        waited += poll_seconds
        last_log += poll_seconds
        if cancelled and cancelled():
            logger.info(
                "Aborting lock wait for '%s' due to cancellation after %.1fs.",
                name,
                waited,
            )
            return False
        if last_log >= log_every_seconds:
            logger.info(
                "Waiting for heavy DB lock for '%s' (%.1fs so far)",
                name,
                waited,
            )
            last_log = 0.0


@contextmanager
def heavy_writer(
    *,
    name: str,
    cancelled: Optional[Callable[[], bool]] = None,
) -> Iterator[bool]:
    """
    Context manager that acquires the heavy-write lock, optionally cancel-aware.
    Yields True if acquired, False if aborted due to cancellation.
    Always releases the lock if it was acquired.
    """
    acquired = acquire_heavy_write_lock(name=name, cancelled=cancelled)
    try:
        yield acquired
    finally:
        if acquired:
            _heavy_write_lock.release()

