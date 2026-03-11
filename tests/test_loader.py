from src.ingestion.loader import PDFIngestor

# usage: pytest tests/test_loader.py

class TestLoader:
    def test_weighted_heuristic(self):
        """Testing if our weighted heuristic correctly identifies years."""
        # We simulate the ingestor logic (or mock the file read, but here we test the regex logic)
        
        # Scenario A: Strong Context
        # We can reuse the regex logic from loader.py here or, better yet, refactor loader to have a public 'extract_year' method.
        # For now, let's assume we are testing the full integration if we had a file.
        pass

    def test_loader_instantiation(self):
        """Test if we can create the loader."""
        loader = PDFIngestor("data/papers")
        assert loader.papers_dir == "data/papers"
