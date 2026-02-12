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

if (!ctx) throw new Error("Canvas 2D context unavailable");

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
let hudVisible = new URL(location.href).searchParams.get("hud") === "1";
let particles: Particle[] = [];
let palette = palettes[0];
let isSeeking = false;

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let audioData: Uint8Array | null = null;

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

function ensureAudioGraph() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  audioData = new Uint8Array(analyser.fftSize);
  const src = audioCtx.createMediaElementSource(audio);
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
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
  resizeCanvas();
  const w = canvas.width;
  const h = canvas.height;
  const currentTimeMs = audio.currentTime * 1000;
  const amp = rmsAmplitude();
  const pulse = beatPulse(currentTimeMs);
  const wobbleX = Math.sin(currentTimeMs * 0.001 + seed * 0.00001) * amp * 48;
  const wobbleY = Math.cos(currentTimeMs * 0.0013 + seed * 0.00002) * amp * 48;

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

  const t = currentTimeMs * 0.001;
  for (const p of particles) {
    const dx = Math.cos(p.angle) * p.speed * t + Math.sin(t * p.drift * 0.3) * 0.02;
    const dy = Math.sin(p.angle) * p.speed * t + Math.cos(t * p.drift * 0.2) * 0.02;
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
    seek.value = String(Math.min(1000, Math.max(0, (audio.currentTime / audio.duration) * 1000)));
  }

  const sec = findCurrentSection(currentTimeMs);
  const lyricRef = findCurrentLyricLine(currentTimeMs);
  const lyricText =
    typeof lyricRef?.i === "number" && lyricRef.i >= 0 && lyricRef.i < lyricsLines.length ? lyricsLines[lyricRef.i] : "";
  hud.style.display = hudVisible ? "block" : "none";
  hud.textContent = [
    `title: ${track?.title ?? "-"}`,
    `trackId: ${track?.trackId ?? "-"}`,
    `seed: ${seed}`,
    `time: ${fmtMs(currentTimeMs)}`,
    `section: ${sec?.id ?? "-"}`,
    `lyric: ${lyricText || "-"}`
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
  playBtn.textContent = audio.paused ? "Play" : "Pause";
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
  seed = seedParam ? Number(seedParam) : NaN;

  const byTrackId = requestedTrackId
    ? indexEntries.findIndex((entry) => trackIdFromEntry(entry) === requestedTrackId)
    : -1;
  await loadTrack(byTrackId >= 0 ? byTrackId : 0);
}

playBtn.addEventListener("click", async () => {
  if (audio.paused) {
    ensureAudioGraph();
    await audioCtx?.resume();
    await audio.play().catch(() => undefined);
  } else {
    audio.pause();
  }
  playBtn.textContent = audio.paused ? "Play" : "Pause";
});

prevBtn.addEventListener("click", async () => {
  await loadTrack(selectedIndex - 1);
});

nextBtn.addEventListener("click", async () => {
  await loadTrack(selectedIndex + 1);
});

seek.addEventListener("pointerdown", () => {
  isSeeking = true;
});
seek.addEventListener("pointerup", () => {
  isSeeking = false;
});
seek.addEventListener("input", () => {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
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

audio.addEventListener("play", () => {
  playBtn.textContent = "Pause";
});
audio.addEventListener("pause", () => {
  playBtn.textContent = "Play";
});

window.addEventListener("resize", resizeCanvas);
requestAnimationFrame(render);

init().catch((err) => {
  hudVisible = true;
  hud.style.display = "block";
  hud.textContent = err instanceof Error ? err.message : String(err);
});
