/**
 * app.js — Sound Studio web application.
 *
 * Two-arm architecture:
 *   Arm 1 (Study)   – structured paradigms (slider, pairwise)
 *   Arm 2 (Explore) – free-play sound studio with global preset library
 *
 * All audio is rendered client-side via Web Audio (synth.js).
 * The synthesis engine uses a three-timescale hierarchy:
 *   1. Note-to-note: stacked interval distribution, repetition precision
 *   2. Motif: repeated patterns with motif-pass surprise + incorporation
 *   3. Repertoire: motif sequencing, motif-level surprise, sequence growth
 */

import {
  SynthEngine,
  GenerationEngine,
  HeadphoneCheck,
  SCALE_PRESETS,
  FORMANT_PRESETS,
  PERC_SOUNDS,
  REVERB_PROFILES,
  SPECTRAL_PROFILES,
  spectralDefaultRegisterSensitivity,
  VOWEL_POINTS,
  formantFreqsAtPoint,
  partialFrequency,
  legacyStretchToB,
  BODY_PRESETS,
  bodyBandsFor,
  bodyResponse,
  migrateToneParams,
  materialT60,
  positionComb,
  nearestRatio,
  transferCoupling,
  excitationSpectrum,
  spaceAirCutoff,
  patchBadges,
  splitsBucketOf,
  nearestVowel,
  globalScaleAt,
  trackSpaceAt,
} from "./synth.js";
import { FACTORY_PRESETS } from "./factory-presets.js";

// ─── Constants ──────────────────────────────────────────────

const STORAGE_KEY = "phase0.presets.v3";
const PARTICIPANT_KEY = "phase0.pid.v2";
const ENGAGE_KEY = "phase0.engagement.v3";
// Bump APP_VERSION whenever generation semantics change: it is folded into
// every stimulus_id, so identical parameters across app versions do not
// collide in analysis.
const APP_VERSION = "sound-studio-0.6.0"; // Q8: imperfection laws (scoop/stagger/ring/wander) alter rendering at Human > 0
// Visible build tag: semantic version + the asset build number, read from
// this module's own ?v= cache-buster so the display can never drift from
// what the browser actually loaded.
const BUILD_TAG = (() => {
  let build = "";
  try { build = new URL(import.meta.url).searchParams.get("v") || ""; } catch { /* non-module load */ }
  return `v${APP_VERSION.replace(/^sound-studio-/, "")}${build ? ` · ${build}` : ""}`;
})();
const EVENT_SCHEMA_VERSION = "explore-event-1.0";
const SESSION_ID = crypto.randomUUID(); // fresh per page visit
const CONSENT_KEY = "phase0.consent.v1";
const INSTRUMENTS_KEY = "phase0.instruments.v1";
// Bump when the consent wording or what-we-collect changes; stored with every
// consent decision so records can be tied to the text the volunteer saw.
const CONSENT_VERSION = "explore-consent-1.0";
const FORMANT_CIRCLE = ["ee", "eh", "ah", "oh", "oo"];
const SURPRISE_FEATURES = [
  { key: "pitch", label: "Pitch / Melody", enabled: "surprisePitchEnabled", weight: "surprisePitchWeight", distance: "surprisePitchDistance" },
  { key: "tuning", label: "Tuning", enabled: "surpriseTuningEnabled", weight: "surpriseTuningWeight", distance: "surpriseTuningDistance" },
  { key: "rhythm", label: "Duration", enabled: "surpriseRhythmEnabled", weight: "surpriseRhythmWeight", distance: "surpriseRhythmDistance" },
  { key: "formant", label: "Formant / Timbre", enabled: "surpriseFormantEnabled", weight: "surpriseFormantWeight", distance: "surpriseFormantDistance" },
  { key: "dynamics", label: "Dynamics", enabled: "surpriseDynamicsEnabled", weight: "surpriseDynamicsWeight", distance: "surpriseDynamicsDistance" },
  { key: "rest", label: "Rest", enabled: "surpriseRestEnabled", weight: "surpriseRestWeight", distance: null },
];

// ─── Modular preset sections ────────────────────────────────
// Presets can capture the whole rig or just one section of it. Every
// parameter belongs to exactly one section; `seed` belongs to none (it only
// travels with full presets). Section presets merge into the current state
// on load, leaving everything else untouched — and they are the building
// blocks producer-mode instruments will bundle later.
const PRESET_SECTIONS = {
  sound:      { label: "Sound source" },
  melody:     { label: "Melody & scale" },
  rhythm:     { label: "Rhythm & rests" },
  dynamics:   { label: "Dynamics" },
  surprise:   { label: "Sequence & surprise" },
  percussion: { label: "Percussion" },
  space:      { label: "Space" },
};

const _MELODY_PARAMS = new Set([
  "scaleMode", "scalePreset", "customDegrees", "edoDivisions", "tonicHz",
  "subScaleNotes", "subScaleWeight", "rootNotes", "rootPullStrength",
  "rootPullShape", "intervalPeakedness", "intervalRange", "momentum",
  "registerCenter", "registerWidth", "registerSkew", "precision",
  "precisionRange", "motifHitProb", "motifHitRange",
]);
const _RHYTHM_PARAMS = new Set([
  "tempo", "beatDivisions", "onBeatProb", "offBeatProb", "sameLengthProb",
  "restMotifStartRatio", "restOnMeterRatio", "restOffMeterRatio",
  "gapProb", "gapMin", "gapMax", "gapDistanceSlope", "gapTimingRange",
  "phraseGap", "slideSpeed",
]);
const _SURPRISE_EXTRAS = new Set([
  "motifCount", "motifLengthBeats", "motifLength", "sequenceProb",
  "motifSurpriseProb", "incorporationRate",
  "melSurpriseAmount", "tunSurpriseAmount", "durSurpriseAmount", "dynSurpriseAmount",
]);

function sectionForParam(key) {
  if (key === "seed") return null;
  if (key.startsWith("reverb") || key.startsWith("space")) return "space";
  if (key.startsWith("perc")) return "percussion";
  if (key.startsWith("surprise") || _SURPRISE_EXTRAS.has(key)) return "surprise";
  if (key.startsWith("dynamics") || key === "loudnessRange") return "dynamics";
  if (_RHYTHM_PARAMS.has(key)) return "rhythm";
  if (_MELODY_PARAMS.has(key)) return "melody";
  return "sound"; // voiceMode, formant*, tone*, spectral*, vibrato*, envelope*…
}

function extractSectionParams(params, section) {
  const out = {};
  for (const [k, val] of Object.entries(params)) {
    if (sectionForParam(k) === section) out[k] = val;
  }
  return out;
}

// ── Instruments (producer mode, docs/DAW_MODE_DESIGN.md) ────
// An instrument is a complete voice: everything timbral and behavioural,
// EXCLUDING the session-context tier (tempo, key/scale, master dynamics,
// shared space) which the session provides and the instrument inherits.
// Loading an instrument therefore merges over the current state, leaving
// the musical context untouched.
const SESSION_CONTEXT_PARAMS = new Set([
  "seed", "tempo", "scaleMode", "scalePreset", "customDegrees",
  "edoDivisions", "tonicHz", "rootNotes", "dynamicsLevel",
  "reverbType", "reverbWet", "reverbDecay", "reverbTone", "reverbPreDelay",
]);

function extractInstrumentParams(params) {
  const out = {};
  for (const [k, val] of Object.entries(params)) {
    if (!SESSION_CONTEXT_PARAMS.has(k)) out[k] = val;
  }
  return out;
}

// ── Q1: patch transparency badges + module halves ───────────
// Badge row summarising what a patch will do in the arrangement —
// derivation lives in synth.js (patchBadges) so it is asserted headlessly.
function patchBadgesHTML(params, originTempo = null, compact = false) {
  const b = patchBadges(params);
  const tempo = originTempo ?? b.tempo;
  const chips = [
    `<span class="pb-chip" title="Scale this patch plays in">${esc(b.scaleLabel)}</span>`,
    `<span class="pb-chip" title="Number of splits — scale degrees per octave">${b.splits} splits</span>`,
    `<span class="pb-chip" title="Duration grid — subdivisions per beat">grid ${b.grid}</span>`,
    tempo ? `<span class="pb-chip" title="The tempo this patch was designed at">${tempo} bpm</span>` : "",
    `<span class="pb-chip" title="Overlap behaviour: glide (mono legato) or ring (multiphonic)">${esc(b.connection)}</span>`,
    b.surpriseOn
      ? `<span class="pb-chip pb-surprise" title="Surprise is ON — dimensions: ${b.dims.join(", ")} (P itch, T uning, R hythm, F ormant, D ynamics)">✦ ${b.dims.join("·")}</span>`
      : `<span class="pb-chip pb-off" title="Surprise is off">no ✦</span>`,
  ].filter(Boolean);
  return `<span class="pb-row${compact ? " pb-compact" : ""}">${chips.join("")}</span>`;
}

// The two halves of a patch: MACRO ENGINE (how it behaves — melody, rhythm,
// dynamics, surprise) and SUBNOTE MODULE (how it sounds). Loading a preset
// with a half selected replaces only that half's keys; percussion and space
// ride along only on full (BOTH) loads.
const _MACRO_SECTIONS = new Set(["melody", "rhythm", "dynamics", "surprise"]);
function loadPresetIntoPatch(pl, item, half) {
  const incoming = voiceParamsFor(item);
  if (half === "macro" || half === "subnote") {
    const wanted = half === "macro"
      ? (k) => _MACRO_SECTIONS.has(sectionForParam(k))
      : (k) => sectionForParam(k) === "sound";
    for (const [k, val] of Object.entries(incoming)) {
      if (wanted(k)) pl.params[k] = val;
    }
  } else {
    pl.params = incoming;
    pl.name = item.name;
    pl.kindLabel = item.kindLabel;
    pl.sourceId = item.id;
  }
  // The design tempo + scale travel with macro/full loads only — a sound
  // has neither.
  if (half !== "subnote" && item.params) {
    if (item.params.tempo != null) pl.originTempo = item.params.tempo;
    if (item.params.scalePreset || item.params.customDegrees) {
      pl.originScale = {
        scaleMode: item.params.scaleMode, scalePreset: item.params.scalePreset,
        customDegrees: item.params.customDegrees, edoDivisions: item.params.edoDivisions,
      };
    }
  }
}

function loadInstruments() {
  try { return JSON.parse(localStorage.getItem(INSTRUMENTS_KEY) || "[]"); } catch { return []; }
}
function saveInstruments(list) {
  localStorage.setItem(INSTRUMENTS_KEY, JSON.stringify(list.slice(0, 100)));
}

const DEFAULTS = {
  tempo: 104,
  seed: 1001,
  voiceMode: "fourier",
  scaleMode: "12tone",
  scalePreset: "major",
  edoDivisions: 12,
  customDegrees: null,
  subScaleNotes: [0, 4, 7],
  subScaleWeight: 0.7,
  tonicHz: 261.63,
  intervalPeakedness: 2.0,
  melodyPattern: "walk",
  attackNoiseLevel: 1,
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
  partialTransfer: 0.15,
  bodyType: "auto",
  bodyArticulation: 0,
  // null = derive from legacy spectralStretchCents; a finite value wins
  partialB: null,
  // SPACE positioning: where the instrument stands relative to the listener
  spaceDistance: 2.5,
  spaceAzimuth: 0,
  earDistance: 0.175, // Q4: listener ear-to-ear span in metres (head size IS this)
  headDensity: 0.5,   // Q4: how hard the head shadows the far ear (0 = transparent)
  layers: null,           // Q7: extra subnote modules [{id, hue, subnote, space, gain, independentHead}]
  layerEnvOverride: false, // Q7: true = one envelope draw shared by base + all layers
  spectralProb: 1,
  spectralMix: 0.65,
  spectralPartials: 20,
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

// ─── Setting descriptions ──────────────────────────────────

const PARAM_DESC = {
  tempo: "Playback speed in beats per minute",
  attackNoiseLevel: "Scales the instrument's onset transient (bow scratch, breath chiff, hammer thump): 0 = removed, 1 = as measured/designed, 2 = exaggerated",
  melodyPattern: "How the melody chooses notes: Walk = the probabilistic interval walk shaped by the dials below; Arp = a deterministic cycle over a fixed set of in-scale notes (up, down, or up-and-down) — rhythm, rests, dynamics and surprise still apply on top",
  arpStep: "Arp stride in scale steps: 2 = every other scale note (thirds, triad-like), 3 = wider voicings, 1 = a scale run",
  arpOctaves: "How many octaves the arp cycle spans before it wraps",
  intervalPeakedness: "Shape of the interval distribution. At the bottom of the dial every interval size within the range is equally likely (flat/uniform); raising it forms a bell that narrows to a sharp point at the top (stepwise/repeat). The range sets how far the flat/uniform spread reaches",
  intervalRange: "Maximum interval size in scale degrees — the hard limit of the interval distribution. Widening it stretches the whole shape: at the flat/uniform end it sets how far equal-probability intervals reach; with the bell it widens the spread",
  momentum: "Tendency to keep moving in the same direction as the previous step. Stronger after short notes, fades near register edges (max 80% continuation)",
  motifHitProb: "Probability that playback hits the expected motif note",
  motifHitRange: "Maximum miss distance in scale degrees when the motif note is not hit",
  precision: "Probability that a note is tuned exactly to its target pitch",
  precisionRange: "Maximum intonation error in cents when tuning is imperfect",
  subScaleWeight: "How strongly note selection is biased toward sub-scale (gold) notes",
  beatDivisions: "Subdivisions per beat. Higher = finer rhythmic grid for note placement",
  onBeatProb: "Probability of a new note starting on each beat division boundary",
  offBeatProb: "Probability of a new note starting between beat boundaries",
  sameLengthProb: "Extra probability boost for notes to repeat the previous note's duration",
  restMotifStartRatio: "Ratio of motif-start note slots that become rests instead of sounded notes",
  restOnMeterRatio: "Ratio of non-start notes on the beat/meter that become rests instead of sounded notes",
  restOffMeterRatio: "Ratio of non-start notes between beats/off the meter that become rests instead of sounded notes",
  rootPullStrength: "How strongly the melody is pulled toward the selected root note(s)",
  rootPullShape: "Pull timing: 0 = constant pull, 1 = pull only kicks in toward phrase end",
  registerCenter: "Centre of the comfortable pitch range (in scale degrees from tonic)",
  registerWidth: "How wide the comfortable register is. Narrow = stays near centre",
  registerSkew: "Asymmetrically weights the register. Negative = wider low tail, positive = wider high tail",
  surpriseProb: "Chance that a motif pass contains one surprised note. Select which variables below can be surprised",
  surprisePitchEnabled: "Include pitch/scale-degree as a possible surprise feature",
  surpriseTuningEnabled: "Include cents-level tuning as a possible surprise feature",
  surpriseRhythmEnabled: "Include note-duration change as a possible surprise feature",
  surpriseFormantEnabled: "Include vowel/formant change as a possible surprise feature",
  surpriseDynamicsEnabled: "Include loud/soft dynamic change as a possible surprise feature",
  surpriseRestEnabled: "Include rest/silence as a possible surprise feature",
  surprisePitchWeight: "Relative chance that a surprise uses pitch once a surprise has happened",
  surpriseTuningWeight: "Relative chance that a surprise uses cents-level tuning once a surprise has happened",
  surpriseRhythmWeight: "Relative chance that a surprise uses duration once a surprise has happened",
  surpriseFormantWeight: "Relative chance that a surprise uses formant once a surprise has happened",
  surpriseDynamicsWeight: "Relative chance that a surprise uses dynamics once a surprise has happened",
  surpriseRestWeight: "Relative chance that a surprise uses rest once a surprise has happened",
  surprisePitchDistance: "How far pitch surprises sit from the ordinary accuracy distribution",
  surpriseTuningDistance: "How far tuning surprises sit from the ordinary cents distribution",
  surpriseRhythmDistance: "How far duration surprises sit from the ordinary rhythm distribution",
  surpriseFormantDistance: "How far formant surprises sit from the ordinary vowel distribution",
  surpriseDynamicsDistance: "How far dynamic surprises sit from the ordinary loudness distribution",
  surpriseAllowMultiple: "Allow multiple feature changes on the same surprised note",
  incorporationRate: "When a motif-pass surprise occurs, chance it gets baked into the growing repertoire loop",
  surpriseMaxBaked: "Maximum number of incorporated surprise variants allowed. Infinity lets the loop keep growing",
  formantChangeProb: "Probability of switching vowel sound between notes",
  formantFocus: "The formant at the centre of the visible accuracy/surprise distribution",
  formantEditAll: "Apply formant accuracy and surprise-distance edits to every formant at once",
  formantAccuracy: "Probability that playback keeps the expected formant colour",
  formantAccuracyRange: "How far a missed vowel can drift, in circle steps — up to half a circle. Misses land continuously, between vowels too",
  dynamicsLevel: "Loudness register centre — where the dynamics settle (analogue of the melodic register centre)",
  loudnessRange: "Loudness register width — the soft/loud limits the dynamics stay within (analogue of the melodic register width)",
  dynamicsPrecision: "Accuracy: probability the previously generated dynamic is reproduced exactly",
  dynamicsRange: "Generation: how variable the loudness is from one note to the next",
  motifCount: "Number of distinct melodic patterns generated at the start",
  motifLengthBeats: "Length of each motif in beats (multiplied by beat divisions for total grid)",
  sequenceProb: "How strictly motifs follow a fixed order vs. random selection",
  motifSurpriseProb: "Chance of a whole-motif repertoire mutation at a motif boundary. Counts toward the incorporated surprise limit",
  percBeatVol: "Volume of the beat tick percussion layer",
  percMotifVol: "Volume of the accent that marks motif boundaries",
  percDownbeatVol: "Volume of the downbeat emphasis",
  percDownbeatEvery: "Downbeat accent repeats every N beats within the motif",
  reverbType: "Convolution impulse profile used for the global space effect",
  reverbWet: "How much convolved reverb signal is mixed into the output",
  reverbDecay: "Length multiplier for the generated impulse response",
  reverbTone: "Brightness of the reverb tail",
  reverbPreDelay: "Delay before the reverberated sound begins",
  toneColorProb: "Chance that a note receives sub-note tone-colour variation",
  toneFormantDrift: "Maximum probabilistic shift of formant positions",
  toneResonanceDrift: "Maximum probabilistic change in filter resonance",
  toneBreath: "Amount of probabilistic breath/noise mixed into the tone",
  vibratoProb: "Chance that a connected phrase receives vibrato",
  vibratoDepth: "Mean vibrato depth in cents",
  vibratoDepthSd: "Standard deviation of vibrato depth, sampled once per vibrato cycle",
  vibratoRate: "Mean vibrato rate in cycles per second",
  vibratoRateSd: "Standard deviation of vibrato rate, sampled once per vibrato cycle",
  spectralProb: "Chance that each new note samples every harmonic amplitude from its mean/SD distribution. Otherwise it uses the means; Hold drift handles changes during a held note",
  spectralMix: "How strongly the harmonic fingerprint is mixed into the tone",
  spectralPartials: "Number of harmonic partials in the Fourier fingerprint",
  spectralSpread: "Global scale for each harmonic's amplitude distribution",
  spectralDynamicAmount: "How strongly note dynamics reshape each harmonic amplitude",
  spectralRegisterAmount: "How strongly note range reshapes each harmonic amplitude",
  spectralResonanceAmount: "How strongly fixed instrument resonances reshape absolute harmonic frequencies",
  partialMaterial: "Damping law for the harmonic partials: low values let every partial ring (glass, metal); high values make the upper partials die away quickly (wood, felt). Applied per note, faster decay for higher harmonics",
  excitationType: "How energy enters the resonator: bow (continuous drive), pluck (displacement release), strike (force impulse), blow (air jet). Sets the physical drive spectrum",
  excitationPosition: "Where the string/tube/membrane is excited (0.02 near the edge to 0.5 the middle). Modes with a node at this point go silent — 0.5 kills every even partial, 0.33 every third. Applied relative to the instrument's natural position",
  excitationHardness: "Contact hardness for strike/pluck: soft (felt hammer, long contact) rolls off the highs; hard (wood, short contact) lets them through. No effect on bow/blow",
  excitationHuman: "The player: one seeded fluctuation per note wobbles bow pressure / breath support, moving the whole spectrum together (brighter when pushed), with bow slips or breath bursts. Struck/plucked notes get per-note velocity and hardness jitter instead. 0 = machine",
  partialTransfer: "Sympathetic resonance: energy flows between partials whose ACTUAL frequencies sit near simple ratios (octave strongest, then fifth, fourth…), blooming quiet partials near strong relatives over the sustain. Inharmonicity detunes pairs out of resonance, weakening the transfer — exactly like real sympathetic strings",
  bodyType: "The box around the resonator: a set of fixed-Hz resonance bands. Auto keeps the instrument's own measured body; vowels are bodies too (F1–F5 bands). With vibrato, partials on body slopes shimmer in amplitude — real FM→AM",
  partialB: "Stiff-string inharmonicity: partials sharpen as f·n·√(1+Bn²). Piano bass ≈ 1e-4, treble ≈ 1e-3; 0 = perfectly harmonic. Rising B detunes partial pairs out of sympathetic resonance, weakening Transfer",
  spaceDistance: "How far the instrument stands from you (0.3–30 m). Distance delays the sound's arrival (~3 ms/m), rolls off the highs (air absorption), lowers the direct level against the room, and inside ~1 m adds the proximity bass lift",
  spaceAzimuth: "The instrument's bearing, all the way around you (−180°…180°): per-ear arrival times, far-ear head shadow, and a pinna cue that makes sounds behind you duller than in front — real binaural physics, not simple panning",
  earDistance: "Your ear-to-ear span (0.12–0.25 m). Wider ears = bigger interaural time differences = a wider, more localised stereo image",
  headDensity: "How opaque your head is to sound (0–1). Denser = the far ear loses more level and more treble when a source sits to one side",
  layers: "Extra sound modules stacked on this instrument — each renders the same notes through its own tone, position and level",
  layerEnvOverride: "Sync the envelope variation: one draw per note shared by the base sound and every layer, instead of each layer varying independently",
  spectralLoudnessNorm: "How strongly random harmonic amplitude draws are normalised back toward expected loudness",
  spectralDriftProb: "Chance that harmonic amplitudes keep wandering during a held note",
  spectralDriftDepth: "How much of each harmonic's SD is used for within-note amplitude drift",
  spectralDriftRate: "How often held-note harmonic amplitudes redraw and glide",
  spectralStretchCents: "Optional high-harmonic frequency stretch. Zero keeps fixed harmonic frequencies",
  envelopeProb: "Chance that the onset/decay/sustain/release envelope varies",
  envelopeAttack: "Mean attack/onset time in seconds",
  envelopeAttackSd: "Standard deviation of attack/onset time",
  envelopeDecay: "Mean decay time in seconds",
  envelopeDecaySd: "Standard deviation of decay time",
  envelopeSustain: "Mean sustain level",
  envelopeSustainSd: "Standard deviation of sustain level",
  envelopeRelease: "Mean release time in seconds",
  envelopeReleaseSd: "Standard deviation of release time",
  gapProb: "Chance that articulation is sampled from the break/legato distribution",
  gapMin: "Lower edge of the articulation distribution. Negative values connect into the next note",
  gapMax: "Upper edge of the articulation distribution. Positive values leave silence before the next note",
  gapDistanceSlope: "How strongly larger melodic intervals move toward the upper break value",
  gapTimingRange: "Random articulation variation around the chosen break or legato value",
  noteConnection: "What happens when notes overlap (negative gap): Glide slides the new note's pitch from the previous one (single voice, legato); Ring lets both keep sounding at their own pitches (multiphonic)",
  slideSpeed: "How quickly connected notes glide into the next pitch when the sampled value is zero or below",
  phraseGap: "Minimum break at motif/phrase boundaries",
};

const UI_DESC = {
  playBtn: "Start live Web Audio playback with the current parameter distributions.",
  stopBtn: "Stop playback and clear scheduled notes.",
  randBtn: "Generate a coherent random preset across the whole synthesiser.",
  seedBtn: "Generate a new random seed. The same seed and parameters recreate the same sequence.",
  regenBtn: "Rebuild the generative sequence from the start with the current parameters, while playback keeps running — so you can hear the from-scratch result of your latest tweaks.",
  backHome: "Return to the opening screen.",
  saveBtn: "Save the current full parameter set as a local browser preset.",
  tabMy: "Show presets saved in this browser.",
  tabGlobal: "Show presets shared by other listeners.",
  ratingSlider: "Rate how much you like the current sound from 1 to 7.",
  presetName: "Name this preset before saving it locally.",
  contribAlias: "Optional name to show with a shared community preset.",
  contribNotes: "Optional notes about what you like in this preset.",
  contribConsent: "Consent checkbox required before adding the preset to the shared library.",
  contribBtn: "Share the current preset with the community sound library.",
  scalePresetSelect: "Choose a 12-tone scale preset and update the active scale degrees.",
  edoDivisionsInput: "Set the number of equal octave divisions for N-EDO mode.",
  vis: "Live analyser display of the current audio output.",
  cvInterval: "Probability distribution over melodic interval sizes.",
  cvMelodyAccuracy: "Melody accuracy and surprise display. The centre is the expected motif note; the bracket marks the finite display range around infinite probability tails.",
  cvTuningAccuracy: "Tuning accuracy display in cents. Cents are hundredths of a 12-tone semitone, independent of the selected scale or EDO.",
  cvRoot: "How strongly root pull acts across the phrase.",
  cvRegister: "Register probability curve across pitch height.",
  cvLoudnessRegister: "Loudness register: where the dynamics settle (centre) and the soft/loud limits (range). Analogue of the melodic register.",
  cvDurationAccuracy: "Duration accuracy and surprise display. Y-axis units follow the current beat-division grid.",
  cvDynamicsAccuracy: "Dynamics accuracy and surprise display. Y-axis shows loudness difference from the ordinary dynamic centre.",
  cvFormantAccuracy: "Formant accuracy and surprise display around a circular vowel sequence. The selected formant is the centre row.",
  cvGap: "Articulation distribution. Values above zero create rests; values at or below zero connect or slide notes.",
  cvReverb: "Convolution impulse preview. Orange shows the decay envelope, blue suggests early reflections.",
  cvHarmonicSignature: "Harmonic fingerprint display. Orange is mean, blue is SD, grey/green show low/high register response.",
  libraryCard: "Saved local presets and shared community presets.",
};

const SECTION_DESC = {
  Scale: "Choose the pitch set available to the generative engine.",
  "Macro Probability": "Select one macro layer and edit its probability distribution in the shared monitor.",
  Melody: "Control scale-degree movement, motif-hit accuracy, and register.",
  Tuning: "Control cents-level pitch accuracy.",
  Duration: "Control onset likelihood, note length, rests, breaks, and slides.",
  Dynamics: "Control loudness accuracy and dynamic variation.",
  "Root Pull": "Choose tonal centre notes and how strongly melody is drawn toward them.",
  Register: "Shape the pitch height and range where melodies tend to live.",
  Rhythm: "Control note onset probabilities and rhythmic regularity.",
  "Markov Sequence": "Control motif states, loop length, ordering bias, and surprise incorporation.",
  Production: "Optional listening context that does not regenerate motif material.",
  "Sound Source": "Choose between the vowel/formant model and the additive Fourier harmonic model.",
  "Formant Voice": "Choose the vowel/formant palette used by Formant mode.",
  Surprise: "Choose what changes when a motif pass contains one surprise, and whether it becomes part of the loop.",
  Breaks: "Shape gaps between notes and phrase-boundary separations.",
  Percussion: "Add beat, motif, and downbeat accent layers.",
  Space: "Add generated convolution reverbs after the synthesiser.",
  "Harmonic Decomposition": "Inspect every harmonic partial and the combined waveform produced by the current fingerprint. Disabled while Formant mode is selected.",
  "Instrument Fourier Print": "Choose and shape the instrument-like harmonic fingerprint used by Fourier mode.",
  "Colour Distribution": "Shape sub-note formant, resonance, and breath variation used by Formant mode.",
  "Vibrato Distribution": "Shape pitch vibrato whose depth and rate are resampled every vibration cycle.",
  "Envelope Distribution": "Shape attack, decay, sustain, and release distributions for each note.",
};

const DIMENSION_DESC = {
  pitch: "Surprise may change the pitch by a scale-degree offset.",
  octave: "Surprise may jump the note by an octave.",
  formant: "Surprise may switch to a different active vowel/formant.",
  rhythm: "Surprise may halve or double the expected duration.",
  dynamics: "Surprise may make the note much quieter or louder.",
  rest: "Surprise may replace the note with silence.",
};

const WORKSPACE_DESC = {
  explore: "Show the main macro-level synthesiser controls.",
  subnote: "Open the detailed harmonic, tone-colour, and envelope workspace.",
};

const PERFORMANCE_DESC = {
  breaks: "Edit probabilistic breaks between notes and phrases.",
  percussion: "Edit optional percussion accent layers.",
  space: "Edit global generated convolution reverb.",
};

const VOICE_MODE_DESC = {
  formant: "Formant synthesis: sawtooth through vowel-like filters.",
  fourier: "Fourier synthesis: additive harmonic partials shaped by amplitude distributions.",
  sine: "Simple sine oscillator tone.",
  triangle: "Simple triangle oscillator tone.",
};

const SCALE_MODE_DESC = {
  "12tone": "Use standard 12-tone equal temperament.",
  edo: "Use arbitrary equal divisions of the octave.",
};

// Base params for study trials (all fields present)
const STUDY_BASE = {
  ...DEFAULTS,
  customDegrees: [0, 2, 4, 5, 7, 9, 11], // major scale
  subScaleNotes: [0, 4, 7],
  activeFormants: ["ah", "oh"],
};

// Slider paradigm: 3 params x 3 starting values = 9 trials
const SLIDER_TRIALS = [
  { param: "surpriseProb", label: "Surprise", start: 0.02, min: 0, max: 1, step: 0.01, lo: "Predictable", hi: "Surprising" },
  { param: "surpriseProb", label: "Surprise", start: 0.30, min: 0, max: 1, step: 0.01, lo: "Predictable", hi: "Surprising" },
  { param: "surpriseProb", label: "Surprise", start: 0.12, min: 0, max: 1, step: 0.01, lo: "Predictable", hi: "Surprising" },
  { param: "intervalPeakedness", label: "Melodic shape", start: 0.3, min: 0, max: 4, step: 0.05, lo: "Jumpy", hi: "Stepwise" },
  { param: "intervalPeakedness", label: "Melodic shape", start: 3.0, min: 0, max: 4, step: 0.05, lo: "Jumpy", hi: "Stepwise" },
  { param: "intervalPeakedness", label: "Melodic shape", start: 1.5, min: 0, max: 4, step: 0.05, lo: "Jumpy", hi: "Stepwise" },
  { param: "tempo", label: "Tempo", start: 72, min: 50, max: 180, step: 1, lo: "Slow", hi: "Fast" },
  { param: "tempo", label: "Tempo", start: 148, min: 50, max: 180, step: 1, lo: "Slow", hi: "Fast" },
  { param: "tempo", label: "Tempo", start: 104, min: 50, max: 180, step: 1, lo: "Slow", hi: "Fast" },
];

// Pairwise paradigm: pairs differing on one parameter
const PAIRWISE_TRIALS = [
  { param: "surpriseProb", a: 0.02, b: 0.15 },
  { param: "surpriseProb", a: 0.15, b: 0.35 },
  { param: "surpriseProb", a: 0.02, b: 0.35 },
  { param: "surpriseProb", a: 0.08, b: 0.25 },
  { param: "intervalPeakedness", a: 0.3, b: 1.5 },
  { param: "intervalPeakedness", a: 1.5, b: 3.5 },
  { param: "intervalPeakedness", a: 0.3, b: 3.5 },
  { param: "intervalPeakedness", a: 0.8, b: 2.5 },
  { param: "tempo", a: 72, b: 120 },
  { param: "tempo", a: 120, b: 160 },
  { param: "tempo", a: 72, b: 160 },
  { param: "tempo", a: 90, b: 140 },
];

const NOTE_NAMES_12 = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// ─── State ──────────────────────────────────────────────────

const synth = new SynthEngine();
window._synthQA = synth; // QA hook (matches _rollHitsQA): inspect the audio graph in tests
let el;
let animFrame = null;
let canvas, canvasCtx;
let _lastMarkerTick = 0;     // throttle for live note-trace redraws
let _markersActive = false;  // whether the note trace was drawn last frame

// Frequency-response area view mode: "spectrum" | "motifs" | "pianoroll"
let visMode = "spectrum";
const VIS_MODE_LABEL = {
  spectrum: "Frequency Response",
  motifs: "Motif Timeline",
  pianoroll: "Piano Roll",
};
// Smoothed pitch range for the piano roll (avoids jitter as notes scroll in/out)
let _pianoRange = null;

// Study state
let studyParadigm = null;
let studyTrials = [];
let studyIndex = 0;
let studyResponses = [];
let studyDemographics = {};
let studyStartTime = 0;
let trialStartTime = 0;
let sliderTrajectory = [];
let headphonePassed = false;

// Explore state
let exploreParams = { ...DEFAULTS };
let exploreRating = 4;
let exploreEngagement = loadEngagement();
let workspaceTab = "explore";
let macroTab = "melody";
let macroSubTab = { melody: "accuracy", tuning: "accuracy", duration: "generation", dynamics: "generation" };
let productionTab = "percussion";
let debounceTimer = null;
let lastSurpriseCount = 0;
let lastPlayStartedAt = null; // Date.now() of most recent play start this visit
let _visResizeObserver = null; // hero display fit observer
let libraryFilter = "all";    // section filter shared across library tabs
let splitsFilter = "all";     // Q1: filter presets by scale splits (degrees/octave)
let _palHalfSel = {};         // Q1: paletteId → "macro"|"both"|"subnote" load target
// In-context preset preview (Tonalic cue): audition a preset merged into the
// current state without committing it. Non-destructive: exploreParams is
// untouched; ending the preview restores exactly what was playing.
let presetPreview = null;     // { snapshot, wasPlaying, presetId }

// ─── Helpers ────────────────────────────────────────────────

function pid() {
  let id = localStorage.getItem(PARTICIPANT_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(PARTICIPANT_KEY, id); }
  return id;
}

// Deterministic id for "the performance you would hear from these settings":
// FNV-1a over the canonicalised parameter set (seed included) plus
// APP_VERSION, run with two offsets for 64 bits of hex.
function stimulusIdFor(params) {
  const keys = Object.keys(params).sort();
  const str = APP_VERSION + "|" + keys.map(k => `${k}=${JSON.stringify(params[k])}`).join("&");
  const fnv = (offset) => {
    let h = offset >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(0x811c9dc5) + fnv(0x741c9dc3);
}

function loadConsent() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || "null"); } catch { return null; }
}
function saveConsent(record) { localStorage.setItem(CONSENT_KEY, JSON.stringify(record)); }
function researchOptedIn() { return loadConsent()?.status === "granted"; }

function loadEngagement() {
  try { return JSON.parse(localStorage.getItem(ENGAGE_KEY) || "{}"); } catch { return {}; }
}
function saveEngagement() { localStorage.setItem(ENGAGE_KEY, JSON.stringify(exploreEngagement)); }

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}
function savePresets(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 100))); }

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmt(v) {
  return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function titleAttr(text) {
  return text ? ` title="${esc(text)}" aria-label="${esc(text)}"` : "";
}

function setTooltip(el, text) {
  if (!el || !text) return;
  el.title = text;
  if (!el.hasAttribute("aria-label") && /^(INPUT|SELECT|TEXTAREA|CANVAS)$/.test(el.tagName)) {
    el.setAttribute("aria-label", text);
  }
}

function describeParam(param, label = "") {
  return PARAM_DESC[param] || label || param;
}

// CH-B1: the Formant/Fourier mode split is retired — one chain, always.
// Vocal character = an ARTICULATED body (bodyType "vocal") that follows
// the engine's per-note vowel walk. These stay as inert shims.
function normaliseVoiceMode() { return "fourier"; }
function isFormantMode() { return false; }

function syncSurpriseFeatureParams(p) {
  const dims = Array.isArray(p.surpriseDimensions) ? p.surpriseDimensions : [];
  const hasModern = [
    "surprisePitchEnabled",
    "surpriseTuningEnabled",
    "surpriseRhythmEnabled",
    "surpriseFormantEnabled",
    "surpriseDynamicsEnabled",
    "surpriseRestEnabled",
  ].some(key => typeof p[key] === "boolean");
  if (!hasModern) {
    p.surprisePitchEnabled = dims.includes("pitch") || dims.includes("octave") || dims.length === 0;
    p.surpriseTuningEnabled = dims.includes("tuning");
    p.surpriseRhythmEnabled = dims.includes("rhythm");
    p.surpriseFormantEnabled = dims.includes("formant");
    p.surpriseDynamicsEnabled = dims.includes("dynamics");
    p.surpriseRestEnabled = dims.includes("rest");
  }
  // All dimensions off is a legitimate state: surprise is OFF. (This used
  // to force pitch back on, which made melody surprise impossible to
  // disable — owner bug report 2026-07-07.)
  p.surpriseDimensions = [
    p.surprisePitchEnabled ? "pitch" : null,
    p.surpriseTuningEnabled ? "tuning" : null,
    p.surpriseRhythmEnabled ? "rhythm" : null,
    p.surpriseFormantEnabled ? "formant" : null,
    p.surpriseDynamicsEnabled ? "dynamics" : null,
    p.surpriseRestEnabled ? "rest" : null,
  ].filter(Boolean);
  p.surprisePitchWeight = p.surprisePitchWeight ?? 1;
  p.surpriseTuningWeight = p.surpriseTuningWeight ?? 0.45;
  p.surpriseRhythmWeight = p.surpriseRhythmWeight ?? 0.45;
  p.surpriseFormantWeight = p.surpriseFormantWeight ?? 0.45;
  p.surpriseDynamicsWeight = p.surpriseDynamicsWeight ?? 0.35;
  p.surpriseRestWeight = p.surpriseRestWeight ?? 0.2;
  p.surprisePitchDistance = p.surprisePitchDistance ?? 1;
  p.surpriseTuningDistance = p.surpriseTuningDistance ?? 0.9;
  p.surpriseRhythmDistance = p.surpriseRhythmDistance ?? 0.8;
  p.surpriseFormantDistance = p.surpriseFormantDistance ?? 0.85;
  p.surpriseDynamicsDistance = p.surpriseDynamicsDistance ?? 0.85;
  p.surpriseAllowMultiple = !!p.surpriseAllowMultiple;
}

function ensureFormantWeights(p) {
  const keys = Object.keys(FORMANT_PRESETS);
  const weights = (p.formantWeights && typeof p.formantWeights === "object" && !Array.isArray(p.formantWeights))
    ? { ...p.formantWeights }
    : {};
  keys.forEach(k => {
    if (!Number.isFinite(Number(weights[k]))) weights[k] = 1;
    weights[k] = Math.max(0, Math.min(1, Number(weights[k])));
  });
  p.formantWeights = weights;
  if (!FORMANT_PRESETS[p.formantFocus]) p.formantFocus = p.activeFormants?.[0] || "ah";
  // Accuracy + surprise are global (apply to every formant equally) — always "edit all".
  p.formantEditAll = true;
  // Half a vowel circle is the largest a sung vowel can miss by (e.g. ±2.5 steps
  // for 5 vowels). The miss range is continuous — it can land between vowels.
  const formantHalf = (FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]).length || keys.length) / 2;
  p.formantAccuracy = clamp(Number(p.formantAccuracy ?? 0.85), 0, 1);
  p.formantAccuracyRange = Math.max(0, Math.min(formantHalf, Number(p.formantAccuracyRange ?? 1)));
  p.surpriseFormantDistance = clamp(Number(p.surpriseFormantDistance ?? 0.85), 0, 1);
  // Accuracy + surprise apply to every formant equally: mirror the global scalar
  // into every per-formant slot so the engine (which reads the map first) never
  // produces vowel-specific behaviour, even when loading older varied presets.
  p.formantAccuracyByFormant = uniformFormantMap(p.formantAccuracy);
  p.formantRangeByFormant = uniformFormantMap(p.formantAccuracyRange);
  p.surpriseFormantDistanceByFormant = uniformFormantMap(p.surpriseFormantDistance);
}

function uniformFormantMap(value, integer = false) {
  const v = integer ? Math.round(Number(value) || 0) : (Number(value) || 0);
  return Object.fromEntries(Object.keys(FORMANT_PRESETS).map(key => [key, v]));
}

function normaliseFormantMap(value, fallback, min, max, integer = false) {
  const map = (value && typeof value === "object" && !Array.isArray(value)) ? { ...value } : {};
  Object.keys(FORMANT_PRESETS).forEach(key => {
    let v = Number(map[key] ?? fallback);
    if (!Number.isFinite(v)) v = fallback;
    v = Math.max(min, Math.min(max, v));
    map[key] = integer ? Math.round(v) : v;
  });
  return map;
}

function decorateTooltips(root = document) {
  root.querySelectorAll(".control-row").forEach(row => {
    const input = row.querySelector("[data-param]");
    if (!input) return;
    const label = row.querySelector(".label")?.textContent?.trim() || input.dataset.param;
    const text = `${label}: ${describeParam(input.dataset.param, label)}`;
    setTooltip(row, text);
    setTooltip(row.querySelector(".label"), text);
    setTooltip(input, text);
    setTooltip(row.querySelector("output"), text);
  });

  root.querySelectorAll("[data-param-select]").forEach(sel => {
    const key = sel.dataset.paramSelect;
    const label = sel.closest(".control-row")?.querySelector(".label")?.textContent?.trim()
      || (key === "spectralProfile" ? "Instrument profile" : key);
    setTooltip(sel, `${label}: ${describeParam(key, "Choose a parameter option.")}`);
  });
  root.querySelectorAll("[data-perc]").forEach(sel => {
    setTooltip(sel, "Choose the sound used by this percussion layer.");
  });

  Object.entries(UI_DESC).forEach(([id, text]) => setTooltip(root.querySelector(`#${id}`), text));
  root.querySelectorAll(".section-label").forEach(label => {
    const text = SECTION_DESC[label.textContent.trim()];
    setTooltip(label, text);
    setTooltip(label.closest(".card, .perf-section, .subnote-side-section, .harmonic-stage"), text);
  });

  root.querySelectorAll("[data-workspace-tab]").forEach(btn => {
    setTooltip(btn, WORKSPACE_DESC[btn.dataset.workspaceTab]);
  });
  root.querySelectorAll("[data-macro-tab]").forEach(btn => {
    const text = {
      melody: "Edit scale-degree motion, motif-hit accuracy, melody surprise, and register.",
      tuning: "Edit cents-level pitch accuracy and tuning surprise.",
      duration: "Edit note durations, rests, breaks, slides, and duration surprise.",
      dynamics: "Edit loudness accuracy and dynamic surprise.",
    }[btn.dataset.macroTab];
    setTooltip(btn, text);
  });
  root.querySelectorAll("[data-production-tab]").forEach(btn => {
    const text = btn.dataset.productionTab === "space"
      ? "Reverb for listening context. It does not regenerate motifs."
      : "Percussion markers for listening context. They do not regenerate motifs.";
    setTooltip(btn, text);
  });
  root.querySelectorAll("[data-performance-tab]").forEach(btn => {
    setTooltip(btn, PERFORMANCE_DESC[btn.dataset.performanceTab]);
  });
  root.querySelectorAll("[data-smode]").forEach(btn => {
    setTooltip(btn, SCALE_MODE_DESC[btn.dataset.smode]);
  });
  root.querySelectorAll("[data-vmode]").forEach(btn => {
    setTooltip(btn, VOICE_MODE_DESC[btn.dataset.vmode]);
  });

  root.querySelectorAll(".formant-chip").forEach(chip => {
    setTooltip(chip, `Toggle the ${chip.dataset.formant} formant in the available vowel palette.`);
  });
  root.querySelectorAll(".dim-check").forEach(label => {
    const dim = label.querySelector("[data-dim]")?.dataset.dim;
    setTooltip(label, DIMENSION_DESC[dim]);
    setTooltip(label.querySelector("input"), DIMENSION_DESC[dim]);
  });
  root.querySelectorAll(".feature-check").forEach(label => {
    const input = label.querySelector("[data-param-check]");
    if (!input) return;
    const text = `${label.textContent.trim()}: ${describeParam(input.dataset.paramCheck, label.textContent.trim())}`;
    setTooltip(label, text);
    setTooltip(input, text);
  });
  root.querySelectorAll(".formant-weight").forEach(label => {
    const input = label.querySelector("[data-formant-weight]");
    if (!input) return;
    setTooltip(label, `${input.dataset.formantWeight}: Relative probability for this formant in the circular formant space.`);
  });
  root.querySelectorAll("[data-formant-focus]").forEach(btn => {
    setTooltip(btn, `Centre the formant accuracy/surprise distribution on ${btn.dataset.formantFocus}.`);
  });
  root.querySelectorAll("[data-formant-scope]").forEach(input => {
    setTooltip(input, describeParam(input.dataset.formantScope, input.dataset.formantScope));
  });

  root.querySelectorAll(".note-cell").forEach(cell => {
    setTooltip(cell, "Click to cycle this pitch class through off, in-scale, weighted sub-scale, and root.");
  });
  root.querySelectorAll(".root-cell").forEach(cell => {
    setTooltip(cell, "Click to toggle this in-scale degree as a root/tonal-centre target.");
  });

  root.querySelectorAll(".dist-display, .dist-canvas, .mini-canvas, .js-envelope-canvas, .formant-canvas").forEach(el => {
    const canvasText = el.id ? UI_DESC[el.id] : "Distribution display: hover controls nearby to see what shapes it.";
    setTooltip(el, canvasText);
  });
  root.querySelectorAll(".engine-state .stat").forEach(stat => {
    setTooltip(stat, "Live engine counter updated during playback.");
  });

  root.querySelectorAll("[data-harmonic-param]").forEach(input => {
    const harmonic = Number(input.dataset.harmonicIndex) + 1;
    const kind = input.dataset.harmonicParam;
    const desc = {
      mean: "Mean amplitude for this harmonic's probability distribution.",
      sd: "Standard deviation of this harmonic's amplitude distribution.",
      dyn: "How strongly this harmonic changes with note dynamics.",
      reg: "How strongly this harmonic changes across low and high registers.",
    }[kind];
    setTooltip(input, `H${harmonic} ${kind.toUpperCase()}: ${desc}`);
    setTooltip(input.closest("label"), `H${harmonic} ${kind.toUpperCase()}: ${desc}`);
  });
  root.querySelectorAll(".harmonic-control").forEach((box, i) => {
    setTooltip(box, `H${i + 1}: fixed harmonic frequency with adjustable amplitude mean, SD, dynamics sensitivity, and register sensitivity.`);
  });

  root.querySelectorAll("[data-sound-path]").forEach(path => {
    const kind = path.dataset.soundPath;
    const inactive = path.classList.contains("mode-disabled");
    const activeText = kind === "fourier"
      ? "Fourier sound path: harmonic partials and their amplitude distributions."
      : "Formant sound path: vowel palette, vowel switching, and filter colour drift.";
    setTooltip(path, inactive ? `${activeText} Select ${kind === "fourier" ? "Fourier" : "Formant"} in Sound Source to edit this path.` : activeText);
  });

  root.querySelectorAll(".env-dist-row").forEach(row => {
    const name = row.querySelector(".env-param-label")?.textContent?.trim();
    setTooltip(row, `${name}: adjust the mean and standard deviation used when this envelope parameter is sampled.`);
    row.querySelectorAll("[data-param]").forEach(input => {
      const text = `${name}: ${describeParam(input.dataset.param, name)}`;
      setTooltip(input, text);
      setTooltip(row.querySelector(`#out_${input.dataset.param}`), text);
    });
  });
}

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

// ─── Router ─────────────────────────────────────────────────

function navigate(hash) { location.hash = hash; }

function route() {
  synth.stop();
  cancelAnimationFrame(animFrame);
  const h = location.hash.replace(/^#\/?/, "") || "";
  if (h === "study/consent")       return renderStudyConsent();
  if (h === "study/demographics")  return renderStudyDemographics();
  if (h === "study/headphones")    return renderStudyHeadphones();
  if (h === "study/paradigm")      return renderStudyParadigmChoice();
  if (h === "study/slider")        return renderStudySlider();
  if (h === "study/pairwise")      return renderStudyPairwise();
  if (h === "study/debrief")       return renderStudyDebrief();
  if (h === "home")                return renderLanding();
  if (h === "produce")             return renderProduce();
  if (h === "explore" || h === "") return renderExplore();
  return renderExplore();
}

function mount(html) {
  document.body.classList.remove("explore-mode");
  el.innerHTML = `<div class="view">${html}</div>`;
  return el.querySelector(".view");
}

// ─── Producer mode (Phase G, docs/DAW_MODE_DESIGN.md) ───────
//
// Tonalic dual-panel: instrument browser above, arrangement timeline below.
// v1 (G3): tracks hold single-slot regions; each region is a deterministic
// take (instrument params + seed). Playback of a region reuses the single
// synth voice; simultaneous multi-track playback arrives with G5. Session
// context (tempo/key/scale/space/master dynamics) comes from the shared
// editor state — G4 gives it its own bar with per-track locks.

const ARRANGEMENT_KEY = "phase0.arrangement.v1"; // legacy single-slot (migrated)
const ARRANGEMENTS_KEY = "phase0.arrangements.v1";
const ARRANGEMENT_CURRENT_KEY = "phase0.arrangement.current";

function loadArrangementRegistry() {
  try {
    const reg = JSON.parse(localStorage.getItem(ARRANGEMENTS_KEY) || "{}");
    return reg && typeof reg === "object" ? reg : {};
  } catch { return {}; }
}
function saveArrangementRegistry(reg) {
  localStorage.setItem(ARRANGEMENTS_KEY, JSON.stringify(reg));
}
const BEATS_PER_BAR = 4;
let pxPerBeat = 14;   // lane pixel scale (zoom; persisted in dawLayout)
let snapBeats = 1;    // grid snap: 4 = bar, 1 = beat, 0.5 = half

function totalBeats() { return Math.max(16, arrangement?.lengthBeats || 64); }

// v1 arrangements used 4-beat slots and inline per-track instruments; v2
// regions live in beat-space and source their voice from the palette.
function migrateArrangement(a) {
  if (a.version === 2) return a;
  if (!Array.isArray(a.palette)) a.palette = [];
  for (const t of a.tracks || []) {
    let palId = null;
    if (t.instrumentParams && (t.regions || []).length) {
      palId = crypto.randomUUID();
      a.palette.push({ id: palId, name: t.name, kindLabel: "Migrated", params: { ...t.instrumentParams } });
    }
    for (const r of t.regions || []) {
      if (r.startBeat == null) {
        r.startBeat = (r.slot || 0) * 4;
        r.lengthBeats = (r.lengthSlots || 1) * 4;
        delete r.slot;
        delete r.lengthSlots;
      }
      if (!r.paletteId && palId) r.paletteId = palId;
    }
  }
  a.version = 2;
  return a;
}

let arrangement = null;
let selectedRegion = null; // { trackId, regionId }
let rollOpen = false;      // piano-roll panel visible for a baked region
let rollNoteSel = -1;      // selected note index in the roll
let _rollHits = [];        // hit rects from the last roll draw
let _rollGeom = null;      // geometry from the last roll draw

// Tier 1 session context owned by the arrangement (docs/DAW_MODE_DESIGN.md):
// the musical "room and piece" every track inherits live.
function defaultArrangementContext() {
  const ctx = {};
  for (const k of SESSION_CONTEXT_PARAMS) {
    if (k !== "seed" && k in DEFAULTS) ctx[k] = DEFAULTS[k];
  }
  ctx.customDegrees = [...(SCALE_PRESETS[ctx.scalePreset]?.degrees || SCALE_PRESETS.major.degrees)];
  ctx.reverbWet = 0.16;
  return ctx;
}

function normaliseArrangement(a) {
  if (!a.context) a.context = defaultArrangementContext();
  if (!Array.isArray(a.palette)) a.palette = [];
  if (!a.lengthBeats) a.lengthBeats = 64;
  if (!a.id) a.id = crypto.randomUUID();
  return migrateArrangement(a);
}

function freshArrangement(name = "Untitled arrangement") {
  return { id: crypto.randomUUID(), name, version: 2, lengthBeats: 64, tracks: [], palette: [], context: defaultArrangementContext() };
}

function loadArrangement() {
  let reg = loadArrangementRegistry();
  // One-time migration of the legacy single-slot arrangement
  const legacy = localStorage.getItem(ARRANGEMENT_KEY);
  if (legacy && !Object.keys(reg).length) {
    try {
      const a = JSON.parse(legacy);
      if (a && Array.isArray(a.tracks)) {
        normaliseArrangement(a);
        reg[a.id] = a;
        saveArrangementRegistry(reg);
        localStorage.setItem(ARRANGEMENT_CURRENT_KEY, a.id);
      }
    } catch { /* ignore */ }
    localStorage.removeItem(ARRANGEMENT_KEY);
  }
  const curId = localStorage.getItem(ARRANGEMENT_CURRENT_KEY);
  let a = curId ? reg[curId] : null;
  if (!a) a = Object.values(reg)[0] || null;
  if (!a) {
    a = freshArrangement();
    reg[a.id] = a;
    saveArrangementRegistry(reg);
  }
  localStorage.setItem(ARRANGEMENT_CURRENT_KEY, a.id);
  return normaliseArrangement(a);
}
// Producer v3 undo model (spec §8): a labelled snapshot stack, >=100
// deep, with a proper redo stack. The deterministic JSON document makes
// snapshots tiny; every mutation goes through saveArrangement(label).
const UNDO_MAX = 120;
let _undoStack = [];
let _redoStack = [];
let _lastSavedAt = 0; // autosave indicator

function saveArrangement(label = "edit") {
  if (!arrangement) return;
  if (!arrangement.id) arrangement.id = crypto.randomUUID();
  const reg = loadArrangementRegistry();
  // The registry still holds the pre-mutation state — that IS the undo point.
  if (reg[arrangement.id]) {
    const prev = JSON.stringify(reg[arrangement.id]);
    if (prev !== JSON.stringify(arrangement)) {
      _undoStack.push({ label, json: prev });
      if (_undoStack.length > UNDO_MAX) _undoStack.shift();
      _redoStack = [];
    }
  }
  reg[arrangement.id] = arrangement;
  saveArrangementRegistry(reg);
  localStorage.setItem(ARRANGEMENT_CURRENT_KEY, arrangement.id);
  _lastSavedAt = Date.now();
  const tick = document.getElementById("arrSaved");
  if (tick) {
    tick.textContent = "saved";
    clearTimeout(saveArrangement._t);
    saveArrangement._t = setTimeout(() => { tick.textContent = ""; }, 1200);
  }
}

function undoArrangement() {
  const entry = _undoStack.pop();
  if (!entry) return;
  _redoStack.push({ label: entry.label, json: JSON.stringify(arrangement) });
  arrangement = normaliseArrangement(JSON.parse(entry.json));
  const reg = loadArrangementRegistry();
  reg[arrangement.id] = arrangement;
  saveArrangementRegistry(reg);
  selectedRegion = null;
  stopArrangement();
  renderProduce();
}

function redoArrangement() {
  const entry = _redoStack.pop();
  if (!entry) return;
  _undoStack.push({ label: entry.label, json: JSON.stringify(arrangement) });
  arrangement = normaliseArrangement(JSON.parse(entry.json));
  const reg = loadArrangementRegistry();
  reg[arrangement.id] = arrangement;
  saveArrangementRegistry(reg);
  selectedRegion = null;
  stopArrangement();
  renderProduce();
}

function switchArrangement(id) {
  stopArrangement();
  synth.stop();
  localStorage.setItem(ARRANGEMENT_CURRENT_KEY, id);
  arrangement = null;
  selectedRegion = null;
  _undoStack = [];
  _redoStack = [];
  renderProduce();
}

// Everything the browser can offer: factory presets, user presets, and
// saved instruments — each convertible into a full voice for the palette.
function browserItems() {
  const items = [];
  for (const f of FACTORY_PRESETS) {
    items.push({
      id: `factory:${f.id}`, name: f.name,
      cat: f.section === "full" ? "starter" : "section",
      kindLabel: f.section === "full" ? "Starter" : (PRESET_SECTIONS[f.section]?.label || f.section),
      description: f.description || "",
      section: f.section, params: f.parameters,
    });
  }
  for (const u of loadPresets()) {
    items.push({
      id: `user:${u.id}`, name: u.name || "Untitled",
      cat: (!u.section || u.section === "full") ? "mine" : "section",
      kindLabel: (!u.section || u.section === "full") ? "My preset" : (PRESET_SECTIONS[u.section]?.label || u.section),
      description: "", section: u.section || "full", params: u.parameters,
    });
  }
  for (const inst of loadInstruments()) {
    items.push({
      id: `inst:${inst.id}`, name: inst.name,
      cat: "instrument", kindLabel: "Instrument",
      description: "", section: "instrument", params: inst.parameters,
    });
  }
  return items;
}

// A browser item as a complete voice (session-context params excluded).
// Tone v2 migration (T6) runs here so saved instruments made on the old
// tone model translate wherever they are used.
function voiceParamsFor(item) {
  if (item.section === "instrument") return migrateToneParams({ ...item.params });
  return extractInstrumentParams(migrateToneParams({ ...DEFAULTS, ...item.params }));
}

// Palette edit round-trip (producer v2 P6): the palette item under edit in
// the studio, persisted so it survives the #explore navigation.
const PALETTE_EDIT_KEY = "phase0.paletteEdit.v1";
function paletteEditState() {
  try { return JSON.parse(localStorage.getItem(PALETTE_EDIT_KEY) || "null"); } catch { return null; }
}
function setPaletteEditState(state) {
  if (state) localStorage.setItem(PALETTE_EDIT_KEY, JSON.stringify(state));
  else localStorage.removeItem(PALETTE_EDIT_KEY);
}

function addToPalette(item) {
  if (!Array.isArray(arrangement.palette)) arrangement.palette = [];
  arrangement.palette.push({
    id: crypto.randomUUID(),
    name: item.name,
    kindLabel: item.kindLabel,
    sourceId: item.id,
    params: voiceParamsFor(item),
    // Voices deliberately drop tempo (session context) — remember the design
    // tempo here so "adopt tempo" can offer it to the session (Q1).
    originTempo: (item.params && item.params.tempo) ?? null,
    // Scale is session context too — voices drop it, but the badge row
    // must still tell the truth about what the patch was designed in.
    originScale: item.params ? {
      scaleMode: item.params.scaleMode, scalePreset: item.params.scalePreset,
      customDegrees: item.params.customDegrees, edoDivisions: item.params.edoDivisions,
    } : null,
  });
  saveArrangement();
}

function produceSources() {
  const instruments = loadInstruments().map(i => ({
    id: String(i.id), name: i.name, kind: "instrument", parameters: i.parameters,
  }));
  const factory = FACTORY_PRESETS.filter(p => p.section === "full").map(p => ({
    id: String(p.id), name: p.name, kind: "factory",
    parameters: extractInstrumentParams({ ...DEFAULTS, ...p.parameters }),
  }));
  const palette = (arrangement?.palette || []).map(pl => ({
    id: `pal:${pl.id}`, name: pl.name, kind: "palette", parameters: pl.params,
  }));
  return [...palette, ...instruments, ...factory];
}

function regionVoiceParams(track, region) {
  const pal = (arrangement?.palette || []).find(pl => pl.id === region.paletteId);
  return pal ? pal.params : (track.instrumentParams || {});
}

function regionPlayParams(track, region, atBeat = null) {
  // Tier 1 session context (owned by the arrangement, inherited live) +
  // Tier 2 instrument (from the palette) + Tier 3 take
  const context = arrangement?.context || defaultArrangementContext();
  const params = { ...DEFAULTS, ...context, ...regionVoiceParams(track, region), seed: region.seed };
  // Q5 global scale: an opted-in track regenerates under the marker in
  // force at the region's position. Applied AFTER the voice so the marker
  // wins; baked regions replay stored degrees and are untouched by
  // construction (pitch derives from degree + division, not this list).
  if (track?.useGlobalScale) {
    const marker = globalScaleAt(arrangement?.globalScale, region.startBeat ?? 0);
    if (marker) {
      params.customDegrees = [...marker.degrees];
      params.subScaleNotes = [...(marker.subScaleNotes || [])];
      params.rootNotes = [...(marker.rootNotes || [0])];
    }
  }
  // Q6 global space: designer threads position each track over time —
  // resolved at atBeat (the walker passes the playing beat so positions
  // evolve mid-region). Override replaces the patch's space; offset adds
  // the anchors as deltas (angle adds, distance shifts around 2.5 m).
  // The designer's head (listener) properties apply to every track.
  const sp = arrangement?.space;
  if (sp?.enabled && track) {
    const pos = trackSpaceAt(sp.tracks?.[track.id], atBeat ?? region.startBeat ?? 0);
    if (pos) {
      if (sp.mode === "offset") {
        params.spaceAzimuth = Math.max(-180, Math.min(180, (params.spaceAzimuth ?? 0) + pos.angle));
        params.spaceDistance = Math.max(0.3, Math.min(30, (params.spaceDistance ?? 2.5) + (pos.dist - 2.5)));
      } else {
        params.spaceAzimuth = pos.angle;
        params.spaceDistance = pos.dist;
      }
    }
    if (sp.head) {
      if (Number.isFinite(sp.head.earDistance)) params.earDistance = sp.head.earDistance;
      if (Number.isFinite(sp.head.headDensity)) params.headDensity = sp.head.headDensity;
      if (sp.head.reverbType) params.reverbType = sp.head.reverbType;
    }
  }
  return params;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function sessionBarControlsHTML() {
  const ctx = arrangement.context;
  const root = ctx.keyRoot ?? (Array.isArray(ctx.rootNotes) && ctx.rootNotes.length ? ctx.rootNotes[0] : 0);
  return `
    <label class="daw-ctx">Tempo
      <input type="range" data-ctx="tempo" min="50" max="180" step="1" value="${ctx.tempo}"/>
      <output id="ctxTempoOut">${ctx.tempo}</output>
    </label>
    <label class="daw-ctx">Key
      <select data-ctx="root">
        ${NOTE_NAMES.map((n, i) => `<option value="${i}"${i === root ? " selected" : ""}>${n}</option>`).join("")}
      </select>
      <select data-ctx="scalePreset">
        ${Object.entries(SCALE_PRESETS).map(([k, sc]) =>
          `<option value="${k}"${k === ctx.scalePreset ? " selected" : ""}>${sc.label}</option>`).join("")}
      </select>
    </label>
    <label class="daw-ctx">Space
      <select data-ctx="reverbType">
        ${Object.entries(REVERB_PROFILES).map(([k, r]) =>
          `<option value="${k}"${k === ctx.reverbType ? " selected" : ""}>${r.label}</option>`).join("")}
      </select>
      <input type="range" data-ctx="reverbWet" min="0" max="0.95" step="0.01" value="${ctx.reverbWet}" title="Reverb amount"/>
    </label>`;
}

function renderBrowserCards(v) {
  const container = v.querySelector("#browserCards");
  if (!container) return;
  const q = browserSearch.trim().toLowerCase();
  const items = browserItems().filter(item =>
    (browserFilter === "all" || item.cat === browserFilter) &&
    (splitsFilter === "all" || splitsBucketOf(item.params) === splitsFilter) &&
    (!q || item.name.toLowerCase().includes(q) || (item.description || "").toLowerCase().includes(q)));
  container.innerHTML = items.length ? items.map(item => `
    <div class="browser-card" data-browser-item="${esc(item.id)}">
      <div class="bc-head">
        <span class="bc-name">${esc(item.name)}</span>
        <span class="bc-kind">${esc(item.kindLabel)}</span>
      </div>
      ${item.description ? `<div class="bc-desc">${esc(item.description)}</div>` : ""}
      <div class="bc-actions">
        <button class="pal-btn" data-browser-preview="${esc(item.id)}" title="Hear it in the session context">${browserPreviewId === item.id ? "■" : "▶"}</button>
        <button class="pal-btn" data-browser-add="${esc(item.id)}" title="Add to your palette">＋ Palette</button>
      </div>
    </div>`).join("") : '<div class="empty-state">No presets match.</div>';

  const findItem = (id) => browserItems().find(i => i.id === id);
  container.querySelectorAll("[data-browser-add]").forEach(btn => {
    btn.onclick = () => {
      const item = findItem(btn.dataset.browserAdd);
      if (!item) return;
      addToPalette(item);
      renderProduce();
    };
  });
  container.querySelectorAll("[data-browser-preview]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.browserPreview;
      if (browserPreviewId === id) {
        synth.stop();
        browserPreviewId = null;
      } else {
        const item = findItem(id);
        if (!item) return;
        stopArrangement();
        synth.play({ ...DEFAULTS, ...arrangement.context, ...voiceParamsFor(item), seed: 20260703 });
        browserPreviewId = id;
      }
      renderBrowserCards(v);
    };
  });
  container.querySelectorAll("[data-browser-item]").forEach(card => {
    card.setAttribute("draggable", "false");
    card.onmousedown = (e) => {
      if (e.target.closest(".pal-btn")) return; // buttons stay clickable
      const item = browserItems().find(i => i.id === card.dataset.browserItem);
      if (item) beginPointerDrag("browser", item.id, item.name, e);
    };
  });
}

function wireBrowserPalette(v) {
  renderBrowserCards(v);
  const search = v.querySelector("#browserSearch");
  if (search) search.oninput = () => {
    browserSearch = search.value;
    renderBrowserCards(v);
  };
  v.querySelectorAll("[data-browser-filter]").forEach(chip => {
    chip.onclick = () => {
      browserFilter = chip.dataset.browserFilter;
      v.querySelectorAll("[data-browser-filter]").forEach(c =>
        c.classList.toggle("active", c === chip));
      renderBrowserCards(v);
    };
  });
  const splitsSel = v.querySelector("[data-splits-filter]");
  if (splitsSel) splitsSel.onchange = () => {
    splitsFilter = splitsSel.value;
    renderBrowserCards(v);
  };
  // Q1: which half of a patch presets load into
  v.querySelectorAll("[data-pal-half]").forEach(btn => {
    btn.onclick = () => {
      const [palId, half] = btn.dataset.palHalf.split(":");
      _palHalfSel[palId] = half;
      renderProduce();
    };
  });
  // Q1: adopt a patch's design tempo as the session tempo
  v.querySelectorAll("[data-adopt-tempo]").forEach(btn => {
    btn.onclick = () => {
      const pl = (arrangement.palette || []).find(x => x.id === btn.dataset.adoptTempo);
      if (!pl || !pl.originTempo) return;
      arrangement.context.tempo = pl.originTempo;
      saveArrangement("adopt tempo");
      if (synth.isPlaying && selectedRegion) {
        const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
        const region = track?.regions.find(r => r.id === selectedRegion.regionId);
        if (track && region) synth.updateGenerationParams(regionPlayParams(track, region));
      }
      renderProduce();
    };
  });
  v.querySelectorAll("[data-palette-edit]").forEach(btn => {
    btn.onclick = () => {
      const pl = (arrangement.palette || []).find(x => x.id === btn.dataset.paletteEdit);
      if (!pl) return;
      stopArrangement();
      synth.stop();
      setPaletteEditState({ paletteId: pl.id, name: pl.name });
      // Load the voice as it sounds in the arrangement: session context + voice
      exploreParams = migrateToneParams({ ...DEFAULTS, ...arrangement.context, ...pl.params });
      navigate("explore");
    };
  });

  v.querySelectorAll("[data-palette-remove]").forEach(btn => {
    btn.onclick = () => {
      arrangement.palette = (arrangement.palette || []).filter(pl => pl.id !== btn.dataset.paletteRemove);
      saveArrangement();
      renderProduce();
    };
  });
  // (browser→palette drops are handled by the pointer-drag machinery)
  // Palette items drag onto lanes via pointer tracking
  v.querySelectorAll("[data-palette-item]").forEach(el => {
    el.setAttribute("draggable", "false");
    el.onmousedown = (e) => {
      if (e.target.closest(".pal-btn")) return;
      const pl = (arrangement.palette || []).find(x => x.id === el.dataset.paletteItem);
      if (pl) beginPointerDrag("palette", pl.id, pl.name, e);
    };
  });
}

function wireDawLayout(v) {
  const left = v.querySelector(".daw-left");
  const editor = v.querySelector(".daw-editor");

  const leftCollapse = v.querySelector("#leftCollapse");
  if (leftCollapse) leftCollapse.onclick = () => {
    dawLayout.leftOpen = !dawLayout.leftOpen;
    saveDawLayout();
    renderProduce();
  };

  const dragSplit = (el, apply, commit) => {
    if (!el) return;
    el.onmousedown = (e) => {
      e.preventDefault();
      const move = (ev) => apply(ev);
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        commit();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
  };

  dragSplit(v.querySelector("#dawVSplit"), (ev) => {
    if (!dawLayout.leftOpen || !left) return;
    const main = v.querySelector(".daw-main").getBoundingClientRect();
    dawLayout.leftW = Math.max(160, Math.min(430, ev.clientX - main.left));
    left.style.width = `${dawLayout.leftW}px`;
  }, saveDawLayout);

  dragSplit(v.querySelector("#dawHSplit"), (ev) => {
    if (!editor) return;
    const daw = v.querySelector(".daw").getBoundingClientRect();
    dawLayout.editorH = Math.max(140, Math.min(420, daw.bottom - ev.clientY));
    editor.style.height = `${dawLayout.editorH}px`;
  }, saveDawLayout);
}

function sessionBarHTML() {
  const ctx = arrangement.context;
  const root = Array.isArray(ctx.rootNotes) && ctx.rootNotes.length ? ctx.rootNotes[0] : 0;
  return `
    <div class="card session-bar" title="Session context: every track inherits these live — change the key and everything follows.">
      <div class="section-label">Session</div>
      <div class="session-controls">
        <label>Tempo
          <input type="range" data-ctx="tempo" min="50" max="180" step="1" value="${ctx.tempo}"/>
          <output id="ctxTempoOut">${ctx.tempo}</output>
        </label>
        <label>Key
          <select data-ctx="root">
            ${NOTE_NAMES.map((n, i) => `<option value="${i}"${i === root ? " selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <label>Scale
          <select data-ctx="scalePreset">
            ${Object.entries(SCALE_PRESETS).map(([k, s]) =>
              `<option value="${k}"${k === ctx.scalePreset ? " selected" : ""}>${s.label}</option>`).join("")}
          </select>
        </label>
        <label>Dynamics
          <input type="range" data-ctx="dynamicsLevel" min="0.05" max="1" step="0.01" value="${ctx.dynamicsLevel}"/>
        </label>
        <label>Space
          <select data-ctx="reverbType">
            ${Object.entries(REVERB_PROFILES).map(([k, r]) =>
              `<option value="${k}"${k === ctx.reverbType ? " selected" : ""}>${r.label}</option>`).join("")}
          </select>
          <input type="range" data-ctx="reverbWet" min="0" max="0.95" step="0.01" value="${ctx.reverbWet}" title="Reverb amount"/>
        </label>
      </div>
    </div>`;
}

function wireSessionBar(v) {
  const applyLive = () => {
    if (!synth.isPlaying || !selectedRegion) return;
    const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
    const region = track?.regions.find(r => r.id === selectedRegion.regionId);
    if (track && region) {
      synth.updateGenerationParams(regionPlayParams(track, region));
      synth.updateReverb(regionPlayParams(track, region));
    }
  };
  v.querySelectorAll("[data-ctx]").forEach(input => {
    const handler = () => {
      const key = input.dataset.ctx;
      const ctx = arrangement.context;
      if (key === "root") {
        // Key = transpose the whole lattice: tonic moves to the chosen
        // pitch class and the root anchors at degree 0. Generative regions
        // follow immediately; baked regions follow via degree-space
        // recompute (v2.1 U1).
        ctx.keyRoot = Number(input.value);
        ctx.tonicHz = 261.63 * Math.pow(2, ctx.keyRoot / 12);
        ctx.rootNotes = [0];
      } else if (key === "scalePreset") {
        ctx.scalePreset = input.value;
        ctx.scaleMode = "12tone";
        ctx.customDegrees = [...(SCALE_PRESETS[input.value]?.degrees || SCALE_PRESETS.major.degrees)];
      } else if (input.type === "range") {
        ctx[key] = Number(input.value);
        if (key === "tempo") {
          const out = v.querySelector("#ctxTempoOut");
          if (out) out.textContent = input.value;
        }
      } else {
        ctx[key] = input.value;
      }
      saveArrangement();
      applyLive();
    };
    if (input.tagName === "SELECT") input.onchange = handler;
    else input.oninput = handler;
  });
}

function newSeed() { return Math.floor(Math.random() * 999999) + 1; }

// ── Multi-voice arrangement playback (G5) ────────────────────
// One SynthEngine voice per track, all sharing the main AudioContext and a
// common producer bus. The transport walks the slot grid at session tempo
// (4 beats per slot), starting each track's region at its slot with its
// seed and silencing tracks with empty cells.
const producerVoices = new Map(); // trackId -> SynthEngine voice
let producerBus = null;
let arrPlay = null; // { slot, timer, lastSlot }
let playheadBeat = 0;  // where Play starts; set by clicking the ruler
let _gsOpen = false;      // Q5: global scale strip expanded
let _gsSelMarker = -1;    // Q5: which marker's mini-roll is open

function producerVoice(track) {
  synth.init();
  if (synth.ctx.state === "suspended") synth.ctx.resume();
  if (!producerBus) {
    producerBus = synth.ctx.createGain();
    producerBus.gain.value = 1;
    producerBus.connect(synth.ctx.destination);
  }
  let voice = producerVoices.get(track.id);
  if (!voice) {
    voice = new SynthEngine();
    voice.init(synth.ctx, producerBus);
    producerVoices.set(track.id, voice);
  }
  voice.setMasterVolume(track.gain ?? 1);
  voice.setPan(track.pan ?? 0);
  return voice;
}

function updatePlayhead(beat) {
  const line = document.getElementById("tlPlayhead");
  if (line) {
    if (beat == null || beat < 0) line.classList.add("hidden");
    else {
      line.classList.remove("hidden");
      line.style.left = `${beat * pxPerBeat}px`;
    }
  }
  // bar.beat position readout (spec T2)
  const pos = document.getElementById("arrPos");
  if (pos && beat != null && beat >= 0) {
    pos.textContent = `${Math.floor(beat / BEATS_PER_BAR) + 1}.${(Math.floor(beat) % BEATS_PER_BAR) + 1}`;
  }
  // page-follow during playback (spec T11)
  if (arrPlay && line) {
    const scroller = document.querySelector(".timeline-grid");
    if (scroller) {
      const px = beat * pxPerBeat;
      if (px > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = px - 40;
      else if (px < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, px - 40);
    }
  }
}

function pauseArrangement() {
  if (!arrPlay) return;
  playheadBeat = arrPlay.beat; // resume point
  stopArrangement();
}

function stopArrangement() {
  if (arrPlay) { clearTimeout(arrPlay.timer); arrPlay = null; }
  producerVoices.forEach(v => v.stop());
  updatePlayhead(playheadBeat);
}

function playArrangement(fromBeat = 0) {
  stopArrangement();
  synth.stop(); // single-region loop, if any
  const ctx = arrangement.context;
  const beatMs = (60 / Math.max(30, ctx.tempo || 104)) * 1000;
  const ends = arrangement.tracks.flatMap(t => t.regions.map(r => r.startBeat + regionLen(r)));
  if (!ends.length) return;
  const lastBeat = Math.max(...ends) - 1;
  arrPlay = { beat: Math.max(0, Math.floor(fromBeat)), lastBeat, timer: null };
  const step = () => {
    if (!arrPlay) return;
    let b = arrPlay.beat;
    // loop/cycle range (spec T4)
    const lr = arrangement.loopOn && arrangement.loopRange ? arrangement.loopRange : null;
    if (lr && b >= lr.b) {
      producerVoices.forEach(vv => vv.stop());
      b = Math.max(0, Math.floor(lr.a));
      arrPlay.beat = b;
      arrPlay.startAt = b;
    }
    if (!lr && b > arrPlay.lastBeat) {
      stopArrangement();
      const btn = document.querySelector("#arrPlayBtn");
      if (btn) btn.textContent = "▶";
      return;
    }
    for (const track of arrangement.tracks) {
      const region = regionAtBeat(track, b);
      const voice = producerVoice(track);
      if (!trackAudible(track)) { voice.stop(); continue; }
      if (region && !region.muted && (b === Math.ceil(region.startBeat) || b === arrPlay.startAt)) {
        voice.setMasterVolume((track.gain ?? 1) * (region.gain ?? 1));
        if (region.type === "baked" && Array.isArray(region.notes)) {
          voice.playNotes(regionPlayParams(track, region), region.notes,
            regionLen(region), region.loopSourceBeats || regionLen(region));
        } else if (region.takeOffsetBeats) {
          // split tail: schedule the later part of the same take upfront
          voice.stop();
          voice.renderSpan(regionPlayParams(track, region),
            synth.ctx.currentTime + 0.03,
            (60 / Math.max(30, ctx.tempo || 104)) * regionLen(region),
            region.takeOffsetBeats);
        } else {
          voice.play(regionPlayParams(track, region));
        }
      } else if (!region || region.muted) {
        voice.stop();
      }
      // mid-region beats: leave the voice playing through its span
    }
    // Q6: global-space threads evolve DURING playback — retarget each
    // sounding voice's spatial chain at the current beat (cheap: the IR
    // is key-cached, everything else is smoothed AudioParams).
    if (arrangement.space?.enabled) {
      for (const track of arrangement.tracks) {
        const region = regionAtBeat(track, b);
        if (!region || region.muted || !trackAudible(track)) continue;
        const voice = producerVoices.get(track.id);
        if (voice && voice.playing) voice.updateReverb(regionPlayParams(track, region, b));
      }
    }
    updatePlayhead(b);
    arrPlay.beat = b + 1;
    arrPlay.timer = setTimeout(step, beatMs);
  };
  arrPlay.startAt = arrPlay.beat; // regions already sounding at the start beat begin here
  step();
}
// ── Arrangement export / import / mixdown (G6) ───────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportArrangement() {
  const payload = {
    format: "phase0-arrangement-1.0",
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    ...arrangement,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    `${(arrangement.name || "arrangement").replace(/[^\w-]+/g, "_")}.json`
  );
}

function importArrangement(file) {
  file.text().then(text => {
    const data = JSON.parse(text);
    if (!Array.isArray(data.tracks)) throw new Error("not an arrangement file");
    arrangement = normaliseArrangement({
      ...data,
      id: crypto.randomUUID(),
      name: data.name || "Imported arrangement",
    });
    selectedRegion = null;
    saveArrangement();
    renderProduce();
  }).catch(err => alert(`Could not import: ${err.message}`));
}

// 16-bit PCM WAV encoder for an AudioBuffer (stereo interleaved).
function audioBufferToWavBlob(buffer) {
  const numCh = Math.min(2, buffer.numberOfChannels);
  const sr = buffer.sampleRate;
  const frames = buffer.length;
  const dataBytes = frames * numCh * 2;
  const ab = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true); view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true); view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true); writeStr(36, "data"); view.setUint32(40, dataBytes, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

async function mixdownArrangement(statusEl, btn) {
  const ctxP = arrangement.context;
  const beatSec = 60 / Math.max(30, ctxP.tempo || 104);
  const ends = arrangement.tracks.flatMap(t => t.regions.map(r => r.startBeat + regionLen(r)));
  if (!ends.length) { alert("Nothing to mix down — place some regions first."); return; }
  stopArrangement();
  synth.stop();
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = "Rendering…";
  const lastEnd = Math.max(...ends);
  const sr = 44100;
  const totalSec = lastEnd * beatSec + 3; // reverb/release tail
  const off = new OfflineAudioContext(2, Math.ceil(totalSec * sr), sr);
  for (const track of arrangement.tracks) {
    if (!trackAudible(track)) continue;
    for (const region of track.regions) {
      if (region.muted) continue;
      // A fresh voice per region: deterministic take, exactly as live playback
      const voice = new SynthEngine();
      voice.init(off, off.destination);
      voice.setMasterVolume((track.gain ?? 1) * (region.gain ?? 1));
      voice.setPan(track.pan ?? 0);
      if (region.type === "baked" && Array.isArray(region.notes)) {
        voice.renderNotesSpan(regionPlayParams(track, region), region.notes,
          region.startBeat * beatSec + 0.05, regionLen(region), region.loopSourceBeats || regionLen(region));
      } else {
        voice.renderSpan(regionPlayParams(track, region), region.startBeat * beatSec + 0.05,
          beatSec * regionLen(region), region.takeOffsetBeats || 0);
      }
      // Scheduling is synchronous per region; yield so large arrangements
      // never freeze the UI while the graph is being built.
      await new Promise(r => setTimeout(r, 0));
    }
  }
  // The offline render runs well below realtime for heavy arrangements
  // (measured ~0.5x), so surface real progress: suspend checkpoints every
  // couple of rendered seconds update the status, then resume. Checkpoints
  // don't alter the audio — the render is deterministic either way.
  const renderTotal = off.length / off.sampleRate;
  for (let cp = 2; cp < renderTotal; cp += 2) {
    off.suspend(cp).then(() => {
      if (statusEl) statusEl.textContent = `Rendering… ${Math.min(99, Math.round((cp / renderTotal) * 100))}%`;
      off.resume();
    }).catch(() => {});
  }
  try {
    const rendered = await off.startRendering();
    downloadBlob(audioBufferToWavBlob(rendered), `${(arrangement.name || "arrangement").replace(/[^\w-]+/g, "_")}.wav`);
    if (statusEl) {
      statusEl.textContent = "Saved ✓";
      setTimeout(() => { if (statusEl.textContent === "Saved ✓") statusEl.textContent = ""; }, 3000);
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "";
    alert(`Mixdown failed: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function regionLen(region) { return Math.max(1, region.lengthBeats || 1); }

function regionAtBeat(track, b) {
  return track.regions.find(r => b >= r.startBeat && b < r.startBeat + regionLen(r));
}

function spanFree(track, startBeat, lengthBeats, ignoreId = null) {
  if (startBeat < 0 || startBeat + lengthBeats > totalBeats()) return false;
  return !track.regions.some(r => r.id !== ignoreId &&
    startBeat < r.startBeat + regionLen(r) && r.startBeat < startBeat + lengthBeats);
}

// Longest length this region may take before the next region or the end
function maxRegionLength(track, region) {
  let limit = totalBeats() - region.startBeat;
  for (const other of track.regions) {
    if (other.id === region.id) continue;
    if (other.startBeat > region.startBeat) {
      limit = Math.min(limit, other.startBeat - region.startBeat);
    }
  }
  return limit;
}

// ── Q5: global scale strip ──────────────────────────────────
// Collapsible strip above the ruler carrying scale MARKERS. Opted-in
// tracks (G in the track head) regenerate their takes under the marker in
// force at each region's position; baked notes never move.
function ensureGlobalScale() {
  if (!arrangement.globalScale) arrangement.globalScale = { enabled: false, markers: [] };
  return arrangement.globalScale;
}

function globalScaleStripHTML(laneW) {
  const gs = arrangement.globalScale || { enabled: false, markers: [] };
  const flags = (gs.markers || []).map((m, i) =>
    `<div class="gs-flag${i === _gsSelMarker ? " sel" : ""}" data-gs-marker="${i}" style="left:${m.atBeat * pxPerBeat}px" title="Scale marker at beat ${m.atBeat} (${(m.degrees || []).length} degrees) — click to edit">⚑<span class="gs-flag-label">${(m.degrees || []).length}</span></div>`).join("");
  const sel = gs.markers?.[_gsSelMarker];
  const div = arrangement.context.scaleMode === "edo" ? (arrangement.context.edoDivisions || 12) : 12;
  const editorRow = (_gsOpen && sel) ? `
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="gs-editor">
          <span class="gs-editor-title">marker @ beat ${sel.atBeat}</span>
          <div class="gs-roll" role="group" title="Click a note division to cycle its role: off → in scale → sub-scale → root (same operators as the patch scale card)">
            ${Array.from({ length: div }, (_, d) => {
              const st = sel.rootNotes?.includes(d) ? "root" : sel.subScaleNotes?.includes(d) ? "sub" : sel.degrees?.includes(d) ? "scale" : "off";
              return `<button class="gs-cell gs-${st}" data-gs-cell="${d}" title="division ${d}: ${st}">${d}</button>`;
            }).join("")}
          </div>
          <button class="pal-btn" id="gsDeleteMarker" title="Remove this marker">×</button>
        </div>
      </div>` : "";
  return `
      <div class="tl2-row tl2-gs-row${_gsOpen ? " open" : ""}">
        <div class="tl2-head tl2-corner gs-head">
          <button class="gs-chevron" id="gsToggle" title="Global scale — markers along the timeline; tracks opt in with the G button in their header">${_gsOpen ? "▾" : "▸"} Global scale</button>
          ${_gsOpen ? `<input type="checkbox" id="gsEnabled"${gs.enabled ? " checked" : ""} title="Apply the global scale to opted-in tracks"/>` : ""}
        </div>
        <div class="gs-strip${gs.enabled ? "" : " off"}" id="gsStrip" style="width:${laneW}px">
          ${_gsOpen ? flags : ""}
          ${_gsOpen ? `<button class="gs-add" id="gsAddMarker" style="left:${playheadBeat * pxPerBeat}px" title="Add a scale marker at the playhead (beat ${Math.round(playheadBeat * 4) / 4}), seeded from the session scale">＋</button>` : ""}
        </div>
      </div>${editorRow}`;
}

// ── Q6: global space designer ───────────────────────────────
// A cylinder of instrument threads along the timeline + a cross-section
// at the playhead. Threads come from per-track anchors interpolated by
// trackSpaceAt (synth.js); the head panel owns the listener (ear span,
// head density, room type — re-homed here from Q2).
let _spOpen = false;
let _spSelTrack = null;
let _spRock = { roll: 0, dragging: false, drag: null };
let _spRaf = null;

function ensureGlobalSpace() {
  if (!arrangement.space) {
    arrangement.space = {
      enabled: false,
      mode: "override",
      head: { earDistance: 0.175, headDensity: 0.5, reverbType: arrangement.context.reverbType || "room" },
      tracks: {},
    };
  }
  if (!arrangement.space.tracks) arrangement.space.tracks = {};
  return arrangement.space;
}

const _SP_HUES = [36, 152, 205, 280, 0, 60, 320, 100];
function _spHue(i) { return _SP_HUES[i % _SP_HUES.length]; }

// Where a track sits at a beat: designer anchors (override), anchors as
// deltas on the patch space (offset), or the patch space alone.
function _spTrackPos(track, beat) {
  const sp = arrangement.space || {};
  const res = trackSpaceAt(sp.tracks?.[track.id], beat);
  const vp = (arrangement.palette || []).find(pl => pl.id === track.regions?.[0]?.paletteId)?.params
    || track.instrumentParams || {};
  const base = { angle: vp.spaceAzimuth ?? 0, dist: vp.spaceDistance ?? 2.5 };
  if (!res) return base;
  if (sp.mode === "offset") {
    return {
      angle: Math.max(-180, Math.min(180, base.angle + res.angle)),
      dist: Math.max(0.3, Math.min(30, base.dist + res.dist - 2.5)),
    };
  }
  return res;
}

function spSmartArrange() {
  const sp = ensureGlobalSpace();
  const n = Math.max(1, arrangement.tracks.length);
  arrangement.tracks.forEach((t, i) => {
    const angle = n === 1 ? 0 : Math.round(-135 + i * (270 / (n - 1)));
    const dist = 2 + (i % 3) * 0.8;
    sp.tracks[t.id] = [
      { beat: 0, angle, dist, smooth: 0.5 },
      { beat: totalBeats(), angle, dist, smooth: 0.5 },
    ];
  });
  sp.mode = "override";
}

function globalSpaceStripHTML(laneW) {
  const sp = arrangement.space || { enabled: false, mode: "override", head: {}, tracks: {} };
  const head = sp.head || {};
  const selAnchors = _spSelTrack ? (sp.tracks?.[_spSelTrack] || []) : [];
  const anchorAtPh = selAnchors.find(a => Math.abs(a.beat - playheadBeat) < 0.26);
  const panel = _spOpen ? `
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="sp-panel">
          <canvas id="spSection" width="150" height="150" title="Cross-section at the playhead — you at the centre, one dot per track. Click a dot to select its track; drag it to move (snaps back without an anchor); double-click to anchor it at the playhead."></canvas>
          <canvas id="spCylinder" width="620" height="150" title="The arrangement's space over time — one thread per instrument, nearer = thicker. The view rocks slowly; drag up/down to roll it (springs back). Click an anchor dot to jump the playhead there."></canvas>
          <div class="sp-head-panel">
            <div class="section-label">Listener</div>
            <label class="sp-ctl">Mode
              <select id="spMode" title="Override replaces each patch's own space; Offset adds the threads on top of it">
                <option value="override"${sp.mode !== "offset" ? " selected" : ""}>Override patch space</option>
                <option value="offset"${sp.mode === "offset" ? " selected" : ""}>Offset patch space</option>
              </select>
            </label>
            <label class="sp-ctl">Room
              <select id="spReverbType" title="The shared room every track sits in when the global space is on">${reverbTypeOptions(head.reverbType || arrangement.context.reverbType || "room")}</select>
            </label>
            <label class="sp-ctl">Ear span <input type="range" id="spEar" min="0.12" max="0.25" step="0.005" value="${head.earDistance ?? 0.175}" title="${esc(PARAM_DESC.earDistance)}"/></label>
            <label class="sp-ctl">Head density <input type="range" id="spDensity" min="0" max="1" step="0.01" value="${head.headDensity ?? 0.5}" title="${esc(PARAM_DESC.headDensity)}"/></label>
            ${anchorAtPh ? `<label class="sp-ctl">Anchor smoothness <input type="range" id="spSmooth" min="0" max="1" step="0.05" value="${anchorAtPh.smooth ?? 0.5}" title="How gently the selected track's thread curves through the anchor at the playhead (0 = straight lines)"/></label>` : ""}
          </div>
        </div>
      </div>` : "";
  return `
      <div class="tl2-row tl2-sp-row">
        <div class="tl2-head tl2-corner gs-head">
          <button class="gs-chevron" id="spToggle" title="Global space — position every instrument around the listener along the timeline">${_spOpen ? "▾" : "▸"} Global space</button>
          ${_spOpen ? `<input type="checkbox" id="spEnabled"${sp.enabled ? " checked" : ""} title="Apply the global space to playback (asks how to initialise on first use)"/>` : ""}
        </div>
        <div class="gs-strip${sp.enabled ? "" : " off"}" style="width:${laneW}px"></div>
      </div>${panel}`;
}

function drawSpSection() {
  const cv = document.getElementById("spSection");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2, rMax = Math.min(w, h) / 2 - 8;
  const sp = arrangement.space || {};
  // rings + behind shading (same language as the patch space pad)
  ctx.fillStyle = "rgba(60,72,88,0.16)";
  ctx.beginPath(); ctx.arc(cx, cy, rMax, 0, Math.PI); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(90,110,130,0.25)";
  for (const dm of [1, 3, 10, 30]) {
    ctx.beginPath(); ctx.arc(cx, cy, _spaceDistToR(dm, rMax), 0, 2 * Math.PI); ctx.stroke();
  }
  // the head, radius ∝ ear distance
  const headR = 3 + ((sp.head?.earDistance ?? 0.175) - 0.12) / (0.25 - 0.12) * 5;
  ctx.fillStyle = "rgba(200,215,230,0.85)";
  ctx.beginPath(); ctx.arc(cx, cy, headR, 0, 2 * Math.PI); ctx.fill();
  // track dots at the playhead
  arrangement.tracks.forEach((t, i) => {
    const drag = _spRock.drag;
    const pos = (drag && drag.trackId === t.id) ? drag.pos : _spTrackPos(t, playheadBeat);
    const rad = (pos.angle - 90) * Math.PI / 180;
    const r = _spaceDistToR(Math.max(0.3, Math.min(30, pos.dist)), rMax);
    const x = cx + Math.cos(rad) * r, y = cy + Math.sin(rad) * r;
    const seld = t.id === _spSelTrack;
    ctx.fillStyle = `hsla(${_spHue(i)}, 70%, ${seld ? 68 : 55}%, ${seld ? 1 : 0.8})`;
    if (seld) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
    ctx.beginPath(); ctx.arc(x, y, seld ? 5.5 : 4, 0, 2 * Math.PI); ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function drawSpCylinder(rockRad) {
  const cv = document.getElementById("spCylinder");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const cy = h / 2, R = h / 2 - 10;
  const beats = Math.max(1, totalBeats());
  const xFor = (beat) => (beat / beats) * w;
  const roll = _spRock.roll;
  // playhead line
  ctx.strokeStyle = "rgba(245,166,35,0.4)";
  ctx.beginPath(); ctx.moveTo(xFor(playheadBeat), 0); ctx.lineTo(xFor(playheadBeat), h); ctx.stroke();
  arrangement.tracks.forEach((t, i) => {
    const seld = t.id === _spSelTrack;
    ctx.beginPath();
    let backness = 0;
    for (let px = 0; px <= w; px += 6) {
      const pos = _spTrackPos(t, (px / w) * beats);
      const a = pos.angle * Math.PI / 180 + rockRad + roll;
      const y = cy + Math.sin(a) * R * 0.85;
      backness = Math.cos(a); // >0 = far side of the cylinder
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    const midPos = _spTrackPos(t, playheadBeat);
    ctx.lineWidth = Math.max(0.8, Math.min(5, 6 / Math.max(0.8, midPos.dist)));
    ctx.strokeStyle = `hsla(${_spHue(i)}, 70%, ${seld ? 65 : 50}%, ${seld ? 0.95 : (backness > 0 ? 0.3 : 0.6)})`;
    ctx.stroke();
    ctx.lineWidth = 1;
    // anchor dots on the selected thread
    if (seld) {
      const anchors = arrangement.space?.tracks?.[t.id] || [];
      for (const a of anchors) {
        const aa = a.angle * Math.PI / 180 + rockRad + roll;
        const x = xFor(a.beat), y = cy + Math.sin(aa) * R * 0.85;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 2 * Math.PI); ctx.fill();
      }
    }
  });
}

function _spAnimate() {
  if (!_spOpen || !document.getElementById("spCylinder")) { _spRaf = null; return; }
  const rock = Math.sin(performance.now() / 2400) * (10 * Math.PI / 180); // slow ±10° rocking
  if (!_spRock.dragging) _spRock.roll *= 0.88; // spring back
  drawSpCylinder(rock);
  drawSpSection();
  _spRaf = requestAnimationFrame(_spAnimate);
}

function wireGlobalSpace(v) {
  const spToggle = v.querySelector("#spToggle");
  if (spToggle) spToggle.onclick = () => { _spOpen = !_spOpen; renderProduce(); };
  const spEnabled = v.querySelector("#spEnabled");
  if (spEnabled) spEnabled.onchange = () => {
    const sp = ensureGlobalSpace();
    if (spEnabled.checked && !sp.initialised) {
      // Activation flow (owner spec): first use asks how to start.
      if (confirm("Smartly arrange the instruments in space?\n\nOK — spread the tracks around you (override patch positions)\nCancel — keep each patch's own position (threads become offsets)")) {
        spSmartArrange();
      } else {
        sp.mode = "offset";
      }
      sp.initialised = true;
    }
    sp.enabled = spEnabled.checked;
    saveArrangement("global space on/off");
    renderProduce();
  };
  const liveApply = () => {
    if (!arrPlay) return;
    const b = arrPlay.beat;
    for (const track of arrangement.tracks) {
      const region = regionAtBeat(track, b);
      const voice = producerVoices.get(track.id);
      if (region && voice && voice.playing) voice.updateReverb(regionPlayParams(track, region, b));
    }
  };
  const bindHead = (id, key, isNum = true) => {
    const el = v.querySelector(id);
    if (!el) return;
    el.onchange = () => {
      const sp = ensureGlobalSpace();
      sp.head[key] = isNum ? Number(el.value) : el.value;
      saveArrangement("global space head");
      liveApply();
    };
  };
  bindHead("#spEar", "earDistance");
  bindHead("#spDensity", "headDensity");
  bindHead("#spReverbType", "reverbType", false);
  const spMode = v.querySelector("#spMode");
  if (spMode) spMode.onchange = () => {
    ensureGlobalSpace().mode = spMode.value;
    saveArrangement("global space mode");
    liveApply();
  };
  const spSmooth = v.querySelector("#spSmooth");
  if (spSmooth) spSmooth.onchange = () => {
    const anchors = ensureGlobalSpace().tracks[_spSelTrack] || [];
    const a = anchors.find(a => Math.abs(a.beat - playheadBeat) < 0.26);
    if (a) { a.smooth = Number(spSmooth.value); saveArrangement("anchor smoothness"); }
  };

  // Cross-section: select / drag / double-click-anchor
  const section = v.querySelector("#spSection");
  if (section) {
    const xy = (e) => {
      const rect = section.getBoundingClientRect();
      const w = section._cssW || section.width, h = section._cssH || section.height;
      return {
        x: (e.clientX - rect.left) * (w / Math.max(1, rect.width)),
        y: (e.clientY - rect.top) * (h / Math.max(1, rect.height)),
        cx: w / 2, cy: h / 2, rMax: Math.min(w, h) / 2 - 8,
      };
    };
    const posFromXY = (g) => {
      const dx = g.x - g.cx, dy = g.y - g.cy;
      return {
        angle: Math.max(-180, Math.min(180, Math.atan2(dx, -dy) * 180 / Math.PI)),
        dist: _spaceRToDist(Math.hypot(dx, dy), g.rMax),
      };
    };
    const trackAtXY = (g) => {
      let best = null;
      arrangement.tracks.forEach((t) => {
        const pos = _spTrackPos(t, playheadBeat);
        const rad = (pos.angle - 90) * Math.PI / 180;
        const r = _spaceDistToR(Math.max(0.3, Math.min(30, pos.dist)), g.rMax);
        const d = Math.hypot(g.cx + Math.cos(rad) * r - g.x, g.cy + Math.sin(rad) * r - g.y);
        if (d < 10 && (!best || d < best.d)) best = { t, d };
      });
      return best?.t || null;
    };
    section.onmousedown = (e) => {
      e.preventDefault();
      const g = xy(e);
      const t = trackAtXY(g);
      if (!t) return;
      _spSelTrack = t.id;
      _spRock.drag = { trackId: t.id, pos: _spTrackPos(t, playheadBeat) };
      const move = (ev) => { _spRock.drag.pos = posFromXY(xy(ev)); };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const sp = ensureGlobalSpace();
        const anchors = sp.tracks[t.id];
        const a = anchors?.find(a => Math.abs(a.beat - playheadBeat) < 0.26);
        if (a) {
          // an anchor lives at the playhead: commit the drag to it
          a.angle = _spRock.drag.pos.angle;
          a.dist = _spRock.drag.pos.dist;
          saveArrangement("move space anchor");
        } // otherwise the dot snaps back (drag preview only, owner spec)
        _spRock.drag = null;
        renderProduce();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    section.ondblclick = (e) => {
      const g = xy(e);
      const t = trackAtXY(g) || arrangement.tracks.find(t => t.id === _spSelTrack);
      if (!t) return;
      _spSelTrack = t.id;
      const sp = ensureGlobalSpace();
      const pos = posFromXY(g);
      const anchors = (sp.tracks[t.id] = sp.tracks[t.id] || []);
      if (!anchors.length) {
        // the very first anchor also creates start + end anchors
        const cur = _spTrackPos(t, playheadBeat);
        anchors.push({ beat: 0, ...cur, smooth: 0.5 }, { beat: totalBeats(), ...cur, smooth: 0.5 });
      }
      const atBeat = Math.round(playheadBeat * 4) / 4;
      const existing = anchors.find(a => Math.abs(a.beat - atBeat) < 0.26);
      if (existing) { existing.angle = pos.angle; existing.dist = pos.dist; }
      else anchors.push({ beat: atBeat, angle: pos.angle, dist: pos.dist, smooth: 0.5 });
      anchors.sort((a, b) => a.beat - b.beat);
      saveArrangement("space anchor");
      renderProduce();
    };
  }

  // Cylinder: roll drag (springs back) + anchor click → playhead jump
  const cyl = v.querySelector("#spCylinder");
  if (cyl) {
    cyl.onmousedown = (e) => {
      e.preventDefault();
      const rect = cyl.getBoundingClientRect();
      const w = cyl._cssW || cyl.width;
      const x = (e.clientX - rect.left) * (w / Math.max(1, rect.width));
      // anchor hit? jump the playhead there
      const anchors = arrangement.space?.tracks?.[_spSelTrack] || [];
      const beats = Math.max(1, totalBeats());
      const hit = anchors.find(a => Math.abs((a.beat / beats) * w - x) < 6);
      if (hit) {
        playheadBeat = hit.beat;
        updatePlayhead(playheadBeat);
        renderProduce();
        return;
      }
      _spRock.dragging = true;
      const y0 = e.clientY, roll0 = _spRock.roll;
      const move = (ev) => { _spRock.roll = roll0 + (ev.clientY - y0) * 0.01; };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        _spRock.dragging = false; // spring-back happens in the rAF loop
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  }

  if (_spOpen && !_spRaf) _spRaf = requestAnimationFrame(_spAnimate);
}

function produceTimelineHTML() {
  const laneW = totalBeats() * pxPerBeat;
  // Ruler: bar numbers every BEATS_PER_BAR
  const barCount = totalBeats() / BEATS_PER_BAR;
  const rulerMarks = Array.from({ length: barCount }, (_, i) =>
    `<span class="tl2-bar" style="left:${i * BEATS_PER_BAR * pxPerBeat}px">${i + 1}</span>`).join("");
  const trackRows = arrangement.tracks.map(t => {
    const regions = t.regions.map(r => {
      const sel = selectedRegion?.regionId === r.id ? " selected" : "";
      const baked = r.type === "baked" ? " baked" : "";
      const pal = (arrangement.palette || []).find(pl => pl.id === r.paletteId);
      const label = pal ? pal.name : t.name;
      let badgeHover = "";
      if (pal) {
        const b = patchBadges(pal.params);
        badgeHover = ` [${b.scaleLabel} · ${b.splits} splits · grid ${b.grid} · ${b.connection}${b.surpriseOn ? ` · ✦ ${b.dims.join("·")}` : ""}]`;
      }
      let loopTicks = "";
      if (r.type === "baked" && r.loopSourceBeats && regionLen(r) > r.loopSourceBeats) {
        for (let lb = r.loopSourceBeats; lb < regionLen(r); lb += r.loopSourceBeats) {
          loopTicks += `<span class="tl2-looptick" style="left:${lb * pxPerBeat}px"></span>`;
        }
      }
      const gainDb = 20 * Math.log10(Math.max(0.02, r.gain ?? 1));
      return `<div class="tl2-region${sel}${baked}${r.muted ? " muted" : ""}" data-region="${r.id}" data-track="${t.id}"
        style="left:${r.startBeat * pxPerBeat}px;width:${regionLen(r) * pxPerBeat - 2}px"
        title="${esc(label)}${esc(badgeHover)} — drag to move, right edge extends, ⌘T splits at the playhead. R rerolls a generative take (⇧R steps back). Double-click a baked region to edit notes.">
        ${loopTicks}<span class="tl2-region-label">${r.type === "baked" ? "◆ " : ""}${esc(label)}</span>
        ${r.type !== "baked" ? `<span class="tl2-seed" title="This take's seed — its identity. Duplicate keeps it; ⇧⌘D duplicates with a new one.">s·${r.seed}</span>` : ""}
        ${sel && pal ? `<span class="tl2-badges">${patchBadgesHTML({ ...pal.params, ...(pal.originScale || {}) }, pal.originTempo, true)}</span>` : ""}
        ${sel ? `<span class="tl2-gain-tag" data-gain-tag="${r.id}" title="Region level — drag vertically">${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)}dB</span>` : ""}
        <span class="tl2-resize" data-resize="${r.id}" title="Drag to extend"></span>
      </div>`;
    }).join("");
    const gain = t.gain ?? 1;
    return `<div class="tl2-row">
      <div class="tl2-head${trackAudible(t) ? "" : " inaudible"}">
        <span class="tl2-name" title="${esc(t.name)}">${esc(t.name)}</span>
        <button class="tl2-ms${t.muted ? " on" : ""}" data-track-mute="${t.id}" title="Mute">M</button>
        <button class="tl2-ms tl2-solo${t.solo ? " on" : ""}" data-track-solo="${t.id}" title="Solo">S</button>
        <button class="tl2-ms tl2-gsbtn${t.useGlobalScale ? " on" : ""}" data-track-gscale="${t.id}" title="Follow the global scale strip: this track's takes regenerate under the marker in force (baked notes stay put)">G</button>
        <input type="range" class="tl-gain" data-track-gain="${t.id}" min="0" max="1.5" step="0.01" value="${gain}" title="Track level"/>
        <input type="range" class="tl-pan" data-track-pan="${t.id}" min="-1" max="1" step="0.05" value="${t.pan ?? 0}" title="Pan (L/R)"/>
        <button class="tl-remove" data-remove-track="${t.id}" title="Remove this track">×</button>
      </div>
      <div class="tl2-lane" data-lane="${t.id}" style="width:${laneW}px">${regions}</div>
    </div>`;
  }).join("");
  return `
    <div class="tl2">
      ${globalScaleStripHTML(laneW)}
      ${globalSpaceStripHTML(laneW)}
      <div class="tl2-row tl2-ruler-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="tl2-ruler" id="tlRuler" style="width:${laneW}px">${rulerMarks}
          <div class="tl2-loop-range${arrangement.loopRange ? (arrangement.loopOn ? "" : " dim") : " hidden"}" id="tlLoopRange" style="left:${(arrangement.loopRange?.a || 0) * pxPerBeat}px;width:${((arrangement.loopRange?.b || 0) - (arrangement.loopRange?.a || 0)) * pxPerBeat}px"></div>
          <div class="tl2-playhead hidden" id="tlPlayhead"></div>
        </div>
      </div>
      ${trackRows || ""}
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="tl2-newtrack" data-lane="__new__" style="width:${laneW}px">${arrangement.tracks.length ? "Drop a palette instrument here to add a track" : "Drag an instrument from your palette here to create the first track"}</div>
      </div>
    </div>`;
}
function selectedBakedRegion() {
  if (!selectedRegion) return null;
  for (const t of arrangement.tracks) {
    const r = t.regions.find(r => r.id === selectedRegion.regionId);
    if (r) return r.type === "baked" && Array.isArray(r.notes) ? r : null;
  }
  return null;
}

let rollDynLane = false; // Logic-style velocity pins lane toggle

function rollPanelHTML() {
  const region = selectedBakedRegion();
  if (!rollOpen || !region) return "";
  const ctxP = arrangement.context;
  const beatDiv = region.notes[0]?.beatDivisions || ctxP.beatDivisions || 1;
  const scaleLabel = ctxP.scaleMode === "edo"
    ? `${ctxP.edoDivisions}-EDO`
    : (SCALE_PRESETS[ctxP.scalePreset]?.label || ctxP.scalePreset || "major");
  const keyName = NOTE_NAMES[((ctxP.keyRoot ?? 0) % 12 + 12) % 12] || "C";
  return `
    <div class="roll-panel${rollDynLane ? " dyn" : ""}">
      <div class="roll-head">
        <span class="roll-meta">grid <b>${beatDiv}/beat</b> · scale <b>${esc(scaleLabel)}</b> · key <b>${esc(keyName)}</b></span>
        <label class="roll-dyncheck"><input type="checkbox" id="rollDynToggle"${rollDynLane ? " checked" : ""}/> dynamics</label>
      </div>
      <canvas id="rollCanvas" width="960" height="${rollDynLane ? 300 : 240}"></canvas>
      <div class="roll-readout" id="rollReadout">Click a note to inspect it. Bodies show the realised pitch AND timing; ghost outlines mark the intended scale note and grid slot. ⇧-drag = micro-timing off the grid.</div>
    </div>`;
}

// Piano roll for a baked region: rows = scale degrees, columns = beat
// divisions. Dual pitch representation per the bake design — the note BODY
// is positioned at its precise pitch (degree + cents as a fractional row
// offset) while a ghost outline marks the intended degree whenever the
// intonation missed.
function drawRoll(region) {
  const cv = document.getElementById("rollCanvas");
  if (!cv) return;
  const { ctx, w: W, h: H } = crisp2d(cv);
  ctx.clearRect(0, 0, W, H);
  const notes = region.notes;
  const padL = 40, padR = 8, padT = 8, padB = 18;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // The pitch system for THIS region under the session context: every
  // division is a row; the scale decides which rows are open.
  const track = arrangement.tracks.find(t => t.id === selectedRegion?.trackId);
  const scale = track ? new GenerationEngine(regionPlayParams(track, region)).scale : null;
  const allSet = new Set(scale ? scale.all : []);
  const subIsSubset = scale && scale.sub.length && scale.sub.length < scale.all.length;
  const subSet = new Set(subIsSubset ? scale.sub : []);
  const rootPcs = new Set((arrangement.context.rootNotes || [0]).map(r => scale ? scale.norm(r) : 0));
  const div = scale ? scale.div : 12;

  const degs = notes.map(n => n.degree);
  const minDeg = Math.min(...degs) - 2, maxDeg = Math.max(...degs) + 2;
  const laneH = rollDynLane ? 52 : 0; // Logic-style velocity pins lane
  const pitchH = plotH - laneH;
  const rows = maxDeg - minDeg + 1;
  const rowH = pitchH / rows;
  const beatDivRoll = notes[0]?.beatDivisions || arrangement.context.beatDivisions || 1;
  const totalDivs = Math.max(regionLen(region) * beatDivRoll,
    1, ...notes.map(n => (n.offsetDivs || 0) + (n.durationDivs || 1)));
  const xFor = (divs) => padL + (divs / totalDivs) * plotW;
  const yForPitch = (deg, cents) => padT + (maxDeg - (deg + (cents || 0) / 100)) * rowH;
  const rowInfo = {};
  for (let d = minDeg; d <= maxDeg; d++) {
    const pc = scale ? scale.norm(d) : ((d % 12) + 12) % 12;
    rowInfo[d] = {
      inScale: allSet.size === 0 || allSet.has(pc),
      isSub: subSet.has(pc),
      isRoot: rootPcs.has(pc),
      pc,
    };
  }
  _rollGeom = { padL, padT, plotW, plotH, rowH, minDeg, maxDeg, totalDivs, W, H, rowInfo, div, laneH, laneTop: padT + pitchH };

  // Display well + scale-aware rows: out-of-scale divisions render dark
  // and are LOCKED from drags; sub-scale rows gold; root rows violet.
  ctx.fillStyle = "#101216";
  ctx.fillRect(padL - 2, padT - 2, plotW + 4, plotH + 4);
  ctx.font = "8px 'SF Mono', monospace";
  for (let d = minDeg; d <= maxDeg; d++) {
    const yTop = padT + (maxDeg - d) * rowH;
    const info = rowInfo[d];
    if (!info.inScale) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(padL, yTop, plotW, rowH);
    } else if (info.isRoot) {
      ctx.fillStyle = "rgba(139,124,246,0.10)";
      ctx.fillRect(padL, yTop, plotW, rowH);
    } else if (info.isSub) {
      ctx.fillStyle = "rgba(245,166,35,0.06)";
      ctx.fillRect(padL, yTop, plotW, rowH);
    }
    const y = yTop + rowH / 2;
    ctx.strokeStyle = "rgba(154,160,171,0.08)";
    ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    // pitch labels on in-scale rows (names in 12-EDO, numbers otherwise)
    if (info.inScale && rowH >= 7) {
      ctx.fillStyle = info.isRoot ? "rgba(139,124,246,0.8)"
        : info.isSub ? "rgba(245,166,35,0.65)" : "rgba(154,160,171,0.45)";
      ctx.textAlign = "right";
      const label = div === 12
        ? `${NOTE_NAMES[info.pc]}${Math.floor(d / 12) + 4}`
        : String(d);
      ctx.fillText(label, padL - 4, y + 2.5);
    }
  }
  const beatDiv = region.notes[0]?.beatDivisions || 1;
  for (let b = 0; b <= totalDivs; b += beatDiv) {
    const x = xFor(b);
    ctx.strokeStyle = b % (beatDiv * 4) === 0 ? "rgba(154,160,171,0.16)" : "rgba(154,160,171,0.06)";
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
  }

  _rollHits = [];
  const pxPerDiv = plotW / totalDivs;
  notes.forEach((n, i) => {
    if (n.isRest || !n.velocity) return;
    // GRID slot (intended timing) vs REALISED timing: micro-devs and
    // articulation gaps make the body deviate from its outline — same
    // dual representation as pitch (owner spec).
    const gx = xFor(n.offsetDivs || 0);
    const gw = Math.max(3, (n.durationDivs || 1) * pxPerDiv - 1.5);
    const x = gx + (n.onsetDevDivs || 0) * pxPerDiv;
    const soundDivs = Math.max(0.1, ((n.durationDivs || 1) + (n.durationDevDivs || 0)) * (1 - Math.max(0, Math.min(0.9, n.gapFraction || 0))));
    const w = Math.max(3, soundDivs * pxPerDiv - 1.5);
    const bodyH = Math.max(4, rowH * 0.7);
    const cents = n.intonationCents || 0;
    const timingDeviates = Math.abs(n.onsetDevDivs || 0) > 0.01
      || Math.abs(n.durationDevDivs || 0) > 0.01 || (n.gapFraction || 0) > 0.05;
    // Ghost: intended pitch row and/or intended grid slot
    if (Math.abs(cents) > 1 || timingDeviates) {
      const gy = yForPitch(n.degree, 0) + rowH / 2 - bodyH / 2;
      ctx.strokeStyle = "rgba(154,160,171,0.35)";
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.strokeRect(gx, gy, gw, bodyH);
      ctx.setLineDash([]);
    }
    // Body at the precise pitch AND precise timing; shade = dynamics
    const y = yForPitch(n.degree, cents) + rowH / 2 - bodyH / 2;
    const sel = i === rollNoteSel;
    const col = n.isSurprise ? "56,189,248" : "245,166,35";
    const shade = 0.3 + 0.65 * Math.max(0, Math.min(1, n.velocity || 0));
    ctx.fillStyle = `rgba(${col},${sel ? Math.max(0.95, shade) : shade})`;
    ctx.fillRect(x, y, w, bodyH);
    if (sel) {
      ctx.strokeStyle = "rgba(232,234,238,0.9)";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, bodyH + 1);
    }
    if (n.edited) {
      ctx.fillStyle = "rgba(232,234,238,0.9)";
      ctx.beginPath();
      ctx.arc(x + 3, y + 3, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    _rollHits.push({ i, x, y, w, h: bodyH });
  });
  // Dynamics lane: velocity pins under each onset (Logic-style)
  if (rollDynLane) {
    const laneTop = padT + pitchH;
    ctx.strokeStyle = "rgba(154,160,171,0.25)";
    ctx.beginPath(); ctx.moveTo(padL, laneTop + 2); ctx.lineTo(padL + plotW, laneTop + 2); ctx.stroke();
    notes.forEach((n, i) => {
      if (n.isRest || !n.velocity) return;
      const px = xFor((n.offsetDivs || 0)) + (n.onsetDevDivs || 0) * pxPerDiv;
      const ph = Math.max(2, (laneH - 8) * Math.max(0, Math.min(1, n.velocity)));
      const sel = i === rollNoteSel;
      ctx.strokeStyle = sel ? "#ffe3b0" : `rgba(245,166,35,${0.4 + 0.5 * n.velocity})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, laneTop + laneH - 4);
      ctx.lineTo(px, laneTop + laneH - 4 - ph);
      ctx.stroke();
      ctx.fillStyle = sel ? "#ffe3b0" : "#f5a623";
      ctx.beginPath(); ctx.arc(px, laneTop + laneH - 4 - ph, 2.6, 0, 2 * Math.PI); ctx.fill();
    });
    ctx.lineWidth = 1;
  }
  window._rollHitsQA = _rollHits; // QA hook: exact note rects for tests
}

function rollReadoutText(n) {
  const cents = Math.round(n.intonationCents || 0);
  const od = n.onsetDevDivs || 0, dd = n.durationDevDivs || 0;
  const timing = (Math.abs(od) > 0.01 || Math.abs(dd) > 0.01)
    ? `  ·  micro ${od >= 0 ? "+" : ""}${od.toFixed(2)}/${dd >= 0 ? "+" : ""}${dd.toFixed(2)} div`
    : "";
  return `deg ${n.degree}  ·  ${cents >= 0 ? "+" : ""}${cents}¢${Math.abs(cents) > 1 ? "" : " (on pitch)"}  ·  vel ${(n.velocity || 0).toFixed(2)}  ·  ${n.durationDivs || 1} div${(n.durationDivs || 1) > 1 ? "s" : ""}${timing}${n.isSurprise ? "  ·  surprise" : ""}`;
}

// Q3: drill-down into the per-note performance draw persisted at bake
// time — the things duration/velocity don't show. Read-only v1.
function rollPerfHTML(n) {
  const perf = n.performance;
  if (!perf) {
    return `<div class="roll-perf roll-perf-missing">This region was baked before performance capture — re-bake it to see glide, envelope and vibrato detail per note.</div>`;
  }
  const ms = (s) => s == null ? "—" : `${Math.round(s * 1000)} ms`;
  const rows = [];
  const e = perf.envelope || {};
  rows.push(["envelope", `A ${ms(e.a)} · D ${ms(e.d)} · S ${e.s == null ? "—" : Math.round(e.s * 100) + "%"} · R ${ms(e.r)}`]);
  rows.push(["vibrato", perf.vibrato
    ? `${Math.round(perf.vibrato.prob * 100)}% chance · ±${(+perf.vibrato.depth).toFixed(0)}¢ @ ${(+perf.vibrato.rate).toFixed(1)} Hz`
    : "—"]);
  rows.push(["glide", perf.glideFrom
    ? `from ${(+perf.glideFrom).toFixed(1)} Hz over ${perf.glideMs} ms`
    : "—"]);
  rows.push(["onset noise", perf.attackNoiseLevel == null ? "—" : (+perf.attackNoiseLevel).toFixed(2)]);
  rows.push(["tuning", `${perf.tuningCents >= 0 ? "+" : ""}${Math.round(perf.tuningCents)}¢`]);
  if (perf.formantPos) rows.push(["vowel", `~“${nearestVowel(perf.formantPos)}”`]);
  return `<div class="roll-perf">${rows.map(([k, val]) =>
    `<span class="roll-perf-row"><span class="roll-perf-key">${k}</span><span class="roll-perf-val">${esc(String(val))}</span></span>`).join("")}</div>`;
}

function wireRoll(v) {
  const cv = v.querySelector("#rollCanvas");
  const region = selectedBakedRegion();
  if (!cv || !region) return;
  drawRoll(region);
  const dynToggle = v.querySelector("#rollDynToggle");
  if (dynToggle) dynToggle.onchange = () => {
    rollDynLane = dynToggle.checked;
    renderProduce();
  };
  const readout = v.querySelector("#rollReadout");
  const setReadout = (text) => { if (readout) readout.textContent = text; };
  // Q3: a selected note shows its one-line summary plus the performance
  // drill-down persisted at bake time.
  const showNote = (note) => {
    if (!readout) return;
    readout.innerHTML = `<div class="roll-line">${esc(rollReadoutText(note))}</div>${rollPerfHTML(note)}`;
  };
  const canvasXY = (e) => {
    const rect = cv.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * ((cv._cssW || cv.width) / rect.width),
      y: (e.clientY - rect.top) * ((cv._cssH || cv.height) / rect.height),
    };
  };

  // Frequency for an edited pitch, from the region's own scale context
  const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
  const scale = new GenerationEngine(regionPlayParams(track, region)).scale;
  const freqFor = (degree, cents) => scale.degreeToHz(degree) * Math.pow(2, (cents || 0) / 1200);

  let drag = null; // { i, note, startX, startY, orig, fine, moved }

  const EDGE = 5; // px hit zone for duration trims
  const edgeFor = (hit, x) => {
    if (x >= hit.x + hit.w - Math.max(EDGE, Math.min(8, hit.w * 0.25))) return "trimR";
    if (x <= hit.x + Math.max(EDGE, Math.min(8, hit.w * 0.25)) && hit.w > EDGE * 2.5) return "trimL";
    return "move";
  };
  cv.onmousedown = (e) => {
    const { x, y } = canvasXY(e);
    // dynamics lane: grab the nearest velocity pin
    if (rollDynLane && _rollGeom && y > _rollGeom.laneTop) {
      let best = null;
      _rollHits.forEach(h => {
        const d = Math.abs(h.x - x);
        if (d < 8 && (!best || d < best.d)) best = { i: h.i, d };
      });
      if (best) {
        rollNoteSel = best.i;
        const note = region.notes[best.i];
        drag = { i: best.i, note, mode: "velocity", startY: y, orig: { velocity: note.velocity || 0 }, moved: false };
        drawRoll(region);
        showNote(note);
        e.preventDefault();
        return;
      }
    }
    const hit = _rollHits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y - 2 && y <= h.y + h.h + 2);
    if (!hit) {
      rollNoteSel = -1;
      drawRoll(region);
      setReadout("Drag a note to move it (cents ride along; out-of-scale rows are locked); drag its EDGES to trim duration; ⇧ snaps clean; ⌥ fine-tunes cents.");
      return;
    }
    rollNoteSel = hit.i;
    const note = region.notes[hit.i];
    drag = {
      i: hit.i, note,
      mode: e.altKey ? "move" : edgeFor(hit, x),
      micro: e.shiftKey, // ⇧ = fractional deviations riding on the grid value
      startX: x, startY: y,
      orig: {
        degree: note.degree, cents: note.intonationCents || 0,
        offsetDivs: note.offsetDivs || 0, durationDivs: note.durationDivs || 1,
        onsetDevDivs: note.onsetDevDivs || 0, durationDevDivs: note.durationDevDivs || 0,
        velocity: note.velocity || 0,
      },
      fine: e.altKey,
      moved: false,
    };
    drawRoll(region);
    showNote(note);
    e.preventDefault();
  };

  cv.onmousemove = (e) => {
    if (!drag || !_rollGeom) {
      // hover cursors: resize at note edges, grab over bodies
      if (_rollGeom && !drag) {
        const { x, y } = canvasXY(e);
        const hit = _rollHits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y - 2 && y <= h.y + h.h + 2);
        cv.style.cursor = hit ? (edgeFor(hit, x) === "move" ? "grab" : "ew-resize") : "default";
      }
      return;
    }
    const { x, y } = canvasXY(e);
    const g = _rollGeom;
    const dx = x - drag.startX;
    const dy = y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const note = drag.note;
    if (drag.mode === "velocity") {
      note.velocity = Math.max(0.05, Math.min(1, drag.orig.velocity + (drag.startY - y) / Math.max(20, g.laneH - 8)));
      drawRoll(region);
      showNote(note);
      return;
    }
    const pxPerDivW = g.plotW / g.totalDivs;
    if (drag.micro) {
      // ⇧: micro-deviations — fractional divs off the grid, underlying
      // grid values untouched (the timing twin of cents).
      if (drag.mode === "trimR" || drag.mode === "trimL") {
        note.durationDevDivs = Math.max(-0.9, Math.min(0.9, drag.orig.durationDevDivs + dx / pxPerDivW * (drag.mode === "trimL" ? -1 : 1)));
      } else {
        note.onsetDevDivs = Math.max(-0.9, Math.min(0.9, drag.orig.onsetDevDivs + dx / pxPerDivW));
      }
      drawRoll(region);
      showNote(note);
      return;
    }
    const divDelta = Math.round(dx / (g.plotW / g.totalDivs));
    // monophonic neighbours bound the trims
    const prevEnd = Math.max(0, ...region.notes
      .filter((nn, ix) => ix !== drag.i && (nn.offsetDivs || 0) < drag.orig.offsetDivs)
      .map(nn => (nn.offsetDivs || 0) + (nn.durationDivs || 1)));
    const nextStart = Math.min(g.totalDivs, ...region.notes
      .filter((nn, ix) => ix !== drag.i && (nn.offsetDivs || 0) > drag.orig.offsetDivs)
      .map(nn => nn.offsetDivs || 0));
    if (drag.mode === "trimR") {
      note.durationDivs = Math.max(1, Math.min(nextStart - drag.orig.offsetDivs,
        drag.orig.durationDivs + divDelta));
    } else if (drag.mode === "trimL") {
      const newOff = Math.max(prevEnd, Math.min(drag.orig.offsetDivs + drag.orig.durationDivs - 1,
        drag.orig.offsetDivs + divDelta));
      note.offsetDivs = newOff;
      note.durationDivs = drag.orig.durationDivs - (newOff - drag.orig.offsetDivs);
    } else if (drag.fine) {
      // Fine-tune: vertical motion edits cents only (one row = 100 cents)
      note.intonationCents = Math.round(drag.orig.cents - (dy / g.rowH) * 100);
    } else {
      // Snap-drag whole rows — out-of-scale divisions are LOCKED: the
      // note lands on the nearest in-scale row instead (owner spec).
      const stepDelta = Math.round(-dy / g.rowH);
      let target = drag.orig.degree + stepDelta;
      const info = g.rowInfo && g.rowInfo[target];
      if (info && !info.inScale) {
        for (let off = 1; off <= g.div; off++) {
          if (g.rowInfo[target + off]?.inScale) { target = target + off; break; }
          if (g.rowInfo[target - off]?.inScale) { target = target - off; break; }
        }
      }
      note.degree = target;
      note.intonationCents = drag.orig.cents; // cents ride along; ⌥ edits them
      const maxOffset = Math.max(0, g.totalDivs - (note.durationDivs || 1));
      note.offsetDivs = Math.max(0, Math.min(maxOffset, drag.orig.offsetDivs + divDelta));
    }
    drawRoll(region);
    showNote(note);
  };

  const finishDrag = (commit) => {
    if (!drag) return;
    const note = drag.note;
    if (!commit || !drag.moved) {
      // Plain click or cancel: restore values, keep the selection
      note.degree = drag.orig.degree;
      note.intonationCents = drag.orig.cents;
      note.offsetDivs = drag.orig.offsetDivs;
      note.durationDivs = drag.orig.durationDivs;
      if ("onsetDevDivs" in drag.orig) note.onsetDevDivs = drag.orig.onsetDevDivs;
      if ("durationDevDivs" in drag.orig) note.durationDevDivs = drag.orig.durationDevDivs;
      if (drag.mode === "velocity") note.velocity = drag.orig.velocity;
    } else {
      const changed = note.degree !== drag.orig.degree
        || (note.intonationCents || 0) !== drag.orig.cents
        || (note.offsetDivs || 0) !== drag.orig.offsetDivs
        || (note.durationDivs || 1) !== drag.orig.durationDivs
        || (note.onsetDevDivs || 0) !== (drag.orig.onsetDevDivs || 0)
        || (note.durationDevDivs || 0) !== (drag.orig.durationDevDivs || 0)
        || (drag.mode === "velocity" && note.velocity !== drag.orig.velocity);
      if (changed) {
        note.frequency = freqFor(note.degree, note.intonationCents);
        note.edited = true;
        saveArrangement();
      }
    }
    drag = null;
    drawRoll(region);
    showNote(note);
  };

  cv.onmouseup = () => finishDrag(true);
  cv.onmouseleave = () => finishDrag(false);
}

function produceToolbarHTML() {
  if (!selectedRegion) {
    return '<span class="toolbar-hint">Select a region to play it as a loop, reroll its take, or delete it.</span>';
  }
  const sel = (() => {
    for (const t of arrangement.tracks) {
      const r = t.regions.find(r => r.id === selectedRegion.regionId);
      if (r) return r;
    }
    return null;
  })();
  const baked = sel?.type === "baked";
  return `
    <button class="btn btn-primary btn-sm" id="regionPlay">${synth.isPlaying ? "■ Stop loop" : "▶ Loop region"}</button>
    ${baked
      ? `<button class="btn btn-secondary btn-sm" id="regionEditNotes">${rollOpen ? "Hide notes" : "✎ Edit notes"}</button>
         <button class="btn btn-secondary btn-sm" id="regionUnbake" title="Return this region to generative playback (the baked notes are discarded; the seed regenerates the same take)">Unbake</button>`
      : `<button class="btn btn-secondary btn-sm" id="regionBake" title="Freeze this take into editable notes — the piano-roll editor works on baked regions">◆ Bake</button>`}
    <button class="btn btn-secondary btn-sm" id="regionReroll" title="Draw a fresh take: new seed, same instrument and context (R)"${baked ? " disabled" : ""}>↻ Reroll</button>
    <button class="btn btn-ghost btn-sm" id="regionSeedBack" title="Step back to the previous seed (⇧R)"${baked ? " disabled" : ""}>⤺ seed</button>
    <button class="btn btn-ghost btn-sm" id="regionSplit" title="Split at the playhead (⌘T) — both halves keep the same take">✂ Split</button>
    <button class="btn btn-ghost btn-sm" id="regionMute" title="Mute this region (playback and mixdown skip it)">Mute</button>
    <label class="region-gain-label" title="Region level (multiplies the track level during this region)">Lvl
      <input type="range" id="regionGain" min="0" max="1.5" step="0.05" value="${sel?.gain ?? 1}"/>
    </label>
    <button class="btn btn-ghost btn-sm" id="regionToStudio" title="Open this region's exact sound and context in the Sound Studio">→ Studio</button>
    <button class="btn btn-ghost btn-sm" id="regionDelete">Delete</button>`;
}

// ── Pointer-based drag & drop (v2.1 U0) ─────────────────────
// HTML5 DnD proved unreliable across real browsers; DAW-style dragging is
// plain pointer tracking with a ghost. Sources: browser cards (→ palette
// or straight onto a lane), palette items (→ lanes/new-track), regions
// (→ move along/between lanes).
let pointerDrag = null; // { kind, data, label, startX, startY, started, ghost }

function laneAtPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .map(el => (el.closest ? el.closest("[data-lane]") : null))
    .find(Boolean) || null;
}
function paletteZoneAtPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .map(el => (el.closest ? el.closest("#dawPalette") : null))
    .find(Boolean) || null;
}
function paletteItemAtPoint(x, y) {
  return document.elementsFromPoint(x, y)
    .map(el => (el.closest ? el.closest("[data-palette-item]") : null))
    .find(Boolean) || null;
}
function beatAtClientX(lane, clientX) {
  const rect = lane.getBoundingClientRect();
  const raw = (clientX - rect.left) / pxPerBeat;
  // snap Off (0) and ⌃-drag both bypass the grid (spec T10; ⌥ stays copy)
  const grid = (pointerDrag && pointerDrag.ctrl) ? 0 : snapBeats;
  const snapped = grid > 0 ? Math.round(raw / grid) * grid : Math.round(raw * 100) / 100;
  return Math.max(0, Math.min(totalBeats() - Math.max(0.25, grid), snapped));
}

function trackAudible(track) {
  const anySolo = arrangement.tracks.some(t => t.solo);
  return !track.muted && (!anySolo || track.solo);
}

function trackFreeFrom(track, fromBeat) {
  let limit = totalBeats() - fromBeat;
  for (const r of track.regions) {
    if (r.startBeat + regionLen(r) <= fromBeat) continue;
    if (r.startBeat >= fromBeat) limit = Math.min(limit, r.startBeat - fromBeat);
    else return 0; // inside an existing region
  }
  return limit;
}

function dropPaletteOnLane(laneId, palId, beat) {
  const pal = (arrangement.palette || []).find(pl => pl.id === palId);
  if (!pal) return false;
  let track;
  if (laneId === "__new__") {
    track = { id: crypto.randomUUID(), name: pal.name, gain: 1, regions: [] };
    arrangement.tracks.push(track);
  } else {
    track = arrangement.tracks.find(t => t.id === laneId);
  }
  if (!track) return false;
  const len = Math.min(BEATS_PER_BAR * 2, trackFreeFrom(track, beat));
  if (len < 1) return false;
  const region = { id: crypto.randomUUID(), paletteId: pal.id, startBeat: beat, lengthBeats: len, seed: newSeed() };
  track.regions.push(region);
  selectedRegion = { trackId: track.id, regionId: region.id };
  saveArrangement();
  renderProduce();
  return true;
}

function dropRegionOnLane(laneId, payload, beat, copy = false) {
  const src = arrangement.tracks.find(t => t.id === payload.trackId);
  const region = src?.regions.find(r => r.id === payload.regionId);
  if (!src || !region || laneId === "__new__") return false;
  const dest = arrangement.tracks.find(t => t.id === laneId);
  if (!dest) return false;
  const start = Math.max(0, Math.min(totalBeats() - regionLen(region), beat));
  if (!spanFree(dest, start, regionLen(region), copy ? null : region.id)) return false;
  let placed = region;
  if (copy) {
    placed = JSON.parse(JSON.stringify(region));
    placed.id = crypto.randomUUID();
  } else {
    src.regions = src.regions.filter(r => r.id !== region.id);
  }
  placed.startBeat = start;
  dest.regions.push(placed);
  selectedRegion = { trackId: dest.id, regionId: placed.id };
  saveArrangement();
  renderProduce();
  return true;
}

// Spec R4: ⌘D duplicates with the SAME seed (exact repetition is the
// point of determinism); ⇧⌘D duplicates with a fresh seed (variation).
function duplicateSelectedRegion(withNewSeed = false) {
  if (!selectedRegion) return;
  const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
  const region = track?.regions.find(r => r.id === selectedRegion.regionId);
  if (!track || !region) return;
  const len = regionLen(region);
  let start = region.startBeat + len;
  while (start + len <= totalBeats() && !spanFree(track, start, len)) start++;
  if (start + len > totalBeats()) return;
  const copy = JSON.parse(JSON.stringify(region));
  copy.id = crypto.randomUUID();
  copy.startBeat = start;
  if (withNewSeed && copy.type !== "baked") copy.seed = newSeed();
  track.regions.push(copy);
  selectedRegion = { trackId: track.id, regionId: copy.id };
  saveArrangement(withNewSeed ? "duplicate (new seed)" : "duplicate");
  renderProduce();
}

// Spec R5: split at the playhead. Generative halves keep the SAME seed —
// the tail carries takeOffsetBeats so it plays the later part of the same
// take. Baked regions split their note lists.
function splitSelectedRegionAtPlayhead() {
  if (!selectedRegion) return;
  const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
  const region = track?.regions.find(r => r.id === selectedRegion.regionId);
  if (!track || !region) return;
  const cut = Math.round(playheadBeat * 4) / 4;
  const rel = cut - region.startBeat;
  if (rel <= 0 || rel >= regionLen(region)) return; // playhead not inside
  if (region.type === "baked") {
    if (region.loopSourceBeats && regionLen(region) > region.loopSourceBeats && rel > region.loopSourceBeats) {
      alert("Split inside the first loop pass of a baked region (or unbake first).");
      return;
    }
    const beatDiv = (arrangement.context.beatDivisions || 1);
    const cutDivs = rel * beatDiv;
    const tailNotes = region.notes.filter(nn => (nn.offsetDivs || 0) >= cutDivs)
      .map(nn => ({ ...nn, offsetDivs: (nn.offsetDivs || 0) - cutDivs }));
    region.notes = region.notes.filter(nn => (nn.offsetDivs || 0) < cutDivs);
    const tail = JSON.parse(JSON.stringify(region));
    tail.id = crypto.randomUUID();
    tail.startBeat = cut;
    tail.lengthBeats = regionLen(region) - rel;
    tail.notes = tailNotes;
    tail.loopSourceBeats = tail.lengthBeats;
    region.lengthBeats = rel;
    region.loopSourceBeats = Math.min(region.loopSourceBeats || rel, rel);
    track.regions.push(tail);
  } else {
    const tail = JSON.parse(JSON.stringify(region));
    tail.id = crypto.randomUUID();
    tail.startBeat = cut;
    tail.lengthBeats = regionLen(region) - rel;
    tail.takeOffsetBeats = (region.takeOffsetBeats || 0) + rel;
    region.lengthBeats = rel;
    track.regions.push(tail);
  }
  selectedRegion = { trackId: track.id, regionId: region.id };
  saveArrangement("split");
  renderProduce();
}

// Spec R7: clipboard — paste lands at the playhead on the source track
// (or the selected region's track), sliding right past collisions.
let _regionClipboard = null;
function copySelectedRegion() {
  if (!selectedRegion) return;
  const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
  const region = track?.regions.find(r => r.id === selectedRegion.regionId);
  if (!region) return;
  _regionClipboard = { trackId: track.id, region: JSON.parse(JSON.stringify(region)) };
}
function pasteRegionAtPlayhead() {
  if (!_regionClipboard) return;
  const track = arrangement.tracks.find(t => t.id === (selectedRegion?.trackId || _regionClipboard.trackId))
    || arrangement.tracks[0];
  if (!track) return;
  const copy = JSON.parse(JSON.stringify(_regionClipboard.region));
  copy.id = crypto.randomUUID();
  const len = regionLen(copy);
  let start = Math.max(0, Math.round(playheadBeat));
  while (start + len <= totalBeats() && !spanFree(track, start, len)) start++;
  if (start + len > totalBeats()) return;
  copy.startBeat = start;
  track.regions.push(copy);
  selectedRegion = { trackId: track.id, regionId: copy.id };
  saveArrangement("paste");
  renderProduce();
}

// U4: DAW keyboard transport, active only in the producer view
if (!window._dawKeysInstalled) {
  window._dawKeysInstalled = true;
  document.addEventListener("keydown", (e) => {
    if (!location.hash.includes("produce") || !arrangement) return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.code === "Space") {
      e.preventDefault();
      document.querySelector("#arrPlayBtn")?.click();
    } else if (e.key === "Enter" && !e.metaKey) {
      e.preventDefault();
      document.querySelector("#arrRTZ")?.click();
    } else if (e.key.toLowerCase() === "z" && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      // Z = zoom-to-fit arrangement; ⇧Z = zoom-to-selection (spec T9)
      const grid = document.querySelector(".timeline-grid");
      if (grid) {
        if (e.shiftKey && selectedRegion) {
          const tr = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
          const rg = tr && tr.regions.find(r => r.id === selectedRegion.regionId);
          if (rg) {
            dawLayout.pxPerBeat = Math.max(6, Math.min(32, Math.floor(grid.clientWidth * 0.8 / Math.max(4, regionLen(rg)))));
            saveDawLayout();
            renderProduce();
          }
        } else {
          dawLayout.pxPerBeat = Math.max(6, Math.min(32, Math.floor((grid.clientWidth - 160) / Math.max(8, totalBeats()))));
          saveDawLayout();
          renderProduce();
        }
      }
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      dawLayout.pxPerBeat = Math.min(32, (dawLayout.pxPerBeat || 14) + 3);
      saveDawLayout();
      renderProduce();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "-") {
      e.preventDefault();
      dawLayout.pxPerBeat = Math.max(6, (dawLayout.pxPerBeat || 14) - 3);
      saveDawLayout();
      renderProduce();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selectedRegion) {
      e.preventDefault();
      document.querySelector("#regionDelete")?.click();
    } else if (e.key === "Escape") {
      selectedRegion = null;
      rollOpen = false;
      renderProduce();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      duplicateSelectedRegion(e.shiftKey); // ⇧⌘D = duplicate with a NEW seed
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      splitSelectedRegionAtPlayhead();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copySelectedRegion();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      pasteRegionAtPlayhead();
    } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey && selectedRegion) {
      e.preventDefault();
      if (e.shiftKey) document.querySelector("#regionSeedBack")?.click();
      else document.querySelector("#regionReroll")?.click();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redoArrangement();
      else undoArrangement();
    }
  });
}

function beginPointerDrag(kind, data, label, e) {
  pointerDrag = { kind, data, label, startX: e.clientX, startY: e.clientY, started: false, ghost: null };
  document.addEventListener("mousemove", pointerDragMove);
  document.addEventListener("mouseup", pointerDragUp);
}

function _dropPreviewEl() {
  let el = document.getElementById("dropPreview");
  if (!el) {
    el = document.createElement("div");
    el.id = "dropPreview";
    el.className = "tl2-drop-preview";
    document.body.appendChild(el);
  }
  return el;
}

function pointerDragMove(e) {
  if (pointerDrag) pointerDrag.ctrl = e.ctrlKey;
  // Insertion preview: while dragging over a lane, show EXACTLY where the
  // region will land (snapped beat + width) before the mouse is released.
  if (pointerDrag && pointerDrag.started) {
    const lane = laneAtPoint(e.clientX, e.clientY);
    const prev = _dropPreviewEl();
    if (lane && lane.dataset.lane !== "__new__") {
      const beat = beatAtClientX(lane, e.clientX);
      let lenBeats = 8;
      if (pointerDrag.kind === "region") {
        const srcTrack = arrangement.tracks.find(t => t.id === pointerDrag.data.trackId);
        const srcRegion = srcTrack?.regions.find(r => r.id === pointerDrag.data.regionId);
        if (srcRegion) lenBeats = regionLen(srcRegion);
      }
      const rect = lane.getBoundingClientRect();
      prev.style.display = "block";
      prev.style.left = `${rect.left + beat * pxPerBeat}px`;
      prev.style.top = `${rect.top}px`;
      prev.style.width = `${lenBeats * pxPerBeat}px`;
      prev.style.height = `${rect.height}px`;
    } else {
      prev.style.display = "none";
    }
  }
  if (!pointerDrag) return;
  if (!pointerDrag.started) {
    if (Math.abs(e.clientX - pointerDrag.startX) + Math.abs(e.clientY - pointerDrag.startY) < 5) return;
    pointerDrag.started = true;
    const g = document.createElement("div");
    g.className = "drag-ghost";
    g.textContent = pointerDrag.label;
    document.body.appendChild(g);
    pointerDrag.ghost = g;
    document.body.classList.add("dragging");
  }
  pointerDrag.ghost.style.left = `${e.clientX + 12}px`;
  pointerDrag.ghost.style.top = `${e.clientY + 10}px`;
  document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
  const lane = laneAtPoint(e.clientX, e.clientY);
  if (lane) lane.classList.add("drop-target");
  else if (pointerDrag.kind === "browser") {
    const itemEl = paletteItemAtPoint(e.clientX, e.clientY);
    if (itemEl) itemEl.classList.add("drop-target");
    else {
      const zone = paletteZoneAtPoint(e.clientX, e.clientY);
      if (zone) zone.classList.add("drop-target");
    }
  }
  e.preventDefault();
}

function pointerDragUp(e) {
  document.removeEventListener("mousemove", pointerDragMove);
  document.removeEventListener("mouseup", pointerDragUp);
  const prevEl = document.getElementById("dropPreview");
  if (prevEl) prevEl.style.display = "none";
  const drag = pointerDrag;
  pointerDrag = null;
  if (!drag) return;
  drag.ghost?.remove();
  document.body.classList.remove("dragging");
  document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
  if (!drag.started) return; // plain click — click handlers take it from here

  const lane = laneAtPoint(e.clientX, e.clientY);
  if (drag.kind === "region") {
    if (lane) dropRegionOnLane(lane.dataset.lane, drag.data, beatAtClientX(lane, e.clientX), drag.alt || e.altKey);
    return;
  }
  if (drag.kind === "palette") {
    if (lane) dropPaletteOnLane(lane.dataset.lane, drag.data, beatAtClientX(lane, e.clientX));
    return;
  }
  if (drag.kind === "browser") {
    const item = browserItems().find(i => i.id === drag.data);
    if (!item) return;
    if (lane) {
      // Straight from the browser onto a track: add to palette, then place
      addToPalette(item);
      const palId = arrangement.palette[arrangement.palette.length - 1].id;
      dropPaletteOnLane(lane.dataset.lane, palId, beatAtClientX(lane, e.clientX));
      return;
    }
    // Q1: dropping ON an existing patch loads the preset into it — the
    // patch's MACRO/BOTH/SUB-NOTE selector decides which half is replaced.
    const palEl = paletteItemAtPoint(e.clientX, e.clientY);
    const pl = palEl && (arrangement.palette || []).find(x => x.id === palEl.dataset.paletteItem);
    if (pl) {
      const half = _palHalfSel[pl.id] || "both";
      loadPresetIntoPatch(pl, item, half);
      saveArrangement(`load ${item.name} → ${pl.name} (${half})`);
      renderProduce();
    } else if (paletteZoneAtPoint(e.clientX, e.clientY)) {
      addToPalette(item);
      renderProduce();
    }
  }
}

// DAW shell layout state (docs/PRODUCER_V2_DESIGN.md B8)
const DAW_LAYOUT_KEY = "phase0.dawLayout.v1";
function loadDawLayout() {
  try {
    return { leftW: 250, editorH: 240, leftOpen: true, editorOpen: false, pxPerBeat: 14, snapBeats: 1,
      ...(JSON.parse(localStorage.getItem(DAW_LAYOUT_KEY) || "{}")) };
  } catch { return { leftW: 250, editorH: 240, leftOpen: true, editorOpen: false, pxPerBeat: 14, snapBeats: 1 }; }
}
let dawLayout = null;
let browserFilter = "all";   // all | starter | instrument | mine | section
let browserSearch = "";
let browserPreviewId = null; // browser item currently previewing
function saveDawLayout() { localStorage.setItem(DAW_LAYOUT_KEY, JSON.stringify(dawLayout)); }

function renderProduce() {
  arrangement = arrangement || loadArrangement();
  dawLayout = dawLayout || loadDawLayout();
  pxPerBeat = dawLayout.pxPerBeat || 14;
  snapBeats = dawLayout.snapBeats || 1;
  const sources = produceSources();
  const editorOpen = rollOpen && !!selectedBakedRegion();
  const v = mount(`
    <div class="daw">
      <div class="daw-transport">
        <a class="btn btn-ghost btn-sm" href="#explore" title="Back to the Sound Studio">←</a>
        <span class="daw-title">Producer <span class="build-tag" title="App version · asset build (bumps with every change)">${BUILD_TAG}</span></span>
        <select id="arrSelect" class="daw-ctx-select" title="Switch arrangement">
          ${Object.values(loadArrangementRegistry()).map(a =>
            `<option value="${a.id}"${a.id === arrangement.id ? " selected" : ""}>${esc(a.name || "Untitled")}</option>`).join("")}
        </select>
        <button class="btn btn-ghost btn-sm" id="arrNew" title="New empty arrangement">New</button>
        <button class="btn btn-ghost btn-sm" id="arrRename" title="Rename this arrangement">Aa</button>
        <button class="btn btn-ghost btn-sm" id="arrDelete" title="Delete this arrangement">🗑</button>
        <button class="btn btn-ghost btn-sm" id="arrRTZ" title="Return to bar 1 (Return)">⏮</button>
        <button class="btn btn-primary btn-sm" id="arrPlayBtn" title="Play / pause (Space)">▶</button>
        <button class="btn btn-secondary btn-sm" id="prodStop" title="Stop (returns to the start marker)">■</button>
        <button class="btn btn-ghost btn-sm${arrangement.loopOn ? " loop-on" : ""}" id="arrLoop" title="Cycle the loop range (drag the ruler's top half to set it)">⟳</button>
        <span class="daw-pos" id="arrPos" title="Position bar.beat — click to locate">${Math.floor(playheadBeat / BEATS_PER_BAR) + 1}.${(Math.floor(playheadBeat) % BEATS_PER_BAR) + 1}</span>
        <span class="daw-saved" id="arrSaved"></span>
        <span class="daw-sep"></span>
        ${sessionBarControlsHTML()}
        <span class="daw-sep"></span>
        <button class="btn btn-ghost btn-sm" id="undoBtn" title="Undo the last change (⌘Z; press again to redo)">↩</button>
        <button class="btn btn-ghost btn-sm" id="zoomOut" title="Zoom out">−</button>
        <button class="btn btn-ghost btn-sm" id="zoomIn" title="Zoom in">＋</button>
        <select id="snapSelect" class="daw-ctx-select" title="Grid snap (⌃-drag bypasses)">
          <option value="4"${snapBeats === 4 ? " selected" : ""}>Bar</option>
          <option value="1"${snapBeats === 1 ? " selected" : ""}>Beat</option>
          <option value="0.5"${snapBeats === 0.5 ? " selected" : ""}>½ beat</option>
          <option value="0"${snapBeats === 0 ? " selected" : ""}>Off</option>
        </select>
        <input type="range" id="zoomSlider" min="6" max="32" step="1" value="${pxPerBeat}" title="Zoom (Z = fit arrangement, ⇧Z = fit selection)" class="zoom-slider"/>
        <button class="btn btn-ghost btn-sm" id="addBars" title="Lengthen the arrangement by 8 bars">＋8 bars</button>
        <span class="daw-sep"></span>
        <button class="btn btn-secondary btn-sm" id="arrMixdown" title="Render the arrangement offline and download it as a WAV">⬇ WAV</button>
        <button class="btn btn-ghost btn-sm" id="arrExport" title="Download this arrangement as a self-contained JSON file (instruments included)">Export</button>
        <button class="btn btn-ghost btn-sm" id="arrImport" title="Load an arrangement JSON file">Import</button>
        <input type="file" id="arrImportFile" accept="application/json" style="display:none"/>
        <span class="toolbar-hint" id="mixStatus"></span>
      </div>
      <div class="daw-main">
        <div class="daw-left${dawLayout.leftOpen ? "" : " collapsed"}" style="width:${dawLayout.leftOpen ? dawLayout.leftW : 22}px">
          <button class="daw-collapse" id="leftCollapse" title="${dawLayout.leftOpen ? "Collapse" : "Expand"} the library panel">${dawLayout.leftOpen ? "◂" : "▸"}</button>
          <div class="daw-left-content${dawLayout.leftOpen ? "" : " hidden"}">
            <div class="daw-browser">
              <div class="section-label">Browser</div>
              <input type="search" id="browserSearch" placeholder="Search presets…" value="${esc(browserSearch)}"/>
              <div class="browser-filters">
                ${[["all", "All"], ["starter", "Starters"], ["instrument", "Instruments"], ["mine", "Mine"], ["section", "Sections"]].map(([k, label]) =>
                  `<button class="filter-chip${browserFilter === k ? " active" : ""}" data-browser-filter="${k}">${label}</button>`).join("")}
                <select class="splits-filter" data-splits-filter title="Filter presets by number of splits (scale degrees per octave)">
                  ${[["all", "Any splits"], ["5", "5 splits"], ["6", "6 splits"], ["7", "7 splits"], ["8+", "8+ splits"], ["12", "12 splits"], ["other", "Other"]].map(([k, label]) =>
                    `<option value="${k}"${splitsFilter === k ? " selected" : ""}>${label}</option>`).join("")}
                </select>
              </div>
              <div class="browser-cards" id="browserCards"></div>
            </div>
            <div class="daw-palette" id="dawPalette">
              <div class="section-label">Palette</div>
              <div class="palette-rack" id="paletteRack">
                ${(arrangement.palette || []).length ? (arrangement.palette || []).map(pl => {
                  const half = _palHalfSel[pl.id] || "both";
                  return `
                  <div class="palette-item${half !== "both" ? " half-armed" : ""}" data-palette-item="${pl.id}" title="Your working instrument — drag onto a track (P3) or add a track with +. Drop a browser preset ON this card to load it into the selected half.">
                    <span class="pal-name">${esc(pl.name)}</span>
                    <span class="pal-kind">${esc(pl.kindLabel || "")}</span>
                    <span class="pal-actions">
                      ${pl.originTempo ? `<button class="pal-btn" data-adopt-tempo="${pl.id}" title="Adopt this patch's design tempo (${pl.originTempo} bpm) as the session tempo">⏱</button>` : ""}
                      <button class="pal-btn" data-palette-edit="${pl.id}" title="Open this instrument in the Sound Studio editor — save it back and every region using it follows">✎</button>
                      <button class="pal-btn" data-add-track="pal:${pl.id}" title="Add a track playing this instrument">+</button>
                      <button class="pal-btn" data-palette-remove="${pl.id}" title="Remove from palette">×</button>
                    </span>
                    ${patchBadgesHTML({ ...pl.params, ...(pl.originScale || {}) }, pl.originTempo)}
                    <span class="pal-half" role="group" title="Which half of this patch browser presets load into: MACRO = behaviour (melody, rhythm, dynamics, surprise), SUB-NOTE = the sound itself, BOTH = the whole patch">
                      ${[["macro", "MACRO"], ["both", "BOTH"], ["subnote", "SUB-NOTE"]].map(([h, label]) =>
                        `<button class="pal-half-btn${half === h ? " active" : ""}" data-pal-half="${pl.id}:${h}">${label}</button>`).join("")}
                    </span>
                  </div>`;
                }).join("") : '<div class="empty-state">Drag presets here from the browser above — this is your instrument rack for the arrangement.</div>'}
              </div>
            </div>
          </div>
        </div>
        <div class="daw-vsplit" id="dawVSplit" title="Drag to resize the library panel"></div>
        <div class="daw-center">
          <div class="timeline-grid" id="timelineGrid">${produceTimelineHTML()}</div>
          <div class="region-toolbar" id="regionToolbar">${produceToolbarHTML()}</div>
        </div>
      </div>
      <div class="daw-hsplit${editorOpen ? "" : " hidden"}" id="dawHSplit" title="Drag to resize the editor"></div>
      <div class="daw-editor${editorOpen ? "" : " collapsed"}" style="height:${editorOpen ? dawLayout.editorH : 0}px">
        ${editorOpen ? rollPanelHTML() : ""}
      </div>
    </div>
  `);
  document.body.classList.add("explore-mode");
  document.title = "Sound Studio — Producer";
  wireDawLayout(v);
  wireProduce(v);
  return v;
}

function wireGlobalScale(v) {
  const gsToggle = v.querySelector("#gsToggle");
  if (gsToggle) gsToggle.onclick = () => { _gsOpen = !_gsOpen; renderProduce(); };
  const gsEnabled = v.querySelector("#gsEnabled");
  if (gsEnabled) gsEnabled.onchange = () => {
    ensureGlobalScale().enabled = gsEnabled.checked;
    saveArrangement("global scale on/off");
    renderProduce();
  };
  const gsAdd = v.querySelector("#gsAddMarker");
  if (gsAdd) gsAdd.onclick = () => {
    const gs = ensureGlobalScale();
    const ctx = arrangement.context;
    const atBeat = Math.round(playheadBeat * 4) / 4;
    if (gs.markers.some(m => m.atBeat === atBeat)) {
      _gsSelMarker = gs.markers.findIndex(m => m.atBeat === atBeat);
      renderProduce();
      return;
    }
    gs.markers.push({
      atBeat,
      degrees: [...(ctx.customDegrees || SCALE_PRESETS[ctx.scalePreset]?.degrees || SCALE_PRESETS.major.degrees)],
      subScaleNotes: [...(ctx.subScaleNotes || [])],
      rootNotes: [...(ctx.rootNotes || [0])],
    });
    gs.markers.sort((a, b) => a.atBeat - b.atBeat);
    _gsSelMarker = gs.markers.findIndex(m => m.atBeat === atBeat);
    gs.enabled = true; // adding the first marker is an unambiguous opt-in
    saveArrangement("global scale marker");
    renderProduce();
  };
  v.querySelectorAll("[data-gs-marker]").forEach(f => {
    f.onclick = () => {
      const i = Number(f.dataset.gsMarker);
      _gsSelMarker = _gsSelMarker === i ? -1 : i;
      renderProduce();
    };
  });
  v.querySelectorAll("[data-gs-cell]").forEach(btn => {
    btn.onclick = () => {
      const m = ensureGlobalScale().markers[_gsSelMarker];
      if (!m) return;
      const d = Number(btn.dataset.gsCell);
      const has = (arr) => Array.isArray(arr) && arr.includes(d);
      const rm = (arr) => (arr || []).filter(x => x !== d);
      const add = (arr) => [...(arr || []), d].sort((a, b) => a - b);
      // off → scale → sub-scale → root → off (root implies sub implies scale)
      if (has(m.rootNotes)) {
        m.rootNotes = rm(m.rootNotes); m.subScaleNotes = rm(m.subScaleNotes); m.degrees = rm(m.degrees);
      } else if (has(m.subScaleNotes)) {
        m.rootNotes = add(m.rootNotes);
      } else if (has(m.degrees)) {
        m.subScaleNotes = add(m.subScaleNotes);
      } else {
        m.degrees = add(m.degrees);
      }
      saveArrangement("global scale edit");
      renderProduce();
    };
  });
  const gsDel = v.querySelector("#gsDeleteMarker");
  if (gsDel) gsDel.onclick = () => {
    ensureGlobalScale().markers.splice(_gsSelMarker, 1);
    _gsSelMarker = -1;
    saveArrangement("global scale marker removed");
    renderProduce();
  };
  v.querySelectorAll("[data-track-gscale]").forEach(btn => {
    btn.onclick = () => {
      const t = arrangement.tracks.find(t => t.id === btn.dataset.trackGscale);
      if (!t) return;
      t.useGlobalScale = !t.useGlobalScale;
      saveArrangement("track follows global scale");
      renderProduce();
    };
  });
}

function wireProduce(v) {
  const sources = produceSources();

  wireSessionBar(v);
  wireBrowserPalette(v);
  wireGlobalScale(v);
  wireGlobalSpace(v);

  v.querySelectorAll("[data-add-track]").forEach(btn => {
    btn.onclick = () => {
      const source = sources.find(s => s.id === btn.dataset.addTrack);
      if (!source) return;
      const track = {
        id: crypto.randomUUID(),
        name: source.name,
        sourceKind: source.kind,
        instrumentParams: { ...source.parameters },
        gain: 1,
        regions: [],
      };
      // Click fallback for drag-placement: a palette "+" starts the track
      // with a first region at bar 1, ready to move/extend from the toolbar.
      const palId = btn.dataset.addTrack.startsWith("pal:") ? btn.dataset.addTrack.slice(4) : null;
      if (palId) {
        track.regions.push({
          id: crypto.randomUUID(), paletteId: palId,
          startBeat: 0, lengthBeats: BEATS_PER_BAR * 2, seed: newSeed(),
        });
      }
      arrangement.tracks.push(track);
      const region = track.regions[0];
      if (region) selectedRegion = { trackId: track.id, regionId: region.id };
      saveArrangement();
      renderProduce();
    };
  });

  v.querySelectorAll("[data-remove-track]").forEach(btn => {
    btn.onclick = () => {
      arrangement.tracks = arrangement.tracks.filter(t => t.id !== btn.dataset.removeTrack);
      if (selectedRegion && !arrangement.tracks.some(t => t.id === selectedRegion.trackId)) {
        selectedRegion = null;
      }
      saveArrangement();
      renderProduce();
    };
  });

  // Lane drops are handled by the pointer-drag machinery (v2.1 U0)

  // Right-edge resize (mouse drag, snapped to beats, collision-clamped)
  v.querySelectorAll("[data-resize]").forEach(handle => {
    handle.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const regionEl = handle.closest("[data-region]");
      const track = arrangement.tracks.find(t => t.id === regionEl.dataset.track);
      const region = track?.regions.find(r => r.id === regionEl.dataset.region);
      if (!track || !region) return;
      const startX = e.clientX;
      const origLen = regionLen(region);
      const move = (ev) => {
        const delta = Math.round((ev.clientX - startX) / pxPerBeat);
        const len = Math.max(1, Math.min(maxRegionLength(track, region), origLen + delta));
        region.lengthBeats = len;
        regionEl.style.width = `${len * pxPerBeat - 2}px`;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        saveArrangement();
        renderProduce();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
  });

  v.querySelectorAll("[data-region]").forEach(el => {
    el.onclick = () => {
      if (selectedRegion?.regionId !== el.dataset.region) rollNoteSel = -1;
      selectedRegion = { trackId: el.dataset.track, regionId: el.dataset.region };
      renderProduce();
    };
    el.ondblclick = () => {
      selectedRegion = { trackId: el.dataset.track, regionId: el.dataset.region };
      if (selectedBakedRegion()) {
        rollOpen = true;
        renderProduce();
      }
    };
  });

  // Click the ruler to set the playhead
  const ruler = v.querySelector("#tlRuler");
  if (ruler) {
    const beatAt = (e) => {
      const rect = ruler.getBoundingClientRect();
      return Math.max(0, Math.min(totalBeats() - 1, Math.round((e.clientX - rect.left) / pxPerBeat)));
    };
    ruler.onmousedown = (e) => {
      e.preventDefault();
      const rect = ruler.getBoundingClientRect();
      const topHalf = (e.clientY - rect.top) < rect.height * 0.45;
      if (topHalf) {
        // drag the top half to set the loop/cycle range (spec T4)
        const a0 = beatAt(e);
        let moved = false;
        const move = (ev) => {
          const b1 = beatAt(ev);
          if (b1 !== a0) moved = true;
          arrangement.loopRange = { a: Math.min(a0, b1), b: Math.max(a0, b1) + 1 };
          const lr = document.getElementById("tlLoopRange");
          if (lr) {
            lr.classList.remove("hidden");
            lr.style.left = `${arrangement.loopRange.a * pxPerBeat}px`;
            lr.style.width = `${(arrangement.loopRange.b - arrangement.loopRange.a) * pxPerBeat}px`;
          }
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          if (moved) {
            arrangement.loopOn = true;
            saveArrangement("set loop range");
            renderProduce();
          }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
        return;
      }
      // bottom half: locate + scrub (silent — determinism makes scrub-audio misleading)
      const locate = (ev) => {
        playheadBeat = beatAt(ev);
        updatePlayhead(playheadBeat);
      };
      locate(e);
      const move = (ev) => locate(ev);
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  }
  // double-click empty lane space = new region at the grid (spec R1)
  v.querySelectorAll(".tl2-lane").forEach(lane => {
    lane.ondblclick = (e) => {
      if (e.target !== lane) return;
      const track = arrangement.tracks.find(t => t.id === lane.dataset.lane);
      if (!track) return;
      const beat = beatAtClientX(lane, e.clientX);
      const pal = (arrangement.palette || []).find(pl => pl.id === (track.regions[track.regions.length - 1]?.paletteId))
        || (arrangement.palette || [])[0];
      if (!pal) return;
      // longest free run at the drop point, capped at 8 beats
      let len = 0;
      while (len < 8 && spanFree(track, beat, len + 1)) len++;
      if (len < 1) return;
      const region = { id: crypto.randomUUID(), paletteId: pal.id, startBeat: beat, lengthBeats: len, seed: newSeed() };
      track.regions.push(region);
      selectedRegion = { trackId: track.id, regionId: region.id };
      saveArrangement("create region");
      renderProduce();
    };
  });

  updatePlayhead(arrPlay ? arrPlay.beat : playheadBeat);

  wireRoll(v);

  const selected = () => {
    if (!selectedRegion) return {};
    const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
    const region = track?.regions.find(r => r.id === selectedRegion.regionId);
    return { track, region };
  };

  const playBtn = v.querySelector("#regionPlay");
  if (playBtn) playBtn.onclick = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    stopArrangement();
    if (synth.isPlaying) { synth.stop(); }
    else if (region.type === "baked" && Array.isArray(region.notes)) {
      synth.playNotes(regionPlayParams(track, region), region.notes,
        regionLen(region), region.loopSourceBeats || regionLen(region));
    }
    else { synth.play(regionPlayParams(track, region)); }
    renderProduce();
  };

  const rerollBtn = v.querySelector("#regionReroll");
  if (rerollBtn) rerollBtn.onclick = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    region.previousSeeds = [...(region.previousSeeds || []), region.seed].slice(-8);
    region.seed = newSeed();
    saveArrangement("reroll");
    if (synth.isPlaying) synth.play(regionPlayParams(track, region));
    renderProduce();
  };
  const seedBackBtn = v.querySelector("#regionSeedBack");
  if (seedBackBtn) seedBackBtn.onclick = () => {
    const { track, region } = selected();
    if (!track || !region || !(region.previousSeeds || []).length) return;
    region.seed = region.previousSeeds.pop();
    saveArrangement("seed back");
    if (synth.isPlaying) synth.play(regionPlayParams(track, region));
    renderProduce();
  };
  const splitBtn = v.querySelector("#regionSplit");
  if (splitBtn) splitBtn.onclick = () => splitSelectedRegionAtPlayhead();
  const muteBtn = v.querySelector("#regionMute");
  if (muteBtn) muteBtn.onclick = () => {
    const { region } = selected();
    if (!region) return;
    region.muted = !region.muted;
    saveArrangement(region.muted ? "mute region" : "unmute region");
    renderProduce();
  };
  // Region gain tag: vertical drag trims the region level in dB
  v.querySelectorAll("[data-gain-tag]").forEach(tag => {
    tag.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { track, region } = selected();
      if (!region) return;
      const startY = e.clientY;
      const startGain = region.gain ?? 1;
      const move = (ev) => {
        const db = 20 * Math.log10(Math.max(0.02, startGain)) + (startY - ev.clientY) * 0.15;
        region.gain = clamp(Math.pow(10, db / 20), 0.02, 1.5);
        tag.textContent = `${db >= 0 ? "+" : ""}${db.toFixed(1)}dB`;
        if (arrPlay && track) {
          const voice = producerVoices.get(track.id);
          if (voice) voice.setMasterVolume((track.gain ?? 1) * region.gain);
        }
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        saveArrangement("region gain");
        renderProduce();
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  });

  const bakeBtn = v.querySelector("#regionBake");
  if (bakeBtn) bakeBtn.onclick = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    const ctxP = arrangement.context;
    const beatSec = 60 / Math.max(30, ctxP.tempo || 104);
    const params = regionPlayParams(track, region);
    region.notes = synth.captureSpan(params, beatSec * regionLen(region));
    region.type = "baked";
    region.loopSourceBeats = regionLen(region);
    saveArrangement();
    renderProduce();
  };

  const editNotesBtn = v.querySelector("#regionEditNotes");
  if (editNotesBtn) editNotesBtn.onclick = () => {
    rollOpen = !rollOpen;
    rollNoteSel = -1;
    renderProduce();
  };

  const unbakeBtn = v.querySelector("#regionUnbake");
  if (unbakeBtn) unbakeBtn.onclick = () => {
    const { region } = selected();
    if (!region) return;
    delete region.type;
    delete region.notes;
    saveArrangement();
    renderProduce();
  };


  // Mute / Solo (live: silences voices immediately, playback skips)
  v.querySelectorAll("[data-track-mute]").forEach(btn => {
    btn.onclick = () => {
      const track = arrangement.tracks.find(t => t.id === btn.dataset.trackMute);
      if (!track) return;
      track.muted = !track.muted;
      saveArrangement();
      if (arrPlay) arrangement.tracks.forEach(t => { if (!trackAudible(t)) producerVoices.get(t.id)?.stop(); });
      renderProduce();
    };
  });
  v.querySelectorAll("[data-track-solo]").forEach(btn => {
    btn.onclick = () => {
      const track = arrangement.tracks.find(t => t.id === btn.dataset.trackSolo);
      if (!track) return;
      track.solo = !track.solo;
      saveArrangement();
      if (arrPlay) arrangement.tracks.forEach(t => { if (!trackAudible(t)) producerVoices.get(t.id)?.stop(); });
      renderProduce();
    };
  });

  // Per-track pan (live on the playing voice)
  v.querySelectorAll("[data-track-pan]").forEach(sl => {
    sl.oninput = () => {
      const track = arrangement.tracks.find(t => t.id === sl.dataset.trackPan);
      if (!track) return;
      track.pan = Number(sl.value);
      saveArrangement();
      producerVoices.get(track.id)?.setPan(track.pan);
    };
  });

  // Per-track gain (live on the playing voice)
  v.querySelectorAll("[data-track-gain]").forEach(sl => {
    sl.oninput = () => {
      const track = arrangement.tracks.find(t => t.id === sl.dataset.trackGain);
      if (!track) return;
      track.gain = Number(sl.value);
      saveArrangement();
      producerVoices.get(track.id)?.setMasterVolume(track.gain);
    };
  });

  // Region bodies drag via pointer tracking (resize handle excluded)
  v.querySelectorAll("[data-region]").forEach(el => {
    el.setAttribute("draggable", "false");
    el.onmousedown = (e) => {
      if (e.target.closest("[data-resize]")) return;
      const track = arrangement.tracks.find(t => t.id === el.dataset.track);
      const region = track?.regions.find(r => r.id === el.dataset.region);
      if (!region) return;
      const pal = (arrangement.palette || []).find(pl => pl.id === region.paletteId);
      beginPointerDrag("region", { trackId: el.dataset.track, regionId: el.dataset.region },
        (e.altKey ? "⧉ " : "") + (pal ? pal.name : track.name), e);
      pointerDrag.alt = e.altKey;
      e.preventDefault();
    };
  });

  // Region gain (v2.1 U12) — live on the playing voice
  const regionGain = v.querySelector("#regionGain");
  if (regionGain) regionGain.oninput = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    region.gain = Number(regionGain.value);
    saveArrangement();
    producerVoices.get(track.id)?.setMasterVolume((track.gain ?? 1) * (region.gain ?? 1));
  };

  // Send region to the Sound Studio (v2.1 U13) — one-way explore
  const toStudio = v.querySelector("#regionToStudio");
  if (toStudio) toStudio.onclick = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    stopArrangement();
    synth.stop();
    exploreParams = { ...regionPlayParams(track, region) };
    navigate("explore");
  };

  const deleteBtn = v.querySelector("#regionDelete");
  if (deleteBtn) deleteBtn.onclick = () => {
    const { track, region } = selected();
    if (!track || !region) return;
    track.regions = track.regions.filter(r => r.id !== region.id);
    selectedRegion = null;
    saveArrangement();
    renderProduce();
  };

  const arrPlayBtn = v.querySelector("#arrPlayBtn");
  if (arrPlayBtn) arrPlayBtn.onclick = () => {
    if (arrPlay) {
      pauseArrangement();               // pause keeps the resume point
      arrPlayBtn.textContent = "▶";
    } else {
      playArrangement(playheadBeat);
      arrPlayBtn.textContent = "⏸";
    }
  };

  const stopBtn = v.querySelector("#prodStop");
  if (stopBtn) stopBtn.onclick = () => { stopArrangement(); synth.stop(); renderProduce(); };

  // Zoom / snap / length (v2.1 U5, U6)
  const zoomIn = v.querySelector("#zoomIn");
  const zoomOut = v.querySelector("#zoomOut");
  const setZoom = (px) => {
    dawLayout.pxPerBeat = Math.max(6, Math.min(32, px));
    saveDawLayout();
    renderProduce();
  };
  if (zoomIn) zoomIn.onclick = () => setZoom((dawLayout.pxPerBeat || 14) + 3);
  if (zoomOut) zoomOut.onclick = () => setZoom((dawLayout.pxPerBeat || 14) - 3);
  const snapSelect = v.querySelector("#snapSelect");
  if (snapSelect) snapSelect.onchange = () => {
    dawLayout.snapBeats = Number(snapSelect.value);
    saveDawLayout();
    renderProduce();
  };
  // Arrangement registry controls (v2.1 U11)
  const arrSelect = v.querySelector("#arrSelect");
  if (arrSelect) arrSelect.onchange = () => switchArrangement(arrSelect.value);
  const arrNew = v.querySelector("#arrNew");
  if (arrNew) arrNew.onclick = () => {
    const a = freshArrangement(prompt("Name the new arrangement:") || "Untitled arrangement");
    const reg = loadArrangementRegistry();
    reg[a.id] = a;
    saveArrangementRegistry(reg);
    switchArrangement(a.id);
  };
  const arrRename = v.querySelector("#arrRename");
  if (arrRename) arrRename.onclick = () => {
    const name = prompt("Rename arrangement:", arrangement.name);
    if (!name || !name.trim()) return;
    arrangement.name = name.trim().slice(0, 80);
    saveArrangement();
    renderProduce();
  };
  const arrDelete = v.querySelector("#arrDelete");
  if (arrDelete) arrDelete.onclick = () => {
    if (!confirm(`Delete arrangement "${arrangement.name}"? This cannot be undone.`)) return;
    const reg = loadArrangementRegistry();
    delete reg[arrangement.id];
    saveArrangementRegistry(reg);
    const next = Object.keys(reg)[0];
    if (next) switchArrangement(next);
    else { localStorage.removeItem(ARRANGEMENT_CURRENT_KEY); arrangement = null; renderProduce(); }
  };

  const undoBtn = v.querySelector("#undoBtn");
  if (undoBtn) undoBtn.onclick = () => undoArrangement();

  const rtz = v.querySelector("#arrRTZ");
  if (rtz) rtz.onclick = () => {
    playheadBeat = 0;
    if (arrPlay) playArrangement(0);
    else updatePlayhead(0);
  };
  const loopBtn = v.querySelector("#arrLoop");
  if (loopBtn) loopBtn.onclick = () => {
    if (!arrangement.loopRange) {
      arrangement.loopRange = { a: 0, b: Math.min(totalBeats(), 8 * BEATS_PER_BAR) };
    }
    arrangement.loopOn = !arrangement.loopOn;
    saveArrangement("loop toggle");
    renderProduce();
  };
  const posEl = v.querySelector("#arrPos");
  if (posEl) posEl.onclick = () => {
    const raw = prompt("Go to (bar or bar.beat):", posEl.textContent);
    if (!raw) return;
    const [bar, beat] = raw.split(".").map(Number);
    if (!Number.isFinite(bar)) return;
    playheadBeat = Math.max(0, Math.min(totalBeats() - 1,
      (bar - 1) * BEATS_PER_BAR + (Number.isFinite(beat) ? beat - 1 : 0)));
    updatePlayhead(playheadBeat);
  };
  const zoomSlider = v.querySelector("#zoomSlider");
  if (zoomSlider) zoomSlider.onchange = () => setZoom(Number(zoomSlider.value));

  const addBars = v.querySelector("#addBars");
  if (addBars) addBars.onclick = () => {
    arrangement.lengthBeats = totalBeats() + 8 * BEATS_PER_BAR;
    saveArrangement();
    renderProduce();
  };

  // Track rename via double-click (v2.1 U7)
  v.querySelectorAll(".tl2-name").forEach(nameEl => {
    nameEl.ondblclick = (e) => {
      e.stopPropagation();
      const head = nameEl.closest(".tl2-head");
      const trackId = head?.querySelector("[data-track-gain]")?.dataset.trackGain;
      const track = arrangement.tracks.find(t => t.id === trackId);
      if (!track) return;
      const input = document.createElement("input");
      input.type = "text";
      input.value = track.name;
      input.maxLength = 60;
      input.className = "tl2-rename";
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        track.name = input.value.trim() || track.name;
        saveArrangement();
        renderProduce();
      };
      input.onblur = commit;
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        if (ev.key === "Escape") { input.oninput = null; input.onblur = null; renderProduce(); }
        ev.stopPropagation();
      };
    };
  });

  const mixBtn = v.querySelector("#arrMixdown");
  if (mixBtn) mixBtn.onclick = () => mixdownArrangement(v.querySelector("#mixStatus"), mixBtn);
  const exportBtn = v.querySelector("#arrExport");
  if (exportBtn) exportBtn.onclick = () => exportArrangement();
  const importBtn = v.querySelector("#arrImport");
  const importFile = v.querySelector("#arrImportFile");
  if (importBtn && importFile) {
    importBtn.onclick = () => importFile.click();
    importFile.onchange = () => { if (importFile.files[0]) importArrangement(importFile.files[0]); };
  }
}

// ─── Landing ────────────────────────────────────────────────

function renderLanding() {
  const v = mount(`
    <div class="landing-header">
      <h1>Sound Preferences</h1>
      <p>A research experiment exploring how people hear and enjoy algorithmically generated sound.</p>
    </div>
    <div class="landing-cards">
      <a class="landing-card" id="goStudy">
        <span class="icon">&#x1F3AF;</span>
        <h2>Take the Study</h2>
        <p>Structured listening tasks that map your sound preferences. Your data helps design future experiments.</p>
        <span class="badge">~10 minutes</span>
      </a>
      <a class="landing-card" id="goExplore">
        <span class="icon">&#x1F3B9;</span>
        <h2>Explore Sounds</h2>
        <p>Play freely with the synthesiser. Discover what you like. Save and share your favourites.</p>
        <span class="badge">Open-ended</span>
      </a>
    </div>
  `);
  v.querySelector("#goStudy").onclick = () => navigate("study/consent");
  v.querySelector("#goExplore").onclick = () => navigate("explore");
}

// ─── Study: Consent ─────────────────────────────────────────

function renderStudyConsent() {
  studyResponses = [];
  studyIndex = 0;
  headphonePassed = false;

  const v = mount(`
    <div class="study-header">
      <h2>Study Information</h2>
      <button class="btn btn-ghost btn-sm" id="back">Back</button>
    </div>
    <div class="card">
      <h3 class="mb-2">What is this study?</h3>
      <div class="consent-text">
        <p>This study is part of a research programme investigating how people perceive and
        enjoy algorithmically generated sound. You will listen to short sound clips and
        indicate your preferences through simple tasks.</p>
        <h3>What will I do?</h3>
        <ul>
          <li>Answer a few background questions (~1 min)</li>
          <li>Complete a brief headphone check (~30 sec)</li>
          <li>Listen to sounds and indicate preferences (~8 min)</li>
        </ul>
        <h3>Data collected</h3>
        <p>We record your task responses (slider positions, choices), reaction times,
        and the background information you provide. No personally identifying information
        is collected. Your anonymous participant ID is stored locally in your browser.</p>
        <h3>Withdrawal</h3>
        <p>You may stop at any time by closing this page. Partial data will not be used.</p>
        <h3>Contact</h3>
        <p>For questions about this study, contact the research team.</p>
      </div>
      <div class="form-group">
        <label class="form-check">
          <input type="checkbox" id="consentCheck"/>
          <span>I have read the information above and consent to participate in this study.</span>
        </label>
      </div>
      <button class="btn btn-primary btn-lg btn-block" id="consentNext" disabled>Continue</button>
    </div>
  `);

  const check = v.querySelector("#consentCheck");
  const btn = v.querySelector("#consentNext");
  check.onchange = () => (btn.disabled = !check.checked);
  btn.onclick = () => { studyStartTime = Date.now(); navigate("study/demographics"); };
  v.querySelector("#back").onclick = () => navigate("");
}

// ─── Study: Demographics ────────────────────────────────────

function renderStudyDemographics() {
  const v = mount(`
    <div class="study-header">
      <h2>About You</h2>
      <span class="text-sm text-muted">Step 1 of 4</span>
    </div>
    ${progressBar(0.1)}
    <div class="card">
      <p class="mb-3 text-sm">Brief background to help us understand individual differences. All fields optional.</p>
      <div class="form-row">
        <div class="form-group">
          <label for="age">Age</label>
          <input class="form-input" id="age" type="number" min="13" max="120" placeholder="e.g. 28"/>
        </div>
        <div class="form-group">
          <label for="training">Years of musical training</label>
          <input class="form-input" id="training" type="number" min="0" max="80" placeholder="e.g. 5"/>
        </div>
      </div>
      <div class="form-group">
        <label for="listening">Hours of music listening per week</label>
        <select class="form-select" id="listening">
          <option value="">Select...</option>
          <option value="0-5">0 -- 5 hours</option>
          <option value="5-15">5 -- 15 hours</option>
          <option value="15-30">15 -- 30 hours</option>
          <option value="30+">30+ hours</option>
        </select>
      </div>
      <div class="form-group">
        <label for="genres">Primary genres you listen to</label>
        <input class="form-input" id="genres" type="text" placeholder="e.g. jazz, electronic, classical" maxlength="200"/>
      </div>
      <div class="form-group">
        <label for="country">Country of residence</label>
        <input class="form-input" id="country" type="text" placeholder="e.g. UK" maxlength="80"/>
      </div>
      <button class="btn btn-primary btn-lg btn-block mt-3" id="demoNext">Continue to headphone check</button>
    </div>
  `);

  v.querySelector("#demoNext").onclick = () => {
    studyDemographics = {
      age: v.querySelector("#age").value || null,
      training_years: v.querySelector("#training").value || null,
      listening_hours: v.querySelector("#listening").value || null,
      genres: v.querySelector("#genres").value || null,
      country: v.querySelector("#country").value || null,
    };
    navigate("study/headphones");
  };
}

// ─── Study: Headphone Check ─────────────────────────────────

function renderStudyHeadphones() {
  const trials = shuffled([
    { channel: "left", answer: "Left" },
    { channel: "right", answer: "Right" },
    { channel: "both", answer: "Both" },
  ]);
  let current = 0;
  let correct = 0;

  const v = mount(`
    <div class="study-header">
      <h2>Headphone Check</h2>
      <span class="text-sm text-muted">Step 2 of 4</span>
    </div>
    ${progressBar(0.2)}
    <div class="card">
      <p class="study-instruction">
        Please put on headphones. Press <strong>Play tone</strong>, then select which ear(s) you heard it in.
      </p>
      <div class="text-center mb-3">
        <button class="btn btn-primary btn-lg" id="playTone">Play tone</button>
      </div>
      <div class="headphone-grid" id="hpGrid">
        <button class="headphone-btn" data-answer="Left">Left ear</button>
        <button class="headphone-btn" data-answer="Both">Both ears</button>
        <button class="headphone-btn" data-answer="Right">Right ear</button>
      </div>
      <p class="text-center text-sm text-muted" id="hpStatus">Trial ${current + 1} of ${trials.length}</p>
    </div>
  `);

  const playBtn = v.querySelector("#playTone");
  const grid = v.querySelector("#hpGrid");
  const status = v.querySelector("#hpStatus");

  playBtn.onclick = () => {
    synth.init();
    const hc = new HeadphoneCheck(synth.ctx);
    hc.playTone(trials[current].channel, 0.8);
  };

  grid.onclick = (e) => {
    const btn = e.target.closest(".headphone-btn");
    if (!btn) return;
    const isCorrect = btn.dataset.answer === trials[current].answer;
    btn.classList.add(isCorrect ? "correct" : "wrong");
    if (isCorrect) correct++;
    current++;
    setTimeout(() => {
      if (current >= trials.length) {
        headphonePassed = correct >= 2;
        navigate("study/paradigm");
      } else {
        grid.querySelectorAll(".headphone-btn").forEach((b) => b.classList.remove("correct", "wrong"));
        status.textContent = `Trial ${current + 1} of ${trials.length}`;
      }
    }, 600);
  };
}

// ─── Study: Paradigm Choice ─────────────────────────────────

function renderStudyParadigmChoice() {
  const v = mount(`
    <div class="study-header">
      <h2>Choose Your Task</h2>
      <span class="text-sm text-muted">Step 3 of 4</span>
    </div>
    ${progressBar(0.3)}
    ${!headphonePassed ? '<div class="info-box mb-3"><p>Headphone check was not fully passed. You can still continue, but headphone use is strongly recommended for accurate results.</p></div>' : ""}
    <div class="landing-cards">
      <a class="landing-card" id="goSlider">
        <span class="icon">&#x1F39A;</span>
        <h2>Slider task</h2>
        <p>Adjust a control until the sound is as pleasing as possible. 9 short trials.</p>
        <span class="badge">~5 minutes</span>
      </a>
      <a class="landing-card" id="goPairwise">
        <span class="icon">&#x1F50A;</span>
        <h2>Comparison task</h2>
        <p>Listen to two sounds and pick the one you prefer. 12 quick trials.</p>
        <span class="badge">~5 minutes</span>
      </a>
    </div>
  `);

  v.querySelector("#goSlider").onclick = () => {
    studyParadigm = "slider";
    studyTrials = shuffled(SLIDER_TRIALS);
    studyIndex = 0;
    studyResponses = [];
    navigate("study/slider");
  };
  v.querySelector("#goPairwise").onclick = () => {
    studyParadigm = "pairwise";
    studyTrials = shuffled(PAIRWISE_TRIALS);
    studyIndex = 0;
    studyResponses = [];
    navigate("study/pairwise");
  };
}

// ─── Study: Slider Paradigm ─────────────────────────────────

function renderStudySlider() {
  if (studyIndex >= studyTrials.length) { navigate("study/debrief"); return; }

  const trial = studyTrials[studyIndex];
  const total = studyTrials.length;
  trialStartTime = Date.now();
  sliderTrajectory = [];

  const params = { ...STUDY_BASE, [trial.param]: trial.start, seed: 1000 + studyIndex };

  const v = mount(`
    <div class="study-header">
      <h2>Slider Task</h2>
      <span class="text-sm text-muted">Step 4 of 4</span>
    </div>
    ${progressBar(0.35 + (studyIndex / total) * 0.6)}
    <p class="study-instruction">
      Adjust <strong>${trial.label}</strong> until the sound is as pleasing as possible to you.
    </p>
    <div class="trial-slider-wrap">
      <div class="trial-slider-value" id="sliderVal">${fmt(trial.start)}</div>
      <input type="range" id="trialSlider"
             min="${trial.min}" max="${trial.max}" step="${trial.step}" value="${trial.start}"/>
      <div class="trial-slider-labels">
        <span>${trial.lo}</span>
        <span>${trial.hi}</span>
      </div>
    </div>
    <p class="text-center text-sm text-muted mb-3" id="trialInfo">
      Trial ${studyIndex + 1} of ${total} &mdash; sound is playing
    </p>
    <div class="text-center">
      <button class="btn btn-primary btn-lg" id="confirmBtn">Confirm my preference</button>
    </div>
  `);

  const slider = v.querySelector("#trialSlider");
  const valDisplay = v.querySelector("#sliderVal");

  synth.play(params);

  slider.oninput = () => {
    const val = Number(slider.value);
    valDisplay.textContent = fmt(val);
    sliderTrajectory.push({ t: Date.now() - trialStartTime, v: val });
    params[trial.param] = val;
    synth.play(params);
  };

  v.querySelector("#confirmBtn").onclick = () => {
    synth.stop();
    studyResponses.push({
      trial_index: studyIndex,
      paradigm: "slider",
      parameter: trial.param,
      initial_value: trial.start,
      final_value: Number(slider.value),
      rt_ms: Date.now() - trialStartTime,
      trajectory: sliderTrajectory,
      seed: params.seed,
    });
    studyIndex++;
    renderStudySlider();
  };
}

// ─── Study: Pairwise Paradigm ───────────────────────────────

function renderStudyPairwise() {
  if (studyIndex >= studyTrials.length) { navigate("study/debrief"); return; }

  const trial = studyTrials[studyIndex];
  const total = studyTrials.length;
  trialStartTime = Date.now();

  const swap = Math.random() < 0.5;
  const valA = swap ? trial.b : trial.a;
  const valB = swap ? trial.a : trial.b;
  const seedA = 2000 + studyIndex * 2;
  const seedB = 2000 + studyIndex * 2 + 1;
  const paramsA = { ...STUDY_BASE, [trial.param]: valA, seed: seedA };
  const paramsB = { ...STUDY_BASE, [trial.param]: valB, seed: seedB };

  let playsA = 0, playsB = 0;

  const v = mount(`
    <div class="study-header">
      <h2>Comparison Task</h2>
      <span class="text-sm text-muted">Step 4 of 4</span>
    </div>
    ${progressBar(0.35 + (studyIndex / total) * 0.6)}
    <p class="study-instruction">
      Listen to both sounds, then pick the one you prefer.
    </p>
    <div class="pairwise-row">
      <div class="pairwise-option" id="optA">
        <div class="label">A</div>
        <button class="btn btn-secondary" id="playA">Play A</button>
      </div>
      <div class="pairwise-or">or</div>
      <div class="pairwise-option" id="optB">
        <div class="label">B</div>
        <button class="btn btn-secondary" id="playB">Play B</button>
      </div>
    </div>
    <p class="text-center text-sm text-muted mb-3" id="pairInfo">
      Trial ${studyIndex + 1} of ${total} &mdash; play both sounds before choosing
    </p>
    <div class="pairwise-choices">
      <button class="btn btn-primary btn-lg" id="chooseA" disabled>I prefer A</button>
      <button class="btn btn-primary btn-lg" id="chooseB" disabled>I prefer B</button>
    </div>
  `);

  const chooseA = v.querySelector("#chooseA");
  const chooseB = v.querySelector("#chooseB");
  const optA = v.querySelector("#optA");
  const optB = v.querySelector("#optB");

  function enableChoices() {
    if (playsA > 0 && playsB > 0) { chooseA.disabled = false; chooseB.disabled = false; }
  }

  v.querySelector("#playA").onclick = () => {
    synth.stop();
    optA.classList.add("playing"); optB.classList.remove("playing");
    playsA++;
    synth.play(paramsA);
    enableChoices();
  };

  v.querySelector("#playB").onclick = () => {
    synth.stop();
    optB.classList.add("playing"); optA.classList.remove("playing");
    playsB++;
    synth.play(paramsB);
    enableChoices();
  };

  function choose(label) {
    synth.stop();
    studyResponses.push({
      trial_index: studyIndex,
      paradigm: "pairwise",
      parameter: trial.param,
      value_a: valA,
      value_b: valB,
      seed_a: seedA,
      seed_b: seedB,
      chosen: label,
      chosen_value: label === "A" ? valA : valB,
      rt_ms: Date.now() - trialStartTime,
      plays_a: playsA,
      plays_b: playsB,
    });
    studyIndex++;
    renderStudyPairwise();
  }

  chooseA.onclick = () => choose("A");
  chooseB.onclick = () => choose("B");
}

// ─── Study: Debrief ─────────────────────────────────────────

function renderStudyDebrief() {
  synth.stop();

  const payload = {
    participant_id: pid(),
    paradigm: studyParadigm,
    demographics: studyDemographics,
    headphone_passed: headphonePassed,
    responses: studyResponses,
    total_time_ms: Date.now() - studyStartTime,
    submitted_at: new Date().toISOString(),
  };

  fetch("/api/study/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});

  const v = mount(`
    <div class="complete-hero">
      <div class="icon">&#x2705;</div>
      <h1>Thank you!</h1>
      <p>Your responses have been recorded. You completed ${studyResponses.length} trials
         in ${Math.round((Date.now() - studyStartTime) / 1000)} seconds.</p>
    </div>
    <div class="card mb-3">
      <h3 class="mb-1">What happens next?</h3>
      <p class="text-sm">Your data contributes to mapping how people perceive
      algorithmically generated sound. Results from this population-scale study
      will inform the parameter design of future lab-based EEG experiments.</p>
    </div>
    <div class="card mb-3">
      <h3 class="mb-1">Want to explore more?</h3>
      <p class="text-sm mb-2">The Sound Studio lets you play freely with the same synthesis
      engine used in the study. Discover what you like and save your favourites.</p>
      <button class="btn btn-primary" id="goExplore">Open Sound Studio</button>
    </div>
    <div class="text-center mt-3">
      <button class="btn btn-ghost btn-sm" id="goHome">Return to start</button>
    </div>
  `);

  v.querySelector("#goExplore").onclick = () => navigate("explore");
  v.querySelector("#goHome").onclick = () => navigate("");
}

// ─── Explore Mode ───────────────────────────────────────────

function renderExplore() {
  const p = exploreParams;
  p.voiceMode = normaliseVoiceMode(p.voiceMode);
  syncSurpriseFeatureParams(p);
  ensureFormantWeights(p);
  if (!["melody", "tuning", "duration", "dynamics"].includes(macroTab)) macroTab = "melody";
  if (!["percussion", "space"].includes(productionTab)) productionTab = "percussion";

  // Ensure customDegrees is populated
  if (!p.customDegrees || p.customDegrees.length === 0) {
    if (p.scaleMode === "edo") {
      p.customDegrees = Array.from({ length: p.edoDivisions }, (_, i) => i);
    } else {
      const preset = SCALE_PRESETS[p.scalePreset] || SCALE_PRESETS.major;
      p.customDegrees = [...preset.degrees];
    }
  }
  // Ensure arrays
  if (!p.subScaleNotes) p.subScaleNotes = [];
  if (!p.activeFormants || p.activeFormants.length === 0) p.activeFormants = ["ah"];
  syncSurpriseFeatureParams(p);
  if (!Array.isArray(p.rootNotes)) p.rootNotes = [0];
  ensureSpectralPartialParams(p);

  const v = mount(`
    <div class="explore-dashboard${workspaceTab === 'subnote' ? ' subnote-workspace-mode' : ''}">
    <div class="explore-top">
      <div>
        <h1>Sound Studio <span class="build-tag" title="App version · asset build (bumps with every change)">${BUILD_TAG}</span></h1>
        <div class="studio-subtitle">Probabilistic Synthesiser</div>
      </div>
      <div class="workspace-tabs" id="workspaceTabs">
        <button class="workspace-tab${workspaceTab === 'explore' ? ' active' : ''}" data-workspace-tab="explore">Macro</button>
        <button class="workspace-tab${workspaceTab === 'subnote' ? ' active' : ''}" data-workspace-tab="subnote">Sub-note</button>
        <a class="workspace-tab workspace-link" href="#produce" title="Producer: arrange your instruments on a timeline (early preview)">Producer</a>
      </div>
    </div>

    ${paletteEditBannerHTML()}
    ${welcomeCardHTML()}

    <!-- Transport -->
    <div class="card transport-card">
      <div class="transport">
        <button class="transport-round transport-play${synth.isPlaying ? ' is-playing' : ''}" id="playBtn">${synth.isPlaying ? "❚❚" : "▶"}</button>
        <button class="transport-round transport-stop" id="stopBtn">■</button>
        <button class="btn btn-secondary rand-btn" id="randBtn">Randomise</button>
        <button class="btn btn-secondary" id="regenBtn" title="Rebuild the sequence from the start using the current parameters">↻ Restart seq</button>
        <div class="seed-box">
          <span>Seed</span>
          <button class="btn btn-ghost btn-sm" id="seedBtn">${p.seed}</button>
        </div>
      </div>
      <div class="top-save-bar">
        <input type="text" id="presetName" placeholder="Preset name" maxlength="80"/>
        <select id="presetScope" title="What the preset captures: the whole rig, or just one section to mix and match">
          <option value="full">Everything</option>
          ${Object.entries(PRESET_SECTIONS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-sm" id="saveBtn">Save</button>
      </div>
      <div class="top-rating-row">
        <span class="label">Rating</span>
        <input type="range" id="ratingSlider" min="1" max="7" step="1" value="${exploreRating}"/>
        <output id="ratingOut">${exploreRating}/7</output>
      </div>
      <div class="controls-grid tempo-grid">
        ${controlRow("tempo", "Tempo", p.tempo, 50, 180, 1)}
      </div>
      <div class="top-library-actions">
        <button class="top-action-btn" id="topMyPresets">My Presets</button>
        <button class="top-action-btn" id="topLibrary">Library</button>
      </div>
    </div>

    <!-- Frequency response dash -->
    <div class="visual-card" id="visualCard">
      <div class="visual-status">
        <div><span class="status-dot"></span>${VIS_MODE_LABEL[visMode] || "Frequency Response"}</div>
        <div class="surprise-status">Surprise Event</div>
        <div class="vis-mode-switch" id="visModeSwitch">
          <button class="vis-mode-btn${visMode === "spectrum" ? " active" : ""}" data-vismode="spectrum">Spec</button>
          <button class="vis-mode-btn${visMode === "motifs" ? " active" : ""}" data-vismode="motifs">Motif</button>
          <button class="vis-mode-btn${visMode === "pianoroll" ? " active" : ""}" data-vismode="pianoroll">Roll</button>
        </div>
      </div>
      <div class="visualiser-wrap vis-mode-${visMode}">
        <canvas id="vis" width="980" height="210"></canvas>
      </div>
      <div class="engine-state" id="engineState">
        <div class="stat">Motifs <span class="stat-val" id="statMotifs">&ndash;</span></div>
        <div class="stat">Sequence <span class="stat-val" id="statSeq">&ndash;</span></div>
        <div class="stat">Notes <span class="stat-val" id="statNotes">&ndash;</span></div>
      </div>
    </div>

    ${workspaceTab === 'subnote' ? subnoteWorkspaceHTML(p) : macroWorkspaceHTML(p)}

    <!-- Library -->
    <div class="card library-card" id="libraryCard">
      <div class="tabs">
        <button class="tab active" id="tabStarters">Starters</button>
        <button class="tab" id="tabMy">My presets</button>
        <button class="tab" id="tabInstruments">Instruments</button>
        <button class="tab" id="tabGlobal">Shared library</button>
      </div>
      <div class="library-filters" id="libraryFilters">
        <button class="filter-chip${libraryFilter === "all" ? " active" : ""}" data-filter="all">All</button>
        <button class="filter-chip${libraryFilter === "full" ? " active" : ""}" data-filter="full">Full rigs</button>
        ${[["percussive", "Percussive"], ["bass", "Bass"], ["atmos", "Atmos"], ["melody", "Melody"]].map(([k, label]) =>
          `<button class="filter-chip family-chip${libraryFilter === `family:${k}` ? " active" : ""}" data-filter="family:${k}">${label}</button>`).join("")}
        <select class="splits-filter" data-splits-filter title="Filter presets by number of splits (scale degrees per octave)">
          ${[["all", "Any splits"], ["5", "5 splits"], ["6", "6 splits"], ["7", "7 splits"], ["8+", "8+ splits"], ["12", "12 splits"], ["other", "Other"]].map(([k, label]) =>
            `<option value="${k}"${splitsFilter === k ? " selected" : ""}>${label}</option>`).join("")}
        </select>
        ${Object.entries(PRESET_SECTIONS).map(([k, s]) =>
          `<button class="filter-chip${libraryFilter === k ? " active" : ""}" data-filter="${k}">${s.label}</button>`).join("")}
      </div>
      <div id="starterPresets" class="preset-list"></div>
      <div id="myPresets" class="preset-list hidden"></div>
      <div id="instrumentList" class="preset-list hidden">
        <div class="instrument-actions">
          <button class="btn btn-secondary btn-sm" id="saveInstrumentBtn" title="Capture the current voice — sound, expression, sequence behaviour — as a named instrument. Tempo, key, and space stay with the session.">Save current voice as instrument</button>
        </div>
        <div id="instrumentEntries"></div>
      </div>
      <div id="globalPresets" class="preset-list hidden"></div>
    </div>

    <div class="card output-card">
      <div class="section-label">Output</div>
      <div class="output-layout">
        <div class="meter-stack">
          <div class="meter-pair">
            <span id="meterL"></span><span id="meterR"></span>
          </div>
          <div class="meter-labels">
            <span>0</span><span>-12</span><span>-24</span><span>-48</span>
          </div>
        </div>
        <div class="master-strip">
          <div class="section-label">Master</div>
          <div class="vertical-fader" id="masterFader" title="Master output level"><span></span></div>
          <output id="masterReadout">0.0 dB</output>
        </div>
        <div class="limiter-strip">
          <div class="section-label">Limiter</div>
          <button class="limiter-btn active" id="limiterBtn">On</button>
        </div>
      </div>
    </div>

    <div id="contributeArea"></div>
    <div class="research-note" id="researchNote"></div>
    </div>
  `);
  document.body.classList.add("explore-mode");
  document.title = "Sound Studio";

  // ── Wire up ──

  canvas = v.querySelector("#vis");
  canvasCtx = canvas.getContext("2d");

  // Responsive, high-DPI hero display: match the backing store to the CSS
  // size (capped at 2x DPR) and redraw whenever the layout changes.
  if (window.ResizeObserver) {
    if (_visResizeObserver) _visResizeObserver.disconnect();
    const fitVis = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        if (!synth.isPlaying) drawStaticVis();
      }
    };
    _visResizeObserver = new ResizeObserver(fitVis);
    _visResizeObserver.observe(canvas);
    fitVis();
  }

  const visModeSwitch = v.querySelector("#visModeSwitch");
  if (visModeSwitch) {
    visModeSwitch.onclick = (e) => {
      const btn = e.target.closest("[data-vismode]");
      if (!btn || btn.dataset.vismode === visMode) return;
      visMode = btn.dataset.vismode;
      visModeSwitch.querySelectorAll(".vis-mode-btn").forEach(b =>
        b.classList.toggle("active", b.dataset.vismode === visMode));
      // Resize canvas + relabel the status header
      const wrap = canvas.closest(".visualiser-wrap");
      if (wrap) wrap.className = `visualiser-wrap vis-mode-${visMode}`;
      const label = visModeSwitch.parentElement.querySelector(".status-dot")?.parentElement;
      if (label) label.innerHTML = `<span class="status-dot"></span>${VIS_MODE_LABEL[visMode] || "Frequency Response"}`;
      _pianoRange = null;
      if (synth.isPlaying) startVisualiser(); else drawStaticVis();
    };
  }

  wireOutputControls(v);

  const backBtn = v.querySelector("#backHome");
  if (backBtn) backBtn.onclick = () => { synth.stop(); navigate("home"); };
  v.querySelector("#workspaceTabs").onclick = (e) => {
    const btn = e.target.closest("[data-workspace-tab]");
    if (!btn || btn.dataset.workspaceTab === workspaceTab) return;
    const wasPlaying = synth.isPlaying;
    workspaceTab = btn.dataset.workspaceTab;
    renderExplore();
    if (wasPlaying) {
      synth.play({ ...exploreParams });
      startVisualiser();
    }
  };

  // Transport
  const playBtn = v.querySelector("#playBtn");
  const syncPlayButton = () => {
    if (!playBtn) return;
    playBtn.textContent = synth.isPlaying ? "❚❚" : "▶";
    playBtn.classList.toggle("is-playing", synth.isPlaying);
  };
  playBtn.onclick = () => {
    if (synth.isPlaying) {
      synth.stop();
      cancelAnimationFrame(animFrame);
      _markersActive = false;
      drawMacroDistsAll();   // clear any lingering live note-trace beam
      drawStaticVis();
      resetMeters();
      syncPlayButton();
      return;
    }
    lastSurpriseCount = 0;
    synth.play({ ...exploreParams });
    startVisualiser();
    syncPlayButton();
    trackEngagement("play");
  };
  const stopBtn = v.querySelector("#stopBtn");
  if (stopBtn) stopBtn.onclick = () => {
    synth.stop();
    cancelAnimationFrame(animFrame);
    _markersActive = false;
    drawMacroDistsAll();   // clear any lingering live note-trace beam
    drawStaticVis();
    resetMeters();
    syncPlayButton();
  };
  const regenBtn = v.querySelector("#regenBtn");
  if (regenBtn) regenBtn.onclick = () => {
    // Rebuild the Markov sequence from the start with the current params. If
    // already playing, do it seamlessly; otherwise start fresh.
    lastSurpriseCount = 0;
    if (synth.isPlaying) {
      synth.regenerate({ ...exploreParams });
    } else {
      synth.play({ ...exploreParams });
      startVisualiser();
      syncPlayButton();
    }
  };
  v.querySelector("#randBtn").onclick = () => {
    const wasPlaying = synth.isPlaying;
    randomiseParams();
    renderExplore();
    if (wasPlaying) {
      synth.play({ ...exploreParams });
      startVisualiser();
    }
  };
  v.querySelector("#seedBtn").onclick = () => {
    exploreParams.seed = Math.floor(Math.random() * 999999) + 1;
    v.querySelector("#seedBtn").textContent = `Seed: ${exploreParams.seed}`;
    debouncedReplay();
  };

  const macroTabs = v.querySelector("#macroTabs");
  if (macroTabs) {
    macroTabs.onclick = (e) => {
      const btn = e.target.closest("[data-macro-tab]");
      if (!btn || btn.dataset.macroTab === macroTab) return;
      const wasPlaying = synth.isPlaying;
      macroTab = btn.dataset.macroTab;
      renderExplore();
      if (wasPlaying) startVisualiser();
    };
  }

  // Param → { macroTab, section } mapping for auto-switching the active subsection
  const _paramToSection = {
    // Melody
    intervalPeakedness: { tab: "melody", section: "generation" },
    intervalRange:      { tab: "melody", section: "generation" },
    momentum:           { tab: "melody", section: "generation" },
    motifHitProb:       { tab: "melody", section: "accuracy" },
    motifHitRange:      { tab: "melody", section: "accuracy" },
    melSurpriseAmount:  { tab: "melody", section: "surprise" },
    surprisePitchDistance: { tab: "melody", section: "surprise" },
    // Tuning
    precision:          { tab: "tuning", section: "accuracy" },
    precisionRange:     { tab: "tuning", section: "accuracy" },
    tunSurpriseAmount:  { tab: "tuning", section: "surprise" },
    surpriseTuningDistance: { tab: "tuning", section: "surprise" },
    // Duration
    beatDivisions:      { tab: "duration", section: "generation" },
    sameLengthProb:     { tab: "duration", section: "generation" },
    onBeatProb:         { tab: "duration", section: "generation" },
    offBeatProb:        { tab: "duration", section: "generation" },
    restMotifStartRatio:{ tab: "duration", section: "generation" },
    restOnMeterRatio:   { tab: "duration", section: "generation" },
    restOffMeterRatio:  { tab: "duration", section: "generation" },
    durSurpriseAmount:  { tab: "duration", section: "surprise" },
    surpriseRhythmDistance: { tab: "duration", section: "surprise" },
    // Dynamics
    dynamicsRange:      { tab: "dynamics", section: "generation" },
    dynamicsPrecision:  { tab: "dynamics", section: "accuracy" },
    dynamicsHitRange:   { tab: "dynamics", section: "accuracy" },
    dynSurpriseAmount:  { tab: "dynamics", section: "surprise" },
    surpriseDynamicsDistance: { tab: "dynamics", section: "surprise" },
  };

  // All range sliders with data-param
  const distParams = new Set([
    "intervalPeakedness","intervalRange","momentum","rootPullStrength","rootPullShape",
    "registerCenter","registerWidth","registerSkew","gapProb","gapMin","gapMax",
    "gapDistanceSlope","gapTimingRange","slideSpeed","phraseGap","spectralProb","spectralMix",
    "spectralPartials","spectralDynamicAmount","spectralRegisterAmount","spectralResonanceAmount",
    "spectralLoudnessNorm","spectralDriftProb","spectralDriftDepth","spectralDriftRate","spectralStretchCents",
    "vibratoProb","vibratoDepth","vibratoDepthSd","vibratoRate","vibratoRateSd",
    "envelopeProb","envelopeAttack","envelopeAttackSd",
    "envelopeDecay","envelopeDecaySd","envelopeSustain","envelopeSustainSd",
    "envelopeRelease","envelopeReleaseSd","reverbWet","reverbDecay","reverbTone","reverbPreDelay",
    "motifHitProb","motifHitRange","precision","precisionRange","beatDivisions",
    "onBeatProb","offBeatProb","sameLengthProb","restMotifStartRatio","restOnMeterRatio","restOffMeterRatio",
    "dynamicsLevel","loudnessRange","dynamicsPrecision","dynamicsRange","formantChangeProb",
    "surprisePitchWeight","surpriseTuningWeight","surpriseRhythmWeight","surpriseFormantWeight",
    "surpriseDynamicsWeight","surpriseRestWeight",
    "surprisePitchDistance","surpriseTuningDistance","surpriseRhythmDistance",
    "surpriseFormantDistance","surpriseDynamicsDistance",
    "melSurpriseAmount","tunSurpriseAmount","durSurpriseAmount","dynSurpriseAmount",
    "dynamicsHitRange"
  ]);
  const harmonicParams = new Set([
    "spectralProfile","spectralPartials","spectralDynamicAmount","spectralRegisterAmount",
    "spectralResonanceAmount","spectralLoudnessNorm","spectralStretchCents",
  ]);
  const liveReverbParams = new Set([
    "reverbWet","reverbDecay","reverbTone","reverbPreDelay",
    // Q4 binaural head — listener properties apply live through the same
    // space configure as position (the pad already routes updateReverb)
    "earDistance","headDensity",
  ]);
  const liveSubnoteParams = new Set([
    // Melody-generation shaping: changing these continues the current Markov
    // sequence (incorporating the new params into freshly generated material)
    // instead of restarting from the top. Use "Restart seq" to hear the full
    // from-scratch effect.
    "intervalPeakedness","intervalRange","momentum","registerCenter","registerWidth","registerSkew",
    "melodyPattern","arpStep","arpOctaves",
    "rootPullStrength","rootPullShape",
    "surpriseProb","incorporationRate","surpriseMaxBaked","motifSurpriseProb",
    "surprisePitchWeight","surpriseTuningWeight","surpriseRhythmWeight","surpriseFormantWeight",
    "surpriseDynamicsWeight","surpriseRestWeight",
    "surprisePitchDistance","surpriseTuningDistance","surpriseRhythmDistance",
    "surpriseFormantDistance","surpriseDynamicsDistance",
    "gapProb","gapMin","gapMax","gapDistanceSlope","gapTimingRange","slideSpeed","phraseGap","noteConnection",
    "restMotifStartRatio","restOnMeterRatio","restOffMeterRatio",
    "dynamicsLevel","loudnessRange","dynamicsPrecision","dynamicsRange","formantChangeProb",
    "toneColorProb","toneFormantDrift","toneResonanceDrift","toneBreath",
    "vibratoProb","vibratoDepth","vibratoDepthSd","vibratoRate","vibratoRateSd",
    "spectralProb","spectralMix","spectralPartials","spectralDynamicAmount","partialMaterial",
    "excitationType","excitationPosition","excitationHardness","excitationHuman","partialTransfer","bodyType","partialB","attackNoiseLevel",
    "partialTilt","partialOddEven","partialComb","partialCombFreq",
    "partialGroup1","partialGroup2","partialGroup3","partialGroup4","partialGroup5","partialGroup6",
    "formantF1Level","formantF2Level","formantF3Level","formantF4Level","formantF5Level","formantBandwidth","bodyArticulation",
    "spectralRegisterAmount","spectralResonanceAmount","spectralLoudnessNorm",
    "spectralDriftProb","spectralDriftDepth","spectralDriftRate","spectralStretchCents",
    "envelopeProb","envelopeAttack","envelopeAttackSd","envelopeDecay","envelopeDecaySd",
    "envelopeSustain","envelopeSustainSd","envelopeRelease","envelopeReleaseSd"
  ]);
  v.querySelectorAll("input[type=range][data-param]").forEach(sl => {
    updateSliderFill(sl);
    sl.oninput = () => {
      const key = sl.dataset.param;
      noteParamChange(key, exploreParams[key], Number(sl.value));
      exploreParams[key] = Number(sl.value);
      updateSliderFill(sl);
      // Auto-switch active macro subsection when a slider in that section is moved
      const sectionInfo = _paramToSection[key];
      if (sectionInfo && macroSubTab[sectionInfo.tab] !== sectionInfo.section) {
        macroSubTab[sectionInfo.tab] = sectionInfo.section;
        // Update subsection active classes in-place (no full re-render)
        const panel = sl.closest(".macro-panel");
        if (panel) {
          panel.querySelectorAll(".macro-subsection").forEach(sec => {
            sec.classList.toggle("active", sec.dataset.section === sectionInfo.section);
          });
        }
      }
      if (key.startsWith("surprise")) syncSurpriseFeatureParams(exploreParams);
      const out = v.querySelector(`#out_${key}`);
      if (out) out.textContent = fmtOutput(key, sl.value);
      if (harmonicParams.has(key)) syncHarmonicWorkspace(v);
      if (distParams.has(key)) drawDistributions();
      if (liveReverbParams.has(key)) {
        synth.updateReverb({ ...exploreParams });
        return;
      }
      if (liveSubnoteParams.has(key)) {
        synth.updateGenerationParams({ ...exploreParams });
        return;
      }
      debouncedReplay();
    };
  });
  // Also apply to any non-data-param sliders (rating, etc.)
  v.querySelectorAll("input[type=range]:not([data-param])").forEach(sl => updateSliderFill(sl));

  // Production tabs
  const productionTabs = v.querySelector("#productionTabs");
  if (productionTabs) productionTabs.onclick = (e) => {
    const btn = e.target.closest("[data-production-tab]");
    if (!btn || btn.dataset.productionTab === productionTab) return;
    const wasPlaying = synth.isPlaying;
    productionTab = btn.dataset.productionTab;
    renderExplore();
    if (wasPlaying) startVisualiser();
  };

  // Parameter selectors
  v.querySelectorAll("select[data-param-select]").forEach(sel => {
    sel.value = exploreParams[sel.dataset.paramSelect];
    sel.onchange = () => {
      const key = sel.dataset.paramSelect;
      noteParamChange(key, exploreParams[key], sel.value);
      exploreParams[key] = sel.value;
      if (key === "spectralProfile") resetSpectralPartialParams(exploreParams);
      const out = v.querySelector(`#out_${key}`);
      if (out) out.textContent = fmtOutput(key, sel.value);
      if (harmonicParams.has(key)) syncHarmonicWorkspace(v);
      drawDistributions();
      if (key === "reverbType") {
        synth.updateReverb({ ...exploreParams });
        return;
      }
      if (key === "spectralProfile" || key === "bodyType") {
        // preset semantics: choosing a body (or, on auto, an instrument)
        // re-seeds the editable band list; edits made after that persist
        if (key === "bodyType" || (exploreParams.bodyType || "auto") === "auto") {
          delete exploreParams.bodyBands;
          _chBodySel = null;
        }
        synth.updateGenerationParams({ ...exploreParams });
        // Profile changes re-seat performance defaults; bodyType swaps the
        // BODY inspector between static and articulated layouts.
        renderExplore();
        return;
      }
      if (liveSubnoteParams.has(key)) {
        synth.updateGenerationParams({ ...exploreParams });
        return;
      }
      debouncedReplay();
    };
  });

  const harmonicEditor = v.querySelector("#harmonicEditor");
  if (harmonicEditor) {
    harmonicEditor.oninput = (e) => {
      const sl = e.target.closest("input[data-harmonic-param]");
      if (!sl) return;
      ensureSpectralPartialParams(exploreParams);
      const idx = Number(sl.dataset.harmonicIndex);
      const kind = sl.dataset.harmonicParam;
      const value = Number(sl.value);
      if (kind === "mean") exploreParams.spectralPartialMeans[idx] = value;
      if (kind === "sd") exploreParams.spectralPartialSds[idx] = value;
      if (kind === "dyn") exploreParams.spectralPartialDyns[idx] = value;
      if (kind === "reg") exploreParams.spectralPartialRegs[idx] = value;
      const out = v.querySelector(`[data-harmonic-out="${kind}-${idx}"]`);
      if (out) out.textContent = harmonicValueLabel(kind, value);
      drawDistributions();
      synth.updateGenerationParams({ ...exploreParams });
    };
  }

  wireTonePrint(v);
  wireSpacePad(v);
  wireLayerStrip(v);

  // Rotary knobs (tone chain): vertical drag, shift = fine, double-click
  // resets to the stage default. Every change lights up the overlay it
  // controls in the tone print (comb / ridge / afterglow / arcs).
  v.querySelectorAll("[data-knob]").forEach(cell => {
    const key = cell.dataset.knob;
    const min = Number(cell.dataset.min), max = Number(cell.dataset.max), step = Number(cell.dataset.step);
    const applyKnob = (raw) => {
      let val = clamp(raw, min, max);
      val = clamp(Number((Math.round(val / step) * step).toFixed(6)), min, max);
      if (exploreParams[key] === val) return;
      noteParamChange(key, exploreParams[key], val);
      exploreParams[key] = val;
      _setKnobVisual(cell, (val - min) / (max - min));
      const out = cell.querySelector(".knob-out");
      if (out) out.textContent = fmtOutput(key, val);
      printEmphasis(key);
      drawDistributions();
      if (key === "bodyArticulation") {
        synth.updateGenerationParams({ ...exploreParams });
        const block = v.querySelector(".ch-artic");
        if ((val > 0) !== !!block) { renderExplore(); return; } // vowel controls appear/disappear at 0
        drawTonePrint();
        return;
      }
      if (liveReverbParams.has(key)) { synth.updateReverb({ ...exploreParams }); return; }
      if (liveSubnoteParams.has(key)) { synth.updateGenerationParams({ ...exploreParams }); return; }
      debouncedReplay();
    };
    cell.onmousedown = (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const cur = exploreParams[key];
      const startVal = Number.isFinite(cur) ? cur : Number(cell.dataset.def);
      const move = (ev) => applyKnob(startVal + (startY - ev.clientY) * (max - min) / (ev.shiftKey ? 1400 : 160));
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    cell.ondblclick = () => applyKnob(Number(cell.dataset.def));
  });

  // BODY band chips: click a band to see its EQ curve alone in the field;
  // the slider makes that band more or less extreme. Base-band edits copy
  // the preset's bands onto the instrument first (preset stays a preset).
  v.querySelectorAll("[data-body-band]").forEach(btn => {
    btn.onclick = () => {
      const [kind, iStr] = btn.dataset.bodyBand.split(":");
      const i = Number(iStr);
      _chBodySel = (_chBodySel && _chBodySel.kind === kind && _chBodySel.i === i) ? null : { kind, i };
      renderExplore();
    };
  });
  const bandSlider = v.querySelector("[data-body-gain]");
  if (bandSlider) bandSlider.oninput = () => {
    if (!_chBodySel) return;
    const val = Number(bandSlider.value);
    if (_chBodySel.kind === "artic") {
      const key = `formantF${_chBodySel.i + 1}Level`;
      noteParamChange(key, exploreParams[key], val);
      exploreParams[key] = val;
    } else {
      if (!Array.isArray(exploreParams.bodyBands) || !exploreParams.bodyBands.length) {
        exploreParams.bodyBands = currentBaseBodyBands(exploreParams).map(b => ({ ...b }));
      }
      const band = exploreParams.bodyBands[_chBodySel.i];
      if (band) band.gain = val;
    }
    const out = v.querySelector("#bodyBandOut");
    if (out) out.textContent = _chBodySel.kind === "artic" ? `×${val.toFixed(2)}` : `${val >= 0 ? "+" : ""}${val.toFixed(2)}`;
    printEmphasis("spectralResonanceAmount");
    synth.updateGenerationParams({ ...exploreParams });
    drawTonePrint();
    drawBodyRidge();
  };
  if (bandSlider) bandSlider.onchange = () => renderExplore(); // drag done: refresh chips + ↺ preset affordance
  // CH-B2: draggable ADSR — grab the attack peak, the decay→sustain
  // corner (vertical = sustain level) or the release foot. Scale is
  // frozen at drag start so the mapping stays stable under the cursor.
  v.querySelectorAll(".adsr-edit").forEach(cv => {
    cv.style.touchAction = "none";
    cv.onmousedown = (e) => {
      const rect = cv.getBoundingClientRect();
      const w = rect.width, h = rect.height, pad = w > 220 ? 12 : 5;
      const P = () => ({
        a: exploreParams.envelopeAttack || 0.008,
        d: exploreParams.envelopeDecay || 0.04,
        s: clamp(exploreParams.envelopeSustain ?? 0.6, 0.05, 1),
        r: exploreParams.envelopeRelease || 0.08,
      });
      const start = P();
      const pts = envelopePoints(w, h, pad, start.a, start.d, start.s, start.r);
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const hit = [
        { key: "attack", x: pts[1][0], y: pts[1][1] },
        { key: "decay", x: pts[2][0], y: pts[2][1] },
        { key: "release", x: pts[3][0], y: pts[3][1] },
      ].map(o => ({ ...o, dist: Math.hypot(o.x - mx, o.y - my) }))
        .sort((q, z) => q.dist - z.dist)[0];
      if (!hit || hit.dist > 22) return;
      e.preventDefault();
      const total0 = Math.max(0.08, start.a + start.d + start.r + 0.24);
      const usableW = w - pad * 2;
      const perPx = total0 / usableW;      // seconds per pixel at drag start
      const move = (ev) => {
        const dx = (ev.clientX - e.clientX) * perPx;
        const dy = (ev.clientY - e.clientY) / Math.max(20, h - pad * 2 - 4);
        const upd = {};
        if (hit.key === "attack") upd.envelopeAttack = clamp(start.a + dx, 0.001, 0.6);
        if (hit.key === "decay") {
          upd.envelopeDecay = clamp(start.d + dx, 0.005, 0.8);
          upd.envelopeSustain = clamp(start.s - dy, 0.05, 1);
        }
        if (hit.key === "release") upd.envelopeRelease = clamp(start.r - dx, 0.005, 1.2);
        for (const [key, val] of Object.entries(upd)) {
          exploreParams[key] = +val.toFixed(3);
          const out = v.querySelector(`#out_${key}`);
          if (out) out.textContent = fmtOutput(key, exploreParams[key]);
          const sl = v.querySelector(`input[data-param="${key}"]`);
          if (sl) { sl.value = exploreParams[key]; updateSliderFill(sl); }
        }
        drawEnvelopeDist();
        synth.updateGenerationParams({ ...exploreParams });
      };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
  });
  const perfDetails = v.querySelector("#chPerfDetails");
  if (perfDetails) perfDetails.ontoggle = () => { _chPerfOpen = perfDetails.open; };

  const bandReset = v.querySelector("[data-body-reset]");
  if (bandReset) bandReset.onclick = () => {
    noteParamChange("bodyBands", "edited", "preset");
    delete exploreParams.bodyBands;
    _chBodySel = null;
    synth.updateGenerationParams({ ...exploreParams });
    renderExplore();
  };

  // Melody pattern segmented control (walk vs deterministic arp cycles)
  v.querySelectorAll("[data-melody-pattern]").forEach(btn => {
    btn.onclick = () => {
      const val = btn.dataset.melodyPattern;
      if ((exploreParams.melodyPattern || "walk") === val) return;
      noteParamChange("melodyPattern", exploreParams.melodyPattern, val);
      exploreParams.melodyPattern = val;
      synth.updateGenerationParams({ ...exploreParams });
      renderExplore(); // walk dials ↔ arp dials swap
    };
  });

  // Note connection segmented control (glide vs ring on overlap)
  v.querySelectorAll("[data-note-connection]").forEach(btn => {
    btn.onclick = () => {
      const val = btn.dataset.noteConnection;
      if ((exploreParams.noteConnection || "glide") === val) return;
      noteParamChange("noteConnection", exploreParams.noteConnection, val);
      exploreParams.noteConnection = val;
      synth.updateGenerationParams({ ...exploreParams });
      renderExplore(); // slide-speed dial appears only for glide
    };
  });

  // Excite segmented control (the four physical drive types)
  v.querySelectorAll("[data-exc-type]").forEach(btn => {
    btn.onclick = () => {
      const val = btn.dataset.excType;
      if (exploreParams.excitationType === val) return;
      noteParamChange("excitationType", exploreParams.excitationType, val);
      exploreParams.excitationType = val;
      v.querySelectorAll("[data-exc-type]").forEach(b => b.classList.toggle("active", b === btn));
      printEmphasis("excitationType");
      drawDistributions();
      synth.updateGenerationParams({ ...exploreParams });
    };
  });

  // Checkbox param → section mapping for auto-switch
  const _checkToSection = {
    surpriseRestEnabled: { tab: "duration", section: "surprise" },
    surprisePitchEnabled: { tab: "melody", section: "surprise" },
    surpriseTuningEnabled: { tab: "tuning", section: "surprise" },
    surpriseRhythmEnabled: { tab: "duration", section: "surprise" },
    surpriseDynamicsEnabled: { tab: "dynamics", section: "surprise" },
  };
  v.querySelectorAll("input[type=checkbox][data-param-check]").forEach(cb => {
    cb.onchange = () => {
      const key = cb.dataset.paramCheck;
      const wasPlaying = synth.isPlaying;
      noteParamChange(key, exploreParams[key], cb.checked);
      exploreParams[key] = cb.checked;
      // Auto-switch active subsection
      const secInfo = _checkToSection[key];
      if (secInfo && macroSubTab[secInfo.tab] !== secInfo.section) {
        macroSubTab[secInfo.tab] = secInfo.section;
      }
      syncSurpriseFeatureParams(exploreParams);
      cb.checked = !!exploreParams[key];
      if ((key.startsWith("surprise") && key.endsWith("Enabled")) || key === "formantEditAll") {
        renderExplore();
        if (wasPlaying) {
          synth.play({ ...exploreParams });
          startVisualiser();
        }
        return;
      }
      drawDistributions();
      synth.updateGenerationParams({ ...exploreParams });
    };
  });

  // Scale mode toggle
  const scaleModeGroup = v.querySelector("#scaleModeGroup");
  if (scaleModeGroup) scaleModeGroup.onclick = (e) => {
    const btn = e.target.closest(".mode-btn");
    if (!btn) return;
    const mode = btn.dataset.smode;
    if (mode === exploreParams.scaleMode) return;
    exploreParams.scaleMode = mode;
    if (mode === "edo") {
      exploreParams.customDegrees = Array.from({ length: exploreParams.edoDivisions }, (_, i) => i);
    } else {
      const preset = SCALE_PRESETS[exploreParams.scalePreset] || SCALE_PRESETS.major;
      exploreParams.customDegrees = [...preset.degrees];
    }
    exploreParams.subScaleNotes = [];
    renderExplore();
    if (synth.isPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
  };

  // Preset dropdown (12-tone mode)
  const presetSel = v.querySelector("#scalePresetSelect");
  if (presetSel) {
    presetSel.onchange = () => {
      exploreParams.scalePreset = presetSel.value;
      const preset = SCALE_PRESETS[presetSel.value] || SCALE_PRESETS.major;
      exploreParams.customDegrees = [...preset.degrees];
      exploreParams.subScaleNotes = exploreParams.subScaleNotes.filter(d => preset.degrees.includes(d));
      rerenderNoteGrid(v);
      syncRootNotesWithScale(v);
      debouncedReplay();
    };
  }

  // EDO divisions input
  const edoInput = v.querySelector("#edoDivisionsInput");
  if (edoInput) {
    edoInput.onchange = () => {
      const val = Math.max(3, Math.min(48, parseInt(edoInput.value) || 12));
      edoInput.value = val;
      exploreParams.edoDivisions = val;
      exploreParams.customDegrees = Array.from({ length: val }, (_, i) => i);
      exploreParams.subScaleNotes = [];
      rerenderNoteGrid(v);
      syncRootNotesWithScale(v);
      debouncedReplay();
    };
  }

  // Note grid clicks
  const noteGridContainer = v.querySelector("#noteGridContainer");
  if (noteGridContainer) noteGridContainer.onclick = (e) => {
    const cell = e.target.closest(".note-cell");
    if (!cell) return;
    handleNoteGridClick(cell);
    syncRootNotesWithScale(v);
  };

  // Formant chips
  const formantChips = v.querySelector("#formantChips");
  if (formantChips) {
    formantChips.onclick = (e) => {
      const chip = e.target.closest(".formant-chip");
      if (!chip || chip.disabled) return;
      const f = chip.dataset.formant;
      if (chip.classList.contains("active")) {
        if (exploreParams.activeFormants.length > 1) {
          exploreParams.activeFormants = exploreParams.activeFormants.filter(x => x !== f);
          chip.classList.remove("active");
        }
      } else {
        exploreParams.activeFormants.push(f);
        chip.classList.add("active");
      }
      ensureFormantWeights(exploreParams);
      v.querySelectorAll("input[data-formant-weight]").forEach(input => {
        const active = exploreParams.activeFormants.includes(input.dataset.formantWeight);
        input.disabled = !active;
        input.closest(".formant-weight")?.classList.toggle("disabled", !active);
      });
      updateFormantWeightCircle(v);
      drawDistributions();
      debouncedReplay();
    };
  }

  v.querySelectorAll("input[data-formant-weight]").forEach(sl => {
    sl.oninput = () => {
      ensureFormantWeights(exploreParams);
      const key = sl.dataset.formantWeight;
      exploreParams.formantWeights[key] = Number(sl.value);
      const out = v.querySelector(`[data-formant-weight-out="${key}"]`);
      if (out) out.textContent = `${Math.round(Number(sl.value) * 100)}%`;
      updateFormantWeightCircle(v);
      drawDistributions();
      synth.updateGenerationParams({ ...exploreParams });
    };
  });
  updateFormantWeightCircle(v);

  v.querySelectorAll("input[data-formant-scope]").forEach(sl => {
    sl.oninput = () => {
      ensureFormantWeights(exploreParams);
      const param = sl.dataset.formantScope;
      const value = Number(sl.value);
      applyFormantScopedParam(param, value);
      const out = v.querySelector(`[data-formant-scope-out="${param}"]`);
      if (out) out.textContent = fmtOutput(param, value);
      drawDistributions();
      synth.updateGenerationParams({ ...exploreParams });
    };
  });

  // Sound source mode
  const voiceModeGroup = v.querySelector("#voiceModeGroup");
  if (voiceModeGroup) {
    voiceModeGroup.onclick = (e) => {
      const btn = e.target.closest(".mode-btn");
      if (!btn || btn.dataset.vmode === exploreParams.voiceMode) return;
      const wasPlaying = synth.isPlaying;
      exploreParams.voiceMode = normaliseVoiceMode(btn.dataset.vmode);
      renderExplore();
      if (wasPlaying) {
        synth.play({ ...exploreParams });
        startVisualiser();
      }
    };
  }

  // Percussion sound selectors
  v.querySelectorAll("select[data-perc]").forEach(sel => {
    sel.onchange = () => {
      exploreParams[sel.dataset.perc] = sel.value;
      debouncedReplay();
    };
  });

  // Rating
  const ratingSlider = v.querySelector("#ratingSlider");
  const ratingOut = v.querySelector("#ratingOut");
  ratingSlider.oninput = () => {
    exploreRating = Number(ratingSlider.value);
    ratingOut.textContent = `${exploreRating}/7`;
  };
  // Log the committed rating (on release, not every tick) against the
  // stimulus most recently heard, with how long after play-start it landed.
  ratingSlider.onchange = () => {
    trackEngagement("rate", {
      rating_latency_ms: lastPlayStartedAt ? Date.now() - lastPlayStartedAt : null,
    });
  };

  // Welcome / research opt-in card
  wireWelcomeCard(v);

  // Palette-instrument editing round-trip (producer v2 P6)
  wirePaletteEditBanner(v);

  // Hover readouts on the probability displays
  wireDistHover(v);

  // Per-panel section preset bars
  wirePanelPresetBars(v);

  // Save preset (full rig or a single section)
  v.querySelector("#saveBtn").onclick = () => {
    const name = v.querySelector("#presetName").value.trim() || `Preset ${new Date().toLocaleTimeString()}`;
    const scope = v.querySelector("#presetScope")?.value || "full";
    const entry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      name,
      section: scope,
      rating: exploreRating,
      parameters: scope === "full" ? { ...exploreParams } : extractSectionParams(exploreParams, scope),
      ...(scope === "full" ? { stimulus_id: stimulusIdFor(exploreParams) } : {}),
      app_version: APP_VERSION,
    };
    const list = loadPresets();
    list.unshift(entry);
    savePresets(list);
    renderPresetList(v.querySelector("#myPresets"), loadPresets(), "my");
    trackEngagement("save");
    maybeShowContribute(v);
  };

  // Library tabs
  const tabStarters = v.querySelector("#tabStarters");
  const tabMy = v.querySelector("#tabMy");
  const tabInstruments = v.querySelector("#tabInstruments");
  const tabGlobal = v.querySelector("#tabGlobal");
  const starterList = v.querySelector("#starterPresets");
  const myList = v.querySelector("#myPresets");
  const instrumentList = v.querySelector("#instrumentList");
  const globalList = v.querySelector("#globalPresets");
  const libraryCard = v.querySelector("#libraryCard");
  const tabsAndLists = [
    [tabStarters, starterList], [tabMy, myList],
    [tabInstruments, instrumentList], [tabGlobal, globalList],
  ];
  const showLibraryTab = (activeTab) => {
    for (const [tab, list] of tabsAndLists) {
      tab.classList.toggle("active", tab === activeTab);
      list.classList.toggle("hidden", tab !== activeTab);
    }
    libraryCard?.classList.add("is-open");
  };

  tabStarters.onclick = () => showLibraryTab(tabStarters);
  tabMy.onclick = () => showLibraryTab(tabMy);
  tabInstruments.onclick = () => showLibraryTab(tabInstruments);
  tabGlobal.onclick = async () => {
    showLibraryTab(tabGlobal);
    await loadGlobalPresets(globalList);
  };

  // Instruments: capture the current voice (session context excluded)
  const saveInstrumentBtn = v.querySelector("#saveInstrumentBtn");
  if (saveInstrumentBtn) saveInstrumentBtn.onclick = () => {
    const name = prompt("Name this instrument:");
    if (!name || !name.trim()) return;
    const list = loadInstruments();
    list.unshift({
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      name: name.trim().slice(0, 80),
      app_version: APP_VERSION,
      parameters: extractInstrumentParams(exploreParams),
    });
    saveInstruments(list);
    trackEngagement("save");
    renderInstrumentTab(v);
  };
  renderInstrumentTab(v);
  const topMyPresets = v.querySelector("#topMyPresets");
  if (topMyPresets) topMyPresets.onclick = () => tabMy.click();
  const topLibrary = v.querySelector("#topLibrary");
  if (topLibrary) topLibrary.onclick = () => tabGlobal.click();

  // Section filter chips (shared across all library tabs)
  const libraryFilters = v.querySelector("#libraryFilters");
  if (libraryFilters) {
    libraryFilters.onclick = (e) => {
      const chip = e.target.closest("[data-filter]");
      if (!chip) return;
      libraryFilter = chip.dataset.filter;
      libraryFilters.querySelectorAll(".filter-chip").forEach(c =>
        c.classList.toggle("active", c === chip));
      renderPresetList(starterList, FACTORY_PRESETS, "starter");
      renderPresetList(myList, loadPresets(), "my");
      if (!globalList.classList.contains("hidden")) loadGlobalPresets(globalList);
    };
    const librarySplits = libraryFilters.querySelector("[data-splits-filter]");
    if (librarySplits) librarySplits.onchange = () => {
      splitsFilter = librarySplits.value;
      renderPresetList(starterList, FACTORY_PRESETS, "starter");
      renderPresetList(myList, loadPresets(), "my");
      if (!globalList.classList.contains("hidden")) loadGlobalPresets(globalList);
    };
  }

  // Initial renders
  renderPresetList(starterList, FACTORY_PRESETS, "starter");
  renderPresetList(myList, loadPresets(), "my");
  maybeShowContribute(v);
  syncHarmonicWorkspace(v);
  applySubnoteModeState(v);
  decorateTooltips(v);
  drawStaticVis();
  drawDistributions();
}

function macroWorkspaceHTML(p) {
  return `
    <div class="card scale-card">
      <div class="section-label">Scale & Root</div>
      ${panelPresetBarHTML("melody")}
      <div class="mode-btns" id="scaleModeGroup">
        <button class="mode-btn${p.scaleMode !== 'edo' ? ' active' : ''}" data-smode="12tone">12-tone</button>
        <button class="mode-btn${p.scaleMode === 'edo' ? ' active' : ''}" data-smode="edo">N-EDO</button>
      </div>
      <div id="scaleOptions">
        ${p.scaleMode !== 'edo' ? `
          <div class="scale-preset-row">
            <label class="text-sm">Preset
              <select id="scalePresetSelect" class="form-select" style="width:auto;display:inline-block;margin-left:0.5rem">
                ${Object.entries(SCALE_PRESETS).map(([k, v]) =>
                  `<option value="${k}" ${p.scalePreset === k ? 'selected' : ''}>${v.label}</option>`
                ).join('')}
              </select>
            </label>
          </div>
        ` : `
          <div class="edo-row">
            <span class="text-sm" style="color:var(--text2)">Divisions:</span>
            <input type="number" id="edoDivisionsInput" class="edo-input"
                   min="3" max="48" value="${p.edoDivisions}"/>
          </div>
        `}
      </div>
      <div id="noteGridContainer">${buildNoteGridHTML(p)}</div>
      <div class="note-grid-legend">
        <div class="legend-item"><div class="legend-dot off"></div> Off</div>
        <div class="legend-item"><div class="legend-dot scale"></div> In scale</div>
        <div class="legend-item"><div class="legend-dot sub"></div> Sub-scale</div>
        <div class="legend-item"><div class="legend-dot root"></div> Root</div>
      </div>
      <div class="section-subhead">Root Pull</div>
      <div class="controls-grid root-controls">
        ${controlRow("subScaleWeight", "Sub-scale weight", p.subScaleWeight, 0.5, 1.0, 0.01)}
        ${controlRow("rootPullStrength", "Root pull", p.rootPullStrength, 0, 1, 0.01)}
        ${controlRow("rootPullShape", "Pull shape", p.rootPullShape, 0, 1, 0.01)}
      </div>
      <div class="dist-display" id="distRoot">
        <canvas class="dist-canvas" id="cvRoot" width="240" height="72"></canvas>
        <span class="dist-label">Root pull</span>
      </div>
    </div>

    <div class="card macro-card">
      <div class="macro-card-head">
        <div>
          <div class="section-label">Macro Probability</div>
        </div>
        <div class="macro-tabs" id="macroTabs">
          ${macroTabButton("melody", "Melody")}
          ${macroTabButton("tuning", "Tuning")}
          ${macroTabButton("duration", "Duration")}
          ${macroTabButton("dynamics", "Dynamics")}
        </div>
      </div>
      ${macroPanelHTML(p)}
    </div>

    <div class="card structure-card">
      <div class="section-label">Markov Sequence &amp; Surprise</div>
      ${panelPresetBarHTML("surprise")}
      <div class="section-subhead">Sequence</div>
      <div class="controls-grid">
        ${controlRow("motifCount", "Motif states", p.motifCount, 1, 8, 1)}
        ${controlRow("motifLengthBeats", "Loop length (beats)", p.motifLengthBeats, 1, 16, 1)}
        ${controlRow("sequenceProb", "Order bias", p.sequenceProb, 0, 1, 0.01)}
        ${controlRow("motifSurpriseProb", "Motif mutation", p.motifSurpriseProb, 0, 1, 0.01)}
      </div>
      <div class="sequence-divider"></div>
      <div class="section-subhead">Surprise</div>
      <div class="controls-grid">
        ${controlRow("surpriseProb", "Surprise chance (per note)", p.surpriseProb, 0, 1, 0.01)}
        ${controlRow("incorporationRate", "Incorporation chance", p.incorporationRate, 0, 1, 0.01)}
        ${selectControlRow("surpriseMaxBaked", "Max incorporated surprises", p.surpriseMaxBaked, bakedSurpriseOptions(p.surpriseMaxBaked))}
      </div>
      ${checkboxControl("surpriseAllowMultiple", "Multiple features / note", p.surpriseAllowMultiple)}
      ${surpriseWeightControlsHTML(p)}
    </div>

    <div class="card production-card">
      <div class="production-head">
        <div>
          <div class="section-label">Production Context</div>
          <div class="micro-note">Playback dressing only: percussion and space do not change motif generation.</div>
        </div>
      </div>
      ${productionPanelHTML(p)}
    </div>
  `;
}

function macroTabButton(key, label) {
  return `<button class="macro-tab${macroTab === key ? " active" : ""}" data-macro-tab="${key}">${label}</button>`;
}

function macroPanelHTML(p) {
  if (macroTab === "tuning") {
    const tunSub = macroSubTab.tuning;
    return `
      <div class="macro-panel tuning-panel">
        <div class="macro-controls">
          <div class="macro-subsection${tunSub === "accuracy" ? " active" : ""}" data-section="accuracy">
            <div class="subsection-label">Accuracy</div>
            ${controlRow("precision", "Probability", p.precision, 0, 1, 0.01)}
            ${controlRow("precisionRange", "Hit range", p.precisionRange, 0, 100, 1)}
          </div>

          <div class="macro-subsection${!p.surpriseTuningEnabled ? " surprise-disabled" : ""}${tunSub === "surprise" ? " active" : ""}" data-section="surprise">
            <div class="subsection-label">Surprise</div>
            ${checkboxControl("surpriseTuningEnabled", "Enable surprise", p.surpriseTuningEnabled)}
            ${controlRow("tunSurpriseAmount", "Amount", p.tunSurpriseAmount ?? 0.5, 0, 1, 0.01)}
            ${controlRow("surpriseTuningDistance", "Range", p.surpriseTuningDistance, 0, 1, 0.01)}
          </div>
        </div>
        <div class="macro-monitor">
          <div class="monitor-title">Tuning Deviation (Cents)</div>
          <canvas class="dist-canvas accuracy-canvas" id="cvTuningAccuracy" width="620" height="300"></canvas>
        </div>
      </div>`;
  }
  if (macroTab === "duration") {
    const durSub = macroSubTab.duration;
    return `
      <div class="macro-panel duration-panel">
        ${panelPresetBarHTML("rhythm")}
        <div class="macro-controls">
          <div class="macro-subsection${durSub === "generation" ? " active" : ""}" data-section="generation">
            <div class="subsection-label">Generation</div>
            ${controlRow("beatDivisions", "Beat divisions", p.beatDivisions, 1, 6, 1)}
            ${controlRow("sameLengthProb", "Note length prob", p.sameLengthProb, 0, 1, 0.01)}
            ${controlRow("onBeatProb", "On-meter onset", p.onBeatProb, 0, 1, 0.01)}
            ${controlRow("offBeatProb", "Off-meter onset", p.offBeatProb, 0, 1, 0.01)}
            ${controlRow("restMotifStartRatio", "Rest first", p.restMotifStartRatio, 0, 0.95, 0.01)}
            ${controlRow("restOnMeterRatio", "Rest on-meter", p.restOnMeterRatio, 0, 0.95, 0.01)}
            ${controlRow("restOffMeterRatio", "Rest off-meter", p.restOffMeterRatio, 0, 0.95, 0.01)}
          </div>

          <div class="macro-subsection${!p.surpriseRhythmEnabled ? " surprise-disabled" : ""}${durSub === "surprise" ? " active" : ""}" data-section="surprise">
            <div class="subsection-label">Surprise</div>
            ${checkboxControl("surpriseRhythmEnabled", "Enable surprise", p.surpriseRhythmEnabled)}
            ${controlRow("durSurpriseAmount", "Amount", p.durSurpriseAmount ?? 0.5, 0, 1, 0.01)}
            ${controlRow("surpriseRhythmDistance", "Range", p.surpriseRhythmDistance, 0, 1, 0.01)}
            ${checkboxControl("surpriseRestEnabled", "Include surprise rests", p.surpriseRestEnabled)}
          </div>
        </div>
        <div class="macro-monitor duration-monitor">
          <div class="monitor-title">Duration Difference (Divisions)</div>
          <canvas class="dist-canvas accuracy-canvas" id="cvDurationAccuracy" width="620" height="260"></canvas>
          <div class="breaks-block">
            <div class="section-label">Breaks & Slides</div>
            <div class="breaks-grid">
              ${controlRow("gapProb", "Chance", p.gapProb, 0, 1, 0.01)}
              ${controlRow("gapMin", "Min", p.gapMin, -0.8, 0.8, 0.01)}
              ${controlRow("gapMax", "Max", p.gapMax, -0.8, 0.8, 0.01)}
              ${controlRow("gapDistanceSlope", "Distance slope", p.gapDistanceSlope, 0, 1, 0.01)}
              ${controlRow("gapTimingRange", "Timing range", p.gapTimingRange, 0, 0.4, 0.01)}
              ${controlRow("phraseGap", "Phrase gap", p.phraseGap, 0, 0.8, 0.01)}
            </div>
            <div class="connection-row" role="group" title="${esc(PARAM_DESC.noteConnection)}">
              <span class="connection-label">When notes overlap</span>
              ${[["glide", "Glide (mono)"], ["ring", "Ring (multiphonic)"]].map(([v, label]) =>
                `<button class="seg-btn${(p.noteConnection || "glide") === v ? " active" : ""}" data-note-connection="${v}">${label}</button>`).join("")}
            </div>
            <div class="breaks-grid">
              ${(p.noteConnection || "glide") === "glide" ? controlRow("slideSpeed", "Slide speed", p.slideSpeed, 0, 1, 0.01) : ""}
            </div>
            <canvas class="mini-canvas" id="cvGap" width="620" height="76"></canvas>
          </div>
        </div>
      </div>`;
  }
  if (macroTab === "dynamics") {
    const dynSub = macroSubTab.dynamics;
    return `
      <div class="macro-panel dynamics-panel">
        ${panelPresetBarHTML("dynamics")}
        <div class="macro-controls">
          <div class="macro-subsection${dynSub === "generation" ? " active" : ""}" data-section="generation">
            <div class="subsection-label">Generation</div>
            ${controlRow("dynamicsRange", "Variability", p.dynamicsRange, 0, 0.75, 0.01)}
          </div>

          <div class="macro-subsection${dynSub === "accuracy" ? " active" : ""}" data-section="accuracy">
            <div class="subsection-label">Accuracy</div>
            ${controlRow("dynamicsPrecision", "Probability", p.dynamicsPrecision, 0, 1, 0.01)}
            ${controlRow("dynamicsHitRange", "Hit range", p.dynamicsHitRange ?? Math.round(p.dynamicsRange * 100), 0, 75, 1)}
          </div>

          <div class="macro-subsection${!p.surpriseDynamicsEnabled ? " surprise-disabled" : ""}${dynSub === "surprise" ? " active" : ""}" data-section="surprise">
            <div class="subsection-label">Surprise</div>
            ${checkboxControl("surpriseDynamicsEnabled", "Enable surprise", p.surpriseDynamicsEnabled)}
            ${controlRow("dynSurpriseAmount", "Amount", p.dynSurpriseAmount ?? 0.5, 0, 1, 0.01)}
            ${controlRow("surpriseDynamicsDistance", "Range", p.surpriseDynamicsDistance, 0, 1, 0.01)}
          </div>

          <div class="register-mini-section">
            <div class="subsection-label">Loudness Register</div>
            ${controlRow("dynamicsLevel", "Centre", p.dynamicsLevel, 0.05, 1, 0.01)}
            ${controlRow("loudnessRange", "Range", p.loudnessRange, 0, 1, 0.01)}
            <canvas class="mini-canvas register-mini-canvas" id="cvLoudnessRegister" width="280" height="50"></canvas>
          </div>
        </div>
        <div class="macro-monitor">
          <div class="monitor-title">Dynamic Difference (%)</div>
          <canvas class="dist-canvas accuracy-canvas" id="cvDynamicsAccuracy" width="620" height="300"></canvas>
        </div>
      </div>`;
  }
  const melSub = macroSubTab.melody;
  return `
    <div class="macro-panel melody-panel">
      <div class="macro-controls">
        <div class="macro-subsection${melSub === "generation" ? " active" : ""}" data-section="generation">
          <div class="subsection-label">Generation</div>
          <div class="pattern-row" role="group" title="${esc(PARAM_DESC.melodyPattern)}">
            ${[["walk", "Walk"], ["arpUp", "Arp ↑"], ["arpDown", "Arp ↓"], ["arpUpDown", "Arp ↕"]].map(([v, label]) =>
              `<button class="seg-btn${(p.melodyPattern || "walk") === v ? " active" : ""}" data-melody-pattern="${v}">${label}</button>`).join("")}
          </div>
          ${(p.melodyPattern || "walk") === "walk" ? `
          ${controlRow("intervalPeakedness", "Interval shape", p.intervalPeakedness, 0, 4, 0.05)}
          ${controlRow("intervalRange", "Interval range", p.intervalRange, 1, 24, 1)}
          ${controlRow("momentum", "Momentum", p.momentum, 0, 1, 0.01)}` : `
          ${controlRow("arpStep", "Arp stride", p.arpStep, 1, 4, 1)}
          ${controlRow("arpOctaves", "Arp octaves", p.arpOctaves, 1, 3, 1)}`}
        </div>

        <div class="macro-subsection${melSub === "accuracy" ? " active" : ""}" data-section="accuracy">
          <div class="subsection-label">Accuracy</div>
          ${controlRow("motifHitProb", "Probability", p.motifHitProb, 0, 1, 0.01)}
          ${controlRow("motifHitRange", "Hit range", p.motifHitRange, 0, 12, 1)}
        </div>

        <div class="macro-subsection${!p.surprisePitchEnabled ? " surprise-disabled" : ""}${melSub === "surprise" ? " active" : ""}" data-section="surprise">
          <div class="subsection-label">Surprise</div>
          ${(p.melodyPattern || "walk") !== "walk"
            ? `<div class="arp-surprise-note">Arp patterns are deterministic — surprise applies to Walk melodies only. Switch the pattern to Walk to use it.</div>`
            : `${checkboxControl("surprisePitchEnabled", "Enable surprise", p.surprisePitchEnabled)}
          ${controlRow("melSurpriseAmount", "Amount", p.melSurpriseAmount ?? 0.5, 0, 1, 0.01)}
          ${controlRow("surprisePitchDistance", "Range", p.surprisePitchDistance, 0, 1, 0.01)}`}
        </div>

        <div class="register-mini-section">
          <div class="subsection-label">Register</div>
          ${controlRow("registerCenter", "Centre", p.registerCenter, -24, 24, 1)}
          ${controlRow("registerWidth", "Width", p.registerWidth, 2, 36, 1)}
          ${controlRow("registerSkew", "Skew", p.registerSkew, -1, 1, 0.05)}
          <canvas class="mini-canvas register-mini-canvas" id="cvRegister" width="280" height="50"></canvas>
        </div>
      </div>
      <div class="macro-monitor melody-monitor">
        <div class="monitor-title">Scale Degree Difference (Steps)</div>
        <canvas class="dist-canvas accuracy-canvas" id="cvMelodyAccuracy" width="620" height="340"></canvas>
      </div>
    </div>`;
}

function productionPanelHTML(p) {
  // Q2: the standalone reverb card is gone from the macro production tab.
  // Owner-clarified model: reverb/space TYPE lives with the global space
  // (producer, Q6); each patch keeps its own space in the SPACE stage
  // inspector. The reverb params stay in the params object — patches and
  // saved presets still carry and use them.
  return `
    <div class="perf-panel production-panel">
      <div class="perf-section percussion-section">
        <div class="perf-section-title">Percussion</div>
        ${panelPresetBarHTML("percussion")}
        <div class="perc-layers">
          <div class="perc-layer">
            <div class="perc-header">Beat</div>
            <select data-perc="percBeatSound" class="perc-select">
              ${percSoundOptions(p.percBeatSound)}
            </select>
            ${controlRow("percBeatVol", "Vol", p.percBeatVol, 0, 1, 0.01)}
          </div>
          <div class="perc-layer">
            <div class="perc-header">Motif</div>
            <select data-perc="percMotifSound" class="perc-select">
              ${percSoundOptions(p.percMotifSound)}
            </select>
            ${controlRow("percMotifVol", "Vol", p.percMotifVol, 0, 1, 0.01)}
          </div>
          <div class="perc-layer">
            <div class="perc-header">Downbeat</div>
            <select data-perc="percDownbeatSound" class="perc-select">
              ${percSoundOptions(p.percDownbeatSound)}
            </select>
            ${controlRow("percDownbeatVol", "Vol", p.percDownbeatVol, 0, 1, 0.01)}
            ${controlRow("percDownbeatEvery", "Every", p.percDownbeatEvery, 1, 16, 1)}
          </div>
        </div>
      </div>
    </div>`;
}

// ── Q7: layered subnote modules ─────────────────────────────
// Coloured blocks along the bottom of the sub-note view: ＋ captures the
// CURRENT subnote half as a new layer; each block gets level, position and
// an independent-head toggle; the strip header can sync envelope draws.
let _chLayerSel = null; // selected layer id (opens its mini panel)

function layerStripHTML(p) {
  const layers = Array.isArray(p.layers) ? p.layers : [];
  const sel = layers.find(l => l.id === _chLayerSel);
  const blocks = layers.map((l, i) => `
    <button class="layer-block${l.id === _chLayerSel ? " sel" : ""}" data-layer-block="${l.id}"
      style="--layer-hue:${l.hue ?? (36 + i * 70) % 360}"
      title="Layer ${i + 1} (${esc(SPECTRAL_PROFILES[l.subnote?.spectralProfile]?.label || l.subnote?.spectralProfile || "custom")}) — click to edit">
      ${i + 1}
    </button>`).join("");
  const panel = sel ? `
    <div class="layer-panel">
      <label class="sp-ctl">Level
        <input type="range" data-layer-gain="${sel.id}" min="0" max="1.5" step="0.01" value="${sel.gain ?? 1}" title="This layer's level relative to the base sound"/>
      </label>
      <label class="sp-ctl">Angle
        <input type="range" data-layer-angle="${sel.id}" min="-180" max="180" step="1" value="${sel.space?.angle ?? 0}" title="Where this layer sits around you (inherits the patch position when untouched)"/>
      </label>
      <label class="sp-ctl">Distance
        <input type="range" data-layer-dist="${sel.id}" min="0.3" max="30" step="0.1" value="${sel.space?.dist ?? 2.5}" title="How far away this layer stands"/>
      </label>
      <label class="sp-ctl"><span title="Give this layer its own ear span / head density (from its captured subnote params) instead of inheriting the listener's">independent head</span>
        <input type="checkbox" data-layer-head="${sel.id}"${sel.independentHead ? " checked" : ""}/>
      </label>
      <button class="pal-btn" data-layer-remove="${sel.id}" title="Remove this layer">×</button>
    </div>` : "";
  return `
    <div class="layer-strip" id="layerStrip">
      <span class="layer-strip-label" title="${esc(PARAM_DESC.layers)}">LAYERS</span>
      ${blocks}
      <button class="layer-add" id="layerAdd" title="Add the current sub-note module (sound half) as a new layer">＋</button>
      <label class="layer-env-sync" title="${esc(PARAM_DESC.layerEnvOverride)}">
        <input type="checkbox" id="layerEnvSync"${p.layerEnvOverride ? " checked" : ""}/> override envelope probabilities
      </label>
    </div>
    ${panel}
    ${p.layerEnvOverride && layers.length ? `<div class="layer-env-block">${envelopeProbBlockHTML(p)}</div>` : ""}`;
}

function subnoteWorkspaceHTML(p) {
  const formantMode = isFormantMode(p);
  const fourierDisabled = formantMode ? " mode-disabled" : "";
  const formantDisabled = formantMode ? "" : " mode-disabled";
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  return `
    <div class="card subnote-full-card ${formantMode ? "is-formant-mode" : "is-fourier-mode"}">
      <div class="subnote-full-layout">
        ${formantMode ? `
          <div class="formant-stage" data-sound-path="formant" aria-disabled="false">
            <div class="subnote-head">
              <div>
                <div class="section-label">Formant Accuracy</div>
                <h2>All formants</h2>
              </div>
              <div class="signature-legend">
                <span><i class="legend-line acc"></i> accuracy</span>
                <span><i class="legend-line surp"></i> surprise</span>
              </div>
            </div>
            ${formantAccuracyControlsHTML(p)}
            <canvas class="formant-canvas accuracy-canvas" id="cvFormantAccuracy" width="760" height="360"></canvas>
          </div>
        ` : `
          <div class="harmonic-stage chorda" data-sound-path="fourier" aria-disabled="false">
            <!-- CHORDA (owner-chosen direction 2026-07-07): one truth-canvas,
                 four annotators. The chain is a rail of thumbnail cards; the
                 selected stage expands into the inspector; the partial field
                 is the shared display everything indexes into. -->
            <div class="ch-head">
              <div>
                <div class="section-label">Tone Designer</div>
                <h2>${esc(profile.label)}</h2>
              </div>
              <div class="ch-head-mid">
                <select data-param-select="spectralProfile" class="param-select" title="Starting points — carefully shaped instruments to depart from; tweak anything, then save the result as your own instrument">
                  ${spectralProfileOptions(p.spectralProfile)}
                </select>
                <label class="ch-mix">mix
                  <input type="range" data-param="spectralMix" min="0" max="1" step="0.01" value="${p.spectralMix}"/>
                  <output id="out_spectralMix">${fmtOutput("spectralMix", p.spectralMix)}</output>
                </label>
              </div>
              <div class="ch-readout">f₀ <b>${(p.tonicHz || 261.63).toFixed(1)} Hz</b> · ${esc(noteNameForHz(p.tonicHz || 261.63))} · ${Math.round(p.spectralPartials || 20)} partials</div>
            </div>
            <div class="ch-rail" id="chRail">
              ${chRailCardHTML(p, "excitor", "01", "EXCITOR")}
              <div class="ch-sep">›</div>
              ${chRailCardHTML(p, "resonator", "02", "RESONATOR")}
              <div class="ch-sep">›</div>
              ${chRailCardHTML(p, "body", "03", "BODY")}
              <div class="ch-sep">›</div>
              ${chRailCardHTML(p, "space", "04", "SPACE")}
            </div>
            <div class="ch-main">
              <div class="ch-inspector ch-${_chStage}" id="chInspector">${chInspectorHTML(p)}</div>
              <div class="ch-field-wrap">
                <div class="ch-focus-row" id="chFocus">
                  <span class="ch-focus-label">FOCUS</span>
                  ${[["all", "All"], ["odd", "Odd"], ["even", "Even"], ["coupled", "Coupled"], ["longring", "Long ring"], ["wobbly", "Wobbly"]].map(([c, label]) =>
                    `<button class="ch-chip${_chFocus.chip === c ? " active" : ""}" data-ch-chip="${c}">${label}</button>`).join("")}
                  <span class="ch-focus-sum" id="chFocusSum"></span>
                </div>
                <div class="ch-field-pos">
                  <canvas id="cvTonePrint" width="1200" height="330"></canvas>
                  <div class="ch-pin" id="chPin" hidden></div>
                </div>
                <div class="ch-lens-row"><span class="ch-lens-label">LENS</span><canvas id="cvLens" width="1200" height="34"></canvas></div>
                <div class="ch-strip" id="chStrip"></div>
              </div>
            </div>
            <div class="ch-status"><span><b>drag</b> a stem = level · <b>click</b> = pin readout · <b>brush</b> the lens to focus · knobs drag vertically, double-click resets</span><span class="ch-status-right">display = engine truth · log-f axis</span></div>
            ${layerStripHTML(p)}
          </div>
        `}

        <div class="subnote-side">
          <div class="subnote-side-section sound-source-section">
            <div class="section-label">Sound Source</div>
            ${panelPresetBarHTML("sound")}
          </div>

          <div class="subnote-side-section${fourierDisabled}" data-sound-path="fourier" aria-disabled="${formantMode}">
            <div class="section-label">Advanced shaping</div>
            <details class="formant-detail">
              <summary title="Legacy macro transforms — position and the physical stages absorb most of these; they remain for fine surgery until the tone print's focus editing replaces them.">Advanced</summary>
              <div class="controls-grid">
                ${controlRow("partialOddEven", "Odd / even", p.partialOddEven, -1, 1, 0.01)}
                ${controlRow("partialComb", "Comb boost", p.partialComb, 0, 1, 0.01)}
                ${controlRow("partialCombFreq", "Comb centre", p.partialCombFreq, 1, 64, 1)}
              </div>
              <div class="subsection-label">Octave groups</div>
              <div class="controls-grid">
                ${controlRow("partialGroup1", "Fund (1)", p.partialGroup1, 0, 2, 0.01)}
                ${controlRow("partialGroup2", "Oct (2)", p.partialGroup2, 0, 2, 0.01)}
                ${controlRow("partialGroup3", "3–4", p.partialGroup3, 0, 2, 0.01)}
                ${controlRow("partialGroup4", "5–8", p.partialGroup4, 0, 2, 0.01)}
                ${controlRow("partialGroup5", "9–16", p.partialGroup5, 0, 2, 0.01)}
                ${controlRow("partialGroup6", "17+", p.partialGroup6, 0, 2, 0.01)}
              </div>
            </details>
          </div>

        </div>

      </div>
    </div>
  `;
}

function resetSpectralPartialParams(p) {
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  // Choosing an instrument applies its performance character too — envelope
  // speech, vibrato idiom, inharmonic stretch. They stay ordinary editable
  // params afterwards; the onset transient rides the profile itself.
  for (const [key, value] of Object.entries(profile.performance || {})) {
    if (key !== "attackNoise" && key in DEFAULTS) p[key] = value;
  }
  // An instrument without its own measured inharmonicity starts harmonic —
  // otherwise the previous instrument's B leaks across the switch
  if (!Number.isFinite(profile.performance?.partialB)) p.partialB = null;
  // Tone v2 (T2): the instrument's natural excitation is part of its
  // character — selecting a profile re-seats type/position/hardness.
  const exc = profile.performance?.excitation;
  if (exc) {
    p.excitationType = exc.type || "bow";
    p.excitationPosition = exc.position ?? 0.5;
    p.excitationHardness = exc.hardness ?? 0.6;
    p.excitationHuman = exc.human ?? 0.35;
  }
  p.bodyType = "auto"; // a new instrument brings its own body
  p.spectralPartialMeans = profile.partials.map(partial => +(profilePartial(partial).amp || 0).toFixed(3));
  p.spectralPartialSds = profile.partials.map(partial => {
    const spec = profilePartial(partial);
    return +Math.min(0.75, (spec.amp || 0) * (spec.spread || 0.2) * (p.spectralSpread ?? 0.45)).toFixed(3);
  });
  p.spectralPartialDyns = profile.partials.map(partial => +(profilePartial(partial).dyn || 0).toFixed(2));
  p.spectralPartialRegs = profile.partials.map((partial, i) => {
    const reg = profilePartial(partial).reg ?? spectralDefaultRegisterSensitivity(i, profile.partials.length);
    return +reg.toFixed(2);
  });
}

function ensureSpectralPartialParams(p) {
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  if (!Array.isArray(p.spectralPartialMeans) || !Array.isArray(p.spectralPartialSds) || !Array.isArray(p.spectralPartialDyns)) {
    resetSpectralPartialParams(p);
  }
  if (!Array.isArray(p.spectralPartialRegs)) {
    p.spectralPartialRegs = profile.partials.map((partial, i) => {
      const reg = profilePartial(partial).reg ?? spectralDefaultRegisterSensitivity(i, profile.partials.length);
      return +reg.toFixed(2);
    });
  }
  p.spectralPartialMeans = profile.partials.map((partial, i) => {
    const fallback = profilePartial(partial).amp || 0;
    return clamp(Number(p.spectralPartialMeans[i] ?? fallback), 0, 1.5);
  });
  p.spectralPartialSds = profile.partials.map((partial, i) => {
    const spec = profilePartial(partial);
    const fallback = (spec.amp || 0) * (spec.spread || 0.2) * (p.spectralSpread ?? 0.45);
    return clamp(Number(p.spectralPartialSds[i] ?? fallback), 0, 0.75);
  });
  p.spectralPartialDyns = profile.partials.map((partial, i) => {
    const fallback = profilePartial(partial).dyn || 0;
    return clamp(Number(p.spectralPartialDyns[i] ?? fallback), -1, 4);
  });
  p.spectralPartialRegs = profile.partials.map((partial, i) => {
    const fallback = profilePartial(partial).reg ?? spectralDefaultRegisterSensitivity(i, profile.partials.length);
    return clamp(Number(p.spectralPartialRegs[i] ?? fallback), -2, 2);
  });
}

function profilePartial(partial) {
  return (typeof partial === "number")
    ? { amp: partial, spread: 0.25, dyn: 0, reg: null }
    : partial;
}

// ── CH-B2 liftable performance blocks ──
// One param-scoped component per concern so the CH-B5 layer strip's
// "override envelope probabilities" can reuse them verbatim.
function envelopeProbBlockHTML(p) {
  return `
    <div class="perf-envelope-block">
      ${controlRow("envelopeProb", "Envelope chance", p.envelopeProb, 0, 1, 0.01)}
      ${envelopeDistributionControlsHTML(p)}
      <canvas class="envelope-canvas js-envelope-canvas adsr-edit" width="300" height="110" title="Drag the corners: attack peak, decay→sustain corner (vertical = sustain level), release foot"></canvas>
    </div>`;
}

function vibratoBlockHTML(p) {
  return `
    <div class="perf-vibrato-block">
      ${controlRow("vibratoProb", "Vibrato chance", p.vibratoProb, 0, 1, 0.01)}
      ${controlRow("vibratoDepth", "Depth", p.vibratoDepth, 0, 80, 1)}
      ${controlRow("vibratoRate", "Rate", p.vibratoRate, 0.5, 12, 0.1)}
      <canvas class="vibrato-canvas js-vibrato-canvas" width="260" height="54"></canvas>
    </div>`;
}

function envelopeDistributionControlsHTML(p) {
  return `
    <div class="envelope-dist-controls">
      <div class="env-dist-head">
        <span></span><span>Mean</span><span>SD</span>
      </div>
      ${envelopeDistributionRow("Attack", "envelopeAttack", p.envelopeAttack, 0.001, 0.18, 0.001, "envelopeAttackSd", p.envelopeAttackSd, 0, 0.12, 0.001)}
      ${envelopeDistributionRow("Decay", "envelopeDecay", p.envelopeDecay, 0.005, 0.5, 0.005, "envelopeDecaySd", p.envelopeDecaySd, 0, 0.25, 0.001)}
      ${envelopeDistributionRow("Sustain", "envelopeSustain", p.envelopeSustain, 0.05, 1, 0.01, "envelopeSustainSd", p.envelopeSustainSd, 0, 0.45, 0.01)}
      ${envelopeDistributionRow("Release", "envelopeRelease", p.envelopeRelease, 0.005, 0.6, 0.005, "envelopeReleaseSd", p.envelopeReleaseSd, 0, 0.3, 0.001)}
    </div>
  `;
}

function envelopeDistributionRow(label, meanParam, mean, meanMin, meanMax, meanStep, sdParam, sd, sdMin, sdMax, sdStep) {
  return `
    <div class="env-dist-row">
      <span class="env-param-label">${label}</span>
      <input type="range" data-param="${meanParam}" min="${meanMin}" max="${meanMax}" step="${meanStep}" value="${mean}"/>
      <output id="out_${meanParam}">${fmtOutput(meanParam, mean)}</output>
      <input type="range" data-param="${sdParam}" min="${sdMin}" max="${sdMax}" step="${sdStep}" value="${sd}"/>
      <output id="out_${sdParam}">${fmtOutput(sdParam, sd)}</output>
    </div>
  `;
}

function harmonicEditorHTML(p) {
  ensureSpectralPartialParams(p);
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  const count = Math.max(1, Math.min(profile.partials.length, Math.round(p.spectralPartials || 20)));
  // T7: the editor strip is scoped to the tone print's focused band —
  // partials are filtered by their REALISED frequency, not their rank.
  // With no band focused there is no slider wall: the print itself is
  // the editor (drag needles), and the chips open per-band detail.
  if (_printState.band === "all") {
    return `<div class="editor-hint">drag needles in the print to shape levels · pick a band above (fund / low / mid / presence / air) to edit those partials' level &amp; wobble individually</div>`;
  }
  const [bLo, bHi] = PRINT_BANDS[_printState.band] || PRINT_BANDS.all;
  const B = Number.isFinite(p.partialB) ? Math.max(0, p.partialB) : legacyStretchToB(p.spectralStretchCents || 0);
  const f0 = p.tonicHz || 261.63;
  return profile.partials.slice(0, count).map((partial, i) => {
    const freq = partialFrequency(i + 1, f0, B, p.resonatorClass || "string");
    if (freq < bLo || freq > bHi) return "";
    const mean = p.spectralPartialMeans[i] ?? profilePartial(partial).amp ?? 0;
    const sd = p.spectralPartialSds[i] ?? 0;
    return `
      <div class="harmonic-control">
        <div class="h-head"><span>H${i + 1}</span><span>${i + 1}x f0</span></div>
        <label>
          <span>M</span>
          <input type="range" data-harmonic-param="mean" data-harmonic-index="${i}" min="0" max="1.5" step="0.01" value="${mean}">
          <output data-harmonic-out="mean-${i}">${harmonicValueLabel("mean", mean)}</output>
        </label>
        <label>
          <span>SD</span>
          <input type="range" data-harmonic-param="sd" data-harmonic-index="${i}" min="0" max="0.75" step="0.005" value="${sd}">
          <output data-harmonic-out="sd-${i}">${harmonicValueLabel("sd", sd)}</output>
        </label>
      </div>
    `;
  }).join('');
}

function harmonicValueLabel(kind, value) {
  if (kind === "mean") return `${Math.round(value * 100)}%`;
  if (kind === "sd") return `±${Math.round(value * 100)}%`;
  if (kind === "reg") return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
  return value.toFixed(1);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

function syncHarmonicWorkspace(v) {
  const card = v.querySelector(".subnote-full-card");
  if (!card) return;
  ensureSpectralPartialParams(exploreParams);
  const profile = SPECTRAL_PROFILES[exploreParams.spectralProfile] || SPECTRAL_PROFILES.violin;
  // Only the Fourier/harmonic stage heading reflects the instrument label.
  // Scope to .harmonic-stage so this never clobbers the formant-stage heading
  // (which shows the vowel space) when in formant mode.
  const title = card.querySelector(".harmonic-stage .subnote-head h2");
  if (title) title.textContent = profile.label;
  const editor = card.querySelector("#harmonicEditor");
  if (editor) editor.innerHTML = harmonicEditorHTML(exploreParams);
  card.querySelectorAll("select[data-param-select]").forEach(sel => {
    sel.value = exploreParams[sel.dataset.paramSelect];
  });
  applySubnoteModeState(v);
  decorateTooltips(card);
  drawTonePrint();
  drawBodyRidge();
  drawSpacePad();
  drawChThumbs();
}

function applySubnoteModeState(root = document) {
  const card = root.querySelector(".subnote-full-card");
  if (!card) return;
  const formantMode = isFormantMode();
  card.classList.toggle("is-formant-mode", formantMode);
  card.classList.toggle("is-fourier-mode", !formantMode);
  card.querySelectorAll("[data-sound-path='fourier']").forEach(path => {
    path.classList.toggle("mode-disabled", formantMode);
    path.setAttribute("aria-disabled", String(formantMode));
    path.querySelectorAll("input, select, textarea, button").forEach(control => {
      control.disabled = formantMode;
    });
  });
  card.querySelectorAll("[data-sound-path='formant']").forEach(path => {
    path.classList.toggle("mode-disabled", !formantMode);
    path.setAttribute("aria-disabled", String(!formantMode));
    path.querySelectorAll("input, select, textarea, button").forEach(control => {
      control.disabled = !formantMode;
    });
  });
}

// ─── Explore: Note Grid ─────────────────────────────────────

function buildNoteGridHTML(p) {
  const isEDO = p.scaleMode === "edo";
  const divisions = isEDO ? (p.edoDivisions || 12) : 12;
  const customDeg = p.customDegrees || [];
  const subNotes = p.subScaleNotes || [];
  const rootNotes = p.rootNotes || [];

  let html = '<div class="note-grid">';
  for (let d = 0; d < divisions; d++) {
    const name = (divisions === 12) ? NOTE_NAMES_12[d] : String(d);
    const inScale = customDeg.includes(d);
    const inSub = subNotes.includes(d) && inScale;
    const isRoot = rootNotes.includes(d) && inScale;
    let cls = "note-cell";
    if (isRoot) cls += " is-root";
    else if (inSub) cls += " in-sub";
    else if (inScale) cls += " in-scale";
    html += `<div class="${cls}" data-degree="${d}">${name}</div>`;
  }
  html += '</div>';
  return html;
}

function rerenderNoteGrid(v) {
  const container = v.querySelector("#noteGridContainer");
  if (container) {
    container.innerHTML = buildNoteGridHTML(exploreParams);
    decorateTooltips(container);
  }
}

function syncRootNotesWithScale(v) {
  const scaleDegrees = exploreParams.customDegrees || [];
  exploreParams.rootNotes = (exploreParams.rootNotes || [scaleDegrees[0] ?? 0])
    .filter(r => scaleDegrees.includes(r));
  if (exploreParams.rootNotes.length === 0) {
    exploreParams.rootNotes = [scaleDegrees[0] ?? 0];
  }
  rerenderNoteGrid(v);
}

function handleNoteGridClick(cell) {
  const d = parseInt(cell.dataset.degree);
  const p = exploreParams;
  if (!p.customDegrees) p.customDegrees = [];
  if (!p.subScaleNotes) p.subScaleNotes = [];
  if (!p.rootNotes) p.rootNotes = [];

  if (cell.classList.contains("is-root")) {
    // Root -> off, unless this is the last active scale note.
    const remainingScale = p.customDegrees.filter(x => x !== d);
    if (remainingScale.length === 0) {
      p.rootNotes = [d];
    } else {
      p.rootNotes = p.rootNotes.filter(x => x !== d);
      p.subScaleNotes = p.subScaleNotes.filter(x => x !== d);
      p.customDegrees = remainingScale;
    }
  } else if (cell.classList.contains("in-sub")) {
    // Sub-scale -> root.
    p.subScaleNotes = p.subScaleNotes.filter(x => x !== d);
    if (!p.customDegrees.includes(d)) p.customDegrees.push(d);
    if (!p.rootNotes.includes(d)) p.rootNotes.push(d);
  } else if (cell.classList.contains("in-scale")) {
    // In scale -> promote to sub-scale.
    if (!p.subScaleNotes.includes(d)) p.subScaleNotes.push(d);
  } else {
    // Off -> add to scale.
    if (!p.customDegrees.includes(d)) {
      p.customDegrees.push(d);
    }
  }
  p.customDegrees = [...new Set(p.customDegrees)].sort((a, b) => a - b);
  p.subScaleNotes = [...new Set(p.subScaleNotes)].filter(x => p.customDegrees.includes(x));
  p.rootNotes = [...new Set(p.rootNotes)].filter(x => p.customDegrees.includes(x));

  // Ensure at least one note remains in scale
  if (!p.customDegrees || p.customDegrees.length === 0) {
    p.customDegrees = [d];
  }
  if (!p.rootNotes.length) p.rootNotes = [p.customDegrees[0]];

  rerenderNoteGrid(document);
  debouncedReplay();
  drawDistributions();
}

// ─── Explore: Root Note Grid ────────────────────────────────

function buildRootNoteGridHTML(p) {
  const isEDO = p.scaleMode === "edo";
  const divisions = isEDO ? (p.edoDivisions || 12) : 12;
  const customDeg = p.customDegrees || [];
  const rootNotes = p.rootNotes || [0];

  let html = '<div class="note-grid">';
  for (let d = 0; d < divisions; d++) {
    const name = (divisions === 12) ? NOTE_NAMES_12[d] : String(d);
    const inScale = customDeg.includes(d);
    const isRoot = rootNotes.includes(d);
    let cls = "note-cell root-cell";
    if (isRoot) cls += " is-root";
    else if (inScale) cls += " in-scale";
    // Only allow selecting notes that are in the scale
    if (!inScale && !isRoot) cls += " disabled";
    html += `<div class="${cls}" data-degree="${d}">${name}</div>`;
  }
  html += '</div>';
  return html;
}

function handleRootNoteClick(cell) {
  const d = parseInt(cell.dataset.degree);
  const p = exploreParams;
  if (!p.rootNotes) p.rootNotes = [0];

  const customDeg = p.customDegrees || [];
  if (!customDeg.includes(d) && !p.rootNotes.includes(d)) return; // not in scale

  if (cell.classList.contains("is-root")) {
    // Remove from roots (unless it's the last one)
    if (p.rootNotes.length > 1) {
      p.rootNotes = p.rootNotes.filter(r => r !== d);
      cell.classList.remove("is-root");
      if (customDeg.includes(d)) cell.classList.add("in-scale");
    }
  } else {
    // Add to roots
    if (!p.rootNotes.includes(d)) p.rootNotes.push(d);
    cell.classList.remove("in-scale");
    cell.classList.add("is-root");
  }
  debouncedReplay();
  drawDistributions();
}

// ─── Explore: Distribution Displays ─────────────────────────

function drawMelodyMacroDist() {
  drawMacroDist("cvMelodyAccuracy", {
    title: "Melody",
    activeSection: macroSubTab.melody || "accuracy",
    range: Math.max(3, Math.round(exploreParams.intervalRange || 12)),
    step: 1,
    unit: "deg",
    xLabel: "scale-degree difference",
    labelEvery: 2,
    lockRange: true,
    markerAxis: "melody",
    generation: {
      peakedness: exploreParams.intervalPeakedness ?? 1.5,
      range: exploreParams.intervalRange ?? 7,
    },
    accuracy: {
      prob: exploreParams.motifHitProb ?? 1,
      hitRange: exploreParams.motifHitRange ?? 2,
    },
    surprise: {
      amount: exploreParams.melSurpriseAmount ?? 0.5,
      range: exploreParams.surprisePitchDistance ?? 1,
      weight: exploreParams.surprisePitchEnabled
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
  });
}

function drawTuningMacroDist() {
  drawMacroDist("cvTuningAccuracy", {
    title: "Tuning",
    activeSection: macroSubTab.tuning || "accuracy",
    range: Math.max(10, Math.ceil((exploreParams.precisionRange || 20) / 5) * 5),
    step: (exploreParams.precisionRange || 20) > 50 ? 10 : 5,
    unit: "c",
    xLabel: "cents difference",
    markerAxis: "tuning",
    generation: null,  // tuning has no generation layer
    accuracy: {
      prob: exploreParams.precision ?? 1,
      hitRange: exploreParams.precisionRange ?? 12,
    },
    surprise: {
      amount: exploreParams.tunSurpriseAmount ?? 0.5,
      range: exploreParams.surpriseTuningDistance ?? 0.9,
      weight: exploreParams.surpriseTuningEnabled
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
  });
}

// The four macro histograms that carry a live note trace — redrawn per-frame while playing.
function drawMacroDistsAll() {
  drawMelodyMacroDist();
  drawTuningMacroDist();
  drawDurationMacroDist();
  drawDynamicsMacroDist();
}

function drawDistributions() {
  drawIntervalDist();
  drawMelodyMacroDist();
  drawTuningMacroDist();
  drawRootPullDist();
  drawRegisterDist();
  drawLoudnessRegisterDist();
  drawDurationMacroDist();
  drawDynamicsMacroDist();
  drawFormantAccuracyDist();
  drawGapDist();
  drawReverbDist();
  drawVibratoDist();
  drawEnvelopeDist();
  drawTonePrint();
  drawBodyRidge();
  drawSpacePad();
  drawChThumbs();
}

// Match a canvas backing store to its CSS layout size × devicePixelRatio so
// the distribution displays render crisply, and return a context scaled back
// to CSS-pixel coordinates (so drawing code and hover hit-tests keep working
// in one coordinate space, stored on the element as _cssW/_cssH). Hidden
// canvases (clientWidth 0) fall back to the last known or attribute size.
function crisp2d(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = cv.clientWidth || cv._cssW || cv.width;
  const cssH = cv.clientHeight || cv._cssH || cv.height;
  cv._cssW = cssW; cv._cssH = cssH;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

function drawIntervalDist() {
  const cv = document.getElementById("cvInterval");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const peak = exploreParams.intervalPeakedness;
  const range = Math.max(1, exploreParams.intervalRange);

  // Interval-shape curve: pure Gaussian whose σ narrows with the shape dial.
  const shapeVal = (dist) => intervalShapeWeight(dist, peak, range);

  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const dist = (x / w) * range;
    const y = h - shapeVal(dist) * (h - 4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const dist = (x / w) * range;
    const y = h - shapeVal(dist) * (h - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // X-axis labels
  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("0", 4, h - 2);
  ctx.fillText(String(range), w - 8, h - 2);
}

/* ── Probability display: 3-layer LED bar chart (Generation / Accuracy / Surprise) ── */

// Phosphor persistence: store previous bar heights for decay trail
const _prevBars = {};

// Live note "scope trace": how long a played note's vertical marker lingers (burn-in)
const MARKER_TRAIL_SEC = 2.6;

/**
 * recentAxisMarkers — recent played-note positions for a given histogram axis.
 * Returns [{ value, age, sounding }] where `value` is the note's signed position
 * on that axis (0 = centre), `age` is seconds since onset, `sounding` = still ringing.
 *   melody   → scale-degree interval from previous note
 *   tuning   → intonation deviation in cents (0 = in tune)
 *   duration → change in note length (divs) from previous note
 *   dynamics → change in velocity (%) from previous note
 */
function recentAxisMarkers(axis) {
  const tl = synth.getNoteTimeline ? synth.getNoteTimeline() : null;
  if (!tl || !tl.playing || !tl.events || !tl.events.length) return [];
  const now = tl.now;
  let prevDeg = null, prevDur = null, prevVel = null;
  const out = [];
  for (const e of tl.events) {
    const sounding = !e.isRest && (e.velocity || 0) > 0;
    let v = null;
    if (axis === "melody")        v = (sounding && prevDeg != null) ? (e.degree - prevDeg) : null;
    else if (axis === "tuning")   v = sounding ? (e.intonationCents || 0) : null;
    else if (axis === "duration") v = (sounding && prevDur != null) ? (e.durationDivs - prevDur) : null;
    else if (axis === "dynamics") v = (sounding && prevVel != null) ? ((e.velocity - prevVel) * 100) : null;
    if (sounding) { prevDeg = e.degree; prevDur = e.durationDivs; prevVel = e.velocity; }
    if (v == null || e.when > now) continue;
    const age = now - e.when;
    if (age > MARKER_TRAIL_SEC) continue;
    out.push({ value: v, age, sounding: now < e.when + (e.dur || 0), role: e.noteRole || "generation" });
  }
  return out;
}

/**
 * drawMacroDist — unified 3-layer distribution renderer.
 *
 * cfg = {
 *   title: string,
 *   activeSection: "generation" | "accuracy" | "surprise",
 *   range: number,          // ± range in steps
 *   step: number,           // step size (default 1)
 *   unit: string,           // x-axis unit label
 *   xLabel: string,         // x-axis description
 *   labelEvery: number,     // label every Nth bar
 *   lockRange: bool,        // if true, don't auto-expand range
 *
 *   generation: {           // exponential-decay interval shape (melody only)
 *     peakedness: number,   // λ in e^(-λ|d|)
 *     range: number,        // interval range
 *   } | null,
 *
 *   accuracy: {
 *     prob: number,         // 0–1  (1 = delta at centre, 0.5 = normal, 0 = uniform)
 *     hitRange: number,     // range in steps (3σ boundary)
 *   },
 *
 *   surprise: {
 *     amount: number,       // 0–1  (0 = matches accuracy, 0.5 = bimodal zero@mean, 1 = stacked at limits)
 *     range: number,        // 0–1  distance fraction
 *     weight: number,       // fraction of total AUC allocated to surprise (from surpriseChance)
 *   },
 * }
 */
// ── Display hover readouts (FabFilter cue: precise values at the cursor) ──
const _distHoverData = {};

function wireDistHover(root) {
  let bubble = document.getElementById("distReadout");
  if (!bubble) {
    bubble = document.createElement("div");
    bubble.id = "distReadout";
    bubble.className = "dist-readout";
    bubble.style.display = "none";
    document.body.appendChild(bubble);
  }
  const hide = () => { bubble.style.display = "none"; };
  root.addEventListener("mousemove", (e) => {
    const cv = e.target.closest ? e.target.closest("canvas") : null;
    const data = cv && _distHoverData[cv.id];
    if (!data || !data.bars.length) { hide(); return; }
    const rect = cv.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * ((cv._cssW || cv.width) / rect.width);
    const idx = Math.round((cx - data.barStartX - data.barW / 2) / (data.barW + data.barGap));
    if (idx < 0 || idx >= data.bars.length) { hide(); return; }
    const bar = data.bars[idx];
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const parts = [];
    if (data.gen) parts.push(`<span class="dr-gen">gen ${pct(bar.genP)}</span>`);
    parts.push(`<span class="dr-acc">acc ${pct(bar.accP)}</span>`);
    if (data.hasSurp) parts.push(`<span class="dr-surp">surp ${pct(bar.surpP)}</span>`);
    const dLabel = Number.isInteger(bar.d) ? (bar.d > 0 ? `+${bar.d}` : `${bar.d}`) : bar.d.toFixed(2);
    bubble.innerHTML = `<strong>${dLabel}</strong>${parts.join("")}`;
    bubble.style.display = "block";
    bubble.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 190)}px`;
    bubble.style.top = `${e.clientY - 34}px`;
  });
  root.addEventListener("mouseleave", hide);
}

function drawMacroDist(canvasId, cfg) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const { ctx, w: W, h: H } = crisp2d(cv);
  ctx.clearRect(0, 0, W, H);

  // ── Geometry — screen inset from canvas edges
  const padL = 36, padR = 12, padT = 24, padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const axisY = padT + plotH;

  const step    = Math.max(0.01, Number(cfg.step || 1));
  // Allow fractional ranges (e.g. ±2.5 = half a vowel circle). Integer displays
  // pass step=1 and an integer range, so this is a no-op for them.
  const range   = Math.max(step, Number(cfg.range || 7));
  const numSteps = Math.floor(range / step + 1e-9);
  const active  = cfg.activeSection || "accuracy";

  // ── Unpack layer configs
  const gen = cfg.generation || null;  // null if tab has no generation layer
  const acc = cfg.accuracy   || { prob: 1, hitRange: 1 };
  const surp = cfg.surprise  || { amount: 0, range: 0, weight: 0 };

  const hitProb  = Math.max(0, Math.min(1, acc.prob ?? 1));
  const hitRange = Math.max(0, acc.hitRange ?? 1);
  const surpWeight = Math.max(0, Math.min(1, surp.weight ?? 0));
  const surpAmount = Math.max(0, Math.min(1, surp.amount ?? 0));
  const surpRange  = Math.max(0, Math.min(1, surp.range ?? 0));

  // ══════════════════════════════════════════════════════════════
  // LAYER 1: GENERATION — exponential decay from centre
  // ══════════════════════════════════════════════════════════════
  const genProbs = [];
  let genSum = 0;
  if (gen) {
    // Pure Gaussian whose σ narrows with the shape dial; range sets the broad-
    // end spread. Mirrors intervalShapeWeight() in synth.js.
    const shape = gen.peakedness ?? 1.5;
    const genRange = Math.max(1, gen.range ?? (numSteps * step));
    for (let d = -numSteps; d <= numSteps; d++) {
      const w = intervalShapeWeight(d * step, shape, genRange);
      genProbs.push(w);
      genSum += w;
    }
    // Normalize to sum = 1
    if (genSum > 0) genProbs.forEach((_, i) => { genProbs[i] /= genSum; });
  } else {
    for (let d = -numSteps; d <= numSteps; d++) genProbs.push(0);
  }

  // ══════════════════════════════════════════════════════════════
  // LAYER 2: ACCURACY — Gaussian miss distribution
  //   prob=1 → delta at centre, prob=0.5 → normal σ=hitRange/3,
  //   prob=0 → uniform across full range
  // ══════════════════════════════════════════════════════════════
  const accProbs = [];
  let accSum = 0;
  {
    const sigma = Math.max(0.35, hitRange / 3);
    // Pre-compute raw Gaussian weights
    const rawGauss = [];
    let rawGaussSum = 0;
    for (let d = -numSteps; d <= numSteps; d++) {
      const absd = Math.abs(d * step);
      if (absd > hitRange && hitRange > 0) {
        rawGauss.push(0);
      } else {
        const w = Math.exp(-0.5 * ((d * step) / sigma) ** 2);
        rawGauss.push(w);
        rawGaussSum += w;
      }
    }
    // Normalize Gaussian
    if (rawGaussSum > 0) rawGauss.forEach((_, i) => { rawGauss[i] /= rawGaussSum; });

    // Uniform fallback: equal probability across all bars within range
    const uniformCount = rawGauss.filter(w => w > 0).length || (2 * numSteps + 1);
    const uniformP = 1 / uniformCount;

    for (let d = -numSteps; d <= numSteps; d++) {
      const idx = d + numSteps;
      // Blend: prob=1 → delta at 0, prob=0.5 → Gaussian, prob=0 → uniform
      let p;
      if (hitProb >= 0.5) {
        // Blend delta ↔ Gaussian: t goes 0→1 as prob goes 0.5→1
        const t = (hitProb - 0.5) * 2;
        const delta = d === 0 ? 1 : 0;
        p = t * delta + (1 - t) * rawGauss[idx];
      } else {
        // Blend Gaussian ↔ uniform: t goes 0→1 as prob goes 0.5→0
        const t = (0.5 - hitProb) * 2;
        const uniP = (rawGauss[idx] > 0 || hitRange <= 0) ? uniformP : 0;
        p = (1 - t) * rawGauss[idx] + t * uniP;
      }
      accProbs.push(p);
      accSum += p;
    }
    // Re-normalize
    if (accSum > 0) accProbs.forEach((_, i) => { accProbs[i] /= accSum; });
  }

  // ══════════════════════════════════════════════════════════════
  // LAYER 3: SURPRISE — bimodal distribution
  //   amount=0 → matches accuracy shape, amount=0.5 → zero at mean (bimodal),
  //   amount=1 → stacked at range limits
  //   range controls how far out the bimodal peaks sit
  // ══════════════════════════════════════════════════════════════
  const surpProbs = [];
  let surpSum = 0;
  {
    const sigma = Math.max(0.5, hitRange / 3);
    // Peak offset: from 0 (at mean, matching accuracy) out to the full range edge
    const maxOffset = Math.max(1, range);
    const peakOffset = surpAmount * maxOffset * Math.max(0.3, surpRange);

    for (let d = -numSteps; d <= numSteps; d++) {
      const x = d * step;
      let w;

      if (surpAmount < 0.01) {
        // amount ≈ 0: matches accuracy distribution exactly
        w = accProbs[d + numSteps] || 0;
      } else if (surpAmount > 0.99) {
        // amount ≈ 1: two narrow peaks at ±peakOffset
        const peakPos = Math.max(step, Math.round(peakOffset / step) * step);
        const nearPeak = Math.min(Math.abs(x - peakPos), Math.abs(x + peakPos));
        w = nearPeak < step * 0.6 ? 1 : 0;
      } else {
        // Bimodal: two Gaussians at ±peakOffset
        const biSigma = Math.max(0.4, sigma * (1 - surpAmount * 0.5));
        w = Math.exp(-0.5 * ((x - peakOffset) / biSigma) ** 2)
          + Math.exp(-0.5 * ((x + peakOffset) / biSigma) ** 2);
        // Suppress centre for higher amounts when peaks are spread
        if (surpAmount > 0.2 && peakOffset > step * 0.5) {
          const suppress = Math.min(1, (Math.abs(x) / Math.max(0.5, peakOffset)) ** (surpAmount * 2));
          w *= suppress;
        }
      }
      surpProbs.push(w);
      surpSum += w;
    }
    // Normalize
    if (surpSum > 0) surpProbs.forEach((_, i) => { surpProbs[i] /= surpSum; });
  }

  // ══════════════════════════════════════════════════════════════
  // BARS — each layer is an independent distribution (AUC = 100% each).
  // Layers are overlaid, not stacked. Active layer renders on top.
  // ══════════════════════════════════════════════════════════════
  const bars = [];
  let maxProb = 0.001;
  const hasSurp = surpWeight > 0;

  for (let d = -numSteps; d <= numSteps; d++) {
    const idx = d + numSteps;
    const genP  = gen ? genProbs[idx] : 0;
    const accP  = accProbs[idx];
    const surpP = hasSurp ? surpProbs[idx] : 0;

    bars.push({ d: d * step, genP, accP, surpP });
    maxProb = Math.max(maxProb, genP, accP, surpP);
  }

  /* ══════════════════════════════════════════════════════════════
     CRT SCREEN — bezel, phosphor surface, edge glow
     ══════════════════════════════════════════════════════════════ */
  const sX = padL - 6, sY = padT - 6;
  const sW = plotW + 12, sH = plotH + 12;

  // Outer bezel — dark metallic frame
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#080c10";
  ctx.beginPath();
  ctx.roundRect(sX - 3, sY - 3, sW + 6, sH + 6, 6);
  ctx.fill();
  ctx.restore();

  // Inner bezel highlight (subtle edge catch)
  const bezelGrad = ctx.createLinearGradient(sX, sY, sX, sY + sH);
  bezelGrad.addColorStop(0, "rgba(60,80,90,0.15)");
  bezelGrad.addColorStop(0.1, "rgba(20,30,35,0.4)");
  bezelGrad.addColorStop(0.9, "rgba(10,15,18,0.6)");
  bezelGrad.addColorStop(1, "rgba(40,55,65,0.1)");
  ctx.fillStyle = bezelGrad;
  ctx.beginPath();
  ctx.roundRect(sX - 1, sY - 1, sW + 2, sH + 2, 5);
  ctx.fill();

  // Phosphor screen surface — dark green-black CRT glass
  const screenGrad = ctx.createRadialGradient(
    sX + sW / 2, sY + sH / 2, 0,
    sX + sW / 2, sY + sH / 2, sW * 0.75
  );
  screenGrad.addColorStop(0, "#0f1115");
  screenGrad.addColorStop(0.7, "#0d0f13");
  screenGrad.addColorStop(1, "#0a0c0f");
  ctx.fillStyle = screenGrad;
  ctx.beginPath();
  ctx.roundRect(sX, sY, sW, sH, 4);
  ctx.fill();

  // Screen edge glow — phosphor bleed at the edges
  ctx.strokeStyle = "rgba(154,160,171,0.06)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sX + 1, sY + 1, sW - 2, sH - 2, 3);
  ctx.stroke();

  // ── Grid lines: horizontal (phosphor green)
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let gy = 0; gy <= 4; gy++) {
    const y = padT + (plotH / 4) * gy;
    ctx.strokeStyle = gy === 0 ? "rgba(154,160,171,0.04)" : "rgba(154,160,171,0.06)";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.setLineDash([2, 3]);
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Vertical grid at center and quarter marks
  for (let gx = 0; gx <= 4; gx++) {
    const x = padL + (plotW / 4) * gx;
    ctx.strokeStyle = gx === 2 ? "rgba(154,160,171,0.11)" : "rgba(154,160,171,0.045)";
    ctx.lineWidth = gx === 2 ? 0.8 : 0.5;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, axisY);
    ctx.stroke();
  }
  ctx.restore();

  /* ══════════════════════════════════════════════════════════════
     LED BAR SEGMENTS — 3-layer rendering with active/dimmed opacity
     ══════════════════════════════════════════════════════════════ */
  const barCount = bars.length;
  const barGap = 2;
  const barW = Math.max(6, Math.floor((plotW - barCount * barGap) / barCount));
  const segH = 4, segGap = 1;
  const maxSegs = Math.floor(plotH / (segH + segGap));
  const totalBarsW = barCount * (barW + barGap);
  const barStartX = padL + (plotW - totalBarsW) / 2;

  // Stash geometry + values so the hover readout can resolve the cursor to
  // exact per-layer probabilities without re-rendering the canvas.
  _distHoverData[canvasId] = { bars, barStartX, barW, barGap, gen: !!gen, hasSurp };

  // sqrt scale: compress massive dynamic range so small bars are visible
  const sqrtMax = Math.sqrt(maxProb);

  // Layer opacity: active layer slightly translucent on top, others dimmed behind
  const ACTIVE_ALPHA = 0.85;
  const INACTIVE_ALPHA = 0.30;

  // Render order: inactive layers first, active layer last (on top)
  const activeLayers = [];
  if (gen) activeLayers.push("generation");
  activeLayers.push("accuracy");
  if (hasSurp) activeLayers.push("surprise");
  const renderOrder = activeLayers.filter(l => l !== active);
  if (activeLayers.includes(active)) renderOrder.push(active);

  // ── Phosphor persistence
  const prevKey = canvasId;
  const prev = _prevBars[prevKey] || [];
  const current = [];

  // Layer colors:
  //   Generation = warm amber/orange
  //   Accuracy   = phosphor yellow-green
  //   Surprise   = electric cyan
  const GEN_COLOR  = { r: 245, g: 166, b: 35 };
  const ACC_COLOR  = { r: 160, g: 220, b: 50 };
  const ACC_HIT    = { r: 255, g: 190, b: 30 };
  const SURP_COLOR = { r: 56,  g: 189, b: 248 };
  const LAYER_COLORS = { generation: GEN_COLOR, accuracy: ACC_COLOR, surprise: SURP_COLOR };

  bars.forEach((bar, i) => {
    const bx = barStartX + i * (barW + barGap);

    // Compute segment counts per layer (sqrt-scaled, each independent from baseline)
    const genSegs  = gen ? Math.round((Math.sqrt(bar.genP) / sqrtMax) * maxSegs * 0.90) : 0;
    const accSegs  = Math.round((Math.sqrt(bar.accP) / sqrtMax) * maxSegs * 0.90);
    const surpSegs = hasSurp ? Math.round((Math.sqrt(bar.surpP) / sqrtMax) * maxSegs * 0.90) : 0;
    const topSegs  = Math.max(genSegs, accSegs, surpSegs);

    // Ghost persistence
    const prevTotal = prev[i] || 0;
    const ghostSegs = Math.round(prevTotal * maxSegs * 0.55);
    current.push(topSegs / maxSegs);

    // ── Unlit segments: dark "off" LED blocks
    for (let s = 0; s < maxSegs; s++) {
      const sy = axisY - (s + 1) * (segH + segGap);
      ctx.fillStyle = "rgba(21,23,28,0.3)";
      ctx.fillRect(bx, sy, barW, segH);
    }

    // ── Ghost trail
    if (ghostSegs > topSegs) {
      for (let s = topSegs; s < ghostSegs; s++) {
        const sy = axisY - (s + 1) * (segH + segGap);
        ctx.fillStyle = "rgba(154,160,171,0.04)";
        ctx.fillRect(bx, sy, barW, segH);
      }
    }

    // ── LAYERS: rendered in order (inactive first, active last for overlay)
    const layerSegs = { generation: genSegs, accuracy: accSegs, surprise: surpSegs };
    renderOrder.forEach(layerName => {
      const segs = layerSegs[layerName];
      if (segs <= 0) return;

      const isActive = layerName === active;
      const baseAlpha = isActive ? ACTIVE_ALPHA : INACTIVE_ALPHA;

      for (let s = 0; s < segs && s < maxSegs; s++) {
        const sy = axisY - (s + 1) * (segH + segGap);
        const t = s / maxSegs;
        const bright = (0.45 + 0.55 * t) * baseAlpha;

        if (layerName === "generation") {
          ctx.fillStyle = `rgba(${GEN_COLOR.r},${GEN_COLOR.g},${GEN_COLOR.b},${bright})`;
        } else if (layerName === "accuracy") {
          if (bar.d === 0) {
            ctx.fillStyle = `rgba(${ACC_HIT.r},${ACC_HIT.g},${ACC_HIT.b},${bright})`;
          } else if (Math.abs(bar.d) <= hitRange) {
            const r = Math.round(ACC_COLOR.r + 20 * t);
            const g = Math.round(ACC_COLOR.g + 20 * t);
            const b = Math.round(ACC_COLOR.b + 15 * t);
            ctx.fillStyle = `rgba(${r},${g},${b},${bright * 0.85})`;
          } else {
            ctx.fillStyle = `rgba(34,197,94,${bright * 0.4})`;
          }
        } else {
          ctx.fillStyle = `rgba(${SURP_COLOR.r},${SURP_COLOR.g},${SURP_COLOR.b},${bright})`;
        }

        ctx.fillRect(bx + 0.5, sy, barW - 1, segH);
      }
    });

    // ── Peak hold indicator (for active layer)
    const activeSegs = layerSegs[active] || 0;
    if (activeSegs > 2) {
      const peakY = axisY - activeSegs * (segH + segGap);
      let peakColor;
      if (active === "surprise") {
        peakColor = `rgba(${SURP_COLOR.r},${SURP_COLOR.g + 30},255,0.85)`;
      } else if (active === "generation") {
        peakColor = `rgba(${GEN_COLOR.r},${GEN_COLOR.g + 20},80,0.85)`;
      } else {
        peakColor = bar.d === 0 ? "rgba(255,200,50,0.85)" : "rgba(160,230,60,0.75)";
      }
      ctx.fillStyle = peakColor;
      ctx.fillRect(bx, peakY, barW, 1.5);
    }

    // ── Subtle horizontal spill
    if (topSegs > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      let spillColor;
      if (active === "surprise" && surpSegs > 0) {
        spillColor = "rgba(56,189,248,0.02)";
      } else if (active === "generation" && gen) {
        spillColor = "rgba(245,166,35,0.02)";
      } else {
        spillColor = bar.d === 0 ? "rgba(245,180,30,0.025)" : "rgba(130,200,50,0.015)";
      }
      ctx.fillStyle = spillColor;
      ctx.fillRect(bx - 1, axisY - topSegs * (segH + segGap), barW + 2, topSegs * (segH + segGap));
      ctx.restore();
    }
  });

  _prevBars[prevKey] = current;

  // ── Rest zone overlay: tint left half and add center divider when showRests is active
  if (cfg.showRests) {
    const centerBarIdx = numSteps;
    const centerBx = barStartX + centerBarIdx * (barW + barGap) + barW / 2;

    // Tint left half with a subtle warm/red wash to distinguish rests
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const restTint = ctx.createLinearGradient(padL, 0, centerBx, 0);
    restTint.addColorStop(0, "rgba(180,80,60,0.35)");
    restTint.addColorStop(0.7, "rgba(180,80,60,0.20)");
    restTint.addColorStop(1, "rgba(180,80,60,0.10)");
    ctx.fillStyle = restTint;
    ctx.fillRect(padL, padT, centerBx - padL, plotH);
    ctx.restore();

    // Center divider line
    ctx.save();
    ctx.strokeStyle = "rgba(245,180,30,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(centerBx, padT + 2);
    ctx.lineTo(centerBx, axisY - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // "RESTS" / "NOTES" zone labels
    ctx.save();
    ctx.font = "bold 7px 'SF Mono', monospace";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(220,120,80,0.45)";
    ctx.textAlign = "right";
    ctx.fillText("RESTS", centerBx - 8, padT + 3);
    ctx.fillStyle = "rgba(34,197,94,0.4)";
    ctx.textAlign = "left";
    ctx.fillText("NOTES", centerBx + 8, padT + 3);
    ctx.restore();
  }

  // ── 3σ boundary marker
  if (hitRange > 0 && hitProb < 1) {
    ctx.save();
    ctx.setLineDash([1, 4]);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(180,210,50,0.15)";
    const hri = Math.round(hitRange / step);
    const missLeftIdx  = numSteps - hri;
    const missRightIdx = numSteps + hri;
    [missLeftIdx, missRightIdx].forEach(idx => {
      if (idx < 0 || idx >= barCount) return;
      const bx = barStartX + idx * (barW + barGap);
      const edgeX = idx === missLeftIdx ? bx - 1 : bx + barW + 1;
      ctx.beginPath();
      ctx.moveTo(edgeX, axisY - 12);
      ctx.lineTo(edgeX, axisY);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* ══════════════════════════════════════════════════════════════
     CRT POST-PROCESSING — scanlines, vignette, reflection
     ══════════════════════════════════════════════════════════════ */

  // ── Scanlines
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (let y = sY; y < sY + sH; y += 2) {
    ctx.fillStyle = "rgba(0,0,0,0.07)";
    ctx.fillRect(sX, y, sW, 1);
  }
  ctx.restore();

  // ── Vignette
  const vignette = ctx.createRadialGradient(
    sX + sW / 2, sY + sH / 2, sW * 0.2,
    sX + sW / 2, sY + sH / 2, sW * 0.6
  );
  vignette.addColorStop(0, "transparent");
  vignette.addColorStop(0.6, "rgba(0,0,0,0.1)");
  vignette.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(sX, sY, sW, sH);

  /* ══════════════════════════════════════════════════════════════
     LIVE NOTE TRACE — thin phosphor beam where the current tone sits,
     with a fading burn-in trail of the last few notes.
     ══════════════════════════════════════════════════════════════ */
  if (cfg.markerAxis) {
    const markers = recentAxisMarkers(cfg.markerAxis);
    if (markers.length) {
      const leftCx = barStartX + barW / 2;
      const spanX = Math.max(1, (barCount - 1) * (barW + barGap));
      const xForVal = (v) => {
        const cl = Math.max(-range, Math.min(range, v));
        return leftCx + ((cl + range) / (2 * range)) * spanX;
      };
      const midY = (padT + axisY) / 2;
      // Hot-core tint: blend a role colour toward white so the beam reads as a
      // glowing phosphor trace while still carrying its section's hue.
      const litent = (c, t) => `${Math.round(c.r + (255 - c.r) * t)},${Math.round(c.g + (255 - c.g) * t)},${Math.round(c.b + (255 - c.b) * t)}`;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const m of markers) {
        const ageF = Math.max(0, 1 - m.age / MARKER_TRAIL_SEC);
        const a = Math.pow(ageF, 1.6) * 0.9;
        if (a <= 0.012) continue;
        // Colour by the note's role: generation / accuracy / surprise.
        const col = LAYER_COLORS[m.role] || GEN_COLOR;

        // Notes whose value lands beyond the displayed range are NOT pinned to
        // the edge bar (that would imply a note at exactly ±range). Instead they
        // get a distinct, dimmer "over-range" chevron at the boundary, pointing
        // off-chart — analog-meter style — so the spectrum lines only sit where a
        // note actually falls within the distribution.
        const over = m.value > range ? 1 : (m.value < -range ? -1 : 0);
        if (over !== 0) {
          const edgeX = over > 0 ? leftCx + spanX : leftCx;
          const dir = over;                 // +1 points right, -1 points left
          const tipX = edgeX + dir * 7;
          const baseX = edgeX + dir * 1;
          const oa = a * 0.55;              // dimmer than an in-range beam
          // short connector tick at the boundary
          ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${oa * 0.55})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(edgeX, midY - 9); ctx.lineTo(edgeX, midY + 9); ctx.stroke();
          // chevron pointing off the chart (saturated role hue)
          ctx.strokeStyle = `rgba(${litent(col, 0.18)},${oa})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(baseX, midY - 5); ctx.lineTo(tipX, midY); ctx.lineTo(baseX, midY + 5);
          ctx.stroke();
          continue;
        }

        const x = xForVal(m.value);
        // soft phosphor halo (saturated role hue)
        ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${a * 0.38})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, padT + 1); ctx.lineTo(x, axisY - 1); ctx.stroke();
        // electron-beam core — role hue, only lightly lifted toward white so the
        // section colour stays clearly readable while the beam still glows.
        ctx.strokeStyle = `rgba(${litent(col, 0.22)},${a})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT + 1); ctx.lineTo(x, axisY - 1); ctx.stroke();
        // bloom cap on the note still sounding
        if (m.sounding) {
          ctx.fillStyle = `rgba(${litent(col, 0.55)},${Math.min(1, a + 0.12)})`;
          ctx.beginPath(); ctx.arc(x, padT + 2.5, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // ── Glass reflection
  const refl = ctx.createLinearGradient(sX, sY, sX + sW * 0.6, sY + sH * 0.5);
  refl.addColorStop(0, "rgba(255,255,255,0.015)");
  refl.addColorStop(0.3, "rgba(255,255,255,0.025)");
  refl.addColorStop(0.5, "rgba(255,255,255,0.005)");
  refl.addColorStop(1, "transparent");
  ctx.fillStyle = refl;
  ctx.fillRect(sX, sY, sW, sH);

  /* ══════════════════════════════════════════════════════════════
     LABELS — x-axis, y-axis, title, 3-item legend
     ══════════════════════════════════════════════════════════════ */

  // ── X-axis scale labels
  ctx.fillStyle = "rgba(130,150,160,0.6)";
  ctx.font = "bold 8px 'SF Mono', 'Fira Code', 'Cascadia Code', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelEvery = cfg.labelEvery || (numSteps > 8 ? 2 : 1);
  bars.forEach((bar, i) => {
    let label;
    if (cfg.barLabels) {
      // Custom per-bar labels (e.g. circular vowel names for the formant display)
      label = cfg.barLabels[i];
      if (label == null) return;
    } else {
      if (bar.d % (labelEvery * step) !== 0 && bar.d !== 0) return;
      label = bar.d === 0 ? "0" : `${bar.d > 0 ? "+" : ""}${bar.d}`;
    }
    const bx = barStartX + i * (barW + barGap) + barW / 2;
    ctx.fillText(label, bx, axisY + 5);
  });

  // ── Title (top-left)
  ctx.fillStyle = "rgba(34,197,94,0.75)";
  ctx.font = "bold 9px 'SF Mono', 'Fira Code', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText((cfg.title || "DISTRIBUTION").toUpperCase(), padL, 5);

  // ── 3-item legend (top strip)
  let legendX = padL + 80;
  const legendItems = [];
  if (gen) legendItems.push({ label: "GEN",  color: `rgba(${GEN_COLOR.r},${GEN_COLOR.g},${GEN_COLOR.b}`,  section: "generation" });
  legendItems.push({ label: "ACC",  color: `rgba(${ACC_HIT.r},${ACC_HIT.g},${ACC_HIT.b}`,  section: "accuracy" });
  legendItems.push({ label: "SURP", color: `rgba(${SURP_COLOR.r},${SURP_COLOR.g},${SURP_COLOR.b}`, section: "surprise" });

  legendItems.forEach(item => {
    const isActive = active === item.section;
    const boxAlpha = isActive ? 0.95 : 0.35;
    const textAlpha = isActive ? 0.9 : 0.4;
    ctx.fillStyle = `${item.color},${boxAlpha})`;
    ctx.fillRect(legendX, 7, 7, 7);
    ctx.fillStyle = `rgba(180,190,200,${textAlpha})`;
    ctx.font = `${isActive ? "bold " : ""}7px 'SF Mono', monospace`;
    ctx.fillText(item.label, legendX + 10, 6);
    legendX += item.label.length * 6 + 22;
  });

  // ── Y-axis label (rotated)
  ctx.save();
  ctx.fillStyle = "rgba(90,110,120,0.45)";
  ctx.font = "7px 'SF Mono', monospace";
  ctx.translate(9, padT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("PROBABILITY", 0, 0);
  ctx.restore();

  // ── X-axis descriptor + unit
  ctx.fillStyle = "rgba(90,110,120,0.45)";
  ctx.font = "7px 'SF Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(cfg.xLabel || "DEVIATION", padL + plotW / 2, H - 11);
  ctx.textAlign = "right";
  ctx.fillText(cfg.unit || "", W - 6, H - 11);
}

/* ── Legacy wrapper: drawAccuracyDist calls drawMacroDist for backward compat ── */
function drawAccuracyDist(canvasId, cfg) {
  drawMacroDist(canvasId, {
    title: cfg.title,
    activeSection: "accuracy",
    range: cfg.range,
    step: cfg.step,
    unit: cfg.unit,
    xLabel: cfg.xLabel,
    labelEvery: cfg.labelEvery,
    lockRange: cfg.lockRange,
    generation: null,
    accuracy: {
      prob: cfg.accuracyProb ?? 1,
      hitRange: Math.round((cfg.accuracySd ?? 1) * 3),
    },
    surprise: {
      amount: 0.5,
      range: cfg.surpriseDistance ?? 0.5,
      weight: cfg.surpriseEnabled
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
  });
}

function drawDurationMacroDist() {
  const beatDiv = Math.max(1, Math.round(exploreParams.beatDivisions || 1));
  const range = Math.max(2, beatDiv * 2);
  const showRests = !!exploreParams.surpriseRestEnabled;
  drawMacroDist("cvDurationAccuracy", {
    title: "Duration",
    activeSection: macroSubTab.duration || "generation",
    range,
    step: 1,
    unit: "div",
    xLabel: showRests ? "← rests   |   notes →" : "duration difference",
    labelEvery: Math.max(1, beatDiv),
    markerAxis: "duration",
    generation: null,
    accuracy: {
      prob: exploreParams.sameLengthProb ?? 0.4,
      hitRange: beatDiv,
    },
    surprise: {
      amount: exploreParams.durSurpriseAmount ?? 0.5,
      range: exploreParams.surpriseRhythmDistance ?? 0.8,
      weight: exploreParams.surpriseRhythmEnabled
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
    showRests,  // left half = rests when checked
  });
}

function drawDynamicsMacroDist() {
  const dynRange = Math.max(10, Math.ceil(((exploreParams.dynamicsRange || 0.22) * 100) / 10) * 10);
  const hitRange = exploreParams.dynamicsHitRange ?? Math.round(dynRange * 0.7);
  drawMacroDist("cvDynamicsAccuracy", {
    title: "Dynamics",
    activeSection: macroSubTab.dynamics || "generation",
    range: dynRange,
    step: 10,
    unit: "%",
    xLabel: "dynamic difference",
    labelEvery: 20,
    markerAxis: "dynamics",
    generation: null,  // dynamics variability isn't a decay curve — keep null for now
    accuracy: {
      prob: exploreParams.dynamicsPrecision ?? 0.75,
      hitRange: hitRange,
    },
    surprise: {
      amount: exploreParams.dynSurpriseAmount ?? 0.5,
      range: exploreParams.surpriseDynamicsDistance ?? 0.85,
      weight: exploreParams.surpriseDynamicsEnabled
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
  });
}

function drawFormantAccuracyDist() {
  const cv = document.getElementById("cvFormantAccuracy");
  if (!cv) return;
  ensureFormantWeights(exploreParams);
  const circle = FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]);
  if (!circle.length) return;
  // The vowels sit evenly on a circle, so the axis measures how many circular
  // steps the sung vowel lands from the intended (pure) one. The biggest possible
  // miss is half a circle — for 5 vowels that is ±2.5 steps. A miss can land
  // *between* two vowels, so the axis is continuous: fine bars, with the pure
  // vowel formants marked along it. This applies to every formant equally.
  const half = circle.length / 2;          // 2.5 for 5 vowels
  const step = 0.125;                       // fine bars so in-between misses show
  const accProb = clamp(exploreParams.formantAccuracy ?? 0.85, 0, 1);
  const accRange = Math.max(0, Math.min(half, Number(exploreParams.formantAccuracyRange ?? 1)));
  const dist = clamp(exploreParams.surpriseFormantDistance ?? 0.85, 0, 1);
  const surpriseOn = !!exploreParams.surpriseFormantEnabled;

  // Mark the pure-vowel positions: the integer step offsets carry the actual
  // vowel names (centred on the neutral vowel) and the half-circle edges carry
  // the numeric ± limit so the range is legible at a glance.
  const centerIdx = Math.floor(circle.length / 2);
  const numSteps = Math.floor(half / step + 1e-9);
  const barLabels = [];
  for (let i = -numSteps; i <= numSteps; i++) {
    const v = i * step;                     // -2.5 .. +2.5
    if (Math.abs(Math.abs(v) - half) < step / 2) {
      barLabels.push(`${v > 0 ? "+" : "−"}${half}`);   // half-circle edge
    } else if (Math.abs(v - Math.round(v)) < step / 2) {
      const off = Math.round(v);
      const idx = ((centerIdx + off) % circle.length + circle.length) % circle.length;
      barLabels.push(circle[idx]);                          // pure vowel marker
    } else {
      barLabels.push(null);
    }
  }

  // Reuse the shared LED-bar CRT renderer so the formant distribution matches
  // the melody / tuning / duration / dynamics displays. No generation layer —
  // formant generation picks any vowel equally (no note-to-note interval).
  // Accuracy (hit prob + miss range) and surprise (miss range) only.
  drawMacroDist("cvFormantAccuracy", {
    title: "Formant",
    activeSection: surpriseOn ? "surprise" : "accuracy",
    range: half,
    step,
    unit: "½ circle",
    xLabel: "vowel position — pure vowels marked, ± half circle max",
    barLabels,
    lockRange: true,
    generation: null,
    accuracy: {
      prob: accProb,
      hitRange: accRange,
    },
    surprise: {
      amount: 0.5,
      range: dist,
      weight: surpriseOn
        ? Math.max(0, Math.min(1, exploreParams.surpriseChance ?? 0.08))
        : 0,
    },
  });
}

function formantDisplaySequence() {
  const preferred = FORMANT_CIRCLE;
  const keys = Object.keys(FORMANT_PRESETS);
  const ordered = preferred.filter(k => keys.includes(k));
  keys.forEach(k => { if (!ordered.includes(k)) ordered.push(k); });
  return [...ordered, ...ordered, ...ordered.slice(0, 2)];
}

function drawRootPullDist() {
  const cv = document.getElementById("cvRoot");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const strength = exploreParams.rootPullStrength;
  const shape = exploreParams.rootPullShape;

  // Draw pull strength across phrase position (0 to 1)
  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const pos = x / w;
    const pull = strength * (1 - shape + shape * pos);
    const y = h - pull * (h - 4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const pos = x / w;
    const pull = strength * (1 - shape + shape * pos);
    const y = h - pull * (h - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Labels
  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("start", 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText("end", w - 2, h - 2);
}

function drawRegisterDist() {
  const cv = document.getElementById("cvRegister");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const center = exploreParams.registerCenter;
  const width = exploreParams.registerWidth;
  const skew = exploreParams.registerSkew;
  const range = 36; // display range: -range to +range degrees

  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const deg = -range + (x / w) * 2 * range;
    const offset = deg - center;
    const val = registerCurveValue(offset, width, skew);
    const y = h - val * (h - 4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const deg = -range + (x / w) * 2 * range;
    const offset = deg - center;
    const val = registerCurveValue(offset, width, skew);
    const y = h - val * (h - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Centre line
  const cx = ((center + range) / (2 * range)) * w;
  ctx.strokeStyle = "rgba(59,130,246,0.5)";
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Labels
  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("low", 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText("high", w - 2, h - 2);
}

function registerCurveValue(offset, width, skew) {
  // Flat-topped window — mirrors registerWindow() in synth.js so the displayed
  // curve matches what the engine actually does (a plateau, not a centre peak).
  const w = Math.max(1, Number(width) || 1);
  const side = offset >= 0 ? 1 : -1;
  const halfWidth = Math.max(1, w * 0.5 * (1 + skew * side * 0.75));
  const flatness = Math.max(0, Math.min(1, (w - 2) / 12));
  const shapeExp = 2 + flatness * 6;
  return Math.exp(-0.5 * Math.pow(Math.abs(offset / halfWidth), shapeExp));
}

function intervalShapeWeight(stepDist, shape, maxRange) {
  // Mirrors intervalShapeWeight() in synth.js so the plotted curve matches the
  // engine: a Gaussian whose σ shrinks geometrically from ~flat (uniform / equal
  // probability across the range) at the bottom of the dial toward a sharp point
  // at the top.
  const range = Math.max(1, Number(maxRange) || 1);
  const ad = Math.abs(Number(stepDist) || 0);
  if (ad > range) return 0;
  const t = clamp((Number(shape) || 0) / 4, 0, 1);
  const sigmaMin = 0.35;
  const sigmaMax = range * 5;
  const sigma = sigmaMin * Math.pow(sigmaMax / sigmaMin, 1 - t);
  return Math.exp(-0.5 * Math.pow(ad / sigma, 2));
}

function loudnessRegisterValue(offset, range) {
  // Flat-topped window over the loudness axis — the loudness analogue of
  // registerCurveValue(). The plateau is where loudness settles; the falloff
  // marks the soft/loud limits. Wider range → flatter, wider plateau.
  const half = Math.max(0.02, (Number(range) || 0) / 2);
  const flatness = Math.max(0, Math.min(1, Number(range) || 0));
  const shapeExp = 2 + flatness * 6;
  return Math.exp(-0.5 * Math.pow(Math.abs(offset / half), shapeExp));
}

function drawLoudnessRegisterDist() {
  const cv = document.getElementById("cvLoudnessRegister");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  // Loudness register: a flat-topped window across the soft→loud axis, centred
  // on the dynamic centre and spanning the register range. It mirrors the
  // melodic register exactly and depends ONLY on centre + range — never on
  // accuracy (reproduction) or generation (note-to-note variability).
  const center = clamp(Number(exploreParams.dynamicsLevel ?? 0.62), 0.05, 1);
  const range = Math.max(0, Number(exploreParams.loudnessRange ?? 0.6));

  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const val = loudnessRegisterValue(x / w - center, range);
    const y = h - val * (h - 4);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const val = loudnessRegisterValue(x / w - center, range);
    const y = h - val * (h - 4);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Soft/loud limit markers (± half-range) and centre line.
  const half = range / 2;
  ctx.strokeStyle = "rgba(245,158,11,0.35)";
  ctx.setLineDash([1, 3]);
  for (const lim of [center - half, center + half]) {
    if (lim <= 0 || lim >= 1) continue;
    ctx.beginPath();
    ctx.moveTo(lim * w, 0); ctx.lineTo(lim * w, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const cx = center * w;
  ctx.strokeStyle = "rgba(59,130,246,0.5)";
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.stroke();
  ctx.setLineDash([]);

  // Labels
  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("soft", 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText("loud", w - 2, h - 2);
}

function drawGapDist() {
  const cv = document.getElementById("cvGap");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const minGap = Math.min(exploreParams.gapMin ?? 0, exploreParams.gapMax ?? 0);
  const maxGap = Math.max(exploreParams.gapMin ?? 0, exploreParams.gapMax ?? 0);
  const slope = exploreParams.gapDistanceSlope ?? 0;
  const range = exploreParams.gapTimingRange ?? 0;
  const chance = exploreParams.gapProb ?? 1;
  const midY = h / 2;
  const amp = h / 2 - 6;
  const valueToY = (value) => midY - clamp(value, -0.92, 0.92) / 0.92 * amp;

  const gapAt = (x) => {
    const interval = x / w;
    const even = (minGap + maxGap) / 2;
    const sloped = minGap + (maxGap - minGap) * interval;
    return clamp(even * (1 - slope) + sloped * slope, -0.92, 0.92);
  };

  const bandPath = () => {
    ctx.beginPath();
    ctx.moveTo(0, valueToY(gapAt(0) + range));
    for (let x = 0; x <= w; x++) {
      ctx.lineTo(x, valueToY(gapAt(x) + range));
    }
    for (let x = w; x >= 0; x--) {
      ctx.lineTo(x, valueToY(gapAt(x) - range));
    }
    ctx.closePath();
  };

  ctx.fillStyle = "rgba(59,130,246,0.055)";
  ctx.fillRect(0, midY, w, h - midY);
  ctx.fillStyle = "rgba(245,158,11,0.045)";
  ctx.fillRect(0, 0, w, midY);

  ctx.strokeStyle = "rgba(136,153,170,0.13)";
  ctx.lineWidth = 1;
  [-0.5, 0.5].forEach(v => {
    const y = valueToY(v);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });

  ctx.strokeStyle = "rgba(226,232,240,0.62)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, midY);
  ctx.clip();
  ctx.fillStyle = `rgba(245,158,11,${0.08 + chance * 0.14})`;
  bandPath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, midY, w, h - midY);
  ctx.clip();
  ctx.fillStyle = `rgba(59,130,246,${0.08 + chance * 0.14})`;
  bandPath();
  ctx.fill();
  ctx.restore();

  for (let x = 0; x < w; x += 2) {
    const v1 = gapAt(x);
    const v2 = gapAt(Math.min(w, x + 2));
    ctx.strokeStyle = ((v1 + v2) / 2) >= 0 ? "rgba(245,158,11,0.90)" : "rgba(96,165,250,0.92)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x, valueToY(v1));
    ctx.lineTo(Math.min(w, x + 2), valueToY(v2));
    ctx.stroke();
  }

  const speed = clamp(exploreParams.slideSpeed ?? 0.65, 0, 1);
  const slideY = h - 12;
  ctx.strokeStyle = `rgba(96,165,250,${0.28 + speed * 0.5})`;
  ctx.lineWidth = 1.2;
  for (let x = 24; x < w - 24; x += 44) {
    const len = 10 + speed * 18;
    ctx.beginPath();
    ctx.moveTo(x, slideY);
    ctx.lineTo(x + len, slideY - 6);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "8px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("connect / slide", 4, h - 4);
  ctx.fillText("gap / silence", 4, 8);
  ctx.textAlign = "right";
  ctx.fillText("near -> far", w - 4, 8);
  ctx.fillText("0", w - 2, midY - 3);
}

function drawReverbDist() {
  const cv = document.getElementById("cvReverb");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const profile = REVERB_PROFILES[exploreParams.reverbType] || REVERB_PROFILES.room;
  const wet = exploreParams.reverbWet || 0;
  const decay = exploreParams.reverbDecay || 1.4;
  const tone = exploreParams.reverbTone || 0.6;
  const preDelay = exploreParams.reverbPreDelay || 0;
  const duration = Math.max(0.15, profile.duration * decay);
  const pad = 4;
  const predelayX = Math.min(w - 8, pad + (preDelay / Math.max(0.25, duration)) * (w - pad * 2));

  ctx.fillStyle = `rgba(245,158,11,${0.04 + wet * 0.14})`;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(136,153,170,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  ctx.strokeStyle = "rgba(59,130,246,0.34)";
  ctx.lineWidth = 1;
  for (let r = 0; r < 10; r++) {
    const x = predelayX + r * (5 + profile.early * 4);
    if (x >= w - pad) break;
    const amp = (0.72 / (r + 1)) * profile.early;
    ctx.beginPath();
    ctx.moveTo(x, h - pad);
    ctx.lineTo(x, h - pad - amp * (h - pad * 2));
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(245,158,11,0.86)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = predelayX; x <= w - pad; x++) {
    const t = (x - predelayX) / Math.max(1, w - pad - predelayX);
    const env = Math.pow(1 - t, profile.shape) * Math.exp(-t * (1.2 + (1 - tone) * 2.2));
    const ripple = profile.shimmer * Math.sin(t * Math.PI * 24) * Math.pow(1 - t, 1.8);
    const y = h - pad - Math.max(0, env + ripple * 0.12) * wet * (h - pad * 2);
    if (x === Math.round(predelayX)) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.fillStyle = "rgba(136,153,170,0.72)";
  ctx.font = "8px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(profile.label, 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText(`${duration.toFixed(1)}s`, w - 2, h - 2);
}


function drawVibratoDist() {
  const canvases = document.querySelectorAll(".js-vibrato-canvas");
  if (!canvases.length) return;
  const chance = clamp(exploreParams.vibratoProb ?? 0, 0, 1);
  const depth = Math.max(0, exploreParams.vibratoDepth ?? 0);
  const depthSd = Math.max(0, exploreParams.vibratoDepthSd ?? 0);
  const rate = Math.max(0.1, exploreParams.vibratoRate ?? 5.5);
  const rateSd = Math.max(0, exploreParams.vibratoRateSd ?? 0);

  canvases.forEach(cv => {
    const { ctx, w, h } = crisp2d(cv);
    const mid = h / 2;
    const maxDepth = Math.max(6, depth + depthSd * 2.5);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(59,130,246,0.045)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(136,153,170,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();

    const yFor = cents => mid - (cents / maxDepth) * (h * 0.38);
    const path = (seed, isMean = false) => {
      ctx.beginPath();
      let phase = 0;
      let localDepth = depth;
      let localRate = rate;
      for (let x = 0; x <= w; x++) {
        const t = x / w;
        if (!isMean && x % 42 === 0) {
          const a = Math.sin(seed * 9.91 + x * 0.37);
          const b = Math.sin(seed * 4.17 + x * 0.19);
          localDepth = Math.max(0, depth + a * depthSd);
          localRate = Math.max(0.25, rate + b * rateSd);
        }
        phase += (localRate / rate) * 0.075;
        const cents = Math.sin(phase * Math.PI * 2) * localDepth;
        const y = yFor(cents);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    };

    for (let i = 1; i <= 3; i++) {
      ctx.strokeStyle = `rgba(226,232,240,${0.10 + chance * 0.08})`;
      ctx.lineWidth = 1;
      path(i, false);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(96,165,250,${0.34 + chance * 0.5})`;
    ctx.lineWidth = 1.6;
    path(0, true);
    ctx.stroke();

    ctx.fillStyle = "rgba(136,153,170,0.74)";
    ctx.font = "8px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("cycle samples", 4, 8);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(depth)}c @ ${rate.toFixed(1)}Hz`, w - 4, h - 4);
  });
}


// ── Pro-audio rotary knobs for the tone chain (T-Q5 owner feedback:
// the stage cards must read as an instrument, and every turn of a dial
// must visibly answer in the print) ────────────────────────────────
const KNOB_EMPHASIS = {
  excitationType: "comb", excitationPosition: "comb", excitationHardness: "comb",
  excitationHuman: "needles", spectralDynamicAmount: "needles",
  partialMaterial: "glow", partialB: "shift", partialTransfer: "arcs",
  partialTilt: "needles", spectralPartials: "needles",
  bodyType: "ridge", spectralResonanceAmount: "ridge", bodyArticulation: "ridge",
  formantF1Level: "ridge", formantF2Level: "ridge", formantF3Level: "ridge", formantF4Level: "ridge", formantF5Level: "ridge",
};
let _printEmphasis = null; // { kind, until } — the overlay a fresh change lights up
let _printGhosts = null; // pre-change needle dots, shown while emphasis is fresh
function printEmphasis(key) {
  const kind = KNOB_EMPHASIS[key];
  if (!kind) return;
  if (_printGeom && _printGeom.needles.length) {
    _printGhosts = _printGeom.needles.map(n => ({ i: n.i, x: n.x, topY: n.topY }));
  }
  _printEmphasis = { kind, until: performance.now() + 750 };
  clearTimeout(printEmphasis._t);
  printEmphasis._t = setTimeout(() => { _printEmphasis = null; _printGhosts = null; drawTonePrint(); drawBodyRidge(); }, 780);
}
function _emph(kind) {
  return !!(_printEmphasis && _printEmphasis.kind === kind && performance.now() < _printEmphasis.until);
}

function knobArcs(frac, cool) {
  const f = clamp(frac, 0, 1);
  const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI, a = a0 + f * (a1 - a0);
  const c = 22, r = 16;
  const pt = (ang) => `${(c + r * Math.cos(ang)).toFixed(2)} ${(c + r * Math.sin(ang)).toFixed(2)}`;
  const arc = (from, to, col, w) =>
    `<path d="M ${pt(from)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${pt(to)}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  const hue = cool ? "#4f8dd4" : "#f5a623";
  const tip = cool ? "#bcd8f4" : "#ffe3b0";
  return arc(a0, a1, "rgba(49,69,86,0.9)", 4)
    + (f > 0.002 ? arc(a0, a, hue, 4) : "")
    + `<line x1="${(c + 6 * Math.cos(a)).toFixed(2)}" y1="${(c + 6 * Math.sin(a)).toFixed(2)}" x2="${(c + (r - 3) * Math.cos(a)).toFixed(2)}" y2="${(c + (r - 3) * Math.sin(a)).toFixed(2)}" stroke="${tip}" stroke-width="2.4" stroke-linecap="round"/>`;
}

function knobHTML(key, label, value, min, max, step, opts = {}) {
  const v = Number.isFinite(value) ? value : min;
  return `
    <div class="knob-cell${opts.cool ? " cool" : ""}" data-knob="${key}" data-min="${min}" data-max="${max}" data-step="${step}" data-def="${opts.def ?? v}" title="${esc(PARAM_DESC[key] || label)}">
      <svg class="knob-svg" viewBox="0 0 44 44">${knobArcs((v - min) / (max - min), !!opts.cool)}</svg>
      <div class="knob-label">${esc(label)}</div>
      <output class="knob-out" id="out_${key}">${fmtOutput(key, v)}</output>
    </div>`;
}

function _setKnobVisual(cell, frac) {
  const svg = cell.querySelector(".knob-svg");
  if (svg) svg.innerHTML = knobArcs(frac, cell.classList.contains("cool"));
}

// ── CHORDA: stage rail, inspector, focus system ─────────────────────
// Owner-chosen direction (docs/mockups/tone-alt-freshtake.html): the
// chain is a rail of live-thumbnail cards; the selected stage expands
// into the inspector; the partial field is the one shared display.

let _chStage = "excitor";
let _chFocus = { chip: "all", lensLo: null, lensHi: null };

function noteNameForHz(hz) {
  const midi = Math.round(69 + 12 * Math.log2(Math.max(20, hz) / 440));
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}
function noteAndCents(hz) {
  const exact = 69 + 12 * Math.log2(Math.max(20, hz) / 440);
  const midi = Math.round(exact);
  const cents = Math.round((exact - midi) * 100);
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}${cents === 0 ? "" : (cents > 0 ? "+" : "") + cents + "¢"}`;
}

function chCardSummary(p, stage) {
  if (stage === "excitor") {
    return `${p.excitationType || "bow"} · pos ${(p.excitationPosition ?? 0.13).toFixed(2)} · human ${(p.excitationHuman ?? 0.4).toFixed(2)}`;
  }
  if (stage === "resonator") {
    const B = Number.isFinite(p.partialB) ? p.partialB : legacyStretchToB(p.spectralStretchCents || 0);
    return `mat ${(p.partialMaterial ?? 0.45).toFixed(2)} · ${B > 0 ? fmtOutput("partialB", B) : "harmonic"} · xfer ${(p.partialTransfer ?? 0.15).toFixed(2)} · ${Math.round(p.spectralPartials || 20)}p`;
  }
  if (stage === "body") {
    const label = !p.bodyType || p.bodyType === "auto" ? "auto" : (BODY_PRESETS[p.bodyType]?.label || p.bodyType);
    return `${label} · amount ${(p.spectralResonanceAmount ?? 0.35).toFixed(2)}`;
  }
  return `${(p.spaceDistance ?? 2.5).toFixed(1)} m · ${Math.round(p.spaceAzimuth ?? 0)}° · wet ${(p.reverbWet ?? 0).toFixed(2)}`;
}

function chRailCardHTML(p, stage, num, name) {
  return `
    <button class="ch-card ch-${stage}${_chStage === stage ? " active" : ""}" data-ch-stage="${stage}">
      <div class="ch-card-head"><span class="ch-card-n">${num} ${name}</span><span class="ch-dot"></span></div>
      <canvas class="ch-thumb" id="chThumb_${stage}" width="380" height="64"></canvas>
      <div class="ch-card-sum">${esc(chCardSummary(p, stage))}</div>
    </button>`;
}

// ── BODY bands as first-class objects (owner: "use the body settings as a
// preset and then still be able to change the eq of each") ──
// The selected body preset seeds an editable band list; the first gain edit
// copies it onto the instrument (p.bodyBands) so later preset browsing never
// silently discards the user's shaping. Articulation formants F1-F5 appear
// as chips of their own when depth > 0.
let _chBodySel = null;
let _chPerfOpen = false; // EXCITOR performance drawer state across re-renders // { kind: "base" | "artic", i } — chip → highlighted EQ curve in the field

function currentBaseBodyBands(p) {
  if (Array.isArray(p.bodyBands) && p.bodyBands.length) return p.bodyBands;
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  return bodyBandsFor(p, profile);
}

function articChipBands(p) {
  if ((p.bodyArticulation ?? 0) <= 0) return [];
  const focus = (p.formantFocus && VOWEL_POINTS[p.formantFocus]) ? p.formantFocus
    : (p.activeFormants || []).find(k => VOWEL_POINTS[k]) || "ah";
  const f = formantFreqsAtPoint(VOWEL_POINTS[focus]);
  return [f.f1, f.f2, f.f3, f.f4, f.f5].map(freq => ({ freq }));
}

function bodyBandChipsHTML(p) {
  const fmtF = (f) => f >= 1000 ? `${(f / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(f)}`;
  const base = currentBaseBodyBands(p);
  const artic = articChipBands(p);
  if (_chBodySel && !(_chBodySel.kind === "artic" ? artic : base)[_chBodySel.i]) _chBodySel = null;
  const chip = (kind, i, label) => {
    const on = _chBodySel && _chBodySel.kind === kind && _chBodySel.i === i;
    return `<button class="ch-chip band-chip${kind === "artic" ? " artic" : ""}${on ? " active" : ""}" data-body-band="${kind}:${i}">${label}</button>`;
  };
  let editor = "";
  if (_chBodySel) {
    const { kind, i } = _chBodySel;
    const isArt = kind === "artic";
    const val = isArt ? (p[`formantF${i + 1}Level`] ?? 1) : (base[i]?.gain ?? 1);
    const min = isArt ? 0 : -2, max = isArt ? 2 : 3.5;
    const name = isArt ? `formant F${i + 1}` : `band B${i + 1}`;
    editor = `
      <div class="body-band-edit">
        <span class="body-band-name">${name} · ${fmtF((isArt ? artic : base)[i].freq)} Hz</span>
        <input type="range" data-body-gain min="${min}" max="${max}" step="0.05" value="${val}">
        <span class="body-band-out" id="bodyBandOut">${isArt ? `×${val.toFixed(2)}` : `${val >= 0 ? "+" : ""}${val.toFixed(2)}`}</span>
      </div>`;
  }
  return `
    <div class="body-band-strip">
      ${base.map((b, i) => chip("base", i, `B${i + 1} ${fmtF(b.freq)}`)).join("")}
      ${artic.map((b, i) => chip("artic", i, `F${i + 1} ${fmtF(b.freq)}`)).join("")}
      ${Array.isArray(p.bodyBands) && p.bodyBands.length ? `<button class="ch-chip band-reset" data-body-reset title="Discard band edits and reload the preset's bands">↺ preset</button>` : ""}
    </div>${editor}`;
}

function chInspectorHTML(p) {
  if (_chStage === "excitor") {
    return `
      <div class="ch-ins-head"><span class="ch-card-n">01 · EXCITOR</span><span class="ch-ins-d">how energy enters</span></div>
      <div class="seg-control" role="group">
        ${["bow", "pluck", "strike", "blow"].map(t =>
          `<button class="seg-btn${p.excitationType === t ? " active" : ""}" data-exc-type="${t}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join("")}
      </div>
      <div class="knob-row">
        ${knobHTML("excitationPosition", "Position", p.excitationPosition, 0.02, 0.5, 0.01, { def: 0.13 })}
        ${knobHTML("excitationHardness", "Hardness", p.excitationHardness, 0, 1, 0.01, { def: 0.6 })}
      </div>
      <div class="knob-row">
        ${knobHTML("excitationHuman", "Human", p.excitationHuman, 0, 1, 0.01, { def: 0.4 })}
        ${knobHTML("spectralDynamicAmount", "Dynamics", p.spectralDynamicAmount, 0, 1.5, 0.01, { def: 0.8 })}
        ${knobHTML("toneBreath", "Breath", p.toneBreath, 0, 0.4, 0.01, { def: 0.03 })}
      </div>
      <canvas class="ch-string" id="cvStringDiag" width="400" height="56"></canvas>
      <details class="ch-perf" ${_chPerfOpen ? "open" : ""} id="chPerfDetails">
        <summary>Performance — envelope · vibrato · onset noise</summary>
        ${envelopeProbBlockHTML(p)}
        ${vibratoBlockHTML(p)}
        <div class="knob-row">
          ${knobHTML("attackNoiseLevel", "Onset noise", p.attackNoiseLevel ?? 1, 0, 2, 0.01, { def: 1 })}
        </div>
      </details>
      <div class="ch-caption">position decides which modes can be driven — a partial with a node under the ${p.excitationType === "strike" ? "hammer" : p.excitationType === "pluck" ? "finger" : p.excitationType === "blow" ? "jet" : "bow"} falls silent; watch the dips in the field</div>`;
  }
  if (_chStage === "resonator") {
    return `
      <div class="ch-ins-head"><span class="ch-card-n">02 · RESONATOR</span><span class="ch-ins-d">what rings, how long, what couples</span></div>
      <div class="knob-row">
        ${knobHTML("partialMaterial", "Material", p.partialMaterial, 0, 1, 0.01, { def: 0.45 })}
        ${knobHTML("partialB", "Inharmonic", Number.isFinite(p.partialB) ? p.partialB : legacyStretchToB(p.spectralStretchCents || 0), 0, 0.002, 0.00002, { def: 0 })}
      </div>
      <div class="knob-row">
        ${knobHTML("partialTransfer", "Transfer", p.partialTransfer, 0, 1, 0.01, { def: 0.15 })}
        ${knobHTML("partialTilt", "Brightness", p.partialTilt, -1, 1, 0.01, { def: 0 })}
      </div>
      <div class="knob-row">
        ${knobHTML("spectralPartials", "Harmonics", p.spectralPartials, 1, 64, 1, { def: 20 })}
      </div>
      <div class="ch-caption">material sets each partial's ring time from its REAL frequency; transfer lets true-ratio neighbours feed each other — inharmonicity detunes them apart</div>`;
  }
  if (_chStage === "body") {
    return `
      <div class="ch-ins-head"><span class="ch-card-n">03 · BODY</span><span class="ch-ins-d">the box around it</span></div>
      <select data-param-select="bodyType" id="sel_bodyType" class="param-select body-select">
        <option value="auto"${(p.bodyType || "auto") === "auto" ? " selected" : ""}>Auto (instrument)</option>
        ${Object.entries(BODY_PRESETS).map(([k, b]) =>
          `<option value="${k}"${p.bodyType === k ? " selected" : ""}>${esc(b.label)}</option>`).join("")}
      </select>
      ${bodyBandChipsHTML(p)}
      <div class="knob-row">
        ${knobHTML("spectralResonanceAmount", "Amount", p.spectralResonanceAmount, 0, 1.5, 0.01, { def: 0.35, cool: true })}
        ${knobHTML("bodyArticulation", "Articulate", p.bodyArticulation ?? (p.bodyType === "vocal" ? 1 : 0), 0, 1, 0.01, { def: 0, cool: true })}
        ${(p.bodyArticulation ?? 0) > 0 ? knobHTML("formantChangeProb", "Vowel walk", p.formantChangeProb, 0, 1, 0.01, { def: 0.25, cool: true }) : ""}
      </div>
      ${(p.bodyArticulation ?? 0) > 0 ? `
        <div class="ch-artic">
          ${formantWeightControlsHTML(p)}
          ${featureSurpriseBlock("formant", "Vowel", "surpriseFormantEnabled", null, p.surpriseFormantEnabled, p.surpriseFormantDistance)}
          <div class="knob-row">
            ${knobHTML("toneFormantDrift", "Drift", p.toneFormantDrift, 0, 0.5, 0.01, { def: 0.08, cool: true })}
            ${knobHTML("toneResonanceDrift", "Width drift", p.toneResonanceDrift, 0, 0.8, 0.01, { def: 0.12, cool: true })}
            ${knobHTML("formantBandwidth", "Band width", p.formantBandwidth, 0.4, 2.5, 0.01, { def: 1, cool: true })}
          </div>
        </div>` : `<canvas class="body-mini" id="cvBodyRidge" width="440" height="72"></canvas>`}
      <div class="ch-caption">${(p.bodyArticulation ?? 0) > 0
        ? "ARTICULATION rides on the selected body: the vowel EQ layers over its bands at the chosen depth — a violin body can sing. Click a band chip to see and reshape its EQ in the field"
        : "the body is a PRESET you can edit: click a band chip to see its EQ curve in the field and drag the Band gain knob to make it more or less extreme"}</div>`;
  }
  return `
    <div class="ch-ins-head"><span class="ch-card-n">04 · SPACE</span><span class="ch-ins-d">${esc(REVERB_PROFILES[p.reverbType]?.label || p.reverbType || "room")}</span></div>
    <canvas class="space-pad" id="cvSpacePad" width="280" height="170"></canvas>
    <div class="ts-space-link" id="spaceReadout">${(p.spaceDistance ?? 2.5).toFixed(1)} m · ${Math.round(p.spaceAzimuth ?? 0)}°</div>
    <div class="knob-row">
      ${knobHTML("reverbWet", "Wet", p.reverbWet, 0, 0.95, 0.01, { def: 0.16, cool: true })}
      ${knobHTML("reverbDecay", "Decay", p.reverbDecay, 0.2, 8, 0.1, { def: 1.4, cool: true })}
      ${knobHTML("earDistance", "Ear span", p.earDistance ?? 0.175, 0.12, 0.25, 0.005, { def: 0.175, cool: true })}
      ${knobHTML("headDensity", "Head density", p.headDensity ?? 0.5, 0, 1, 0.01, { def: 0.5, cool: true })}
    </div>
    <div class="ch-caption">the full circle: drag anywhere around your head — behind you (shaded half) sounds duller via the pinna law. Distance delays arrival (~3 ms/m), softens highs, trades direct for room; ear span and head density shape the interaural cues</div>`;
}

// Stage thumbnails: each card's live mini-visualisation, computed from the
// same laws as the engine.
function drawChThumbs() {
  const p = exploreParams;
  const f0 = p.tonicHz || 261.63;
  const th = (id) => {
    const cv = document.getElementById(id);
    if (!cv) return null;
    const g = crisp2d(cv);
    g.ctx.clearRect(0, 0, g.w, g.h);
    return g;
  };
  // 01 excitor: drive × comb bar spectrum
  let g = th("chThumb_excitor");
  if (g) {
    const type = p.excitationType || "bow";
    const pos = Number.isFinite(p.excitationPosition) ? p.excitationPosition : 0.13;
    const hard = Number.isFinite(p.excitationHardness) ? p.excitationHardness : 0.6;
    const ref = excitationSpectrum(type, 1, { position: pos, hardness: hard, freqHz: f0 });
    const hot = _emph("comb");
    g.ctx.fillStyle = hot ? "#ffd28a" : "rgba(245,166,35,0.75)";
    const n0 = 24, bw = g.w / n0;
    for (let n = 1; n <= n0; n++) {
      const v = ref > 0 ? excitationSpectrum(type, n, { position: pos, hardness: hard, freqHz: n * f0 }) / ref : 0;
      const bh = Math.pow(Math.min(1, v), 0.5) * (g.h - 6);
      g.ctx.fillRect((n - 1) * bw + 1, g.h - 3 - bh, Math.max(1, bw - 2), bh);
    }
  }
  // 02 resonator: T60-vs-frequency law
  g = th("chThumb_resonator");
  if (g) {
    const mat = Math.max(0, Math.min(1, p.partialMaterial ?? 0.45));
    g.ctx.beginPath();
    for (let px = 0; px <= g.w; px += 3) {
      const f = 60 * Math.pow(12000 / 60, px / g.w);
      const t60 = materialT60(f, mat);
      const y = g.h - 4 - clamp((Math.log10(t60) + 1.3) / 2.3, 0, 1) * (g.h - 8);
      px === 0 ? g.ctx.moveTo(px, y) : g.ctx.lineTo(px, y);
    }
    g.ctx.strokeStyle = "rgba(88,166,255,0.85)";
    g.ctx.lineWidth = 1.6;
    g.ctx.stroke();
  }
  // 03 body: resonance curve
  g = th("chThumb_body");
  if (g) {
    const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
    const bands = bodyBandsFor(p, profile);
    const amount = clamp(p.spectralResonanceAmount ?? 0.35, 0, 1.5);
    g.ctx.beginPath();
    for (let px = 0; px <= g.w; px += 3) {
      const f = 60 * Math.pow(12000 / 60, px / g.w);
      const r = bodyResponse(bands, f, amount);
      g.ctx.lineTo(px, g.h - 4 - (Math.log2(r) + 2.4) / 4.6 * (g.h - 8));
    }
    g.ctx.strokeStyle = "rgba(180,142,222,0.85)";
    g.ctx.lineWidth = 1.6;
    g.ctx.stroke();
  }
  // 04 space: mini room plan (Q4: full circle, listener centred)
  g = th("chThumb_space");
  if (g) {
    const cx = g.w / 2, cy = g.h / 2, rMax = Math.min(g.h / 2 - 4, g.w / 2 - 6);
    g.ctx.strokeStyle = "rgba(88,214,169,0.3)";
    for (const dm of [1, 10]) {
      const r = _spaceDistToR(dm, rMax);
      g.ctx.beginPath(); g.ctx.arc(cx, cy, r, 0, 2 * Math.PI); g.ctx.stroke();
    }
    const d = clamp(p.spaceDistance ?? 2.5, SPACE_DMIN, SPACE_DMAX);
    const az = (clamp(p.spaceAzimuth ?? 0, -180, 180) - 90) * Math.PI / 180;
    const r = _spaceDistToR(d, rMax);
    g.ctx.fillStyle = "#58d6a9";
    g.ctx.beginPath();
    g.ctx.arc(cx + Math.cos(az) * r, cy + Math.sin(az) * r, 3, 0, 2 * Math.PI);
    g.ctx.fill();
    g.ctx.fillStyle = "rgba(200,215,230,0.8)";
    g.ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }
  drawStringDiag();
  // rail summaries track live values
  document.querySelectorAll("#chRail .ch-card").forEach(card => {
    const sum = card.querySelector(".ch-card-sum");
    if (sum) sum.textContent = chCardSummary(p, card.dataset.chStage);
  });
}

// ── T7: the tone print — the resonator's interactive view ──────────
// One display, engine-true: the partial set comes from the SAME
// fingerprint code playback uses (Human forced to 0 for a noise-free
// print). Needles sit at realised Hz; afterglow length = ring time;
// the body ridge and excitor comb overlays show stages 3 and 1.

let _printState = { sel: null, band: "all" };
let _printGeom = null;

const PRINT_FMIN = 40, PRINT_FMAX = 18000;
const PRINT_BANDS = {
  all: [PRINT_FMIN, PRINT_FMAX], fund: [PRINT_FMIN, 160], low: [160, 500],
  mid: [500, 2000], presence: [2000, 6000], air: [6000, PRINT_FMAX],
};

function tonePrintModel() {
  ensureSpectralPartialParams(exploreParams);
  const engine = new GenerationEngine({ ...exploreParams, excitationHuman: 0 });
  const fp = engine._spectralFingerprint(0.62, exploreParams.tonicHz || 261.63, 0);
  // fingerprint above ran with formantPos null → fp.bodyBands is the BASE
  // body only; compute the vowel layer at the focus vowel for the overlay
  fp.baseBands = fp.bodyBands || [];
  const focus = (exploreParams.formantFocus && VOWEL_POINTS[exploreParams.formantFocus]) ? exploreParams.formantFocus
    : (exploreParams.activeFormants || []).find(k => VOWEL_POINTS[k]) || "ah";
  fp.articBands = engine._articulatedBands(VOWEL_POINTS[focus]) || [];
  return fp;
}

function chFocusPass(needle, allNeedles) {
  if (_chFocus.lensLo != null && (needle.freq < _chFocus.lensLo || needle.freq > _chFocus.lensHi)) return false;
  const c = _chFocus.chip;
  if (c === "odd") return needle.harmonic % 2 === 1;
  if (c === "even") return needle.harmonic % 2 === 0;
  if (c === "longring") return needle.t60 > 2;
  if (c === "wobbly") return (needle.sens ?? 0) > 0.6;
  if (c === "coupled") {
    return allNeedles.some(o => o.i !== needle.i && o.mean > needle.mean * 0.5 &&
      transferCoupling(needle.freq, o.freq) > 0.15);
  }
  return true;
}

function drawTonePrint() {
  const cv = document.getElementById("cvTonePrint");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const fp = tonePrintModel();
  const parts = fp.harmonicPartials;
  const material = Math.max(0, Math.min(1, fp.partialMaterial ?? 0));
  const LANE = 26;                 // coupling lane above the Hz labels
  const base = h - 18 - LANE, top = 14;
  const X = (f) => w * Math.log(f / PRINT_FMIN) / Math.log(PRINT_FMAX / PRINT_FMIN);

  // dB grid (0 … −60)
  ctx.font = "10px ui-monospace, monospace";
  ctx.lineWidth = 1;
  for (let db = 0; db >= -60; db -= 12) {
    const y = top + (-db / 60) * (base - top);
    ctx.strokeStyle = db === 0 ? "rgba(140,160,180,0.18)" : "rgba(140,160,180,0.07)";
    ctx.beginPath(); ctx.moveTo(34, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.fillStyle = "rgba(120,135,150,0.6)";
    ctx.textAlign = "right";
    ctx.fillText(`${db}`, 30, y + 3);
  }
  // Hz ticks
  ctx.textAlign = "center";
  for (const f of [55, 110, 220, 440, 880, 1760, 3520, 7040, 14080]) {
    const px = X(f);
    if (px < 36) continue;
    ctx.strokeStyle = "rgba(140,160,180,0.07)";
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, base + LANE); ctx.stroke();
    ctx.fillStyle = "rgba(120,135,150,0.55)";
    ctx.fillText(f >= 1000 ? f / 1000 + "k" : String(f), px, h - 5);
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(120,135,150,0.5)";
  ctx.fillText("coupling", 36, base + 12);

  // body overlay (stage 3): its own dB curve, centred on the −30 line.
  // Articulation layers over the base body — the dashed curve is the vowel
  // EQ riding on top; a selected band chip draws that band's own curve hot.
  const baseBands = fp.baseBands || fp.bodyBands || [];
  const articBands = fp.articBands || [];
  const bands = articBands.length ? baseBands.concat(articBands) : baseBands;
  const amount = fp.bodyAmount || 0;
  if (bands.length && amount > 0) {
    const ridgeHot = _emph("ridge");
    const bandY = (arr, f) => top + ((30 - 20 * Math.log10(bodyResponse(arr, f, amount))) / 60) * (base - top);
    ctx.beginPath();
    for (let px = 36; px <= w; px += 3) {
      const f = PRINT_FMIN * Math.pow(PRINT_FMAX / PRINT_FMIN, px / w);
      px === 36 ? ctx.moveTo(px, bandY(bands, f)) : ctx.lineTo(px, bandY(bands, f));
    }
    ctx.strokeStyle = ridgeHot ? "rgba(200,160,240,0.95)" : "rgba(180,142,222,0.45)";
    ctx.lineWidth = ridgeHot ? 2.2 : 1.4;
    ctx.stroke();
    if (articBands.length) {
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      for (let px = 36; px <= w; px += 3) {
        const f = PRINT_FMIN * Math.pow(PRINT_FMAX / PRINT_FMIN, px / w);
        px === 36 ? ctx.moveTo(px, bandY(articBands, f)) : ctx.lineTo(px, bandY(articBands, f));
      }
      ctx.strokeStyle = "rgba(236,142,200,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(236,142,200,0.65)";
      ctx.fillText("articulation", w - 78, bandY(articBands, PRINT_FMAX * 0.45) - 6);
    }
    if (_chBodySel) {
      const b = (_chBodySel.kind === "artic" ? articBands : baseBands)[_chBodySel.i];
      if (b) {
        ctx.beginPath();
        for (let px = 36; px <= w; px += 2) {
          const f = PRINT_FMIN * Math.pow(PRINT_FMAX / PRINT_FMIN, px / w);
          px === 36 ? ctx.moveTo(px, bandY([b], f)) : ctx.lineTo(px, bandY([b], f));
        }
        ctx.strokeStyle = "rgba(255,214,140,0.95)";
        ctx.lineWidth = 2;
        ctx.stroke();
        const bx = X(b.freq);
        ctx.strokeStyle = "rgba(255,214,140,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(bx, top); ctx.lineTo(bx, base); ctx.stroke();
        const peakDb = 20 * Math.log10(bodyResponse([b], b.freq, amount));
        ctx.fillStyle = "rgba(255,214,140,0.95)";
        ctx.fillText(`${_chBodySel.kind === "artic" ? "F" : "B"}${_chBodySel.i + 1} ${peakDb >= 0 ? "+" : ""}${peakDb.toFixed(1)} dB`, Math.min(bx + 5, w - 78), top + 12);
      }
    }
    ctx.lineWidth = 1;
    ctx.fillStyle = ridgeHot ? "rgba(200,160,240,0.95)" : "rgba(180,142,222,0.5)";
    ctx.fillText("body ±dB", w - 64, bandY(bands, PRINT_FMAX * 0.7) - 6);
  }
  // air absorption at the current distance (stage 4)
  const airCut = spaceAirCutoff(exploreParams.spaceDistance ?? 2.5);
  ctx.beginPath();
  for (let px = 36; px <= w; px += 4) {
    const f = PRINT_FMIN * Math.pow(PRINT_FMAX / PRINT_FMIN, px / w);
    const drop = f > airCut ? -12 * Math.log2(f / airCut) : 0;
    const y = top + (-drop / 60) * (base - top);
    px === 36 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
  }
  ctx.strokeStyle = "rgba(88,214,169,0.35)";
  ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "rgba(88,214,169,0.55)";
  ctx.fillText(`air @ ${(exploreParams.spaceDistance ?? 2.5).toFixed(1)} m`, w - 92, top + 10);

  // inharmonicity ghost ticks while the knob is fresh
  const f0 = exploreParams.tonicHz || 261.63;
  if (_emph("shift")) {
    ctx.strokeStyle = "rgba(200,215,230,0.35)";
    ctx.setLineDash([2, 3]);
    for (let n = 1; n <= 64; n++) {
      const fInt = n * f0;
      if (fInt > PRINT_FMAX) break;
      ctx.beginPath(); ctx.moveTo(X(fInt), top + 4); ctx.lineTo(X(fInt), base); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // partial stems + dots (ring-time glow), focus dimming
  const maxMean = Math.max(0.0001, ...parts.map(pp => pp.mean));
  _printGeom = { X, base, top, w, h, needles: [] };
  parts.forEach((pp, i) => {
    if (pp.harmonicFrequency > PRINT_FMAX || pp.mean <= 0) return;
    const db = Math.max(-60, 20 * Math.log10(pp.mean / maxMean));
    const px = X(pp.harmonicFrequency);
    const y = top + (-db / 60) * (base - top);
    const t60 = material > 0 ? materialT60(pp.harmonicFrequency, material) : 6;
    _printGeom.needles.push({ i, x: px, topY: y, mean: pp.mean, db, freq: pp.harmonicFrequency, harmonic: pp.harmonic, t60, sens: pp.sens });
  });
  // ghost pre-change dots: while a knob is fresh, show where each partial
  // WAS so the move reads as motion, not replacement (CHORDA C3)
  if (_printGhosts && _printEmphasis && performance.now() < _printEmphasis.until) {
    ctx.strokeStyle = "rgba(200,215,230,0.5)";
    ctx.lineWidth = 1;
    for (const g of _printGhosts) {
      const cur = _printGeom.needles.find(n => n.i === g.i);
      if (cur && Math.abs(cur.topY - g.topY) < 2 && Math.abs(cur.x - g.x) < 2) continue;
      ctx.beginPath();
      ctx.arc(g.x, g.topY, 2.6, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  const focusable = _chFocus.chip !== "all" || _chFocus.lensLo != null;
  const needleHot = _emph("needles");
  for (const n of _printGeom.needles) {
    const pass = !focusable || chFocusPass(n, _printGeom.needles);
    n.pass = pass;
    const sel = _printState.sel === n.i;
    const alpha = pass ? 1 : 0.22;
    const glow = Math.min(1, Math.log10(1 + n.t60) / 0.9);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = sel ? "#eaf2ff" : "rgba(148,196,255,0.75)";
    ctx.lineWidth = (sel ? 2.4 : 1.4) * (needleHot ? 1.4 : 1);
    ctx.beginPath(); ctx.moveTo(n.x, base); ctx.lineTo(n.x, n.topY); ctx.stroke();
    // ring-time halo behind the dot
    if (glow > 0.05) {
      const halo = ctx.createRadialGradient(n.x, n.topY, 0, n.x, n.topY, 4 + glow * 10 * (_emph("glow") ? 1.6 : 1));
      halo.addColorStop(0, `rgba(148,196,255,${0.5 * glow})`);
      halo.addColorStop(1, "rgba(148,196,255,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(n.x, n.topY, 4 + glow * 10 * 1.6, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.fillStyle = sel ? "#ffffff" : "#bcd8f4";
    ctx.beginPath(); ctx.arc(n.x, n.topY, sel ? 3.4 : 2.4, 0, 2 * Math.PI); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // coupling lane: arcs for the pinned partial (or, while Transfer is
  // fresh, the loudest one)
  let arcSel = _printState.sel;
  if (arcSel == null && (_emph("arcs") || true) && _printGeom.needles.length) {
    arcSel = _printGeom.needles.reduce((a, b) => (b.mean > a.mean ? b : a)).i;
  }
  const selN = _printGeom.needles.find(n => n.i === arcSel);
  if (selN) {
    const laneY = base + 4;
    for (const other of _printGeom.needles) {
      if (other.i === selN.i) continue;
      const C = transferCoupling(selN.freq, other.freq);
      if (C < 0.04) continue;
      const midX = (selN.x + other.x) / 2;
      ctx.strokeStyle = "rgba(95,212,200,0.8)";
      ctx.globalAlpha = 0.25 + Math.min(0.65, C * 1.3);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(selN.x, laneY + LANE - 8);
      ctx.quadraticCurveTo(midX, laneY - 2 + (1 - Math.min(1, C * 2)) * (LANE - 10), other.x, laneY + LANE - 8);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (_printState.sel != null) {
      ctx.fillStyle = "#eaf2ff";
      ctx.textAlign = "center";
      ctx.fillText(`P${selN.harmonic}`, selN.x, Math.max(10, selN.topY - 10));
      ctx.textAlign = "left";
    }
  }
  drawLens();
  chUpdateFocusSum();
}

function drawLens() {
  const cv = document.getElementById("cvLens");
  if (!cv || !_printGeom) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const maxMean = Math.max(0.0001, ..._printGeom.needles.map(n => n.mean));
  for (const n of _printGeom.needles) {
    const bh = Math.pow(n.mean / maxMean, 0.5) * (h - 8);
    ctx.strokeStyle = "rgba(148,196,255,0.5)";
    ctx.beginPath(); ctx.moveTo(n.x, h - 3); ctx.lineTo(n.x, h - 3 - bh); ctx.stroke();
  }
  if (_chFocus.lensLo != null) {
    const x0 = _printGeom.X(_chFocus.lensLo), x1 = _printGeom.X(_chFocus.lensHi);
    ctx.fillStyle = "rgba(95,212,200,0.12)";
    ctx.fillRect(x0, 1, x1 - x0, h - 2);
    ctx.strokeStyle = "rgba(95,212,200,0.7)";
    ctx.strokeRect(x0, 1, x1 - x0, h - 2);
  }
}

function chUpdateFocusSum() {
  const el = document.getElementById("chFocusSum");
  if (!el || !_printGeom) return;
  const focusable = _chFocus.chip !== "all" || _chFocus.lensLo != null;
  const inFocus = focusable ? _printGeom.needles.filter(n => n.pass) : _printGeom.needles;
  if (!focusable) { el.textContent = `${inFocus.length} partials`; return; }
  const range = _chFocus.lensLo != null
    ? `${Math.round(_chFocus.lensLo)} Hz – ${_chFocus.lensHi >= 1000 ? (_chFocus.lensHi / 1000).toFixed(1) + " kHz" : Math.round(_chFocus.lensHi) + " Hz"} · `
    : "";
  const names = inFocus.length ? `P${inFocus[0].harmonic}–P${inFocus[inFocus.length - 1].harmonic}` : "none";
  el.textContent = `${range}${inFocus.length} partials · ${names}`;
  chRenderStrip(inFocus);
}

// Channel strips for the focused partials (CHORDA focus strip)
function chRenderStrip(inFocus) {
  const host = document.getElementById("chStrip");
  if (!host) return;
  const focusable = _chFocus.chip !== "all" || _chFocus.lensLo != null;
  if (!focusable) {
    host.innerHTML = `<div class="editor-hint">brush the lens or pick a focus chip — matching partials appear here as channel strips</div>`;
    return;
  }
  const strips = inFocus.slice(0, 8);
  const dropped = inFocus.length - strips.length;
  host.innerHTML = strips.map(n => {
    const link = _printGeom.needles
      .filter(o => o.i !== n.i)
      .map(o => ({ o, C: transferCoupling(n.freq, o.freq) }))
      .sort((a, b) => b.C - a.C)[0];
    return `
      <div class="ch-ch${_printState.sel === n.i ? " pinned" : ""}" data-ch-part="${n.i}">
        <div class="ch-ch-name">P${n.harmonic} <span>${esc(noteAndCents(n.freq))}</span></div>
        <div class="ch-ch-hz">${n.freq >= 1000 ? (n.freq / 1000).toFixed(2) + " kHz" : n.freq.toFixed(1) + " Hz"}</div>
        <label class="ch-ch-row">lvl
          <input type="range" data-ch-level="${n.i}" min="-60" max="0" step="0.5" value="${n.db.toFixed(1)}"/>
          <output>${n.db.toFixed(1)}</output>
        </label>
        <div class="ch-ch-row"><span>T60</span><i style="width:${Math.min(100, n.t60 / 4 * 100)}%"></i><output>${n.t60.toFixed(2)}s</output></div>
        <div class="ch-ch-row"><span>wob</span><i style="width:${Math.min(100, (n.sens ?? 0) / 2 * 100)}%"></i><output>${(n.sens ?? 0).toFixed(2)}</output></div>
        ${link && link.C > 0.04 ? `<div class="ch-ch-link">⌒ P${link.o.harmonic} · ${link.C.toFixed(2)}</div>` : `<div class="ch-ch-link muted">no strong link</div>`}
      </div>`;
  }).join("") + (dropped > 0 ? `<div class="editor-hint">+${dropped} more — narrow the lens</div>` : "");
}

function chPinShow(n) {
  const pin = document.getElementById("chPin");
  const wrap = pin ? pin.parentElement : null;
  if (!pin || !wrap || !n) return;
  const rels = _printGeom.needles
    .filter(o => o.i !== n.i)
    .map(o => ({ o, C: transferCoupling(n.freq, o.freq), r: nearestRatio(n.freq, o.freq) }))
    .filter(x => x.C >= 0.04 && x.r)
    .sort((a, b) => b.C - a.C);
  const strongest = rels[0];
  pin.innerHTML = `
    <div class="ch-pin-head">P${n.harmonic} <span>PINNED</span></div>
    <div>f <b>${n.freq.toFixed(1)} Hz</b> (${esc(noteAndCents(n.freq))}) · level <b>${n.db.toFixed(1)} dB</b></div>
    <div>T60 <b>${n.t60.toFixed(2)} s</b> · wobble <b>${(n.sens ?? 0).toFixed(2)}</b></div>
    <div>${strongest ? `strongest link <b>P${strongest.o.harmonic}</b> · ${strongest.r.p}:${strongest.r.q} · ${strongest.C.toFixed(2)}` : "no strong links in range"}</div>`;
  pin.hidden = false;
  const cvRect = document.getElementById("cvTonePrint").getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const scale = cvRect.width / (_printGeom.w || cvRect.width);
  let left = (n.x * scale) + (cvRect.left - wrapRect.left) + 12;
  let topPx = (n.topY * scale) + (cvRect.top - wrapRect.top) - 8;
  left = Math.min(left, wrapRect.width - 250);
  topPx = Math.max(4, Math.min(topPx, wrapRect.height - 96));
  pin.style.left = `${left}px`;
  pin.style.top = `${topPx}px`;
}

function chPinHide() {
  const pin = document.getElementById("chPin");
  if (pin) pin.hidden = true;
}

function wireTonePrint(v) {
  const cv = v.querySelector("#cvTonePrint");
  if (!cv) return;
  const hitNeedle = (e) => {
    if (!_printGeom) return null;
    const rect = cv.getBoundingClientRect();
    const x = (e.clientX - rect.left) * ((cv._cssW || cv.width) / rect.width);
    let best = null;
    for (const n of _printGeom.needles) {
      const d = Math.abs(n.x - x);
      if (d < 7 && (!best || d < best.d)) best = { ...n, d };
    }
    return best;
  };
  let drag = null;
  cv.onmousedown = (e) => {
    const hit = hitNeedle(e);
    if (!hit) { _printState.sel = null; chPinHide(); drawTonePrint(); return; }
    _printState.sel = hit.i;
    drag = { i: hit.i, startY: e.clientY, moved: false };
    drawTonePrint();
    chPinShow(_printGeom.needles.find(n => n.i === hit.i));
    e.preventDefault();
  };
  cv.onmousemove = (e) => {
    if (!drag) { cv.style.cursor = hitNeedle(e) ? "ns-resize" : "crosshair"; return; }
    const dy = drag.startY - e.clientY;
    if (Math.abs(dy) < 3 && !drag.moved) return;
    drag.moved = true;
    ensureSpectralPartialParams(exploreParams);
    const geomN = _printGeom.needles.find(n => n.i === drag.i);
    if (!geomN) return;
    // dB-space drag: 1 px = 0.4 dB
    const newDb = clamp(geomN.db + dy * 0.4, -60, 0);
    const ratio = Math.pow(10, (newDb - geomN.db) / 20);
    const oldAmp = exploreParams.spectralPartialMeans[drag.i] ?? 0;
    exploreParams.spectralPartialMeans[drag.i] = clamp((oldAmp || 0.02) * ratio, 0, 1.5);
    drag.startY = e.clientY;
    drawTonePrint();
    const nn = _printGeom.needles.find(n => n.i === drag.i);
    if (nn) chPinShow(nn);
  };
  const endDrag = () => {
    if (drag && drag.moved) synth.updateGenerationParams({ ...exploreParams });
    drag = null;
  };
  cv.onmouseup = endDrag;
  cv.onmouseleave = endDrag;

  // focus chips
  v.querySelectorAll("[data-ch-chip]").forEach(btn => {
    btn.onclick = () => {
      _chFocus.chip = btn.dataset.chChip;
      v.querySelectorAll("[data-ch-chip]").forEach(b => b.classList.toggle("active", b === btn));
      drawTonePrint();
    };
  });

  // lens brush
  const lens = v.querySelector("#cvLens");
  if (lens) {
    let lensDrag = null;
    const lensFreq = (e) => {
      const rect = lens.getBoundingClientRect();
      const frac = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      return PRINT_FMIN * Math.pow(PRINT_FMAX / PRINT_FMIN, frac);
    };
    lens.onmousedown = (e) => {
      lensDrag = { f0: lensFreq(e), moved: false };
      e.preventDefault();
    };
    lens.onmousemove = (e) => {
      if (!lensDrag) return;
      const f1 = lensFreq(e);
      if (Math.abs(Math.log2(f1 / lensDrag.f0)) > 0.02) lensDrag.moved = true;
      if (lensDrag.moved) {
        _chFocus.lensLo = Math.min(lensDrag.f0, f1);
        _chFocus.lensHi = Math.max(lensDrag.f0, f1);
        drawTonePrint();
      }
    };
    const lensUp = () => {
      if (lensDrag && !lensDrag.moved) { _chFocus.lensLo = null; _chFocus.lensHi = null; drawTonePrint(); }
      lensDrag = null;
    };
    lens.onmouseup = lensUp;
    lens.onmouseleave = () => { if (lensDrag && lensDrag.moved) lensDrag = null; else lensUp(); };
  }

  // channel-strip level faders (delegated — strips re-render on focus change)
  const strip = v.querySelector("#chStrip");
  if (strip) {
    strip.oninput = (e) => {
      const sl = e.target.closest("input[data-ch-level]");
      if (!sl || !_printGeom) return;
      ensureSpectralPartialParams(exploreParams);
      const i = Number(sl.dataset.chLevel);
      const n = _printGeom.needles.find(x => x.i === i);
      if (!n) return;
      const newDb = Number(sl.value);
      const ratio = Math.pow(10, (newDb - n.db) / 20);
      exploreParams.spectralPartialMeans[i] = clamp((exploreParams.spectralPartialMeans[i] || 0.02) * ratio, 0, 1.5);
      const out = sl.parentElement.querySelector("output");
      if (out) out.textContent = newDb.toFixed(1);
      drawTonePrint();
      synth.updateGenerationParams({ ...exploreParams });
    };
  }

  // stage rail: select a stage -> its inspector expands
  v.querySelectorAll("[data-ch-stage]").forEach(card => {
    card.onclick = () => {
      if (_chStage === card.dataset.chStage) return;
      _chStage = card.dataset.chStage;
      renderExplore();
    };
  });
}


// ── SPACE position pad: the instrument on a stage in front of the
// listener. Polar layout — angle = azimuth (±90°), radius = distance on a
// log scale (0.3–30 m). Dragging repositions live.
const SPACE_DMIN = 0.3, SPACE_DMAX = 30;
function _spacePadGeom(w, h) {
  // Q4: full circle — the listener sits at the centre and sources can be
  // anywhere around them, including behind (screen-down = behind).
  return { cx: w / 2, cy: h / 2, rMax: Math.min(h / 2 - 10, w / 2 - 8) };
}
function _spaceDistToR(d, rMax) {
  return (Math.log(d / SPACE_DMIN) / Math.log(SPACE_DMAX / SPACE_DMIN)) * rMax;
}
function _spaceRToDist(r, rMax) {
  return clamp(SPACE_DMIN * Math.pow(SPACE_DMAX / SPACE_DMIN, clamp(r / rMax, 0, 1)), SPACE_DMIN, SPACE_DMAX);
}

function drawStringDiag() {
  const cv = document.getElementById("cvStringDiag");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const pos = clamp(Number.isFinite(exploreParams.excitationPosition) ? exploreParams.excitationPosition : 0.13, 0.02, 0.5);
  // the lowest mode with a node closest to the contact point
  const mode = Math.max(2, Math.round(1 / pos));
  const mid = h / 2 - 5, amp = h / 2 - 12;
  // string rest line
  ctx.strokeStyle = "rgba(120,135,150,0.3)";
  ctx.beginPath(); ctx.moveTo(4, mid); ctx.lineTo(w - 4, mid); ctx.stroke();
  // the standing wave of that mode
  ctx.beginPath();
  for (let px = 4; px <= w - 4; px += 2) {
    const x01 = (px - 4) / (w - 8);
    const y = mid - Math.sin(x01 * Math.PI * mode) * amp;
    px === 4 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
  }
  ctx.strokeStyle = "rgba(148,196,255,0.7)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.lineWidth = 1;
  // node dots
  ctx.fillStyle = "rgba(148,196,255,0.8)";
  for (let k = 0; k <= mode; k++) {
    const px = 4 + (k / mode) * (w - 8);
    ctx.beginPath(); ctx.arc(px, mid, 2, 0, 2 * Math.PI); ctx.fill();
  }
  // contact point marker (amber)
  const bx = 4 + pos * (w - 8);
  ctx.strokeStyle = "#f5a623";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(bx, 6); ctx.lineTo(bx, h - 12); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = "#f5a623";
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(pos.toFixed(2), bx, h - 2);
  ctx.fillStyle = "rgba(120,135,150,0.6)";
  ctx.textAlign = "right";
  ctx.fillText(`mode ${mode} shown`, w - 4, 9);
}

function drawSpacePad() {
  const cv = document.getElementById("cvSpacePad");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const { cx, cy, rMax } = _spacePadGeom(w, h);
  // Behind half-plane (Q4): subtly shaded — sources there get the pinna cue
  ctx.fillStyle = "rgba(60,72,88,0.16)";
  ctx.beginPath();
  ctx.arc(cx, cy, rMax, 0, Math.PI); // screen-down = behind the listener
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(90,110,130,0.25)";
  ctx.fillStyle = "rgba(120,135,150,0.55)";
  ctx.font = "8px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.lineWidth = 1;
  for (const dm of [1, 3, 10, 30]) {
    const r = _spaceDistToR(dm, rMax);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.fillText(`${dm}m`, cx + 2, cy - r + 8);
  }
  ctx.strokeStyle = "rgba(90,110,130,0.15)";
  for (const a of [-135, -90, -45, 0, 45, 90, 135, 180]) {
    const rad = (a - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(rad) * rMax, cy + Math.sin(rad) * rMax);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(120,135,150,0.6)";
  ctx.textAlign = "center";
  ctx.fillText("front", cx, cy - rMax + 8);
  ctx.fillText("behind", cx, cy + rMax - 3);
  ctx.fillStyle = "rgba(200,215,230,0.85)";
  ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = "rgba(120,135,150,0.6)";
  ctx.fillText("you", cx, cy + 12);
  const d = clamp(exploreParams.spaceDistance ?? 2.5, SPACE_DMIN, SPACE_DMAX);
  const az = clamp(exploreParams.spaceAzimuth ?? 0, -180, 180);
  const rad = (az - 90) * Math.PI / 180;
  const r = _spaceDistToR(d, rMax);
  const ix = cx + Math.cos(rad) * r, iy = cy + Math.sin(rad) * r;
  ctx.strokeStyle = "rgba(88,214,169,0.4)";
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ix, iy); ctx.stroke();
  ctx.fillStyle = "#58d6a9";
  ctx.shadowColor = "#58d6a9"; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(ix, iy, 5, 0, 2 * Math.PI); ctx.fill();
  ctx.shadowBlur = 0;
}

// Q7: layer strip interactions. Layer edits apply live through
// updateGenerationParams — the next generated note carries them.
function wireLayerStrip(v) {
  const applyLive = () => synth.updateGenerationParams({ ...exploreParams });
  const add = v.querySelector("#layerAdd");
  if (add) add.onclick = () => {
    if (!Array.isArray(exploreParams.layers)) exploreParams.layers = [];
    const subnote = extractSectionParams(exploreParams, "sound");
    delete subnote.layers;          // a layer never nests layers
    delete subnote.layerEnvOverride;
    const layer = {
      id: crypto.randomUUID(),
      hue: (36 + exploreParams.layers.length * 70) % 360,
      subnote,
      space: null, // inherits the patch position until positioned
      gain: 0.8,
      independentHead: false,
    };
    exploreParams.layers.push(layer);
    _chLayerSel = layer.id;
    applyLive();
    renderExplore();
  };
  v.querySelectorAll("[data-layer-block]").forEach(b => {
    b.onclick = () => {
      _chLayerSel = _chLayerSel === b.dataset.layerBlock ? null : b.dataset.layerBlock;
      renderExplore();
    };
  });
  const layerOf = (id) => (exploreParams.layers || []).find(l => l.id === id);
  const bindSlider = (attr, apply) => v.querySelectorAll(`[${attr}]`).forEach(el => {
    el.oninput = () => {
      const l = layerOf(el.getAttribute(attr));
      if (l) { apply(l, Number(el.value)); applyLive(); }
    };
  });
  bindSlider("data-layer-gain", (l, val) => { l.gain = val; });
  bindSlider("data-layer-angle", (l, val) => { l.space = { angle: val, dist: l.space?.dist ?? 2.5 }; });
  bindSlider("data-layer-dist", (l, val) => { l.space = { angle: l.space?.angle ?? 0, dist: val }; });
  v.querySelectorAll("[data-layer-head]").forEach(el => {
    el.onchange = () => {
      const l = layerOf(el.dataset.layerHead);
      if (l) { l.independentHead = el.checked; applyLive(); }
    };
  });
  v.querySelectorAll("[data-layer-remove]").forEach(el => {
    el.onclick = () => {
      exploreParams.layers = (exploreParams.layers || []).filter(l => l.id !== el.dataset.layerRemove);
      if (!exploreParams.layers.length) exploreParams.layers = null;
      _chLayerSel = null;
      applyLive();
      renderExplore();
    };
  });
  const sync = v.querySelector("#layerEnvSync");
  if (sync) sync.onchange = () => {
    exploreParams.layerEnvOverride = sync.checked;
    applyLive();
    renderExplore();
  };
}

function wireSpacePad(v) {
  const cv = v.querySelector("#cvSpacePad");
  if (!cv) return;
  const apply = (e) => {
    const rect = cv.getBoundingClientRect();
    const w = cv._cssW || rect.width, h = cv._cssH || rect.height;
    const { cx, cy, rMax } = _spacePadGeom(w, h);
    const x = (e.clientX - rect.left) * (w / rect.width) - cx;
    const y = (e.clientY - rect.top) * (h / rect.height) - cy;
    const az = clamp(Math.atan2(x, -y) * 180 / Math.PI, -180, 180); // Q4: full circle
    const dist = _spaceRToDist(Math.hypot(x, y), rMax);
    exploreParams.spaceAzimuth = Math.round(az);
    exploreParams.spaceDistance = Number(dist.toFixed(2));
    const readout = v.querySelector("#spaceReadout");
    if (readout) readout.textContent = `${exploreParams.spaceDistance.toFixed(1)} m · ${exploreParams.spaceAzimuth}°`;
    drawSpacePad();
    drawChThumbs();
    synth.updateReverb({ ...exploreParams });
  };
  cv.onmousedown = (e) => {
    e.preventDefault();
    apply(e);
    const move = (ev) => apply(ev);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
}

function drawBodyRidge() {
  const cv = document.getElementById("cvBodyRidge");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const profile = SPECTRAL_PROFILES[exploreParams.spectralProfile] || SPECTRAL_PROFILES.violin;
  const bands = bodyBandsFor(exploreParams, profile);
  const amount = clamp(exploreParams.spectralResonanceAmount ?? 0.35, 0, 1.5);
  const FMIN = 60, FMAX = 12000;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let px = 0; px <= w; px += 2) {
    const f = FMIN * Math.pow(FMAX / FMIN, px / w);
    const r = bodyResponse(bands, f, amount);           // 0.2 … 4.5
    const y = h - 3 - (Math.log2(r) + 2.4) / 4.6 * (h - 6); // log scale, 0.2→bottom, 4.5→top
    ctx.lineTo(px, Math.max(2, Math.min(h - 2, y)));
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  const hot = _emph("ridge");
  ctx.fillStyle = hot ? "rgba(79,141,212,0.28)" : "rgba(79,141,212,0.14)";
  ctx.fill();
  ctx.strokeStyle = hot ? "rgba(130,185,240,0.95)" : "rgba(79,141,212,0.6)";
  ctx.lineWidth = hot ? 2.2 : 1.5;
  ctx.stroke();
}


function drawSinePath(ctx, x0, x1, mid, cycles, amplitude, opts) {
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const steps = 360;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = mid - Math.sin(Math.PI * 2 * cycles * t) * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}



function visualGaussian(i, j) {
  const u1 = visualUniform(i * 17 + j * 31 + 1);
  const u2 = visualUniform(i * 29 + j * 43 + 2);
  return Math.sqrt(-2 * Math.log(Math.max(1e-6, u1))) * Math.cos(2 * Math.PI * u2);
}

function visualUniform(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawEnvelopeDist() {
  document.querySelectorAll(".js-envelope-canvas").forEach(drawEnvelopeCanvas);
}

function drawEnvelopeCanvas(cv) {
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const attack = exploreParams.envelopeAttack || 0.008;
  const attackSd = exploreParams.envelopeAttackSd || 0;
  const decay = exploreParams.envelopeDecay || 0.04;
  const decaySd = exploreParams.envelopeDecaySd || 0;
  const sustain = exploreParams.envelopeSustain || 0.6;
  const sustainSd = exploreParams.envelopeSustainSd || 0;
  const release = exploreParams.envelopeRelease || 0.08;
  const releaseSd = exploreParams.envelopeReleaseSd || 0;
  const chance = exploreParams.envelopeProb || 0;
  const pad = w > 220 ? 12 : 5;
  const mean = envelopePoints(w, h, pad, attack, decay, sustain, release);
  const high = envelopePoints(
    w, h, pad,
    attack + attackSd,
    decay + decaySd,
    clamp(sustain + sustainSd, 0.05, 1),
    release + releaseSd
  );
  const low = envelopePoints(
    w, h, pad,
    Math.max(0.001, attack - attackSd),
    Math.max(0.001, decay - decaySd),
    clamp(sustain - sustainSd, 0.05, 1),
    Math.max(0.004, release - releaseSd)
  );

  ctx.fillStyle = "rgba(245,158,11,0.045)";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(136,153,170,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.stroke();

  ctx.fillStyle = `rgba(59,130,246,${0.10 + chance * 0.18})`;
  ctx.beginPath();
  high.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  low.slice().reverse().forEach(([x, y]) => ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();

  if (chance > 0) {
    for (let sample = 1; sample <= 3; sample++) {
      const sAttack = Math.max(0.001, attack + visualGaussian(sample, 8) * attackSd);
      const sDecay = Math.max(0.001, decay + visualGaussian(sample, 9) * decaySd);
      const sSustain = clamp(sustain + visualGaussian(sample, 10) * sustainSd, 0.05, 1);
      const sRelease = Math.max(0.004, release + visualGaussian(sample, 11) * releaseSd);
      drawEnvelopePath(ctx, envelopePoints(w, h, pad, sAttack, sDecay, sSustain, sRelease), {
        stroke: "rgba(226,232,240,0.20)",
        width: 0.9,
      });
    }
  }

  drawEnvelopePath(ctx, mean, {
    stroke: "rgba(245,158,11,0.88)",
    width: w > 220 ? 2 : 1.4,
  });

  ctx.fillStyle = "rgba(136,153,170,0.72)";
  ctx.font = `${w > 220 ? 9 : 8}px system-ui`;
  ctx.textAlign = "left";
  ctx.fillText("A", mean[1][0] - 3, h - 3);
  ctx.fillText("D", mean[2][0] - 3, h - 3);
  ctx.fillText("S", mean[3][0] - 3, h - 3);
  ctx.textAlign = "right";
  ctx.fillText("R", w - pad, h - 3);
  if (w > 220) {
    ctx.textAlign = "left";
    ctx.fillText("amp", 3, pad + 3);
    ctx.fillText("time", w - 34, h - 3);
  }
}

function envelopePoints(w, h, pad, attack, decay, sustain, release) {
  const hold = 0.24;
  const total = Math.max(0.08, attack + decay + release + hold);
  const usableW = w - pad * 2;
  const x0 = pad;
  const xA = x0 + Math.max(4, (attack / total) * usableW);
  const xD = Math.min(w - pad - 18, xA + Math.max(5, (decay / total) * usableW));
  const xR = Math.max(xD + 8, w - pad - Math.max(5, (release / total) * usableW));
  const y0 = h - pad;
  const yTop = pad + 3;
  const ySustain = h - pad - clamp(sustain, 0.05, 1) * (h - pad * 2 - 4);
  return [
    [x0, y0],
    [xA, yTop],
    [xD, ySustain],
    [xR, ySustain],
    [w - pad, y0],
  ];
}

function drawEnvelopePath(ctx, points, opts) {
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.stroke();
}

// ─── Explore: Helpers ───────────────────────────────────────

/** Update slider filled-track gradient */
// Slider fills carry the DATA-layer hue of the subsection they live in
// (generation amber / accuracy green / surprise cyan), per the FabFilter
// principle: chrome stays monochrome, colour identifies the data layer.
const _LAYER_FILL_RGB = {
  generation: "245,166,35",
  accuracy: "160,220,50",
  surprise: "56,189,248",
};

function updateSliderFill(sl) {
  const min = parseFloat(sl.min) || 0;
  const max = parseFloat(sl.max) || 100;
  const val = parseFloat(sl.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  const section = sl.closest("[data-section]")?.dataset.section;
  const rgb = _LAYER_FILL_RGB[section] || _LAYER_FILL_RGB.generation;
  sl.style.background = `linear-gradient(to right, rgba(${rgb},0.55) ${pct}%, rgba(43,47,55,0.95) ${pct}%)`;
}

function controlRow(param, label, value, min, max, step) {
  const desc = `${label}: ${describeParam(param, label)}`;
  return `
    <div class="control-row"${titleAttr(desc)}>
      <span class="label"${titleAttr(desc)}>${label}</span>
      <input type="range" data-param="${param}" min="${min}" max="${max}" step="${step}" value="${value}"${titleAttr(desc)}/>
      <output id="out_${param}"${titleAttr(desc)}>${fmtOutput(param, value)}</output>
    </div>`;
}

function selectControlRow(param, label, value, optionsHtml) {
  const desc = `${label}: ${describeParam(param, label)}`;
  return `
    <div class="control-row select-row"${titleAttr(desc)}>
      <span class="label"${titleAttr(desc)}>${label}</span>
      <select data-param-select="${param}" class="param-select"${titleAttr(desc)}>
        ${optionsHtml}
      </select>
      <output id="out_${param}"${titleAttr(desc)}>${fmtOutput(param, value)}</output>
    </div>`;
}

function checkboxControl(param, label, checked) {
  const desc = `${label}: ${describeParam(param, label)}`;
  return `
    <label class="feature-check"${titleAttr(desc)}>
      <input type="checkbox" data-param-check="${param}" ${checked ? "checked" : ""}${titleAttr(desc)}/>
      <span>${label}</span>
    </label>`;
}

function featureSurpriseBlock(feature, label, enabledParam, distanceParam, checked, distance) {
  return `
    <div class="feature-surprise" data-feature-surprise="${feature}">
      ${checkboxControl(enabledParam, `${label} surprise`, checked)}
      ${distanceParam ? controlRow(distanceParam, "Surprise distance", distance, 0, 1, 0.01) : ""}
    </div>`;
}

function surpriseWeightControlsHTML(p) {
  const enabled = SURPRISE_FEATURES.filter(f => p[f.enabled]);
  if (!enabled.length) {
    return `<div class="surprise-weight-list"><div class="empty-state">Select a surprise checkbox in a musical section to weight it here.</div></div>`;
  }
  return `
    <div class="surprise-weight-list">
      <div class="surprise-weight-head">Surprise weights (when surprise occurs)</div>
      ${enabled.map(f => controlRow(f.weight, f.label, p[f.weight] ?? 0.5, 0, 1, 0.01)).join("")}
    </div>`;
}

function formantAccuracyControlsHTML(p) {
  ensureFormantWeights(p);
  // Accuracy and surprise apply to every formant equally — no per-formant focus.
  const acc = p.formantAccuracy;
  const range = p.formantAccuracyRange;
  const dist = p.surpriseFormantDistance ?? 0.85;
  return `
    <div class="formant-axis-controls">
      <div class="controls-grid">
        ${formantScopedControl("formantAccuracy", "Hit prob", acc, 0, 1, 0.01)}
        ${formantScopedControl("formantAccuracyRange", "Accuracy range", range, 0, (FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]).length || 5) / 2, 0.125)}
        ${formantScopedControl("surpriseFormantDistance", "Surprise range", dist, 0, 1, 0.01)}
      </div>
    </div>`;
}

function formantScopedControl(param, label, value, min, max, step) {
  const desc = `${label}: ${describeParam(param, label)}`;
  return `
    <div class="control-row"${titleAttr(desc)}>
      <span class="label"${titleAttr(desc)}>${label}</span>
      <input type="range" data-formant-scope="${param}" min="${min}" max="${max}" step="${step}" value="${value}"${titleAttr(desc)}/>
      <output data-formant-scope-out="${param}"${titleAttr(desc)}>${fmtOutput(param, value)}</output>
    </div>`;
}

function formantFocusedValue(p, mapKey, allKey, focus = p.formantFocus || "ah") {
  ensureFormantWeights(p);
  return p.formantEditAll ? p[allKey] : (p[mapKey]?.[focus] ?? p[allKey]);
}

function applyFormantScopedParam(param, value) {
  ensureFormantWeights(exploreParams);
  const focus = exploreParams.formantFocus || "ah";
  const config = {
    formantAccuracy: { all: "formantAccuracy", map: "formantAccuracyByFormant", min: 0, max: 1, integer: false },
    formantAccuracyRange: { all: "formantAccuracyRange", map: "formantRangeByFormant", min: 0, max: (FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]).length || 5) / 2, integer: false },
    surpriseFormantDistance: { all: "surpriseFormantDistance", map: "surpriseFormantDistanceByFormant", min: 0, max: 1, integer: false },
  }[param];
  if (!config) return;
  let v = clamp(value, config.min, config.max);
  if (config.integer) v = Math.round(v);
  if (exploreParams.formantEditAll) {
    exploreParams[config.all] = v;
    Object.keys(FORMANT_PRESETS).forEach(key => {
      exploreParams[config.map][key] = v;
    });
  } else {
    exploreParams[config.map][focus] = v;
  }
}

// ── 2D vowel pad ─────────────────────────────────────────────
// The vowel space is two-dimensional (log F1 openness × log F2 frontness;
// see docs/FORMANT_SPACE_DESIGN.md). The pad projects it in the classic
// vowel-chart orientation: front vowels left, back vowels right, closed at
// the top, open at the bottom. Landmark dot size shows sampling weight.
const _VOWEL_PAD = { W: 170, H: 120, pad: 20 };

function vowelPadScreenPos(name) {
  const pts = Object.values(VOWEL_POINTS);
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const p = VOWEL_POINTS[name];
  const { W, H, pad } = _VOWEL_PAD;
  return {
    // x: high F2 (front) on the left, low F2 (back) on the right
    x: pad + ((maxY - p.y) / Math.max(1e-9, maxY - minY)) * (W - pad * 2),
    // y: low F1 (closed) at the top, high F1 (open) at the bottom
    y: pad + ((p.x - minX) / Math.max(1e-9, maxX - minX)) * (H - pad * 2),
  };
}

function formantWeightCircleHTML() {
  const { W, H } = _VOWEL_PAD;
  const keys = Object.keys(FORMANT_PRESETS);
  // Horseshoe outline through the landmarks in vowel-chart order
  const hull = FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k])
    .map(k => { const s = vowelPadScreenPos(k); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; })
    .join(" ");
  const dots = keys.map(k => {
    const s = vowelPadScreenPos(k);
    return `<circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="2.6" class="fw-dot" data-fw-dot="${k}"/>`;
  }).join("");
  const labels = keys.map(k => {
    const s = vowelPadScreenPos(k);
    const dy = s.y < H / 2 ? -7 : 13;
    return `<text x="${s.x.toFixed(1)}" y="${(s.y + dy).toFixed(1)}" class="fw-label" data-fw-label="${k}" text-anchor="middle">${k}</text>`;
  }).join("");
  return `<svg class="formant-weight-circle vowel-pad" viewBox="0 0 ${W} ${H}" data-formant-weight-circle aria-hidden="true">
      <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="7" class="vp-well"/>
      <text x="9" y="${H / 2}" class="vp-axis" text-anchor="middle" transform="rotate(-90 9 ${H / 2})">closed → open</text>
      <text x="${W / 2}" y="${H - 5}" class="vp-axis" text-anchor="middle">front ← → back</text>
      <polyline class="fw-poly" data-fw-poly points="${hull}"/>
      ${dots}${labels}
    </svg>`;
}

function updateFormantWeightCircle(root) {
  const svg = (root || document).querySelector("[data-formant-weight-circle]");
  if (!svg) return;
  // 2D pad: landmark positions are fixed (they ARE the vowel space); the
  // sampling weight shows as dot size, inactive vowels dim out.
  const active = exploreParams.activeFormants || [];
  const weights = exploreParams.formantWeights || {};
  for (const k of Object.keys(FORMANT_PRESETS)) {
    const on = active.includes(k);
    const w = on ? Math.max(0, Math.min(1, Number(weights[k]) || 0)) : 0;
    const dot = svg.querySelector(`[data-fw-dot="${k}"]`);
    if (dot) {
      dot.setAttribute("r", (1.6 + 4.4 * w).toFixed(2));
      dot.classList.toggle("inactive", !on);
    }
    svg.querySelector(`[data-fw-label="${k}"]`)?.classList.toggle("inactive", !on);
  }
}

function formantWeightControlsHTML(p) {
  ensureFormantWeights(p);
  const active = p.activeFormants || ["ah"];
  return `
    ${formantWeightCircleHTML()}
    <div class="formant-weight-controls">
      ${Object.keys(FORMANT_PRESETS).map(key => {
        const disabled = active.includes(key) ? "" : " disabled";
        const desc = `${key}: Relative probability of selecting this formant when the formant palette is sampled.`;
        return `
          <label class="formant-weight${disabled}"${titleAttr(desc)}>
            <span>${key}</span>
            <input type="range" data-formant-weight="${key}" min="0" max="1" step="0.01" value="${p.formantWeights[key]}" ${disabled ? "disabled" : ""}${titleAttr(desc)}/>
            <output data-formant-weight-out="${key}">${Math.round(p.formantWeights[key] * 100)}%</output>
          </label>`;
      }).join("")}
    </div>`;
}

function percSoundOptions(selected) {
  return Object.entries(PERC_SOUNDS).map(([k, v]) =>
    `<option value="${k}" ${selected === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');
}

function spectralProfileOptions(selected) {
  return Object.entries(SPECTRAL_PROFILES).map(([k, v]) =>
    `<option value="${k}" ${selected === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');
}

function reverbTypeOptions(selected) {
  return Object.entries(REVERB_PROFILES).map(([k, v]) =>
    `<option value="${k}" ${selected === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');
}

function bakedSurpriseOptions(selected) {
  const value = normaliseBakedSurpriseValue(selected);
  const options = [
    ...Array.from({ length: 33 }, (_, i) => [String(i), String(i)]),
    ["Infinity", "∞"],
  ];
  return options.map(([k, label]) =>
    `<option value="${k}" ${value === k ? 'selected' : ''}>${label}</option>`
  ).join('');
}

function normaliseBakedSurpriseValue(value) {
  if (value === undefined || value === null || value === "" || value === Infinity || value === "Infinity") {
    return "Infinity";
  }
  const n = Math.max(0, Math.floor(Number(value)));
  if (!Number.isFinite(n)) return "Infinity";
  if (n > 32) return "Infinity";
  return String(n);
}

function fmtOutput(param, val) {
  const v = Number(val);
  switch (param) {
    case "partialB": return v <= 0 ? "0" : `B ${(v * 1e4).toFixed(1)}e-4`;
    case "tempo": return `${v} BPM`;
    case "intervalRange":
    case "motifHitRange":
    case "motifCount":
    case "motifLengthBeats":
    case "beatDivisions":
    case "percDownbeatEvery":
    case "spectralPartials":
    case "registerCenter":
    case "dynamicsHitRange":
    case "registerWidth": return String(v);
    case "surpriseMaxBaked": return normaliseBakedSurpriseValue(val) === "Infinity" ? "∞" : String(Math.floor(Number(val)));
    case "intervalPeakedness": return v.toFixed(1);
    case "registerSkew": return (v >= 0 ? "+" : "") + v.toFixed(2);
    case "subScaleWeight":
    case "precision":
    case "dynamicsLevel":
    case "dynamicsPrecision":
    case "dynamicsRange":
    case "motifHitProb":
    case "surpriseProb":
    case "surprisePitchWeight":
    case "surpriseTuningWeight":
    case "surpriseRhythmWeight":
    case "surpriseFormantWeight":
    case "surpriseDynamicsWeight":
    case "surpriseRestWeight":
    case "surprisePitchDistance":
    case "surpriseTuningDistance":
    case "surpriseRhythmDistance":
    case "surpriseFormantDistance":
    case "surpriseDynamicsDistance":
    case "formantAccuracy":
    case "formantChangeProb":
    case "incorporationRate":
    case "sequenceProb":
    case "motifSurpriseProb":
    case "onBeatProb":
    case "offBeatProb":
    case "sameLengthProb":
    case "restMotifStartRatio":
    case "restOnMeterRatio":
    case "restOffMeterRatio":
    case "momentum":
    case "loudnessRange":
    case "rootPullStrength":
    case "rootPullShape":
    case "percBeatVol":
    case "percMotifVol":
    case "percDownbeatVol":
    case "toneColorProb":
    case "toneFormantDrift":
    case "toneResonanceDrift":
    case "toneBreath":
    case "vibratoProb":
    case "spectralProb":
    case "spectralMix":
    case "spectralSpread":
    case "spectralDynamicAmount":
    case "spectralRegisterAmount":
    case "spectralResonanceAmount":
    case "spectralLoudnessNorm":
    case "spectralDriftProb":
    case "spectralDriftDepth":
    case "reverbWet":
    case "reverbTone":
    case "envelopeProb":
    case "envelopeRange":
    case "envelopeSustain":
    case "envelopeSustainSd":
    case "gapProb":
    case "gapMin":
    case "gapMax":
    case "gapDistanceSlope":
    case "gapTimingRange":
    case "slideSpeed":
    case "phraseGap": return v.toFixed(2);
    case "formantAccuracyRange": return `${v.toFixed(2).replace(/\.?0+$/, "")} step${Number(v) === 1 ? "" : "s"}`;
    case "precisionRange": return `±${v.toFixed(0)}c`;
    case "envelopeAttack":
    case "envelopeAttackSd":
    case "envelopeDecay":
    case "envelopeDecaySd":
    case "envelopeRelease":
    case "envelopeReleaseSd": return `${Math.round(v * 1000)}ms`;
    case "spectralDriftRate": return `${v.toFixed(1)}Hz`;
    case "vibratoRate":
    case "vibratoRateSd": return `${v.toFixed(1)}Hz`;
    case "vibratoDepth":
    case "vibratoDepthSd": return `${v.toFixed(0)}c`;
    case "spectralStretchCents": return `${v > 0 ? "+" : ""}${v.toFixed(0)}c`;
    case "reverbDecay": return `${v.toFixed(1)}s`;
    case "reverbPreDelay": return `${Math.round(v * 1000)}ms`;
    default: return v.toFixed(2);
  }
}

function debouncedReplay() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (synth.isPlaying) {
      synth.play({ ...exploreParams });
      startVisualiser();
    }
  }, 180);
}

function randomiseParams() {
  const ri = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
  const rf = (lo, hi) => +(lo + Math.random() * (hi - lo)).toFixed(3);
  const rp = (arr) => arr[ri(0, arr.length - 1)];

  const p = exploreParams;
  p.tempo = ri(60, 168);
  p.seed = ri(1, 999999);

  // Scale
  if (Math.random() < 0.8) {
    p.scaleMode = "12tone";
    p.scalePreset = rp(Object.keys(SCALE_PRESETS));
    p.customDegrees = [...SCALE_PRESETS[p.scalePreset].degrees];
    p.edoDivisions = 12;
  } else {
    p.scaleMode = "edo";
    p.edoDivisions = ri(5, 19);
    p.customDegrees = Array.from({ length: p.edoDivisions }, (_, i) => i)
      .filter(() => Math.random() < 0.6);
    if (p.customDegrees.length < 3) {
      p.customDegrees = [0, Math.floor(p.edoDivisions / 3), Math.floor(2 * p.edoDivisions / 3)];
    }
  }

  // Sub-scale
  p.subScaleNotes = p.customDegrees.filter(() => Math.random() < 0.35);
  p.subScaleWeight = rf(0.5, 0.95);

  // Melody
  p.intervalPeakedness = rf(0.2, 3.5);
  p.intervalRange = ri(2, 16);
  p.momentum = rf(0, 0.9);
  p.motifHitProb = rf(0.75, 1.0);
  p.motifHitRange = ri(1, 5);
  p.precision = rf(0.7, 1.0);
  p.precisionRange = ri(0, 35);

  // Sound source
  const allFormants = Object.keys(FORMANT_PRESETS);
  p.activeFormants = allFormants.filter(() => Math.random() < 0.4);
  if (p.activeFormants.length === 0) p.activeFormants = [rp(allFormants)];
  p.formantWeights = Object.fromEntries(allFormants.map(key => [key, p.activeFormants.includes(key) ? rf(0.35, 1.0) : 0.25]));
  p.formantChangeProb = rf(0.0, 0.4);
  // Accuracy + surprise are global (applied to every formant equally); the
  // per-formant maps are derived from these scalars in ensureFormantWeights.
  p.formantAccuracy = rf(0.65, 1.0);
  p.formantAccuracyRange = ri(1, 2);
  p.surpriseFormantDistance = rf(0.35, 1.0);
  p.voiceMode = rp(["formant", "formant", "fourier", "fourier"]);
  p.toneColorProb = rf(0.0, 0.7);
  p.toneFormantDrift = rf(0, 0.25);
  p.toneResonanceDrift = rf(0, 0.45);
  p.toneBreath = rf(0, 0.18);
  p.vibratoProb = rf(0.0, 0.85);
  p.vibratoDepth = rf(0, 42);
  p.vibratoDepthSd = rf(0, 14);
  p.vibratoRate = rf(3.5, 7.5);
  p.vibratoRateSd = rf(0, 1.6);
  p.spectralProfile = rp(Object.keys(SPECTRAL_PROFILES));
  p.spectralProb = rf(0.45, 1.0);
  p.spectralMix = rf(0.25, 0.85);
  p.spectralPartials = ri(8, 20);
  p.spectralSpread = rf(0.1, 0.85);
  resetSpectralPartialParams(p);
  p.spectralDynamicAmount = rf(0.0, 1.3);
  p.spectralRegisterAmount = rf(0.0, 1.2);
  p.spectralResonanceAmount = rf(0.0, 1.1);
  p.spectralLoudnessNorm = rf(0.25, 0.95);
  p.spectralDriftProb = rf(0.4, 1.0);
  p.spectralDriftDepth = rf(0.1, 0.75);
  p.spectralDriftRate = rf(2.0, 12.0);
  p.spectralStretchCents = ri(0, 10);
  p.envelopeProb = rf(0.0, 0.85);
  p.envelopeRange = rf(0.0, 0.55);
  p.envelopeAttack = rf(0.002, 0.08);
  p.envelopeAttackSd = rf(0.0, 0.06);
  p.envelopeDecay = rf(0.015, 0.22);
  p.envelopeDecaySd = rf(0.0, 0.12);
  p.envelopeSustain = rf(0.28, 0.92);
  p.envelopeSustainSd = rf(0.0, 0.24);
  p.envelopeRelease = rf(0.02, 0.28);
  p.envelopeReleaseSd = rf(0.0, 0.16);

  // Surprise
  p.surpriseProb = rf(0.0, 0.5);
  p.surprisePitchEnabled = true;
  p.surpriseTuningEnabled = Math.random() < 0.24;
  p.surpriseRhythmEnabled = Math.random() < 0.28;
  p.surpriseFormantEnabled = Math.random() < 0.34;
  p.surpriseDynamicsEnabled = Math.random() < 0.22;
  p.surpriseRestEnabled = Math.random() < 0.12;
  p.surprisePitchWeight = rf(0.55, 1);
  p.surpriseTuningWeight = rf(0.15, 0.75);
  p.surpriseRhythmWeight = rf(0.15, 0.75);
  p.surpriseFormantWeight = rf(0.15, 0.75);
  p.surpriseDynamicsWeight = rf(0.1, 0.65);
  p.surpriseRestWeight = rf(0.05, 0.45);
  p.surprisePitchDistance = rf(0.35, 1);
  p.surpriseTuningDistance = rf(0.35, 1);
  p.surpriseRhythmDistance = rf(0.35, 1);
  p.surpriseFormantDistance = rf(0.35, 1);
  p.surpriseDynamicsDistance = rf(0.35, 1);
  p.surpriseAllowMultiple = Math.random() < 0.18;
  syncSurpriseFeatureParams(p);
  p.incorporationRate = rf(0.1, 0.7);
  p.surpriseMaxBaked = rp(["4", "8", "16", "32", "Infinity"]);

  // Root pull
  if (Math.random() < 0.5) {
    const scaleDeg = p.customDegrees || [0];
    p.rootNotes = [rp(scaleDeg)];
    if (Math.random() < 0.3 && scaleDeg.length > 1) {
      const second = rp(scaleDeg.filter(d => d !== p.rootNotes[0]));
      if (second !== undefined) p.rootNotes.push(second);
    }
    p.rootPullStrength = rf(0.1, 0.8);
    p.rootPullShape = rf(0.0, 1.0);
  } else {
    p.rootNotes = [0];
    p.rootPullStrength = 0;
    p.rootPullShape = 0.7;
  }

  // Register
  p.registerCenter = ri(-12, 12);
  p.registerWidth = ri(4, 24);
  p.registerSkew = rf(-0.6, 0.6);

  // Rhythm
  p.beatDivisions = ri(1, 4);
  p.onBeatProb = rf(0.5, 1.0);
  p.offBeatProb = rf(0.0, 0.5);
  p.sameLengthProb = rf(0.0, 0.7);
  p.restMotifStartRatio = rf(0.0, 0.25);
  p.restOnMeterRatio = rf(0.0, 0.35);
  p.restOffMeterRatio = rf(0.0, 0.55);
  p.dynamicsLevel = rf(0.42, 0.78);
  p.loudnessRange = rf(0.3, 0.9);
  p.dynamicsPrecision = rf(0.45, 0.95);
  p.dynamicsRange = rf(0.08, 0.45);
  p.gapProb = rf(0.4, 1.0);
  p.gapMin = rf(-0.35, 0.22);
  p.gapMax = rf(Math.max(p.gapMin, -0.05), 0.55);
  p.gapDistanceSlope = rf(0.0, 1.0);
  p.gapTimingRange = rf(0.0, 0.22);
  p.slideSpeed = rf(0.2, 1.0);
  p.phraseGap = rf(0.1, 0.5);

  // Percussion
  if (Math.random() < 0.5) {
    const percKeys = Object.keys(PERC_SOUNDS);
    p.percBeatVol = rf(0.1, 0.5);
    p.percBeatSound = rp(percKeys);
    p.percMotifVol = rf(0.1, 0.6);
    p.percMotifSound = rp(percKeys);
    p.percDownbeatVol = rf(0.1, 0.5);
    p.percDownbeatSound = rp(percKeys);
    p.percDownbeatEvery = ri(2, 8);
  } else {
    p.percBeatVol = 0;
    p.percMotifVol = 0;
    p.percDownbeatVol = 0;
  }

  // Space
  p.reverbType = rp(Object.keys(REVERB_PROFILES));
  p.reverbWet = rf(0.0, 0.45);
  p.reverbDecay = rf(0.5, 4.2);
  p.reverbTone = rf(0.25, 0.95);
  p.reverbPreDelay = rf(0.0, 0.08);

  // Motif repertoire
  p.motifCount = ri(2, 6);
  p.motifLengthBeats = ri(2, 8);
  p.sequenceProb = rf(0.3, 1.0);
  p.motifSurpriseProb = rf(0.0, 0.5);
}

// Parameter-adjustment telemetry: changes buffer up per control and flush as
// one "adjust" event 3s after the last tweak (or before the next play/rate/
// save event), so a slider drag is a single {from, to} record, not a stream.
let pendingParamChanges = {};
let paramFlushTimer = null;

function noteParamChange(key, from, to) {
  if (from === to) return;
  if (!(key in pendingParamChanges)) pendingParamChanges[key] = { from };
  pendingParamChanges[key].to = to;
  clearTimeout(paramFlushTimer);
  paramFlushTimer = setTimeout(flushParamChanges, 3000);
}

function flushParamChanges() {
  clearTimeout(paramFlushTimer);
  paramFlushTimer = null;
  if (!Object.keys(pendingParamChanges).length) return;
  const changes = pendingParamChanges;
  pendingParamChanges = {};
  trackEngagement("adjust", { changes });
}

function trackEngagement(type, extra = {}) {
  if (type !== "adjust") flushParamChanges();
  if (!exploreEngagement.plays) exploreEngagement.plays = 0;
  if (!exploreEngagement.saves) exploreEngagement.saves = 0;
  if (!exploreEngagement.startedAt) exploreEngagement.startedAt = Date.now();
  if (type === "play") { exploreEngagement.plays++; lastPlayStartedAt = Date.now(); }
  if (type === "save") exploreEngagement.saves++;
  saveEngagement();

  // Nothing leaves the browser unless the volunteer opted in on the welcome
  // card. Local engagement counters above still run so the app works fully.
  if (!researchOptedIn()) return;

  fetch("/api/explore/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schema_version: EVENT_SCHEMA_VERSION,
      event_type: type,
      participant_id: pid(),
      session_id: SESSION_ID,
      stimulus_id: stimulusIdFor(exploreParams),
      app_version: APP_VERSION,
      client_ts: new Date().toISOString(),
      parameters: { ...exploreParams },
      rating: exploreRating,
      play_count: exploreEngagement.plays,
      metrics: synth.getPerformanceMetrics?.() || null,
      ...extra,
    }),
  }).catch(() => {});
}

function paletteEditBannerHTML() {
  const state = paletteEditState();
  if (!state) return "";
  return `
    <div class="card palette-edit-banner">
      <span>Editing palette instrument <strong>${esc(state.name)}</strong> — tweak the sound, then:</span>
      <span class="peb-actions">
        <button class="btn btn-primary btn-sm" id="palSave" title="Update the instrument — every region using it follows">Save to palette</button>
        <button class="btn btn-secondary btn-sm" id="palSaveCopy" title="Keep the original and add this as a new palette instrument">Save as copy</button>
        <button class="btn btn-ghost btn-sm" id="palDiscard">Discard</button>
      </span>
    </div>`;
}

function wirePaletteEditBanner(v) {
  const state = paletteEditState();
  if (!state) return;
  const done = () => {
    setPaletteEditState(null);
    synth.stop();
    navigate("produce");
  };
  const save = v.querySelector("#palSave");
  if (save) save.onclick = () => {
    arrangement = arrangement || loadArrangement();
    const pl = (arrangement.palette || []).find(x => x.id === state.paletteId);
    if (pl) {
      pl.params = extractInstrumentParams(exploreParams);
      saveArrangement();
    }
    done();
  };
  const copy = v.querySelector("#palSaveCopy");
  if (copy) copy.onclick = () => {
    arrangement = arrangement || loadArrangement();
    arrangement.palette = arrangement.palette || [];
    arrangement.palette.push({
      id: crypto.randomUUID(),
      name: `${state.name} copy`,
      kindLabel: "Edited",
      params: extractInstrumentParams(exploreParams),
    });
    saveArrangement();
    done();
  };
  const discard = v.querySelector("#palDiscard");
  if (discard) discard.onclick = done;
}

function welcomeCardHTML() {
  if (loadConsent()) return "";
  return `
    <div class="card welcome-card" id="welcomeCard">
      <h2>Welcome to the Sound Studio</h2>
      <p>Shape a stream of generated music by playing with the controls — no musical
      experience needed. The studio is also part of a research project on why music
      sounds good: if you opt in, the settings you explore and the ratings you give
      are shared anonymously with the researchers. No account, no personal details,
      and everything here works either way. Opting in is for adults (18+).</p>
      <div class="welcome-demographics">
        <label>Age
          <select id="welcomeAge">
            <option value="">Prefer not to say</option>
            <option>18–24</option><option>25–34</option><option>35–44</option>
            <option>45–54</option><option>55–64</option><option>65+</option>
          </select>
        </label>
        <label>Musical training
          <select id="welcomeTraining">
            <option value="">Prefer not to say</option>
            <option>None</option><option>Under 2 years</option><option>2–5 years</option>
            <option>5–10 years</option><option>10+ years</option>
          </select>
        </label>
      </div>
      <div class="welcome-actions">
        <button class="btn btn-primary" id="welcomeOptIn">Play and share my ratings</button>
        <button class="btn btn-secondary" id="welcomeOptOut">Just play</button>
      </div>
      <p class="welcome-smallprint">Both questions are optional. You can change your
      choice any time from the note at the bottom of the page.</p>
    </div>`;
}

function wireWelcomeCard(v) {
  const card = v.querySelector("#welcomeCard");
  if (card) {
    card.querySelector("#welcomeOptIn").onclick = () => {
      const demographics = {
        age_band: card.querySelector("#welcomeAge").value || null,
        musical_training: card.querySelector("#welcomeTraining").value || null,
      };
      saveConsent({
        status: "granted",
        consent_version: CONSENT_VERSION,
        decided_at: new Date().toISOString(),
        demographics,
      });
      trackEngagement("consent", {
        consent: { status: "granted", consent_version: CONSENT_VERSION, demographics },
      });
      card.remove();
      updateResearchNote(v);
    };
    card.querySelector("#welcomeOptOut").onclick = () => {
      saveConsent({
        status: "declined",
        consent_version: CONSENT_VERSION,
        decided_at: new Date().toISOString(),
      });
      card.remove();
      updateResearchNote(v);
    };
  }
  updateResearchNote(v);
}

function updateResearchNote(v) {
  const note = v.querySelector("#researchNote");
  if (!note) return;
  if (!loadConsent()) { note.innerHTML = ""; return; }
  const on = researchOptedIn();
  note.innerHTML = `Anonymous research sharing is <strong>${on ? "on" : "off"}</strong>${on ? " — thank you for helping" : ""}. <button class="link-btn" id="researchChangeBtn">Change</button>`;
  note.querySelector("#researchChangeBtn").onclick = () => {
    localStorage.removeItem(CONSENT_KEY);
    renderExplore();
  };
}

function maybeShowContribute(v) {
  const area = v.querySelector("#contributeArea");
  if (!area) return;
  const e = exploreEngagement;
  const elapsed = e.startedAt ? (Date.now() - e.startedAt) / 60000 : 0;
  const qualified = (e.plays >= 5 && e.saves >= 2) || elapsed > 10;
  if (!qualified) { area.innerHTML = ""; return; }

  area.innerHTML = `
    <div class="contribute-prompt card mt-2">
      <h3>Share this sound</h3>
      <p>Add your current settings to the shared library so other listeners can hear and build from them.</p>
      <div class="contribute-fields">
        <input type="text" id="contribAlias" placeholder="Alias (optional)" maxlength="60"/>
        <textarea id="contribNotes" placeholder="Notes: why do you like this sound? (optional)" maxlength="400"></textarea>
        <label class="form-check">
          <input type="checkbox" id="contribConsent"/>
          <span>I agree to add this preset to the shared sound library.</span>
        </label>
        <button class="btn btn-primary" id="contribBtn">Share preset</button>
      </div>
    </div>`;

  area.querySelector("#contribBtn").onclick = async () => {
    const consent = area.querySelector("#contribConsent");
    if (!consent.checked) return;
    const btn = area.querySelector("#contribBtn");
    btn.disabled = true;
    btn.textContent = "Sharing…";
    try {
      await api("/api/presets/contribute", {
        method: "POST",
        body: JSON.stringify({
          share_consent: true,
          participant_id: pid(),
          participant_alias: area.querySelector("#contribAlias").value,
          preset_name: "Contributed preset",
          notes: area.querySelector("#contribNotes").value,
          favourite_rating: exploreRating,
          parameters: { ...exploreParams },
          stimulus_id: stimulusIdFor(exploreParams),
          session_id: SESSION_ID,
          app_version: APP_VERSION,
        }),
      });
      btn.textContent = "Shared!";
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.disabled = false;
        btn.textContent = "Share preset";
      }, 2000);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Share preset";
      alert("Could not contribute: " + err.message);
    }
  };
}

// ── Per-panel preset bars (owner feedback: presets live where the controls
// live). Each section panel gets a compact load-select + save button acting
// on that section only; the central library remains for browsing/sharing.
function panelPresetBarHTML(section) {
  const label = PRESET_SECTIONS[section]?.label || section;
  const options = [...FACTORY_PRESETS, ...loadPresets()]
    .filter(p => (p.section || "full") === section)
    .map(p => `<option value="${esc(String(p.id))}">${esc(p.name || "Untitled")}</option>`)
    .join("");
  return `
    <div class="panel-presets" data-panel-section="${section}">
      <select data-panel-preset-load="${section}" title="Load a saved ${esc(label)} preset into this section only — everything else stays as it is">
        <option value="">${esc(label)} presets…</option>${options}
      </select>
      <button class="btn btn-ghost btn-sm" data-panel-preset-save="${section}" title="Save the current ${esc(label)} settings as a section preset">+ Save</button>
    </div>`;
}

function wirePanelPresetBars(v) {
  const findEntry = (id) =>
    [...FACTORY_PRESETS, ...loadPresets()].find(p => String(p.id) === id);
  v.querySelectorAll("[data-panel-preset-load]").forEach(sel => {
    sel.onchange = () => {
      const entry = sel.value && findEntry(sel.value);
      if (!entry) return;
      const wasPlaying = presetPreview ? presetPreview.wasPlaying : synth.isPlaying;
      presetPreview = null;
      exploreParams = mergedPresetParams(entry);
      renderExplore();
      if (wasPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
    };
  });
  v.querySelectorAll("[data-panel-preset-save]").forEach(btn => {
    btn.onclick = () => {
      const section = btn.dataset.panelPresetSave;
      const label = PRESET_SECTIONS[section]?.label || section;
      const name = prompt(`Name this ${label} preset:`);
      if (!name || !name.trim()) return;
      const entry = {
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        name: name.trim().slice(0, 80),
        section,
        rating: exploreRating,
        parameters: extractSectionParams(exploreParams, section),
        app_version: APP_VERSION,
      };
      const list = loadPresets();
      list.unshift(entry);
      savePresets(list);
      trackEngagement("save");
      renderExplore(); // refresh every panel bar + library list
    };
  });
}

function mergedPresetParams(entry) {
  // Tone v2 migration (T6): pre-v2 tone keys translate on load — stretch
  // cents become a physical B, old drift wobble seeds the Human dial,
  // dead keys stop travelling.
  const loaded = migrateToneParams({ ...entry.parameters });
  if (loaded.motifLength && !loaded.motifLengthBeats) loaded.motifLengthBeats = loaded.motifLength;
  const merged = entry.section && entry.section !== "full"
    ? { ...exploreParams, ...loaded }
    : { ...DEFAULTS, ...loaded };
  if (!Array.isArray(merged.rootNotes)) merged.rootNotes = [0];
  return merged;
}

function startPresetPreview(entry) {
  if (!presetPreview) {
    presetPreview = { wasPlaying: synth.isPlaying, presetId: entry.id };
  } else {
    presetPreview.presetId = entry.id;
  }
  synth.play(mergedPresetParams(entry));
  startVisualiser();
  syncPreviewButtons();
}

function endPresetPreview() {
  if (!presetPreview) return;
  const { wasPlaying } = presetPreview;
  presetPreview = null;
  if (wasPlaying) {
    synth.play({ ...exploreParams });
    startVisualiser();
  } else {
    synth.stop();
    cancelAnimationFrame(animFrame);
  }
  syncPreviewButtons();
}

function syncPreviewButtons() {
  document.querySelectorAll("[data-preview]").forEach(btn => {
    const active = presetPreview && presetPreview.presetId === btn.dataset.preview;
    btn.classList.toggle("previewing", !!active);
    btn.textContent = active ? "■" : "▶";
  });
}

function renderInstrumentTab(root) {
  const entries = root.querySelector("#instrumentEntries");
  if (!entries) return;
  const instruments = loadInstruments().map(inst => ({ ...inst, section: "instrument" }));
  renderPresetList(entries, instruments, "instrument");
  if (!instruments.length) {
    entries.innerHTML = '<div class="empty-state">No instruments yet. Dial in a voice you like, then capture it above — tempo, key, and space stay with the session.</div>';
  }
}

function renderPresetList(container, presets, source) {
  if (libraryFilter.startsWith("family:") && source !== "instrument") {
    presets = presets.filter(p => p.family === libraryFilter.slice(7));
  } else if (libraryFilter !== "all" && source !== "instrument") {
    presets = presets.filter(p => (p.section && p.section !== "full" ? p.section : "full") === libraryFilter);
  }
  if (splitsFilter !== "all" && source !== "instrument") {
    presets = presets.filter(p => splitsBucketOf(p.parameters) === splitsFilter);
  }
  if (!presets.length) {
    container.innerHTML = '<div class="empty-state">No presets yet. Save one to get started.</div>';
    decorateTooltips(container);
    return;
  }
  container.innerHTML = presets.map(p => {
    const sectionKey = p.section && p.section !== "full" ? p.section : null;
    const sectionLabel = sectionKey
      ? (PRESET_SECTIONS[sectionKey]?.label || (sectionKey === "instrument" ? "Instrument" : sectionKey))
      : null;
    return `
    <div class="preset-item">
      <span class="name">${esc(p.name || p.preset_name || "Untitled")}</span>
      <span class="section-chip${sectionKey ? "" : " chip-full"}">${sectionLabel || "Full"}</span>
      ${p.family ? `<span class="family-tag">${esc(p.family)}</span>` : ""}
      <span class="meta">${p.description ? esc(p.description) : (sectionLabel ? `${Object.keys(p.parameters || {}).length} settings` : presetSummary(p.parameters))}</span>
      <span class="score">${(p.rating || p.favourite_rating) ? `${p.rating || p.favourite_rating}/7` : ""}</span>
      <div class="actions">
        <button class="btn btn-ghost btn-sm preview-btn" data-preview="${p.id}" title="Preview: hear this preset merged into your current sound, without changing anything">▶</button>
        <button class="btn btn-secondary btn-sm" data-load='${JSON.stringify(p.parameters)}' data-section="${sectionKey || "full"}">Load</button>
        ${source === "my" || source === "instrument" ? `<button class="btn btn-ghost btn-sm" data-remove="${p.id}">Remove</button>` : ""}
      </div>
    </div>
  `;
  }).join("");

  const entryById = new Map(presets.map(p => [String(p.id), p]));

  container.querySelectorAll("[data-preview]").forEach(btn => {
    btn.onclick = () => {
      const entry = entryById.get(btn.dataset.preview);
      if (!entry) return;
      if (presetPreview && presetPreview.presetId === btn.dataset.preview) {
        endPresetPreview();
      } else {
        startPresetPreview(entry);
      }
    };
  });

  container.querySelectorAll("[data-load]").forEach(btn => {
    btn.onclick = () => {
      const section = btn.dataset.section || "full";
      const wasPlaying = presetPreview ? presetPreview.wasPlaying : synth.isPlaying;
      presetPreview = null; // loading commits: no revert
      exploreParams = mergedPresetParams({
        parameters: JSON.parse(btn.dataset.load),
        section,
      });
      renderExplore();
      if (wasPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
    };
  });
  container.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = () => {
      if (source === "instrument") {
        saveInstruments(loadInstruments().filter(p => p.id !== btn.dataset.remove));
        renderInstrumentTab(container.closest(".view") || document);
        return;
      }
      savePresets(loadPresets().filter(p => p.id !== btn.dataset.remove));
      renderPresetList(container, loadPresets(), source);
    };
  });
  container.querySelectorAll("[data-load]").forEach(btn => setTooltip(
    btn,
    btn.dataset.section === "full"
      ? "Load this preset and restore its full parameter set."
      : `Apply just this ${PRESET_SECTIONS[btn.dataset.section]?.label || "section"} preset, keeping everything else as it is.`
  ));
  container.querySelectorAll("[data-remove]").forEach(btn => setTooltip(btn, "Remove this saved local preset."));
  container.querySelectorAll(".preset-item").forEach(item => setTooltip(item, "Saved parameter set. Load it to hear the sound."));
}

async function loadGlobalPresets(container) {
  container.innerHTML = '<div class="empty-state">Loading shared library...</div>';
  try {
    const entries = await api("/api/presets/global");
    renderPresetList(container, entries, "global");
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        Could not load the shared library (${esc(err.message)}).<br/>
        <button class="btn btn-secondary btn-sm mt-2" id="libRetry">Try again</button>
      </div>`;
    const retry = container.querySelector("#libRetry");
    if (retry) retry.onclick = () => loadGlobalPresets(container);
  }
}

function presetSummary(p) {
  if (!p) return "";
  const tempo = p.tempo || "?";
  const scale = p.scalePreset
    ? (SCALE_PRESETS[p.scalePreset]?.label || p.scalePreset)
    : (p.edoDivisions ? `${p.edoDivisions}-EDO` : "?");
  return `${tempo} BPM, ${scale}`;
}

// ─── Visualiser ─────────────────────────────────────────────

// ─── Output: master fader + limiter ─────────────────────────

const _MASTER_THUMB_H = 18;
const _MASTER_DB_LO = -60, _MASTER_DB_HI = 6;   // fader travel range in dB
let masterFrac = (0 - _MASTER_DB_LO) / (_MASTER_DB_HI - _MASTER_DB_LO);  // start at 0 dB

function _fracToDb(f) {
  return f <= 0.001 ? -Infinity : _MASTER_DB_LO + f * (_MASTER_DB_HI - _MASTER_DB_LO);
}
function _fracToGain(f) {
  const db = _fracToDb(f);
  return db === -Infinity ? 0 : Math.pow(10, db / 20);
}

function wireOutputControls(v) {
  const fader = v.querySelector("#masterFader");
  const thumb = fader ? fader.querySelector("span") : null;
  const readout = v.querySelector("#masterReadout");

  const applyMaster = (f) => {
    masterFrac = Math.max(0, Math.min(1, f));
    if (thumb && fader) {
      const travel = Math.max(0, (fader.clientHeight || 56) - _MASTER_THUMB_H);
      thumb.style.top = `${(1 - masterFrac) * travel}px`;
    }
    if (readout) {
      const db = _fracToDb(masterFrac);
      readout.textContent = db === -Infinity ? "-∞ dB"
        : `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
    }
    synth.setMasterVolume(_fracToGain(masterFrac));
  };

  if (fader && thumb) {
    applyMaster(masterFrac);
    // Scale-independent: dashboard may be CSS-transform-scaled to fit viewport,
    // so derive the fraction directly from the (visual) bounding rect.
    const fracFromY = (clientY) => {
      const rect = fader.getBoundingClientRect();
      return 1 - (clientY - rect.top) / Math.max(1, rect.height);
    };
    const onMove = (e) => { e.preventDefault(); applyMaster(fracFromY(e.clientY)); };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    fader.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      applyMaster(fracFromY(e.clientY));
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    // Scroll wheel for fine adjustment
    fader.addEventListener("wheel", (e) => {
      e.preventDefault();
      applyMaster(masterFrac - Math.sign(e.deltaY) * 0.03);
    }, { passive: false });
  }

  const limiterBtn = v.querySelector("#limiterBtn");
  if (limiterBtn) {
    synth.setLimiter(limiterBtn.classList.contains("active"));
    limiterBtn.onclick = () => {
      const on = !limiterBtn.classList.contains("active");
      limiterBtn.classList.toggle("active", on);
      limiterBtn.textContent = on ? "On" : "Off";
      synth.setLimiter(on);
    };
  }
}

function startVisualiser() {
  cancelAnimationFrame(animFrame);
  drawLoop();
}

function drawLoop() {
  if (!canvas || !canvasCtx) return;
  animFrame = requestAnimationFrame(drawLoop);

  updateEngineState();

  // Live note trace on the macro histograms (throttled; fades out after playback stops)
  if (synth.isPlaying) {
    const tnow = performance.now();
    if (tnow - _lastMarkerTick >= 40) { _lastMarkerTick = tnow; drawMacroDistsAll(); }
    _markersActive = true;
  } else if (_markersActive) {
    _markersActive = false;
    drawMacroDistsAll();   // one final clean redraw to clear the trace
  }

  if (visMode === "motifs") { drawMotifTimeline(); return; }
  if (visMode === "pianoroll") { drawPianoRoll(); return; }

  const data = synth.getSpectrum();
  if (!data || !synth.isPlaying) { drawStaticVis(); return; }

  const w = canvas.width, h = canvas.height;
  const ctx = canvasCtx;
  ctx.fillStyle = "#0b1219";
  ctx.fillRect(0, 0, w, h);

  drawAnalyserGrid(ctx, w, h);
  drawSpectrumCurve(ctx, data, w, h);
}

function drawStaticVis() {
  if (!canvas || !canvasCtx) return;
  if (visMode === "motifs") { drawMotifTimeline(); return; }
  if (visMode === "pianoroll") { drawPianoRoll(); return; }
  const w = canvas.width, h = canvas.height;
  const ctx = canvasCtx;
  ctx.fillStyle = "#0b1219";
  ctx.fillRect(0, 0, w, h);
  drawAnalyserGrid(ctx, w, h);
}

// ─── Auto-scrolling motif / piano-roll visualisers ──────────────

const VIS_PX_PER_SEC = 132;        // note-view (piano roll) scroll speed
const MOTIF_PX_PER_SEC = 80;       // motif view: zoomed out so more pattern fits
const VIS_PLAYHEAD_FRAC = 0.74;    // playhead position (fraction of width from left)

// Stable hue per base-motif index, evenly spread around the colour wheel.
function motifHue(baseIndex) {
  const golden = 47.0;          // pleasant spacing
  return ((baseIndex * golden) % 360 + 360) % 360;
}

// Deviation "heat" ramp: 0 = cool/calm (teal), 1 = hot (red-orange).
// Used to show how far a recurring variant drifted from its canonical form.
function heatColor(t, alpha = 1) {
  const x = Math.max(0, Math.min(1, t));
  // teal(185) → green(120) → amber(48) → red(8) as deviation grows
  const hue = 185 - 177 * Math.pow(x, 0.85);
  const sat = 70 + 26 * x;
  const light = 44 + 14 * x;
  return `hsla(${hue.toFixed(0)},${sat.toFixed(0)}%,${light.toFixed(0)}%,${alpha})`;
}

function motifLabel(baseIndex) {
  // A, B, C … then A2, B2 … for safety
  const letter = String.fromCharCode(65 + (baseIndex % 26));
  const wrap = Math.floor(baseIndex / 26);
  return wrap > 0 ? `${letter}${wrap + 1}` : letter;
}

function visGroupMotifs(events) {
  // Collapse consecutive notes that share the same motif occurrence into units.
  const units = [];
  for (const ev of events) {
    const last = units[units.length - 1];
    const sameUnit = last
      && ev.motifIndex === last.motifIndex
      && !ev.isMotifStart
      && ev.when >= last.start - 1e-6;
    if (sameUnit) {
      last.end = ev.when + ev.dur;
      last.notes.push(ev);
      if (ev.isSurprise) last.hasSurprise = true;
    } else {
      units.push({
        motifIndex: ev.motifIndex,
        baseIndex: ev.baseIndex ?? ev.motifIndex,
        isVariant: !!ev.isVariant,
        hasSurprise: !!ev.isSurprise,
        pitchDev: ev.pitchDev || 0,
        rhythmDev: ev.rhythmDev || 0,
        start: ev.when,
        end: ev.when + ev.dur,
        notes: [ev],
      });
    }
  }
  return units;
}

function visBackdrop(ctx, w, h) {
  ctx.fillStyle = "#0b1219";
  ctx.fillRect(0, 0, w, h);
}

function drawMotifTimeline() {
  if (!canvas || !canvasCtx) return;
  const ctx = canvasCtx;
  const w = canvas.width, h = canvas.height;
  visBackdrop(ctx, w, h);

  const tl = synth.getNoteTimeline ? synth.getNoteTimeline() : null;
  const playheadX = Math.round(w * VIS_PLAYHEAD_FRAC);
  const now = tl ? tl.now : 0;
  const PPS = MOTIF_PX_PER_SEC;

  // Faint time gridlines (every 1s)
  ctx.strokeStyle = "rgba(96,165,250,0.08)";
  ctx.lineWidth = 1;
  for (let s = -16; s <= 8; s++) {
    const x = playheadX + s * PPS;
    if (x < 0 || x > w) continue;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }

  if (!tl || !tl.events.length) {
    visEmptyMessage(ctx, w, h, "Press play to watch motifs unfold");
    drawPlayhead(ctx, playheadX, h);
    return;
  }

  const units = visGroupMotifs(tl.events);
  const bandTop = 20, bandBot = h - 26;   // leave room for the heat strip
  const bandH = bandBot - bandTop;
  const HEAT_H = 8;                         // height of each deviation micro-row

  for (const u of units) {
    const x0 = playheadX + (u.start - now) * PPS;
    const x1 = playheadX + (u.end - now) * PPS;
    if (x1 < -4 || x0 > w + 4) continue;
    const bw = Math.max(7, x1 - x0 - 2);
    const hue = motifHue(u.baseIndex);
    const played = u.end <= now;
    const baseAlpha = played ? 0.42 : 0.92;

    // Variants sit slightly inset so identity (hue) still reads as primary.
    const inset = u.isVariant ? bandH * 0.12 : 0;
    const top = bandTop + inset;
    const bh = bandH - inset * 2;

    ctx.save();
    // ── Identity block (hue = which motif) ──
    roundRectPath(ctx, x0 + 1, top, bw, bh, 5);
    const grad = ctx.createLinearGradient(0, top, 0, top + bh);
    const light = u.isVariant ? 62 : 52;
    grad.addColorStop(0, `hsla(${hue},70%,${light}%,${baseAlpha})`);
    grad.addColorStop(1, `hsla(${hue},72%,${light - 16}%,${baseAlpha})`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = u.hasSurprise ? 2.5 : 1.3;
    ctx.strokeStyle = u.hasSurprise
      ? "rgba(255,236,170,0.95)"
      : `hsla(${hue},80%,${u.isVariant ? 76 : 66}%,0.9)`;
    ctx.stroke();

    // Surprise glow (genuine novelty = first appearance)
    if (u.hasSurprise) {
      ctx.shadowColor = "rgba(255,210,90,0.85)";
      ctx.shadowBlur = 15;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Internal rhythm ticks
    if (bw > 24) {
      ctx.fillStyle = `hsla(${hue},90%,90%,${played ? 0.35 : 0.62})`;
      for (const n of u.notes) {
        if (n.isRest || n.velocity <= 0) continue;
        const nx = playheadX + (n.when - now) * PPS;
        if (nx < x0 || nx > x1) continue;
        ctx.fillRect(Math.round(nx) + 0.5, top + 3, 1.2, bh - 6);
      }
    }

    // Label
    if (bw > 13) {
      ctx.fillStyle = played ? "rgba(8,14,20,0.7)" : "rgba(6,12,18,0.92)";
      ctx.font = "700 11px 'SF Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tag = motifLabel(u.baseIndex) + (u.isVariant ? "′" : "");
      ctx.fillText(tag, x0 + 1 + bw / 2, top + bh / 2);
    }
    ctx.restore();

    // ── Deviation heat strip (accuracy difference from the base motif) ──
    // Two micro-rows: melody (pitch) on top, note-length (rhythm) below.
    const stripA = played ? 0.5 : 0.95;
    const sy = bandBot + 2;
    const pd = u.pitchDev || 0, rd = u.rhythmDev || 0;
    // faint track so originals (dev≈0) still read as a calm baseline
    ctx.fillStyle = played ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.10)";
    ctx.fillRect(x0 + 1, sy, bw, HEAT_H * 2 + 1);
    if (u.isVariant && (pd > 0.001 || rd > 0.001)) {
      ctx.fillStyle = heatColor(pd, stripA);
      ctx.fillRect(x0 + 1, sy, bw, HEAT_H);
      ctx.fillStyle = heatColor(rd, stripA);
      ctx.fillRect(x0 + 1, sy + HEAT_H + 1, bw, HEAT_H);
    }

    // "NEW" badge for surprise-introduced units
    if (u.hasSurprise && bw > 12) {
      ctx.fillStyle = "rgba(255,222,120,0.95)";
      ctx.font = "700 8px 'SF Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("NEW", x0 + 1 + bw / 2, top - 4);
    }
  }

  // Legend + playhead
  visLegend(ctx, w, [
    ["hue", "rgba(140,170,210,0.9)", "identity"],
    ["heat", "heat", "drift ↑mel ↓len"],
    ["glow", "rgba(255,222,120,0.95)", "surprise"],
  ]);
  drawPlayhead(ctx, playheadX, h);
}

function drawPianoRoll() {
  if (!canvas || !canvasCtx) return;
  const ctx = canvasCtx;
  const w = canvas.width, h = canvas.height;
  visBackdrop(ctx, w, h);

  const tl = synth.getNoteTimeline ? synth.getNoteTimeline() : null;
  const playheadX = Math.round(w * VIS_PLAYHEAD_FRAC);
  const now = tl ? tl.now : 0;
  const scale = tl ? tl.scale : null;

  if (!tl || !tl.events.length || !scale) {
    visEmptyMessage(ctx, w, h, "Press play to watch the piano roll");
    drawPlayhead(ctx, playheadX, h);
    return;
  }

  const div = scale.div || 12;
  const top = 6, bot = h - 6;
  const plotH = bot - top;

  // Determine visible pitch range from on-screen notes, then smooth it.
  const leftTime = now - playheadX / VIS_PX_PER_SEC;
  const rightTime = now + (w - playheadX) / VIS_PX_PER_SEC;
  let lo = Infinity, hi = -Infinity;
  for (const ev of tl.events) {
    if (ev.isRest || ev.velocity <= 0) continue;
    if (ev.when + ev.dur < leftTime || ev.when > rightTime) continue;
    if (ev.degree < lo) lo = ev.degree;
    if (ev.degree > hi) hi = ev.degree;
  }
  if (!isFinite(lo)) { lo = -6; hi = 6; }
  lo -= 2.5; hi += 2.5;
  const MIN_SPAN = 11;
  if (hi - lo < MIN_SPAN) { const mid = (lo + hi) / 2; lo = mid - MIN_SPAN / 2; hi = mid + MIN_SPAN / 2; }
  // Smooth toward target range
  if (!_pianoRange) _pianoRange = { lo, hi };
  else {
    _pianoRange.lo += (lo - _pianoRange.lo) * 0.12;
    _pianoRange.hi += (hi - _pianoRange.hi) * 0.12;
  }
  const rLo = _pianoRange.lo, rHi = _pianoRange.hi;
  const span = Math.max(1, rHi - rLo);
  const yFor = (deg) => bot - ((deg - rLo) / span) * plotH;
  const rowH = plotH / span;

  // Pitch lanes — highlight in-scale (sub) degrees brightest, other scale degrees faint.
  const subSet = new Set(scale.sub);
  const allSet = new Set(scale.all);
  const dLo = Math.floor(rLo), dHi = Math.ceil(rHi);
  for (let d = dLo; d <= dHi; d++) {
    const pc = ((d % div) + div) % div;
    const inSub = subSet.has(pc);
    const inAll = allSet.has(pc);
    if (!inAll && !inSub) continue;
    const y = yFor(d);
    ctx.fillStyle = inSub ? "rgba(96,165,250,0.10)" : "rgba(120,140,160,0.045)";
    ctx.fillRect(0, y - rowH, w, rowH);
    // Tonic (pc 0) gets a stronger lane line
    if (pc === 0) {
      ctx.strokeStyle = "rgba(245,158,11,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  // Beat + motif gridlines, aligned to motif boundaries in the event stream.
  drawPianoGrid(ctx, tl, now, playheadX, w, h);

  // Notes — drawn as flat, slim bars (a read-only scrolling display, not editable blocks)
  const nh = Math.max(2.5, Math.min(9, rowH * 0.5));
  for (const ev of tl.events) {
    if (ev.isRest || ev.velocity <= 0) continue;
    const x0 = playheadX + (ev.when - now) * VIS_PX_PER_SEC;
    const x1 = playheadX + (ev.when + ev.dur - now) * VIS_PX_PER_SEC;
    if (x1 < -2 || x0 > w + 2) continue;
    const y = yFor(ev.degree);
    const nw = Math.max(3, x1 - x0 - 1.5);
    const hue = motifHue(ev.baseIndex ?? ev.motifIndex);
    const played = ev.when + ev.dur <= now;
    const alpha = (played ? 0.45 : 0.92) * (0.5 + 0.5 * Math.min(1, ev.velocity / 0.9));

    if (ev.isSurprise) {
      ctx.fillStyle = `rgba(255,224,130,${played ? 0.6 : 0.95})`;
      ctx.shadowColor = "rgba(255,210,90,0.7)";
      ctx.shadowBlur = 7;
      ctx.fillRect(x0 + 0.5, y - nh / 2, nw, nh);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = `hsla(${hue},70%,60%,${alpha})`;
      ctx.fillRect(x0 + 0.5, y - nh / 2, nw, nh);
    }
  }

  drawPlayhead(ctx, playheadX, h);
}

function drawPianoGrid(ctx, tl, now, playheadX, w, h) {
  // Use motif-start events to place strong divisions; subdivide by beats.
  const starts = tl.events.filter(e => e.isMotifStart);
  for (const ev of tl.events) {
    // Beat divisions within each note span
    const beatDiv = ev.beatDivisions || 1;
    const divSec = ev.dur / Math.max(1, ev.durationDivs || 1);
    const firstDiv = ev.when;
    for (let i = 0; i <= (ev.durationDivs || 1); i++) {
      const t = firstDiv + i * divSec;
      const x = playheadX + (t - now) * VIS_PX_PER_SEC;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = "rgba(96,165,250,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  }
  // Strong motif boundary lines
  for (const s of starts) {
    const x = playheadX + (s.when - now) * VIS_PX_PER_SEC;
    if (x < 0 || x > w) continue;
    ctx.strokeStyle = "rgba(245,158,11,0.28)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    // Motif label tag at top
    ctx.fillStyle = "rgba(245,180,90,0.8)";
    ctx.font = "700 9px 'SF Mono', ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(motifLabel(s.baseIndex ?? s.motifIndex) + (s.isVariant ? "′" : ""), x + 3, 3);
  }
}

function drawPlayhead(ctx, x, h) {
  ctx.strokeStyle = "rgba(245,158,11,0.9)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = "rgba(245,158,11,0.7)";
  ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  ctx.shadowBlur = 0;
  // Top arrow marker
  ctx.fillStyle = "rgba(245,158,11,0.95)";
  ctx.beginPath();
  ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7); ctx.closePath();
  ctx.fill();
}

function visEmptyMessage(ctx, w, h, msg) {
  ctx.fillStyle = "rgba(150,170,190,0.4)";
  ctx.font = "600 12px 'SF Mono', ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(msg, w / 2, h / 2);
}

function visLegend(ctx, w, items) {
  let x = 12;
  const y = 14;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "600 9px 'SF Mono', ui-monospace, monospace";
  for (const [kind, color, label] of items) {
    if (kind === "hue") {
      // filled swatch in a sample motif colour
      ctx.fillStyle = `hsla(${motifHue(1)},70%,55%,0.95)`;
      ctx.fillRect(x, y - 5, 14, 10);
    } else if (kind === "heat") {
      // cool→hot gradient swatch
      const g = ctx.createLinearGradient(x, 0, x + 14, 0);
      g.addColorStop(0, heatColor(0.05)); g.addColorStop(0.5, heatColor(0.5)); g.addColorStop(1, heatColor(1));
      ctx.fillStyle = g;
      ctx.fillRect(x, y - 5, 14, 10);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      if (kind === "dash") ctx.setLineDash([4, 3]);
      if (kind === "glow") { ctx.shadowColor = color; ctx.shadowBlur = 6; }
      ctx.strokeRect(x, y - 5, 14, 10);
      ctx.setLineDash([]); ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "rgba(170,190,210,0.75)";
    ctx.fillText(label, x + 18, y);
    x += 18 + ctx.measureText(label).width + 14;
  }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawAnalyserGrid(ctx, w, h) {
  ctx.strokeStyle = "rgba(245,158,11,0.15)";
  ctx.lineWidth = 1;
  for (let y = 20; y < h; y += 24) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(96,165,250,0.08)";
  for (let x = 36; x < w; x += 56) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
}

function drawSpectrumCurve(ctx, data, w, h) {
  const pad = 10;
  const points = [];
  for (let i = 0; i < data.length; i++) {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const v = Math.max(0, Math.min(1, data[i] / 255));
    const y = h - pad - v * (h - pad * 2);
    points.push([x, y]);
  }
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.lineTo(w - pad, h - pad);
  ctx.lineTo(pad, h - pad);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, pad, 0, h - pad);
  fill.addColorStop(0, "rgba(59,130,246,0.28)");
  fill.addColorStop(1, "rgba(59,130,246,0.02)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.strokeStyle = "rgba(96,165,250,0.95)";
  ctx.shadowColor = "rgba(59,130,246,0.55)";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function resetMeters() {
  const mL = document.getElementById("meterL");
  const mR = document.getElementById("meterR");
  if (mL) mL.style.transform = "scaleY(0.015)";
  if (mR) mR.style.transform = "scaleY(0.015)";
}

function updateEngineState() {
  // Live output meters (reflect master fader + limiter)
  const lvl = synth.getOutputLevel ? synth.getOutputLevel() : 0;
  const mL = document.getElementById("meterL");
  const mR = document.getElementById("meterR");
  if (mL || mR) {
    const s = Math.max(0.015, Math.min(1, lvl));
    if (mL) mL.style.transform = `scaleY(${s})`;
    if (mR) mR.style.transform = `scaleY(${Math.max(0.015, s * 0.94)})`;
  }

  const state = synth.getEngineState();
  if (!state) return;
  const m = document.getElementById("statMotifs");
  const s = document.getElementById("statSeq");
  const n = document.getElementById("statNotes");
  if (m) m.textContent = state.motifCount;
  if (s) s.textContent = state.seqLen;
  if (n) n.textContent = state.notes;
  if (Number.isFinite(state.surpriseCount)) {
    if (state.surpriseCount < lastSurpriseCount) lastSurpriseCount = state.surpriseCount;
    if (state.surpriseCount > lastSurpriseCount) {
      const card = document.getElementById("visualCard");
      if (card) {
        card.classList.remove("surprise-flash");
        void card.offsetWidth;
        card.classList.add("surprise-flash");
        window.setTimeout(() => card.classList.remove("surprise-flash"), 560);
      }
      lastSurpriseCount = state.surpriseCount;
    }
  }
}

// ─── Shared ─────────────────────────────────────────────────

function progressBar(fraction) {
  const pct = Math.round(fraction * 100);
  return `
    <div class="progress-bar">
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <span class="progress-label">${pct}%</span>
    </div>`;
}

// ─── Init ───────────────────────────────────────────────────

el = document.getElementById("app");
window.addEventListener("hashchange", route);

// Global slider fill delegation — covers all range inputs everywhere
document.addEventListener("input", (e) => {
  if (e.target.matches('input[type="range"]')) updateSliderFill(e.target);
});

pid();
route();
