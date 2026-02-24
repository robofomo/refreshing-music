import fs from "node:fs";
import path from "node:path";
import { reduceTrackToEffective } from "./effective-state.mjs";

function parseArgs(argv) {
  const out = { trackIds: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trackId") {
      const next = argv[i + 1] || "";
      i += 1;
      for (const v of String(next).split(",")) {
        const id = v.trim();
        if (id) out.trackIds.add(id);
      }
    }
  }
  return out;
}

function listTrackFiles(tracksRoot) {
  return fs.readdirSync(tracksRoot)
    .filter((n) => n.endsWith(".track.json"))
    .map((n) => path.join(tracksRoot, n))
    .sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(".");
  const tracksRoot = path.join(repoRoot, "tracks");
  const files = listTrackFiles(tracksRoot);
  let ok = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const t = JSON.parse(fs.readFileSync(file, "utf8"));
      const trackId = String(t?.trackId || path.basename(file).replace(/\.track\.json$/i, ""));
      if (args.trackIds.size && !args.trackIds.has(trackId)) continue;
      const workId = String(t?.workId || "");
      const assetDirRel = String(t?.assetDir || "");
      if (!assetDirRel) continue;
      const assetDir = path.resolve(repoRoot, assetDirRel);
      if (!fs.existsSync(assetDir)) continue;
      reduceTrackToEffective({ repoRoot, trackId, workId, assetDir });
      ok += 1;
    } catch (err) {
      failed += 1;
      console.warn(`reduce-effective failed (${path.basename(file)}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`reduce-effective: ok=${ok} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main();
