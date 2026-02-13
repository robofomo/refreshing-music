import { createRng, hashStringToSeed } from "../rng";

function hexToRgb(hex: string) {
  const clean = hex.replace("#", "");
  const str = clean.length === 8 ? clean.slice(0, 6) : clean;
  const n = parseInt(str, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function renderGradientField({
  ctx,
  canvas,
  tMs,
  colors,
  seed,
  params
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  colors: string[];
  seed: number;
  params?: Record<string, any>;
}) {
  const w = canvas.width;
  const h = canvas.height;
  const gradientStops = Math.max(2, Number(params?.gradientStops ?? 3));
  const driftSpeed = Number(params?.driftSpeed ?? 0.01);
  const noiseScale = Number(params?.noiseScale ?? 0.4);
  const soften = Number(params?.soften ?? 0.9);
  const hueRotatePerMinute = Number(params?.hueRotatePerMinute ?? 0);

  const rng = createRng(seed ^ hashStringToSeed("bg.gradientField"));
  const t = (tMs / 1000) * driftSpeed;

  const colorOffset = ((tMs / 60000) * hueRotatePerMinute) / 360;
  const base = hexToRgb(colors[Math.floor(((colorOffset % 1) + 1) % 1 * colors.length) % colors.length] ?? "#203A43");
  ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 3; i += 1) {
    const idx = (i + Math.floor(colorOffset * colors.length)) % colors.length;
    const color = hexToRgb(colors[idx]);
    const cx = (0.5 + Math.sin(t + rng.float() * Math.PI * 2 + i * 1.7) * noiseScale * 0.35) * w;
    const cy = (0.5 + Math.cos(t * 0.83 + rng.float() * Math.PI * 2 + i * 1.3) * noiseScale * 0.35) * h;
    const radius = Math.max(w, h) * (0.45 + rng.float() * 0.35);

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, `rgba(${color.r},${color.g},${color.b},${0.42 * soften})`);
    g.addColorStop(1, `rgba(${color.r},${color.g},${color.b},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  const linear = ctx.createLinearGradient(0, 0, w, h);
  for (let i = 0; i < gradientStops; i += 1) {
    const u = gradientStops <= 1 ? 0 : i / (gradientStops - 1);
    const c0 = hexToRgb(colors[i % colors.length]);
    const c1 = hexToRgb(colors[(i + 1) % colors.length]);
    const k = 0.5 + 0.5 * Math.sin(t * 0.7 + i);
    linear.addColorStop(u, `rgba(${Math.round(mix(c0.r, c1.r, k))},${Math.round(mix(c0.g, c1.g, k))},${Math.round(mix(c0.b, c1.b, k))},0.72)`);
  }
  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, w, h);
}
