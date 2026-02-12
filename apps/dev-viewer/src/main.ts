import "./style.css";

type TimingSection = { id?: string; t0Ms?: number; t1Ms?: number };
type TimingLyric = { i?: number; t0Ms?: number; t1Ms?: number };
type Track = {
  title: string;
  trackId: string;
  slug: string;
  audio: { path: string; filename?: string };
  sections?: Array<{ id: string; labelRaw?: string }>;
  lyrics?: { rawText?: string };
  timing?: {
    sections?: TimingSection[];
    lyricsLines?: TimingLyric[];
    beatsMs?: number[];
  };
};

type Particle = {
  x: number;
  y: number;
  size: number;
  speed: number;
  angle: number;
  alpha: number;
  drift: number;
};

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const seedBtn = document.getElementById("seedBtn") as HTMLButtonElement;
const hudBtn = document.getElementById("hudBtn") as HTMLButtonElement;
const seek = document.getElementById("seek") as HTMLInputElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const ctx = canvas.getContext("2d");

if (!ctx) throw new Error("Canvas2D not supported");

const palettes = [
  ["#0f172a", "#124e66", "#2f9c95"],
  ["#0b1020", "#203a43", "#2c5364"],
  ["#151515", "#23395b", "#406e8e"],
  ["#0e0f1a", "#5f0a87", "#a4508b"]
];

let indexEntries: string[] = [];
let selectedIndex = 0;
let track: Track | null = null;
let trackUrl = "";
let lyricsLines: string[] = [];

let seed = 1;
const DEFAULT_RENDER_OFFSET_MS = -240;
const MIN_RENDER_OFFSET_MS = -500;
const MAX_RENDER_OFFSET_MS = 500;
let renderOffsetMs = DEFAULT_RENDER_OFFSET_MS;
let hudVisible = new URL(location.href).searchParams.get("hud") === "1";
let particles: Particle[] = [];
let palette = palettes[0];
let isSeeking = false;
let pendingSeekRatio = 0;
let wasPlayingBeforeSeek = false;
let seekInFlight = false;
const ampHistory: Array<{ tMs: number; amp: number }> = [];

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let audioData: Uint8Array<ArrayBuffer> | null = null;
const DEBUG_AUDIO = false;
let lastDebugLogTs = 0;
let lowAmpSinceMs = 0;
let lastGraphRebuildTs = 0;

function hashString(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trackIdFromEntry(entry: string) {
  const file = entry.split("/").pop() ?? "";
  return file.replace(/\.track\.json$/i, "");
}

function updateUrlParam(key: string, value: string | null) {
  const u = new URL(location.href);
  if (value === null) u.searchParams.delete(key);
  else u.searchParams.set(key, value);
  history.replaceState({}, "", u);
}

function clampOffset(v: number) {
  if (!Number.isFinite(v)) return DEFAULT_RENDER_OFFSET_MS;
  return Math.max(MIN_RENDER_OFFSET_MS, Math.min(MAX_RENDER_OFFSET_MS, Math.round(v)));
}

function setRenderOffset(next: number) {
  renderOffsetMs = clampOffset(next);
  updateUrlParam("offset", String(renderOffsetMs));
}

function setPlayButtonIcon() {
  playBtn.textContent = audio.paused ? "\u25B6" : "\u23F8";
}

function resumeAudioContext() {
  const ctxRef = audioCtx;
  if (ctxRef && ctxRef.state !== "running") {
    return ctxRef.resume().catch(() => undefined);
  }
  return Promise.resolve(undefined);
}

async function togglePlayPause() {
  if (audio.paused) {
    ensureAudioGraph();
    await resumeAudioContext();
    await audio.play().catch(() => undefined);
  } else {
    audio.pause();
  }
  setPlayButtonIcon();
}

function logAudioState(event: string, extra: Record<string, unknown> = {}) {
  if (!DEBUG_AUDIO) return;
  const now = performance.now();
  if ((event === "reactivity-stalled" || event === "reactivity-ok") && now - lastDebugLogTs < 1000) return;
  lastDebugLogTs = now;
  console.log(`[audio] ${event}`, {
    paused: audio.paused,
    currentTime: Number(audio.currentTime.toFixed(3)),
    duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(3)) : audio.duration,
    readyState: audio.readyState,
    networkState: audio.networkState,
    audioCtxState: audioCtx?.state ?? "none",
    hasAnalyser: Boolean(analyser),
    ...extra
  });
}

function resetAmpHistory(reason: string) {
  ampHistory.length = 0;
  lowAmpSinceMs = 0;
  logAudioState("amp-history-reset", { reason });
}

function once(el: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve) => {
    const h = () => {
      el.removeEventListener(event, h);
      resolve();
    };
    el.addEventListener(event, h, { once: true });
  });
}

async function ensureMetadataLoaded() {
  if (audio.readyState >= 1) return;
  if (!audio.preload) audio.preload = "metadata";
  audio.load();
  await once(audio, "loadedmetadata");
}

async function seekToSeconds(seconds: number) {
  await ensureMetadataLoaded();
  audio.pause();
  audio.currentTime = seconds;
  await once(audio, "seeked");
}

function beginSeek() {
  isSeeking = true;
  wasPlayingBeforeSeek = !audio.paused;
  audio.pause();
  resetAmpHistory("seek-begin");
  logAudioState("seek-begin");
}

function applySeekFromSlider() {
  pendingSeekRatio = Number(seek.value) / 1000;
}

async function finishSeek() {
  if (seekInFlight) return;
  seekInFlight = true;
  await ensureMetadataLoaded();
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const target = Math.max(0, Math.min(duration, pendingSeekRatio * duration));

  audio.pause();
  try {
    await seekToSeconds(target);
    resetAmpHistory("seek-complete");
    logAudioState("seek-complete", { target });

    ensureAudioGraph();
    await resumeAudioContext();

    if (wasPlayingBeforeSeek) {
      await audio.play().catch((err) => {
        logAudioState("play-resume-failed", { err: err instanceof Error ? err.message : String(err) });
        return undefined;
      });
    }
  } finally {
    isSeeking = false;
    seekInFlight = false;
  }
}

function endSeek() {
  if (!isSeeking) return;
  isSeeking = false;
  void finishSeek();
}

function pushAmplitudeSample(tAudioMs: number, amp: number) {
  ampHistory.push({ tMs: tAudioMs, amp });
  const cutoff = tAudioMs - 5000;
  while (ampHistory.length > 2 && ampHistory[0].tMs < cutoff) ampHistory.shift();
}

function amplitudeAt(tMs: number, fallbackAmp: number) {
  if (!ampHistory.length) return fallbackAmp;
  if (tMs <= ampHistory[0].tMs) return ampHistory[0].amp;
  for (let i = 1; i < ampHistory.length; i += 1) {
    const a = ampHistory[i - 1];
    const b = ampHistory[i];
    if (tMs <= b.tMs) {
      const span = Math.max(1, b.tMs - a.tMs);
      const u = (tMs - a.tMs) / span;
      return a.amp + (b.amp - a.amp) * u;
    }
  }
  return ampHistory[ampHistory.length - 1].amp;
}

function ensureAudioGraph() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  audioData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  const src = audioCtx.createMediaElementSource(audio);
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function rebuildAudioGraph(reason: string) {
  const now = performance.now();
  if (now - lastGraphRebuildTs < 5000) return;
  lastGraphRebuildTs = now;

  const oldCtx = audioCtx;
  audioCtx = null;
  analyser = null;
  audioData = null;
  oldCtx?.close().catch(() => undefined);

  ensureAudioGraph();
  void resumeAudioContext();
  logAudioState("analyser-rebuilt", { reason });
}

function rmsAmplitude() {
  if (!analyser || !audioData) return 0;
  analyser.getByteTimeDomainData(audioData);
  let sum = 0;
  for (const v of audioData) {
    const n = (v - 128) / 128;
    sum += n * n;
  }
  return Math.sqrt(sum / audioData.length);
}

function fmtMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function findCurrentSection(currentTimeMs: number) {
  const sections = track?.timing?.sections ?? [];
  let best: TimingSection | null = null;
  for (const s of sections) {
    if (typeof s.t0Ms !== "number") continue;
    const open = currentTimeMs >= s.t0Ms;
    const close = typeof s.t1Ms !== "number" || currentTimeMs < s.t1Ms;
    if (open && close) best = s;
  }
  return best;
}

function findCurrentLyricLine(currentTimeMs: number) {
  const lines = track?.timing?.lyricsLines ?? [];
  let best: TimingLyric | null = null;
  for (const row of lines) {
    if (typeof row.t0Ms !== "number") continue;
    const open = currentTimeMs >= row.t0Ms;
    const close = typeof row.t1Ms !== "number" || currentTimeMs < row.t1Ms;
    if (open && close) best = row;
  }
  return best;
}

function beatPulse(currentTimeMs: number) {
  const beats = track?.timing?.beatsMs ?? [];
  if (!beats.length) return 0;
  let nearest = Infinity;
  for (const b of beats) {
    const d = Math.abs(b - currentTimeMs);
    if (d < nearest) nearest = d;
  }
  return nearest > 220 ? 0 : Math.exp(-nearest / 90);
}

function buildScene(nextSeed: number) {
  seed = nextSeed >>> 0;
  const rng = mulberry32(seed);
  palette = palettes[Math.floor(rng() * palettes.length)];
  const count = 200 + Math.floor(rng() * 201);
  particles = Array.from({ length: count }, () => ({
    x: rng(),
    y: rng(),
    size: 0.8 + rng() * 2.8,
    speed: 0.005 + rng() * 0.03,
    angle: rng() * Math.PI * 2,
    alpha: 0.2 + rng() * 0.8,
    drift: -1 + rng() * 2
  }));
}

function resizeCanvas() {
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
}

function render() {
  if (!ctx) return;
  resizeCanvas();
  const w = canvas.width;
  const h = canvas.height;
  const tAudioMs = audio.currentTime * 1000;
  const lastAmp = ampHistory.length ? ampHistory[ampHistory.length - 1] : null;
  if (lastAmp && tAudioMs + 250 < lastAmp.tMs) {
    resetAmpHistory("time-jump-backward");
  }
  const tRenderMs = tAudioMs + renderOffsetMs;
  if (!audio.paused) {
    void resumeAudioContext();
  }
  const ampNow = rmsAmplitude();
  if (!audio.paused) {
    if (ampNow < 0.004) {
      if (!lowAmpSinceMs) lowAmpSinceMs = tAudioMs;
      if (tAudioMs - lowAmpSinceMs > 2000) {
        logAudioState("reactivity-stalled", { amp: Number(ampNow.toFixed(6)) });
        rebuildAudioGraph("low-rms-while-playing");
      }
    } else {
      if (lowAmpSinceMs) logAudioState("reactivity-ok", { amp: Number(ampNow.toFixed(6)) });
      lowAmpSinceMs = 0;
    }
  } else {
    lowAmpSinceMs = 0;
  }
  pushAmplitudeSample(tAudioMs, ampNow);
  const amp = amplitudeAt(tRenderMs, ampNow);
  const pulse = beatPulse(tRenderMs);
  const wobbleX = Math.sin(tRenderMs * 0.001 + seed * 0.00001) * amp * 48;
  const wobbleY = Math.cos(tRenderMs * 0.0013 + seed * 0.00002) * amp * 48;
  const phaseOffset = renderOffsetMs * 0.001;

  ctx.save();
  ctx.translate(wobbleX, wobbleY);

  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, palette[0]);
  g.addColorStop(0.5, palette[1]);
  g.addColorStop(1, palette[2]);
  ctx.fillStyle = g;
  ctx.fillRect(-64, -64, w + 128, h + 128);

  const centerX = w * 0.5;
  const centerY = h * 0.5;
  const glow = 120 + pulse * 280 + amp * 180;
  ctx.fillStyle = `rgba(255,255,255,${0.05 + pulse * 0.09})`;
  ctx.beginPath();
  ctx.arc(centerX, centerY, glow, 0, Math.PI * 2);
  ctx.fill();

  const t = tRenderMs * 0.001;
  for (const p of particles) {
    const dx = Math.cos(p.angle) * p.speed * t + Math.sin((t + phaseOffset) * p.drift * 0.3) * 0.02;
    const dy = Math.sin(p.angle) * p.speed * t + Math.cos((t + phaseOffset) * p.drift * 0.2) * 0.02;
    let x = ((p.x + dx) % 1 + 1) % 1;
    let y = ((p.y + dy) % 1 + 1) % 1;
    x *= w;
    y *= h;
    ctx.fillStyle = `rgba(255,255,255,${0.15 * p.alpha + pulse * 0.18})`;
    ctx.beginPath();
    ctx.arc(x, y, p.size + pulse * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

if (!isSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
  seek.value = String(
    Math.min(1000, Math.max(0, (audio.currentTime / audio.duration) * 1000))
  );
}

  const sec = findCurrentSection(tRenderMs);
  const lyricRef = findCurrentLyricLine(tRenderMs);
  const lyricText =
    typeof lyricRef?.i === "number" && lyricRef.i >= 0 && lyricRef.i < lyricsLines.length ? lyricsLines[lyricRef.i] : "";
  hud.style.display = hudVisible ? "block" : "none";
  hud.textContent = [
    `title: ${track?.title ?? "-"}`,
    `trackId: ${track?.trackId ?? "-"}`,
    `seed: ${seed}`,
    `time: ${fmtMs(tAudioMs)}`,
    `offsetMs: ${renderOffsetMs}`,
    `section: ${sec?.id ?? "-"}`,
    `lyric: ${lyricText || "-"}`,
    ``,
    `keys: space/k play`,
    `      left/right seek`,
    `      [ ] offset`,
    `      \\ reset offset`,
    `      h/? hud`
  ].join("\n");

  requestAnimationFrame(render);
}

async function loadTrack(nextIndex: number) {
  if (!indexEntries.length) return;
  selectedIndex = (nextIndex + indexEntries.length) % indexEntries.length;
  const entry = indexEntries[selectedIndex];
  const trackId = trackIdFromEntry(entry);
  updateUrlParam("track", trackId);

  trackUrl = new URL(`/tracks/${entry}`, location.origin).toString();
  const resp = await fetch(trackUrl);
  if (!resp.ok) throw new Error(`Failed to load track json: ${entry}`);
  track = (await resp.json()) as Track;
  resetAmpHistory("track-load");
  logAudioState("track-loaded", { trackId });
  lyricsLines = String(track.lyrics?.rawText ?? "").split("\n");

  const audioUrl = new URL(track.audio.path, trackUrl).toString();
  const wasPlaying = !audio.paused;
  audio.src = audioUrl;
  audio.load();

  if (!Number.isInteger(seed)) {
    buildScene(hashString(track.trackId || trackId));
    updateUrlParam("seed", String(seed));
  } else {
    buildScene(seed);
  }

  if (wasPlaying) {
    await audio.play().catch(() => undefined);
  }
  setPlayButtonIcon();
}

async function init() {
  hud.style.display = hudVisible ? "block" : "none";
  const indexResp = await fetch("/tracks/index.json");
  if (!indexResp.ok) throw new Error("Failed to load /tracks/index.json");
  indexEntries = (await indexResp.json()) as string[];
  if (!indexEntries.length) throw new Error("No tracks found in index.json");

  const url = new URL(location.href);
  const requestedTrackId = url.searchParams.get("track");
  const seedParam = url.searchParams.get("seed");
  const offsetParam = url.searchParams.get("offset");
  seed = seedParam ? Number(seedParam) : NaN;
  setRenderOffset(offsetParam ? Number(offsetParam) : DEFAULT_RENDER_OFFSET_MS);

  const byTrackId = requestedTrackId
    ? indexEntries.findIndex((entry) => trackIdFromEntry(entry) === requestedTrackId)
    : -1;
  await loadTrack(byTrackId >= 0 ? byTrackId : 0);
}

playBtn.addEventListener("click", async () => {
  await togglePlayPause();
});

prevBtn.addEventListener("click", async () => {
  logAudioState("prev-click");
  await loadTrack(selectedIndex - 1);
});

nextBtn.addEventListener("click", async () => {
  logAudioState("next-click");
  await loadTrack(selectedIndex + 1);
});

seek.addEventListener("pointerdown", (e) => {
  seek.setPointerCapture(e.pointerId);
  beginSeek();
  const r = seek.getBoundingClientRect();
  const x = Math.min(r.width, Math.max(0, e.clientX - r.left));
  const ratio = r.width ? x / r.width : 0;
  seek.value = String(Math.round(ratio * 1000));
  applySeekFromSlider();
});
// seek.addEventListener("mousedown", beginSeek);
// seek.addEventListener("touchstart", beginSeek, { passive: true });

seek.addEventListener("pointerup", (e) => {
  try { seek.releasePointerCapture(e.pointerId); } catch {}
  void finishSeek();
});
// window.addEventListener("mouseup", () => {
//   endSeek();
// });
// window.addEventListener("touchend", () => {
//   endSeek();
// });
seek.addEventListener("input", applySeekFromSlider);
seek.addEventListener("change", () => {
  if (isSeeking || seekInFlight) return;
  wasPlayingBeforeSeek = !audio.paused;
  void finishSeek();
});
seek.addEventListener("click", () => {
  if (isSeeking || seekInFlight) return;
  wasPlayingBeforeSeek = !audio.paused;
  applySeekFromSlider();
  void finishSeek();
});

seedBtn.addEventListener("click", () => {
  const nextSeed = Math.floor(Math.random() * 2_000_000_000);
  buildScene(nextSeed);
  updateUrlParam("seed", String(nextSeed));
});

hudBtn.addEventListener("click", () => {
  hudVisible = !hudVisible;
  updateUrlParam("hud", hudVisible ? "1" : null);
});

window.addEventListener("keydown", async (e) => {
  if ((e.code === "Space" || e.key.toLowerCase() === "k") && !e.repeat) {
    e.preventDefault();
    await togglePlayPause();
    return;
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    audio.currentTime = Math.max(0, audio.currentTime - 5);
    return;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    const maxT = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5;
    audio.currentTime = Math.min(maxT, audio.currentTime + 5);
    return;
  }
  if (e.key.toLowerCase() === "h" || e.key === "?") {
    e.preventDefault();
    hudVisible = !hudVisible;
    updateUrlParam("hud", hudVisible ? "1" : null);
    return;
  }
  if (e.code === "BracketLeft") {
    setRenderOffset(renderOffsetMs - 10);
    e.preventDefault();
  } else if (e.code === "BracketRight") {
    setRenderOffset(renderOffsetMs + 10);
    e.preventDefault();
  } else if (e.code === "Backslash") {
    setRenderOffset(DEFAULT_RENDER_OFFSET_MS);
    e.preventDefault();
  }
});

audio.addEventListener("play", () => { 
  ensureAudioGraph();
  void resumeAudioContext();
  logAudioState("play");
  setPlayButtonIcon();
});
audio.addEventListener("seeking", () => {
  void resumeAudioContext();
  logAudioState("seeking");
});
audio.addEventListener("seeked", () => {
  logAudioState("seeked");
});
audio.addEventListener("pause", () => {
  logAudioState("pause");
  setPlayButtonIcon();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void resumeAudioContext();
    logAudioState("visibility-return");
  }
});

window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(render);

init().catch((err) => {
  hudVisible = true;
  hud.style.display = "block";
  hud.textContent = err instanceof Error ? err.message : String(err);
});

