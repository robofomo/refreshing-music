import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = { trackIds: new Set(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trackId") {
      const next = String(argv[i + 1] ?? "");
      i += 1;
      for (const part of next.split(",")) {
        const value = part.trim();
        if (value) out.trackIds.add(value);
      }
      continue;
    }
    if (arg === "--json") out.json = true;
  }
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function lyricLines(rawText) {
  return String(rawText ?? "")
    .split(/\r?\n/)
    .map((text) => String(text).trim());
}

function normalizeSectionLabel(raw) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-\d+$/, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifySection(labelRaw) {
  const s = normalizeSectionLabel(labelRaw);
  if (!s) return "other";
  const rules = [
    ["intro", ["intro", "cold open", "opening"]],
    ["prelude", ["prelude", "overture"]],
    ["outro", ["outro"]],
    ["ending", ["ending", "end", "coda", "fade out", "fadeout"]],
    ["tag", ["tag", "reprise"]],
    ["bridge", ["bridge", "middle 8", "middle eight"]],
    ["breakdown", ["breakdown", "break down", "half time", "half-time"]],
    ["build", ["build", "build up", "build-up", "riser", "rise"]],
    ["drop", ["drop", "beat drop", "climax"]],
    ["prechorus", ["pre chorus", "pre-chorus", "prechorus", "lift"]],
    ["postchorus", ["post chorus", "post-chorus", "postchorus"]],
    ["chorus", ["chorus", "refrain"]],
    ["hook", ["hook"]],
    ["verse", ["verse", "v1", "v2", "verse a", "verse b"]],
    ["instrumental", ["instrumental", "inst", "no vocals"]],
    ["solo", ["solo"]],
    ["interlude", ["interlude", "break", "turnaround"]]
  ];
  for (const [type, pats] of rules) {
    if (pats.some((pat) => s.includes(pat))) return type;
  }
  return "other";
}

function findAssetDir(track) {
  const rel = String(track?.assetPaths?.composer ?? "");
  if (!rel) return "";
  return path.dirname(path.resolve(rel));
}

function readEffectiveSections(track) {
  const assetDir = findAssetDir(track);
  if (!assetDir) return [];
  const effectivePath = path.join(assetDir, "effective.json");
  if (!fs.existsSync(effectivePath)) return [];
  try {
    const effective = readJson(effectivePath);
    return Array.isArray(effective?.sections) ? effective.sections : [];
  } catch {
    return [];
  }
}

function sectionAt(sections, tMs) {
  return sections.find((row) => Number.isFinite(Number(row?.t0Ms)) &&
    Number.isFinite(Number(row?.t1Ms)) &&
    tMs >= Number(row.t0Ms) &&
    tMs < Number(row.t1Ms));
}

function formatMs(ms) {
  return `${Math.round(ms)}ms`;
}

function inspectTrack(trackPath) {
  const track = readJson(trackPath);
  const issues = [];
  const lines = lyricLines(track?.lyrics?.rawText ?? "");
  const words = Array.isArray(track?.timing?.words) ? track.timing.words : [];
  const timedLines = Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines : [];
  const sections = readEffectiveSections(track);

  const unindexedWords = words.filter((word) => !Number.isInteger(word?.i));
  if (unindexedWords.length) {
    issues.push({
      type: "unindexedWords",
      count: unindexedWords.length,
      sample: unindexedWords.slice(0, 5).map((word) => ({
        text: word?.text ?? "",
        t0Ms: word?.t0Ms ?? null,
        t1Ms: word?.t1Ms ?? null
      }))
    });
  }

  const byLineIndex = new Map();
  for (const row of timedLines) {
    if (!Number.isInteger(row?.i)) continue;
    const key = Number(row.i);
    const arr = byLineIndex.get(key) ?? [];
    arr.push(row);
    byLineIndex.set(key, arr);
  }

  const missingLyricLines = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]) continue;
    if (!byLineIndex.has(i)) missingLyricLines.push({ i, text: lines[i] });
  }
  if (missingLyricLines.length) {
    issues.push({
      type: "missingLyricLines",
      count: missingLyricLines.length,
      sample: missingLyricLines.slice(0, 5)
    });
  }

  const sortedTimed = timedLines
    .filter((row) => Number.isFinite(Number(row?.t0Ms)) && Number.isFinite(Number(row?.t1Ms)) && Number.isInteger(row?.i))
    .map((row) => ({ i: Number(row.i), t0Ms: Number(row.t0Ms), t1Ms: Number(row.t1Ms) }))
    .sort((a, b) => a.t0Ms - b.t0Ms);

  const largeGaps = [];
  for (let i = 1; i < sortedTimed.length; i += 1) {
    const prev = sortedTimed[i - 1];
    const cur = sortedTimed[i];
    const gapMs = cur.t0Ms - prev.t1Ms;
    if (gapMs > 1800) {
      largeGaps.push({
        afterLine: prev.i,
        beforeLine: cur.i,
        gapMs,
        prevEndMs: prev.t1Ms,
        nextStartMs: cur.t0Ms
      });
    }
  }
  if (largeGaps.length) {
    issues.push({
      type: "largeLineGaps",
      count: largeGaps.length,
      sample: largeGaps.slice(0, 5)
    });
  }

  const suppressedBySection = [];
  for (const row of sortedTimed) {
    const mid = Math.round((row.t0Ms + row.t1Ms) * 0.5);
    const sec = sectionAt(sections, mid);
    const sectionType = classifySection(String(sec?.id || sec?.labelRaw || ""));
    if (sectionType === "instrumental" || sectionType === "drop" || sectionType === "breakdown") {
      suppressedBySection.push({
        i: row.i,
        text: lines[row.i] ?? "",
        t0Ms: row.t0Ms,
        t1Ms: row.t1Ms,
        sectionId: sec?.id ?? "",
        sectionType
      });
    }
  }
  if (suppressedBySection.length) {
    issues.push({
      type: "lyricLinesInsideSuppressedSections",
      count: suppressedBySection.length,
      sample: suppressedBySection.slice(0, 5)
    });
  }

  return {
    trackId: track?.trackId ?? path.basename(trackPath, ".track.json"),
    title: track?.title ?? "",
    issues
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tracksDir = path.resolve("tracks");
  const allTrackPaths = fs.readdirSync(tracksDir)
    .filter((name) => name.endsWith(".track.json"))
    .map((name) => path.join(tracksDir, name))
    .filter((filePath) => args.trackIds.size === 0 || args.trackIds.has(path.basename(filePath, ".track.json")));

  const report = allTrackPaths.map(inspectTrack).filter((entry) => entry.issues.length > 0);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!report.length) {
    console.log("Lyric timing check: no issues found.");
    return;
  }

  for (const entry of report) {
    console.log(`${entry.trackId} ${entry.title ? `(${entry.title})` : ""}`);
    for (const issue of entry.issues) {
      console.log(`  - ${issue.type}: ${issue.count}`);
      if (Array.isArray(issue.sample) && issue.sample.length) {
        for (const sample of issue.sample) {
          if (issue.type === "unindexedWords") {
            console.log(`    ${formatMs(sample.t0Ms ?? 0)} ${JSON.stringify(sample.text)}`);
          } else if (issue.type === "largeLineGaps") {
            console.log(`    gap ${formatMs(sample.gapMs)} between line ${sample.afterLine} and ${sample.beforeLine}`);
          } else if (issue.type === "lyricLinesInsideSuppressedSections") {
            console.log(`    line ${sample.i} in ${sample.sectionId} (${sample.sectionType})`);
          } else {
            console.log(`    line ${sample.i}: ${JSON.stringify(sample.text)}`);
          }
        }
      }
    }
  }
}

main();
