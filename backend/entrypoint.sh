#!/bin/sh
set -e

echo "Running database migrations..."
alembic upgrade head || echo "Migration warning (tables may already exist), continuing..."

echo "Starting FastAPI server on ${BACKEND_HOST:-0.0.0.0}:${BACKEND_PORT:-8001}..."
exec uvicorn app.main:app \
    --host "${BACKEND_HOST:-0.0.0.0}" \
    --port "${BACKEND_PORT:-8001}"
