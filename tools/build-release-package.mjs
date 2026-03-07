import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveRecipe } from "../packages/recipes/resolveRecipe.mjs";

function parseArgs(argv) {
  const out = {
    outDir: "release/site",
    trackIds: []
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--outDir") {
      out.outDir = String(argv[i + 1] || out.outDir);
      i += 1;
      continue;
    }
    if (a === "--trackId") {
      const raw = String(argv[i + 1] || "");
      i += 1;
      out.trackIds.push(
        ...raw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      );
      continue;
    }
  }
  return out;
}

function toPosix(p) {
  return String(p || "").split(path.sep).join("/");
}

function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else if (ent.isFile()) fs.copyFileSync(from, to);
  }
}

function run(cmd, args, cwd) {
  const r = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", [cmd, ...args].join(" ")], { stdio: "inherit", cwd, shell: false })
    : spawnSync(cmd, args, { stdio: "inherit", cwd, shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`Command failed: ${cmd} ${args.join(" ")}`);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, v) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, "utf8");
}

function loadSelectedTracks(repoRoot, trackIds) {
  const tracksDir = path.join(repoRoot, "tracks");
  const indexPath = path.join(tracksDir, "index.json");
  const index = readJson(indexPath);
  const files = (Array.isArray(index) ? index : [])
    .map((rel) => path.join(tracksDir, rel))
    .filter((p) => fs.existsSync(p));
  const all = files.map((p) => readJson(p)).filter((t) => t && typeof t === "object");
  if (!trackIds.length) return all;
  const want = new Set(trackIds);
  return all.filter((t) => want.has(String(t?.trackId || "")));
}

function copyTrackAssets(repoRoot, outDir, track) {
  const assetDirRel = String(track?.assetDir || "");
  if (!assetDirRel) return;
  const srcAbs = path.resolve(repoRoot, assetDirRel);
  if (!srcAbs.startsWith(path.join(repoRoot, "assets"))) return;
  if (!fs.existsSync(srcAbs) || !fs.statSync(srcAbs).isDirectory()) return;
  const destAbs = path.join(outDir, toPosix(assetDirRel));
  copyDir(srcAbs, destAbs);
}

function writeReleaseTrack(repoRoot, outDir, track) {
  const trackId = String(track?.trackId || "");
  if (!trackId) return null;
  const albumId = String(track?.recipeRef?.albumId || "example-theme");
  const override = String(track?.recipeRef?.trackOverrideId || trackId);
  let recipe = null;
  try {
    recipe = resolveRecipe({ albumId, trackOverrideId: override });
  } catch {
    recipe = resolveRecipe({ albumId: "example-theme", trackOverrideId: override });
  }
  const recipeRel = `recipes/${trackId}.json`;
  writeJson(path.join(outDir, recipeRel), recipe);
  const trackOut = {
    ...track,
    releaseRecipePath: `/${toPosix(recipeRel)}`
  };
  const rel = `tracks/${trackId}.track.json`;
  writeJson(path.join(outDir, rel), trackOut);
  return rel;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(".");
  const outDir = path.resolve(repoRoot, args.outDir);

  run("npm", ["run", "build:release"], repoRoot);

  const distDir = path.join(repoRoot, "apps", "dev-viewer", "dist");
  if (!fs.existsSync(distDir)) throw new Error("Missing build output: apps/dev-viewer/dist");

  rmDir(outDir);
  ensureDir(outDir);
  copyDir(distDir, outDir);

  const tracks = loadSelectedTracks(repoRoot, args.trackIds);
  if (!tracks.length) throw new Error("No tracks selected");

  const indexOut = [];
  for (const track of tracks) {
    const rel = writeReleaseTrack(repoRoot, outDir, track);
    if (rel) indexOut.push(toPosix(rel.replace(/^tracks\//, "")));
    copyTrackAssets(repoRoot, outDir, track);
  }
  writeJson(path.join(outDir, "tracks", "index.json"), indexOut.sort());

  console.log(`release-package: tracks=${indexOut.length} outDir=${toPosix(path.relative(repoRoot, outDir))}`);
}

main();
