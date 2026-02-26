import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { resolveRecipe } from "../../packages/recipes/resolveRecipe.mjs";
import { appendEventJsonl, buildHintEvent, reduceTrackToEffective } from "../../tools/effective-state.mjs";

const repoRoot = path.resolve(__dirname, "..", "..");
const tracksRoot = path.join(repoRoot, "tracks");
const assetsRoot = path.join(repoRoot, "assets");
const legacyAssetsRoot = path.join(repoRoot, "dev-assets");

function sendFile(req: any, res: any, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const type =
    ext === ".json"
      ? "application/json; charset=utf-8"
      : ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".txt"
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", type);
  const range = req.headers?.range as string | undefined;
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : total - 1;
      const safeStart = Math.max(0, Math.min(start, total - 1));
      const safeEnd = Math.max(safeStart, Math.min(end, total - 1));
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${safeStart}-${safeEnd}/${total}`);
      res.setHeader("Content-Length", String(safeEnd - safeStart + 1));
      fs.createReadStream(filePath, { start: safeStart, end: safeEnd }).pipe(res);
      return;
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(total));
  fs.createReadStream(filePath).pipe(res);
}

function resolveStaticPath(urlPath: string, mount: string, root: string) {
  if (!urlPath.startsWith(mount)) return "";
  const rel = decodeURIComponent(urlPath.slice(mount.length)).replace(/^\/+/, "");
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root)) return "";
  return abs;
}

function sendJson(res: any, statusCode: number, payload: any) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readReqJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      raw += String(chunk || "");
      if (raw.length > 1_000_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function clearEventsFile(eventsPath: string) {
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  fs.writeFileSync(eventsPath, "", "utf8");
}

function undoLastEventGroup(eventsPath: string) {
  if (!fs.existsSync(eventsPath)) return { removed: 0, groupId: "" };
  const raw = fs.readFileSync(eventsPath, "utf8");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return { removed: 0, groupId: "" };

  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });
  let groupId = "";
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    const g = String(parsed[i]?.payload?.groupId || "");
    if (g) {
      groupId = g;
      break;
    }
  }

  let keptLines = lines.slice();
  let removed = 0;
  if (groupId) {
    keptLines = lines.filter((line, i) => {
      const g = String(parsed[i]?.payload?.groupId || "");
      if (g === groupId) {
        removed += 1;
        return false;
      }
      return true;
    });
  } else {
    keptLines = lines.slice(0, -1);
    removed = 1;
  }
  fs.mkdirSync(path.dirname(eventsPath), { recursive: true });
  const next = keptLines.length ? `${keptLines.join("\n")}\n` : "";
  fs.writeFileSync(eventsPath, next, "utf8");
  return { removed, groupId };
}

export default defineConfig(({ mode }) => {
  const authoringMode = mode !== "release";
  const releaseMode = !authoringMode;
  const reduceTimers = new Map<string, NodeJS.Timeout>();
  const scheduleReduce = (trackId: string, workId: string, delayMs = 350) => {
    const key = `${workId}/${trackId}`;
    const prior = reduceTimers.get(key);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      reduceTimers.delete(key);
      try {
        reduceTrackToEffective({
          repoRoot,
          trackId,
          workId,
          assetDir: path.join(assetsRoot, workId, trackId)
        });
      } catch (err) {
        console.warn(`authoring reduce failed (${key}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }, delayMs);
    reduceTimers.set(key, timer);
  };

  return {
    define: {
      __AUTHORING_MODE__: JSON.stringify(authoringMode),
      __RELEASE_MODE__: JSON.stringify(releaseMode)
    },
    server: {
      fs: {
        allow: [repoRoot]
      }
    },
    plugins: [
      {
        name: "repo-static-mounts",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const fullUrl = req.url ?? "";
            const reqPath = fullUrl.split("?")[0];

            if (authoringMode && reqPath === "/authoring/events" && req.method === "POST") {
              try {
                const body = await readReqJson(req);
                const trackId = String(body?.trackId || "");
                const workId = String(body?.workId || "");
                if (!trackId || !workId) {
                  sendJson(res, 400, { error: "trackId and workId are required" });
                  return;
                }
                const assetDir = path.join(assetsRoot, workId, trackId);
                if (!assetDir.startsWith(assetsRoot)) {
                  sendJson(res, 400, { error: "Invalid asset path" });
                  return;
                }
                fs.mkdirSync(assetDir, { recursive: true });
                const event = buildHintEvent(body);
                appendEventJsonl(path.join(assetDir, "events.jsonl"), event);
                scheduleReduce(trackId, workId);
                sendJson(res, 200, { ok: true, event });
              } catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
              }
              return;
            }

            if (authoringMode && reqPath === "/authoring/reduce" && req.method === "POST") {
              try {
                const body = await readReqJson(req);
                const trackId = String(body?.trackId || "");
                const workId = String(body?.workId || "");
                if (!trackId || !workId) {
                  sendJson(res, 400, { error: "trackId and workId are required" });
                  return;
                }
                const out = reduceTrackToEffective({
                  repoRoot,
                  trackId,
                  workId,
                  assetDir: path.join(assetsRoot, workId, trackId)
                });
                sendJson(res, 200, { ok: true, ...out });
              } catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
              }
              return;
            }

            if (authoringMode && reqPath === "/authoring/events/clear" && req.method === "POST") {
              try {
                const body = await readReqJson(req);
                const trackId = String(body?.trackId || "");
                const workId = String(body?.workId || "");
                if (!trackId || !workId) {
                  sendJson(res, 400, { error: "trackId and workId are required" });
                  return;
                }
                const assetDir = path.join(assetsRoot, workId, trackId);
                const eventsPath = path.join(assetDir, "events.jsonl");
                clearEventsFile(eventsPath);
                const out = reduceTrackToEffective({
                  repoRoot,
                  trackId,
                  workId,
                  assetDir
                });
                sendJson(res, 200, { ok: true, ...out });
              } catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
              }
              return;
            }

            if (authoringMode && reqPath === "/authoring/events/undo" && req.method === "POST") {
              try {
                const body = await readReqJson(req);
                const trackId = String(body?.trackId || "");
                const workId = String(body?.workId || "");
                if (!trackId || !workId) {
                  sendJson(res, 400, { error: "trackId and workId are required" });
                  return;
                }
                const assetDir = path.join(assetsRoot, workId, trackId);
                const eventsPath = path.join(assetDir, "events.jsonl");
                const undo = undoLastEventGroup(eventsPath);
                const out = reduceTrackToEffective({
                  repoRoot,
                  trackId,
                  workId,
                  assetDir
                });
                sendJson(res, 200, { ok: true, undo, ...out });
              } catch (err) {
                sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
              }
              return;
            }

            if (reqPath === "/recipes/resolve") {
              const url = new URL(fullUrl, "http://localhost");
              const albumId = url.searchParams.get("albumId") ?? "";
              const trackOverrideId = url.searchParams.get("trackOverrideId") ?? "";
              try {
                const resolved = resolveRecipe({ albumId, trackOverrideId: trackOverrideId || undefined });
                res.statusCode = 200;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify(resolved));
              } catch (err) {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
              }
              return;
            }

            const trackFile = resolveStaticPath(reqPath, "/tracks", tracksRoot);
            if (trackFile && fs.existsSync(trackFile) && fs.statSync(trackFile).isFile()) {
              sendFile(req, res, trackFile);
              return;
            }

            const assetFile = resolveStaticPath(reqPath, "/assets", assetsRoot);
            if (assetFile && fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
              sendFile(req, res, assetFile);
              return;
            }
            const legacyAssetFile = resolveStaticPath(reqPath, "/dev-assets", legacyAssetsRoot);
            if (legacyAssetFile && fs.existsSync(legacyAssetFile) && fs.statSync(legacyAssetFile).isFile()) {
              sendFile(req, res, legacyAssetFile);
              return;
            }
            next();
          });
        }
      }
    ]
  };
});
