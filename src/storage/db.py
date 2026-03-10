import sqlite3
import json
import os
from typing import List, Dict, Any

import re
from datetime import datetime

def recover_year(title: str, text: str = "", doi: str = None) -> Any:
    """
    Attempts to extract a 4-digit year (1990-2030) from:
    1. Title Regex
    2. Text Regex
    3. CrossRef API (if DOI is provided)
    """
    # 1. Regex for year 1990-2029 in Title
    match = re.search(r'\b(199\d|20[0-2]\d)\b', title)
    if match:
        return int(match.group(1))
    
    # 2. Try text snippet if title fails
    if text:
        match = re.search(r'\b(199\d|20[0-2]\d)\b', text[:500])
        if match:
            return int(match.group(1))

    # 3. CrossRef Logic (Last Resort)
    if doi:
        try:
            import urllib.request
            import json
            
            # Simple synchronous call (okay for "unknown" edge cases)
            url = f"https://api.crossref.org/works/{doi}"
            headers = {'User-Agent': 'InsightEngine/1.0 (mailto:research@example.com)'}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=3) as response:
                data = json.loads(response.read())
                msg = data.get('message', {})
                # Try print date -> online date -> created date
                date_parts = msg.get('published-print', {}).get('date-parts') or \
                             msg.get('published-online', {}).get('date-parts') or \
                             msg.get('created', {}).get('date-parts')
                
                if date_parts and date_parts[0]:
                    print(f"      [+] CrossRef recovered year for {doi}: {date_parts[0][0]}")
                    return int(date_parts[0][0])
        except Exception:
             pass # Fail silently
            
    return "Unknown"

class ResearchDatabase:
    def __init__(self, db_path="data/research.db"):
        self.db_path = db_path
        # Ensure directory exists
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        # Allow multi-threaded access for Streamlit
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.create_tables()

    def create_tables(self):
        c = self.conn.cursor()
        # Papers Table
        c.execute('''CREATE TABLE IF NOT EXISTS papers
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      title TEXT,
                      year INTEGER,
                      abstract TEXT,
                      source TEXT,
                      pdf_url TEXT,
                      vector blob)''') 
        
        # Entities Table (New)
        c.execute('''CREATE TABLE IF NOT EXISTS entities
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT,
                      type TEXT,
                      UNIQUE(name, type))''')
                      
        # Authors Table (New)
        c.execute('''CREATE TABLE IF NOT EXISTS authors
                     (id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT UNIQUE)''')
                      
        # Paper-Authors Table
        c.execute('''CREATE TABLE IF NOT EXISTS paper_authors
                     (paper_id INTEGER,
                      author_id INTEGER,
                      FOREIGN KEY(paper_id) REFERENCES papers(id),
                      FOREIGN KEY(author_id) REFERENCES authors(id),
                      UNIQUE(paper_id, author_id))''')
                      
        # Relations Table (New)
        c.execute('''CREATE TABLE IF NOT EXISTS paper_entities
                     (paper_id INTEGER,
                      entity_id INTEGER,
                      FOREIGN KEY(paper_id) REFERENCES papers(id),
                      FOREIGN KEY(entity_id) REFERENCES entities(id),
                      UNIQUE(paper_id, entity_id))''')
        
        self.conn.commit()

    def add_papers(self, papers: List[Dict[str, Any]]):
        c = self.conn.cursor()
        for p in papers:
            # Check if exists (simple title check)
            c.execute("SELECT id FROM papers WHERE title = ?", (p['title'],))
            row = c.fetchone()
            if row:
                paper_id = row[0]
                # Update existing if needed, but for now skip
            else:
                # Year Recovery
                year = p.get('year')
                if not year or year == "Unknown":
                    year = recover_year(p.get('title', ''), p.get('text', ''), p.get('doi'))
                
                c.execute("INSERT INTO papers (title, year, abstract, source, pdf_url) VALUES (?, ?, ?, ?, ?)",
                          (p.get('title', 'Unknown'), 
                           year, 
                           p.get('text', '')[:2000], 
                           p.get('source', 'Unknown'), # Fixed: Was using filename
                           p.get('pdf_url')))
                paper_id = c.lastrowid
            
            # Store ID in paper dict for downstream use
            p['db_id'] = paper_id
            
            # If paper has entities, store them
            if 'entities' in p:
                self.save_entities(paper_id, p['entities'])

            # If paper has authors, store them
            if 'authors' in p:
                self.save_authors(paper_id, p['authors'])
                
        self.conn.commit()

    def save_entities(self, paper_id: int, entities: List[Dict[str, str]]):
        c = self.conn.cursor()
        for ent in entities:
             # Handle string entities safely
            if isinstance(ent, str):
                name, label = ent, "TOPIC"
            else:
                name, label = ent.get('text', 'Unknown'), ent.get('label', 'TOPIC')
            
            if not name: continue

            # Insert Entity (Ignore if exists)
            c.execute("INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)", 
                      (name, label))
            
            # Get Entity ID
            c.execute("SELECT id FROM entities WHERE name = ? AND type = ?", 
                      (name, label))
            res = c.fetchone()
            if res:
                ent_id = res[0]
                # Link Paper -> Entity
                c.execute("INSERT OR IGNORE INTO paper_entities (paper_id, entity_id) VALUES (?, ?)",
                        (paper_id, ent_id))

    def save_authors(self, paper_id: int, authors: List[str]):
        c = self.conn.cursor()
        for auth_name in authors:
             # Normalize
             auth_name = auth_name.strip()
             if not auth_name: continue
             
             # Insert Author
             c.execute("INSERT OR IGNORE INTO authors (name) VALUES (?)", (auth_name,))
             
             # Get ID
             c.execute("SELECT id FROM authors WHERE name = ?", (auth_name,))
             row = c.fetchone()
             if row:
                 auth_id = row[0]
                 # Link
                 c.execute("INSERT OR IGNORE INTO paper_authors (paper_id, author_id) VALUES (?, ?)",
                           (paper_id, auth_id))
    
    def search_papers(self, query: str, min_year: int = 1900, max_year: int = 2100, limit: int = 50, sort_sql: str = "ORDER BY p.year DESC") -> List[Dict[str, Any]]:
        self.conn.row_factory = sqlite3.Row
        c = self.conn.cursor()
        
        # Core Query with Group Concat for Authors and Entities
        # NOTE: GROUP_CONCAT in SQLite is simple.
        sql = f"""
        SELECT 
            p.id, p.title, p.year, p.abstract, p.source, p.pdf_url,
            GROUP_CONCAT(DISTINCT a.name) as authors,
            GROUP_CONCAT(DISTINCT e.name) as entities_txt
        FROM papers p
        LEFT JOIN paper_authors pa ON p.id = pa.paper_id
        LEFT JOIN authors a ON pa.author_id = a.id
        LEFT JOIN paper_entities pe ON p.id = pe.paper_id
        LEFT JOIN entities e ON pe.entity_id = e.id
        WHERE (p.title LIKE ? OR p.abstract LIKE ?)
        AND (p.year >= ? AND p.year <= ?)
        GROUP BY p.id
        {sort_sql}
        LIMIT ?
        """
        
        params = (f"%{query}%", f"%{query}%", min_year, max_year, limit)
        c.execute(sql, params)
        rows = c.fetchall()
        
        results = []
        for r in rows:
            d = dict(r)
            # Re-format entities/authors from string back to list if needed, or keep string
            # For UI, string is fine, but for consistency let's match the dict format
            if d.get('entities_txt'):
                d['entities'] = [{'text': x, 'label': 'Topic'} for x in d['entities_txt'].split(',')]
            else:
                d['entities'] = []
            results.append(d)
            
        return results

    def get_all_papers(self) -> List[Dict[str, Any]]:
        return self.search_papers("", min_year=0, limit=1000)
    
    def find_papers_by_entity(self, entity_name: str) -> List[Dict[str, Any]]:
        # Simplified for now using search
        return self.search_papers(entity_name, limit=20)

    def get_index_terms(self, limit: int = 20) -> List[tuple]:
        """Returns list of (Term, Count) for the sidebar index."""
        c = self.conn.cursor()
        
        # 1. Try Entities Table first
        c.execute("SELECT name, count(*) as cnt FROM entities GROUP BY name ORDER BY cnt DESC LIMIT ?", (limit,))
        rows = c.fetchall()
        if rows and len(rows) > 5:
            return [(r[0], r[1]) for r in rows]
            
        # 2. Fallback: Parse Titles if no entities
        c.execute("SELECT title FROM papers")
        titles = [r[0] for r in c.fetchall() if r[0]]
        
        from collections import Counter
        words = []
        stopwords = {'the', 'a', 'an', 'of', 'in', 'on', 'and', 'for', 'to', 'with', 'using', 'based', 'analysis', 'study', 'citation'}
        for t in titles:
            # Simple cleaning
            clean = re.sub(r'[^a-zA-Z\s]', '', t.lower())
            for w in clean.split():
                if len(w) > 3 and w not in stopwords:
                    words.append(w.capitalize())
        
        return Counter(words).most_common(limit)

    def get_stats(self):
        c = self.conn.cursor()
        c.execute("SELECT source, COUNT(*) FROM papers GROUP BY source")
        return c.fetchall()

    def delete_papers(self, query: str) -> List[str]:
        """
        Deletes papers matching the title query.
        Special Case: query='unknown' deletes papers with year='Unknown'.
        """
        c = self.conn.cursor()
        
        # Determine Search Mode
        if query.lower() == 'unknown':
            where_clause = "year = 'Unknown'"
            params = ()
        else:
            where_clause = "title LIKE ?"
            params = (f"%{query}%",)
        
        # Find ID and Titles first
        c.execute(f"SELECT id, title FROM papers WHERE {where_clause}", params)
        rows = c.fetchall()
        if not rows:
            return []
            
        deleted_titles = [r[1] for r in rows]
        ids = [str(r[0]) for r in rows]
        
        if not ids: return []

        # Delete from relational tables first
        id_list = ",".join(ids)
        c.execute(f"DELETE FROM paper_authors WHERE paper_id IN ({id_list})")
        c.execute(f"DELETE FROM paper_entities WHERE paper_id IN ({id_list})")
        c.execute(f"DELETE FROM papers WHERE id IN ({id_list})")
        
        self.conn.commit()
        return deleted_titles

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    db = ResearchDatabase()
    print("Database initialized.")
