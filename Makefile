# SHELL := /usr/bin/bash
# .SHELLFLAGS := -ec

ENV_FILE ?= omoide.env
VERSION_FILE := app/VERSION
VERSION := $(shell type $(subst /,\,$(VERSION_FILE)))
DOCKER_TARGETS := docker-start docker-down push

.PHONY: up build dev setup docker-start docker-down backup build-image \
	build-release push alembic-generate alembic-upgrade alembic-downgrade

ifneq (,$(filter $(DOCKER_TARGETS),$(MAKECMDGOALS)))
	ifndef ENV_FILE
		ENV_FILE := omoide.env
	endif
endif

ifneq ($(strip $(wildcard $(ENV_FILE))),)
	include $(ENV_FILE)
	# `export` works in GNU Make on Windows and Unix. The former grep/cut
	# command was evaluated while Make parsed this file and prevented
	# `make build` from running under Windows' default command shell.
	export
endif

VENV		?= $(CURDIR)/venv
PIP			:= $(VENV)/bin/pip
PYTHON		:= $(VENV)/bin/python

up: 
	uvicorn app.main:app --reload --log-level debug --host 0.0.0.0 --port 8000 

build: 
	uv run python scripts/build_desktop.py

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

build-image:
	docker buildx build \
		--platform linux/amd64,linux/arm64/v8 \
		--build-arg APP_VERSION=${VERSION} \
		-t einaeffchen/omoide:latest \
		-t einaeffchen/omoide:${VERSION} \
		--push \
		.

build-release: build-image
	git tag v${VERSION} -m "Release v${VERSION}"

push: build-release
	git push origin v${VERSION}

alembic-generate:
	echo ${DATA_DIR}
	alembic revision --autogenerate -m "RENAME_ME"

alembic-upgrade:
	alembic upgrade head

alembic-downgrade:
	alembic downgrade -1
