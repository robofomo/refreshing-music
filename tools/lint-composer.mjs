import fs from "node:fs";
import path from "node:path";
import { parseComposerFile } from "./parse-composer.mjs";

const ALLOWED_LANGUAGE_VALUES = new Set(["en", "es", "en+es", "es+en", "multi"]);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (String(key).startsWith("--")) {
      out[String(key).slice(2)] = val;
      i += 1;
    }
  }
  return out;
}

function valueByKey(headerMap, keyName) {
  const hit = Object.entries(headerMap ?? {}).find(([k]) => String(k).toLowerCase() === keyName.toLowerCase());
  return hit ? String(hit[1] ?? "").trim() : "";
}

function hasLikelyNonEnglishLyrics(lyricsRawText) {
  const text = String(lyricsRawText ?? "");
  if (!text.trim()) return false;
  if (/[áéíóúñü¿¡]/i.test(text)) return true;
  return /\b(la|el|que|con|para|como|donde|cuando|corazon|corazón|noche|calle|amor)\b/i.test(text);
}

function listComposerFiles(assetsRoot) {
  const out = [];
  if (!fs.existsSync(assetsRoot)) return out;
  const workDirs = fs.readdirSync(assetsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const w of workDirs) {
    const workPath = path.join(assetsRoot, w.name);
    const trackDirs = fs.readdirSync(workPath, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const t of trackDirs) {
      const composerPath = path.join(workPath, t.name, "composer.txt");
      if (fs.existsSync(composerPath)) out.push(composerPath);
    }
  }
  return out;
}

function lintComposerFile(filePath) {
  const issues = [];
  const parsed = parseComposerFile(filePath);
  const language = valueByKey(parsed.headerMap, "Language");
  const tempoLockBpm = valueByKey(parsed.headerMap, "Tempo Lock BPM");

  if (language && !ALLOWED_LANGUAGE_VALUES.has(language.toLowerCase())) {
    issues.push({
      level: "error",
      msg: `Invalid [Language:] value "${language}" (allowed: en, es, en+es, es+en, multi)`
    });
  }

  if (!language && hasLikelyNonEnglishLyrics(parsed.lyricsRawText)) {
    issues.push({
      level: "warn",
      msg: "Likely non-English sung lyrics without [Language:] header"
    });
  }

  if (tempoLockBpm && !/^\d+(\.\d+)?$/.test(tempoLockBpm)) {
    issues.push({
      level: "warn",
      msg: `Non-numeric [Tempo Lock BPM:] value "${tempoLockBpm}"`
    });
  }

  return issues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(".");
  const oneFile = typeof args.file === "string" ? path.resolve(args.file) : "";
  const targets = oneFile ? [oneFile] : listComposerFiles(path.join(repoRoot, "assets"));

  let errors = 0;
  let warnings = 0;
  for (const filePath of targets) {
    let issues = [];
    try {
      issues = lintComposerFile(filePath);
    } catch (err) {
      issues = [{ level: "error", msg: err instanceof Error ? err.message : String(err) }];
    }
    if (!issues.length) continue;
    const rel = path.relative(repoRoot, filePath).split(path.sep).join("/");
    for (const issue of issues) {
      if (issue.level === "error") errors += 1;
      if (issue.level === "warn") warnings += 1;
      console.log(`[composer:lint] ${issue.level} ${rel}: ${issue.msg}`);
    }
  }

  console.log(`[composer:lint] files=${targets.length} warnings=${warnings} errors=${errors}`);
  if (errors > 0) process.exit(1);
}

main();
