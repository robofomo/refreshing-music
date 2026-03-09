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

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
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
}

registerBuiltins();
