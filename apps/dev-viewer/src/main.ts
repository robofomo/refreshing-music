import "./style.css";
import { createEngine, hashStringToSeed } from "../../../packages/engine/src/index";
import { classifySection } from "../../../packages/engine/src/sections";
import { resolveResolvable } from "../../../packages/engine/src/resolvable";

declare const __AUTHORING_MODE__: boolean;
declare const __RELEASE_MODE__: boolean;

type TimingSection = { id?: string; t0Ms?: number; t1Ms?: number };
type TimingLyric = { i?: number; t0Ms?: number; t1Ms?: number };
type TimingWord = { i?: number; t0Ms?: number; t1Ms?: number; text?: string; conf?: number };
type HintOverlay = {
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat";
  tSec: number;
  payload?: { beatInBar?: number };
  at?: string;
  actor?: string;
};
type EffectiveState = {
  effective?: {
    beatsMs?: number[];
    downbeatTimesMs?: number[];
    beatMarkers?: Array<{ tMs?: number; source?: "hint" | "inferred" | "ai" | "corrected" }>;
    downbeatMarkers?: Array<{ tMs?: number; source?: "hint" | "inferred" | "ai" | "corrected" }>;
    aiDownbeatMarkers?: Array<{ tMs?: number; source?: "ai" }>;
  };
  hints?: {
    eventsCount?: number;
    beatFusionMode?: string;
    fusionWindowsSec?: Array<{ t0Sec?: number; t1Sec?: number }>;
  };
  overlays?: HintOverlay[];
};
type Track = {
  title: string;
  trackId: string;
  workId?: string;
  slug: string;
  composer?: { headerMap?: Record<string, string> };
  audio: { path: string; filename?: string };
  assetPaths?: {
    mix?: string;
    mixWav?: string;
    stemsZip?: string;
    instrumental?: string;
    instrumentalWav?: string;
    vocals?: string;
    vocalsWav?: string;
    effective?: string;
    composer?: string;
  };
  sections?: Array<{ id: string; labelRaw?: string }>;
  lyrics?: { rawText?: string };
  timing?: {
    sections?: TimingSection[];
    lyricsLines?: TimingLyric[];
    words?: TimingWord[];
    beatsMs?: number[];
    downbeatTimesMs?: number[];
  };
  recipeRef?: { albumId?: string; trackOverrideId?: string };
};

type PlaybackMode = "mix" | "stems";
type ViewerMode = "hint-edit" | "primitive-lab" | "graph-scene";
const VIEWER_MODES: ViewerMode[] = ["hint-edit", "primitive-lab", "graph-scene"];
type LabPrimitiveId = "shape.circlePulse" | "polyline.orbitRibbon" | "text.echoWord";
const LAB_PRIMITIVES: LabPrimitiveId[] = ["shape.circlePulse", "polyline.orbitRibbon", "text.echoWord"];
type ViewerSignalBus = {
  time: {
    audioMs: number;
    renderMs: number;
    offsetMs: number;
    durationSec: number;
    currentSec: number;
  };
  transport: {
    playing: boolean;
    isSeeking: boolean;
    seekInFlight: boolean;
    pendingSeekRatio: number;
    playbackMode: PlaybackMode;
    viewerMode: ViewerMode;
  };
  section: {
    id: string;
    type: string;
  };
  beat: {
    pulse: number;
    downbeatPulse: number;
    beatCount: number;
    downbeatCount: number;
    fusionMode: string;
  };
  hints: {
    count: number;
    fusionModeLabel: string;
    aiDownbeats: number;
  };
  audio: {
    amp: number;
    seed: number;
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
const modeBtn = document.getElementById("modeBtn") as HTMLButtonElement;
const labCopyBtn = document.getElementById("labCopyBtn") as HTMLButtonElement;
const hudBtn = document.getElementById("hudBtn") as HTMLButtonElement;
const controls = document.getElementById("controls") as HTMLDivElement;
const mixer = document.getElementById("mixer") as HTMLDivElement;
const seek = document.getElementById("seek") as HTMLInputElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const audioVocals = document.createElement("audio");
const ctx = canvas.getContext("2d");

if (!ctx) throw new Error("Canvas2D not supported");

audio.preload = "auto";
audioVocals.preload = "auto";
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
let beatMarkers: Array<{ tMs: number; source: "hint" | "inferred" | "ai" }> = [];
let downbeatMarkers: Array<{ tMs: number; source: "hint" | "inferred" | "ai" | "corrected" }> = [];
let aiDownbeatMarkers: Array<{ tMs: number; source: "ai" }> = [];
let hintOverlays: HintOverlay[] = [];
let activeHintCount = 0;
let beatFusionModeLabel = "-";
let fusionWindowsMs: Array<{ t0Ms: number; t1Ms: number }> = [];
let lastSeekTargetSec = 0;
let lastSeekActualSec = 0;
let lastSeekErrorMs = 0;
let hintPersistTimer = 0;
let hintRevision = 0;
let latestQueuedBatchRevision = 0;
const HINT_PERSIST_DEBOUNCE_MS = 1000;
const pendingHintEvents: Array<{
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat";
  tSec: number;
  payload?: { beatInBar?: number; groupId?: string };
}> = [];
const SEEK_SCALE = 100000;

let seed = 1;
const DEFAULT_RENDER_OFFSET_MS = -240;
const MIN_RENDER_OFFSET_MS = -500;
const MAX_RENDER_OFFSET_MS = 500;
let renderOffsetMs = DEFAULT_RENDER_OFFSET_MS;
let hudVisible = new URL(location.href).searchParams.get("hud") === "1";
let lyricsEnabled = new URL(location.href).searchParams.get("lyrics") !== "0";
let lyricMode = new URL(location.href).searchParams.get("lyricMode") || "center";
let viewerMode: ViewerMode = "hint-edit";
let labPrimitive: LabPrimitiveId = LAB_PRIMITIVES[0];
let labCopyFlashUntilMs = 0;
let determinismProbeStatus = "idle";
let determinismProbeAtIso = "";
let determinismProbeRequested = false;
let isSeeking = false;
let pendingSeekRatio = 0;
let wasPlayingBeforeSeek = false;
let seekInFlight = false;
const ampHistory: Array<{ tMs: number; amp: number }> = [];
let playbackMode: PlaybackMode = "mix";
const mixerState = {
  mix: { volume: 0.85, muted: false },
  backing: { volume: 0.85, muted: false },
  vocals: { volume: 0.85, muted: false }
};
seek.min = "0";
seek.max = String(SEEK_SCALE);
seek.step = "1";

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
let stemResyncTimer = 0;
let stemForceSyncUntilMs = 0;
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

function preferredTrackTitle(next: Track | null) {
  if (!next) return "-";
  const hm = next.composer?.headerMap ?? {};
  const songTitle = Object.entries(hm).find(([k]) => k.toLowerCase() === "song title");
  if (songTitle && String(songTitle[1]).trim()) return String(songTitle[1]).trim();
  const compactSongTitle = Object.entries(hm).find(([k]) => k.toLowerCase() === "songtitle");
  if (compactSongTitle && String(compactSongTitle[1]).trim()) return String(compactSongTitle[1]).trim();
  const title = Object.entries(hm).find(([k]) => k.toLowerCase() === "title");
  if (title && String(title[1]).trim()) return String(title[1]).trim();
  return next.title ?? "-";
}

function updateUrlParam(key: string, value: string | null) {
  const u = new URL(location.href);
  if (value === null) u.searchParams.delete(key);
  else u.searchParams.set(key, value);
  history.replaceState({}, "", u);
}

function normalizeViewerMode(value: string | null | undefined): ViewerMode {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "playback" || raw === "hint-edit") return "hint-edit";
  if (raw === "primitive-lab" || raw === "graph-scene") return raw;
  return "hint-edit";
}

function setViewerMode(nextMode: ViewerMode) {
  viewerMode = nextMode;
  updateUrlParam("mode", nextMode === "hint-edit" ? null : nextMode);
  if (modeBtn) modeBtn.textContent = nextMode;
}

function isHintEditMode() {
  return viewerMode === "hint-edit";
}

function cycleViewerMode() {
  const i = VIEWER_MODES.indexOf(viewerMode);
  const next = VIEWER_MODES[(i + 1) % VIEWER_MODES.length];
  setViewerMode(next);
  refreshLabControls();
}

function cycleLabPrimitive(dir: 1 | -1) {
  const i = LAB_PRIMITIVES.indexOf(labPrimitive);
  const next = (i + dir + LAB_PRIMITIVES.length) % LAB_PRIMITIVES.length;
  labPrimitive = LAB_PRIMITIVES[next];
  refreshLabControls();
}

function labSeedForPrimitive() {
  return (seed ^ hashStringToSeed(`lab:${labPrimitive}`)) >>> 0;
}

function currentLabProfile() {
  const rng = mulberry32(labSeedForPrimitive());
  const scale = 0.7 + rng() * 1.5;
  const density = 0.65 + rng() * 1.65;
  const variant = Math.floor(rng() * 1000);
  return { scale, density, variant };
}

function activeLabSnippet() {
  const profile = currentLabProfile();
  const scale = Number(profile.scale.toFixed(3));
  const density = Number(profile.density.toFixed(3));
  const pulseMul = Number((0.16 * scale).toFixed(3));
  if (labPrimitive === "shape.circlePulse") {
    return `{
  "id": "lab-circle",
  "module": "primitive.circlePulse",
  "blend": "screen",
  "params": {
    "radiusPx": {"map":"beat.downbeatPulse","from":[0,1],"to":[48,${Math.round(120 * scale)}],"ease":"out"},
    "ringCount": ${Math.max(4, Math.round(9 * density))},
    "alpha": {"add":[0.2, {"mul":[{"signal":"audio.amp"},${pulseMul}]}]}
  }
}`;
  }
  if (labPrimitive === "polyline.orbitRibbon") {
    return `{
  "id": "lab-ribbon",
  "module": "primitive.orbitRibbon",
  "blend": "screen",
  "params": {
    "points": ${Math.max(24, Math.round(48 * density))},
    "radiusPx": ${Math.round(130 * scale)},
    "thicknessPx": {"map":"beat.pulse","from":[0,1],"to":[1.2,3.2],"ease":"inOut"},
    "phaseHz": {"pick":[0.05,0.08,0.12],"w":[1,2,1]}
  }
}`;
  }
  return `{
  "id": "lab-text",
  "module": "primitive.echoWord",
  "params": {
    "fontPx": ${Math.round(42 * scale)},
    "echoCount": ${Math.max(2, Math.round(5 * density))},
    "driftPx": {"lfo":{"hz":0.22,"amp":${Math.round(12 * scale)},"wave":"sine"}},
    "alpha": {"map":"audio.amp","from":[0,0.35],"to":[0.62,0.96]}
  }
}`;
}

function activeGraphSnippet() {
  return `{
  "graph": {
    "layers": [
      {
        "id": "base",
        "blend": "screen",
        "opacity": 1,
        "nodes": [
          { "id": "pulse", "type": "shape.circlePulse", "params": { "ringCount": 8, "radiusPx": 88, "alpha": 0.18 } },
          { "id": "ribbon", "type": "polyline.orbitRibbon", "params": { "points": 60, "radiusPx": 170, "thicknessPx": 1.7, "phaseHz": 0.08 } },
          { "id": "word", "type": "text.echoWord", "params": { "fontPx": 30, "echoCount": 4, "driftPx": 12 } }
        ]
      }
    ]
  }
}`;
}

function refreshLabControls() {
  if (!labCopyBtn) return;
  const canCopy = viewerMode === "primitive-lab" || viewerMode === "graph-scene";
  labCopyBtn.disabled = !canCopy;
  labCopyBtn.textContent = canCopy ? "lab copy" : "lab off";
}

async function copyLabSnippet() {
  if (viewerMode !== "primitive-lab" && viewerMode !== "graph-scene") return;
  const text = viewerMode === "graph-scene" ? activeGraphSnippet() : activeLabSnippet();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      labCopyFlashUntilMs = performance.now() + 1800;
      return;
    }
  } catch {
    // Fall through to hidden textarea fallback.
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "true");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    labCopyFlashUntilMs = performance.now() + 1800;
  } finally {
    document.body.removeChild(ta);
  }
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

function clearStemResyncTimer() {
  if (stemResyncTimer) {
    window.clearInterval(stemResyncTimer);
    stemResyncTimer = 0;
  }
}

function syncStemTiming() {
  if (!stemsActive() || !audioVocals.src) return;
  if (audioVocals.readyState < 2) return;
  const drift = audio.currentTime - audioVocals.currentTime;
  const absDrift = Math.abs(drift);
  const now = performance.now();
  const inForceWindow = now < stemForceSyncUntilMs;
  const hardSnapThreshold = inForceWindow ? 0.018 : 0.06;
  if (absDrift > hardSnapThreshold) {
    audioVocals.currentTime = audio.currentTime;
    audioVocals.playbackRate = 1;
    return;
  }
  if (inForceWindow && absDrift > 0.004) {
    const adjust = Math.max(-0.04, Math.min(0.04, drift * 0.65));
    audioVocals.playbackRate = 1 + adjust;
    return;
  }
  audioVocals.playbackRate = 1;
}

function scheduleStemResyncWindow(durationMs = 1400) {
  if (!stemsActive()) return;
  clearStemResyncTimer();
  const t0 = performance.now();
  stemForceSyncUntilMs = t0 + durationMs;
  stemResyncTimer = window.setInterval(() => {
    if (!stemsActive() || audio.paused) {
      clearStemResyncTimer();
      return;
    }
    syncStemTiming();
    if (performance.now() - t0 >= durationMs) {
      clearStemResyncTimer();
    }
  }, 90);
}

function waitForCanPlay(el: HTMLMediaElement, timeoutMs = 4000) {
  if (el.readyState >= 3) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener("canplay", onCanPlay);
      if (timer) window.clearTimeout(timer);
      resolve();
    };
    const onCanPlay = () => finish();
    el.addEventListener("canplay", onCanPlay, { once: true });
    const timer = window.setTimeout(finish, timeoutMs);
  });
}

async function playSynced() {
  if (!stemsActive()) {
    await audio.play().catch((err) => {
      logAudioState("play-failed", { err: err instanceof Error ? err.message : String(err) });
      return undefined;
    });
    return;
  }

  await ensureMetadataLoaded();
  audioVocals.currentTime = audio.currentTime;
  audio.playbackRate = 1;
  audioVocals.playbackRate = 1;
  await Promise.all([waitForCanPlay(audio), waitForCanPlay(audioVocals)]);
  const [main, vocals] = await Promise.allSettled([audio.play(), audioVocals.play()]);
  if (main.status === "rejected") {
    logAudioState("play-main-failed", {
      err: main.reason instanceof Error ? main.reason.message : String(main.reason)
    });
  }
  if (vocals.status === "rejected") {
    logAudioState("play-vocals-failed", {
      err: vocals.reason instanceof Error ? vocals.reason.message : String(vocals.reason)
    });
  }
  syncStemTiming();
  scheduleStemResyncWindow(3500);
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

function resolveAssetDirUrl(nextTrack: Track, baseTrackUrl: string) {
  const rel = String(nextTrack.assetDir || "").trim();
  if (rel) return resolveTrackAssetUrl(rel, baseTrackUrl).replace(/\/+$/, "");
  const mixish = nextTrack.assetPaths?.mix || nextTrack.audio?.path || "";
  return resolveTrackAssetUrl(String(mixish).replace(/[^/\\]+$/, ""), baseTrackUrl).replace(/\/+$/, "");
}

function mergeHintOverlays(overlays: HintOverlay[]) {
  hintOverlays = overlays
    .filter((x) => Number.isFinite(Number(x?.tSec)) && Number(x.tSec) >= 0)
    .map((x) => ({
      type: x.type,
      tSec: Number(x.tSec),
      payload: x.payload && typeof x.payload === "object" ? x.payload : undefined,
      at: x.at,
      actor: x.actor
    }))
    .sort((a, b) => a.tSec - b.tSec);
  activeHintCount = hintOverlays.length;
}

function addOrUpdateMarker(
  markers: Array<{ tMs: number; source: "hint" | "inferred" | "ai" }>,
  tMs: number,
  source: "hint" | "inferred" | "ai",
  tolMs = 90
) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  for (let i = 0; i < markers.length; i += 1) {
    if (Math.abs(markers[i].tMs - ms) <= tolMs) {
      markers[i] = {
        tMs: ms,
        source: source === "hint" || markers[i].source === "hint" ? "hint" : markers[i].source
      };
      return;
    }
  }
  markers.push({ tMs: ms, source });
}

function removeMarkerNear(
  markers: Array<{ tMs: number; source: "hint" | "inferred" | "ai" }>,
  tMs: number,
  tolMs = 120
) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    if (Math.abs(markers[i].tMs - ms) <= tolMs) markers.splice(i, 1);
  }
}

function makeHintGroupId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `grp_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function applyHintEventOptimistic(event: { type: "hint/downbeat" | "hint/beat" | "hint/barBeat"; tSec: number; payload?: { beatInBar?: number; groupId?: string } }) {
  const tMs = Math.max(0, Math.round(event.tSec * 1000));
  if (event.type === "hint/beat" || event.type === "hint/barBeat" || event.type === "hint/downbeat") {
    pulseBeatTimesMs = normalizeMsList([...pulseBeatTimesMs, tMs]);
    addOrUpdateMarker(beatMarkers, tMs, "hint");
  }
  if (event.type === "hint/downbeat" || (event.type === "hint/barBeat" && Number(event.payload?.beatInBar) === 1)) {
    pulseDownbeatTimesMs = normalizeMsList([...pulseDownbeatTimesMs, tMs]);
    addOrUpdateMarker(downbeatMarkers, tMs, "hint");
  }
  if (event.type === "hint/beat") {
    // In authoring semantics, 'b' on a downbeat clears it.
    removeMarkerNear(downbeatMarkers, tMs, 140);
    pulseDownbeatTimesMs = normalizeMsList(downbeatMarkers.map((m) => m.tMs));
  }
  hintOverlays.push({ type: event.type, tSec: event.tSec, payload: event.payload, actor: "user", at: new Date().toISOString() });
  hintOverlays.sort((a, b) => a.tSec - b.tSec);
  activeHintCount = hintOverlays.length;
}

async function postAuthoringHintEvents(
  events: Array<{ type: "hint/downbeat" | "hint/beat" | "hint/barBeat"; tSec: number; payload?: { beatInBar?: number; groupId?: string } }>,
  batchRevision: number
) {
  if (!events.length || !track?.trackId || !track?.workId) return;
  const activeTrackId = track.trackId;
  const activeWorkId = track.workId;
  for (const ev of events) {
    await fetch("/authoring/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actor: "user",
        type: ev.type,
        trackId: track.trackId,
        workId: track.workId,
        tSec: ev.tSec,
        payload: ev.payload || {}
      })
    }).catch(() => undefined);
  }
  await fetch("/authoring/reduce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId: activeTrackId, workId: activeWorkId })
  }).catch(() => undefined);
  if (
    track?.trackId === activeTrackId &&
    track?.workId === activeWorkId &&
    batchRevision === latestQueuedBatchRevision
  ) {
    await loadEffectiveGuidance(track, trackUrl);
  }
}

function queueHintEvent(event: { type: "hint/downbeat" | "hint/beat" | "hint/barBeat"; tSec: number; payload?: { beatInBar?: number; groupId?: string } }) {
  if (!__AUTHORING_MODE__) return;
  hintRevision += 1;
  pendingHintEvents.push(event);
  if (hintPersistTimer) window.clearTimeout(hintPersistTimer);
  hintPersistTimer = window.setTimeout(() => {
    const batch = pendingHintEvents.splice(0, pendingHintEvents.length);
    if (!batch.length) return;
    const groupId = makeHintGroupId();
    for (const item of batch) {
      item.payload = { ...(item.payload || {}), groupId };
    }
    const batchRevision = hintRevision;
    latestQueuedBatchRevision = batchRevision;
    void postAuthoringHintEvents(batch, batchRevision);
  }, HINT_PERSIST_DEBOUNCE_MS);
}

async function undoLastHintGroupForCurrentTrack() {
  if (!__AUTHORING_MODE__ || !track?.trackId || !track?.workId) return;
  if (hintPersistTimer) {
    window.clearTimeout(hintPersistTimer);
    hintPersistTimer = 0;
  }
  if (pendingHintEvents.length > 0) {
    pendingHintEvents.splice(0, pendingHintEvents.length);
    hintRevision += 1;
    latestQueuedBatchRevision = hintRevision;
    if (track) await loadEffectiveGuidance(track, trackUrl);
    return;
  }
  hintRevision += 1;
  latestQueuedBatchRevision = hintRevision;
  await fetch("/authoring/events/undo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId: track.trackId, workId: track.workId })
  }).catch(() => undefined);
  if (track) await loadEffectiveGuidance(track, trackUrl);
}

function currentHintCaptureSec() {
  const base = Number(audio.currentTime) || 0;
  const shifted = base + renderOffsetMs / 1000;
  return Math.max(0, shifted);
}

async function clearHintEventsForCurrentTrack() {
  if (!__AUTHORING_MODE__ || !track?.trackId || !track?.workId) return;
  pendingHintEvents.splice(0, pendingHintEvents.length);
  latestQueuedBatchRevision = hintRevision;
  if (hintPersistTimer) {
    window.clearTimeout(hintPersistTimer);
    hintPersistTimer = 0;
  }
  hintOverlays = [];
  beatMarkers = [];
  downbeatMarkers = [];
  aiDownbeatMarkers = [];
  activeHintCount = 0;
  await fetch("/authoring/events/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId: track.trackId, workId: track.workId })
  }).catch(() => undefined);
  if (track) await loadEffectiveGuidance(track, trackUrl);
}

function dirnamePosix(p: string) {
  const s = String(p || "").replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(0, i) : "";
}

async function assetExists(candidateUrl: string) {
  if (!candidateUrl) return false;
  try {
    const resp = await fetch(candidateUrl, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store"
    });
    if (!(resp.ok || resp.status === 206)) return false;
    const ctype = String(resp.headers.get("content-type") || "").toLowerCase();
    return ctype.startsWith("audio/");
  } catch {
    return false;
  }
}

async function resolvePlaybackAssets(nextTrack: Track, baseTrackUrl: string) {
  const mixPath = nextTrack.assetPaths?.mix || nextTrack.audio.path;
  let backingPath = nextTrack.assetPaths?.instrumental || "";
  let vocalsPath = nextTrack.assetPaths?.vocals || "";

  if (!backingPath || !vocalsPath) {
    const baseRel = dirnamePosix(mixPath || nextTrack.audio.path);
    if (baseRel) {
      const fallbackBacking = `${baseRel}/instrumental.mp3`;
      const fallbackVocals = `${baseRel}/vocals.mp3`;
      const fallbackBackingUrl = resolveTrackAssetUrl(fallbackBacking, baseTrackUrl);
      const fallbackVocalsUrl = resolveTrackAssetUrl(fallbackVocals, baseTrackUrl);
      const [hasBacking, hasVocals] = await Promise.all([
        assetExists(fallbackBackingUrl),
        assetExists(fallbackVocalsUrl)
      ]);
      if (hasBacking && hasVocals) {
        backingPath = backingPath || fallbackBacking;
        vocalsPath = vocalsPath || fallbackVocals;
      }
    }
  }

  const hasStems = Boolean(backingPath && vocalsPath);
  return { hasStems, mixPath, backingPath: backingPath || mixPath, vocalsPath };
}

function normalizeMsList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)));
}

function fusionModeAt(tMs: number) {
  const t = Math.max(0, Math.round(Number(tMs) || 0));
  const inWindow = fusionWindowsMs.some((w) => t >= w.t0Ms && t <= w.t1Ms);
  if (beatFusionModeLabel === "tempo-override-windowed") {
    return inWindow ? "tempo-override-windowed" : "ai-plus-snapped-hints";
  }
  if (beatFusionModeLabel === "ai-with-local-overrides") {
    return inWindow ? "ai-with-local-overrides" : "ai-plus-snapped-hints";
  }
  return beatFusionModeLabel;
}

async function loadEffectiveGuidance(nextTrack: Track, baseTrackUrl: string) {
  const trackBeats = normalizeMsList(nextTrack?.timing?.beatsMs);
  pulseBeatTimesMs = trackBeats;
  pulseDownbeatTimesMs = [];
  beatMarkers = [];
  downbeatMarkers = [];
  aiDownbeatMarkers = [];
  hintOverlays = [];
  activeHintCount = 0;
  beatFusionModeLabel = "-";
  fusionWindowsMs = [];

  const assetDirUrl = resolveAssetDirUrl(nextTrack, baseTrackUrl);
  if (!assetDirUrl) return;

  const effectiveUrl = nextTrack.assetPaths?.effective
    ? resolveTrackAssetUrl(nextTrack.assetPaths.effective, baseTrackUrl)
    : `${assetDirUrl}/effective.json`;
  try {
    const r = await fetch(effectiveUrl, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as EffectiveState;
      const beats = normalizeMsList(j?.effective?.beatsMs);
      const downbeats = normalizeMsList(j?.effective?.downbeatTimesMs);
      if (beats.length) pulseBeatTimesMs = beats;
      if (downbeats.length) pulseDownbeatTimesMs = downbeats;
      beatMarkers = Array.isArray(j?.effective?.beatMarkers)
        ? j.effective.beatMarkers
          .map((m) => ({
            tMs: Math.max(0, Math.round(Number(m?.tMs))),
            source: m?.source === "hint"
              ? "hint" as const
              : m?.source === "ai"
                ? "ai" as const
                : "inferred" as const
          }))
          .filter((m) => Number.isFinite(m.tMs))
        : [];
      downbeatMarkers = Array.isArray(j?.effective?.downbeatMarkers)
        ? j.effective.downbeatMarkers
          .map((m) => ({
            tMs: Math.max(0, Math.round(Number(m?.tMs))),
            source: m?.source === "hint"
              ? "hint" as const
              : m?.source === "ai"
                ? "ai" as const
                : m?.source === "corrected"
                  ? "corrected" as const
                : "inferred" as const
          }))
          .filter((m) => Number.isFinite(m.tMs))
        : [];
      aiDownbeatMarkers = Array.isArray(j?.effective?.aiDownbeatMarkers)
        ? j.effective.aiDownbeatMarkers
          .map((m) => ({
            tMs: Math.max(0, Math.round(Number(m?.tMs))),
            source: "ai" as const
          }))
          .filter((m) => Number.isFinite(m.tMs))
        : [];
      beatFusionModeLabel = String(j?.hints?.beatFusionMode || "-");
      fusionWindowsMs = Array.isArray(j?.hints?.fusionWindowsSec)
        ? j.hints.fusionWindowsSec
          .map((w) => ({
            t0Ms: Math.max(0, Math.round(Number(w?.t0Sec) * 1000)),
            t1Ms: Math.max(0, Math.round(Number(w?.t1Sec) * 1000))
          }))
          .filter((w) => Number.isFinite(w.t0Ms) && Number.isFinite(w.t1Ms) && w.t1Ms >= w.t0Ms)
        : [];
      mergeHintOverlays(Array.isArray(j?.overlays) ? j.overlays : []);
      activeHintCount = Number.isFinite(Number(j?.hints?.eventsCount))
        ? Math.max(0, Math.round(Number(j?.hints?.eventsCount)))
        : hintOverlays.length;
      return;
    }
  } catch {
    // Non-fatal: fall through to raw sidecars.
  }

  try {
    const beatsResp = await fetch(`${assetDirUrl}/beats.json`, { cache: "no-store" });
    if (beatsResp.ok) {
      const beatsJson = await beatsResp.json();
      const beats = normalizeMsList(beatsJson?.beatTimesMs);
      if (beats.length) pulseBeatTimesMs = beats;
    }
  } catch {
    // Keep existing track timing fallback.
  }

  if (!Array.isArray(nextTrack?.timing?.words) || nextTrack.timing.words.length === 0) {
    try {
      const wordsResp = await fetch(`${assetDirUrl}/words.json`, { cache: "no-store" });
      if (wordsResp.ok) {
        const wordsJson = await wordsResp.json();
        const words = Array.isArray(wordsJson?.words)
          ? wordsJson.words
            .map((w: any) => ({
              i: Number.isInteger(w?.i) ? w.i : undefined,
              t0Ms: Number.isFinite(Number(w?.t0Ms)) ? Math.max(0, Math.round(Number(w?.t0Ms))) : undefined,
              t1Ms: Number.isFinite(Number(w?.t1Ms)) ? Math.max(0, Math.round(Number(w?.t1Ms))) : undefined,
              text: String(w?.text ?? ""),
              conf: Number.isFinite(Number(w?.conf)) ? Number(w.conf) : undefined
            }))
            .filter((w: any) => Number.isFinite(w.t0Ms) && w.text)
          : [];
        if (!nextTrack.timing) nextTrack.timing = {};
        if (words.length) nextTrack.timing.words = words;
      }
    } catch {
      // Optional fallback only.
    }
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
    await playSynced();
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
  const stemsNow = stemsActive();
  if (stemsNow) audioVocals.pause();
  const waitPrimary = once(audio, "seeked");
  const waitVocals = stemsNow ? once(audioVocals, "seeked") : Promise.resolve();
  audio.currentTime = seconds;
  if (stemsNow) audioVocals.currentTime = seconds;
  await Promise.all([waitPrimary, waitVocals]);

  // Some browsers land compressed-audio seeks slightly off target; nudge once if needed.
  if (Math.abs((Number(audio.currentTime) || 0) - seconds) > 0.03) {
    const waitPrimaryNudge = once(audio, "seeked");
    audio.currentTime = seconds;
    await waitPrimaryNudge;
  }

  if (stemsNow && Math.abs((Number(audioVocals.currentTime) || 0) - seconds) > 0.03) {
    const waitVocalsNudge = once(audioVocals, "seeked");
    audioVocals.currentTime = seconds;
    await waitVocalsNudge;
  }

  await waitForCanPlay(audio);
  if (stemsNow) {
    await waitForCanPlay(audioVocals);
    syncStemTiming();
    scheduleStemResyncWindow(6000);
  }
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
  const max = Math.max(1, Number(seek.max) || SEEK_SCALE);
  pendingSeekRatio = Math.max(0, Math.min(1, Number(seek.value) / max));
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
    lastSeekTargetSec = target;
    lastSeekActualSec = Number(audio.currentTime) || 0;
    lastSeekErrorMs = Math.round((lastSeekActualSec - lastSeekTargetSec) * 1000);
    resetAmpHistory("seek-complete");
    logAudioState("seek-complete", { target, actual: lastSeekActualSec, errorMs: lastSeekErrorMs });

    ensureAudioGraph();
    await resumeAudioContext();

    if (wasPlayingBeforeSeek) {
      await playSynced();
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

function resolveDisplayDownbeatSourceByBeat(
  effectiveBeats: Array<{ tMs: number; source: "hint" | "inferred" | "ai" | "corrected" }>,
  effectiveDownbeats: Array<{ tMs: number; source: "hint" | "inferred" | "ai" | "corrected" }>,
  aiOnlyDownbeats: Array<{ tMs: number; source: "ai" }>
) {
  const aiDownbeatMs = Array.from(new Set([
    ...aiOnlyDownbeats.map((d) => Math.max(0, Math.round(d.tMs))),
    ...effectiveDownbeats
      .filter((d) => d.source === "ai")
      .map((d) => Math.max(0, Math.round(d.tMs)))
  ])).sort((a, b) => a - b);
  const hintDownbeatMs = effectiveDownbeats
    .filter((d) => d.source === "hint")
    .map((d) => Math.max(0, Math.round(d.tMs)));
  const correctedDownbeatMs = effectiveDownbeats
    .filter((d) => d.source === "corrected")
    .map((d) => Math.max(0, Math.round(d.tMs)));
  const inferredDownbeatMs = effectiveDownbeats
    .filter((d) => d.source === "inferred")
    .map((d) => Math.max(0, Math.round(d.tMs)));
  const beatSteps: number[] = [];
  for (let i = 1; i < effectiveBeats.length; i += 1) {
    const d = Math.max(0, Math.round(effectiveBeats[i].tMs) - Math.round(effectiveBeats[i - 1].tMs));
    if (d > 40 && d < 5000) beatSteps.push(d);
  }
  beatSteps.sort((a, b) => a - b);
  const beatStepMs = beatSteps.length ? beatSteps[Math.floor(beatSteps.length / 2)] : 500;
  const snapConflictWindowMs = Math.max(220, Math.round(beatStepMs * 1.35));
  const hasNear = (xs: number[], target: number, tol: number) => {
    for (const x of xs) if (Math.abs(x - target) <= tol) return true;
    return false;
  };
  const sourceByMs = new Map<number, "hint" | "ai" | "inferred" | "corrected">();
  for (const b of effectiveBeats) {
    const ms = Math.max(0, Math.round(Number(b.tMs)));
    let downbeatSource: "hint" | "ai" | "inferred" | "corrected" | undefined;
    // Explicit hint beats lock intent. If user hinted this beat and it is not a hinted
    // downbeat, do not allow AI/inferred downbeat overlays on top of it.
    if (b.source === "hint") {
      if (hasNear(hintDownbeatMs, ms, 90)) {
        downbeatSource = "hint";
      } else {
        downbeatSource = undefined;
      }
    } else if (hasNear(hintDownbeatMs, ms, 90)) {
      downbeatSource = "hint";
    } else if (hasNear(correctedDownbeatMs, ms, 90)) {
      downbeatSource = "corrected";
    } else if (hasNear(aiDownbeatMs, ms, 90)) {
      downbeatSource = "ai";
    } else if (hasNear(inferredDownbeatMs, ms, 90)) {
      downbeatSource = hasNear(aiDownbeatMs, ms, snapConflictWindowMs) ? undefined : "inferred";
    }
    if (downbeatSource) sourceByMs.set(ms, downbeatSource);
  }
  return sourceByMs;
}

function beatPulseInfo(currentTimeMs: number) {
  const beats = pulseBeatTimesMs;
  const effectiveBeats = beatMarkers.length
    ? beatMarkers
    : (pulseBeatTimesMs ?? []).map((tMs) => ({ tMs: Number(tMs), source: "inferred" as const }));
  const effectiveDownbeats = downbeatMarkers.length
    ? downbeatMarkers
    : (pulseDownbeatTimesMs ?? []).map((tMs) => ({ tMs: Number(tMs), source: "inferred" as const }));
  const downbeatSourceByMs = resolveDisplayDownbeatSourceByBeat(effectiveBeats, effectiveDownbeats, aiDownbeatMarkers);
  const downbeats = Array.from(downbeatSourceByMs.keys());
  return {
    beat: nearestPulse(currentTimeMs, beats, 220, 90),
    downbeat: nearestPulse(currentTimeMs, downbeats, 280, 110)
  };
}

function hasLyricTiming() {
  if ((track?.timing?.lyricsLines ?? []).some((x) => typeof x?.t0Ms === "number")) return true;
  return Boolean((track?.timing?.words ?? []).some((x) => typeof x?.t0Ms === "number"));
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

function drawPrimitiveLabOverlay(signalBus: ViewerSignalBus) {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const t = signalBus.time.renderMs / 1000;
  const amp = signalBus.audio.amp;
  const beat = signalBus.beat.pulse;
  const downbeat = signalBus.beat.downbeatPulse;
  const profile = currentLabProfile();
  const labScale = profile.scale;
  const labDensity = profile.density;
  const labVariant = profile.variant;
  const ringCount = Math.max(3, Math.round((6 + labDensity * 4)));
  const baseR = Math.min(w, h) * 0.09 * labScale;
  const seedPhase = (((seed >>> 0) + labVariant) % 360) * (Math.PI / 180);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  if (labPrimitive === "shape.circlePulse") {
    for (let i = 0; i < ringCount; i += 1) {
      const u = i / Math.max(1, ringCount - 1);
      const phase = seedPhase + i * 0.7;
      const wobble = 1 + 0.16 * Math.sin(t * (0.6 + u * 0.9) + phase);
      const radius = baseR * (1 + u * 2.6) * wobble * (1 + amp * 0.22 + downbeat * 0.3);
      const alpha = 0.09 + (1 - u) * 0.13;
      const hue = Math.round(192 + 24 * Math.sin(phase + t * 0.2));
      ctx.strokeStyle = `hsla(${hue}, 84%, 68%, ${alpha})`;
      ctx.lineWidth = Math.max(1, 2.3 - u * 1.3);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (labPrimitive === "polyline.orbitRibbon") {
    const points = Math.max(24, Math.round(44 * labDensity));
    const r = baseR * (2.5 + beat * 0.6 + downbeat * 0.4);
    ctx.strokeStyle = `rgba(120, 198, 255, ${0.5 + amp * 0.35})`;
    ctx.lineWidth = 1.3 + beat * 1.6;
    ctx.beginPath();
    for (let i = 0; i <= points; i += 1) {
      const u = i / points;
      const a = u * Math.PI * 2 + t * (0.45 + labDensity * 0.15) + seedPhase;
      const drift = 1 + 0.2 * Math.sin((3 + labDensity) * a + t * 0.4 + labVariant * 0.1);
      const x = cx + Math.cos(a) * r * drift;
      const y = cy + Math.sin(a) * r * drift * (0.72 + 0.08 * Math.sin(t * 0.5));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    const lyric = String(findCurrentLyricLine(signalBus.time.renderMs)?.i ?? "");
    const text = lyric ? `line ${lyric}` : "echo";
    const echoCount = Math.max(2, Math.round(4 * labDensity));
    const fontPx = Math.max(22, Math.round(36 * labScale));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${fontPx}px ui-sans-serif, system-ui, -apple-system, Segoe UI`;
    for (let i = echoCount; i >= 0; i -= 1) {
      const u = i / Math.max(1, echoCount);
      const drift = (1 - u) * (10 + downbeat * 12);
      const y = cy + Math.sin(t * 0.85 + u * 2.2 + seedPhase) * drift;
      const a = 0.12 + (1 - u) * (0.38 + beat * 0.32);
      ctx.fillStyle = `rgba(150, 218, 255, ${a})`;
      ctx.fillText(text, cx, y);
    }
  }
  ctx.restore();
}

function buildSignalBus(input: {
  tAudioMs: number;
  tRenderMs: number;
  durationSec: number;
  amp: number;
  sectionId: string;
  sectionType: string;
  pulse: { beat: number; downbeat: number };
}): ViewerSignalBus {
  return {
    time: {
      audioMs: input.tAudioMs,
      renderMs: input.tRenderMs,
      offsetMs: renderOffsetMs,
      durationSec: input.durationSec,
      currentSec: Number(audio.currentTime) || 0
    },
    transport: {
      playing: !audio.paused,
      isSeeking,
      seekInFlight,
      pendingSeekRatio,
      playbackMode,
      viewerMode
    },
    section: {
      id: input.sectionId,
      type: input.sectionType
    },
    beat: {
      pulse: input.pulse.beat,
      downbeatPulse: input.pulse.downbeat,
      beatCount: pulseBeatTimesMs.length,
      downbeatCount: downbeatMarkers.length || pulseDownbeatTimesMs.length,
      fusionMode: fusionModeAt(input.tRenderMs)
    },
    hints: {
      count: activeHintCount,
      fusionModeLabel: beatFusionModeLabel,
      aiDownbeats: aiDownbeatMarkers.length
    },
    audio: {
      amp: input.amp,
      seed
    }
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function runDeterminismProbe(input: {
  tMs: number;
  seed: number;
  sectionId: string;
  sectionType: string;
  signalBus: ViewerSignalBus;
  amp: number;
}) {
  const stateLike = {
    tMs: input.tMs,
    sectionId: input.sectionId,
    sectionType: input.sectionType,
    viewerMode,
    signalBus: input.signalBus,
    amp: input.amp,
    energy: input.amp,
    recipe: currentRecipe,
    track
  };
  try {
    const layers = Array.isArray(currentRecipe?.layers) ? currentRecipe.layers : [];
    const layerChecks = layers.map((layer: any) => {
      const once = resolveResolvable(layer?.params ?? {}, {
        tMs: input.tMs,
        seed: input.seed,
        state: stateLike,
        path: `${String(layer?.module || "layer")}.params`
      });
      const twice = resolveResolvable(layer?.params ?? {}, {
        tMs: input.tMs,
        seed: input.seed,
        state: stateLike,
        path: `${String(layer?.module || "layer")}.params`
      });
      return stableStringify(once) === stableStringify(twice);
    });

    const graphLayers = Array.isArray(currentRecipe?.graph?.layers) ? currentRecipe.graph.layers : [];
    const graphChecks = graphLayers.flatMap((layer: any, li: number) => {
      const nodes = Array.isArray(layer?.nodes) ? layer.nodes : [];
      return nodes.map((node: any, ni: number) => {
        const nodeSeed = (input.seed ^ hashStringToSeed(`${String(layer?.id || li)}:${String(node?.id || ni)}`)) >>> 0;
        const path = `graph.${String(layer?.id || li)}.${String(node?.id || ni)}.params`;
        const once = resolveResolvable(node?.params ?? {}, { tMs: input.tMs, seed: nodeSeed, state: stateLike, path });
        const twice = resolveResolvable(node?.params ?? {}, { tMs: input.tMs, seed: nodeSeed, state: stateLike, path });
        return stableStringify(once) === stableStringify(twice);
      });
    });

    const all = [...layerChecks, ...graphChecks];
    const pass = all.every(Boolean);
    determinismProbeStatus = pass
      ? `pass (layer:${layerChecks.length} graph:${graphChecks.length})`
      : `fail (layer:${layerChecks.filter(Boolean).length}/${layerChecks.length} graph:${graphChecks.filter(Boolean).length}/${graphChecks.length})`;
  } catch (err) {
    determinismProbeStatus = `error (${err instanceof Error ? err.message : String(err)})`;
  }
  determinismProbeAtIso = new Date().toISOString();
}

function drawHintOverlays() {
  const durationSec = Number(audio.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const y0 = canvas.height - 44;
  const y1 = canvas.height - 8;
  const effectiveBeats = beatMarkers.length
    ? beatMarkers
    : (pulseBeatTimesMs ?? []).map((tMs) => ({ tMs: Number(tMs), source: "inferred" as const }));
  const effectiveDownbeats = downbeatMarkers.length
    ? downbeatMarkers
    : (pulseDownbeatTimesMs ?? []).map((tMs) => ({ tMs: Number(tMs), source: "inferred" as const }));
  const downbeatSourceByMs = resolveDisplayDownbeatSourceByBeat(effectiveBeats, effectiveDownbeats, aiDownbeatMarkers);

  ctx.save();
  ctx.globalAlpha = 0.85;
  for (const m of effectiveBeats) {
    const ms = Math.max(0, Math.round(Number(m.tMs)));
    const tSecRaw = Number(ms) / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    const downbeatSource = downbeatSourceByMs.get(ms);
    const isDownbeat = downbeatSource !== undefined;
    const markerSource = downbeatSource === "hint"
      ? "hint"
      : downbeatSource === "ai"
        ? "ai"
        : downbeatSource === "corrected"
          ? "corrected"
          : m.source;
    if (markerSource === "hint") {
      ctx.strokeStyle = isDownbeat ? "#54E38E" : "#9DB3FF";
      ctx.lineWidth = isDownbeat ? 3 : 2;
      ctx.globalAlpha = 0.95;
    } else if (markerSource === "corrected") {
      ctx.strokeStyle = isDownbeat ? "#FF9F2F" : "#777777";
      ctx.lineWidth = isDownbeat ? 2 : 1;
      ctx.globalAlpha = 0.92;
    } else if (markerSource === "ai") {
      ctx.strokeStyle = isDownbeat ? "#FFD84D" : "#777777";
      ctx.lineWidth = isDownbeat ? 2 : 1;
      ctx.globalAlpha = 0.9;
    } else {
      ctx.strokeStyle = isDownbeat ? "#C8C8C8" : "#777777";
      ctx.lineWidth = isDownbeat ? 2 : 1;
      ctx.globalAlpha = 0.85;
    }
    ctx.beginPath();
    ctx.moveTo(x, y0 + 4);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }

  const seekPreviewSec = (isSeeking || seekInFlight)
    ? Math.max(0, Math.min(durationSec, durationSec * pendingSeekRatio))
    : Math.max(0, Number(audio.currentTime) || 0);
  const playheadSec = Math.max(0, Math.min(durationSec, seekPreviewSec + renderOffsetMs / 1000));
  const playheadX = Math.max(0, Math.min(canvas.width, (playheadSec / durationSec) * canvas.width));
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playheadX, y0 - 2);
  ctx.lineTo(playheadX, y1 + 2);
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
  const durationSec = Number.isFinite(audio.duration) ? Number(audio.duration) : 0;
  const signalBus = buildSignalBus({
    tAudioMs,
    tRenderMs,
    durationSec,
    amp,
    sectionId,
    sectionType,
    pulse
  });
  const controlsRect = controls.getBoundingClientRect();
  const viewportHeightPx = window.visualViewport?.height ?? window.innerHeight;
  const frameInfo = engine.renderFrame({
    tMs: tRenderMs,
    sectionId,
    sectionType,
    viewerMode,
    signalBus,
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
  if (determinismProbeRequested) {
    determinismProbeRequested = false;
    runDeterminismProbe({
      tMs: tRenderMs,
      seed,
      sectionId,
      sectionType,
      signalBus,
      amp
    });
  }
  if (viewerMode !== "graph-scene") drawBeatOrb(pulse.beat, pulse.downbeat);
  if (viewerMode === "primitive-lab") drawPrimitiveLabOverlay(signalBus);
  if (isHintEditMode()) drawHintOverlays();

if (!isSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
  const max = Math.max(1, Number(seek.max) || SEEK_SCALE);
  seek.value = String(
    Math.min(max, Math.max(0, Math.round((audio.currentTime / audio.duration) * max)))
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
  const showLabFlash = performance.now() < labCopyFlashUntilMs;
  hud.textContent = [
    `title: ${preferredTrackTitle(track)}`,
    `trackId: ${track?.trackId ?? "-"}`,
    `seed: ${seed}`,
    `mode: ${viewerMode}`,
    `time: ${fmtMs(tAudioMs)}`,
    `offsetMs: ${renderOffsetMs}`,
    `playback: ${playbackMode}`,
    ...(isHintEditMode()
      ? [
          `hints: ${activeHintCount}`,
          `fusion: ${signalBus.hints.fusionModeLabel} (now: ${signalBus.beat.fusionMode})`,
          `beats: ${signalBus.beat.beatCount}`,
          `downbeats: ${signalBus.beat.downbeatCount}`,
          `aiDownbeats: ${signalBus.hints.aiDownbeats}`
        ]
      : []),
    `determinism: ${determinismProbeStatus}${determinismProbeAtIso ? ` @ ${determinismProbeAtIso}` : ""}`,
    ...(viewerMode === "primitive-lab"
      ? [
          `labPrimitive: ${labPrimitive}`,
          `labSeed: ${labSeedForPrimitive()}`,
          `labProfile: ${stableStringify(currentLabProfile())}`,
          `labSnippet: ${activeLabSnippet().split("\n")[0]}`,
          ...(showLabFlash ? ["labCopy: copied"] : [])
        ]
      : []),
    ...(viewerMode === "graph-scene"
      ? [
          `graphLayers: ${Array.isArray(currentRecipe?.graph?.layers) ? currentRecipe.graph.layers.length : 0}`,
          `graphSnippet: ${activeGraphSnippet().split("\n")[0]}`,
          ...(showLabFlash ? ["labCopy: copied"] : [])
        ]
      : []),
    `sectionId: ${sectionId || "-"}`,
    `sectionType: ${frameInfo?.sectionType ?? sectionType}`,
    `lyricIndex: ${lyricIndex}`,
    `lyric: ${lyricText || "-"}`,
    ``,
    `keys: space play/pause`,
    `      left/right seek`,
    `      v cycle mode`,
    `      j/k lab primitive prev/next`,
    `      y lab snippet copy`,
    `      t determinism probe`,
    ...(isHintEditMode()
      ? [
          `      d = downbeat anchor (keep established tempo)`,
          `      1/2/3/4 = measure tempo hints`,
          `      b = single beat hint`,
          `      u undo last hint group`,
          `      c clear hints`
        ]
      : []),
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
  await loadEffectiveGuidance(track, trackUrl);
  if (__AUTHORING_MODE__ && track.workId && track.trackId) {
    void fetch("/authoring/reduce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workId: track.workId, trackId: track.trackId })
    }).catch(() => undefined);
  }
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

  const assets = await resolvePlaybackAssets(track, trackUrl);
  const hasStems = assets.hasStems || isStemsTrack(track);
  playbackMode = hasStems ? "stems" : "mix";
  renderMixerControls();
  const audioUrl = resolveTrackAssetUrl(hasStems ? assets.backingPath : assets.mixPath, trackUrl);
  const wasPlaying = !audio.paused;
  audio.pause();
  audioVocals.pause();
  audio.src = audioUrl;
  audio.load();
  if (hasStems && assets.vocalsPath) {
    audioVocals.src = resolveTrackAssetUrl(assets.vocalsPath, trackUrl);
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
    await playSynced();
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
  const modeParam = url.searchParams.get("mode");
  seed = seedParam ? Number(seedParam) : NaN;
  setRenderOffset(offsetParam ? Number(offsetParam) : DEFAULT_RENDER_OFFSET_MS);
  setLyricsEnabled(lyricsParam !== "0");
  lyricMode = lyricModeParam === "fixed" || lyricModeParam === "off" ? lyricModeParam : "center";
  updateUrlParam("lyricMode", lyricMode);
  setViewerMode(normalizeViewerMode(modeParam));
  refreshLabControls();

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

function setSeekRatioFromPointerX(clientX: number) {
  const r = seek.getBoundingClientRect();
  const x = Math.min(r.width, Math.max(0, clientX - r.left));
  const ratio = r.width ? x / r.width : 0;
  pendingSeekRatio = Math.max(0, Math.min(1, ratio));
  const max = Math.max(1, Number(seek.max) || SEEK_SCALE);
  seek.value = String(Math.round(pendingSeekRatio * max));
}

seek.addEventListener("pointerdown", (e) => {
  seek.setPointerCapture(e.pointerId);
  beginSeek();
  setSeekRatioFromPointerX(e.clientX);
});

seek.addEventListener("pointermove", (e) => {
  if (!isSeeking) return;
  setSeekRatioFromPointerX(e.clientX);
});
// seek.addEventListener("mousedown", beginSeek);
// seek.addEventListener("touchstart", beginSeek, { passive: true });

seek.addEventListener("pointerup", (e) => {
  if (isSeeking) setSeekRatioFromPointerX(e.clientX);
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

seedBtn.addEventListener("click", () => {
  randomizeSeed();
  showControlsTemporarily();
});

modeBtn?.addEventListener("click", () => {
  cycleViewerMode();
  showControlsTemporarily();
});

labCopyBtn?.addEventListener("click", () => {
  void copyLabSnippet();
  showControlsTemporarily();
});

hudBtn.addEventListener("click", () => {
  hudVisible = !hudVisible;
  updateUrlParam("hud", hudVisible ? "1" : null);
  showControlsTemporarily();
});

window.addEventListener("keydown", async (e) => {
  showControlsTemporarily();
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    await togglePlayPause();
    return;
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    audio.currentTime = Math.max(0, audio.currentTime - 5);
    if (stemsActive()) {
      audioVocals.currentTime = audio.currentTime;
      syncStemTiming();
      scheduleStemResyncWindow(2500);
    }
    return;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    const maxT = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5;
    audio.currentTime = Math.min(maxT, audio.currentTime + 5);
    if (stemsActive()) {
      audioVocals.currentTime = audio.currentTime;
      syncStemTiming();
      scheduleStemResyncWindow(2500);
    }
    return;
  }
  if (isHintEditMode() && !e.repeat && (e.key.toLowerCase() === "d" || e.key.toLowerCase() === "b" || ["1", "2", "3", "4"].includes(e.key))) {
    const tSec = currentHintCaptureSec();
    if (e.key.toLowerCase() === "d") {
      applyHintEventOptimistic({ type: "hint/downbeat", tSec });
      queueHintEvent({ type: "hint/downbeat", tSec });
      return;
    }
    if (e.key.toLowerCase() === "b") {
      applyHintEventOptimistic({ type: "hint/beat", tSec });
      queueHintEvent({ type: "hint/beat", tSec });
      return;
    }
    const beatInBar = Number(e.key);
    if (Number.isInteger(beatInBar) && beatInBar >= 1 && beatInBar <= 4) {
      applyHintEventOptimistic({ type: "hint/barBeat", tSec, payload: { beatInBar } });
      queueHintEvent({ type: "hint/barBeat", tSec, payload: { beatInBar } });
      return;
    }
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
  if (e.key.toLowerCase() === "v" && !e.repeat) {
    e.preventDefault();
    cycleViewerMode();
    return;
  }
  if (viewerMode === "primitive-lab" && !e.repeat) {
    if (e.key.toLowerCase() === "j") {
      e.preventDefault();
      cycleLabPrimitive(-1);
      return;
    }
    if (e.key.toLowerCase() === "k") {
      e.preventDefault();
      cycleLabPrimitive(1);
      return;
    }
    if (e.key.toLowerCase() === "y") {
      e.preventDefault();
      await copyLabSnippet();
      return;
    }
  }
  if (viewerMode === "graph-scene" && !e.repeat && e.key.toLowerCase() === "y") {
    e.preventDefault();
    await copyLabSnippet();
    return;
  }
  if (e.key.toLowerCase() === "t" && !e.repeat) {
    e.preventDefault();
    determinismProbeRequested = true;
    return;
  }
  if (isHintEditMode() && e.key.toLowerCase() === "c" && !e.repeat) {
    e.preventDefault();
    await clearHintEventsForCurrentTrack();
    return;
  }
  if (isHintEditMode() && e.key.toLowerCase() === "u" && !e.repeat) {
    e.preventDefault();
    await undoLastHintGroupForCurrentTrack();
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
  if (stemsActive()) audioVocals.currentTime = audio.currentTime;
  logAudioState("seeking");
});
audio.addEventListener("seeked", () => {
  logAudioState("seeked");
});
audioVocals.addEventListener("seeked", () => {
  if (stemsActive()) syncStemTiming();
});
audioVocals.addEventListener("playing", () => {
  if (stemsActive()) syncStemTiming();
});
audio.addEventListener("pause", () => {
  if (stemsActive()) audioVocals.pause();
  clearStemResyncTimer();
  audio.playbackRate = 1;
  audioVocals.playbackRate = 1;
  logAudioState("pause");
  setPlayButtonIcon();
});
audio.addEventListener("ended", async () => {
  if (stemsActive()) audioVocals.pause();
  await goNextTrack();
  ensureAudioGraph();
  await resumeAudioContext();
  await playSynced();
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

