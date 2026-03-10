import requests
import logging
from src.config import Config

class SemanticScholarClient:
    """
    Client for the Semantic Scholar Graph API.
    Docs: https://api.semanticscholar.org/api-docs/graph
    """
    
    BASE_URL = "https://api.semanticscholar.org/graph/v1"
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or Config.SEMANTIC_SCHOLAR_API_KEY
        self.headers = {"x-api-key": self.api_key} if self.api_key else {}
        if not self.api_key:
            logging.warning("Semantic Scholar API Key not found. Requests may be rate-limited.")

    def search_papers(self, query: str, limit: int = 10, sort: str = None, fields: str = "title,authors,year,abstract,venue,externalIds,openAccessPdf,url"):
        """
        Search for papers by keyword.
        sort: 'relevance', 'publicationDate:desc', 'citationCount:desc'
        """
        url = f"{self.BASE_URL}/paper/search"
        params = {
            "query": query,
            "limit": limit,
            "fields": fields
        }
        if sort:
            params["sort"] = sort
        
        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get("data", [])
            elif response.status_code == 403:
                logging.error("Semantic Scholar API: 403 Forbidden (Invalid Key?)")
            else:
                logging.error(f"Semantic Scholar API Error: {response.status_code} - {response.text}")
        except Exception as e:
            logging.error(f"Semantic Scholar Connection Failed: {e}")
            
        return []

    def search_normalized(self, query: str, limit: int = 10, sort: str = None):
        """
        Search and return papers in the standard application format.
        Matches ArxivIngestor.load_data() output structure.
        """
        raw_papers = self.search_papers(query, limit=limit, sort=sort)
        normalized = []
        
        # Load Spacy locally if needed (optimization: load once class-level if frequent)
        import spacy
        nlp = None
        try:
            nlp = spacy.load("en_core_web_sm")
        except:
            pass

        for p in raw_papers:
            title = p.get('title', 'Unknown Title')
            abstract = p.get('abstract') or ""
            year = p.get('year') or "Unknown"
            venue = p.get('venue') or "S2"
            
            # Extract Authors
            raw_authors = p.get('authors', [])
            author_names = [a.get('name') for a in raw_authors if a.get('name')]
            
            # Construct text content
            text_content = f"{title}. {abstract}"
            
            # Entity Extraction (NER)
            entities = []
            
            # 1. Add Query as TOPIC (Connectivity Fix)
            clean_query = query.strip()
            if clean_query and len(clean_query) > 2:
                 entities.append({"text": clean_query, "label": "TOPIC"})

            if nlp and abstract:
                try:
                    doc = nlp(abstract[:2000]) # Cap for speed
                    seen_ents = {clean_query.lower()}
                    for ent in doc.ents:
                        if ent.label_ in ['PERSON', 'ORG'] and ent.text.lower() not in seen_ents:
                             if len(ent.text) > 2 and "\n" not in ent.text and not ent.text.lower() in ["the", "abstract"]:
                                 entities.append({"text": ent.text, "label": ent.label_})
                                 seen_ents.add(ent.text.lower())
                except Exception:
                    pass

            # Determine Download URL
            pdf_url = None
            if p.get('openAccessPdf'):
                pdf_url = p['openAccessPdf'].get('url')
            elif p.get('externalIds') and p['externalIds'].get('ArXiv'):
                pdf_url = f"https://arxiv.org/pdf/{p['externalIds']['ArXiv']}.pdf"
            
            # Create standard object
            normalized.append({
                "title": title,
                "text": text_content,
                "year": year,
                "filename": f"s2_{p['paperId'][:8]}.pdf", # Fake filename for display
                "source": f"Semantic Scholar ({venue})",
                "entities": entities, 
                "authors": author_names,
                "s2_id": p['paperId'],
                "doi": p.get('externalIds', {}).get('DOI'),
                "pdf_url": pdf_url,
                "url": p.get('url')
            })
            
        return normalized

    def get_paper_details(self, paper_id: str, fields: str = "title,authors,year,abstract,venue,externalIds,citationCount"):

        """
        Get details for a specific paper by ID (DOI, ArXiv ID, or S2 ID).
        IDs can be: 'DOI:10.1145/...', 'ARXIV:2106.15928', etc.
        """
        url = f"{self.BASE_URL}/paper/{paper_id}"
        params = {"fields": fields}
        
        try:
            response = requests.get(url, headers=self.headers, params=params, timeout=10)
            if response.status_code == 200:
                return response.json()
            else:
                # 404 is common if the paper isn't indexed yet
                if response.status_code != 404:
                    logging.error(f"Semantic Scholar Fetch Error ({paper_id}): {response.status_code}")
        except Exception as e:
            logging.error(f"Semantic Scholar Fetch Failed: {e}")
            
        return None
