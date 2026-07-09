// Effects registry + host chain builder (docs/EFFECTS_CONTRACT.md).
// Modules register here via index.js; synth.js builds per-layer chains with
// buildChainGraph(); app.js renders browser/stack/faces from the registry.

export const EFFECT_CATEGORIES = [
  "Filter & EQ",
  "Drive & Dirt",
  "Modulation",
  "Delay & Echo",
  "Character",
];

const _byId = new Map();

export function registerEffect(mod) {
  if (!mod || !mod.id || typeof mod.build !== "function") {
    console.warn("effects: rejected malformed module", mod && mod.id);
    return;
  }
  _byId.set(mod.id, mod);
}

export function effectById(id) { return _byId.get(id) || null; }
export function allEffects() { return [..._byId.values()]; }

export function effectsByCategory() {
  const out = EFFECT_CATEGORIES.map((c) => ({ category: c, effects: [] }));
  for (const m of _byId.values()) {
    const slot = out.find((o) => o.category === m.category) || out[out.length - 1];
    slot.effects.push(m);
  }
  for (const o of out) o.effects.sort((a, b) => a.name.localeCompare(b.name));
  return out.filter((o) => o.effects.length);
}

let _uidCounter = 0;
export function newEffectInstance(typeId) {
  const mod = _byId.get(typeId);
  if (!mod) return null;
  return {
    uid: `fx-${(++_uidCounter).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    type: typeId,
    enabled: true,
    wet: Number.isFinite(mod.defaultWet) ? mod.defaultWet : 1,
    params: { ...mod.defaults },
  };
}

/** Sanitize a chain spec loaded from presets/storage: drop unknown types,
 *  clamp params into schema ranges, fill missing keys from defaults. */
export function sanitizeChain(chain) {
  if (!Array.isArray(chain)) return [];
  const out = [];
  for (const fx of chain) {
    const mod = fx && _byId.get(fx.type);
    if (!mod) continue;
    const params = { ...mod.defaults };
    for (const [k, sch] of Object.entries(mod.params || {})) {
      const v = Number(fx.params?.[k]);
      if (Number.isFinite(v)) params[k] = Math.min(sch.max, Math.max(sch.min, v));
    }
    out.push({
      uid: typeof fx.uid === "string" ? fx.uid : `fx-${(++_uidCounter).toString(36)}`,
      type: fx.type,
      enabled: fx.enabled !== false,
      wet: Number.isFinite(Number(fx.wet)) ? Math.min(1, Math.max(0, Number(fx.wet))) : 1,
      params,
    });
  }
  return out;
}

// ── Host graph ──────────────────────────────────────────────────────────
// One wrapper per effect: input splits to a dry gain and to the module's
// DSP whose output feeds a wet gain; both sum into the wrapper output.
// enabled:false → dry 1 / wet 0 (module keeps running silently so
// re-enabling is instant and click-free).

function buildWrapper(ctx, fx) {
  const mod = _byId.get(fx.type);
  if (!mod) return null;
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const graph = mod.build(ctx);
  input.connect(dry);
  dry.connect(output);
  input.connect(graph.input);
  graph.output.connect(wet);
  wet.connect(output);
  const w = { input, output, dry, wet, graph, type: fx.type, uid: fx.uid };
  applyWrapper(ctx, w, fx);
  return w;
}

function applyWrapper(ctx, w, fx) {
  const t = ctx.currentTime;
  const wetV = fx.enabled === false ? 0 : (fx.wet ?? 1);
  w.wet.gain.setTargetAtTime(wetV, t, 0.02);
  w.dry.gain.setTargetAtTime(1 - wetV, t, 0.02);
  w.graph.update({ ...fx.params });
}

/**
 * Build/refresh a serial effects chain between two fixed endpoints.
 * Returns a handle: { update(chainSpec, stageOn), dispose() }.
 * Structure changes (types/order/uids) rebuild the middle graph;
 * param/wet/enable changes apply in place, click-free.
 */
export function createChainHost(ctx, fxIn, fxOut) {
  let wrappers = [];
  let structKey = null;

  const wire = () => {
    try { fxIn.disconnect(); } catch {}
    let prev = fxIn;
    for (const w of wrappers) { prev.connect(w.input); prev = w.output; }
    prev.connect(fxOut);
  };

  return {
    update(chainSpec, stageOn = true) {
      const spec = Array.isArray(chainSpec) ? chainSpec.filter((fx) => _byId.has(fx.type)) : [];
      const key = stageOn ? spec.map((fx) => `${fx.uid}:${fx.type}`).join("|") : "";
      if (key !== structKey) {
        structKey = key;
        for (const w of wrappers) { try { w.graph.dispose(); } catch {} try { w.input.disconnect(); w.output.disconnect(); } catch {} }
        wrappers = stageOn ? spec.map((fx) => buildWrapper(ctx, fx)).filter(Boolean) : [];
        wire();
      }
      if (stageOn) {
        for (const fx of spec) {
          const w = wrappers.find((x) => x.uid === fx.uid);
          if (w) applyWrapper(ctx, w, fx);
        }
      }
    },
    dispose() {
      for (const w of wrappers) { try { w.graph.dispose(); } catch {} try { w.input.disconnect(); w.output.disconnect(); } catch {} }
      wrappers = [];
      structKey = null;
      try { fxIn.disconnect(); } catch {}
      try { fxIn.connect(fxOut); } catch {}
    },
  };
}
