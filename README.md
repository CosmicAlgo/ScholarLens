# ScholarLens

**See where a research field is really heading, with every claim traced to a source.**

ScholarLens tracks how research topics rise, peak and fade across 250M+ papers, maps the
sub-areas emerging inside them, and flags retracted or unreviewed work. Ask a question in
plain English and a team of single-purpose AI agents writes a briefing in which every
sentence cites a paper or a computed number. Anything they can't back up is deleted.

> Status: v2 rebuild in progress (API and agents working; web app next).
> The original Streamlit prototype is preserved at tag `v1-streamlit`.

## What makes it different

- **Honest trends.** Growth is measured as a topic's *share* of all published papers, so
  "growing" means outpacing science, not riding the general growth of publishing.
- **Verified answers.** Numbers come from code, not the model. A verifier strips any claim
  without a valid citation and shows you what it removed.
- **Trust badges.** Retracted papers and preprints are flagged everywhere they appear.
- **Free to use.** Trends and search cost nothing to run; AI reports are rate-limited.

## Architecture

| | |
|---|---|
| `services/harvester` | Go. OpenAlex → Postgres ingestion |
| `services/api` | Python, FastAPI + LangGraph. Trends, hybrid search, agent pipeline |
| `db/migrations` | Postgres + pgvector schema |
| `apps/web` | Next.js front-end *(next)* |

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run locally

Prerequisites: Docker, Go 1.22+, [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env                 # add your free OpenAlex key (+ Anthropic key for AI reports)
docker compose up -d db              # Postgres + pgvector on :5433, schema auto-applied

# Harvest papers (needs OPENALEX_API_KEY beyond 200 results)
cd services/harvester && go build -o harvester . && \
  DATABASE_URL=postgresql://scholarlens:scholarlens@localhost:5433/scholarlens \
  ./harvester -search "retrieval augmented generation" -filter "from_publication_date:2019-01-01" -max 2000

# Embed and serve
cd ../api
uv run scholarlens-embed
uv run scholarlens-dev               # http://127.0.0.1:8000/docs
```

Try it:

```bash
curl "localhost:8000/api/trend?q=diffusion%20models"
curl "localhost:8000/api/search?q=privacy%20in%20retrieval"
curl -N -X POST localhost:8000/api/runs -H "Content-Type: application/json" \
     -d '{"question": "Is retrieval augmented generation still growing, and what is emerging inside it?"}'
```

Tests: `cd services/api && uv run pytest` · `cd services/harvester && go test ./...`

## Data

Paper metadata comes from [OpenAlex](https://openalex.org) (CC0).

## License

MIT
