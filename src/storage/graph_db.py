import os
from neo4j import GraphDatabase as Neo4jDriver
import logging

class GraphDatabase:
    def __init__(self):
        # Default to Docker service name 'neo4j', fallback to localhost for local dev
        self.uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687") 
        self.user = os.getenv("NEO4J_USER", "neo4j")
        self.password = os.getenv("NEO4J_PASSWORD", "password123")
        self.driver = None
        
        try:
            self.driver = Neo4jDriver.driver(self.uri, auth=(self.user, self.password))
            self.verify_connection()
        except Exception as e:
            logging.error(f"Failed to connect to Neo4j: {e}")

    def verify_connection(self):
        if self.driver:
            try:
                self.driver.verify_connectivity()
                logging.info("Connected to Neo4j successfully.")
            except Exception as e:
                logging.error(f"Neo4j Connectivity Check Failed: {e}")

    def close(self):
        if self.driver:
            self.driver.close()

    def sync_paper(self, paper: dict):
        """
        Upsert a Paper node and link Authors.
        """
        if not self.driver: return

        query = """
        MERGE (p:Paper {title: $title})
        SET p.year = $year, 
            p.abstract = $abstract,
            p.source = $source,
            p.doi = $doi
        
        FOREACH (auth_name IN $authors |
            MERGE (a:Author {name: auth_name})
            MERGE (a)-[:WROTE]->(p)
        )
        
        FOREACH (ent_text IN $entities |
            MERGE (e:Entity {name: ent_text})
            MERGE (p)-[:MENTIONS]->(e)
        )
        """
        
        # Extract authors list
        authors = paper.get('authors', [])
        if isinstance(authors, str):
            authors = [a.strip() for a in authors.split(',')]

        # Extract entities list (expecting list of dicts from SQLite or flat list)
        entities = paper.get('entities', [])
        # If it's a list of dicts [{'text': 'AI', 'label': 'ORG'}], flatten to names
        entity_names = []
        if entities and isinstance(entities[0], dict):
            entity_names = [e.get('text') for e in entities]
        elif entities and isinstance(entities[0], str):
             entity_names = entities
             
        with self.driver.session() as session:
            session.run(query, 
                        title=paper.get('title', 'Unknown'),
                        year=paper.get('year'),
                        abstract=paper.get('text', '')[:500],
                        source=paper.get('source', 'Unknown'),
                        doi=paper.get('externalIds', {}).get('DOI'),
                        authors=authors,
                        entities=entity_names)
                        
    def wipe_db(self):
        if self.driver:
            with self.driver.session() as session:
                session.run("MATCH (n) DETACH DELETE n")

    def get_all_entity_names(self) -> list:
        """
        Fetch all Entity names from the graph.
        Used for embedding-based fuzzy matching in Graph Explorer.
        
        Returns:
            List of entity name strings.
        """
        if not self.driver:
            return []
        
        query = "MATCH (e:Entity) RETURN e.name as name"
        
        with self.driver.session() as session:
            result = session.run(query)
            return [record["name"] for record in result if record["name"]]

    def get_author_timeline(self, author_name: str):
        """
        Find papers written by Author, sorted by Year, and their mentioned Entities.
        """
        if not self.driver: return []
        
        # Fuzzy match author name
        query = """
        MATCH (a:Author)-[:WROTE]->(p:Paper)
        WHERE toLower(a.name) CONTAINS toLower($name)
        OPTIONAL MATCH (p)-[:MENTIONS]->(e:Entity)
        RETURN p.year as year, p.title as title, collect(e.name) as topics
        ORDER BY p.year DESC
        """
        
        with self.driver.session() as session:
            result = session.run(query, name=author_name)
            return [record.data() for record in result]

    def get_collaborators(self, author_name: str):
        """
        Find authors who co-wrote papers with the target user.
        """
        if not self.driver: return []
        
        query = """
        MATCH (target:Author)-[:WROTE]->(p:Paper)<-[:WROTE]-(co:Author)
        WHERE toLower(target.name) CONTAINS toLower($name)
        RETURN co.name as name, count(p) as strength
        ORDER BY strength DESC
        LIMIT 5
        """
        
        with self.driver.session() as session:
            result = session.run(query, name=author_name)
            return [record.data() for record in result]

    def delete_papers(self, titles: list):
        """
        Deletes papers by title list.
        """
        if not self.driver or not titles: return

        query = """
        MATCH (p:Paper)
        WHERE p.title IN $titles
        DETACH DELETE p
        """
        with self.driver.session() as session:
            session.run(query, titles=titles)
