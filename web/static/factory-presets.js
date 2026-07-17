// ─── Resona factory library ────────────────────────────────────────────────
//
// Factory entries are authored as composable section modules, then resolved
// into full patches. `moduleIds` is provenance for the next-generation library;
// `parameters` stays flat because the current browser loader deliberately
// merges section objects over the live state.

const fixture = { seed: 20260710, beats: 16 };

function preset({ id, name, section, family = null, description, tags = [], roles = [],
  parameters, moduleIds = [], brief = null }) {
  return {
    id, name, section, family, description, tags, roles, moduleIds,
    kind: section === "full" ? "patch" : "module",
    brief: brief || {
      claims: [...new Set([...(roles || []), ...(tags || [])])],
      metrics: { minSoundedNotes: 1, maxRestRatio: 0.95 },
      fixtures: fixture,
    },
    parameters,
  };
}

const sound = (id, name, description, tags, parameters, roles = ["sub-note"]) =>
  preset({ id, name, section: "sound", description, tags, roles, parameters });
const macro = (section, id, name, description, tags, parameters) =>
  preset({ id, name, section, description, tags, roles: ["macro", section], parameters });
const space = (id, name, description, tags, parameters) =>
  preset({ id, name, section: "space", description, tags, roles: ["space"], parameters });

// ── 56 Sub-note modules ───────────────────────────────────────────────────

const profileSounds = [
  ["flute-natural", "Flute Foundation", "Measured open, breath-led flute.", "flute", "blow", 0.28, 0.35, ["wind", "measured", "airy"]],
  ["clarinet-natural", "Clarinet Foundation", "Measured odd-harmonic reed voice.", "clarinet", "blow", 0.21, 0.45, ["reed", "measured", "dark"]],
  ["violin-natural", "Violin Foundation", "Measured bowed string voice.", "violin", "bow", 0.13, 0.60, ["string", "measured", "bowed"]],
  ["cello-natural", "Cello Foundation", "Measured low bowed string voice.", "cello", "bow", 0.13, 0.52, ["string", "measured", "warm"]],
  ["trumpet-natural", "Trumpet Foundation", "Measured brass projection with lip transient.", "trumpet", "blow", 0.18, 0.72, ["brass", "measured", "bright"]],
  ["trombone-natural", "Trombone Foundation", "Measured broad, low brass body.", "trombone", "blow", 0.22, 0.52, ["brass", "measured", "broad"]],
  ["piano-natural", "Piano Foundation", "Measured struck, inharmonic piano body.", "piano", "strike", 0.12, 0.62, ["keys", "measured", "struck"]],
  ["vocal-natural", "Vocal Foundation", "A balanced articulated vowel voice.", "vocal", "blow", 0.28, 0.42, ["vocal", "formant", "expressive"]],
].map(([id, name, description, spectralProfile, excitationType, excitationPosition, excitationHardness, tags]) =>
  sound(`factory-sub-${id}`, name, description, tags, {
    voiceMode: "fourier", spectralProfile, spectralMix: 0.9,
    excitationType, excitationPosition, excitationHardness, excitationHuman: 0.35,
    ...(excitationType === "blow" && ["flute", "clarinet", "alto-sax"].includes(spectralProfile)
      ? { toneBreath: 0.03, windBreathLevel: 1 } : {}),
    ...(excitationType === "bow" && spectralProfile === "violin"
      ? { bowNoiseLevel: 1 } : {}),
    ...(excitationType === "strike" && spectralProfile === "piano"
      ? { pianoActionNoiseLevel: 1, envelopeAnomalyLevel: 1 } : {}),
    envelopeAttack: excitationType === "strike" ? 0.006 : 0.06,
    envelopeRelease: excitationType === "strike" ? 0.28 : 0.28,
  }));

// WP-5 fitted instruments. The alto-sax entry remains explicitly interim
// until its final high-ff variability-floor cell closes.
const fittedSounds = [
  sound("factory-sub-alto-sax-sg2", "Alto Sax — SG2 Interim",
    "A fitted classical alto sax stepping stone for the tenor-sax campaign.",
    ["reed", "saxophone", "measured", "fitted", "interim"], {
      seed: 7331, sg2Family: "blown", voiceMode: "fourier",
      spectralProfile: "alto-sax", spectralMix: 1, spectralPartials: 64,
      excitationType: "blow", resonatorClass: "conicalTube", bodyType: "auto",
      partialB: 0, partialMaterial: 0.29,
      attackNoiseLevel: 0.5266877345078729, attackNoiseFreq: 1688,
      attackNoiseQ: 0.89, attackNoiseDecay: 0.121,
      envelopeAttack: 0.0898, envelopeDecay: 0.0125,
      envelopeSustain: 0.8692, envelopeRelease: 0.3043, vibratoProb: 0,
      excitationPosition: 0.08315571358214188,
      excitationHuman: 0.364403648667616,
      toneBreath: 0.3055728090000841,
      windBreathLevel: 1,
      breathNoiseColor: 0.03606797749978963,
      breathLevelScale: 2.0233281560585272,
      breathVelocityExponent: 0.23432013743870406,
      breathTurbulence: 0.616623651029748,
      breathBodyAmount: 0.7835799563788599,
      onsetSpectrumTilt: -0.21878552323970732,
      onsetSpectrumDecay: 0.06980930789040009,
      partialTransfer: 0.1, partialTilt: 0,
      spectralResonanceAmount: 1, spectralDynamicAmount: 0.8,
      spectralCullThreshold: 0.0024,
      dynamicBlare: 0.4,
      envelopeAttackByRegister: [
        { f0: 183.557, attack: 0.1197 },
        { f0: 341.348, attack: 0.0898 },
        { f0: 637.626, attack: 0.0649 },
      ],
    }),
  sound("factory-sub-clarinet-sg2", "Clarinet — SG2 Fitted",
    "A fitted B-flat clarinet spanning chalumeau through clarino registers.",
    ["reed", "clarinet", "measured", "fitted"], {
      seed: 7331, sg2Family: "blown", voiceMode: "fourier",
      spectralProfile: "clarinet", spectralMix: 1, spectralPartials: 64,
      excitationType: "blow", resonatorClass: "closedTube", bodyType: "auto",
      partialB: 0, partialMaterial: 0.35,
      attackNoiseLevel: 1, attackNoiseFreq: 2006,
      attackNoiseQ: 1.01, attackNoiseDecay: 0.11,
      envelopeAttack: 0.1696, envelopeDecay: 0,
      envelopeSustain: 0.9699, envelopeRelease: 0.0798, vibratoProb: 0,
      excitationPosition: 0.15, excitationHuman: 0.5,
      toneBreath: 0.03, breathNoiseColor: 0,
      windBreathLevel: 1,
      partialTransfer: 0.05, partialTilt: 0,
      spectralResonanceAmount: 1, spectralDynamicAmount: 0.8,
      dynamicBlare: 0,
    }),
  sound("factory-sub-trumpet-sg2", "Trumpet — SG2 Fitted",
    "A fitted unmuted trumpet spanning low through high registers.",
    ["brass", "trumpet", "measured", "fitted"], {
      seed: 7331, sg2Family: "blown", voiceMode: "fourier",
      spectralProfile: "trumpet", spectralMix: 1, spectralPartials: 64,
      excitationType: "blow", resonatorClass: "conicalTube", bodyType: "auto",
      partialB: 0.00000004, partialMaterial: 0.27,
      attackNoiseLevel: 1, attackNoiseFreq: 1405,
      attackNoiseQ: 1.66, attackNoiseDecay: 0.123,
      envelopeAttack: 0.1896, envelopeDecay: 0,
      envelopeSustain: 0.9375, envelopeRelease: 0.1796, vibratoProb: 0,
      excitationPosition: 0.3, excitationHuman: 0.8,
      toneBreath: 0.03, breathNoiseColor: 0,
      partialTransfer: 0.1, partialTilt: -0.1,
      spectralResonanceAmount: 1, spectralDynamicAmount: 1.2,
      spectralCullThreshold: 0.0006,
      dynamicBlare: 0.25,
    }),
];

const acousticSounds = [
  ["cello-moss", "Moss Cello", "Soft bow pressure and a shaded upper register.", "cello", "bow", 0.38, -0.35, 0.72, ["string", "soft", "low"]],
  ["cello-grit", "Grit Cello", "Scratchy attack with a projecting bowed core.", "cello", "bow", 0.68, 0.16, 0.30, ["string", "bowed", "textured"]],
  ["violin-silk", "Silk Violin", "Slow, gentle bow with a rounded tone print.", "violin", "bow", 0.42, -0.25, 0.50, ["string", "soft", "lead"]],
  ["violin-fire", "Fire Violin", "Hard bow attack and present upper partials.", "violin", "bow", 0.72, 0.28, 0.22, ["string", "bright", "lead"]],
  ["flute-chiff", "Chiff Flute", "Breath-forward flute onset for close melodies.", "flute", "blow", 0.55, 0.12, 0.45, ["wind", "breathy", "lead"]],
  ["flute-hollow", "Hollow Flute", "Dark, low-pressure open-tube flute.", "flute", "blow", 0.28, -0.42, 0.62, ["wind", "dark", "airy"]],
  ["clarinet-velvet", "Velvet Clarinet", "Soft reed with strongly odd, dark harmonics.", "clarinet", "blow", 0.22, -0.30, 0.58, ["reed", "dark", "soft"]],
  ["clarinet-edge", "Edge Clarinet", "Bright reed attack that retains the clarinet core.", "clarinet", "blow", 0.62, 0.22, 0.34, ["reed", "bright", "lead"]],
  ["trumpet-mute", "Muted Trumpet", "Rounded brass with its high spectrum damped.", "trumpet", "blow", 0.33, -0.42, 0.64, ["brass", "muted", "warm"]],
  ["trumpet-sun", "Sun Trumpet", "Forward brass with a strong, crisp onset.", "trumpet", "blow", 0.78, 0.30, 0.26, ["brass", "bright", "lead"]],
  ["trombone-velvet", "Velvet Trombone", "A wide, gentle low brass blanket.", "trombone", "blow", 0.34, -0.30, 0.60, ["brass", "low", "warm"]],
  ["piano-felt", "Felt Piano", "A softened hammer with quickly fading highs.", "piano", "strike", 0.25, -0.48, 0.82, ["keys", "soft", "percussive"]],
].map(([id, name, description, spectralProfile, excitationType, excitationHardness, partialTilt, partialMaterial, tags]) =>
  sound(`factory-sub-${id}`, name, description, tags, {
    voiceMode: "fourier", spectralProfile, spectralMix: 0.9,
    excitationType, excitationPosition: excitationType === "bow" ? 0.13 : 0.2,
    excitationHardness, excitationHuman: 0.35, partialTilt, partialMaterial,
    ...(excitationType === "blow" && ["flute", "clarinet", "alto-sax"].includes(spectralProfile)
      ? { toneBreath: 0.03, windBreathLevel: 1 } : {}),
    ...(excitationType === "bow" && spectralProfile === "violin"
      ? { bowNoiseLevel: 1 } : {}),
    envelopeAttack: excitationType === "strike" ? 0.004 : 0.045,
    envelopeRelease: excitationType === "strike" ? 0.2 : 0.3,
  }));

const resonatorSounds = [
  ["glass-thread", "Glass Thread", "Thin, long-ringing bright harmonics.", "piano", 0.62, 0.72, 0.05, ["glass", "bright", "ringing"]],
  ["wooden-pluck", "Wooden Pluck", "Short, warm plucked resonance.", "cello", 0.25, 0.52, 0.82, ["wood", "pluck", "warm"]],
  ["metal-bar", "Metal Bar", "Hard-struck measured glockenspiel bar modes.", "glockenspiel", 0.92, 0.58, 0.10, ["metal", "strike", "measured"]],
  ["hollow-tube", "Hollow Tube", "Odd-weighted, low-pressure tube tone.", "clarinet", 0.32, -0.22, 0.48, ["tube", "hollow", "dark"]],
  ["membrane-bloom", "Membrane Bloom", "Rounded struck body with a slow release.", "piano", 0.52, -0.06, 0.40, ["membrane", "round", "percussive"]],
  ["amber-string", "Amber String", "Low-mid string warmth with a gentle bloom.", "cello", 0.40, -0.18, 0.42, ["string", "warm", "ambient"]],
  ["ice-piano", "Ice Piano", "Inharmonic, glassy piano-derived shimmer.", "piano", 0.78, 0.45, 0.12, ["keys", "glass", "shimmer"]],
  ["reed-pipe", "Reed Pipe", "Nasal reed body with focused midrange.", "clarinet", 0.50, 0.08, 0.46, ["reed", "pipe", "focused"]],
  ["brass-bowl", "Brass Bowl", "A dark metallic bowl-like brass resonance.", "trombone", 0.55, -0.10, 0.24, ["brass", "metal", "low"]],
  ["paper-reed", "Paper Reed", "Dry, fragile reed with little sustained ring.", "clarinet", 0.38, -0.35, 0.86, ["reed", "dry", "fragile"]],
].map(([id, name, description, spectralProfile, excitationHardness, partialTilt, partialMaterial, tags]) =>
  sound(`factory-sub-${id}`, name, description, tags, {
    voiceMode: "fourier", spectralProfile, spectralMix: 0.86,
    excitationType: "strike", excitationPosition: 0.16, excitationHardness,
    ...(id === "metal-bar" ? { resonatorClass: "bar", partialB: 0 } : {}),
    partialTilt, partialOddEven: spectralProfile === "clarinet" ? 0.45 : 0,
    partialMaterial, spectralStretchCents: id.includes("piano") || id.includes("glass") ? 8 : 0,
    envelopeAttack: 0.008, envelopeDecay: 0.12, envelopeSustain: 0.28, envelopeRelease: 0.32,
  }));

const vocalSounds = [
  ["vowel-ah", "Vowel Ah", ["ah"], 0.04, 0.10, ["vocal", "vowel", "open"]],
  ["vowel-ee", "Vowel Ee", ["ee"], 0.03, 0.08, ["vocal", "vowel", "bright"]],
  ["vowel-oo", "Vowel Oo", ["oo"], 0.06, 0.13, ["vocal", "vowel", "dark"]],
  ["vowel-eh", "Vowel Eh", ["eh"], 0.04, 0.10, ["vocal", "vowel", "clear"]],
  ["vowel-oh", "Vowel Oh", ["oh"], 0.05, 0.12, ["vocal", "vowel", "round"]],
  ["air-choir", "Air Choir", ["ee", "eh"], 0.24, 0.32, ["vocal", "choir", "airy"]],
  ["night-choir", "Night Choir Voice", ["oo", "oh"], 0.14, 0.10, ["vocal", "choir", "dark"]],
  ["speaking-reed", "Speaking Reed", ["ah", "eh"], 0.10, 0.04, ["vocal", "reed", "focused"]],
  ["robot-vowel", "Robot Vowel", ["ee", "oh"], 0.02, 0, ["vocal", "robotic", "steady"]],
  ["wandering-vowel", "Wandering Vowel", ["ah", "eh", "oh"], 0.38, 0.15, ["vocal", "moving", "expressive"]],
].map(([id, name, activeFormants, formantChangeProb, toneBreath, tags]) =>
  sound(`factory-sub-${id}`, name, "A formant voice module for expressive melodic material.", tags, {
    voiceMode: "formant", activeFormants, formantChangeProb, toneBreath,
    toneColorProb: 0.34, toneFormantDrift: id === "robot-vowel" ? 0 : 0.08,
    vibratoProb: id === "robot-vowel" ? 0 : 0.48,
    envelopeAttack: 0.045, envelopeRelease: 0.28,
  }));

const hitSounds = [
  ["hit-wood", "Wood Hit", "A short wooden impact voice for percussion layers.", "cello", "strike", 0.58, 0.82, 180, ["hit", "wood", "percussion"]],
  ["hit-glass", "Glass Hit", "A bright struck glass-like hit voice.", "piano", "strike", 0.90, 0.12, 720, ["hit", "glass", "percussion"]],
  ["hit-metal", "Metal Hit", "A hard metallic impact with clear upper tone.", "piano", "strike", 1, 0.16, 420, ["hit", "metal", "percussion"]],
  ["hit-tom", "Tom Hit", "A low rounded tuned hit.", "trombone", "strike", 0.44, 0.48, 110, ["hit", "tom", "percussion"]],
  ["hit-rim", "Rim Hit", "A dry high-pitched instrumental rim accent.", "clarinet", "strike", 0.78, 0.88, 620, ["hit", "rim", "percussion"]],
  ["hit-breath", "Breath Hit", "A soft, noise-led short accent.", "flute", "blow", 0.30, 0.78, 360, ["hit", "breath", "percussion"]],
  ["hit-brass", "Brass Hit", "A short low brass stab.", "trumpet", "blow", 0.68, 0.52, 220, ["hit", "brass", "percussion"]],
  ["hit-vocal", "Vocal Hit", "A clipped vowel hit for rhythmic punctuation.", "vocal", "blow", 0.46, 0.68, 300, ["hit", "vocal", "percussion"]],
].map(([id, name, description, spectralProfile, excitationType, excitationHardness, partialMaterial, pitchHint, tags]) =>
  sound(`factory-sub-${id}`, name, description, tags, {
    voiceMode: "fourier", spectralProfile, spectralMix: 0.82,
    excitationType, excitationPosition: 0.12, excitationHardness, partialMaterial,
    ...(excitationType === "blow" && ["flute", "clarinet", "alto-sax"].includes(spectralProfile)
      ? { toneBreath: 0.03, windBreathLevel: 1 } : {}),
    envelopeAttack: 0.002, envelopeDecay: 0.035, envelopeSustain: 0.04, envelopeRelease: 0.07,
    attackNoiseLevel: 1.4,
  }, ["sub-note", "percussion-hit"]));

const characterSounds = [
  ["shimmer-string", "Shimmer String", "Bright bowed harmonics with a long release.", "violin", 0.32, 0.20, 0.18, ["string", "shimmer", "ambient"]],
  ["smoke-brass", "Smoke Brass", "Soft, distant brass with a dark tone print.", "trombone", -0.42, 0, 0.65, ["brass", "dark", "ambient"]],
  ["crystal-wind", "Crystal Wind", "A clean high, airy wind voice.", "flute", 0.26, 0.08, 0.26, ["wind", "bright", "ambient"]],
  ["broken-key", "Broken Key", "A dry, unstable piano-derived key tone.", "piano", -0.15, 0.34, 0.68, ["keys", "dry", "character"]],
  ["wide-reed", "Wide Reed", "A broad, moving reed colour.", "clarinet", -0.08, 0.25, 0.42, ["reed", "wide", "character"]],
  ["low-lantern", "Low Lantern", "Dark cello warmth for low-register beds.", "cello", -0.48, 0, 0.62, ["string", "bass", "warm"]],
  ["silver-lead", "Silver Lead", "Focused, bright trumpet-like lead.", "trumpet", 0.30, 0.10, 0.30, ["brass", "lead", "bright"]],
].map(([id, name, description, spectralProfile, partialTilt, partialComb, partialMaterial, tags]) =>
  sound(`factory-sub-${id}`, name, description, tags, {
    voiceMode: "fourier", spectralProfile, spectralMix: 0.88,
    excitationType: spectralProfile === "piano" ? "strike" : "bow",
    ...(spectralProfile === "violin" ? { bowNoiseLevel: 1 } : {}),
    excitationPosition: 0.16, excitationHardness: 0.6, excitationHuman: 0.45,
    partialTilt, partialComb, partialCombFreq: 5, partialMaterial,
    envelopeAttack: 0.035, envelopeRelease: 0.45,
  }));

const SOUND_MODULES = [...profileSounds, ...fittedSounds, ...acousticSounds, ...resonatorSounds, ...vocalSounds, ...hitSounds, ...characterSounds];

// ── 65 Macro and percussion modules ───────────────────────────────────────

const melodyModules = [
  ["grounded-major", "Grounded Major", "Root-led major motion for dependable starts.", ["major", 0, 5, 3.5, 2, 0.18, 0.7, ["major", "grounded"]]],
  ["grounded-minor", "Grounded Minor", "Low, stepwise natural-minor movement.", ["minor", -10, 4, 3.8, 2, 0.24, 0.8, ["minor", "bass"]]],
  ["pentatonic-roam", "Pentatonic Roam", "Wide but forgiving pentatonic exploration.", ["pent_major", 1, 14, 1.7, 7, 0.55, 0.25, ["pentatonic", "wide"]]],
  ["minor-roam", "Minor Roam", "A mobile minor walk with room for leaps.", ["minor", 0, 12, 1.9, 6, 0.5, 0.2, ["minor", "wide"]]],
  ["dorian-climb", "Dorian Climb", "Upward modal travel with moderate momentum.", ["dorian", 3, 10, 2.3, 5, 0.68, 0.25, ["dorian", "rising"]]],
  ["mixolydian-hook", "Mixolydian Hook", "A compact modal motif engine.", ["mixolydian", 0, 6, 3.0, 3, 0.28, 0.5, ["mixolydian", "hook"]]],
  ["blues-bend", "Blues Bend", "Blue-note vocabulary with roomy leaps.", ["blues", -2, 9, 2.0, 5, 0.35, 0.35, ["blues", "expressive"]]],
  ["harmonic-minor", "Harmonic Minor Arc", "A tense, cadence-seeking harmonic-minor line.", ["harm_minor", 0, 8, 2.5, 5, 0.36, 0.62, ["minor", "tense"]]],
  ["whole-tone-float", "Whole Tone Float", "Symmetric, weightless whole-tone motion.", ["whole_tone", 2, 12, 1.3, 6, 0.42, 0.05, ["whole-tone", "floating"]]],
  ["chromatic-thread", "Chromatic Thread", "A narrow chromatic line for tension.", ["chromatic", 0, 5, 3.6, 2, 0.22, 0.2, ["chromatic", "tense"]]],
  ["arp-major", "Major Arpeggio", "Deterministic major arpeggio movement.", ["major", 0, 10, 2.0, 5, 0, 0.5, ["major", "arpeggio"], "arpUp", 2, 2]],
  ["arp-minor", "Minor Arpeggio", "Deterministic minor arpeggio movement.", ["minor", -3, 10, 2.0, 5, 0, 0.5, ["minor", "arpeggio"], "arpUpDown", 2, 2]],
  ["edo-19-spark", "19-EDO Spark", "A compact 19-EDO scale subset.", ["custom", 1, 8, 2.7, 4, 0.35, 0.3, ["microtonal", "19-edo"], "walk", 2, 1, 19, [0, 3, 6, 8, 11, 14, 17]]],
  ["edo-7-open", "7-EDO Open", "A spacious seven-step EDO vocabulary.", ["custom", 0, 9, 2.0, 4, 0.38, 0.22, ["microtonal", "7-edo"], "walk", 2, 1, 7, [0, 1, 2, 4, 5]]],
  ["slendro-roam", "Slendro Roam", "A five-way Javanese-inspired scale walk.", ["custom", 1, 12, 1.8, 6, 0.45, 0.18, ["microtonal", "slendro"], "walk", 2, 1, 12, [0, 2, 5, 7, 10]]],
  ["high-answer", "High Answer", "A high, narrow answering figure.", ["major", 10, 4, 3.4, 2, 0.22, 0.45, ["high", "answer"]]],
].map(([id, name, description, values]) => {
  const [scalePreset, registerCenter, registerWidth, intervalPeakedness, intervalRange, momentum, rootPullStrength, tags, melodyPattern = "walk", arpStep = 2, arpOctaves = 1, edoDivisions, customDegrees] = values;
  const isCustom = scalePreset === "custom";
  return macro("melody", `factory-melody-${id}`, name, description, tags, {
    scaleMode: isCustom ? "edo" : "12tone", scalePreset: isCustom ? "major" : scalePreset,
    ...(isCustom ? { edoDivisions, customDegrees } : { customDegrees: null }), rootNotes: [0],
    registerCenter, registerWidth, intervalPeakedness, intervalRange, momentum,
    rootPullStrength, rootPullShape: 0.7, melodyPattern, arpStep, arpOctaves,
  });
});

const rhythmModules = [
  ["slow-steps", "Slow Steps", 68, 1, 0.82, 0.08, 0.76, 0.18, 0.08, 0.25, ["slow", "steady"]],
  ["walking-eighths", "Walking Eighths", 102, 2, 0.88, 0.18, 0.72, 0.12, 0.04, 0.16, ["walking", "eighths"]],
  ["clock-grid", "Clock Grid", 124, 4, 0.94, 0.06, 0.88, 0.02, 0.02, 0.05, ["precise", "grid"]],
  ["broken-pulse", "Broken Pulse", 96, 4, 0.58, 0.42, 0.38, 0.16, 0.16, 0.45, ["broken", "syncopated"]],
  ["sparse-air", "Sparse Air", 58, 1, 0.62, 0.08, 0.48, 0.42, 0.32, 0.56, ["sparse", "ambient"]],
  ["offbeat-skip", "Offbeat Skip", 110, 4, 0.46, 0.58, 0.34, 0.08, 0.10, 0.22, ["offbeat", "energetic"]],
  ["long-breath", "Long Breath", 72, 1, 0.74, 0.06, 0.88, 0.12, 0.10, 0.42, ["long", "breathing"]],
  ["quick-cells", "Quick Cells", 132, 4, 0.82, 0.22, 0.62, 0.04, 0.04, 0.12, ["quick", "cells"]],
  ["halftime", "Half-time", 84, 2, 0.78, 0.10, 0.70, 0.20, 0.10, 0.30, ["half-time", "steady"]],
  ["free-gaps", "Free Gaps", 90, 2, 0.62, 0.26, 0.36, 0.22, 0.20, 0.62, ["free", "gapped"]],
  ["motif-breath", "Motif Breath", 80, 2, 0.76, 0.12, 0.74, 0.24, 0.08, 0.32, ["motif", "phrased"]],
  ["drone-space", "Drone Space", 54, 1, 0.52, 0.03, 0.94, 0.46, 0.34, 0.62, ["drone", "sparse"]],
  ["triplet-feel", "Triplet Feel", 108, 3, 0.76, 0.30, 0.56, 0.08, 0.06, 0.18, ["triplet", "flow"]],
  ["restless-grid", "Restless Grid", 118, 4, 0.70, 0.38, 0.42, 0.06, 0.12, 0.16, ["restless", "grid"]],
].map(([id, name, tempo, beatDivisions, onBeatProb, offBeatProb, sameLengthProb, restMotifStartRatio, restOnMeterRatio, gapProb, tags]) =>
  macro("rhythm", `factory-rhythm-${id}`, name, "A reusable rhythm and rest behaviour.", tags, {
    tempo, beatDivisions, onBeatProb, offBeatProb, sameLengthProb,
    restMotifStartRatio, restOnMeterRatio, restOffMeterRatio: restOnMeterRatio * 0.7,
    gapProb, gapMin: gapProb > 0.4 ? 0.35 : 0.12, gapMax: gapProb > 0.4 ? 0.8 : 0.25,
    phraseGap: gapProb > 0.4 ? 0.48 : 0.18,
  }));

const dynamicsModules = [
  ["even-bed", "Even Bed", 0.52, 0.25, 0.88, 0.10, ["even", "support"]],
  ["gentle", "Gentle", 0.38, 0.32, 0.82, 0.14, ["gentle", "soft"]],
  ["accented", "Accented", 0.68, 0.70, 0.54, 0.30, ["accented", "present"]],
  ["wide", "Wide Dynamics", 0.60, 0.95, 0.46, 0.42, ["wide", "expressive"]],
  ["fragile", "Fragile", 0.30, 0.50, 0.55, 0.26, ["fragile", "quiet"]],
  ["rising", "Rising Energy", 0.66, 0.76, 0.62, 0.32, ["rising", "energy"]],
  ["pulsed", "Pulsed", 0.56, 0.64, 0.52, 0.34, ["pulsed", "rhythmic"]],
  ["whisper", "Whisper", 0.22, 0.28, 0.78, 0.12, ["whisper", "low"]],
  ["hero", "Hero", 0.78, 0.72, 0.68, 0.24, ["hero", "lead"]],
  ["unstable", "Unstable", 0.50, 0.92, 0.34, 0.48, ["unstable", "experimental"]],
].map(([id, name, dynamicsLevel, loudnessRange, dynamicsPrecision, dynamicsRange, tags]) =>
  macro("dynamics", `factory-dynamics-${id}`, name, "A reusable velocity and loudness behaviour.", tags, {
    dynamicsLevel, loudnessRange, dynamicsPrecision, dynamicsRange,
  }));

const surpriseModules = [
  ["still", "Still Loop", 0.0, {}, 0, 0.92, 4, 0.94, ["stable", "repeat"]],
  ["light-pitch", "Light Pitch Surprise", 0.05, { surprisePitchEnabled: true }, 0.18, 0.9, 4, 0.9, ["pitch", "light"]],
  ["melodic-turn", "Melodic Turn", 0.12, { surprisePitchEnabled: true }, 0.42, 0.82, 4, 0.84, ["pitch", "evolving"]],
  ["rhythm-nudge", "Rhythm Nudge", 0.10, { surpriseRhythmEnabled: true }, 0.25, 0.86, 4, 0.84, ["rhythm", "variation"]],
  ["tuning-sheen", "Tuning Sheen", 0.08, { surpriseTuningEnabled: true }, 0.2, 0.9, 6, 0.88, ["tuning", "subtle"]],
  ["formant-shift", "Formant Shift", 0.10, { surpriseFormantEnabled: true }, 0.24, 0.86, 4, 0.86, ["formant", "timbre"]],
  ["dynamic-flash", "Dynamic Flash", 0.12, { surpriseDynamicsEnabled: true }, 0.2, 0.86, 4, 0.86, ["dynamics", "accent"]],
  ["rest-breath", "Rest Breath", 0.09, { surpriseRestEnabled: true }, 0.12, 0.9, 6, 0.88, ["rest", "breathing"]],
  ["woven", "Woven Surprise", 0.16, { surprisePitchEnabled: true, surpriseRhythmEnabled: true }, 0.52, 0.78, 4, 0.78, ["pitch", "rhythm", "woven"]],
  ["vowel-story", "Vowel Story", 0.15, { surpriseFormantEnabled: true, surpriseDynamicsEnabled: true }, 0.55, 0.8, 6, 0.8, ["formant", "story"]],
  ["restless", "Restless Sequence", 0.22, { surprisePitchEnabled: true, surpriseRhythmEnabled: true, surpriseDynamicsEnabled: true }, 0.65, 0.7, 4, 0.72, ["restless", "high-variation"]],
  ["incorporating", "Incorporating Change", 0.18, { surprisePitchEnabled: true, surpriseTuningEnabled: true }, 0.82, 0.76, 5, 0.72, ["incorporating", "evolving"]],
  ["dissolve", "Dissolving Form", 0.28, { surprisePitchEnabled: true, surpriseRhythmEnabled: true, surpriseFormantEnabled: true, surpriseRestEnabled: true }, 0.85, 0.64, 8, 0.62, ["experimental", "dissolving"]],
].map(([id, name, surpriseProb, enabled, incorporationRate, sequenceProb, motifCount, motifSurpriseProb, tags]) =>
  macro("surprise", `factory-surprise-${id}`, name, "A reusable sequence and novelty behaviour.", tags, {
    surpriseProb, incorporationRate, sequenceProb, motifCount, motifLengthBeats: id === "dissolve" ? 8 : 4,
    motifSurpriseProb, surpriseAllowMultiple: Object.keys(enabled).length > 1,
    surprisePitchEnabled: false, surpriseTuningEnabled: false, surpriseRhythmEnabled: false,
    surpriseFormantEnabled: false, surpriseDynamicsEnabled: false, surpriseRestEnabled: false,
    ...enabled,
  }));

const soundById = new Map(SOUND_MODULES.map(p => [p.id, p]));
function instrumentHit(id, pitchHz) {
  const source = soundById.get(id);
  if (!source) throw new Error(`Missing factory percussion hit source: ${id}`);
  return { kind: "instrument", name: source.name, presetId: id, pitchHz, subnote: source.parameters };
}
function layer(id, role, vol, soundDef, every = null) {
  return { id, role, vol, sound: soundDef, space: null, ...(every ? { every } : {}) };
}
const percussionModules = [
  ["minimal-click", "Minimal Click Kit", [layer("min-click", "beat", 0.3, { kind: "sample", key: "click" })], ["minimal", "click"]],
  ["wood-pulse", "Wood Pulse Kit", [layer("wood-beat", "beat", 0.44, instrumentHit("factory-sub-hit-wood", 180)), layer("wood-down", "downbeat", 0.54, { kind: "sample", key: "wood" }, 4)], ["wood", "pulse"]],
  ["glass-clock", "Glass Clock Kit", [layer("glass-beat", "beat", 0.32, instrumentHit("factory-sub-hit-glass", 720)), layer("glass-down", "downbeat", 0.35, { kind: "sample", key: "tick" }, 4)], ["glass", "clock"]],
  ["low-tom", "Low Tom Kit", [layer("tom-beat", "beat", 0.5, instrumentHit("factory-sub-hit-tom", 110)), layer("tom-motif", "motif", 0.3, { kind: "sample", key: "pop" })], ["tom", "low"]],
  ["metal-steps", "Metal Steps Kit", [layer("metal-beat", "beat", 0.38, instrumentHit("factory-sub-hit-metal", 420)), layer("metal-motif", "motif", 0.25, { kind: "sample", key: "bell" })], ["metal", "steps"]],
  ["breath-dust", "Breath Dust Kit", [layer("breath-beat", "beat", 0.26, instrumentHit("factory-sub-hit-breath", 360)), layer("breath-down", "downbeat", 0.22, { kind: "sample", key: "hat" }, 8)], ["breath", "light"]],
  ["rim-grid", "Rim Grid Kit", [layer("rim-beat", "beat", 0.42, instrumentHit("factory-sub-hit-rim", 620)), layer("rim-down", "downbeat", 0.38, { kind: "sample", key: "rim" }, 4)], ["rim", "grid"]],
  ["brass-stab", "Brass Stab Kit", [layer("brass-motif", "motif", 0.5, instrumentHit("factory-sub-hit-brass", 220)), layer("brass-down", "downbeat", 0.32, { kind: "sample", key: "pop" }, 4)], ["brass", "stab"]],
  ["vocal-puncture", "Vocal Puncture Kit", [layer("voice-beat", "beat", 0.32, instrumentHit("factory-sub-hit-vocal", 300)), layer("voice-motif", "motif", 0.4, { kind: "sample", key: "snap" })], ["vocal", "puncture"]],
  ["paper-kit", "Paper Kit", [layer("paper-beat", "beat", 0.3, instrumentHit("factory-sub-paper-reed", 280)), layer("paper-down", "downbeat", 0.22, { kind: "sample", key: "click" }, 4)], ["dry", "kit"]],
  ["bell-canopy", "Bell Canopy Kit", [layer("bell-beat", "beat", 0.32, { kind: "sample", key: "bell" }), layer("bell-motif", "motif", 0.4, instrumentHit("factory-sub-hit-glass", 880))], ["bell", "ambient"]],
  ["three-point", "Three Point Kit", [layer("three-beat", "beat", 0.3, { kind: "sample", key: "tick" }), layer("three-motif", "motif", 0.35, instrumentHit("factory-sub-hit-wood", 220)), layer("three-down", "downbeat", 0.5, instrumentHit("factory-sub-hit-tom", 100), 4)], ["multi-layer", "kit"]],
].map(([id, name, percLayers, tags]) =>
  macro("percussion", `factory-percussion-${id}`, name, "Expandable percussion layers; swap or add hits in the percussion panel.", tags, { percLayers }));

const spaceModules = [
  ["dry-close", "Dry Close", "Close, almost dry studio placement.", "studio", 0.04, 0.7, 1.1, 0, ["dry", "close"]],
  ["booth", "Booth", "Small controlled booth with clear attacks.", "studio", 0.12, 0.8, 1.4, -12, ["studio", "controlled"]],
  ["living-room", "Living Room", "Warm near room placement.", "room", 0.18, 1.2, 2.2, 18, ["room", "warm"]],
  ["wide-plate", "Wide Plate", "Bright plate width around the performer.", "plate", 0.28, 2.1, 3.0, -30, ["plate", "wide"]],
  ["chamber", "Chamber", "Detailed chamber reflections.", "chamber", 0.26, 2.0, 3.2, 24, ["chamber", "detail"]],
  ["hall-front", "Hall Front", "A forward concert-hall stage.", "hall", 0.30, 3.0, 5.2, 0, ["hall", "front"]],
  ["cathedral-far", "Cathedral Far", "Distant, slow cathedral tail.", "cathedral", 0.43, 5.0, 9.0, 20, ["cathedral", "far"]],
  ["cave-side", "Cave Side", "Dark side-lit cave placement.", "cave", 0.36, 4.1, 7.5, 74, ["cave", "side"]],
  ["forest-air", "Forest Air", "Open, diffuse outdoor air.", "forest", 0.24, 1.5, 7.0, -36, ["forest", "open"]],
  ["spring-near", "Spring Near", "Close spring reflections with character.", "spring", 0.25, 1.4, 2.0, 12, ["spring", "character"]],
  ["behind-listener", "Behind Listener", "A source deliberately placed behind the head.", "room", 0.18, 1.1, 3.4, 150, ["behind", "spatial"]],
  ["measured-head", "Measured Head", "A close KEMAR measured-HRIR perspective.", "room", 0.14, 1.0, 2.8, -42, ["kemar", "spatial"]],
].map(([id, name, description, reverbType, reverbWet, reverbDecay, spaceDistance, spaceAzimuth, tags]) =>
  space(`factory-space-${id}`, name, description, tags, {
    reverbType, reverbWet, reverbDecay, reverbTone: 0.6, reverbPreDelay: 0.015,
    spaceDistance, spaceAzimuth,
    ...(id === "measured-head" ? { earModel: "kemarMeasured" } : {}),
  }));

const MACRO_MODULES = [...melodyModules, ...rhythmModules, ...dynamicsModules, ...surpriseModules, ...percussionModules];
const SPACE_MODULES = spaceModules;
const MODULES = [...SOUND_MODULES, ...MACRO_MODULES, ...SPACE_MODULES];
const moduleById = new Map(MODULES.map(p => [p.id, p]));

// ── 48 resolved full patches ──────────────────────────────────────────────

function fullPatch(id, name, family, description, moduleIds, extra = {}) {
  const modules = moduleIds.map(moduleId => {
    const entry = moduleById.get(moduleId);
    if (!entry) throw new Error(`Missing module '${moduleId}' for ${id}`);
    return entry;
  });
  const tags = [...new Set([family, ...modules.flatMap(m => m.tags || [])])];
  return { ...preset({
    id, name, section: "full", family, description, tags, roles: [family], moduleIds,
    brief: { claims: [family, ...tags.slice(1, 5)], metrics: { minSoundedNotes: 1, maxRestRatio: 0.95 }, fixtures: fixture },
    parameters: Object.assign({}, ...modules.map(m => m.parameters), extra),
  }), overrides: extra };
}

const patch = (family, id, name, description, parts, extra) =>
  fullPatch(`factory-patch-${id}`, name, family, description, parts, extra);

const FULL_PATCHES = [
  // Bass
  patch("bass", "deep-walker", "Deep Walker", "Low, patient minor bass with room for a small accent.", ["factory-sub-low-lantern", "factory-melody-grounded-minor", "factory-rhythm-slow-steps", "factory-dynamics-even-bed", "factory-surprise-light-pitch", "factory-space-living-room"]),
  patch("bass", "felt-root", "Felt Root", "Soft piano bass that stays close to its root.", ["factory-sub-piano-felt", "factory-melody-grounded-minor", "factory-rhythm-long-breath", "factory-dynamics-gentle", "factory-surprise-still", "factory-space-dry-close"]),
  patch("bass", "reed-floor", "Reed Floor", "A dark, narrow clarinet foundation.", ["factory-sub-clarinet-velvet", "factory-melody-grounded-minor", "factory-rhythm-halftime", "factory-dynamics-even-bed", "factory-surprise-still", "factory-space-booth"]),
  patch("bass", "brass-cellar", "Brass Cellar", "Wide low brass with deliberately slow motion.", ["factory-sub-trombone-velvet", "factory-melody-grounded-minor", "factory-rhythm-long-breath", "factory-dynamics-gentle", "factory-surprise-rest-breath", "factory-space-chamber"]),
  patch("bass", "wooden-pulse", "Wooden Pulse", "A plucked low part dressed by wood hits.", ["factory-sub-wooden-pluck", "factory-melody-grounded-minor", "factory-rhythm-walking-eighths", "factory-dynamics-pulsed", "factory-surprise-light-pitch", "factory-percussion-wood-pulse", "factory-space-dry-close"]),
  patch("bass", "tube-anchor", "Tube Anchor", "Closed-tube-style low line with a hard rhythmic edge.", ["factory-sub-hollow-tube", "factory-melody-grounded-minor", "factory-rhythm-clock-grid", "factory-dynamics-accented", "factory-surprise-still", "factory-percussion-minimal-click", "factory-space-booth"]),
  patch("bass", "amber-ostinato", "Amber Ostinato", "Warm repeated low arpeggio.", ["factory-sub-amber-string", "factory-melody-arp-minor", "factory-rhythm-walking-eighths", "factory-dynamics-even-bed", "factory-surprise-still", "factory-space-living-room"]),
  patch("bass", "smoke-drift", "Smoke Drift", "Sparse, very dark brass bass atmosphere.", ["factory-sub-smoke-brass", "factory-melody-grounded-minor", "factory-rhythm-drone-space", "factory-dynamics-fragile", "factory-surprise-tuning-sheen", "factory-space-cave-side"]),
  // Percussive
  patch("percussive", "wood-talk", "Wood Talk", "Pitch-flat struck wood with a precise kit.", ["factory-sub-hit-wood", "factory-melody-grounded-major", "factory-rhythm-clock-grid", "factory-dynamics-accented", "factory-surprise-rhythm-nudge", "factory-percussion-wood-pulse", "factory-space-dry-close"], { registerWidth: 0, noteConnection: "glide" }),
  patch("percussive", "glass-clock", "Glass Clock", "High glass hits in a clean clockwork grid.", ["factory-sub-hit-glass", "factory-melody-high-answer", "factory-rhythm-clock-grid", "factory-dynamics-pulsed", "factory-surprise-still", "factory-percussion-glass-clock", "factory-space-wide-plate"], { registerWidth: 1 }),
  patch("percussive", "metal-stairs", "Metal Stairs", "Hard metal steps with broken rhythm.", ["factory-sub-hit-metal", "factory-melody-pentatonic-roam", "factory-rhythm-broken-pulse", "factory-dynamics-accented", "factory-surprise-rhythm-nudge", "factory-percussion-metal-steps", "factory-space-chamber"]),
  patch("percussive", "low-tom-path", "Low Tom Path", "A low tuned-hit rhythm part.", ["factory-sub-hit-tom", "factory-melody-grounded-minor", "factory-rhythm-halftime", "factory-dynamics-pulsed", "factory-surprise-light-pitch", "factory-percussion-low-tom", "factory-space-living-room"]),
  patch("percussive", "rim-logic", "Rim Logic", "Dry high percussion with exact repetition.", ["factory-sub-hit-rim", "factory-melody-mixolydian-hook", "factory-rhythm-clock-grid", "factory-dynamics-even-bed", "factory-surprise-still", "factory-percussion-rim-grid", "factory-space-dry-close"]),
  patch("percussive", "breath-dust", "Breath Dust", "Soft breath accents across sparse material.", ["factory-sub-hit-breath", "factory-melody-pentatonic-roam", "factory-rhythm-sparse-air", "factory-dynamics-fragile", "factory-surprise-rest-breath", "factory-percussion-breath-dust", "factory-space-forest-air"]),
  patch("percussive", "brass-punctuation", "Brass Punctuation", "Low brass stabs that mark motif starts.", ["factory-sub-hit-brass", "factory-melody-dorian-climb", "factory-rhythm-motif-breath", "factory-dynamics-hero", "factory-surprise-dynamic-flash", "factory-percussion-brass-stab", "factory-space-hall-front"]),
  patch("percussive", "three-point", "Three Point", "A composable three-hit kit over a small major cell.", ["factory-sub-piano-natural", "factory-melody-grounded-major", "factory-rhythm-quick-cells", "factory-dynamics-pulsed", "factory-surprise-woven", "factory-percussion-three-point", "factory-space-booth"]),
  // Melody
  patch("melody", "singing-line", "Singing Line", "A front-and-centre bowed melody.", ["factory-sub-violin-natural", "factory-melody-grounded-major", "factory-rhythm-walking-eighths", "factory-dynamics-hero", "factory-surprise-melodic-turn", "factory-space-living-room"]),
  patch("melody", "wandering-flute", "Wandering Flute", "Breathy dorian travel with gentle changes.", ["factory-sub-flute-chiff", "factory-melody-dorian-climb", "factory-rhythm-motif-breath", "factory-dynamics-gentle", "factory-surprise-formant-shift", "factory-space-hall-front"]),
  patch("melody", "silver-answer", "Silver Answer", "A high brass answer phrase.", ["factory-sub-silver-lead", "factory-melody-high-answer", "factory-rhythm-long-breath", "factory-dynamics-hero", "factory-surprise-dynamic-flash", "factory-space-wide-plate"]),
  patch("melody", "velvet-hook", "Velvet Hook", "Compact clarinet motif in a small room.", ["factory-sub-clarinet-velvet", "factory-melody-mixolydian-hook", "factory-rhythm-motif-breath", "factory-dynamics-gentle", "factory-surprise-light-pitch", "factory-space-living-room"]),
  patch("melody", "fire-arc", "Fire Arc", "A hard bowed lead with wide phrase arcs.", ["factory-sub-violin-fire", "factory-melody-minor-roam", "factory-rhythm-walking-eighths", "factory-dynamics-wide", "factory-surprise-woven", "factory-space-hall-front"]),
  patch("melody", "blue-lantern", "Blue Lantern", "Expressive blue-note cello line.", ["factory-sub-cello-grit", "factory-melody-blues-bend", "factory-rhythm-free-gaps", "factory-dynamics-wide", "factory-surprise-tuning-sheen", "factory-space-chamber"]),
  patch("melody", "reed-pipe-run", "Reed Pipe Run", "Focused, fast reed movement.", ["factory-sub-reed-pipe", "factory-melody-arp-major", "factory-rhythm-quick-cells", "factory-dynamics-accented", "factory-surprise-still", "factory-space-booth"]),
  patch("melody", "sun-call", "Sun Call", "Open bright trumpet statement.", ["factory-sub-trumpet-sun", "factory-melody-grounded-major", "factory-rhythm-long-breath", "factory-dynamics-hero", "factory-surprise-melodic-turn", "factory-space-hall-front"]),
  // Atmos
  patch("atmos", "slow-sky", "Slow Sky", "Far vocal weather with a long cathedral tail.", ["factory-sub-air-choir", "factory-melody-pentatonic-roam", "factory-rhythm-sparse-air", "factory-dynamics-gentle", "factory-surprise-formant-shift", "factory-space-cathedral-far"]),
  patch("atmos", "glass-canopy", "Glass Canopy", "Slow suspended glass figures and distant bells.", ["factory-sub-glass-thread", "factory-melody-pentatonic-roam", "factory-rhythm-drone-space", "factory-dynamics-fragile", "factory-surprise-tuning-sheen", "factory-percussion-bell-canopy", "factory-space-cathedral-far"]),
  patch("atmos", "forest-reed", "Forest Reed", "Hollow reed phrases in open air.", ["factory-sub-hollow-tube", "factory-melody-slendro-roam", "factory-rhythm-sparse-air", "factory-dynamics-whisper", "factory-surprise-rest-breath", "factory-space-forest-air"]),
  patch("atmos", "cave-bloom", "Cave Bloom", "Slow membrane blooms from the side of a cave.", ["factory-sub-membrane-bloom", "factory-melody-whole-tone-float", "factory-rhythm-drone-space", "factory-dynamics-gentle", "factory-surprise-dissolve", "factory-space-cave-side"]),
  patch("atmos", "amber-fog", "Amber Fog", "Warm low string fragments in a distant chamber.", ["factory-sub-amber-string", "factory-melody-minor-roam", "factory-rhythm-free-gaps", "factory-dynamics-fragile", "factory-surprise-incorporating", "factory-space-chamber"]),
  patch("atmos", "crystal-air", "Crystal Air", "High floating wind over open space.", ["factory-sub-crystal-wind", "factory-melody-whole-tone-float", "factory-rhythm-sparse-air", "factory-dynamics-whisper", "factory-surprise-tuning-sheen", "factory-space-forest-air"]),
  patch("atmos", "smoke-hall", "Smoke Hall", "Dark brass chords implied by ringing lines.", ["factory-sub-smoke-brass", "factory-melody-arp-minor", "factory-rhythm-long-breath", "factory-dynamics-gentle", "factory-surprise-still", "factory-space-hall-front"], { noteConnection: "ring" }),
  patch("atmos", "spring-glow", "Spring Glow", "Close, characterful shimmer around sparse strings.", ["factory-sub-shimmer-string", "factory-melody-pentatonic-roam", "factory-rhythm-free-gaps", "factory-dynamics-fragile", "factory-surprise-vowel-story", "factory-space-spring-near"]),
  // Vocal
  patch("vocal", "night-choir", "Night Choir", "Low dark vowels in a huge space.", ["factory-sub-night-choir", "factory-melody-grounded-minor", "factory-rhythm-long-breath", "factory-dynamics-gentle", "factory-surprise-formant-shift", "factory-space-cathedral-far"]),
  patch("vocal", "air-story", "Air Story", "Bright choir vowels that evolve gently.", ["factory-sub-air-choir", "factory-melody-pentatonic-roam", "factory-rhythm-sparse-air", "factory-dynamics-wide", "factory-surprise-vowel-story", "factory-space-hall-front"]),
  patch("vocal", "speaking-arc", "Speaking Arc", "Articulated vowel/reed line in a close room.", ["factory-sub-speaking-reed", "factory-melody-grounded-major", "factory-rhythm-motif-breath", "factory-dynamics-accented", "factory-surprise-melodic-turn", "factory-space-living-room"]),
  patch("vocal", "robot-prayer", "Robot Prayer", "Fixed robotic vowels over a deterministic arpeggio.", ["factory-sub-robot-vowel", "factory-melody-arp-minor", "factory-rhythm-slow-steps", "factory-dynamics-even-bed", "factory-surprise-still", "factory-space-wide-plate"]),
  patch("vocal", "wandering-mouth", "Wandering Mouth", "A vocal line whose vowels keep travelling.", ["factory-sub-wandering-vowel", "factory-melody-minor-roam", "factory-rhythm-free-gaps", "factory-dynamics-wide", "factory-surprise-vowel-story", "factory-space-chamber"]),
  patch("vocal", "open-hymn", "Open Hymn", "Open ah vowels in broad, slow phrases.", ["factory-sub-vowel-ah", "factory-melody-grounded-major", "factory-rhythm-long-breath", "factory-dynamics-gentle", "factory-surprise-light-pitch", "factory-space-hall-front"]),
  patch("vocal", "round-hum", "Round Hum", "Dark oo vowels underpinning a small minor loop.", ["factory-sub-vowel-oo", "factory-melody-grounded-minor", "factory-rhythm-halftime", "factory-dynamics-even-bed", "factory-surprise-still", "factory-space-booth"]),
  patch("vocal", "vocal-percussion", "Vocal Percussion", "Clipped vocal hits over an expandable kit.", ["factory-sub-hit-vocal", "factory-melody-mixolydian-hook", "factory-rhythm-broken-pulse", "factory-dynamics-pulsed", "factory-surprise-rhythm-nudge", "factory-percussion-vocal-puncture", "factory-space-dry-close"]),
  // Experimental
  patch("experimental", "nineteen-sparks", "Nineteen Sparks", "19-EDO glass movement with a clock kit.", ["factory-sub-ice-piano", "factory-melody-edo-19-spark", "factory-rhythm-quick-cells", "factory-dynamics-wide", "factory-surprise-tuning-sheen", "factory-percussion-glass-clock", "factory-space-wide-plate"]),
  patch("experimental", "seven-open", "Seven Open", "7-EDO open wind cells.", ["factory-sub-crystal-wind", "factory-melody-edo-7-open", "factory-rhythm-motif-breath", "factory-dynamics-gentle", "factory-surprise-incorporating", "factory-space-forest-air"]),
  patch("experimental", "whole-tone-machine", "Whole Tone Machine", "Symmetric metal tone on a precise grid.", ["factory-sub-metal-bar", "factory-melody-whole-tone-float", "factory-rhythm-clock-grid", "factory-dynamics-accented", "factory-surprise-still", "factory-percussion-metal-steps", "factory-space-chamber"]),
  patch("experimental", "chromatic-paper", "Chromatic Paper", "Dry unstable reed fragments with free gaps.", ["factory-sub-paper-reed", "factory-melody-chromatic-thread", "factory-rhythm-free-gaps", "factory-dynamics-unstable", "factory-surprise-dissolve", "factory-percussion-paper-kit", "factory-space-dry-close"]),
  patch("experimental", "membrane-orbit", "Membrane Orbit", "Low non-traditional hits circle the listener.", ["factory-sub-membrane-bloom", "factory-melody-edo-7-open", "factory-rhythm-broken-pulse", "factory-dynamics-pulsed", "factory-surprise-woven", "factory-percussion-low-tom", "factory-space-behind-listener"]),
  patch("experimental", "vowel-grid", "Vowel Grid", "Robot vowel fragments over exact rhythm.", ["factory-sub-robot-vowel", "factory-melody-edo-19-spark", "factory-rhythm-clock-grid", "factory-dynamics-accented", "factory-surprise-formant-shift", "factory-percussion-minimal-click", "factory-space-booth"]),
  patch("experimental", "brass-bowl-drift", "Brass Bowl Drift", "Dark metallic brass in a slowly changing form.", ["factory-sub-brass-bowl", "factory-melody-slendro-roam", "factory-rhythm-drone-space", "factory-dynamics-fragile", "factory-surprise-dissolve", "factory-space-cave-side"]),
  patch("experimental", "broken-keys", "Broken Keys", "Unstable piano cells with puncturing rim accents.", ["factory-sub-broken-key", "factory-melody-chromatic-thread", "factory-rhythm-restless-grid", "factory-dynamics-unstable", "factory-surprise-restless", "factory-percussion-rim-grid", "factory-space-spring-near"]),
];

export const FACTORY_CATALOG_TARGETS = Object.freeze({ sound: 56, macro: 65, space: 12, full: 48, total: 181 });
export const FACTORY_PRESETS = Object.freeze([...MODULES, ...FULL_PATCHES]);
