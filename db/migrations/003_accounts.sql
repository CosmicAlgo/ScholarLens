-- Optional accounts: what a signed-in user syncs across devices.
-- Identity itself lives in Neon Auth's own `neon_auth` schema; user_id is its user id (the JWT `sub`).
-- One JSON document per kind (workspace, briefings, films). `version` rises by one on every write, and a
-- write must name the version it started from, so two devices never silently overwrite each other.
CREATE TABLE IF NOT EXISTS user_docs (
    user_id    text        NOT NULL,
    kind       text        NOT NULL,
    data       jsonb       NOT NULL,
    version    integer     NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind)
);
