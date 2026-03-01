import { selectPalette } from "./palette";
import { hashStringToSeed } from "./rng";
import { compositeTransition, normalizeSectionLabel, type TransitionDef } from "./transitions";
import { classifySection, type SectionType } from "./sections";
import { assertDeterministicFrameInput } from "./determinism";
import { renderRegisteredModule } from "./moduleRegistry";
import { resolveResolvable } from "./resolvable";
import { renderGraphScene } from "./graphScene";

type EngineState = {
  tMs: number;
  sectionId?: string;
  sectionType?: SectionType;
  viewerMode?: string;
  signalBus?: any;
  amp?: number;
  energy?: number;
  recipe?: any;
  track?: any;
  lyricsEnabled?: boolean;
  lyricMode?: string;
  uiLayout?: { controlsTopPx?: number; viewportHeightPx?: number };
};

function asObject(v: any) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

function cloneObject<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => cloneObject(x)) as T;
  if (typeof v === "object" && v !== null) {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v as Record<string, any>)) out[k] = cloneObject(val);
    return out as T;
  }
  return v;
}

function setPath(obj: Record<string, any>, path: string, value: any) {
  const parts = String(path).split(".").filter(Boolean);
  if (!parts.length) return;
  let cursor: Record<string, any> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const next = asObject(cursor[p]);
    cursor[p] = next;
    cursor = next;
  }
  cursor[parts[parts.length - 1]] = value;
}

export function createEngine({
  canvas,
  dpr,
  getTimeState,
  getAudioState
}: {
  canvas: HTMLCanvasElement;
  dpr?: number;
  getTimeState?: () => any;
  getAudioState?: () => any;
}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D not supported");

  let seed = 1;
  let lastSectionId = "";
  let sectionChangeT0Ms = -1;
  let activeTransition: TransitionDef | null = null;

  function makeScratchCanvas() {
    const Ctor = (globalThis as any).OffscreenCanvas;
    if (typeof Ctor === "function") {
      const c = new Ctor(1, 1);
      const cctx = c.getContext("2d");
      if (cctx) return { canvas: c as any, ctx: cctx as any };
    }
    const c = document.createElement("canvas");
    const cctx = c.getContext("2d");
    return { canvas: c as any, ctx: cctx as any };
  }

  const scratchAObj = makeScratchCanvas();
  const scratchBObj = makeScratchCanvas();
  const scratchA = scratchAObj.canvas;
  const scratchB = scratchBObj.canvas;
  const scratchACtx = scratchAObj.ctx;
  const scratchBCtx = scratchBObj.ctx;
  if (!scratchACtx || !scratchBCtx) throw new Error("Canvas2D not supported");

  function ensureScratchSize(width: number, height: number) {
    if (scratchA.width !== width || scratchA.height !== height) {
      scratchA.width = width;
      scratchA.height = height;
    }
    if (scratchB.width !== width || scratchB.height !== height) {
      scratchB.width = width;
      scratchB.height = height;
    }
  }

  function resolveLayerOpacity(layer: any, state: EngineState) {
    const base = Number(layer?.opacity ?? 1);
    let out = Number.isFinite(base) ? base : 1;
    const bindings = Array.isArray(layer?.bindings) ? layer.bindings : [];
    for (const b of bindings) {
      if (b?.target !== "opacity") continue;
      const src = b?.source === "energy" ? Number(state?.energy ?? 0) : Number(state?.amp ?? 0);
      const m = b?.map ?? {};
      const inMin = Number(m?.inMin ?? 0);
      const inMax = Number(m?.inMax ?? 1);
      const outMin = Number(m?.outMin ?? 0);
      const outMax = Number(m?.outMax ?? 1);
      const u = inMax === inMin ? 0 : Math.max(0, Math.min(1, (src - inMin) / (inMax - inMin)));
      out = outMin + (outMax - outMin) * u;
    }
    return Math.max(0, Math.min(1, out));
  }

  function appliesRule(rule: any, sectionType: SectionType, sectionId: string) {
    const when = asObject(rule?.when);
    const byType = !when.sectionType || String(when.sectionType) === sectionType;
    const byId = !when.sectionId || normalizeSectionLabel(String(when.sectionId)) === normalizeSectionLabel(sectionId);
    return byType && byId;
  }

  function resolveLayerOverrides(layer: any, recipe: any, sectionType: SectionType, sectionId: string) {
    const out = { opacity: undefined as number | undefined, params: cloneObject(asObject(layer?.params)) };
    const rules = Array.isArray(recipe?.sectionRules) ? recipe.sectionRules : [];
    const modulePrefix = `${String(layer?.module ?? "")}.`;
    const idPrefix = `${String(layer?.id ?? "")}.`;
    for (const rule of rules) {
      if (!appliesRule(rule, sectionType, sectionId)) continue;
      const set = asObject(rule?.set);
      for (const [k, v] of Object.entries(set)) {
        const key = String(k);
        if (!(key.startsWith(modulePrefix) || key.startsWith(idPrefix))) continue;
        const suffix = key.startsWith(modulePrefix) ? key.slice(modulePrefix.length) : key.slice(idPrefix.length);
        if (suffix === "opacity") {
          const n = Number(v);
          if (Number.isFinite(n)) out.opacity = n;
          continue;
        }
        setPath(out.params, suffix, v);
      }
    }
    return out;
  }

  function selectTransitionDef(recipe: any, fromSectionId: string, toSectionId: string) {
    const transitions = recipe?.transitions ?? {};
    const fromNorm = normalizeSectionLabel(fromSectionId);
    const toNorm = normalizeSectionLabel(toSectionId);
    const by = Array.isArray(transitions?.bySectionChange) ? transitions.bySectionChange : [];
    for (const rule of by) {
      const fromAny = Array.isArray(rule?.fromAny) ? rule.fromAny.map((s: string) => normalizeSectionLabel(s)) : null;
      const toAny = Array.isArray(rule?.toAny) ? rule.toAny.map((s: string) => normalizeSectionLabel(s)) : null;
      const fromOk = !fromAny || fromAny.includes(fromNorm);
      const toOk = !toAny || toAny.includes(toNorm);
      if (fromOk && toOk && rule?.transition) return rule.transition as TransitionDef;
    }
    return (transitions?.default ?? { kind: "crossfade", durationMs: 900 }) as TransitionDef;
  }

  function renderLayers({
    targetCtx,
    layers,
    state,
    palette,
    tMs,
    recipe,
    sectionType,
    sectionId,
    clearFirst = true
  }: {
    targetCtx: CanvasRenderingContext2D;
    layers: any[];
    state: EngineState;
    palette: string[];
    tMs: number;
    recipe: any;
    sectionType: SectionType;
    sectionId: string;
    clearFirst?: boolean;
  }) {
    if (clearFirst) {
      targetCtx.setTransform(1, 0, 0, 1, 0, 0);
      targetCtx.globalAlpha = 1;
      targetCtx.globalCompositeOperation = "source-over";
      targetCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
    let lyricIndex = -1;
    let lyricText = "";
    for (const layer of layers) {
      if (layer?.enabled === false) continue;
      const overrides = resolveLayerOverrides(layer, recipe, sectionType, sectionId);
      const resolvedParams = resolveResolvable(overrides.params, {
        tMs,
        seed,
        state,
        path: `${String(layer?.module || "module")}.params`
      });
      const layerForOpacity = overrides.opacity === undefined ? layer : { ...layer, opacity: overrides.opacity };
      const layerOpacity = resolveLayerOpacity(layerForOpacity, state);
      if (layerOpacity <= 0) continue;

      targetCtx.save();
      targetCtx.globalCompositeOperation = layer?.blend ?? "source-over";
      targetCtx.globalAlpha = layerOpacity;

      const moduleResult = renderRegisteredModule({
        moduleId: String(layer?.module ?? ""),
        ctx: targetCtx,
        canvas,
        tMs,
        seed,
        params: resolvedParams,
        colors: palette,
        sectionType,
        state
      });
      if (moduleResult?.lyricIndex !== undefined) lyricIndex = moduleResult.lyricIndex;
      if (moduleResult?.lyricText !== undefined) lyricText = moduleResult.lyricText;
      if (moduleResult === null) {
        // Unknown module id: keep rendering pipeline stable by skipping layer.
      }

      targetCtx.restore();
    }
    return { lyricIndex, lyricText };
  }

  function reset(nextSeed: number) {
    seed = nextSeed >>> 0;
    lastSectionId = "";
    sectionChangeT0Ms = -1;
    activeTransition = null;
  }

  function renderFrame(state: EngineState) {
    assertDeterministicFrameInput({
      tMs: Number(state?.tMs),
      sectionId: state?.sectionId,
      sectionType: state?.sectionType,
      trackId: state?.track?.trackId,
      seed,
      viewerMode: state?.viewerMode
    });
    const timeState = getTimeState ? getTimeState() : {};
    const audioState = getAudioState ? getAudioState() : {};
    const tMs = state?.tMs ?? timeState?.tMs ?? 0;
    const recipe = state?.recipe ?? {};
    const track = state?.track ?? {};
    const refreshTitle = track?.composer?.headerMap?.["Refresh Title"];
    const palette = selectPalette({
      refreshTitle,
      palettePolicy: recipe?.palettePolicy,
      seed: seed ^ hashStringToSeed(track?.trackId ?? "track")
    });

    const pixelRatio = dpr ?? Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    const cssW = Math.floor(window.innerWidth);
    const cssH = Math.floor(window.innerHeight);
    if (canvas.width !== Math.floor(cssW * pixelRatio) || canvas.height !== Math.floor(cssH * pixelRatio)) {
      canvas.width = Math.floor(cssW * pixelRatio);
      canvas.height = Math.floor(cssH * pixelRatio);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const layers = Array.isArray(recipe?.layers) && recipe.layers.length
      ? recipe.layers
      : [{ module: "bg.gradientField", params: { gradientStops: 3 } }];
    const viewerMode = String(state?.viewerMode ?? "playback");
    const sectionId = String(state?.sectionId ?? "section");
    const sectionType = state?.sectionType ?? classifySection(sectionId);
    const width = canvas.width;
    const height = canvas.height;
    ensureScratchSize(width, height);

    if (lastSectionId && sectionId !== lastSectionId) {
      scratchACtx.setTransform(1, 0, 0, 1, 0, 0);
      scratchACtx.globalAlpha = 1;
      scratchACtx.globalCompositeOperation = "source-over";
      scratchACtx.clearRect(0, 0, width, height);
      scratchACtx.drawImage(canvas, 0, 0, width, height);
      sectionChangeT0Ms = tMs;
      activeTransition = selectTransitionDef(recipe, lastSectionId, sectionId);
    }
    lastSectionId = sectionId;

    let frameInfo = { sectionId, sectionType, lyricIndex: -1, lyricText: "" };
    const drawToFn = (targetCtx: CanvasRenderingContext2D) => {
      const hasGraphLayers = Array.isArray(recipe?.graph?.layers) && recipe.graph.layers.length > 0;
      const useGraphPipeline =
        viewerMode === "player" ||
        viewerMode === "recipe-view" ||
        viewerMode === "random-scene" ||
        (viewerMode === "graph-scene") ||
        (viewerMode === "hint-edit" && hasGraphLayers);
      if (useGraphPipeline) {
        targetCtx.setTransform(1, 0, 0, 1, 0, 0);
        targetCtx.globalAlpha = 1;
        targetCtx.globalCompositeOperation = "source-over";
        targetCtx.clearRect(0, 0, canvas.width, canvas.height);
        renderGraphScene({
          ctx: targetCtx,
          canvas,
          tMs,
          seed,
          state,
          recipe,
          colors: palette
        });
        if (viewerMode === "hint-edit") {
          const uiLayers = layers.filter((layer: any) => String(layer?.module ?? "").toLowerCase().startsWith("ui."));
          if (uiLayers.length) {
            const renderInfo = renderLayers({
              targetCtx,
              layers: uiLayers,
              state,
              palette,
              tMs,
              recipe,
              sectionType,
              sectionId,
              clearFirst: false
            });
            frameInfo = { ...frameInfo, ...renderInfo };
          }
        }
      } else {
        const renderInfo = renderLayers({ targetCtx, layers, state, palette, tMs, recipe, sectionType, sectionId });
        frameInfo = { ...frameInfo, ...renderInfo };
      }
      void audioState;
    };

    if (activeTransition && sectionChangeT0Ms >= 0) {
      const durationMs = Math.max(1, Number(activeTransition.durationMs ?? 900));
      const progress = Math.max(0, Math.min(1, (tMs - sectionChangeT0Ms) / durationMs));
      compositeTransition({
        ctx,
        width,
        height,
        fromCanvas: scratchA,
        tempCtx: scratchBCtx,
        progress,
        transitionDef: activeTransition,
        drawToFn,
        seed
      });
      if (progress >= 1) {
        sectionChangeT0Ms = -1;
        activeTransition = null;
      }
      return frameInfo;
    }

    drawToFn(ctx);
    return frameInfo;
  }

  return { renderFrame, reset };
}

export { hashStringToSeed };
export { registerModule } from "./moduleRegistry";
