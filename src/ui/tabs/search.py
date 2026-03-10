import streamlit as st
import pandas as pd
import altair as alt
import requests
import os
import datetime
from src.ingestion.arxiv import ArxivIngestor
from src.ingestion.semantic_scholar import SemanticScholarClient
from src.ingestion.openalex import OpenAlexClient
from src.processing.query_engine import QueryEngine

def render_search_tab(db, graph_db):
    """
    Renders the Search & Timeline Tab (Tab 1).
    Args:
        db: ResearchDatabase instance
        graph_db: GraphDatabase instance
    """
    st.header("Search & Timeline")
    
    # --- SEARCH FORM & FILTERS moved to Main Area ---
    with st.form("search_form"):
        col1, col2 = st.columns([4, 1])
        with col1:
            default_q = st.session_state.get("active_search", "")
            search_query = st.text_input("Deep Search", value=default_q, placeholder="e.g. Generative Adversarial Networks")
        with col2:
            st.write("") 
            st.write("")
            search_submitted = st.form_submit_button("Search / Apply")
        
        with st.expander("Search Settings & Filters", expanded=False):
            f_col1, f_col2, f_col3 = st.columns(3)
            with f_col1:
                search_mode = st.radio("Search Mode", ["Hybrid (Local + Web)", "Local Only", "Web Only"])
            with f_col2:
                online_sources = st.multiselect(
                    "Sources",
                    ["ArXiv", "Semantic Scholar", "OpenAlex"],
                    default=["ArXiv", "Semantic Scholar", "OpenAlex"]
                )
                sort_option = st.selectbox("Sort By (Retrieval)", ["Relevance", "Last Updated", "Submitted Date"])
            with f_col3:
                max_results = st.slider("Max Results (per source)", 10, 100, 50)
                current_year = datetime.datetime.now().year
                # YEAR RANGE SLIDER
                year_range = st.slider("Publication Years", 1990, current_year+1, (2010, current_year))
                min_year, max_year = year_range

    # Logic for determining active search
    if search_submitted:
            st.session_state["active_search"] = search_query
    
    active_search = st.session_state.get("active_search")
    trigger_fetch = st.session_state.get("trigger_fetch", False)
    
    # Reset trigger so it doesn't loop
    if trigger_fetch:
        st.session_state["trigger_fetch"] = False
    
    if (search_submitted or trigger_fetch) and active_search:
        # --- 1. SEARCH / INGESTION LOGIC ---
        new_papers_count = 0
        count_arxiv = 0
        count_s2 = 0
        
        # --- SORT MAPPING ---
        sort_map = {
            "Relevance": "relevance",
            "Last Updated": "lastUpdatedDate",
            "Submitted Date": "submittedDate"
        }
        # Semantic Scholar Map
        s2_sort_map = {
            "Relevance": "relevance",
            "Last Updated": "publicationDate:desc",
            "Submitted Date": "publicationDate:desc"
        }
        
        if search_mode != "Local Only":
            with st.spinner(f"Fetching from Web (Limit: {max_results})..."):
                # ArXiv
                if "ArXiv" in online_sources:
                    try:
                        print(f"Fetch ArXiv: {active_search} | Sort: {sort_option}") # Log
                        ingestor = ArxivIngestor(
                            query=active_search, 
                            max_results=max_results, 
                            sort_by=sort_map.get(sort_option, "relevance")
                        )
                        raw_arxiv = ingestor.load_data()
                        
                        if raw_arxiv:
                            db.add_papers(raw_arxiv)
                            # SYNC TO NEO4J
                            for p in raw_arxiv:
                                graph_db.sync_paper(p)
                                
                            count_arxiv = len(raw_arxiv)
                            new_papers_count += count_arxiv
                    except Exception as e:
                        print(f"ArXiv Error: {e}")
                        st.warning(f"ArXiv Issues: {e}")

                # Semantic Scholar
                if "Semantic Scholar" in online_sources:
                    try:
                        print(f"Fetch S2: {active_search} | Sort: {sort_option}")
                        s2_client = SemanticScholarClient()
                        raw_s2 = s2_client.search_normalized(
                            query=active_search, 
                            limit=max_results,
                            sort=s2_sort_map.get(sort_option, "relevance")
                        )
                        
                        if raw_s2:
                            db.add_papers(raw_s2)
                            for p in raw_s2:
                                graph_db.sync_paper(p)
                                
                            count_s2 = len(raw_s2)
                            new_papers_count += count_s2
                    except Exception as e:
                        print(f"S2 Error: {e}")
                        st.warning(f"S2 Issues: {e}")
                
                # OpenAlex
                count_oa = 0
                if "OpenAlex" in online_sources:
                    try:
                        print(f"Fetch OpenAlex: {active_search}")
                        oa_client = OpenAlexClient()
                        raw_oa = oa_client.search_normalized(
                            query=active_search,
                            limit=max_results
                        )
                        
                        if raw_oa:
                            db.add_papers(raw_oa)
                            for p in raw_oa:
                                graph_db.sync_paper(p)
                            
                            count_oa = len(raw_oa)
                            new_papers_count += count_oa
                    except Exception as e:
                        print(f"OpenAlex Error: {e}")
                        st.warning(f"OpenAlex Issues: {e}")
                        
            if new_papers_count > 0:
                msg = f"Fetching Complete! Added {new_papers_count} papers ({count_arxiv} ArXiv, {count_s2} S2, {count_oa} OpenAlex)."
                st.toast(msg, icon="✅")
                st.rerun() 
            else:
                st.toast("Fetch complete. No new unique papers found.", icon="ℹ️")


    # --- 2. RENDER RESULTS (Based on Persisted State) ---
    if active_search:
        results = []
        
        # Determine Sort Order for SQL
        sort_sql = "ORDER BY p.year DESC" # Default
        if sort_option == "Relevance":
            sort_sql = "ORDER BY p.id DESC" # Proxy for newest fetch
        
        # DB Query Logic - ALWAYS use Semantic Search
        source_filter = online_sources  # User's selected sources
        
        # --- CACHE KEY: Only re-run search if these change ---
        cache_key = f"{active_search}_{search_mode}_{min_year}_{max_year}_{max_results}_{str(source_filter)}"
        
        # Check if we have cached results for this exact query
        if st.session_state.get("search_cache_key") == cache_key and "search_results" in st.session_state:
            # Use cached results - don't re-run expensive semantic search
            results = st.session_state["search_results"]
        else:
            # Run semantic search (only when query/filters change)
            with st.spinner("🧠 Semantic Search (AI-powered)..."):
                engine = QueryEngine(db, graph_db)
                all_results = engine.semantic_search_papers(active_search, top_k=max_results * 3)
                
                # Apply year filter (safely handle non-numeric years)
                def safe_year(r):
                    y = r.get('year')
                    if y is None:
                        return None
                    try:
                        return int(y)
                    except (ValueError, TypeError):
                        return None
                
                year_filtered = [
                    r for r in all_results 
                    if safe_year(r) is not None and min_year <= safe_year(r) <= max_year
                ]
                
                # Apply source filter based on mode
                if search_mode == "Web Only":
                    # Filter to only web sources that match selection
                    results = []
                    for r in year_filtered:
                        src = r.get('source', '').lower()
                        if 'arxiv' in src and 'ArXiv' in source_filter:
                            results.append(r)
                        elif 'semantic' in src and 'Semantic Scholar' in source_filter:
                            results.append(r)
                    results = results[:max_results]
                elif search_mode == "Local Only":
                    # Filter to only local sources
                    results = [r for r in year_filtered if '.pdf' in r.get('source', '').lower()][:max_results]
                else:
                    # Hybrid - include all
                    results = year_filtered[:max_results]
                
                # Cache the results
                st.session_state["search_cache_key"] = cache_key
                st.session_state["search_results"] = results
                st.toast(f"Semantic search found {len(results)} relevant papers", icon="🧠")

        if not results:
            st.warning(f"No papers found for '{active_search}'. check your filters?")
        else:
            st.success(f"Displaying {len(results)} relevant papers.")
            
            # Check for year discrepancy
            if sort_option in ["Last Updated", "Submitted Date"] and max_year < 2024:
                recent_papers = [r for r in results if r['year'] > max_year]
                if not recent_papers and len(results) < max_results:
                        st.info(f"💡 Hint: You are sorting by Date but filtering up to {max_year}. Newer papers might be hidden.")
            
            # LOOP CLOSURE
            if st.session_state.get('advisor_suggested_query') == active_search:
                if st.button("⬅️ Return to Advisor (Data Ready)", type="primary"):
                    st.info("Data Collected! Click the 'AI Research Advisor' tab to see your summary.")
            
            # --- ADVANCED VISUALIZATION ---
            # Setup DataFrame
            df = pd.DataFrame(results)
            if 'authors' not in df.columns: df['authors'] = "Unknown"
            df['authors'] = df['authors'].fillna("Unknown").astype(str)
            df['authors'] = df['authors'].replace('None', 'Unknown')
            
            if 'source' not in df.columns: df['source'] = "Unknown"
            df['source'] = df['source'].fillna("Unknown").astype(str)
            
            def map_source(s):
                s_lower = s.lower()
                if 'arxiv' in s_lower: return 'ArXiv'
                if 'semantic' in s_lower: return 'Semantic Scholar'
                if 'openalex' in s_lower: return 'OpenAlex'
                if '.pdf' in s_lower: return 'Local Library'
                return 'Other'
            
            # --- 3. TIMELINE & VISUALIZATION ---
            df['source_category'] = df['source'].apply(map_source)
            df['year_plot'] = pd.to_numeric(df['year'], errors='coerce').fillna(0).astype(int)
            
            # Metrics Calculation
            if not df.empty:
                df['year_int'] = df['year_plot'] # Alias
                valid_years = df[df['year_int'] > 1900]
                
                st.markdown("### 📊 Timeline Analysis")
                m1, m2, m3 = st.columns(3)
                with m1:
                    if not valid_years.empty:
                        earliest = valid_years.loc[valid_years['year_int'].idxmin()]
                        st.metric("Earliest Paper", f"{earliest['year_int']}", help=earliest['title'])
                    else:
                        st.metric("Earliest Paper", "N/A")
                with m2:
                    if not valid_years.empty:
                        peak_year = valid_years['year_int'].mode()[0]
                        st.metric("Peak Activity", f"{peak_year}")
                    else:
                        st.metric("Peak Activity", "N/A")
                with m3:
                    st.metric("Displayed Results", len(df))

            # Visual Graph Filter
            st.markdown("### 📈 Publication Trend")
            
            # Determine standard bounds
            data_min = int(df[df['year_plot'] > 1900]['year_plot'].min()) if not df[df['year_plot'] > 1900].empty else 2010
            data_max = int(df['year_plot'].max()) if not df.empty else current_year
            
            if data_min >= data_max: 
                    data_min = data_max - 5
            
            # Controls Row
            gc1, gc2, gc3 = st.columns([2, 1, 1])
            with gc1:
                c_min, c_max = st.slider("Visual Timeframe (Zoom)", data_min, data_max + 1, (data_min, data_max))
            with gc2:
                st.write("") 
                hide_local = st.checkbox("Hide Local Files", value=False)
            with gc3:
                st.write("")
                chart_type = st.radio("View", ["Line (Trends)", "Scatter (Individual)"], horizontal=True)
            
            # Filter Data for Plot
            chart_df = df[(df['year_plot'] >= c_min) & (df['year_plot'] <= c_max)].copy()
            if hide_local:
                chart_df = chart_df[chart_df['source_category'] != 'Local Library']
            
            if not chart_df.empty:
                # --- STORYTELLING: Compute insights ---
                yearly_counts = chart_df.groupby('year_plot').size().reset_index(name='count')
                if len(yearly_counts) > 1:
                    peak_year = yearly_counts.loc[yearly_counts['count'].idxmax(), 'year_plot']
                    peak_count = yearly_counts['count'].max()
                    
                    # Growth trend
                    first_half = yearly_counts[yearly_counts['year_plot'] <= yearly_counts['year_plot'].median()]['count'].sum()
                    second_half = yearly_counts[yearly_counts['year_plot'] > yearly_counts['year_plot'].median()]['count'].sum()
                    
                    if second_half > first_half * 1.5:
                        trend_emoji = "📈"
                        trend_text = "**Growing rapidly** - Research interest is accelerating"
                    elif second_half > first_half:
                        trend_emoji = "📊"
                        trend_text = "**Steady growth** - Consistent research interest"
                    elif second_half < first_half * 0.5:
                        trend_emoji = "📉"
                        trend_text = "**Declining** - Research may have peaked"
                    else:
                        trend_emoji = "➡️"
                        trend_text = "**Stable** - Mature research area"
                    
                    # Display story
                    st.markdown(f"{trend_emoji} {trend_text}")
                    st.caption(f"📍 Peak activity: **{peak_year}** with {peak_count} papers")
                
                if chart_type == "Line (Trends)":
                    # Enhanced line chart with peak annotation
                    base = alt.Chart(chart_df).encode(
                        x=alt.X('year_plot:N', title='Year')
                    )
                    
                    line = base.mark_line(point=True).encode(
                        y=alt.Y('count()', title='Number of Papers'),
                        color=alt.Color('source_category', title='Source'),
                        tooltip=['year_plot', 'source_category', 'count()']
                    )
                    
                    # Add peak marker if we have data
                    if len(yearly_counts) > 1:
                        peak_data = chart_df[chart_df['year_plot'] == peak_year]
                        if not peak_data.empty:
                            peak_rule = alt.Chart(pd.DataFrame({'year': [peak_year]})).mark_rule(
                                color='red', strokeDash=[5, 5], strokeWidth=2
                            ).encode(x='year:N')
                            chart = (line + peak_rule).properties(height=350).interactive()
                        else:
                            chart = line.properties(height=350).interactive()
                    else:
                        chart = line.properties(height=350).interactive()
                    
                    st.altair_chart(chart, theme="streamlit", use_container_width=True)
                else:
                    # SCATTER CHART
                    scatter = alt.Chart(chart_df).mark_circle(size=60).encode(
                        x=alt.X('year_plot:O', title='Year'),
                        y=alt.Y('source_category:N', title='Source'),
                        color=alt.Color('source_category', legend=None),
                        tooltip=['title', 'year', 'authors', 'source'],
                        href='pdf_url'
                    ).properties(
                        height=350,
                        title="Individual Paper Distribution"
                    ).interactive()
                    st.altair_chart(scatter, theme="streamlit", use_container_width=True)
            else:
                st.info("No papers in this visual range.")
            
            # --- OPENALEX GLOBAL TREND BAR GRAPH ---
            st.markdown("### 🌍 Global Publication Trend (OpenAlex)")
            st.caption("Worldwide publication counts for this topic from the OpenAlex catalog.")
            
            oa_cache_key = f"oa_years_{active_search}"
            if oa_cache_key not in st.session_state:
                with st.spinner("Fetching global trends from OpenAlex..."):
                    try:
                        oa = OpenAlexClient()
                        st.session_state[oa_cache_key] = oa.get_year_counts(active_search, start_year=min_year)
                    except Exception as e:
                        st.session_state[oa_cache_key] = {}
                        st.warning(f"OpenAlex trend fetch failed: {e}")
            
            oa_year_data = st.session_state.get(oa_cache_key, {})
            
            if oa_year_data:
                oa_df = pd.DataFrame([
                    {"Year": y, "Publications": c} 
                    for y, c in sorted(oa_year_data.items()) 
                    if c_min <= y <= c_max
                ])
                
                if not oa_df.empty:
                    # Find peak
                    peak_row = oa_df.loc[oa_df['Publications'].idxmax()]
                    total_pubs = oa_df['Publications'].sum()
                    
                    oa_m1, oa_m2, oa_m3 = st.columns(3)
                    with oa_m1:
                        st.metric("Total (Worldwide)", f"{total_pubs:,}")
                    with oa_m2:
                        st.metric("Peak Year", f"{int(peak_row['Year'])}")
                    with oa_m3:
                        st.metric("Peak Count", f"{int(peak_row['Publications']):,}")
                    
                    bar_chart = alt.Chart(oa_df).mark_bar(
                        cornerRadiusTopLeft=3,
                        cornerRadiusTopRight=3
                    ).encode(
                        x=alt.X('Year:O', title='Year'),
                        y=alt.Y('Publications:Q', title='Paper Count'),
                        color=alt.value('#4a90d9'),
                        tooltip=['Year', 'Publications']
                    ).properties(
                        height=300
                    ).interactive()
                    
                    st.altair_chart(bar_chart, theme="streamlit", use_container_width=True)
            else:
                st.info("No OpenAlex trend data available for this query.")
            
            # --- TOP 3 PAPERS ---
            st.markdown("---")
            st.subheader("🏆 Top 3 Best Matches")
            
            # Init Engine for Summaries
            engine = QueryEngine(db, graph_db) # Pass DB Instances

            cols = st.columns(3)
            for i, p in enumerate(results[:3]):
                with cols[i]:
                    year_display = p.get('year', '????')
                    auth_disp = p.get('authors', 'Unknown')
                    
                    st.markdown(f"#### {i+1}. {p['title']}")
                    st.caption(f"🗓️ {year_display} | ✍️ {auth_disp}")
                    
                    ents = p.get('entities')
                    if ents and isinstance(ents, list):
                         labels = [e.get('text') for e in ents if isinstance(e, dict) and e.get('text')]
                         if labels:
                             st.markdown(f"**Tags:** {', '.join(labels[:3])}")
                    
                    pop_key = f"summary_{i}_{p['id']}"
                    
                    with st.expander("Summary"):
                            if pop_key in st.session_state:
                                st.success(st.session_state[pop_key])
                            else:
                                st.write(p.get('text', '')[:300] + "...")
                                if st.button("✨ AI Summarize", key=f"btn_{pop_key}"):
                                    with st.spinner("Analyzing..."):
                                        summary = engine.summarize_paper(p['title'], p.get('abstract') or p.get('text', ''))
                                        st.session_state[pop_key] = summary
                                        st.rerun()
                    
                    # DOWNLOAD BUTTON
                    pdf_link = p.get('pdf_url')
                    if pdf_link:
                            if st.button("⬇️ Download", key=f"dl_top_{i}"):
                                _handle_download(p, pdf_link)

            # --- OTHER FINDINGS ---
            if len(results) > 3:
                st.markdown("---")
                st.subheader(f"📚 Other Findings ({len(results)-3})")
                
                for i, p in enumerate(results[3:]):
                    year_display = p.get('year', '????')
                    icon = "📄"
                    src = p.get('source', 'Unknown')
                    if "ArXiv" in src: icon = "🌐"
                    elif "Semantic" in src: icon = "🔍"
                    elif "OpenAlex" in src: icon = "📖"
                    elif "pdf" in src.lower(): icon = "🗄️"
                    
                    auth_disp = p.get('authors') or "Unknown"

                    with st.expander(f"{icon} [{year_display}] {p['title']}"):
                        st.caption(f"**Authors:** {auth_disp} | **Source:** {src}")
                        
                        c1, c2 = st.columns([1, 4])
                        with c1:
                            pdf_link = p.get('pdf_url')
                            if pdf_link:
                                    if st.button("⬇️ Save", key=f"dl_rest_{i}"):
                                        _handle_download(p, pdf_link)

def _handle_download(p, pdf_link):
    """Helper to handle PDF downloads inside the module."""
    try:
        safe_title = "".join([c for c in p['title'] if c.isalnum() or c in (' ','-','_')]).strip()[:50]
        save_dir = "/app/data/papers/Papers"
        os.makedirs(save_dir, exist_ok=True)
        save_path = f"{save_dir}/{safe_title}.pdf"
        
        with st.spinner("Downloading..."):
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            r = requests.get(pdf_link, headers=headers, stream=True, timeout=15)
            
            content_type = r.headers.get('Content-Type', '').lower()
            if r.status_code == 200 and 'application/pdf' in content_type and len(r.content) > 1000:
                with open(save_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
                st.toast(f"Saved: {safe_title}", icon="💾")
            else:
                st.error(f"Download Failed. Type: {content_type}")
    except Exception as e:
        st.error(f"Error: {e}")
