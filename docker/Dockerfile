FROM python:3.10-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies needed for building some Python packages.
# 'build-essential' is often needed for installing Python packages with C extensions.
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*


# Copy the requirements file into the container at /app
COPY requirements.txt /app/requirements.txt

# OPTIMIZATION: Install CPU-only PyTorch to save ~3GB of space (avoids CUDA bloat)
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Download the spaCy model during the build so it's baked into the image
# Download the spaCy model directly (using wheel to avoid regex/pip errors with older spacy versions)
RUN pip install https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.3.0/en_core_web_sm-3.3.0-py3-none-any.whl

# Copy the current directory contents into the container at /app
COPY . /app

# Make port 80 available to the world outside this container (only necessary if running a web service)
EXPOSE 80


CMD ["streamlit", "run", "src/ui/app.py", "--server.port", "8501", "--server.address", "0.0.0.0"]
