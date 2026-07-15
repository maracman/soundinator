import { mkdir, writeFile } from "node:fs/promises";
import { GenerationEngine } from "../../web/static/synth.js";
import { DEFAULTS } from "../../web/static/params.js";

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
const engine = new GenerationEngine({ ...DEFAULTS, seed: 12345 });
engine.initialise();
const notes = Array.from({ length: 64 }, () => projection(engine.nextNote()));
const dir = new URL("./fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("gen-default.json", dir), `${JSON.stringify(notes, null, 2)}\n`);
