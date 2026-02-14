import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildTrack } from "./build-track.mjs";

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

function titleCaseFromRaw(raw) {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function detectRole(stem, ext) {
  const s = stem.toLowerCase();
  if (ext === ".mp3") {
    if (/\bmix\b/.test(s)) return "mix";
    if (/\binstrumental\b|\binst\b/.test(s)) return "instrumental";
    if (/\bvocals?\b/.test(s)) return "vocals";
    return "mix";
  }
  if (ext === ".zip" && /\bstems?\b/.test(s)) return "stems";
  if (ext === ".txt") return "composer";
  if (ext === ".json5" && /\btiming\b/.test(s)) return "timing";
  return "other";
}

function baseTitleFromStem(stem) {
  let out = stripCopySuffix(stem);
  out = out.replace(/[.](mix|instrumental|inst|vocals?|stems?|composer|timing)$/i, "");
  out = out.replace(/(?:[\s_-]+)(mix|instrumental|inst|vocals?|stems?|composer|timing)$/i, "");
  out = stripCopySuffix(out);
  return titleCaseFromRaw(out);
}

function chooseAudio(groupItems) {
  const byRole = new Map();
  for (const item of groupItems) {
    if (!byRole.has(item.role)) byRole.set(item.role, []);
    byRole.get(item.role).push(item);
  }
  const pick = (role) => {
    const items = (byRole.get(role) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    return items[0] ?? null;
  };
  return pick("mix") || pick("instrumental") || pick("vocals");
}

function runIdGen({ mp3Path, title, composerPath }) {
  const idGenPath = path.resolve("tools", "id-gen.mjs");
  const args = [idGenPath, mp3Path, title ?? "", "", ""];
  if (composerPath && fs.existsSync(composerPath)) args.push(composerPath);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "id-gen failed");
  }
  return JSON.parse(result.stdout);
}

function targetNameForRole(role, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (role === "mix") return "mix.mp3";
  if (role === "instrumental") return "instrumental.mp3";
  if (role === "vocals") return "vocals.mp3";
  if (role === "composer") return "composer.txt";
  if (role === "timing") return "timing.json5";
  if (role === "stems") return "stems.zip";
  return originalName;
}

function safeMove(src, dst) {
  if (src === dst) return;
  if (fs.existsSync(dst)) fs.unlinkSync(dst);
  fs.renameSync(src, dst);
}

function ensureComposerStub(dir) {
  const p = path.join(dir, "composer.txt");
  if (!fs.existsSync(p)) fs.writeFileSync(p, "", "utf8");
  return p;
}

function rebuildIndex(tracksDir) {
  const byTrackId = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".track.json")) {
        const rel = toPosix(path.relative(tracksDir, p));
        const trackId = entry.name.replace(/\.track\.json$/i, "");
        const cur = byTrackId.get(trackId);
        if (!cur) byTrackId.set(trackId, rel);
        else {
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

function main() {
  const repoRoot = path.resolve(".");
  const inboxDir = path.join(repoRoot, "inbox");
  const assetsRoot = path.join(repoRoot, "assets");
  const tracksDir = path.join(repoRoot, "tracks");
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.mkdirSync(assetsRoot, { recursive: true });
  fs.mkdirSync(tracksDir, { recursive: true });

  const files = fs.readdirSync(inboxDir, { withFileTypes: true }).filter((e) => e.isFile());
  const groups = new Map();
  for (const entry of files) {
    const ext = path.extname(entry.name).toLowerCase();
    if (![".mp3", ".zip", ".txt", ".json5"].includes(ext)) continue;
    const stem = path.parse(entry.name).name;
    const role = detectRole(stem, ext);
    const baseTitle = baseTitleFromStem(stem);
    const key = kebab(baseTitle);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { baseTitle, items: [] });
    groups.get(key).items.push({
      name: entry.name,
      role,
      ext,
      srcPath: path.join(inboxDir, entry.name)
    });
  }

  let imported = 0;
  let skipped = 0;
  for (const [groupKey, group] of groups) {
    const chosenAudio = chooseAudio(group.items);
    if (!chosenAudio) {
      skipped += 1;
      continue;
    }

    const workId = kebab(group.baseTitle);
    const tempComposer = group.items.find((x) => x.role === "composer");
    const ids = runIdGen({
      mp3Path: chosenAudio.srcPath,
      title: group.baseTitle,
      composerPath: tempComposer?.srcPath
    });
    const trackId = ids.trackId;
    const assetDir = path.join(assetsRoot, workId, trackId);
    fs.mkdirSync(assetDir, { recursive: true });

    for (const item of group.items) {
      const destName = targetNameForRole(item.role, item.name);
      safeMove(item.srcPath, path.join(assetDir, destName));
    }
    const composerPath = ensureComposerStub(assetDir);
    const audioCandidates = ["mix.mp3", "instrumental.mp3", "vocals.mp3"];
    const audioPath = audioCandidates.map((f) => path.join(assetDir, f)).find((p) => fs.existsSync(p));
    if (!audioPath) {
      skipped += 1;
      continue;
    }

    buildTrack({
      mp3Path: audioPath,
      composerPath,
      titleArg: group.baseTitle,
      trackJsonPath: path.join(tracksDir, `${trackId}.track.json`),
      workIdOverride: workId,
      trackIdOverride: trackId,
      sourceGroupKey: groupKey,
      assetDir: toPosix(path.relative(repoRoot, assetDir))
    });
    imported += 1;
  }

  rebuildIndex(tracksDir);
  console.log(`Imported ${imported} group(s). Skipped ${skipped} group(s).`);
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
