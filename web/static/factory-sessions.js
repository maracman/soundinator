// ─── Resona factory starter sessions ──────────────────────────────────────
//
// These are arrangement recipes rather than saved user documents.  The
// Producer resolves the referenced full patches into a fresh editable
// arrangement, giving every starter a stable musical and spatial identity.

const major = [0, 2, 4, 5, 7, 9, 11];
const minor = [0, 2, 3, 5, 7, 8, 10];
const dorian = [0, 2, 3, 5, 7, 9, 10];
const wholeTone = [0, 2, 4, 6, 8, 10];
const edo7Open = [0, 1, 2, 4, 5];
const edo7Shift = [0, 2, 3, 5, 6];

const region = (startBeat, lengthBeats, seed) => ({ startBeat, lengthBeats, seed });
const anchors = (...points) => points.map(([beat, angle, dist, smooth = 0.62]) => ({ beat, angle, dist, smooth }));

export const FACTORY_SESSIONS = Object.freeze([
  {
    id: "factory-session-dawn-observatory",
    name: "Dawn Observatory",
    theme: "Slowly widening sky-scape",
    description: "A dawn soundscape: distant choir, glass signals and a flute line orbit a turning listener.",
    tags: ["soundscape", "airy", "global-space", "harmonic-guide"],
    lengthBeats: 64,
    context: { tempo: 66, scaleMode: "12tone", scalePreset: "major", customDegrees: major, rootNotes: [0], reverbWet: 0.28 },
    harmonicGuide: { markers: [
      { atBeat: 0, degrees: major, subScaleNotes: [0, 4, 7], rootNotes: [0] },
      { atBeat: 32, degrees: dorian, subScaleNotes: [0, 3, 7], rootNotes: [0] },
    ] },
    space: { head: { earDistance: 0.18, headDensity: 0.46, earModel: "kemarMeasured", reverbType: "forest", reverbWet: 0.30, reverbDecay: 4.8, facing: -24 } },
    tracks: [
      { name: "Far choir", patchId: "factory-patch-slow-sky", gain: 0.78, useHarmonicGuide: true,
        anchors: anchors([0, -118, 7.2], [32, -42, 8.2], [64, 52, 6.8]), regions: [region(0, 64, 701101)] },
      { name: "Glass signals", patchId: "factory-patch-glass-canopy", gain: 0.62, useHarmonicGuide: true,
        anchors: anchors([0, 78, 4.4], [32, 138, 6.4], [64, -124, 5.2]), regions: [region(8, 48, 701102)] },
      { name: "Morning flute", patchId: "factory-patch-wandering-flute", gain: 0.72, useHarmonicGuide: true,
        anchors: anchors([0, -18, 2.7], [32, 26, 2.1], [64, 74, 3.3]), regions: [region(16, 40, 701103)] },
    ],
  },
  {
    id: "factory-session-cave-cartography",
    name: "Cave Cartography",
    theme: "Subterranean soundscape",
    description: "Membrane blooms and low brass map the walls of a cave while breath accents move behind the listener.",
    tags: ["soundscape", "cave", "low", "head-turn"],
    lengthBeats: 64,
    context: { tempo: 58, scaleMode: "12tone", scalePreset: "whole_tone", customDegrees: wholeTone, rootNotes: [0], reverbWet: 0.34 },
    harmonicGuide: { markers: [
      { atBeat: 0, degrees: wholeTone, subScaleNotes: [0, 4, 8], rootNotes: [0] },
      { atBeat: 40, degrees: minor, subScaleNotes: [0, 3, 7], rootNotes: [0] },
    ] },
    space: { head: { earDistance: 0.19, headDensity: 0.64, reverbType: "cave", reverbWet: 0.37, reverbDecay: 6.5, facing: 118 } },
    tracks: [
      { name: "Membrane floor", patchId: "factory-patch-cave-bloom", gain: 0.84, useHarmonicGuide: true,
        anchors: anchors([0, 136, 4.8], [32, 168, 6.8], [64, -146, 5.5]), regions: [region(0, 64, 702101)] },
      { name: "Brass wall", patchId: "factory-patch-smoke-drift", gain: 0.72, useHarmonicGuide: true,
        anchors: anchors([0, -74, 7.6], [32, -128, 6.3], [64, -32, 8.5]), regions: [region(4, 56, 702102)] },
      { name: "Breath echoes", patchId: "factory-patch-breath-dust", gain: 0.56, useHarmonicGuide: true,
        anchors: anchors([0, 38, 2.2], [32, -166, 3.8], [64, 96, 2.8]), regions: [region(12, 44, 702103)] },
    ],
  },
  {
    id: "factory-session-seven-lenses",
    name: "Seven Lenses",
    theme: "7-EDO circular study",
    description: "A 7-EDO study with a moving Harmonic guide: membrane rhythm, open wind cells and high glass refract around the head.",
    tags: ["7-edo", "microtonal", "global-space", "harmonic-guide"],
    lengthBeats: 64,
    context: { tempo: 92, scaleMode: "edo", scalePreset: "major", edoDivisions: 7, customDegrees: edo7Open, rootNotes: [0], reverbWet: 0.20 },
    harmonicGuide: { markers: [
      { atBeat: 0, scaleMode: "edo", edoDivisions: 7, degrees: edo7Open, subScaleNotes: [0, 2, 5], rootNotes: [0] },
      { atBeat: 32, scaleMode: "edo", edoDivisions: 7, degrees: edo7Shift, subScaleNotes: [0, 3, 6], rootNotes: [0] },
      { atBeat: 48, scaleMode: "edo", edoDivisions: 7, degrees: edo7Open, subScaleNotes: [0, 1, 4], rootNotes: [0] },
    ] },
    space: { head: { earDistance: 0.17, headDensity: 0.42, reverbType: "spring", reverbWet: 0.22, reverbDecay: 2.7, facing: -68 } },
    tracks: [
      { name: "Orbit membrane", patchId: "factory-patch-membrane-orbit", gain: 0.82, useHarmonicGuide: true,
        anchors: anchors([0, -142, 3.8], [16, -38, 4.6], [32, 72, 5.4], [48, 152, 4.0], [64, -142, 3.8]), regions: [region(0, 64, 703101)] },
      { name: "Seven-open wind", patchId: "factory-patch-seven-open", gain: 0.70, useHarmonicGuide: true,
        anchors: anchors([0, 24, 3.2], [32, 94, 2.4], [64, -22, 3.6]), regions: [region(0, 64, 703102)] },
      { name: "Glass clock", patchId: "factory-patch-glass-clock", gain: 0.54, useHarmonicGuide: true,
        anchors: anchors([0, 126, 6.1], [32, -126, 5.0], [64, 126, 6.1]), regions: [region(8, 48, 703103)] },
    ],
  },
  {
    id: "factory-session-kinetic-atrium",
    name: "Kinetic Atrium",
    theme: "Bright modular ensemble",
    description: "A playable four-part ensemble: pulse, bass, clarinet hook and high brass answer cross a shared hall.",
    tags: ["music", "ensemble", "rhythmic", "global-space"],
    lengthBeats: 64,
    context: { tempo: 108, scaleMode: "12tone", scalePreset: "major", customDegrees: major, rootNotes: [0], reverbWet: 0.18 },
    harmonicGuide: { markers: [
      { atBeat: 0, degrees: major, subScaleNotes: [0, 4, 7], rootNotes: [0] },
      { atBeat: 32, degrees: dorian, subScaleNotes: [0, 3, 7], rootNotes: [0] },
    ] },
    space: { head: { earDistance: 0.175, headDensity: 0.52, reverbType: "hall", reverbWet: 0.20, reverbDecay: 3.4, facing: 16 } },
    tracks: [
      { name: "Wood pulse", patchId: "factory-patch-wooden-pulse", gain: 0.80, useHarmonicGuide: true,
        anchors: anchors([0, -40, 2.0], [32, -72, 2.6], [64, -40, 2.0]), regions: [region(0, 64, 704101)] },
      { name: "Low anchor", patchId: "factory-patch-deep-walker", gain: 0.90, useHarmonicGuide: true,
        anchors: anchors([0, -112, 3.6], [32, -132, 4.2], [64, -112, 3.6]), regions: [region(0, 64, 704102)] },
      { name: "Velvet hook", patchId: "factory-patch-velvet-hook", gain: 0.72, useHarmonicGuide: true,
        anchors: anchors([0, 34, 2.4], [32, 74, 2.9], [64, 34, 2.4]), regions: [region(8, 56, 704103)] },
      { name: "Silver answer", patchId: "factory-patch-silver-answer", gain: 0.64, useHarmonicGuide: true,
        anchors: anchors([0, 112, 5.2], [32, 148, 6.0], [64, 112, 5.2]), regions: [region(16, 40, 704104)] },
    ],
  },
  {
    id: "factory-session-night-transit",
    name: "Night Transit",
    theme: "Nocturnal broken-beat piece",
    description: "Broken piano cells, dark vocal motion and a low pulse travel through a close late-night room.",
    tags: ["music", "night", "broken-beat", "head-turn"],
    lengthBeats: 64,
    context: { tempo: 96, scaleMode: "12tone", scalePreset: "minor", customDegrees: minor, rootNotes: [0], reverbWet: 0.17 },
    harmonicGuide: { markers: [
      { atBeat: 0, degrees: minor, subScaleNotes: [0, 3, 7], rootNotes: [0] },
      { atBeat: 28, degrees: dorian, subScaleNotes: [0, 3, 7], rootNotes: [0] },
      { atBeat: 48, degrees: minor, subScaleNotes: [0, 3, 10], rootNotes: [0] },
    ] },
    space: { head: { earDistance: 0.18, headDensity: 0.58, reverbType: "room", reverbWet: 0.18, reverbDecay: 2.1, facing: -104 } },
    tracks: [
      { name: "Low transit", patchId: "factory-patch-deep-walker", gain: 0.88, useHarmonicGuide: true,
        anchors: anchors([0, -82, 2.8], [32, -126, 3.6], [64, -82, 2.8]), regions: [region(0, 64, 705101)] },
      { name: "Broken keys", patchId: "factory-patch-broken-keys", gain: 0.74, useHarmonicGuide: true,
        anchors: anchors([0, 66, 2.5], [32, 152, 4.6], [64, 46, 3.0]), regions: [region(4, 60, 705102)] },
      { name: "Vocal carriage", patchId: "factory-patch-wandering-mouth", gain: 0.66, useHarmonicGuide: true,
        anchors: anchors([0, 156, 5.6], [32, 98, 4.0], [64, -166, 5.0]), regions: [region(12, 48, 705103)] },
      { name: "Rim lights", patchId: "factory-patch-rim-logic", gain: 0.50, useHarmonicGuide: true,
        anchors: anchors([0, -12, 1.8], [32, 32, 2.1], [64, -12, 1.8]), regions: [region(16, 40, 705104)] },
    ],
  },
]);
