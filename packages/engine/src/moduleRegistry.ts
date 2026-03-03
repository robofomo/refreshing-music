import { renderGradientField } from "./modules/bg.gradientField";
import { renderParticles } from "./modules/fg.particles";
import { renderRadialGradientDrift } from "./modules/bg.radialGradientDrift";
import { renderShockRings } from "./modules/fg.shockRings";
import { renderConstellationLinks } from "./modules/fg.constellationLinks";
import { renderWordTrails } from "./modules/text.wordTrails";
import { renderLyricsKaraoke } from "./modules/ui.lyricsKaraoke";
import { assertDeterministicParams } from "./determinism";
import type { SectionType } from "./sections";

export type ModuleRenderArgs = {
  moduleId: string;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  seed: number;
  params?: Record<string, any>;
  colors: string[];
  sectionType: SectionType;
  state?: any;
};

export type ModuleRenderResult = {
  lyricIndex?: number;
  lyricText?: string;
};

type ModuleRenderer = (args: ModuleRenderArgs) => ModuleRenderResult | void;

const registry = new Map<string, ModuleRenderer>();

export function registerModule(moduleId: string, renderer: ModuleRenderer) {
  registry.set(String(moduleId), renderer);
}

export function renderRegisteredModule(args: ModuleRenderArgs): ModuleRenderResult | null {
  const renderer = registry.get(String(args.moduleId));
  if (!renderer) return null;
  assertDeterministicParams(args.params, args.moduleId);
  const out = renderer(args);
  if (!out) return {};
  return out;
}

function registerBuiltins() {
  registerModule("bg.gradientField", (args) => {
    renderGradientField({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      colors: args.colors,
      seed: args.seed,
      params: args.params
    });
  });

  registerModule("fg.particles", (args) => {
    renderParticles({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      amp: args.state?.amp,
      reactive: args.state?.signalBus?.reactive,
      colors: args.colors,
      seed: args.seed,
      params: args.params
    });
  });

  registerModule("bg.radialGradientDrift", (args) => {
    renderRadialGradientDrift({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      colors: args.colors,
      seed: args.seed,
      params: args.params,
      state: args.state
    });
  });

  registerModule("fg.shockRings", (args) => {
    renderShockRings({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      colors: args.colors,
      seed: args.seed,
      params: args.params,
      state: args.state
    });
  });

  registerModule("fg.constellationLinks", (args) => {
    renderConstellationLinks({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      colors: args.colors,
      seed: args.seed,
      params: args.params,
      state: args.state
    });
  });

  registerModule("text.wordTrails", (args) => {
    renderWordTrails({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      track: args.state?.track,
      params: args.params,
      state: args.state
    });
  });

  const lyricsRenderer: ModuleRenderer = (args) => {
    const lyricInfo = renderLyricsKaraoke({
      ctx: args.ctx,
      canvas: args.canvas,
      tMs: args.tMs,
      track: args.state?.track,
      sectionType: args.sectionType,
      params: {
        ...args.params,
        mode: args.state?.lyricMode ?? args.params?.mode ?? "center",
        controlsTopPx: args.state?.uiLayout?.controlsTopPx,
        viewportHeightPx: args.state?.uiLayout?.viewportHeightPx
      },
      lyricsEnabled: args.state?.lyricsEnabled
    });
    return { lyricIndex: lyricInfo.lyricIndex, lyricText: lyricInfo.lyricText };
  };
  registerModule("ui.lyricsKaraoke", lyricsRenderer);
  registerModule("ui.lyrics", lyricsRenderer);
}

registerBuiltins();
