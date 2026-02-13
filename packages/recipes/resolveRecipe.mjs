import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson5File } from "./json5Loader.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

function recipePath(kind, id) {
  return path.join(__dirname, kind, `${id}.recipe.json5`);
}

export function resolveRecipe({ albumId, trackOverrideId } = {}) {
  if (!albumId) {
    throw new Error("resolveRecipe requires albumId");
  }

  const albumPath = recipePath("albums", albumId);
  if (!fs.existsSync(albumPath)) {
    throw new Error(`Album recipe not found: ${albumPath}`);
  }

  const albumRecipe = loadJson5File(albumPath);
  if (!trackOverrideId) return albumRecipe;

  const trackPath = recipePath("tracks", trackOverrideId);
  if (!fs.existsSync(trackPath)) return albumRecipe;

  const trackOverride = loadJson5File(trackPath);
  return deepMerge(albumRecipe, trackOverride);
}

export { deepMerge };
