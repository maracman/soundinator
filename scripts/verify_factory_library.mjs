// Factory-library release gate. Run with:
//   node scripts/verify_factory_library.mjs
//
// This deliberately has no browser/DOM dependency. It validates that factory
// content remains loadable by the current flat preset loader, that its module
// claims are structurally true, and that full patches produce deterministic
// musical event streams under a fixed fixture.

import { FACTORY_CATALOG_TARGETS, FACTORY_PRESETS } from "../web/static/factory-presets.js";
import { GenerationEngine } from "../web/static/synth.js";
import { DEFAULTS } from "../web/static/params.js";

let failures = 0;
const check = (name, condition, detail = "") => {
  if (!condition) { failures++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

function defaultKeys() {
  return new Set(Object.keys(DEFAULTS));
}

const validSections = new Set(["sound", "melody", "rhythm", "dynamics", "surprise", "percussion", "space", "full"]);
const melodyKeys = new Set(["scaleMode", "scalePreset", "customDegrees", "edoDivisions", "tonicHz", "degreeTuning", "subScaleNotes", "subScaleWeight", "rootNotes", "rootPullStrength", "rootPullShape", "intervalPeakedness", "intervalRange", "momentum", "registerCenter", "registerWidth", "registerSkew", "precision", "precisionRange", "motifHitProb", "motifHitRange", "melodyPattern", "arpStep", "arpOctaves"]);
const rhythmKeys = new Set(["tempo", "beatDivisions", "onBeatProb", "offBeatProb", "sameLengthProb", "restMotifStartRatio", "restOnMeterRatio", "restOffMeterRatio", "gapProb", "gapMin", "gapMax", "gapDistanceSlope", "gapTimingRange", "phraseGap", "slideSpeed", "noteConnection"]);
const surpriseExtraKeys = new Set(["motifCount", "motifLengthBeats", "motifLength", "sequenceProb", "motifSurpriseProb", "incorporationRate", "melSurpriseAmount", "tunSurpriseAmount", "durSurpriseAmount", "dynSurpriseAmount"]);
function sectionFor(key) {
  if (key === "seed") return null;
  if (key.startsWith("reverb") || key.startsWith("space") || key === "pinnaScale" || key === "earModel") return "space";
  if (key.startsWith("perc")) return "percussion";
  if (key.startsWith("surprise") || surpriseExtraKeys.has(key)) return "surprise";
  if (key.startsWith("dynamics") || key === "loudnessRange") return "dynamics";
  if (rhythmKeys.has(key)) return "rhythm";
  if (melodyKeys.has(key)) return "melody";
  return "sound";
}

const BASE = {
  seed: 20260710, tempo: 96, beatDivisions: 2,
  motifCount: 3, motifLengthBeats: 4, sequenceProb: 0.8, motifSurpriseProb: 0.1,
  scaleMode: "12tone", scalePreset: "major", customDegrees: null, edoDivisions: 12,
  tonicHz: 261.63, rootNotes: [0], voiceMode: "fourier", spectralProfile: "violin",
  activeFormants: ["ah"], onBeatProb: 0.8, offBeatProb: 0.2, sameLengthProb: 0.4,
  restMotifStartRatio: 0, restOnMeterRatio: 0, restOffMeterRatio: 0,
  surpriseProb: 0, surprisePitchEnabled: false, surpriseTuningEnabled: false,
  surpriseRhythmEnabled: false, surpriseFormantEnabled: false,
  surpriseDynamicsEnabled: false, surpriseRestEnabled: false,
  dynamicsLevel: 0.62, loudnessRange: 0.6, precision: 0.9, precisionRange: 12,
  intervalPeakedness: 2, intervalRange: 7, registerCenter: 0, registerWidth: 12,
  envelopeAttack: 0.008, envelopeDecay: 0.04, envelopeSustain: 0.6, envelopeRelease: 0.12,
};

function eventSignature(params) {
  const engine = new GenerationEngine({ ...BASE, ...params, seed: 424242 });
  const events = [];
  for (let i = 0; i < 20; i++) {
    const n = engine.nextNote();
    events.push([n.degree, n.durationDivs, Number(n.velocity.toFixed(6)), !!n.isRest, n.startDiv]);
  }
  return events;
}

console.log("Factory catalog shape");
const counts = FACTORY_PRESETS.reduce((out, item) => {
  out[item.section] = (out[item.section] || 0) + 1;
  return out;
}, {});
check("target total", FACTORY_PRESETS.length === FACTORY_CATALOG_TARGETS.total, `${FACTORY_PRESETS.length}`);
check("sound coverage", counts.sound === FACTORY_CATALOG_TARGETS.sound, `${counts.sound}`);
check("macro coverage", (counts.melody + counts.rhythm + counts.dynamics + counts.surprise + counts.percussion) === FACTORY_CATALOG_TARGETS.macro);
check("space coverage", counts.space === FACTORY_CATALOG_TARGETS.space, `${counts.space}`);
check("full patch coverage", counts.full === FACTORY_CATALOG_TARGETS.full, `${counts.full}`);

console.log("Schema, briefs and modular boundaries");
const defaults = defaultKeys();
const ids = new Set(), names = new Set(), modules = new Map();
for (const item of FACTORY_PRESETS) {
  check(`${item.id}: stable unique id`, /^factory-[a-z0-9-]+$/.test(item.id) && !ids.has(item.id));
  ids.add(item.id);
  check(`${item.id}: unique name`, typeof item.name === "string" && item.name.length > 2 && !names.has(item.name));
  names.add(item.name);
  check(`${item.id}: known section`, validSections.has(item.section));
  check(`${item.id}: descriptive metadata`, item.description?.length >= 12 && Array.isArray(item.tags) && item.tags.length > 0);
  check(`${item.id}: measurable brief`, Array.isArray(item.brief?.claims) && item.brief.claims.length > 0 && Number.isFinite(item.brief?.metrics?.minSoundedNotes));
  const unknown = Object.keys(item.parameters || {}).filter(k => !defaults.has(k));
  check(`${item.id}: parameters exist in DEFAULTS`, unknown.length === 0, unknown.join(", "));
  if (item.section !== "full") {
    const escaped = Object.keys(item.parameters || {}).filter(k => sectionFor(k) !== item.section);
    check(`${item.id}: stays within ${item.section}`, escaped.length === 0, escaped.join(", "));
    modules.set(item.id, item);
  }
}

console.log("Percussion modules");
for (const item of FACTORY_PRESETS.filter(p => p.section === "percussion")) {
  const layers = item.parameters.percLayers;
  check(`${item.id}: has expandable layers`, Array.isArray(layers) && layers.length > 0);
  const layerIds = new Set();
  for (const l of layers || []) {
    check(`${item.id}/${l.id}: unique role layer`, typeof l.id === "string" && !layerIds.has(l.id));
    layerIds.add(l.id);
    check(`${item.id}/${l.id}: valid trigger`, ["beat", "motif", "downbeat"].includes(l.role));
    check(`${item.id}/${l.id}: audible bounded gain`, Number.isFinite(l.vol) && l.vol > 0 && l.vol <= 1);
    check(`${item.id}/${l.id}: valid hit`, l.sound?.kind === "sample" || (l.sound?.kind === "instrument" && l.sound.subnote));
  }
}

console.log("Full patch composition and deterministic generation");
for (const item of FACTORY_PRESETS.filter(p => p.section === "full")) {
  const refs = item.moduleIds || [];
  check(`${item.id}: module provenance`, refs.length >= 5 && refs.every(id => modules.has(id)));
  const expected = Object.assign({}, ...refs.map(id => modules.get(id).parameters), item.overrides || {});
  const same = JSON.stringify(expected) === JSON.stringify(item.parameters);
  check(`${item.id}: parameters resolve from modules`, same);
  const a = eventSignature(item.parameters);
  const b = eventSignature(item.parameters);
  check(`${item.id}: deterministic fixture`, JSON.stringify(a) === JSON.stringify(b));
  check(`${item.id}: yields sounded notes`, a.some(e => !e[3] && e[2] > 0));
}

if (failures) {
  console.error(`\n${failures} factory-library check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${FACTORY_PRESETS.length} factory-library checks passed.`);
