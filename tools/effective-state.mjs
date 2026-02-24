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
  events
}) {
  const beatsMs = normalizeMsList(beats?.beatTimesMs);
  const downbeatMs = normalizeMsList(beats?.downbeatTimesMs);
  const rawHintEvents = hintOverlaysFromEvents(events);
  const hintBeatMs = [];
  const hintDownbeatMs = [];
  const hintBarBeats = [];
  const downbeatAnchors = [];
  const hintEvents = [];
  let lastHintAt = "";

  for (const h of rawHintEvents) {
    const rawMs = Math.max(0, Math.round(Number(h.tSec) * 1000));
    const ms = beatsMs.length ? nearestBeatMs(rawMs, beatsMs) : rawMs;
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
      hintDownbeatMs.push(ms);
      downbeatAnchors.push({ ms, beatInBar: 1 });
    }
    if (h.type === "hint/barBeat") {
      const beatInBar = Number(h?.payload?.beatInBar);
      if (Number.isInteger(beatInBar) && beatInBar >= 1 && beatInBar <= 4) {
        hintBarBeats.push({ tSec: ms / 1000, beatInBar });
        hintBeatMs.push(ms);
        downbeatAnchors.push({ ms, beatInBar });
        if (beatInBar === 1) hintDownbeatMs.push(ms);
      }
    }
    if (h.at && (!lastHintAt || h.at > lastHintAt)) lastHintAt = h.at;
  }

  const effectiveBeats = uniqSortedMs([...beatsMs, ...hintBeatMs]);
  let propagatedDownbeats = [];
  if (effectiveBeats.length > 0 && downbeatAnchors.length > 0) {
    const anchorIndices = downbeatAnchors
      .map((a) => {
        const idx = nearestBeatIndex(a.ms, effectiveBeats);
        if (idx < 0) return null;
        const downbeatIdx = idx - (Math.max(1, Math.min(4, Number(a.beatInBar) || 1)) - 1);
        return { idx: downbeatIdx };
      })
      .filter(Boolean);
    if (anchorIndices.length > 0) {
      for (let i = 0; i < effectiveBeats.length; i += 1) {
        let nearest = anchorIndices[0];
        let nearestDist = Math.abs(i - nearest.idx);
        for (let k = 1; k < anchorIndices.length; k += 1) {
          const a = anchorIndices[k];
          const d = Math.abs(i - a.idx);
          if (d < nearestDist) {
            nearest = a;
            nearestDist = d;
          }
        }
        if (((i - nearest.idx) % 4 + 4) % 4 === 0) propagatedDownbeats.push(effectiveBeats[i]);
      }
    }
  }
  const effectiveDownbeats = downbeatAnchors.length
    ? uniqSortedMs([...propagatedDownbeats, ...hintDownbeatMs])
    : [];
  const hasUserHints = hintEvents.length > 0;

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
      downbeatAnchorsCount: downbeatAnchors.length,
      beatsSec: hintBeatMs.map((ms) => ms / 1000),
      downbeatsSec: hintDownbeatMs.map((ms) => ms / 1000),
      barBeats: hintBarBeats
    },
    effective: {
      beatsMs: effectiveBeats,
      downbeatTimesMs: effectiveDownbeats
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
  const beats = readJsonIfExists(beatsPath) || {};
  const words = readJsonIfExists(wordsPath) || {};
  const events = readEventsJsonl(eventsPath);
  const reduced = reduceEffectiveState({ trackId, workId, beats, words, events });
  writeJson(effectivePath, reduced.effective);

  const tracksRoot = path.join(path.resolve(repoRoot || "."), "tracks");
  const trackPath = path.join(tracksRoot, `${trackId}.track.json`);
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
