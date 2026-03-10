import streamlit as st
import sys
import os

# Ensure project root is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from src.config import Config
from src.storage.db import ResearchDatabase
from src.storage.graph_db import GraphDatabase
from src.ingestion.arxiv import ArxivIngestor
from src.ingestion.semantic_scholar import SemanticScholarClient
from src.processing.query_engine import QueryEngine

# Page Config
st.set_page_config(page_title="Timeline Explorer", page_icon="🧬", layout="wide")

@st.cache_resource
def get_db():
    return ResearchDatabase(Config.DB_PATH)

@st.cache_resource
def get_graph_db():
    return GraphDatabase()

def main():
    # === Initialize session logic & DB Force Refresh ===
    # Check for stale DB object (missing new method)
    if "db" not in st.session_state or not hasattr(st.session_state.db, 'search_papers'):
        import importlib
        import src.storage.db
        importlib.reload(src.storage.db) # Force reload module
        from src.storage.db import ResearchDatabase # Re-import class
        
        st.session_state.db = ResearchDatabase(Config.DB_PATH)
        st.warning("System updated. Database connection refreshed.")

    if "graph_db" not in st.session_state:
        st.session_state.graph_db = get_graph_db()

    # FORCE RELOAD S2 CLIENT IF STALE
    # (Fixes 'unexpected keyword argument sort' error)
    import inspect
    from src.ingestion.semantic_scholar import SemanticScholarClient
    try:
        sig = inspect.signature(SemanticScholarClient.search_normalized)
        if 'sort' not in sig.parameters:
            import importlib
            import src.ingestion.semantic_scholar
            importlib.reload(src.ingestion.semantic_scholar)
            from src.ingestion.semantic_scholar import SemanticScholarClient # Update global ref locally
            st.toast("System: Reloaded Semantic Scholar Module", icon="🔄")
    except Exception:
        pass

    # FORCE RELOAD QUERY ENGINE (To apply new timeouts/models)
    # Unconditional reload to ensure Llama3 settings take effect
    import importlib
    import src.processing.query_engine
    importlib.reload(src.processing.query_engine)
    from src.processing.query_engine import QueryEngine
    # st.toast("System: Reloaded Query Engine", icon="🧠")

    # sidebar metrics (keep these)
    total_papers = 0
    try:
        total_papers = st.session_state.db.conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        st.sidebar.metric("📚 Library Size", total_papers)
    except Exception as e:
        # Re-try init if error persists (fallback)
        try:
             st.session_state.db = ResearchDatabase(Config.DB_PATH)
             total_papers = st.session_state.db.conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
             st.sidebar.metric("📚 Library Size", total_papers)

        except:
             st.sidebar.error("Database unavailable")


    st.sidebar.markdown("---")
    # Improved Reset Logic
    if st.sidebar.button("⚠️ Reset Database", type="secondary"):
        st.session_state.db.conn.execute("DELETE FROM papers")
        st.session_state.db.conn.execute("DELETE FROM authors")
        st.session_state.db.conn.execute("DELETE FROM entities")
        st.session_state.db.conn.commit()
        
        try:
             # Clean Graph
             st.session_state.graph_db.driver.execute_query("MATCH (n) DETACH DELETE n")
        except: pass
        
        # Trigger Rescan Automatically?
        st.toast("Database Wiped! Rescanning library...", icon="🧹")
        
        # Immediate Rescan
        from src.ingestion.loader import PDFIngestor
        ingestor = PDFIngestor("/app/data/papers/Papers") # Point to the mapped volume
        docs = ingestor.load_data()
        if docs:
            st.session_state.db.add_papers(docs)
            for p in docs:
                st.session_state.graph_db.sync_paper(p)
            st.toast(f"Reset & Rescan Complete! ({len(docs)} papers)", icon="✅")
        
        import time
        time.sleep(1.5)
        st.rerun()

    # ... (Rescan Button Logic - Keep as manual fallback)
    if st.sidebar.button("🔄 Rescan Library", type="secondary"):
        with st.spinner("Scanning local PDF library..."):
            from src.ingestion.loader import PDFIngestor
            # Point to the mapped volume
            ingestor = PDFIngestor(papers_dir="/app/data/papers/Papers") 
            docs = ingestor.load_data()
            if docs:
                st.session_state.db.add_papers(docs)
                # SYNC LOCAL DOCS TO NEO4J
                for p in docs:
                    st.session_state.graph_db.sync_paper(p)
                    
                st.toast(f"Re-indexed {len(docs)} papers!", icon="📚")
                import time
                time.sleep(1)
                st.rerun()
            else:
                 st.warning("No papers found in /app/data/papers/Papers")

    # --- GLOBAL RESEARCH NOTES (Simple) ---
    st.sidebar.markdown("---")
    with st.sidebar.expander("📝 **Research Notes**", expanded=False):
        # Initialize notes in session state
        if 'research_notes' not in st.session_state:
            st.session_state.research_notes = ""
        
        st.caption("Copy-paste or type your notes here. Supports markdown.")
        
        # Simple Text Area
        notes_content = st.text_area(
            "Notes", 
            value=st.session_state.research_notes,
            height=250,
            placeholder="Paste insights, quotes, or write your own notes...",
            label_visibility="collapsed",
            key="notes_textarea"
        )
        st.session_state.research_notes = notes_content
        
        # Export only
        if notes_content:
            import pandas as pd
            export_content = f"# Research Notes\nExported: {pd.Timestamp.now()}\n\n{notes_content}"
            st.download_button(
                "💾 Export as Markdown",
                data=export_content,
                file_name="research_notes.md",
                mime="text/markdown",
                use_container_width=True
            )

    # === Main UI ===
    st.title("🔬 Research Timeline Explorer")
    
    # Tabs
    tab1, tab2, tab3, tab4 = st.tabs(["Search & Timeline", "Graph Explorer", "AI Advisor", "🔍 Discover"])
    
    # Import Tabs
    from src.ui.tabs.search import render_search_tab
    from src.ui.tabs.graph import render_graph_tab
    from src.ui.tabs.advisor_new import render_advisor_tab
    from src.ui.tabs.discover import render_discover_tab
    
    with tab1:
        render_search_tab(st.session_state.db, st.session_state.graph_db)
        
    with tab2:
        render_graph_tab(st.session_state.graph_db)
        
    with tab3:
        render_advisor_tab(st.session_state.db, st.session_state.graph_db)
    
    with tab4:
        render_discover_tab()

if __name__ == "__main__":
    main()
