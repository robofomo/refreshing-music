import fs from "node:fs";
import { pathToFileURL } from "node:url";

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function bracketInner(line) {
  const m = line.match(/^\[(.*)\]$/);
  return m ? m[1] : null;
}

export function parseComposerText(rawText) {
  const text = String(rawText ?? "");
  const lines = text.split(/\r?\n/);
  const headerMap = {};
  const sections = [];
  const lyricLines = [];

  let current = null;
  let phase = "header";

  const pushSection = () => {
    if (!current) return;
    sections.push({
      id: current.id,
      labelRaw: current.labelRaw,
      notesRaw: current.notes.join("\n").trim()
    });
    current = null;
  };

  for (const line of lines) {
    const inner = bracketInner(line.trim());
    const isBracket = inner !== null;

    if (phase !== "header" && !isBracket) {
      lyricLines.push(line);
    }

    if (phase === "header") {
      if (isBracket && inner.includes(":")) {
        const idx = inner.indexOf(":");
        const key = inner.slice(0, idx).trim();
        const value = inner.slice(idx + 1).trim();
        if (key) headerMap[key] = value;
        continue;
      }
      if (isBracket && !inner.includes(":")) {
        pushSection();
        current = { labelRaw: inner.trim(), id: slugify(inner), notes: [] };
        phase = "afterSectionHeader";
      }
      continue;
    }

    if (phase === "afterSectionHeader") {
      if (isBracket) {
        current?.notes.push(inner.trim());
        continue;
      }
      // Stage directions are only the bracket lines immediately after header.
      phase = "sectionBody";
      continue;
    }

    if (phase === "sectionBody") {
      if (isBracket && !inner.includes(":")) {
        pushSection();
        current = { labelRaw: inner.trim(), id: slugify(inner), notes: [] };
        phase = "afterSectionHeader";
      }
    }
  }

  pushSection();

  return {
    rawText: text,
    headerMap,
    sections,
    lyricsRawText: lyricLines.join("\n")
  };
}

export function parseComposerFile(filePath) {
  const rawText = fs.readFileSync(filePath, "utf8");
  return parseComposerText(rawText);
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const [composerPath] = process.argv.slice(2);
  if (!composerPath) {
    console.error("Usage: node tools/parse-composer.mjs <composerTxtPath>");
    process.exit(1);
  }

  try {
    const parsed = parseComposerFile(composerPath);
    console.log(JSON.stringify(parsed, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
