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
  const compact = Object.entries(headerMap).find(([k]) => k.toLowerCase() === "songtitle");
  if (compact) return compact[1];
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

  const dateOnly = String(createdLocalRaw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    // Date-only Created values intentionally preserve calendar date without
    // inferring an unknown local time component.
    return {
      createdAt: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00.000Z`,
      createdLocalRaw,
      createdDateOnly: true
    };
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
  const effective = has("effective.json") ? toRel(path.join(assetDirAbs, "effective.json")) : "";
  const instrumental = has("instrumental.mp3") ? toRel(path.join(assetDirAbs, "instrumental.mp3")) : "";
  const instrumentalWav = has("instrumental.wav") ? toRel(path.join(assetDirAbs, "instrumental.wav")) : "";
  const vocals = has("vocals.mp3") ? toRel(path.join(assetDirAbs, "vocals.mp3")) : "";
  const vocalsWav = has("vocals.wav") ? toRel(path.join(assetDirAbs, "vocals.wav")) : "";
  const composer = composerPath && fs.existsSync(composerPath) ? toRel(composerPath) : "";
  return { mix, mixWav, stemsZip, effective, instrumental, instrumentalWav, vocals, vocalsWav, composer };
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
    .replace(/[â€™`]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeToken(token) {
  const t = String(token ?? "")
    .toLowerCase()
    .replace(/[â€™`]/g, "'")
    .replace(/[‘’]/g, "'")
    .replace(/^'+|'+$/g, "");
  if (t.length > 4 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function limitedEditDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const next = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    let rowMin = next[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
      if (next[j] < rowMin) rowMin = next[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function tokenSimilarity(a, b) {
  const x = normalizeToken(a);
  const y = normalizeToken(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return 0.86;
  if (Math.abs(x.length - y.length) <= 1) {
    let mismatches = 0;
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i += 1) if (x[i] !== y[i]) mismatches += 1;
    mismatches += Math.abs(x.length - y.length);
    if (mismatches <= 1) return 0.8;
  }
  if (x.length >= 3 && y.length >= 3) {
    const d = limitedEditDistance(x, y, 2);
    if (d === 1) return 0.74;
    if (d === 2) return 0.6;
  }
  return 0;
}

function overlapRatio(a0, a1, b0, b1) {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);
  if (hi <= lo) return 0;
  const inter = hi - lo;
  const denom = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return inter / denom;
}

function scoreClusterToLine(clusterWords, lineTokens) {
  const clusterTokens = clusterWords
    .flatMap((w) => tokenize(w?.text ?? ""))
    .filter(Boolean);
  if (!clusterTokens.length || !Array.isArray(lineTokens) || !lineTokens.length) {
    return { score: 0, coverageLine: 0, coverageCluster: 0, strong: 0 };
  }

  let li = 0;
  let matched = 0;
  let strong = 0;
  for (const ct of clusterTokens) {
    let bestSim = 0;
    let bestIdx = -1;
    for (let k = li; k < lineTokens.length; k += 1) {
      const sim = tokenSimilarity(ct, lineTokens[k]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = k;
      }
      if (sim >= 0.95) break;
    }
    if (bestSim >= 0.62 && bestIdx >= 0) {
      matched += bestSim;
      if (bestSim >= 0.9) strong += 1;
      li = bestIdx + 1;
      if (li >= lineTokens.length) break;
    }
  }

  const coverageLine = matched / Math.max(1, lineTokens.length);
  const coverageCluster = matched / Math.max(1, clusterTokens.length);
  const score = coverageLine * 0.75 + coverageCluster * 0.25 + strong * 0.02;
  return { score, coverageLine, coverageCluster, strong, clusterTokens: clusterTokens.length };
}

function bestSubclusterMatch(clusterWords, lineTokens) {
  if (!Array.isArray(clusterWords) || !clusterWords.length) return null;
  if (!Array.isArray(lineTokens) || !lineTokens.length) return null;
  let best = null;
  const maxWords = Math.min(clusterWords.length, Math.max(5, lineTokens.length + 4));
  for (let s = 0; s < clusterWords.length; s += 1) {
    const maxEnd = Math.min(clusterWords.length - 1, s + maxWords - 1);
    for (let e = s; e <= maxEnd; e += 1) {
      const sub = clusterWords.slice(s, e + 1);
      const sc = scoreClusterToLine(sub, lineTokens);
      if (!best || sc.score > best.score) {
        best = {
          ...sc,
          start: s,
          end: e,
          t0Ms: Number(sub[0]?.t0Ms),
          t1Ms: Number(sub[sub.length - 1]?.t1Ms),
          wordIndexes: sub.map((w) => Number(w?.wordIndex)).filter((n) => Number.isInteger(n))
        };
      }
    }
  }
  return best;
}

function findLineSubsequenceInCluster(clusterWords, lineTokens) {
  if (!Array.isArray(clusterWords) || !clusterWords.length) return null;
  if (!Array.isArray(lineTokens) || !lineTokens.length) return null;
  const clusterTokens = [];
  for (const w of clusterWords) {
    const toks = tokenize(w?.text ?? "");
    for (const tok of toks) {
      clusterTokens.push({
        token: tok,
        wordIndex: Number(w?.wordIndex),
        t0Ms: Number(w?.t0Ms),
        t1Ms: Number(w?.t1Ms)
      });
    }
  }
  if (!clusterTokens.length) return null;

  let li = 0;
  let matched = 0;
  let strong = 0;
  let first = -1;
  let last = -1;
  const usedWordIndexes = new Set();
  for (let ci = 0; ci < clusterTokens.length && li < lineTokens.length; ci += 1) {
    const s = tokenSimilarity(clusterTokens[ci].token, lineTokens[li]);
    if (s < 0.62) continue;
    if (first < 0) first = ci;
    last = ci;
    matched += s;
    if (s >= 0.9) strong += 1;
    if (Number.isInteger(clusterTokens[ci].wordIndex)) usedWordIndexes.add(clusterTokens[ci].wordIndex);
    li += 1;
  }
  if (first < 0 || last < first) return null;
  const coverageLine = matched / Math.max(1, lineTokens.length);
  const coverageCluster = matched / Math.max(1, clusterTokens.length);
  if (coverageLine < 0.66 || strong < 2) return null;
  const score = coverageLine * 0.8 + coverageCluster * 0.2 + strong * 0.02;
  return {
    score,
    coverageLine,
    coverageCluster,
    strong,
    clusterTokens: clusterTokens.length,
    t0Ms: clusterTokens[first].t0Ms,
    t1Ms: clusterTokens[last].t1Ms,
    wordIndexes: Array.from(usedWordIndexes.values())
  };
}

function buildLyricAlignmentFromWords(lyricsRawText, wordsPayload) {
  const words = Array.isArray(wordsPayload?.words) ? wordsPayload.words : [];
  if (!words.length) return { lyricsLines: [], wordLineMap: new Map() };
  const rawLines = String(lyricsRawText ?? "").split(/\r?\n/);

  const lyricLines = [];
  const lyricTokens = [];
  for (let li = 0; li < rawLines.length; li += 1) {
    const text = rawLines[li]?.trim() ?? "";
    if (!text) continue;
    const tokens = tokenize(text);
    if (!tokens.length) continue;
    lyricLines.push({ i: li, tokenCount: tokens.length, tokens });
    for (let ti = 0; ti < tokens.length; ti += 1) {
      lyricTokens.push({ lineI: li, token: tokens[ti] });
    }
  }
  if (!lyricTokens.length) return { lyricsLines: [], wordLineMap: new Map() };

  const asrTokens = [];
  for (let wi = 0; wi < words.length; wi += 1) {
    const w = words[wi];
    const t0 = Number(w?.t0Ms);
    const t1Raw = Number(w?.t1Ms);
    if (!Number.isFinite(t0)) continue;
    const t1 = Number.isFinite(t1Raw) ? t1Raw : t0 + 200;
    const segMs = Math.max(40, t1 - t0);
    const parts = tokenize(w?.text ?? "");
    if (!parts.length) continue;
    for (let pi = 0; pi < parts.length; pi += 1) {
      const a = pi / parts.length;
      const b = (pi + 1) / parts.length;
      asrTokens.push({
        token: parts[pi],
        wordIndex: wi,
        t0Ms: Math.round(t0 + segMs * a),
        t1Ms: Math.round(t0 + segMs * b)
      });
    }
  }
  if (!asrTokens.length) return { lyricsLines: [], wordLineMap: new Map() };

  const m = lyricTokens.length;
  const n = asrTokens.length;
  const DEL_COST = 0.7;
  const INS_COST = 0.55;
  const SUB_COST = 1.15;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  const bt = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    dp[i][0] = i * DEL_COST;
    bt[i][0] = 1;
  }
  for (let j = 1; j <= n; j += 1) {
    dp[0][j] = j * INS_COST;
    bt[0][j] = 2;
  }
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const sim = tokenSimilarity(lyricTokens[i - 1].token, asrTokens[j - 1].token);
      const subst = dp[i - 1][j - 1] + (sim > 0 ? 1 - sim : SUB_COST);
      const del = dp[i - 1][j] + DEL_COST;
      const ins = dp[i][j - 1] + INS_COST;
      let best = subst;
      let op = 3;
      if (del < best) {
        best = del;
        op = 1;
      }
      if (ins < best) {
        best = ins;
        op = 2;
      }
      dp[i][j] = best;
      bt[i][j] = op;
    }
  }

  const matchedByLine = new Map();
  const wordLineWeight = new Map();
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const op = bt[i][j];
    if (op === 3 && i > 0 && j > 0) {
      const lineI = lyricTokens[i - 1].lineI;
      const a = asrTokens[j - 1];
      const sim = tokenSimilarity(lyricTokens[i - 1].token, a.token);
      if (sim >= 0.5) {
        const rec = matchedByLine.get(lineI) || { t0: Infinity, t1: -Infinity, hits: 0 };
        rec.t0 = Math.min(rec.t0, a.t0Ms);
        rec.t1 = Math.max(rec.t1, a.t1Ms);
        rec.hits += 1;
        matchedByLine.set(lineI, rec);
        const key = `${a.wordIndex}:${lineI}`;
        wordLineWeight.set(key, (wordLineWeight.get(key) || 0) + sim);
      }
      i -= 1;
      j -= 1;
      continue;
    }
    if (op === 1 && i > 0) {
      i -= 1;
      continue;
    }
    if (j > 0) j -= 1;
  }

  const wordLineMap = new Map();
  for (const [key, weight] of wordLineWeight.entries()) {
    const [wordIndexStr, lineIStr] = key.split(":");
    const wordIndex = Number(wordIndexStr);
    const lineI = Number(lineIStr);
    const cur = wordLineMap.get(wordIndex);
    if (!cur || weight > cur.weight) wordLineMap.set(wordIndex, { lineI, weight });
  }

  let msPerToken = 280;
  const msSamples = [];
  for (const line of lyricLines) {
    const rec = matchedByLine.get(line.i);
    if (!rec || !Number.isFinite(rec.t0) || !Number.isFinite(rec.t1)) continue;
    msSamples.push((rec.t1 - rec.t0) / Math.max(1, line.tokenCount));
  }
  if (msSamples.length) {
    msPerToken = clamp(msSamples.reduce((a, b) => a + b, 0) / msSamples.length, 120, 480);
  }

  const out = lyricLines.map((line) => {
    const rec = matchedByLine.get(line.i);
    if (rec && Number.isFinite(rec.t0) && Number.isFinite(rec.t1) && rec.t1 > rec.t0) {
      return { i: line.i, t0Ms: Math.max(0, Math.round(rec.t0)), t1Ms: Math.max(Math.round(rec.t0) + 240, Math.round(rec.t1)), tokens: line.tokenCount };
    }
    return { i: line.i, t0Ms: NaN, t1Ms: NaN, tokens: line.tokenCount };
  });

  for (let k = 0; k < out.length; k += 1) {
    if (Number.isFinite(out[k].t0Ms) && Number.isFinite(out[k].t1Ms)) continue;
    let prev = k - 1;
    while (prev >= 0 && !Number.isFinite(out[prev].t0Ms)) prev -= 1;
    let next = k + 1;
    while (next < out.length && !Number.isFinite(out[next].t0Ms)) next += 1;
    const estDur = clamp(Math.round((out[k].tokens || 4) * msPerToken), 700, 7000);

    if (prev >= 0 && next < out.length) {
      const gap = Math.max(300, out[next].t0Ms - out[prev].t1Ms);
      const missing = next - prev - 1;
      const slot = gap / Math.max(1, missing + 1);
      const t0 = out[prev].t1Ms + slot * (k - prev) - estDur * 0.5;
      out[k].t0Ms = Math.max(0, Math.round(t0));
      out[k].t1Ms = Math.max(out[k].t0Ms + 260, Math.round(out[k].t0Ms + estDur));
    } else if (prev >= 0) {
      out[k].t0Ms = Math.round(out[prev].t1Ms + 120);
      out[k].t1Ms = Math.round(out[k].t0Ms + estDur);
    } else if (next < out.length) {
      out[k].t1Ms = Math.max(260, Math.round(out[next].t0Ms - 120));
      out[k].t0Ms = Math.max(0, out[k].t1Ms - estDur);
    } else {
      out[k].t0Ms = k * Math.max(estDur, 1000);
      out[k].t1Ms = out[k].t0Ms + estDur;
    }
  }

  const intervalsByLine = new Map();
  for (const row of out) {
    if (!Number.isFinite(row.t0Ms) || !Number.isFinite(row.t1Ms)) continue;
    if (!intervalsByLine.has(row.i)) intervalsByLine.set(row.i, []);
    intervalsByLine.get(row.i).push({ t0Ms: row.t0Ms, t1Ms: row.t1Ms });
  }

  const wordsByLine = new Map();
  for (const [wordIndex, rec] of wordLineMap.entries()) {
    const lineI = rec?.lineI;
    const weight = Number(rec?.weight);
    if (!Number.isInteger(lineI) || !Number.isFinite(weight) || weight < 0.7) continue;
    const w = words[wordIndex];
    const t0Ms = Number(w?.t0Ms);
    const t1Raw = Number(w?.t1Ms);
    if (!Number.isFinite(t0Ms)) continue;
    const t1Ms = Number.isFinite(t1Raw) ? t1Raw : t0Ms + 180;
    if (!wordsByLine.has(lineI)) wordsByLine.set(lineI, []);
    wordsByLine.get(lineI).push({ t0Ms, t1Ms, wordIndex });
  }

  for (const line of lyricLines) {
    const mapped = (wordsByLine.get(line.i) || []).sort((a, b) => a.t0Ms - b.t0Ms || a.wordIndex - b.wordIndex);
    if (mapped.length < 6) continue;
    const clusters = [];
    let cur = null;
    for (const w of mapped) {
      if (!cur) {
        cur = { t0Ms: w.t0Ms, t1Ms: w.t1Ms, count: 1, lastWordIndex: w.wordIndex };
        continue;
      }
      const gapMs = w.t0Ms - cur.t1Ms;
      const gapWords = w.wordIndex - cur.lastWordIndex;
      if (gapMs > 1600 || gapWords > 6) {
        clusters.push(cur);
        cur = { t0Ms: w.t0Ms, t1Ms: w.t1Ms, count: 1, lastWordIndex: w.wordIndex };
      } else {
        cur.t1Ms = Math.max(cur.t1Ms, w.t1Ms);
        cur.count += 1;
        cur.lastWordIndex = w.wordIndex;
      }
    }
    if (cur) clusters.push(cur);
    if (clusters.length < 2) continue;

    const existing = intervalsByLine.get(line.i) || [];
    const baselineDur = existing.length ? Math.max(1, existing[0].t1Ms - existing[0].t0Ms) : 0;
    const minWords = Math.max(4, Math.floor(line.tokenCount * 0.55));
    const accepted = [];
    for (const c of clusters) {
      if (c.count < minWords) continue;
      const cDur = Math.max(1, c.t1Ms - c.t0Ms);
      if (baselineDur > 0) {
        const ratio = cDur / baselineDur;
        if (ratio < 0.55 || ratio > 2.3) continue;
      }
      const overlapExisting = existing.some((ex) => overlapRatio(ex.t0Ms, ex.t1Ms, c.t0Ms, c.t1Ms) > 0.45 || Math.abs(ex.t0Ms - c.t0Ms) < 500);
      if (overlapExisting) continue;
      const overlapAccepted = accepted.some((ex) => overlapRatio(ex.t0Ms, ex.t1Ms, c.t0Ms, c.t1Ms) > 0.45 || Math.abs(ex.t0Ms - c.t0Ms) < 500);
      if (overlapAccepted) continue;
      accepted.push(c);
    }
    accepted.sort((a, b) => a.t0Ms - b.t0Ms);
    for (const c of accepted.slice(0, 2)) {
      out.push({
        i: line.i,
        t0Ms: Math.max(0, Math.round(c.t0Ms)),
        t1Ms: Math.max(Math.round(c.t0Ms) + 240, Math.round(c.t1Ms)),
        tokens: line.tokenCount
      });
      existing.push({ t0Ms: c.t0Ms, t1Ms: c.t1Ms });
    }
    intervalsByLine.set(line.i, existing);
  }

  const mappedWordIndexes = new Set();
  for (const idx of wordLineMap.keys()) mappedWordIndexes.add(Number(idx));
  const unmappedClusters = [];
  let currentCluster = [];
  for (let wi = 0; wi < words.length; wi += 1) {
    const w = words[wi];
    const t0Ms = Number(w?.t0Ms);
    const t1Raw = Number(w?.t1Ms);
    if (!Number.isFinite(t0Ms)) continue;
    if (mappedWordIndexes.has(wi)) {
      if (currentCluster.length) {
        unmappedClusters.push(currentCluster);
        currentCluster = [];
      }
      continue;
    }
    const t1Ms = Number.isFinite(t1Raw) ? t1Raw : t0Ms + 180;
    const prev = currentCluster.length ? currentCluster[currentCluster.length - 1] : null;
    if (prev) {
      const gapMs = t0Ms - prev.t1Ms;
      const gapWords = wi - prev.wordIndex;
      if (gapMs > 1800 || gapWords > 6) {
        unmappedClusters.push(currentCluster);
        currentCluster = [];
      }
    }
    currentCluster.push({ wordIndex: wi, t0Ms, t1Ms, text: String(w?.text ?? ""), conf: Number.isFinite(Number(w?.conf)) ? Number(w.conf) : 0.6 });
  }
  if (currentCluster.length) unmappedClusters.push(currentCluster);

  for (const cluster of unmappedClusters) {
    const tokenCount = cluster.reduce((acc, w) => acc + tokenize(w.text).length, 0);
    if (tokenCount < 5 || cluster.length < 4) continue;
    const c0All = cluster[0].t0Ms;
    const c1All = cluster[cluster.length - 1].t1Ms;
    const cDurAll = Math.max(1, c1All - c0All);
    if (cDurAll < 900 || cDurAll > 22000) continue;

    const candidates = [];
    for (const line of lyricLines) {
      if (!Array.isArray(line.tokens) || line.tokens.length < 4) continue;
      const hasBase = Array.isArray(intervalsByLine.get(line.i)) && intervalsByLine.get(line.i).length > 0;
      if (!hasBase) continue;
      const sc = bestSubclusterMatch(cluster, line.tokens);
      const sq = findLineSubsequenceInCluster(cluster, line.tokens);
      const pick = (!sc || (sq && sq.score > sc.score)) ? sq : sc;
      if (!pick) continue;
      if (!Number.isFinite(pick.t0Ms) || !Number.isFinite(pick.t1Ms) || pick.t1Ms <= pick.t0Ms) continue;
      if (pick.coverageLine < 0.7 || pick.coverageCluster < 0.24 || pick.strong < 2) continue;
      candidates.push({ lineI: line.i, ...pick });
    }

    if (!candidates.length) continue;
    candidates.sort((a, b) => b.score - a.score || a.t0Ms - b.t0Ms);
    const usedWordIndexes = new Set();
    const accepted = [];
    for (const cand of candidates) {
      const overlapUsed = cand.wordIndexes.some((wi) => usedWordIndexes.has(wi));
      if (overlapUsed) continue;
      const existing = intervalsByLine.get(cand.lineI) || [];
      const overlaps = existing.some((ex) => overlapRatio(ex.t0Ms, ex.t1Ms, cand.t0Ms, cand.t1Ms) > 0.35 || Math.abs(ex.t0Ms - cand.t0Ms) < 500);
      if (overlaps) continue;
      accepted.push(cand);
      for (const wi of cand.wordIndexes) usedWordIndexes.add(wi);
      if (accepted.length >= 3) break;
    }

    for (const cand of accepted) {
      out.push({
        i: cand.lineI,
        t0Ms: Math.max(0, Math.round(cand.t0Ms)),
        t1Ms: Math.max(Math.round(cand.t0Ms) + 240, Math.round(cand.t1Ms)),
        tokens: Math.max(1, cand.clusterTokens || 1)
      });
      const existing = intervalsByLine.get(cand.lineI) || [];
      existing.push({ t0Ms: cand.t0Ms, t1Ms: cand.t1Ms });
      intervalsByLine.set(cand.lineI, existing);
      for (const wi of cand.wordIndexes) {
        const cur = wordLineMap.get(wi);
        if (!cur || cand.score > (Number(cur.weight) || 0)) {
          wordLineMap.set(wi, { lineI: cand.lineI, weight: cand.score });
        }
      }
    }
  }

  const lyricsLines = out.map((x) => ({
    i: x.i,
    t0Ms: Math.max(0, Math.round(x.t0Ms)),
    t1Ms: Math.max(Math.round(x.t0Ms) + 240, Math.round(x.t1Ms))
  }));
  const flatWordLineMap = new Map();
  for (const [wordIndex, rec] of wordLineMap.entries()) flatWordLineMap.set(wordIndex, rec.lineI);
  return { lyricsLines, wordLineMap: flatWordLineMap };
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

  let wordLineMap = new Map();
  if ((!Array.isArray(timing.lyricsLines) || timing.lyricsLines.length === 0) && Array.isArray(words?.words)) {
    const inferred = buildLyricAlignmentFromWords(track?.lyrics?.rawText ?? "", words);
    if (inferred.lyricsLines.length) timing.lyricsLines = inferred.lyricsLines;
    wordLineMap = inferred.wordLineMap || new Map();
  }

  if (Array.isArray(timing.lyricsLines) && timing.lyricsLines.length > 0) {
    const rows = timing.lyricsLines
      .map((row) => ({
        i: Number.isInteger(row?.i) ? row.i : undefined,
        t0Ms: Number.isFinite(Number(row?.t0Ms)) ? Math.max(0, Math.round(Number(row.t0Ms))) : undefined,
        t1Ms: Number.isFinite(Number(row?.t1Ms)) ? Math.max(0, Math.round(Number(row.t1Ms))) : undefined
      }))
      .filter((row) => Number.isInteger(row.i) && Number.isFinite(row.t0Ms))
      .sort((a, b) => a.t0Ms - b.t0Ms);
    for (let ri = 0; ri < rows.length; ri += 1) {
      if (Number.isFinite(rows[ri].t1Ms) && rows[ri].t1Ms > rows[ri].t0Ms) continue;
      const next = ri + 1 < rows.length ? rows[ri + 1] : null;
      const nextT0 = next && Number.isFinite(next.t0Ms) ? next.t0Ms : rows[ri].t0Ms + 2600;
      rows[ri].t1Ms = Math.max(rows[ri].t0Ms + 260, Math.round(nextT0));
    }
    timing.lyricsLines = rows;
  }

  if (!Array.isArray(timing.words) && Array.isArray(words?.words)) {
    timing.words = words.words
      .map((w, idx) => ({
        i: Number.isInteger(w?.i) ? w.i : (wordLineMap.has(idx) ? wordLineMap.get(idx) : undefined),
        t0Ms: Number.isFinite(Number(w?.t0Ms)) ? Math.max(0, Math.round(Number(w.t0Ms))) : undefined,
        t1Ms: Number.isFinite(Number(w?.t1Ms)) ? Math.max(0, Math.round(Number(w.t1Ms))) : undefined,
        text: String(w?.text ?? ""),
        conf: Number.isFinite(Number(w?.conf)) ? Number(w.conf) : undefined
      }))
      .filter((w) => Number.isFinite(w.t0Ms) && w.text);
  }

  if (Array.isArray(timing.lyricsLines) && timing.lyricsLines.length > 1) {
    const timedWords = Array.isArray(timing.words) ? timing.words : [];
    const wordCountIn = (lineI, t0, t1) => timedWords.filter((w) => Number.isInteger(w?.i) && w.i === lineI && Number.isFinite(Number(w?.t0Ms)) && Number(w.t0Ms) >= t0 && Number(w.t0Ms) < t1).length;
    const rows = timing.lyricsLines
      .map((row) => ({
        i: Number.isInteger(row?.i) ? row.i : undefined,
        t0Ms: Number.isFinite(Number(row?.t0Ms)) ? Math.max(0, Math.round(Number(row.t0Ms))) : undefined,
        t1Ms: Number.isFinite(Number(row?.t1Ms)) ? Math.max(0, Math.round(Number(row.t1Ms))) : undefined
      }))
      .filter((row) => Number.isInteger(row.i) && Number.isFinite(row.t0Ms) && Number.isFinite(row.t1Ms) && row.t1Ms > row.t0Ms)
      .sort((a, b) => a.t0Ms - b.t0Ms);
    const out = [];
    for (const row of rows) {
      const prev = out.length ? out[out.length - 1] : null;
      if (prev && prev.i === row.i && row.t0Ms <= prev.t1Ms + 320) {
        const prevDur = prev.t1Ms - prev.t0Ms;
        const rowDur = row.t1Ms - row.t0Ms;
        const prevWords = wordCountIn(prev.i, prev.t0Ms, prev.t1Ms);
        const rowWords = wordCountIn(row.i, row.t0Ms, row.t1Ms);
        const likelySplit = rowDur < 1400 || rowWords <= Math.max(1, Math.floor(prevWords * 0.35));
        if (likelySplit) {
          prev.t1Ms = Math.max(prev.t1Ms, row.t1Ms);
          continue;
        }
      }
      out.push(row);
    }
    timing.lyricsLines = out;
  }

  if (Array.isArray(timing.words) && timing.words.length && Array.isArray(timing.lyricsLines) && timing.lyricsLines.length) {
    const rawLines = String(track?.lyrics?.rawText ?? "").split(/\r?\n/);
    const lyricCatalog = rawLines
      .map((text, i) => ({ i, tokens: tokenize(String(text ?? "").trim()) }))
      .filter((x) => x.tokens.length >= 4);
    const clusters = [];
    let cur = [];
    for (let wi = 0; wi < timing.words.length; wi += 1) {
      const w = timing.words[wi];
      if (Number.isInteger(w?.i)) {
        if (cur.length) {
          clusters.push(cur);
          cur = [];
        }
        continue;
      }
      const t0Ms = Number(w?.t0Ms);
      const t1Raw = Number(w?.t1Ms);
      if (!Number.isFinite(t0Ms)) continue;
      const t1Ms = Number.isFinite(t1Raw) ? t1Raw : t0Ms + 180;
      const prev = cur.length ? cur[cur.length - 1] : null;
      if (prev && (t0Ms - prev.t1Ms > 1800 || wi - prev.wi > 6)) {
        clusters.push(cur);
        cur = [];
      }
      cur.push({ wi, text: String(w?.text ?? ""), t0Ms, t1Ms });
    }
    if (cur.length) clusters.push(cur);

    const hasOverlap = (lineI, t0, t1) => (timing.lyricsLines || []).some((row) => {
      if (!Number.isInteger(row?.i) || row.i !== lineI) return false;
      const r0 = Number(row?.t0Ms);
      const r1 = Number.isFinite(Number(row?.t1Ms)) ? Number(row.t1Ms) : r0 + 2600;
      if (!Number.isFinite(r0) || !Number.isFinite(r1)) return false;
      return overlapRatio(r0, r1, t0, t1) > 0.35 || Math.abs(r0 - t0) < 500;
    });

    for (const cl of clusters) {
      const tokenCount = cl.reduce((acc, w) => acc + tokenize(w.text).length, 0);
      const t0 = cl[0]?.t0Ms;
      const t1 = cl[cl.length - 1]?.t1Ms;
      if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) continue;
      if (tokenCount < 5 || cl.length < 4 || t1 - t0 > 14000) continue;
      const maxTimedEnd = (timing.lyricsLines || [])
        .map((row) => Number.isFinite(Number(row?.t1Ms)) ? Number(row.t1Ms) : Number(row?.t0Ms))
        .filter((n) => Number.isFinite(n))
        .reduce((a, b) => Math.max(a, b), 0);
      const tailRecovery = maxTimedEnd > 0 && t0 >= maxTimedEnd - 1200;

      const candidates = [];
      for (const line of lyricCatalog) {
        const sc = scoreClusterToLine(cl, line.tokens);
        const minLine = tailRecovery ? 0.52 : 0.68;
        const minCluster = tailRecovery ? 0.14 : 0.22;
        const minStrong = tailRecovery ? 1 : 2;
        if (sc.coverageLine < minLine || sc.coverageCluster < minCluster || sc.strong < minStrong) continue;
        candidates.push({ lineI: line.i, ...sc });
      }
      if (!candidates.length) continue;
      candidates.sort((a, b) => b.score - a.score || a.lineI - b.lineI);
      const best = candidates.find((cand) => !hasOverlap(cand.lineI, t0, t1)) || null;
      if (!best) continue;

      timing.lyricsLines.push({
        i: best.lineI,
        t0Ms: Math.max(0, Math.round(t0)),
        t1Ms: Math.max(Math.round(t0) + 240, Math.round(t1))
      });
      for (const w of cl) {
        if (!Number.isInteger(timing.words[w.wi]?.i)) {
          timing.words[w.wi].i = best.lineI;
        }
      }
    }

    timing.lyricsLines = timing.lyricsLines
      .filter((row) => Number.isInteger(row?.i) && Number.isFinite(Number(row?.t0Ms)))
      .map((row) => ({
        i: row.i,
        t0Ms: Math.max(0, Math.round(Number(row.t0Ms))),
        t1Ms: Number.isFinite(Number(row?.t1Ms))
          ? Math.max(Math.round(Number(row.t0Ms)) + 240, Math.round(Number(row.t1Ms)))
          : Math.round(Number(row.t0Ms)) + 2600
      }))
      .sort((a, b) => a.t0Ms - b.t0Ms);
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
  if (created.createdDateOnly) track.createdDateOnly = true;
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

