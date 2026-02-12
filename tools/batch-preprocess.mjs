import fs from "node:fs";
import path from "node:path";
import { buildTrack } from "./build-track.mjs";

function titleFromBase(base) {
  return base
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function findComposerPath(assetsDir, base) {
  const slugged = path.join(assetsDir, `${slugify(base)}.txt`);
  if (fs.existsSync(slugged)) return { composerPath: slugged, created: false };
  const exact = path.join(assetsDir, `${base}.txt`);
  if (fs.existsSync(exact)) return { composerPath: exact, created: false };
  fs.writeFileSync(slugged, "", "utf8");
  return { composerPath: slugged, created: true };
}

try {
  const assetsDir = path.resolve("dev-assets");
  const files = fs.readdirSync(assetsDir, { withFileTypes: true });
  const mp3s = files.filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".mp3"));

  let generated = 0;
  let createdComposer = 0;

  for (const mp3 of mp3s) {
    const mp3Path = path.join(assetsDir, mp3.name);
    const base = path.parse(mp3.name).name;
    const { composerPath, created } = findComposerPath(assetsDir, base);

    buildTrack({
      mp3Path,
      composerPath,
      titleArg: titleFromBase(base)
    });

    generated += 1;
    if (created) createdComposer += 1;
  }

  console.log(`Generated ${generated} track file(s). Created blank composer files: ${createdComposer}.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
