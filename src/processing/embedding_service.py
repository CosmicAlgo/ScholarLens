"""
Embedding Service for Semantic Search.
Uses sentence-transformers (local, no API) for computing text embeddings.
"""
from typing import List, Dict, Tuple
import numpy as np

class EmbeddingService:
    """
    Provides semantic search capabilities using local embeddings.
    Model: all-MiniLM-L6-v2 (fast, 80MB, good quality).
    """
    
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the embedding model.
        The model is loaded lazily on first use to avoid slow startup.
        """
        self._model_name = model_name
        self._model = None
    
    def _load_model(self):
        """Lazy load the model on first use."""
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self._model_name)
        return self._model
    
    def get_embedding(self, text: str) -> np.ndarray:
        """
        Compute embedding vector for a text string.
        
        Args:
            text: Input text to embed.
            
        Returns:
            Numpy array of floats (embedding vector).
        """
        model = self._load_model()
        return model.encode(text, convert_to_numpy=True)
    
    def get_embeddings_batch(self, texts: List[str]) -> np.ndarray:
        """
        Compute embeddings for multiple texts efficiently.
        
        Args:
            texts: List of input texts.
            
        Returns:
            2D numpy array where each row is an embedding.
        """
        model = self._load_model()
        return model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
    
    def compute_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """
        Compute cosine similarity between two vectors.
        
        Returns:
            Float between -1 and 1 (1 = identical, 0 = unrelated).
        """
        dot = np.dot(vec1, vec2)
        norm1 = np.linalg.norm(vec1)
        norm2 = np.linalg.norm(vec2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(dot / (norm1 * norm2))
    
    def search_papers_semantic(
        self, 
        query: str, 
        papers: List[Dict], 
        top_k: int = 20,
        text_field: str = "abstract"
    ) -> List[Tuple[Dict, float]]:
        """
        Find papers semantically similar to the query.
        
        Args:
            query: User's search query.
            papers: List of paper dictionaries (must have 'title' and text_field).
            top_k: Number of results to return.
            text_field: Field to use for matching (default: 'abstract').
            
        Returns:
            List of (paper_dict, similarity_score) tuples, sorted by score descending.
        """
        if not papers:
            return []
        
        # Compute query embedding
        query_vec = self.get_embedding(query)
        
        # Compute paper embeddings (combine title + abstract for richer context)
        paper_texts = []
        for p in papers:
            title = p.get("title", "")
            abstract = p.get(text_field, p.get("text", ""))
            combined = f"{title}. {abstract}"[:512]  # Limit length
            paper_texts.append(combined)
        
        paper_vecs = self.get_embeddings_batch(paper_texts)
        
        # Compute similarities
        results = []
        for i, paper in enumerate(papers):
            score = self.compute_similarity(query_vec, paper_vecs[i])
            results.append((paper, score))
        
        # Sort by score descending
        results.sort(key=lambda x: x[1], reverse=True)
        
        return results[:top_k]
    
    def find_similar_entities(
        self,
        query: str,
        entity_names: List[str],
        top_k: int = 5
    ) -> List[Tuple[str, float]]:
        """
        Find entity names semantically similar to the query.
        Useful for Graph Explorer fuzzy matching.
        
        Args:
            query: User's search term (e.g., "RL").
            entity_names: List of entity name strings.
            top_k: Number of results.
            
        Returns:
            List of (entity_name, similarity_score) tuples.
        """
        if not entity_names:
            return []
        
        query_vec = self.get_embedding(query)
        entity_vecs = self.get_embeddings_batch(entity_names)
        
        results = []
        for i, name in enumerate(entity_names):
            score = self.compute_similarity(query_vec, entity_vecs[i])
            results.append((name, score))
        
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]


# Singleton instance for reuse across the app
_embedding_service = None

def get_embedding_service() -> EmbeddingService:
    """Get or create the singleton EmbeddingService instance."""
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service
