// ─── Factory starter presets ────────────────────────────────
//
// Curated starting points shipped with the app so a first visit lands on
// good sounds instead of a blank slate. Full presets merge over DEFAULTS on
// load; section presets merge over the current state (see PRESET_SECTIONS
// in app.js). Keep parameter keys in sync with DEFAULTS — the factory tab
// is validated by scripts and by loading each preset in the browser.

export const FACTORY_PRESETS = [
  // ── Full rigs ──
  {
    id: "factory-glass-bells",
    name: "Glass Bells",
    section: "full",
    description: "Slow pentatonic bells with a shimmering plate",
    parameters: {
      voiceMode: "fourier", spectralProfile: "flute", spectralMix: 0.85,
      spectralStretchCents: 6, tempo: 76, scaleMode: "12tone",
      scalePreset: "pent_major", customDegrees: [0, 2, 4, 7, 9],
      beatDivisions: 1, intervalPeakedness: 2.8, intervalRange: 5,
      envelopeAttack: 0.004, envelopeDecay: 0.25, envelopeSustain: 0.25,
      envelopeRelease: 0.4, vibratoProb: 0,
      reverbType: "plate", reverbWet: 0.3, reverbDecay: 2.4,
      surpriseProb: 0.05, motifCount: 3, motifLengthBeats: 4, sequenceProb: 0.85,
    },
  },
  {
    id: "factory-night-choir",
    name: "Night Choir",
    section: "full",
    description: "Dark slow vowels in a huge space",
    parameters: {
      voiceMode: "formant", activeFormants: ["oo", "oh"], formantChangeProb: 0.18,
      toneBreath: 0.12, tempo: 62, scaleMode: "12tone",
      scalePreset: "minor", customDegrees: [0, 2, 3, 5, 7, 8, 10],
      registerCenter: -4, registerWidth: 9, intervalPeakedness: 3.2, intervalRange: 4,
      vibratoProb: 0.7, vibratoDepth: 14, vibratoRate: 4.6,
      envelopeAttack: 0.06, envelopeRelease: 0.35,
      reverbType: "cathedral", reverbWet: 0.38, reverbDecay: 4.4,
      motifCount: 2, motifLengthBeats: 6, sequenceProb: 0.9,
      restOnMeterRatio: 0.18, surpriseProb: 0.04,
    },
  },
  {
    id: "factory-clockwork",
    name: "Clockwork",
    section: "full",
    description: "Tight, precise, tick-tock machinery",
    parameters: {
      voiceMode: "fourier", spectralProfile: "clarinet", spectralMix: 0.75,
      tempo: 126, scaleMode: "12tone",
      scalePreset: "major", customDegrees: [0, 2, 4, 5, 7, 9, 11],
      beatDivisions: 2, onBeatProb: 0.85, sameLengthProb: 0.8,
      precision: 0.97, surpriseProb: 0.03, motifCount: 3, motifLengthBeats: 4,
      sequenceProb: 0.95, envelopeAttack: 0.003, envelopeRelease: 0.06,
      percBeatVol: 0.35, percBeatSound: "tick",
      percDownbeatVol: 0.5, percDownbeatSound: "click", percDownbeatEvery: 4,
      reverbType: "room", reverbWet: 0.08,
    },
  },
  {
    id: "factory-wandering-flute",
    name: "Wandering Flute",
    section: "full",
    description: "A breathy line that keeps travelling",
    parameters: {
      voiceMode: "fourier", spectralProfile: "flute", spectralMix: 0.8,
      tempo: 88, scaleMode: "12tone",
      scalePreset: "dorian", customDegrees: [0, 2, 3, 5, 7, 9, 10],
      momentum: 0.6, intervalPeakedness: 2.2, intervalRange: 6,
      vibratoProb: 0.8, vibratoDepth: 12, vibratoRate: 5,
      envelopeAttack: 0.03, envelopeRelease: 0.18,
      reverbType: "hall", reverbWet: 0.28, reverbDecay: 2.6,
      restMotifStartRatio: 0.15, surpriseProb: 0.07, incorporationRate: 0.45,
    },
  },
  {
    id: "factory-restless-weaver",
    name: "Restless Weaver",
    section: "full",
    description: "Surprises that weave themselves into the pattern",
    parameters: {
      voiceMode: "fourier", spectralProfile: "violin", spectralMix: 0.7,
      tempo: 112, scaleMode: "12tone",
      scalePreset: "mixolydian", customDegrees: [0, 2, 4, 5, 7, 9, 10],
      surpriseProb: 0.22, motifSurpriseProb: 0.3, incorporationRate: 0.65,
      motifCount: 4, motifLengthBeats: 4, sequenceProb: 0.7,
      intervalPeakedness: 2.5, intervalRange: 6,
      reverbType: "plate", reverbWet: 0.22, reverbDecay: 1.8,
    },
  },
  // ── Section starters ──
  {
    id: "factory-warm-cello",
    name: "Warm Cello",
    section: "sound",
    description: "Bowed, dark, slow-breathing source",
    parameters: {
      voiceMode: "fourier", spectralProfile: "cello", spectralMix: 0.8,
      spectralPartials: 14, spectralDynamicAmount: 0.9,
      envelopeAttack: 0.035, envelopeDecay: 0.08, envelopeSustain: 0.7,
      envelopeRelease: 0.25, vibratoProb: 0.55, vibratoDepth: 10, vibratoRate: 4.4,
    },
  },
  {
    id: "factory-airy-voice",
    name: "Airy Voice",
    section: "sound",
    description: "Bright breathy vowels, ee and eh",
    parameters: {
      voiceMode: "formant", activeFormants: ["ee", "eh"], formantChangeProb: 0.25,
      toneBreath: 0.3, toneColorProb: 0.5,
      vibratoProb: 0.6, vibratoDepth: 12, vibratoRate: 5.2,
      envelopeAttack: 0.04, envelopeRelease: 0.22,
    },
  },
  {
    id: "factory-pentatonic-drift",
    name: "Pentatonic Drift",
    section: "melody",
    description: "Wide, wandering pentatonic melody engine",
    parameters: {
      scaleMode: "12tone", scalePreset: "pent_major", customDegrees: [0, 2, 4, 7, 9],
      intervalPeakedness: 2, intervalRange: 6, momentum: 0.5,
      registerCenter: 0, registerWidth: 14, rootPullStrength: 0.25,
    },
  },
  {
    id: "factory-gentle-pulse",
    name: "Gentle Pulse",
    section: "rhythm",
    description: "Even, calm, on the beat",
    parameters: {
      tempo: 84, beatDivisions: 1, onBeatProb: 0.9, sameLengthProb: 0.75,
      restMotifStartRatio: 0.1, restOnMeterRatio: 0.05, restOffMeterRatio: 0.05,
      gapProb: 0.2, phraseGap: 0.3,
    },
  },
  {
    id: "factory-cathedral-wash",
    name: "Cathedral Wash",
    section: "space",
    description: "Vast, slow, blurred space",
    parameters: {
      reverbType: "cathedral", reverbWet: 0.42, reverbDecay: 4.8,
      reverbTone: 0.5, reverbPreDelay: 0.03,
    },
  },
  {
    id: "factory-dry-studio",
    name: "Dry Studio",
    section: "space",
    description: "Close and dry, almost no room",
    parameters: {
      reverbType: "room", reverbWet: 0.05, reverbDecay: 0.8,
      reverbTone: 0.7, reverbPreDelay: 0.005,
    },
  },
];
