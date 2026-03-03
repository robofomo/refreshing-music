function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgba(hex: string, alpha: number) {
  const clean = String(hex || "#88CFFF").replace("#", "");
  const s = clean.length >= 6 ? clean.slice(0, 6) : clean.padEnd(6, "0");
  const n = Number.parseInt(s, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

export function renderRadialGradientDrift({
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
  const amp = clamp01(Number(state?.amp ?? 0));
  const onset = clamp01(Number(state?.signalBus?.reactive?.onsetPulse ?? 0));

  const c0 = String(params?.colorA ?? colors[(seed >>> 2) % Math.max(1, colors.length)] ?? "#0B1224");
  const c1 = String(params?.colorB ?? colors[(seed >>> 5) % Math.max(1, colors.length)] ?? "#174066");
  const c2 = String(params?.colorC ?? "#000000");

  const drift = Number(params?.drift ?? 0.12);
  const cx = w * (0.5 + Math.sin(t * (0.16 + low * 0.22) + seed * 0.0001) * drift);
  const cy = h * (0.5 + Math.cos(t * (0.13 + mid * 0.2) + seed * 0.00017) * drift);
  const r0 = Math.max(1, Math.min(w, h) * (0.08 + amp * 0.06 + onset * 0.04));
  const r1 = Math.max(r0 + 1, Math.max(w, h) * (0.74 + high * 0.14));

  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  g.addColorStop(0, hexToRgba(c0, 0.85 + amp * 0.12));
  g.addColorStop(0.58, hexToRgba(c1, 0.7 + mid * 0.15));
  g.addColorStop(1, hexToRgba(c2, 1));
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

