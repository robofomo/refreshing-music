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

function parseJsonFromNoisyOutput(stdout, stderr) {
  const direct = String(stdout || "").trim();
  if (direct) {
    try {
      return JSON.parse(direct);
    } catch {
      // Continue with relaxed extraction below.
    }
  }

  const merged = `${String(stdout || "")}\n${String(stderr || "")}`;
  const start = merged.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < merged.length; i += 1) {
      const ch = merged[i];
      if (inStr) {
        if (esc) {
          esc = false;
        } else if (ch === "\\") {
          esc = true;
        } else if (ch === "\"") {
          inStr = false;
        }
        continue;
      }
      if (ch === "\"") {
        inStr = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const slice = merged.slice(start, i + 1);
          return JSON.parse(slice);
        }
      }
    }
  }
  throw new Error("No JSON payload found in WhisperX output");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyTrackId = typeof args.trackId === "string" ? args.trackId : "";
  const force = Boolean(args["force-whisperx"]);
  const overwriteAi = Boolean(args["overwrite-ai"] || args.overwrite);
  const language = typeof args.language === "string" ? args.language : "en";
  const device = typeof args.device === "string" ? args.device : "cpu";
  const model = typeof args.model === "string" ? args.model : "small";
  const assetsRoot = path.resolve("assets");
  const all = listAssetTracks(assetsRoot);
  const tracks = onlyTrackId ? all.filter((t) => t.trackId === onlyTrackId) : all;

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let idx = 0;
  for (const t of tracks) {
    idx += 1;
    const outPath = path.join(t.assetDir, "words.json");
    const composerPath = path.join(t.assetDir, "composer.txt");
    const allow = force || hasLyricalContent(composerPath);
    if (!allow) {
      skipped += 1;
      console.log(`whisperx [${idx}/${tracks.length}] skip ${t.trackId} (no lyric lines)`);
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
      console.log(`whisperx [${idx}/${tracks.length}] skip ${t.trackId} (no audio)`);
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "skipped",
          reason: "No vocals.(wav|mp3) or mix.(wav|mp3) found"
        }
      });
      continue;
    }

    if (!overwriteAi && fs.existsSync(outPath)) {
      skipped += 1;
      console.log(`whisperx [${idx}/${tracks.length}] skip ${t.trackId} (words.json exists)`);
      updateTrackLog(t.assetDir, {
        whisperx: {
          status: "skipped",
          reason: "words.json exists (use --overwrite-ai to regenerate)",
          audioPath,
          language,
          device,
          model
        }
      });
      continue;
    }

    const r = runWhisperx(audioPath, { language, device, model });
    if (r.status !== 0) {
      failed += 1;
      console.log(`whisperx [${idx}/${tracks.length}] error ${t.trackId}`);
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
      const parsed = parseJsonFromNoisyOutput(r.stdout, r.stderr);
      writeJson(outPath, parsed);
      ok += 1;
      console.log(`whisperx [${idx}/${tracks.length}] ok ${t.trackId}`);
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
