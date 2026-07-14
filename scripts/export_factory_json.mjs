// Dump a curated slice of the factory library to plain JSON so the Python
// community seeder (scripts/seed_community_dev.py) never has to parse JS.
// Run with:
//   node scripts/export_factory_json.mjs
// Writes tests/fixtures/community_seed/items.json (committed; regenerate when
// the factory catalog changes).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FACTORY_PRESETS } from "../web/static/factory-presets.js";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "community_seed");
fs.mkdirSync(outDir, { recursive: true });

// A deterministic spread of modules across every section, plus full patches.
const PER_SECTION = { sound: 8, melody: 5, rhythm: 4, dynamics: 3, surprise: 3, percussion: 4, space: 3 };
const modules = [];
for (const [section, count] of Object.entries(PER_SECTION)) {
  modules.push(...FACTORY_PRESETS.filter(p => p.section === section).slice(0, count));
}
const patches = FACTORY_PRESETS.filter(p => p.section === "full").slice(0, 8);

const itemOf = (p) => ({
  kind: p.section === "full" ? "patch" : "module",
  name: p.name,
  section: p.section,
  description: (p.description || "").slice(0, 140),
  tags: (p.tags || []).slice(0, 6),
  source_id: `seed:${p.id}`,
  data: { parameters: p.parameters, section: p.section },
});

// Three short seed compositions: two or three factory patches per piece laid
// on a small timeline. Kept well under the 5-minute profile cap.
const seededRandomIds = [701101, 701102, 701103, 701104, 701105, 701106];
function arrangementOf(name, description, patchDefs, tempo, lengthBeats) {
  const palette = patchDefs.map((p, i) => ({
    id: `seedpal-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${i}`,
    name: p.name,
    params: p.parameters,
    captureParts: { notes: true, stave: true, space: true, clef: true, percussion: p.section === "percussion" },
  }));
  const tracks = palette.map((pl, i) => ({
    id: `seedtrack-${i}`,
    name: pl.name,
    gain: 0.8,
    pan: 0,
    muted: false,
    regions: [{
      id: `seedregion-${i}`,
      paletteId: pl.id,
      startBeat: i * 8,
      lengthBeats: Math.max(16, lengthBeats - i * 8),
      seed: seededRandomIds[i % seededRandomIds.length],
    }],
  }));
  return {
    kind: "composition",
    name,
    section: "",
    description,
    tags: ["seed", "demo"],
    source_id: `seed:arrangement:${name}`,
    data: {
      format: "phase0-arrangement-1.0",
      name,
      lengthBeats,
      palette,
      tracks,
      context: { tempo, scaleMode: "12tone", scalePreset: "major", rootNotes: [0] },
    },
  };
}

const fullPatches = FACTORY_PRESETS.filter(p => p.section === "full");
const compositions = [
  arrangementOf("Dawn Sketch", "Two patches trading phrases at sunrise pace.",
    fullPatches.slice(0, 2), 84, 48),
  arrangementOf("Corridor Steps", "A walking bass under glass percussion.",
    fullPatches.slice(2, 5), 104, 64),
  arrangementOf("Slow Signal", "One patient patch, left to breathe.",
    fullPatches.slice(5, 6), 66, 32),
];

const items = [...modules.map(itemOf), ...patches.map(itemOf), ...compositions];
const outPath = path.join(outDir, "items.json");
fs.writeFileSync(outPath, JSON.stringify(items, null, 2));
console.log(`Wrote ${items.length} seed items (${modules.length} modules, ${patches.length} patches, ${compositions.length} compositions)`);
console.log(`  → ${outPath}`);
