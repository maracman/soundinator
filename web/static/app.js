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
  Scale,
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
  midiMapDegree,
  CULTURAL_SCALES,
  itdSeconds,
  headShadowDb,
  headShadowFreq,
  pinnaParams,
  spaceProximityDb,
  spaceDistanceGain,
  spaceArrivalDelay,
  EAR_MODELS,
  earlyReflectionPattern,
} from "./synth.js";
import { FACTORY_PRESETS } from "./factory-presets.js";

// ─── Constants ──────────────────────────────────────────────

const STORAGE_KEY = "phase0.presets.v3";
const PARTICIPANT_KEY = "phase0.pid.v2";
const ENGAGE_KEY = "phase0.engagement.v3";
// Bump APP_VERSION whenever generation semantics change: it is folded into
// every stimulus_id, so identical parameters across app versions do not
// collide in analysis.
const APP_VERSION = "sound-studio-0.11.0"; // measured KEMAR HRIR convolution ear model (route 2) alongside the parametric fit
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
  "degreeTuning",
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
  if (key === "pinnaScale" || key === "earModel") return "space";
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
  // Owner 07-07: reverb/space keys are no longer session context — each
  // patch owns its space (SPACE inspector) and the GLOBAL space overrides
  // it only when activated. Instruments saved before this change simply
  // lack the keys and inherit the arrangement context defaults as before.
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
  degreeTuning: null, // per-degree cent offsets from the EDO grid (world tunings / hand-tuned)
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
  spaceOwnHead: false, // owner 07-07: keep THIS patch's head even when the global space is on
  earModel: "average",  // owner 07-07 round 3: which EAR_MODELS preset the head params came from
  pinnaScale: 1,        // Shaw pinna cue scale (ear models; 0 = bare sphere)
  reverbSize: null,     // room designer — null = the picked room's own character
  reverbDamping: null,
  reverbDiffusion: null,
  layers: null,           // Q7: extra subnote modules [{id, hue, subnote, space, gain, independentHead}]
  layerEnvOverride: false, // Q7: true = ONE variation trigger shared by base + all layers (own means kept)
  layerEnvProb: 0.5,       // Q7: the shared variation chance when layerEnvOverride is on
  layerEnvAttackSd: 0.015,  // shared variation SDs — one magnitude per envelope
  layerEnvDecaySd: 0.04,    // parameter for the base and every layer while
  layerEnvSustainSd: 0.08,  // synchronisation is on (owner 07-07)
  layerEnvReleaseSd: 0.05,
  midiMapKeys: "white",       // Q10: which keys play — "white" | "all"
  midiMapCoverage: "packed",  // Q10: "all" divisions | "muted" out-of-scale | "packed" in-scale only
  midiMapAnchor: "octave",    // Q10: degree 0 repeats at each C ("octave") or right after the last degree ("consecutive")
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
  spectralMix: "How strongly the harmonic tone print is mixed into the tone",
  spectralPartials: "Number of harmonic partials in the tone print",
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
  earDistance: "Your ear-to-ear span (0.12–0.25 m). Wider ears = bigger interaural time differences AND head shadowing from lower frequencies (the shadow corner is c/2πa)",
  earModel: "A listener preset on the published physics — head width (Woodworth/Brown-Duda geometry) and outer-ear strength (Shaw pinna). Pick one, then fine-tune with the knobs",
  pinnaScale: "How strong the outer-ear (pinna) cue is: 0 = bare sphere (behind sounds like front), 1 = Shaw's measured average, 2 = exaggerated front/behind difference",
  reverbSize: "Room size: how far the walls are. Bigger rooms answer later (first bounce up to ~34 ms) and ring longer for the same decay",
  reverbDamping: "Surface absorption: soft rooms eat the highs as the tail rings, hard tiled rooms stay bright to the end",
  reverbDiffusion: "How scattered the walls are: low = sparse distinct echoes (cave, canyon), high = a smooth dense wash (plate)",
  headDensity: "How strongly your head shadows the far ear (0–1). 0.5 = the published spherical-head model (Brown & Duda 1998: lows diffract around, highs shadow up to -20 dB); 0 = transparent, 1 = doubled",
  spaceOwnHead: "Keep this patch's own ear span and head density even when the producer's global space is active (normally the global listener overrides them)",
  degreeTuning: "Each degree's true pitch centre, in cents off the equal grid — how just intonation, maqamat and other tuning traditions place their notes. Drag a node around the scale circle to set it by hand",
  layers: "Extra sound modules stacked on this instrument — each renders the same notes through its own tone, position and level",
  layerEnvOverride: "Sync the envelope variation across layers: one trigger per note fires the variation on the base sound and every layer AT ONCE, at the shared magnitudes — each keeps its own envelope means",
  layerEnvProb: "How often the shared variation trigger fires (per note) when synchronisation is on",
  layerEnvAttackSd: "The shared attack variation magnitude — applied to the base and every layer while synchronised",
  layerEnvDecaySd: "The shared decay variation magnitude — applied to the base and every layer while synchronised",
  layerEnvSustainSd: "The shared sustain variation magnitude — applied to the base and every layer while synchronised",
  layerEnvReleaseSd: "The shared release variation magnitude — applied to the base and every layer while synchronised",
  midiMapKeys: "Which keys of a MIDI keyboard play this patch: only the white keys, or every key",
  midiMapCoverage: "What the keys cover: every scale subdivision, every subdivision with out-of-scale keys silent, or only in-scale degrees packed onto consecutive keys",
  midiMapAnchor: "Where the mapping repeats: degree 0 sits at C and restarts at every C, or the scale restarts on the very next key after its last degree",
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
  vis: "",
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
  cvHarmonicSignature: "Tone print display. Orange is mean, blue is SD, grey/green show low/high register response.",
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
  "Harmonic Decomposition": "Inspect every harmonic partial and the combined waveform produced by the current tone print. Disabled while Formant mode is selected.",
  "Instrument Fourier Print": "Choose and shape the instrument-like harmonic tone print used by Fourier mode.",
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
  explore: "The behaviour half: melody, rhythm, dynamics, sequence & surprise — how the instrument plays.",
  subnote: "The instrument designer: excitor, resonator, body and space — what one note sounds like.",
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
let visMode = "lanes";
// Owner 07-08: the spectrum is an OVERLAY toggle (faint, behind the active
// view), not a mode — switching to it hid the behaviour information. The
// motif view retired: the lanes' motif-memory lane carries that story.
let _visSpecOverlay = false;
const VIS_MODE_LABEL = {
  lanes: "Behaviour Timeline",
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
// Q12: adjustable studio panels (persisted like the producer's dawLayout)
const STUDIO_PANELS_KEY = "phase0.studioPanels.v1";
let _studioPanels = (() => {
  // chW default 320 (owner 07-07: the left panel should be wider — the
  // envelope now sits beside the excitor knobs and needs the room)
  try { return { chW: 320, dashC1: 260, ...(JSON.parse(localStorage.getItem(STUDIO_PANELS_KEY) || "{}")) }; }
  catch { return { chW: 320, dashC1: 260 }; }
})();
function saveStudioPanels() { localStorage.setItem(STUDIO_PANELS_KEY, JSON.stringify(_studioPanels)); }
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
let _rollAddMode = false;  // Q9 D2: pencil mode — click an empty cell adds a note
let selectedRegions = new Set(); // Q9 B2: multi-selected region ids (⇧click / rubber band)
let _spTrackPopover = null; // Q9 C: trackId whose space mini-controls are open
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
  // Q9 C: a track's own space (mini-pad in the track head) overrides the
  // voice; the Q6 global space below supersedes it when enabled.
  if (track?.space) {
    if (Number.isFinite(track.space.angle)) params.spaceAzimuth = track.space.angle;
    if (Number.isFinite(track.space.dist)) params.spaceDistance = track.space.dist;
  }
  // Q6 global space: designer threads position each track over time —
  // resolved at atBeat (the walker passes the playing beat so positions
  // evolve mid-region). Override replaces the patch's space; offset adds
  // the anchors as deltas (angle adds, distance shifts around 2.5 m).
  // The designer's head (listener) properties apply to every track.
  const sp = arrangement?.space;
  if (sp?.enabled && track) {
    // anchors interpolate over time; an unanchored track that was dragged
    // freely sits at its static designer position
    const pos = trackSpaceAt(sp.tracks?.[track.id], atBeat ?? region.startBeat ?? 0)
      || sp.static?.[track.id] || null;
    const patchLayers = Array.isArray(params.layers) && params.layers.length ? params.layers : null;
    if (pos && patchLayers) {
      // Multi-layer patch: the designer value is a GROUP HANDLE — the whole
      // constellation (base + layers) moves together, centered (rotate +
      // distance ratio) or additive (rigid translation). Same math as the
      // canvases (spTransformSources), so what you see is what you hear.
      const sources = [
        { angle: params.spaceAzimuth ?? 0, dist: params.spaceDistance ?? 2.5 },
        ...patchLayers.map(l => ({ angle: l.space?.angle ?? 0, dist: l.space?.dist ?? 2.5 })),
      ];
      const out = spTransformSources(sources, pos, sp.layerMode === "additive" ? "additive" : "centered");
      params.spaceAzimuth = out[0].angle;
      params.spaceDistance = Math.max(0.3, out[0].dist);
      params.layers = patchLayers.map((l, i) => ({
        ...l,
        space: { angle: out[i + 1].angle, dist: Math.max(0.3, out[i + 1].dist) },
      }));
    } else if (pos) {
      if (sp.mode === "offset") {
        params.spaceAzimuth = Math.max(-180, Math.min(180, (params.spaceAzimuth ?? 0) + pos.angle));
        params.spaceDistance = Math.max(0.3, Math.min(30, (params.spaceDistance ?? 2.5) + (pos.dist - 2.5)));
      } else {
        params.spaceAzimuth = pos.angle;
        params.spaceDistance = pos.dist;
      }
    }
    if (sp.head && !params.spaceOwnHead) {
      // the global listener overrides the patch head — unless the patch's
      // SPACE section opted out (owner 07-07)
      if (Number.isFinite(sp.head.earDistance)) params.earDistance = sp.head.earDistance;
      if (Number.isFinite(sp.head.headDensity)) params.headDensity = sp.head.headDensity;
      if (Number.isFinite(sp.head.pinnaScale)) params.pinnaScale = sp.head.pinnaScale;
      if (sp.head.earModel) params.earModel = sp.head.earModel;
      if (sp.head.reverbType) {
        params.reverbType = sp.head.reverbType;
        // the shared room's design rides with its type: unset designer
        // values fall back to THAT room's character, not the patch's
        params.reverbSize = sp.head.reverbSize ?? null;
        params.reverbDamping = sp.head.reverbDamping ?? null;
        params.reverbDiffusion = sp.head.reverbDiffusion ?? null;
      }
      if (Number.isFinite(sp.head.reverbWet)) params.reverbWet = sp.head.reverbWet;
      if (Number.isFinite(sp.head.reverbDecay)) params.reverbDecay = sp.head.reverbDecay;
    }
  }
  return params;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function sessionBarControlsHTML() {
  // Owner cleanup 07-07: the scale select is gone (the global scale strip
  // is the producer's scale surface) and the Space control moved into the
  // global-space listener panel where it only applies when that's on.
  const ctx = arrangement.context;
  const root = ctx.keyRoot ?? (Array.isArray(ctx.rootNotes) && ctx.rootNotes.length ? ctx.rootNotes[0] : 0);
  return `
    <label class="daw-ctx">Tempo
      <input type="range" data-ctx="tempo" min="50" max="180" step="1" value="${ctx.tempo}"/>
      <output id="ctxTempoOut">${ctx.tempo}</output>
    </label>
    <label class="daw-ctx" title="Root pitch: the whole lattice transposes so degree 0 lands on this pitch class">Key (root pitch)
      <select data-ctx="root">
        ${NOTE_NAMES.map((n, i) => `<option value="${i}"${i === root ? " selected" : ""}>${n}</option>`).join("")}
      </select>
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
  // Owner 07-07: compact rows, many patches visible at once. Name +
  // kind chip + two small actions per line; the description rides the
  // hover title; drag anywhere on the row to place it.
  container.innerHTML = items.length ? items.map(item => `
    <div class="browser-row" data-browser-item="${esc(item.id)}" title="${esc(item.description || item.name)} — drag onto a track, or ＋ to add to the palette">
      <span class="br-name">${esc(item.name)}</span>
      <span class="br-kind">${esc(item.kindLabel)}</span>
      <button class="br-btn${browserPreviewId === item.id ? " on" : ""}" data-browser-preview="${esc(item.id)}" title="Hear it in the session context">${browserPreviewId === item.id ? "■" : "▶"}</button>
      <button class="br-btn br-add" data-browser-add="${esc(item.id)}" title="Add to your palette — the instrument rack for this arrangement">＋ Add</button>
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
      if (e.target.closest(".br-btn, .pal-btn")) return; // buttons stay clickable
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
        <label title="Root pitch: the whole lattice transposes so degree 0 lands on this pitch class">Key (root pitch)
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
window._prodVoicesQA = producerVoices; // QA hook (matches _synthQA): assert ring-out in tests
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

function stopArrangement(ringOut = false) {
  if (arrPlay) { clearTimeout(arrPlay.timer); arrPlay = null; }
  // ringOut (natural end of the arrangement): stop triggering but let the
  // last notes' releases and the reverb tail play out. Explicit stops cut.
  producerVoices.forEach(v => ringOut ? v.finish() : v.stop());
  updatePlayhead(playheadBeat);
}

// The beat under the playhead RIGHT NOW — fractional during playback
// (interpolated between beat steps) so the space visualisers move smoothly
// instead of jumping once per beat.
function curPlayBeat() {
  if (!arrPlay) return playheadBeat;
  const base = arrPlay.playingBeat ?? arrPlay.beat;
  if (arrPlay.stepAt == null) return base;
  return base + Math.min(1, (performance.now() - arrPlay.stepAt) / (arrPlay.beatMs || 1));
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
      stopArrangement(true); // natural end: the last notes ring out
      const btn = document.querySelector("#arrPlayBtn");
      if (btn) btn.textContent = "▶";
      return;
    }
    // smooth-beat bookkeeping for the space visualisers (curPlayBeat)
    arrPlay.playingBeat = b;
    arrPlay.stepAt = performance.now();
    arrPlay.beatMs = beatMs;
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
      } else if (region && region.muted) {
        voice.stop(); // an explicit mute silences immediately
      } else if (!region) {
        // Region end is NOT a mute (owner 07-07): stop triggering new
        // events and let what's already in the air play out — envelope
        // releases, material ring, reverb tail.
        voice.finish();
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

// The scale in force at a beat: latest marker at/before it, else the
// session context's own scale.
function _gsDivCount() {
  return arrangement.context.scaleMode === "edo" ? (arrangement.context.edoDivisions || 12) : 12;
}
function _gsScaleAt(beat) {
  const m = globalScaleAt({ ...(arrangement.globalScale || {}), enabled: true }, beat);
  if (m) return m;
  const ctx = arrangement.context;
  return {
    degrees: ctx.customDegrees || SCALE_PRESETS[ctx.scalePreset]?.degrees || SCALE_PRESETS.major.degrees,
    subScaleNotes: ctx.subScaleNotes || [],
    rootNotes: ctx.rootNotes || [0],
  };
}

// Owner rework 07-07: the strip IS a tiny piano roll — every division is a
// row, coloured by its role under the scale in force at that beat, with a
// vertical line at every change point. Double-click at a bar line adds a
// change point; clicking a line opens the cell editor; clicking anywhere
// else closes it, leaving the line + the highlight difference visible.
const GS_STRIP_H = 42;
function drawGsStrip() {
  const cv = document.getElementById("gsCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const gs = arrangement.globalScale || { markers: [] };
  const div = _gsDivCount();
  const rowH = h / div;
  const beats = totalBeats();
  // segments between change points
  const cuts = [0, ...(gs.markers || []).map(m => m.atBeat).filter(b => b > 0), beats]
    .sort((a, b) => a - b);
  for (let s = 0; s < cuts.length - 1; s++) {
    const b0 = cuts[s], b1 = cuts[s + 1];
    if (b1 <= b0) continue;
    const sc = _gsScaleAt(b0 + 1e-4);
    const x = b0 * pxPerBeat, ww = (b1 - b0) * pxPerBeat;
    for (let d = 0; d < div; d++) {
      const role = sc.rootNotes?.includes(d) ? "root"
        : sc.subScaleNotes?.includes(d) ? "sub"
        : sc.degrees?.includes(d) ? "scale" : "off";
      ctx.fillStyle = role === "root" ? "rgba(139,124,246,0.5)"
        : role === "sub" ? "rgba(245,166,35,0.42)"
        : role === "scale" ? "rgba(148,196,255,0.3)"
        : "rgba(0,0,0,0.35)";
      const y = h - (d + 1) * rowH;
      ctx.fillRect(x, y, ww, Math.max(1, rowH - 0.5));
    }
  }
  // bar ticks (double-click targets)
  ctx.strokeStyle = "rgba(154,160,171,0.12)";
  for (let b = 0; b <= beats; b += BEATS_PER_BAR) {
    const x = b * pxPerBeat;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  // change-point lines
  (gs.markers || []).forEach((m, i) => {
    const x = m.atBeat * pxPerBeat;
    ctx.strokeStyle = i === _gsSelMarker ? "#ffd28a" : "rgba(245,166,35,0.8)";
    ctx.lineWidth = i === _gsSelMarker ? 2 : 1.2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.lineWidth = 1;
  });
}

function globalScaleStripHTML(laneW) {
  const gs = arrangement.globalScale || { enabled: false, markers: [] };
  const sel = gs.markers?.[_gsSelMarker];
  const div = _gsDivCount();
  const editorRow = (_gsOpen && sel) ? `
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="gs-editor">
          <span class="gs-editor-title">change point @ beat ${sel.atBeat}</span>
          <div class="gs-roll" role="group" title="Click a note division to cycle its role: off → in scale → sub-scale → root (same operators as the patch scale card). Click anywhere off this editor to close it.">
            ${Array.from({ length: div }, (_, d) => {
              const st = sel.rootNotes?.includes(d) ? "root" : sel.subScaleNotes?.includes(d) ? "sub" : sel.degrees?.includes(d) ? "scale" : "off";
              return `<button class="gs-cell gs-${st}" data-gs-cell="${d}" title="division ${d}: ${st}">${d}</button>`;
            }).join("")}
          </div>
          <button class="pal-btn" id="gsDeleteMarker" title="Remove this change point">×</button>
        </div>
      </div>` : "";
  return `
      <div class="tl2-row tl2-gs-row${_gsOpen ? " open" : ""}">
        <div class="tl2-head tl2-corner gs-head">
          <button class="gs-chevron" id="gsToggle" title="Global scale — a tiny piano roll of the scale over time; double-click at a bar line to add a change point; tracks opt in with the G button in their header">${_gsOpen ? "▾" : "▸"} Global scale</button>
          ${_gsOpen ? `<input type="checkbox" id="gsEnabled"${gs.enabled ? " checked" : ""} title="Apply the global scale to opted-in tracks"/>` : ""}
        </div>
        ${_gsOpen ? `<div class="gs-strip${gs.enabled ? "" : " off"} open" id="gsStrip" style="width:${laneW}px"><canvas id="gsCanvas" width="${laneW}" height="${GS_STRIP_H}" style="width:${laneW}px;height:${GS_STRIP_H}px" title="The scale over time — rows are note divisions, colours are roles (lit = in scale, gold = sub-scale, violet = root). Double-click at a bar line to add a change point; click a change-point line to edit it."></canvas></div>` : ""}
      </div>${editorRow}`;
}

// ── Q6: global space designer ───────────────────────────────
// A cylinder of instrument threads along the timeline + a cross-section
// at the playhead. Threads come from per-track anchors interpolated by
// trackSpaceAt (synth.js); the head panel owns the listener (ear span,
// head density, room type — re-homed here from Q2).
let _spOpen = false;
let _spRoomOpen = false; // owner 07-07 round 3: the room-designer drawer
let _spSelTrack = null;
let _spRock = { roll: 0, dragging: false, drag: null };
let _spRaf = null;
// Sound-glow mapping: which beat sat under the playhead at which ctx time.
// Frozen when playback ends so ring-out glows keep fading IN PLACE.
let _spGlowMap = null;

// A voice's real output level right now (0..~1) from its analyser tap —
// measured post-reverb, so tails read truthfully in the visualiser.
function _voiceRms(voice) {
  const d = voice?.getWaveform?.();
  if (!d) return 0;
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const x = (d[i] - 128) / 128; s += x * x; n++; }
  return n ? Math.sqrt(s / n) : 0;
}

function ensureGlobalSpace() {
  if (!arrangement.space) {
    arrangement.space = {
      enabled: false,
      mode: "override",
      layerMode: "centered", // multi-layer handle behaviour: centered | additive
      head: { earDistance: 0.175, headDensity: 0.5, reverbType: arrangement.context.reverbType || "room" },
      tracks: {},
    };
  }
  if (!arrangement.space.tracks) arrangement.space.tracks = {};
  if (!arrangement.space.layerMode) arrangement.space.layerMode = "centered";
  return arrangement.space;
}

// ── Multi-layer patches in the global space (owner 2026-07-08) ──
// A patch whose sound has layers is a CONSTELLATION of sources (base +
// layers), each with its own patch-space position. In the global space the
// track's designer value acts as one GROUP HANDLE for the whole
// constellation, in one of two modes:
//   centered — the handle sits at the constellation's centre (ring at the
//     average distance, notch at the average angle). Dragging it rotates
//     every source together and scales every distance by the RATIO
//     handle/centroid, so distances can never go negative.
//   additive — the handle is a translation from the listener's centre
//     (drawn slightly in front of the head so it can be grabbed); every
//     source shifts by the same vector.

function _spTrackVoiceParams(track) {
  return (arrangement.palette || []).find(pl => pl.id === track.regions?.[0]?.paletteId)?.params
    || track.instrumentParams || {};
}

// The patch's own constellation: base source first, then its layers.
function _spTrackSources(vp) {
  const sources = [{ angle: vp.spaceAzimuth ?? 0, dist: vp.spaceDistance ?? 2.5 }];
  for (const l of Array.isArray(vp.layers) ? vp.layers : []) {
    sources.push({ angle: l.space?.angle ?? 0, dist: l.space?.dist ?? 2.5 });
  }
  return sources;
}

function _spIsMulti(vp) { return Array.isArray(vp.layers) && vp.layers.length > 0; }

// Circular-mean angle + mean distance of a constellation.
function _spCentroid(sources) {
  let sx = 0, sy = 0, sd = 0;
  for (const s of sources) {
    const a = (s.angle ?? 0) * Math.PI / 180;
    sx += Math.sin(a);
    sy += Math.cos(a);
    sd += s.dist ?? 2.5;
  }
  const angle = (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) ? Math.atan2(sx, sy) * 180 / Math.PI : 0;
  return { angle, dist: sd / Math.max(1, sources.length) };
}

// Apply the group handle to a constellation. Pure — shared by playback
// (regionPlayParams) and both canvases, so what you see is what you hear.
function spTransformSources(sources, handle, mode) {
  if (mode === "additive") {
    const ha = (handle.angle ?? 0) * Math.PI / 180;
    const hd = Math.max(0, handle.dist ?? 0);
    const tx = Math.sin(ha) * hd, tz = Math.cos(ha) * hd;
    return sources.map(s => {
      const a = (s.angle ?? 0) * Math.PI / 180;
      const d = s.dist ?? 2.5;
      const x = Math.sin(a) * d + tx, z = Math.cos(a) * d + tz;
      return { angle: Math.atan2(x, z) * 180 / Math.PI, dist: Math.min(30, Math.hypot(x, z)) };
    });
  }
  const cen = _spCentroid(sources);
  const dA = (handle.angle ?? cen.angle) - cen.angle;
  const k = Math.max(0.02, handle.dist ?? cen.dist) / Math.max(0.05, cen.dist);
  return sources.map(s => {
    let a = (s.angle ?? 0) + dA;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    return { angle: a, dist: Math.max(0.05, Math.min(30, (s.dist ?? 2.5) * k)) };
  });
}
if (typeof window !== "undefined") window.spTransformSources = spTransformSources;  // debug/validation hook

const _SP_HUES = [36, 152, 205, 280, 0, 60, 320, 100];
function _spHue(i) { return _SP_HUES[i % _SP_HUES.length]; }

// Where a track's HANDLE sits at a beat: designer anchors (interpolated),
// else the static position a free drag left it at, else the patch space.
// Offset mode adds the designer value onto the patch position. For a
// multi-layer patch the handle is the group control: at rest it sits at
// the constellation centroid (centered) or the listener centre (additive).
function _spTrackPos(track, beat) {
  const sp = arrangement.space || {};
  const res = trackSpaceAt(sp.tracks?.[track.id], beat) || sp.static?.[track.id] || null;
  const vp = _spTrackVoiceParams(track);
  if (_spIsMulti(vp)) {
    if (res) return res;
    return sp.layerMode === "additive"
      ? { angle: 0, dist: 0 }
      : _spCentroid(_spTrackSources(vp));
  }
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

// The transformed constellation a multi-layer track is ACTUALLY playing
// from at this beat (null for single-source tracks).
function _spTrackConstellation(track, beat, dragPos = null) {
  const vp = _spTrackVoiceParams(track);
  if (!_spIsMulti(vp)) return null;
  const sp = arrangement.space || {};
  const handle = dragPos || _spTrackPos(track, beat);
  const mode = sp.layerMode === "additive" ? "additive" : "centered";
  return spTransformSources(_spTrackSources(vp), handle, mode);
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
  const roomKey = REVERB_PROFILES[head.reverbType || arrangement.context?.reverbType]
    ? (head.reverbType || arrangement.context?.reverbType) : "room";
  const roomLabel = (REVERB_PROFILES[roomKey] || REVERB_PROFILES.room).label;
  const spaceH = 105;
  // Owner 07-07, compacted 07-09: the cross-section sits on the LEFT at the
  // same height as the beat-aligned cylinder. Settings live in the drawer below
  // so the timeline gets the vertical space back.
  const panel = _spOpen ? `
      <div class="tl2-row sp-panel-row">
        <div class="tl2-head sp-left">
          <canvas id="spSection" width="132" height="${spaceH}" title="Cross-section at the playhead — you at the centre, one dot per track. Click a dot to select its track; drag to move it. A multi-layer patch shows its instruments as faint dots and one brighter HANDLE: in Centered mode the handle rides a ring at their average distance (drag to rotate them together or scale their distances); in Additive mode it sits just in front of your head and shifts them all by the same amount. Unanchored tracks stay where you put them; anchored tracks snap back unless an anchor sits at the playhead. Double-click a dot to anchor it here."></canvas>
          <button class="sp-settings-toggle" id="spRoomToggle" title="Open global-space settings">${_spRoomOpen ? "▾" : "⚙"} ${esc(roomLabel)}</button>
        </div>
        <div class="sp-cyl-wrap" style="width:${laneW}px;height:${spaceH}px">
          <canvas id="spCylinder" width="${laneW}" height="${spaceH}" style="width:${laneW}px;height:${spaceH}px" title="The arrangement's space over time, beat-aligned with the timeline below — one thread per instrument (nearer = thicker; the bright spans are that track's regions; the translucent core is your head). Drag up/down to roll the view; click an anchor dot to jump the playhead."></canvas>
        </div>
      </div>${_spRoomOpen ? spRoomDesignerHTML(head, sp, anchorAtPh) : ""}` : "";
  return `
      <div class="tl2-row tl2-sp-row">
        <div class="tl2-head tl2-corner gs-head">
          <button class="gs-chevron" id="spToggle" title="Global space — position every instrument around the listener along the timeline">${_spOpen ? "▾" : "▸"} Global space</button>
          ${_spOpen ? `<input type="checkbox" id="spEnabled"${sp.enabled ? " checked" : ""} title="Apply the global space to playback (asks how to initialise on first use)"/>` : ""}
        </div>
      </div>${panel}`;
}

// The producer's room designer (owner 07-07 round 3): the same editor as
// the sub-note SPACE stage, writing to the arrangement's shared listener
// (space.head) instead of the patch.
function spRoomDesignerHTML(head, sp, anchorAtPh) {
  const ctxP = arrangement.context || {};
  const roomKey = REVERB_PROFILES[head.reverbType || ctxP.reverbType] ? (head.reverbType || ctxP.reverbType) : "room";
  const prof = REVERB_PROFILES[roomKey];
  const earSel = _earModelOf({
    earDistance: head.earDistance ?? 0.175,
    headDensity: head.headDensity ?? 0.5,
    pinnaScale: head.pinnaScale ?? 1,
  });
  return `
      <div class="sp-designer">
        <div class="sp-room-current" title="${esc(prof.blurb)}">
          <canvas data-room-art="${roomKey}" width="44" height="30"></canvas>
          <span>${esc(prof.label)}</span>
        </div>
        <div class="sp-designer-ctls">
          <label class="sp-ctl">Mode
            <select id="spMode" title="Override replaces each patch's own space; Offset adds the threads on top of it">
              <option value="override"${sp.mode !== "offset" ? " selected" : ""}>Override</option>
              <option value="offset"${sp.mode === "offset" ? " selected" : ""}>Offset</option>
            </select>
          </label>
          <label class="sp-ctl">Layers
            <select id="spLayerMode" title="How a multi-layer patch's handle moves its instruments: Centered — the notch rides a ring at their average distance; dragging rotates them together and scales every distance by the same ratio (never negative). Additive — the handle is the patch's centre point (shown just in front of your head); dragging shifts every instrument by the same amount.">
              <option value="centered"${sp.layerMode !== "additive" ? " selected" : ""}>Centered</option>
              <option value="additive"${sp.layerMode === "additive" ? " selected" : ""}>Additive</option>
            </select>
          </label>
          <label class="sp-ctl" title="The shared room every track sits in">Room
            <select id="spRoomType">
              ${Object.entries(REVERB_PROFILES).map(([k, r]) =>
                `<option value="${k}"${k === roomKey ? " selected" : ""} title="${esc(r.blurb)}">${esc(r.label)}</option>`).join("")}
            </select>
          </label>
          <label class="sp-ctl">Amount <input type="range" id="spWet" min="0" max="0.95" step="0.01" value="${head.reverbWet ?? ctxP.reverbWet ?? 0.16}" title="How much of the shared room you hear (only applies while the global space is on)"/></label>
          <label class="sp-ctl">Ear span <input type="range" id="spEar" min="0.12" max="0.25" step="0.005" value="${head.earDistance ?? 0.175}" title="${esc(PARAM_DESC.earDistance)}"/></label>
          <label class="sp-ctl">Density <input type="range" id="spDensity" min="0" max="1" step="0.01" value="${head.headDensity ?? 0.5}" title="${esc(PARAM_DESC.headDensity)}"/></label>
          <label class="sp-ctl" title="${esc(PARAM_DESC.earModel)}">Ears
            <select id="spEarModel">
              ${Object.entries(EAR_MODELS).map(([k, m]) =>
                `<option value="${k}"${earSel === k ? " selected" : ""} title="${esc(m.blurb)}">${esc(m.label)}</option>`).join("")}
              ${earSel === "custom" ? `<option value="custom" selected>Custom</option>` : ""}
            </select>
          </label>
          <label class="sp-ctl" title="How long the shared room rings">Decay <input type="range" id="spDecay" min="0.2" max="8" step="0.1" value="${head.reverbDecay ?? ctxP.reverbDecay ?? 1.4}"/></label>
          <label class="sp-ctl" title="${esc(PARAM_DESC.reverbSize)}">Size <input type="range" id="spSize" min="0" max="1" step="0.01" value="${head.reverbSize ?? prof.size}"/></label>
          <label class="sp-ctl" title="${esc(PARAM_DESC.reverbDamping)}">Damping <input type="range" id="spDamp" min="0" max="1" step="0.01" value="${head.reverbDamping ?? prof.damping}"/></label>
          <label class="sp-ctl" title="${esc(PARAM_DESC.reverbDiffusion)}">Diffusion <input type="range" id="spDiff" min="0" max="1" step="0.01" value="${head.reverbDiffusion ?? prof.diffusion}"/></label>
          ${anchorAtPh ? `<label class="sp-ctl">Smooth <input type="range" id="spSmooth" min="0" max="1" step="0.05" value="${anchorAtPh.smooth ?? 0.5}" title="How gently the selected track's thread curves through the anchor at the playhead (0 = straight lines)"/></label>` : ""}
          <span class="sp-ctl sp-room-blurb">${esc(prof.blurb)}</span>
        </div>
      </div>`;
}

function drawSpSection() {
  const cv = document.getElementById("spSection");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
  // the head, radius ∝ ear distance — with ears and a front-pointing nose
  const headR = 4 + ((sp.head?.earDistance ?? 0.175) - 0.12) / (0.25 - 0.12) * 5;
  ctx.fillStyle = "rgba(200,215,230,0.85)";
  ctx.beginPath(); ctx.arc(cx, cy, headR, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - headR, cy, 1.8, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + headR, cy, 1.8, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - headR + 0.5); ctx.lineTo(cx, cy - headR - 3); ctx.lineTo(cx + 2, cy - headR + 0.5);
  ctx.closePath(); ctx.fill();
  // track dots at the playhead — live during playback (curPlayBeat), and
  // pulsing with each voice's real output level. Multi-layer tracks show
  // their sources as fainter dots plus one GROUP HANDLE (ring + notch in
  // centered mode; a head-centre handle drawn just in front in additive).
  const phBeat = curPlayBeat();
  const xyOf = (p) => {
    const rad = ((p.angle ?? 0) - 90) * Math.PI / 180;
    const r = _spaceDistToR(Math.max(0.3, Math.min(30, p.dist ?? 2.5)), rMax);
    return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
  };
  arrangement.tracks.forEach((t, i) => {
    const drag = _spRock.drag;
    const dragPos = (drag && drag.trackId === t.id) ? drag.pos : null;
    const pos = dragPos || _spTrackPos(t, phBeat);
    const seld = t.id === _spSelTrack;
    const hue = _spHue(i);
    const rms = _voiceRms(producerVoices.get(t.id));
    const constellation = _spTrackConstellation(t, phBeat, dragPos);
    const glowAt = (x, y, strength) => {
      if (rms <= 0.012) return;
      const level = Math.min(1, rms * 2.6) * strength;
      const rGlow = 6 + 12 * level;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rGlow);
      g.addColorStop(0, `hsla(${hue}, 85%, 65%, ${0.4 * level})`);
      g.addColorStop(1, `hsla(${hue}, 85%, 65%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rGlow, 0, 2 * Math.PI); ctx.fill();
    };
    if (constellation) {
      // fainter, smaller dots = the instruments the handle represents —
      // the sound comes from THESE, so the level glow rides them
      for (const s of constellation) {
        const p = xyOf(s);
        glowAt(p.x, p.y, 0.85);
        ctx.fillStyle = `hsla(${hue}, 70%, 62%, ${seld ? 0.55 : 0.4})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, 2 * Math.PI); ctx.fill();
      }
      const additive = (arrangement.space?.layerMode === "additive");
      if (seld && !additive) {
        // the ring the notch rides: the handle's distance around you
        ctx.strokeStyle = `hsla(${hue}, 70%, 60%, 0.5)`;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, _spaceDistToR(Math.max(0.3, Math.min(30, pos.dist ?? 2.5)), rMax), 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const hp = _spHandleXY(pos, cx, cy, rMax, true);
      ctx.fillStyle = `hsla(${hue}, 78%, ${seld ? 70 : 58}%, 1)`;
      if (seld) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.arc(hp.x, hp.y, seld ? 5.5 : 4.5, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0;
      // notch core: reads as a handle, not another instrument
      ctx.fillStyle = "rgba(10,14,20,0.9)";
      ctx.beginPath(); ctx.arc(hp.x, hp.y, 1.8, 0, 2 * Math.PI); ctx.fill();
    } else {
      const { x, y } = xyOf(pos);
      glowAt(x, y, 1);
      ctx.fillStyle = `hsla(${hue}, 70%, ${seld ? 68 : 55}%, ${seld ? 1 : 0.8})`;
      if (seld) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; }
      ctx.beginPath(); ctx.arc(x, y, seld ? 5.5 : 4, 0, 2 * Math.PI); ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
}

// Where a track's handle is DRAWN: normally its polar position; an additive
// multi-layer handle at rest is the head centre, shown slightly in front of
// the head so it can be seen and grabbed. Shared by drawing and hit-tests.
function _spHandleXY(pos, cx, cy, rMax, multi) {
  const sp = arrangement.space || {};
  if (multi && sp.layerMode === "additive" && (pos.dist ?? 0) < 0.35) {
    return { x: cx, y: cy - 16 };
  }
  const rad = ((pos.angle ?? 0) - 90) * Math.PI / 180;
  const r = _spaceDistToR(Math.max(0.3, Math.min(30, pos.dist ?? 2.5)), rMax);
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r };
}

function drawSpCylinder(rockRad) {
  const cv = document.getElementById("spCylinder");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  const cy = h / 2, R = h / 2 - 10;
  const beats = Math.max(1, totalBeats());
  // beat-aligned with the timeline: 1 beat = pxPerBeat, same as the lanes
  const xFor = (beat) => beat * pxPerBeat;
  const roll = _spRock.roll;
  // translucent core = the listener's head running down the cylinder
  const sp = arrangement.space || {};
  const headR = 6 + ((sp.head?.earDistance ?? 0.175) - 0.12) / (0.25 - 0.12) * 8;
  ctx.fillStyle = "rgba(200,215,230,0.07)";
  ctx.fillRect(0, cy - headR, w, headR * 2);
  ctx.strokeStyle = "rgba(200,215,230,0.14)";
  ctx.beginPath(); ctx.moveTo(0, cy - headR); ctx.lineTo(w, cy - headR); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cy + headR); ctx.lineTo(w, cy + headR); ctx.stroke();
  // playhead line — live during playback
  const phBeat = curPlayBeat();
  ctx.strokeStyle = "rgba(56,189,248,0.55)";
  ctx.beginPath(); ctx.moveTo(xFor(phBeat), 0); ctx.lineTo(xFor(phBeat), h); ctx.stroke();
  const yFor = (t, beat) => {
    const pos = _spTrackPos(t, beat);
    const a = pos.angle * Math.PI / 180 + rockRad + roll;
    return { y: cy + Math.sin(a) * R * 0.85, back: Math.cos(a) > 0, dist: pos.dist };
  };
  arrangement.tracks.forEach((t, i) => {
    const seld = t.id === _spSelTrack;
    const hue = t.hue ?? _spHue(i);
    // base thread: thin and dim everywhere…
    ctx.beginPath();
    let back = false;
    for (let px = 0; px <= w; px += 6) {
      const p = yFor(t, px / pxPerBeat);
      back = p.back;
      px === 0 ? ctx.moveTo(px, p.y) : ctx.lineTo(px, p.y);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(${hue}, 70%, ${seld ? 60 : 48}%, ${back ? 0.25 : 0.45})`;
    ctx.stroke();
    // …and thick and bright where the track actually has regions, so you
    // can see the arrangement in the threads (owner 07-07)
    for (const r of t.regions) {
      const x0 = xFor(r.startBeat), x1 = xFor(r.startBeat + regionLen(r));
      ctx.beginPath();
      for (let px = x0; px <= x1; px += 4) {
        const p = yFor(t, px / pxPerBeat);
        px === x0 ? ctx.moveTo(px, p.y) : ctx.lineTo(px, p.y);
      }
      const mid = yFor(t, (r.startBeat + regionLen(r) / 2));
      ctx.lineWidth = Math.max(1.6, Math.min(6, 7 / Math.max(0.8, mid.dist)));
      ctx.strokeStyle = `hsla(${hue}, 72%, ${seld ? 68 : 56}%, ${mid.back ? 0.55 : 0.92})`;
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    // multi-layer patches: ultra-thin threads for every source (base +
    // layers) around the patch's main thread — the sound lives on these
    const vp = _spTrackVoiceParams(t);
    if (_spIsMulti(vp)) {
      const sources0 = _spTrackSources(vp);
      const mode = (arrangement.space?.layerMode === "additive") ? "additive" : "centered";
      const paths = sources0.map(() => []);
      for (let px = 0; px <= w; px += 6) {
        const out = spTransformSources(sources0, _spTrackPos(t, px / pxPerBeat), mode);
        out.forEach((s, si) => {
          const a = s.angle * Math.PI / 180 + rockRad + roll;
          paths[si].push([px, cy + Math.sin(a) * R * 0.85, Math.cos(a) > 0]);
        });
      }
      for (const path of paths) {
        ctx.beginPath();
        path.forEach(([px, y], k) => k === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y));
        ctx.lineWidth = 0.6;
        const backMid = path[Math.floor(path.length / 2)]?.[2];
        ctx.strokeStyle = `hsla(${hue}, 70%, 62%, ${backMid ? 0.18 : 0.32})`;
        ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
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

  // ── Sound glow (owner 07-07): each note onset glows on its thread at
  // the beat where it HAPPENED and fades with the note's own envelope +
  // the room's decay (modelled — the past can't be measured), while a
  // "now" glow at the playhead pulses with the voice's actual analyser
  // level (measured — so the real reverb tail is what you see). The
  // beat↔time map freezes when playback ends, so ring-out fades in place.
  if (arrPlay && synth.ctx) _spGlowMap = { beat: phBeat, t: synth.ctx.currentTime };
  const map = _spGlowMap;
  if (map && synth.ctx) {
    const beatSec = 60 / Math.max(30, arrangement.context.tempo || 104);
    const nowT = synth.ctx.currentTime;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    arrangement.tracks.forEach((t, i) => {
      const voice = producerVoices.get(t.id);
      if (!voice) return;
      const hue = t.hue ?? _spHue(i);
      // The glow rides the SOURCE threads — for a multi-layer patch the
      // sound is produced on the layer threads, not the group handle.
      const glowPts = (beat) => {
        const con = _spTrackConstellation(t, beat);
        if (!con) return [yFor(t, beat)];
        return con.map(s => {
          const a = s.angle * Math.PI / 180 + rockRad + roll;
          return { y: cy + Math.sin(a) * R * 0.85, back: Math.cos(a) > 0 };
        });
      };
      // decay constant from the sounding region's actual envelope + room
      const region = regionAtBeat(t, Math.floor(Math.max(0, map.beat)));
      const rp = region ? regionPlayParams(t, region, map.beat) : {};
      const tau = Math.max(0.15, (rp.envelopeRelease ?? 0.2) + (rp.reverbDecay ?? 1.4) * 0.45);
      const events = voice.getNoteTimeline?.()?.events || [];
      for (const ev of events) {
        if (ev.isRest) continue;
        const age = nowT - ev.when;
        if (age < 0 || age > ev.dur + tau * 3) continue; // not yet sounded / fully faded
        const att = Math.min(1, age / 0.03);
        const level = (ev.velocity ?? 0.8) * att *
          (age <= ev.dur ? 1 : Math.exp(-(age - ev.dur) / tau));
        if (level < 0.02) continue;
        const evBeat = map.beat - (map.t - ev.when) / beatSec;
        const x = xFor(evBeat);
        if (evBeat < 0 || x < -20 || x > w + 20) continue;
        const pts = glowPts(evBeat);
        const shrink = pts.length > 1 ? 0.8 : 1;
        for (const p of pts) {
          const rGlow = (4 + 9 * level) * shrink;
          const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, rGlow);
          g.addColorStop(0, `hsla(${hue}, 85%, 65%, ${(p.back ? 0.22 : 0.38) * level})`);
          g.addColorStop(1, `hsla(${hue}, 85%, 65%, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, p.y, rGlow, 0, 2 * Math.PI); ctx.fill();
        }
      }
      // "now" glow: the voice's real output level at the playhead
      const rms = _voiceRms(voice);
      if (rms > 0.012) {
        const level = Math.min(1, rms * 2.6);
        const x = xFor(map.beat);
        const pts = glowPts(map.beat);
        const shrink = pts.length > 1 ? 0.8 : 1;
        for (const p of pts) {
          const rGlow = (5 + 13 * level) * shrink;
          const g = ctx.createRadialGradient(x, p.y, 0, x, p.y, rGlow);
          g.addColorStop(0, `hsla(${hue}, 90%, 70%, ${0.5 * level})`);
          g.addColorStop(1, `hsla(${hue}, 90%, 70%, 0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, p.y, rGlow, 0, 2 * Math.PI); ctx.fill();
        }
      }
    });
    ctx.restore();
  }
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
  bindHead("#spWet", "reverbWet");
  // room designer drawer (owner 07-07 round 3)
  const spRoomToggle = v.querySelector("#spRoomToggle");
  if (spRoomToggle) spRoomToggle.onclick = () => { _spRoomOpen = !_spRoomOpen; renderProduce(); };
  bindHead("#spDecay", "reverbDecay");
  bindHead("#spSize", "reverbSize");
  bindHead("#spDamp", "reverbDamping");
  bindHead("#spDiff", "reverbDiffusion");
  const spEarModel = v.querySelector("#spEarModel");
  if (spEarModel) spEarModel.onchange = () => {
    const m = EAR_MODELS[spEarModel.value];
    if (!m) return;
    const sp = ensureGlobalSpace();
    sp.head.earModel = spEarModel.value;
    sp.head.earDistance = m.earDistance;
    sp.head.headDensity = m.headDensity;
    sp.head.pinnaScale = m.pinnaScale;
    saveArrangement("global space ears");
    liveApply();
    renderProduce(); // the ear-span/density sliders show the new values
  };
  const chooseRoom = (k) => {
    if (!REVERB_PROFILES[k]) return;
    const sp = ensureGlobalSpace();
    sp.head.reverbType = k;
    // a fresh pick adopts the room's own character
    delete sp.head.reverbSize;
    delete sp.head.reverbDamping;
    delete sp.head.reverbDiffusion;
    saveArrangement("global space room");
    liveApply();
    renderProduce();
  };
  const spRoomType = v.querySelector("#spRoomType");
  if (spRoomType) spRoomType.onchange = () => chooseRoom(spRoomType.value);
  v.querySelectorAll(".sp-designer [data-room-tile]").forEach(btn => {
    btn.onclick = () => chooseRoom(btn.dataset.roomTile);
  });
  if (_spRoomOpen) drawRoomTiles();
  const spMode = v.querySelector("#spMode");
  if (spMode) spMode.onchange = () => {
    ensureGlobalSpace().mode = spMode.value;
    saveArrangement("global space mode");
    liveApply();
  };
  const spLayerMode = v.querySelector("#spLayerMode");
  if (spLayerMode) spLayerMode.onchange = () => {
    ensureGlobalSpace().layerMode = spLayerMode.value;
    saveArrangement("global space layer mode");
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
        const pos = _spTrackPos(t, curPlayBeat());
        // the HANDLE is the grabbable thing (for multi-layer patches the
        // faint source dots are display-only — their sound is placed from
        // the sub-note stage)
        const hp = _spHandleXY(pos, g.cx, g.cy, g.rMax, _spIsMulti(_spTrackVoiceParams(t)));
        const d = Math.hypot(hp.x - g.x, hp.y - g.y);
        if (d < 10 && (!best || d < best.d)) best = { t, d };
      });
      return best?.t || null;
    };
    section.onmousedown = (e) => {
      e.preventDefault();
      const g = xy(e);
      const t = trackAtXY(g);
      if (!t) return;
      _spSelTrack = t.id; // clicking a dot selects that track (owner 07-07)
      _spRock.drag = { trackId: t.id, pos: _spTrackPos(t, curPlayBeat()), moved: false };
      const move = (ev) => {
        _spRock.drag.moved = true;
        _spRock.drag.pos = posFromXY(xy(ev));
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        const drag = _spRock.drag;
        _spRock.drag = null;
        // A plain click commits NOTHING and never re-renders — re-rendering
        // here replaced the canvas between the two clicks of a double-click,
        // which is why anchoring never fired (owner bug report 07-07).
        if (!drag?.moved) return;
        const sp = ensureGlobalSpace();
        // additive multi-layer handle: dropping near the head snaps back to
        // rest (no translation) so the constellation returns home exactly
        if (sp.layerMode === "additive" && _spIsMulti(_spTrackVoiceParams(t)) && drag.pos.dist <= 0.5) {
          drag.pos = { angle: 0, dist: 0 };
        }
        const anchors = sp.tracks[t.id];
        const a = anchors?.find(a => Math.abs(a.beat - curPlayBeat()) < 0.26);
        if (a) {
          // an anchor lives at the playhead: commit the drag to it
          a.angle = drag.pos.angle;
          a.dist = drag.pos.dist;
          saveArrangement("move space anchor");
        } else if (!anchors || !anchors.length) {
          // an UNANCHORED track just moves — it stays where you drop it
          sp.static = sp.static || {};
          sp.static[t.id] = { ...drag.pos };
          saveArrangement("move track in space");
        } // anchored without an anchor here: snaps back (the rAF redraw handles it)
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
      // owner 07-07: the very FIRST anchoring asks once, then never again
      if (!sp.anchorAsked) {
        if (!confirm("Anchor this track in space?\n\nAnchors pin a track's position at a point in time — the thread then moves between its anchors, and drags snap back unless an anchor sits at the playhead. (This is asked only once.)")) return;
        sp.anchorAsked = true;
      }
      const pos = posFromXY(g);
      const anchors = (sp.tracks[t.id] = sp.tracks[t.id] || []);
      if (!anchors.length) {
        // the very first anchor also creates start + end anchors, seeded
        // from wherever the track currently sits (incl. a static drag)
        const cur = _spTrackPos(t, curPlayBeat());
        anchors.push({ beat: 0, ...cur, smooth: 0.5 }, { beat: totalBeats(), ...cur, smooth: 0.5 });
        if (sp.static) delete sp.static[t.id]; // anchors supersede the static spot
      }
      const atBeat = Math.round(curPlayBeat() * 4) / 4;
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

// ── Q10: MIDI recording ─────────────────────────────────────
// MIDI input overrides duration/dynamics/melody; the armed track's patch
// supplies the voice and its midiMap setting decides how keys land in the
// scale. Recording stops → a BAKED region in beat-space, so the roll and
// the Q3 drill-down work unchanged.
let _midi = { access: null, deviceId: null, armedTrackId: null, rec: null, engine: null };

function _midiTrackParams(track) {
  const region0 = track.regions[0];
  const voice = region0 ? regionVoiceParams(track, region0) : (track.instrumentParams || {});
  return { ...DEFAULTS, ...arrangement.context, ...voice };
}

function onMidiMessage(ev) {
  if (_midi.deviceId && ev.target && ev.target.id !== _midi.deviceId) return;
  const [status, noteNumber, rawVel] = ev.data || [];
  const cmd = status & 0xf0;
  if (cmd !== 0x90 && cmd !== 0x80) return;
  const isOn = cmd === 0x90 && rawVel > 0;
  const track = arrangement.tracks.find(t => t.id === _midi.armedTrackId);
  if (!track) return;
  const params = _midiTrackParams(track);
  if (!_midi.engine) { _midi.engine = new GenerationEngine(params); _midi.engine.initialise(); }
  const engine = _midi.engine;
  const degree = midiMapDegree(noteNumber, engine.scale, {
    keys: params.midiMapKeys, coverage: params.midiMapCoverage, anchor: params.midiMapAnchor,
  });
  if (degree == null) return;
  const now = performance.now();
  if (isOn) {
    if (!_midi.rec) _midi.rec = { t0: now, startBeat: Math.max(0, Math.round(playheadBeat)), notes: [], open: new Map() };
    _midi.rec.open.set(noteNumber, { degree, velocity: Math.max(0.05, rawVel / 127), tOn: now });
    // monitor: hear the key through the patch voice (velocity → dynamics)
    const hz = engine.scale.degreeToHz(degree);
    const monitor = {
      degree, frequency: hz, velocity: Math.max(0.05, rawVel / 127),
      duration: 0.5, durationDivs: 1, offsetDivs: 0,
      beatDivisions: params.beatDivisions || 1, intonationCents: 0,
      gapFraction: 0, legatoFromPrevious: false, isRest: false,
      ...engine._subNoteVariation(rawVel / 127, hz, degree, null),
    };
    synth.playNotes(params, [monitor]);
  } else {
    const open = _midi.rec?.open.get(noteNumber);
    if (!open) return;
    _midi.rec.open.delete(noteNumber);
    _midi.rec.notes.push({ ...open, tOff: now });
  }
}

function finishMidiRecording() {
  const rec = _midi.rec;
  const track = arrangement.tracks.find(t => t.id === _midi.armedTrackId);
  _midi.rec = null;
  _midi.engine = null;
  if (!rec || !track) return;
  const now = performance.now();
  rec.open.forEach((open) => rec.notes.push({ ...open, tOff: now })); // close hanging keys
  if (!rec.notes.length) return;
  const params = _midiTrackParams(track);
  const beatDiv = params.beatDivisions || 1;
  const divMs = 60000 / (Math.max(30, arrangement.context.tempo || 104) * beatDiv);
  const scale = new GenerationEngine(params).scale;
  const t0 = rec.notes.reduce((min, n) => Math.min(min, n.tOn), Infinity);
  const notes = rec.notes.map(n => {
    const durationDivs = Math.max(1, Math.round((n.tOff - n.tOn) / divMs));
    return {
      degree: n.degree,
      offsetDivs: Math.max(0, Math.round((n.tOn - t0) / divMs)),
      durationDivs,
      velocity: n.velocity,
      intonationCents: 0,
      beatDivisions: beatDiv,
      gapFraction: 0,
      legatoFromPrevious: false,
      isSurprise: false,
      noteRole: "midi",
      edited: true,
      frequency: scale.degreeToHz(n.degree),
      duration: (durationDivs * divMs) / 1000,
    };
  }).sort((a, b) => a.offsetDivs - b.offsetDivs);
  const lengthBeats = Math.max(1, Math.ceil(Math.max(...notes.map(n => n.offsetDivs + n.durationDivs)) / beatDiv));
  const free = trackFreeFrom(track, rec.startBeat);
  if (free < 1) { alert("No free space on the armed track at the playhead — recording kept in memory was discarded."); return; }
  track.regions.push({
    id: crypto.randomUUID(),
    paletteId: track.regions[0]?.paletteId,
    startBeat: rec.startBeat,
    lengthBeats: Math.min(lengthBeats, free),
    seed: newSeed(),
    type: "baked",
    notes,
    loopSourceBeats: Math.min(lengthBeats, free),
  });
  saveArrangement("MIDI recording");
  renderProduce();
}

function midiToolbarHTML() {
  if (!("requestMIDIAccess" in navigator)) return "";
  if (!_midi.access) {
    return `<button class="btn btn-ghost btn-sm" id="midiBtn" title="Connect a MIDI keyboard — arm a track with its ● button, play, and stop the arm to bake the take">⌨ MIDI</button>`;
  }
  const inputs = [..._midi.access.inputs.values()];
  return `
    <select id="midiDevice" class="splits-filter" title="Which MIDI input records">
      <option value="">All inputs</option>
      ${inputs.map(inp => `<option value="${esc(inp.id)}"${_midi.deviceId === inp.id ? " selected" : ""}>${esc(inp.name || inp.id)}</option>`).join("")}
    </select>
    ${_midi.armedTrackId ? `<span class="midi-rec-dot" title="Recording arms on the ● track — playing keys records; disarm to bake">●</span>` : ""}`;
}

function wireMidi(v) {
  const midiBtn = v.querySelector("#midiBtn");
  if (midiBtn) midiBtn.onclick = async () => {
    try {
      _midi.access = await navigator.requestMIDIAccess();
      _midi.access.inputs.forEach(inp => { inp.onmidimessage = onMidiMessage; });
      _midi.access.onstatechange = () => {
        _midi.access.inputs.forEach(inp => { inp.onmidimessage = onMidiMessage; });
        renderProduce();
      };
      renderProduce();
    } catch (err) {
      alert(`MIDI unavailable: ${err.message}`);
    }
  };
  const devSel = v.querySelector("#midiDevice");
  if (devSel) devSel.onchange = () => { _midi.deviceId = devSel.value || null; };
  v.querySelectorAll("[data-track-arm]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.trackArm;
      if (_midi.armedTrackId === id) {
        finishMidiRecording(); // disarming commits the take
        _midi.armedTrackId = null;
      } else {
        if (_midi.armedTrackId) finishMidiRecording();
        _midi.armedTrackId = id;
        _midi.engine = null;
      }
      renderProduce();
    };
  });
}

function regionMiniPianoHTML(region) {
  const notes = Array.isArray(region.notes)
    ? region.notes.filter(n => !n.isRest && (n.velocity ?? 0) > 0)
    : [];
  if (!notes.length) return `<span class="tl2-mini-roll empty" aria-hidden="true"></span>`;
  const beatDiv = Math.max(1, Math.round(notes[0]?.beatDivisions || arrangement.context?.beatDivisions || 1));
  const totalDivs = Math.max(beatDiv, Math.ceil(regionLen(region) * beatDiv));
  const degrees = notes.map(n => Number(n.degree) || 0);
  let minDeg = Math.min(...degrees);
  let maxDeg = Math.max(...degrees);
  if (maxDeg - minDeg < 4) {
    minDeg -= 2;
    maxDeg += 2;
  }
  const span = Math.max(1, maxDeg - minDeg);
  const bars = notes.slice(0, 96).map(n => {
    const off = (Number(n.offsetDivs) || 0) + (Number(n.onsetDevDivs) || 0);
    const dur = Math.max(0.45, (Number(n.durationDivs) || 1) + (Number(n.durationDevDivs) || 0));
    const x = clamp((off / totalDivs) * 100, 0, 98);
    const w = clamp((dur / totalDivs) * 100, 1.2, Math.max(1.2, 100 - x));
    const y = clamp(84 - (((Number(n.degree) || 0) - minDeg) / span) * 70, 8, 84);
    const a = clamp(Number(n.velocity) || 0.62, 0.18, 1);
    return `<i class="tl2-mini-note" style="--x:${x.toFixed(2)}%;--w:${w.toFixed(2)}%;--y:${y.toFixed(2)}%;--a:${a.toFixed(2)}"></i>`;
  }).join("");
  return `<span class="tl2-mini-roll" aria-hidden="true">${bars}</span>`;
}

function regionProbabilityCurveHTML(region, params = {}) {
  const seed = (Math.floor(Number(region.seed) || 1) ^ 0x9E3779B9) >>> 0;
  const rng = _fieldRng(seed);
  const divs = clamp(Number(params.beatDivisions || arrangement.context?.beatDivisions || 1), 1, 6);
  const on = clamp(Number(params.onBeatProb ?? 0.66), 0, 1);
  const off = clamp(Number(params.offBeatProb ?? 0.38), 0, 1);
  const surprise = clamp(Number(params.surpriseDensity ?? params.surpriseRate ?? 0.2), 0, 1);
  const points = [];
  let y = clamp(60 - (on - off) * 20 + (rng() - 0.5) * 18, 16, 84);
  const steps = 11;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    const zig = (i % 2 ? 1 : -1) * (9 + off * 14);
    const drift = (rng() - 0.5) * (18 + divs * 3 + surprise * 16);
    y = clamp(y + zig + drift, 13, 87);
    points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  const pts = points.join(" ");
  return `<svg class="tl2-prob-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <polyline class="tl2-prob-shadow" points="${pts}"></polyline>
    <polyline class="tl2-prob-line" points="${pts}"></polyline>
  </svg>`;
}

function produceTimelineHTML() {
  const laneW = totalBeats() * pxPerBeat;
  // Ruler: bar numbers every BEATS_PER_BAR
  const barCount = totalBeats() / BEATS_PER_BAR;
  const rulerMarks = Array.from({ length: barCount }, (_, i) =>
    `<span class="tl2-bar" style="left:${i * BEATS_PER_BAR * pxPerBeat}px">${i + 1}</span>`).join("");
  const trackRows = arrangement.tracks.map((t, ti) => {
    const hue = t.hue ?? _spHue(ti);
    const regions = t.regions.map(r => {
      const sel = (selectedRegion?.regionId === r.id || selectedRegions.has(r.id)) ? " selected" : "";
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
      const shape = r.type === "baked"
        ? regionMiniPianoHTML(r)
        : regionProbabilityCurveHTML(r, pal?.params || t.instrumentParams || {});
      const gainDb = 20 * Math.log10(Math.max(0.02, r.gain ?? 1));
      return `<div class="tl2-region${sel}${baked}${r.muted ? " muted" : ""}" data-region="${r.id}" data-track="${t.id}"
        style="--track-h:${hue};left:${r.startBeat * pxPerBeat}px;width:${regionLen(r) * pxPerBeat - 2}px"
        title="${esc(label)}${esc(badgeHover)} — drag to move, right edge extends, ⌘T splits at the playhead. R rerolls a generative take (⇧R steps back). Double-click a baked region to edit notes.">
        ${loopTicks}${shape}<span class="tl2-seed-chip" title="This take's seed — its identity. Duplicate keeps it; ⇧⌘D duplicates with a new one.">⚄ ${r.seed}</span><span class="tl2-region-label">${esc(label)}</span>
        ${sel && pal ? `<span class="tl2-badges">${patchBadgesHTML({ ...pal.params, ...(pal.originScale || {}) }, pal.originTempo, true)}</span>` : ""}
        ${sel ? `<span class="tl2-gain-tag" data-gain-tag="${r.id}" title="Region level — drag vertically">${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)}dB</span>` : ""}
        <span class="tl2-resize" data-resize="${r.id}" title="Drag to extend"></span>
      </div>`;
    }).join("");
    const gain = t.gain ?? 1;
    const gainDbTrack = 20 * Math.log10(Math.max(0.02, gain));
    const spacePop = _spTrackPopover === t.id ? `
      <div class="tl2-space-pop">
        <label class="sp-ctl">Angle <input type="range" data-track-space-angle="${t.id}" min="-180" max="180" step="1" value="${t.space?.angle ?? 0}"/></label>
        <label class="sp-ctl">Distance <input type="range" data-track-space-dist="${t.id}" min="0.3" max="30" step="0.1" value="${t.space?.dist ?? 2.5}"/></label>
        <button class="pal-btn" data-track-space-clear="${t.id}" title="Back to the patch's own position">reset</button>
      </div>` : "";
    // Owner 07-07: the head is TWO rows so its controls never spill onto
    // the lanes — identity on top, mix controls underneath.
    return `<div class="tl2-row">
      <div class="tl2-head tl2-track-head${trackAudible(t) ? "" : " inaudible"}${_spOpen && _spSelTrack === t.id ? " sp-sel" : ""}" data-track-head="${t.id}" style="--track-h:${hue}">
        <div class="tl2-head-top">
          <span class="tl2-hue" data-track-space="${t.id}" style="background:hsl(${hue},70%,55%)" title="This track's colour (matches its global-space thread). Click for the track's own space position — drag the header to reorder tracks."></span>
          <span class="tl2-name" title="${esc(t.name)} — click to select for the global space; drag to reorder">${esc(t.name)}</span>
          <span class="tl2-db" title="Track level">${gainDbTrack >= 0 ? "+" : ""}${gainDbTrack.toFixed(1)}dB</span>
          <button class="tl-remove" data-remove-track="${t.id}" title="Remove this track">×</button>
        </div>
        <div class="tl2-head-ctl">
          <button class="tl2-ms${t.muted ? " on" : ""}" data-track-mute="${t.id}" title="Mute">M</button>
          <button class="tl2-ms tl2-solo${t.solo ? " on" : ""}" data-track-solo="${t.id}" title="Solo">S</button>
          <button class="tl2-ms tl2-gsbtn${t.useGlobalScale ? " on" : ""}" data-track-gscale="${t.id}" title="Follow the global scale strip: this track's takes regenerate under the marker in force (baked notes stay put)">G</button>
          ${_midi.access ? `<button class="tl2-ms tl2-arm${_midi.armedTrackId === t.id ? " on" : ""}" data-track-arm="${t.id}" title="Record-arm: played MIDI keys sound through this track's patch and bake into a region when you disarm">●</button>` : ""}
          <input type="range" class="tl-gain" data-track-gain="${t.id}" min="0" max="1.5" step="0.01" value="${gain}" title="Track level"/>
          <input type="range" class="tl-pan" data-track-pan="${t.id}" min="-1" max="1" step="0.05" value="${t.pan ?? 0}" title="Pan (L/R)"/>
        </div>
        ${spacePop}
      </div>
      <div class="tl2-lane" data-lane="${t.id}" style="width:${laneW}px">${regions}</div>
    </div>`;
  }).join("");
  return `
    <div class="tl2">
      <div class="tl2-row tl2-ruler-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="tl2-ruler" id="tlRuler" style="width:${laneW}px">${rulerMarks}
          <div class="tl2-loop-range${arrangement.loopRange ? (arrangement.loopOn ? "" : " dim") : " hidden"}" id="tlLoopRange" style="left:${(arrangement.loopRange?.a || 0) * pxPerBeat}px;width:${((arrangement.loopRange?.b || 0) - (arrangement.loopRange?.a || 0)) * pxPerBeat}px"></div>
          <div class="tl2-playhead hidden" id="tlPlayhead"></div>
          <div class="tl2-ph-handle" id="tlPhHandle" style="left:${playheadBeat * pxPerBeat}px" title="Playhead — drag to move it"></div>
          <button class="tl2-addbars" id="addBars" style="left:${laneW + 8}px" title="Lengthen the arrangement by 8 bars">＋8 bars</button>
        </div>
      </div>
      ${trackRows || ""}
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="tl2-newtrack" data-lane="__new__" style="width:${laneW}px">${arrangement.tracks.length ? "Drop a palette instrument here to add a track" : "Drag an instrument from your palette here to create the first track"}</div>
      </div>
      ${arrangement.tracks.length ? "" : `
      <!-- Audit P0: the first-creation path stays visible until the first
           track exists — and a demo teaches structure faster than a blank
           DAW. -->
      <div class="tl2-row">
        <div class="tl2-head tl2-corner"></div>
        <div class="tl2-empty-guide" style="width:${laneW}px">
          <div class="tl2-guide-steps">
            <span class="tl2-guide-step"><b>1</b> Pick a sound in the Browser</span>
            <span class="tl2-guide-arrow">→</span>
            <span class="tl2-guide-step"><b>2</b> ＋ Add it to your Palette</span>
            <span class="tl2-guide-arrow">→</span>
            <span class="tl2-guide-step"><b>3</b> ＋ Track, or drag it onto the lane above</span>
          </div>
          <button class="btn btn-primary" id="loadDemo" title="Build a small three-instrument arrangement so you can see how tracks, regions and seeds fit together — then reroll, bake and edit it">▶ Load demo arrangement</button>
        </div>
      </div>`}
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
  const regionName = (arrangement.palette || []).find(pl => pl.id === region.paletteId)?.name || "Region";
  return `
    <div class="roll-panel${rollDynLane ? " dyn" : ""}">
      <div class="roll-head">
        <label class="roll-dyncheck"><input type="checkbox" id="rollDynToggle"${rollDynLane ? " checked" : ""}/> velocities</label>
        <span class="roll-title">Note editor</span>
        <span class="roll-region" title="The region under edit">${esc(String(regionName))} — Seed ${region.seed ?? "—"}</span>
        <span class="roll-meta">grid <b>${beatDiv}/beat</b> · scale <b>${esc(scaleLabel)}</b> · key <b>${esc(keyName)}</b></span>
        <button class="btn btn-ghost btn-sm${_rollAddMode ? " roll-add-on" : ""}" id="rollAddMode" title="Draw mode: click an empty cell to add a note there">✏ Draw</button>
        <span class="roll-keys" title="Keyboard, with a note selected: ⌫ delete · M mute · Q quantize · ←→ nudge division · ↑↓ scale step · ⌥↑↓ cents">⌫ M Q ←→ ↑↓</span>
        <span class="roll-legend">
          <i class="roll-leg-intended"></i> Intended (scale degree)
          <i class="roll-leg-realised"></i> Realised (played)
        </span>
      </div>
      <canvas id="rollCanvas" width="960" height="${rollDynLane ? 300 : 240}"></canvas>
      <div class="roll-readout" id="rollReadout">Click a note to inspect it. Bodies show the realised pitch AND timing; dashed outlines mark the intended scale note and grid slot. ⇧-drag = micro-timing off the grid.</div>
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

  // Defensive: a note with a non-finite degree must never NaN the row
  // math and blank the whole roll.
  const degs = notes.map(n => n.degree).filter(Number.isFinite);
  const minDeg = (degs.length ? Math.min(...degs) : 0) - 2;
  const maxDeg = (degs.length ? Math.max(...degs) : 0) + 2;
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
    // Ghost: intended pitch row and/or intended grid slot — teal dashed,
    // matching the editor legend (Intended vs Realised)
    if (Math.abs(cents) > 1 || timingDeviates) {
      const gy = yForPitch(n.degree, 0) + rowH / 2 - bodyH / 2;
      ctx.strokeStyle = "rgba(95,212,200,0.55)";
      ctx.setLineDash([3, 2]);
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
  window._rollGeomQA = _rollGeom; // QA hook: lane/row geometry for tests
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
  const addToggle = v.querySelector("#rollAddMode");
  if (addToggle) addToggle.onclick = () => {
    _rollAddMode = !_rollAddMode;
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
        // startX matters: moved-detection computes dx from it, and NaN
        // (undefined startX) kept `moved` false so the drag always reverted
        drag = { i: best.i, note, mode: "velocity", startX: x, startY: y, orig: { velocity: note.velocity || 0 }, moved: false };
        drawRoll(region);
        showNote(note);
        e.preventDefault();
        return;
      }
    }
    const hit = _rollHits.find(h => x >= h.x && x <= h.x + h.w && y >= h.y - 2 && y <= h.y + h.h + 2);
    if (!hit) {
      // Q9 D2: pencil mode — an empty in-scale cell becomes a note
      if (_rollAddMode && _rollGeom && y < _rollGeom.laneTop) {
        const g = _rollGeom;
        const deg = g.maxDeg - Math.floor((y - g.padT) / g.rowH);
        const divIdx = Math.max(0, Math.min(g.totalDivs - 1, Math.floor((x - g.padL) / g.plotW * g.totalDivs)));
        if (deg >= g.minDeg && deg <= g.maxDeg && g.rowInfo[deg]?.inScale) {
          const proto = region.notes[0] || {};
          const beatDivAdd = proto.beatDivisions || arrangement.context.beatDivisions || 1;
          const divSec = 60 / (Math.max(30, arrangement.context.tempo || 104) * beatDivAdd);
          const note = {
            degree: deg, offsetDivs: divIdx, durationDivs: 1,
            velocity: 0.62, intonationCents: 0, beatDivisions: beatDivAdd,
            gapFraction: 0.1, legatoFromPrevious: false, isSurprise: false,
            noteRole: "added", edited: true,
            frequency: freqFor(deg, 0), duration: divSec * 0.9,
          };
          region.notes.push(note);
          region.notes.sort((a, b) => (a.offsetDivs || 0) - (b.offsetDivs || 0));
          rollNoteSel = region.notes.indexOf(note);
          saveArrangement("add note");
          drawRoll(region);
          showNote(note);
          if (!arrPlay && !synth.isPlaying) synth.playNotes(regionPlayParams(track, region), [{ ...note, offsetDivs: 0 }]);
          e.preventDefault();
          return;
        }
      }
      rollNoteSel = -1;
      drawRoll(region);
      setReadout("Drag a note to move it (cents ride along; out-of-scale rows are locked); drag its EDGES to trim duration; ⇧ snaps clean; ⌥ fine-tunes cents. ✏ add-mode: click an empty cell to write a note.");
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
      // Plain click or cancel: restore values, keep the selection.
      // Restore ONLY what this drag snapshotted — a velocity drag's orig
      // carries just {velocity}, and writing the missing fields poisoned
      // the note with undefined degree/offset (NaN row math blanked the
      // whole roll — owner bug report 07-07).
      if ("degree" in drag.orig) note.degree = drag.orig.degree;
      if ("cents" in drag.orig) note.intonationCents = drag.orig.cents;
      if ("offsetDivs" in drag.orig) note.offsetDivs = drag.orig.offsetDivs;
      if ("durationDivs" in drag.orig) note.durationDivs = drag.orig.durationDivs;
      if ("onsetDevDivs" in drag.orig) note.onsetDevDivs = drag.orig.onsetDevDivs;
      if ("durationDevDivs" in drag.orig) note.durationDevDivs = drag.orig.durationDevDivs;
      if (drag.mode === "velocity") note.velocity = drag.orig.velocity;
    } else {
      const o = drag.orig;
      const changed = ("degree" in o && note.degree !== o.degree)
        || ("cents" in o && (note.intonationCents || 0) !== o.cents)
        || ("offsetDivs" in o && (note.offsetDivs || 0) !== o.offsetDivs)
        || ("durationDivs" in o && (note.durationDivs || 1) !== o.durationDivs)
        || (note.onsetDevDivs || 0) !== (o.onsetDevDivs || 0)
        || (note.durationDevDivs || 0) !== (o.durationDevDivs || 0)
        || (drag.mode === "velocity" && note.velocity !== o.velocity);
      if (changed) {
        if ("degree" in o) note.frequency = freqFor(note.degree, note.intonationCents);
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
  // Q9 B2: multi-selection gets bulk actions instead of the single-region kit
  if (selectedRegions.size > 1) {
    return `
      <span class="toolbar-hint"><b>${selectedRegions.size}</b> regions selected</span>
      <button class="btn btn-ghost btn-sm" id="bulkDuplicate" title="Duplicate each selected region after itself (same seed)">Duplicate</button>
      <span class="toolbar-hint toolbar-keyhint">⌫ deletes</span>`;
  }
  if (!selectedRegion) {
    return '<span class="toolbar-hint">Select a region for loop, bake, reroll, or split. Double-click baked regions for notes.</span>';
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
      ? `<button class="btn btn-secondary btn-sm" id="regionUnbake" title="Return this region to generative playback (the baked notes are discarded; the seed regenerates the same take)">Unbake</button>`
      : `<button class="btn btn-secondary btn-sm" id="regionBake" title="Freeze this take into editable notes — the piano-roll editor works on baked regions">◆ Bake</button>`}
    <button class="btn btn-secondary btn-sm" id="regionReroll" title="Draw a fresh take: new seed, same instrument and context (R)"${baked ? " disabled" : ""}>↻ Reroll</button>
    <button class="btn btn-ghost btn-sm" id="regionSeedBack" title="Step back to the previous seed (⇧R)"${baked ? " disabled" : ""}>⤺ seed</button>
    <button class="btn btn-ghost btn-sm" id="regionSplit" title="Split at the playhead (⌘T) — both halves keep the same take">✂ Split</button>`;
}

function deleteSelectedRegions() {
  if (selectedRegions.size > 1) {
    for (const t of arrangement.tracks) t.regions = t.regions.filter(r => !selectedRegions.has(r.id));
    selectedRegions.clear();
    selectedRegion = null;
    rollOpen = false;
    rollNoteSel = -1;
    saveArrangement("bulk delete");
    renderProduce();
    return true;
  }
  if (!selectedRegion) return false;
  const track = arrangement.tracks.find(t => t.id === selectedRegion.trackId);
  const region = track?.regions.find(r => r.id === selectedRegion.regionId);
  if (!track || !region) return false;
  track.regions = track.regions.filter(r => r.id !== region.id);
  selectedRegion = null;
  rollOpen = false;
  rollNoteSel = -1;
  saveArrangement("delete region");
  renderProduce();
  return true;
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

// ── Q9 F: onboarding — shortcut overlay + first-visit tour ──
function toggleShortcutOverlay() {
  const existing = document.getElementById("shortcutOverlay");
  if (existing) { existing.remove(); return; }
  const el = document.createElement("div");
  el.id = "shortcutOverlay";
  el.className = "shortcut-overlay";
  el.innerHTML = `
    <div class="shortcut-card">
      <div class="section-label">Producer shortcuts <span class="shortcut-close">esc / ? closes</span></div>
      <div class="shortcut-cols">
        <dl>
          <dt>Space</dt><dd>play / stop</dd>
          <dt>Enter</dt><dd>return to zero</dd>
          <dt>Z · ⇧Z</dt><dd>zoom to fit · to selection</dd>
          <dt>⌘Z · ⇧⌘Z</dt><dd>undo · redo</dd>
          <dt>R · ⇧R</dt><dd>reroll take · previous seed</dd>
          <dt>⌘D · ⇧⌘D</dt><dd>duplicate · with new seed</dd>
          <dt>⌘T</dt><dd>split at playhead</dd>
          <dt>⌘C · ⌘V</dt><dd>copy · paste region</dd>
          <dt>⌫</dt><dd>delete selection</dd>
          <dt>⇧click · drag</dt><dd>multi-select regions</dd>
        </dl>
        <dl>
          <dt colspan="2"><b>Piano roll (note selected)</b></dt><dd></dd>
          <dt>⌫</dt><dd>delete note</dd>
          <dt>M</dt><dd>mute note (keeps its level)</dd>
          <dt>Q</dt><dd>quantize (clear micro-timing)</dd>
          <dt>← →</dt><dd>nudge a grid division</dd>
          <dt>↑ ↓</dt><dd>move a scale step</dd>
          <dt>⌥↑ ⌥↓</dt><dd>fine-tune ±5¢</dd>
          <dt>✏ add</dt><dd>click empty cells to write notes</dd>
        </dl>
      </div>
    </div>`;
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

const PRODUCER_TOUR_KEY = "phase0.producerTour.v1";
function maybeShowProducerTour() {
  if (localStorage.getItem(PRODUCER_TOUR_KEY)) return;
  const steps = [
    ["Welcome to the Producer", "Drag presets from the BROWSER (left) into your PALETTE — that rack holds the instruments of this arrangement. Drop one on a track lane to place a region."],
    ["Regions are takes", "Every region plays a deterministic take of its seed — R rerolls it, ◆ Bake freezes it into editable notes, double-click opens the piano roll."],
    ["Global strips & shortcuts", "The strips above the ruler drive a GLOBAL SCALE and a GLOBAL SPACE for opted-in tracks. Press ? any time for the full shortcut list."],
  ];
  let i = 0;
  const el = document.createElement("div");
  el.className = "shortcut-overlay";
  const draw = () => {
    el.innerHTML = `
      <div class="shortcut-card tour-card">
        <div class="section-label">${esc(steps[i][0])} <span class="shortcut-close">${i + 1}/${steps.length}</span></div>
        <p>${esc(steps[i][1])}</p>
        <div class="tour-actions">
          <button class="btn btn-ghost btn-sm" id="tourSkip">Skip</button>
          <button class="btn btn-primary btn-sm" id="tourNext">${i === steps.length - 1 ? "Done" : "Next"}</button>
        </div>
      </div>`;
    el.querySelector("#tourSkip").onclick = done;
    el.querySelector("#tourNext").onclick = () => { if (++i >= steps.length) done(); else draw(); };
  };
  const done = () => {
    localStorage.setItem(PRODUCER_TOUR_KEY, "seen");
    el.remove();
  };
  draw();
  document.body.appendChild(el);
}

// ── Studio tour: spotlight coach marks over the live Explore UI ──
// Audit P0 asked for non-blocking guidance instead of another modal: each
// step rings a real control (the app stays clickable underneath) and says
// what it is for. Auto-runs once after the welcome overlay; replayable any
// time from the ✦ Tour button next to the workspace tabs.
const STUDIO_TOUR_KEY = "phase0.studioTour.v1";
const STUDIO_TOUR_STEPS = [
  [".transport-card", "Hear something first",
   "▶ Play starts a continuous stream generated from the current settings — nothing is pre-recorded. Randomise reshuffles every behaviour at once, and the Seed makes any take repeatable."],
  ["#workspaceTabs", "Three workshops",
   "Macro shapes how the instrument plays: melody, rhythm, dynamics, surprise. Sub-note designs what a single note sounds like (excitor → resonator → body → space). Scale Lab is the tuning workshop."],
  [".m2-rail", "Pick a behaviour",
   "Each mode on this rail — Scale & Root, Melody, Duration, Dynamics, Sequence & Surprise, Percussion — opens its own controls in the panel beside it. Change something while playing and listen for the difference."],
  [".m2-visual", "The behaviour lanes",
   "This display is the engine thinking out loud: each lane is one behaviour, and the moving beam is the note being chosen right now. The lanes redraw as you move any control."],
  ["#m2Lib", "The browser",
   "Ready-made sounds live in this strip. Click one to load it, ♥ to keep favourites, or ▴ Browse all for the full factory, saved and community library."],
  [".top-rating-row", "Rate what you hear",
   "The 1–7 rating is how the research learns what sounds good. If you opted in to sharing it is sent anonymously; either way it tags the presets you save."],
  [".producer-pill", "When you're ready: the Producer",
   "The Producer arranges your instruments on a multitrack timeline — regions, seeds, baking takes into editable notes. It has its own short tour the first time you open it."],
];

function maybeStartStudioTour() {
  if (localStorage.getItem(STUDIO_TOUR_KEY)) return;
  startStudioTour();
}

function startStudioTour() {
  document.getElementById("studioTour")?.remove();
  const steps = STUDIO_TOUR_STEPS.filter(([sel]) => document.querySelector(sel));
  if (!steps.length) return;
  let i = 0;
  const el = document.createElement("div");
  el.id = "studioTour";
  el.innerHTML = `<div class="tour-ring"></div><div class="tour-pop"></div>`;
  document.body.appendChild(el);
  const ring = el.querySelector(".tour-ring");
  const pop = el.querySelector(".tour-pop");
  const target = () => document.querySelector(steps[i]?.[0]);
  const place = () => {
    const t = target();
    if (!t) return;
    const r = t.getBoundingClientRect();
    const pad = 6;
    Object.assign(ring.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
    const popW = pop.offsetWidth || 320;
    const popH = pop.offsetHeight || 150;
    const below = r.bottom + pad + 10;
    const top = below + popH + 12 > innerHeight
      ? Math.max(12, r.top - pad - popH - 10)
      : below;
    const left = Math.min(Math.max(12, r.left), innerWidth - popW - 12);
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  };
  const done = () => {
    localStorage.setItem(STUDIO_TOUR_KEY, "seen");
    window.removeEventListener("resize", place);
    el.remove();
  };
  const draw = () => {
    const t = target();
    if (!t) { if (++i >= steps.length) done(); else draw(); return; }
    const [, title, body] = steps[i];
    pop.innerHTML = `
      <div class="section-label">${esc(title)} <span class="shortcut-close">${i + 1}/${steps.length}</span></div>
      <p>${esc(body)}</p>
      <div class="tour-actions">
        <button class="btn btn-ghost btn-sm" id="tourSkip">Skip tour</button>
        ${i ? `<button class="btn btn-secondary btn-sm" id="tourBack">Back</button>` : ""}
        <button class="btn btn-primary btn-sm" id="tourNext">${i === steps.length - 1 ? "Done" : "Next"}</button>
      </div>`;
    pop.querySelector("#tourSkip").onclick = done;
    const back = pop.querySelector("#tourBack");
    if (back) back.onclick = () => { i--; draw(); };
    pop.querySelector("#tourNext").onclick = () => { if (++i >= steps.length) done(); else draw(); };
    t.scrollIntoView({ block: "center", behavior: "auto" });
    requestAnimationFrame(place);
  };
  window.addEventListener("resize", place);
  draw();
}

// U4: DAW keyboard transport, active only in the producer view
if (!window._dawKeysInstalled) {
  window._dawKeysInstalled = true;
  document.addEventListener("keydown", (e) => {
    if (!location.hash.includes("produce") || !arrangement) return;
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    // Q9 F: ? toggles the shortcut overlay
    if (e.key === "?") {
      e.preventDefault();
      toggleShortcutOverlay();
      return;
    }
    // Q9 D2: roll-note keyboard when a note is selected in the open roll
    if (rollOpen && rollNoteSel >= 0 && selectedBakedRegion()
        && ["Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "m", "M", "q", "Q"].includes(e.key)) {
      e.preventDefault();
      const region = selectedBakedRegion();
      const track = arrangement.tracks.find(tr => tr.id === selectedRegion.trackId);
      const note = region.notes[rollNoteSel];
      if (!note || !track) return;
      let gone = false;
      if (e.key === "Backspace" || e.key === "Delete") {
        region.notes.splice(rollNoteSel, 1);
        rollNoteSel = -1;
        gone = true;
        saveArrangement("delete note");
      } else if (e.key.toLowerCase() === "m") {
        // mute = velocity-0 flag, not removal (restores the old level)
        if (note.muted) { note.velocity = note.premuteVelocity ?? 0.62; note.muted = false; }
        else { note.premuteVelocity = note.velocity; note.velocity = 0; note.muted = true; }
        saveArrangement("mute note");
      } else if (e.key.toLowerCase() === "q") {
        note.onsetDevDivs = 0;
        note.durationDevDivs = 0;
        note.edited = true;
        saveArrangement("quantize note");
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        note.offsetDivs = Math.max(0, (note.offsetDivs || 0) + (e.key === "ArrowRight" ? 1 : -1));
        note.edited = true;
        saveArrangement("nudge note");
      } else {
        const dir = e.key === "ArrowUp" ? 1 : -1;
        const scale = new GenerationEngine(regionPlayParams(track, region)).scale;
        if (e.altKey) {
          note.intonationCents = (note.intonationCents || 0) + dir * 5;
        } else {
          note.degree = scale.stepFrom(note.degree, dir);
          note.intonationCents = note.intonationCents || 0;
        }
        note.frequency = scale.degreeToHz(note.degree) * Math.pow(2, (note.intonationCents || 0) / 1200);
        note.edited = true;
        saveArrangement("nudge pitch");
      }
      drawRoll(region);
      // audition the edit (short, only when nothing else is sounding)
      if (!gone && !arrPlay && !synth.isPlaying && note.velocity > 0) {
        synth.playNotes(regionPlayParams(track, region), [{ ...note, offsetDivs: 0 }]);
      }
      return;
    }
    // Q9 B2: ⌫ clears the whole multi-selection
    if ((e.key === "Delete" || e.key === "Backspace") && selectedRegions.size > 1) {
      e.preventDefault();
      deleteSelectedRegions();
      return;
    }
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
      deleteSelectedRegions();
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

// Audit P0: demo arrangement — three starter rigs in overlapping regions,
// built through the SAME path as by hand (palette → track → region), so
// undo/inspect/reroll all behave normally afterwards. Shared by the
// producer's empty-state button and the welcome overlay's Load Demo card.
function loadDemoArrangement() {
  arrangement = arrangement || loadArrangement();
  if (arrangement.tracks.length) return false; // never stomp real work
  const wanted = ["Wood Talk", "Deep Walker", "Slow Sky"];
  const picks = wanted
    .map(n => produceSources().find(s => s.kind === "factory" && s.name === n))
    .filter(Boolean);
  if (!picks.length) return false;
  const layout = [
    { start: 0, len: 8 * BEATS_PER_BAR },
    { start: 2 * BEATS_PER_BAR, len: 6 * BEATS_PER_BAR },
    { start: 4 * BEATS_PER_BAR, len: 4 * BEATS_PER_BAR },
  ];
  picks.forEach((src, i) => {
    addToPalette({ id: src.id, name: src.name, kindLabel: "starter", params: src.parameters, parameters: src.parameters });
    const pl = arrangement.palette[arrangement.palette.length - 1];
    arrangement.tracks.push({
      id: crypto.randomUUID(),
      name: src.name,
      sourceKind: src.kind,
      instrumentParams: { ...src.parameters },
      gain: 1,
      regions: [{
        id: crypto.randomUUID(), paletteId: pl.id,
        startBeat: layout[i]?.start ?? 0,
        lengthBeats: layout[i]?.len ?? 4 * BEATS_PER_BAR,
        seed: newSeed(),
      }],
    });
  });
  const t0 = arrangement.tracks[arrangement.tracks.length - picks.length];
  if (t0?.regions[0]) selectedRegion = { trackId: t0.id, regionId: t0.regions[0].id };
  saveArrangement("demo arrangement");
  return true;
}

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
        <div class="daw-cluster daw-cluster-arrangement" aria-label="Arrangement">
          <a class="btn btn-ghost btn-sm" href="#explore" title="Back to the Sound Studio">←</a>
          <span class="daw-title">Producer <span class="build-tag" title="App version · asset build (bumps with every change)">${BUILD_TAG}</span></span>
          <select id="arrSelect" class="daw-ctx-select" title="Switch arrangement">
            ${Object.values(loadArrangementRegistry()).map(a =>
              `<option value="${a.id}"${a.id === arrangement.id ? " selected" : ""}>${esc(a.name || "Untitled")}</option>`).join("")}
          </select>
          <button class="btn btn-ghost btn-sm" id="arrNew" title="New empty arrangement">New</button>
          <button class="btn btn-ghost btn-sm" id="arrRename" title="Rename this arrangement">Aa</button>
          <button class="btn btn-ghost btn-sm" id="arrDelete" title="Delete this arrangement">🗑</button>
        </div>
        <div class="daw-cluster daw-cluster-playback" aria-label="Transport">
          <button class="btn btn-ghost btn-sm" id="arrRTZ" title="Return to bar 1 (Return)">⏮</button>
          <button class="btn btn-primary btn-sm" id="arrPlayBtn" title="Play / pause (Space)">▶</button>
          <button class="btn btn-secondary btn-sm" id="prodStop" title="Stop (returns to the start marker)">■</button>
          <button class="btn btn-ghost btn-sm${arrangement.loopOn ? " loop-on" : ""}" id="arrLoop" title="Cycle the loop range (drag the ruler's top half to set it)">⟳</button>
          <span class="daw-pos" id="arrPos" title="Position bar.beat — click to locate">${Math.floor(playheadBeat / BEATS_PER_BAR) + 1}.${(Math.floor(playheadBeat) % BEATS_PER_BAR) + 1}</span>
          <span class="daw-saved" id="arrSaved"></span>
        </div>
        <div class="daw-cluster daw-cluster-context" aria-label="Session context">
          ${sessionBarControlsHTML()}
        </div>
        <div class="daw-cluster daw-cluster-edit" aria-label="Grid and edit">
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
        </div>
        <div class="daw-cluster daw-cluster-io" aria-label="File and MIDI">
          <select id="arrFileMenu" class="daw-ctx-select daw-file-menu" title="Export WAV, export arrangement JSON, or import an arrangement">
            <option value="">File</option>
            <option value="wav">Export WAV</option>
            <option value="json-export">Export arrangement</option>
            <option value="json-import">Import arrangement</option>
          </select>
          <input type="file" id="arrImportFile" accept="application/json" style="display:none"/>
          ${midiToolbarHTML()}
          <span class="toolbar-hint" id="mixStatus"></span>
        </div>
        <div class="daw-cluster daw-cluster-region region-toolbar" id="regionToolbar" aria-label="Selected region actions">${produceToolbarHTML()}</div>
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
                      <button class="pal-btn pal-track-btn" data-add-track="pal:${pl.id}" title="Add a track playing this instrument, with a first region at bar 1">＋ Track</button>
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
          <!-- Owner 07-07: the global strips are a SEPARATE panel — vertical
               timeline scrolling never moves them; horizontal position stays
               beat-aligned via scrollLeft sync (wireStripsPanel). -->
          <div class="strips-panel" id="stripsPanel"><div class="tl2 strips-tl2" id="stripsScroll">${globalScaleStripHTML(totalBeats() * pxPerBeat)}${globalSpaceStripHTML(totalBeats() * pxPerBeat)}</div></div>
          <div class="timeline-grid" id="timelineGrid">${produceTimelineHTML()}</div>
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
  maybeShowProducerTour(); // Q9 F: three-step first-visit tour
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
  // Owner rework: the strip canvas is the surface. Double-click at a bar
  // line adds a change point (seeded from the scale in force there);
  // clicking a change-point line opens the editor; clicking anywhere else
  // on the canvas closes it, leaving the line + highlight diff visible.
  const gsCanvas = v.querySelector("#gsCanvas");
  if (gsCanvas) {
    drawGsStrip();
    const beatAt = (e) => {
      const rect = gsCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (gsCanvas.width / Math.max(1, rect.width));
      return x / pxPerBeat;
    };
    gsCanvas.onclick = (e) => {
      const beat = beatAt(e);
      const gs = arrangement.globalScale || { markers: [] };
      const tol = 5 / pxPerBeat; // ±5 px around a change-point line
      const hit = (gs.markers || []).findIndex(m => Math.abs(m.atBeat - beat) <= tol);
      const next = hit >= 0 ? (hit === _gsSelMarker ? -1 : hit) : -1;
      if (next !== _gsSelMarker) {
        _gsSelMarker = next;
        renderProduce();
      }
    };
    gsCanvas.ondblclick = (e) => {
      const gs = ensureGlobalScale();
      const atBeat = Math.max(0, Math.round(beatAt(e) / BEATS_PER_BAR) * BEATS_PER_BAR);
      const existing = gs.markers.findIndex(m => m.atBeat === atBeat);
      if (existing >= 0) {
        _gsSelMarker = existing;
        renderProduce();
        return;
      }
      const seed = _gsScaleAt(atBeat); // continue the scale in force here
      gs.markers.push({
        atBeat,
        degrees: [...(seed.degrees || [])],
        subScaleNotes: [...(seed.subScaleNotes || [])],
        rootNotes: [...(seed.rootNotes || [0])],
      });
      gs.markers.sort((a, b) => a.atBeat - b.atBeat);
      _gsSelMarker = gs.markers.findIndex(m => m.atBeat === atBeat);
      gs.enabled = true; // adding the first change point is an unambiguous opt-in
      saveArrangement("global scale change point");
      renderProduce();
    };
  }
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
  // Clicking anywhere off the editor closes it (bubble phase, so the
  // click's own action runs first), leaving the change-point line and the
  // highlight difference visible in the strip.
  if (!window._gsClickOffInstalled) {
    window._gsClickOffInstalled = true;
    document.addEventListener("click", (e) => {
      if (_gsSelMarker < 0 || !location.hash.includes("produce")) return;
      if (e.target.closest?.(".gs-editor") || e.target.closest?.("#gsCanvas")) return;
      _gsSelMarker = -1;
      renderProduce();
    });
  }
}

function wireStripsPanel(v) {
  // beat-alignment: the strips mirror the timeline's horizontal scroll
  const strips = v.querySelector("#stripsScroll");
  const grid = v.querySelector("#timelineGrid");
  const tl2 = grid?.querySelector(".tl2");
  if (!strips || !tl2) return;
  const sync = () => { strips.scrollLeft = tl2.scrollLeft; };
  tl2.addEventListener("scroll", sync);
  grid.addEventListener("scroll", () => { strips.scrollLeft = grid.scrollLeft; });
  sync();
}

function wireProduce(v) {
  const sources = produceSources();

  wireSessionBar(v);
  wireBrowserPalette(v);
  wireGlobalScale(v);
  wireGlobalSpace(v);
  wireMidi(v);
  wireStripsPanel(v);

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

  // Audit P0: demo arrangement (shared builder — also reachable from the
  // welcome overlay's Load Demo path).
  const demoBtn = v.querySelector("#loadDemo");
  if (demoBtn) demoBtn.onclick = () => { if (loadDemoArrangement()) renderProduce(); };

  v.querySelectorAll("[data-remove-track]").forEach(btn => {
    btn.onclick = () => {
      const track = arrangement.tracks.find(t => t.id === btn.dataset.removeTrack);
      // Q9 C: deleting a track with regions is destructive — confirm first
      if (track && track.regions.length && !confirm(`Remove track "${track.name}" and its ${track.regions.length} region${track.regions.length > 1 ? "s" : ""}?`)) return;
      arrangement.tracks = arrangement.tracks.filter(t => t.id !== btn.dataset.removeTrack);
      if (selectedRegion && !arrangement.tracks.some(t => t.id === selectedRegion.trackId)) {
        selectedRegion = null;
      }
      saveArrangement("remove track");
      renderProduce();
    };
  });

  // Q9 C: track-head extras — hue swatch opens the track's own space
  // mini-controls; dragging the header vertically reorders tracks.
  v.querySelectorAll("[data-track-space]").forEach(sw => {
    sw.onclick = (e) => {
      e.stopPropagation();
      _spTrackPopover = _spTrackPopover === sw.dataset.trackSpace ? null : sw.dataset.trackSpace;
      renderProduce();
    };
  });
  const bindTrackSpace = (attr, key) => v.querySelectorAll(`[${attr}]`).forEach(sl => {
    sl.oninput = () => {
      const t = arrangement.tracks.find(t => t.id === sl.getAttribute(attr));
      if (!t) return;
      t.space = { angle: t.space?.angle ?? 0, dist: t.space?.dist ?? 2.5, [key]: Number(sl.value) };
    };
    sl.onchange = () => { saveArrangement("track space"); };
  });
  bindTrackSpace("data-track-space-angle", "angle");
  bindTrackSpace("data-track-space-dist", "dist");
  v.querySelectorAll("[data-track-space-clear]").forEach(btn => {
    btn.onclick = () => {
      const t = arrangement.tracks.find(t => t.id === btn.dataset.trackSpaceClear);
      if (t) { delete t.space; _spTrackPopover = null; saveArrangement("track space reset"); renderProduce(); }
    };
  });
  v.querySelectorAll("[data-track-head]").forEach(head => {
    head.onmousedown = (e) => {
      if (e.target.closest("button, input, .tl2-hue, .tl2-space-pop")) return;
      e.preventDefault();
      const id = head.dataset.trackHead;
      let baseY = e.clientY;
      const rowH = head.closest(".tl2-row")?.getBoundingClientRect().height || 40;
      let moved = false;
      const move = (ev) => {
        const delta = Math.round((ev.clientY - baseY) / rowH);
        if (!delta) return;
        const from = arrangement.tracks.findIndex(t => t.id === id);
        const to = Math.max(0, Math.min(arrangement.tracks.length - 1, from + delta));
        if (to !== from) {
          const [t] = arrangement.tracks.splice(from, 1);
          arrangement.tracks.splice(to, 0, t);
          moved = true;
          baseY = ev.clientY; // each step re-baselines so moves don't compound
          renderProduce(); // document-level listeners keep the drag alive across the re-render
        }
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        if (moved) {
          saveArrangement("reorder tracks");
        } else if (_spOpen) {
          // plain click on a track head selects it for the global space —
          // its dot lights up in the cross-section and its thread in the
          // cylinder (owner 07-07)
          _spSelTrack = id;
          renderProduce();
        }
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
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
    el.onclick = (e) => {
      // Q9 B2: ⇧click extends the multi-selection
      if (e.shiftKey) {
        if (selectedRegion?.regionId && !selectedRegions.size) selectedRegions.add(selectedRegion.regionId);
        if (selectedRegions.has(el.dataset.region)) selectedRegions.delete(el.dataset.region);
        else selectedRegions.add(el.dataset.region);
        selectedRegion = { trackId: el.dataset.track, regionId: el.dataset.region };
        renderProduce();
        return;
      }
      selectedRegions.clear();
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

  // Q9 B2: rubber-band selection — drag on empty lane space sweeps regions
  // across lanes into the multi-selection.
  v.querySelectorAll(".tl2-lane").forEach(lane => {
    lane.onmousedown = (e) => {
      if (e.target.closest("[data-region]")) return; // region drags win
      if (lane.dataset.lane === "__new__") return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY;
      const band = document.createElement("div");
      band.className = "tl2-band";
      document.body.appendChild(band);
      let swept = false;
      const move = (ev) => {
        swept = true;
        const l = Math.min(x0, ev.clientX), t = Math.min(y0, ev.clientY);
        const w = Math.abs(ev.clientX - x0), h = Math.abs(ev.clientY - y0);
        Object.assign(band.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px`, display: "block" });
      };
      const up = (ev) => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        const rect = { l: Math.min(x0, ev.clientX), t: Math.min(y0, ev.clientY), r: Math.max(x0, ev.clientX), b: Math.max(y0, ev.clientY) };
        band.remove();
        if (!swept || (rect.r - rect.l < 4 && rect.b - rect.t < 4)) {
          // plain click on empty lane: clear selection and close the note
          // editor without needing an explicit hide control.
          if (selectedRegions.size || selectedRegion || rollOpen) {
            selectedRegions.clear();
            selectedRegion = null;
            rollOpen = false;
            rollNoteSel = -1;
            renderProduce();
          }
          return;
        }
        selectedRegions.clear();
        document.querySelectorAll("[data-region]").forEach(rEl => {
          const rr = rEl.getBoundingClientRect();
          if (rr.right > rect.l && rr.left < rect.r && rr.bottom > rect.t && rr.top < rect.b) {
            selectedRegions.add(rEl.dataset.region);
            selectedRegion = { trackId: rEl.dataset.track, regionId: rEl.dataset.region };
          }
        });
        renderProduce();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
  });

  // Owner 07-07: the playhead is directly draggable via its ruler handle
  const phHandle = v.querySelector("#tlPhHandle");
  if (phHandle) phHandle.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation(); // the ruler's own locate/loop drags stay untouched
    const rulerEl = v.querySelector("#tlRuler");
    const move = (ev) => {
      const rect = rulerEl.getBoundingClientRect();
      playheadBeat = Math.max(0, Math.min(totalBeats() - 0.25,
        Math.round(((ev.clientX - rect.left) / pxPerBeat) * 4) / 4));
      updatePlayhead(playheadBeat);
      phHandle.style.left = `${playheadBeat * pxPerBeat}px`;
      // the cross-section follows live through the designer's rAF loop
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      renderProduce(); // refresh playhead-dependent controls (anchor smoothness…)
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

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

  // Q9 B2: bulk actions over the multi-selection
  const eachSelected = (fn) => {
    for (const t of arrangement.tracks) {
      for (const r of [...t.regions]) if (selectedRegions.has(r.id)) fn(t, r);
    }
  };
  const bulkGain = v.querySelector("#bulkGain");
  if (bulkGain) bulkGain.onchange = () => {
    eachSelected((t, r) => { r.gain = Number(bulkGain.value); });
    saveArrangement("bulk gain");
    renderProduce();
  };
  const bulkMute = v.querySelector("#bulkMute");
  if (bulkMute) bulkMute.onclick = () => {
    let anyOn = false;
    eachSelected((t, r) => { if (!r.muted) anyOn = true; });
    eachSelected((t, r) => { r.muted = anyOn; });
    saveArrangement("bulk mute");
    renderProduce();
  };
  const bulkDup = v.querySelector("#bulkDuplicate");
  if (bulkDup) bulkDup.onclick = () => {
    const fresh = [];
    eachSelected((t, r) => {
      const len = regionLen(r);
      let start = r.startBeat + len;
      while (start + len <= totalBeats() && !spanFree(t, start, len)) start++;
      if (start + len > totalBeats()) return;
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = crypto.randomUUID();
      copy.startBeat = start;
      t.regions.push(copy);
      fresh.push(copy.id);
    });
    selectedRegions = new Set(fresh);
    saveArrangement("bulk duplicate");
    renderProduce();
  };
  const bulkDel = v.querySelector("#bulkDelete");
  if (bulkDel) bulkDel.onclick = () => deleteSelectedRegions();

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
  if (deleteBtn) deleteBtn.onclick = () => deleteSelectedRegions();

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

  const fileMenu = v.querySelector("#arrFileMenu");
  if (fileMenu) fileMenu.onchange = () => {
    const action = fileMenu.value;
    fileMenu.value = "";
    if (action === "wav") mixdownArrangement(v.querySelector("#mixStatus"), fileMenu);
    if (action === "json-export") exportArrangement();
    if (action === "json-import") v.querySelector("#arrImportFile")?.click();
  };
  const mixBtn = v.querySelector("#arrMixdown");
  if (mixBtn) mixBtn.onclick = () => mixdownArrangement(v.querySelector("#mixStatus"), mixBtn);
  const exportBtn = v.querySelector("#arrExport");
  if (exportBtn) exportBtn.onclick = () => exportArrangement();
  const importBtn = v.querySelector("#arrImport");
  const importFile = v.querySelector("#arrImportFile");
  if (importFile) {
    importFile.onchange = () => { if (importFile.files[0]) importArrangement(importFile.files[0]); };
  }
  if (importBtn && importFile) {
    importBtn.onclick = () => importFile.click();
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
    <div class="explore-dashboard${workspaceTab === 'subnote' ? ' subnote-workspace-mode' : ''}${workspaceTab === 'scalelab' ? ' scalelab-workspace-mode' : ''}${workspaceTab === 'explore' ? ' macro2-workspace-mode' : ''}" style="--dash-c1:${_studioPanels.dashC1}px">
      <div class="dash-vsplit" id="dashVSplit" title="Drag to resize the left column"></div>
    <div class="explore-top">
      <div>
        <h1>Sound Studio <span class="build-tag" title="App version · asset build (bumps with every change)">${BUILD_TAG}</span></h1>
        <div class="studio-subtitle">Probabilistic Synthesiser</div>
      </div>
      <div class="workspace-tabs" id="workspaceTabs">
        <button class="workspace-tab${workspaceTab === 'explore' ? ' active' : ''}" data-workspace-tab="explore" title="The behaviour half: melody, rhythm, dynamics, sequence & surprise — how the instrument plays">Macro</button>
        <button class="workspace-tab${workspaceTab === 'subnote' ? ' active' : ''}" data-workspace-tab="subnote" title="The instrument designer: excitor, resonator, body and space — what one note sounds like">Sub-note</button>
        <button class="workspace-tab${workspaceTab === 'scalelab' ? ' active' : ''}" data-workspace-tab="scalelab" title="The tuning workshop: the scale wheel, N-EDO systems, world tunings, per-degree cents and Scala import/export">Scale Lab</button>
      </div>
      <button class="btn btn-ghost btn-sm studio-tour-btn" id="studioTourBtn" title="Replay the guided tour of the studio">✦ Tour</button>
    </div>

    ${paletteEditBannerHTML()}
    ${welcomeCardHTML()}

    <!-- Transport -->
    <div class="card transport-card">
      <div class="transport">
        <a class="producer-pill" href="#produce" title="Producer: arrange your instruments on a timeline">▦ Producer</a>
        <button class="transport-round transport-play${synth.isPlaying ? ' is-playing' : ''}" id="playBtn">${synth.isPlaying ? "❚❚" : "▶"}</button>
        <button class="transport-round transport-stop" id="stopBtn">■</button>
        <button class="btn btn-secondary rand-btn" id="randBtn">Randomise</button>
        <button class="btn btn-secondary" id="regenBtn" title="Rebuild the sequence from the start using the current parameters">↻ Restart seq</button>
        <div class="seed-box">
          <span>Seed</span>
          <button class="btn btn-ghost btn-sm" id="seedBtn">${p.seed}</button>
        </div>
      </div>
      ${workspaceTab === 'explore' ? '' : `
      <div class="top-save-bar">
        <input type="text" id="presetName" placeholder="Preset name" maxlength="80"/>
        <select id="presetScope" title="What the preset captures: the whole rig, or just one section to mix and match">
          <option value="full">Everything</option>
          ${Object.entries(PRESET_SECTIONS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("")}
        </select>
        <button class="btn btn-primary btn-sm" id="saveBtn">Save</button>
      </div>`}
      <div class="top-rating-row">
        <span class="label">Rating</span>
        <input type="range" id="ratingSlider" min="1" max="7" step="1" value="${exploreRating}"/>
        <output id="ratingOut">${exploreRating}/7</output>
      </div>
      <div class="controls-grid tempo-grid">
        ${controlRow("tempo", "Tempo", p.tempo, 50, 180, 1)}
      </div>
      <!-- V2.2 (owner): presets no longer open from the top bar — the
           browser strip at the bottom of the macro workspace is the one
           preset surface (expandable for the full library). -->
    </div>

    <!-- V2: the hero visualiser lives INSIDE the macro workspace now (its
         centre display); the other workspaces never showed it anyway. -->
    ${workspaceTab === 'subnote' ? subnoteWorkspaceHTML(p) : workspaceTab === 'scalelab' ? scaleLabWorkspaceHTML(p) : macroWorkspaceHTML(p)}

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
  canvasCtx = canvas ? canvas.getContext("2d") : null;

  // Responsive, high-DPI hero display: match the backing store to the CSS
  // size (capped at 2x DPR) and redraw whenever the layout changes.
  if (_visResizeObserver) {
    _visResizeObserver.disconnect();
    _visResizeObserver = null;
  }
  if (canvas && window.ResizeObserver) {
    const observedCanvas = canvas;
    const fitVis = () => {
      if (!observedCanvas.isConnected) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(observedCanvas.clientWidth * dpr);
      const h = Math.round(observedCanvas.clientHeight * dpr);
      if (w > 0 && h > 0 && (observedCanvas.width !== w || observedCanvas.height !== h)) {
        observedCanvas.width = w;
        observedCanvas.height = h;
        layoutLaneHeads(); // lane header overlay tracks the canvas box
        if (!synth.isPlaying) drawStaticVis();
      }
    };
    _visResizeObserver = new ResizeObserver(fitVis);
    _visResizeObserver.observe(observedCanvas);
    fitVis();
  }

  const visModeSwitch = v.querySelector("#visModeSwitch");
  if (visModeSwitch) {
    visModeSwitch.onclick = (e) => {
      const tog = e.target.closest("[data-vistoggle]");
      if (tog) {
        // spectrum overlay: on/off, drawn faintly behind the active view
        _visSpecOverlay = !_visSpecOverlay;
        tog.classList.toggle("active", _visSpecOverlay);
        if (!synth.isPlaying) drawStaticVis();
        return;
      }
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

  const tourBtn = v.querySelector("#studioTourBtn");
  if (tourBtn) tourBtn.onclick = () => startStudioTour();

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
    // owner 07-07 round 3: room designer + ear model — all convolver/space live
    "reverbSize","reverbDamping","reverbDiffusion","pinnaScale",
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
    "layerEnvProb","layerEnvAttackSd","layerEnvDecaySd","layerEnvSustainSd","layerEnvReleaseSd",
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
        if (key.startsWith("layerEnv")) refreshLayerEnvLines(); // rows mirror the shared panel live
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
      if (key === "spectralProfile") {
        resetSpectralPartialParams(exploreParams);
        delete exploreParams.spectralProfileName;
      }
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
  wireStageBig(v); // V2 spatial stage — sources around the shared head
  wireSubnoteTitle(v);
  wireScaleLab(v); // V2 scale lab — the tuning workshop tab
  wireEarRoom(v);
  drawSpaceField(); // SPACE stage ear-response view (display only)
  wireLayerStrip(v);
  wireStudioPanels(v);
  // Owner 07-07: one-click octave shifts widen a patch's range of uses —
  // an octave is one full turn of the scale (div degrees in degree space)
  const octShift = (dir) => {
    const div = exploreParams.scaleMode === "edo" ? (exploreParams.edoDivisions || 12) : 12;
    exploreParams.registerCenter = Math.max(-48, Math.min(48, (exploreParams.registerCenter || 0) + dir * div));
    synth.updateGenerationParams({ ...exploreParams });
    renderExplore();
  };
  const octDown = v.querySelector("#octDown");
  if (octDown) octDown.onclick = () => octShift(-1);
  const octUp = v.querySelector("#octUp");
  if (octUp) octUp.onclick = () => octShift(1);

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
      if (liveReverbParams.has(key)) {
        synth.updateReverb({ ...exploreParams });
        drawSpaceField(); // the SPACE ear-response view rides these live
        return;
      }
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

  // V2: Envelope / Modulation tab switch (right column)
  const tdTabs = v.querySelector("#tdTabs");
  if (tdTabs) tdTabs.onclick = (e) => {
    const btn = e.target.closest("[data-td-tab]");
    if (!btn || btn.dataset.tdTab === _tdSideTab) return;
    _tdSideTab = btn.dataset.tdTab;
    renderExplore();
  };

  // V2: stage power toggles (BODY / SPACE bypass — a stored mix amount)
  v.querySelectorAll("[data-ch-power]").forEach(el => {
    const fire = (e) => {
      e.stopPropagation(); // the card underneath selects the stage
      const stage = el.dataset.chPower;
      const key = stage === "body" ? "spectralResonanceAmount" : "reverbWet";
      const before = exploreParams[key];
      toggleStagePower(exploreParams, stage);
      noteParamChange(key, before, exploreParams[key]);
      if (stage === "space") synth.updateReverb({ ...exploreParams });
      else synth.updateGenerationParams({ ...exploreParams });
      renderExplore();
    };
    el.onclick = fire;
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") fire(e); };
  });

  // V2 macro explorer: task rail → one mechanism in the inspector
  v.querySelectorAll("[data-m2-mode]").forEach(btn => {
    btn.onclick = () => {
      const mode = btn.dataset.m2Mode;
      if (mode === _macroMode) return;
      _macroMode = mode;
      if (["melody", "tuning", "duration", "dynamics"].includes(mode)) macroTab = mode;
      const wasPlaying = synth.isPlaying;
      renderExplore();
      if (wasPlaying) startVisualiser();
    };
  });
  const openLab = v.querySelector("#m2OpenScaleLab");
  if (openLab) openLab.onclick = () => {
    workspaceTab = "scalelab";
    const wasPlaying = synth.isPlaying;
    renderExplore();
    if (wasPlaying) startVisualiser();
  };
  // V2 macro explorer: bottom preset strip (factory full rigs)
  v.querySelectorAll("[data-m2-preset]").forEach(btn => {
    btn.onclick = () => {
      const f = FACTORY_PRESETS.find(x => x.id === btn.dataset.m2Preset);
      if (!f) return;
      const wasPlaying = synth.isPlaying;
      exploreParams = mergedPresetParams({ parameters: { ...f.parameters }, section: "full" });
      renderExplore();
      if (wasPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
    };
  });
  drawM2PresetArt();
  drawM2SoundArt(); // sub-note browser: sound-module cards draw their partial recipes
  wireM2Lib(v); // V2.2 bottom browser (collapsed strip / expanded library)
  wireLaneHeads(v); // lane-key popovers (lanes display only)

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
  // One searchable combo covers 12-tone presets AND world tunings.
  const scaleCombo = v.querySelector("#scaleCombo");
  if (scaleCombo) {
    const comboBtn = scaleCombo.querySelector("#scaleComboBtn");
    const comboPop = scaleCombo.querySelector("#scaleComboPop");
    const comboSearch = scaleCombo.querySelector("#scaleComboSearch");
    const comboFilter = () => {
      const q = comboSearch.value.trim().toLowerCase();
      scaleCombo.querySelectorAll("[data-scale-choice]").forEach(b => {
        b.hidden = !!q && !b.textContent.toLowerCase().includes(q);
      });
      scaleCombo.querySelectorAll(".scale-combo-group").forEach(g => {
        let sib = g.nextElementSibling, any = false;
        while (sib && !sib.classList.contains("scale-combo-group")) {
          if (!sib.hidden) any = true;
          sib = sib.nextElementSibling;
        }
        g.hidden = !any;
      });
    };
    comboBtn.onclick = (e) => {
      e.stopPropagation();
      comboPop.hidden = !comboPop.hidden;
      if (!comboPop.hidden) { comboSearch.value = ""; comboFilter(); comboSearch.focus(); }
    };
    comboSearch.oninput = comboFilter;
    scaleCombo.querySelectorAll("[data-scale-choice]").forEach(b => {
      b.onclick = () => {
        const [kind, key] = b.dataset.scaleChoice.split(":");
        if (kind === "p") {
          const preset = SCALE_PRESETS[key] || SCALE_PRESETS.major;
          exploreParams.scaleMode = "12tone";
          exploreParams.scalePreset = key;
          exploreParams.customDegrees = [...preset.degrees];
          exploreParams.subScaleNotes = (exploreParams.subScaleNotes || []).filter(d => preset.degrees.includes(d));
          exploreParams.degreeTuning = null; // plain presets are equal-tempered — stale world tuning must not linger
          exploreParams.rootNotes = (exploreParams.rootNotes || [0]).filter(r => preset.degrees.includes(r));
          if (!exploreParams.rootNotes.length) exploreParams.rootNotes = [preset.degrees[0] ?? 0];
          _scaleComboWorld = null;
        } else {
          // world tuning: divisions + degrees + (where the tradition isn't
          // equal-tempered) the per-degree pitch centres, in one pick
          const s = CULTURAL_SCALES[key];
          if (!s) return;
          exploreParams.scaleMode = s.edo === 12 ? "12tone" : "edo";
          exploreParams.edoDivisions = s.edo;
          exploreParams.customDegrees = [...s.degrees];
          exploreParams.subScaleNotes = [...(s.sub || [])];
          exploreParams.rootNotes = [...(s.roots || [0])];
          exploreParams.degreeTuning = s.tuning ? { ...s.tuning } : null;
          _scaleComboWorld = key;
        }
        synth.updateGenerationParams({ ...exploreParams });
        renderExplore();
        debouncedReplay();
      };
    });
    if (window._scaleComboDocClick) document.removeEventListener("click", window._scaleComboDocClick, true);
    window._scaleComboDocClick = (e) => {
      if (!comboPop.hidden && !e.target.closest("#scaleCombo")) comboPop.hidden = true;
    };
    document.addEventListener("click", window._scaleComboDocClick, true);
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

  // Scale circle: click cycles a degree's role; dragging a node around the
  // ring adjusts its pitch centre (per-degree cents); double-click resets it.
  const noteGridContainer = v.querySelector("#noteGridContainer");
  if (noteGridContainer) {
    noteGridContainer.onmousedown = (e) => {
      const cell = e.target.closest(".note-cell");
      if (!cell) return;
      e.preventDefault();
      const d = parseInt(cell.dataset.degree);
      const circle = cell.closest(".note-circle");
      const rect = circle.getBoundingClientRect();
      const divisions = exploreParams.scaleMode === "edo" ? (exploreParams.edoDivisions || 12) : 12;
      const maxCents = Math.max(5, Math.floor(1200 / divisions / 2) - 1); // never cross a neighbour
      let moved = false;
      const centsAt = (ev) => {
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        let angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) + Math.PI / 2; // 0 at 12 o'clock
        let frac = angle / (2 * Math.PI);
        frac = ((frac % 1) + 1) % 1;
        let cents = (frac - d / divisions) * 1200;
        if (cents > 600) cents -= 1200;
        if (cents < -600) cents += 1200;
        return Math.max(-maxCents, Math.min(maxCents, Math.round(cents)));
      };
      const move = (ev) => {
        if (Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) < 4 && !moved) return;
        moved = true;
        const cents = centsAt(ev);
        exploreParams.degreeTuning = { ...(exploreParams.degreeTuning || {}) };
        if (cents) exploreParams.degreeTuning[d] = cents;
        else delete exploreParams.degreeTuning[d];
        if (!Object.keys(exploreParams.degreeTuning).length) exploreParams.degreeTuning = null;
        rerenderNoteGrid(v);
        synth.updateGenerationParams({ ...exploreParams });
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        if (!moved) {
          // plain click: cycle the role exactly as before
          handleNoteGridClick(cell);
          syncRootNotesWithScale(v);
        } else {
          debouncedReplay();
        }
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    };
    noteGridContainer.ondblclick = (e) => {
      const cell = e.target.closest(".note-cell");
      if (!cell || !exploreParams.degreeTuning) return;
      const d = parseInt(cell.dataset.degree);
      delete exploreParams.degreeTuning[d];
      if (!Object.keys(exploreParams.degreeTuning).length) exploreParams.degreeTuning = null;
      rerenderNoteGrid(v);
      synth.updateGenerationParams({ ...exploreParams });
      debouncedReplay();
    };
  }

  // (World tunings live inside the scale preset combo above.)

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

// ═══ V2 MACRO EXPLORER (render phase-02, 2026-07-08 redesign) ═══════
// Display-led: a task rail on the left picks ONE mechanism, the centre
// is the live behaviour display (lanes/spectrum/motifs/roll — engine
// truth), the right inspector holds that mechanism's controls, and a
// preset strip runs along the bottom. Same params, same wiring hooks.
let _macroMode = "melody";

// Square icon cards per the phase-02 mock (audit renders): icon on top,
// label under, accent colour per mechanism.
const M2_RAIL_ICONS = {
  scale: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="4" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="9.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="16.5" cy="18.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="7.5" cy="18.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="9.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.1"/></svg>`,
  melody: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 15 Q7 4 11 11 T21 9"/><circle cx="3" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="11" cy="11" r="1.3" fill="currentColor" stroke="none"/><circle cx="21" cy="9" r="1.3" fill="currentColor" stroke="none"/></svg>`,
  tuning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3.5M12 18v3.5M2.5 12h3.5M18 12h3.5"/></svg>`,
  duration: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1.6"/><rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.6" fill="currentColor" stroke="none"/><rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.6"/></svg>`,
  dynamics: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4.5 18v-4M10 18V8M15.5 18V4.5M21 18v-7"/></svg>`,
  sequence: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 3.5v3.6M12 16.9v3.6M3.5 12h3.6M16.9 12h3.6M6 6l2.4 2.4M18 6l-2.4 2.4M6 18l2.4-2.4M18 18l-2.4-2.4"/></svg>`,
  percussion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><ellipse cx="12" cy="8" rx="8" ry="3.1"/><path d="M4 8v8c0 1.7 3.6 3.1 8 3.1s8-1.4 8-3.1V8"/><path d="M12 11.1v7.9"/></svg>`,
};

function m2RailHTML() {
  const item = (mode, label, color = "", full = "") => `
    <button class="m2-rail-btn${_macroMode === mode ? " active" : ""}" data-m2-mode="${mode}"${color ? ` style="--rail-c:${color}"` : ""}${full ? ` title="${full}"` : ""}>
      <span class="m2-rail-icon">${M2_RAIL_ICONS[mode] || ""}</span>
      <span class="m2-rail-label">${label}</span>
    </button>`;
  return `
    <div class="m2-rail">
      ${item("scale", "Scale &amp; Root")}
      <div class="m2-rail-group">
        <div class="m2-rail-head">Macro Probability</div>
        <div class="m2-rail-grid">
          ${item("melody", "Melody", "var(--gen)")}
          ${item("tuning", "Tuning", "var(--surp)")}
          ${item("duration", "Duration", "var(--blue)")}
          ${item("dynamics", "Dynamics", "var(--green)")}
        </div>
      </div>
      ${item("sequence", "Sequence &amp; Surprise", "", "Markov sequence & surprise")}
      ${item("percussion", "Percussion")}
    </div>`;
}

// Which world tuning the combo last applied (a world pick rewrites mode/
// divisions/degrees, so it can't be re-derived from params afterwards).
let _scaleComboWorld = null;

function _scaleComboLabel(p) {
  if (_scaleComboWorld) {
    // only trust the remembered world pick while the params still match it
    const s = CULTURAL_SCALES[_scaleComboWorld];
    const div = p.scaleMode === "edo" ? (p.edoDivisions || 12) : 12;
    if (s && s.edo === div && JSON.stringify(s.degrees) === JSON.stringify(p.customDegrees)) return s.label;
    _scaleComboWorld = null;
  }
  if (p.scaleMode === "edo") return `${p.edoDivisions || 12}-EDO custom`;
  return SCALE_PRESETS[p.scalePreset]?.label || "Custom";
}

function m2ScaleInspectorHTML(p) {
  return `
    <div class="section-label">Scale & Root</div>
    ${panelPresetBarHTML("melody")}
    <div class="mode-btns" id="scaleModeGroup">
      <button class="mode-btn${p.scaleMode !== 'edo' ? ' active' : ''}" data-smode="12tone">12-tone</button>
      <button class="mode-btn${p.scaleMode === 'edo' ? ' active' : ''}" data-smode="edo">N-EDO</button>
    </div>
    <div id="scaleOptions">
      <div class="scale-preset-row">
        <span class="text-sm" style="color:var(--text2)">Preset</span>
        <div class="scale-combo" id="scaleCombo">
          <button type="button" class="scale-combo-btn" id="scaleComboBtn" title="Scale presets and world tunings in one list — open and type to search">${esc(_scaleComboLabel(p))}<span class="scale-combo-caret">▾</span></button>
          <div class="scale-combo-pop" id="scaleComboPop" hidden>
            <input type="search" class="scale-combo-search" id="scaleComboSearch" placeholder="Search scales &amp; tunings…"/>
            <div class="scale-combo-list" id="scaleComboList">
              <div class="scale-combo-group">12-tone presets</div>
              ${Object.entries(SCALE_PRESETS).map(([k, s]) =>
                `<button type="button" class="scale-combo-opt${p.scaleMode !== 'edo' && !_scaleComboWorld && p.scalePreset === k ? " sel" : ""}" data-scale-choice="p:${k}">${esc(s.label)}</button>`).join("")}
              <div class="scale-combo-group">World tunings</div>
              ${Object.entries(CULTURAL_SCALES).map(([k, s]) =>
                `<button type="button" class="scale-combo-opt${_scaleComboWorld === k ? " sel" : ""}" data-scale-choice="w:${k}" title="${esc(s.description || s.label)}">${esc(s.label)}<i class="scale-combo-note">${s.edo}-EDO</i></button>`).join("")}
            </div>
          </div>
        </div>
      </div>
      ${p.scaleMode === 'edo' ? `
        <div class="edo-row">
          <span class="text-sm" style="color:var(--text2)">Divisions:</span>
          <input type="number" id="edoDivisionsInput" class="edo-input"
                 min="3" max="48" value="${p.edoDivisions}"/>
        </div>
      ` : ""}
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
      <canvas class="dist-canvas" id="cvRoot" width="240" height="96" style="height:96px" title="${esc(UI_DESC.cvRoot || "How strongly root pull acts across the phrase.")}"></canvas>
      <span class="dist-label">pull toward the root across each motif phrase</span>
    </div>`;
}

function m2SequenceInspectorHTML(p) {
  return `
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
    ${surpriseWeightControlsHTML(p)}`;
}

function m2InspectorHTML(p) {
  if (_macroMode === "scale") return m2ScaleInspectorHTML(p);
  if (_macroMode === "sequence") return m2SequenceInspectorHTML(p);
  if (_macroMode === "percussion") {
    return `
      <div class="section-label">Percussion</div>
      <div class="micro-note">Playback dressing only — accents never change motif generation.</div>
      ${productionPanelHTML(p)}`;
  }
  // the four probability mechanisms share one anatomy (LAYOUT proposal §3)
  const label = { melody: "Melody", tuning: "Tuning", duration: "Duration", dynamics: "Dynamics" }[macroTab] || "Melody";
  return `
    <div class="macro-card-head">
      <div class="section-label">Macro Probability — ${label}</div>
    </div>
    ${macroPanelHTML(p)}`;
}

function m2ChipsHTML(p) {
  // spectrum/motif retired as modes — normalize any stale state to lanes
  if (visMode !== "lanes" && visMode !== "pianoroll") visMode = "lanes";
  const div = p.scaleMode === "edo" ? (p.edoDivisions || 12) : 12;
  const scaleName = p.scaleMode === "edo"
    ? `${(p.customDegrees || []).length}/${div} degrees`
    : (SCALE_PRESETS[p.scalePreset]?.label || "Custom");
  const root = (p.rootNotes || [0])[0] ?? 0;
  const rootName = div === 12 ? NOTE_NAMES_12[root] : `°${root}`;
  return `
    <div class="m2-chips">
      <span class="m2-chip">Scale: <b>${esc(scaleName)}</b></span>
      <span class="m2-chip">Root: <b>${esc(String(rootName))}</b></span>
      <span class="m2-chip">${div}-EDO</span>
      <button class="m2-chip m2-chip-link" id="m2OpenScaleLab" title="Open the tuning workshop">Open Scale Lab ↗</button>
      <div class="vis-mode-switch" id="visModeSwitch">
        <button class="vis-mode-btn${visMode === "lanes" ? " active" : ""}" data-vismode="lanes" title="Behaviour timeline — history and the possible future field (motif structure lives here too)">Lanes</button>
        <button class="vis-mode-btn${visMode === "pianoroll" ? " active" : ""}" data-vismode="pianoroll" title="Scrolling piano roll of the realized notes">Roll</button>
        <button class="vis-mode-btn vis-spec-toggle${_visSpecOverlay ? " active" : ""}" data-vistoggle="spec" title="Overlay the live frequency response faintly behind the current view — no information lost to a separate mode">Spec</button>
      </div>
    </div>`;
}

// ═══ V2.2 macro BROWSER (owner 2026-07-08): one preset surface ═══
// Collapsed: a strip of behaviour-signature cards with shortcut filters.
// Expanded: an overlay over the lower workspace with the granular
// library — factory / mine / community tabs, hearts, ratings, tags —
// and the save controls live in the strip header in BOTH states.
let _m2Lib = { open: false, tab: "factory", search: "", fam: "all", favOnly: false };
let _m2LibCommunity = null; // fetched on first Community open

function loadFavs() {
  try { return new Set(JSON.parse(localStorage.getItem("phase0.favs.v1") || "[]")); } catch { return new Set(); }
}
function saveFavs(s) { localStorage.setItem("phase0.favs.v1", JSON.stringify([...s])); }

function m2LibEntries() {
  if (_m2Lib.tab === "mine") {
    return loadPresets().map(e => ({
      id: `m:${e.id}`, name: e.name, section: e.section || "full",
      family: null, rating: e.rating ?? null, parameters: e.parameters, desc: "",
    }));
  }
  if (_m2Lib.tab === "community") {
    return (_m2LibCommunity || []).map((e, i) => ({
      id: `g:${e.id ?? i}`, name: e.name || "Shared preset", section: e.section || "full",
      family: e.family || null, rating: e.rating ?? null, parameters: e.parameters, desc: e.description || "",
    }));
  }
  return FACTORY_PRESETS.map(f => ({
    id: `f:${f.id}`, name: f.name, section: f.section || "full",
    family: f.family || null, rating: null, parameters: f.parameters, desc: f.description || "",
  }));
}

function m2LibFiltered() {
  const favs = loadFavs();
  const q = _m2Lib.search.trim().toLowerCase();
  const soundMode = m2SoundMode();
  // Sub-note mode: the factory tab leads with the instrument recipes, and
  // sound modules sort ahead of full patches (which still load/drag in —
  // only their sound half comes across). Behaviour-family chips are a
  // macro concept, so the fam filter is ignored here.
  const entries = soundMode && _m2Lib.tab === "factory"
    ? [
        ...Object.entries(SPECTRAL_PROFILES).map(([k, prof]) => ({
          id: `r:${k}`, name: prof.label, section: "sound", family: null, rating: null,
          parameters: null, desc: `${prof.label} recipe — partial levels, envelope and performance defaults`,
        })),
        ...m2LibEntries(),
      ]
    : m2LibEntries();
  const rows = entries.filter(e =>
    (soundMode || _m2Lib.fam === "all" || e.family === _m2Lib.fam || e.section === _m2Lib.fam) &&
    (!_m2Lib.favOnly || favs.has(e.id)) &&
    (!q || e.name.toLowerCase().includes(q) || (e.desc || "").toLowerCase().includes(q)));
  if (soundMode) rows.sort((a, b) => (a.section === "sound" ? 0 : 1) - (b.section === "sound" ? 0 : 1));
  return rows;
}

function m2LibRowsHTML() {
  const favs = loadFavs();
  const rows = m2LibFiltered();
  if (_m2Lib.tab === "community" && _m2LibCommunity === null) {
    return '<div class="empty-state">Loading the shared library…</div>';
  }
  if (!rows.length) return '<div class="empty-state">Nothing matches — clear the search or filters.</div>';
  return rows.map(e => {
    const splits = e.parameters ? splitsBucketOf(e.parameters) : null;
    const layerCount = Array.isArray(e.parameters?.layers) ? e.parameters.layers.length : 0;
    return `
    <div class="m2-lib-row" draggable="true" data-m2-drag="${esc(e.id)}" title="${esc(e.desc || e.name)} — drag onto the LAYERS strip to stack its sound onto this instrument">
      <span class="m2-lib-name">${esc(e.name)}</span>
      <span class="m2-lib-tags">
        <i class="m2-tag">${esc(PRESET_SECTIONS[e.section]?.label || (e.section === "full" ? "Full rig" : e.section))}</i>
        ${e.family ? `<i class="m2-tag">${esc(e.family)}</i>` : ""}
        ${splits && splits !== "all" ? `<i class="m2-tag">${esc(splits)} splits</i>` : ""}
        ${layerCount ? `<i class="m2-tag m2-tag-layers" title="Base sound plus ${layerCount} layered sub-note source${layerCount > 1 ? "s" : ""}">+${layerCount} layer${layerCount > 1 ? "s" : ""}</i>` : ""}
      </span>
      <span class="m2-lib-stars" title="${e.rating ? `rated ${e.rating}/7 when saved` : "no rating yet"}">${e.rating ? `★ ${e.rating}/7` : "☆ –"}</span>
      <button class="m2-lib-heart${favs.has(e.id) ? " on" : ""}" data-m2-fav="${esc(e.id)}" title="Favourite — pin it to the ♥ filter">♥</button>
      <button class="btn btn-secondary btn-sm" data-m2-load="${esc(e.id)}" title="${m2SoundMode()
        ? (e.section === "full" ? "Load just this patch's sound module (its sub-note half) as the base sound" : "Load this sound module as the base sound")
        : (e.section === "full" ? "Load the whole rig" : "Apply just this section, keeping everything else")}">Load</button>
    </div>`;
  }).join("");
}

// Sub-note browser mode: in the sub-note workspace the browser IS the
// instrument selection — its catalogue defaults to sound modules (factory
// recipes + saved sub-note module presets), and full patches contribute
// only their sound half when clicked or dragged in.
function m2SoundMode() { return workspaceTab === "subnote"; }

// The sub-note browser's collapsed catalogue: factory instrument recipes
// plus the user's saved sub-note modules.
function m2SoundModules() {
  const recipes = Object.entries(SPECTRAL_PROFILES).map(([k, prof]) => ({
    id: `r:${k}`, name: prof.label, kind: "instrument", profileKey: k,
    desc: `${prof.label} recipe — partial levels, envelope and performance defaults; everything stays editable`,
  }));
  const mine = loadPresets().filter(e => (e.section || "full") === "sound").map(e => ({
    id: `m:${e.id}`, name: e.name, kind: "my module",
    profileKey: e.parameters?.spectralProfile || null,
    desc: "Your saved sub-note module",
  }));
  return [...recipes, ...mine];
}

function m2PresetStripHTML(withSave = true) {
  const favs = loadFavs();
  const soundMode = m2SoundMode();
  const famChip = (k, label) => `<button class="m2-lib-chip${_m2Lib.fam === k ? " active" : ""}" data-m2-fam="${k}">${label}</button>`;
  const fulls = FACTORY_PRESETS.filter(f => f.section === "full" &&
    (_m2Lib.fam === "all" || f.family === _m2Lib.fam) &&
    (!_m2Lib.favOnly || favs.has(`f:${f.id}`)));
  const soundCards = soundMode
    ? m2SoundModules().filter(m => !_m2Lib.favOnly || favs.has(m.id))
    : [];
  return `
    <div class="m2-lib${_m2Lib.open ? " open" : ""}" id="m2Lib">
      ${soundMode ? `<div class="m2-drop-layer" id="m2DropLayer" hidden>⊕ drop here to add as a layer — its sound comes across, your room &amp; head stay</div>` : ""}
      <div class="m2-lib-head">
        <span class="m2-lib-title">BROWSER</span>
        <button class="m2-lib-chip m2-lib-expand" id="m2LibToggle" title="${_m2Lib.open ? "Back to the compact strip" : "Open the full library — factory, your saves, and the shared community"}">${_m2Lib.open ? "▾ Collapse" : "▴ Browse all"}</button>
        ${_m2Lib.open ? `
        <span class="m2-lib-tabs">
          ${[["factory", "Factory"], ["mine", "Mine"], ["community", "Community"]].map(([k, label]) =>
            `<button class="m2-lib-chip m2-lib-tab${_m2Lib.tab === k ? " active" : ""}" data-m2-tab="${k}">${label}</button>`).join("")}
        </span>
        <input type="search" id="m2LibSearch" class="m2-lib-search" placeholder="Search…" value="${esc(_m2Lib.search)}"/>` : ""}
        ${soundMode ? "" : `${famChip("all", "All")}${famChip("percussive", "Percussive")}${famChip("bass", "Bass")}${famChip("atmos", "Atmos")}${famChip("melody", "Melody")}`}
        <button class="m2-lib-chip m2-lib-fav${_m2Lib.favOnly ? " active" : ""}" id="m2LibFavOnly" title="Only favourites">♥</button>
        ${withSave ? `
        <span class="m2-lib-save">
          <input type="text" id="presetName" placeholder="Preset name" maxlength="80"/>
          <select id="presetScope" title="What the preset captures: the whole rig, or just one section to mix and match">
            <option value="full">Everything</option>
            ${Object.entries(PRESET_SECTIONS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm" id="saveBtn">Save</button>
        </span>` : ""}
      </div>
      ${_m2Lib.open
        ? `<div class="m2-lib-list" id="m2LibList">${m2LibRowsHTML()}</div>`
        : soundMode
          ? `<div class="m2-presets" id="m2Presets">
              ${soundCards.map(m => `
                <button class="m2-preset${m.profileKey === exploreParams.spectralProfile && m.kind === "instrument" ? " sel" : ""}" data-m2-sound="${esc(m.id)}" draggable="true" data-m2-drag="${esc(m.id)}" title="${esc(m.desc)} — click to make it the base sound, or drag onto the LAYERS strip to stack it">
                  <span class="m2-preset-name">${esc(m.name)}</span>
                  <canvas data-m2-sound-art="${esc(m.id)}" width="180" height="40"></canvas>
                  <span class="m2-preset-fam">${esc(m.kind)}</span>
                </button>`).join("") || '<div class="empty-state">No favourites yet — open ▴ Browse all and ♥ some sounds.</div>'}
            </div>`
          : `<div class="m2-presets" id="m2Presets">
            ${fulls.map(f => `
              <button class="m2-preset" data-m2-preset="${esc(f.id)}" draggable="true" data-m2-drag="f:${esc(f.id)}" title="${esc(f.description || f.name)} — click to load the full rig, or drag onto the LAYERS strip to stack its sound onto this instrument">
                <span class="m2-preset-name">${esc(f.name)}</span>
                <canvas data-m2-art="${esc(f.id)}" width="180" height="40"></canvas>
                <span class="m2-preset-fam">${esc(f.family || "")}</span>
              </button>`).join("") || '<div class="empty-state">No favourites yet — open ▴ Browse all and ♥ some presets.</div>'}
          </div>`}
    </div>`;
}

// Resolve a browser drag id (r:/f:/m:/g: prefixed) to its preset parameters,
// independent of which library tab is currently showing. Recipe ids (r:)
// synthesize a clean sound module from the instrument profile.
function m2PresetParamsById(id) {
  if (!id) return null;
  if (id.startsWith("r:")) {
    const key = id.slice(2);
    if (!SPECTRAL_PROFILES[key]) return null;
    const params = { ...extractSectionParams(DEFAULTS, "sound"), spectralProfile: key };
    resetSpectralPartialParams(params);
    return params;
  }
  if (id.startsWith("f:")) return FACTORY_PRESETS.find(f => `f:${f.id}` === id)?.parameters || null;
  if (id.startsWith("m:")) return loadPresets().find(e => `m:${e.id}` === id)?.parameters || null;
  if (id.startsWith("g:")) return (_m2LibCommunity || []).find((e, i) => `g:${e.id ?? i}` === id)?.parameters || null;
  return null;
}

// Load a browser entry as the BASE sound (sub-note mode): a recipe re-seats
// the instrument exactly like the old instrument cards did; any preset —
// sound module or full patch — contributes only its sound half. The shared
// space (room, head, air) and the macro half stay untouched.
function loadSoundModuleById(id) {
  if (id.startsWith("r:")) {
    const key = id.slice(2);
    if (!SPECTRAL_PROFILES[key] || exploreParams.spectralProfile === key) return;
    noteParamChange("spectralProfile", exploreParams.spectralProfile, key);
    exploreParams.spectralProfile = key;
    delete exploreParams.spectralProfileName;
    resetSpectralPartialParams(exploreParams);
    if ((exploreParams.bodyType || "auto") === "auto") {
      delete exploreParams.bodyBands;
      _chBodySel = null;
    }
  } else {
    const params = m2PresetParamsById(id);
    if (!params) return;
    const sound = extractSectionParams(migrateToneParams({ ...params }), "sound");
    for (const k of Object.keys(sound)) if (k.startsWith("layer")) delete sound[k];
    if (!Object.keys(sound).length) return;
    Object.assign(exploreParams, sound);
    if (!Object.prototype.hasOwnProperty.call(sound, "spectralProfileName")) delete exploreParams.spectralProfileName;
    if ((exploreParams.bodyType || "auto") === "auto") {
      delete exploreParams.bodyBands;
      _chBodySel = null;
    }
  }
  synth.updateGenerationParams({ ...exploreParams });
  renderExplore();
}

// Add a browser preset as layer(s): its sound half becomes a new layer, and
// any layers the preset carries ride along. Only the sound module comes
// across (plus per-layer position) — the shared space (room, head, air)
// stays the instrument's own.
function addPresetAsLayers(params) {
  if (!params) return false;
  exitLayerEdit(false);
  if (!Array.isArray(exploreParams.layers)) exploreParams.layers = [];
  const pushLayer = (sourceParams, space, gain) => {
    const subnote = { ...sourceParams };
    for (const k of Object.keys(subnote)) if (k.startsWith("layer")) delete subnote[k];
    if (!Object.keys(subnote).length) return false;
    exploreParams.layers.push({
      id: crypto.randomUUID(),
      hue: (36 + exploreParams.layers.length * 70) % 360,
      subnote,
      space,
      gain,
    });
    return true;
  };
  let added = pushLayer(
    extractSectionParams(params, "sound"),
    // position is a layer's own space property — take the preset's if saved
    {
      angle: params.spaceAzimuth ?? (exploreParams.spaceAzimuth ?? 0),
      dist: params.spaceDistance ?? (exploreParams.spaceDistance ?? 2.5),
    },
    0.8);
  for (const l of Array.isArray(params.layers) ? params.layers : []) {
    if (!l || typeof l !== "object" || !l.subnote) continue;
    added = pushLayer(
      { ...l.subnote },
      { angle: l.space?.angle ?? 0, dist: l.space?.dist ?? 2.5 },
      l.gain ?? 0.8) || added;
  }
  if (!added) return false;
  _chLayerSel = exploreParams.layers[exploreParams.layers.length - 1].id;
  synth.updateGenerationParams({ ...exploreParams });
  renderExplore();
  return true;
}

// Make an element accept browser-preset drops as new layers.
function bindLayerDropTarget(target) {
  target.ondragover = (e) => {
    if (![...e.dataTransfer.types].includes("application/x-preset-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    target.classList.add("drop-ok");
  };
  target.ondragleave = () => target.classList.remove("drop-ok");
  target.ondrop = (e) => {
    e.preventDefault();
    target.classList.remove("drop-ok");
    addPresetAsLayers(m2PresetParamsById(e.dataTransfer.getData("application/x-preset-id")));
  };
}

function wireM2Lib(v) {
  const lib = v.querySelector("#m2Lib");
  if (!lib) return;
  const dropZone = v.querySelector("#m2DropLayer");
  if (dropZone) bindLayerDropTarget(dropZone);
  const toggle = v.querySelector("#m2LibToggle");
  if (toggle) toggle.onclick = () => { _m2Lib.open = !_m2Lib.open; renderExplore(); };
  v.querySelectorAll("[data-m2-tab]").forEach(btn => {
    btn.onclick = async () => {
      _m2Lib.tab = btn.dataset.m2Tab;
      if (_m2Lib.tab === "community" && _m2LibCommunity === null) {
        renderExplore(); // shows the loading row
        try { _m2LibCommunity = await api("/api/presets/global"); }
        catch { _m2LibCommunity = []; }
      }
      renderExplore();
    };
  });
  v.querySelectorAll("[data-m2-fam]").forEach(btn => {
    btn.onclick = () => { _m2Lib.fam = btn.dataset.m2Fam; renderExplore(); };
  });
  const favOnly = v.querySelector("#m2LibFavOnly");
  if (favOnly) favOnly.onclick = () => { _m2Lib.favOnly = !_m2Lib.favOnly; renderExplore(); };
  const search = v.querySelector("#m2LibSearch");
  if (search) search.oninput = () => {
    _m2Lib.search = search.value;
    const list = v.querySelector("#m2LibList");
    if (list) { list.innerHTML = m2LibRowsHTML(); wireM2LibList(v); }
  };
  wireM2LibList(v);
}

// Preset drag-out: cards and rows carry their library id; the LAYERS strip
// in the sub-note view accepts the drop (sound half only — shared space
// stays with the instrument).
function wireM2Drag(v) {
  const dropZone = document.getElementById("m2DropLayer");
  v.querySelectorAll("[data-m2-drag]").forEach(el => {
    el.ondragstart = (e) => {
      e.dataTransfer.setData("application/x-preset-id", el.dataset.m2Drag);
      e.dataTransfer.effectAllowed = "copy";
      // A drop target the drag can always reach — the expanded library
      // covers the LAYERS strip, so a floating zone appears while dragging.
      if (dropZone) dropZone.hidden = false;
    };
    el.ondragend = () => { if (dropZone) dropZone.hidden = true; };
  });
}

function wireM2LibList(v) {
  wireM2Drag(v);
  v.querySelectorAll("[data-m2-fav]").forEach(btn => {
    btn.onclick = () => {
      const favs = loadFavs();
      const id = btn.dataset.m2Fav;
      favs.has(id) ? favs.delete(id) : favs.add(id);
      saveFavs(favs);
      btn.classList.toggle("on", favs.has(id));
    };
  });
  v.querySelectorAll("[data-m2-load]").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.m2Load;
      if (m2SoundMode()) { loadSoundModuleById(id); return; }
      const entry = m2LibEntries().find(e => e.id === id);
      if (!entry || !entry.parameters) return;
      const wasPlaying = synth.isPlaying;
      exploreParams = mergedPresetParams({ parameters: { ...entry.parameters }, section: entry.section || "full" });
      renderExplore();
      if (wasPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
    };
  });
  // Sub-note mode: the collapsed strip's sound cards load on click
  v.querySelectorAll("[data-m2-sound]").forEach(btn => {
    btn.onclick = () => loadSoundModuleById(btn.dataset.m2Sound);
  });
}

// Behaviour signature (owner 07-08): one melodic contour line per preset,
// rolled deterministically from its own parameters — amplitude from the
// interval range, smooth curve vs zig-zag from the interval shape, arcs and
// runs from momentum, a soft slack band from hit accuracy × SD, and the
// line's COLOUR is the surprise heat (teal = tame → red = volatile), with a
// warm wash behind high-surprise patches. Same params → same picture.
function drawM2PresetArt() {
  const fulls = FACTORY_PRESETS.filter(f => f.section === "full");
  for (const f of fulls) {
    const cv = document.querySelector(`[data-m2-art="${f.id}"]`);
    if (!cv) continue;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const P = f.parameters || {};
    let seed = 0;
    for (const ch of f.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rng = _fieldRng(seed || 1);
    const range = clamp((Number(P.intervalRange ?? 7)) / 14, 0.15, 1);
    const smooth = clamp((Number(P.intervalPeakedness ?? 2)) / 4, 0, 1);   // 1 = stepwise
    const momentum = clamp(Number(P.momentum ?? 0), 0, 1);
    const surprise = clamp(Number(P.surpriseProb ?? 0), 0, 1);
    const slack = clamp((1 - (Number(P.motifHitProb ?? 0.9))) * (Number(P.motifHitRange ?? 2)) / 2.5, 0, 1);

    // surprise wash: volatile patches sit on a warm field
    if (surprise > 0.02) {
      const g = ctx.createLinearGradient(0, h, w, 0);
      g.addColorStop(0, "rgba(229,110,60,0)");
      g.addColorStop(1, `rgba(229,96,60,${(0.04 + surprise * 0.30).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // the contour: a seeded walk shaped by the preset's own melody params
    const n = 15;
    const mid = h * 0.56, amp = h * 0.34 * range;
    const pts = [];
    let y = (rng() - 0.5) * 0.4, dir = 0;
    for (let i = 0; i < n; i++) {
      let step = (rng() * 2 - 1) * (0.35 + (1 - smooth) * 0.75);
      step += dir * momentum * 0.7;                    // momentum → arcs and runs
      y = clamp(y + step, -1, 1);
      if (step !== 0) dir = Math.sign(step);
      pts.push([4 + (i / (n - 1)) * (w - 8), mid - y * amp]);
    }
    const tracePath = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      if (smooth > 0.45) {
        // stepwise patches read as a flowing arc
        for (let i = 1; i < n; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
      } else {
        // jumpy patches read as a zig-zag
        for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      }
    };
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (slack > 0.03) {
      // hit slack: a soft band of where the line may actually land
      ctx.strokeStyle = heatColor(surprise, 0.16);
      ctx.lineWidth = 3 + slack * 9;
      tracePath();
      ctx.stroke();
    }
    ctx.strokeStyle = heatColor(surprise, 0.92);      // colour IS the surprise heat
    ctx.lineWidth = 1.7;
    tracePath();
    ctx.stroke();
  }
}

function macroWorkspaceHTML(p) {
  return `
    <div class="card macro2-card">
      <div class="m2-main">
        ${m2RailHTML()}
        <!-- Owner 07-08: the controls panel sits beside the rail (icon → its
             controls → the display), not stranded on the far side. -->
        <div class="m2-inspector" id="m2Inspector">${m2InspectorHTML(p)}</div>
        <div class="m2-center">
          ${m2ChipsHTML(p)}
          <div class="visualiser-wrap vis-mode-${visMode} m2-visual">
            <canvas id="vis" width="980" height="210"></canvas>
            ${visMode === "lanes" ? `
            <div class="m2-lane-heads" id="m2LaneHeads">
              ${LANE_DEFS.map(d => `
                <div class="m2-lane-head" data-lane-head="${d.key}">
                  <span class="m2-lane-n" style="color:${d.col}">${d.n}</span>
                  <div class="m2-lane-tt">
                    <span class="m2-lane-title" style="color:${d.col}">${d.title}</span>
                    <span class="m2-lane-sub">${d.sub}</span>
                  </div>
                  <button class="m2-lane-info" data-lane-key="${d.key}" title="Show this lane's key" aria-label="${d.title} key">i</button>
                </div>`).join("")}
            </div>
            <div class="m2-lane-key" id="m2LaneKey" hidden></div>` : ""}
          </div>
          <div class="m2-bottom">
            <span class="m2-status-chip" id="m2StatusChip">■ stopped · settings field ready</span>
            <div class="engine-state m2-tiles" id="engineState">
              <div class="stat">Motifs <span class="stat-val" id="statMotifs">&ndash;</span></div>
              <div class="stat">Variants <span class="stat-val" id="statVariants">&ndash;</span></div>
              <div class="stat">Sequence <span class="stat-val" id="statSeq">&ndash;</span></div>
              <div class="stat">Notes <span class="stat-val" id="statNotes">&ndash;</span></div>
              <div class="stat">Rests <span class="stat-val" id="statRests">&ndash;</span></div>
              <div class="stat">Mean info <span class="stat-val" id="statMeanInfo">&ndash;</span></div>
              <div class="stat">Surprises <span class="stat-val" id="statSurprises">&ndash;</span></div>
            </div>
          </div>
        </div>
      </div>
      ${m2PresetStripHTML()}
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
          <canvas class="dist-canvas accuracy-canvas" id="cvTuningAccuracy" width="620" height="220"></canvas>
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
          <canvas class="dist-canvas accuracy-canvas" id="cvDurationAccuracy" width="620" height="220"></canvas>
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
          <canvas class="dist-canvas accuracy-canvas" id="cvDynamicsAccuracy" width="620" height="220"></canvas>
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
          <div class="subsection-label">Register
            <span class="oct-btns">
              <button class="pal-btn" id="octDown" title="Drop the whole melody an octave (register centre −1 octave)">8va −</button>
              <button class="pal-btn" id="octUp" title="Lift the whole melody an octave (register centre +1 octave)">8va ＋</button>
            </span>
          </div>
          ${controlRow("registerCenter", "Centre", p.registerCenter, -24, 24, 1)}
          ${controlRow("registerWidth", "Width", p.registerWidth, 2, 36, 1)}
          ${controlRow("registerSkew", "Skew", p.registerSkew, -1, 1, 0.05)}
          <canvas class="mini-canvas register-mini-canvas" id="cvRegister" width="280" height="50"></canvas>
        </div>
      </div>
      <div class="macro-monitor melody-monitor">
        <div class="monitor-title">Scale Degree Difference (Steps)</div>
        <canvas class="dist-canvas accuracy-canvas" id="cvMelodyAccuracy" width="620" height="220"></canvas>
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

// One layer's envelope-baseline line. While synchronised, the chance and
// the ± magnitudes come from the shared panel (identical on every row);
// the means stay the layer's own.
function layerEnvLineText(l, p) {
  const sn = l.subnote || {};
  const syncActive = !!p.layerEnvOverride;
  const prof = SPECTRAL_PROFILES[sn.spectralProfile]?.label || sn.spectralProfile || "custom";
  const v = (k, fb) => sn[k] ?? p[k] ?? fb;
  const ms = (x) => Math.round(x * 1000);
  const prob = syncActive ? (p.layerEnvProb ?? 0.5) : v("envelopeProb", 0);
  const sd = (ownKey, sharedKey, fb) => syncActive ? (p[sharedKey] ?? fb) : v(ownKey, fb);
  return [
    prof,
    `var ${Math.round(prob * 100)}%${syncActive ? " (synced)" : ""}`,
    `A ${ms(v("envelopeAttack", 0.008))}±${ms(sd("envelopeAttackSd", "layerEnvAttackSd", 0.006))}ms`,
    `D ${ms(v("envelopeDecay", 0.04))}±${ms(sd("envelopeDecaySd", "layerEnvDecaySd", 0.018))}ms`,
    `S ${Math.round(v("envelopeSustain", 0.6) * 100)}±${Math.round(sd("envelopeSustainSd", "layerEnvSustainSd", 0.08) * 100)}%`,
    `R ${ms(v("envelopeRelease", 0.08))}±${ms(sd("envelopeReleaseSd", "layerEnvReleaseSd", 0.035))}ms`,
  ].join(" · ");
}

// Refresh every row's baseline line in place (no re-render — the shared
// SD sliders live-update mid-drag).
function refreshLayerEnvLines() {
  (exploreParams.layers || []).forEach(l => {
    const row = document.querySelector(`[data-layer-row="${l.id}"] .layer-env`);
    if (row) row.textContent = layerEnvLineText(l, exploreParams);
  });
}

function layerStripHTML(p, compact = false) {
  const layers = Array.isArray(p.layers) ? p.layers : [];
  // V2: on the SPACE stage the big stage IS the layers view (chips +
  // draggable dots; position is a layer's only space property), so the
  // strip collapses to its header — add/remove still lives here.
  if (compact) {
    return `
    <div class="layer-strip" id="layerStrip">
      <span class="layer-strip-label" title="${esc(PARAM_DESC.layers)}">LAYERS</span>
      <button class="layer-add" id="layerAdd" title="Add the current sub-note module (sound half) as a new layer underneath">＋</button>
      <span class="layer-strip-note">${layers.length ? `${layers.length} layer${layers.length > 1 ? "s" : ""} on the stage above — drag the dots to place them; switch to another stage to edit their sound` : "no layers yet — ＋ captures the current sound as a layer, or drag a preset from the browser below"}</span>
    </div>`;
  }
  // Owner refinement 07-07: each row = mini head diagram + two lines —
  // space parameters (level/angle/distance + the layer's OWN head when
  // enabled) on top, the layer's full envelope baseline (variation chance
  // and every parameter's mean ± SD) underneath. The synchronised-
  // variation controls live in their own panel to the RIGHT of the rows,
  // greyed out unless synchronisation is on.
  const rows = layers.map((l, i) => {
    const envStr = layerEnvLineText(l, p);
    return `
    <div class="layer-row${l.id === _chLayerSel ? " sel" : ""}" data-layer-row="${l.id}" style="--layer-hue:${l.hue ?? (36 + i * 70) % 360}" title="Click to load this layer's sound into the editor above (click again, or Done, to return to the base)">
      <span class="layer-row-tag">${i + 1}</span>
      <canvas class="layer-minipad" data-layer-pad="${l.id}" width="40" height="40" title="Where this layer sits around your head — set it with the Angle and Dist sliders (shaded half = behind you)"></canvas>
      <div class="layer-row-lines">
        <div class="layer-row-space">
          <label class="sp-ctl">Vol <input type="range" data-layer-gain="${l.id}" min="0" max="1.5" step="0.01" value="${l.gain ?? 1}" title="This layer's level relative to the base sound"/></label>
          <label class="sp-ctl">Angle <input type="range" data-layer-angle="${l.id}" min="-180" max="180" step="1" value="${l.space?.angle ?? (p.spaceAzimuth ?? 0)}" title="Where this layer sits around you"/></label>
          <label class="sp-ctl">Dist <input type="range" data-layer-dist="${l.id}" min="0.3" max="30" step="0.1" value="${l.space?.dist ?? (p.spaceDistance ?? 2.5)}" title="How far away this layer stands"/></label>
          <button class="pal-btn layer-solo${l.solo ? " on" : ""}" data-layer-solo="${l.id}" title="Solo this layer — hear it alone (the base and other unsoloed layers go quiet)">S</button>
          <button class="pal-btn" data-layer-recapture="${l.id}" title="Re-capture the CURRENT sound half into this layer (a layer is a snapshot — reshape the sound above, then update the layer)">⟳</button>
          <button class="pal-btn" data-layer-remove="${l.id}" title="Remove this layer">×</button>
        </div>
        <div class="layer-env" title="This layer's envelope baseline: variation chance and each parameter's mean ± magnitude. While synchronised, the chance and the ± magnitudes come from the shared panel (same for every layer); the means stay the layer's own.">${esc(envStr)}</div>
      </div>
    </div>`;
  }).join("");
  const syncOn = !!p.layerEnvOverride;
  return `
    <div class="layer-strip" id="layerStrip">
      <span class="layer-strip-label" title="${esc(PARAM_DESC.layers)}">LAYERS</span>
      <button class="layer-add" id="layerAdd" title="Add the current sub-note module (sound half) as a new layer underneath">＋</button>
      ${layers.length ? "" : `<span class="layer-strip-note">＋ captures the current sound as a layer — or drag a preset from the browser below (its sound comes across; the shared room and head stay yours)</span>`}
    </div>
    ${layers.length ? `
    <div class="layer-area">
      <div class="layer-rows">${rows}</div>
      <div class="layer-sync">
        <div class="subsection-label">Synchronised variation</div>
        <label class="layer-env-sync" title="${esc(PARAM_DESC.layerEnvOverride)}">
          <input type="checkbox" id="layerEnvSync"${syncOn ? " checked" : ""}/> variations fire together
        </label>
        <div class="layer-sync-body${syncOn ? "" : " off"}">
          ${controlRow("layerEnvProb", "Chance", p.layerEnvProb ?? 0.5, 0, 1, 0.01)}
          ${controlRow("layerEnvAttackSd", "Attack SD", p.layerEnvAttackSd ?? 0.015, 0, 0.12, 0.001)}
          ${controlRow("layerEnvDecaySd", "Decay SD", p.layerEnvDecaySd ?? 0.04, 0, 0.25, 0.001)}
          ${controlRow("layerEnvSustainSd", "Sustain SD", p.layerEnvSustainSd ?? 0.08, 0, 0.45, 0.01)}
          ${controlRow("layerEnvReleaseSd", "Release SD", p.layerEnvReleaseSd ?? 0.05, 0, 0.3, 0.001)}
          <div class="ch-caption">one roll per note triggers the envelope variation on the base sound and every layer AT ONCE, at these shared magnitudes — each still varies around its own means (shown on its row)</div>
        </div>
      </div>
    </div>` : ""}`;
}

// The tiny head-relation diagram on each layer row.
function drawLayerMiniPads() {
  (exploreParams.layers || []).forEach(l => {
    const cv = document.querySelector(`[data-layer-pad="${l.id}"]`);
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, rMax = Math.min(w, h) / 2 - 3;
    ctx.fillStyle = "rgba(60,72,88,0.22)";
    ctx.beginPath(); ctx.arc(cx, cy, rMax, 0, Math.PI); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(90,110,130,0.4)";
    ctx.beginPath(); ctx.arc(cx, cy, rMax, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = "rgba(200,215,230,0.9)";
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 2 * Math.PI); ctx.fill();
    const angle = l.space?.angle ?? (exploreParams.spaceAzimuth ?? 0);
    const dist = l.space?.dist ?? (exploreParams.spaceDistance ?? 2.5);
    const r = _spaceDistToR(clamp(dist, SPACE_DMIN, SPACE_DMAX), rMax);
    const rad = (angle - 90) * Math.PI / 180;
    ctx.fillStyle = `hsl(${l.hue ?? 36}, 70%, 62%)`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(rad) * r, cy + Math.sin(rad) * r, 3, 0, 2 * Math.PI); ctx.fill();
  });
}

function subnotePresetLabel(p = exploreParams) {
  const custom = String(p.spectralProfileName || "").trim();
  if (custom) return custom;
  return (SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin).label;
}

function subnoteWorkspaceHTML(p) {
  const formantMode = isFormantMode(p);
  const fourierDisabled = formantMode ? " mode-disabled" : "";
  const formantDisabled = formantMode ? "" : " mode-disabled";
  const title = subnotePresetLabel(p);
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
              <div class="ch-title-block">
                <h2 class="ch-preset-title" id="chPresetTitle" title="Double-click to rename this sound">${esc(title)}</h2>
                ${_chLayerEdit ? `<span class="layer-edit-tag">editing layer ${(p.layers || []).findIndex(l => l.id === _chLayerEdit.layerId) + 1 || ""}</span>` : ""}
              </div>
              ${_chLayerEdit ? `<button class="btn btn-primary btn-sm" id="layerEditDone" title="Save this sound back into the layer and return to the base sound">Done — back to base</button>` : ""}
              <!-- Owner 07-08: no preset dropdown or mix slider here — the
                   instrument cards below are the one place a recipe is
                   chosen, and spectralMix is a legacy blend (in the fourier
                   voice it is only a flat gain on the tone print), so it
                   rides along in presets without a control. -->
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
              <div class="ch-inspector ch-${_chStage}" id="chInspector" style="--ch-w:${_studioPanels.chW}px">${chInspectorHTML(p)}</div>
              <div class="ch-vsplit" id="chVSplit" title="Drag to resize the inspector"></div>
              <div class="ch-field-wrap">
                <div class="td-field-head">
                  <span class="td-field-title"><span class="td-stage-word ch-${_chStage}-word">${_chStage[0].toUpperCase()}${_chStage.slice(1)}</span> — ${_chStage === "space" ? "Ear Response" : "Partial Field"}</span>
                </div>
                ${_chStage === "space" ? `
                <!-- V2 spatial stage (renders phase-04): the field IS the
                     stage. Sources = base sound + layers; the only per-
                     layer space property is position (owner 07-08). The
                     binaural analysis strip below follows the SELECTED
                     source live. -->
                <!-- V2.2 (owner): no chip strip above the stage — the layer
                     rows below are the one list; dots + rows share selection -->
                <div class="ch-field-pos stage-pos">
                  <canvas id="cvStageBig" title="The stage around your head, seen from above — front is up, the shaded half is behind you. Drag a numbered dot to place that source; rings are metres away."></canvas>
                </div>
                ${stageReadoutsHTML(p)}
                <div class="ch-focus-row"><span class="ch-focus-label">EARS</span><span class="ch-focus-sum">what the selected source hands to each ear — arrival on the left, colouring on the right</span></div>
                <div class="ch-field-pos">
                  <canvas id="cvSpaceField" width="1200" height="170" style="width:100%;height:170px" title="Left: when the sound arrives — the direct hit, then the room's tail (the inset zooms the sub-millisecond gap between your ears). Right: how it's coloured — each ear's frequency response from head shadow, pinna, air and proximity."></canvas>
                </div>` : `
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
                <div class="ch-strip" id="chStrip"></div>`}
              </div>
              <div class="td-side${fourierDisabled}" data-sound-path="fourier" aria-disabled="${formantMode}">
                ${tdSidePanelHTML(p)}
              </div>
            </div>
            <div class="ch-status">${_chStage === "space"
              ? `<span>curves follow the pad and knobs live · <b>L</b> ear blue · <b>R</b> ear amber</span><span class="ch-status-right">binaural laws: Woodworth · Brown-Duda · Shaw</span>`
              : `<span><b>drag</b> a stem = level · <b>click</b> = pin readout · <b>brush</b> the lens to focus · knobs drag vertically, double-click resets</span><span class="ch-status-right">display = engine truth · log-f axis</span>`}</div>
            ${layerStripHTML(p) /* V2.2: full rows on every stage — the space rows ARE the source list */}
            ${m2PresetStripHTML(false) /* owner 07-08: ONE browser is the whole selection surface — sound modules + recipes to click or drag onto LAYERS; save lives in the top bar */}
          </div>
        `}

      </div>
    </div>
  `;
}

// ── V2 right column: Envelope / Modulation panel ────────────────────
// One panel, two tabs. Envelope keeps the interactive ADSR canvas (the
// .adsr-edit wiring is class-based) with big A/D/S/R readouts under it —
// the same #out_<param> ids the canvas drag already updates. Modulation
// gathers the per-note movement sources that used to hide inside the
// excitor's Performance drawer, as FabFilter-style routing rows.
function tdSidePanelHTML(p) {
  return `
    <div class="td-tabs" id="tdTabs">
      <button class="td-tab${_tdSideTab === "envelope" ? " active" : ""}" data-td-tab="envelope">Envelope</button>
      <button class="td-tab${_tdSideTab === "modulation" ? " active" : ""}" data-td-tab="modulation">Modulation</button>
    </div>
    ${_tdSideTab === "envelope" ? tdEnvelopeTabHTML(p) : tdModulationTabHTML(p)}`;
}

function tdEnvelopeTabHTML(p) {
  return `
    <canvas class="envelope-canvas js-envelope-canvas adsr-edit" width="300" height="128" title="Drag the corners: attack peak, decay→sustain corner (vertical = sustain level), release foot"></canvas>
    <div class="adsr-readouts">
      <div><span class="adsr-k">A</span><output id="out_envelopeAttack">${fmtOutput("envelopeAttack", p.envelopeAttack)}</output></div>
      <div><span class="adsr-k">D</span><output id="out_envelopeDecay">${fmtOutput("envelopeDecay", p.envelopeDecay)}</output></div>
      <div><span class="adsr-k">S</span><output id="out_envelopeSustain">${fmtOutput("envelopeSustain", p.envelopeSustain)}</output></div>
      <div><span class="adsr-k">R</span><output id="out_envelopeRelease">${fmtOutput("envelopeRelease", p.envelopeRelease)}</output></div>
    </div>
    ${controlRow("envelopeProb", "Variation chance", p.envelopeProb, 0, 1, 0.01)}
    <details class="formant-detail">
      <summary title="Per-note variation: each parameter is a distribution — the mean is the shape above, the SD is how far a note may stray from it">Variation (SD per note)</summary>
      <div class="controls-grid">
        ${controlRow("envelopeAttackSd", "Attack SD", p.envelopeAttackSd, 0, 0.12, 0.001)}
        ${controlRow("envelopeDecaySd", "Decay SD", p.envelopeDecaySd, 0, 0.25, 0.001)}
        ${controlRow("envelopeSustainSd", "Sustain SD", p.envelopeSustainSd, 0, 0.45, 0.01)}
        ${controlRow("envelopeReleaseSd", "Release SD", p.envelopeReleaseSd, 0, 0.3, 0.001)}
      </div>
    </details>`;
}

// Owner feedback 2026-07-08: the "LFO 1 / LFO 2 / Env 2 / Keytrack"
// routing rows were confusing — and slightly dishonest, since vibrato
// here is a per-note probability draw, not a free-running LFO. The tab
// keeps its place in the right panel, but the CONTENT is the old
// presentation: the vibrato block (chance/depth/rate sliders + the
// wobble trace) and the old Dynamics control.
function tdModulationTabHTML(p) {
  return `
    <div class="section-label">Vibrato</div>
    ${vibratoBlockHTML(p)}
    <div class="section-label">Dynamics</div>
    <div class="controls-grid">
      ${controlRow("spectralDynamicAmount", "Dynamics", p.spectralDynamicAmount, 0, 1.5, 0.01)}
    </div>
    <div class="ch-caption">vibrato is a per-note draw — Chance decides whether a note gets it, Depth and Rate shape the wobble the trace shows. Dynamics is how strongly louder playing brightens the spectrum.</div>`;
}

// ── Sub-note browser card art ────────────────────────────────────────
// Each sound-module card draws its own partial recipe — honest data, no
// stock art. Recipes draw from the profile; saved modules from their own
// captured partial means (falling back to their profile's recipe).
function drawM2SoundArt() {
  document.querySelectorAll("[data-m2-sound-art]").forEach(cv => {
    const id = cv.dataset.m2SoundArt;
    let amps = null;
    if (id.startsWith("r:")) {
      amps = SPECTRAL_PROFILES[id.slice(2)]?.partials.map(pt => profilePartial(pt).amp || 0);
    } else {
      const params = m2PresetParamsById(id);
      amps = Array.isArray(params?.spectralPartialMeans) && params.spectralPartialMeans.length
        ? params.spectralPartialMeans
        : SPECTRAL_PROFILES[params?.spectralProfile]?.partials.map(pt => profilePartial(pt).amp || 0);
    }
    if (!amps || !amps.length) return;
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const sel = cv.closest(".m2-preset")?.classList.contains("sel");
    const n = Math.min(20, amps.length);
    const pad = 8, base = h - 5;
    for (let i = 0; i < n; i++) {
      const amp = Math.max(0, amps[i] || 0);
      const x = pad + (w - pad * 2) * (n > 1 ? i / (n - 1) : 0.5);
      const y = base - Math.pow(amp, 0.4) * (h - 10);
      ctx.strokeStyle = sel ? "rgba(61,157,246,0.85)" : "rgba(120,140,165,0.55)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = sel ? "#3d9df6" : "rgba(150,170,195,0.8)";
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 2 * Math.PI); ctx.fill();
    }
  });
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
  // Only the Fourier/harmonic stage heading reflects the instrument label.
  // Scope to .harmonic-stage so this never clobbers the formant-stage heading
  // (which shows the vowel space) when in formant mode.
  const title = card.querySelector(".harmonic-stage .ch-preset-title");
  if (title) title.textContent = subnotePresetLabel(exploreParams);
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

function wireSubnoteTitle(v) {
  const title = v.querySelector("#chPresetTitle");
  if (!title) return;
  title.ondblclick = () => {
    const input = document.createElement("input");
    input.className = "ch-title-edit";
    input.value = subnotePresetLabel(exploreParams);
    input.maxLength = 48;
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const next = input.value.trim();
        const prev = exploreParams.spectralProfileName;
        if (next) {
          noteParamChange("spectralProfileName", prev, next);
          exploreParams.spectralProfileName = next;
        } else if (prev) {
          noteParamChange("spectralProfileName", prev, "");
          delete exploreParams.spectralProfileName;
        }
      }
      renderExplore();
    };
    input.onkeydown = (e) => {
      if (e.key === "Enter") commit(true);
      if (e.key === "Escape") commit(false);
    };
    input.onblur = () => commit(true);
  };
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

// Owner 07-07: the scale is a CIRCLE — one octave around the ring, degree
// 0 at 12 o'clock. Click a node to cycle its role (off → scale → sub →
// root, as before); when a tuning system offsets a degree from the equal
// grid, the node slides around the ring by its cents and shows them —
// drag a node around the ring to adjust its pitch centre by hand,
// double-click to snap it back to the grid.
const NOTE_CIRCLE_R = 96;
function buildNoteGridHTML(p) {
  const isEDO = p.scaleMode === "edo";
  const divisions = isEDO ? (p.edoDivisions || 12) : 12;
  const customDeg = p.customDegrees || [];
  const subNotes = p.subScaleNotes || [];
  const rootNotes = p.rootNotes || [];
  const tuning = p.degreeTuning || {};
  const size = NOTE_CIRCLE_R * 2 + 36;
  const c = size / 2;
  let html = `<div class="note-circle" style="width:${size}px;height:${size}px">`;
  html += `<div class="note-circle-ring" style="inset:${18 - 1}px"></div>`;
  for (let d = 0; d < divisions; d++) {
    const name = (divisions === 12) ? NOTE_NAMES_12[d] : String(d);
    const inScale = customDeg.includes(d);
    const inSub = subNotes.includes(d) && inScale;
    const isRoot = rootNotes.includes(d) && inScale;
    const cents = Math.round(tuning[d] || 0);
    let cls = "note-cell";
    if (isRoot) cls += " is-root";
    else if (inSub) cls += " in-sub";
    else if (inScale) cls += " in-scale";
    if (cents) cls += " tuned";
    // the node's TRUE position: grid angle + its cent offset (one octave
    // = a full turn, so angle = 2π · sounding-pitch / octave)
    const angle = 2 * Math.PI * (d / divisions + cents / 1200) - Math.PI / 2;
    const x = c + Math.cos(angle) * NOTE_CIRCLE_R;
    const y = c + Math.sin(angle) * NOTE_CIRCLE_R;
    html += `<div class="${cls}" data-degree="${d}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px"
      title="${name}: click cycles off → in scale → sub-scale → root · drag around the ring to move its pitch centre${cents ? ` (now ${cents > 0 ? "+" : ""}${cents}¢)` : ""} · double-click resets the tuning">${name}${cents ? `<span class="note-cents">${cents > 0 ? "+" : ""}${cents}</span>` : ""}</div>`;
  }
  html += "</div>";
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

// ═══ V2 SCALE LAB (render phase-09, 2026-07-08 redesign) ═══════════
// A dedicated tuning workshop as a third workspace tab. It edits the
// SAME scale state the macro wheel uses (scaleMode, edoDivisions,
// customDegrees, subScaleNotes, rootNotes, degreeTuning) — one truth.

let _slSel = 0;                            // selected degree (inspector)
let _slView = { ratios: true, grid: true };
let _slSearch = "";
let _slPresetSel = null;

function _slDivisions(p) { return p.scaleMode === "edo" ? (p.edoDivisions || 12) : 12; }
function _slCents(p, d) { return d * 1200 / _slDivisions(p) + ((p.degreeTuning || {})[d] || 0); }
function _slFreq(p, d) { return (p.tonicHz || 261.63) * Math.pow(2, _slCents(p, d) / 1200); }

// Nearest simple just ratio (within the octave) for a cents value.
function _slRatio(cents) {
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  let best = null, bestErr = 30;
  for (let q = 1; q <= 16; q++) {
    for (let n = q; n <= q * 2; n++) {
      if (gcd(n, q) !== 1) continue;
      const err = Math.abs(1200 * Math.log2(n / q) - cents);
      if (err < bestErr) { best = [n, q]; bestErr = err; }
    }
  }
  return best ? { txt: `${best[0]}/${best[1]}`, err: bestErr, val: best[0] / best[1] } : null;
}

function _slDegreeStatus(p, d) {
  if ((p.rootNotes || []).includes(d)) return "root";
  if ((p.subScaleNotes || []).includes(d)) return "sub";
  if ((p.customDegrees || []).includes(d)) return "scale";
  return "off";
}

function slSetStatus(p, d, status) {
  p.customDegrees = [...(p.customDegrees || [])];
  p.subScaleNotes = [...(p.subScaleNotes || [])];
  p.rootNotes = [...(p.rootNotes || [])];
  const rm = (arr) => arr.filter(x => x !== d);
  if (status === "off") {
    const remaining = rm(p.customDegrees);
    if (remaining.length) {         // never empty the scale
      p.customDegrees = remaining;
      p.subScaleNotes = rm(p.subScaleNotes);
      p.rootNotes = rm(p.rootNotes);
    }
  } else {
    if (!p.customDegrees.includes(d)) p.customDegrees.push(d);
    if (status === "sub") {
      if (!p.subScaleNotes.includes(d)) p.subScaleNotes.push(d);
      p.rootNotes = rm(p.rootNotes);
    } else if (status === "root") {
      if (!p.rootNotes.includes(d)) p.rootNotes.push(d);
      p.subScaleNotes = rm(p.subScaleNotes);
    } else {
      p.subScaleNotes = rm(p.subScaleNotes);
      p.rootNotes = rm(p.rootNotes);
    }
  }
  p.customDegrees.sort((a, b) => a - b);
  if (!p.rootNotes.length) p.rootNotes = [p.customDegrees[0] ?? 0];
}

function slPresets() {
  const all = (n) => Array.from({ length: n }, (_, i) => i);
  const list = [];
  const edoEntry = (n) => ({
    id: `edo${n}`, label: `${n}-EDO Equal Temperament`, tag: `${n}-EDO`,
    desc: `${n} equal divisions of the octave — ${(1200 / n).toFixed(1)}¢ per step`,
    apply: (p) => {
      p.scaleMode = n === 12 ? "12tone" : "edo";
      p.edoDivisions = n;
      p.customDegrees = all(n);
      p.subScaleNotes = []; p.rootNotes = [0]; p.degreeTuning = null;
    },
  });
  list.push(edoEntry(12));
  for (const [k, s] of Object.entries(SCALE_PRESETS)) {
    list.push({
      id: `sp:${k}`, label: s.label || k, tag: "12-EDO",
      desc: `12-tone ${s.label || k} scale`,
      apply: (p) => {
        p.scaleMode = "12tone"; p.edoDivisions = 12; p.scalePreset = k;
        p.customDegrees = [...s.degrees];
        p.subScaleNotes = []; p.rootNotes = [s.degrees[0] ?? 0]; p.degreeTuning = null;
      },
    });
  }
  for (const [k, s] of Object.entries(CULTURAL_SCALES)) {
    list.push({
      id: `cs:${k}`, label: s.label, tag: `${s.edo}-EDO`, desc: s.description,
      apply: (p) => {
        p.scaleMode = s.edo === 12 ? "12tone" : "edo";
        p.edoDivisions = s.edo;
        p.customDegrees = [...s.degrees];
        p.subScaleNotes = [...(s.sub || [])];
        p.rootNotes = [...(s.roots || [0])];
        p.degreeTuning = s.tuning ? { ...s.tuning } : null;
      },
    });
  }
  for (const n of [19, 24, 31, 53]) list.push(edoEntry(n));
  return list;
}

function slPresetListHTML(p) {
  const q = _slSearch.trim().toLowerCase();
  return slPresets()
    .filter(pr => !q || pr.label.toLowerCase().includes(q) || pr.tag.toLowerCase().includes(q))
    .map(pr => `
      <button class="sl-preset${_slPresetSel === pr.id ? " sel" : ""}" data-sl-preset="${pr.id}" title="${esc(pr.desc || pr.label)}">
        <span class="sl-preset-name">${esc(pr.label)}</span>
        <span class="sl-preset-tag">${esc(pr.tag)}</span>
      </button>`).join("");
}

// The radial wheel — degrees around the circle at their SOUNDING angle
// (grid position + cent offset), just-ratio spokes for reference.
const SL_R = 200, SL_C = 250;
function slWheelSVG(p) {
  const div = _slDivisions(p);
  if (_slSel >= div) _slSel = 0;
  const pol = (cents, r) => {
    const a = 2 * Math.PI * cents / 1200 - Math.PI / 2;
    return [SL_C + Math.cos(a) * r, SL_C + Math.sin(a) * r];
  };
  let s = `<svg id="slWheel" viewBox="0 0 ${SL_C * 2} ${SL_C * 2}" class="sl-wheel">`;
  s += `<circle cx="${SL_C}" cy="${SL_C}" r="${SL_R}" class="sl-ring"/>`;
  if (_slView.grid) {
    for (let d = 0; d < div; d++) {
      const [x, y] = pol(d * 1200 / div, SL_R);
      s += `<line x1="${SL_C}" y1="${SL_C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="sl-grid"/>`;
    }
  }
  if (_slView.ratios) {
    for (const [n, q] of [[1, 1], [9, 8], [6, 5], [5, 4], [4, 3], [7, 5], [3, 2], [8, 5], [5, 3], [16, 9], [15, 8]]) {
      const cents = 1200 * Math.log2(n / q);
      const [x2, y2] = pol(cents, SL_R * 0.72);
      const [tx, ty] = pol(cents, SL_R * 0.8);
      s += `<line x1="${SL_C}" y1="${SL_C}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="sl-ratio"/>`;
      s += `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" class="sl-ratio-t">${n}/${q}</text>`;
    }
  }
  for (let d = 0; d < div; d++) {
    const st = _slDegreeStatus(p, d);
    const cents = _slCents(p, d);
    const [x, y] = pol(cents, SL_R);
    const name = div === 12 ? NOTE_NAMES_12[d] : String(d);
    const rr = st === "off" ? 9 : 14;
    s += `<g class="sl-node sl-${st}${_slSel === d ? " sl-sel" : ""}" data-sl-degree="${d}">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rr}"/>
      <text x="${x.toFixed(1)}" y="${(y + 3.5).toFixed(1)}">${name}</text>
    </g>`;
  }
  s += `</svg>`;
  return s;
}

function slInspectorHTML(p) {
  const d = _slSel;
  const div = _slDivisions(p);
  const st = _slDegreeStatus(p, d);
  const cents = _slCents(p, d);
  const off = (p.degreeTuning || {})[d] || 0;
  const hz = _slFreq(p, d);
  const ratio = _slRatio(((cents % 1200) + 1200) % 1200);
  const seg = (key, label) => `<button class="sl-st-btn sl-st-${key}${st === key ? " active" : ""}" data-sl-status="${key}">${label}</button>`;
  return `
    <div class="sl-ins-head"><span class="sl-deg-dot sl-${st}"></span> DEGREE <b>${d}</b> <span class="sl-ins-sub">of ${div}</span></div>
    <div class="sl-sec-label">Status</div>
    <div class="sl-st-row">${seg("scale", "In scale")}${seg("sub", "Sub-scale")}${seg("root", "Root")}${seg("off", "Off")}</div>
    <div class="sl-sec-label">Cents (offset from grid)</div>
    <div class="sl-cents-row">
      <input type="number" id="slCents" step="1" min="-60" max="60" value="${Math.round(off)}"/>
      <span class="sl-cents-abs">${cents.toFixed(1)}¢ absolute</span>
      ${off ? `<button class="sl-mini-btn" data-sl-cents-reset title="Back to the equal-tempered grid">↺</button>` : ""}
    </div>
    <div class="sl-sec-label">Sounding</div>
    <div class="sl-kv"><span>Ratio</span><b>${ratio ? `${ratio.txt}` : "—"}</b><span class="sl-kv-sub">${ratio ? `${ratio.val.toFixed(3)} : 1 · ±${ratio.err.toFixed(0)}¢` : ""}</span></div>
    <div class="sl-kv"><span>Note</span><b>${esc(noteAndCents(hz))}</b><span class="sl-kv-sub">${hz.toFixed(2)} Hz</span></div>
    <div class="sl-sec-label">Audition</div>
    <div class="sl-audition">
      <button class="btn btn-secondary btn-sm" data-sl-play="degree">▶ Play degree</button>
      <button class="btn btn-secondary btn-sm" data-sl-play="interval">Play interval to root</button>
    </div>
    <div class="sl-sec-label">Info</div>
    <div class="sl-kv"><span>EDO step</span><b>${d} / ${div}</b><span class="sl-kv-sub">${(1200 / div).toFixed(2)}¢ per step</span></div>
  `;
}

function scaleLabWorkspaceHTML(p) {
  const div = _slDivisions(p);
  return `
    <div class="card scalelab-card">
      <div class="sl-layout">
        <div class="sl-left">
          <div class="sl-title">Scale Lab</div>
          <div class="sl-sec-label">Tuning presets</div>
          <input type="search" id="slSearch" class="sl-search" placeholder="Search presets…" value="${esc(_slSearch)}"/>
          <div class="sl-preset-list" id="slPresetList">${slPresetListHTML(p)}</div>
          <div class="sl-sec-label">N-EDO</div>
          <div class="sl-edo-step">
            <button class="sl-mini-btn" data-sl-edo="-1" title="One fewer division of the octave">−</button>
            <b>${div} divisions</b>
            <button class="sl-mini-btn" data-sl-edo="1" title="One more division of the octave">＋</button>
          </div>
          <div class="sl-sec-label">Reference — degree 0</div>
          <div class="sl-ref-row">
            <input type="number" id="slTonic" step="0.01" min="55" max="1760" value="${(p.tonicHz || 261.63).toFixed(2)}"/> Hz
            <span class="sl-kv-sub">${esc(noteAndCents(p.tonicHz || 261.63))}</span>
          </div>
          <div class="sl-sec-label">View</div>
          <label class="sl-check"><input type="checkbox" id="slShowRatios"${_slView.ratios ? " checked" : ""}/> Show just ratios</label>
          <label class="sl-check"><input type="checkbox" id="slShowGrid"${_slView.grid ? " checked" : ""}/> Show EDO grid</label>
          <div class="sl-actions">
            <button class="btn btn-secondary btn-sm" id="slImport" title="Load a Scala .scl tuning file">⬆ Import Scala</button>
            <button class="btn btn-secondary btn-sm" id="slExport" title="Save the current scale as a Scala .scl file">⬇ Export</button>
            <input type="file" id="slFile" accept=".scl,text/plain" hidden/>
          </div>
        </div>
        <div class="sl-center">
          <div class="sl-center-head">
            <span class="sl-chip">${div}-EDO ${p.scaleMode === "12tone" ? "· 12-tone" : "· equal temperament"}</span>
            <span class="sl-chip sl-chip-info">${div} EDO steps · ${(1200 / div).toFixed(3)}¢ per step</span>
          </div>
          ${slWheelSVG(p)}
          <div class="sl-legend">
            <span><i class="sl-leg sl-root"></i> Root</span>
            <span><i class="sl-leg sl-sub"></i> Sub-scale</span>
            <span><i class="sl-leg sl-scale"></i> In scale</span>
            <span><i class="sl-leg sl-off"></i> Off</span>
          </div>
        </div>
        <div class="sl-right" id="slInspector">${slInspectorHTML(p)}</div>
      </div>
      <div class="sl-keys-wrap">
        <div class="sl-sec-label">Keyboard mapping — where the scale lands on a piano axis (C3–C6)</div>
        <canvas id="slKeys" width="1200" height="90" style="width:100%;height:90px"></canvas>
      </div>
    </div>`;
}

function drawSlKeys() {
  const cv = document.getElementById("slKeys");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const p = exploreParams;
  const loMidi = 48, hiMidi = 84; // C3..C6
  const keyW = w / (hiMidi - loMidi);
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  for (let m = loMidi; m < hiMidi; m++) {
    const x = (m - loMidi) * keyW;
    ctx.fillStyle = isBlack(m) ? "#161a21" : "#252a33";
    ctx.fillRect(x + 0.5, 0, keyW - 1, h - 22);
    if (m % 12 === 0) {
      ctx.fillStyle = "rgba(120,135,150,0.7)";
      ctx.font = "9px ui-monospace, monospace";
      ctx.fillText(`C${m / 12 - 1}`, x + 2, h - 26);
    }
  }
  const colFor = { root: "#8b7cf6", sub: "#4caf7d", scale: "#9aa0ab" };
  for (const d of (p.customDegrees || [])) {
    const st = _slDegreeStatus(p, d);
    for (let oct = -2; oct <= 2; oct++) {
      const hz = _slFreq(p, d) * Math.pow(2, oct);
      const midi = 69 + 12 * Math.log2(hz / 440);
      if (midi < loMidi || midi >= hiMidi) continue;
      const x = (midi - loMidi) * keyW + keyW / 2;
      ctx.fillStyle = colFor[st] || colFor.scale;
      ctx.beginPath(); ctx.arc(x, h - 10, st === "root" ? 5 : 3.5, 0, 2 * Math.PI); ctx.fill();
    }
  }
}

let _slAudCtx = null;
function slPlayFreqs(freqs) {
  const ac = (synth && synth.ctx) || (_slAudCtx ||= new (window.AudioContext || window.webkitAudioContext)());
  if (ac.state === "suspended") ac.resume();
  const t0 = ac.currentTime + 0.03;
  freqs.forEach((f, i) => {
    const t = t0 + i * 0.5;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.46);
    o.connect(g); g.connect(ac.destination);
    o.start(t); o.stop(t + 0.5);
  });
}

function slExportScl(p) {
  const div = _slDivisions(p);
  const degs = (p.customDegrees || []).filter(d => d > 0).sort((a, b) => a - b);
  const lines = [
    "! sound-studio.scl", "!",
    `Sound Studio scale — ${degs.length + 1} notes from ${div}-EDO`,
    ` ${degs.length + 1}`, "!",
    ...degs.map(d => ` ${_slCents(p, d).toFixed(5)}`),
    " 2/1", "",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sound-studio.scl";
  a.click();
  URL.revokeObjectURL(a.href);
}

function slImportScl(text, p) {
  // Scala format: comment lines start with '!'; first data line is the
  // description, second the note count, then one pitch per line (cents
  // if it contains '.', else a ratio).
  const data = text.split(/\r?\n/).filter(l => !l.trim().startsWith("!"));
  const vals = [];
  for (let i = 2; i < data.length; i++) {
    const tok = data[i].trim().split(/\s+/)[0];
    if (!tok) continue;
    let cents = null;
    if (tok.includes(".")) cents = parseFloat(tok);
    else if (tok.includes("/")) {
      const [n, q] = tok.split("/").map(Number);
      if (n > 0 && q > 0) cents = 1200 * Math.log2(n / q);
    } else if (/^\d+$/.test(tok)) cents = 1200 * Math.log2(Number(tok));
    if (Number.isFinite(cents)) vals.push(cents);
  }
  if (!vals.length) return false;
  // Last value is the octave; the steps within it become the new grid.
  const inOctave = vals.filter(c => c > 0 && c < 1199.5);
  const div = inOctave.length + 1;
  const step = 1200 / div;
  const tuning = {};
  inOctave.sort((a, b) => a - b).forEach((c, i) => {
    const d = i + 1;
    const off = c - d * step;
    if (Math.abs(off) > 0.5) tuning[d] = Math.round(off * 10) / 10;
  });
  p.scaleMode = div === 12 && !Object.keys(tuning).length ? "12tone" : "edo";
  p.edoDivisions = div;
  p.customDegrees = Array.from({ length: div }, (_, i) => i);
  p.subScaleNotes = [];
  p.rootNotes = [0];
  p.degreeTuning = Object.keys(tuning).length ? tuning : null;
  return true;
}

function wireScaleLab(v) {
  if (!v.querySelector("#slWheel")) return;
  const p = exploreParams;
  const applyScale = () => {
    syncSurpriseFeatureParams?.(p);
    synth.updateGenerationParams({ ...p });
    debouncedReplay();
    renderExplore();
  };
  const list = v.querySelector("#slPresetList");
  if (list) list.onclick = (e) => {
    const btn = e.target.closest("[data-sl-preset]");
    if (!btn) return;
    const pr = slPresets().find(x => x.id === btn.dataset.slPreset);
    if (!pr) return;
    pr.apply(p);
    _slPresetSel = pr.id;
    _slSel = 0;
    noteParamChange("scalePreset", null, pr.id);
    applyScale();
  };
  const search = v.querySelector("#slSearch");
  if (search) search.oninput = () => {
    _slSearch = search.value;
    const l = v.querySelector("#slPresetList");
    if (l) l.innerHTML = slPresetListHTML(p);
  };
  v.querySelectorAll("[data-sl-edo]").forEach(btn => {
    btn.onclick = () => {
      const next = clamp(_slDivisions(p) + Number(btn.dataset.slEdo), 3, 53);
      p.scaleMode = "edo";
      p.edoDivisions = next;
      p.customDegrees = Array.from({ length: next }, (_, i) => i);
      p.subScaleNotes = [];
      p.rootNotes = [0];
      p.degreeTuning = null;
      _slPresetSel = null;
      _slSel = Math.min(_slSel, next - 1);
      applyScale();
    };
  });
  const tonic = v.querySelector("#slTonic");
  if (tonic) tonic.onchange = () => {
    const hz = clamp(Number(tonic.value) || 261.63, 55, 1760);
    noteParamChange("tonicHz", p.tonicHz, hz);
    p.tonicHz = hz;
    applyScale();
  };
  const ratios = v.querySelector("#slShowRatios");
  if (ratios) ratios.onchange = () => { _slView.ratios = ratios.checked; renderExplore(); };
  const grid = v.querySelector("#slShowGrid");
  if (grid) grid.onchange = () => { _slView.grid = grid.checked; renderExplore(); };
  const wheel = v.querySelector("#slWheel");
  if (wheel) wheel.onclick = (e) => {
    const node = e.target.closest("[data-sl-degree]");
    if (!node) return;
    _slSel = Number(node.dataset.slDegree);
    renderExplore();
  };
  v.querySelectorAll("[data-sl-status]").forEach(btn => {
    btn.onclick = () => {
      slSetStatus(p, _slSel, btn.dataset.slStatus);
      applyScale();
    };
  });
  const cents = v.querySelector("#slCents");
  if (cents) cents.onchange = () => {
    const val = clamp(Number(cents.value) || 0, -60, 60);
    p.degreeTuning = { ...(p.degreeTuning || {}) };
    if (val) p.degreeTuning[_slSel] = val; else delete p.degreeTuning[_slSel];
    if (!Object.keys(p.degreeTuning).length) p.degreeTuning = null;
    applyScale();
  };
  const centsReset = v.querySelector("[data-sl-cents-reset]");
  if (centsReset) centsReset.onclick = () => {
    if (p.degreeTuning) {
      p.degreeTuning = { ...p.degreeTuning };
      delete p.degreeTuning[_slSel];
      if (!Object.keys(p.degreeTuning).length) p.degreeTuning = null;
    }
    applyScale();
  };
  v.querySelectorAll("[data-sl-play]").forEach(btn => {
    btn.onclick = () => {
      const root = (p.rootNotes || [0])[0] ?? 0;
      if (btn.dataset.slPlay === "degree") slPlayFreqs([_slFreq(p, _slSel)]);
      else slPlayFreqs([_slFreq(p, root), _slFreq(p, _slSel)]);
    };
  });
  const exp = v.querySelector("#slExport");
  if (exp) exp.onclick = () => slExportScl(p);
  const imp = v.querySelector("#slImport");
  const file = v.querySelector("#slFile");
  if (imp && file) {
    imp.onclick = () => file.click();
    file.onchange = () => {
      const f = file.files && file.files[0];
      if (!f) return;
      f.text().then(text => {
        if (slImportScl(text, p)) { _slPresetSel = null; _slSel = 0; applyScale(); }
      });
    };
  }
  drawSlKeys();
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
  // How hard the melody is pulled home across one motif phrase: the exact
  // curve the engine samples (strength × (1−shape+shape·pos)), annotated
  // with the start/end pull values and beat ticks so the shape dial reads
  // as "when the pull kicks in", not an abstract wiggle.
  const cv = document.getElementById("cvRoot");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const strength = clamp(exploreParams.rootPullStrength ?? 0, 0, 1);
  const shape = clamp(exploreParams.rootPullShape ?? 0, 0, 1);
  const padT = 13, padB = 13;
  const plotH = h - padT - padB;
  const yOf = (pull) => padT + (1 - pull) * plotH;
  const pullAt = (pos) => strength * (1 - shape + shape * pos);

  // beat ticks: the phrase in motif-length beats, so "end of phrase" is real
  const beats = Math.max(1, Math.round(exploreParams.motifLengthBeats || 4));
  ctx.strokeStyle = "rgba(96,110,130,0.16)";
  ctx.lineWidth = 1;
  for (let b = 1; b < beats; b++) {
    const x = (b / beats) * w;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke();
  }
  // full-strength reference line
  ctx.strokeStyle = "rgba(245,158,11,0.25)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, yOf(strength)); ctx.lineTo(w, yOf(strength)); ctx.stroke();
  ctx.setLineDash([]);

  if (strength <= 0.001) {
    ctx.fillStyle = "rgba(136,153,170,0.55)";
    ctx.font = "9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("no pull — the melody wanders freely", w / 2, h / 2 + 3);
    ctx.textAlign = "left";
    return;
  }

  // the engine's curve
  ctx.fillStyle = "rgba(245,158,11,0.10)";
  ctx.strokeStyle = "rgba(245,158,11,0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h - padB);
  for (let x = 0; x <= w; x++) ctx.lineTo(x, yOf(pullAt(x / w)));
  ctx.lineTo(w, h - padB);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const y = yOf(pullAt(x / w));
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  // end-point values: the numbers the dial is actually setting
  const pct = (v) => `${Math.round(v * 100)}%`;
  ctx.font = "600 9px system-ui";
  ctx.fillStyle = "#f5a623";
  ctx.textAlign = "left";
  ctx.fillText(pct(pullAt(0)), 3, yOf(pullAt(0)) - 3);
  ctx.textAlign = "right";
  ctx.fillText(pct(pullAt(1)), w - 3, Math.max(9, yOf(pullAt(1)) - 3));

  // axis: where in the phrase we are
  ctx.fillStyle = "rgba(136,153,170,0.7)";
  ctx.font = "9px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("phrase start", 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText(`phrase end (${beats} beats)`, w - 2, h - 2);
  ctx.textAlign = "center";
  const summary = shape < 0.15 ? "pull is constant" : shape > 0.85 ? "pull arrives at the cadence" : "pull grows toward the end";
  ctx.fillStyle = "rgba(170,185,200,0.75)";
  ctx.fillText(summary, w / 2, 9);
  ctx.textAlign = "left";
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

// Owner 07-07: the diagram ILLUSTRATES the parameters — a row of literal
// notes whose endings show what the settings do. Positive gap = the bar
// stops early and silence shows; negative gap = the bar reaches into the
// next note (overlap) and either a glide arc (mono) or a stacked ring bar
// (multiphonic) shows the connection. Gaps grow across the row by the
// distance slope; whiskers at each boundary show the timing range; the
// marker opacity follows the chance.
function drawGapDist() {
  const cv = document.getElementById("cvGap");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);

  const minGap = Math.min(exploreParams.gapMin ?? 0, exploreParams.gapMax ?? 0);
  const maxGap = Math.max(exploreParams.gapMin ?? 0, exploreParams.gapMax ?? 0);
  const slope = clamp(exploreParams.gapDistanceSlope ?? 0, 0, 1);
  const range = clamp(exploreParams.gapTimingRange ?? 0, 0, 0.4);
  const chance = clamp(exploreParams.gapProb ?? 1, 0, 1);
  const ring = (exploreParams.noteConnection || "glide") === "ring";
  const speed = clamp(exploreParams.slideSpeed ?? 0.65, 0, 1);

  const n = 6;                       // six notes tell the story
  const padX = 8, labelH = 11;
  const slotW = (w - padX * 2) / n;
  const barH = Math.max(8, h * 0.3);
  const yHi = labelH + 4;            // two alternating pitch rows so glides
  const yLo = yHi + barH * 0.85;     // have somewhere to go
  const alpha = 0.25 + chance * 0.7; // the CHANCE any pair gets a gap at all

  const gapAt = (t) => {             // min→max blend, straightened by slope
    const even = (minGap + maxGap) / 2;
    const sloped = minGap + (maxGap - minGap) * t;
    return clamp(even * (1 - slope) + sloped * slope, -0.9, 0.9);
  };

  for (let i = 0; i < n; i++) {
    const x0 = padX + i * slotW;
    const hiRow = i % 2 === 0;
    const y = hiRow ? yHi : yLo;
    const g = i < n - 1 ? gapAt(i / (n - 2)) : 0;
    const soundW = slotW * (1 - Math.max(0, g)); // positive gap stops early
    const overlapW = Math.max(0, -g) * slotW;    // negative gap reaches on

    // the note body (+ its reach into the next slot when overlapping)
    ctx.fillStyle = "rgba(245,166,35,0.8)";
    ctx.fillRect(x0, y, Math.max(3, soundW - 1.5), barH * 0.5);
    if (i < n - 1 && overlapW > 1) {
      ctx.fillStyle = `rgba(245,166,35,${0.35 * alpha})`;
      ctx.fillRect(x0 + slotW, y, overlapW, barH * 0.5);
    }

    if (i < n - 1) {
      const nextY = hiRow ? yLo : yHi;
      const bx = x0 + slotW; // the next note's onset
      if (g > 0.02) {
        // GAP: visible silence before the next onset
        ctx.strokeStyle = `rgba(136,153,170,${0.5 * alpha})`;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x0 + soundW, y + barH * 0.25);
        ctx.lineTo(bx, y + barH * 0.25);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (g < -0.02) {
        if (ring) {
          // RING: both keep sounding at their own pitch — nothing bends
          ctx.strokeStyle = `rgba(96,165,250,${0.9 * alpha})`;
          ctx.strokeRect(bx + 0.5, nextY - 2.5, overlapW, 2);
        } else {
          // GLIDE: pitch slides from this note into the next over the
          // overlap — arc length/steepness follows the slide speed
          const reach = overlapW * (0.35 + speed * 0.65);
          ctx.strokeStyle = `rgba(96,165,250,${0.9 * alpha})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(bx, y + barH * 0.25);
          ctx.quadraticCurveTo(bx + reach * 0.5, (y + nextY) / 2 + barH * 0.25, bx + reach, nextY + barH * 0.25);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      }
      // TIMING RANGE: the onset can wander this far around the boundary
      if (range > 0.005) {
        const rw = range * slotW;
        ctx.strokeStyle = "rgba(136,153,170,0.5)";
        ctx.beginPath();
        ctx.moveTo(bx - rw, nextY + barH * 0.62);
        ctx.lineTo(bx + rw, nextY + barH * 0.62);
        ctx.stroke();
      }
    }
  }

  ctx.fillStyle = "rgba(136,153,170,0.75)";
  ctx.font = "8px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(`${ring ? "ring: overlaps stack" : `glide: overlaps slide (speed ${speed.toFixed(2)})`} · chance ${Math.round(chance * 100)}%`, padX, h - 2);
  ctx.textAlign = "right";
  ctx.fillText("near intervals → far", w - padX, labelH - 3);
  ctx.textAlign = "left";
  ctx.fillText(`gap ${minGap.toFixed(2)} … ${maxGap.toFixed(2)}${range > 0.005 ? ` · timing ±${range.toFixed(2)}` : ""}`, padX, labelH - 3);
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
// V2 redesign (2026-07-08): right-column tab + stage bypass stash.
// BODY and SPACE can be switched off (their effect is a mix amount the
// engine already honours at 0); EXCITOR and RESONATOR are the sound
// itself, so their power buttons render disabled.
let _tdSideTab = "envelope";
const _chBypass = { body: null, space: null };

function stagePowerState(p, stage) {
  if (stage === "body") return (p.spectralResonanceAmount ?? 0.35) > 0.001;
  if (stage === "space") return (p.reverbWet ?? 0.16) > 0.001;
  return true; // excitor + resonator are always in the chain
}

function toggleStagePower(p, stage) {
  if (stage === "body") {
    if (stagePowerState(p, "body")) {
      _chBypass.body = p.spectralResonanceAmount ?? 0.35;
      p.spectralResonanceAmount = 0;
    } else {
      p.spectralResonanceAmount = _chBypass.body ?? 0.35;
    }
    return;
  }
  if (stage === "space") {
    if (stagePowerState(p, "space")) {
      _chBypass.space = p.reverbWet ?? 0.16;
      p.reverbWet = 0;
    } else {
      p.reverbWet = _chBypass.space ?? 0.16;
    }
  }
}

// One-line character name per stage — the card's headline, like the
// render's "Noise Burst / Modal Cluster / Wooden Cavity / Concert Hall".
function chStageHeadline(p, stage) {
  if (stage === "excitor") {
    const t = p.excitationType || "bow";
    const base = { bow: "Bowed", pluck: "Plucked", strike: "Struck", blow: "Blown" }[t] || t;
    return (p.attackNoiseLevel ?? 1) > 1.4 ? `${base} · noise burst` : base;
  }
  if (stage === "resonator") {
    const B = Number.isFinite(p.partialB) ? p.partialB : legacyStretchToB(p.spectralStretchCents || 0);
    return B > 0.0004 ? "Inharmonic cluster" : "Modal cluster";
  }
  if (stage === "body") {
    if (!p.bodyType || p.bodyType === "auto") {
      const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
      return `${profile.label} body`;
    }
    return BODY_PRESETS[p.bodyType]?.label || p.bodyType;
  }
  const prof = REVERB_PROFILES[p.reverbType] || REVERB_PROFILES.room;
  return prof.label;
}

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

const _POWER_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 1.5v6"/><path d="M4.2 3.6a5.5 5.5 0 1 0 7.6 0"/></svg>`;

function chRailCardHTML(p, stage, num, name) {
  const toggleable = stage === "body" || stage === "space";
  const on = stagePowerState(p, stage);
  const title = name[0] + name.slice(1).toLowerCase();
  return `
    <button class="ch-card ch-${stage}${_chStage === stage ? " active" : ""}${on ? "" : " stage-off"}" data-ch-stage="${stage}">
      <div class="ch-card-head">
        <span class="ch-card-n">${title}</span>
        <span class="ch-power${on ? " on" : ""}${toggleable ? "" : " always"}" ${toggleable
          ? `data-ch-power="${stage}" role="button" tabindex="0" title="Switch the ${title} stage ${on ? "off" : "on"}"`
          : `title="${title} is the sound itself — always in the chain"`}>${_POWER_SVG}</span>
      </div>
      <canvas class="ch-thumb" id="chThumb_${stage}" width="380" height="90"></canvas>
      <div class="ch-headline">${esc(chStageHeadline(p, stage))}</div>
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
    // Space audit 07-07: the envelope lives in the right column now (a
    // proper panel, always visible) — the excitor inspector is one
    // comfortable column again.
    return `
      <div class="ch-ins-head"><span class="ch-card-n">01 · EXCITOR</span><span class="ch-ins-d">how energy enters</span></div>
      <div class="seg-control" role="group">
        ${["bow", "pluck", "strike", "blow"].map(t =>
          `<button class="seg-btn${p.excitationType === t ? " active" : ""}" data-exc-type="${t}">${t[0].toUpperCase()}${t.slice(1)}</button>`).join("")}
      </div>
      <div class="ins-group">
        <div class="ins-group-label">Contact</div>
        <div class="knob-row">
          ${knobHTML("excitationPosition", "Position", p.excitationPosition, 0.02, 0.5, 0.01, { def: 0.13 })}
          ${knobHTML("excitationHardness", "Hardness", p.excitationHardness, 0, 1, 0.01, { def: 0.6 })}
        </div>
      </div>
      <div class="ins-group">
        <div class="ins-group-label">Character</div>
        <div class="knob-row">
          ${knobHTML("excitationHuman", "Human", p.excitationHuman, 0, 1, 0.01, { def: 0.4 })}
          ${knobHTML("toneBreath", "Breath", p.toneBreath, 0, 0.4, 0.01, { def: 0.03 })}
          ${knobHTML("attackNoiseLevel", "Onset noise", p.attackNoiseLevel ?? 1, 0, 2, 0.01, { def: 1 })}
        </div>
      </div>
      <canvas class="ch-string" id="cvStringDiag" width="400" height="56"></canvas>
      <div class="ch-caption">position decides which modes can be driven — a partial with a node under the ${p.excitationType === "strike" ? "hammer" : p.excitationType === "pluck" ? "finger" : p.excitationType === "blow" ? "jet" : "bow"} falls silent; watch the dips in the field. Envelope &amp; modulation live in the right panel →</div>`;
  }
  if (_chStage === "resonator") {
    return `
      <div class="ch-ins-head"><span class="ch-card-n">02 · RESONATOR</span><span class="ch-ins-d">what rings, how long, what couples</span></div>
      <div class="ins-group">
        <div class="ins-group-label">Material</div>
        <div class="knob-row">
          ${knobHTML("partialMaterial", "Loss factor", p.partialMaterial, 0, 1, 0.01, { def: 0.45 })}
          ${knobHTML("partialTransfer", "Coupling", p.partialTransfer, 0, 1, 0.01, { def: 0.15 })}
        </div>
      </div>
      <div class="ins-group">
        <div class="ins-group-label">Partials</div>
        <div class="knob-row">
          ${knobHTML("spectralPartials", "Density", p.spectralPartials, 1, 64, 1, { def: 20 })}
          ${knobHTML("partialB", "Inharmonicity", Number.isFinite(p.partialB) ? p.partialB : legacyStretchToB(p.spectralStretchCents || 0), 0, 0.002, 0.00002, { def: 0 })}
        </div>
      </div>
      <div class="ins-group">
        <div class="ins-group-label">Damping</div>
        <div class="knob-row">
          ${knobHTML("partialTilt", "Frequency tilt", p.partialTilt, -1, 1, 0.01, { def: 0 })}
        </div>
      </div>
      <details class="ch-perf formant-detail">
        <summary title="Legacy macro transforms — position and the physical stages absorb most of these; they remain for fine surgery.">Advanced shaping</summary>
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
      <div class="ch-caption">loss factor sets each partial's ring time from its REAL frequency; coupling lets true-ratio neighbours feed each other — inharmonicity detunes them apart</div>`;
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
  const prof = REVERB_PROFILES[p.reverbType] || REVERB_PROFILES.room;
  const roomKey = REVERB_PROFILES[p.reverbType] ? p.reverbType : "room";
  const earSel = _earModelOf(p);
  // V2 (owner 2026-07-08): the space is SHARED — one room, one head, one
  // air for every layer. The only per-layer spatial property is position,
  // edited on the big stage to the right. This panel owns the shared half.
  return `
    <div class="ch-ins-head"><span class="ch-card-n">04 · SPACE</span><span class="ch-ins-d">one shared space — layers only differ by position</span></div>
    <div class="ins-group">
      <div class="ins-group-label" title="Each room is a parametric impulse-response model — a recipe, not a recording. Pick one, then bend it with the knobs below.">Room</div>
      <select id="roomTypeSel" class="param-select ins-select" title="${esc(prof.label)} — ${esc(prof.blurb)}">
        ${Object.entries(REVERB_PROFILES).map(([k, r]) =>
          `<option value="${k}"${k === roomKey ? " selected" : ""}>${esc(r.label)} — ${esc(r.blurb)}</option>`).join("")}
      </select>
      <div class="knob-row">
        ${knobHTML("reverbDecay", "RT60", p.reverbDecay, 0.2, 8, 0.1, { def: 1.4, cool: true })}
        ${knobHTML("reverbSize", "Size", p.reverbSize ?? prof.size, 0, 1, 0.01, { def: prof.size, cool: true })}
        ${knobHTML("reverbWet", "Room level", p.reverbWet, 0, 0.95, 0.01, { def: 0.16, cool: true })}
      </div>
      <div class="knob-row">
        ${knobHTML("reverbDamping", "HF damping", p.reverbDamping ?? prof.damping, 0, 1, 0.01, { def: prof.damping, cool: true })}
        ${knobHTML("reverbDiffusion", "Diffusion", p.reverbDiffusion ?? prof.diffusion, 0, 1, 0.01, { def: prof.diffusion, cool: true })}
      </div>
    </div>
    <div class="ins-group">
      <div class="ins-group-label" title="${esc(PARAM_DESC.earModel)}">Head model — one listener for all layers</div>
      <select id="earModelSel" class="param-select ins-select">
        ${Object.entries(EAR_MODELS).map(([k, m]) =>
          `<option value="${k}"${earSel === k ? " selected" : ""} title="${esc(m.blurb)}">${esc(m.label)} — ${(m.earDistance * 100).toFixed(1)} cm · density ${m.headDensity.toFixed(2)}</option>`).join("")}
        ${earSel === "custom" ? `<option value="custom" selected>Custom — shaped by the knobs below</option>` : ""}
      </select>
      <div class="knob-row">
        ${knobHTML("earDistance", "Ear span", p.earDistance ?? 0.175, 0.12, 0.25, 0.005, { def: 0.175, cool: true })}
        ${knobHTML("headDensity", "Density", p.headDensity ?? 0.5, 0, 1, 0.01, { def: 0.5, cool: true })}
        ${knobHTML("pinnaScale", "Pinna", p.pinnaScale ?? 1, 0.6, 1.6, 0.01, { def: 1, cool: true })}
      </div>
    </div>
    <div class="ch-caption">the room, the listener's head and the air are the PATCH's space — every layer plays inside them. Drag the numbered dots on the stage to place the base sound and each layer around your head; behind you (shaded half) sounds duller via the pinna law</div>`;
}

// Which EAR_MODELS preset the current head params correspond to (within
// knob resolution), or "custom" when the knobs have wandered off-preset.
function _earModelOf(p) {
  const matches = (m) =>
    Math.abs((p.earDistance ?? 0.175) - m.earDistance) < 0.0026 &&
    Math.abs((p.headDensity ?? 0.5) - m.headDensity) < 0.006 &&
    Math.abs((p.pinnaScale ?? 1) - m.pinnaScale) < 0.006;
  // the stored choice wins when it still fits — disambiguates models that
  // share parameters (measured KEMAR vs its fitted replica)
  if (p.earModel && EAR_MODELS[p.earModel] && matches(EAR_MODELS[p.earModel])) return p.earModel;
  for (const [k, m] of Object.entries(EAR_MODELS)) if (matches(m)) return k;
  return "custom";
}

// Little line-art portraits of the rooms — drawn, not loaded (no images
// in the repo; a room is a recipe here, so its picture is too).
function drawRoomTiles() {
  document.querySelectorAll("[data-room-art]").forEach(cv => {
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(180,200,220,0.8)";
    ctx.fillStyle = "rgba(180,200,220,0.25)";
    ctx.lineWidth = 1.2;
    const line = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.stroke();
    };
    switch (cv.dataset.roomArt) {
      case "studio": { // mic on a stand in a treated corner
        for (let x = 4; x < w - 18; x += 5) line([[x, 3], [x + 3, 3], [x + 3, 12], [x, 12], [x, 3]]);
        ctx.beginPath(); ctx.arc(w - 12, 12, 4, 0, 2 * Math.PI); ctx.stroke();
        line([[w - 12, 16], [w - 12, h - 4]]); line([[w - 17, h - 4], [w - 7, h - 4]]);
        break;
      }
      case "room": { // sofa + lamp
        line([[5, h - 5], [5, 14], [10, 14], [10, 19], [26, 19], [26, 14], [31, 14], [31, h - 5], [5, h - 5]]);
        line([[w - 8, h - 5], [w - 8, 8]]);
        ctx.beginPath(); ctx.arc(w - 8, 7, 3.5, Math.PI, 2 * Math.PI); ctx.stroke();
        break;
      }
      case "bathroom": { // tub under tiles
        for (let x = 3; x < w - 2; x += 7) line([[x, 3], [x, 9]]);
        line([[2, 3], [w - 2, 3]]); line([[2, 9], [w - 2, 9]]);
        line([[8, 17], [w - 12, 17], [w - 13, h - 4], [10, h - 4], [8, 17]]);
        break;
      }
      case "chamber": { // wood panelling + a chair
        for (let x = 5; x < w - 2; x += 8) line([[x, 3], [x, h - 12]]);
        line([[3, h - 12], [w - 3, h - 12]]);
        line([[w - 16, h - 4], [w - 16, h - 9], [w - 10, h - 9], [w - 10, h - 4]]);
        break;
      }
      case "plate": { // hatched steel sheet with the drive spot
        line([[4, 6], [w - 4, 6], [w - 4, h - 6], [4, h - 6], [4, 6]]);
        for (let x = 8; x < w - 6; x += 6) line([[x, 6], [x - 4, h - 6]]);
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 2.2, 0, 2 * Math.PI); ctx.fill();
        break;
      }
      case "hall": { // stage arc + rows of seats
        ctx.beginPath(); ctx.arc(w / 2, 4, 13, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        for (let r = 0; r < 3; r++) {
          ctx.beginPath(); ctx.arc(w / 2, 2, 18 + r * 5, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
        }
        break;
      }
      case "cathedral": { // pointed arches + spire
        line([[6, h - 3], [6, 14]]); line([[18, h - 3], [18, 14]]);
        ctx.beginPath(); ctx.moveTo(6, 14); ctx.quadraticCurveTo(12, 4, 18, 14); ctx.stroke();
        line([[24, h - 3], [24, 14]]); line([[36, h - 3], [36, 14]]);
        ctx.beginPath(); ctx.moveTo(24, 14); ctx.quadraticCurveTo(30, 4, 36, 14); ctx.stroke();
        line([[w - 4, h - 3], [w - 4, 8], [w - 2, 8]]);
        break;
      }
      case "cave": { // stalactites over a floor
        line([[3, 4], [8, 4], [10, 12], [12, 4], [18, 4], [20, 16], [23, 4], [30, 4], [32, 10], [34, 4], [w - 3, 4]]);
        line([[3, h - 4], [w - 3, h - 4]]);
        break;
      }
      case "forest": { // three pines
        const tree = (x, s) => { line([[x - s, h - 4], [x, h - 4 - s * 2.6], [x + s, h - 4]]); line([[x, h - 4], [x, h - 2]]); };
        tree(10, 5); tree(23, 7); tree(36, 4);
        break;
      }
      case "spring": { // the coil
        ctx.beginPath();
        for (let x = 4; x <= w - 4; x++) {
          const y = h / 2 + Math.sin((x - 4) * 0.9) * 6;
          x === 4 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        line([[2, h / 2], [4, h / 2]]); line([[w - 4, h / 2], [w - 2, h / 2]]);
        break;
      }
    }
  });
}

// Ear-model select + room tiles (sub-note SPACE inspector).
function wireEarRoom(v) {
  const sel = v.querySelector("#earModelSel");
  if (sel) sel.onchange = () => {
    const m = EAR_MODELS[sel.value];
    if (!m) return; // "custom" — nothing to apply
    noteParamChange("earModel", exploreParams.earModel, sel.value);
    exploreParams.earModel = sel.value;
    exploreParams.earDistance = m.earDistance;
    exploreParams.headDensity = m.headDensity;
    exploreParams.pinnaScale = m.pinnaScale;
    synth.updateReverb({ ...exploreParams });
    renderExplore();
  };
  // V2: the head-model list rows (the select's replacement)
  v.querySelectorAll("[data-ear-model]").forEach(btn => {
    btn.onclick = () => {
      const m = EAR_MODELS[btn.dataset.earModel];
      if (!m) return; // the "custom" row is a state, not a preset
      noteParamChange("earModel", exploreParams.earModel, btn.dataset.earModel);
      exploreParams.earModel = btn.dataset.earModel;
      exploreParams.earDistance = m.earDistance;
      exploreParams.headDensity = m.headDensity;
      exploreParams.pinnaScale = m.pinnaScale;
      synth.updateReverb({ ...exploreParams });
      renderExplore();
    };
  });
  v.querySelectorAll("[data-room-tile]").forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.roomTile;
      if (!REVERB_PROFILES[k]) return;
      noteParamChange("reverbType", exploreParams.reverbType, k);
      exploreParams.reverbType = k;
      // picking a room adopts ITS character; the knobs bend it from there
      exploreParams.reverbSize = null;
      exploreParams.reverbDamping = null;
      exploreParams.reverbDiffusion = null;
      synth.updateReverb({ ...exploreParams });
      renderExplore();
    };
  });
  // V2.2: the sub-note room list is a dropdown now (owner: tiles ate the column)
  const roomSel = v.querySelector("#roomTypeSel");
  if (roomSel) roomSel.onchange = () => {
    const k = roomSel.value;
    if (!REVERB_PROFILES[k]) return;
    noteParamChange("reverbType", exploreParams.reverbType, k);
    exploreParams.reverbType = k;
    exploreParams.reverbSize = null;
    exploreParams.reverbDamping = null;
    exploreParams.reverbDiffusion = null;
    synth.updateReverb({ ...exploreParams });
    renderExplore();
  };
  drawRoomTiles();
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
  // 04 space: mini room plan (Q4 full circle; owner 07-07: the graphic
  // fills the card — larger rings, a real head at the centre)
  g = th("chThumb_space");
  if (g) {
    const cx = g.w / 2, cy = g.h / 2, rMax = Math.min(g.h / 2 - 2, g.w / 2 - 2);
    g.ctx.fillStyle = "rgba(60,72,88,0.18)";
    g.ctx.beginPath(); g.ctx.arc(cx, cy, rMax, 0, Math.PI); g.ctx.closePath(); g.ctx.fill();
    g.ctx.strokeStyle = "rgba(88,214,169,0.35)";
    for (const dm of [1, 3, 10]) {
      const r = _spaceDistToR(dm, rMax);
      g.ctx.beginPath(); g.ctx.arc(cx, cy, r, 0, 2 * Math.PI); g.ctx.stroke();
    }
    const d = clamp(p.spaceDistance ?? 2.5, SPACE_DMIN, SPACE_DMAX);
    const az = (clamp(p.spaceAzimuth ?? 0, -180, 180) - 90) * Math.PI / 180;
    const r = _spaceDistToR(d, rMax);
    g.ctx.fillStyle = "#58d6a9";
    g.ctx.beginPath();
    g.ctx.arc(cx + Math.cos(az) * r, cy + Math.sin(az) * r, 3.5, 0, 2 * Math.PI);
    g.ctx.fill();
    // the head, with ears and a front-pointing nose
    g.ctx.fillStyle = "rgba(200,215,230,0.85)";
    g.ctx.beginPath(); g.ctx.arc(cx, cy, 4.5, 0, 2 * Math.PI); g.ctx.fill();
    g.ctx.beginPath(); g.ctx.arc(cx - 4.5, cy, 1.5, 0, 2 * Math.PI); g.ctx.fill();
    g.ctx.beginPath(); g.ctx.arc(cx + 4.5, cy, 1.5, 0, 2 * Math.PI); g.ctx.fill();
    g.ctx.beginPath();
    g.ctx.moveTo(cx - 1.6, cy - 4.2); g.ctx.lineTo(cx, cy - 6.8); g.ctx.lineTo(cx + 1.6, cy - 4.2);
    g.ctx.closePath(); g.ctx.fill();
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
  // stage rail: select a stage -> its inspector expands. Wired before the
  // print guard — on the SPACE stage the print canvas is absent (room view
  // instead) but the rail must still switch stages.
  v.querySelectorAll("[data-ch-stage]").forEach(card => {
    card.onclick = () => {
      if (_chStage === card.dataset.chStage) return;
      _chStage = card.dataset.chStage;
      renderExplore();
    };
  });
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
  // your head (owner 07-07): a real little head — skull, two ears, a nose
  // pointing front — instead of an anonymous dot
  const hr = 7;
  ctx.fillStyle = "rgba(200,215,230,0.85)";
  ctx.beginPath(); ctx.arc(cx, cy, hr, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - hr, cy, 2.2, 0, 2 * Math.PI); ctx.fill(); // left ear
  ctx.beginPath(); ctx.arc(cx + hr, cy, 2.2, 0, 2 * Math.PI); ctx.fill(); // right ear
  ctx.beginPath(); // nose points to the front
  ctx.moveTo(cx - 2.4, cy - hr + 0.5);
  ctx.lineTo(cx, cy - hr - 3.5);
  ctx.lineTo(cx + 2.4, cy - hr + 0.5);
  ctx.closePath(); ctx.fill();
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

// Studio sections now use native viewport layout like Producer. Keep this
// shim because resize/render paths still call it, and clear any persisted
// transform from older sessions.
function fitStudioScale() {
  const dash = document.querySelector(".explore-dashboard");
  if (!dash) return;
  dash.style.transform = "";
  dash.style.transformOrigin = "";
}
if (!window._studioFitInstalled) {
  window._studioFitInstalled = true;
  window.addEventListener("resize", fitStudioScale);
}

// Q12: draggable studio panel dividers — same pattern as the producer's
// dawLayout splits, persisted across sessions. Live style updates only;
// no re-render mid-drag (the mid-drag re-render gotcha).
function wireStudioPanels(v) {
  fitStudioScale();
  const dragX = (el, apply, commit) => {
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
  const dash = v.querySelector(".explore-dashboard");
  dragX(v.querySelector("#dashVSplit"), (ev) => {
    if (!dash) return;
    const rect = dash.getBoundingClientRect();
    const maxLeft = Math.max(220, Math.min(430, rect.width - 520));
    _studioPanels.dashC1 = Math.max(190, Math.min(maxLeft, ev.clientX - rect.left));
    dash.style.setProperty("--dash-c1", `${Math.round(_studioPanels.dashC1)}px`);
  }, saveStudioPanels);
  const inspector = v.querySelector("#chInspector");
  dragX(v.querySelector("#chVSplit"), (ev) => {
    if (!inspector) return;
    const rect = inspector.getBoundingClientRect();
    _studioPanels.chW = Math.max(180, Math.min(460, ev.clientX - rect.left));
    inspector.style.setProperty("--ch-w", `${Math.round(_studioPanels.chW)}px`);
  }, saveStudioPanels);
}

// Owner 07-07: clicking a layer row LOADS that layer's sound into the
// editor above. The base sound half is stashed; every editor control then
// shapes (and auditions) the layer; Done — or clicking another row, or the
// row again — writes the sound back into the layer and restores the base.
let _chLayerEdit = null; // { layerId, baseStash }

function _soundHalf(params) {
  const half = extractSectionParams(params, "sound");
  for (const k of Object.keys(half)) if (k.startsWith("layer")) delete half[k];
  return half;
}

function enterLayerEdit(layer) {
  if (_chLayerEdit) exitLayerEdit(false);
  // Owner 07-07: location in space is SEPARATE per layer — editing a layer
  // also swaps its position in, so the SPACE stage pad moves THIS layer.
  _chLayerEdit = {
    layerId: layer.id,
    baseStash: _soundHalf(exploreParams),
    baseSpace: { angle: exploreParams.spaceAzimuth ?? 0, dist: exploreParams.spaceDistance ?? 2.5 },
  };
  Object.assign(exploreParams, layer.subnote || {});
  exploreParams.spaceAzimuth = layer.space?.angle ?? _chLayerEdit.baseSpace.angle;
  exploreParams.spaceDistance = layer.space?.dist ?? _chLayerEdit.baseSpace.dist;
  _chLayerSel = layer.id;
  synth.updateGenerationParams({ ...exploreParams });
  renderExplore();
}

function exitLayerEdit(rerender = true) {
  if (!_chLayerEdit) return;
  const layer = (exploreParams.layers || []).find(l => l.id === _chLayerEdit.layerId);
  if (layer) {
    layer.subnote = _soundHalf(exploreParams); // save the edit back
    layer.space = { // ...including where the SPACE pad put this layer
      angle: exploreParams.spaceAzimuth ?? 0,
      dist: exploreParams.spaceDistance ?? 2.5,
    };
  }
  Object.assign(exploreParams, _chLayerEdit.baseStash);  // restore the base
  exploreParams.spaceAzimuth = _chLayerEdit.baseSpace.angle;
  exploreParams.spaceDistance = _chLayerEdit.baseSpace.dist;
  _chLayerEdit = null;
  _chLayerSel = null;
  synth.updateGenerationParams({ ...exploreParams });
  if (rerender) renderExplore();
}

// Q7: layer strip interactions. Layer edits apply live through
// updateGenerationParams — the next generated note carries them.
function wireLayerStrip(v) {
  const applyLive = () => synth.updateGenerationParams({ ...exploreParams });
  const doneBtn = v.querySelector("#layerEditDone");
  if (doneBtn) doneBtn.onclick = () => exitLayerEdit();
  const add = v.querySelector("#layerAdd");
  if (add) add.onclick = () => {
    exitLayerEdit(false); // a new layer captures the BASE sound, not an edit in progress
    if (!Array.isArray(exploreParams.layers)) exploreParams.layers = [];
    const subnote = extractSectionParams(exploreParams, "sound");
    // a layer never nests layers or carries the shared-sync settings
    for (const k of Object.keys(subnote)) if (k.startsWith("layer")) delete subnote[k];
    const layer = {
      id: crypto.randomUUID(),
      hue: (36 + exploreParams.layers.length * 70) % 360,
      subnote,
      // owner 07-07: every layer's location is its OWN from birth — a copy
      // of the current position, so moving the base never drags layers
      space: { angle: exploreParams.spaceAzimuth ?? 0, dist: exploreParams.spaceDistance ?? 2.5 },
      gain: 0.8,
    };
    exploreParams.layers.push(layer);
    _chLayerSel = layer.id;
    applyLive();
    renderExplore();
  };

  // Drop targets for browser presets: the strip itself, the rows area, and
  // the floating zone that appears while dragging (so a drop target is
  // always in view even when the expanded library covers the strip).
  [v.querySelector("#layerStrip"), v.querySelector(".layer-area")]
    .filter(Boolean).forEach(bindLayerDropTarget);

  v.querySelectorAll("[data-layer-row]").forEach(row => {
    row.onclick = (e) => {
      if (e.target.closest("input, button, canvas")) return; // controls stay controls
      const id = row.dataset.layerRow;
      if (_chLayerEdit?.layerId === id) { exitLayerEdit(); return; } // same row = done
      const layer = (exploreParams.layers || []).find(l => l.id === id);
      if (layer) enterLayerEdit(layer); // exits any other edit first
    };
  });
  const layerOf = (id) => (exploreParams.layers || []).find(l => l.id === id);
  const bindSlider = (attr, apply) => v.querySelectorAll(`[${attr}]`).forEach(el => {
    el.oninput = () => {
      const l = layerOf(el.getAttribute(attr));
      if (l) { apply(l, Number(el.value)); applyLive(); drawLayerMiniPads(); }
    };
  });
  bindSlider("data-layer-gain", (l, val) => { l.gain = val; });
  const syncEditedSpace = (l) => {
    // if this layer is loaded in the editor, the SPACE pad mirrors the move
    if (_chLayerEdit?.layerId === l.id) {
      exploreParams.spaceAzimuth = l.space.angle;
      exploreParams.spaceDistance = l.space.dist;
      drawSpacePad();
      synth.updateReverb({ ...exploreParams });
    }
  };
  bindSlider("data-layer-angle", (l, val) => {
    l.space = { angle: val, dist: l.space?.dist ?? (exploreParams.spaceDistance ?? 2.5) };
    syncEditedSpace(l);
    drawStageBig(); updateStageReadouts(); // the stage mirrors the strip live (V2.2)
  });
  bindSlider("data-layer-dist", (l, val) => {
    l.space = { angle: l.space?.angle ?? (exploreParams.spaceAzimuth ?? 0), dist: val };
    syncEditedSpace(l);
    drawStageBig(); updateStageReadouts();
  });
  // Owner 07-07: solo a layer to hear it alone (base + unsoloed layers
  // silent); multiple solos combine like track solos
  v.querySelectorAll("[data-layer-solo]").forEach(el => {
    el.onclick = () => {
      const l = layerOf(el.dataset.layerSolo);
      if (!l) return;
      l.solo = !l.solo;
      el.classList.toggle("on", l.solo);
      applyLive();
    };
  });
  v.querySelectorAll("[data-layer-recapture]").forEach(el => {
    el.onclick = () => {
      exitLayerEdit(false); // recapture always means "from the BASE sound"
      const l = layerOf(el.dataset.layerRecapture);
      if (!l) return;
      l.subnote = _soundHalf(exploreParams);
      applyLive();
      renderExplore();
    };
  });
  v.querySelectorAll("[data-layer-remove]").forEach(el => {
    el.onclick = () => {
      exitLayerEdit(false); // restore the base before the layer disappears
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
  drawLayerMiniPads();
}

// ── V2 SPATIAL STAGE (render phase-04, owner 2026-07-08) ────────────
// The SPACE field is a full top-down stage. Sources = the base sound
// plus every layer; the space itself (room, head, air) is SHARED — the
// only per-layer property is position, so the only per-source edit here
// is dragging a dot. The binaural strip below follows the selection.
let _stageSel = "base";
let _stageViewPos = null; // non-base selection: {angle, dist} the ear view follows

function stageSourceList(p) {
  const list = [{
    id: "base", num: "B", label: "Base", hue: 36,
    angle: p.spaceAzimuth ?? 0, dist: p.spaceDistance ?? 2.5,
  }];
  (p.layers || []).forEach((l, i) => list.push({
    id: l.id, num: String(i + 1), label: `Layer ${i + 1}`,
    hue: l.hue ?? (36 + i * 70) % 360,
    angle: l.space?.angle ?? (p.spaceAzimuth ?? 0),
    dist: l.space?.dist ?? (p.spaceDistance ?? 2.5),
    layer: l,
  }));
  return list;
}

function _stageSelected(p) {
  const list = stageSourceList(p);
  return list.find(s => s.id === _stageSel) || list[0];
}

function stageReadoutsHTML(p) {
  // (V2.2: the chip strip above the stage is gone — the layer rows below
  // are the one source list; selection state still lives in _stageSel)
  if (!stageSourceList(p).some(s => s.id === _stageSel)) _stageSel = "base";
  const s = _stageSelected(p);
  const tof = spaceArrivalDelay(s.dist) * 1000;
  const lvl = 20 * Math.log10(spaceDistanceGain(s.dist));
  return `
    <div class="stage-readouts" id="stageReadouts">
      <div class="stage-ro"><span class="stage-ro-k" style="color:hsl(${s.hue},70%,62%)">Source</span><span class="stage-ro-v" id="stageRoSrc">${esc(s.label)}</span></div>
      <div class="stage-ro"><span class="stage-ro-k">Distance</span><span class="stage-ro-v" id="stageRoDist">${s.dist.toFixed(2)} m</span></div>
      <div class="stage-ro"><span class="stage-ro-k">Azimuth</span><span class="stage-ro-v" id="stageRoAz">${Math.round(s.angle)}°</span></div>
      <div class="stage-ro"><span class="stage-ro-k">Time of flight</span><span class="stage-ro-v" id="stageRoTof">${tof.toFixed(1)} ms</span></div>
      <div class="stage-ro"><span class="stage-ro-k">Level (dry)</span><span class="stage-ro-v" id="stageRoLvl">${lvl.toFixed(1)} dB</span></div>
    </div>`;
}

function updateStageReadouts() {
  const s = _stageSelected(exploreParams);
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("stageRoSrc", s.label);
  set("stageRoDist", `${s.dist.toFixed(2)} m`);
  set("stageRoAz", `${Math.round(s.angle)}°`);
  set("stageRoTof", `${(spaceArrivalDelay(s.dist) * 1000).toFixed(1)} ms`);
  set("stageRoLvl", `${(20 * Math.log10(spaceDistanceGain(s.dist))).toFixed(1)} dB`);
  // stage selection ↔ layer rows: the picked dot highlights its row as the
  // active layer (base clears it) — one selection, two views (V2.2)
  _chLayerSel = s.id === "base" ? null : s.id;
  document.querySelectorAll("[data-layer-row]").forEach(row =>
    row.classList.toggle("sel", row.dataset.layerRow === _stageSel));
  _stageViewPos = s.id === "base" ? null : { angle: s.angle, dist: s.dist };
}

function _stageGeom(w, h) {
  const cx = w / 2, cy = h / 2 + 6;
  const rMax = Math.min(h / 2 - 30, w / 2 - 46);
  return { cx, cy, rMax };
}

function drawStageBig() {
  const cv = document.getElementById("cvStageBig");
  if (!cv) return;
  const { ctx, w, h } = crisp2d(cv);
  ctx.clearRect(0, 0, w, h);
  const { cx, cy, rMax } = _stageGeom(w, h);
  const GRID = "rgba(90,110,130,0.3)", TXT = "rgba(120,135,150,0.8)";
  ctx.font = "10px ui-monospace, monospace";

  // behind-you half (bottom) shaded — same convention as the old pad
  ctx.fillStyle = "rgba(60,72,88,0.13)";
  ctx.beginPath(); ctx.arc(cx, cy, rMax, 0, Math.PI); ctx.closePath(); ctx.fill();

  // distance rings (log map, like the engine's distance law)
  ctx.strokeStyle = GRID;
  ctx.setLineDash([3, 4]);
  ctx.fillStyle = TXT;
  for (const dm of [1, 2, 4, 8, 16]) {
    const r = _spaceDistToR(dm, rMax);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillText(`${dm} m`, cx + 5, cy - r - 3);
  }
  ctx.setLineDash([]);

  // outer ring + azimuth ticks every 15°
  ctx.strokeStyle = "rgba(120,140,165,0.5)";
  ctx.beginPath(); ctx.arc(cx, cy, rMax, 0, 2 * Math.PI); ctx.stroke();
  for (let a = -180; a < 180; a += 15) {
    const rad = (a - 90) * Math.PI / 180;
    const len = a % 45 === 0 ? 8 : 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * rMax, cy + Math.sin(rad) * rMax);
    ctx.lineTo(cx + Math.cos(rad) * (rMax + len), cy + Math.sin(rad) * (rMax + len));
    ctx.stroke();
  }
  ctx.fillStyle = TXT;
  ctx.textAlign = "center";
  for (const a of [-90, -60, -30, 0, 30, 60, 90]) {
    const rad = (a - 90) * Math.PI / 180;
    ctx.fillText(`${a}°`, cx + Math.cos(rad) * (rMax + 20), cy + Math.sin(rad) * (rMax + 20) + 3);
  }
  ctx.fillStyle = "rgba(120,135,150,0.45)";
  ctx.fillText("behind", cx, cy + rMax + 22);
  ctx.textAlign = "left";

  // front axis
  ctx.strokeStyle = "rgba(120,140,165,0.25)";
  ctx.beginPath(); ctx.moveTo(cx, cy - rMax); ctx.lineTo(cx, cy + rMax); ctx.stroke();

  // the listener's head, ears + nose forward
  ctx.fillStyle = "rgba(200,215,230,0.9)";
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - 9, cy, 3, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + 9, cy, 3, 0, 2 * Math.PI); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy - 8.4); ctx.lineTo(cx, cy - 13.5); ctx.lineTo(cx + 3, cy - 8.4);
  ctx.closePath(); ctx.fill();

  // sources — the base sound and each layer, drag targets
  ctx.textAlign = "center";
  for (const s of stageSourceList(exploreParams)) {
    const rad = (clamp(s.angle, -180, 180) - 90) * Math.PI / 180;
    const r = _spaceDistToR(clamp(s.dist, SPACE_DMIN, SPACE_DMAX), rMax);
    const x = cx + Math.cos(rad) * r, y = cy + Math.sin(rad) * r;
    const col = `hsl(${s.hue}, 70%, 62%)`;
    if (s.id === _stageSel) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.fillStyle = "rgba(13,16,21,0.9)";
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = col;
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.fillText(s.num, x, y + 3.5);
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = TXT;
    ctx.fillText(`${s.dist.toFixed(1)} m`, x, y + 24);
  }
  ctx.textAlign = "left";
}

function wireStageBig(v) {
  const cv = v.querySelector("#cvStageBig");
  if (!cv) return;
  const srcAt = (x, y) => {
    const w = cv._cssW || cv.getBoundingClientRect().width;
    const h = cv._cssH || cv.getBoundingClientRect().height;
    const { cx, cy, rMax } = _stageGeom(w, h);
    let best = null, bestD = 18;
    for (const s of stageSourceList(exploreParams)) {
      const rad = (clamp(s.angle, -180, 180) - 90) * Math.PI / 180;
      const r = _spaceDistToR(clamp(s.dist, SPACE_DMIN, SPACE_DMAX), rMax);
      const d = Math.hypot(cx + Math.cos(rad) * r - x, cy + Math.sin(rad) * r - y);
      // ties go to the already-selected source, so when dots stack the
      // chips decide which one a grab picks up
      if (d < bestD || (best && s.id === _stageSel && d < 18)) { best = s; bestD = Math.min(d, bestD); }
    }
    return best;
  };
  // Canvas backing stores can differ from their CSS size, so map pointer
  // coordinates back into the geometry size used by the stage renderer.
  const toLocal = (e) => {
    const rect = cv.getBoundingClientRect();
    const w = cv._cssW || rect.width, h = cv._cssH || rect.height;
    return {
      x: (e.clientX - rect.left) * (w / Math.max(1, rect.width)),
      y: (e.clientY - rect.top) * (h / Math.max(1, rect.height)),
      w, h,
    };
  };
  const applyAt = (e) => {
    const { x, y, w, h } = toLocal(e);
    const { cx, cy, rMax } = _stageGeom(w, h);
    const az = Math.round(clamp(Math.atan2(x - cx, -(y - cy)) * 180 / Math.PI, -180, 180));
    const dist = Number(_spaceRToDist(Math.hypot(x - cx, y - cy), rMax).toFixed(2));
    const s = _stageSelected(exploreParams);
    if (s.id === "base") {
      exploreParams.spaceAzimuth = az;
      exploreParams.spaceDistance = dist;
      synth.updateReverb({ ...exploreParams });
      drawChThumbs();
    } else if (s.layer) {
      s.layer.space = { angle: az, dist };
      // mirror to the layer strip's sliders so the two stay one control
      const aSl = document.querySelector(`[data-layer-angle="${s.id}"]`);
      if (aSl) aSl.value = az;
      const dSl = document.querySelector(`[data-layer-dist="${s.id}"]`);
      if (dSl) dSl.value = dist;
      if (_chLayerEdit?.layerId === s.id) {
        exploreParams.spaceAzimuth = az;
        exploreParams.spaceDistance = dist;
        synth.updateReverb({ ...exploreParams });
      }
      synth.updateGenerationParams({ ...exploreParams });
      drawLayerMiniPads();
    }
    updateStageReadouts();
    drawStageBig();
    drawSpaceField();
  };
  cv.onmousedown = (e) => {
    e.preventDefault();
    const pt = toLocal(e);
    const hit = srcAt(pt.x, pt.y);
    if (hit && hit.id !== _stageSel) {
      _stageSel = hit.id;
      updateStageReadouts();
      drawStageBig();
      drawSpaceField();
    }
    applyAt(e);
    const move = (ev) => applyAt(ev);
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  v.querySelectorAll("[data-stage-src]").forEach(chip => {
    chip.onclick = (e) => {
      if (e.target.closest("button")) return; // solo stays solo
      if (_stageSel === chip.dataset.stageSrc) return;
      _stageSel = chip.dataset.stageSrc;
      updateStageReadouts();
      drawStageBig();
      drawSpaceField();
    };
  });
  updateStageReadouts();
  drawStageBig();
}

// Owner 07-07 round 2: the SPACE stage's field is the BINAURAL RESPONSE —
// what this position hands to each ear, computed from the same published
// models the audio uses (Woodworth ITD, Brown-Duda shadow, Shaw pinna,
// air absorption, proximity). The old full-size room duplicated the mini
// pad ("ugly and redundant"); position editing lives on the pad + knobs,
// and this view follows them live. Pure display — no interaction.
// V2: when a layer is selected on the stage, the view follows ITS
// position via _stageViewPos (the shared room/head stay the patch's).
function drawSpaceField() {
  const cv = document.getElementById("cvSpaceField");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  const p = exploreParams;
  const d = clamp((_stageViewPos ? _stageViewPos.dist : p.spaceDistance) ?? 2.5, SPACE_DMIN, SPACE_DMAX);
  const azRad = clamp((_stageViewPos ? _stageViewPos.angle : p.spaceAzimuth) ?? 0, -180, 180) * Math.PI / 180;
  const earDist = p.earDistance ?? 0.175;
  const density = p.headDensity ?? 0.5;
  const wet = clamp(p.reverbWet ?? 0.16, 0, 0.95);
  const decay = clamp(p.reverbDecay ?? 1.4, 0.2, 8);
  const preDelay = clamp(p.reverbPreDelay ?? 0.015, 0, 0.25);

  const roomKey = REVERB_PROFILES[p.reverbType] ? p.reverbType : "room";
  const prof = REVERB_PROFILES[roomKey];
  const size = clamp(p.reverbSize ?? prof.size ?? 0.5, 0, 1);
  const damping = clamp(p.reverbDamping ?? prof.damping ?? 0.4, 0, 1);
  const diffusion = clamp(p.reverbDiffusion ?? prof.diffusion ?? 0.5, 0, 1);

  const itd = itdSeconds(azRad, earDist);          // +ve: LEFT ear later
  const t0 = spaceArrivalDelay(d);
  const distDb = 20 * Math.log10(spaceDistanceGain(d));
  const shadowL = headShadowDb(azRad, "L", density);
  const shadowR = headShadowDb(azRad, "R", density);
  const f0 = headShadowFreq(earDist);
  const airFc = spaceAirCutoff(d);
  const proxDb = spaceProximityDb(d);
  const pinna = pinnaParams(azRad, p.pinnaScale ?? 1);

  const COL_L = "rgba(124,196,255,0.95)", COL_R = "rgba(255,180,84,0.95)";
  const GRID = "rgba(90,110,130,0.22)", TXT = "rgba(120,135,150,0.75)";
  ctx.font = "10px ui-monospace, monospace";

  // ── left panel: WHEN it arrives (direct hit + room tail) ──────────
  const L = { x: 14, y: 30, w: 610, h: h - 78 };
  ctx.fillStyle = TXT; ctx.textAlign = "left";
  ctx.fillText("WHEN IT ARRIVES", L.x, 16);
  ctx.strokeStyle = GRID;
  ctx.strokeRect(L.x + 0.5, L.y + 0.5, L.w, L.h);
  // sqrt-compressed time axis: the first milliseconds matter as much as
  // the seconds-long tail
  const tMax = Math.max(0.4, t0 + preDelay + decay * 1.15);
  const xT = (t) => L.x + Math.sqrt(Math.max(0, t) / tMax) * L.w;
  ctx.textAlign = "center";
  for (const t of [0.01, 0.05, 0.2, 0.5, 1, 2, 5]) {
    if (t > tMax) break;
    const x = xT(t);
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(x, L.y); ctx.lineTo(x, L.y + L.h); ctx.stroke();
    ctx.fillStyle = TXT;
    ctx.fillText(t < 1 ? `${Math.round(t * 1000)}ms` : `${t}s`, x, L.y + L.h + 12);
  }
  const base = L.y + L.h - 4;
  // room tail: wet energy decaying after the direct hit + pre-delay
  const tail0 = t0 + preDelay;
  if (wet > 0.001) {
    ctx.beginPath();
    ctx.moveTo(xT(tail0), base);
    for (let px = 0; px <= 220; px++) {
      const t = tail0 + (px / 220) * (tMax - tail0);
      const amp = wet * Math.exp(-3 * (t - tail0) / decay); // ~-26 dB at "decay"
      ctx.lineTo(xT(t), base - amp * (L.h - 26));
    }
    ctx.lineTo(xT(tMax), base);
    ctx.closePath();
    const grad = ctx.createLinearGradient(xT(tail0), 0, xT(tMax), 0);
    grad.addColorStop(0, "rgba(148,196,255,0.30)");
    grad.addColorStop(1, "rgba(148,196,255,0.03)");
    ctx.fillStyle = grad;
    ctx.fill();
  }
  // the room's first bounces — the SAME deterministic pattern the
  // convolver is built from, so this is the impulse response you hear.
  // Left/right wall bounces take each ear's colour.
  if (wet > 0.001) {
    for (const refl of earlyReflectionPattern(roomKey, size, diffusion)) {
      const t = tail0 + refl.t;
      if (t > tMax) break;
      const x = xT(t);
      const amp = Math.min(1, Math.abs(refl.gain) * wet * 2.4);
      if (amp < 0.01) continue;
      ctx.strokeStyle = refl.side > 0 ? "rgba(255,180,84,0.75)" : "rgba(124,196,255,0.75)";
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - amp * (L.h - 30)); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }
  // direct hit: one spike at t0 (the ITD gap is sub-millisecond — the
  // inset shows it honestly instead of pretending it's visible here)
  const directAmp = clamp((distDb + 46) / 46, 0.05, 1);
  ctx.strokeStyle = "rgba(200,215,230,0.9)";
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(xT(t0), base); ctx.lineTo(xT(t0), base - directAmp * (L.h - 14)); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = TXT; ctx.textAlign = "left";
  ctx.fillText(`direct ${(t0 * 1000).toFixed(1)}ms · ${distDb.toFixed(1)}dB`, xT(t0) + 6, L.y + 14);
  if (wet > 0.001) ctx.fillText(`room tail · ${decay.toFixed(1)}s`, xT(tail0 + decay * 0.12), base - wet * (L.h - 26) * 0.5);

  // inset: the sub-millisecond gap between the ears (Woodworth ITD)
  const I = { x: L.x + L.w - 218, y: L.y + 10, w: 206, h: 92 };
  ctx.fillStyle = "rgba(10,14,20,0.88)";
  ctx.fillRect(I.x, I.y, I.w, I.h);
  ctx.strokeStyle = "rgba(90,110,130,0.45)";
  ctx.strokeRect(I.x + 0.5, I.y + 0.5, I.w, I.h);
  ctx.fillStyle = TXT;
  ctx.fillText("between your ears", I.x + 8, I.y + 14);
  const itdMs = itd * 1000;
  const span = Math.max(0.9, Math.abs(itdMs) * 1.6); // ±span ms window
  const xI = (ms) => I.x + I.w / 2 + (ms / span) * (I.w / 2 - 14);
  const iBase = I.y + I.h - 18;
  // near ear at 0, far ear offset by |ITD|; heights show the level gap
  const ampFor = (db) => clamp((db + 24) / 30, 0.12, 1) * (I.h - 44);
  const ears = [
    { ms: Math.max(0, itdMs), col: COL_L, db: shadowL, lbl: "L" },
    { ms: Math.max(0, -itdMs), col: COL_R, db: shadowR, lbl: "R" },
  ];
  for (const e of ears) {
    ctx.strokeStyle = e.col;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(xI(e.ms), iBase); ctx.lineTo(xI(e.ms), iBase - ampFor(e.db)); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = e.col;
    ctx.textAlign = "center";
    ctx.fillText(e.lbl, xI(e.ms), iBase - ampFor(e.db) - 5);
  }
  ctx.fillStyle = TXT;
  ctx.fillText(
    Math.abs(itdMs) < 0.005 ? "dead centre — no gap"
      : `${itdMs > 0 ? "left" : "right"} ear ${Math.abs(itdMs).toFixed(2)}ms later`,
    I.x + I.w / 2, I.y + I.h - 5);

  // ── right panel: HOW it's coloured (per-ear frequency response) ───
  const R = { x: 660, y: 30, w: w - 660 - 14, h: h - 78 };
  ctx.textAlign = "left";
  ctx.fillStyle = TXT;
  ctx.fillText("HOW IT'S COLOURED", R.x, 16);
  ctx.strokeStyle = GRID;
  ctx.strokeRect(R.x + 0.5, R.y + 0.5, R.w, R.h);
  const FMIN = 60, FMAX = 20000, DB_TOP = 12, DB_BOT = -36;
  const xF = (f) => R.x + Math.log(f / FMIN) / Math.log(FMAX / FMIN) * R.w;
  const yDb = (db) => R.y + (DB_TOP - clamp(db, DB_BOT, DB_TOP)) / (DB_TOP - DB_BOT) * R.h;
  ctx.textAlign = "center";
  for (const f of [100, 1000, 10000]) {
    ctx.strokeStyle = GRID;
    ctx.beginPath(); ctx.moveTo(xF(f), R.y); ctx.lineTo(xF(f), R.y + R.h); ctx.stroke();
    ctx.fillStyle = TXT;
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, xF(f), R.y + R.h + 12);
  }
  ctx.textAlign = "left";
  for (const db of [0, -12, -24]) {
    ctx.strokeStyle = db === 0 ? "rgba(120,140,160,0.35)" : GRID;
    ctx.beginPath(); ctx.moveTo(R.x, yDb(db)); ctx.lineTo(R.x + R.w, yDb(db)); ctx.stroke();
    ctx.fillStyle = TXT;
    ctx.fillText(`${db}dB`, R.x + 4, yDb(db) - 3);
  }
  // one ear's response: air lowpass + head-shadow shelf (f0) + proximity
  // low shelf + pinna concha dip and high shelf (behind only)
  const earDb = (f, shadowShelfDb) => {
    const air = -10 * Math.log10(1 + (f / airFc) ** 2);
    const hs = shadowShelfDb * (f * f / (f * f + f0 * f0));
    const prox = proxDb * (1 - f * f / (f * f + 250 * 250));
    const lg = Math.log2(f / pinna.conchaHz);
    const concha = pinna.conchaDb / (1 + (lg / 0.55) ** 2);
    const flange = pinna.shelfDb * (f * f / (f * f + pinna.shelfHz * pinna.shelfHz));
    return air + hs + prox + concha + flange;
  };
  const curve = (shadowShelfDb) => {
    const pts = [];
    for (let px = 0; px <= R.w; px += 3) {
      const f = FMIN * Math.pow(FMAX / FMIN, px / R.w);
      pts.push([R.x + px, yDb(earDb(f, shadowShelfDb))]);
    }
    return pts;
  };
  const ptsL = curve(shadowL), ptsR = curve(shadowR);
  // faint fill between the ears = the interaural level difference
  ctx.beginPath();
  ptsL.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  for (let i = ptsR.length - 1; i >= 0; i--) ctx.lineTo(ptsR[i][0], ptsR[i][1]);
  ctx.closePath();
  ctx.fillStyle = "rgba(200,215,230,0.07)";
  ctx.fill();
  for (const [pts, col, lbl] of [[ptsL, COL_L, "L"], [ptsR, COL_R, "R"]]) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = col;
    ctx.fillText(lbl, pts[pts.length - 1][0] - 12, pts[pts.length - 1][1] - 6);
  }
  // readout line: the numbers behind the curves
  ctx.fillStyle = TXT;
  ctx.textAlign = "left";
  const bits = [
    `shadow from ${Math.round(f0)} Hz`,
    `air to ${(airFc / 1000).toFixed(1)} kHz`,
    proxDb > 0.05 ? `proximity +${proxDb.toFixed(1)} dB` : null,
    pinna.conchaDb < -0.1 ? `behind: concha ${pinna.conchaDb.toFixed(1)} dB` : null,
  ].filter(Boolean);
  ctx.fillText(bits.join(" · "), R.x, h - 8);
  const emKey = _earModelOf(p);
  const measuredMode = !!EAR_MODELS[emKey]?.measured;
  const earLbl = EAR_MODELS[emKey]?.label ?? "custom ears";
  if (measuredMode) {
    ctx.fillStyle = "rgba(88,214,169,0.9)";
    ctx.textAlign = "right";
    ctx.fillText("● convolving measured HRIR — curves show the fitted model", w - 14, 16);
    ctx.textAlign = "left";
  }
  ctx.fillText(`${d.toFixed(1)} m · ${Math.round(clamp(p.spaceAzimuth ?? 0, -180, 180))}° · ${prof.label.toLowerCase()} ${decay.toFixed(1)}s · size ${size.toFixed(2)} · damp ${damping.toFixed(2)} · diffuse ${diffusion.toFixed(2)} · ${earLbl.toLowerCase()}`, L.x, h - 8);
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
    drawSpaceField();
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
  // spectralMix stays put — it has no control (legacy blend; a flat tone-print
  // gain in the fourier voice), so randomising it would silently change level.
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
  // Audit P0 (ui-audit-2026-07-08, phase-01 render): a compact centred
  // choice card over the dimmed studio — Just Play / Share Ratings / Load
  // Demo — with a one-click audition strip, instead of a wall of consent
  // text. The research detail lives one step deeper behind Share Ratings.
  const wave = Array.from({ length: 56 }, (_, i) => {
    const t = i / 55;
    const env = Math.sin(t * Math.PI);
    const h = 3 + 30 * env * (0.3 + 0.7 * Math.abs(Math.sin(i * 2.7) * Math.cos(i * 1.3)));
    return `<rect x="${i * 10}" y="${((36 - h) / 2).toFixed(1)}" width="4" height="${h.toFixed(1)}" rx="2"/>`;
  }).join("");
  return `
    <div class="card welcome-card" id="welcomeCard">
      <div class="welcome-hero">
        <span class="welcome-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <h2>Sound Studio</h2>
      </div>
      <div class="welcome-rule"><i></i></div>
      <p class="welcome-tagline">Welcome! Choose how you&rsquo;d like to get started.</p>
      <div class="welcome-main">
        <div class="welcome-audition">
          <svg class="welcome-wave" viewBox="0 0 554 36" preserveAspectRatio="none" aria-hidden="true">${wave}</svg>
          <button class="welcome-audition-play" id="welcomeAudition" title="Audition the current sound without leaving this card">▶</button>
        </div>
        <div class="welcome-choices">
          <div class="welcome-choice">
            <span class="welcome-choice-icon wc-amber">▶</span>
            <h3>Just Play</h3>
            <p>Start exploring sounds immediately.</p>
            <button class="welcome-cta cta-amber" id="welcomeOptOut">Just Play</button>
          </div>
          <div class="welcome-choice welcome-choice-featured">
            <span class="welcome-choice-icon wc-green">◈</span>
            <h3>Share Ratings</h3>
            <p>Help improve research by sharing ratings.</p>
            <div class="welcome-scale">${[1, 2, 3, 4, 5, 6, 7].map(n =>
              `<span class="${n === 4 ? "on" : ""}">${n}</span>`).join("")}</div>
            <div class="welcome-scale-ends"><span>1 = Dislike</span><span>7 = Love</span></div>
            <button class="welcome-cta cta-green" id="welcomeShareOpen">Share Ratings</button>
          </div>
          <div class="welcome-choice">
            <span class="welcome-choice-icon wc-purple">≣</span>
            <h3>Load Demo</h3>
            <p>Load a demo arrangement to hear ideas in context.</p>
            <button class="welcome-cta cta-purple" id="welcomeDemo">Load Demo</button>
          </div>
        </div>
      </div>
      <div class="welcome-share-step" hidden>
        <p>Sharing is anonymous and for adults (18+): the settings you explore and
        the ratings you give go to the researchers studying why music sounds good —
        no account, no personal details. Two optional questions help the analysis:</p>
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
          <button class="btn btn-secondary" id="welcomeShareBack">Back</button>
          <button class="btn btn-primary" id="welcomeOptIn">Start sharing</button>
        </div>
      </div>
      <p class="welcome-anon">🛡 No account. Anonymous if shared.</p>
      <p class="welcome-smallprint">You can change your choice any time from the note
      at the bottom of the page.</p>
    </div>`;
}

function wireWelcomeCard(v) {
  const card = v.querySelector("#welcomeCard");
  if (card) {
    // Audition without committing: preview the current settings from inside
    // the overlay. Stopped again on dismissal so the transport stays honest.
    let auditioning = false;
    const audBtn = card.querySelector("#welcomeAudition");
    audBtn.onclick = () => {
      if (synth.isPlaying) {
        synth.stop();
        auditioning = false;
        audBtn.textContent = "▶";
        return;
      }
      synth.play({ ...exploreParams });
      auditioning = true;
      audBtn.textContent = "❚❚";
    };
    const dismiss = (consent, { tour = true } = {}) => {
      if (auditioning && synth.isPlaying) synth.stop();
      saveConsent(consent);
      if (consent.status === "granted") {
        trackEngagement("consent", {
          consent: { status: "granted", consent_version: CONSENT_VERSION, demographics: consent.demographics },
        });
      }
      card.remove();
      updateResearchNote(v);
      window.scrollTo({ top: 0 }); // audit P0: no half-scrolled reveal
      if (tour) maybeStartStudioTour();
    };
    card.querySelector("#welcomeOptOut").onclick = () => dismiss({
      status: "declined",
      consent_version: CONSENT_VERSION,
      decided_at: new Date().toISOString(),
    });
    // Load Demo decides nothing about sharing — record a declined consent
    // (nothing leaves the browser) and jump straight into the producer demo.
    card.querySelector("#welcomeDemo").onclick = () => {
      dismiss({
        status: "declined",
        consent_version: CONSENT_VERSION,
        decided_at: new Date().toISOString(),
      }, { tour: false });
      loadDemoArrangement();
      navigate("produce");
    };
    const main = card.querySelector(".welcome-main");
    const share = card.querySelector(".welcome-share-step");
    card.querySelector("#welcomeShareOpen").onclick = () => { main.hidden = true; share.hidden = false; };
    card.querySelector("#welcomeShareBack").onclick = () => { share.hidden = true; main.hidden = false; };
    card.querySelector("#welcomeOptIn").onclick = () => {
      const demographics = {
        age_band: card.querySelector("#welcomeAge").value || null,
        musical_training: card.querySelector("#welcomeTraining").value || null,
      };
      dismiss({
        status: "granted",
        consent_version: CONSENT_VERSION,
        decided_at: new Date().toISOString(),
        demographics,
      });
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

  if (visMode === "lanes") { drawBehaviorLanes(); return; }
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
  if (visMode === "lanes") {
    // The future field keeps flowing while stopped (a slow audition drift),
    // so the lanes view stays on the animation loop even without playback.
    drawBehaviorLanes();
    cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(drawLoop);
    return;
  }
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

// Spec toggle: the live frequency response drawn faintly BEHIND the active
// view, so turning it on never costs the behaviour information.
function drawSpecOverlay(ctx, w, h) {
  if (!_visSpecOverlay || !synth.isPlaying) return;
  const data = synth.getSpectrum && synth.getSpectrum();
  if (!data) return;
  ctx.save();
  ctx.globalAlpha = 0.38;   // a ghost, but a readable one
  drawSpectrumCurve(ctx, data, w, h);
  ctx.restore();
}

// ── V2.1 behaviour timeline (MACRO_LANES_CHANGE_SPEC.md, 2026-07-08) ──
// Playhead at ~1/3: left = RECENT HISTORY (realized, solid), right =
// POSSIBLE FUTURE FIELD (settings-driven likelihood climate). The future
// side intentionally avoids pretending to know the next notes; it shows
// bounds, heat maps, onset/rest climates, surprise risk, and motif-memory
// tendency so an experienced user can infer the patch's sound at a glance.
const LANES_PLAYHEAD_FRAC = 0.32;
const LANE_DEFS = [
  { key: "melody", n: 1, title: "MELODY / PITCH", sub: "contour · hit distance", frac: 0.30, col: "#f5a623" },
  { key: "rhythm", n: 2, title: "RHYTHM & RESTS", sub: "onsets · durations · rests", frac: 0.24, col: "#60a5fa" },
  { key: "surprise", n: 3, title: "SURPRISE / INFORMATION", sub: "bits · distance from mean", frac: 0.20, col: "#38bdf8" },
  { key: "motif", n: 4, title: "MOTIF MEMORY", sub: "identity · drift · incorporation", frac: 0.26, col: "#4caf7d" },
];
const LANES_TOP_STRIP = 20; // zone-header band (CSS px; scaled by S below)
const LANES_GUTTER = 190;   // quiet lane-header gutter (CSS px; scaled by S)

const _SURPRISE_TAG = { pitch: "P", tuning: "T", rhythm: "R", dynamics: "D", formant: "F", rest: "Rest" };
let _macroFutureFieldCache = null;

function _evBits(e) {
  let b = 0, any = false;
  for (const k of ["pitchBits", "restBits", "dynBits"]) {
    if (Number.isFinite(e[k])) { b += e[k]; any = true; }
  }
  return any ? b : null;
}

// Enabled surprise dimensions ranked by weight — the future-field tags.
function _surpriseRisks(p) {
  const dims = [
    ["pitch", p.surprisePitchEnabled, p.surprisePitchWeight ?? 1],
    ["tuning", p.surpriseTuningEnabled, p.surpriseTuningWeight ?? 1],
    ["rhythm", p.surpriseRhythmEnabled, p.surpriseRhythmWeight ?? 1],
    ["dynamics", p.surpriseDynamicsEnabled, p.surpriseDynamicsWeight ?? 1],
    ["formant", p.surpriseFormantEnabled, p.surpriseFormantWeight ?? 1],
    ["rest", p.surpriseRestEnabled, p.surpriseRestWeight ?? 1],
  ].filter(([, on]) => on).sort((a, b) => b[2] - a[2]);
  return dims.map(([k]) => k);
}

// ── POSSIBLE FUTURE FIELD (audit/ui-audit-2026-07-08/MACRO_FUTURE_FIELD_BRIEF.md) ──
// makeMacroFutureField rolls the current macro settings many times through a
// miniature of the real generative model — scale-quantized interval walks
// (the engine's own Scale / intervalShapeWeight / registerWindow), motif
// repeat/variant/new choices, onset/rest sampling — and aggregates the rolls
// into a heat climate plus one representative sampled path. It is pure in the
// settings snapshot: the result (and its pre-rendered tile) is cached until a
// relevant setting changes, and only the presentation offset animates.

// Deterministic per-roll RNG (mulberry32) so the field never re-randomizes
// between frames for unchanged settings.
function _fieldRng(seedU32) {
  let a = (Math.floor(seedU32) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function _macroFutureKey(p) {
  const picked = {};
  [
    "seed", "scaleMode", "scalePreset", "customDegrees", "edoDivisions",
    "subScaleNotes", "subScaleWeight", "rootNotes", "rootPullStrength",
    "registerCenter", "registerWidth", "registerSkew",
    "intervalPeakedness", "intervalRange", "momentum",
    "motifHitProb", "motifHitRange",
    "surpriseProb", "surprisePitchEnabled", "surprisePitchDistance",
    "surpriseTuningEnabled", "surpriseRhythmEnabled", "surpriseDynamicsEnabled",
    "surpriseFormantEnabled", "surpriseRestEnabled",
    "beatDivisions", "onBeatProb", "offBeatProb", "sameLengthProb",
    "restMotifStartRatio", "restOnMeterRatio", "restOffMeterRatio", "gapProb",
    "motifCount", "motifLengthBeats", "motifLength", "sequenceProb",
    "motifSurpriseProb", "incorporationRate",
  ].forEach(k => { picked[k] = p[k]; });
  return JSON.stringify(picked);
}

// The active scale model, built the same way the engine builds it, so the
// future field quantizes to exactly the rows the patch can actually play.
function _fieldScale(p) {
  const div = p.scaleMode === "edo" ? Math.max(1, Math.round(p.edoDivisions || 12)) : 12;
  let degrees = (Array.isArray(p.customDegrees) && p.customDegrees.length)
    ? p.customDegrees
    : p.scaleMode === "edo"
      ? Array.from({ length: div }, (_, i) => i)
      : (SCALE_PRESETS[p.scalePreset]?.degrees || SCALE_PRESETS.major.degrees);
  degrees = [...new Set(degrees.map(d => ((Math.round(d) % div) + div) % div))].sort((a, b) => a - b);
  if (!degrees.length) degrees = [0];
  const sub = (Array.isArray(p.subScaleNotes) ? p.subScaleNotes : [])
    .map(d => ((Math.round(d) % div) + div) % div)
    .filter(d => degrees.includes(d));
  return new Scale(div, degrees, sub, clamp(Number(p.subScaleWeight ?? 0.5), 0, 1), p.tonicHz || 261.63, p.degreeTuning || null);
}

function makeMacroFutureField(p) {
  const key = _macroFutureKey(p);
  const seed = Math.max(1, Math.round(Number(p.seed) || 1));
  const scale = _fieldScale(p);
  const divs = Math.max(1, Math.round(p.beatDivisions || 1));
  const motifSteps = clamp(Math.round(Number(p.motifLengthBeats || p.motifLength || 4) * divs), 2, 48);
  const passes = 4;
  const steps = motifSteps * passes;
  const samples = 160;

  const range = Math.max(1, Math.round(Number(p.intervalRange ?? 7)));
  const peaked = clamp(Number(p.intervalPeakedness ?? 2), 0, 5);
  const momentum = clamp(Number(p.momentum ?? 0), 0, 1);
  const regCenter = Number(p.registerCenter ?? 0);
  const regWidth = Number(p.registerWidth ?? 12);
  const regSkew = Number(p.registerSkew ?? 0);
  const pull = clamp(Number(p.rootPullStrength ?? 0), 0, 1);
  const rootPcs = (Array.isArray(p.rootNotes) && p.rootNotes.length ? p.rootNotes : [0]).map(r => scale.norm(r));
  const hitProb = clamp(Number(p.motifHitProb ?? 1), 0, 1);
  const hitRange = Math.max(1, Math.round(Number(p.motifHitRange ?? 2)));
  const surprise = clamp(Number(p.surpriseProb ?? 0), 0, 1);
  const pitchSurprise = !!p.surprisePitchEnabled;
  const leapSteps = Math.max(1, Math.round(clamp(Number(p.surprisePitchDistance ?? 1), 0, 1) * range * 1.4));
  const onProb = clamp(Number(p.onBeatProb ?? 0.8), 0, 1);
  const offProb = clamp(Number(p.offBeatProb ?? 0.2), 0, 1);
  const sameLen = clamp(Number(p.sameLengthProb ?? 0.5), 0, 1);
  const restStart = clamp(Number(p.restMotifStartRatio ?? 0), 0, 0.95);
  const restOn = clamp(Number(p.restOnMeterRatio ?? 0), 0, 0.95);
  const restOff = clamp(Number(p.restOffMeterRatio ?? 0), 0, 0.95);
  const seq = clamp(Number(p.sequenceProb ?? 0.5), 0, 1);
  const mutation = clamp(Number(p.motifSurpriseProb ?? 0), 0, 1);
  const incorporation = clamp(Number(p.incorporationRate ?? 0), 0, 1);
  const motifCount = clamp(Math.round(Number(p.motifCount ?? 3)), 1, 8);
  const spanCap = scale.div * 2.2;   // keep outliers within ~2 octaves of centre

  // Interval candidates from the engine's melodic prior (interval shape ×
  // sub-scale bonus × register window × root pull), cached per centre degree.
  const candCache = new Map();
  const rootDistOf = (deg) => {
    let best = Infinity;
    for (const pc of rootPcs) {
      for (let oct = -2; oct <= 2; oct++) {
        best = Math.min(best, scale.stepDistance(deg, pc + oct * scale.div));
      }
    }
    return best;
  };
  const candidatesFor = (deg) => {
    const center = scale.nearest(deg);
    let entry = candCache.get(center);
    if (entry) return entry;
    const list = [];
    let up = 0, down = 0;
    const currentRootDist = pull > 0 ? rootDistOf(center) : 0;
    for (let step = -range; step <= range; step++) {
      const target = scale.stepFrom(center, step);
      if (Math.abs(target - regCenter) > spanCap) continue;
      let wgt = intervalShapeWeight(Math.abs(step), peaked, range);
      if (!(wgt > 0)) continue;
      wgt *= scale.sub.includes(scale.norm(target)) ? scale.weight : (1 - scale.weight);
      if (regWidth > 0 && regWidth < 100) {
        wgt *= Math.max(0.01, registerCurveValue(target - regCenter, regWidth, regSkew));
      }
      if (pull > 0) {
        const d = rootDistOf(target);
        if (d < currentRootDist) wgt *= 1 + pull * 2.0 * (1 - d / Math.max(1, currentRootDist));
        else if (d > currentRootDist) wgt *= Math.max(0.05, 1 - pull * 0.7);
      }
      const dir = Math.sign(step);
      if (dir > 0) up += wgt; else if (dir < 0) down += wgt;
      list.push({ target, dir, wgt });
    }
    let total = 0;
    for (const cnd of list) total += cnd.wgt;
    entry = { list, up, down, total };
    candCache.set(center, entry);
    return entry;
  };

  // One melodic move: momentum pushes P(same direction) toward 0.8, exactly
  // like the engine's `_pickBiasedNote`.
  const pickNext = (deg, prevDir, rng) => {
    const cands = candidatesFor(deg);
    if (!cands.list.length || !(cands.total > 0)) return { deg, dir: 0 };
    let fSame = 1, fOther = 1, total = cands.total;
    if (momentum > 0 && prevDir !== 0) {
      const same = prevDir > 0 ? cands.up : cands.down;
      const other = cands.total - same;
      if (same > 0 && other > 0) {
        const basePsame = same / cands.total;
        const targetPsame = Math.max(basePsame, basePsame + (0.8 - basePsame) * momentum);
        fSame = targetPsame / basePsame;
        fOther = (1 - targetPsame) / (1 - basePsame);
        total = same * fSame + other * fOther;
      }
    }
    let r = rng() * total;
    for (const cnd of cands.list) {
      r -= cnd.wgt * (cnd.dir === prevDir ? fSame : fOther);
      if (r <= 0) return { deg: cnd.target, dir: cnd.dir };
    }
    const last = cands.list[cands.list.length - 1];
    return { deg: last.target, dir: last.dir };
  };

  const startDeg = scale.nearest(regCenter);
  const walkNotes = (rng, n) => {
    let deg = startDeg, dir = 0, mv;
    for (let i = 0; i < 6; i++) { mv = pickNext(deg, dir, rng); deg = mv.deg; dir = mv.dir; }  // burn-in
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(deg);
      mv = pickNext(deg, dir, rng); deg = mv.deg; dir = mv.dir;
    }
    return out;
  };
  const sampleDur = (rng, prevDur) => {
    if (prevDur != null && rng() < sameLen) return prevDur;
    const r = rng();
    return r < 0.55 ? 1 : r < 0.85 ? 2 : Math.max(1, Math.round(divs * (0.5 + rng())));
  };
  const walkRhythm = (rng, n) => {
    const slots = [];
    let prevDur = null;
    for (let i = 0; i < n; i++) {
      const onBeat = i % divs === 0;
      const onset = rng() < (onBeat ? onProb : offProb);
      let dur = 0;
      if (onset) { dur = sampleDur(rng, prevDur); prevDur = dur; }
      slots.push({ onset, dur });
    }
    return slots;
  };

  // A small deterministic repertoire, generated by the same walk the samples
  // repeat from — motif structure is what makes repeats read as repeats.
  const motifs = [];
  for (let m = 0; m < motifCount; m++) {
    const rng = _fieldRng((seed ^ (0x517CC1B7 + m * 0x9E3779B9)) >>> 0);
    motifs.push({ notes: walkNotes(rng, motifSteps), rhythm: walkRhythm(rng, motifSteps) });
  }

  const stepMaps = Array.from({ length: steps }, () => new Map());
  const onsetCount = new Float32Array(steps);
  const restCount = new Float32Array(steps);
  const soundCount = new Float32Array(steps);
  const surpriseCount = new Float32Array(steps);
  const passCounts = Array.from({ length: passes }, () => ({ repeat: 0, variant: 0, neu: 0 }));
  const paths = [];

  for (let s = 0; s < samples; s++) {
    const rng = _fieldRng((seed ^ (0x85EBCA6B + s * 0xC2B2AE35)) >>> 0);
    const path = new Array(steps);
    let heldDeg = startDeg;
    let mutated = false;      // this roll incorporated new material earlier
    let variantShift = 0;     // persistent drift of the incorporated repertoire
    let prevDurHeld = 0;
    for (let k = 0; k < passes; k++) {
      const isNew = rng() < mutation;
      const ordered = rng() < seq;
      const idx = ordered ? k % motifCount : Math.floor(rng() * motifCount);
      const motif = motifs[Math.min(idx, motifs.length - 1)];
      let freshNotes = null, freshRhythm = null;
      if (isNew) {
        freshNotes = walkNotes(rng, motifSteps);
        freshRhythm = walkRhythm(rng, motifSteps);
        if (rng() < incorporation) {
          mutated = true;
          variantShift = rng() < 0.5 ? -1 : 1;
        }
      }
      let missedNotes = 0;
      for (let i = 0; i < motifSteps; i++) {
        const gi = k * motifSteps + i;
        const slot = isNew ? freshRhythm[i] : motif.rhythm[i];
        let onset = slot.onset;
        // imperfect hits also wobble the rhythm slightly on repeats
        if (!isNew && onset && rng() < (1 - hitProb) * 0.25) { onset = false; missedNotes++; }
        if (onset) {
          const onBeatSlot = i % divs === 0;
          const restP = i === 0
            ? Math.max(restStart, onBeatSlot ? restOn : restOff)
            : (onBeatSlot ? restOn : restOff);
          if (rng() < restP) {
            restCount[gi]++;
            prevDurHeld = 0;
            path[gi] = heldDeg;
            continue;
          }
          let deg = isNew ? freshNotes[i] : motif.notes[i];
          if (!isNew && mutated && variantShift !== 0) deg = scale.stepFrom(deg, variantShift);
          if (!isNew && rng() < 1 - hitProb) {
            const missSteps = 1 + Math.floor(rng() * hitRange);
            deg = scale.stepFrom(deg, rng() < 0.5 ? -missSteps : missSteps);
            missedNotes++;
          }
          if (rng() < surprise) {
            surpriseCount[gi]++;
            if (pitchSurprise) deg = scale.stepFrom(deg, rng() < 0.5 ? -leapSteps : leapSteps);
          }
          if (Math.abs(deg - regCenter) > spanCap) {
            deg = scale.nearest(regCenter + Math.sign(deg - regCenter) * spanCap);
          }
          heldDeg = deg;
          onsetCount[gi]++;
          prevDurHeld = Math.max(1, slot.dur);
        }
        if (prevDurHeld > 0) {
          soundCount[gi]++;
          stepMaps[gi].set(heldDeg, (stepMaps[gi].get(heldDeg) || 0) + 1);
          prevDurHeld--;
        }
        path[gi] = heldDeg;
      }
      // A pass reads as a variant when its material audibly drifted: an
      // out-of-order pick, incorporated new material, or a meaningful miss
      // rate (a lone imperfect hit still reads as a repeat).
      const drifted = missedNotes >= Math.max(2, Math.ceil(motifSteps * 0.25));
      const kind = isNew ? "neu" : (!ordered || mutated || drifted) ? "variant" : "repeat";
      passCounts[k][kind]++;
    }
    paths.push(path);
  }

  // Rows: every valid scale degree between the deposited extremes — a sparse
  // scale shows visibly fewer possible rows, a dense EDO shows more.
  let lo = Infinity, hi = -Infinity;
  for (const m of stepMaps) for (const d of m.keys()) { if (d < lo) lo = d; if (d > hi) hi = d; }
  if (!Number.isFinite(lo)) { lo = startDeg - 2; hi = startDeg + 2; }
  while (hi - lo < 4) { lo -= 1; hi += 1; }
  const rows = [];
  const rowOfDeg = new Map();
  for (let d = Math.floor(lo); d <= Math.ceil(hi); d++) {
    if (scale.nearest(d) !== d) continue;   // only rows the scale can play
    rowOfDeg.set(d, rows.length);
    rows.push({
      deg: d,
      isRoot: rootPcs.includes(scale.norm(d)),
      isSub: scale.sub.includes(scale.norm(d)),
    });
  }

  const heat = Array.from({ length: steps }, () => new Float32Array(rows.length));
  let maxHeat = 1;
  stepMaps.forEach((m, i) => {
    for (const [d, cnt] of m) {
      const r = rowOfDeg.get(d);
      if (r == null) continue;
      heat[i][r] += cnt;
      if (heat[i][r] > maxHeat) maxHeat = heat[i][r];
    }
  });

  // Representative path: the sampled roll that best follows the aggregate —
  // a real generated path, so every move is a valid scale interval.
  let best = 0, bestScore = -1;
  for (let s = 0; s < samples; s++) {
    let score = 0;
    for (let i = 0; i < steps; i++) {
      const r = rowOfDeg.get(paths[s][i]);
      if (r != null) score += heat[i][r];
    }
    if (score > bestScore) { bestScore = score; best = s; }
  }

  const norm = (arr) => Array.from(arr, v => v / samples);
  return {
    key, steps, motifSteps, passes, samples, divs,
    rows, rowOfDeg, heat, maxHeat,
    modePath: paths[best],
    loDeg: rows[0].deg, hiDeg: rows[rows.length - 1].deg,
    onsetHeat: norm(onsetCount),
    restHeat: norm(restCount),
    soundHeat: norm(soundCount),
    surpriseHeat: norm(surpriseCount),
    passStats: passCounts.map(c => ({
      repeat: c.repeat / samples,
      variant: c.variant / samples,
      neu: c.neu / samples,
    })),
    risk: surprise,
    dims: _surpriseRisks(p),
    gapProb: clamp(Number(p.gapProb ?? 0.4), 0, 1),
    scaleSize: scale.all.length,
    scaleDiv: scale.div,
  };
}
if (typeof window !== "undefined") window.makeMacroFutureField = makeMacroFutureField;  // debug/validation hook

function _macroFutureField(p) {
  const key = _macroFutureKey(p);
  if (_macroFutureFieldCache?.key === key) return _macroFutureFieldCache.value;
  const value = makeMacroFutureField(p);
  _macroFutureFieldCache = { key, value };
  _futureLayerCache = null;
  return value;
}

// Pre-rendered tile of the future field (all four lanes). The tile holds one
// full loop plus one extra step so the wrap seam stays continuous; the draw
// loop only translates it, so unchanged settings render an identical, stable
// field that merely flows past the playhead.
let _futureLayerCache = null;
let _fieldScrollPx = 0, _fieldScrollT = 0;

function _futureFieldLayer(field, geom) {
  const gkey = `${field.key}|${geom.stepPx.toFixed(3)}|${geom.h}|${geom.S.toFixed(3)}|${geom.lanes.map(L => `${L.top.toFixed(1)}-${L.bot.toFixed(1)}`).join(",")}`;
  if (_futureLayerCache?.gkey === gkey) return _futureLayerCache;

  const S = geom.S, px = geom.stepPx;
  const steps = field.steps;
  const loopW = steps * px;
  const cvs = document.createElement("canvas");
  cvs.width = Math.max(2, Math.ceil(loopW + px));
  cvs.height = Math.max(2, Math.ceil(geom.h));
  const c = cvs.getContext("2d");
  const cw = cvs.width;
  const F = (size, weight = "") => `${weight}${weight ? " " : ""}${Math.round(size * S)}px ui-monospace, monospace`;
  const [L1, L2, L3, L4] = geom.lanes;
  const at = (i) => i % steps;   // wrap for the seam column

  // ── pitch: scale-degree heat rows + representative sampled path ──
  const laneH1 = L1.bot - L1.top;
  const span = Math.max(1, field.hiDeg - field.loDeg);
  const padY = laneH1 * 0.06;
  const yOfDeg = (d) => L1.bot - padY - ((d - field.loDeg) / span) * (laneH1 - 2 * padY);
  const unitH = (laneH1 - 2 * padY) / span;
  const bandH = clamp(unitH * 0.92, 1.4, 12 * S);
  for (const r of field.rows) {
    // valid-row guides: sparse scales visibly offer fewer paths; roots glow
    const y = yOfDeg(r.deg);
    c.fillStyle = r.isRoot ? "rgba(245,166,35,0.13)" : "rgba(160,175,195,0.05)";
    c.fillRect(0, y - 0.5 * S, cw, Math.max(1, 0.8 * S));
  }
  for (let i = 0; i < steps; i++) {
    const col = field.heat[i];
    const x = i * px;
    for (let r = 0; r < col.length; r++) {
      const d = col[r] / field.maxHeat;
      if (d < 0.02) continue;
      const y = yOfDeg(field.rows[r].deg);
      const a = Math.pow(d, 0.72);
      c.fillStyle = `rgba(245,166,35,${(0.04 + a * 0.10).toFixed(3)})`;
      c.fillRect(x, y - bandH * 1.1, px + 0.6, bandH * 2.2);   // soft halo
      c.fillStyle = `rgba(245,166,35,${(0.06 + a * 0.30).toFixed(3)})`;
      c.fillRect(x, y - bandH / 2, px + 0.6, bandH);           // core band
    }
  }
  const pathPt = (i) => [(i + 0.5) * px, yOfDeg(field.modePath[at(i)])];
  const drawPath = (width, style) => {
    c.strokeStyle = style;
    c.lineWidth = width;
    c.lineJoin = "round";
    c.lineCap = "round";
    c.beginPath();
    let [x0, y0] = pathPt(0);
    c.moveTo(x0, y0);
    for (let i = 1; i <= steps; i++) {
      const [x1, y1] = pathPt(i);
      // midpoint smoothing: musical motion, not a mechanical zig-zag
      c.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      x0 = x1; y0 = y1;
    }
    c.lineTo(x0, y0);
    c.stroke();
  };
  drawPath(4.5 * S, "rgba(255,198,80,0.14)");
  drawPath(1.7 * S, "rgba(255,198,80,0.85)");

  // ── rhythm: sampled onset/rest/duration climate (density forecast) ──
  const microH = 4 * S;
  const bodyBot = L2.bot - microH - 3 * S;
  const durH = 7 * S;
  const stemTop = L2.top + 2 * S;
  for (let i = 0; i < steps; i++) {
    const x = i * px;
    const onset = field.onsetHeat[i];
    const rest = field.restHeat[i];
    const sound = field.soundHeat[i];
    const colW = Math.max(1.5 * S, px * 0.72);
    const cx = x + (px - colW) / 2;
    if (i % field.motifSteps === 0) {   // motif-pass accent keeps the meter legible
      c.fillStyle = "rgba(96,165,250,0.09)";
      c.fillRect(x, L2.top, Math.max(S, px * 0.28), L2.bot - L2.top);
    }
    if (onset > 0.01) {
      const hgt = (0.10 + 0.90 * onset) * (bodyBot - durH - stemTop);
      const g = c.createLinearGradient(0, bodyBot - durH - hgt, 0, bodyBot - durH);
      g.addColorStop(0, `rgba(96,165,250,${0.02 + onset * 0.10})`);
      g.addColorStop(1, `rgba(96,165,250,${0.10 + onset * 0.30})`);
      c.fillStyle = g;
      c.fillRect(cx, bodyBot - durH - hgt, colW, hgt);
    }
    if (sound > 0.01) {   // sustain coverage — the duration density band
      c.fillStyle = `rgba(96,165,250,${0.05 + sound * 0.30})`;
      c.fillRect(x, bodyBot - durH, px + 0.6, durH);
    }
    if (rest > 0.01) {    // silence pressure
      c.fillStyle = `rgba(229,72,77,${0.05 + rest * 0.55})`;
      c.fillRect(x, bodyBot + 1.5 * S, px + 0.6, durH * 0.95);
    }
    // articulation: continuous gap/legato band, breathing with density
    c.fillStyle = `rgba(95,212,200,${((0.08 + field.gapProb * 0.24) * (0.6 + sound * 0.4)).toFixed(3)})`;
    c.fillRect(x, L2.bot - microH, px + 0.6, microH);
  }

  // ── surprise: layered risk climate (one layer per enabled dimension) ──
  if (field.risk > 0.005 && field.dims.length) {
    const avail = L3.bot - L3.top - 14 * S;
    let maxS = 0;
    for (const v of field.surpriseHeat) maxS = Math.max(maxS, v);
    const nDims = Math.min(4, field.dims.length);
    for (let li = 0; li < nDims; li++) {
      const frac = (li + 1) / nDims;
      c.fillStyle = `rgba(56,189,248,${(0.05 + field.risk * 0.10).toFixed(3)})`;
      c.beginPath();
      c.moveTo(0, L3.bot);
      for (let i = 0; i <= steps; i++) {
        const rel = maxS > 0 ? field.surpriseHeat[at(i)] / maxS : 0;
        const hgt = avail * field.risk * (0.30 + 0.70 * rel) * frac;
        c.lineTo(i * px, L3.bot - hgt);
      }
      c.lineTo(cw, L3.bot);
      c.closePath();
      c.fill();
    }
  }

  // ── motif: generic pass windows showing repeat / variant / new pressure ──
  const labelH = 13 * S, stripRow = 6 * S;
  for (let k = 0; k < field.passes; k++) {
    const st = field.passStats[k];
    const x0 = k * field.motifSteps * px + 2 * S;
    const bw = field.motifSteps * px - 4 * S;
    if (bw < 10 * S) continue;
    const total = Math.max(0.001, st.repeat + st.variant + st.neu);
    const wRep = bw * st.repeat / total, wVar = bw * st.variant / total;
    const wNew = Math.max(0, bw - wRep - wVar);
    const dominant = st.repeat >= st.variant && st.repeat >= st.neu
      ? ["repeat", "#4caf7d"]
      : st.variant >= st.neu ? ["variant", "#5fd4c8"] : ["new", "#e5a53a"];
    // block fill split into the sampled green/teal/amber proportions
    c.save();
    roundRectPath(c, x0, L4.top, bw, labelH, 3 * S);
    c.clip();
    c.fillStyle = `rgba(76,175,125,${0.10 + st.repeat * 0.34})`;
    c.fillRect(x0, L4.top, wRep, labelH);
    c.fillStyle = `rgba(95,212,200,${0.10 + st.variant * 0.36})`;
    c.fillRect(x0 + wRep, L4.top, wVar, labelH);
    c.fillStyle = `rgba(229,165,58,${0.10 + st.neu * 0.42})`;
    c.fillRect(x0 + wRep + wVar, L4.top, wNew, labelH);
    c.restore();
    c.strokeStyle = dominant[1];
    c.lineWidth = 1.2 * S;
    roundRectPath(c, x0, L4.top, bw, labelH, 3 * S);
    c.stroke();
    if (bw > 64 * S) {
      c.fillStyle = dominant[1];
      c.font = F(8.5, "700");
      c.textAlign = "center";
      c.fillText(`${dominant[0]} pressure`, x0 + bw / 2, L4.top + 9.5 * S);
      c.textAlign = "left";
    }
    // stacked probability bar
    const barY = L4.top + labelH + 3 * S;
    c.fillStyle = `rgba(76,175,125,${0.18 + st.repeat * 0.6})`;
    c.fillRect(x0, barY, wRep, stripRow);
    c.fillStyle = `rgba(95,212,200,${0.16 + st.variant * 0.55})`;
    c.fillRect(x0 + wRep, barY, wVar, stripRow);
    c.fillStyle = `rgba(229,165,58,${0.14 + st.neu * 0.6})`;
    c.fillRect(x0 + wRep + wVar, barY, wNew, stripRow);
    // expected drift heat: hotter as variant/new pressure grows
    c.fillStyle = heatColor(clamp(st.variant * 0.5 + st.neu, 0, 1), 0.35);
    c.fillRect(x0, barY + stripRow + 2 * S, bw, stripRow * 1.2);
  }

  _futureLayerCache = { gkey, canvas: cvs, loopW };
  return _futureLayerCache;
}

function drawBehaviorLanes() {
  if (!canvas || !canvasCtx) return;
  const ctx = canvasCtx;
  const w = canvas.width, h = canvas.height;
  visBackdrop(ctx, w, h);
  drawSpecOverlay(ctx, w, h);

  // scale factor: draw metrics in CSS-consistent sizes on the DPR backing
  const S = Math.max(1, w / Math.max(1, canvas.clientWidth || w));
  const F = (px, weight = "") => `${weight}${weight ? " " : ""}${Math.round(px * S)}px ui-monospace, monospace`;
  const gutter = Math.min(w * 0.34, LANES_GUTTER * S);
  const plotLeft = gutter;
  const plotW = Math.max(1, w - plotLeft);

  const tl = synth.getNoteTimeline ? synth.getNoteTimeline() : null;
  const playheadX = Math.round(plotLeft + plotW * LANES_PLAYHEAD_FRAC);
  const now = tl ? tl.now : 0;
  const PPS = MOTIF_PX_PER_SEC * S;
  const X = (t) => playheadX + (t - now) * PPS;
  const p = exploreParams;
  const futureField = _macroFutureField(p);

  // ── zone headers ──
  const strip = LANES_TOP_STRIP * S;
  ctx.fillStyle = "rgba(5, 10, 15, 0.58)";
  ctx.fillRect(0, 0, plotLeft, h);
  ctx.strokeStyle = "rgba(100, 120, 140, 0.18)";
  ctx.beginPath(); ctx.moveTo(plotLeft + 0.5, strip); ctx.lineTo(plotLeft + 0.5, h); ctx.stroke();
  ctx.font = F(9, "600");
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(150,163,178,0.75)";
  ctx.fillText("RECENT HISTORY", plotLeft + (playheadX - plotLeft) / 2, strip * 0.62);
  ctx.fillStyle = "rgba(96,165,250,0.85)";
  ctx.fillText("POSSIBLE FUTURE FIELD", playheadX + (w - playheadX) / 2, strip * 0.62);
  // future zone tint
  ctx.fillStyle = "rgba(56,120,220,0.045)";
  ctx.fillRect(playheadX, strip, w - playheadX, h - strip);

  // ── lane geometry ──
  const lanes = LANE_DEFS.map(d => ({ ...d }));
  let y0 = strip;
  for (const L of lanes) {
    const lh = (h - strip) * L.frac;
    L.top = y0 + 10 * S;
    L.bot = y0 + lh - 6 * S;
    y0 += lh;
    ctx.strokeStyle = "rgba(90,110,130,0.18)";
    ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(w, y0 + 0.5); ctx.stroke();
  }
  // beat gridlines (tempo grid, not wall seconds)
  const beatSec = 60 / Math.max(30, p.tempo || 104);
  ctx.strokeStyle = "rgba(96,165,250,0.06)";
  const firstBeat = Math.floor((now - playheadX / PPS) / beatSec) * beatSec;
  for (let t = firstBeat; X(t) < w; t += beatSec) {
    const x = X(t);
    if (x < plotLeft) continue;
    ctx.beginPath(); ctx.moveTo(x, strip); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.textAlign = "left";

  const hasTimeline = !!(tl && tl.events && tl.events.length);
  if (!hasTimeline) {
    ctx.fillStyle = "rgba(150,170,190,0.36)";
    ctx.font = F(9, "600");
    ctx.textAlign = "center";
    ctx.fillText("press play for realized history", plotLeft + (playheadX - plotLeft) / 2, h * 0.5);
    ctx.textAlign = "left";
  }

  const allEvents = hasTimeline ? tl.events : [];
  const evs = allEvents.filter(e => X(e.when + e.dur) > -8 && X(e.when) < w + 8);
  const notes = evs.filter(e => !e.isRest && e.velocity > 0 && e.frequency > 0);
  const realizedEvs = evs.filter(e => e.when <= now);
  const realizedNotes = notes.filter(e => e.when <= now);
  const div = p.scaleMode === "edo" ? (p.edoDivisions || 12) : 12;
  const motifUnitsAll = visGroupMotifs(allEvents);

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, strip, plotW, h - strip);
  ctx.clip();

  // ══ LANE 1 · MELODY / PITCH ══
  const L1 = lanes[0];
  if (realizedNotes.length) {
    let lo = Infinity, hi = -Infinity;
    for (const n of realizedNotes) {
      const s = Math.log2(n.frequency);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    // leave head-room for the future likelihood field
    const hitDeg = Math.max(1, Math.round(p.motifHitRange ?? 2));
    const bandOct = hitDeg * (1 / Math.max(5, div));
    lo -= bandOct; hi += bandOct;
    if (hi - lo < 0.8) { const mid = (hi + lo) / 2; lo = mid - 0.4; hi = mid + 0.4; }
    const Y = (f) => L1.bot - (Math.log2(f) - lo) / (hi - lo) * (L1.bot - L1.top);

    // rolling expectation (EMA of realized pitch) — the faint mean line
    let ema = null;
    const emaPts = [];
    for (const n of realizedNotes) {
      const s = Math.log2(n.frequency);
      ema = ema == null ? s : ema * 0.75 + s * 0.25;
      emaPts.push([X(n.when), L1.bot - (ema - lo) / (hi - lo) * (L1.bot - L1.top), n.when]);
    }
    ctx.strokeStyle = "rgba(200,210,225,0.28)";
    ctx.lineWidth = S;
    ctx.setLineDash([2 * S, 3 * S]);
    ctx.beginPath();
    emaPts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    ctx.setLineDash([]);

    // heat backing: information distance behind each realized note
    for (const n of realizedNotes) {
      if (!Number.isFinite(n.pitchBits) || n.when > now) continue;
      const t = clamp(n.pitchBits / 7, 0, 1);
      if (t < 0.25) continue;
      const x = X(n.when), y = Y(n.frequency);
      const r = (7 + t * 11) * S;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,${Math.round(140 - t * 90)},40,${0.34 * t})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    // contour: solid realized history only
    const seg = (filter, dash) => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = "rgba(245,166,35,0.75)";
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      let started = false, prev = null;
      for (const n of realizedNotes) {
        if (!filter(n)) { started = false; continue; }
        const x = X(n.when), y = Y(n.frequency);
        if (!started) {
          if (prev) ctx.moveTo(X(prev.when), Y(prev.frequency)), ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
        prev = n;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    seg(n => n.when <= now, []);

    // note dots: realized events only; the future side is a likelihood field.
    for (const n of realizedNotes) {
      const x = X(n.when), y = Y(n.frequency);
      ctx.lineWidth = 1.4 * S;
      ctx.fillStyle = n.isSurprise ? "#ffe07a" : "#f5a623";
      ctx.beginPath(); ctx.arc(x, y, (n.isSurprise ? 3.2 : 2.5) * S, 0, 2 * Math.PI); ctx.fill();
    }

    // surprise tags: dimension letter + real bits ("P 5.2b")
    ctx.font = F(8, "700");
    ctx.textAlign = "center";
    for (const n of realizedNotes) {
      if (!n.isSurprise || !(n.surpriseFeatures || []).includes("pitch")) continue;
      const x = X(n.when), y = Y(n.frequency);
      const label = Number.isFinite(n.pitchBits) ? `P ${n.pitchBits.toFixed(1)}b` : "P";
      const tw = ctx.measureText(label).width + 8 * S;
      ctx.fillStyle = "rgba(58,38,10,0.92)";
      ctx.strokeStyle = "#f5a623";
      ctx.lineWidth = S;
      const ty = y - 14 * S;
      roundRectPath(ctx, x - tw / 2, ty - 8 * S, tw, 11 * S, 3 * S);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffd28a";
      ctx.fillText(label, x, ty);
    }
    ctx.textAlign = "left";
  }

  // Settings roll-field: many deterministic draws from the current macro
  // settings, pre-rendered as a looped tile (all four lanes) and scrolled
  // left through the playhead like an audition of the current settings.
  // The sampled field itself stays fixed until a relevant setting changes.
  const fieldStart = playheadX + 5 * S;
  const stepPx = Math.max(1.5, (beatSec / futureField.divs) * PPS);
  const fieldLayer = _futureFieldLayer(futureField, {
    stepPx, h, S, lanes: lanes.map(L => ({ top: L.top, bot: L.bot })),
  });
  const tScroll = performance.now();
  const dtScroll = _fieldScrollT ? Math.min(0.1, Math.max(0, (tScroll - _fieldScrollT) / 1000)) : 0;
  _fieldScrollT = tScroll;
  // full tempo during playback; a slow drift while stopped so the field
  // still reads as a flowing surface rather than a frozen picture
  _fieldScrollPx = (_fieldScrollPx + dtScroll * PPS * (synth.isPlaying ? 1 : 0.3)) % fieldLayer.loopW;
  ctx.save();
  ctx.beginPath();
  ctx.rect(fieldStart, strip, w - fieldStart, h - strip);
  ctx.clip();
  for (let tileX = fieldStart - _fieldScrollPx; tileX < w; tileX += fieldLayer.loopW) {
    if (tileX + fieldLayer.canvas.width > fieldStart) ctx.drawImage(fieldLayer.canvas, tileX, 0);
  }
  // dissolve into the playhead as each loop arrives at "now"
  const fadeW = 30 * S;
  const fadeG = ctx.createLinearGradient(fieldStart, 0, fieldStart + fadeW, 0);
  fadeG.addColorStop(0, "rgba(11,18,25,0.92)");
  fadeG.addColorStop(1, "rgba(11,18,25,0)");
  ctx.fillStyle = fadeG;
  ctx.fillRect(fieldStart, strip, fadeW, h - strip);
  ctx.restore();
  ctx.fillStyle = "rgba(150,163,178,0.6)";
  ctx.font = F(8);
  ctx.textAlign = "right";
  ctx.fillText(
    `settings roll field · ${futureField.samples} draws · ${futureField.scaleSize}/${futureField.scaleDiv} scale rows`,
    w - 6 * S, L1.top + 9 * S);
  ctx.textAlign = "left";

  // ══ LANE 2 · RHYTHM & RESTS ══
  const L2 = lanes[1];
  const microH = 4 * S;                       // gap/legato micro-row
  const bodyBot = L2.bot - microH - 3 * S;
  const durH = 7 * S;
  for (const e of realizedEvs) {
    const x = X(e.when);
    const bw = Math.max(2 * S, e.dur * PPS - S);
    if (e.isRest || !(e.velocity > 0)) {
      // rest block: muted red outline
      ctx.strokeStyle = "rgba(229,72,77,0.7)";
      ctx.lineWidth = S;
      roundRectPath(ctx, x, bodyBot - durH, bw, durH, 2 * S);
      ctx.stroke();
      continue;
    }
    // duration-deviation heat behind the body
    if (e.rhythmDev > 0.02) {
      const t = clamp(e.rhythmDev, 0, 1);
      const g = ctx.createLinearGradient(x, 0, x + bw, 0);
      g.addColorStop(0, `rgba(80,150,255,${0.28 * t})`);
      g.addColorStop(1, "rgba(80,150,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - 2 * S, bodyBot - durH - 3 * S, bw + 4 * S, durH + 6 * S);
    }
    // duration body: realized past only
    ctx.fillStyle = "rgba(96,165,250,0.5)";
    roundRectPath(ctx, x, bodyBot - durH, bw, durH, 2 * S);
    ctx.fill();
    // onset stem + lollipop above the body
    const oh = (0.35 + 0.65 * clamp(e.velocity, 0, 1)) * (bodyBot - durH - L2.top);
    ctx.strokeStyle = "rgba(96,165,250,0.95)";
    ctx.lineWidth = 1.6 * S;
    ctx.beginPath(); ctx.moveTo(x + S, bodyBot - durH); ctx.lineTo(x + S, bodyBot - durH - oh); ctx.stroke();
    ctx.fillStyle = "rgba(96,165,250,0.95)";
    ctx.beginPath(); ctx.arc(x + S, bodyBot - durH - oh, 2.2 * S, 0, 2 * Math.PI); ctx.fill();
  }
  // gap/legato micro-row: teal where sound carries, dark where gapped
  ctx.fillStyle = "rgba(95,212,200,0.55)";
  for (const e of realizedEvs) {
    if (e.isRest || !(e.velocity > 0)) continue;
    const x = X(e.when);
    const bw = Math.max(S, e.dur * PPS - S);
    ctx.globalAlpha = 1;
    ctx.fillRect(x, L2.bot - microH, bw, microH);
  }
  ctx.globalAlpha = 1;

  // (Future onset/rest/duration climate is part of the scrolled field tile.)

  // ══ LANE 3 · SURPRISE / INFORMATION ══
  const L3 = lanes[2];
  const bitsList = realizedEvs.map(e => [e, _evBits(e)]).filter(([, b]) => Number.isFinite(b));
  const realizedBits = bitsList.map(([, b]) => b);
  const meanBits = realizedBits.length ? realizedBits.reduce((a, b) => a + b, 0) / realizedBits.length : 0;
  const maxBits = Math.max(8, ...bitsList.map(([, b]) => b));
  const YB = (b) => L3.bot - clamp(b / maxBits, 0, 1) * (L3.bot - L3.top - 10 * S);
  // mean + threshold reference lines
  const thresholdBits = meanBits * 1.5;
  ctx.font = F(8);
  for (const [val, label, col] of [[meanBits, `mean (${meanBits.toFixed(1)}b)`, "rgba(150,163,178,0.5)"], [thresholdBits, `threshold (${thresholdBits.toFixed(1)}b)`, "rgba(56,189,248,0.45)"]]) {
    if (!(val > 0)) continue;
    ctx.strokeStyle = col;
    ctx.setLineDash([3 * S, 4 * S]);
    ctx.beginPath(); ctx.moveTo(plotLeft, YB(val)); ctx.lineTo(w, YB(val)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = col;
    ctx.fillText(label, plotLeft + 5 * S, YB(val) - 2 * S);
  }
  // information trace: realized history only
  ctx.strokeStyle = "rgba(95,212,200,0.8)";
  ctx.lineWidth = 1.2 * S;
  ctx.beginPath();
  bitsList.forEach(([e, b], i) => {
    const x = X(e.when), y = YB(b);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = "rgba(150,163,178,0.55)";
  ctx.font = F(8);
  ctx.fillText("settings risk field", playheadX + 8 * S, L3.top + 8 * S);
  // surprise tags: stacked feature letters at each surprise event
  ctx.font = F(8, "700");
  ctx.textAlign = "center";
  for (const [e, b] of bitsList) {
    if (!e.isSurprise) continue;
    const x = X(e.when);
    ctx.strokeStyle = "rgba(56,189,248,0.9)";
    ctx.lineWidth = 1.4 * S;
    ctx.beginPath(); ctx.moveTo(x, L3.bot); ctx.lineTo(x, YB(b)); ctx.stroke();
    const feats = (e.surpriseFeatures && e.surpriseFeatures.length) ? e.surpriseFeatures : (e.isRest ? ["rest"] : ["pitch"]);
    feats.slice(0, 3).forEach((f, i) => {
      const label = _SURPRISE_TAG[f] || "?";
      const ty = YB(b) - (6 + i * 12) * S;
      const tw = ctx.measureText(label).width + 7 * S;
      ctx.fillStyle = "rgba(14,24,34,0.92)";
      ctx.strokeStyle = "rgba(56,189,248,0.85)";
      ctx.lineWidth = S;
      roundRectPath(ctx, x - tw / 2, ty - 9 * S, tw, 11 * S, 3 * S);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8ee3ff";
      ctx.fillText(label, x, ty);
    });
  }
  ctx.textAlign = "left";
  // The future risk climate lives in the scrolled field tile; here only the
  // compact legend of enabled surprise dimensions (badges, not predicted events).
  const risk = clamp(p.surpriseProb ?? 0, 0, 1);
  if (risk > 0.01) {
    const riskFeats = _surpriseRisks(p).slice(0, 4);
    ctx.font = F(8, "700");
    let badgeX = playheadX + 12 * S;
    for (const f of riskFeats) {
      const label = _SURPRISE_TAG[f] || "?";
      const tw = ctx.measureText(label).width + 8 * S;
      ctx.fillStyle = "rgba(14,24,34,0.88)";
      ctx.strokeStyle = "rgba(56,189,248,0.45)";
      roundRectPath(ctx, badgeX, L3.top + 12 * S, tw, 11 * S, 3 * S);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(142,227,255,0.72)";
      ctx.textAlign = "center";
      ctx.fillText(label, badgeX + tw / 2, L3.top + 20 * S);
      badgeX += tw + 4 * S;
    }
    ctx.textAlign = "left";
  }

  // ══ LANE 4 · MOTIF MEMORY ══
  const L4 = lanes[3];
  const units = motifUnitsAll.filter(u => X(u.end) > -4 && X(u.start) < w + 4 && u.start <= now);
  const labelH = 13 * S, stripRow = 6 * S, stateH = 11 * S;
  const seen = new Map(); // baseIndex → appearances (for stable vs active)
  for (const u of units) {
    const x0 = X(u.start), x1 = Math.min(playheadX, X(u.end));
    const bw = Math.max(6 * S, x1 - x0 - 2 * S);
    const future = false;
    const count = (seen.get(u.baseIndex) || 0) + 1;
    seen.set(u.baseIndex, count);
    const state = u.hasSurprise ? "new" : u.isVariant ? "evolving" : count > 2 ? "stable" : "active";
    const col = state === "new" ? "#e5a53a" : state === "evolving" ? "#5fd4c8" : "#4caf7d";
    // identity block
    ctx.strokeStyle = col;
    ctx.globalAlpha = future ? 0.6 : 1;
    ctx.lineWidth = 1.3 * S;
    ctx.setLineDash(future ? [4 * S, 3 * S] : []);
    roundRectPath(ctx, x0 + S, L4.top, bw, labelH, 3 * S);
    ctx.fillStyle = future ? "rgba(14,20,28,0.6)" : "rgba(20,32,26,0.85)";
    ctx.fill(); ctx.stroke();
    ctx.setLineDash([]);
    if (bw > 16 * S) {
      ctx.fillStyle = col;
      ctx.font = F(9, "700");
      ctx.textAlign = "center";
      const tag = motifLabel(u.baseIndex) + (u.isVariant ? "′" : "") + (future ? "  next" : "");
      ctx.fillText(bw > 52 * S ? tag : motifLabel(u.baseIndex) + (u.isVariant ? "′" : ""), x0 + S + bw / 2, L4.top + 10 * S);
      ctx.textAlign = "left";
    }
    // drift heat strips (pitch, rhythm)
    const sy = L4.top + labelH + 2 * S;
    ctx.fillStyle = heatColor(clamp(u.pitchDev, 0, 1), future ? 0.4 : 0.8);
    ctx.fillRect(x0 + S, sy, bw, stripRow);
    ctx.fillStyle = heatColor(clamp(u.rhythmDev, 0, 1), future ? 0.4 : 0.8);
    ctx.fillRect(x0 + S, sy + stripRow + S, bw, stripRow);
    // incorporation row: state text + diamond
    const iy = L4.bot - stateH;
    if (bw > 34 * S) {
      ctx.strokeStyle = "rgba(120,135,150,0.3)";
      ctx.lineWidth = S;
      roundRectPath(ctx, x0 + S, iy, bw, stateH, 2 * S);
      ctx.stroke();
      ctx.fillStyle = future ? "rgba(150,163,178,0.55)" : "rgba(180,195,210,0.8)";
      ctx.font = F(7.5, "600");
      ctx.textAlign = "center";
      ctx.fillText(state.toUpperCase(), x0 + S + bw / 2, iy + 8.5 * S);
      ctx.textAlign = "left";
    }
    if (u.hasSurprise) {
      const dx = x0 + S + bw / 2, dy = L4.bot + 0.5;
      ctx.save();
      ctx.translate(dx, dy - 3 * S);
      ctx.rotate(Math.PI / 4);
      if (future) {
        ctx.strokeStyle = "#ffe07a";
        ctx.lineWidth = S;
        ctx.strokeRect(-2.4 * S, -2.4 * S, 4.8 * S, 4.8 * S);
      } else {
        ctx.fillStyle = "#ffe07a";
        ctx.fillRect(-2.4 * S, -2.4 * S, 4.8 * S, 4.8 * S);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  // (Future motif repeat/variant/new pressure windows are part of the
  // scrolled field tile — generic pass slots, never named identities.)

  ctx.restore();
  _drawLanesNow(ctx, playheadX, h, strip, S);
}

// ── Lane header overlay + per-lane key popovers (spec: quiet headers,
// detailed legends behind the i buttons; one key open at a time). ──
const LANE_KEYS = {
  melody: {
    title: "Melody key",
    rows: [
      ["k-line-amber", "realized pitch contour"],
      ["k-line-amber-dash", "representative sampled path"],
      ["k-line-gray-dash", "rolling expectation (mean)"],
      ["k-band", "scale-degree likelihood heat (settings rolls)"],
      ["k-heat", "information heat (bits from expectation)"],
      ["k-tag", "surprise tag · P 5.2b = pitch, 5.2 bits"],
    ],
  },
  rhythm: {
    title: "Rhythm key",
    rows: [
      ["k-onset", "onset (height = velocity)"],
      ["k-dur", "duration"],
      ["k-heat-blue", "duration deviation"],
      ["k-rest", "rest"],
      ["k-gap", "gap / legato"],
      ["k-dur-dash", "onset / rest density forecast"],
    ],
  },
  surprise: {
    title: "Surprise key",
    rows: [
      ["k-line-teal", "information per note (model bits)"],
      ["k-line-gray-dash", "mean · threshold lines"],
      ["k-tag-cyan", "P T R D F Rest = surprise dimension"],
      ["k-tag-cyan-dash", "future risk climate (per enabled dimension)"],
    ],
  },
  motif: {
    title: "Motif key",
    rows: [
      ["k-block-green", "motif block (A, B, A′ = variant)"],
      ["k-heat", "pitch-drift · rhythm-drift strips"],
      ["k-diamond", "incorporation (solid = realized)"],
      ["k-block-amber-dash", "repeat / variant / new pressure window"],
    ],
  },
};

function layoutLaneHeads() {
  const heads = document.getElementById("m2LaneHeads");
  const cv = document.getElementById("vis");
  if (!heads || !cv) return;
  const H = cv.clientHeight || cv.getBoundingClientRect().height;
  if (!H) return;
  let y = LANES_TOP_STRIP;
  heads.querySelectorAll(".m2-lane-head").forEach((el, i) => {
    const lh = (H - LANES_TOP_STRIP) * (LANE_DEFS[i]?.frac || 0.25);
    el.style.top = `${Math.round(y)}px`;
    el.style.height = `${Math.round(lh)}px`;
    y += lh;
  });
}

function wireLaneHeads(v) {
  const heads = v.querySelector("#m2LaneHeads");
  const key = v.querySelector("#m2LaneKey");
  if (!heads || !key) return;
  layoutLaneHeads();
  let openFor = null;
  const close = () => { key.hidden = true; openFor = null; };
  const open = (laneKey, btn) => {
    const def = LANE_KEYS[laneKey];
    if (!def) return;
    key.innerHTML = `
      <div class="m2-key-head"><span>${esc(def.title)}</span><button class="m2-key-close" aria-label="Close">×</button></div>
      ${def.rows.map(([sw, label]) => `<div class="m2-key-row"><span class="k-sw ${sw}"></span><span>${esc(label)}</span></div>`).join("")}`;
    const head = btn.closest(".m2-lane-head");
    key.style.top = `${Math.min(head.offsetTop, (heads.parentElement.clientHeight || 400) - 170)}px`;
    key.style.left = `${heads.offsetWidth + 10}px`;
    key.hidden = false;
    openFor = laneKey;
    key.querySelector(".m2-key-close").onclick = close;
  };
  heads.querySelectorAll("[data-lane-key]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const k = btn.dataset.laneKey;
      if (openFor === k) close(); else open(k, btn);
    };
  });
  // singleton document listeners (renderExplore re-runs this wiring)
  if (window._laneKeyDocClick) document.removeEventListener("click", window._laneKeyDocClick, true);
  window._laneKeyDocClick = (e) => {
    if (!key.hidden && !e.target.closest("#m2LaneKey") && !e.target.closest("[data-lane-key]")) close();
  };
  document.addEventListener("click", window._laneKeyDocClick, true);
  if (window._laneKeyDocEsc) document.removeEventListener("keydown", window._laneKeyDocEsc);
  window._laneKeyDocEsc = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", window._laneKeyDocEsc);
}

// The NOW playhead: strong amber line, top handle, label.
function _drawLanesNow(ctx, x, h, strip, S) {
  ctx.strokeStyle = "rgba(245,166,35,0.9)";
  ctx.lineWidth = 1.6 * S;
  ctx.beginPath(); ctx.moveTo(x, strip * 0.2); ctx.lineTo(x, h); ctx.stroke();
  ctx.font = `700 ${Math.round(8.5 * S)}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  const tw = ctx.measureText("NOW").width + 10 * S;
  ctx.fillStyle = "#f5a623";
  roundRectPath(ctx, x - tw / 2, 0, tw, 13 * S, 3 * S);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - 4 * S, 13 * S); ctx.lineTo(x, 18 * S); ctx.lineTo(x + 4 * S, 13 * S);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#100c04";
  ctx.fillText("NOW", x, 9.5 * S);
  ctx.textAlign = "left";
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
  drawSpecOverlay(ctx, w, h);

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

  // V2.1 analysis tiles (MACRO_LANES_CHANGE_SPEC) — computed from the
  // same event ring the lanes draw, so numbers and picture always agree.
  const tlx = synth.getNoteTimeline ? synth.getNoteTimeline() : null;
  if (tlx && tlx.events.length) {
    const evsAll = tlx.events;
    const setStat = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    setStat("statVariants", new Set(evsAll.filter(e => e.isVariant).map(e => e.motifIndex)).size);
    setStat("statRests", evsAll.filter(e => e.isRest).length);
    setStat("statSurprises", Number.isFinite(state.surpriseCount) ? state.surpriseCount : evsAll.filter(e => e.noteRole === "surprise").length);
    const bits = evsAll.map(_evBits).filter(Number.isFinite);
    setStat("statMeanInfo", bits.length ? `${(bits.reduce((a, b) => a + b, 0) / bits.length).toFixed(1)}b` : "–");
  }
  const chip = document.getElementById("m2StatusChip");
  if (chip) {
    const playing = synth.isPlaying;
    chip.textContent = playing ? "★ Now playing · possible future field" : "■ Stopped · settings field ready";
    chip.classList.toggle("playing", !!playing);
  }
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
