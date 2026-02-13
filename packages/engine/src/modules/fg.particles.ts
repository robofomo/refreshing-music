import { createRng, hashStringToSeed } from "../rng";

type Particle = {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  phase: number;
  color: string;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number) {
  return clamp(v, 0, 1);
}

function toRgba(hex: string, alpha: number) {
  const clean = String(hex || "#FFFFFF").replace("#", "");
  const str = clean.length >= 6 ? clean.slice(0, 6) : clean.padEnd(6, "0");
  const n = Number.parseInt(str, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

function buildParticles(
  seed: number,
  width: number,
  height: number,
  colors: string[],
  params?: Record<string, any>
) {
  const rng = createRng(seed ^ hashStringToSeed("fg.particles"));
  const count = Math.max(30, Math.min(350, Number(params?.count ?? (80 + Math.floor(rng.float() * 120)))));
  const minSize = Number(params?.sizeRange?.[0] ?? 1.5);
  const maxSize = Number(params?.sizeRange?.[1] ?? 4.8);
  const safeColors = colors.length ? colors : ["#E8F5FF", "#A8CFFF"];

  const out: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const color = safeColors[Math.floor(rng.float() * Math.min(2, safeColors.length)) % safeColors.length];
    out.push({
      x: rng.float() * width,
      y: rng.float() * height,
      size: minSize + rng.float() * Math.max(0.2, maxSize - minSize),
      speed: 0.5 + rng.float() * 1.7,
      drift: 0.2 + rng.float() * 0.9,
      phase: rng.float() * Math.PI * 2,
      color
    });
  }
  return out;
}

type CacheState = {
  seed: number;
  width: number;
  height: number;
  colorsKey: string;
  particles: Particle[];
  smoothAmp: number;
};

let cache: CacheState | null = null;

export function renderParticles({
  ctx,
  canvas,
  tMs,
  amp,
  colors,
  seed,
  params
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  amp?: number;
  colors: string[];
  seed: number;
  params?: Record<string, any>;
}) {
  const width = canvas.width;
  const height = canvas.height;
  const colorsKey = colors.join("|");
  if (
    !cache ||
    cache.seed !== seed ||
    cache.width !== width ||
    cache.height !== height ||
    cache.colorsKey !== colorsKey
  ) {
    cache = {
      seed,
      width,
      height,
      colorsKey,
      particles: buildParticles(seed, width, height, colors, params),
      smoothAmp: 0
    };
  }

  const speed = Number(params?.speed ?? 0.45);
  const curl = Number(params?.curl ?? 0.55);
  const baseOpacity = clamp01(Number(params?.opacity ?? 0.62));
  const ampIn = clamp01(Number(amp ?? 0));
  const ampTarget = clamp01(ampIn * 3.2);
  const maxStep = 0.025;
  const nextAmp = cache.smoothAmp + clamp(ampTarget - cache.smoothAmp, -maxStep, maxStep);
  cache.smoothAmp = nextAmp;
  const ampBoost = 1 + nextAmp * 0.55;

  ctx.save();
  const sec = tMs / 1000;
  const cx = width * 0.5;
  const cy = height * 0.5;
  for (let i = 0; i < cache.particles.length; i += 1) {
    const p = cache.particles[i];
    const baseDx = p.x - cx;
    const baseDy = p.y - cy;
    const radial =
      1 +
      Math.sin(sec * (0.22 + p.drift * 0.16) + p.phase) * (0.06 + curl * 0.06) +
      nextAmp * 0.16;
    const driftX = Math.sin(sec * (0.34 + speed * 0.22) + p.phase * 1.7) * (16 + 34 * p.drift) * (0.45 + curl);
    const driftY = Math.cos(sec * (0.31 + speed * 0.2) + p.phase * 1.2) * (14 + 28 * p.drift) * (0.45 + curl);
    const tx = cx + baseDx * radial + driftX;
    const ty = cy + baseDy * radial + driftY;
    const r = p.size * (1.02 + nextAmp * 0.8 + 0.12 * Math.sin(sec * (0.8 + p.drift * 0.4) + p.phase));
    const a = baseOpacity * (0.45 + 0.35 * Math.sin(sec * (0.7 + p.drift * 0.5) + p.phase)) * ampBoost;
    ctx.fillStyle = toRgba(p.color, clamp01(a));
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
