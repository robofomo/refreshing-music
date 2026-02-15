import fs from "node:fs";
import path from "node:path";

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function toPosix(p) {
  return p.split(path.sep).join("/");
}

export function listAssetTracks(assetsRoot) {
  if (!fs.existsSync(assetsRoot)) return [];
  const out = [];
  const workDirs = fs.readdirSync(assetsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const work of workDirs) {
    const workId = work.name;
    const workDir = path.join(assetsRoot, work.name);
    const trackDirs = fs.readdirSync(workDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const track of trackDirs) {
      out.push({
        workId,
        trackId: track.name,
        assetDir: path.join(workDir, track.name)
      });
    }
  }
  out.sort((a, b) => a.trackId.localeCompare(b.trackId));
  return out;
}

export function pickAudioForBeats(assetDir) {
  const candidates = ["instrumental.mp3", "mix.mp3"];
  for (const name of candidates) {
    const p = path.join(assetDir, name);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

export function pickAudioForWhisperx(assetDir) {
  const candidates = ["vocals.mp3", "mix.mp3"];
  for (const name of candidates) {
    const p = path.join(assetDir, name);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

export function readTrackJsonForId(tracksRoot, trackId) {
  const p = path.join(tracksRoot, `${trackId}.track.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function updateTrackLog(assetDir, patch) {
  const logPath = path.join(assetDir, "ai-preprocess.log.json");
  const base = readJsonIfExists(logPath) ?? {};
  const next = {
    ...base,
    updatedAt: new Date().toISOString(),
    ...patch
  };
  writeJson(logPath, next);
  return logPath;
}
