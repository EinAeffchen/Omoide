"""PyInstaller binary entry point.

Shows the loading window immediately after the binary is clicked, then
imports the full application stack (FastAPI, SQLAlchemy, all routers, …)
in the background thread that pywebview already provides.

Only `webview` and the Python standard library are imported before
`webview.create_window()` is called.  Everything else is deferred to
`_boot_and_switch()`, which runs while the spinner is already visible.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers — pure stdlib, no heavy imports
# ---------------------------------------------------------------------------

def _env_truthy(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_webview2_runtime_dir() -> Path | None:
    candidates: list[Path] = []
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        candidates.append(Path(sys._MEIPASS) / "webview2runtime")
    try:
        candidates.append(Path(sys.executable).resolve().parent / "webview2runtime")
    except Exception:
        pass
    try:
        candidates.append(Path(__file__).resolve().parent.parent / "webview2runtime")
    except Exception:
        pass
    for c in candidates:
        if c.exists():
            return c
    return None


def _bundle_base() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def _webview_storage_dir() -> Path:
    """OS-specific persistent storage dir for the webview (cookies, localStorage).

    Mirrors app.config.get_os_app_config_dir(), reimplemented with pure
    stdlib since this module must not import app.config before the window
    is created.
    """
    if sys.platform == "win32":
        base = Path(os.getenv("APPDATA") or Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path(
            os.getenv("XDG_CONFIG_HOME")
            or Path.home() / "Library" / "Application Support"
        )
    else:
        base = Path(os.getenv("XDG_CONFIG_HOME") or Path.home() / ".config")
    d = base / "omoide" / "webview"
    d.mkdir(parents=True, exist_ok=True)
    return d


# ---------------------------------------------------------------------------
# sqlite-vec env var — must be set before app.database is first imported
# ---------------------------------------------------------------------------

try:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        _base = Path(sys._MEIPASS)
        _vec_candidates: list[Path] = []
        for _pat in ("vec0*.dll", "vec0*.so", "vec0*.dylib"):
            try:
                _vec_candidates += list(_base.glob(_pat))
            except Exception:
                pass
        if _vec_candidates:
            os.environ["SQLITE_VEC_PATH"] = str(_vec_candidates[0])
        else:
            _vec_name = (
                "vec0.dll" if sys.platform in ("win32", "cygwin")
                else "vec0.dylib" if sys.platform == "darwin"
                else "vec0.so"
            )
            os.environ["SQLITE_VEC_PATH"] = str(_base / _vec_name)
except Exception:
    pass

# ---------------------------------------------------------------------------
# WebView environment — must be set before `import webview`
# ---------------------------------------------------------------------------

os.environ["QT_API"] = "pyside6"
_webview_gui_override = os.environ.get("OMOIDE_WEBVIEW_GUI")
if sys.platform.startswith("win"):
    _gui_choice = (_webview_gui_override or "edgechromium").strip().lower()
    if _gui_choice == "edgechromium":
        _wv2_dir = _resolve_webview2_runtime_dir()
        if _wv2_dir:
            os.environ.setdefault(
                "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", str(_wv2_dir)
            )
    _disable_gpu_raw = os.environ.get("OMOIDE_WEBVIEW_DISABLE_GPU")
    _disable_gpu = _disable_gpu_raw is None or _env_truthy(_disable_gpu_raw)
    if _gui_choice == "qt" and _disable_gpu:
        _flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
        _extra = (
            "--disable-gpu --disable-gpu-compositing --disable-gpu-rasterization"
        )
        if _extra not in _flags:
            os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = f"{_flags} {_extra}".strip()

# ---------------------------------------------------------------------------
# Now import webview — fast, no ML or ORM involved
# ---------------------------------------------------------------------------

import webview  # noqa: E402

# ---------------------------------------------------------------------------
# Loading screen
# ---------------------------------------------------------------------------

_LOADING_HTML = """
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


def _preferred_webview_gui() -> str | None:
    override = os.environ.get("OMOIDE_WEBVIEW_GUI")
    if override:
        return override.strip().lower()
    if sys.platform.startswith("win"):
        return "edgechromium"
    return None


def _resolve_window_icon() -> str | None:
    base = _bundle_base()
    if sys.platform.startswith("win"):
        candidates = ["dist/brand/favicon.ico", "frontend/public/brand/favicon.ico"]
    elif sys.platform == "darwin":
        candidates = [
            "dist/brand/favicon.icns",
            "frontend/public/brand/favicon.icns",
            "dist/brand/favicon.ico",
            "frontend/public/brand/favicon.ico",
        ]
    else:
        candidates = [
            "dist/brand/app-icon.png",
            "frontend/public/brand/app-icon.png",
            "dist/brand/favicon.ico",
            "frontend/public/brand/favicon.ico",
        ]
    for rel in candidates:
        p = base / rel
        if p.exists():
            return os.fspath(p)
    return None


# ---------------------------------------------------------------------------
# Create window — happens immediately, no heavy code has run yet
# ---------------------------------------------------------------------------

_window = webview.create_window(
    "omoide",
    html=_LOADING_HTML,
    width=1280,
    height=720,
)


def _shutdown() -> None:
    # app.main may not be fully imported yet if the window is closed early.
    _main = sys.modules.get("app.main")
    if _main and getattr(_main, "server", None):
        _main.server.should_exit = True
        time.sleep(1)


def _boot_and_switch() -> None:
    """Runs in the pywebview background thread while the spinner is visible.

    Imports the full application stack, runs migrations, starts the HTTP
    server, then switches the window to the running app.
    """
    # This single import triggers the full app initialisation:
    # FastAPI, SQLAlchemy, all routers, settings load, etc.
    import app.main as _main  # noqa: F401

    try:
        _main.run_migrations()
    except Exception as exc:
        print(f"Migrations warning: {exc}")

    server_thread = threading.Thread(target=_main.run_server, daemon=True)
    server_thread.start()

    host, port = "127.0.0.1", 8123
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)

    try:
        _window.load_url(f"http://{host}:{port}")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Register shutdown handler and enter the GUI event loop
# ---------------------------------------------------------------------------

_window.events.closed += _shutdown
_preferred_gui = _preferred_webview_gui()
_webview_storage_path = os.fspath(_webview_storage_dir())
try:
    if _preferred_gui:
        webview.start(
            _boot_and_switch,
            gui=_preferred_gui,
            icon=_resolve_window_icon(),
            private_mode=False,
            storage_path=_webview_storage_path,
        )
    else:
        webview.start(
            _boot_and_switch,
            icon=_resolve_window_icon(),
            private_mode=False,
            storage_path=_webview_storage_path,
        )
except RuntimeError as exc:
    if sys.platform.startswith("win"):
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            (
                f"Failed to initialize the application window.\n\n"
                f"Error: {exc}\n\n"
                "A likely cause is that Windows blocked the DLLs when "
                "the archive was extracted.  Try the following:\n\n"
                "  1. Open PowerShell in the application folder and run:\n"
                "       Get-ChildItem -Recurse | Unblock-File\n"
                "  2. Then launch the application again.\n\n"
                "If the problem persists, please report it at:\n"
                "https://github.com/einaeffchen/omoide/issues"
            ),
            "Omoide – Startup Error",
            0x10,
        )
    sys.exit(1)
