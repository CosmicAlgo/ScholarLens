import sys
import os
import time

# Ensure project root is in path for imports to work
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from src.config import Config
from src.storage.db import ResearchDatabase
from src.storage.graph_db import GraphDatabase
from src.processing.workflow import run_ingestion_pipeline
from src.processing.query_engine import QueryEngine

def main():
    print("==========================================")
    print("           TIMELINE EXPLORER              ")
    print("==========================================")

    # 1. Initialize Database
    db = ResearchDatabase(Config.DB_PATH)
    graph_db = GraphDatabase() 
    
    # 2. Run ingestion pipeline
    papers, _ = run_ingestion_pipeline(db)
    
    # 3. Interactive CLI
    while True:
        print("\n" + "="*40)
        print("SELECT MODE:")
        print(" [4] EXPLORE GRAPH (Author Timeline)")
        print(" [7] ASK ADVISOR (Smart Query)")
        print(" [q] QUIT")
        
        user_input = input("Choice > ").strip()
        
        if user_input.lower() == 'q':
            break
            
        if user_input == '7':
             q_text = input("Ask the Advisor: ")
             engine = QueryEngine(db, graph_db)
             results, explanation, meta = engine.execute(q_text)
             print(f"\n[Advisor] {explanation}")
             if results:
                 for i, p in enumerate(results[:5]):
                     print(f" {i+1}. [{p['year']}] {p['title']}")
             continue

if __name__ == "__main__":
    main()
