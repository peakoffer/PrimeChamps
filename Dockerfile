# Backend (FastAPI agent server) image — for Railway / Fly / any container host.
# Build context is the repo ROOT because modules use absolute `backend.*`
# imports and must resolve from the working directory.
FROM python:3.11-slim

# System deps for playwright/chromium (OnlyFans scraper) + build tools.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for layer caching.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Playwright browser + its OS deps (used by the OnlyFans source).
RUN python -m playwright install --with-deps chromium

# App code.
COPY backend/ ./backend/

# Railway/most hosts inject $PORT. Bind 0.0.0.0 inside the container; the
# X-API-Key middleware + the platform edge are what gate access.
ENV PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.server:app --host 0.0.0.0 --port ${PORT:-8000}"]
