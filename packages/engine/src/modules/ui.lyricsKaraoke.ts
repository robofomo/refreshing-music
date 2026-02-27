import type { SectionType } from "../sections";

type LyricTiming = { i?: number; t0Ms?: number; t1Ms?: number };
type WordTiming = { i?: number; t0Ms?: number; t1Ms?: number; text?: string; conf?: number };

type LyricLine = {
  i: number;
  text: string;
  t0Ms: number;
  t1Ms: number;
};

type LyricWindow = {
  firstMs: number;
  lastMs: number;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function toRgba(hex: string, a: number) {
  const s = String(hex || "#FFFFFF").replace("#", "");
  const n = Number.parseInt((s.length >= 6 ? s.slice(0, 6) : s.padEnd(6, "0")), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(a)})`;
}

function rawLines(rawText: string) {
  return String(rawText || "").split(/\r?\n/);
}

function tokenize(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function inferLyricTimelineFromWords(nonEmpty: Array<{ i: number; text: string }>, words: WordTiming[]) {
  if (!nonEmpty.length || !words.length) return [] as LyricLine[];
  const sorted = words
    .filter((w) => Number.isFinite(Number(w?.t0Ms)))
    .sort((a, b) => Number(a.t0Ms) - Number(b.t0Ms));
  if (!sorted.length) return [] as LyricLine[];

  const out: LyricLine[] = [];
  let wordIdx = 0;
  for (const line of nonEmpty) {
    if (wordIdx >= sorted.length) break;
    const tokenCount = Math.max(1, tokenize(line.text).length);
    const startWord = sorted[wordIdx];
    let endWord = startWord;
    for (let n = 0; n < tokenCount && wordIdx < sorted.length; n += 1) {
      endWord = sorted[wordIdx];
      wordIdx += 1;
    }
    const t0 = Number(startWord?.t0Ms);
    const t1Candidate = Number(endWord?.t1Ms);
    if (!Number.isFinite(t0)) continue;
    const t1 = Number.isFinite(t1Candidate) ? t1Candidate : t0 + 1600;
    out.push({
      i: line.i,
      text: line.text,
      t0Ms: Math.max(0, Math.round(t0)),
      t1Ms: Math.max(Math.round(t0) + 300, Math.round(t1))
    });
  }
  return out;
}

function buildLyricTimeline(track: any, tMs: number): LyricLine[] {
  const raw = rawLines(String(track?.lyrics?.rawText ?? ""));
  const nonEmpty = raw
    .map((text, i) => ({ i, text: String(text).trim() }))
    .filter((x) => x.text.length > 0);
  if (!nonEmpty.length) return [];

  const words = Array.isArray(track?.timing?.words) ? (track.timing.words as WordTiming[]) : [];
  const timed = Array.isArray(track?.timing?.lyricsLines) ? (track.timing.lyricsLines as LyricTiming[]) : [];
  const hasTimed = timed.some((x) => typeof x?.t0Ms === "number");
  if (hasTimed) {
    const out: LyricLine[] = [];
    for (const row of timed) {
      if (typeof row?.i !== "number" || typeof row?.t0Ms !== "number") continue;
      const text = raw[row.i]?.trim() ?? "";
      if (!text) continue;
      out.push({
        i: row.i,
        text,
        t0Ms: row.t0Ms,
        t1Ms: typeof row.t1Ms === "number" ? row.t1Ms : row.t0Ms + 2600
      });
    }
    if (out.length) {
      const sorted = out.sort((a, b) => a.t0Ms - b.t0Ms);
      const inferred = inferLyricTimelineFromWords(nonEmpty, words);
      const sparseTimed = sorted.length <= 1 || sorted.length < Math.ceil(nonEmpty.length * 0.5);
      if (sparseTimed && inferred.length > sorted.length) {
        return inferred;
      }
      return sorted;
    }
  }

  const inferred = inferLyricTimelineFromWords(nonEmpty, words);
  if (inferred.length) return inferred;

  const durationMs = Number.isFinite(track?.audio?.durationMs)
    ? Number(track.audio.durationMs)
    : Math.max(30_000, tMs + 60_000);
  const span = Math.max(1200, Math.floor(durationMs / nonEmpty.length));
  return nonEmpty.map((line, idx) => {
    const t0 = idx * span;
    return {
      i: line.i,
      text: line.text,
      t0Ms: t0,
      t1Ms: t0 + span
    };
  });
}

function wordProgressForLine(track: any, lines: LyricLine[], currentIdx: number, cur: LyricLine, tMs: number) {
  const words = Array.isArray(track?.timing?.words) ? (track.timing.words as WordTiming[]) : [];
  const lineEndMs = Number.isFinite(cur?.t1Ms) ? cur.t1Ms : cur.t0Ms + 2600;
  const timeProgress = clamp01((tMs - cur.t0Ms) / Math.max(1, lineEndMs - cur.t0Ms));
  if (!words.length) return timeProgress;
  const prev = currentIdx > 0 ? lines[currentIdx - 1] : null;
  const next = currentIdx + 1 < lines.length ? lines[currentIdx + 1] : null;
  const windowStartMs = Math.max(
    0,
    Math.min(
      cur.t0Ms,
      (prev ? prev.t1Ms : cur.t0Ms) + 40
    )
  );
  const windowEndMs = Math.max(
    lineEndMs,
    Math.min(
      lineEndMs + 220,
      (next ? next.t0Ms : lineEndMs + 220)
    )
  );

  const lineWords = words
    .filter((w) => {
      const t0 = Number(w?.t0Ms);
      if (!Number.isFinite(t0)) return false;
      if (t0 < windowStartMs || t0 >= windowEndMs) return false;
      if (typeof w?.i === "number") return w.i === cur.i;
      return true;
    })
    .filter((w) => Number.isFinite(Number(w?.t0Ms)))
    .sort((a, b) => Number(a.t0Ms) - Number(b.t0Ms));
  if (!lineWords.length) return timeProgress;
  const firstWordStartMs = Number(lineWords[0]?.t0Ms);
  if (Number.isFinite(firstWordStartMs) && tMs < firstWordStartMs) return 0;

  let done = 0;
  let progressedWeight = 0;
  let totalWeight = 0;
  for (const w of lineWords) {
    const t0 = Number(w.t0Ms);
    const t1 = Number.isFinite(Number(w.t1Ms)) ? Number(w.t1Ms) : t0 + 180;
    const conf = Number.isFinite(Number(w.conf)) ? clamp01(Number(w.conf)) : 0.75;
    const weight = 0.35 + conf * 0.65;
    totalWeight += weight;
    if (tMs >= t1) {
      done += 1;
      progressedWeight += weight;
      continue;
    }
    if (tMs > t0 && tMs < t1) {
      done += clamp01((tMs - t0) / Math.max(1, t1 - t0));
      progressedWeight += weight * clamp01((tMs - t0) / Math.max(1, t1 - t0));
    }
  }
  const wordProgress = clamp01(done / lineWords.length);
  const weightedWordProgress = totalWeight > 0 ? clamp01(progressedWeight / totalWeight) : wordProgress;
  const avgConf =
    lineWords.length > 0
      ? lineWords.reduce((acc, w) => acc + (Number.isFinite(Number(w.conf)) ? clamp01(Number(w.conf)) : 0.75), 0) / lineWords.length
      : 0.75;
  const trustWords = clamp01((avgConf - 0.35) / 0.45);
  const blended = weightedWordProgress * trustWords + timeProgress * (1 - trustWords);
  if (tMs >= lineEndMs) return 1;
  return clamp01(blended);
}

function findCurrent(lines: LyricLine[], tMs: number) {
  if (!lines.length) return { current: -1 };
  let current = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    const prev = i > 0 ? lines[i - 1] : null;
    const startMs = i === 0
      ? row.t0Ms
      : Math.min(
        row.t0Ms,
        Number.isFinite(prev?.t1Ms) ? Number(prev.t1Ms) : row.t0Ms
      );
    if (tMs >= startMs && tMs < row.t1Ms) {
      current = i;
      break;
    }
    if (tMs >= startMs) current = i;
  }
  return { current: Math.max(0, Math.min(lines.length - 1, current)) };
}

function lyricWindow(track: any, lines: LyricLine[]): LyricWindow | null {
  if (!lines.length) return null;
  const words = Array.isArray(track?.timing?.words) ? (track.timing.words as WordTiming[]) : [];

  const firstLineMs = Math.min(...lines.map((x) => Number(x.t0Ms)));
  const lastLineMs = Math.max(...lines.map((x) => Number(x.t1Ms)));
  let firstMs = firstLineMs;
  let lastMs = lastLineMs;

  if (words.length) {
    const starts = words.map((w) => Number(w?.t0Ms)).filter((n) => Number.isFinite(n));
    const ends = words
      .map((w) => (Number.isFinite(Number(w?.t1Ms)) ? Number(w?.t1Ms) : Number(w?.t0Ms)))
      .filter((n) => Number.isFinite(n));
    if (starts.length) firstMs = Math.min(...starts);
    if (ends.length) lastMs = Math.max(...ends);
  }

  return { firstMs, lastMs };
}

export function renderLyricsKaraoke({
  ctx,
  canvas,
  tMs,
  track,
  sectionType,
  params,
  lyricsEnabled
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  track: any;
  sectionType: SectionType;
  params?: Record<string, any>;
  lyricsEnabled?: boolean;
}) {
  const mode = String(params?.mode ?? "center").toLowerCase();
  if (lyricsEnabled === false || mode === "off") {
    return { lyricIndex: -1, lyricText: "" };
  }

  if (sectionType === "instrumental" || sectionType === "drop" || sectionType === "breakdown") {
    return { lyricIndex: -1, lyricText: "" };
  }

  const lines = buildLyricTimeline(track, tMs);
  if (!lines.length) return { lyricIndex: -1, lyricText: "" };
  const nextPreviewMs = Number(params?.nextPreviewMs ?? 1600);
  const firstLineLeadInMs = Number(params?.firstLineLeadInMs ?? nextPreviewMs);
  if (tMs < lines[0].t0Ms - firstLineLeadInMs) {
    return { lyricIndex: -1, lyricText: "" };
  }

  const window = lyricWindow(track, lines);
  if (window) {
    const leadInMs = Number(params?.leadInMs ?? 2000);
    const tailHoldMs = Number(params?.tailHoldMs ?? 10000);
    if (tMs < window.firstMs - leadInMs || tMs > window.lastMs + tailHoldMs) {
      return { lyricIndex: -1, lyricText: "" };
    }
  }

  const { current } = findCurrent(lines, tMs);
  const prev = current > 0 ? lines[current - 1] : null;
  const cur = lines[current] ?? null;
  const next = current + 1 < lines.length ? lines[current + 1] : null;
  if (!cur) return { lyricIndex: -1, lyricText: "" };
  const showNext = Boolean(next?.text) && (tMs >= ((next?.t0Ms ?? Number.POSITIVE_INFINITY) - nextPreviewMs));

  const safeMargin = Number(params?.safeMarginPx ?? 32);
  const controlsReservedPx = Number(params?.controlsReservedPx ?? 96);
  const maxWidth = canvas.width * 0.7;
  const align = String(params?.align ?? "center");
  const baseFont = Number(params?.fontSizePx ?? 30);
  const lineGap = Number(params?.lineGapPx ?? 10);
  const opacity = clamp01(Number(params?.opacity ?? 0.92));
  const glow = Number(params?.glowStrength ?? 0.8);
  const isChorus = sectionType === "chorus" || sectionType === "hook" || sectionType === "postchorus";
  const fontSize = baseFont * (isChorus ? 1.1 : sectionType === "verse" ? 0.95 : 1);
  const lineH = Math.floor(fontSize + lineGap);

  const centerYBase =
    mode === "center"
      ? canvas.height * 0.5
      : canvas.height - safeMargin - controlsReservedPx - lineH * 1.5;
  const viewportHeightPx = Number(params?.viewportHeightPx ?? (globalThis as any).innerHeight ?? 0);
  const controlsTopPx = Number(params?.controlsTopPx ?? 0);
  const scale = viewportHeightPx > 0 ? canvas.height / viewportHeightPx : 1;
  const controlsTopCanvas = controlsTopPx > 0 ? controlsTopPx * scale : canvas.height;
  const maxCenterY = controlsTopCanvas - safeMargin * scale - lineH * 1.1;
  const centerY = Math.min(centerYBase, maxCenterY);
  let x = canvas.width * 0.5;
  if (align === "left") x = safeMargin + maxWidth * 0.5;
  if (align === "right") x = canvas.width - safeMargin - maxWidth * 0.5;
  const yPrev = centerY - lineH;
  const yCur = centerY;
  const yNext = centerY + lineH;

  ctx.save();
  ctx.textAlign = align === "left" ? "left" : align === "right" ? "right" : "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;

  if (prev?.text) {
    ctx.fillStyle = toRgba("#DCE8FF", opacity * 0.35);
    ctx.fillText(prev.text, x, yPrev, maxWidth);
  }

  ctx.fillStyle = toRgba("#FFFFFF", opacity);
  ctx.shadowColor = `rgba(100,170,255,${0.32 + glow * 0.2})`;
  ctx.shadowBlur = 12 + glow * 12;
  ctx.fillText(cur.text, x, yCur, maxWidth);

  const progress = wordProgressForLine(track, lines, current, cur, tMs);
  if (progress > 0) {
    const textWidth = Math.min(maxWidth, ctx.measureText(cur.text).width);
    const w = textWidth * progress;
    const left = align === "left" ? x : align === "right" ? x - textWidth : x - textWidth * 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, yCur - lineH, w, lineH * 2);
    ctx.clip();
    ctx.fillStyle = toRgba("#9EE8FF", opacity * 0.9);
    ctx.shadowColor = `rgba(140,220,255,${0.45 + glow * 0.2})`;
    ctx.shadowBlur = 14 + glow * 10;
    ctx.fillText(cur.text, x, yCur, maxWidth);
    ctx.restore();
  }

  if (showNext && next?.text) {
    ctx.fillStyle = toRgba("#DCE8FF", opacity * 0.32);
    ctx.shadowBlur = 6;
    ctx.fillText(next.text, x, yNext, maxWidth);
  }
  ctx.restore();

  return { lyricIndex: cur.i, lyricText: cur.text };
}
