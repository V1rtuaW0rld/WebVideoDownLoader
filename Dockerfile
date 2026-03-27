FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/opt/ytvenv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg curl ca-certificates python3-venv python3-pip git \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Crée un venv isolé
RUN python3 -m venv /opt/ytvenv \
    && /opt/ytvenv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/ytvenv/bin/pip install flask

# Installe yt-dlp depuis le dépôt GitHub (version la plus à jour)
RUN /opt/ytvenv/bin/pip install --force-reinstall --no-cache-dir \
    git+https://github.com/yt-dlp/yt-dlp.git

# Crée l’utilisateur non-root
RUN addgroup --gid 1000 ytgroup \
    && adduser --disabled-password --gecos '' --uid 1000 --gid 1000 ytuser

WORKDIR /app
COPY . /app
RUN chmod +x /app/scripts/run_yt_dlp.sh
USER ytuser

CMD ["python", "-m", "flask", "--app=main:app", "run", "--host=0.0.0.0"]