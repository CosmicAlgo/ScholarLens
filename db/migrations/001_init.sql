-- ScholarLens core schema.
-- Papers come from OpenAlex (CC0). Ids are OpenAlex work ids ("W2741809807").
-- Sized for a ~1 GB Postgres: we store a focused slice of papers with 384-dim
-- embeddings; field-wide trend counts come from OpenAlex aggregations (cached).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY,           -- OpenAlex topic id, e.g. "T10181"
    name        TEXT NOT NULL,
    subfield    TEXT,
    field       TEXT,
    domain      TEXT
);

CREATE TABLE IF NOT EXISTS papers (
    id               TEXT PRIMARY KEY,      -- OpenAlex work id
    doi              TEXT,
    title            TEXT NOT NULL,
    abstract         TEXT,
    year             SMALLINT,
    publication_date DATE,
    work_type        TEXT,                  -- article, preprint, review, ...
    venue            TEXT,
    cited_by_count   INTEGER NOT NULL DEFAULT 0,
    is_oa            BOOLEAN NOT NULL DEFAULT FALSE,
    oa_url           TEXT,
    -- Trust signals (shown as badges on every paper)
    is_retracted     BOOLEAN NOT NULL DEFAULT FALSE,
    is_preprint      BOOLEAN NOT NULL DEFAULT FALSE,
    primary_topic_id TEXT REFERENCES topics(id),
    embedding        vector(384),           -- filled by the embed job; NULL until then
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_tsv       tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(abstract, '')), 'B')
    ) STORED
);

CREATE INDEX IF NOT EXISTS papers_year_idx    ON papers (year);
CREATE INDEX IF NOT EXISTS papers_topic_idx   ON papers (primary_topic_id);
CREATE INDEX IF NOT EXISTS papers_doi_idx     ON papers (doi);
CREATE INDEX IF NOT EXISTS papers_tsv_idx     ON papers USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS papers_embed_idx   ON papers USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS authors (
    id          TEXT PRIMARY KEY,           -- OpenAlex author id
    name        TEXT NOT NULL,
    orcid       TEXT
);

CREATE TABLE IF NOT EXISTS paper_authors (
    paper_id    TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    position    SMALLINT NOT NULL,
    institution TEXT,
    PRIMARY KEY (paper_id, author_id)
);
CREATE INDEX IF NOT EXISTS paper_authors_author_idx ON paper_authors (author_id);

-- Cached OpenAlex aggregations (counts per year etc.). Keeps us inside the
-- free daily API budget: a popular topic is fetched once per TTL, not per user.
CREATE TABLE IF NOT EXISTS api_cache (
    key         TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every agent run is logged: drives cost control, debugging, and product analytics.
CREATE TABLE IF NOT EXISTS agent_runs (
    id            UUID PRIMARY KEY,
    question      TEXT NOT NULL,
    client_id     TEXT,                     -- anonymous visitor id or user id
    status        TEXT NOT NULL DEFAULT 'running',  -- running | done | failed
    plan          JSONB,
    report        JSONB,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS agent_runs_client_day_idx ON agent_runs (client_id, created_at);

CREATE TABLE IF NOT EXISTS harvest_runs (
    id          BIGSERIAL PRIMARY KEY,
    source      TEXT NOT NULL,
    filter      TEXT NOT NULL,
    fetched     INTEGER NOT NULL DEFAULT 0,
    upserted    INTEGER NOT NULL DEFAULT 0,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    error       TEXT
);
