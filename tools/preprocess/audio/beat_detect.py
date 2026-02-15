#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def err(msg: str, code: int = 1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def main():
    if len(sys.argv) < 2:
        err("Usage: python tools/preprocess/audio/beat_detect.py <audio_path>")
    audio_path = Path(sys.argv[1])
    if not audio_path.exists():
        err(f"Missing audio file: {audio_path}")

    try:
        import essentia.standard as es
    except Exception as e:
        err(f"Essentia import failed: {e}")

    try:
        loader = es.MonoLoader(filename=str(audio_path), sampleRate=44100)
        audio = loader()
        extractor = es.RhythmExtractor2013(method="multifeature")
        bpm, beat_times_s, beats_confidence, _, _ = extractor(audio)

        beat_times_ms = [int(round(float(t) * 1000.0)) for t in beat_times_s]
        out = {
            "bpmEstimate": float(bpm) if bpm is not None else None,
            "beatTimesMs": beat_times_ms,
            "downbeatTimesMs": [],
            "confidence": {
                "beatsConfidence": float(beats_confidence) if beats_confidence is not None else None,
            },
            "source": "essentia.RhythmExtractor2013(multifeature)"
        }
        print(json.dumps(out))
    except Exception as e:
        err(f"Beat detection failed: {e}")


if __name__ == "__main__":
    main()
