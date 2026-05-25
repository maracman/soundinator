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
}

// ─── Formant presets (approximate adult male formant frequencies) ─

export const FORMANT_PRESETS = {
  ah: { f1: 730, f2: 1090, f3: 2440, label: "ah" },
  ee: { f1: 270, f2: 2290, f3: 3010, label: "ee" },
  oo: { f1: 300, f2: 870,  f3: 2240, label: "oo" },
  eh: { f1: 530, f2: 1840, f3: 2480, label: "eh" },
  oh: { f1: 570, f2: 840,  f3: 2410, label: "oh" },
};

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
  }

  _pickInitialRoot() {
    const roots = this.p.rootNotes;
    if (!roots || roots.length === 0) return 0;
    return roots[this.rng.int(0, roots.length)];
  }

  initialise() {
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
      this._maybeBakeProjectedSurprise(this._activeSurpriseProjection);
      this._motifSurprisePlan = null;
    } else if (this._activeSurpriseProjection && this._noteIdx >= this._activeSurpriseProjection.startIndex && this._noteIdx < this._activeSurpriseProjection.snapBackIndex) {
      note = { ...this._activeSurpriseProjection.notes[this._noteIdx] };
      isSurprise = true;
    }

    // ── Motif-hit accuracy ──
    // This is a transient performance/memory miss in scale degrees. It is not
    // incorporated into the motif repertoire; surprise handles incorporation.
    if (this.rng.next() > (this.p.motifHitProb ?? 1)) {
      const missRange = Math.max(0, Math.round(this.p.motifHitRange ?? 0));
      if (missRange > 0) {
        let miss = this.rng.int(-missRange, missRange + 1);
        if (miss === 0) miss = this.rng.next() < 0.5 ? -1 : 1;
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
    if (this.rng.next() > (this.p.precision ?? 1)) {
      const range = Math.max(0, this.p.precisionRange ?? 0);
      intonationCents = (this.rng.next() + this.rng.next() - 1) * range;
    }

    // Motif generation, surprises, and projections own the note formant.
    // Playback keeps that value instead of overwriting baked formant surprises.
    note.formant = note.formant || this._currentFormant;
    this._currentFormant = note.formant;

    const isMotifEnd = this._noteIdx >= this._motif.notes.length - 1;
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
    // Velocity: use override from motif note (dynamics surprise) or default
    let velocity = note.velocityOverride ?? (0.4 + this.rng.next() * 0.35);
    const restRatio = this._restRatioFor(note, beatDiv, isMotifStart);
    const isRatioRest = !note.isRest && this.rng.next() < restRatio;
    // Rest: silence the note
    if (note.isRest || isRatioRest) velocity = 0;
    const gridDuration = durationDivs * divSec;
    const fittedFrequency = this._fitFrequency(hz);
    const previousFrequency = this._lastOutputFrequency;
    const legatoFromPrevious = velocity > 0 && previousFrequency != null && this._lastGapFraction <= 0;
    const slideDuration = legatoFromPrevious ? this._slideDuration(divSec, this._lastGapFraction) : 0;
    const gapFraction = this._gapFraction(intervalFromPrev, isMotifEnd);
    const legatoTail = gapFraction <= 0 ? this._slideDuration(divSec, gapFraction) : 0;
    const duration = gapFraction > 0
      ? gridDuration * (1 - gapFraction)
      : gridDuration + legatoTail;
    const subNote = this._subNoteVariation(velocity, hz, note.degree);

    this._lastOutputDegree = note.degree;
    this._lastOutputFrequency = velocity > 0 ? fittedFrequency : null;
    this._lastGapFraction = velocity > 0 ? gapFraction : 1;

    return {
      frequency: fittedFrequency,
      duration: Math.max(gridDuration * 0.04, duration),
      formant: note.formant,
      velocity,
      isRest: !!note.isRest || isRatioRest,
      isSurprise,
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
      ...subNote,
    };
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

  _subNoteVariation(velocity = 0.6, fundamentalHz = 261.63, degree = 0) {
    return {
      ...this._toneColourImperfection(),
      ...this._vibratoParams(),
      ...this._spectralFingerprint(velocity, fundamentalHz, degree),
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

  _spectralFingerprint(velocity = 0.6, fundamentalHz = 261.63, degree = 0) {
    const profile = SPECTRAL_PROFILES[this.p.spectralProfile] || SPECTRAL_PROFILES.violin;
    const fourierMode = (this.p.voiceMode || "formant") !== "formant";
    const count = Math.max(1, Math.min(profile.partials.length, Math.round(this.p.spectralPartials ?? 12)));
    const sampleChance = this._clamp(this.p.spectralProb ?? 1, 0, 1);
    const shouldSample = this.rng.next() < sampleChance;
    const dynamicsAmount = Math.max(0, this.p.spectralDynamicAmount ?? 0.8);
    const registerAmount = this._clamp(this.p.spectralRegisterAmount ?? 0.55, 0, 1.5);
    const resonanceAmount = this._clamp(this.p.spectralResonanceAmount ?? 0.35, 0, 1.5);
    const loudnessNorm = this._clamp(this.p.spectralLoudnessNorm ?? 0.65, 0, 1);
    const velocityRatio = Math.max(0.08, velocity / 0.62);
    const means = Array.isArray(this.p.spectralPartialMeans) ? this.p.spectralPartialMeans : [];
    const sds = Array.isArray(this.p.spectralPartialSds) ? this.p.spectralPartialSds : [];
    const dyns = Array.isArray(this.p.spectralPartialDyns) ? this.p.spectralPartialDyns : [];
    const regs = Array.isArray(this.p.spectralPartialRegs) ? this.p.spectralPartialRegs : [];
    let referenceNorm = 0;
    const partials = profile.partials.slice(0, count).map((partial, i) => {
      const fallbackAmp = typeof partial === "number" ? partial : partial.amp;
      const fallbackSd = fallbackAmp * (typeof partial === "number" ? 0.08 : partial.spread ?? 0.25) * 0.5;
      const amp = this._clamp(means[i] ?? fallbackAmp, 0, 1.5);
      const sd = this._clamp(sds[i] ?? fallbackSd, 0, 0.75);
      const fallbackDyn = typeof partial === "number" ? 0 : partial.dyn ?? 0;
      const dyn = this._clamp(dyns[i] ?? fallbackDyn, -1, 4);
      const fallbackReg = typeof partial === "number"
        ? spectralDefaultRegisterSensitivity(i, count)
        : partial.reg ?? spectralDefaultRegisterSensitivity(i, count);
      const reg = this._clamp(regs[i] ?? fallbackReg, -2, 2);
      const harmonic = i + 1;
      const dynamics = Math.pow(velocityRatio, dyn * dynamicsAmount);
      const harmonicFrequency = Math.max(1, fundamentalHz * harmonic);
      const sourceResponse = this._spectralRegisterSourceResponse(reg, registerAmount, fundamentalHz);
      const filterResponse = this._spectralResonanceResponse(profile, harmonicFrequency, resonanceAmount);
      const registerResponse = sourceResponse * filterResponse;
      const dynamicMean = amp * dynamics * registerResponse;
      const sampled = shouldSample ? Math.max(0, dynamicMean + this._gaussian() * sd) : dynamicMean;
      referenceNorm += amp;
      return {
        harmonic,
        amp: sampled,
        mean: dynamicMean,
        sd,
        dyn,
        reg,
        registerResponse,
        harmonicFrequency,
      };
    });
    return {
      harmonicPartials: partials,
      spectralMix: fourierMode ? (this.p.spectralMix ?? 0) : 0,
      spectralDriftProb: this.p.spectralDriftProb ?? 1,
      spectralDriftDepth: this.p.spectralDriftDepth ?? 0.35,
      spectralDriftRate: this.p.spectralDriftRate ?? 6,
      spectralLoudnessNorm: loudnessNorm,
      spectralReferenceNorm: Math.max(0.001, referenceNorm),
      spectralStretchCents: this.p.spectralStretchCents ?? 0,
    };
  }

  _spectralRegisterSourceResponse(reg, amount, fundamentalHz) {
    if (amount <= 0 || reg === 0) return 1;
    const tonicHz = Math.max(20, this.p.tonicHz || 261.63);
    const registerOctaves = this._clamp(Math.log2(Math.max(20, fundamentalHz) / tonicHz), -2.5, 2.5);
    return this._clamp(Math.pow(2, reg * amount * registerOctaves * 0.55), 0.18, 4);
  }

  _spectralResonanceResponse(profile, harmonicFrequency, amount) {
    const resonances = profile.resonances || [];
    if (amount <= 0 || resonances.length === 0) return 1;
    let logGain = 0;
    for (const band of resonances) {
      const freq = Math.max(20, band.freq || 1000);
      const width = Math.max(0.08, band.width || 0.5);
      const octDist = Math.log2(Math.max(20, harmonicFrequency) / freq);
      logGain += (band.gain || 0) * Math.exp(-0.5 * (octDist / width) ** 2);
    }
    return this._clamp(Math.pow(2, logGain * amount), 0.2, 4.5);
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
  _pickBiasedNote(current, phrasePos) {
    const { scale, rng, p } = this;
    const peakedness = p.intervalPeakedness;
    const maxRange = p.intervalRange;

    // Build candidate pool in scale-degree steps, not chromatic/EDO units.
    const candidates = [];
    const center = scale.nearest(current);
    for (let step = -maxRange; step <= maxRange; step++) {
      const target = scale.stepFrom(center, step);
      const stepDist = Math.abs(step);

      // Base weight: stacked distribution over scale-degree distance.
      const w = Math.exp(-stepDist * peakedness);
      // Sub-scale bonus
      const subBonus = scale.sub.includes(scale.norm(target)) ? scale.weight : (1 - scale.weight);

      // Register weight: split-normal curve. Skew widens one tail and
      // narrows the other while leaving the centre itself anchored.
      let regW = 1.0;
      const regCenter = p.registerCenter ?? 0;
      const regWidth = p.registerWidth ?? 12;
      const regSkew = p.registerSkew ?? 0;
      if (regWidth > 0 && regWidth < 100) {
        const offset = target - regCenter;
        const side = offset >= 0 ? 1 : -1;
        const sigma = Math.max(1, regWidth * (1 + regSkew * side * 0.75));
        regW = Math.exp(-0.5 * (offset / sigma) ** 2);
        regW = Math.max(0.01, regW); // floor to avoid zero weight
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

      candidates.push({ degree: target, prob: w * subBonus * regW * rootW });
    }
    if (candidates.length === 0) return current;

    // Normalise and sample
    const total = candidates.reduce((s, c) => s + c.prob, 0);
    let r = rng.next() * total;
    for (const c of candidates) {
      r -= c.prob;
      if (r <= 0) return c.degree;
    }
    return candidates[candidates.length - 1].degree;
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

  _generateMotif() {
    const beatDiv = this.p.beatDivisions || 1;
    const motifBeats = this.p.motifLengthBeats || this.p.motifLength || 4;
    const totalDivs = motifBeats * beatDiv;
    const rhythm = this._generateMotifRhythm(totalDivs);

    const notes = [];
    let deg = this._currentDegree || this.scale.pickNote(this.rng);
    let fmt = this._pickFormant();

    for (let i = 0; i < rhythm.length; i++) {
      const phrasePos = rhythm.length > 1 ? i / (rhythm.length - 1) : 0;
      if (i > 0) {
        deg = this._pickBiasedNote(deg, phrasePos);
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
    return new Motif(notes);
  }

  _endOfMotif() {
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
    this._motifSurprisePlan = null;
    this._activeSurpriseProjection = null;
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
    for (let i = startIndex + 1; i < notes.length; i++) {
      const phrasePos = notes.length > 1 ? i / (notes.length - 1) : 0;
      notes[i] = { ...original[i] };
      if (features.includes("pitch")) {
        projectedDegree = this._pickBiasedNote(projectedDegree, phrasePos);
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

  _chooseSurpriseFeatures() {
    const candidates = [
      { key: "pitch", enabled: this.p.surprisePitchEnabled ?? (this.p.surpriseDimensions || ["pitch"]).includes("pitch"), weight: this.p.surprisePitchWeight ?? 1 },
      { key: "rhythm", enabled: this.p.surpriseRhythmEnabled ?? (this.p.surpriseDimensions || []).includes("rhythm"), weight: this.p.surpriseRhythmWeight ?? 0.45 },
      { key: "formant", enabled: this.p.surpriseFormantEnabled ?? (this.p.surpriseDimensions || []).includes("formant"), weight: this.p.surpriseFormantWeight ?? 0.45 },
      { key: "dynamics", enabled: this.p.surpriseDynamicsEnabled ?? (this.p.surpriseDimensions || []).includes("dynamics"), weight: this.p.surpriseDynamicsWeight ?? 0.35 },
      { key: "rest", enabled: this.p.surpriseRestEnabled ?? (this.p.surpriseDimensions || []).includes("rest"), weight: this.p.surpriseRestWeight ?? 0.2 },
    ].filter(item => item.enabled && item.weight > 0);
    if (candidates.length === 0) return ["pitch"];

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
      const maxStep = Math.max(minStep + 1, Math.round((this.p.intervalRange ?? 7) + 2));
      const steps = dir * this.rng.int(minStep, maxStep + 1);
      out.degree = this.scale.stepFrom(expected.degree, steps);
    }
    if (dims.includes("formant")) {
      out.formant = this._pickFormant(expected.formant);
    }
    if (dims.includes("rhythm")) {
      // Double or halve the note duration
      const dur = expected.durationDivs || 1;
      out.durationDivs = this.rng.next() < 0.5
        ? Math.max(1, Math.floor(dur / 2))
        : Math.min(dur * 2, (this.p.motifLengthBeats || 4) * (this.p.beatDivisions || 1));
      out._rhythmOverride = true;
    }
    if (dims.includes("rest")) {
      // Replace note with silence
      out.isRest = true;
    }
    if (dims.includes("dynamics")) {
      // Dramatic volume change — very loud or very soft
      out.velocityOverride = this.rng.next() < 0.5 ? 0.1 : 0.9;
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
  }

  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    this.ctx = new C();
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

    this.master.connect(this._dryGain);
    this._dryGain.connect(this.analyser);
    this.master.connect(this._preDelay);
    this._preDelay.connect(this._convolver);
    this._convolver.connect(this._reverbTone);
    this._reverbTone.connect(this._wetGain);
    this._wetGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

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

    this._voiceMode = params.voiceMode === "formant" ? "formant" : (params.voiceMode || "fourier");
    this._vibratoActive = false;
    this._vibratoPhase = 0;
    this._vibratoCycleRate = params.vibratoRate || 5.5;
    this._vibratoCycleDepth = 0;
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

  _configureReverb(params = {}) {
    if (!this._dryGain || !this._wetGain || !this._convolver) return;
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

  updateGenerationParams(params = {}) {
    if (!this._engine) return;
    this._engine.p = { ...this._engine.p, ...params };
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
    for (const n of this._nodes) { try { n.stop(0); } catch {} }
    this._nodes = [];
    if (this._wetGain && this.ctx) {
      this._wetGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    }
  }

  get isPlaying() { return this.playing; }

  /** Current generation state for UI feedback. */
  getEngineState() {
    return this._engine ? this._engine.getState() : null;
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

      const beatDiv = note.beatDivisions || 1;
      const divSec = 60 / ((this._engine.p.tempo || 104) * beatDiv);

      this._render(note, this._nextTime);
      this._schedulePerc(note, this._nextTime, divSec);
      this._nextTime += note.durationDivs * divSec;
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
    if (this._voiceMode === "formant") {
      this._renderFormant(note, t0);
    } else if (this._voiceMode === "fourier") {
      this._renderFourier(note, t0);
    } else {
      this._renderOsc(note, t0);
    }
  }

  /** Formant synthesis: sawtooth → 3 parallel bandpass → envelope → master */
  _renderFormant(note, t0) {
    const t1 = t0 + note.duration;
    const f = FORMANT_PRESETS[note.formant] || FORMANT_PRESETS.ah;
    const spectralMix = this._spectralMix(note);

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    this._setFrequency(osc.frequency, note.frequency, t0, note);

    // Envelope
    const env = this._adsr(note.velocity * 0.4, t0, t1, note);

    // Three parallel formant filters
    for (const [freq, amp] of [[f.f1, 1.0], [f.f2, 0.6], [f.f3, 0.25]]) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = "bandpass";
      const formantShift = Math.max(0.7, Math.min(1.3, 1 + (note.toneFormantShift || 0)));
      const resonanceShift = Math.max(0.45, Math.min(1.8, 1 + (note.toneResonanceShift || 0)));
      bp.frequency.setValueAtTime(freq * formantShift, t0);
      bp.Q.value = Math.max(2, Math.min(16, 8 * resonanceShift));

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
    const stretchCents = Math.max(-24, Math.min(24, note.spectralStretchCents || 0));
    const maxIndex = Math.max(1, partials.length - 1);
    const scheduled = [];
    partials.forEach((part) => {
      const harmonic = part.harmonic || 1;
      const stretch = stretchCents * ((harmonic - 1) / maxIndex) ** 2;
      const multiplier = harmonic * Math.pow(2, stretch / 1200);
      const freq = note.frequency * multiplier;
      if (freq > this.ctx.sampleRate * 0.45) return;
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      this._setFrequency(osc.frequency, freq, t0, note, multiplier);
      const g = this.ctx.createGain();
      const gainScale = mix * Math.min(1, 1.4 / Math.sqrt(harmonic)) / norm;
      scheduled.push({ param: g.gain, part, gainScale });
      osc.connect(g);
      g.connect(env);
      osc.start(t0);
      osc.stop(t1 + 0.04);
      this._track(osc);
    });
    this._schedulePartialAmplitudes(scheduled, note, t0, t1);
  }

  _schedulePartialAmplitudes(partials, note, t0, t1) {
    if (partials.length === 0) return;
    const drawAndSchedule = (draws, time, method = "setValueAtTime") => {
      const correction = this._partialLoudnessCorrection(partials, draws, note);
      partials.forEach((item, i) => {
        item.param[method](item.gainScale * Math.max(0, draws[i]) * correction, time);
      });
    };

    drawAndSchedule(partials.map(item => item.part.amp), t0);

    const chance = this._clamp(note.spectralDriftProb ?? 0, 0, 1);
    const depth = this._clamp(note.spectralDriftDepth ?? 0, 0, 1);
    const rate = this._clamp(note.spectralDriftRate ?? 0, 0, 30);
    const duration = t1 - t0;
    const canDrift = partials.some(item => item.part.sd > 0);
    if (duration < 0.12 || depth <= 0 || rate <= 0 || !canDrift || this._nextRandom() >= chance) return;

    let t = t0 + 1 / rate;
    while (t < t1 - 0.015) {
      const draws = partials.map(item => Math.max(0, item.part.mean + this._gaussian() * item.part.sd * depth));
      drawAndSchedule(draws, t, "linearRampToValueAtTime");
      t += (1 / rate) * (0.75 + this._nextRandom() * 0.5);
    }
  }

  _partialLoudnessCorrection(partials, draws, note) {
    const amount = this._clamp(note.spectralLoudnessNorm ?? 0.65, 0, 1);
    if (amount <= 0) return 1;
    const target = partials.reduce((sum, item) => sum + Math.max(0, item.part.mean || 0), 0);
    const actual = draws.reduce((sum, amp) => sum + Math.max(0, amp), 0);
    if (target <= 0.0001 || actual <= 0.0001) return 1;
    return Math.pow(this._clamp(target / actual, 0.25, 4), amount);
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
