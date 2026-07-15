import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { FACTORY_PRESETS } from "../../web/static/factory-presets.js";
import { FACTORY_SESSIONS } from "../../web/static/factory-sessions.js";
import { migrateToneParams } from "../../web/static/synth.js";
import { migrateParamsShape, serializeParams } from "../../web/static/params.js";

const corpus = JSON.parse(await readFile(new URL("./fixtures/community-corpus.json", import.meta.url)));

test("tone migration is idempotent across factory and community data", () => {
  const params = [...FACTORY_PRESETS.map(entry => entry.parameters), ...corpus];
  assert.ok(params.length >= 20);
  for (const value of params) {
    const once = migrateToneParams(structuredClone(value));
    const twice = migrateToneParams(structuredClone(once));
    assert.deepEqual(twice, once);
  }
  assert.ok(FACTORY_SESSIONS.every(session => session.tracks.every(track => track.patchId)));
});

test("old -> new -> serialize -> reload converges for the corpus", () => {
  for (const value of corpus) {
    const once = migrateParamsShape(migrateToneParams(structuredClone(value)));
    const twice = migrateParamsShape(serializeParams(once));
    assert.deepEqual(serializeParams(twice), serializeParams(once));
  }
});
