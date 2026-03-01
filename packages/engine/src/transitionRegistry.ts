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
}

registerBuiltins();

