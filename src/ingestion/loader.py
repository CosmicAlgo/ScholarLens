import os
import fitz  # PyMuPDF
from typing import List, Dict, Any, Optional
import openpyxl
from abc import ABC, abstractmethod

import spacy

# Base class for data source implementations
class DataSource(ABC):
    @abstractmethod
    def load_data(self) -> List[Dict[str, Any]]:
        pass

class PDFIngestor(DataSource):
    def __init__(self, papers_dir: str, excel_index_path: Optional[str] = None):
        self.papers_dir = papers_dir
        self.excel_path = excel_index_path
        self.metadata_map = {}
        
        # Load Spacy for NER
        try:
            self.nlp = spacy.load("en_core_web_sm")
        except:
            print("Warning: Spacy model 'en_core_web_sm' not found. NER disabled.")
            self.nlp = None
        
        if self.excel_path and os.path.exists(self.excel_path):
            self._load_metadata()

    def _load_metadata(self):
        """Loads metadata from Excel if available (Year, Title, etc.)"""
        try:
            wb = openpyxl.load_workbook(self.excel_path, data_only=True)
            sheet = wb.active
            # Assuming row 1 is headers. We need 'paper_pdf' and 'Publication Year' or similar.
            headers = [cell.value for cell in sheet[1]]
            
            # Helper to find column index by name (case insensitive)
            def get_col_idx(name_part):
                for i, h in enumerate(headers):
                    if h and name_part.lower() in str(h).lower():
                        return i
                return -1

            pdf_col = get_col_idx('pdf')
            year_col = get_col_idx('year')
            title_col = get_col_idx('title')

            for row in sheet.iter_rows(min_row=2, values_only=True):
                if pdf_col != -1 and row[pdf_col]:
                    filename = os.path.basename(row[pdf_col])
                    self.metadata_map[filename] = {
                        "year": row[year_col] if year_col != -1 else None,
                        "title": row[title_col] if title_col != -1 else None
                    }
        except Exception as e:
            print(f"Warning: Could not load metadata from Excel: {e}")

    def load_data(self) -> List[Dict[str, Any]]:
        results = []
        if not os.path.exists(self.papers_dir):
            print(f"Directory not found: {self.papers_dir}")
            return []

        # Recursive search using os.walk
        for root, dirs, files in os.walk(self.papers_dir):
            # Skip hidden directories like __MACOSX
            if '__MACOSX' in root:
                continue
                
            for filename in files:
                if filename.lower().endswith(".pdf") and not filename.startswith("."):
                    filepath = os.path.join(root, filename)
                    try:
                        # Extract Text
                        text = ""
                        with fitz.open(filepath) as doc:
                            for page in doc:
                                text += page.get_text()
                        
                        # Merge with Metadata
                        meta = self.metadata_map.get(filename, {})
                        year = meta.get("year")
                    
                        if not year:
                            import re
                            # Strategy: Weighted Heuristics
                            # We look for years with specific context clues and assign 'confidence'.
                            
                            import datetime
                            candidates = []
                            current_year = datetime.datetime.now().year

                            # Pattern A: Explicit Metadata in Text (Score: 10)
                            # Matches: "Published: 2021", "12 May 2021", "Copyright 2021"
                            # FIX: Scan ENTIRE first page (4000+ chars possible for footers)
                            search_text = text 
                            
                            strong_pattern = r'(?:published|accepted|received|copyright|©|vol|issue|january|february|march|april|may|june|july|august|september|october|november|december)[^0-9]{0,30}(\b20[0-2][0-9]\b|\b19[8-9][0-9]\b)'
                            for m in re.finditer(strong_pattern, search_text, re.IGNORECASE):
                                candidates.append((int(m.group(1)), 10))
                                
                            # Pattern B: Clean Date Format (Score: 6)
                            # Matches: "14 June 2014", "June 2014" (without "Published" prefix)
                            date_pattern = r'(?:\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (?:19|20)[0-9]{2})|(?:\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (?:19|20)[0-9]{2})'
                            # Extract just the year from these matches
                            for m in re.finditer(date_pattern, search_text, re.IGNORECASE):
                                match_str = m.group(0)
                                y_match = re.search(r'\b(19|20)[0-9]{2}\b', match_str)
                                if y_match:
                                    candidates.append((int(y_match.group(0)), 6))

                            # Pattern C: Header Date (Score: 4)
                            # Just a year appearing very early (first 300 chars) KEEP THIS LIMIT for headers
                            early_pattern = r'(?:^|\n|\s|\()(\b20[0-2][0-9]\b|\b19[9][0-9]\b)(?:[\.\,\;\)]?(?:\n|\s|$))'
                            for m in re.finditer(early_pattern, search_text[:500]):
                                candidates.append((int(m.group(1)), 4))

                            # Pattern D: ACM Reference Format (Score: 9)
                            # "ACM Reference format: ... 2022."
                            if "ACM Reference format" in search_text:
                                acm_pattern = r'ACM Reference format:.*?(\b20[0-2][0-9]\b)'
                                for m in re.finditer(acm_pattern, search_text, re.DOTALL):
                                    candidates.append((int(m.group(1)), 9))
                                
                            if candidates:
                                # Prioritize highest score, then most recent year
                                best_candidate = max(candidates, key=lambda x: (x[1], x[0]))
                                year = best_candidate[0]
                            else:
                                year = "Unknown"

                        # --- FALLBACK: DOI LOOKUP (If Year is Unknown) ---
                        if year == "Unknown":
                            # Try to find DOI (Scan FULL text)
                            doi_match = re.search(r'\b(10\.\d{4,9}/[-._;()/:a-zA-Z0-9]+)\b', text)
                            if doi_match:
                                doi = doi_match.group(1)
                                print(f"      [?] Found DOI: {doi}. Querying CrossRef...")
                                try:
                                    import urllib.request
                                    import json
                                    
                                    url = f"https://api.crossref.org/works/{doi}"
                                    # User-Agent is polite to avoid 403
                                    headers = {'User-Agent': 'InsightEngine/1.0 (mailto:research@example.com)'}
                                    req = urllib.request.Request(url, headers=headers)
                                    with urllib.request.urlopen(req, timeout=3) as response:
                                        data = json.loads(response.read())
                                        # Path: message -> published-print or published-online -> date-parts -> [0][0]
                                        msg = data.get('message', {})
                                        date_parts = msg.get('published-print', {}).get('date-parts') or \
                                                     msg.get('published-online', {}).get('date-parts') or \
                                                     msg.get('created', {}).get('date-parts')
                                        
                                        if date_parts and date_parts[0]:
                                            year = int(date_parts[0][0])
                                            print(f"      [+] CrossRef recovered year: {year}")
                                except Exception as e:
                                    print(f"      [-] CrossRef lookup failed: {e}")

                        # --- AUTHOR EXTRACTION (Heuristic) ---
                        authors_list = ["Unknown"]
                        
                        # Strategy: Look for lines after title or typical author patterns
                        # 1. Excel Metadata (Best)
                        # We don't have author col in excel logic above yet, but if we did...
                        
                        # 2. Heuristic: Lines 2-5 of text often contain authors
                        # Filter for lines that look like names (Title Case, no numbers, comma separated)
                        candidate_lines = text.split('\n')[:10]
                        potential_authors = []
                        
                        for line in candidate_lines:
                             line = line.strip()
                             if len(line) < 3 or len(line) > 100: continue
                             # skip emails
                             if "@" in line or "http" in line: continue 
                             # skip obvious headers
                             if "abstract" in line.lower() or "introduction" in line.lower(): break
                             
                             # If line has multiple capitalized words or commas
                             if "," in line or (sum(1 for c in line if c.isupper()) > 2):
                                 potential_authors.append(line)
                        
                        if potential_authors:
                            # Take the extensive one that isn't the title (assuming title is filename or meta)
                            # This is rough, but better than "Unknown"
                            authors_str = ", ".join(potential_authors[:2]) # Take first 2 plausible lines
                            authors_list = [authors_str]

                        # 3. Simple Spacy Person Extraction from Top 500 chars (if Heuristic fails)
                        if authors_list == ["Unknown"] and self.nlp:
                             doc_head = self.nlp(text[:500])
                             persons = [ent.text for ent in doc_head.ents if ent.label_ == "PERSON"]
                             # Filter junk
                             persons = [p for p in persons if len(p) > 3 and "\n" not in p and not any(char.isdigit() for char in p)]
                             if persons:
                                 # Dedupe and take top 3
                                 authors_list = list(set(persons))[:4]
                        
                        
                        # Entity Extraction (NER) using Spacy
                        entities = []
                        if self.nlp:
                            try:
                                # Processing first 10000 chars for ENTITIES to save time
                                doc_spacy = self.nlp(text[:10000])
                                seen_ents = set()
                                for ent in doc_spacy.ents:
                                    if ent.label_ in ['PERSON', 'ORG'] and ent.text not in seen_ents:
                                        # Filter basics
                                        if len(ent.text) > 2 and "\n" not in ent.text:
                                            entities.append({"text": ent.text, "label": ent.label_})
                                            seen_ents.add(ent.text)
                            except Exception as e:
                                print(f"NER Error on {filename}: {e}")

                        results.append({
                            "filename": filename,
                            "text": text,
                            "year": year,
                            "title": meta.get("title", filename),
                            "authors": authors_list, 
                            "entities": entities
                        })
                        print(f"Processed: {filename} (Year: {year}, Authors: {authors_list})")
                    
                    except Exception as e:
                        print(f"Error processing {filename}: {e}")
        
        return results

if __name__ == "__main__":
    # Test Run
    ingestor = PDFIngestor(
        papers_dir="data/papers/Papers",
        excel_index_path="data/papers/index.xlsx"
    )
    docs = ingestor.load_data()
    print(f"Total Papers Loaded: {len(docs)}")
    if docs:
        print("Sample:", docs[0]['title'], docs[0]['year'])
