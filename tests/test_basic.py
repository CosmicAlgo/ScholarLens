import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.config import Config
from src.processing.analysis import TimelineAnalyzer

def test_config_paths():
    """Verify that configuration paths are set correctly."""
    assert Config.DB_PATH.endswith("research.db")
    assert "data" in Config.PAPERS_DIR

def test_timeline_analyzer_init():
    """Verify TimelineAnalyzer can be initialized."""
    analyzer = TimelineAnalyzer([])
    assert analyzer.papers == []
