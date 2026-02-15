import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  listAssetTracks,
  parseArgs,
  pickAudioForBeats,
  updateTrackLog,
  writeJson
} from "./preprocess-ai-lib.mjs";

function runPythonBeat(audioPath) {
  const py = process.env.PYTHON || "python";
  const script = path.resolve("tools", "preprocess", "audio", "beat_detect.py");
  return spawnSync(py, [script, audioPath], { encoding: "utf8" });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyTrackId = typeof args.trackId === "string" ? args.trackId : "";
  const assetsRoot = path.resolve("assets");
  const all = listAssetTracks(assetsRoot);
  const tracks = onlyTrackId ? all.filter((t) => t.trackId === onlyTrackId) : all;

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  for (const t of tracks) {
    const audioPath = pickAudioForBeats(t.assetDir);
    if (!audioPath) {
      skipped += 1;
      updateTrackLog(t.assetDir, {
        beats: {
          status: "skipped",
          reason: "No instrumental.mp3 or mix.mp3 found"
        }
      });
      continue;
    }

    const r = runPythonBeat(audioPath);
    if (r.status !== 0) {
      failed += 1;
      updateTrackLog(t.assetDir, {
        beats: {
          status: "error",
          error: (r.stderr || r.stdout || "unknown error").trim(),
          audioPath
        }
      });
      continue;
    }

    try {
      const parsed = JSON.parse((r.stdout || "").trim() || "{}");
      writeJson(path.join(t.assetDir, "beats.json"), parsed);
      ok += 1;
      updateTrackLog(t.assetDir, {
        beats: {
          status: "ok",
          audioPath
        }
      });
    } catch (err) {
      failed += 1;
      updateTrackLog(t.assetDir, {
        beats: {
          status: "error",
          error: `Invalid JSON from beat_detect.py: ${err instanceof Error ? err.message : String(err)}`,
          audioPath
        }
      });
    }
  }

  console.log(`beats: ok=${ok} failed=${failed} skipped=${skipped}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
