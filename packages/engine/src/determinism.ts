export type DeterministicFrameInput = {
  tMs: number;
  sectionId?: string;
  sectionType?: string;
  trackId?: string;
  seed?: number;
  viewerMode?: string;
};

export const DETERMINISM_CONTRACT = Object.freeze({
  version: "1",
  guarantees: [
    "Frame output must be a pure function of absolute time, seed, track/effective data, and explicit params.",
    "Renderer modules must not require playback history or prior frame integration state.",
    "Seek to any timestamp must render the same frame regardless of entry path."
  ]
});

export function assertDeterministicFrameInput(input: DeterministicFrameInput) {
  if (!Number.isFinite(Number(input?.tMs))) {
    throw new Error("Determinism contract violation: render tMs must be finite.");
  }
}

export function assertDeterministicParams(params: unknown, moduleId: string) {
  if (!params || typeof params !== "object") return;
  const stack: unknown[] = [params];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const value of Object.values(cur as Record<string, unknown>)) {
      if (typeof value === "function") {
        throw new Error(`Determinism contract violation: function value found in module params (${moduleId}).`);
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
}
