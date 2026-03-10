"""
OpenAlex API client for academic paper search.
Docs: https://docs.openalex.org/
"""
import requests
import logging
from typing import List, Dict, Any

class OpenAlexClient:
    """Client for querying the OpenAlex scholarly works catalog."""
    
    BASE_URL = "https://api.openalex.org"
    
    def __init__(self, email: str = None):
        self.email = email
        self.headers = {"User-Agent": f"TimelineExplorer/1.0 (mailto:{email})" if email else "TimelineExplorer/1.0"}
    
    def search_works(self, query: str, limit: int = 20) -> List[Dict]:
        """
        Search for academic works by keyword.
        Returns raw OpenAlex format.
        """
        url = f"{self.BASE_URL}/works"
        params = {
            "search": query,
            "per_page": min(limit, 50),  # Max 50 per page
            "select": "id,doi,title,publication_year,abstract_inverted_index,authorships,primary_location,open_access,cited_by_count"
        }
        
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("results", [])
            else:
                logging.error(f"OpenAlex API Error: {resp.status_code}")
        except Exception as e:
            logging.error(f"OpenAlex Connection Failed: {e}")
        
        return []
    
    def search_normalized(self, query: str, limit: int = 20) -> List[Dict]:
        """
        Search and return papers in application-standard format.
        Matches ArxivIngestor/SemanticScholar output structure.
        """
        raw_works = self.search_works(query, limit)
        normalized = []
        
        for work in raw_works:
            try:
                # Reconstruct abstract from inverted index
                abstract = self._reconstruct_abstract(work.get("abstract_inverted_index"))
                
                # Extract authors
                authors = ", ".join([
                    a.get("author", {}).get("display_name", "Unknown")
                    for a in work.get("authorships", [])[:5]  # Limit to 5
                ])
                if len(work.get("authorships", [])) > 5:
                    authors += " et al."
                
                # Get PDF URL if open access
                pdf_url = None
                oa = work.get("open_access", {})
                if oa.get("is_oa"):
                    pdf_url = oa.get("oa_url")
                
                # Get DOI
                doi = work.get("doi", "").replace("https://doi.org/", "") if work.get("doi") else None
                
                paper = {
                    "title": work.get("title", "Untitled"),
                    "authors": authors,
                    "year": work.get("publication_year"),
                    "abstract": abstract or "No abstract available.",
                    "text": abstract or "",
                    "source": "OpenAlex",
                    "pdf_url": pdf_url,
                    "doi": doi,
                    "citations": work.get("cited_by_count", 0),
                    "entities": []  # Will be extracted by NLP if needed
                }
                normalized.append(paper)
            except Exception as e:
                logging.warning(f"Failed to normalize OpenAlex work: {e}")
                continue
        
        return normalized
    
    def _reconstruct_abstract(self, inverted_index: Dict) -> str:
        """
        OpenAlex stores abstracts as inverted index for compression.
        Reconstruct to plain text.
        """
        if not inverted_index:
            return ""
        
        # Build position -> word mapping
        words = {}
        for word, positions in inverted_index.items():
            for pos in positions:
                words[pos] = word
        
        # Sort by position and join
        sorted_words = [words[i] for i in sorted(words.keys())]
        return " ".join(sorted_words)
    
    def get_work_by_doi(self, doi: str) -> Dict:
        """Fetch single work by DOI."""
        url = f"{self.BASE_URL}/works/doi:{doi}"
        try:
            resp = requests.get(url, headers=self.headers, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logging.error(f"OpenAlex DOI lookup failed: {e}")
        return {}
    
    def get_year_counts(self, query: str, start_year: int = 1990) -> Dict[int, int]:
        """Get publication counts per year for a topic using group_by endpoint."""
        url = f"{self.BASE_URL}/works"
        params = {
            "search": query,
            "group_by": "publication_year",
            "per_page": 200
        }
        
        try:
            resp = requests.get(url, headers=self.headers, params=params, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                year_counts = {}
                for group in data.get("group_by", []):
                    year = group.get("key")
                    count = group.get("count", 0)
                    if year and str(year).isdigit():
                        y = int(year)
                        if y >= start_year:
                            year_counts[y] = count
                return year_counts
        except Exception as e:
            logging.error(f"OpenAlex year counts failed: {e}")
        
        return {}

