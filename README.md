# Timeline Explorer v0.3 (MVP)

An AI-powered system that analyzes academic PDFs and visualizes research timelines.

## Setup Instructions

### 1. Prerequisites
Ensure you have **Docker Desktop** installed and running on your machine.

### 2. File Setup
The repository does not contain the PDF papers (to keep the download small). You need to add them manually:
1.  Navigate to the `data/papers/Papers` directory.
2.  Place your PDF files inside.
    *   *Note: If you have `papers.tar.gz`, extract it here.*

### 3. Running the Application
This application is interactive and **must be run using `docker-compose run`**, not `up`.

Run this command in your terminal:
```bash
docker-compose run --rm app
```

### 4. How to Use
*   **[2] Query Topic**: Search for concepts (e.g., "Deep Learning").
*   **[3] Query Entity**: Search for organizations or people (e.g., "Microsoft").
*   **[4] Reset Database**: If you add new PDFs or encounter issues, use this option to rebuild the index.

---

## Developer Notes

*   **Source Code**: Located in `src/`. The entry point is `src/main.py`.
*   **Dependencies**: Capabilities like `PyMuPDF` and `SentenceTransformers` are managed automatically within the Docker container.
