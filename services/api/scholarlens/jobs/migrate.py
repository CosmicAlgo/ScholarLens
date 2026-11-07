"""Apply db/migrations/*.sql in order, once each. Runs in Heroku's release phase.

Locally, docker-compose applies the same files on first start; this tracks them in
schema_migrations so a deploy only runs new ones.
"""

import os
import sys
from pathlib import Path

import psycopg

from ..config import get_settings
from ..db import _normalise_dsn

DIR = Path(os.environ.get("MIGRATIONS_DIR", Path(__file__).resolve().parents[4] / "db" / "migrations"))


def main() -> None:
    files = sorted(DIR.glob("*.sql"))
    if not files:
        sys.exit(f"no migrations found in {DIR}")
    with psycopg.connect(_normalise_dsn(get_settings().database_url), autocommit=True) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
        )
        done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        for f in files:
            if f.name in done:
                continue
            print(f"applying {f.name}")
            with conn.transaction():
                conn.execute(f.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
    print("migrations up to date")


if __name__ == "__main__":
    main()
