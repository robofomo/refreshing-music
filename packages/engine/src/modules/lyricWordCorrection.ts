type LyricTiming = { i?: number; t0Ms?: number; t1Ms?: number };
type WordTiming = { i?: number; t0Ms?: number; t1Ms?: number; text?: string; conf?: number };

type AlignedToken = {
  display: string;
  norm: string;
};

type AlignedLine = {
  i: number;
  text: string;
  t0Ms: number;
  t1Ms: number;
};

type AlignStep =
  | { kind: "diag"; wordIndex: number; tokenIndex: number }
  | { kind: "up"; wordIndex: number }
  | { kind: "left"; tokenIndex: number };

const correctedWordsCache = new WeakMap<object, WordTiming[]>();

function normalizeToken(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9']+/g, "")
    .trim();
}

function tokenizeLine(line: string): AlignedToken[] {
  const matches = String(line || "").match(/[A-Za-z0-9]+(?:['’`][A-Za-z0-9]+)*/g) ?? [];
  return matches
    .map((display) => {
      const norm = normalizeToken(display);
      return norm ? { display, norm } : null;
    })
    .filter(Boolean) as AlignedToken[];
}

function rawLyricLines(track: any) {
  return String(track?.lyrics?.rawText ?? "")
    .split(/\r?\n/)
    .map((text) => String(text).trim());
}

function buildAlignedLines(track: any): AlignedLine[] {
  const raw = rawLyricLines(track);
  const timed = Array.isArray(track?.timing?.lyricsLines) ? (track.timing.lyricsLines as LyricTiming[]) : [];
  const out: AlignedLine[] = [];
  for (const row of timed) {
    if (!Number.isInteger(row?.i) || !Number.isFinite(Number(row?.t0Ms))) continue;
    const i = Number(row.i);
    const text = raw[i] ?? "";
    if (!text) continue;
    const t0Ms = Math.round(Number(row.t0Ms));
    const t1Ms = Number.isFinite(Number(row?.t1Ms)) ? Math.round(Number(row.t1Ms)) : t0Ms + 2600;
    out.push({ i, text, t0Ms, t1Ms: Math.max(t0Ms + 200, t1Ms) });
  }
  return out.sort((a, b) => a.t0Ms - b.t0Ms);
}

function levenshteinDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const next = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function tokenSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return Math.max(0, 1 - levenshteinDistance(a, b) / maxLen);
}

function substitutionCost(a: string, b: string) {
  if (a === b) return 0;
  const similarity = tokenSimilarity(a, b);
  if (similarity >= 0.9) return 0.08;
  if (similarity >= 0.78) return 0.28;
  if (similarity >= 0.62) return 0.6;
  if (similarity >= 0.45) return 0.95;
  return 1.25;
}

function alignLineTokens(words: WordTiming[], canonicalTokens: AlignedToken[]) {
  const recognized = words.map((word) => normalizeToken(String(word?.text ?? "")));
  if (!recognized.length || !canonicalTokens.length) return null;

  const rows = recognized.length;
  const cols = canonicalTokens.length;
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  const step: Array<Array<"diag" | "up" | "left">> = Array.from(
    { length: rows + 1 },
    () => new Array<"diag" | "up" | "left">(cols + 1).fill("diag")
  );

  for (let i = 1; i <= rows; i += 1) {
    dp[i][0] = i * 0.9;
    step[i][0] = "up";
  }
  for (let j = 1; j <= cols; j += 1) {
    dp[0][j] = j * 0.9;
    step[0][j] = "left";
  }

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      const sub = dp[i - 1][j - 1] + substitutionCost(recognized[i - 1], canonicalTokens[j - 1].norm);
      const del = dp[i - 1][j] + 0.95;
      const ins = dp[i][j - 1] + 0.95;
      const best = Math.min(sub, del, ins);
      dp[i][j] = best;
      step[i][j] = best === sub ? "diag" : best === del ? "up" : "left";
    }
  }

  const avgCost = dp[rows][cols] / Math.max(rows, cols);
  if (avgCost > 0.95) return null;

  const path: AlignStep[] = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    const action = step[i][j];
    if (action === "diag" && i > 0 && j > 0) {
      path.push({ kind: "diag", wordIndex: i - 1, tokenIndex: j - 1 });
      i -= 1;
      j -= 1;
    } else if (action === "up" && i > 0) {
      path.push({ kind: "up", wordIndex: i - 1 });
      i -= 1;
    } else if (j > 0) {
      path.push({ kind: "left", tokenIndex: j - 1 });
      j -= 1;
    } else {
      break;
    }
  }
  path.reverse();

  let strongMatches = 0;
  let diagCount = 0;
  for (const part of path) {
    if (part.kind !== "diag") continue;
    diagCount += 1;
    const similarity = tokenSimilarity(recognized[part.wordIndex], canonicalTokens[part.tokenIndex].norm);
    if (similarity >= 0.58) strongMatches += 1;
  }
  if (!diagCount || strongMatches / diagCount < 0.45) return null;
  return path;
}

function findWordWindow(words: WordTiming[], line: AlignedLine, prev: AlignedLine | null, next: AlignedLine | null) {
  const startFloor = prev ? Math.min(line.t0Ms, prev.t1Ms + 120) : line.t0Ms;
  const endCeil = next ? Math.max(line.t1Ms, next.t0Ms - 120) : line.t1Ms;
  return words
    .filter((word) => Number.isFinite(Number(word?.t0Ms)))
    .filter((word) => {
      const t0Ms = Number(word.t0Ms);
      return t0Ms >= startFloor && t0Ms < endCeil;
    })
    .sort((a, b) => Number(a.t0Ms) - Number(b.t0Ms));
}

function buildSyntheticWord(
  token: AlignedToken,
  line: AlignedLine,
  t0Ms: number,
  t1Ms: number
): WordTiming {
  const clampedStart = Math.max(line.t0Ms, Math.round(t0Ms));
  const clampedEnd = Math.min(line.t1Ms, Math.round(Math.max(t0Ms + 80, t1Ms)));
  return {
    i: line.i,
    t0Ms: clampedStart,
    t1Ms: Math.max(clampedStart + 80, clampedEnd),
    text: token.display,
    conf: 0.9
  };
}

function synthesizeGapWords(
  canonicalTokens: AlignedToken[],
  line: AlignedLine,
  startTokenIndex: number,
  endTokenIndex: number,
  prevWord: WordTiming | null,
  nextWord: WordTiming | null
) {
  if (endTokenIndex < startTokenIndex) return [] as WordTiming[];
  const count = endTokenIndex - startTokenIndex + 1;
  const prevEnd = prevWord && Number.isFinite(Number(prevWord?.t1Ms)) ? Number(prevWord.t1Ms) : Number.NaN;
  const nextStart = nextWord && Number.isFinite(Number(nextWord?.t0Ms)) ? Number(nextWord.t0Ms) : Number.NaN;
  let spanStart = Number.isFinite(prevEnd) ? prevEnd + 10 : line.t0Ms;
  let spanEnd = Number.isFinite(nextStart) ? nextStart - 10 : line.t1Ms;
  if (!Number.isFinite(spanStart)) spanStart = line.t0Ms;
  if (!Number.isFinite(spanEnd)) spanEnd = line.t1Ms;
  if (spanEnd <= spanStart) {
    const fallbackWidth = Math.max(180, Math.round((line.t1Ms - line.t0Ms) / Math.max(1, canonicalTokens.length)));
    spanStart = Number.isFinite(prevEnd) ? prevEnd + 10 : line.t0Ms;
    spanEnd = Number.isFinite(nextStart) ? nextStart - 10 : (spanStart + fallbackWidth * count);
  }
  const usableStart = Math.max(line.t0Ms, spanStart);
  const usableEnd = Math.min(line.t1Ms, Math.max(usableStart + count * 90, spanEnd));
  const slice = Math.max(90, Math.round((usableEnd - usableStart) / Math.max(1, count)));
  const out: WordTiming[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const tokenIndex = startTokenIndex + offset;
    const token = canonicalTokens[tokenIndex];
    const t0Ms = usableStart + offset * slice;
    const t1Ms = offset === count - 1 ? usableEnd : (usableStart + (offset + 1) * slice - 10);
    out.push(buildSyntheticWord(token, line, t0Ms, t1Ms));
  }
  return out;
}

function correctedWordsForLine(
  lineWords: WordTiming[],
  canonicalTokens: AlignedToken[],
  line: AlignedLine
) {
  const path = alignLineTokens(lineWords, canonicalTokens);
  if (!path) return lineWords.map((word) => ({ ...word }));

  const matchedByToken = new Map<number, WordTiming>();
  const diagParts = path.filter((part): part is Extract<AlignStep, { kind: "diag" }> => part.kind === "diag");
  for (const part of diagParts) {
    const source = lineWords[part.wordIndex];
    matchedByToken.set(part.tokenIndex, {
      ...source,
      i: line.i,
      text: canonicalTokens[part.tokenIndex].display
    });
  }

  const out: WordTiming[] = [];
  let tokenIndex = 0;
  while (tokenIndex < canonicalTokens.length) {
    const matched = matchedByToken.get(tokenIndex);
    if (matched) {
      out.push(matched);
      tokenIndex += 1;
      continue;
    }
    const gapStart = tokenIndex;
    while (tokenIndex < canonicalTokens.length && !matchedByToken.has(tokenIndex)) tokenIndex += 1;
    const gapEnd = tokenIndex - 1;
    let prevWord: WordTiming | null = null;
    for (let prevToken = gapStart - 1; prevToken >= 0; prevToken -= 1) {
      const candidate = matchedByToken.get(prevToken);
      if (candidate) {
        prevWord = candidate;
        break;
      }
    }
    let nextWord: WordTiming | null = null;
    for (let nextToken = tokenIndex; nextToken < canonicalTokens.length; nextToken += 1) {
      const candidate = matchedByToken.get(nextToken);
      if (candidate) {
        nextWord = candidate;
        break;
      }
    }
    out.push(...synthesizeGapWords(canonicalTokens, line, gapStart, gapEnd, prevWord, nextWord));
  }
  return out
    .filter((word) => String(word?.text ?? "").trim().length > 0)
    .sort((a, b) => Number(a.t0Ms) - Number(b.t0Ms));
}

export function getCorrectedTimingWords(track: any): WordTiming[] {
  const trackObj = typeof track === "object" && track ? track : null;
  if (!trackObj) return [];
  const cached = correctedWordsCache.get(trackObj);
  if (cached) return cached;

  const words = Array.isArray(track?.timing?.words) ? (track.timing.words as WordTiming[]) : [];
  const lines = buildAlignedLines(track);
  if (!words.length || !lines.length) {
    correctedWordsCache.set(trackObj, words);
    return words;
  }

  const corrected: WordTiming[] = [];
  const usedWordRefs = new Set<WordTiming>();
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const prev = lineIndex > 0 ? lines[lineIndex - 1] : null;
    const next = lineIndex + 1 < lines.length ? lines[lineIndex + 1] : null;
    const lineWords = findWordWindow(words, line, prev, next);
    if (!lineWords.length) continue;
    const canonicalTokens = tokenizeLine(line.text);
    if (!canonicalTokens.length) {
      corrected.push(...lineWords.map((word) => ({ ...word })));
      for (const word of lineWords) usedWordRefs.add(word);
      continue;
    }
    const nextWords = correctedWordsForLine(lineWords, canonicalTokens, line);
    corrected.push(...nextWords);
    for (const word of lineWords) usedWordRefs.add(word);
  }

  for (const word of words) {
    if (usedWordRefs.has(word)) continue;
    corrected.push({ ...word });
  }

  corrected.sort((a, b) => Number(a.t0Ms) - Number(b.t0Ms));
  correctedWordsCache.set(trackObj, corrected);
  return corrected;
}
