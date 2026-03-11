import streamlit as st
from src.processing.query_engine import QueryEngine
from src.ingestion.arxiv import ArxivIngestor
from src.ingestion.semantic_scholar import SemanticScholarClient
from src.ingestion.openalex import OpenAlexClient

def render_advisor_tab(db, graph_db):
    """
    Renders the AI Agent (Advisor) Tab (Tab 3).
    Features:
    - Advanced Configuration (Sources, Limit)
    - Interactive Session (Split View)
    - Dynamic Context Expansion (Fetch More)
    """
    if 'advisor_mode' not in st.session_state:
        st.session_state['advisor_mode'] = 'idle' # idle, interactive

    engine = QueryEngine(db, graph_db)

    # --- MODE: IDLE (Query Input) ---
    if st.session_state['advisor_mode'] != 'interactive':
        
        st.header("🤖 Agentic Research Advisor")
        st.info("Ask complex questions. Configure your sources below.")
        
        col_main, col_opts = st.columns([3, 1])
        
        with col_main:
            user_q = st.text_input("Research Question", placeholder="e.g. How has machine learning usage in earthquake prediction evolved?")
        
        # Advanced Search Config
        with st.expander("⚙️ Advanced Search Options", expanded=False):
            c1, c2 = st.columns(2)
            with c1:
                fetch_limit = st.slider("Max Papers to Analyze", 5, 50, 15)
            with c2:
                sources = st.multiselect(
                    "Data Sources", 
                    ["Local Library", "ArXiv (Web)", "Semantic Scholar (Web)", "OpenAlex (Web)"], 
                    default=["Local Library", "ArXiv (Web)", "OpenAlex (Web)"]
                )
        
        # Action Button
        if st.button("🚀 Start Research Session", type="primary"):
            if not user_q:
                st.warning("Please ask a question.")
            else:
                with st.spinner("🧠 Agent is Thinking & Retrieving Context..."):
                    
                    # 1. Optimize Keywords
                    optimized_kw = engine.extract_keywords(user_q)
                    st.caption(f"Searching for: `{optimized_kw}`")
                    
                    context_docs = []
                    
                    # 2. Fetch Strategy
                    # Local
                    if "Local Library" in sources:
                        local_results = db.search_papers(optimized_kw, limit=fetch_limit)
                        if local_results:
                            st.toast(f"Found {len(local_results)} local papers.", icon="📚")
                            context_docs.extend(local_results)
                    
                    # Web (if needed or requested)
                    # Logic: If we didn't fill the limit with local, or if user explicitly asked for Web
                    remaining_slots = fetch_limit - len(context_docs)
                    
                    if remaining_slots > 0 and ("ArXiv (Web)" in sources or "Semantic Scholar (Web)" in sources):
                        st.toast("Checking Web Sources...", icon="🌍")
                        try:
                            # ArXiv
                            if "ArXiv (Web)" in sources:
                                ax = ArxivIngestor(query=optimized_kw, max_results=remaining_slots) # heuristic split?
                                context_docs.extend(ax.load_data())
                            
                            # S2
                            if "Semantic Scholar (Web)" in sources:
                                s2 = SemanticScholarClient()
                                context_docs.extend(s2.search_normalized(optimized_kw, limit=5))
                            
                            # OpenAlex
                            if "OpenAlex (Web)" in sources:
                                oa = OpenAlexClient()
                                oa_results = oa.search_normalized(optimized_kw, limit=10)
                                if oa_results:
                                    st.toast(f"Found {len(oa_results)} OpenAlex papers.", icon="📖")
                                    context_docs.extend(oa_results)
                                
                        except Exception as e:
                            st.error(f"Web Fetch Error: {e}")
                    
                    # Deduplicate by Title (simple)
                    unique_docs = {d['title']: d for d in context_docs}.values()
                    context_docs = list(unique_docs)[:fetch_limit]

                    if context_docs:
                        # 3. Generate Insight
                        with st.spinner("✍️ Synthesizing Report..."):
                            summary, context_str = engine.generate_cited_summary(context_docs, user_q)
                            
                            # 4. TRANSITION
                            st.session_state['advisor_mode'] = 'interactive'
                            st.session_state['advisor_context_docs'] = context_docs
                            st.session_state['advisor_context_str'] = context_str
                            st.session_state['advisor_active_doc'] = context_docs[0] # Auto-select first
                            
                            # Initial Message
                            heading = f"**Research Report (Based on {len(context_docs)} papers)**\n\n"
                            st.session_state['advisor_chat_history'] = [
                                {"role": "assistant", "content": heading + summary}
                            ]
                            st.rerun()
                    else:
                        st.error("No papers found. Try adjusting options.")

    # --- MODE: INTERACTIVE SESSION ---
    else:
        st.markdown("### 🧠 Interactive Research Session")
        
        # Controls Row
        col_head, col_exit = st.columns([6, 1])
        with col_exit:
            if st.button("❌ New Search", type="secondary"):
                st.session_state['advisor_mode'] = 'idle'
                st.session_state['advisor_chat_history'] = []
                st.session_state['advisor_context_docs'] = []
                st.rerun()

        # (Notes moved to global sidebar in app.py)

        # SPLIT LAYOUT
        col_chat, col_work = st.columns([1, 1])
        
        # LEFT: CHAT
        with col_chat:
            st.subheader("💬 Chat & Insights")
            
            # --- RESEARCH ACTIONS TOOLS ---
            with st.expander("🔎 Extend Research (Fetch More)", expanded=False):
                c_tools_1, c_tools_2 = st.columns([2, 1])
                with c_tools_1:
                    extra_topic = st.text_input("Topic/Keyword", placeholder="e.g. 'Flash Attention'", label_visibility="collapsed")
                with c_tools_2:
                    if st.button("Fetch +5"):
                        if extra_topic:
                            with st.spinner("Fetching more papers..."):
                                try:
                                    # Default to ArXiv for quick fetch
                                    ax = ArxivIngestor(query=extra_topic, max_results=5)
                                    new_docs = ax.load_data()
                                    if new_docs:
                                        current_docs = st.session_state.get('advisor_context_docs', [])
                                        # Append
                                        current_docs.extend(new_docs)
                                        # Dedupe
                                        unique_docs = {d['title']: d for d in current_docs}.values()
                                        st.session_state['advisor_context_docs'] = list(unique_docs)
                                        
                                        st.success(f"Added {len(new_docs)} papers!")
                                        # Update Context String needed? Yes for chat.
                                        # But re-generating full summary is expensive. 
                                        # We just append to context string for Chat usage.
                                        engine = QueryEngine(db, graph_db)
                                        # Quick context update
                                        for i, p in enumerate(new_docs):
                                             st.session_state['advisor_context_str'] += f"\n[New] {p.get('title')}: {p.get('abstract')[:200]}..."
                                        st.rerun()
                                    else:
                                        st.warning("No papers found.")
                                except Exception as e:
                                    st.error(str(e))

            chat_container = st.container(height=550)
            
            with chat_container:
                for msg in st.session_state.get('advisor_chat_history', []):
                    with st.chat_message(msg["role"]):
                        st.markdown(msg["content"])
            
            if prompt := st.chat_input("Ask about these papers..."):
                st.session_state['advisor_chat_history'].append({"role": "user", "content": prompt})
                with chat_container:
                    with st.chat_message("user"):
                        st.markdown(prompt)
                
                with st.spinner("Analyzing papers..."):
                    context_str = st.session_state.get('advisor_context_str', "")
                    answer = engine.chat_with_context(prompt, context_str)
                    st.session_state['advisor_chat_history'].append({"role": "assistant", "content": answer})
                    with chat_container:
                        with st.chat_message("assistant"):
                            st.markdown(answer)

        # RIGHT: WORKSPACE
        with col_work:
            st.subheader("📚 Workspace")
            
            docs = st.session_state.get('advisor_context_docs', [])
            if docs:
                # 1. Selector
                doc_options = [f"[{i+1}] {d.get('title', 'Unknown')}" for i, d in enumerate(docs)]
                selected_label = st.selectbox("Select Paper:", options=doc_options, label_visibility="collapsed")
                
                selected_index = doc_options.index(selected_label)
                doc = docs[selected_index]
                
                # 2. Viewer
                st.divider()
                st.markdown(f"#### {doc.get('title')}")
                st.caption(f"**Authors:** {doc.get('authors', 'Unknown')[:100]}... | **Year:** {doc.get('year', '????')}")
                
                with st.expander("📝 Abstract", expanded=False):
                    st.write(doc.get('abstract') or doc.get('text') or "No text available.")
                
                # PDF Display
                pdf_url = doc.get('pdf_url')
                local_path = None
                
                if pdf_url and not pdf_url.startswith('http'):
                    import os
                    if os.path.exists(pdf_url):
                        local_path = pdf_url
                
                if local_path:
                    st.success("📂 **Local File Available**")
                    try:
                        with open(local_path, "rb") as f:
                            bdata = f.read()
                        st.download_button("⬇️ Open PDF (Download)", bdata, file_name=os.path.basename(local_path), mime='application/pdf')
                    except Exception as e:
                        st.error(f"Read Error: {e}")
                        
                elif pdf_url:
                    clean_url = pdf_url
                    if "arxiv" in clean_url and "abs" in clean_url:
                            clean_url = clean_url.replace("abs", "pdf")
                    if clean_url.startswith("http://"):
                            clean_url = clean_url.replace("http://", "https://")
                    
                    st.markdown(f"🔗 [Open Original Source]({clean_url})")
                    st.components.v1.iframe(clean_url, height=600)
                else:
                    st.warning("No PDF/URL source available.")
                
                # Wikipedia context panel
                st.divider()
                show_wiki = st.checkbox("🌐 Show Wikipedia Context", key="advisor_wiki_toggle")
                
                if show_wiki:
                    try:
                        from src.ingestion.wikipedia import WikipediaClient
                        
                        # Extract main topic from title (first 2-3 meaningful words)
                        title = doc.get('title', '')
                        stop_words = {'a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'with', 'using', 'based', 'via'}
                        words = [w for w in title.split()[:6] if w.lower() not in stop_words]
                        topic = ' '.join(words[:3]) if words else title[:30]
                        
                        with st.spinner(f"Looking up: {topic}..."):
                            wiki = WikipediaClient()
                            result = wiki.get_summary(topic, sentences=3)
                            
                            if result:
                                st.markdown(f"""
                                <div style="
                                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                                    border-radius: 10px;
                                    padding: 15px;
                                    border-left: 4px solid #4a90d9;
                                ">
                                    <div style="color: #4a90d9; font-weight: bold; margin-bottom: 8px;">
                                        🌐 {result['title']}
                                    </div>
                                    <div style="color: #ccc; font-size: 0.9em; line-height: 1.5;">
                                        {result['summary']}
                                    </div>
                                    <div style="margin-top: 10px;">
                                        <a href="{result['url']}" target="_blank" style="color: #4a90d9; font-size: 0.85em;">
                                            Read more on Wikipedia →
                                        </a>
                                    </div>
                                </div>
                                """, unsafe_allow_html=True)
                            else:
                                st.caption("No Wikipedia article found for this topic.")
                    except ImportError:
                        st.warning("Wikipedia library not installed.")
                    except Exception as e:
                        st.caption(f"Wikipedia lookup failed: {e}")

            else:
                st.info("No papers loaded in context.")

