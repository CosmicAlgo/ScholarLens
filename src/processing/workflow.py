import os
from src.config import Config
from src.ingestion.loader import PDFIngestor
from src.storage.db import ResearchDatabase
from src.processing.embeddings import EmbeddingGenerator

def run_ingestion_pipeline(db: ResearchDatabase):
    """
    Standard Ingestion Flow:
    1. Check Local Folder
    2. Check DB State
    3. Load New PDFs if needed
    4. Generate Embeddings
    """
    papers = []
    
    # A. Local files
    papers_dir = Config.PAPERS_DIR
    if os.path.exists(papers_dir):
        print(f"[1/4] Checking Local Files in {papers_dir}...")
        current_db_papers = db.get_all_papers()
        
        if len(current_db_papers) < 1: 
            print("      -> Loading from PDF (First Run)...")
            local_loader = PDFIngestor(papers_dir)
            local_papers = local_loader.load_data()
            db.add_papers(local_papers)
            papers.extend(local_papers)
        else:
            print(f"      -> Loaded {len(current_db_papers)} papers from SQLite Database.")
            papers.extend(current_db_papers)

    # Reload all from DB to ensure unified format
    papers = db.get_all_papers()
    print(f"      -> Total Knowledge Base: {len(papers)} papers.")

    # 3. Embeddings
    print("[2/4] Initializing Insight Model...")
    embedder = EmbeddingGenerator()
    
    print("      -> Vectorizing Knowledge Base...")
    paper_texts = []
    for p in papers:
        content = p.get('abstract') or p.get('text', '')
        title = p.get('title') or "Unknown"
        paper_texts.append(title + " " + content[:500])
        
    paper_vectors = embedder.generate_embedding(paper_texts)
    return papers, paper_vectors
