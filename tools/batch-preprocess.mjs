import fs from "node:fs";
import path from "node:path";
import { buildTrack } from "./build-track.mjs";

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function titleFromSlug(slug) {
  return String(slug ?? "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function pickAudio(dir) {
  const priority = ["mix.mp3", "instrumental.mp3", "vocals.mp3"];
  for (const f of priority) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) return p;
  }
  const all = fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mp3"))
    .map((e) => e.name)
    .sort();
  return all.length ? path.join(dir, all[0]) : "";
}

function ensureComposer(assetDir) {
  const composerPath = path.join(assetDir, "composer.txt");
  if (!fs.existsSync(composerPath)) {
    fs.writeFileSync(composerPath, "", "utf8");
    return { composerPath, created: true };
  }
  return { composerPath, created: false };
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

try {
  const assetsRoot = path.resolve("assets");
  if (!fs.existsSync(assetsRoot)) {
    console.log("Generated 0 track file(s). Created blank composer files: 0.");
    process.exit(0);
  }

  let generated = 0;
  let createdComposer = 0;
  const workDirs = fs.readdirSync(assetsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());

  for (const workDir of workDirs) {
    const workId = slugify(workDir.name) || workDir.name;
    const workPath = path.join(assetsRoot, workDir.name);
    const trackDirs = fs.readdirSync(workPath, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const trackDir of trackDirs) {
      const trackId = trackDir.name;
      const assetDir = path.join(workPath, trackDir.name);
      const mp3Path = pickAudio(assetDir);
      if (!mp3Path) continue;
      const { composerPath, created } = ensureComposer(assetDir);
      const sourceGroupKey = workId;
      const trackJsonPath = path.join(path.resolve("tracks"), `${trackId}.track.json`);

      buildTrack({
        mp3Path,
        composerPath,
        titleArg: titleFromSlug(workId),
        trackJsonPath,
        workIdOverride: workId,
        trackIdOverride: trackId,
        sourceGroupKey,
        assetDir: toPosix(path.relative(path.resolve("."), assetDir))
      });

      generated += 1;
      if (created) createdComposer += 1;
    }
  }

  console.log(`Generated ${generated} track file(s). Created blank composer files: ${createdComposer}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
