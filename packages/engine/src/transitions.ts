import { hashStringToSeed } from "./rng";
import { normalizeSectionLabel } from "./sections";

export type TransitionDef = {
  kind?: "crossfade" | "wipe" | "noiseDissolve";
  durationMs?: number;
  easing?: string;
  params?: Record<string, any>;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
export { normalizeSectionLabel };

function clear(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, w, h);
}

export function compositeTransition({
  ctx,
  width,
  height,
  fromCanvas,
  tempCtx,
  progress,
  transitionDef,
  drawToFn,
  seed
}: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  fromCanvas: CanvasImageSource;
  tempCtx: CanvasRenderingContext2D;
  progress: number;
  transitionDef?: TransitionDef;
  drawToFn: (c: CanvasRenderingContext2D) => void;
  seed: number;
}) {
  const kind = transitionDef?.kind ?? "crossfade";
  const p = clamp01(progress);

  clear(tempCtx, width, height);
  drawToFn(tempCtx);
  const toCanvas = tempCtx.canvas;

  clear(ctx, width, height);
  ctx.drawImage(fromCanvas, 0, 0, width, height);

  if (kind === "wipe") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, Math.floor(width * p), height);
    ctx.clip();
    ctx.drawImage(toCanvas, 0, 0, width, height);
    ctx.restore();
    return;
  }

  if (kind === "noiseDissolve") {
    const cell = Math.max(6, Number(transitionDef?.params?.cell ?? 9));
    const salt = hashStringToSeed("noiseDissolve") ^ seed;
    for (let y = 0; y < height; y += cell) {
      for (let x = 0; x < width; x += cell) {
        const h = ((Math.imul((x + 1), 73856093) ^ Math.imul((y + 1), 19349663) ^ salt) >>> 0) / 4294967295;
        if (h <= p) {
          const w = Math.min(cell, width - x);
          const hCell = Math.min(cell, height - y);
          ctx.drawImage(toCanvas, x, y, w, hCell, x, y, w, hCell);
        }
      }
    }
    return;
  }

  // crossfade default
  ctx.globalAlpha = p;
  ctx.drawImage(toCanvas, 0, 0, width, height);
  ctx.globalAlpha = 1;
}
