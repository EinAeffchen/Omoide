<div align="center">
  <img src="frontend/public/brand/omoide_header_dark.png" alt="logo" width="200"/>
</div>

[![Buy Me a Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow?logo=buymeacoffee&style=flat-square)](https://buymeacoffee.com/einaeffchen)

# Omoide
**Offline-first Memory Organization & Intelligent Discovery Engine**

Omoide is a self-hosted, offline-capable photo and video library designed for privacy and longevity. It uses local AI to organize your media, making it searchable and discoverable without sending a single byte to the cloud.

---

## 📥 Download - Now also available on macOS!

**[Download the latest binary release](https://github.com/EinAeffchen/Omoide/releases/latest)**

> #### First launch on macOS
>
> The app is ad-hoc signed but not notarized, so Gatekeeper will block it on the first open.
> 
> 1. Unzip the downloaded `.app.zip` — you'll get `omoide-....app`
> 2. Move it to your **Applications** folder (optional but recommended)
> 3. **Double-click** the app → macOS shows *"cannot be opened because the developer cannot be verified"*
> 4. Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**
> 5. Confirm in the dialog — the app opens normally from now on
> 
> Alternatively, right-click (or Control-click) the `.app` → **Open** → **Open** skips the warning in one step.


*Also available as a [Docker container](#-quick-start-docker).*


---

## ✨ Key Features

### 🔒 Private & Offline
- **100% Local**: No cloud services, no subscriptions. Your data stays on your drive.
- **Offline-First**: Works fully offline after the initial model download.
- **Portable**: Run it as a desktop app on Windows/Linux/MacOS or host it via Docker.

### 🧠 Intelligent Organization
- **Face Recognition**: Automatically detects and clusters faces. Name them once, and Omoide finds them everywhere.
- **Semantic Search**: Search for "dog in the snow" or "birthday party" using natural language. Powered by OpenCLIP (Available since 0.6.0 search for known people with free text e.g. "Sam playing Baseball" and Omoide will automatically filter for images of the detected Person named Sam playing Baseball).
- **Auto-Tagging**: Optional AI categorization of your images, default tags exist, new tags can be added manually via config.
- **Co-appearance Graph**: Visualize how people in your library are connected and detecte friendship and family circles based on co-appearance counts.

### ⚡ Powerful Tools
- **Duplicate Detection**: Find and clean up exact or near-duplicates using perceptual hashing.
- **Map View**: Explore your photos on a world map. Edit or add GPS data directly.
- **Video Support**: Scans and plays videos, automatically detecting and extracting scenes for easy preview and free-text search.
- **Orphan Face Management**: Review and merge fragmented face clusters.

### 🛠️ Flexible Management
- **Multiple Profiles**: Switch between different libraries easily.
- **Read-Only Mode**: safely serve your archive to others.
- **Background Tasks**: Robust task management for scanning and processing large libraries.

---

## 📸 Screenshots

| Library Grid | Media Detail |
|:---:|:---:|
| ![Library grid](docs/screenshots/library-grid.png) | ![Media detail](docs/screenshots/media-detail.png) |

| Semantic Search | People Overview |
|:---:|:---:|
| ![Text search](docs/screenshots/search-text.png) | ![People overview](docs/screenshots/people-list.png) |

| Map View | Co-appearance Graph |
|:---:|:---:|
| ![Map](docs/screenshots/map.png) | ![Co-Appearance Graph](docs/screenshots/coappearance-graph.png) |

---

## 🚀 Quick Start (Docker)

Perfect for NAS or always-on servers.

1.  **Copy the template**:
    ```bash
    cp .env.template .env
    cp omoide.env.example omoide.env
    ```

2.  **Configure `.env`**:
    Set your media directories and ports.
    Ensure the folders you set in your .env actually exist in your system, to prevent permission issues on automatic creation.


3.  **Run**:
    ```bash
    docker compose up -d
    ```

4.  **Open**: `http://localhost:8123`

> **Note for arm64**: Ensure `sqlite-vec` matches your platform (e.g. 0.1.7a2) and build with `docker buildx` or `make build-image-arm64`. Alternatively use the Docker Hub image as set in the docker-compose.yml

---

## 🖥️ Quick Start (Desktop Development)

Requirements: Python 3.12+, FFmpeg, Node 18+.
For Windows: .NET Framework [Download .NET](https://dotnet.microsoft.com/en-us/download/dotnet-framework)

```bash
# 1. Build Frontend
cd frontend && npm ci && npm run build && cd ..

# 2. Run Backend
uvicorn app.main:app --host 127.0.0.1 --port 8123
```

To build a standalone binary:
```bash
pyinstaller main.spec
```

---

## 🧩 How It Works

- **Backend**: [FastAPI](https://fastapi.tiangolo.com/) + [SQLModel](https://sqlmodel.tiangolo.com/) (SQLite).
- **Vector Search**: [sqlite-vec](https://github.com/asg017/sqlite-vec) for high-performance similarity search.
- **AI Models**:
    - **Vision**: [OpenCLIP](https://huggingface.co/docs/hub/open_clip) for embeddings and search.
    - **Faces**: [InsightFace](https://github.com/deepinsight/insightface) (ONNX) for detection and recognition.
    - **Clustering**: [HDBSCAN](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html)/[Chinese Whispers](https://chinese-whispers.readthedocs.io/latest/tutorial/) for grouping faces.
    - **Scene detection**: [scenedetect](https://www.scenedetect.com/)
- **Frontend**: [React](https://react.dev/) + [MUI](https://mui.com/).

---

## 📄 License

**PolyForm Noncommercial License 1.0.0**
Free for personal, non-commercial use. See `LICENSE.md` for details.

---

## ❤️ Support

Omoide is a passion project maintained in my free time. If it helps you rediscover your memories, consider supporting its development!

[**☕ Buy Me a Coffee**](https://buymeacoffee.com/einaeffchen)
