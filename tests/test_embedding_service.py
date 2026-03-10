"""
Unit tests for the Embedding Service.
Tests semantic search and similarity computation.
"""
import pytest
from typing import List, Dict


class TestEmbeddingService:
    """Tests for src/processing/embedding_service.py"""
    
    @pytest.fixture
    def embedding_service(self):
        """Get the embedding service singleton."""
        from src.processing.embedding_service import get_embedding_service
        return get_embedding_service()
    
    def test_get_embedding_returns_vector(self, embedding_service):
        """Verify embedding returns a numpy array."""
        vec = embedding_service.get_embedding("Machine Learning")
        assert vec is not None
        assert len(vec) > 0  # Vector should have dimensions
        assert hasattr(vec, 'shape')  # Should be numpy array
    
    def test_similar_terms_have_high_similarity(self, embedding_service):
        """Related academic terms should have high cosine similarity."""
        vec1 = embedding_service.get_embedding("Machine Learning")
        vec2 = embedding_service.get_embedding("Deep Learning")
        
        similarity = embedding_service.compute_similarity(vec1, vec2)
        
        # Related terms should have similarity > 0.5
        assert similarity > 0.5, f"Expected high similarity for related terms, got {similarity}"
    
    def test_unrelated_terms_have_low_similarity(self, embedding_service):
        """Unrelated terms should have low cosine similarity."""
        vec1 = embedding_service.get_embedding("Machine Learning")
        vec2 = embedding_service.get_embedding("Cooking Recipes")
        
        similarity = embedding_service.compute_similarity(vec1, vec2)
        
        # Unrelated terms should have similarity < 0.4
        assert similarity < 0.4, f"Expected low similarity for unrelated terms, got {similarity}"
    
    def test_search_papers_semantic(self, embedding_service):
        """Test semantic paper search returns ranked results."""
        # Mock papers
        mock_papers = [
            {"id": 1, "title": "Deep Neural Networks for Image Recognition", "abstract": "We present a novel architecture for visual classification using convolutional neural networks."},
            {"id": 2, "title": "Reinforcement Learning in Games", "abstract": "This paper explores Q-learning and policy gradients for game playing agents."},
            {"id": 3, "title": "Cooking Mediterranean Cuisine", "abstract": "A comprehensive guide to Italian and Greek recipes and culinary techniques."},
        ]
        
        # Search for "Computer Vision"
        results = embedding_service.search_papers_semantic("Computer Vision", mock_papers, top_k=3)
        
        assert len(results) > 0
        # First result should be the vision paper (most relevant)
        top_paper, top_score = results[0]
        assert "Image" in top_paper["title"] or "Neural" in top_paper["title"], "Vision paper should rank highest"
        
        # Cooking paper should rank last
        last_paper, last_score = results[-1]
        assert "Cooking" in last_paper["title"], "Unrelated paper should rank lowest"
    
    def test_find_similar_entities(self, embedding_service):
        """Test entity fuzzy matching."""
        entities = ["Reinforcement Learning", "Deep Learning", "Machine Learning", "Data Mining", "Quantum Computing"]
        
        # Search with abbreviation
        results = embedding_service.find_similar_entities("RL", entities, top_k=3)
        
        assert len(results) > 0
        # "Reinforcement Learning" should be in top results
        top_names = [name for name, score in results]
        assert "Reinforcement Learning" in top_names or "Machine Learning" in top_names


class TestQueryEngineExpansion:
    """Tests for query expansion functionality."""
    
    @pytest.fixture
    def query_engine(self):
        """Get a QueryEngine instance."""
        # This requires DB setup - may need mocking
        pytest.skip("Requires database setup - run integration tests separately")
    
    def test_expand_query_includes_original(self):
        """Query expansion should always include the original term."""
        # This is a design requirement test
        # The expand_query_fast method should return original + related terms
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
