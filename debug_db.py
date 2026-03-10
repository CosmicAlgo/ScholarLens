import sqlite3
import pandas as pd
from src.config import Config

db_path = Config.DB_PATH
print(f"Checking DB at: {db_path}")

try:
    conn = sqlite3.connect(db_path)
    
    # Check total count
    count = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    print(f"Total Papers in DB: {count}")
    
    # Check Year Distribution
    print("\nYear Distribution:")
    df_year = pd.read_sql("SELECT year, COUNT(*) as c FROM papers GROUP BY year ORDER BY year DESC", conn)
    print(df_year)
    
    # Check how many contain 'radiation' in title/abstract
    print("\nKeyword Match Check ('radiation'):")
    match_count = conn.execute("SELECT COUNT(*) FROM papers WHERE title LIKE '%radiation%' OR abstract LIKE '%radiation%'").fetchone()[0]
    print(f"Papers matching local query 'radiation': {match_count}")
    
    # Sample Titles
    print("\nSample Titles:")
    titles = conn.execute("SELECT title, year FROM papers LIMIT 5").fetchall()
    for t in titles:
        print(f"- [{t[1]}] {t[0]}")

except Exception as e:
    print(f"Error: {e}")
