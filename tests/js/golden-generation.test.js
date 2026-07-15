import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GenerationEngine } from "../../web/static/synth.js";
import { DEFAULTS, migrateParamsShape } from "../../web/static/params.js";

const projection = note => ({
  degree: note.degree,
  frequency: note.frequency,
  durationDivs: note.durationDivs,
  offsetDivs: note.offsetDivs ?? null,
  velocity: note.velocity,
  beatDivisions: note.beatDivisions,
  isRest: note.isRest,
  isSurprise: note.isSurprise,
});

test("64-note generation golden is stable in both shapes", async () => {
  const expected = JSON.parse(await readFile(new URL("./fixtures/gen-default.json", import.meta.url)));
  for (const params of [{ ...DEFAULTS, seed: 12345 }, migrateParamsShape({ ...DEFAULTS, seed: 12345 })]) {
    const engine = new GenerationEngine(params);
    engine.initialise();
    assert.deepEqual(Array.from({ length: 64 }, () => projection(engine.nextNote())), expected);
  }
});
