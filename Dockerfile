# ---- Stage 0: UV Installer ----
FROM debian:bookworm-slim AS uv-installer
ARG UV_VERSION=0.8.3
ARG TARGETARCH
RUN apt-get update && apt-get install -y curl ca-certificates --no-install-recommends && \
    mkdir -p /opt/uv && \
    ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" && \
    case "${ARCH}" in \
        amd64|x86_64) UV_TARGET="x86_64-unknown-linux-gnu" ;; \
        arm64|aarch64) UV_TARGET="aarch64-unknown-linux-gnu" ;; \
        *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac && \
    curl -LsSf "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${UV_TARGET}.tar.gz" | tar -zxf - -C /opt/uv && \
    cp /opt/uv/uv-${UV_TARGET}/uv /opt/uv/uv && \
    rm -rf /var/lib/apt/lists/*

# ---- Stage 1: Build Frontend (No changes here) ----
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build


# ---- Stage 2: Optimized Final Python Application ----
FROM python:3.12-slim
ARG APP_VERSION=0.0.0-dev
ARG APP_UID=1000
ARG APP_GID=1000
ARG SQLITE_VEC_ARM64_VERSION=0.1.7a2
ARG TARGETARCH
ENV UV_PYTHON_DOWNLOADS=never \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    OMOIDE_VERSION=${APP_VERSION}
# Create a non-root user and group first
RUN groupadd --gid ${APP_GID} appgroup && \
    useradd --uid ${APP_UID} --gid appgroup -s /bin/sh -m appuser

WORKDIR /app

# Install system dependencies (these rarely change)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

COPY --from=uv-installer /opt/uv/uv /usr/local/bin/uv

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/app/data

# Further ENV VARS for application
ENV SQLITE_VEC_PATH=/usr/local/lib/python3.12/site-packages/sqlite_vec/vec0.so
ENV HF_HOME=${DATA_DIR}/.omoide/models \
    TORCH_HOME=${DATA_DIR}/.omoide/models 

# --- OPTIMIZED LAYER ORDER ---

COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev --no-cache
RUN ARCH="${TARGETARCH:-$(dpkg --print-architecture)}" && \
    if [ "${ARCH}" = "arm64" ] || [ "${ARCH}" = "aarch64" ]; then \
        UV_NO_CACHE=1 uv pip install --system "sqlite-vec==${SQLITE_VEC_ARM64_VERSION}"; \
    fi
RUN apt-get remove -y build-essential || true
# 4. Copy application source code, setting ownership directly.
# This is now separate from the dependency layers.
COPY --chown=appuser:appgroup ./app ./app
COPY --chown=appuser:appgroup alembic /app/alembic
COPY --chown=appuser:appgroup alembic.ini /app/alembic.ini

# 5. Copy frontend assets from the build stage.
COPY --from=frontend-builder --chown=appuser:appgroup /app/frontend/dist /app/static

# 6. Create mount points for volumes and set permissions. This is a small final layer.
RUN mkdir -p ${DATA_DIR}
ENV IS_DOCKER=true

# 7. Switch to the non-root user
USER appuser
EXPOSE 8123
CMD ["/bin/bash", "-c", "alembic upgrade head; uvicorn app.main:app --host 0.0.0.0 --port 8123"]
