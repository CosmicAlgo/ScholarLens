"""
Discover tab - search and browse tech articles with inline reading.
"""
import streamlit as st
from src.ingestion.news_feeds import NewsFeedClient

def render_discover_tab():
    """
    Renders the Discover Tab (Tab 4).
    Features: search bar, inline content extraction, HN/DZone cards.
    """
    st.header("🔍 Discover")
    st.caption("Search and explore tech articles, blog posts, and community discussions")
    
    # === SEARCH BAR ===
    search_col, filter_col = st.columns([3, 1])
    with search_col:
        search_query = st.text_input(
            "Search articles & discussions",
            placeholder="e.g. transformer architecture pytorch implementation",
            key="discover_search"
        )
    with filter_col:
        st.write("")
        search_btn = st.button("🔍 Search", use_container_width=True, type="primary")
    
    # === SEARCH RESULTS (inline content) ===
    if search_query and search_btn:
        _render_search_results(search_query)
        st.markdown("---")
    
    # === FEEDS SECTION ===
    st.markdown("### 📡 Live Feeds")
    col_filter1, col_filter2, col_refresh = st.columns([2, 2, 1])
    with col_filter1:
        dzone_zone = st.selectbox(
            "DZone Category",
            ["home", "ai-ml", "java", "devops", "cloud", "webdev"],
            format_func=lambda x: {
                "home": "🏠 All", "ai-ml": "🤖 AI/ML", "java": "☕ Java", 
                "devops": "🔧 DevOps", "cloud": "☁️ Cloud", "webdev": "🌐 Web Dev"
            }.get(x, x)
        )
    with col_filter2:
        hn_count = st.slider("HackerNews stories", 5, 20, 10)
    with col_refresh:
        st.write("")
        refresh = st.button("🔄 Refresh", use_container_width=True)
    
    # Fetch feeds
    client = NewsFeedClient()
    cache_key = f"discover_{dzone_zone}_{hn_count}"
    if refresh or cache_key not in st.session_state:
        with st.spinner("Fetching latest content..."):
            st.session_state[cache_key] = {
                "hn": client.get_hackernews_top(hn_count),
                "dzone": client.get_dzone_feed(dzone_zone, 10)
            }
    
    data = st.session_state[cache_key]
    
    # Two-column layout
    col_hn, col_dz = st.columns(2)
    
    with col_hn:
        st.markdown("### 🔥 Trending on HackerNews")
        if not data["hn"]:
            st.info("Could not fetch HackerNews. Check connection.")
        else:
            for story in data["hn"]:
                _render_hn_card(story)
    
    with col_dz:
        st.markdown("### 📰 Latest from DZone")
        if not data["dzone"]:
            st.info("Could not fetch DZone feed. Check connection.")
        else:
            for article in data["dzone"]:
                _render_dzone_card(article)


def _render_search_results(query: str):
    """Search HackerNews via Algolia and show results with inline content."""
    import requests
    
    st.markdown("### 🔎 Search Results")
    
    with st.spinner(f"Searching for '{query}'..."):
        try:
            # HN Algolia API
            resp = requests.get(
                "https://hn.algolia.com/api/v1/search",
                params={"query": query, "tags": "story", "hitsPerPage": 8},
                timeout=10
            )
            
            if resp.status_code != 200:
                st.warning("Search temporarily unavailable.")
                return
            
            hits = resp.json().get("hits", [])
            
            if not hits:
                st.info(f"No results found for '{query}'.")
                return
            
            for i, hit in enumerate(hits):
                title = hit.get("title", "Untitled")
                url = hit.get("url", "")
                points = hit.get("points", 0)
                comments = hit.get("num_comments", 0)
                author = hit.get("author", "unknown")
                
                with st.expander(f"🔺 {points} | {title}", expanded=(i == 0)):
                    st.caption(f"by {author} • 💬 {comments} comments")
                    
                    if url:
                        st.markdown(f"🔗 [Original Link]({url})")
                        
                        # Inline content extraction
                        read_key = f"article_{i}_{hash(url)}"
                        if read_key in st.session_state:
                            _display_article(st.session_state[read_key])
                        else:
                            if st.button("📖 Read Article Inline", key=f"read_{i}"):
                                with st.spinner("Extracting article content..."):
                                    article_data = _extract_article(url)
                                    st.session_state[read_key] = article_data
                                    st.rerun()
                    else:
                        st.caption("No external link (HN text post)")
                        text = hit.get("story_text", "")
                        if text:
                            import re
                            clean = re.sub(r'<[^>]+>', '', text)
                            st.markdown(clean[:500])
                            
        except Exception as e:
            st.error(f"Search failed: {e}")


def _extract_article(url: str) -> dict:
    """Extract article content using newspaper3k."""
    try:
        from newspaper import Article
        
        article = Article(url)
        article.download()
        article.parse()
        
        return {
            "title": article.title,
            "text": article.text[:3000] if article.text else "Could not extract text.",
            "authors": ", ".join(article.authors) if article.authors else "Unknown",
            "publish_date": str(article.publish_date) if article.publish_date else "Unknown",
            "top_image": article.top_image,
            "success": True
        }
    except ImportError:
        return {"text": "newspaper3k not installed.", "success": False}
    except Exception as e:
        return {"text": f"Extraction failed: {e}", "success": False}


def _display_article(article_data: dict):
    """Display extracted article content inline."""
    if not article_data.get("success"):
        st.warning(article_data.get("text", "Could not extract article."))
        return
    
    st.markdown(f"""
    <div style="
        background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
        border-radius: 10px;
        padding: 20px;
        border-left: 4px solid #58a6ff;
        margin: 10px 0;
    ">
        <div style="color: #58a6ff; font-size: 1.1em; font-weight: bold; margin-bottom: 8px;">
            📄 {article_data.get('title', 'Article')}
        </div>
        <div style="color: #888; font-size: 0.85em; margin-bottom: 12px;">
            ✍️ {article_data.get('authors', 'Unknown')} • 📅 {article_data.get('publish_date', 'Unknown')}
        </div>
        <div style="color: #c9d1d9; font-size: 0.95em; line-height: 1.6;">
            {article_data.get('text', '')[:2000]}
        </div>
    </div>
    """, unsafe_allow_html=True)


def _render_hn_card(story: dict):
    """Render a HackerNews story card."""
    st.markdown(f"""
    <div style="
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-radius: 10px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid #ff6b35;
    ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #ff6b35; font-weight: bold;">🔺 {story['score']}</span>
            <span style="color: #888; font-size: 0.85em;">💬 {story['comments']} • {story['time_ago']}</span>
        </div>
        <div style="margin-top: 8px;">
            <a href="{story['url']}" target="_blank" style="
                color: #e0e0e0;
                text-decoration: none;
                font-size: 1.05em;
                font-weight: 500;
            ">
                {story['title'][:80]}{'...' if len(story['title']) > 80 else ''}
            </a>
        </div>
        <div style="margin-top: 5px; color: #666; font-size: 0.8em;">
            by {story['author']}
        </div>
    </div>
    """, unsafe_allow_html=True)


def _render_dzone_card(article: dict):
    """Render a DZone article card."""
    zone_colors = {
        "HOME": "#4a90d9", "AI-ML": "#9b59b6", "JAVA": "#e67e22",
        "DEVOPS": "#27ae60", "CLOUD": "#3498db", "WEBDEV": "#e74c3c"
    }
    zone_color = zone_colors.get(article.get("zone", "HOME"), "#4a90d9")
    
    st.markdown(f"""
    <div style="
        background: linear-gradient(135deg, #1e1e2f 0%, #252540 100%);
        border-radius: 10px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid {zone_color};
    ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="
                background: {zone_color}22;
                color: {zone_color};
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.75em;
                font-weight: bold;
            ">{article['zone']}</span>
            <span style="color: #888; font-size: 0.85em;">{article['time_ago']}</span>
        </div>
        <div style="margin-top: 8px;">
            <a href="{article['url']}" target="_blank" style="
                color: #e0e0e0;
                text-decoration: none;
                font-size: 1.05em;
                font-weight: 500;
            ">
                {article['title'][:75]}{'...' if len(article['title']) > 75 else ''}
            </a>
        </div>
        <div style="margin-top: 8px; color: #aaa; font-size: 0.85em; line-height: 1.4;">
            {article['summary'][:120]}{'...' if len(article['summary']) > 120 else ''}
        </div>
    </div>
    """, unsafe_allow_html=True)
