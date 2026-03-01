import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const KNOWN_HINT_TYPES = new Set(["hint/downbeat", "hint/beat", "hint/barBeat"]);

function toPosix(p) {
  return String(p || "").split(path.sep).join("/");
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeMsList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)));
}

function stableEventId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function validateHintEventShape(event) {
  if (!event || typeof event !== "object") return { ok: false, error: "event must be an object" };
  const type = String(event.type || "");
  if (!KNOWN_HINT_TYPES.has(type)) return { ok: false, error: `unknown hint type: ${type}` };
  const tSec = Number(event.tSec);
  if (!Number.isFinite(tSec) || tSec < 0) return { ok: false, error: "tSec must be a non-negative number" };
  if (type === "hint/barBeat") {
    const beatInBar = Number(event?.payload?.beatInBar);
    if (!Number.isInteger(beatInBar) || beatInBar < 1 || beatInBar > 4) {
      return { ok: false, error: "payload.beatInBar must be an integer 1..4" };
    }
  }
  return { ok: true };
}

export function buildHintEvent(input) {
  const type = String(input?.type || "");
  const actorRaw = String(input?.actor || "user");
  const actor = actorRaw === "system" || actorRaw === "ai" ? actorRaw : "user";
  const event = {
    eventId: String(input?.eventId || stableEventId()),
    at: String(input?.at || new Date().toISOString()),
    actor,
    type,
    trackId: String(input?.trackId || ""),
    workId: String(input?.workId || ""),
    tSec: Number(input?.tSec),
    payload: input?.payload && typeof input.payload === "object" ? input.payload : {}
  };
  const check = validateHintEventShape(event);
  if (!check.ok) throw new Error(check.error);
  return event;
}

export function readEventsJsonl(eventsPath) {
  if (!eventsPath || !fs.existsSync(eventsPath)) return [];
  const raw = fs.readFileSync(eventsPath, "utf8");
  if (!raw.trim()) return [];
  const out = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const parsed = JSON.parse(s);
      if (!parsed || typeof parsed !== "object") continue;
      out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}

export function appendEventJsonl(eventsPath, event) {
  const payload = `${JSON.stringify(event)}\n`;
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  const fd = fs.openSync(eventsPath, "a");
  try {
    fs.writeSync(fd, payload, null, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function uniqSortedMs(values) {
  const sorted = values
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)))
    .sort((a, b) => a - b);
  const out = [];
  for (const n of sorted) {
    if (!out.length || Math.abs(out[out.length - 1] - n) > 12) out.push(n);
  }
  return out;
}

function nearestBeatMs(targetMs, beatsMs) {
  if (!Array.isArray(beatsMs) || beatsMs.length === 0) return Math.max(0, Math.round(Number(targetMs) || 0));
  const t = Math.max(0, Math.round(Number(targetMs) || 0));
  let best = beatsMs[0];
  let bestDiff = Math.abs(best - t);
  for (let i = 1; i < beatsMs.length; i += 1) {
    const b = beatsMs[i];
    const d = Math.abs(b - t);
    if (d < bestDiff) {
      best = b;
      bestDiff = d;
    }
  }
  return best;
}

function nearestBeatIndex(targetMs, beatsMs) {
  if (!Array.isArray(beatsMs) || beatsMs.length === 0) return -1;
  const t = Math.max(0, Math.round(Number(targetMs) || 0));
  let bestIdx = 0;
  let bestDiff = Math.abs(beatsMs[0] - t);
  for (let i = 1; i < beatsMs.length; i += 1) {
    const d = Math.abs(beatsMs[i] - t);
    if (d < bestDiff) {
      bestDiff = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function nearestGridMs(targetMs, baseMs, stepMs) {
  if (!Number.isFinite(stepMs) || stepMs <= 0) return Math.max(0, Math.round(Number(targetMs) || 0));
  const t = Math.max(0, Number(targetMs) || 0);
  const k = Math.round((t - baseMs) / stepMs);
  return Math.max(0, Math.round(baseMs + k * stepMs));
}

function median(values) {
  const arr = values
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!arr.length) return 0;
  const m = Math.floor(arr.length / 2);
  if (arr.length % 2) return arr[m];
  return (arr[m - 1] + arr[m]) / 2;
}

function beatDistance(aBeatInBar, bBeatInBar) {
  const a = Number(aBeatInBar);
  const b = Number(bBeatInBar);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > 4 || b < 1 || b > 4) return 1;
  const d = (b - a + 4) % 4;
  if (d === 0) return 4;
  if (d === 3) return 0;
  return d;
}

function deriveTempoFromBarHints(rawHintEvents) {
  const anchors = rawHintEvents
    .map((h) => ({
      ms: Math.max(0, Math.round(Number(h.tSec) * 1000)),
      beatInBar: h.type === "hint/barBeat" ? Number(h?.payload?.beatInBar) : undefined
    }))
    .filter((x) => Number.isFinite(x.ms) && Number.isInteger(x.beatInBar))
    .sort((a, b) => a.ms - b.ms);
  const candidates = [];
  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchors[i - 1];
    const cur = anchors[i];
    const dt = cur.ms - prev.ms;
    if (!(dt > 90)) continue;
    const beatsBetween = beatDistance(prev.beatInBar, cur.beatInBar);
    if (!beatsBetween) continue;
    const tempo = dt / beatsBetween;
    if (tempo >= 220 && tempo <= 1600) candidates.push(tempo);
  }
  const tempoMs = median(candidates);
  return Number.isFinite(tempoMs) && tempoMs > 0 ? tempoMs : 0;
}

function generateGridFromTempo({ tempoMs, anchorMs, minMs, maxMs }) {
  if (!(tempoMs > 0)) return [];
  const startK = Math.floor((minMs - anchorMs) / tempoMs) - 2;
  const endK = Math.ceil((maxMs - anchorMs) / tempoMs) + 2;
  const out = [];
  for (let k = startK; k <= endK; k += 1) {
    const ms = Math.round(anchorMs + k * tempoMs);
    if (ms < 0) continue;
    if (ms < minMs - 40 || ms > maxMs + 40) continue;
    out.push(ms);
  }
  return uniqSortedMs(out);
}

function mod4(n) {
  return ((n % 4) + 4) % 4;
}

function nearestPhaseIndex(rawN, targetPhase) {
  let best = rawN;
  let bestDist = Number.POSITIVE_INFINITY;
  const base = rawN - mod4(rawN - targetPhase);
  const candidates = [base - 4, base, base + 4];
  for (const n of candidates) {
    const d = Math.abs(n - rawN);
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}

function canonicalizeBarHints(rawHintEvents, tempoMs, anchorDownbeatMs) {
  const barHints = rawHintEvents
    .filter((h) => h.type === "hint/barBeat")
    .map((h) => ({
      at: String(h?.at || ""),
      ms: Math.max(0, Math.round(Number(h.tSec) * 1000)),
      beatInBar: Number(h?.payload?.beatInBar)
    }))
    .filter((x) => Number.isInteger(x.beatInBar) && x.beatInBar >= 1 && x.beatInBar <= 4)
    .sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  const byBeatIndex = new Map();
  for (const h of barHints) {
    const rawN = Math.round((h.ms - anchorDownbeatMs) / tempoMs);
    const n = nearestPhaseIndex(rawN, h.beatInBar - 1);
    byBeatIndex.set(n, { ...h, n, snappedMs: Math.round(anchorDownbeatMs + n * tempoMs) });
  }
  return Array.from(byBeatIndex.values()).sort((a, b) => a.n - b.n);
}

function deriveTempoFromCanonicalBarHints(canonical) {
  const cands = [];
  for (let i = 1; i < canonical.length; i += 1) {
    const a = canonical[i - 1];
    const b = canonical[i];
    const dn = b.n - a.n;
    const dt = b.ms - a.ms;
    if (!(dn > 0) || !(dt > 90)) continue;
    const msPerBeat = dt / dn;
    if (msPerBeat >= 220 && msPerBeat <= 1600) cands.push(msPerBeat);
  }
  const m = median(cands);
  return Number.isFinite(m) && m > 0 ? m : 0;
}

function measureIndexFor(n, beatInBar) {
  const b = Math.max(1, Math.min(4, Number(beatInBar) || 1));
  return Math.floor((n - (b - 1)) / 4);
}

function normalizeIsoAt(v) {
  const s = String(v || "");
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function canonicalizeBarHintsByMeasure(rawHintEvents, tempoMs, anchorDownbeatMs) {
  const barHints = rawHintEvents
    .filter((h) => h.type === "hint/barBeat")
    .map((h, idx) => ({
      idx,
      at: String(h?.at || ""),
      atMs: normalizeIsoAt(h?.at),
      ms: Math.max(0, Math.round(Number(h.tSec) * 1000)),
      beatInBar: Number(h?.payload?.beatInBar)
    }))
    .filter((x) => Number.isInteger(x.beatInBar) && x.beatInBar >= 1 && x.beatInBar <= 4);
  const bySlot = new Map();
  for (const h of barHints) {
    const rawN = Math.round((h.ms - anchorDownbeatMs) / tempoMs);
    const n = nearestPhaseIndex(rawN, h.beatInBar - 1);
    const measureIndex = measureIndexFor(n, h.beatInBar);
    const key = `${measureIndex}:${h.beatInBar}`;
    const prev = bySlot.get(key);
    const cur = { ...h, n, measureIndex, snappedMs: Math.round(anchorDownbeatMs + n * tempoMs) };
    if (!prev) {
      bySlot.set(key, cur);
      continue;
    }
    const newer = cur.atMs > prev.atMs || (cur.atMs === prev.atMs && cur.idx >= prev.idx);
    if (newer) bySlot.set(key, cur);
  }
  return Array.from(bySlot.values()).sort((a, b) => a.n - b.n);
}

function pickConfirmedDownbeatAnchors(barHints, tempoMs) {
  const hints = Array.isArray(barHints) ? barHints : [];
  const ones = hints.filter((h) => Number(h.beatInBar) === 1).sort((a, b) => a.ms - b.ms);
  if (!ones.length) return [];
  if (!(tempoMs > 0)) return ones.map((h) => h.ms);
  const confirmed = [];
  for (let i = 0; i < ones.length; i += 1) {
    const one = ones[i];
    const windowEnd = one.ms + tempoMs * 4.6;
    let got2 = false;
    let got3 = false;
    let got4 = false;
    for (const h of hints) {
      if (h.ms < one.ms - 40 || h.ms > windowEnd) continue;
      const b = Number(h.beatInBar);
      if (b === 2) got2 = true;
      if (b === 3) got3 = true;
      if (b === 4) got4 = true;
    }
    if (i === 0 || (got2 && got3) || (got2 && got4) || (got3 && got4)) confirmed.push(one.ms);
  }
  return confirmed.length ? uniqSortedMs(confirmed) : uniqSortedMs(ones.map((h) => h.ms));
}

function generatePiecewiseTempoGrid({ tempoMs, anchorsMs, minMs, maxMs }) {
  if (!(tempoMs > 0)) return [];
  const anchors = uniqSortedMs(anchorsMs || []);
  if (!anchors.length) return [];
  const rangeMin = Math.max(0, Math.round(Number(minMs) || 0));
  const rangeMax = Math.max(rangeMin, Math.round(Number(maxMs) || 0));
  const out = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i];
    const segStart = i === 0 ? rangeMin : anchor;
    const segEnd = i < anchors.length - 1 ? Math.max(segStart, anchors[i + 1] - 1) : rangeMax;
    const kStart = Math.ceil((segStart - anchor) / tempoMs);
    const kEnd = Math.floor((segEnd - anchor) / tempoMs);
    for (let k = kStart; k <= kEnd; k += 1) {
      const ms = Math.round(anchor + k * tempoMs);
      if (ms < rangeMin || ms > rangeMax) continue;
      out.push(ms);
    }
  }
  return uniqSortedMs(out);
}

function medianBeatStepMs(beatsMs) {
  if (!Array.isArray(beatsMs) || beatsMs.length < 2) return 0;
  const deltas = [];
  for (let i = 1; i < beatsMs.length; i += 1) {
    const d = Number(beatsMs[i]) - Number(beatsMs[i - 1]);
    if (Number.isFinite(d) && d > 40 && d < 5000) deltas.push(d);
  }
  const m = median(deltas);
  return Number.isFinite(m) && m > 0 ? m : 0;
}

function clusterHintWindowsMs(hints, tempoMs) {
  const points = (Array.isArray(hints) ? hints : [])
    .map((h) => Math.max(0, Math.round(Number(h?.ms))))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (!points.length) return [];
  const joinGap = Math.max(tempoMs * 6, 1800);
  const pad = Math.max(tempoMs * 2, 600);
  const windows = [];
  let start = points[0];
  let end = points[0];
  for (let i = 1; i < points.length; i += 1) {
    if (points[i] - end <= joinGap) {
      end = points[i];
    } else {
      windows.push({ startMs: Math.max(0, Math.round(start - pad)), endMs: Math.round(end + pad) });
      start = points[i];
      end = points[i];
    }
  }
  windows.push({ startMs: Math.max(0, Math.round(start - pad)), endMs: Math.round(end + pad) });
  return windows;
}

function inAnyWindow(ms, windows) {
  for (const w of windows) {
    if (ms >= w.startMs && ms <= w.endMs) return true;
  }
  return false;
}

function setHintTimesMs(rawHintEvents) {
  return (Array.isArray(rawHintEvents) ? rawHintEvents : [])
    .map((h) => {
      const isSet = h?.type === "hint/downbeat"
        || (h?.type === "hint/barBeat" && Number(h?.payload?.beatInBar) === 1);
      if (!isSet) return NaN;
      return Math.max(0, Math.round(Number(h.tSec) * 1000));
    })
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

function extendWindowsToNextSet(windows, setTimesMs, rangeMaxMs) {
  const sets = Array.isArray(setTimesMs) ? setTimesMs : [];
  const maxMs = Math.max(0, Math.round(Number(rangeMaxMs) || 0));
  const out = [];
  for (const w of Array.isArray(windows) ? windows : []) {
    let endMs = Math.max(w.startMs, Math.min(maxMs, w.endMs));
    const nextSet = sets.find((s) => s > w.endMs + 40);
    if (Number.isFinite(nextSet)) endMs = Math.max(endMs, Math.min(maxMs, Math.round(nextSet)));
    else endMs = maxMs;
    out.push({ startMs: Math.max(0, Math.round(w.startMs)), endMs: Math.max(0, Math.round(endMs)) });
  }
  return out;
}

function hasNearMs(sortedMs, targetMs, tolMs) {
  if (!Array.isArray(sortedMs) || !sortedMs.length) return false;
  const t = Math.max(0, Math.round(Number(targetMs) || 0));
  const tol = Math.max(0, Math.round(Number(tolMs) || 0));
  for (const ms of sortedMs) {
    if (Math.abs(ms - t) <= tol) return true;
  }
  return false;
}

function blendAiWithTempoGridGlobal(beatsMs, gridMs, tempoMs) {
  const ai = uniqSortedMs(beatsMs || []);
  const grid = uniqSortedMs(gridMs || []);
  if (!grid.length) return ai;
  if (!ai.length) return grid;

  const keepTol = Math.max(35, Math.round(tempoMs * 0.12));
  const insertTol = Math.max(45, Math.round(tempoMs * 0.16));
  const mixed = [];
  for (const ms of ai) {
    const g = nearestBeatMs(ms, grid);
    mixed.push(Math.abs(ms - g) <= keepTol ? ms : g);
  }
  const out = uniqSortedMs(mixed);
  for (const g of grid) {
    if (!hasNearMs(ai, g, insertTol) && !hasNearMs(out, g, insertTol)) {
      out.push(g);
    }
  }
  return uniqSortedMs(out);
}

function detectSubdivisionFactor(establishedTempoMs, aiStepMs) {
  if (!(establishedTempoMs > 0) || !(aiStepMs > 0)) return 1;
  const r = establishedTempoMs / aiStepMs;
  const factors = [2, 3, 4];
  let best = 1;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const k of factors) {
    const d = Math.abs(r - k);
    if (d < bestDiff) {
      best = k;
      bestDiff = d;
    }
  }
  const tol = 0.22;
  return bestDiff <= tol ? best : 1;
}

function primaryAiBeatsAgainstGrid(aiBeatsMs, gridMs, tempoMs) {
  const ai = uniqSortedMs(aiBeatsMs || []);
  const grid = uniqSortedMs(gridMs || []);
  if (!ai.length || !grid.length) return ai;
  const assignTol = Math.max(80, Math.round(tempoMs * 0.28));
  const byGrid = new Map();
  for (const a of ai) {
    const g = nearestBeatMs(a, grid);
    const dist = Math.abs(a - g);
    if (dist > assignTol) continue;
    const prev = byGrid.get(g);
    if (!prev || dist < prev.dist) byGrid.set(g, { ms: a, dist });
  }
  return uniqSortedMs(Array.from(byGrid.values()).map((x) => x.ms));
}

function hintOverlaysFromEvents(events) {
  const overlays = [];
  for (const e of events) {
    const type = String(e?.type || "");
    if (!KNOWN_HINT_TYPES.has(type)) continue;
    const tSec = Number(e?.tSec);
    if (!Number.isFinite(tSec) || tSec < 0) continue;
    const row = {
      type,
      tSec,
      payload: e?.payload && typeof e.payload === "object" ? e.payload : {},
      at: String(e?.at || ""),
      actor: String(e?.actor || "")
    };
    overlays.push(row);
  }
  overlays.sort((a, b) => a.tSec - b.tSec);
  return overlays;
}

export function reduceEffectiveState({
  trackId,
  workId,
  beats,
  words,
  events,
  lockedTempoBpm
}) {
  const beatsMs = normalizeMsList(beats?.beatTimesMs);
  const downbeatMs = normalizeMsList(beats?.downbeatTimesMs);
  const rawHintEvents = hintOverlaysFromEvents(events);
  const rawBarHints = rawHintEvents.filter((h) => h.type === "hint/barBeat");
  const singleSetHintSnapMode = (() => {
    if (rawHintEvents.length !== 1) return false;
    const h = rawHintEvents[0];
    if (h.type === "hint/downbeat") return beatsMs.length > 0;
    if (h.type === "hint/barBeat" && Number(h?.payload?.beatInBar) === 1) return beatsMs.length > 0;
    return false;
  })();
  const hintBeatMs = [];
  const hintDownbeatMs = [];
  const hintBarBeats = [];
  const hintEvents = [];
  let lastHintAt = rawHintEvents.reduce((best, h) => {
    const at = String(h?.at || "");
    if (!at) return best;
    return !best || at > best ? at : best;
  }, "");
  let establishedTempoMs = deriveTempoFromBarHints(rawHintEvents);
  const lockedTempoMs = Number.isFinite(Number(lockedTempoBpm)) && Number(lockedTempoBpm) > 0
    ? 60000 / Number(lockedTempoBpm)
    : 0;
  const rawMinMs = rawHintEvents.length ? Math.min(...rawHintEvents.map((h) => Math.max(0, Math.round(Number(h.tSec) * 1000)))) : 0;
  const rawMaxMs = rawHintEvents.length ? Math.max(...rawHintEvents.map((h) => Math.max(0, Math.round(Number(h.tSec) * 1000)))) : 0;
  let tempoMode = rawBarHints.length >= 2 && establishedTempoMs > 0;
  const firstBar = rawBarHints[0];
  let anchorDownbeatMs = 0;
  let canonicalBarHints = [];
  if (tempoMode && firstBar) {
    const firstMs = Math.max(0, Math.round(Number(firstBar.tSec) * 1000));
    const firstBeatInBar = Number(firstBar?.payload?.beatInBar);
    anchorDownbeatMs = Math.round(firstMs - (Math.max(1, Math.min(4, firstBeatInBar || 1)) - 1) * establishedTempoMs);
    if (anchorDownbeatMs < 0) anchorDownbeatMs = 0;
    for (let i = 0; i < 3; i += 1) {
      canonicalBarHints = canonicalizeBarHintsByMeasure(rawHintEvents, establishedTempoMs, anchorDownbeatMs);
      if (canonicalBarHints.length >= 2) {
        const refined = deriveTempoFromCanonicalBarHints(canonicalBarHints);
        if (refined > 0) establishedTempoMs = refined;
      }
      const firstCanonical = canonicalBarHints.find((x) => x.beatInBar === 1) || canonicalBarHints[0];
      if (firstCanonical) {
        anchorDownbeatMs = Math.round(firstCanonical.ms - (firstCanonical.beatInBar - 1) * establishedTempoMs);
        if (anchorDownbeatMs < 0) anchorDownbeatMs = 0;
      }
    }
    canonicalBarHints = canonicalizeBarHintsByMeasure(rawHintEvents, establishedTempoMs, anchorDownbeatMs);
    tempoMode = canonicalBarHints.length >= 2 && establishedTempoMs > 0;
  }
  if (tempoMode && lockedTempoMs > 0 && establishedTempoMs > 0) {
    const closeTol = Math.max(20, Math.round(establishedTempoMs * 0.06));
    if (Math.abs(lockedTempoMs - establishedTempoMs) <= closeTol) {
      establishedTempoMs = lockedTempoMs;
    }
  }

  for (const h of rawHintEvents) {
    if (h.type === "hint/barBeat" && tempoMode) continue;
    const rawMs = Math.max(0, Math.round(Number(h.tSec) * 1000));
    let ms = rawMs;
    if (singleSetHintSnapMode && beatsMs.length > 0) {
      if (h.type === "hint/downbeat") ms = nearestBeatMs(rawMs, beatsMs);
      if (h.type === "hint/barBeat" && Number(h?.payload?.beatInBar) === 1) {
        ms = nearestBeatMs(rawMs, beatsMs);
      }
    }
    const snapped = {
      ...h,
      tSec: ms / 1000,
      payload: {
        ...(h?.payload && typeof h.payload === "object" ? h.payload : {}),
        rawTSec: rawMs / 1000
      }
    };
    hintEvents.push(snapped);
    if (h.type === "hint/beat") hintBeatMs.push(ms);
    if (h.type === "hint/downbeat") {
      hintBeatMs.push(ms);
      hintDownbeatMs.push(ms);
    }
  }

  const resolvedBarHints = tempoMode
    ? canonicalBarHints
    : rawBarHints
      .map((h) => ({
        at: String(h?.at || ""),
        ms: Math.max(0, Math.round(Number(h.tSec) * 1000)),
        beatInBar: Number(h?.payload?.beatInBar)
      }))
      .filter((h) => Number.isInteger(h.beatInBar) && h.beatInBar >= 1 && h.beatInBar <= 4);

  for (const h of resolvedBarHints) {
    let ms = Math.max(0, Math.round(Number(h.ms)));
    if (singleSetHintSnapMode && beatsMs.length > 0 && Number(h.beatInBar) === 1) {
      ms = nearestBeatMs(ms, beatsMs);
    }
    const beatInBar = Number(h.beatInBar);
    hintBarBeats.push({ tSec: ms / 1000, beatInBar });
    hintBeatMs.push(ms);
    if (beatInBar === 1) hintDownbeatMs.push(ms);
    hintEvents.push({
      type: "hint/barBeat",
      tSec: ms / 1000,
      payload: { beatInBar, rawTSec: h.ms / 1000 },
      at: String(h.at || ""),
      actor: "user"
    });
  }

  let effectiveBeats = uniqSortedMs([...beatsMs, ...hintBeatMs]);
  let aiReferenceBeats = uniqSortedMs(beatsMs);
  let beatFusionMode = tempoMode ? "tempo-override-grid" : "ai-plus-snapped-hints";
  let subdivisionFactor = 1;
  let tempoOverrideWindows = [];
  let fusionWindows = [];
  if (tempoMode) {
    const rangeMin = beatsMs.length ? Math.min(beatsMs[0], rawMinMs) : rawMinMs;
    const rangeMax = beatsMs.length ? Math.max(beatsMs[beatsMs.length - 1], rawMaxMs) : rawMaxMs;
    const downbeatHintAnchorsMs = pickConfirmedDownbeatAnchors(resolvedBarHints, establishedTempoMs);
    const anchorSetMs = uniqSortedMs(
      downbeatHintAnchorsMs.length ? downbeatHintAnchorsMs : [anchorDownbeatMs]
    );
    const grid = generatePiecewiseTempoGrid({
      tempoMs: establishedTempoMs,
      anchorsMs: anchorSetMs,
      minMs: Math.max(0, rangeMin),
      maxMs: Math.max(Math.max(0, rangeMin), rangeMax)
    });
    if (grid.length) {
      const aiStepMs = medianBeatStepMs(beatsMs);
      subdivisionFactor = detectSubdivisionFactor(establishedTempoMs, aiStepMs);
      const tempoCloseToAi = aiStepMs > 0
        && Math.abs(establishedTempoMs - aiStepMs) <= Math.max(40, aiStepMs * 0.12);
      const hasStructuredMeasureHints = rawBarHints.some((h) => {
        const b = Number(h?.payload?.beatInBar);
        return Number.isInteger(b) && b >= 2 && b <= 4;
      });
      if (hasStructuredMeasureHints && beatsMs.length > 0) {
        const rawHintWindows = clusterHintWindowsMs(resolvedBarHints, establishedTempoMs);
        const setTimes = setHintTimesMs(rawHintEvents);
        tempoOverrideWindows = extendWindowsToNextSet(rawHintWindows, setTimes, Math.max(Math.max(0, rangeMin), rangeMax));
        aiReferenceBeats = subdivisionFactor > 1
          ? primaryAiBeatsAgainstGrid(beatsMs, grid, establishedTempoMs)
          : uniqSortedMs(beatsMs);
        const mixed = [];
        for (const ms of aiReferenceBeats) {
          if (!inAnyWindow(ms, tempoOverrideWindows)) mixed.push(ms);
        }
        for (const ms of grid) {
          if (inAnyWindow(ms, tempoOverrideWindows)) mixed.push(ms);
        }
        effectiveBeats = uniqSortedMs(mixed);
        beatFusionMode = "tempo-override-windowed";
        fusionWindows = tempoOverrideWindows;
      } else if (tempoCloseToAi && beatsMs.length > 0 && resolvedBarHints.length > 0) {
        const windows = clusterHintWindowsMs(resolvedBarHints, establishedTempoMs);
        const mixed = [];
        for (const ms of beatsMs) {
          if (!inAnyWindow(ms, windows)) mixed.push(ms);
        }
        for (const ms of grid) {
          if (inAnyWindow(ms, windows)) mixed.push(ms);
        }
        effectiveBeats = uniqSortedMs(mixed);
        beatFusionMode = "ai-with-local-overrides";
        fusionWindows = windows;
      } else {
        effectiveBeats = grid;
        beatFusionMode = anchorSetMs.length > 1 ? "tempo-override-piecewise" : "tempo-override-grid";
        aiReferenceBeats = subdivisionFactor > 1
          ? primaryAiBeatsAgainstGrid(beatsMs, grid, establishedTempoMs)
          : uniqSortedMs(beatsMs);
        fusionWindows = [];
      }
    }
  }
  const controlEvents = [];
  for (const h of hintEvents) {
    const rawControlTSec = Number(h?.payload?.rawTSec);
    const controlMs = Math.max(
      0,
      Math.round((Number.isFinite(rawControlTSec) ? rawControlTSec : Number(h.tSec)) * 1000)
    );
    if (h.type === "hint/downbeat") {
      controlEvents.push({
        kind: "set",
        ms: controlMs,
        atMs: normalizeIsoAt(h.at),
        seq: controlEvents.length
      });
      continue;
    }
    if (h.type === "hint/beat") {
      controlEvents.push({
        kind: "clear",
        ms: controlMs,
        atMs: normalizeIsoAt(h.at),
        seq: controlEvents.length
      });
      continue;
    }
    if (h.type === "hint/barBeat" && Number(h?.payload?.beatInBar) === 1) {
      controlEvents.push({
        kind: "set",
        ms: controlMs,
        atMs: normalizeIsoAt(h.at),
        seq: controlEvents.length
      });
    }
  }
  const mappedControlsRaw = controlEvents
    .map((c) => {
      const idx = nearestBeatIndex(c.ms, effectiveBeats);
      return idx >= 0 ? { ...c, idx } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.idx !== b.idx) return a.idx - b.idx;
      if (a.atMs !== b.atMs) return a.atMs - b.atMs;
      return a.seq - b.seq;
    });
  const controlByIdx = new Map();
  for (const c of mappedControlsRaw) {
    controlByIdx.set(c.idx, c);
  }
  const mappedControls = Array.from(controlByIdx.values()).sort((a, b) => a.idx - b.idx);
  const downbeatMask = new Array(effectiveBeats.length).fill(false);
  const explicitSetDownbeats = [];
  if (mappedControls.length > 0 && mappedControls[0].kind === "set") {
    const firstIdx = mappedControls[0].idx;
    for (let bi = firstIdx; bi >= 0; bi -= 1) {
      if (((firstIdx - bi) % 4 + 4) % 4 === 0) downbeatMask[bi] = true;
    }
  }
  for (let i = 0; i < mappedControls.length; i += 1) {
    const c = mappedControls[i];
    const startIdx = c.idx;
    const next = mappedControls[i + 1];
    const endIdx = next ? Math.max(startIdx, next.idx - 1) : effectiveBeats.length - 1;
    if (c.kind !== "set") continue;
    explicitSetDownbeats.push(effectiveBeats[startIdx]);
    for (let bi = startIdx; bi <= endIdx; bi += 1) {
      if (((bi - startIdx) % 4 + 4) % 4 === 0) downbeatMask[bi] = true;
    }
  }
  const effectiveDownbeats = effectiveBeats.filter((_, i) => downbeatMask[i]);
  const survivingHintDownbeats = uniqSortedMs(explicitSetDownbeats);
  const activeDownbeatAnchors = survivingHintDownbeats.map((ms) => ({ ms, beatInBar: 1 }));
  const hasUserHints = hintEvents.length > 0;
  const explicitHintBeatIdxSet = new Set();
  for (const h of hintEvents) {
    if (!(h.type === "hint/beat" || h.type === "hint/downbeat" || h.type === "hint/barBeat")) continue;
    const rawTSec = Number(h?.payload?.rawTSec);
    const tSec = Number.isFinite(rawTSec) ? rawTSec : Number(h.tSec);
    const idx = nearestBeatIndex(Math.max(0, Math.round(tSec * 1000)), effectiveBeats);
    if (idx >= 0) explicitHintBeatIdxSet.add(idx);
  }
  const explicitSetDownbeatIdxSet = new Set(
    mappedControls.filter((c) => c.kind === "set").map((c) => c.idx)
  );
  const beatMarkers = effectiveBeats.map((ms, idx) => ({
    tMs: ms,
    source: explicitHintBeatIdxSet.has(idx) ? "hint" : "inferred"
  }));
  const downbeatMarkers = [];
  const aiAlignTol = Math.max(40, Math.round((establishedTempoMs || medianBeatStepMs(effectiveBeats) || 500) * 0.12));
  for (let i = 0; i < effectiveBeats.length; i += 1) {
    if (!downbeatMask[i]) continue;
    const isHint = explicitSetDownbeatIdxSet.has(i);
    const alignedToAi = hasNearMs(aiReferenceBeats, effectiveBeats[i], aiAlignTol);
    const inOverrideWindow = inAnyWindow(effectiveBeats[i], tempoOverrideWindows);
    let source = "inferred";
    if (isHint) source = "hint";
    else if (
      inOverrideWindow
      || beatFusionMode === "ai-tempo-overlay-global"
      || beatFusionMode === "tempo-override-piecewise"
      || beatFusionMode === "tempo-override-grid"
    ) {
      // In tempo-established modes, non-hint downbeats are always pattern-inferred;
      // color indicates whether timing was corrected away from AI beat positions.
      source = alignedToAi ? "inferred" : "corrected";
    } else {
      // In AI-driven modes, highlight aligned inferred downbeats as AI.
      source = alignedToAi ? "ai" : "inferred";
    }
    downbeatMarkers.push({
      tMs: effectiveBeats[i],
      source
    });
  }
  const aiDownbeatMarkers = [];
  // Only show AI downbeat debug overlay when reducer is actually using AI beat timing.
  // In full tempo-override modes, AI downbeat markers are misleading (e.g. AI double-time).
  if (beatFusionMode === "ai-with-local-overrides") {
    const aiDownbeatsRaw = normalizeMsList(beats?.downbeatTimesMs);
    if (aiDownbeatsRaw.length) {
      for (const ms of aiDownbeatsRaw) {
        aiDownbeatMarkers.push({ tMs: ms, source: "ai" });
      }
    } else if (beatsMs.length > 0) {
      let firstSetMs = NaN;
      for (const c of mappedControls) {
        if (c.kind === "set") {
          firstSetMs = Number(c.ms);
          break;
        }
      }
      if (Number.isFinite(firstSetMs)) {
        const aiAnchorIdx = nearestBeatIndex(firstSetMs, beatsMs);
        if (aiAnchorIdx >= 0) {
          const phase = ((aiAnchorIdx % 4) + 4) % 4;
          for (let i = 0; i < beatsMs.length; i += 1) {
            if ((((i - phase) % 4) + 4) % 4 === 0) {
              aiDownbeatMarkers.push({ tMs: beatsMs[i], source: "ai" });
            }
          }
        }
      }
    }
  }

  const effective = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    trackId: String(trackId || ""),
    workId: String(workId || ""),
    derived: {
      beatsMs,
      downbeatTimesMs: downbeatMs,
      wordsCount: Array.isArray(words?.words) ? words.words.length : 0
    },
    hints: {
      eventsCount: hintEvents.length,
      lastHintAt: lastHintAt || "",
      downbeatAnchorsCount: activeDownbeatAnchors.length,
      establishedTempoMs: establishedTempoMs || 0,
      subdivisionFactor,
      lockedTempoBpm: Number.isFinite(Number(lockedTempoBpm)) ? Number(lockedTempoBpm) : 0,
      beatFusionMode,
      fusionWindowsSec: fusionWindows.map((w) => ({
        t0Sec: Number(w.startMs) / 1000,
        t1Sec: Number(w.endMs) / 1000
      })),
      beatsSec: hintBeatMs.map((ms) => ms / 1000),
      downbeatsSec: survivingHintDownbeats.map((ms) => ms / 1000),
      barBeats: hintBarBeats
    },
    effective: {
      beatsMs: effectiveBeats,
      downbeatTimesMs: effectiveDownbeats,
      beatMarkers,
      downbeatMarkers,
      aiDownbeatMarkers
    },
    overlays: hintEvents
  };

  return {
    effective,
    summary: {
      hasUserHints,
      lastHintAt: lastHintAt || ""
    }
  };
}

export function reduceTrackToEffective({
  repoRoot,
  trackId,
  workId,
  assetDir
}) {
  if (!assetDir) throw new Error("assetDir is required");
  const assetDirAbs = path.resolve(assetDir);
  const beatsPath = path.join(assetDirAbs, "beats.json");
  const wordsPath = path.join(assetDirAbs, "words.json");
  const eventsPath = path.join(assetDirAbs, "events.jsonl");
  const effectivePath = path.join(assetDirAbs, "effective.json");
  const tracksRoot = path.join(path.resolve(repoRoot || "."), "tracks");
  const trackPath = trackId ? path.join(tracksRoot, `${trackId}.track.json`) : "";
  const trackMeta = trackPath && fs.existsSync(trackPath) ? (readJsonIfExists(trackPath) || {}) : {};
  const lockedTempoBpm = Number(trackMeta?.import?.filenameBpm);
  const beats = readJsonIfExists(beatsPath) || {};
  const words = readJsonIfExists(wordsPath) || {};
  const events = readEventsJsonl(eventsPath);
  const reduced = reduceEffectiveState({ trackId, workId, beats, words, events, lockedTempoBpm });
  writeJson(effectivePath, reduced.effective);

  if (trackId && fs.existsSync(trackPath)) {
    const track = readJsonIfExists(trackPath) || {};
    track.hasUserHints = Boolean(reduced.summary.hasUserHints);
    track.lastHintAt = reduced.summary.lastHintAt || "";
    track.assetPaths = track.assetPaths && typeof track.assetPaths === "object" ? track.assetPaths : {};
    track.assetPaths.effective = toPosix(path.relative(path.resolve(repoRoot || "."), effectivePath));
    writeJson(trackPath, track);
  }

  return {
    effectivePath,
    eventsPath,
    summary: reduced.summary
  };
}
