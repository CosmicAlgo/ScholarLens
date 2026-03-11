import streamlit as st
import requests

def render_graph_tab(graph_db):
    """
    Renders the Graph Explorer Tab (Tab 2).
    Args:
        graph_db: GraphDatabase instance
    """
    st.header("🕸️ Semantic Graph Explorer")
    st.info("Explore relationships. You can ask questions like 'Who worked with Hinton?' or 'Show papers linking NLP and Biology'.")
    
    # SEARCH MODE
    graph_mode = st.radio("Graph Mode", ["Interactive Query (Natural Language)", "Author Collaboration", "Concept Network"], horizontal=True)
    
    if graph_mode == "Interactive Query (Natural Language)":
        

        graph_q = st.text_area("Ask a question about the graph:", placeholder="e.g. Show me papers about 'Reinforcement Learning'", height=100)
        
        allow_raw = st.checkbox("Allow Raw Cypher", value=False)
        use_fuzzy_match = st.checkbox("🧠 Smart Entity Match", value=True, help="Uses AI to find similar entities even with typos (e.g., 'RL' finds 'Reinforcement Learning').")
        
        # FUZZY ENTITY SUGGESTIONS
        if use_fuzzy_match and graph_q and not (graph_q.strip().upper().startswith("MATCH") or graph_q.strip().upper().startswith("CALL")):
            try:
                from src.processing.embedding_service import get_embedding_service
                entity_names = graph_db.get_all_entity_names()
                if entity_names:
                    embedding_service = get_embedding_service()
                    similar = embedding_service.find_similar_entities(graph_q, entity_names, top_k=5)
                    if similar and similar[0][1] > 0.3:  # Only show if reasonable match
                        st.caption("💡 **Similar entities found:**")
                        suggestions = [f"`{name}` ({score:.0%})" for name, score in similar if score > 0.3]
                        if suggestions:
                            st.markdown(" • ".join(suggestions[:3]))
            except Exception:
                pass  # Silently fail if embedding service unavailable
        
        # Help Text
        with st.expander("ℹ️ Query Examples"):
            st.markdown("- Show me papers about 'Reinforcement Learning'")
            st.markdown("- Who are the co-authors of 'Geoffrey Hinton'?")
            st.markdown("- Find the shortest path between 'Transformers' and 'Biology'")
            
        if graph_q and st.button("Generate Graph"):
            cypher = ""
            
            # Smart Detection: Is this probably Cypher Code?
            is_probably_code = graph_q.strip().upper().startswith("MATCH") or graph_q.strip().upper().startswith("CALL")
            
            if allow_raw or is_probably_code:
                # Raw Mode Logic
                cypher = graph_q
                
                # Safety Check for Placeholders (Common User Error)
                import re
                if "{" in cypher and re.search(r"\{\s*[a-zA-Z0-9_]+\s*\}", cypher):
                     st.error("⚠️ Syntax Error: Your query contains placeholders (like `{name}`). Please replace them with actual values (e.g. `'Hinion'`).")
                     cypher = None # Block execution
                
                # Safety Check for Invalid Inline WHERE (CONTAINS inside {})
                elif re.search(r"\{\s*[a-zA-Z0-9_]+\s+CONTAINS", cypher, re.IGNORECASE):
                     st.error("⚠️ Neo4j Syntax Error: You cannot use `CONTAINS` inside curly braces `{}`. \n\n**Correct:** `MATCH (n) WHERE n.name CONTAINS 'X'`\n**Incorrect:** `MATCH (n {name CONTAINS 'X'})`")
                     cypher = None
            
                else:
                    # NL -> LLM Logic
                    prompt = f"""
                    You are a Neo4j Cypher Expert.
                    
                    SCHEMA:
                    - (Author)-[:WROTE]->(Paper)
                    - (Paper)-[:MENTIONS]->(Entity)
                    - Author properties: {{name}}
                    - Paper properties: {{title, year, abstract}}
                    - Entity properties: {{name}} (Entities are NODES, not properties)
                    
                    CRITICAL SCHEMA RULES:
                    1. `Paper.entities` DOES NOT EXIST. Do NOT use it.
                    2. `Paper.authors` DOES NOT EXIST. Do NOT use it.
                    3. To find a paper's entities, you MUST use: `MATCH (p:Paper)-[:MENTIONS]->(e:Entity)`.
                    4. To find a paper's authors, you MUST use: `MATCH (a:Author)-[:WROTE]->(p:Paper)`.

                    VALID QUESTONS & CYPHER EXAMPLES (Use these as templates):

                    1. "Show me papers about 'Reinforcement Learning'"
                    MATCH (p:Paper)-[r:MENTIONS]->(e:Entity)
                    WHERE toLower(e.name) CONTAINS 'reinforcement learning' OR toLower(p.title) CONTAINS 'reinforcement learning'
                    RETURN p, r, e LIMIT 20

                    2. "Who works with 'Hinton'?" (Co-authorship)
                    MATCH (a1:Author)-[:WROTE]->(p:Paper)<-[:WROTE]-(a2:Author)
                    WHERE toLower(a1.name) CONTAINS 'hinton'
                    RETURN a2.name as Co_Author, count(p) as Shared_Papers
                    ORDER BY Shared_Papers DESC LIMIT 10

                    3. "Shortest path between 'Transformers' and 'Biology'"
                    MATCH (start:Entity), (end:Entity)
                    WHERE toLower(start.name) CONTAINS 'transformers' AND toLower(end.name) CONTAINS 'biology'
                    MATCH p = shortestPath((start)-[*..4]-(end))
                    RETURN p

                    4. "What did 'Bengio' write in 2023?"
                    MATCH (a:Author)-[r:WROTE]->(p:Paper)
                    WHERE toLower(a.name) CONTAINS 'bengio' AND p.year = 2023
                    RETURN a, r, p

                    RULES:
                    1. Output ONLY valid Cypher code. No explanations.
                    2. Use `toLower(n.prop) CONTAINS` for safe string matching.
                    3. DO NOT use `relationships()`, pattern expressions in WHERE, or complex `collect()` logic.
                    4. Always use generic directions `(a)-[:REL]->(b)` or undirected `(a)-[:REL]-(b)` if unsure.
                    5. LIMIT results to 20 to prevent crashes.
                    6. ALWAYS include the relationship variable in RETURN (e.g., `RETURN a, r, p` not just `RETURN a, p`) so edges are visualized.
                    7. Use UNIQUE variable names in RETURN. Never repeat the same variable (e.g., `RETURN p1, r1, e1, p2, r2, e2` NOT `RETURN p1, r, e1, p2, r, e2`).

                    Task: Convert this request to Cypher.
                    Request: "{graph_q}"
                    """
        

                    payload = {"model": "llama3", "prompt": prompt, "stream": False} 
                    
                    with st.spinner("Translating to Graph Query (Llama3)..."):
                        resp = requests.post("http://ollama:11434/api/generate", json=payload, timeout=300)
                        if resp.status_code == 200:
                            cypher = resp.json()['response'].strip()
                            # Robust Extraction: Handle Markdown or Plain Text with prefixes
                            import re
                            # 1. Try to extract from Markdown code block
                            code_block_match = re.search(r"```(?:cypher)?\s*(.*?)\s*```", cypher, re.DOTALL | re.IGNORECASE)
                            if code_block_match:
                                cypher = code_block_match.group(1).strip()
                            else:
                                # 2. Fallback: Heuristic extraction (Find start of MATCH/CALL)
                                # Removes "Here is the code:" prefix
                                match_start = re.search(r"\b(MATCH|CALL|WITH)\b", cypher, re.IGNORECASE)
                                if match_start:
                                    cypher = cypher[match_start.start():].strip()
                                
                             # Strip "```" just in case remnants exist
                            cypher = cypher.replace("```", "")
                            
                            # SAFETY: Force reduce excessive path limits
                            # Finds patterns like *1..25 or *..10 and caps them
                            import re
                            def reduce_hops(match):
                                start = match.group(1) or ""
                                end = int(match.group(2))
                                new_end = min(end, 4)
                                return f"*{start}..{new_end}"
                                
                            # Regex for *..25 or *1..25
                            cypher = re.sub(r"\*(\d*)\.\.(\d+)", reduce_hops, cypher)
                            
                        else:
                            st.error("LLM Service Unreachable.")
                            cypher = None

                if cypher:
                     # --- GLOBAL SAFETY CHECKS ---
                     if cypher.strip().upper().startswith("MATCH") and "RETURN" not in cypher.upper():
                         st.error("⚠️ Syntax Error: Yours query is missing a `RETURN` clause.")
                         cypher = None
                     
                     if cypher:
                         import re
                         def reduce_hops(match):
                             start = match.group(1) or ""
                             try:
                                 end = int(match.group(2))
                                 new_end = min(end, 4)
                                 return f"*{start}..{new_end}"
                             except Exception: return match.group(0)
                         cypher = re.sub(r"\*(\d*)\.\.(\d+)", reduce_hops, cypher)
                         
                         # FIX: Rename duplicate columns in RETURN clause
                         # e.g., "RETURN p1, r, e1, p2, r, e2" -> "RETURN p1, r AS r1, e1, p2, r AS r2, e2"
                         return_match = re.search(r'RETURN\s+(.+?)(\s+LIMIT|\s+ORDER|\s*$)', cypher, re.IGNORECASE | re.DOTALL)
                         if return_match:
                             return_clause = return_match.group(1).strip()
                             suffix = return_match.group(2)  # Preserve " LIMIT" etc.
                             cols = [c.strip() for c in return_clause.split(',')]
                             seen = {}
                             new_cols = []
                             for col in cols:
                                 base = col.split(' AS ')[0].strip() if ' AS ' in col.upper() else col
                                 if base in seen:
                                     seen[base] += 1
                                     new_cols.append(f"{base} AS {base}{seen[base]}")
                                 else:
                                     seen[base] = 1
                                     new_cols.append(col)
                             new_return = ', '.join(new_cols)
                             cypher = cypher[:return_match.start(1)] + new_return + suffix + cypher[return_match.end(0):]

                if cypher:
                    st.caption("Executing Cypher:")
                    st.code(cypher, language="cypher")
                    
                    # Execute
                    driver = graph_db.driver
                    with driver.session() as session:
                        res = session.run(cypher) 
                        
                        # --- 1. COLLECT DATA ---
                        from streamlit_agraph import agraph, Node, Edge, Config
                        import pandas as pd
                        
                        viz_nodes = []
                        viz_edges = []
                        seen_ids = set()
                        seen_edges = set()
                        table_rows = []
                        
                        count = 0
                        for record in res:
                            count += 1
                            # A. Tabular Serialization (Handle Graph Objects - extract readable names)
                            row_data = dict(record)
                            clean_row = {}
                            
                            def sanitize(val):
                                # Node: get name or title
                                if hasattr(val, 'id') and hasattr(val, 'labels'): 
                                    name = val.get('name') or val.get('title') or f"ID:{val.id}"
                                    label = list(val.labels)[0] if val.labels else "Node"
                                    return f"{name} ({label})"
                                # Path: summarize
                                if hasattr(val, 'nodes'): 
                                    nodes = [n.get('name') or n.get('title') or '?' for n in val.nodes]
                                    return " → ".join(nodes[:5])  # Show first 5 nodes in path
                                if isinstance(val, list): 
                                    return [sanitize(x) for x in val]
                                return val

                            for k,v in row_data.items():
                                clean_row[k] = sanitize(v)
                            table_rows.append(clean_row)
                            
                            # B. Graph Visualization Collector (Recursive)
                            def extract_graph_objects(item):
                                # NODE
                                if hasattr(item, 'labels'): 
                                    nid = str(item.id)
                                    if nid in seen_ids: return
                                    lbls = list(item.labels)
                                    name = item.get('name') or item.get('title') or "Unknown"
                                    color = "#FFD700" 
                                    if "Paper" in lbls: color = "#89CFF0" 
                                    if "Author" in lbls: color = "#FFAA33" 
                                    if "Entity" in lbls: color = "#98FB98"
                                    # Fix Visibility: White text, truncate long labels
                                    display_name = name[:40] + "..." if len(name) > 40 else name
                                    viz_nodes.append(Node(
                                        id=nid, 
                                        label=display_name, 
                                        size=25, 
                                        color=color, 
                                        font={'color': '#FFFFFF', 'size': 11, 'strokeWidth': 1, 'strokeColor': '#000000'},
                                        title=name  # Full name on hover
                                    ))
                                    seen_ids.add(nid)
                                
                                # RELATIONSHIP
                                elif hasattr(item, 'start_node'): 
                                    eid = str(item.id)
                                    if eid in seen_edges: return
                                    # Don't add label to edge - too cluttered
                                    viz_edges.append(Edge(
                                        source=str(item.start_node.id), 
                                        target=str(item.end_node.id),
                                        color='#666666'
                                    ))
                                    seen_edges.add(eid)
                                
                                # PATH
                                elif hasattr(item, 'nodes'):
                                    for n in item.nodes: extract_graph_objects(n)
                                    for r in item.relationships: extract_graph_objects(r)
                                
                                # LIST
                                elif isinstance(item, list):
                                    for sub in item: extract_graph_objects(sub)

                            for val in record.values():
                                extract_graph_objects(val)
                        
                        # --- 2. RENDER ---
                        has_graph = len(viz_nodes) > 0
                        
                        if has_graph:
                            st.success(f"Found {len(viz_nodes)} nodes & {len(viz_edges)} edges.")
                            
                            # Legend
                            st.caption("🔵 Paper | 🟠 Author | 🟢 Entity")
                            
                            config = Config(
                                width="100%", 
                                height=600, 
                                directed=True, 
                                nodeHighlightBehavior=True, 
                                highlightColor="#FF6B6B",
                                collapsible=False,
                                physics=True,
                                hierarchical=False,
                                node={
                                    'labelProperty': 'label', 
                                    'renderLabel': True,
                                    'labelPosition': 'bottom'
                                },
                                link={
                                    'renderLabel': False,  # Hide edge labels - too cluttered
                                    'color': '#555555',
                                    'strokeWidth': 1.5
                                }
                            )
                            agraph(nodes=viz_nodes, edges=viz_edges, config=config)
                        
                        if table_rows:
                            if not has_graph:
                                st.info(f"📊 Displaying {len(table_rows)} tabular results.")
                                st.dataframe(pd.DataFrame(table_rows), use_container_width=True)
                            else:
                                with st.expander("📄 View Data Table"):
                                    st.dataframe(pd.DataFrame(table_rows), use_container_width=True)
                        elif count == 0:
                             st.warning("No results found.")
                        
                        # --- AI EXPLANATION (Brief summary of results) ---
                        if has_graph and len(viz_nodes) > 0:
                            # Collect node names for context
                            paper_names = [n.title for n in viz_nodes if 'Paper' in str(n.color) or '#89CFF0' in str(n.color)][:5]
                            entity_names = [n.title for n in viz_nodes if '#98FB98' in str(n.color)][:5]
                            
                            # Quick explanation using TinyDolphin (fast)
                            try:
                                explain_prompt = f"""In exactly 3-4 sentences, explain what this knowledge graph shows for the query: "{graph_q}"
                                
The graph contains {len(viz_nodes)} nodes and {len(viz_edges)} relationships.
Papers found: {', '.join(paper_names[:3]) if paper_names else 'None'}
Entities/Topics: {', '.join(entity_names[:3]) if entity_names else 'None'}

Keep it brief and insightful. Focus on what connections we can see."""
                                
                                explain_payload = {"model": "tinydolphin", "prompt": explain_prompt, "stream": False}
                                explain_resp = requests.post("http://ollama:11434/api/generate", json=explain_payload, timeout=30)
                                
                                if explain_resp.status_code == 200:
                                    explanation = explain_resp.json().get('response', '').strip()
                                    if explanation:
                                        st.markdown("---")
                                        st.markdown(f"**💡 Insight:** {explanation}")
                            except Exception:
                                pass  # Silent fail - explanation is optional


        

    elif graph_mode == "Author Collaboration":
        st.caption("Explore co-authorship networks. **Drag nodes to rearrange, scroll to zoom.**")
        target_author = st.text_input("Enter Author Name to Explore", placeholder="e.g. Hinton, LeCun, Bengio")
        
        if target_author:
            driver = graph_db.driver
            if driver:
                cypher = """
                MATCH (a1:Author)-[:WROTE]->(p:Paper)<-[:WROTE]-(a2:Author)
                WHERE toLower(a1.name) CONTAINS toLower($name) AND a1 <> a2
                WITH a1, a2, count(p) as shared_papers
                ORDER BY shared_papers DESC
                LIMIT 10
                
                OPTIONAL MATCH (a2)-[:WROTE]->(p2:Paper)<-[:WROTE]-(a3:Author)
                WHERE a3 <> a1 AND a3 <> a2
                WITH a1, a2, shared_papers, collect(DISTINCT a3.name)[0..3] as level2
                
                RETURN a1.name as author, a2.name as coauthor, shared_papers, level2
                """
                
                with driver.session() as session:
                    res = session.run(cypher, name=target_author)
                    data = [r.data() for r in res]
                
                if data:
                    from streamlit_agraph import agraph, Node, Edge, Config
                    
                    viz_nodes = []
                    viz_edges = []
                    seen_nodes = set()
                    
                    # Central author
                    author_name = data[0]['author'] if data else target_author
                    viz_nodes.append(Node(
                        id="CENTER", 
                        label=author_name, 
                        size=35, 
                        color='#FF6B6B',
                        font={'color': '#FFFFFF', 'size': 14},
                        title=f"{author_name} (Searched)"
                    ))
                    seen_nodes.add("CENTER")
                    
                    for item in data:
                        coauthor = item['coauthor']
                        strength = item['shared_papers']
                        level2_authors = item.get('level2') or []
                        
                        # Color based on strength
                        color = '#4CAF50' if strength > 3 else '#2196F3' if strength > 1 else '#90CAF9'
                        node_size = 25 if strength > 3 else 20
                        
                        # Level 1 co-author
                        if coauthor not in seen_nodes:
                            viz_nodes.append(Node(
                                id=coauthor, 
                                label=coauthor[:20], 
                                size=node_size, 
                                color=color,
                                font={'color': '#FFFFFF', 'size': 11},
                                title=f"{coauthor}\n{strength} shared papers"
                            ))
                            seen_nodes.add(coauthor)
                        
                        viz_edges.append(Edge(
                            source="CENTER", 
                            target=coauthor,
                            width=min(strength, 5),
                            color='#666666'
                        ))
                        
                        # Level 2 connections
                        for l2_author in level2_authors[:2]:
                            if l2_author and l2_author not in seen_nodes:
                                viz_nodes.append(Node(
                                    id=l2_author, 
                                    label=l2_author[:15], 
                                    size=15, 
                                    color='#888888',
                                    font={'color': '#FFFFFF', 'size': 9},
                                    title=f"{l2_author}\n(Extended network)"
                                ))
                                seen_nodes.add(l2_author)
                                viz_edges.append(Edge(
                                    source=coauthor, 
                                    target=l2_author,
                                    color='#CCCCCC',
                                    dashes=True
                                ))
                    
                    config = Config(
                        width="100%",
                        height=500,
                        directed=False,
                        physics=True,
                        hierarchical=False,
                        nodeHighlightBehavior=True,
                        highlightColor="#FF6B6B",
                        node={'labelProperty': 'label', 'renderLabel': True},
                        link={'renderLabel': False, 'color': '#666666'}
                    )
                    
                    agraph(nodes=viz_nodes, edges=viz_edges, config=config)
                    
                    st.caption("""
                    🔴 **Searched Author** | 🟢 Strong (>3 papers) | 🔵 Collaborator | ⚪ Extended Network
                    
                    _Drag nodes to rearrange • Scroll to zoom • Hover for details_
                    """)
                else:
                    st.warning(f"No collaborators found for '{target_author}'. Check spelling or try a partial name.")

    elif graph_mode == "Concept Network":
        st.caption("Explore concept relationships. **Drag nodes to rearrange, scroll to zoom.**")
        
        concept_search = st.text_input(
            "Search Topic", 
            value=st.session_state.get("active_search", ""),
            placeholder="e.g., Machine Learning, Neural Networks, Transformer",
            key="concept_network_search"
        )
        
        search_topic = concept_search.strip()
        
        if not search_topic:
            st.info("Enter a topic above to explore related concepts and their connections.")
        else:
            driver = graph_db.driver
            if driver:
                cypher = """
                MATCH (p1:Paper)-[:MENTIONS]->(e1:Entity)
                WHERE toLower(p1.title) CONTAINS toLower($term) OR toLower(p1.abstract) CONTAINS toLower($term)
                WITH e1, count(p1) as freq1
                ORDER BY freq1 DESC
                LIMIT 8
                
                MATCH (p2:Paper)-[:MENTIONS]->(e1)
                MATCH (p2)-[:MENTIONS]->(e2:Entity)
                WHERE e1 <> e2
                WITH e1, freq1, e2, count(p2) as cooccur
                ORDER BY cooccur DESC
                
                WITH e1, freq1, collect({entity: e2.name, strength: cooccur})[0..3] as connections
                RETURN e1.name as entity, freq1, connections
                """
                
                with driver.session() as session:
                    res = session.run(cypher, term=search_topic)
                    data = [r.data() for r in res]
                
                if data:
                    from streamlit_agraph import agraph, Node, Edge, Config
                    
                    viz_nodes = []
                    viz_edges = []
                    seen_nodes = set()
                    
                    # Root node (search term)
                    viz_nodes.append(Node(
                        id="ROOT", 
                        label=search_topic, 
                        size=35, 
                        color='#FF9800',
                        font={'color': '#FFFFFF', 'size': 14},
                        title=f"{search_topic} (Your Search)"
                    ))
                    seen_nodes.add("ROOT")
                    
                    level2_count = 0
                    
                    for item in data:
                        ent = item['entity']
                        freq = item['freq1']
                        connections = item.get('connections') or []
                        
                        # Color based on frequency
                        if freq > 5:
                            color = '#4CAF50'
                        elif freq > 2:
                            color = '#2196F3'
                        else:
                            color = '#78909C'
                        
                        node_size = 25 if freq > 5 else 20
                        
                        # Level 1 entity
                        if ent not in seen_nodes:
                            viz_nodes.append(Node(
                                id=ent, 
                                label=ent[:25], 
                                size=node_size, 
                                color=color,
                                font={'color': '#FFFFFF', 'size': 11},
                                title=f"{ent}\nMentioned in {freq} matching papers"
                            ))
                            seen_nodes.add(ent)
                        
                        viz_edges.append(Edge(
                            source="ROOT", 
                            target=ent,
                            width=2,
                            color='#666666'
                        ))
                        
                        # Level 2 connections
                        for conn in connections:
                            e2_name = conn['entity']
                            strength = conn['strength']
                            
                            if e2_name not in seen_nodes and e2_name != search_topic:
                                viz_nodes.append(Node(
                                    id=e2_name, 
                                    label=e2_name[:20], 
                                    size=15, 
                                    color='#888888',
                                    font={'color': '#FFFFFF', 'size': 9},
                                    title=f"{e2_name}\nCo-occurs with {ent} in {strength} papers"
                                ))
                                seen_nodes.add(e2_name)
                                level2_count += 1
                            
                            if e2_name in seen_nodes:
                                viz_edges.append(Edge(
                                    source=ent, 
                                    target=e2_name,
                                    color='#CCCCCC',
                                    dashes=True
                                ))
                    
                    config = Config(
                        width="100%",
                        height=500,
                        directed=False,
                        physics=True,
                        hierarchical=False,
                        nodeHighlightBehavior=True,
                        highlightColor="#FF9800",
                        node={'labelProperty': 'label', 'renderLabel': True},
                        link={'renderLabel': False, 'color': '#666666'}
                    )
                    
                    agraph(nodes=viz_nodes, edges=viz_edges, config=config)
                    
                    st.caption(f"""
                    🟠 **{search_topic}** (Search) → 🟢/🔵 **Direct Concepts** ({len(data)}) → ⚪ **Co-occurring** ({level2_count})
                    
                    _Drag nodes to rearrange • Scroll to zoom • Hover for details_
                    """)
                else:
                    st.warning(f"No concepts found for '{search_topic}'. Try a different term or check Neo4j data.")

    # Developer Tools (Collapsed by default - not for regular users)
    with st.expander("⚙️ Developer Options", expanded=False):
        st.caption("_For developers and advanced users only_")
        st.link_button("Open Neo4j Browser", "http://localhost:7474")
        st.caption("Connection details are in `docker-compose.yml`")
