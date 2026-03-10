import os

class Config:
    # Data & Storage
    DB_PATH = os.getenv("DB_PATH", "data/research.db")
    PAPERS_DIR = os.getenv("PAPERS_DIR", "data/papers/Papers")
    
    # ArXiv Ingestion Limits
    ARXIV_FETCH_LIMIT = int(os.getenv("ARXIV_FETCH_LIMIT", "100"))
    ARXIV_SORT_DEFAULT = "relevance"
    
    # Semantic Scholar Config
    SEMANTIC_SCHOLAR_API_KEY = os.getenv("SEMANTIC_SCHOLAR_API_KEY")
    
    
    # Analysis Thresholds
    SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.20"))
    MIN_DATA_POINTS_FOR_TREND = 5
    
    # UI/Display
    SHOW_TOP_N_RESULTS = 100
    
    @classmethod
    def set_limit(cls, new_limit: int):
        cls.ARXIV_FETCH_LIMIT = new_limit

# Note to myself: Use specific configs for Dev vs Prod
