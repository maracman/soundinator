/**
 * Offline, deterministic single-note rendering for Sound Generator 2.0.
 *
 * This intentionally schedules the same GenerationEngine fingerprint and
 * SynthEngine renderer used by live playback.  Only downstream presentation
 * settings are overridden: no effects/reverb, a one-metre frontal source and
 * a transparent parametric listener.
 */

import {
  GenerationEngine,
  SeededRNG,
  SynthEngine,
  maxPinnedNoiseLeadForParams,
  pinnedNoiseActivationReport,
  pinnedNoiseComponentsFor,
  pinnedNoiseEnvelopeAt,
  releaseRingSeconds,
  SPECTRAL_PROFILES,
} from "./synth.js";
import { DEFAULTS, engineParams } from "./params.js";

export const OFFLINE_NOTE_DEFAULTS = Object.freeze({
  midi: 60,
  velocity: 0.62,
  durationSec: 1.5,
  sampleRate: 48000,
});

export function midiToHz(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12);
}

function finite(value, fallback, lo, hi) {
  const n = Number(value);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : fallback));
}

function neutralParams(soundParams = {}) {
  const source = engineParams(soundParams);
  const merged = {
    ...DEFAULTS,
    ...source,
    voiceMode: source.voiceMode || "fourier",
    effectsChain: [],
    stageEffectsOn: false,
    layers: null,
    baseLayerGain: 1,
    baseLayerSolo: false,
    percEnabled: false,
    percLayers: [],
    reverbWet: 0,
    reverbPreDelay: 0,
    spaceDistance: 1,
    spaceAzimuth: 0,
    earModel: "average",
    headDensity: 0,
    pinnaScale: 0,
  };
  return engineParams(merged);
}

function seedNoiseBuffer(engine, seed) {
  if (!engine?._noiseBuffer) return;
  const rng = new SeededRNG((Number(seed) || 42) ^ 0xa511e9b3);
  for (let channel = 0; channel < engine._noiseBuffer.numberOfChannels; channel++) {
    const data = engine._noiseBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) data[i] = rng.next() * 2 - 1;
  }
}

/**
 * Render one note and resolve to an AudioBuffer.
 *
 * @param {object} soundParams flat or canonical layer-shaped parameters
 * @param {object} options midi, velocity, durationSec and sampleRate
 */
export async function renderNoteOffline(soundParams = {}, options = {}) {
  const midi = finite(options.midi, OFFLINE_NOTE_DEFAULTS.midi, 0, 127);
  const velocity = finite(options.velocity, OFFLINE_NOTE_DEFAULTS.velocity, 0.001, 1);
  const durationSec = finite(options.durationSec, OFFLINE_NOTE_DEFAULTS.durationSec, 0.03, 30);
  const sampleRate = Math.round(finite(options.sampleRate, OFFLINE_NOTE_DEFAULTS.sampleRate, 8000, 192000));
  const params = neutralParams(soundParams);
  const frequency = midiToHz(midi);
  const release = Math.max(0, Number(params.envelopeRelease) || 0);
  const baseRing = releaseRingSeconds(params.partialMaterial, frequency);
  const second = finite(params.decaySecondStage, 0, 0, 1);
  const ratio = finite(params.decaySecondRatio, 1, 1, 8);
  const ring = Math.min(3.5, baseRing * (1 + second * (ratio - 1) * 0.5));
  const profile = SPECTRAL_PROFILES[String(params.spectralProfile || "")];
  const componentActivation = new Map(pinnedNoiseActivationReport(
    profile, { ...params, velocity }, true).map(row => [row.id, row]));
  const componentRelease = pinnedNoiseComponentsFor(profile).reduce(
    (maximum, component) => {
      const active = componentActivation.get(component.id);
      return active?.applicable && active.active
        ? Math.max(maximum,
          pinnedNoiseEnvelopeAt(component, velocity).releaseMs / 1000)
        : maximum;
    }, 0);
  // The former fixed 20 ms pre-roll made a measured 50–300 ms component
  // physically impossible in offline/SHIP renders.  Keep 20 ms for presets
  // without L17 evidence and otherwise allocate the measured lead plus a
  // small scheduling margin.
  const requestedPreRoll = Number(options.preRollSec);
  const leadSec = Math.max(0.02,
    Number.isFinite(requestedPreRoll) ? Math.min(1, requestedPreRoll) : 0,
    maxPinnedNoiseLeadForParams(params, velocity) + 0.015);
  const tailSec = Math.max(0.25, release + ring + 0.08,
    componentRelease + 0.04);
  const frameCount = Math.ceil((leadSec + durationSec + tailSec) * sampleRate);
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error("OfflineAudioContext is unavailable in this browser");

  const context = new Offline(2, frameCount, sampleRate);
  const synth = new SynthEngine();
  synth.init(context, context.destination);
  synth.setLimiter(false);
  seedNoiseBuffer(synth, params.seed);

  synth._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
  synth._configureReverb(params);
  synth._percLayers = [];
  synth._percussionOnly = false;
  synth._engine = new GenerationEngine(params);
  synth._engine.initialise();

  const variation = synth._engine._subNoteVariation(velocity, frequency, 0, null);
  const note = {
    ...variation,
    frequency,
    velocity,
    duration: durationSec,
    degree: 0,
    intonationCents: 0,
    isRest: false,
    legatoFromPrevious: false,
    phraseStart: true,
    slideFromFrequency: null,
    slideDuration: 0,
    formant: params.formantFocus || "ah",
    formantPos: null,
  };
  synth._render(note, leadSec);
  return context.startRendering();
}
