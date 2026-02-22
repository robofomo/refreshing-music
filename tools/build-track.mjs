import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseComposerFile } from "./parse-composer.mjs";
import { nzLocalStringToUtcIso } from "./time-nz-to-utc.mjs";
import { readJson5Lite } from "./read-json5-lite.mjs";

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

function recipeRefFromComposer(headerMap, trackId) {
  const theme = valueByKey(headerMap, "theme");
  const albumId = slugify(theme || "example-theme");
  return {
    albumId,
    trackOverrideId: trackId
  };
}

function createdFields(headerMap, audioStat) {
  const createdLocalRaw = valueByKey(headerMap, "created");
  if (!createdLocalRaw) {
    return { createdAt: new Date(audioStat.mtimeMs).toISOString() };
  }

  try {
    return {
      createdAt: nzLocalStringToUtcIso(createdLocalRaw),
      createdLocalRaw,
      createdTz: "Pacific/Auckland"
    };
  } catch {
    return { createdAt: new Date(audioStat.mtimeMs).toISOString() };
  }
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

function readJsonObjectIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const v = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function deriveAssetPaths(repoRoot, assetDirAbs, composerPath) {
  const toRel = (p) => toPosix(path.relative(repoRoot, p));
  const has = (name) => fs.existsSync(path.join(assetDirAbs, name));
  const mix = has("mix.mp3") ? toRel(path.join(assetDirAbs, "mix.mp3")) : "";
  const mixWav = has("mix.wav") ? toRel(path.join(assetDirAbs, "mix.wav")) : "";
  const stemsZip = has("stems.zip") ? toRel(path.join(assetDirAbs, "stems.zip")) : "";
  const instrumental = has("instrumental.mp3") ? toRel(path.join(assetDirAbs, "instrumental.mp3")) : "";
  const instrumentalWav = has("instrumental.wav") ? toRel(path.join(assetDirAbs, "instrumental.wav")) : "";
  const vocals = has("vocals.mp3") ? toRel(path.join(assetDirAbs, "vocals.mp3")) : "";
  const vocalsWav = has("vocals.wav") ? toRel(path.join(assetDirAbs, "vocals.wav")) : "";
  const composer = composerPath && fs.existsSync(composerPath) ? toRel(composerPath) : "";
  return { mix, mixWav, stemsZip, instrumental, instrumentalWav, vocals, vocalsWav, composer };
}

function upsertTracksIndex(tracksDir) {
  const byTrackId = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile() && entry.name.endsWith(".track.json")) {
        const rel = toPosix(path.relative(tracksDir, p));
        const trackId = entry.name.replace(/\.track\.json$/i, "");
        const cur = byTrackId.get(trackId);
        if (!cur) {
          byTrackId.set(trackId, rel);
        } else {
          const curDepth = cur.split("/").length;
          const nextDepth = rel.split("/").length;
          if (nextDepth < curDepth || (nextDepth === curDepth && rel.length < cur.length)) {
            byTrackId.set(trackId, rel);
          }
        }
      }
    }
  };
  walk(tracksDir);
  const out = Array.from(byTrackId.values());
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

function findTimingPath(mp3Path) {
  const base = path.parse(mp3Path).name;
  const alongside = path.join(path.dirname(mp3Path), `${base}.timing.json5`);
  if (fs.existsSync(alongside)) return alongside;
  const alongsideSlugged = path.join(path.dirname(mp3Path), `${slugify(base)}.timing.json5`);
  if (fs.existsSync(alongsideSlugged)) return alongsideSlugged;
  const direct = path.join(path.dirname(mp3Path), "timing.json5");
  if (fs.existsSync(direct)) return direct;
  return "";
}

function findAssetSidecar(mp3Path, filename) {
  const p = path.join(path.dirname(mp3Path), filename);
  return fs.existsSync(p) ? p : "";
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`Invalid JSON (${filePath}): ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function buildLyricLinesFromWords(lyricsRawText, wordsPayload) {
  const words = Array.isArray(wordsPayload?.words) ? wordsPayload.words : [];
  if (!words.length) return [];
  const rawLines = String(lyricsRawText ?? "").split(/\r?\n/);
  const out = [];
  let wordIdx = 0;

  for (let i = 0; i < rawLines.length; i += 1) {
    const text = rawLines[i]?.trim() ?? "";
    if (!text) continue;
    const target = tokenize(text);
    if (!target.length) continue;

    let matched = 0;
    let startWord = -1;
    let endWord = -1;
    while (wordIdx < words.length && matched < target.length) {
      const w = words[wordIdx];
      const token = tokenize(w?.text).join(" ");
      if (!token) {
        wordIdx += 1;
        continue;
      }
      if (token === target[matched]) {
        if (startWord === -1) startWord = wordIdx;
        endWord = wordIdx;
        matched += 1;
      }
      wordIdx += 1;
    }

    if (startWord !== -1) {
      const first = words[startWord];
      const last = words[endWord];
      const t0 = Number(first?.t0Ms);
      const t1 = Number(last?.t1Ms);
      if (Number.isFinite(t0)) {
        out.push({
          i,
          t0Ms: Math.max(0, Math.round(t0)),
          t1Ms: Number.isFinite(t1) ? Math.max(Math.round(t0), Math.round(t1)) : Math.round(t0) + 2200
        });
      }
    }
  }
  return out;
}

function buildTimingFromAi(track, mp3Path, timingPath) {
  const baseTiming = timingPath ? readJson5Lite(timingPath) : {};
  const beatsPath = findAssetSidecar(mp3Path, "beats.json");
  const wordsPath = findAssetSidecar(mp3Path, "words.json");
  const beats = readJsonIfExists(beatsPath);
  const words = readJsonIfExists(wordsPath);
  const timing = { ...(baseTiming && typeof baseTiming === "object" ? baseTiming : {}) };

  if ((!Array.isArray(timing.beatsMs) || timing.beatsMs.length === 0) && Array.isArray(beats?.beatTimesMs)) {
    timing.beatsMs = beats.beatTimesMs
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
      .map((n) => Math.max(0, Math.round(n)));
  }

  if ((!Array.isArray(timing.lyricsLines) || timing.lyricsLines.length === 0) && Array.isArray(words?.words)) {
    const inferred = buildLyricLinesFromWords(track?.lyrics?.rawText ?? "", words);
    if (inferred.length) timing.lyricsLines = inferred;
  }

  if (!Array.isArray(timing.words) && Array.isArray(words?.words)) {
    timing.words = words.words
      .map((w) => ({
        i: Number.isInteger(w?.i) ? w.i : undefined,
        t0Ms: Number.isFinite(Number(w?.t0Ms)) ? Math.max(0, Math.round(Number(w.t0Ms))) : undefined,
        t1Ms: Number.isFinite(Number(w?.t1Ms)) ? Math.max(0, Math.round(Number(w.t1Ms))) : undefined,
        text: String(w?.text ?? ""),
        conf: Number.isFinite(Number(w?.conf)) ? Number(w.conf) : undefined
      }))
      .filter((w) => Number.isFinite(w.t0Ms) && w.text);
  }

  return Object.keys(timing).length > 0 ? timing : null;
}

function validateTiming(track, timing, timingPath) {
  const sectionIds = new Set((track.sections ?? []).map((s) => s.id));
  for (const s of timing?.sections ?? []) {
    if (s?.id && !sectionIds.has(s.id)) {
      console.warn(`timing warning (${timingPath}): section id not found: ${s.id}`);
    }
  }

  const lyricLines = String(track.lyrics?.rawText ?? "").split("\n");
  for (const row of timing?.lyricsLines ?? []) {
    const i = row?.i;
    if (!Number.isInteger(i) || i < 0 || i >= lyricLines.length) {
      console.warn(`timing warning (${timingPath}): lyricsLines i out of range: ${i}`);
    }
  }
}

export function buildTrack(opts) {
  return buildTrackWithOptions(opts);
}

export function buildTrackWithOptions({
  mp3Path,
  composerPath,
  titleArg,
  trackJsonPath,
  workIdOverride,
  trackIdOverride,
  sourceGroupKey,
  assetDir
}) {
  if (!mp3Path) throw new Error("--mp3 is required");
  if (!fs.existsSync(mp3Path)) throw new Error(`Missing mp3: ${mp3Path}`);

  const composer = composerDataFromFile(composerPath);
  const headerTitle = titleFromHeaderMap(composer.headerMap);
  const title = headerTitle || titleArg || "";
  if (!title) throw new Error("Title not found in headerMap and --title not provided");

  const style = valueByKey(composer.headerMap, "style");
  const composerVersion = valueByKey(composer.headerMap, "composer version");
  const ids = runIdGen({ mp3Path, title, style, composerVersion, composerPath });
  const trackId = trackIdOverride || ids.trackId;
  const workId = workIdOverride || ids.workId;

  const tracksDir = trackJsonPath ? path.resolve(path.dirname(trackJsonPath)) : path.resolve("tracks");
  const defaultSlug = ids.slugBase || slugify(title) || "untitled";
  const slug = trackJsonPath ? defaultSlug : uniqueSlug(tracksDir, defaultSlug, trackId);
  const outPath = trackJsonPath ? path.resolve(trackJsonPath) : path.join(tracksDir, slug, `${trackId}.track.json`);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  const existing = readJsonObjectIfExists(outPath);

  const audioStat = fs.statSync(mp3Path);
  const audioPath = toPosix(path.relative(outDir, mp3Path));
  const created = createdFields(composer.headerMap, audioStat);

  const track = {
    workId,
    trackId,
    recipeRef: recipeRefFromComposer(composer.headerMap, trackId),
    createdAt: created.createdAt,
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
  if (sourceGroupKey) track.sourceGroupKey = sourceGroupKey;
  else if (typeof existing?.sourceGroupKey === "string" && existing.sourceGroupKey) {
    track.sourceGroupKey = existing.sourceGroupKey;
  }

  if (assetDir) track.assetDir = toPosix(assetDir);
  else if (typeof existing?.assetDir === "string" && existing.assetDir) {
    track.assetDir = existing.assetDir;
  }

  if (created.createdLocalRaw) track.createdLocalRaw = created.createdLocalRaw;
  if (created.createdTz) track.createdTz = created.createdTz;
  const timingPath = findTimingPath(mp3Path);
  try {
    const timing = buildTimingFromAi(track, mp3Path, timingPath);
    if (timing) {
      track.timing = timing;
      validateTiming(track, timing, timingPath || path.join(path.dirname(mp3Path), "timing.json5"));
    }
  } catch (err) {
    console.warn(err instanceof Error ? err.message : String(err));
  }

  // Preserve import metadata across preprocess runs.
  if (existing?.import && typeof existing.import === "object") {
    track.import = existing.import;
  }

  // Keep asset path metadata current so runtime can discover stems/mix channels.
  const repoRoot = path.resolve(".");
  const assetDirAbs = path.dirname(mp3Path);
  track.assetPaths = deriveAssetPaths(repoRoot, assetDirAbs, composerPath);

  fs.writeFileSync(outPath, `${JSON.stringify(track, null, 2)}\n`, "utf8");
  upsertTracksIndex(tracksDir);

  return { outputPath: outPath, slug, trackId };
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
