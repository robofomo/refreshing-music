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
  const modeRaw = String(params?.animationMode ?? "auto").toLowerCase();
  const mode = modeRaw === "auto"
    ? (["flow", "pulse-rotate", "drift"][nodeSeed % 3] as "flow" | "pulse-rotate" | "drift")
    : (modeRaw as "flow" | "pulse-rotate" | "drift");
  const audioWarp = 1 + amp * 0.85 + downbeat * 0.18;
  const tempoMul = mode === "pulse-rotate" ? 0.72 : mode === "drift" ? 1.08 : 1;
  const phaseBeatPush = mode === "pulse-rotate" ? (downbeat * 0.08 + beat * 0.03) : (beat * 0.015);
  const radiusBoostBase = mode === "pulse-rotate"
    ? (1 + amp * 0.14 + beat * 0.11 + downbeat * 0.09)
    : (1 + amp * 0.18 + beat * 0.07);
  const yAxisScale = mode === "drift" ? (0.72 + 0.18 * Math.sin(t * (0.33 + amp * 0.5) + seedPhase)) : (0.68 + 0.14 * Math.sin(t * (0.45 + amp * 0.9)));
  const driftFreqMul = mode === "drift" ? 2.2 : mode === "pulse-rotate" ? 1.1 : 1.6;
  const driftAmp = mode === "pulse-rotate" ? (0.12 + amp * 0.09) : (0.15 + amp * 0.12);
  ctx.strokeStyle = pickFrom(colors, nodeSeed, "#89D6FF");
  if (!String(ctx.strokeStyle).startsWith("#")) ctx.globalAlpha = clamp01(0.44 + amp * 0.24 + downbeat * 0.1);
  else ctx.globalAlpha = clamp01(0.52 + amp * 0.22 + downbeat * 0.1);
  ctx.lineWidth = thickness * (1 + amp * 0.2);
  ctx.beginPath();
  const driftBaseFreq = 3.4 + rng.float() * 1.1;
  const driftPhase = seedPhase * (0.8 + rng.float() * 0.6);
  for (let i = 0; i <= points; i += 1) {
    const u = i / points;
    const a = u * Math.PI * 2 + t * 2 * Math.PI * speedHz * audioWarp * tempoMul + seedPhase + phaseBeatPush;
    // Use periodic, continuous drift so the stroke stays smooth and avoids seam spikes.
    const drift = 1 + driftAmp * Math.sin(driftBaseFreq * a * driftFreqMul + t * (0.45 + amp * 0.45) + driftPhase);
    const radiusBoost = radiusBoostBase + (mode === "drift" ? 0.03 * Math.sin(t * 0.4 + u * Math.PI * 2) : 0);
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

function drawRosetteSpiral(args: {
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
  const rng = createRng(nodeSeed);

  const steps = Math.max(80, Math.min(2800, Math.round(Number(params?.steps ?? 820))));
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

    const petalWave = Math.cos(theta * petalCount + basePhase + timePhase);
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
    const motionOffset =
      animationMode === "step-rotate"
        ? stepRotate
        : animationMode === "counterspin"
          ? ((u < 0.45 ? -1 : 1) * t * 0.28 + beat * 0.06)
          : Math.sin(t * 0.55 + u * Math.PI * 2 + basePhase) * (0.16 + downbeat * 0.08);
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
  params?: Record<string, any>;
}) {
  const { ctx, canvas, tMs, nodeSeed, params } = args;
  const w = canvas.width;
  const h = canvas.height;
  const count = Math.max(4, Math.min(32, Math.round(Number(params?.count ?? 12))));
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
        drawBandsBg({ ctx, canvas, tMs, nodeSeed, params: resolvedParams });
      } else if (type === "bg.gradientfield" || type === "fg.particles") {
        renderRegisteredModule({
          moduleId: type === "bg.gradientfield" ? "bg.gradientField" : "fg.particles",
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
          params: resolvedParams
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
      } else if (type === "overlay.beattrack") {
        drawBeatTrackOverlay({
          ctx,
          canvas,
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
          nodeSeed,
          params: resolvedParams
        });
      }
    }
    ctx.restore();
  }
}
