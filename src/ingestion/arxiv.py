import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Any
from src.ingestion.loader import DataSource

import spacy

class ArxivIngestor(DataSource):
    def __init__(self, query: str = "cat:cs.AI", max_results: int = 10, sort_by: str = "relevance"):
        self.base_url = "http://export.arxiv.org/api/query?"
        self.query = query
        # CAP LIMIT to avoid 500 Errors
        if max_results > 1000:
            print(f"Warning: Requests > 1000 can crash ArXiv API. Capping limit from {max_results} to 1000.")
            max_results = 1000
        self.max_results = max_results
        self.sort_by = sort_by
        
        # Load Spacy for NER
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except:
            self.nlp = None

    def load_data(self) -> List[Dict[str, Any]]:
        print(f"Fetching {self.max_results} papers from ArXiv (Query: {self.query}, Sort: {self.sort_by})...")
        
        params = {
            "search_query": self.query,
            "start": 0,
            "max_results": self.max_results,
            "sortBy": self.sort_by,
            "sortOrder": "descending"
        }
        url = self.base_url + urllib.parse.urlencode(params)
        
        try:
            with urllib.request.urlopen(url) as response:
                xml_data = response.read()
                
            root = ET.fromstring(xml_data)
            # ArXiv uses Atom namespace
            ns = {'atom': 'http://www.w3.org/2005/Atom'}
            
            papers = []
            for entry in root.findall('atom:entry', ns):
                title = entry.find('atom:title', ns).text.strip().replace('\n', ' ')
                summary = entry.find('atom:summary', ns).text.strip().replace('\n', ' ')
                published = entry.find('atom:published', ns).text
                
                # Extract year from "2023-10-05T..."
                try:
                    dt = datetime.strptime(published, "%Y-%m-%dT%H:%M:%SZ")
                    year = dt.year
                except:
                    year = "Unknown"

                # Extract Authors
                authors_list = []
                for author in entry.findall('atom:author', ns):
                    name = author.find('atom:name', ns).text
                    if name:
                        authors_list.append(name.strip())
                
                # Extract ID and PDF URL
                # atom:id is usually http://arxiv.org/abs/2103.00020
                atom_id = entry.find('atom:id', ns).text
                pdf_url = atom_id.replace("abs", "pdf") + ".pdf"

                # Entity Extraction
                entities = []
                # 1. Add the Search Query itself as a primary TOPIC entity (ensures graph connectivity)
                # Clean prefix triggers like "cat:", "au:"
                clean_query = self.query
                if ":" in clean_query: clean_query = clean_query.split(":")[-1]
                clean_query = clean_query.strip()
                
                if clean_query and len(clean_query) > 2:
                     entities.append({"text": clean_query, "label": "TOPIC"})

                if self.nlp:
                    try:
                        # Summary is usually short, process it all
                        doc_spacy = self.nlp(summary)
                        seen_ents = {clean_query.lower()} # Avoid dupe
                        for ent in doc_spacy.ents:
                            if ent.label_ in ['PERSON', 'ORG'] and ent.text.lower() not in seen_ents:
                                if len(ent.text) > 2 and "\n" not in ent.text:
                                    entities.append({"text": ent.text, "label": ent.label_})
                                    seen_ents.add(ent.text.lower())
                    except Exception as e:
                        pass # Silent fail for NER

                papers.append({
                    "title": title,
                    "text": title + ". " + summary, # Combine for similarity search
                    "year": year,
                    "filename": f"arxiv_{title[:10].replace(' ', '_')}.pdf",
                    "source": "ArXiv API",
                    "authors": authors_list,
                    "entities": entities,
                    "pdf_url": pdf_url
                })
            
            print(f"Successfully fetched {len(papers)} papers from ArXiv.")
            return papers

        except Exception as e:
            print(f"Error fetching from ArXiv: {e}")
            return []

if __name__ == "__main__":
    ingestor = ArxivIngestor()
    docs = ingestor.load_data()
    if docs:
        print(f"Sample: {docs[0]['title']} ({docs[0]['year']})")
