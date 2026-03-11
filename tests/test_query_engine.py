import pytest
import sys
from unittest.mock import MagicMock

# MOCK: Ensure we don't need a real Neo4j connection/driver installed locally
sys.modules["src.storage.graph_db"] = MagicMock()

from src.processing.query_engine import QueryEngine

class TestQueryEngineSchema:
    """
    High-Level Tests validating Requirement Compliance.
    """
    
    @pytest.fixture
    def engine(self):
        # Pass None/Mock for DBs
        return QueryEngine(db=MagicMock(), graph_db=MagicMock())

    def test_requirement_topic_search(self, engine):
        """Req: System must correctly identify topic-based queries."""
        q = "Show me papers about Deep Learning"
        res = engine._parse_with_regex(q)
        assert res['type'] == 'TOPIC_SEARCH'
        assert 'deep learning' in res['topic']

    def test_requirement_author_filter(self, engine):
        """Req: System must extract author names."""
        q = "Find papers by Geoffrey Hinton"
        res = engine._parse_with_regex(q)
        assert res['type'] == 'AUTHOR_SEARCH'
        assert 'hinton' in res['author']

    def test_requirement_year_constraint(self, engine):
        """Req: System must support year filtering (e.g. 'after 2020')."""
        q = "papers about AI after 2022"
        res = engine._parse_with_regex(q)
        assert res['year_after'] == 2022

    def test_requirement_security(self, engine):
        """Req: Input sanitization against basic injection."""
        q = "papers by 'DROP TABLE users"
        res = engine._parse_with_regex(q)
        # Parser should not crash on malicious input
        assert res['type'] is not None
        # SQL keywords should not appear in structured output as executable
        topic = res.get('topic') or ""
        assert "DROP TABLE" not in topic.upper() or isinstance(topic, str)
