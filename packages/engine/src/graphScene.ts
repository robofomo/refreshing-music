import { createRng, hashStringToSeed } from "./rng";
import { resolveResolvable } from "./resolvable";
import { renderRegisteredModule } from "./moduleRegistry";

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

const spectrumBarsState = new Map<number, { lastTMs: number; levels: number[]; normLo: number; normHi: number }>();

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function pickFrom<T>(xs: T[], idxSeed: number, fallback: T) {
  if (!Array.isArray(xs) || xs.length === 0) return fallback;
  const i = Math.max(0, Math.min(xs.length - 1, idxSeed % xs.length));
  return xs[i];
}

function resolveReactiveSource(
  reactive: any,
  sourceRaw: any
): { low: number; mid: number; high: number; onsetPulse: number; ampFast: number } {
  const src = String(sourceRaw ?? "auto").toLowerCase();
  const master = reactive?.sources?.master ?? reactive ?? {};
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
  return {
    low: clamp01(Number(chosen?.low ?? master?.low ?? 0)),
    mid: clamp01(Number(chosen?.mid ?? master?.mid ?? 0)),
    high: clamp01(Number(chosen?.high ?? master?.high ?? 0)),
    onsetPulse: clamp01(Number(chosen?.onsetPulse ?? master?.onsetPulse ?? 0)),
    ampFast: clamp01(Number(chosen?.ampFast ?? master?.ampFast ?? 0))
  };
}

function resolveReactiveSeries(
  reactive: any,
  sourceRaw: any
): {
  low: number;
  mid: number;
  high: number;
  onsetPulse: number;
  ampFast: number;
  wave: number[];
  freq: number[];
  sourceId: "master" | "backing" | "vocals";
} {
  const src = String(sourceRaw ?? "auto").toLowerCase();
  const master = reactive?.sources?.master ?? reactive ?? {};
  const backing = reactive?.sources?.backing ?? master;
  const vocals = reactive?.sources?.vocals ?? master;
  const vocalsActive = Number(reactive?.vocalsActive ?? 0);
  const hasVocalsSeries = Array.isArray(vocals?.wave) && vocals.wave.length > 0;
  let sourceId: "master" | "backing" | "vocals" = "master";
  if (src === "backing") sourceId = "backing";
  else if (src === "vocals") sourceId = hasVocalsSeries ? "vocals" : "backing";
  else if (src === "master") sourceId = "master";
  else sourceId = vocalsActive > 0.3 ? "vocals" : "backing";
  const chosen = sourceId === "vocals" ? vocals : sourceId === "backing" ? backing : master;
  return {
    low: clamp01(Number(chosen?.low ?? master?.low ?? 0)),
    mid: clamp01(Number(chosen?.mid ?? master?.mid ?? 0)),
    high: clamp01(Number(chosen?.high ?? master?.high ?? 0)),
    onsetPulse: clamp01(Number(chosen?.onsetPulse ?? master?.onsetPulse ?? 0)),
    ampFast: clamp01(Number(chosen?.ampFast ?? master?.ampFast ?? 0)),
    wave: Array.isArray(chosen?.wave) ? chosen.wave : [],
    freq: Array.isArray(chosen?.freq) ? chosen.freq : [],
    sourceId
  };
}

function colorToRgba(color: string, alpha: number, fallback = [138, 199, 255] as [number, number, number]) {
  const c = String(color || "").trim();
  if (c.startsWith("rgb(") || c.startsWith("rgba(")) {
    return c.replace(")", `, ${clamp01(alpha)})`).replace("rgb(", "rgba(");
  }
  if (c.startsWith("#")) {
    const s = c.replace("#", "");
    const n = Number.parseInt((s.length >= 6 ? s.slice(0, 6) : s.padEnd(6, "0")), 16);
    const cr = (n >> 16) & 255;
    const cg = (n >> 8) & 255;
    const cb = n & 255;
    return `rgba(${cr},${cg},${cb},${clamp01(alpha)})`;
  }
  return `rgba(${fallback[0]},${fallback[1]},${fallback[2]},${clamp01(alpha)})`;
}

function resolveThemeState(state: any) {
  const theme = state?.signalBus?.theme ?? {};
  const beat = state?.signalBus?.beat ?? {};
  return {
    coherence: clamp01(Number(theme?.coherence ?? 0.6)),
    pressure: clamp01(Number(theme?.pressure ?? 0.25)),
    lyricActivity: clamp01(Number(theme?.lyricActivity ?? 0)),
    sectionEnergy: clamp01(Number(theme?.sectionEnergy ?? 0.4)),
    beatPulse: clamp01(Number(beat?.pulse ?? 0)),
    downbeatPulse: clamp01(Number(beat?.downbeatPulse ?? 0))
  };
}

function sectionStyleFactors(state: any) {
  const st = String(state?.sectionType ?? "").toLowerCase();
  if (st === "chorus") return { coherence: 1.14, pressure: 1.28, noise: 0.72, warp: 0.68, glitch: 0.62 };
  if (st === "bridge") return { coherence: 0.78, pressure: 1.22, noise: 1.4, warp: 1.45, glitch: 1.5 };
  if (st === "intro") return { coherence: 0.92, pressure: 0.8, noise: 1.08, warp: 1.06, glitch: 0.82 };
  if (st === "verse") return { coherence: 1.0, pressure: 1.0, noise: 1.0, warp: 1.0, glitch: 1.0 };
  if (st === "outro" || st === "ending") return { coherence: 1.08, pressure: 0.84, noise: 0.9, warp: 0.86, glitch: 0.76 };
  return { coherence: 1, pressure: 1, noise: 1, warp: 1, glitch: 1 };
}

function performanceDensityScale(state: any) {
  const v = Number(state?.signalBus?.perf?.densityScale ?? 1);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.45, Math.min(1, v));
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
  state?: any;
}) {
  const { ctx, canvas, colors, tMs, amp, beat, downbeat, nodeSeed, params, state } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = tMs / 1000;
  const ringCountBase = Math.max(3, Math.min(18, Number(params?.ringCount ?? 8)));
  const ringCount = Math.max(3, Math.round(ringCountBase * performanceDensityScale(state)));
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
  reactive?: {
    ampFast?: number;
    ampSlow?: number;
    low?: number;
    mid?: number;
    high?: number;
    onsetPulse?: number;
  };
  state?: any;
  nodeSeed: number;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, colors, tMs, amp, beat, downbeat, reactive, state, nodeSeed, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = tMs / 1000;
  const rr = resolveReactiveSource(reactive, params?.signalSource ?? "auto");
  const low = rr.low;
  const mid = rr.mid;
  const high = rr.high;
  const onset = rr.onsetPulse;
  const rhythm = state?.signalBus?.rhythm;
  const rhythmGrid = clamp01(Number(rhythm?.lanes?.grid?.pulse ?? 0));
  const rhythmMotion = clamp01(Number(rhythm?.lanes?.motion?.pulse ?? 0));
  const rhythmAccent = clamp01(Number(rhythm?.lanes?.accent?.pulse ?? 0));
  const pointsBase = Math.max(16, Math.min(220, Number(params?.points ?? 56)));
  const points = Math.max(16, Math.round(pointsBase * performanceDensityScale(state)));
  const perfScale = performanceDensityScale(state);
  const revSeed = 1 + ((nodeSeed >>> 5) % 5);
  const revByPerf = Math.max(1, 1 + Math.floor(perfScale * 4));
  const revolutions = Math.max(
    1,
    Math.min(5, Math.min(Math.round(Number(params?.revolutions ?? revSeed)), revByPerf))
  );
  const pathPoints = Math.max(24, Math.min(1200, Math.round(points * (0.6 + revolutions * 0.8))));
  const radius = Math.max(24, Number(params?.radiusPx ?? Math.min(w, h) * 0.24));
  const thickness = Math.max(0.8, Number(params?.thicknessPx ?? 1.6) + beat * 0.9);
  const speedHz = Math.max(0.01, Number(params?.phaseHz ?? 0.08));
  const rng = createRng(nodeSeed);
  const seedPhase = rng.float() * Math.PI * 2;
  const modeRaw = String(params?.animationMode ?? "auto").toLowerCase();
  const mode = modeRaw === "auto"
    ? (["flow", "pulse-rotate", "drift"][nodeSeed % 3] as "flow" | "pulse-rotate" | "drift")
    : (modeRaw as "flow" | "pulse-rotate" | "drift");
  const profileRaw = String(params?.motionProfile ?? "auto").toLowerCase();
  const profile = profileRaw === "auto"
    ? (["elastic", "wobble", "precess", "breathe"][Math.floor((nodeSeed >>> 3) % 4)] as "elastic" | "wobble" | "precess" | "breathe")
    : (profileRaw as "elastic" | "wobble" | "precess" | "breathe");
  const audioWarp = 1 + amp * 0.6 + mid * 0.25 + downbeat * 0.18 + onset * 0.08 + rhythmMotion * 0.08;
  const tempoMul = mode === "pulse-rotate" ? 0.72 : mode === "drift" ? (1.02 + high * 0.08) : (1 + low * 0.05);
  const phaseBeatPush = mode === "pulse-rotate"
    ? (downbeat * 0.08 + beat * 0.03 + rhythmAccent * 0.03)
    : (beat * 0.015 + onset * 0.03 + rhythmGrid * 0.025);
  const radiusBoostBase = mode === "pulse-rotate"
    ? (1 + amp * 0.1 + high * 0.08 + beat * 0.11 + downbeat * 0.09 + rhythmAccent * 0.08)
    : (1 + amp * 0.12 + low * 0.1 + beat * 0.07 + rhythmGrid * 0.07);
  const yAxisScale = mode === "drift"
    ? (0.72 + 0.18 * Math.sin(t * (0.33 + mid * 0.5) + seedPhase))
    : (0.68 + 0.14 * Math.sin(t * (0.45 + high * 0.9) + seedPhase * 0.5));
  const driftFreqMul = mode === "drift" ? 2.2 : mode === "pulse-rotate" ? 1.1 : 1.6;
  const driftAmp = mode === "pulse-rotate"
    ? (0.12 + high * 0.1 + onset * 0.05)
    : (0.13 + mid * 0.12 + onset * 0.04);
  const profileNudge =
    profile === "elastic"
      ? Math.sin(t * (0.7 + low * 1.2)) * (0.06 + low * 0.04)
      : profile === "wobble"
        ? Math.sin(t * (1.4 + high * 1.6) + seedPhase) * (0.05 + high * 0.06)
        : profile === "precess"
          ? Math.sin(t * (0.26 + mid * 0.4) + seedPhase * 0.7) * 0.04
          : Math.sin(t * (0.18 + low * 0.22) + seedPhase * 0.35) * 0.08;
  ctx.strokeStyle = pickFrom(colors, nodeSeed, "#89D6FF");
  const cueBoost = rhythmMotion * 0.35 + rhythmAccent * 0.22 + rhythmGrid * 0.12;
  if (!String(ctx.strokeStyle).startsWith("#")) ctx.globalAlpha = clamp01(0.44 + amp * 0.24 + downbeat * 0.1 + cueBoost * 0.22);
  else ctx.globalAlpha = clamp01(0.52 + amp * 0.22 + downbeat * 0.1 + cueBoost * 0.2);
  ctx.lineWidth = thickness * (1 + amp * 0.2 + cueBoost * 0.65);
  ctx.beginPath();
  const driftBaseFreq = 3.4 + rng.float() * 1.1;
  const driftPhase = seedPhase * (0.8 + rng.float() * 0.6);
  const cueHold = Math.max(0, Math.min(0.7, Number(params?.cueHold ?? 0.46)));
  const cueGate = 1 - rhythmMotion * cueHold;
  for (let i = 0; i <= pathPoints; i += 1) {
    const u = i / pathPoints;
    const a = u * Math.PI * 2 * revolutions + t * 2 * Math.PI * speedHz * audioWarp * tempoMul * cueGate + seedPhase + phaseBeatPush;
    // Use periodic, continuous drift so the stroke stays smooth and avoids seam spikes.
    const drift = 1 + driftAmp * Math.sin(driftBaseFreq * a * driftFreqMul + t * (0.45 + amp * 0.45) + driftPhase);
    const radiusBoost =
      radiusBoostBase +
      cueBoost * 0.32 +
      profileNudge +
      (mode === "drift" ? 0.03 * Math.sin(t * (0.35 + mid * 0.2) + u * Math.PI * 2) : 0) +
      (profile === "wobble" ? 0.035 * Math.sin(u * Math.PI * 8 + t * (0.3 + high * 0.6) + seedPhase) : 0) +
      (profile === "precess" ? 0.025 * Math.cos(t * (0.2 + low * 0.2) + u * Math.PI * 2) : 0);
    const x = cx + Math.cos(a) * radius * radiusBoost * drift;
    const y = cy + Math.sin(a) * radius * radiusBoost * drift * yAxisScale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawBeatTrackOverlay(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, state, params } = args;
  const durationSec = Number(state?.signalBus?.time?.durationSec ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const offsetMs = Number(state?.signalBus?.time?.offsetMs ?? 0);
  const beats = Array.isArray(state?.beatTrack?.beatsMs) ? state.beatTrack.beatsMs : [];
  const downs = new Set(
    (Array.isArray(state?.beatTrack?.downbeatsMs) ? state.beatTrack.downbeatsMs : [])
      .map((x: any) => Math.round(Number(x)))
      .filter((x: number) => Number.isFinite(x))
  );

  const h = canvas.height;
  const y0 = h - Math.max(56, Number(params?.topInsetPx ?? 44));
  const y1 = h - Math.max(8, Number(params?.bottomInsetPx ?? 8));
  const beatColor = String(params?.beatColor ?? "#777777");
  const downColor = String(params?.downbeatColor ?? "#C8C8C8");
  const playheadColor = String(params?.playheadColor ?? "#000000");
  const alpha = clamp01(Number(params?.alpha ?? 0.88));

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = alpha;
  for (const raw of beats) {
    const ms = Math.round(Number(raw));
    if (!Number.isFinite(ms)) continue;
    const tSec = Math.max(0, Math.min(durationSec, ms / 1000 + offsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    const isDown = downs.has(ms);
    ctx.strokeStyle = isDown ? downColor : beatColor;
    ctx.lineWidth = isDown ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }

  const playheadSec = Math.max(0, Math.min(durationSec, Number(state?.signalBus?.time?.currentSec ?? 0) + offsetMs / 1000));
  const playheadX = Math.max(0, Math.min(canvas.width, (playheadSec / durationSec) * canvas.width));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = playheadColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, y0 - 2);
  ctx.lineTo(playheadX, y1 + 2);
  ctx.stroke();
  ctx.restore();
}

function drawWaveStrip(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  colors: string[];
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, colors, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const rr = resolveReactiveSeries(state?.signalBus?.reactive, "master");
  const wave = rr.wave;
  const lineCopies = Math.max(1, Math.min(8, Math.round(Number(params?.lineCopies ?? 4))));
  const lineWidth = Math.max(0.6, Math.min(4, Number(params?.lineWidth ?? 1.6)));
  const alphaMulBase = Math.max(0.08, Math.min(2, Number(params?.alphaMul ?? 0.28)));
  const smooth = clamp01(Number(params?.smooth ?? 0.08));
  const zoom = Math.max(0.5, Math.min(2.4, Number(params?.zoom ?? 1.0)));
  const rng = createRng(nodeSeed ^ hashStringToSeed("viz.waveRing"));
  const baseColor = pickFrom(colors, nodeSeed, "#8AC7FF");
  const blend = String(params?.blend ?? "screen");
  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);
  const radiusRel = Number.isFinite(Number(params?.radiusRel))
    ? Math.max(0.25, Math.min(0.375, Number(params?.radiusRel)))
    : (0.25 + rng.float() * 0.125); // diameter ~ 0.5..0.75 of window height
  const waveRel = Number.isFinite(Number(params?.waveHeightRel))
    ? Math.max(0.1, Math.min(0.3, Number(params?.waveHeightRel)))
    : (0.1 + rng.float() * 0.2); // spoke height ~ 0.1..0.3 of window height
  const radius = Math.max(h * 0.25, Math.min(h * 0.375, Number(params?.radiusPx ?? (h * radiusRel))));
  const waveHeight = Math.max(h * 0.1, Math.min(h * 0.3, Number(params?.waveHeightPx ?? (h * waveRel))));
  const ampGain = 0.8 + rr.ampFast * 0.9 + rr.onsetPulse * 0.22;
  const yAmp = waveHeight * ampGain;
  const samples = Math.max(98, Math.min(672, Math.round(Number(params?.samples ?? 294) * performanceDensityScale(state))));
  const phaseShift = -Math.PI * 0.5; // fixed seam at top (12 o'clock)
  const span = Math.max(0.08, Math.min(1, 1 / zoom));
  const start = (1 - span) * 0.5;
  const innerColor = pickFrom(colors, nodeSeed + 9, "#FF4F7A");
  ctx.save();
  ctx.globalCompositeOperation = blend as GlobalCompositeOperation;
  for (let pass = 0; pass < lineCopies; pass += 1) {
    const uPass = pass / Math.max(1, lineCopies - 1);
    const passAlpha = clamp01((0.2 + (1 - uPass) * 0.42) * alphaMulBase);
    const passW = lineWidth * (1 + (1 - uPass) * 0.7);
    const jitter = rng.float() * 0.22 + uPass * 0.12;
    const drawSpokes = (strokeColor: string, sign: 1 | -1, alphaMul = 1) => {
      ctx.strokeStyle = colorToRgba(strokeColor, passAlpha * alphaMul);
      ctx.lineWidth = passW;
      ctx.beginPath();
      for (let i = 0; i <= samples; i += 1) {
        const u = i / Math.max(1, samples);
        const theta = u * Math.PI * 2 + phaseShift + jitter;
        let yN = 0;
        if (wave.length > 4) {
          const pos = start + u * span;
          const idxF = pos * Math.max(1, wave.length - 1);
          const idx0 = Math.max(0, Math.min(wave.length - 1, Math.floor(idxF)));
          const idx1 = Math.max(0, Math.min(wave.length - 1, idx0 + 1));
          const uf = idxF - idx0;
          const a = Number(wave[idx0] ?? 0);
          const b = Number(wave[idx1] ?? a);
          yN = a + (b - a) * uf;
        } else {
          yN = Math.sin(u * Math.PI * 8 + phaseShift) * (0.35 + rr.mid * 0.45);
        }
        const ySmooth = yN * (1 - smooth) + Math.sin(theta * (3 + rr.high * 4)) * smooth * 0.25;
        const disp = sign * ySmooth * yAmp * (1 - uPass * 0.15);
        const x0 = cx + Math.cos(theta) * radius;
        const y0 = cy + Math.sin(theta) * radius;
        const x1 = cx + Math.cos(theta) * (radius + disp);
        const y1 = cy + Math.sin(theta) * (radius + disp);
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    };
    drawSpokes(baseColor, 1, 1);
    drawSpokes(innerColor, -1, 0.85);
  }
  ctx.restore();
}

function drawSpectrumBars(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  colors: string[];
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, colors, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const rr = resolveReactiveSeries(state?.signalBus?.reactive, params?.signalSource ?? "auto");
  const freq = rr.freq;
  const bars = Math.max(8, Math.min(96, Math.round(Number(params?.barCount ?? 36) * performanceDensityScale(state))));
  const marginPx = Math.max(8, Math.min(w * 0.22, Number(params?.marginPx ?? 24)));
  const usableW = Math.max(36, w - marginPx * 2);
  const bottomPad = Math.max(8, Math.min(96, Number(params?.bottomPadPx ?? 14)));
  const topRel = Math.max(0.22, Math.min(0.86, Number(params?.topRel ?? 0.41)));
  const maxH = Math.max(24, h * topRel - bottomPad);
  const gapPx = Math.max(2, Math.min(14, Number(params?.gapPx ?? 4)));
  const smooth = clamp01(Number(params?.smooth ?? 0.45));
  const bandSmoothing = clamp01(Number(params?.bandSmoothing ?? 0.1));
  const slotW = usableW / bars;
  const barW = Math.max(1, slotW - gapPx);
  const floorY = h - bottomPad;
  const baseColorA = pickFrom(colors, nodeSeed + 3, "#58D7FF");
  const alpha = clamp01(Number(params?.alpha ?? 0.44));
  const edgeTaper = clamp01(Number(params?.edgeTaper ?? 0.16));
  const responseSpan = Math.max(0.2, Math.min(1, Number(params?.responseSpan ?? 0.75)));
  const pixelSize = Math.max(2, Math.round(Number(params?.pixelSize ?? barW)));
  const rows = Math.max(4, Math.floor(maxH / pixelSize));
  const decayPerSec = Math.max(0.05, Math.min(2.2, Number(params?.falloffPerSec ?? 0.42)));
  const attackPerSec = Math.max(1, Math.min(40, Number(params?.attackPerSec ?? 18)));
  const minBin = Math.max(1, Math.floor(Number(params?.minBin ?? 2)));
  const spectralTilt = Math.max(-1.5, Math.min(1.5, Number(params?.spectralTilt ?? 0.2)));
  const meterGain = Math.max(0.2, Math.min(6, Number(params?.meterGain ?? 1.0)));
  const meterFloor = Math.max(0, Math.min(0.5, Number(params?.meterFloor ?? 0)));
  const meterCeil = Math.max(0.2, Math.min(1, Number(params?.meterCeil ?? 0.88)));
  const gradientStops = [
    [50, 170, 255],   // cool blue
    [68, 230, 220],   // cyan-green
    [150, 240, 120],  // warm-green
    [255, 210, 70],   // yellow
    [255, 140, 35],   // orange
    [255, 245, 215]   // bright warm top
  ] as Array<[number, number, number]>;
  const gradColor = (u: number) => {
    const x = Math.max(0, Math.min(1, u)) * (gradientStops.length - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(gradientStops.length - 1, i0 + 1);
    const f = x - i0;
    const c0 = gradientStops[i0];
    const c1 = gradientStops[i1];
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);
    return [r, g, b] as [number, number, number];
  };

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  let levelState = spectrumBarsState.get(nodeSeed);
  if (!levelState || levelState.levels.length !== bars) {
    levelState = { lastTMs: tMs, levels: Array.from({ length: bars }, () => 0), normLo: 0.01, normHi: 0.12 };
    spectrumBarsState.set(nodeSeed, levelState);
  }
  let dtSec = (tMs - levelState.lastTMs) / 1000;
  if (!Number.isFinite(dtSec) || dtSec < 0 || dtSec > 1.5) {
    dtSec = 0;
    levelState.levels.fill(0);
  }
  levelState.lastTMs = tMs;

  const bandEnergy = new Array<number>(bars).fill(0);
  if (freq.length > 4) {
    const maxBin = Math.max(minBin + 1, Math.floor((freq.length - 1) * responseSpan));
    const ratio = Math.max(1.0001, maxBin / minBin);
    for (let i = 0; i < bars; i += 1) {
      const loF = minBin * Math.pow(ratio, i / bars);
      const hiF = minBin * Math.pow(ratio, (i + 1) / bars);
      const b0 = Math.max(0, Math.min(freq.length - 1, Math.floor(loF)));
      const b1 = Math.max(b0 + 1, Math.min(freq.length, Math.ceil(hiF)));
      let sumSq = 0;
      for (let b = b0; b < b1; b += 1) {
        const v = Number(freq[b] ?? 0);
        sumSq += v * v;
      }
      let rms = Math.sqrt(sumSq / Math.max(1, b1 - b0));
      const centerBin = (b0 + b1 - 1) * 0.5;
      const centerNorm = Math.max(0.0001, centerBin / Math.max(1, maxBin));
      rms *= Math.pow(centerNorm, spectralTilt);
      bandEnergy[i] = clamp01(rms);
    }
    if (bandSmoothing > 0) {
      const smoothed = bandEnergy.slice();
      for (let i = 0; i < bars; i += 1) {
        const l = bandEnergy[Math.max(0, i - 1)];
        const c = bandEnergy[i];
        const r = bandEnergy[Math.min(bars - 1, i + 1)];
        const blur = l * 0.2 + c * 0.6 + r * 0.2;
        smoothed[i] = c * (1 - bandSmoothing) + blur * bandSmoothing;
      }
      for (let i = 0; i < bars; i += 1) bandEnergy[i] = smoothed[i];
    }
  }

  const rawEnergy = new Array<number>(bars).fill(0);
  for (let i = 0; i < bars; i += 1) {
    const u = i / Math.max(1, bars - 1);
    let e = 0;
    if (freq.length > 4) {
      e = bandEnergy[i];
    } else {
      e = (rr.low * (1 - u) + rr.mid * 0.55 + rr.high * u) / 2;
    }
    if (edgeTaper > 0) {
      const tEdge = Math.sin(Math.PI * u);
      const keep = 1 - edgeTaper + edgeTaper * Math.max(0, tEdge);
      e *= keep;
    }
    rawEnergy[i] = clamp01(Math.max(0, e));
  }
  const sorted = rawEnergy.slice().sort((a, b) => a - b);
  const qAt = (q: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1))))] ?? 0;
  const targetLo = qAt(0.12);
  const targetHi = Math.max(targetLo + 0.03, qAt(0.92));
  const loFollowPerSec = Math.max(0.2, Math.min(15, Number(params?.normLoFollowPerSec ?? 2.2)));
  const hiRisePerSec = Math.max(0.2, Math.min(20, Number(params?.normHiRisePerSec ?? 10)));
  const hiFallPerSec = Math.max(0.05, Math.min(8, Number(params?.normHiFallPerSec ?? 1.2)));
  const loLerp = 1 - Math.exp(-loFollowPerSec * dtSec);
  levelState.normLo = levelState.normLo + (targetLo - levelState.normLo) * loLerp;
  const hiRate = targetHi > levelState.normHi ? hiRisePerSec : hiFallPerSec;
  const hiLerp = 1 - Math.exp(-hiRate * dtSec);
  levelState.normHi = levelState.normHi + (targetHi - levelState.normHi) * hiLerp;
  levelState.normHi = Math.max(levelState.normLo + 0.02, levelState.normHi);

  const normalizedLevels: number[] = new Array(bars).fill(0);
  for (let i = 0; i < bars; i += 1) {
    const u = i / Math.max(1, bars - 1);
    const x = marginPx + i * slotW + (slotW - barW) * 0.5;
    const eNorm = clamp01((rawEnergy[i] - levelState.normLo) / Math.max(0.02, levelState.normHi - levelState.normLo));
    normalizedLevels[i] = eNorm;
    const prev = levelState.levels[i] ?? 0;
    const rise = eNorm > prev ? (1 - Math.exp(-attackPerSec * dtSec)) : 0;
    const attacked = eNorm > prev ? (prev + (eNorm - prev) * rise) : prev;
    const held = eNorm >= prev ? attacked : eNorm;
    levelState.levels[i] = held;
    const eVis = clamp01(((held * meterGain - meterFloor) / Math.max(0.0001, 1 - meterFloor)) * meterCeil);
    for (let row = 0; row < rows; row += 1) {
      const yNorm = rows <= 1 ? 1 : row / Math.max(1, rows - 1);
      const y = floorY - (row + 1) * pixelSize;
      if (y + pixelSize < floorY - maxH) continue;
      const soft = 0.04 + 0.05 * (1 - yNorm);
      const on = eVis >= (yNorm - soft);
      if (!on) continue;
      const warm = yNorm;
      const [gr, gg, gb] = gradColor(warm);
      const pAlpha = alpha * (0.42 + warm * 0.58);
      ctx.fillStyle = `rgba(${gr},${gg},${gb},${clamp01(pAlpha)})`;
      ctx.fillRect(x, y, barW, pixelSize - 1);
    }
  }
  if (state?.signalBus?.reactive) {
    const out = (state.signalBus.reactive.normalizedBands ||= {});
    out[rr.sourceId] = {
      levels: normalizedLevels.slice(),
      tMs,
      bars
    };
  }
  // subtle base glow keeps low levels readable
  ctx.fillStyle = colorToRgba(baseColorA, alpha * 0.18, [100, 185, 255]);
  ctx.fillRect(marginPx, floorY + 1, usableW, 2);
  ctx.restore();
}

function drawResponsiveRings(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  colors: string[];
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, colors, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const rr = resolveReactiveSeries(state?.signalBus?.reactive, params?.signalSource ?? "auto");
  const beat = clamp01(Number(state?.signalBus?.beat?.pulse ?? 0));
  const downbeat = clamp01(Number(state?.signalBus?.beat?.downbeatPulse ?? 0));
  const freq = rr.freq;
  const perfScale = performanceDensityScale(state);
  const areaScale = Math.max(0.62, Math.min(1.2, Math.sqrt((w * h) / (1280 * 720))));
  const rings = Math.max(2, Math.min(20, Math.round(Number(params?.ringCount ?? 7) * perfScale * areaScale)));
  const points = Math.max(40, Math.min(320, Math.round(Number(params?.points ?? 136) * perfScale * areaScale)));
  const baseR = Math.max(16, Math.min(Math.min(w, h) * 0.46, Number(params?.baseRadiusPx ?? Math.min(w, h) * 0.11)));
  const gapR = Math.max(8, Math.min(Math.min(w, h) * 0.25, Number(params?.gapPx ?? 30)));
  const alpha = clamp01(Number(params?.alpha ?? 0.46));
  const lineWidth = Math.max(0.6, Math.min(4, Number(params?.lineWidth ?? 1.2)));
  const warp = Math.max(0.05, Math.min(2.4, Number(params?.warp ?? 0.88)));
  const t = tMs / 1000;
  const rotHz = Math.max(-0.5, Math.min(0.5, Number(params?.rotateHz ?? 0.03)));
  const lowFirst = ((nodeSeed >>> 2) & 1) === 0;
  const sharedLevels = Array.isArray(state?.signalBus?.reactive?.normalizedBands?.[rr.sourceId]?.levels)
    ? state.signalBus.reactive.normalizedBands[rr.sourceId].levels
    : null;

  ctx.save();
  ctx.globalCompositeOperation = String(params?.blend ?? "screen") as GlobalCompositeOperation;
  for (let ri = 0; ri < rings; ri += 1) {
    const uRing = ri / Math.max(1, rings - 1);
    const ringR = baseR + ri * gapR * (1 + downbeat * 0.12);
    const ringColor = pickFrom(colors, nodeSeed + ri * 7, "#90D8FF");
    const ringAlpha = clamp01(alpha * (0.35 + (1 - uRing) * 0.75));
    const phase = (nodeSeed % 47) * 0.11 + ri * 0.28 + t * Math.PI * 2 * rotHz;
    const bandU = lowFirst ? uRing : (1 - uRing);
    let band = 0;
    if (sharedLevels && sharedLevels.length > 0) {
      const bi = Math.max(0, Math.min(sharedLevels.length - 1, Math.round(bandU * (sharedLevels.length - 1))));
      band = clamp01(Number(sharedLevels[bi] ?? 0));
    } else {
      const bandIdx = Math.max(0, Math.min(Math.max(0, freq.length - 1), Math.round(bandU * Math.max(0, freq.length - 1))));
      band = clamp01(Number(freq[bandIdx] ?? (rr.low * (1 - bandU) + rr.high * bandU)));
    }
    const lobesBase = 3 + ((nodeSeed + ri * 13) % 7);
    const lobes = Math.max(2, lobesBase + Math.round((band - 0.5) * 3));
    const subLobes = Math.max(2, lobes + 2 + (ri % 3));
    const ampMain = (5 + ringR * 0.18 * warp) * (0.22 + band * 1.15);
    const ampSub = ampMain * (0.22 + 0.25 * band);
    const ringSpin = t * (0.35 + band * 0.65) + ri * 0.17;
    ctx.strokeStyle = colorToRgba(ringColor, ringAlpha);
    ctx.lineWidth = lineWidth * (1 + (1 - uRing) * 0.4 + beat * 0.25);
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const u = i / Math.max(1, points);
      const a = u * Math.PI * 2 + phase;
      const mod =
        Math.sin(a * lobes + ringSpin) * ampMain +
        Math.sin(a * subLobes - ringSpin * 1.2 + phase * 0.7) * ampSub +
        rr.onsetPulse * (2 + 5 * (1 - uRing));
      const r = Math.max(4, ringR + mod);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSignalNoiseBlend(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  colors: string[];
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, colors, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const rng = createRng(nodeSeed ^ hashStringToSeed("field.signalNoiseBlend"));
  const t = tMs / 1000;
  const theme = resolveThemeState(state);
  const sectionMul = sectionStyleFactors(state);
  const perfScale = performanceDensityScale(state);
  const pointCountBase = Math.max(40, Math.min(420, Math.round(Number(params?.pointCount ?? 160))));
  const lineCountBase = Math.max(4, Math.min(120, Math.round(Number(params?.lineCount ?? 24))));
  const pointCount = Math.max(30, Math.round(pointCountBase * perfScale));
  const lineCount = Math.max(3, Math.round(lineCountBase * perfScale));
  const driftPx = Math.max(0, Math.min(80, Number(params?.driftPx ?? 16)));
  const noiseOpacity = clamp01(Number(params?.noiseOpacity ?? 0.2));
  const lineOpacity = clamp01(Number(params?.lineOpacity ?? 0.16));
  const coherence = clamp01(theme.coherence * sectionMul.coherence);
  const pressure = clamp01(theme.pressure * sectionMul.pressure);
  const blend = clamp01(((1 - coherence) * 0.75 + pressure * 0.25) * sectionMul.noise);
  // Slow state morph: particles become lines and lines become particles over time.
  const morph = (Math.sin(t * 0.12 + (nodeSeed % 37) * 0.17) + 1) * 0.5;
  const pointMix = 1 - 0.35 * morph;
  const lineMix = 1 + 0.35 * morph;
  const effectivePoints = Math.max(24, Math.round(pointCount * pointMix));
  const effectiveLines = Math.max(3, Math.round(lineCount * lineMix));
  const zipChance = clamp01(Number(params?.zipChance ?? 0.16));
  const zipSpeedPx = Math.max(120, Math.min(2600, Number(params?.zipSpeedPx ?? 760)));

  ctx.save();
  ctx.globalCompositeOperation = "screen";

  for (let i = 0; i < effectivePoints; i += 1) {
    const x0 = rng.float() * w;
    const y0 = rng.float() * h;
    const phase = rng.float() * Math.PI * 2;
    const drift = (0.3 + rng.float() * 0.7) * driftPx * (0.4 + blend);
    const baseX = x0 + Math.sin(t * (0.22 + rng.float() * 0.45) + phase) * drift;
    const baseY = y0 + Math.cos(t * (0.19 + rng.float() * 0.4) + phase * 0.7) * drift;
    let x = baseX;
    let y = baseY;
    const isZip = rng.float() < zipChance;
    if (isZip) {
      const dir = rng.float() * Math.PI * 2;
      const speed = zipSpeedPx * (0.6 + rng.float() * 0.9) * (0.5 + pressure * 0.8);
      const travel = t * speed;
      x = ((x0 + Math.cos(dir) * travel) % w + w) % w;
      y = ((y0 + Math.sin(dir) * travel) % h + h) % h;
      const streakLen = 6 + speed * 0.015;
      const xPrev = ((x - Math.cos(dir) * streakLen) % w + w) % w;
      const yPrev = ((y - Math.sin(dir) * streakLen) % h + h) % h;
      ctx.strokeStyle = `rgba(190,235,255,${(0.08 + noiseOpacity * 0.35).toFixed(4)})`;
      ctx.lineWidth = 0.9 + pressure * 1.1;
      ctx.beginPath();
      ctx.moveTo(xPrev, yPrev);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    const r = 0.7 + rng.float() * (1.1 + theme.pressure * 1.8);
    ctx.fillStyle = `rgba(170,210,255,${(0.12 + noiseOpacity * 0.9 * (0.25 + blend)).toFixed(4)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const lineColor = pickFrom(colors, nodeSeed, "#7FC9FF");
  for (let i = 0; i < effectiveLines; i += 1) {
    const yNorm = i / Math.max(1, lineCount - 1);
    const yBase = yNorm * h;
    const amp = (2 + blend * 16) * (0.2 + rng.float() * 1.1);
    const freq = 0.6 + rng.float() * 2.2;
    const phase = rng.float() * Math.PI * 2;
    ctx.strokeStyle = String(lineColor).startsWith("#")
      ? `rgba(140,208,255,${(lineOpacity * (0.3 + (1 - blend) * 0.7)).toFixed(4)})`
      : String(lineColor);
    ctx.globalAlpha = clamp01(lineOpacity * (0.45 + (1 - blend) * 0.55));
    ctx.lineWidth = 0.8 + (1 - blend) * 0.9;
    const asDashes = morph > 0.55 && (i % 2 === 0);
    ctx.beginPath();
    for (let x = 0; x <= w; x += Math.max(8, Math.round(w / 96))) {
      const u = x / Math.max(1, w);
      const y = yBase + Math.sin(u * Math.PI * 2 * freq + t * (0.35 + theme.sectionEnergy * 0.3) + phase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else if (asDashes && (x / Math.max(1, Math.round(w / 96))) % 3 === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawPersistentOffsetGlitch(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const t = tMs / 1000;
  const theme = resolveThemeState(state);
  const sectionMul = sectionStyleFactors(state);
  const bandCountBase = Math.max(3, Math.min(64, Math.round(Number(params?.bandCount ?? 14))));
  const bandCount = Math.max(3, Math.round(bandCountBase * performanceDensityScale(state)));
  const maxShiftPx = Math.max(1, Math.min(40, Number(params?.maxShiftPx ?? 8)));
  const alpha = clamp01(Number(params?.alpha ?? 0.18));
  const pulseGain = clamp01(Number(params?.pulseGain ?? 0.36));
  const rng = createRng(nodeSeed ^ hashStringToSeed("glitch.persistentOffset"));
  const coherence = clamp01(theme.coherence * sectionMul.coherence);
  const pressure = clamp01(theme.pressure * sectionMul.pressure);
  const strength = clamp01(((1 - coherence) * 0.45 + pressure * 0.25 + 0.24) * sectionMul.glitch);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let layer = 0; layer < 2; layer += 1) {
    const dir = layer === 0 ? 1 : -1;
    const driftHz = layer === 0 ? 0.06 : 0.09;
    for (let i = 0; i < bandCount; i += 1) {
      const yBase = (i / bandCount) * h;
      const yDrift = Math.sin(t * (driftHz + 0.015 * (i % 7)) + (nodeSeed % 31) * 0.11 + i * 0.37) * (8 + 18 * strength) * dir;
      const y0 = Math.max(-24, Math.min(h + 24, yBase + yDrift));
      const y1 = Math.min(h + 24, y0 + h / bandCount * (0.52 + rng.float() * 0.9));
      const shift = Math.sin(t * (0.08 + rng.float() * 0.22) + rng.float() * Math.PI * 2 + i * 0.19) * maxShiftPx * strength * dir;
      const bandA = alpha * (0.26 + rng.float() * 0.54) * (0.84 + 0.22 * layer);
      ctx.fillStyle = layer === 0
        ? `rgba(255,120,120,${bandA.toFixed(4)})`
        : `rgba(120,200,255,${(bandA * 0.92).toFixed(4)})`;
      ctx.fillRect(shift, y0, w, Math.max(1, y1 - y0));
    }
  }
  ctx.restore();
}

function drawPressureBloom(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  colors: string[];
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, colors, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const t = tMs / 1000;
  const theme = resolveThemeState(state);
  const mul = sectionStyleFactors(state);
  const bloomCountBase = Math.max(2, Math.min(12, Math.round(Number(params?.bloomCount ?? 5))));
  const bloomCount = Math.max(2, Math.round(bloomCountBase * performanceDensityScale(state)));
  const baseR = Math.max(6, Math.min(300, Number(params?.baseRadiusPx ?? 40)));
  const maxR = Math.max(baseR + 10, Math.min(Math.max(w, h), Number(params?.maxRadiusPx ?? 220)));
  const alpha = clamp01(Number(params?.alpha ?? 0.18));
  const ringW = Math.max(0.5, Math.min(8, Number(params?.ringWidth ?? 1.4)));
  const rng = createRng(nodeSeed ^ hashStringToSeed("energy.pressureBloom"));
  const pressure = clamp01(theme.pressure * mul.pressure);
  const burst = clamp01(theme.downbeatPulse * 0.65 + theme.beatPulse * 0.25 + pressure * 0.35);
  const centerRadiusRel = Math.max(0.08, Math.min(0.38, Number(params?.centerRadiusRel ?? 0.22)));
  const centerJitterRel = Math.max(0, Math.min(0.18, Number(params?.centerJitterRel ?? 0.05)));
  const color = pickFrom(colors, nodeSeed, "#85D3FF");

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < bloomCount; i += 1) {
    const u = i / Math.max(1, bloomCount - 1);
    const phase = rng.float() * Math.PI * 2;
    const orbitBase = Math.min(w, h) * centerRadiusRel * (0.8 + rng.float() * 0.35);
    const orbitWobble = Math.min(w, h) * centerJitterRel * (0.45 + 0.55 * Math.sin(t * (0.05 + rng.float() * 0.08) + phase * 0.6));
    const orbitR = Math.max(0, orbitBase + orbitWobble);
    const orbitA = t * (0.16 + rng.float() * 0.12) + phase;
    const cx = w * 0.5 + Math.cos(orbitA) * orbitR;
    const cy = h * 0.5 + Math.sin(orbitA * 0.9 + phase * 0.3) * orbitR;
    const sweep = (Math.sin(t * (0.35 + pressure * 1.3) + phase) + 1) * 0.5;
    const r = baseR + (maxR - baseR) * (u * 0.65 + sweep * 0.35) * (0.45 + burst * 0.75);
    const a = clamp01(alpha * 1.36 * (0.2 + (1 - u) * 0.8) * (0.45 + pressure * 0.55));
    ctx.strokeStyle = String(color).startsWith("#")
      ? `rgba(140,216,255,${a.toFixed(4)})`
      : String(color);
    ctx.lineWidth = ringW * 0.8 * (1 + (1 - u) * 0.95 + burst * 0.3);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (i % 2 === 0) {
      ctx.fillStyle = String(color).startsWith("#")
        ? `rgba(140,216,255,${(a * 0.2).toFixed(4)})`
        : String(color);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, r * (0.18 + 0.12 * burst)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRosetteSpiral(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  colors: string[];
  tMs: number;
  amp: number;
  beat: number;
  downbeat: number;
  reactive?: {
    ampFast?: number;
    ampSlow?: number;
    low?: number;
    mid?: number;
    high?: number;
    onsetPulse?: number;
  };
  state?: any;
  nodeSeed: number;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, colors, tMs, amp, beat, downbeat, reactive, state, nodeSeed, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = tMs / 1000;
  const rr = resolveReactiveSource(reactive, params?.signalSource ?? "auto");
  const low = rr.low;
  const mid = rr.mid;
  const high = rr.high;
  const onset = rr.onsetPulse;
  const rng = createRng(nodeSeed);

  const stepsBase = Math.max(80, Math.min(2800, Math.round(Number(params?.steps ?? 820))));
  const steps = Math.max(80, Math.round(stepsBase * performanceDensityScale(state)));
  const turns = Math.max(0.8, Math.min(52, Number(params?.turns ?? 10.5)));
  const thetaMax = Math.PI * 2 * turns;
  const growth = Math.max(0.03, Number(params?.growth ?? 3.5));
  const radiusPow = Math.max(0.72, Math.min(1.8, Number(params?.radiusPow ?? 1)));
  const petalCount = Math.max(2, Math.min(32, Math.round(Number(params?.petalCount ?? 6))));
  const petalAmp = Math.max(0, Number(params?.petalAmp ?? 24));
  const spin = Number(params?.spin ?? 0.18);
  const twistAmp = Number(params?.twistAmp ?? 0.16);
  const twistHz = Math.max(0, Number(params?.twistHz ?? 0.12));
  const skip = Math.max(1, Math.min(12, Math.round(Number(params?.skip ?? 1))));
  const connectMode = String(params?.connectMode ?? "auto").toLowerCase();
  const chordStep = Math.max(2, Math.min(32, Math.round(Number(params?.chordStep ?? Math.max(3, petalCount - 1)))));
  const chordStride = Math.max(1, Math.min(16, Math.round(Number(params?.chordStride ?? 3))));
  const symmetrySnap = Math.max(0, Math.min(32, Math.round(Number(params?.symmetrySnap ?? 0))));
  const symmetryMix = clamp01(Number(params?.symmetryMix ?? (symmetrySnap > 1 ? 0.72 : 0)));
  const mode = String(params?.mode ?? "spiral").toLowerCase();
  const alpha = clamp01(Number(params?.alpha ?? 0.75));
  const lineWidth = Math.max(0.5, Number(params?.lineWidth ?? 1.2));
  const timePhase = Number(params?.timePhase ?? 0.2) * t;
  const basePhase = Number(params?.phase ?? (rng.float() * Math.PI * 2));
  const animationRaw = String(params?.animationMode ?? "auto").toLowerCase();
  const animationMode = animationRaw === "auto"
    ? (["step-rotate", "counterspin", "twist"][nodeSeed % 3] as "step-rotate" | "counterspin" | "twist")
    : (animationRaw as "step-rotate" | "counterspin" | "twist");
  const profileRaw = String(params?.motionProfile ?? "auto").toLowerCase();
  const profile = profileRaw === "auto"
    ? (["petal-breathe", "gear", "spiral-surge", "glass"][Math.floor((nodeSeed >>> 4) % 4)] as "petal-breathe" | "gear" | "spiral-surge" | "glass")
    : (profileRaw as "petal-breathe" | "gear" | "spiral-surge" | "glass");
  const hueDrift = Number(params?.hueDrift ?? 0.2);
  const centerJitter = Math.max(0, Number(params?.centerJitter ?? 0));
  const cxJ = cx + Math.sin(t * 0.19 + basePhase) * centerJitter;
  const cyJ = cy + Math.cos(t * 0.17 + basePhase * 0.7) * centerJitter;
  const colorParam = String(params?.color ?? "").trim().toLowerCase();
  const blackMix = clamp01(Number(params?.blackMix ?? 0.18));
  const useBlack = colorParam === "black" || (colorParam !== "palette" && rng.float() < blackMix);

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < steps; i += 1) {
    const u = i / Math.max(1, steps - 1);
    const theta = u * thetaMax;
    const thetaN = Math.pow(theta, radiusPow);
    const spiralR = growth * thetaN;

    const petalWave = Math.cos(theta * petalCount + basePhase + timePhase + high * 0.6 + onset * 0.2);
    const rosetteR = spiralR + petalAmp * petalWave;
    const starR = spiralR + petalAmp * Math.sign(petalWave);

    let r = spiralR;
    if (mode === "rosette") r = rosetteR;
    else if (mode === "star") r = starR;
    else if (mode === "hybrid") {
      const blend = 0.45 + downbeat * 0.35 + amp * 0.15;
      r = spiralR * (1 - blend) + rosetteR * blend;
    }

    const stepAngle = (Math.PI * 2) / Math.max(8, petalCount * 2);
    const stepRotate = Math.round((t * 0.95 + downbeat * 0.75) / 0.33) * stepAngle;
    const profileOffset =
      profile === "petal-breathe"
        ? Math.sin(t * (0.25 + low * 0.35) + u * Math.PI * 2 + basePhase) * (0.08 + low * 0.05)
        : profile === "gear"
          ? Math.sign(Math.sin(t * (0.65 + mid * 0.35) + basePhase + u * Math.PI * 6)) * (0.045 + mid * 0.04)
          : profile === "spiral-surge"
            ? Math.sin(t * (0.9 + onset * 0.8) + u * Math.PI * 3) * (0.07 + high * 0.04)
            : Math.sin(t * (0.38 + mid * 0.45) + u * Math.PI * 10 + basePhase) * (0.035 + high * 0.025);
    const motionOffset =
      animationMode === "step-rotate"
        ? stepRotate + profileOffset
        : animationMode === "counterspin"
          ? ((u < 0.45 ? -1 : 1) * t * (0.22 + mid * 0.2) + beat * 0.06 + profileOffset)
          : Math.sin(t * (0.45 + high * 0.65) + u * Math.PI * 2 + basePhase) * (0.14 + downbeat * 0.08 + onset * 0.04) + profileOffset;
    const spinTerm = animationMode === "counterspin" ? spin * theta * (u < 0.5 ? -1 : 1) : spin * theta;
    const twistTerm = twistAmp * Math.sin(theta * twistHz + basePhase + timePhase + (animationMode === "twist" ? t * 0.45 : 0));
    const phi =
      theta +
      spinTerm +
      twistTerm +
      beat * 0.08 +
      motionOffset;
    const snapStep = symmetrySnap > 1 ? (Math.PI * 2) / symmetrySnap : 0;
    const snappedPhi = snapStep > 0 ? Math.round(phi / snapStep) * snapStep : phi;
    const phiFinal = snapStep > 0 ? (phi * (1 - symmetryMix) + snappedPhi * symmetryMix) : phi;
    const x = cxJ + r * Math.cos(phiFinal);
    const y = cyJ + r * Math.sin(phiFinal);
    pts.push({ x, y });
  }

  if (pts.length < 2) return;
  const stepDistances: number[] = [];
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    stepDistances.push(Math.hypot(dx, dy));
  }
  const sorted = [...stepDistances].sort((a, b) => a - b);
  const medianStep = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const jumpBreakPx = Math.max(24, medianStep * 4.8);
  const col = useBlack ? "#000000" : pickFrom(colors, nodeSeed, "#88CFFF");
  ctx.save();
  if (useBlack) {
    // Black is invisible under screen blending; force normal compositing.
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = clamp01(alpha * (0.86 + amp * 0.35 + downbeat * 0.18));
  ctx.lineWidth = lineWidth * (1 + beat * 0.2);
  if (String(col).startsWith("#")) {
    const s = String(col).replace("#", "");
    const n = Number.parseInt((s.length >= 6 ? s.slice(0, 6) : s.padEnd(6, "0")), 16);
    const cr = (n >> 16) & 255;
    const cg = (n >> 8) & 255;
    const cb = n & 255;
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},1)`;
  } else {
    ctx.strokeStyle = col;
  }

  const resolvedConnectMode = connectMode === "auto"
    // Auto should favor smooth continuity; chord links can look like center spikes.
    ? (skip > 1 ? "skip" : "sequential")
    : connectMode;

  if (resolvedConnectMode === "radial") {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += Math.max(1, skip)) {
      const p = pts[i];
      ctx.moveTo(cxJ, cyJ);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  } else if (resolvedConnectMode === "chords") {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += chordStride) {
      const a = pts[i];
      const b = pts[(i + chordStep) % pts.length];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  } else if (resolvedConnectMode === "skip" || skip > 1) {
    for (let start = 0; start < skip; start += 1) {
      ctx.beginPath();
      let first = true;
      let prev: { x: number; y: number } | null = null;
      for (let i = start; i < pts.length; i += skip) {
        const p = pts[i];
        const shouldBreak = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) > jumpBreakPx : false;
        if (first || shouldBreak) {
          ctx.moveTo(p.x, p.y);
          first = false;
        } else {
          ctx.lineTo(p.x, p.y);
        }
        prev = p;
      }
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    let prev = pts[0];
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i];
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > jumpBreakPx) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
      prev = p;
    }
    ctx.stroke();
  }

  if (hueDrift > 0.001) {
    // Add subtle second pass for depth without requiring post-FX.
    ctx.globalAlpha *= 0.28;
    ctx.lineWidth *= 0.75;
    ctx.strokeStyle = `hsla(${Math.round(((basePhase + t * hueDrift) * 180 / Math.PI) % 360)}, 90%, 68%, 0.6)`;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
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
  const firstLyricStartMs = ly
    .map((x: any) => Number(x?.t0Ms))
    .filter((x: number) => Number.isFinite(x))
    .sort((a: number, b: number) => a - b)[0];
  const lyricsHaveStarted = Number.isFinite(firstLyricStartMs) && tMs >= Number(firstLyricStartMs);
  if (!text) {
    const active = ly.find((x: any) => Number.isFinite(Number(x?.t0Ms)) && Number.isFinite(Number(x?.t1Ms)) && tMs >= Number(x.t0Ms) && tMs < Number(x.t1Ms));
    if (typeof active?.i === "number") {
      const lines = String(track?.lyrics?.rawText ?? "").split(/\r?\n/);
      text = String(lines[active.i] ?? "").trim();
    }
  }
  if (!text) {
    // Default behavior: show title only before lyric timing begins.
    // After lyrics have started, hide when there is no active lyric.
    if (!lyricsHaveStarted) {
      const hm = track?.composer?.headerMap ?? {};
      text =
        String(hm?.["Song Title"] ?? "").trim() ||
        String(hm?.["Title"] ?? "").trim() ||
        String(track?.title ?? "").trim();
    }
  }
  if (!text) return;
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

function drawBeatOrb(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  beat: number;
  downbeat: number;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, beat, downbeat, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const minDim = Math.min(w, h);
  const base = minDim * Math.max(0.01, Number(params?.baseRadiusRatio ?? 0.048));
  const radius = base * (1 + beat * 0.18 + downbeat * 0.42);
  const x = w * Number(params?.centerX ?? 0.5);
  const y = h * Number(params?.centerY ?? 0.5);

  ctx.save();
  ctx.globalCompositeOperation = (String(params?.blend ?? "screen") as GlobalCompositeOperation);

  const glowR = radius * (2.2 + beat * 1.1 + downbeat * 1.6);
  const glow = ctx.createRadialGradient(x, y, Math.max(1, radius * 0.2), x, y, glowR);
  glow.addColorStop(0, `rgba(108, 177, 255, ${0.42 + beat * 0.18 + downbeat * 0.22})`);
  glow.addColorStop(1, "rgba(108, 177, 255, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, glowR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(120, 190, 255, ${0.48 + beat * 0.2 + downbeat * 0.2})`;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(184, 225, 255, ${0.38 + beat * 0.22 + downbeat * 0.18})`;
  ctx.lineWidth = Math.max(1.2, radius * 0.09);
  ctx.beginPath();
  ctx.arc(x, y, radius * 1.18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSolidBg(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, params } = args;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = String(params?.color ?? "#000000");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawVignetteBg(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const inner = Math.max(0.05, Math.min(0.4, Number(params?.inner ?? 0.16)));
  const outer = Math.max(inner + 0.05, Math.min(1.2, Number(params?.outer ?? 0.82)));
  const tintA = String(params?.tintA ?? "#102338");
  const tintB = String(params?.tintB ?? "#000000");
  const r0 = Math.max(1, Math.min(w, h) * inner);
  const r1 = Math.max(r0 + 1, Math.max(w, h) * outer);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
  g.addColorStop(0, tintA);
  g.addColorStop(1, tintB);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawBandsBg(args: {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  nodeSeed: number;
  state?: any;
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, state, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const countBase = Math.max(4, Math.min(32, Math.round(Number(params?.count ?? 12))));
  const count = Math.max(4, Math.round(countBase * performanceDensityScale(state)));
  const alpha = clamp01(Number(params?.opacity ?? 0.11));
  const t = tMs / 1000;
  const rng = createRng(nodeSeed ^ hashStringToSeed("bg.bands"));
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#060910";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i += 1) {
    const u = i / Math.max(1, count - 1);
    const y = h * u;
    const a = clamp01(alpha * (0.65 + 0.35 * Math.sin(t * (0.25 + rng.float() * 0.2) + i * (0.5 + rng.float() * 0.8))));
    ctx.fillStyle = `rgba(48,96,156,${a})`;
    ctx.fillRect(0, y, w, Math.max(1, h / (count * (1.8 + rng.float() * 1.2))));
  }
  ctx.restore();
}

function resolveNodeType(node: GraphNode) {
  const t = String(node?.type ?? "").trim();
  if (t) return t;
  return "shape.circlePulse";
}

function fallbackGraph(): GraphLayer[] {
  return [
    {
      id: "base-gradient",
      blend: "source-over",
      opacity: 1,
      nodes: [
        { id: "gradient", type: "bg.gradientField", params: { gradientStops: 3, driftSpeed: 0.012, noiseScale: 0.45, soften: 0.94 } }
      ]
    },
    {
      id: "base-particles",
      blend: "source-over",
      opacity: 0.55,
      nodes: [
        { id: "particles", type: "fg.particles", params: { count: 120, sizeRange: [1.6, 4.8], speed: 0.48, curl: 0.55, opacity: 0.62 } }
      ]
    },
    {
      id: "base-orb",
      blend: "screen",
      opacity: 1,
      nodes: [
        { id: "orb", type: "shape.beatOrb", params: { baseRadiusRatio: 0.048 } },
      ]
    },
    {
      id: "main",
      blend: "screen",
      opacity: 1,
      nodes: [
        { id: "pulse", type: "shape.circlePulse", params: { ringCount: 8, radiusPx: 88, alpha: 0.18 } },
        { id: "ribbon", type: "polyline.orbitRibbon", params: { points: 60, radiusPx: 170, thicknessPx: 1.7, phaseHz: 0.08 } },
        { id: "rose", type: "curve.rosetteSpiral", params: { mode: "hybrid", steps: 860, turns: 11, growth: 3.2, petalCount: 7, petalAmp: 20, spin: 0.14, skip: 2, alpha: 0.5, lineWidth: 1.1 } }
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
      const type = resolveNodeType(node).toLowerCase();
      const resolvedParams = resolveResolvable(node?.params ?? {}, {
        tMs,
        seed: nodeSeed,
        state,
        path: `graph.${layerId}.${nodeId}.params`
      });
      if (type === "bg.solid") {
        drawSolidBg({ ctx, canvas, params: resolvedParams });
      } else if (type === "bg.vignette") {
        drawVignetteBg({ ctx, canvas, params: resolvedParams });
      } else if (type === "bg.bands") {
        drawBandsBg({ ctx, canvas, tMs, nodeSeed, state, params: resolvedParams });
      } else if (
        type === "bg.gradientfield" ||
        type === "bg.radialgradientdrift" ||
        type === "fg.particles" ||
        type === "fg.shockrings" ||
        type === "fg.constellationlinks"
      ) {
        renderRegisteredModule({
          moduleId:
            type === "bg.gradientfield"
              ? "bg.gradientField"
              : type === "bg.radialgradientdrift"
                ? "bg.radialGradientDrift"
                : type === "fg.shockrings"
                  ? "fg.shockRings"
                  : type === "fg.constellationlinks"
                    ? "fg.constellationLinks"
                    : "fg.particles",
          ctx,
          canvas,
          tMs,
          seed: nodeSeed,
          params: resolvedParams,
          colors,
          sectionType: String(state?.sectionType ?? "default") as any,
          state
        });
      } else if (type === "shape.beatorb") {
        drawBeatOrb({
          ctx,
          canvas,
          beat,
          downbeat,
          params: resolvedParams
        });
      } else if (type === "field.signalnoiseblend") {
        drawSignalNoiseBlend({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          colors,
          state,
          params: resolvedParams
        });
      } else if (type === "glitch.persistentoffset") {
        drawPersistentOffsetGlitch({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          state,
          params: resolvedParams
        });
      } else if (type === "energy.pressurebloom") {
        drawPressureBloom({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          colors,
          state,
          params: resolvedParams
        });
      } else if (type === "shape.circlepulse") {
        drawCirclePulse({
          ctx,
          canvas,
          colors,
          tMs,
          amp,
          beat,
          downbeat,
          nodeSeed,
          params: resolvedParams,
          state
        });
      } else if (type === "polyline.orbitribbon") {
        drawOrbitRibbon({
          ctx,
          canvas,
          colors,
          tMs,
          amp,
          beat,
          downbeat,
          reactive: state?.signalBus?.reactive,
          state,
          nodeSeed,
          params: resolvedParams
        });
      } else if (type === "text.echoword") {
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
      } else if (type === "text.karaoke") {
        renderRegisteredModule({
          moduleId: "ui.lyricsKaraoke",
          ctx,
          canvas,
          tMs,
          seed: nodeSeed,
          params: resolvedParams,
          colors,
          sectionType: String(state?.sectionType ?? "default") as any,
          state
        });
      } else if (type === "text.wordtrails") {
        renderRegisteredModule({
          moduleId: "text.wordTrails",
          ctx,
          canvas,
          tMs,
          seed: nodeSeed,
          params: resolvedParams,
          colors,
          sectionType: String(state?.sectionType ?? "default") as any,
          state
        });
      } else if (type === "overlay.beattrack") {
        drawBeatTrackOverlay({
          ctx,
          canvas,
          state,
          params: resolvedParams
        });
      } else if (type === "viz.wavestrip") {
        drawWaveStrip({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          colors,
          state,
          params: resolvedParams
        });
      } else if (type === "viz.spectrumbars") {
        drawSpectrumBars({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          colors,
          state,
          params: resolvedParams
        });
      } else if (type === "viz.responsiverings") {
        drawResponsiveRings({
          ctx,
          canvas,
          tMs,
          nodeSeed,
          colors,
          state,
          params: resolvedParams
        });
      } else if (type === "curve.rosettespiral") {
        drawRosetteSpiral({
          ctx,
          canvas,
          colors,
          tMs,
          amp,
          beat,
          downbeat,
          reactive: state?.signalBus?.reactive,
          state,
          nodeSeed,
          params: resolvedParams
        });
      }
    }
    ctx.restore();
  }
}
