/**
 * synth.js — Three-timescale generative synthesiser for Sound Studio.
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

export const REVERB_PROFILES = {
  room: { label: "Room", duration: 0.9, shape: 2.2, early: 0.55, shimmer: 0.10 },
  plate: { label: "Plate", duration: 1.8, shape: 1.25, early: 0.28, shimmer: 0.30 },
  hall: { label: "Hall", duration: 2.9, shape: 1.7, early: 0.42, shimmer: 0.16 },
  cathedral: { label: "Cathedral", duration: 5.2, shape: 1.1, early: 0.35, shimmer: 0.12 },
  spring: { label: "Spring", duration: 1.5, shape: 1.55, early: 0.22, shimmer: 0.45 },
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

for (const [profileKey, resonances] of Object.entries(SPECTRAL_RESONANCES)) {
  if (SPECTRAL_PROFILES[profileKey]) SPECTRAL_PROFILES[profileKey].resonances = resonances;
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

// Body gain at one frequency: Gaussian bands in log-frequency space,
// summed in log gain. Pure so T-B6 asserts it headlessly, and so the
// renderer can evaluate it against a partial's MODULATED frequency
// (vibrato FM → body AM).
export function bodyResponse(bands, freqHz, amount) {
  if (!amount || amount <= 0 || !bands || bands.length === 0) return 1;
  let logGain = 0;
  for (const band of bands) {
    const freq = Math.max(20, band.freq || 1000);
    const width = Math.max(0.08, band.width || 0.5);
    const octDist = Math.log2(Math.max(20, freqHz) / freq);
    logGain += (band.gain || 0) * Math.exp(-0.5 * (octDist / width) ** 2);
  }
  return Math.max(0.2, Math.min(4.5, Math.pow(2, logGain * amount)));
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
  const perf = prof.performance || (prof.performance = {});
  if (Number.isFinite(m.material)) perf.partialMaterial = m.material;
  if (Number.isFinite(m.partialB)) perf.partialB = m.partialB;
  if (m.attackNoise && Number.isFinite(m.attackNoise.level)) {
    perf.attackNoise = { level: m.attackNoise.level, freq: m.attackNoise.freq, q: m.attackNoise.q, decay: m.attackNoise.decay };
  }
  const mp = m.performance || {};
  for (const key of ["vibratoRate", "vibratoRateSd", "vibratoDepthSd"]) {
    if (Number.isFinite(mp[key])) perf[key] = mp[key];
  }
  if (Number.isFinite(mp.vibratoDepth) && Number.isFinite(perf.vibratoDepth)) {
    perf.vibratoDepth = +((perf.vibratoDepth + mp.vibratoDepth) / 2).toFixed(1);
  }
  prof.measured = { source: m.source || "" };
}

// ── Tone model v2: resonator core (docs/TONE_MODEL_V2_DESIGN.md §3.2) ──
//
// The resonator's mode frequencies come from a physical ratio table bent by
// true stiff-string inharmonicity; its decay comes from a material damping
// law expressed in real Hz. These are pure functions so the acceptance-bar
// assertions (T-B2, T-B3) can verify them headlessly.

export const RESONATOR_CLASSES = {
  string:     { label: "String / open tube", ratio: (n) => n },
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

// True stiff-string inharmonicity, anchored so mode 1 stays at the played
// pitch: f_n = ratio_n · f0 · sqrt((1 + B·n²) / (1 + B)). B is a physical
// constant (piano bass ≈ 1e-4, treble ≈ 1e-3) and gives the same
// frequencies regardless of how many partials are rendered (audit A4).
export function partialFrequency(n, f0, B = 0, className = "string") {
  const b = Math.max(0, B || 0);
  return resonatorRatio(className, n) * f0 * Math.sqrt((1 + b * n * n) / (1 + b));
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

export function excitationSpectrum(type, n, { position = 0.5, hardness = 0.6, freqHz = n * 261.63 } = {}) {
  return excitationDrive(type, n) * positionComb(n, position) * hardnessRolloff(freqHz, hardness, type);
}

// Louder = brighter (audit A14): one global law replaces the per-partial
// dyn grids. The velocity exponent grows with mode number so upper partials
// bloom under force the way strings and air columns actually do (Schelleng
// bow-force behaviour); spectralDynamicAmount scales the whole law.
export function dynamicBrightness(n) {
  return 0.5 * Math.log2(1 + Math.max(1, n));
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
   */
  constructor(divisions, allDegrees, subScale, weight, tonicHz = 261.63) {
    this.div = divisions;
    this.all = allDegrees;
    this.sub = subScale.length > 0 ? subScale : allDegrees;
    this.weight = weight;
    this.tonicHz = tonicHz;
  }

  degreeToHz(degree) {
    return this.tonicHz * Math.pow(2, degree / this.div);
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
    this.p = params;
    this.rng = new SeededRNG(params.seed || 42);
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
      motifIndex: this._motifIdx,
      baseIndex: this.repertoire ? this.repertoire.baseIndexFor(this._motifIdx) : this._motifIdx,
      isVariant: this.repertoire ? this._motifIdx >= this.repertoire.baseLen : false,
      motifNoteIndex,
      motifNotesCount,
      durationDivs,
      gapFraction,
      intonationCents,
      legatoFromPrevious,
      slideFromFrequency: legatoFromPrevious ? previousFrequency : null,
      slideDuration,
      startDiv: note.startDiv || 0,
      isMotifStart,
      beatDivisions: beatDiv,
      motifLengthDivs: motifBeats * beatDiv,
      pitchBits,
      ...subNote,
    };
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
    return new Scale(div, allDeg, subDeg, this.p.subScaleWeight, this.p.tonicHz || 261.63);
  }

  _subNoteVariation(velocity = 0.6, fundamentalHz = 261.63, degree = 0, formantPos = null) {
    return {
      ...this._toneColourImperfection(),
      ...this._vibratoParams(),
      ...this._spectralFingerprint(velocity, fundamentalHz, degree, formantPos),
      ...this._envelopeVariation(),
    };
  }

  _vibratoParams() {
    return {
      vibratoProb: this.p.vibratoProb ?? 0,
      vibratoDepth: this.p.vibratoDepth ?? 0,
      vibratoDepthSd: this.p.vibratoDepthSd ?? 0,
      vibratoRate: this.p.vibratoRate ?? 5.5,
      vibratoRateSd: this.p.vibratoRateSd ?? 0,
    };
  }

  _toneColourImperfection() {
    if ((this.p.voiceMode || "formant") !== "formant") return {};
    if (this.rng.next() >= (this.p.toneColorProb ?? 0)) return {};
    const formant = this.p.toneFormantDrift ?? 0;
    const resonance = this.p.toneResonanceDrift ?? 0;
    const breath = this.p.toneBreath ?? 0;
    return {
      toneFormantShift: (this.rng.next() * 2 - 1) * formant,
      toneResonanceShift: (this.rng.next() * 2 - 1) * resonance,
      toneBreathLevel: this.rng.next() * breath,
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
    const count = Math.max(1, Math.min(profile.partials.length, Math.round(this.p.spectralPartials ?? 12)));
    const dynamicsAmount = Math.max(0, this.p.spectralDynamicAmount ?? 0.8);
    const resonanceAmount = this._clamp(this.p.spectralResonanceAmount ?? 0.35, 0, 1.5);
    const velocityRatio = Math.max(0.08, velocity / 0.62);
    const means = Array.isArray(this.p.spectralPartialMeans) ? this.p.spectralPartialMeans : [];
    const sds = Array.isArray(this.p.spectralPartialSds) ? this.p.spectralPartialSds : [];
    // The Body stage (T5): fixed-Hz resonance bands — instrument body by
    // default ("auto"), or any BODY_PRESETS entry incl. the vowels. This
    // is the ONLY register-dependent shaping now: the per-partial reg
    // grids are retired (audit A7 — register timbre emerges from where
    // the partials fall against fixed-Hz bands, not hand-set exponents).
    const baseBands = (Array.isArray(this.p.bodyBands) && this.p.bodyBands.length)
      ? this.p.bodyBands                       // preset used as a starting point, then band-edited
      : bodyBandsFor(this.p, profile);
    const artic = this._articulatedBands(formantPos);
    const bodyBands = artic ? baseBands.concat(artic) : baseBands;
    // Tone v2 (T2): resolve the excitation once per note. Current settings
    // are applied as a transform NORMALISED against the profile's own
    // excitation defaults — the measured amplitude tables already embody
    // the instrument played at its natural position, so defaults → exactly
    // 1 and old presets are untouched; moving position/type/hardness
    // reshapes the spectrum relative to that natural state.
    const partialB = Number.isFinite(this.p.partialB)
      ? Math.max(0, this.p.partialB)
      : legacyStretchToB(this.p.spectralStretchCents ?? 0);
    const resClass = this.p.resonatorClass || "string";
    const excDefault = profile.performance?.excitation || { type: "bow", position: 0.5, hardness: 0.6 };
    const excType = this.p.excitationType || excDefault.type || "bow";
    const excPos = Number.isFinite(this.p.excitationPosition) ? this.p.excitationPosition : (excDefault.position ?? 0.5);
    let excHard = Number.isFinite(this.p.excitationHardness) ? this.p.excitationHardness : (excDefault.hardness ?? 0.6);
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
    const partials = profile.partials.slice(0, count).map((partial, i) => {
      const fallbackAmp = typeof partial === "number" ? partial : partial.amp;
      const fallbackSd = fallbackAmp * (typeof partial === "number" ? 0.08 : partial.spread ?? 0.25) * 0.5;
      const amp = this._clamp(means[i] ?? fallbackAmp, 0, 1.5);
      const sd = this._clamp(sds[i] ?? fallbackSd, 0, 0.75);
      const harmonic = i + 1;
      // Dynamic-brightness law (T2, audit A14): the per-partial dyn grids
      // are retired — louder playing brightens the top by one global law.
      const dynamics = Math.pow(velocityRatio, dynamicBrightness(harmonic) * dynamicsAmount);
      // Realised mode frequency (T1 law) — body resonances and hardness
      // rolloff both act on where the partial actually sits.
      const harmonicFrequency = Math.max(1, partialFrequency(harmonic, fundamentalHz, partialB, resClass));
      const registerResponse = bodyResponse(bodyBands, harmonicFrequency, resonanceAmount);
      const excCur = excitationSpectrum(excType, harmonic, { position: excPos, hardness: excHard, freqHz: harmonicFrequency });
      const excBase = excitationSpectrum(excDefault.type || "bow", harmonic, {
        position: excDefault.position ?? 0.5, hardness: excDefault.hardness ?? 0.6, freqHz: harmonicFrequency,
      });
      const excitation = excBase > 1e-6 ? Math.min(8, excCur / excBase) : (excCur > 1e-6 ? 8 : 1);
      const dynamicMean = amp * dynamics * registerResponse * excitation * this._partialMacroGain(harmonic);
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
    return {
      harmonicPartials: partials,
      attackNoise: (() => {
        const an = profile.performance?.attackNoise;
        if (!an) return null;
        // CH-B2: user-scalable onset transient (1 = the instrument's own)
        const lvl = this._clamp(this.p.attackNoiseLevel ?? 1, 0, 2);
        return lvl === 1 ? an : { ...an, level: an.level * lvl };
      })(),
      partialMaterial: this.p.partialMaterial ?? profile.performance?.partialMaterial ?? 0.45,
      spectralMix: this.p.spectralMix ?? 0,
      excitationType: excType,
      excitationHuman: human,
      partialTransfer: this._clamp(this.p.partialTransfer ?? 0.15, 0, 1),
      // Body stage (T5): carried on the note so the renderer can evaluate
      // the body against MODULATED frequencies (vibrato FM → body AM).
      bodyBands,
      bodyAmount: resonanceAmount,
      spectralReferenceNorm: Math.max(0.001, referenceNorm),
      spectralStretchCents: this.p.spectralStretchCents ?? 0,
      // Tone v2 resonator (T1): inharmonicity as a physical B constant
      // (new param wins; legacy cents map onto it) and the mode ratio class.
      partialB: Number.isFinite(this.p.partialB)
        ? Math.max(0, this.p.partialB)
        : legacyStretchToB(this.p.spectralStretchCents ?? 0),
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

  _envelopeVariation() {
    const vary = this.rng.next() < (this.p.envelopeProb ?? 0);
    const sample = (mean, sd, lo, hi) => {
      const base = this._clamp(mean, lo, hi);
      if (!vary || sd <= 0) return base;
      return this._clamp(base + this._gaussian() * sd, lo, hi);
    };
    return {
      envelopeAttack: sample(this.p.envelopeAttack ?? 0.008, this.p.envelopeAttackSd ?? 0.006, 0.001, 0.18),
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
    // bass shelf → air-absorption lowpass → arrival delay → HRTF panner
    // (interaural time/level + head shadow + 1/r attenuation).
    this._spaceProximity = this.ctx.createBiquadFilter();
    this._spaceProximity.type = "lowshelf";
    this._spaceProximity.frequency.value = 180;
    this._spaceProximity.gain.value = 0;
    this._spaceAir = this.ctx.createBiquadFilter();
    this._spaceAir.type = "lowpass";
    this._spaceAir.frequency.value = 20000;
    this._spaceAir.Q.value = 0.5;
    this._spaceDelay = this.ctx.createDelay(0.12);
    this._spacePanner = this.ctx.createPanner ? this.ctx.createPanner() : null;
    if (this._spacePanner) {
      this._spacePanner.panningModel = "HRTF";
      this._spacePanner.distanceModel = "inverse";
      this._spacePanner.refDistance = 1;
      this._spacePanner.rolloffFactor = 1;
      this._spacePanner.positionZ ? this._spacePanner.positionZ.value = -2.5 : this._spacePanner.setPosition(0, 0, -2.5);
    }

    this.master.connect(this._spaceProximity);
    this._spaceProximity.connect(this._spaceAir);
    this._spaceAir.connect(this._spaceDelay);
    if (this._spacePanner) {
      this._spaceDelay.connect(this._spacePanner);
      this._spacePanner.connect(this._dryGain);
    } else {
      this._spaceDelay.connect(this._dryGain);
    }
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

    // Percussion bus
    this._percGain = this.ctx.createGain();
    this._percGain.gain.value = 1.0;
    this._percGain.connect(this.master);

    // Pre-generate noise buffer for percussion synthesis
    const sr = this.ctx.sampleRate;
    this._noiseBuffer = this.ctx.createBuffer(1, sr, sr);
    const nd = this._noiseBuffer.getChannelData(0);
    for (let i = 0; i < sr; i++) nd[i] = Math.random() * 2 - 1;
  }

  /** Start playing with the given parameters. Resets the engine. */
  play(params) {
    this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
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
    this._percParams = {
      percBeatVol: params.percBeatVol || 0,
      percBeatSound: params.percBeatSound || "click",
      percMotifVol: params.percMotifVol || 0,
      percMotifSound: params.percMotifSound || "bell",
      percDownbeatVol: params.percDownbeatVol || 0,
      percDownbeatSound: params.percDownbeatSound || "wood",
      percDownbeatEvery: params.percDownbeatEvery || 4,
    };
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
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
    this._timeline = [];
    this._configureReverb(params);
    this._percParams = {
      percBeatVol: params.percBeatVol || 0,
      percBeatSound: params.percBeatSound || "click",
      percMotifVol: params.percMotifVol || 0,
      percMotifSound: params.percMotifSound || "bell",
      percDownbeatVol: params.percDownbeatVol || 0,
      percDownbeatSound: params.percDownbeatSound || "wood",
      percDownbeatEvery: params.percDownbeatEvery || 4,
    };
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
   * Schedule a baked note list into the current context from t0. Timbre is
   * frozen per note (each carries its sampled fingerprint); timing follows
   * the CURRENT tempo via beat-space offsets. Graph must be initialised.
   */
  renderNotesSpan(params, notes, t0, totalBeats = null, loopBeats = null) {
    if (!this.ctx || !Array.isArray(notes)) return;
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
    this._timeline = [];
    this._configureReverb(params);
    this._percParams = {
      percBeatVol: params.percBeatVol || 0,
      percBeatSound: params.percBeatSound || "click",
      percMotifVol: params.percMotifVol || 0,
      percMotifSound: params.percMotifSound || "bell",
      percDownbeatVol: params.percDownbeatVol || 0,
      percDownbeatSound: params.percDownbeatSound || "wood",
      percDownbeatEvery: params.percDownbeatEvery || 4,
    };
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
        this._schedulePerc(note, t, divSec);
      }
    }
  }

  /** Live playback of a baked note list (all scheduled upfront). */
  playNotes(params, notes, totalBeats = null, loopBeats = null) {
    this.init();
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.stop();
    if (this._masterOut) {
      const now = this.ctx.currentTime;
      this._masterOut.gain.cancelScheduledValues(now);
      this._masterOut.gain.setTargetAtTime(this._masterVolume, now, 0.012);
    }
    this.renderNotesSpan(params, notes, this.ctx.currentTime + 0.05, totalBeats, loopBeats);
    this.playing = true;
  }

  _configureReverb(params = {}) {
    if (!this._dryGain || !this._wetGain || !this._convolver) return;
    this._configureSpace(params); // position rides every reverb configure
    const wet = this._clamp(params.reverbWet ?? 0, 0, 0.95);
    const decay = this._clamp(params.reverbDecay ?? 1.4, 0.2, 8);
    const tone = this._clamp(params.reverbTone ?? 0.6, 0, 1);
    const preDelay = this._clamp(params.reverbPreDelay ?? 0.015, 0, 0.25);
    const type = REVERB_PROFILES[params.reverbType] ? params.reverbType : "room";
    const now = this.ctx.currentTime;

    const dry = Math.cos(wet * Math.PI * 0.5);
    const wetGain = Math.sin(wet * Math.PI * 0.5);
    this._dryGain.gain.setTargetAtTime(dry, now, 0.015);
    this._wetGain.gain.setTargetAtTime(wetGain, now, 0.015);
    this._preDelay.delayTime.setTargetAtTime(preDelay, now, 0.015);
    this._reverbTone.frequency.setTargetAtTime(1200 * Math.pow(2, tone * 3.8), now, 0.02);
    this._reverbTone.Q.setTargetAtTime(0.45 + tone * 0.9, now, 0.02);

    const key = `${type}:${decay.toFixed(2)}:${tone.toFixed(2)}`;
    if (key !== this._reverbKey) {
      this._convolver.buffer = this._buildImpulseResponse(type, decay, tone);
      this._reverbKey = key;
    }
  }

  updateReverb(params = {}) {
    if (!this.ctx) return;
    this._configureReverb(params);
  }

  // SPACE positioning: distance + azimuth → arrival delay, air absorption,
  // proximity shelf, and the HRTF panner position. Smoothed for live moves;
  // deterministic (no randomness).
  _configureSpace(p = {}) {
    if (!this.ctx || !this._spaceDelay) return;
    const d = Math.max(0.3, Math.min(30, Number(p.spaceDistance ?? 2.5)));
    const azDeg = Math.max(-90, Math.min(90, Number(p.spaceAzimuth ?? 0)));
    const az = azDeg * Math.PI / 180;
    const now = this.ctx.currentTime;
    const smooth = (param, v) => {
      try { param.setTargetAtTime(v, now, 0.05); } catch { param.value = v; }
    };
    smooth(this._spaceDelay.delayTime, spaceArrivalDelay(d));
    smooth(this._spaceAir.frequency, spaceAirCutoff(d));
    smooth(this._spaceProximity.gain, spaceProximityDb(d));
    if (this._spacePanner) {
      const x = Math.sin(az) * d, z = -Math.cos(az) * d;
      if (this._spacePanner.positionX) {
        smooth(this._spacePanner.positionX, x);
        smooth(this._spacePanner.positionZ, z);
      } else {
        this._spacePanner.setPosition(x, 0, z);
      }
    }
  }

  updateGenerationParams(params = {}) {
    if (!this._engine) return;
    this._engine.p = { ...this._engine.p, ...params };
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
    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._surpriseCount = 0;
    this._lastSurpriseAt = 0;
    this._timeline = [];
    this._engine = new GenerationEngine(params);
    this._engine.initialise();
    return true;
  }

  _buildImpulseResponse(type, decay, tone) {
    const profile = REVERB_PROFILES[type] || REVERB_PROFILES.room;
    const sr = this.ctx.sampleRate;
    const duration = this._clamp(profile.duration * decay, 0.15, 10);
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
        let sample = (low * 0.65 + noise * brightness * 0.35) * env;

        if (type === "spring") {
          sample *= 0.72 + 0.28 * Math.sin(i * 0.047 + Math.sin(i * 0.003) * 2.5);
          sample += Math.sin(i * 0.021 + ch) * env * 0.035;
        }
        data[i] = sample;
      }

      const earlyCount = Math.max(4, Math.round(8 + profile.early * 16));
      for (let r = 0; r < earlyCount; r++) {
        const pos = Math.min(length - 1, Math.floor(sr * (0.006 + r * (0.006 + profile.early * 0.006) + ch * 0.002)));
        const amp = (profile.early / (r + 1)) * (r % 2 === 0 ? 1 : -0.7);
        data[pos] += amp;
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
      if (!note) { this.stop(); return; }
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
      });
      if (this._timeline.length > 320) this._timeline.splice(0, this._timeline.length - 320);

      this._nextTime += noteDur;
    }
    this._timer = setTimeout(() => this._schedule(), 90);
  }

  // ── Percussion scheduling ──

  _schedulePerc(note, noteStartTime, divSec) {
    const p = this._percParams;
    if (!p) return;
    const beatDiv = note.beatDivisions || 1;

    for (let i = 0; i < note.durationDivs; i++) {
      const d = note.startDiv + i;
      const t = noteStartTime + i * divSec;
      const isOnBeat = d % beatDiv === 0;
      const beatNum = Math.floor(d / beatDiv);

      // Layer 1: Beat tick
      if (isOnBeat && p.percBeatVol > 0) {
        this._renderPercHit(p.percBeatSound, t, p.percBeatVol);
      }
      // Layer 2: Motif accent
      if (d === 0 && p.percMotifVol > 0) {
        this._renderPercHit(p.percMotifSound, t, p.percMotifVol);
      }
      // Layer 3: Downbeat every N beats
      if (isOnBeat && p.percDownbeatVol > 0 && beatNum % (p.percDownbeatEvery || 4) === 0) {
        this._renderPercHit(p.percDownbeatSound, t, p.percDownbeatVol);
      }
    }
  }

  _renderPercHit(soundName, t0, vol) {
    const sound = PERC_SOUNDS[soundName];
    if (!sound || vol <= 0 || t0 < this.ctx.currentTime - 0.02) return;

    const decay = sound.decay || 0.05;

    if (sound.type === "noise") {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer;
      const filt = this.ctx.createBiquadFilter();
      filt.type = sound.filterType || "highpass";
      filt.frequency.setValueAtTime(sound.filterFreq || 4000, t0);
      filt.Q.value = sound.filterQ || 1;
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vol * sound.amp, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
      src.connect(filt); filt.connect(env); env.connect(this._percGain);
      src.start(t0); src.stop(t0 + decay + 0.01);
      this._track(src);
    } else if (sound.type === "sine") {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(sound.freq || 800, t0);
      if (sound.freqEnd) osc.frequency.exponentialRampToValueAtTime(sound.freqEnd, t0 + decay);
      const env = this.ctx.createGain();
      env.gain.setValueAtTime(vol * sound.amp, t0);
      env.gain.exponentialRampToValueAtTime(0.001, t0 + decay);
      osc.connect(env); env.connect(this._percGain);
      osc.start(t0); osc.stop(t0 + decay + 0.01);
      this._track(osc);
    }
  }

  // ── Rendering ──

  _render(note, t0) {
    if (t0 < this.ctx.currentTime - 0.02) return;
    if (note.isRest || note.velocity <= 0) return; // silence for rest surprises
    note._vibratoEvents = this._buildVibratoEvents(note, t0, t0 + note.duration);
    if (this._voiceMode === "formant" || this._voiceMode === "fourier") {
      this._renderFourier(note, t0);
    } else {
      this._renderOsc(note, t0);
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
    env.connect(this.master);

    osc.start(t0);
    osc.stop(t1 + 0.08);
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
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t1 + 0.06);
    this._track(osc);
  }

  /** Additive Fourier synthesis: fixed harmonic slots → shared envelope. */
  _renderFourier(note, t0) {
    const t1 = t0 + note.duration;
    const env = this._adsr(note.velocity, t0, t1, note);
    this._renderSpectralPartials(note, t0, t1, env);
    this._renderAttackNoise(note, t0, env);
    this._renderBreath(note, t0, t1, env);
    env.connect(this.master);
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
    const events = note._vibratoEvents || [];
    const baseAt = (time) => {
      if (slide > 0.001 && time < t0 + slide && Math.abs(from - target) > 0.01) {
        const progress = this._clamp((time - t0) / slide, 0, 1);
        return from * Math.pow(target / from, progress);
      }
      return target;
    };
    const valueAt = (time, cents = 0) => baseAt(time) * Math.pow(2, cents / 1200);

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
      if (Math.max(part.amp, part.mean) / norm < 0.0005 && harmonic > 8) return;
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      this._setFrequency(osc.frequency, freq, t0, note, multiplier);
      const g = this.ctx.createGain();
      // T2 (audit A8): the hidden 1.4/√n rolloff is gone — what the print
      // shows is exactly what renders; spectral shaping lives only in the
      // model (excitation × macros × material × body).
      const gainScale = mix / norm;
      scheduled.push({ param: g.gain, part, gainScale });
      osc.connect(g);
      let tail = g;
      // FM→AM through the body (T5): the SAME vibrato events that bend the
      // pitch re-evaluate the body gain at the modulated frequency, so a
      // partial sitting on a body ridge shimmers in amplitude exactly in
      // phase with the vibrato. Only partials on meaningful slopes get the
      // extra node; symmetric peaks stay still, as physics says they should.
      const vibEvents = note._vibratoEvents || [];
      if (vibEvents.length > 2 && note.bodyBands && note.bodyBands.length && (note.bodyAmount || 0) > 0) {
        const r0 = bodyResponse(note.bodyBands, freq, note.bodyAmount);
        let minC = 0, maxC = 0;
        for (const e of vibEvents) { if (e.cents < minC) minC = e.cents; if (e.cents > maxC) maxC = e.cents; }
        const rHi = bodyResponse(note.bodyBands, freq * Math.pow(2, maxC / 1200), note.bodyAmount);
        const rLo = bodyResponse(note.bodyBands, freq * Math.pow(2, minC / 1200), note.bodyAmount);
        if (Math.abs(rHi - rLo) / r0 > 0.03) {
          const am = this.ctx.createGain();
          am.gain.setValueAtTime(1, t0);
          const stride = Math.max(1, Math.ceil(vibEvents.length / 96));
          for (let k = 1; k < vibEvents.length; k += stride) {
            const e = vibEvents[k];
            const r = bodyResponse(note.bodyBands, freq * Math.pow(2, e.cents / 1200), note.bodyAmount);
            am.gain.linearRampToValueAtTime(r / r0, e.time);
          }
          g.connect(am);
          tail = am;
        }
      }
      // Material damping law, tone v2 (T1): each partial decays with the
      // instrument's T60 at that partial's REAL frequency (audits A2/A3) —
      // a 4 kHz mode rings the same whether it is n=4 of a high note or
      // n=16 of a low one, and decay no longer depends on note duration.
      // Wood/felt kills the highs, glass/metal lets them ring.
      const material = Math.max(0, Math.min(1, note.partialMaterial ?? 0));
      if (material > 0 && harmonic > 1) {
        const decayG = this.ctx.createGain();
        const t60 = materialT60(freq, material);
        const tau = Math.max(0.02, t60 / 6.91); // setTargetAtTime hits -60 dB at ~6.91τ
        decayG.gain.setValueAtTime(1, t0);
        decayG.gain.setTargetAtTime(0.0001, t0 + 0.01, tau);
        tail.connect(decayG); // tail is g, or the body-AM node when vibrato rides a ridge
        decayG.connect(env);
        tail = null;
      }
      if (tail) tail.connect(env);
      osc.start(t0);
      osc.stop(t1 + 0.04);
      this._track(osc);
    });
    this._schedulePartialAmplitudes(scheduled, note, t0, t1);
    if ((note.excitationType || "") === "blow") this._renderBlowFloor(note, t0, t1, env);
  }

  // T3 Human + T4 Transfer: one seeded fluctuation trace per note drives
  // every partial together (audit A1; the loudness-norm hack (A9) is gone —
  // a coherent excitation conserves its own energy), while sympathetic
  // transfer blooms weak partials toward their strong true-ratio relatives
  // over the sustain. Both share one merged automation timeline.
  _schedulePartialAmplitudes(partials, note, t0, t1) {
    if (partials.length === 0) return;
    partials.forEach(item => item.param.setValueAtTime(item.gainScale * Math.max(0, item.part.amp), t0));
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
        item.param.linearRampToValueAtTime(item.gainScale * Math.max(0, v), t0 + pt.t);
      });
    }
  }

  // Continuous breath-noise floor for blown excitation (T3): air is always
  // audibly moving through a wind instrument; level follows the Human dial.
  _renderBlowFloor(note, t0, t1, env) {
    if (!this._noiseBuffer || !note.velocity || t1 - t0 < 0.15) return;
    const human = this._clamp(note.excitationHuman ?? 0, 0, 1);
    if (human <= 0) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(2200, t0);
    bp.Q.value = 0.7;
    const g = this.ctx.createGain();
    const level = Math.max(0.0001, note.velocity * human * 0.035);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(level, t0 + 0.08);
    g.gain.setValueAtTime(level, Math.max(t0 + 0.08, t1 - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t1);
    src.connect(bp);
    bp.connect(g);
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
  _renderAttackNoise(note, t0, env) {
    const an = note.attackNoise;
    if (!an || !this._noiseBuffer || !note.velocity) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(Math.max(80, an.freq || 2000), t0);
    bp.Q.value = Math.max(0.3, an.q || 1);
    const g = this.ctx.createGain();
    const peak = Math.max(0.0001, note.velocity * (an.level || 0.2) * 0.3);
    const decay = Math.max(0.015, an.decay || 0.05);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    src.connect(bp);
    bp.connect(g);
    g.connect(env);
    src.start(t0);
    src.stop(t0 + decay + 0.02);
    this._track(src);
  }

  _renderBreath(note, t0, t1, env) {
    const level = note.toneBreathLevel || 0;
    if (level <= 0 || !this._noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(900, t0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, note.velocity * level * 0.2), t0);
    g.gain.linearRampToValueAtTime(0.0001, t1);
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
    if (note.legatoFromPrevious) {
      const joinFade = Math.min(0.006, noteDur * 0.12);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(Math.max(0.0001, sus), t0 + joinFade);
      g.gain.setValueAtTime(Math.max(0.0001, sus), Math.max(t0 + joinFade, t1 - rel));
      g.gain.linearRampToValueAtTime(0.0001, t1);
      return g;
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vel, t0 + atk);
    g.gain.linearRampToValueAtTime(sus, t0 + atk + dec);
    g.gain.setValueAtTime(sus, Math.max(t0 + atk + dec, t1 - rel));
    g.gain.linearRampToValueAtTime(0.0001, t1);
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
