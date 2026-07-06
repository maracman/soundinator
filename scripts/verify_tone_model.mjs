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
  // Clarinet's odd-dominant parity must survive into the extrapolated tail
  const oddTail = [cl[40], cl[42], cl[44]].map(p => p.amp);
  const evenTail = [cl[41], cl[43], cl[45]].map(p => p.amp);
  check("clarinet parity survives past partial 40",
    oddTail.every((o, i) => o > evenTail[i]),
    `odd ${oddTail.join(",")} vs even ${evenTail.join(",")}`);
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

if (failures) { console.error(`\n${failures} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll tone-model v2 (T1) assertions passed.");
