import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = { dryRun: false, trackId: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    if (a === "--trackId") {
      out.trackId = String(argv[i + 1] || "").trim();
      i += 1;
    }
  }
  return out;
}

function runNode(script, args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || "inherit"
  });
}

function listTrackFiles(tracksDir) {
  if (!fs.existsSync(tracksDir)) return [];
  return fs
    .readdirSync(tracksDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".track.json"))
    .map((e) => path.join(tracksDir, e.name));
}

function needsRepair(repoRoot, track) {
  const lyricRaw = String(track?.lyrics?.rawText ?? "").trim();
  if (!lyricRaw) return false;
  const assetDirRel = String(track?.assetDir ?? "");
  if (!assetDirRel) return false;
  const wordsPath = path.join(path.resolve(repoRoot, assetDirRel), "words.json");
  if (!fs.existsSync(wordsPath)) return false;
  const wordsCount = Array.isArray(track?.timing?.words) ? track.timing.words.length : 0;
  const linesCount = Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines.length : 0;
  return wordsCount === 0 || linesCount === 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(".");
  const tracksDir = path.join(repoRoot, "tracks");
  const target = [];

  for (const filePath of listTrackFiles(tracksDir)) {
    let track;
    try {
      track = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const trackId = String(track?.trackId ?? "");
    if (!trackId) continue;
    if (args.trackId && args.trackId !== trackId) continue;
    if (needsRepair(repoRoot, track)) target.push(trackId);
  }

  if (!target.length) {
    console.log("repair:lyrics no tracks need repair");
    return;
  }

  const csv = target.join(",");
  console.log(`repair:lyrics targets=${csv}`);
  if (args.dryRun) return;

  const rebuild = runNode("tools/batch-preprocess.mjs", ["--trackId", csv]);
  if (rebuild.status !== 0) process.exit(rebuild.status || 1);

  const reduce = runNode("tools/reduce-effective-all.mjs", ["--trackId", csv]);
  if (reduce.status !== 0) process.exit(reduce.status || 1);
}

main();
