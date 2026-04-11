# SHELL := /usr/bin/bash
# .SHELLFLAGS := -ec

ENV_FILE ?= omoide.env
VERSION_FILE := app/VERSION
VERSION := $(shell type $(subst /,\,$(VERSION_FILE)))
DOCKER_TARGETS := docker-start docker-down push

ifneq (,$(filter $(DOCKER_TARGETS),$(MAKECMDGOALS)))
	ifndef ENV_FILE
		ENV_FILE := omoide.env
	endif
endif

ifneq ($(strip $(wildcard $(ENV_FILE))),)
	include $(ENV_FILE)
	export $(shell grep -vE '^\s*#|^\s*$$' $(ENV_FILE) | cut -d= -f1)
endif

VENV		?= $(shell pwd)/venv
PIP			:= $(VENV)/bin/pip
PYTHON		:= $(VENV)/bin/python

up: 
	uvicorn app.main:app --reload --log-level debug --host 0.0.0.0 --port 8000 

build: 
	cd frontend && npm install && npm run build
	pyinstaller .\main.spec

dev:
	cd frontend && npm install && npm run dev

setup:
	@echo "--- Creating mount directories from $(ENV_FILE) ---"
	@test -n "$(HOST_MEDIA_DIR)" || (echo "ERROR: HOST_MEDIA_DIR is not set in $(ENV_FILE)"; exit 1)
	@test -n "$(HOST_DATA_DIR)" || (echo "ERROR: HOST_DATA_DIR is not set in $(ENV_FILE)"; exit 1)
	@mkdir -p "$(HOST_MEDIA_DIR)" && echo "OK: $(HOST_MEDIA_DIR)"
	@mkdir -p "$(HOST_DATA_DIR)" && echo "OK: $(HOST_DATA_DIR)"
	@chown 1000:1000 "$(HOST_MEDIA_DIR)" "$(HOST_DATA_DIR)" || echo "Warning: could not set ownership to 1000:1000 — run 'sudo chown 1000:1000 $(HOST_MEDIA_DIR) $(HOST_DATA_DIR)' if the container cannot write to these directories"

docker-start: setup
	docker compose up -d

docker-down:
	@echo "--- Using Docker environment from $(ENV_FILE) ---"
	@test -n "$(HOST_MEDIA_DIR)" || (echo "HOST_MEDIA_DIR from omoide.env is not set"; exit 1)
	PUID=$(shell id -u) PGID=$(shell id -g) docker compose down

backup:
	sqlite3 ".backup ${HOST_DATA_DIR}/omoide.db '${HOST_MEDIA_DIR}/db.backup'"

build-image: build-image-arm64 build-image-gpu
	docker build --build-arg APP_VERSION=${VERSION} --build-arg OMOIDE_BUILD_FLAVOR=cpu -t omoide .
	docker tag omoide einaeffchen/omoide:latest
	docker tag omoide einaeffchen/omoide:${VERSION}

build-image-arm64:
	docker buildx build --platform=linux/arm64 --build-arg APP_VERSION=${VERSION} --build-arg OMOIDE_BUILD_FLAVOR=cpu -t omoide:${VERSION}.arm64 --load .
	docker tag omoide:${VERSION}.arm64 einaeffchen/omoide:${VERSION}.arm64

build-image-gpu:
	docker build --build-arg APP_VERSION=${VERSION} --build-arg OMOIDE_BUILD_FLAVOR=gpu -t omoide:gpu .
	docker tag omoide:gpu einaeffchen/omoide:gpu
	docker tag omoide:gpu einaeffchen/omoide:${VERSION}-gpu

build-release: build-image
	git tag v${VERSION} -m "Release v${VERSION}"

push: build-release
	git push origin v${VERSION}
	docker push einaeffchen/omoide:latest
	docker push einaeffchen/omoide:${VERSION}	
	docker push einaeffchen/omoide:${VERSION}.arm64	
	docker push einaeffchen/omoide:gpu
	docker push einaeffchen/omoide:${VERSION}-gpu

alembic-generate:
	echo ${DATA_DIR}
	alembic revision --autogenerate -m "RENAME_ME"

alembic-upgrade:
	alembic upgrade head

alembic-downgrade:
	alembic downgrade -1
