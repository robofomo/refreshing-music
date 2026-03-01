import { normalizeSectionLabel } from "./sections";
import { renderRegisteredTransition } from "./transitionRegistry";

export type TransitionDef = {
  kind?: string;
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
  const p = clamp01(progress);

  clear(tempCtx, width, height);
  drawToFn(tempCtx);
  const toCanvas = tempCtx.canvas;

  clear(ctx, width, height);
  ctx.drawImage(fromCanvas, 0, 0, width, height);

  const handled = renderRegisteredTransition({
    ctx,
    width,
    height,
    fromCanvas,
    toCanvas,
    progress: p,
    seed,
    transitionDef: { ...transitionDef, kind: transitionDef?.kind ?? "crossfade" }
  });
  if (!handled) {
    renderRegisteredTransition({
      ctx,
      width,
      height,
      fromCanvas,
      toCanvas,
      progress: p,
      seed,
      transitionDef: { ...transitionDef, kind: "crossfade" }
    });
  }
}
