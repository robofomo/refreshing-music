import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";

const repoRoot = path.resolve(__dirname, "..", "..");
const tracksRoot = path.join(repoRoot, "tracks");
const assetsRoot = path.join(repoRoot, "dev-assets");

function sendFile(res: any, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === ".json"
      ? "application/json; charset=utf-8"
      : ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".txt"
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";

  res.statusCode = 200;
  res.setHeader("Content-Type", type);
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
            sendFile(res, trackFile);
            return;
          }

          const assetFile = resolveStaticPath(reqPath, "/dev-assets", assetsRoot);
          if (assetFile && fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
            sendFile(res, assetFile);
            return;
          }
          next();
        });
      }
    }
  ]
});
