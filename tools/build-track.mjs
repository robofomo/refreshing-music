import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseComposerFile } from "./parse-composer.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key.startsWith("--")) {
      out[key.slice(2)] = val;
      i += 1;
    }
  }
  return out;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function titleFromHeaderMap(headerMap) {
  const exact = Object.entries(headerMap).find(([k]) => k.toLowerCase() === "title");
  if (exact) return exact[1];
  const song = Object.entries(headerMap).find(([k]) => k.toLowerCase() === "song title");
  if (song) return song[1];
  return "";
}

function valueByKey(headerMap, keyName) {
  const hit = Object.entries(headerMap).find(([k]) => k.toLowerCase() === keyName.toLowerCase());
  return hit ? hit[1] : "";
}

function uniqueSlug(tracksDir, slugBase, trackId) {
  let slug = slugBase;
  let n = 2;
  while (fs.existsSync(path.join(tracksDir, slug))) {
    const sameTrackPath = path.join(tracksDir, slug, `${trackId}.track.json`);
    if (fs.existsSync(sameTrackPath)) return slug;
    slug = `${slugBase}-${n}`;
    n += 1;
  }
  return slug;
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function upsertTracksIndex(tracksDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith(".track.json")) {
        out.push(toPosix(path.relative(tracksDir, p)));
      }
    }
  };
  walk(tracksDir);
  out.sort();
  fs.writeFileSync(path.join(tracksDir, "index.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
}

function runIdGen({ mp3Path, title, style, composerVersion, composerPath }) {
  const idGenPath = path.resolve("tools", "id-gen.mjs");
  const args = [idGenPath, mp3Path, title ?? "", style ?? "", composerVersion ?? ""];
  if (composerPath && fs.existsSync(composerPath)) args.push(composerPath);

  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "id-gen failed");
  }
  return JSON.parse(result.stdout);
}

function composerDataFromFile(composerPath) {
  if (!composerPath || !fs.existsSync(composerPath)) {
    return { rawText: "", headerMap: {}, sections: [], lyricsRawText: "" };
  }
  return parseComposerFile(composerPath);
}

export function buildTrack({ mp3Path, composerPath, titleArg }) {
  if (!mp3Path) throw new Error("--mp3 is required");
  if (!fs.existsSync(mp3Path)) throw new Error(`Missing mp3: ${mp3Path}`);

  const composer = composerDataFromFile(composerPath);
  const headerTitle = titleFromHeaderMap(composer.headerMap);
  const title = headerTitle || titleArg || "";
  if (!title) throw new Error("Title not found in headerMap and --title not provided");

  const style = valueByKey(composer.headerMap, "style");
  const composerVersion = valueByKey(composer.headerMap, "composer version");
  const ids = runIdGen({ mp3Path, title, style, composerVersion, composerPath });

  const tracksDir = path.resolve("tracks");
  const slug = uniqueSlug(tracksDir, ids.slugBase || slugify(title) || "untitled", ids.trackId);
  const outDir = path.join(tracksDir, slug);
  fs.mkdirSync(outDir, { recursive: true });

  const audioStat = fs.statSync(mp3Path);
  const outPath = path.join(outDir, `${ids.trackId}.track.json`);
  const audioPath = toPosix(path.relative(outDir, mp3Path));

  const track = {
    workId: ids.workId,
    trackId: ids.trackId,
    createdAt: new Date().toISOString(),
    slug,
    title,
    audio: {
      filename: path.basename(mp3Path),
      path: audioPath,
      cidOrTx: "",
      mime: "audio/mpeg",
      bytes: audioStat.size
    },
    composer: {
      rawText: composer.rawText,
      headerMap: composer.headerMap
    },
    sections: composer.sections,
    lyrics: {
      rawText: composer.lyricsRawText
    }
  };

  fs.writeFileSync(outPath, `${JSON.stringify(track, null, 2)}\n`, "utf8");
  upsertTracksIndex(tracksDir);

  return { outputPath: outPath, slug, trackId: ids.trackId };
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildTrack({
      mp3Path: args.mp3 ? path.resolve(args.mp3) : "",
      composerPath: args.composer ? path.resolve(args.composer) : "",
      titleArg: args.title ?? ""
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
