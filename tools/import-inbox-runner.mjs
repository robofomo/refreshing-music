import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(bin, args, options = {}) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    cwd: options.cwd || process.cwd(),
    stdio: options.stdio || "pipe"
  });
}

function runNode(script, args, options = {}) {
  return run(process.execPath, [script, ...args], options);
}

function parseRunnerArgs(argv) {
  const out = {
    passArgs: [],
    noPost: false
  };
  for (const arg of argv) {
    if (arg === "--no-post") out.noPost = true;
    else out.passArgs.push(arg);
  }
  return out;
}

function processedTrackIds(report) {
  const ids = [];
  for (const g of report?.groups ?? []) {
    const status = String(g?.status ?? "");
    if (status === "skipped") continue;
    if (g?.trackId) ids.push(String(g.trackId));
  }
  return ids;
}

function toTrackIdCsv(report) {
  const ids = new Set();
  for (const id of processedTrackIds(report)) {
    if (id) ids.add(id);
  }
  return Array.from(ids).join(",");
}

function trackNeedsLyricRepair(repoRoot, trackId) {
  const trackPath = path.join(repoRoot, "tracks", `${trackId}.track.json`);
  if (!fs.existsSync(trackPath)) return false;
  let track;
  try {
    track = JSON.parse(fs.readFileSync(trackPath, "utf8"));
  } catch {
    return false;
  }

  const lyricRaw = String(track?.lyrics?.rawText ?? "").trim();
  if (!lyricRaw) return false;
  const assetDirRel = String(track?.assetDir ?? "");
  if (!assetDirRel) return false;
  const assetDirAbs = path.resolve(repoRoot, assetDirRel);
  const wordsPath = path.join(assetDirAbs, "words.json");
  if (!fs.existsSync(wordsPath)) return false;

  const timingWords = Array.isArray(track?.timing?.words) ? track.timing.words.length : 0;
  const timingLines = Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines.length : 0;
  return timingWords === 0 || timingLines === 0;
}

function findLyricRepairTrackIds(report, repoRoot) {
  const out = [];
  for (const trackId of processedTrackIds(report)) {
    if (trackNeedsLyricRepair(repoRoot, trackId)) out.push(trackId);
  }
  return out;
}

function runAiForTrackIds(trackIdCsv) {
  if (!trackIdCsv) return { status: 0 };

  if (process.platform === "win32") {
    const wsl = run("wsl", ["bash", "tools/wsl/run-ai.sh", "preprocess-ai", "--", "--trackId", trackIdCsv], { stdio: "inherit" });
    if (wsl.status === 0) return wsl;
  }
  return runNode("tools/preprocess-ai.mjs", ["--trackId", trackIdCsv], { stdio: "inherit" });
}

function main() {
  const { passArgs, noPost } = parseRunnerArgs(process.argv.slice(2));
  const wantsJson = passArgs.includes("--json");
  const dryRun = passArgs.includes("--dry-run");
  const importArgs = wantsJson ? passArgs : [...passArgs, "--json"];

  const imported = runNode("tools/import-inbox.mjs", importArgs);
  if (imported.status !== 0) {
    process.stdout.write(imported.stdout || "");
    process.stderr.write(imported.stderr || "");
    process.exit(imported.status || 1);
  }

  const raw = String(imported.stdout || "").trim();
  let report = null;
  try {
    report = JSON.parse(raw);
  } catch {
    if (wantsJson) process.stdout.write(raw ? `${raw}\n` : "");
    else process.stdout.write(String(imported.stdout || ""));
    process.stderr.write(imported.stderr || "");
    process.exit(1);
  }

  if (wantsJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(`${report.summary}\n`);
  if (imported.stderr) process.stderr.write(imported.stderr);

  if (dryRun || noPost) return;

  const trackIdCsv = toTrackIdCsv(report);
  if (!trackIdCsv) return;
  const repoRoot = process.cwd();

  const ai = runAiForTrackIds(trackIdCsv);
  if (ai.status !== 0) {
    process.exit(ai.status || 1);
  }

  const rebuild = runNode("tools/batch-preprocess.mjs", ["--trackId", trackIdCsv], { stdio: "inherit" });
  if (rebuild.status !== 0) {
    process.exit(rebuild.status || 1);
  }

  const reduce = runNode("tools/reduce-effective-all.mjs", ["--trackId", trackIdCsv], { stdio: "inherit" });
  if (reduce.status !== 0) {
    process.exit(reduce.status || 1);
  }

  const repairIds = findLyricRepairTrackIds(report, repoRoot);
  if (!repairIds.length) return;
  const repairCsv = repairIds.join(",");
  process.stdout.write(`[import:inbox] lyric timing repair for: ${repairCsv}\n`);

  const repairBuild = runNode("tools/batch-preprocess.mjs", ["--trackId", repairCsv], { stdio: "inherit" });
  if (repairBuild.status !== 0) {
    process.exit(repairBuild.status || 1);
  }
  const repairReduce = runNode("tools/reduce-effective-all.mjs", ["--trackId", repairCsv], { stdio: "inherit" });
  if (repairReduce.status !== 0) {
    process.exit(repairReduce.status || 1);
  }
}

main();
