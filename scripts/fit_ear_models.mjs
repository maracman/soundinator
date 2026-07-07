// Fit the engine's parametric ear model to MEASURED HRTF data — the
// owner's route 1 (07-07): open datasets come in, only FITTED PARAMETERS
// go into the repo (the dataset itself never does, matching the project's
// parameters-not-audio rule).
//
// Dataset: MIT KEMAR (Gardner & Martin 1994, MIT Media Lab Perceptual
// Computing TR #280). 710 positions, 512-tap impulse responses at
// 44.1 kHz, measured 1.4 m from a KEMAR DB-4004 with model DB-061
// (normal) LEFT pinna and DB-065 (large red) RIGHT pinna — so the one
// dataset yields TWO pinna fits on the same head geometry.
// License: "provided free with no restrictions on use, provided the
// authors are cited" (README). Download: sound.media.mit.edu/resources/KEMAR.html
//
// Usage:  node scripts/fit_ear_models.mjs /path/to/kemar_full
//         (expects the unzipped full set: elev0/L0e000a.wav …)
//
// What is fitted, and to which physics knob:
//   earDistance — Woodworth ITD: onset-delay difference between the ears
//                 across the horizontal plane, least-squares against
//                 itdSeconds(az, earDistance).
//   headDensity — Brown-Duda shadow: one ear's high-band level vs
//                 azimuth (re: front), least-squares against
//                 headShadowDb(az, ear, density). Same-ear comparison so
//                 the speaker/canal response cancels and the two pinnae
//                 never mix.
//   pinnaScale  — Shaw front/behind cue: mirrored front/back pairs per
//                 ear, concha band (3.5-5.5 kHz) + flange band
//                 (8-13 kHz) losses against pinnaParams(az, scale).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { itdSeconds, headShadowDb, pinnaParams } from "../web/static/synth.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/fit_ear_models.mjs /path/to/kemar_full");
  process.exit(1);
}

const SR = 44100;

// ── minimal RIFF reader: 16-bit mono PCM → Float64Array ────────────
function readWav(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error(`not RIFF: ${path}`);
  let off = 12;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "data") {
      const n = size / 2;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(off + 8 + i * 2) / 32768;
      return out;
    }
    off += 8 + size;
  }
  throw new Error(`no data chunk: ${path}`);
}

// KEMAR full-set naming: <ear><elev>e<az>a.wav, az 0..355 in 5° steps,
// measured CLOCKWISE from front (az 90 = source at the RIGHT ear).
const irCache = new Map();
function ir(ear, az) {
  const a = ((az % 360) + 360) % 360;
  const key = `${ear}${a}`;
  if (!irCache.has(key)) {
    irCache.set(key, readWav(join(root, "elev0", `${ear}0e${String(a).padStart(3, "0")}a.wav`)));
  }
  return irCache.get(key);
}

// Our azimuth convention: 0 = front, +90 = right, −90 = left, ±180 = behind.
// KEMAR's clockwise-from-front matches directly: ourAz = kemarAz (folded).
const AZ = [];
for (let a = 0; a < 360; a += 5) AZ.push(a);
const fold = (a) => ((a + 180) % 360 + 360) % 360 - 180;

// ── onset time: first crossing of 15% of the peak, sub-sample refined ──
function onset(x) {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const th = peak * 0.15;
  for (let i = 1; i < x.length; i++) {
    if (Math.abs(x[i]) >= th) {
      const a = Math.abs(x[i - 1]), b = Math.abs(x[i]);
      return (i - 1 + (th - a) / Math.max(1e-12, b - a)) / SR;
    }
  }
  return 0;
}

// ── 512-pt FFT (iterative radix-2) → band mean level in dB ─────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
      }
    }
  }
}
const specCache = new Map();
function bandDb(ear, az, fLo, fHi) {
  const key = `${ear}${((az % 360) + 360) % 360}`;
  if (!specCache.has(key)) {
    const x = ir(ear, az);
    const re = Float64Array.from(x), im = new Float64Array(512);
    fft(re, im);
    const mag = new Float64Array(257);
    for (let i = 0; i <= 256; i++) mag[i] = Math.hypot(re[i], im[i]);
    specCache.set(key, mag);
  }
  const mag = specCache.get(key);
  const lo = Math.max(1, Math.round(fLo / SR * 512)), hi = Math.min(256, Math.round(fHi / SR * 512));
  let s = 0, n = 0;
  for (let i = lo; i <= hi; i++) { s += mag[i] * mag[i]; n++; }
  return 10 * Math.log10(s / n + 1e-20);
}

// ── generic 1-D least-squares scan + refine ────────────────────────
function fit1d(lo, hi, err) {
  let best = lo, bestE = Infinity;
  for (let pass = 0; pass < 4; pass++) {
    const step = (hi - lo) / 40;
    for (let v = lo; v <= hi + 1e-12; v += step) {
      const e = err(v);
      if (e < bestE) { bestE = e; best = v; }
    }
    lo = Math.max(lo, best - step); hi = Math.min(hi, best + step);
  }
  return { value: best, rmse: Math.sqrt(bestE) };
}

// ═══ 1. earDistance from the Woodworth ITD ═════════════════════════
// Measured ITD(az) = onsetL − onsetR (left later for right-side sources,
// matching itdSeconds' sign). Skip near-front/back where onsets are
// simultaneous and threshold noise dominates.
const itdPts = [];
for (const a of AZ) {
  const our = fold(a);
  if (Math.abs(Math.abs(our) - 90) > 88) continue; // drop exact front/back
  itdPts.push({ az: our * Math.PI / 180, itd: onset(ir("L", a)) - onset(ir("R", a)) });
}
const earFit = fit1d(0.12, 0.25, (ed) =>
  itdPts.reduce((s, p) => s + (itdSeconds(p.az, ed) - p.itd) ** 2, 0) / itdPts.length);
console.log(`earDistance  = ${earFit.value.toFixed(4)} m   (ITD RMSE ${(earFit.rmse * 1e6).toFixed(0)} µs over ${itdPts.length} azimuths)`);

// ═══ 2. headDensity from the Brown-Duda shadow ═════════════════════
// One ear's high-band level vs azimuth, re: its front value — the
// speaker + canal response cancels. Band sits above the shadow corner
// (~600 Hz) and below the deep pinna-notch region.
function densityFor(ear) {
  const ref = bandDb(ear, 0, 700, 6000);
  const pts = AZ.map(a => ({
    az: fold(a) * Math.PI / 180,
    db: bandDb(ear, a, 700, 6000) - ref,
  }));
  return fit1d(0, 1, (den) =>
    pts.reduce((s, p) => s + (headShadowDb(p.az, ear, den) - headShadowDb(0, ear, den) - p.db) ** 2, 0) / pts.length);
}
const denL = densityFor("L"), denR = densityFor("R");
console.log(`headDensity  L = ${denL.value.toFixed(3)} (RMSE ${denL.rmse.toFixed(1)} dB)   R = ${denR.value.toFixed(3)} (RMSE ${denR.rmse.toFixed(1)} dB)`);

// ═══ 3. pinnaScale per pinna from the Shaw front/behind cue ════════
// Mirror pairs with equal laterality: front az vs 180−az. The same-ear
// difference isolates the pinna (head shadow is laterality-symmetric by
// construction in both the model and a symmetric head).
function pinnaFor(ear) {
  const pts = [];
  for (let a = 0; a <= 85; a += 5) {
    for (const sgn of [1, -1]) {
      const front = sgn * a, back = sgn * (180 - a);
      const concha = bandDb(ear, back, 3500, 5500) - bandDb(ear, front, 3500, 5500);
      const flange = bandDb(ear, back, 8000, 13000) - bandDb(ear, front, 8000, 13000);
      pts.push({ back: back * Math.PI / 180, concha, flange });
    }
  }
  return fit1d(0, 2, (s) =>
    pts.reduce((sum, p) => {
      const m = pinnaParams(p.back, s);
      return sum + (m.conchaDb - p.concha) ** 2 + (m.shelfDb - p.flange) ** 2;
    }, 0) / (pts.length * 2));
}
const pinL = pinnaFor("L"), pinR = pinnaFor("R");
console.log(`pinnaScale   DB-061 (normal, L) = ${pinL.value.toFixed(3)} (RMSE ${pinL.rmse.toFixed(1)} dB)`);
console.log(`pinnaScale   DB-065 (large,  R) = ${pinR.value.toFixed(3)} (RMSE ${pinR.rmse.toFixed(1)} dB)`);

// ═══ fitted EAR_MODELS entries ═════════════════════════════════════
const density = (denL.value + denR.value) / 2; // one head, two pinnae
console.log(`\n// Paste into EAR_MODELS (synth.js) — fitted ${new Date().toISOString().slice(0, 10)}:`);
for (const [key, label, pin] of [
  ["kemar", "KEMAR (fitted)", pinL],
  ["kemarLarge", "KEMAR large pinna (fitted)", pinR],
]) {
  console.log(`  ${key}: { label: "${label}", earDistance: ${earFit.value.toFixed(3)}, headDensity: ${density.toFixed(2)}, pinnaScale: ${pin.value.toFixed(2)},`);
  console.log(`    blurb: "fitted to measured MIT KEMAR HRTFs (Gardner & Martin 1994${key === "kemarLarge" ? ", DB-065 pinna" : ", DB-061 pinna"})" },`);
}
