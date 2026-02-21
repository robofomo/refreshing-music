import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refresh-import-smoke-"));
  const inboxDir = path.join(tmpRoot, "inbox");
  const assetsRoot = path.join(tmpRoot, "assets");
  const tracksDir = path.join(tmpRoot, "tracks");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(tracksDir, { recursive: true });

  // Fake mp3 bytes are enough for import/build metadata paths.
  fs.writeFileSync(path.join(inboxDir, "demo song mix.mp3"), "FAKE_MP3_BYTES", "utf8");
  fs.writeFileSync(path.join(inboxDir, "demo song composer.txt"), "[Title: Demo Song]\n[Theme: Random]\n", "utf8");
  fs.writeFileSync(path.join(inboxDir, "demo song stems.zip"), "PK", "utf8");

  const importerPath = path.resolve("tools", "import-inbox.mjs");
  const cmdArgs = [
    importerPath,
    "--inbox-dir",
    inboxDir,
    "--assets-root",
    assetsRoot,
    "--tracks-dir",
    tracksDir,
    "--json"
  ];
  const res = spawnSync(process.execPath, cmdArgs, { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(res.stderr.trim() || res.stdout.trim() || "import-inbox failed");
  }

  const report = JSON.parse(res.stdout);
  assert(report.imported === 1, `expected imported=1, got ${report.imported}`);

  const trackFiles = fs
    .readdirSync(tracksDir)
    .filter((x) => x.endsWith(".track.json"))
    .map((x) => path.join(tracksDir, x));
  assert(trackFiles.length === 1, `expected 1 track file, got ${trackFiles.length}`);

  const track = JSON.parse(fs.readFileSync(trackFiles[0], "utf8"));
  assert(track.trackId, "missing trackId");
  assert(track.workId, "missing workId");
  assert(track.assetDir, "missing assetDir");
  assert(track.assetPaths?.mix, "missing assetPaths.mix");
  assert(track.assetPaths?.composer, "missing assetPaths.composer");
  assert(track.import?.firstImportedAt, "missing import.firstImportedAt");
  assert(track.import?.lastImportedAt, "missing import.lastImportedAt");
  assert(track.import?.inputHashes && Object.keys(track.import.inputHashes).length > 0, "missing input hashes");

  console.log("import:inbox smoke ok");
  console.log(`tmp fixture: ${tmpRoot}`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
