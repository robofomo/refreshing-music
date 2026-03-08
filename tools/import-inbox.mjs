import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yauzl from "yauzl";
import { buildTrack } from "./build-track.mjs";

const SUPPORTED_EXTS = new Set([".mp3", ".wav", ".txt", ".json5", ".zip"]);
const AUDIO_PRIORITY = ["mix", "instrumental", "vocals", "audio"];

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function kebab(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function normalizeWorkId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function fallbackWorkId(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `work_${y}${m}${d}`;
}

function readDirRecursive(rootDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile()) {
        out.push(absPath);
      }
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return out;
}

function stripCopySuffix(name) {
  let out = name.trim();
  let changed = true;
  while (changed) {
    changed = false;
    const next = out
      .replace(/\s*\(\d+\)\s*$/i, "")
      .replace(/(?:[\s_-]+)\d+\s*$/i, "")
      .trim();
    if (next !== out) {
      out = next;
      changed = true;
    }
  }
  return out;
}

function titleCaseFromRaw(raw) {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectRole(stem, ext) {
  const s = stem.toLowerCase();
  if (ext === ".txt" && /(?:^|[\s._-])work[-_]?id(?:$|[\s._-])/.test(s)) return "workIdOverride";
  if (ext === ".json5" && /(?:^|[\s._-])work[-_]?id(?:$|[\s._-])/.test(s)) return "workIdOverride";
  if (ext === ".mp3" || ext === ".wav") {
    if (/\bmix\b/.test(s)) return "mix";
    if (/\binstrumental\b|\binst\b/.test(s)) return "instrumental";
    if (/\bvocals?\b/.test(s)) return "vocals";
    return "audio";
  }
  if (ext === ".zip" && /\bstems?\b/.test(s)) return "stems";
  if (ext === ".txt") return "composer";
  if (ext === ".json5" && /\btiming\b/.test(s)) return "timing";
  return "other";
}

function baseTitleFromStem(stem) {
  let out = stripCopySuffix(stem);
  out = out.replace(/[.](mix|instrumental|inst|vocals?|stems?|composer|timing|work[-_]?id)$/i, "");
  out = out.replace(/(?:[\s_-]+)(mix|instrumental|inst|vocals?|stems?|composer|timing|work[-_]?id)$/i, "");
  out = stripCopySuffix(out);
  return titleCaseFromRaw(out);
}

function stripStemsSuffixTitle(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const noTempo = raw.replace(/\s*\((?:\d{2,3}(?:\.\d+)?)\s*bpm\)\s*$/i, "").trim();
  const noParen = noTempo.replace(/\s*\((?:stems?)\)\s*$/i, "").trim();
  return noParen.replace(/(?:[\s_-]+)stems?$/i, "").trim();
}

function extractBpmTag(value) {
  const raw = String(value ?? "");
  const m = raw.match(/\((\d{2,3}(?:\.\d+)?)\s*bpm\)/i) || raw.match(/(?:^|[\s_-])(\d{2,3}(?:\.\d+)?)\s*bpm(?:$|[\s_-])/i);
  if (!m) return null;
  const bpm = Number(m[1]);
  return Number.isFinite(bpm) ? bpm : null;
}

function basenamePrefix(stem) {
  const cleaned = baseTitleFromStem(stem);
  if (cleaned) return cleaned;
  const tokens = stem
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return titleCaseFromRaw(tokens.slice(0, 3).join(" "));
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    overwrite: false,
    json: false,
    jsonPath: "",
    inboxDir: "",
    assetsRoot: "",
    tracksDir: ""
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--overwrite") {
      out.overwrite = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out.jsonPath = next;
        i += 1;
      }
      continue;
    }
    if (arg === "--inbox-dir") {
      out.inboxDir = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--assets-root") {
      out.assetsRoot = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--tracks-dir") {
      out.tracksDir = argv[i + 1] || "";
      i += 1;
    }
  }
  return out;
}

function listTrackFiles(tracksDir) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".track.json")) out.push(p);
    }
  };
  if (fs.existsSync(tracksDir)) walk(tracksDir);
  return out;
}

function loadTrackCatalog(tracksDir) {
  const bySourceGroupKey = new Map();
  const byTrackId = new Map();
  for (const filePath of listTrackFiles(tracksDir)) {
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const entry = {
        trackId: String(payload?.trackId ?? ""),
        workId: String(payload?.workId ?? ""),
        filePath
      };
      if (!entry.trackId) continue;
      byTrackId.set(entry.trackId, entry);
      const sourceGroupKey = String(payload?.sourceGroupKey ?? "");
      if (sourceGroupKey && !bySourceGroupKey.has(sourceGroupKey)) {
        bySourceGroupKey.set(sourceGroupKey, entry);
      }
    } catch {
      continue;
    }
  }
  return { bySourceGroupKey, byTrackId };
}

function generateTrackId() {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const ts = Date.now();
  const bytes = crypto.randomBytes(10);
  let t = ts;
  let out = "";
  for (let i = 0; i < 10; i += 1) {
    out = alphabet[t % 32] + out;
    t = Math.floor(t / 32);
  }
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i] % 32];
  }
  return out;
}

function sha256FileSync(filePath) {
  const fd = fs.openSync(filePath, "r");
  const hash = crypto.createHash("sha256");
  try {
    const buf = Buffer.allocUnsafe(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      hash.update(n === buf.length ? buf : buf.subarray(0, n));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

function targetNameForRole(role, originalName) {
  if (role === "mix") return "mix.mp3";
  if (role === "instrumental") return "instrumental.mp3";
  if (role === "vocals") return "vocals.mp3";
  if (role === "composer") return "composer.txt";
  if (role === "timing") return "timing.json5";
  if (role === "stems") return "stems.zip";
  return originalName;
}

function ensureUniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  let n = 2;
  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${n}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    n += 1;
  }
}

function parseWorkIdOverride(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return "";
    if (ext === ".json5") {
      const m = raw.match(/["']?workId["']?\s*:\s*["']([a-zA-Z0-9_-]+)["']/);
      return normalizeWorkId(m?.[1] ?? "");
    }
    return normalizeWorkId(raw.split(/\r?\n/)[0]);
  } catch {
    return "";
  }
}

function workIdFromNameTags(items) {
  const patterns = [
    /\[work[:=]([a-zA-Z0-9_-]+)\]/i,
    /(?:^|[\s._-])work[-_]([a-zA-Z0-9_-]{3,})(?:$|[\s._-])/i
  ];
  for (const item of items) {
    for (const rx of patterns) {
      const m = item.name.match(rx);
      const id = normalizeWorkId(m?.[1] ?? "");
      if (id) return id;
    }
  }
  return "";
}

function workIdFromInputName(group, audio, stemsInput) {
  const candidate =
    audio?.stem ||
    stemsInput?.stem ||
    group?.items?.[0]?.stem ||
    group?.baseTitle ||
    "";
  const title = candidate ? stripStemsSuffixTitle(baseTitleFromStem(String(candidate))) : "";
  const derived = normalizeWorkId(kebab(title || String(group?.baseTitle || "")));
  return derived || "";
}

function bpmFromInputName(group, audio, stemsInput) {
  const candidates = [
    audio?.name,
    audio?.stem,
    stemsInput?.name,
    stemsInput?.stem,
    ...(group?.items || []).flatMap((x) => [x?.name, x?.stem]),
    group?.baseTitle
  ];
  for (const c of candidates) {
    const bpm = extractBpmTag(c);
    if (bpm !== null) return bpm;
  }
  return null;
}

function titleFromComposerFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*\[\s*(title|song title)\s*:\s*(.+?)\s*\]\s*$/i);
      if (m) return stripStemsSuffixTitle(m[2] || "");
    }
  } catch {}
  return "";
}

function workIdFromComposer(group) {
  const composers = group?.items?.filter((x) => x.role === "composer") || [];
  for (const c of composers) {
    if (!c?.absPath || !fs.existsSync(c.absPath)) continue;
    const title = titleFromComposerFile(c.absPath);
    const id = normalizeWorkId(kebab(title));
    if (id) return id;
  }
  return "";
}

function chooseAudio(items) {
  const audios = items.filter((x) => x.ext === ".mp3");
  if (!audios.length) return null;
  for (const role of AUDIO_PRIORITY) {
    const found = audios
      .filter((x) => x.role === role)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (found) return found;
  }
  return audios.sort((a, b) => a.name.localeCompare(b.name))[0];
}

function safeNormalizeZipPath(fileName) {
  const normalized = path.posix.normalize(String(fileName || "").replace(/\\/g, "/"));
  if (!normalized || normalized.endsWith("/")) return "";
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) return "";
  if (/^[A-Za-z]:/.test(normalized)) return "";
  return normalized;
}

function listAudioZipEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const out = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr || new Error("Failed to open zip"));
      const fail = (err) => {
        try { zip.close(); } catch {}
        reject(err);
      };
      zip.readEntry();
      zip.on("entry", (entry) => {
        const safeRel = safeNormalizeZipPath(entry.fileName);
        if (safeRel && /\.(mp3|wav)$/i.test(safeRel)) out.push(safeRel);
        zip.readEntry();
      });
      zip.on("end", () => resolve(out));
      zip.on("error", fail);
    });
  });
}

function listAudioZipEntriesPython(zipPath) {
  const py = process.env.PYTHON || "python";
  const pyCode = `
import json, pathlib, sys, zipfile
zip_path = pathlib.Path(sys.argv[1])
out = []
with zipfile.ZipFile(zip_path, "r") as zf:
  for info in zf.infolist():
    name = info.filename.replace("\\\\", "/")
    if name.endswith("/"):
      continue
    p = pathlib.PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts:
      raise RuntimeError(f"Unsafe zip entry: {name}")
    if name.lower().endswith(".mp3") or name.lower().endswith(".wav"):
      out.append("/".join(p.parts))
print(json.dumps(out))
`;
  const r = spawnSync(py, ["-c", pyCode, zipPath], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "python zip list failed").trim());
  }
  return JSON.parse((r.stdout || "[]").trim() || "[]");
}

function pickExact(entries, exactName) {
  const target = exactName.toLowerCase();
  return entries.find((f) => path.posix.basename(f).toLowerCase() === target) || "";
}

function scoreStemCandidate(relPath, role) {
  const b = path.posix.basename(relPath).toLowerCase();
  const ext = path.posix.extname(b);
  let score = 0;
  if (role === "instrumental") {
    if (b.includes("instrumental")) score += 20;
    if (b.includes("inst")) score += 10;
    if (/^1\b|^1[ _-]/.test(b)) score += 7;
  } else {
    if (b.includes("vocals")) score += 20;
    if (b.includes("lead")) score += 12;
    if (/^0\b|^0[ _-]/.test(b)) score += 7;
  }
  if (ext === ".wav") score += 8;
  if (ext === ".mp3") score += 5;
  return score;
}

function pickByHeuristic(entries, role) {
  const ranked = entries
    .slice()
    .map((f) => ({ f, s: scoreStemCandidate(f, role) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.localeCompare(b.f));
  return ranked.length ? ranked[0].f : "";
}

function chooseStemFiles(entries) {
  const exactVocals = pickExact(entries, "0 Lead Vocals.wav") || pickExact(entries, "0 Lead Vocals.mp3");
  const exactInst = pickExact(entries, "1 Instrumental.wav") || pickExact(entries, "1 Instrumental.mp3");
  return {
    vocals: exactVocals || pickByHeuristic(entries, "vocals"),
    instrumental: exactInst || pickByHeuristic(entries, "instrumental")
  };
}

async function listZipEntriesPortable(zipPath) {
  try {
    return await listAudioZipEntries(zipPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("multi-disk zip")) {
      return listAudioZipEntriesPython(zipPath);
    }
    throw err;
  }
}

async function zipLooksLikeStems(zipPath) {
  if (!fs.existsSync(zipPath)) return false;
  const entries = await listZipEntriesPortable(zipPath);
  if (!entries.length) return false;
  const picks = chooseStemFiles(entries);
  if (picks.instrumental || picks.vocals) return true;
  const names = entries.map((e) => path.posix.basename(e).toLowerCase());
  const hasInst = names.some((n) => n.includes("instrumental") || n.includes("inst"));
  const hasVocals = names.some((n) => n.includes("vocals") || n.includes("lead"));
  return hasInst && hasVocals;
}

function runCmd(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return { ok: r.status === 0, stdout: String(r.stdout || ""), stderr: String(r.stderr || "") };
}

function toWslPath(absPath) {
  const p = path.resolve(absPath).replace(/\\/g, "/");
  const m = p.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}

function chooseFfmpegBackend() {
  if (runCmd("ffmpeg", ["-version"]).ok) return "local";
  if (process.platform === "win32" && runCmd("wsl", ["ffmpeg", "-version"]).ok) return "wsl";
  return "";
}

function transcodeAudioToMp3(srcPath, dstPath, overwrite) {
  if (fs.existsSync(dstPath) && !overwrite) return { ok: true, skipped: true };
  const backend = chooseFfmpegBackend();
  if (!backend) return { ok: false, skipped: true, reason: "ffmpeg-not-found" };
  const inPath = backend === "wsl" ? toWslPath(srcPath) : srcPath;
  const outPath = backend === "wsl" ? toWslPath(dstPath) : dstPath;
  const cmd = backend === "wsl" ? "wsl" : "ffmpeg";
  const args = backend === "wsl"
    ? ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", "-write_xing", "1", outPath]
    : ["-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "160k", "-write_xing", "1", outPath];
  const r = runCmd(cmd, args);
  if (!r.ok) return { ok: false, skipped: false, reason: (r.stderr || r.stdout || "ffmpeg failed").trim() };
  return { ok: true, skipped: false };
}

function mixStemPairToMp3(instPath, vocalsPath, dstPath, overwrite) {
  if (fs.existsSync(dstPath) && !overwrite) return { ok: true, skipped: true };
  const backend = chooseFfmpegBackend();
  if (!backend) return { ok: false, skipped: true, reason: "ffmpeg-not-found" };
  const instIn = backend === "wsl" ? toWslPath(instPath) : instPath;
  const vocIn = backend === "wsl" ? toWslPath(vocalsPath) : vocalsPath;
  const outPath = backend === "wsl" ? toWslPath(dstPath) : dstPath;
  const cmd = backend === "wsl" ? "wsl" : "ffmpeg";
  const args = backend === "wsl"
    ? [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        instIn,
        "-i",
        vocIn,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:normalize=0",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "160k",
        "-write_xing",
        "1",
        outPath
      ]
    : [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        instIn,
        "-i",
        vocIn,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:normalize=0",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "160k",
        "-write_xing",
        "1",
        outPath
      ];
  const r = runCmd(cmd, args);
  if (!r.ok) return { ok: false, skipped: false, reason: (r.stderr || r.stdout || "ffmpeg amix failed").trim() };
  return { ok: true, skipped: false };
}

function extractZipEntryToFile(zipPath, entryRelPath, outPath, overwrite) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr || new Error("Failed to open zip"));
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        try { zip.close(); } catch {}
        reject(err);
      };
      const finish = () => {
        if (done) return;
        done = true;
        try { zip.close(); } catch {}
        resolve(true);
      };
      if (fs.existsSync(outPath) && !overwrite) return finish();
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      zip.readEntry();
      zip.on("entry", (entry) => {
        const safeRel = safeNormalizeZipPath(entry.fileName);
        if (!safeRel) return fail(new Error(`Unsafe zip entry: ${entry.fileName}`));
        if (safeRel !== entryRelPath) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, rs) => {
          if (streamErr || !rs) return fail(streamErr || new Error("Failed opening zip stream"));
          const ws = fs.createWriteStream(outPath, { flags: "w" });
          rs.on("error", fail);
          ws.on("error", fail);
          ws.on("finish", finish);
          rs.pipe(ws);
        });
      });
      zip.on("end", () => fail(new Error(`Zip entry not found: ${entryRelPath}`)));
      zip.on("error", fail);
    });
  });
}

function extractZipEntryToFilePython(zipPath, entryRelPath, outPath, overwrite) {
  const py = process.env.PYTHON || "python";
  const pyCode = `
import pathlib, sys, zipfile
zip_path = pathlib.Path(sys.argv[1])
entry = sys.argv[2]
out_path = pathlib.Path(sys.argv[3])
overwrite = sys.argv[4] == "1"
if out_path.exists() and not overwrite:
  raise SystemExit(0)
out_path.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zip_path, "r") as zf:
  target = None
  for info in zf.infolist():
    name = info.filename.replace("\\\\", "/")
    p = pathlib.PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts:
      raise RuntimeError(f"Unsafe zip entry: {name}")
    safe_name = "/".join(p.parts)
    if safe_name == entry:
      target = info
      break
  if target is None:
    raise RuntimeError(f"Zip entry not found: {entry}")
  with zf.open(target, "r") as src, open(out_path, "wb") as dst:
    dst.write(src.read())
`;
  const r = spawnSync(py, ["-c", pyCode, zipPath, entryRelPath, outPath, overwrite ? "1" : "0"], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "python zip extract failed").trim());
  }
}

async function extractStemAudioFromZip(assetDir, overwrite, dryRun) {
  const zipPath = path.join(assetDir, "stems.zip");
  if (!fs.existsSync(zipPath)) return { ok: false, reason: "no-stems-zip", extracted: {} };

  const entries = await listZipEntriesPortable(zipPath);
  if (!entries.length) return { ok: false, reason: "no-mp3-in-stems-zip", extracted: {} };

  const picks = chooseStemFiles(entries);
  const out = {
    instrumental: "",
    vocals: "",
    instrumentalExt: "",
    vocalsExt: ""
  };
  const steps = [
    { rel: picks.instrumental, base: "instrumental", key: "instrumental" },
    { rel: picks.vocals, base: "vocals", key: "vocals" }
  ];

  for (const step of steps) {
    if (!step.rel) continue;
    const ext = path.posix.extname(step.rel).toLowerCase();
    const fileExt = ext === ".wav" ? ".wav" : ".mp3";
    const dst = path.join(assetDir, `${step.base}${fileExt}`);
    if (dryRun) {
      out[step.key] = step.rel;
      out[`${step.key}Ext`] = fileExt;
      continue;
    }
    try {
      await extractZipEntryToFile(zipPath, step.rel, dst, overwrite);
      out[step.key] = step.rel;
      out[`${step.key}Ext`] = fileExt;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("multi-disk zip")) {
        extractZipEntryToFilePython(zipPath, step.rel, dst, overwrite);
        out[step.key] = step.rel;
        out[`${step.key}Ext`] = fileExt;
      } else {
        throw err;
      }
    }
  }
  if (!dryRun) {
    const wavToMp3Pairs = [
      ["instrumental.wav", "instrumental.mp3"],
      ["vocals.wav", "vocals.mp3"]
    ];
    for (const [srcName, dstName] of wavToMp3Pairs) {
      const src = path.join(assetDir, srcName);
      const dst = path.join(assetDir, dstName);
      if (!fs.existsSync(src)) continue;
      transcodeAudioToMp3(src, dst, overwrite);
    }
  }
  return { ok: true, reason: "stems-extracted", extracted: out };
}

function buildGroups(inboxDir) {
  const top = fs.readdirSync(inboxDir, { withFileTypes: true });
  const groups = [];
  const loose = [];

  for (const entry of top) {
    if (entry.name === "_done") continue;
    const absPath = path.join(inboxDir, entry.name);
    if (entry.isDirectory()) {
      const files = readDirRecursive(absPath)
        .map((p) => {
          const ext = path.extname(p).toLowerCase();
          const name = path.basename(p);
          const stem = path.parse(name).name;
          return {
            absPath: p,
            relPath: path.relative(inboxDir, p),
            name,
            ext,
            stem,
            role: detectRole(stem, ext)
          };
        })
        .filter((f) => SUPPORTED_EXTS.has(f.ext));
      if (!files.length) continue;
      const audio = chooseAudio(files);
      const baseTitle = audio ? basenamePrefix(audio.stem) : titleCaseFromRaw(entry.name);
      groups.push({
        key: `folder:${kebab(entry.name) || "group"}`,
        kind: "folder",
        sourceDir: absPath,
        label: entry.name,
        baseTitle: baseTitle || titleCaseFromRaw(entry.name) || "Untitled",
        items: files
      });
      continue;
    }
    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) continue;
      const stem = path.parse(entry.name).name;
      loose.push({
        absPath,
        relPath: entry.name,
        name: entry.name,
        ext,
        stem,
        role: detectRole(stem, ext)
      });
    }
  }

  const looseGroups = new Map();
  for (const item of loose) {
    const keyTitle = basenamePrefix(item.stem) || titleCaseFromRaw(item.stem) || "Loose";
    const key = kebab(keyTitle) || "loose";
    if (!looseGroups.has(key)) {
      looseGroups.set(key, {
        key: `loose:${key}`,
        kind: "loose",
        sourceDir: "",
        label: key,
        baseTitle: keyTitle,
        items: []
      });
    }
    looseGroups.get(key).items.push(item);
  }
  const looseOut = Array.from(looseGroups.values()).sort((a, b) => a.key.localeCompare(b.key));
  groups.push(...looseOut);
  groups.sort((a, b) => a.key.localeCompare(b.key));
  return groups;
}

function moveOrCopy({
  src,
  dst,
  overwrite,
  dryRun,
  forceCopy = false
}) {
  if (src === dst) return { ok: true, skipped: true, action: "noop" };
  if (!dryRun) fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst)) {
    if (!overwrite) return { ok: false, skipped: true, reason: "exists" };
    if (!dryRun) fs.unlinkSync(dst);
  }
  if (!dryRun) {
    if (forceCopy) fs.copyFileSync(src, dst);
    else fs.renameSync(src, dst);
  }
  return { ok: true, skipped: false, action: forceCopy ? "copy" : "move" };
}

function ensureComposerStub(assetDir, dryRun) {
  const composerPath = path.join(assetDir, "composer.txt");
  if (!fs.existsSync(composerPath) && !dryRun) fs.writeFileSync(composerPath, "", "utf8");
  return composerPath;
}

function pickBestSource(assetDir, names) {
  for (const n of names) {
    const p = path.join(assetDir, n);
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function toRepoRel(repoRoot, absPath) {
  return toPosix(path.relative(repoRoot, absPath));
}

function archiveGroup({
  group,
  inboxDoneDayDir,
  overwrite,
  dryRun,
  report
}) {
  if (!dryRun) fs.mkdirSync(inboxDoneDayDir, { recursive: true });
  if (group.kind === "folder") {
    const base = path.basename(group.sourceDir || group.label || "group");
    let dst = path.join(inboxDoneDayDir, base);
    if (!dryRun && fs.existsSync(dst)) dst = ensureUniquePath(dst);
    if (group.sourceDir && fs.existsSync(group.sourceDir)) {
      if (!dryRun) fs.renameSync(group.sourceDir, dst);
      report.archivePath = toPosix(dst);
      return;
    }
    if (!dryRun) {
      const marker = path.join(dst, "consumed.json");
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, `${JSON.stringify({ consumed: group.items.map((x) => x.relPath) }, null, 2)}\n`, "utf8");
    }
    report.archivePath = toPosix(path.join(dst, "consumed.json"));
    return;
  }

  let looseDir = path.join(inboxDoneDayDir, "loose", kebab(group.label) || "loose");
  if (!dryRun && fs.existsSync(looseDir)) looseDir = ensureUniquePath(looseDir);
  if (!dryRun) fs.mkdirSync(looseDir, { recursive: true });

  const movedFiles = [];
  for (const item of group.items) {
    if (!fs.existsSync(item.absPath)) continue;
    const dst = path.join(looseDir, path.basename(item.absPath));
    const res = moveOrCopy({ src: item.absPath, dst, overwrite, dryRun, forceCopy: false });
    if (res.ok && !res.skipped) movedFiles.push(path.basename(item.absPath));
  }
  if (!dryRun) {
    fs.writeFileSync(
      path.join(looseDir, "consumed.json"),
      `${JSON.stringify({ movedFiles, consumed: group.items.map((x) => x.relPath) }, null, 2)}\n`,
      "utf8"
    );
  }
  report.archivePath = toPosix(path.join(looseDir, "consumed.json"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(".");
  const inboxDir = path.resolve(args.inboxDir || path.join(repoRoot, "inbox"));
  const assetsRoot = path.resolve(args.assetsRoot || path.join(repoRoot, "assets"));
  const tracksDir = path.resolve(args.tracksDir || path.join(repoRoot, "tracks"));
  const doneDate = new Date().toISOString().slice(0, 10);
  const inboxDoneDayDir = path.join(inboxDir, "_done", doneDate);

  if (!args.dryRun) {
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.mkdirSync(assetsRoot, { recursive: true });
    fs.mkdirSync(tracksDir, { recursive: true });
  }

  const groups = fs.existsSync(inboxDir) ? buildGroups(inboxDir) : [];
  const catalog = loadTrackCatalog(tracksDir);
  const nowIso = new Date().toISOString();
  const report = {
    startedAt: nowIso,
    dryRun: args.dryRun,
    overwrite: args.overwrite,
    inboxDir: toPosix(inboxDir),
    assetsRoot: toPosix(assetsRoot),
    tracksDir: toPosix(tracksDir),
    imported: 0,
    skipped: 0,
    groups: []
  };

  for (const group of groups) {
    const groupReport = {
      key: group.key,
      kind: group.kind,
      baseTitle: group.baseTitle,
      files: group.items.map((x) => x.relPath),
      status: "skipped",
      reason: "",
      trackId: "",
      workId: "",
      assetDir: "",
      trackPath: "",
      archivePath: "",
      warnings: []
    };

    const audio = chooseAudio(group.items);
    let stemsInput = group.items.find((x) => x.role === "stems") || null;
    if (!audio && !stemsInput) {
      const zipCandidates = group.items.filter((x) => x.ext === ".zip");
      for (const z of zipCandidates) {
        try {
          if (await zipLooksLikeStems(z.absPath)) {
            stemsInput = z;
            break;
          }
        } catch (err) {
          groupReport.warnings.push(`zip inspection failed (${z.name}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (!audio && !stemsInput) {
      groupReport.reason = "no-audio";
      report.skipped += 1;
      report.groups.push(groupReport);
      continue;
    }

    const overrideFile = group.items.find((x) => x.role === "workIdOverride");
    const overrideWorkId = overrideFile && fs.existsSync(overrideFile.absPath) ? parseWorkIdOverride(overrideFile.absPath) : "";
    const taggedWorkId = workIdFromNameTags(group.items);
    const composerWorkId = workIdFromComposer(group);
    const nameBasedWorkId = workIdFromInputName(group, audio, stemsInput);
    const filenameBpm = bpmFromInputName(group, audio, stemsInput);
    const legacyKey = group.key.replace(/^(?:folder|loose):/, "");
    const existingEntry = catalog.bySourceGroupKey.get(group.key) || catalog.bySourceGroupKey.get(legacyKey);
    const workId = existingEntry?.workId || overrideWorkId || taggedWorkId || composerWorkId || nameBasedWorkId || fallbackWorkId(new Date());
    const trackId = existingEntry?.trackId || generateTrackId();
    const assetDir = path.join(assetsRoot, workId, trackId);
    const trackJsonPath = existingEntry?.filePath || path.join(tracksDir, `${trackId}.track.json`);
    const inputHashes = {};

    groupReport.trackId = trackId;
    groupReport.workId = workId;
    groupReport.assetDir = toRepoRel(repoRoot, assetDir);

    if (!args.dryRun) fs.mkdirSync(assetDir, { recursive: true });

    const movable = group.items.filter((x) => x.role !== "workIdOverride");
    let stemsUpdated = false;
    for (const item of movable) {
      if (!fs.existsSync(item.absPath)) continue;
      const hashKey = toPosix(item.relPath);
      inputHashes[hashKey] = sha256FileSync(item.absPath);
      let role = item.role;
      if (item.ext === ".zip" && role !== "stems") {
        try {
          if (await zipLooksLikeStems(item.absPath)) role = "stems";
        } catch (err) {
          groupReport.warnings.push(`zip inspection failed (${item.name}): ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const destName = targetNameForRole(role, item.name);
      const dst = path.join(assetDir, destName);
      const itemOverwrite = args.overwrite || (Boolean(existingEntry) && role === "stems");
      const res = moveOrCopy({
        src: item.absPath,
        dst,
        overwrite: itemOverwrite,
        dryRun: args.dryRun
      });
      if (!res.ok) groupReport.warnings.push(`Skipped existing file: ${toPosix(dst)}`);
      if (role === "stems" && res.ok && !res.skipped) stemsUpdated = true;
    }

    const composerPath = ensureComposerStub(assetDir, args.dryRun);
    const stemsZipPath = path.join(assetDir, "stems.zip");
    if (fs.existsSync(stemsZipPath)) {
      try {
        const stemExtraction = await extractStemAudioFromZip(
          assetDir,
          args.overwrite || Boolean(existingEntry) || stemsUpdated,
          args.dryRun
        );
        if (stemExtraction.ok) {
          if (stemExtraction.extracted?.instrumental) {
            groupReport.warnings.push(`instrumental.mp3 sourced from stems.zip entry: ${stemExtraction.extracted.instrumental}`);
          }
          if (stemExtraction.extracted?.vocals) {
            groupReport.warnings.push(`vocals.mp3 sourced from stems.zip entry: ${stemExtraction.extracted.vocals}`);
          }
        } else if (stemExtraction.reason !== "no-stems-zip") {
          groupReport.warnings.push(`Could not extract canonical stems: ${stemExtraction.reason}`);
        }
      } catch (err) {
        groupReport.warnings.push(`stems.zip extraction error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let mixPath = path.join(assetDir, "mix.mp3");
    if (!fs.existsSync(mixPath)) {
      const candidates = ["instrumental.mp3", "instrumental.wav", "vocals.mp3", "vocals.wav"];
      for (const name of candidates) {
        const p = path.join(assetDir, name);
        if (fs.existsSync(p)) {
          const copy = name.endsWith(".wav")
            ? (args.dryRun ? { ok: true } : transcodeAudioToMp3(p, mixPath, args.overwrite))
            : moveOrCopy({
              src: p,
              dst: mixPath,
              overwrite: args.overwrite,
              dryRun: args.dryRun,
              forceCopy: true
            });
          if (!copy.ok) {
            groupReport.warnings.push(`Could not create mix.mp3 from ${name}`);
          }
          break;
        }
      }
    }
    if (!fs.existsSync(mixPath)) {
      const anyAudio = fs.existsSync(assetDir)
        ? fs.readdirSync(assetDir).find((name) => /\.(mp3|wav)$/i.test(name))
        : "";
      if (anyAudio) {
        const src = path.join(assetDir, anyAudio);
        const copy = anyAudio.toLowerCase().endsWith(".wav")
          ? (args.dryRun ? { ok: true } : transcodeAudioToMp3(src, mixPath, args.overwrite))
          : moveOrCopy({
            src,
            dst: mixPath,
            overwrite: args.overwrite,
            dryRun: args.dryRun,
            forceCopy: true
          });
        if (!copy.ok) groupReport.warnings.push(`Could not create mix.mp3 from ${anyAudio}`);
      }
    }
    const instForMix = pickBestSource(assetDir, ["instrumental.wav", "instrumental.mp3"]);
    const vocalsForMix = pickBestSource(assetDir, ["vocals.wav", "vocals.mp3"]);
    const mixExists = fs.existsSync(mixPath);
    const mixIsInstrumentalOnly = (!args.dryRun && mixExists && instForMix)
      ? sha256FileSync(mixPath) === sha256FileSync(instForMix)
      : false;
    const shouldRebuildMixFromStems = Boolean(instForMix && vocalsForMix) && (
      args.overwrite ||
      stemsUpdated ||
      !mixExists ||
      mixIsInstrumentalOnly
    );
    if (shouldRebuildMixFromStems) {
      const remixed = args.dryRun
        ? { ok: true }
        : mixStemPairToMp3(instForMix, vocalsForMix, mixPath, true);
      if (!remixed.ok) {
        groupReport.warnings.push(`Could not create mix.mp3 from instrumental+vocals: ${remixed.reason || "amix-failed"}`);
        if (!mixExists && instForMix) {
          const fallback = instForMix.endsWith(".wav")
            ? transcodeAudioToMp3(instForMix, mixPath, true)
            : moveOrCopy({
              src: instForMix,
              dst: mixPath,
              overwrite: true,
              dryRun: args.dryRun,
              forceCopy: true
            });
          if (!fallback.ok) groupReport.warnings.push("Could not create fallback mix.mp3 from instrumental");
        }
      }
    }
    if (!args.dryRun && !fs.existsSync(mixPath)) {
      groupReport.reason = "mix-missing-after-import";
      groupReport.status = "skipped";
      report.skipped += 1;
      report.groups.push(groupReport);
      continue;
    }

    if (!args.dryRun) {
      const buildResult = buildTrack({
        mp3Path: mixPath,
        composerPath,
        titleArg: group.baseTitle || "Untitled",
        trackJsonPath,
        workIdOverride: workId,
        trackIdOverride: trackId,
        sourceGroupKey: group.key,
        assetDir: toRepoRel(repoRoot, assetDir)
      });
      groupReport.trackPath = toPosix(buildResult.outputPath);

      let track = {};
      try {
        track = JSON.parse(fs.readFileSync(buildResult.outputPath, "utf8"));
      } catch {
        track = {};
      }
      const prevImport = track?.import ?? {};
      const hashSourcePath = pickBestSource(assetDir, ["instrumental.wav", "instrumental.mp3", "mix.wav", "mix.mp3"]) || mixPath;

      track.trackId = trackId;
      track.workId = workId;
      track.assetDir = toRepoRel(repoRoot, assetDir);
      track.assetPaths = {
        mix: toRepoRel(repoRoot, mixPath),
        stemsZip: fs.existsSync(stemsZipPath) ? toRepoRel(repoRoot, stemsZipPath) : "",
        effective: fs.existsSync(path.join(assetDir, "effective.json"))
          ? toRepoRel(repoRoot, path.join(assetDir, "effective.json"))
          : "",
        mixWav: fs.existsSync(path.join(assetDir, "mix.wav"))
          ? toRepoRel(repoRoot, path.join(assetDir, "mix.wav"))
          : "",
        instrumental: fs.existsSync(path.join(assetDir, "instrumental.mp3"))
          ? toRepoRel(repoRoot, path.join(assetDir, "instrumental.mp3"))
          : "",
        instrumentalWav: fs.existsSync(path.join(assetDir, "instrumental.wav"))
          ? toRepoRel(repoRoot, path.join(assetDir, "instrumental.wav"))
          : "",
        vocals: fs.existsSync(path.join(assetDir, "vocals.mp3"))
          ? toRepoRel(repoRoot, path.join(assetDir, "vocals.mp3"))
          : "",
        vocalsWav: fs.existsSync(path.join(assetDir, "vocals.wav"))
          ? toRepoRel(repoRoot, path.join(assetDir, "vocals.wav"))
          : "",
        composer: toRepoRel(repoRoot, composerPath)
      };
      track.import = {
        firstImportedAt: prevImport.firstImportedAt || nowIso,
        lastImportedAt: nowIso,
        inputHashes,
        hashSource: toRepoRel(repoRoot, hashSourcePath),
        hashSourceSha256: sha256FileSync(hashSourcePath),
        filenameBpm: filenameBpm ?? prevImport.filenameBpm ?? null,
        sourceGroupKey: group.key,
        archivedTo: ""
      };
      fs.writeFileSync(buildResult.outputPath, `${JSON.stringify(track, null, 2)}\n`, "utf8");
    } else {
      groupReport.trackPath = toPosix(trackJsonPath);
    }

    archiveGroup({
      group,
      inboxDoneDayDir,
      overwrite: args.overwrite,
      dryRun: args.dryRun,
      report: groupReport
    });

    if (!args.dryRun && groupReport.trackPath && fs.existsSync(groupReport.trackPath)) {
      try {
        const track = JSON.parse(fs.readFileSync(groupReport.trackPath, "utf8"));
        if (track?.import && typeof track.import === "object") {
          track.import.archivedTo = toPosix(groupReport.archivePath);
          fs.writeFileSync(groupReport.trackPath, `${JSON.stringify(track, null, 2)}\n`, "utf8");
        }
      } catch {
        groupReport.warnings.push("Could not write import.archivedTo");
      }
    }

    groupReport.status = "imported";
    report.imported += 1;
    report.groups.push(groupReport);
  }

  report.finishedAt = new Date().toISOString();
  report.summary = `Imported ${report.imported} group(s). Skipped ${report.skipped} group(s).`;

  if (args.jsonPath) {
    const outPath = path.resolve(args.jsonPath);
    if (!args.dryRun) fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (!args.dryRun) fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(report.summary);
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
