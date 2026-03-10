---
description: How to run the development environment for ScholarLens
---

## Running ScholarLens Locally

### Option 1: Docker (recommended)

// turbo-all

1. Copy environment variables:
```bash
cp .env.example .env
```

2. Fill in your `.env` values (Neo4j password, optional API keys)

3. Build and start all services:
```bash
docker-compose up --build
```

4. Open the dashboard at http://localhost:8501

### Option 2: Native Python

1. Create a virtual environment:
```bash
python -m venv venv
venv\Scripts\activate   # Windows
```

2. Install dependencies:
```bash
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

3. Run the Streamlit dashboard:
```bash
streamlit run src/ui/app.py
```

4. Or run the CLI mode:
```bash
python -m src.main
```

### Option 3: CLI only (no UI)
```bash
python -m src.main
```
