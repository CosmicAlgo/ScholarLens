import re
from typing import Dict, Any, List
from src.storage.db import ResearchDatabase
from src.storage.graph_db import GraphDatabase

class QueryEngine:
    """
    Rule-Based Parser to convert Natural Language into Database Actions.
    "The Advisor"
    """
    def __init__(self, db: ResearchDatabase, graph_db: GraphDatabase):
        self.db = db
        self.graph_db = graph_db

    def parse(self, query: str) -> Dict[str, Any]:
        """
        Extracts intents using LLM (Ollama) if available, else Regex.
        """
        # Try LLM First
        llm_intent = self._parse_with_llm(query)
        if llm_intent:
            return llm_intent
            
        return self._parse_with_regex(query)

    def _parse_with_llm(self, query: str) -> Dict[str, Any]:
        import requests
        import json
        
        # OLLAMA_HOST should be 'ollama' in docker, or localhost if running locally
        # We try the docker service name first
        url = "http://ollama:11434/api/generate"
        
        prompt = f"""
        You are a Query Parser for a research engine.
        Analyze this user query: "{query}"
        
        Return ONLY a JSON object with these keys:
        - type: "AUTHOR_SEARCH" or "TOPIC_SEARCH" or "COMPLEX_FILTER"
        - author: (string or null)
        - topic: (string or null)
        - year_after: (int or null)
        - sort_by: "relevance" or "year"
        
        Rules:
        - If query asks for "best" or "top", sort_by="year".
        - If query mentions an author name (even with typos like "did david wrote"), extract the name.
        - Example: "did david wrote on AI after 2020" -> {{"type": "COMPLEX_FILTER", "author": "David", "topic": "AI", "year_after": 2020}}
        """
        
        payload = {
            "model": "llama3", # Much smarter (4GB) 
            "prompt": prompt,
            "stream": False,
            "format": "json" 
        }
        
        try:
            resp = requests.post(url, json=payload, timeout=300) # Increased to 5min for cold boot
            if resp.status_code == 200:
                body = resp.json()
                return json.loads(body['response'])
        except Exception:
             # logging.warning("Ollama not reachable or model not loaded. Falling back to Regex.")
             pass
        return None

    def _parse_with_regex(self, query: str) -> Dict[str, Any]:
        query = query.lower().strip()
        intent = {
            "type": "SEARCH",
            "topic": None,
            "author": None,
            "year_after": None,
            "sort_by": "relevance",
            "limit": 10
        }
        
        # ... (Existing Regex Logic Moved Here) ...
        # 1. Detect "Best" or "Top"
        if "best" in query or "top" in query:
             intent["sort_by"] = "year"

        # 2. Year Constraint
        year_match = re.search(r'(?:after|since|from)\s+(20\d{2}|19\d{2})', query)
        if year_match:
            intent["year_after"] = int(year_match.group(1))
            
        # 3. Author Regex
        author_patterns = [
            (r'(?:by|from|author)\s+([a-zA-Z\s\.]+?)(?:\s+on|\s+about|\s+in|\s+after|\s*\(|$)', 1),
            (r'did\s+([a-zA-Z\s\.]+?)\s+(?:write|rote|published?|authored?)', 1),
            (r'([a-zA-Z\s\.]+?)\s+(?:wrote|published|authored)', 1)
        ]
        for pat, grp_idx in author_patterns:
            match = re.search(pat, query)
            if match:
                raw_auth = match.group(grp_idx).strip()
                if raw_auth not in ['who', 'anyone']: 
                    raw_auth = re.sub(r'\b(papers|articles)\b', '', raw_auth).strip()
                    intent["author"] = re.sub(r'\b(did|does)\b', '', raw_auth).strip() # Extra cleanup
                    query = query.replace(match.group(0), "")
                    break
        
        # 4. Topic
        if intent["year_after"]:
             query = re.sub(r'(?:after|since|from)\s+(20\d{2}|19\d{2})', '', query)
        
        topic_match = re.search(r'(?:on|about|regarding|related to)\s+(.*)', query)
        if topic_match:
            intent["topic"] = topic_match.group(1).strip()
        elif not intent["author"]:
            stopwords = ["find", "show", "me", "papers", "get", "search", "related", "to"]
            cleaned = query
            for sw in stopwords:
                cleaned = re.sub(r'\b' + sw + r'\b', '', cleaned)
            intent["topic"] = cleaned.strip()

        # Route Selection
        if "summarize" in query or "overview" in query:
            intent["type"] = "SUMMARIZATION"
        elif intent["author"] and intent["topic"]:
            intent["type"] = "COMPLEX_FILTER"
        elif intent["author"]:
            intent["type"] = "AUTHOR_SEARCH"
        else:
            intent["type"] = "TOPIC_SEARCH"
            
        return intent

    def execute(self, query_text: str):
        parsed = self.parse(query_text)
        results = []
        explanation = ""

        # Router Logic
        if parsed["type"] == "AUTHOR_SEARCH":
            explanation = f"Looking for papers by '{parsed['author']}'"
            if parsed['year_after']: explanation += f" after {parsed['year_after']}"
            results = self.db.find_papers_by_entity(parsed["author"])
            
        elif parsed["type"] == "TOPIC_SEARCH" or parsed["type"] == "SUMMARIZATION":
            explanation = f"Searching for topic '{parsed['topic']}'"
            c = self.db.conn.cursor()
            c.execute("SELECT * FROM papers WHERE title LIKE ? OR abstract LIKE ?", 
                      (f"%{parsed['topic']}%", f"%{parsed['topic']}%"))
            rows = c.fetchall()
            results = [dict(r) for r in rows]

        elif parsed["type"] == "COMPLEX_FILTER":
            explanation = f"Filtering: Author='{parsed['author']}' AND Topic='{parsed['topic']}'"
            author_papers = self.db.find_papers_by_entity(parsed["author"])
            results = [p for p in author_papers if parsed["topic"] in p['title'].lower() or parsed["topic"] in p['abstract'].lower()]

        # Apply Year Filter
        if parsed["year_after"]:
            filtered = []
            for p in results:
                y = p.get('year')
                if isinstance(y, int) and y >= parsed["year_after"]:
                    filtered.append(p)
                elif isinstance(y, str) and y.isdigit() and int(y) >= parsed["year_after"]:
                     filtered.append(p)
            results = filtered

        # Apply Sort
        if parsed["sort_by"] == "year":
            results.sort(key=lambda x: x['year'] if isinstance(x['year'], int) else 0, reverse=True)

        # Handle Summarization
        if parsed["type"] == "SUMMARIZATION":
            if not results:
                return [], "No papers found to summarize.", parsed
            
            explanation += " -> Generative Summary"
            summary_text = self._generate_summary(results[:5], parsed['topic'])
            # Return empty list of results but full explanation text so CLI shows text
            return results, f"\n[GENERATED SUMMARY]\n{summary_text}", parsed

        return results, explanation, parsed

    def semantic_search_papers(self, query: str, top_k: int = 30) -> List[Dict]:
        """
        Performs semantic search using embeddings + optional query expansion.
        This is the primary method for Research and Timeline tabs.
        
        Args:
            query: User's search query (e.g., "Machine Learning").
            top_k: Maximum number of results to return.
            
        Returns:
            List of paper dictionaries, ranked by semantic similarity.
        """
        from src.processing.embedding_service import get_embedding_service
        
        # Step 1: Get all papers from DB WITH authors (same JOIN as search_papers)
        sql = """
        SELECT 
            p.id, p.title, p.year, p.abstract, p.source, p.pdf_url,
            GROUP_CONCAT(DISTINCT a.name) as authors,
            GROUP_CONCAT(DISTINCT e.name) as entities_txt
        FROM papers p
        LEFT JOIN paper_authors pa ON p.id = pa.paper_id
        LEFT JOIN authors a ON pa.author_id = a.id
        LEFT JOIN paper_entities pe ON p.id = pe.paper_id
        LEFT JOIN entities e ON pe.entity_id = e.id
        GROUP BY p.id
        """
        c = self.db.conn.cursor()
        c.execute(sql)
        rows = c.fetchall()
        
        # Convert to dicts with proper entity formatting
        all_papers = []
        for r in rows:
            d = dict(r)
            # Use abstract column, fallback to text column format
            d['text'] = d.get('abstract', '')
            if d.get('entities_txt'):
                d['entities'] = [{'text': x, 'label': 'Topic'} for x in d['entities_txt'].split(',')]
            else:
                d['entities'] = []
            all_papers.append(d)
        
        if not all_papers:
            return []
        
        # Step 2: Use embedding service for semantic matching
        embedding_service = get_embedding_service()
        
        # Step 3: (Optional) Expand query using TinyDolphin for better recall
        # We combine original + expanded terms into one enriched query
        expanded_terms = self.expand_query_fast(query)
        enriched_query = " ".join(expanded_terms)  # e.g., "Machine Learning Deep Learning Neural Networks"
        
        # Step 4: Semantic search
        results_with_scores = embedding_service.search_papers_semantic(
            enriched_query, 
            all_papers, 
            top_k=top_k
        )
        
        # Extract just the papers (without scores) for compatibility
        return [paper for paper, score in results_with_scores]

    def get_timeline_data(self, query: str) -> Dict[int, int]:
        """
        Gets paper counts by year for a given topic using semantic search.
        Used by the Timeline Tab.
        
        Args:
            query: Topic to search (e.g., "Climate Change").
            
        Returns:
            Dictionary of {year: count}.
        """
        papers = self.semantic_search_papers(query, top_k=100)
        
        # Aggregate by year
        year_counts = {}
        for p in papers:
            year = p.get('year')
            if year:
                try:
                    y = int(year)
                    year_counts[y] = year_counts.get(y, 0) + 1
                except (ValueError, TypeError):
                    pass
        
        return year_counts

    def summarize_paper(self, title: str, abstract: str) -> str:
        import requests
        
        prompt = f"""
        Analyze this research paper.
        Title: {title}
        Abstract: {abstract}
        
        Provide a concise 3-sentence summary highlighting the key contribution, methodology, and finding.
        """
        
        payload = {
            "model": "tinydolphin",
            "prompt": prompt,
            "stream": False
        }
        
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=90) # Cold Start can take 60s+
            if resp.status_code == 200:
                return resp.json()['response']
        except Exception as e:
            return f"Error generating summary: {e}"
        return "No summary generated."

    def extract_keywords(self, user_query: str) -> str:
        """Converts a complex natural language query into a clean keyword string for ArXiv/S2."""
        import requests
        prompt = f"""
        You are a silent keyword extractor.
        User Query: "{user_query}"
        
        Task: Output ONLY the essential search keywords separated by spaces.
        Constraints:
        - NO introductory text (e.g. "Here are the keywords").
        - NO explanations.
        - NO punctuation.
        - Just the raw keyword string.
        """
        payload = {"model": "llama3", "prompt": prompt, "stream": False}
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=90) # Cold Start can take 60s+
            if resp.status_code == 200:
                raw = resp.json()['response'].strip().replace('"', '').replace("'", "")
                # Post-processing: If Llama is still chatty, take the last line or first line?
                # Usually "Here is..." is first line. But keywords might be last.
                # Let's simple split by newline and find the shortest line that isn't empty?
                # Actually, stricter prompt usually works. Let's trust the "silent" instruction.
                # But as failsafe, remove common chatty prefixes.
                if ":" in raw: raw = raw.split(":")[-1].strip()
                return raw
        except: return user_query
        return user_query

    def expand_query_fast(self, query: str) -> List[str]:
        """
        Uses TinyDolphin (fast local LLM) to expand a search query into related terms.
        This improves search recall by finding semantically related concepts.
        
        Args:
            query: User's original search term (e.g., "Machine Learning").
            
        Returns:
            List of related terms including the original query.
        """
        import requests
        import json
        
        prompt = f"""You are an academic thesaurus. Given this search term, list 5 closely related academic concepts.
Term: "{query}"

Output ONLY a JSON array of strings, nothing else.
Example for "Reinforcement Learning": ["Reinforcement Learning", "Q-Learning", "Policy Gradient", "MDP", "Deep RL"]
"""
        
        payload = {
            "model": "tinydolphin",  # Faster than llama3
            "prompt": prompt,
            "stream": False
        }
        
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=60)
            if resp.status_code == 200:
                raw = resp.json()['response'].strip()
                # Try to parse JSON
                # Handle cases where model adds extra text
                if "[" in raw and "]" in raw:
                    start = raw.index("[")
                    end = raw.rindex("]") + 1
                    raw = raw[start:end]
                terms = json.loads(raw)
                if isinstance(terms, list):
                    # Ensure original query is included
                    if query not in terms:
                        terms.insert(0, query)
                    return terms[:6]  # Cap at 6 terms
        except Exception:
            pass
        
        # Fallback: return original query only
        return [query]

    def detect_intent(self, user_query: str) -> str:
        """Determines if the user wants to FIND papers (RESEARCH) or just wants an EXPLANATION (QA)."""
        import requests
        prompt = f"""
        Classify this user query into one of two categories: 'RESEARCH' (looking for papers, datasets, timeline) or 'QA' (asking for a definition or explanation without needing new data).
        Query: {user_query}
        Return ONLY the category name.
        """
        payload = {"model": "llama3", "prompt": prompt, "stream": False}
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=90) # Cold Start can take 60s+
            if resp.status_code == 200:
                text = resp.json()['response'].strip().upper()
                if "RESEARCH" in text: return "RESEARCH"
                return "QA"
        except: return "RESEARCH" # Default to action
        return "RESEARCH"

    def generate_cited_summary(self, papers: List[Dict], topic: str) -> str:
        """Generates a summary that explicitly cites the provided papers."""
        import requests
        
        # Prepare context with IDs
        context = ""
        for i, p in enumerate(papers[:15]): # Limit context to 15
            # Fix Author format (Handle List or String)
            raw_auth = p.get('authors', 'Unknown')
            if isinstance(raw_auth, list):
                auth = raw_auth[0] if raw_auth else 'Unknown'
            else:
                auth = str(raw_auth).split(',')[0]
                
            year = p.get('year', '????')
            citation = f"{auth} et al. {year}"
            context += f"[{i+1}] {citation}: {p.get('title')}\nAbstract: {p.get('text', '')[:300]}...\n\n"
            
        prompt = f"""
        You are an academic writer. Write a synthesis of these papers regarding '{topic}'.
        
        RULES:
        1. cited every claim using the format [1], [2], etc. strictly based on the provided list.
        2. Do not hallunicate citations.
        3. Group similar findings.
        4. Do NOT include a "References" list at the end. The system displays this separately.
        5. If the papers are not relevant to '{topic}', say so.
        
        Papers:
        {context}
        """
        
        payload = {
            "model": "llama3",
            "prompt": prompt,
            "stream": False,
        }
        
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=300) # Increased to 5 min
            if resp.status_code == 200:
                return resp.json()['response'], context
        except Exception as e:
            return f"Error: {e}", ""
        return "No summary generated.", ""

    def chat_with_context(self, user_q: str, context_str: str) -> str:
        """Chat with the specific set of papers (Context)."""
        import requests
        
        prompt = f"""
        You are a research assistant answering questions based ONLY on the provided papers.
        
        Context (Papers):
        {context_str}
        
        User Question: {user_q}
        
        Answer:
        """
        
        payload = {
            "model": "llama3",
            "prompt": prompt,
            "stream": False
        }
        
        try:
            resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=300)
            if resp.status_code == 200:
                return resp.json()['response']
        except Exception as e:
            return f"Error: {e}"
        return "I could not generate an answer."


