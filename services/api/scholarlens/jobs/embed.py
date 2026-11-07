"""Fill missing paper embeddings.  `uv run python -m scholarlens.jobs.embed [--batch 256]`

Run it after each harvest: locally (fast, free) against the production DATABASE_URL,
or as a Heroku Scheduler job.
"""

import argparse
import asyncio
import time

from ..db import close_pool, open_pool, pool
from ..embeddings import embed_documents, paper_text, to_pgvector


async def run(batch: int) -> int:
    await open_pool()
    done = 0
    start = time.time()
    try:
        while True:
            async with pool().connection() as conn:
                rows = await (
                    await conn.execute(
                        "SELECT id, title, abstract FROM papers WHERE embedding IS NULL LIMIT %s", (batch,)
                    )
                ).fetchall()
            if not rows:
                break
            vectors = await asyncio.to_thread(embed_documents, [paper_text(r["title"], r["abstract"]) for r in rows])
            async with pool().connection() as conn, conn.cursor() as cur:
                await cur.executemany(
                    "UPDATE papers SET embedding = %s::vector WHERE id = %s",
                    [(to_pgvector(v), r["id"]) for v, r in zip(vectors, rows, strict=True)],
                )
            done += len(rows)
            print(f"embedded {done} papers ({done / (time.time() - start):.0f}/s)")
    finally:
        await close_pool()
    return done


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch", type=int, default=256)
    asyncio.run(run(parser.parse_args().batch))


if __name__ == "__main__":
    main()
