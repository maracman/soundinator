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
  HeadphoneCheck,
  SCALE_PRESETS,
  FORMANT_PRESETS,
  PERC_SOUNDS,
  REVERB_PROFILES,
  SPECTRAL_PROFILES,
  spectralDefaultRegisterSensitivity,
} from "./synth.js";

// ─── Constants ──────────────────────────────────────────────

const STORAGE_KEY = "phase0.presets.v3";
const PARTICIPANT_KEY = "phase0.pid.v2";
const ENGAGE_KEY = "phase0.engagement.v3";
// Bump APP_VERSION whenever generation semantics change: it is folded into
// every stimulus_id, so identical parameters across app versions do not
// collide in analysis.
const APP_VERSION = "sound-studio-0.2.0";
const EVENT_SCHEMA_VERSION = "explore-event-1.0";
const SESSION_ID = crypto.randomUUID(); // fresh per page visit
const CONSENT_KEY = "phase0.consent.v1";
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

const DEFAULTS = {
  tempo: 104,
  seed: 1001,
  voiceMode: "formant",
  scaleMode: "12tone",
  scalePreset: "major",
  edoDivisions: 12,
  customDegrees: null,
  subScaleNotes: [0, 4, 7],
  subScaleWeight: 0.7,
  tonicHz: 261.63,
  intervalPeakedness: 2.0,
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
  reverbWet: 0,
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
  envelopeRelease: 0.08,
  envelopeReleaseSd: 0.035,
  // Articulation gaps
  gapProb: 1,
  gapMin: 0.15,
  gapMax: 0.15,
  gapDistanceSlope: 0,
  gapTimingRange: 0,
  slideSpeed: 0.65,
  phraseGap: 0.15,
};

// ─── Setting descriptions ──────────────────────────────────

const PARAM_DESC = {
  tempo: "Playback speed in beats per minute",
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
  surpriseMaxBaked: "Maximum number of baked-in surprise variants allowed. Infinity lets the loop keep growing",
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
  motifSurpriseProb: "Chance of a whole-motif repertoire mutation at a motif boundary. Counts toward the baked surprise limit",
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

function normaliseVoiceMode(mode) {
  return mode === "formant" ? "formant" : "fourier";
}

function isFormantMode(p = exploreParams) {
  return normaliseVoiceMode(p.voiceMode) === "formant";
}

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
  if (![p.surprisePitchEnabled, p.surpriseTuningEnabled, p.surpriseRhythmEnabled, p.surpriseFormantEnabled, p.surpriseDynamicsEnabled, p.surpriseRestEnabled].some(Boolean)) {
    p.surprisePitchEnabled = true;
  }
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
  if (h === "explore" || h === "") return renderExplore();
  return renderExplore();
}

function mount(html) {
  document.body.classList.remove("explore-mode");
  el.innerHTML = `<div class="view">${html}</div>`;
  return el.querySelector(".view");
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
        <h1>Sound Studio</h1>
        <div class="studio-subtitle">Probabilistic Synthesiser</div>
      </div>
      <div class="workspace-tabs" id="workspaceTabs">
        <button class="workspace-tab${workspaceTab === 'explore' ? ' active' : ''}" data-workspace-tab="explore">Macro</button>
        <button class="workspace-tab${workspaceTab === 'subnote' ? ' active' : ''}" data-workspace-tab="subnote">Sub-note</button>
      </div>
    </div>

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
        <canvas id="vis" width="980" height="150"></canvas>
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
        <button class="tab active" id="tabMy">My presets</button>
        <button class="tab" id="tabGlobal">Shared library</button>
      </div>
      <div id="myPresets" class="preset-list"></div>
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
    "reverbWet","reverbDecay","reverbTone","reverbPreDelay"
  ]);
  const liveSubnoteParams = new Set([
    // Melody-generation shaping: changing these continues the current Markov
    // sequence (incorporating the new params into freshly generated material)
    // instead of restarting from the top. Use "Restart seq" to hear the full
    // from-scratch effect.
    "intervalPeakedness","intervalRange","momentum","registerCenter","registerWidth","registerSkew",
    "rootPullStrength","rootPullShape",
    "surpriseProb","incorporationRate","surpriseMaxBaked","motifSurpriseProb",
    "surprisePitchWeight","surpriseTuningWeight","surpriseRhythmWeight","surpriseFormantWeight",
    "surpriseDynamicsWeight","surpriseRestWeight",
    "surprisePitchDistance","surpriseTuningDistance","surpriseRhythmDistance",
    "surpriseFormantDistance","surpriseDynamicsDistance",
    "gapProb","gapMin","gapMax","gapDistanceSlope","gapTimingRange","slideSpeed","phraseGap",
    "restMotifStartRatio","restOnMeterRatio","restOffMeterRatio",
    "dynamicsLevel","loudnessRange","dynamicsPrecision","dynamicsRange","formantChangeProb",
    "toneColorProb","toneFormantDrift","toneResonanceDrift","toneBreath",
    "vibratoProb","vibratoDepth","vibratoDepthSd","vibratoRate","vibratoRateSd",
    "spectralProb","spectralMix","spectralPartials","spectralDynamicAmount",
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
      if (key === "spectralProfile") {
        synth.updateGenerationParams({ ...exploreParams });
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

  // Save preset
  v.querySelector("#saveBtn").onclick = () => {
    const name = v.querySelector("#presetName").value.trim() || `Preset ${new Date().toLocaleTimeString()}`;
    const entry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      name,
      rating: exploreRating,
      parameters: { ...exploreParams },
      stimulus_id: stimulusIdFor(exploreParams),
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
  const tabMy = v.querySelector("#tabMy");
  const tabGlobal = v.querySelector("#tabGlobal");
  const myList = v.querySelector("#myPresets");
  const globalList = v.querySelector("#globalPresets");
  const libraryCard = v.querySelector("#libraryCard");

  tabMy.onclick = () => {
    tabMy.classList.add("active"); tabGlobal.classList.remove("active");
    myList.classList.remove("hidden"); globalList.classList.add("hidden");
    libraryCard?.classList.add("is-open");
  };
  tabGlobal.onclick = async () => {
    tabGlobal.classList.add("active"); tabMy.classList.remove("active");
    globalList.classList.remove("hidden"); myList.classList.add("hidden");
    libraryCard?.classList.add("is-open");
    await loadGlobalPresets(globalList);
  };
  const topMyPresets = v.querySelector("#topMyPresets");
  if (topMyPresets) topMyPresets.onclick = () => tabMy.click();
  const topLibrary = v.querySelector("#topLibrary");
  if (topLibrary) topLibrary.onclick = () => tabGlobal.click();

  // Initial renders
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
        ${selectControlRow("surpriseMaxBaked", "Max baked surprises", p.surpriseMaxBaked, bakedSurpriseOptions(p.surpriseMaxBaked))}
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
              ${controlRow("slideSpeed", "Slide speed", p.slideSpeed, 0, 1, 0.01)}
              ${controlRow("phraseGap", "Phrase gap", p.phraseGap, 0, 0.8, 0.01)}
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
          ${controlRow("intervalPeakedness", "Interval shape", p.intervalPeakedness, 0, 4, 0.05)}
          ${controlRow("intervalRange", "Interval range", p.intervalRange, 1, 24, 1)}
          ${controlRow("momentum", "Momentum", p.momentum, 0, 1, 0.01)}
        </div>

        <div class="macro-subsection${melSub === "accuracy" ? " active" : ""}" data-section="accuracy">
          <div class="subsection-label">Accuracy</div>
          ${controlRow("motifHitProb", "Probability", p.motifHitProb, 0, 1, 0.01)}
          ${controlRow("motifHitRange", "Hit range", p.motifHitRange, 0, 12, 1)}
        </div>

        <div class="macro-subsection${!p.surprisePitchEnabled ? " surprise-disabled" : ""}${melSub === "surprise" ? " active" : ""}" data-section="surprise">
          <div class="subsection-label">Surprise</div>
          ${checkboxControl("surprisePitchEnabled", "Enable surprise", p.surprisePitchEnabled)}
          ${controlRow("melSurpriseAmount", "Amount", p.melSurpriseAmount ?? 0.5, 0, 1, 0.01)}
          ${controlRow("surprisePitchDistance", "Range", p.surprisePitchDistance, 0, 1, 0.01)}
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
  return `
    <div class="perf-panel production-panel production-panel-split">
      <div class="perf-section space-section">
        <div class="perf-section-title">Reverb</div>
        <select data-param-select="reverbType" class="param-select">
          ${reverbTypeOptions(p.reverbType)}
        </select>
        <div class="controls-grid">
          ${controlRow("reverbWet", "Wet", p.reverbWet, 0, 0.95, 0.01)}
          ${controlRow("reverbDecay", "Decay", p.reverbDecay, 0.2, 8, 0.1)}
          ${controlRow("reverbTone", "Tone", p.reverbTone, 0, 1, 0.01)}
          ${controlRow("reverbPreDelay", "Pre-delay", p.reverbPreDelay, 0, 0.25, 0.005)}
        </div>
        <canvas class="mini-canvas" id="cvReverb" width="360" height="54"></canvas>
      </div>
      <div class="perf-section percussion-section">
        <div class="perf-section-title">Percussion</div>
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
          <div class="harmonic-stage" data-sound-path="fourier" aria-disabled="false">
            <div class="subnote-head">
              <div>
                <div class="section-label">Harmonic Decomposition</div>
                <h2>${esc(profile.label)}</h2>
              </div>
              <div class="signature-legend">
                <span><i class="legend-band spread"></i> SD band</span>
                <span><i class="legend-line mean"></i> amplitude mean</span>
                <span><i class="legend-line quiet"></i> low reg</span>
                <span><i class="legend-line loud"></i> high reg</span>
                <span><i class="legend-line sample"></i> sampled sum</span>
              </div>
            </div>
            <canvas id="cvHarmonicSignature" width="920" height="620"></canvas>
          </div>
        `}

        <div class="subnote-side">
          <div class="subnote-side-section sound-source-section">
            <div class="section-label">Sound Source</div>
            <div class="mode-btns sound-source-modes" id="voiceModeGroup">
              <button class="mode-btn${formantMode ? ' active' : ''}" data-vmode="formant">Formant</button>
              <button class="mode-btn${!formantMode ? ' active' : ''}" data-vmode="fourier">Fourier</button>
            </div>
          </div>

          <div class="subnote-side-section${formantDisabled}" data-sound-path="formant" aria-disabled="${!formantMode}">
            <div class="section-label">Formant Voice</div>
            <div class="formant-chips" id="formantChips">
              ${Object.keys(FORMANT_PRESETS).map(k =>
                `<button class="formant-chip${p.activeFormants.includes(k) ? ' active' : ''}" data-formant="${k}">${k}</button>`
              ).join('')}
            </div>
            <div class="controls-grid">
              ${controlRow("formantChangeProb", "Formant change", p.formantChangeProb, 0, 1, 0.01)}
            </div>
            ${featureSurpriseBlock("formant", "Formant", "surpriseFormantEnabled", null, p.surpriseFormantEnabled, p.surpriseFormantDistance)}
            ${formantWeightControlsHTML(p)}
          </div>

          <div class="subnote-side-section${formantDisabled}" data-sound-path="formant" aria-disabled="${!formantMode}">
            <div class="section-label">Colour Distribution</div>
            <div class="controls-grid">
              ${controlRow("toneColorProb", "Chance", p.toneColorProb, 0, 1, 0.01)}
              ${controlRow("toneFormantDrift", "Formant", p.toneFormantDrift, 0, 0.5, 0.01)}
              ${controlRow("toneResonanceDrift", "Resonance", p.toneResonanceDrift, 0, 0.8, 0.01)}
              ${controlRow("toneBreath", "Breath", p.toneBreath, 0, 0.4, 0.01)}
            </div>
          </div>

          <div class="subnote-side-section${fourierDisabled}" data-sound-path="fourier" aria-disabled="${formantMode}">
            <div class="section-label">Instrument Fourier Print</div>
            <select data-param-select="spectralProfile" class="param-select">
              ${spectralProfileOptions(p.spectralProfile)}
            </select>
            <div class="controls-grid">
              ${controlRow("spectralProb", "Sample chance", p.spectralProb, 0, 1, 0.01)}
              ${controlRow("spectralMix", "Mix", p.spectralMix, 0, 1, 0.01)}
              ${controlRow("spectralPartials", "Harmonics", p.spectralPartials, 1, 20, 1)}
              ${controlRow("spectralDynamicAmount", "Dyn response", p.spectralDynamicAmount, 0, 1.5, 0.01)}
              ${controlRow("spectralRegisterAmount", "Reg response", p.spectralRegisterAmount, 0, 1.5, 0.01)}
              ${controlRow("spectralResonanceAmount", "Resonance", p.spectralResonanceAmount, 0, 1.5, 0.01)}
              ${controlRow("spectralLoudnessNorm", "Loud norm", p.spectralLoudnessNorm, 0, 1, 0.01)}
              ${controlRow("spectralDriftProb", "Hold drift", p.spectralDriftProb, 0, 1, 0.01)}
              ${controlRow("spectralDriftDepth", "Drift depth", p.spectralDriftDepth, 0, 1, 0.01)}
              ${controlRow("spectralDriftRate", "Drift rate", p.spectralDriftRate, 0.5, 20, 0.5)}
              ${controlRow("spectralStretchCents", "Freq stretch", p.spectralStretchCents, -24, 24, 1)}
            </div>
          </div>

          <div class="subnote-side-section">
            <div class="section-label">Vibrato Distribution</div>
            <div class="controls-grid">
              ${controlRow("vibratoProb", "Chance", p.vibratoProb, 0, 1, 0.01)}
              ${controlRow("vibratoDepth", "Depth", p.vibratoDepth, 0, 80, 1)}
              ${controlRow("vibratoDepthSd", "Depth SD", p.vibratoDepthSd, 0, 40, 1)}
              ${controlRow("vibratoRate", "Rate", p.vibratoRate, 0.5, 12, 0.1)}
              ${controlRow("vibratoRateSd", "Rate SD", p.vibratoRateSd, 0, 4, 0.1)}
            </div>
            <canvas class="vibrato-canvas js-vibrato-canvas" width="260" height="54"></canvas>
          </div>

          <div class="subnote-side-section">
            <div class="section-label">Envelope Distribution</div>
            <div class="controls-grid">
              ${controlRow("envelopeProb", "Chance", p.envelopeProb, 0, 1, 0.01)}
            </div>
            ${envelopeDistributionControlsHTML(p)}
            <canvas class="envelope-canvas js-envelope-canvas" width="260" height="104"></canvas>
          </div>
        </div>

        <div class="harmonic-editor${fourierDisabled}" id="harmonicEditor" data-sound-path="fourier" aria-disabled="${formantMode}">
          ${harmonicEditorHTML(p)}
        </div>
      </div>
    </div>
  `;
}

function resetSpectralPartialParams(p) {
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
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
  return profile.partials.slice(0, count).map((partial, i) => {
    const mean = p.spectralPartialMeans[i] ?? profilePartial(partial).amp ?? 0;
    const sd = p.spectralPartialSds[i] ?? 0;
    const dyn = p.spectralPartialDyns[i] ?? profilePartial(partial).dyn ?? 0;
    const reg = p.spectralPartialRegs[i] ?? profilePartial(partial).reg ?? spectralDefaultRegisterSensitivity(i, count);
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
        <label>
          <span>D</span>
          <input type="range" data-harmonic-param="dyn" data-harmonic-index="${i}" min="-1" max="4" step="0.05" value="${dyn}">
          <output data-harmonic-out="dyn-${i}">${harmonicValueLabel("dyn", dyn)}</output>
        </label>
        <label>
          <span>R</span>
          <input type="range" data-harmonic-param="reg" data-harmonic-index="${i}" min="-2" max="2" step="0.05" value="${reg}">
          <output data-harmonic-out="reg-${i}">${harmonicValueLabel("reg", reg)}</output>
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
  drawSpectrumDist();
  drawVibratoDist();
  drawEnvelopeDist();
  drawHarmonicSignature();
}

function drawIntervalDist() {
  const cv = document.getElementById("cvInterval");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
function drawMacroDist(canvasId, cfg) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
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
  screenGrad.addColorStop(0, "#060e0a");
  screenGrad.addColorStop(0.7, "#040a07");
  screenGrad.addColorStop(1, "#020604");
  ctx.fillStyle = screenGrad;
  ctx.beginPath();
  ctx.roundRect(sX, sY, sW, sH, 4);
  ctx.fill();

  // Screen edge glow — phosphor bleed at the edges
  ctx.strokeStyle = "rgba(34,197,94,0.06)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sX + 1, sY + 1, sW - 2, sH - 2, 3);
  ctx.stroke();

  // ── Grid lines: horizontal (phosphor green)
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let gy = 0; gy <= 4; gy++) {
    const y = padT + (plotH / 4) * gy;
    ctx.strokeStyle = gy === 0 ? "rgba(34,197,94,0.04)" : "rgba(34,197,94,0.07)";
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
    ctx.strokeStyle = gx === 2 ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.05)";
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
      ctx.fillStyle = "rgba(12,22,18,0.25)";
      ctx.fillRect(bx, sy, barW, segH);
    }

    // ── Ghost trail
    if (ghostSegs > topSegs) {
      for (let s = topSegs; s < ghostSegs; s++) {
        const sy = axisY - (s + 1) * (segH + segGap);
        ctx.fillStyle = "rgba(34,197,94,0.04)";
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
    ctx.fillStyle = "rgba(0,0,0,0.12)";
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
  vignette.addColorStop(1, "rgba(0,0,0,0.35)");
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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

function drawSpectrumDist() {
  const cv = document.getElementById("cvSpectrum");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  const profile = SPECTRAL_PROFILES[exploreParams.spectralProfile] || SPECTRAL_PROFILES.violin;
  const count = Math.max(1, Math.min(profile.partials.length, Math.round(exploreParams.spectralPartials || 20)));
  ensureSpectralPartialParams(exploreParams);
  const mix = exploreParams.spectralMix || 0;
  const levels = exploreParams.spectralPartialMeans.slice(0, count).map((amp, i) => {
    const reg = exploreParams.spectralPartialRegs[i] || 0;
    return amp * spectralVisualResponse(profile, i + 1, reg, 0);
  });
  const peak = Math.max(0.001, ...levels);
  const barGap = 2;
  const barW = Math.max(4, (w - barGap * (count + 1)) / count);

  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.fillRect(0, 0, w, h);
  levels.forEach((amp, i) => {
    const x = barGap + i * (barW + barGap);
    const norm = amp / peak;
    const y = h - norm * (h - 7) - 3;
    const top = Math.max(1, y);
    const sd = exploreParams.spectralPartialSds[i] || 0;
    const band = Math.min(h - 3, (sd / peak) * (h - 7));
    ctx.fillStyle = "rgba(59,130,246,0.16)";
    ctx.fillRect(x, Math.max(2, top - band), barW, Math.max(2, band * 2));
    ctx.fillStyle = `rgba(245,158,11,${0.25 + mix * 0.55})`;
    ctx.fillRect(x, top, barW, h - top - 3);
  });

  ctx.fillStyle = "rgba(136,153,170,0.72)";
  ctx.font = "8px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("1", 2, h - 2);
  ctx.textAlign = "right";
  ctx.fillText(String(count), w - 2, h - 2);
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
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height;
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

function drawHarmonicSignature() {
  const cv = document.getElementById("cvHarmonicSignature");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);

  ensureSpectralPartialParams(exploreParams);
  const profile = SPECTRAL_PROFILES[exploreParams.spectralProfile] || SPECTRAL_PROFILES.violin;
  const count = Math.max(1, Math.min(profile.partials.length, Math.round(exploreParams.spectralPartials || 20)));
  const stretchCents = exploreParams.spectralStretchCents || 0;
  const partials = profile.partials.slice(0, count).map((partial, i) => {
    const harmonic = i + 1;
    const stretch = stretchCents * ((harmonic - 1) / Math.max(1, count - 1)) ** 2;
    const baseMean = exploreParams.spectralPartialMeans[i] || 0;
    const reg = exploreParams.spectralPartialRegs[i] || 0;
    return {
      harmonic,
      baseMean,
      mean: baseMean * spectralVisualResponse(profile, harmonic, reg, 0),
      lowMean: baseMean * spectralVisualResponse(profile, harmonic, reg, -1),
      highMean: baseMean * spectralVisualResponse(profile, harmonic, reg, 1),
      sd: exploreParams.spectralPartialSds[i] || 0,
      reg,
      freq: harmonic * Math.pow(2, stretch / 1200),
    };
  });
  const peak = Math.max(0.001, ...partials.map(p => Math.max(p.mean, p.lowMean, p.highMean) + p.sd * 2));
  const plotX0 = 86;
  const plotX1 = w - 18;
  const plotW = plotX1 - plotX0;
  const top = 12;
  const bottom = h - 12;
  const gap = 4;
  const combinedH = Math.max(92, h * 0.17);
  const laneH = Math.max(14, (bottom - top - combinedH - gap * count) / count);

  ctx.font = "10px system-ui";
  ctx.textBaseline = "middle";

  partials.forEach((part, i) => {
    const y0 = top + i * (laneH + gap);
    const mid = y0 + laneH / 2;
    const ampPx = laneH * 0.43;
    const meanNorm = part.mean / peak;
    const lowNorm = part.lowMean / peak;
    const highNorm = part.highMean / peak;
    const sdNorm = part.sd / peak;
    const phaseCycles = part.freq;

    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.026)" : "rgba(255,255,255,0.015)";
    ctx.fillRect(plotX0, y0, plotW, laneH);
    ctx.strokeStyle = "rgba(136,153,170,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX0, mid);
    ctx.lineTo(plotX1, mid);
    ctx.stroke();

    drawSinePath(ctx, plotX0, plotX1, mid, phaseCycles, ampPx * meanNorm, {
      stroke: "rgba(59,130,246,0.30)",
      width: Math.max(2, sdNorm * ampPx * 2.5),
    });
    drawSinePath(ctx, plotX0, plotX1, mid, phaseCycles, ampPx * lowNorm, {
      stroke: "rgba(148,163,184,0.46)",
      width: 1,
    });
    drawSinePath(ctx, plotX0, plotX1, mid, phaseCycles, ampPx * highNorm, {
      stroke: "rgba(34,197,94,0.62)",
      width: 1,
    });
    drawSinePath(ctx, plotX0, plotX1, mid, phaseCycles, ampPx * meanNorm, {
      stroke: "rgba(245,158,11,0.88)",
      width: 1.4,
    });

    ctx.fillStyle = "rgba(245,158,11,0.86)";
    ctx.textAlign = "left";
    ctx.fillText(`H${part.harmonic}`, 12, mid);
    ctx.fillStyle = "rgba(136,153,170,0.76)";
    ctx.fillText(`${part.freq.toFixed(part.freq >= 10 ? 1 : 2)}x f0`, 38, mid);
    ctx.textAlign = "right";
    ctx.fillText(`M ${Math.round(part.mean * 100)}%`, plotX1 - 48, mid);
    ctx.fillText(`R ${part.reg >= 0 ? "+" : ""}${part.reg.toFixed(1)}`, plotX1, mid);
  });

  const combinedY0 = bottom - combinedH;
  const combinedMid = combinedY0 + combinedH / 2;
  const combinedAmp = combinedH * 0.42;
  ctx.fillStyle = "rgba(245,158,11,0.045)";
  ctx.fillRect(plotX0, combinedY0, plotW, combinedH);
  ctx.strokeStyle = "rgba(136,153,170,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotX0, combinedMid);
  ctx.lineTo(plotX1, combinedMid);
  ctx.stroke();

  const meanWave = combinedWave(partials, 0);
  for (let sample = 1; sample <= 3; sample++) {
    drawCombinedPath(ctx, plotX0, plotX1, combinedMid, combinedAmp, combinedWave(partials, sample), {
      stroke: "rgba(226,232,240,0.22)",
      width: 1,
    });
  }
  drawCombinedPath(ctx, plotX0, plotX1, combinedMid, combinedAmp, meanWave, {
    stroke: "rgba(34,197,94,0.90)",
    width: 1.8,
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(245,158,11,0.86)";
  ctx.fillText("SUM", 12, combinedMid);
  ctx.fillStyle = "rgba(136,153,170,0.76)";
  ctx.fillText("combined waveform", 38, combinedMid);
}

function spectralVisualResponse(profile, harmonic, reg, registerOctaves) {
  const registerAmount = clamp(exploreParams.spectralRegisterAmount ?? 0.55, 0, 1.5);
  const resonanceAmount = clamp(exploreParams.spectralResonanceAmount ?? 0.35, 0, 1.5);
  const source = Math.pow(2, reg * registerAmount * registerOctaves * 0.55);
  const freq = Math.max(1, (exploreParams.tonicHz || 261.63) * harmonic * Math.pow(2, registerOctaves));
  return clamp(source * spectralVisualResonance(profile, freq, resonanceAmount), 0.18, 4.5);
}

function spectralVisualResonance(profile, frequency, amount) {
  const resonances = profile.resonances || [];
  if (amount <= 0 || resonances.length === 0) return 1;
  let logGain = 0;
  resonances.forEach(band => {
    const freq = Math.max(20, band.freq || 1000);
    const width = Math.max(0.08, band.width || 0.5);
    const octDist = Math.log2(Math.max(20, frequency) / freq);
    logGain += (band.gain || 0) * Math.exp(-0.5 * (octDist / width) ** 2);
  });
  return clamp(Math.pow(2, logGain * amount), 0.2, 4.5);
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

function combinedWave(partials, sampleIndex) {
  const samples = [];
  const steps = 420;
  let maxAbs = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let y = 0;
    partials.forEach((part, j) => {
      const sampledAmp = sampleIndex === 0
        ? part.mean
        : Math.max(0, part.mean + visualGaussian(j, sampleIndex) * part.sd);
      y += sampledAmp * Math.sin(Math.PI * 2 * part.freq * t);
    });
    samples.push(y);
    maxAbs = Math.max(maxAbs, Math.abs(y));
  }
  const norm = maxAbs || 1;
  return samples.map(y => y / norm);
}

function drawCombinedPath(ctx, x0, x1, mid, amplitude, samples, opts) {
  ctx.strokeStyle = opts.stroke;
  ctx.lineWidth = opts.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  samples.forEach((v, i) => {
    const t = i / Math.max(1, samples.length - 1);
    const x = x0 + (x1 - x0) * t;
    const y = mid - v * amplitude;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
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
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
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
function updateSliderFill(sl) {
  const min = parseFloat(sl.min) || 0;
  const max = parseFloat(sl.max) || 100;
  const val = parseFloat(sl.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  sl.style.background = `linear-gradient(to right, rgba(245,158,11,0.4) ${pct}%, rgba(20,30,42,0.95) ${pct}%)`;
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

function formantWeightCircleHTML() {
  const C = 60, MAXR = 42;
  const keys = FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]);
  const n = keys.length || 1;
  const ang = (i) => (-90 + (i * 360 / n)) * Math.PI / 180;
  const rings = [0.34, 0.67, 1].map(f =>
    `<circle cx="${C}" cy="${C}" r="${(MAXR * f).toFixed(1)}" class="fw-ring"/>`).join("");
  const spokes = keys.map((k, i) => {
    const a = ang(i);
    return `<line x1="${C}" y1="${C}" x2="${(C + Math.cos(a) * MAXR).toFixed(1)}" y2="${(C + Math.sin(a) * MAXR).toFixed(1)}" class="fw-spoke"/>`;
  }).join("");
  const labels = keys.map((k, i) => {
    const a = ang(i);
    const lx = C + Math.cos(a) * (MAXR + 11), ly = C + Math.sin(a) * (MAXR + 11);
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="fw-label" data-fw-label="${k}">${k}</text>`;
  }).join("");
  const dots = keys.map(k => `<circle r="2.6" class="fw-dot" data-fw-dot="${k}"/>`).join("");
  return `<svg class="formant-weight-circle" viewBox="0 0 120 120" data-formant-weight-circle aria-hidden="true">
      ${rings}${spokes}
      <polygon class="fw-poly" data-fw-poly points=""/>
      ${dots}${labels}
    </svg>`;
}

function updateFormantWeightCircle(root) {
  const svg = (root || document).querySelector("[data-formant-weight-circle]");
  if (!svg) return;
  const C = 60, MAXR = 42;
  const keys = FORMANT_CIRCLE.filter(k => FORMANT_PRESETS[k]);
  const n = keys.length || 1;
  const active = exploreParams.activeFormants || [];
  const weights = exploreParams.formantWeights || {};
  const pts = [];
  keys.forEach((k, i) => {
    const a = (-90 + (i * 360 / n)) * Math.PI / 180;
    const on = active.includes(k);
    const w = on ? Math.max(0, Math.min(1, Number(weights[k]) || 0)) : 0;
    const r = MAXR * w;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    const dot = svg.querySelector(`[data-fw-dot="${k}"]`);
    if (dot) {
      dot.setAttribute("cx", x.toFixed(1));
      dot.setAttribute("cy", y.toFixed(1));
      dot.classList.toggle("inactive", !on);
    }
    svg.querySelector(`[data-fw-label="${k}"]`)?.classList.toggle("inactive", !on);
  });
  svg.querySelector("[data-fw-poly]")?.setAttribute("points", pts.join(" "));
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
      ...extra,
    }),
  }).catch(() => {});
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
      area.querySelector("#contribBtn").textContent = "Shared!";
      setTimeout(() => { area.querySelector("#contribBtn").textContent = "Share preset"; }, 2000);
    } catch (err) {
      alert("Could not contribute: " + err.message);
    }
  };
}

function renderPresetList(container, presets, source) {
  if (!presets.length) {
    container.innerHTML = '<div class="empty-state">No presets yet. Save one to get started.</div>';
    decorateTooltips(container);
    return;
  }
  container.innerHTML = presets.map(p => `
    <div class="preset-item">
      <span class="name">${esc(p.name || p.preset_name || "Untitled")}</span>
      <span class="meta">${presetSummary(p.parameters)}</span>
      <span class="score">${p.rating || p.favourite_rating || ""}/7</span>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" data-load='${JSON.stringify(p.parameters)}'>Load</button>
        ${source === "my" ? `<button class="btn btn-ghost btn-sm" data-remove="${p.id}">Remove</button>` : ""}
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-load]").forEach(btn => {
    btn.onclick = () => {
      const loaded = JSON.parse(btn.dataset.load);
      // Backward compat: old presets use motifLength (notes), map to motifLengthBeats
      if (loaded.motifLength && !loaded.motifLengthBeats) {
        loaded.motifLengthBeats = loaded.motifLength;
      }
      // Backward compat: ensure rootNotes is an array
      if (!Array.isArray(loaded.rootNotes)) loaded.rootNotes = [0];
      exploreParams = { ...DEFAULTS, ...loaded };
      const wasPlaying = synth.isPlaying;
      renderExplore();
      if (wasPlaying) { synth.play({ ...exploreParams }); startVisualiser(); }
    };
  });
  container.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = () => {
      savePresets(loadPresets().filter(p => p.id !== btn.dataset.remove));
      renderPresetList(container, loadPresets(), source);
    };
  });
  container.querySelectorAll("[data-load]").forEach(btn => setTooltip(btn, "Load this preset and restore its full parameter set."));
  container.querySelectorAll("[data-remove]").forEach(btn => setTooltip(btn, "Remove this saved local preset."));
  container.querySelectorAll(".preset-item").forEach(item => setTooltip(item, "Saved parameter set. Load it to hear the sound."));
}

async function loadGlobalPresets(container) {
  container.innerHTML = '<div class="empty-state">Loading shared library...</div>';
  try {
    const entries = await api("/api/presets/global");
    renderPresetList(container, entries, "global");
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Could not load: ${esc(err.message)}</div>`;
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
