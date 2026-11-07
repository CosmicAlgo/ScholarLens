-- Full text of open-access papers, split into passages for grounded reading and Q&A.
-- We store extracted text passages (with page numbers) and their embeddings, never the PDF itself;
-- PDFs are streamed from the open-access host on demand.

CREATE TABLE IF NOT EXISTS paper_files (
    paper_id     text PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    pdf_url      text,
    license      text,
    status       text NOT NULL,            -- ready | no_pdf | failed
    pages        int,
    error        text,
    fetched_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS paper_chunks (
    paper_id   text NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    idx        int  NOT NULL,              -- order within the paper
    page       int  NOT NULL,              -- 1-based page the passage starts on
    text       text NOT NULL,
    embedding  vector(384),
    PRIMARY KEY (paper_id, idx)
);

CREATE INDEX IF NOT EXISTS paper_chunks_embedding_idx
    ON paper_chunks USING hnsw (embedding vector_cosine_ops);

-- Agent runs now come in two kinds: full reports and Copilot messages (separate daily quotas).
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'report';
CREATE INDEX IF NOT EXISTS agent_runs_kind_created_idx ON agent_runs (kind, created_at);
