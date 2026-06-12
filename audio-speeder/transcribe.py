#!/usr/bin/env python3
"""
Transcribes a media file with word-level timestamps using mlx-whisper.
Usage: python3 transcribe.py <file_path>
Output: JSON array of { word, start, end }
"""
import sys
import json
import re
import mlx_whisper

def normalize(text):
    return re.sub(r'[^\w\s]', '', text.lower()).strip()

if len(sys.argv) < 2:
    print(json.dumps({"error": "No file path provided"}))
    sys.exit(1)

try:
    result = mlx_whisper.transcribe(
        sys.argv[1],
        path_or_hf_repo='mlx-community/whisper-small-mlx',
        word_timestamps=True
    )

    words = []
    for seg in result.get('segments', []):
        seg_words = seg.get('words', [])
        if seg_words:
            for w in seg_words:
                words.append({
                    'word': normalize(w['word']),
                    'start': round(w['start'], 3),
                    'end': round(w['end'], 3)
                })
        else:
            # Fallback: use segment-level if no word timestamps
            words.append({
                'word': normalize(seg.get('text', '')),
                'start': round(seg['start'], 3),
                'end': round(seg['end'], 3),
                'segment': True
            })

    print(json.dumps(words))

except Exception as e:
    print(json.dumps({"error": str(e)}))
    sys.exit(1)
