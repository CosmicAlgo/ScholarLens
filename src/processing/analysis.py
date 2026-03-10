from typing import List, Dict, Any
from collections import Counter
import re

class TimelineAnalyzer:
    def __init__(self, papers: List[Dict[str, Any]], query_text: str = ""):
        self.papers = papers
        self.query_text = query_text.lower()

    def analyze_years(self) -> Dict[int, int]:
        """
        Returns a count of papers per year.
        """
        year_counts = Counter()
        for p in self.papers:
            y = p.get('year')
            if isinstance(y, int):
                year_counts[y] += 1
            else:
                year_counts['Unknown'] += 1
        return dict(sorted(year_counts.items(), key=lambda x: str(x[0])))

    def extract_keywords_by_year(self) -> Dict[int, List[str]]:
        """
        Returns top keywords for each year.
        (MVP: Simple frequency of capitalized words, ignoring common stop words AND query terms)
        """
        keywords_by_year = {}
        
        # Simple stop words list
        stop_words = set(["the", "and", "of", "in", "to", "a", "is", "for", "with", "on", "that", "by", "this", "are", "from", "as", "be", "an", "we", "abstract", "introduction", "conclusion", "results", "discussion", "method", "paper", "proposed", "based", "using", "used", "can", "which", "et", "al"])
        
        # Add query terms to stop words (e.g. if query is "supply chain", ignore "supply", "chain")
        if self.query_text:
            query_terms = re.findall(r'\b[a-z]+\b', self.query_text)
            stop_words.update(query_terms)

        # Group text by year
        year_texts = {}
        for p in self.papers:
            y = p.get('year')
            if isinstance(y, int):
                if y not in year_texts:
                    year_texts[y] = []
                year_texts[y].append(p.get('text', ''))

        # Extract keywords
        for year, texts in year_texts.items():
            full_text = " ".join(texts)
            # Find words (simple regex), filter short ones and stop words
            words = re.findall(r'\b[A-Za-z]{4,}\b', full_text.lower())
            filtered = [w for w in words if w not in stop_words]
            
            # Count and take top 5
            counts = Counter(filtered)
            keywords_by_year[year] = [word for word, count in counts.most_common(5)]
            
        return dict(sorted(keywords_by_year.items()))

if __name__ == "__main__":
    # Test with dummy data
    dummy_papers = [
        {"year": 2020, "text": "Deep learning and Transformers are taking over NLP."},
        {"year": 2020, "text": "Transformers in vision processing."},
        {"year": 2021, "text": "Large Language Models like GPT-3 are the new trend."},
    ]
    analyzer = TimelineAnalyzer(dummy_papers)
    print("Years:", analyzer.analyze_years())
    print("Keywords:", analyzer.extract_keywords_by_year())
