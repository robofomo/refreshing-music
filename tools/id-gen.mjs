import fs from "node:fs";
import crypto from "node:crypto";

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sha256Short(buffer, n = 14) {
  const h = crypto.createHash("sha256").update(buffer).digest();
  return base64url(h).slice(0, n);
}

function canonicalizeWorkText({ title, style, composerVersion, rawText }) {
  return [
    `title:${(title ?? "").trim()}`,
    `style:${(style ?? "").trim()}`,
    `composerVersion:${(composerVersion ?? "").trim()}`,
    `rawText:${(rawText ?? "").trim()}`
  ].join("\n");
}

function kebab(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function mp3FingerprintBytes(filePath) {
  const stat = fs.statSync(filePath);
  const sizeBuf = Buffer.allocUnsafe(8);
  sizeBuf.writeBigUInt64BE(BigInt(stat.size));

  const fd = fs.openSync(filePath, "r");

  const headLen = Math.min(1_000_000, stat.size);
  const head = Buffer.allocUnsafe(headLen);
  fs.readSync(fd, head, 0, headLen, 0);

  const tailLen = Math.min(65_536, stat.size);
  const tail = Buffer.allocUnsafe(tailLen);
  fs.readSync(fd, tail, 0, tailLen, stat.size - tailLen);

  fs.closeSync(fd);

  return Buffer.concat([sizeBuf, head, tail]);
}

// Usage:
// node tools/id-gen.mjs <path-to-mp3> "<title>" "<style>" "<composerVersion>" <path-to-composer-rawtext-file(optional)>
const [mp3Path, title, style, composerVersion, rawTextPath] = process.argv.slice(2);
if ([mp3Path, title, style, composerVersion].some((v) => v === undefined)) {
  console.error('Usage: node tools/id-gen.mjs <mp3Path> "<title>" "<style>" "<composerVersion>" [rawTextFile]');
  process.exit(1);
}

const rawText = rawTextPath ? fs.readFileSync(rawTextPath, "utf8") : "";

const workText = canonicalizeWorkText({ title, style, composerVersion, rawText });
const workId = sha256Short(Buffer.from(workText, "utf8"), 12);

const fp = mp3FingerprintBytes(mp3Path);
const trackId = sha256Short(fp, 14);

const slugBase = kebab(title);

console.log(JSON.stringify({ workId, trackId, slugBase }, null, 2));
