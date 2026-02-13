export type SectionType =
  | "intro"
  | "prelude"
  | "verse"
  | "prechorus"
  | "chorus"
  | "postchorus"
  | "hook"
  | "build"
  | "drop"
  | "breakdown"
  | "bridge"
  | "instrumental"
  | "solo"
  | "interlude"
  | "outro"
  | "ending"
  | "tag"
  | "other";

export function normalizeSectionLabel(raw?: string) {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-\d+$/, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const RULES: Array<[SectionType, Array<string | RegExp>]> = [
  ["intro", ["intro", "cold open", "opening"]],
  ["prelude", ["prelude", "overture"]],
  ["outro", ["outro"]],
  ["ending", ["ending", "end", "coda", "fade out", "fadeout"]],
  ["tag", ["tag", "reprise"]],
  ["bridge", ["bridge", "middle 8", "middle eight"]],
  ["breakdown", ["breakdown", "break down", "half time", "half-time"]],
  ["build", ["build", "build up", "build-up", "riser", "rise"]],
  ["drop", ["drop", "beat drop", "climax"]],
  ["prechorus", ["pre chorus", "pre-chorus", "prechorus", "lift"]],
  ["postchorus", ["post chorus", "post-chorus", "postchorus"]],
  ["chorus", ["chorus", "refrain"]],
  ["hook", ["hook"]],
  ["verse", ["verse", "v1", "v2", "verse a", "verse b"]],
  ["instrumental", ["instrumental", "inst", "no vocals"]],
  ["solo", ["solo"]],
  ["interlude", ["interlude", "break", "turnaround"]]
];

export function classifySection(labelRaw?: string): SectionType {
  const s = normalizeSectionLabel(labelRaw);
  if (!s) return "other";

  for (const [typ, pats] of RULES) {
    for (const p of pats) {
      if (typeof p === "string") {
        if (s.includes(p)) return typ;
      } else if (p.test(s)) {
        return typ;
      }
    }
  }
  return "other";
}
