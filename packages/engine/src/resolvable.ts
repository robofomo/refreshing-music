import { createRng, hashStringToSeed } from "./rng";

type ResolveContext = {
  tMs: number;
  seed: number;
  state?: any;
  path?: string;
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function easeValue(u: number, ease: string) {
  const x = clamp01(u);
  if (ease === "in") return x * x;
  if (ease === "out") return 1 - (1 - x) * (1 - x);
  if (ease === "inOut") return x < 0.5 ? 2 * x * x : 1 - (Math.pow(-2 * x + 2, 2) / 2);
  return x;
}

function getPathValue(obj: any, path: string) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function signalValue(signalPath: string, ctx: ResolveContext) {
  const direct = Number(getPathValue(ctx.state, signalPath));
  if (Number.isFinite(direct)) return direct;
  const fromBus = Number(getPathValue(ctx.state?.signalBus, signalPath));
  if (Number.isFinite(fromBus)) return fromBus;
  return 0;
}

function isResolvableSpec(obj: Record<string, any>) {
  return (
    Object.prototype.hasOwnProperty.call(obj, "pick") ||
    Object.prototype.hasOwnProperty.call(obj, "map") ||
    Object.prototype.hasOwnProperty.call(obj, "mul") ||
    Object.prototype.hasOwnProperty.call(obj, "add") ||
    Object.prototype.hasOwnProperty.call(obj, "lfo") ||
    Object.prototype.hasOwnProperty.call(obj, "signal") ||
    Object.prototype.hasOwnProperty.call(obj, "const")
  );
}

function evalResolvableSpec(spec: Record<string, any>, ctx: ResolveContext) {
  if (Object.prototype.hasOwnProperty.call(spec, "const")) {
    return resolveResolvable(spec.const, ctx);
  }

  if (Object.prototype.hasOwnProperty.call(spec, "signal")) {
    return signalValue(String(spec.signal || ""), ctx);
  }

  if (Object.prototype.hasOwnProperty.call(spec, "pick")) {
    const pick = Array.isArray(spec.pick) ? spec.pick : [];
    if (!pick.length) return undefined;
    const w = Array.isArray(spec.w) ? spec.w.map((x) => Math.max(0, Number(x) || 0)) : [];
    const rng = createRng((ctx.seed ^ hashStringToSeed(String(ctx.path || "pick"))) >>> 0);
    if (w.length === pick.length && w.some((x) => x > 0)) {
      const total = w.reduce((acc, n) => acc + n, 0);
      let r = rng.float() * total;
      for (let i = 0; i < pick.length; i += 1) {
        r -= w[i];
        if (r <= 0) return resolveResolvable(pick[i], { ...ctx, path: `${ctx.path || "pick"}.pick[${i}]` });
      }
      return resolveResolvable(pick[pick.length - 1], { ...ctx, path: `${ctx.path || "pick"}.pick[last]` });
    }
    const idx = Math.max(0, Math.min(pick.length - 1, Math.floor(rng.float() * pick.length)));
    return resolveResolvable(pick[idx], { ...ctx, path: `${ctx.path || "pick"}.pick[${idx}]` });
  }

  if (Object.prototype.hasOwnProperty.call(spec, "lfo")) {
    const cfg = typeof spec.lfo === "object" && spec.lfo ? spec.lfo : {};
    const hz = Number(cfg.hz ?? cfg.freq ?? 1);
    const amp = Number(cfg.amp ?? 1);
    const bias = Number(cfg.bias ?? 0);
    const phase = Number(cfg.phase ?? 0);
    const wave = String(cfg.wave ?? "sine").toLowerCase();
    const t = Number(ctx.tMs) / 1000;
    const angle = 2 * Math.PI * hz * t + phase;
    let y = Math.sin(angle);
    if (wave === "tri" || wave === "triangle") {
      y = (2 / Math.PI) * Math.asin(Math.sin(angle));
    } else if (wave === "saw") {
      const x = angle / (2 * Math.PI);
      y = 2 * (x - Math.floor(x + 0.5));
    }
    return bias + y * amp;
  }

  if (Object.prototype.hasOwnProperty.call(spec, "mul")) {
    const parts = Array.isArray(spec.mul) ? spec.mul : [spec.mul];
    let out = 1;
    for (let i = 0; i < parts.length; i += 1) {
      const v = Number(resolveResolvable(parts[i], { ...ctx, path: `${ctx.path || "mul"}.mul[${i}]` }));
      out *= Number.isFinite(v) ? v : 1;
    }
    return out;
  }

  if (Object.prototype.hasOwnProperty.call(spec, "add")) {
    const parts = Array.isArray(spec.add) ? spec.add : [spec.add];
    let out = 0;
    for (let i = 0; i < parts.length; i += 1) {
      const v = Number(resolveResolvable(parts[i], { ...ctx, path: `${ctx.path || "add"}.add[${i}]` }));
      out += Number.isFinite(v) ? v : 0;
    }
    return out;
  }

  if (Object.prototype.hasOwnProperty.call(spec, "map")) {
    const mapSignal = String(
      typeof spec.map === "string"
        ? spec.map
        : (spec.map?.signal ?? spec.signal ?? "amp")
    );
    const src = signalValue(mapSignal, ctx);
    const from = Array.isArray(spec.from) ? spec.from : [0, 1];
    const to = Array.isArray(spec.to) ? spec.to : [0, 1];
    const inMin = Number(from[0]);
    const inMax = Number(from[1]);
    const outMin = Number(resolveResolvable(to[0], { ...ctx, path: `${ctx.path || "map"}.to[0]` }));
    const outMax = Number(resolveResolvable(to[1], { ...ctx, path: `${ctx.path || "map"}.to[1]` }));
    const denom = inMax - inMin;
    const raw = Math.abs(denom) < 1e-9 ? 0 : (src - inMin) / denom;
    const eased = easeValue(raw, String(spec.ease || "linear"));
    return outMin + (outMax - outMin) * eased;
  }

  return undefined;
}

export function resolveResolvable(value: any, ctx: ResolveContext): any {
  if (Array.isArray(value)) {
    return value.map((v, i) => resolveResolvable(v, { ...ctx, path: `${ctx.path || "root"}[${i}]` }));
  }
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, any>;
  if (isResolvableSpec(obj)) return evalResolvableSpec(obj, ctx);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = resolveResolvable(v, { ...ctx, path: ctx.path ? `${ctx.path}.${k}` : k });
  }
  return out;
}
