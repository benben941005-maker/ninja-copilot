FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY main.py .

# Copy frontend - make sure static/ folder exists in your repo
# with both index.html AND ai-driver-copilot.js inside it
COPY static/ static/

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "60", "main:app"]
