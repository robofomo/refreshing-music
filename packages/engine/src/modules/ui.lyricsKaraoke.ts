import type { SectionType } from "../sections";

type LyricTiming = { i?: number; t0Ms?: number; t1Ms?: number };

type LyricLine = {
  i: number;
  text: string;
  t0Ms: number;
  t1Ms: number;
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

function buildLyricTimeline(track: any, tMs: number): LyricLine[] {
  const raw = rawLines(String(track?.lyrics?.rawText ?? ""));
  const nonEmpty = raw
    .map((text, i) => ({ i, text: String(text).trim() }))
    .filter((x) => x.text.length > 0);
  if (!nonEmpty.length) return [];

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
    if (out.length) return out.sort((a, b) => a.t0Ms - b.t0Ms);
  }

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

function findCurrent(lines: LyricLine[], tMs: number) {
  if (!lines.length) return { current: -1 };
  let current = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const row = lines[i];
    if (tMs >= row.t0Ms && tMs < row.t1Ms) {
      current = i;
      break;
    }
    if (tMs >= row.t0Ms) current = i;
  }
  return { current: Math.max(0, Math.min(lines.length - 1, current)) };
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

  const { current } = findCurrent(lines, tMs);
  const prev = current > 0 ? lines[current - 1] : null;
  const cur = lines[current] ?? null;
  const next = current + 1 < lines.length ? lines[current + 1] : null;
  if (!cur) return { lyricIndex: -1, lyricText: "" };

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

  const progress = clamp01((tMs - cur.t0Ms) / Math.max(1, cur.t1Ms - cur.t0Ms));
  if (progress > 0) {
    const w = maxWidth * progress;
    const left = align === "left" ? x : align === "right" ? x - maxWidth : x - maxWidth * 0.5;
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

  if (next?.text) {
    ctx.fillStyle = toRgba("#DCE8FF", opacity * 0.32);
    ctx.shadowBlur = 6;
    ctx.fillText(next.text, x, yNext, maxWidth);
  }
  ctx.restore();

  return { lyricIndex: cur.i, lyricText: cur.text };
}
