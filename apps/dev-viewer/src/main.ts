import "./style.css";
import { createEngine, hashStringToSeed } from "../../../packages/engine/src/index";
import { classifySection } from "../../../packages/engine/src/sections";
import { resolveResolvable } from "../../../packages/engine/src/resolvable";
import { renderRegisteredModule } from "../../../packages/engine/src/moduleRegistry";
import { normalizeSectionLabel } from "../../../packages/engine/src/transitions";
import { createModeRecipeResolver } from "./modeRecipeBuilder";

declare const __AUTHORING_MODE__: boolean;
declare const __RELEASE_MODE__: boolean;

type TimingSection = { id?: string; t0Ms?: number; t1Ms?: number };
type TimingLyric = { i?: number; t0Ms?: number; t1Ms?: number };
type TimingWord = { i?: number; t0Ms?: number; t1Ms?: number; text?: string; conf?: number };
type HintOverlay = {
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress";
  tSec: number;
  payload?: { beatInBar?: number; action?: "set" | "clear" };
  at?: string;
  actor?: string;
};
type EffectiveState = {
  effective?: {
    beatsMs?: number[];
    endMarkerMs?: number;
    downbeatTimesMs?: number[];
    beatMarkers?: Array<{ tMs?: number; source?: "hint" | "inferred" | "ai" | "corrected" }>;
    downbeatMarkers?: Array<{ tMs?: number; source?: "hint" | "inferred" | "ai" | "corrected" }>;
    aiDownbeatMarkers?: Array<{ tMs?: number; source?: "ai" }>;
    sectionMarkers?: Array<{ tMs?: number; source?: "default" | "hint" }>;
    lyricSuppressMarkers?: Array<{ tMs?: number; source?: "hint" }>;
    lyricSuppressWindows?: Array<{ t0Ms?: number; t1Ms?: number }>;
    sections?: Array<{ id?: string; labelRaw?: string; t0Ms?: number; t1Ms?: number }>;
  };
  hints?: {
    eventsCount?: number;
    beatFusionMode?: string;
    sectionBoundaryResolver?: { method?: string; adjusted?: number; avgSnapMs?: number };
    fusionWindowsSec?: Array<{ t0Sec?: number; t1Sec?: number }>;
  };
  overlays?: HintOverlay[];
};
type Track = {
  title: string;
  trackId: string;
  workId?: string;
  slug: string;
  assetDir?: string;
  beatReducer?: {
    aiBeatDivisor?: number;
  };
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
  releaseRecipePath?: string;
  visualHints?: {
    mood?: "calm" | "tense" | "uplifting" | "dark";
    motion?: "low" | "medium" | "high";
    density?: "sparse" | "normal" | "dense";
    lyricPresence?: "off" | "on" | "auto";
    colorBias?: "cool" | "warm" | "neutral";
    sectionFocus?: "intro" | "verse" | "chorus" | "bridge" | "outro";
    noGo?: string[];
  };
};

type PlaybackMode = "mix";
type LyricMode = "fixed" | "center" | "off";
type ViewerMode = "player" | "hint-edit" | "primitive-lab" | "recipe-view" | "random-scene" | "transition-lab";
const VIEWER_MODES: ViewerMode[] = ["player", "hint-edit", "primitive-lab", "recipe-view", "random-scene", "transition-lab"];
type LabBackdropPolicy = "off" | "fixed" | "random";
type LabBackdropId = "black" | "gradient" | "vignette" | "bands";
type LabPrimitiveId =
  | "bg.gradientField"
  | "fg.particles"
  | "field.signalNoiseBlend"
  | "glitch.persistentOffset"
  | "energy.pressureBloom"
  | "shape.beatOrb"
  | "overlay.beatTrack"
  | "viz.waveStrip"
  | "viz.spectrumBars"
  | "viz.responsiveRings"
  | "shape.circlePulse"
  | "frame.haloArcs"
  | "frame.orbitTicks"
  | "frame.arcLattice"
  | "polyline.orbitRibbon"
  | "curve.rosetteSpiral"
  | "text.echoWord"
  | "text.wordTrails"
  | "text.karaoke";
const LAB_PRIMITIVES: LabPrimitiveId[] = [
  "bg.gradientField",
  "fg.particles",
  "field.signalNoiseBlend",
  "glitch.persistentOffset",
  "energy.pressureBloom",
  "shape.beatOrb",
  "overlay.beatTrack",
  "viz.waveStrip",
  "viz.spectrumBars",
  "viz.responsiveRings",
  "shape.circlePulse",
  "frame.haloArcs",
  "frame.orbitTicks",
  "frame.arcLattice",
  "polyline.orbitRibbon",
  "curve.rosetteSpiral",
  "text.echoWord",
  "text.wordTrails",
  "text.karaoke"
];
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
  rhythm: {
    bpm: number;
    beatMs: number;
    barIndex: number;
    barStartMs: number;
    phaseBar: number;
    step16: number;
    patternId: string;
    cueCount: number;
    step16s: number[];
    lanes: {
      grid: { pulse: number; hit: boolean };
      accent: { pulse: number; hit: boolean };
      motion: { pulse: number; hit: boolean };
      transition: { pulse: number; hit: boolean };
      fill: { pulse: number; hit: boolean };
    };
    laneSteps16: {
      grid: number[];
      accent: number[];
      motion: number[];
      transition: number[];
      fill: number[];
    };
  };
  hints: {
    count: number;
    fusionModeLabel: string;
    aiDownbeats: number;
  };
  perf: {
    fps: number;
    targetFps: number;
    densityScale: number;
  };
  theme: {
    coherence: number;
    pressure: number;
    lyricActivity: number;
    sectionEnergy: number;
  };
  audio: {
    amp: number;
    seed: number;
  };
  reactive: {
    ampFast: number;
    ampSlow: number;
    low: number;
    mid: number;
    high: number;
    onsetScore: number;
    onsetPulse: number;
    vocalsActive: number;
    sources: {
      master: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
      backing: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
      vocals: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
    };
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
type MarkerSource = "hint" | "inferred" | "ai" | "corrected";
type SectionMarkerSource = "default" | "hint";

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const prevBtn = document.getElementById("prevBtn") as HTMLButtonElement;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement;
const seedBtn = document.getElementById("seedBtn") as HTMLButtonElement;
const modeBtn = document.getElementById("modeBtn") as HTMLButtonElement;
const hudBtn = document.getElementById("hudBtn") as HTMLButtonElement;
const shareBtn = document.getElementById("shareBtn") as HTMLButtonElement;
const offsetDecBtn = document.getElementById("offsetDecBtn") as HTMLButtonElement;
const offsetCycleBtn = document.getElementById("offsetCycleBtn") as HTMLButtonElement;
const offsetIncBtn = document.getElementById("offsetIncBtn") as HTMLButtonElement;
const controls = document.getElementById("controls") as HTMLDivElement;
const mixer = document.getElementById("mixer") as HTMLDivElement;
const seek = document.getElementById("seek") as HTMLInputElement;
const audio = document.getElementById("audio") as HTMLAudioElement;
const audioBacking = document.createElement("audio");
const audioVocals = document.createElement("audio");
const ctx = canvas.getContext("2d")!;

audio.preload = "auto";
audioBacking.preload = "none";
audioBacking.crossOrigin = "anonymous";
audioVocals.preload = "none";
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
let mixObjectUrl: string | null = null;
let mixFetchController: AbortController | null = null;
let lyricsLines: string[] = [];
let pulseBeatTimesMs: number[] = [];
let pulseDownbeatTimesMs: number[] = [];
let beatMarkers: Array<{ tMs: number; source: MarkerSource }> = [];
let downbeatMarkers: Array<{ tMs: number; source: MarkerSource }> = [];
let aiDownbeatMarkers: Array<{ tMs: number; source: "ai" }> = [];
let hintOverlays: HintOverlay[] = [];
let sectionMarkers: Array<{ tMs: number; source: SectionMarkerSource }> = [];
let lyricSuppressMarkers: Array<{ tMs: number; source: "hint" }> = [];
let lyricSuppressWindows: Array<{ t0Ms: number; t1Ms: number }> = [];
let activeHintCount = 0;
let beatFusionModeLabel = "-";
let fusionWindowsMs: Array<{ t0Ms: number; t1Ms: number }> = [];
let endMarkerMs = 0;
let lastSeekTargetSec = 0;
let lastSeekActualSec = 0;
let lastSeekErrorMs = 0;
let audioWaitingCount = 0;
let audioStalledCount = 0;
let audioSuspendCount = 0;
let audioProgressAtMs = 0;
let hintPersistTimer = 0;
let hintRevision = 0;
let latestQueuedBatchRevision = 0;
const HINT_PERSIST_DEBOUNCE_MS = 1000;
const REACTIVE_HISTORY_MS = 1500;
const REACTIVE_SAMPLE_MIN_MS = 25;
const pendingHintEvents: Array<{
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress";
  tSec: number;
  payload?: { beatInBar?: number; action?: "set" | "clear"; groupId?: string };
}> = [];
const SEEK_SCALE = 100000;

let seed = 1;
const DEFAULT_RENDER_OFFSET_MS = -240;
const MIN_RENDER_OFFSET_MS = -500;
const MAX_RENDER_OFFSET_MS = 500;
const OFFSET_PRESETS_MS = [-240, -120, 0, 120, 240];
let renderOffsetMs = DEFAULT_RENDER_OFFSET_MS;
let hudVisible = new URL(location.href).searchParams.get("hud") === "1";
let lyricsEnabled = true;
let lyricMode: LyricMode = "center";
let viewerMode: ViewerMode = "player";
let labPrimitive: LabPrimitiveId = LAB_PRIMITIVES[0];
let labBackdropPolicy: LabBackdropPolicy = "off";
let labBackdropFixed: LabBackdropId = "gradient";
let labCopyFlashUntilMs = 0;
let graphAutoRefresh = false;
let graphManualRecipe: { sectionId: string; index: number } | null = null;
const graphVariantBySection = new Map<string, number>();
let transitionLabPresetIndex = 0;
let transitionLabVariant = 0;
let transitionLabAutoVariantTick = 0;
let lastGraphSectionId = "";
let lastAutoDownbeatCount = -1;
let lastAutoBarCount = -1;
let playerLastSectionId = "";
let playerLastTransitionLabel = "crossfade";
let determinismProbeStatus = "idle";
let determinismProbeAtIso = "";
let determinismProbeRequested = false;
let lastFrameTsMs = 0;
let fpsSmoothed = 0;
let adaptiveDensityScale = 1;
let cachedSectionsSorted: TimingSection[] = [];
const rhythmPlanCache = new Map<string, { step16s: number[]; patternId: string; cueCount: number }>();
let hudLastUpdateMs = 0;
let hudLastText = "";
const HUD_UPDATE_INTERVAL_MS = 100;
let isSeeking = false;
let pendingSeekRatio = 0;
let wasPlayingBeforeSeek = false;
let seekInFlight = false;
const ampHistory: Array<{ tMs: number; amp: number }> = [];
let playbackMode: PlaybackMode = "mix";
let stemSignalsEnabled = false;
let mixControlLabel = "Mix";
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
let backingAnalyser: AnalyserNode | null = null;
let vocalsAnalyser: AnalyserNode | null = null;
let masterGain: GainNode | null = null;
let primaryGain: GainNode | null = null;
let backingGain: GainNode | null = null;
let vocalsGain: GainNode | null = null;
let audioData: Uint8Array<ArrayBuffer> | null = null;
let audioFreqData: Uint8Array<ArrayBuffer> | null = null;
let backingData: Uint8Array<ArrayBuffer> | null = null;
let backingFreqData: Uint8Array<ArrayBuffer> | null = null;
let vocalsData: Uint8Array<ArrayBuffer> | null = null;
let vocalsFreqData: Uint8Array<ArrayBuffer> | null = null;
type ReactiveState = {
  ampFast: number;
  ampSlow: number;
  onsetScore: number;
  onsetPulse: number;
  lastOnsetMs: number;
  prevSpectrum: number[];
};
type ReactiveSeriesSnapshot = {
  ampFast: number;
  ampSlow: number;
  low: number;
  mid: number;
  high: number;
  onsetScore: number;
  onsetPulse: number;
  wave: number[];
  freq: number[];
};
type ReactiveSnapshot = {
  tMs: number;
  vocalsActive: number;
  master: ReactiveSeriesSnapshot;
  backing: ReactiveSeriesSnapshot;
  vocals: ReactiveSeriesSnapshot;
};
function makeReactiveState(): ReactiveState {
  return { ampFast: 0, ampSlow: 0, onsetScore: 0, onsetPulse: 0, lastOnsetMs: -1e9, prevSpectrum: [] };
}
let reactiveMaster = makeReactiveState();
let reactiveBacking = makeReactiveState();
let reactiveVocals = makeReactiveState();
const reactiveHistory: ReactiveSnapshot[] = [];
const DEBUG_AUDIO = false;
let lastDebugLogTs = 0;
let lowAmpSinceMs = 0;
let lastGraphRebuildTs = 0;
const CONTROLS_HIDE_MS = 5000;
let controlsHideTimer = 0;
let canvasClickTimer = 0;
let stemLastDriftMs = 0;
let stemVocalsReady = false;
let stemVocalsBufferAheadSec = 0;
let currentRecipe: any = null;
const engine = createEngine({
  canvas,
  dpr: Math.max(1, Math.min(window.devicePixelRatio || 1, 2)),
  getTimeState: () => ({ tMs: audio.currentTime * 1000 }),
  getAudioState: () => ({ amp: reactiveMaster.ampFast, paused: audio.paused })
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
  if (raw === "player") return "player";
  if (raw === "hint-edit") return "hint-edit";
  if (raw === "primitive-lab" || raw === "recipe-view" || raw === "random-scene" || raw === "transition-lab") return raw as ViewerMode;
  return "player";
}

function normalizeLabPrimitive(value: string | null | undefined): LabPrimitiveId {
  const raw = String(value || "").trim();
  const match = LAB_PRIMITIVES.find((x) => x === raw);
  return match ?? LAB_PRIMITIVES[0];
}

function syncModeScopedUrlParams() {
  updateUrlParam("lyrics", null);
  updateUrlParam("lyricMode", null);
  if (isPrimitiveLabMode()) {
    updateUrlParam("labPrimitive", labPrimitive);
  } else {
    updateUrlParam("labPrimitive", null);
  }
  if (viewerMode === "transition-lab") {
    const preset = transitionLabPreset();
    updateUrlParam("transition", String(preset.id));
  } else {
    updateUrlParam("transition", null);
  }
  updateUrlParam("transitionVariant", null);
}

function setViewerMode(nextMode: ViewerMode) {
  if (viewerMode !== nextMode) invalidateModeRecipeMemo();
  viewerMode = nextMode;
  if (nextMode === "transition-lab") graphAutoRefresh = true;
  updateUrlParam("mode", nextMode === "player" ? null : nextMode);
  syncModeScopedUrlParams();
  if (modeBtn) modeBtn.textContent = nextMode;
}

function isHintEditMode() {
  return viewerMode === "hint-edit";
}

function isPlayerMode(mode: ViewerMode = viewerMode) {
  return mode === "player";
}

function isPrimitiveLabMode(mode: ViewerMode = viewerMode) {
  return mode === "primitive-lab";
}

function isGraphMode(mode: ViewerMode = viewerMode) {
  return mode === "recipe-view" || mode === "random-scene" || mode === "transition-lab";
}

function isGraphCapableMode(mode: ViewerMode = viewerMode) {
  return isPlayerMode(mode) || isGraphMode(mode);
}

function isSeedRefreshMode(mode: ViewerMode = viewerMode) {
  return isPlayerMode(mode) || mode === "hint-edit" || isPrimitiveLabMode(mode);
}

function cycleViewerMode() {
  const i = VIEWER_MODES.indexOf(viewerMode);
  const next = VIEWER_MODES[(i + 1) % VIEWER_MODES.length];
  setViewerMode(next);
}

function cycleLabPrimitive(dir: 1 | -1) {
  const i = LAB_PRIMITIVES.indexOf(labPrimitive);
  const next = (i + dir + LAB_PRIMITIVES.length) % LAB_PRIMITIVES.length;
  labPrimitive = LAB_PRIMITIVES[next];
  invalidateModeRecipeMemo();
  if (isPrimitiveLabMode()) updateUrlParam("labPrimitive", labPrimitive);
}

function cycleLabBackdropPolicy() {
  if (labBackdropPolicy === "off") labBackdropPolicy = "fixed";
  else if (labBackdropPolicy === "fixed") labBackdropPolicy = "random";
  else labBackdropPolicy = "off";
  invalidateModeRecipeMemo();
}

function currentLabBackdropId(): LabBackdropId {
  if (labBackdropPolicy === "off") return "black";
  if (labBackdropPolicy === "fixed") return labBackdropFixed;
  const pool: LabBackdropId[] = ["black", "gradient", "vignette", "bands"];
  const idx = (hashStringToSeed(`lab-bg:${labPrimitive}:${seed}`) >>> 0) % pool.length;
  return pool[idx];
}

function currentSectionIdNow() {
  const tRenderMs = (Number(audio.currentTime) || 0) * 1000 + renderOffsetMs;
  const sec = findCurrentSection(tRenderMs);
  return String(sec?.id ?? "");
}

function sectionOrderIndexById(sectionId: string) {
  const sid = String(sectionId || "");
  if (!sid) return -1;
  const sections = sortedTimedSections();
  for (let i = 0; i < sections.length; i += 1) {
    if (String(sections[i]?.id ?? "") === sid) return i;
  }
  return -1;
}

const TRANSITION_LAB_PRESETS = [
  { id: "crossfade", label: "crossfade", build: () => ({ kind: "crossfade", durationMs: 900 }) },
  { id: "wipe-x", label: "wipe x", build: (v: number) => ({ kind: "wipe", durationMs: 700 + (v % 4) * 180, params: { axis: "x" } }) },
  { id: "noise", label: "noise dissolve", build: (v: number) => ({ kind: "noiseDissolve", durationMs: 900 + (v % 4) * 220, params: { cell: 6 + (v % 5) * 2 } }) },
  {
    id: "dir-blur",
    label: "directional blur wipe",
    build: (v: number) => ({
      kind: "directionalBlurWipe",
      durationMs: 760 + (v % 5) * 160,
      params: {
        angleDeg: [0, 30, 45, 60, 90, 120, 135, 150][v % 8],
        blurSteps: 4 + (v % 5),
        strength: 0.22 + (v % 4) * 0.06,
        bandFrac: 0.1,
        curve: ["smooth", "out", "in", "smooth"][v % 4],
        useRhythmSteps: v % 2 === 0,
        rhythmStepsMode: v % 3 === 2 ? "blend" : "hold",
        beatsBeforeEnd: 4
      }
    })
  },
  {
    id: "luma",
    label: "luma dissolve",
    build: (v: number) => ({
      kind: "lumaDissolve",
      durationMs: 900 + (v % 4) * 180,
      params: {
        mode: ["mix", "to", "from"][v % 3],
        curve: ["smooth", "in", "out"][v % 3],
        grain: 0.08 + (v % 5) * 0.05,
        cell: 10 + (v % 2) * 2,
        invert: v % 4 === 3,
        useRhythmSteps: false,
        rhythmStepsMode: "hold",
        beatsBeforeEnd: 4
      }
    })
  },
  {
    id: "slice-step-x",
    label: "slice step x",
    build: (v: number) => {
      return {
        kind: "sliceStepWipe",
        durationMs: 700 + (v % 5) * 180,
        params: {
          axis: "x",
          slices: 5,
          gapPx: 0,
          direction: (v % 2 ? "reverse" : "forward"),
          order: (["forward", "alternate", "center-out", "forward"][v % 4]),
          useRhythmSteps: true,
          beatsBeforeEnd: 4
        }
      };
    }
  },
  {
    id: "slice-step-y",
    label: "slice step y",
    build: (v: number) => {
      return {
        kind: "sliceStepWipe",
        durationMs: 760 + (v % 5) * 170,
        params: {
          axis: "y",
          slices: 5,
          gapPx: 0,
          direction: (v % 2 ? "reverse" : "forward"),
          order: (["forward", "center-out", "alternate", "forward"][v % 4]),
          useRhythmSteps: true,
          beatsBeforeEnd: 4
        }
      };
    }
  }
];

function buildPlayerDefaultTransition(sectionId: string, sectionType: string) {
  const sid = String(sectionId || "");
  const st = String(sectionType || "");
  const h = hashStringToSeed(`player-transition:${seed}:${sid}:${st}`) >>> 0;
  const picks = [
    () => ({ kind: "crossfade", durationMs: 700 + (h % 4) * 120 }),
    () => ({ kind: "wipe", durationMs: 680 + (h % 5) * 110, params: { axis: (h % 2 === 0 ? "x" : "y") } }),
    () => ({
      kind: "directionalBlurWipe",
      durationMs: 760 + (h % 5) * 110,
      params: {
        angleDeg: [0, 30, 45, 60, 90, 120, 135, 150][h % 8],
        blurSteps: 4 + (h % 5),
        strength: 0.22 + (h % 4) * 0.05,
        bandFrac: 0.1,
        curve: ["smooth", "out", "in"][h % 3],
        useRhythmSteps: h % 2 === 0,
        rhythmStepsMode: h % 3 === 2 ? "blend" : "hold",
        beatsBeforeEnd: 4
      }
    }),
    () => ({
      kind: "lumaDissolve",
      durationMs: 880 + (h % 5) * 120,
      params: {
        mode: ["mix", "to", "from"][h % 3],
        curve: ["smooth", "out", "in"][h % 3],
        grain: 0.1 + (h % 5) * 0.045,
        cell: 10 + (h % 2) * 2,
        invert: h % 7 === 0,
        useRhythmSteps: false,
        rhythmStepsMode: "hold",
        beatsBeforeEnd: 4
      }
    }),
    () => ({
      kind: "sliceStepWipe",
      durationMs: 1000,
      params: {
        axis: (h % 2 === 0 ? "x" : "y"),
        slices: 5,
        gapPx: 0,
        direction: (h % 3 === 0 ? "reverse" : "forward"),
        order: ["forward", "alternate", "center-out"][h % 3],
        useRhythmSteps: true,
        beatsBeforeEnd: 4
      }
    }),
    () => ({ kind: "crossfade", durationMs: 620 + (h % 3) * 110 })
  ];
  return picks[h % picks.length]();
}

function transitionLabPreset() {
  const idx = ((transitionLabPresetIndex % TRANSITION_LAB_PRESETS.length) + TRANSITION_LAB_PRESETS.length) % TRANSITION_LAB_PRESETS.length;
  return TRANSITION_LAB_PRESETS[idx];
}

function transitionLabTransitionDef() {
  const preset = transitionLabPreset();
  return preset.build(transitionLabVariant);
}

function cycleTransitionLabPreset(dir: 1 | -1) {
  transitionLabPresetIndex = (transitionLabPresetIndex + dir + TRANSITION_LAB_PRESETS.length) % TRANSITION_LAB_PRESETS.length;
  invalidateModeRecipeMemo();
  syncModeScopedUrlParams();
}

function cycleTransitionLabVariant(dir: 1 | -1) {
  transitionLabVariant = Math.max(0, transitionLabVariant + dir);
  invalidateModeRecipeMemo();
  syncModeScopedUrlParams();
}

function randomizeTransitionLabVariant(sectionId: string) {
  transitionLabAutoVariantTick += 1;
  const sid = String(sectionId || "");
  const h = hashStringToSeed(`transition-lab:variant:${seed}:${sid}:${transitionLabAutoVariantTick}`) >>> 0;
  transitionLabVariant = h % 24;
  invalidateModeRecipeMemo();
  syncModeScopedUrlParams();
}

function resolveHudGraphSelection(sectionId: string, sectionType: string, playerVariantIndex: number, playerSceneChoice?: any) {
  if (viewerMode === "recipe-view") return resolveGraphSelection(currentRecipe, sectionId);
  if (viewerMode === "random-scene") return randomSceneLayersForSection(sectionId).selection;
  if (!isPlayerMode()) return null;
  const choice = playerSceneChoice ?? resolvePlayerSceneChoice(sectionId, sectionType, {
    variantIndex: playerVariantIndex,
    sectionBarIndex: Math.max(0, playerVariantIndex - 1),
    beatInBar: 1
  });
  return choice?.source === "recipe-view"
    ? graphLayersForSection(currentRecipe, sectionId, {
        allowManual: false,
        variantOverride: choice?.variant ?? 0,
        selectedIndexOverride: choice?.sceneIndex
      }).selection
    : randomSceneLayersForSection(sectionId, {
        allowManual: false,
        variantOverride: choice?.variant ?? 0,
        selectedIndexOverride: choice?.sceneIndex,
        backgroundIndexOverride: choice?.backgroundIndex
      }).selection;
}

function currentGraphVariantForSection(sectionId: string) {
  const k = String(sectionId || "");
  return graphVariantBySection.get(k) ?? 0;
}

function cycleGraphVariantForSection(sectionId: string) {
  const k = String(sectionId || "");
  const next = currentGraphVariantForSection(k) + 1;
  graphVariantBySection.set(k, next);
  invalidateModeRecipeMemo();
}

function labSeedForPrimitive() {
  return (seed ^ hashStringToSeed(`lab:${labPrimitive}`)) >>> 0;
}

function currentLabProfile() {
  const rng = mulberry32(labSeedForPrimitive());
  const primitiveRanges: Record<LabPrimitiveId, { scale: [number, number]; density: [number, number] }> = {
    "bg.gradientField": { scale: [0.8, 2.2], density: [0.6, 2.2] },
    "fg.particles": { scale: [0.7, 2.0], density: [0.5, 4.0] },
    "field.signalNoiseBlend": { scale: [0.7, 2.3], density: [0.5, 3.8] },
    "glitch.persistentOffset": { scale: [0.7, 2.4], density: [0.6, 3.7] },
    "energy.pressureBloom": { scale: [0.7, 2.5], density: [0.6, 3.9] },
    "shape.beatOrb": { scale: [0.7, 2.3], density: [0.7, 2.0] },
    "overlay.beatTrack": { scale: [1.0, 1.0], density: [1.0, 1.0] },
    "viz.waveStrip": { scale: [0.7, 2.0], density: [0.7, 3.2] },
    "viz.spectrumBars": { scale: [0.7, 2.0], density: [0.6, 3.6] },
    "viz.responsiveRings": { scale: [0.7, 2.2], density: [0.7, 3.6] },
    "shape.circlePulse": { scale: [0.75, 2.1], density: [0.6, 2.0] },
    "frame.haloArcs": { scale: [0.7, 2.3], density: [0.7, 3.8] },
    "frame.orbitTicks": { scale: [0.8, 2.5], density: [0.8, 4.0] },
    "frame.arcLattice": { scale: [0.8, 2.6], density: [0.8, 4.0] },
    "polyline.orbitRibbon": { scale: [0.7, 2.4], density: [0.4, 3.9] },
    "curve.rosetteSpiral": { scale: [0.7, 2.5], density: [0.45, 4.2] },
    "text.echoWord": { scale: [0.7, 2.0], density: [0.5, 2.3] },
    "text.wordTrails": { scale: [0.7, 2.0], density: [0.8, 2.5] },
    "text.karaoke": { scale: [0.8, 1.3], density: [0.8, 1.4] }
  };
  const ranges = primitiveRanges[labPrimitive] ?? primitiveRanges["shape.circlePulse"];
  const scale = ranges.scale[0] + rng() * (ranges.scale[1] - ranges.scale[0]);
  const density = ranges.density[0] + rng() * (ranges.density[1] - ranges.density[0]);
  const variant = Math.floor(rng() * 1000);
  return { scale, density, variant };
}

function labBackdropNode(backdrop: LabBackdropId, profile: { scale: number; density: number }) {
  if (backdrop === "black") {
    return { id: "lab-bg-black", type: "bg.solid", params: { color: "#000000", toneHint: "dark" } };
  }
  if (backdrop === "gradient") {
    return {
      id: "lab-bg-gradient",
      type: "bg.gradientField",
      params: {
        gradientStops: Math.max(3, Math.min(7, Math.round(2 + profile.density))),
        driftSpeed: 0.006 + profile.scale * 0.01,
        noiseScale: 0.25 + profile.density * 0.22,
        soften: 0.9 + Math.min(0.08, profile.scale * 0.03),
        toneHint: "light",
        toneLight: 0.72
      }
    };
  }
  if (backdrop === "vignette") {
    return {
      id: "lab-bg-vignette",
      type: "bg.vignette",
      params: {
        inner: 0.16,
        outer: 0.82,
        tintA: "#102338",
        tintB: "#000000",
        toneHint: "dark"
      }
    };
  }
  return {
    id: "lab-bg-bands",
    type: "bg.bands",
    params: {
      count: 12,
      opacity: 0.11,
      toneHint: "mid"
    }
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

type BackdropTone = "dark" | "light" | "mid";

function labBackdropTone(backdrop: LabBackdropId): BackdropTone {
  if (backdrop === "black" || backdrop === "vignette") return "dark" as const;
  if (backdrop === "gradient") return "light" as const;
  return "mid" as const;
}

function graphBackdropToneFromLayer(layer: any): BackdropTone {
  const node = Array.isArray(layer?.nodes) ? layer.nodes[0] : null;
  const params = node?.params ?? {};
  const toneHint = String(params?.toneHint ?? "").toLowerCase();
  if (toneHint === "dark") return "dark";
  if (toneHint === "light") return "light";
  if (toneHint === "mid") return "mid";
  const toneLight = Number(params?.toneLight);
  if (Number.isFinite(toneLight)) {
    if (toneLight >= 0.62) return "light";
    if (toneLight <= 0.32) return "dark";
  }
  return "mid";
}

function pickWeightedValue<T>(rng: () => number, items: Array<{ value: T; w: number }>) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.w) || 0), 0);
  if (total <= 0) return items[0]?.value;
  let remaining = rng() * total;
  for (const item of items) {
    remaining -= Math.max(0, Number(item.w) || 0);
    if (remaining <= 0) return item.value;
  }
  return items[items.length - 1]?.value;
}

function graphStrokeColorChoice(backdropTone: BackdropTone, rng: () => number, darkWeight = 0.58) {
  if (backdropTone === "light") {
    return pickWeightedValue(rng, [
      { value: "black", w: darkWeight },
      { value: "palette", w: Math.max(0.12, 1 - darkWeight) }
    ]) ?? "palette";
  }
  if (backdropTone === "mid") {
    return pickWeightedValue(rng, [
      { value: "palette", w: 0.82 },
      { value: "black", w: 0.18 }
    ]) ?? "palette";
  }
  return pickWeightedValue(rng, [
    { value: "palette", w: 0.78 },
    { value: "white", w: 0.18 },
    { value: "black", w: 0.04 }
  ]) ?? "palette";
}

function graphFrameColorMode(backdropTone: BackdropTone, rng: () => number, family: "halo" | "ticks" | "lattice" = "halo") {
  if (backdropTone === "light") {
    const shared = family === "ticks"
      ? [
          { value: "dark", w: 0.4 },
          { value: "pattern", w: 0.22 },
          { value: "accent", w: 0.18 },
          { value: "gradient", w: 0.12 },
          { value: "palette", w: 0.08 }
        ]
      : [
          { value: "dark", w: 0.42 },
          { value: "accent", w: 0.22 },
          { value: "gradient", w: 0.16 },
          { value: "palette", w: 0.14 },
          { value: "white", w: 0.06 }
        ];
    return pickWeightedValue(rng, shared) ?? "dark";
  }
  if (backdropTone === "mid") {
    const shared = family === "ticks"
      ? [
          { value: "pattern", w: 0.3 },
          { value: "gradient", w: 0.24 },
          { value: "accent", w: 0.2 },
          { value: "palette", w: 0.18 },
          { value: "dark", w: 0.08 }
        ]
      : [
          { value: "accent", w: 0.28 },
          { value: "gradient", w: 0.24 },
          { value: "palette", w: 0.22 },
          { value: "dark", w: 0.18 },
          { value: "white", w: 0.08 }
        ];
    return pickWeightedValue(rng, shared) ?? "accent";
  }
  const shared = family === "ticks"
    ? [
        { value: "gradient", w: 0.28 },
        { value: "pattern", w: 0.24 },
        { value: "palette", w: 0.2 },
        { value: "accent", w: 0.16 },
        { value: "white", w: 0.08 },
        { value: "dark", w: 0.04 }
      ]
    : [
        { value: "accent", w: 0.26 },
        { value: "palette", w: 0.24 },
        { value: "gradient", w: 0.22 },
        { value: "white", w: 0.16 },
        { value: "dark", w: 0.08 },
        { value: "black", w: 0.04 }
      ];
  return pickWeightedValue(rng, shared) ?? "accent";
}

function applySharedGraphColorStyle(node: any, backdropTone: BackdropTone, rng: () => number, role: "lab" | "hero" | "wrapper") {
  const type = String(node?.type ?? "").toLowerCase();
  node.params = typeof node?.params === "object" && node.params ? node.params : {};
  if (type === "viz.wavestrip") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "lab" ? 0.62 : 0.56);
  } else if (type === "viz.spectrumbars") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "lab" ? 0.62 : 0.58);
  } else if (type === "viz.responsiverings") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "wrapper" ? 0.54 : 0.58);
  } else if (type === "shape.circlepulse") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "wrapper" ? 0.52 : 0.56);
  } else if (type === "polyline.orbitribbon") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "wrapper" ? 0.48 : 0.54);
  } else if (type === "curve.rosettespiral") {
    node.params.color = graphStrokeColorChoice(backdropTone, rng, role === "lab" ? 0.68 : 0.28);
  } else if (type === "frame.haloarcs") {
    node.params.colorMode = graphFrameColorMode(backdropTone, rng, "halo");
  } else if (type === "frame.orbitticks") {
    node.params.colorMode = graphFrameColorMode(backdropTone, rng, "ticks");
  } else if (type === "frame.arclattice") {
    node.params.colorMode = graphFrameColorMode(backdropTone, rng, "lattice");
  }
  return node;
}

function labPrimitiveNode(profile: { scale: number; density: number; variant: number }, backdrop: LabBackdropId) {
  const scale = profile.scale;
  const density = profile.density;
  const backdropTone = labBackdropTone(backdrop);
  const styleRng = mulberry32(hashStringToSeed(`lab-style:${labPrimitive}:${backdrop}:${profile.variant}`) >>> 0);
  if (labPrimitive === "bg.gradientField") {
    return {
      id: "lab-primitive",
      type: "bg.gradientField",
      params: {
        gradientStops: Math.max(3, Math.min(7, Math.round(2 + density))),
        driftSpeed: 0.006 + scale * 0.01,
        noiseScale: 0.25 + density * 0.22,
        soften: 0.9 + Math.min(0.08, scale * 0.03)
      }
    };
  }
  if (labPrimitive === "fg.particles") {
    return {
      id: "lab-primitive",
      type: "fg.particles",
      params: {
        count: Math.max(24, Math.round(42 * density)),
        sizeRange: [1.0 + scale * 0.5, 2.5 + scale * 1.6],
        speed: 0.2 + scale * 0.28,
        curl: 0.25 + density * 0.2,
        opacity: 0.32 + Math.min(0.5, density * 0.14)
      }
    };
  }
  if (labPrimitive === "field.signalNoiseBlend") {
    return {
      id: "lab-primitive",
      type: "field.signalNoiseBlend",
      params: {
        pointCount: Math.max(100, Math.round(160 * density)),
        lineCount: Math.max(10, Math.round(26 * density)),
        noiseOpacity: 0.16 + Math.min(0.4, density * 0.08),
        lineOpacity: 0.14 + Math.min(0.3, density * 0.06),
        driftPx: Math.round(10 + scale * 16),
        zipChance: 0.1 + Math.min(0.32, density * 0.07),
        zipSpeedPx: Math.round(520 + scale * 280)
      }
    };
  }
  if (labPrimitive === "glitch.persistentOffset") {
    return {
      id: "lab-primitive",
      type: "glitch.persistentOffset",
      params: {
        bandCount: Math.max(8, Math.round(16 * density)),
        maxShiftPx: Math.round(4 + scale * 9),
        alpha: 0.13 + Math.min(0.3, density * 0.06),
        pulseGain: 0.25 + Math.min(0.5, scale * 0.14)
      }
    };
  }
  if (labPrimitive === "energy.pressureBloom") {
    return {
      id: "lab-primitive",
      type: "energy.pressureBloom",
      params: {
        bloomCount: Math.max(3, Math.round(4 + density * 2)),
        baseRadiusPx: Math.round(34 + scale * 22),
        maxRadiusPx: Math.round(120 + scale * 120),
        alpha: 0.14 + Math.min(0.35, density * 0.06),
        ringWidth: 0.9 + Math.min(2.4, density * 0.4)
      }
    };
  }
  if (labPrimitive === "shape.beatOrb") {
    return {
      id: "lab-primitive",
      type: "shape.beatOrb",
      params: {
        baseRadiusRatio: 0.026 + scale * 0.02,
        blend: "screen"
      }
    };
  }
  if (labPrimitive === "overlay.beatTrack") {
    return { id: "lab-primitive", type: "overlay.beatTrack", params: {} };
  }
  if (labPrimitive === "viz.waveStrip") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "viz.waveStrip",
      params: {
        stripMode: profile.variant % 4 === 0 ? "dual" : "auto",
        signalSource: "auto",
        heightPx: Math.round(42 + scale * 42),
        lineCopies: Math.max(2, Math.round(2 + density * 1.3)),
        lineWidth: Number((1 + density * 0.28).toFixed(2)),
        alphaMul: Number((0.26 + ((profile.variant % 100) / 100) * 0.25).toFixed(2)),
        centerY: Number((0.21 + ((profile.variant % 100) / 100) * 0.08).toFixed(3)),
        dualGapPx: Math.round(24 + scale * 18),
        mirrored: true,
        smooth: Number((0.42 + Math.min(0.42, density * 0.1)).toFixed(2)),
        zoom: Number((0.9 + Math.min(1.3, scale * 0.38)).toFixed(2))
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "viz.spectrumBars") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "viz.spectrumBars",
      params: {
        signalSource: "auto",
        barCount: Math.max(12, Math.round(18 + density * 10)),
        marginPx: Math.round(20 + scale * 10),
        topRel: Number((0.34 + Math.min(0.2, scale * 0.06)).toFixed(3)),
        bottomPadPx: Math.round(10 + scale * 7),
        gapPx: Math.max(2, Math.round(3 + density * 0.7)),
        alpha: Number((0.34 + Math.min(0.12, density * 0.03)).toFixed(2)),
        smooth: Number((0.06 + Math.min(0.16, density * 0.03)).toFixed(2)),
        bandSmoothing: Number((0.04 + Math.min(0.12, density * 0.02)).toFixed(2)),
        spectralTilt: 0.2,
        edgeTaper: Number((0.12 + Math.min(0.18, density * 0.04)).toFixed(2)),
        responseSpan: 0.75
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "viz.responsiveRings") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "viz.responsiveRings",
      params: {
        signalSource: "auto",
        ringCount: Math.max(3, Math.round(4 + density * 1.8)),
        points: Math.max(72, Math.round(88 + density * 30)),
        baseRadiusPx: Math.round(42 + scale * 38),
        gapPx: Math.round(16 + scale * 12),
        alpha: Number((0.32 + Math.min(0.28, density * 0.06)).toFixed(2)),
        lineWidth: Number((0.9 + Math.min(1.2, density * 0.2)).toFixed(2)),
        warp: Number((0.55 + Math.min(1.1, scale * 0.32)).toFixed(2)),
        rotateHz: Number(((profile.variant % 2 === 0 ? 1 : -1) * (0.02 + Math.min(0.06, scale * 0.015))).toFixed(3))
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "shape.circlePulse") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "shape.circlePulse",
      params: {
        radiusPx: Math.max(40, 120 * scale),
        ringCount: Math.max(4, Math.round(9 * density)),
        alpha: 0.22
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "frame.haloArcs") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "frame.haloArcs",
      params: {
        arcCount: Math.max(4, Math.round(6 + density * 2.2)),
        ringCount: Math.max(1, Math.min(3, Math.round(1.4 + density * 0.7))),
        radiusPx: Math.round(128 + scale * 92),
        gapPx: Math.round(20 + scale * 18),
        arcSpanMin: Number((0.22 + Math.min(0.22, density * 0.04)).toFixed(3)),
        arcSpanMax: Number((0.48 + Math.min(0.36, density * 0.08)).toFixed(3)),
        lineWidthPx: Number((1.4 + Math.min(1.8, density * 0.28)).toFixed(2)),
        alpha: Number((0.28 + Math.min(0.2, density * 0.05)).toFixed(2)),
        rotateHz: Number((((profile.variant % 2 === 0 ? 1 : -1) * (0.008 + Math.min(0.03, scale * 0.008)))).toFixed(3)),
        pulseGain: Number((0.14 + Math.min(0.16, scale * 0.04)).toFixed(3)),
        wobble: Number((0.04 + Math.min(0.06, density * 0.015)).toFixed(3)),
        signalSource: "auto"
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "frame.orbitTicks") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "frame.orbitTicks",
      params: {
        count: Math.max(7, Math.min(23, Math.round(7 + density * 4.2))),
        ringCount: Math.max(1, Math.min(3, Math.round(1 + density * 0.45))),
        radiusPx: Math.round(180 + scale * 128),
        gapPx: Math.round(26 + scale * 24),
        tickLenPx: Math.round(36 + scale * 22),
        lineWidthPx: Number((1.45 + Math.min(2.1, density * 0.24)).toFixed(2)),
        alpha: Number((0.34 + Math.min(0.22, density * 0.05)).toFixed(2)),
        rotateHz: Number((((profile.variant % 2 === 0 ? 1 : -1) * (0.01 + Math.min(0.05, scale * 0.012)))).toFixed(3)),
        danceHz: Number((0.05 + Math.min(0.08, density * 0.01)).toFixed(3)),
        danceAmpPx: Math.round(18 + scale * 12),
        style: profile.variant % 3 === 0 ? "triangle" : "line",
        patternMode: ["grouped", "alternate", "triple", "unison"][profile.variant % 4],
        signalSource: "auto"
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "frame.arcLattice") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "frame.arcLattice",
      params: {
        ringCount: Math.max(2, Math.min(4, Math.round(2 + density * 0.45))),
        radiusPx: Math.round(160 + scale * 120),
        gapPx: Math.round(26 + scale * 22),
        segmentsPerRing: Math.max(6, Math.min(18, Math.round(8 + density * 2.2))),
        spokeDensity: Number((0.2 + Math.min(0.38, density * 0.06)).toFixed(2)),
        arcCoverage: Number((0.42 + Math.min(0.36, density * 0.06)).toFixed(2)),
        lineWidthPx: Number((1.2 + Math.min(1.7, density * 0.18)).toFixed(2)),
        alpha: Number((0.22 + Math.min(0.18, density * 0.04)).toFixed(2)),
        rotateHz: Number((0.008 + Math.min(0.03, scale * 0.008)).toFixed(3)),
        spokeWidthMul: Number((0.94 + Math.min(0.3, density * 0.04)).toFixed(2)),
        spokeAlphaMul: Number((1.12 + Math.min(0.28, density * 0.04)).toFixed(2)),
        ratchetSnap: Number((0.76 + Math.min(0.18, density * 0.03)).toFixed(2)),
        endpointBridgeBias: Number((0.7 + Math.min(0.2, density * 0.03)).toFixed(2)),
        lockFlashGain: Number((0.26 + Math.min(0.18, density * 0.03)).toFixed(2)),
        motionMode: ["mesh", "ratchet", "driftLock"][profile.variant % 3],
        symmetryMode: ["mirror", "repeat", "offset"][profile.variant % 3],
        signalSource: "auto"
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "polyline.orbitRibbon") {
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "polyline.orbitRibbon",
      params: {
        points: Math.max(24, Math.round(48 * density)),
        radiusPx: Math.round(130 * scale),
        thicknessPx: 1.2 + Math.min(2.2, density * 0.45),
        phaseHz: [0.05, 0.08, 0.12][profile.variant % 3],
        animationMode: "auto"
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "curve.rosetteSpiral") {
    const petals = Math.max(3, Math.round(3 + density * 2.8));
    const symmetrySnap = density > 2.3 ? petals : density > 1.2 ? Math.max(4, petals - 1) : 0;
    return applySharedGraphColorStyle({
      id: "lab-primitive",
      type: "curve.rosetteSpiral",
      params: {
        mode: density > 2.6 ? "star" : density > 1.7 ? "hybrid" : "rosette",
        steps: Math.max(420, Math.round(520 * density)),
        turns: Number((6 + density * 2.4).toFixed(2)),
        growth: Number((2.2 + scale * 1.1).toFixed(2)),
        petalCount: petals,
        petalAmp: Math.round(10 + scale * 16),
        spin: Number((0.08 + density * 0.06).toFixed(3)),
        skip: density > 2.8 ? 3 : density > 1.9 ? 2 : 1,
        connectMode: density > 3.1 ? "chords" : density > 2.1 ? "skip" : density < 0.95 ? "radial" : "sequential",
        symmetrySnap,
        symmetryMix: symmetrySnap > 0 ? 0.72 : 0,
        alpha: 0.68,
        animationMode: "auto"
      }
    }, backdropTone, styleRng, "lab");
  }
  if (labPrimitive === "text.karaoke") {
    return {
      id: "lab-primitive",
      type: "text.karaoke",
      params: {
        mode: "center",
        fontSizePx: Math.round(30 * scale),
        lineGapPx: Math.max(8, Math.round(10 * density)),
        opacity: 0.92
      }
    };
  }
  if (labPrimitive === "text.wordTrails") {
    return {
      id: "lab-primitive",
      type: "text.wordTrails",
      params: {
        fontPx: Math.round(42 * scale),
        trailCount: Math.max(3, Math.round(4 * density)),
        driftPx: Math.max(8, Math.round(14 * scale))
      }
    };
  }
  return {
    id: "lab-primitive",
    type: "text.echoWord",
    params: {
      fontPx: Math.round(42 * scale),
      echoCount: Math.max(2, Math.round(5 * density)),
      driftPx: Math.round(12 * scale)
    }
  };
}

function labGraphLayers() {
  const profile = currentLabProfile();
  const backdrop = currentLabBackdropId();
  const primary = labPrimitiveNode(profile, backdrop);
  const layers: any[] = [];
  const isBackgroundPrimitive = labPrimitive === "bg.gradientField";
  if (!isBackgroundPrimitive) {
    layers.push({
      id: "lab-backdrop",
      blend: "source-over",
      opacity: 1,
      nodes: [labBackdropNode(backdrop, profile)]
    });
  }
  layers.push({
    id: "lab-main",
    blend: "screen",
    opacity: 1,
    nodes: [primary]
  });
  return layers;
}

function activeLabSnippet() {
  const profile = currentLabProfile();
  const scale = Number(profile.scale.toFixed(3));
  const density = Number(profile.density.toFixed(3));
  const pulseMul = Number((0.16 * scale).toFixed(3));
  if (labPrimitive === "bg.gradientField") {
    return `{
  "id": "lab-gradient",
  "module": "bg.gradientField",
  "params": {
    "gradientStops": ${Math.max(3, Math.min(7, Math.round(2 + density)))},
    "driftSpeed": ${Number((0.006 + scale * 0.01).toFixed(4))},
    "noiseScale": ${Number((0.25 + density * 0.22).toFixed(3))},
    "soften": ${Number((0.9 + Math.min(0.08, scale * 0.03)).toFixed(3))}
  }
}`;
  }
  if (labPrimitive === "fg.particles") {
    return `{
  "id": "lab-particles",
  "module": "fg.particles",
  "blend": "screen",
  "params": {
    "count": ${Math.max(24, Math.round(42 * density))},
    "sizeRange": [${Number((1.0 + scale * 0.5).toFixed(2))}, ${Number((2.5 + scale * 1.6).toFixed(2))}],
    "speed": ${Number((0.2 + scale * 0.28).toFixed(3))},
    "curl": ${Number((0.25 + density * 0.2).toFixed(3))},
    "opacity": ${Number((0.32 + Math.min(0.5, density * 0.14)).toFixed(3))}
  }
}`;
  }
  if (labPrimitive === "shape.beatOrb") {
    return `{
  "id": "lab-orb",
  "type": "shape.beatOrb",
  "params": {
    "baseRadiusRatio": ${Number((0.026 + scale * 0.02).toFixed(4))},
    "blend": "screen"
  }
}`;
  }
  if (labPrimitive === "frame.haloArcs") {
    return `{
  "id": "lab-halo-arcs",
  "type": "frame.haloArcs",
  "params": {
    "arcCount": ${Math.max(4, Math.round(6 + density * 2.2))},
    "ringCount": ${Math.max(1, Math.min(3, Math.round(1.4 + density * 0.7)))},
    "radiusPx": ${Math.round(128 + scale * 92)},
    "gapPx": ${Math.round(20 + scale * 18)},
    "arcSpanMin": ${Number((0.22 + Math.min(0.22, density * 0.04)).toFixed(3))},
    "arcSpanMax": ${Number((0.48 + Math.min(0.36, density * 0.08)).toFixed(3))},
    "lineWidthPx": ${Number((1.4 + Math.min(1.8, density * 0.28)).toFixed(2))},
    "alpha": ${Number((0.28 + Math.min(0.2, density * 0.05)).toFixed(2))},
    "rotateHz": ${Number((((profile.variant % 2 === 0 ? 1 : -1) * (0.008 + Math.min(0.03, scale * 0.008)))).toFixed(3))},
    "pulseGain": ${Number((0.14 + Math.min(0.16, scale * 0.04)).toFixed(3))},
    "wobble": ${Number((0.04 + Math.min(0.06, density * 0.015)).toFixed(3))},
    "colorMode": "${["palette", "accent", "white", "black"][profile.variant % 4]}",
    "signalSource": "auto"
  }
}`;
  }
  if (labPrimitive === "frame.orbitTicks") {
    return `{
  "id": "lab-orbit-ticks",
  "type": "frame.orbitTicks",
  "params": {
    "count": ${Math.max(7, Math.min(23, Math.round(7 + density * 4.2)))},
    "ringCount": ${Math.max(1, Math.min(3, Math.round(1 + density * 0.45)))},
    "radiusPx": ${Math.round(180 + scale * 128)},
    "gapPx": ${Math.round(26 + scale * 24)},
    "tickLenPx": ${Math.round(36 + scale * 22)},
    "lineWidthPx": ${Number((1.45 + Math.min(2.1, density * 0.24)).toFixed(2))},
    "alpha": ${Number((0.34 + Math.min(0.22, density * 0.05)).toFixed(2))},
    "rotateHz": ${Number((((profile.variant % 2 === 0 ? 1 : -1) * (0.01 + Math.min(0.05, scale * 0.012)))).toFixed(3))},
    "danceHz": ${Number((0.05 + Math.min(0.08, density * 0.01)).toFixed(3))},
    "danceAmpPx": ${Math.round(18 + scale * 12)},
    "style": "${profile.variant % 3 === 0 ? "triangle" : "line"}",
    "patternMode": "${["grouped", "alternate", "triple", "unison"][profile.variant % 4]}",
    "colorMode": "${["palette", "gradient", "pattern", "dark"][profile.variant % 4]}",
    "signalSource": "auto"
  }
}`;
  }
  if (labPrimitive === "frame.arcLattice") {
    return `{
  "id": "lab-arc-lattice",
  "type": "frame.arcLattice",
  "params": {
    "ringCount": ${Math.max(2, Math.min(4, Math.round(2 + density * 0.45)))},
    "radiusPx": ${Math.round(160 + scale * 120)},
    "gapPx": ${Math.round(26 + scale * 22)},
    "segmentsPerRing": ${Math.max(6, Math.min(18, Math.round(8 + density * 2.2)))},
    "spokeDensity": ${Number((0.2 + Math.min(0.38, density * 0.06)).toFixed(2))},
    "arcCoverage": ${Number((0.42 + Math.min(0.36, density * 0.06)).toFixed(2))},
    "lineWidthPx": ${Number((1.2 + Math.min(1.7, density * 0.18)).toFixed(2))},
    "alpha": ${Number((0.22 + Math.min(0.18, density * 0.04)).toFixed(2))},
    "rotateHz": ${Number((0.008 + Math.min(0.03, scale * 0.008)).toFixed(3))},
    "spokeWidthMul": ${Number((0.94 + Math.min(0.3, density * 0.04)).toFixed(2))},
    "spokeAlphaMul": ${Number((1.12 + Math.min(0.28, density * 0.04)).toFixed(2))},
    "ratchetSnap": ${Number((0.76 + Math.min(0.18, density * 0.03)).toFixed(2))},
    "endpointBridgeBias": ${Number((0.7 + Math.min(0.2, density * 0.03)).toFixed(2))},
    "lockFlashGain": ${Number((0.26 + Math.min(0.18, density * 0.03)).toFixed(2))},
    "motionMode": "${["mesh", "ratchet", "driftLock"][profile.variant % 3]}",
    "symmetryMode": "${["mirror", "repeat", "offset"][profile.variant % 3]}",
    "colorMode": "${["palette", "accent", "gradient", "dark"][profile.variant % 4]}",
    "signalSource": "auto"
  }
}`;
  }
  if (labPrimitive === "overlay.beatTrack") {
    return `{
  "id": "lab-beat-track",
  "type": "overlay.beatTrack",
  "params": { "uses": "effective beat/downbeat markers + playhead" }
}`;
  }
  if (labPrimitive === "viz.waveStrip") {
    return `{
  "id": "lab-wave-strip",
  "type": "viz.waveStrip",
  "params": {
    "stripMode": "auto",
    "signalSource": "auto",
    "heightPx": ${Math.round(42 + scale * 42)},
    "lineCopies": ${Math.max(2, Math.round(2 + density * 1.3))},
    "lineWidth": ${Number((1 + density * 0.28).toFixed(2))},
    "alphaMul": ${Number((0.26 + ((profile.variant % 100) / 100) * 0.25).toFixed(2))},
    "centerY": ${Number((0.21 + ((profile.variant % 100) / 100) * 0.08).toFixed(3))},
    "dualGapPx": ${Math.round(24 + scale * 18)},
    "mirrored": true,
    "smooth": ${Number((0.42 + Math.min(0.42, density * 0.1)).toFixed(2))},
    "zoom": ${Number((0.9 + Math.min(1.3, scale * 0.38)).toFixed(2))}
  }
}`;
  }
  if (labPrimitive === "viz.spectrumBars") {
    return `{
  "id": "lab-spectrum-bars",
  "type": "viz.spectrumBars",
  "params": {
    "signalSource": "auto",
    "barCount": ${Math.max(12, Math.round(18 + density * 10))},
    "marginPx": ${Math.round(20 + scale * 10)},
    "topRel": ${Number((0.34 + Math.min(0.2, scale * 0.06)).toFixed(3))},
    "bottomPadPx": ${Math.round(10 + scale * 7)},
    "gapPx": ${Math.max(2, Math.round(3 + density * 0.7))},
    "alpha": ${Number((0.34 + Math.min(0.12, density * 0.03)).toFixed(2))},
    "smooth": ${Number((0.06 + Math.min(0.16, density * 0.03)).toFixed(2))},
    "bandSmoothing": ${Number((0.04 + Math.min(0.12, density * 0.02)).toFixed(2))},
    "spectralTilt": 0.2,
    "edgeTaper": ${Number((0.12 + Math.min(0.18, density * 0.04)).toFixed(2))},
    "responseSpan": 0.75
  }
}`;
  }
  if (labPrimitive === "viz.responsiveRings") {
    return `{
  "id": "lab-responsive-rings",
  "type": "viz.responsiveRings",
  "params": {
    "signalSource": "auto",
    "ringCount": ${Math.max(3, Math.round(4 + density * 1.8))},
    "points": ${Math.max(72, Math.round(88 + density * 30))},
    "baseRadiusPx": ${Math.round(42 + scale * 38)},
    "gapPx": ${Math.round(16 + scale * 12)},
    "alpha": ${Number((0.32 + Math.min(0.28, density * 0.06)).toFixed(2))},
    "lineWidth": ${Number((0.9 + Math.min(1.2, density * 0.2)).toFixed(2))},
    "warp": ${Number((0.55 + Math.min(1.1, scale * 0.32)).toFixed(2))},
    "rotateHz": ${Number(((profile.variant % 2 === 0 ? 1 : -1) * (0.02 + Math.min(0.06, scale * 0.015))).toFixed(3))}
  }
}`;
  }
  if (labPrimitive === "text.karaoke") {
    return `{
  "id": "lab-karaoke",
  "type": "text.karaoke",
  "params": {
    "mode": "center",
    "fontSizePx": ${Math.round(30 * scale)},
    "lineGapPx": ${Math.max(8, Math.round(10 * density))},
    "opacity": 0.92
  }
}`;
  }
  if (labPrimitive === "text.wordTrails") {
    return `{
  "id": "lab-word-trails",
  "type": "text.wordTrails",
  "params": {
    "fontPx": ${Math.round(42 * scale)},
    "trailCount": ${Math.max(3, Math.round(4 * density))},
    "driftPx": ${Math.max(8, Math.round(14 * scale))}
  }
}`;
  }
  if (labPrimitive === "shape.circlePulse") {
    return `{
  "id": "lab-circle",
  "type": "shape.circlePulse",
  "blend": "screen",
  "params": {
    "radiusPx": {"map":"beat.downbeatPulse","from":[0,1],"to":[48,${Math.round(120 * scale)}],"ease":"out"},
    "ringCount": ${Math.max(4, Math.round(9 * density))},
    "alpha": {"add":[0.2, {"mul":[{"signal":"audio.amp"},${pulseMul}]}]}
  }
}`;
  }
  if (labPrimitive === "energy.pressureBloom") {
    return `{
  "id": "lab-pressure-bloom",
  "type": "energy.pressureBloom",
  "params": {
    "bloomCount": ${Math.max(3, Math.round(4 + density * 2))},
    "baseRadiusPx": ${Math.round(34 + scale * 22)},
    "maxRadiusPx": ${Math.round(120 + scale * 120)},
    "alpha": ${Number((0.14 + Math.min(0.35, density * 0.06)).toFixed(3))},
    "ringWidth": ${Number((0.9 + Math.min(2.4, density * 0.4)).toFixed(3))}
  }
}`;
  }
  if (labPrimitive === "polyline.orbitRibbon") {
    return `{
  "id": "lab-ribbon",
  "type": "polyline.orbitRibbon",
  "blend": "screen",
  "params": {
    "points": ${Math.max(24, Math.round(48 * density))},
    "radiusPx": ${Math.round(130 * scale)},
    "thicknessPx": {"map":"beat.pulse","from":[0,1],"to":[1.2,3.2],"ease":"inOut"},
    "phaseHz": {"pick":[0.05,0.08,0.12],"w":[1,2,1]}
  }
}`;
  }
  if (labPrimitive === "curve.rosetteSpiral") {
    const petals = Math.max(3, Math.round(3 + density * 2.8));
    const turns = Number((6 + density * 2.4).toFixed(2));
    const mode = density > 2.6 ? "star" : density > 1.7 ? "hybrid" : "rosette";
    const skip = density > 2.8 ? 3 : density > 1.9 ? 2 : 1;
    const symmetrySnap = density > 2.3 ? petals : density > 1.2 ? Math.max(4, petals - 1) : 0;
    const connectMode = density > 3.1 ? "chords" : density > 2.1 ? "skip" : density < 0.95 ? "radial" : "sequential";
    const color = scale < 0.95 ? "black" : "palette";
    return `{
  "id": "lab-rosette",
  "type": "curve.rosetteSpiral",
  "blend": "screen",
  "params": {
    "mode": "${mode}",
    "steps": ${Math.max(420, Math.round(520 * density))},
    "turns": ${turns},
    "growth": ${Number((2.2 + scale * 1.1).toFixed(2))},
    "petalCount": ${petals},
    "petalAmp": ${Math.round(10 + scale * 16)},
    "spin": ${Number((0.08 + density * 0.06).toFixed(3))},
    "skip": ${skip},
    "connectMode": "${connectMode}",
    "symmetrySnap": ${symmetrySnap},
    "symmetryMix": ${symmetrySnap > 0 ? 0.72 : 0},
    "color": "${color}",
    "alpha": {"map":"audio.amp","from":[0,0.35],"to":[0.42,0.88]}
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
        "blend": "source-over",
        "opacity": 1,
        "nodes": [
          { "id": "gradient", "type": "bg.gradientField", "params": { "gradientStops": 3, "driftSpeed": 0.012, "noiseScale": 0.45, "soften": 0.94 } },
          { "id": "particles", "type": "fg.particles", "params": { "count": 140, "sizeRange": [1.6, 4.8], "speed": 0.48, "curl": 0.55, "opacity": 0.62 } },
          { "id": "orb", "type": "shape.beatOrb", "params": { "baseRadiusRatio": 0.048, "blend": "screen" } },
          { "id": "pulse", "type": "shape.circlePulse", "params": { "ringCount": 8, "radiusPx": 88, "alpha": 0.18 } },
          { "id": "ribbon", "type": "polyline.orbitRibbon", "params": { "points": 60, "radiusPx": 170, "thicknessPx": 1.7, "phaseHz": 0.08 } },
          { "id": "rose", "type": "curve.rosetteSpiral", "params": { "mode": "hybrid", "steps": 860, "turns": 11, "growth": 3.2, "petalCount": 7, "petalAmp": 20, "spin": 0.14, "skip": 2, "alpha": 0.5, "lineWidth": 1.1 } }
        ]
      },
      {
        "id": "text",
        "blend": "screen",
        "opacity": 1,
        "nodes": [
          { "id": "word", "type": "text.echoWord", "params": { "fontPx": 30, "echoCount": 4, "driftPx": 12 } }
        ]
      }
    ]
  }
}`;
}

function storageAvailable() {
  try {
    const k = "__rmv_storage_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function loadStoredOffsetMs() {
  if (!storageAvailable()) return null;
  const raw = localStorage.getItem("rmv.offsetMs");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function saveStoredOffsetMs(v: number) {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem("rmv.offsetMs", String(Math.round(v)));
  } catch {
    // ignore storage failures in strict sandbox iframes
  }
}

function clampOffset(v: number) {
  if (!Number.isFinite(v)) return DEFAULT_RENDER_OFFSET_MS;
  return Math.max(MIN_RENDER_OFFSET_MS, Math.min(MAX_RENDER_OFFSET_MS, Math.round(v)));
}

function updateOffsetButtons() {
  if (offsetCycleBtn) offsetCycleBtn.textContent = `${renderOffsetMs}Ms (o)`;
}

function setRenderOffset(next: number) {
  renderOffsetMs = clampOffset(next);
  updateUrlParam("offset", String(renderOffsetMs));
  saveStoredOffsetMs(renderOffsetMs);
  updateOffsetButtons();
}

function cycleOffsetPreset() {
  const current = renderOffsetMs;
  let bestIdx = 0;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < OFFSET_PRESETS_MS.length; i += 1) {
    const d = Math.abs(OFFSET_PRESETS_MS[i] - current);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  const nextIdx = (bestIdx + 1) % OFFSET_PRESETS_MS.length;
  setRenderOffset(OFFSET_PRESETS_MS[nextIdx]);
}

function nudgeRenderOffset(deltaMs: number) {
  setRenderOffset(renderOffsetMs + deltaMs);
}

async function copyShareUrl() {
  const u = new URL(location.href);
  u.searchParams.set("offset", String(renderOffsetMs));
  const text = u.toString();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    ok = false;
  }
  if (shareBtn) {
    const prev = shareBtn.textContent || "";
    shareBtn.textContent = ok ? "\u2713" : "\u26A0";
    window.setTimeout(() => {
      shareBtn.textContent = prev || "\u2914";
    }, 900);
  }
}

function setLyricsEnabled(next: boolean) {
  lyricsEnabled = next;
  syncLyricsUrlParams();
}

function syncLyricsUrlParams() {
  // Lyrics toggles stay runtime-only; keep URLs mode/seed/track-focused.
  updateUrlParam("lyrics", null);
  updateUrlParam("lyricMode", null);
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

function stemSignalsActive() {
  return stemSignalsEnabled;
}

function isMobileLike() {
  const ua = String(navigator.userAgent || "");
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const touch = Number((navigator as any).maxTouchPoints || 0) > 0;
  return coarse || touch || /Android|iPhone|iPad|iPod|Mobi/i.test(ua);
}

function stemSignalsOptIn() {
  const v = String(new URL(location.href).searchParams.get("stemSignals") || "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

function fullBufferMixEnabled() {
  const v = String(new URL(location.href).searchParams.get("fullBuffer") || "").toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  return isMobileLike();
}

function bufferedAheadSec(el: HTMLMediaElement, tSec: number) {
  try {
    const b = el.buffered;
    for (let i = 0; i < b.length; i += 1) {
      const start = b.start(i);
      const end = b.end(i);
      if (tSec >= start && tSec <= end) return Math.max(0, end - tSec);
    }
  } catch {
    // ignore
  }
  return 0;
}

function activeAudioEls() {
  return stemSignalsActive() ? [audio, audioBacking, audioVocals] : [audio];
}

function sampleStemDrift() {
  if (!stemSignalsActive() || !audioVocals.src) return;
  stemVocalsReady = audioVocals.readyState >= 3;
  stemVocalsBufferAheadSec = bufferedAheadSec(audioVocals, Number(audio.currentTime) || 0);
  const drift = audio.currentTime - audioVocals.currentTime;
  stemLastDriftMs = Math.round(drift * 1000);
}

function resetStemSyncState() {
  stemLastDriftMs = 0;
  stemVocalsReady = false;
  stemVocalsBufferAheadSec = 0;
  audioVocals.playbackRate = 1;
  audioBacking.playbackRate = 1;
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
  await ensureMetadataLoaded();
  if (stemSignalsActive()) {
    const t = Number(audio.currentTime) || 0;
    audioBacking.currentTime = t;
    audioVocals.currentTime = t;
  }
  audio.playbackRate = 1;
  audioBacking.playbackRate = 1;
  audioVocals.playbackRate = 1;
  const waits: Promise<void>[] = [waitForCanPlay(audio)];
  if (stemSignalsActive()) waits.push(waitForCanPlay(audioBacking), waitForCanPlay(audioVocals));
  await Promise.all(waits);
  const plays: Promise<any>[] = [audio.play()];
  if (stemSignalsActive()) plays.push(audioBacking.play(), audioVocals.play());
  const [main, backing, vocals] = await Promise.allSettled(plays);
  if (main.status === "rejected") {
    logAudioState("play-main-failed", {
      err: main.reason instanceof Error ? main.reason.message : String(main.reason)
    });
  }
  if (stemSignalsActive() && backing && backing.status === "rejected") {
    logAudioState("play-backing-failed", {
      err: backing.reason instanceof Error ? backing.reason.message : String(backing.reason)
    });
  }
  if (stemSignalsActive() && vocals && vocals.status === "rejected") {
    logAudioState("play-vocals-failed", {
      err: vocals.reason instanceof Error ? vocals.reason.message : String(vocals.reason)
    });
  }
}

function applyMixerGains() {
  if (!primaryGain || !vocalsGain) return;
  const m = mixerState.mix;
  primaryGain.gain.value = m.muted ? 0 : m.volume;
  vocalsGain.gain.value = 1;
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
  mixer.appendChild(createMixerRow("mix", mixControlLabel));
}

function resolveTrackAssetUrl(candidate: string, baseTrackUrl: string) {
  const raw = String(candidate || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return new URL(raw, location.origin).toString();
  if (raw.startsWith("assets/")) return new URL(`/${raw}`, location.origin).toString();
  return new URL(raw, baseTrackUrl).toString();
}

async function setPrimaryAudioSource(audioUrl: string) {
  if (mixFetchController) {
    mixFetchController.abort();
    mixFetchController = null;
  }
  if (mixObjectUrl) {
    URL.revokeObjectURL(mixObjectUrl);
    mixObjectUrl = null;
  }
  if (!fullBufferMixEnabled()) {
    audio.src = audioUrl;
    audio.load();
    return;
  }
  const controller = new AbortController();
  mixFetchController = controller;
  try {
    const resp = await fetch(audioUrl, { signal: controller.signal, cache: "force-cache" });
    if (!resp.ok) throw new Error(`mix fetch failed: ${resp.status}`);
    const blob = await resp.blob();
    if (controller.signal.aborted) return;
    const obj = URL.createObjectURL(blob);
    mixObjectUrl = obj;
    audio.src = obj;
    audio.load();
  } catch {
    if (controller.signal.aborted) return;
    audio.src = audioUrl;
    audio.load();
  } finally {
    if (mixFetchController === controller) mixFetchController = null;
  }
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

function hasSectionMarkerNear(tMs: number, tolMs = 120) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  return sectionMarkers.some((m) => Math.abs(m.tMs - ms) <= tolMs);
}

function removeSectionMarkerNear(tMs: number, tolMs = 120) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  let removed = false;
  for (let i = sectionMarkers.length - 1; i >= 0; i -= 1) {
    if (Math.abs(sectionMarkers[i].tMs - ms) <= tolMs) {
      sectionMarkers.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

function rebuildSectionMarkersFromHintOverlays() {
  const rows = [...hintOverlays].sort((a, b) => {
    const atA = Number.isFinite(Date.parse(String(a?.at || ""))) ? Date.parse(String(a?.at || "")) : 0;
    const atB = Number.isFinite(Date.parse(String(b?.at || ""))) ? Date.parse(String(b?.at || "")) : 0;
    if (atA !== atB) return atA - atB;
    return Number(a.tSec) - Number(b.tSec);
  });
  const out: Array<{ tMs: number; source: SectionMarkerSource }> = [];
  for (const row of rows) {
    if (row.type !== "hint/sectionMarker") continue;
    const tMs = Math.max(0, Math.round(Number(row.tSec) * 1000));
    const action = row?.payload?.action === "clear" ? "clear" : "set";
    if (action === "clear") {
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (Math.abs(out[i].tMs - tMs) <= 140) out.splice(i, 1);
      }
    } else if (!out.some((x) => Math.abs(x.tMs - tMs) <= 90)) {
      out.push({ tMs, source: "hint" as const });
    }
  }
  sectionMarkers = out
    .map((m) => ({ tMs: Math.max(0, Math.round(Number(m.tMs) || 0)), source: (m.source === "hint" ? "hint" : "default") as SectionMarkerSource }))
    .filter((m) => Number.isFinite(m.tMs))
    .sort((a, b) => a.tMs - b.tMs);
}

function addOrUpdateMarker(
  markers: Array<{ tMs: number; source: MarkerSource }>,
  tMs: number,
  source: MarkerSource,
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
  markers: Array<{ tMs: number; source: MarkerSource }>,
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

function applyHintEventOptimistic(event: {
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress";
  tSec: number;
  payload?: { beatInBar?: number; action?: "set" | "clear"; groupId?: string };
}) {
  const tMs = Math.max(0, Math.round(event.tSec * 1000));
  if (event.type === "hint/endMarker") {
    const action = event?.payload?.action === "clear" ? "clear" : "set";
    endMarkerMs = action === "clear" ? 0 : tMs;
    if (endMarkerMs > 0) {
      pulseBeatTimesMs = normalizeMsList(pulseBeatTimesMs.filter((x) => Number(x) <= endMarkerMs));
      pulseDownbeatTimesMs = normalizeMsList(pulseDownbeatTimesMs.filter((x) => Number(x) <= endMarkerMs));
      beatMarkers = beatMarkers.filter((m) => Number(m.tMs) <= endMarkerMs);
      downbeatMarkers = downbeatMarkers.filter((m) => Number(m.tMs) <= endMarkerMs);
      aiDownbeatMarkers = aiDownbeatMarkers.filter((m) => Number(m.tMs) <= endMarkerMs);
    }
    hintOverlays.push({ type: event.type, tSec: event.tSec, payload: event.payload, actor: "user", at: new Date().toISOString() });
    hintOverlays.sort((a, b) => a.tSec - b.tSec);
    activeHintCount = hintOverlays.length;
    return;
  }
  if (event.type === "hint/sectionMarker") {
    const action = event?.payload?.action === "clear" ? "clear" : "set";
    if (action === "clear") {
      removeSectionMarkerNear(tMs, 140);
    } else if (!hasSectionMarkerNear(tMs, 100)) {
      sectionMarkers.push({ tMs, source: "hint" as const });
      sectionMarkers = sectionMarkers
        .map((m) => ({ tMs: Math.max(0, Math.round(Number(m.tMs) || 0)), source: (m.source === "hint" ? "hint" : "default") as SectionMarkerSource }))
        .filter((m) => Number.isFinite(m.tMs))
        .sort((a, b) => a.tMs - b.tMs);
    }
    hintOverlays.push({ type: event.type, tSec: event.tSec, payload: event.payload, actor: "user", at: new Date().toISOString() });
    hintOverlays.sort((a, b) => a.tSec - b.tSec);
    activeHintCount = hintOverlays.length;
    return;
  }
  if (event.type === "hint/lyricSuppress") {
    const action = event?.payload?.action === "clear" ? "clear" : "set";
    if (action === "clear") {
      removeLyricSuppressMarkerNear(tMs, 140);
    } else if (!hasLyricSuppressMarkerNear(tMs, 100)) {
      lyricSuppressMarkers.push({ tMs, source: "hint" });
      lyricSuppressMarkers = lyricSuppressMarkers
        .map((m) => ({ tMs: Math.max(0, Math.round(Number(m.tMs) || 0)), source: "hint" as const }))
        .filter((m) => Number.isFinite(m.tMs))
        .sort((a, b) => a.tMs - b.tMs);
    }
    hintOverlays.push({ type: event.type, tSec: event.tSec, payload: event.payload, actor: "user", at: new Date().toISOString() });
    hintOverlays.sort((a, b) => a.tSec - b.tSec);
    rebuildLyricSuppressFromHintOverlays();
    activeHintCount = hintOverlays.length;
    return;
  }
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
  events: Array<{
    type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress";
    tSec: number;
    payload?: { beatInBar?: number; action?: "set" | "clear"; groupId?: string };
  }>,
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

function queueHintEvent(event: {
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress";
  tSec: number;
  payload?: { beatInBar?: number; action?: "set" | "clear"; groupId?: string };
}) {
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

function hasLyricSuppressMarkerNear(tMs: number, tolMs = 120) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  return lyricSuppressMarkers.some((m) => Math.abs(m.tMs - ms) <= tolMs);
}

function removeLyricSuppressMarkerNear(tMs: number, tolMs = 120) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  let removed = false;
  for (let i = lyricSuppressMarkers.length - 1; i >= 0; i -= 1) {
    if (Math.abs(lyricSuppressMarkers[i].tMs - ms) <= tolMs) {
      lyricSuppressMarkers.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

function rebuildLyricSuppressFromHintOverlays() {
  const rows = [...hintOverlays].sort((a, b) => {
    const atA = Number.isFinite(Date.parse(String(a?.at || ""))) ? Date.parse(String(a?.at || "")) : 0;
    const atB = Number.isFinite(Date.parse(String(b?.at || ""))) ? Date.parse(String(b?.at || "")) : 0;
    if (atA !== atB) return atA - atB;
    return Number(a.tSec) - Number(b.tSec);
  });
  const out: Array<{ tMs: number; source: "hint" }> = [];
  const windows: Array<{ t0Ms: number; t1Ms: number }> = [];
  let openMs = Number.NaN;
  const maxTrackMs = Math.max(
    0,
    Number.isFinite(Number(audio.duration)) ? Math.round(Number(audio.duration) * 1000) : 0,
    ...pulseBeatTimesMs.map((x) => Math.max(0, Math.round(Number(x) || 0)))
  );
  for (const row of rows) {
    if (row.type !== "hint/lyricSuppress") continue;
    const tMs = Math.max(0, Math.round(Number(row.tSec) * 1000));
    const action = row?.payload?.action === "clear" ? "clear" : "set";
    if (action === "clear") {
      if (Number.isFinite(openMs)) {
        windows.push({ t0Ms: Math.min(openMs, tMs), t1Ms: Math.max(openMs, tMs) });
        openMs = Number.NaN;
      }
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (Math.abs(out[i].tMs - tMs) <= 140) out.splice(i, 1);
      }
    } else if (!out.some((x) => Math.abs(x.tMs - tMs) <= 90)) {
      out.push({ tMs, source: "hint" });
      openMs = tMs;
    }
  }
  lyricSuppressMarkers = out.sort((a, b) => a.tMs - b.tMs);
  if (Number.isFinite(openMs)) {
    windows.push({ t0Ms: Math.max(0, Math.round(openMs)), t1Ms: Math.max(Math.max(0, Math.round(openMs)), maxTrackMs) });
  }
  lyricSuppressWindows = windows
    .map((w) => ({ t0Ms: Math.max(0, Math.round(Number(w.t0Ms) || 0)), t1Ms: Math.max(0, Math.round(Number(w.t1Ms) || 0)) }))
    .filter((w) => Number.isFinite(w.t0Ms) && Number.isFinite(w.t1Ms) && w.t1Ms >= w.t0Ms)
    .sort((a, b) => a.t0Ms - b.t0Ms);
}

function isLyricSuppressedAt(tMs: number) {
  const ms = Math.max(0, Math.round(Number(tMs) || 0));
  return lyricSuppressWindows.some((w) => ms >= w.t0Ms && ms <= w.t1Ms);
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
  lyricSuppressMarkers = [];
  lyricSuppressWindows = [];
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
  let mixPath = String(nextTrack.assetPaths?.mix || "").trim();
  let backingPath = nextTrack.assetPaths?.instrumental || "";
  let vocalsPath = nextTrack.assetPaths?.vocals || "";

  const baseRel = dirnamePosix(mixPath || nextTrack.audio.path);
  if (!mixPath && baseRel) {
    const fallbackMix = `${baseRel}/mix.mp3`;
    try {
      const resp = await fetch(resolveTrackAssetUrl(fallbackMix, baseTrackUrl), { method: "HEAD" });
      if (resp.ok) mixPath = fallbackMix;
    } catch {
      // ignore
    }
  }
  if (!mixPath) mixPath = nextTrack.audio.path;

  if (!backingPath || !vocalsPath) {
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
  const hasTrueMix = Boolean(String(nextTrack.assetPaths?.mix || "").trim() || /\/mix\.mp3$/i.test(String(mixPath)));
  return { hasStems, hasTrueMix, mixPath, backingPath: backingPath || mixPath, vocalsPath };
}

async function resolveEffectivePlaybackAssets(nextTrack: Track, baseTrackUrl: string) {
  const assets = await resolvePlaybackAssets(nextTrack, baseTrackUrl);
  return {
    ...assets,
    hasStems: assets.hasStems || isStemsTrack(nextTrack)
  };
}

async function applyTrackPlaybackAssets(
  assets: Awaited<ReturnType<typeof resolvePlaybackAssets>>,
  baseTrackUrl: string
) {
  const hasStems = assets.hasStems;
  playbackMode = "mix";
  // Playback-first policy: keep auxiliary stem media disabled unless explicitly opted in.
  // This avoids parallel decode/network pressure causing intermittent mix dropouts.
  stemSignalsEnabled = hasStems && stemSignalsOptIn() && !isMobileLike();
  mixControlLabel = assets.hasTrueMix ? "Mix" : "Backing";
  renderMixerControls();
  const audioPlayPath = assets.hasTrueMix ? assets.mixPath : (assets.backingPath || assets.mixPath);
  const audioUrl = resolveTrackAssetUrl(audioPlayPath, baseTrackUrl);
  const wasPlaying = !audio.paused;
  audio.pause();
  audioBacking.pause();
  audioVocals.pause();
  resetStemSyncState();
  await setPrimaryAudioSource(audioUrl);
  if (stemSignalsEnabled && assets.backingPath) {
    audioBacking.src = resolveTrackAssetUrl(assets.backingPath, baseTrackUrl);
    audioBacking.load();
  } else {
    audioBacking.removeAttribute("src");
    audioBacking.load();
  }
  if (stemSignalsEnabled && assets.vocalsPath) {
    audioVocals.src = resolveTrackAssetUrl(assets.vocalsPath, baseTrackUrl);
    audioVocals.load();
  } else {
    audioVocals.removeAttribute("src");
    audioVocals.load();
  }
  ensureAudioGraph();
  applyMixerGains();
  return { wasPlaying };
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
  sectionMarkers = [];
  lyricSuppressMarkers = [];
  lyricSuppressWindows = [];
  activeHintCount = 0;
  beatFusionModeLabel = "-";
  fusionWindowsMs = [];
  endMarkerMs = 0;

  const assetDirUrl = resolveAssetDirUrl(nextTrack, baseTrackUrl);
  if (!assetDirUrl) {
    refreshSectionCache(nextTrack);
    return;
  }

  const effectiveUrl = nextTrack.assetPaths?.effective
    ? resolveTrackAssetUrl(nextTrack.assetPaths.effective, baseTrackUrl)
    : `${assetDirUrl}/effective.json`;
  try {
    const r = await fetch(effectiveUrl, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as EffectiveState;
      const beats = normalizeMsList(j?.effective?.beatsMs);
      const downbeats = normalizeMsList(j?.effective?.downbeatTimesMs);
      endMarkerMs = Number.isFinite(Number(j?.effective?.endMarkerMs))
        ? Math.max(0, Math.round(Number(j?.effective?.endMarkerMs)))
        : 0;
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
      sectionMarkers = Array.isArray(j?.effective?.sectionMarkers)
        ? j.effective.sectionMarkers
          .map((m) => ({
            tMs: Math.max(0, Math.round(Number(m?.tMs))),
            source: m?.source === "hint" ? "hint" as const : "default" as const
          }))
          .filter((m) => Number.isFinite(m.tMs))
          .sort((a, b) => a.tMs - b.tMs)
        : [];
      lyricSuppressMarkers = Array.isArray(j?.effective?.lyricSuppressMarkers)
        ? j.effective.lyricSuppressMarkers
          .map((m) => ({
            tMs: Math.max(0, Math.round(Number(m?.tMs))),
            source: "hint" as const
          }))
          .filter((m) => Number.isFinite(m.tMs))
          .sort((a, b) => a.tMs - b.tMs)
        : [];
      lyricSuppressWindows = Array.isArray(j?.effective?.lyricSuppressWindows)
        ? j.effective.lyricSuppressWindows
          .map((w) => ({
            t0Ms: Math.max(0, Math.round(Number(w?.t0Ms))),
            t1Ms: Math.max(0, Math.round(Number(w?.t1Ms)))
          }))
          .filter((w) => Number.isFinite(w.t0Ms) && Number.isFinite(w.t1Ms) && w.t1Ms >= w.t0Ms)
          .sort((a, b) => a.t0Ms - b.t0Ms)
        : [];
      if (Array.isArray(j?.effective?.sections) && j.effective.sections.length) {
        if (!nextTrack.timing) nextTrack.timing = {};
        nextTrack.timing.sections = j.effective.sections
          .map((s: any) => ({
            id: String(s?.id || ""),
            labelRaw: s?.labelRaw !== undefined ? String(s.labelRaw) : undefined,
            t0Ms: Number.isFinite(Number(s?.t0Ms)) ? Math.max(0, Math.round(Number(s.t0Ms))) : undefined,
            t1Ms: Number.isFinite(Number(s?.t1Ms)) ? Math.max(0, Math.round(Number(s.t1Ms))) : undefined
          }))
          .filter((s: any) => s.id && Number.isFinite(s.t0Ms));
      }
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
      if (!sectionMarkers.length) rebuildSectionMarkersFromHintOverlays();
      if (!lyricSuppressMarkers.length) rebuildLyricSuppressFromHintOverlays();
      activeHintCount = hintOverlays.length;
      refreshSectionCache(nextTrack);
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
  refreshSectionCache(nextTrack);
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
    if (stemSignalsActive()) {
      audioBacking.pause();
      audioVocals.pause();
    }
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
  reactiveHistory.length = 0;
  lowAmpSinceMs = 0;
  reactiveMaster = makeReactiveState();
  reactiveBacking = makeReactiveState();
  reactiveVocals = makeReactiveState();
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
  if (stemSignalsActive() && audioBacking.readyState < 1) {
    if (!audioBacking.preload) audioBacking.preload = "metadata";
    audioBacking.load();
    await once(audioBacking, "loadedmetadata");
  }
  if (stemSignalsActive() && audioVocals.readyState < 1) {
    if (!audioVocals.preload) audioVocals.preload = "metadata";
    audioVocals.load();
    await once(audioVocals, "loadedmetadata");
  }
}

async function seekToSeconds(seconds: number) {
  await ensureMetadataLoaded();
  audio.pause();
  const stemsNow = stemSignalsActive();
  if (stemsNow) {
    audioBacking.pause();
    audioVocals.pause();
  }
  const waitPrimary = once(audio, "seeked");
  const waitBacking = stemsNow ? once(audioBacking, "seeked") : Promise.resolve();
  const waitVocals = stemsNow ? once(audioVocals, "seeked") : Promise.resolve();
  audio.currentTime = seconds;
  if (stemsNow) {
    audioBacking.currentTime = seconds;
    audioVocals.currentTime = seconds;
  }
  await Promise.all([waitPrimary, waitBacking, waitVocals]);

  // Some browsers land compressed-audio seeks slightly off target; nudge once if needed.
  if (Math.abs((Number(audio.currentTime) || 0) - seconds) > 0.03) {
    const waitPrimaryNudge = once(audio, "seeked");
    audio.currentTime = seconds;
    await waitPrimaryNudge;
  }

  if (stemsNow && Math.abs((Number(audioBacking.currentTime) || 0) - seconds) > 0.03) {
    const waitBackingNudge = once(audioBacking, "seeked");
    audioBacking.currentTime = seconds;
    await waitBackingNudge;
  }
  if (stemsNow && Math.abs((Number(audioVocals.currentTime) || 0) - seconds) > 0.03) {
    const waitVocalsNudge = once(audioVocals, "seeked");
    audioVocals.currentTime = seconds;
    await waitVocalsNudge;
  }

  await waitForCanPlay(audio);
  if (stemsNow) {
    await waitForCanPlay(audioBacking);
    await waitForCanPlay(audioVocals);
  }
}

function beginSeek() {
  isSeeking = true;
  wasPlayingBeforeSeek = !audio.paused;
  audio.pause();
  if (stemSignalsActive()) {
    audioBacking.pause();
    audioVocals.pause();
  }
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

function cloneReactiveSeries(src: any): ReactiveSeriesSnapshot {
  const wave = Array.isArray(src?.wave) ? (src.wave as number[]) : [];
  const freq = Array.isArray(src?.freq) ? (src.freq as number[]) : [];
  return {
    ampFast: Number(src?.ampFast ?? 0),
    ampSlow: Number(src?.ampSlow ?? 0),
    low: Number(src?.low ?? 0),
    mid: Number(src?.mid ?? 0),
    high: Number(src?.high ?? 0),
    onsetScore: Number(src?.onsetScore ?? 0),
    onsetPulse: Number(src?.onsetPulse ?? 0),
    wave: wave.slice(),
    freq: freq.slice()
  };
}

function pushReactiveSample(tAudioMs: number, reactiveNow: any) {
  const last = reactiveHistory.length ? reactiveHistory[reactiveHistory.length - 1] : null;
  if (last && tAudioMs - last.tMs < REACTIVE_SAMPLE_MIN_MS) return;
  reactiveHistory.push({
    tMs: Number(tAudioMs) || 0,
    vocalsActive: Number(reactiveNow?.vocalsActive ?? 0),
    master: cloneReactiveSeries(reactiveNow?.master),
    backing: cloneReactiveSeries(reactiveNow?.backing),
    vocals: cloneReactiveSeries(reactiveNow?.vocals)
  });
  const cutoff = tAudioMs - REACTIVE_HISTORY_MS;
  while (reactiveHistory.length > 2 && reactiveHistory[0].tMs < cutoff) reactiveHistory.shift();
}

function lerp(a: number, b: number, u: number) {
  return a + (b - a) * u;
}

function blendSeries(a: ReactiveSeriesSnapshot, b: ReactiveSeriesSnapshot, u: number): ReactiveSeriesSnapshot {
  const wave = (u < 0.5 ? a.wave : b.wave).slice();
  const freq = (u < 0.5 ? a.freq : b.freq).slice();
  return {
    ampFast: lerp(a.ampFast, b.ampFast, u),
    ampSlow: lerp(a.ampSlow, b.ampSlow, u),
    low: lerp(a.low, b.low, u),
    mid: lerp(a.mid, b.mid, u),
    high: lerp(a.high, b.high, u),
    onsetScore: lerp(a.onsetScore, b.onsetScore, u),
    onsetPulse: lerp(a.onsetPulse, b.onsetPulse, u),
    wave,
    freq
  };
}

function reactiveAt(tMs: number, fallback: any) {
  if (!reactiveHistory.length) return fallback;
  if (tMs <= reactiveHistory[0].tMs) return reactiveHistory[0];
  for (let i = 1; i < reactiveHistory.length; i += 1) {
    const a = reactiveHistory[i - 1];
    const b = reactiveHistory[i];
    if (tMs <= b.tMs) {
      const span = Math.max(1, b.tMs - a.tMs);
      const u = Math.max(0, Math.min(1, (tMs - a.tMs) / span));
      return {
        tMs,
        vocalsActive: lerp(Number(a.vocalsActive ?? 0), Number(b.vocalsActive ?? 0), u),
        master: blendSeries(a.master, b.master, u),
        backing: blendSeries(a.backing, b.backing, u),
        vocals: blendSeries(a.vocals, b.vocals, u)
      };
    }
  }
  return reactiveHistory[reactiveHistory.length - 1];
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
  backingAnalyser = audioCtx.createAnalyser();
  vocalsAnalyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  backingAnalyser.fftSize = 1024;
  vocalsAnalyser.fftSize = 1024;
  audioData = new Uint8Array(new ArrayBuffer(analyser.fftSize));
  audioFreqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  backingData = new Uint8Array(new ArrayBuffer(backingAnalyser.fftSize));
  backingFreqData = new Uint8Array(new ArrayBuffer(backingAnalyser.frequencyBinCount));
  vocalsData = new Uint8Array(new ArrayBuffer(vocalsAnalyser.fftSize));
  vocalsFreqData = new Uint8Array(new ArrayBuffer(vocalsAnalyser.frequencyBinCount));

  masterGain = audioCtx.createGain();
  primaryGain = audioCtx.createGain();
  vocalsGain = audioCtx.createGain();

  const primarySrc = audioCtx.createMediaElementSource(audio);
  const backingSrc = audioCtx.createMediaElementSource(audioBacking);
  const vocalsSrc = audioCtx.createMediaElementSource(audioVocals);
  primarySrc.connect(primaryGain);
  backingSrc.connect(backingAnalyser);
  vocalsSrc.connect(vocalsGain);
  primaryGain.connect(masterGain);
  vocalsGain.connect(vocalsAnalyser);
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

function meanBand(data: Uint8Array<ArrayBuffer>, from: number, to: number) {
  const lo = Math.max(0, Math.min(data.length, Math.floor(from)));
  const hi = Math.max(lo + 1, Math.min(data.length, Math.floor(to)));
  let sum = 0;
  for (let i = lo; i < hi; i += 1) sum += data[i] / 255;
  return sum / Math.max(1, hi - lo);
}

function downsampleSeries(
  data: Uint8Array<ArrayBuffer>,
  outCount: number,
  mapFn: (v: number) => number
) {
  const n = Math.max(8, Math.min(512, Math.floor(outCount || 0)));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const lo = Math.max(0, Math.floor(u0 * data.length));
    const hi = Math.max(lo + 1, Math.min(data.length, Math.floor(u1 * data.length)));
    let sum = 0;
    for (let j = lo; j < hi; j += 1) sum += mapFn(data[j]);
    out[i] = sum / Math.max(1, hi - lo);
  }
  return out;
}

function downsampleWaveSeries(data: Uint8Array<ArrayBuffer>, outCount: number) {
  const n = Math.max(16, Math.min(512, Math.floor(outCount || 0)));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const u = (i + 0.5) / n;
    const idx = Math.max(0, Math.min(data.length - 1, Math.floor(u * (data.length - 1))));
    out[i] = (Number(data[idx]) - 128) / 128;
  }
  // Light spatial smoothing avoids zipper noise without collapsing high-frequency content.
  for (let i = 1; i < n - 1; i += 1) {
    out[i] = out[i - 1] * 0.22 + out[i] * 0.56 + out[i + 1] * 0.22;
  }
  return out;
}

function sampleReactiveFromAnalyser(
  analyserNode: AnalyserNode | null,
  timeData: Uint8Array<ArrayBuffer> | null,
  freqData: Uint8Array<ArrayBuffer> | null,
  state: ReactiveState,
  tAudioMs: number
) {
  if (!analyserNode || !timeData || !freqData) {
    return {
      ampRms: 0,
      ampFast: state.ampFast,
      ampSlow: state.ampSlow,
      low: 0,
      mid: 0,
      high: 0,
      onsetScore: state.onsetScore,
      onsetPulse: state.onsetPulse,
      wave: [] as number[],
      freq: [] as number[]
    };
  }

  analyserNode.getByteTimeDomainData(timeData);
  analyserNode.getByteFrequencyData(freqData);

  let sum = 0;
  for (const v of timeData) {
    const n = (v - 128) / 128;
    sum += n * n;
  }
  const ampRms = Math.sqrt(sum / timeData.length);

  const bins = freqData.length;
  const lowEnd = Math.max(2, Math.floor(bins * 0.08));
  const midEnd = Math.max(lowEnd + 2, Math.floor(bins * 0.35));
  const low = meanBand(freqData, 0, lowEnd);
  const mid = meanBand(freqData, lowEnd, midEnd);
  const high = meanBand(freqData, midEnd, bins);

  if (!state.prevSpectrum.length || state.prevSpectrum.length !== bins) {
    state.prevSpectrum = Array.from(freqData, (v) => v / 255);
  }
  let flux = 0;
  for (let i = 0; i < bins; i += 1) {
    const cur = freqData[i] / 255;
    const prev = state.prevSpectrum[i] ?? cur;
    const d = cur - prev;
    if (d > 0) flux += d;
    state.prevSpectrum[i] = cur;
  }
  const onsetScoreRaw = flux / Math.max(1, bins);
  state.ampFast += (ampRms - state.ampFast) * 0.32;
  state.ampSlow += (ampRms - state.ampSlow) * 0.06;
  state.onsetScore += (onsetScoreRaw - state.onsetScore) * 0.24;

  const threshold = state.onsetScore * 1.18 + 0.0045;
  const refractoryMs = 120;
  const canTrigger = tAudioMs - state.lastOnsetMs >= refractoryMs;
  if (canTrigger && onsetScoreRaw > threshold) {
    state.onsetPulse = 1;
    state.lastOnsetMs = tAudioMs;
  } else {
    state.onsetPulse *= 0.84;
  }

  return {
    ampRms,
    ampFast: state.ampFast,
    ampSlow: state.ampSlow,
    low,
    mid,
    high,
    onsetScore: state.onsetScore,
    onsetPulse: state.onsetPulse,
    wave: downsampleWaveSeries(timeData, 192),
    freq: downsampleSeries(freqData, 96, (v) => v / 255)
  };
}

function vocalsWordGateAt(tMs: number) {
  const words = Array.isArray(track?.timing?.words) ? track.timing.words : [];
  if (!words.length) return 0;
  let best = 0;
  for (const w of words) {
    const t0 = Number(w?.t0Ms);
    const t1 = Number(w?.t1Ms);
    if (!Number.isFinite(t0)) continue;
    const end = Number.isFinite(t1) ? t1 : t0 + 180;
    const open = t0 - 1200;
    const close = end + 900;
    if (tMs < open || tMs > close) continue;
    if (tMs >= t0 && tMs <= end) return 1;
    const u = tMs < t0 ? (tMs - open) / Math.max(1, t0 - open) : (close - tMs) / Math.max(1, close - end);
    if (u > best) best = u;
  }
  return Math.max(0, Math.min(1, best));
}

function sampleReactiveAudio(tAudioMs: number) {
  const master = sampleReactiveFromAnalyser(analyser, audioData, audioFreqData, reactiveMaster, tAudioMs);
  if (!stemSignalsActive()) {
    return {
      master,
      backing: master,
      vocals: { ...master, ampFast: 0, ampSlow: 0, low: 0, mid: 0, high: 0, onsetScore: 0, onsetPulse: 0, ampRms: 0, wave: [], freq: [] },
      vocalsActive: 0
    };
  }
  const backing = sampleReactiveFromAnalyser(backingAnalyser, backingData, backingFreqData, reactiveBacking, tAudioMs);
  const vocalsRaw = sampleReactiveFromAnalyser(vocalsAnalyser, vocalsData, vocalsFreqData, reactiveVocals, tAudioMs);
  const wordGate = vocalsWordGateAt(tAudioMs);
  const vocalEnergyGate = Math.max(
    0,
    Math.min(1, (Number(vocalsRaw.ampFast) - 0.012) / 0.08)
  );
  const vocalsActive = Math.max(wordGate * 0.9, vocalEnergyGate * 0.65);
  return {
    master,
    backing,
    vocals: vocalsRaw,
    vocalsActive
  };
}

function fmtMs(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function estimateBpmFromBeats(beatsMs: number[]): number {
  const xs = (Array.isArray(beatsMs) ? beatsMs : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (xs.length < 3) return NaN;
  const diffs: number[] = [];
  for (let i = 1; i < xs.length; i += 1) {
    const d = xs[i] - xs[i - 1];
    if (d >= 180 && d <= 2000) diffs.push(d);
  }
  if (!diffs.length) return NaN;
  diffs.sort((a, b) => a - b);
  const mid = diffs[Math.floor(diffs.length * 0.5)];
  if (!Number.isFinite(mid) || mid <= 0) return NaN;
  return 60000 / mid;
}

function estimateBeatMsFromBeats(beatsMs: number[]): number {
  const bpm = estimateBpmFromBeats(beatsMs);
  if (!Number.isFinite(bpm) || bpm <= 0) return NaN;
  return 60000 / bpm;
}

function pickRhythmPatternId(seedBase: number, sectionType: string) {
  const st = String(sectionType || "").toLowerCase();
  const families = st === "chorus"
    ? ["quarters", "eighths", "eighths-sync", "sixteenths-lite", "offbeat"]
    : st === "bridge"
      ? ["eighths-sync", "offbeat", "fill-forward", "sixteenths-lite"]
      : st === "intro" || st === "outro"
        ? ["quarters", "offbeat", "eighths"]
        : ["quarters", "eighths", "offbeat", "eighths-sync"];
  const idx = (hashStringToSeed(`rhythm-pattern:${seedBase}:${st}`) >>> 0) % families.length;
  return families[idx];
}

function buildPatternSteps16(patternId: string): {
  grid: number[];
  accent: number[];
  motion: number[];
  transition: number[];
  fill: number[];
} {
  const p = String(patternId || "quarters").toLowerCase();
  if (p === "eighths") {
    return { grid: [0, 2, 4, 6, 8, 10, 12, 14], accent: [0, 8], motion: [0, 2, 4, 6, 8, 10, 12, 14], transition: [0, 4, 8, 12], fill: [12, 14] };
  }
  if (p === "eighths-sync") {
    return { grid: [0, 2, 4, 6, 8, 10, 12, 14], accent: [0, 8], motion: [0, 3, 6, 8, 11, 14], transition: [0, 8], fill: [10, 12, 14] };
  }
  if (p === "offbeat") {
    return { grid: [0, 4, 8, 12], accent: [0, 8], motion: [2, 6, 10, 14], transition: [0, 8], fill: [13, 14, 15] };
  }
  if (p === "fill-forward") {
    return { grid: [0, 4, 8, 12], accent: [0, 8], motion: [0, 4, 8, 10, 12, 14], transition: [0, 8], fill: [11, 12, 13, 14, 15] };
  }
  if (p === "sixteenths-lite") {
    return { grid: [0, 4, 8, 12], accent: [0, 8], motion: [0, 2, 4, 7, 8, 10, 12, 15], transition: [0, 8], fill: [12, 13, 14, 15] };
  }
  return { grid: [0, 4, 8, 12], accent: [0, 8], motion: [0, 4, 8, 12], transition: [0, 8], fill: [12] };
}

function nearestLanePulseFromSteps16(
  tMs: number,
  barStartMs: number,
  stepMs: number,
  steps16: number[],
  windowMs: number
) {
  if (!steps16.length || !Number.isFinite(stepMs) || stepMs <= 0) return { pulse: 0, hit: false };
  let best = Infinity;
  for (let barOffset = -1; barOffset <= 1; barOffset += 1) {
    const barBase = barStartMs + barOffset * stepMs * 16;
    for (const s of steps16) {
      const ts = barBase + s * stepMs;
      const d = Math.abs(tMs - ts);
      if (d < best) best = d;
    }
  }
  if (!Number.isFinite(best)) return { pulse: 0, hit: false };
  const pulse = Math.max(0, Math.min(1, 1 - best / Math.max(1, windowMs)));
  return { pulse, hit: pulse > 0.88 };
}

function buildRhythmCueState(input: {
  tMs: number;
  beatsMs: number[];
  downbeatsMs: number[];
  sectionId: string;
  sectionType: string;
  seedBase: number;
}) {
  const beatsSorted = (Array.isArray(input.beatsMs) ? input.beatsMs : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const estimateLocalBeatMs = (tMs: number) => {
    if (beatsSorted.length < 3) return estimateBeatMsFromBeats(beatsSorted);
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < beatsSorted.length; i += 1) {
      const d = Math.abs(beatsSorted[i] - tMs);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const i0 = Math.max(1, nearestIdx - 5);
    const i1 = Math.min(beatsSorted.length - 1, nearestIdx + 5);
    const diffs: number[] = [];
    for (let i = i0; i <= i1; i += 1) {
      const d = beatsSorted[i] - beatsSorted[i - 1];
      if (d >= 180 && d <= 2000) diffs.push(d);
    }
    if (!diffs.length) return estimateBeatMsFromBeats(beatsSorted);
    diffs.sort((a, b) => a - b);
    return diffs[Math.floor(diffs.length * 0.5)];
  };
  const tMs = Number(input.tMs);
  const ds = (Array.isArray(input.downbeatsMs) ? input.downbeatsMs : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const estimateFromDownbeats = () => {
    if (ds.length < 2) return NaN;
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < ds.length; i += 1) {
      const d = Math.abs(ds[i] - tMs);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const i0 = Math.max(1, nearestIdx - 4);
    const i1 = Math.min(ds.length - 1, nearestIdx + 4);
    const quarterSteps: number[] = [];
    for (let i = i0; i <= i1; i += 1) {
      const d = ds[i] - ds[i - 1];
      // downbeat-to-downbeat interval should be one bar; divide by 4 for quarter note.
      const q = d / 4;
      if (q >= 180 && q <= 2000) quarterSteps.push(q);
    }
    if (!quarterSteps.length) return NaN;
    quarterSteps.sort((a, b) => a - b);
    return quarterSteps[Math.floor(quarterSteps.length * 0.5)];
  };
  const beatFromDownbeats = estimateFromDownbeats();
  const beatMs = Number.isFinite(beatFromDownbeats) && beatFromDownbeats > 0
    ? beatFromDownbeats
    : estimateLocalBeatMs(tMs);
  if (!Number.isFinite(beatMs) || beatMs <= 0) {
    return {
      bpm: NaN,
      beatMs: NaN,
      barIndex: 0,
      barStartMs: 0,
      phaseBar: 0,
      step16: 0,
      patternId: "quarter4",
      cueCount: 4,
      step16s: [0, 4, 8, 12],
      lanes: {
        grid: { pulse: 0, hit: false },
        accent: { pulse: 0, hit: false },
        motion: { pulse: 0, hit: false },
        transition: { pulse: 0, hit: false },
        fill: { pulse: 0, hit: false }
      },
      laneSteps16: {
        grid: [],
        accent: [],
        motion: [],
        transition: [],
        fill: []
      }
    };
  }
  const beatsPerBar = 4;
  const barMs = beatMs * beatsPerBar;
  let barIndex = 0;
  let barStartMs = 0;
  if (ds.length) {
    let idx = -1;
    for (let i = 0; i < ds.length; i += 1) {
      if (ds[i] <= tMs) idx = i;
      else break;
    }
    if (idx >= 0) {
      barIndex = idx;
      barStartMs = ds[idx];
    } else {
      const stepsBack = Math.ceil((ds[0] - tMs) / Math.max(1, barMs));
      barIndex = 0;
      barStartMs = ds[0] - Math.max(1, stepsBack) * barMs;
    }
  } else {
    const origin = Number(beatsSorted[0] ?? 0);
    const barIndexRaw = Number.isFinite(origin) ? Math.floor((tMs - origin) / Math.max(1, barMs)) : 0;
    barIndex = Math.max(0, barIndexRaw);
    barStartMs = Number.isFinite(origin) ? (origin + barIndex * barMs) : 0;
  }
  const phaseBar = Math.max(0, Math.min(1, (tMs - barStartMs) / Math.max(1, barMs)));
  const step16f = (tMs - barStartMs) / Math.max(1, beatMs / 4);
  const step16 = ((Math.floor(step16f) % 16) + 16) % 16;

  const rhythmCacheKey = `${input.seedBase}:${String(input.sectionId || "")}:${barIndex}`;
  let cachedPlan = rhythmPlanCache.get(rhythmCacheKey);
  if (!cachedPlan) {
    const baseSteps = [0, 4, 8, 12];
    const variationSeed = hashStringToSeed(`rhythm-variation:${input.seedBase}:${input.sectionId}:${barIndex}`) >>> 0;
    const rng = mulberry32(variationSeed);
    const removable = [4, 8, 12];
    const offbeats = [2, 6, 10, 14];
    const chosen = new Set<number>(baseSteps);
    let removed: number | null = null;
    if (rng() < 0.3) {
      removed = removable[Math.floor(rng() * removable.length)];
      chosen.delete(removed);
    }
    const added: number[] = [];
    for (const s of offbeats) {
      if (rng() < 0.3) {
        chosen.add(s);
        added.push(s);
      }
    }
    const fixed = Array.from(chosen).sort((a, b) => a - b);
    const removedTag = removed === null ? "" : `-r${removed}`;
    const addedTag = added.length ? `+o${added.join("o")}` : "";
    cachedPlan = {
      step16s: fixed,
      patternId: `quarter4${removedTag}${addedTag}`,
      cueCount: fixed.length
    };
    if (rhythmPlanCache.size > 2400) rhythmPlanCache.clear();
    rhythmPlanCache.set(rhythmCacheKey, cachedPlan);
  }
  const fixedSteps = cachedPlan.step16s;
  const patternId = cachedPlan.patternId;
  const pattern = {
    grid: fixedSteps,
    accent: fixedSteps,
    motion: fixedSteps,
    transition: fixedSteps,
    fill: fixedSteps
  };
  const pulseWindowMs = Math.max(26, Math.min(120, beatMs * 0.16));
  const stepMs = beatMs / 4;
  return {
    bpm: 60000 / beatMs,
    beatMs,
    barIndex,
    barStartMs,
    phaseBar,
    step16,
    patternId,
    cueCount: cachedPlan.cueCount,
    step16s: fixedSteps,
    lanes: {
      grid: nearestLanePulseFromSteps16(tMs, barStartMs, stepMs, pattern.grid, pulseWindowMs),
      accent: nearestLanePulseFromSteps16(tMs, barStartMs, stepMs, pattern.accent, pulseWindowMs),
      motion: nearestLanePulseFromSteps16(tMs, barStartMs, stepMs, pattern.motion, pulseWindowMs),
      transition: nearestLanePulseFromSteps16(tMs, barStartMs, stepMs, pattern.transition, pulseWindowMs),
      fill: nearestLanePulseFromSteps16(tMs, barStartMs, stepMs, pattern.fill, pulseWindowMs)
    },
    laneSteps16: pattern
  };
}

function hudKeyHelpLines(): string[] {
  const lines: string[] = [
    `keys: space play/pause`,
    `      left/right seek`
  ];
  if (isSeedRefreshMode()) {
    lines.push(`      r refresh seed`);
  }
  lines.push(`      v cycle mode`);
  if (isPrimitiveLabMode()) {
    lines.push(`      j/k lab primitive prev/next`);
    lines.push(`      b lab backdrop off/fixed/random`);
  }
  if (isGraphMode()) {
    lines.push(`      j/k prev/next graph recipe`);
    lines.push(`      r refresh graph variant`);
    lines.push(`      a auto refresh (downbeat+section)`);
  }
  if (viewerMode === "transition-lab") {
    lines.push(`      t/y transition prev/next`);
    lines.push(`      u/i transition variant -/+`);
  }
  if (isHintEditMode()) {
    lines.push(`      d = downbeat anchor (keep established tempo)`);
    lines.push(`      1/2/3/4 = measure tempo hints`);
    lines.push(`      b = single beat hint`);
    lines.push(`      s = toggle section marker`);
    lines.push(`      e = toggle ending marker`);
    lines.push(`      u undo last hint group`);
    lines.push(`      c clear hints`);
    lines.push(`      x toggle lyric-suppression marker`);
  }
  lines.push(`      [ ] offset`);
  lines.push(`      o cycle offset preset`);
  lines.push(`      h/? hud`);
  return lines;
}

function updateGraphSectionState(sectionId: string) {
  if (isGraphMode()) {
    const sectionChanged = Boolean(lastGraphSectionId && sectionId !== lastGraphSectionId);
    if (viewerMode === "transition-lab" && sectionChanged) {
      randomizeTransitionLabVariant(sectionId);
    }
    if (!graphAutoRefresh && graphManualRecipe && lastGraphSectionId && sectionId !== lastGraphSectionId) {
      graphManualRecipe = null;
    }
    if (graphAutoRefresh && lastGraphSectionId && sectionId !== lastGraphSectionId) {
      if (viewerMode === "transition-lab") {
        // In transition-lab keep graph selection stable across section boundary.
      } else if (viewerMode === "recipe-view") cycleGraphRecipeForSection(currentRecipe, sectionId);
      else cycleRandomSceneForSection(sectionId);
    }
    lastGraphSectionId = sectionId;
    return;
  }
  lastGraphSectionId = "";
}

function updateGraphAutoVariantState(sectionId: string, tRenderMs: number, suspendAuto = false) {
  if (isGraphMode()) {
    if (suspendAuto) return;
    if (viewerMode === "transition-lab") {
      const dbCount = downbeatCountAt(tRenderMs);
      const barCount = Math.max(0, Math.floor(dbCount / 4));
      if (lastAutoBarCount < 0) lastAutoBarCount = barCount;
      if (graphAutoRefresh && barCount > lastAutoBarCount) {
        const delta = barCount - lastAutoBarCount;
        for (let i = 0; i < delta; i += 1) cycleGraphVariantForSection(sectionId);
      }
      lastAutoBarCount = barCount;
      lastAutoDownbeatCount = -1;
      return;
    }
    const dbCount = downbeatCountAt(tRenderMs);
    if (lastAutoDownbeatCount < 0) lastAutoDownbeatCount = dbCount;
    if (graphAutoRefresh && dbCount > lastAutoDownbeatCount) {
      const delta = dbCount - lastAutoDownbeatCount;
      for (let i = 0; i < delta; i += 1) cycleGraphVariantForSection(sectionId);
    }
    lastAutoDownbeatCount = dbCount;
    lastAutoBarCount = -1;
    return;
  }
  lastAutoDownbeatCount = -1;
  lastAutoBarCount = -1;
}

function hudHintModeLines(signalBus: any): string[] {
  if (!isHintEditMode()) return [];
  return [
    `fusion: ${signalBus.hints.fusionModeLabel} (now: ${signalBus.beat.fusionMode})`,
    `reactive: L${signalBus.reactive.low.toFixed(2)} M${signalBus.reactive.mid.toFixed(2)} H${signalBus.reactive.high.toFixed(2)} O${signalBus.reactive.onsetPulse.toFixed(2)} VA${signalBus.reactive.vocalsActive.toFixed(2)}`
  ];
}

function hudLabModeLines(labProfileRounded: any): string[] {
  if (!isPrimitiveLabMode()) return [];
  return [
    `labPrimitive: ${labPrimitive}`,
    `labBackdropPolicy: ${labBackdropPolicy}`,
    `labBackdrop: ${currentLabBackdropId()}`,
    `labSeed: ${labSeedForPrimitive()}`,
    `labProfile: ${stableStringify(labProfileRounded)}`
  ];
}

function hudGraphModeLines(
  modeRecipe: any,
  graphSel: any,
  playerSceneChoice: any,
  playerVariantIndex: number,
  nextSectionId: string,
  nextSectionInMs: number
): string[] {
  if (!isGraphCapableMode()) return [];
  const graphLayerCount = Array.isArray(modeRecipe?.graph?.layers) ? modeRecipe.graph.layers.length : 0;
  const lines: string[] = [`graphLayers: ${graphLayerCount}`];
  if (viewerMode === "player") {
    lines.push(`playerSource: ${playerSceneChoice?.source ?? "-"}`);
    lines.push(`playerVariant: ${playerVariantIndex}`);
    lines.push(`playerScene: ${playerSceneChoice?.sceneIndex ?? "-"} bg:${playerSceneChoice?.backgroundIndex ?? "-"} 2bar:${playerSceneChoice?.cycleEvery2Bars ? "on" : "off"} b3:${playerSceneChoice?.beat3Accent ? "*" : "-"}`);
    lines.push(`playerTransition: ${playerLastTransitionLabel}`);
    lines.push(`nextSection: ${nextSectionId || "-"} in ${Number.isFinite(nextSectionInMs) ? `${nextSectionInMs}ms` : "-"}`);
  }
  if (viewerMode === "transition-lab") {
    const preset = transitionLabPreset();
    lines.push(`transitionLab: ${preset.label}`);
    lines.push(`transitionVariant: ${transitionLabVariant}`);
    lines.push(`nextSection: ${nextSectionId || "-"} in ${Number.isFinite(nextSectionInMs) ? `${nextSectionInMs}ms` : "-"}`);
    lines.push(`graphVariant: ${graphSel?.variant ?? 0} auto=${graphAutoRefresh ? "on" : "off"}`);
    lines.push(`graphMode: ${viewerMode}`);
    return lines;
  }
  lines.push(`graphRecipe: ${graphSel?.template?.id ?? "-"} (#${graphSel ? graphSel.selectedIndex + 1 : "-"}/${graphSel?.templates?.length ?? "-"})`);
  lines.push(`graphVariant: ${graphSel?.variant ?? 0}`);
  if (!isPlayerMode()) {
    lines.push(`graphManual: ${graphSel?.isManual ? "on" : "off"} auto=${graphAutoRefresh ? "on" : "off"}`);
  }
  lines.push(`graphMode: ${viewerMode}`);
  return lines;
}

function resetTrackLoadModeState() {
  graphManualRecipe = null;
  graphVariantBySection.clear();
  graphAutoRefresh = viewerMode === "transition-lab";
  lastGraphSectionId = "";
  lastAutoDownbeatCount = -1;
  lastAutoBarCount = -1;
  playerLastSectionId = "";
  playerLastTransitionLabel = "crossfade";
  audioWaitingCount = 0;
  audioStalledCount = 0;
  audioSuspendCount = 0;
  audioProgressAtMs = 0;
  invalidateModeRecipeMemo();
  rhythmPlanCache.clear();
}

function defaultFallbackRecipe() {
  return { layers: [{ module: "bg.gradientField", params: { gradientStops: 3 } }] };
}

async function resolveTrackRecipe(nextTrack: Track) {
  let resolved: any = null;
  if (__RELEASE_MODE__) {
    const releaseRecipePath = String(nextTrack.releaseRecipePath || `/recipes/${encodeURIComponent(nextTrack.trackId || "")}.json`);
    const relResp = await fetch(new URL(releaseRecipePath, location.origin).toString());
    if (relResp.ok) resolved = await relResp.json();
  }
  if (!resolved) {
    const albumId = nextTrack.recipeRef?.albumId ?? "example-theme";
    const override = nextTrack.recipeRef?.trackOverrideId ?? "";
    const recipeUrl = new URL(`/recipes/resolve?albumId=${encodeURIComponent(albumId)}&trackOverrideId=${encodeURIComponent(override)}`, location.origin);
    let recipeResp = await fetch(recipeUrl.toString());
    if (!recipeResp.ok) {
      const fallbackUrl = new URL(`/recipes/resolve?albumId=example-theme&trackOverrideId=${encodeURIComponent(override)}`, location.origin);
      recipeResp = await fetch(fallbackUrl.toString());
    }
    resolved = recipeResp.ok ? await recipeResp.json() : defaultFallbackRecipe();
  }
  return applyVisualHintsToRecipe(resolved, nextTrack);
}

function applyTrackSeed(trackId: string) {
  if (!Number.isInteger(seed)) {
    buildScene(hashStringToSeed(trackId));
    updateUrlParam("seed", String(seed));
    return;
  }
  buildScene(seed);
}

function runPostTrackLoadHousekeeping(trackId: string) {
  resetAmpHistory("track-load");
  logAudioState("track-loaded", { trackId });
  lyricsLines = String(track?.lyrics?.rawText ?? "").split("\n");
}

function triggerAuthoringReduce(nextTrack: Track) {
  if (!__AUTHORING_MODE__ || !nextTrack.workId || !nextTrack.trackId) return;
  void fetch("/authoring/reduce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workId: nextTrack.workId, trackId: nextTrack.trackId })
  }).catch(() => undefined);
}

async function resumePlaybackIfNeeded(wasPlaying: boolean) {
  if (wasPlaying) {
    await playSynced();
  }
  setPlayButtonIcon();
}

async function loadTrackJsonAndGuidance(entry: string): Promise<Track> {
  trackUrl = new URL(`/tracks/${entry}`, location.origin).toString();
  const resp = await fetch(trackUrl);
  if (!resp.ok) throw new Error(`Failed to load track json: ${entry}`);
  const nextTrack = (await resp.json()) as Track;
  await loadEffectiveGuidance(nextTrack, trackUrl);
  return nextTrack;
}

async function resolveTrackRecipeWithFallback(nextTrack: Track) {
  try {
    return await resolveTrackRecipe(nextTrack);
  } catch {
    return applyVisualHintsToRecipe(defaultFallbackRecipe(), nextTrack);
  }
}

function applyInitialViewerConfigFromUrl() {
  const url = new URL(location.href);
  const requestedTrackId = url.searchParams.get("track");
  const seedParam = url.searchParams.get("seed");
  const offsetParam = url.searchParams.get("offset");
  const modeParam = url.searchParams.get("mode");
  const labPrimitiveParam = url.searchParams.get("labPrimitive");
  const transitionParam = String(url.searchParams.get("transition") || "").trim().toLowerCase();
  seed = seedParam ? Number(seedParam) : NaN;
  const storedOffset = loadStoredOffsetMs();
  const initialOffset = offsetParam ? Number(offsetParam) : (storedOffset ?? DEFAULT_RENDER_OFFSET_MS);
  setRenderOffset(initialOffset);
  labPrimitive = normalizeLabPrimitive(labPrimitiveParam);
  if (transitionParam) {
    const i = TRANSITION_LAB_PRESETS.findIndex((p) => String(p.id).toLowerCase() === transitionParam);
    if (i >= 0) transitionLabPresetIndex = i;
  }
  setViewerMode(normalizeViewerMode(modeParam));
  lyricsEnabled = true;
  lyricMode = "center";
  syncLyricsUrlParams();
  return { requestedTrackId };
}

function resolveInitialTrackIndex(requestedTrackId: string | null) {
  if (!requestedTrackId) return 0;
  const byTrackId = indexEntries.findIndex((entry) => trackIdFromEntry(entry) === requestedTrackId);
  return byTrackId >= 0 ? byTrackId : 0;
}

function normalizeLyricMode(value: string | null | undefined): LyricMode {
  return value === "fixed" || value === "off" ? value : "center";
}

function invalidateModeRecipeMemo() {
  modeRecipeResolver.clear();
}

function refreshSectionCache(trackLike: Track | null = track) {
  const sections = Array.isArray(trackLike?.timing?.sections) ? trackLike.timing.sections : [];
  cachedSectionsSorted = sections
    .filter((s: any) => Number.isFinite(Number(s?.t0Ms)))
    .slice()
    .sort((a: any, b: any) => Number(a.t0Ms) - Number(b.t0Ms));
}

function sortedTimedSections() {
  return cachedSectionsSorted;
}

function currentSectionIndex(currentTimeMs: number) {
  const sections = sortedTimedSections();
  let lo = 0;
  let hi = sections.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t0 = Number(sections[mid]?.t0Ms);
    if (!Number.isFinite(t0)) {
      hi = mid - 1;
      continue;
    }
    if (t0 <= currentTimeMs) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0) {
    const t0 = Number(sections[idx].t0Ms);
    const t1Explicit = Number.isFinite(Number(sections[idx].t1Ms)) ? Number(sections[idx].t1Ms) : Number.POSITIVE_INFINITY;
    const t1Next = idx + 1 < sections.length ? Number(sections[idx + 1].t0Ms) : Number.POSITIVE_INFINITY;
    const t1 = Math.min(t1Explicit, t1Next);
    if (!(currentTimeMs >= t0 && currentTimeMs < t1) && currentTimeMs < t0) idx = idx - 1;
  }
  return { sections, idx };
}

function findCurrentSection(currentTimeMs: number) {
  const { sections, idx } = currentSectionIndex(currentTimeMs);
  if (idx < 0 || idx >= sections.length) return null;
  return sections[idx];
}

function findNextSection(currentTimeMs: number) {
  const { sections, idx } = currentSectionIndex(currentTimeMs);
  const nextIdx = idx + 1;
  if (nextIdx < 0 || nextIdx >= sections.length) return null;
  return sections[nextIdx];
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
  const backdrop = currentLabBackdropId();

  // Lab backdrop policy: off => explicit black, otherwise deterministic background primitive.
  if (backdrop === "black") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else if (backdrop === "gradient") {
    renderRegisteredModule({
      moduleId: "bg.gradientField",
      ctx,
      canvas,
      tMs: signalBus.time.renderMs,
      seed: (labSeedForPrimitive() ^ hashStringToSeed("bg.gradient")) >>> 0,
      params: {
        gradientStops: Math.max(3, Math.min(7, Math.round(2 + labDensity))),
        driftSpeed: 0.006 + labScale * 0.01,
        noiseScale: 0.25 + labDensity * 0.22,
        soften: 0.9 + Math.min(0.08, labScale * 0.03)
      },
      colors: palettes[Math.abs(seed) % palettes.length],
      sectionType: "verse" as any,
      state: { tMs: signalBus.time.renderMs, amp, signalBus }
    });
  } else if (backdrop === "vignette") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    const pulse = 0.08 * Math.sin(t * 0.23 + seedPhase);
    const g = ctx.createRadialGradient(cx, cy, Math.max(1, Math.min(w, h) * 0.12), cx, cy, Math.max(w, h) * (0.62 + pulse));
    g.addColorStop(0, "rgba(16,24,40,0.95)");
    g.addColorStop(0.6, "rgba(7,10,18,0.92)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else if (backdrop === "bands") {
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#060910";
    ctx.fillRect(0, 0, w, h);
    const bandCount = 10;
    for (let i = 0; i < bandCount; i += 1) {
      const u = i / Math.max(1, bandCount - 1);
      const y = h * u;
      const a = 0.08 + 0.1 * Math.sin(t * 0.35 + i * 0.9 + seedPhase);
      ctx.fillStyle = `rgba(48, 96, 156, ${Math.max(0.03, Math.min(0.2, a))})`;
      ctx.fillRect(0, y, w, Math.max(1, h / (bandCount * 2.2)));
    }
    ctx.restore();
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  if (labPrimitive === "bg.gradientField") {
    renderRegisteredModule({
      moduleId: "bg.gradientField",
      ctx,
      canvas,
      tMs: signalBus.time.renderMs,
      seed: labSeedForPrimitive(),
      params: {
        gradientStops: Math.max(3, Math.min(7, Math.round(2 + labDensity))),
        driftSpeed: 0.006 + labScale * 0.01,
        noiseScale: 0.25 + labDensity * 0.22,
        soften: 0.9 + Math.min(0.08, labScale * 0.03)
      },
      colors: palettes[Math.abs(seed) % palettes.length],
      sectionType: "verse" as any,
      state: {
        tMs: signalBus.time.renderMs,
        amp,
        signalBus
      }
    });
  } else if (labPrimitive === "fg.particles") {
    renderRegisteredModule({
      moduleId: "fg.particles",
      ctx,
      canvas,
      tMs: signalBus.time.renderMs,
      seed: labSeedForPrimitive(),
      params: {
        count: Math.max(24, Math.round(42 * labDensity)),
        sizeRange: [1.0 + labScale * 0.5, 2.5 + labScale * 1.6],
        speed: 0.2 + labScale * 0.28,
        curl: 0.25 + labDensity * 0.2,
        opacity: 0.32 + Math.min(0.5, labDensity * 0.14)
      },
      colors: palettes[Math.abs(seed) % palettes.length],
      sectionType: "verse" as any,
      state: {
        tMs: signalBus.time.renderMs,
        amp,
        signalBus
      }
    });
  } else if (labPrimitive === "shape.beatOrb") {
    drawBeatOrb(beat, downbeat);
  } else if (labPrimitive === "shape.circlePulse") {
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
  } else if (labPrimitive === "curve.rosetteSpiral") {
    const points = Math.max(240, Math.round(460 * labDensity));
    const petals = Math.max(3, Math.round(3 + labDensity * 2.8));
    const turns = 6 + labDensity * 2.6;
    const maxTheta = Math.PI * 2 * turns;
    const mode = labDensity > 2.6 ? "star" : labDensity > 1.7 ? "hybrid" : "rosette";
    const skip = labDensity > 2.8 ? 3 : labDensity > 1.9 ? 2 : 1;
    const symmetrySnap = labDensity > 2.3 ? petals : labDensity > 1.2 ? Math.max(4, petals - 1) : 0;
    const symmetryMix = symmetrySnap > 1 ? 0.72 : 0;
    const connectMode = labDensity > 3.1 ? "chords" : labDensity > 2.1 ? "skip" : labDensity < 0.95 ? "radial" : "sequential";
    const useBlack = labScale < 0.95 && backdrop !== "black";
    const growth = 2.0 + labScale * 1.2;
    const petalAmp = 8 + labScale * 15;
    const spin = 0.06 + labDensity * 0.065;
    const twistAmp = 0.08 + beat * 0.1;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < points; i += 1) {
      const u = i / Math.max(1, points - 1);
      const theta = u * maxTheta;
      const spiralR = growth * theta;
      const pWave = Math.cos(theta * petals + seedPhase + t * 0.18);
      const rosetteR = spiralR + petalAmp * pWave;
      const starR = spiralR + petalAmp * Math.sign(pWave);
      const r = mode === "star" ? starR : mode === "hybrid" ? spiralR * 0.45 + rosetteR * 0.55 : rosetteR;
      const phi = theta + spin * theta + twistAmp * Math.sin(theta * 0.1 + t * 0.2) + downbeat * 0.08;
      const snapStep = symmetrySnap > 1 ? (Math.PI * 2) / symmetrySnap : 0;
      const snappedPhi = snapStep > 0 ? Math.round(phi / snapStep) * snapStep : phi;
      const phiFinal = snapStep > 0 ? (phi * (1 - symmetryMix) + snappedPhi * symmetryMix) : phi;
      const x = cx + r * Math.cos(phiFinal) * 0.9;
      const y = cy + r * Math.sin(phiFinal) * 0.9;
      pts.push({ x, y });
    }
    if (useBlack) {
      // Black disappears under screen; use normal compositing for this branch.
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.strokeStyle = useBlack ? `rgba(0,0,0,${0.78 + amp * 0.2})` : `rgba(130, 210, 255, ${0.54 + amp * 0.3})`;
    ctx.lineWidth = 0.9 + beat * 1.2;
    if (connectMode === "radial") {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += Math.max(1, skip)) {
        const p = pts[i];
        ctx.moveTo(cx, cy);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    } else if (connectMode === "chords") {
      const chordStep = Math.max(2, petals - 1);
      const chordStride = Math.max(1, Math.floor(skip));
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += chordStride) {
        const a = pts[i];
        const b = pts[(i + chordStep) % pts.length];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    } else if (connectMode === "skip" || skip > 1) {
      for (let start = 0; start < skip; start += 1) {
        ctx.beginPath();
        let first = true;
        for (let i = start; i < pts.length; i += skip) {
          const p = pts[i];
          if (first) {
            ctx.moveTo(p.x, p.y);
            first = false;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
  } else if (labPrimitive === "text.echoWord") {
    const lyricIndex = Number(findCurrentLyricLine(signalBus.time.renderMs)?.i);
    const timingLines = Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines : [];
    const firstLyricStartMs = timingLines
      .map((x: any) => Number(x?.t0Ms))
      .filter((x: number) => Number.isFinite(x))
      .sort((a: number, b: number) => a - b)[0];
    const lyricsHaveStarted = Number.isFinite(firstLyricStartMs) && signalBus.time.renderMs >= Number(firstLyricStartMs);
    const rawLines = String(track?.lyrics?.rawText ?? "").split(/\r?\n/);
    const activeLyric = Number.isInteger(lyricIndex) && lyricIndex >= 0 && lyricIndex < rawLines.length
      ? String(rawLines[lyricIndex] ?? "").trim()
      : "";
    const titleFallback = lyricsHaveStarted ? "" : preferredTrackTitle(track);
    const text = activeLyric || titleFallback;
    if (!text) {
      ctx.restore();
      return;
    }
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
  } else if (labPrimitive === "text.karaoke") {
    renderRegisteredModule({
      moduleId: "ui.lyricsKaraoke",
      ctx,
      canvas,
      tMs: signalBus.time.renderMs,
      seed: labSeedForPrimitive(),
      params: {
        mode: "center",
        fontSizePx: Math.round(30 * labScale),
        lineGapPx: Math.max(8, Math.round(10 * labDensity)),
        opacity: 0.92
      },
      colors: palettes[Math.abs(seed) % palettes.length],
      sectionType: "verse" as any,
      state: {
        tMs: signalBus.time.renderMs,
        amp,
        signalBus,
        track,
        lyricsEnabled: hasLyricTiming(),
        lyricMode: "center"
      }
    });
  }
  ctx.restore();
}

function buildSignalBus(input: {
  tAudioMs: number;
  tRenderMs: number;
  durationSec: number;
  amp: number;
  reactive: {
    ampFast: number;
    ampSlow: number;
    low: number;
    mid: number;
    high: number;
    onsetScore: number;
    onsetPulse: number;
    vocalsActive: number;
    sources: {
      master: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
      backing: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
      vocals: {
        ampFast: number;
        ampSlow: number;
        low: number;
        mid: number;
        high: number;
        onsetScore: number;
        onsetPulse: number;
        wave?: number[];
        freq?: number[];
      };
    };
  };
  sectionId: string;
  sectionType: string;
  pulse: { beat: number; downbeat: number };
  rhythm: ViewerSignalBus["rhythm"];
}): ViewerSignalBus {
  const sectionEnergy = clamp01(
    Number(input.reactive.low) * 0.34 +
    Number(input.reactive.mid) * 0.4 +
    Number(input.reactive.high) * 0.26
  );
  const pressure = clamp01(
    Number(input.reactive.onsetPulse) * 0.54 +
    Number(input.reactive.ampFast) * 0.26 +
    Number(input.reactive.low) * 0.2
  );
  const coherence = clamp01(
    0.55 +
    Number(input.pulse.downbeat) * 0.22 +
    Number(input.pulse.beat) * 0.12 -
    Number(input.reactive.onsetPulse) * 0.18
  );
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
    rhythm: input.rhythm,
    hints: {
      count: activeHintCount,
      fusionModeLabel: beatFusionModeLabel,
      aiDownbeats: aiDownbeatMarkers.length
    },
      perf: {
        fps: fpsSmoothed > 0 ? fpsSmoothed : 0,
        targetFps: 30,
        densityScale: adaptiveDensityScale
      },
    theme: {
      coherence,
      pressure,
      lyricActivity: clamp01(Number(input.reactive.vocalsActive)),
      sectionEnergy
    },
    audio: {
      amp: input.amp,
      seed
    },
    reactive: {
      ampFast: input.reactive.ampFast,
      ampSlow: input.reactive.ampSlow,
      low: input.reactive.low,
      mid: input.reactive.mid,
      high: input.reactive.high,
      onsetScore: input.reactive.onsetScore,
      onsetPulse: input.reactive.onsetPulse,
      vocalsActive: input.reactive.vocalsActive,
      sources: input.reactive.sources
    }
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function labRosetteDebug() {
  if (labPrimitive !== "curve.rosetteSpiral") return null;
  const profile = currentLabProfile();
  const density = profile.density;
  const scale = profile.scale;
  const petals = Math.max(3, Math.round(3 + density * 2.8));
  const turns = Number((6 + density * 2.6).toFixed(2));
  const mode = density > 2.6 ? "star" : density > 1.7 ? "hybrid" : "rosette";
  const skip = density > 2.8 ? 3 : density > 1.9 ? 2 : 1;
  const symmetrySnap = density > 2.3 ? petals : density > 1.2 ? Math.max(4, petals - 1) : 0;
  const connectMode = density > 3.1 ? "chords" : density > 2.1 ? "skip" : density < 0.95 ? "radial" : "sequential";
  const colorMode = scale < 0.95 ? "black" : "palette";
  return { mode, colorMode, connectMode, skip, symmetrySnap, petals, turns };
}

function graphRosetteDebug(recipe: any) {
  const layers = Array.isArray(recipe?.graph?.layers) ? recipe.graph.layers : [];
  const nodes = layers.flatMap((layer: any) => (Array.isArray(layer?.nodes) ? layer.nodes : []));
  const rosettes = nodes.filter((n: any) => String(n?.type || "").toLowerCase() === "curve.rosettespiral");
  const summarizeParam = (v: any) => {
    if (v === undefined || v === null || v === "") return "-";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return "{expr}";
  };
  const previews = rosettes.slice(0, 2).map((n: any) => {
    const p = n?.params ?? {};
    return `mode=${summarizeParam(p.mode)} color=${summarizeParam(p.color)} connect=${summarizeParam(p.connectMode)} sym=${summarizeParam(p.symmetrySnap)}`;
  });
  return { count: rosettes.length, previews };
}

function recipeHasGraphNodeType(recipe: any, typeId: string) {
  const want = String(typeId || "").toLowerCase();
  if (!want) return false;
  const layers = Array.isArray(recipe?.graph?.layers) ? recipe.graph.layers : [];
  for (const layer of layers) {
    const nodes = Array.isArray(layer?.nodes) ? layer.nodes : [];
    for (const node of nodes) {
      if (String(node?.type ?? "").toLowerCase() === want) return true;
    }
  }
  return false;
}

function cloneRecipe<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => cloneRecipe(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v as Record<string, any>)) out[k] = cloneRecipe(val);
    return out as T;
  }
  return v;
}

function baseGraphLayers() {
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
      blend: "screen",
      opacity: 0.55,
      nodes: [
        { id: "particles", type: "fg.particles", params: { count: 140, sizeRange: [1.6, 4.8], speed: 0.48, curl: 0.55, opacity: 0.62 } }
      ]
    },
    {
      id: "base-orb",
      blend: "screen",
      opacity: 1,
      nodes: [
        { id: "orb", type: "shape.beatOrb", params: { baseRadiusRatio: 0.048, blend: "screen" } }
      ]
    }
  ];
}

function graphTemplateLibrary(baseRecipe: any) {
  const coreFromTrack = (() => {
    const layers = Array.isArray(baseRecipe?.graph?.layers) ? cloneRecipe(baseRecipe.graph.layers) : [];
    const stripBase = (n: any) => {
      const t = String(n?.type ?? "").toLowerCase();
      return t !== "bg.gradientfield" && t !== "fg.particles" && t !== "shape.beatorb";
    };
    const trimmed = layers
      .map((l: any) => ({
        ...l,
        nodes: (Array.isArray(l?.nodes) ? l.nodes : []).filter(stripBase)
      }))
      .filter((l: any) => Array.isArray(l.nodes) && l.nodes.length);
    return trimmed;
  })();

  const templates = [
    ...(coreFromTrack.length ? [{ id: "track-core", name: "Track Core", layers: coreFromTrack }] : []),
    {
      id: "pulse-ribbon-rosette",
      name: "Pulse Ribbon Rosette",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "pulse", type: "shape.circlePulse", params: { ringCount: 8, radiusPx: 88, alpha: 0.18 } },
            { id: "halo", type: "frame.haloArcs", params: { arcCount: 8, ringCount: 2, radiusPx: 178, gapPx: 28, arcSpanMin: 0.24, arcSpanMax: 0.58, lineWidthPx: 1.8, alpha: 0.28, rotateHz: 0.015, pulseGain: 0.16, wobble: 0.05, colorMode: "accent", signalSource: "auto" } },
            { id: "ticks", type: "frame.orbitTicks", params: { count: 15, ringCount: 1, radiusPx: 246, gapPx: 30, tickLenPx: 44, lineWidthPx: 1.5, alpha: 0.22, rotateHz: -0.014, danceHz: 0.08, danceAmpPx: 20, style: "line", patternMode: "alternate", colorMode: "gradient", signalSource: "auto" } },
            { id: "lattice", type: "frame.arcLattice", params: { ringCount: 3, radiusPx: 214, gapPx: 28, segmentsPerRing: 10, spokeDensity: 0.34, arcCoverage: 0.58, lineWidthPx: 1.25, alpha: 0.18, rotateHz: 0.014, motionMode: "driftLock", symmetryMode: "mirror", colorMode: "accent", signalSource: "auto" } },
            { id: "ribbon", type: "polyline.orbitRibbon", params: { points: 60, radiusPx: 170, thicknessPx: 1.7, phaseHz: 0.08 } },
            { id: "rose", type: "curve.rosetteSpiral", params: { mode: "hybrid", steps: 860, turns: 11, growth: 3.2, petalCount: 7, petalAmp: 20, spin: 0.14, skip: 2, alpha: 0.5, lineWidth: 1.1 } }
          ]
        }
      ]
    },
    {
      id: "noise-offset",
      name: "Noise Offset",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "noise", type: "field.signalNoiseBlend", params: { pointCount: 180, lineCount: 24, noiseOpacity: 0.22, lineOpacity: 0.18, driftPx: 18, zipChance: 0.2, zipSpeedPx: 740 } },
            { id: "offset", type: "glitch.persistentOffset", params: { bandCount: 14, maxShiftPx: 9, alpha: 0.18, pulseGain: 0.42 } }
          ]
        }
      ]
    },
    {
      id: "ribbon-echo",
      name: "Ribbon Echo",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "ribbon", type: "polyline.orbitRibbon", params: { points: 84, radiusPx: 182, thicknessPx: 1.5, phaseHz: 0.06 } },
            { id: "word", type: "text.echoWord", params: { fontPx: 30, echoCount: 4, driftPx: 12 } }
          ]
        }
      ]
    },
    {
      id: "classic-wave-bars",
      name: "Classic Wave + Bars",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "wave", type: "viz.waveStrip", params: { stripMode: "auto", signalSource: "auto", heightPx: 72, lineCopies: 4, lineWidth: 1.6, alphaMul: 0.32, centerY: 0.25, mirrored: true, smooth: 0.56, zoom: 1.08 } },
            { id: "bars", type: "viz.spectrumBars", params: { signalSource: "auto", barCount: 34, marginPx: 28, topRel: 0.41, bottomPadPx: 12, gapPx: 5, alpha: 0.42, smooth: 0.1, bandSmoothing: 0.08, spectralTilt: 0.2, edgeTaper: 0.16, responseSpan: 0.75 } }
          ]
        }
      ]
    },
    {
      id: "classic-rings-bars",
      name: "Classic Rings + Bars",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "halo", type: "frame.haloArcs", params: { arcCount: 7, ringCount: 2, radiusPx: 168, gapPx: 24, arcSpanMin: 0.2, arcSpanMax: 0.48, lineWidthPx: 1.6, alpha: 0.24, rotateHz: 0.012, pulseGain: 0.14, wobble: 0.04, colorMode: "palette", signalSource: "auto" } },
            { id: "ticks", type: "frame.orbitTicks", params: { count: 12, ringCount: 1, radiusPx: 244, gapPx: 28, tickLenPx: 40, lineWidthPx: 1.35, alpha: 0.18, rotateHz: 0.01, danceHz: 0.06, danceAmpPx: 16, style: "triangle", patternMode: "triple", colorMode: "dark", signalSource: "auto" } },
            { id: "lattice", type: "frame.arcLattice", params: { ringCount: 3, radiusPx: 220, gapPx: 26, segmentsPerRing: 12, spokeDensity: 0.28, arcCoverage: 0.54, lineWidthPx: 1.15, alpha: 0.16, rotateHz: 0.012, motionMode: "mesh", symmetryMode: "repeat", colorMode: "dark", signalSource: "auto" } },
            { id: "rings", type: "viz.responsiveRings", params: { signalSource: "auto", ringCount: 6, points: 124, baseRadiusPx: 56, gapPx: 28, alpha: 0.44, lineWidth: 1.2, warp: 0.86, rotateHz: 0.03 } },
            { id: "bars", type: "viz.spectrumBars", params: { signalSource: "auto", barCount: 32, marginPx: 26, topRel: 0.41, bottomPadPx: 12, gapPx: 5, alpha: 0.4, smooth: 0.1, bandSmoothing: 0.08, spectralTilt: 0.2, edgeTaper: 0.16, responseSpan: 0.75 } }
          ]
        }
      ]
    },
    {
      id: "pressure-branches",
      name: "Pressure Branches",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "pressure", type: "energy.pressureBloom", params: { bloomCount: 7, baseRadiusPx: 38, maxRadiusPx: 250, alpha: 0.27, ringWidth: 2 } },
            { id: "noise", type: "field.signalNoiseBlend", params: { pointCount: 160, lineCount: 16, noiseOpacity: 0.2, lineOpacity: 0.14, driftPx: 14, zipChance: 0.14, zipSpeedPx: 680 } },
            { id: "offset", type: "glitch.persistentOffset", params: { bandCount: 12, maxShiftPx: 7, alpha: 0.14, pulseGain: 0.36 } }
          ]
        }
      ]
    },
    {
      id: "rosette-focus",
      name: "Rosette Focus",
      layers: [
        {
          id: "main",
          blend: "screen",
          opacity: 1,
          nodes: [
            { id: "pulse", type: "shape.circlePulse", params: { ringCount: 6, radiusPx: 76, alpha: 0.14 } },
            { id: "halo", type: "frame.haloArcs", params: { arcCount: 9, ringCount: 2, radiusPx: 186, gapPx: 30, arcSpanMin: 0.26, arcSpanMax: 0.62, lineWidthPx: 1.9, alpha: 0.3, rotateHz: 0.014, pulseGain: 0.18, wobble: 0.05, colorMode: "accent", signalSource: "auto" } },
            { id: "ticks", type: "frame.orbitTicks", params: { count: 18, ringCount: 1, radiusPx: 270, gapPx: 30, tickLenPx: 46, lineWidthPx: 1.45, alpha: 0.16, rotateHz: -0.012, danceHz: 0.07, danceAmpPx: 18, style: "line", patternMode: "grouped", colorMode: "pattern", signalSource: "auto" } },
            { id: "lattice", type: "frame.arcLattice", params: { ringCount: 4, radiusPx: 236, gapPx: 24, segmentsPerRing: 9, spokeDensity: 0.36, arcCoverage: 0.6, lineWidthPx: 1.2, alpha: 0.18, rotateHz: 0.01, motionMode: "ratchet", symmetryMode: "mirror", colorMode: "gradient", signalSource: "auto" } },
            { id: "rose", type: "curve.rosetteSpiral", params: { mode: "rosette", steps: 980, turns: 13, growth: 2.8, petalCount: 8, petalAmp: 24, spin: 0.11, skip: 1, alpha: 0.62, lineWidth: 1.25 } }
          ]
        }
      ]
    }
  ];
  return templates;
}

function resolveGraphSelection(baseRecipe: any, sectionId: string, options?: { allowManual?: boolean; variantOverride?: number; selectedIndexOverride?: number }) {
  const allowManual = options?.allowManual !== false;
  const templates = graphTemplateLibrary(baseRecipe);
  const safeTemplates = templates.length ? templates : [{ id: "fallback", name: "Fallback", layers: [] }];
  const secId = String(sectionId || "");
  const autoIndex = (hashStringToSeed(`graph:auto:${seed}:${secId}`) >>> 0) % safeTemplates.length;
  let selectedIndex = Number.isFinite(Number(options?.selectedIndexOverride))
    ? Math.max(0, Math.floor(Number(options?.selectedIndexOverride)))
    : autoIndex;
  let isManual = false;
  if (!Number.isFinite(Number(options?.selectedIndexOverride)) && allowManual && graphAutoRefresh && graphManualRecipe) {
    selectedIndex = graphManualRecipe.index;
    isManual = true;
  } else if (!Number.isFinite(Number(options?.selectedIndexOverride)) && allowManual && graphManualRecipe && graphManualRecipe.sectionId === secId) {
    selectedIndex = graphManualRecipe.index;
    isManual = true;
  }
  selectedIndex = ((selectedIndex % safeTemplates.length) + safeTemplates.length) % safeTemplates.length;
  const variant = Number.isFinite(Number(options?.variantOverride))
    ? Math.max(0, Number(options?.variantOverride))
    : currentGraphVariantForSection(secId);
  return {
    templates: safeTemplates,
    selectedIndex,
    autoIndex,
    isManual,
    variant,
    template: safeTemplates[selectedIndex]
  };
}

function graphLayersForSection(baseRecipe: any, sectionId: string, options?: { allowManual?: boolean; variantOverride?: number; selectedIndexOverride?: number }) {
  const sel = resolveGraphSelection(baseRecipe, sectionId, options);
  const secTag = (hashStringToSeed(`graph:sec:${sectionId}`) >>> 0).toString(16).slice(0, 6);
  const vTag = `v${Math.max(0, sel.variant)}`;
  const templ = cloneRecipe(sel.template?.layers ?? []);
  for (const layer of templ) {
    const layerId = String(layer?.id || "layer");
    layer.id = `${layerId}__${secTag}__${vTag}`;
    const nodes = Array.isArray(layer?.nodes) ? layer.nodes : [];
    for (const node of nodes) {
      const nodeId = String(node?.id || "node");
      node.id = `${nodeId}__${secTag}__${vTag}`;
    }
  }
  return {
    layers: [...baseGraphLayers(), ...templ],
    selection: sel
  };
}

const RANDOM_SCENE_COUNT = 1024;

function randomSceneLayersForSection(sectionId: string, options?: { allowManual?: boolean; variantOverride?: number; selectedIndexOverride?: number; backgroundIndexOverride?: number }) {
  const allowManual = options?.allowManual !== false;
  const secId = String(sectionId || "");
  const sectionType = classifySection(secId || "");
  const sceneCount = RANDOM_SCENE_COUNT;
  const autoIndex = (hashStringToSeed(`random-scene:auto:${seed}:${secId}`) >>> 0) % sceneCount;
  let selectedIndex = Number.isFinite(Number(options?.selectedIndexOverride))
    ? Math.max(0, Math.floor(Number(options?.selectedIndexOverride)))
    : autoIndex;
  let isManual = false;
  if (!Number.isFinite(Number(options?.selectedIndexOverride)) && allowManual && graphAutoRefresh && graphManualRecipe) {
    selectedIndex = graphManualRecipe.index;
    isManual = true;
  } else if (!Number.isFinite(Number(options?.selectedIndexOverride)) && allowManual && graphManualRecipe && graphManualRecipe.sectionId === secId) {
    selectedIndex = graphManualRecipe.index;
    isManual = true;
  }
  selectedIndex = ((selectedIndex % sceneCount) + sceneCount) % sceneCount;
  let backgroundIndex = Number.isFinite(Number(options?.backgroundIndexOverride))
    ? Math.max(0, Math.floor(Number(options?.backgroundIndexOverride)))
    : selectedIndex;
  backgroundIndex = ((backgroundIndex % sceneCount) + sceneCount) % sceneCount;
  const variant = Number.isFinite(Number(options?.variantOverride))
    ? Math.max(0, Number(options?.variantOverride))
    : currentGraphVariantForSection(secId);
  const bgLayoutRng = mulberry32(hashStringToSeed(`random-scene:bg-layout:${seed}:${secId}:${backgroundIndex}`) >>> 0);
  const bgParamRng = mulberry32(hashStringToSeed(`random-scene:bg-param:${seed}:${secId}:${backgroundIndex}`) >>> 0);
  const layoutRng = mulberry32(hashStringToSeed(`random-scene:layout:${seed}:${secId}:${selectedIndex}`) >>> 0);
  const paramRng = mulberry32(hashStringToSeed(`random-scene:param:${seed}:${secId}:${selectedIndex}:v${variant}`) >>> 0);
  const pickWeighted = (items: Array<{ value: string; w: number }>) => {
    const total = items.reduce((s, it) => s + Math.max(0, it.w), 0);
    if (total <= 0) return items[0]?.value ?? "auto";
    let u = paramRng() * total;
    for (const it of items) {
      u -= Math.max(0, it.w);
      if (u <= 0) return it.value;
    }
    return items[items.length - 1]?.value ?? "auto";
  };
  const ribbonProfile = (() => {
    if (sectionType === "intro") return pickWeighted([{ value: "breathe", w: 5 }, { value: "precess", w: 3 }, { value: "elastic", w: 1 }, { value: "wobble", w: 1 }]);
    if (sectionType === "verse") return pickWeighted([{ value: "precess", w: 4 }, { value: "breathe", w: 3 }, { value: "elastic", w: 2 }, { value: "wobble", w: 1 }]);
    if (sectionType === "chorus") return pickWeighted([{ value: "elastic", w: 4 }, { value: "wobble", w: 3 }, { value: "precess", w: 2 }, { value: "breathe", w: 1 }]);
    if (sectionType === "bridge") return pickWeighted([{ value: "wobble", w: 4 }, { value: "precess", w: 3 }, { value: "elastic", w: 2 }, { value: "breathe", w: 1 }]);
    if (sectionType === "outro") return pickWeighted([{ value: "breathe", w: 4 }, { value: "precess", w: 3 }, { value: "elastic", w: 2 }, { value: "wobble", w: 1 }]);
    return pickWeighted([{ value: "precess", w: 3 }, { value: "elastic", w: 3 }, { value: "wobble", w: 2 }, { value: "breathe", w: 2 }]);
  })();
  const rosetteProfile = (() => {
    if (sectionType === "intro") return pickWeighted([{ value: "glass", w: 5 }, { value: "petal-breathe", w: 3 }, { value: "gear", w: 1 }, { value: "spiral-surge", w: 1 }]);
    if (sectionType === "verse") return pickWeighted([{ value: "petal-breathe", w: 4 }, { value: "glass", w: 3 }, { value: "gear", w: 2 }, { value: "spiral-surge", w: 1 }]);
    if (sectionType === "chorus") return pickWeighted([{ value: "spiral-surge", w: 4 }, { value: "gear", w: 3 }, { value: "petal-breathe", w: 2 }, { value: "glass", w: 1 }]);
    if (sectionType === "bridge") return pickWeighted([{ value: "gear", w: 4 }, { value: "spiral-surge", w: 3 }, { value: "petal-breathe", w: 2 }, { value: "glass", w: 1 }]);
    if (sectionType === "outro") return pickWeighted([{ value: "glass", w: 4 }, { value: "petal-breathe", w: 3 }, { value: "gear", w: 2 }, { value: "spiral-surge", w: 1 }]);
    return pickWeighted([{ value: "petal-breathe", w: 3 }, { value: "gear", w: 3 }, { value: "spiral-surge", w: 2 }, { value: "glass", w: 2 }]);
  })();
  const ribbonAnim = pickWeighted([{ value: "flow", w: 3 }, { value: "pulse-rotate", w: 3 }, { value: "drift", w: 2 }]);
  const rosetteAnim = pickWeighted([{ value: "step-rotate", w: 3 }, { value: "counterspin", w: 3 }, { value: "twist", w: 2 }]);
  const ribbonSignalSource = pickWeighted([
    { value: "auto", w: 5 },
    { value: "backing", w: 3 },
    { value: "master", w: 2 },
    { value: "vocals", w: sectionType === "chorus" || sectionType === "bridge" ? 2 : 1 }
  ]);
  const rosetteSignalSource = pickWeighted([
    { value: "backing", w: 4 },
    { value: "auto", w: 4 },
    { value: "master", w: 2 },
    { value: "vocals", w: sectionType === "chorus" ? 2 : 1 }
  ]);
  const particleSignalSource = pickWeighted([
    { value: "split", w: 5 },
    { value: "backing", w: 3 },
    { value: "auto", w: 3 },
    { value: "master", w: 2 },
    { value: "vocals", w: sectionType === "chorus" || sectionType === "bridge" ? 2 : 1 }
  ]);
  const wordSignalSource = pickWeighted([
    { value: "auto", w: 5 },
    { value: "vocals", w: 4 },
    { value: "master", w: 1 },
    { value: "backing", w: 1 }
  ]);

  const bgPick = Math.floor(bgLayoutRng() * 5);
  const bgLayer = (() => {
    if (bgPick === 0) {
      return {
        id: "bg-black",
        blend: "source-over",
        opacity: 1,
        nodes: [{ id: "bg-black", type: "bg.solid", params: { color: "#000000", toneHint: "dark" } }]
      };
    }
    if (bgPick === 1) {
      return {
        id: "bg-gradient",
        blend: "source-over",
        opacity: 1,
        nodes: [{ id: "bg-gradient", type: "bg.gradientField", params: { gradientStops: 3 + Math.floor(bgParamRng() * 3), driftSpeed: 0.008 + bgParamRng() * 0.016, noiseScale: 0.3 + bgParamRng() * 0.45, soften: 0.9 + bgParamRng() * 0.08, toneHint: "light", toneLight: 0.7 } }]
      };
    }
    if (bgPick === 2) {
      return {
        id: "bg-vignette",
        blend: "source-over",
        opacity: 1,
        nodes: [{ id: "bg-vignette", type: "bg.vignette", params: { inner: 0.14 + bgParamRng() * 0.08, outer: 0.7 + bgParamRng() * 0.2, tintA: "#102338", tintB: "#000000", toneHint: "dark" } }]
      };
    }
    if (bgPick === 3) {
      return {
        id: "bg-radial",
        blend: "source-over",
        opacity: 1,
        nodes: [{ id: "bg-radial", type: "bg.radialGradientDrift", params: { drift: 0.08 + bgParamRng() * 0.12, toneHint: "light", toneLight: 0.64 } }]
      };
    }
    return {
      id: "bg-bands",
      blend: "source-over",
      opacity: 1,
      nodes: [{ id: "bg-bands", type: "bg.bands", params: { count: 8 + Math.floor(bgParamRng() * 10), opacity: 0.07 + bgParamRng() * 0.12, toneHint: "mid" } }]
    };
  })();
  const bgLayer2 = (() => {
    if (bgLayoutRng() >= 0.32) return null;
    const pick = Math.floor(bgLayoutRng() * 2);
    if (pick === 0) {
      return {
        id: "bg2-gradient",
        blend: "screen",
        opacity: 0.38 + bgParamRng() * 0.28,
        nodes: [{ id: "bg2-gradient", type: "bg.gradientField", params: { gradientStops: 3 + Math.floor(bgParamRng() * 2), driftSpeed: 0.006 + bgParamRng() * 0.01, noiseScale: 0.3 + bgParamRng() * 0.35, soften: 0.92 + bgParamRng() * 0.06, toneHint: "light", toneLight: 0.68 } }]
      };
    }
    return {
      id: "bg2-bands",
      blend: "screen",
      opacity: 0.3 + bgParamRng() * 0.3,
      nodes: [{ id: "bg2-bands", type: "bg.bands", params: { count: 8 + Math.floor(bgParamRng() * 8), opacity: 0.05 + bgParamRng() * 0.1, toneHint: "mid" } }]
    };
  })();
  const backdropTone = graphBackdropToneFromLayer(bgLayer);
  const styleRng = mulberry32(hashStringToSeed(`random-scene:style:${seed}:${secId}:${selectedIndex}:v${variant}:bg${backgroundIndex}`) >>> 0);

  const buildNode = (id: string, type: string, params: Record<string, any>) => ({ id, type, params });
  const texturePool = [
    buildNode("particles", "fg.particles", { count: 90 + Math.floor(paramRng() * 130), sizeRange: [1.2 + paramRng() * 1.1, 2.6 + paramRng() * 2.4], speed: 0.25 + paramRng() * 0.55, curl: 0.35 + paramRng() * 0.85, opacity: 0.34 + paramRng() * 0.24, signalSource: particleSignalSource, splitVocalsRatio: 0.2 + paramRng() * 0.45 }),
    buildNode("signal-noise", "field.signalNoiseBlend", { pointCount: 120 + Math.floor(paramRng() * 160), lineCount: 10 + Math.floor(paramRng() * 24), noiseOpacity: 0.08 + paramRng() * 0.16, lineOpacity: 0.08 + paramRng() * 0.12, driftPx: 8 + Math.floor(paramRng() * 20), zipChance: 0.08 + paramRng() * 0.2, zipSpeedPx: 520 + Math.floor(paramRng() * 760) }),
    buildNode("persistent-offset", "glitch.persistentOffset", { bandCount: 8 + Math.floor(paramRng() * 16), maxShiftPx: 3 + Math.floor(paramRng() * 10), alpha: 0.06 + paramRng() * 0.14, pulseGain: 0.2 + paramRng() * 0.4 }),
    buildNode("constellation", "fg.constellationLinks", { count: 16 + Math.floor(paramRng() * 30), linkDistPx: 72 + Math.floor(paramRng() * 120), dotRadiusPx: 0.8 + paramRng() * 1.8, lineWidthPx: 0.5 + paramRng() * 1.1 })
  ];
  const heroPool = [
    applySharedGraphColorStyle(buildNode("wave-strip", "viz.waveStrip", { stripMode: ["auto", "single", "dual"][Math.floor(paramRng() * 3)], signalSource: "auto", heightPx: 46 + Math.floor(paramRng() * 58), lineCopies: 2 + Math.floor(paramRng() * 4), lineWidth: 0.9 + paramRng() * 1.4, alphaMul: 0.25 + paramRng() * 0.24, centerY: 0.21 + paramRng() * 0.08, dualGapPx: 20 + Math.floor(paramRng() * 38), mirrored: true, smooth: 0.3 + paramRng() * 0.45, zoom: 0.8 + paramRng() * 0.85 }), backdropTone, styleRng, "hero"),
    applySharedGraphColorStyle(buildNode("spectrum-bars", "viz.spectrumBars", { signalSource: "auto", barCount: 16 + Math.floor(paramRng() * 30), marginPx: 14 + Math.floor(paramRng() * 26), topRel: 0.3 + paramRng() * 0.24, bottomPadPx: 8 + Math.floor(paramRng() * 18), gapPx: 2 + Math.floor(paramRng() * 4), alpha: 0.3 + paramRng() * 0.18, smooth: 0.04 + paramRng() * 0.18, bandSmoothing: 0.03 + paramRng() * 0.14, spectralTilt: 0.08 + paramRng() * 0.24, edgeTaper: 0.08 + paramRng() * 0.16, responseSpan: 0.75 }), backdropTone, styleRng, "hero"),
    applySharedGraphColorStyle(buildNode("responsive-rings", "viz.responsiveRings", { signalSource: "auto", ringCount: 4 + Math.floor(paramRng() * 7), points: 84 + Math.floor(paramRng() * 90), baseRadiusPx: 32 + Math.floor(paramRng() * 56), gapPx: 14 + Math.floor(paramRng() * 24), alpha: 0.26 + paramRng() * 0.22, lineWidth: 0.75 + paramRng() * 1.15, warp: 0.45 + paramRng() * 1.2, rotateHz: (paramRng() < 0.5 ? -1 : 1) * (0.01 + paramRng() * 0.08) }), backdropTone, styleRng, "hero"),
    buildNode("pressure-bloom", "energy.pressureBloom", { bloomCount: 5 + Math.floor(paramRng() * 7), baseRadiusPx: 22 + Math.floor(paramRng() * 36), maxRadiusPx: 100 + Math.floor(paramRng() * 180), alpha: 0.17 + paramRng() * 0.24, ringWidth: 1.4 + paramRng() * 2.4 }),
    applySharedGraphColorStyle(buildNode("pulse", "shape.circlePulse", { ringCount: 5 + Math.floor(paramRng() * 8), radiusPx: 70 + Math.floor(paramRng() * 70), alpha: 0.14 + paramRng() * 0.18 }), backdropTone, styleRng, "hero"),
    applySharedGraphColorStyle(buildNode("ribbon", "polyline.orbitRibbon", { points: 44 + Math.floor(paramRng() * 80), radiusPx: 130 + Math.floor(paramRng() * 90), thicknessPx: 1 + paramRng() * 2.3, phaseHz: 0.04 + paramRng() * 0.1, animationMode: ribbonAnim, motionProfile: ribbonProfile, signalSource: ribbonSignalSource }), backdropTone, styleRng, "hero"),
    applySharedGraphColorStyle(buildNode("rosette", "curve.rosetteSpiral", { mode: ["rosette", "hybrid", "star"][Math.floor(paramRng() * 3)], steps: 520 + Math.floor(paramRng() * 900), turns: 7 + paramRng() * 10, growth: 2 + paramRng() * 2.2, petalCount: 4 + Math.floor(paramRng() * 6), petalAmp: 12 + Math.floor(paramRng() * 20), spin: 0.08 + paramRng() * 0.12, skip: 1 + Math.floor(paramRng() * 3), alpha: 0.4 + paramRng() * 0.32, lineWidth: 0.7 + paramRng() * 1.2, animationMode: rosetteAnim, motionProfile: rosetteProfile, signalSource: rosetteSignalSource }), backdropTone, styleRng, "hero")
  ];
  const wrapperPool = [
    applySharedGraphColorStyle(buildNode("wrap-rings", "viz.responsiveRings", { signalSource: "auto", ringCount: 3 + Math.floor(paramRng() * 4), points: 92 + Math.floor(paramRng() * 60), baseRadiusPx: 86 + Math.floor(paramRng() * 70), gapPx: 18 + Math.floor(paramRng() * 26), alpha: 0.18 + paramRng() * 0.14, lineWidth: 0.7 + paramRng() * 0.8, warp: 0.3 + paramRng() * 0.8, rotateHz: (paramRng() < 0.5 ? -1 : 1) * (0.008 + paramRng() * 0.04) }), backdropTone, styleRng, "wrapper"),
    applySharedGraphColorStyle(buildNode("wrap-halo", "frame.haloArcs", { arcCount: 5 + Math.floor(paramRng() * 6), ringCount: 1 + Math.floor(paramRng() * 2), radiusPx: 156 + Math.floor(paramRng() * 120), gapPx: 22 + Math.floor(paramRng() * 22), arcSpanMin: 0.2 + paramRng() * 0.12, arcSpanMax: 0.44 + paramRng() * 0.24, lineWidthPx: 1.4 + paramRng() * 1.3, alpha: 0.22 + paramRng() * 0.14, rotateHz: (paramRng() < 0.5 ? -1 : 1) * (0.008 + paramRng() * 0.028), pulseGain: 0.12 + paramRng() * 0.12, wobble: 0.03 + paramRng() * 0.05, signalSource: "auto" }), backdropTone, styleRng, "wrapper"),
    applySharedGraphColorStyle(buildNode("wrap-ticks", "frame.orbitTicks", { count: 7 + Math.floor(paramRng() * 17), ringCount: 1 + Math.floor(paramRng() * 2), radiusPx: 190 + Math.floor(paramRng() * 150), gapPx: 28 + Math.floor(paramRng() * 24), tickLenPx: 34 + Math.floor(paramRng() * 26), lineWidthPx: 1.45 + paramRng() * 2.1, alpha: 0.32 + paramRng() * 0.18, rotateHz: (paramRng() < 0.5 ? -1 : 1) * (0.008 + paramRng() * 0.038), danceHz: 0.05 + paramRng() * 0.08, danceAmpPx: 16 + Math.floor(paramRng() * 18), style: paramRng() < 0.34 ? "triangle" : "line", patternMode: ["grouped", "alternate", "triple", "unison"][Math.floor(paramRng() * 4)], signalSource: "auto" }), backdropTone, styleRng, "wrapper"),
    applySharedGraphColorStyle(buildNode("wrap-lattice", "frame.arcLattice", { ringCount: 2 + Math.floor(paramRng() * 2), radiusPx: 176 + Math.floor(paramRng() * 120), gapPx: 28 + Math.floor(paramRng() * 20), segmentsPerRing: 8 + Math.floor(paramRng() * 8), spokeDensity: 0.22 + paramRng() * 0.34, arcCoverage: 0.42 + paramRng() * 0.28, lineWidthPx: 1.2 + paramRng() * 1.3, alpha: 0.2 + paramRng() * 0.14, rotateHz: 0.008 + paramRng() * 0.02, spokeWidthMul: 0.92 + paramRng() * 0.26, spokeAlphaMul: 1.06 + paramRng() * 0.3, ratchetSnap: 0.72 + paramRng() * 0.22, endpointBridgeBias: 0.68 + paramRng() * 0.24, lockFlashGain: 0.24 + paramRng() * 0.18, motionMode: ["mesh", "ratchet", "driftLock"][Math.floor(paramRng() * 3)], symmetryMode: ["mirror", "repeat", "offset"][Math.floor(paramRng() * 3)], signalSource: "auto" }), backdropTone, styleRng, "wrapper"),
    applySharedGraphColorStyle(buildNode("wrap-ribbon", "polyline.orbitRibbon", { points: 56 + Math.floor(paramRng() * 42), radiusPx: 180 + Math.floor(paramRng() * 90), thicknessPx: 0.8 + paramRng() * 1.2, phaseHz: 0.03 + paramRng() * 0.05, animationMode: ribbonAnim, motionProfile: ribbonProfile, signalSource: ribbonSignalSource }), backdropTone, styleRng, "wrapper"),
    buildNode("wrap-constellation", "fg.constellationLinks", { count: 20 + Math.floor(paramRng() * 24), linkDistPx: 90 + Math.floor(paramRng() * 140), dotRadiusPx: 0.8 + paramRng() * 1.2, lineWidthPx: 0.45 + paramRng() * 0.9 }),
    buildNode("wrap-shock", "fg.shockRings", { ringCount: 3 + Math.floor(paramRng() * 6), speedHz: 0.18 + paramRng() * 0.24, spreadPx: 180 + Math.floor(paramRng() * 360), thicknessPx: 0.8 + paramRng() * 1.4 }),
    applySharedGraphColorStyle(buildNode("wrap-pulse", "shape.circlePulse", { ringCount: 4 + Math.floor(paramRng() * 5), radiusPx: 110 + Math.floor(paramRng() * 90), alpha: 0.1 + paramRng() * 0.1 }), backdropTone, styleRng, "wrapper")
  ];
  const accentPool = [
    buildNode("accent-offset", "glitch.persistentOffset", { bandCount: 8 + Math.floor(paramRng() * 12), maxShiftPx: 3 + Math.floor(paramRng() * 7), alpha: 0.06 + paramRng() * 0.08, pulseGain: 0.18 + paramRng() * 0.28 }),
    buildNode("accent-shock", "fg.shockRings", { ringCount: 4 + Math.floor(paramRng() * 5), speedHz: 0.22 + paramRng() * 0.28, spreadPx: 170 + Math.floor(paramRng() * 280), thicknessPx: 0.9 + paramRng() * 1.2 }),
    buildNode("accent-pressure", "energy.pressureBloom", { bloomCount: 4 + Math.floor(paramRng() * 5), baseRadiusPx: 28 + Math.floor(paramRng() * 26), maxRadiusPx: 120 + Math.floor(paramRng() * 120), alpha: 0.12 + paramRng() * 0.14, ringWidth: 1.2 + paramRng() * 1.8 })
  ];
  const pickNode = (pool: any[], items: Array<{ value: string; w: number }>) => {
    const pickedId = pickWeighted(items);
    const hit = pool.find((node: any) => String(node.id) === pickedId);
    return cloneRecipe(hit ?? pool[0]);
  };
  const heroChoice = (() => {
    if (sectionType === "intro") return pickNode(heroPool, [
      { value: "rosette", w: 3 }, { value: "ribbon", w: 3 }, { value: "responsive-rings", w: 2 }, { value: "wave-strip", w: 1 }, { value: "pulse", w: 1 }
    ]);
    if (sectionType === "verse") return pickNode(heroPool, [
      { value: "ribbon", w: 3 }, { value: "rosette", w: 3 }, { value: "wave-strip", w: 2 }, { value: "responsive-rings", w: 2 }, { value: "pulse", w: 1 }, { value: "spectrum-bars", w: 1 }
    ]);
    if (sectionType === "chorus") return pickNode(heroPool, [
      { value: "responsive-rings", w: 3 }, { value: "pressure-bloom", w: 3 }, { value: "spectrum-bars", w: 2 }, { value: "wave-strip", w: 2 }, { value: "rosette", w: 2 }, { value: "ribbon", w: 1 }
    ]);
    if (sectionType === "bridge") return pickNode(heroPool, [
      { value: "rosette", w: 4 }, { value: "pressure-bloom", w: 2 }, { value: "ribbon", w: 2 }, { value: "responsive-rings", w: 1 }, { value: "wave-strip", w: 1 }
    ]);
    if (sectionType === "outro") return pickNode(heroPool, [
      { value: "rosette", w: 3 }, { value: "pulse", w: 3 }, { value: "wave-strip", w: 2 }, { value: "responsive-rings", w: 2 }
    ]);
    return pickNode(heroPool, [
      { value: "ribbon", w: 3 }, { value: "rosette", w: 3 }, { value: "responsive-rings", w: 2 }, { value: "wave-strip", w: 2 }, { value: "pressure-bloom", w: 2 }, { value: "spectrum-bars", w: 1 }
    ]);
  })();
  const heroType = String(heroChoice?.type ?? "").toLowerCase();
  const wrapperWeights = (() => {
    if (heroType === "curve.rosettespiral") return [
      { value: "wrap-lattice", w: 5 }, { value: "wrap-ticks", w: 5 }, { value: "wrap-halo", w: 3 }, { value: "wrap-rings", w: 2 }, { value: "wrap-ribbon", w: 2 }, { value: "wrap-constellation", w: 2 }, { value: "wrap-pulse", w: 1 }, { value: "wrap-shock", w: 1 }
    ];
    if (heroType === "polyline.orbitribbon") return [
      { value: "wrap-lattice", w: 4 }, { value: "wrap-ticks", w: 4 }, { value: "wrap-halo", w: 2 }, { value: "wrap-rings", w: 2 }, { value: "wrap-constellation", w: 3 }, { value: "wrap-pulse", w: 2 }, { value: "wrap-shock", w: 1 }
    ];
    if (heroType === "viz.responsiverings") return [
      { value: "wrap-lattice", w: 5 }, { value: "wrap-ticks", w: 5 }, { value: "wrap-halo", w: 2 }, { value: "wrap-ribbon", w: 3 }, { value: "wrap-constellation", w: 2 }, { value: "wrap-shock", w: 2 }, { value: "wrap-pulse", w: 1 }
    ];
    if (heroType === "viz.spectrumbars" || heroType === "viz.wavestrip") return [
      { value: "wrap-lattice", w: 3 }, { value: "wrap-ticks", w: 6 }, { value: "wrap-halo", w: 2 }, { value: "wrap-rings", w: 2 }, { value: "wrap-pulse", w: 2 }, { value: "wrap-constellation", w: 2 }, { value: "wrap-shock", w: 1 }
    ];
    return [
      { value: "wrap-lattice", w: 4 }, { value: "wrap-ticks", w: 4 }, { value: "wrap-halo", w: 2 }, { value: "wrap-rings", w: 2 }, { value: "wrap-ribbon", w: 2 }, { value: "wrap-constellation", w: 2 }, { value: "wrap-pulse", w: 2 }, { value: "wrap-shock", w: 1 }
    ];
  })();
  const wrapperNode = layoutRng() < (sectionType === "chorus" ? 0.92 : 0.78)
    ? pickNode(wrapperPool.filter((node: any) => String(node.type).toLowerCase() !== heroType), wrapperWeights)
    : null;
  const textureCount = sectionType === "chorus" ? 2 : (layoutRng() < 0.6 ? 1 : 0);
  const textureNodes: any[] = [];
  const textureUsed = new Set<string>();
  while (textureNodes.length < textureCount && textureUsed.size < texturePool.length) {
    const candidate = cloneRecipe(texturePool[Math.floor(layoutRng() * texturePool.length)]);
    if (textureUsed.has(String(candidate.id))) continue;
    textureUsed.add(String(candidate.id));
    textureNodes.push(candidate);
  }
  const accentNode = layoutRng() < (sectionType === "bridge" ? 0.72 : 0.48)
    ? cloneRecipe(accentPool[Math.floor(layoutRng() * accentPool.length)])
    : null;
  const focalNodes = [heroChoice, ...(wrapperNode ? [wrapperNode] : [])];
  const atmosphereNodes = [...textureNodes, ...(accentNode ? [accentNode] : [])];
  const fgNodes: any[] = [...atmosphereNodes, ...focalNodes];
  if (!fgNodes.length) fgNodes.push(cloneRecipe(heroPool[0]));
  for (const node of fgNodes) {
    const t = String(node?.type || "").toLowerCase();
    node.params = typeof node.params === "object" && node.params ? node.params : {};
    if (t === "field.signalnoiseblend") {
      if (sectionType === "chorus") {
        node.params.lineCount = Math.max(12, Math.round(Number(node.params.lineCount ?? 16) * 0.85));
        node.params.noiseOpacity = Math.max(0.08, Number(node.params.noiseOpacity ?? 0.18) * 0.8);
      } else if (sectionType === "bridge") {
        node.params.lineCount = Math.max(10, Math.round(Number(node.params.lineCount ?? 16) * 0.7));
        node.params.noiseOpacity = Math.min(0.45, Number(node.params.noiseOpacity ?? 0.18) * 1.25);
      }
    } else if (t === "glitch.persistentoffset") {
      if (sectionType === "chorus") {
        node.params.alpha = Math.max(0.06, Number(node.params.alpha ?? 0.14) * 0.82);
      } else if (sectionType === "bridge") {
        node.params.alpha = Math.min(0.36, Number(node.params.alpha ?? 0.14) * 1.35);
        node.params.maxShiftPx = Math.min(16, Number(node.params.maxShiftPx ?? 8) * 1.2);
      }
    } else if (t === "graph.branchgrowth") {
      if (sectionType === "chorus") node.params.depth = Math.max(3, Math.round(Number(node.params.depth ?? 4) + 1));
      else if (sectionType === "outro") node.params.depth = Math.max(3, Math.round(Number(node.params.depth ?? 4) - 1));
    } else if (t === "energy.pressurebloom") {
      if (sectionType === "chorus") {
        node.params.alpha = Math.min(0.42, Number(node.params.alpha ?? 0.16) * 1.2);
        node.params.bloomCount = Math.max(4, Math.round(Number(node.params.bloomCount ?? 5) + 1));
      } else if (sectionType === "verse") {
        node.params.alpha = Math.max(0.08, Number(node.params.alpha ?? 0.16) * 0.9);
      }
    } else if (t === "viz.responsiverings") {
      if (heroType !== t) {
        node.params.alpha = Math.max(0.12, Number(node.params.alpha ?? 0.24) * 0.78);
        node.params.lineWidth = Math.max(0.6, Number(node.params.lineWidth ?? 1) * 0.9);
      }
    } else if (t === "polyline.orbitribbon") {
      if (heroType !== t) {
        node.params.thicknessPx = Math.max(0.7, Number(node.params.thicknessPx ?? 1.2) * 0.82);
        node.params.radiusPx = Math.round(Number(node.params.radiusPx ?? 150) * 1.08);
        node.params.alpha = 0.26 + paramRng() * 0.18;
      }
    } else if (t === "fg.constellationlinks") {
      node.params.alpha = sectionType === "bridge" ? 0.34 : 0.24;
    } else if (t === "fg.shockrings") {
      node.params.alpha = sectionType === "chorus" ? 0.28 : 0.18;
    } else if (t === "frame.haloarcs") {
      if (heroType !== t) {
        node.params.alpha = Math.max(0.12, Number(node.params.alpha ?? 0.22) * 0.9);
        node.params.lineWidthPx = Math.max(0.8, Number(node.params.lineWidthPx ?? 1.2) * 0.92);
      }
    } else if (t === "frame.orbitticks") {
      if (heroType !== t) {
        node.params.alpha = Math.max(0.1, Number(node.params.alpha ?? 0.2) * 0.92);
        node.params.lineWidthPx = Math.max(0.8, Number(node.params.lineWidthPx ?? 1.3) * 0.96);
        node.params.radiusPx = Math.round(Number(node.params.radiusPx ?? 220) * 1.04);
      }
    } else if (t === "frame.arclattice") {
      if (heroType !== t) {
        node.params.alpha = Math.max(0.12, Number(node.params.alpha ?? 0.22) * 0.96);
        node.params.lineWidthPx = Math.max(0.9, Number(node.params.lineWidthPx ?? 1.3) * 0.98);
        node.params.radiusPx = Math.round(Number(node.params.radiusPx ?? 220) * 1.03);
      }
    }
  }
  const lyricRoll = layoutRng();
  const lyricNode =
    lyricRoll < 0.28
      ? { id: "echo", type: "text.echoWord", params: { fontPx: 26 + Math.floor(paramRng() * 14), echoCount: 3 + Math.floor(paramRng() * 3), driftPx: 8 + Math.floor(paramRng() * 10) } }
      : lyricRoll < 0.56
        ? { id: "word-trails", type: "text.wordTrails", params: { fontPx: 40 + Math.floor(paramRng() * 26), trailCount: 3 + Math.floor(paramRng() * 5), driftPx: 10 + Math.floor(paramRng() * 18), signalSource: wordSignalSource } }
        : lyricRoll < 0.8
        ? { id: "karaoke", type: "text.karaoke", params: { mode: "center", fontSizePx: 28 + Math.floor(paramRng() * 8), lineGapPx: 10, opacity: 0.9 } }
        : null;
  const includeOrb = layoutRng() < 0.5;

  const secTag = (hashStringToSeed(`random:sec:${secId}`) >>> 0).toString(16).slice(0, 6);
  const vTag = `v${Math.max(0, variant)}`;
  const fgLayer = {
    id: `random-main__${secTag}__${vTag}`,
    blend: "screen",
    opacity: 1,
    nodes: fgNodes.map((n: any) => ({ ...n, id: `${String(n.id || "node")}__${secTag}__${vTag}` }))
  };
  const lyricLayer = lyricNode
    ? {
        id: `random-lyric__${secTag}__${vTag}`,
        blend: "source-over",
        opacity: 1,
        nodes: [{ ...lyricNode, id: `${String((lyricNode as any).id || "lyric")}__${secTag}__${vTag}` }]
      }
    : null;
  return {
    layers: [
      bgLayer,
      ...(bgLayer2 ? [bgLayer2] : []),
      ...(includeOrb ? baseGraphLayers().filter((l: any) => String(l.id) === "base-orb") : []),
      fgLayer,
      ...(lyricLayer ? [lyricLayer] : [])
    ],
    selection: {
      template: { id: `random-${selectedIndex}`, name: "Random Scene" },
      templates: Array.from({ length: sceneCount }, (_, i) => ({ id: `random-${i}` })),
      selectedIndex,
      backgroundIndex,
      autoIndex,
      isManual,
      variant
    }
  };
}

function cycleGraphRecipeForSection(baseRecipe: any, sectionId: string, dir: 1 | -1 = 1) {
  const sel = resolveGraphSelection(baseRecipe, sectionId);
  const total = Math.max(1, sel.templates.length);
  const next = (sel.selectedIndex + dir + total) % total;
  graphManualRecipe = { sectionId: String(sectionId || ""), index: next };
  invalidateModeRecipeMemo();
}

function cycleRandomSceneForSection(sectionId: string, dir: 1 | -1 = 1) {
  const secId = String(sectionId || "");
  const sel = randomSceneLayersForSection(secId).selection;
  const total = Math.max(1, Number(sel?.templates?.length ?? 1));
  const next = (Number(sel?.selectedIndex ?? 0) + dir + total) % total;
  graphManualRecipe = { sectionId: secId, index: next };
  invalidateModeRecipeMemo();
}

function resolvePlayerSceneChoice(
  sectionId: string,
  sectionType: string,
  variantOverride:
    | number
    | { variantIndex?: number; sectionBarIndex?: number; beatInBar?: number } = 0
) {
  const sid = String(sectionId || "");
  const st = String(sectionType || "");
  const state = typeof variantOverride === "object" && variantOverride
    ? variantOverride
    : { variantIndex: Number(variantOverride) || 0, sectionBarIndex: Math.max(0, (Number(variantOverride) || 0) - 1), beatInBar: 1 };
  const variantIndex = Math.max(0, Math.floor(Number(state.variantIndex) || 0));
  const sectionBarIndex = Math.max(0, Math.floor(Number(state.sectionBarIndex) || 0));
  const beatInBar = Math.max(1, Math.min(4, Math.floor(Number(state.beatInBar) || 1)));
  const h = hashStringToSeed(`player:${seed}:${sid}:${st}`) >>> 0;
  const curatedBias = st === "chorus" || st === "bridge" || st === "outro" ? 0.72 : 0.42;
  const roll = (h % 1000) / 1000;
  const source: "recipe-view" | "random-scene" = roll < curatedBias ? "recipe-view" : "random-scene";
  const beat3Chance = st === "chorus" ? 0.68 : st === "bridge" ? 0.48 : st === "verse" ? 0.3 : 0.22;
  const cycleChance = st === "chorus" ? 0.56 : st === "bridge" ? 0.34 : st === "verse" ? 0.18 : 0.24;
  const beat3Accent = beatInBar === 3 && ((((hashStringToSeed(`player:beat3:${seed}:${sid}:${st}`) >>> 0) % 1000) / 1000) < beat3Chance);
  const cycleEvery2Bars = source === "random-scene" && ((((hashStringToSeed(`player:cycle:${seed}:${sid}:${st}`) >>> 0) % 1000) / 1000) < cycleChance);
  const variant = variantIndex + (beat3Accent ? 1 : 0);
  const baseSceneIndex = hashStringToSeed(`player:scene:${seed}:${sid}:${st}`) >>> 0;
  const sceneIndex = source === "random-scene" && cycleEvery2Bars
    ? (baseSceneIndex + Math.floor(sectionBarIndex / 2)) >>> 0
    : baseSceneIndex;
  const backgroundIndex = hashStringToSeed(`player:bg:${seed}:${sid}:${st}`) >>> 0;
  return { source, variant, sceneIndex, backgroundIndex, cycleEvery2Bars, beat3Accent };
}

function selectTransitionLabel(recipe: any, fromSectionId: string, toSectionId: string) {
  const t = resolveTransitionDefForSections(recipe, fromSectionId, toSectionId) ?? { kind: "crossfade", durationMs: 900 };
  return `${String(t.kind ?? "crossfade")} (${Math.max(1, Number(t.durationMs ?? 900))}ms)`;
}

function resolveTransitionDefForSections(recipe: any, fromSectionId: string, toSectionId: string) {
  const transitions = recipe?.transitions ?? {};
  const fromNorm = normalizeSectionLabel(String(fromSectionId || ""));
  const toNorm = normalizeSectionLabel(String(toSectionId || ""));
  const by = Array.isArray(transitions?.bySectionChange) ? transitions.bySectionChange : [];
  for (const rule of by) {
    const fromAny = Array.isArray(rule?.fromAny) ? rule.fromAny.map((s: string) => normalizeSectionLabel(String(s))) : null;
    const toAny = Array.isArray(rule?.toAny) ? rule.toAny.map((s: string) => normalizeSectionLabel(String(s))) : null;
    const fromOk = !fromAny || fromAny.includes(fromNorm);
    const toOk = !toAny || toAny.includes(toNorm);
    if (fromOk && toOk && rule?.transition) {
      return rule.transition;
    }
  }
  return transitions?.default ?? { kind: "crossfade", durationMs: 900 };
}

const modeRecipeResolver = createModeRecipeResolver({
  hashStringToSeed,
  getMemoState: (sectionId) => ({
    seed,
    sectionVariant: currentGraphVariantForSection(sectionId),
    graphAutoRefresh,
    manualRecipeSignature: graphManualRecipe ? `${graphManualRecipe.sectionId}:${graphManualRecipe.index}` : "-",
    transitionLabPresetIndex
  }),
  getLabState: () => ({
    transitionLabVariant,
    labPrimitive,
    labBackdropPolicy,
    labBackdropFixed
  }),
  cloneRecipe,
  baseGraphLayers,
  graphLayersForSection,
  randomSceneLayersForSection,
  sectionOrderIndexById,
  transitionLabTransitionDef,
  resolvePlayerSceneChoice,
  buildPlayerDefaultTransition,
  labGraphLayers,
  isGraphCapableMode
});

function withModeRecipe(
  baseRecipe: any,
  mode: ViewerMode,
  sectionId: string,
  sectionType: string,
  playerState = { variantIndex: 0, sectionBarIndex: 0, beatInBar: 1 }
) {
  return modeRecipeResolver.resolve(baseRecipe, mode, sectionId, sectionType, playerState);
}

function applyRuntimeLyricSuppression(recipeIn: any, suppressed: boolean) {
  if (!suppressed) return recipeIn;
  const recipe = cloneRecipe(recipeIn || {});
  recipe.layers = Array.isArray(recipe.layers) ? recipe.layers : [];
  recipe.graph = typeof recipe.graph === "object" && recipe.graph ? recipe.graph : {};
  recipe.graph.layers = Array.isArray(recipe.graph.layers) ? recipe.graph.layers : [];
  recipe.layers = recipe.layers.map((layer: any) => {
    const moduleId = String(layer?.module || "").toLowerCase();
    if (moduleId.includes("ui.lyrics")) {
      const next = { ...(layer || {}) };
      next.params = { ...(next.params || {}), mode: "off" };
      next.enabled = false;
      next.opacity = 0;
      return next;
    }
    return layer;
  });
  for (const layer of recipe.graph.layers) {
    const nodes = Array.isArray(layer?.nodes) ? layer.nodes : [];
    layer.nodes = nodes.map((node: any) => {
      const t = String(node?.type || "").toLowerCase();
      if (t === "text.echoword" || t === "text.wordtrails" || t === "text.karaoke") {
        return { ...(node || {}), enabled: false };
      }
      return node;
    });
  }
  return recipe;
}

function applyVisualHintsToRecipe(baseRecipe: any, nextTrack: Track | null) {
  const hints = nextTrack?.visualHints;
  if (!hints || typeof hints !== "object") return baseRecipe;
  const recipe = cloneRecipe(baseRecipe || {});
  const layers = Array.isArray(recipe?.layers) ? recipe.layers : [];
  const noGo = new Set((Array.isArray(hints.noGo) ? hints.noGo : []).map((x) => String(x).toLowerCase()));

  for (const layer of layers) {
    const moduleId = String(layer?.module || "").toLowerCase();
    layer.params = typeof layer.params === "object" && layer.params ? layer.params : {};

    if (hints.motion === "low") {
      if (moduleId.includes("particles")) {
        layer.params.speed = Math.max(0.2, Number(layer.params.speed ?? 0.45) * 0.9);
        layer.params.curl = Math.max(0.2, Number(layer.params.curl ?? 0.55) * 0.9);
      }
    } else if (hints.motion === "high") {
      if (moduleId.includes("particles")) {
        layer.params.speed = Math.min(2.2, Number(layer.params.speed ?? 0.45) * 1.1);
        layer.params.curl = Math.min(2.2, Number(layer.params.curl ?? 0.55) * 1.1);
      }
      if (moduleId.includes("gradientfield")) {
        layer.params.driftSpeed = Math.min(0.05, Number(layer.params.driftSpeed ?? 0.012) * 1.08);
      }
    }

    if (hints.density === "sparse" && moduleId.includes("particles")) {
      layer.params.count = Math.max(24, Math.round(Number(layer.params.count ?? 120) * 0.82));
      layer.opacity = Math.max(0.2, Number(layer.opacity ?? 0.55) * 0.92);
    } else if (hints.density === "dense" && moduleId.includes("particles")) {
      layer.params.count = Math.min(320, Math.round(Number(layer.params.count ?? 120) * 1.2));
      layer.opacity = Math.min(0.92, Number(layer.opacity ?? 0.55) * 1.04);
    }

    // Color-bias mapping is intentionally deferred until palette-level controls
    // exist; direct hue-rotation here caused unstable, overly-magenta looks.
    void hints.colorBias;

    if (hints.lyricPresence === "off" && (moduleId.includes("ui.lyrics") || moduleId.includes("ui.lyricskaraoke"))) {
      layer.params.mode = "off";
      layer.opacity = 0;
    } else if (hints.lyricPresence === "on" && (moduleId.includes("ui.lyrics") || moduleId.includes("ui.lyricskaraoke"))) {
      if (!layer.params.mode || layer.params.mode === "off") layer.params.mode = "center";
      layer.opacity = Math.max(0.85, Number(layer.opacity ?? 0.92));
    }

    if (noGo.has("lyrics") && (moduleId.includes("ui.lyrics") || moduleId.includes("ui.lyricskaraoke"))) {
      layer.params.mode = "off";
      layer.opacity = 0;
    }
    if (noGo.has("particles") && moduleId.includes("particles")) {
      layer.enabled = false;
      layer.opacity = 0;
    }
    if (noGo.has("text") && (moduleId.includes("ui.lyrics") || moduleId.includes("ui.lyricskaraoke"))) {
      layer.enabled = false;
      layer.opacity = 0;
    }
  }

  const graphLayers = Array.isArray(recipe?.graph?.layers) ? recipe.graph.layers : [];
  for (const gl of graphLayers) {
    const nodes = Array.isArray(gl?.nodes) ? gl.nodes : [];
    for (const node of nodes) {
      const type = String(node?.type || "").toLowerCase();
      node.params = typeof node.params === "object" && node.params ? node.params : {};
      if (hints.density === "sparse") {
        if (type.includes("orbitribbon")) node.params.points = Math.max(20, Math.round(Number(node.params.points ?? 56) * 0.88));
        if (type.includes("circlepulse")) node.params.ringCount = Math.max(4, Math.round(Number(node.params.ringCount ?? 8) * 0.9));
      } else if (hints.density === "dense") {
        if (type.includes("orbitribbon")) node.params.points = Math.min(180, Math.round(Number(node.params.points ?? 56) * 1.2));
        if (type.includes("circlepulse")) node.params.ringCount = Math.min(18, Math.round(Number(node.params.ringCount ?? 8) * 1.15));
      }
      if (hints.motion === "low" && type.includes("orbitribbon")) {
        node.params.phaseHz = Math.max(0.02, Number(node.params.phaseHz ?? 0.08) * 0.92);
      } else if (hints.motion === "high" && type.includes("orbitribbon")) {
        node.params.phaseHz = Math.min(0.4, Number(node.params.phaseHz ?? 0.08) * 1.1);
      }
      if (noGo.has("text") && type.includes("text.")) node.enabled = false;
      if (noGo.has("lyrics") && type.includes("text.")) node.enabled = false;
    }
  }

  if (hints.sectionFocus && typeof recipe === "object") {
    const existing = Array.isArray(recipe.sectionRules) ? recipe.sectionRules : [];
    existing.push({
      when: { sectionType: hints.sectionFocus },
      set: {
        "fg.particles.opacity": 0.72,
        "ui.lyricsKaraoke.fontSizePx": 32
      }
    });
    recipe.sectionRules = existing;
  }

  return recipe;
}

function runDeterminismProbe(input: {
  tMs: number;
  seed: number;
  sectionId: string;
  sectionType: string;
  signalBus: ViewerSignalBus;
  amp: number;
  recipe: any;
}) {
  const stateLike = {
    tMs: input.tMs,
    sectionId: input.sectionId,
    sectionType: input.sectionType,
    viewerMode,
    signalBus: input.signalBus,
    amp: input.amp,
    energy: input.amp,
    recipe: input.recipe,
    track
  };
  try {
    const layers = Array.isArray(input.recipe?.layers) ? input.recipe.layers : [];
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

    const graphLayers = Array.isArray(input.recipe?.graph?.layers) ? input.recipe.graph.layers : [];
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

  for (const marker of sectionMarkers) {
    const ms = Math.max(0, Math.round(Number(marker.tMs)));
    const tSecRaw = Number(ms) / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = marker.source === "hint" ? "#F44336" : "#C62828";
    ctx.lineWidth = marker.source === "hint" ? 3 : 2;
    ctx.globalAlpha = marker.source === "hint" ? 0.95 : 0.75;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 6);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }

  if (endMarkerMs > 0) {
    const tSecRaw = Number(endMarkerMs) / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = "#B71C1C";
    ctx.lineWidth = 4;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 8);
    ctx.lineTo(x, y1 + 2);
    ctx.stroke();
  }

  const lyricLineStartsMs = (Array.isArray(track?.timing?.lyricsLines) ? track.timing.lyricsLines : [])
    .map((row: any) => Number(row?.t0Ms))
    .filter((n: number) => Number.isFinite(n))
    .map((n: number) => Math.max(0, Math.round(n)))
    .sort((a: number, b: number) => a - b);
  for (const ms of lyricLineStartsMs) {
    const tSecRaw = ms / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = "#4FC3F7";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 18);
    ctx.lineTo(x, y0 - 6);
    ctx.stroke();
  }

  const lyricSuppressOverlayRows = hintOverlays
    .filter((h) => h.type === "hint/lyricSuppress")
    .map((h) => ({
      tMs: Math.max(0, Math.round(Number(h.tSec) * 1000)),
      action: h?.payload?.action === "clear" ? "clear" : "set"
    }));
  for (const marker of lyricSuppressOverlayRows) {
    const ms = marker.tMs;
    const tSecRaw = ms / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = marker.action === "clear" ? "#FF8A65" : "#EC4BC3";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 12);
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

function drawSectionMarkersOverlay() {
  const durationSec = Number(audio.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  const y0 = canvas.height - 44;
  const y1 = canvas.height - 8;
  ctx.save();
  for (const marker of sectionMarkers) {
    const ms = Math.max(0, Math.round(Number(marker.tMs)));
    const tSecRaw = Number(ms) / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = marker.source === "hint" ? "#F44336" : "#C62828";
    ctx.lineWidth = marker.source === "hint" ? 3 : 2;
    ctx.globalAlpha = marker.source === "hint" ? 0.95 : 0.78;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 6);
    ctx.lineTo(x, y1);
    ctx.stroke();
  }
  if (endMarkerMs > 0) {
    const tSecRaw = Number(endMarkerMs) / 1000;
    const tSec = Math.max(0, Math.min(durationSec, tSecRaw + renderOffsetMs / 1000));
    const x = Math.max(0, Math.min(canvas.width, (tSec / durationSec) * canvas.width));
    ctx.strokeStyle = "#B71C1C";
    ctx.lineWidth = 4;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x, y0 - 8);
    ctx.lineTo(x, y1 + 2);
    ctx.stroke();
  }
  ctx.restore();
}

function downbeatCountAt(tMs: number) {
  const ds = downbeatMarkers.length
    ? downbeatMarkers.map((m) => Number(m.tMs))
    : (pulseDownbeatTimesMs ?? []).map((x) => Number(x));
  if (!ds.length) return 0;
  let count = 0;
  for (const x of ds) {
    if (!Number.isFinite(x)) continue;
    if (x <= tMs) count += 1;
  }
  return count;
}

function beatCountAt(tMs: number) {
  const bs = beatMarkers.length
    ? beatMarkers.map((m) => Number(m.tMs))
    : (pulseBeatTimesMs ?? []).map((x) => Number(x));
  if (!bs.length) return 0;
  let count = 0;
  for (const x of bs) {
    if (!Number.isFinite(x)) continue;
    if (x <= tMs) count += 1;
  }
  return count;
}

function beatInBarAt(tMs: number) {
  const bs = beatMarkers.length
    ? beatMarkers.map((m) => Number(m.tMs)).filter((x) => Number.isFinite(x))
    : (pulseBeatTimesMs ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  if (!bs.length) return 1;
  const ds = downbeatMarkers.length
    ? downbeatMarkers.map((m) => Number(m.tMs)).filter((x) => Number.isFinite(x))
    : (pulseDownbeatTimesMs ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  let lastDownbeat = -Infinity;
  for (const x of ds) {
    if (x <= tMs) lastDownbeat = x;
    else break;
  }
  const beatsSinceDownbeat = Math.max(1, beatCountAt(tMs) - beatCountAt(lastDownbeat) + 1);
  return Math.max(1, Math.min(4, beatsSinceDownbeat));
}

function buildScene(nextSeed: number) {
  seed = nextSeed >>> 0;
  invalidateModeRecipeMemo();
  rhythmPlanCache.clear();
  hudLastUpdateMs = 0;
  hudLastText = "";
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
  const frameNowMs = performance.now();
  if (lastFrameTsMs > 0) {
    const dt = frameNowMs - lastFrameTsMs;
    if (dt > 0 && dt < 1000) {
      const fpsInstant = 1000 / dt;
      fpsSmoothed = fpsSmoothed > 0 ? (fpsSmoothed * 0.9 + fpsInstant * 0.1) : fpsInstant;
      const targetFps = 30;
      const wantedScale = fpsSmoothed < targetFps
        ? Math.max(0.45, Math.min(1, fpsSmoothed / targetFps))
        : 1;
      const adaptRate = wantedScale < adaptiveDensityScale ? 0.2 : 0.05;
      adaptiveDensityScale = adaptiveDensityScale + (wantedScale - adaptiveDensityScale) * adaptRate;
      adaptiveDensityScale = clamp01(Math.max(0.45, adaptiveDensityScale));
    }
  }
  lastFrameTsMs = frameNowMs;
  if (stemSignalsActive() && !audio.paused) sampleStemDrift();
  const tAudioMs = audio.currentTime * 1000;
  const lastAmp = ampHistory.length ? ampHistory[ampHistory.length - 1] : null;
  if (lastAmp && tAudioMs + 250 < lastAmp.tMs) {
    resetAmpHistory("time-jump-backward");
  }
  const tRenderMs = tAudioMs + renderOffsetMs;
  if (!audio.paused) {
    void resumeAudioContext();
  }
  const reactiveNow = sampleReactiveAudio(tAudioMs);
  const ampNow = reactiveNow.master.ampRms;
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
  pushReactiveSample(tAudioMs, reactiveNow);
  const reactiveAligned = reactiveAt(tRenderMs, reactiveNow);
  const amp = amplitudeAt(tRenderMs, ampNow);
  const sectionClockMs = tRenderMs;
  const effectiveBeatsMs = beatMarkers.length
    ? beatMarkers.map((m) => Number(m.tMs)).filter((x) => Number.isFinite(x))
    : (pulseBeatTimesMs ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));
  const effectiveDownbeatsMs = downbeatMarkers.length
    ? downbeatMarkers.map((m) => Number(m.tMs)).filter((x) => Number.isFinite(x))
    : (pulseDownbeatTimesMs ?? []).map((x) => Number(x)).filter((x) => Number.isFinite(x));

  const sec = findCurrentSection(sectionClockMs);
  const nextSec = findNextSection(sectionClockMs);
  const sectionId = sec?.id ?? "";
  const sectionType = classifySection(sectionId || sec?.id || "");
  const nextSectionId = nextSec?.id ?? "";
  const nextSectionType = classifySection(nextSectionId || nextSec?.id || "");
  const nextSectionStartMs = Number.isFinite(Number(nextSec?.t0Ms)) ? Number(nextSec?.t0Ms) : NaN;
  const sectionStartMsRaw = Number(sec?.t0Ms);
  const sectionStartMs = Number.isFinite(sectionStartMsRaw) ? sectionStartMsRaw : 0;
  const sectionDownbeatIndex = Math.max(0, downbeatCountAt(sectionClockMs) - downbeatCountAt(sectionStartMs - 1));
  const sectionBarIndex = Math.max(0, sectionDownbeatIndex - 1);
  const playerTimingState = {
    variantIndex: sectionDownbeatIndex,
    sectionBarIndex,
    beatInBar: beatInBarAt(sectionClockMs)
  };
  const nextSectionDownbeatIndex = Number.isFinite(nextSectionStartMs)
    ? Math.max(0, downbeatCountAt(nextSectionStartMs) - downbeatCountAt(nextSectionStartMs - 1))
    : 0;
  const nextPlayerTimingState = {
    variantIndex: nextSectionDownbeatIndex,
    sectionBarIndex: Math.max(0, nextSectionDownbeatIndex - 1),
    beatInBar: 1
  };
  updateGraphSectionState(sectionId);
  const modeRecipe = withModeRecipe(currentRecipe, viewerMode, sectionId, sectionType, playerTimingState);
  const pulse = beatPulseInfo(tRenderMs);
  const transitionDefForNext = nextSectionId
    ? resolveTransitionDefForSections(modeRecipe, sectionId, nextSectionId)
    : null;
  const transitionDurationMs = Math.max(1, Number((transitionDefForNext as any)?.durationMs ?? 900));
  const transitionWindowStartMs = Number.isFinite(nextSectionStartMs)
    ? (nextSectionStartMs - transitionDurationMs)
    : NaN;
  const inTransitionWindow = Number.isFinite(transitionWindowStartMs) &&
    Number.isFinite(nextSectionStartMs) &&
    tRenderMs >= transitionWindowStartMs &&
    tRenderMs <= nextSectionStartMs;
  updateGraphAutoVariantState(sectionId, tRenderMs, viewerMode === "transition-lab" && inTransitionWindow);
  const durationSec = Number.isFinite(audio.duration) ? Number(audio.duration) : 0;
  let nextModeRecipe = nextSectionId
    ? withModeRecipe(currentRecipe, viewerMode, nextSectionId, nextSectionType, nextPlayerTimingState)
    : null;
  if (isPlayerMode() && nextModeRecipe) {
    const curGraphSig = stableStringify(modeRecipe?.graph?.layers ?? []);
    const nextGraphSig = stableStringify(nextModeRecipe?.graph?.layers ?? []);
    if (curGraphSig === nextGraphSig) {
      // Ensure section transitions stay visually legible when hash picks collide.
      nextModeRecipe = withModeRecipe(currentRecipe, viewerMode, nextSectionId, nextSectionType, {
        ...nextPlayerTimingState,
        variantIndex: nextPlayerTimingState.variantIndex + 1
      });
    }
  }
  if (isPlayerMode()) {
    if (playerLastSectionId && playerLastSectionId !== sectionId) {
      playerLastTransitionLabel = selectTransitionLabel(modeRecipe, playerLastSectionId, sectionId);
    }
    playerLastSectionId = sectionId;
  } else {
    playerLastSectionId = "";
  }
  const signalBus = buildSignalBus({
    tAudioMs,
    tRenderMs,
    durationSec,
    amp,
    reactive: {
      ampFast: reactiveAligned.master.ampFast,
      ampSlow: reactiveAligned.master.ampSlow,
      low: reactiveAligned.master.low,
      mid: reactiveAligned.master.mid,
      high: reactiveAligned.master.high,
      onsetScore: reactiveAligned.master.onsetScore,
      onsetPulse: reactiveAligned.master.onsetPulse,
      vocalsActive: reactiveAligned.vocalsActive,
      sources: {
        master: {
          ampFast: reactiveAligned.master.ampFast,
          ampSlow: reactiveAligned.master.ampSlow,
          low: reactiveAligned.master.low,
          mid: reactiveAligned.master.mid,
          high: reactiveAligned.master.high,
          onsetScore: reactiveAligned.master.onsetScore,
          onsetPulse: reactiveAligned.master.onsetPulse,
          wave: reactiveAligned.master.wave,
          freq: reactiveAligned.master.freq
        },
        backing: {
          ampFast: reactiveAligned.backing.ampFast,
          ampSlow: reactiveAligned.backing.ampSlow,
          low: reactiveAligned.backing.low,
          mid: reactiveAligned.backing.mid,
          high: reactiveAligned.backing.high,
          onsetScore: reactiveAligned.backing.onsetScore,
          onsetPulse: reactiveAligned.backing.onsetPulse,
          wave: reactiveAligned.backing.wave,
          freq: reactiveAligned.backing.freq
        },
        vocals: {
          ampFast: reactiveAligned.vocals.ampFast,
          ampSlow: reactiveAligned.vocals.ampSlow,
          low: reactiveAligned.vocals.low,
          mid: reactiveAligned.vocals.mid,
          high: reactiveAligned.vocals.high,
          onsetScore: reactiveAligned.vocals.onsetScore,
          onsetPulse: reactiveAligned.vocals.onsetPulse,
          wave: reactiveAligned.vocals.wave,
          freq: reactiveAligned.vocals.freq
        }
      }
    },
    sectionId,
    sectionType,
    pulse,
    rhythm: buildRhythmCueState({
      tMs: tRenderMs,
      beatsMs: effectiveBeatsMs,
      downbeatsMs: effectiveDownbeatsMs,
      sectionId,
      sectionType,
      seedBase: seed
    })
  });
  const lyricsSuppressedNow = isLyricSuppressedAt(tRenderMs);
  const runtimeRecipe = applyRuntimeLyricSuppression(modeRecipe, lyricsSuppressedNow);
  const runtimeNextRecipe = applyRuntimeLyricSuppression(nextModeRecipe, lyricsSuppressedNow);
  const controlsRect = controls.getBoundingClientRect();
  const viewportHeightPx = window.visualViewport?.height ?? window.innerHeight;
  const frameInfo = engine.renderFrame({
    tMs: tRenderMs,
    sectionId,
    sectionType,
    nextSectionId,
    nextSectionType,
    nextSectionStartMs,
    viewerMode,
    signalBus,
    beatTrack: {
      beatsMs: effectiveBeatsMs,
      downbeatsMs: effectiveDownbeatsMs
    },
    amp,
    energy: amp,
    recipe: runtimeRecipe,
    nextRecipe: runtimeNextRecipe,
    track,
    lyricsEnabled: (isHintEditMode() ? lyricsEnabled : true) && hasLyricTiming() && !lyricsSuppressedNow,
    lyricMode,
    uiLayout: {
      controlsTopPx: controlsRect.top,
      viewportHeightPx
    }
  });
  if (isHintEditMode() && !recipeHasGraphNodeType(modeRecipe, "shape.beatOrb")) {
    drawBeatOrb(pulse.beat, pulse.downbeat);
  }
  if (isHintEditMode()) drawHintOverlays();
  if (viewerMode === "transition-lab") drawSectionMarkersOverlay();
  if (isPrimitiveLabMode() && labPrimitive === "overlay.beatTrack") drawHintOverlays();

if (!isSeeking && Number.isFinite(audio.duration) && audio.duration > 0) {
  const max = Math.max(1, Number(seek.max) || SEEK_SCALE);
  seek.value = String(
    Math.min(max, Math.max(0, Math.round((audio.currentTime / audio.duration) * max)))
  );
}

  const lyricRef = findCurrentLyricLine(tRenderMs);
  const frameLyricIndex = Number(frameInfo?.lyricIndex);
  const lyricIndex = Number.isFinite(frameLyricIndex) && frameLyricIndex >= 0
    ? frameLyricIndex
    : (typeof lyricRef?.i === "number" ? lyricRef.i : -1);
  const lyricText = (typeof frameInfo?.lyricText === "string" && frameInfo.lyricText.trim().length > 0)
    ? String(frameInfo.lyricText)
    : typeof lyricRef?.i === "number" && lyricRef.i >= 0 && lyricRef.i < lyricsLines.length
      ? lyricsLines[lyricRef.i]
      : "";
  hud.style.display = hudVisible ? "block" : "none";
  if (hudVisible && (hudLastText === "" || frameNowMs - hudLastUpdateMs >= HUD_UPDATE_INTERVAL_MS)) {
    const labProfileRounded = (() => {
      const p = currentLabProfile();
      return {
        ...p,
        scale: Number(p.scale.toFixed(2)),
        density: Number(p.density.toFixed(2))
      };
    })();
    const playerSceneChoice = isPlayerMode() ? resolvePlayerSceneChoice(sectionId, sectionType, playerTimingState) : null;
    const nextSectionInMs = Number.isFinite(nextSectionStartMs) ? Math.round(nextSectionStartMs - sectionClockMs) : NaN;
    const graphSel = resolveHudGraphSelection(sectionId, sectionType, playerTimingState.variantIndex, playerSceneChoice);
    const effectiveBpm = estimateBpmFromBeats(effectiveBeatsMs);
    const targetFps = 30;
    const adaptiveFloorScale = 0.45;
    const adaptiveFloorFps = targetFps * adaptiveFloorScale;
    hudLastText = [
      `title: ${preferredTrackTitle(track)}`,
      `trackId: ${track?.trackId ?? "-"}`,
      `seed: ${seed}`,
      `mode: ${viewerMode}`,
      `time: ${fmtMs(tRenderMs)}`,
      `fps: ${fpsSmoothed > 0 ? fpsSmoothed.toFixed(1) : "-"} target:${targetFps} density:${adaptiveDensityScale.toFixed(2)} floor:${adaptiveFloorFps.toFixed(1)}`,
      `bpm: ${Number.isFinite(effectiveBpm) ? effectiveBpm.toFixed(1) : "-"}`,
      `offsetMs: ${renderOffsetMs}`,
      `audioNet: wait:${audioWaitingCount} stall:${audioStalledCount} susp:${audioSuspendCount} prog:${audioProgressAtMs > 0 ? `${Math.max(0, Math.round((performance.now() - audioProgressAtMs) / 1000))}s` : "-"}`,
      ...hudHintModeLines(signalBus),
      ...hudLabModeLines(labProfileRounded),
      ...hudGraphModeLines(modeRecipe, graphSel, playerSceneChoice, playerTimingState.variantIndex, nextSectionId, nextSectionInMs),
      `sectionId: ${sectionId || "-"}`,
      `sectionType: ${frameInfo?.sectionType ?? sectionType}`,
      `rhythm: ${signalBus.rhythm.patternId} bar:${signalBus.rhythm.barIndex} step16:${signalBus.rhythm.step16} M${signalBus.rhythm.lanes.motion.pulse.toFixed(2)}${signalBus.rhythm.lanes.motion.hit ? "*" : ""} T${signalBus.rhythm.lanes.transition.pulse.toFixed(2)}${signalBus.rhythm.lanes.transition.hit ? "*" : ""}`,
      `rhythmSteps: cues:${signalBus.rhythm.cueCount} [${signalBus.rhythm.step16s.join(",")}]`,
      `theme: C${signalBus.theme.coherence.toFixed(2)} P${signalBus.theme.pressure.toFixed(2)} L${signalBus.theme.lyricActivity.toFixed(2)} E${signalBus.theme.sectionEnergy.toFixed(2)}`,
      `lyricIndex: ${lyricIndex}`,
      `lyric: ${lyricText || "-"}`,
      ``,
      ...hudKeyHelpLines()
    ].join("\n");
    hudLastUpdateMs = frameNowMs;
    hud.textContent = hudLastText;
  } else if (hudVisible && hud.textContent !== hudLastText) {
    hud.textContent = hudLastText;
  }

  requestAnimationFrame(render);
}

async function loadTrack(nextIndex: number) {
  if (!indexEntries.length) return;
  selectedIndex = (nextIndex + indexEntries.length) % indexEntries.length;
  const entry = indexEntries[selectedIndex];
  const trackId = trackIdFromEntry(entry);
  resetTrackLoadModeState();
  updateUrlParam("track", trackId);

  track = await loadTrackJsonAndGuidance(entry);
  refreshSectionCache(track);
  triggerAuthoringReduce(track);
  runPostTrackLoadHousekeeping(trackId);
  currentRecipe = await resolveTrackRecipeWithFallback(track);

  const assets = await resolveEffectivePlaybackAssets(track, trackUrl);
  const { wasPlaying } = await applyTrackPlaybackAssets(assets, trackUrl);

  applyTrackSeed(track.trackId || trackId);
  await resumePlaybackIfNeeded(wasPlaying);
}

async function init() {
  hud.style.display = hudVisible ? "block" : "none";
  const indexResp = await fetch("/tracks/index.json");
  if (!indexResp.ok) throw new Error("Failed to load /tracks/index.json");
  indexEntries = (await indexResp.json()) as string[];
  if (!indexEntries.length) throw new Error("No tracks found in index.json");

  const { requestedTrackId } = applyInitialViewerConfigFromUrl();
  await loadTrack(resolveInitialTrackIndex(requestedTrackId));
  showControlsTemporarily();
}

async function goNextTrack() {
  await loadTrack(selectedIndex + 1);
}

function restartCurrentTrack() {
  audio.currentTime = 0;
  if (stemSignalsActive()) {
    audioBacking.currentTime = 0;
    audioVocals.currentTime = 0;
  }
}

async function goPrevTrackOrRestart() {
  if (audio.currentTime > 5) {
    restartCurrentTrack();
    return;
  }
  await loadTrack(selectedIndex - 1);
}

function syncAnalysisToCurrent() {
  if (!stemSignalsActive()) return;
  const t = Number(audio.currentTime) || 0;
  audioBacking.currentTime = t;
  audioVocals.currentTime = t;
}

function seekRelativeSec(deltaSec: number) {
  if (deltaSec < 0) {
    audio.currentTime = Math.max(0, audio.currentTime + deltaSec);
  } else {
    const maxT = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + deltaSec;
    audio.currentTime = Math.min(maxT, audio.currentTime + deltaSec);
  }
  syncAnalysisToCurrent();
}

function toggleHud() {
  hudVisible = !hudVisible;
  updateUrlParam("hud", hudVisible ? "1" : null);
}

function refreshSeedAndShowControls() {
  randomizeSeed();
  showControlsTemporarily();
}

function toggleHudAndShowControls() {
  toggleHud();
  showControlsTemporarily();
}

function runControlAction(action: () => void) {
  action();
  showControlsTemporarily();
}

function captureAndQueueHintEvent(
  type: "hint/downbeat" | "hint/beat" | "hint/barBeat" | "hint/sectionMarker" | "hint/endMarker" | "hint/lyricSuppress",
  payload?: Record<string, any>
) {
  const tSec = currentHintCaptureSec();
  const event = payload ? { type, tSec, payload } : { type, tSec };
  applyHintEventOptimistic(event as any);
  queueHintEvent(event as any);
}

function handleHintEditKeydown(e: KeyboardEvent) {
  if (!isHintEditMode()) return false;
  const key = e.key.toLowerCase();
  if (!e.repeat && (key === "d" || key === "b" || ["1", "2", "3", "4"].includes(e.key))) {
    if (key === "d") {
      captureAndQueueHintEvent("hint/downbeat");
      return true;
    }
    if (key === "b") {
      captureAndQueueHintEvent("hint/beat");
      return true;
    }
    const beatInBar = Number(e.key);
    if (Number.isInteger(beatInBar) && beatInBar >= 1 && beatInBar <= 4) {
      captureAndQueueHintEvent("hint/barBeat", { beatInBar });
      return true;
    }
  }
  if (!e.repeat && key === "s") {
    const tSec = currentHintCaptureSec();
    const tMs = Math.max(0, Math.round(tSec * 1000));
    const action = hasSectionMarkerNear(tMs, 140) ? "clear" : "set";
    captureAndQueueHintEvent("hint/sectionMarker", { action });
    return true;
  }
  if (!e.repeat && key === "e") {
    const tSec = currentHintCaptureSec();
    const tMs = Math.max(0, Math.round(tSec * 1000));
    const action = endMarkerMs > 0 && Math.abs(endMarkerMs - tMs) <= 140 ? "clear" : "set";
    captureAndQueueHintEvent("hint/endMarker", { action });
    return true;
  }
  if (!e.repeat && key === "x") {
    const tSec = currentHintCaptureSec();
    const tMs = Math.max(0, Math.round(tSec * 1000));
    const action = hasLyricSuppressMarkerNear(tMs, 140)
      ? "clear"
      : (isLyricSuppressedAt(tMs) ? "clear" : "set");
    captureAndQueueHintEvent("hint/lyricSuppress", { action });
    return true;
  }
  if (!e.repeat && key === "c") {
    void clearHintEventsForCurrentTrack();
    return true;
  }
  if (!e.repeat && key === "u") {
    void undoLastHintGroupForCurrentTrack();
    return true;
  }
  return false;
}

function handleGraphModeKeydown(e: KeyboardEvent) {
  if (!isGraphMode() || e.repeat) return false;
  const key = e.key.toLowerCase();
  const cycleRecipeByMode = (dir: 1 | -1) => {
    const sectionId = currentSectionIdNow();
    if (viewerMode === "recipe-view") cycleGraphRecipeForSection(currentRecipe, sectionId, dir);
    else cycleRandomSceneForSection(sectionId, dir);
  };
  if (key === "j") {
    cycleRecipeByMode(-1);
    return true;
  }
  if (key === "k") {
    cycleRecipeByMode(1);
    return true;
  }
  if (key === "r") {
    cycleGraphVariantForSection(currentSectionIdNow());
    return true;
  }
  if (key === "a") {
    graphAutoRefresh = !graphAutoRefresh;
    return true;
  }
  return false;
}

function handleTransitionLabKeydown(e: KeyboardEvent) {
  if (viewerMode !== "transition-lab" || e.repeat) return false;
  const key = e.key.toLowerCase();
  if (key === "t") {
    cycleTransitionLabPreset(-1);
    return true;
  }
  if (key === "y") {
    cycleTransitionLabPreset(1);
    return true;
  }
  if (key === "u") {
    cycleTransitionLabVariant(-1);
    return true;
  }
  if (key === "i") {
    cycleTransitionLabVariant(1);
    return true;
  }
  return false;
}

function handlePrimitiveLabKeydown(e: KeyboardEvent) {
  if (!isPrimitiveLabMode() || e.repeat) return false;
  const key = e.key.toLowerCase();
  if (key === "b") {
    cycleLabBackdropPolicy();
    return true;
  }
  if (key === "j") {
    cycleLabPrimitive(-1);
    return true;
  }
  if (key === "k") {
    cycleLabPrimitive(1);
    return true;
  }
  return false;
}

function handleOffsetKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (key === "o" && !e.repeat) {
    e.preventDefault();
    cycleOffsetPreset();
    return true;
  }
  if (e.code === "BracketLeft") {
    nudgeRenderOffset(-10);
    e.preventDefault();
    return true;
  }
  if (e.code === "BracketRight") {
    nudgeRenderOffset(10);
    e.preventDefault();
    return true;
  }
  return false;
}

async function handleTransportKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (e.code === "Space" && !e.repeat) {
    e.preventDefault();
    await togglePlayPause();
    return true;
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    seekRelativeSec(-5);
    return true;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    seekRelativeSec(5);
    return true;
  }
  if (key === "n" || e.key === "." || e.key === ">") {
    e.preventDefault();
    await goNextTrack();
    return true;
  }
  if (key === "p" || e.key === "," || e.key === "<") {
    e.preventDefault();
    await goPrevTrackOrRestart();
    return true;
  }
  return false;
}

function handleGlobalModeKeydown(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  if (key === "h" || e.key === "?") {
    e.preventDefault();
    toggleHud();
    return true;
  }
  if (key === "m") {
    e.preventDefault();
    lyricMode = lyricMode === "fixed" ? "center" : lyricMode === "center" ? "off" : "fixed";
    syncLyricsUrlParams();
    return true;
  }
  if (key === "v" && !e.repeat) {
    e.preventDefault();
    cycleViewerMode();
    return true;
  }
  if (isSeedRefreshMode() && key === "r" && !e.repeat) {
    e.preventDefault();
    randomizeSeed();
    return true;
  }
  return false;
}

function handlePostTransportKeydown(e: KeyboardEvent) {
  if (handleHintEditKeydown(e)) {
    e.preventDefault();
    return true;
  }
  if (handleGraphModeKeydown(e)) {
    e.preventDefault();
    return true;
  }
  if (handleTransitionLabKeydown(e)) {
    e.preventDefault();
    return true;
  }
  if (handleGlobalModeKeydown(e)) return true;
  if (handlePrimitiveLabKeydown(e)) {
    e.preventDefault();
    return true;
  }
  if (handleOffsetKeydown(e)) return true;
  return false;
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
  refreshSeedAndShowControls();
});

modeBtn?.addEventListener("click", () => {
  runControlAction(() => cycleViewerMode());
});

offsetDecBtn?.addEventListener("click", () => {
  runControlAction(() => nudgeRenderOffset(-10));
});

offsetCycleBtn?.addEventListener("click", () => {
  runControlAction(() => cycleOffsetPreset());
});

offsetIncBtn?.addEventListener("click", () => {
  runControlAction(() => nudgeRenderOffset(10));
});

shareBtn?.addEventListener("click", () => {
  runControlAction(() => {
    void copyShareUrl();
  });
});

hudBtn.addEventListener("click", () => {
  toggleHudAndShowControls();
});

window.addEventListener("keydown", async (e) => {
  showControlsTemporarily();
  if (await handleTransportKeydown(e)) return;
  if (handlePostTransportKeydown(e)) return;
});

window.addEventListener("mousemove", showControlsTemporarily);
window.addEventListener("touchstart", showControlsTemporarily, { passive: true });
window.addEventListener("pointerdown", showControlsTemporarily);

canvas.addEventListener("click", () => {
  if (canvasClickTimer) window.clearTimeout(canvasClickTimer);
  canvasClickTimer = window.setTimeout(() => {
    refreshSeedAndShowControls();
  }, 220);
});

canvas.addEventListener("dblclick", () => {
  if (canvasClickTimer) {
    window.clearTimeout(canvasClickTimer);
    canvasClickTimer = 0;
  }
  toggleHudAndShowControls();
});

audio.addEventListener("play", () => { 
  ensureAudioGraph();
  void resumeAudioContext();
  sampleStemDrift();
  logAudioState("play");
  setPlayButtonIcon();
});
audio.addEventListener("seeking", () => {
  void resumeAudioContext();
  syncAnalysisToCurrent();
  logAudioState("seeking");
});
audio.addEventListener("seeked", () => {
  logAudioState("seeked");
});
audio.addEventListener("waiting", () => {
  audioWaitingCount += 1;
  logAudioState("waiting");
});
audio.addEventListener("stalled", () => {
  audioStalledCount += 1;
  logAudioState("stalled");
});
audio.addEventListener("suspend", () => {
  audioSuspendCount += 1;
  logAudioState("suspend");
});
audio.addEventListener("progress", () => {
  audioProgressAtMs = performance.now();
});
audioVocals.addEventListener("seeked", () => {
  sampleStemDrift();
});
audioVocals.addEventListener("playing", () => {
  sampleStemDrift();
});
audio.addEventListener("pause", () => {
  if (stemSignalsActive()) {
    audioBacking.pause();
    audioVocals.pause();
  }
  audio.playbackRate = 1;
  audioBacking.playbackRate = 1;
  audioVocals.playbackRate = 1;
  logAudioState("pause");
  setPlayButtonIcon();
});
audio.addEventListener("ended", async () => {
  if (stemSignalsActive()) {
    audioBacking.pause();
    audioVocals.pause();
  }
  await goNextTrack();
  ensureAudioGraph();
  await resumeAudioContext();
  await playSynced();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void resumeAudioContext();
    if (stemSignalsActive() && !audio.paused) syncAnalysisToCurrent();
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


