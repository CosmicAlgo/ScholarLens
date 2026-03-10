---
description: How to run tests for ScholarLens
---

## Running Tests

// turbo-all

1. Run all tests:
```bash
pytest tests/ -v
```

2. Run with coverage:
```bash
pytest tests/ -v --cov=src --cov-report=term-missing
```

3. Run a specific test file:
```bash
pytest tests/test_query_engine.py -v
```

4. Run tests inside Docker:
```bash
docker-compose run --rm app pytest tests/ -v
```
