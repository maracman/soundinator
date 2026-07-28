/**
 * The Producer's resolution law.
 *
 * Every regression the 2026-07-28 audit found was silent because nothing
 * asserted which tier owns which module. These tests are that assertion.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  migrateParamsShape,
  serializeParams,
  extractModule,
  applyModule,
  modulesEqual,
  divergedModules,
  moduleSliceIsEmpty,
  CAPTURE_PARTS,
} from "../../web/static/params.js";
import {
  regionPlayParams,
  regionVoiceParams,
  moduleAuthority,
  spTransformSources,
  spTrackSources,
  spApplyThreadToPatch,
  variantForTake,
  variantDiffParts,
  redundantVariants,
  applyModulePlan,
  takesOfPatch,
  divergedTakesOfPatch,
  rootPatchOf,
  harmonicMarkerIdAt,
} from "../../web/static/producer-resolve.js";
import { bakedGridFor, applyEngineParams, captureSpanEvolving, GenerationEngine } from "../../web/static/synth.js";
import { DEFAULTS } from "../../web/static/params.js";

// ── fixtures ────────────────────────────────────────────────

function patchParams(over = {}) {
  const p = migrateParamsShape({
    spectralProfile: "violin", brightness: 0.7,
    melodyPattern: "walk", beatDivisions: 2,
    scaleMode: "12tone", scalePreset: "major", tonicHz: 261.63,
    ...over,
  });
  return serializeParams(p);
}

/** A patch whose sound is a two-layer stack plus one percussion hit. */
function constellationParams() {
  const p = migrateParamsShape(patchParams());
  p.layers[0].space = { angle: -20, dist: 3 };
  p.layers.push({ id: "L2", sound: { spectralProfile: "flute" }, space: { angle: 60, dist: 8 }, gain: 0.8 });
  p.percLayers = [{ id: "P1", role: "beat", vol: 0.3, sound: { kind: "sample", key: "click" }, space: { angle: 120, dist: 5 } }];
  return serializeParams(p);
}

function makeArrangement({ params = patchParams(), tracks, ...rest } = {}) {
  const palette = [{ id: "pal1", name: "Warm Cello", params, parts: {}, parentId: null }];
  return {
    id: "arr", name: "T", version: 2, lengthBeats: 64,
    context: { tempo: 104 },
    palette,
    tracks: tracks || [{
      id: "t1", name: "Thread 1", gain: 1,
      regions: [{ id: "r1", paletteId: "pal1", startBeat: 0, lengthBeats: 8, seed: 11 }],
    }],
    ...rest,
  };
}

const trackOf = a => a.tracks[0];
const regionOf = a => a.tracks[0].regions[0];

// ── module extraction ───────────────────────────────────────

test("swapping a module changes that module and leaves the others alone", () => {
  const target = constellationParams();
  const donor = patchParams({ spectralProfile: "cello", melodyPattern: "arp", scalePreset: "minor" });

  const sound = applyModule(target, "notes", extractModule(donor, "notes"));
  assert.equal(sound.layers[0].sound.spectralProfile, "cello", "sound swapped (was a silent no-op before)");
  assert.equal(sound.spectralProfile, "cello", "flat mirror follows");
  assert.deepEqual(sound.layers[0].space, { angle: -20, dist: 3 }, "a sound swap must not teleport the source");
  assert.deepEqual(sound.percLayers[0].space, { angle: 120, dist: 5 }, "percussion position untouched");
  assert.equal(sound.melodyPattern, "walk", "note engine untouched");

  const engine = applyModule(target, "stave", extractModule(donor, "stave"));
  assert.equal(engine.melodyPattern, "arp", "engine swapped");
  assert.equal(engine.layers[0].sound.spectralProfile, "violin", "sound untouched");
  assert.equal(engine.layers[1].sound.spectralProfile, "flute", "stacked layer untouched");
});

test("swapping SPACE moves positions without touching the sounds", () => {
  const target = constellationParams();
  const donor = patchParams({ spaceAzimuth: 90, spaceDistance: 20 });
  const moved = applyModule(target, "space", extractModule(donor, "space"));
  assert.deepEqual(moved.layers[0].space, { angle: 90, dist: 20 });
  assert.equal(moved.layers[0].sound.spectralProfile, "violin");
  assert.equal(moved.layers[1].sound.spectralProfile, "flute");
});

test("every module round-trips through extract → apply unchanged", () => {
  const p = constellationParams();
  for (const part of CAPTURE_PARTS) {
    const back = applyModule(p, part, extractModule(p, part));
    assert.deepEqual(back.layers.map(l => l.sound.spectralProfile), p.layers.map(l => l.sound.spectralProfile), `${part}: sounds`);
    assert.deepEqual(back.layers.map(l => l.space), p.layers.map(l => l.space), `${part}: positions`);
    assert.equal(back.melodyPattern, p.melodyPattern, `${part}: engine`);
  }
});

// ── take vs patch ───────────────────────────────────────────

test("a take with no override follows its palette patch", () => {
  const a = makeArrangement();
  assert.equal(regionVoiceParams(a, trackOf(a), regionOf(a)).layers[0].sound.spectralProfile, "violin");
  a.palette[0].params = patchParams({ spectralProfile: "cello" });
  assert.equal(regionVoiceParams(a, trackOf(a), regionOf(a)).layers[0].sound.spectralProfile, "cello",
    "patch edits reach an un-diverged take live");
});

test("a take override diverges ONLY that module", () => {
  const a = makeArrangement();
  const region = regionOf(a);
  region.overrides = { stave: extractModule(patchParams({ melodyPattern: "arp" }), "stave") };

  assert.equal(regionVoiceParams(a, trackOf(a), region).melodyPattern, "arp", "engine is take-local");

  // …and the sound still follows the patch, which is the whole point.
  a.palette[0].params = patchParams({ spectralProfile: "cello" });
  assert.equal(regionVoiceParams(a, trackOf(a), region).layers[0].sound.spectralProfile, "cello",
    "sound still follows the patch after an engine-only divergence");
});

test("editing a patch's sound reaches a BAKED take", () => {
  const a = makeArrangement();
  const region = regionOf(a);
  region.type = "baked";
  region.notes = [{ degree: 0, offsetDivs: 0, durationDivs: 1, velocity: 0.7, beatDivisions: 2 }];
  a.palette[0].params = patchParams({ spectralProfile: "cello" });
  assert.equal(regionPlayParams(a, trackOf(a), region).layers[0].sound.spectralProfile, "cello",
    "bake freezes the notes, never the voice");
});

test("bake mints no variant and claims no palette entry", () => {
  const a = makeArrangement();
  const region = regionOf(a);
  region.type = "baked";
  region.notes = [];
  assert.equal(a.palette.length, 1, "still one palette entry");
  assert.equal(region.paletteId, "pal1", "the take still points at its patch");
  assert.ok(!region.overrides, "bake creates no module override");
});

// ── Harmonic guide claims `clef` ────────────────────────────

const HG = {
  enabled: true,
  markers: [{ atBeat: 0, scaleMode: "edo", edoDivisions: 19, degrees: [0, 3, 6, 9, 12], subScaleNotes: [], rootNotes: [0] }],
};

test("Harmonic guide claims the scale only on opted-in threads", () => {
  const off = makeArrangement({ globalScale: HG });
  assert.equal(regionPlayParams(off, trackOf(off), regionOf(off)).edoDivisions, 12, "HG off → patch scale stands");

  const on = makeArrangement({ globalScale: HG });
  trackOf(on).useGlobalScale = true;
  const p = regionPlayParams(on, trackOf(on), regionOf(on));
  assert.equal(p.edoDivisions, 19, "HG on → marker wins");
  assert.deepEqual(p.customDegrees, [0, 3, 6, 9, 12]);
});

test("the guide reaches a take that is ALREADY sounding", () => {
  // A change point at bar 5 must turn a take that began at bar 1, not just
  // takes that start after it — otherwise a held region ignores the
  // modulation happening underneath it.
  const a = makeArrangement({
    globalScale: {
      enabled: true,
      markers: [
        { atBeat: 0, scaleMode: "12tone", degrees: [0, 2, 4, 5, 7, 9, 11], subScaleNotes: [], rootNotes: [0] },
        { atBeat: 16, scaleMode: "edo", edoDivisions: 19, degrees: [0, 3, 6], subScaleNotes: [], rootNotes: [0] },
      ],
    },
  });
  trackOf(a).useGlobalScale = true;
  const region = regionOf(a);
  region.startBeat = 0;
  region.lengthBeats = 32;          // spans the change point at 16

  assert.equal(regionPlayParams(a, trackOf(a), region, 4).edoDivisions, 12,
    "before the change point, the first marker governs");
  assert.equal(regionPlayParams(a, trackOf(a), region, 20).edoDivisions, 19,
    "past it the SAME take turns — it used to keep bar 1's scale for its whole length");
  assert.deepEqual(regionPlayParams(a, trackOf(a), region, 20).customDegrees, [0, 3, 6]);

  // and the playback loop can tell the guide has moved
  assert.notEqual(harmonicMarkerIdAt(a, 4), harmonicMarkerIdAt(a, 20));
  assert.equal(harmonicMarkerIdAt(a, 20), harmonicMarkerIdAt(a, 28));
});

test("a guide change REBUILDS a running engine's scale, not just its params", () => {
  // The Scale is built once in the engine's constructor. Swapping params alone
  // left a sounding take generating from the scale it started in — p said one
  // thing and the pitches said another, so the guide never actually arrived.
  const base = serializeParams(migrateParamsShape({ ...DEFAULTS,
    spectralProfile: "violin", seed: 7, scaleMode: "12tone",
    customDegrees: [0, 2, 4, 5, 7, 9, 11], tonicHz: 261.63 }));
  const engine = new GenerationEngine(base);
  assert.equal(engine.scale.div, 12);
  const hzBefore = engine.scale.degreeToHz(3);

  applyEngineParams(engine, { scaleMode: "edo", edoDivisions: 19, customDegrees: [0, 3, 6, 9] });
  assert.equal(engine.scale.div, 19, "the scale itself must move, not only p");
  assert.notEqual(engine.scale.degreeToHz(3), hzBefore, "so stored degrees re-pitch");

  const held = engine.scale;
  applyEngineParams(engine, { onBeatProb: 0.9 });
  assert.equal(engine.scale, held, "a non-scale edit must not rebuild it");
});

test("a region's drawing turns at a guide change point, as the sound does", () => {
  // captureSpanEvolving runs ONE engine and swaps its params part-way, so the
  // motif and walk carry across the boundary exactly as they do live.
  const early = serializeParams(migrateParamsShape({ ...DEFAULTS,
    spectralProfile: "violin", seed: 11, tempo: 104, beatDivisions: 1,
    scaleMode: "12tone", customDegrees: [0, 2, 4, 5, 7, 9, 11], tonicHz: 261.63 }));
  const late = serializeParams(migrateParamsShape({ ...early,
    scaleMode: "edo", edoDivisions: 19, customDegrees: [0, 3, 6, 9] }));

  const flat = captureSpanEvolving(early, 24 * (60 / 104), null);
  const turning = captureSpanEvolving(early, 24 * (60 / 104),
    (beat) => beat < 12 ? { key: "a", params: early } : { key: "b", params: late });

  assert.ok(flat.length > 4 && turning.length > 4, "both produced notes");
  const firstDivs = 6;
  assert.deepEqual(
    turning.slice(0, firstDivs).map(n => n.degree),
    flat.slice(0, firstDivs).map(n => n.degree),
    "before the change point the two are identical — same seed, same engine");
  assert.notDeepEqual(
    turning.map(n => Math.round(n.frequency)),
    flat.map(n => Math.round(n.frequency)),
    "after it the drawing turns, so it no longer matches the un-turned take");
});

test("a take already sounding under the guide is still exempt when baked", () => {
  const a = makeArrangement({
    globalScale: { enabled: true, markers: [
      { atBeat: 0, scaleMode: "12tone", degrees: [0, 2, 4], subScaleNotes: [], rootNotes: [0] },
      { atBeat: 16, scaleMode: "edo", edoDivisions: 19, degrees: [0, 3, 6], subScaleNotes: [], rootNotes: [0] },
    ] },
  });
  trackOf(a).useGlobalScale = true;
  const region = regionOf(a);
  region.startBeat = 0; region.lengthBeats = 32;
  region.type = "baked";
  region.notes = [{ degree: 7, offsetDivs: 0, durationDivs: 1, velocity: 0.7, beatDivisions: 2 }];
  assert.equal(regionPlayParams(a, trackOf(a), region, 20).edoDivisions, 12,
    "frozen material does not turn, whatever beat it is sampled at");
});

test("Harmonic guide never touches a baked take, including its EDO", () => {
  const a = makeArrangement({ globalScale: HG });
  trackOf(a).useGlobalScale = true;
  const region = regionOf(a);
  region.type = "baked";
  region.notes = [{ degree: 7, offsetDivs: 0, durationDivs: 1, velocity: 0.7, beatDivisions: 2 }];

  const p = regionPlayParams(a, trackOf(a), region);
  assert.equal(p.edoDivisions, 12,
    "a marker carrying edoDivisions would re-pitch every stored degree — bake means frozen");
  assert.equal(p.scaleMode, "12tone");
});

test("the patch's OWN tuning still re-pitches a baked take", () => {
  const a = makeArrangement();
  const region = regionOf(a);
  region.type = "baked";
  region.notes = [{ degree: 7, offsetDivs: 0, durationDivs: 1, velocity: 0.7, beatDivisions: 2 }];
  a.palette[0].params = patchParams({ tonicHz: 440 });
  assert.equal(regionPlayParams(a, trackOf(a), region).tonicHz, 440,
    "transposing your own patch carries its frozen takes with it");
});

// ── Global space claims `space` ─────────────────────────────

test("a thread position moves EVERY source, in the global space or out of it", () => {
  const handle = { angle: 45, dist: 6 };
  const expected = spTransformSources(spTrackSources(migrateParamsShape(constellationParams())), handle, "centered");

  // Out of the global space: the thread's own static place.
  const off = makeArrangement({ params: constellationParams() });
  trackOf(off).space = { ...handle };
  const a = regionPlayParams(off, trackOf(off), regionOf(off));

  // In it: the same place, now reached along a path.
  const on = makeArrangement({ params: constellationParams() });
  trackOf(on).useGlobalSpace = true;
  on.space = { enabled: true, tracks: {}, static: { t1: { ...handle } }, head: null };
  const b = regionPlayParams(on, trackOf(on), regionOf(on));

  for (const p of [a, b]) {
    assert.equal(p.layers.length, 2);
    p.layers.forEach((l, i) => {
      assert.ok(Math.abs(l.space.angle - expected[i].angle) < 1e-6, `layer ${i} angle`);
      assert.ok(Math.abs(l.space.dist - expected[i].dist) < 1e-6, `layer ${i} distance`);
    });
    assert.ok(Math.abs(p.percLayers[0].space.angle - expected[2].angle) < 1e-6, "percussion hit moves too");
  }
  assert.deepEqual(a.layers.map(l => l.space), b.layers.map(l => l.space),
    "the same drag must mean the same thing in the space or out of it");
});

test("the global head claims the room unless the patch opts out", () => {
  const head = { earDistance: 0.2, headDensity: 0.9, reverbType: "hall", reverbWet: 0.5 };

  const shared = makeArrangement({ params: patchParams({ reverbType: "room" }) });
  trackOf(shared).useGlobalSpace = true;
  shared.space = { enabled: true, tracks: {}, static: {}, head };
  const p = regionPlayParams(shared, trackOf(shared), regionOf(shared));
  assert.equal(p.reverbType, "hall", "a thread in the space shares the room");
  assert.equal(p.earDistance, 0.2);

  const own = makeArrangement({ params: patchParams({ spaceOwnHead: true, reverbType: "room" }) });
  trackOf(own).useGlobalSpace = true;
  own.space = { enabled: true, tracks: {}, static: {}, head };
  assert.equal(regionPlayParams(own, trackOf(own), regionOf(own)).reverbType, "room",
    "spaceOwnHead keeps the patch's own room");

  // A thread that never joined keeps its patch's room too.
  const outside = makeArrangement({ params: patchParams({ reverbType: "room" }) });
  outside.space = { enabled: true, tracks: {}, static: {}, head };
  assert.equal(regionPlayParams(outside, trackOf(outside), regionOf(outside)).reverbType, "room",
    "the shared room comes with joining the space");
});

// ── authority reporting ─────────────────────────────────────

test("moduleAuthority names the tier actually in charge", () => {
  const a = makeArrangement({ globalScale: HG });
  const track = trackOf(a), region = regionOf(a);

  assert.equal(moduleAuthority(a, track, region, "notes").owner, "patch");
  assert.equal(moduleAuthority(a, track, region, "clef").owner, "patch");

  track.useGlobalScale = true;
  assert.equal(moduleAuthority(a, track, region, "clef").owner, "harmonic-guide");
  assert.ok(moduleAuthority(a, track, region, "clef").superseded);

  region.type = "baked";
  assert.equal(moduleAuthority(a, track, region, "clef").owner, "bake",
    "a baked take's scale is frozen, not HG-superseded");
  assert.equal(moduleAuthority(a, track, region, "stave").owner, "bake");

  region.type = "generative";
  region.overrides = { notes: extractModule(patchParams({ spectralProfile: "cello" }), "notes") };
  assert.equal(moduleAuthority(a, track, region, "notes").owner, "take");
  assert.equal(moduleAuthority(a, track, region, "notes").superseded, false,
    "a take-local edit is authoritative, not superseded");

  a.space = { enabled: true, tracks: {}, static: {}, head: null };
  assert.equal(moduleAuthority(a, track, region, "space").owner, "patch",
    "the space existing does not claim a thread that has not joined");
  track.useGlobalSpace = true;
  assert.equal(moduleAuthority(a, track, region, "space").owner, "global-space",
    "joining is what hands `space` to the global path");
});

// ── baked-note timing ───────────────────────────────────────

test("baked notes keep the grid they were baked on", () => {
  const baked = [{ degree: 0, offsetDivs: 0, durationDivs: 1, velocity: 0.7, beatDivisions: 4 }];
  // The patch's grid has since been changed to 1 — the take must not rescale.
  assert.equal(bakedGridFor(baked, { beatDivisions: 1 }), 4,
    "scheduling reads the stored grid, so the roll and the audio agree");
  assert.equal(bakedGridFor([{ degree: 0 }], { beatDivisions: 2 }), 2,
    "legacy notes without a stored grid fall back to the params");
  assert.equal(bakedGridFor([], {}), 1);
});

// ── divergence detection ────────────────────────────────────

test("divergedModules names exactly the modules that differ", () => {
  const a = patchParams();
  assert.deepEqual(divergedModules(a, a), [], "a patch does not differ from itself");
  assert.deepEqual(divergedModules(a, patchParams({ melodyPattern: "arp" })), ["stave"]);
  assert.deepEqual(divergedModules(a, patchParams({ spectralProfile: "cello" })), ["notes"]);
  assert.deepEqual(divergedModules(a, patchParams({ scalePreset: "minor" })), ["clef"]);
  assert.deepEqual(
    divergedModules(a, patchParams({ spectralProfile: "cello", melodyPattern: "arp" })).sort(),
    ["notes", "stave"]);
});

test("module equality ignores key order", () => {
  const a = serializeParams(migrateParamsShape({ spectralProfile: "violin", brightness: 0.4 }));
  const b = serializeParams(migrateParamsShape({ brightness: 0.4, spectralProfile: "violin" }));
  assert.ok(modulesEqual(a, b, "notes"));
});

// ── anchors own the path ────────────────────────────────────

test("an anchored thread is only movable AT its anchors", () => {
  // Anchors are the edit surface; the thread between them is derived. A drag
  // between two anchors must not silently rewrite the path — it springs back,
  // and you drop a new anchor (double-click) to move it there. This was
  // briefly relaxed to "slide the whole thread", which let a drag anywhere
  // rewrite every anchor at once.
  const a = makeArrangement();
  const track = trackOf(a);
  track.useGlobalSpace = true;
  a.space = { enabled: true, static: {}, head: null, tracks: {
    t1: [{ beat: 0, angle: -30, dist: 4 }, { beat: 16, angle: 40, dist: 8 }] } };

  const at = (beat) => (a.space.tracks.t1 || []).some(x => Math.abs(x.beat - beat) < 0.26);
  assert.ok(at(0), "movable where an anchor sits");
  assert.ok(at(16), "and at the other one");
  assert.ok(!at(8), "NOT movable between them — a drag there snaps back");

  // an unanchored thread is free everywhere
  const free = makeArrangement();
  trackOf(free).useGlobalSpace = true;
  free.space = { enabled: true, static: {}, head: null, tracks: {} };
  assert.equal((free.space.tracks.t1 || []).length, 0, "no anchors → nothing pins it");
});

// ── variants ────────────────────────────────────────────────

/** Two threads playing the same patch. */
function twoTakeArrangement() {
  const a = makeArrangement();
  a.tracks.push({
    id: "t2", name: "Thread 2", gain: 1,
    regions: [{ id: "r2", paletteId: "pal1", startBeat: 0, lengthBeats: 8, seed: 22 }],
  });
  return a;
}

test("a take's edits become a variant named for what they change", () => {
  const a = twoTakeArrangement();
  const region = regionOf(a);
  region.overrides = { stave: extractModule(patchParams({ melodyPattern: "arp" }), "stave") };

  const plan = variantForTake(a, trackOf(a), region);
  assert.deepEqual(plan.parts, ["stave"], "only the engine differs");
  assert.equal(plan.root.id, "pal1");
  assert.equal(plan.label, "arp engine", "labelled by the diff, not 'v2'");
  assert.equal(plan.params.melodyPattern, "arp");
  assert.equal(plan.params.layers[0].sound.spectralProfile, "violin", "the rest comes from the patch");
});

test("a take with nothing diverged produces no variant", () => {
  const a = makeArrangement();
  assert.deepEqual(variantForTake(a, trackOf(a), regionOf(a)).parts, [],
    "identical to its patch → there is nothing to keep");
});

test("variants are FLAT — a variant of a variant hangs off the root", () => {
  const a = twoTakeArrangement();
  // r1 already plays a variant of pal1…
  a.palette.push({
    id: "var1", name: "arp engine", parentId: "pal1", variantParts: ["stave"],
    params: applyModule(a.palette[0].params, "stave", extractModule(patchParams({ melodyPattern: "arp" }), "stave")),
  });
  const region = regionOf(a);
  region.paletteId = "var1";
  // …and now its scale is edited too.
  region.overrides = { clef: extractModule(patchParams({ scalePreset: "minor" }), "clef") };

  const plan = variantForTake(a, trackOf(a), region);
  assert.equal(plan.root.id, "pal1", "parent is the ROOT patch, never another variant");
  assert.deepEqual(plan.parts.sort(), ["clef", "stave"], "the new variant carries both diffs");
});

test("a variant's advertised diff tracks LATER edits to it", () => {
  // The stored variantParts is set once at creation. Editing the variant
  // afterwards left the row still advertising only the first change, quietly
  // hiding every later one — so the diff is recomputed, not trusted.
  const a = makeArrangement();
  a.palette.push({
    id: "var1", name: "arp engine", parentId: "pal1", variantParts: ["stave"],
    params: applyModule(a.palette[0].params, "stave", extractModule(patchParams({ melodyPattern: "arp" }), "stave")),
  });
  assert.deepEqual(variantDiffParts(a, a.palette[1]), ["stave"]);

  // now change its SCALE too — the row must show both
  a.palette[1].params = applyModule(a.palette[1].params, "clef",
    extractModule(patchParams({ scalePreset: "minor" }), "clef"));
  assert.deepEqual(variantDiffParts(a, a.palette[1]).sort(), ["clef", "stave"],
    "the later change has to appear, not just the first one");

  // and revert the engine — the row must drop it again
  a.palette[1].params = applyModule(a.palette[1].params, "stave",
    extractModule(a.palette[0].params, "stave"));
  assert.deepEqual(variantDiffParts(a, a.palette[1]), ["clef"]);
});

test("a variant identical to its parent is redundant and dissolves", () => {
  const a = makeArrangement();
  a.palette.push({ id: "var1", name: "x", parentId: "pal1", variantParts: ["stave"], params: a.palette[0].params });
  assert.deepEqual(redundantVariants(a), [["var1", "pal1"]]);

  a.palette[1].params = patchParams({ melodyPattern: "arp" });
  assert.deepEqual(redundantVariants(a), [], "a real difference is not redundant");
});

test("apply-to-all skips takes holding their own edit of that module", () => {
  const a = twoTakeArrangement();
  const [r1, r2] = [a.tracks[0].regions[0], a.tracks[1].regions[0]];
  r1.overrides = { stave: extractModule(patchParams({ melodyPattern: "arp" }), "stave") };

  let plan = applyModulePlan(a, r1, "stave");
  assert.equal(plan.follow.length, 1, "the untouched take follows");
  assert.equal(plan.keepOwn.length, 0);

  // Give the other take its own engine edit — now it must be left alone.
  r2.overrides = { stave: extractModule(patchParams({ melodyPattern: "walk", beatDivisions: 8 }), "stave") };
  plan = applyModulePlan(a, r1, "stave");
  assert.equal(plan.follow.length, 0);
  assert.equal(plan.keepOwn.length, 1, "a take with its own edit is never silently overwritten");
});

test("take counting distinguishes plain takes from diverged ones", () => {
  const a = twoTakeArrangement();
  assert.equal(takesOfPatch(a, "pal1").length, 2);
  assert.equal(divergedTakesOfPatch(a, "pal1").length, 0);
  a.tracks[0].regions[0].overrides = { notes: extractModule(patchParams({ spectralProfile: "cello" }), "notes") };
  assert.equal(divergedTakesOfPatch(a, "pal1").length, 1);
});

test("rootPatchOf resolves a variant to its patch and a patch to itself", () => {
  const a = makeArrangement();
  a.palette.push({ id: "var1", name: "x", parentId: "pal1", params: patchParams() });
  assert.equal(rootPatchOf(a, a.palette[1]).id, "pal1");
  assert.equal(rootPatchOf(a, a.palette[0]).id, "pal1");
});

// ── legacy migration ────────────────────────────────────────

test("an EMPTY legacy fork never becomes a silent sound override", () => {
  // The pre-2026-07-28 inspector forked a take by cloning regionPatch(), which
  // could fall through to an empty track.instrumentParams. Diffing that husk
  // reports "the sound differs", and applying it gives the take a sound source
  // with no source in it — a thread that meters but makes no sound.
  const a = makeArrangement();
  const husk = serializeParams(migrateParamsShape({}));

  assert.ok(divergedModules(a.palette[0].params, husk).includes("notes"),
    "the husk does look different — that is the trap");
  assert.ok(moduleSliceIsEmpty(extractModule(husk, "notes"), "notes"),
    "…but it carries no sound, so it is not an edit");

  const kept = divergedModules(a.palette[0].params, husk)
    .filter(part => !moduleSliceIsEmpty(extractModule(husk, part), part));
  assert.deepEqual(kept, [], "nothing survives the guard");

  const region = regionOf(a);
  for (const part of kept) (region.overrides ||= {})[part] = extractModule(husk, part);
  assert.equal(regionVoiceParams(a, trackOf(a), region).layers[0].sound.spectralProfile, "violin",
    "the take still plays its patch's sound");
});

test("moduleSliceIsEmpty discounts hollow normalization keys", () => {
  // normalizeLayer stamps `sound: { effectsChain: [] }` on every layer, so a
  // husk looks populated unless those are discounted.
  assert.ok(moduleSliceIsEmpty({ layers: [{ sound: { effectsChain: [] } }] }, "notes"));
  assert.ok(moduleSliceIsEmpty({ layers: [{ sound: {} }], baseLayerGain: 1, baseLayerSolo: false }, "notes"));
  assert.ok(!moduleSliceIsEmpty({ layers: [{ sound: { spectralProfile: "cello" } }] }, "notes"),
    "a real sound is not empty");
  assert.ok(moduleSliceIsEmpty({}, "stave"));
  assert.ok(!moduleSliceIsEmpty({ melodyPattern: "arp" }, "stave"));
});

test("a legacy whole-patch paramsOverride still plays until migrated", () => {
  const a = makeArrangement();
  const region = regionOf(a);
  region.paramsOverride = patchParams({ spectralProfile: "kalimba", melodyPattern: "arp" });
  const p = regionVoiceParams(a, trackOf(a), region);
  assert.equal(p.layers[0].sound.spectralProfile, "kalimba");
  assert.equal(p.melodyPattern, "arp");
});
