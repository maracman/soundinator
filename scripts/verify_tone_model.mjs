// Headless assertions for the tone model v2 resonator core
// (docs/TONE_MODEL_V2_DESIGN.md acceptance bar T-B2 / T-B3 and table
// integrity). Run: node scripts/verify_tone_model.mjs — exits non-zero on
// any failure. Wired into CI next to node --check.

import {
  RESONATOR_CLASSES,
  resonatorRatio,
  partialFrequency,
  legacyStretchToB,
  materialT60,
  excitationDrive,
  positionComb,
  hardnessRolloff,
  excitationSpectrum,
  dynamicBrightness,
  humanFluctuationTrace,
  humanPartialShape,
  transferCoupling,
  transferDeltas,
  BODY_PRESETS,
  bodyBandsFor,
  bodyResponse,
  FORMANT_PRESETS,
  migrateToneParams,
  spaceArrivalDelay,
  spaceAirCutoff,
  spaceProximityDb,
  SPECTRAL_PROFILES,
  GenerationEngine,
} from "../web/static/synth.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log("T-B3: stiff-string inharmonicity law");
{
  // Harmonic series when B = 0
  check("B=0 gives exact integer ratios",
    [1, 2, 7, 32, 64].every(n => partialFrequency(n, 220, 0) === 220 * n));
  // Anchoring: mode 1 stays at the played pitch for any B
  check("mode 1 anchored at f0 for B=1e-3",
    near(partialFrequency(1, 220, 1e-3), 220, 1e-9));
  // The formula itself: f_n = n·f0·sqrt((1+Bn²)/(1+B))
  const B = 3e-4, n = 17, f0 = 261.63;
  check("matches f_n = n·f0·sqrt((1+Bn²)/(1+B))",
    near(partialFrequency(n, f0, B), n * f0 * Math.sqrt((1 + B * n * n) / (1 + B)), 1e-9));
  // Count-independence (audit A4): the value for a given n never depends
  // on how many partials are rendered — the function has no count input,
  // so assert stability across call orders/contexts.
  const lone = partialFrequency(8, 220, B);
  const inSeries = Array.from({ length: 64 }, (_, i) => partialFrequency(i + 1, 220, B))[7];
  check("partial 8 identical alone vs within a 64-partial sweep", lone === inSeries);
  // Monotone: higher B stretches upper partials sharper
  check("B raises upper-partial frequency",
    partialFrequency(24, 220, 1e-3) > partialFrequency(24, 220, 1e-4));
}

console.log("Legacy stretch conversion");
{
  check("0 cents → B 0", legacyStretchToB(0) === 0);
  check("negative cents → B 0 (no stiff-string analogue)", legacyStretchToB(-10) === 0);
  // The old param pinned its ramp at partial 32: the mapped B must detune
  // partial 32 by exactly that many cents.
  for (const cents of [4, 8, 16]) {
    const B = legacyStretchToB(cents);
    const detune = 1200 * Math.log2(partialFrequency(32, 1, B) / 32);
    check(`${cents}¢ legacy → ${detune.toFixed(3)}¢ at n=32`, near(detune, cents, 0.01));
  }
}

console.log("T-B2: material damping is a law over real Hz");
{
  // Same Hz → same T60, however that frequency is reached (rank-free).
  check("T60 depends on Hz only",
    materialT60(4000, 0.5) === materialT60(4000, 0.5) &&
    near(materialT60(8 * 500, 0.5), materialT60(16 * 250, 0.5), 1e-12));
  // Highs die faster; more material dies faster overall
  check("T60 falls with frequency", materialT60(4000, 0.5) < materialT60(500, 0.5));
  check("felt shorter than glass at 2 kHz", materialT60(2000, 1) < materialT60(2000, 0));
  // Physical sanity: glassy C4 rings for seconds, felted highs snuff out
  check("glass @ C4 rings > 4 s", materialT60(261.63, 0) > 4);
  check("felt @ 4 kHz < 0.15 s", materialT60(4000, 1) < 0.15);
  // Steeper slope with material: felt loses proportionally more at the top
  const ratioGlass = materialT60(4000, 0) / materialT60(500, 0);
  const ratioFelt = materialT60(4000, 1) / materialT60(500, 1);
  check("damping slope steepens with material", ratioFelt < ratioGlass);
}

console.log("Resonator ratio tables");
{
  check("string is the harmonic series", [1, 2, 3, 12].every(n => resonatorRatio("string", n) === n));
  check("closed tube is odd harmonics", [1, 3, 5, 7].every((v, i) => resonatorRatio("closedTube", i + 1) === v));
  check("membrane starts at Bessel ratios", near(resonatorRatio("membrane", 2), 1.594, 1e-9));
  const m12 = resonatorRatio("membrane", 12), m13 = resonatorRatio("membrane", 13), m14 = resonatorRatio("membrane", 14);
  check("membrane tail extends monotonically", m12 < m13 && m13 < m14);
  check("unknown class falls back to string", resonatorRatio("nonsense", 5) === 5);
  check("all classes exported", ["string", "closedTube", "membrane", "bar"].every(k => RESONATOR_CLASSES[k]));
}

console.log("64-partial profile tables");
{
  const profiles = Object.entries(SPECTRAL_PROFILES);
  check("8 instrument profiles present", profiles.length >= 8);
  check("every profile carries 64 partials", profiles.every(([, p]) => p.partials.length === 64));
  const cl = SPECTRAL_PROFILES.clarinet.partials;
  // Clarinet's odd-dominant parity must hold across the band the
  // measurement resolves (the measured tail is honestly ~0 above ~10 kHz,
  // so parity is tested where there is signal, and the tail must fade)
  const odd = [cl[2], cl[4], cl[6], cl[8]].map(p => p.amp);   // harmonics 3,5,7,9
  const even = [cl[1], cl[3], cl[5], cl[7]].map(p => p.amp);  // harmonics 2,4,6,8
  const oddSum = odd.reduce((a, b) => a + b, 0), evenSum = even.reduce((a, b) => a + b, 0);
  check("clarinet parity holds across the measured band",
    oddSum > evenSum * 3, `odd ${oddSum.toFixed(3)} vs even ${evenSum.toFixed(3)}`);
  check("clarinet measured tail fades to silence, not garbage",
    cl.slice(44).every(p => p.amp <= 0.02));
  const vn = SPECTRAL_PROFILES.violin.partials;
  check("violin tail keeps decaying", vn[63].amp < vn[31].amp && vn[31].amp < vn[7].amp);
}

console.log("Engine wiring (fingerprint carries the v2 resonator fields)");
{
  const GEN = {
    seed: 42, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 64,
  };
  const engine = new GenerationEngine({ ...GEN, spectralProfile: "piano", spectralStretchCents: 8 });
  engine.initialise();
  let note = null;
  for (let i = 0; i < 24 && !note; i++) { const n = engine.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) note = n; }
  check("sounded note found", !!note);
  if (note) {
    check("note carries partialB from legacy cents", near(note.partialB, legacyStretchToB(8), 1e-12),
      `got ${note.partialB}`);
    check("note carries resonatorClass", note.resonatorClass === "string");
    check("64 partials in the fingerprint", note.harmonicPartials.length === 64);
    // explicit partialB param wins over legacy cents
    const engine2 = new GenerationEngine({ ...GEN, spectralProfile: "piano", spectralStretchCents: 8, partialB: 5e-4 });
    engine2.initialise();
    let note2 = null;
    for (let i = 0; i < 24 && !note2; i++) { const n = engine2.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) note2 = n; }
    check("explicit partialB param wins", note2 && near(note2.partialB, 5e-4, 1e-15));
  }
}

console.log("T-B1: excitation position comb kills the right partials (measured)");
{
  check("middle (0.5) silences mode 2", positionComb(2, 0.5) < 1e-9);
  check("middle (0.5) silences mode 4", positionComb(4, 0.5) < 1e-9);
  check("third (1/3) silences mode 3", positionComb(3, 1 / 3) < 1e-9);
  check("third (1/3) silences mode 6", positionComb(6, 1 / 3) < 1e-9);
  check("mode 1 never dies", positionComb(1, 0.5) > 0.99 && positionComb(1, 0.13) > 0.3);
  check("near-bridge keeps highs alive", positionComb(9, 0.05) > 0.3);
}

console.log("T2: drive spectra, hardness, dynamic brightness");
{
  const slope = (type) => excitationDrive(type, 8) / excitationDrive(type, 1);
  check("pluck rolls off steeper than bow", slope("pluck") < slope("bow"));
  check("bow rolls off steeper than strike", slope("bow") < slope("strike"));
  check("hard strike passes 4 kHz, soft doesn't",
    hardnessRolloff(4000, 1, "strike") > 10 * hardnessRolloff(4000, 0.1, "strike"));
  check("hardness ignores bow/blow",
    hardnessRolloff(4000, 0.1, "bow") === 1 && hardnessRolloff(4000, 0.1, "blow") === 1);
  check("excitationSpectrum composes drive × comb × hardness",
    near(excitationSpectrum("pluck", 2, { position: 0.5, hardness: 1 }), 0, 1e-9));
  check("dynamic brightness grows with mode number",
    dynamicBrightness(1) === 0.5 && dynamicBrightness(8) > dynamicBrightness(4) && dynamicBrightness(32) > 2);
}

console.log("T2: engine excitation transform (normalised against profile default)");
{
  const GEN2 = {
    seed: 7, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 32, spectralProfile: "piano", spectralProb: 0,
  };
  const firstNote = (params) => {
    const e = new GenerationEngine(params); e.initialise();
    for (let i = 0; i < 24; i++) { const n = e.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) return n; }
    return null;
  };
  const plain = firstNote(GEN2);
  const explicitDefaults = firstNote({ ...GEN2, excitationType: "strike", excitationPosition: 0.12, excitationHardness: 0.62 });
  check("identity: profile-default excitation params change nothing",
    plain && explicitDefaults &&
    plain.harmonicPartials.every((p, i) => near(p.mean, explicitDefaults.harmonicPartials[i].mean, 1e-12)));
  const midString = firstNote({ ...GEN2, excitationPosition: 0.5 });
  check("position 0.5 through the engine silences partial 2",
    midString && midString.harmonicPartials[1].mean < 1e-9 && midString.harmonicPartials[0].mean > 0.01);
  const plucked = firstNote({ ...GEN2, excitationType: "pluck" });
  check("pluck darkens the top relative to piano's strike",
    plucked && plain &&
    (plucked.harmonicPartials[7].mean / Math.max(1e-9, plucked.harmonicPartials[0].mean)) <
    (plain.harmonicPartials[7].mean / Math.max(1e-9, plain.harmonicPartials[0].mean)));
}

console.log("T-B4: Human fluctuation — coherent, deterministic, silent at zero");
{
  const mkRng = (seed) => { let s = seed >>> 0; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const a = humanFluctuationTrace(mkRng(99), 3, "bow", 0.6);
  const b = humanFluctuationTrace(mkRng(99), 3, "bow", 0.6);
  check("trace deterministic per seed", a.length > 0 && a.length === b.length &&
    a.every((p, i) => p.t === b[i].t && p.f === b[i].f));
  check("trace differs across seeds",
    JSON.stringify(a) !== JSON.stringify(humanFluctuationTrace(mkRng(100), 3, "bow", 0.6)));
  check("zero at Human 0", humanFluctuationTrace(mkRng(99), 3, "bow", 0).length === 0);
  check("no mid-note trace for strike/pluck",
    humanFluctuationTrace(mkRng(99), 3, "strike", 0.8).length === 0 &&
    humanFluctuationTrace(mkRng(99), 3, "pluck", 0.8).length === 0);
  check("trace bounded to ±1", a.every(p => p.f >= -1 && p.f <= 1));
  check("Schelleng shape: top follows harder, all positive (coherent)",
    humanPartialShape(1) > 0 && humanPartialShape(32) > humanPartialShape(8) && humanPartialShape(8) > humanPartialShape(1));

  const GEN3 = {
    seed: 11, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 24, spectralProfile: "violin",
  };
  const firstNote = (params) => {
    const e = new GenerationEngine(params); e.initialise();
    for (let i = 0; i < 24; i++) { const n = e.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) return n; }
    return null;
  };
  const h1 = firstNote({ ...GEN3, excitationHuman: 0.7 });
  const h2 = firstNote({ ...GEN3, excitationHuman: 0.7 });
  check("onset draw deterministic per seed",
    h1 && h2 && h1.harmonicPartials.every((p, i) => p.amp === h2.harmonicPartials[i].amp));
  const base = firstNote({ ...GEN3, excitationHuman: 0 });
  check("Human 0: sounded amps equal computed means exactly (A1 closed)",
    base && base.harmonicPartials.every(p => near(p.amp, p.mean, 1e-12)));
  // Coherence: every partial with sensitivity deviates in the SAME direction
  const dirs = h1.harmonicPartials
    .map(p => (p.sens > 0.02 && p.mean > 1e-6 ? Math.sign(p.amp - p.mean) : null))
    .filter(d => d !== null);
  check("onset variation coherent across the spectrum (single shared draw)",
    dirs.length > 6 && (dirs.every(d => d >= 0) || dirs.every(d => d <= 0)));
  // Old independent-sampling params are dead: spectralProb no longer changes anything
  const probOn = firstNote({ ...GEN3, excitationHuman: 0, spectralProb: 1 });
  const probOff = firstNote({ ...GEN3, excitationHuman: 0, spectralProb: 0 });
  check("spectralProb retired (identical output either way)",
    probOn && probOff && probOn.harmonicPartials.every((p, i) => p.amp === probOff.harmonicPartials[i].amp));
}

console.log("T-B5: resonant transfer — true ratios, cents falloff, inharmonicity decoupling");
{
  check("exact octave couples at the Tenney maximum (1/2)",
    near(transferCoupling(440, 880), 0.5, 1e-9));
  check("octave couples harder than true fifth, fifth harder than major third",
    transferCoupling(440, 880) > transferCoupling(440, 660) &&
    transferCoupling(440, 660) > transferCoupling(440, 550));
  check("coupling falls with cents distance",
    transferCoupling(440, 880) > transferCoupling(440, 880 * Math.pow(2, 10 / 1200)) &&
    transferCoupling(440, 880 * Math.pow(2, 10 / 1200)) > transferCoupling(440, 880 * Math.pow(2, 30 / 1200)));
  check("NOT equal temperament: true 3:2 beats the 12-TET fifth",
    transferCoupling(440, 440 * 1.5) > transferCoupling(440, 440 * Math.pow(2, 7 / 12)));
  // 1.29 sits ~55¢ from both 5:4 and 4:3 — no simple ratio nearby
  check("unrelated frequencies do not couple", transferCoupling(440, 440 * 1.29) < 0.005);
  // Inharmonicity decoupling: partials 4 and 8 of a stiff string drift off 2:1
  const f0 = 261.63;
  const cB = (B) => transferCoupling(partialFrequency(4, f0, B), partialFrequency(8, f0, B));
  check("rising B detunes the 4:8 octave pair out of resonance",
    cB(0) > cB(3e-4) && cB(3e-4) > cB(1.5e-3),
    `C(B=0)=${cB(0).toFixed(3)} C(3e-4)=${cB(3e-4).toFixed(3)} C(1.5e-3)=${cB(1.5e-3).toFixed(3)}`);

  // First-order exchange: a silent partial an exact octave above a strong
  // one blooms; the donor pays; the exchange conserves energy pairwise.
  const parts = [
    { freq: 440, amp: 1.0 },   // strong fundamental
    { freq: 880, amp: 0.0 },   // silent octave — the sympathetic case
    { freq: 1237, amp: 0.4 },  // unrelated bystander
  ];
  const d = transferDeltas(parts, 0.6);
  check("silent octave partial gains energy", d[1] > 0.05);
  check("strong donor loses what the receiver gains", d[0] < 0 && near(d[0] + d[1], 0, 1e-9));
  check("unrelated bystander untouched", Math.abs(d[2]) < 1e-6);
  check("transfer 0 → all deltas zero", transferDeltas(parts, 0).every(x => x === 0));
  // Engine wiring: fingerprint carries the dial
  const GEN4 = {
    seed: 5, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 16, spectralProfile: "piano", partialTransfer: 0.3,
  };
  const e = new GenerationEngine(GEN4); e.initialise();
  let note = null;
  for (let i = 0; i < 24 && !note; i++) { const n = e.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) note = n; }
  check("fingerprint carries partialTransfer", note && near(note.partialTransfer, 0.3, 1e-12));
}

console.log("T-B6: body stage — vowels as bodies, FM→AM, reg grids retired");
{
  check("all five vowels exist as vocal bodies",
    Object.keys(FORMANT_PRESETS).every(v => BODY_PRESETS[`vowel-${v}`]?.vocal));
  check("instrument bodies present (violin, piano)",
    !!BODY_PRESETS.violin && !!BODY_PRESETS.piano);
  const ah = BODY_PRESETS["vowel-ah"].bands;
  check("vowel-ah body carries F1-F5 at the measured frequencies",
    ah.length === 5 && ah[0].freq === FORMANT_PRESETS.ah.f1 && ah[4].freq === FORMANT_PRESETS.ah.f5);
  check("ah body peaks at F1 (730 Hz), not beside it",
    bodyResponse(ah, 730, 1) > bodyResponse(ah, 500, 1) &&
    bodyResponse(ah, 730, 1) > bodyResponse(ah, 1000, 1));
  const ee = BODY_PRESETS["vowel-ee"].bands, oo = BODY_PRESETS["vowel-oo"].bands;
  // 870 Hz is oo's F2 and sits in ee's F1-F2 gap — the classic back/front cue
  check("ee and oo bodies are acoustically distinct at oo's F2 (870 Hz)",
    bodyResponse(oo, 870, 1) > 1.8 * bodyResponse(ee, 870, 1));
  check("bodyBandsFor: auto resolves the instrument's own body",
    bodyBandsFor({ bodyType: "auto" }, SPECTRAL_PROFILES.violin) === SPECTRAL_PROFILES.violin.resonances);
  check("bodyBandsFor: explicit vowel body wins over the profile",
    bodyBandsFor({ bodyType: "vowel-ah" }, SPECTRAL_PROFILES.violin) === ah);
  // FM→AM: gain swing across ±20 cents is large on a formant slope,
  // near-zero at the symmetric ridge peak
  // 600 Hz sits on F1's lower shoulder — a clean one-sided slope. (900 Hz
  // would be wrong: it's the saddle where F1's fall cancels F2's rise.)
  const slopeF = 600;
  const dAt = (f) => Math.abs(
    bodyResponse(ah, f * Math.pow(2, 20 / 1200), 1) - bodyResponse(ah, f * Math.pow(2, -20 / 1200), 1)
  ) / bodyResponse(ah, f, 1);
  check("vibrato swing produces AM on a body slope, stillness at the peak",
    dAt(slopeF) > 5 * dAt(730), `slope ${dAt(slopeF).toFixed(4)} vs peak ${dAt(730).toFixed(4)}`);

  // Audit A7: the per-partial reg grids are dead
  const GEN5 = {
    seed: 3, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 24, spectralProfile: "violin", excitationHuman: 0,
  };
  const firstNote = (params) => {
    const e = new GenerationEngine(params); e.initialise();
    for (let i = 0; i < 24; i++) { const n = e.nextNote(); if (n && n.velocity > 0 && n.harmonicPartials) return n; }
    return null;
  };
  const regA = firstNote({ ...GEN5, spectralPartialRegs: new Array(64).fill(2) });
  const regB = firstNote({ ...GEN5, spectralPartialRegs: new Array(64).fill(-2) });
  check("A7: extreme reg grids produce identical output",
    regA && regB && regA.harmonicPartials.every((p, i) => p.amp === regB.harmonicPartials[i].amp));
  const regAmtA = firstNote({ ...GEN5, spectralRegisterAmount: 0 });
  const regAmtB = firstNote({ ...GEN5, spectralRegisterAmount: 1.5 });
  check("A7: Reg response amount is inert",
    regAmtA && regAmtB && regAmtA.harmonicPartials.every((p, i) => p.amp === regAmtB.harmonicPartials[i].amp));
  // Engine wiring: vowel body changes the spectrum; note carries the bands
  const auto = firstNote(GEN5);
  const vowel = firstNote({ ...GEN5, bodyType: "vowel-ee" });
  check("vowel-ee body reshapes the fingerprint",
    auto && vowel && auto.harmonicPartials.some((p, i) => Math.abs(p.amp - vowel.harmonicPartials[i].amp) > 1e-6));
  check("note carries bodyBands + bodyAmount for the renderer",
    vowel && Array.isArray(vowel.bodyBands) && vowel.bodyBands.length === 5 && vowel.bodyAmount > 0);
}

console.log("T6: preset migration (T-B9 partial)");
{
  const old = {
    spectralStretchCents: 8, spectralProb: 0.7, spectralDriftProb: 0.8,
    spectralDriftDepth: 0.5, spectralDriftRate: 6, spectralLoudnessNorm: 0.65,
    spectralRegisterAmount: 0.55, spectralPartialDyns: [1, 2], spectralPartialRegs: [0.5],
    partialTilt: 0.2, tempo: 104,
  };
  const m = migrateToneParams(old);
  check("legacy stretch cents become the exact B", near(m.partialB, legacyStretchToB(8), 1e-15));
  check("old drift wobble seeds the Human dial",
    Number.isFinite(m.excitationHuman) && m.excitationHuman > 0.1 && m.excitationHuman <= 0.7);
  check("dead keys stop travelling",
    !("spectralProb" in m) && !("spectralDriftProb" in m) && !("spectralLoudnessNorm" in m) &&
    !("spectralRegisterAmount" in m) && !("spectralPartialDyns" in m) && !("spectralPartialRegs" in m));
  check("living keys pass through untouched", m.partialTilt === 0.2 && m.tempo === 104);
  const native = migrateToneParams({ partialB: 5e-4, excitationHuman: 0.3, spectralStretchCents: 8, spectralDriftDepth: 0.9 });
  check("explicit v2 values are never overwritten",
    native.partialB === 5e-4 && native.excitationHuman === 0.3);
  check("migration does not mutate its input", old.spectralProb === 0.7);
}

console.log("SPACE positioning laws");
{
  check("arrival delay is distance over the speed of sound",
    near(spaceArrivalDelay(3.43), 0.01, 1e-9) && near(spaceArrivalDelay(34.3), 30 / 343, 1e-9));
  check("air absorption: full band close, ~3.6 kHz at 30 m",
    spaceAirCutoff(0.5) === 20000 && spaceAirCutoff(30) < 4000 &&
    spaceAirCutoff(4) < spaceAirCutoff(2));
  check("proximity effect exists only inside ~1.2 m and grows as you approach",
    spaceProximityDb(2) === 0 && spaceProximityDb(1.19) > 0 &&
    spaceProximityDb(0.3) > spaceProximityDb(0.8));
  check("laws clamp to the 0.3–30 m range",
    spaceArrivalDelay(1000) === 30 / 343 && spaceProximityDb(-5) === spaceProximityDb(0.3));
}

console.log("CH-B1 rev 2: articulation manipulates the SELECTED body");
{
  const GEN6 = {
    seed: 9, tempo: 104, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    spectralPartials: 24, spectralProfile: "vocal", bodyType: "violin",
    bodyArticulation: 1, activeFormants: ["ah", "ee"], excitationHuman: 0, formantChangeProb: 1,
  };
  const nBase = BODY_PRESETS.violin.bands.length;
  const e = new GenerationEngine(GEN6); e.initialise();
  const seen = [];
  for (let i = 0; i < 30; i++) {
    const nn = e.nextNote();
    if (nn && nn.velocity > 0 && nn.bodyBands) seen.push(nn.bodyBands);
  }
  check("articulation COMPOSES: base bands + 5 formants, base never discarded",
    seen.length > 4 && seen.every(b => b.length === nBase + 5 &&
      JSON.stringify(b.slice(0, nBase)) === JSON.stringify(BODY_PRESETS.violin.bands)));
  const articSig = seen.map(b => b.slice(nBase).map(x => Math.round(x.freq)).join(","));
  check("the vowel layer MOVES across notes while the base stays still",
    new Set(articSig).size > 1, `distinct=${new Set(articSig).size}`);

  // depth scales the vowel layer's gains, half depth = half gain
  const full = new GenerationEngine({ ...GEN6 });
  const half = new GenerationEngine({ ...GEN6, bodyArticulation: 0.5 });
  const pos = { x: Math.log(700), y: Math.log(1100) };
  const gF = full._articulatedBands(pos).map(b => b.gain);
  const gH = half._articulatedBands(pos).map(b => b.gain);
  check("articulation depth scales the vowel EQ (more/less extreme)",
    gF.every((g, i) => Math.abs(gH[i] - g / 2) < 1e-9));
  check("depth 0 = still body: no vowel layer at all",
    new GenerationEngine({ ...GEN6, bodyArticulation: 0 })._articulatedBands(pos) === null);

  // per-formant extremity: F1 level doubles the F1 band only
  const boosted = new GenerationEngine({ ...GEN6, formantF1Level: 2 })._articulatedBands(pos);
  check("formantF1Level makes that band's EQ more extreme, others untouched",
    Math.abs(boosted[0].gain - gF[0] * 2) < 1e-9 && Math.abs(boosted[1].gain - gF[1]) < 1e-9);

  // preset-then-editable: a custom band list overrides the preset's bands
  const custom = [{ freq: 500, gain: 2.2, width: 0.3 }, { freq: 3100, gain: -1, width: 0.5 }];
  const ec = new GenerationEngine({ ...GEN6, bodyArticulation: 0, bodyBands: custom }); ec.initialise();
  let cNote = null;
  for (let i = 0; i < 20 && !cNote; i++) { const nn = ec.nextNote(); if (nn && nn.velocity > 0) cNote = nn; }
  check("edited bands override the preset (body settings are a starting point)",
    cNote && JSON.stringify(cNote.bodyBands) === JSON.stringify(custom));

  const stat = new GenerationEngine({ ...GEN6, bodyArticulation: undefined, activeFormants: undefined }); stat.initialise();
  let sNote = null;
  for (let i = 0; i < 20 && !sNote; i++) { const nn = stat.nextNote(); if (nn && nn.velocity > 0) sNote = nn; }
  check("no articulation param, non-vocal body: static preset bands, unchanged",
    sNote && JSON.stringify(sNote.bodyBands) === JSON.stringify(BODY_PRESETS.violin.bands));

  const m = migrateToneParams({ voiceMode: "formant", spectralMix: 0.1, spectralProfile: "violin" });
  check("formant-mode presets migrate to full articulation depth",
    m.voiceMode === "fourier" && m.bodyArticulation === 1 && m.spectralProfile === "vocal" && m.spectralMix >= 0.6);
  const legacyVocal = new GenerationEngine({ ...GEN6, bodyArticulation: undefined, bodyType: "vocal" });
  check("legacy bodyType 'vocal' still articulates (depth defaults to 1)",
    legacyVocal._articulationDepth() === 1);
}

console.log("CH-B3: measured instrument fits folded into presets");
{
  for (const key of ["flute", "clarinet", "violin", "cello", "trumpet", "trombone", "piano"]) {
    const prof = SPECTRAL_PROFILES[key];
    check(`${key}: 64 measured partials, all sane, dyn curve extended`,
      prof.partials.length === 64 &&
      prof.partials.every(p => Number.isFinite(p.amp) && p.amp >= 0 && p.amp <= 1 &&
        Number.isFinite(p.spread) && Number.isFinite(p.dyn)) &&
      prof.measured && typeof prof.measured.source === "string");
  }
  const piano = SPECTRAL_PROFILES.piano.performance;
  check("piano: measured inharmonicity seeds partialB (~3.6e-4, was 1.2e-4)",
    piano.partialB > 2e-4 && piano.partialB < 6e-4);
  check("piano: measured material (real piano out-rings the old default)",
    piano.partialMaterial <= 0.1);
  const violin = SPECTRAL_PROFILES.violin.performance;
  check("violin: measured vibrato rate, blended depth, hand envelope kept",
    Math.abs(violin.vibratoRate - 5.739) < 0.01 &&
    violin.vibratoDepth > 16 && violin.vibratoDepth < 25.3 &&
    violin.envelopeAttack === 0.085);
  check("vocal profile untouched (no solo-voice source measured)",
    !SPECTRAL_PROFILES.vocal.measured);
}

console.log("P1: arp pattern mode (owner brief 2026-07-07)");
{
  const GEN7 = {
    seed: 5, tempo: 120, beatDivisions: 2, motifCount: 1, motifLengthBeats: 8,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    registerCenter: 0, gapProb: 0, restMotifStartRatio: 0, surpriseProb: 0,
    melodyPattern: "arpUp", arpStep: 2, arpOctaves: 1, excitationHuman: 0,
  };
  const degreesOf = (params, count = 12) => {
    const e = new GenerationEngine(params); e.initialise();
    const out = [];
    for (let i = 0; i < 200 && out.length < count; i++) {
      const nn = e.nextNote();
      if (nn && nn.velocity > 0) out.push(nn.degree);
    }
    return out;
  };
  const up = degreesOf(GEN7);
  // major triad-ish cycle from the root: 0,4,7,11(maj7 skip)… stride 2 over
  // major degrees [0,2,4,5,7,9,11] from 0 → 0,4,7,11,12? (wraps at octave)
  const uniq = [...new Set(up)].sort((a, b) => a - b);
  check("arpUp: deterministic cycle over a fixed in-scale set",
    uniq.length >= 3 && uniq.length <= 6 && up.slice(0, uniq.length).join(",") === up.slice(uniq.length, 2 * uniq.length).join(","),
    `degrees ${up.join(",")}`);
  check("arpUp: strictly ascending within each cycle",
    up.slice(0, uniq.length - 1).every((d, i) => up[i + 1] > d));
  check("arp set stays in scale",
    uniq.every(d => [0, 2, 4, 5, 7, 9, 11].includes(((d % 12) + 12) % 12)));
  const down = degreesOf({ ...GEN7, melodyPattern: "arpDown" });
  check("arpDown: same set, descending",
    down.slice(0, uniq.length - 1).every((d, i) => down[i + 1] < d));
  const ud = degreesOf({ ...GEN7, melodyPattern: "arpUpDown", motifLengthBeats: 8 }, 2 * uniq.length - 2);
  const half = uniq.length;
  check("arpUpDown: palindrome without repeated endpoints",
    ud.length >= 2 * half - 2 &&
    ud.slice(0, half - 1).every((d, i) => ud[i + 1] > d) &&
    ud.slice(half - 1, 2 * half - 2).every((d, i) => ud[half + i] < d || half + i >= ud.length));
  const walk = degreesOf({ ...GEN7, melodyPattern: "walk" });
  check("walk mode untouched (probabilistic, not the arp cycle)",
    walk.join(",") !== up.join(","));
  const det1 = degreesOf(GEN7), det2 = degreesOf(GEN7);
  check("arp is deterministic under the same seed", det1.join(",") === det2.join(","));
}

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll tone-model v2 assertions passed (T1-T6 + space).");
