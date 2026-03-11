import { getCorrectedTimingWords } from "./lyricWordCorrection";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function hexToRgba(hex: string, alpha: number) {
  const clean = String(hex || "#B6E0FF").replace("#", "");
  const s = clean.length >= 6 ? clean.slice(0, 6) : clean.padEnd(6, "0");
  const n = Number.parseInt(s, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

export function renderWordTrails({
  ctx,
  canvas,
  tMs,
  track,
  params,
  state
}: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  track?: any;
  params?: Record<string, any>;
  state?: any;
}) {
  const words = getCorrectedTimingWords(track);
  if (!words.length) return;
  const now = Number(tMs);
  const cur = words.find((w: any) => Number.isFinite(Number(w?.t0Ms)) && Number.isFinite(Number(w?.t1Ms)) && now >= Number(w.t0Ms) && now < Number(w.t1Ms));
  if (!cur) return;

  const text = String(cur?.text ?? "").trim();
  if (!text) return;

  const w = canvas.width;
  const h = canvas.height;
  const reactive = state?.signalBus?.reactive ?? {};
  const src = String(params?.signalSource ?? "auto").toLowerCase();
  const master = reactive?.sources?.master ?? reactive;
  const backing = reactive?.sources?.backing ?? master;
  const vocals = reactive?.sources?.vocals ?? master;
  const vocalsActive = Number(reactive?.vocalsActive ?? 0);
  const chosen =
    src === "vocals"
      ? (vocalsActive > 0.05 ? vocals : backing)
      : src === "backing"
        ? backing
        : src === "master"
          ? master
          : (vocalsActive > 0.3 ? vocals : backing);
  const low = clamp01(Number(chosen?.low ?? master?.low ?? 0));
  const high = clamp01(Number(chosen?.high ?? master?.high ?? 0));
  const onset = clamp01(Number(chosen?.onsetPulse ?? master?.onsetPulse ?? 0));
  const beat = clamp01(Number(state?.signalBus?.beat?.pulse ?? 0));
  const downbeat = clamp01(Number(state?.signalBus?.beat?.downbeatPulse ?? 0));
  const conf = clamp01(Number.isFinite(Number(cur?.conf)) ? Number(cur.conf) : 0.75);
  const t0 = Number(cur.t0Ms);
  const t1 = Number(cur.t1Ms);
  const u = clamp01((now - t0) / Math.max(1, t1 - t0));

  const fontPx = Math.max(24, Number(params?.fontPx ?? 58) * (0.92 + downbeat * 0.08));
  const trailCount = Math.max(2, Math.min(12, Math.round(Number(params?.trailCount ?? 5))));
  const driftPx = Math.max(6, Number(params?.driftPx ?? 22)) * (0.8 + high * 0.5);
  const color = String(params?.color ?? "#B6E0FF");
  const x = w * Number(params?.x ?? 0.5);
  const y = h * Number(params?.y ?? 0.7);

  ctx.save();
  ctx.globalCompositeOperation = String(params?.blend ?? "screen") as GlobalCompositeOperation;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(fontPx)}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;

  for (let i = trailCount; i >= 1; i -= 1) {
    const k = i / trailCount;
    const dx = Math.sin(u * Math.PI * 2 + i * 0.7) * driftPx * k * 0.35;
    const dy = Math.cos(u * Math.PI * 2 + i * 0.5) * driftPx * k * 0.22;
    const a = (0.08 + (1 - k) * 0.24) * (0.7 + onset * 0.4 + beat * 0.2) * (0.55 + conf * 0.45);
    ctx.fillStyle = hexToRgba(color, a);
    ctx.fillText(text, x - dx, y - dy);
  }

  const mainAlpha = 0.72 + onset * 0.18 + low * 0.1;
  ctx.fillStyle = hexToRgba(color, mainAlpha);
  ctx.fillText(text, x, y);
  ctx.restore();
}
