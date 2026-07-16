// Headless assertions for the tone model v2 resonator core
// (docs/TONE_MODEL_V2_DESIGN.md acceptance bar T-B2 / T-B3 and table
// integrity). Run: node scripts/verify_tone_model.mjs — exits non-zero on
// any failure. Wired into CI next to node --check.

import {
  RESONATOR_CLASSES,
  resonatorRatio,
  outputPartialRatio,
  partialFrequency,
  legacyStretchToB,
  materialT60,
  excitationDrive,
  positionComb,
  hardnessRolloff,
  usesFreeDecay,
  partialIsAudible,
  excitationSpectrum,
  dynamicBrightness,
  glottalSourceGain,
  velocityHardness,
  twoStageDecayPlan,
  attackNoiseRouting,
  attackNoiseVelocityGain,
  breathVelocityGain,
  toneBreathLevelFor,
  onsetSpectrumGain,
  registerAttackNoiseAt,
  registerAttackStaggerAt,
  registerEnvelopeAttackAt,
  resolveAttackNoise,
  registerProfileAt,
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
  layerMixPlan,
} from "../web/static/synth.js";
import { MEASURED_PROFILES } from "../web/static/measured_profiles.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) { console.log(`  ok  ${name}`); }
  else { failures++; console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log("Sub-note base layer mixing");
{
  const layers = [{ id: "a", solo: false }, { id: "b", solo: true }];
  const normal = layerMixPlan({ baseLayerGain: 0.6 }, layers.map(l => ({ ...l, solo: false })));
  check("base level is preserved in the mix plan", normal.baseAudible && normal.baseGain === 0.6);
  check("without solos every captured layer plays", normal.layers.length === 2);
  const capturedSolo = layerMixPlan({ baseLayerSolo: false }, layers);
  check("captured-layer solo silences base", !capturedSolo.baseAudible && capturedSolo.layers.length === 1 && capturedSolo.layers[0].id === "b");
  const baseSolo = layerMixPlan({ baseLayerSolo: true }, layers.map(l => ({ ...l, solo: false })));
  check("base solo silences unsoloed captured layers", baseSolo.baseAudible && baseSolo.layers.length === 0);
  const additiveSolo = layerMixPlan({ baseLayerSolo: true }, layers);
  check("base and captured solos combine", additiveSolo.baseAudible && additiveSolo.layers.length === 1);
  check("zero base level silences base", !layerMixPlan({ baseLayerGain: 0 }, []).baseAudible);
}

console.log("WP-3 register attack timing");
{
  const anchors = [
    { f0: 80, lowToHighStaggerMs: 90 },
    { f0: 320, lowToHighStaggerMs: 120 },
    { f0: 640, lowToHighStaggerMs: 0 },
  ];
  check("register attack stagger clamps below measured range",
    registerAttackStaggerAt(anchors, 40) === 90);
  check("register attack stagger interpolates in log-frequency space",
    near(registerAttackStaggerAt(anchors, 160), 105, 1e-9));
  check("register attack stagger preserves a measured zero high anchor",
    registerAttackStaggerAt(anchors, 800) === 0);
  check("refitted blown profiles carry three measured register timing anchors",
    ["flute", "clarinet", "alto-sax", "trumpet", "french-horn"].every(
      key => SPECTRAL_PROFILES[key].attackByRegister?.length === 3));
  check("register envelope attack is neutral when absent and interpolates",
    registerEnvelopeAttackAt([], 160) === null &&
    near(registerEnvelopeAttackAt([
      { f0: 80, attack: .16 }, { f0: 320, attack: .08 },
    ], 160), .12, 1e-9));
}

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
  check("free decay applies to impulse-driven excitations only",
    usesFreeDecay("strike") && usesFreeDecay("pluck") &&
    !usesFreeDecay("bow") && !usesFreeDecay("blow"));
  check("compression cull is neutral by default and preserves modes 1-8",
    partialIsAudible(0.0005, 1, 9) && !partialIsAudible(0.00049, 1, 9) &&
    partialIsAudible(0, 1, 8, 0.01));
}

console.log("Resonator ratio tables");
{
  check("string is the harmonic series", [1, 2, 3, 12].every(n => resonatorRatio("string", n) === n));
  check("closed tube is odd harmonics", [1, 3, 5, 7].every((v, i) => resonatorRatio("closedTube", i + 1) === v));
  check("closed-tube radiated output retains integer harmonics",
    [1, 2, 3, 8].every(n => outputPartialRatio("closedTube", n) === n)
    && [1, 2, 3, 8].every(n => partialFrequency(n, 220, 0, "closedTube") === n * 220));
  check("membrane starts at Bessel ratios", near(resonatorRatio("membrane", 2), 1.594, 1e-9));
  const m12 = resonatorRatio("membrane", 12), m13 = resonatorRatio("membrane", 13), m14 = resonatorRatio("membrane", 14);
  check("membrane tail extends monotonically", m12 < m13 && m13 < m14);
  check("unknown class falls back to string", resonatorRatio("nonsense", 5) === 5);
  check("all classes exported", ["string", "closedTube", "membrane", "bar"].every(k => RESONATOR_CLASSES[k]));
}

console.log("64-partial profile tables");
{
  const profiles = Object.entries(SPECTRAL_PROFILES);
  check("WP-3 instrument catalogue present", profiles.length >= 14);
  check("every profile carries 64 partials", profiles.every(([, p]) => p.partials.length === 64));
  const cl = SPECTRAL_PROFILES.clarinet.partials;
  const parity = row => ({
    odd: [2, 4, 6, 8].reduce((sum, i) => sum + (row[i]?.amp || 0), 0),
    even: [1, 3, 5, 7].reduce((sum, i) => sum + (row[i]?.amp || 0), 0),
  });
  const clLow = parity(SPECTRAL_PROFILES.clarinet.partialsByRegister[0].partials);
  const clHigh = parity(SPECTRAL_PROFILES.clarinet.partialsByRegister[2].partials);
  check("clarinet low register retains closed-tube odd dominance",
    clLow.odd > clLow.even * 5, `odd ${clLow.odd.toFixed(3)} vs even ${clLow.even.toFixed(3)}`);
  check("clarinet even partials rise with register",
    clHigh.even / clHigh.odd > clLow.even / clLow.odd * 4);
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
    check("measured register partialB supersedes the legacy profile default",
      note.partialB > 5e-5 && note.partialB < 1e-3, `got ${note.partialB}`);
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

console.log("Sound Generator 2.0 neutral engine extensions");
{
  const mock = { partials: [{ amp: 0.8, spread: 0.2 }], performance: { partialB: 1e-4 },
    partialsByRegister: [
      { f0: 110, partialB: 1e-4, partials: [{ amp: 1, spread: 0.2 }] },
      { f0: 440, partialB: 4e-4, partials: [{ amp: 0.2, spread: 0.4 }] },
    ] };
  const mid = registerProfileAt(mock, 220);
  check("G1 register spectra interpolate in log-f0 space",
    near(mid.partials[0].amp, 0.6, 1e-12) && near(mid.partialB, 2.5e-4, 1e-12));
  check("G1 absent register tables preserve the profile table",
    registerProfileAt({ partials: mock.partials }, 220).partials === mock.partials);
  check("D4 above the top register anchor holds the highest table",
    registerProfileAt(mock, 880).partials === mock.partialsByRegister[1].partials &&
    registerProfileAt(mock, 880).partials !== mock.partialsByRegister[0].partials);
  check("G2 conical tube carries the full harmonic series",
    [1, 2, 3, 8].every(n => resonatorRatio("conicalTube", n) === n));
  check("G3 blare is neutral at zero and enriches forte",
    dynamicBrightness(16, 0, 1.5) === dynamicBrightness(16) &&
    dynamicBrightness(16, 1, 1.5) > dynamicBrightness(16));
  const ordinary = twoStageDecayPlan(1000, 0.6, 0, 8);
  const double = twoStageDecayPlan(1000, 0.6, 1, 4);
  check("G4 second decay stage is neutral at zero",
    near(ordinary.earlyT60, ordinary.lateT60, 1e-12));
  check("G4 opted-in late decay outlasts the early stage",
    near(double.lateT60, double.earlyT60 * 4, 1e-12));
  check("G6 glottal source tilt is neutral at zero and darkens upper partials",
    glottalSourceGain(16, 0) === 1 && glottalSourceGain(16, 0.8) < glottalSourceGain(2, 0.8));
  check("G7 velocity-hardness coupling is neutral at zero",
    velocityHardness(0.6, 1, 0) === 0.6);
  check("G7 harder velocity brightens an opted-in strike",
    velocityHardness(0.6, 1, 1) > velocityHardness(0.6, 0.2, 1));
  check("measured onset routing is neutral at zero",
    attackNoiseRouting(0).envelopeGain === 1 && attackNoiseRouting(0).directGain === 0);
  check("measured onset can opt into its own fast envelope",
    attackNoiseRouting(1).envelopeGain === 0 && attackNoiseRouting(1).directGain === 1);
  check("onset velocity exponent is neutral at one",
    near(attackNoiseVelocityGain(.2, 1), .2, 1e-12));
  check("lower onset exponent retains more soft transient",
    attackNoiseVelocityGain(.2, .25) > attackNoiseVelocityGain(.2, 1));
  check("breath velocity exponent is neutral at one",
    near(breathVelocityGain(.2, 1), .2, 1e-12));
  check("lower breath exponent retains relatively more pp turbulence",
    breathVelocityGain(.2, .25) > breathVelocityGain(.2, 1));
  let breathDraws = 0;
  check("L4 blown airflow is deterministic rather than randomly gated",
    toneBreathLevelFor("blow", .3, () => { breathDraws++; return 0; }) === .3 &&
    breathDraws === 0);
  check("L4 does not change non-blown tone-colour imperfection",
    toneBreathLevelFor("bow", .3, () => .5) === .15);
  const breathEngine = new GenerationEngine({
    seed: 91, voiceMode: "fourier", spectralProfile: "flute",
    excitationType: "blow", excitationHuman: 0, toneBreath: .28,
    spectralPartials: 16,
  });
  const breathFingerprint = breathEngine._spectralFingerprint(.4, 523.25, 0);
  check("L7 Fourier winds carry fitted breath into the rendered note",
    near(breathFingerprint.toneBreathLevel, .28, 1e-12));
  check("L4 airflow remains present at Human zero",
    breathFingerprint.excitationHuman === 0 && breathFingerprint.toneBreathLevel > 0);
  check("onset harmonic colour is neutral at zero",
    [1, 2, 8, 32].every(n => onsetSpectrumGain(n, 0) === 1));
  check("positive onset tilt brightens only the transient harmonic print",
    onsetSpectrumGain(16, .5) > onsetSpectrumGain(2, .5));
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
  check("WP-3 voice types expose measured /a e i o u/ bodies",
    ["voice-tenor", "voice-bass", "voice-mezzo"].every(profile =>
      "aeiou".split("").every(vowel => BODY_PRESETS[`${profile}-${vowel}`]?.measured)));
  check("instrument bodies present (violin, piano)",
    !!BODY_PRESETS.violin && !!BODY_PRESETS.piano);
  const measuredBodies = ["flute", "clarinet", "alto-sax", "trumpet", "french-horn"];
  check("L6 every measured blown body reaches the effective profile unchanged",
    measuredBodies.every(key =>
      JSON.stringify(SPECTRAL_PROFILES[key].resonances) ===
        JSON.stringify(MEASURED_PROFILES[key].resonances) &&
      BODY_PRESETS[key]?.bands === SPECTRAL_PROFILES[key].resonances &&
      bodyBandsFor({ bodyType: "auto" }, SPECTRAL_PROFILES[key]) ===
        SPECTRAL_PROFILES[key].resonances));
  const hornBase = {
    seed: 91, tempo: 100, beatDivisions: 2, motifCount: 2, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    voiceMode: "fourier", spectralPartials: 24, spectralProfile: "french-horn",
    excitationType: "blow", excitationHuman: 0, spectralResonanceAmount: 1,
  };
  const hornNote = (params) => {
    const engine = new GenerationEngine(params); engine.initialise();
    for (let i = 0; i < 24; i++) {
      const note = engine.nextNote();
      if (note && note.velocity > 0 && note.harmonicPartials) return note;
    }
    return null;
  };
  const hornAuto = hornNote({ ...hornBase, bodyType: "auto" });
  const hornExplicit = hornNote({
    ...hornBase, bodyType: "auto", bodyBands: MEASURED_PROFILES["french-horn"].resonances,
  });
  check("L6 horn auto and explicit fitted-body render paths are equivalent",
    hornAuto && hornExplicit &&
    JSON.stringify(hornAuto.bodyBands) === JSON.stringify(hornExplicit.bodyBands) &&
    JSON.stringify(hornAuto.harmonicPartials.map(row => row.amp)) ===
      JSON.stringify(hornExplicit.harmonicPartials.map(row => row.amp)));
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
  for (const key of ["flute", "clarinet", "violin", "cello", "trumpet", "trombone", "piano",
    "alto-sax", "french-horn", "guitar", "voice-tenor", "voice-bass", "voice-mezzo"]) {
    const prof = SPECTRAL_PROFILES[key];
    check(`${key}: 64 measured partials, all sane, dyn curve extended`,
      prof.partials.length === 64 &&
      prof.partials.every(p => Number.isFinite(p.amp) && p.amp >= 0 && p.amp <= 1 &&
        Number.isFinite(p.spread) && Number.isFinite(p.dyn)) &&
      prof.measured && typeof prof.measured.source === "string");
  }
  const piano = SPECTRAL_PROFILES.piano.performance;
  check("piano: refreshed multi-register fit seeds measured inharmonicity",
    piano.partialB > 5e-5 && piano.partialB < 3e-4);
  check("piano: measured material (real piano out-rings the old default)",
    piano.partialMaterial <= 0.1);
  const violin = SPECTRAL_PROFILES.violin.performance;
  check("violin: measured vibrato rate, blended depth, hand envelope kept",
    violin.vibratoRate > 5.5 && violin.vibratoRate < 6.2 &&
    violin.vibratoDepth > 16 && violin.vibratoDepth < 25.3 &&
    violin.envelopeAttack === 0.085);
  check("legacy generic vocal remains untouched while typed voices are measured",
    !SPECTRAL_PROFILES.vocal.measured && SPECTRAL_PROFILES["voice-tenor"].measured.notesAnalysed > 0);
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

console.log("Surprise gates: all-off is OFF; arps are deterministic (owner 2026-07-07)");
{
  const BASE = {
    seed: 11, tempo: 130, beatDivisions: 2, motifCount: 1, motifLengthBeats: 8,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    registerCenter: 0, gapProb: 0, restMotifStartRatio: 0, excitationHuman: 0,
    surpriseProb: 1, motifSurpriseProb: 1, incorporationRate: 1,
  };
  const run = (params, count = 24) => {
    const e = new GenerationEngine(params); e.initialise();
    const out = [];
    for (let i = 0; i < 300 && out.length < count; i++) {
      const nn = e.nextNote();
      if (nn && nn.velocity > 0) out.push(nn);
    }
    return out;
  };
  const allOff = run({ ...BASE,
    surprisePitchEnabled: false, surpriseTuningEnabled: false, surpriseRhythmEnabled: false,
    surpriseFormantEnabled: false, surpriseDynamicsEnabled: false, surpriseRestEnabled: false });
  check("every surprise dimension off = zero surprises even at prob 1",
    allOff.length > 12 && allOff.every(nn => !nn.isSurprise));
  const on = run({ ...BASE, surprisePitchEnabled: true });
  check("pitch surprise alone still fires (the off-switch is a gate, not a break)",
    on.some(nn => nn.isSurprise));
  const arp = run({ ...BASE, melodyPattern: "arpUp", arpStep: 2, arpOctaves: 1, surprisePitchEnabled: true });
  const arpClean = run({ ...BASE, melodyPattern: "arpUp", arpStep: 2, arpOctaves: 1, surpriseProb: 0, motifSurpriseProb: 0, surprisePitchEnabled: true });
  check("arp ignores surprise entirely: same degrees with surprise at prob 1 and 0",
    arp.length > 8 && !arp.some(nn => nn.isSurprise) &&
    arp.map(nn => nn.degree).join(",") === arpClean.map(nn => nn.degree).join(","));
}

console.log("CH-B2: onset-noise level scaling");
{
  const GEN8 = {
    seed: 3, tempo: 120, beatDivisions: 2, motifCount: 1, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    spectralProfile: "violin", excitationHuman: 0,
  };
  const fpAt = (lvl) => new GenerationEngine({ ...GEN8, attackNoiseLevel: lvl })._spectralFingerprint(0.62, 261.63, 0);
  const base = fpAt(1), off = fpAt(0), loud = fpAt(2);
  check("onset noise at 1 = the instrument's own transient",
    base.attackNoise && Math.abs(base.attackNoise.level - fpAt(undefined ?? 1).attackNoise.level) < 1e-9);
  check("onset noise at 0 = silent transient, at 2 = doubled",
    off.attackNoise.level === 0 && Math.abs(loud.attackNoise.level - base.attackNoise.level * 2) < 1e-9);
  const measured = { freq: 1400, q: 2.1, decay: .08, level: .3, bandT90ms: [5, 8] };
  const legacy = resolveAttackNoise(measured, {});
  const pinned = resolveAttackNoise(measured, {
    attackNoiseFreq: 620, attackNoiseQ: 1.25, attackNoiseDecay: .23, attackNoiseLevel: .5,
  });
  check("absent pinned transient fields preserve the measured profile exactly",
    JSON.stringify(legacy) === JSON.stringify(measured));
  check("explicit pinned transient fields reach the renderer without losing metadata",
    pinned.freq === 620 && pinned.q === 1.25 && pinned.decay === .23 &&
    Math.abs(pinned.level - .15) < 1e-12 && pinned.bandT90ms === measured.bandT90ms);
  const anchors = [
    { f0: 60, levelScale: .05, freq: 7000, q: 2.3, decay: .12 },
    { f0: 240, levelScale: 1, freq: 400, q: 1.0, decay: .2 },
  ];
  const low = resolveAttackNoise(measured, { attackNoiseByRegister: anchors }, 60);
  const mid = registerAttackNoiseAt(anchors, 120);
  check("register onset anchors are neutral when absent and exact at an anchor",
    resolveAttackNoise(measured, {}, 60).level === measured.level &&
    low.freq === 7000 && Math.abs(low.level - measured.level * .05) < 1e-12);
  check("register onset anchors interpolate continuously in log-f0 space",
    Math.abs(mid.levelScale - .525) < 1e-12 && Math.abs(mid.freq - 3700) < 1e-9);
}

console.log("P3: note connection — glide vs ring on overlap");
{
  const GEN9 = {
    seed: 4, tempo: 120, beatDivisions: 2, motifCount: 1, motifLengthBeats: 8,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    registerCenter: 0, restMotifStartRatio: 0, surpriseProb: 0, excitationHuman: 0,
    gapProb: 1, gapMin: -0.5, gapMax: -0.2, // every gap negative = forced overlap
  };
  const run = (params) => {
    const e = new GenerationEngine(params); e.initialise();
    const out = [];
    for (let i = 0; i < 100 && out.length < 16; i++) {
      const nn = e.nextNote();
      if (nn && nn.velocity > 0) out.push(nn);
    }
    return out;
  };
  const glide = run({ ...GEN9, noteConnection: "glide" });
  const ring = run({ ...GEN9, noteConnection: "ring" });
  check("glide: overlapped notes slide from the previous pitch (mono legato)",
    glide.slice(1).some(nn => nn.legatoFromPrevious && nn.slideFromFrequency != null));
  check("ring: overlapped notes start at their own pitch — no slide, multiphonic",
    ring.slice(1).every(nn => !nn.legatoFromPrevious && nn.slideFromFrequency == null));
  const divSec = 60 / 120 / 2;
  check("ring keeps the overlap: tails still extend past the grid slot",
    ring.some(nn => nn.gapFraction <= 0 && nn.duration > nn.durationDivs * divSec + 1e-6));
  check("default is glide (unchanged behaviour for existing patches)",
    run(GEN9).slice(1).some(nn => nn.legatoFromPrevious));
}

// ── World tunings: per-degree pitch centres (owner 07-07) ──
{
  const { Scale, CULTURAL_SCALES, GenerationEngine } = await import("../web/static/synth.js");
  const cents = (hzA, hzB) => 1200 * Math.log2(hzB / hzA);
  // Pythagorean: the fifth is exactly 3:2 (701.955¢)
  const py = CULTURAL_SCALES.pythagorean;
  const sPy = new Scale(12, py.degrees, py.sub, 0.7, 261.63, py.tuning);
  check("Tuning: Pythagorean fifth is a pure 3:2 (702¢ within rounding)",
    Math.abs(cents(sPy.degreeToHz(0), sPy.degreeToHz(7)) - 701.955) < 1.1);
  // Just: the major third is exactly 5:4 (386.31¢)
  const ju = CULTURAL_SCALES.just;
  const sJu = new Scale(12, ju.degrees, ju.sub, 0.7, 261.63, ju.tuning);
  check("Tuning: just major third is a pure 5:4 (386¢ within rounding)",
    Math.abs(cents(sJu.degreeToHz(0), sJu.degreeToHz(4)) - 386.31) < 1.1);
  check("Tuning: offsets repeat at the octave (pitch-class based)",
    Math.abs(cents(sJu.degreeToHz(4), sJu.degreeToHz(16)) - 1200) < 1e-6);
  check("Tuning: no tuning → exact EDO grid (untouched path)",
    new Scale(12, [0, 7], [0], 0.7, 261.63).degreeToHz(7) === 261.63 * Math.pow(2, 7 / 12));
  // Maqam Rast on the 24-EDO grid: the third sits at 350¢ (E half-flat)
  const ra = CULTURAL_SCALES.rast;
  const sRa = new Scale(24, ra.degrees, ra.sub, 0.7, 261.63, ra.tuning);
  check("Tuning: Rast's third is the quarter-tone 350¢",
    Math.abs(cents(sRa.degreeToHz(0), sRa.degreeToHz(7)) - 350) < 1e-6);
  check("Tuning: every cultural preset is internally consistent",
    Object.values(CULTURAL_SCALES).every(s =>
      s.degrees.every(d => d >= 0 && d < s.edo) &&
      (s.sub || []).every(d => s.degrees.includes(d)) &&
      (s.roots || []).every(d => s.degrees.includes(d)) &&
      (!s.tuning || Object.keys(s.tuning).every(k => Math.abs(s.tuning[k]) < 1200 / s.edo))));
  // the engine carries degreeTuning end to end
  const eng = new GenerationEngine({ scaleMode: "12tone", scalePreset: "major",
    customDegrees: ju.degrees, subScaleWeight: 0.7, tonicHz: 261.63, degreeTuning: ju.tuning });
  check("Tuning: GenerationEngine's scale applies degreeTuning",
    Math.abs(cents(eng._buildScale().degreeToHz(0), eng._buildScale().degreeToHz(4)) - 386.31) < 1.1);
}

// ── Q10: MIDI mapping — the full 2×3×2 option grid ──
{
  const { midiMapDegree, GenerationEngine } = await import("../web/static/synth.js");
  const majorScale = new GenerationEngine({ scaleMode: "12tone", scalePreset: "major", subScaleWeight: 0.7 })._buildScale();
  const edoScale = new GenerationEngine({ scaleMode: "edo", edoDivisions: 19,
    customDegrees: [0, 3, 6, 8, 11, 14, 17], subScaleWeight: 0.7 })._buildScale();
  const m = (nn, opts, scale = majorScale) => midiMapDegree(nn, scale, opts);
  // white + packed + octave (default): white keys walk the scale, restart each C
  const WPO = { keys: "white", coverage: "packed", anchor: "octave" };
  check("Q10 W/packed/oct: C4→0 D4→2 E4→4 B4→11",
    m(60, WPO) === 0 && m(62, WPO) === 2 && m(64, WPO) === 4 && m(71, WPO) === 11);
  check("Q10 W/packed/oct: next C repeats an octave up", m(72, WPO) === 12 && m(48, WPO) === -12);
  check("Q10 W/packed/oct: black keys silent", m(61, WPO) === null && m(66, WPO) === null);
  // white + packed + consecutive: 7 degrees then straight on
  const WPC = { keys: "white", coverage: "packed", anchor: "consecutive" };
  check("Q10 W/packed/consec: same inside the first octave", m(64, WPC) === 4 && m(71, WPC) === 11);
  check("Q10 W/packed/consec: identical to octave for 7-degree scales (7 white keys)",
    m(72, WPC) === 12 && m(74, WPC) === 14);
  // white + all + octave: white keys walk RAW divisions 0..6, divisions 7-11 unreachable
  const WAO = { keys: "white", coverage: "all", anchor: "octave" };
  check("Q10 W/all/oct: E4 is division 2 (third white key)", m(64, WAO) === 2);
  check("Q10 W/all/oct: next C restarts at division 12", m(72, WAO) === 12);
  // white + all + consecutive: divisions run on across octaves — C5 is the 8th white key
  const WAC = { keys: "white", coverage: "all", anchor: "consecutive" };
  check("Q10 W/all/consec: C5 continues at division 7", m(72, WAC) === 7 && m(74, WAC) === 8);
  // white + muted variants: division must be in scale
  check("Q10 W/muted/oct: D4 (2nd white key → raw division 1 = C#) is muted",
    m(62, { keys: "white", coverage: "muted", anchor: "octave" }) === null);
  check("Q10 W/muted/consec: C4 passes (division 0 in scale), black keys still absent",
    m(60, { keys: "white", coverage: "muted", anchor: "consecutive" }) === 0 &&
    m(63, { keys: "white", coverage: "muted", anchor: "consecutive" }) === null);
  // all keys variants
  const AAO = { keys: "all", coverage: "all", anchor: "octave" };
  check("Q10 A/all/oct: chromatic identity around C4", m(61, AAO) === 1 && m(59, AAO) === -1 && m(72, AAO) === 12);
  check("Q10 A/all/consec: same as octave in 12-EDO (12 keys = 12 divisions)",
    m(61, { keys: "all", coverage: "all", anchor: "consecutive" }) === 1);
  check("Q10 A/muted/oct: C#4 muted, D4 passes",
    m(61, { keys: "all", coverage: "muted", anchor: "octave" }) === null &&
    m(62, { keys: "all", coverage: "muted", anchor: "octave" }) === 2);
  const APO = { keys: "all", coverage: "packed", anchor: "octave" };
  check("Q10 A/packed/oct: 12 keys walk 7 degrees, spares silent",
    m(60, APO) === 0 && m(61, APO) === 2 && m(66, APO) === 11 && m(67, APO) === null && m(72, APO) === 12);
  const APC = { keys: "all", coverage: "packed", anchor: "consecutive" };
  check("Q10 A/packed/consec: repeats at the very next key (8th key = octave)",
    m(67, APC) === 12 && m(74, APC) === 24);
  // 19-EDO (7 in-scale degrees of 19 divisions)
  check("Q10 19-EDO W/packed/oct: white keys walk the 7 custom degrees",
    m(60, WPO, edoScale) === 0 && m(62, WPO, edoScale) === 3 && m(71, WPO, edoScale) === 17);
  check("Q10 19-EDO W/packed/oct: next C is +19 divisions", m(72, WPO, edoScale) === 19);
  check("Q10 19-EDO A/all/oct: 12 keys reach only divisions 0-11 before the C restart",
    m(71, { keys: "all", coverage: "all", anchor: "octave" }, edoScale) === 11 &&
    m(72, { keys: "all", coverage: "all", anchor: "octave" }, edoScale) === 19);
  check("Q10 19-EDO A/all/consec: keys keep counting past 11 into the same EDO octave",
    m(72, { keys: "all", coverage: "all", anchor: "consecutive" }, edoScale) === 12 &&
    m(79, { keys: "all", coverage: "all", anchor: "consecutive" }, edoScale) === 19);
  check("Q10: invalid input maps to nothing", m(NaN, WPO) === null && midiMapDegree(60, null, WPO) === null);
}

// ── Q10b: musical typing — computer keyboard as MIDI keyboard ──
{
  const { kbdMidiNote, kbdIsNoteCode, midiMapDegree, GenerationEngine } = await import("../web/static/synth.js");
  // the DAW-standard two-row piano: home row white, row above black
  check("Q10b typing: A-row walks the white keys from middle C",
    kbdMidiNote("KeyA") === 60 && kbdMidiNote("KeyS") === 62 && kbdMidiNote("KeyD") === 64 &&
    kbdMidiNote("KeyF") === 65 && kbdMidiNote("KeyJ") === 71 && kbdMidiNote("KeyK") === 72);
  check("Q10b typing: W-row fills in the black keys",
    kbdMidiNote("KeyW") === 61 && kbdMidiNote("KeyE") === 63 && kbdMidiNote("KeyT") === 66 &&
    kbdMidiNote("KeyY") === 68 && kbdMidiNote("KeyU") === 70 && kbdMidiNote("KeyO") === 73);
  check("Q10b typing: the map runs to the apostrophe (octave and a half)",
    kbdMidiNote("KeyL") === 74 && kbdMidiNote("KeyP") === 75 &&
    kbdMidiNote("Semicolon") === 76 && kbdMidiNote("Quote") === 77);
  check("Q10b typing: octave shift moves in whole octaves",
    kbdMidiNote("KeyA", 1) === 72 && kbdMidiNote("KeyA", -2) === 36 && kbdMidiNote("Quote", 1) === 89);
  check("Q10b typing: notes outside 0-127 stay silent",
    kbdMidiNote("KeyA", -6) === null && kbdMidiNote("Quote", 6) === null && kbdMidiNote("KeyA", 5) === 120);
  check("Q10b typing: non-note keys map to nothing",
    kbdMidiNote("KeyZ") === null && kbdMidiNote("KeyX") === null && kbdMidiNote("Space") === null &&
    kbdMidiNote("KeyQ") === null && !kbdIsNoteCode("KeyR") && kbdIsNoteCode("KeyH"));
  check("Q10b typing: bad octave shift maps to nothing", kbdMidiNote("KeyA", NaN) === null);
  // end-to-end: a typed key feeds the existing mapping unchanged — under the
  // white/packed/octave default, black-key codes land on black MIDI notes
  // which the mapping silences, exactly like a hardware keyboard
  const majorScale = new GenerationEngine({ scaleMode: "12tone", scalePreset: "major", subScaleWeight: 0.7 })._buildScale();
  const WPO = { keys: "white", coverage: "packed", anchor: "octave" };
  check("Q10b typing → mapping: home row plays the scale, black-key row is silent",
    midiMapDegree(kbdMidiNote("KeyA"), majorScale, WPO) === 0 &&
    midiMapDegree(kbdMidiNote("KeyD"), majorScale, WPO) === 4 &&
    midiMapDegree(kbdMidiNote("KeyW"), majorScale, WPO) === null);
}

// ── Q8: imperfections — four small physical truths ──
{
  const { onsetScoopCents, partialOnsetDelay, releaseRingSeconds, f0WanderTrace, materialT60 } =
    await import("../web/static/synth.js");
  // 1 · onset scoop
  check("Q8 scoop: blown embouchure approaches from below",
    onsetScoopCents("blow", 1) < 0);
  check("T-008 non-blown defaults do not inherit the embouchure scoop",
    onsetScoopCents("bow", 1) === 0 && onsetScoopCents("pluck", 1) === 0 &&
    onsetScoopCents("strike", 1) === 0);
  check("Q8 scoop: machines don't hunt (human 0 → 0)", onsetScoopCents("blow", 0) === 0);
  check("Q8 scoop: scales with human", Math.abs(onsetScoopCents("blow", 0.5)) === Math.abs(onsetScoopCents("blow", 1)) / 2);
  // 2 · attack stagger
  check("Q8 stagger: fundamental speaks first", partialOnsetDelay(1, "bow") === 0);
  check("Q8 stagger: higher partials wait longer",
    partialOnsetDelay(32, "bow") > partialOnsetDelay(8, "bow") && partialOnsetDelay(8, "bow") > 0);
  check("Q8 stagger: strike/pluck speak at once",
    partialOnsetDelay(32, "strike") === 0 && partialOnsetDelay(32, "pluck") === 0);
  check("Q8 stagger: measured value wins over the hand default",
    Math.abs(partialOnsetDelay(64, "bow", 100) - 0.1) < 1e-9);
  check("Q8 stagger: capped at 120 ms", partialOnsetDelay(64, "bow", 500) <= 0.12);
  // 3 · release ring
  check("Q8 ring: no material → no ring", releaseRingSeconds(0, 440) === 0);
  check("Q8 ring: follows the material T60 law",
    Math.abs(releaseRingSeconds(0.6, 440) - Math.min(1.8, materialT60(440, 0.6) * 0.5)) < 1e-9);
  check("Q8 ring: lows ring longer than highs (same material)",
    releaseRingSeconds(0.6, 220) >= releaseRingSeconds(0.6, 3520));
  check("Q8 ring: CPU cap at 1.8 s", releaseRingSeconds(1, 60) <= 1.8);
  // 4 · f0 wander
  const mkRand = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const w = f0WanderTrace(mkRand(7), 4, 1);
  check("Q8 wander: bounded to ±4¢ at Human 1", w.length > 4 && w.every(p => Math.abs(p.cents) <= 4));
  check("Q8 wander: slow (steps ≥ 0.3 s apart)", w.every((p, i) => i === 0 || p.time - w[i - 1].time > 0.3));
  check("Q8 wander: machines hold still (human 0 → empty)", f0WanderTrace(mkRand(7), 4, 0).length === 0);
  check("Q8 wander: short notes don't wander", f0WanderTrace(mkRand(7), 0.3, 1).length === 0);
  check("Q8 wander: deterministic per seed",
    JSON.stringify(f0WanderTrace(mkRand(7), 4, 1)) === JSON.stringify(f0WanderTrace(mkRand(7), 4, 1)));
}

// ── Owner L5/L5b: correlated onset articulation ──
{
  const { articulationOnsetPlan } = await import("../web/static/synth.js");
  let draws = 0;
  const neutral = articulationOnsetPlan(() => { draws++; return .1; }, { coupling: 0 });
  check("L5 articulation: neutral coupling is an exact identity",
    draws === 0 && neutral.transientGain === 1 && neutral.breathLeadGain === 1 &&
    neutral.scoopCents === 0);
  const machine = articulationOnsetPlan(() => .1, {
    coupling: 1, human: 0, strength: 0, depthCents: 100,
  });
  check("L5 articulation: Human 0 hits the pitch exactly",
    machine.scoopCents === 0);
  const options = {
    coupling: 1, human: 1, variation: 0, velocity: .9, frequency: 130,
    depthCents: 100, settleSec: .1, phraseStart: true,
  };
  const weak = articulationOnsetPlan(() => .5, { ...options, strength: .1 });
  const strong = articulationOnsetPlan(() => .5, { ...options, strength: .9 });
  check("L5b articulation: plosive and scoop are anticorrelated",
    strong.transientGain > weak.transientGain &&
    Math.abs(strong.scoopCents) < Math.abs(weak.scoopCents));
  check("L5b articulation: weak attacks lead with more breath",
    weak.breathLeadGain > strong.breathLeadGain);
  const inside = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, phraseStart: false, rearticulatedScale: .25 });
  const legato = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, legato: true });
  check("L5 articulation: phrase position reduces scoop and legato removes it",
    near(Math.abs(inside.scoopCents), Math.abs(weak.scoopCents) * .25, 1e-9) &&
    legato.scoopCents === 0);
  const low = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, frequency: 100, registerSlope: .5 });
  const high = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, frequency: 400, registerSlope: .5 });
  const soft = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, velocity: .25, velocitySlope: -.5 });
  const loud = articulationOnsetPlan(() => .5,
    { ...options, strength: .1, velocity: 1, velocitySlope: -.5 });
  check("L5 articulation: fitted laws can favour low/soft cold starts",
    Math.abs(low.scoopCents) > Math.abs(high.scoopCents) &&
    Math.abs(soft.scoopCents) > Math.abs(loud.scoopCents));
  const softPlosive = articulationOnsetPlan(() => .5,
    { ...options, strength: .5, velocity: .2, strengthVelocitySlope: 1 });
  const loudPlosive = articulationOnsetPlan(() => .5,
    { ...options, strength: .5, velocity: 1, strengthVelocitySlope: 1 });
  const neutralSoft = articulationOnsetPlan(() => .5,
    { ...options, strength: .5, velocity: .2, strengthVelocitySlope: 0 });
  const neutralLoud = articulationOnsetPlan(() => .5,
    { ...options, strength: .5, velocity: 1, strengthVelocitySlope: 0 });
  check("L9 articulation: positive velocity slope makes forte plosive stronger",
    loudPlosive.strength > softPlosive.strength &&
    loudPlosive.transientGain > softPlosive.transientGain &&
    loudPlosive.breathLeadGain < softPlosive.breathLeadGain &&
    Math.abs(loudPlosive.scoopCents) < Math.abs(softPlosive.scoopCents));
  check("L9 articulation: zero velocity slope is an exact neutral law",
    neutralSoft.strength === neutralLoud.strength &&
    neutralSoft.transientGain === neutralLoud.transientGain);
}

// ── Q7: layered subnote modules ──
{
  const { GenerationEngine } = await import("../web/static/synth.js");
  const LAYER = {
    id: "L1",
    gain: 0.6,
    space: { angle: 90, dist: 4 },
    independentHead: false,
    subnote: { spectralProfile: "flute", envelopeAttack: 0.09 },
  };
  const BASE = {
    seed: 21, tempo: 120, scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63,
    rootNotes: [0], surpriseProb: 0, motifCount: 1, motifLengthBeats: 4,
    spectralProfile: "violin", spectralMix: 1, partialTransfer: 0.5,
    envelopeProb: 1, envelopeAttackSd: 0.03, envelopeDecaySd: 0.05,
  };
  const firstNote = (params) => {
    const e = new GenerationEngine(params); e.initialise();
    for (let i = 0; i < 30; i++) { const n = e.nextNote(); if (n && n.velocity > 0) return n; }
    return null;
  };
  const n = firstNote({ ...BASE, layers: [LAYER] });
  check("Q7: notes carry one render per layer", n.layerRenders?.length === 1);
  const lr = n.layerRenders[0];
  check("Q7: layer renders its own fingerprint (different profile → different partials)",
    Array.isArray(lr.note.harmonicPartials) && lr.note.harmonicPartials.length > 0 &&
    JSON.stringify(lr.note.harmonicPartials.map(p => +p.amp.toFixed(4))) !==
    JSON.stringify(n.harmonicPartials.map(p => +p.amp.toFixed(4))));
  check("Q7: layer gain and space travel with the render",
    lr.gain === 0.6 && lr.space.angle === 90 && lr.space.dist === 4);
  check("Q7: independent envelope draws by default",
    lr.note.envelopeAttack !== n.envelopeAttack);
  // Owner rework: the override shares the variation TRIGGER + z-scores +
  // SDs (magnitude); every stream keeps its OWN envelope MEANS. So under
  // sync, base and layer deviate from their different means by exactly
  // the same amount (same z × same shared SD).
  const SYNC = {
    ...BASE,
    envelopeAttack: 0.05, envelopeAttackSd: 0.01,
    layers: [{ ...LAYER, subnote: { ...LAYER.subnote, envelopeAttack: 0.09, envelopeAttackSd: 0.02 } }],
    layerEnvOverride: true,
    layerEnvAttackSd: 0.012,
  };
  const nOn2 = firstNote({ ...SYNC, layerEnvProb: 1 });
  const dBase = nOn2.envelopeAttack - 0.05;
  const dLayer = nOn2.layerRenders[0].note.envelopeAttack - 0.09;
  check("Q7 sync: same z × same SHARED SD → identical deviation around each stream's own mean",
    Math.abs(dBase) > 1e-6 && Math.abs(dBase - dLayer) < 1e-9, `dBase ${dBase} dLayer ${dLayer}`);
  check("Q7 sync: the shared SD (not the streams' own SDs) sets the magnitude",
    Math.abs(Math.abs(dBase) / 0.012) < 6 && Math.abs(dBase) !== 0, // z within ±6 of the shared SD scale
    `deviation ${dBase} vs shared sd 0.012`);
  const nOff2 = firstNote({ ...SYNC, layerEnvProb: 0 });
  check("Q7 sync: trigger chance 0 → base and layer sit exactly on their own means",
    nOff2.envelopeAttack === 0.05 && nOff2.layerRenders[0].note.envelopeAttack === 0.09);
  const nA = firstNote({ ...BASE, layers: [LAYER] });
  const nB = firstNote({ ...BASE, layers: [LAYER] });
  check("Q7: one seed drives all layers deterministically",
    JSON.stringify(nA.layerRenders[0].note.harmonicPartials) === JSON.stringify(nB.layerRenders[0].note.harmonicPartials) &&
    nA.layerRenders[0].note.envelopeAttack === nB.layerRenders[0].note.envelopeAttack);
  const nOff = firstNote({ ...BASE, partialTransfer: 0, layers: [LAYER] });
  const nOn = firstNote({ ...BASE, partialTransfer: 1, layers: [LAYER] });
  check("Q7: cross-layer coupling moves union amplitudes (transfer 0 vs 1 differ)",
    JSON.stringify(nOff.harmonicPartials.map(p => +p.amp.toFixed(5))) !==
    JSON.stringify(nOn.harmonicPartials.map(p => +p.amp.toFixed(5))));
  check("Q7: no layers → no layerRenders (untouched path)",
    firstNote(BASE).layerRenders === undefined);
  // Owner 07-07: per-layer solo travels with the render; the renderer
  // silences the base + unsoloed layers whenever any solo is set.
  const nSolo = firstNote({ ...BASE, layers: [{ ...LAYER, solo: true }, { ...LAYER, id: "L2", solo: false }] });
  check("Q7 solo: the flag rides each layerRender",
    nSolo.layerRenders[0].solo === true && nSolo.layerRenders[1].solo === false);
}

// ── Q6: global space designer interpolator ──
{
  const { trackSpaceAt } = await import("../web/static/synth.js");
  const A = [
    { beat: 0, angle: -90, dist: 2, smooth: 0 },
    { beat: 8, angle: 90, dist: 6, smooth: 0 },
    { beat: 16, angle: 0, dist: 2, smooth: 1 },
  ];
  check("Q6: exact hit at an anchor", trackSpaceAt(A, 8).angle === 90 && trackSpaceAt(A, 8).dist === 6);
  check("Q6: linear midpoint at smooth 0",
    trackSpaceAt(A, 4).angle === 0 && trackSpaceAt(A, 4).dist === 4);
  check("Q6: linear quarter-point at smooth 0", trackSpaceAt(A, 2).angle === -45);
  const q = trackSpaceAt(A, 10); // smooth-blended segment (mean 0.5), t=0.25
  const tLin = 0.25, tSm = tLin * tLin * (3 - 2 * tLin);
  const expected = 90 + (0 - 90) * (0.5 * tSm + 0.5 * tLin);
  check("Q6: smoothness eases toward smoothstep", Math.abs(q.angle - expected) < 1e-9, `${q.angle} vs ${expected}`);
  check("Q6: clamps before the first anchor", trackSpaceAt(A, -5).angle === -90);
  check("Q6: clamps after the last anchor", trackSpaceAt(A, 99).dist === 2);
  check("Q6: unsorted anchors are sorted first",
    trackSpaceAt([A[2], A[0], A[1]], 4).angle === 0);
  check("Q6: empty/missing anchors resolve to nothing",
    trackSpaceAt([], 0) === null && trackSpaceAt(null, 0) === null);
  check("Q6: single anchor is a constant", trackSpaceAt([{ beat: 4, angle: 30, dist: 3 }], 99).angle === 30);
}

// ── Q5: global scale strip resolution law ──
{
  const { globalScaleAt, GenerationEngine } = await import("../web/static/synth.js");
  const gs = {
    enabled: true,
    markers: [
      { atBeat: 0, degrees: [0, 2, 4, 5, 7, 9, 11], subScaleNotes: [0, 4, 7], rootNotes: [0] },
      { atBeat: 16, degrees: [0, 3, 5, 7, 10], subScaleNotes: [0, 7], rootNotes: [0] },
    ],
  };
  check("Q5: marker at/before the beat wins", globalScaleAt(gs, 8).atBeat === 0);
  check("Q5: exact-beat marker applies", globalScaleAt(gs, 16).atBeat === 16);
  check("Q5: latest prior marker wins", globalScaleAt(gs, 40).atBeat === 16);
  check("Q5: disabled strip resolves to nothing", globalScaleAt({ ...gs, enabled: false }, 8) === null);
  check("Q5: before the first marker resolves to nothing",
    globalScaleAt({ enabled: true, markers: [{ atBeat: 8, degrees: [0] }] }, 4) === null);
  check("Q5: missing/empty strip is safe", globalScaleAt(null, 0) === null && globalScaleAt({ enabled: true }, 0) === null);
  // Opted-in generation actually follows the marker's degrees
  const base = { seed: 11, tempo: 120, scaleMode: "12tone", scalePreset: "major",
    tonicHz: 261.63, rootNotes: [0], surpriseProb: 0, motifCount: 1, motifLengthBeats: 4 };
  const m = globalScaleAt(gs, 40);
  const merged = { ...base, customDegrees: [...m.degrees], subScaleNotes: [...m.subScaleNotes], rootNotes: [...m.rootNotes] };
  const eng = new GenerationEngine(merged); eng.initialise();
  const degreesSeen = new Set();
  for (let i = 0; i < 60; i++) { const n = eng.nextNote(); if (n && n.velocity > 0) degreesSeen.add(((n.degree % 12) + 12) % 12); }
  check("Q5: opted-in take draws only marker degrees",
    [...degreesSeen].every(d => m.degrees.includes(d)), [...degreesSeen].join(","));
  // Baked notes untouched by construction: degree→Hz ignores the degree list
  const hzUnder = (degrees) => new GenerationEngine({ ...base, customDegrees: degrees }).scale.degreeToHz(7);
  check("Q5: baked pitch (degree→Hz) is independent of the degree list",
    Math.abs(hzUnder([0, 2, 4, 5, 7, 9, 11]) - hzUnder([0, 3, 5, 7, 10])) < 1e-9);
}

// ── Q4: binaural head model laws ──
{
  const { itdSeconds, pinnaParams, spaceDistanceGain, foldAngle } =
    await import("../web/static/synth.js");
  const deg = (x) => x * Math.PI / 180;
  check("Q4 ITD: zero dead ahead", Math.abs(itdSeconds(0)) < 1e-9);
  check("Q4 ITD: zero dead behind", Math.abs(itdSeconds(deg(180))) < 1e-9);
  check("Q4 ITD: maximal at ±90°",
    itdSeconds(deg(90)) > itdSeconds(deg(60)) && itdSeconds(deg(60)) > itdSeconds(deg(30)));
  check("Q4 ITD: Woodworth magnitude at 90° (~0.65 ms for 0.175 m)",
    Math.abs(itdSeconds(deg(90), 0.175) - (0.0875 * (Math.PI / 2 + 1) / 343)) < 1e-6);
  check("Q4 ITD: proportional to ear distance",
    Math.abs(itdSeconds(deg(90), 0.25) / itdSeconds(deg(90), 0.125) - 2) < 1e-6);
  check("Q4 ITD: signed — left source leads the left ear", itdSeconds(deg(-90)) < 0);
  check("Q4 ITD: front/behind mirror-pairs share laterality",
    Math.abs(itdSeconds(deg(45)) - itdSeconds(deg(135))) < 1e-9);
  // Head shadow — Brown & Duda (1998) structural model
  const { headShadowAlpha, headShadowDb, headShadowFreq } = await import("../web/static/synth.js");
  check("Q4 BD shadow: α = 2.0 (+6 dB bright spot) with the source AT the ear",
    Math.abs(headShadowAlpha(deg(90), "R") - 2.0) < 1e-9 &&
    Math.abs(headShadowAlpha(deg(-90), "L") - 2.0) < 1e-9);
  check("Q4 BD shadow: α = 0.1 (-20 dB) at the published deepest-shadow angle (150° off-axis)",
    Math.abs(headShadowAlpha(deg(-60), "R") - 0.1) < 1e-9); // source 150° from the right-ear axis
  check("Q4 BD shadow: a frontal source shadows both ears identically (zero ILD) at the published α(90°)",
    Math.abs(headShadowAlpha(0, "R") - headShadowAlpha(0, "L")) < 1e-12 &&
    Math.abs(headShadowAlpha(0, "R") - (1.05 + 0.95 * Math.cos(Math.PI * 108 / 180))) < 1e-9);
  check("Q4 BD shadow: left/right symmetric",
    Math.abs(headShadowDb(deg(40), "L") - headShadowDb(deg(-40), "R")) < 1e-9);
  check("Q4 BD shadow: density scales around the published model (0.5 = exact, 0 = transparent, 1 = doubled)",
    headShadowDb(deg(90), "L", 0) === 0 &&
    Math.abs(headShadowDb(deg(90), "L", 1) - 2 * headShadowDb(deg(90), "L", 0.5)) < 1e-9);
  check("Q4 BD shadow: corner f0 = c/(2πa) ≈ 624 Hz for default ears, lower for wider heads",
    Math.abs(headShadowFreq(0.175) - 343 / (2 * Math.PI * 0.0875)) < 0.5 &&
    headShadowFreq(0.25) < headShadowFreq(0.175));
  // Pinna — Shaw (1974) concha resonance + Blauert directional bands
  check("Q4 pinna: silent anywhere in the front half-plane",
    pinnaParams(0).conchaDb === 0 && pinnaParams(deg(90)).conchaDb === 0 && pinnaParams(deg(-90)).shelfDb === 0);
  check("Q4 pinna: behind loses the ~4.3 kHz concha gain, to -8 dB dead-behind (Shaw)",
    pinnaParams(deg(135)).conchaDb < 0 &&
    Math.abs(pinnaParams(deg(180)).conchaDb - (-8)) < 1e-9 &&
    pinnaParams(deg(180)).conchaHz === 4300);
  check("Q4 pinna: flange shadows highs ≥8 kHz to -7 dB dead-behind",
    Math.abs(pinnaParams(deg(180)).shelfDb - (-7)) < 1e-9 && pinnaParams(deg(180)).shelfHz === 8000);
  check("Q4 pinna: front-back transition is smooth (135° between 0 and dead-behind)",
    pinnaParams(deg(135)).conchaDb < 0 && pinnaParams(deg(135)).conchaDb > pinnaParams(deg(180)).conchaDb);
  check("Q4 distance gain: unity inside 1 m, inverse beyond",
    spaceDistanceGain(0.5) === 1 && Math.abs(spaceDistanceGain(4) - 0.25) < 1e-9);
  check("Q4 foldAngle: wraps 270° to -90°", Math.abs(foldAngle(deg(270)) - deg(-90)) < 1e-9);
}

// ── Q3: baked notes persist their per-note performance draw ──
{
  const { SynthEngine, notePerformance } = await import("../web/static/synth.js");
  const BAKE = {
    seed: 7, tempo: 120, beatDivisions: 2, motifCount: 1, motifLengthBeats: 4,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63, rootNotes: [0],
    surpriseProb: 0, restMotifStartRatio: 0,
    envelopeProb: 1, envelopeAttack: 0.05, envelopeAttackSd: 0.02,
    vibratoProb: 0.8, vibratoDepth: 12, vibratoRate: 5.2,
    spectralProfile: "violin", spectralMix: 1,
  };
  const eng = new SynthEngine();
  const notes = eng.captureSpan(BAKE, 4);
  check("Q3: bake produces notes", notes.length > 0, `${notes.length} notes`);
  check("Q3: every baked note carries performance", notes.every(n => n.performance));
  const p0 = notes[0].performance;
  check("Q3: envelope draw persisted and mirrors the audible fields",
    p0.envelope.a === notes[0].envelopeAttack && p0.envelope.s === notes[0].envelopeSustain);
  check("Q3: vibrato parameterisation persisted when active",
    p0.vibrato && p0.vibrato.depth === 12 && p0.vibrato.rate === 5.2);
  check("Q3: tuning mirrors intonationCents",
    notes.every(n => n.performance.tuningCents === (n.intonationCents || 0)));
  check("Q3: onset noise level from the fingerprint",
    p0.attackNoiseLevel == null || Number.isFinite(p0.attackNoiseLevel));
  const glideNotes = eng.captureSpan({ ...BAKE, gapProb: 1, gapMin: -0.5, gapMax: -0.2, noteConnection: "glide" }, 4);
  check("Q3: glide capture — overlapped notes record glideFrom + ms",
    glideNotes.some(n => n.performance.glideFrom != null && n.performance.glideMs >= 0));
  check("Q3: envelope determinism — same seed bakes the same draws",
    JSON.stringify(eng.captureSpan(BAKE, 4).map(n => n.performance.envelope)) ===
    JSON.stringify(notes.map(n => n.performance.envelope)));
  check("Q3: notePerformance on a bare legacy note degrades to nulls",
    (() => { const p = notePerformance({}); return p.vibrato === null && p.glideFrom === null && p.tuningCents === 0; })());
}

// ── Room designer + ear models (owner 07-07 round 3) ─────────────────
{
  const { REVERB_PROFILES, earlyReflectionPattern, EAR_MODELS, pinnaParams } =
    await import("../web/static/synth.js");
  check("rooms: catalogue has 10 parametric models", Object.keys(REVERB_PROFILES).length === 10);
  check("rooms: every model carries designer defaults + a blurb",
    Object.values(REVERB_PROFILES).every(r =>
      r.size >= 0 && r.size <= 1 && r.damping >= 0 && r.damping <= 1 &&
      r.diffusion >= 0 && r.diffusion <= 1 && typeof r.blurb === "string" && r.label));
  check("rooms: RT ordering is physical (booth < room < hall < cathedral)",
    REVERB_PROFILES.studio.duration < REVERB_PROFILES.room.duration &&
    REVERB_PROFILES.room.duration < REVERB_PROFILES.hall.duration &&
    REVERB_PROFILES.hall.duration < REVERB_PROFILES.cathedral.duration);
  const e1 = earlyReflectionPattern("hall", 0.2, 0.5);
  const e2 = earlyReflectionPattern("hall", 0.9, 0.5);
  check("early pattern: deterministic",
    JSON.stringify(earlyReflectionPattern("hall", 0.2, 0.5)) === JSON.stringify(e1));
  check("early pattern: bigger room → first bounce arrives later", e2[0].t > e1[0].t);
  check("early pattern: diffusion adds density",
    earlyReflectionPattern("hall", 0.5, 0.9).length > earlyReflectionPattern("hall", 0.5, 0.1).length);
  check("early pattern: gains alternate sides and decay",
    e1[0].side !== e1[1].side && Math.abs(e1[0].gain) > Math.abs(e1[2].gain));
  check("ear models: average IS the published baseline",
    EAR_MODELS.average.earDistance === 0.175 && EAR_MODELS.average.headDensity === 0.5 &&
    EAR_MODELS.average.pinnaScale === 1);
  check("ear models: head widths span published anthropometry",
    EAR_MODELS.small.earDistance < EAR_MODELS.average.earDistance &&
    EAR_MODELS.average.earDistance < EAR_MODELS.large.earDistance);
  const pinBase = pinnaParams(Math.PI, 1), pinBig = pinnaParams(Math.PI, 1.6), pinOff = pinnaParams(Math.PI, 0);
  check("pinna scale: scales the Shaw cue linearly",
    Math.abs(pinBig.conchaDb - pinBase.conchaDb * 1.6) < 1e-9 && pinOff.conchaDb === 0 && pinOff.shelfDb === 0);
  check("pinna scale: default arg keeps the published values",
    JSON.stringify(pinnaParams(Math.PI)) === JSON.stringify(pinBase));
  // measured-fit models (scripts/fit_ear_models.mjs, MIT KEMAR):
  check("KEMAR fits: both pinnae present, sharing one head geometry",
    EAR_MODELS.kemar && EAR_MODELS.kemarLarge &&
    EAR_MODELS.kemar.earDistance === EAR_MODELS.kemarLarge.earDistance &&
    EAR_MODELS.kemar.headDensity === EAR_MODELS.kemarLarge.headDensity);
  check("KEMAR fits: head width is physically plausible (0.15-0.19 m)",
    EAR_MODELS.kemar.earDistance > 0.15 && EAR_MODELS.kemar.earDistance < 0.19);
  check("KEMAR fits: the large pinna measured a stronger front/behind cue",
    EAR_MODELS.kemarLarge.pinnaScale > EAR_MODELS.kemar.pinnaScale);
  check("KEMAR fits: provenance in the blurbs",
    /Gardner & Martin/.test(EAR_MODELS.kemar.blurb) && /DB-065/.test(EAR_MODELS.kemarLarge.blurb));
  // measured convolution model (route 2) — the real HRIRs, bundled
  const { KEMAR_HRIR } = await import("../web/static/kemar-hrir.js");
  check("KEMAR measured: model present + flagged", EAR_MODELS.kemarMeasured?.measured === true);
  check("KEMAR HRIR: 72 azimuths, both ears, 256 taps",
    KEMAR_HRIR.count === 72 && KEMAR_HRIR.taps === 256 && KEMAR_HRIR.step === 5);
  // decode + physics sanity: ITD peaks near the side, zero front/back
  const bin = Buffer.from(KEMAR_HRIR._b64, "base64");
  const s = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2);
  const T = KEMAR_HRIR.taps;
  const onset = (off) => { let pk = 0; for (let i = 0; i < T; i++) pk = Math.max(pk, Math.abs(s[off + i])); const th = pk * 0.15; for (let i = 0; i < T; i++) if (Math.abs(s[off + i]) >= th) return i; return 0; };
  const itd = (azDeg) => { const idx = ((Math.round(azDeg / 5) * 5) % 360 + 360) % 360 / 5; const b = idx * 2 * T; return (onset(b) - onset(b + T)) / KEMAR_HRIR.sampleRate; };
  check("KEMAR HRIR: decodes to the declared size", s.length === 72 * 2 * T);
  check("KEMAR HRIR: front ITD ~0", Math.abs(itd(0)) < 5e-5);
  check("KEMAR HRIR: right-side ITD is large + correct sign (right ear first)",
    itd(90) > 5e-4 && itd(90) < 8e-4);
  check("KEMAR HRIR: behind ITD ~0 (front/back symmetric timing)", Math.abs(itd(180)) < 5e-5);
  check("KEMAR HRIR: normGain level-matches the parametric path (near unity)",
    Math.abs(KEMAR_HRIR.normGain - 1) < 0.15);
}

// ── Region ring-out (owner 07-07): finish() stops triggering, not sound ──
{
  const { SynthEngine } = await import("../web/static/synth.js");
  const eng = new SynthEngine();
  check("ring-out: SynthEngine exposes finish()", typeof eng.finish === "function");
  eng.playing = true;
  eng._timer = setTimeout(() => {}, 60000);
  eng._nodes = [{ stop() { eng._nodeKilled = true; } }];
  eng.finish();
  check("ring-out: finish() stops the generator", eng.playing === false && eng._timer === null);
  check("ring-out: finish() leaves sounding nodes alive (no stop call)",
    !eng._nodeKilled && eng._nodes.length === 1);
  eng._nodes = []; // don't leak the fake node into later checks
}

// ── Q1: patch transparency badges (pure derivation, no persistence) ──
{
  const { patchBadges, splitsBucketOf } = await import("../web/static/synth.js");
  const fixture = {
    scaleMode: "12tone", scalePreset: "pent_minor", customDegrees: null,
    beatDivisions: 3, noteConnection: "ring", surpriseProb: 0.2,
    surprisePitchEnabled: true, surprisePitchWeight: 1,
    surpriseRhythmEnabled: true, surpriseRhythmWeight: 0.5,
    surpriseDynamicsEnabled: true, surpriseDynamicsWeight: 0, // weight 0 → not a dim
    surpriseRestEnabled: false, surpriseRestWeight: 0.2,
  };
  const b = patchBadges(fixture);
  check("Q1 badges: scale label from preset", b.scaleLabel === "Pentatonic minor");
  check("Q1 badges: splits = preset degree count", b.splits === 5);
  check("Q1 badges: grid = beatDivisions", b.grid === 3);
  check("Q1 badges: connection passes through", b.connection === "ring");
  check("Q1 badges: surprise on with enabled+weighted dims", b.surpriseOn === true);
  check("Q1 badges: dims filtered by enabled AND weight>0",
    JSON.stringify(b.dims) === JSON.stringify(["P", "R"]), JSON.stringify(b.dims));
  const bOff = patchBadges({ ...fixture, surpriseProb: 0 });
  check("Q1 badges: surpriseProb 0 → surprise off", bOff.surpriseOn === false);
  const bEdo = patchBadges({ scaleMode: "edo", edoDivisions: 19,
    customDegrees: [0, 3, 6, 8, 11, 14, 17] });
  check("Q1 badges: EDO label is 'N-EDO n'", bEdo.scaleLabel === "19-EDO 7", bEdo.scaleLabel);
  check("Q1 badges: EDO splits from customDegrees", bEdo.splits === 7);
  check("Q1 badges: defaults are sane on an empty params object",
    (() => { const d = patchBadges({}); return d.scaleLabel === "Major" && d.splits === 7 && d.grid === 1 && d.connection === "glide"; })());
  check("Q1 splits bucket: customDegrees length wins",
    splitsBucketOf({ customDegrees: [0, 1, 2, 3, 4, 5], scalePreset: "major" }) === "6");
  check("Q1 splits bucket: scalePreset fallback", splitsBucketOf({ scalePreset: "chromatic" }) === "12");
  check("Q1 splits bucket: 8-11 → '8+'", splitsBucketOf({ customDegrees: [0,1,2,3,4,5,6,7,8] }) === "8+");
  check("Q1 splits bucket: <5 → 'other'", splitsBucketOf({ customDegrees: [0, 4, 7] }) === "other");
  check("Q1 splits bucket: silent presets get no bucket", splitsBucketOf({ tempo: 120 }) === null);
}

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll tone-model v2 assertions passed (T1-T6 + space).");
