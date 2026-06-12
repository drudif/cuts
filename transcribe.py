#!/usr/bin/env python3
"""
Transcribes a media file with word-level timestamps using faster-whisper.
Cross-platform (CPU on Linux/x86) — replaces mlx-whisper, which is Apple-only.
Usage: python3 transcribe.py <file_path>
Output: JSON array of { word, start, end }
"""
import sys
import json
import re
from faster_whisper import WhisperModel

# Match the previous mlx 'whisper-small-mlx' model for quality parity.
MODEL_SIZE = "small"


def normalize(text):
    return re.sub(r'[^\w\s]', '', text.lower()).strip()


if len(sys.argv) < 2:
    print(json.dumps({"error": "No file path provided"}))
    sys.exit(1)

try:
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(sys.argv[1], word_timestamps=True)

    words = []
    for seg in segments:
        seg_words = seg.words or []
        if seg_words:
            for w in seg_words:
                words.append({
                    'word': normalize(w.word),
                    'start': round(w.start, 3),
                    'end': round(w.end, 3),
                })
        else:
            # Fallback: use segment-level if no word timestamps
            words.append({
                'word': normalize(seg.text),
                'start': round(seg.start, 3),
                'end': round(seg.end, 3),
                'segment': True,
            })

    print(json.dumps(words))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
