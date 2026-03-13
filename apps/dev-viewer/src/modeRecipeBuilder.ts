type ViewerMode = "player" | "hint-edit" | "primitive-lab" | "recipe-view" | "random-scene" | "transition-lab";

type GraphLayerSet = { layers: any[] };

type PlayerSceneChoice = {
  source: "recipe-view" | "random-scene";
  variant: number;
  sceneIndex?: number;
  backgroundIndex?: number;
  cycleEvery2Bars?: boolean;
  beat3Accent?: boolean;
};

type PlayerTimingState = {
  variantIndex: number;
  sectionBarIndex: number;
  beatInBar: number;
};

type ModeRecipeBuilderDeps = {
  hashStringToSeed: (value: string) => number;
  getMemoState: (sectionId: string) => {
    seed: number;
    sectionVariant: number;
    graphAutoRefresh: boolean;
    manualRecipeSignature: string;
    transitionLabPresetIndex: number;
  };
  getLabState: () => {
    transitionLabVariant: string;
    labPrimitive: string;
    labBackdropPolicy: string;
    labBackdropFixed: string;
  };
  cloneRecipe: <T>(value: T) => T;
  baseGraphLayers: () => any[];
  graphLayersForSection: (baseRecipe: any, sectionId: string, options?: { allowManual?: boolean; variantOverride?: number; selectedIndexOverride?: number }) => GraphLayerSet;
  randomSceneLayersForSection: (sectionId: string, options?: { allowManual?: boolean; variantOverride?: number; selectedIndexOverride?: number; backgroundIndexOverride?: number }) => GraphLayerSet;
  sectionOrderIndexById: (sectionId: string) => number;
  transitionLabTransitionDef: () => any;
  resolvePlayerSceneChoice: (sectionId: string, sectionType: string, playerState?: PlayerTimingState) => PlayerSceneChoice;
  buildPlayerDefaultTransition: (sectionId: string, sectionType: string) => any;
  labGraphLayers: () => any[];
  isGraphCapableMode: (mode: ViewerMode) => boolean;
};

function asGraphLayers(value: any) {
  return Array.isArray(value) ? value : [];
}

export function createModeRecipeResolver(deps: ModeRecipeBuilderDeps) {
  let memoBase: any = null;
  const memo = new Map<string, any>();

  function clear() {
    memo.clear();
    memoBase = null;
  }

  function resolve(baseRecipe: any, mode: ViewerMode, sectionId: string, sectionType: string, playerState?: PlayerTimingState) {
    if (memoBase !== baseRecipe) {
      memoBase = baseRecipe;
      memo.clear();
    }

    const {
      seed,
      sectionVariant,
      graphAutoRefresh,
      manualRecipeSignature,
      transitionLabPresetIndex
    } = deps.getMemoState(sectionId);
    const {
      transitionLabVariant,
      labPrimitive,
      labBackdropPolicy,
      labBackdropFixed
    } = deps.getLabState();
    const memoKey = [
      mode,
      sectionId,
      sectionType,
      playerState?.variantIndex ?? 0,
      playerState?.sectionBarIndex ?? 0,
      playerState?.beatInBar ?? 1,
      seed >>> 0,
      sectionVariant,
      graphAutoRefresh ? 1 : 0,
      manualRecipeSignature,
      transitionLabPresetIndex,
      transitionLabVariant,
      labPrimitive,
      labBackdropPolicy,
      labBackdropFixed
    ].join("|");
    const memoHit = memo.get(memoKey);
    if (memoHit) return memoHit;

    const recipe = deps.cloneRecipe(baseRecipe || {});
    recipe.layers = Array.isArray(recipe.layers) ? recipe.layers : [];
    recipe.graph = typeof recipe.graph === "object" && recipe.graph ? recipe.graph : {};
    recipe.graph.layers = Array.isArray(recipe.graph.layers) ? recipe.graph.layers : [];

    const nodeType = (node: any) => String(node?.type ?? "").toLowerCase();
    const isBaseType = (type: string) => type === "bg.gradientfield" || type === "fg.particles" || type === "shape.beatorb";

    if (mode === "hint-edit") {
      recipe.graph.layers = deps.baseGraphLayers();
    } else if (mode === "recipe-view") {
      recipe.graph.layers = deps.graphLayersForSection(baseRecipe, sectionId).layers;
    } else if (mode === "random-scene") {
      recipe.graph.layers = deps.randomSceneLayersForSection(sectionId).layers;
    } else if (mode === "transition-lab") {
      const picked = deps.randomSceneLayersForSection(sectionId);
      const secIdx = deps.sectionOrderIndexById(sectionId);
      const isLight = secIdx >= 0 ? (secIdx % 2 === 1) : ((deps.hashStringToSeed(`transition-lab:${sectionId}`) >>> 0) % 2 === 1);
      const stripped = asGraphLayers(picked.layers)
        .map((layer: any) => ({
          ...layer,
          nodes: asGraphLayers(layer?.nodes).filter((node: any) => !String(node?.type ?? "").toLowerCase().startsWith("bg."))
        }))
        .filter((layer: any) => Array.isArray(layer.nodes) && layer.nodes.length > 0);
      const bgLayer = isLight
        ? {
            id: "tlab-bg-light",
            blend: "source-over",
            opacity: 1,
            nodes: [
              { id: "tlab-gradient", type: "bg.gradientField", params: { gradientStops: 3, driftSpeed: 0.012, noiseScale: 0.5, soften: 0.94 } },
              { id: "tlab-offset", type: "glitch.persistentOffset", params: { count: 10, widthPx: 7, driftPx: 0.5, alpha: 0.12 } }
            ]
          }
        : {
            id: "tlab-bg-dark",
            blend: "source-over",
            opacity: 1,
            nodes: [{ id: "tlab-solid", type: "bg.solid", params: { color: "#05070B" } }]
          };
      recipe.graph.layers = [
        bgLayer,
        ...stripped,
        {
          id: "tlab-beats",
          blend: "source-over",
          opacity: 1,
          nodes: [{ id: "tlab-beat-track", type: "overlay.beatTrack", params: { alpha: 0.92, topInsetPx: 44, bottomInsetPx: 8, playheadColor: "#000000", beatColor: "#8E8E8E", downbeatColor: "#D0D0D0" } }]
        }
      ];
      recipe.transitions = {
        ...(typeof recipe.transitions === "object" && recipe.transitions ? recipe.transitions : {}),
        bySectionChange: [],
        default: deps.transitionLabTransitionDef()
      };
    } else if (mode === "player") {
      const choice = deps.resolvePlayerSceneChoice(sectionId, sectionType, playerState);
      const picked = choice.source === "recipe-view"
        ? deps.graphLayersForSection(baseRecipe, sectionId, {
            allowManual: false,
            variantOverride: choice.variant,
            selectedIndexOverride: choice.sceneIndex
          })
        : deps.randomSceneLayersForSection(sectionId, {
            allowManual: false,
            variantOverride: choice.variant,
            selectedIndexOverride: choice.sceneIndex,
            backgroundIndexOverride: choice.backgroundIndex
          });
      recipe.graph.layers = picked.layers;
      const transitions = typeof recipe.transitions === "object" && recipe.transitions ? recipe.transitions : {};
      recipe.transitions = {
        ...transitions,
        default: deps.buildPlayerDefaultTransition(sectionId, sectionType)
      };
    }

    if (mode === "primitive-lab") {
      recipe.layers = [];
      recipe.graph.layers = deps.labGraphLayers();
    }

    if (deps.isGraphCapableMode(mode)) {
      for (const layer of recipe.graph.layers) {
        const nodes = asGraphLayers(layer?.nodes);
        layer.nodes = nodes.filter((node: any) => {
          if (mode === "transition-lab") return true;
          return String(node?.type ?? "").toLowerCase() !== "overlay.beattrack";
        });
      }
      recipe.graph.layers = recipe.graph.layers.filter((layer: any) => (Array.isArray(layer?.nodes) ? layer.nodes.length > 0 : false));
    }

    const hasEchoTextNode = recipe.graph.layers.some((layer: any) =>
      asGraphLayers(layer?.nodes).some((node: any) => {
        const type = nodeType(node);
        return (type === "text.echoword" || type === "text.karaoke") && node?.enabled !== false;
      })
    );
    if (hasEchoTextNode) {
      recipe.layers = recipe.layers.filter((layer: any) => {
        const id = String(layer?.module ?? "").toLowerCase();
        return !id.startsWith("ui.lyrics");
      });
    }

    const seenBase = new Set<string>();
    for (const layer of recipe.graph.layers) {
      const nodes = asGraphLayers(layer?.nodes);
      layer.nodes = nodes.filter((node: any) => {
        const type = nodeType(node);
        if (!isBaseType(type)) return true;
        if (seenBase.has(type)) return false;
        seenBase.add(type);
        return true;
      });
    }

    if (memo.size > 240) memo.clear();
    memo.set(memoKey, recipe);
    return recipe;
  }

  return { clear, resolve };
}
