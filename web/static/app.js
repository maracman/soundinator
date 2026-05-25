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
  intervalPeakedness: 1.5,
  intervalRange: 7,
  motifHitProb: 0.92,
  motifHitRange: 2,
  precision: 0.9,
  precisionRange: 12,
  surpriseProb: 0.08,
  surpriseDimensions: ["pitch"],
  incorporationRate: 0.4,
  surpriseMaxBaked: "Infinity",
  activeFormants: ["ah"],
  formantChangeProb: 0.05,
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
  intervalPeakedness: "How strongly the melody favours small intervals. Low = jumpy, high = stepwise",
  intervalRange: "Maximum interval size in scale degrees. Low = stepwise, high = allows large leaps",
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
  incorporationRate: "When a motif-pass surprise occurs, chance it gets baked into the growing repertoire loop",
  surpriseMaxBaked: "Maximum number of baked-in surprise variants allowed. Infinity lets the loop keep growing",
  formantChangeProb: "Probability of switching vowel sound between notes",
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
  cvRoot: "How strongly root pull acts across the phrase.",
  cvRegister: "Register probability curve across pitch height.",
  cvGap: "Articulation distribution. Values above zero create rests; values at or below zero connect or slide notes.",
  cvReverb: "Convolution impulse preview. Orange shows the decay envelope, blue suggests early reflections.",
  cvHarmonicSignature: "Harmonic fingerprint display. Orange is mean, blue is SD, grey/green show low/high register response.",
  libraryCard: "Saved local presets and shared community presets.",
};

const SECTION_DESC = {
  Scale: "Choose the pitch set available to the generative engine.",
  Melody: "Control note-to-note movement, motif hit accuracy, and cents-level tuning precision.",
  "Root Pull": "Choose tonal centre notes and how strongly melody is drawn toward them.",
  Register: "Shape the pitch height and range where melodies tend to live.",
  Rhythm: "Control note onset probabilities and rhythmic regularity.",
  "Sound Source": "Choose between the vowel/formant model and the additive Fourier harmonic model.",
  "Formant Voice": "Choose the vowel/formant palette used by Formant mode.",
  Surprise: "Choose what changes when a motif pass contains one surprise, and whether it becomes part of the loop.",
  Breaks: "Shape gaps between notes and phrase-boundary separations.",
  Percussion: "Add beat, motif, and downbeat accent layers.",
  Space: "Add generated convolution reverbs after the synthesiser.",
  "Motif Repertoire": "Control the number, length, ordering, and repertoire-level mutation of motifs.",
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
  explore: "Show the main compact synthesiser controls.",
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
let performanceTab = "breaks";
let debounceTimer = null;

// ─── Helpers ────────────────────────────────────────────────

function pid() {
  let id = localStorage.getItem(PARTICIPANT_KEY);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(PARTICIPANT_KEY, id); }
  return id;
}

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

  root.querySelectorAll(".note-cell").forEach(cell => {
    setTooltip(cell, "Click to cycle this pitch class between off, in-scale, and weighted sub-scale.");
  });
  root.querySelectorAll(".root-cell").forEach(cell => {
    setTooltip(cell, "Click to toggle this in-scale degree as a root/tonal-centre target.");
  });

  root.querySelectorAll(".dist-display, .mini-canvas, .js-envelope-canvas").forEach(el => {
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
  if (!["breaks", "percussion", "space"].includes(performanceTab)) performanceTab = "breaks";

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
  if (!p.surpriseDimensions || p.surpriseDimensions.length === 0) p.surpriseDimensions = ["pitch"];
  if (!Array.isArray(p.rootNotes)) p.rootNotes = [0];
  ensureSpectralPartialParams(p);

  const v = mount(`
    <div class="explore-dashboard${workspaceTab === 'subnote' ? ' subnote-workspace-mode' : ''}">
    <div class="explore-top">
      <div>
        <h1>Sound Studio</h1>
        <div class="workspace-tabs" id="workspaceTabs">
          <button class="workspace-tab${workspaceTab === 'explore' ? ' active' : ''}" data-workspace-tab="explore">Explore</button>
          <button class="workspace-tab${workspaceTab === 'subnote' ? ' active' : ''}" data-workspace-tab="subnote">Sub-note</button>
        </div>
      </div>
      <button class="btn btn-ghost btn-sm" id="backHome">Back</button>
    </div>

    <!-- Transport -->
    <div class="card transport-card">
      <div class="transport">
        <button class="btn btn-primary" id="playBtn">Play</button>
        <button class="btn btn-secondary" id="stopBtn">Stop</button>
        <div class="spacer"></div>
        <button class="btn btn-secondary" id="randBtn">Randomise</button>
        <button class="btn btn-ghost btn-sm" id="seedBtn">Seed: ${p.seed}</button>
      </div>
      <div class="controls-grid">
        ${controlRow("tempo", "Tempo", p.tempo, 50, 180, 1)}
      </div>
    </div>

    ${workspaceTab === 'subnote' ? subnoteWorkspaceHTML(p) : ''}

    <!-- Visualiser -->
    <div class="visual-card">
    <div class="visualiser-wrap">
      <canvas id="vis" width="820" height="140"></canvas>
      <span class="visualiser-badge">Web Audio</span>
    </div>
    <div class="engine-state" id="engineState">
      <div class="stat">Motifs: <span class="stat-val" id="statMotifs">&ndash;</span></div>
      <div class="stat">Sequence: <span class="stat-val" id="statSeq">&ndash;</span></div>
      <div class="stat">Notes: <span class="stat-val" id="statNotes">&ndash;</span></div>
    </div>
    </div>

    <!-- Scale -->
    <div class="card scale-card">
      <div class="section-label">Scale</div>
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
      </div>
      <div class="controls-grid" style="margin-top:0.75rem">
        ${controlRow("subScaleWeight", "Sub-scale weight", p.subScaleWeight, 0.5, 1.0, 0.01)}
      </div>
    </div>

    <!-- Melody (note-to-note) -->
    <div class="card melody-card">
      <div class="section-label">Melody</div>
      <div class="controls-grid">
        ${controlRow("intervalPeakedness", "Interval shape", p.intervalPeakedness, 0, 4, 0.05)}
        ${controlRow("intervalRange", "Interval range", p.intervalRange, 1, 24, 1)}
        ${controlRow("motifHitProb", "Hit prob", p.motifHitProb, 0, 1, 0.01)}
        ${controlRow("motifHitRange", "Hit range", p.motifHitRange, 0, 12, 1)}
        ${controlRow("precision", "Tune prob", p.precision, 0, 1, 0.01)}
        ${controlRow("precisionRange", "Cents range", p.precisionRange, 0, 100, 1)}
      </div>
      <div class="dist-display" id="distInterval">
        <canvas class="dist-canvas" id="cvInterval" width="200" height="50"></canvas>
        <span class="dist-label">Interval distribution</span>
      </div>
    </div>

    <!-- Root Pull -->
    <div class="card root-card">
      <div class="section-label">Root Pull</div>
      <div class="root-note-grid" id="rootNoteGrid">
        ${buildRootNoteGridHTML(p)}
      </div>
      <div class="note-grid-legend" style="margin-bottom:0.6rem">
        <div class="legend-item"><div class="legend-dot off"></div> Not root</div>
        <div class="legend-item"><div class="legend-dot root"></div> Root note</div>
      </div>
      <div class="controls-grid">
        ${controlRow("rootPullStrength", "Pull strength", p.rootPullStrength, 0, 1, 0.01)}
        ${controlRow("rootPullShape", "Pull shape", p.rootPullShape, 0, 1, 0.01)}
      </div>
      <div class="dist-display" id="distRoot">
        <canvas class="dist-canvas" id="cvRoot" width="200" height="50"></canvas>
        <span class="dist-label">Pull strength across phrase</span>
      </div>
    </div>

    <!-- Register -->
    <div class="card register-card">
      <div class="section-label">Register</div>
      <div class="controls-grid">
        ${controlRow("registerCenter", "Centre", p.registerCenter, -24, 24, 1)}
        ${controlRow("registerWidth", "Width", p.registerWidth, 2, 36, 1)}
        ${controlRow("registerSkew", "Skew", p.registerSkew, -1, 1, 0.05)}
      </div>
      <div class="dist-display" id="distRegister">
        <canvas class="dist-canvas" id="cvRegister" width="200" height="50"></canvas>
        <span class="dist-label">Register probability</span>
      </div>
    </div>

    <!-- Rhythm -->
    <div class="card rhythm-card">
      <div class="section-label">Rhythm</div>
      <div class="controls-grid">
        ${controlRow("beatDivisions", "Beat divisions", p.beatDivisions, 1, 6, 1)}
        ${controlRow("onBeatProb", "On-beat onset", p.onBeatProb, 0, 1, 0.01)}
        ${controlRow("offBeatProb", "Off-beat onset", p.offBeatProb, 0, 1, 0.01)}
        ${controlRow("sameLengthProb", "Same length", p.sameLengthProb, 0, 1, 0.01)}
        ${controlRow("restMotifStartRatio", "Rest motif", p.restMotifStartRatio, 0, 0.95, 0.01)}
        ${controlRow("restOnMeterRatio", "Rest on", p.restOnMeterRatio, 0, 0.95, 0.01)}
        ${controlRow("restOffMeterRatio", "Rest off", p.restOffMeterRatio, 0, 0.95, 0.01)}
      </div>
    </div>

    <!-- Surprise -->
    <div class="card surprise-card">
      <div class="section-label">Surprise</div>
      <div class="controls-grid">
        ${controlRow("surpriseProb", "Probability", p.surpriseProb, 0, 1, 0.01)}
      </div>
      <div class="dimension-checks" id="dimChecks">
        <label class="dim-check">
          <input type="checkbox" data-dim="pitch" ${p.surpriseDimensions.includes('pitch') ? 'checked' : ''}/>
          Pitch
        </label>
        <label class="dim-check">
          <input type="checkbox" data-dim="octave" ${p.surpriseDimensions.includes('octave') ? 'checked' : ''}/>
          Octave
        </label>
        <label class="dim-check">
          <input type="checkbox" data-dim="formant" ${p.surpriseDimensions.includes('formant') ? 'checked' : ''}/>
          Formant
        </label>
        <label class="dim-check">
          <input type="checkbox" data-dim="rhythm" ${p.surpriseDimensions.includes('rhythm') ? 'checked' : ''}/>
          Rhythm
        </label>
        <label class="dim-check">
          <input type="checkbox" data-dim="dynamics" ${p.surpriseDimensions.includes('dynamics') ? 'checked' : ''}/>
          Dynamics
        </label>
        <label class="dim-check">
          <input type="checkbox" data-dim="rest" ${p.surpriseDimensions.includes('rest') ? 'checked' : ''}/>
          Rest
        </label>
      </div>
      <div class="controls-grid">
        ${controlRow("incorporationRate", "Incorporation", p.incorporationRate, 0, 1, 0.01)}
        ${selectControlRow("surpriseMaxBaked", "Max baked", p.surpriseMaxBaked, bakedSurpriseOptions(p.surpriseMaxBaked))}
      </div>
    </div>

    <!-- Performance detail -->
    <div class="card percussion-card">
      <div class="performance-tabs" id="performanceTabs">
        <button class="perf-tab${performanceTab === 'breaks' ? ' active' : ''}" data-performance-tab="breaks">Breaks</button>
        <button class="perf-tab${performanceTab === 'percussion' ? ' active' : ''}" data-performance-tab="percussion">Percussion</button>
        <button class="perf-tab${performanceTab === 'space' ? ' active' : ''}" data-performance-tab="space">Space</button>
      </div>

      <div class="perf-panel${performanceTab !== 'breaks' ? ' hidden' : ''}" data-panel="breaks">
        <div class="perf-section">
          <div class="section-label">Breaks</div>
          <div class="controls-grid">
            ${controlRow("gapProb", "Chance", p.gapProb, 0, 1, 0.01)}
            ${controlRow("gapMin", "Min", p.gapMin, -0.8, 0.8, 0.01)}
            ${controlRow("gapMax", "Max", p.gapMax, -0.8, 0.8, 0.01)}
            ${controlRow("gapDistanceSlope", "Slope", p.gapDistanceSlope, 0, 1, 0.01)}
            ${controlRow("gapTimingRange", "Range", p.gapTimingRange, 0, 0.4, 0.01)}
            ${controlRow("slideSpeed", "Slide speed", p.slideSpeed, 0, 1, 0.01)}
            ${controlRow("phraseGap", "Phrase", p.phraseGap, 0, 0.8, 0.01)}
          </div>
          <canvas class="mini-canvas" id="cvGap" width="360" height="64"></canvas>
        </div>
      </div>

      <div class="perf-panel${performanceTab !== 'percussion' ? ' hidden' : ''}" data-panel="percussion">
        <div class="perf-section percussion-section">
          <div class="section-label">Percussion</div>
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
              <div class="perc-header">Down</div>
              <select data-perc="percDownbeatSound" class="perc-select">
                ${percSoundOptions(p.percDownbeatSound)}
              </select>
              ${controlRow("percDownbeatVol", "Vol", p.percDownbeatVol, 0, 1, 0.01)}
              ${controlRow("percDownbeatEvery", "Every", p.percDownbeatEvery, 1, 16, 1)}
            </div>
          </div>
        </div>
      </div>

      <div class="perf-panel${performanceTab !== 'space' ? ' hidden' : ''}" data-panel="space">
        <div class="perf-section space-section">
          <div class="section-label">Space</div>
          <select data-param-select="reverbType" class="param-select">
            ${reverbTypeOptions(p.reverbType)}
          </select>
          <div class="controls-grid">
            ${controlRow("reverbWet", "Wet", p.reverbWet, 0, 0.95, 0.01)}
            ${controlRow("reverbDecay", "Decay", p.reverbDecay, 0.2, 8, 0.1)}
            ${controlRow("reverbTone", "Tone", p.reverbTone, 0, 1, 0.01)}
            ${controlRow("reverbPreDelay", "Pre-delay", p.reverbPreDelay, 0, 0.25, 0.005)}
          </div>
          <canvas class="mini-canvas" id="cvReverb" width="360" height="46"></canvas>
        </div>
      </div>
    </div>

    <!-- Motif Repertoire -->
    <div class="card motif-card">
      <div class="section-label">Motif Repertoire</div>
      <div class="controls-grid">
        ${controlRow("motifCount", "Motif count", p.motifCount, 1, 8, 1)}
        ${controlRow("motifLengthBeats", "Motif (beats)", p.motifLengthBeats, 1, 16, 1)}
        ${controlRow("sequenceProb", "Sequence prob", p.sequenceProb, 0, 1, 0.01)}
        ${controlRow("motifSurpriseProb", "Whole motif", p.motifSurpriseProb, 0, 1, 0.01)}
      </div>
    </div>

    <!-- Rating & Save -->
    <div class="card rating-card">
      <div class="rating-row">
        <span class="label">How much do you like this?</span>
        <input type="range" id="ratingSlider" min="1" max="7" step="1" value="${exploreRating}"/>
        <output id="ratingOut">${exploreRating}/7</output>
      </div>
      <div class="preset-bar">
        <input type="text" id="presetName" placeholder="Preset name" maxlength="80"/>
        <button class="btn btn-primary btn-sm" id="saveBtn">Save</button>
      </div>
    </div>

    <!-- Library -->
    <div class="card library-card" id="libraryCard">
      <div class="tabs">
        <button class="tab active" id="tabMy">My presets</button>
        <button class="tab" id="tabGlobal">Shared library</button>
      </div>
      <div id="myPresets" class="preset-list"></div>
      <div id="globalPresets" class="preset-list hidden"></div>
    </div>

    <div id="contributeArea"></div>
    </div>
  `);
  document.body.classList.add("explore-mode");
  document.title = "Sound Studio";

  // ── Wire up ──

  canvas = v.querySelector("#vis");
  canvasCtx = canvas.getContext("2d");

  v.querySelector("#backHome").onclick = () => { synth.stop(); navigate("home"); };
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
  v.querySelector("#playBtn").onclick = () => {
    synth.play({ ...exploreParams });
    startVisualiser();
    trackEngagement("play");
  };
  v.querySelector("#stopBtn").onclick = () => synth.stop();
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

  // All range sliders with data-param
  const distParams = new Set([
    "intervalPeakedness","intervalRange","rootPullStrength","rootPullShape",
    "registerCenter","registerWidth","registerSkew","gapProb","gapMin","gapMax",
    "gapDistanceSlope","gapTimingRange","slideSpeed","phraseGap","spectralProb","spectralMix",
    "spectralPartials","spectralDynamicAmount","spectralRegisterAmount","spectralResonanceAmount",
    "spectralLoudnessNorm","spectralDriftProb","spectralDriftDepth","spectralDriftRate","spectralStretchCents",
    "vibratoProb","vibratoDepth","vibratoDepthSd","vibratoRate","vibratoRateSd",
    "envelopeProb","envelopeAttack","envelopeAttackSd",
    "envelopeDecay","envelopeDecaySd","envelopeSustain","envelopeSustainSd",
    "envelopeRelease","envelopeReleaseSd","reverbWet","reverbDecay","reverbTone","reverbPreDelay"
  ]);
  const harmonicParams = new Set([
    "spectralProfile","spectralPartials","spectralDynamicAmount","spectralRegisterAmount",
    "spectralResonanceAmount","spectralLoudnessNorm","spectralStretchCents",
  ]);
  const liveReverbParams = new Set([
    "reverbWet","reverbDecay","reverbTone","reverbPreDelay"
  ]);
  const liveSubnoteParams = new Set([
    "surpriseProb","incorporationRate","surpriseMaxBaked","motifSurpriseProb",
    "gapProb","gapMin","gapMax","gapDistanceSlope","gapTimingRange","slideSpeed","phraseGap",
    "restMotifStartRatio","restOnMeterRatio","restOffMeterRatio",
    "toneColorProb","toneFormantDrift","toneResonanceDrift","toneBreath",
    "vibratoProb","vibratoDepth","vibratoDepthSd","vibratoRate","vibratoRateSd",
    "spectralProb","spectralMix","spectralPartials","spectralDynamicAmount",
    "spectralRegisterAmount","spectralResonanceAmount","spectralLoudnessNorm",
    "spectralDriftProb","spectralDriftDepth","spectralDriftRate","spectralStretchCents",
    "envelopeProb","envelopeAttack","envelopeAttackSd","envelopeDecay","envelopeDecaySd",
    "envelopeSustain","envelopeSustainSd","envelopeRelease","envelopeReleaseSd"
  ]);
  v.querySelectorAll("input[type=range][data-param]").forEach(sl => {
    sl.oninput = () => {
      const key = sl.dataset.param;
      exploreParams[key] = Number(sl.value);
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

  // Compact performance tabs
  v.querySelector("#performanceTabs").onclick = (e) => {
    const btn = e.target.closest("[data-performance-tab]");
    if (!btn) return;
    performanceTab = btn.dataset.performanceTab;
    v.querySelectorAll("[data-performance-tab]").forEach(b => {
      b.classList.toggle("active", b === btn);
    });
    v.querySelectorAll("[data-panel]").forEach(panel => {
      panel.classList.toggle("hidden", panel.dataset.panel !== performanceTab);
    });
    drawDistributions();
  };

  // Parameter selectors
  v.querySelectorAll("select[data-param-select]").forEach(sel => {
    sel.value = exploreParams[sel.dataset.paramSelect];
    sel.onchange = () => {
      const key = sel.dataset.paramSelect;
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

  // Scale mode toggle
  v.querySelector("#scaleModeGroup").onclick = (e) => {
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
  v.querySelector("#noteGridContainer").onclick = (e) => {
    const cell = e.target.closest(".note-cell");
    if (!cell) return;
    handleNoteGridClick(cell);
    syncRootNotesWithScale(v);
  };

  // Root note grid clicks
  const rootGrid = v.querySelector("#rootNoteGrid");
  if (rootGrid) {
    rootGrid.onclick = (e) => {
      const cell = e.target.closest(".root-cell");
      if (!cell || cell.classList.contains("disabled")) return;
      handleRootNoteClick(cell);
    };
  }

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
      debouncedReplay();
    };
  }

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

  // Surprise dimensions
  v.querySelector("#dimChecks").onchange = () => {
    const dims = [];
    v.querySelectorAll("#dimChecks input:checked").forEach(cb => dims.push(cb.dataset.dim));
    if (dims.length === 0) {
      dims.push("pitch");
      v.querySelector('[data-dim="pitch"]').checked = true;
    }
    exploreParams.surpriseDimensions = dims;
    synth.updateGenerationParams({ ...exploreParams });
  };

  // Rating
  const ratingSlider = v.querySelector("#ratingSlider");
  const ratingOut = v.querySelector("#ratingOut");
  ratingSlider.oninput = () => {
    exploreRating = Number(ratingSlider.value);
    ratingOut.textContent = `${exploreRating}/7`;
  };

  // Save preset
  v.querySelector("#saveBtn").onclick = () => {
    const name = v.querySelector("#presetName").value.trim() || `Preset ${new Date().toLocaleTimeString()}`;
    const entry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      name,
      rating: exploreRating,
      parameters: { ...exploreParams },
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

  tabMy.onclick = () => {
    tabMy.classList.add("active"); tabGlobal.classList.remove("active");
    myList.classList.remove("hidden"); globalList.classList.add("hidden");
  };
  tabGlobal.onclick = async () => {
    tabGlobal.classList.add("active"); tabMy.classList.remove("active");
    globalList.classList.remove("hidden"); myList.classList.add("hidden");
    await loadGlobalPresets(globalList);
  };

  // Initial renders
  renderPresetList(myList, loadPresets(), "my");
  maybeShowContribute(v);
  syncHarmonicWorkspace(v);
  applySubnoteModeState(v);
  decorateTooltips(v);
  drawStaticVis();
  drawDistributions();
}

function subnoteWorkspaceHTML(p) {
  const formantMode = isFormantMode(p);
  const fourierDisabled = formantMode ? " mode-disabled" : "";
  const formantDisabled = formantMode ? "" : " mode-disabled";
  const profile = SPECTRAL_PROFILES[p.spectralProfile] || SPECTRAL_PROFILES.violin;
  return `
    <div class="card subnote-full-card ${formantMode ? "is-formant-mode" : "is-fourier-mode"}">
      <div class="subnote-full-layout">
        <div class="harmonic-stage${fourierDisabled}" data-sound-path="fourier" aria-disabled="${formantMode}">
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
  const title = card.querySelector(".subnote-head h2");
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

  let html = '<div class="note-grid">';
  for (let d = 0; d < divisions; d++) {
    const name = (divisions === 12) ? NOTE_NAMES_12[d] : String(d);
    const inScale = customDeg.includes(d);
    const inSub = subNotes.includes(d) && inScale;
    let cls = "note-cell";
    if (inSub) cls += " in-sub";
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
  const rootGrid = v.querySelector("#rootNoteGrid");
  if (rootGrid) {
    rootGrid.innerHTML = buildRootNoteGridHTML(exploreParams);
    decorateTooltips(rootGrid);
  }
}

function handleNoteGridClick(cell) {
  const d = parseInt(cell.dataset.degree);
  const p = exploreParams;

  if (cell.classList.contains("in-sub")) {
    // Sub-scale -> off
    cell.classList.remove("in-sub");
    p.customDegrees = (p.customDegrees || []).filter(x => x !== d);
    p.subScaleNotes = (p.subScaleNotes || []).filter(x => x !== d);
  } else if (cell.classList.contains("in-scale")) {
    // In scale -> promote to sub-scale
    cell.classList.remove("in-scale");
    cell.classList.add("in-sub");
    if (!p.subScaleNotes) p.subScaleNotes = [];
    if (!p.subScaleNotes.includes(d)) p.subScaleNotes.push(d);
  } else {
    // Off -> add to scale
    cell.classList.add("in-scale");
    if (!p.customDegrees) p.customDegrees = [];
    if (!p.customDegrees.includes(d)) {
      p.customDegrees.push(d);
      p.customDegrees.sort((a, b) => a - b);
    }
  }

  // Ensure at least one note remains in scale
  if (!p.customDegrees || p.customDegrees.length === 0) {
    cell.classList.add("in-scale");
    p.customDegrees = [d];
  }

  debouncedReplay();
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

function drawDistributions() {
  drawIntervalDist();
  drawRootPullDist();
  drawRegisterDist();
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
  const range = exploreParams.intervalRange;

  // Draw exponential decay curve for intervals
  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.strokeStyle = "rgba(245,158,11,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x++) {
    const dist = (x / w) * range;
    const val = Math.exp(-dist * peak);
    const y = h - val * (h - 4);
    if (x === 0) ctx.lineTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    const dist = (x / w) * range;
    const val = Math.exp(-dist * peak);
    const y = h - val * (h - 4);
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
  const side = offset >= 0 ? 1 : -1;
  const sigma = Math.max(1, Math.max(1, width) * (1 + skew * side * 0.75));
  return Math.exp(-0.5 * (offset / sigma) ** 2);
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
    case "registerWidth": return String(v);
    case "surpriseMaxBaked": return normaliseBakedSurpriseValue(val) === "Infinity" ? "∞" : String(Math.floor(Number(val)));
    case "intervalPeakedness": return v.toFixed(1);
    case "registerSkew": return (v >= 0 ? "+" : "") + v.toFixed(2);
    case "subScaleWeight":
    case "precision":
    case "motifHitProb":
    case "surpriseProb":
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
    case "phraseGap": return (v * 100).toFixed(0) + "%";
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
  p.motifHitProb = rf(0.75, 1.0);
  p.motifHitRange = ri(1, 5);
  p.precision = rf(0.7, 1.0);
  p.precisionRange = ri(0, 35);

  // Sound source
  const allFormants = Object.keys(FORMANT_PRESETS);
  p.activeFormants = allFormants.filter(() => Math.random() < 0.4);
  if (p.activeFormants.length === 0) p.activeFormants = [rp(allFormants)];
  p.formantChangeProb = rf(0.0, 0.4);
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
  p.surpriseDimensions = ["pitch"];
  if (Math.random() < 0.35) p.surpriseDimensions.push("octave");
  if (Math.random() < 0.3) p.surpriseDimensions.push("formant");
  if (Math.random() < 0.25) p.surpriseDimensions.push("rhythm");
  if (Math.random() < 0.2) p.surpriseDimensions.push("dynamics");
  if (Math.random() < 0.1) p.surpriseDimensions.push("rest");
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

function trackEngagement(type) {
  if (!exploreEngagement.plays) exploreEngagement.plays = 0;
  if (!exploreEngagement.saves) exploreEngagement.saves = 0;
  if (!exploreEngagement.startedAt) exploreEngagement.startedAt = Date.now();
  if (type === "play") exploreEngagement.plays++;
  if (type === "save") exploreEngagement.saves++;
  saveEngagement();

  fetch("/api/explore/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event_type: type,
      participant_id: pid(),
      parameters: { ...exploreParams },
      rating: exploreRating,
    }),
  }).catch(() => {});
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

function startVisualiser() {
  cancelAnimationFrame(animFrame);
  drawLoop();
}

function drawLoop() {
  if (!canvas || !canvasCtx) return;
  animFrame = requestAnimationFrame(drawLoop);

  updateEngineState();

  const data = synth.getSpectrum();
  if (!data || !synth.isPlaying) { drawStaticVis(); return; }

  const w = canvas.width, h = canvas.height;
  const ctx = canvasCtx;
  ctx.fillStyle = "#111820";
  ctx.fillRect(0, 0, w, h);

  const barW = w / data.length;
  for (let i = 0; i < data.length; i++) {
    const barH = (data[i] / 255) * (h - 10);
    const hue = 30 + (i / data.length) * 40;
    ctx.fillStyle = `hsl(${hue} 80% ${45 + (data[i] / 255) * 20}%)`;
    ctx.fillRect(i * barW, h - barH, Math.max(1.5, barW - 0.5), barH);
  }
}

function drawStaticVis() {
  if (!canvas || !canvasCtx) return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvasCtx;
  ctx.fillStyle = "#111820";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(245,158,11,0.15)";
  ctx.lineWidth = 1;
  for (let y = 20; y < h; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  ctx.fillStyle = "rgba(245,158,11,0.08)";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Press Play to start the visualiser", w / 2, h / 2);
}

function updateEngineState() {
  const state = synth.getEngineState();
  if (!state) return;
  const m = document.getElementById("statMotifs");
  const s = document.getElementById("statSeq");
  const n = document.getElementById("statNotes");
  if (m) m.textContent = state.motifCount;
  if (s) s.textContent = state.seqLen;
  if (n) n.textContent = state.notes;
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
pid();
route();
