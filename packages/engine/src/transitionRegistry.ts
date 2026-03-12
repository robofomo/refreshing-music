import { hashStringToSeed } from "./rng";

export type TransitionDefLike = {
  kind?: string;
  durationMs?: number;
  easing?: string;
  params?: Record<string, any>;
};

type TransitionRenderArgs = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  fromCanvas: CanvasImageSource;
  toCanvas: CanvasImageSource;
  progress: number;
  seed: number;
  transitionDef?: TransitionDefLike;
};

type TransitionRenderer = (args: TransitionRenderArgs) => void;

const registry = new Map<string, TransitionRenderer>();
let sampleCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let blendCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let sampleCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let blendCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hashUnit(seed: number, salt: string) {
  const h = (hashStringToSeed(salt) ^ (seed >>> 0)) >>> 0;
  return h / 4294967295;
}

function seededPick<T>(seed: number, salt: string, options: readonly T[]) {
  if (!options.length) throw new Error("seededPick requires options");
  const idx = Math.min(options.length - 1, Math.floor(hashUnit(seed, salt) * options.length));
  return options[idx];
}

function normalizeSchedule(params: Record<string, any>) {
  const raw = Array.isArray(params?.stepSchedule)
    ? params.stepSchedule.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x))
    : [];
  const out = raw
    .map((x: number) => clamp01(x))
    .sort((a: number, b: number) => a - b)
    .filter((x: number, i: number, arr: number[]) => i === 0 || Math.abs(x - arr[i - 1]) > 1e-6);
  if (!out.length || out[out.length - 1] < 1) out.push(1);
  return out;
}

function scheduledProgress(progress: number, params: Record<string, any>, seed: number, salt: string) {
  const p = clamp01(progress);
  const schedule = normalizeSchedule(params);
  if (!schedule.length || params?.useRhythmSteps !== true) return p;
  const modeRaw = String(params?.rhythmStepsMode ?? "seeded").toLowerCase();
  const mode = modeRaw === "seeded"
    ? seededPick(seed, `${salt}:rhythmMode`, ["hold", "blend"] as const)
    : modeRaw;
  let prev = 0;
  for (const cp of schedule) {
    if (p <= cp) {
      if (mode === "hold") return prev;
      const span = Math.max(1e-6, cp - prev);
      return clamp01(prev + (p - prev) / span * (cp - prev));
    }
    prev = cp;
  }
  return 1;
}

function steppedProgress(progress: number, params: Record<string, any>) {
  const p = clamp01(progress);
  const schedule = normalizeSchedule(params);
  if (!schedule.length || params?.useRhythmSteps !== true) return p;
  let prev = 0;
  for (const cp of schedule) {
    if (p <= cp) return prev;
    prev = cp;
  }
  return 1;
}

function curveProgress(progress: number, curveRaw: string) {
  const p = clamp01(progress);
  const curve = String(curveRaw || "smooth").toLowerCase();
  if (curve === "in" || curve === "easein") return p * p;
  if (curve === "out" || curve === "easeout") return 1 - (1 - p) * (1 - p);
  if (curve === "inout" || curve === "easeinout" || curve === "smooth" || curve === "smoothstep") {
    return p * p * (3 - 2 * p);
  }
  return p;
}

function rectPolygon(width: number, height: number) {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];
}

function dotPoint(point: { x: number; y: number }, nx: number, ny: number) {
  return point.x * nx + point.y * ny;
}

function clipPolygonHalfPlane(
  polygon: Array<{ x: number; y: number }>,
  nx: number,
  ny: number,
  threshold: number,
  keepBelow: boolean
) {
  const out: Array<{ x: number; y: number }> = [];
  if (!polygon.length) return out;
  const inside = (point: { x: number; y: number }) => keepBelow
    ? dotPoint(point, nx, ny) <= threshold
    : dotPoint(point, nx, ny) >= threshold;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const aInside = inside(a);
    const bInside = inside(b);
    if (aInside && bInside) {
      out.push(b);
      continue;
    }
    const da = dotPoint(a, nx, ny) - threshold;
    const db = dotPoint(b, nx, ny) - threshold;
    const denom = da - db;
    const t = Math.abs(denom) < 1e-6 ? 0 : da / denom;
    const hit = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
    if (aInside && !bInside) {
      out.push(hit);
    } else if (!aInside && bInside) {
      out.push(hit, b);
    }
  }
  return out;
}

function clipPolygonBand(
  width: number,
  height: number,
  nx: number,
  ny: number,
  minThreshold: number,
  maxThreshold: number
) {
  const a = clipPolygonHalfPlane(rectPolygon(width, height), nx, ny, maxThreshold, true);
  return clipPolygonHalfPlane(a, nx, ny, minThreshold, false);
}

function drawClippedPolygon(
  ctx: CanvasRenderingContext2D,
  polygon: Array<{ x: number; y: number }>,
  draw: () => void
) {
  if (polygon.length < 3) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i += 1) {
    ctx.lineTo(polygon[i].x, polygon[i].y);
  }
  ctx.closePath();
  ctx.clip();
  draw();
  ctx.restore();
}

function ensureSampler(width: number, height: number) {
  if (!sampleCanvas || !blendCanvas || !sampleCtx || !blendCtx) {
    const OffscreenCtor = (globalThis as any).OffscreenCanvas;
    if (typeof OffscreenCtor === "function") {
      sampleCanvas = new OffscreenCtor(width, height);
      blendCanvas = new OffscreenCtor(width, height);
      sampleCtx = sampleCanvas.getContext("2d");
      blendCtx = blendCanvas.getContext("2d");
    } else if (typeof document !== "undefined") {
      sampleCanvas = document.createElement("canvas");
      blendCanvas = document.createElement("canvas");
      sampleCtx = sampleCanvas.getContext("2d");
      blendCtx = blendCanvas.getContext("2d");
    }
  }
  if (!sampleCanvas || !blendCanvas || !sampleCtx || !blendCtx) return false;
  if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
    sampleCanvas.width = width;
    sampleCanvas.height = height;
  }
  if (blendCanvas.width !== width || blendCanvas.height !== height) {
    blendCanvas.width = width;
    blendCanvas.height = height;
  }
  return true;
}

export function registerTransition(kind: string, renderer: TransitionRenderer) {
  registry.set(String(kind || "").toLowerCase(), renderer);
}

export function renderRegisteredTransition(args: TransitionRenderArgs): boolean {
  const kind = String(args.transitionDef?.kind ?? "").toLowerCase();
  const renderer = registry.get(kind);
  if (!renderer) return false;
  renderer({ ...args, progress: clamp01(args.progress) });
  return true;
}

function registerBuiltins() {
  registerTransition("cut", ({ ctx, width, height, toCanvas }) => {
    ctx.drawImage(toCanvas, 0, 0, width, height);
  });

  registerTransition("crossfade", ({ ctx, width, height, toCanvas, progress }) => {
    ctx.globalAlpha = progress;
    ctx.drawImage(toCanvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
  });

  registerTransition("wipe", ({ ctx, width, height, toCanvas, progress }) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.floor(width * progress), height);
    ctx.clip();
    ctx.drawImage(toCanvas, 0, 0, width, height);
    ctx.restore();
  });

  registerTransition("noiseDissolve", ({ ctx, width, height, toCanvas, progress, seed, transitionDef }) => {
    const cell = Math.max(6, Number(transitionDef?.params?.cell ?? 9));
    const salt = hashStringToSeed("noiseDissolve") ^ seed;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        const h = ((Math.imul((x + 1), 73856093) ^ Math.imul((y + 1), 19349663) ^ salt) >>> 0) / 4294967295;
        if (h <= progress) {
          const w = Math.min(cell, width - x);
          const hCell = Math.min(cell, height - y);
          ctx.drawImage(toCanvas, x, y, w, hCell, x, y, w, hCell);
        }
      }
    }
  });

  registerTransition("sliceStepWipe", ({ ctx, width, height, toCanvas, progress, transitionDef }) => {
    const axis = String(transitionDef?.params?.axis ?? "x").toLowerCase() === "y" ? "y" : "x";
    const sliceCount = Math.max(2, Math.min(64, Number(transitionDef?.params?.slices ?? transitionDef?.params?.steps ?? 8)));
    const gapPx = Math.max(0, Math.min(8, Number(transitionDef?.params?.gapPx ?? 0)));
    const dirRaw = String(transitionDef?.params?.direction ?? "forward").toLowerCase();
    const reverse = dirRaw === "reverse" || dirRaw === "rtl" || dirRaw === "bottom-up";
    const orderMode = String(transitionDef?.params?.order ?? "forward").toLowerCase();
    const p = clamp01(progress);
    const rawSchedule = Array.isArray(transitionDef?.params?.stepSchedule)
      ? transitionDef?.params?.stepSchedule.map((x: any) => Number(x)).filter((x: number) => Number.isFinite(x))
      : [];
    const schedule = rawSchedule
      .map((x: number) => clamp01(x))
      .sort((a: number, b: number) => a - b)
      .filter((x: number, i: number, arr: number[]) => i === 0 || Math.abs(x - arr[i - 1]) > 1e-6);
    const checkpoints = schedule.length
      ? schedule
      : Array.from({ length: sliceCount }, (_, i) => (i + 1) / sliceCount);
    const reached = checkpoints.reduce((n, cp) => n + (p >= cp ? 1 : 0), 0);
    const activeSlices = Math.max(0, Math.min(sliceCount, reached));
    const span = axis === "x" ? width : height;
    const sliceSpan = span / sliceCount;
    const order = (() => {
      const base = Array.from({ length: sliceCount }, (_, i) => i);
      if (orderMode === "alternate") {
        const left: number[] = [];
        const right: number[] = [];
        for (let i = 0; i < base.length; i += 1) {
          if (i % 2 === 0) left.push(i);
          else right.push(i);
        }
        return [...left, ...right];
      }
      if (orderMode === "center-out") {
        const out: number[] = [];
        const mid = (sliceCount - 1) / 2;
        for (let k = 0; k < sliceCount; k += 1) {
          const dir = k % 2 === 0 ? -1 : 1;
          const d = Math.ceil(k / 2) * dir;
          const idx = Math.round(mid + d);
          if (idx >= 0 && idx < sliceCount) out.push(idx);
        }
        return out.length === sliceCount ? out : base;
      }
      return base;
    })();
    const drawSlice = (i: number, frac: number) => {
      const drawFrac = clamp01(frac);
      if (drawFrac <= 0) return;
      const seqIdx = Math.max(0, Math.min(sliceCount - 1, i));
      const ordered = order[seqIdx] ?? seqIdx;
      const idx = reverse ? (sliceCount - 1 - ordered) : ordered;
      const start = idx * sliceSpan;
      const usable = Math.max(0, sliceSpan - gapPx);
      const size = Math.max(0, usable * drawFrac);
      if (size <= 0) return;
      if (axis === "x") {
        ctx.drawImage(toCanvas, start, 0, size, height, start, 0, size, height);
      } else {
        ctx.drawImage(toCanvas, 0, start, width, size, 0, start, width, size);
      }
    };

    for (let i = 0; i < activeSlices; i += 1) drawSlice(i, 1);
  });

  registerTransition("directionalBlurWipe", ({ ctx, width, height, fromCanvas, toCanvas, progress, seed, transitionDef }) => {
    const params = transitionDef?.params ?? {};
    const angleDeg = Number.isFinite(Number(params?.angleDeg))
      ? Number(params.angleDeg)
      : seededPick(seed, "directionalBlurWipe:angle", [0, 30, 45, 60, 90, 120, 135, 150, 180, 225, 270, 315]);
    const blurSteps = Math.max(2, Math.min(16, Number(params?.blurSteps ?? (3 + Math.floor(hashUnit(seed, "directionalBlurWipe:steps") * 5)))));
    const strength = clamp01(Number(params?.strength ?? (0.2 + hashUnit(seed, "directionalBlurWipe:strength") * 0.28)));
    const curve = String(params?.curve ?? "smooth");
    const scheduled = scheduledProgress(progress, params, seed, "directionalBlurWipe");
    const held = steppedProgress(progress, params);
    const shaped = curveProgress(scheduled, curve);
    const heldShaped = curveProgress(held, curve);
    const rad = angleDeg * Math.PI / 180;
    const nx = Math.cos(rad);
    const ny = Math.sin(rad);
    const corners = rectPolygon(width, height);
    const projections = corners.map((point) => dotPoint(point, nx, ny));
    const minProj = Math.min(...projections);
    const maxProj = Math.max(...projections);
    const threshold = lerp(minProj, maxProj, shaped);
    const steppedThreshold = lerp(minProj, maxProj, heldShaped);
    const span = Math.max(1, maxProj - minProj);
    const trailSpan = span * strength;
    const bandFrac = clamp01(Number(params?.bandFrac ?? 0.1));
    const bandSpan = Math.max(span * 0.04, Math.min(span * 0.22, Math.max(width, height) * bandFrac));
    const bandSlices = Math.max(4, Math.min(18, Number(params?.bandSlices ?? 8)));

    drawClippedPolygon(ctx, clipPolygonHalfPlane(corners, nx, ny, threshold, true), () => {
      ctx.globalAlpha = 1;
      ctx.drawImage(toCanvas, 0, 0, width, height);
    });

    for (let slice = 0; slice < bandSlices; slice += 1) {
      const u0 = slice / bandSlices;
      const u1 = (slice + 1) / bandSlices;
      const bandMin = threshold - bandSpan * 0.5 + u0 * bandSpan;
      const bandMax = threshold - bandSpan * 0.5 + u1 * bandSpan;
      const polygon = clipPolygonBand(width, height, nx, ny, bandMin, bandMax);
      const alpha = clamp01((u0 + u1) * 0.5);
      drawClippedPolygon(ctx, polygon, () => {
        ctx.globalAlpha = alpha;
        ctx.drawImage(toCanvas, 0, 0, width, height);
      });
    }

    for (let step = blurSteps; step >= 1; step -= 1) {
      const lead = params?.useRhythmSteps === true ? steppedThreshold : threshold;
      const trailMax = lead - (step - 1) * trailSpan / blurSteps;
      const trailMin = lead - step * trailSpan / blurSteps;
      const polygon = clipPolygonBand(width, height, nx, ny, trailMin, trailMax);
      const offset = (trailSpan / blurSteps) * step * 0.45;
      const alpha = (0.1 + 0.18 * (1 - step / blurSteps)) * Math.max(0.25, strength);
      drawClippedPolygon(ctx, polygon, () => {
        ctx.globalAlpha = alpha;
        ctx.translate(-nx * offset, -ny * offset);
        ctx.drawImage(fromCanvas, 0, 0, width, height);
      });
    }
  });

  registerTransition("lumaDissolve", ({ ctx, width, height, toCanvas, fromCanvas, progress, seed, transitionDef }) => {
    const params = transitionDef?.params ?? {};
    const mode = String(params?.mode ?? seededPick(seed, "lumaDissolve:mode", ["mix", "to", "from"] as const)).toLowerCase();
    const curve = String(params?.curve ?? seededPick(seed, "lumaDissolve:curve", ["smooth", "in", "out"] as const));
    const grain = clamp01(Number(params?.grain ?? (0.08 + hashUnit(seed, "lumaDissolve:grain") * 0.24)));
    const invert = params?.invert === true;
    const scheduled = scheduledProgress(progress, params, seed, "lumaDissolve");
    const held = steppedProgress(progress, params);
    const shaped = curveProgress(scheduled, curve);
    const heldThreshold = invert ? (1 - curveProgress(held, curve)) : curveProgress(held, curve);
    const threshold = invert ? (1 - shaped) : shaped;
    const cell = Math.max(8, Math.min(18, Number(params?.cell ?? 10)));
    const cols = Math.max(1, Math.ceil(width / cell));
    const rows = Math.max(1, Math.ceil(height / cell));
    if (!ensureSampler(cols, rows) || !sampleCtx || !blendCtx) {
      ctx.globalAlpha = shaped;
      ctx.drawImage(toCanvas, 0, 0, width, height);
      ctx.globalAlpha = 1;
      return;
    }

    sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
    sampleCtx.clearRect(0, 0, cols, rows);
    blendCtx.setTransform(1, 0, 0, 1, 0, 0);
    blendCtx.clearRect(0, 0, cols, rows);

    if (mode === "from") {
      sampleCtx.drawImage(fromCanvas, 0, 0, cols, rows);
    } else if (mode === "to") {
      sampleCtx.drawImage(toCanvas, 0, 0, cols, rows);
    } else {
      blendCtx.globalAlpha = 0.5;
      blendCtx.drawImage(fromCanvas, 0, 0, cols, rows);
      blendCtx.drawImage(toCanvas, 0, 0, cols, rows);
      blendCtx.globalAlpha = 1;
      sampleCtx.drawImage(blendCanvas, 0, 0, cols, rows);
    }

    const image = sampleCtx.getImageData(0, 0, cols, rows).data;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const idx = (row * cols + col) * 4;
        const r = image[idx] ?? 0;
        const g = image[idx + 1] ?? 0;
        const b = image[idx + 2] ?? 0;
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        const noise = (hashUnit(seed ^ (col * 92821) ^ (row * 68917), "lumaDissolve:grain") - 0.5) * grain;
        const value = clamp01(luma + noise);
        const activeThreshold = params?.useRhythmSteps === true ? heldThreshold : threshold;
        const reveal = invert ? value >= activeThreshold : value <= activeThreshold;
        if (!reveal) continue;
        const x = col * cell;
        const y = row * cell;
        const w = Math.min(cell, width - x);
        const h = Math.min(cell, height - y);
        ctx.drawImage(toCanvas, x, y, w, h, x, y, w, h);
      }
    }
  });
}

registerBuiltins();
