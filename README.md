# ScholarLens 🔍

An NLP-powered tool that helps researchers search, analyse, and visualise trends across academic papers using semantic search and local LLM integration.

ScholarLens ingests papers from multiple sources (ArXiv, Semantic Scholar, local PDFs), runs Named Entity Recognition (NER), generates vector embeddings, and serves an interactive Streamlit dashboard for exploration.

![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![AI](https://img.shields.io/badge/Embeddings-MiniLM--L6--v2-orange)
![Search](https://img.shields.io/badge/Search-Cosine%20Similarity-green)
![UI](https://img.shields.io/badge/UI-Streamlit-red)


# ScholarLens

ScholarLens grew out of [Timeline-Explorer](https://github.com/CosmicAlgo/Timeline-Explorer), 
a CLI-based academic research tool I was building independently alongside a university 
group project. While experimenting with a Streamlit interface branch, the scope expanded 
significantly — adding a Neo4j graph layer for relationship queries, an AI advisor with 
intent-based routing, and multi-source ingestion. The divergence became large enough that 
it warranted its own repository.

Where Timeline-Explorer focuses on NLP pipeline architecture and CLI-driven search, 
ScholarLens is the visual and graph-native evolution of that same problem: helping 
researchers find not just papers, but connections between ideas, authors, and topics 
over time.

---

## Features

- **Semantic Search**: Query by concept, not just keywords. Searching "reinforcement learning" also surfaces papers about "Q-learning" and "policy gradients".
- **Topic Timeline**: Visualise how a research topic has evolved year-over-year.
- **Multi-Source Ingestion**: Pull data from ArXiv API, Semantic Scholar API, or drop local PDFs.
- **Graph Explorer**: Map author collaboration networks and topic relationships using Neo4j.
- **AI Advisor**: Ask natural language questions. The system parses intent (author search, topic search, year filter) and routes to the right backend.
- **Local-First**: All embeddings and databases run locally. No queries sent to third-party LLM APIs.

## Architecture

| Layer | Tech | Purpose |
|-------|------|---------|
| **Embeddings** | `all-MiniLM-L6-v2` (sentence-transformers) | 384-dim document vectors for semantic matching |
| **NER** | spaCy (`en_core_web_sm`) | Extract authors, organisations, topics from abstracts |
| **Relational DB** | SQLite | Paper metadata, authors, entities |
| **Graph DB** | Neo4j | Author-Topic-Paper relationship queries |
| **LLM** | Ollama (llama3 / tinydolphin) | Query parsing, summarisation, query expansion |
| **Frontend** | Streamlit | Interactive dashboard with tabs for search, graph, advisor |
| **Container** | Docker Compose | Orchestrates app + Neo4j + Ollama |

## Getting Started

### Prerequisites
- Python 3.10+
- Docker & Docker Compose (recommended)

### Installation
```bash
git clone https://github.com/CosmicAlgo/ScholarLens.git
cd ScholarLens
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### Running with Docker (recommended)
```bash
docker-compose up --build
# Dashboard available at http://localhost:8501
```

### Running Locally
```bash
streamlit run src/ui/app.py
```

### CLI Mode
```bash
python -m src.main
```

---

## Project Structure

```
src/
├── ingestion/       # Data sources (ArXiv, Semantic Scholar, PDF loader)
├── processing/      # Embedding service, query engine, analysis
├── storage/         # SQLite DB, Neo4j graph DB
└── ui/              # Streamlit dashboard and tab components
tests/               # Unit and integration tests
docker/              # Dockerfile
```

## License

MIT — see [LICENSE](LICENSE) for details.
