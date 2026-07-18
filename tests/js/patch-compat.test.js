// Patch compatibility invariant (owner ask 2026-07-18): every shipped patch
// must generate the IDENTICAL note stream whether the engine is fed
//   (a) the legacy flat params,
//   (b) the migrated unified shape (serializeParams(migrateParamsShape(p))),
//   (c) a serialize→reload round trip of (b),
//   (d) the "old reader" view of (b) — flat mirror + layers[].subnote only.
// This caught a real bug: migrateToneParams skipped layers[n].sound, so
// engineParams hoisted an UNMIGRATED sound over the migrated top level and
// saved formant-era patches regressed to the retired formant voice on reload.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { GenerationEngine, migrateToneParams } from "../../web/static/synth.js";
import { DEFAULTS, migrateParamsShape, serializeParams } from "../../web/static/params.js";
import { FACTORY_PRESETS } from "../../web/static/factory-presets.js";
import { FACTORY_SESSIONS } from "../../web/static/factory-sessions.js";

const SEEDS = [12345, 99991];
const NOTES = 48;

const project = note => note && [
  note.degree, note.frequency, note.durationDivs, note.offsetDivs ?? null,
  note.velocity, note.beatDivisions, note.isRest ? 1 : 0, note.isSurprise ? 1 : 0,
  note.formantPos?.x ?? null, note.formantPos?.y ?? null,
];

function digest(patchParams, seed) {
  const engine = new GenerationEngine(migrateToneParams({ ...DEFAULTS, ...patchParams, seed }));
  engine.initialise();
  return createHash("sha256")
    .update(JSON.stringify(Array.from({ length: NOTES }, () => project(engine.nextNote()))))
    .digest("hex");
}

// What a pre-unification client reads back from a new-shape save: the flat
// mirror, with extra layers reduced to legacy subnote entries.
function oldReaderView(serialized) {
  const flat = { ...serialized };
  const extras = (serialized.layers || []).slice(1)
    .map(({ sound, ...rest }) => ({ ...rest, subnote: { ...(sound || rest.subnote || {}) } }));
  if (extras.length) flat.layers = extras; else delete flat.layers;
  delete flat.selectedLayerId;
  return flat;
}

const corpus = JSON.parse(await readFile(new URL("./fixtures/community-corpus.json", import.meta.url)));
const suite = [
  ...FACTORY_PRESETS.map(f => ({ name: `factory:${f.id}`, p: f.parameters })),
  ...FACTORY_SESSIONS.flatMap((s, si) => (s.palette || []).map((pl, pi) =>
    ({ name: `session:${s.id ?? si}/${pl.name ?? pi}`, p: pl.params }))),
  ...corpus.map((entry, i) =>
    ({ name: `corpus:${entry.name ?? entry.id ?? i}`, p: entry.parameters ?? entry.params ?? entry })),
].filter(({ p }) => p && typeof p === "object");

test(`every shipped patch (${suite.length}) generates identically in all shapes`, () => {
  const failures = [];
  for (const { name, p } of suite) {
    const serialized = serializeParams(migrateParamsShape({ ...DEFAULTS, ...p }));
    const roundTrip = serializeParams(migrateParamsShape({ ...serialized }));
    for (const seed of SEEDS) {
      const flat = digest(p, seed);
      for (const [variant, input] of [
        ["migrated", serialized], ["roundTrip", roundTrip], ["oldReader", oldReaderView(serialized)],
      ]) {
        if (digest(input, seed) !== flat) failures.push(`${name} seed=${seed} ${variant}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
