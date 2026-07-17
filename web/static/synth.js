/**
 * synth.js — Three-timescale generative synthesiser for Resona.
 *
 * Architecture mirrors the mechanistic theory's hierarchical levels:
 *
 *   1. Note-to-note   – stacked interval distribution, repetition precision
 *   2. Motif           – repeated patterns, motif-pass surprise → incorporation
 *   3. Motif repertoire – motif sequences, motif-level surprise → sequence growth
 *
 * Audio: switchable formant synthesis (sawtooth → parallel bandpass at F1/F2/F3)
 * and additive Fourier synthesis from per-harmonic amplitude distributions.
 */

// ─── Seeded PRNG (xorshift32) ───────────────────────────────

import { KEMAR_HRIR, kemarBuffers } from "./kemar-hrir.js";
// Effects stage (docs/EFFECTS_CONTRACT.md). Importing index.js also registers
// the whole effect roster as a side effect, so createChainHost can resolve
// every effect type by the time playback starts.
import { createChainHost, sanitizeChain } from "./effects/index.js";
import { engineParams } from "./params.js";

export class SeededRNG {
  constructor(seed = 42) { this.s = (seed >>> 0) || 1; }
  next()  { let x=this.s; x^=x<<13; x^=x>>>17; x^=x<<5; this.s=x>>>0; return this.s/4294967296; }
  int(a,b){ return a + Math.floor(this.next()*(b-a)); }
  pick(a) { return a[this.int(0, a.length)]; }
  shuffle(a) { for(let i=a.length-1;i>0;i--){const j=this.int(0,i+1);[a[i],a[j]]=[a[j],a[i]];} return a; }
  /** Box-Muller transform → N(mean, sd²), using seeded stream */
  gaussian(mean = 0, sd = 1) {
    let u1;
    do { u1 = this.next(); } while (u1 === 0);   // avoid log(0)
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + sd * z;
  }
}

/**
 * Resolve the audible members of a sub-note layer stack. The base voice is a
 * first-class layer: it has its own level and joins the same additive solo set
 * as the captured layers. Kept pure so UI and audio behaviour can be verified
 * without constructing a Web Audio graph.
 */
export function layerMixPlan(params = {}, layerRenders = []) {
  const normalized = engineParams(params);
  const rawGain = Number(normalized.baseLayerGain ?? 1);
  const baseGain = Math.max(0, Math.min(2, Number.isFinite(rawGain) ? rawGain : 1));
  const baseSolo = !!normalized.baseLayerSolo;
  const layers = Array.isArray(layerRenders) ? layerRenders : [];
  const soloLayers = layers.filter(layer => !!layer?.solo);
  const anySolo = baseSolo || soloLayers.length > 0;
  return {
    baseGain,
    baseAudible: baseGain > 0 && (!anySolo || baseSolo),
    layers: anySolo ? soloLayers : layers,
  };
}

// ─── Formant presets (approximate adult male formant frequencies) ─
//
// F1-F3 from the classic Peterson & Barney measurements; F4/F5 and the
// per-formant bandwidths (bw, Hz) follow standard cascade-synthesis tables
// (Klatt-style): F4 ≈ 3.3-3.7 kHz, F5 ≈ 3.7-4.1 kHz, bandwidths widening
// with formant number. F4/F5 carry the "presence"/singer's-formant region
// that makes voices read as natural rather than filtered.

import { MEASURED_PROFILES } from "./measured_profiles.js";

export const FORMANT_PRESETS = {
  ah: { f1: 730, f2: 1090, f3: 2440, f4: 3300, f5: 3750, bw: [90, 110, 170, 250, 300], label: "ah" },
  ee: { f1: 270, f2: 2290, f3: 3010, f4: 3500, f5: 3950, bw: [60, 100, 150, 200, 260], label: "ee" },
  oo: { f1: 300, f2: 870,  f3: 2240, f4: 3300, f5: 3750, bw: [65, 110, 140, 190, 250], label: "oo" },
  eh: { f1: 530, f2: 1840, f3: 2480, f4: 3450, f5: 3900, bw: [75, 100, 160, 220, 280], label: "eh" },
  oh: { f1: 570, f2: 840,  f3: 2410, f4: 3300, f5: 3700, bw: [80, 110, 160, 230, 290], label: "oh" },
};
const FORMANT_ORDER = ["ee", "eh", "ah", "oh", "oo"];

/**
 * Register window weight for a pitch `offset` (in scale degrees) from the
 * register centre. This is a flat-topped (super-Gaussian) window, not a peak:
 * across the comfortable register the weight is ~1 everywhere (so no single
 * pitch, including the centre, is favoured — the centre note is not
 * over-repeated), and it only rolls off past the register edge. `width` is the
 * full plateau width in degrees; wider registers are flatter (exponent → ~8,
 * near-rectangular) while the narrowest stay near-Gaussian so that — only at
 * the extreme of narrow widths — the window collapses into a true centre pull.
 * `skew` widens one shoulder and narrows the other.
 */
export function registerWindow(offset, width, skew = 0) {
  const w = Math.max(1, Number(width) || 1);
  const side = offset >= 0 ? 1 : -1;
  const halfWidth = Math.max(1, w * 0.5 * (1 + skew * side * 0.75));
  const flatness = Math.max(0, Math.min(1, (w - 2) / 12));
  const shapeExp = 2 + flatness * 6;          // 2 (Gaussian) → 8 (≈ rectangular)
  return Math.exp(-0.5 * Math.pow(Math.abs(offset / halfWidth), shapeExp));
}

/**
 * Relative weight for a melodic interval of `stepDist` scale degrees.
 *
 * Always a normal (Gaussian) distribution — no pedestal, no flat top, nothing
 * artificially capped. Two knobs reshape the same bell:
 *
 *   RANGE  sets the spread at the broad end: σ = range/3, so the range edge
 *          sits at ±3σ and widening the range stretches the whole bell. Beyond
 *          the range an interval is disallowed (weight 0), but the Gaussian has
 *          already decayed to ~1% there, so the cut is invisible — not a cap.
 *
 *   SHAPE  (0..4 dial) shrinks σ as it rises, so the bell narrows from broad
 *          (jumpy: big leaps common) toward a sharp point at the extreme
 *          (stepwise: small intervals strongly favoured). The narrowing is
 *          concentrated near the top of the dial — the mid-range stays a
 *          moderate bell instead of spiking to "always repeat" too early.
 */
export function intervalShapeWeight(stepDist, shape, maxRange) {
  const range = Math.max(1, Number(maxRange) || 1);
  const ad = Math.abs(Number(stepDist) || 0);
  if (ad > range) return 0;
  const t = Math.max(0, Math.min(1, (Number(shape) || 0) / 4));
  // Bottom of the dial: uniform (equal probability of any interval size within
  // the range). Top of the dial: a sharp point at the centre (stepwise/repeat).
  // sigmaMax is large enough that within ±range the Gaussian is essentially flat
  // (edge ≈ 98% of peak), so the low extreme reads as equal probability; sigma
  // shrinks geometrically toward sigmaMin so it sharpens to a point at the top.
  const sigmaMin = 0.35;                 // sharp point at the extreme
  const sigmaMax = range * 5;            // ~flat / uniform across the range
  const sigma = sigmaMin * Math.pow(sigmaMax / sigmaMin, 1 - t);
  return Math.exp(-0.5 * Math.pow(ad / sigma, 2));
}

/**
 * Interpolate F1/F2/F3 for a continuous position on the vowel circle: the base
 * vowel offset by `dev` steps. dev=0 → the pure vowel; a fractional dev blends
 * linearly between the two adjacent pure vowels, so a missed vowel can sit
 * between them. Shared by the audio engine and any consumer.
 */
function formantFreqsAt(formant, dev = 0) {
  const order = FORMANT_ORDER.filter(f => FORMANT_PRESETS[f]);
  const n = order.length || 1;
  const baseIdx = Math.max(0, order.indexOf(FORMANT_PRESETS[formant] ? formant : "ah"));
  const pos = baseIdx + (dev || 0);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  const a = FORMANT_PRESETS[order[((lo % n) + n) % n]];
  const b = FORMANT_PRESETS[order[(((lo + 1) % n) + n) % n]];
  const lerp = (x, y) => x + (y - x) * frac;
  return {
    f1: lerp(a.f1, b.f1),
    f2: lerp(a.f2, b.f2),
    f3: lerp(a.f3, b.f3),
    f4: lerp(a.f4 || 3400, b.f4 || 3400),
    f5: lerp(a.f5 || 3800, b.f5 || 3800),
    bw: (a.bw || [80, 100, 160, 220, 280]).map((v, i) => lerp(v, (b.bw || a.bw || [])[i] ?? v)),
  };
}

// ─── 2D vowel space (log F1 × log F2) ────────────────────────
//
// Vowels are landmarks in a continuous two-dimensional acoustic space rather
// than stops on a ring: F1 (openness) × F2 (frontness), log-scaled so equal
// distances are roughly equal perceptual steps. Accuracy misses and surprises
// displace the realised vowel by a random DIRECTION and magnitude in this
// space, so extreme vowels deviate inward naturally — no wraparound fiction,
// no one-direction dead end at the ends of a line.
// See docs/FORMANT_SPACE_DESIGN.md.

export const VOWEL_POINTS = Object.fromEntries(
  Object.entries(FORMANT_PRESETS).map(([name, p]) => [
    name, { x: Math.log(p.f1), y: Math.log(p.f2) },
  ])
);

function _vowelDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Legacy unit conversion: old params measured formant deviation in "circle
// steps"; one step ≈ the mean distance between adjacent vowels on the old
// ee–eh–ah–oh–oo path. Old surprise distance (0..1) maps onto the largest
// pairwise landmark distance.
const VOWEL_STEP_UNIT = (() => {
  let sum = 0, n = 0;
  for (let i = 0; i < FORMANT_ORDER.length - 1; i++) {
    const a = VOWEL_POINTS[FORMANT_ORDER[i]], b = VOWEL_POINTS[FORMANT_ORDER[i + 1]];
    if (a && b) { sum += _vowelDist(a, b); n++; }
  }
  return n ? sum / n : 0.5;
})();
const VOWEL_MAX_DIST = (() => {
  let max = 0;
  const names = Object.keys(VOWEL_POINTS);
  for (const a of names) for (const b of names) {
    max = Math.max(max, _vowelDist(VOWEL_POINTS[a], VOWEL_POINTS[b]));
  }
  return max || 1;
})();
// Vowel region: bounding box of the landmarks, slightly inflated. The space
// between the horseshoe arms is real (schwa-like) vowel territory.
const VOWEL_BOUNDS = (() => {
  const pts = Object.values(VOWEL_POINTS);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = 0.06;
  return {
    minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad,
    minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad,
  };
})();

function clampToVowelRegion(pt) {
  return {
    x: Math.min(VOWEL_BOUNDS.maxX, Math.max(VOWEL_BOUNDS.minX, pt.x)),
    y: Math.min(VOWEL_BOUNDS.maxY, Math.max(VOWEL_BOUNDS.minY, pt.y)),
  };
}

export function vowelPointFor(name) {
  const p = VOWEL_POINTS[name] || VOWEL_POINTS.ah;
  return { x: p.x, y: p.y };
}

export function nearestVowel(pt) {
  let best = "ah", bestD = Infinity;
  for (const [name, p] of Object.entries(VOWEL_POINTS)) {
    const d = _vowelDist(pt, p);
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

/**
 * Resolve formant frequencies for a point in vowel space. F1/F2 come directly
 * from the point; F3 (not part of the space) is inverse-distance-weighted
 * from the landmark vowels.
 */
export function formantFreqsAtPoint(pt) {
  let wSum = 0, f3 = 0, f4 = 0, f5 = 0;
  const bw = [0, 0, 0, 0, 0];
  for (const [name, p] of Object.entries(VOWEL_POINTS)) {
    const w = 1 / (Math.pow(_vowelDist(pt, p), 2) + 1e-4);
    const preset = FORMANT_PRESETS[name];
    wSum += w;
    f3 += w * preset.f3;
    f4 += w * (preset.f4 || 3400);
    f5 += w * (preset.f5 || 3800);
    (preset.bw || [80, 100, 160, 220, 280]).forEach((b, i) => { bw[i] += w * b; });
  }
  return {
    f1: Math.exp(pt.x), f2: Math.exp(pt.y),
    f3: f3 / wSum, f4: f4 / wSum, f5: f5 / wSum,
    bw: bw.map(b => b / wSum),
  };
}

// ─── Percussion sound definitions ───────────────────────────

export const PERC_SOUNDS = {
  click:  { type: "noise", filterType: "highpass", filterFreq: 6000, filterQ: 1,   decay: 0.02,  amp: 0.5,  label: "Click" },
  tick:   { type: "noise", filterType: "bandpass", filterFreq: 3500, filterQ: 2,   decay: 0.03,  amp: 0.4,  label: "Tick" },
  hat:    { type: "noise", filterType: "highpass", filterFreq: 8000, filterQ: 0.5, decay: 0.06,  amp: 0.35, label: "Hi-hat" },
  rim:    { type: "noise", filterType: "bandpass", filterFreq: 1200, filterQ: 3,   decay: 0.04,  amp: 0.5,  label: "Rim" },
  snap:   { type: "noise", filterType: "bandpass", filterFreq: 2000, filterQ: 5,   decay: 0.035, amp: 0.45, label: "Snap" },
  pop:    { type: "sine",  freq: 400,  freqEnd: 80,  decay: 0.06, amp: 0.5,  label: "Pop" },
  wood:   { type: "sine",  freq: 800,  freqEnd: 300, decay: 0.04, amp: 0.4,  label: "Wood" },
  bell:   { type: "sine",  freq: 1200, freqEnd: 600, decay: 0.15, amp: 0.3,  label: "Bell" },
};

// Owner 07-07 round 3: each room is a PARAMETRIC impulse-response model
// (no audio files enter the repo — a room is a recipe, not a recording).
// duration/shape/early/shimmer are the legacy tail controls; size, damping
// and diffusion are the room-designer starting points, with RT60s and
// character grounded in room-acoustics ranges (Sabine-order magnitudes:
// booth ~0.2 s, living room ~0.5 s, chamber ~1 s, hall ~2 s, cathedral
// 5-8 s; plate/spring model the classic electromechanical units).
export const REVERB_PROFILES = {
  studio: { label: "Studio booth", duration: 0.35, shape: 2.6, early: 0.6, shimmer: 0.06,
    size: 0.15, damping: 0.75, diffusion: 0.6,
    blurb: "treated recording booth — the room barely answers back" },
  room: { label: "Room", duration: 0.9, shape: 2.2, early: 0.55, shimmer: 0.10,
    size: 0.35, damping: 0.5, diffusion: 0.5,
    blurb: "a lived-in living room: soft furniture eats the highs" },
  bathroom: { label: "Bathroom", duration: 1.1, shape: 1.9, early: 0.75, shimmer: 0.35,
    size: 0.12, damping: 0.05, diffusion: 0.3,
    blurb: "small and tiled — bright, fluttery, a touch comic" },
  chamber: { label: "Chamber", duration: 1.6, shape: 1.9, early: 0.5, shimmer: 0.14,
    size: 0.45, damping: 0.35, diffusion: 0.65,
    blurb: "wood-panelled chamber: intimate, warm, quick to bloom" },
  plate: { label: "Plate", duration: 1.8, shape: 1.25, early: 0.28, shimmer: 0.30,
    size: 0.5, damping: 0.15, diffusion: 0.95,
    blurb: "EMT-style steel plate — instantly dense, no walls at all" },
  hall: { label: "Hall", duration: 2.9, shape: 1.7, early: 0.42, shimmer: 0.16,
    size: 0.7, damping: 0.3, diffusion: 0.7,
    blurb: "concert hall: clear early bounces, then a long bloom" },
  cathedral: { label: "Cathedral", duration: 5.2, shape: 1.1, early: 0.35, shimmer: 0.12,
    size: 0.95, damping: 0.25, diffusion: 0.8,
    blurb: "stone vaults — seconds of tail, syllables melt together" },
  cave: { label: "Cave", duration: 4.2, shape: 1.3, early: 0.3, shimmer: 0.2,
    size: 0.85, damping: 0.55, diffusion: 0.25,
    blurb: "irregular rock: sparse distinct echoes, a dark long tail" },
  forest: { label: "Forest", duration: 1.4, shape: 2.8, early: 0.25, shimmer: 0.08,
    size: 0.8, damping: 0.85, diffusion: 0.15,
    blurb: "outdoors — almost no tail, a few soft echoes off the trees" },
  spring: { label: "Spring", duration: 1.5, shape: 1.55, early: 0.22, shimmer: 0.45,
    size: 0.3, damping: 0.2, diffusion: 0.4,
    blurb: "guitar-amp spring tank: boingy, dispersive, proudly fake" },
};

// The room's first bounces — one deterministic pattern shared by the
// convolver builder AND the UI drawings, so what you see is what plays.
// size moves the first reflection later (bigger room = longer path);
// diffusion adds density (sparse distinct echoes -> smooth wash).
export function earlyReflectionPattern(type, size = 0.5, diffusion = 0.5) {
  const profile = REVERB_PROFILES[type] || REVERB_PROFILES.room;
  const seed = Array.from(String(type)).reduce((s, c) => s + c.charCodeAt(0), 17);
  const count = Math.max(3, Math.round(4 + profile.early * 8 + diffusion * 14));
  const base = 0.004 + size * 0.03; // first bounce 4..34 ms
  const refl = [];
  let t = base;
  for (let r = 0; r < count; r++) {
    const h = Math.sin((r + 1) * 12.9898 + seed) * 43758.5453;
    const jitter = h - Math.floor(h);
    refl.push({
      t,
      gain: (profile.early * 0.9) / (1 + r * (1.4 - diffusion * 0.7)) * (r % 2 ? -0.75 : 1),
      side: r % 2 ? 1 : -1,
    });
    t += base * (0.35 + 0.65 * jitter) * (0.5 + diffusion * 0.9) / (1 + r * 0.08);
  }
  return refl;
}

// Ear models: parametric listeners on the same published physics.
// earDistance sets the Woodworth/Brown-Duda geometry (head widths span
// published adult anthropometry, ~14-20 cm bitragion), headDensity scales
// the shadow around Brown-Duda's values, pinnaScale scales the Shaw
// concha/flange cues (0 = no outer ear at all).
export const EAR_MODELS = {
  average: { label: "Average head", earDistance: 0.175, headDensity: 0.5, pinnaScale: 1,
    blurb: "the published baseline: Brown-Duda sphere, Shaw pinna" },
  small: { label: "Small head", earDistance: 0.145, headDensity: 0.45, pinnaScale: 0.85,
    blurb: "narrower head: smaller time gaps, shadow starts higher" },
  large: { label: "Large head", earDistance: 0.2, headDensity: 0.6, pinnaScale: 1.1,
    blurb: "wider head: bigger time gaps, heavier shadow" },
  batEars: { label: "Prominent pinna", earDistance: 0.175, headDensity: 0.5, pinnaScale: 1.6,
    blurb: "exaggerated outer ear: front/behind is unmistakable" },
  sphere: { label: "Bare sphere", earDistance: 0.175, headDensity: 0.5, pinnaScale: 0,
    blurb: "no outer ear: ITD + shadow only — behind sounds like front" },
  // Fitted from MEASURED data (owner 07-07: real models, not guesses) by
  // scripts/fit_ear_models.mjs against the MIT KEMAR set — Gardner &
  // Martin 1994, MIT Media Lab TR #280, free with attribution. Only the
  // fitted parameters live here; the dataset never enters the repo.
  // KEMAR wears two different pinnae (normal DB-061 left, large DB-065
  // right), so one mannequin yields two models on the same head:
  // earDistance from Woodworth ITD (RMSE 16 µs), headDensity from the
  // Brown-Duda shadow (the two ears agree independently: 0.274/0.272),
  // pinnaScale per pinna from the Shaw front/behind bands (~3 dB RMSE).
  kemar: { label: "KEMAR (fitted)", earDistance: 0.17, headDensity: 0.27, pinnaScale: 0.49,
    blurb: "fitted to measured MIT KEMAR HRTFs (Gardner & Martin 1994, DB-061 pinna)" },
  kemarLarge: { label: "KEMAR large pinna (fitted)", earDistance: 0.17, headDensity: 0.27, pinnaScale: 0.93,
    blurb: "fitted to measured MIT KEMAR HRTFs (Gardner & Martin 1994, DB-065 pinna)" },
  // The MEASURED reference (owner 07-07 route 2): not a parametric filter
  // at all — the actual KEMAR impulse responses convolved per ear. The
  // nominal numbers below are the fitted values, used only for the field
  // drawing and as a fallback; `measured` flips the audio to convolution.
  // A/B this against `kemar` to hear whether the replica is good enough.
  kemarMeasured: { label: "KEMAR (measured HRIR)", earDistance: 0.17, headDensity: 0.27, pinnaScale: 0.49,
    measured: true,
    blurb: "the real thing: measured MIT KEMAR impulse responses, convolved per ear" },
};

// ─── Approximate harmonic fingerprints for common instruments ─────
//
// Each partial is a fixed frequency slot. Its amplitude is sampled from a
// per-partial distribution, then shaped by note dynamics:
//   A_n ~ Normal(mean_n * (velocity / pivot) ^ (dyn_n * dynamicsAmount), sd_n)
// where higher dyn values make upper harmonics bloom more strongly at high
// dynamics, a characteristic especially important for brass and winds. Register
// response follows a source-filter shape: a per-partial source slope changes
// with fundamental pitch, while broad instrument resonances act on absolute
// harmonic frequency.

export const SPECTRAL_PROFILES = {
  flute: {
    label: "Flute",
    partials: [
      { amp: 1.00, spread: 0.12, dyn: -0.05 }, { amp: 0.28, spread: 0.18, dyn: 0.05 },
      { amp: 0.11, spread: 0.22, dyn: 0.12 }, { amp: 0.055, spread: 0.25, dyn: 0.18 },
      { amp: 0.030, spread: 0.28, dyn: 0.22 }, { amp: 0.020, spread: 0.30, dyn: 0.26 },
      { amp: 0.014, spread: 0.32, dyn: 0.30 }, { amp: 0.010, spread: 0.34, dyn: 0.34 },
      { amp: 0.0075, spread: 0.36, dyn: 0.38 }, { amp: 0.0060, spread: 0.38, dyn: 0.42 },
      { amp: 0.0048, spread: 0.40, dyn: 0.46 }, { amp: 0.0039, spread: 0.42, dyn: 0.50 },
      { amp: 0.0031, spread: 0.44, dyn: 0.54 }, { amp: 0.0025, spread: 0.46, dyn: 0.58 },
      { amp: 0.0020, spread: 0.48, dyn: 0.62 }, { amp: 0.0016, spread: 0.50, dyn: 0.66 },
      { amp: 0.0013, spread: 0.52, dyn: 0.70 }, { amp: 0.0011, spread: 0.54, dyn: 0.74 },
      { amp: 0.0009, spread: 0.56, dyn: 0.78 }, { amp: 0.0007, spread: 0.58, dyn: 0.82 },
    ],
  },
  clarinet: {
    label: "Clarinet",
    partials: [
      { amp: 1.00, spread: 0.16, dyn: 0.00 }, { amp: 0.09, spread: 0.28, dyn: 0.08 },
      { amp: 0.74, spread: 0.18, dyn: 0.22 }, { amp: 0.065, spread: 0.30, dyn: 0.16 },
      { amp: 0.48, spread: 0.22, dyn: 0.38 }, { amp: 0.045, spread: 0.32, dyn: 0.24 },
      { amp: 0.32, spread: 0.26, dyn: 0.54 }, { amp: 0.032, spread: 0.34, dyn: 0.30 },
      { amp: 0.22, spread: 0.30, dyn: 0.70 }, { amp: 0.024, spread: 0.36, dyn: 0.36 },
      { amp: 0.16, spread: 0.34, dyn: 0.86 }, { amp: 0.018, spread: 0.38, dyn: 0.42 },
      { amp: 0.115, spread: 0.38, dyn: 1.02 }, { amp: 0.014, spread: 0.40, dyn: 0.48 },
      { amp: 0.082, spread: 0.42, dyn: 1.18 }, { amp: 0.010, spread: 0.42, dyn: 0.54 },
      { amp: 0.058, spread: 0.46, dyn: 1.34 }, { amp: 0.0075, spread: 0.44, dyn: 0.60 },
      { amp: 0.041, spread: 0.50, dyn: 1.50 }, { amp: 0.0055, spread: 0.46, dyn: 0.66 },
    ],
  },
  violin: {
    label: "Violin",
    partials: [
      { amp: 0.82, spread: 0.20, dyn: 0.05 }, { amp: 1.00, spread: 0.18, dyn: 0.14 },
      { amp: 0.74, spread: 0.22, dyn: 0.24 }, { amp: 0.63, spread: 0.24, dyn: 0.34 },
      { amp: 0.50, spread: 0.26, dyn: 0.44 }, { amp: 0.39, spread: 0.30, dyn: 0.54 },
      { amp: 0.34, spread: 0.34, dyn: 0.64 }, { amp: 0.27, spread: 0.36, dyn: 0.74 },
      { amp: 0.23, spread: 0.38, dyn: 0.84 }, { amp: 0.19, spread: 0.40, dyn: 0.94 },
      { amp: 0.16, spread: 0.42, dyn: 1.04 }, { amp: 0.135, spread: 0.44, dyn: 1.14 },
      { amp: 0.112, spread: 0.46, dyn: 1.24 }, { amp: 0.092, spread: 0.48, dyn: 1.34 },
      { amp: 0.076, spread: 0.50, dyn: 1.44 }, { amp: 0.064, spread: 0.52, dyn: 1.54 },
      { amp: 0.052, spread: 0.54, dyn: 1.64 }, { amp: 0.043, spread: 0.56, dyn: 1.74 },
      { amp: 0.035, spread: 0.58, dyn: 1.84 }, { amp: 0.029, spread: 0.60, dyn: 1.94 },
    ],
  },
  cello: {
    label: "Cello",
    partials: [
      { amp: 1.00, spread: 0.17, dyn: 0.00 }, { amp: 0.82, spread: 0.18, dyn: 0.10 },
      { amp: 0.58, spread: 0.22, dyn: 0.22 }, { amp: 0.43, spread: 0.24, dyn: 0.34 },
      { amp: 0.31, spread: 0.27, dyn: 0.46 }, { amp: 0.23, spread: 0.30, dyn: 0.58 },
      { amp: 0.18, spread: 0.33, dyn: 0.70 }, { amp: 0.14, spread: 0.36, dyn: 0.82 },
      { amp: 0.108, spread: 0.39, dyn: 0.94 }, { amp: 0.084, spread: 0.42, dyn: 1.06 },
      { amp: 0.066, spread: 0.45, dyn: 1.18 }, { amp: 0.052, spread: 0.48, dyn: 1.30 },
      { amp: 0.041, spread: 0.51, dyn: 1.42 }, { amp: 0.032, spread: 0.54, dyn: 1.54 },
      { amp: 0.025, spread: 0.56, dyn: 1.66 }, { amp: 0.020, spread: 0.58, dyn: 1.78 },
      { amp: 0.016, spread: 0.60, dyn: 1.90 }, { amp: 0.013, spread: 0.62, dyn: 2.02 },
      { amp: 0.010, spread: 0.64, dyn: 2.14 }, { amp: 0.008, spread: 0.66, dyn: 2.26 },
    ],
  },
  trumpet: {
    label: "Trumpet",
    partials: [
      { amp: 0.58, spread: 0.15, dyn: -0.10 }, { amp: 0.84, spread: 0.16, dyn: 0.05 },
      { amp: 1.00, spread: 0.18, dyn: 0.25 }, { amp: 0.92, spread: 0.20, dyn: 0.45 },
      { amp: 0.76, spread: 0.22, dyn: 0.65 }, { amp: 0.62, spread: 0.24, dyn: 0.85 },
      { amp: 0.50, spread: 0.27, dyn: 1.05 }, { amp: 0.40, spread: 0.30, dyn: 1.25 },
      { amp: 0.32, spread: 0.33, dyn: 1.45 }, { amp: 0.255, spread: 0.36, dyn: 1.65 },
      { amp: 0.202, spread: 0.39, dyn: 1.85 }, { amp: 0.160, spread: 0.42, dyn: 2.05 },
      { amp: 0.126, spread: 0.45, dyn: 2.25 }, { amp: 0.099, spread: 0.48, dyn: 2.45 },
      { amp: 0.078, spread: 0.51, dyn: 2.65 }, { amp: 0.061, spread: 0.54, dyn: 2.85 },
      { amp: 0.048, spread: 0.57, dyn: 3.05 }, { amp: 0.038, spread: 0.60, dyn: 3.25 },
      { amp: 0.030, spread: 0.63, dyn: 3.45 }, { amp: 0.024, spread: 0.66, dyn: 3.65 },
    ],
  },
  trombone: {
    label: "Trombone",
    partials: [
      { amp: 0.74, spread: 0.15, dyn: -0.08 }, { amp: 1.00, spread: 0.16, dyn: 0.04 },
      { amp: 0.86, spread: 0.18, dyn: 0.22 }, { amp: 0.74, spread: 0.20, dyn: 0.40 },
      { amp: 0.61, spread: 0.23, dyn: 0.58 }, { amp: 0.50, spread: 0.26, dyn: 0.76 },
      { amp: 0.41, spread: 0.29, dyn: 0.94 }, { amp: 0.335, spread: 0.32, dyn: 1.12 },
      { amp: 0.272, spread: 0.35, dyn: 1.30 }, { amp: 0.220, spread: 0.38, dyn: 1.48 },
      { amp: 0.178, spread: 0.41, dyn: 1.66 }, { amp: 0.143, spread: 0.44, dyn: 1.84 },
      { amp: 0.115, spread: 0.47, dyn: 2.02 }, { amp: 0.092, spread: 0.50, dyn: 2.20 },
      { amp: 0.073, spread: 0.53, dyn: 2.38 }, { amp: 0.058, spread: 0.56, dyn: 2.56 },
      { amp: 0.046, spread: 0.59, dyn: 2.74 }, { amp: 0.036, spread: 0.62, dyn: 2.92 },
      { amp: 0.029, spread: 0.65, dyn: 3.10 }, { amp: 0.023, spread: 0.68, dyn: 3.28 },
    ],
  },
  piano: {
    label: "Piano",
    partials: [
      { amp: 1.00, spread: 0.18, dyn: 0.00 }, { amp: 0.74, spread: 0.20, dyn: 0.10 },
      { amp: 0.48, spread: 0.23, dyn: 0.20 }, { amp: 0.32, spread: 0.26, dyn: 0.30 },
      { amp: 0.225, spread: 0.29, dyn: 0.40 }, { amp: 0.160, spread: 0.32, dyn: 0.50 },
      { amp: 0.116, spread: 0.35, dyn: 0.60 }, { amp: 0.085, spread: 0.38, dyn: 0.70 },
      { amp: 0.063, spread: 0.41, dyn: 0.80 }, { amp: 0.047, spread: 0.44, dyn: 0.90 },
      { amp: 0.035, spread: 0.47, dyn: 1.00 }, { amp: 0.026, spread: 0.50, dyn: 1.10 },
      { amp: 0.020, spread: 0.53, dyn: 1.20 }, { amp: 0.015, spread: 0.56, dyn: 1.30 },
      { amp: 0.011, spread: 0.59, dyn: 1.40 }, { amp: 0.0085, spread: 0.62, dyn: 1.50 },
      { amp: 0.0065, spread: 0.65, dyn: 1.60 }, { amp: 0.0050, spread: 0.68, dyn: 1.70 },
      { amp: 0.0038, spread: 0.71, dyn: 1.80 }, { amp: 0.0030, spread: 0.74, dyn: 1.90 },
    ],
  },
  vocal: {
    label: "Vocal",
    partials: [
      { amp: 1.00, spread: 0.16, dyn: -0.05 }, { amp: 0.62, spread: 0.18, dyn: 0.06 },
      { amp: 0.42, spread: 0.22, dyn: 0.18 }, { amp: 0.31, spread: 0.24, dyn: 0.30 },
      { amp: 0.24, spread: 0.28, dyn: 0.42 }, { amp: 0.19, spread: 0.31, dyn: 0.54 },
      { amp: 0.155, spread: 0.34, dyn: 0.66 }, { amp: 0.126, spread: 0.37, dyn: 0.78 },
      { amp: 0.102, spread: 0.40, dyn: 0.90 }, { amp: 0.083, spread: 0.43, dyn: 1.02 },
      { amp: 0.067, spread: 0.46, dyn: 1.14 }, { amp: 0.054, spread: 0.49, dyn: 1.26 },
      { amp: 0.044, spread: 0.52, dyn: 1.38 }, { amp: 0.035, spread: 0.55, dyn: 1.50 },
      { amp: 0.028, spread: 0.58, dyn: 1.62 }, { amp: 0.023, spread: 0.61, dyn: 1.74 },
      { amp: 0.018, spread: 0.64, dyn: 1.86 }, { amp: 0.015, spread: 0.67, dyn: 1.98 },
      { amp: 0.012, spread: 0.70, dyn: 2.10 }, { amp: 0.0095, spread: 0.73, dyn: 2.22 },
    ],
  },
};

// WP-3 catalogue entries whose spectral tables are replaced below by the
// measured corpus.  The seed supplies only the existing continuous dynamic
// law until WP-5/7/8 freeze per-instrument presets; it is not presented as a
// fitted fingerprint.
for (const [key, label, seed] of [
  ["alto-sax", "Alto saxophone", "clarinet"],
  ["french-horn", "French horn", "trombone"],
  ["guitar", "Acoustic guitar", "piano"],
  ["piano-upright", "Upright piano", "piano"],
  ["voice-tenor", "Tenor voice", "vocal"],
  ["voice-bass", "Bass voice", "vocal"],
  ["voice-mezzo", "Mezzo-soprano voice", "vocal"],
]) {
  SPECTRAL_PROFILES[key] = {
    label,
    partials: SPECTRAL_PROFILES[seed].partials.map(partial => ({ ...partial })),
  };
}

export function spectralDefaultRegisterSensitivity(index, count = 20) {
  const t = count <= 1 ? 0 : index / (count - 1);
  return Math.pow(t, 0.85) * 1.45 - 0.35;
}

const SPECTRAL_RESONANCES = {
  flute: [
    { freq: 900, gain: 0.18, width: 0.65 },
    { freq: 2200, gain: 0.32, width: 0.52 },
    { freq: 5200, gain: -0.18, width: 0.75 },
  ],
  clarinet: [
    { freq: 520, gain: 0.28, width: 0.55 },
    { freq: 1500, gain: -0.16, width: 0.45 },
    { freq: 2600, gain: 0.34, width: 0.58 },
  ],
  violin: [
    { freq: 450, gain: -0.10, width: 0.75 },
    { freq: 1250, gain: 0.20, width: 0.55 },
    { freq: 3000, gain: 0.36, width: 0.62 },
  ],
  cello: [
    { freq: 180, gain: 0.20, width: 0.65 },
    { freq: 620, gain: 0.28, width: 0.55 },
    { freq: 2100, gain: -0.12, width: 0.75 },
  ],
  trumpet: [
    { freq: 700, gain: 0.12, width: 0.55 },
    { freq: 1700, gain: 0.32, width: 0.48 },
    { freq: 3600, gain: 0.38, width: 0.55 },
  ],
  trombone: [
    { freq: 260, gain: 0.18, width: 0.62 },
    { freq: 760, gain: 0.26, width: 0.55 },
    { freq: 2100, gain: 0.24, width: 0.62 },
  ],
  piano: [
    { freq: 140, gain: 0.16, width: 0.80 },
    { freq: 900, gain: 0.18, width: 0.70 },
    { freq: 3200, gain: -0.10, width: 0.80 },
  ],
  vocal: [
    { freq: 730, gain: 0.32, width: 0.35 },
    { freq: 1090, gain: 0.22, width: 0.38 },
    { freq: 2440, gain: 0.26, width: 0.45 },
  ],
};

const LEGACY_SPECTRAL_RESONANCES = Object.fromEntries(
  Object.entries(SPECTRAL_RESONANCES).map(([key, bands]) =>
    [key, bands.map(band => ({ ...band }))]));
const BODY_FALLBACK_SEEDS = {
  "alto-sax": "clarinet", "french-horn": "trombone", guitar: "piano",
  "piano-upright": "piano",
  "voice-tenor": "vocal", "voice-bass": "vocal", "voice-mezzo": "vocal",
};

/** T-035/T-007: resolve the measured-body contract before any consumer.
 * An explicitly present `resonances` array is data even when empty: empty
 * means the measurement rejected a stable body and MUST suppress the legacy
 * fallback. Only a genuinely absent measurement may borrow a logged body. */
export function resolveMeasuredBody(profileKey, measured, fallbackBands = [],
                                    fallbackLabel = "legacy", warn = console.warn) {
  const hasDecision = !!measured &&
    Object.prototype.hasOwnProperty.call(measured, "resonances");
  if (hasDecision) {
    const bands = Array.isArray(measured.resonances)
      ? measured.resonances.map(band => ({ ...band })) : [];
    return {
      bands,
      status: bands.length ? "measured" : "omitted",
      fit: measured.resonancesFit && typeof measured.resonancesFit === "object"
        ? { ...measured.resonancesFit } : null,
    };
  }
  if (typeof warn === "function") {
    warn(`[SG2 body fallback] ${profileKey} has no measured-body decision; using ${fallbackLabel}`);
  }
  return {
    bands: Array.isArray(fallbackBands) ? fallbackBands.map(band => ({ ...band })) : [],
    status: "fallback",
    fit: null,
  };
}

// Resolve EVERY legacy/borrowed body through the same contract. This avoids
// constructing BODY_PRESETS from a stale legacy body and trying to repair it
// later (the precise plumbing fault behind L6 and T-035).
for (const profileKey of new Set([
  ...Object.keys(LEGACY_SPECTRAL_RESONANCES), ...Object.keys(BODY_FALLBACK_SEEDS),
])) {
  const fallbackKey = BODY_FALLBACK_SEEDS[profileKey] || profileKey;
  const fallback = LEGACY_SPECTRAL_RESONANCES[fallbackKey] || [];
  const decision = resolveMeasuredBody(profileKey, MEASURED_PROFILES[profileKey],
    fallback, fallbackKey);
  SPECTRAL_RESONANCES[profileKey] = decision.bands;
  if (SPECTRAL_PROFILES[profileKey]) {
    SPECTRAL_PROFILES[profileKey].resonances = decision.bands;
    SPECTRAL_PROFILES[profileKey].resonancesFit = decision.fit;
    SPECTRAL_PROFILES[profileKey].bodyMeasurementStatus = decision.status;
  }
}

// ── Tone model v2: the Body stage (T5, docs/TONE_MODEL_V2_DESIGN.md §3.3) ──
//
// A body is a set of fixed-Hz resonance bands — the box around the
// resonator. Instrument bodies come from the measured resonance tables;
// VOWELS ARE BODIES TOO: each formant preset becomes a five-band vocal
// body (F1–F5 with Klatt-ish descending gains, widths from the measured
// bandwidths), which is what unifies the old formant path into the chain.
export const BODY_PRESETS = (() => {
  const presets = {};
  for (const [key, bands] of Object.entries(SPECTRAL_RESONANCES)) {
    presets[key] = { label: `${key} body`, bands };
  }
  // log2 units, F1 strongest — scaled so a full-strength F1 peak (2^2 = 4x)
  // stays inside bodyResponse's 4.5x ceiling instead of saturating flat.
  const vowelGains = [2.0, 1.7, 1.2, 0.9, 0.7];
  for (const [v, f] of Object.entries(FORMANT_PRESETS)) {
    const freqs = [f.f1, f.f2, f.f3, f.f4, f.f5];
    presets[`vowel-${v}`] = {
      label: `vowel ${f.label || v}`,
      vocal: true,
      bands: freqs.map((freq, i) => ({
        freq,
        gain: vowelGains[i],
        width: Math.max(0.1, ((f.bw && f.bw[i]) || 90) / freq * 1.9),
      })),
    };
  }
  // WP-3 vowel-conditioned F1-F5 fits.  These coexist with the generic
  // vowel bodies so old saved presets retain their exact lookup keys.
  for (const [profileKey, measured] of Object.entries(MEASURED_PROFILES)) {
    if (!profileKey.startsWith("voice-") || !measured?.vowelFormants) continue;
    for (const [vowel, fit] of Object.entries(measured.vowelFormants)) {
      const freqs = Array.isArray(fit?.formantsHz) ? fit.formantsHz : [];
      const bandwidths = Array.isArray(fit?.bandwidthsHz) ? fit.bandwidthsHz : [];
      if (freqs.length < 5) continue;
      presets[`${profileKey}-${vowel}`] = {
        label: `${SPECTRAL_PROFILES[profileKey]?.label || profileKey} /${vowel}/`,
        vocal: true,
        measured: true,
        bands: freqs.slice(0, 5).map((freq, i) => ({
          freq,
          gain: vowelGains[i],
          width: Math.max(0.1, (bandwidths[i] || 90) / freq * 1.9),
        })),
      };
    }
  }
  return presets;
})();

// ── Tone model v2: preset migration (T6, §7) ──
// Best-effort translation of pre-v2 tone parameters. The engine's own
// fallbacks already keep old presets SOUNDING right; this normalises the
// stored values so the UI shows the migrated model and dead keys stop
// travelling. Pure — returns a new object.
export function migrateToneParams(p) {
  if (!p || typeof p !== "object") return p;
  const out = { ...p };
  if (!Number.isFinite(out.partialB) && Number.isFinite(out.spectralStretchCents) && out.spectralStretchCents > 0) {
    out.partialB = legacyStretchToB(out.spectralStretchCents);
  }
  if (!Number.isFinite(out.excitationHuman)) {
    const prob = Number.isFinite(out.spectralDriftProb) ? out.spectralDriftProb : null;
    const depth = Number.isFinite(out.spectralDriftDepth) ? out.spectralDriftDepth : null;
    if (prob !== null || depth !== null) {
      // Old within-note wobble maps onto the Human dial, capped modest
      out.excitationHuman = Math.max(0, Math.min(0.7, 0.1 + (prob ?? 1) * (depth ?? 0.35) * 0.7));
    }
  }
  // CH-B1: the Formant sound-source mode retires — old formant presets
  // become vocal-bodied chain patches (articulation params carry over).
  if (out.voiceMode === "formant") {
    if (!Number.isFinite(out.bodyArticulation)) out.bodyArticulation = 1;
    if (!out.spectralProfile || out.spectralProfile === "violin") out.spectralProfile = "vocal";
    out.spectralMix = Math.max(0.6, Number(out.spectralMix) || 0);
    out.voiceMode = "fourier";
  }
  for (const dead of [
    "spectralProb", "spectralDriftProb", "spectralDriftDepth", "spectralDriftRate",
    "spectralLoudnessNorm", "spectralRegisterAmount", "spectralPartialDyns", "spectralPartialRegs",
  ]) delete out[dead];
  return out;
}

// Which bands apply: an explicit bodyType wins; "auto" keeps the
// instrument's own body (the pre-T5 behaviour, so old presets are
// untouched).
export function bodyBandsFor(p, profile) {
  const key = p?.bodyType;
  if (key === "vocal") return BODY_PRESETS["vowel-ah"].bands; // articulated: 'ah' baseline for displays
  if (key && key !== "auto" && BODY_PRESETS[key]) return BODY_PRESETS[key].bands;
  return (profile && profile.resonances) || [];
}

/** T-004: a deconvolved measured table reconstructs its real body at the
 * emitted reconstructionAmount (normally 1). Legacy/unmeasured profiles keep
 * the historical 0.35 fallback; an explicit user value always wins. */
export function bodyAmountFor(p, profile) {
  if (Number.isFinite(p?.spectralResonanceAmount)) {
    return Math.max(0, Math.min(1.5, Number(p.spectralResonanceAmount)));
  }
  const fitted = profile?.resonancesFit?.reconstructionAmount;
  if (profile?.bodyMeasurementStatus !== "fallback" && Number.isFinite(fitted)) {
    return Math.max(0, Math.min(1.5, Number(fitted)));
  }
  return 0.35;
}

// Owner L4: blown airflow level is a deterministic consequence of the
// instrument/dynamic laws.  Human variation belongs in the continuous
// turbulence trace, not in a per-note gate that can randomly remove breath.
export function toneBreathLevelFor(excitationType, breath, nextRandom = Math.random) {
  const level = Math.max(0, Number.isFinite(breath) ? breath : 0);
  return excitationType === "blow" ? level : nextRandom() * level;
}

// ── Tone model v2: SPACE positioning (owner request 2026-07-06) ──
// The instrument sits at a distance and bearing from the listener. The
// direct path gets true physics; the reverb stays diffuse, so the
// direct-to-reverb balance falls with distance by construction. Pure
// laws exported for headless assertion.
export function spaceArrivalDelay(distM) {
  return Math.max(0.3, Math.min(30, distM ?? 2.5)) / 343; // speed of sound
}
// Air absorbs highs with distance: ~full band close-up, ~3.6 kHz at 30 m.
export function spaceAirCutoff(distM) {
  const d = Math.max(0.3, Math.min(30, distM ?? 2.5));
  return Math.max(3500, Math.min(20000, 20000 * Math.pow(1 / Math.max(1, d), 0.5)));
}
// Proximity effect: bass lift that only exists inside ~1.2 m, growing as
// the source approaches the listener's head.
export function spaceProximityDb(distM) {
  const d = Math.max(0.3, Math.min(30, distM ?? 2.5));
  return d < 1.2 ? 10 * (1.2 - d) / 1.2 : 0;
}

// ── Q4: binaural head model (owner request 2026-07-07; physics
// grounded in published models per owner request 07-07 round 4) ─────
// The listener has a real head. Each cue uses a real model:
//   ITD    — Woodworth (1938) frontal-arc formula, the standard
//            geometric-acoustics ITD for a spherical head.
//   Shadow — Brown & Duda (1998, IEEE Trans. Speech Audio Proc.,
//            "A structural model for binaural sound synthesis"):
//            a spherical-head shadow is FREQUENCY-DEPENDENT — lows
//            diffract around the head almost unattenuated, highs shadow
//            up to ~-20 dB at the deepest-shadow angle (150° from the
//            ear axis), and the near ear gets a ~+6 dB high-frequency
//            "bright spot". Their one-pole/one-zero filter is realised
//            here as a high shelf at f0 = c/(2πa) with gain 20·log10 α(θ).
//   Pinna  — Shaw (1974, JASA 56, free-field-to-eardrum transformation)
//            + Blauert's directional bands: the concha resonance
//            (~4.3 kHz) amplifies FRONTAL sound; sources behind lose
//            that gain (≈8 dB dead-behind) and the pinna flange shadows
//            the highs above ~8 kHz (≈7 dB). Both scale smoothly from
//            zero at ±90° to full at 180° — the front half-plane is
//            untouched, exactly as measured HRTFs show.
// "Head size" IS ear distance (a = earDistance/2), so geometry has one
// knob; headDensity scales the shadow dB around the published values
// (0.5 = exactly Brown-Duda, 0 = acoustically transparent, 1 = doubled).
// All pure, asserted headlessly.

const SPEED_OF_SOUND = 343;

export function foldAngle(angleRad) {
  let a = angleRad % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// Signed interaural time difference — Woodworth (d/2)(θ+sinθ)/c with the
// angle folded to pure laterality, so front/behind mirror-pairs share the
// same ITD (the pinna law is what tells them apart). Positive = source
// right of centre → the LEFT ear is far and receives the wave this much
// later.
export function itdSeconds(angleRad, earDistance = 0.175) {
  const lat = Math.asin(Math.max(-1, Math.min(1, Math.sin(foldAngle(angleRad)))));
  const r = Math.max(0.06, Math.min(0.125, (earDistance ?? 0.175) / 2));
  return Math.sign(lat) * r * (Math.abs(lat) + Math.sin(Math.abs(lat))) / 343;
}

// Brown-Duda head-shadow coefficient α for one ear. θ_inc is the angle
// between the source direction and that ear's axis: α runs from 2.0
// (source at the ear → +6 dB bright spot) through 1.05 (≈ unity, source
// ahead) down to 0.1 (-20 dB) at the deepest shadow, 150° off-axis —
// their published α_min = 0.1, θ_min = 150°.
export function headShadowAlpha(angleRad, ear /* "L" | "R" */) {
  const az = foldAngle(angleRad);
  // ear axes sit at ±90°: cos(angle from axis) = ±sin(azimuth)
  const cosInc = (ear === "R" ? 1 : -1) * Math.sin(az);
  const thetaInc = Math.acos(Math.max(-1, Math.min(1, cosInc))); // 0..π
  const ALPHA_MIN = 0.1, THETA_MIN = 150; // published fit constants
  return (1 + ALPHA_MIN / 2)
    + (1 - ALPHA_MIN / 2) * Math.cos((thetaInc * 180 / Math.PI) * (180 / THETA_MIN) * Math.PI / 180);
}

// The shadow's shelf gain in dB for one ear, headDensity-scaled around
// the published model (0.5 = exactly Brown-Duda).
export function headShadowDb(angleRad, ear, headDensity = 0.5) {
  const scale = Math.max(0, Math.min(1, headDensity ?? 0.5)) / 0.5;
  return 20 * Math.log10(Math.max(0.05, headShadowAlpha(angleRad, ear))) * scale;
}

// The shadow filter's corner: Brown-Duda ω0 = c/a → f0 = c/(2πa).
// Default ears (0.175 m span, a = 0.0875 m) → ≈ 624 Hz; wider heads
// shadow from lower frequencies, exactly as the physics says.
export function headShadowFreq(earDistance = 0.175) {
  const a = Math.max(0.06, Math.min(0.125, (earDistance ?? 0.175) / 2));
  return SPEED_OF_SOUND / (2 * Math.PI * a);
}

// Pinna front/behind cue, grounded in measured average HRTFs:
//  - conchaDb: loss of Shaw's ~4.3 kHz concha-resonance gain for rear
//    sources (front-back difference reaches ≈8 dB dead-behind);
//  - shelfDb: pinna-flange shadowing of the highs above ~8 kHz for rear
//    sources (≈7 dB dead-behind).
// Exactly zero anywhere in the front half-plane, scaling smoothly
// (smoothstep) from ±90° to 180°.
export function pinnaParams(angleRad, pinnaScale = 1) {
  const a = Math.abs(foldAngle(angleRad));
  const t = Math.max(0, Math.min(1, (a - Math.PI / 2) / (Math.PI / 2)));
  const behind = t * t * (3 - 2 * t); // smooth, like measured HRTF transitions
  const s = Math.max(0, Math.min(2, pinnaScale ?? 1)); // ear models scale the cue
  return {
    conchaHz: 4300,
    conchaDb: -8 * behind * s,
    shelfHz: 8000,
    shelfDb: -7 * behind * s,
  };
}

// Direct-path distance attenuation — the inverse model the HRTF panner
// used to provide (refDistance 1), now explicit.
export function spaceDistanceGain(distM) {
  return 1 / Math.max(1, Math.max(0.3, Math.min(30, distM ?? 2.5)));
}

// Body gain at one frequency: Gaussian bands in log-frequency space,
// summed in log2 gain. Pure so the renderer, low-register limiter and
// consuming assertions all evaluate the exact same fitted law.
export function bodyLogGainAt(bands, freqHz, amount = 1) {
  if (!amount || amount <= 0 || !bands || bands.length === 0) return 0;
  let logGain = 0;
  for (const band of bands) {
    const freq = Math.max(20, band.freq || 1000);
    const width = Math.max(0.08, band.width || 0.5);
    const octDist = Math.log2(Math.max(20, freqHz) / freq);
    logGain += (band.gain || 0) * Math.exp(-0.5 * (octDist / width) ** 2);
  }
  return logGain * amount;
}

export function bodyResponse(bands, freqHz, amount) {
  const logGain = bodyLogGainAt(bands, freqHz, amount);
  return Math.max(0.2, Math.min(4.5, Math.pow(2, logGain)));
}

function interpolatedPitchCentsAt(events, time) {
  if (!Array.isArray(events) || events.length === 0) return 0;
  if (time <= events[0].time) return Number(events[0].cents) || 0;
  for (let i = 1; i < events.length; i++) {
    const right = events[i];
    if (time > right.time) continue;
    const left = events[i - 1];
    const span = Math.max(1e-9, right.time - left.time);
    const mix = Math.max(0, Math.min(1, (time - left.time) / span));
    return (Number(left.cents) || 0) * (1 - mix) +
      (Number(right.cents) || 0) * mix;
  }
  return Number(events[events.length - 1].cents) || 0;
}

/** T-029: body gain follows the same instantaneous-frequency gestures as the
 * oscillator. The returned points are consumed directly as AudioParam
 * automation; static notes return no points, preserving the old graph exactly.
 * A 100 Hz minimum grid meets the per-audio-block contract while explicit
 * wander steps are retained at their exact times. */
export function bodyAmAutomationEvents(note, modeFrequency, t0, t1,
                                       modeMultiplier = 1, updateHz = 100) {
  const bands = note?.bodyBands;
  const amount = Number(note?.bodyAmount) || 0;
  if (!Array.isArray(bands) || bands.length === 0 || amount <= 0 || !(t1 > t0)) return [];

  const vibrato = Array.isArray(note?._vibratoEvents) ? note._vibratoEvents : [];
  const wander = Array.isArray(note?._wanderEvents) ? note._wanderEvents : [];
  const bowOnset = note?._bowOnsetWander || { cents: 0, settleSec: 0 };
  const scoopCents = Number(note?._scoopCents) || 0;
  const fittedSettle = Number(note?._scoopSettleSec) || 0;
  const attack = Math.min((Number(note?.duration) || .2) * .4,
    fittedSettle > 0 ? fittedSettle : Math.max(.015, Number(note?.envelopeAttack) || .02));
  const slide = Math.max(0, Math.min(Number(note?.slideDuration) || 0,
    (Number(note?.duration) || 0) * .8));
  const target = Math.max(1, Number(modeFrequency) || 1);
  const from = note?.legatoFromPrevious && Number(note?.slideFromFrequency) > 0
    ? Math.max(1, Number(note.slideFromFrequency) * modeMultiplier)
    : target;
  const hasFm = vibrato.length > 1 || wander.length > 0 ||
    Math.abs(Number(bowOnset.cents) || 0) > 1e-12 ||
    Math.abs(scoopCents) > 1e-12 ||
    (slide > .001 && Math.abs(from - target) > .01);
  if (!hasFm) return [];

  const wanderAt = (time) => {
    let cents = 0;
    for (const point of wander) {
      if (t0 + (Number(point.time) || 0) <= time) cents = Number(point.cents) || 0;
      else break;
    }
    return cents;
  };
  const baseAt = (time) => {
    if (slide > .001 && time < t0 + slide && Math.abs(from - target) > .01) {
      const progress = Math.max(0, Math.min(1, (time - t0) / slide));
      return from * Math.pow(target / from, progress);
    }
    return target;
  };
  const frequencyAt = (time) => {
    const scoop = scoopCents
      ? scoopCents * Math.max(0, 1 - (time - t0) / Math.max(.001, attack))
      : 0;
    const onset = Number(bowOnset.cents) || 0;
    const bow = onset
      ? onset * Math.max(0, 1 - (time - t0) /
        Math.max(.001, Number(bowOnset.settleSec) || 0))
      : 0;
    const cents = interpolatedPitchCentsAt(vibrato, time) + scoop + bow + wanderAt(time);
    return baseAt(time) * Math.pow(2, cents / 1200);
  };

  const rate = Math.max(100, Number(updateHz) || 100);
  const steps = Math.max(1, Math.ceil((t1 - t0) * rate));
  const times = new Set([t0, t1]);
  for (let i = 1; i < steps; i++) times.add(t0 + (t1 - t0) * i / steps);
  for (const point of wander) {
    const time = t0 + (Number(point.time) || 0);
    if (time > t0 && time < t1) times.add(time);
  }
  const nominal = bodyResponse(bands, target, amount);
  return [...times].sort((a, b) => a - b).map(time => ({
    time,
    frequency: frequencyAt(time),
    gain: bodyResponse(bands, frequencyAt(time), amount) / nominal,
  }));
}

// Width of the band that contributes most strongly at a partial frequency.
// T-032 publishes Gaussian sigma in log2 octaves and this exact FWHM law.
export function bodyFwhmHzAt(bands, freqHz) {
  if (!Array.isArray(bands) || bands.length === 0) return Infinity;
  let best = null, bestWeight = 0;
  for (const band of bands) {
    const centre = Math.max(20, Number(band?.freq) || 1000);
    const width = Math.max(0.08, Number(band?.width) || 0.5);
    const octDist = Math.log2(Math.max(20, freqHz) / centre);
    const weight = Math.abs(Number(band?.gain) || 0) *
      Math.exp(-0.5 * Math.pow(octDist / width, 2));
    if (weight > bestWeight) { bestWeight = weight; best = { centre, width }; }
  }
  if (!best || bestWeight <= 1e-12) return Infinity;
  return best.centre *
    (Math.pow(2, 1.1775 * best.width) - Math.pow(2, -1.1775 * best.width));
}

/** T-003 option (c): at the lowest measured register only, prevent a narrow
 * body ridge from turning one sparse partial into a second audible note.
 * The raw fitted body remains untouched outside that evidence boundary.
 * Within it, a >1-partial-spacing/FWHM ratio crossfades toward a +/-1 log2
 * (about 6 dB) cap relative to the three-partial local median. */
export function bodyResponsesForPartials(bands, frequencies, amount,
                                         fundamentalHz, lowestF0Hz = null) {
  const freqs = Array.isArray(frequencies) ? frequencies : [];
  const raw = freqs.map(freq => bodyLogGainAt(bands, freq, amount));
  const measuredFloor = Number(lowestF0Hz);
  const f0 = Math.max(1, Number(fundamentalHz) || 1);
  // lowestF0Hz is rounded analysis provenance; 1% admits that rounding but
  // prevents the low-register remedy from altering ordinary/high registers.
  const eligible = Number.isFinite(measuredFloor) && measuredFloor > 0 &&
    f0 <= measuredFloor * 1.01;
  if (!eligible || raw.length === 0) {
    return raw.map(logGain => Math.max(0.2, Math.min(4.5, Math.pow(2, logGain))));
  }
  const limited = raw.map((logGain, index) => {
    const local = raw.slice(Math.max(0, index - 1), Math.min(raw.length, index + 2))
      .slice().sort((a, b) => a - b);
    const median = local.length % 2
      ? local[(local.length - 1) / 2]
      : (local[local.length / 2 - 1] + local[local.length / 2]) / 2;
    const fwhmHz = bodyFwhmHzAt(bands, freqs[index]);
    const ratio = Number.isFinite(fwhmHz) && fwhmHz > 0 ? f0 / fwhmHz : 0;
    const mix = Math.max(0, Math.min(1, ratio - 1));
    const capped = median + Math.max(-1, Math.min(1, logGain - median));
    return logGain + (capped - logGain) * mix;
  });
  return limited.map(logGain => Math.max(0.2, Math.min(4.5, Math.pow(2, logGain))));
}

/** T-054: interpolate the immutable measured post-body bow-noise table in
 * log-frequency/dB space. Outside its evidence band the component is silent;
 * no extrapolated broadband floor is invented. */
export function bowNoiseProfileGainDbAt(rows, freqHz) {
  if (!Array.isArray(rows) || rows.length === 0) return -120;
  const points = rows.filter(row => Number.isFinite(row?.freqHz) && row.freqHz > 0 &&
      Number.isFinite(row?.gainDb)).slice().sort((a, b) => a.freqHz - b.freqHz);
  const frequency = Number(freqHz);
  if (!points.length || !Number.isFinite(frequency) ||
      frequency < points[0].freqHz || frequency > points[points.length - 1].freqHz) return -120;
  if (frequency === points[0].freqHz) return points[0].gainDb;
  let hi = 1;
  while (hi < points.length && points[hi].freqHz < frequency) hi++;
  if (hi >= points.length) return points[points.length - 1].gainDb;
  const lo = points[hi - 1], upper = points[hi];
  const t = (Math.log(frequency) - Math.log(lo.freqHz)) /
    (Math.log(upper.freqHz) - Math.log(lo.freqHz));
  return lo.gainDb + (upper.gainDb - lo.gainDb) * t;
}

/** Magnitude of the exact peaking-biquad law used to body-route excitation
 * noise. This lets the pinned post-body target be deconvolved against the
 * same filter implementation the WebAudio graph consumes. */
export function peakingBiquadMagnitudeDb(freqHz, centreHz, q, gainDb,
                                         sampleRate = 48000) {
  const sr = Math.max(8000, Number(sampleRate) || 48000);
  const frequency = Math.max(1, Math.min(sr * .499, Number(freqHz) || 1));
  const centre = Math.max(20, Math.min(sr * .49, Number(centreHz) || 1000));
  const quality = Math.max(.3, Math.min(12, Number(q) || 1));
  const gain = Math.max(-24, Math.min(24, Number(gainDb) || 0));
  if (Math.abs(gain) <= 1e-12) return 0;
  const A = Math.pow(10, gain / 40);
  const w0 = 2 * Math.PI * centre / sr;
  const alpha = Math.sin(w0) / (2 * quality);
  const a0 = 1 + alpha / A;
  const b0 = (1 + alpha * A) / a0;
  const b1 = (-2 * Math.cos(w0)) / a0;
  const b2 = (1 - alpha * A) / a0;
  const a1 = (-2 * Math.cos(w0)) / a0;
  const a2 = (1 - alpha / A) / a0;
  const w = 2 * Math.PI * frequency / sr;
  const c1 = Math.cos(w), s1 = Math.sin(w);
  const c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2;
  const ni = -b1 * s1 - b2 * s2;
  const dr = 1 + a1 * c1 + a2 * c2;
  const di = -a1 * s1 - a2 * s2;
  const magnitude = Math.sqrt((nr * nr + ni * ni) /
    Math.max(1e-24, dr * dr + di * di));
  return 20 * Math.log10(Math.max(1e-12, magnitude));
}

export function bowNoiseBodyFilterDbAt(bands, freqHz, sampleRate = 48000,
                                       amount = 1) {
  if (!Array.isArray(bands) || amount <= 0) return 0;
  let total = 0;
  for (const band of bands) {
    if (!Number.isFinite(band?.freq) || !Number.isFinite(band?.gain)) continue;
    const q = Math.max(.3, Math.min(12, 1 / Math.max(.08, band.width || .3)));
    total += peakingBiquadMagnitudeDb(freqHz, band.freq, q,
      band.gain * 6 * amount, sampleRate);
  }
  return total;
}

/** The pinned table is already body-coloured. Deconvolve the measured body
 * once here; the audio graph then routes the excitation through that body at
 * unity, reconstructing the measurement rather than applying colour twice. */
export function bowNoisePreBodyGainDbAt(rows, measuredBodyBands, freqHz,
                                        sampleRate = 48000) {
  return bowNoiseProfileGainDbAt(rows, freqHz) -
    bowNoiseBodyFilterDbAt(measuredBodyBands, freqHz, sampleRate, 1);
}

export function bowNoiseVelocityGain(velocity, exponent = 1) {
  const v = Math.max(.01, Math.min(1, Number(velocity) || 0));
  const e = Math.max(0, Math.min(2, Number.isFinite(exponent) ? exponent : 1));
  // The shared note envelope already contributes one power of velocity.
  // Compensate it so the complete path follows the fitted v**e law exactly.
  return Math.pow(v, e - 1);
}

/** Radix-2 inverse FFT used once per context/profile to turn the measured
 * pre-body magnitude response into a deterministic FIR. */
function inverseFftInPlace(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = 2 * Math.PI / len;
    const wLenR = Math.cos(angle), wLenI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const k = i + j + len / 2;
        const vR = real[k] * wr - imag[k] * wi;
        const vI = real[k] * wi + imag[k] * wr;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[k] = uR - vR; imag[k] = uI - vI;
        const nextR = wr * wLenR - wi * wLenI;
        wi = wr * wLenI + wi * wLenR; wr = nextR;
      }
    }
  }
  for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
}

export function buildBowNoiseImpulse(rows, measuredBodyBands, sampleRate = 48000,
                                     length = 2048) {
  const n = Math.max(256, 1 << Math.round(Math.log2(Math.max(256, length))));
  const real = new Float64Array(n), imag = new Float64Array(n);
  for (let k = 1; k < n / 2; k++) {
    const frequency = k * sampleRate / n;
    const gainDb = bowNoisePreBodyGainDbAt(rows, measuredBodyBands,
      frequency, sampleRate);
    const magnitude = Math.pow(10, Math.max(-120, Math.min(30, gainDb)) / 20);
    // Start from zero phase, then centre and window the impulse below. The
    // source is stationary sustain noise, so the resulting short group delay
    // carries no pitched-onset timing information.
    real[k] = magnitude;
    real[n - k] = magnitude;
  }
  inverseFftInPlace(real, imag);
  const causal = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const shifted = real[(i + n / 2) % n];
    const window = .5 - .5 * Math.cos(2 * Math.PI * i / (n - 1));
    causal[i] = shifted * window;
    energy += causal[i] * causal[i];
  }
  const norm = Math.sqrt(Math.max(1e-18, energy));
  return Float32Array.from(causal, value => value / norm);
}

// ── Per-instrument performance character ─────────────────────
//
// A static spectrum alone never reads as "violin" — the temporal envelope,
// vibrato idiom, and onset transient carry most of the identity. These
// defaults are applied when an instrument profile is selected (they remain
// ordinary user-editable parameters afterwards). Values follow standard
// instrumental acoustics:
//  - winds speak in 20-60ms, strings in 60-120ms (bow acceleration), brass
//    ~25-40ms with a hard lip transient, piano is percussive (<5ms, decaying)
//  - vibrato: strings wide (~±15-25 cents) at 5-6.5Hz; flute moderate;
//    clarinet traditionally near-none; brass light
//  - onsets carry noise: flute breath chiff (broadband, bright), bow noise
//    (mid-high scratch), brass lip buzz (low), piano hammer thump
const SPECTRAL_PERFORMANCE = {
  flute: {
    envelopeAttack: 0.055, envelopeAttackSd: 0.015, envelopeDecay: 0.05,
    envelopeSustain: 0.78, envelopeRelease: 0.14,
    vibratoProb: 0.75, vibratoRate: 5.2, vibratoRateSd: 0.3, vibratoDepth: 10, vibratoDepthSd: 3,
    attackNoise: { level: 0.4, freq: 2800, q: 0.8, decay: 0.07 },
    partialMaterial: 0.35,
    excitation: { type: "blow", position: 0.24, hardness: 0.6, human: 0.5 },
    partialTransfer: 0.08,
    spectralDynamicAmount: 0.7,
  },
  clarinet: {
    envelopeAttack: 0.032, envelopeAttackSd: 0.008, envelopeDecay: 0.04,
    envelopeSustain: 0.82, envelopeRelease: 0.1,
    vibratoProb: 0.1, vibratoRate: 5.0, vibratoRateSd: 0.2, vibratoDepth: 4, vibratoDepthSd: 1.5,
    attackNoise: { level: 0.12, freq: 1800, q: 1.2, decay: 0.04 },
    partialMaterial: 0.4,
    excitation: { type: "blow", position: 0.15, hardness: 0.6, human: 0.35 },
    partialTransfer: 0.08,
    spectralDynamicAmount: 0.75,
  },
  violin: {
    envelopeAttack: 0.085, envelopeAttackSd: 0.025, envelopeDecay: 0.07,
    envelopeSustain: 0.74, envelopeRelease: 0.22,
    vibratoProb: 0.85, vibratoRate: 5.9, vibratoRateSd: 0.4, vibratoDepth: 16, vibratoDepthSd: 4,
    attackNoise: { level: 0.3, freq: 3400, q: 1.0, decay: 0.09 },
    partialMaterial: 0.5,
    excitation: { type: "bow", position: 0.13, hardness: 0.6, human: 0.4 },
    partialTransfer: 0.15,
    spectralDynamicAmount: 0.85,
  },
  cello: {
    envelopeAttack: 0.105, envelopeAttackSd: 0.03, envelopeDecay: 0.08,
    envelopeSustain: 0.74, envelopeRelease: 0.28,
    vibratoProb: 0.8, vibratoRate: 5.1, vibratoRateSd: 0.35, vibratoDepth: 14, vibratoDepthSd: 4,
    attackNoise: { level: 0.32, freq: 1500, q: 1.0, decay: 0.11 },
    partialMaterial: 0.5,
    excitation: { type: "bow", position: 0.11, hardness: 0.6, human: 0.4 },
    partialTransfer: 0.15,
    spectralDynamicAmount: 0.85,
  },
  trumpet: {
    envelopeAttack: 0.03, envelopeAttackSd: 0.008, envelopeDecay: 0.05,
    envelopeSustain: 0.85, envelopeRelease: 0.11,
    vibratoProb: 0.3, vibratoRate: 5.4, vibratoRateSd: 0.3, vibratoDepth: 7, vibratoDepthSd: 2.5,
    attackNoise: { level: 0.2, freq: 900, q: 1.4, decay: 0.045 },
    partialMaterial: 0.28,
    excitation: { type: "blow", position: 0.3, hardness: 0.6, human: 0.35 },
    partialTransfer: 0.1,
    spectralDynamicAmount: 1.25,
  },
  trombone: {
    envelopeAttack: 0.045, envelopeAttackSd: 0.012, envelopeDecay: 0.06,
    envelopeSustain: 0.84, envelopeRelease: 0.14,
    vibratoProb: 0.25, vibratoRate: 5.0, vibratoRateSd: 0.3, vibratoDepth: 7, vibratoDepthSd: 2.5,
    attackNoise: { level: 0.22, freq: 480, q: 1.3, decay: 0.06 },
    partialMaterial: 0.32,
    excitation: { type: "blow", position: 0.3, hardness: 0.6, human: 0.35 },
    partialTransfer: 0.1,
    spectralDynamicAmount: 1.2,
  },
  piano: {
    // Percussive: instant hammer onset, no sustain plateau (decay carries the
    // note), no vibrato. Long-decay realism is bounded by the ADSR model.
    envelopeAttack: 0.004, envelopeAttackSd: 0.001, envelopeDecay: 0.35,
    envelopeSustain: 0.28, envelopeRelease: 0.3,
    vibratoProb: 0, vibratoRate: 5, vibratoRateSd: 0, vibratoDepth: 0, vibratoDepthSd: 0,
    attackNoise: { level: 0.26, freq: 350, q: 0.7, decay: 0.02 },
    partialMaterial: 0.7,
    excitation: { type: "strike", position: 0.12, hardness: 0.62, human: 0.1 },
    partialTransfer: 0.3,
    spectralDynamicAmount: 1.0,
    partialB: 1.2e-4, // native stiff-string inharmonicity (was legacy 8-cent stretch)
  },
  vocal: {
    envelopeAttack: 0.06, envelopeAttackSd: 0.02, envelopeDecay: 0.06,
    envelopeSustain: 0.78, envelopeRelease: 0.18,
    vibratoProb: 0.85, vibratoRate: 5.5, vibratoRateSd: 0.5, vibratoDepth: 18, vibratoDepthSd: 6,
    attackNoise: { level: 0.14, freq: 2200, q: 0.9, decay: 0.05 },
    partialMaterial: 0.42,
    excitation: { type: "bow", position: 0.35, hardness: 0.6, human: 0.5 },
    partialTransfer: 0.2,
    spectralDynamicAmount: 0.8,
  },
};

for (const [key, seed] of Object.entries({
  "alto-sax": "clarinet", "french-horn": "trombone", guitar: "piano",
  "piano-upright": "piano",
  "voice-tenor": "vocal", "voice-bass": "vocal", "voice-mezzo": "vocal",
})) {
  SPECTRAL_PERFORMANCE[key] = {
    ...SPECTRAL_PERFORMANCE[seed],
    attackNoise: { ...SPECTRAL_PERFORMANCE[seed].attackNoise },
    excitation: { ...SPECTRAL_PERFORMANCE[seed].excitation },
  };
}

for (const [profileKey, performance] of Object.entries(SPECTRAL_PERFORMANCE)) {
  if (SPECTRAL_PROFILES[profileKey]) SPECTRAL_PROFILES[profileKey].performance = performance;
}

// ── CH-B3: fold measured instrument fits into the presets ──
// scripts/fit_profiles_from_samples.py measured real recordings (U. Iowa
// anechoic + Philharmonia; docs/MEASURED_PROFILES.md). Curation rules:
//  - partials: measured 64 amps/spreads REPLACE the hand-tuned 20; the
//    hand dyn curve (velocity swell per partial) is kept and extended
//    linearly — the samples were single-dynamic (mf), so they can't say
//    how partials swell.
//  - material & partialB: measured (the fit inverts the engine's own T60
//    law, so ring times land on the recordings; real piano B is ~3x the
//    old default).
//  - attackNoise: measured transient fits (freq/Q/level/decay).
//  - vibrato rate/SDs: measured; depth: blended 50/50 with hand values —
//    the vibrato sources are molto-vibrato takes, an upper bound on the
//    default. vibratoProb and the envelope stay hand-tuned: sample
//    players bloom slowly into long held notes, which measures recording
//    style, not the instrument's speaking speed.
for (const [profileKey, m] of Object.entries(MEASURED_PROFILES)) {
  const prof = SPECTRAL_PROFILES[profileKey];
  if (!prof || !Array.isArray(m.partials) || !m.partials.length) continue;
  const hand = prof.partials;
  const last = hand.length - 1;
  const dynSlope = last > 0 ? ((hand[last].dyn ?? 0) - (hand[0].dyn ?? 0)) / last : 0;
  prof.partials = m.partials.map((mp, i) => ({
    amp: mp.amp,
    spread: mp.spread,
    dyn: hand[i]?.dyn ?? +((hand[last]?.dyn ?? 0) + dynSlope * (i - last)).toFixed(2),
    ...(hand[i]?.reg !== undefined ? { reg: hand[i].reg } : {}),
  }));
  if (Array.isArray(m.partialsByRegister) && m.partialsByRegister.length) {
    prof.partialsByRegister = m.partialsByRegister;
  }
  if (Array.isArray(m.attackByRegister) && m.attackByRegister.length) {
    prof.attackByRegister = m.attackByRegister;
  }
  if (m.bowNoise?.profilePinned === true && Array.isArray(m.bowNoise.profile)) {
    prof.bowNoise = m.bowNoise;
  }
  // The fitted body (including an explicit empty omission) was resolved
  // before BODY_PRESETS construction above. Never re-merge it here: a
  // length-gated late overwrite is exactly how empty flute data previously
  // resurrected the legacy kazoo-like body (T-035/L7).
  const perf = prof.performance || (prof.performance = {});
  if (Number.isFinite(m.material)) perf.partialMaterial = m.material;
  if (Number.isFinite(m.partialB)) perf.partialB = m.partialB;
  if (m.attackNoise && Number.isFinite(m.attackNoise.level)) {
    perf.attackNoise = { level: m.attackNoise.level, freq: m.attackNoise.freq, q: m.attackNoise.q, decay: m.attackNoise.decay };
  }
  const mp = m.performance || {};
  for (const key of ["vibratoRate", "vibratoRateSd", "vibratoDepthSd",
    "lowToHighStaggerMs", "microDriftCentsSd", "microDriftCentsRange",
    "microDriftCentsPerSecond"]) {
    if (Number.isFinite(mp[key])) perf[key] = mp[key];
  }
  if (Number.isFinite(mp.vibratoDepth) && Number.isFinite(perf.vibratoDepth)) {
    perf.vibratoDepth = +((perf.vibratoDepth + mp.vibratoDepth) / 2).toFixed(1);
  }
  prof.measured = {
    source: m.source || "",
    notesAnalysed: m.notesAnalysed || 0,
    vowelFormants: m.vowelFormants || null,
  };
}

// ── Tone model v2: resonator core (docs/TONE_MODEL_V2_DESIGN.md §3.2) ──
//
// The resonator's mode frequencies come from a physical ratio table bent by
// true stiff-string inharmonicity; its decay comes from a material damping
// law expressed in real Hz. These are pure functions so the acceptance-bar
// assertions (T-B2, T-B3) can verify them headlessly.

export const RESONATOR_CLASSES = {
  string:     { label: "String",              ratio: (n) => n },
  openTube:   { label: "Open cylindrical tube", ratio: (n) => n },
  conicalTube:{ label: "Conical tube",       ratio: (n) => n },
  closedTube: { label: "Closed tube",        ratio: (n) => 2 * n - 1 },
  // First transverse modes of an ideal membrane (Bessel zeros, ratios to
  // the fundamental) and of a free bar; tails extend geometrically.
  membrane:   { label: "Membrane", table: [1, 1.594, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501, 3.600, 3.652, 4.060, 4.154] },
  bar:        { label: "Bar / plate", table: [1, 2.756, 5.404, 8.933, 13.344, 18.638] },
};

export function resonatorRatio(className, n) {
  const cls = RESONATOR_CLASSES[className] || RESONATOR_CLASSES.string;
  if (cls.ratio) return cls.ratio(n);
  const t = cls.table;
  if (n <= t.length) return t[n - 1];
  const step = t[t.length - 1] / t[t.length - 2];
  return t[t.length - 1] * Math.pow(step, n - t.length);
}

/**
 * Ratio of a radiated output partial, as distinct from a passive bore mode.
 *
 * A closed cylindrical pipe has passive resonances near 1:3:5…, but a
 * clarinet's nonlinear reed drives a harmonic output spectrum that includes
 * even partials (especially above the register break).  Measured amplitude
 * tables carry that register-dependent odd/even balance, so their indices
 * must remain integer output harmonics rather than being remapped onto the
 * passive resonance sequence.
 */
export function outputPartialRatio(className, n) {
  return className === "closedTube" ? n : resonatorRatio(className, n);
}

// True stiff-string inharmonicity, anchored so mode 1 stays at the played
// pitch: f_n = ratio_n · f0 · sqrt((1 + B·n²) / (1 + B)). B is a physical
// constant (piano bass ≈ 1e-4, treble ≈ 1e-3) and gives the same
// frequencies regardless of how many partials are rendered (audit A4).
export function partialFrequency(n, f0, B = 0, className = "string") {
  const b = Math.max(0, B || 0);
  return outputPartialRatio(className, n) * f0 * Math.sqrt((1 + b * n * n) / (1 + b));
}

/** Interpolate measured amplitude/B tables in log-frequency register space. */
export function registerProfileAt(profile, fundamentalHz) {
  const entries = Array.isArray(profile?.partialsByRegister)
    ? profile.partialsByRegister.filter(row => Number.isFinite(row?.f0) && Array.isArray(row?.partials)).slice().sort((a, b) => a.f0 - b.f0)
    : [];
  if (!entries.length) return { partials: profile?.partials || [], partialB: null };
  const hz = Math.max(1, Number(fundamentalHz) || entries[0].f0);
  let hi = entries.findIndex(row => row.f0 >= hz);
  if (hi < 0) {
    const last = entries[entries.length - 1];
    return { partials: last.partials, partialB: last.partialB ?? profile?.performance?.partialB ?? null };
  }
  if (hi === 0) return { partials: entries[0].partials, partialB: entries[0].partialB ?? profile?.performance?.partialB ?? null };
  const a = entries[hi - 1], b = entries[hi];
  const t = Math.max(0, Math.min(1, Math.log(hz / a.f0) / Math.log(b.f0 / a.f0)));
  const count = Math.max(a.partials.length, b.partials.length);
  const partials = Array.from({ length: count }, (_, i) => {
    const pa = a.partials[i] || { amp: 0, spread: 0.5 };
    const pb = b.partials[i] || { amp: 0, spread: 0.5 };
    return {
      amp: (pa.amp || 0) + ((pb.amp || 0) - (pa.amp || 0)) * t,
      spread: (pa.spread ?? 0.5) + ((pb.spread ?? 0.5) - (pa.spread ?? 0.5)) * t,
    };
  });
  const ba = Number.isFinite(a.partialB) ? a.partialB : (profile?.performance?.partialB ?? 0);
  const bb = Number.isFinite(b.partialB) ? b.partialB : (profile?.performance?.partialB ?? 0);
  return { partials, partialB: ba + (bb - ba) * t };
}

// Legacy conversion: the old spectralStretchCents pinned a quadratic cents
// ramp to the top of a 32-partial table. Map it to the B whose detune at
// n=32 matches (negative "compression" has no stiff-string analogue → 0).
export function legacyStretchToB(cents) {
  const c = Math.max(0, Math.min(24, cents || 0));
  if (c === 0) return 0;
  const k = Math.pow(2, c / 600); // target (1+1024B)/(1+B)
  return (k - 1) / (1024 - k);
}

// Material as a true-Hz damping law (audits A2/A3): T60 is a property of
// the instrument, not of note duration or harmonic rank. material 0 =
// glass/metal (long ring, shallow slope), 1 = felt/skin (short, steep).
// Log-interpolated anchors, referenced to middle C.
export function materialT60(freqHz, material) {
  const m = Math.max(0, Math.min(1, material ?? 0));
  const t60Ref = Math.exp((1 - m) * Math.log(7.0) + m * Math.log(0.55));
  const slope = 0.25 + m * 1.1;
  return t60Ref * Math.pow(Math.max(30, freqHz) / 261.63, -slope);
}

// ── Tone model v2: excitation stage (T2, docs/TONE_MODEL_V2_DESIGN.md §3.1) ──
//
// How energy enters the resonator. Pure functions again so T-B1 can be
// asserted headlessly. The drive spectra are the standard physical initial
// conditions: bow = sustained Helmholtz motion ≈ 1/n; pluck = displacement
// release ≈ 1/n²; strike = force impulse, near-flat until the hardness
// corner; blow = air-jet drive ≈ 1/n^1.15 (its continuous breath-noise
// floor arrives with the T3 Human stage).
export function excitationDrive(type, n) {
  switch (type) {
    case "pluck":  return 1 / (n * n);
    case "strike": return Math.pow(n, -0.3);
    case "blow":   return Math.pow(n, -1.15);
    case "bow":
    default:       return 1 / n;
  }
}

// Excitation position x ∈ (0, 0.5]: driving a string (or analogous mode
// shape) at x weights mode n by |sin(nπx)| — at 1/2 every even mode sits on
// a node and dies, at 1/3 every third does. This is the physical control
// that absorbs the old odd/even and comb macros.
export function positionComb(n, position) {
  const x = Math.min(0.5, Math.max(0.02, position ?? 0.5));
  return Math.abs(Math.sin(n * Math.PI * x));
}

// Contact-time rolloff for struck/plucked excitation: a soft hammer stays
// in contact longer and cannot inject energy above ~1/(2τ). Corner sweeps
// ~600 Hz (felt, hardness 0) → ~14 kHz (wood/metal, hardness 1); 12 dB/oct
// above it. Sustained excitations pass through unshaped.
export function hardnessRolloff(freqHz, hardness, type) {
  if (type !== "strike" && type !== "pluck") return 1;
  const h = Math.min(1, Math.max(0, hardness ?? 0.6));
  const corner = 600 * Math.pow(14000 / 600, h);
  const r = Math.max(1, (freqHz || 1) / corner);
  return 1 / (r * r);
}

/** Only an impulse-driven resonator freely decays while its note is held. */
export function usesFreeDecay(excitationType) {
  return excitationType === "strike" || excitationType === "pluck";
}

/** Per-preset renderer cull; the first eight construction modes are sacred. */
export function partialIsAudible(amp, norm, harmonic, threshold = 0.0005) {
  return harmonic <= 8 || Math.max(0, amp) / Math.max(0.001, norm) >= threshold;
}

export function excitationSpectrum(type, n, { position = 0.5, hardness = 0.6, freqHz = n * 261.63 } = {}) {
  return excitationDrive(type, n) * positionComb(n, position) * hardnessRolloff(freqHz, hardness, type);
}

// Louder = brighter (audit A14): one global law replaces the per-partial
// dyn grids. The velocity exponent grows with mode number so upper partials
// bloom under force the way strings and air columns actually do (Schelleng
// bow-force behaviour); spectralDynamicAmount scales the whole law.
export function dynamicBrightness(n, blare = 0, velocityRatio = 1) {
  const base = 0.5 * Math.log2(1 + Math.max(1, n));
  const forte = Math.max(0, (Number(velocityRatio) || 1) - 1);
  return base * (1 + Math.max(0, Number(blare) || 0) * forte * forte * 2.5);
}

/** Glottal closed-quotient/source tilt. Zero is exactly neutral. */
export function glottalSourceGain(n, tilt = 0) {
  return Math.pow(Math.max(1, n), -Math.max(-1, Math.min(1, Number(tilt) || 0)));
}

/** Velocity raises contact hardness only when a preset opts in. */
export function velocityHardness(baseHardness, velocity, coupling = 0) {
  const h = Number(baseHardness) || 0;
  const c = Math.max(0, Math.min(1, Number(coupling) || 0));
  return Math.max(0, Math.min(1, h + c * ((Number(velocity) || 0.62) - 0.62) * 0.75));
}

/** Early/late T60 plan for piano/guitar double decay; amount 0 is legacy. */
export function twoStageDecayPlan(freqHz, material, amount = 0, lateRatio = 1) {
  const earlyT60 = materialT60(freqHz, material);
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  const ratio = Math.max(1, Math.min(8, Number(lateRatio) || 1));
  return { earlyT60, lateT60: earlyT60 * (1 + a * (ratio - 1)), breakpointDb: -18 };
}

/** T-021: two close orthogonal modes for string polarisation/unison beating.
 * Amount 0 is an exact one-mode identity. Squared gains sum to A^2, so the
 * split preserves modal energy; fitted values only decide how much occupies
 * the second mode, its frequency separation, and its independent decay. */
export function polarisationModePlan(amplitude, amount = 0, splitCents = 0,
                                     decayRatio = 1) {
  const amp = Math.max(0, Number(amplitude) || 0);
  const a = Math.max(0, Math.min(1, Number(amount) || 0));
  const w = 0.5 * a;
  const split = Math.max(0, Math.min(6, Number(splitCents) || 0));
  const decay = Math.max(0.25, Math.min(4, Number(decayRatio) || 1));
  return {
    primaryGain: amp * Math.sqrt(1 - w),
    secondaryGain: amp * Math.sqrt(w),
    frequencyRatio: Math.pow(2, split / 1200),
    secondaryDecayRatio: decay,
  };
}

export function polarisationBeatHz(freqHz, splitCents = 0) {
  const f = Math.max(0, Number(freqHz) || 0);
  const split = Math.max(0, Math.min(6, Number(splitCents) || 0));
  return f * (Math.pow(2, split / 1200) - 1);
}

/** Blend between legacy ADSR-bound and independently enveloped onset noise. */
export function attackNoiseRouting(amount = 0) {
  const directGain = Math.max(0, Math.min(1, Number(amount) || 0));
  return { envelopeGain: 1 - directGain, directGain };
}

/** Velocity law for the independently measured onset transient. */
export function attackNoiseVelocityGain(velocity, exponent = 1) {
  const v = Math.max(0, Math.min(1, Number(velocity) || 0));
  const e = Math.max(0, Math.min(2, Number.isFinite(exponent) ? exponent : 1));
  return Math.pow(v, e);
}

/** Interpolate measured onset shape anchors continuously in log-f0 space. */
export function registerAttackNoiseAt(anchors, fundamentalHz) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  const rows = anchors.filter(row => row && Number.isFinite(row.f0) && row.f0 > 0)
    .slice().sort((a, b) => a.f0 - b.f0);
  if (!rows.length) return null;
  const f0 = Math.max(1, Number(fundamentalHz) || rows[0].f0);
  if (rows.length === 1 || f0 <= rows[0].f0) return { ...rows[0] };
  if (f0 >= rows[rows.length - 1].f0) return { ...rows[rows.length - 1] };
  let hi = 1;
  while (hi < rows.length && rows[hi].f0 < f0) hi++;
  const lo = rows[hi - 1], upper = rows[hi];
  const t = (Math.log(f0) - Math.log(lo.f0)) / (Math.log(upper.f0) - Math.log(lo.f0));
  const result = { f0 };
  for (const key of ["levelScale", "freq", "q", "decay"]) {
    const a = lo[key], b = upper[key];
    if (Number.isFinite(a) && Number.isFinite(b)) result[key] = a + (b - a) * t;
    else if (Number.isFinite(a)) result[key] = a;
    else if (Number.isFinite(b)) result[key] = b;
  }
  return result;
}

/** Interpolate the measured low-to-high partial onset spread by register. */
export function registerAttackStaggerAt(anchors, fundamentalHz) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  const rows = anchors.filter(row => row && Number.isFinite(row.f0) && row.f0 > 0 &&
      Number.isFinite(row.lowToHighStaggerMs)).slice().sort((a, b) => a.f0 - b.f0);
  if (!rows.length) return null;
  const f0 = Math.max(1, Number(fundamentalHz) || rows[0].f0);
  if (rows.length === 1 || f0 <= rows[0].f0) return rows[0].lowToHighStaggerMs;
  if (f0 >= rows[rows.length - 1].f0) return rows[rows.length - 1].lowToHighStaggerMs;
  let hi = 1;
  while (hi < rows.length && rows[hi].f0 < f0) hi++;
  const lo = rows[hi - 1], upper = rows[hi];
  const t = (Math.log(f0) - Math.log(lo.f0)) / (Math.log(upper.f0) - Math.log(lo.f0));
  return lo.lowToHighStaggerMs + (upper.lowToHighStaggerMs - lo.lowToHighStaggerMs) * t;
}

/** Interpolate an explicitly fitted envelope-attack table by register. */
export function registerEnvelopeAttackAt(anchors, fundamentalHz) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  const rows = anchors.map(row => ({
    f0: row?.f0,
    attack: Number.isFinite(row?.attack) ? row.attack : row?.envelopeAttack,
  })).filter(row => Number.isFinite(row.f0) && row.f0 > 0 && Number.isFinite(row.attack))
    .sort((a, b) => a.f0 - b.f0);
  if (!rows.length) return null;
  const f0 = Math.max(1, Number(fundamentalHz) || rows[0].f0);
  if (rows.length === 1 || f0 <= rows[0].f0) return rows[0].attack;
  if (f0 >= rows[rows.length - 1].f0) return rows[rows.length - 1].attack;
  let hi = 1;
  while (hi < rows.length && rows[hi].f0 < f0) hi++;
  const lo = rows[hi - 1], upper = rows[hi];
  const t = (Math.log(f0) - Math.log(lo.f0)) / (Math.log(upper.f0) - Math.log(lo.f0));
  return lo.attack + (upper.attack - lo.attack) * t;
}

const PERFORMANCE_DYNAMIC_VELOCITY = Object.freeze({
  // Canonical tone-match render velocities (build_campaign.py / references).
  pp: .2, p: .25, mp: .42, mf: .62, f: .82, ff: .92,
  soft: .25, medium: .62, loud: .9,
});

function performanceRowFrequency(row) {
  if (Number.isFinite(row?.f0) && row.f0 > 0) return Number(row.f0);
  if (Number.isFinite(row?.midi)) return 440 * Math.pow(2, (Number(row.midi) - 69) / 12);
  return null;
}

function performanceRowVelocity(row) {
  if (Number.isFinite(row?.velocity)) return Math.max(0, Math.min(1, Number(row.velocity)));
  const key = String(row?.dynamic || "").toLowerCase();
  return PERFORMANCE_DYNAMIC_VELOCITY[key] ?? null;
}

function interpolatePerformanceRegister(rows, fundamentalHz, fields) {
  const points = rows.map(row => ({ ...row, _f0: performanceRowFrequency(row) }))
    .filter(row => row._f0 != null).sort((a, b) => a._f0 - b._f0);
  if (!points.length) return null;
  const f0 = Math.max(1, Number(fundamentalHz) || points[0]._f0);
  let lo = points[0], hi = points[points.length - 1], mix = 0;
  if (f0 <= lo._f0) hi = lo;
  else if (f0 >= hi._f0) lo = hi;
  else {
    let index = 1;
    while (index < points.length && points[index]._f0 < f0) index++;
    lo = points[index - 1]; hi = points[index];
    mix = (Math.log(f0) - Math.log(lo._f0)) /
      (Math.log(hi._f0) - Math.log(lo._f0));
  }
  const result = { f0 };
  for (const field of fields) {
    const a = Number(lo[field]), b = Number(hi[field]);
    if (Number.isFinite(a) && Number.isFinite(b)) result[field] = a + (b - a) * mix;
    else if (Number.isFinite(a)) result[field] = a;
    else if (Number.isFinite(b)) result[field] = b;
  }
  return result;
}

/** Shared bilinear resolver for pinned performance evidence: log-frequency
 * between register anchors, linear playing velocity between dynamic rows. */
export function registerDynamicPerformanceAt(anchors, fundamentalHz, velocity,
                                             fields = []) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  const groups = new Map();
  for (const row of anchors) {
    const v = performanceRowVelocity(row);
    if (v == null || performanceRowFrequency(row) == null) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(row);
  }
  const byDynamic = [...groups.entries()].map(([v, rows]) => ({
    velocity: v,
    value: interpolatePerformanceRegister(rows, fundamentalHz, fields),
  })).filter(row => row.value).sort((a, b) => a.velocity - b.velocity);
  if (!byDynamic.length) return null;
  const target = Math.max(0, Math.min(1, Number(velocity) || 0));
  let lo = byDynamic[0], hi = byDynamic[byDynamic.length - 1], mix = 0;
  if (target <= lo.velocity) hi = lo;
  else if (target >= hi.velocity) lo = hi;
  else {
    let index = 1;
    while (index < byDynamic.length && byDynamic[index].velocity < target) index++;
    lo = byDynamic[index - 1]; hi = byDynamic[index];
    mix = (target - lo.velocity) / (hi.velocity - lo.velocity);
  }
  const result = { f0: Math.max(1, Number(fundamentalHz) || 1), velocity: target };
  for (const field of fields) {
    const a = Number(lo.value[field]), b = Number(hi.value[field]);
    if (Number.isFinite(a) && Number.isFinite(b)) result[field] = a + (b - a) * mix;
    else if (Number.isFinite(a)) result[field] = a;
    else if (Number.isFinite(b)) result[field] = b;
  }
  return result;
}

export function vibratoByRegisterDynamicAt(anchors, fundamentalHz, velocity) {
  return registerDynamicPerformanceAt(
    anchors, fundamentalHz, velocity, ["prob", "rate", "depth"]);
}

export function envelopeAttackByRegisterDynamicAt(anchors, fundamentalHz, velocity) {
  return registerDynamicPerformanceAt(
    anchors, fundamentalHz, velocity, ["attack", "meanBandT90Ms", "onsetLockinPeriods"]);
}

/** T-048 tables store the measured band-T90 target. The browser ADSR reaches
 * that metric at about 0.59 of its long attack parameter. At the 60 ms high-pp
 * cell, 1.3 keeps the rendered T90 inside tolerance while giving the
 * three-frame harmonic-organisation estimator enough stable onset. This continuous
 * pinned calibration maps
 * the evidence-domain target onto the renderer without changing scalar paths. */
export function bowedEnvelopeAttackRenderSeconds(measuredAttackSeconds) {
  const attack = Math.max(.001, Number(measuredAttackSeconds) || .001);
  const mix = Math.max(0, Math.min(1, (attack - .06) / .1));
  return attack * (1.3 + .4 * mix);
}

/** Resolve a measured onset transient. Explicit pinned fields win; absent
 * fields preserve the profile exactly, so existing presets are unchanged. */
export function resolveAttackNoise(profileNoise, params = {}, fundamentalHz = null) {
  if (!profileNoise) return null;
  const levelScale = Math.max(0, Math.min(2,
    Number.isFinite(params.attackNoiseLevel) ? params.attackNoiseLevel : 1));
  const resolved = {
    ...profileNoise,
    freq: Number.isFinite(params.attackNoiseFreq) ? params.attackNoiseFreq : profileNoise.freq,
    q: Number.isFinite(params.attackNoiseQ) ? params.attackNoiseQ : profileNoise.q,
    decay: Number.isFinite(params.attackNoiseDecay) ? params.attackNoiseDecay : profileNoise.decay,
    level: profileNoise.level * levelScale,
  };
  const register = registerAttackNoiseAt(params.attackNoiseByRegister, fundamentalHz);
  if (!register) return resolved;
  if (Number.isFinite(register.freq)) resolved.freq = register.freq;
  if (Number.isFinite(register.q)) resolved.q = register.q;
  if (Number.isFinite(register.decay)) resolved.decay = register.decay;
  if (Number.isFinite(register.levelScale)) {
    resolved.level *= Math.max(0, register.levelScale);
  }
  return resolved;
}

/** Soft-playing air leakage law. Exponent 1 is the exact legacy scaling;
 * lower exponents retain proportionally more breath at pp. */
export function breathVelocityGain(velocity, exponent = 1) {
  const v = Math.max(0, Math.min(1, Number(velocity) || 0));
  const k = Math.max(0, Math.min(2, Number.isFinite(exponent) ? exponent : 1));
  return Math.pow(v, k);
}

/** Short-lived harmonic colour of an onset relative to its sustain print.
 * Zero tilt is an identity, as required for neutral engine landings. */
export function onsetSpectrumGain(harmonic, tilt = 0) {
  const n = Math.max(1, Number(harmonic) || 1);
  const amount = Math.max(-1, Math.min(1, Number(tilt) || 0));
  return Math.max(0.125, Math.min(8, Math.pow(n, amount * 0.75)));
}

// ── Tone model v2: the Human dial (T3, §3.1) ──
//
// One seeded fluctuation per note stands in for the player: bow pressure /
// breath support drifting slowly with faster grain on top, occasional bow
// slips or breath bursts. It modulates the WHOLE spectrum coherently —
// replacing the old independent per-partial Gaussian draws and Hold-drift
// (audit A1) — with upper partials moving proportionally more (Schelleng:
// force brightens). Struck/plucked notes get no mid-note trace: a hammer
// cannot wobble after contact (their humanity is per-note jitter instead).
export function humanFluctuationTrace(nextRandom, durationSec, type, human) {
  const h = Math.max(0, Math.min(1, human ?? 0));
  if (h <= 0 || type === "strike" || type === "pluck" || durationSec < 0.12) return [];
  const gauss = () => {
    const u1 = Math.max(1e-6, nextRandom()), u2 = Math.max(1e-6, nextRandom());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const rate = type === "blow" ? 7 : 10;
  const pts = [];
  let slow = 0, fast = 0;
  for (let t = 1 / rate; t < durationSec - 0.015; t += (1 / rate) * (0.8 + nextRandom() * 0.4)) {
    slow = slow * 0.86 + gauss() * 0.3;   // pressure/support drift (mean-reverting)
    fast = fast * 0.45 + gauss() * 0.5;   // grain / turbulence
    let f = slow * 0.75 + fast * 0.35;
    if (type === "bow" && nextRandom() < 0.05 * h) f -= 0.8 + nextRandom() * 0.6;  // slip
    if (type === "blow" && nextRandom() < 0.06 * h) f += 0.6 + nextRandom() * 0.5; // burst
    pts.push({ t, f: Math.max(-1, Math.min(1, f)) });
  }
  return pts;
}

// Schelleng shaping: how strongly mode n follows the shared fluctuation —
// everything moves together, the top proportionally more.
export function humanPartialShape(n) {
  return 0.35 + 0.65 * Math.log2(1 + Math.max(1, n)) / Math.log2(65);
}

// ── Tone model v2: resonant transfer (T4, §3.4) ──
//
// Sympathetic energy exchange between modes whose REALISED frequencies sit
// near small-integer ratios. Everything is computed from actual Hz — no
// 12-TET grid anywhere: a true 3:2 (702.0¢) couples harder than an
// equal-tempered fifth (700¢), and rising inharmonicity detunes partials
// out of resonance exactly as real sympathetic strings do.
const TRANSFER_RATIOS = [
  [2, 1], [3, 2], [4, 3], [5, 4], [5, 3], [6, 5], [7, 4], [8, 5], [3, 1], [4, 1],
];

// Coupling weight between two frequencies: Gaussian in cents distance from
// the nearest simple ratio, weighted by 1/(p·q) (Tenney height) so octaves
// couple hardest, then fifths, fourths, thirds…
export function transferCoupling(fA, fB, sigmaCents = 20) {
  if (!(fA > 0) || !(fB > 0)) return 0;
  const hi = Math.max(fA, fB), lo = Math.min(fA, fB);
  const ratio = hi / lo;
  if (ratio > 4.6) return 0; // beyond the simplest-ratio table
  let best = 0;
  for (const [p, q] of TRANSFER_RATIOS) {
    const cents = 1200 * Math.log2(ratio / (p / q));
    const w = Math.exp(-0.5 * (cents / sigmaCents) ** 2) / (p * q);
    if (w > best) best = w;
  }
  return best;
}

// Identify the nearest simple ratio between two frequencies (for the tone
// print's relationship lens): {p, q, cents error, coupling weight} or null.
export function nearestRatio(fA, fB) {
  if (!(fA > 0) || !(fB > 0)) return null;
  const hi = Math.max(fA, fB), lo = Math.min(fA, fB);
  const ratio = hi / lo;
  if (ratio > 4.6) return null;
  let best = null;
  for (const [p, q] of TRANSFER_RATIOS) {
    const cents = 1200 * Math.log2(ratio / (p / q));
    const weight = Math.exp(-0.5 * (cents / 20) ** 2) / (p * q);
    if (!best || weight > best.weight) best = { p, q, cents, weight };
  }
  return best;
}

// First-order exchange over one note: energy flows from stronger to weaker
// coupled partials (pairwise conserving, deterministic — no feedback loop).
// parts: [{ freq, amp }] → per-partial amplitude deltas that the renderer
// approaches over the sustain (the sympathetic bloom).
export function transferDeltas(parts, transfer, sigmaCents = 20) {
  const t = Math.max(0, Math.min(1, transfer || 0));
  const deltas = new Array(parts.length).fill(0);
  if (t <= 0) return deltas;
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const C = transferCoupling(parts[i].freq, parts[j].freq, sigmaCents);
      if (C < 0.01) continue;
      const flow = t * C * (parts[j].amp - parts[i].amp) * 0.35;
      deltas[i] += flow;
      deltas[j] -= flow;
    }
  }
  return deltas;
}

// ── Extend every profile's partial table to 64 harmonics ─────
// The hand-tuned tables specify the first 20; the tail is extrapolated by
// stride-2 geometric continuation so alternating odd/even patterns
// (clarinet) keep their parity structure while monotone spectra continue
// their decay. 64 partials is instrument-modeller parity (RipplerX-class);
// the renderer's Nyquist + audibility culling keeps the live oscillator
// count far lower.
const TARGET_PARTIALS = 64;
for (const profile of Object.values(SPECTRAL_PROFILES)) {
  const parts = profile.partials;
  while (parts.length < TARGET_PARTIALS) {
    const n = parts.length;
    const ref = parts[n - 2];  // same parity as the entry being added
    const ref2 = parts[n - 4] || ref;
    const ratio = ref2.amp > 0
      ? Math.max(0.2, Math.min(0.95, ref.amp / ref2.amp))
      : 0.6;
    parts.push({
      amp: +(ref.amp * ratio).toFixed(5),
      spread: Math.min(0.8, (ref.spread ?? 0.4) + 0.04),
      dyn: +((ref.dyn ?? 0) + Math.max(0, (ref.dyn ?? 0) - (ref2.dyn ?? 0))).toFixed(2),
      ...(ref.reg != null ? { reg: ref.reg } : {}),
    });
  }
}

// ─── 12-tone scale presets ──────────────────────────────────

export const SCALE_PRESETS = {
  chromatic:   { degrees: [0,1,2,3,4,5,6,7,8,9,10,11], label: "Chromatic" },
  major:       { degrees: [0,2,4,5,7,9,11],             label: "Major" },
  minor:       { degrees: [0,2,3,5,7,8,10],             label: "Natural minor" },
  pent_major:  { degrees: [0,2,4,7,9],                  label: "Pentatonic major" },
  pent_minor:  { degrees: [0,3,5,7,10],                 label: "Pentatonic minor" },
  blues:       { degrees: [0,3,5,6,7,10],               label: "Blues" },
  dorian:      { degrees: [0,2,3,5,7,9,10],             label: "Dorian" },
  mixolydian:  { degrees: [0,2,4,5,7,9,10],             label: "Mixolydian" },
  harm_minor:  { degrees: [0,2,3,5,7,8,11],             label: "Harmonic minor" },
  whole_tone:  { degrees: [0,2,4,6,8,10],               label: "Whole tone" },
};

const NOTE_NAMES_12 = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// ─── World tuning systems (owner 07-07, per the Leimma reference) ───
// Each preset is an EDO grid + per-degree cent OFFSETS from that grid, so
// the whole degree-space machinery (walks, markers, bakes) keeps working
// while the sounding pitch centres are the tradition's own. Offsets are
// from standard references: Pythagorean/just from exact ratio maths;
// maqamat on the 24-EDO theoretical grid (AEU); slendro/pelog as their
// customary equal-step approximations (real gamelans vary per instrument
// set — these are the documented averages).
export const CULTURAL_SCALES = {
  pythagorean: {
    label: "Pythagorean (3-limit)",
    edo: 12, degrees: [0, 2, 4, 5, 7, 9, 11], sub: [0, 4, 7], roots: [0],
    tuning: { 2: 4, 4: 8, 5: -2, 7: 2, 9: 6, 11: 10 }, // exact 3^n/2^m cents − 12ET
    description: "Major scale from pure fifths (3:2) — bright thirds, the tuning of medieval Europe and many modal traditions",
  },
  just: {
    label: "Just intonation (5-limit)",
    edo: 12, degrees: [0, 2, 4, 5, 7, 9, 11], sub: [0, 4, 7], roots: [0],
    tuning: { 2: 4, 4: -14, 5: -2, 7: 2, 9: -16, 11: -12 }, // exact 5-limit ratios − 12ET
    description: "Major scale from pure ratios (5:4 thirds, 3:2 fifths) — beatless chords at the cost of free modulation",
  },
  rast: {
    label: "Maqam Rast (Arabic)",
    edo: 24, degrees: [0, 4, 7, 10, 14, 18, 21], sub: [0, 7, 14], roots: [0],
    tuning: null, // the 24-EDO theoretical grid IS the notation standard
    description: "The mother maqam — its third and seventh sit a quarter-tone flat, between major and minor",
  },
  bayati: {
    label: "Maqam Bayati (Arabic)",
    edo: 24, degrees: [0, 3, 6, 10, 14, 17, 20], sub: [0, 6, 14], roots: [0],
    tuning: null,
    description: "The most sung maqam of the Levant — a three-quarter-tone second gives its plaintive colour",
  },
  hijaz: {
    label: "Maqam Hijaz (Arabic)",
    edo: 24, degrees: [0, 2, 8, 10, 14, 16, 20], sub: [0, 8, 14], roots: [0],
    tuning: null,
    description: "The augmented-second leap between its lowered second and raised third — the desert sound",
  },
  slendro: {
    label: "Slendro (Java)",
    edo: 5, degrees: [0, 1, 2, 3, 4], sub: [0, 2], roots: [0],
    tuning: null, // customary near-equal 240¢ steps; real gamelans detune per set
    description: "Five near-equal steps of ~240¢ — no fifths, no thirds, a different consonance entirely (each gamelan tunes its own)",
  },
  pelog: {
    label: "Pelog bem (Java)",
    edo: 9, degrees: [0, 1, 3, 5, 6], sub: [0, 3], roots: [0],
    tuning: null, // the documented 9-EDO-subset approximation
    description: "Five uneven steps from the seven-tone pelog — small seconds against wide thirds (9-EDO subset approximation)",
  },
};

// ─── MIDI mapping (Q10) ─────────────────────────────────────
// How a MIDI keyboard reaches an N-division scale. Three owner-specified
// choices multiply out: which physical keys participate (white-only or
// all), what they cover (every subdivision, every subdivision with
// out-of-scale keys muted, or in-scale degrees packed consecutively), and
// where the mapping repeats (each C, or immediately after the last
// degree). Degree 0 sits at middle C (60). Returns an absolute degree in
// scale space, or null for unmapped/muted keys. Pure — table-tested.
const _WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
export function midiMapDegree(noteNumber, scale, opts = {}) {
  if (!Number.isFinite(noteNumber) || !scale) return null;
  const keys = opts.keys === "all" ? "all" : "white";
  const coverage = opts.coverage === "muted" ? "muted" : (opts.coverage === "all" ? "all" : "packed");
  const anchor = opts.anchor === "consecutive" ? "consecutive" : "octave";
  // position of this key in the participating-key sequence, 0 at C4
  let kIdx;
  const kPerOct = keys === "white" ? 7 : 12;
  if (keys === "white") {
    const pc = ((noteNumber % 12) + 12) % 12;
    const wi = _WHITE_PCS.indexOf(pc);
    if (wi < 0) return null; // black keys don't participate
    kIdx = (Math.floor(noteNumber / 12) - 5) * 7 + wi;
  } else {
    kIdx = noteNumber - 60;
  }
  const div = scale.div;
  const inScale = [...new Set(scale.all.map(d => scale.norm(d)))].sort((a, b) => a - b);
  const oct = Math.floor(kIdx / kPerOct);
  const pos = ((kIdx % kPerOct) + kPerOct) % kPerOct;
  if (coverage === "packed") {
    const len = inScale.length;
    if (!len) return null;
    if (anchor === "consecutive") {
      const o = Math.floor(kIdx / len);
      return inScale[((kIdx % len) + len) % len] + o * div;
    }
    if (pos >= len) return null; // octave anchor: spare keys in the octave stay silent
    return inScale[pos] + oct * div;
  }
  // coverage "all"/"muted": participating keys walk the raw subdivisions
  let degree;
  if (anchor === "consecutive") {
    degree = kIdx;
  } else {
    if (pos >= div) return null; // more keys per octave than divisions
    degree = pos + oct * div;
  }
  if (coverage === "muted") {
    const pc = ((degree % div) + div) % div;
    if (!inScale.includes(pc)) return null;
  }
  return degree;
}

// ─── Musical typing (Q10b) ──────────────────────────────────
// The computer keyboard as a two-row piano, the layout every DAW ships
// (Ableton/Logic/FL "musical typing"): the home row plays white keys from
// A = C, the row above plays the black keys between them, and the map
// runs on up to the apostrophe for a span of an octave and a half.
// Physical key codes, not characters, so AZERTY/Dvorak users get the same
// piano shape. Returns a MIDI note number — the rest of the MIDI path
// (midiMapDegree, mapping preferences, recording) is unchanged, which is
// the point: typing IS a MIDI keyboard. octaveShift moves the whole map
// in octaves relative to A = middle C (60). Pure — table-tested.
const KBD_NOTE_CODES = Object.freeze({
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13,
  KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
});
export function kbdMidiNote(code, octaveShift = 0) {
  const semis = KBD_NOTE_CODES[code];
  if (semis === undefined || !Number.isFinite(octaveShift)) return null;
  const note = 60 + Math.round(octaveShift) * 12 + semis;
  return note >= 0 && note <= 127 ? note : null;
}
export function kbdIsNoteCode(code) {
  return Object.prototype.hasOwnProperty.call(KBD_NOTE_CODES, code);
}

// ─── Imperfections (Q8) ─────────────────────────────────────
// Four small physical truths of played notes, each a pure law asserted
// headlessly, each scaled by the Human dial so machine-precise settings
// stay machine-precise.

// 1 · Onset pitch scoop: f0 approaches from below over the attack —
// sustained excitation (bow/blow) hunts for pitch far more than a struck
// or plucked string, and only humans hunt at all.
// T-008 / owner L11: scoop-from-below is a blown embouchure gesture, not a
// neutral Human default for every excitation. Bowed onset pitch will opt into
// its separately fitted wander/settle model; struck/plucked starts stay exact
// unless their own family evidence supplies a mechanism.
const _SCOOP_BASE_CENTS = { blow: 45 };
export function onsetScoopCents(excitationType, human = 0) {
  const base = _SCOOP_BASE_CENTS[excitationType] ?? 0;
  return -base * Math.max(0, Math.min(1, human ?? 0));
}

/** Owner L5/L5b: one articulation-strength draw drives the correlated onset.
 * Coupling 0 is an exact identity so old presets retain their Q8 behaviour;
 * fitted presets opt into the measured distribution with explicit scoop
 * depth/settle values instead of the hand instrument-class table. */
export function articulationOnsetPlan(nextRandom, options = {}) {
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi,
    Number.isFinite(Number(value)) ? Number(value) : lo));
  const coupling = clamp(options.coupling ?? 0, 0, 1);
  const forceLatent = options.forceLatent === true;
  if (coupling <= 0 && !forceLatent) return {
    strength: 0.5, transientGain: 1, breathLeadGain: 1,
    scoopCents: 0, scoopSettleSec: 0,
  };
  const human = clamp(options.human ?? 0, 0, 1);
  const velocity = clamp(options.velocity ?? 0.62, 0, 1);
  const variation = clamp(options.variation ?? 0, 0, 1) * human;
  const draw = typeof nextRandom === "function" ? nextRandom() : 0.5;
  // Owner L9: forte trumpet onsets recruit firmer tongue/lip support. This
  // is a fitted within-instrument slope on the ONE articulation latent, not
  // an independent plosive multiplier. Zero is exactly neutral; positive
  // values bias forte toward stronger/cleaner articulation and pp toward
  // weaker/breath-led articulation before the Human-scaled draw is applied.
  const velocitySlope = clamp(options.strengthVelocitySlope ?? 0, -1.5, 1.5);
  const mean = clamp((options.strength ?? 0.5) + velocitySlope * (velocity - 0.62), 0, 1);
  const strength = clamp(mean + (draw * 2 - 1) * variation * 0.5, 0, 1);
  const transientGain = 1 + coupling * (strength - 0.5) * 1.5;
  const breathLeadGain = 1 + coupling * (0.5 - strength) * 1.5;
  if (options.legato) return {
    strength, transientGain, breathLeadGain, scoopCents: 0,
    scoopSettleSec: 0,
  };
  const phraseScale = options.phraseStart === false
    ? clamp(options.rearticulatedScale ?? 0.35, 0, 1)
    : 1;
  const referenceHz = Math.max(1, Number(options.referenceHz) || 261.63);
  const frequency = Math.max(1, Number(options.frequency) || referenceHz);
  const registerScale = Math.pow(referenceHz / frequency,
    clamp(options.registerSlope ?? 0, -1.5, 1.5));
  const velocityScale = Math.pow(Math.max(.05, velocity) / .62,
    clamp(options.velocitySlope ?? 0, -1.5, 1.5));
  const depth = clamp(options.depthCents ?? 0, 0, 180) * coupling * human *
    (1 - strength) * phraseScale * registerScale * velocityScale;
  const settle = clamp(options.settleSec ?? .06, .015, .35) *
    (0.6 + 0.8 * (1 - strength));
  return {
    strength, transientGain, breathLeadGain,
    scoopCents: -Math.min(180, depth),
    scoopSettleSec: depth >= 1 ? settle : 0,
  };
}

/** T-031: a bowed onset wanders to either side of nominal pitch while the
 * string locks into Helmholtz motion. This is deliberately not the blown
 * scoop: sign is seeded per note, duration is measured in f0 periods, and
 * Human 0 / non-bow / legato are exact identities. Articulation strength is
 * the shared latent sampled by articulationOnsetPlan; strong starts settle
 * cleanly while weak starts expose more of the fitted wander. */
export function bowOnsetWanderPlan(nextRandom, options = {}) {
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi,
    Number.isFinite(Number(value)) ? Number(value) : lo));
  if (options.excitationType !== "bow" || options.legato) {
    return { cents: 0, settleSec: 0, settlePeriods: 0 };
  }
  const human = clamp(options.human ?? 0, 0, 1);
  const depth = clamp(options.depthCents ?? 0, 0, 120);
  if (human <= 0 || depth <= 0) {
    return { cents: 0, settleSec: 0, settlePeriods: 0 };
  }
  const strength = clamp(options.articulationStrength ?? .5, 0, 1);
  const periods = clamp(options.settlePeriods ?? 12, 2, 30);
  const frequency = Math.max(1, Number(options.frequency) || 261.63);
  const draw = typeof nextRandom === "function" ? nextRandom() : .5;
  // C20/C21: prolonged-period starts may sit flat while multiple-slip
  // starts may flicker sharp. The sign is therefore a seeded class draw,
  // never a fixed approach from below.
  const sign = draw < .5 ? -1 : 1;
  const cents = sign * depth * human * (1 - strength);
  return {
    cents,
    settleSec: periods / frequency,
    settlePeriods: periods,
  };
}

/** T-031: reinterpret the measured bow attack residual as period-scaled
 * broadband scratch. The shared articulation latent controls its colour:
 * a weak/floated start is higher-centroid surface whistle, while a strong
 * accent is lower-centroid crackle. Disabled/non-bow calls return null so
 * the legacy attack-noise object and blown render remain untouched. */
export function bowScratchPlan(attackNoise, options = {}) {
  if (options.excitationType !== "bow" || !attackNoise) return null;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi,
    Number.isFinite(Number(value)) ? Number(value) : lo));
  const amount = clamp(options.level ?? 0, 0, 2);
  if (amount <= 0) return null;
  const strength = clamp(options.articulationStrength ?? .5, 0, 1);
  const periods = clamp(options.durationPeriods ?? 12, 2, 30);
  const frequency = Math.max(1, Number(options.frequency) || 261.63);
  const baseFreq = Math.max(80, Number(attackNoise.freq) || 1000);
  const colourOctaves = (.5 - strength) * 1.2;
  return {
    ...attackNoise,
    level: Math.max(0, Number(attackNoise.level) || 0) * amount,
    freq: baseFreq * Math.pow(2, colourOctaves),
    q: clamp(attackNoise.q ?? .84, .3, 1.2),
    decay: periods / frequency,
    durationPeriods: periods,
    enabled: true,
  };
}

// 2 · Attack stagger: low partials speak first for bow/blow. Measured
// lowToHighStaggerMs wins when a profile carries it; hand values apply
// until the sample fitter is re-run.
const _STAGGER_DEFAULT_MS = { bow: 38, blow: 45 };
export function partialOnsetDelay(harmonic, excitationType, staggerMs = null) {
  const ms = staggerMs ?? _STAGGER_DEFAULT_MS[excitationType];
  if (!ms) return 0; // strike/pluck: everything speaks at once
  return ((Math.max(1, harmonic) - 1) / 63) * Math.max(0, Math.min(120, ms)) / 1000;
}

// 3 · Release ring: after note-off the resonator keeps ringing at the
// material's own T60 instead of being cut by the envelope (capped for CPU).
export function releaseRingSeconds(material, freqHz, releaseDamping = 0) {
  const m = Math.max(0, Math.min(1, material ?? 0));
  if (m <= 0) return 0;
  const base = Math.min(1.8, materialT60(Math.max(60, freqHz || 261.63), m) * 0.5);
  const damping = Math.max(0, Math.min(1, Number(releaseDamping) || 0));
  return base * Math.exp(-4 * damping);
}

// 4 · f0 wander: a very slow seeded random walk (< ±4¢ at Human 1)
// during the sustain — nobody holds a pitch perfectly still.
export function f0WanderTrace(rand, durSec, human = 0) {
  const h = Math.max(0, Math.min(1, human ?? 0));
  if (h <= 0 || !(durSec > 0.5)) return [];
  const cap = 4 * h;
  const events = [];
  let c = 0;
  let guard = 0;
  for (let t = 0.25; t < durSec - 0.05 && guard++ < 200; t += 0.35) {
    c = Math.max(-cap, Math.min(cap, c + (rand() * 2 - 1) * cap * 0.5));
    events.push({ time: t, cents: c });
  }
  return events;
}

// ─── Global space designer (Q6) ─────────────────────────────
// A track's position over time is a list of anchors {beat, angle, dist,
// smooth 0..1}. Between anchors we interpolate linearly, eased toward
// smoothstep by the mean smoothness of the two anchors (smooth 0 = pure
// linear, exact hits at anchors). Pure, asserted headlessly.
export function trackSpaceAt(anchors, beat) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  const pts = anchors.filter(a => a && Number.isFinite(a.beat)).sort((a, b) => a.beat - b.beat);
  if (!pts.length) return null;
  const val = (a) => ({ angle: a.angle ?? 0, dist: a.dist ?? 2.5 });
  if (beat <= pts[0].beat) return val(pts[0]);
  if (beat >= pts[pts.length - 1].beat) return val(pts[pts.length - 1]);
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].beat <= beat) i++;
  const a0 = pts[i], a1 = pts[i + 1];
  const span = Math.max(1e-9, a1.beat - a0.beat);
  const t = Math.max(0, Math.min(1, (beat - a0.beat) / span));
  const s = Math.max(0, Math.min(1, ((a0.smooth ?? 0) + (a1.smooth ?? 0)) / 2));
  const te = s * (t * t * (3 - 2 * t)) + (1 - s) * t;
  const v0 = val(a0), v1 = val(a1);
  return {
    angle: v0.angle + (v1.angle - v0.angle) * te,
    dist: v0.dist + (v1.dist - v0.dist) * te,
  };
}

// ─── Global scale strip (Q5) ────────────────────────────────
// The arrangement can carry scale MARKERS along the timeline; opted-in
// tracks regenerate their takes under the marker in force at the region's
// position. Baked regions are untouched by construction — their pitches
// derive from degree + division count, not from the allowed-degrees list.
// Pure resolution law, asserted headlessly.
export function globalScaleAt(globalScale, beat) {
  if (!globalScale || !globalScale.enabled || !Array.isArray(globalScale.markers)) return null;
  let best = null;
  for (const m of globalScale.markers) {
    if (!m || !Number.isFinite(m.atBeat) || m.atBeat > beat + 1e-6) continue;
    if (!best || m.atBeat > best.atBeat) best = m;
  }
  return best;
}

// ─── Baked-note performance capture (Q3) ────────────────────
// The things that vary per note but aren't visible as duration/velocity:
// the envelope draw, vibrato parameterisation, glide, onset noise, tuning
// and vowel position. Every field mirrors EXACTLY what the render path
// reads off the note object, so a drill-down card can never disagree with
// the audio. Pure — asserted headlessly.
export function notePerformance(note) {
  return {
    envelope: {
      a: note.envelopeAttack ?? null,
      d: note.envelopeDecay ?? null,
      s: note.envelopeSustain ?? null,
      r: note.envelopeRelease ?? null,
    },
    vibrato: ((note.vibratoProb ?? 0) > 0 && ((note.vibratoDepth ?? 0) > 0 || (note.vibratoDepthSd ?? 0) > 0))
      ? { prob: note.vibratoProb, depth: note.vibratoDepth, rate: note.vibratoRate ?? 5.5 }
      : null,
    glideFrom: note.slideFromFrequency ?? null,
    glideMs: note.slideFromFrequency ? Math.round((note.slideDuration || 0) * 1000) : 0,
    attackNoiseLevel: note.attackNoise?.level ?? null,
    tuningCents: note.intonationCents || 0,
    formantPos: note.formantPos ?? null,
  };
}

// ─── Patch transparency (Q1) ────────────────────────────────
// What a patch will do inside an arrangement, derived from its parameters
// alone — nothing is persisted for this. Pure so it can be asserted
// headlessly; the UI renders whatever comes back.

const _SURPRISE_DIM_BADGES = [
  { letter: "P",    enabled: "surprisePitchEnabled",    weight: "surprisePitchWeight" },
  { letter: "T",    enabled: "surpriseTuningEnabled",   weight: "surpriseTuningWeight" },
  { letter: "R",    enabled: "surpriseRhythmEnabled",   weight: "surpriseRhythmWeight" },
  { letter: "F",    enabled: "surpriseFormantEnabled",  weight: "surpriseFormantWeight" },
  { letter: "D",    enabled: "surpriseDynamicsEnabled", weight: "surpriseDynamicsWeight" },
  { letter: "rest", enabled: "surpriseRestEnabled",     weight: "surpriseRestWeight" },
];

// Degrees the patch actually plays: explicit customDegrees win, otherwise
// the named 12-tone preset.
export function patchDegrees(params) {
  if (Array.isArray(params.customDegrees) && params.customDegrees.length) {
    return params.customDegrees;
  }
  return (SCALE_PRESETS[params.scalePreset] || SCALE_PRESETS.major).degrees;
}

export function patchBadges(params) {
  const p = params || {};
  const degrees = patchDegrees(p);
  const scaleLabel = p.scaleMode === "edo"
    ? `${p.edoDivisions || 12}-EDO ${degrees.length}`
    : (SCALE_PRESETS[p.scalePreset]?.label || p.scalePreset || "Major");
  return {
    surpriseOn: (p.surpriseProb ?? 0) > 0 &&
      _SURPRISE_DIM_BADGES.some(d => p[d.enabled] && (p[d.weight] ?? 0) > 0),
    dims: _SURPRISE_DIM_BADGES
      .filter(d => p[d.enabled] && (p[d.weight] ?? 0) > 0)
      .map(d => d.letter),
    scaleLabel,
    splits: degrees.length,
    grid: p.beatDivisions ?? 1,
    tempo: p.tempo ?? null, // palette voices drop tempo (session context); callers pass originTempo
    connection: p.noteConnection || "glide",
  };
}

// Browser filter bucket for "number of splits" — only presets that say
// something about scale get a bucket; the rest only show under "all".
export function splitsBucketOf(parameters) {
  const p = parameters || {};
  let n = null;
  if (Array.isArray(p.customDegrees) && p.customDegrees.length) n = p.customDegrees.length;
  else if (p.scalePreset && SCALE_PRESETS[p.scalePreset]) n = SCALE_PRESETS[p.scalePreset].degrees.length;
  if (n == null) return null;
  if (n === 12) return "12";
  if (n >= 8) return "8+";
  if (n >= 5) return String(n);
  return "other";
}

// ─── Scale ──────────────────────────────────────────────────

export class Scale {
  /**
   * @param {number}   divisions    Octave divisions (12 for standard, any N for EDO)
   * @param {number[]} allDegrees   All playable degrees within one octave
   * @param {number[]} subScale     Weighted sub-scale (user-selected notes)
   * @param {number}   weight       0.5 = equal weighting, 1.0 = only sub-scale
   * @param {number}   tonicHz      Reference pitch
   * @param {Object?}  degreeTuning Per-pitch-class cent offsets layered on
   *                                the EDO grid ({pc: cents}) — how scales
   *                                from tuning traditions that aren't equal-
   *                                tempered (just, Pythagorean, maqamat…)
   *                                get their real pitch centres.
   */
  constructor(divisions, allDegrees, subScale, weight, tonicHz = 261.63, degreeTuning = null) {
    this.div = divisions;
    this.all = allDegrees;
    this.sub = subScale.length > 0 ? subScale : allDegrees;
    this.weight = weight;
    this.tonicHz = tonicHz;
    this.tuning = degreeTuning && typeof degreeTuning === "object" ? degreeTuning : null;
  }

  degreeToHz(degree) {
    const base = this.tonicHz * Math.pow(2, degree / this.div);
    if (!this.tuning) return base;
    const cents = this.tuning[this.norm(degree)] || 0;
    return cents ? base * Math.pow(2, cents / 1200) : base;
  }

  norm(degree) {
    return ((Math.round(degree) % this.div) + this.div) % this.div;
  }

  nearest(degree) {
    if (this.all.length === 0) return degree;
    let best = this.all[0];
    let bestDist = Infinity;
    const centerOct = Math.floor(degree / this.div);
    for (let oct = centerOct - 2; oct <= centerOct + 2; oct++) {
      for (const d of this.all) {
        const target = d + oct * this.div;
        const dist = Math.abs(target - degree);
        if (dist < bestDist) {
          bestDist = dist;
          best = target;
        }
      }
    }
    return best;
  }

  stepFrom(degree, steps) {
    const ordered = [...this.all].sort((a, b) => a - b);
    if (ordered.length === 0 || steps === 0) return this.nearest(degree);
    const start = this.nearest(degree);
    const pc = this.norm(start);
    const octave = Math.floor((start - pc) / this.div);
    const index = ordered.indexOf(pc);
    if (index < 0) return this.nearest(degree + steps);

    const absoluteIndex = octave * ordered.length + index + steps;
    const targetOctave = Math.floor(absoluteIndex / ordered.length);
    const targetIndex = ((absoluteIndex % ordered.length) + ordered.length) % ordered.length;
    return ordered[targetIndex] + targetOctave * this.div;
  }

  stepDistance(a, b) {
    return Math.abs(this._stepIndex(this.nearest(a)) - this._stepIndex(this.nearest(b)));
  }

  _stepIndex(degree) {
    const ordered = [...this.all].sort((a, b) => a - b);
    if (ordered.length === 0) return 0;
    const nearest = this.nearest(degree);
    const pc = this.norm(nearest);
    const octave = Math.floor((nearest - pc) / this.div);
    const index = Math.max(0, ordered.indexOf(pc));
    return octave * ordered.length + index;
  }

  /** Pick a note, biased toward sub-scale by `weight`. */
  pickNote(rng) {
    return (rng.next() < this.weight && this.sub.length > 0)
      ? rng.pick(this.sub)
      : rng.pick(this.all);
  }

  /**
   * Pick a note near `current` using a stacked (exponential) interval
   * distribution: small intervals are always more probable.
   *
   * @param {number} current      Current degree (may span octaves)
   * @param {number} peakedness   0 = flat (uniform), 5+ = strongly peaked
   * @param {number} maxRange     Max interval in scale steps
   * @param {SeededRNG} rng
   * @returns {number} New degree
   */
  pickNearby(current, peakedness, maxRange, rng) {
    // Build candidate pool: all reachable degrees within ±maxRange
    const candidates = [];
    for (let oct = -2; oct <= 2; oct++) {
      for (const d of this.all) {
        const target = d + oct * this.div;
        const dist = Math.abs(target - (current % this.div + (current < 0 ? -this.div : 0)));
        // Also account for wrapping
        const trueDist = Math.min(
          Math.abs(target - current),
          Math.abs(target - current + this.div),
          Math.abs(target - current - this.div)
        );
        if (trueDist <= maxRange) {
          // Stacked distribution: exponential decay with distance
          const w = Math.exp(-trueDist * peakedness);
          // Sub-scale bonus
          const subBonus = this.sub.includes(d) ? this.weight : (1 - this.weight);
          candidates.push({ degree: target, prob: w * subBonus });
        }
      }
    }
    if (candidates.length === 0) return current;

    // Normalise and sample
    const total = candidates.reduce((s, c) => s + c.prob, 0);
    let r = rng.next() * total;
    for (const c of candidates) { r -= c.prob; if (r <= 0) return current + (c.degree - (current % this.div)); }
    // Fallback: return closest actual degree offset
    const chosen = candidates[candidates.length - 1];
    return current + (chosen.degree - (current % this.div));
  }

  /** Human-readable name for a degree. */
  degreeName(d) {
    if (this.div === 12) return NOTE_NAMES_12[((d % 12) + 12) % 12];
    return String(((d % this.div) + this.div) % this.div + 1);
  }
}

// ─── Motif ──────────────────────────────────────────────────

class Motif {
  /** @param {Array<{degree:number, formant:string}>} notes */
  constructor(notes) { this.notes = notes; }

  clone() { return new Motif(this.notes.map(n => ({ ...n }))); }

  /** Return a variant with one note replaced.
   *  Rhythm fields (startDiv, durationDivs) are preserved unless the
   *  newNote explicitly carries its own durationDivs override. */
  variant(position, newNote) {
    const m = this.clone();
    m.notes[position] = {
      ...newNote,
      startDiv: this.notes[position].startDiv,
      durationDivs: newNote._rhythmOverride
        ? newNote.durationDivs
        : this.notes[position].durationDivs,
    };
    // Clean transient flag
    delete m.notes[position]._rhythmOverride;
    return m;
  }
}

// ─── Repertoire (motif-sequence level) ──────────────────────

class Repertoire {
  /**
   * @param {Motif[]} motifs
   * @param {number}  seqProb  0 = random order, 1 = strict fixed sequence
   */
  constructor(motifs, seqProb) {
    this.motifs = [...motifs];
    this.baseLen = motifs.length;
    this.sourceBase = motifs.map((_, i) => i);
    this.sequence = motifs.map((_, i) => i);   // initial ordering
    this.seqProb = seqProb;
    this.pos = 0;
  }

  nextMotif(rng) {
    if (rng.next() < this.seqProb) {
      const idx = this.sequence[this.pos % this.sequence.length];
      this.pos++;
      return { motif: this.motifs[idx], index: idx };
    }
    const idx = rng.int(0, this.motifs.length);
    return { motif: this.motifs[idx], index: idx };
  }

  /**
   * Incorporate a surprise motif, extending the sequence per the user's
   * design: the full sequence gains a new cycle with one motif replaced.
   */
  incorporate(variantMotif, replacedOriginalIndex, maxBaked = Infinity) {
    if (!this.canIncorporate(maxBaked)) return false;
    const vi = this.motifs.length;
    this.motifs.push(variantMotif);
    this.sourceBase.push(replacedOriginalIndex);
    // New cycle = base sequence with the replaced slot swapped
    const cycle = [];
    for (let i = 0; i < this.baseLen; i++) {
      cycle.push(i === replacedOriginalIndex ? vi : this.sequence[i % this.baseLen]);
    }
    this.sequence = [...this.sequence, ...cycle];
    return true;
  }

  canIncorporate(maxBaked = Infinity) {
    return this.bakedCount < maxBaked;
  }

  baseIndexFor(motifIndex) {
    return this.sourceBase[motifIndex] ?? (motifIndex % Math.max(1, this.baseLen));
  }

  get size() { return this.motifs.length; }
  get bakedCount() { return Math.max(0, this.motifs.length - this.baseLen); }
  get sequenceLength() { return this.sequence.length; }

  /**
   * How far a (variant) motif has drifted from its canonical base form.
   * Returns normalised {pitch, rhythm} in 0..1 for a deviation "heat" map.
   * An original (motifIndex < baseLen) has zero deviation by definition.
   */
  motifDeviation(motifIndex, div = 12) {
    const cache = this._devCache || (this._devCache = {});
    if (cache[motifIndex]) return cache[motifIndex];
    const base = this.baseIndexFor(motifIndex);
    const bm = this.motifs[base], vm = this.motifs[motifIndex];
    let out = { pitch: 0, rhythm: 0 };
    if (bm && vm && motifIndex !== base) {
      const a = bm.notes, b = vm.notes;
      const n = Math.max(a.length, b.length);
      let pitch = 0, rhythm = 0;
      for (let i = 0; i < n; i++) {
        const na = a[i], nb = b[i];
        if (na && nb) {
          pitch += Math.abs((nb.degree || 0) - (na.degree || 0));
          rhythm += Math.abs((nb.durationDivs || 0) - (na.durationDivs || 0));
        } else {
          const ref = na || nb;
          pitch += div;                          // structural change ≈ octave
          rhythm += Math.abs(ref.durationDivs || 1);
        }
      }
      const baseDur = a.reduce((s, x) => s + (x.durationDivs || 0), 0) || 1;
      out = {
        pitch: Math.min(1, pitch / Math.max(1, div * 0.5)),
        rhythm: Math.min(1, rhythm / Math.max(1, baseDur * 0.5)),
      };
    }
    cache[motifIndex] = out;
    return out;
  }
}

// ─── Generation engine (stateful, produces one note at a time) ─

export class GenerationEngine {
  constructor(params) {
    params = engineParams(params);
    this.p = params;
    this.rng = new SeededRNG(params.seed || 42);
    // Percussion instrument one-shots draw from a SEPARATE seeded stream, so
    // enabling/adding percussion never perturbs the melodic sequence a given
    // seed produces (owner 2026-07-10).
    this._percRng = new SeededRNG(((params.seed || 42) ^ 0x9e3779b9) >>> 0);
    this.scale = this._buildScale();
    this.repertoire = null;
    this._motif = null;
    this._motifIdx = 0;
    this._noteIdx = 0;
    this._currentDegree = 0;
    this._currentFormant = (params.activeFormants || ["ah"])[0];
    this._notesGenerated = 0;
    this._currentRootTarget = this._pickInitialRoot();
    this._lastOutputDegree = null;
    this._lastOutputFrequency = null;
    this._lastGapFraction = 1;
    this._motifSurprisePlan = null;
    this._activeSurpriseProjection = null;
    this._resetMetrics();
  }

  _resetMetrics() {
    this._metrics = {
      notes: 0,
      rests: 0,
      surpriseNotes: 0,
      surpriseStarts: 0,
      repeatNotes: 0,
      pitchBits: 0,
      pitchBitsSq: 0,
      pitchBitsN: 0,
      dynBits: 0,
      dynBitsN: 0,
      restBits: 0,
      musicalSeconds: 0,
      bigramEvents: 0,
      novelBigrams: 0,
      bigramSeen: new Set(),
      motifPassCounts: {},
    };
  }

  _pickInitialRoot() {
    const roots = this.p.rootNotes;
    if (!roots || roots.length === 0) return 0;
    return roots[this.rng.int(0, roots.length)];
  }

  initialise() {
    this._resetMetrics();
    const motifs = [];
    for (let m = 0; m < this.p.motifCount; m++) {
      motifs.push(this._generateMotif());
    }
    this.repertoire = new Repertoire(motifs, this.p.sequenceProb);
    const first = this.repertoire.nextMotif(this.rng);
    this._motif = first.motif;
    this._motifIdx = first.index;
    this._noteIdx = 0;
    this._startMotifPass();
  }

  /** Produce the next note with rhythm and percussion metadata. */
  nextNote() {
    if (!this.repertoire) this.initialise();

    let isMotifStart = false;

    // Advance motif if current is exhausted
    if (this._noteIdx >= this._motif.notes.length) {
      this._endOfMotif();
      const next = this.repertoire.nextMotif(this.rng);
      this._motif = next.motif;
      this._motifIdx = next.index;
      this._noteIdx = 0;
      isMotifStart = true;
      this._startMotifPass();
    }
    if (this._noteIdx === 0) isMotifStart = true;

    let note = { ...this._motif.notes[this._noteIdx] };
    let isSurprise = false;
    let isSurpriseStart = false;

    // ── Motif-pass surprise ──
    // Surprise probability is evaluated once per motif pass. If it fires, one
    // slot in that pass is altered; incorporation may then bake that variant
    // into the growing repertoire sequence.
    if (this._activeSurpriseProjection && this._noteIdx >= this._activeSurpriseProjection.snapBackIndex) {
      this._activeSurpriseProjection = null;
    }
    if (this._motifSurprisePlan?.position === this._noteIdx) {
      this._activeSurpriseProjection = this._buildSurpriseProjection(this._noteIdx);
      note = { ...this._activeSurpriseProjection.notes[this._noteIdx] };
      isSurprise = true;
      isSurpriseStart = true;
      this._maybeBakeProjectedSurprise(this._activeSurpriseProjection);
      this._motifSurprisePlan = null;
    } else if (this._activeSurpriseProjection && this._noteIdx >= this._activeSurpriseProjection.startIndex && this._noteIdx < this._activeSurpriseProjection.snapBackIndex) {
      note = { ...this._activeSurpriseProjection.notes[this._noteIdx] };
      isSurprise = true;
    }

    // ── Motif-hit accuracy ──
    // Gaussian miss distribution: σ = missRange/3, clipped at ±3σ (= ±missRange).
    // This is a transient performance/memory miss in scale degrees. It is not
    // incorporated into the motif repertoire; surprise handles incorporation.
    if (this.rng.next() > (this.p.motifHitProb ?? 1)) {
      const missRange = Math.max(0, Math.round(this.p.motifHitRange ?? 0));
      if (missRange > 0) {
        const sigma = missRange / 3;
        let miss = Math.round(this.rng.gaussian(0, sigma));
        miss = Math.max(-missRange, Math.min(missRange, miss));  // clip at ±3σ
        if (miss === 0) miss = this.rng.next() < 0.5 ? -1 : 1;  // miss ≠ exact
        note.degree = this.scale.stepFrom(note.degree, miss);
      }
    }

    // ── Root pull (live) ──
    const phrasePos = this._motif.notes.length > 1
      ? this._noteIdx / (this._motif.notes.length - 1) : 0;
    const roots = this.p.rootNotes;
    const pullStrength = this.p.rootPullStrength ?? 0;
    if (roots && roots.length > 0 && pullStrength > 0) {
      const pullShape = this.p.rootPullShape ?? 0.7;
      const effectiveStrength = pullStrength * (1 - pullShape + pullShape * phrasePos);
      // Nudge toward root with probability proportional to effective strength
      if (this.rng.next() < effectiveStrength * 0.5) {
        const dist = this._distToRoot(note.degree);
        if (dist > 0) {
          // Step toward root
          let bestRoot = this._currentRootTarget;
          let bestDist = Infinity;
          for (let ro = -2; ro <= 2; ro++) {
            const rd = this._currentRootTarget + ro * this.scale.div;
            const d = Math.abs(note.degree - rd);
            if (d < bestDist) { bestDist = d; bestRoot = rd; }
          }
          const dir = bestRoot > note.degree ? 1 : -1;
          const step = this.rng.next() < 0.7 ? 1 : this.rng.int(2, 3); // step or leap
          note.degree = this.scale.stepFrom(note.degree, dir * step);
        }
      }
      // Check root arrival
      if (this._distToRoot(note.degree) <= 1) {
        this._handleRootArrival(note.degree);
      }
    }

    note.degree = this.scale.nearest(note.degree);

    // ── Cents-level intonation precision ──
    let intonationCents = 0;
    if (Number.isFinite(note.tuningOverrideCents)) {
      intonationCents = note.tuningOverrideCents;
    } else if (this.rng.next() > (this.p.precision ?? 1)) {
      const range = Math.max(0, this.p.precisionRange ?? 0);
      intonationCents = (this.rng.next() + this.rng.next() - 1) * range;
    }

    // Motif generation, surprises, and projections own the base note vowel.
    // Playback keeps that vowel and adds a *continuous* accuracy miss on top —
    // the sung formant can land anywhere on the circle, up to half a circle away,
    // including between two pure vowels. The base vowel stays stable for tracking.
    note.formant = note.formant || this._currentFormant;
    this._currentFormant = note.formant;
    // Realised vowel position: surprise may have set a displaced point; the
    // accuracy miss displaces further from there. Distance from the intended
    // landmark (in log-Hz units) is the measurable formant deviation.
    note.formantPos = this._formantAccuracyPos(note.formant, note.formantPos);
    const intendedVowel = vowelPointFor(note.formant);
    note.formantDistance = Math.hypot(
      note.formantPos.x - intendedVowel.x,
      note.formantPos.y - intendedVowel.y
    );

    const isMotifEnd = this._noteIdx >= this._motif.notes.length - 1;
    const motifNoteIndex = this._noteIdx;
    const motifNotesCount = this._motif.notes.length;
    this._noteIdx++;
    this._notesGenerated++;

    const intervalFromPrev = this._lastOutputDegree == null
      ? 0
      : Math.abs(note.degree - this._lastOutputDegree);
    const hz = this.scale.degreeToHz(note.degree) * Math.pow(2, intonationCents / 1200);
    const beatDiv = this.p.beatDivisions || 1;
    const divSec = 60 / ((this.p.tempo || 104) * beatDiv);
    const durationDivs = note.durationDivs || 1;
    const motifBeats = this.p.motifLengthBeats || this.p.motifLength || 4;
    // Velocity: use override from motif note (dynamics surprise) or sampled dynamic centre.
    let velocity = note.velocityOverride ?? this._pickVelocity();
    const restRatio = this._restRatioFor(note, beatDiv, isMotifStart);
    const isRatioRest = !note.isRest && this.rng.next() < restRatio;
    // Rest: silence the note
    if (note.isRest || isRatioRest) velocity = 0;
    const gridDuration = durationDivs * divSec;
    const fittedFrequency = this._fitFrequency(hz);
    const previousFrequency = this._lastOutputFrequency;
    const phraseStart = previousFrequency == null || this._lastGapFraction >= .15 || isMotifStart;
    // P3 note connection (owner): when notes overlap, either GLIDE the new
    // note from the previous pitch (mono legato, the old behaviour) or let
    // both RING (multiphonic) — the tail extension stays either way.
    const connection = this.p.noteConnection || "glide";
    const legatoFromPrevious = connection === "glide" &&
      velocity > 0 && previousFrequency != null && this._lastGapFraction <= 0;
    const slideDuration = legatoFromPrevious ? this._slideDuration(divSec, this._lastGapFraction) : 0;
    const gapFraction = this._gapFraction(intervalFromPrev, isMotifEnd);
    const legatoTail = gapFraction <= 0 ? this._slideDuration(divSec, gapFraction) : 0;
    const duration = gapFraction > 0
      ? gridDuration * (1 - gapFraction)
      : gridDuration + legatoTail;
    const subNote = this._subNoteVariation(velocity, hz, note.degree, note.formantPos);

    // ── Expectancy metrics (research instrumentation; inaudible) ──
    const prevDegree = this._lastOutputDegree;
    const pitchBits = prevDegree == null
      ? null
      : this._melodicPitchSurprisal(prevDegree, note.degree, phrasePos);
    let restBits = null;
    if (!note.isRest) {
      const pRest = Math.min(1 - 1e-6, Math.max(1e-6, restRatio));
      restBits = -Math.log2(isRatioRest ? pRest : 1 - pRest);
    }
    let dynBits = null;
    if (note.velocityOverride == null && velocity > 0) {
      const dynCenter = this._clamp(Number(this.p.dynamicsLevel ?? 0.62), 0.05, 1);
      const dynPrecision = this._clamp01(this.p.dynamicsPrecision ?? 0.75);
      if (velocity === dynCenter) {
        dynBits = -Math.log2(Math.max(1e-6, dynPrecision));
      } else {
        // Triangular deviation density over ±dynamicsRange, 0.05-wide bins.
        const dynRange = Math.max(1e-6, Number(this.p.dynamicsRange ?? 0.22));
        const dev = Math.abs(velocity - dynCenter);
        const density = Math.max(0, (1 - dev / dynRange) / dynRange);
        dynBits = Math.min(20, -Math.log2(Math.max(1e-6, (1 - dynPrecision) * density * 0.05)));
      }
    }

    this._lastOutputDegree = note.degree;
    this._lastOutputFrequency = velocity > 0 ? fittedFrequency : null;
    this._lastGapFraction = velocity > 0 ? gapFraction : 1;

    // Role classification (for the live histogram marker colour):
    //   surprise   — the note that triggers a surprise
    //   generation — a surprise's branching continuation, or a motif's first pass
    //   accuracy   — a replicated motif note (snapped back, or a repeat pass)
    const noteRole = isSurpriseStart
      ? "surprise"
      : isSurprise
        ? "generation"
        : (this._motifFirstPass ? "generation" : "accuracy");

    const out = {
      frequency: fittedFrequency,
      degree: note.degree,
      noteRole,
      duration: Math.max(gridDuration * 0.04, duration),
      formant: note.formant,
      formantPos: note.formantPos,
      formantDistance: note.formantDistance || 0,
      velocity,
      isRest: !!note.isRest || isRatioRest,
      isSurprise,
      // Which dimensions this surprise touched (pitch/tuning/rhythm/
      // dynamics/formant/rest) — the lanes display tags events with them.
      surpriseFeatures: isSurprise ? (this._activeSurpriseProjection?.features || []).slice() : [],
      motifIndex: this._motifIdx,
      baseIndex: this.repertoire ? this.repertoire.baseIndexFor(this._motifIdx) : this._motifIdx,
      isVariant: this.repertoire ? this._motifIdx >= this.repertoire.baseLen : false,
      motifNoteIndex,
      motifNotesCount,
      durationDivs,
      gapFraction,
      intonationCents,
      legatoFromPrevious,
      phraseStart,
      slideFromFrequency: legatoFromPrevious ? previousFrequency : null,
      slideDuration,
      startDiv: note.startDiv || 0,
      isMotifStart,
      beatDivisions: beatDiv,
      motifLengthDivs: motifBeats * beatDiv,
      pitchBits,
      dynBits,
      restBits,
      ...subNote,
    };
    // Q7 layered subnotes: each layer renders its own fingerprint under its
    // own subnote params — ONE seed drives everything (sequential rng draws
    // decorrelate the layers deterministically). Envelope draws are
    // independent per layer unless layerEnvOverride SYNCS THE TRIGGER
    // (owner rework 07-07): one probability roll + one set of z-scores per
    // note, applied around every stream's OWN envelope baselines — the
    // variations fire at once across base + layers, but each keeps the
    // envelope it was set to. Cross-layer coupling runs over the union.
    if (Array.isArray(this.p.layers) && this.p.layers.length) {
      let sharedEnv = null;
      if (this.p.layerEnvOverride) {
        const prob = this._clamp(this.p.layerEnvProb ?? this.p.envelopeProb ?? 0, 0, 1);
        sharedEnv = {
          vary: this.rng.next() < prob,
          z: { a: this._gaussian(), d: this._gaussian(), s: this._gaussian(), r: this._gaussian() },
          // owner 07-07: the variation MAGNITUDE is shared too — one SD per
          // envelope parameter for the base and every layer (each stream
          // still varies around its own mean)
          sd: {
            a: this.p.layerEnvAttackSd ?? this.p.envelopeAttackSd ?? 0.006,
            d: this.p.layerEnvDecaySd ?? this.p.envelopeDecaySd ?? 0.018,
            s: this.p.layerEnvSustainSd ?? this.p.envelopeSustainSd ?? 0.08,
            r: this.p.layerEnvReleaseSd ?? this.p.envelopeReleaseSd ?? 0.035,
          },
        };
        // the base joins the sync: replace its independent draw with the
        // shared trigger applied around the base's own means
        Object.assign(out, this._envelopeShared(
          sharedEnv, this.p, fittedFrequency, velocity));
      }
      out.layerRenders = this.p.layers.map((layer, i) =>
        this._layerRender(layer, i, velocity, fittedFrequency, note.degree, note.formantPos, out, sharedEnv));
      this._applyCrossLayerCoupling(out, out.layerRenders);
    }
    this._recordNoteMetrics(out, {
      isSurpriseStart,
      gridDuration,
      pitchBits,
      dynBits,
      restBits,
      prevDegree,
    });
    return out;
  }

  /** Info about current repertoire state (for UI display). */
  getState() {
    if (!this.repertoire) return { motifCount: 0, seqLen: 0, notes: 0 };
    return {
      motifCount: this.repertoire.size,
      seqLen: this.repertoire.sequenceLength,
      notes: this._notesGenerated,
    };
  }

  /** Normalised {pitch, rhythm} drift of a motif from its base form (0..1). */
  motifDeviation(motifIndex) {
    if (!this.repertoire) return { pitch: 0, rhythm: 0 };
    return this.repertoire.motifDeviation(motifIndex, this.scale ? this.scale.div : 12);
  }

  // ── Private ──

  _buildScale() {
    let div, allDeg, subDeg;
    if (this.p.scaleMode === "edo") {
      div = this.p.edoDivisions;
      allDeg = (this.p.customDegrees && this.p.customDegrees.length > 0)
        ? this.p.customDegrees
        : Array.from({ length: div }, (_, i) => i);
      subDeg = (this.p.subScaleNotes || []).filter(d => allDeg.includes(d));
      if (subDeg.length === 0) subDeg = allDeg;
    } else {
      div = 12;
      const preset = SCALE_PRESETS[this.p.scalePreset] || SCALE_PRESETS.major;
      allDeg = (this.p.customDegrees && this.p.customDegrees.length > 0)
        ? this.p.customDegrees
        : preset.degrees;
      subDeg = (this.p.subScaleNotes || allDeg).filter(d => allDeg.includes(d));
      if (subDeg.length === 0) subDeg = allDeg;
    }
    return new Scale(div, allDeg, subDeg, this.p.subScaleWeight, this.p.tonicHz || 261.63,
      this.p.degreeTuning || null);
  }

  _subNoteVariation(velocity = 0.6, fundamentalHz = 261.63, degree = 0, formantPos = null) {
    return {
      ...this._toneColourImperfection(),
      ...this._vibratoParams(fundamentalHz, velocity),
      ...this._spectralFingerprint(velocity, fundamentalHz, degree, formantPos),
      ...this._envelopeVariation(fundamentalHz, velocity),
    };
  }

  // One shared trigger + z-scores + SDs, applied around a param set's OWN
  // envelope MEANS — the synced-variation law for layerEnvOverride. The
  // magnitude of the variation (SD) is shared across base + layers (owner
  // 07-07: "it will have to be the same SDs for all of them"); only the
  // baseline means stay per-stream.
  _envelopeShared(shared, p, fundamentalHz = null, velocity = null) {
    const sample = (mean, sd, lo, hi, z) => {
      const base = this._clamp(mean, lo, hi);
      if (!shared.vary || sd <= 0) return base;
      return this._clamp(base + z * sd, lo, hi);
    };
    const profileExcitation = SPECTRAL_PROFILES[p.spectralProfile]
      ?.performance?.excitation?.type;
    const dynamicAttack = (p.excitationType || profileExcitation) === "bow"
      ? envelopeAttackByRegisterDynamicAt(
        p.envelopeAttackByRegisterDynamic, fundamentalHz, velocity)?.attack
      : null;
    const renderedDynamicAttack = dynamicAttack == null ? null
      : bowedEnvelopeAttackRenderSeconds(dynamicAttack);
    const registerAttack = renderedDynamicAttack ?? registerEnvelopeAttackAt(
      p.envelopeAttackByRegister, fundamentalHz);
    const attackHi = dynamicAttack != null ? .6 : .18;
    return {
      envelopeAttack: sample(registerAttack ?? p.envelopeAttack ?? 0.008,
        shared.sd.a, 0.001, attackHi, shared.z.a),
      envelopeDecay: sample(p.envelopeDecay ?? 0.04, shared.sd.d, 0.001, 0.5, shared.z.d),
      envelopeSustain: sample(p.envelopeSustain ?? 0.6, shared.sd.s, 0.05, 1, shared.z.s),
      envelopeRelease: sample(p.envelopeRelease ?? 0.08, shared.sd.r, 0.004, 0.6, shared.z.r),
    };
  }

  // Q7: one layer's render data for this note. The layer's subnote params
  // temporarily overlay the engine params so the SAME fingerprint code runs.
  _layerRender(layer, index, velocity, fundamentalHz, degree, formantPos, baseNote, sharedEnv = null) {
    const saved = this.p;
    this.p = { ...saved, ...(layer.sound || layer.subnote || {}) };
    let fields;
    try {
      fields = {
        ...this._vibratoParams(fundamentalHz, velocity),
        ...this._spectralFingerprint(velocity, fundamentalHz, degree, formantPos),
        // synced: the shared trigger around THIS layer's own baselines;
        // otherwise an independent draw
        ...(sharedEnv ? this._envelopeShared(sharedEnv, this.p, fundamentalHz, velocity) :
          this._envelopeVariation(fundamentalHz, velocity)),
      };
    } finally {
      this.p = saved;
    }
    const sub = layer.sound || layer.subnote || {};
    return {
      id: layer.id || `layer${index}`,
      gain: layer.gain ?? 1,
      space: layer.space || null,
      solo: !!layer.solo, // owner 07-07: soloed layers play alone
      effectsChain: sub.effectsChain || null,     // per-layer EFFECTS stack
      stageEffectsOn: sub.stageEffectsOn !== false, // whole-stage bypass
      note: fields,
    };
  }

  // Percussion v2 (owner 2026-07-10): render note-fields for ONE short attack
  // of a sub-note instrument. Mirrors _layerRender's overlay pattern, but swaps
  // in the dedicated percussion RNG (melodic stream untouched) and forces a
  // tight percussive envelope + a dead (non-ringing) material so ANY patch —
  // even a sustaining one — reads as a single hit rather than a held tone.
  _percInstrumentNote(subnote, { velocity = 0.7, pitchHz = 220, duration = 0.12 } = {}) {
    const savedP = this.p, savedRng = this.rng;
    this.p = { ...savedP, ...(subnote || {}) };
    this.rng = this._percRng || (this._percRng = new SeededRNG(1234567));
    let fields;
    try {
      fields = this._spectralFingerprint(velocity, pitchHz, 0, null);
    } finally {
      this.p = savedP;
      this.rng = savedRng;
    }
    return {
      ...fields,
      frequency: pitchHz,
      velocity,
      duration,
      partialMaterial: 0,                       // no resonator ring/T60 → a hit
      envelopeAttack: 0.002,
      envelopeDecay: Math.max(0.01, duration * 0.5),
      envelopeSustain: 0,
      envelopeRelease: Math.max(0.02, duration * 0.5),
      legatoFromPrevious: false,
    };
  }

  // Q7: sympathetic transfer across the union of base + layer partials —
  // cross-stream pairs only (each stream's internal bloom stays with the
  // renderer). Energy flows from stronger to weaker coupled partials, baked
  // into the starting amplitudes as the steady-state exchange.
  _applyCrossLayerCoupling(baseNote, layerRenders) {
    const transfer = this._clamp(this.p.partialTransfer ?? 0.15, 0, 1);
    if (transfer <= 0) return;
    const streams = [baseNote, ...layerRenders.map(lr => lr.note)];
    const union = [];
    streams.forEach((s, si) =>
      (s.harmonicPartials || []).forEach((part) => union.push({ si, part })));
    if (union.length < 2) return;
    const deltas = new Array(union.length).fill(0);
    for (let i = 0; i < union.length; i++) {
      for (let j = i + 1; j < union.length; j++) {
        if (union[i].si === union[j].si) continue;
        const C = transferCoupling(
          union[i].part.harmonicFrequency, union[j].part.harmonicFrequency);
        if (C < 0.01) continue;
        const flow = transfer * C * (union[j].part.amp - union[i].part.amp) * 0.35;
        deltas[i] += flow;
        deltas[j] -= flow;
      }
    }
    union.forEach((u, i) => { u.part.amp = Math.max(0, u.part.amp + deltas[i]); });
  }

  _vibratoParams(fundamentalHz = null, velocity = null) {
    const profileExcitation = SPECTRAL_PROFILES[this.p.spectralProfile]
      ?.performance?.excitation?.type;
    const fitted = (this.p.excitationType || profileExcitation) === "bow"
      ? vibratoByRegisterDynamicAt(
        this.p.vibratoByRegisterDynamic, fundamentalHz, velocity)
      : null;
    const role = String(this.p.performanceRole || "").toLowerCase();
    const fittedProbability = role === "vibrato"
      ? fitted?.prob
      : role === "non-vibrato" ? 0 : null;
    // The table stores the measured trajectory depth, not a raw oscillator
    // knob. Browser oscillator automation plus the canonical tracker returns
    // about 0.8 of a smooth sinusoid across the six T-047 cells; this pinned
    // render calibration makes the consumer reproduce the measured target.
    const fittedDepth = fitted?.depth == null ? null : fitted.depth * 1.25;
    return {
      vibratoProb: fittedProbability ?? this.p.vibratoProb ?? 0,
      vibratoDepth: fittedDepth ?? this.p.vibratoDepth ?? 0,
      vibratoDepthSd: fitted ? 0 : this.p.vibratoDepthSd ?? 0,
      vibratoRate: fitted?.rate ?? this.p.vibratoRate ?? 5.5,
      vibratoRateSd: fitted ? 0 : this.p.vibratoRateSd ?? 0,
    };
  }

  _toneColourImperfection() {
    if ((this.p.voiceMode || "formant") !== "formant") return {};
    if (this.rng.next() >= (this.p.toneColorProb ?? 0)) return {};
    const formant = this.p.toneFormantDrift ?? 0;
    const resonance = this.p.toneResonanceDrift ?? 0;
    const breath = this.p.toneBreath ?? 0;
    const profile = SPECTRAL_PROFILES[this.p.spectralProfile];
    const excitationType = this.p.excitationType ||
      profile?.performance?.excitation?.type;
    return {
      toneFormantShift: (this.rng.next() * 2 - 1) * formant,
      toneResonanceShift: (this.rng.next() * 2 - 1) * resonance,
      toneBreathLevel: toneBreathLevelFor(
        excitationType, breath, () => this.rng.next()),
    };
  }

  // CH-B1 rev 2 (owner): articulation MANIPULATES the selected body — the
  // vowel walk's five formant bands are layered ON TOP of the base body's
  // bands, scaled by bodyArticulation depth (0 = still, 1 = full vowel EQ).
  // A violin body with articulation is a wah violin; the base is never
  // discarded. Log-gain summation makes this composition physically clean.
  _articulationDepth() {
    if (Number.isFinite(this.p.bodyArticulation)) return this._clamp(this.p.bodyArticulation, 0, 1);
    return (this.p.bodyType === "vocal") ? 1 : 0; // legacy vocal-type presets
  }

  _articulatedBands(formantPos) {
    const depth = this._articulationDepth();
    if (depth <= 0 || !formantPos) return null;
    const f = formantFreqsAtPoint(formantPos);
    const gains = [2.0, 1.7, 1.2, 0.9, 0.7];
    const lvl = [
      this._clamp(this.p.formantF1Level ?? 1, 0, 2),
      this._clamp(this.p.formantF2Level ?? 1, 0, 2),
      this._clamp(this.p.formantF3Level ?? 1, 0, 2),
      this._clamp(this.p.formantF4Level ?? 1, 0, 2),
      this._clamp(this.p.formantF5Level ?? 1, 0, 2)];
    const bwScale = this._clamp(this.p.formantBandwidth ?? 1, 0.4, 2.5);
    return [f.f1, f.f2, f.f3, f.f4, f.f5].map((freq, i) => ({
      freq,
      gain: gains[i] * lvl[i] * depth,
      width: Math.max(0.1, ((f.bw && f.bw[i]) || 90) / Math.max(60, freq) * 1.9 * bwScale),
    }));
  }

  _spectralFingerprint(velocity = 0.6, fundamentalHz = 261.63, degree = 0, formantPos = null) {
    const profile = SPECTRAL_PROFILES[this.p.spectralProfile] || SPECTRAL_PROFILES.violin;
    const registerProfile = registerProfileAt(profile, fundamentalHz);
    const profilePartials = registerProfile.partials.length ? registerProfile.partials : profile.partials;
    const count = Math.max(1, Math.min(profilePartials.length, Math.round(this.p.spectralPartials ?? 12)));
    const dynamicsAmount = Math.max(0, this.p.spectralDynamicAmount ?? 0.8);
    const resonanceAmount = bodyAmountFor(this.p, profile);
    const velocityRatio = Math.max(0.08, velocity / 0.62);
    const means = Array.isArray(this.p.spectralPartialMeans) ? this.p.spectralPartialMeans : [];
    const sds = Array.isArray(this.p.spectralPartialSds) ? this.p.spectralPartialSds : [];
    // The Body stage (T5): fixed-Hz resonance bands — instrument body by
    // default ("auto"), or any BODY_PRESETS entry incl. the vowels. This
    // is the ONLY register-dependent shaping now: the per-partial reg
    // grids are retired (audit A7 — register timbre emerges from where
    // the partials fall against fixed-Hz bands, not hand-set exponents).
    const baseBands = Array.isArray(this.p.bodyBands)
      ? this.p.bodyBands                       // preset used as a starting point, then band-edited
      : bodyBandsFor(this.p, profile);
    const artic = this._articulatedBands(formantPos);
    let bodyBands = artic ? baseBands.concat(artic) : baseBands;
    const singerFormant = this._clamp(this.p.singerFormantAmount ?? 0, 0, 1.5);
    if (singerFormant > 0) {
      bodyBands = bodyBands.concat([{ freq: 3000, gain: singerFormant * 1.4, width: 0.22 }]);
    }
    // Tone v2 (T2): resolve the excitation once per note. Current settings
    // are applied as a transform NORMALISED against the profile's own
    // excitation defaults — the measured amplitude tables already embody
    // the instrument played at its natural position, so defaults → exactly
    // 1 and old presets are untouched; moving position/type/hardness
    // reshapes the spectrum relative to that natural state.
    const partialB = Number.isFinite(this.p.partialB)
      ? Math.max(0, this.p.partialB)
      : (Number.isFinite(registerProfile.partialB)
        ? Math.max(0, registerProfile.partialB)
        : legacyStretchToB(this.p.spectralStretchCents ?? 0));
    const resClass = this.p.resonatorClass || "string";
    const excDefault = profile.performance?.excitation || { type: "bow", position: 0.5, hardness: 0.6 };
    const excType = this.p.excitationType || excDefault.type || "bow";
    const excPos = Number.isFinite(this.p.excitationPosition) ? this.p.excitationPosition : (excDefault.position ?? 0.5);
    let excHard = Number.isFinite(this.p.excitationHardness) ? this.p.excitationHardness : (excDefault.hardness ?? 0.6);
    excHard = velocityHardness(excHard, velocity, this.p.velocityHardnessCoupling);
    // The Human dial (T3): one coherent draw stands in for the player's
    // onset variation (audit A1 — no more independent per-partial draws).
    // Struck/plucked humanity is per-note only: hardness and level jitter,
    // since a hammer cannot wobble after contact.
    const human = this._clamp(
      Number.isFinite(this.p.excitationHuman) ? this.p.excitationHuman : (excDefault.human ?? 0.35), 0, 1);
    const onsetF = human > 0 ? Math.max(-1, Math.min(1, this._gaussian() * 0.45)) : 0;
    let levelJitter = 1;
    if (human > 0 && (excType === "strike" || excType === "pluck")) {
      excHard = this._clamp(excHard + this._gaussian() * 0.05 * human, 0, 1);
      levelJitter = Math.max(0.5, 1 + this._gaussian() * 0.04 * human);
    }
    let referenceNorm = 0;
    const harmonicFrequencies = profilePartials.slice(0, count).map((_, i) =>
      Math.max(1, partialFrequency(i + 1, fundamentalHz, partialB, resClass)));
    const bodyResponses = bodyResponsesForPartials(bodyBands, harmonicFrequencies,
      resonanceAmount, fundamentalHz, profile.resonancesFit?.lowestF0Hz);
    const partials = profilePartials.slice(0, count).map((partial, i) => {
      const fallbackAmp = typeof partial === "number" ? partial : partial.amp;
      const fallbackSd = fallbackAmp * (typeof partial === "number" ? 0.08 : partial.spread ?? 0.25) * 0.5;
      const amp = this._clamp(means[i] ?? fallbackAmp, 0, 1.5);
      const sd = this._clamp(sds[i] ?? fallbackSd, 0, 0.75);
      const harmonic = i + 1;
      // Dynamic-brightness law (T2, audit A14): the per-partial dyn grids
      // are retired — louder playing brightens the top by one global law.
      const dynamics = Math.pow(velocityRatio,
        dynamicBrightness(harmonic, this.p.dynamicBlare, velocityRatio) * dynamicsAmount);
      // Realised mode frequency (T1 law) — body resonances and hardness
      // rolloff both act on where the partial actually sits.
      const harmonicFrequency = harmonicFrequencies[i];
      const registerResponse = bodyResponses[i] ?? 1;
      const excCur = excitationSpectrum(excType, harmonic, { position: excPos, hardness: excHard, freqHz: harmonicFrequency });
      const excBase = excitationSpectrum(excDefault.type || "bow", harmonic, {
        position: excDefault.position ?? 0.5, hardness: excDefault.hardness ?? 0.6, freqHz: harmonicFrequency,
      });
      const excitation = excBase > 1e-6 ? Math.min(8, excCur / excBase) : (excCur > 1e-6 ? 8 : 1);
      const sourceTilt = glottalSourceGain(harmonic, this.p.glottalTilt);
      const dynamicMean = amp * dynamics * registerResponse * excitation * sourceTilt * this._partialMacroGain(harmonic);
      // Per-partial sensitivity to the shared fluctuation — the old SD grid
      // reinterpreted: partials that used to wobble a lot follow the player
      // harder, but always in the same direction as everyone else.
      const sens = this._clamp(sd / Math.max(0.005, amp), 0, 2);
      const sampled = Math.max(0, dynamicMean * levelJitter * (1 + human * sens * onsetF * humanPartialShape(harmonic)));
      referenceNorm += amp;
      return {
        harmonic,
        amp: sampled,
        mean: dynamicMean,
        sd,
        sens,
        registerResponse,
        harmonicFrequency,
      };
    });
    const legacyAttackStagger = registerAttackStaggerAt(
      profile.attackByRegister, fundamentalHz) ??
      profile.performance?.lowToHighStaggerMs ?? null;
    const bowedAttack = excType === "bow"
      ? envelopeAttackByRegisterDynamicAt(
        this.p.envelopeAttackByRegisterDynamic, fundamentalHz, velocity)
      : null;
    // The corrected three-frame lock-in estimator has a ~14-period reporting
    // floor on rendered high notes. Spend only the evidence above that floor
    // on explicit partial/noise delay so every T-048 cell remains <=18.
    const lockinStaggerMs = Number.isFinite(bowedAttack?.onsetLockinPeriods)
      ? Math.max(0, bowedAttack.onsetLockinPeriods - 14) * 1000 /
        Math.max(1, fundamentalHz)
      : null;
    const measuredAttackNoise = resolveAttackNoise(
      profile.performance?.attackNoise, this.p, fundamentalHz);
    const attackNoise = measuredAttackNoise && lockinStaggerMs != null
      ? { ...measuredAttackNoise, decay: Math.min(
        Number(measuredAttackNoise.decay) || Infinity,
        Math.max(.005, lockinStaggerMs / 1000)) }
      : measuredAttackNoise;
    return {
      harmonicPartials: partials,
      // Shape/frequency/decay are pinned by the measurement campaign. The
      // profile remains the exact fallback for legacy presets.
      attackNoise,
      attackNoiseDirect: this._clamp(this.p.attackNoiseDirect ?? 0, 0, 1),
      attackNoiseVelocityExponent: this._clamp(this.p.attackNoiseVelocityExponent ?? 1, 0, 2),
      // Q8 attack stagger: measured low→high onset spread when the profile
      // carries one (hand defaults per excitation type apply otherwise)
      attackStaggerMs: lockinStaggerMs == null ? legacyAttackStagger
        : Math.min(legacyAttackStagger ?? Infinity, lockinStaggerMs),
      partialMaterial: this.p.partialMaterial ?? profile.performance?.partialMaterial ?? 0.45,
      decaySecondStage: this._clamp(this.p.decaySecondStage ?? 0, 0, 1),
      decaySecondRatio: this._clamp(this.p.decaySecondRatio ?? 1, 1, 8),
      spectralMix: this.p.spectralMix ?? 0,
      excitationType: excType,
      excitationHuman: human,
      // L4/L7: a blown note's airflow floor is an explicit, deterministic
      // part of its spectral fingerprint.  The retired formant-only tone
      // imperfection path cannot be the source of breath for Fourier winds.
      // Human affects the continuous turbulence trace, never whether air is
      // present at all.
      toneBreathLevel: excType === "blow"
        ? toneBreathLevelFor(excType, this.p.toneBreath, () => this.rng.next())
        : 0,
      breathNoiseColor: this._clamp(this.p.breathNoiseColor ?? 0, -1, 1),
      breathLevelScale: this._clamp(this.p.breathLevelScale ?? 1, 0, 3),
      breathVelocityExponent: this._clamp(this.p.breathVelocityExponent ?? 1, 0, 2),
      breathTurbulence: this._clamp(this.p.breathTurbulence ?? 0, 0, 1),
      breathBodyAmount: this._clamp(this.p.breathBodyAmount ?? 0, 0, 1),
      onsetSpectrumTilt: this._clamp(this.p.onsetSpectrumTilt ?? 0, -1, 1),
      onsetSpectrumDecay: this._clamp(this.p.onsetSpectrumDecay ?? 0.06, 0.015, 0.25),
      articulationCoupling: this._clamp(this.p.articulationCoupling ?? 0, 0, 1),
      articulationStrength: this._clamp(this.p.articulationStrength ?? 0.5, 0, 1),
      articulationVariation: this._clamp(this.p.articulationVariation ?? 0, 0, 1),
      articulationVelocitySlope: this._clamp(this.p.articulationVelocitySlope ?? 0, -1.5, 1.5),
      onsetWanderCents: this._clamp(this.p.onsetWanderCents ?? 0, 0, 120),
      onsetWanderSettlePeriods: this._clamp(this.p.onsetWanderSettlePeriods ?? 12, 2, 30),
      bowScratchLevel: this._clamp(this.p.bowScratchLevel ?? 0, 0, 2),
      bowNoise: profile.bowNoise?.profilePinned === true &&
          Array.isArray(profile.bowNoise.profile)
        ? {
            ...profile.bowNoise,
            deconvolutionBands: Array.isArray(profile.resonances)
              ? profile.resonances : [],
          }
        : null,
      bowNoiseLevel: this._clamp(this.p.bowNoiseLevel ?? 0, 0, 2),
      bowNoiseVelocityExponent: this._clamp(
        Number.isFinite(this.p.bowNoiseVelocityExponent)
          ? this.p.bowNoiseVelocityExponent
          : profile.bowNoise?.levelLaw?.velocityExponent ?? 1, 0, 2),
      onsetScoopDepthCents: this._clamp(this.p.onsetScoopDepthCents ?? 0, 0, 180),
      onsetScoopSettle: this._clamp(this.p.onsetScoopSettle ?? 0.06, 0.015, 0.35),
      onsetScoopRearticulatedScale: this._clamp(this.p.onsetScoopRearticulatedScale ?? 0.35, 0, 1),
      onsetScoopRegisterSlope: this._clamp(this.p.onsetScoopRegisterSlope ?? 0, -1.5, 1.5),
      onsetScoopVelocitySlope: this._clamp(this.p.onsetScoopVelocitySlope ?? 0, -1.5, 1.5),
      voiceBreathSync: this._clamp(this.p.voiceBreathSync ?? 0, 0, 1),
      partialTransfer: this._clamp(this.p.partialTransfer ?? 0.15, 0, 1),
      releaseDamping: this._clamp(this.p.releaseDamping ?? 0, 0, 1),
      polarisationAmount: this._clamp(this.p.polarisationAmount ?? 0, 0, 1),
      polarisationSplitCents: this._clamp(this.p.polarisationSplitCents ?? 0, 0, 6),
      polarisationDecayRatio: this._clamp(this.p.polarisationDecayRatio ?? 1, 0.25, 4),
      // Body stage (T5): carried on the note so the renderer can evaluate
      // the body against MODULATED frequencies (vibrato FM → body AM).
      bodyBands,
      bodyAmount: resonanceAmount,
      spectralReferenceNorm: Math.max(0.001, referenceNorm),
      spectralCullThreshold: this._clamp(this.p.spectralCullThreshold ?? 0.0005, 0.0001, 0.01),
      spectralStretchCents: this.p.spectralStretchCents ?? 0,
      // Tone v2 resonator (T1): inharmonicity as a physical B constant
      // (new param wins; legacy cents map onto it) and the mode ratio class.
      partialB,
      resonatorClass: this.p.resonatorClass || "string",
    };
  }

  /**
   * Macro gain for one harmonic (docs/PARTIAL_MACROS_DESIGN.md): a few
   * physically meaningful knobs reshape the whole partial set —
   *   tilt      spectral slope (±~4.5 dB/octave at the extremes)
   *   odd/even  −1 mutes evens (closed-tube/clarinet), +1 mutes odds;
   *             the fundamental is always exempt
   *   comb      movable boost of a related-frequency group centred on a
   *             harmonic number (keytracked by construction)
   *   groups    six octave-group faders: 1 | 2 | 3–4 | 5–8 | 9–16 | 17+
   */
  _partialMacroGain(harmonic) {
    const p = this.p;
    let gain = 1;
    const tilt = this._clamp(Number(p.partialTilt ?? 0), -1, 1);
    if (tilt !== 0) gain *= Math.pow(harmonic, tilt * 1.5);
    const oddEven = this._clamp(Number(p.partialOddEven ?? 0), -1, 1);
    if (oddEven !== 0 && harmonic > 1) {
      const isEven = harmonic % 2 === 0;
      if (oddEven < 0 && isEven) gain *= 1 + oddEven * 0.92;
      if (oddEven > 0 && !isEven) gain *= 1 - oddEven * 0.92;
    }
    const comb = this._clamp(Number(p.partialComb ?? 0), 0, 1);
    if (comb > 0) {
      const centre = Math.max(1, Number(p.partialCombFreq ?? 4));
      const d = Math.log2(harmonic / centre);
      gain *= 1 + comb * 2 * Math.exp(-0.5 * (d / 0.35) ** 2);
    }
    const groupKeys = ["partialGroup1", "partialGroup2", "partialGroup3", "partialGroup4", "partialGroup5", "partialGroup6"];
    const gi = harmonic === 1 ? 0 : harmonic === 2 ? 1 : harmonic <= 4 ? 2 : harmonic <= 8 ? 3 : harmonic <= 16 ? 4 : 5;
    const groupGain = Number(p[groupKeys[gi]] ?? 1);
    if (Number.isFinite(groupGain)) gain *= this._clamp(groupGain, 0, 2);
    return gain;
  }

  _gaussian() {
    const u1 = Math.max(1e-6, this.rng.next());
    const u2 = Math.max(1e-6, this.rng.next());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  }

  _envelopeVariation(fundamentalHz = null, velocity = null) {
    const vary = this.rng.next() < (this.p.envelopeProb ?? 0);
    const sample = (mean, sd, lo, hi) => {
      const base = this._clamp(mean, lo, hi);
      if (!vary || sd <= 0) return base;
      return this._clamp(base + this._gaussian() * sd, lo, hi);
    };
    const profileExcitation = SPECTRAL_PROFILES[this.p.spectralProfile]
      ?.performance?.excitation?.type;
    const dynamicAttack = (this.p.excitationType || profileExcitation) === "bow"
      ? envelopeAttackByRegisterDynamicAt(
        this.p.envelopeAttackByRegisterDynamic, fundamentalHz, velocity)?.attack
      : null;
    const renderedDynamicAttack = dynamicAttack == null ? null
      : bowedEnvelopeAttackRenderSeconds(dynamicAttack);
    const registerAttack = renderedDynamicAttack ?? registerEnvelopeAttackAt(
      this.p.envelopeAttackByRegister, fundamentalHz);
    const attackHi = dynamicAttack != null ? .6 : .18;
    return {
      envelopeAttack: sample(registerAttack ?? this.p.envelopeAttack ?? 0.008,
        this.p.envelopeAttackSd ?? 0.006, 0.001, attackHi),
      envelopeDecay: sample(this.p.envelopeDecay ?? 0.04, this.p.envelopeDecaySd ?? 0.018, 0.001, 0.5),
      envelopeSustain: sample(this.p.envelopeSustain ?? 0.6, this.p.envelopeSustainSd ?? 0.08, 0.05, 1),
      envelopeRelease: sample(this.p.envelopeRelease ?? 0.08, this.p.envelopeReleaseSd ?? 0.035, 0.004, 0.6),
    };
  }

  _fitFrequency(hz) {
    let f = hz;
    while (f < 60) f *= 2;
    while (f > 5000) f /= 2;
    return f;
  }

  _restRatioFor(note, beatDiv, isMotifStart) {
    const fallback = this.p.restRatio ?? 0;
    if (isMotifStart) {
      return this._clamp(this.p.restMotifStartRatio ?? fallback, 0, 0.95);
    }
    const startDiv = note.startDiv || 0;
    const isOnMeter = startDiv % Math.max(1, beatDiv || 1) === 0;
    const ratio = isOnMeter
      ? (this.p.restOnMeterRatio ?? fallback)
      : (this.p.restOffMeterRatio ?? fallback);
    return this._clamp(ratio, 0, 0.95);
  }

  _gapFraction(intervalFromPrev, isMotifEnd) {
    const p = this.p;
    const minGap = Math.min(p.gapMin ?? 0.15, p.gapMax ?? 0.15);
    const maxGap = Math.max(p.gapMin ?? 0.15, p.gapMax ?? 0.15);
    let gap = 0;

    if (this.rng.next() < (p.gapProb ?? 1)) {
      const distanceNorm = Math.max(0, Math.min(1, intervalFromPrev / Math.max(1, p.intervalRange ?? 12)));
      const evenGap = (minGap + maxGap) / 2;
      const slopedGap = minGap + (maxGap - minGap) * distanceNorm;
      const slope = p.gapDistanceSlope ?? 0;
      gap = evenGap * (1 - slope) + slopedGap * slope;
      const timingRange = p.gapTimingRange ?? 0;
      if (timingRange > 0) {
        // Triangular jitter: many small deviations, occasional larger ones.
        gap += (this.rng.next() + this.rng.next() - 1) * timingRange;
      }
    }
    if (isMotifEnd) gap = Math.max(gap, p.phraseGap ?? minGap);
    return Math.max(-0.92, Math.min(0.92, gap));
  }

  _slideDuration(divSec, gapFraction) {
    const speed = this._clamp(this.p.slideSpeed ?? 0.65, 0, 1);
    const depth = this._clamp(Math.abs(gapFraction || 0) / 0.8, 0, 1);
    const slotFraction = (0.04 + (1 - speed) * 0.46) * (0.75 + depth * 0.5);
    return Math.max(0.006, Math.min(divSec * 0.6, divSec * slotFraction));
  }

  /**
   * Pick next note with root-pull and register biases applied.
   * @param {number} current   Current degree
   * @param {number} phrasePos 0..1 position within motif
   */
  _pickBiasedNote(current, phrasePos, prevDir = 0, prevDurationDivs = null) {
    const { scale, rng, p } = this;
    const peakedness = p.intervalPeakedness;
    const maxRange = p.intervalRange;

    // Build candidate pool in scale-degree steps, not chromatic/EDO units.
    const candidates = [];
    const center = scale.nearest(current);
    for (let step = -maxRange; step <= maxRange; step++) {
      const target = scale.stepFrom(center, step);
      const stepDist = Math.abs(step);

      // Base weight: interval-shape distribution over scale-degree distance.
      // RANGE sets the spread (edge = ±3σ); SHAPE blends uniform→Gaussian.
      const w = intervalShapeWeight(stepDist, peakedness, maxRange);
      // Sub-scale bonus
      const subBonus = scale.sub.includes(scale.norm(target)) ? scale.weight : (1 - scale.weight);

      // Register weight: a flat-topped window, NOT a peak. Inside the register
      // every degree is essentially equally likely, so there is no pull toward
      // the exact centre and no extra likelihood of repeating the centre note.
      // The weight only falls off past the register edge. Skew widens one side.
      // Narrow registers collapse the plateau toward the centre, so a centre
      // pull is only perceptible at the extreme of narrow widths.
      let regW = 1.0;
      const regCenter = p.registerCenter ?? 0;
      const regWidth = p.registerWidth ?? 12;
      const regSkew = p.registerSkew ?? 0;
      if (regWidth > 0 && regWidth < 100) {
        regW = Math.max(0.01, registerWindow(target - regCenter, regWidth, regSkew));
      }

      // Root pull weight
      let rootW = 1.0;
      const roots = p.rootNotes;
      const pullStrength = p.rootPullStrength ?? 0;
      const pullShape = p.rootPullShape ?? 0.7;
      if (roots && roots.length > 0 && pullStrength > 0) {
        const effectiveStrength = pullStrength * (1 - pullShape + pullShape * phrasePos);
        let bestRootDist = Infinity;
        for (let ro = -2; ro <= 2; ro++) {
          const rootDeg = this._currentRootTarget + ro * scale.div;
          bestRootDist = Math.min(bestRootDist, scale.stepDistance(target, rootDeg));
        }
        const currentRootDist = this._distToRoot(current);
        const newRootDist = bestRootDist;
        if (newRootDist < currentRootDist) {
          rootW = 1.0 + effectiveStrength * 3.0 * (1 - newRootDist / Math.max(1, currentRootDist));
        } else if (newRootDist > currentRootDist) {
          rootW = Math.max(0.05, 1.0 - effectiveStrength * 0.7);
        }
      }

      candidates.push({ degree: target, dir: Math.sign(step), prob: w * subBonus * regW * rootW });
    }
    if (candidates.length === 0) return current;

    // ── Momentum ────────────────────────────────────────────────
    // Bias the next move to continue in the same direction as the
    // previous shift. Strength depends on how recently the previous
    // change happened in MUSICAL time (note divisions, tempo-agnostic):
    // the shorter the note just played, the stronger the carry-over.
    // The continuation probability is capped at 80%, reached only for
    // maximally-subdivided (1-division) notes near the register centre.
    // As a note travels toward the register edge in the momentum
    // direction, the carry-over fades so the natural register pull can
    // reverse the line before it escapes the comfortable range.
    const momentum = p.momentum ?? 0;
    if (momentum > 0 && prevDir !== 0 && prevDurationDivs != null) {
      // Shorter notes → stronger momentum. 1 division = full strength.
      const durFactor = 1 / Math.max(1, prevDurationDivs);
      // Edge attenuation: only when moving further toward the extreme.
      const regCenter = p.registerCenter ?? 0;
      const regWidth = p.registerWidth ?? 12;
      const regSkew = p.registerSkew ?? 0;
      const offset = current - regCenter;
      let edgeAtten = 1;
      const movingOutward = (prevDir > 0 && offset > 0) || (prevDir < 0 && offset < 0);
      if (movingOutward && regWidth > 0 && regWidth < 100) {
        edgeAtten = Math.max(0, Math.min(1, registerWindow(offset, regWidth, regSkew)));
      }
      const effMom = Math.max(0, Math.min(1, momentum * durFactor * edgeAtten));
      if (effMom > 0) {
        let sameTotal = 0, otherTotal = 0;
        for (const c of candidates) {
          if (c.dir === prevDir) sameTotal += c.prob; else otherTotal += c.prob;
        }
        const grand = sameTotal + otherTotal;
        if (grand > 0 && sameTotal > 0 && otherTotal > 0) {
          const basePsame = sameTotal / grand;
          // Push P(same direction) from its base value up toward 0.8.
          const targetPsame = Math.max(
            basePsame,
            basePsame + (0.8 - basePsame) * effMom
          );
          const factorSame = targetPsame / basePsame;
          const factorOther = (1 - targetPsame) / (1 - basePsame);
          for (const c of candidates) {
            c.prob *= (c.dir === prevDir) ? factorSame : factorOther;
          }
        }
      }
    }

    // Normalise and sample
    const total = candidates.reduce((s, c) => s + c.prob, 0);
    let r = rng.next() * total;
    for (const c of candidates) {
      r -= c.prob;
      if (r <= 0) return c.degree;
    }
    return candidates[candidates.length - 1].degree;
  }

  /**
   * Surprisal (-log2 p) of arriving at `toDegree` from `fromDegree` under the
   * STATIC melodic prior: interval shape × sub-scale bonus × register window ×
   * root pull, momentum excluded. This is the same weighting `_pickBiasedNote`
   * samples from, evaluated as a distribution so every sounded note — freshly
   * generated, replayed from the repertoire, or surprise-displaced — gets an
   * expectancy score under the listener-facing melodic model.
   * Returns bits, capped at 20 (for realised pitches outside the prior's
   * support, e.g. large surprise leaps).
   */
  _melodicPitchSurprisal(fromDegree, toDegree, phrasePos = 0) {
    if (fromDegree == null || toDegree == null) return null;
    const { scale, p } = this;
    const peakedness = p.intervalPeakedness;
    const maxRange = p.intervalRange;
    const center = scale.nearest(fromDegree);
    let total = 0;
    let chosen = 0;
    for (let step = -maxRange; step <= maxRange; step++) {
      const target = scale.stepFrom(center, step);
      const w = intervalShapeWeight(Math.abs(step), peakedness, maxRange);
      const subBonus = scale.sub.includes(scale.norm(target)) ? scale.weight : (1 - scale.weight);
      let regW = 1.0;
      const regWidth = p.registerWidth ?? 12;
      if (regWidth > 0 && regWidth < 100) {
        regW = Math.max(0.01, registerWindow(target - (p.registerCenter ?? 0), regWidth, p.registerSkew ?? 0));
      }
      let rootW = 1.0;
      const pullStrength = p.rootPullStrength ?? 0;
      if ((p.rootNotes || []).length > 0 && pullStrength > 0) {
        const effectiveStrength = pullStrength * (1 - (p.rootPullShape ?? 0.7) + (p.rootPullShape ?? 0.7) * phrasePos);
        let bestRootDist = Infinity;
        for (let ro = -2; ro <= 2; ro++) {
          bestRootDist = Math.min(bestRootDist, scale.stepDistance(target, this._currentRootTarget + ro * scale.div));
        }
        const currentRootDist = this._distToRoot(fromDegree);
        if (bestRootDist < currentRootDist) {
          rootW = 1.0 + effectiveStrength * 3.0 * (1 - bestRootDist / Math.max(1, currentRootDist));
        } else if (bestRootDist > currentRootDist) {
          rootW = Math.max(0.05, 1.0 - effectiveStrength * 0.7);
        }
      }
      const prob = w * subBonus * regW * rootW;
      total += prob;
      if (target === toDegree) chosen += prob;
    }
    if (total <= 0) return 20;
    const prob = chosen / total;
    if (prob <= 0) return 20;
    return Math.min(20, -Math.log2(prob));
  }

  /** Per-note metrics bookkeeping; called once per generated note. */
  _recordNoteMetrics(note, ctx) {
    const m = this._metrics;
    if (!m) return;
    m.notes++;
    if (note.isRest) m.rests++;
    if (note.isSurprise) m.surpriseNotes++;
    if (ctx.isSurpriseStart) m.surpriseStarts++;
    if (note.noteRole === "accuracy") m.repeatNotes++;
    m.musicalSeconds += ctx.gridDuration;
    if (note.isMotifStart) {
      m.motifPassCounts[note.motifIndex] = (m.motifPassCounts[note.motifIndex] || 0) + 1;
    }
    if (ctx.pitchBits != null) {
      m.pitchBits += ctx.pitchBits;
      m.pitchBitsSq += ctx.pitchBits * ctx.pitchBits;
      m.pitchBitsN++;
    }
    if (ctx.dynBits != null) { m.dynBits += ctx.dynBits; m.dynBitsN++; }
    if (ctx.restBits != null) m.restBits += ctx.restBits;
    if (note.formantDistance != null) {
      m.formantDist = (m.formantDist || 0) + note.formantDistance;
      m.formantDistN = (m.formantDistN || 0) + 1;
    }
    // Pitch+duration bigram novelty within this performance
    if (ctx.prevDegree != null) {
      const key = `${ctx.prevDegree}>${note.degree}|${note.durationDivs}`;
      m.bigramEvents++;
      if (!m.bigramSeen.has(key)) { m.bigramSeen.add(key); m.novelBigrams++; }
    }
  }

  /**
   * Performance-level summary of the expectation/surprise/repetition metrics
   * accumulated since initialise(). Joinable to ratings via stimulus_id.
   */
  getMetricsSummary() {
    const m = this._metrics;
    if (!m || m.notes === 0) return null;
    const meanPitch = m.pitchBitsN ? m.pitchBits / m.pitchBitsN : null;
    const passCounts = Object.values(m.motifPassCounts);
    return {
      schema_version: "metrics-1.0",
      notes: m.notes,
      rests: m.rests,
      mean_pitch_surprisal_bits: meanPitch,
      sd_pitch_surprisal_bits: m.pitchBitsN > 1
        ? Math.sqrt(Math.max(0, m.pitchBitsSq / m.pitchBitsN - meanPitch * meanPitch))
        : null,
      info_rate_bits_per_s: m.musicalSeconds > 0 ? m.pitchBits / m.musicalSeconds : null,
      surprise_note_rate: m.surpriseNotes / m.notes,
      surprise_starts: m.surpriseStarts,
      repetition_ratio: m.repeatNotes / m.notes,
      bigram_novelty_ratio: m.bigramEvents ? m.novelBigrams / m.bigramEvents : null,
      mean_dynamics_surprisal_bits: m.dynBitsN ? m.dynBits / m.dynBitsN : null,
      mean_rest_surprisal_bits: m.notes ? m.restBits / m.notes : null,
      mean_formant_deviation_loghz: m.formantDistN ? m.formantDist / m.formantDistN : null,
      motif_passes: passCounts.reduce((s, c) => s + c, 0),
      max_motif_reuse: passCounts.length ? Math.max(...passCounts) : 0,
      incorporated_variants: this.repertoire ? this.repertoire.size - this.repertoire.baseLen : 0,
      musical_seconds: m.musicalSeconds,
    };
  }

  /** Shortest distance from a degree to the current root target. */
  _distToRoot(degree) {
    const rootTarget = this._currentRootTarget;
    let best = Infinity;
    for (let ro = -2; ro <= 2; ro++) {
      best = Math.min(best, this.scale.stepDistance(degree, rootTarget + ro * this.scale.div));
    }
    return best;
  }

  /** Called when a note lands on or very near a root. */
  _handleRootArrival(degree) {
    const roots = this.p.rootNotes;
    if (!roots || roots.length <= 1) return; // single root = pendulum

    // With multiple roots, sometimes switch to another root
    const others = roots.filter(r => r !== this._currentRootTarget);
    if (others.length > 0 && this.rng.next() < 0.6) {
      this._currentRootTarget = this.rng.pick(others);
    }
  }

  _generateMotifRhythm(totalDivs) {
    const onsets = [0]; // first note always at division 0
    const beatDiv = this.p.beatDivisions || 1;
    let prevLen = null;

    for (let d = 1; d < totalDivs; d++) {
      const isOnBeat = d % beatDiv === 0;
      let prob = isOnBeat ? (this.p.onBeatProb ?? 0.8) : (this.p.offBeatProb ?? 0.2);

      // Same-length boost
      if (prevLen !== null) {
        const curLen = d - onsets[onsets.length - 1];
        if (curLen === prevLen) {
          prob = prob + (1 - prob) * (this.p.sameLengthProb ?? 0.4);
        }
      }

      if (this.rng.next() < prob) {
        prevLen = d - onsets[onsets.length - 1];
        onsets.push(d);
      }
    }

    const result = [];
    for (let i = 0; i < onsets.length; i++) {
      const end = (i + 1 < onsets.length) ? onsets[i + 1] : totalDivs;
      result.push({ startDiv: onsets[i], durationDivs: end - onsets[i] });
    }
    return result;
  }

  /**
   * Deterministic arp note set (owner brief P1): scale degrees at a fixed
   * stride from the root nearest the register centre, spanning arpOctaves.
   * "Doesn't need to change chord, just go up and down over the same
   * interval notes" — the set is stable; rhythm/rests/dynamics/surprise
   * machinery run unchanged on top.
   */
  _arpSequence() {
    const p = this.p;
    const stride = Math.max(1, Math.round(p.arpStep ?? 2));
    const octaves = Math.max(1, Math.min(3, Math.round(p.arpOctaves ?? 1)));
    const div = this.scale.div;
    const roots = (Array.isArray(p.rootNotes) && p.rootNotes.length) ? p.rootNotes : [0];
    const center = Math.round(p.registerCenter ?? 0);
    const anchor = this.scale.nearest(roots[0] + Math.round((center - roots[0]) / div) * div);
    const up = [anchor];
    let d = anchor;
    for (let guard = 0; guard < 64; guard++) {
      d = this.scale.stepFrom(d, stride);
      if (d - anchor > octaves * div + 0.001) break;
      up.push(d);
    }
    if (up.length < 2) up.push(this.scale.stepFrom(anchor, stride));
    const pattern = p.melodyPattern || "walk";
    if (pattern === "arpDown") return up.slice().reverse();
    if (pattern === "arpUpDown") return up.concat(up.slice(1, -1).reverse());
    return up;
  }

  _generateMotif() {
    const beatDiv = this.p.beatDivisions || 1;
    const motifBeats = this.p.motifLengthBeats || this.p.motifLength || 4;
    const totalDivs = motifBeats * beatDiv;
    const rhythm = this._generateMotifRhythm(totalDivs);

    const pattern = this.p.melodyPattern || "walk";
    const arpSeq = pattern !== "walk" ? this._arpSequence() : null;
    if (arpSeq && !Number.isFinite(this._arpPos)) this._arpPos = 0;

    const notes = [];
    let deg = arpSeq ? arpSeq[this._arpPos % arpSeq.length]
      : (this._currentDegree || this.scale.pickNote(this.rng));
    if (arpSeq) this._arpPos++;
    let fmt = this._pickFormant();
    // Momentum state: direction of the most recent completed move, carried
    // across notes (and across motifs via this._lastDir).
    let prevDir = this._lastDir || 0;

    for (let i = 0; i < rhythm.length; i++) {
      const phrasePos = rhythm.length > 1 ? i / (rhythm.length - 1) : 0;
      if (i > 0 && arpSeq) {
        // Arp: the cycle is the melody — deterministic, seeded phase.
        const before = deg;
        deg = arpSeq[this._arpPos % arpSeq.length];
        this._arpPos++;
        if (deg !== before) prevDir = Math.sign(deg - before);
      } else if (i > 0) {
        // The previous note's duration sets how recently the prior shift
        // happened (in tempo-agnostic divisions); shorter = stronger pull.
        const prevDur = rhythm[i - 1].durationDivs;
        const before = deg;
        deg = this._pickBiasedNote(deg, phrasePos, prevDir, prevDur);
        if (deg !== before) prevDir = Math.sign(deg - before);
      }
      // Check if we landed on a root
      if (this._distToRoot(deg) <= 1) {
        this._handleRootArrival(deg);
      }
      if (this.rng.next() < this.p.formantChangeProb) {
        fmt = this._pickFormant(fmt);
      }
      notes.push({
        degree: deg,
        formant: fmt,
        startDiv: rhythm[i].startDiv,
        durationDivs: rhythm[i].durationDivs,
      });
    }
    this._currentDegree = deg;
    this._lastDir = prevDir;
    return new Motif(notes);
  }

  // The dimensions surprise may draw from — empty means surprise is OFF.
  // No rng: safe as a pure gate.
  _surpriseCandidates() {
    return [
      { key: "pitch", enabled: this.p.surprisePitchEnabled ?? (this.p.surpriseDimensions || ["pitch"]).includes("pitch"), weight: this.p.surprisePitchWeight ?? 1 },
      { key: "tuning", enabled: this.p.surpriseTuningEnabled ?? (this.p.surpriseDimensions || []).includes("tuning"), weight: this.p.surpriseTuningWeight ?? 0.45 },
      { key: "rhythm", enabled: this.p.surpriseRhythmEnabled ?? (this.p.surpriseDimensions || []).includes("rhythm"), weight: this.p.surpriseRhythmWeight ?? 0.45 },
      { key: "formant", enabled: this.p.surpriseFormantEnabled ?? (this.p.surpriseDimensions || []).includes("formant"), weight: this.p.surpriseFormantWeight ?? 0.45 },
      { key: "dynamics", enabled: this.p.surpriseDynamicsEnabled ?? (this.p.surpriseDimensions || []).includes("dynamics"), weight: this.p.surpriseDynamicsWeight ?? 0.35 },
      { key: "rest", enabled: this.p.surpriseRestEnabled ?? (this.p.surpriseDimensions || []).includes("rest"), weight: this.p.surpriseRestWeight ?? 0.2 },
    ].filter(item => item.enabled && item.weight > 0);
  }

  _surpriseDimsActive() {
    return this._surpriseCandidates().length > 0;
  }

  _endOfMotif() {
    if ((this.p.melodyPattern || "walk") !== "walk") return; // arp: no surprises
    if (!this._surpriseDimsActive()) return;
    // Motif-level surprise: create a variant motif and incorporate it
    if (this.rng.next() < this.p.motifSurpriseProb && this._canBakeSurprise()) {
      const srcIdx = this.rng.int(0, Math.min(this.repertoire.size, this.repertoire.baseLen));
      const src = this.repertoire.motifs[srcIdx];
      const pos = this.rng.int(0, src.notes.length);
      const surprise = this._surpriseNote(src.notes[pos], this._chooseSurpriseFeatures());
      const variant = src.variant(pos, surprise);
      this.repertoire.incorporate(variant, this.repertoire.baseIndexFor(srcIdx), this._maxBakedSurprises());
    }
  }

  _startMotifPass() {
    // First presentation of a motif = "generation" (new material); any later
    // pass over the same motif = "accuracy" (replication). Drives marker colour.
    if (!this._seenMotifs) this._seenMotifs = new Set();
    this._motifFirstPass = !this._seenMotifs.has(this._motifIdx);
    this._seenMotifs.add(this._motifIdx);
    this._motifSurprisePlan = null;
    this._activeSurpriseProjection = null;
    // Arp patterns are deterministic by contract (owner 2026-07-07):
    // surprise applies only to the walk melody.
    if ((this.p.melodyPattern || "walk") !== "walk") return;
    if (!this._surpriseDimsActive()) return;
    const probability = this._clamp01(this.p.surpriseProb ?? 0);
    if (!this._motif || this._motif.notes.length === 0) return;
    if (this.rng.next() < probability) {
      this._motifSurprisePlan = {
        position: this.rng.int(0, this._motif.notes.length),
      };
    }
  }

  _buildSurpriseProjection(startIndex) {
    const original = this._motif.notes;
    const features = this._chooseSurpriseFeatures();
    const notes = original.map(n => ({ ...n }));
    notes[startIndex] = { ...notes[startIndex], ...this._surpriseNote(notes[startIndex], features) };

    let projectedDegree = notes[startIndex].degree;
    let projectedFormant = notes[startIndex].formant || this._currentFormant;
    let projDir = (startIndex > 0)
      ? Math.sign(notes[startIndex].degree - (original[startIndex - 1]?.degree ?? notes[startIndex].degree))
      : 0;
    for (let i = startIndex + 1; i < notes.length; i++) {
      const phrasePos = notes.length > 1 ? i / (notes.length - 1) : 0;
      notes[i] = { ...original[i] };
      if (features.includes("pitch")) {
        const prevDur = notes[i - 1].durationDivs;
        const before = projectedDegree;
        projectedDegree = this._pickBiasedNote(projectedDegree, phrasePos, projDir, prevDur);
        if (projectedDegree !== before) projDir = Math.sign(projectedDegree - before);
        notes[i].degree = projectedDegree;
      }
      if (features.includes("formant")) {
        if (this.rng.next() < (this.p.formantChangeProb ?? 0.05)) {
          projectedFormant = this._pickFormant(projectedFormant);
        }
        notes[i].formant = projectedFormant;
      }
    }

    const snapBackIndex = this._findSnapBackIndex(original, notes, startIndex, features);
    for (let i = snapBackIndex; i < notes.length; i++) notes[i] = { ...original[i] };
    return { startIndex, snapBackIndex, features, notes };
  }

  _findSnapBackIndex(original, projected, startIndex, features) {
    let originalStart = 0;
    let projectedStart = 0;
    const originalStarts = original.map(note => {
      const start = originalStart;
      originalStart += note.durationDivs || 1;
      return start;
    });
    const projectedStarts = projected.map(note => {
      const start = projectedStart;
      projectedStart += note.durationDivs || 1;
      return start;
    });

    for (let i = startIndex + 1; i < original.length; i++) {
      if (features.includes("rhythm") && originalStarts[i] !== projectedStarts[i]) continue;
      if (this._projectionMatchesOriginal(original[i], projected[i], features)) return i;
    }
    return original.length;
  }

  _projectionMatchesOriginal(original, projected, features) {
    if (features.includes("pitch")) {
      const tolerance = Math.max(1, Math.round(this.p.motifHitRange ?? 1));
      if (this.scale.stepDistance(original.degree, projected.degree) > tolerance) return false;
    }
    if (features.includes("tuning")) {
      const tolerance = Math.max(1, Number(this.p.precisionRange ?? 12));
      const o = original.tuningOverrideCents ?? 0;
      const p = projected.tuningOverrideCents ?? 0;
      if (Math.abs(o - p) > tolerance) return false;
    }
    if (features.includes("formant") && original.formant !== projected.formant) return false;
    if (features.includes("rhythm") && (original.durationDivs || 1) !== (projected.durationDivs || 1)) return false;
    if (features.includes("rest") && !!original.isRest !== !!projected.isRest) return false;
    if (features.includes("dynamics")) {
      const o = original.velocityOverride ?? 0.62;
      const p = projected.velocityOverride ?? 0.62;
      if (Math.abs(o - p) > 0.15) return false;
    }
    return true;
  }

  _maybeBakeSurprise(note) {
    if (!this.repertoire) return false;
    if (this.rng.next() >= this._clamp01(this.p.incorporationRate ?? 0)) return false;
    if (!this._canBakeSurprise()) return false;
    const replacedBase = this.repertoire.baseIndexFor(this._motifIdx);
    const variant = this._motif.variant(this._noteIdx, note);
    return this.repertoire.incorporate(variant, replacedBase, this._maxBakedSurprises());
  }

  _maybeBakeProjectedSurprise(projection) {
    if (!this.repertoire || !projection) return false;
    if (this.rng.next() >= this._clamp01(this.p.incorporationRate ?? 0)) return false;
    if (!this._canBakeSurprise()) return false;
    const replacedBase = this.repertoire.baseIndexFor(this._motifIdx);
    const variantNotes = this._motif.notes.map((note, i) => (
      i >= projection.startIndex && i < projection.snapBackIndex
        ? { ...projection.notes[i] }
        : { ...note }
    ));
    return this.repertoire.incorporate(new Motif(variantNotes), replacedBase, this._maxBakedSurprises());
  }

  _canBakeSurprise() {
    return !!this.repertoire && this.repertoire.canIncorporate(this._maxBakedSurprises());
  }

  _maxBakedSurprises() {
    const raw = this.p.surpriseMaxBaked;
    if (raw === undefined || raw === null || raw === "" || raw === Infinity || raw === "Infinity") {
      return Infinity;
    }
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) ? Math.max(0, n) : Infinity;
  }

  _clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  _pickFormant(exclude = null) {
    const active = (this.p.activeFormants || ["ah"]).filter(f => f !== exclude);
    const formants = active.length > 0 ? active : (this.p.activeFormants || ["ah"]);
    const weights = this.p.formantWeights || {};
    const total = formants.reduce((sum, f) => sum + Math.max(0.001, Number(weights[f] ?? 1)), 0);
    let r = this.rng.next() * total;
    for (const f of formants) {
      r -= Math.max(0.001, Number(weights[f] ?? 1));
      if (r <= 0) return f;
    }
    return formants[formants.length - 1] || "ah";
  }

  _formantMapValue(mapKey, allKey, formant, fallback, integer = false) {
    const map = this.p[mapKey] || {};
    let value = Number(map[formant] ?? this.p[allKey] ?? fallback);
    if (!Number.isFinite(value)) value = fallback;
    return integer ? Math.round(value) : value;
  }

  /**
   * Formant-accuracy miss as a displacement in 2D vowel space. On a hit the
   * point is unchanged; on a miss it moves in a uniformly random direction by
   * up to `range` legacy steps (1 step ≈ mean adjacent-vowel distance),
   * clamped to the vowel region. At extreme vowels the reachable directions
   * simply fan inward — the distribution never collapses to one side.
   */
  _formantAccuracyPos(formant, basePos) {
    const base = FORMANT_PRESETS[formant] ? formant : "ah";
    const pos = basePos || vowelPointFor(base);
    const accuracy = this._clamp01(this._formantMapValue("formantAccuracyByFormant", "formantAccuracy", base, 0.85));
    if (this.rng.next() <= accuracy) return { ...pos };
    const half = (FORMANT_ORDER.filter(f => FORMANT_PRESETS[f]).length || 5) / 2;
    const range = Math.max(0, Math.min(half, this._formantMapValue("formantRangeByFormant", "formantAccuracyRange", base, 1)));
    if (range <= 0) return { ...pos };
    const mag = range * VOWEL_STEP_UNIT * this.rng.next();
    const theta = this.rng.next() * Math.PI * 2;
    return clampToVowelRegion({ x: pos.x + Math.cos(theta) * mag, y: pos.y + Math.sin(theta) * mag });
  }

  /**
   * Surprise vowel: displace the base landmark by `distance` (0..1 of the
   * widest landmark separation) in a random direction. Returns the realised
   * point plus the nearest landmark name for tracking/UI.
   */
  _pickSurpriseFormant(formant) {
    const base = FORMANT_PRESETS[formant] ? formant : "ah";
    const distance = this._clamp01(this._formantMapValue("surpriseFormantDistanceByFormant", "surpriseFormantDistance", base, 0.85));
    const mag = Math.max(0.35 * VOWEL_STEP_UNIT, distance * VOWEL_MAX_DIST);
    const from = vowelPointFor(base);
    const theta = this.rng.next() * Math.PI * 2;
    const pos = clampToVowelRegion({ x: from.x + Math.cos(theta) * mag, y: from.y + Math.sin(theta) * mag });
    return { name: nearestVowel(pos), pos };
  }

  _pickVelocity() {
    // Loudness register (analogue of the melodic register): the CENTRE is where
    // loudness settles; the RANGE sets the soft/loud limits (± half the range).
    // It is independent of accuracy (reproduction fidelity) and of generation
    // variability — it only bounds where the loudness can sit.
    const center = this._clamp(Number(this.p.dynamicsLevel ?? 0.62), 0.05, 1);
    const regRange = Math.max(0, Number(this.p.loudnessRange ?? 0.6));
    const half = regRange / 2;
    const lo = this._clamp(center - half, 0.02, 1);
    const hi = this._clamp(center + half, 0.02, 1);
    // Accuracy: probability the dynamic is reproduced exactly at the centre.
    const precision = this._clamp01(this.p.dynamicsPrecision ?? 0.75);
    if (this.rng.next() <= precision) return center;
    // Generation: how variable the loudness is from one note to the next.
    const range = Math.max(0, Number(this.p.dynamicsRange ?? 0.22));
    const deviation = (this.rng.next() + this.rng.next() - 1) * range;
    // Clamp into the register's soft/loud limits.
    return this._clamp(center + deviation, lo, hi);
  }

  _chooseSurpriseFeatures() {
    const candidates = this._surpriseCandidates();
    if (candidates.length === 0) return []; // every dimension off = surprise off

    const pickOne = (pool) => {
      const total = pool.reduce((sum, item) => sum + Math.max(0.001, item.weight), 0);
      let r = this.rng.next() * total;
      for (const item of pool) {
        r -= Math.max(0.001, item.weight);
        if (r <= 0) return item.key;
      }
      return pool[pool.length - 1].key;
    };

    const chosen = [pickOne(candidates)];
    if (this.p.surpriseAllowMultiple) {
      for (const item of candidates) {
        if (!chosen.includes(item.key) && this.rng.next() < this._clamp01(item.weight) * 0.75) {
          chosen.push(item.key);
        }
      }
    }
    return chosen;
  }

  _surpriseNote(expected, dims = null) {
    dims = dims || this._chooseSurpriseFeatures();
    const out = { degree: expected.degree, formant: expected.formant };

    if (dims.includes("pitch")) {
      const dir = this.rng.next() < 0.5 ? -1 : 1;
      const minStep = Math.max(2, Math.round((this.p.motifHitRange ?? 1) + 1));
      const distance = this._clamp01(this.p.surprisePitchDistance ?? 1);
      const maxStep = Math.max(minStep + 1, Math.round(minStep + ((this.p.intervalRange ?? 7) + 2 - minStep) * distance));
      const steps = dir * this.rng.int(minStep, maxStep + 1);
      out.degree = this.scale.stepFrom(expected.degree, steps);
    }
    if (dims.includes("tuning")) {
      const range = Math.max(2, Number(this.p.precisionRange ?? 12));
      const distance = this._clamp01(this.p.surpriseTuningDistance ?? 0.9);
      const cents = Math.max(1, range * (0.35 + distance * 1.65));
      out.tuningOverrideCents = cents * (this.rng.next() < 0.5 ? -1 : 1);
    }
    if (dims.includes("formant")) {
      const surpriseVowel = this._pickSurpriseFormant(expected.formant);
      out.formant = surpriseVowel.name;
      out.formantPos = surpriseVowel.pos;
    }
    if (dims.includes("rhythm")) {
      // Double or halve the note duration
      const dur = expected.durationDivs || 1;
      const distance = this._clamp01(this.p.surpriseRhythmDistance ?? 0.8);
      const mult = distance > 0.66 ? 3 : 2;
      out.durationDivs = this.rng.next() < 0.5
        ? Math.max(1, Math.floor(dur / 2))
        : Math.min(dur * mult, (this.p.motifLengthBeats || 4) * (this.p.beatDivisions || 1));
      out._rhythmOverride = true;
    }
    if (dims.includes("rest")) {
      // Replace note with silence
      out.isRest = true;
    }
    if (dims.includes("dynamics")) {
      const center = this._clamp(Number(this.p.dynamicsLevel ?? 0.62), 0.05, 1);
      const distance = this._clamp01(this.p.surpriseDynamicsDistance ?? 0.85);
      const span = 0.18 + distance * 0.58;
      out.velocityOverride = this.rng.next() < 0.5
        ? this._clamp(center - span, 0.02, 1)
        : this._clamp(center + span, 0.02, 1);
    }
    return out;
  }
}

// ─── Web Audio synthesis engine ─────────────────────────────

export class SynthEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._dryGain = null;
    this._wetGain = null;
    this._preDelay = null;
    this._convolver = null;
    this._reverbTone = null;
    this.analyser = null;
    this.playing = false;
    this._nodes = [];
    this._timer = null;
    this._engine = null;
    this._nextTime = 0;
    this._voiceMode = "formant"; // "formant", "fourier", or legacy oscillator mode
    this._reverbKey = "";
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = 5.5;
    this._vibratoCycleDepth = 0;
    this._bowNoiseImpulseCache = new WeakMap();
    this._surpriseCount = 0;
    this._lastSurpriseAt = 0;
    this._timeline = [];   // ring buffer of scheduled note events (for visualisers)
    this._masterOut = null;
    this._limiter = null;
    this._masterVolume = 1.0;  // linear; 1.0 == 0 dB user level
    this._limiterOn = true;
  }

  /**
   * Build the audio graph. Pass a shared AudioContext + destination to run
   * this engine as one voice among several (producer mode: every track
   * voice shares the page's context and feeds a common bus) — omit both
   * for the default standalone behaviour.
   */
  init(sharedCtx = null, destination = null) {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = sharedCtx || new C();
    this._dest = destination || this.ctx.destination;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this._dryGain = this.ctx.createGain();
    this._wetGain = this.ctx.createGain();
    this._preDelay = this.ctx.createDelay(0.25);
    this._convolver = this.ctx.createConvolver();
    this._reverbTone = this.ctx.createBiquadFilter();
    this._reverbTone.type = "lowpass";
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.82;

    // Master output fader + tone shaping + soft clip + brick-wall limiter
    // (post-analyser → destination). The gentle EQ tames sawtooth harshness
    // and sub-sonic rumble; the tanh soft clipper rounds transients off
    // BEFORE the hard limiter so the limiter rarely slams.
    this._masterOut = this.ctx.createGain();
    this._masterOut.gain.value = this._masterVolume;
    this._masterHP = this.ctx.createBiquadFilter();
    this._masterHP.type = "highpass";
    this._masterHP.frequency.value = 28;
    this._masterHP.Q.value = 0.71;
    this._masterShelf = this.ctx.createBiquadFilter();
    this._masterShelf.type = "highshelf";
    this._masterShelf.frequency.value = 9500;
    this._masterShelf.gain.value = -2.5;
    this._softClip = this.ctx.createWaveShaper();
    this._softClip.oversample = "2x";
    const CLIP_N = 1024, drive = 2;
    const curve = new Float32Array(CLIP_N);
    for (let i = 0; i < CLIP_N; i++) {
      const x = (i / (CLIP_N - 1)) * 2 - 1;
      curve[i] = Math.tanh(drive * x) / Math.tanh(drive);
    }
    this._softClip.curve = curve;
    this._panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (this._panner) this._panner.pan.value = this._panValue || 0;
    this._limiter = this.ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -1.5;
    this._limiter.knee.value = 0;
    this._limiter.ratio.value = 20;
    this._limiter.attack.value = 0.003;
    this._limiter.release.value = 0.12;

    // SPACE positioning (direct path only — the reverb stays diffuse, so
    // walking away naturally trades direct sound for room): proximity
    // bass shelf → air-absorption lowpass → arrival delay → explicit
    // binaural head (Q4): per-ear delay + far-ear shadow (gain + lowpass)
    // → pinna shelf/notch (behind cue) → 1/r distance gain. The opaque
    // HRTF PannerNode is gone so ear distance and head density can be
    // real, testable knobs and the field extends behind the listener.
    this._spaceProximity = this.ctx.createBiquadFilter();
    this._spaceProximity.type = "lowshelf";
    this._spaceProximity.frequency.value = 180;
    this._spaceProximity.gain.value = 0;
    this._spaceAir = this.ctx.createBiquadFilter();
    this._spaceAir.type = "lowpass";
    this._spaceAir.frequency.value = 20000;
    this._spaceAir.Q.value = 0.5;
    this._spaceDelay = this.ctx.createDelay(0.12);
    this._earDelayL = this.ctx.createDelay(0.005);
    this._earDelayR = this.ctx.createDelay(0.005);
    this._earShadowL = this.ctx.createGain();
    this._earShadowR = this.ctx.createGain();
    // Brown-Duda head shadow: a high shelf per ear at f0 = c/(2πa) —
    // lows diffract (unity), highs shadow/boost by 20·log10 α(θ)
    this._earFilterL = this.ctx.createBiquadFilter();
    this._earFilterL.type = "highshelf";
    this._earFilterL.frequency.value = headShadowFreq(0.175);
    this._earFilterL.gain.value = 0;
    this._earFilterR = this.ctx.createBiquadFilter();
    this._earFilterR.type = "highshelf";
    this._earFilterR.frequency.value = headShadowFreq(0.175);
    this._earFilterR.gain.value = 0;
    this._earMerger = this.ctx.createChannelMerger(2);
    // Shaw/Blauert pinna cue: flange shadowing of the highs (shelf ≥8 kHz)
    // + loss of the ~4.3 kHz concha gain for sources behind
    this._pinnaShelf = this.ctx.createBiquadFilter();
    this._pinnaShelf.type = "highshelf";
    this._pinnaShelf.frequency.value = 8000;
    this._pinnaShelf.gain.value = 0;
    this._pinnaNotch = this.ctx.createBiquadFilter();
    this._pinnaNotch.type = "peaking";
    this._pinnaNotch.frequency.value = 4300;
    this._pinnaNotch.Q.value = 2;
    this._pinnaNotch.gain.value = 0;
    this._spaceDistGain = this.ctx.createGain();
    this._spaceDistGain.gain.value = spaceDistanceGain(2.5);
    // Measured-HRIR binaural path (owner 07-07 route 2): a parallel to the
    // parametric ear filters, gated in when a `measured` ear model is
    // picked. Two mono convolvers (KEMAR left/right IR for the current
    // azimuth) drive the two output channels; distance colour (proximity,
    // air) still happens BEFORE, distance gain AFTER, exactly as the
    // parametric path — only the DIRECTION cue swaps from model to
    // measurement, so an A/B compares like with like.
    this._hrirConvL = this.ctx.createConvolver();
    this._hrirConvL.normalize = false;
    this._hrirConvR = this.ctx.createConvolver();
    this._hrirConvR.normalize = false;
    this._hrirMerger = this.ctx.createChannelMerger(2);
    this._paramBinGain = this.ctx.createGain(); // parametric path gate (default on)
    this._paramBinGain.gain.value = 1;
    this._hrirGain = this.ctx.createGain();      // measured path gate (default off)
    this._hrirGain.gain.value = 0;
    this._hrirAz = null;   // last azimuth bucket loaded into the convolvers
    this._hrirReady = false;

    this.master.connect(this._spaceProximity);
    this._spaceProximity.connect(this._spaceAir);
    this._spaceAir.connect(this._spaceDelay);
    this._spaceDelay.connect(this._earDelayL);
    this._spaceDelay.connect(this._earDelayR);
    this._earDelayL.connect(this._earShadowL);
    this._earDelayR.connect(this._earShadowR);
    this._earShadowL.connect(this._earFilterL);
    this._earShadowR.connect(this._earFilterR);
    this._earFilterL.connect(this._earMerger, 0, 0);
    this._earFilterR.connect(this._earMerger, 0, 1);
    this._earMerger.connect(this._pinnaShelf);
    this._pinnaShelf.connect(this._pinnaNotch);
    this._pinnaNotch.connect(this._paramBinGain);
    this._paramBinGain.connect(this._spaceDistGain);
    // measured branch taps the same post-distance-colour signal
    this._spaceAir.connect(this._hrirConvL);
    this._spaceAir.connect(this._hrirConvR);
    this._hrirConvL.connect(this._hrirMerger, 0, 0);
    this._hrirConvR.connect(this._hrirMerger, 0, 1);
    this._hrirMerger.connect(this._hrirGain);
    this._hrirGain.connect(this._spaceDistGain);
    this._spaceDistGain.connect(this._dryGain);
    this._dryGain.connect(this.analyser);
    this.master.connect(this._preDelay);
    this._preDelay.connect(this._convolver);
    this._convolver.connect(this._reverbTone);
    this._reverbTone.connect(this._wetGain);
    this._wetGain.connect(this.analyser);
    this.analyser.connect(this._masterOut);
    this._masterOut.connect(this._masterHP);
    this._masterHP.connect(this._masterShelf);
    this._masterShelf.connect(this._softClip);
    this._limiter.connect(this._dest);
    this._applyLimiterRouting();

    // Effects stage (docs/EFFECTS_CONTRACT.md): the base voice sums into a
    // dedicated bus so its per-layer effects chain wraps ONLY the tonal voice.
    // Percussion feeds master directly (downstream of effects, undressed).
    // Empty chain ⇒ voiceBus passes straight through to master → SPACE.
    this._voiceBus = this.ctx.createGain();
    this._baseFxHost = createChainHost(this.ctx, this._voiceBus, this.master);

    // Percussion v2 (owner 2026-07-10): each percussion LAYER is its own sound
    // source with its own position, so hits route through per-layer spatial
    // chains built lazily in _renderPercLayerHit (id "__perc__<layerId>"). There
    // is no single shared percussion bus any more; the old 0.45 loudness trim is
    // folded into each hit (PERC_SAMPLE_TRIM / one-shot velocity).

    // Pre-generate noise buffer for percussion synthesis
    const sr = this.ctx.sampleRate;
    this._noiseBuffer = this.ctx.createBuffer(1, sr, sr);
    const nd = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
  }

  // A suspended context's clock is frozen, and some audio backends (notably
  // Windows) take much longer than mac to leave "suspended" — starting a
  // performance right away can swallow its first attack in the hardware
  // spin-up. Defer the actual start until the context is running; `playing`
  // flips immediately so the UI reads the intent, and a stop() (or a newer
  // play) before resume completes cancels the pending start.
  _startWhenRunning(startFn) {
    if (this.ctx.state !== "suspended") { startFn(); return; }
    const token = (this._resumeToken = (this._resumeToken || 0) + 1);
    this.playing = true;
    const go = () => { if (this._resumeToken === token && this.playing) startFn(); };
    this.ctx.resume().then(go, go);
  }

  /** Start playing with the given parameters. Resets the engine. */
  play(params) {
    this.init();
    this._startWhenRunning(() => this._playNow(params));
  }

  _playNow(params) {
    params = engineParams(params);
    this.stop();
    // stop() fades the master out; bring it back for the new performance.
    if (this._masterOut) {
      const now = this.ctx.currentTime;
      this._masterOut.gain.cancelScheduledValues(now);
      this._masterOut.gain.setTargetAtTime(this._masterVolume, now, 0.012);
    }

    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
    this._surpriseCount = 0;
    this._lastSurpriseAt = 0;
    this._timeline = [];
    this._configureReverb(params);
    this._percLayers = this._normalizePercLayers(params);
    this._percussionOnly = !!params.percussionOnly;
    this._engine = new GenerationEngine(params);
    this._engine.initialise();
    this._nextTime = this.ctx.currentTime + 0.05;
    this.playing = true;
    this._schedule();
  }

  /**
   * Offline span renderer for mixdown: deterministically generates and
   * schedules one region's notes from t0 for spanSec into the current
   * (typically Offline) AudioContext. Mirrors _schedule()'s timing exactly,
   * minus timers and visual bookkeeping. init(offlineCtx, dest) must have
   * been called first.
   */
  renderSpan(params, t0, spanSec, skipBeats = 0) {
    if (!this.ctx) return;
    params = engineParams(params);
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
    this._timeline = [];
    this._configureReverb(params);
    this._percLayers = this._normalizePercLayers(params);
    this._percussionOnly = !!params.percussionOnly;
    this._engine = new GenerationEngine(params);
    this._engine.initialise();
    // Producer v3 split support: skipBeats fast-forwards through the take
    // deterministically — the same seed generates the same stream, and we
    // begin sounding notes only once we pass the split point, so the later
    // half of a split region plays the LATER part of the same take.
    const skipSec = Math.max(0, skipBeats) * (60 / Math.max(30, params.tempo || 104));
    let t = t0 - skipSec;
    let guard = 0;
    while (t < t0 + spanSec && guard++ < 6000) {
      const note = this._engine.nextNote();
      if (!note) break;
      const beatDiv = note.beatDivisions || 1;
      const divSec = 60 / ((this._engine.p.tempo || 104) * beatDiv);
      const noteDur = note.durationDivs * divSec;
      if (t + noteDur > t0 + spanSec + 1e-6) break; // don't spill past the region
      if (t >= t0 - 1e-6) {
        this._render(note, t);
        this._schedulePerc(note, t, divSec);
      }
      t += noteDur;
    }
  }

  /**
   * Bake capture (docs/DAW_MODE_DESIGN.md): deterministically generate a
   * region's take and return its notes as data instead of sound. Offsets
   * are stored in beat-divisions (beat-space), so baked notes follow a
   * later session tempo. Needs no AudioContext.
   */
  captureSpan(params, spanSec) {
    params = engineParams(params);
    const engine = new GenerationEngine(params);
    engine.initialise();
    const beatDiv = params.beatDivisions || 1;
    const divSec = 60 / ((params.tempo || 104) * beatDiv);
    const notes = [];
    let offsetDivs = 0;
    let guard = 0;
    while (offsetDivs * divSec < spanSec && guard++ < 4000) {
      const note = engine.nextNote();
      if (!note) break;
      const noteDur = note.durationDivs * divSec;
      if (offsetDivs * divSec + noteDur > spanSec + 1e-6) break;
      // Q3: the per-note performance draw travels with the bake so the
      // roll can drill into it later (regions baked before this change
      // simply lack the field and degrade gracefully).
      notes.push({ ...note, offsetDivs, performance: notePerformance(note) });
      offsetDivs += note.durationDivs;
    }
    return notes;
  }

  /**
   * Freeze the procedural percussion for a baked note list into an explicit
   * list of strikes { layerId, beat, velocity, name }. Mirrors _schedulePerc's
   * firing rules exactly (beat / motif / downbeat roles), positioning each hit
   * by its note's span offset. This is what the drum-lane editor edits and what
   * baked playback then replays (per-strike velocity) instead of regenerating.
   */
  capturePercStrikes(params, notes) {
    params = engineParams(params);
    const layers = this._normalizePercLayers(params);
    if (!Array.isArray(layers) || !layers.length || !Array.isArray(notes)) return [];
    const strikes = [];
    for (const note of notes) {
      const beatDiv = note.beatDivisions || 1;
      for (let i = 0; i < (note.durationDivs || 0); i++) {
        const d = (note.startDiv || 0) + i;          // beat-grid phase (fire decision)
        const posDiv = (note.offsetDivs || 0) + i;   // position within the baked span
        const isOnBeat = d % beatDiv === 0;
        const beatNum = Math.floor(d / beatDiv);
        for (const layer of layers) {
          const fire =
            layer.role === "beat" ? isOnBeat
            : layer.role === "motif" ? (d === 0)
            : layer.role === "downbeat" ? (isOnBeat && beatNum % (layer.every || 4) === 0)
            : false;
          if (fire && (layer.vol || 0) > 0) {
            strikes.push({
              layerId: layer.id,
              beat: posDiv / beatDiv,
              velocity: this._clamp(layer.vol, 0.05, 1),
              name: layer.sound?.name || layer.sound?.key || "Perc",
            });
          }
        }
      }
    }
    return strikes;
  }

  /**
   * Schedule a baked note list into the current context from t0. Timbre is
   * frozen per note (each carries its sampled fingerprint); timing follows
   * the CURRENT tempo via beat-space offsets. Graph must be initialised.
   */
  renderNotesSpan(params, notes, t0, totalBeats = null, loopBeats = null, percStrikes = null) {
    if (!this.ctx || !Array.isArray(notes)) return;
    params = engineParams(params);
    // Baked regions carry an explicit, editable strike list; when present it
    // replaces the procedural per-note percussion so edited dynamics play back.
    const useStoredPerc = Array.isArray(percStrikes) && percStrikes.length > 0;
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
    this._timeline = [];
    this._configureReverb(params);
    this._percLayers = this._normalizePercLayers(params);
    this._percussionOnly = !!params.percussionOnly;
    this._engine = new GenerationEngine(params); // rng for render-time draws
    const beatDiv = params.beatDivisions || 1;
    const divSec = 60 / ((params.tempo || 104) * beatDiv);
    // Loop semantics (bake design): an extended baked region repeats its
    // stored notes every loopBeats, clipped to totalBeats.
    const reps = (loopBeats && totalBeats)
      ? Math.max(1, Math.ceil(totalBeats / loopBeats))
      : 1;
    // Baked notes live in degree-space (bake design): pitch is recomputed
    // from degree + cents under the CURRENT scale/key at schedule time, so
    // baked regions follow session key changes. Stored Hz is only a
    // fallback for legacy notes without a degree.
    const scale = this._engine.scale;
    for (let rep = 0; rep < reps; rep++) {
      const repDivs = rep * (loopBeats || 0) * beatDiv;
      let prevFreq = null;
      for (const stored of notes) {
        const offDivs = (stored.offsetDivs || 0) + repDivs;
        if (totalBeats != null && offDivs / beatDiv >= totalBeats) continue;
        const note = { ...stored };
        if (Number.isFinite(note.degree) && scale) {
          note.frequency = scale.degreeToHz(note.degree) * Math.pow(2, (note.intonationCents || 0) / 1200);
          note.slideFromFrequency = ((params.noteConnection || "glide") === "glide" && note.legatoFromPrevious) ? prevFreq : null;
        }
        if (note.velocity > 0) prevFreq = note.frequency;
        // Micro-timing deviations (owner spec): fractional div offsets edited
        // in the roll ride on top of the grid values without changing them.
        const t = t0 + (offDivs + (note.onsetDevDivs || 0)) * divSec;
        if (note.durationDevDivs) {
          note.duration = Math.max(0.03, (note.duration || note.durationDivs * divSec) + note.durationDevDivs * divSec);
        }
        this._render(note, t);
        if (!useStoredPerc) this._schedulePerc(note, t, divSec);
        // Event record for the visualisers. Baked spans schedule upfront,
        // so unlike _schedule() the timeline fills with FUTURE events —
        // keep them all (within reason) rather than trimming the oldest,
        // which here would drop the notes that play first.
        if (this._timeline.length < 2400) {
          this._timeline.push({
            when: t,
            dur: note.duration || note.durationDivs * divSec,
            frequency: note.frequency,
            velocity: note.velocity,
            isRest: !(note.velocity > 0),
          });
        }
      }
      // Edited per-strike percussion for this loop repetition.
      if (useStoredPerc) {
        for (const s of percStrikes) {
          const beatPos = (s.beat || 0) + rep * (loopBeats || 0);
          if (totalBeats != null && beatPos >= totalBeats) continue;
          const t = t0 + (s.beat * beatDiv + repDivs) * divSec;
          const layer = this._percLayers.find(l => l.id === s.layerId);
          if (layer) this._renderPercLayerHit(layer, t, s.velocity);
        }
      }
    }
  }

  /** Live playback of a baked note list (all scheduled upfront). */
  playNotes(params, notes, totalBeats = null, loopBeats = null, percStrikes = null) {
    this.init();
    this._startWhenRunning(() => {
      this.stop();
      if (this._masterOut) {
        const now = this.ctx.currentTime;
        this._masterOut.gain.cancelScheduledValues(now);
        this._masterOut.gain.setTargetAtTime(this._masterVolume, now, 0.012);
      }
      this.renderNotesSpan(params, notes, this.ctx.currentTime + 0.05, totalBeats, loopBeats, percStrikes);
      this.playing = true;
    });
  }

  _configureReverb(params = {}) {
    if (!this._dryGain || !this._wetGain || !this._convolver) return;
    this._configureSpace(params); // position rides every reverb configure
    const wet = this._clamp(params.reverbWet ?? 0, 0, 0.95);
    const decay = this._clamp(params.reverbDecay ?? 1.4, 0.2, 8);
    const tone = this._clamp(params.reverbTone ?? 0.6, 0, 1);
    const preDelay = this._clamp(params.reverbPreDelay ?? 0.015, 0, 0.25);
    const type = REVERB_PROFILES[params.reverbType] ? params.reverbType : "room";
    const profile = REVERB_PROFILES[type];
    // Room-designer params (owner 07-07 round 3) default to the room's own
    // character so a plain room pick sounds like that room.
    const size = this._clamp(params.reverbSize ?? profile.size ?? 0.5, 0, 1);
    const damping = this._clamp(params.reverbDamping ?? profile.damping ?? 0.4, 0, 1);
    const diffusion = this._clamp(params.reverbDiffusion ?? profile.diffusion ?? 0.5, 0, 1);
    const now = this.ctx.currentTime;

    const dry = Math.cos(wet * Math.PI * 0.5);
    const wetGain = Math.sin(wet * Math.PI * 0.5);
    this._dryGain.gain.setTargetAtTime(dry, now, 0.015);
    this._wetGain.gain.setTargetAtTime(wetGain, now, 0.015);
    this._preDelay.delayTime.setTargetAtTime(preDelay, now, 0.015);
    this._reverbTone.frequency.setTargetAtTime(1200 * Math.pow(2, tone * 3.8), now, 0.02);
    this._reverbTone.Q.setTargetAtTime(0.45 + tone * 0.9, now, 0.02);

    const key = `${type}:${decay.toFixed(2)}:${tone.toFixed(2)}:${size.toFixed(2)}:${damping.toFixed(2)}:${diffusion.toFixed(2)}`;
    if (key !== this._reverbKey) {
      this._convolver.buffer = this._buildImpulseResponse(type, decay, tone, { size, damping, diffusion });
      this._reverbKey = key;
    }
  }

  updateReverb(params = {}) {
    if (!this.ctx) return;
    this._configureReverb(engineParams(params));
  }

  // SPACE positioning: distance + azimuth → arrival delay, air absorption,
  // proximity shelf, and the HRTF panner position. Smoothed for live moves;
  // deterministic (no randomness).
  _configureSpace(p = {}) {
    if (!this.ctx || !this._spaceDelay) return;
    this._spaceP = p; // remembered so layer chains (Q7) inherit the base space
    this._configureSpaceNodes({
      proximity: this._spaceProximity, air: this._spaceAir, delay: this._spaceDelay,
      earDelayL: this._earDelayL, earDelayR: this._earDelayR,
      earShadowL: this._earShadowL, earShadowR: this._earShadowR,
      earFilterL: this._earFilterL, earFilterR: this._earFilterR,
      pinnaShelf: this._pinnaShelf, pinnaNotch: this._pinnaNotch,
      distGain: this._spaceDistGain,
    }, p);
    // Percussion v2: each percussion layer positions its OWN spatial chain in
    // _renderPercLayerHit (per hit), so there is nothing to place here.
    this._configureMeasuredEar(p);
  }

  // Owner 07-07 route 2: swap the DIRECTION cue between the parametric ear
  // filters and the measured KEMAR convolution. The measured model loads
  // the left/right IR for the current azimuth (only on bucket change, so a
  // fixed A/B toggle never reloads) and crossfades the two path gates.
  _configureMeasuredEar(p = {}) {
    if (!this._hrirGain) return;
    const measured = !!(EAR_MODELS[p.earModel] && EAR_MODELS[p.earModel].measured);
    const now = this.ctx.currentTime;
    if (measured) {
      const azBucket = Math.round((Number(p.spaceAzimuth) || 0) / KEMAR_HRIR.step);
      if (azBucket !== this._hrirAz || !this._hrirReady) {
        try {
          const { left, right } = kemarBuffers(this.ctx, (Number(p.spaceAzimuth) || 0));
          this._hrirConvL.buffer = left;
          this._hrirConvR.buffer = right;
          this._hrirAz = azBucket;
          this._hrirReady = true;
        } catch (e) {
          // decode/convolver failure → stay parametric rather than go silent
          this._hrirReady = false;
        }
      }
    }
    const useHrir = measured && this._hrirReady;
    this._hrirGain.gain.setTargetAtTime(useHrir ? 1 : 0, now, 0.02);
    this._paramBinGain.gain.setTargetAtTime(useHrir ? 0 : 1, now, 0.02);
  }

  // One spatial chain's configuration — shared by the base chain and every
  // layer chain (Q7), so layers get the full Q4 head physics.
  _configureSpaceNodes(n, p = {}) {
    const d = Math.max(0.3, Math.min(30, Number(p.spaceDistance ?? 2.5)));
    const azDeg = Math.max(-180, Math.min(180, Number(p.spaceAzimuth ?? 0)));
    const az = azDeg * Math.PI / 180;
    const now = this.ctx.currentTime;
    const smooth = (param, v) => {
      try { param.setTargetAtTime(v, now, 0.05); } catch { param.value = v; }
    };
    smooth(n.delay.delayTime, spaceArrivalDelay(d));
    smooth(n.air.frequency, spaceAirCutoff(d));
    smooth(n.proximity.gain, spaceProximityDb(d));
    if (n.earDelayL) {
      // Q4 binaural head: listener properties ride the same params object.
      // Physics per published models (owner 07-07 round 4):
      const earDist = Number(p.earDistance ?? 0.175);
      const density = Number(p.headDensity ?? 0.5);
      // Woodworth ITD per ear
      const itd = itdSeconds(az, earDist);
      smooth(n.earDelayL.delayTime, Math.max(0, itd));
      smooth(n.earDelayR.delayTime, Math.max(0, -itd));
      // Brown-Duda head shadow: a frequency-dependent SHELF per ear —
      // lows diffract around the head (unity), highs shadow/boost by
      // α(θ) at the corner f0 = c/(2πa). No broadband ILD gain: that was
      // the old guess; real interaural level difference is HF-weighted.
      const f0 = headShadowFreq(earDist);
      smooth(n.earFilterL.frequency, f0);
      smooth(n.earFilterR.frequency, f0);
      smooth(n.earFilterL.gain, headShadowDb(az, "L", density));
      smooth(n.earFilterR.gain, headShadowDb(az, "R", density));
      smooth(n.earShadowL.gain, 1);
      smooth(n.earShadowR.gain, 1);
      // Shaw/Blauert pinna cue: behind loses the ~4.3 kHz concha gain and
      // the highs above ~8 kHz; the front half-plane is untouched.
      const pin = pinnaParams(az, p.pinnaScale);
      n.pinnaNotch.frequency.value = pin.conchaHz;
      smooth(n.pinnaNotch.gain, pin.conchaDb);
      n.pinnaShelf.frequency.value = pin.shelfHz;
      smooth(n.pinnaShelf.gain, pin.shelfDb);
      smooth(n.distGain.gain, spaceDistanceGain(d));
    }
  }

  // Q7: a layer's own spatial chain — same topology as the base one,
  // feeding the shared dry bus and reverb send. Built lazily per layer id.
  _layerChain(id) {
    if (!this._layerChains) this._layerChains = new Map();
    let c = this._layerChains.get(id);
    if (c) return c;
    const bi = (type, freq, q) => {
      const f = this.ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq;
      if (q != null) f.Q.value = q;
      return f;
    };
    c = {
      input: this.ctx.createGain(),
      proximity: bi("lowshelf", 180),
      air: bi("lowpass", 20000, 0.5),
      delay: this.ctx.createDelay(0.12),
      earDelayL: this.ctx.createDelay(0.005),
      earDelayR: this.ctx.createDelay(0.005),
      earShadowL: this.ctx.createGain(),
      earShadowR: this.ctx.createGain(),
      earFilterL: bi("highshelf", headShadowFreq(0.175)),
      earFilterR: bi("highshelf", headShadowFreq(0.175)),
      merger: this.ctx.createChannelMerger(2),
      pinnaShelf: bi("highshelf", 8000),
      pinnaNotch: bi("peaking", 4300, 2),
      distGain: this.ctx.createGain(),
      fxOut: this.ctx.createGain(), // post-effects tap → dry spatial + reverb send
    };
    // EFFECTS stage sits between the synthesis input and SPACE. Empty chain ⇒
    // input passes straight through fxOut. Updated per-render from lr.effectsChain.
    c.fxHost = createChainHost(this.ctx, c.input, c.fxOut);
    c.fxOut.connect(c.proximity);
    c.proximity.connect(c.air);
    c.air.connect(c.delay);
    c.delay.connect(c.earDelayL);
    c.delay.connect(c.earDelayR);
    c.earDelayL.connect(c.earShadowL);
    c.earDelayR.connect(c.earShadowR);
    c.earShadowL.connect(c.earFilterL);
    c.earShadowR.connect(c.earFilterR);
    c.earFilterL.connect(c.merger, 0, 0);
    c.earFilterR.connect(c.merger, 0, 1);
    c.merger.connect(c.pinnaShelf);
    c.pinnaShelf.connect(c.pinnaNotch);
    c.pinnaNotch.connect(c.distGain);
    c.distGain.connect(this._dryGain);
    c.fxOut.connect(this._preDelay); // shared diffuse reverb send (post-effects)
    this._layerChains.set(id, c);
    return c;
  }

  updateGenerationParams(params = {}) {
    if (!this._engine) return;
    this._engine.p = engineParams({ ...this._engine.p, ...params });
  }

  // Live-apply percussion edits (owner 2026-07-10): rebuild the normalised
  // layer list so future scheduled hits pick up level/role/sound/position/
  // enable changes without restarting playback. Group-position fallbacks
  // (percAzimuth/percDistance) are mirrored onto the remembered space params.
  updatePercLayers(params = {}) {
    params = engineParams(params);
    this._percLayers = this._normalizePercLayers(params);
    if (this._spaceP) {
      this._spaceP.percAzimuth = params.percAzimuth;
      this._spaceP.percDistance = params.percDistance;
    }
  }

  /**
   * Live-apply the EFFECTS stage to the running graph (docs/EFFECTS_CONTRACT).
   * The effect hosts are persistent subgraphs, so param/stack edits land
   * click-free WITHOUT waiting for the next note. Call whenever effectsChain,
   * stageEffectsOn, or any effect param changes while playing/paused.
   */
  updateEffects(params = {}) {
    if (!this.ctx) return;
    params = engineParams(params);
    if (this._spaceP) {
      this._spaceP.effectsChain = params.effectsChain;
      this._spaceP.stageEffectsOn = params.stageEffectsOn;
    }
    if (this._baseFxHost) {
      this._baseFxHost.update(sanitizeChain(params.effectsChain), params.stageEffectsOn !== false);
    }
    if (Array.isArray(params.layers) && this._layerChains) {
      for (const layer of params.layers) {
        const c = this._layerChains.get(layer.id);
        if (!c || !c.fxHost) continue;
        const sub = layer.sound || layer.subnote || {};
        c.fxHost.update(sanitizeChain(sub.effectsChain), sub.stageEffectsOn !== false);
      }
    }
  }

  /**
   * Rebuild the generative sequence from the very start with the current
   * parameters, *without* tearing down the audio graph. Playback continues
   * seamlessly but the Markov repertoire is regenerated, so you hear what the
   * from-scratch sequence sounds like under the settings as they stand now.
   * Returns false (and does nothing) when not currently playing.
   */
  regenerate(params) {
    if (!this.playing || !this.ctx) return false;
    params = engineParams(params);
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._surpriseCount = 0;
    this._lastSurpriseAt = 0;
    this._timeline = [];
    this._engine = new GenerationEngine(params);
    this._engine.initialise();
    return true;
  }

  _buildImpulseResponse(type, decay, tone, opts = {}) {
    const profile = REVERB_PROFILES[type] || REVERB_PROFILES.room;
    const size = this._clamp(opts.size ?? profile.size ?? 0.5, 0, 1);
    const damping = this._clamp(opts.damping ?? profile.damping ?? 0.4, 0, 1);
    const diffusion = this._clamp(opts.diffusion ?? profile.diffusion ?? 0.5, 0, 1);
    const sr = this.ctx.sampleRate;
    // a bigger room rings longer for the same decay setting
    const duration = this._clamp(profile.duration * decay * (0.7 + size * 0.6), 0.15, 10);
    const length = Math.max(1, Math.floor(sr * duration));
    const buffer = this.ctx.createBuffer(2, length, sr);
    const seed = Array.from(type).reduce((sum, ch) => sum + ch.charCodeAt(0), 17);
    const brightness = 0.18 + tone * 0.82;

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, profile.shape) * Math.exp(-t * (1.2 + (1 - tone) * 2.2));
        const noise = this._impulseNoise(i, ch, seed);
        low += (noise - low) * (0.015 + brightness * 0.14);
        // damping: absorbent surfaces darken the tail progressively —
        // the bright component dies faster than the body of the sound
        const bright = brightness * Math.exp(-t * damping * 5);
        let sample = (low * 0.65 + noise * bright * 0.35) * env;
        // low diffusion: the wash breaks into audible flutter/grain
        if (diffusion < 0.5) {
          sample *= 1 - (0.5 - diffusion) * 0.9 * (0.5 + 0.5 * Math.sin(i * 0.013 + ch * 1.7));
        }

        if (type === "spring") {
          sample *= 0.72 + 0.28 * Math.sin(i * 0.047 + Math.sin(i * 0.003) * 2.5);
          sample += Math.sin(i * 0.021 + ch) * env * 0.035;
        }
        data[i] = sample;
      }

      // first bounces from the shared pattern — the same one the UI draws
      for (const refl of earlyReflectionPattern(type, size, diffusion)) {
        const pos = Math.min(length - 1, Math.floor(sr * (refl.t + (refl.side > 0 ? ch : 1 - ch) * 0.0011)));
        data[pos] += refl.gain * ((refl.side > 0) === (ch === 1) ? 1 : 0.55);
      }
    }
    return buffer;
  }

  _impulseNoise(i, ch, seed) {
    const x = Math.sin((i + 1) * (12.9898 + ch * 4.1414) + seed * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  }

  stop() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
    // Click-free stop: fade the master down over ~25ms, then kill the nodes.
    // The node list is snapshotted so a play() that follows immediately can
    // start fresh voices without the deferred stop touching them.
    const nodes = this._nodes;
    this._nodes = [];
    if (this.ctx && this._masterOut && nodes.length) {
      const now = this.ctx.currentTime;
      this._masterOut.gain.cancelScheduledValues(now);
      this._masterOut.gain.setTargetAtTime(0, now, 0.008);
      setTimeout(() => {
        for (const n of nodes) { try { n.stop(0); } catch {} }
      }, 40);
    } else {
      for (const n of nodes) { try { n.stop(0); } catch {} }
    }
    if (this._wetGain && this.ctx) {
      this._wetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    }
  }

  /**
   * Stop TRIGGERING new notes but let everything already sounding play
   * out — envelope releases, material ring, and the reverb tail all run
   * to their natural end. Contrast stop(), which fades the master and
   * kills the nodes ~40ms later. Used at producer region ends (owner
   * 07-07: a region boundary is not a mute).
   */
  finish() {
    this.playing = false;
    clearTimeout(this._timer);
    this._timer = null;
  }

  get isPlaying() { return this.playing; }

  /** Current generation state for UI feedback. */
  getEngineState() {
    const state = this._engine ? this._engine.getState() : null;
    return state ? {
      ...state,
      surpriseCount: this._surpriseCount,
      lastSurpriseAt: this._lastSurpriseAt,
    } : null;
  }

  /**
   * Expectation/surprise/repetition summary for the current performance
   * (since play/regenerate). Logged with explore events for appeal modelling.
   */
  getPerformanceMetrics() {
    return this._engine ? this._engine.getMetricsSummary() : null;
  }

  /** Route the soft-clipped master (via pan) through the limiter or straight out. */
  _applyLimiterRouting() {
    if (!this._softClip || !this.ctx) return;
    try { this._softClip.disconnect(); } catch {}
    const tail = this._panner || this._softClip;
    if (this._panner) {
      try { this._panner.disconnect(); } catch {}
      this._softClip.connect(this._panner);
    }
    if (this._limiterOn) tail.connect(this._limiter);
    else tail.connect(this._dest);
  }

  /** Stereo pan for this voice (-1 left … +1 right). */
  setPan(v) {
    this._panValue = Math.max(-1, Math.min(1, Number(v) || 0));
    if (this._panner && this.ctx) {
      this._panner.pan.setTargetAtTime(this._panValue, this.ctx.currentTime, 0.02);
    }
  }

  /** Set master output level. Accepts a linear gain (0..~2). */
  setMasterVolume(linear) {
    this._masterVolume = Math.max(0, linear);
    if (this._masterOut && this.ctx) {
      this._masterOut.gain.setTargetAtTime(this._masterVolume, this.ctx.currentTime, 0.012);
    }
  }

  /** Enable/disable the output limiter. */
  setLimiter(on) {
    this._limiterOn = !!on;
    this._applyLimiterRouting();
  }

  /** Peak level (0..1) of the current output, for the meter. */
  getOutputLevel() {
    const d = this.getWaveform();
    if (!d) return 0;
    let peak = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    return peak;
  }

  /** Note-event timeline + scale layout for the auto-scrolling visualisers. */
  getNoteTimeline() {
    const scale = this._engine ? this._engine.scale : null;
    return {
      now: this.ctx ? this.ctx.currentTime : 0,
      playing: this.playing,
      events: this._timeline,
      baseLen: this._engine && this._engine.repertoire ? this._engine.repertoire.baseLen : 0,
      scale: scale ? { div: scale.div, all: scale.all.slice(), sub: scale.sub.slice() } : null,
    };
  }

  getSpectrum() {
    if (!this.analyser) return null;
    const d = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(d);
    return d;
  }
  getWaveform() {
    if (!this.analyser) return null;
    const d = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(d);
    return d;
  }

  // ── Scheduling ──

  _schedule() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const AHEAD = 0.45;

    while (this._nextTime < now + AHEAD) {
      const note = this._engine.nextNote();
      if (!note) { this.finish(); return; } // exhausted: ring out, don't cut the tail
      if (note.isSurprise) {
        this._surpriseCount += 1;
        this._lastSurpriseAt = Date.now();
      }

      const beatDiv = note.beatDivisions || 1;
      const divSec = 60 / ((this._engine.p.tempo || 104) * beatDiv);
      const noteDur = note.durationDivs * divSec;

      this._render(note, this._nextTime);
      this._schedulePerc(note, this._nextTime, divSec);

      const dev = note.isVariant ? this._engine.motifDeviation(note.motifIndex) : { pitch: 0, rhythm: 0 };

      // Record event for the auto-scrolling visualisers
      this._timeline.push({
        when: this._nextTime,
        dur: noteDur,
        frequency: note.frequency,
        degree: note.degree,
        velocity: note.velocity,
        noteRole: note.noteRole,
        isRest: note.isRest,
        isSurprise: note.isSurprise,
        motifIndex: note.motifIndex,
        baseIndex: note.baseIndex,
        isVariant: note.isVariant,
        motifNoteIndex: note.motifNoteIndex,
        motifNotesCount: note.motifNotesCount,
        isMotifStart: note.isMotifStart,
        beatDivisions: beatDiv,
        motifLengthDivs: note.motifLengthDivs,
        durationDivs: note.durationDivs,
        intonationCents: note.intonationCents || 0,
        pitchDev: dev.pitch,
        rhythmDev: dev.rhythm,
        // information + surprise dimensions for the behaviour lanes
        pitchBits: note.pitchBits ?? null,
        dynBits: note.dynBits ?? null,
        restBits: note.restBits ?? null,
        surpriseFeatures: note.surpriseFeatures || [],
      });
      if (this._timeline.length > 320) this._timeline.splice(0, this._timeline.length - 320);

      this._nextTime += noteDur;
    }
    this._timer = setTimeout(() => this._schedule(), 90);
  }

  // ── Percussion scheduling (v2, owner 2026-07-10) ──

  // Resolve params → a normalised percussion layer array. Mirrors app.js
  // resolvePercEnabled/ensurePercLayers exactly so the engine agrees with the
  // UI even for un-normalised legacy params. The enable gate comes first:
  // OFF (or absent + silent) → [] → no hits scheduled at all.
  _normalizePercLayers(params = {}) {
    const audible = Array.isArray(params.percLayers)
      ? params.percLayers.some(l => (Number(l.vol) || 0) > 0)
      : ((Number(params.percBeatVol) || 0) > 0 || (Number(params.percMotifVol) || 0) > 0
         || (Number(params.percDownbeatVol) || 0) > 0);
    const enabled = typeof params.percEnabled === "boolean" ? params.percEnabled : audible;
    if (!enabled) return [];
    const src = (Array.isArray(params.percLayers) && params.percLayers.length)
      ? params.percLayers
      : [
          { role: "beat", vol: params.percBeatVol, sound: { kind: "sample", key: params.percBeatSound || "click" } },
          { role: "motif", vol: params.percMotifVol, sound: { kind: "sample", key: params.percMotifSound || "bell" } },
          { role: "downbeat", vol: params.percDownbeatVol, every: params.percDownbeatEvery || 4,
            sound: { kind: "sample", key: params.percDownbeatSound || "wood" } },
        ];
    return src.map((l, i) => ({
      id: l.id || `perc${i}`,
      role: l.role || "beat",
      every: l.role === "downbeat" ? (l.every || 4) : null,
      vol: Number(l.vol) || 0,
      sound: (l.sound && l.sound.kind) ? l.sound : { kind: "sample", key: "click" },
      space: l.space || null,
    })).filter(l => l.vol > 0);
  }

  _schedulePerc(note, noteStartTime, divSec) {
    const layers = this._percLayers;
    if (!layers || !layers.length) return;
    const beatDiv = note.beatDivisions || 1;

    for (let i = 0; i < note.durationDivs; i++) {
      const d = note.startDiv + i;
      const t = noteStartTime + i * divSec;
      const isOnBeat = d % beatDiv === 0;
      const beatNum = Math.floor(d / beatDiv);
      for (const layer of layers) {
        const fire =
          layer.role === "beat" ? isOnBeat
          : layer.role === "motif" ? (d === 0)
          : layer.role === "downbeat" ? (isOnBeat && beatNum % (layer.every || 4) === 0)
          : false;
        if (fire) this._renderPercLayerHit(layer, t);
      }
    }
  }

  // One percussion layer's hit at t0, routed through the layer's OWN spatial
  // chain (id "__perc__<layerId>", lazily built) so each layer sits at its own
  // position. Sample layers use the built-in PERC_SOUNDS recipes; instrument
  // layers render a single sub-note attack via the GenerationEngine.
  _renderPercLayerHit(layer, t0, velOverride) {
    const vel = (velOverride == null ? (layer ? layer.vol : 0) : velOverride);
    if (!layer || vel <= 0 || t0 < this.ctx.currentTime - 0.02) return;
    const chain = this._layerChain(`__perc__${layer.id}`);
    const sp = { ...(this._spaceP || {}) };
    if (layer.space) {
      sp.spaceAzimuth = layer.space.angle;
      sp.spaceDistance = layer.space.dist;
    } else {
      // no per-layer position → fall back to the legacy group position, then base
      sp.spaceAzimuth = Number.isFinite(sp.percAzimuth) ? sp.percAzimuth : (sp.spaceAzimuth ?? 0);
      sp.spaceDistance = Number.isFinite(sp.percDistance) ? sp.percDistance : (sp.spaceDistance ?? 2.5);
    }
    this._configureSpaceNodes(chain, sp);
    if (chain.fxHost) chain.fxHost.update([], true); // percussion carries no effects
    const snd = layer.sound || { kind: "sample", key: "click" };
    if (snd.kind === "instrument" && snd.subnote && this._engine) {
      const note = this._engine._percInstrumentNote(snd.subnote, {
        velocity: this._clamp(layer.vol, 0.05, 1),
        pitchHz: Number.isFinite(snd.pitchHz) ? snd.pitchHz : 220,
        duration: 0.12,
      });
      note._out = chain.input;
      this._renderFourier(note, t0);
    } else {
      this._renderPercHit(snd.key || "click", t0, layer.vol, chain.input);
    }
  }

  // Sample hit into `dest`. PERC_SAMPLE_TRIM preserves the loudness the old
  // shared _percGain (0.45) provided now that hits route through layer chains.
  _renderPercHit(soundName, t0, vol, dest) {
    const sound = PERC_SOUNDS[soundName];
    if (!sound || vol <= 0 || t0 < this.ctx.currentTime - 0.02 || !dest) return;
    const PERC_SAMPLE_TRIM = 0.45;
    const decay = sound.decay || 0.05;

    if (sound.type === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const filt = this.ctx.createBiquadFilter();
      filt.type = sound.filterType || "highpass";
      filt.frequency.setValueAtTime(sound.filterFreq || 4000, t0);
      filt.Q.value = sound.filterQ || 1;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vol * sound.amp * PERC_SAMPLE_TRIM, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
      src.connect(filt); filt.connect(env); env.connect(dest);
      src.start(t0); src.stop(t0 + decay + 0.01);
      this._track(src);
    } else if (sound.type === "sine") {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(sound.freq || 800, t0);
      if (sound.freqEnd) osc.frequency.exponentialRampToValueAtTime(sound.freqEnd, t0 + decay);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vol * sound.amp * PERC_SAMPLE_TRIM, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
      osc.connect(env); env.connect(dest);
      osc.start(t0); osc.stop(t0 + decay + 0.01);
      this._track(osc);
    }
  }

  // ── Rendering ──

  _render(note, t0) {
    // Percussion-only patches keep the note stream (it drives the beat grid for
    // percussion) but never voice a pitched sound.
    if (this._percussionOnly) return;
    if (t0 < this.ctx.currentTime - 0.02) return;
    if (note.isRest || note.velocity <= 0) return; // silence for rest surprises
    note._vibratoEvents = this._buildVibratoEvents(note, t0, t0 + note.duration);
    // L5/L5b: one seeded articulation draw controls plosive strength, breath
    // lead and fitted pitch scoop together. Presets that have not opted in
    // retain the exact Q8 class-based scoop for compatibility.
    const bowedOnsetEnabled = note.excitationType === "bow" &&
      ((note.onsetWanderCents || 0) > 0 || (note.bowScratchLevel || 0) > 0);
    note._articulationOnset = articulationOnsetPlan(
      () => this._nextRandom(), {
        coupling: note.articulationCoupling,
        strength: note.articulationStrength,
        strengthVelocitySlope: note.articulationVelocitySlope,
        variation: note.articulationVariation,
        human: note.excitationHuman,
        velocity: note.velocity,
        frequency: note.frequency,
        depthCents: note.onsetScoopDepthCents,
        settleSec: note.onsetScoopSettle,
        rearticulatedScale: note.onsetScoopRearticulatedScale,
        registerSlope: note.onsetScoopRegisterSlope,
        velocitySlope: note.onsetScoopVelocitySlope,
        phraseStart: note.phraseStart,
        legato: note.legatoFromPrevious,
        forceLatent: bowedOnsetEnabled,
      });
    note._scoopCents = (note.articulationCoupling || 0) > 0
      ? note._articulationOnset.scoopCents
      : (note.legatoFromPrevious ? 0 : onsetScoopCents(note.excitationType, note.excitationHuman));
    note._scoopSettleSec = (note.articulationCoupling || 0) > 0
      ? note._articulationOnset.scoopSettleSec
      : 0;
    note._bowOnsetWander = bowOnsetWanderPlan(
      () => this._nextRandom(), {
        excitationType: note.excitationType,
        human: note.excitationHuman,
        articulationStrength: note._articulationOnset.strength,
        depthCents: note.onsetWanderCents,
        settlePeriods: note.onsetWanderSettlePeriods,
        frequency: note.frequency,
        legato: note.legatoFromPrevious,
      });
    note._bowScratch = bowScratchPlan(note.attackNoise, {
      excitationType: note.excitationType,
      articulationStrength: note._articulationOnset.strength,
      level: note.bowScratchLevel,
      durationPeriods: note.onsetWanderSettlePeriods,
      frequency: note.frequency,
    });
    note._wanderEvents = f0WanderTrace(() => this._nextRandom(), note.duration, note.excitationHuman);
    const dispatch = (n) => {
      if (this._voiceMode === "formant" || this._voiceMode === "fourier") {
        this._renderFourier(n, t0);
      } else {
        this._renderOsc(n, t0);
      }
    };
    // Q7 layered subnotes: every layer renders the SAME note through its own
    // fingerprint into its own spatial chain, inheriting the base space and
    // the listener's head (owner 07-07: the head is a patch/space-level
    // choice now, never per-layer). The base has the same level + additive
    // solo behaviour as the captured layers.
    // EFFECTS stage: the base voice's chain lives on the sound-half params
    // (remembered as _spaceP by _configureSpace); each layer carries its own.
    // stageEffectsOn:false bypasses the whole stack. Applied per-note so live
    // edits land within a note, matching the rest of the sound-half model.
    const bp = this._spaceP || {};
    if (this._baseFxHost) this._baseFxHost.update(sanitizeChain(bp.effectsChain), bp.stageEffectsOn !== false);
    const lrs = (Array.isArray(note.layerRenders) && this._dryGain) ? note.layerRenders : [];
    const mix = layerMixPlan(this._engine?.p || bp, lrs);
    if (mix.baseAudible) dispatch({ ...note, velocity: note.velocity * mix.baseGain, layerRenders: null });
    for (const lr of mix.layers) {
      const ln = {
        ...note,
        ...lr.note,
        velocity: note.velocity * this._clamp(lr.gain ?? 1, 0, 2),
        layerRenders: null,
      };
      const chain = this._layerChain(lr.id);
      const sp = { ...(this._spaceP || {}) };
      if (lr.space) { sp.spaceAzimuth = lr.space.angle; sp.spaceDistance = lr.space.dist; }
      this._configureSpaceNodes(chain, sp);
      if (chain.fxHost) chain.fxHost.update(sanitizeChain(lr.effectsChain), lr.stageEffectsOn !== false);
      ln._out = chain.input;
      ln._vibratoEvents = note._vibratoEvents; // coherent FM across layers
      dispatch(ln);
    }
  }

  /** Formant synthesis: sawtooth → 3 parallel bandpass → envelope → master */
  _renderFormant(note, t0) {
    const t1 = t0 + note.duration;
    const f = note.formantPos
      ? formantFreqsAtPoint(note.formantPos)
      : formantFreqsAt(note.formant, note.formantDev || 0);
    const spectralMix = this._spectralMix(note);

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    this._setFrequency(osc.frequency, note.frequency, t0, note);

    // Envelope
    const env = this._adsr(note.velocity * 0.4, t0, t1, note);

    // Five parallel formant filters (docs/PARTIAL_MACROS_DESIGN.md D7d):
    // F1/F2 carry the vowel, F3 colour, F4/F5 the presence/singer's-formant
    // region. Q derives from the vowel's per-formant bandwidth, scaled by
    // the user's bandwidth control; F3-F5 levels are user-trimmable.
    const gp = this._engine?.p || {};
    const bwScale = Math.max(0.4, Math.min(2.5, Number(gp.formantBandwidth ?? 1)));
    const lvl3 = Math.max(0, Math.min(2, Number(gp.formantF3Level ?? 1)));
    const lvl4 = Math.max(0, Math.min(2, Number(gp.formantF4Level ?? 1)));
    const lvl5 = Math.max(0, Math.min(2, Number(gp.formantF5Level ?? 1)));
    const bws = f.bw || [80, 100, 160, 220, 280];
    const bank = [
      [f.f1, 1.0, bws[0]],
      [f.f2, 0.6, bws[1]],
      [f.f3, 0.25 * lvl3, bws[2]],
      [f.f4 || 3400, 0.12 * lvl4, bws[3]],
      [f.f5 || 3800, 0.07 * lvl5, bws[4]],
    ];
    for (const [freq, amp, bwHz] of bank) {
      if (amp <= 0) continue;
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      const formantShift = Math.max(0.7, Math.min(1.3, 1 + (note.toneFormantShift || 0)));
      const resonanceShift = Math.max(0.45, Math.min(1.8, 1 + (note.toneResonanceShift || 0)));
      const centre = freq * formantShift;
      bp.frequency.setValueAtTime(centre, t0);
      bp.Q.value = Math.max(2, Math.min(18, (centre / Math.max(30, bwHz * bwScale)) * resonanceShift));

      const g = this.ctx.createGain();
      g.gain.value = amp * 0.18 * (1 - spectralMix * 0.55);

      osc.connect(bp);
      bp.connect(g);
      g.connect(env);
    }
    this._renderSpectralPartials(note, t0, t1, env);
    this._renderBreath(note, t0, t1, env);
    env.connect(note._out || this._voiceBus || this.master);

    osc.start(t0);
    osc.stop(t1 + 0.08 + (note._ringSec || 0));
    this._track(osc);
  }

  /** Simple oscillator fallback. */
  _renderOsc(note, t0) {
    const t1 = t0 + note.duration;
    const osc = this.ctx.createOscillator();
    osc.type = this._voiceMode === "sine" ? "sine" : "triangle";
    this._setFrequency(osc.frequency, note.frequency, t0, note);

    const env = this._adsr(note.velocity, t0, t1, note);
    const base = this.ctx.createGain();
    base.gain.value = 1 - this._spectralMix(note) * 0.7;
    osc.connect(base);
    base.connect(env);
    this._renderSpectralPartials(note, t0, t1, env);
    this._renderBreath(note, t0, t1, env);
    env.connect(note._out || this._voiceBus || this.master);
    osc.start(t0);
    osc.stop(t1 + 0.06 + (note._ringSec || 0));
    this._track(osc);
  }

  /** Additive Fourier synthesis: fixed harmonic slots → shared envelope. */
  _renderFourier(note, t0) {
    const t1 = t0 + note.duration;
    const env = this._adsr(note.velocity, t0, t1, note);
    const out = note._out || this._voiceBus || this.master;
    this._renderSpectralPartials(note, t0, t1, env);
    this._renderAttackNoise(note, t0, env, out);
    this._renderBreath(note, t0, t1, env);
    env.connect(out);
  }

  _spectralMix(note) {
    return Math.max(0, Math.min(1, note.spectralMix || 0));
  }

  _setFrequency(param, targetFrequency, t0, note, multiplier = 1) {
    const target = Math.max(1, targetFrequency);
    const from = note.legatoFromPrevious && note.slideFromFrequency
      ? Math.max(1, note.slideFromFrequency * multiplier)
      : target;
    const slide = Math.max(0, Math.min(note.slideDuration || 0, note.duration * 0.8));
    // Q8: onset scoop rises over the attack; f0 wander steps slowly through
    // the sustain. Both are cent offsets shared by every partial (coherent).
    const scoopCents = note._scoopCents || 0;
    const fittedSettle = note._scoopSettleSec || 0;
    const atk = Math.min((note.duration || 0.2) * 0.4,
      fittedSettle > 0 ? fittedSettle : Math.max(0.015, note.envelopeAttack ?? 0.02));
    const scoopAt = (time) => scoopCents
      ? scoopCents * Math.max(0, 1 - (time - t0) / atk)
      : 0;
    const wander = note._wanderEvents || [];
    const bowOnset = note._bowOnsetWander || { cents: 0, settleSec: 0 };
    const bowOnsetAt = (time) => bowOnset.cents
      ? bowOnset.cents * Math.max(0, 1 - (time - t0) / Math.max(.001, bowOnset.settleSec))
      : 0;
    const wanderAt = (time) => {
      let c = 0;
      for (const p of wander) { if (p.time <= time - t0) c = p.cents; else break; }
      return c;
    };
    let events = note._vibratoEvents || [];
    if (!events.length && (scoopCents || bowOnset.cents || wander.length)) {
      // no vibrato timeline to ride — synthesize ramp points for the
      // imperfections themselves
      const pts = [t0];
      if (scoopCents) for (const f of [0.25, 0.5, 0.75, 1]) pts.push(t0 + atk * f);
      if (bowOnset.cents) {
        for (const f of [0.25, 0.5, 0.75, 1]) pts.push(t0 + bowOnset.settleSec * f);
      }
      for (const p of wander) pts.push(t0 + p.time);
      pts.push(t0 + (note.duration || 0.2));
      events = [...new Set(pts)].sort((a, b) => a - b).map(time => ({ time, cents: 0 }));
    }
    const baseAt = (time) => {
      if (slide > 0.001 && time < t0 + slide && Math.abs(from - target) > 0.01) {
        const progress = this._clamp((time - t0) / slide, 0, 1);
        return from * Math.pow(target / from, progress);
      }
      return target;
    };
    const valueAt = (time, cents = 0) =>
      baseAt(time) * Math.pow(2,
        (cents + scoopAt(time) + bowOnsetAt(time) + wanderAt(time)) / 1200);

    if (events.length > 0) {
      param.setValueAtTime(valueAt(t0, events[0].cents), t0);
      for (let i = 1; i < events.length; i++) {
        const e = events[i];
        param.linearRampToValueAtTime(valueAt(e.time, e.cents), e.time);
      }
      return;
    }

    param.setValueAtTime(from, t0);
    if (slide > 0.001 && Math.abs(from - target) > 0.01) {
      param.exponentialRampToValueAtTime(target, t0 + slide);
    }
  }

  _buildVibratoEvents(note, t0, t1) {
    const probability = this._clamp(note.vibratoProb ?? 0, 0, 1);
    const depthMean = this._clamp(note.vibratoDepth ?? 0, 0, 120);
    const depthSd = this._clamp(note.vibratoDepthSd ?? 0, 0, 80);
    const rateMean = this._clamp(note.vibratoRate ?? 5.5, 0.1, 18);
    const rateSd = this._clamp(note.vibratoRateSd ?? 0, 0, 8);
    const noteDuration = Math.max(0, t1 - t0);
    if (noteDuration <= 0.02 || probability <= 0 || (depthMean <= 0 && depthSd <= 0)) {
      if (!note.legatoFromPrevious) this._vibratoActive = false;
      return [];
    }

    if (!note.legatoFromPrevious) {
      this._vibratoActive = this._nextRandom() < probability;
      this._vibratoPhase = 0;
      this._sampleVibratoCycle(depthMean, depthSd, rateMean, rateSd);
    } else if (!this._vibratoActive) {
      return [];
    }
    if (!this._vibratoActive) return [];

    const events = [];
    let t = t0;
    let phase = this._vibratoPhase;
    let rate = this._vibratoCycleRate || rateMean;
    let depth = this._vibratoCycleDepth || depthMean;
    let guard = 0;

    while (t < t1 && guard++ < 600) {
      events.push({ time: t, cents: Math.sin(phase) * depth });
      const step = Math.min(0.018, Math.max(0.004, 1 / (Math.max(0.1, rate) * 8)));
      const remainingInCycle = (Math.PI * 2 - phase) / (Math.PI * 2 * Math.max(0.1, rate));
      const dt = Math.max(0.001, Math.min(step, remainingInCycle, t1 - t));
      t += dt;
      phase += Math.PI * 2 * rate * dt;
      if (phase >= Math.PI * 2 - 1e-5) {
        phase = phase % (Math.PI * 2);
        this._sampleVibratoCycle(depthMean, depthSd, rateMean, rateSd);
        rate = this._vibratoCycleRate;
        depth = this._vibratoCycleDepth;
      }
    }
    events.push({ time: t1, cents: Math.sin(phase) * depth });
    this._vibratoPhase = phase % (Math.PI * 2);
    return events;
  }

  _sampleVibratoCycle(depthMean, depthSd, rateMean, rateSd) {
    this._vibratoCycleDepth = this._clamp(depthMean + this._gaussian() * depthSd, 0, 120);
    this._vibratoCycleRate = this._clamp(rateMean + this._gaussian() * rateSd, 0.1, 18);
  }

  _renderSpectralPartials(note, t0, t1, env) {
    const partials = note.harmonicPartials;
    const mix = this._spectralMix(note);
    if (!partials || partials.length === 0 || mix <= 0) return;
    const norm = Math.max(
      0.001,
      note.spectralReferenceNorm || partials.reduce((sum, part) => sum + Math.max(0, part.mean || part.amp), 0) || 1
    );
    const partialB = Math.max(0, note.partialB || 0);
    const resClass = note.resonatorClass || "string";
    const scheduled = [];
    partials.forEach((part) => {
      const harmonic = part.harmonic || 1;
      // Tone v2 (T1): realised mode frequency from the ratio table bent by
      // true stiff-string inharmonicity — count-independent (audit A4).
      const multiplier = partialFrequency(harmonic, 1, partialB, resClass);
      const freq = note.frequency * multiplier;
      if (freq > this.ctx.sampleRate * 0.45 || freq > 16000) return;
      // Audibility cull: partials that can never rise above ~-66 dB of the
      // print are dead weight (typical live set stays at 20-40 oscillators).
      if (!partialIsAudible(Math.max(part.amp, part.mean), norm, harmonic,
                            note.spectralCullThreshold)) return;
      // T2 (audit A8): the hidden 1.4/√n rolloff is gone — what the print
      // shows is exactly what renders; spectral shaping lives only in the
      // model (excitation × macros × material × body).
      const baseGainScale = mix / norm;
      // Q8 attack stagger: low partials speak first on bow/blow onsets
      // (never on legato joins — the column of air / string is already going)
      const onsetDelay = note.legatoFromPrevious
        ? 0
        : partialOnsetDelay(harmonic, note.excitationType, note.attackStaggerMs);
      // Material damping law, tone v2 (T1): each partial decays with the
      // instrument's T60 at that partial's REAL frequency (audits A2/A3) —
      // a 4 kHz mode rings the same whether it is n=4 of a high note or
      // n=16 of a low one, and decay no longer depends on note duration.
      // Wood/felt kills the highs, glass/metal lets them ring.
      const material = Math.max(0, Math.min(1, note.partialMaterial ?? 0));

      const bodyTail = (gainNode, modeFreq) => {
        let tail = gainNode;
        // FM→AM through the body (T5): every polarisation mode traverses
        // the same body law. Close modes may sit on slightly different parts
        // of a ridge, but neither gets a separate body implementation.
        const bodyEvents = bodyAmAutomationEvents(
          note, modeFreq, t0, t1, modeFreq / Math.max(1, note.frequency), 100);
        if (bodyEvents.length > 1 && bodyEvents.some(e => Math.abs(e.gain - 1) > 1e-12)) {
          const am = this.ctx.createGain();
          am.gain.setValueAtTime(bodyEvents[0].gain, bodyEvents[0].time);
          for (let k = 1; k < bodyEvents.length; k++) {
            const e = bodyEvents[k];
            am.gain.linearRampToValueAtTime(e.gain, e.time);
          }
          gainNode.connect(am);
          tail = am;
        }
        return tail;
      };

      const connectDecay = (tail, modeFreq, modeDecayRatio) => {
        if (!(material > 0 && harmonic > 1 && usesFreeDecay(note.excitationType))) {
          tail.connect(env);
          return;
        }
        const decayG = this.ctx.createGain();
        const plan = twoStageDecayPlan(modeFreq, material,
          note.decaySecondStage, note.decaySecondRatio);
        const earlyT60 = plan.earlyT60 * modeDecayRatio;
        const lateT60 = plan.lateT60 * modeDecayRatio;
        const tau = Math.max(0.02, earlyT60 / 6.91);
        decayG.gain.setValueAtTime(1, t0);
        decayG.gain.setTargetAtTime(0.0001, t0 + 0.01, tau);
        if ((note.decaySecondStage || 0) > 0 && lateT60 > earlyT60) {
          const breakpointGain = Math.pow(10, plan.breakpointDb / 20);
          const breakpointTime = t0 + 0.01 +
            earlyT60 * Math.abs(plan.breakpointDb) / 60;
          decayG.gain.setValueAtTime(breakpointGain, breakpointTime);
          decayG.gain.setTargetAtTime(0.0001, breakpointTime,
            Math.max(0.02, lateT60 / 6.91));
        }
        tail.connect(decayG);
        decayG.connect(env);
      };

      let primarySchedule = null;
      const renderMode = (modeFreq, modeMultiplier, modeGain,
                          modeDecayRatio = 1, quadrature = false) => {
        const osc = this.ctx.createOscillator();
        if (quadrature) {
          const real = new Float32Array([0, 1]);
          const imag = new Float32Array([0, 0]);
          osc.setPeriodicWave(this.ctx.createPeriodicWave(real, imag,
            { disableNormalization: true }));
        } else {
          osc.type = "sine";
        }
        this._setFrequency(osc.frequency, modeFreq, t0, note, modeMultiplier);
        const g = this.ctx.createGain();
        const schedule = {
          param: g.gain,
          gainScale: baseGainScale * modeGain,
        };
        if (!primarySchedule) {
          primarySchedule = { ...schedule, part, onsetDelay, followers: [] };
          scheduled.push(primarySchedule);
        } else {
          primarySchedule.followers.push(schedule);
        }
        osc.connect(g);
        connectDecay(bodyTail(g, modeFreq), modeFreq, modeDecayRatio);
        osc.start(t0);
        osc.stop(t1 + 0.04 + (note._ringSec || 0));
        this._track(osc);
      };

      let modePlan = polarisationModePlan(1, note.polarisationAmount,
        note.polarisationSplitCents, note.polarisationDecayRatio);
      const secondFreq = freq * modePlan.frequencyRatio;
      const secondAudible = modePlan.secondaryGain > 0 &&
        secondFreq <= this.ctx.sampleRate * 0.45 && secondFreq <= 16000;
      if (!secondAudible) modePlan = polarisationModePlan(1, 0, 0, 1);
      renderMode(freq, multiplier, modePlan.primaryGain, 1, false);
      if (secondAudible) {
        renderMode(secondFreq, multiplier * modePlan.frequencyRatio,
          modePlan.secondaryGain, modePlan.secondaryDecayRatio, true);
      }
    });
    this._schedulePartialAmplitudes(scheduled, note, t0, t1);
    this._renderExcitationNoiseFloor(note, t0, t1, env);
  }

  _seededNoiseBuffer() {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let state = Math.floor(this._nextRandom() * 0x100000000) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    for (let i = 0; i < data.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      data[i] = (state >>> 0) / 0x80000000 - 1;
    }
    return buffer;
  }

  _routePinnedBowNoiseBody(source, bands, t0) {
    let tail = source;
    for (const band of bands || []) {
      if (!Number.isFinite(band?.freq) || !Number.isFinite(band?.gain)) continue;
      const body = this.ctx.createBiquadFilter();
      body.type = "peaking";
      body.frequency.setValueAtTime(Math.max(40, band.freq), t0);
      body.Q.value = Math.max(.3, Math.min(12, 1 / Math.max(.08, band.width || .3)));
      body.gain.value = Math.max(-12, Math.min(12, band.gain * 6));
      tail.connect(body);
      tail = body;
    }
    return tail;
  }

  _pinnedBowNoiseImpulseBuffer(component) {
    const cacheKey = component.profile;
    const cached = this._bowNoiseImpulseCache.get(cacheKey);
    if (cached) return cached;
    const impulse = buildBowNoiseImpulse(component.profile,
      component.deconvolutionBands || [], this.ctx.sampleRate);
    const buffer = this.ctx.createBuffer(1, impulse.length, this.ctx.sampleRate);
    buffer.copyToChannel(impulse, 0);
    this._bowNoiseImpulseCache.set(cacheKey, buffer);
    return buffer;
  }

  /** T-054: render Agent D's immutable L14 violin residual as its own
   * body-routed component. Zero level creates no nodes and is exact legacy;
   * enabled notes use seeded continuous noise and the pinned velocity law. */
  _renderPinnedBowNoise(note, t0, t1, env) {
    const component = note.bowNoise;
    const levelControl = this._clamp(note.bowNoiseLevel ?? 0, 0, 2);
    if (!component || levelControl <= 0 || !Array.isArray(component.profile) ||
        component.profile.length < 2 || t1 - t0 < .12) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._seededNoiseBuffer();
    src.loop = true;

    const convolver = this.ctx.createConvolver();
    convolver.normalize = false;
    convolver.buffer = this._pinnedBowNoiseImpulseBuffer(component);

    const gain = this.ctx.createGain();
    const exponent = this._clamp(note.bowNoiseVelocityExponent ?? 1, 0, 2);
    // The PSD intercept is corpus-file absolute level and cannot be applied
    // directly to WebAudio's normalised harmonic sum. The measured mf NHR is
    // the dimensionless renderer contract: level 1 reproduces that residual-
    // to-harmonic ratio, while the fitted exponent moves it across dynamics.
    const rungs = Array.isArray(component.levelLaw?.rungs)
      ? component.levelLaw.rungs : [];
    const reference = rungs.find(row => row.dynamic === "mf") || rungs[0];
    const nhrDb = Number(reference?.noiseToHarmonicDb);
    const relativeScale = Number.isFinite(nhrDb) ? Math.pow(10, nhrDb / 20) : .04;
    const base = Math.max(.000001, levelControl * relativeScale *
      bowNoiseVelocityGain(note.velocity, exponent));
    gain.gain.setValueAtTime(base, t0);
    const human = this._clamp(note.excitationHuman ?? 0, 0, 1);
    const trace = humanFluctuationTrace(
      () => this._nextRandom(), t1 - t0, "bow", human);
    for (const point of trace) {
      if (point.t >= t1 - t0 - .03) continue;
      gain.gain.linearRampToValueAtTime(
        base * Math.max(.45, 1 + point.f * human * .22), t0 + point.t);
    }
    gain.gain.setValueAtTime(base, Math.max(t0, t1 - .03));

    src.connect(convolver);
    const tail = this._routePinnedBowNoiseBody(convolver, note.bodyBands, t0);
    tail.connect(gain);
    gain.connect(env);
    src.start(t0);
    src.stop(t1 + .04);
    this._track(src);
  }

  // T3 Human + T4 Transfer: one seeded fluctuation trace per note drives
  // every partial together (audit A1; the loudness-norm hack (A9) is gone —
  // a coherent excitation conserves its own energy), while sympathetic
  // transfer blooms weak partials toward their strong true-ratio relatives
  // over the sustain. Both share one merged automation timeline.
  _schedulePartialAmplitudes(partials, note, t0, t1) {
    if (partials.length === 0) return;
    const modesFor = item => [item, ...(item.followers || [])];
    partials.forEach(item => {
      const onsetTilt = (note.onsetSpectrumTilt || 0) *
        (note._articulationOnset?.transientGain ?? 1);
      const onsetGain = onsetSpectrumGain(item.part.harmonic, onsetTilt);
      modesFor(item).forEach(mode => {
        const target = mode.gainScale * Math.max(0, item.part.amp);
        const onsetTarget = target * onsetGain;
        // Q8 attack stagger: all coupled modes share the primary partial's
        // onset timing and colour, while retaining their energy split.
        if ((item.onsetDelay || 0) > 0.001) {
          mode.param.setValueAtTime(0.0001, t0);
          mode.param.linearRampToValueAtTime(onsetTarget, t0 + item.onsetDelay);
        } else {
          mode.param.setValueAtTime(onsetTarget, t0);
        }
        if (Math.abs(onsetGain - 1) > 1e-9) {
          const settle = Math.max(item.onsetDelay || 0, note.onsetSpectrumDecay || 0.06);
          mode.param.linearRampToValueAtTime(target, t0 + settle);
        }
      });
    });
    const human = this._clamp(note.excitationHuman ?? 0, 0, 1);
    const trace = humanFluctuationTrace(() => this._nextRandom(), t1 - t0, note.excitationType || "bow", human);
    const transfer = this._clamp(note.partialTransfer ?? 0, 0, 1);
    const deltas = transfer > 0 && partials.length > 1
      ? transferDeltas(partials.map(item => ({ freq: item.part.harmonicFrequency, amp: item.part.amp })), transfer)
      : null;
    const anyBloom = deltas && deltas.some(d => Math.abs(d) > 1e-5);
    // Time grid: the human trace when present; otherwise fixed checkpoints
    // so the bloom still develops on machine-steady notes.
    const points = trace.map(p => ({ t: p.t, f: p.f }));
    if (anyBloom && points.length === 0) {
      for (const t of [0.12, 0.3, 0.6, 1.0, 1.6, 2.4, 3.6]) {
        if (t < t1 - t0 - 0.02) points.push({ t, f: 0 });
      }
    }
    const tauBloom = 0.9; // s — sympathetic energy arrives over the sustain
    for (const pt of points) {
      const bloom = anyBloom ? 1 - Math.exp(-pt.t / tauBloom) : 0;
      partials.forEach((item, i) => {
        const n = item.part.harmonic || 1;
        const sens = item.part.sens ?? 0.3;
        let v = item.part.amp * (1 + human * sens * pt.f * humanPartialShape(n));
        if (anyBloom) v += deltas[i] * bloom;
        modesFor(item).forEach(mode => {
          mode.param.linearRampToValueAtTime(mode.gainScale * Math.max(0, v), t0 + pt.t);
        });
      });
    }
  }

  // T-001/T-039 shared continuous excitation-noise renderer. Bowed notes use
  // the same seeded, envelope-coupled component boundary as blown airflow;
  // T-054's pinned violin spectrum supplies bow-specific colour/body/level
  // data, while the established blown branch below remains byte-for-byte the
  // same DSP graph and keeps all wind-fitted values behind its family gate.
  _renderExcitationNoiseFloor(note, t0, t1, env) {
    const excitation = note.excitationType || "";
    if (excitation === "bow") {
      this._renderPinnedBowNoise(note, t0, t1, env);
      return;
    }
    if (excitation !== "blow") return;
    if (!this._noiseBuffer || !note.velocity || t1 - t0 < 0.15) return;
    const airflow = this._clamp(note.toneBreathLevel ?? 0, 0, 1);
    if (airflow <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    const centre = 2200 * Math.pow(2, (note.breathNoiseColor || 0) * 2);
    bp.frequency.setValueAtTime(centre, t0);
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    const level = Math.max(0.0001,
      breathVelocityGain(note.velocity, note.breathVelocityExponent) * airflow * 0.2 *
      this._clamp(note.breathLevelScale ?? 1, 0, 3));
    const breathLead = (note.articulationCoupling || 0) > 0
      ? level * (note._articulationOnset?.breathLeadGain ?? 1)
      : 0.0001;
    g.gain.setValueAtTime(Math.max(0.0001, breathLead), t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.08);
    const turbulence = this._clamp(note.breathTurbulence ?? 0, 0, 1);
    if (turbulence > 0) {
      const trace = humanFluctuationTrace(
        () => this._nextRandom(), t1 - t0, "blow", turbulence);
      for (const point of trace) {
        if (point.t <= 0.08 || point.t >= t1 - t0 - 0.06) continue;
        const at = t0 + point.t;
        g.gain.linearRampToValueAtTime(
          level * Math.max(0.4, 1 + point.f * turbulence * 0.3), at);
        bp.frequency.linearRampToValueAtTime(
          centre * Math.pow(2, point.f * turbulence * 0.18), at);
      }
    }
    g.gain.setValueAtTime(level, Math.max(t0 + 0.08, t1 - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t1);
    src.connect(bp);
    let tail = bp;
    const bodyAmount = this._clamp(note.breathBodyAmount ?? 0, 0, 1);
    if (bodyAmount > 0 && Array.isArray(note.bodyBands)) {
      for (const band of note.bodyBands) {
        if (!Number.isFinite(band?.freq) || !Number.isFinite(band?.gain)) continue;
        const body = this.ctx.createBiquadFilter();
        body.type = "peaking";
        body.frequency.setValueAtTime(Math.max(40, band.freq), t0);
        body.Q.value = Math.max(0.3, Math.min(12, 1 / Math.max(0.08, band.width || 0.3)));
        body.gain.value = Math.max(-12, Math.min(12, band.gain * 6 * bodyAmount));
        tail.connect(body);
        tail = body;
      }
    }
    tail.connect(g);
    g.connect(env);
    src.start(t0);
    src.stop(t1 + 0.02);
    this._track(src);
  }

  _nextRandom() {
    return this._engine?.rng?.next ? this._engine.rng.next() : Math.random();
  }

  _gaussian() {
    const u1 = Math.max(1e-6, this._nextRandom());
    const u2 = Math.max(1e-6, this._nextRandom());
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  }

  /**
   * Instrument onset transient (breath chiff, bow noise, lip buzz, hammer
   * thump): a short filtered-noise burst at note start, scaled by velocity.
   * This carries a large share of instrument identity that a static
   * spectrum cannot.
   */
  _renderAttackNoise(note, t0, env, out) {
    const an = note._bowScratch?.enabled ? note._bowScratch : note.attackNoise;
    if (!an || !this._noiseBuffer || !note.velocity) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(Math.max(80, an.freq || 2000), t0);
    bp.Q.value = Math.max(0.3, an.q || 1);
    const g = this.ctx.createGain();
    const velocityGain = attackNoiseVelocityGain(note.velocity, note.attackNoiseVelocityExponent);
    const articulationGain = note._articulationOnset?.transientGain ?? 1;
    const peak = Math.max(0.0001,
      velocityGain * articulationGain * (an.level ?? 0.2) * 0.3);
    const decay = Math.max(0.015, an.decay || 0.05);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(bp);
    bp.connect(g);
    const routing = attackNoiseRouting(note.attackNoiseDirect);
    if (routing.directGain <= 0) {
      g.connect(env);
    } else if (routing.envelopeGain <= 0) {
      g.connect(out);
    } else {
      const legacy = this.ctx.createGain();
      const direct = this.ctx.createGain();
      legacy.gain.value = routing.envelopeGain;
      direct.gain.value = routing.directGain;
      g.connect(legacy); legacy.connect(env);
      g.connect(direct); direct.connect(out);
    }
    src.start(t0);
    src.stop(t0 + decay + 0.02);
    this._track(src);
  }

  _renderBreath(note, t0, t1, env) {
    // Blown Fourier notes use the body-coloured, airflow-coupled floor above.
    // Rendering this legacy layer as well would double their breath signal.
    if ((note.excitationType || "") === "blow") return;
    const level = note.toneBreathLevel || 0;
    if (level <= 0 || !this._noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(900, t0);
    const g = this.ctx.createGain();
    const base = Math.max(0.0001, note.velocity * level * 0.2);
    g.gain.setValueAtTime(base, t0);
    g.gain.linearRampToValueAtTime(0.0001, t1);
    const sync = this._clamp(note.voiceBreathSync ?? 0, 0, 1);
    if (sync > 0) {
      const pulse = this.ctx.createOscillator();
      pulse.type = "sine";
      pulse.frequency.setValueAtTime(Math.max(20, note.frequency || 120), t0);
      const depth = this.ctx.createGain();
      depth.gain.value = base * sync * 0.65;
      pulse.connect(depth);
      depth.connect(g.gain);
      pulse.start(t0);
      pulse.stop(t1 + 0.02);
      this._track(pulse);
    }
    src.connect(hp);
    hp.connect(g);
    g.connect(env);
    src.start(t0);
    src.stop(t1 + 0.02);
    this._track(src);
  }

  _adsr(vel, t0, t1, note = {}) {
    const g = this.ctx.createGain();
    const noteDur = Math.max(0.01, t1 - t0);
    const atk = Math.min(noteDur * 0.45, note.envelopeAttack ?? 0.008);
    const dec = Math.min(noteDur * 0.45, note.envelopeDecay ?? 0.04);
    const sus = vel * Math.max(0.05, Math.min(1, note.envelopeSustain ?? 0.6));
    const rel = Math.min(note.envelopeRelease ?? 0.08, noteDur * 0.55);
    // Q8 release ring: material keeps the resonator ringing past note-off
    // at its own T60 instead of the envelope's hard cut (renderers extend
    // their oscillator stop times by note._ringSec to let the tail sound).
    const ring = releaseRingSeconds(note.partialMaterial, note.frequency, note.releaseDamping);
    const doubleDecay = this._clamp(note.decaySecondStage ?? 0, 0, 1);
    const doubleRatio = this._clamp(note.decaySecondRatio ?? 1, 1, 8);
    note._ringSec = Math.min(3.5, ring * (1 + doubleDecay * (doubleRatio - 1) * 0.5));
    const release = (fromT) => {
      if (ring > 0.05) {
        g.gain.setTargetAtTime(0.0001, fromT, ring / 6.91); // -60 dB at ~6.91τ
      } else {
        g.gain.linearRampToValueAtTime(0.0001, t1);
      }
    };
    if (note.legatoFromPrevious) {
      const joinFade = Math.min(0.006, noteDur * 0.12);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, sus), t0 + joinFade);
      g.gain.setValueAtTime(Math.max(0.0001, sus), Math.max(t0 + joinFade, t1 - rel));
      release(Math.max(t0 + joinFade, t1 - rel));
      return g;
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vel, t0 + atk);
    g.gain.linearRampToValueAtTime(sus, t0 + atk + dec);
    g.gain.setValueAtTime(sus, Math.max(t0 + atk + dec, t1 - rel));
    release(Math.max(t0 + atk + dec, t1 - rel));
    return g;
  }

  _track(node) {
    this._nodes.push(node);
    node.onended = () => { const i = this._nodes.indexOf(node); if (i >= 0) this._nodes.splice(i, 1); };
  }
}

// ─── Headphone check ────────────────────────────────────────

export class HeadphoneCheck {
  constructor(ctx) { this.ctx = ctx; }
  playTone(channel, duration = 0.8) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine"; osc.frequency.value = 500;
    const m = this.ctx.createChannelMerger(2);
    const L = this.ctx.createGain(); const R = this.ctx.createGain();
    L.gain.value = channel === "right" ? 0 : 0.5;
    R.gain.value = channel === "left"  ? 0 : 0.5;
    osc.connect(L); osc.connect(R);
    L.connect(m, 0, 0); R.connect(m, 0, 1);
    m.connect(this.ctx.destination);
    osc.start(); osc.stop(this.ctx.currentTime + duration);
  }
}
