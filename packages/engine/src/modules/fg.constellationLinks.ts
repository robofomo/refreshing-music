import { createRng, hashStringToSeed } from "../rng";

type Dot = {
  r0: number;
  a0: number;
  wobbleA: number;
  wobbleB: number;
  phase: number;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgba(hex: string, alpha: number) {
  const clean = String(hex || "#8ACFFF").replace("#", "");
  const s = clean.length >= 6 ? clean.slice(0, 6) : clean.padEnd(6, "0");
  const n = Number.parseInt(s, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

type Cache = {
  key: string;
  dots: Dot[];
};

let cache: Cache | null = null;

function buildDots(seed: number, count: number): Dot[] {
  const rng = createRng(seed ^ hashStringToSeed("fg.constellationLinks"));
  const out: Dot[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      r0: 0.18 + rng.float() * 0.36,
      a0: rng.float() * Math.PI * 2,
      wobbleA: 0.02 + rng.float() * 0.08,
      wobbleB: 0.02 + rng.float() * 0.08,
      phase: rng.float() * Math.PI * 2
    });
  }
  return out;
}

export function renderConstellationLinks({
  ctx,
  canvas,
  tMs,
  colors,
  seed,
  params,
  state
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  colors: string[];
  seed: number;
  params?: Record<string, any>;
  state?: any;
}) {
  const w = canvas.width;
  const h = canvas.height;
  const t = tMs / 1000;
  const low = clamp01(Number(state?.signalBus?.reactive?.low ?? 0));
  const mid = clamp01(Number(state?.signalBus?.reactive?.mid ?? 0));
  const high = clamp01(Number(state?.signalBus?.reactive?.high ?? 0));
  const onset = clamp01(Number(state?.signalBus?.reactive?.onsetPulse ?? 0));
  const beat = clamp01(Number(state?.signalBus?.beat?.pulse ?? 0));
  const downbeat = clamp01(Number(state?.signalBus?.beat?.downbeatPulse ?? 0));

  const count = Math.max(10, Math.min(64, Math.round(Number(params?.count ?? 28))));
  const key = `${seed}:${count}`;
  if (!cache || cache.key !== key) {
    cache = { key, dots: buildDots(seed, count) };
  }
  const dots = cache.dots;
  const cx = w * Number(params?.centerX ?? 0.5);
  const cy = h * Number(params?.centerY ?? 0.5);
  const scale = Math.min(w, h);
  const linkDistPx = Math.max(16, Number(params?.linkDistPx ?? (scale * (0.13 + low * 0.05))));
  const dotRadius = Math.max(0.8, Number(params?.dotRadiusPx ?? 1.6));
  const lineBase = Math.max(0.4, Number(params?.lineWidthPx ?? 0.8));
  const color = String(params?.color ?? colors[(seed >>> 6) % Math.max(1, colors.length)] ?? "#8ACFFF");

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < dots.length; i += 1) {
    const d = dots[i];
    const r = scale * (d.r0 + Math.sin(t * (0.12 + d.wobbleA + low * 0.12) + d.phase) * (0.012 + mid * 0.012));
    const a =
      d.a0 +
      t * (0.1 + d.wobbleB + high * 0.22) +
      Math.sin(t * (0.21 + d.wobbleA * 0.5) + d.phase) * (0.2 + onset * 0.12);
    pts.push({
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r * (0.86 + beat * 0.05)
    });
  }

  ctx.save();
  ctx.globalCompositeOperation = String(params?.blend ?? "screen") as GlobalCompositeOperation;
  const linkAlphaBase = 0.08 + high * 0.2 + onset * 0.16 + downbeat * 0.08;
  const maxDist2 = linkDistPx * linkDistPx;
  ctx.lineWidth = lineBase * (1 + downbeat * 0.2);
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxDist2) continue;
      const u = 1 - d2 / Math.max(1, maxDist2);
      const a = clamp01(linkAlphaBase * u * (0.65 + mid * 0.4));
      if (a <= 0.005) continue;
      ctx.strokeStyle = hexToRgba(color, a);
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[j].x, pts[j].y);
      ctx.stroke();
    }
  }
  for (const p of pts) {
    ctx.fillStyle = hexToRgba(color, 0.5 + high * 0.22);
    ctx.beginPath();
    ctx.arc(p.x, p.y, dotRadius * (1 + onset * 0.2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

