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
  nextSectionId?: string;
  nextSectionType?: SectionType;
  nextSectionStartMs?: number;
  viewerMode?: string;
  signalBus?: any;
  beatTrack?: { beatsMs?: number[]; downbeatsMs?: number[] };
  amp?: number;
  energy?: number;
  recipe?: any;
  nextRecipe?: any;
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
  let lastSectionType: SectionType = "other";
  let lastRecipe: any = null;
  let sectionChangeT0Ms = -1;
  let sectionChangeT1Ms = -1;
  let lastFrameTMs = Number.NaN;
  let activeTransition: TransitionDef | null = null;
  let transitionFromSectionId = "";
  let transitionFromSectionType: SectionType = "other";
  let transitionFromRecipe: any = null;
  let transitionToSectionId = "";
  let transitionToSectionType: SectionType = "other";
  let transitionToRecipe: any = null;

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

  function resolveRuntimeTransitionDef(def: TransitionDef | null, state: EngineState): TransitionDef | null {
    if (!def) return null;
    const out: TransitionDef = { ...(def as any) };
    const params = asObject((out as any)?.params);
    if (params.useRhythmSteps === true) {
      const beatMs = Number(state?.signalBus?.rhythm?.beatMs);
      const beatsBeforeEnd = Math.max(1, Math.min(16, Number(params.beatsBeforeEnd ?? 4)));
      if (Number.isFinite(beatMs) && beatMs > 0) {
        out.durationMs = Math.max(1, Math.round(beatMs * beatsBeforeEnd));
      }
    }
    return out;
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
    lastFrameTMs = Number.NaN;
    lastSectionId = "";
    lastSectionType = "other";
    lastRecipe = null;
    sectionChangeT0Ms = -1;
    sectionChangeT1Ms = -1;
    activeTransition = null;
    transitionFromSectionId = "";
    transitionFromSectionType = "other";
    transitionFromRecipe = null;
    transitionToSectionId = "";
    transitionToSectionType = "other";
    transitionToRecipe = null;
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
    const tMsNum = Number(tMs);
    if (Number.isFinite(lastFrameTMs) && Number.isFinite(tMsNum)) {
      const dt = tMsNum - lastFrameTMs;
      // Time discontinuities (seek/jump) can leave an old transition state blocking new ones.
      if (dt < -120 || dt > 5000) {
        sectionChangeT0Ms = -1;
        sectionChangeT1Ms = -1;
        activeTransition = null;
        lastSectionId = "";
        lastSectionType = "other";
        lastRecipe = null;
        transitionFromSectionId = "";
        transitionFromSectionType = "other";
        transitionFromRecipe = null;
        transitionToSectionId = "";
        transitionToSectionType = "other";
        transitionToRecipe = null;
      }
    }
    lastFrameTMs = Number.isFinite(tMsNum) ? tMsNum : lastFrameTMs;
    const recipe = state?.recipe ?? {};
    const nextRecipe = state?.nextRecipe ?? recipe;
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
    const viewerMode = String(state?.viewerMode ?? "player");
    const sectionId = String(state?.sectionId ?? "section");
    const sectionType = state?.sectionType ?? classifySection(sectionId);
    const width = canvas.width;
    const height = canvas.height;
    ensureScratchSize(width, height);
    let frameInfo: any = {
      sectionId,
      sectionType,
      lyricIndex: -1,
      lyricText: "",
      transition: {
        armed: false,
        active: false,
        progress: 0,
        t0Ms: -1,
        t1Ms: -1,
        fromSectionId: "",
        toSectionId: ""
      }
    };

    const nextSectionId = String(state?.nextSectionId ?? "");
    const nextSectionType = (state?.nextSectionType as SectionType) || classifySection(nextSectionId);
    const nextSectionStartMs = Number(state?.nextSectionStartMs);
    if (
      activeTransition &&
      (!Number.isFinite(sectionChangeT0Ms) || sectionChangeT0Ms < 0 || !Number.isFinite(sectionChangeT1Ms))
    ) {
      sectionChangeT0Ms = -1;
      sectionChangeT1Ms = -1;
      activeTransition = null;
      transitionFromSectionId = "";
      transitionFromSectionType = "other";
      transitionFromRecipe = null;
      transitionToSectionId = "";
      transitionToSectionType = "other";
      transitionToRecipe = null;
    }
    const transForNext = nextSectionId && nextSectionId !== sectionId
      ? resolveRuntimeTransitionDef(selectTransitionDef(recipe, sectionId, nextSectionId), state)
      : null;
    const nextDurationMs = transForNext ? Math.max(1, Number(transForNext.durationMs ?? 900)) : 0;
    const nextT0 = Number.isFinite(nextSectionStartMs) ? (nextSectionStartMs - nextDurationMs) : NaN;
    if (Number.isFinite(nextT0) && nextSectionId && nextSectionId !== sectionId && tMs < nextSectionStartMs) {
      frameInfo.transition = {
        armed: tMs < nextT0,
        active: tMs >= nextT0,
        progress: tMs < nextT0 ? 0 : Math.max(0, Math.min(1, (tMs - nextT0) / Math.max(1, nextDurationMs))),
        t0Ms: nextT0,
        t1Ms: nextSectionStartMs,
        fromSectionId: sectionId,
        toSectionId: nextSectionId
      };
    }
    const canPreRoll =
      !activeTransition &&
      Number.isFinite(nextSectionStartMs) &&
      nextSectionStartMs > tMs &&
      nextSectionId &&
      nextSectionId !== sectionId;
    if (canPreRoll) {
      const trans = resolveRuntimeTransitionDef(selectTransitionDef(recipe, sectionId, nextSectionId), state) as TransitionDef;
      const durationMs = Math.max(1, Number(trans.durationMs ?? 900));
      const t0 = nextSectionStartMs - durationMs;
      if (tMs >= t0) {
        activeTransition = trans;
        sectionChangeT0Ms = t0;
        sectionChangeT1Ms = nextSectionStartMs;
        transitionFromSectionId = sectionId;
        transitionFromSectionType = sectionType;
        transitionFromRecipe = recipe;
        transitionToSectionId = nextSectionId;
        transitionToSectionType = nextSectionType;
        transitionToRecipe = nextRecipe;
      }
    }

    if (!activeTransition && lastSectionId && sectionId !== lastSectionId) {
      transitionFromSectionId = lastSectionId;
      transitionFromSectionType = lastSectionType;
      transitionFromRecipe = lastRecipe ?? recipe;
      sectionChangeT0Ms = tMs;
      activeTransition = resolveRuntimeTransitionDef(selectTransitionDef(recipe, lastSectionId, sectionId), state);
      const durationMs = Math.max(1, Number(activeTransition.durationMs ?? 900));
      sectionChangeT1Ms = tMs + durationMs;
      transitionToSectionId = sectionId;
      transitionToSectionType = sectionType;
      transitionToRecipe = recipe;
    }
    lastSectionId = sectionId;
    lastSectionType = sectionType;
    lastRecipe = recipe;

    const drawScene = ({
      targetCtx,
      sceneSectionId,
      sceneSectionType,
      sceneRecipe,
      captureInfo
    }: {
      targetCtx: CanvasRenderingContext2D;
      sceneSectionId: string;
      sceneSectionType: SectionType;
      sceneRecipe: any;
      captureInfo: boolean;
    }) => {
      const sceneState = { ...state, sectionId: sceneSectionId, sectionType: sceneSectionType };
      const hasGraphLayers = Array.isArray(sceneRecipe?.graph?.layers) && sceneRecipe.graph.layers.length > 0;
      const useGraphPipeline =
        viewerMode === "player" ||
        viewerMode === "primitive-lab" ||
        viewerMode === "transition-lab" ||
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
          state: sceneState,
          recipe: sceneRecipe,
          colors: palette
        });
        if (viewerMode === "hint-edit") {
          const uiLayers = layers.filter((layer: any) => String(layer?.module ?? "").toLowerCase().startsWith("ui."));
          if (uiLayers.length) {
            const renderInfo = renderLayers({
              targetCtx,
              layers: uiLayers,
              state: sceneState,
              palette,
              tMs,
              recipe: sceneRecipe,
              sectionType: sceneSectionType,
              sectionId: sceneSectionId,
              clearFirst: false
            });
            if (captureInfo) frameInfo = { ...frameInfo, ...renderInfo };
          }
        }
      } else {
        const renderInfo = renderLayers({
          targetCtx,
          layers,
          state: sceneState,
          palette,
          tMs,
          recipe: sceneRecipe,
          sectionType: sceneSectionType,
          sectionId: sceneSectionId
        });
        if (captureInfo) frameInfo = { ...frameInfo, ...renderInfo };
      }
      void audioState;
    };

    if (activeTransition && sectionChangeT0Ms >= 0) {
      const t1 = sectionChangeT1Ms > sectionChangeT0Ms
        ? sectionChangeT1Ms
        : sectionChangeT0Ms + Math.max(1, Number(activeTransition.durationMs ?? 900));
      const progress = Math.max(0, Math.min(1, (tMs - sectionChangeT0Ms) / Math.max(1, t1 - sectionChangeT0Ms)));

      const fromSectionId = transitionFromSectionId || lastSectionId || sectionId;
      const fromSectionType = transitionFromSectionType || lastSectionType || sectionType;
      frameInfo.transition = {
        armed: false,
        active: true,
        progress,
        t0Ms: sectionChangeT0Ms,
        t1Ms: t1,
        fromSectionId,
        toSectionId: transitionToSectionId || sectionId
      };
      drawScene({
        targetCtx: scratchACtx,
        sceneSectionId: fromSectionId,
        sceneSectionType: fromSectionType,
        sceneRecipe: transitionFromRecipe ?? recipe,
        captureInfo: false
      });

      const transitionDefForRender = (() => {
        const base = activeTransition ?? {};
        const params = asObject((base as any)?.params);
        if (params.useRhythmSteps !== true) return base;
        const fixedSteps16Raw = Array.isArray(state?.signalBus?.rhythm?.step16s)
          ? state.signalBus.rhythm.step16s
          : (Array.isArray(state?.signalBus?.rhythm?.laneSteps16?.transition) ? state.signalBus.rhythm.laneSteps16.transition : []);
        const fixedSteps16 = fixedSteps16Raw
          .map((v: any) => Number(v))
          .filter((v: number) => Number.isFinite(v) && v >= 0 && v < 16)
          .sort((a: number, b: number) => a - b);
        const transitionStepsFromRhythm = fixedSteps16.length;
        const mappedSteps = Number.isFinite(transitionStepsFromRhythm) && transitionStepsFromRhythm > 0
          ? Math.max(2, Math.min(32, Math.round(transitionStepsFromRhythm)))
          : 4;
        const scheduleFromRhythm = fixedSteps16.length
          ? fixedSteps16.map((s: number) => Math.max(0, Math.min(1, s / 16)))
          : [];
        // Ensure transition fully lands exactly at transition end (typically section downbeat).
        if (!scheduleFromRhythm.length || scheduleFromRhythm[scheduleFromRhythm.length - 1] < 1) {
          scheduleFromRhythm.push(1);
        }
        const dynamicSlices = Math.max(2, Math.min(24, scheduleFromRhythm.length));
        return {
          ...(base as any),
          params: {
            ...params,
            steps: dynamicSlices,
            slices: dynamicSlices,
            stepSchedule: scheduleFromRhythm
          }
        } as TransitionDef;
      })();

      compositeTransition({
        ctx,
        width,
        height,
        fromCanvas: scratchA,
        tempCtx: scratchBCtx,
        progress,
        transitionDef: transitionDefForRender,
        drawToFn: (targetCtx) => drawScene({
          targetCtx,
          sceneSectionId: transitionToSectionId || sectionId,
          sceneSectionType: transitionToSectionType || sectionType,
          sceneRecipe: transitionToRecipe ?? recipe,
          captureInfo: true
        }),
        seed
      });
      if (progress >= 1) {
        sectionChangeT0Ms = -1;
        sectionChangeT1Ms = -1;
        activeTransition = null;
        transitionFromSectionId = "";
        transitionFromSectionType = "other";
        transitionFromRecipe = null;
        transitionToSectionId = "";
        transitionToSectionType = "other";
        transitionToRecipe = null;
      }
      return frameInfo;
    }

    drawScene({
      targetCtx: ctx,
      sceneSectionId: sectionId,
      sceneSectionType: sectionType,
      sceneRecipe: recipe,
      captureInfo: true
    });
    return frameInfo;
  }

  return { renderFrame, reset };
}

export { hashStringToSeed };
export { registerModule } from "./moduleRegistry";
export { registerGraphPrimitive } from "./graphPrimitiveRegistry";
