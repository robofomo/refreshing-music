import { assertDeterministicParams } from "./determinism";

export type GraphPrimitiveRenderArgs = {
  primitiveId: string;
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  tMs: number;
  seed: number;
  params?: Record<string, any>;
  colors: string[];
  state?: any;
  amp: number;
  beat: number;
  downbeat: number;
  reactive?: any;
};

type GraphPrimitiveRenderer = (args: GraphPrimitiveRenderArgs) => void;

const registry = new Map<string, GraphPrimitiveRenderer>();

function normalizePrimitiveId(primitiveId: string) {
  return String(primitiveId || "").trim().toLowerCase();
}

export function registerGraphPrimitive(primitiveId: string, renderer: GraphPrimitiveRenderer) {
  const key = normalizePrimitiveId(primitiveId);
  if (!key) return;
  registry.set(key, renderer);
}

export function renderRegisteredGraphPrimitive(args: GraphPrimitiveRenderArgs) {
  const key = normalizePrimitiveId(args.primitiveId);
  const renderer = registry.get(key);
  if (!renderer) return false;
  assertDeterministicParams(args.params, key);
  renderer(args);
  return true;
}
