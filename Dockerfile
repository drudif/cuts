# Audio Speeder — Node server that shells out to ffmpeg + a Python (faster-whisper)
# transcriber. Needs ffmpeg, Python and the whisper model all baked in.
FROM node:20-slim

# System deps: ffmpeg/ffprobe for all routes, python for transcription.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-venv \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps inside a venv (avoids PEP 668 "externally-managed" on slim).
# Putting the venv first on PATH means `python3` resolves to it — the Node
# server spawns `python3 transcribe.py`, so it must find faster-whisper.
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the whisper model at build time so the first transcription
# request doesn't pay the ~480MB download (and works without runtime network).
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')"

# Node deps.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
