import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULTS,
  engineParams,
  ensureLayers,
  getSoundParam,
  migrateParamsShape,
  serializeParams,
  setSoundParam,
} from "../../web/static/params.js";
import { GenerationEngine, layerMixPlan } from "../../web/static/synth.js";
import { FACTORY_PRESETS } from "../../web/static/factory-presets.js";

const project = note => ({
  degree: note.degree,
  frequency: note.frequency,
  durationDivs: note.durationDivs,
  velocity: note.velocity,
  beatDivisions: note.beatDivisions,
  isRest: note.isRest,
  isSurprise: note.isSurprise,
  layers: note.layerRenders?.map(layer => ({ id: layer.id, gain: layer.gain, space: layer.space })) || [],
});

function notes(params, count = 64) {
  const engine = new GenerationEngine(params);
  engine.initialise();
  return Array.from({ length: count }, () => project(engine.nextNote()));
}

test("legacy and unified shapes generate identical notes", () => {
  const legacy = {
    ...DEFAULTS,
    seed: 12345,
    layers: [{
      id: "second", gain: 0.7, solo: false,
      subnote: { spectralProfile: "cello", envelopeAttack: 0.02, effectsChain: [] },
      space: { angle: -30, dist: 3.2 },
    }],
  };
  assert.deepEqual(notes(migrateParamsShape(legacy)), notes(legacy));
});

test("sound accessors round-trip legacy base, legacy layer, and unified selection", () => {
  const legacy = { voiceMode: "fourier", layers: [{ id: "x", subnote: { voiceMode: "formant" } }] };
  setSoundParam(legacy, null, "voiceMode", "formant");
  setSoundParam(legacy, "x", "voiceMode", "fourier");
  assert.equal(getSoundParam(legacy, null, "voiceMode"), "formant");
  assert.equal(getSoundParam(legacy, "x", "voiceMode"), "fourier");

  const unified = migrateParamsShape({ ...DEFAULTS });
  const second = { ...unified.layers[0], id: "second", sound: { ...unified.layers[0].sound } };
  unified.layers.push(second);
  unified.selectedLayerId = second.id;
  unified.voiceMode = "formant";
  assert.equal(unified.layers[0].sound.voiceMode, "fourier");
  assert.equal(second.sound.voiceMode, "formant");
  assert.equal(getSoundParam(unified, second.id, "voiceMode"), "formant");
});

test("selection is transient and cannot alter engine-visible params", () => {
  const params = migrateParamsShape({ ...DEFAULTS, seed: 99991, layers: [{ id: "x", subnote: { spectralProfile: "flute" } }] });
  const before = engineParams(params);
  params.selectedLayerId = params.layers[1].id;
  const after = engineParams(params);
  assert.deepEqual(after, before);
  assert.equal(Object.hasOwn(serializeParams(params), "selectedLayerId"), false);
});

test("migration and dual-write serialization converge", () => {
  const old = { ...DEFAULTS, spectralProfileName: "Lead", baseLayerGain: 0.72, baseLayerSolo: true,
    spaceAzimuth: 42, spaceDistance: 4.5,
    layers: [{ id: "x", subnote: { voiceMode: "formant", effectsChain: [] }, gain: 0.4, space: { angle: -20, dist: 2 } }] };
  const migrated = migrateParamsShape(old);
  const serialized = serializeParams(migrated);
  const reloaded = migrateParamsShape(serialized);
  assert.deepEqual(ensureLayers(serializeParams(reloaded)).layers, ensureLayers(serialized).layers);
  assert.equal(serialized.voiceMode, migrated.layers[0].sound.voiceMode);
  assert.equal(serialized.baseLayerGain, 0.72);
  assert.equal(serialized.spaceAzimuth, 42);
});

test("layer mix plan dual-reads gain and solo", () => {
  const legacy = { baseLayerGain: 0.6, baseLayerSolo: false };
  const unified = migrateParamsShape({ ...DEFAULTS, baseLayerGain: 0.6 });
  const renders = [{ id: "x", gain: 0.8, solo: true }];
  assert.deepEqual(layerMixPlan(unified, renders), layerMixPlan(legacy, renders));
});

test("converged alto sax is frozen as an interim factory sound", () => {
  const preset = FACTORY_PRESETS.find(row => row.id === "factory-sub-alto-sax-sg2");
  assert.ok(preset);
  assert.equal(preset.section, "sound");
  assert.equal(preset.parameters.resonatorClass, "conicalTube");
  assert.equal(preset.parameters.dynamicBlare, 1.0294720710325107);
  assert.ok(preset.tags.includes("interim"));
});
