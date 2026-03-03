import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {
    root: "assets",
    kbps: 160,
    dryRun: false,
    overwriteCbr: false,
    maxFrames: 2500,
    verbose: false
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--overwrite-cbr") out.overwriteCbr = true;
    else if (a === "--verbose") out.verbose = true;
    else if (a === "--root") out.root = String(argv[++i] || out.root);
    else if (a === "--kbps") out.kbps = Math.max(64, Math.min(320, Number(argv[++i] || out.kbps)));
    else if (a === "--max-frames") out.maxFrames = Math.max(100, Math.min(20000, Number(argv[++i] || out.maxFrames)));
  }
  return out;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: r.stdout || "",
    stderr: r.stderr || ""
  };
}

function detectBackend() {
  if (run("ffmpeg", ["-version"]).ok) return "local";
  if (process.platform === "win32" && run("wsl", ["ffmpeg", "-version"]).ok) return "wsl";
  return "";
}

function toWslPath(winPath) {
  const full = path.resolve(winPath);
  const m = full.match(/^([A-Za-z]):\\(.*)$/);
  if (!m) return full.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

const BITRATES = {
  3: { 1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0], 2: [0,32,48,56,64,80,96,112,128,160,192,224,256,320,384,0], 25: [0,32,48,56,64,80,96,112,128,144,160,176,192,224,256,0] },
  2: { 1: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0], 2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0], 25: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0] },
  1: { 1: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0], 2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0], 25: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0] }
};
const SAMPLERATES = { 1: [44100,48000,32000,0], 2: [22050,24000,16000,0], 25: [11025,12000,8000,0] };

function parseFrames(filePath, maxFrames) {
  const data = fs.readFileSync(filePath);
  let i = 0;
  const rates = [];
  let frames = 0;

  if (data.length >= 10 && data.slice(0, 3).toString("latin1") === "ID3") {
    const sz = ((data[6] & 0x7f) << 21) | ((data[7] & 0x7f) << 14) | ((data[8] & 0x7f) << 7) | (data[9] & 0x7f);
    i = 10 + sz;
  }

  while (i + 4 <= data.length && frames < maxFrames) {
    const b1 = data[i], b2 = data[i + 1], b3 = data[i + 2], b4 = data[i + 3];
    const hdr = (((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >>> 0);
    if (((hdr & 0xffe00000) >>> 0) !== 0xffe00000) { i += 1; continue; }

    const verBits = (hdr >> 19) & 0x3;
    const layerBits = (hdr >> 17) & 0x3;
    const brIdx = (hdr >> 12) & 0xf;
    const srIdx = (hdr >> 10) & 0x3;
    const pad = (hdr >> 9) & 0x1;

    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i += 1; continue; }

    const ver = ({ 0: 25, 2: 2, 3: 1 })[verBits];
    const layer = ({ 1: 3, 2: 2, 3: 1 })[layerBits];
    if (!ver || !layer) { i += 1; continue; }

    const br = (((BITRATES[layer] || {})[ver] || [])[brIdx]) || 0;
    const sr = (SAMPLERATES[ver] || [])[srIdx] || 0;
    if (br <= 0 || sr <= 0) { i += 1; continue; }

    let frameLen = 0;
    if (layer === 1) frameLen = Math.floor((12 * br * 1000 / sr + pad) * 4);
    else {
      const coeff = ver === 1 ? 144 : (layer === 3 ? 72 : 144);
      frameLen = Math.floor(coeff * br * 1000 / sr + pad);
    }
    if (frameLen <= 0) { i += 1; continue; }

    rates.push(br);
    frames += 1;
    i += frameLen;
  }

  const uniq = Array.from(new Set(rates)).sort((a, b) => a - b);
  const mode = frames < 8 ? "unknown" : (uniq.length === 1 ? "cbr" : "vbr");
  return { mode, frames, uniqueKbps: uniq };
}

function walkMp3(rootDir) {
  const out = [];
  function rec(dir) {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) rec(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".mp3")) out.push(p);
    }
  }
  rec(rootDir);
  return out.sort();
}

function transcodeToCbr({ backend, src, kbps }) {
  const tmp = `${src}.tmp-cbr.mp3`;
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  } catch {}
  const argsCommon = ["-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", `${kbps}k`, "-write_xing", "1", tmp];
  let r;
  if (backend === "wsl") {
    const wSrc = toWslPath(src);
    const wTmp = toWslPath(tmp);
    r = run("wsl", ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", wSrc, "-vn", "-ar", "48000", "-ac", "2", "-c:a", "libmp3lame", "-b:a", `${kbps}k`, "-write_xing", "1", wTmp]);
  } else {
    r = run("ffmpeg", argsCommon);
  }
  if (!r.ok || !fs.existsSync(tmp)) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    return { ok: false, error: (r.stderr || r.stdout || `ffmpeg failed (${r.status})`).trim() };
  }
  try {
    fs.renameSync(tmp, src);
    return { ok: true };
  } catch (err) {
    try {
      fs.copyFileSync(tmp, src);
      fs.unlinkSync(tmp);
      return { ok: true };
    } catch (copyErr) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      const e = copyErr instanceof Error ? copyErr.message : String(copyErr || err);
      return { ok: false, error: `replace-failed: ${e}` };
    }
  }
}

function rel(p) {
  return p.split(path.sep).join("/");
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  if (!fs.existsSync(root)) throw new Error(`Missing root: ${root}`);

  const backend = detectBackend();
  if (!backend && !args.dryRun) {
    throw new Error("ffmpeg not found (local or wsl)");
  }

  const files = walkMp3(root);
  const scanned = [];
  for (const f of files) {
    const info = parseFrames(f, args.maxFrames);
    scanned.push({ file: rel(path.relative(process.cwd(), f) || f), abs: f, ...info });
  }

  const toConvert = scanned.filter((r) => r.mode === "vbr" || (args.overwriteCbr && r.mode === "cbr"));
  const converted = [];
  const failed = [];

  for (const row of toConvert) {
    if (args.verbose) console.log(`[convert] ${row.file} (${row.mode})`);
    if (!args.dryRun) {
      const r = transcodeToCbr({ backend, src: row.abs, kbps: args.kbps });
      if (!r.ok) {
        failed.push({ file: row.file, error: r.error || "ffmpeg failed" });
        continue;
      }
      const after = parseFrames(row.abs, args.maxFrames);
      if (after.mode !== "cbr") {
        failed.push({ file: row.file, error: `post-convert mode=${after.mode} kbps=${after.uniqueKbps.join(",")}` });
        continue;
      }
      converted.push({ file: row.file, from: row.uniqueKbps, to: after.uniqueKbps });
    }
  }

  const summary = {
    root: rel(path.relative(process.cwd(), root) || root),
    backend: backend || "none",
    kbps: args.kbps,
    dryRun: args.dryRun,
    totalMp3: scanned.length,
    vbrFound: scanned.filter((x) => x.mode === "vbr").length,
    cbrFound: scanned.filter((x) => x.mode === "cbr").length,
    unknownFound: scanned.filter((x) => x.mode === "unknown").length,
    toConvert: toConvert.length,
    converted: converted.length,
    failed: failed.length
  };

  console.log(JSON.stringify({ summary, failed, converted }, null, 2));
  if (failed.length) process.exitCode = 2;
}

main();
