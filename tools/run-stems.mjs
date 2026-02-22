import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yauzl from "yauzl";
import {
  listAssetTracks,
  parseArgs,
  updateTrackLog,
  writeJson
} from "./preprocess-ai-lib.mjs";

function safeNormalizeZipPath(fileName) {
  const normalized = path.posix.normalize(String(fileName || "").replace(/\\/g, "/"));
  if (!normalized || normalized.endsWith("/")) return "";
  if (normalized.startsWith("/") || normalized.startsWith("../") || normalized.includes("/../")) return "";
  if (/^[A-Za-z]:/.test(normalized)) return "";
  return normalized;
}

function extractZipSafe(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    const extracted = [];
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr || new Error("Failed to open zip"));
      const outDirAbs = path.resolve(outDir);

      const fail = (err) => {
        try { zip.close(); } catch {}
        reject(err);
      };

      zip.readEntry();
      zip.on("entry", (entry) => {
        if (entry.fileName.endsWith("/")) {
          zip.readEntry();
          return;
        }
        const safeRel = safeNormalizeZipPath(entry.fileName);
        if (!safeRel) return fail(new Error(`Unsafe zip entry: ${entry.fileName}`));
        const outPath = path.resolve(path.join(outDirAbs, ...safeRel.split("/")));
        if (!outPath.startsWith(outDirAbs)) return fail(new Error(`Zip-slip blocked: ${entry.fileName}`));
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        zip.openReadStream(entry, (streamErr, rs) => {
          if (streamErr || !rs) return fail(streamErr || new Error("Failed opening zip stream"));
          const ws = fs.createWriteStream(outPath, { flags: "w" });
          rs.on("error", fail);
          ws.on("error", fail);
          ws.on("finish", () => {
            extracted.push(safeRel);
            zip.readEntry();
          });
          rs.pipe(ws);
        });
      });
      zip.on("end", () => resolve(extracted));
      zip.on("error", fail);
    });
  });
}

function extractZipSafePython(zipPath, outDir) {
  const py = process.env.PYTHON || "python";
  const pyCode = `
import json, os, pathlib, sys, zipfile
zip_path = pathlib.Path(sys.argv[1])
out_dir = pathlib.Path(sys.argv[2]).resolve()
out_dir.mkdir(parents=True, exist_ok=True)
extracted = []
with zipfile.ZipFile(zip_path, "r") as zf:
  for info in zf.infolist():
    name = info.filename.replace("\\\\", "/")
    if name.endswith("/"):
      continue
    p = pathlib.PurePosixPath(name)
    if p.is_absolute() or ".." in p.parts:
      raise RuntimeError(f"Unsafe zip entry: {name}")
    target = (out_dir / pathlib.Path(*p.parts)).resolve()
    if not str(target).startswith(str(out_dir)):
      raise RuntimeError(f"Zip-slip blocked: {name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(info, "r") as src, open(target, "wb") as dst:
      dst.write(src.read())
    extracted.append("/".join(p.parts))
print(json.dumps(extracted))
`;
  const r = spawnSync(py, ["-c", pyCode, zipPath, outDir], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "python zip extraction failed").trim());
  }
  return JSON.parse((r.stdout || "[]").trim() || "[]");
}

function pickExact(extractedFiles, exactName) {
  const target = exactName.toLowerCase();
  const hit = extractedFiles.find((f) => path.posix.basename(f).toLowerCase() === target);
  return hit ?? "";
}

function scoreCandidate(rel, role) {
  const b = path.posix.basename(rel).toLowerCase();
  const ext = path.posix.extname(b);
  let score = 0;
  if (role === "vocals") {
    if (b.includes("vocals")) score += 20;
    if (b.includes("lead")) score += 12;
    if (/^0\b|^0[ _-]/.test(b)) score += 7;
  } else {
    if (b.includes("instrumental")) score += 20;
    if (b.includes("inst")) score += 10;
    if (/^1\b|^1[ _-]/.test(b)) score += 7;
  }
  if (ext === ".wav") score += 8;
  if (ext === ".mp3") score += 5;
  return score;
}

function pickByHeuristic(extractedFiles, role) {
  const audioFiles = extractedFiles.filter((f) => /\.(mp3|wav)$/i.test(path.posix.basename(f)));
  const ranked = audioFiles
    .map((f) => ({ f, s: scoreCandidate(f, role) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.localeCompare(b.f));
  return ranked.length ? ranked[0].f : "";
}

function chooseStemFiles(extractedFiles) {
  const exactVocals = pickExact(extractedFiles, "0 Lead Vocals.wav") || pickExact(extractedFiles, "0 Lead Vocals.mp3");
  const exactInst = pickExact(extractedFiles, "1 Instrumental.wav") || pickExact(extractedFiles, "1 Instrumental.mp3");
  const vocals = exactVocals || pickByHeuristic(extractedFiles, "vocals");
  const instrumental = exactInst || pickByHeuristic(extractedFiles, "instrumental");
  return { vocals, instrumental };
}

function maybeCopyCanonical(assetDir, relFromStems, targetName, overwrite) {
  if (!relFromStems) return { copied: false, reason: "not-found" };
  const src = path.join(assetDir, "stems", ...relFromStems.split("/"));
  if (!fs.existsSync(src)) return { copied: false, reason: "missing-source" };
  const dst = path.join(assetDir, targetName);
  if (fs.existsSync(dst) && !overwrite) return { copied: false, reason: "exists" };
  fs.copyFileSync(src, dst);
  return { copied: true, reason: "ok" };
}

function runCmd(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout || ""),
    stderr: String(r.stderr || "")
  };
}

function toWslPath(absPath) {
  const p = path.resolve(absPath).replace(/\\/g, "/");
  const m = p.match(/^([A-Za-z]):\/(.*)$/);
  if (!m) return p;
  return `/mnt/${m[1].toLowerCase()}/${m[2]}`;
}

function hasFfmpegLocal() {
  return runCmd("ffmpeg", ["-version"]).ok;
}

function hasFfmpegWsl() {
  return runCmd("wsl", ["ffmpeg", "-version"]).ok;
}

function normalizeMp3(filePath, outPath, useWsl) {
  if (useWsl) {
    const inWsl = toWslPath(filePath);
    const outWsl = toWslPath(outPath);
    return runCmd("wsl", [
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inWsl,
      "-vn",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-write_xing",
      "1",
      outWsl
    ]);
  }

  return runCmd("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-vn",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-write_xing",
    "1",
    outPath
  ]);
}

function normalizeCanonicalStems(assetDir) {
  const targets = ["instrumental.mp3", "vocals.mp3"]
    .map((name) => path.join(assetDir, name))
    .filter((p) => fs.existsSync(p));
  if (!targets.length) return { status: "skipped", reason: "missing-canonical-stems" };

  const useLocal = hasFfmpegLocal();
  const useWsl = !useLocal && process.platform === "win32" && hasFfmpegWsl();
  if (!useLocal && !useWsl) {
    return { status: "skipped", reason: "ffmpeg-not-found" };
  }

  const out = [];
  for (const src of targets) {
    const tmp = path.join(assetDir, `${path.basename(src, ".mp3")}.normalized.mp3`);
    const r = normalizeMp3(src, tmp, useWsl);
    if (!r.ok) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      return {
        status: "error",
        reason: "ffmpeg-failed",
        file: path.basename(src),
        stderr: (r.stderr || r.stdout || "").trim().slice(0, 1200)
      };
    }
    fs.renameSync(tmp, src);
    out.push(path.basename(src));
  }

  return {
    status: "ok",
    backend: useWsl ? "wsl-ffmpeg" : "ffmpeg",
    files: out
  };
}

function ensureCanonicalPlaybackMp3(assetDir, overwrite) {
  const useLocal = hasFfmpegLocal();
  const useWsl = !useLocal && process.platform === "win32" && hasFfmpegWsl();
  if (!useLocal && !useWsl) return { status: "skipped", reason: "ffmpeg-not-found" };

  const out = [];
  const pairs = [
    { wav: "instrumental.wav", mp3: "instrumental.mp3" },
    { wav: "vocals.wav", mp3: "vocals.mp3" }
  ];
  for (const pair of pairs) {
    const wavPath = path.join(assetDir, pair.wav);
    const mp3Path = path.join(assetDir, pair.mp3);
    if (!fs.existsSync(wavPath)) continue;
    if (fs.existsSync(mp3Path) && !overwrite) continue;
    const tmp = path.join(assetDir, `${path.basename(mp3Path, ".mp3")}.normalized.mp3`);
    const r = normalizeMp3(wavPath, tmp, useWsl);
    if (!r.ok) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      return { status: "error", reason: "ffmpeg-failed", file: pair.wav };
    }
    fs.renameSync(tmp, mp3Path);
    out.push(pair.mp3);
  }
  return { status: "ok", files: out };
}

async function processTrack(t, overwrite) {
  const zipPath = path.join(t.assetDir, "stems.zip");
  if (!fs.existsSync(zipPath)) {
    updateTrackLog(t.assetDir, {
      stems: { status: "skipped", reason: "No stems.zip found" }
    });
    return { status: "skipped" };
  }

  const stemsDir = path.join(t.assetDir, "stems");
  fs.mkdirSync(stemsDir, { recursive: true });

  let extractedFiles;
  try {
    extractedFiles = await extractZipSafe(zipPath, stemsDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("multi-disk zip")) {
      extractedFiles = extractZipSafePython(zipPath, stemsDir);
    } else {
      throw err;
    }
  }
  const picks = chooseStemFiles(extractedFiles);
  const vocExt = path.posix.extname(String(picks.vocals || "")).toLowerCase() === ".wav" ? ".wav" : ".mp3";
  const insExt = path.posix.extname(String(picks.instrumental || "")).toLowerCase() === ".wav" ? ".wav" : ".mp3";
  const voc = maybeCopyCanonical(t.assetDir, picks.vocals, `vocals${vocExt}`, overwrite);
  const ins = maybeCopyCanonical(t.assetDir, picks.instrumental, `instrumental${insExt}`, overwrite);
  const playback = ensureCanonicalPlaybackMp3(t.assetDir, overwrite);
  if (playback.status === "error") {
    throw new Error(`Stem MP3 generation failed (${playback.file || "unknown"})`);
  }
  const normalized = normalizeCanonicalStems(t.assetDir);
  if (normalized.status === "error") {
    throw new Error(
      `Stem normalization failed (${normalized.file || "unknown"}): ${normalized.reason || "ffmpeg-failed"}`
    );
  }

  const manifest = {
    extractedAt: new Date().toISOString(),
    zipPath: "stems.zip",
    extractedFiles,
    pickedVocals: picks.vocals || null,
    pickedInstrumental: picks.instrumental || null,
    playbackMp3: playback,
    overwrite: Boolean(overwrite),
    normalized,
    copied: {
      vocals: voc,
      instrumental: ins
    }
  };
  writeJson(path.join(t.assetDir, "stems.json"), manifest);
  updateTrackLog(t.assetDir, {
    stems: {
      status: "ok",
      zipPath: "stems.zip",
      pickedVocals: picks.vocals || null,
      pickedInstrumental: picks.instrumental || null,
      normalized,
      overwrite: Boolean(overwrite)
    }
  });
  return { status: "ok" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const onlyTrackId = typeof args.trackId === "string" ? args.trackId : "";
  const overwrite = Boolean(args["overwrite-stems"]);
  const tracks = listAssetTracks(path.resolve("assets"));
  const selected = onlyTrackId ? tracks.filter((t) => t.trackId === onlyTrackId) : tracks;

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const t of selected) {
    try {
      const r = await processTrack(t, overwrite);
      if (r.status === "ok") ok += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      updateTrackLog(t.assetDir, {
        stems: {
          status: "error",
          error: err instanceof Error ? err.message : String(err),
          overwrite: Boolean(overwrite)
        }
      });
    }
  }
  console.log(`stems: ok=${ok} failed=${failed} skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
