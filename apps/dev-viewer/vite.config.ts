import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const repoRoot = path.resolve(__dirname, "..", "..");
const tracksRoot = path.join(repoRoot, "tracks");
const assetsRoot = path.join(repoRoot, "dev-assets");

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

export default defineConfig({
  plugins: [
    {
      name: "repo-static-mounts",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const reqPath = (req.url ?? "").split("?")[0];
          const trackFile = resolveStaticPath(reqPath, "/tracks", tracksRoot);
          if (trackFile && fs.existsSync(trackFile) && fs.statSync(trackFile).isFile()) {
            sendFile(req, res, trackFile);
            return;
          }

          const assetFile = resolveStaticPath(reqPath, "/dev-assets", assetsRoot);
          if (assetFile && fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
            sendFile(req, res, assetFile);
            return;
          }
          next();
        });
      }
    }
  ]
});
