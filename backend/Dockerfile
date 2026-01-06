FROM python:3.11-slim

# Install FreeTDS for MS SQL connectivity
RUN apt-get update && apt-get install -y \
    freetds-dev \
    freetds-bin \
    gcc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Expose port
EXPOSE 5000

# Run Flask app
CMD ["python", "-m", "flask", "--app", "app.main", "run", "--host", "0.0.0.0", "--port", "5000"]
