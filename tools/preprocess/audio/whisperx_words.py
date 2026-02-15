#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def err(msg: str, code: int = 1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--language", default="en")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    audio_path = Path(args.audio_path)
    if not audio_path.exists():
        err(f"Missing audio file: {audio_path}")

    try:
        import whisperx
    except Exception as e:
        err(f"WhisperX import failed: {e}")

    try:
        model = whisperx.load_model(
            args.model,
            args.device,
            language=args.language,
            compute_type="int8" if args.device == "cpu" else "float16",
        )
        audio = whisperx.load_audio(str(audio_path))
        result = model.transcribe(audio, batch_size=8, language=args.language)
        language_code = result.get("language", args.language)
        segments = result.get("segments", [])

        try:
            align_model, metadata = whisperx.load_align_model(language_code=language_code, device=args.device)
            aligned = whisperx.align(
                segments,
                align_model,
                metadata,
                audio,
                args.device,
                return_char_alignments=False,
            )
            segments = aligned.get("segments", segments)
        except Exception:
            # If alignment fails, fall back to segment-only outputs.
            pass

        words_out = []
        for seg in segments:
            words = seg.get("words", [])
            if words:
                for w in words:
                    t0 = w.get("start", seg.get("start", 0.0))
                    t1 = w.get("end", seg.get("end", t0))
                    txt = (w.get("word") or w.get("text") or "").strip()
                    if not txt:
                        continue
                    conf = w.get("score", w.get("probability", seg.get("avg_logprob")))
                    words_out.append(
                        {
                            "t0Ms": int(round(float(t0) * 1000.0)),
                            "t1Ms": int(round(float(t1) * 1000.0)),
                            "text": txt,
                            "conf": float(conf) if conf is not None else None,
                        }
                    )
            else:
                t0 = seg.get("start", 0.0)
                t1 = seg.get("end", t0)
                txt = (seg.get("text") or "").strip()
                if txt:
                    words_out.append(
                        {
                            "t0Ms": int(round(float(t0) * 1000.0)),
                            "t1Ms": int(round(float(t1) * 1000.0)),
                            "text": txt,
                            "conf": float(seg.get("avg_logprob")) if seg.get("avg_logprob") is not None else None,
                        }
                    )

        out = {
            "words": words_out,
            "segments": [
                {
                    "t0Ms": int(round(float(s.get("start", 0.0)) * 1000.0)),
                    "t1Ms": int(round(float(s.get("end", 0.0)) * 1000.0)),
                    "text": (s.get("text") or "").strip(),
                }
                for s in segments
            ],
            "meta": {
                "language": language_code,
                "model": args.model,
                "device": args.device,
            },
        }
        print(json.dumps(out))
    except Exception as e:
        err(f"WhisperX processing failed: {e}")


if __name__ == "__main__":
    main()
