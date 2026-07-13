// Factory-session release gate. Run with:
//   node scripts/verify_factory_sessions.mjs

import { FACTORY_PRESETS } from "../web/static/factory-presets.js";
import { FACTORY_SESSIONS } from "../web/static/factory-sessions.js";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) { failures++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};

const patches = new Map(FACTORY_PRESETS.filter(p => p.section === "full").map(p => [p.id, p]));
const ids = new Set(), names = new Set();
let hasSevenEdo = false;

console.log("Factory starter sessions");
check("five curated sessions", FACTORY_SESSIONS.length === 5, `${FACTORY_SESSIONS.length}`);
for (const session of FACTORY_SESSIONS) {
  check(`${session.id}: stable id`, /^factory-session-[a-z0-9-]+$/.test(session.id) && !ids.has(session.id));
  ids.add(session.id);
  check(`${session.id}: unique name`, typeof session.name === "string" && !names.has(session.name));
  names.add(session.name);
  check(`${session.id}: theme and description`, session.theme?.length >= 8 && session.description?.length >= 24);
  check(`${session.id}: useful arrangement length`, Number.isInteger(session.lengthBeats) && session.lengthBeats >= 32);
  check(`${session.id}: ensemble`, Array.isArray(session.tracks) && session.tracks.length >= 3);

  const head = session.space?.head;
  check(`${session.id}: global space enabled recipe`, !!head && Number.isFinite(head.facing) && Math.abs(head.facing) > 0);
  check(`${session.id}: Harmonic guide changes`, Array.isArray(session.harmonicGuide?.markers) && session.harmonicGuide.markers.length >= 2);
  const markers = session.harmonicGuide?.markers || [];
  check(`${session.id}: ordered guide markers`, markers.every((m, i) => i === 0 ? m.atBeat === 0 : m.atBeat > markers[i - 1].atBeat));
  check(`${session.id}: guide degrees`, markers.every(m => Array.isArray(m.degrees) && m.degrees.length >= 4 && Array.isArray(m.rootNotes) && m.rootNotes.length));

  let movingTracks = 0;
  for (const track of session.tracks || []) {
    check(`${session.id}/${track.name}: factory full patch`, patches.has(track.patchId));
    check(`${session.id}/${track.name}: follows Harmonic guide`, track.useHarmonicGuide === true);
    check(`${session.id}/${track.name}: arranged region`, Array.isArray(track.regions) && track.regions.length > 0 && track.regions.every(r => r.lengthBeats > 0 && r.startBeat >= 0));
    const anchors = track.anchors || [];
    const moves = anchors.some((a, i) => i > 0 && (a.angle !== anchors[i - 1].angle || a.dist !== anchors[i - 1].dist));
    if (moves) movingTracks++;
    check(`${session.id}/${track.name}: spatial anchors`, anchors.length >= 2 && anchors.every(a => Number.isFinite(a.beat) && Number.isFinite(a.angle) && Number.isFinite(a.dist)));
  }
  check(`${session.id}: multiple moving patch threads`, movingTracks >= 2, `${movingTracks}`);

  if (session.context?.scaleMode === "edo" && session.context?.edoDivisions === 7) {
    hasSevenEdo = true;
    check(`${session.id}: 7-EDO guide declares its tuning`, markers.every(m => m.scaleMode === "edo" && m.edoDivisions === 7));
    check(`${session.id}: 7-EDO guide stays in range`, markers.every(m => m.degrees.every(d => d >= 0 && d < 7)));
  }
}
check("one 7-EDO starter", hasSevenEdo);

if (failures) {
  console.error(`\n${failures} factory-session check(s) failed.`);
  process.exit(1);
}
console.log("All factory-session checks passed.");
