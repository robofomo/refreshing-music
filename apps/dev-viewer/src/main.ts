import "./style.css";
import { createEngine, hashStringToSeed } from "../../../packages/engine/src/index";
import { classifySection } from "../../../packages/engine/src/sections";

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
  recipeRef?: { albumId?: string; trackOverrideId?: string };
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
const controls = document.getElementById("controls") as HTMLDivElement;
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
let lyricsEnabled = new URL(location.href).searchParams.get("lyrics") !== "0";
let lyricMode = new URL(location.href).searchParams.get("lyricMode") || "center";
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
const CONTROLS_HIDE_MS = 5000;
let controlsHideTimer = 0;
let canvasClickTimer = 0;
let currentRecipe: any = null;
const engine = createEngine({
  canvas,
  dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
  getTimeState: () => ({ tMs: audio.currentTime * 1000 }),
  getAudioState: () => ({ amp: rmsAmplitude(), paused: audio.paused })
});

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

function setLyricsEnabled(next: boolean) {
  lyricsEnabled = next;
  updateUrlParam("lyrics", next ? "1" : "0");
}

function setControlsVisible(visible: boolean) {
  controls.classList.toggle("is-hidden", !visible);
}

function showControlsTemporarily() {
  setControlsVisible(true);
  if (controlsHideTimer) window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => setControlsVisible(false), CONTROLS_HIDE_MS);
}

function setPlayButtonIcon() {
  playBtn.textContent = audio.paused ? "\u25B6" : "\u23F8";
}

function randomizeSeed() {
  const nextSeed = Math.floor(Math.random() * 2_000_000_000);
  buildScene(nextSeed);
  updateUrlParam("seed", String(nextSeed));
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
    if (isAtTrackEnd()) {
      await loadTrack(selectedIndex + 1);
    }
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

function isAtTrackEnd() {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return false;
  return audio.currentTime >= audio.duration - 0.05;
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
  engine.reset(seed);
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
  const sec = findCurrentSection(tRenderMs);
  const sectionId = sec?.id ?? "";
  const sectionType = classifySection(sectionId || sec?.id || "");
  const controlsRect = controls.getBoundingClientRect();
  const viewportHeightPx = window.visualViewport?.height ?? window.innerHeight;
  const frameInfo = engine.renderFrame({
    tMs: tRenderMs,
    sectionId,
    sectionType,
    amp,
    energy: amp,
    recipe: currentRecipe,
    track,
    lyricsEnabled,
    lyricMode,
    uiLayout: {
      controlsTopPx: controlsRect.top,
      viewportHeightPx
    }
  });

if (!isSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
  seek.value = String(
    Math.min(1000, Math.max(0, (audio.currentTime / audio.duration) * 1000))
  );
}

  const lyricRef = findCurrentLyricLine(tRenderMs);
  const lyricIndex = typeof frameInfo?.lyricIndex === "number" ? frameInfo.lyricIndex : (typeof lyricRef?.i === "number" ? lyricRef.i : -1);
  const lyricText = frameInfo?.lyricText
    ? String(frameInfo.lyricText)
    : typeof lyricRef?.i === "number" && lyricRef.i >= 0 && lyricRef.i < lyricsLines.length
      ? lyricsLines[lyricRef.i]
      : "";
  hud.style.display = hudVisible ? "block" : "none";
  hud.textContent = [
    `title: ${track?.title ?? "-"}`,
    `trackId: ${track?.trackId ?? "-"}`,
    `seed: ${seed}`,
    `time: ${fmtMs(tAudioMs)}`,
    `offsetMs: ${renderOffsetMs}`,
    `sectionId: ${sectionId || "-"}`,
    `sectionType: ${frameInfo?.sectionType ?? sectionType}`,
    `lyricIndex: ${lyricIndex}`,
    `lyric: ${lyricText || "-"}`,
    ``,
    `keys: space/k play`,
    `      left/right seek`,
    `      [ ] offset`,
    `      \\ reset offset`,
    `      h/? hud`,
    `      l lyrics on/off`
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
  try {
    const albumId = track.recipeRef?.albumId ?? "example-theme";
    const override = track.recipeRef?.trackOverrideId ?? "";
    const recipeUrl = new URL(`/recipes/resolve?albumId=${encodeURIComponent(albumId)}&trackOverrideId=${encodeURIComponent(override)}`, location.origin);
    let recipeResp = await fetch(recipeUrl.toString());
    if (!recipeResp.ok) {
      const fallbackUrl = new URL(`/recipes/resolve?albumId=example-theme&trackOverrideId=${encodeURIComponent(override)}`, location.origin);
      recipeResp = await fetch(fallbackUrl.toString());
    }
    currentRecipe = recipeResp.ok ? await recipeResp.json() : { layers: [{ module: "bg.gradientField", params: { gradientStops: 3 } }] };
  } catch {
    currentRecipe = { layers: [{ module: "bg.gradientField", params: { gradientStops: 3 } }] };
  }

  const audioUrl = new URL(track.audio.path, trackUrl).toString();
  const wasPlaying = !audio.paused;
  audio.src = audioUrl;
  audio.load();

  if (!Number.isInteger(seed)) {
    buildScene(hashStringToSeed(track.trackId || trackId));
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
  const lyricsParam = url.searchParams.get("lyrics");
  const lyricModeParam = url.searchParams.get("lyricMode");
  seed = seedParam ? Number(seedParam) : NaN;
  setRenderOffset(offsetParam ? Number(offsetParam) : DEFAULT_RENDER_OFFSET_MS);
  setLyricsEnabled(lyricsParam !== "0");
  lyricMode = lyricModeParam === "fixed" || lyricModeParam === "off" ? lyricModeParam : "center";
  updateUrlParam("lyricMode", lyricMode);

  const byTrackId = requestedTrackId
    ? indexEntries.findIndex((entry) => trackIdFromEntry(entry) === requestedTrackId)
    : -1;
  await loadTrack(byTrackId >= 0 ? byTrackId : 0);
  showControlsTemporarily();
}

async function goNextTrack() {
  await loadTrack(selectedIndex + 1);
}

async function goPrevTrackOrRestart() {
  if (audio.currentTime > 5) {
    audio.currentTime = 0;
    return;
  }
  await loadTrack(selectedIndex - 1);
}

playBtn.addEventListener("click", async () => {
  await togglePlayPause();
});

prevBtn.addEventListener("click", async () => {
  logAudioState("prev-click");
  await goPrevTrackOrRestart();
});

nextBtn.addEventListener("click", async () => {
  logAudioState("next-click");
  await goNextTrack();
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
  randomizeSeed();
  showControlsTemporarily();
});

hudBtn.addEventListener("click", () => {
  hudVisible = !hudVisible;
  updateUrlParam("hud", hudVisible ? "1" : null);
  showControlsTemporarily();
});

window.addEventListener("keydown", async (e) => {
  showControlsTemporarily();
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
  if (e.key.toLowerCase() === "n" || e.key === "." || e.key === ">") {
    e.preventDefault();
    await goNextTrack();
    return;
  }
  if (e.key.toLowerCase() === "p" || e.key === "," || e.key === "<") {
    e.preventDefault();
    await goPrevTrackOrRestart();
    return;
  }
  if (e.key.toLowerCase() === "h" || e.key === "?") {
    e.preventDefault();
    hudVisible = !hudVisible;
    updateUrlParam("hud", hudVisible ? "1" : null);
    return;
  }
  if (e.key.toLowerCase() === "l") {
    e.preventDefault();
    setLyricsEnabled(!lyricsEnabled);
    return;
  }
  if (e.key.toLowerCase() === "m") {
    e.preventDefault();
    lyricMode = lyricMode === "fixed" ? "center" : lyricMode === "center" ? "off" : "fixed";
    updateUrlParam("lyricMode", lyricMode);
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

window.addEventListener("mousemove", showControlsTemporarily);
window.addEventListener("touchstart", showControlsTemporarily, { passive: true });
window.addEventListener("pointerdown", showControlsTemporarily);

canvas.addEventListener("click", () => {
  if (canvasClickTimer) window.clearTimeout(canvasClickTimer);
  canvasClickTimer = window.setTimeout(() => {
    randomizeSeed();
    showControlsTemporarily();
  }, 220);
});

canvas.addEventListener("dblclick", () => {
  if (canvasClickTimer) {
    window.clearTimeout(canvasClickTimer);
    canvasClickTimer = 0;
  }
  hudVisible = !hudVisible;
  updateUrlParam("hud", hudVisible ? "1" : null);
  showControlsTemporarily();
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
audio.addEventListener("ended", async () => {
  await goNextTrack();
  ensureAudioGraph();
  await resumeAudioContext();
  await audio.play().catch(() => undefined);
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

