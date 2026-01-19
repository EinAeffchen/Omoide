# -*- mode: python ; coding: utf-8 -*-
import os
import re
import sys
from pathlib import Path
from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    collect_submodules,
    collect_all,
)
import glob


def _dedupe_toc(entries):
    seen = set()
    unique = []
    for src, dest in entries:
        key = (os.path.normpath(src), dest)
        if key in seen:
            continue
        seen.add(key)
        unique.append((src, dest))
    return unique


def _dedupe_framework_resources(entries):
    seen = set()
    unique = []
    for src, dest in entries:
        norm_dest = os.path.normpath(dest)
        if norm_dest.endswith('.framework/Resources'):
            if norm_dest in seen:
                continue
            seen.add(norm_dest)
        unique.append((src, dest))
    return unique


def _filter_qt_plugins(entries):
    skip_keywords = [
        os.path.normpath('PySide6/Qt/plugins/sqldrivers'),
        os.path.normpath('PySide6/Qt/plugins/audio'),
        os.path.normpath('PySide6/Qt/plugins/sceneparsers'),
    ]
    skip_suffixes = [
        os.path.normpath('PySide6/Qt/plugins/imageformats/libqsvg.dylib'),
    ]
    filtered = []
    for src, dest in entries:
        norm_dest = os.path.normpath(dest)
        if any(keyword in norm_dest for keyword in skip_keywords):
            continue
        if any(norm_dest.endswith(suffix) for suffix in skip_suffixes):
            continue
        filtered.append((src, dest))
    return filtered

def _filter_macos_framework_conflicts(entries):
    if sys.platform != 'darwin':
        return entries
    filtered = []
    for src, dest in entries:
        norm_dest = os.path.normpath(dest)
        if '.framework' in norm_dest.split(os.sep):
            continue
        filtered.append((src, dest))
    return filtered

def get_package_path(package_name):
    """Finds the path to an installed package."""
    import importlib.util
    try:
        spec = importlib.util.find_spec(package_name)
        if spec and spec.origin:
            return os.path.dirname(spec.origin)
    except Exception:
        pass
    # Fallback for some packages
    try:
        import pkg_resources
        return pkg_resources.get_distribution(package_name).location
    except Exception:
        return None


pyside6_path = get_package_path('PySide6')
open_clip_path = get_package_path('open_clip')
binaries = []
datas = [
    ('frontend/dist', 'dist'),
    ('alembic', 'alembic'),
    ('alembic.ini', '.'),
    # Optionally bundle a recognition ONNX model if present in repo
    ('app/models/face_recognition_sface_2021dec.onnx', '.'),
    ('app/models/scrfd_2.5g_bnkps.onnx', '.'),
    ('app/VERSION', 'app'),
]
if Path('app/GPU_BUILD').exists():
    datas.append(('app/GPU_BUILD', 'app'))
datas += collect_data_files('open_clip', include_py_files=True)

# Collect all submodules of our in-repo `app` package to ensure they are bundled.
try:
    app_submodules = collect_submodules('app')
except Exception:
    app_submodules = []

# Ensure OpenCV (cv2) core extension and runtime libs are bundled using helpers.
try:
    # Collect the cv2 extension (.pyd/.so) and required runtime libs via hook.
    binaries += collect_dynamic_libs('cv2')
except Exception:
    pass

# Fallback: explicitly locate cv2*.pyd and opencv_videoio_ffmpeg*.dll in site-packages.
try:
    import site, glob, os, importlib.util
    site_dirs = []
    try:
        site_dirs += site.getsitepackages()
    except Exception:
        pass
    try:
        site_dirs += [site.getusersitepackages()]
    except Exception:
        pass
    # First, try importlib to get exact extension path (works for headless too).
    try:
        spec = importlib.util.find_spec('cv2')
        if spec and getattr(spec, 'origin', None) and os.path.exists(spec.origin):
            binaries.append((spec.origin, '.'))
            cv2_dir = os.path.dirname(spec.origin)
            for dll in glob.glob(os.path.join(cv2_dir, 'opencv_videoio_ffmpeg*.dll')):
                binaries.append((dll, '.'))
    except Exception:
        pass
    for d in site_dirs:
        if not d or not os.path.isdir(d):
            continue
        for pyd in glob.glob(os.path.join(d, 'cv2*.pyd')) + glob.glob(os.path.join(d, 'cv2', 'cv2*.pyd')):
            binaries.append((pyd, '.'))
        for dll in glob.glob(os.path.join(d, 'cv2', 'opencv_videoio_ffmpeg*.dll')):
            binaries.append((dll, '.'))
except Exception:
    pass

# Ensure scikit-learn DLLs (e.g., vcomp140.dll) are bundled for Windows builds
try:
    sklearn_bins = collect_dynamic_libs('sklearn')
    binaries += sklearn_bins
except Exception:
    try:
        import sklearn  # type: ignore
        skl_lib_dir = Path(sklearn.__file__).resolve().parent / '.libs'
        if skl_lib_dir.exists():
            for dll in skl_lib_dir.glob('*.dll'):
                binaries.append((str(dll), '.'))
    except Exception:
        pass

"""
Bundle sqlite-vec extension (vec0.*) to bundle root so runtime can load it.

We try multiple strategies because the file may be packaged as data rather
than a Python extension:
  1) collect_dynamic_libs('sqlite_vec')
  2) collect_data_files('sqlite_vec')
  3) Direct glob inside the package directory
"""
_found_vec = False
try:
    vec_libs = collect_dynamic_libs('sqlite_vec')
    for src, _dest in vec_libs:
        name = os.path.basename(src).lower()
        if name.startswith('vec0') and name.endswith(('.dll', '.so', '.dylib')):
            binaries.append((src, '.'))
            _found_vec = True
except Exception:
    pass

try:
    if not _found_vec:
        for src, _dest in collect_data_files('sqlite_vec', include_py_files=False):
            name = os.path.basename(src).lower()
            if name.startswith('vec0') and name.endswith(('.dll', '.so', '.dylib')):
                binaries.append((src, '.'))
                _found_vec = True
except Exception:
    pass

try:
    if not _found_vec:
        pkg_dir = get_package_path('sqlite_vec')
        if pkg_dir and os.path.isdir(pkg_dir):
            for pat in ('vec0*.dll', 'vec0*.so', 'vec0*.dylib'):
                for src in glob.glob(os.path.join(pkg_dir, pat)):
                    binaries.append((src, '.'))
                    _found_vec = True
except Exception:
    pass

# Bundle OpenCV Haar cascade files so cv2.data.haarcascades works in PyInstaller.
try:
    import cv2  # type: ignore

    casc_dir = getattr(getattr(cv2, 'data', None), 'haarcascades', None)
    if not casc_dir:
        # Fallback to typical layout: <cv2>/data
        casc_dir = os.path.join(os.path.dirname(cv2.__file__), 'data')
    if os.path.isdir(casc_dir):
        for xml in glob.glob(os.path.join(casc_dir, '*.xml')):
            datas.append((xml, 'cv2/data'))
except Exception:
    # If cv2 is not present during build, skip gracefully.
    pass

# Include optional Qt config if present to help PySide6 discover plugins.
if Path('qt.conf').exists():
    datas.append(('qt.conf', '.'))

# Collect PySide6 (Qt) resources, plugins and hidden imports so pywebview's Qt backend works.
# We both force-import the WebEngine modules (hiddenimports) and pull in all package data via collect_all.
hiddenimports_list = []
try:
    # Ensure PySide6 Qt modules are discovered, even if imported dynamically by pywebview
    hiddenimports_list += [
        'PySide6',
        'PySide6.QtCore',
        'PySide6.QtGui',
        'PySide6.QtWidgets',
        'PySide6.QtNetwork',
        'PySide6.QtWebEngineCore',
        'PySide6.QtWebEngineWidgets',
        'PySide6.QtWebChannel',
        'PySide6.QtOpenGL',
        'PySide6.QtOpenGLWidgets',
    ]
    # Pull in all PySide6 package data/binaries (platform plugins, imageformats, translations, WebEngine helpers, etc.)
    pyside_datas, pyside_bins, pyside_hidden = collect_all('PySide6')
    datas += pyside_datas
    binaries += pyside_bins
    hiddenimports_list += pyside_hidden
except Exception:
    # PySide6 might not be present during analysis in some environments
    pass

# Ensure pywebview and its Qt backend are included when selected dynamically
try:
    hiddenimports_list += collect_submodules('webview')
    hiddenimports_list += ['webview.platforms.qt']
except Exception:
    pass

# Ensure optional sqlite_vec helper is included for fallback loading.
try:
    hiddenimports_list += ['sqlite_vec']
except Exception:
    pass

# Ensure qtpy shim is bundled (pywebview's Qt backend depends on it).
try:
    hiddenimports_list += ['qtpy']
except Exception:
    pass

# Optionally include dlib model files if present in repo
possible_model_dirs = [
    Path('models'),
    Path('.data/models'),
]
for base in possible_model_dirs:
    sp = base / 'shape_predictor_5_face_landmarks.dat'
    fr = base / 'dlib_face_recognition_resnet_model_v1.dat'
    ssd_pt = base / 'deploy.prototxt'
    ssd_caffemodel = base / 'res10_300x300_ssd_iter_140000.caffemodel'
    if sp.exists():
        datas.append((str(sp), 'models'))
    if fr.exists():
        datas.append((str(fr), 'models'))
    if ssd_pt.exists():
        datas.append((str(ssd_pt), 'models'))
    if ssd_caffemodel.exists():
        datas.append((str(ssd_caffemodel), 'models'))

import importlib.util as _importlib_util
import sys as _sys
import tomllib as _tomllib
from datetime import datetime as _dt

# Conditionally include optional heavy modules only if present to avoid build failures.
optional_mods = ['dlib']
for _m in optional_mods:
    try:
        if _importlib_util.find_spec(_m):
            hiddenimports_list.append(_m)
    except Exception:
        pass

def _resolve_version():
    # 1) Prefer CI-provided env var
    v = os.environ.get('APP_VERSION')
    if v:
        return v
    # 2) Try from pyproject.toml
    try:
        with open('pyproject.toml', 'rb') as _f:
            data = _tomllib.load(_f)
            v = data.get('project', {}).get('version')
            if v:
                return v
    except Exception:
        pass
    # 3) Fallback using date
    return _dt.now().strftime('%Y.%m.%d')

APP_VERSION = _resolve_version()
APP_VERSION_FS = re.sub(r"[^A-Za-z0-9._-]", "_", APP_VERSION)
APP_FLAVOR = os.environ.get('APP_FLAVOR') or os.environ.get('OMOIDE_BUILD_FLAVOR')
if APP_FLAVOR:
    APP_FLAVOR_FS = re.sub(r"[^A-Za-z0-9._-]", "_", APP_FLAVOR)
    APP_NAME = f"omoide-{APP_VERSION_FS}-{APP_FLAVOR_FS}"
else:
    APP_NAME = f"omoide-{APP_VERSION_FS}"

def _pick_icon_path() -> str | None:
    candidates: list[str]
    if sys.platform.startswith("win"):
        candidates = ["frontend/public/brand/favicon.ico"]
    elif sys.platform == "darwin":
        candidates = [
            "frontend/public/brand/favicon.icns",
            "frontend/public/brand/favicon.ico",
        ]
    else:
        candidates = [
            "frontend/public/brand/app-icon.png",
            "frontend/public/brand/favicon.ico",
        ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None

ICON_PATH = _pick_icon_path()

# Remove duplicate data/binary entries that can cause PyInstaller symlink collisions (macOS frameworks)

datas = _filter_qt_plugins(datas)
datas = _filter_macos_framework_conflicts(datas)
datas = _dedupe_framework_resources(datas)
datas = _dedupe_toc(datas)
binaries = _filter_macos_framework_conflicts(binaries)
binaries = _dedupe_toc(binaries)

a = Analysis(
    ['app/main.py'],
    # Ensure project root is searched during analysis for in-tree packages
    pathex=[str(Path('.').resolve())],
    binaries=binaries,
    datas=datas,
    hiddenimports=[
        'cv2',
        'open_clip',
        'dateutil',
        'dateutil.tz',
        'dateutil.parser',
        'hdbscan',
    ] + app_submodules + hiddenimports_list,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Ensure only one Qt binding is collected. We use PySide6.
        'PyQt5',
        'PyQt5.QtCore', 'PyQt5.QtGui', 'PyQt5.QtWidgets',
        'PyQt5.QtWebEngine', 'PyQt5.QtWebEngineCore', 'PyQt5.QtWebEngineWidgets',
        'PyQt6',
        'PyQt6.QtCore', 'PyQt6.QtGui', 'PyQt6.QtWidgets',
        'PyQt6.QtWebEngine', 'PyQt6.QtWebEngineCore', 'PyQt6.QtWebEngineWidgets',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

# One-folder build: keep extracted files on disk for faster startup and easier debugging
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=APP_NAME,
    icon=ICON_PATH,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name=APP_NAME,
)
