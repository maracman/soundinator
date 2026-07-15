/**
 * DOM-free parameter shape helpers.
 *
 * The canonical studio model stores every tonal source in layers[], including
 * the former base voice at layers[0]. Legacy flat patches remain readable and
 * serialization carries a temporary flat mirror for older clients.
 */

export const MELODY_PARAMS = new Set([
  "scaleMode", "scalePreset", "customDegrees", "edoDivisions", "tonicHz",
  "degreeTuning", "subScaleNotes", "subScaleWeight", "rootNotes",
  "rootPullStrength", "rootPullShape", "intervalPeakedness", "intervalRange",
  "momentum", "registerCenter", "registerWidth", "registerSkew", "precision",
  "precisionRange", "motifHitProb", "motifHitRange", "melodyPattern",
  "arpStep", "arpOctaves",
]);

export const RHYTHM_PARAMS = new Set([
  "tempo", "beatDivisions", "onBeatProb", "offBeatProb", "sameLengthProb",
  "restMotifStartRatio", "restOnMeterRatio", "restOffMeterRatio", "gapProb",
  "gapMin", "gapMax", "gapDistanceSlope", "gapTimingRange", "phraseGap",
  "slideSpeed",
]);

export const SURPRISE_EXTRAS = new Set([
  "motifCount", "motifLengthBeats", "motifLength", "sequenceProb",
  "motifSurpriseProb", "incorporationRate", "melSurpriseAmount",
  "tunSurpriseAmount", "durSurpriseAmount", "dynSurpriseAmount",
]);

export function sectionForParam(key) {
  if (key === "seed" || key === "layers" || key === "selectedLayerId") return null;
  if (key.startsWith("reverb") || key.startsWith("space")) return "space";
  if (key === "pinnaScale" || key === "earModel") return "space";
  if (key.startsWith("perc")) return "percussion";
  if (key.startsWith("surprise") || SURPRISE_EXTRAS.has(key)) return "surprise";
  if (key.startsWith("dynamics") || key === "loudnessRange") return "dynamics";
  if (RHYTHM_PARAMS.has(key)) return "rhythm";
  if (MELODY_PARAMS.has(key)) return "melody";
  return "sound";
}

export function extractSectionParams(params = {}, section) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (sectionForParam(key) === section) out[key] = value;
  }
  return out;
}

export const CAPTURE_PARTS = ["notes", "space", "stave", "clef", "percussion"];
const SCALE_CAPTURE_KEYS = new Set([
  "scaleMode", "scalePreset", "customDegrees", "edoDivisions", "tonicHz",
  "degreeTuning", "subScaleNotes", "subScaleWeight", "rootNotes",
  "rootPullStrength", "rootPullShape",
]);

export function capturePartForParam(key) {
  if (SCALE_CAPTURE_KEYS.has(key)) return "clef";
  const section = sectionForParam(key);
  if (section === "sound") return "notes";
  if (section === "space") return "space";
  if (section === "percussion") return "percussion";
  if (["melody", "rhythm", "dynamics", "surprise"].includes(section)) return "stave";
  return null;
}

function hasAssignedPercussion(params = {}) {
  if (Array.isArray(params.percLayers) && params.percLayers.some(layer => layer?.sound)) return true;
  return Object.entries(params).some(([key, value]) =>
    key.startsWith("perc") && key !== "percLayers" && value != null &&
    value !== false && value !== 0 && value !== "");
}

export function capturePartsFor(params = {}, section = "full", explicit = null) {
  const out = Object.fromEntries(CAPTURE_PARTS.map(part => [part, false]));
  const source = params?.layers?.[0]?.sound
    ? { ...params, ...params.layers[0].sound }
    : params;
  for (const key of Object.keys(source || {})) {
    const part = capturePartForParam(key);
    if (part) out[part] = true;
  }
  if (explicit) {
    for (const part of CAPTURE_PARTS) if (part in explicit) out[part] = !!explicit[part];
  }
  if (section === "sound") out.notes = true;
  if (section === "space") out.space = true;
  if (["rhythm", "dynamics", "surprise"].includes(section)) out.stave = true;
  if (section === "melody") { out.stave = true; out.clef = true; }
  if (section === "percussion") out.percussion = true;
  if (!hasAssignedPercussion(source)) out.percussion = false;
  return out;
}

export function extractInstrumentParams(params = {}) {
  const out = {};
  for (const [key, value] of Object.entries(serializeParams(params))) {
    if (key !== "seed" && key !== "tempo") out[key] = value;
  }
  return out;
}

export function cloneFxChain(chain) {
  return Array.isArray(chain)
    ? chain.map(fx => ({ ...fx, params: { ...(fx?.params || {}) } }))
    : [];
}

export function soundHalf(params = {}, selectedLayerId = null) {
  if (params?.layers?.[0]?.sound) {
    const selected = params.layers.find(layer => layer.id === (selectedLayerId ?? params.selectedLayerId))
      || params.layers[0];
    return { ...(selected.sound || selected.subnote || {}) ,
      effectsChain: cloneFxChain((selected.sound || selected.subnote || {}).effectsChain) };
  }
  const half = extractSectionParams(params, "sound");
  for (const key of Object.keys(half)) {
    if (key.startsWith("layer") || key.startsWith("baseLayer") ||
        key === "spectralProfileName" || key === "spaceAzimuth" ||
        key === "spaceDistance") delete half[key];
  }
  if ("effectsChain" in half) half.effectsChain = cloneFxChain(half.effectsChain);
  return half;
}

function layerId(fallback = "base") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return fallback;
}

function normalizeLayer(layer, index) {
  const sound = layer?.sound || layer?.subnote || {};
  const { subnote: _legacySubnote, ...rest } = layer || {};
  return {
    ...rest,
    id: layer?.id || (index === 0 ? "base" : `layer-${index + 1}`),
    hue: layer?.hue ?? ((36 + index * 70) % 360),
    sound: { ...sound, effectsChain: cloneFxChain(sound.effectsChain) },
    space: {
      angle: layer?.space?.angle ?? 0,
      dist: layer?.space?.dist ?? 2.5,
    },
    gain: layer?.gain ?? (index === 0 ? 1 : 0.8),
    solo: !!layer?.solo,
  };
}

export function ensureLayers(params = {}) {
  if (params?.layers?.[0]?.sound) {
    const layers = params.layers.map(normalizeLayer);
    return { ...params, layers };
  }
  const extras = Array.isArray(params.layers) ? params.layers : [];
  const base = normalizeLayer({
    id: "base",
    name: params.spectralProfileName,
    hue: 36,
    sound: soundHalf(params),
    space: {
      angle: params.spaceAzimuth ?? 0,
      dist: params.spaceDistance ?? 2.5,
    },
    gain: params.baseLayerGain ?? 1,
    solo: !!params.baseLayerSolo,
  }, 0);
  return {
    ...params,
    layers: [base, ...extras.map((layer, index) => normalizeLayer(layer, index + 1))],
  };
}

/**
 * Return the engine's legacy-flat working view. The public/canonical shape is
 * unchanged; this is the single compatibility adapter used by synth.js.
 */
export function engineParams(params = {}) {
  if (params?._engineParamsView) return params;
  const unified = ensureLayers(params);
  const base = unified.layers[0];
  const sound = base?.sound || {};
  return {
    ...unified,
    _engineParamsView: true,
    ...sound,
    spaceAzimuth: base?.space?.angle ?? 0,
    spaceDistance: base?.space?.dist ?? 2.5,
    baseLayerGain: base?.gain ?? 1,
    baseLayerSolo: !!base?.solo,
    layers: unified.layers.slice(1).map(layer => ({
      ...layer,
      subnote: layer.sound || layer.subnote || {},
    })),
  };
}

export function getSoundParam(params, selectedLayerId, key) {
  if (!params?.layers?.[0]?.sound) {
    if (selectedLayerId == null || selectedLayerId === "base") return params?.[key];
    const layer = params?.layers?.find(item => item.id === selectedLayerId);
    return (layer?.subnote || layer?.sound || {})[key];
  }
  const layer = params.layers.find(item => item.id === selectedLayerId) || params.layers[0];
  return (layer.sound || layer.subnote || {})[key];
}

export function setSoundParam(params, selectedLayerId, key, value) {
  if (!params?.layers?.[0]?.sound) {
    if (selectedLayerId == null || selectedLayerId === "base") params[key] = value;
    else {
      const layer = params?.layers?.find(item => item.id === selectedLayerId);
      if (layer) (layer.subnote || (layer.subnote = {}))[key] = value;
    }
    return value;
  }
  const layer = params.layers.find(item => item.id === selectedLayerId) || params.layers[0];
  (layer.sound || (layer.sound = {}))[key] = value;
  return value;
}

function soundKeys(params) {
  const keys = new Set(Object.keys(DEFAULTS).filter(key => sectionForParam(key) === "sound"));
  for (const layer of params.layers || []) {
    for (const key of Object.keys(layer.sound || layer.subnote || {})) keys.add(key);
  }
  for (const key of ["spectralProfileName", "spaceAzimuth", "spaceDistance",
    "baseLayerGain", "baseLayerSolo"]) keys.add(key);
  return keys;
}

/**
 * Install transient compatibility accessors used by app.js. They are
 * deliberately non-enumerable, so saves and engine calls never recreate the
 * old flat sound half. Selection changes retarget them automatically.
 */
export function attachSoundParamAccessors(params) {
  if (!params?.layers?.[0]?.sound) return params;
  const initial = params.selectedLayerId;
  Object.defineProperty(params, "selectedLayerId", {
    configurable: true, enumerable: false, writable: true,
    value: params.layers.some(layer => layer.id === initial) ? initial : params.layers[0].id,
  });
  for (const key of soundKeys(params)) {
    if (Object.getOwnPropertyDescriptor(params, key)?.get) continue;
    delete params[key];
    Object.defineProperty(params, key, {
      configurable: true,
      enumerable: false,
      get() {
        const layer = this.layers.find(item => item.id === this.selectedLayerId) || this.layers[0];
        if (key === "spectralProfileName") return layer?.name;
        if (key === "spaceAzimuth") return layer?.space?.angle;
        if (key === "spaceDistance") return layer?.space?.dist;
        if (key === "baseLayerGain") return this.layers[0]?.gain;
        if (key === "baseLayerSolo") return this.layers[0]?.solo;
        return (layer?.sound || {})[key];
      },
      set(value) {
        const layer = this.layers.find(item => item.id === this.selectedLayerId) || this.layers[0];
        if (!layer) return;
        if (key === "spectralProfileName") { layer.name = value; return; }
        if (key === "spaceAzimuth") { layer.space = { ...(layer.space || {}), angle: value }; return; }
        if (key === "spaceDistance") { layer.space = { ...(layer.space || {}), dist: value }; return; }
        if (key === "baseLayerGain") { this.layers[0].gain = value; return; }
        if (key === "baseLayerSolo") { this.layers[0].solo = value; return; }
        (layer.sound || (layer.sound = {}))[key] = value;
      },
    });
  }
  return params;
}

export function migrateParamsShape(params = {}) {
  const unified = ensureLayers(params);
  const out = { ...unified, layers: unified.layers.map(normalizeLayer) };
  for (const key of Object.keys(out)) {
    if (sectionForParam(key) === "sound" ||
        ["baseLayerGain", "baseLayerSolo", "spectralProfileName",
          "spaceAzimuth", "spaceDistance"].includes(key)) delete out[key];
  }
  return attachSoundParamAccessors(out);
}

export function serializeParams(params = {}) {
  const unified = ensureLayers(params);
  const base = unified.layers[0];
  const out = {};
  for (const [key, value] of Object.entries(unified)) {
    if (key !== "selectedLayerId") out[key] = value;
  }
  out.layers = unified.layers.map(layer => ({
    ...layer,
    sound: { ...(layer.sound || layer.subnote || {}) },
  }));
  Object.assign(out, base?.sound || {});
  out.baseLayerGain = base?.gain ?? 1;
  out.baseLayerSolo = !!base?.solo;
  if (base?.name) out.spectralProfileName = base.name;
  out.spaceAzimuth = base?.space?.angle ?? 0;
  out.spaceDistance = base?.space?.dist ?? 2.5;
  return out;
}

export function enginePlayParams(params) {
  return { ...params, layers: (params.layers || []).map(layer => ({
    ...layer, sound: { ...(layer.sound || layer.subnote || {}) },
  })) };
}

function percLayerId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID() : `perc_${Math.random().toString(36).slice(2)}`;
}

export function ensurePercLayers(params) {
  if (Array.isArray(params.percLayers) && params.percLayers.length) return params.percLayers;
  return [
    { id: percLayerId(), role: "beat", vol: Number(params.percBeatVol) || 0,
      sound: { kind: "sample", key: params.percBeatSound || "click" }, space: null },
    { id: percLayerId(), role: "motif", vol: Number(params.percMotifVol) || 0,
      sound: { kind: "sample", key: params.percMotifSound || "bell" }, space: null },
    { id: percLayerId(), role: "downbeat", vol: Number(params.percDownbeatVol) || 0,
      sound: { kind: "sample", key: params.percDownbeatSound || "wood" }, space: null,
      every: params.percDownbeatEvery || 4 },
  ];
}

export function resolvePercEnabled(params) {
  const audible = Array.isArray(params.percLayers)
    ? params.percLayers.some(layer => (Number(layer.vol) || 0) > 0)
    : (Number(params.percBeatVol) || 0) > 0 ||
      (Number(params.percMotifVol) || 0) > 0 ||
      (Number(params.percDownbeatVol) || 0) > 0;
  return typeof params.percEnabled === "boolean" ? params.percEnabled : audible;
}

export const DEFAULTS = {
  tempo: 104,
  seed: 1001,
  voiceMode: "fourier",
  scaleMode: "12tone",
  scalePreset: "major",
  edoDivisions: 12,
  customDegrees: null,
  degreeTuning: null, // per-degree cent offsets from the EDO grid (world tunings / hand-tuned)
  subScaleNotes: [0, 4, 7],
  subScaleWeight: 0.7,
  tonicHz: 261.63,
  intervalPeakedness: 2.0,
  melodyPattern: "walk",
  attackNoiseLevel: 1,
  attackNoiseDirect: 0,
  attackNoiseVelocityExponent: 1,
  arpStep: 2,
  arpOctaves: 1,
  intervalRange: 7,
  momentum: 0,
  motifHitProb: 0.92,
  motifHitRange: 2,
  precision: 0.9,
  precisionRange: 12,
  surpriseProb: 0.08,
  surpriseDimensions: ["pitch"],
  surprisePitchEnabled: true,
  surpriseTuningEnabled: false,
  surpriseRhythmEnabled: false,
  surpriseFormantEnabled: false,
  surpriseDynamicsEnabled: false,
  surpriseRestEnabled: false,
  surprisePitchWeight: 1,
  surpriseTuningWeight: 0.45,
  surpriseRhythmWeight: 0.45,
  surpriseFormantWeight: 0.45,
  surpriseDynamicsWeight: 0.35,
  surpriseRestWeight: 0.2,
  melSurpriseAmount: 0.5,
  tunSurpriseAmount: 0.5,
  durSurpriseAmount: 0.5,
  dynSurpriseAmount: 0.5,
  dynamicsHitRange: 22,
  surprisePitchDistance: 1,
  surpriseTuningDistance: 0.9,
  surpriseRhythmDistance: 0.8,
  surpriseFormantDistance: 0.85,
  surpriseDynamicsDistance: 0.85,
  surpriseAllowMultiple: false,
  incorporationRate: 0.4,
  surpriseMaxBaked: "Infinity",
  activeFormants: ["ah"],
  formantWeights: null,
  formantChangeProb: 0.05,
  formantFocus: "ah",
  formantEditAll: true,
  formantAccuracy: 0.85,
  formantAccuracyRange: 1,
  formantAccuracyByFormant: null,
  formantRangeByFormant: null,
  surpriseFormantDistanceByFormant: null,
  dynamicsLevel: 0.62,
  loudnessRange: 0.6,
  dynamicsPrecision: 0.75,
  dynamicsRange: 0.22,
  motifCount: 3,
  motifLengthBeats: 4,
  sequenceProb: 0.8,
  motifSurpriseProb: 0.1,
  // Rhythm
  beatDivisions: 1,
  onBeatProb: 0.8,
  offBeatProb: 0.2,
  sameLengthProb: 0.4,
  restMotifStartRatio: 0,
  restOnMeterRatio: 0,
  restOffMeterRatio: 0,
  // Root pull
  rootNotes: [0],
  rootPullStrength: 0,
  rootPullShape: 0.7,
  // Register
  registerCenter: 0,
  registerWidth: 12,
  registerSkew: 0,
  // Percussion
  percBeatVol: 0,
  percBeatSound: "click",
  percMotifVol: 0,
  percMotifSound: "bell",
  percDownbeatVol: 0,
  percDownbeatSound: "wood",
  percDownbeatEvery: 4,
  // Percussion v2 (owner 2026-07-10): a layer list supersedes the fixed
  // Beat/Motif/Downbeat trio above. null = derive from those legacy fields on
  // first load (ensurePercLayers). The on/off state is NOT stored here — it is
  // resolved (resolvePercEnabled): absent → infer from audible content, so
  // legacy patches with percussion stay ON while fresh patches start silent.
  percLayers: null,
  // Percussion is its own sound source in space (producer LAYERS view). null =
  // sit at the patch's own position (owner 2026-07-09).
  percAzimuth: null,
  percDistance: null,
  // Space
  reverbType: "room",
  // A touch of room by default: a completely dry first play sounds clinical
  // to newcomers, and the space is easy to remove.
  reverbWet: 0.16,
  reverbDecay: 1.4,
  reverbTone: 0.6,
  reverbPreDelay: 0.015,
  // Sub-note tone-colour imperfections
  toneColorProb: 0.25,
  toneFormantDrift: 0.08,
  toneResonanceDrift: 0.12,
  toneBreath: 0.03,
  vibratoProb: 0.35,
  vibratoDepth: 18,
  vibratoDepthSd: 5,
  vibratoRate: 5.5,
  vibratoRateSd: 0.7,
  spectralProfile: "violin",
  // Tone v2 excitation (T2): how energy enters the resonator. Defaults
  // match the default profile (violin); choosing a profile re-seats them.
  excitationType: "bow",
  excitationPosition: 0.13,
  excitationHardness: 0.6,
  excitationHuman: 0.4,
  // Sound Generator 2.0 model extensions are neutral until a fitted preset
  // opts in, preserving every existing factory/user sound.
  velocityHardnessCoupling: 0,
  breathNoiseColor: 0,
  dynamicBlare: 0,
  decaySecondStage: 0,
  decaySecondRatio: 1,
  glottalTilt: 0,
  singerFormantAmount: 0,
  voiceBreathSync: 0,
  partialTransfer: 0.15,
  bodyType: "auto",
  bodyArticulation: 0,
  // null = derive from legacy spectralStretchCents; a finite value wins
  partialB: null,
  // SPACE positioning: where the instrument stands relative to the listener
  spaceDistance: 2.5,
  spaceAzimuth: 0,
  // Global-space thread behaviour belongs to the patch/region. Centered makes
  // the thread the constellation's centre; additive carries the patch's own
  // offsets along the thread. The global designer owns threads, never this
  // choice (owner 2026-07-10).
  spaceMovement: "centered",
  earDistance: 0.175, // Q4: listener ear-to-ear span in metres (head size IS this)
  headDensity: 0.5,   // Q4: how hard the head shadows the far ear (0 = transparent)
  spaceOwnHead: false, // owner 07-07: keep THIS patch's head even when the global space is on
  earModel: "average",  // owner 07-07 round 3: which EAR_MODELS preset the head params came from
  pinnaScale: 1,        // Shaw pinna cue scale (ear models; 0 = bare sphere)
  reverbSize: null,     // room designer — null = the picked room's own character
  reverbDamping: null,
  reverbDiffusion: null,
  // EFFECTS stage (docs/EFFECTS_CONTRACT.md): per-layer ordered effect stack,
  // sitting between BODY and SPACE. Each entry {uid,type,enabled,wet,params}.
  effectsChain: [],
  stageEffectsOn: true,   // whole-stage bypass toggle (rail power button)
  baseLayerGain: 1,       // base source mix, parallel to each extra layer's gain
  baseLayerSolo: false,   // base participates in the same solo set as extra layers
  layers: null,           // Q7: extra subnote modules [{id, hue, subnote, space, gain, independentHead}]
  layerEnvOverride: false, // Q7: true = ONE variation trigger shared by base + all layers (own means kept)
  layerEnvProb: 0.5,       // Q7: the shared variation chance when layerEnvOverride is on
  layerEnvAttackSd: 0.015,  // shared variation SDs — one magnitude per envelope
  layerEnvDecaySd: 0.04,    // parameter for the base and every layer while
  layerEnvSustainSd: 0.08,  // synchronisation is on (owner 07-07)
  layerEnvReleaseSd: 0.05,
  spectralProb: 1,
  spectralMix: 0.65,
  spectralPartials: 20,
  // Renderer-only audibility floor; fitted prints remain full resolution.
  spectralCullThreshold: 0.0005,
  spectralSpread: 0.45,
  spectralPartialMeans: null,
  spectralPartialSds: null,
  spectralPartialDyns: null,
  spectralPartialRegs: null,
  spectralDynamicAmount: 0.8,
  spectralRegisterAmount: 0.55,
  spectralResonanceAmount: 0.35,
  spectralLoudnessNorm: 0.65,
  // Material damping law: 0 = glass/metal (all partials ring), 1 = wood/felt
  // (high partials die fast). Per-instrument defaults ride the profile.
  partialMaterial: 0.45,
  // Partial macros: transforms over the whole harmonic set (see
  // docs/PARTIAL_MACROS_DESIGN.md). Tilt = spectral slope; odd/even
  // balance; comb = movable boost of a related-frequency group; six
  // octave-group faders (1 | 2 | 3-4 | 5-8 | 9-16 | 17+).
  partialTilt: 0,
  partialOddEven: 0,
  partialComb: 0,
  partialCombFreq: 4,
  partialGroup1: 1, partialGroup2: 1, partialGroup3: 1,
  partialGroup4: 1, partialGroup5: 1, partialGroup6: 1,
  // 5-formant bank detail (formant mode): F3-F5 trims + bandwidth scale.
  formantF3Level: 1,
  formantF4Level: 1,
  formantF5Level: 1,
  formantBandwidth: 1,
  spectralDriftProb: 1,
  spectralDriftDepth: 0.35,
  spectralDriftRate: 6,
  spectralStretchCents: 0,
  envelopeProb: 0.35,
  envelopeRange: 0.2,
  envelopeAttack: 0.008,
  envelopeAttackSd: 0.006,
  envelopeDecay: 0.04,
  envelopeDecaySd: 0.018,
  envelopeSustain: 0.6,
  envelopeSustainSd: 0.08,
  envelopeRelease: 0.12,
  envelopeReleaseSd: 0.035,
  // Articulation gaps
  gapProb: 1,
  gapMin: 0.15,
  gapMax: 0.15,
  gapDistanceSlope: 0,
  gapTimingRange: 0,
  slideSpeed: 0.65,
  noteConnection: "glide",
  phraseGap: 0.15,
};
