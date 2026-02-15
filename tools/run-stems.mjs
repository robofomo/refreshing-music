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
  if (b.endsWith(".mp3")) score += 5;
  return score;
}

function pickByHeuristic(extractedFiles, role) {
  const mp3s = extractedFiles.filter((f) => path.posix.basename(f).toLowerCase().endsWith(".mp3"));
  const ranked = mp3s
    .map((f) => ({ f, s: scoreCandidate(f, role) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.f.localeCompare(b.f));
  return ranked.length ? ranked[0].f : "";
}

function chooseStemFiles(extractedFiles) {
  const exactVocals = pickExact(extractedFiles, "0 Lead Vocals.mp3");
  const exactInst = pickExact(extractedFiles, "1 Instrumental.mp3");
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
  const voc = maybeCopyCanonical(t.assetDir, picks.vocals, "vocals.mp3", overwrite);
  const ins = maybeCopyCanonical(t.assetDir, picks.instrumental, "instrumental.mp3", overwrite);

  const manifest = {
    extractedAt: new Date().toISOString(),
    zipPath: "stems.zip",
    extractedFiles,
    pickedVocals: picks.vocals || null,
    pickedInstrumental: picks.instrumental || null,
    overwrite: Boolean(overwrite),
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
