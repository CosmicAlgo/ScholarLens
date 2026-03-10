"""
Wikipedia API client for fetching concept summaries.
"""
import logging
from typing import Dict, Optional

class WikipediaClient:
    """Client for fetching concept summaries from Wikipedia."""
    
    def __init__(self, language: str = "en"):
        self.language = language
        self._wiki = None
    
    def _get_wiki(self):
        """Lazy load wikipedia library."""
        if self._wiki is None:
            try:
                import wikipediaapi
                self._wiki = wikipediaapi.Wikipedia(
                    user_agent="TimelineExplorer/1.0",
                    language=self.language
                )
            except ImportError:
                logging.error("wikipedia-api not installed. Run: pip install wikipedia-api")
                return None
        return self._wiki
    
    def get_summary(self, topic: str, sentences: int = 3) -> Optional[Dict]:
        """
        Get a brief summary of a topic.
        Returns: {title, summary, url} or None if not found.
        """
        wiki = self._get_wiki()
        if not wiki:
            return None
        
        try:
            page = wiki.page(topic)
            if page.exists():
                # Get first N sentences
                full_summary = page.summary
                summary_sentences = full_summary.split(". ")[:sentences]
                short_summary = ". ".join(summary_sentences)
                if not short_summary.endswith("."):
                    short_summary += "."
                
                return {
                    "title": page.title,
                    "summary": short_summary,
                    "url": page.fullurl,
                    "full_text": full_summary[:1000]  # First 1000 chars
                }
        except Exception as e:
            logging.warning(f"Wikipedia lookup failed for '{topic}': {e}")
        
        return None
    
    def search_topics(self, query: str, limit: int = 5) -> list:
        """
        Search for related Wikipedia topics.
        Returns list of page titles.
        """
        try:
            import wikipedia
            results = wikipedia.search(query, results=limit)
            return results
        except ImportError:
            # Fallback: use wikipedia-api if available
            logging.warning("wikipedia library not available for search")
            return []
        except Exception as e:
            logging.warning(f"Wikipedia search failed: {e}")
            return []
