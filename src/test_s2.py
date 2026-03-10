import sys
import os

# Add project root to path (so we can import src)
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.append(project_root)

from src.ingestion.semantic_scholar import SemanticScholarClient

def test_api():
    print("Initializing Semantic Scholar Client...")
    client = SemanticScholarClient()
    
    if not client.api_key:
        print("WARNING: No API Key found in env. Running in public mode (low rate limit).")
    else:
        print(f"API Key detected: {client.api_key[:5]}...{client.api_key[-4:]}")
        
    print("\nTesting Paper Search (Query: 'Deep Learning')...")
    results = client.search_papers("Deep Learning", limit=3)
    if results:
        for p in results:
            print(f" - [{p.get('year')}] {p.get('title')} (Ven: {p.get('venue')})")
    else:
        print("No results found or error occurred.")
        
    print("\nTesting Details Fetch (DOI: 10.1145/3097983.3098052 - 'Attention Is All You Need')...")
    # Actually 'Attention Is All You Need' is arXiv:1706.03762. Let's use a known DOI or ArXiv.
    # DOI for Transformer paper: 10.5555/3295222.3295349 (NeurIPS)
    # Let's try ArXiv ID
    paper = client.get_paper_details("ARXIV:1706.03762")
    if paper:
        print(f"SUCCESS: Found '{paper.get('title')}'")
        print(f"Abstract preview: {paper.get('abstract')[:100]}...")
    else:
        print("Failed to fetch paper details.")

if __name__ == "__main__":
    test_api()
