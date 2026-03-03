import fs from "node:fs";
import path from "node:path";

function readJson(filePath) {
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

function uniqSortedMs(values) {
  const xs = (Array.isArray(values) ? values : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.max(0, Math.round(n)))
    .sort((a, b) => a - b);
  const out = [];
  for (const n of xs) {
    if (!out.length || Math.abs(out[out.length - 1] - n) > 12) out.push(n);
  }
  return out;
}

function nearestFrom(targetMs, listMs) {
  const t = Math.max(0, Math.round(Number(targetMs) || 0));
  const xs = Array.isArray(listMs) ? listMs : [];
  if (!xs.length) return t;
  let best = Number(xs[0]);
  let bestDiff = Math.abs(best - t);
  for (let i = 1; i < xs.length; i += 1) {
    const x = Number(xs[i]);
    const d = Math.abs(x - t);
    if (d < bestDiff) {
      best = x;
      bestDiff = d;
    }
  }
  return Math.max(0, Math.round(best));
}

function main() {
  const repoRoot = path.resolve(".");
  const tracksDir = path.join(repoRoot, "tracks");
  const trackFiles = fs.readdirSync(tracksDir).filter((x) => x.endsWith(".track.json")).sort();
  const exportedAt = new Date().toISOString();

  let total = 0;
  let withMarkers = 0;
  let withoutMarkers = 0;

  for (const file of trackFiles) {
    total += 1;
    const trackPath = path.join(tracksDir, file);
    const track = readJson(trackPath) || {};
    const trackId = String(track?.trackId || file.replace(/\.track\.json$/i, ""));
    const workId = String(track?.workId || "");
    const title = String(track?.title || "");
    const assetDir = String(track?.assetDir || "");
    if (!assetDir) continue;

    const assetAbs = path.resolve(repoRoot, assetDir);
    const effectivePath = path.join(assetAbs, "effective.json");
    const effective = readJson(effectivePath) || {};
    const markersRaw = Array.isArray(effective?.effective?.sectionMarkers) ? effective.effective.sectionMarkers : [];
    const downbeats = uniqSortedMs(effective?.effective?.downbeatTimesMs);

    const markers = markersRaw
      .map((m, idx) => {
        const rawMs = Math.max(0, Math.round(Number(m?.tMs) || 0));
        if (!Number.isFinite(rawMs)) return null;
        const snappedMs = downbeats.length ? nearestFrom(rawMs, downbeats) : rawMs;
        return {
          order: idx + 1,
          source: String(m?.source || "default") === "hint" ? "hint" : "default",
          rawMs,
          rawSec: Number((rawMs / 1000).toFixed(6)),
          snappedToCurrentDownbeatMs: snappedMs,
          snappedToCurrentDownbeatSec: Number((snappedMs / 1000).toFixed(6))
        };
      })
      .filter(Boolean);

    if (markers.length) withMarkers += 1;
    else withoutMarkers += 1;

    const out = {
      schemaVersion: 1,
      exportedAt,
      trackId,
      workId,
      title,
      assetDir,
      applyPolicy: {
        eventType: "hint/sectionMarker",
        clearExistingSectionMarkersFirst: true,
        snapMode: "nearestDownbeat"
      },
      markers
    };

    writeJson(path.join(assetAbs, "section-markers.save.json"), out);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        exportedAt,
        totalTracks: total,
        withMarkers,
        withoutMarkers,
        fileName: "section-markers.save.json"
      },
      null,
      2
    )
  );
}

main();
