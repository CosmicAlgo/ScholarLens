from typing import List, Union
from sentence_transformers import SentenceTransformer
import numpy as np

class EmbeddingGenerator:
    """
    Handles generation of semantic embeddings using Sentence-Transformers.
    """
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the embedding model.
        """
        self.model_name = model_name
        print(f"Loading Embedding Model ({model_name})... this might take a moment...")
        self.model = SentenceTransformer(model_name)

    def generate_embedding(self, text: Union[str, List[str]]) -> np.ndarray:
        """
        Generate vector embedding for the given text.
        
        Args:
            text: A string or list of strings to embed.
            
        Returns:
            A numpy array representing the vector.
        """
        return self.model.encode(text)

if __name__ == "__main__":
    generator = EmbeddingGenerator()
    vector = generator.generate_embedding("Artificial Intelligence timeline")
    print(f"Vector shape: {vector.shape}")
