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

export function renderShockRings({
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
  const high = clamp01(Number(state?.signalBus?.reactive?.high ?? 0));
  const onset = clamp01(Number(state?.signalBus?.reactive?.onsetPulse ?? 0));
  const beat = clamp01(Number(state?.signalBus?.beat?.pulse ?? 0));
  const downbeat = clamp01(Number(state?.signalBus?.beat?.downbeatPulse ?? 0));

  const count = Math.max(2, Math.min(16, Math.round(Number(params?.ringCount ?? 6))));
  const speed = Math.max(0.05, Number(params?.speedHz ?? 0.42));
  const spread = Math.max(20, Number(params?.spreadPx ?? Math.min(w, h) * 0.4));
  const baseR = Math.max(8, Number(params?.baseRadiusPx ?? Math.min(w, h) * 0.06));
  const baseWidth = Math.max(0.6, Number(params?.thicknessPx ?? 1.6));
  const seedPhase = ((seed >>> 0) % 360) * (Math.PI / 180);
  const centerX = w * Number(params?.centerX ?? 0.5);
  const centerY = h * Number(params?.centerY ?? 0.5);
  const color = String(params?.color ?? colors[(seed >>> 4) % Math.max(1, colors.length)] ?? "#8ACFFF");

  ctx.save();
  ctx.globalCompositeOperation = String(params?.blend ?? "screen") as GlobalCompositeOperation;
  for (let i = 0; i < count; i += 1) {
    const phase = (t * speed + i / count + seedPhase * 0.1) % 1;
    const p = phase < 0 ? phase + 1 : phase;
    const envelope = Math.pow(1 - p, 1.8);
    const radius = baseR + p * spread * (1 + low * 0.16 + downbeat * 0.08);
    const alpha = clamp01((0.08 + envelope * (0.32 + high * 0.22)) * (1 + onset * 0.25 + beat * 0.12));
    const width = baseWidth * (1 + downbeat * 0.45 + onset * 0.2) * (1 + i / count * 0.18);
    ctx.strokeStyle = hexToRgba(color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

