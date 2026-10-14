Third-Party Notices

This project bundles and depends on third‑party software. Each third‑party component is licensed under its own terms by its respective authors. This notice aggregates attributions and highlights notable obligations for redistribution (binaries and Docker images).

This document is informational and does not replace or modify any third‑party licenses. Where required (e.g., Apache-2.0 NOTICE, LGPL-3.0 texts), you must include the original license/notice files from those projects when redistributing.

Python Dependencies (from `pyproject.toml`)
- `alembic`
- `apscheduler`
- `fastapi`
- `ffmpeg-python`
- `hdbscan`
- `imagehash`
- `onnxruntime` / `onnxruntime-directml` (Windows)
- `opencv-python`
- `insightface`
- `cmake`
- `python-dateutil`
- `piexif`
- `pydantic`
- `pyinstaller`
- `pyside6`
- `python-multipart`
- `pywebview`
- `scenedetect`
- `sqlalchemy-vectorstores`
- `sqlite-vec`
- `sqlmodel`
- `tokenizers`
- `uvicorn`
- `watchdog`

Frontend Dependencies (from `frontend/package.json`)
- `@emotion/react`
- `@emotion/styled`
- `@mui/icons-material`
- `@mui/lab`
- `@mui/material`
- `@mui/x-date-pickers`
- `@react-hook/resize-observer`
- `date-fns`
- `leaflet`
- `prop-types`
- `react`
- `react-dom`
- `react-intersection-observer`
- `react-leaflet`
- `react-masonry-css`
- `react-player`
- `react-router-dom`
- `react-window`
- `zustand`

Special Compliance Notes
- PySide6 / Qt (LGPL-3.0):
  - If you distribute binaries (e.g., via PyInstaller), ensure compliance with LGPL-3.0:
    - Dynamically link to Qt libraries (PyInstaller typically bundles shared libraries alongside the executable).
    - Include the full text of the LGPL-3.0 license and any relevant Qt/PySide6 license texts with your binary distribution.
    - Permit reverse engineering for the purpose of debugging such modifications.
    - If you statically link (not typical here), you must also provide object files or another mechanism to relink against a modified Qt.

- FFmpeg in Docker Image:
  - The Docker image installs `ffmpeg` from Debian packages. FFmpeg’s licensing depends on build configuration (LGPL/GPL options). Debian packages include their license documentation in the image, typically under `/usr/share/doc/ffmpeg/`.
  - When redistributing the image, preserve those license files and comply with any additional terms for enabled codecs.

- Apache-2.0 Components (e.g., `tokenizers`, possibly others):
  - Preserve license texts and include upstream NOTICE contents if present. If a dependency includes a `NOTICE` file, ensure it is included in your binary distribution.

- Model Weights:
  - Some libraries (e.g., `insightface`) may download or reference model weights with separate licenses/terms. Document the model sources and licenses you distribute, and allow users to replace models as needed.
  - CLIP weights are OpenCLIP models (LAION) downloaded at runtime as ONNX exports from the `immich-app` Hugging Face organization.

How to Regenerate a Full License Inventory
- Python: generate a third‑party license report for the exact environment
  - `uv pip install pip-licenses`
  - `uv run pip-licenses --with-system --format=markdown --output-file THIRD_PARTY_LICENSES_PY.md`
- Frontend: generate a production dependency license report
  - `npm i -g license-checker`
  - `license-checker --production --summary --json > THIRD_PARTY_LICENSES_JS.json`

Include these generated reports in release artifacts if you want a precise, versioned accounting of third‑party licenses.

