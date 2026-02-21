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
  assetPaths?: {
    mix?: string;
    stemsZip?: string;
    instrumental?: string;
    vocals?: string;
    composer?: string;
  };
  sections?: Array<{ id: string; labelRaw?: string }>;
  lyrics?: { rawText?: string };
  timing?: {
    sections?: TimingSection[];
    lyricsLines?: TimingLyric[];
    beatsMs?: number[];
    downbeatTimesMs?: number[];
  };
  recipeRef?: { albumId?: string; trackOverrideId?: string };
};

type PlaybackMode = "mix" | "stems";

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
const mixer = document.getElementById("mixer") as HTMLDivElement;
const seek = document.getElementById("seek") as HTMLInputElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const audioVocals = document.createElement("audio");
const ctx = canvas.getContext("2d");

if (!ctx) throw new Error("Canvas2D not supported");

audioVocals.preload = "metadata";
audioVocals.crossOrigin = "anonymous";

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
let pulseBeatTimesMs: number[] = [];
let pulseDownbeatTimesMs: number[] = [];

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
let playbackMode: PlaybackMode = "mix";
const mixerState = {
  mix: { volume: 1, muted: false },
  backing: { volume: 1, muted: false },
  vocals: { volume: 1, muted: false }
};

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let masterGain: GainNode | null = null;
let primaryGain: GainNode | null = null;
let vocalsGain: GainNode | null = null;
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

function isStemsTrack(next: Track | null) {
  return Boolean(next?.assetPaths?.instrumental && next?.assetPaths?.vocals);
}

function stemsActive() {
  return playbackMode === "stems";
}

function activeAudioEls() {
  return stemsActive() ? [audio, audioVocals] : [audio];
}

function syncStemTiming() {
  if (!stemsActive() || !audioVocals.src) return;
  const drift = Math.abs(audioVocals.currentTime - audio.currentTime);
  if (drift > 0.08) audioVocals.currentTime = audio.currentTime;
}

function applyMixerGains() {
  if (!primaryGain || !vocalsGain) return;
  if (stemsActive()) {
    const b = mixerState.backing;
    const v = mixerState.vocals;
    primaryGain.gain.value = b.muted ? 0 : b.volume;
    vocalsGain.gain.value = v.muted ? 0 : v.volume;
  } else {
    const m = mixerState.mix;
    primaryGain.gain.value = m.muted ? 0 : m.volume;
    vocalsGain.gain.value = 0;
  }
}

function createMixerRow(key: "mix" | "backing" | "vocals", label: string) {
  const row = document.createElement("div");
  row.className = "mixer-row";

  const muteBtn = document.createElement("button");
  muteBtn.className = "mute-btn";
  muteBtn.textContent = "M";
  muteBtn.title = `${label} mute`;

  const title = document.createElement("div");
  title.className = "mixer-label";
  title.textContent = label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(Math.round(mixerState[key].volume * 100));

  const refresh = () => {
    muteBtn.classList.toggle("is-muted", mixerState[key].muted);
    muteBtn.setAttribute("aria-pressed", mixerState[key].muted ? "true" : "false");
  };
  refresh();

  muteBtn.addEventListener("click", () => {
    mixerState[key].muted = !mixerState[key].muted;
    refresh();
    applyMixerGains();
    showControlsTemporarily();
  });

  slider.addEventListener("input", () => {
    mixerState[key].volume = Math.max(0, Math.min(1, Number(slider.value) / 100));
    applyMixerGains();
  });
  slider.addEventListener("pointerdown", showControlsTemporarily);

  row.append(muteBtn, title, slider);
  return row;
}

function renderMixerControls() {
  mixer.innerHTML = "";
  if (stemsActive()) {
    mixer.appendChild(createMixerRow("backing", "Backing"));
    mixer.appendChild(createMixerRow("vocals", "Vocals"));
  } else {
    mixer.appendChild(createMixerRow("mix", "Mix"));
  }
}

function resolveTrackAssetUrl(candidate: string, baseTrackUrl: string) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, location.origin).toString();
  if (raw.startsWith("assets/")) return new URL(`/${raw}`, location.origin).toString();
  return new URL(raw, baseTrackUrl).toString();
}

function normalizeMsList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)));
}

async function loadBeatGuidance(nextTrack: Track, baseTrackUrl: string) {
  const trackBeats = normalizeMsList(nextTrack?.timing?.beatsMs);
  const trackDownbeats = normalizeMsList(nextTrack?.timing?.downbeatTimesMs);
  pulseBeatTimesMs = trackBeats;
  pulseDownbeatTimesMs = trackDownbeats;

  const samplePath =
    nextTrack.assetPaths?.instrumental ||
    nextTrack.assetPaths?.mix ||
    nextTrack.audio?.path ||
    "";
  if (!samplePath) return;

  const baseAssetPath = String(samplePath).replace(/[^/\\]+$/, "beats.json");
  const beatsUrl = resolveTrackAssetUrl(baseAssetPath, baseTrackUrl);
  try {
    const r = await fetch(beatsUrl);
    if (!r.ok) return;
    const j = await r.json();
    const beats = normalizeMsList(j?.beatTimesMs);
    const downbeats = normalizeMsList(j?.downbeatTimesMs);
    if (beats.length) pulseBeatTimesMs = beats;
    if (downbeats.length) pulseDownbeatTimesMs = downbeats;
  } catch {
    // Non-fatal: pulse falls back to timing embedded in track json.
  }
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
    if (stemsActive()) {
      audioVocals.currentTime = audio.currentTime;
    }
    await audio.play().catch(() => undefined);
    if (stemsActive()) {
      await audioVocals.play().catch(() => undefined);
    }
  } else {
    audio.pause();
    if (stemsActive()) audioVocals.pause();
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
  if (audio.readyState < 1) {
    if (!audio.preload) audio.preload = "metadata";
    audio.load();
    await once(audio, "loadedmetadata");
  }
  if (stemsActive() && audioVocals.readyState < 1) {
    if (!audioVocals.preload) audioVocals.preload = "metadata";
    audioVocals.load();
    await once(audioVocals, "loadedmetadata");
  }
}

async function seekToSeconds(seconds: number) {
  await ensureMetadataLoaded();
  audio.pause();
  if (stemsActive()) audioVocals.pause();
  audio.currentTime = seconds;
  if (stemsActive()) audioVocals.currentTime = seconds;
  await once(audio, "seeked");
}

function beginSeek() {
  isSeeking = true;
  wasPlayingBeforeSeek = !audio.paused;
  audio.pause();
  if (stemsActive()) audioVocals.pause();
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
      if (stemsActive()) audioVocals.currentTime = audio.currentTime;
      await audio.play().catch((err) => {
        logAudioState("play-resume-failed", { err: err instanceof Error ? err.message : String(err) });
        return undefined;
      });
      if (stemsActive()) {
        await audioVocals.play().catch(() => undefined);
      }
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
  if (audioCtx) {
    applyMixerGains();
    return;
  }
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  audioData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

  masterGain = audioCtx.createGain();
  primaryGain = audioCtx.createGain();
  vocalsGain = audioCtx.createGain();

  const primarySrc = audioCtx.createMediaElementSource(audio);
  const vocalsSrc = audioCtx.createMediaElementSource(audioVocals);
  primarySrc.connect(primaryGain);
  vocalsSrc.connect(vocalsGain);
  primaryGain.connect(masterGain);
  vocalsGain.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
  applyMixerGains();
}

function rebuildAudioGraph(reason: string) {
  void reason;
  // Audio graph is intentionally stable because media element sources
  // cannot be safely recreated multiple times across context resets.
  ensureAudioGraph();
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

function nearestPulse(currentTimeMs: number, times: number[], cutoffMs: number, decayMs: number) {
  if (!times.length) return 0;
  let nearest = Infinity;
  for (const t of times) {
    const d = Math.abs(t - currentTimeMs);
    if (d < nearest) nearest = d;
  }
  return nearest > cutoffMs ? 0 : Math.exp(-nearest / decayMs);
}

function inferredDownbeats(beats: number[]) {
  if (!beats.length) return [];
  if (beats.length < 4) return [beats[0]];
  return beats.filter((_, i) => i % 4 === 0);
}

function beatPulseInfo(currentTimeMs: number) {
  const beats = pulseBeatTimesMs;
  const downbeats = (pulseDownbeatTimesMs?.length
    ? pulseDownbeatTimesMs
    : inferredDownbeats(beats)) ?? [];
  return {
    beat: nearestPulse(currentTimeMs, beats, 220, 90),
    downbeat: nearestPulse(currentTimeMs, downbeats, 280, 110)
  };
}

function hasLyricTiming() {
  return Boolean((track?.timing?.lyricsLines ?? []).some((x) => typeof x?.t0Ms === "number"));
}

function drawBeatOrb(beat: number, downbeat: number) {
  const w = canvas.width;
  const h = canvas.height;
  const minDim = Math.min(w, h);
  const base = minDim * 0.048;
  const radius = base * (1 + beat * 0.18 + downbeat * 0.42);
  const x = w * 0.5;
  const y = h * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = "screen";

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
  if (stemsActive() && !audio.paused) syncStemTiming();
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
  const pulse = beatPulseInfo(tRenderMs);
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
    lyricsEnabled: lyricsEnabled && hasLyricTiming(),
    lyricMode,
    uiLayout: {
      controlsTopPx: controlsRect.top,
      viewportHeightPx
    }
  });
  drawBeatOrb(pulse.beat, pulse.downbeat);

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
    `playback: ${playbackMode}`,
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
  await loadBeatGuidance(track, trackUrl);
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

  const hasStems = isStemsTrack(track);
  playbackMode = hasStems ? "stems" : "mix";
  renderMixerControls();
  const mixPath = track.assetPaths?.mix || track.audio.path;
  const backingPath = track.assetPaths?.instrumental || mixPath;
  const vocalsPath = track.assetPaths?.vocals || "";
  const audioUrl = resolveTrackAssetUrl(hasStems ? backingPath : mixPath, trackUrl);
  const wasPlaying = !audio.paused;
  audio.pause();
  audioVocals.pause();
  audio.src = audioUrl;
  audio.load();
  if (hasStems && vocalsPath) {
    audioVocals.src = resolveTrackAssetUrl(vocalsPath, trackUrl);
    audioVocals.load();
  } else {
    audioVocals.removeAttribute("src");
    audioVocals.load();
  }
  ensureAudioGraph();
  applyMixerGains();

  if (!Number.isInteger(seed)) {
    buildScene(hashStringToSeed(track.trackId || trackId));
    updateUrlParam("seed", String(seed));
  } else {
    buildScene(seed);
  }

  if (wasPlaying) {
    if (hasStems) audioVocals.currentTime = audio.currentTime;
    await audio.play().catch(() => undefined);
    if (hasStems) await audioVocals.play().catch(() => undefined);
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
    if (stemsActive()) audioVocals.currentTime = 0;
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
    if (stemsActive()) audioVocals.currentTime = audio.currentTime;
    return;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    const maxT = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5;
    audio.currentTime = Math.min(maxT, audio.currentTime + 5);
    if (stemsActive()) audioVocals.currentTime = audio.currentTime;
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
  if (stemsActive() && audioVocals.paused) {
    audioVocals.currentTime = audio.currentTime;
    void audioVocals.play().catch(() => undefined);
  }
  logAudioState("play");
  setPlayButtonIcon();
});
audio.addEventListener("seeking", () => {
  void resumeAudioContext();
  if (stemsActive()) audioVocals.currentTime = audio.currentTime;
  logAudioState("seeking");
});
audio.addEventListener("seeked", () => {
  logAudioState("seeked");
});
audio.addEventListener("pause", () => {
  if (stemsActive()) audioVocals.pause();
  logAudioState("pause");
  setPlayButtonIcon();
});
audio.addEventListener("ended", async () => {
  if (stemsActive()) audioVocals.pause();
  await goNextTrack();
  ensureAudioGraph();
  await resumeAudioContext();
  await audio.play().catch(() => undefined);
  if (stemsActive()) {
    audioVocals.currentTime = audio.currentTime;
    await audioVocals.play().catch(() => undefined);
  }
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

