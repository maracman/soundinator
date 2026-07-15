#!/usr/bin/env node
/** Reproducible T-B7 model/oscillator/automation benchmark for factory sounds. */

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { FACTORY_PRESETS } from "../../web/static/factory-presets.js";
import { DEFAULTS } from "../../web/static/params.js";
import {
  GenerationEngine,
  humanFluctuationTrace,
  partialFrequency,
} from "../../web/static/synth.js";

function args(argv) {
  const result = { preset: "factory-sub-alto-sax-sg2", iterations: 2000, threshold: null, out: null };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    if (!(key in result) || argv[i + 1] == null) throw new Error(`unknown/incomplete argument: ${argv[i]}`);
    result[key] = ["iterations", "threshold"].includes(key) ? Number(argv[i + 1]) : argv[i + 1];
  }
  return result;
}

function activePartials(note, sampleRate = 48000) {
  const norm = Math.max(0.001, note.spectralReferenceNorm || 1);
  return (note.harmonicPartials || []).filter(part => {
    const harmonic = part.harmonic || 1;
    const freq = note.frequency * partialFrequency(harmonic, 1, note.partialB || 0,
      note.resonatorClass || "string");
    const threshold = note.spectralCullThreshold ?? 0.0005;
    return freq <= sampleRate * 0.45 && freq <= 16000 &&
      (harmonic <= 8 || Math.max(part.amp, part.mean) / norm >= threshold);
  }).length;
}

function measure(preset, iterations) {
  const parameters = { ...DEFAULTS, ...preset.parameters, seed: 7331 };
  const engine = new GenerationEngine(parameters);
  engine.initialise();
  for (let i = 0; i < 100; i++) engine._subNoteVariation(.62, 261.63, 0, null);
  const started = performance.now();
  let note;
  const oscillatorSamples = [];
  const sampleStart = Math.max(0, iterations - Math.min(256, iterations));
  for (let i = 0; i < iterations; i++) {
    note = engine._subNoteVariation(.62, 261.63, 0, null);
    if (i >= sampleStart) {
      note.frequency = 261.63;
      oscillatorSamples.push(activePartials(note));
    }
  }
  const modelMsPerNote = (performance.now() - started) / iterations;
  oscillatorSamples.sort((a, b) => a - b);
  const oscillators = oscillatorSamples[Math.ceil(oscillatorSamples.length * .95) - 1];
  const trace = humanFluctuationTrace(() => .731, 1.5,
    note.excitationType || parameters.excitationType, note.excitationHuman || 0);
  const automationEventsPerNote = oscillators * (1 + trace.length);
  return { id: preset.id, modelMsPerNote, oscillators, automationEventsPerNote,
    oscillatorStatistic: "p95 over final 256 seeded notes" };
}

const options = args(process.argv.slice(2));
const sounds = FACTORY_PRESETS.filter(row => row.section === "sound");
const factorySelected = sounds.find(row => row.id === options.preset);
if (!factorySelected) throw new Error(`unknown sound preset: ${options.preset}`);
const selected = Number.isFinite(options.threshold)
  ? { ...factorySelected, parameters: { ...factorySelected.parameters, spectralCullThreshold: options.threshold } }
  : factorySelected;
const baselines = sounds.filter(row => row.id !== factorySelected.id).map(row => measure(row, options.iterations));
const result = measure(selected, options.iterations);
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const baseline = {
  modelMsPerNote: median(baselines.map(row => row.modelMsPerNote)),
  oscillators: median(baselines.map(row => row.oscillators)),
  automationEventsPerNote: median(baselines.map(row => row.automationEventsPerNote)),
};
const report = {
  schema: "sg2-resource-benchmark-1",
  iterations: options.iterations,
  preset: result,
  medianExistingFactorySound: baseline,
  ratios: {
    modelMath: result.modelMsPerNote / baseline.modelMsPerNote,
    oscillators: result.oscillators / baseline.oscillators,
    automation: result.automationEventsPerNote / Math.max(1, baseline.automationEventsPerNote),
  },
};
report.tripwires = {
  modelMathUnder4ms: result.modelMsPerNote <= 4,
  oscillatorsWithin1_25x: report.ratios.oscillators <= 1.25,
  automationWithin1_25x: report.ratios.automation <= 1.25,
};
report.passed = Object.values(report.tripwires).every(Boolean);
const json = JSON.stringify(report, null, 2) + "\n";
if (options.out) await writeFile(options.out, json);
process.stdout.write(json);
