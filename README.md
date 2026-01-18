<div align="center">
  <img src="frontend/public/brand/omoide_header_dark.png" alt="logo" width="200"/>
</div>

[![Buy Me a Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow?logo=buymeacoffee&style=flat-square)](https://buymeacoffee.com/einaeffchen)

# Omoide
**Offline-first Memory Organization & Intelligent Discovery Engine**

Omoide is a self-hosted, offline-capable photo and video library designed for privacy and longevity. It uses local AI to organize your media, making it searchable and discoverable without sending a single byte to the cloud.

---

## 📥 Download

**[Download the latest release for Windows](https://github.com/EinAeffchen/Omoide/releases/latest)**

*Also available as a [Docker container](#-quick-start-docker) for Linux/NAS.*

---

## ✨ Key Features

### 🔒 Private & Offline
- **100% Local**: No cloud services, no subscriptions. Your data stays on your drive.
- **Offline-First**: Works fully offline after the initial model download.
- **Portable**: Run it as a desktop app on Windows or host it via Docker.

### 🧠 Intelligent Organization
- **Face Recognition**: Automatically detects and clusters faces. Name them once, and Omoide finds them everywhere.
- **Semantic Search**: Search for "dog in the snow" or "birthday party" using natural language. Powered by OpenCLIP.
- **Auto-Tagging**: Optional AI categorization of your images.
- **Co-appearance Graph**: Visualize how people in your library are connected.

### ⚡ Powerful Tools
- **Duplicate Detection**: Find and clean up exact or near-duplicates using perceptual hashing.
- **Map View**: Explore your photos on a world map. Edit or add GPS data directly.
- **Video Support**: Scans and plays videos, extracting scenes for easy preview.
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

> **Note for arm64**: Ensure `sqlite-vec` matches your platform (e.g. 0.1.7a2) and build with `docker buildx` or `make build-image-arm64`.

---

## 🖥️ Quick Start (Desktop Development)

Requirements: Python 3.12+, FFmpeg, Node 18+.

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

- **Backend**: FastAPI + SQLModel (SQLite).
- **Vector Search**: `sqlite-vec` for high-performance similarity search.
- **AI Models**:
    - **Vision**: OpenCLIP for embeddings and search.
    - **Faces**: InsightFace (ONNX) for detection and recognition.
    - **Clustering**: HDBSCAN for grouping faces.
- **Frontend**: React + MUI.

---

## 📄 License

**PolyForm Noncommercial License 1.0.0**
Free for personal, non-commercial use. See `LICENSE.md` for details.

---

## ❤️ Support

Omoide is a passion project maintained in my free time. If it helps you rediscover your memories, consider supporting its development!

[**☕ Buy Me a Coffee**](https://buymeacoffee.com/einaeffchen)
