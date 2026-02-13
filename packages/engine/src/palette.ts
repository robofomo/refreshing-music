import { refreshTitles } from "../../palettes/refreshTitles.mjs";
import { createRng, hashStringToSeed } from "./rng";

function slugify(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function hsvToHex(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (n: number) => Math.round((n + m) * 255);
  const hex = (n: number) => to255(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function randomPalette(count: number, seed: number) {
  const rng = createRng(seed ^ hashStringToSeed("palette"));
  const colors: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const hue = rng.float() * 360;
    const sat = 0.55 + rng.float() * 0.35;
    const val = 0.65 + rng.float() * 0.3;
    colors.push(hsvToHex(hue, sat, val));
  }
  return colors;
}

export function selectPalette({
  refreshTitle,
  palettePolicy,
  seed
}: {
  refreshTitle?: string;
  palettePolicy?: { source?: string; fallbackTitle?: string };
  seed: number;
}) {
  const title = refreshTitle || palettePolicy?.fallbackTitle || "Random 5";
  const slug = slugify(title);
  const match = refreshTitles.find((p: any) => p.label.startsWith(title) || p.slug === slug) ?? refreshTitles[0];

  if (match.colors && match.colors.length) {
    return match.colors.slice();
  }
  const n = match.randomSpec?.count ?? 3;
  return randomPalette(n, seed ^ hashStringToSeed(match.slug));
}
