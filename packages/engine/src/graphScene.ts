import { createRng, hashStringToSeed } from "./rng";
import { resolveResolvable } from "./resolvable";

type GraphNode = {
  id?: string;
  type?: string;
  enabled?: boolean;
  params?: Record<string, any>;
};

type GraphLayer = {
  id?: string;
  blend?: GlobalCompositeOperation;
  opacity?: number;
  nodes?: GraphNode[];
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function pickFrom<T>(xs: T[], idxSeed: number, fallback: T) {
  if (!Array.isArray(xs) || xs.length === 0) return fallback;
  const i = Math.max(0, Math.min(xs.length - 1, idxSeed % xs.length));
  return xs[i];
}

function stableNodeSeed(seed: number, layerId: string, nodeId: string) {
  return (seed ^ hashStringToSeed(`${layerId}:${nodeId}`)) >>> 0;
}

function drawCirclePulse(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  colors: string[];
  tMs: number;
  amp: number;
  beat: number;
  downbeat: number;
  nodeSeed: number;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, colors, tMs, amp, beat, downbeat, nodeSeed, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = tMs / 1000;
  const ringCount = Math.max(3, Math.min(18, Number(params?.ringCount ?? 8)));
  const baseR = Math.max(12, Number(params?.radiusPx ?? Math.min(w, h) * 0.1));
  const rng = createRng(nodeSeed);
  for (let i = 0; i < ringCount; i += 1) {
    const u = i / Math.max(1, ringCount - 1);
    const phase = rng.float() * Math.PI * 2 + i * 0.6;
    const wobble = 1 + 0.13 * Math.sin(t * (0.6 + u * 0.8) + phase);
    const r = baseR * (1 + u * 2.4) * wobble * (1 + amp * 0.24 + downbeat * 0.26);
    const alpha = clamp01((Number(params?.alpha ?? 0.2) + (1 - u) * 0.15) * (1 + beat * 0.25));
    const color = pickFrom(colors, i + nodeSeed, "#8AC7FF");
    ctx.strokeStyle = color.replace(")", `, ${alpha})`).replace("rgb(", "rgba(");
    // Fallback for hex colors.
    if (!String(color).startsWith("rgb")) {
      const s = String(color).replace("#", "");
      const n = Number.parseInt((s.length >= 6 ? s.slice(0, 6) : s.padEnd(6, "0")), 16);
      const cr = (n >> 16) & 255;
      const cg = (n >> 8) & 255;
      const cb = n & 255;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`;
    }
    ctx.lineWidth = Math.max(1, 2.1 - u * 1.2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawOrbitRibbon(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  colors: string[];
  tMs: number;
  amp: number;
  beat: number;
  downbeat: number;
  nodeSeed: number;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, colors, tMs, amp, beat, downbeat, nodeSeed, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = tMs / 1000;
  const points = Math.max(16, Math.min(220, Number(params?.points ?? 56)));
  const radius = Math.max(24, Number(params?.radiusPx ?? Math.min(w, h) * 0.24));
  const thickness = Math.max(0.8, Number(params?.thicknessPx ?? 1.6) + beat * 0.9);
  const speedHz = Math.max(0.01, Number(params?.phaseHz ?? 0.08));
  const rng = createRng(nodeSeed);
  const seedPhase = rng.float() * Math.PI * 2;
  ctx.strokeStyle = pickFrom(colors, nodeSeed, "#89D6FF");
  if (!String(ctx.strokeStyle).startsWith("#")) ctx.globalAlpha = clamp01(0.42 + amp * 0.34 + downbeat * 0.1);
  else ctx.globalAlpha = clamp01(0.52 + amp * 0.32 + downbeat * 0.1);
  ctx.lineWidth = thickness;
  ctx.beginPath();
  for (let i = 0; i <= points; i += 1) {
    const u = i / points;
    const a = u * Math.PI * 2 + t * 2 * Math.PI * speedHz + seedPhase;
    const drift = 1 + 0.16 * Math.sin((3.4 + rng.float() * 1.1) * a + t * 0.45);
    const x = cx + Math.cos(a) * radius * drift;
    const y = cy + Math.sin(a) * radius * drift * (0.72 + 0.09 * Math.sin(t * 0.5));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawTextEcho(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  beat: number;
  downbeat: number;
  nodeSeed: number;
  params?: Record<string, any>;
  track?: any;
}) {
  const { ctx, canvas, tMs, beat, downbeat, nodeSeed, params, track } = args;
  const w = canvas.width;
  const h = canvas.height;
  const t = tMs / 1000;
  const fontPx = Math.max(16, Number(params?.fontPx ?? 34));
  const echoCount = Math.max(1, Math.min(14, Number(params?.echoCount ?? 4)));
  const driftPx = Math.max(0, Number(params?.driftPx ?? 12));
  const ly = Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines : [];
  let text = String(params?.text ?? "").trim();
  if (!text) {
    const active = ly.find((x: any) => Number.isFinite(Number(x?.t0Ms)) && Number.isFinite(Number(x?.t1Ms)) && tMs >= Number(x.t0Ms) && tMs < Number(x.t1Ms));
    if (typeof active?.i === "number") {
      const lines = String(track?.lyrics?.rawText ?? "").split(/\r?\n/);
      text = String(lines[active.i] ?? "").trim();
    }
  }
  if (!text) {
    const hm = track?.composer?.headerMap ?? {};
    text =
      String(hm?.["Song Title"] ?? "").trim() ||
      String(hm?.["Title"] ?? "").trim() ||
      String(track?.title ?? "").trim() ||
      "visual";
  }
  const rng = createRng(nodeSeed);
  const phase = rng.float() * Math.PI * 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;
  for (let i = echoCount; i >= 0; i -= 1) {
    const u = i / Math.max(1, echoCount);
    const alpha = clamp01(0.08 + (1 - u) * (0.22 + beat * 0.32));
    const y = h * 0.5 + Math.sin(t * 0.9 + phase + u * 1.8) * driftPx * (1 + downbeat * 0.3);
    ctx.fillStyle = `rgba(168, 226, 255, ${alpha})`;
    ctx.fillText(text, w * 0.5, y);
  }
}

function resolveNodeType(node: GraphNode) {
  const t = String(node?.type ?? "").trim();
  if (t) return t;
  return "shape.circlePulse";
}

function fallbackGraph(): GraphLayer[] {
  return [
    {
      id: "base",
      blend: "screen",
      opacity: 1,
      nodes: [
        { id: "pulse", type: "shape.circlePulse", params: { ringCount: 8, radiusPx: 88, alpha: 0.18 } },
        { id: "ribbon", type: "polyline.orbitRibbon", params: { points: 60, radiusPx: 170, thicknessPx: 1.7, phaseHz: 0.08 } }
      ]
    }
  ];
}

export function renderGraphScene({
  ctx,
  canvas,
  tMs,
  seed,
  state,
  recipe,
  colors
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  seed: number;
  state: any;
  recipe: any;
  colors: string[];
}) {
  const layers: GraphLayer[] = Array.isArray(recipe?.graph?.layers) && recipe.graph.layers.length
    ? recipe.graph.layers
    : fallbackGraph();
  const amp = Number(state?.amp ?? 0);
  const beat = Number(state?.signalBus?.beat?.pulse ?? 0);
  const downbeat = Number(state?.signalBus?.beat?.downbeatPulse ?? 0);

  for (const layer of layers) {
    if (layer?.opacity !== undefined && Number(layer.opacity) <= 0) continue;
    if (!Array.isArray(layer?.nodes) || !layer.nodes.length) continue;
    ctx.save();
    ctx.globalCompositeOperation = (layer?.blend ?? "source-over") as GlobalCompositeOperation;
    ctx.globalAlpha = clamp01(Number(layer?.opacity ?? 1));
    const layerId = String(layer.id || "layer");
    for (let i = 0; i < layer.nodes.length; i += 1) {
      const node = layer.nodes[i];
      if (node?.enabled === false) continue;
      const nodeId = String(node?.id || `${layerId}-${i}`);
      const nodeSeed = stableNodeSeed(seed, layerId, nodeId);
      const type = resolveNodeType(node);
      const resolvedParams = resolveResolvable(node?.params ?? {}, {
        tMs,
        seed: nodeSeed,
        state,
        path: `graph.${layerId}.${nodeId}.params`
      });
      if (type === "shape.circlePulse") {
        drawCirclePulse({
          ctx,
          canvas,
          colors,
          tMs,
          amp,
          beat,
          downbeat,
          nodeSeed,
          params: resolvedParams
        });
      } else if (type === "polyline.orbitRibbon") {
        drawOrbitRibbon({
          ctx,
          canvas,
          colors,
          tMs,
          amp,
          beat,
          downbeat,
          nodeSeed,
          params: resolvedParams
        });
      } else if (type === "text.echoWord") {
        drawTextEcho({
          ctx,
          canvas,
          tMs,
          beat,
          downbeat,
          nodeSeed,
          params: resolvedParams,
          track: state?.track
        });
      }
    }
    ctx.restore();
  }
}
