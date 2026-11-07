# ScholarLens API. Build context is the repository root (see heroku.yml).
FROM python:3.11-slim AS base
# Hosts give fractional CPUs (Render free: 0.1). ONNX defaults to one thread per host core, which
# thrashes under a CPU quota: indexing a paper took minutes instead of seconds. Pin it to one thread.
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1     UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy     EMBEDDING_CACHE_DIR=/opt/models MIGRATIONS_DIR=/app/db/migrations     EMBEDDING_THREADS=1 OMP_NUM_THREADS=1
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /usr/local/bin/uv
WORKDIR /app/services/api

# Dependencies first (cached layer), then the app.
COPY services/api/pyproject.toml services/api/uv.lock services/api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/api/scholarlens ./scholarlens
RUN uv sync --frozen --no-dev
COPY db/migrations /app/db/migrations

# Bake the embedding model into the image so dynos don't download it on every boot.
RUN .venv/bin/python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/opt/models')"

RUN useradd --create-home app && chown -R app /opt/models
USER app
ENV PATH="/app/services/api/.venv/bin:$PATH"
# Heroku sets $PORT. One worker: a 512 MB dyno, and the work is I/O-bound async.
CMD ["sh", "-c", "exec uvicorn scholarlens.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
