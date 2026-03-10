from src.ingestion.arxiv import ArxivIngestor
import datetime

print("Testing ArxivIngestor for 'radiation'...")
ingestor = ArxivIngestor(query="radiation", max_results=10, sort_by="submittedDate")
docs = ingestor.load_data()

print(f"Fetched {len(docs)} papers.")
for i, d in enumerate(docs):
    y = d.get('year')
    print(f"[{i}] Year: {y} (Type: {type(y)}) - Title: {d['title'][:30]}")

current_year = datetime.datetime.now().year
print(f"Current Year: {current_year}")
