import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseComposerFile } from "./parse-composer.mjs";
import {
  listAssetTracks,
  parseArgs,
  pickAudioForWhisperx,
  updateTrackLog,
  writeJson
} from "./preprocess-ai-lib.mjs";

function hasLyricalContent(composerPath) {
  if (!composerPath || !fs.existsSync(composerPath)) return false;
  try {
    const parsed = parseComposerFile(composerPath);
    const nonEmpty = String(parsed.lyricsRawText ?? "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return nonEmpty.length > 0;
  } catch {
    return false;
  }
}

function runWhisperx(audioPath, { language, device, model }) {
  const py = process.env.PYTHON || "python";
  const script = path.resolve("tools", "preprocess", "audio", "whisperx_words.py");
  return spawnSync(
    py,
    [script, audioPath, "--language", language, "--device", device, "--model", model],
    { encoding: "utf8" }
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyTrackId = typeof args.trackId === "string" ? args.trackId : "";
  const force = Boolean(args["force-whisperx"]);
  const language = typeof args.language === "string" ? args.language : "en";
  const device = typeof args.device === "string" ? args.device : "cpu";
  const model = typeof args.model === "string" ? args.model : "small";
  const assetsRoot = path.resolve("assets");
  const all = listAssetTracks(assetsRoot);
  const tracks = onlyTrackId ? all.filter((t) => t.trackId === onlyTrackId) : all;

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of tracks) {
    const composerPath = path.join(t.assetDir, "composer.txt");
    const allow = force || hasLyricalContent(composerPath);
    if (!allow) {
      skipped += 1;
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "skipped",
          reason: "composer.txt has no lyric lines (use --force-whisperx to override)"
        }
      });
      continue;
    }

    const audioPath = pickAudioForWhisperx(t.assetDir);
    if (!audioPath) {
      skipped += 1;
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "skipped",
          reason: "No vocals.mp3 or mix.mp3 found"
        }
      });
      continue;
    }

    const r = runWhisperx(audioPath, { language, device, model });
    if (r.status !== 0) {
      failed += 1;
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "error",
          error: (r.stderr || r.stdout || "unknown error").trim(),
          audioPath
        }
      });
      continue;
    }

    try {
      const parsed = JSON.parse((r.stdout || "").trim() || "{}");
      writeJson(path.join(t.assetDir, "words.json"), parsed);
      ok += 1;
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "ok",
          audioPath,
          language,
          device,
          model
        }
      });
    } catch (err) {
      failed += 1;
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "error",
          error: `Invalid JSON from whisperx_words.py: ${err instanceof Error ? err.message : String(err)}`,
          audioPath
        }
      });
    }
  }

  console.log(`whisperx: ok=${ok} failed=${failed} skipped=${skipped}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
