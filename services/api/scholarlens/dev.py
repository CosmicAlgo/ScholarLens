"""Local dev server: `uv run scholarlens-dev`. Production uses plain uvicorn (see Procfile).

On Windows, uvicorn creates a Proactor event loop, which async psycopg cannot use, so we
create a selector loop ourselves and run the server on it.
"""

import asyncio
import sys

import uvicorn


def main() -> None:
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    config = uvicorn.Config("scholarlens.main:app", host="127.0.0.1", port=8000, log_level="info")
    asyncio.run(uvicorn.Server(config).serve())


if __name__ == "__main__":
    main()
